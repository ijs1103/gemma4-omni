import type { ChatMessage, GenerateOptions } from '@repo/ai-core';
import type { MessageSyncStatus, SessionSyncStatus } from './remote-chat-client';

/** 채팅 세션 상태. */
export type ChatSessionStatus = 'active' | 'archived';

/** 로컬 저장소용 세션 동기화 메타데이터 */
export interface SessionSyncMeta {
  /** 'pending': 서버에 아직 생성되지 않음, 'synced': 서버에 존재 */
  sessionSyncStatus?: SessionSyncStatus;
}

/** 로컬 저장소용 메시지 동기화 메타데이터 */
export interface MessageSyncMeta {
  /** 'pending': 서버에 아직 전송되지 않음, 'synced': 서버에 존재 */
  syncStatus?: MessageSyncStatus;
}

/** 동기화 상태 메타데이터가 포함된 확장 메시지 타입 */
export type SyncableChatMessage = ChatMessage & MessageSyncMeta;

export interface ChatSession extends SessionSyncMeta {
  id: string;
  title: string;
  status: ChatSessionStatus;
  messages: SyncableChatMessage[];
  modelId: string;
  createdAt: number;
  updatedAt: number;
  userId?: string;
  generateOptions?: Partial<GenerateOptions>;
  metadata?: Record<string, unknown>;
}

export interface ChatSessionSummary extends SessionSyncMeta {
  id: string;
  title: string;
  status: ChatSessionStatus;
  messageCount: number;
  lastMessagePreview: string;
  modelId: string;
  createdAt: number;
  updatedAt: number;
}
