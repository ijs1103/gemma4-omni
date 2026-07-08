"""JWT 토큰 발급 및 검증 서비스.

내부 인증용 JWT 액세스 토큰 + 랜덤 리프레시 토큰 쌍을 관리한다.
app.core.security의 저수준 함수를 조합하여 비즈니스 로직 수준의 토큰 관리를 제공한다.
"""

from __future__ import annotations

import logging

import jwt as pyjwt

from app.core.config import settings
from app.core.exceptions import InvalidTokenError, TokenExpiredError
from app.core.security import create_access_token, create_refresh_token, decode_access_token

logger = logging.getLogger(__name__)


class TokenService:
    """JWT 액세스 토큰 + 리프레시 토큰 쌍의 발급 및 검증을 담당하는 서비스.

    - issue_pair: 새로운 토큰 쌍(access + refresh)을 생성한다.
    - verify_access_token: JWT 액세스 토큰을 디코딩하고 유효성을 검증한다.
    """

    def issue_pair(
        self,
        user_id: str,
        session_id: str,
        provider: str,
    ) -> tuple[str, str]:
        """JWT 액세스 토큰과 랜덤 리프레시 토큰 쌍을 생성한다.

        Args:
            user_id: 토큰의 sub 클레임에 담길 사용자 UUID 문자열.
            session_id: 현재 인증 세션 UUID 문자열.
            provider: 이번 인증에 사용된 OAuth 프로바이더 이름.

        Returns:
            (access_token, refresh_token) 튜플.
            access_token은 JWT 인코딩 문자열, refresh_token은 128자 hex 문자열.
        """
        access_token = create_access_token(
            subject=user_id,
            session_id=session_id,
            provider=provider,
        )
        refresh_token = create_refresh_token()

        logger.debug(
            "토큰 쌍 발급 완료: user_id=%s session_id=%s provider=%s",
            user_id,
            session_id,
            provider,
        )

        return access_token, refresh_token

    def verify_access_token(self, token: str) -> dict:
        """JWT 액세스 토큰을 디코딩하고 유효성을 검증한다.

        Args:
            token: 인코딩된 JWT 액세스 토큰 문자열.

        Returns:
            디코딩된 JWT payload 딕셔너리.
            포함 클레임: sub, sid, provider, iat, exp.

        Raises:
            TokenExpiredError: 토큰이 만료된 경우.
            InvalidTokenError: 토큰이 유효하지 않은 경우.
        """
        try:
            return decode_access_token(token)
        except pyjwt.ExpiredSignatureError:
            raise TokenExpiredError("액세스 토큰이 만료되었습니다.")
        except pyjwt.InvalidTokenError:
            raise InvalidTokenError("유효하지 않은 액세스 토큰입니다.")

    @staticmethod
    def get_access_token_ttl_seconds() -> int:
        """액세스 토큰의 유효 기간(초)을 반환한다."""
        return settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60


# ── 모듈 레벨 싱글턴 ────────────────────────────────────────────
token_service = TokenService()
