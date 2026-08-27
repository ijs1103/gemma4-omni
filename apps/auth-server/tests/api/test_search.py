import pytest
import time
import uuid
from unittest.mock import patch, AsyncMock, MagicMock
from httpx import Response, ConnectError, HTTPStatusError, Request, AsyncClient, ASGITransport
from app.main import app
from app.api.v1.search import _rate_limit_store, _cleanup_rate_limit_store
from app.core.config import settings
from app.models.user import User
from app.db.session import async_session_factory
from app.services.auth.token_service import token_service

async def create_test_user() -> tuple[User, str]:
    async with async_session_factory() as db:
        user = User(
            display_name="Search Tester",
            primary_email=f"search_{uuid.uuid4().hex[:6]}@example.com",
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)

        access_token, _ = token_service.issue_pair(str(user.id), "test_search_sess", "google")
        return user, access_token

@pytest.fixture(autouse=True)
def clear_rate_limit_store():
    _rate_limit_store.clear()
    import app.api.v1.search as search_mod
    search_mod._last_cleanup_time = 0.0
    yield
    _rate_limit_store.clear()
    search_mod._last_cleanup_time = 0.0

@pytest.mark.asyncio
async def test_search_unauthenticated():
    """인증 토큰 없이 검색 시 401 반환 검증."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/v1/search?q=test")
        assert resp.status_code == 401

@pytest.mark.asyncio
async def test_search_validation_errors():
    """max_results 범위 검증 (ge=1, le=5) 및 q 유효성 검증."""
    _, token = await create_test_user()
    headers = {"Authorization": f"Bearer {token}"}
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # max_results < 1 -> 422
        resp0 = await client.get("/api/v1/search?q=test&max_results=0", headers=headers)
        assert resp0.status_code == 422

        # max_results > 5 -> 422
        resp6 = await client.get("/api/v1/search?q=test&max_results=6", headers=headers)
        assert resp6.status_code == 422

        # empty query -> 422
        resp_empty = await client.get("/api/v1/search?q=", headers=headers)
        assert resp_empty.status_code == 422

@pytest.mark.asyncio
async def test_search_success_with_mock():
    """SearXNG 성공 응답 모킹 및 스니펫 가공 검증."""
    _, token = await create_test_user()
    headers = {"Authorization": f"Bearer {token}"}

    mock_searx_data = {
        "results": [
            {
                "title": "테스트 제목 1",
                "content": "이것은 유효한 검색 결과 스니펫 1입니다.",
                "url": "https://example.com/1",
                "engine": "duckduckgo",
            },
            {
                "title": "빈 콘텐츠 제목",
                "content": "   ",  # 공백 -> 필터링되어야 함
                "url": "https://example.com/empty",
                "engine": "bing",
            },
            {
                "title": "테스트 제목 2",
                "content": "A" * 500,  # 300자 초과 -> truncate 되어야 함
                "url": "https://example.com/2",
                "engine": "bing",
            },
            {
                "title": "테스트 제목 3",
                "content": "세 번째 검색 결과 스니펫",
                "url": "https://example.com/3",
                "engine": "duckduckgo",
            },
            {
                "title": "테스트 제목 4 (초과분)",
                "content": "네 번째 스니펫은 max_results=2 슬라이스로 제외되어야 함",
                "url": "https://example.com/4",
                "engine": "duckduckgo",
            }
        ],
        "unresponsive_engines": []
    }

    mock_resp = Response(
        status_code=200,
        json=mock_searx_data,
        request=Request("GET", settings.SEARXNG_URL)
    )

    mock_http_client = AsyncMock()
    mock_http_client.get.return_value = mock_resp
    mock_http_client.__aenter__.return_value = mock_http_client
    mock_http_client.__aexit__.return_value = None

    with patch("app.api.v1.search.httpx.AsyncClient", return_value=mock_http_client):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/v1/search?q=한국어검색&max_results=2", headers=headers)
            assert resp.status_code == 200
            data = resp.json()
            assert data["query"] == "한국어검색"
            assert len(data["snippets"]) == 2
            # 첫 번째 스니펫
            assert data["snippets"][0]["title"] == "테스트 제목 1"
            assert data["snippets"][0]["content"] == "이것은 유효한 검색 결과 스니펫 1입니다."
            # 두 번째 스니펫 (빈 콘텐츠 항목은 건너뛰고 3번째 항목이 슬라이스됨)
            assert data["snippets"][1]["title"] == "테스트 제목 2"
            assert len(data["snippets"][1]["content"]) == 300  # 300자로 truncate

@pytest.mark.asyncio
async def test_search_rate_limit():
    """사용자당 분당 N회 제한 검증 (10회 성공, 11회 429)."""
    _, token = await create_test_user()
    headers = {"Authorization": f"Bearer {token}"}

    mock_resp = Response(
        status_code=200,
        json={"results": [{"title": "t", "content": "c", "url": "u", "engine": "bing"}]},
        request=Request("GET", settings.SEARXNG_URL)
    )

    mock_http_client = AsyncMock()
    mock_http_client.get.return_value = mock_resp
    mock_http_client.__aenter__.return_value = mock_http_client
    mock_http_client.__aexit__.return_value = None

    with patch("app.api.v1.search.httpx.AsyncClient", return_value=mock_http_client):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            for i in range(10):
                res = await client.get(f"/api/v1/search?q=test{i}", headers=headers)
                assert res.status_code == 200, f"Request {i+1} failed with status {res.status_code}"

            # 11번째 요청 -> 429
            res11 = await client.get("/api/v1/search?q=test11", headers=headers)
            assert res11.status_code == 429
            assert "너무 많습니다" in res11.json()["detail"]

@pytest.mark.asyncio
async def test_search_searxng_503_error():
    """SearXNG 연결 실패 시 503 반환 검증."""
    _, token = await create_test_user()
    headers = {"Authorization": f"Bearer {token}"}

    mock_http_client = AsyncMock()
    mock_http_client.get.side_effect = ConnectError("Connection refused")
    mock_http_client.__aenter__.return_value = mock_http_client
    mock_http_client.__aexit__.return_value = None

    with patch("app.api.v1.search.httpx.AsyncClient", return_value=mock_http_client):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/v1/search?q=test", headers=headers)
            assert resp.status_code == 503
            assert "연결할 수 없습니다" in resp.json()["detail"]

def test_cleanup_rate_limit_store():
    """5분 주기 Rate Limit 메모리 sweep 함수 검증."""
    import app.api.v1.search as search_mod
    now = time.time()
    search_mod._last_cleanup_time = now - 305  # 5분 이상 경과로 설정

    # 70초 전 타임스탬프 (만료됨)
    _rate_limit_store["user_old"] = [now - 70]
    # 10초 전 타임스탬프 (유효함)
    _rate_limit_store["user_active"] = [now - 10]

    # cleanup 실행 (현재 시점 now)
    _cleanup_rate_limit_store(now)

    assert "user_old" not in _rate_limit_store
    assert "user_active" in _rate_limit_store
    assert len(_rate_limit_store["user_active"]) == 1
