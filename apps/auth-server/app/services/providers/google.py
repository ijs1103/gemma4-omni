"""Google OAuth 프로바이더 어댑터.

Google OAuth 2.0 + OpenID Connect 흐름을 구현한다.
- 인가 URL: https://accounts.google.com/o/oauth2/v2/auth
- 토큰 교환: https://oauth2.googleapis.com/token
- 프로필 조회: id_token 디코딩 우선, 실패 시 userinfo 엔드포인트 폴백
"""

from __future__ import annotations

import logging
from urllib.parse import urlencode

import httpx
import jwt

from app.core.config import settings
from app.core.exceptions import OAuthProviderError
from app.schemas.social import NormalizedSocialProfile
from app.services.providers.base import SocialProviderAdapter, register_provider

logger = logging.getLogger(__name__)

# ── Google OAuth 엔드포인트 ──────────────────────────────────────
GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"
GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs"


class GoogleAdapter(SocialProviderAdapter):
    """Google OAuth 2.0 + OIDC 프로바이더 어댑터.

    scope='openid email profile'로 OIDC 인증을 수행하며,
    access_type='offline'으로 리프레시 토큰을 요청한다.
    프로필은 id_token 디코딩을 우선 시도하고, 실패 시 userinfo API로 폴백한다.
    """

    provider_name: str = "google"

    async def build_authorize_url(
        self,
        state: str,
        nonce: str | None,
        redirect_uri: str,
        code_challenge: str | None = None,
    ) -> str:
        """Google OAuth 인가 URL을 생성한다."""
        params: dict[str, str] = {
            "client_id": settings.GOOGLE_CLIENT_ID,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": "openid email profile",
            "access_type": "offline",
            "prompt": "consent",
            "state": state,
        }
        if nonce:
            params["nonce"] = nonce
        if code_challenge:
            params["code_challenge"] = code_challenge
            params["code_challenge_method"] = "S256"

        return f"{GOOGLE_AUTH_URL}?{urlencode(params)}"

    async def exchange_code(
        self,
        code: str,
        redirect_uri: str,
        code_verifier: str | None = None,
    ) -> dict:
        """Google 토큰 엔드포인트에서 인가 코드를 토큰으로 교환한다."""
        data: dict[str, str] = {
            "code": code,
            "client_id": settings.GOOGLE_CLIENT_ID,
            "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        }
        if code_verifier:
            data["code_verifier"] = code_verifier

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(GOOGLE_TOKEN_URL, data=data)

        if resp.status_code != 200:
            logger.error("Google 토큰 교환 실패: status=%d body=%s", resp.status_code, resp.text)
            raise OAuthProviderError(
                detail=f"Google 토큰 교환 실패 (HTTP {resp.status_code})"
            )

        return resp.json()

    async def fetch_profile(self, token_set: dict) -> dict | None:
        """Google 사용자 프로필을 조회한다.

        id_token이 있으면 디코딩하여 프로필을 추출한다.
        id_token이 없거나 디코딩에 실패하면 userinfo 엔드포인트로 폴백한다.
        """
        # 1차: id_token 디코딩 시도 (서명 검증 생략 — 이미 TLS로 직접 수신)
        id_token = token_set.get("id_token")
        if id_token:
            try:
                decoded = jwt.decode(
                    id_token,
                    options={"verify_signature": False},
                    algorithms=["RS256"],
                )
                return decoded
            except jwt.InvalidTokenError:
                logger.warning("Google id_token 디코딩 실패, userinfo 폴백 시도")

        # 2차: userinfo 엔드포인트 폴백
        access_token = token_set.get("access_token")
        if not access_token:
            raise OAuthProviderError(detail="Google 프로필 조회 불가: access_token 없음")

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                GOOGLE_USERINFO_URL,
                headers={"Authorization": f"Bearer {access_token}"},
            )

        if resp.status_code != 200:
            logger.error("Google userinfo 조회 실패: status=%d", resp.status_code)
            raise OAuthProviderError(
                detail=f"Google 프로필 조회 실패 (HTTP {resp.status_code})"
            )

        return resp.json()

    async def normalize_profile(
        self,
        token_set: dict,
        profile: dict | None,
    ) -> NormalizedSocialProfile:
        """Google 프로필을 NormalizedSocialProfile로 변환한다."""
        if not profile:
            raise OAuthProviderError(detail="Google 프로필 데이터가 없습니다.")

        return NormalizedSocialProfile(
            provider="google",
            provider_user_id=profile.get("sub", ""),
            email=profile.get("email"),
            email_verified=profile.get("email_verified"),
            display_name=profile.get("name"),
            first_name=profile.get("given_name"),
            last_name=profile.get("family_name"),
            profile_image_url=profile.get("picture"),
            locale=profile.get("locale"),
            raw=profile,
        )


# ── 모듈 로드 시 자동 등록 ──────────────────────────────────────
_google_adapter = GoogleAdapter()
register_provider(_google_adapter)
