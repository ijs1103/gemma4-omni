export type ModelId = 'litert-gemma-4-e2b' | 'litert-gemma-4-e4b';

export interface ModelDownloadState {
  status: 'idle' | 'downloading' | 'loading' | 'ready' | 'error';
  progress?: number;
  message?: string;
}

export interface ModelCatalogEntry {
  id: ModelId;
  name: string;
  sizeBytes: number;
  sizeLabel: string;
  url: string;
  filename: string;
  description: string;
}

export const MODEL_CATALOG: ModelCatalogEntry[] = [
  {
    id: 'litert-gemma-4-e4b',
    name: 'Gemma 4 E4B',
    sizeBytes: 3659530240,
    sizeLabel: '3.41 GB',
    url: 'https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm/resolve/main/gemma-4-E4B-it.litertlm',
    filename: 'gemma-4-e4b-it.litertlm',
    description: '기본 내장 모델로, 뛰어난 성능과 추론 능력을 제공합니다.\nRAM 8GB 이상 (아이폰 15pro 이상 / 갤럭시 S24 이상)',
  },
  {
    id: 'litert-gemma-4-e2b',
    name: 'Gemma 4 E2B',
    sizeBytes: 2588147712,
    sizeLabel: '2.41 GB',
    url: 'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it.litertlm',
    filename: 'gemma-4-e2b-it.litertlm',
    description: '작은 용량과 빠른 속도로 간단한 대화에 적합한 경량 모델입니다.\nRAM 6GB 이상 (아이폰 13pro 이상 / 갤럭시 S20 이상)',
  },
];
