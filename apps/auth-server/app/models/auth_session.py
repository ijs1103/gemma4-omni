"""인증 세션 모델.

사용자의 로그인 세션(리프레시 토큰)을 관리한다.
리프레시 토큰은 해시값만 저장하며, Refresh Token Rotation 패턴을 지원한다.
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class AuthSession(Base):
    """인증 세션 테이블.

    Attributes:
        id: UUID 기본키.
        user_id: 세션 소유 사용자의 UUID (FK).
        refresh_token_hash: SHA-256 해시된 리프레시 토큰.
        device_info: 클라이언트 디바이스 정보 (User-Agent 등).
        ip_address: 로그인 시 클라이언트 IP.
        is_revoked: 세션 폐기 여부.
        created_at: 세션 생성 시각.
        expires_at: 세션 만료 시각.
        last_used_at: 리프레시 토큰 마지막 사용 시각.
    """

    __tablename__ = "auth_sessions"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    refresh_token_hash: Mapped[str] = mapped_column(
        String(255),
        unique=True,
        nullable=False,
    )
    device_info: Mapped[str | None] = mapped_column(Text, nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    is_revoked: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
    )

    created_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(UTC),
        nullable=False,
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )
    last_used_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )

    # ── 관계 ──────────────────────────────────────────────────────
    user: Mapped["User"] = relationship(
        "User",
        back_populates="auth_sessions",
    )

    # ── 인덱스 ────────────────────────────────────────────────────
    __table_args__ = (
        Index("ix_auth_sessions_user_id", "user_id"),
        Index("ix_auth_sessions_refresh_token_hash", "refresh_token_hash", unique=True),
    )

    def __repr__(self) -> str:
        return f"<AuthSession id={self.id} user_id={self.user_id} revoked={self.is_revoked}>"
