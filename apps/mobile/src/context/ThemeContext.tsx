import React, { createContext, useContext, useState, useEffect } from 'react';
import { Appearance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface ThemeContextType {
  isDarkMode: boolean;
  setDarkMode: (isDark: boolean) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const THEME_STORAGE_KEY = '@app_theme_mode';

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // 기기 시스템 테마를 기본값으로 설정
  const systemColorScheme = Appearance.getColorScheme();
  const [isDarkMode, setIsDarkMode] = useState<boolean>(systemColorScheme === 'dark');

  // 앱 로드 시 AsyncStorage에서 이전 설정 불러오기
  useEffect(() => {
    const loadTheme = async () => {
      try {
        const savedTheme = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (savedTheme !== null) {
          setIsDarkMode(savedTheme === 'dark');
        }
      } catch (error) {
        console.error('Failed to load theme from storage', error);
      }
    };
    loadTheme();
  }, []);

  // 기기 시스템 테마 변경 감지
  useEffect(() => {
    const subscription = Appearance.addChangeListener(({ colorScheme }) => {
      // 사용자가 명시적으로 설정한 값이 없을 때만 시스템 테마를 따름
      AsyncStorage.getItem(THEME_STORAGE_KEY).then(saved => {
        if (!saved) {
          setIsDarkMode(colorScheme === 'dark');
        }
      });
    });
    return () => subscription.remove();
  }, []);

  // 토글 버튼 등에서 호출될 상태 및 스토리지 업데이트 함수
  const setDarkMode = async (isDark: boolean) => {
    setIsDarkMode(isDark);
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, isDark ? 'dark' : 'light');
    } catch (error) {
      console.error('Failed to save theme to storage', error);
    }
  };

  return (
    <ThemeContext.Provider value={{ isDarkMode, setDarkMode }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useThemeContext = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useThemeContext must be used within a ThemeProvider');
  }
  return context;
};
