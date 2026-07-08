import type { SocialProvider, AuthSession, AuthTokens, ClientPlatform } from './types';

/**
 * 플랫폼별 인증 어댑터 인터페이스.
 * - 웹: HttpOnly 쿠키 기반 (토큰은 서버 관리)
 * - RN: Secure Storage + Bearer 토큰 기반
 */
export interface AuthAdapter {
  readonly platform: ClientPlatform;

  /** 소셜 로그인 시작 (authorize URL로 이동) */
  startLogin(provider: SocialProvider): Promise<void>;

  /** callback에서 받은 code를 백엔드로 전달, 세션 확립 */
  handleCallback(provider: SocialProvider, params: Record<string, string>): Promise<AuthSession>;

  /** 현재 인증 상태 확인 */
  getSession(): Promise<AuthSession | null>;

  /** 토큰 갱신 */
  refresh(): Promise<AuthTokens | null>;

  /** 로그아웃 */
  logout(): Promise<void>;

  /** 계정 탈퇴(삭제) */
  deleteAccount(): Promise<void>;

  /** 인증 상태 변경 구독 */
  onAuthStateChange(callback: (session: AuthSession | null) => void): () => void;
}
