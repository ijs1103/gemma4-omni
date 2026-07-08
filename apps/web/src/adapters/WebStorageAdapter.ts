import { 
  type StorageAdapter, 
  type ChatSession, 
  type ChatSessionSummary 
} from '@repo/chat-state';

export class WebStorageAdapter implements StorageAdapter {
  private dbName = 'llm_chat_storage_db';
  private storeName = 'sessions';
  private dbPromise: Promise<IDBDatabase>;

  constructor() {
    this.dbPromise = this.initDB();
  }

  private initDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'id' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async saveSession(session: ChatSession): Promise<void> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      
      store.put(session);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async loadSession(sessionId: string): Promise<ChatSession | null> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      const request = store.get(sessionId);

      request.onsuccess = () => {
        resolve(request.result || null);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async listSessions(): Promise<ChatSessionSummary[]> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      const request = store.getAll();

      request.onsuccess = () => {
        const sessions: ChatSession[] = request.result || [];
        const summaries: ChatSessionSummary[] = sessions.map((s) => {
          const lastMsg = s.messages[s.messages.length - 1];
          return {
            id: s.id,
            title: s.title,
            status: s.status,
            messageCount: s.messages.length,
            lastMessagePreview: lastMsg ? lastMsg.content.slice(0, 80) : '빈 대화',
            modelId: s.modelId,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
          };
        }).sort((a, b) => b.updatedAt - a.updatedAt);
        
        resolve(summaries);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async deleteSession(sessionId: string): Promise<void> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      
      store.delete(sessionId);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async saveSettings(key: string, value: unknown): Promise<void> {
    try {
      localStorage.setItem(`settings:${key}`, JSON.stringify(value));
    } catch (e) {
      console.error('saveSettings error:', e);
    }
  }

  async loadSettings<T>(key: string): Promise<T | null> {
    try {
      const raw = localStorage.getItem(`settings:${key}`);
      return raw ? JSON.parse(raw) as T : null;
    } catch (e) {
      console.error('loadSettings error:', e);
      return null;
    }
  }
}
