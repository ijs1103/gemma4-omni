"""채팅 비즈니스 로직.

모든 메서드에서 소유권 검증을 수행하며,
클라이언트 생성 ID 충돌을 안전하게 처리한다.

멱등성 원칙:
  - 모든 쓰기 API는 같은 요청이 N번 반복되어도 결과가 동일하다.
  - 재시도(retryPendingSync)로 인한 중복 호출을 안전하게 흡수한다.

삭제 정합성 원칙:
  - 소프트 삭제된 세션은 create_session/sync_push로 자동 복원되지 않는다.
  - 명시적 복원 API(POST /restore)는 이번 스코프 밖이며 후속 작업으로 분리한다.

보안 원칙:
  - 세션 접근: get_session_with_ownership()으로 user_id 검증.
  - 메시지 멱등 반환: 기존 ID의 chat_session_id가 요청 세션과 일치하는지 검증.
    다른 세션 소속이면 409 → IDOR(다른 사용자 메시지 노출) 방지.
"""

from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.chat_session import ChatSession
from app.models.message import Message
from app.repositories.chat_repo import chat_repo
from app.schemas.chat import (
    ChatSessionCreate,
    MessageCreate,
    SyncPushRequest,
    SyncPushResponse,
)

UTC = timezone.utc


def _ensure_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


class ChatService:


    # ── 세션 CRUD ────────────────────────────────────────

    async def create_session(
        self, db: AsyncSession, user_id: UUID, payload: ChatSessionCreate
    ) -> ChatSession:
        """세션 생성 (ID 충돌 검증 + 삭제 세션 복원 차단).

        분기 로직:
        ┌─────────────────────────────────┬────────────────────────┐
        │ 조건                             │ 동작                    │
        ├─────────────────────────────────┼────────────────────────┤
        │ ID 미존재                        │ 새로 생성               │
        │ 존재 + 다른 사용자               │ 409 Conflict            │
        │ 존재 + 같은 사용자 + 삭제됨      │ 410 Gone (복원 차단)    │
        │ 존재 + 같은 사용자 + 활성        │ upsert (멱등)           │
        └─────────────────────────────────┴────────────────────────┘
        """
        existing = await chat_repo.get_session_by_id_any(db, payload.id)
        if existing:
            if existing.user_id != user_id:
                raise HTTPException(409, "세션 ID가 이미 다른 사용자에 의해 사용 중입니다.")
            if existing.deleted_at is not None:
                raise HTTPException(410, "이 세션은 삭제되어 더 이상 사용할 수 없습니다.")
            # 같은 사용자 + 활성 세션: 멱등 → title/model_id 업데이트
            existing.title = payload.title
            existing.model_id = payload.model_id
            await db.flush()
            return existing

        now = datetime.now(UTC)
        return await chat_repo.create_session(
            db,
            id=payload.id,
            user_id=user_id,
            title=payload.title,
            model_id=payload.model_id,
            status="active",
            created_at=payload.created_at or now,
            updated_at=payload.updated_at or now,
        )

    async def get_user_sessions(
        self, db: AsyncSession, user_id: UUID
    ) -> list[ChatSession]:
        """사용자의 활성 세션 목록 (deleted_at IS NULL)."""
        return await chat_repo.get_sessions_by_user(db, user_id)

    async def get_session_with_ownership(
        self, db: AsyncSession, session_id: str, user_id: UUID
    ) -> ChatSession:
        """세션 조회 + 소유권 검증.

        세션이 존재하지 않으면 404, 다른 사용자의 세션이면 403.
        메시지는 로드하지 않음 (lazy="raise").
        """
        session = await chat_repo.get_session_by_id(db, session_id)
        if not session:
            raise HTTPException(404, "세션을 찾을 수 없습니다.")
        if session.user_id != user_id:
            raise HTTPException(403, "이 세션에 접근할 권한이 없습니다.")
        return session

    async def soft_delete_session(
        self, db: AsyncSession, session_id: str, user_id: UUID
    ) -> None:
        """소프트 삭제 (deleted_at 설정). 실제 row 삭제 없음."""
        session = await self.get_session_with_ownership(db, session_id, user_id)
        await chat_repo.soft_delete_session(db, session)

    # ── 메시지 ───────────────────────────────────────────

    async def get_messages(
        self, db: AsyncSession, session_id: str, user_id: UUID
    ) -> list[Message]:
        """세션의 메시지 목록. 소유권 검증 후 별도 쿼리로 메시지 조회."""
        await self.get_session_with_ownership(db, session_id, user_id)
        return await chat_repo.get_messages_by_session(db, session_id)

    async def add_message(
        self, db: AsyncSession, session_id: str, user_id: UUID, payload: MessageCreate
    ) -> Message:
        """메시지 추가 (멱등 + 소속 세션 검증).

        같은 ID의 메시지가 이미 존재하면:
          - 그 메시지가 지금 요청한 session_id에 속하면 → 기존 메시지 그대로 반환 (멱등)
          - 다른 session_id에 속하면 → 409 Conflict (IDOR 방지)

        이것이 필요한 이유:
          retryPendingSync()가 메시지를 서버로 전송한 뒤
          응답 수신 전에 앱이 종료되면, 로컬의 syncStatus는
          여전히 'pending'으로 남는다. 다음 재시도 시 같은 메시지를
          다시 보내는데, 이때:
            - 같은 세션: 멱등 처리 → 성공 → 영구 정체 해소
            - 다른 세션: 409 → 클라이언트가 새 ID 생성으로 해결 가능

        보안:
          소속 세션을 검증하지 않으면, 공격자가 자신의 세션에 대해
          다른 사용자 세션 소속 메시지 ID를 추측하여 POST하면
          그 메시지 내용이 응답에 그대로 노출되는 IDOR 취약점이 됨.
        """
        session = await self.get_session_with_ownership(db, session_id, user_id)

        # 멱등 체크 + 소속 세션 검증
        existing_msg = await db.get(Message, payload.id)
        if existing_msg is not None:
            if existing_msg.chat_session_id != session_id:
                # 다른 세션 소속 ID와 충돌 — 그대로 반환하면 IDOR 취약점
                raise HTTPException(
                    409, "메시지 ID가 이미 다른 세션에서 사용 중입니다."
                )
            # 같은 세션: 정상 멱등
            return existing_msg

        now = datetime.now(UTC)
        msg = await chat_repo.create_message(
            db,
            id=payload.id,
            chat_session_id=session_id,
            role=payload.role,
            content=payload.content,
            created_at=payload.created_at or now,
        )
        session.updated_at = now
        await db.flush()
        return msg

    # ── 동기화 ───────────────────────────────────────────

    async def sync_push(
        self, db: AsyncSession, user_id: UUID, payload: SyncPushRequest
    ) -> SyncPushResponse:
        """전체 동기화 푸시 (멱등 upsert + 삭제 세션 복원 차단 + 메시지 소속 검증).

        세션 분기 로직:
        ┌─────────────────────────────────┬────────────────────────┐
        │ 조건                             │ 동작                    │
        ├─────────────────────────────────┼────────────────────────┤
        │ ID 미존재                        │ 새로 생성               │
        │ 존재 + 다른 사용자               │ skip (충돌)             │
        │ 존재 + 같은 사용자 + 삭제됨      │ skip (복원 차단)        │
        │ 존재 + 같은 사용자 + 활성        │ upsert                  │
        └─────────────────────────────────┴────────────────────────┘

        메시지 분기 로직 (upsert_message 반환값):
        ┌─────────────────────────────────┬────────────────────────┐
        │ 조건                             │ 동작                    │
        ├─────────────────────────────────┼────────────────────────┤
        │ ID 미존재                        │ 새로 생성 → synced      │
        │ 존재 + 같은 세션                 │ 무시 (정상 멱등) → synced│
        │ 존재 + 다른 세션                 │ 저장 안 함 → skipped    │
        └─────────────────────────────────┴────────────────────────┘

        타임스탬프 전략: 방어적 max()
          기기 시계가 서버와 어긋난 경우, 기존 서버값과 클라이언트값 중
          더 최근 시각을 채택하여 세션 목록 정렬 역전을 방지한다.
        """
        synced_sessions = 0
        synced_messages = 0
        skipped_sessions = 0
        skipped_messages = 0

        for s in payload.sessions:
            existing = await chat_repo.get_session_by_id_any(db, s.id)

            # 다른 사용자의 ID와 충돌 → skip
            if existing and existing.user_id != user_id:
                skipped_sessions += 1
                continue

            # 삭제된 세션 → 자동 복원하지 않고 skip
            if existing and existing.deleted_at is not None:
                skipped_sessions += 1
                continue

            if existing is None:
                # 새로 생성
                await chat_repo.create_session(
                    db,
                    id=s.id,
                    user_id=user_id,
                    title=s.title,
                    model_id=s.model_id,
                    status=s.status,
                    created_at=s.created_at,
                    updated_at=s.updated_at,
                )
            else:
                # 같은 사용자 + 활성 세션 → upsert
                existing.title = s.title
                # 방어적 max(): 기기 시계 오차에 의한 정렬 역전 방지
                existing.updated_at = max(_ensure_utc(existing.updated_at), _ensure_utc(s.updated_at))
                await db.flush()

            synced_sessions += 1

            for m in s.messages:
                ok = await chat_repo.upsert_message(
                    db,
                    id=m.id,
                    chat_session_id=s.id,
                    role=m.role,
                    content=m.content,
                    created_at=m.created_at,
                )
                if ok:
                    synced_messages += 1
                else:
                    skipped_messages += 1

        return SyncPushResponse(
            synced_sessions=synced_sessions,
            synced_messages=synced_messages,
            skipped_sessions=skipped_sessions,
            skipped_messages=skipped_messages,
        )


chat_service = ChatService()
