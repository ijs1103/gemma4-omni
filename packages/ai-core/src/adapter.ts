import type { Platform, ChatMessage, ModelSpec, GenerateOptions, StreamChunk, ModelLoadState } from './types';

export interface LLMAdapter {
  readonly platform: Platform;

  /** 모델 초기화 (다운로드 + 로딩) */
  init(model: ModelSpec): Promise<void>;

  /** 워밍업 (선택) */
  warmup?(): Promise<void>;

  /** 단일 응답 생성 */
  generate(messages: ChatMessage[], options?: GenerateOptions): Promise<string>;

  /** 스트리밍 응답 생성 */
  stream(messages: ChatMessage[], options?: GenerateOptions): AsyncIterable<StreamChunk>;

  /** 진행 중인 생성 중단 */
  interrupt?(): Promise<void>;

  /** 모델 언로드 및 메모리 해제 */
  unload?(): Promise<void>;

  /** 현재 모델 로딩 상태를 구독 */
  onLoadStateChange?(callback: (state: ModelLoadState) => void): () => void;
}
