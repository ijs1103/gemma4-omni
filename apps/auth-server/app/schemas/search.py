"""웹 검색 관련 Pydantic 응답 스키마."""

from pydantic import BaseModel


class SearchSnippet(BaseModel):
    """개별 검색 결과 스니펫."""

    title: str
    content: str  # 최대 300자로 truncate됨
    url: str


class SearchResponse(BaseModel):
    """검색 API 응답."""

    query: str
    snippets: list[SearchSnippet]
