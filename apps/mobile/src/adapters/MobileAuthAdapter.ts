import * as Keychain from 'react-native-keychain';
import { InAppBrowser } from 'react-native-inappbrowser-reborn';
import { Platform, Linking } from 'react-native';
import type { AuthAdapter, SocialProvider, AuthSession, AuthTokens, ClientPlatform } from '@repo/auth-shared';
import { kakaoNativeLogin, naverNativeLogin } from './NativeLoginHelper';

// ── 설정 ──────────────────────────────────────────────────────────
// 127.0.0.1:8000을 사용합니다.
// Android Chrome Custom Tab에서 localhost는 DNS 이슈로 작동하지 않을 수 있지만,
// 127.0.0.1은 IP 주소이므로 adb reverse를 통해 Host PC로 안전하게 포워딩됩니다.
// 또한 구글 콘솔에서 HTTP loopback IP(127.0.0.1)를 Redirect URI로 허용합니다.
const API_HOST_FOR_APP = '127.0.0.1:8000';
const API_URL = `http://${API_HOST_FOR_APP}/api/v1/auth`;

const WEB_LANDING_URI = `http://${API_HOST_FOR_APP}/api/v1/auth/social/mobile-landing`;

// InAppBrowser가 캐치해야 하는 최종 앱의 딥링크 스킴
const MOBILE_DEEP_LINK = 'com.mobile://oauth/callback';

const PLATFORM: ClientPlatform = Platform.OS === 'ios' ? 'ios' : 'android';

// Keychain 서비스 키
const KC_REFRESH = 'auth_refresh_token';
const KC_ACCESS = 'auth_access_token';
const KC_USER = 'auth_user';

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

  /**
   * 소셜 로그인 시작 — AuthAdapter 인터페이스 구현 (void 반환).
   * 내부적으로 startLoginAndGetSession()을 호출합니다.
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
      throw new Error(`[Auth] OAuth 오류: ${error} — ${error_description ?? ''}`);
    }
    if (!code) {
      throw new Error(`[Auth] 콜백 URL에 code가 없습니다: ${callbackUrl}`);
    }

    // ── 4. 백엔드 콜백 처리 & 저장 ────────────────────────────────
    console.log(`[MobileAuth] 7. handleCallback 호출 시작`);
    return this.handleCallback(provider, {
      code,
      state: state ?? '',
      redirect_uri: redirectUri,
    });
  }

  /**
   * 백엔드 /callback 호출 → 토큰 발급 → Keychain 저장 → AuthSession 반환.
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

    // Keychain에 토큰 + 사용자 정보 저장
    await Promise.all([
      Keychain.setGenericPassword('refresh_token', data.refresh_token, { service: KC_REFRESH }),
      Keychain.setGenericPassword('access_token', data.access_token, { service: KC_ACCESS }),
      Keychain.setGenericPassword('user', JSON.stringify(data.user), { service: KC_USER }),
    ]);

    return this._toAuthSession(data);
  }

  /**
   * Keychain에서 저장된 세션을 복원합니다.
   * Refresh Token으로 Access Token을 갱신합니다.
   */
  async getSession(): Promise<AuthSession | null> {
    try {
      const [refreshCreds, userCreds] = await Promise.all([
        Keychain.getGenericPassword({ service: KC_REFRESH }),
        Keychain.getGenericPassword({ service: KC_USER }),
      ]);

      if (!refreshCreds || !userCreds) return null;

      // Access Token 갱신 시도
      const tokens = await this.refresh();
      if (!tokens) return null;

      const user: BackendUser = JSON.parse(userCreds.password);
      return {
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
    } catch (e) {
      console.warn('[MobileAuthAdapter] getSession 오류:', e);
      return null;
    }
  }

  /**
   * Refresh Token으로 새 Access Token을 발급받습니다.
   */
  async refresh(): Promise<AuthTokens | null> {
    try {
      const credentials = await Keychain.getGenericPassword({ service: KC_REFRESH });
      if (!credentials) return null;

      const res = await fetch(`${API_URL}/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: credentials.password }),
      });

      if (!res.ok) {
        console.warn('[MobileAuthAdapter] refresh 실패 → 로그아웃 처리:', res.status);
        await this.logout();
        return null;
      }

      const data = await res.json();

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
    try {
      const creds = await Keychain.getGenericPassword({ service: KC_ACCESS });
      return creds ? creds.password : null;
    } catch {
      return null;
    }
  }

  async logout(): Promise<void> {
    await Promise.allSettled([
      Keychain.resetGenericPassword({ service: KC_REFRESH }),
      Keychain.resetGenericPassword({ service: KC_ACCESS }),
      Keychain.resetGenericPassword({ service: KC_USER }),
    ]);
    try {
      await InAppBrowser.closeAuth();
    } catch {
      // 닫을 브라우저 없을 수 있음 — 무시
    }
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

  onAuthStateChange(_callback: (session: AuthSession | null) => void): () => void {
    return () => { };
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
    return this._toAuthSession(data);
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
