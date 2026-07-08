import type { ChatSession, ChatSessionSummary } from './session';

/**
 * 플랫폼별 영구 저장소 추상화.
 * - 웹: IndexedDB / localStorage
 * - 모바일: SQLite / AsyncStorage
 */
export interface StorageAdapter {
  /** 세션 저장 (생성 또는 덮어쓰기) */
  saveSession(session: ChatSession): Promise<void>;

  /** 세션 ID로 복원 */
  loadSession(sessionId: string): Promise<ChatSession | null>;

  /** 전체 세션 목록 (요약 정보만) */
  listSessions(): Promise<ChatSessionSummary[]>;

  /** 세션 즉시 물리 삭제 (소프트 삭제 없음) */
  deleteSession(sessionId: string): Promise<void>;

  /** 설정 저장 */
  saveSettings(key: string, value: unknown): Promise<void>;

  /** 설정 로드 */
  loadSettings<T>(key: string): Promise<T | null>;

  /** 모든 데이터 초기화 (계정 삭제 시) */
  clearAll(): Promise<void>;
}
