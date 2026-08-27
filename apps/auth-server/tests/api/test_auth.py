import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from app.main import app

@pytest_asyncio.fixture
async def client():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        yield ac

@pytest.mark.asyncio
async def test_start_login(client: AsyncClient):
    response = await client.get("/api/v1/auth/social/google/start?redirect_uri=http://localhost:5173/auth/callback&platform=web")
    assert response.status_code == 200
    data = response.json()
    assert "authorize_url" in data
    assert "accounts.google.com" in data["authorize_url"] or "google" in data["authorize_url"]

@pytest.mark.asyncio
async def test_get_me_unauthorized(client: AsyncClient):
    response = await client.get("/api/v1/auth/me")
    assert response.status_code == 401

@pytest.mark.asyncio
async def test_logout_without_token(client: AsyncClient):
    response = await client.post("/api/v1/auth/logout")
    assert response.status_code == 401

@pytest.mark.asyncio
async def test_refresh_empty_body_no_token(client: AsyncClient):
    """리프레시 토큰 없이 빈 body만 보냈을 때 422가 아니라 401을 반환하는지 검증."""
    response = await client.post("/api/v1/auth/refresh", json={})
    assert response.status_code == 401
