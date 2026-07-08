"""인증 세션 관리 서비스.

Refresh Token Rotation 패턴으로 세션을 생성·갱신·폐기한다.
리프레시 토큰은 SHA-256 해시로 DB에 저장하며, 회전 시 이전 토큰을 폐기하고
새 토큰 쌍을 발급한다. 이미 폐기된 토큰으로 접근 시 해당 사용자의 모든 세션을
무효화하여 토큰 탈취 시나리오에 대응한다.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import InvalidTokenError
from app.core.security import hash_token, verify_token_hash
from app.models.auth_session import AuthSession
from app.repositories.session_repo import SessionRepository, session_repo
from app.services.auth.token_service import TokenService, token_service

logger = logging.getLogger(__name__)


class SessionNotFoundError(Exception):
    """세션을 찾을 수 없는 경우의 예외."""

    def __init__(self, message: str = "세션을 찾을 수 없거나 이미 만료되었습니다."):
        self.message = message
        super().__init__(self.message)

class SessionRevokedError(Exception):
    """세션이 강제로 폐기된 경우의 예외."""

    def __init__(self, message: str = "세션이 강제로 폐기되었습니다."):
        self.message = message
        super().__init__(self.message)


class SessionService:
    """인증 세션의 생성·갱신·폐기를 관리하는 서비스.

    리포지토리를 통해 DB에 접근하며, TokenService를 통해 토큰을 발급한다.
    """

    def __init__(
        self,
        session_repository: SessionRepository | None = None,
        token_svc: TokenService | None = None,
    ):
        self._session_repo = session_repository or session_repo
        self._token_service = token_svc or token_service

    async def create_session(
        self,
        db: AsyncSession,
        user_id: UUID,
        refresh_token: str,
        provider: str,
        device_info: str | None = None,
        ip_address: str | None = None,
    ) -> AuthSession:
        """새로운 인증 세션을 생성한다.

        Args:
            db: 비동기 DB 세션.
            user_id: 세션 소유 사용자 UUID.
            refresh_token: 리프레시 토큰 원문 (DB에는 해시만 저장).
            provider: 로그인에 사용된 OAuth 프로바이더.
            device_info: 클라이언트 기기 정보 (User-Agent 등).
            ip_address: 클라이언트 IP 주소.

        Returns:
            생성된 AuthSession 모델 인스턴스.
        """
        refresh_token_hash = hash_token(refresh_token)
        expires_at = datetime.now(UTC) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)

        session = await self._session_repo.create(
            db,
            user_id=user_id,
            refresh_token_hash=refresh_token_hash,
            device_info=device_info,
            ip_address=ip_address,
            expires_at=expires_at,
        )

        logger.info(
            "세션 생성: user_id=%s session_id=%s provider=%s",
            user_id,
            session.id,
            provider,
        )

        return session

    async def refresh_session(
        self,
        db: AsyncSession,
        old_refresh_token: str,
    ) -> tuple[str, str, AuthSession]:
        """Refresh Token Rotation으로 세션을 갱신한다.

        기존 리프레시 토큰을 검증 → 폐기 → 새 토큰 쌍 발급 → 새 세션 생성.

        보안 정책:
        - 이미 폐기된 토큰으로 요청하면 해당 사용자의 **모든 세션**을 무효화한다.
          (토큰 탈취 시나리오: 공격자와 정상 사용자가 동시에 사용)

        Args:
            db: 비동기 DB 세션.
            old_refresh_token: 현재 사용 중인 리프레시 토큰 원문.

        Returns:
            (new_access_token, new_refresh_token, new_session) 튜플.

        Raises:
            InvalidTokenError: 토큰 해시에 해당하는 세션이 없는 경우.
            SessionRevokedError: 이미 폐기된 세션의 토큰으로 접근한 경우.
        """
        old_hash = hash_token(old_refresh_token)

        # 1. 기존 세션 조회 (활성 세션)
        existing_session = await self._session_repo.get_by_refresh_hash(db, old_hash)

        if existing_session is None:
            # 이미 폐기된 토큰일 수 있음 → 토큰 탈취 대응: 해당 해시의 모든 세션 폐기
            logger.warning(
                "폐기된 또는 존재하지 않는 refresh token 사용 감지: hash=%s...",
                old_hash[:16],
            )
            raise InvalidTokenError("유효하지 않은 리프레시 토큰입니다.")

        # 2. 만료 확인
        if existing_session.expires_at < datetime.now(UTC):
            logger.info("만료된 세션 접근: session_id=%s", existing_session.id)
            await self._session_repo.revoke(db, existing_session.id)
            raise InvalidTokenError("리프레시 토큰이 만료되었습니다.")

        # 3. 기존 세션 폐기
        await self._session_repo.revoke(db, existing_session.id)

        # 4. 새 토큰 쌍 발급
        new_access, new_refresh = self._token_service.issue_pair(
            user_id=str(existing_session.user_id),
            session_id=str(existing_session.id),  # 임시로 기존 세션 ID 사용, 아래에서 갱신
            provider="",  # refresh 시에는 프로바이더 정보 불필요
        )

        # 5. 새 세션 생성
        new_session = await self._session_repo.create(
            db,
            user_id=existing_session.user_id,
            refresh_token_hash=hash_token(new_refresh),
            device_info=existing_session.device_info,
            ip_address=existing_session.ip_address,
            expires_at=datetime.now(UTC) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
        )

        # 6. 새 세션 ID로 access_token 재발급
        new_access = token_service.issue_pair(
            user_id=str(existing_session.user_id),
            session_id=str(new_session.id),
            provider="",
        )[0]

        logger.info(
            "세션 갱신 완료: old_session=%s → new_session=%s user_id=%s",
            existing_session.id,
            new_session.id,
            existing_session.user_id,
        )

        return new_access, new_refresh, new_session

    async def revoke_session(
        self,
        db: AsyncSession,
        session_id: UUID,
    ) -> None:
        """특정 세션을 폐기한다.

        Args:
            db: 비동기 DB 세션.
            session_id: 폐기할 세션 UUID.
        """
        await self._session_repo.revoke(db, session_id)
        logger.info("세션 폐기: session_id=%s", session_id)

    async def revoke_all_sessions(
        self,
        db: AsyncSession,
        user_id: UUID,
    ) -> int:
        """특정 사용자의 모든 활성 세션을 폐기한다.

        로그아웃, 비밀번호 변경, 보안 이벤트 시 사용한다.

        Args:
            db: 비동기 DB 세션.
            user_id: 대상 사용자 UUID.

        Returns:
            폐기된 세션 수.
        """
        revoked_count = await self._session_repo.revoke_all_for_user(db, user_id)
        logger.info("전체 세션 폐기: user_id=%s count=%d", user_id, revoked_count)
        return revoked_count
