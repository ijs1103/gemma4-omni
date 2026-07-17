"""소셜 OAuth 프로바이더 어댑터 기본 클래스 및 레지스트리.

모든 소셜 로그인 프로바이더(Google, Apple, Naver, Kakao)는
SocialProviderAdapter 추상 클래스를 구현한다.
서비스 레이어는 provider_registry를 통해 프로바이더 이름으로 어댑터를 조회하여
프로바이더 간 차이를 추상화한다.
"""

from __future__ import annotations
from typing import Optional

from abc import ABC, abstractmethod

from app.core.exceptions import OAuthProviderError
from app.schemas.social import NormalizedSocialProfile


class SocialProviderAdapter(ABC):
    """소셜 OAuth 프로바이더 어댑터의 추상 기본 클래스.

    각 프로바이더 어댑터는 이 클래스를 상속받아
    authorize URL 생성, code 교환, 프로필 조회, 프로필 정규화를 구현한다.
    """

    provider_name: str
    """프로바이더 식별 이름 (예: 'google', 'apple')."""

    @abstractmethod
    async def build_authorize_url(
        self,
        state: str,
        nonce: Optional[str],
        redirect_uri: str,
        code_challenge: Optional[str] = None,
    ) -> str:
        """프로바이더의 OAuth 인가 URL을 생성한다.

        Args:
            state: CSRF 방지용 랜덤 state 파라미터.
            nonce: OIDC replay 공격 방지용 nonce (선택적).
            redirect_uri: 인증 완료 후 리다이렉트될 URI.
            code_challenge: PKCE code_challenge (S256 해시, 선택적).

        Returns:
            사용자를 리다이렉트해야 할 전체 인가 URL 문자열.
        """
        ...

    @abstractmethod
    async def exchange_code(
        self,
        code: str,
        redirect_uri: str,
        code_verifier: Optional[str] = None,
    ) -> dict:
        """인가 코드를 토큰 세트로 교환한다.

        Args:
            code: OAuth 인가 코드.
            redirect_uri: 인가 요청 시 사용한 redirect_uri.
            code_verifier: PKCE code_verifier (선택적).

        Returns:
            프로바이더 토큰 응답 (access_token, id_token, refresh_token 등).

        Raises:
            OAuthProviderError: 토큰 교환 실패 시.
        """
        ...

    @abstractmethod
    async def fetch_profile(self, token_set: dict) -> Optional[dict]:
        """프로바이더 API를 호출하여 사용자 프로필을 조회한다.

        OIDC 프로바이더(Google, Apple)는 id_token 디코딩으로 대체할 수 있다.

        Args:
            token_set: exchange_code()로 받은 토큰 세트.

        Returns:
            프로바이더 원본 프로필 딕셔너리 또는 None.

        Raises:
            OAuthProviderError: 프로필 조회 실패 시.
        """
        ...

    @abstractmethod
    async def normalize_profile(
        self,
        token_set: dict,
        profile: Optional[dict],
    ) -> NormalizedSocialProfile:
        """프로바이더별 프로필 응답을 공통 NormalizedSocialProfile로 변환한다.

        Args:
            token_set: exchange_code()로 받은 토큰 세트 (id_token 디코딩 용도).
            profile: fetch_profile()로 받은 원본 프로필.

        Returns:
            정규화된 소셜 프로필.
        """
        ...


# ── 프로바이더 레지스트리 ────────────────────────────────────────────

provider_registry: dict[str, SocialProviderAdapter] = {}
"""프로바이더 이름을 키로 하는 어댑터 인스턴스 레지스트리."""


def register_provider(adapter: SocialProviderAdapter) -> None:
    """프로바이더 어댑터를 레지스트리에 등록한다.

    Args:
        adapter: 등록할 프로바이더 어댑터 인스턴스.
    """
    provider_registry[adapter.provider_name] = adapter


def get_provider(name: str) -> SocialProviderAdapter:
    """이름으로 프로바이더 어댑터를 조회한다.

    Args:
        name: 프로바이더 식별 이름 (예: 'google', 'apple').

    Returns:
        해당 프로바이더의 어댑터 인스턴스.

    Raises:
        OAuthProviderError: 지원하지 않는 프로바이더인 경우.
    """
    adapter = provider_registry.get(name)
    if adapter is None:
        raise OAuthProviderError(
            detail=f"지원하지 않는 소셜 로그인 프로바이더입니다: {name}"
        )
    return adapter
