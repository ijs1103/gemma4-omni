"""소셜 로그인 인증 오케스트레이션 서비스.

소셜 로그인의 전체 흐름을 조율하는 메인 서비스이다:
1. start_login: state/nonce/PKCE 생성 → Redis 저장 → authorize URL 반환
2. authenticate: state 검증 → code 교환 → 프로필 정규화 → 사용자 upsert → 세션 발급

Redis에 임시 OAuth 상태를 저장하며, TTL 5분으로 만료 관리한다.
PKCE(Proof Key for Code Exchange)를 사용하여 인가 코드 탈취 공격을 방지한다.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import secrets
from uuid import UUID

import redis.asyncio as aioredis
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import InvalidStateError, OAuthProviderError
from app.models.oauth_credential import OAuthCredential
from app.repositories.social_repo import SocialAccountRepository, social_account_repo
from app.repositories.user_repo import UserRepository, user_repo
from app.schemas.auth import (
    AuthSessionResponse,
    AuthUserPayload,
    SocialCallbackRequest,
    SocialStartResponse,
)
from app.schemas.social import NormalizedSocialProfile
from app.services.auth.session_service import SessionService
from app.services.auth.token_service import TokenService, token_service
from app.services.providers.base import get_provider

# 프로바이더 어댑터 모듈을 임포트하여 레지스트리에 자동 등록
import app.services.providers.google  # noqa: F401
import app.services.providers.apple  # noqa: F401
import app.services.providers.naver  # noqa: F401
import app.services.providers.kakao  # noqa: F401

logger = logging.getLogger(__name__)

# ── Redis 키 접두사 ──────────────────────────────────────────────
OAUTH_STATE_PREFIX = "oauth:state:"
OAUTH_STATE_TTL = settings.OAUTH_STATE_TTL_SECONDS  # 기본 300초 (5분)


def _generate_code_verifier() -> str:
    """PKCE code_verifier를 생성한다.

    64바이트의 랜덤 데이터를 base64url 인코딩한다.

    Returns:
        base64url 인코딩된 code_verifier 문자열 (패딩 제거).
    """
    random_bytes = secrets.token_bytes(64)
    return base64.urlsafe_b64encode(random_bytes).rstrip(b"=").decode("ascii")


def _generate_code_challenge(code_verifier: str) -> str:
    """PKCE code_challenge를 생성한다 (S256 방식).

    code_verifier를 SHA-256 해싱 후 base64url 인코딩한다.

    Args:
        code_verifier: 앞서 생성된 code_verifier 문자열.

    Returns:
        base64url 인코딩된 code_challenge 문자열 (패딩 제거).
    """
    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


class SocialAuthService:
    """소셜 로그인 전체 흐름을 오케스트레이션하는 서비스.

    start_login으로 인가 URL을 생성하고,
    authenticate로 콜백을 처리하여 사용자를 인증/가입 후 세션을 발급한다.
    """

    def __init__(
        self,
        user_repository: UserRepository | None = None,
        social_repository: SocialAccountRepository | None = None,
        session_service: SessionService | None = None,
        token_svc: TokenService | None = None,
    ):
        self._user_repo = user_repository or user_repo
        self._social_repo = social_repository or social_account_repo
        self._session_service = session_service or SessionService()
        self._token_service = token_svc or token_service

    def _get_redis(self) -> aioredis.Redis:
        """Redis 비동기 클라이언트를 생성한다."""
        return aioredis.from_url(
            settings.REDIS_URL,
            decode_responses=True,
        )

    # ════════════════════════════════════════════════════════════
    # 1. 소셜 로그인 시작 (authorize URL 생성)
    # ════════════════════════════════════════════════════════════

    async def start_login(
        self,
        provider: str,
        redirect_uri: str,
        platform: str,
    ) -> SocialStartResponse:
        """소셜 로그인 시작: state/nonce/PKCE 생성 → Redis 저장 → authorize URL 반환.

        Args:
            provider: OAuth 프로바이더 이름 (google, apple, naver, kakao).
            redirect_uri: 인증 완료 후 리다이렉트될 클라이언트 URI.
            platform: 클라이언트 플랫폼 (web, ios, android).

        Returns:
            authorize_url이 포함된 SocialStartResponse.

        Raises:
            OAuthProviderError: 지원하지 않는 프로바이더인 경우.
        """
        adapter = get_provider(provider)

        # CSRF 방지용 state 생성
        state = secrets.token_urlsafe(32)

        # OIDC nonce 생성 (Google, Apple 등 OIDC 프로바이더용)
        nonce = secrets.token_urlsafe(32)

        # PKCE code_verifier / code_challenge 생성
        code_verifier = _generate_code_verifier()
        code_challenge = _generate_code_challenge(code_verifier)

        # Redis에 OAuth 상태 저장 (TTL 5분)
        state_data = {
            "provider": provider,
            "redirect_uri": redirect_uri,
            "platform": platform,
            "nonce": nonce,
            "code_verifier": code_verifier,
        }

        redis = self._get_redis()
        try:
            await redis.setex(
                f"{OAUTH_STATE_PREFIX}{state}",
                OAUTH_STATE_TTL,
                json.dumps(state_data),
            )
        finally:
            await redis.aclose()

        # 프로바이더별 authorize URL 생성
        authorize_url = await adapter.build_authorize_url(
            state=state,
            nonce=nonce,
            redirect_uri=redirect_uri,
            code_challenge=code_challenge,
        )

        logger.info(
            "소셜 로그인 시작: provider=%s platform=%s state=%s...",
            provider,
            platform,
            state[:8],
        )

        return SocialStartResponse(authorize_url=authorize_url)

    # ════════════════════════════════════════════════════════════
    # 2. 소셜 로그인 콜백 처리 (authenticate)
    # ════════════════════════════════════════════════════════════

    async def authenticate(
        self,
        provider: str,
        payload: SocialCallbackRequest,
        db: AsyncSession,
        device_info: str | None = None,
        ip_address: str | None = None,
    ) -> AuthSessionResponse:
        """소셜 로그인 콜백을 처리하여 사용자를 인증/가입하고 세션을 발급한다.

        전체 흐름:
        1. Redis에서 state 검증 및 삭제 (1회성)
        2. 프로바이더에 인가 코드를 토큰으로 교환
        3. 프로바이더에서 사용자 프로필 조회
        4. 프로필 정규화
        5. 사용자 + 소셜 계정 + OAuth 자격증명 upsert (단일 트랜잭션)
        6. 내부 JWT 토큰 쌍 발급
        7. 인증 세션 생성
        8. AuthSessionResponse 반환

        Args:
            provider: OAuth 프로바이더 이름.
            payload: 클라이언트로부터 받은 콜백 요청 데이터.
            db: 비동기 DB 세션 (트랜잭션은 라우터에서 커밋).
            device_info: 클라이언트 기기 정보.
            ip_address: 클라이언트 IP 주소.

        Returns:
            인증 결과(사용자 정보, 토큰, 세션 정보)를 포함한 AuthSessionResponse.

        Raises:
            InvalidStateError: state 파라미터가 유효하지 않거나 만료된 경우.
            OAuthProviderError: 프로바이더 통신 중 오류 발생 시.
        """
        adapter = get_provider(provider)

        # ── 1. State 검증 ────────────────────────────────────────
        code_verifier: str | None = None

        if payload.state:
            redis = self._get_redis()
            try:
                state_key = f"{OAUTH_STATE_PREFIX}{payload.state}"
                state_json = await redis.get(state_key)

                if state_json is None:
                    raise InvalidStateError("OAuth state가 만료되었거나 유효하지 않습니다.")

                # state는 1회성 — 즉시 삭제
                await redis.delete(state_key)
            finally:
                await redis.aclose()

            state_data = json.loads(state_json)

            # 프로바이더 일치 확인
            if state_data.get("provider") != provider:
                raise InvalidStateError("OAuth state의 프로바이더가 일치하지 않습니다.")

            code_verifier = state_data.get("code_verifier")

        # 클라이언트가 직접 code_verifier를 전달한 경우 우선 사용 (모바일)
        if payload.code_verifier:
            code_verifier = payload.code_verifier

        # ── 2. 인가 코드 → 토큰 교환 ────────────────────────────
        token_set = await adapter.exchange_code(
            code=payload.code,
            redirect_uri=payload.redirect_uri,
            code_verifier=code_verifier,
        )

        # Apple 웹 로그인: 콜백에서 id_token이 직접 전달될 수 있음
        if payload.id_token and "id_token" not in token_set:
            token_set["id_token"] = payload.id_token

        # ── 3. 사용자 프로필 조회 ────────────────────────────────
        profile = await adapter.fetch_profile(token_set)

        # ── 4. 프로필 정규화 ─────────────────────────────────────
        normalized = await adapter.normalize_profile(token_set, profile)

        # ── 5. 사용자 Upsert (단일 트랜잭션) ─────────────────────
        user, is_new_user = await self._upsert_user_and_social_account(
            db=db,
            normalized=normalized,
            token_set=token_set,
        )

        # ── 6. 내부 토큰 쌍 발급 ─────────────────────────────────
        # 세션 생성 후 session_id를 알 수 있으므로, 먼저 임시로 발급
        access_token, refresh_token = self._token_service.issue_pair(
            user_id=str(user.id),
            session_id="pending",  # 아래에서 재발급
            provider=provider,
        )

        # ── 7. 인증 세션 생성 ────────────────────────────────────
        auth_session = await self._session_service.create_session(
            db=db,
            user_id=user.id,
            refresh_token=refresh_token,
            provider=provider,
            device_info=device_info,
            ip_address=ip_address,
        )

        # ── 8. 최종 access_token 재발급 (올바른 session_id 포함) ──
        access_token = self._token_service.issue_pair(
            user_id=str(user.id),
            session_id=str(auth_session.id),
            provider=provider,
        )[0]

        # 연동된 프로바이더 목록 조회
        social_accounts = await self._social_repo.get_by_user_id(db, user.id)
        linked_providers = [sa.provider for sa in social_accounts]

        logger.info(
            "소셜 인증 완료: provider=%s user_id=%s is_new=%s session_id=%s",
            provider,
            user.id,
            is_new_user,
            auth_session.id,
        )

        return AuthSessionResponse(
            user=AuthUserPayload(
                id=str(user.id),
                email=user.primary_email,
                display_name=user.display_name,
                profile_image_url=user.profile_image_url,
                linked_providers=linked_providers,
            ),
            access_token=access_token,
            refresh_token=refresh_token if payload.platform != "web" else None,
            expires_in=self._token_service.get_access_token_ttl_seconds(),
            linked_provider=provider,
            is_new_user=is_new_user,
        )

    # ════════════════════════════════════════════════════════════
    # 3. 추가 소셜 계정 연결 (link)
    # ════════════════════════════════════════════════════════════

    async def link_account(
        self,
        provider: str,
        payload: SocialCallbackRequest,
        user_id: UUID,
        db: AsyncSession,
    ) -> NormalizedSocialProfile:
        """기존 사용자에 추가 소셜 계정을 연결한다.

        이미 다른 사용자에게 연결된 소셜 계정이면 에러를 발생시킨다.

        Args:
            provider: 연결할 OAuth 프로바이더 이름.
            payload: 콜백 요청 데이터.
            user_id: 현재 인증된 사용자 UUID.
            db: 비동기 DB 세션.

        Returns:
            정규화된 소셜 프로필.

        Raises:
            OAuthProviderError: 이미 다른 사용자에 연결된 경우.
        """
        adapter = get_provider(provider)

        # 코드 교환
        token_set = await adapter.exchange_code(
            code=payload.code,
            redirect_uri=payload.redirect_uri,
            code_verifier=payload.code_verifier,
        )

        if payload.id_token and "id_token" not in token_set:
            token_set["id_token"] = payload.id_token

        # 프로필 조회 및 정규화
        profile = await adapter.fetch_profile(token_set)
        normalized = await adapter.normalize_profile(token_set, profile)

        # 이미 연결된 소셜 계정 확인
        existing = await self._social_repo.get_by_provider_and_id(
            db, provider, normalized.provider_user_id
        )
        if existing:
            if existing.user_id == user_id:
                # 이미 같은 사용자에게 연결됨 — 자격증명만 갱신
                await self._update_credential(db, existing.id, token_set)
                return normalized
            raise OAuthProviderError(
                detail="이 소셜 계정은 이미 다른 사용자에게 연결되어 있습니다."
            )

        # 새 소셜 계정 + 자격증명 생성
        social_account = await self._social_repo.create(
            db,
            user_id=user_id,
            provider=provider,
            provider_user_id=normalized.provider_user_id,
            provider_email=normalized.email,
            email_verified=normalized.email_verified,
            raw_profile=normalized.raw,
        )
        await self._create_credential(db, social_account.id, token_set)

        logger.info(
            "소셜 계정 연결: provider=%s user_id=%s social_account_id=%s",
            provider,
            user_id,
            social_account.id,
        )

        return normalized

    # ════════════════════════════════════════════════════════════
    # 내부 헬퍼 메서드
    # ════════════════════════════════════════════════════════════

    async def _upsert_user_and_social_account(
        self,
        db: AsyncSession,
        normalized: NormalizedSocialProfile,
        token_set: dict,
    ) -> tuple:
        """사용자 + 소셜 계정 + OAuth 자격증명을 upsert한다.

        (provider, provider_user_id) 복합키로 기존 소셜 계정을 조회한다.
        - 존재하면: 자격증명 업데이트, 기존 사용자 반환.
        - 존재하지 않으면: 새 사용자 + 소셜 계정 + 자격증명 생성.

        Args:
            db: 비동기 DB 세션.
            normalized: 정규화된 소셜 프로필.
            token_set: 프로바이더 토큰 세트.

        Returns:
            (User, is_new_user) 튜플.
        """
        # 기존 소셜 계정 조회
        existing_social = await self._social_repo.get_by_provider_and_id(
            db,
            normalized.provider,
            normalized.provider_user_id,
        )

        if existing_social:
            # ── 기존 사용자: 자격증명만 업데이트 ──
            await self._update_credential(db, existing_social.id, token_set)

            # 프로필 정보 업데이트 (이메일, 프로필 이미지 등)
            existing_social.provider_email = normalized.email
            existing_social.email_verified = normalized.email_verified
            existing_social.raw_profile = normalized.raw

            user = await self._user_repo.get_by_id(db, existing_social.user_id)

            # 프로필 이미지가 업데이트된 경우 반영
            if normalized.profile_image_url and user:
                user.profile_image_url = normalized.profile_image_url
                await db.flush()

            logger.info(
                "기존 사용자 소셜 로그인: provider=%s user_id=%s",
                normalized.provider,
                existing_social.user_id,
            )

            return user, False

        # ── 신규 사용자 생성 ──
        new_user = await self._user_repo.create(
            db,
            display_name=normalized.display_name or normalized.nickname,
            primary_email=normalized.email,
            profile_image_url=normalized.profile_image_url,
        )

        # 소셜 계정 생성
        social_account = await self._social_repo.create(
            db,
            user_id=new_user.id,
            provider=normalized.provider,
            provider_user_id=normalized.provider_user_id,
            provider_email=normalized.email,
            email_verified=normalized.email_verified,
            raw_profile=normalized.raw,
        )

        # OAuth 자격증명 생성
        await self._create_credential(db, social_account.id, token_set)

        logger.info(
            "신규 사용자 가입: provider=%s user_id=%s",
            normalized.provider,
            new_user.id,
        )

        return new_user, True

    async def _create_credential(
        self,
        db: AsyncSession,
        social_account_id: UUID,
        token_set: dict,
    ) -> OAuthCredential:
        """프로바이더 OAuth 자격증명을 생성한다.

        Args:
            db: 비동기 DB 세션.
            social_account_id: 연결할 소셜 계정 UUID.
            token_set: 프로바이더 토큰 세트.

        Returns:
            생성된 OAuthCredential 인스턴스.
        """
        credential = OAuthCredential(
            social_account_id=social_account_id,
            access_token_encrypted=token_set.get("access_token"),
            refresh_token_encrypted=token_set.get("refresh_token"),
            id_token_encrypted=token_set.get("id_token"),
            token_type=token_set.get("token_type", "Bearer"),
            scope=token_set.get("scope"),
        )
        db.add(credential)
        await db.flush()
        return credential

    async def _update_credential(
        self,
        db: AsyncSession,
        social_account_id: UUID,
        token_set: dict,
    ) -> None:
        """기존 프로바이더 OAuth 자격증명을 업데이트한다.

        자격증명이 존재하지 않으면 새로 생성한다.

        Args:
            db: 비동기 DB 세션.
            social_account_id: 소셜 계정 UUID.
            token_set: 프로바이더 토큰 세트.
        """
        from sqlalchemy import select

        stmt = select(OAuthCredential).where(
            OAuthCredential.social_account_id == social_account_id
        )
        result = await db.execute(stmt)
        credential = result.scalar_one_or_none()

        if credential:
            # 기존 자격증명 업데이트
            if token_set.get("access_token"):
                credential.access_token_encrypted = token_set["access_token"]
            if token_set.get("refresh_token"):
                credential.refresh_token_encrypted = token_set["refresh_token"]
            if token_set.get("id_token"):
                credential.id_token_encrypted = token_set["id_token"]
            if token_set.get("token_type"):
                credential.token_type = token_set["token_type"]
            if token_set.get("scope"):
                credential.scope = token_set["scope"]
            await db.flush()
        else:
            # 자격증명이 없으면 새로 생성
            await self._create_credential(db, social_account_id, token_set)
