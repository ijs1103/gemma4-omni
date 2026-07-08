"""Apple OAuth 프로바이더 어댑터.

Apple Sign-In (OIDC) 흐름을 구현한다.
- 인가 URL: https://appleid.apple.com/auth/authorize (response_mode='form_post')
- 토큰 교환: https://appleid.apple.com/auth/token (ES256 JWT client_secret 사용)
- 프로필 조회: id_token 디코딩 (Apple은 별도 프로필 API 없음)
- Apple 고유 동작: 이름은 최초 인증 시에만 제공, 프라이빗 릴레이 이메일 지원
"""

from __future__ import annotations

import logging
import time
from urllib.parse import urlencode

import httpx
import jwt

from app.core.config import settings
from app.core.exceptions import OAuthProviderError
from app.schemas.social import NormalizedSocialProfile
from app.services.providers.base import SocialProviderAdapter, register_provider

logger = logging.getLogger(__name__)

# ── Apple OAuth 엔드포인트 ───────────────────────────────────────
APPLE_AUTH_URL = "https://appleid.apple.com/auth/authorize"
APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token"


def generate_apple_client_secret(
    private_key_pem: str,
    key_id: str,
    team_id: str,
    client_id: str,
    expires_in_seconds: int = 3600,
) -> str:
    """Apple Developer 스펙에 맞춘 client_secret JWT를 생성한다.

    ES256 (ECDSA P-256) 알고리즘으로 서명하며,
    Apple의 /auth/token 엔드포인트에서 client_secret으로 사용된다.

    Args:
        private_key_pem: Apple Developer에서 다운로드한 .p8 프라이빗 키 PEM 문자열.
        key_id: Apple Developer Key ID.
        team_id: Apple Developer Team ID.
        client_id: App Bundle ID 또는 Services ID.
        expires_in_seconds: JWT 유효 기간 (초). 기본 1시간.

    Returns:
        ES256 서명된 JWT 문자열.
    """
    current_time = int(time.time())
    headers = {
        "alg": "ES256",
        "kid": key_id,
    }
    payload = {
        "iss": team_id,
        "iat": current_time,
        "exp": current_time + expires_in_seconds,
        "aud": "https://appleid.apple.com",
        "sub": client_id,
    }
    return jwt.encode(payload, private_key_pem, algorithm="ES256", headers=headers)


class AppleAdapter(SocialProviderAdapter):
    """Apple Sign-In OIDC 프로바이더 어댑터.

    Apple은 response_mode='form_post'를 사용하며,
    토큰 교환 시 ES256 JWT로 생성한 client_secret이 필요하다.
    사용자 이름은 최초 인증 시에만 제공되므로, 콜백 요청의 'user' 파라미터에서
    이름을 추출해야 한다.
    """

    provider_name: str = "apple"

    async def build_authorize_url(
        self,
        state: str,
        nonce: str | None,
        redirect_uri: str,
        code_challenge: str | None = None,
    ) -> str:
        """Apple 인가 URL을 생성한다."""
        params: dict[str, str] = {
            "client_id": settings.APPLE_CLIENT_ID,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "response_mode": "form_post",
            "scope": "name email",
            "state": state,
        }
        if nonce:
            params["nonce"] = nonce
        if code_challenge:
            params["code_challenge"] = code_challenge
            params["code_challenge_method"] = "S256"

        return f"{APPLE_AUTH_URL}?{urlencode(params)}"

    async def exchange_code(
        self,
        code: str,
        redirect_uri: str,
        code_verifier: str | None = None,
    ) -> dict:
        """Apple 토큰 엔드포인트에서 인가 코드를 토큰으로 교환한다.

        client_secret은 ES256 JWT로 동적 생성한다.
        """
        if not settings.APPLE_PRIVATE_KEY:
            raise OAuthProviderError(detail="Apple 프라이빗 키가 설정되지 않았습니다.")

        client_secret = generate_apple_client_secret(
            private_key_pem=settings.APPLE_PRIVATE_KEY,
            key_id=settings.APPLE_KEY_ID,
            team_id=settings.APPLE_TEAM_ID,
            client_id=settings.APPLE_CLIENT_ID,
        )

        data: dict[str, str] = {
            "code": code,
            "client_id": settings.APPLE_CLIENT_ID,
            "client_secret": client_secret,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        }
        if code_verifier:
            data["code_verifier"] = code_verifier

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                APPLE_TOKEN_URL,
                data=data,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )

        if resp.status_code != 200:
            logger.error("Apple 토큰 교환 실패: status=%d body=%s", resp.status_code, resp.text)
            raise OAuthProviderError(
                detail=f"Apple 토큰 교환 실패 (HTTP {resp.status_code})"
            )

        return resp.json()

    async def fetch_profile(self, token_set: dict) -> dict | None:
        """Apple 사용자 프로필을 조회한다.

        Apple은 별도 프로필 API가 없으므로, id_token을 디코딩하여
        사용자 정보(sub, email, email_verified)를 추출한다.
        """
        id_token = token_set.get("id_token")
        if not id_token:
            raise OAuthProviderError(detail="Apple 응답에 id_token이 없습니다.")

        try:
            # Apple의 id_token은 RS256 서명 — TLS 직접 수신이므로 서명 검증 생략
            decoded = jwt.decode(
                id_token,
                options={"verify_signature": False},
                algorithms=["RS256"],
            )
            return decoded
        except jwt.InvalidTokenError as e:
            logger.error("Apple id_token 디코딩 실패: %s", e)
            raise OAuthProviderError(detail="Apple id_token 디코딩 실패") from e

    async def normalize_profile(
        self,
        token_set: dict,
        profile: dict | None,
    ) -> NormalizedSocialProfile:
        """Apple 프로필을 NormalizedSocialProfile로 변환한다.

        Apple 고유 동작:
        - sub: Apple 사용자 고유 식별자 (프로바이더 간 일관됨)
        - email: 프라이빗 릴레이 이메일일 수 있음 (예: xxx@privaterelay.appleid.com)
        - 이름: 최초 인증 시에만 'user' 파라미터로 전달되며, 이후에는 제공되지 않음
        """
        if not profile:
            raise OAuthProviderError(detail="Apple 프로필 데이터가 없습니다.")

        # Apple은 사용자 이름을 최초 로그인 시 token_set의 'user' 필드로 전달할 수 있음
        user_data = token_set.get("user")
        first_name: str | None = None
        last_name: str | None = None
        display_name: str | None = None

        if isinstance(user_data, dict):
            name_data = user_data.get("name", {})
            if isinstance(name_data, dict):
                first_name = name_data.get("firstName")
                last_name = name_data.get("lastName")
            if first_name or last_name:
                parts = [p for p in (first_name, last_name) if p]
                display_name = " ".join(parts)

        return NormalizedSocialProfile(
            provider="apple",
            provider_user_id=profile.get("sub", ""),
            email=profile.get("email"),
            email_verified=profile.get("email_verified"),
            display_name=display_name,
            first_name=first_name,
            last_name=last_name,
            raw=profile,
        )


# ── 모듈 로드 시 자동 등록 ──────────────────────────────────────
_apple_adapter = AppleAdapter()
register_provider(_apple_adapter)
