import React, { useState } from 'react';
import type { SocialProvider } from '@repo/auth-shared';
import './SocialLogin.css';

interface SocialLoginProps {
  onClose: () => void;
  onLoginProvider: (provider: SocialProvider) => Promise<void>;
}

// ── 아이콘 SVG 컴포넌트 ───────────────────────────────────────────

const GoogleIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M22.56 12.25C22.56 11.47 22.49 10.72 22.36 10H12V14.26H17.92C17.67 15.63 16.89 16.79 15.73 17.57V20.34H19.29C21.37 18.42 22.56 15.6 22.56 12.25Z" fill="#4285F4" />
    <path d="M12 23C14.97 23 17.46 22.02 19.29 20.34L15.73 17.57C14.74 18.23 13.48 18.63 12 18.63C9.14 18.63 6.7 16.7 5.84 14.11H2.17V16.96C3.99 20.57 7.68 23 12 23Z" fill="#34A853" />
    <path d="M5.84 14.11C5.62 13.45 5.49 12.74 5.49 12C5.49 11.26 5.62 10.55 5.84 9.89V7.04H2.17C1.42 8.52 1 10.21 1 12C1 13.79 1.42 15.48 2.17 16.96L5.84 14.11Z" fill="#FBBC05" />
    <path d="M12 5.38C13.62 5.38 15.07 5.94 16.22 7.03L19.37 3.88C17.46 2.09 14.97 1 12 1C7.68 1 3.99 3.43 2.17 7.04L5.84 9.89C6.7 7.3 9.14 5.38 12 5.38Z" fill="#EA4335" />
  </svg>
);

const NaverIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="24" height="24" rx="4" fill="#03C75A" />
    <path d="M13.6 12.32L10.16 7H7V17H10.4V11.68L13.84 17H17V7H13.6V12.32Z" fill="white" />
  </svg>
);

const KakaoIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="24" height="24" rx="4" fill="#FEE500" />
    <path
      d="M12 5C8.13 5 5 7.42 5 10.41C5 12.3 6.16 13.97 7.95 14.97L7.18 17.7C7.13 17.88 7.33 18.03 7.49 17.93L10.69 15.76C11.12 15.81 11.56 15.83 12 15.83C15.87 15.83 19 13.41 19 10.41C19 7.42 15.87 5 12 5Z"
      fill="#3C1E1E"
    />
  </svg>
);

const AppleIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M17.05 20.28C16.07 21.23 15 21.08 13.97 20.63C12.88 20.17 11.88 20.15 10.73 20.63C9.28 21.25 8.52 21.07 7.65 20.28C2.79 15.25 3.51 7.6 9.05 7.31C10.4 7.38 11.35 8.05 12.15 8.1C13.34 7.86 14.48 7.17 15.75 7.26C17.3 7.38 18.46 8 19.22 9.07C16.16 10.84 16.89 15.02 19.7 16.12C19.17 17.54 18.47 18.95 17.05 20.28ZM12.03 7.25C11.88 5.02 13.69 3.18 15.76 3C16.05 5.58 13.43 7.5 12.03 7.25Z"
      fill="currentColor"
    />
  </svg>
);

export const SocialLogin: React.FC<SocialLoginProps> = ({ onClose, onLoginProvider }) => {
  const [loadingProvider, setLoadingProvider] = useState<SocialProvider | null>(null);

  const handleSocialLogin = async (provider: SocialProvider) => {
    if (loadingProvider) return;
    setLoadingProvider(provider);
    try {
      await onLoginProvider(provider);
    } catch (error) {
      console.error(`[SocialLogin] ${provider} 로그인 에러:`, error);
    } finally {
      setLoadingProvider(null);
    }
  };

  const isAnyLoading = loadingProvider !== null;

  return (
    <div className="social-login-container">
      {/* 배경 써클 장식 */}
      <div className="bg-circle-1" />
      <div className="bg-circle-2" />

      {/* 닫기 버튼 */}
      <div className="social-login-header">
        <button className="close-btn" onClick={onClose} aria-label="닫기" disabled={isAnyLoading}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* 중앙 메인 콘텐츠 */}
      <div className="social-login-main">
        <div className="social-login-content">
          {/* 로고 브랜드 영역 */}
          <div className="logo-area">
            <div className="logo-icon">
              <svg width="44" height="44" viewBox="0 0 40 40" fill="none">
                <circle cx="20" cy="20" r="20" fill="#7C6AE8" opacity="0.2" />
                <path
                  d="M20 8C13.37 8 8 13.37 8 20C8 26.63 13.37 32 20 32C26.63 32 32 26.63 32 20C32 13.37 26.63 8 20 8ZM20 28C15.58 28 12 24.42 12 20C12 15.58 15.58 12 20 12C24.42 12 28 15.58 28 20C28 24.42 24.42 28 20 28Z"
                  fill="#7C6AE8"
                />
                <circle cx="20" cy="20" r="4" fill="#A594F9" />
              </svg>
            </div>
            <h1 className="app-name">옾피티</h1>
            <p className="tagline">ON-DEVICE · PRIVATE · FAST</p>
          </div>

          {/* 설명 텍스트 */}
          <p className="description">
            대화 내용은 기기 내에서만 처리됩니다.
          </p>

          {/* 소셜 로그인 버튼 영역 */}
          <div className="social-buttons-wrapper">
            {/* Google */}
            <button
              className="btn-social btn-google"
              onClick={() => handleSocialLogin('google')}
              disabled={isAnyLoading}
            >
              <div className="btn-icon">
                {loadingProvider === 'google' ? <div className="btn-spinner btn-spinner-dark" /> : <GoogleIcon />}
              </div>
              <span className="btn-text">Google로 계속하기</span>
            </button>

            {/* Kakao */}
            <button
              className="btn-social btn-kakao"
              onClick={() => handleSocialLogin('kakao')}
              disabled={isAnyLoading}
            >
              <div className="btn-icon">
                {loadingProvider === 'kakao' ? <div className="btn-spinner btn-spinner-dark" /> : <KakaoIcon />}
              </div>
              <span className="btn-text">카카오로 계속하기</span>
            </button>

            {/* Naver */}
            <button
              className="btn-social btn-naver"
              onClick={() => handleSocialLogin('naver')}
              disabled={isAnyLoading}
            >
              <div className="btn-icon">
                {loadingProvider === 'naver' ? <div className="btn-spinner" /> : <NaverIcon />}
              </div>
              <span className="btn-text">네이버로 계속하기</span>
            </button>

            {/* Apple (준비 중) */}
            <div className="apple-wrapper">
              <button
                className="btn-social btn-apple"
                disabled={true}
              >
                <div className="btn-icon">
                  <AppleIcon />
                </div>
                <span className="btn-text">Apple로 계속하기</span>
              </button>
              <div className="coming-soon-badge">준비 중</div>
            </div>
          </div>

          <p className="terms-text">
            로그인 정보는 모바일과 웹의 동기화에만 이용됩니다.
          </p>
        </div>
      </div>

      {/* 하단 스토어 배지 푸터 영역 */}
      <div className="social-login-footer">
        <div className="app-store-badges">
          {/* Google Play Store */}
          <div className="store-badge">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M3.608 1.814A1.666 1.666 0 0 0 3 3.148v17.704c0 .548.218 1.025.608 1.334l.068.062L13.882 12.04v-.08L3.676 1.752l-.068.062z" fill="#00E676" />
              <path d="M17.288 15.446l-3.406-3.406v-.08l3.406-3.406.077.044 4.037 2.294c1.152.654 1.152 1.724 0 2.378l-4.037 2.294-.077.044z" fill="#FFEB3B" />
              <path d="M13.882 11.96L3.608 21.72c.382.404.978.473 1.517.167l12.163-6.911-3.406-3.016z" fill="#FF3D00" />
              <path d="M13.882 12.04l3.406-3.016L5.125 2.113C4.586 1.807 3.99 1.876 3.608 2.28L13.882 12.04z" fill="#0288D1" />
            </svg>
            <div className="store-badge-text">
              <span className="small">GET IT ON</span>
              <span className="large">Google Play</span>
            </div>
          </div>
          {/* Apple App Store */}
          <div className="store-badge">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.05 20.28C16.07 21.23 15 21.08 13.97 20.63C12.88 20.17 11.88 20.15 10.73 20.63C9.28 21.25 8.52 21.07 7.65 20.28C2.79 15.25 3.51 7.6 9.05 7.31C10.4 7.38 11.35 8.05 12.15 8.1C13.34 7.86 14.48 7.17 15.75 7.26C17.3 7.38 18.46 8 19.22 9.07C16.16 10.84 16.89 15.02 19.7 16.12C19.17 17.54 18.47 18.95 17.05 20.28ZM12.03 7.25C11.88 5.02 13.69 3.18 15.76 3C16.05 5.58 13.43 7.5 12.03 7.25Z" />
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
