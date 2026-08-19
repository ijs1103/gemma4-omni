import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.services.auth.token_service import token_service
from app.models.user import User
from app.db.session import async_session_factory


async def create_test_user(display_name: str, email: str) -> tuple[User, str]:
    """테스트용 유저 생성 및 access_token 발급."""
    async with async_session_factory() as db:
        user = User(
            display_name=display_name,
            primary_email=email,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)

        access_token, _ = token_service.issue_pair(str(user.id), "test_session_id", "google")
        return user, access_token


import uuid

@pytest.mark.asyncio
async def test_chat_session_and_messages_lifecycle():
    user1, token1 = await create_test_user("Test User 1", f"user1_{uuid.uuid4().hex[:6]}@example.com")
    user2, token2 = await create_test_user("Test User 2", f"user2_{uuid.uuid4().hex[:6]}@example.com")

    headers1 = {"Authorization": f"Bearer {token1}"}
    headers2 = {"Authorization": f"Bearer {token2}"}

    session_id_1 = f"session-{uuid.uuid4()}"
    session_id_2 = f"session-{uuid.uuid4()}"
    msg_id_1 = f"msg-{uuid.uuid4()}"
    msg_id_2 = f"msg-{uuid.uuid4()}"

    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:

            # 1. POST /api/v1/chats - 세션 생성 (user1)
            res = await client.post(
                "/api/v1/chats",
                headers=headers1,
                json={"id": session_id_1, "title": "첫 대화", "model_id": "gemma4-e2b"},
            )
            assert res.status_code == 201
            data = res.json()
            assert data["id"] == session_id_1
            assert data["title"] == "첫 대화"

            # 2. POST /api/v1/chats - 멱등성 테스트 (같은 user1, 같은 session_id)
            res_idempotent = await client.post(
                "/api/v1/chats",
                headers=headers1,
                json={"id": session_id_1, "title": "수정된 제목", "model_id": "gemma4-e2b"},
            )
            assert res_idempotent.status_code == 201
            assert res_idempotent.json()["title"] == "수정된 제목"

            # 3. POST /api/v1/chats - ID 충돌 테스트 (다른 user2, 같은 session_id) -> 409
            res_conflict = await client.post(
                "/api/v1/chats",
                headers=headers2,
                json={"id": session_id_1, "title": "남의 세션", "model_id": "gemma4-e2b"},
            )
            assert res_conflict.status_code == 409

            # 4. POST /api/v1/chats/{session_id}/messages - 메시지 추가 (user1)
            res_msg = await client.post(
                f"/api/v1/chats/{session_id_1}/messages",
                headers=headers1,
                json={"id": msg_id_1, "role": "user", "content": "안녕하세요!"},
            )
            assert res_msg.status_code == 201
            assert res_msg.json()["content"] == "안녕하세요!"

            # 5. POST /api/v1/chats/{session_id}/messages - 메시지 멱등성 테스트 (같은 세션)
            res_msg_idem = await client.post(
                f"/api/v1/chats/{session_id_1}/messages",
                headers=headers1,
                json={"id": msg_id_1, "role": "user", "content": "안녕하세요!"},
            )
            assert res_msg_idem.status_code == 201
            assert res_msg_idem.json()["content"] == "안녕하세요!"

            # 6. 세션 2 생성 (user1)
            await client.post(
                "/api/v1/chats",
                headers=headers1,
                json={"id": session_id_2, "title": "두번째 대화", "model_id": "gemma4-e2b"},
            )

            # 7. POST /api/v1/chats/{session_id_2}/messages - IDOR 방지 테스트 (다른 세션에 msg_id_1 사용) -> 409
            res_idor = await client.post(
                f"/api/v1/chats/{session_id_2}/messages",
                headers=headers1,
                json={"id": msg_id_1, "role": "user", "content": "해킹 시도"},
            )
            assert res_idor.status_code == 409

            # 8. GET /api/v1/chats/{session_id_1}/messages - 메시지 목록 조회
            res_list_msg = await client.get(
                f"/api/v1/chats/{session_id_1}/messages",
                headers=headers1,
            )
            assert res_list_msg.status_code == 200
            msgs = res_list_msg.json()["messages"]
            assert len(msgs) == 1
            assert msgs[0]["id"] == msg_id_1

            # 9. GET /api/v1/chats - 세션 목록 조회
            res_sessions = await client.get("/api/v1/chats", headers=headers1)
            assert res_sessions.status_code == 200
            session_list = res_sessions.json()
            assert len(session_list) == 2

            # 10. DELETE /api/v1/chats/{session_id_1} - 소프트 삭제
            res_del = await client.delete(f"/api/v1/chats/{session_id_1}", headers=headers1)
            assert res_del.status_code == 204

            # 11. GET /api/v1/chats - 삭제 후 목록 조회 (session_id_1 제외되어 1개만 나와야 함)
            res_sessions_after = await client.get("/api/v1/chats", headers=headers1)
            assert res_sessions_after.status_code == 200
            session_list_after = res_sessions_after.json()
            assert len(session_list_after) == 1
            assert session_list_after[0]["id"] == session_id_2

            # 12. POST /api/v1/chats - 삭제된 세션 ID로 생성 재시도 -> 410 Gone (복원 차단)
            res_restore_blocked = await client.post(
                "/api/v1/chats",
                headers=headers1,
                json={"id": session_id_1, "title": "복원 시도"},
            )
            assert res_restore_blocked.status_code == 410

            # 13. POST /api/v1/chats/sync - 전체 멱등 동기화 테스트
            sync_payload = {
                "sessions": [
                    {
                        "id": session_id_1,  # 삭제된 세션 -> skip
                        "title": "삭제 세션 sync",
                        "model_id": "gemma4-e2b",
                        "status": "active",
                        "created_at": "2026-08-13T20:00:00Z",
                        "updated_at": "2026-08-13T20:00:00Z",
                        "messages": [],
                    },
                    {
                        "id": session_id_2,  # 활성 세션 -> update
                        "title": "두번째 대화 (동기화)",
                        "model_id": "gemma4-e2b",
                        "status": "active",
                        "created_at": "2026-08-13T20:00:00Z",
                        "updated_at": "2026-08-13T20:00:00Z",
                        "messages": [
                            {
                                "id": msg_id_2,
                                "role": "user",
                                "content": "동기화 메시지",
                                "created_at": "2026-08-13T20:00:00Z",
                            },
                            {
                                "id": msg_id_1,  # 다른 세션(session_id_1) 소속 메시지 ID -> skipped_messages
                                "role": "user",
                                "content": "충돌 메시지",
                                "created_at": "2026-08-13T20:00:00Z",
                            },
                        ],
                    },
                ]
            }
            res_sync = await client.post(
                "/api/v1/chats/sync",
                headers=headers1,
                json=sync_payload,
            )
            assert res_sync.status_code == 200
            sync_result = res_sync.json()
            assert sync_result["synced_sessions"] == 1
            assert sync_result["skipped_sessions"] == 1
            assert sync_result["synced_messages"] == 1
            assert sync_result["skipped_messages"] == 1

    finally:
        async with async_session_factory() as db:
            u1 = await db.get(User, user1.id)
            if u1:
                await db.delete(u1)
            u2 = await db.get(User, user2.id)
            if u2:
                await db.delete(u2)
            await db.commit()

