/**
 * pdf-parser.ts (Web / 브라우저 환경)
 *
 * Mozilla pdf.js를 사용하여 브라우저 메인 스레드(또는 Web Worker)에서
 * PDF 파일의 텍스트를 추출하는 유틸리티.
 *
 * ─── 의존성 ───────────────────────────────────────────────────────────────────
 *
 *   pnpm add pdfjs-dist
 *
 *   pdf.js는 순수 JavaScript PDF 렌더러로, 서버 없이 브라우저에서 PDF를 파싱한다.
 *   worker 파일은 CDN이나 번들러를 통해 제공해야 한다(아래 workerSrc 참조).
 *
 * ─── 메모리 고려사항 ──────────────────────────────────────────────────────────
 *
 *   - pdf.js는 페이지 단위로 텍스트를 추출하므로, 전체 문서를 한 번에 메모리에
 *     올리지 않아도 된다. 그러나 최종 결합된 텍스트 문자열은 메모리를 차지하므로,
 *     prompt-kit의 MAX_DOCUMENT_CHARS로 제한된다.
 *
 *   - ArrayBuffer → pdf.js 파싱 → 텍스트 추출 후 ArrayBuffer 참조를 해제하면
 *     GC가 원본 바이너리를 수거한다.
 *
 *   - 100MB 이상의 대형 PDF는 브라우저 탭 메모리 제한(~2GB)에 걸릴 수 있으므로,
 *     파일 선택 시 사전 크기 검증을 권장한다 (50MB 이하 권장).
 *
 * ─── 제한사항 ─────────────────────────────────────────────────────────────────
 *
 *   - 이미지 기반 PDF (스캔 문서)에서는 텍스트가 추출되지 않는다.
 *     → OCR이 필요한 경우 Tesseract.js 등의 별도 처리가 필요하며,
 *       현재 버전에서는 빈 텍스트 + 경고를 반환한다.
 *
 *   - 암호화된(비밀번호 보호) PDF는 pdf.js가 지원하지만,
 *     비밀번호 입력 UI는 호출 측에서 처리해야 한다.
 *
 * ─── 아키텍처 위치 ────────────────────────────────────────────────────────────
 *
 *   apps/web/src/utils/pdf-parser.ts  ← 이 파일 (브라우저 전용)
 *        ↓ ExtractedDocument 반환
 *   packages/prompt-kit  →  buildDocumentContext() 호출
 */

import * as pdfjsLib from 'pdfjs-dist';
import type { ExtractedDocument } from '@repo/prompt-kit';

// ─── pdf.js Worker 설정 ────────────────────────────────────────────────────────
//
// pdf.js는 무거운 파싱 작업을 Web Worker로 위임한다.
// Vite 환경에서는 ?url import로 워커 파일을 번들링할 수도 있고,
// CDN에서 직접 로드할 수도 있다.
//
// 방법 1: CDN (간편, 버전 고정 필요)
// pdfjsLib.GlobalWorkerOptions.workerSrc =
//   `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
//
// 방법 2: 로컬 번들 (Vite 권장)
// import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
// pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
//
// 여기서는 CDN 방식을 기본으로 사용하되, 환경변수로 오버라이드 가능하게 한다.

if (typeof window !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
}

// ─── 상수 ──────────────────────────────────────────────────────────────────────

/** 허용 최대 파일 크기 (50MB). 브라우저 메모리 보호용. */
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

// ─── 타입 ──────────────────────────────────────────────────────────────────────

export interface WebPdfParseOptions {
  /**
   * 암호화된 PDF의 비밀번호. 미지정 시 비밀번호 없이 시도.
   */
  password?: string;

  /**
   * 파일 크기 제한 (바이트 단위). 기본값: 50MB.
   * File 객체의 size 속성으로 사전 검증한다.
   */
  maxFileSizeBytes?: number;

  /**
   * 진행률 콜백. 대형 PDF 파싱 시 UI 피드백용.
   * @param current - 현재 처리 완료된 페이지 번호
   * @param total   - 전체 페이지 수
   */
  onProgress?: (current: number, total: number) => void;
}

export interface WebPdfParseResult {
  /** prompt-kit에 전달할 수 있는 문서 객체 */
  document: ExtractedDocument;

  /** 경고 메시지 (이미지 기반 페이지 감지 등) */
  warnings: string[];
}

// ─── 메인 함수 ─────────────────────────────────────────────────────────────────

/**
 * 브라우저 File 객체에서 PDF 텍스트를 추출한다.
 *
 * @example
 * ```ts
 * // <input type="file" accept=".pdf">의 onChange 핸들러 내부
 * const file = event.target.files[0];
 * const result = await parsePdfFromFile(file);
 *
 * if (result.warnings.length > 0) {
 *   console.warn('PDF 파싱 경고:', result.warnings);
 * }
 *
 * // prompt-kit으로 전달
 * const context = buildDocumentContext([result.document], userQuery);
 * ```
 *
 * @param file    - 사용자가 선택한 PDF File 객체
 * @param options - 파싱 옵션
 * @returns 추출된 문서 + 경고
 * @throws 파일 크기 초과, 지원 불가 형식, pdf.js 내부 에러 시
 */
export async function parsePdfFromFile(
  file: File,
  options: WebPdfParseOptions = {},
): Promise<WebPdfParseResult> {
  const { password, maxFileSizeBytes = MAX_FILE_SIZE_BYTES, onProgress } = options;
  const warnings: string[] = [];

  // ── 사전 검증 ──
  if (file.size > maxFileSizeBytes) {
    throw new Error(
      `파일 크기(${(file.size / 1024 / 1024).toFixed(1)}MB)가 ` +
      `허용 한도(${(maxFileSizeBytes / 1024 / 1024).toFixed(0)}MB)를 초과합니다.`
    );
  }

  if (file.type && file.type !== 'application/pdf') {
    throw new Error(`지원하지 않는 파일 형식입니다: ${file.type}`);
  }

  // ── ArrayBuffer 로드 ──
  //
  // File.arrayBuffer()는 모든 모던 브라우저에서 지원된다.
  // 이 시점에서 전체 PDF 바이너리가 메모리에 올라간다.
  const arrayBuffer = await file.arrayBuffer();

  // ── pdf.js로 파싱 ──
  const result = await parsePdfFromArrayBuffer(arrayBuffer, {
    fileName: file.name,
    password,
    onProgress,
  });

  // arrayBuffer 참조를 해제하여 GC 수거 유도
  // (변수가 스코프를 벗어나면 자동 해제되지만, 명시적으로 표현)

  return {
    document: result.document,
    warnings: [...warnings, ...result.warnings],
  };
}

/**
 * ArrayBuffer에서 직접 PDF 텍스트를 추출한다.
 *
 * fetch()로 PDF를 다운로드한 경우 등, File 객체 없이 바이너리를 갖고 있을 때 사용.
 *
 * @param buffer   - PDF 바이너리 데이터
 * @param metadata - 파일명 등 메타데이터
 * @returns 추출된 문서 + 경고
 */
export async function parsePdfFromArrayBuffer(
  buffer: ArrayBuffer,
  metadata: {
    fileName: string;
    password?: string;
    onProgress?: (current: number, total: number) => void;
  },
): Promise<WebPdfParseResult> {
  const { fileName, password, onProgress } = metadata;
  const warnings: string[] = [];

  // ── pdf.js 문서 로드 ──
  //
  // getDocument()는 비동기적으로 PDF 구조를 파싱한다.
  // data 옵션에 ArrayBuffer를 전달하면 pdf.js가 내부적으로 복사하므로
  // 원본 buffer는 이후 참조 해제해도 안전하다.
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    password: password || undefined,
  });

  const pdfDocument = await loadingTask.promise;
  const numPages = pdfDocument.numPages;

  // ── 페이지별 텍스트 추출 ──
  //
  // 각 페이지의 텍스트를 순차적으로 추출한다.
  // 병렬 처리(Promise.all)도 가능하지만, 메모리 피크를 낮추기 위해
  // 순차 처리를 선택한다.
  const pageTexts: string[] = [];
  let emptyPageCount = 0;

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdfDocument.getPage(pageNum);
    const textContent = await page.getTextContent();

    // TextItem[].str을 공백으로 연결하여 한 줄의 텍스트로 만듦
    // hasEOL이 true인 항목 뒤에는 줄바꿈을 삽입
    const pageText = textContent.items
      .map((item: any) => {
        // TextItem에는 str 속성이 있고, TextMarkedContent에는 없다
        if ('str' in item) {
          return item.str + (item.hasEOL ? '\n' : '');
        }
        return '';
      })
      .join('')
      .trim();

    if (pageText.length === 0) {
      emptyPageCount++;
    }

    pageTexts.push(pageText);

    // 페이지 리소스 해제 (메모리 절약)
    page.cleanup();

    // 진행률 콜백
    onProgress?.(pageNum, numPages);
  }

  // ── 결과 조합 ──
  const fullText = pageTexts
    .map((text, i) => (text ? `--- 페이지 ${i + 1} ---\n${text}` : ''))
    .filter(Boolean)
    .join('\n\n');

  // 이미지 기반 PDF 감지: 전체 페이지의 50% 이상이 빈 텍스트이면 경고
  if (emptyPageCount > 0) {
    const emptyRatio = emptyPageCount / numPages;
    if (emptyRatio >= 0.5) {
      warnings.push(
        `전체 ${numPages}페이지 중 ${emptyPageCount}페이지에서 텍스트가 추출되지 않았습니다. ` +
        `이미지 기반(스캔) PDF일 수 있으며, 해당 페이지의 내용은 분석에 포함되지 않습니다.`
      );
    } else if (emptyPageCount > 0) {
      warnings.push(
        `${emptyPageCount}개 페이지에서 텍스트가 추출되지 않았습니다.`
      );
    }
  }

  // pdf.js 문서 리소스 해제
  await pdfDocument.destroy();

  return {
    document: {
      fileName,
      rawText: fullText,
      pageCount: numPages,
    },
    warnings,
  };
}
