/**
 * WebAuthAdapter — 웹 브라우저 환경용 OAuth 2.0 인증 어댑터
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ 모바일(MobileAuthAdapter) vs 웹(WebAuthAdapter) 인증 플로우 차이   │
 * ├─────────────────────────────────────────────────────────────────┤
 * │ [모바일 - React Native]                                         │
 * │  • 네이티브 SDK(Google Sign-In, Kakao SDK 등)로 토큰 직접 획득     │
 * │  • 획득한 accessToken/identityToken을 백엔드 callback에 POST       │
 * │  • Refresh Token을 Keychain(iOS)/Keystore(Android)에 안전 저장     │
 * │                                                                 │
 * │ [웹 - 이 어댑터]                                                  │
 * │  • 백엔드 /start 엔드포인트에서 authorize_url을 받아 팝업 열기        │
 * │  • 사용자가 OAuth 제공자에서 인증 → redirect_uri로 code 반환          │
 * │  • 팝업이 code를 부모 창으로 postMessage 전달                       │
 * │  • 부모 창이 백엔드 /callback에 code POST → 세션 확립               │
 * │  • Access Token은 메모리에, Refresh Token은 HttpOnly 쿠키로 관리     │
 * │  • PKCE는 서버 측에서 state와 함께 Redis에 저장하여 관리             │
 * └─────────────────────────────────────────────────────────────────┘
 */

import {
  type AuthAdapter,
  type ClientPlatform,
  type SocialProvider,
  type AuthSession,
  type AuthTokens,
} from '@repo/auth-shared';

// ── 설정 ────────────────────────────────────────────────────────────
const API_URL = import.meta.env.VITE_AUTH_API_URL || 'http://localhost:8000/api/v1/auth';
const REDIRECT_URI = import.meta.env.VITE_AUTH_REDIRECT_URI || `${window.location.origin}/auth/callback`;

// localStorage 키
const STORAGE_KEY_SESSION = 'auth_session';
const STORAGE_KEY_ACCESS_TOKEN = 'auth_access_token';

/**
 * 백엔드 AuthSessionResponse와 동일한 구조
 */
interface BackendAuthResponse {
  user: {
    id: string;
    email: string | null;
    display_name: string | null;
    profile_image_url: string | null;
    linked_providers: SocialProvider[];
  };
  access_token: string;
  refresh_token: string | null; // 웹에서는 HttpOnly 쿠키로 전달되므로 null
  token_type: string;
  expires_in: number;
  linked_provider: SocialProvider;
  is_new_user: boolean;
}

export class WebAuthAdapter implements AuthAdapter {
  readonly platform: ClientPlatform = 'web';

  private callbacks: Set<(session: AuthSession | null) => void> = new Set();
  private currentSession: AuthSession | null = null;
  private accessToken: string | null = null;

  constructor() {
    this.restoreSession();
  }

  // ════════════════════════════════════════════════════════════════
  // 세션 영속화 (localStorage)
  // ════════════════════════════════════════════════════════════════

  private restoreSession(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_SESSION);
      const token = localStorage.getItem(STORAGE_KEY_ACCESS_TOKEN);
      if (raw) {
        const session: AuthSession = JSON.parse(raw);
        // 만료 확인
        if (session.expiresAt > Date.now()) {
          this.currentSession = session;
          this.accessToken = token;
        } else {
          // 만료된 세션 정리 — 갱신 시도는 getSession에서
          this.clearStorage();
        }
      }
    } catch (e) {
      console.error('[WebAuthAdapter] restoreSession error:', e);
      this.clearStorage();
    }
  }

  private persistSession(session: AuthSession | null, accessToken?: string): void {
    this.currentSession = session;
    if (session) {
      localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(session));
      if (accessToken) {
        this.accessToken = accessToken;
        localStorage.setItem(STORAGE_KEY_ACCESS_TOKEN, accessToken);
      }
    } else {
      this.clearStorage();
    }
    // 모든 구독자에게 알림
    this.callbacks.forEach(cb => cb(session));
  }

  private clearStorage(): void {
    this.currentSession = null;
    this.accessToken = null;
    localStorage.removeItem(STORAGE_KEY_SESSION);
    localStorage.removeItem(STORAGE_KEY_ACCESS_TOKEN);
  }

  // ════════════════════════════════════════════════════════════════
  // AuthAdapter 인터페이스 구현
  // ════════════════════════════════════════════════════════════════

  /**
   * 소셜 로그인 시작 — 팝업 기반 OAuth 플로우
   *
   * 1. 백엔드 /start 에서 authorize_url 획득 (서버가 PKCE/state를 Redis에 저장)
   * 2. 팝업 창에서 해당 URL로 이동
   * 3. 사용자가 인증하면 redirect_uri(/auth/callback)로 code가 전달됨
   * 4. 팝업 페이지가 window.opener.postMessage로 code를 전달
   * 5. 부모 창이 code를 받아 백엔드 /callback에 POST → 세션 확립
   */
  async startLogin(provider: SocialProvider): Promise<void> {
    try {
      // 1단계: 백엔드에서 authorize_url 획득
      const startRes = await fetch(
        `${API_URL}/social/${provider}/start?redirect_uri=${encodeURIComponent(REDIRECT_URI)}&platform=web`,
        { cache: 'no-store' }
      );

      if (!startRes.ok) {
        throw new Error(`[WebAuthAdapter] /start 요청 실패: ${startRes.status}`);
      }

      const { authorize_url } = await startRes.json();

      // 2단계: 팝업 창 열기
      const popup = this.openOAuthPopup(authorize_url);

      // 3단계: 팝업에서 code를 받을 때까지 대기
      const callbackParams = await this.waitForOAuthCallback(popup);

      // 4단계: 백엔드 /callback에 code 전달하여 세션 확립
      const session = await this.handleCallback(provider, callbackParams);

      // 5단계: 세션 저장 및 구독자 알림
      console.log(`[WebAuthAdapter] ${provider} 로그인 성공:`, session.user.displayName);

    } catch (error) {
      console.error(`[WebAuthAdapter] ${provider} 로그인 실패:`, error);
      throw error;
    }
  }

  /**
   * 콜백 처리 — 백엔드에 인가 코드를 전달하여 세션을 확립
   */
  async handleCallback(
    provider: SocialProvider,
    params: Record<string, string>
  ): Promise<AuthSession> {
    const res = await fetch(`${API_URL}/social/${provider}/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include', // HttpOnly 쿠키(refresh_token)를 받기 위해 필수
      body: JSON.stringify({
        code: params.code,
        state: params.state || null,
        redirect_uri: REDIRECT_URI,
        platform: 'web',
      }),
    });

    if (!res.ok) {
      const errorBody = await res.text();
      throw new Error(`[WebAuthAdapter] /callback 실패: ${res.status} ${errorBody}`);
    }

    const data: BackendAuthResponse = await res.json();

    // 백엔드 응답을 AuthSession으로 변환
    const session: AuthSession = {
      isAuthenticated: true,
      expiresAt: Date.now() + data.expires_in * 1000,
      user: {
        id: data.user.id,
        email: data.user.email,
        displayName: data.user.display_name,
        profileImageUrl: data.user.profile_image_url,
        linkedProviders: data.user.linked_providers,
      },
    };

    // access_token은 메모리 + localStorage에, refresh_token은 HttpOnly 쿠키로 관리
    this.persistSession(session, data.access_token);

    return session;
  }

  /**
   * 현재 인증 세션 확인
   */
  async getSession(): Promise<AuthSession | null> {
    if (this.currentSession && this.currentSession.expiresAt > Date.now()) {
      return this.currentSession;
    }

    // 세션이 만료되었으면 갱신 시도
    if (this.currentSession) {
      const tokens = await this.refresh();
      if (tokens) {
        return this.currentSession;
      }
      // 갱신 실패 시 로그아웃 처리
      this.persistSession(null);
    }

    return null;
  }

  /**
   * 토큰 갱신 — HttpOnly 쿠키의 refresh_token을 사용
   */
  async refresh(): Promise<AuthTokens | null> {
    try {
      const res = await fetch(`${API_URL}/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // HttpOnly 쿠키 전송
        body: JSON.stringify({}), // 웹은 쿠키에서 refresh_token을 읽으므로 빈 body
      });

      if (!res.ok) {
        return null;
      }

      const data = await res.json();

      // 세션 만료 시간 갱신
      if (this.currentSession) {
        this.persistSession(
          {
            ...this.currentSession,
            expiresAt: Date.now() + data.expires_in * 1000,
          },
          data.access_token
        );
      }

      return {
        accessToken: data.access_token,
        refreshToken: null, // 웹은 쿠키 기반이므로 body에 없음
        expiresIn: data.expires_in,
      };
    } catch (e) {
      console.error('[WebAuthAdapter] 토큰 갱신 실패:', e);
      return null;
    }
  }

  /**
   * 로그아웃 — 백엔드 세션 폐기 + 로컬 정리
   */
  async logout(): Promise<void> {
    try {
      if (this.accessToken) {
        await fetch(`${API_URL}/logout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.accessToken}`,
          },
          credentials: 'include',
        });
      }
    } catch (e) {
      console.warn('[WebAuthAdapter] 로그아웃 API 호출 실패 (로컬 정리는 계속)', e);
    } finally {
      this.persistSession(null);
    }
  }

  /**
   * 계정 탈퇴 — 백엔드 계정 삭제 + 로컬 정리
   */
  async deleteAccount(): Promise<void> {
    try {
      if (this.accessToken) {
        await fetch(`${API_URL}/me`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.accessToken}`,
          },
          credentials: 'include',
        });
      }
    } catch (e) {
      console.warn('[WebAuthAdapter] 계정 삭제 API 호출 실패', e);
    } finally {
      this.persistSession(null);
    }
  }

  /**
   * 인증 상태 변경 구독
   */
  onAuthStateChange(callback: (session: AuthSession | null) => void): () => void {
    this.callbacks.add(callback);
    // 구독 즉시 현재 상태 전달
    callback(this.currentSession);

    return () => {
      this.callbacks.delete(callback);
    };
  }

  // ════════════════════════════════════════════════════════════════
  // 유틸리티: Access Token 접근자 (API 호출용)
  // ════════════════════════════════════════════════════════════════

  getAccessToken(): string | null {
    return this.accessToken;
  }

  // ════════════════════════════════════════════════════════════════
  // 내부: 팝업 기반 OAuth 플로우 헬퍼
  // ════════════════════════════════════════════════════════════════

  /**
   * OAuth 인가 URL을 팝업 창에서 엶
   */
  private openOAuthPopup(url: string): Window {
    const width = 500;
    const height = 700;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;

    const popup = window.open(
      url,
      'oauth_popup',
      `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no,scrollbars=yes,resizable=yes`
    );

    if (!popup) {
      throw new Error(
        '팝업이 차단되었습니다. 브라우저 설정에서 팝업을 허용해 주세요.'
      );
    }

    return popup;
  }

  /**
   * 팝업 창에서 OAuth 콜백 결과를 기다림
   *
   * ⚠️ COOP (Cross-Origin-Opener-Policy) 대응:
   *  Google 등 OAuth 제공자는 인증 페이지에 COOP 헤더를 포함시켜
   *  팝업과 부모 창 간의 opener 참조를 완전히 끊어버린다.
   *  - 팝업: window.opener === null → postMessage 전송 불가
   *  - 부모: popup.closed === true로 즉시 읽힘
   *  → 해결: localStorage 폴링(300ms)을 주 통신 수단으로,
   *           popup.closed 감지 시 즉시 reject 대신 1.5초 대기 후 reject.
   */
  private waitForOAuthCallback(
    popup: Window
  ): Promise<Record<string, string>> {
    return new Promise((resolve, reject) => {
      console.log('[WebAuthAdapter] Waiting for OAuth callback (COOP-safe)...');
      let settled = false;

      const settle = (value?: Record<string, string>, error?: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (value) resolve(value);
        else if (error) reject(error);
      };

      // 전체 타임아웃 (5분)
      const timeout = setTimeout(() => {
        settle(undefined, new Error('OAuth 인증 시간이 초과되었습니다. (5분)'));
      }, 5 * 60 * 1000);

      // ── Tier 1: postMessage (COOP 미적용 환경에서 작동) ──────────
      const handleMessage = (event: MessageEvent) => {
        if (event.data?.type === 'OAUTH_CALLBACK') {
          console.log('[WebAuthAdapter] postMessage received:', event.data);
          if (event.data.error) {
            settle(undefined, new Error(`OAuth 에러: ${event.data.error}`));
          } else {
            settle({ code: event.data.code, state: event.data.state });
          }
        }
      };
      window.addEventListener('message', handleMessage);

      // ── Tier 2: storage 이벤트 (다른 탭/창에서 쓴 경우 발생) ─────
      const handleStorage = (event: StorageEvent) => {
        if (event.key === 'oauth_callback_data' && event.newValue) {
          console.log('[WebAuthAdapter] storage event received:', event.newValue);
          try {
            const data = JSON.parse(event.newValue);
            localStorage.removeItem('oauth_callback_data');
            if (data.error) {
              settle(undefined, new Error(`OAuth 에러: ${data.error}`));
            } else {
              settle({ code: data.code, state: data.state });
            }
          } catch (e) {
            console.error('[WebAuthAdapter] storage event parse error:', e);
          }
        }
      };
      window.addEventListener('storage', handleStorage);

      // ── Tier 3: BroadcastChannel (가장 안정적, COOP 회피) ────────
      let bc: BroadcastChannel | null = null;
      try {
        bc = new BroadcastChannel('oauth_channel');
        bc.onmessage = (event) => {
          if (event.data?.type === 'OAUTH_CALLBACK') {
            console.log('[WebAuthAdapter] BroadcastChannel received:', event.data);
            if (event.data.error) {
              settle(undefined, new Error(`OAuth 에러: ${event.data.error}`));
            } else {
              settle({ code: event.data.code, state: event.data.state });
            }
          }
        };
      } catch (e) {
        console.warn('[WebAuthAdapter] BroadcastChannel not supported:', e);
      }

      // ── Tier 4: localStorage 폴링 ─────────────────────────────────
      // COOP 환경: 팝업이 같은 origin의 localStorage에 쓰고 닫힌 후
      // storage 이벤트가 발생하지 않을 수 있음 → 직접 폴링
      const localStoragePoll = setInterval(() => {
        const stored = localStorage.getItem('oauth_callback_data');
        if (stored) {
          console.log('[WebAuthAdapter] localStorage poll found data:', stored);
          try {
            const data = JSON.parse(stored);
            localStorage.removeItem('oauth_callback_data');
            if (data.error) {
              settle(undefined, new Error(`OAuth 에러: ${data.error}`));
            } else {
              settle({ code: data.code, state: data.state });
            }
          } catch (e) {
            console.error('[WebAuthAdapter] localStorage poll parse error:', e);
          }
        }
      }, 300);

      // ── 팝업 닫힘 감지 제거 ──────────────────────────────────────
      // COOP로 인해 구글로 이동하는 순간 popup.closed가 즉시 true가 됩니다.
      // 따라서 popup.closed로 사용자가 창을 닫았는지 판단할 수 없습니다.
      // 대신, 상단에 선언된 5분(300,000ms) 전체 타임아웃을 의존합니다.

      const cleanup = () => {
        clearTimeout(timeout);
        clearInterval(localStoragePoll);
        window.removeEventListener('message', handleMessage);
        window.removeEventListener('storage', handleStorage);
        try { bc?.close(); } catch (_) {}
        try { if (!popup.closed) popup.close(); } catch (_) {}
      };
    });
  }
}
