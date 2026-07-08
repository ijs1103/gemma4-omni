import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, Platform, StatusBar } from 'react-native';
import { useNavigation, useTheme } from '@react-navigation/native';
import Svg, { Path } from 'react-native-svg';

export const BackIcon = ({ color }: { color: string }) => (
  <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
    <Path
      d="M15 18L9 12L15 6"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const MailIcon = ({ color }: { color: string }) => (
  <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
    <Path
      d="M4 7.00005L10.2 11.65C11.2667 12.45 12.7333 12.45 13.8 11.65L20 7"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <Path
      d="M3 7C3 5.89543 3.89543 5 5 5H19C20.1046 5 21 5.89543 21 7V17C21 18.1046 20.1046 19 19 19H5C3.89543 19 3 18.1046 3 17V7Z"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
    />
  </Svg>
);

export const GoogleIcon = () => (
  <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
    <Path
      d="M22.56 12.25C22.56 11.47 22.49 10.72 22.36 10H12V14.26H17.92C17.67 15.63 16.89 16.79 15.73 17.57V20.34H19.29C21.37 18.42 22.56 15.6 22.56 12.25Z"
      fill="#4285F4"
    />
    <Path
      d="M12 23C14.97 23 17.46 22.02 19.29 20.34L15.73 17.57C14.74 18.23 13.48 18.63 12 18.63C9.14 18.63 6.7 16.7 5.84 14.11H2.17V16.96C3.99 20.57 7.68 23 12 23Z"
      fill="#34A853"
    />
    <Path
      d="M5.84 14.11C5.62 13.45 5.49 12.74 5.49 12C5.49 11.26 5.62 10.55 5.84 9.89V7.04H2.17C1.42 8.52 1 10.21 1 12C1 13.79 1.42 15.48 2.17 16.96L5.84 14.11Z"
      fill="#FBBC05"
    />
    <Path
      d="M12 5.38C13.62 5.38 15.07 5.94 16.22 7.03L19.37 3.88C17.46 2.09 14.97 1 12 1C7.68 1 3.99 3.43 2.17 7.04L5.84 9.89C6.7 7.3 9.14 5.38 12 5.38Z"
      fill="#EA4335"
    />
  </Svg>
);

export default function AccountSettingsScreen() {
  const navigation = useNavigation<any>();
  const { colors, dark } = useTheme();

  // 요구사항: 전체 배경은 매우 옅은 회색, 카드는 흰색
  // 다크모드 대응을 위해 colors.background와 colors.card 활용
  const bgColor = dark ? colors.background : '#F5F6F8';
  const cardColor = dark ? colors.card : '#FFFFFF';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: bgColor }]}>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.backButton} 
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
        >
          <BackIcon color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>계정 설정</Text>
        <View style={styles.backButtonPlaceholder} />
      </View>

      {/* Profile Section */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>프로필</Text>
        <View style={[styles.card, { backgroundColor: cardColor }]}>
          
          {/* Row 1: 이메일 */}
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <MailIcon color={colors.text} />
              <Text style={[styles.rowText, { color: colors.text }]}>이메일</Text>
            </View>
            <Text style={styles.rowRightText}>aj***g@gmail.com</Text>
          </View>

          <View style={[styles.divider, { backgroundColor: dark ? '#333' : '#F0F0F0' }]} />

          {/* Row 2: 소셜 로그인 */}
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <GoogleIcon />
              <Text style={[styles.rowText, { color: colors.text }]}>Google</Text>
            </View>
            <Text style={styles.rowRightText}>연결됨</Text>
          </View>

        </View>
      </View>

      {/* Delete Account Section */}
      <View style={styles.section}>
        <TouchableOpacity 
          style={[styles.card, { backgroundColor: cardColor }]}
          activeOpacity={0.7}
          onPress={() => navigation.navigate('DeleteAccount')}
        >
          <Text style={styles.deleteText}>계정 삭제</Text>
        </TouchableOpacity>
      </View>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'android' ? 16 : 12,
  },
  backButton: {
    padding: 8,
    marginLeft: -8,
  },
  backButtonPlaceholder: {
    width: 40,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  section: {
    paddingHorizontal: 20,
    marginTop: 24,
  },
  sectionLabel: {
    fontSize: 13,
    color: '#808080',
    marginBottom: 8,
    marginLeft: 4,
    fontWeight: '500',
  },
  card: {
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowText: {
    fontSize: 16,
    marginLeft: 12,
  },
  rowRightText: {
    fontSize: 15,
    color: '#808080',
  },
  divider: {
    height: 1,
    marginLeft: 48,
  },
  deleteText: {
    color: '#FF3B30',
    fontSize: 16,
    fontWeight: '500',
    paddingVertical: 16,
    paddingHorizontal: 16,
    textAlign: 'center',
  },
});
