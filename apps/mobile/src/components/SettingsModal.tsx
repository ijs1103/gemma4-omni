import React, { useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  Modal, 
  TouchableOpacity, 
  Switch, 
  SafeAreaView,
  Dimensions,
  Platform
} from 'react-native';
import Animated, { 
  useSharedValue, 
  useAnimatedStyle, 
  withTiming, 
  runOnJS 
} from 'react-native-reanimated';
import { X, LogOut, Moon } from 'lucide-react-native';
import { useThemeContext } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { MobileAuthAdapter } from '../adapters/MobileAuthAdapter';
import { useTheme, useNavigation } from '@react-navigation/native';

const { width } = Dimensions.get('window');

interface SettingsModalProps {
  visible: boolean;
  onClose: () => void;
  user: {
    name: string;
    email: string;
    initial: string;
  };
}

export default function SettingsModal({ visible, onClose, user }: SettingsModalProps) {
  const { isDarkMode, setDarkMode } = useThemeContext();
  const { colors } = useTheme();
  const navigation = useNavigation<any>();
  
  // Reanimated 공유 값: 초기 위치는 화면 우측 바깥(width)
  const translateX = useSharedValue(width);

  // 모달 활성화 여부에 따른 슬라이드 인/아웃 애니메이션 제어
  useEffect(() => {
    if (visible) {
      // 우측에서 좌측으로 부드럽게 슬라이드 인 (translateX: width -> 0)
      translateX.value = withTiming(0, { duration: 300 });
    } else {
      // 비활성화 시 화면 우측 바깥으로 리셋 (translateX: 0 -> width)
      translateX.value = width;
    }
  }, [visible, translateX]);

  // 애니메이션 종료 후 안전하게 부모의 onClose를 호출하는 핸들러
  const handleClose = () => {
    // 먼저 우측으로 슬라이드 아웃 애니메이션 실행
    translateX.value = withTiming(width, { duration: 300 }, (finished) => {
      if (finished) {
        // UI 스레드와 JS 스레드 간 동기화를 위해 runOnJS 호출
        runOnJS(onClose)();
      }
    });
  };

  const { logout } = useAuth();

  const handleLogout = async () => {
    try {
      const authAdapter = new MobileAuthAdapter();
      await authAdapter.logout();
    } catch (e) {
      console.warn('Logout failed to clear tokens', e);
    } finally {
      logout();
      handleClose();
    }
  };

  const handleAccountSettings = () => {
    handleClose();
    setTimeout(() => {
      navigation.navigate('AccountSettings');
    }, 150);
  };

  // Reanimated 4.4.1 적용: translateX 값을 변환하는 애니메이션 스타일 정의
  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateX: translateX.value }],
    };
  });

  return (
    <Modal
      visible={visible}
      animationType="none" // 기본 슬라이드(translateY) 방식을 끄고 커스텀 translateX 제어
      transparent={true}
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        {/* 어두운 회색조의 투명 오버레이 뒷배경 */}
        <TouchableOpacity 
          style={styles.backdrop} 
          activeOpacity={1} 
          onPress={handleClose} 
        />
        
        {/* 전체 화면 폭(100%)과 높이(100%)를 차지하는 설정 패널 */}
        <Animated.View style={[styles.panelContainer, animatedStyle, { backgroundColor: colors.background }]}>
          <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
            <View style={[styles.header, { justifyContent: 'flex-end' }]}>
              <TouchableOpacity onPress={handleClose} style={{ padding: 4 }}>
                <X color={colors.text} size={24} />
              </TouchableOpacity>
            </View>
            
            <View style={styles.profileSection}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{user.initial}</Text>
              </View>
              <Text style={[styles.greetingText, { color: colors.text }]}>{user.name}님, 안녕하세요.</Text>
              <TouchableOpacity style={styles.manageAccountBtn} onPress={handleAccountSettings}>
                <Text style={styles.manageAccountText}>계정관리</Text>
              </TouchableOpacity>
            </View>

            <View style={[styles.menuContainer, { backgroundColor: colors.card }]}>
              <View style={styles.menuItem}>
                <View style={styles.menuItemLeft}>
                  <Moon color={colors.text} size={24} />
                  <Text style={[styles.menuItemText, { color: colors.text }]}>다크 모드</Text>
                </View>
                <Switch
                  value={isDarkMode}
                  onValueChange={setDarkMode}
                  trackColor={{ false: '#e0e0e0', true: '#a8c7fa' }}
                  thumbColor={isDarkMode ? '#0b57d0' : '#ffffff'}
                />
              </View>
              
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              
              <TouchableOpacity style={styles.menuItem} onPress={handleLogout}>
                <View style={styles.menuItemLeft}>
                  <LogOut color="#d93025" size={24} />
                  <Text style={[styles.menuItemText, { color: '#d93025' }]}>로그아웃</Text>
                </View>
              </TouchableOpacity>
            </View>
            
            {/* 남는 모든 여백 공간을 하단에 공백으로 배치하기 위한 스페이서 */}
            <View style={styles.spacer} />
          </SafeAreaView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  panelContainer: {
    width: '100%',
    height: '100%',
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: -2, height: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 10,
  },
  safeArea: {
    flex: 1,
    paddingTop: Platform.OS === 'ios' ? 0 : 24,
    paddingHorizontal: 20,
    backgroundColor: '#ffffff',
    justifyContent: 'flex-start', // 메뉴들을 상단에 배치
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    position: 'relative',
    marginTop: Platform.OS === 'ios' ? 0 : 8,
  },
  emailText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#202124',
  },
  closeButton: {
    position: 'absolute',
    right: 0,
    padding: 4,
  },
  profileSection: {
    alignItems: 'center',
    marginBottom: 32,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#9ca3af',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 2,
    borderColor: '#e5e7eb',
  },
  avatarText: {
    fontSize: 32,
    color: '#ffffff',
    fontWeight: '600',
  },
  greetingText: {
    fontSize: 22,
    color: '#202124',
    marginBottom: 16,
  },
  manageAccountBtn: {
    borderWidth: 1,
    borderColor: '#dadce0',
    borderRadius: 100,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  manageAccountText: {
    color: '#0b57d0',
    fontWeight: '500',
    fontSize: 14,
  },
  menuContainer: {
    backgroundColor: '#f8f9fa',
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 20,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  menuItemText: {
    fontSize: 16,
    marginLeft: 16,
    color: '#3c4043',
    fontWeight: '500',
  },
  divider: {
    height: 1,
    backgroundColor: '#e8eaed',
    marginLeft: 60,
  },
  spacer: {
    flex: 1, // 남는 하단 공간을 모두 빈 공백으로 유지
  },
});
