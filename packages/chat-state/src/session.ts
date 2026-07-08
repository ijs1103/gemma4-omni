import type { ChatMessage, GenerateOptions } from '@repo/ai-core';

/** 채팅 세션 상태. 삭제 시 즉시 물리 삭제하므로 'deleted' 상태는 없음. */
export type ChatSessionStatus = 'active' | 'archived';

export interface ChatSession {
  id: string;
  title: string;
  status: ChatSessionStatus;
  messages: ChatMessage[];
  modelId: string;
  createdAt: number;
  updatedAt: number;
  userId?: string; // 향후 클라우드 동기화용 예약 필드
  generateOptions?: Partial<GenerateOptions>;
  metadata?: Record<string, unknown>;
}

export interface ChatSessionSummary {
  id: string;
  title: string;
  status: ChatSessionStatus;
  messageCount: number;
  lastMessagePreview: string;
  modelId: string;
  createdAt: number;
  updatedAt: number;
}
