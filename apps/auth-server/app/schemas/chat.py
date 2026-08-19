"""채팅 관련 Pydantic 요청/응답 스키마."""

from datetime import datetime
from pydantic import BaseModel, Field


# ── 세션 ─────────────────────────────────────────────────

class ChatSessionCreate(BaseModel):
    """세션 생성 요청."""
    id: str = Field(..., description="클라이언트 생성 UUID")
    title: str = Field(default="새 대화")
    model_id: str = Field(default="")
    created_at: datetime | None = None
    updated_at: datetime | None = None


class ChatSessionResponse(BaseModel):
    """세션 응답 (메시지 미포함 — 목록/생성 공용)."""
    id: str
    title: str
    model_id: str
    status: str
    message_count: int = 0
    last_message_preview: str = ""
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── 메시지 ───────────────────────────────────────────────

class MessageCreate(BaseModel):
    """메시지 생성 요청."""
    id: str = Field(..., description="클라이언트 생성 UUID")
    role: str = Field(..., description="user | assistant | system")
    content: str = Field(default="")
    created_at: datetime | None = None


class MessageResponse(BaseModel):
    """메시지 응답."""
    id: str
    chat_session_id: str
    role: str
    content: str
    created_at: datetime

    model_config = {"from_attributes": True}


class MessageListResponse(BaseModel):
    """메시지 목록 응답."""
    messages: list[MessageResponse]


# ── 동기화 ───────────────────────────────────────────────

class SyncMessagePayload(BaseModel):
    """동기화용 메시지 페이로드."""
    id: str
    role: str
    content: str
    created_at: datetime


class SyncSessionPayload(BaseModel):
    """동기화용 세션 + 메시지 일괄 페이로드."""
    id: str
    title: str
    model_id: str
    status: str = "active"
    created_at: datetime
    updated_at: datetime
    messages: list[SyncMessagePayload] = []


class SyncPushRequest(BaseModel):
    """전체 동기화 푸시 요청."""
    sessions: list[SyncSessionPayload]


class SyncPushResponse(BaseModel):
    """동기화 푸시 응답.

    Attributes:
        synced_sessions: 성공적으로 생성/업데이트된 세션 수.
        synced_messages: 성공적으로 생성/멱등 처리된 메시지 수.
        skipped_sessions: 건너뛴 세션 수 (다른 사용자 충돌 또는 삭제된 세션).
        skipped_messages: 건너뛴 메시지 수 (다른 세션 소속 ID 충돌).
    """
    synced_sessions: int
    synced_messages: int
    skipped_sessions: int = 0
    skipped_messages: int = 0
