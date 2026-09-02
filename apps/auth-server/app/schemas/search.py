"""웹 검색 및 RAG 고도화 관련 Pydantic v2 스키마."""

from typing import Any, Literal, Optional
from pydantic import BaseModel, Field


class SearchSnippet(BaseModel):
    """개별 검색 결과 스니펫 (하위 호환성 유지용)."""

    title: str
    content: str  # 최대 300자로 truncate됨
    url: str


class WidgetResult(BaseModel):
    """인스턴트 위젯 응답 (날씨, 환율, 가상화폐, 주가지수 등)."""

    type: Literal["weather", "currency", "crypto", "stock", "finance_composite", "calculator"]
    title: str
    data: dict[str, Any] = Field(default_factory=dict)
    summary_text: str  # LLM이 즉시 인용할 수 있는 자연어 요약 문장


class SourceChunk(BaseModel):
    """스크래핑 및 리랭킹을 거친 본문 청크."""

    url: str
    title: str
    text: str
    score: float = 0.0


class QueryPlanResult(BaseModel):
    """Query Planner 분석 결과."""

    intent: Literal["instant_weather", "instant_currency", "instant_crypto", "instant_stock", "instant_finance_composite", "web_search"]
    rewritten_query: str
    entities: dict[str, Any] = Field(default_factory=dict)
    need_scrape: bool = True
    need_instant_answer: bool = False


class SearchRequest(BaseModel):
    """고도화 검색 요청 스키마."""

    query: str
    mode: Literal["speed", "balanced", "quality"] = "balanced"
    max_results: int = 5


class SearchResponse(BaseModel):
    """고도화 검색 API 응답."""

    query: str
    intent: str = "web_search"
    widget: Optional[WidgetResult] = None
    sources: list[SourceChunk] = Field(default_factory=list)
    snippets: list[SearchSnippet] = Field(default_factory=list)  # 기존 클라이언트 하위 호환
    compressed_context: str = ""
