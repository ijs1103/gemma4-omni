import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { AuthUser, AuthSession } from '@repo/auth-shared';
import { MobileAuthAdapter } from '../adapters/MobileAuthAdapter';

// 앱 전역에서 사용하는 어댑터 인스턴스 (싱글톤)
export const authAdapter = new MobileAuthAdapter();

// ── Context 타입 ──────────────────────────────────────────────────
interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;         // 앱 시작 시 세션 복원 중
  user: AuthUser | null;
  loginWithSession: (session: AuthSession) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// ── AuthProvider ──────────────────────────────────────────────────
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);

  // 앱 시작 시 저장된 세션 복원
  useEffect(() => {
    (async () => {
      try {
        const session = await authAdapter.getSession();
        if (session) {
          setUser(session.user);
          setIsAuthenticated(true);
        }
      } catch (e) {
        console.warn('[AuthContext] 세션 복원 실패:', e);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  /** 로그인 성공 시 AuthContext 상태 업데이트 */
  const loginWithSession = useCallback((session: AuthSession) => {
    setUser(session.user);
    setIsAuthenticated(true);
  }, []);

  /** 로그아웃: Keychain 클리어 + 상태 초기화 */
  const logout = useCallback(async () => {
    await authAdapter.logout();
    setUser(null);
    setIsAuthenticated(false);
  }, []);

  return (
    <AuthContext.Provider value={{ isAuthenticated, isLoading, user, loginWithSession, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

// ── useAuth 훅 ────────────────────────────────────────────────────
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
