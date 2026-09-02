"""Query Planner 모듈 — 질문 의도 분류, 엔티티 추출 및 쿼리 재작성."""

import datetime
import logging
import re
from typing import Any

from app.schemas.search import QueryPlanResult

logger = logging.getLogger(__name__)

# ── 주요 도시 좌표 매핑 (한국 및 글로벌 주요 도시) ───────────────────────────
CITY_COORDINATES: dict[str, tuple[float, float, str]] = {
    "서울": (37.5665, 126.9780, "Asia/Seoul"),
    "서울특별시": (37.5665, 126.9780, "Asia/Seoul"),
    "인천": (37.4563, 126.7052, "Asia/Seoul"),
    "부산": (35.1796, 129.0756, "Asia/Seoul"),
    "대구": (35.8714, 128.6014, "Asia/Seoul"),
    "대전": (36.3504, 127.3845, "Asia/Seoul"),
    "광주": (35.1595, 126.8526, "Asia/Seoul"),
    "울산": (35.5384, 129.3114, "Asia/Seoul"),
    "세종": (36.4800, 127.2890, "Asia/Seoul"),
    "제주": (33.4996, 126.5312, "Asia/Seoul"),
    "제주도": (33.4996, 126.5312, "Asia/Seoul"),
    "수원": (37.2636, 127.0286, "Asia/Seoul"),
    "성남": (37.4200, 127.1265, "Asia/Seoul"),
    "고양": (37.6584, 126.8320, "Asia/Seoul"),
    "도쿄": (35.6762, 139.6503, "Asia/Tokyo"),
    "오사카": (34.6937, 135.5023, "Asia/Tokyo"),
    "뉴욕": (40.7128, -74.0060, "America/New_York"),
    "런던": (51.5074, -0.1278, "Europe/London"),
    "파리": (48.8566, 2.3522, "Europe/Paris"),
    "베이징": (39.9042, 116.4074, "Asia/Shanghai"),
}

# ── 통화 심볼/이름 매핑 ────────────────────────────────────────────────────────
CURRENCY_MAP: dict[str, str] = {
    "달러": "USD",
    "미국 달러": "USD",
    "usd": "USD",
    "$": "USD",
    "유로": "EUR",
    "eur": "EUR",
    "€": "EUR",
    "엔": "JPY",
    "엔화": "JPY",
    "jpy": "JPY",
    "¥": "JPY",
    "위안": "CNY",
    "위안화": "CNY",
    "cny": "CNY",
    "파운드": "GBP",
    "gbp": "GBP",
    "£": "GBP",
    "원": "KRW",
    "원화": "KRW",
    "krw": "KRW",
    "₩": "KRW",
}


class QueryPlanner:
    """질의 의도를 분석하고 쿼리를 최적화하는 Planner."""

    def __init__(self) -> None:
        self.weather_keywords = [
            "날씨", "기온", "온도", "비와", "눈와", "강수", "강수량",
            "미세먼지", "초미세먼지", "우산", "일기예보", "체감온도",
            "weather", "forecast", "temperature"
        ]
        self.currency_keywords = [
            "환율", "달러", "엔화", "유로", "위안", "파운드", "원달러",
            "환전", "currency", "exchange rate", "forex", "usd/krw"
        ]
        self.crypto_keywords = {
            "비트코인": "bitcoin", "btc": "bitcoin",
            "이더리움": "ethereum", "eth": "ethereum",
            "리플": "ripple", "xrp": "ripple",
            "솔라나": "solana", "sol": "solana",
            "도지코인": "dogecoin", "도지": "dogecoin", "doge": "dogecoin",
            "가상화폐": "bitcoin", "암호화폐": "bitcoin", "코인": "bitcoin",
        }
        self.stock_keywords = {
            "코스피": "KOSPI", "kospi": "KOSPI",
            "코스닥": "KOSDAQ", "kosdaq": "KOSDAQ",
            "나스닥": "NASDAQ", "nasdaq": "NASDAQ",
            "s&p500": "S&P500", "s&p": "S&P500", "에스앤피": "S&P500",
            "다우존스": "DOW", "다우": "DOW", "dow": "DOW",
            "주가지수": "KOSPI", "증시": "KOSPI",
        }

    def plan(self, raw_query: str) -> QueryPlanResult:
        """질의를 분석하여 실행 계획(Plan)을 수립한다."""
        cleaned_text = self._clean_conversational_particles(raw_query)
        q_lower = raw_query.lower()

        # 1. 날씨 의도 분석
        if any(k in q_lower for k in self.weather_keywords):
            location = self._extract_location(raw_query)
            date_info = self._extract_date(raw_query)
            coords = CITY_COORDINATES.get(location, CITY_COORDINATES["서울"])

            rewritten = f"{location} 날씨 {date_info}".strip()
            return QueryPlanResult(
                intent="instant_weather",
                rewritten_query=rewritten if rewritten else cleaned_text,
                entities={
                    "location": location,
                    "date": date_info,
                    "lat": coords[0],
                    "lon": coords[1],
                    "timezone": coords[2],
                },
                need_scrape=False,
                need_instant_answer=True,
            )

        # 2. 환율 의도 분석
        if any(k in q_lower for k in self.currency_keywords):
            from_curr, to_curr, amount = self._extract_currency(raw_query)
            rewritten = f"{from_curr} {to_curr} 환율"
            return QueryPlanResult(
                intent="instant_currency",
                rewritten_query=rewritten,
                entities={
                    "from_currency": from_curr,
                    "to_currency": to_curr,
                    "amount": amount,
                },
                need_scrape=False,
                need_instant_answer=True,
            )

        # 3. 암호화폐 및 주가지수 복합/단일 금융 의도 분석
        matched_cryptos = self._extract_cryptos(raw_query)
        matched_stocks = self._extract_stocks(raw_query)

        if matched_cryptos and matched_stocks:
            return QueryPlanResult(
                intent="instant_finance_composite",
                rewritten_query="가상화폐 및 주가지수 시세",
                entities={"cryptos": matched_cryptos, "stocks": matched_stocks},
                need_scrape=False,
                need_instant_answer=True,
            )
        elif matched_cryptos:
            return QueryPlanResult(
                intent="instant_crypto",
                rewritten_query=f"{matched_cryptos[0]} 시세",
                entities={"cryptos": matched_cryptos},
                need_scrape=False,
                need_instant_answer=True,
            )
        elif matched_stocks:
            return QueryPlanResult(
                intent="instant_stock",
                rewritten_query=f"{matched_stocks[0]} 지수",
                entities={"stocks": matched_stocks},
                need_scrape=False,
                need_instant_answer=True,
            )

        # 4. 일반 웹 검색 의도
        return QueryPlanResult(
            intent="web_search",
            rewritten_query=cleaned_text,
            entities={},
            need_scrape=True,
            need_instant_answer=False,
        )

    def _extract_cryptos(self, q: str) -> list[str]:
        """쿼리에서 암호화폐 ID 목록을 추출한다."""
        q_lower = q.lower()
        found: list[str] = []
        for kw, cid in self.crypto_keywords.items():
            if kw in q_lower and cid not in found:
                found.append(cid)
        return found

    def _extract_stocks(self, q: str) -> list[str]:
        """쿼리에서 주가지수 심볼 목록을 추출한다."""
        q_lower = q.lower()
        found: list[str] = []
        for kw, sym in self.stock_keywords.items():
            if kw in q_lower and sym not in found:
                found.append(sym)
        return found

    def _clean_conversational_particles(self, q: str) -> str:
        """대화형 종결어미 및 불필요한 수식어를 정제하여 검색 품질을 극대화한다."""
        cleaned = re.sub(r"[\?!\.,~]+$", "", q.strip())
        patterns = [
            # 질문 종결형
            r"\s*(?:어때|어떄|어떠니|어떨까|어떰|알려줘|알려줘요|알려주세요|알려줄래|알려주라|가르쳐줘|요약해줘|요약해줄래|설명해줘|설명해주세요|보여줘|정리해줘|추천해줘|뭐야|뭐니|뭔지|알고\s*싶어|알고\s*싶어요|해줘|해줄래|해줘요|이야|인가요|인지|얼마니|얼마야|얼마인가요|얼마인가|얼마냐|얼마인지)$",
            # 헤드라인/개수 요청 수식어 정제 (예: "주요 헤드라인 3가지만", "최근 이슈 5개")
            r"\s*(?:주요\s*)?(?:헤드라인|소식|뉴스\s*기사|이슈)?\s*(?:\d+가지(?:만)?|\d+개(?:만)?|몇\s*개(?:만)?|몇\s*가지)?$",
            # 문두 접속/추임새
            r"^(?:혹시|저기|그|음|오늘|최근의?|지금)\s+",
        ]
        for p in patterns:
            cleaned = re.sub(p, "", cleaned, flags=re.IGNORECASE).strip()
        return cleaned if cleaned else q.strip()

    def _extract_location(self, q: str) -> str:
        """텍스트에서 도시/지역명을 추출한다 (기본값: 서울)."""
        for city in CITY_COORDINATES:
            if city in q:
                return city
        return "서울"

    def _extract_date(self, q: str) -> str:
        """날짜/시점 키워드를 추출한다."""
        today = datetime.date.today().strftime("%Y-%m-%d")
        if "내일" in q:
            tomorrow = (datetime.date.today() + datetime.timedelta(days=1)).strftime("%Y-%m-%d")
            return f"내일 ({tomorrow})"
        if "모레" in q:
            after_tomorrow = (datetime.date.today() + datetime.timedelta(days=2)).strftime("%Y-%m-%d")
            return f"모레 ({after_tomorrow})"
        return f"오늘 ({today})"

    def _extract_currency(self, q: str) -> tuple[str, str, float]:
        """통화쌍 및 금액을 추출한다 (기본: USD -> KRW, 1.0)."""
        q_lower = q.lower()
        amount = 1.0
        amount_match = re.search(r"(\d+(?:\.\d+)?)\s*(?:달러|유로|엔|위안|원|usd|eur|jpy|krw)", q_lower)
        if amount_match:
            try:
                amount = float(amount_match.group(1))
            except ValueError:
                amount = 1.0

        if "엔" in q or "jpy" in q_lower:
            return "JPY", "KRW", amount
        if "유로" in q or "eur" in q_lower:
            return "EUR", "KRW", amount
        if "위안" in q or "cny" in q_lower:
            return "CNY", "KRW", amount
        if "파운드" in q or "gbp" in q_lower:
            return "GBP", "KRW", amount

        return "USD", "KRW", amount
