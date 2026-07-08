/**
 * document-context.ts
 *
 * 문서 텍스트를 LLM 프롬프트에 안전하게 주입(Context Stuffing)하기 위한 순수 도메인 로직.
 *
 * ─── 설계 원칙 ────────────────────────────────────────────────────────────────
 *
 * 1. 제로 의존성: 이 모듈은 브라우저 API, React Native API, Node API를 일절 사용하지 않는다.
 *    순수 TypeScript 문자열 처리만 수행하므로 Web/iOS/Android 어디서든 동일하게 동작한다.
 *
 * 2. OOM 방어: 임베딩 모델을 로드하지 않고, Gemma 4 E4B의 32K 토큰 컨텍스트 윈도우를
 *    활용하여 추출된 문서 텍스트를 프롬프트에 직접 삽입하는 'In-Context RAG' 패턴을 사용한다.
 *
 * 3. 토큰 예산 관리: Gemma 토크나이저 기준 1토큰 ≈ 3.5~4 한국어 글자(UTF-8 기준)이며,
 *    시스템 프롬프트 + 사용자 질문 + 생성 여유분을 고려해 문서 영역에 할당 가능한
 *    글자 수를 보수적으로 계산한다. 초과 시 자르기(Truncation) + 사용자 경고를 반환한다.
 *
 * ─── 아키텍처 위치 ────────────────────────────────────────────────────────────
 *
 *   packages/prompt-kit/src/document-context.ts  ← 이 파일
 *        ↓ import
 *   apps/web/src/utils/pdf-parser.ts     (브라우저 PDF → 텍스트)
 *   apps/mobile/src/utils/pdf-parser.ts  (네이티브 PDF → 텍스트)
 *        ↓ 텍스트 전달
 *   LiteRTLMAdapter.ts / WebLLMAdapter.ts → stream() 호출 시 프롬프트 조립
 */

import type { Attachment, ChatMessage } from '@repo/ai-core';

// ─── 상수 정의 ─────────────────────────────────────────────────────────────────

/**
 * Gemma 4 E4B 모델의 총 컨텍스트 윈도우 크기 (토큰 단위).
 * 레지스트리의 contextWindow: 32768과 일치한다.
 */
const MODEL_CONTEXT_WINDOW_TOKENS = 32_768;

/**
 * 한국어/영어 혼합 텍스트에서의 보수적 글자→토큰 변환 비율.
 *
 * - 영어 전용: ~4 chars/token
 * - 한국어 전용: ~2.5 chars/token (유니코드 범위가 넓어 서브워드 분할이 잦음)
 * - 혼합(실무): ~3.2 chars/token
 *
 * 안전 마진을 위해 3.0을 사용한다. 이 값이 작을수록 보수적(더 적게 허용)이다.
 */
const CHARS_PER_TOKEN = 3.0;

/**
 * 시스템 프롬프트 + 대화 히스토리에 예약되는 토큰 수.
 * 시스템 프롬프트(~200 토큰) + 직전 대화 턴 2~3개(~1,000 토큰) +
 * 사용자 현재 질문(~200 토큰) = 약 1,400 토큰. 넉넉히 2,000 토큰 예약.
 */
const RESERVED_PROMPT_TOKENS = 2_000;

/**
 * 모델이 응답을 생성할 수 있도록 예약하는 토큰 수.
 * 긴 요약/분석 답변을 위해 4,096 토큰을 확보한다.
 */
const RESERVED_GENERATION_TOKENS = 4_096;

/**
 * 문서 컨텍스트에 할당 가능한 최대 토큰 수.
 * = 전체 윈도우 - 프롬프트 예약 - 생성 예약
 */
const MAX_DOCUMENT_TOKENS =
  MODEL_CONTEXT_WINDOW_TOKENS - RESERVED_PROMPT_TOKENS - RESERVED_GENERATION_TOKENS;

/**
 * 문서 컨텍스트에 할당 가능한 최대 글자 수.
 * 토큰 수 × 글자/토큰 비율로 변환한다.
 */
const MAX_DOCUMENT_CHARS = Math.floor(MAX_DOCUMENT_TOKENS * CHARS_PER_TOKEN);

// ─── 타입 정의 ─────────────────────────────────────────────────────────────────

/** PDF 파서 등에서 추출된 단일 문서 텍스트 */
export interface ExtractedDocument {
  /** 원본 파일명 (사용자에게 표시 / 프롬프트 내 구분자용) */
  fileName: string;
  /** 추출된 전체 텍스트 (정제 전 원본) */
  rawText: string;
  /** 원본 페이지 수 (PDF의 경우, 없으면 undefined) */
  pageCount?: number;
}

/** 컨텍스트 빌드 결과 */
export interface ContextBuildResult {
  /**
   * 최종 조립된 프롬프트 문자열.
   * 문서 컨텍스트가 삽입된 상태로, 이 값을 그대로 LLM 어댑터에 전달한다.
   */
  prompt: string;

  /**
   * 문서가 잘렸는지 여부.
   * true인 경우 warnings 배열에 구체적인 경고 메시지가 포함된다.
   */
  wasTruncated: boolean;

  /**
   * 사용자에게 표시할 경고 메시지 목록.
   * 예: "문서가 너무 길어 앞부분 80,000자만 사용됩니다."
   */
  warnings: string[];

  /**
   * 디버깅/로깅용 통계 정보.
   */
  stats: {
    /** 원본 문서 텍스트 총 글자 수 */
    originalChars: number;
    /** 실제 프롬프트에 삽입된 글자 수 */
    injectedChars: number;
    /** 추정 토큰 수 */
    estimatedTokens: number;
    /** 사용된 문서 수 */
    documentCount: number;
  };
}

/** 컨텍스트 빌더 옵션 (호출 시 커스텀 가능) */
export interface ContextBuildOptions {
  /**
   * 문서 컨텍스트에 할당할 최대 글자 수 오버라이드.
   * 미지정 시 기본값(MAX_DOCUMENT_CHARS ≈ 80,016) 사용.
   */
  maxDocumentChars?: number;

  /**
   * 시스템 프롬프트 텍스트.
   * 문서 컨텍스트는 이 시스템 프롬프트 뒤, 사용자 메시지 앞에 삽입된다.
   */
  systemPrompt?: string;

  /**
   * 잘라내기 전략: 'head' (앞부분 보존) | 'tail' (뒷부분 보존).
   * PDF 문서는 보통 서론-본론 순서이므로 기본값은 'head' (앞부분 우선).
   */
  truncationStrategy?: 'head' | 'tail';
}

// ─── 유틸리티 함수 ──────────────────────────────────────────────────────────────

/**
 * 추출된 원본 텍스트를 프롬프트 삽입에 적합하도록 정제한다.
 *
 * - 연속된 빈 줄을 단일 줄바꿈으로 병합 (토큰 절약)
 * - 각 줄의 앞뒤 공백 제거
 * - 널 문자(\x00) 등 제어 문자 제거
 * - 빈 텍스트인 경우 빈 문자열 반환
 */
export function sanitizeDocumentText(raw: string): string {
  if (!raw || raw.trim().length === 0) return '';

  return raw
    // 제어 문자 제거 (줄바꿈·탭은 유지)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // 각 줄 trim + 연속 빈줄 병합
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 글자 수 기준으로 텍스트를 지정된 전략에 따라 자른다.
 *
 * 단어 중간이 아닌, 가장 가까운 줄바꿈(\n) 또는 문장 종결 위치에서
 * 잘라 가독성을 유지한다.
 */
export function truncateText(
  text: string,
  maxChars: number,
  strategy: 'head' | 'tail' = 'head',
): string {
  if (text.length <= maxChars) return text;

  if (strategy === 'head') {
    // 앞부분 보존: maxChars 이내에서 마지막 줄바꿈 위치에서 자름
    const slice = text.slice(0, maxChars);
    const lastNewline = slice.lastIndexOf('\n');
    // 줄바꿈이 충분히 뒤에 있으면 그 위치에서, 아니면 그냥 maxChars에서 자름
    const cutAt = lastNewline > maxChars * 0.8 ? lastNewline : maxChars;
    return slice.slice(0, cutAt);
  } else {
    // 뒷부분 보존: 끝에서 maxChars 이내의 첫 줄바꿈 위치에서 시작
    const slice = text.slice(-maxChars);
    const firstNewline = slice.indexOf('\n');
    const cutAt = firstNewline !== -1 && firstNewline < maxChars * 0.2
      ? firstNewline + 1
      : 0;
    return slice.slice(cutAt);
  }
}

/**
 * 글자 수를 추정 토큰 수로 변환한다.
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

// ─── 메인 로직 ──────────────────────────────────────────────────────────────────

/**
 * 추출된 문서 텍스트를 사용자 질문과 병합하여 최종 프롬프트를 조립한다.
 *
 * ┌──────────────────────────────────────────┐
 * │ [System Prompt]                          │  ← RESERVED_PROMPT_TOKENS
 * │ ─────────────────────────                │
 * │ <document_context>                       │
 * │   [문서 1: report.pdf]                    │  ← MAX_DOCUMENT_TOKENS
 * │   ... 추출된 텍스트 ...                    │    (이 영역만 최대치 제한)
 * │   [문서 2: data.csv]                      │
 * │   ... 추출된 텍스트 ...                    │
 * │ </document_context>                      │
 * │ ─────────────────────────                │
 * │ [사용자 질문]                              │  ← RESERVED_PROMPT_TOKENS
 * │ ─────────────────────────                │
 * │           (생성 여유분)                     │  ← RESERVED_GENERATION_TOKENS
 * └──────────────────────────────────────────┘
 *
 * @param documents - PDF 파서 등에서 추출된 문서 목록
 * @param userQuery - 사용자의 현재 질문 텍스트
 * @param options   - 커스텀 옵션 (시스템 프롬프트, 최대 글자 수 등)
 * @returns ContextBuildResult - 최종 프롬프트 + 잘림 여부 + 경고 + 통계
 */
export function buildDocumentContext(
  documents: ExtractedDocument[],
  userQuery: string,
  options: ContextBuildOptions = {},
): ContextBuildResult {
  const {
    maxDocumentChars = MAX_DOCUMENT_CHARS,
    systemPrompt,
    truncationStrategy = 'head',
  } = options;

  const warnings: string[] = [];
  let wasTruncated = false;

  // ── Step 1: 각 문서 텍스트 정제 ──
  const sanitized = documents
    .map((doc) => ({
      fileName: doc.fileName,
      text: sanitizeDocumentText(doc.rawText),
      pageCount: doc.pageCount,
    }))
    .filter((doc) => doc.text.length > 0);

  if (sanitized.length === 0) {
    // 유효한 문서 텍스트가 없으면 문서 컨텍스트 없이 일반 프롬프트 반환
    return {
      prompt: userQuery,
      wasTruncated: false,
      warnings: ['첨부된 문서에서 텍스트를 추출할 수 없습니다. 이미지 기반 PDF이거나 빈 문서일 수 있습니다.'],
      stats: {
        originalChars: 0,
        injectedChars: 0,
        estimatedTokens: estimateTokenCount(userQuery),
        documentCount: 0,
      },
    };
  }

  // ── Step 2: 문서별 XML 태그 블록 생성 ──
  //
  // XML 태그를 사용하는 이유:
  //   - LLM이 문서 경계와 메타데이터를 구조적으로 파악할 수 있음
  //   - 다중 문서 시 각 문서를 명확히 구분
  //   - 프롬프트 주입(injection) 공격 완화: 문서 내용이 시스템 명령으로 오인되는 것을 방지
  const documentBlocks: string[] = [];
  let totalOriginalChars = 0;

  for (const doc of sanitized) {
    totalOriginalChars += doc.text.length;
    const pageInfo = doc.pageCount ? ` (${doc.pageCount}페이지)` : '';
    documentBlocks.push(
      `<document name="${escapeXmlAttr(doc.fileName)}"${pageInfo}>\n${doc.text}\n</document>`
    );
  }

  // ── Step 3: 전체 문서 텍스트를 하나로 합치고 글자 수 제한 적용 ──
  let combinedDocText = documentBlocks.join('\n\n');

  if (combinedDocText.length > maxDocumentChars) {
    wasTruncated = true;

    const originalLen = combinedDocText.length;
    combinedDocText = truncateText(combinedDocText, maxDocumentChars, truncationStrategy);

    const truncatedPercent = Math.round((1 - combinedDocText.length / originalLen) * 100);
    const strategyLabel = truncationStrategy === 'head' ? '뒷부분' : '앞부분';
    warnings.push(
      `문서 내용이 모델의 컨텍스트 윈도우를 초과하여 ${strategyLabel}이 약 ${truncatedPercent}% 생략되었습니다. ` +
      `(원본 ${originalLen.toLocaleString()}자 → ${combinedDocText.length.toLocaleString()}자)`
    );
  }

  // ── Step 4: 최종 프롬프트 조립 ──
  //
  // 프롬프트 구조:
  //   1. [옵션] 시스템 프롬프트
  //   2. 문서 컨텍스트 (XML 래핑)
  //   3. 지시문 (문서 기반 응답 유도)
  //   4. 사용자 질문
  const parts: string[] = [];

  if (systemPrompt) {
    parts.push(systemPrompt);
  }

  parts.push(
    `<document_context>\n` +
    `아래는 사용자가 첨부한 문서의 내용입니다. 이 문서를 참고하여 사용자의 질문에 답변해 주세요.\n\n` +
    `${combinedDocText}\n` +
    `</document_context>`
  );

  parts.push(userQuery);

  const finalPrompt = parts.join('\n\n');

  // ── Step 5: 결과 반환 ──
  return {
    prompt: finalPrompt,
    wasTruncated,
    warnings,
    stats: {
      originalChars: totalOriginalChars,
      injectedChars: combinedDocText.length,
      estimatedTokens: estimateTokenCount(finalPrompt),
      documentCount: sanitized.length,
    },
  };
}

/**
 * ChatMessage[] 배열에서 마지막 사용자 메시지의 첨부 문서를 추출하고
 * 자동으로 컨텍스트 빌드를 수행하는 편의 함수.
 *
 * LiteRTLMAdapter.stream()이나 WebLLMAdapter.stream() 내부에서
 * 기존 코드의 최소 수정으로 통합할 수 있도록 설계되었다.
 *
 * @param messages - 전체 대화 히스토리
 * @param options  - 컨텍스트 빌드 옵션
 * @returns 문서가 있으면 ContextBuildResult, 없으면 null
 */
export function buildContextFromMessages(
  messages: ChatMessage[],
  options: ContextBuildOptions = {},
): ContextBuildResult | null {
  const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUserMessage) return null;

  const docAttachments = (lastUserMessage.attachments || []).filter(
    (a: Attachment) => a.type === 'document' && a.textContent && a.textContent.trim().length > 0,
  );

  if (docAttachments.length === 0) return null;

  const documents: ExtractedDocument[] = docAttachments.map((a: Attachment) => ({
    fileName: a.name,
    rawText: a.textContent!,
  }));

  return buildDocumentContext(documents, lastUserMessage.content, options);
}

// ─── 내부 헬퍼 ──────────────────────────────────────────────────────────────────

/** XML 속성값 이스케이프 (파일명에 특수문자가 있을 수 있음) */
function escapeXmlAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ─── 내보내기: 상수 (테스트 및 외부 참조용) ──────────────────────────────────────

export const CONTEXT_LIMITS = {
  MODEL_CONTEXT_WINDOW_TOKENS,
  CHARS_PER_TOKEN,
  RESERVED_PROMPT_TOKENS,
  RESERVED_GENERATION_TOKENS,
  MAX_DOCUMENT_TOKENS,
  MAX_DOCUMENT_CHARS,
} as const;
