import { 
  type AuthAdapter, 
  type ClientPlatform, 
  type SocialProvider, 
  type AuthSession, 
  type AuthTokens 
} from '@repo/auth-shared';

export class WebAuthAdapter implements AuthAdapter {
  readonly platform: ClientPlatform = 'web';
  private callbacks: Set<(session: AuthSession | null) => void> = new Set();
  private currentSession: AuthSession | null = null;

  constructor() {
    this.restoreSession();
  }

  private restoreSession() {
    try {
      const raw = localStorage.getItem('auth_mock_session');
      if (raw) {
        this.currentSession = JSON.parse(raw);
      }
    } catch (e) {
      console.error('restoreSession error:', e);
    }
  }

  private persistSession(session: AuthSession | null) {
    this.currentSession = session;
    if (session) {
      localStorage.setItem('auth_mock_session', JSON.stringify(session));
    } else {
      localStorage.removeItem('auth_mock_session');
    }
    this.callbacks.forEach(cb => cb(session));
  }

  async startLogin(provider: SocialProvider): Promise<void> {
    console.log(`[WebAuthAdapter] startLogin provider: ${provider} (FastAPI 연동 예정)`);
    const mockSession: AuthSession = {
      isAuthenticated: true,
      expiresAt: Date.now() + 86400 * 1000,
      user: {
        id: 'mock-user-1234',
        email: `mock.${provider}@example.com`,
        displayName: `로컬 테스터 (${provider.toUpperCase()})`,
        profileImageUrl: null,
        linkedProviders: [provider]
      }
    };
    this.persistSession(mockSession);
  }

  async handleCallback(_provider: SocialProvider, _params: Record<string, string>): Promise<AuthSession> {
    return this.currentSession || {
      isAuthenticated: false,
      expiresAt: 0,
      user: { id: '', email: null, displayName: null, profileImageUrl: null, linkedProviders: [] }
    };
  }

  async getSession(): Promise<AuthSession | null> {
    return this.currentSession;
  }

  async refresh(): Promise<AuthTokens | null> {
    return null;
  }

  async logout(): Promise<void> {
    this.persistSession(null);
  }

  onAuthStateChange(callback: (session: AuthSession | null) => void): () => void {
    this.callbacks.add(callback);
    callback(this.currentSession);
    
    return () => {
      this.callbacks.delete(callback);
    };
  }
}
