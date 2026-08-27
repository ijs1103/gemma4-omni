"""웹 검색 프록시 API — SearXNG 연동."""

import logging
import time
from collections import defaultdict

import httpx
from fastapi import APIRouter, HTTPException, Query, status

from app.api.deps import CurrentUser
from app.core.config import settings
from app.schemas.search import SearchResponse, SearchSnippet

import re

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/search", tags=["Search"])

# ── 인메모리 Rate Limit (단일 워커 전제 + 주기적 메모리 정리) ────────
_rate_limit_store: dict[str, list[float]] = defaultdict(list)
_last_cleanup_time: float = 0.0
_CLEANUP_INTERVAL_SECONDS: float = 300.0  # 5분마다 오래된 엔트리 전체 정리


def _clean_search_query(q: str) -> str:
    """대화체 질문에서 검색 엔진이 혼동하기 쉬운 종결어미 및 특수문자를 정제한다.

    예: '오늘 서울 날씨 어떄?' -> '오늘 서울 날씨'
        '2026년 인공지능 트렌드 알려줘!' -> '2026년 인공지능 트렌드'
    """
    cleaned = re.sub(r"[\?!\.,~]+$", "", q.strip())
    patterns = [
        r"\s*(?:어때|어떄|어떠니|어떨까|어떰|알려줘|알려줘요|알려주세요|알려줄래|알려주라|가르쳐줘|요약해줘|요약해줄래|설명해줘|설명해주세요|뭐야|뭐니|뭔지|알고\s*싶어|알고\s*싶어요|해줘|해줄래|해줘요|이야|인가요|인지)$",
        r"^(?:혹시|저기|그|음)\s+",
    ]
    for p in patterns:
        cleaned = re.sub(p, "", cleaned, flags=re.IGNORECASE).strip()
    return cleaned if cleaned else q.strip()


def _cleanup_rate_limit_store(now: float) -> None:
    """오래된 사용자의 타임스탬프 기록을 메모리에서 정리한다."""
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
    """사용자당 분당 요청 수를 제한한다.

    단일 프로세스(uvicorn 단일 워커)에서만 유효하다.
    멀티 워커/컨테이너 환경에서는 Redis 기반으로 전환해야 한다.
    """
    now = time.time()
    _cleanup_rate_limit_store(now)

    window = 60.0
    max_requests = settings.SEARCH_RATE_LIMIT_PER_MINUTE

    # 1분 이전 기록 정리
    _rate_limit_store[user_id] = [t for t in _rate_limit_store[user_id] if now - t < window]

    if len(_rate_limit_store[user_id]) >= max_requests:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"검색 요청이 너무 많습니다. {int(window)}초 후 다시 시도해주세요.",
        )
    _rate_limit_store[user_id].append(now)


def _is_junk_snippet(title: str, content: str) -> bool:
    """포털 로그인/접근 차단/발음 등 무의미한 스니펫 여부를 판별한다."""
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
    """SearXNG를 통해 웹 검색을 수행하고 스니펫을 반환한다.

    - 인증: Bearer JWT 필수 (CurrentUser)
    - Rate Limit: 사용자당 분당 N회 (settings.SEARCH_RATE_LIMIT_PER_MINUTE)
    - 스니펫 content: 300자 상한으로 truncate
    - categories=general 고정 (이미지/동영상 결과 제외)
    - content 필터링 후 max_results 슬라이스로 개수 보장
    - 전체 활성 엔진 비응답 시 WARNING 레벨 경고 로깅
    """
    _check_rate_limit(str(current_user.id))

    search_query = _clean_search_query(q)

    try:
        async with httpx.AsyncClient(timeout=settings.SEARXNG_TIMEOUT) as client:
            resp = await client.get(
                settings.SEARXNG_URL,
                params={
                    "q": search_query,
                    "format": "json",
                    "language": language,
                    "categories": "general",
                },
            )
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

    # 운영 모니터링용 엔진 응답 로깅 (2차원 리스트 구조 대응)
    responsive_engines = {r.get("engine") for r in all_results if r.get("engine")}
    unresponsive_engines = data.get("unresponsive_engines", [])
    logger.info(
        "SearXNG search: query=%r, total_results=%d, responsive_engines=%s, unresponsive_engines=%s",
        q,
        len(all_results),
        list(responsive_engines),
        unresponsive_engines,
    )

    # content가 유효하고 정크/로그인 페이지가 아닌 항목만 필터링한 뒤 max_results개 슬라이스
    valid_snippets = [
        SearchSnippet(
            title=r.get("title", "")[:200],
            content=r.get("content", "")[:300],  # 300자 상한
            url=r.get("url", ""),
        )
        for r in all_results
        if r.get("content")
        and r.get("content").strip()
        and not _is_junk_snippet(r.get("title", ""), r.get("content", ""))
    ]

    # ★ 전체 엔진 실패/결과 없음 시 ALERT 레벨 경고 로깅 (단일 장애점 대응)
    if not valid_snippets:
        logger.warning(
            "SearXNG [ALERT]: All active engines failed or returned empty results for query=%r. "
            "Responsive: %s, Unresponsive: %s",
            q,
            list(responsive_engines),
            unresponsive_engines,
        )

    return SearchResponse(query=q, snippets=valid_snippets[:max_results])
