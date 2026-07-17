"""보안 유틸리티 모듈.

JWT 액세스 토큰 생성/검증, 리프레시 토큰 생성, 토큰 해싱 등
인증 흐름에서 사용되는 암호화 관련 헬퍼 함수를 제공한다.
"""

from typing import Optional
import hashlib
import secrets
from datetime import datetime, timezone, timedelta
UTC = timezone.utc

import jwt

from app.core.config import settings


def create_access_token(
    subject: str,
    session_id: str,
    provider: str,
    expires_delta: Optional[timedelta] = None,
) -> str:
    """JWT 액세스 토큰을 생성한다.

    Args:
        subject: 토큰의 sub 클레임에 담길 사용자 식별자(보통 user_id).
        session_id: 현재 인증 세션 ID.
        provider: OAuth 프로바이더 이름(google, apple 등).
        expires_delta: 만료 시간 간격. None이면 설정값 사용.

    Returns:
        인코딩된 JWT 문자열.
    """
    now = datetime.now(UTC)
    if expires_delta is None:
        expires_delta = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)

    payload = {
        "sub": subject,
        "sid": session_id,
        "provider": provider,
        "iat": now,
        "exp": now + expires_delta,
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def create_refresh_token() -> str:
    """랜덤 리프레시 토큰을 생성한다.

    Returns:
        64바이트 길이의 hex 문자열(128자).
    """
    return secrets.token_hex(64)


def decode_access_token(token: str) -> dict:
    """JWT 액세스 토큰을 디코딩하고 검증한다.

    Args:
        token: 인코딩된 JWT 문자열.

    Returns:
        디코딩된 payload 딕셔너리.

    Raises:
        jwt.ExpiredSignatureError: 토큰이 만료된 경우.
        jwt.InvalidTokenError: 토큰이 유효하지 않은 경우.
    """
    return jwt.decode(
        token,
        settings.JWT_SECRET_KEY,
        algorithms=[settings.JWT_ALGORITHM],
    )


def hash_token(token: str) -> str:
    """토큰을 SHA-256으로 해싱한다.

    리프레시 토큰을 DB에 저장할 때 원문 대신 해시값을 저장하기 위해 사용한다.

    Args:
        token: 해싱할 토큰 문자열.

    Returns:
        SHA-256 hex digest 문자열.
    """
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def verify_token_hash(token: str, token_hash: str) -> bool:
    """토큰의 해시가 저장된 해시와 일치하는지 검증한다.

    timing-safe 비교를 사용하여 타이밍 공격을 방지한다.

    Args:
        token: 검증할 원본 토큰 문자열.
        token_hash: DB에 저장된 해시값.

    Returns:
        일치하면 True, 아니면 False.
    """
    return secrets.compare_digest(hash_token(token), token_hash)
