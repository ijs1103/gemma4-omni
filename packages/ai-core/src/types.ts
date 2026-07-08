export type Platform = 'ios' | 'android' | 'web';

export type AttachmentType = 'image' | 'document';

export type Attachment = {
  id: string;
  type: AttachmentType;
  uri: string;
  name: string;
  mimeType: string;
  sizeBytes?: number;
  textContent?: string;
};

export type ChatMessage = {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  attachments?: Attachment[];
  name?: string;
  toolCallId?: string;
  timestamp: number;
};

export type ModelSpec = {
  id: string;
  family: 'gemma';
  variant: string;
  quant?: string;
  contextWindow?: number;
  supportsVision?: boolean;
  supportsTools?: boolean;
};

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

export type GenerateOptions = {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  stop?: string[];
  tools?: ToolDefinition[];
  signal?: AbortSignal;
};

export type StreamChunk =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; name: string; argumentsJson: string }
  | { type: 'done'; stats?: GenerationStats }
  | { type: 'error'; message: string };

export type GenerationStats = {
  firstTokenMs?: number;
  totalMs?: number;
  tokenCount?: number;
  tokensPerSecond?: number;
};

export type ModelLoadState =
  | { status: 'idle' }
  | { status: 'downloading'; progress: number }
  | { status: 'loading'; progress: number }
  | { status: 'ready' }
  | { status: 'error'; message: string }
  | { status: 'unsupported'; reason: string };
