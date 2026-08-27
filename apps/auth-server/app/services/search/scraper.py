"""비동기 웹 스크래퍼 — SSRF 방어, bleach 새니타이징 및 trafilatura 기반 본문 추출."""

import asyncio
import ipaddress
import logging
import re
import socket
from typing import Optional
from urllib.parse import urlparse
import bleach
import httpx
import trafilatura

logger = logging.getLogger(__name__)

# ── SSRF 방어를 위한 차단 대상 사설 및 예약 IP 대역 ───────────────────────────
BLOCKED_IP_NETWORKS = [
    ipaddress.ip_network("0.0.0.0/8"),         # Current network
    ipaddress.ip_network("10.0.0.0/8"),        # Private Class A
    ipaddress.ip_network("100.64.0.0/10"),     # Carrier-grade NAT
    ipaddress.ip_network("127.0.0.0/8"),       # Loopback
    ipaddress.ip_network("169.254.0.0/16"),    # Link-local
    ipaddress.ip_network("172.16.0.0/12"),     # Private Class B
    ipaddress.ip_network("192.0.0.0/24"),      # IETF Protocol Assignments
    ipaddress.ip_network("192.0.2.0/24"),      # TEST-NET-1
    ipaddress.ip_network("192.88.99.0/24"),    # 6to4 Relay Anycast
    ipaddress.ip_network("192.168.0.0/16"),    # Private Class C
    ipaddress.ip_network("198.18.0.0/15"),     # Network Interconnect Device Benchmark
    ipaddress.ip_network("198.51.100.0/24"),   # TEST-NET-2
    ipaddress.ip_network("203.0.113.0/24"),    # TEST-NET-3
    ipaddress.ip_network("224.0.0.0/4"),       # Multicast
    ipaddress.ip_network("240.0.0.0/4"),       # Reserved for Future Use
    ipaddress.ip_network("255.255.255.255/32"),# Broadcast
    # IPv6
    ipaddress.ip_network("::1/128"),           # IPv6 Loopback
    ipaddress.ip_network("fc00::/7"),          # IPv6 Unique Local
    ipaddress.ip_network("fe80::/10"),         # IPv6 Link-Local
]

MAX_CONTENT_BYTES = 2 * 1024 * 1024  # 2MB 상한
DEFAULT_USER_AGENT = "gemma4-omni-bot/1.0 (+https://github.com/ijs1103/gemma4-omni)"


def is_safe_url(url: str) -> bool:
    """SSRF 공격 방지를 위해 URL의 프로토콜 및 호스트 IP를 사전 검증한다."""
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return False

        hostname = parsed.hostname
        if not hostname:
            return False

        if hostname.lower() in ("localhost", "127.0.0.1", "::1", "0.0.0.0"):
            return False

        # DNS 해석을 통해 실제 연결될 모든 대상 IP 검증
        addr_info = socket.getaddrinfo(hostname, None, proto=socket.IPPROTO_TCP)
        if not addr_info:
            return False

        for item in addr_info:
            ip_str = item[4][0]
            ip_obj = ipaddress.ip_address(ip_str)

            for blocked_net in BLOCKED_IP_NETWORKS:
                if ip_obj in blocked_net:
                    logger.warning("SSRF blocked: %s resolved to private/blocked IP %s", url, ip_str)
                    return False

        return True
    except Exception as e:
        logger.debug("is_safe_url validation failed for %s: %s", url, e)
        return False


def sanitize_scraped_text(raw_text: str) -> str:
    """HTML 악성 태그(bleach) 및 프롬프트 인젝션 패턴을 정제한다."""
    if not raw_text:
        return ""

    # 1. bleach를 통한 모든 잔존 HTML 태그 및 인라인 스크립트 제거
    cleaned = bleach.clean(raw_text, tags=[], strip=True)

    # 2. 영어 및 한국어 대표 프롬프트 인젝션 패턴 무력화
    injection_patterns = [
        r"(?:ignore\s+(?:all\s+)?(?:previous|above|prior)\s+instructions?|you\s+are\s+now|system\s*:|###\s*instruction|<\|(?:system|user|assistant)\|>)",
        r"(?:이전\s*(?:모든\s*)?지시(?:사항)?(?:를|은)?\s*무시|너는\s*이제(?:부터)?|시스템\s*:|지시사항\s*무시|역할\s*변경)",
    ]
    for pattern in injection_patterns:
        cleaned = re.sub(pattern, "[FILTERED]", cleaned, flags=re.IGNORECASE)

    # 3. 연속 공백 및 줄바꿈 정리
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


async def scrape_url(url: str, timeout: float = 3.0) -> Optional[str]:
    """단일 URL의 본문 텍스트를 비동기로 안전하게 스크래핑한다."""
    if not is_safe_url(url):
        return None

    current_url = url
    max_redirects = 3

    for _ in range(max_redirects + 1):
        if not is_safe_url(current_url):
            return None

        try:
            async with httpx.AsyncClient(
                timeout=timeout,
                follow_redirects=False,
                headers={"User-Agent": DEFAULT_USER_AGENT},
            ) as client:
                res = await client.get(current_url)

                if res.is_redirect:
                    location = res.headers.get("Location")
                    if not location:
                        return None
                    current_url = urlparse(current_url)._replace(path=location).geturl() if location.startswith("/") else location
                    continue

                if not res.is_success:
                    return None

                content_type = res.headers.get("content-type", "").lower()
                if "text/html" not in content_type and "text/plain" not in content_type:
                    return None

                if len(res.content) > MAX_CONTENT_BYTES:
                    logger.info("Scraped content exceeded size limit (%d bytes): %s", len(res.content), current_url)
                    return None

                # trafilatura로 본문 기사 추출
                extracted_text = trafilatura.extract(
                    res.text,
                    include_tables=False,
                    favor_precision=True,
                    no_fallback=False,
                )

                if not extracted_text or len(extracted_text.strip()) < 50:
                    return None

                return sanitize_scraped_text(extracted_text)

        except (httpx.TimeoutException, httpx.ConnectError, Exception) as e:
            logger.debug("Scraping failed for %s: %s", current_url, e)
            return None

    return None


async def scrape_urls_parallel(
    urls: list[str],
    max_concurrency: int = 3,
    timeout: float = 3.5,
) -> dict[str, str]:
    """상위 URL 목록을 병렬로 스크래핑하여 {url: 본문} 사전을 반환한다."""
    target_urls = urls[:max_concurrency]
    tasks = [scrape_url(u, timeout=timeout) for u in target_urls]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    scraped_map: dict[str, str] = {}
    for url, res in zip(target_urls, results):
        if isinstance(res, str) and res.strip():
            scraped_map[url] = res

    return scraped_map
