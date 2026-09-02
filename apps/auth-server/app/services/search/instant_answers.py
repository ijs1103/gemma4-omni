"""Instant Answer Layer — Open-Meteo 실시간 날씨 및 Frankfurter 환율 위젯 서비스."""

import datetime
import logging
from typing import Any, Optional
import httpx

from app.schemas.search import WidgetResult

logger = logging.getLogger(__name__)

# ── WMO 기상 코드 한국어 해설 매핑 ──────────────────────────────────────────
WMO_WEATHER_CODES: dict[int, str] = {
    0: "맑음 ☀️",
    1: "대체로 맑음 🌤️",
    2: "구름 조금 ⛅",
    3: "흐림 ☁️",
    45: "안개 🌫️",
    48: "서리 안개 🌫️",
    51: "약한 이슬비 🌦️",
    53: "보통 이슬비 🌦️",
    55: "강한 이슬비 🌧️",
    61: "약한 비 🌧️",
    63: "보통 비 🌧️",
    65: "강한 비 🌧️",
    71: "약한 눈 🌨️",
    73: "보통 눈 🌨️",
    75: "강한 눈 ❄️",
    77: "싸락눈 🌨️",
    80: "약한 소나기 🌦️",
    81: "보통 소나기 🌧️",
    82: "강한 소나기 ⛈️",
    85: "약한 눈 소나기 🌨️",
    86: "강한 눈 소나기 ❄️",
    95: "뇌우 ⚡",
    96: "뇌우 및 우박 ⛈️",
    99: "강한 뇌우 및 대형 우박 ⛈️",
}

# ── Frankfurter 엔드포인트 실측 근거:
# 1. https://api.frankfurter.dev/v1/latest: 최신 공식 도메인 (실측 정상 동작 확인 완료)
# 2. https://api.frankfurter.app/latest: 레거시 도메인 (실측 정상 동작 확인 완료)
# dev 도메인을 우선 호출하고 장애 시 app 도메인으로 자동 폴백합니다.
FRANKFURTER_PRIMARY_URL = "https://api.frankfurter.dev/v1/latest"
FRANKFURTER_FALLBACK_URL = "https://api.frankfurter.app/latest"


class InstantAnswerService:
    """실시간 정밀 수치 데이터를 제공하는 Instant Answer 서비스."""

    def __init__(self, timeout: float = 3.0) -> None:
        self.timeout = timeout

    async def get_weather(
        self,
        lat: float,
        lon: float,
        location_name: str = "서울",
        timezone: str = "Asia/Seoul",
    ) -> Optional[WidgetResult]:
        """Open-Meteo Direct API를 호출하여 현재 날씨 수치 위젯을 생성한다."""
        params = {
            "latitude": lat,
            "longitude": lon,
            "current": "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m",
            "timezone": timezone,
        }
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                res = await client.get("https://api.open-meteo.com/v1/forecast", params=params)
                if not res.is_success:
                    logger.warning("Open-Meteo weather API returned %d", res.status_code)
                    return None
                data = res.json()
        except Exception as e:
            logger.warning("Open-Meteo weather API call failed: %s", e)
            return None

        current = data.get("current", {})
        temp = current.get("temperature_2m", 0.0)
        apparent_temp = current.get("apparent_temperature", temp)
        humidity = current.get("relative_humidity_2m", 0)
        precip = current.get("precipitation", 0.0)
        code = current.get("weather_code", 0)
        wind = current.get("wind_speed_10m", 0.0)
        condition = WMO_WEATHER_CODES.get(code, "정보 없음")

        today_str = datetime.date.today().strftime("%Y년 %m월 %d일")
        summary = (
            f"[{today_str} {location_name} 실시간 날씨 정보]\n"
            f"- 상태: {condition}\n"
            f"- 현재 기온: {temp}°C (체감 온도: {apparent_temp}°C)\n"
            f"- 습도: {humidity}%\n"
            f"- 강수량: {precip}mm\n"
            f"- 풍속: {wind}km/h\n"
            f"(출처: Open-Meteo 실시간 기상 데이터)"
        )

        return WidgetResult(
            type="weather",
            title=f"{location_name} 실시간 날씨 ({condition})",
            data={
                "location": location_name,
                "temperature": temp,
                "apparent_temperature": apparent_temp,
                "humidity": humidity,
                "precipitation": precip,
                "condition": condition,
                "wind_speed": wind,
                "source": "Open-Meteo",
            },
            summary_text=summary,
        )

    async def get_exchange_rate(
        self,
        from_curr: str = "USD",
        to_curr: str = "KRW",
        amount: float = 1.0,
    ) -> Optional[WidgetResult]:
        """Frankfurter API를 호출하여 환율 위젯 데이터를 생성한다 (ECB 평일 1회 갱신 명시)."""
        from_curr = from_curr.upper()
        to_curr = to_curr.upper()

        data: Optional[dict[str, Any]] = None

        # 1차 시도: api.frankfurter.dev
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                res = await client.get(
                    FRANKFURTER_PRIMARY_URL,
                    params={"base": from_curr, "symbols": to_curr},
                )
                if res.is_success:
                    data = res.json()
        except Exception as e:
            logger.info("Frankfurter primary endpoint failed, trying fallback: %s", e)

        # 2차 시도: api.frankfurter.app (폴백)
        if not data:
            try:
                async with httpx.AsyncClient(timeout=self.timeout) as client:
                    res = await client.get(
                        FRANKFURTER_FALLBACK_URL,
                        params={"base": from_curr, "symbols": to_curr},
                    )
                    if res.is_success:
                        data = res.json()
            except Exception as e:
                logger.warning("Frankfurter fallback endpoint also failed: %s", e)
                return None

        if not data or "rates" not in data or to_curr not in data["rates"]:
            return None

        rate = float(data["rates"][to_curr])
        converted_amount = round(amount * rate, 2)
        rate_date = data.get("date", datetime.date.today().strftime("%Y-%m-%d"))

        summary = (
            f"[{rate_date} 기준 고시 환율]\n"
            f"- 1 {from_curr} = {rate:,.2f} {to_curr}\n"
            f"- {amount:,.2f} {from_curr} = {converted_amount:,.2f} {to_curr}\n"
            f"- 안내: 유럽중앙은행(ECB) 기준 고시 환율이며, 평일 1일 1회(오후) 갱신됩니다."
        )

        return WidgetResult(
            type="currency",
            title=f"{from_curr} ➔ {to_curr} 환율 ({rate:,.2f} {to_curr})",
            data={
                "from_currency": from_curr,
                "to_currency": to_curr,
                "rate": rate,
                "amount": amount,
                "converted_amount": converted_amount,
                "date": rate_date,
                "source": "European Central Bank (Frankfurter API)",
                "update_frequency": "평일 1일 1회",
            },
            summary_text=summary,
        )

    async def get_crypto_price(
        self,
        coin_ids: list[str],
    ) -> Optional[WidgetResult]:
        """CoinGecko Public API를 호출하여 주요 암호화폐 실시간 가격 위젯을 생성한다."""
        if not coin_ids:
            coin_ids = ["bitcoin"]

        ids_param = ",".join(coin_ids)
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

        try:
            async with httpx.AsyncClient(timeout=self.timeout, headers=headers) as client:
                res = await client.get(
                    "https://api.coingecko.com/api/v3/simple/price",
                    params={
                        "ids": ids_param,
                        "vs_currencies": "krw,usd",
                        "include_24hr_change": "true",
                    },
                )
                if not res.is_success:
                    logger.warning("CoinGecko API returned %d", res.status_code)
                    return None
                data = res.json()
        except Exception as e:
            logger.warning("CoinGecko API call failed: %s", e)
            return None

        today_str = datetime.date.today().strftime("%Y년 %m월 %d일")
        name_map = {
            "bitcoin": "비트코인 (BTC)",
            "ethereum": "이더리움 (ETH)",
            "ripple": "리플 (XRP)",
            "solana": "솔라나 (SOL)",
            "dogecoin": "도지코인 (DOGE)",
        }

        lines = [f"[{today_str} 실시간 가상화폐 시세 정보]"]
        for cid in coin_ids:
            if cid in data:
                cinfo = data[cid]
                krw_price = cinfo.get("krw", 0)
                usd_price = cinfo.get("usd", 0)
                change_24h = cinfo.get("krw_24h_change", 0.0)
                change_sign = "+" if change_24h > 0 else ""
                lines.append(
                    f"- {name_map.get(cid, cid.upper())}: {krw_price:,.0f}원 (${usd_price:,.2f} USD, 24시간 변동률: {change_sign}{change_24h:.2f}%)"
                )

        lines.append("(출처: CoinGecko 실시간 암호화폐 시세)")
        summary = "\n".join(lines)

        first_coin = coin_ids[0]
        first_krw = data.get(first_coin, {}).get("krw", 0)

        return WidgetResult(
            type="crypto",
            title=f"{name_map.get(first_coin, first_coin.upper())} 실시간 시세 ({first_krw:,.0f}원)",
            data=data,
            summary_text=summary,
        )

    async def get_stock_index(
        self,
        indices: list[str],
    ) -> Optional[WidgetResult]:
        """한국(Naver Finance) 및 미국(Yahoo Finance) 주요 주가지수 위젯을 생성한다."""
        today_str = datetime.date.today().strftime("%Y년 %m월 %d일")
        lines = [f"[{today_str} 주요 주가지수 실시간 현황]"]
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
        data_collected: dict[str, Any] = {}

        async with httpx.AsyncClient(timeout=self.timeout, headers=headers) as client:
            for idx in indices:
                idx_upper = idx.upper()
                # 국내 지수: KOSPI, KOSDAQ
                if idx_upper in ["KOSPI", "코스피", "KOSDAQ", "코스닥"]:
                    target = "KOSPI" if "KOSPI" in idx_upper or "코스피" in idx_upper else "KOSDAQ"
                    try:
                        res = await client.get(f"https://m.stock.naver.com/api/index/{target}/basic")
                        if res.is_success:
                            d = res.json()
                            name = d.get("stockName", target)
                            price = d.get("closePrice", "")
                            change = d.get("compareToPreviousClosePrice", "")
                            ratio = d.get("fluctuationsRatio", "")
                            status_text = d.get("compareToPreviousPrice", {}).get("text", "")
                            lines.append(f"- {name}: {price}pt (전일대비 {change}pt, {ratio}%, {status_text})")
                            data_collected[target] = d
                    except Exception as e:
                        logger.warning("Naver stock API error for %s: %s", target, e)

                # 해외 지수: NASDAQ, S&P500, DOW
                elif idx_upper in ["NASDAQ", "나스닥", "S&P500", "S&P", "DOW", "다우"]:
                    sym_map = {
                        "NASDAQ": ("^IXIC", "나스닥 (NASDAQ)"),
                        "나스닥": ("^IXIC", "나스닥 (NASDAQ)"),
                        "S&P500": ("^GSPC", "S&P 500"),
                        "S&P": ("^GSPC", "S&P 500"),
                        "DOW": ("^DJI", "다우존스 (Dow Jones)"),
                        "다우": ("^DJI", "다우존스 (Dow Jones)"),
                    }
                    sym, disp_name = sym_map.get(idx_upper, ("^IXIC", "나스닥"))
                    try:
                        res = await client.get(f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}")
                        if res.is_success:
                            meta = res.json().get("chart", {}).get("result", [{}])[0].get("meta", {})
                            curr_price = meta.get("regularMarketPrice", 0.0)
                            prev_close = meta.get("chartPreviousClose", curr_price)
                            diff = curr_price - prev_close
                            ratio = (diff / prev_close * 100) if prev_close else 0.0
                            sign = "+" if diff > 0 else ""
                            lines.append(f"- {disp_name}: {curr_price:,.2f}pt (전일대비 {sign}{diff:,.2f}pt, {sign}{ratio:.2f}%)")
                            data_collected[sym] = meta
                    except Exception as e:
                        logger.warning("Yahoo Finance API error for %s: %s", sym, e)

        if len(lines) <= 1:
            return None

        lines.append("(출처: 한국거래소 / Naver 증시 / Yahoo Finance 실시간 데이터)")
        summary = "\n".join(lines)

        return WidgetResult(
            type="stock",
            title=f"주요 증시 지수 현황",
            data=data_collected,
            summary_text=summary,
        )

    async def get_finance_composite(
        self,
        cryptos: list[str],
        stocks: list[str],
    ) -> Optional[WidgetResult]:
        """가상화폐와 주가지수가 혼합된 질문(예: 비트코인 + 코스피)에 대한 통합 금융 위젯을 생성한다."""
        today_str = datetime.date.today().strftime("%Y년 %m월 %d일")
        sections: list[str] = [f"[{today_str} 실시간 금융 및 자산 시장 현황]"]

        # 1. 암호화폐 조회
        if cryptos:
            crypto_res = await self.get_crypto_price(cryptos)
            if crypto_res and crypto_res.summary_text:
                sections.append("■ 암호화폐 시세 (출처: CoinGecko)")
                # 헤더와 푸터 제외한 본문 줄만 추출
                body_lines = [l for l in crypto_res.summary_text.splitlines() if l.startswith("- ")]
                sections.extend(body_lines)

        # 2. 주가지수 조회
        if stocks:
            stock_res = await self.get_stock_index(stocks)
            if stock_res and stock_res.summary_text:
                sections.append("■ 주요 주가지수 (출처: 한국거래소 / 네이버 증시 / Yahoo Finance)")
                body_lines = [l for l in stock_res.summary_text.splitlines() if l.startswith("- ")]
                sections.extend(body_lines)

        if len(sections) <= 1:
            return None

        summary = "\n".join(sections)
        return WidgetResult(
            type="finance_composite",
            title=f"실시간 금융/자산 지표 통합 현황",
            data={"cryptos": cryptos, "stocks": stocks},
            summary_text=summary,
        )
