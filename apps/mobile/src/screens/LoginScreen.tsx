import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
  Alert,
  Platform,
  StatusBar,
} from 'react-native';
import Svg, { Path, G, Circle, Rect } from 'react-native-svg';
import { authAdapter } from '../context/AuthContext';
import { useAuth } from '../context/AuthContext';
import type { SocialProvider } from '@repo/auth-shared';

// ── 아이콘 SVG 컴포넌트 ───────────────────────────────────────────

const GoogleIcon = () => (
  <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
    <Path d="M22.56 12.25C22.56 11.47 22.49 10.72 22.36 10H12V14.26H17.92C17.67 15.63 16.89 16.79 15.73 17.57V20.34H19.29C21.37 18.42 22.56 15.6 22.56 12.25Z" fill="#4285F4" />
    <Path d="M12 23C14.97 23 17.46 22.02 19.29 20.34L15.73 17.57C14.74 18.23 13.48 18.63 12 18.63C9.14 18.63 6.7 16.7 5.84 14.11H2.17V16.96C3.99 20.57 7.68 23 12 23Z" fill="#34A853" />
    <Path d="M5.84 14.11C5.62 13.45 5.49 12.74 5.49 12C5.49 11.26 5.62 10.55 5.84 9.89V7.04H2.17C1.42 8.52 1 10.21 1 12C1 13.79 1.42 15.48 2.17 16.96L5.84 14.11Z" fill="#FBBC05" />
    <Path d="M12 5.38C13.62 5.38 15.07 5.94 16.22 7.03L19.37 3.88C17.46 2.09 14.97 1 12 1C7.68 1 3.99 3.43 2.17 7.04L5.84 9.89C6.7 7.3 9.14 5.38 12 5.38Z" fill="#EA4335" />
  </Svg>
);

const NaverIcon = () => (
  <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
    <Rect width="24" height="24" rx="4" fill="#03C75A" />
    <Path d="M13.6 12.32L10.16 7H7V17H10.4V11.68L13.84 17H17V7H13.6V12.32Z" fill="white" />
  </Svg>
);

const KakaoIcon = () => (
  <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
    <Rect width="24" height="24" rx="4" fill="#FEE500" />
    <Path
      d="M12 5C8.13 5 5 7.42 5 10.41C5 12.3 6.16 13.97 7.95 14.97L7.18 17.7C7.13 17.88 7.33 18.03 7.49 17.93L10.69 15.76C11.12 15.81 11.56 15.83 12 15.83C15.87 15.83 19 13.41 19 10.41C19 7.42 15.87 5 12 5Z"
      fill="#3C1E1E"
    />
  </Svg>
);

const AppleIcon = () => (
  <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
    <Path
      d="M17.05 20.28C16.07 21.23 15 21.08 13.97 20.63C12.88 20.17 11.88 20.15 10.73 20.63C9.28 21.25 8.52 21.07 7.65 20.28C2.79 15.25 3.51 7.6 9.05 7.31C10.4 7.38 11.35 8.05 12.15 8.1C13.34 7.86 14.48 7.17 15.75 7.26C17.3 7.38 18.46 8 19.22 9.07C16.16 10.84 16.89 15.02 19.7 16.12C19.17 17.54 18.47 18.95 17.05 20.28ZM12.03 7.25C11.88 5.02 13.69 3.18 15.76 3C16.05 5.58 13.43 7.5 12.03 7.25Z"
      fill="currentColor"
    />
  </Svg>
);

// ── LoginScreen ────────────────────────────────────────────────────
export default function LoginScreen() {
  const { loginWithSession } = useAuth();
  const [loadingProvider, setLoadingProvider] = useState<SocialProvider | null>(null);

  const handleSocialLogin = async (provider: SocialProvider) => {
    if (loadingProvider) return;
    setLoadingProvider(provider);
    try {
      console.log(`[LoginScreen] ${provider} 로그인 시작...`);
      const session = await authAdapter.startLoginAndGetSession(provider);
      console.log(`[LoginScreen] ${provider} 세션 획득 성공:`, JSON.stringify(session, null, 2));
      loginWithSession(session);
      console.log(`[LoginScreen] loginWithSession 호출 완료`);
    } catch (err: any) {
      if (err?.message === 'LOGIN_CANCELLED') {
        // 사용자가 직접 취소 — 에러 알림 없음
        console.log(`[LoginScreen] ${provider} 로그인 취소됨`);
        return;
      }
      console.error(`[LoginScreen] ${provider} 로그인 실패:`, err);
      Alert.alert(
        '로그인 실패',
        `${provider} 로그인 중 오류가 발생했습니다.\n잠시 후 다시 시도해주세요.`,
        [{ text: '확인' }],
      );
    } finally {
      setLoadingProvider(null);
    }
  };

  const isAnyLoading = loadingProvider !== null;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1a1a2e" />

      {/* 배경 장식 */}
      <View style={styles.bgCircle1} />
      <View style={styles.bgCircle2} />

      <View style={styles.content}>
        {/* 로고 영역 */}
        <View style={styles.logoArea}>
          <View style={styles.logoIcon}>
            <Svg width={40} height={40} viewBox="0 0 40 40" fill="none">
              <Circle cx="20" cy="20" r="20" fill="#7C6AE8" opacity={0.2} />
              <Path
                d="M20 8C13.37 8 8 13.37 8 20C8 26.63 13.37 32 20 32C26.63 32 32 26.63 32 20C32 13.37 26.63 8 20 8ZM20 28C15.58 28 12 24.42 12 20C12 15.58 15.58 12 20 12C24.42 12 28 15.58 28 20C28 24.42 24.42 28 20 28Z"
                fill="#7C6AE8"
              />
              <Circle cx="20" cy="20" r="4" fill="#A594F9" />
            </Svg>
          </View>
          <Text style={styles.appName}>옾피티</Text>
          <Text style={styles.tagline}>On-Device · Private · Fast</Text>
        </View>

        {/* 설명 텍스트 */}
        <Text style={styles.description}>
          대화 내용은 기기 내에서만 처리됩니다.
        </Text>

        {/* 소셜 로그인 버튼들 */}
        <View style={styles.buttonContainer}>

          {/* 구글 로그인 */}
          <SocialButton
            label="Google로 계속하기"
            icon={<GoogleIcon />}
            backgroundColor="#FFFFFF"
            textColor="#1F1F1F"
            borderColor="#E0E0E0"
            onPress={() => handleSocialLogin('google')}
            loading={loadingProvider === 'google'}
            disabled={isAnyLoading}
          />

          {/* 카카오 로그인 */}
          <SocialButton
            label="카카오로 계속하기"
            icon={<KakaoIcon />}
            backgroundColor="#FEE500"
            textColor="#1A1A1A"
            onPress={() => handleSocialLogin('kakao')}
            loading={loadingProvider === 'kakao'}
            disabled={isAnyLoading}
          />

          {/* 네이버 로그인 */}
          <SocialButton
            label="네이버로 계속하기"
            icon={<NaverIcon />}
            backgroundColor="#03C75A"
            textColor="#FFFFFF"
            onPress={() => handleSocialLogin('naver')}
            loading={loadingProvider === 'naver'}
            disabled={isAnyLoading}
          />

          {/* Apple 로그인 (disabled — iOS 전용, 추후 지원) */}
          <View style={styles.appleWrapper}>
            <SocialButton
              label="Apple로 계속하기"
              icon={<AppleIcon />}
              backgroundColor="#1C1C1E"
              textColor="#FFFFFF"
              onPress={() => {}}
              loading={false}
              disabled={true}
            />
            <View style={styles.comingSoonBadge}>
              <Text style={styles.comingSoonText}>준비 중</Text>
            </View>
          </View>
        </View>

        <Text style={styles.termsText}>
          로그인 정보는 모바일과 웹의 동기화에만 이용됩니다.
        </Text>
      </View>
    </SafeAreaView>
  );
}

// ── SocialButton 컴포넌트 ─────────────────────────────────────────
interface SocialButtonProps {
  label: string;
  icon: React.ReactNode;
  backgroundColor: string;
  textColor: string;
  borderColor?: string;
  onPress: () => void;
  loading: boolean;
  disabled: boolean;
}

function SocialButton({
  label, icon, backgroundColor, textColor, borderColor,
  onPress, loading, disabled,
}: SocialButtonProps) {
  return (
    <TouchableOpacity
      style={[
        styles.socialButton,
        { backgroundColor, borderColor: borderColor ?? 'transparent', borderWidth: borderColor ? 1 : 0 },
        disabled && !loading && styles.socialButtonDisabled,
      ]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.75}
    >
      <View style={styles.socialButtonContent}>
        <View style={styles.iconWrapper}>
          {loading ? (
            <ActivityIndicator size="small" color={textColor} />
          ) : (
            icon
          )}
        </View>
        <Text style={[styles.socialButtonText, { color: textColor }, disabled && !loading && styles.disabledText]}>
          {label}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// ── 스타일 ────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F0E1A',
  },
  bgCircle1: {
    position: 'absolute',
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: '#7C6AE8',
    opacity: 0.07,
    top: -80,
    right: -80,
  },
  bgCircle2: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: '#A594F9',
    opacity: 0.05,
    bottom: 60,
    left: -60,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  logoArea: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logoIcon: {
    marginBottom: 16,
  },
  appName: {
    fontSize: 32,
    fontWeight: '700',
    color: '#EEEEFF',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  tagline: {
    fontSize: 13,
    color: '#7C6AE8',
    fontWeight: '600',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  description: {
    fontSize: 14,
    color: '#8E8EA0',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 40,
  },
  buttonContainer: {
    width: '100%',
    gap: 12,
    marginBottom: 32,
  },
  socialButton: {
    width: '100%',
    paddingVertical: 15,
    paddingHorizontal: 20,
    borderRadius: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  socialButtonDisabled: {
    opacity: 0.4,
  },
  socialButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapper: {
    width: 26,
    height: 26,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  socialButtonText: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  disabledText: {
    opacity: 0.6,
  },
  appleWrapper: {
    position: 'relative',
  },
  comingSoonBadge: {
    position: 'absolute',
    top: -8,
    right: 8,
    backgroundColor: '#4A4A5A',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  comingSoonText: {
    fontSize: 10,
    color: '#A0A0B0',
    fontWeight: '500',
  },
  termsText: {
    fontSize: 11,
    color: '#5A5A70',
    textAlign: 'center',
    lineHeight: 18,
  },
  termsLink: {
    color: '#7C6AE8',
    textDecorationLine: 'underline',
  },
});
