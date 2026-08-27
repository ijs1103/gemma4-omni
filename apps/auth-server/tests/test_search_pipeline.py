import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, patch, MagicMock
from app.services.search.cache import TTLCache, CircuitBreaker
from app.services.search.query_planner import QueryPlanner
from app.services.search.instant_answers import InstantAnswerService
from app.services.search.reranker import Reranker
from app.schemas.search import SearchResponse, SearchSnippet

@pytest.mark.asyncio
async def test_ttl_cache_expiration():
    cache = TTLCache(default_ttl=0.1)
    await cache.set("test_key", "test_val")
    val = await cache.get("test_key")
    assert val == "test_val"
    
    import asyncio
    await asyncio.sleep(0.15)
    val_after = await cache.get("test_key")
    assert val_after is None

@pytest.mark.asyncio
async def test_circuit_breaker_transition():
    cb = CircuitBreaker("test_engine", failure_threshold=2, recovery_timeout=0.2)
    assert await cb.can_execute() is True
    
    # 1회 실패
    await cb.record_failure()
    assert cb.state == "CLOSED"
    assert await cb.can_execute() is True
    
    # 2회 실패 -> OPEN
    await cb.record_failure()
    assert cb.state == "OPEN"
    assert await cb.can_execute() is False
    
    # recovery_timeout 경과 후 HALF_OPEN
    import asyncio
    await asyncio.sleep(0.25)
    assert await cb.can_execute() is True
    assert cb.state == "HALF_OPEN"
    
    # 성공 기록 -> CLOSED
    await cb.record_success()
    assert cb.state == "CLOSED"

@pytest.mark.asyncio
async def test_instant_weather_pipeline():
    planner = QueryPlanner()
    plan = planner.plan("오늘 서울 날씨 어때?")
    assert plan.intent == "instant_weather"
    assert plan.need_instant_answer is True
    
    service = InstantAnswerService()
    widget = await service.get_weather(
        lat=plan.entities["lat"],
        lon=plan.entities["lon"],
        location_name=plan.entities["location"],
    )
    assert widget is not None
    assert widget.type == "weather"
    assert "서울" in widget.title
    assert "현재 기온" in widget.summary_text

@pytest.mark.asyncio
async def test_instant_currency_pipeline():
    planner = QueryPlanner()
    plan = planner.plan("지금 달러 환율 얼마야?")
    assert plan.intent == "instant_currency"
    assert plan.need_instant_answer is True
    
    service = InstantAnswerService()
    widget = await service.get_exchange_rate(
        from_curr=plan.entities["from_currency"],
        to_curr=plan.entities["to_currency"],
        amount=plan.entities["amount"],
    )
    assert widget is not None
    assert widget.type == "currency"
    assert widget.data["rate"] > 0
    assert "ECB" in widget.summary_text
    assert "평일 1일 1회" in widget.summary_text
