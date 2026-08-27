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

import { NativeModules, DeviceEventEmitter, Platform, PermissionsAndroid, Alert, NativeEventEmitter } from 'react-native';
import RNFS from 'react-native-fs';
import ReactNativeBlobUtil from 'react-native-blob-util';
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
// 한국어 및 PDF 특수문자는 1자당 약 0.8~1.2 토큰을 차지하므로 보수적인 1.3을 적용
const CHARS_PER_TOKEN = 1.3;
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
  liteRTEventEmitter.addListener('onGenerationFinished', () => { console.log('[TEST] ✅ onGenerationFinished received at', Date.now()); });
  liteRTEventEmitter.addListener('onGenerationProgress', (event: any) => { console.log('[TEST] ✅ onGenerationSettled received at', Date.now()); });
}

import { ModelId, ModelDownloadState, MODEL_CATALOG } from '../types/models';

export class LiteRTLMAdapter implements LLMAdapter {
  // Platform identifier (core platform)
  platform: CorePlatform = Platform.OS as CorePlatform;

  private downloadStates: Map<ModelId, ModelDownloadState> = new Map();
  private loadStateListeners: Map<ModelId, Set<(state: ModelDownloadState) => void>> = new Map();

  private loadedModelId: ModelId | null = null;
  private isLoadingModel = false; // 중복 loadModel 호출 방지 가드
  
  // Promise that resolves when the model is ready for inference
  // Timeout/Polling refs per ModelId
  private downloadPollIntervals: Map<ModelId, ReturnType<typeof setInterval>> = new Map();
  private pollProgressState: Map<ModelId, { lastTime: number; lastSize: number }> = new Map();
  // DownloadManager가 현재 활성 다운로드 중인 모델 ID 추적
  // 이 Set에 있는 동안에는 폴링이나 syncStartupState에서 절대 미리 finalizeDownload하지 않음
  private activeDownloads: Set<ModelId> = new Set();
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

  constructor() {
    this.syncStartupState();
  }

  private getPublicTmpPath(filename: string): string {
    if (Platform.OS === 'android') {
      // 앱 전용 외부 저장소(Android/data/com.mobile/files/) 사용
      // • DownloadManager 시스템 서비스가 백그라운드에서 이 경로에 저장 가능
      // • 앱도 EACCES 없이 읽기/복사 가능 (Scoped Storage 제약 없음)
      // • 일반 공용 Downloads 폴더가 아니므로 EACCES 발생 안 함
      const baseDir = RNFS.ExternalDirectoryPath || RNFS.DocumentDirectoryPath;
      return `${baseDir}/${filename}.tmp`;
    }
    return `${RNFS.DocumentDirectoryPath}/${filename}.tmp`;
  }

  private isSizeValid(size: number, expectedSize: number): boolean {
    return size >= expectedSize * 0.999;
  }

  private async safeMoveFile(srcPath: string, destPath: string): Promise<void> {
    if (await RNFS.exists(destPath)) {
      await RNFS.unlink(destPath).catch(() => {});
    }
    let moveSucceeded = false;
    try {
      // 1차 시도: RNFS.moveFile (동일 파티션 내 fast atomic rename)
      await RNFS.moveFile(srcPath, destPath);
      moveSucceeded = true;
    } catch (e) {
      console.warn('[LiteRTLMAdapter] moveFile failed (cross-partition), falling back to copyFile + unlink:', e);
      // 2차 시도: 파티션을 넘는 이동인 경우 copyFile 폴백
      await RNFS.copyFile(srcPath, destPath);
      moveSucceeded = true;
    }
    // finally가 아닌 명시적 블록에서 소스 삭제 — copyFile 예외 시 srcPath는 보존됨
    if (moveSucceeded && await RNFS.exists(srcPath)) {
      await RNFS.unlink(srcPath).catch(() => {});
    }
  }

  private async syncStartupState() {
    for (const entry of MODEL_CATALOG) {
      this.downloadStates.set(entry.id, { status: 'idle' });
      const destPath = `${RNFS.DocumentDirectoryPath}/${entry.filename}`;
      const publicTmpPath = this.getPublicTmpPath(entry.filename);

      // 레거시 public DownloadDirectoryPath에 남아있던 잔여 파일 무소음 청소 시도
      if (Platform.OS === 'android') {
        const legacyTmp = `${RNFS.DownloadDirectoryPath}/${entry.filename}.tmp`;
        RNFS.exists(legacyTmp).then((exists) => {
          if (exists) RNFS.unlink(legacyTmp).catch(() => {});
        }).catch(() => {});
      }
      
      try {
        if (await RNFS.exists(destPath)) {
          const stat = await RNFS.stat(destPath);
          if (this.isSizeValid(Number(stat.size), entry.sizeBytes)) {
            this._setDownloadState(entry.id, { status: 'ready' });
            // 이미 ready 상태인 경우, 공용 폴더에 혹시 남아있을 지 모를 잔여 .tmp 파일만 정리 후 다음으로 진행
            if (await RNFS.exists(publicTmpPath)) {
              await RNFS.unlink(publicTmpPath).catch(() => {});
            }
            continue;
          } else {
            await RNFS.unlink(destPath).catch(() => {});
          }
        }
        
        // ready 상태가 아닐 때만 공용 폴더의 임시 파일 체크 및 이동 시도
        if (this.getDownloadState(entry.id).status !== 'ready' && await RNFS.exists(publicTmpPath)) {
          const stat = await RNFS.stat(publicTmpPath);
          const size = Number(stat.size) || 0;
          
          if (this.isSizeValid(size, entry.sizeBytes)) {
            if (this.activeDownloads.has(entry.id)) {
              // DownloadManager가 아직 활성 중 → 완료는 .then()에서 처리하므로 아무것도 하지 않음
              // (폴링 없음: DownloadManager stat은 pre-allocation으로 신뢰 불가)
            } else {
              // 앱 재시작 시: .done 마카 파일이 있어야만 진짜 완성 파일
              const donePath = `${publicTmpPath}.done`;
              if (await RNFS.exists(donePath)) {
                // .done 마카 존재 → DownloadManager가 실제 완료한 파일 → 새안드박스로 이동
                try {
                  await this.safeMoveFile(publicTmpPath, destPath);
                  this._setDownloadState(entry.id, { status: 'ready' });
                  await RNFS.unlink(donePath).catch(() => {});
                } catch (err: any) {
                  await RNFS.unlink(destPath).catch(() => {});
                  this._setDownloadState(entry.id, {
                    status: 'error',
                    message: `모델 파일 이동 실패: ${err?.message ?? '알 수 없는 오류'}`,
                  });
                }
              } else {
                // .done 마카 없음 → DownloadManager 사전 할당(pre-allocation)된 빈 파일 → 삭제
                console.log(`[LiteRTLMAdapter] syncStartupState: pre-allocated or interrupted file, deleting: ${publicTmpPath}`);
                await RNFS.unlink(publicTmpPath).catch(() => {});
              }
            }
          }
          // 크기 미상 또는 활성 다운로드 아님: 삭제 (pre-allocation 파일 오염 방지)
          if (!this.isSizeValid(size, entry.sizeBytes) && size > 0 && !this.activeDownloads.has(entry.id)) {
            await RNFS.unlink(publicTmpPath).catch(() => {});
          }
        }
      } catch (e) {
        // Ignored
      }
    }
  }

  private startDownloadPolling(id: ModelId, expectedSize: number, tmpPath: string, destPath: string) {
    // 동일 modelId에 대해 이미 폴링이 진행 중이면 중복 실행 방지
    if (this.downloadPollIntervals.has(id)) {
      return;
    }

    this.pollProgressState.set(id, {
      lastTime: Date.now(),
      lastSize: 0,
    });

    const interval = setInterval(async () => {
      try {
        if (!(await RNFS.exists(tmpPath))) return;
        const stat = await RNFS.stat(tmpPath);
        const size = Number(stat.size) || 0;

        const progressState = this.pollProgressState.get(id);
        const now = Date.now();

        if (progressState) {
          if (size > progressState.lastSize) {
            progressState.lastSize = size;
            progressState.lastTime = now;
          } else if (now - progressState.lastTime > 10 * 60 * 1000) {
            // 10분 이상 진전이 없으면 타임아웃
            this.stopDownloadPolling(id);
            Alert.alert(
              '다운로드 지연',
              '모델 다운로드가 오랫동안 멈춰있습니다. 다시 시도하시겠습니까?',
              [
                { text: '취소', style: 'cancel' },
                {
                  text: '재시도',
                  onPress: async () => {
                    if (await RNFS.exists(tmpPath)) {
                      await RNFS.unlink(tmpPath).catch(() => {});
                    }
                    this.downloadModel(id);
                  },
                },
              ]
            );
            this._setDownloadState(id, { status: 'error', message: '다운로드 시간 초과' });
            return;
          }
        }

        const pct = expectedSize > 0 ? Math.min(99, Math.round((size / expectedSize) * 100)) : 0;
        this._setDownloadState(id, { status: 'downloading', progress: pct });
      } catch (e) {
        // Ignore stats error during active download
      }
    }, 2000);

    this.downloadPollIntervals.set(id, interval);
  }

  private stopDownloadPolling(id?: ModelId) {
    if (id) {
      const interval = this.downloadPollIntervals.get(id);
      if (interval) {
        clearInterval(interval);
        this.downloadPollIntervals.delete(id);
        this.pollProgressState.delete(id);
      }
    } else {
      this.downloadPollIntervals.forEach((interval) => clearInterval(interval));
      this.downloadPollIntervals.clear();
      this.pollProgressState.clear();
    }
  }

  private async finalizeDownload(id: ModelId, tmpPath: string, destPath: string) {
    const currentState = this.downloadStates.get(id);
    if (currentState?.status === 'ready') return; // 이미 완료됨(락)

    const entry = MODEL_CATALOG.find(e => e.id === id);
    if (!entry) return;

    // 이동 전 tmpPath 파일 무결성 검증 (사이즈 체크)
    const tmpExists = await RNFS.exists(tmpPath);
    if (!tmpExists) {
      console.error(`[LiteRTLMAdapter] finalizeDownload: tmpPath 없음 for ${id}: ${tmpPath}`);
      this._setDownloadState(id, { status: 'idle' });
      return;
    }
    const tmpStat = await RNFS.stat(tmpPath);
    const tmpSize = Number(tmpStat.size);
    if (!this.isSizeValid(tmpSize, entry.sizeBytes)) {
      console.error(`[LiteRTLMAdapter] finalizeDownload: 파일 크기 불일치 for ${id}: ${tmpSize} / ${entry.sizeBytes}`);
      await RNFS.unlink(tmpPath).catch(() => {});
      this._setDownloadState(id, { status: 'idle' });
      return;
    }

    this._setDownloadState(id, { status: 'loading' }); // 이동 중 상태 잠금

    try {
      await this.safeMoveFile(tmpPath, destPath);

      // 이동 후 destPath 파일 무결성 재검증
      if (await RNFS.exists(destPath)) {
        const destStat = await RNFS.stat(destPath);
        const destSize = Number(destStat.size);
        if (!this.isSizeValid(destSize, entry.sizeBytes)) {
          throw new Error(`이동 후 파일 크기 불일치: ${destSize} / ${entry.sizeBytes}`);
        }
      } else {
        throw new Error('이동 후 destPath 파일 없음');
      }

      this._setDownloadState(id, { status: 'ready' });
      // 다운로드 완료 알림
      Alert.alert(
        '다운로드 완료',
        `${entry.name} 모델 다운로드가 완료되었습니다. 지금 바로 사용할 수 있습니다!`,
        [{ text: '확인' }]
      );
      // Android: .done 마카 파일 정리 (syncStartupState 완료 확인용)
      const donePath = `${tmpPath}.done`;
      await RNFS.unlink(donePath).catch(() => {});
    } catch (err: any) {
      console.error(`[LiteRTLMAdapter] finalizeDownload 실패 for ${id}:`, err?.message ?? err);
      await RNFS.unlink(destPath).catch(() => {});
      this._setDownloadState(id, {
        status: 'idle',
      });
    }
  }

  private _setDownloadState(id: ModelId, state: ModelDownloadState) {
    this.downloadStates.set(id, state);
    const listeners = this.loadStateListeners.get(id);
    if (listeners) {
      listeners.forEach((fn) => fn(state));
    }
  }

  public getIsLoaded(id?: ModelId): boolean {
    if (id) return this.loadedModelId === id;
    return this.loadedModelId !== null;
  }

  /**
   * Wait until the native model is loaded and ready.
   * Resolves immediately if already loaded.
   */
  public async waitForReady(id?: ModelId): Promise<void> {
    if (id && this.loadedModelId === id) return;
    if (!id && this.loadedModelId !== null) return;
    await this.readyPromise;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 신규 갤러리 지원 API
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  
  public getDownloadState(id: ModelId): ModelDownloadState {
    return this.downloadStates.get(id) || { status: 'idle' };
  }

  public onDownloadStateChange(id: ModelId, callback: (state: ModelDownloadState) => void): () => void {
    if (!this.loadStateListeners.has(id)) {
      this.loadStateListeners.set(id, new Set());
    }
    this.loadStateListeners.get(id)!.add(callback);
    return () => {
      this.loadStateListeners.get(id)?.delete(callback);
    };
  }

  public async checkFreeSpace(requiredBytes: number): Promise<boolean> {
    try {
      const fsInfo = await RNFS.getFSInfo();
      // moveFile이 다른 파일시스템 간 copy+delete로 동작하는 경우를 대비해 1.2배 여유 확인.
      // (같은 파일시스템 내에서는 atomic rename이라 추가 공간 불필요)
      return fsInfo.freeSpace > requiredBytes * 1.2;
    } catch (e) {
      return true;
    }
  }

  public async downloadModel(id: ModelId): Promise<void> {
    const entry = MODEL_CATALOG.find(e => e.id === id);
    if (!entry) return;

    // Android 13 이상 알림 권한 체크
    if (Platform.OS === 'android' && Platform.Version >= 33) {
      try {
        await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
      } catch (e) {
        // 무시
      }
    }

    const destPath = `${RNFS.DocumentDirectoryPath}/${entry.filename}`;
    const publicTmpPath = this.getPublicTmpPath(entry.filename);

    try {
      // 용량 체크
      if (!(await this.checkFreeSpace(entry.sizeBytes))) {
        Alert.alert('용량 부족', '모델 다운로드에 필요한 여유 공간(2배 이상)이 부족합니다.');
        return;
      }

      if (await RNFS.exists(destPath)) {
        const stat = await RNFS.stat(destPath);
        if (this.isSizeValid(Number(stat.size), entry.sizeBytes)) {
          this._setDownloadState(id, { status: 'ready' });
          return;
        }
        await RNFS.unlink(destPath).catch(() => {});
      }

      // 새 다운로드 시작 시 안전하게 앱 전용 저장소 내의 잔여 .tmp 및 마커 파일 정리
      const possibleTmpPaths = [
        publicTmpPath,
        `${publicTmpPath}.done`,
        `${publicTmpPath.replace('.tmp', '')}-1.tmp`,
        `${publicTmpPath.replace('.tmp', '')}-2.tmp`,
        `${RNFS.DocumentDirectoryPath}/${entry.filename}.tmp`,
        `${RNFS.ExternalDirectoryPath}/${entry.filename}.tmp`,
      ].filter((p, i, arr) => p && arr.indexOf(p) === i);

      for (const p of possibleTmpPaths) {
        try {
          if (await RNFS.exists(p)) {
            await RNFS.unlink(p).catch(() => {});
          }
        } catch (e) {
          // 개별 파일 삭제 실패 시 무시하고 다음 진행
        }
      }

      this._setDownloadState(id, { status: 'downloading', progress: 0 });
      this.activeDownloads.add(id);

      if (Platform.OS === 'android') {
        try {
          const downloadId = await NativeModules.LiteRT.enqueueModelDownload(
            entry.url,
            publicTmpPath,
            entry.name
          );

          const pollInterval = setInterval(async () => {
            try {
              const info = await NativeModules.LiteRT.queryDownloadProgress(downloadId);
              if (info && info.total > 0) {
                const pct = Math.min(99, Math.round((info.downloaded / info.total) * 100));
                this._setDownloadState(id, { status: 'downloading', progress: pct });
              }

              if (info?.status === 8) {
                // DownloadManager STATUS_SUCCESSFUL (8)
                clearInterval(pollInterval);
                this.activeDownloads.delete(id);
                const donePath = `${publicTmpPath}.done`;
                await RNFS.writeFile(donePath, 'ok', 'utf8').catch(() => {});
                
                let actualPath = publicTmpPath;
                if (info.localUri) {
                  actualPath = info.localUri.replace('file://', '');
                }
                await this.finalizeDownload(id, actualPath, destPath);
              } else if (info?.status === 16) {
                // DownloadManager STATUS_FAILED (16)
                clearInterval(pollInterval);
                this.activeDownloads.delete(id);
                this._setDownloadState(id, { status: 'error', message: '백그라운드 다운로드 실패' });
              }
            } catch (e) {
              // 마커 확인 등 후속 완료 처리 고려하여, donePath가 있으면 완료 수용
              const donePath = `${publicTmpPath}.done`;
              if (await RNFS.exists(donePath)) {
                clearInterval(pollInterval);
                this.activeDownloads.delete(id);
                await this.finalizeDownload(id, publicTmpPath, destPath);
              }
            }
          }, 1500);
        } catch (err: any) {
          console.error('[LiteRTLMAdapter] Android enqueueModelDownload error:', err);
          this.activeDownloads.delete(id);
          this._setDownloadState(id, { status: 'error', message: `다운로드 시작 실패: ${err?.message ?? '알 수 없는 오류'}` });
        }
      } else {
        // iOS: react-native-blob-util background session 사용
        ReactNativeBlobUtil.config({
          fileCache: true,
          path: publicTmpPath,
          background: true,
        } as any)
        .fetch('GET', entry.url)
        .progress((received, total) => {
          const pct = Number(total) > 0 ? Math.round((Number(received) / Number(total)) * 100) : 0;
          this._setDownloadState(id, { status: 'downloading', progress: Math.min(99, pct) });
        })
        .then(async (res) => {
          this.activeDownloads.delete(id);
          await this.finalizeDownload(id, publicTmpPath, destPath);
        })
        .catch((err) => {
          this.activeDownloads.delete(id);
          this._setDownloadState(id, { status: 'error', message: '네트워크 에러로 다운로드가 중단되었습니다.' });
        });
      }
    } catch (error: any) {
      this.stopDownloadPolling(id);
      this._setDownloadState(id, { status: 'error', message: '다운로드 시작 실패' });
    }
  }

  public async loadModel(id: ModelId): Promise<void> {
    if (this.loadedModelId === id) {
      if (this.readyResolver) {
        this.readyResolver();
        this.readyResolver = undefined;
      }
      return;
    }

    if (this.isLoadingModel) {
      console.log('[LiteRTLMAdapter] loadModel already in progress, waiting...');
      await this.readyPromise;
      return;
    }

    const entry = MODEL_CATALOG.find(e => e.id === id);
    if (!entry) throw new Error('Unknown model ID');

    this.isLoadingModel = true;

    // Reset readyPromise for new model load
    this.readyPromise = new Promise((resolve) => {
      this.readyResolver = resolve;
    });

    // Rule R-03: Swap safety
    if (this.loadedModelId !== null && this.loadedModelId !== id) {
      console.log(`[LiteRTLMAdapter] Unloading previous model: ${this.loadedModelId}`);
      if (LiteRTModule) {
        await LiteRTModule.unloadModel();
      }
      this.loadedModelId = null;
      // 네이티브 C++ 엔진이 메모리를 완전히 해제할 시간 확보
      await new Promise<void>(resolve => setTimeout(resolve, 300));
    }

    this._setDownloadState(id, { status: 'loading' });

    try {
      const destPath = `${RNFS.DocumentDirectoryPath}/${entry.filename}`;

      // loadModel 전 파일 무결성 최종 검증
      if (!(await RNFS.exists(destPath))) {
        throw new Error(`모델 파일이 존재하지 않습니다: ${destPath}`);
      }
      const fileStat = await RNFS.stat(destPath);
      if (!this.isSizeValid(Number(fileStat.size), entry.sizeBytes)) {
        console.error(`[LiteRTLMAdapter] 파일 크기 불일치, 삭제 후 재다운로드 유도: ${fileStat.size} / ${entry.sizeBytes}`);
        await RNFS.unlink(destPath).catch(() => {});
        this.isLoadingModel = false;
        this._setDownloadState(id, { status: 'idle' });
        throw new Error('모델 파일이 손상되었습니다. 다시 다운로드해주세요.');
      }

      if (LiteRTModule) {
        await LiteRTModule.loadModel(destPath);
      } else {
        console.warn('[LiteRTLMAdapter] LiteRTModule is not linked. Skipping native load.');
      }

      this.loadedModelId = id;
      this.isLoadingModel = false;
      this._setDownloadState(id, { status: 'ready' });

      // Resolve pending callers
      if (this.readyResolver) {
        this.readyResolver();
        this.readyResolver = undefined;
      }
    } catch (error) {
      console.error(`[LiteRTLMAdapter] Failed to load native model ${id}:`, error);
      this.isLoadingModel = false;
      this._setDownloadState(id, { status: 'error', message: 'Failed to load model' });
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // init: 구 버전 하위 호환
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  async init(model: ModelSpec): Promise<void> {
    await this.loadModel(model.id as ModelId);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // warmup: 모델 웜업 (현재는 로드 상태 확인만)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  async warmup(): Promise<void> {
    if (this.loadedModelId === null) throw new Error('Model not loaded');
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
    if (this.loadedModelId === null) {
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
      (event: any) => {
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
      (event: any) => {
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
    if (this.loadedModelId !== null) {
      if (LiteRTModule) {
        await LiteRTModule.unloadModel();
      }
      this._setDownloadState(this.loadedModelId, { status: 'idle' });
      this.loadedModelId = null;
    }
  }
}

let _liteRTAdapterInstance: LiteRTLMAdapter | null = null;
export function getLiteRTAdapter(): LiteRTLMAdapter {
  if (!_liteRTAdapterInstance) _liteRTAdapterInstance = new LiteRTLMAdapter();
  return _liteRTAdapterInstance;
}