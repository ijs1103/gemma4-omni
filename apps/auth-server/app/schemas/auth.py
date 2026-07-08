"""인증 관련 요청/응답 Pydantic v2 스키마.

소셜 로그인 시작, 콜백 처리, 토큰 갱신 등
인증 API 엔드포인트에서 사용하는 스키마를 정의한다.
"""

from typing import Literal

from pydantic import BaseModel

# ──────────────────────────────────────────────
# 공통 타입 별칭
# ──────────────────────────────────────────────

Provider = Literal["apple", "google", "naver", "kakao"]
"""지원하는 소셜 OAuth 제공자."""

PlatformType = Literal["web", "ios", "android"]
"""클라이언트 플랫폼 유형 — 토큰 전달 방식 결정에 사용."""


# ──────────────────────────────────────────────
# 요청 스키마
# ──────────────────────────────────────────────


class SocialStartQuery(BaseModel):
    """소셜 로그인 시작 요청 쿼리 파라미터.

    provider는 경로 매개변수로 별도 처리하므로 여기에 포함하지 않는다.
    """

    model_config = {"extra": "forbid"}

    redirect_uri: str
    """OAuth 인증 완료 후 리다이렉트 될 클라이언트 URI."""

    platform: PlatformType
    """클라이언트 플랫폼 (web / ios / android)."""


class SocialCallbackRequest(BaseModel):
    """소셜 로그인 콜백 요청 바디.

    OAuth 제공자로부터 받은 인가 코드와 관련 정보를 전달한다.
    """

    model_config = {"extra": "forbid"}

    code: str
    """OAuth 인가 코드."""

    state: str | None = None
    """CSRF 방지를 위한 state 값. 제공자에 따라 선택적."""

    redirect_uri: str
    """토큰 교환 시 사용할 리다이렉트 URI (시작 요청과 동일해야 함)."""

    code_verifier: str | None = None
    """PKCE code_verifier. 모바일 클라이언트에서 사용."""

    id_token: str | None = None
    """Apple 웹 로그인 시 전달되는 ID 토큰."""

    platform: PlatformType
    """클라이언트 플랫폼 (web / ios / android)."""


class RefreshRequest(BaseModel):
    """액세스 토큰 갱신 요청.

    기존 리프레시 토큰을 제출하여 새로운 액세스 토큰을 발급받는다.
    """

    model_config = {"extra": "forbid"}

    refresh_token: str
    """현재 유효한 리프레시 토큰."""


# ──────────────────────────────────────────────
# 응답 스키마
# ──────────────────────────────────────────────


class SocialStartResponse(BaseModel):
    """소셜 로그인 시작 응답.

    클라이언트가 사용자를 리다이렉트해야 할 OAuth 인가 URL을 반환한다.
    """

    authorize_url: str
    """제공자의 OAuth 인가 엔드포인트 URL (state, PKCE 파라미터 포함)."""


class AuthUserPayload(BaseModel):
    """인증 응답에 포함되는 사용자 정보."""

    id: str
    """사용자 고유 식별자 (UUID 문자열)."""

    email: str | None = None
    """사용자 이메일 주소."""

    display_name: str | None = None
    """표시 이름."""

    profile_image_url: str | None = None
    """프로필 이미지 URL."""

    linked_providers: list[Provider]
    """연동된 소셜 제공자 목록."""


class AuthSessionResponse(BaseModel):
    """로그인 / 회원가입 성공 응답.

    사용자 정보, 액세스 토큰, 리프레시 토큰을 포함한다.
    웹 클라이언트의 경우 refresh_token은 HttpOnly 쿠키로 전달되므로
    응답 바디에는 None이 될 수 있다.
    """

    user: AuthUserPayload
    """인증된 사용자 정보."""

    access_token: str
    """JWT 액세스 토큰."""

    refresh_token: str | None = None
    """리프레시 토큰. 모바일 클라이언트에만 바디로 제공."""

    token_type: str = "bearer"
    """토큰 유형."""

    expires_in: int
    """액세스 토큰 만료 시간 (초)."""

    linked_provider: Provider
    """이번 로그인에 사용한 소셜 제공자."""

    is_new_user: bool
    """신규 가입 여부."""


class RefreshResponse(BaseModel):
    """액세스 토큰 갱신 응답.

    새로운 액세스 토큰과 (회전된) 리프레시 토큰을 반환한다.
    """

    access_token: str
    """갱신된 JWT 액세스 토큰."""

    refresh_token: str | None = None
    """회전된 리프레시 토큰. 웹 클라이언트의 경우 쿠키로 전달."""

    token_type: str = "bearer"
    """토큰 유형."""

    expires_in: int
    """액세스 토큰 만료 시간 (초)."""


class MessageResponse(BaseModel):
    """간단한 메시지 응답 (로그아웃, 연동 해제 등)."""

    message: str
    """응답 메시지."""
