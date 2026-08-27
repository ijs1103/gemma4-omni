import pytest
from app.services.search.query_planner import QueryPlanner

def test_query_planner_weather_intent():
    planner = QueryPlanner()
    
    # 1. 서울 날씨
    res1 = planner.plan("오늘 서울 날씨 어때?")
    assert res1.intent == "instant_weather"
    assert res1.need_instant_answer is True
    assert res1.entities["location"] == "서울"
    assert "서울" in res1.rewritten_query

    # 2. 도쿄 내일 날씨
    res2 = planner.plan("내일 도쿄 날씨 알려줘!")
    assert res2.intent == "instant_weather"
    assert res2.entities["location"] == "도쿄"
    assert "도쿄" in res2.rewritten_query

    # 3. 제주도 기온
    res3 = planner.plan("제주도 현재 기온 뭐야")
    assert res3.intent == "instant_weather"
    assert res3.entities["location"] == "제주도" or res3.entities["location"] == "제주"

def test_query_planner_currency_intent():
    planner = QueryPlanner()
    
    # 1. 달러 환율
    res1 = planner.plan("지금 100달러 환율 얼마야?")
    assert res1.intent == "instant_currency"
    assert res1.need_instant_answer is True
    assert res1.entities["from_currency"] == "USD"
    assert res1.entities["to_currency"] == "KRW"
    assert res1.entities["amount"] == 100.0

    # 2. 엔화 환율
    res2 = planner.plan("일본 엔화 환율 알려줘")
    assert res2.intent == "instant_currency"
    assert res2.entities["from_currency"] == "JPY"
    assert res2.entities["to_currency"] == "KRW"

def test_query_planner_web_search_intent():
    planner = QueryPlanner()
    
    res = planner.plan("2026년 인공지능 트렌드 요약해줘")
    assert res.intent == "web_search"
    assert res.need_instant_answer is False
    assert res.need_scrape is True
    assert res.rewritten_query == "2026년 인공지능 트렌드"
