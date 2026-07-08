"""OAuth 자격증명 모델.

소셜 프로바이더에서 발급받은 액세스 토큰, 리프레시 토큰 등을
암호화하여 저장한다. SocialAccount와 1:1 관계이며,
social_account_id를 기본키이자 외래키로 사용한다.
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class OAuthCredential(Base):
    """OAuth 자격증명 테이블.

    Attributes:
        social_account_id: 소셜 계정 UUID (PK + FK).
        access_token_encrypted: 암호화된 프로바이더 액세스 토큰.
        refresh_token_encrypted: 암호화된 프로바이더 리프레시 토큰.
        id_token_encrypted: 암호화된 OIDC ID 토큰.
        token_type: 토큰 타입 (보통 'Bearer').
        scope: 부여된 OAuth 스코프.
        expires_at: 프로바이더 액세스 토큰 만료 시각.
        updated_at: 자격증명 마지막 갱신 시각.
    """

    __tablename__ = "oauth_credentials"

    social_account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("social_accounts.id", ondelete="CASCADE"),
        primary_key=True,
    )

    access_token_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    refresh_token_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    id_token_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    token_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    scope: Mapped[str | None] = mapped_column(Text, nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    updated_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )

    # ── 관계 ──────────────────────────────────────────────────────
    social_account: Mapped["SocialAccount"] = relationship(
        "SocialAccount",
        back_populates="credential",
    )

    def __repr__(self) -> str:
        return f"<OAuthCredential account_id={self.social_account_id}>"
