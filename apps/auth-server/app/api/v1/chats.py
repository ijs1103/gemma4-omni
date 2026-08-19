import logging

from fastapi import APIRouter
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, SessionDep
from app.models.chat_session import ChatSession
from app.models.message import Message
from app.schemas.chat import (
    ChatSessionCreate,
    ChatSessionResponse,
    MessageCreate,
    MessageListResponse,
    MessageResponse,
    SyncPushRequest,
    SyncPushResponse,
)
from app.services.chat_service import chat_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chats", tags=["Chats"])


# ⚠️ /sync 라우트는 /{session_id} 패스 파라미터보다 먼저 등록해야
#    FastAPI가 "sync"를 session_id로 잘못 매칭하지 않음.

@router.post("/sync", response_model=SyncPushResponse)
async def sync_push(
    payload: SyncPushRequest, current_user: CurrentUser, db: SessionDep
):
    """전체 멱등 동기화 푸시.
    삭제된 세션은 skip (복원 차단).
    다른 세션 소속 메시지 ID 충돌은 skip.
    타임스탬프: 방어적 max() 전략.
    """
    result = await chat_service.sync_push(db, current_user.id, payload)
    await db.commit()
    return result


@router.get("", response_model=list[ChatSessionResponse])
async def list_sessions(current_user: CurrentUser, db: SessionDep):
    """로그인한 사용자의 활성 세션 목록 (deleted_at IS NULL)."""
    sessions = await chat_service.get_user_sessions(db, current_user.id)
    return [await _to_session_response(db, s) for s in sessions]


@router.post("", response_model=ChatSessionResponse, status_code=201)
async def create_session(
    payload: ChatSessionCreate, current_user: CurrentUser, db: SessionDep
):
    """새 세션 생성.
    같은 ID + 같은 사용자 + 활성 → 멱등 upsert.
    같은 ID + 다른 사용자 → 409 Conflict.
    같은 ID + 같은 사용자 + 삭제됨 → 410 Gone.
    """
    session = await chat_service.create_session(db, current_user.id, payload)
    await db.commit()
    return await _to_session_response(db, session)


@router.delete("/{session_id}", status_code=204)
async def delete_session(
    session_id: str, current_user: CurrentUser, db: SessionDep
):
    """소프트 삭제 (deleted_at 설정). 실제 row 삭제 없음."""
    await chat_service.soft_delete_session(db, session_id, current_user.id)
    await db.commit()


@router.get("/{session_id}/messages", response_model=MessageListResponse)
async def get_messages(
    session_id: str, current_user: CurrentUser, db: SessionDep
):
    """특정 세션의 메시지 목록. 소유권 검증 후 별도 쿼리."""
    messages = await chat_service.get_messages(db, session_id, current_user.id)
    return MessageListResponse(
        messages=[MessageResponse.model_validate(m) for m in messages]
    )


@router.post(
    "/{session_id}/messages", response_model=MessageResponse, status_code=201
)
async def add_message(
    session_id: str,
    payload: MessageCreate,
    current_user: CurrentUser,
    db: SessionDep,
):
    """메시지 추가 (멱등 + 소속 세션 검증).
    같은 ID + 같은 세션 → 기존 메시지 반환 (멱등).
    같은 ID + 다른 세션 → 409 Conflict (IDOR 방지).
    """
    msg = await chat_service.add_message(
        db, session_id, current_user.id, payload
    )
    await db.commit()
    return MessageResponse.model_validate(msg)


async def _to_session_response(
    db: AsyncSession, session: ChatSession
) -> ChatSessionResponse:
    """ChatSession → ChatSessionResponse 변환.
    메시지 카운트/프리뷰는 별도 경량 쿼리로 산출 (lazy="raise" 대응)."""
    count_stmt = select(func.count()).where(
        Message.chat_session_id == session.id
    )
    count_result = await db.execute(count_stmt)
    msg_count = count_result.scalar() or 0

    preview = ""
    if msg_count > 0:
        last_stmt = (
            select(Message.content)
            .where(Message.chat_session_id == session.id)
            .order_by(Message.created_at.desc())
            .limit(1)
        )
        last_result = await db.execute(last_stmt)
        last_content = last_result.scalar()
        if last_content:
            preview = last_content[:80]

    return ChatSessionResponse(
        id=session.id,
        title=session.title,
        model_id=session.model_id,
        status=session.status,
        message_count=msg_count,
        last_message_preview=preview,
        created_at=session.created_at,
        updated_at=session.updated_at,
    )
