import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  FlatList, 
  SafeAreaView 
} from 'react-native';
import { DrawerContentComponentProps, useDrawerStatus } from '@react-navigation/drawer';
import { useTheme } from '@react-navigation/native';
import { Settings, MessageSquare, Pin } from 'lucide-react-native';
import { useChat } from '../context/ChatContext';
import SettingsModal from './SettingsModal';

export default function Sidebar(props: DrawerContentComponentProps) {
  const { colors } = useTheme();
  const { sessions, loadSessions, activeSessionId, setActiveSessionId } = useChat();
  const [isSettingsVisible, setSettingsVisible] = useState(false);

  // Mock User Info
  const user = {
    name: 'lj',
    email: 'ajapag@gmail.com',
    initial: 'l',
  };

  const drawerStatus = useDrawerStatus();

  useEffect(() => {
    loadSessions();
  }, []);

  useEffect(() => {
    if (drawerStatus === 'open') {
      loadSessions();
    }
  }, [drawerStatus]);

  const openChat = (sessionId: string) => {
    setActiveSessionId(sessionId);
    props.navigation.navigate('ChatRoom', { sessionId });
  };

  const startNewChat = () => {
    setActiveSessionId(undefined);
    props.navigation.navigate('ChatRoom', { sessionId: undefined });
    props.navigation.closeDrawer();
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={startNewChat} activeOpacity={0.7}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>옾피티</Text>
        </TouchableOpacity>
      </View>
      
      <Text style={[styles.recentTitle, { color: colors.text }]}>최근</Text>

      <FlatList
        data={sessions}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const isActive = item.id === activeSessionId;
          return (
            <TouchableOpacity 
              style={[styles.chatItem, isActive && [styles.chatItemActive, { backgroundColor: colors.card }]]} 
              onPress={() => openChat(item.id)}
            >
              <Text style={[styles.chatTitle, { color: colors.text }]} numberOfLines={1}>
                {item.title || '새로운 로컬 대화'}
              </Text>
              {isActive ? (
                <Pin size={16} color={colors.text} />
              ) : null}
            </TouchableOpacity>
          );
        }}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />

      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => setSettingsVisible(true)}
          style={styles.userInfo}
        >
          <View style={[styles.avatar, { borderColor: colors.border }]}>
            <Text style={styles.avatarText}>{user.initial}</Text>
          </View>
          <View>
            <Text style={[styles.userName, { color: colors.text }]}>{user.name}</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setSettingsVisible(true)} style={styles.settingsBtn}>
          <Settings size={24} color={colors.text} />
        </TouchableOpacity>
      </View>

      <SettingsModal 
        visible={isSettingsVisible} 
        onClose={() => setSettingsVisible(false)} 
        user={user}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 16,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '600',
    color: '#202124',
  },
  recentTitle: {
    fontSize: 14,
    color: '#5f6368',
    paddingHorizontal: 20,
    marginBottom: 8,
    fontWeight: '500',
  },
  listContent: {
    paddingHorizontal: 12,
  },
  chatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 24,
    marginBottom: 2,
  },
  chatItemActive: {
    backgroundColor: '#e9eef6',
  },
  chatTitle: {
    fontSize: 15,
    color: '#3c4043',
    flex: 1,
    marginRight: 8,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#e8eaed',
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#9ca3af',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    borderWidth: 1.5,
    borderColor: '#e5e7eb',
  },
  avatarText: {
    fontSize: 18,
    color: '#ffffff',
    fontWeight: '600',
  },
  userName: {
    fontSize: 16,
    fontWeight: '500',
    color: '#202124',
  },
  settingsBtn: {
    padding: 8,
  },
});
