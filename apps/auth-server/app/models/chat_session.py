"""채팅 세션 모델.

사용자의 대화방 정보를 저장한다. 삭제 시 소프트 삭제(deleted_at)를 사용하여
다른 기기에서의 자연스러운 동기화와 실수 삭제 복구를 지원한다.
"""

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import ForeignKey, Index, String, Text, DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

UTC = timezone.utc


class ChatSession(Base):
    """채팅 세션 테이블.

    Attributes:
        id: 클라이언트 생성 UUID 문자열 (PK).
        user_id: 세션 소유 사용자의 UUID (FK → users.id).
        title: 대화 제목.
        model_id: 사용된 AI 모델 ID (예: 'gemma4-e2b').
        status: 세션 상태 ('active' | 'archived').
        created_at: 세션 생성 시각.
        updated_at: 마지막 수정 시각.
        deleted_at: 소프트 삭제 시각 (NULL이면 활성).
    """

    __tablename__ = "chat_sessions"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False, default="새 대화")
    model_id: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )
    deleted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        default=None,
    )

    # ── 관계 ──────────────────────────────────────────────
    # lazy="raise": 기본적으로 메시지를 로드하지 않음.
    # 메시지가 필요한 조회 경로에서만 .options(selectinload(...))을 명시적으로 적용.
    # → 소유권 검증, 소프트 삭제 등에서 불필요한 메시지 조회 비용 제거.
    messages: Mapped[list["Message"]] = relationship(
        "Message",
        back_populates="chat_session",
        cascade="all, delete-orphan",
        lazy="raise",
        order_by="Message.created_at",
    )

    # ── 인덱스 ────────────────────────────────────────────
    __table_args__ = (
        Index("ix_chat_sessions_user_updated", "user_id", "updated_at"),
        Index("ix_chat_sessions_deleted", "deleted_at"),
    )
