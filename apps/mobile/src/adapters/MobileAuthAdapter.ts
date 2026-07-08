import * as Keychain from 'react-native-keychain';
import appleAuth from '@invertase/react-native-apple-authentication';
import { login as kakaoLogin } from '@react-native-seoul/kakao-login';
import NaverLogin from '@react-native-seoul/naver-login';
import type { AuthAdapter, SocialProvider, AuthSession, AuthTokens } from '@repo/auth-shared';

// TODO: 환경변수 연동
const API_URL = 'http://localhost:8000/api/v1/auth';

export class MobileAuthAdapter implements AuthAdapter {
  platform = 'ios' as const; // TODO: Platform.OS 연동

  async startLogin(provider: SocialProvider): Promise<void> {
    try {
      if (provider === 'apple') {
        const appleAuthRequestResponse = await appleAuth.performRequest({
          requestedOperation: appleAuth.Operation.LOGIN,
          requestedScopes: [appleAuth.Scope.EMAIL, appleAuth.Scope.FULL_NAME],
        });
        
        await this.handleCallback(provider, {
          identityToken: appleAuthRequestResponse.identityToken as string,
          authorizationCode: appleAuthRequestResponse.authorizationCode as string,
        });

      } else if (provider === 'kakao') {
        const token = await kakaoLogin();
        await this.handleCallback(provider, {
          accessToken: token.accessToken,
        });

      } else if (provider === 'naver') {
        const { successResponse } = await NaverLogin.login();
        
        if (successResponse) {
          await this.handleCallback(provider, {
            accessToken: successResponse.accessToken,
          });
        }
      }
    } catch (error) {
      console.error(`${provider} login failed`, error);
      throw error;
    }
  }

  async handleCallback(provider: SocialProvider, params: Record<string, string>): Promise<AuthSession> {
    // 1. FastAPI 백엔드로 전달하여 인증 (토큰 발급)
    const res = await fetch(`${API_URL}/social/${provider}/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...params, platform: this.platform }),
    });
    
    if (!res.ok) {
      throw new Error('Backend Auth Failed');
    }
    
    const data = await res.json();
    
    // 2. 발급받은 Refresh Token을 Keychain에 안전하게 저장
    await Keychain.setGenericPassword('refresh_token', data.refresh_token, { service: 'auth' });
    
    // TODO: Session 정보 구성 및 리턴
    return {
      user: data.user,
      isAuthenticated: true,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
  }

  async getSession(): Promise<AuthSession | null> {
    return null; // TODO: 저장된 토큰 유효성 검증
  }

  async refresh(): Promise<AuthTokens | null> {
    const credentials = await Keychain.getGenericPassword({ service: 'auth' });
    if (!credentials) return null;
    
    // TODO: 백엔드 /refresh 엔드포인트 호출
    return null;
  }

  async logout(): Promise<void> {
    await Keychain.resetGenericPassword({ service: 'auth' });
  }

  async deleteAccount(): Promise<void> {
    try {
      // TODO: access_token 관리가 완성되면 Authorization 헤더 추가
      await fetch(`${API_URL}/me`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      });
    } catch (e) {
      console.warn('Backend delete failed, but proceeding to clear local data', e);
    } finally {
      await this.logout();
    }
  }

  onAuthStateChange(callback: (session: AuthSession | null) => void): () => void {
    return () => {};
  }
}
