import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import type { ChatSessionSummary } from '@repo/chat-state';
import { MobileStorageAdapter } from '../adapters/MobileStorageAdapter';

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
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

const storage = new MobileStorageAdapter();

export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [currentChatTitle, setCurrentChatTitle] = useState<string>('대화방');
  const [activeSessionId, setActiveSessionIdState] = useState<string | undefined>(undefined);

  const loadSessions = useCallback(async () => {
    try {
      const list = await storage.listSessions();
      setSessions(list);
    } catch (e) {
      console.error('Failed to load sessions in Context', e);
    }
  }, []);

  const setActiveSessionId = useCallback((id: string | undefined) => {
    setActiveSessionIdState(id);
    if (!id) {
      setCurrentChatTitle('대화방');
    }
  }, []);

  const updateSessionTitle = useCallback(async (sessionId: string, newTitle: string) => {
    try {
      // 1. Storage에 반영 (SQLite/AsyncStorage)
      const session = await storage.loadSession(sessionId);
      if (session) {
        session.title = newTitle;
        session.updatedAt = Date.now();
        await storage.saveSession(session);
      }
      
      // 2. 현재 활성화된 채팅방 제목 업데이트
      if (sessionId === activeSessionId) {
        setCurrentChatTitle(newTitle);
      }

      // 3. 사이드바 등의 목록 상태 갱신
      await loadSessions();
    } catch (e) {
      console.error('Failed to update session title in Context', e);
    }
  }, [activeSessionId, loadSessions]);

  const deleteSession = useCallback(async (sessionId: string) => {
    try {
      await storage.deleteSession(sessionId);
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
