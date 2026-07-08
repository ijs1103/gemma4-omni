import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView } from 'react-native';

interface LoginScreenProps {
  onLogin: () => void;
}

export default function LoginScreen({ onLogin }: LoginScreenProps) {
  // 실제 로그인 처리는 MobileAuthAdapter와 연동할 예정
  const handleAppleLogin = () => {
    console.log('Apple Login clicked');
    onLogin();
  };

  const handleKakaoLogin = () => {
    console.log('Kakao Login clicked');
    onLogin();
  };

  const handleNaverLogin = () => {
    console.log('Naver Login clicked');
    onLogin();
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>로컬 우선 멀티플랫폼 AI 채팅</Text>
        <Text style={styles.subtitle}>대화 내용은 디바이스 내부에만 저장됩니다.</Text>
        
        <View style={styles.buttonContainer}>
          <TouchableOpacity style={[styles.button, styles.appleButton]} onPress={handleAppleLogin}>
            <Text style={styles.appleButtonText}>Apple로 로그인</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={[styles.button, styles.kakaoButton]} onPress={handleKakaoLogin}>
            <Text style={styles.kakaoButtonText}>카카오 로그인</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={[styles.button, styles.naverButton]} onPress={handleNaverLogin}>
            <Text style={styles.naverButtonText}>네이버 로그인</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#e0e0ff',
    marginBottom: 10,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#8e9eab',
    marginBottom: 50,
    textAlign: 'center',
  },
  buttonContainer: {
    width: '100%',
    gap: 15,
  },
  button: {
    width: '100%',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appleButton: {
    backgroundColor: '#FFFFFF',
  },
  appleButtonText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '600',
  },
  kakaoButton: {
    backgroundColor: '#FEE500',
  },
  kakaoButtonText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '600',
  },
  naverButton: {
    backgroundColor: '#03C75A',
  },
  naverButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
