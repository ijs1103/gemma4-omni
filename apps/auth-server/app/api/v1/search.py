"""웹 검색 및 RAG 고도화 프록시 API — Vane 5단계 파이프라인 연동."""

import hashlib
import logging
import time
from collections import defaultdict
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Query, status

from app.api.deps import CurrentUser
from app.core.config import settings
from app.schemas.search import (
    QueryPlanResult,
    SearchResponse,
    SearchSnippet,
    SourceChunk,
    WidgetResult,
)
from app.services.search.cache import engine_breakers, search_cache
from app.services.search.instant_answers import InstantAnswerService
from app.services.search.query_planner import QueryPlanner
from app.services.search.reranker import Reranker
from app.services.search.scraper import scrape_urls_parallel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/search", tags=["Search"])

# ── 싱글톤 서비스 인스턴스 ───────────────────────────────────────────────────
query_planner = QueryPlanner()
instant_answer_service = InstantAnswerService()
reranker = Reranker()

# ── 인메모리 Rate Limit ───────────────────────────────────────────────────────
_rate_limit_store: dict[str, list[float]] = defaultdict(list)
_last_cleanup_time: float = 0.0
_CLEANUP_INTERVAL_SECONDS: float = 300.0


def _cleanup_rate_limit_store(now: float) -> None:
    global _last_cleanup_time
    if now - _last_cleanup_time < _CLEANUP_INTERVAL_SECONDS:
        return
    _last_cleanup_time = now
    window = 60.0
    expired_users = []
    for uid, timestamps in list(_rate_limit_store.items()):
        valid = [t for t in timestamps if now - t < window]
        if valid:
            _rate_limit_store[uid] = valid
        else:
            expired_users.append(uid)
    for uid in expired_users:
        _rate_limit_store.pop(uid, None)


def _check_rate_limit(user_id: str) -> None:
    now = time.time()
    _cleanup_rate_limit_store(now)
    window = 60.0
    max_requests = settings.SEARCH_RATE_LIMIT_PER_MINUTE
    _rate_limit_store[user_id] = [t for t in _rate_limit_store[user_id] if now - t < window]
    if len(_rate_limit_store[user_id]) >= max_requests:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"검색 요청이 너무 많습니다. {int(window)}초 후 다시 시도해주세요.",
        )
    _rate_limit_store[user_id].append(now)


def _is_junk_snippet(title: str, content: str) -> bool:
    t_lower = title.lower()
    c_lower = content.lower()
    junk_patterns = [
        "we would like to show you a description",
        "site won't allow us",
        "방문 중인 사이트에서 설명을 제공하지 않습니다",
        "sign in to your account",
        "outlook log in",
        "login.html",
        "how to pronounce",
        "cómo pronunciar",
        "wie man ausspricht",
    ]
    for pattern in junk_patterns:
        if pattern in t_lower or pattern in c_lower:
            return True
    return False


@router.get("", response_model=SearchResponse)
async def search_web(
    current_user: CurrentUser,
    q: str = Query(..., min_length=1, max_length=200, description="검색 쿼리"),
    max_results: int = Query(5, ge=1, le=5, description="최대 결과 수"),
    language: str = Query("ko-KR", description="검색 언어"),
) -> SearchResponse:
    """Vane 기반 5단계 웹 검색 및 RAG 고도화 파이프라인.

    1. TTL 5분 캐시 확인
    2. Query Planner: 질문 의도 분류 (날씨/환율/코인/증시/일반검색) 및 쿼리 재작성
    3. Instant Answer Layer: 날씨/환율/암호화폐/주가지수 즉답 위젯 생성
    4. SearXNG 멀티엔진 검색 및 CAPTCHA/차단 엔진 자동 격리
    5. 비동기 웹 스크래퍼 (SSRF 방어 + bleach 새니타이징) & Kiwi BM25 리랭킹 (Gemma SP 토큰 예산 관리)
    """
    _check_rate_limit(str(current_user.id))

    # ── 1. TTL 5분 캐시 확인 ───────────────────────────────────────────────
    cache_key = f"search:{hashlib.sha256(q.strip().lower().encode()).hexdigest()}"
    cached_response = await search_cache.get(cache_key)
    if cached_response and isinstance(cached_response, SearchResponse):
        logger.info("Serving search result from 5-min TTL cache for query=%r", q)
        return cached_response

    # ── 2. Query Planner 분석 ──────────────────────────────────────────────
    plan: QueryPlanResult = query_planner.plan(q)
    logger.info("QueryPlan for %r: intent=%s, rewritten=%r", q, plan.intent, plan.rewritten_query)

    # ── 3. Instant Answer Layer (즉답형 위젯 처리) ─────────────────────────
    if plan.need_instant_answer:
        widget: Optional[WidgetResult] = None
        source_url = "https://open-meteo.com"

        if plan.intent == "instant_weather":
            breaker = engine_breakers.get("open_meteo")
            if not breaker or await breaker.can_execute():
                widget = await instant_answer_service.get_weather(
                    lat=plan.entities.get("lat", 37.5665),
                    lon=plan.entities.get("lon", 126.9780),
                    location_name=plan.entities.get("location", "서울"),
                    timezone=plan.entities.get("timezone", "Asia/Seoul"),
                )
                if widget and breaker:
                    await breaker.record_success()
                elif breaker:
                    await breaker.record_failure()

        elif plan.intent == "instant_currency":
            source_url = "https://frankfurter.dev"
            breaker = engine_breakers.get("frankfurter")
            if not breaker or await breaker.can_execute():
                widget = await instant_answer_service.get_exchange_rate(
                    from_curr=plan.entities.get("from_currency", "USD"),
                    to_curr=plan.entities.get("to_currency", "KRW"),
                    amount=plan.entities.get("amount", 1.0),
                )
                if widget and breaker:
                    await breaker.record_success()
                elif breaker:
                    await breaker.record_failure()

        elif plan.intent == "instant_crypto":
            source_url = "https://www.coingecko.com"
            widget = await instant_answer_service.get_crypto_price(
                coin_ids=plan.entities.get("cryptos", ["bitcoin"])
            )

        elif plan.intent == "instant_stock":
            source_url = "https://finance.naver.com"
            widget = await instant_answer_service.get_stock_index(
                indices=plan.entities.get("stocks", ["KOSPI"])
            )

        elif plan.intent == "instant_finance_composite":
            source_url = "https://finance.naver.com"
            widget = await instant_answer_service.get_finance_composite(
                cryptos=plan.entities.get("cryptos", []),
                stocks=plan.entities.get("stocks", []),
            )

        if widget:
            instant_response = SearchResponse(
                query=q,
                intent=plan.intent,
                widget=widget,
                sources=[],
                snippets=[
                    SearchSnippet(
                        title=widget.title,
                        content=widget.summary_text,
                        url=source_url,
                    )
                ],
                compressed_context=widget.summary_text,
            )
            await search_cache.set(cache_key, instant_response)
            return instant_response

    # ── 4. SearXNG 멀티엔진 검색 & CAPTCHA/차단 엔진 자동 격리 ─────────────
    # 서킷 브레이커가 열려있지 않은 가용 엔진 목록 추출
    candidate_engines = ["duckduckgo", "bing", "brave", "qwant"]
    active_engines: list[str] = []
    for eng in candidate_engines:
        brk = engine_breakers.get(eng)
        if not brk or await brk.can_execute():
            active_engines.append(eng)

    if not active_engines:
        active_engines = ["duckduckgo", "bing"]  # 최소 기본 엔진 유지

    search_query = plan.rewritten_query or q
    searxng_params = {
        "q": search_query,
        "format": "json",
        "language": "all",  # SearXNG 엔진 언어 필터링 오작동 방지
        "categories": "general",
        "engines": ",".join(active_engines),
    }

    try:
        async with httpx.AsyncClient(timeout=settings.SEARXNG_TIMEOUT) as client:
            resp = await client.get(settings.SEARXNG_URL, params=searxng_params)
            resp.raise_for_status()
    except (httpx.ConnectError, httpx.TimeoutException) as exc:
        logger.error("SearXNG connection error: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="검색 서비스에 연결할 수 없습니다.",
        ) from exc
    except httpx.HTTPStatusError as exc:
        logger.error("SearXNG HTTP error %d: %s", exc.response.status_code, exc.response.text)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"검색 서비스 오류: {exc.response.status_code}",
        ) from exc

    data = resp.json()
    all_results = data.get("results", [])
    unresponsive = data.get("unresponsive_engines", [])

    # 비응답 엔진 서킷 브레이커 기록
    for eng_err in unresponsive:
        eng_name = eng_err[0] if isinstance(eng_err, list) and eng_err else str(eng_err)
        if eng_name in engine_breakers:
            await engine_breakers[eng_name].record_failure()

    # 정상 응답 엔진 서킷 브레이커 성공 기록
    responsive_engines = {r.get("engine") for r in all_results if r.get("engine")}
    for eng_name in responsive_engines:
        if eng_name in engine_breakers:
            await engine_breakers[eng_name].record_success()

    # 정크 스니펫 필터링 및 기본 스니펫 목록 구성
    valid_snippets = [
        SearchSnippet(
            title=r.get("title", "")[:200],
            content=r.get("content", "")[:300],
            url=r.get("url", ""),
        )
        for r in all_results
        if r.get("content")
        and r.get("content").strip()
        and not _is_junk_snippet(r.get("title", ""), r.get("content", ""))
    ]

    # ── 5. 비동기 웹 스크래핑 & Kiwi BM25 리랭킹 (Gemma SP 토큰 예산 관리) ──
    top_urls = [s.url for s in valid_snippets[:3]]
    scraped_map = await scrape_urls_parallel(top_urls, max_concurrency=3, timeout=3.5)

    # 스크래핑 성공 문서는 본문 사용, 실패 문서는 기존 검색 스니펫으로 그레이스풀 폴백
    docs_to_rerank: list[dict[str, str]] = []
    for snippet in valid_snippets[:max_results]:
        scraped_text = scraped_map.get(snippet.url)
        doc_text = scraped_text if scraped_text and len(scraped_text) > 100 else snippet.content
        docs_to_rerank.append({
            "url": snippet.url,
            "title": snippet.title,
            "text": doc_text,
        })

    selected_chunks, compressed_context = reranker.rerank(
        query=search_query,
        docs=docs_to_rerank,
        top_k=4,
        max_tokens=1600,
    )

    response = SearchResponse(
        query=q,
        intent=plan.intent,
        widget=None,
        sources=selected_chunks,
        snippets=valid_snippets[:max_results],
        compressed_context=compressed_context,
    )

    # 5분 TTL 캐시 저장
    await search_cache.set(cache_key, response)
    return response
