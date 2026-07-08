/**
 * pdf-parser.ts (Mobile / React Native 환경)
 *
 * 디바이스 내부에서 PDF 파일의 텍스트를 추출하는 유틸리티.
 *
 * ─── 전략 ─────────────────────────────────────────────────────────────────────
 *
 * 모바일 환경에서 PDF 텍스트를 추출하는 방법은 크게 세 가지이다:
 *
 *   A) JS 순수 파싱 (pdf-parse / pdf.js 서버 빌드):
 *      → React Native의 JavaScript 엔진(Hermes)은 브라우저 API(Canvas, DOM)가 없어
 *        pdf.js 브라우저 빌드는 사용 불가. 그러나 pdf-parse(pdf.js의 Node 래퍼)는
 *        Canvas 없이 텍스트만 추출하므로 Hermes에서도 동작 가능.
 *        단, 대형 PDF에서 Hermes의 싱글 스레드 특성상 UI가 블록될 수 있다.
 *
 *   B) 네이티브 브릿지:
 *      → Android: PdfRenderer(API 21+) 또는 Apache PDFBox
 *      → iOS: PDFKit (기본 프레임워크)
 *      각 플랫폼의 네이티브 PDF 파서를 NativeModule로 노출.
 *      가장 성능이 좋지만 네이티브 코드 유지보수 비용 발생.
 *
 *   C) react-native-pdf-text-extract 등 커뮤니티 라이브러리:
 *      → PDFKit(iOS) / PdfRenderer(Android)를 이미 래핑한 라이브러리 사용.
 *
 * 이 구현에서는 B) 네이티브 브릿지 방식을 채택한다.
 * 별도의 네이티브 모듈(PdfTextExtractModule)을 Android/iOS에 작성하고,
 * 이 TypeScript 파일은 그 브릿지를 호출하는 얇은 래퍼 역할을 한다.
 *
 * 네이티브 모듈이 아직 구현되지 않은 경우를 대비해,
 * react-native-fs로 파일을 읽어 텍스트 기반 PDF인지 시도하는 폴백도 포함한다.
 *
 * ─── 메모리 고려사항 ──────────────────────────────────────────────────────────
 *
 *   - 모바일 디바이스의 가용 메모리는 데스크톱보다 제한적이다 (보통 2~4GB).
 *   - 현재 Gemma 4 E4B 모델이 이미 ~1.5GB를 차지하고 있으므로,
 *     PDF 파싱 시 추가 메모리 사용을 최소화해야 한다.
 *   - 네이티브 브릿지 방식은 PDF 바이너리를 JS 힙이 아닌 네이티브 힙에서 처리하므로
 *     JS GC 압박을 줄일 수 있다.
 *   - 최종 추출된 텍스트(문자열)만 JS 레이어로 전달된다.
 *
 * ─── 파일 접근 권한 ───────────────────────────────────────────────────────────
 *
 *   - Android:
 *     · API 33+: READ_MEDIA_IMAGES (이미지용), 일반 파일은 SAF(Storage Access Framework) 사용
 *     · DocumentPicker로 선택한 파일은 content:// URI를 반환하며,
 *       react-native-fs의 readFile로 직접 읽을 수 있다.
 *     · AndroidManifest.xml에 READ_EXTERNAL_STORAGE는 이미 선언되어 있음 (Phase 3에서 추가)
 *
 *   - iOS:
 *     · UIDocumentPickerViewController로 선택된 파일은 임시 보안 범위 URL을 반환
 *     · 해당 URL은 앱의 샌드박스 내에서만 접근 가능
 *     · Info.plist의 NSDocumentsFolderUsageDescription은 이미 선언됨
 *
 * ─── 아키텍처 위치 ────────────────────────────────────────────────────────────
 *
 *   apps/mobile/src/utils/pdf-parser.ts  ← 이 파일
 *        ↓ ExtractedDocument 반환
 *   packages/prompt-kit  →  buildDocumentContext() 호출
 */

import { NativeModules, Platform } from 'react-native';
import RNFS from 'react-native-fs';

// Hermes 엔진은 atob/btoa를 전역으로 제공하지만,
// React Native의 TypeScript 타입 정의(@types/react-native)에는
// 이 함수가 선언되어 있지 않다. 명시적으로 선언하여 타입 에러를 해소한다.
declare function atob(data: string): string;

// prompt-kit의 ExtractedDocument 타입을 인라인으로 재정의.
// 모바일 tsconfig의 moduleResolution: 'bundler' + resolvePackageJsonImports: false 조합에서
// workspace 패키지의 dist/ 참조가 불안정할 수 있으므로, 런타임 의존 없이 타입만 복제한다.
// 이 타입은 packages/prompt-kit/src/document-context.ts의 ExtractedDocument와 동일하다.
export interface ExtractedDocument {
  fileName: string;
  rawText: string;
  pageCount?: number;
}

// ─── 네이티브 모듈 바인딩 ────────────────────────────────────────────────────
//
// 이 모듈은 Android(Kotlin)와 iOS(Swift)에서 각각 구현해야 한다:
//
// Android: PdfTextExtractModule.kt
//   @ReactMethod
//   fun extractText(filePath: String, promise: Promise) {
//       // PdfRenderer 또는 PDFBox를 사용하여 텍스트 추출
//       // promise.resolve(mapOf("text" to extractedText, "pageCount" to numPages))
//   }
//
// iOS: PdfTextExtractModule.swift
//   @objc func extractText(_ filePath: String,
//                           resolver: @escaping RCTPromiseResolveBlock,
//                           rejecter: @escaping RCTPromiseRejectBlock) {
//       // PDFKit을 사용하여 텍스트 추출
//       // resolver(["text": extractedText, "pageCount": numPages])
//   }

interface PdfTextExtractNative {
  extractText(filePath: string): Promise<{ text: string; pageCount: number }>;
}

const PdfTextExtractModule: PdfTextExtractNative | null =
  NativeModules.PdfTextExtract || null;

// ─── 상수 ──────────────────────────────────────────────────────────────────────

/** 허용 최대 파일 크기 (30MB). 모바일 메모리 보호용. 웹보다 보수적. */
const MAX_FILE_SIZE_BYTES = 30 * 1024 * 1024;

// ─── 타입 ──────────────────────────────────────────────────────────────────────

export interface MobilePdfParseOptions {
  /**
   * 파일 크기 제한 (바이트 단위). 기본값: 30MB.
   * DocumentPicker의 결과에서 size 값으로 사전 검증한다.
   */
  maxFileSizeBytes?: number;

  /**
   * content:// URI를 파일 시스템 경로로 변환하기 위해
   * RNFS.copyFile로 임시 경로에 복사할지 여부.
   *
   * Android의 content:// URI는 네이티브 모듈에서 직접 읽을 수 없는 경우가 있으므로
   * true(기본값)로 설정하면 RNFS.TemporaryDirectoryPath에 복사한 뒤 파싱한다.
   */
  copyToTempIfContentUri?: boolean;
}

export interface MobilePdfParseResult {
  /** prompt-kit에 전달할 수 있는 문서 객체 */
  document: ExtractedDocument;

  /** 경고 메시지 */
  warnings: string[];
}

// ─── 메인 함수 ─────────────────────────────────────────────────────────────────

/**
 * 모바일 디바이스에서 PDF 파일의 텍스트를 추출한다.
 *
 * @example
 * ```ts
 * // DocumentPicker 결과에서 PDF 파싱
 * const pickerResult = await pick({ type: [types.pdf] });
 * for (const doc of pickerResult) {
 *   const result = await parsePdfFromUri(doc.uri, doc.name, {
 *     maxFileSizeBytes: doc.size,
 *   });
 *   // prompt-kit으로 전달
 *   const context = buildDocumentContext([result.document], userQuery);
 * }
 * ```
 *
 * @param uri      - 파일 URI (file:// 또는 content:// 스킴)
 * @param fileName - 원본 파일명 (표시용)
 * @param options  - 파싱 옵션
 * @returns 추출된 문서 + 경고
 * @throws 파일 접근 불가, 크기 초과, 네이티브 모듈 미구현 시
 */
export async function parsePdfFromUri(
  uri: string,
  fileName: string,
  options: MobilePdfParseOptions = {},
): Promise<MobilePdfParseResult> {
  const {
    maxFileSizeBytes = MAX_FILE_SIZE_BYTES,
    copyToTempIfContentUri = true,
  } = options;

  const warnings: string[] = [];

  // ── Step 1: URI 정규화 및 파일 경로 확보 ──
  //
  // Android DocumentPicker는 content://... URI를 반환한다.
  // 네이티브 모듈이 이를 직접 처리할 수 없는 경우를 대비해
  // 임시 디렉토리로 복사한다.
  let filePath = uri;
  let tempCopyPath: string | null = null;

  const isContentUri = uri.startsWith('content://');
  const needsCopy = Platform.OS === 'android' && isContentUri && copyToTempIfContentUri;

  if (needsCopy) {
    // RNFS.TemporaryDirectoryPath는 앱 전용 캐시 디렉토리를 가리킨다
    // (Android: /data/data/<package>/cache, iOS: NSTemporaryDirectory)
    const tempFileName = `pdf_parse_${Date.now()}_${fileName}`;
    tempCopyPath = `${RNFS.TemporaryDirectoryPath}/${tempFileName}`;

    try {
      await RNFS.copyFile(uri, tempCopyPath);
      filePath = tempCopyPath;
    } catch (copyError) {
      console.warn(
        '[pdf-parser] content:// URI 복사 실패, 원본 URI로 시도:',
        copyError,
      );
      filePath = uri;
      tempCopyPath = null;
    }
  }

  // file:// 스킴 제거 (네이티브 모듈은 절대 경로를 기대)
  filePath = filePath.replace(/^file:\/\//, '');
  
  // URL 디코딩 (한글 파일명, 공백(%20) 등 복원)
  try {
    filePath = decodeURIComponent(filePath);
  } catch (e) {
    // 디코딩 실패 시 무시
  }

  // ── Step 2: 파일 크기 검증 ──
  try {
    const stat = await RNFS.stat(filePath);
    const fileSize = Number(stat.size);

    if (fileSize > maxFileSizeBytes) {
      throw new Error(
        `파일 크기(${(fileSize / 1024 / 1024).toFixed(1)}MB)가 ` +
        `허용 한도(${(maxFileSizeBytes / 1024 / 1024).toFixed(0)}MB)를 초과합니다.`
      );
    }
  } catch (statError: any) {
    // stat 실패 시 (content:// URI 등) 크기 검증을 건너뛴다
    if (statError.message?.includes('초과')) throw statError;
    console.warn('[pdf-parser] 파일 크기 확인 실패, 계속 진행:', statError.message);
  }

  // ── Step 3: 텍스트 추출 ──
  let extractedText = '';
  let pageCount: number | undefined;

  if (PdfTextExtractModule) {
    // ━━ 방법 A: 네이티브 브릿지 사용 (권장) ━━
    //
    // PdfTextExtractModule.extractText()는 네이티브 레이어에서
    // PDFKit(iOS) / PDFBox(Android)를 사용하여 텍스트를 추출한다.
    // JS 힙에는 최종 문자열만 전달되므로 메모리 효율적이다.
    try {
      const result = await PdfTextExtractModule.extractText(filePath);
      extractedText = result.text || '';
      pageCount = result.pageCount;
    } catch (nativeError: any) {
      console.error('[pdf-parser] 네이티브 PDF 파싱 실패:', nativeError);
      warnings.push(`네이티브 PDF 파서 오류: ${nativeError.message}`);

      // 네이티브 실패 시 폴백으로 시도
      extractedText = await fallbackTextExtraction(filePath, warnings);
    }
  } else {
    // ━━ 방법 B: 폴백 — 바이너리에서 텍스트 스트림 직접 추출 ━━
    //
    // 네이티브 모듈이 아직 구현되지 않았거나 링크되지 않은 경우,
    // PDF 바이너리를 읽어 텍스트 스트림을 휴리스틱으로 추출한다.
    // 정확도가 낮지만, 개발 단계에서 빠르게 테스트할 수 있다.
    console.warn(
      '[pdf-parser] PdfTextExtractModule이 링크되지 않았습니다. 폴백 모드로 동작합니다.',
    );
    warnings.push(
      'PDF 네이티브 파서가 설치되지 않아 제한적 텍스트 추출을 사용합니다. ' +
      '정확한 결과를 위해 PdfTextExtractModule 네이티브 모듈을 구현해 주세요.',
    );

    extractedText = await fallbackTextExtraction(filePath, warnings);
  }

  // ── Step 4: 빈 텍스트 감지 ──
  if (!extractedText || extractedText.trim().length === 0) {
    warnings.push(
      '문서에서 텍스트를 추출할 수 없습니다. ' +
      '이미지 기반(스캔) PDF이거나 비어있는 문서일 수 있습니다.',
    );
  }

  // ── Step 5: 임시 파일 정리 ──
  if (tempCopyPath) {
    try {
      await RNFS.unlink(tempCopyPath);
    } catch {
      // 임시 파일 삭제 실패는 치명적이지 않음 — 시스템이 캐시를 자동 정리
    }
  }

  return {
    document: {
      fileName,
      rawText: extractedText,
      pageCount,
    },
    warnings,
  };
}

// ─── 폴백: PDF 바이너리에서 텍스트 스트림 추출 ──────────────────────────────────
//
// PDF 파일 내부의 텍스트는 "stream ... endstream" 블록 안에
// Flate/ASCII 인코딩으로 저장된다. 이 폴백은 인코딩되지 않은(plain text)
// 스트림만 추출할 수 있으며, 압축된 스트림은 처리하지 못한다.
//
// 이는 네이티브 모듈 구현 전의 임시 방편으로만 사용해야 한다.

async function fallbackTextExtraction(
  filePath: string,
  warnings: string[],
): Promise<string> {
  try {
    // PDF를 base64로 읽어 바이너리 분석
    // (UTF-8로 읽으면 바이너리 부분에서 깨짐)
    const base64Content = await RNFS.readFile(filePath, 'base64');
    const binaryString = atob(base64Content);

    // PDF 텍스트 오브젝트에서 텍스트 추출 시도
    // BT (Begin Text) ... ET (End Text) 블록을 찾아 Tj/TJ 연산자의 텍스트를 수집
    const textSegments: string[] = [];
    const tjRegex = /\(([^)]*)\)\s*Tj/g;
    let match;

    while ((match = tjRegex.exec(binaryString)) !== null) {
      const raw = match[1];
      // PDF 이스케이프 시퀀스 디코딩
      const decoded = raw
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\\\/g, '\\')
        .replace(/\\([()])/g, '$1');
      if (decoded.trim()) {
        textSegments.push(decoded);
      }
    }

    if (textSegments.length === 0) {
      warnings.push(
        '폴백 파서로도 텍스트를 추출할 수 없습니다. ' +
        '네이티브 PdfTextExtractModule 구현이 필요합니다.',
      );
      return '';
    }

    warnings.push(
      `폴백 모드로 ${textSegments.length}개의 텍스트 조각을 추출했습니다. ` +
      `결과가 불완전할 수 있습니다.`,
    );

    return textSegments.join(' ');
  } catch (readError: any) {
    warnings.push(`PDF 파일 읽기 실패: ${readError.message}`);
    return '';
  }
}
