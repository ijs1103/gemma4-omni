import React, { useState } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  SafeAreaView, 
  Dimensions,
  Alert,
  ActivityIndicator
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Svg, { Path } from 'react-native-svg';
import { MobileAuthAdapter } from '../adapters/MobileAuthAdapter';
import { useChat } from '../context/ChatContext';
import { useAuth } from '../context/AuthContext';

const { width } = Dimensions.get('window');

// 얇은 선 모양의 X 아이콘 (Linear 'X' icon)
const CloseIcon = ({ color }: { color: string }) => (
  <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
    <Path
      d="M18 6L6 18M6 6l12 12"
      stroke={color}
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export default function DeleteAccountScreen() {
  const navigation = useNavigation<any>();

  // 실제 연동 시 전역 상태나 Auth Context에서 이메일을 가져올 수 있습니다.
  const userEmail = 'ajapag@gmail.com';
  const { clearAllSessions } = useChat();
  const { logout } = useAuth();
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    try {
      setIsDeleting(true);
      
      const authAdapter = new MobileAuthAdapter();
      
      // 1. 백엔드에서 계정 삭제 (API 연동 및 로컬 토큰 제거)
      await authAdapter.deleteAccount();
      
      // 2. 기기 로컬 DB(채팅 내역 및 세션 정보) 완벽히 초기화
      await clearAllSessions();

      Alert.alert(
        '계정 삭제 완료',
        '그동안 이용해 주셔서 감사합니다.',
        [{ 
          text: '확인', 
          onPress: () => {
            // 강제 내비게이션 대신 글로벌 Auth 상태 변경을 통해 마운트 해제
            logout();
          }
        }]
      );
    } catch (e) {
      console.error('Delete account failed', e);
      Alert.alert('오류', '계정 삭제 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCancel = () => {
    navigation.goBack();
  };

  return (
    <SafeAreaView style={styles.overlay}>
      {/* 
        배경 흐림 효과를 위한 반투명 오버레이 
        (클릭 시 모달이 닫히도록 설정하려면 onPress에 handleCancel 추가 가능하지만,
         위험 액션이므로 명시적으로 버튼을 누르도록 터치 무시)
      */}
      <View style={styles.backdrop} />

      <View style={styles.modalContainer}>
        
        {/* Header: Top-left text, Top-right close icon */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>계정 삭제</Text>
          <TouchableOpacity 
            onPress={handleCancel}
            style={styles.closeButton}
            activeOpacity={0.7}
          >
            <CloseIcon color="#F5F5F5" />
          </TouchableOpacity>
        </View>

        {/* Body Text: Centrally aligned standoff white text */}
        <View style={styles.bodyContainer}>
          <Text style={styles.bodyText}>
            현재 옾피티 계정 [{userEmail}]을 삭제하려고 합니다.
          </Text>
          <Text style={[styles.bodyText, styles.bodyTextSecondLine]}>
            계정을 삭제하면 복구할 수 없습니다.
          </Text>
        </View>

        {/* Buttons: Direct transition from body text to buttons */}
        <View style={styles.buttonContainer}>
          
          {/* Primary Action Button (Red) */}
          <TouchableOpacity 
            style={[styles.deleteButton, isDeleting && styles.disabledButton]} 
            activeOpacity={0.8}
            onPress={handleDelete}
            disabled={isDeleting}
          >
            {isDeleting ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.deleteButtonText}>내 계정 삭제</Text>
            )}
          </TouchableOpacity>

          {/* Secondary Action Button (White background) */}
          <TouchableOpacity 
            style={[styles.cancelButton, isDeleting && styles.disabledButton]} 
            activeOpacity={0.8}
            onPress={handleCancel}
            disabled={isDeleting}
          >
            <Text style={styles.cancelButtonText}>아니오, 유지할게요</Text>
          </TouchableOpacity>

        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.75)', // Blurred background simulation
  },
  modalContainer: {
    width: width * 0.85,
    backgroundColor: '#1E1E1E', // Dark gray/black gradient simulation
    borderRadius: 24,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 24,
    borderWidth: 1,
    borderColor: '#333333',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#F5F5F5', // Standoff white text
  },
  closeButton: {
    padding: 4,
    marginRight: -4,
  },
  bodyContainer: {
    marginBottom: 32,
    alignItems: 'center',
  },
  bodyText: {
    fontSize: 16,
    color: '#E0E0E0',
    textAlign: 'center',
    lineHeight: 24,
  },
  bodyTextSecondLine: {
    marginTop: 12,
    fontWeight: '500',
    color: '#F5F5F5',
  },
  buttonContainer: {
    gap: 12, // 간격 조절
  },
  deleteButton: {
    backgroundColor: '#FF3B30', // Powerful red accent
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    // Subtle depth/shadow
    shadowColor: '#FF3B30',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  deleteButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  cancelButton: {
    backgroundColor: '#FFFFFF', // Standoff white background
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#FFFFFF', // Standoff white border
  },
  cancelButtonText: {
    color: '#121212', // Contrasting text for visibility on white background
    fontSize: 16,
    fontWeight: 'bold',
  },
  disabledButton: {
    opacity: 0.6,
  },
});
