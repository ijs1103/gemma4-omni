import React from 'react';
import { View, ActivityIndicator, Linking } from 'react-native';
import { NavigationContainer, DefaultTheme, DarkTheme, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import LoginScreen from '../screens/LoginScreen';
import MainDrawer from './MainDrawer';
import { useThemeContext } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import AccountSettingsScreen from '../screens/AccountSettingsScreen';
import DeleteAccountScreen from '../screens/DeleteAccountScreen';
import { ModelGalleryScreen } from '../screens/ModelGalleryScreen';

export type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
  AccountSettings: undefined;
  DeleteAccount: undefined;
  ModelGallery: undefined;
};

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  const { isAuthenticated, isLoading } = useAuth();
  const { isDarkMode } = useThemeContext();

  React.useEffect(() => {
    const handleUrl = (url: string | null) => {
      if (url === 'com.mobile://modelgallery') {
        if (navigationRef.isReady()) {
          navigationRef.navigate('ModelGallery');
        }
      }
    };

    Linking.getInitialURL().then(handleUrl);

    const subscription = Linking.addEventListener('url', ({ url }) => {
      handleUrl(url);
    });

    return () => subscription.remove();
  }, []);

  // 앱 시작 시 세션 복원 중 — 스플래시처럼 로딩 표시
  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1a1a2e' }}>
        <ActivityIndicator size="large" color="#7C6AE8" />
      </View>
    );
  }

  return (
    <NavigationContainer ref={navigationRef} theme={isDarkMode ? DarkTheme : DefaultTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!isAuthenticated ? (
          <Stack.Screen name="Auth" component={LoginScreen} />
        ) : (
          <>
            <Stack.Screen name="Main" component={MainDrawer} />
            <Stack.Screen name="ModelGallery" component={ModelGalleryScreen} />
            <Stack.Screen name="AccountSettings" component={AccountSettingsScreen} />
            <Stack.Screen
              name="DeleteAccount"
              component={DeleteAccountScreen}
              options={{ presentation: 'transparentModal', animation: 'fade' }}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
