/**
 * LiteRTLMAdapter.ts
 *
 * 공통 TypeScript 어댑터: Android(Kotlin)와 iOS(Swift) 네이티브 모듈을 통합 제어합니다.
 *
 * 아키텍처:
 *   JS (LiteRTLMAdapter)
 *     → NativeModules.LiteRT (loadModel / generateStream / unloadModel)
 *     → NativeEventEmitter (onTokenGenerated / onGenerationFinished / onGenerationError)
 *
 * 양 플랫폼 모두 동일한 네이티브 모듈명("LiteRT")과 이벤트명을 사용하므로,
 * 이 어댑터에서 Platform 분기 처리 없이 공통으로 동작합니다.
 *
 * ─── [전략 B: Deferred Interrupt / pendingStop] ─────────────────────────────
 * 문제: 문서 첨부처럼 prefill(문서를 KV 캐시로 쌓는 준비 단계)이 긴 요청에서,
 *       사용자가 첫 토큰이 나오기도 전에 정지 버튼을 누르면 네이티브
 *       interruptGeneration()이 아직 정리되지 않은 prefill 내부 버퍼를 건드리며
 *       SIGSEGV(SEGV_MAPERR)로 앱이 죽는 크래시가 재현되었다.
 *
 * 해결: "첫 토큰(TTFT)이 실제로 도착하기 전까지는 네이티브 중단 호출 자체를
 *       보내지 않고 예약만 해둔다." 첫 토큰이 도착하는 즉시(=decode 단계로
 *       확실히 진입한 시점) 예약된 중단 호출을 그제서야 실행한다.
 *       이렇게 하면 interruptGeneration()은 항상 "decode가 이미 시작된 뒤"에만
 *       호출되며, 이는 지금까지 크래시 없이 안전했던 모든 케이스와 동일한 구간이다.
 */

import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import RNFS from 'react-native-fs';
import type {
  LLMAdapter,
  ChatMessage,
  ModelSpec,
  GenerateOptions,
  StreamChunk,
  ModelLoadState,
  Platform as CorePlatform,
  Attachment,
} from '@repo/ai-core';

// ─── In-Context RAG: 문서 컨텍스트 빌더 (prompt-kit 인라인) ──────────────────
//
// @repo/prompt-kit 패키지의 buildContextFromMessages 로직을 인라인으로 포함.
// 모바일 tsconfig(bundler moduleResolution + resolvePackageJsonImports: false) 환경에서
// workspace 패키지의 dist/ 참조가 불안정하여 직접 포함한다.
// 원본: packages/prompt-kit/src/document-context.ts

const CHARS_PER_TOKEN = 3.0;
// 현재 사용 중인 gemma-4-e4b-it.litertlm 모델은 4096 토큰(Max Seq Len)으로 빌드되어 있습니다.
// 향후 32K를 지원하는 모델로 교체할 경우 이 값을 32768로 변경하면 됩니다.
const MAX_CONTEXT_TOKENS = 4096;
const RESERVED_OUTPUT_TOKENS = 1024; // 출력용
const RESERVED_CHAT_TOKENS = 512; // 프롬프트/히스토리용
const AVAILABLE_DOC_TOKENS = MAX_CONTEXT_TOKENS - RESERVED_OUTPUT_TOKENS - RESERVED_CHAT_TOKENS;
const MAX_DOC_CHARS = Math.floor(AVAILABLE_DOC_TOKENS * CHARS_PER_TOKEN);

function truncateDocText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars);
  const lastNl = slice.lastIndexOf('\n');
  return slice.slice(0, lastNl > maxChars * 0.8 ? lastNl : maxChars);
}

function inlineBuildContext(messages: ChatMessage[]) {
  const last = [...messages].reverse().find((m) => m.role === 'user');
  if (!last) return null;

  const docs = (last.attachments || []).filter(
    (a: Attachment) => a.type === 'document' && a.textContent && a.textContent.trim().length > 0,
  );
  if (docs.length === 0) return null;

  const warnings: string[] = [];
  let wasTruncated = false;

  const blocks = docs.map((a: Attachment) =>
    `<document name="${a.name}">\n${a.textContent!.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim()}\n</document>`
  );
  let combined = blocks.join('\n\n');
  const originalChars = combined.length;

  if (combined.length > MAX_DOC_CHARS) {
    wasTruncated = true;
    const pct = Math.round((1 - MAX_DOC_CHARS / combined.length) * 100);
    combined = truncateDocText(combined, MAX_DOC_CHARS);
    warnings.push(`문서가 너무 길어 뒷부분 약 ${pct}%가 생략되었습니다.`);
  }

  const prompt =
    `<documents>\n아래는 사용자가 첨부한 문서의 내용입니다. 이 문서를 참고하여 사용자의 질문에 답변해 주세요.\n\n${combined}\n</documents>\n\n<user_query>\n${last.content}\n</user_query>`;

  return {
    prompt,
    wasTruncated,
    warnings,
    stats: {
      originalChars,
      injectedChars: combined.length,
      estimatedTokens: Math.ceil(prompt.length / CHARS_PER_TOKEN),
      documentCount: docs.length,
    },
  };
}

// ─── 네이티브 모듈 바인딩 ───────────────────────────────────────────────────
// Android: LiteRTModule.kt (com.mobile.LiteRTModule)
// iOS: LiteRTModule.mm → LiteRTSwiftEngine.swift
const LiteRTModule = NativeModules.LiteRT;
const liteRTEventEmitter = LiteRTModule
  ? new NativeEventEmitter(LiteRTModule)
  : null;

if (liteRTEventEmitter !== null) {
  liteRTEventEmitter?.addListener('onGenerationFinished', () => { console.log('[TEST] ✅ onGenerationFinished received at', Date.now()); });
  liteRTEventEmitter?.addListener('onGenerationSettled', () => { console.log('[TEST] ✅ onGenerationSettled received at', Date.now()); });
}

// ─── 모델 다운로드 URL ──────────────────────────────────────────────────────
const MODEL_DOWNLOAD_URL =
  'https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm/resolve/main/gemma-4-E4B-it.litertlm';
const MODEL_FILENAME = 'gemma-4-e4b-it.litertlm';

export class LiteRTLMAdapter implements LLMAdapter {
  // Platform identifier (core platform)
  platform: CorePlatform = Platform.OS as CorePlatform;

  private isLoaded = false;
  private isDownloaded = false;
  private loadStateListeners: Set<(state: ModelLoadState) => void> = new Set();

  // Promise that resolves when the model is ready for inference
  private readyResolver?: () => void;
  private readyPromise: Promise<void> = new Promise((resolve) => {
    this.readyResolver = resolve;
  });

  // 생성 중단 플래그 (사용자가 중단 의사를 표시했는지 여부 — UI 레이어용)
  private isInterrupted = false;

  // ─── [전략 B 추가] Deferred Interrupt 상태 ────────────────────────────────
  // hasReceivedFirstToken: 현재 스트림에서 첫 토큰(TTFT)이 실제로 도착했는지.
  //   false면 아직 prefill 단계 — 이 구간에서는 절대 네이티브 interrupt를 호출하지 않는다.
  // pendingInterrupt: prefill 중에 사용자가 정지를 눌러 "예약"된 상태인지.
  //   true면 첫 토큰이 도착하는 즉시 네이티브 interruptGeneration()을 실행한다.
  private hasReceivedFirstToken = false;
  private pendingInterrupt = false;

  /**
   * Wait until the native model is loaded and ready.
   * Resolves immediately if already loaded.
   */
  public async waitForReady(): Promise<void> {
    if (this.isLoaded) return;
    await this.readyPromise;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // init: 모델 다운로드 → 네이티브 로드
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  async init(model: ModelSpec): Promise<void> {
    if (this.isLoaded) {
      this.notifyLoadState({ status: 'ready' });
      // Resolve the ready promise if waiting
      if (this.readyResolver) {
        this.readyResolver();
        this.readyResolver = undefined;
      }
      return;
    }

    // ── Phase 1: 모델 파일 다운로드 ──
    if (!this.isDownloaded) {
      this.notifyLoadState({ status: 'downloading', progress: 0 });

      const destPath = `${RNFS.DocumentDirectoryPath}/${MODEL_FILENAME}`;

      try {
        const exists = await RNFS.exists(destPath);
        if (!exists) {
          console.log('[LiteRTLMAdapter] Starting model download to', destPath);
          const downloadResult = RNFS.downloadFile({
            fromUrl: MODEL_DOWNLOAD_URL,
            toFile: destPath,
            progressInterval: 500,
            progress: (res) => {
              const progress =
                res.contentLength > 0
                  ? Math.round((res.bytesWritten / res.contentLength) * 100)
                  : 0;
              this.notifyLoadState({ status: 'downloading', progress });
            },
          });

          const result = await downloadResult.promise;
          if (result.statusCode !== 200) {
            throw new Error(
              `Download failed with status ${result.statusCode}`,
            );
          }
        }
        this.isDownloaded = true;
      } catch (e) {
        console.error('[LiteRTLMAdapter] Download error:', e);
        this.notifyLoadState({
          status: 'error',
          message: 'Failed to download model file.',
        });
        return;
      }
    }

    // ── Phase 2: 네이티브 모듈로 모델 로드 ──
    this.notifyLoadState({ status: 'loading', progress: 100 });

    try {
      const destPath = `${RNFS.DocumentDirectoryPath}/${MODEL_FILENAME}`;

      if (LiteRTModule) {
        await LiteRTModule.loadModel(destPath);
      } else {
        console.warn(
          '[LiteRTLMAdapter] LiteRTModule is not linked. Skipping loadModel.',
        );
      }

      this.isLoaded = true;
      this.notifyLoadState({ status: 'ready' });
      // Resolve any pending waitForReady callers
      if (this.readyResolver) {
        this.readyResolver();
        this.readyResolver = undefined;
      }
    } catch (error) {
      console.error('[LiteRTLMAdapter] Failed to load native model:', error);
      this.notifyLoadState({ status: 'error', message: 'Failed to load model' });
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // warmup: 모델 웜업 (현재는 로드 상태 확인만)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  async warmup(): Promise<void> {
    if (!this.isLoaded) throw new Error('Model not loaded');
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // generate: 전체 응답을 한 번에 반환 (stream을 내부적으로 소비)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  async generate(
    messages: ChatMessage[],
    options?: GenerateOptions,
  ): Promise<string> {
    let result = '';
    for await (const chunk of this.stream(messages, options)) {
      if (chunk.type === 'text-delta') {
        result += chunk.text;
      }
    }
    return result;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // stream: 비동기 제너레이터로 토큰 단위 스트리밍
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //
  // 네이티브 이벤트 ↔ JS AsyncGenerator 브릿지:
  // 1. NativeEventEmitter로 이벤트를 구독
  // 2. 토큰 도착 시 Promise resolve → yield → 다음 Promise 대기
  // 3. 생성 완료/에러/중단 시 null resolve → 루프 탈출
  // 4. finally에서 모든 리스너를 반드시 해제 (메모리 누수 방지)

  async *stream(
    messages: ChatMessage[],
    options?: GenerateOptions,
  ): AsyncIterable<StreamChunk> {
    // Ensure the model is loaded before streaming
    if (!this.isLoaded) {
      // Wait for the model to become ready (e.g., after init completes)
      await this.readyPromise;
    }

    // [전략 B 추가] 새 스트림을 시작할 때마다 TTFT/예약 상태를 반드시 초기화한다.
    // (이전 요청의 상태가 남아있으면 잘못된 시점에 interrupt가 실행될 수 있음)
    this.hasReceivedFirstToken = false;
    this.pendingInterrupt = false;

    // 마지막 user 메시지만 프롬프트로 사용
    const lastUserMessage =
      messages.filter((m) => m.role === 'user').pop();
    const userText = (lastUserMessage?.content || '').trim();
    const attachments = lastUserMessage?.attachments || [];

    // 이미지 첨부파일 → 네이티브 Content.ImageFile로 전달
    const imagePaths = attachments
      .filter((a) => a.type === 'image')
      .map((a) => a.uri.replace('file://', ''));

    // 문서 첨부파일 → prompt-kit 컨텍스트 빌더로 처리
    // 토큰 예산 관리, 자동 잘림, XML 구조화가 자동 적용된다.
    const contextResult = inlineBuildContext(messages);
    let cleanPrompt: string;

    if (contextResult) {
      cleanPrompt = contextResult.prompt;
      if (contextResult.wasTruncated) {
        console.warn(
          '[LiteRTLMAdapter] 문서가 잘렸습니다:',
          contextResult.warnings,
        );
      }
      console.log(
        `[LiteRTLMAdapter] 문서 컨텍스트 주입: ${contextResult.stats.documentCount}개 문서, ` +
        `${contextResult.stats.injectedChars.toLocaleString()}자 (≈${contextResult.stats.estimatedTokens} 토큰)`,
      );
    } else {
      cleanPrompt = userText;
    }

    // 비동기 이벤트 → 동기 yield 변환을 위한 상태
    let resolveNextChunk: ((chunk: StreamChunk | null) => void) | null = null;
    let isFinished = false;
    let tokenCount = 0;
    const startTime = Date.now();
    const chunkQueue: StreamChunk[] = [];

    // ── 이벤트 리스너 등록 ──

    const tokenListener = liteRTEventEmitter?.addListener(
      'onTokenGenerated',
      (event) => {
        // [전략 B 추가] 이번 스트림에서 처음 도착한 토큰인지 확인.
        // 첫 토큰 = "네이티브가 확실히 prefill을 끝내고 decode 단계에 들어갔다"는 증거.
        // 이 시점부터는 interruptGeneration() 호출이 안전하다.
        if (!this.hasReceivedFirstToken) {
          this.hasReceivedFirstToken = true;
          console.log(
            `[LiteRTLMAdapter] 🎯 First token received (TTFT) — safe-to-interrupt window opened at ${Date.now()}`,
          );

          // prefill 중에 눌러서 예약돼 있던 정지 요청이 있다면 지금 실행한다.
          if (this.pendingInterrupt) {
            this.pendingInterrupt = false;
            console.log(
              '[LiteRTLMAdapter] ⏩ Executing deferred interrupt now that TTFT has occurred',
            );
            LiteRTModule?.interruptGeneration().catch((e: any) => {
              console.error('[LiteRTLMAdapter] Deferred interrupt call failed:', e);
            });
          }
        }

        const chunk: StreamChunk = { type: 'text-delta', text: event.text };
        tokenCount++;

        if (resolveNextChunk) {
          resolveNextChunk(chunk);
          resolveNextChunk = null;
        } else {
          chunkQueue.push(chunk);
        }
      },
    );

    const finishListener = liteRTEventEmitter?.addListener(
      'onGenerationFinished',
      () => {
        isFinished = true;
        if (resolveNextChunk) {
          resolveNextChunk(null);
          resolveNextChunk = null;
        }
      },
    );

    const errorListener = liteRTEventEmitter?.addListener(
      'onGenerationError',
      (event) => {
        console.error(
          '[LiteRTLMAdapter] Native generation error event:',
          event.error,
        );
        isFinished = true;
        if (resolveNextChunk) {
          resolveNextChunk(null);
          resolveNextChunk = null;
        }
      },
    );

    // 생성 중단 이벤트 리스너 (네이티브가 실제로 중단을 반영했음을 알리는 신호)
    const interruptedListener = liteRTEventEmitter?.addListener(
      'onGenerationInterrupted',
      (event: { tokenCount: number; elapsedMs: number }) => {
        console.log(`[LiteRTPerf] ⏹ JS received interrupted event at ${Date.now()}`);
        console.log(
          `[LiteRTLMAdapter] Generation interrupted at token #${event.tokenCount} (${event.elapsedMs}ms)`,
        );
        isFinished = true;
        if (resolveNextChunk) {
          resolveNextChunk(null);
          resolveNextChunk = null;
        }
      },
    );

    // ── 네이티브 추론 시작 (백그라운드 실행) ──

    if (LiteRTModule) {
      const nativeCall = imagePaths.length > 0
        ? LiteRTModule.generateStreamWithMedia(cleanPrompt, imagePaths)
        : LiteRTModule.generateStream(cleanPrompt);

      // [변경] BUSY(이전 생성이 백그라운드에서 아직 정리 중) 에러는
      // 버그가 아니라 전략 A(Soft Stop)의 정상적인 가드 동작이므로
      // console.error로 띄우지 않고 조용히 처리한다.
      // 그 외의 진짜 에러만 console.error로 남긴다.
      nativeCall.catch((error: any) => {
        const isBusyGuard =
          error?.code === 'BUSY' ||
          (typeof error?.message === 'string' &&
            error.message.includes('still finishing'));

        if (isBusyGuard) {
          console.log(
            '[LiteRTLMAdapter] Previous generation still settling, request ignored',
          );
          // 필요하면 사용자에게 짧은 토스트만 띄우기
          // showToast('이전 응답이 정리 중입니다. 잠시 후 다시 시도해주세요.');
        } else {
          console.error('[LiteRTLMAdapter] Native generateStream error:', error);
        }
        isFinished = true;
        (resolveNextChunk as any)?.(null);
      });
    } else {
      isFinished = true;
      (resolveNextChunk as any)?.(null);
    }

    // ── 토큰 yield 루프 ──

    try {
      while (true) {
        if (chunkQueue.length > 0) {
          yield chunkQueue.shift()!;
        } else if (isFinished) {
          break;
        } else {
          // 다음 이벤트가 도착할 때까지 대기
          const chunk = await new Promise<StreamChunk | null>((resolve) => {
            resolveNextChunk = resolve;
          });
          if (chunk) {
            yield chunk;
          } else {
            break; // null → 스트림 종료
          }
        }
      }
    } finally {
      // ── 리스너 해제 (메모리 누수 방지) ──
      tokenListener?.remove();
      finishListener?.remove();
      errorListener?.remove();
      interruptedListener?.remove();
      this.isInterrupted = false;
      // [전략 B 추가] 스트림 종료 시 다음 요청을 위해 반드시 초기화
      this.hasReceivedFirstToken = false;
      this.pendingInterrupt = false;

      // ── 통계 정보 발행 ──
      const totalMs = Date.now() - startTime;
      yield {
        type: 'done',
        stats: {
          tokenCount,
          totalMs,
          tokensPerSecond: tokenCount / (totalMs / 1000) || 0,
        },
      } as StreamChunk;
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // interrupt: 추론 중단
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //
  // [전략 B 추가] 반환값 deferred:
  //   true  → 아직 prefill 중이라 실제 네이티브 호출을 미루고 "예약"만 했음
  //   false → decode 단계로 이미 진입해서 네이티브 interrupt를 즉시 호출했음
  // 호출부(ChatRoomScreen)는 이 값으로 "정지 예약됨" 안내를 잠깐 보여줄 수 있다.

  async interrupt(): Promise<void> {
  console.log('[LiteRTLMAdapter] Interrupt requested');
  this.isInterrupted = true;

  // ★ 핵심: 아직 첫 토큰이 도착하지 않았다면(=prefill 진행 중)
  // 네이티브 interruptGeneration()을 절대 지금 호출하지 않는다.
  // 대신 pendingInterrupt만 세팅해두고, stream()의 첫 토큰 수신 시점에서
  // 안전하게 실행되도록 넘긴다. 이게 문서 첨부 시 발생하던
  // SIGSEGV(SEGV_MAPERR) 크래시를 막는 부분이다.
  if (!this.hasReceivedFirstToken) {
    console.log(
      '[LiteRTLMAdapter] ⏳ Still in prefill (no token yet) — deferring native interrupt until TTFT',
    );
    this.pendingInterrupt = true;
    return; // void — deferred 상태는 getter로 확인
  }

  try {
    if (LiteRTModule) {
      await LiteRTModule.interruptGeneration();
    }
  } catch (e) {
    console.error('[LiteRTLMAdapter] Interrupt bridge call failed:', e);
  }
}
// [전략 B 추가] 방금 호출한 interrupt()가 실제로는 실행되지 않고
// "예약"만 된 상태인지 확인하는 getter.
// stream()의 finally 블록에서 pendingInterrupt를 리셋하기 전에,
// 호출부가 interrupt() 직후 동기적으로 읽어야 정확한 값을 얻는다.
public get wasInterruptDeferred(): boolean {
  return this.pendingInterrupt;
}

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // unload: 네이티브 모델 해제 및 상태 리셋
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  async unload(): Promise<void> {
    if (this.isLoaded) {
      if (LiteRTModule) {
        await LiteRTModule.unloadModel();
      }
      this.isLoaded = false;
    }
    this.notifyLoadState({ status: 'idle' });
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 로드 상태 옵저버
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  onLoadStateChange(callback: (state: ModelLoadState) => void): () => void {
    this.loadStateListeners.add(callback);
    return () => {
      this.loadStateListeners.delete(callback);
    };
  }

  private notifyLoadState(state: ModelLoadState) {
    this.loadStateListeners.forEach((listener) => listener(state));
  }
}