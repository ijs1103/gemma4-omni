"""Kiwi 형태소 정밀 필터링 + BM25Okapi 리랭커 및 Gemma SentencePiece 토큰 예산 관리."""

import logging
import os
import struct
from typing import Any, Optional
from kiwipiepy import Kiwi
from rank_bm25 import BM25Plus, BM25Okapi
import sentencepiece as spm

from app.schemas.search import SourceChunk

logger = logging.getLogger(__name__)

# 기본 토크나이저 에셋 경로
DEFAULT_TOKENIZER_ASSET_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "assets",
    "tokenizer.model",
)

# Kiwi 형태소 추출 대상 품사 태그
# 1. 기본 포함: 일반명사(NNG), 고유명사(NNP), 수사(NR), 숫자(SN), 외국어(SL), 한자(SH)
NOUN_TAGS = {"NNG", "NNP", "NR", "SN", "SL", "SH"}
# 2. 조건부 포함: 동사(VV), 형용사(VA) - 원형 복원된 기본형만 포함
PREDICATE_TAGS = {"VV", "VA"}


def parse_litertlm_sp_tokenizer_section(litertlm_bytes: bytes) -> Optional[tuple[int, int]]:
    """LiteRT-LM FlatBuffer 헤더의 section_metadata를 런타임에 동적으로 파싱하여

    SP_Tokenizer 섹션의 (offset, size)를 반환한다.
    """
    if len(litertlm_bytes) < 32 or litertlm_bytes[:8] != b"LITERTLM":
        return None

    try:
        # FlatBuffer 섹션 메타데이터 벡터 동적 탐색
        for i in range(16, min(len(litertlm_bytes) - 24, 8192), 4):
            size, offset = struct.unpack("<QQ", litertlm_bytes[i : i + 16])
            # SP_Tokenizer는 일반적으로 offset >= 32768, size 100KB ~ 20MB 범위
            if 32768 <= offset <= 5000000000 and 100000 <= size <= 20000000:
                if offset + 4 <= len(litertlm_bytes):
                    tag = litertlm_bytes[offset : offset + 2]
                    if tag in (bytes([10, 14]), bytes([10, 15]), bytes([10, 16])):
                        logger.info("Dynamically resolved SP_Tokenizer section: offset=%d, size=%d", offset, size)
                        return offset, size
    except Exception as e:
        logger.warning("Failed to parse LiteRT-LM section metadata dynamically: %s", e)

    return None


class GemmaTokenizerManager:
    """온디바이스 Gemma SentencePiece 토크나이저 관리자."""

    def __init__(self, custom_path: Optional[str] = None) -> None:
        self.sp = spm.SentencePieceProcessor()
        self.is_loaded = False
        self.vocab_size = 0
        self._load_tokenizer(custom_path)

    def _load_tokenizer(self, custom_path: Optional[str] = None) -> None:
        target_path = custom_path or os.getenv("GEMMA_TOKENIZER_PATH") or DEFAULT_TOKENIZER_ASSET_PATH

        # 1순위: 로컬 tokenizer.model 에셋 파일 로드
        if os.path.exists(target_path):
            try:
                # .litertlm 파일인 경우 동적 FlatBuffer 섹션 파싱 수행
                if target_path.endswith(".litertlm") or target_path.endswith(".task"):
                    with open(target_path, "rb") as f:
                        header = f.read(65536)
                        section_info = parse_litertlm_sp_tokenizer_section(header)
                        if section_info:
                            offset, size = section_info
                            f.seek(offset)
                            sp_data = f.read(size)
                            if self.sp.LoadFromSerializedProto(sp_data):
                                self.is_loaded = True
                                self.vocab_size = self.sp.get_piece_size()
                                logger.info("Loaded Gemma SP Tokenizer from .litertlm section (vocab_size=%d)", self.vocab_size)
                                return

                # 일반 SentencePiece .model 파일 로드
                self.sp.Load(target_path)
                self.is_loaded = True
                self.vocab_size = self.sp.get_piece_size()
                logger.info("Loaded Gemma SP Tokenizer from %s (vocab_size=%d)", target_path, self.vocab_size)
                return
            except Exception as e:
                logger.warning("Failed to load SentencePiece from %s: %s", target_path, e)

        # 2순위 (폴백): 고정 오프셋 32768 폴백 시도
        if target_path.endswith(".litertlm") and os.path.exists(target_path):
            try:
                with open(target_path, "rb") as f:
                    f.seek(32768)
                    sp_data = f.read(4688993)
                    if self.sp.LoadFromSerializedProto(sp_data):
                        self.is_loaded = True
                        self.vocab_size = self.sp.get_piece_size()
                        logger.warning("Loaded Gemma SP Tokenizer via fallback offset 32768 (vocab_size=%d)", self.vocab_size)
                        return
            except Exception as e:
                logger.error("Fallback offset loading failed: %s", e)

        logger.warning("Gemma Tokenizer not loaded; fallback token estimation will be used.")

    def count_tokens(self, text: str) -> int:
        """실제 Gemma SentencePiece 토크나이저를 사용해 토큰 수를 계산한다."""
        if self.is_loaded:
            return len(self.sp.EncodeAsIds(text))
        # 토크나이저 부재 시 한국어 보수적 계수 (1.3 chars/token) 기반 폴백
        return max(1, int(len(text) / 1.3))

    def encode(self, text: str) -> list[int]:
        """텍스트를 토큰 ID 리스트로 인코딩한다."""
        if self.is_loaded:
            return self.sp.EncodeAsIds(text)
        return []


class Reranker:
    """Kiwi 형태소 정밀 필터링 기반 BM25Okapi 리랭커 및 컨텍스트 압축기."""

    def __init__(self, tokenizer_manager: Optional[GemmaTokenizerManager] = None) -> None:
        self.kiwi = Kiwi()
        self.tokenizer = tokenizer_manager or GemmaTokenizerManager()

    def tokenize_korean_for_bm25(self, text: str) -> list[str]:
        """Kiwi 형태소 분석기로 명사(NNG/NNP) 및 원형 복원된 동사/형용사(VV/VA)만 정밀 추출한다.

        조사(J) 및 어미(E)는 완전히 제거하여 BM25 노이즈를 방지한다.
        """
        if not text or not text.strip():
            return []

        tokens: list[str] = []
        try:
            results = self.kiwi.analyze(text)
            for res in results:
                for morph in res[0]:
                    tag = morph.tag
                    form = morph.form

                    # 1. 일반명사, 고유명사, 수사, 숫자, 외국어 포함
                    if tag in NOUN_TAGS:
                        if len(form) > 1 or tag in {"SL", "SH"}:  # 1글자 한글 명사 중 일부 제외, 외국어는 허용
                            tokens.append(form)
                        elif len(form) == 1:
                            tokens.append(form)

                    # 2. 동사, 형용사는 원형 복원(기본형)된 경우에만 한정 포함
                    elif tag in PREDICATE_TAGS:
                        # lemma 형태 (-다 기본형)
                        lemma = f"{form}다"
                        tokens.append(lemma)
        except Exception as e:
            logger.debug("Kiwi analysis failed, falling back to whitespace splitting: %s", e)
            return [w for w in text.split() if len(w) > 1]

        return tokens if tokens else [w for w in text.split() if len(w) > 1]

    def chunk_text(self, text: str, chunk_size: int = 900, overlap: int = 100) -> list[str]:
        """텍스트를 지정된 크기와 오버랩으로 청킹한다."""
        if not text:
            return []
        if len(text) <= chunk_size:
            return [text.strip()]

        chunks: list[str] = []
        start = 0
        while start < len(text):
            end = start + chunk_size
            chunk = text[start:end].strip()
            if chunk:
                chunks.append(chunk)
            start += chunk_size - overlap
        return chunks

    def rerank(
        self,
        query: str,
        docs: list[dict[str, str]],  # [{"url": ..., "title": ..., "text": ...}]
        top_k: int = 4,
        max_tokens: int = 1600,
    ) -> tuple[list[SourceChunk], str]:
        """문서들을 청킹하고 Kiwi 형태소 기반 BM25Okapi로 순위를 매긴 뒤,

        Gemma 토크나이저 토큰 예산 내에서 압축 컨텍스트를 구성한다.
        """
        if not docs:
            return [], ""

        # 1. 모든 문서 청킹 및 메타데이터 보존
        all_chunks: list[dict[str, Any]] = []
        for doc in docs:
            url = doc.get("url", "")
            title = doc.get("title", "")
            text = doc.get("text", "")

            chunks = self.chunk_text(text, chunk_size=900, overlap=100)
            for chunk in chunks:
                all_chunks.append({
                    "url": url,
                    "title": title,
                    "text": chunk,
                })

        if not all_chunks:
            return [], ""

        # 2. Kiwi 형태소 분석을 통한 코퍼스 토큰화
        tokenized_corpus = [self.tokenize_korean_for_bm25(c["text"]) for c in all_chunks]
        tokenized_query = self.tokenize_korean_for_bm25(query)

        # 3. BM25 점수 계산 (BM25Plus로 소규모 코퍼스에서도 안정적인 양수 점수 산출)
        bm25 = BM25Plus(tokenized_corpus)
        scores = bm25.get_scores(tokenized_query)

        # 4. 점수 기준 내림차순 정렬
        scored_chunks = []
        for i, chunk_info in enumerate(all_chunks):
            scored_chunks.append(
                SourceChunk(
                    url=chunk_info["url"],
                    title=chunk_info["title"],
                    text=chunk_info["text"],
                    score=float(scores[i]),
                )
            )
        scored_chunks.sort(key=lambda c: c.score, reverse=True)

        # 5. 토크나이저 기반 토큰 예산(Token Budget) 통제 및 컨텍스트 압축
        selected_chunks: list[SourceChunk] = []
        context_parts: list[str] = []
        accumulated_tokens = 0

        for chunk in scored_chunks[:top_k]:
            chunk_formatted = f"[출처: {chunk.title}]({chunk.url})\n{chunk.text}"
            chunk_tokens = self.tokenizer.count_tokens(chunk_formatted)

            if accumulated_tokens + chunk_tokens > max_tokens and selected_chunks:
                logger.info(
                    "Token budget reached (%d + %d > %d), stopping chunk selection.",
                    accumulated_tokens,
                    chunk_tokens,
                    max_tokens,
                )
                break

            selected_chunks.append(chunk)
            context_parts.append(chunk_formatted)
            accumulated_tokens += chunk_tokens

        compressed_context = "\n\n---\n\n".join(context_parts)
        return selected_chunks, compressed_context
