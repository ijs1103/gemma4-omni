"""소셜 프로필 정규화 스키마.

각 OAuth 제공자(Apple, Google, Naver, Kakao)로부터 받은 사용자 프로필을
일관된 형태로 변환하기 위한 중간 표현 스키마를 정의한다.
"""

from pydantic import BaseModel

from app.schemas.auth import Provider


class NormalizedSocialProfile(BaseModel):
    """제공자별 프로필 정보를 정규화한 공통 스키마.

    Provider Adapter가 각 제공자의 응답을 이 스키마로 변환하여
    서비스 레이어가 제공자 차이를 신경 쓰지 않도록 추상화한다.
    """

    provider: Provider
    """소셜 제공자 식별자."""

    provider_user_id: str
    """제공자 측 고유 사용자 ID (provider + provider_user_id로 유일성 보장)."""

    email: str | None = None
    """이메일 주소. 제공자에 따라 없을 수 있음."""

    email_verified: bool | None = None
    """이메일 인증 여부."""

    display_name: str | None = None
    """표시 이름 (전체 이름)."""

    first_name: str | None = None
    """이름 (given name)."""

    last_name: str | None = None
    """성 (family name)."""

    nickname: str | None = None
    """닉네임."""

    profile_image_url: str | None = None
    """프로필 이미지 URL."""

    phone_number: str | None = None
    """전화번호."""

    locale: str | None = None
    """사용자 로케일 (예: 'ko', 'en')."""

    raw: dict = {}
    """제공자 원본 응답 데이터. 디버깅 및 추가 처리용으로 보관."""
