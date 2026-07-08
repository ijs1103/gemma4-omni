"""인증 세션(AuthSession) 리포지토리.

auth_sessions 테이블에 대한 비동기 CRUD 작업을 제공한다.
리프레시 토큰 회전(Refresh Token Rotation) 방식으로 세션을 관리한다.
"""

from datetime import datetime
from uuid import UUID

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth_session import AuthSession


class SessionRepository:
    """인증 세션 모델에 대한 데이터 액세스 메서드를 제공하는 리포지토리."""

    async def create(
        self,
        db: AsyncSession,
        *,
        user_id: UUID,
        refresh_token_hash: str,
        device_info: str | None = None,
        ip_address: str | None = None,
        expires_at: datetime,
    ) -> AuthSession:
        """새로운 인증 세션을 생성한다.

        Args:
            db: 비동기 데이터베이스 세션.
            user_id: 사용자 UUID.
            refresh_token_hash: 리프레시 토큰의 SHA-256 해시.
            device_info: 기기 정보 (User-Agent 등).
            ip_address: 클라이언트 IP 주소.
            expires_at: 세션 만료 시각.

        Returns:
            생성된 AuthSession 모델 인스턴스.
        """
        session = AuthSession(
            user_id=user_id,
            refresh_token_hash=refresh_token_hash,
            device_info=device_info,
            ip_address=ip_address,
            expires_at=expires_at,
        )
        db.add(session)
        await db.flush()
        return session

    async def get_by_refresh_hash(
        self,
        db: AsyncSession,
        refresh_token_hash: str,
    ) -> AuthSession | None:
        """리프레시 토큰 해시로 활성 세션을 조회한다.

        취소되지 않은(revoked_at IS NULL) 세션만 반환한다.

        Args:
            db: 비동기 데이터베이스 세션.
            refresh_token_hash: 조회할 리프레시 토큰의 SHA-256 해시.

        Returns:
            해당 세션 모델 인스턴스 또는 None.
        """
        stmt = select(AuthSession).where(
            AuthSession.refresh_token_hash == refresh_token_hash,
            AuthSession.revoked_at.is_(None),
        )
        result = await db.execute(stmt)
        return result.scalar_one_or_none()

    async def revoke(
        self,
        db: AsyncSession,
        session_id: UUID,
    ) -> None:
        """특정 세션을 취소한다.

        Args:
            db: 비동기 데이터베이스 세션.
            session_id: 취소할 세션 UUID.
        """
        stmt = (
            update(AuthSession)
            .where(AuthSession.id == session_id, AuthSession.revoked_at.is_(None))
            .values(revoked_at=func.now())
        )
        await db.execute(stmt)

    async def revoke_all_for_user(
        self,
        db: AsyncSession,
        user_id: UUID,
    ) -> int:
        """특정 사용자의 모든 활성 세션을 취소한다.

        비밀번호 변경, 계정 보안 이슈 등에서 모든 세션을 무효화할 때 사용한다.

        Args:
            db: 비동기 데이터베이스 세션.
            user_id: 대상 사용자 UUID.

        Returns:
            취소된 세션 수.
        """
        stmt = (
            update(AuthSession)
            .where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
            .values(revoked_at=func.now())
        )
        result = await db.execute(stmt)
        return result.rowcount  # type: ignore[return-value]

    async def cleanup_expired(
        self,
        db: AsyncSession,
    ) -> int:
        """만료된 세션 레코드를 정리(삭제)한다.

        정기 배치 작업에서 호출하여 불필요한 레코드를 제거한다.

        Args:
            db: 비동기 데이터베이스 세션.

        Returns:
            삭제된 세션 수.
        """
        stmt = delete(AuthSession).where(AuthSession.expires_at < func.now())
        result = await db.execute(stmt)
        return result.rowcount  # type: ignore[return-value]


session_repo = SessionRepository()
"""모듈 레벨 싱글턴 인스턴스."""
