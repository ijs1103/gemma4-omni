"""검색/스크래핑 인메모리 5분 TTL 캐시 및 서킷 브레이커 (Circuit Breaker) 모듈."""

import asyncio
import logging
import time
from typing import Any, Callable, Coroutine, Optional, TypeVar

logger = logging.getLogger(__name__)

T = TypeVar("T")


class TTLCache:
    """지정된 TTL(초) 동안 유효한 인메모리 캐시."""

    def __init__(self, default_ttl: float = 300.0, max_size: int = 1000) -> None:
        self.default_ttl = default_ttl
        self.max_size = max_size
        self._cache: dict[str, tuple[float, Any]] = {}
        self._lock = asyncio.Lock()

    async def get(self, key: str) -> Optional[Any]:
        """캐시에서 키를 조회하며, 만료된 경우 삭제하고 None을 반환한다."""
        async with self._lock:
            if key not in self._cache:
                return None
            expiry, value = self._cache[key]
            if time.time() > expiry:
                del self._cache[key]
                return None
            return value

    async def set(self, key: str, value: Any, ttl: Optional[float] = None) -> None:
        """캐시에 값을 저장한다."""
        async with self._lock:
            # 캐시 크기 초과 시 가장 오래된 항목 정리
            if len(self._cache) >= self.max_size:
                now = time.time()
                expired_keys = [k for k, (exp, _) in self._cache.items() if now > exp]
                for k in expired_keys:
                    del self._cache[k]
                if len(self._cache) >= self.max_size:
                    oldest_key = next(iter(self._cache))
                    del self._cache[oldest_key]

            valid_ttl = ttl if ttl is not None else self.default_ttl
            self._cache[key] = (time.time() + valid_ttl, value)

    async def clear(self) -> None:
        """캐시를 비운다."""
        async with self._lock:
            self._cache.clear()


class CircuitBreaker:
    """외부 서비스/엔진 장애 전파를 방지하는 서킷 브레이커."""

    def __init__(
        self,
        name: str,
        failure_threshold: int = 3,
        recovery_timeout: float = 60.0,
    ) -> None:
        self.name = name
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.failure_count = 0
        self.last_failure_time = 0.0
        self.state: str = "CLOSED"  # CLOSED, OPEN, HALF_OPEN
        self._lock = asyncio.Lock()

    async def can_execute(self) -> bool:
        """현재 서킷 상태를 확인하여 호출 가능 여부를 판단한다."""
        async with self._lock:
            now = time.time()
            if self.state == "OPEN":
                if now - self.last_failure_time > self.recovery_timeout:
                    self.state = "HALF_OPEN"
                    logger.info("CircuitBreaker [%s] transitioned to HALF_OPEN", self.name)
                    return True
                return False
            return True

    async def record_success(self) -> None:
        """호출 성공 시 상태를 정상(CLOSED)으로 복구한다."""
        async with self._lock:
            self.failure_count = 0
            if self.state != "CLOSED":
                logger.info("CircuitBreaker [%s] restored to CLOSED", self.name)
            self.state = "CLOSED"

    async def record_failure(self) -> None:
        """호출 실패 시 실패 횟수를 누적하고 임계치 도달 시 서킷을 연다(OPEN)."""
        async with self._lock:
            self.failure_count += 1
            self.last_failure_time = time.time()
            if self.failure_count >= self.failure_threshold:
                self.state = "OPEN"
                logger.warning(
                    "CircuitBreaker [%s] OPENED (failures: %d >= %d, cooldown: %.1fs)",
                    self.name,
                    self.failure_count,
                    self.failure_threshold,
                    self.recovery_timeout,
                )


# 전역 인스턴스
search_cache = TTLCache(default_ttl=300.0)  # 5분 TTL
engine_breakers: dict[str, CircuitBreaker] = {
    "duckduckgo": CircuitBreaker("duckduckgo"),
    "bing": CircuitBreaker("bing"),
    "brave": CircuitBreaker("brave"),
    "qwant": CircuitBreaker("qwant"),
    "open_meteo": CircuitBreaker("open_meteo"),
    "frankfurter": CircuitBreaker("frankfurter"),
}
