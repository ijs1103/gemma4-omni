import * as Keychain from 'react-native-keychain';
import { InAppBrowser } from 'react-native-inappbrowser-reborn';
import { Platform, Linking } from 'react-native';
import type { AuthAdapter, SocialProvider, AuthSession, AuthTokens, ClientPlatform } from '@repo/auth-shared';
import { kakaoNativeLogin, naverNativeLogin } from './NativeLoginHelper';

// ── 설정 ──────────────────────────────────────────────────────────
// 127.0.0.1:8000을 사용합니다.
// Android Chrome Custom Tab에서 localhost는 DNS 이슈로 작동하지 않을 수 있지만,
// 127.0.0.1은 IP 주소이므로 adb reverse를 통해 Host PC로 안전하게 포워딩됩니다.
// 실기기 및 배포 환경 모두 오라클 클라우드 라이브 백엔드 서버(161.33.7.206:8000)를 직접 바라보도록 설정
const API_HOST_FOR_APP = '161.33.7.206:8000';
const API_URL = `http://${API_HOST_FOR_APP}/api/v1/auth`;

// Google OAuth 보안 정책(RFC 8252) 준수: Google은 raw HTTP IP를 redirect_uri로 허용하지 않으므로 Vercel의 HTTPS 프록시 주소를 사용합니다.
const WEB_LANDING_URI = 'https://gemma4-omni-web.vercel.app/api/v1/auth/social/mobile-landing';

// InAppBrowser가 캐치해야 하는 최종 앱의 딥링크 스킴
const MOBILE_DEEP_LINK = 'com.mobile://oauth/callback';

const PLATFORM: ClientPlatform = Platform.OS === 'ios' ? 'ios' : 'android';

// Keychain 서비스 키
const KC_REFRESH = 'auth_refresh_token';
const KC_ACCESS = 'auth_access_token';
const KC_USER = 'auth_user';
const KC_EXPIRES = 'auth_expires_at';

// ── 내부 타입 ──────────────────────────────────────────────────────
interface BackendUser {
  id: string;
  email?: string;
  display_name?: string;
  profile_image_url?: string;
  linked_providers: SocialProvider[];
}

interface BackendSessionResponse {
  user: BackendUser;
  access_token: string;
  refresh_token: string;
  expires_in: number;
  linked_provider: SocialProvider;
  is_new_user: boolean;
}

// ── URL 파싱 헬퍼 ─────────────────────────────────────────────────
function parseCallbackUrl(url: string): Record<string, string> {
  const params: Record<string, string> = {};
  try {
    const queryString = url.includes('?') ? url.split('?')[1] : '';
    if (!queryString) return params;
    queryString.split('&').forEach(pair => {
      const [key, value] = pair.split('=');
      if (key && value !== undefined) {
        params[decodeURIComponent(key)] = decodeURIComponent(value);
      }
    });
  } catch (e) {
    console.warn('[MobileAuthAdapter] URL 파싱 오류:', e);
  }
  return params;
}

// ── MobileAuthAdapter ─────────────────────────────────────────────
export class MobileAuthAdapter implements AuthAdapter {
  readonly platform: ClientPlatform = PLATFORM;
  private callbacks: Set<(session: AuthSession | null) => void> = new Set();
  private currentSession: AuthSession | null = null;
  private accessToken: string | null = null;
  private refreshPromise: Promise<AuthTokens | null> | null = null;

  private notifyAuthChange(session: AuthSession | null): void {
    this.currentSession = session;
    this.callbacks.forEach((cb) => {
      try {
        cb(session);
      } catch (e) {
        console.error('[MobileAuthAdapter] callback error:', e);
      }
    });
  }

  /**
   * AuthAdapter 인터페이스 구현.
   * AuthContext에서는 startLoginAndGetSession()을 직접 사용하세요.
   */
  async startLogin(provider: SocialProvider): Promise<void> {
    await this.startLoginAndGetSession(provider);
  }

  /**
   * 소셜 로그인 실행 후 AuthSession을 반환합니다 (AuthContext에서 사용).
   * 1. 백엔드 /start → authorize_url 획득 (카카오/네이버는 WEB_LANDING_URI 전달)
   * 2. InAppBrowser.openAuth()로 OAuth 페이지 열기
   * 3. 콜백 URL에서 code/state 파싱
   * 4. handleCallback()으로 토큰 발급 및 저장
   */
  async startLoginAndGetSession(provider: SocialProvider): Promise<AuthSession> {
    // ── 카카오/네이버: 네이티브 SDK 사용 ──────────────────────────
    // 네이티브 SDK는 Chrome Custom Tab을 사용하지 않으므로
    // 127.0.0.1 루프백 차단 문제를 완전히 우회합니다.
    if (provider === 'kakao' || provider === 'naver') {
      return this._nativeSDKLogin(provider);
    }

    // ── 구글/기타: InAppBrowser 사용 ─────────────────────────────
    const redirectUri = WEB_LANDING_URI;

    // ── 1. 백엔드에서 authorize URL 획득 ──────────────────────────
    const startUrl =
      `${API_URL}/social/${provider}/start` +
      `?redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&platform=${PLATFORM}`;

    console.log(`[MobileAuth] 1. /start 요청: ${startUrl}`);
    const startRes = await fetch(startUrl);
    if (!startRes.ok) {
      const body = await startRes.text();
      throw new Error(`[Auth] /start 실패 (${provider}): ${startRes.status} ${body}`);
    }
    const { authorize_url } = await startRes.json();
    console.log(`[MobileAuth] 2. authorize_url 획득 성공: ${authorize_url}`);

    // ── 2. InAppBrowser로 OAuth 페이지 열기 ───────────────────────
    let callbackUrl: string;

    if (await InAppBrowser.isAvailable()) {
      console.log(`[MobileAuth] [${new Date().toISOString()}] 3. InAppBrowser.open 호출, url=${authorize_url}`);
      
      callbackUrl = await new Promise<string>((resolve, reject) => {
        let isResolved = false;

        // 딥링크 리스너 등록
        const handleDeepLink = ({ url }: { url: string }) => {
          if (url.startsWith(MOBILE_DEEP_LINK)) {
            console.log(`[MobileAuth] [${new Date().toISOString()}] 4. DeepLink 수신: ${url}`);
            if (!isResolved) {
              isResolved = true;
              InAppBrowser.close(); // 브라우저 닫기
              resolve(url);
            }
          }
        };
        const linkingSubscription = Linking.addEventListener('url', handleDeepLink);

        InAppBrowser.open(authorize_url, {
          showTitle: false,
          enableUrlBarHiding: true,
          enableDefaultShare: false,
          forceCloseOnRedirection: false,
          preferredBarTintColor: '#1a1a2e',
          preferredControlTintColor: '#ffffff',
          animated: true,
          modalPresentationStyle: 'fullScreen',
          modalTransitionStyle: 'coverVertical',
          modalEnabled: true,
          enableBarCollapsing: false,
        }).then((result) => {
          console.log(`[MobileAuth] [${new Date().toISOString()}] 5. InAppBrowser 닫힘: type=${result.type}`);
          
          if (!isResolved) {
            if (result.type === 'cancel' || result.type === 'dismiss') {
              // cancel: 사용자가 뒤로가기로 브라우저를 닫은 경우
              // dismiss: 딥링크 인텐트 수신으로 시스템이 브라우저를 닫은 경우
              // 두 경우 모두 딥링크 이벤트를 받을 시간을 줍니다.
              setTimeout(() => {
                if (!isResolved) {
                  linkingSubscription.remove();
                  reject(new Error('LOGIN_CANCELLED'));
                }
              }, 2000);
            } else {
              linkingSubscription.remove();
              reject(new Error(`[Auth] 로그인 완료 전 브라우저 닫힘: type=${result.type}`));
            }
          }
        }).catch((err) => {
          linkingSubscription.remove();
          if (!isResolved) {
            reject(err);
          }
        });
      });
    } else {
      await Linking.openURL(authorize_url);
      throw new Error('[Auth] 인앱 브라우저를 사용할 수 없어 외부 브라우저로 열었습니다.');
    }

    // ── 3. 콜백 URL 파싱 ──────────────────────────────────────────
    console.log(`[MobileAuth] 5. callbackUrl: ${callbackUrl}`);
    const params = parseCallbackUrl(callbackUrl);
    console.log(`[MobileAuth] 6. 파싱 결과: code=${params.code ? '있음(' + params.code.substring(0, 10) + '...)' : '없음'}, state=${params.state ? '있음' : '없음'}, error=${params.error || '없음'}`);
    const { code, state, error, error_description } = params;

    if (error) {
      throw new Error(`[Auth] OAuth 에러: ${error} - ${error_description ?? ''}`);
    }
    if (!code) {
      throw new Error('[Auth] 콜백 URL에 authorization code가 없습니다.');
    }

    // ── 4. 백엔드 /callback 호출 및 세션 확립 ─────────────────────
    return this.handleCallback(provider, {
      code,
      state: state ?? '',
      redirect_uri: redirectUri,
    });
  }

  /**
   * OAuth 인가 코드로 백엔드에 세션을 요청하고 토큰을 저장합니다.
   */
  async handleCallback(
    provider: SocialProvider,
    params: Record<string, string>,
  ): Promise<AuthSession> {
    const res = await fetch(`${API_URL}/social/${provider}/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: params.code,
        state: params.state,
        redirect_uri: params.redirect_uri ?? MOBILE_DEEP_LINK,
        platform: PLATFORM,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`[Auth] /callback 실패 (${provider}): ${res.status} ${body}`);
    }

    const data: BackendSessionResponse = await res.json();
    const expiresAt = Date.now() + data.expires_in * 1000;

    // Keychain에 토큰 + 사용자 정보 + 만료시간 저장
    await Promise.all([
      Keychain.setGenericPassword('refresh_token', data.refresh_token, { service: KC_REFRESH }),
      Keychain.setGenericPassword('access_token', data.access_token, { service: KC_ACCESS }),
      Keychain.setGenericPassword('user', JSON.stringify(data.user), { service: KC_USER }),
      Keychain.setGenericPassword('expires_at', expiresAt.toString(), { service: KC_EXPIRES }),
    ]);

    this.accessToken = data.access_token;
    const session = this._toAuthSession(data);
    this.notifyAuthChange(session);
    return session;
  }

  /**
   * Keychain에서 저장된 세션을 복원합니다.
   * 이미 유효한 세션이 있으면 네트워크 요청 없이 즉시 반환합니다.
   */
  async getSession(): Promise<AuthSession | null> {
    if (this.currentSession && this.currentSession.expiresAt > Date.now()) {
      return this.currentSession;
    }

    try {
      const [refreshCreds, userCreds, accessCreds, expiresCreds] = await Promise.all([
        Keychain.getGenericPassword({ service: KC_REFRESH }),
        Keychain.getGenericPassword({ service: KC_USER }),
        Keychain.getGenericPassword({ service: KC_ACCESS }),
        Keychain.getGenericPassword({ service: KC_EXPIRES }),
      ]);

      if (!refreshCreds || !userCreds) {
        this.currentSession = null;
        this.accessToken = null;
        return null;
      }

      const user: BackendUser = JSON.parse(userCreds.password);
      const expiresAt = expiresCreds ? parseInt(expiresCreds.password, 10) : 0;

      // 만료되지 않은 경우 로컬 캐시 세션 복원
      if (expiresAt > Date.now() && accessCreds) {
        this.accessToken = accessCreds.password;
        this.currentSession = {
          user: {
            id: user.id,
            email: user.email ?? null,
            displayName: user.display_name ?? null,
            profileImageUrl: user.profile_image_url ?? null,
            linkedProviders: user.linked_providers,
          },
          isAuthenticated: true,
          expiresAt,
        };
        return this.currentSession;
      }

      // 만료된 경우 단일-플라이트 토큰 갱신 시도
      const tokens = await this.refresh();
      if (!tokens) return null;

      this.currentSession = {
        user: {
          id: user.id,
          email: user.email ?? null,
          displayName: user.display_name ?? null,
          profileImageUrl: user.profile_image_url ?? null,
          linkedProviders: user.linked_providers,
        },
        isAuthenticated: true,
        expiresAt: Date.now() + tokens.expiresIn * 1000,
      };
      return this.currentSession;
    } catch (e) {
      console.warn('[MobileAuthAdapter] getSession 오류:', e);
      return null;
    }
  }

  /**
   * Refresh Token으로 새 Access Token을 발급받습니다.
   * 동시 호출 시 중복 요청을 방지하기 위해 단일 Promise를 공유합니다.
   */
  async refresh(): Promise<AuthTokens | null> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }
    this.refreshPromise = this._doRefresh().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  private async _doRefresh(): Promise<AuthTokens | null> {
    try {
      const credentials = await Keychain.getGenericPassword({ service: KC_REFRESH });
      if (!credentials) return null;

      const res = await fetch(`${API_URL}/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: credentials.password }),
      });

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          console.warn('[MobileAuthAdapter] refresh 인증 거부 (401/403) → 로그아웃 처리');
          await this.logout();
        }
        return null;
      }

      const data = await res.json();
      const expiresAt = Date.now() + data.expires_in * 1000;

      this.accessToken = data.access_token;
      if (this.currentSession) {
        this.currentSession = {
          ...this.currentSession,
          expiresAt,
        };
      }

      await Promise.all([
        Keychain.setGenericPassword('access_token', data.access_token, { service: KC_ACCESS }),
        ...(data.refresh_token
          ? [Keychain.setGenericPassword('refresh_token', data.refresh_token, { service: KC_REFRESH })]
          : []),
      ]);

      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? null,
        expiresIn: data.expires_in,
      };
    } catch (e) {
      console.warn('[MobileAuthAdapter] refresh 오류:', e);
      return null;
    }
  }

  /**
   * 저장된 Access Token을 반환합니다 (API 요청 Authorization 헤더용).
   */
  async getAccessToken(): Promise<string | null> {
    if (this.accessToken && this.currentSession && this.currentSession.expiresAt > Date.now()) {
      return this.accessToken;
    }

    try {
      const [accessCreds, expiresCreds] = await Promise.all([
        Keychain.getGenericPassword({ service: KC_ACCESS }),
        Keychain.getGenericPassword({ service: KC_EXPIRES }),
      ]);
      const expiresAt = expiresCreds ? parseInt(expiresCreds.password, 10) : 0;
      if (accessCreds && expiresAt > Date.now()) {
        this.accessToken = accessCreds.password;
        return this.accessToken;
      }

      const tokens = await this.refresh();
      return tokens ? tokens.accessToken : null;
    } catch {
      return null;
    }
  }

  async logout(): Promise<void> {
    this.accessToken = null;
    this.currentSession = null;
    await Promise.allSettled([
      Keychain.resetGenericPassword({ service: KC_REFRESH }),
      Keychain.resetGenericPassword({ service: KC_ACCESS }),
      Keychain.resetGenericPassword({ service: KC_USER }),
      Keychain.resetGenericPassword({ service: KC_EXPIRES }),
    ]);
    try {
      await InAppBrowser.closeAuth();
    } catch {
      // 닫을 브라우저 없을 수 있음 — 무시
    }
    this.notifyAuthChange(null);
  }


  async deleteAccount(): Promise<void> {
    try {
      const accessToken = await this.getAccessToken();
      await fetch(`${API_URL}/me`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
      });
    } catch (e) {
      console.warn('[MobileAuthAdapter] 계정 삭제 백엔드 요청 실패 (로컬 데이터만 제거):', e);
    } finally {
      await this.logout();
    }
  }

  onAuthStateChange(callback: (session: AuthSession | null) => void): () => void {
    this.callbacks.add(callback);
    callback(this.currentSession);
    return () => {
      this.callbacks.delete(callback);
    };
  }

  // ── 네이티브 SDK 로그인 헬퍼 ─────────────────────────────────────

  /**
   * 카카오/네이버 네이티브 SDK를 사용하여 로그인하고 세션을 생성합니다.
   * SDK가 OAuth 전체 흐름을 네이티브로 처리하므로 InAppBrowser가 필요 없습니다.
   */
  private async _nativeSDKLogin(provider: 'kakao' | 'naver'): Promise<AuthSession> {
    console.log(`[MobileAuth] 네이티브 SDK 로그인 시작: ${provider}`);

    // 1. 네이티브 SDK 호출 → accessToken 획득
    const result = provider === 'kakao'
      ? await kakaoNativeLogin()
      : await naverNativeLogin();

    console.log(`[MobileAuth] ${provider} 네이티브 로그인 성공, accessToken 획득`);

    // 2. 백엔드 /native-callback 호출 → 세션 생성
    const res = await fetch(`${API_URL}/social/${provider}/native-callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: result.accessToken,
        platform: PLATFORM,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`[Auth] /native-callback 실패 (${provider}): ${res.status} ${body}`);
    }

    const data: BackendSessionResponse = await res.json();

    // 3. Keychain에 토큰 + 사용자 정보 저장
    await Promise.all([
      Keychain.setGenericPassword('refresh_token', data.refresh_token, { service: KC_REFRESH }),
      Keychain.setGenericPassword('access_token', data.access_token, { service: KC_ACCESS }),
      Keychain.setGenericPassword('user', JSON.stringify(data.user), { service: KC_USER }),
    ]);

    console.log(`[MobileAuth] ${provider} 세션 생성 완료`);
    const session = this._toAuthSession(data);
    this.notifyAuthChange(session);
    return session;
  }


  // ── 내부 헬퍼 ───────────────────────────────────────────────────
  private _toAuthSession(data: BackendSessionResponse): AuthSession {
    return {
      user: {
        id: data.user.id,
        email: data.user.email ?? null,
        displayName: data.user.display_name ?? null,
        profileImageUrl: data.user.profile_image_url ?? null,
        linkedProviders: data.user.linked_providers,
      },
      isAuthenticated: true,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
  }
}
