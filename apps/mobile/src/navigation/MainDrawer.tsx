import React from 'react';
import { createDrawerNavigator } from '@react-navigation/drawer';
import ChatRoomScreen from '../screens/ChatRoomScreen';
import Sidebar from '../components/Sidebar';

export type MainDrawerParamList = {
  ChatRoom: { sessionId?: string } | undefined;
};

const Drawer = createDrawerNavigator<MainDrawerParamList>();

export default function MainDrawer() {
  return (
    <Drawer.Navigator
      drawerContent={(props) => <Sidebar {...props} />}
      screenOptions={{
        headerShown: false,
        drawerType: 'slide',
        drawerStyle: {
          width: '85%',
          backgroundColor: '#f8f9fa',
        },
      }}
    >
      <Drawer.Screen 
        name="ChatRoom" 
        component={ChatRoomScreen} 
      />
    </Drawer.Navigator>
  );
}
