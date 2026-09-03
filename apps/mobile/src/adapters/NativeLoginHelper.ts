/**
 * NativeLoginHelper.ts
 *
 * 카카오/네이버 네이티브 SDK 호출 로직을 캡슐화합니다.
 * MobileAuthAdapter에서 사용합니다.
 */
import { login as kakaoLogin, getProfile as kakaoGetProfile } from '@react-native-seoul/kakao-login';
import NaverLogin from '@react-native-seoul/naver-login';

// ── 네이버 SDK 초기화 상태 ─────────────────────────────────────
let naverInitialized = false;

const NAVER_CONFIG = {
  consumerKey: 'WItE71ekHG37ubrbDEbY',
  consumerSecret: '5AXyPPNYCM',
  appName: 'Gemma AI',
  serviceUrlSchemeIOS: 'com.mobile',
  disableNaverAppAuthIOS: true,
};

function ensureNaverInitialized(): void {
  // iOS 시뮬레이터 및 앱 미설치 환경 대응을 위해 항상 disableNaverAppAuthIOS=true로 초기화
  NaverLogin.initialize(NAVER_CONFIG);
  naverInitialized = true;
  console.log('[NativeLoginHelper] NaverLogin 초기화 완료 (iOS disableNaverAppAuthIOS: true 설정됨)');
}

// ── 카카오 네이티브 로그인 ────────────────────────────────────────

export interface NativeLoginResult {
  accessToken: string;
  provider: 'kakao' | 'naver';
}

/**
 * 카카오 네이티브 SDK를 사용하여 로그인합니다.
 * 카카오톡 앱이 설치되어 있으면 앱 로그인, 없으면 웹 로그인을 사용합니다.
 *
 * @returns accessToken이 포함된 NativeLoginResult
 * @throws Error 사용자 취소 또는 SDK 오류 시
 */
export async function kakaoNativeLogin(): Promise<NativeLoginResult> {
  console.log('[NativeLoginHelper] 카카오 네이티브 로그인 시작');

  try {
    const token = await kakaoLogin();
    console.log('[NativeLoginHelper] 카카오 로그인 성공, accessToken 획득');

    if (!token.accessToken) {
      throw new Error('[NativeLogin] 카카오 로그인 성공했으나 accessToken이 없습니다.');
    }

    return {
      accessToken: token.accessToken,
      provider: 'kakao',
    };
  } catch (err: any) {
    // 사용자 취소 감지 (카카오 SDK 에러 메시지 기반)
    const msg = err?.message?.toLowerCase() ?? '';
    if (
      msg.includes('cancel') ||
      msg.includes('취소') ||
      msg.includes('user cancelled')
    ) {
      throw new Error('LOGIN_CANCELLED');
    }
    throw err;
  }
}

// ── 네이버 네이티브 로그인 ────────────────────────────────────────

/**
 * 네이버 네이티브 SDK를 사용하여 로그인합니다.
 * 네이버 앱이 설치되어 있으면 앱 로그인, 없으면 웹 로그인을 사용합니다.
 *
 * @returns accessToken이 포함된 NativeLoginResult
 * @throws Error 사용자 취소 또는 SDK 오류 시
 */
export async function naverNativeLogin(): Promise<NativeLoginResult> {
  console.log('[NativeLoginHelper] 네이버 네이티브 로그인 시작');

  // 초기화 보장
  ensureNaverInitialized();

  const { failureResponse, successResponse } = await NaverLogin.login();

  if (failureResponse) {
    console.error('[NativeLoginHelper] 네이버 로그인 실패:', failureResponse.message);
    if (failureResponse.isCancel) {
      throw new Error('LOGIN_CANCELLED');
    }
    throw new Error(`[NativeLogin] 네이버 로그인 실패: ${failureResponse.message}`);
  }

  if (!successResponse || !successResponse.accessToken) {
    throw new Error('[NativeLogin] 네이버 로그인 성공했으나 accessToken이 없습니다.');
  }

  console.log('[NativeLoginHelper] 네이버 로그인 성공, accessToken 획득');

  return {
    accessToken: successResponse.accessToken,
    provider: 'naver',
  };
}
