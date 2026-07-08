export type SocialProvider = 'apple' | 'google' | 'naver' | 'kakao';
export type ClientPlatform = 'web' | 'ios' | 'android';

export interface AuthUser {
  id: string;
  email: string | null;
  displayName: string | null;
  profileImageUrl: string | null;
  linkedProviders: SocialProvider[];
}

export interface AuthSession {
  user: AuthUser;
  isAuthenticated: boolean;
  expiresAt: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
}
