"""Kakao OAuth 프로바이더 어댑터.

카카오 로그인 OAuth 2.0 흐름을 구현한다.
- 인가 URL: https://kauth.kakao.com/oauth/authorize
- 토큰 교환: https://kauth.kakao.com/oauth/token
- 프로필 조회: https://kapi.kakao.com/v2/user/me (Bearer 토큰)
"""

from __future__ import annotations

import logging
from urllib.parse import urlencode

import httpx

from app.core.config import settings
from app.core.exceptions import OAuthProviderError
from app.schemas.social import NormalizedSocialProfile
from app.services.providers.base import SocialProviderAdapter, register_provider

logger = logging.getLogger(__name__)

# ── Kakao OAuth 엔드포인트 ───────────────────────────────────────
KAKAO_AUTH_URL = "https://kauth.kakao.com/oauth/authorize"
KAKAO_TOKEN_URL = "https://kauth.kakao.com/oauth/token"
KAKAO_PROFILE_URL = "https://kapi.kakao.com/v2/user/me"


class KakaoAdapter(SocialProviderAdapter):
    """카카오 로그인 OAuth 2.0 프로바이더 어댑터.

    카카오 프로필 응답은 중첩 구조로, kakao_account 안에
    email, profile(nickname, profile_image_url) 등이 포함된다.
    """

    provider_name: str = "kakao"

    async def build_authorize_url(
        self,
        state: str,
        nonce: str | None,
        redirect_uri: str,
        code_challenge: str | None = None,
    ) -> str:
        """카카오 인가 URL을 생성한다."""
        params: dict[str, str] = {
            "client_id": settings.KAKAO_CLIENT_ID,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "state": state,
        }
        if nonce:
            params["nonce"] = nonce
        if code_challenge:
            params["code_challenge"] = code_challenge
            params["code_challenge_method"] = "S256"

        return f"{KAKAO_AUTH_URL}?{urlencode(params)}"

    async def exchange_code(
        self,
        code: str,
        redirect_uri: str,
        code_verifier: str | None = None,
    ) -> dict:
        """카카오 토큰 엔드포인트에서 인가 코드를 토큰으로 교환한다."""
        data: dict[str, str] = {
            "code": code,
            "client_id": settings.KAKAO_CLIENT_ID,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        }
        # 카카오는 client_secret이 선택적이지만, 보안 강화를 위해 설정된 경우 전달
        if settings.KAKAO_CLIENT_SECRET:
            data["client_secret"] = settings.KAKAO_CLIENT_SECRET
        if code_verifier:
            data["code_verifier"] = code_verifier

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                KAKAO_TOKEN_URL,
                data=data,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )

        if resp.status_code != 200:
            logger.error("Kakao 토큰 교환 실패: status=%d body=%s", resp.status_code, resp.text)
            raise OAuthProviderError(
                detail=f"Kakao 토큰 교환 실패 (HTTP {resp.status_code})"
            )

        token_data = resp.json()

        # 카카오 에러 응답 확인
        if "error" in token_data:
            error_desc = token_data.get("error_description", "알 수 없는 오류")
            logger.error("Kakao 토큰 교환 에러: %s — %s", token_data["error"], error_desc)
            raise OAuthProviderError(detail=f"Kakao 토큰 교환 실패: {error_desc}")

        return token_data

    async def fetch_profile(self, token_set: dict) -> dict | None:
        """카카오 사용자 정보 API로 프로필을 조회한다.

        카카오 응답 구조:
        {
            "id": 12345,
            "kakao_account": {
                "email": "...",
                "email_needs_agreement": false,
                "profile": {
                    "nickname": "...",
                    "profile_image_url": "...",
                    "thumbnail_image_url": "..."
                }
            }
        }
        """
        access_token = token_set.get("access_token")
        if not access_token:
            raise OAuthProviderError(detail="Kakao 프로필 조회 불가: access_token 없음")

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                KAKAO_PROFILE_URL,
                headers={"Authorization": f"Bearer {access_token}"},
            )

        if resp.status_code != 200:
            logger.error("Kakao 프로필 조회 실패: status=%d", resp.status_code)
            raise OAuthProviderError(
                detail=f"Kakao 프로필 조회 실패 (HTTP {resp.status_code})"
            )

        return resp.json()

    async def normalize_profile(
        self,
        token_set: dict,
        profile: dict | None,
    ) -> NormalizedSocialProfile:
        """카카오 프로필을 NormalizedSocialProfile로 변환한다.

        카카오 필드 매핑:
        - id → provider_user_id
        - kakao_account.email → email
        - kakao_account.is_email_verified → email_verified
        - kakao_account.profile.nickname → nickname / display_name
        - kakao_account.profile.profile_image_url → profile_image_url
        """
        if not profile:
            raise OAuthProviderError(detail="Kakao 프로필 데이터가 없습니다.")

        kakao_account: dict = profile.get("kakao_account", {})
        kakao_profile: dict = kakao_account.get("profile", {})

        nickname = kakao_profile.get("nickname")

        return NormalizedSocialProfile(
            provider="kakao",
            provider_user_id=str(profile.get("id", "")),
            email=kakao_account.get("email"),
            email_verified=kakao_account.get("is_email_verified"),
            display_name=nickname,
            nickname=nickname,
            profile_image_url=kakao_profile.get("profile_image_url"),
            raw=profile,
        )


# ── 모듈 로드 시 자동 등록 ──────────────────────────────────────
_kakao_adapter = KakaoAdapter()
register_provider(_kakao_adapter)
