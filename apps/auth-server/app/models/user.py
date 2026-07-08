"""사용자 모델.

소셜 로그인으로 인증된 사용자의 기본 프로필 정보를 저장한다.
provider + provider_user_id 가 실제 고유 식별자이며,
이 모델은 여러 소셜 계정을 하나의 사용자로 통합하는 역할을 한다.
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class User(Base):
    """사용자 테이블.

    Attributes:
        id: UUID 기본키.
        status: 계정 상태 (active, suspended, deleted).
        display_name: 화면에 표시할 이름.
        primary_email: 대표 이메일(로그인 식별용이 아님).
        profile_image_url: 프로필 이미지 URL.
        created_at: 계정 생성 시각.
        updated_at: 마지막 수정 시각.
    """

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )
    status: Mapped[str] = mapped_column(
        String(20),
        default="active",
        nullable=False,
    )
    display_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    primary_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    profile_image_url: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(UTC),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )

    # ── 관계 ──────────────────────────────────────────────────────
    social_accounts: Mapped[list["SocialAccount"]] = relationship(
        "SocialAccount",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    auth_sessions: Mapped[list["AuthSession"]] = relationship(
        "AuthSession",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    # ── 인덱스 ────────────────────────────────────────────────────
    __table_args__ = (
        Index("ix_users_primary_email", "primary_email"),
    )

    def __repr__(self) -> str:
        return f"<User id={self.id} email={self.primary_email}>"
