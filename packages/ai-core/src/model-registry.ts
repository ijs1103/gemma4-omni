import type { Platform, ModelSpec } from './types';

export interface PlatformModelBinding {
  runtime: 'webllm' | 'litert-lm';
  runtimeModelId: string;
  downloadSizeMb?: number;
  minRamGb?: number;
}

export interface ModelRegistryEntry {
  /** 사용자에게 노출되는 표시명 */
  label: string;
  /** 공통 모델 스펙 */
  spec: ModelSpec;
  /** 플랫폼별 런타임 바인딩 */
  platforms: Partial<Record<Platform, PlatformModelBinding>>;
}

/**
 * 초기 MVP의 Gemma 4 E4B 모델 및 확장 가능한 레지스트리 구조 정의
 */
export const MODEL_REGISTRY: Record<string, ModelRegistryEntry> = {
  'gemma4-e4b': {
    label: 'Gemma 4 E4B',
    spec: {
      id: 'gemma4-e4b',
      family: 'gemma',
      variant: '4-e4b',
      quant: 'q4f16_1',
      contextWindow: 32768,
      supportsVision: false,
      supportsTools: false,
    },
    platforms: {
      web: {
        runtime: 'webllm',
        runtimeModelId: 'gemma3-1b-it-q4f16_1-MLC',
        downloadSizeMb: 900,
        minRamGb: 6,
      },
      ios: {
        runtime: 'litert-lm',
        runtimeModelId: 'gemma-4-e4b-it-litert-ios',
      },
      android: {
        runtime: 'litert-lm',
        runtimeModelId: 'gemma-4-e4b-it-litert-android',
      },
    },
  },
};
