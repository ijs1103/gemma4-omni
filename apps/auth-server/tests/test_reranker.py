import pytest
from app.services.search.reranker import Reranker, GemmaTokenizerManager

def test_kiwi_tokenization_removes_particles_and_extracts_nouns():
    reranker = Reranker()
    text = "오늘 서울의 날씨는 매우 맑고 따뜻합니다. 비가 오지 않습니다."
    tokens = reranker.tokenize_korean_for_bm25(text)
    
    # 명사 및 원형 서술어 추출 확인
    assert "오늘" in tokens
    assert "서울" in tokens
    assert "날씨" in tokens
    assert "맑다" in tokens or "따뜻하다" in tokens
    
    # 조사(의, 는, 가)나 어미가 단독 토큰으로 들어가지 않음 확인
    assert "의" not in tokens
    assert "는" not in tokens
    assert "가" not in tokens

def test_tokenizer_manager_loads_vocab_size_dynamically():
    mgr = GemmaTokenizerManager()
    assert mgr.is_loaded is True
    assert mgr.vocab_size > 0
    
    tokens = mgr.count_tokens("오늘 서울 날씨 어때?")
    assert tokens > 0
    assert isinstance(tokens, int)

def test_reranker_bm25_ranking_and_token_budget():
    reranker = Reranker()
    query = "2026년 인공지능 트렌드"
    
    docs = [
        {
            "url": "https://example.com/cooking-recipe",
            "title": "맛있는 파스타 레시피",
            "text": "올리브 오일과 마늘을 프라이팬에 두르고 면을 삶아 함께 볶아줍니다. 소금과 후추로 간을 맞춥니다.",
        },
        {
            "url": "https://example.com/ai-2026",
            "title": "2026 AI 전망 보고서",
            "text": "2026년 인공지능 시장은 온디바이스 에이전트와 추론형 모델이 주도할 것입니다. 대규모 멀티모달 기술이 더욱 발전합니다.",
        },
    ]
    
    selected_chunks, compressed_context = reranker.rerank(query, docs, top_k=1, max_tokens=500)
    
    assert len(selected_chunks) == 1
    # AI 관련 문서가 요리 문서보다 높은 점수로 1순위 선정되어야 함
    assert selected_chunks[0].url == "https://example.com/ai-2026"
    assert selected_chunks[0].score > 0
    assert "2026 AI 전망 보고서" in compressed_context
    assert "맛있는 파스타" not in compressed_context
