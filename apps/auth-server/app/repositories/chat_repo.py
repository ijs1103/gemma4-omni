"""채팅 세션/메시지 리포지토리.

chat_sessions, messages 테이블에 대한 비동기 CRUD 작업을 제공한다.
"""

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.chat_session import ChatSession
from app.models.message import Message

UTC = timezone.utc


class ChatRepository:
    """채팅 세션/메시지에 대한 데이터 액세스 메서드."""

    # ── 세션 조회 (메시지 로드 없음) ──────────────────────

    async def get_sessions_by_user(
        self, db: AsyncSession, user_id: UUID
    ) -> list[ChatSession]:
        """사용자의 활성 세션 목록 (deleted_at IS NULL, updated_at DESC).
        메시지는 로드하지 않음."""
        stmt = (
            select(ChatSession)
            .where(
                ChatSession.user_id == user_id,
                ChatSession.deleted_at.is_(None),
            )
            .order_by(ChatSession.updated_at.desc())
        )
        result = await db.execute(stmt)
        return list(result.scalars().all())

    async def get_session_by_id(
        self, db: AsyncSession, session_id: str
    ) -> ChatSession | None:
        """단일 세션 조회 (deleted_at IS NULL, 메시지 로드 없음)."""
        stmt = select(ChatSession).where(
            ChatSession.id == session_id,
            ChatSession.deleted_at.is_(None),
        )
        result = await db.execute(stmt)
        return result.scalar_one_or_none()

    async def get_session_by_id_any(
        self, db: AsyncSession, session_id: str
    ) -> ChatSession | None:
        """단일 세션 조회 (삭제 여부 무관 — ID 충돌 검증용, 메시지 로드 없음)."""
        stmt = select(ChatSession).where(ChatSession.id == session_id)
        result = await db.execute(stmt)
        return result.scalar_one_or_none()

    # ── 세션 CUD ─────────────────────────────────────────

    async def create_session(
        self, db: AsyncSession, *, id: str, user_id: UUID,
        title: str, model_id: str, status: str,
        created_at: datetime, updated_at: datetime,
    ) -> ChatSession:
        """새 세션 생성."""
        session = ChatSession(
            id=id, user_id=user_id, title=title, model_id=model_id,
            status=status, created_at=created_at, updated_at=updated_at,
        )
        db.add(session)
        await db.flush()
        return session

    async def soft_delete_session(
        self, db: AsyncSession, session: ChatSession
    ) -> None:
        """소프트 삭제 (deleted_at 타임스탬프 설정)."""
        session.deleted_at = datetime.now(UTC)
        await db.flush()

    # ── 메시지 조회/CUD ──────────────────────────────────

    async def get_messages_by_session(
        self, db: AsyncSession, session_id: str
    ) -> list[Message]:
        """세션의 메시지 목록 (created_at ASC — 복합 인덱스 ix_messages_session_created 활용)."""
        stmt = (
            select(Message)
            .where(Message.chat_session_id == session_id)
            .order_by(Message.created_at.asc())
        )
        result = await db.execute(stmt)
        return list(result.scalars().all())

    async def create_message(
        self, db: AsyncSession, *, id: str, chat_session_id: str,
        role: str, content: str, created_at: datetime,
    ) -> Message:
        """메시지 생성 (PK 중복 시 DB 에러 발생 — 호출자가 사전 검증 필요)."""
        msg = Message(
            id=id, chat_session_id=chat_session_id,
            role=role, content=content, created_at=created_at,
        )
        db.add(msg)
        await db.flush()
        return msg

    async def upsert_message(
        self, db: AsyncSession, *, id: str, chat_session_id: str,
        role: str, content: str, created_at: datetime,
    ) -> bool:
        """메시지 멱등 upsert (소속 세션 검증 포함).

        INSERT ... ON CONFLICT(id) DO NOTHING 동등 동작이되,
        이미 존재하는 메시지가 다른 세션에 소속된 경우를 구분하여
        호출자(서비스 계층)가 판단할 수 있도록 결과를 반환한다.

        Returns:
            True:  새로 생성됨 또는 같은 세션에 이미 존재 (정상 멱등).
            False: 다른 세션 소속 ID와 충돌 — 저장하지 않음.
        """
        existing = await db.get(Message, id)
        if existing is None:
            msg = Message(
                id=id, chat_session_id=chat_session_id,
                role=role, content=content, created_at=created_at,
            )
            db.add(msg)
            await db.flush()
            return True

        # 소속 세션 검증: 같은 세션이면 정상 멱등, 다른 세션이면 충돌
        if existing.chat_session_id != chat_session_id:
            return False

        return True


chat_repo = ChatRepository()
"""모듈 레벨 싱글턴 인스턴스."""
