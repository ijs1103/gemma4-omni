"""Naver OAuth 프로바이더 어댑터.

네이버 로그인 OAuth 2.0 흐름을 구현한다.
- 인가 URL: https://nid.naver.com/oauth2.0/authorize
- 토큰 교환: https://nid.naver.com/oauth2.0/token
- 프로필 조회: https://openapi.naver.com/v1/nid/me (Bearer 토큰)
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

# ── Naver OAuth 엔드포인트 ───────────────────────────────────────
NAVER_AUTH_URL = "https://nid.naver.com/oauth2.0/authorize"
NAVER_TOKEN_URL = "https://nid.naver.com/oauth2.0/token"
NAVER_PROFILE_URL = "https://openapi.naver.com/v1/nid/me"


class NaverAdapter(SocialProviderAdapter):
    """네이버 로그인 OAuth 2.0 프로바이더 어댑터.

    네이버는 OIDC를 지원하지 않으므로 별도 프로필 API를 호출한다.
    프로필 응답은 { "resultcode": "00", "response": { ... } } 구조이다.
    """

    provider_name: str = "naver"

    async def build_authorize_url(
        self,
        state: str,
        nonce: str | None,
        redirect_uri: str,
        code_challenge: str | None = None,
    ) -> str:
        """네이버 인가 URL을 생성한다."""
        params: dict[str, str] = {
            "client_id": settings.NAVER_CLIENT_ID,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "state": state,
        }
        # 네이버는 PKCE를 공식 지원하지 않지만, 파라미터를 전달할 수 있도록 준비
        if code_challenge:
            params["code_challenge"] = code_challenge
            params["code_challenge_method"] = "S256"

        return f"{NAVER_AUTH_URL}?{urlencode(params)}"

    async def exchange_code(
        self,
        code: str,
        redirect_uri: str,
        code_verifier: str | None = None,
    ) -> dict:
        """네이버 토큰 엔드포인트에서 인가 코드를 토큰으로 교환한다."""
        data: dict[str, str] = {
            "code": code,
            "client_id": settings.NAVER_CLIENT_ID,
            "client_secret": settings.NAVER_CLIENT_SECRET,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        }
        if code_verifier:
            data["code_verifier"] = code_verifier

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(NAVER_TOKEN_URL, data=data)

        if resp.status_code != 200:
            logger.error("Naver 토큰 교환 실패: status=%d body=%s", resp.status_code, resp.text)
            raise OAuthProviderError(
                detail=f"Naver 토큰 교환 실패 (HTTP {resp.status_code})"
            )

        token_data = resp.json()

        # 네이버 토큰 응답에서 에러 코드 확인
        if "error" in token_data:
            error_desc = token_data.get("error_description", "알 수 없는 오류")
            logger.error("Naver 토큰 교환 에러: %s — %s", token_data["error"], error_desc)
            raise OAuthProviderError(detail=f"Naver 토큰 교환 실패: {error_desc}")

        return token_data

    async def fetch_profile(self, token_set: dict) -> dict | None:
        """네이버 프로필 API로 사용자 정보를 조회한다.

        네이버 응답 구조:
        {
            "resultcode": "00",
            "message": "success",
            "response": {
                "id": "...",
                "email": "...",
                "name": "...",
                "nickname": "...",
                "profile_image": "...",
                "mobile": "..."
            }
        }
        """
        access_token = token_set.get("access_token")
        if not access_token:
            raise OAuthProviderError(detail="Naver 프로필 조회 불가: access_token 없음")

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                NAVER_PROFILE_URL,
                headers={"Authorization": f"Bearer {access_token}"},
            )

        if resp.status_code != 200:
            logger.error("Naver 프로필 조회 실패: status=%d", resp.status_code)
            raise OAuthProviderError(
                detail=f"Naver 프로필 조회 실패 (HTTP {resp.status_code})"
            )

        data = resp.json()

        # 결과 코드 검증
        if data.get("resultcode") != "00":
            logger.error("Naver 프로필 API 에러: %s", data.get("message"))
            raise OAuthProviderError(detail="Naver 프로필 조회 실패")

        return data.get("response")

    async def normalize_profile(
        self,
        token_set: dict,
        profile: dict | None,
    ) -> NormalizedSocialProfile:
        """네이버 프로필을 NormalizedSocialProfile로 변환한다.

        네이버 response 필드 매핑:
        - id → provider_user_id
        - email → email
        - name → display_name
        - nickname → nickname
        - profile_image → profile_image_url
        - mobile → phone_number
        """
        if not profile:
            raise OAuthProviderError(detail="Naver 프로필 데이터가 없습니다.")

        return NormalizedSocialProfile(
            provider="naver",
            provider_user_id=str(profile.get("id", "")),
            email=profile.get("email"),
            email_verified=None,  # 네이버는 email_verified 필드를 제공하지 않음
            display_name=profile.get("name"),
            nickname=profile.get("nickname"),
            profile_image_url=profile.get("profile_image"),
            phone_number=profile.get("mobile"),
            raw=profile,
        )


# ── 모듈 로드 시 자동 등록 ──────────────────────────────────────
_naver_adapter = NaverAdapter()
register_provider(_naver_adapter)
