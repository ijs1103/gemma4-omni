"""애플리케이션 설정 모듈.

pydantic-settings를 사용하여 환경 변수와 .env 파일에서 설정을 로드한다.
모든 OAuth 프로바이더(Google, Apple, Naver, Kakao)의 클라이언트 자격증명과
JWT, DB, Redis 등 핵심 인프라 설정을 관리한다.
"""

import secrets

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """전체 애플리케이션 설정.

    환경 변수 또는 프로젝트 루트의 .env 파일에서 값을 읽어온다.
    개발 환경에서는 기본값만으로도 서버를 구동할 수 있도록 설계되었다.
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # ── 데이터베이스 ──────────────────────────────────────────────
    DATABASE_URL: str = "sqlite+aiosqlite:///./dev.db"

    # ── Redis ─────────────────────────────────────────────────────
    REDIS_URL: str = "redis://localhost:6379/0"

    # ── JWT ───────────────────────────────────────────────────────
    JWT_SECRET_KEY: str = Field(default_factory=lambda: secrets.token_hex(32))
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 14

    # ── CORS ──────────────────────────────────────────────────────
    CORS_ORIGINS: list[str] = [
        "http://localhost:3000",
        "http://localhost:5173",
    ]

    # ── OAuth 공통 ────────────────────────────────────────────────
    OAUTH_STATE_TTL_SECONDS: int = 300
    ALLOWED_REDIRECT_URIS: list[str] = [
        "http://localhost:3000/auth/callback",
        "http://localhost:5173/auth/callback",
    ]

    # ── Google OAuth ──────────────────────────────────────────────
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""

    # ── Apple OAuth ───────────────────────────────────────────────
    APPLE_CLIENT_ID: str = ""
    APPLE_TEAM_ID: str = ""
    APPLE_KEY_ID: str = ""
    APPLE_PRIVATE_KEY: str = ""

    # ── Naver OAuth ───────────────────────────────────────────────
    NAVER_CLIENT_ID: str = ""
    NAVER_CLIENT_SECRET: str = ""

    # ── Kakao OAuth ───────────────────────────────────────────────
    KAKAO_CLIENT_ID: str = ""
    KAKAO_CLIENT_SECRET: str = ""


settings = Settings()
