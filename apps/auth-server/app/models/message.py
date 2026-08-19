"""채팅 메시지 모델.

채팅 세션 내 개별 메시지를 저장한다.
클라이언트에서 생성한 UUID를 PK로 사용하여 멱등 처리를 지원한다.
"""

from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

UTC = timezone.utc


class Message(Base):
    """메시지 테이블.

    Attributes:
        id: 클라이언트 생성 UUID 문자열 (PK).
        chat_session_id: 소속 세션 ID (FK → chat_sessions.id).
        role: 메시지 역할 ('user' | 'assistant' | 'system').
        content: 메시지 본문.
        created_at: 메시지 생성 시각.
    """

    __tablename__ = "messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    chat_session_id: Mapped[str] = mapped_column(
        ForeignKey("chat_sessions.id", ondelete="CASCADE"),
        nullable=False,
    )
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )

    # ── 관계 ──────────────────────────────────────────────
    chat_session: Mapped["ChatSession"] = relationship(
        "ChatSession",
        back_populates="messages",
    )

    # ── 복합 인덱스 (세션별 시간순 조회 최적화) ──────────
    __table_args__ = (
        Index("ix_messages_session_created", "chat_session_id", "created_at"),
    )
