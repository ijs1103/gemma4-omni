import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ChatSessionSummary, ChatSession } from '@repo/chat-state';
import { MobileStorageAdapter } from '../adapters/MobileStorageAdapter';
import { authAdapter } from './AuthContext';
import { MobileRemoteChatAdapter } from '../adapters/MobileRemoteChatAdapter';

interface ChatContextType {
  sessions: ChatSessionSummary[];
  currentChatTitle: string;
  activeSessionId: string | undefined;
  loadSessions: () => Promise<void>;
  updateSessionTitle: (sessionId: string, newTitle: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  clearAllSessions: () => Promise<void>;
  setActiveSessionId: (id: string | undefined) => void;
  setCurrentChatTitle: (title: string) => void;
  retryPendingSync: () => Promise<void>;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

const storage = new MobileStorageAdapter();
const remoteAdapter = new MobileRemoteChatAdapter(authAdapter);


export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [currentChatTitle, setCurrentChatTitle] = useState<string>('대화방');
  const [activeSessionId, setActiveSessionIdState] = useState<string | undefined>(undefined);

  const retryPendingSync = useCallback(async () => {
    const authSession = await authAdapter.getSession();
    if (!authSession?.isAuthenticated) return;

    try {
      const summaries = await storage.listSessions();
      for (const summary of summaries) {
        const chatSession = await storage.loadSession(summary.id);
        if (!chatSession) continue;

        let sessionReady = true;

        if (chatSession.sessionSyncStatus === 'pending') {
          try {
            await remoteAdapter.createSession({
              id: chatSession.id,
              title: chatSession.title,
              model_id: chatSession.modelId,
              created_at: new Date(chatSession.createdAt).toISOString(),
              updated_at: new Date(chatSession.updatedAt).toISOString(),
            });
            chatSession.sessionSyncStatus = 'synced';
            await storage.saveSession(chatSession);
          } catch (e: any) {
            if (e.message?.includes('410')) {
              await storage.deleteSession(chatSession.id);
              continue;
            }
            console.warn(`[Mobile retryPendingSync] 세션 ${chatSession.id} 생성 실패:`, e);
            sessionReady = false;
          }
        }

        if (!sessionReady) continue;

        let hasUpdates = false;
        const pendingMsgs = chatSession.messages.filter(m => m.syncStatus === 'pending');
        for (const msg of pendingMsgs) {
          try {
            await remoteAdapter.postMessage(chatSession.id, {
              id: msg.id,
              role: msg.role,
              content: msg.content,
              created_at: new Date(msg.timestamp).toISOString(),
            });
            msg.syncStatus = 'synced';
            hasUpdates = true;
          } catch (e) {
            console.warn(`[Mobile retryPendingSync] 메시지 ${msg.id} 전송 실패:`, e);
            break;
          }
        }

        if (hasUpdates) {
          await storage.saveSession(chatSession);
        }
      }
    } catch (e) {
      console.warn('[Mobile retryPendingSync] 오류:', e);
    }
  }, []);

  const loadSessions = useCallback(async () => {
    try {
      const authSession = await authAdapter.getSession();
      if (authSession?.isAuthenticated) {
        // 1회성 마이그레이션 (유저별 lastSyncedAt 체크)
        const lastSyncedKey = `mobile_lastSyncedAt_${authSession.user.id}`;
        const lastSyncedAt = await AsyncStorage.getItem(lastSyncedKey);
        if (!lastSyncedAt) {
          const localList = await storage.listSessions();
          const syncPayload = [];
          for (const s of localList) {
            const loaded = await storage.loadSession(s.id);
            if (loaded) {
              syncPayload.push({
                id: loaded.id,
                title: loaded.title,
                model_id: loaded.modelId,
                status: loaded.status,
                created_at: new Date(loaded.createdAt).toISOString(),
                updated_at: new Date(loaded.updatedAt).toISOString(),
                messages: loaded.messages.map(m => ({
                  id: m.id,
                  role: m.role,
                  content: m.content,
                  created_at: new Date(m.timestamp).toISOString(),
                })),
              });
            }
          }
          if (syncPayload.length > 0) {
            try {
              await remoteAdapter.syncPush(syncPayload);
            } catch (e) {
              console.warn('[Mobile loadSessions] syncPush 실패:', e);
            }
          }
          await AsyncStorage.setItem(lastSyncedKey, Date.now().toString());
        }

        try {
          const remoteSessions = await remoteAdapter.fetchSessions();
          const localList = await storage.listSessions();
          const localMap = new Map(localList.map(s => [s.id, s]));
          const remoteMap = new Map(remoteSessions.map(s => [s.id, s]));

          // 1. 서버 세션 로컬 생성 및 업데이트
          for (const rs of remoteSessions) {
            const createdAt = new Date(rs.created_at).getTime();
            const updatedAt = new Date(rs.updated_at).getTime();
            if (!localMap.has(rs.id)) {
              const newLocalSession: ChatSession = {
                id: rs.id,
                title: rs.title,
                status: (rs.status as any) || 'active',
                messages: [],
                modelId: rs.model_id || 'gemma4-e2b',
                createdAt,
                updatedAt,
                sessionSyncStatus: 'synced',
              };
              await storage.saveSession(newLocalSession);
            } else {
              const existing = await storage.loadSession(rs.id);
              if (existing && (existing.title !== rs.title || existing.updatedAt !== updatedAt)) {
                existing.title = rs.title;
                existing.updatedAt = updatedAt;
                await storage.saveSession(existing);
              }
            }
          }

          // 2. 서버에서 소프트 삭제된 세션 및 이전 로컬 세션 정리
          for (const ls of localList) {
            if (!remoteMap.has(ls.id)) {
              const fullLocal = await storage.loadSession(ls.id);
              if (fullLocal?.sessionSyncStatus !== 'pending') {
                await storage.deleteSession(ls.id);
              }
            }
          }

        } catch (e) {
          console.warn('[Mobile loadSessions] 원격 세션 목록 로드 실패, 로컬 사용:', e);
        }
      }

      const list = await storage.listSessions();
      setSessions(list);
    } catch (e) {
      console.error('Failed to load sessions in Context', e);
    }
  }, []);


  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        retryPendingSync().then(() => loadSessions());
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    const unsubscribeAuth = authAdapter.onAuthStateChange((s) => {
      if (s?.isAuthenticated) {
        loadSessions().then(() => retryPendingSync());
      }
    });

    return () => {
      subscription.remove();
      unsubscribeAuth();
    };
  }, [retryPendingSync, loadSessions]);


  const setActiveSessionId = useCallback((id: string | undefined) => {
    setActiveSessionIdState(id);
    if (!id) {
      setCurrentChatTitle('대화방');
    }
  }, []);

  const updateSessionTitle = useCallback(async (sessionId: string, newTitle: string) => {
    try {
      const session = await storage.loadSession(sessionId);
      if (session) {
        session.title = newTitle;
        session.updatedAt = Date.now();
        await storage.saveSession(session);

        const authSession = await authAdapter.getSession();
        if (authSession?.isAuthenticated) {
          try {
            await remoteAdapter.createSession({
              id: session.id,
              title: session.title,
              model_id: session.modelId,
              created_at: new Date(session.createdAt).toISOString(),
              updated_at: new Date(session.updatedAt).toISOString(),
            });
          } catch (e) {
            console.warn('[updateSessionTitle] 원격 갱신 실패:', e);
          }
        }
      }
      
      if (sessionId === activeSessionId) {
        setCurrentChatTitle(newTitle);
      }

      await loadSessions();
    } catch (e) {
      console.error('Failed to update session title in Context', e);
    }
  }, [activeSessionId, loadSessions]);

  const deleteSession = useCallback(async (sessionId: string) => {
    try {
      await storage.deleteSession(sessionId);

      const authSession = await authAdapter.getSession();
      if (authSession?.isAuthenticated) {
        try {
          await remoteAdapter.deleteSession(sessionId);
        } catch (e) {
          console.warn('[deleteSession] 원격 삭제 실패:', e);
        }
      }

      if (sessionId === activeSessionId) {
        setActiveSessionIdState(undefined);
        setCurrentChatTitle('대화방');
      }
      await loadSessions();
    } catch (e) {
      console.error('Failed to delete session in Context', e);
    }
  }, [activeSessionId, loadSessions]);

  const clearAllSessions = useCallback(async () => {
    try {
      await storage.clearAll();
      setSessions([]);
      setActiveSessionIdState(undefined);
      setCurrentChatTitle('대화방');
    } catch (e) {
      console.error('Failed to clear sessions in Context', e);
      throw e;
    }
  }, []);

  return (
    <ChatContext.Provider
      value={{
        sessions,
        currentChatTitle,
        activeSessionId,
        loadSessions,
        updateSessionTitle,
        deleteSession,
        clearAllSessions,
        setActiveSessionId,
        setCurrentChatTitle,
        retryPendingSync,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
};

export const useChat = () => {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
};
