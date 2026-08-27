// ── 서버 응답 타입 ───────────────────────────────────────

/** 서버 세션 응답 (메시지 미포함) */
export interface RemoteChatSession {
  id: string;
  title: string;
  model_id: string;
  status: string;
  message_count: number;
  last_message_preview: string;
  created_at: string; // ISO 8601
  updated_at: string;
}

/** 서버 메시지 응답 */
export interface RemoteMessage {
  id: string;
  chat_session_id: string;
  role: string;
  content: string;
  created_at: string;
}

// ── 요청 타입 ───────────────────────────────────────────

/** 세션 생성 요청 */
export interface CreateSessionRequest {
  id: string;
  title: string;
  model_id: string;
  created_at?: string;
  updated_at?: string;
}

/** 메시지 생성 요청 */
export interface CreateMessageRequest {
  id: string;
  role: string;
  content: string;
  created_at?: string;
}

// ── 동기화 타입 ─────────────────────────────────────────

/** 동기화 푸시 세션 페이로드 */
export interface SyncSessionPayload {
  id: string;
  title: string;
  model_id: string;
  status: string;
  created_at: string;
  updated_at: string;
  messages: { id: string; role: string; content: string; created_at: string }[];
}

/** 동기화 푸시 응답 */
export interface SyncPushResponse {
  synced_sessions: number;
  synced_messages: number;
  skipped_sessions: number;
  skipped_messages: number;
}

// ── 클라이언트 로컬 전용 타입 ────────────────────────────

/**
 * 클라이언트 로컬 메시지의 동기화 상태.
 * StorageAdapter 레벨에서 관리. 서버 API 스키마에는 포함되지 않음.
 */
export type MessageSyncStatus = 'pending' | 'synced';

/**
 * 클라이언트 로컬 세션의 동기화 상태.
 * 오프라인에서 생성된 세션은 'pending' 상태로 보존되었다가,
 * 온라인 복귀 시 서버에 createSession() 후 'synced'로 전환.
 */
export type SessionSyncStatus = 'pending' | 'synced';

// ── 검색 타입 ───────────────────────────────────────────

/** 웹 검색 스니펫 (서버 응답) */
export interface SearchSnippet {
  title: string;
  content: string;
  url: string;
}

/** 인스턴트 위젯 응답 (날씨/환율 등) */
export interface WidgetResult {
  type: 'weather' | 'currency' | 'calculator';
  title: string;
  data: Record<string, any>;
  summary_text: string;
}

/** 스크래핑/리랭킹 본문 청크 */
export interface SourceChunk {
  url: string;
  title: string;
  text: string;
  score?: number;
}

/** 고도화 검색 응답 객체 */
export interface SearchResponse {
  query: string;
  intent?: string;
  widget?: WidgetResult | null;
  sources?: SourceChunk[];
  snippets?: SearchSnippet[];
  compressed_context?: string;
}

// ── 인터페이스 ──────────────────────────────────────────

/**
 * 플랫폼별 원격 채팅 API 클라이언트 인터페이스.
 * 실제 fetch 구현은 웹(WebRemoteChatAdapter), 모바일(MobileRemoteChatAdapter) 각자.
 *
 * 멱등성 보장:
 *   - createSession(): 같은 ID 재요청 시 활성 세션이면 upsert, 삭제 세션이면 410
 *   - postMessage(): 같은 ID + 같은 세션이면 기존 메시지 반환, 다른 세션이면 409
 *   - syncPush(): INSERT ON CONFLICT DO NOTHING + 소속 세션 검증
 */
export interface RemoteChatClient {
  /** 서버에서 세션 목록 조회 */
  fetchSessions(): Promise<RemoteChatSession[]>;

  /** 특정 세션의 메시지 조회 */
  fetchMessages(sessionId: string): Promise<RemoteMessage[]>;

  /** 새 세션 생성 (멱등 — 활성 세션이면 upsert, 삭제 세션이면 410) */
  createSession(session: CreateSessionRequest): Promise<RemoteChatSession>;

  /** 메시지 추가 (멱등 + 소속 세션 검증 — 같은 세션이면 반환, 다른 세션이면 409) */
  postMessage(sessionId: string, message: CreateMessageRequest): Promise<RemoteMessage>;

  /** 세션 삭제 (소프트 삭제) */
  deleteSession(sessionId: string): Promise<void>;

  /** 전체 멱등 동기화 푸시 (삭제 세션 skip, 다른 세션 소속 메시지 skip) */
  syncPush(sessions: SyncSessionPayload[]): Promise<SyncPushResponse>;

  /** 웹 검색 수행 (SearXNG / Vane 고도화 파이프라인 프록시) */
  searchWeb?(query: string, maxResults?: number): Promise<SearchResponse>;
}
