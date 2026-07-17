import React, { useState } from 'react';
import type { SocialProvider } from '@repo/auth-shared';
import './SocialLogin.css';

interface SocialLoginProps {
  onClose: () => void;
  onLoginProvider: (provider: SocialProvider) => Promise<void>;
}

/**
 * 소셜 로그인 화면 컴포넌트
 *
 * 각 버튼의 onClick에 실제 OAuth 인증 로직이 연결됩니다.
 * 부모(App.tsx)의 onLoginProvider가 WebAuthAdapter.startLogin(provider)를 호출하여
 * 팝업 기반 OAuth 플로우를 실행합니다.
 */
export const SocialLogin: React.FC<SocialLoginProps> = ({ onClose, onLoginProvider }) => {
  const [loadingProvider, setLoadingProvider] = useState<SocialProvider | null>(null);

  const handleSocialLogin = async (provider: SocialProvider) => {
    if (loadingProvider) return; // 중복 클릭 방지
    setLoadingProvider(provider);
    try {
      await onLoginProvider(provider);
    } catch (error) {
      console.error(`[SocialLogin] ${provider} 로그인 에러:`, error);
      // TODO: 사용자에게 에러 토스트 표시
    } finally {
      setLoadingProvider(null);
    }
  };

  return (
    <div className="social-login-container">
      {/* 2. 상단 네비게이션 영역 */}
      <div className="social-login-header">
        <button className="close-btn" onClick={onClose} aria-label="닫기" disabled={!!loadingProvider}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>

      {/* 3. 중앙 소셜 로그인 섹션 */}
      <div className="social-login-main">
        <div className="social-login-content">
          <h1 className="social-login-title">환영합니다</h1>
          <p className="social-login-subtitle">로그인하고 더 많은 AI 기능을 이용해보세요.</p>

          <div className="social-buttons-wrapper">
            {/* 구글 로그인 버튼 */}
            <button
              className="btn-social btn-google"
              onClick={() => handleSocialLogin('google')}
              disabled={!!loadingProvider}
            >
              <div className="btn-icon">
                {loadingProvider === 'google' ? (
                  <div className="btn-spinner" />
                ) : (
                  <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                )}
              </div>
              <span className="btn-text">
                {loadingProvider === 'google' ? '로그인 중...' : 'Google 계정으로 로그인'}
              </span>
            </button>

            {/* 카카오 로그인 버튼 */}
            <button
              className="btn-social btn-kakao"
              onClick={() => handleSocialLogin('kakao')}
              disabled={!!loadingProvider}
            >
              <div className="btn-icon">
                {loadingProvider === 'kakao' ? (
                  <div className="btn-spinner btn-spinner-dark" />
                ) : (
                  <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 3c-5.52 0-10 3.58-10 8 0 2.86 1.83 5.37 4.54 6.75-.43 1.57-1.4 5.3-1.43 5.46-.03.18.06.35.21.43.15.08.33.05.45-.07.05-.05 4.31-3.64 6.17-5.18.35.03.71.05 1.06.05 5.52 0 10-3.58 10-8s-4.48-8-10-8z" fill="#000000"/>
                  </svg>
                )}
              </div>
              <span className="btn-text">
                {loadingProvider === 'kakao' ? '로그인 중...' : '카카오 로그인'}
              </span>
            </button>

            {/* 네이버 로그인 버튼 */}
            <button
              className="btn-social btn-naver"
              onClick={() => handleSocialLogin('naver')}
              disabled={!!loadingProvider}
            >
              <div className="btn-icon">
                {loadingProvider === 'naver' ? (
                  <div className="btn-spinner" />
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M16.27 3H21v18h-4.73l-6.8-9.45V21H4.73V3h4.73l6.81 9.46V3z" fill="#ffffff"/>
                  </svg>
                )}
              </div>
              <span className="btn-text">
                {loadingProvider === 'naver' ? '로그인 중...' : '네이버 로그인'}
              </span>
            </button>

            {/* 애플 로그인 버튼 */}
            <button
              className="btn-social btn-apple"
              onClick={() => handleSocialLogin('apple')}
              disabled={true}
            >
              <div className="btn-icon">
                {loadingProvider === 'apple' ? (
                  <div className="btn-spinner" />
                ) : (
                  <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M16.14 10.98c-.02-3.23 2.65-4.78 2.77-4.86-1.5-2.2-3.83-2.5-4.66-2.54-1.98-.2-3.86 1.17-4.88 1.17-1.02 0-2.56-1.14-4.22-1.1-2.14.04-4.12 1.25-5.23 3.16-2.24 3.88-.57 9.61 1.62 12.78 1.07 1.55 2.33 3.28 4.02 3.22 1.63-.06 2.26-1.06 4.24-1.06 1.96 0 2.63 1.06 4.3 1.03 1.7-.03 2.78-1.58 3.83-3.13 1.22-1.78 1.73-3.5 1.76-3.59-.04-.02-3.36-1.28-3.55-5.08zm-3.15-7.46c.88-1.07 1.48-2.56 1.32-4.04-1.28.05-2.84.85-3.75 1.94-.8.97-1.51 2.5-1.31 3.96 1.43.11 2.85-.79 3.74-1.86z" fill="currentColor"/>
                  </svg>
                )}
              </div>
              <span className="btn-text">
                {loadingProvider === 'apple' ? '로그인 중...' : 'Apple로 로그인'}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* 4. 하단 푸터 영역 (회사 정보 삭제됨) */}
      <div className="social-login-footer">
        <div className="app-store-badges">
          {/* Google Play Store */}
          <div className="store-badge">
             <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
             <div className="store-badge-text">
               <span className="small">GET IT ON</span>
               <span className="large">Google Play</span>
             </div>
          </div>
          {/* Apple App Store */}
          <div className="store-badge">
            <svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="currentColor">
              <path d="M16.14 10.98c-.02-3.23 2.65-4.78 2.77-4.86-1.5-2.2-3.83-2.5-4.66-2.54-1.98-.2-3.86 1.17-4.88 1.17-1.02 0-2.56-1.14-4.22-1.1-2.14.04-4.12 1.25-5.23 3.16-2.24 3.88-.57 9.61 1.62 12.78 1.07 1.55 2.33 3.28 4.02 3.22 1.63-.06 2.26-1.06 4.24-1.06 1.96 0 2.63 1.06 4.3 1.03 1.7-.03 2.78-1.58 3.83-3.13 1.22-1.78 1.73-3.5 1.76-3.59-.04-.02-3.36-1.28-3.55-5.08zm-3.15-7.46c.88-1.07 1.48-2.56 1.32-4.04-1.28.05-2.84.85-3.75 1.94-.8.97-1.51 2.5-1.31 3.96 1.43.11 2.85-.79 3.74-1.86z"/>
            </svg>
            <div className="store-badge-text">
               <span className="small">Download on the</span>
               <span className="large">App Store</span>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
};
