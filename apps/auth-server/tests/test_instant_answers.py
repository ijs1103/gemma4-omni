import pytest
import pytest_asyncio
from app.services.search.instant_answers import InstantAnswerService

@pytest.mark.asyncio
async def test_instant_weather_open_meteo():
    service = InstantAnswerService()
    # 서울 좌표
    res = await service.get_weather(lat=37.5665, lon=126.9780, location_name="서울")
    assert res is not None
    assert res.type == "weather"
    assert "서울" in res.title
    assert "temperature" in res.data
    assert "현재 기온" in res.summary_text
    assert "Open-Meteo" in res.summary_text

@pytest.mark.asyncio
async def test_instant_currency_frankfurter():
    service = InstantAnswerService()
    res = await service.get_exchange_rate(from_curr="USD", to_curr="KRW", amount=100.0)
    assert res is not None
    assert res.type == "currency"
    assert "USD" in res.title
    assert "KRW" in res.title
    assert res.data["rate"] > 0
    assert "ECB" in res.summary_text
    assert "평일 1일 1회" in res.summary_text
