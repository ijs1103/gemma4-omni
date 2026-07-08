import React, { useState } from 'react';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import LoginScreen from '../screens/LoginScreen';
import MainDrawer from './MainDrawer';
import { useThemeContext } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import AccountSettingsScreen from '../screens/AccountSettingsScreen';
import DeleteAccountScreen from '../screens/DeleteAccountScreen';

export type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
  AccountSettings: undefined;
  DeleteAccount: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  const { isAuthenticated, setIsAuthenticated } = useAuth();
  const { isDarkMode } = useThemeContext();

  return (
    <NavigationContainer theme={isDarkMode ? DarkTheme : DefaultTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!isAuthenticated ? (
          <Stack.Screen name="Auth">
            {(props) => <LoginScreen {...props} onLogin={() => setIsAuthenticated(true)} />}
          </Stack.Screen>
        ) : (
          <>
            <Stack.Screen name="Main" component={MainDrawer} />
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
