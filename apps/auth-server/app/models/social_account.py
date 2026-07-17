"""소셜 계정 모델.

사용자가 연결한 소셜 로그인 프로바이더 정보를 저장한다.
(provider, provider_user_id) 복합 유니크 제약조건으로
동일 프로바이더의 같은 사용자가 중복 등록되지 않도록 보장한다.
"""

from typing import Optional
import uuid
from datetime import datetime, timezone
UTC = timezone.utc

from sqlalchemy import Boolean, ForeignKey, Index, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class SocialAccount(Base):
    """소셜 계정 테이블.

    Attributes:
        id: UUID 기본키.
        user_id: 연결된 사용자의 UUID (FK).
        provider: OAuth 프로바이더 이름 (google, apple, naver, kakao).
        provider_user_id: 프로바이더에서 부여한 사용자 고유 식별자.
        provider_email: 프로바이더에서 제공한 이메일.
        email_verified: 프로바이더가 확인한 이메일 인증 여부.
        raw_profile: 프로바이더에서 받은 원본 프로필 JSON.
        linked_at: 소셜 계정이 연결된 시각.
    """

    __tablename__ = "social_accounts"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    provider: Mapped[str] = mapped_column(String(20), nullable=False)
    provider_user_id: Mapped[str] = mapped_column(String(255), nullable=False)
    provider_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    email_verified: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    raw_profile: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)

    linked_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(UTC),
        nullable=False,
    )

    # ── 관계 ──────────────────────────────────────────────────────
    user: Mapped["User"] = relationship(
        "User",
        back_populates="social_accounts",
    )
    credential: Mapped[Optional["OAuthCredential"]] = relationship(
        "OAuthCredential",
        back_populates="social_account",
        uselist=False,
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    # ── 제약조건 & 인덱스 ─────────────────────────────────────────
    __table_args__ = (
        UniqueConstraint("provider", "provider_user_id", name="uq_provider_user"),
        Index("ix_social_accounts_user_id", "user_id"),
        Index("ix_social_accounts_provider", "provider"),
        Index("ix_social_accounts_provider_user_id", "provider_user_id"),
    )

    def __repr__(self) -> str:
        return f"<SocialAccount provider={self.provider} pid={self.provider_user_id}>"
