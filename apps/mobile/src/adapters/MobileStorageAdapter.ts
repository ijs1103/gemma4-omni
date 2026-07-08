import { open } from 'react-native-quick-sqlite';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { StorageAdapter, ChatSession, ChatSessionSummary } from '@repo/chat-state';

export class MobileStorageAdapter implements StorageAdapter {
  private db: any = null;
  private isFallback = false;
  private fallbackMemory: Record<string, ChatSession> = {};

  constructor() {
    try {
      this.db = open({ name: 'chat.sqlite' });
      this.initSchema();
    } catch (e) {
      console.warn('[MobileStorageAdapter] Failed to initialize SQLite, falling back to AsyncStorage persistence:', e);
      this.isFallback = true;
      this.loadFallbackFromAsyncStorage();
    }
  }

  private initSchema() {
    if (this.isFallback) return;
    this.db.execute(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT,
        status TEXT,
        modelId TEXT,
        createdAt INTEGER,
        updatedAt INTEGER,
        metadata TEXT
      );
    `);
    this.db.execute(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        sessionId TEXT,
        role TEXT,
        content TEXT,
        name TEXT,
        toolCallId TEXT,
        timestamp INTEGER,
        extraData TEXT,
        FOREIGN KEY(sessionId) REFERENCES sessions(id) ON DELETE CASCADE
      );
    `);
    // isThinking 등 확장 필드를 저장하는 extraData 컬럼 마이그레이션
    // 이미 테이블이 있는 경우 컬럼이 없을 수 있으므로 안전하게 추가
    try {
      this.db.execute('ALTER TABLE messages ADD COLUMN extraData TEXT');
    } catch (_) {
      // 이미 존재하면 무시
    }
  }

  // AsyncStorage 기반 백업 로드
  private async loadFallbackFromAsyncStorage() {

    try {
      const saved = await AsyncStorage.getItem('fallback_chat_sessions');
      if (saved) {
        this.fallbackMemory = JSON.parse(saved);
      }
    } catch (e) {
      console.error('[MobileStorageAdapter] Fallback load failed', e);
    }
  }

  // AsyncStorage 기반 백업 저장
  private async persistFallback() {
    try {
      await AsyncStorage.setItem('fallback_chat_sessions', JSON.stringify(this.fallbackMemory));
    } catch (e) {
      console.error('[MobileStorageAdapter] Fallback persist failed', e);
    }
  }

  async saveSession(session: ChatSession): Promise<void> {
    if (this.isFallback) {
      this.fallbackMemory[session.id] = { ...session };
      await this.persistFallback();
      return;
    }

    this.db.execute('BEGIN TRANSACTION');
    try {
      this.db.execute(
        'INSERT OR REPLACE INTO sessions (id, title, status, modelId, createdAt, updatedAt, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [session.id, session.title, session.status, session.modelId, session.createdAt, session.updatedAt, JSON.stringify(session.metadata || {})]
      );

      for (const msg of session.messages) {
        // role/content/timestamp 외 확장 필드(isThinking 등)를 extraData에 JSON으로 보존
        const { id, role, content, name, toolCallId, timestamp, ...rest } = msg as any;
        const extraData = Object.keys(rest).length > 0 ? JSON.stringify(rest) : null;
        this.db.execute(
          'INSERT OR REPLACE INTO messages (id, sessionId, role, content, name, toolCallId, timestamp, extraData) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [id, session.id, role, content, name || null, toolCallId || null, timestamp, extraData]
        );
      }
      this.db.execute('COMMIT');
    } catch (e) {
      this.db.execute('ROLLBACK');
      throw e;
    }
  }

  async loadSession(sessionId: string): Promise<ChatSession | null> {
    if (this.isFallback) {
      return this.fallbackMemory[sessionId] || null;
    }

    const sessionRes = this.db.execute('SELECT * FROM sessions WHERE id = ?', [sessionId]);
    if (sessionRes.rows?.length === 0) return null;

    const session = sessionRes.rows?.item(0);
    const msgsRes = this.db.execute('SELECT * FROM messages WHERE sessionId = ? ORDER BY timestamp ASC', [sessionId]);
    
    const messages = [];
    for (let i = 0; i < msgsRes.rows?.length; i++) {
      const row = msgsRes.rows?.item(i);
      // extraData에 저장된 확장 필드(isThinking 등)를 복원
      let extra = {};
      if (row.extraData) {
        try { extra = JSON.parse(row.extraData); } catch (_) {}
      }
      const { extraData: _extraData, ...baseRow } = row;
      messages.push({ ...baseRow, ...extra });
    }

    return {
      ...session,
      metadata: JSON.parse(session.metadata || '{}'),
      messages,
    } as ChatSession;
  }

  async listSessions(): Promise<ChatSessionSummary[]> {
    if (this.isFallback) {
      return Object.values(this.fallbackMemory)
        .map(session => ({
          id: session.id,
          title: session.title,
          status: session.status,
          modelId: session.modelId,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          lastMessagePreview: session.messages[session.messages.length - 1]?.content || '',
          messageCount: session.messages.length,
        }))
        .sort((a, b) => b.updatedAt - a.updatedAt);
    }

    const res = this.db.execute('SELECT id, title, status, modelId, createdAt, updatedAt FROM sessions ORDER BY updatedAt DESC');
    const sessions = [];
    
    for (let i = 0; i < res.rows?.length; i++) {
      const item = res.rows?.item(i);
      
      const lastMsgRes = this.db.execute('SELECT content FROM messages WHERE sessionId = ? ORDER BY timestamp DESC LIMIT 1', [item.id]);
      const lastMessagePreview = lastMsgRes.rows?.length > 0 ? lastMsgRes.rows?.item(0).content : '';
      
      sessions.push({
        ...item,
        lastMessagePreview,
        messageCount: 0,
      });
    }
    
    return sessions;
  }

  async deleteSession(sessionId: string): Promise<void> {
    if (this.isFallback) {
      delete this.fallbackMemory[sessionId];
      await this.persistFallback();
      return;
    }

    this.db.execute('DELETE FROM sessions WHERE id = ?', [sessionId]);
  }

  async saveSettings(key: string, value: unknown): Promise<void> {
    await AsyncStorage.setItem(`settings_${key}`, JSON.stringify(value));
  }

  async loadSettings<T>(key: string): Promise<T | null> {
    const val = await AsyncStorage.getItem(`settings_${key}`);
    return val ? JSON.parse(val) : null;
  }

  async clearAll(): Promise<void> {
    if (this.isFallback) {
      this.fallbackMemory = {};
      await this.persistFallback();
    } else {
      this.db.execute('DELETE FROM sessions');
      this.db.execute('DELETE FROM messages');
    }
  }
}

