import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, SvgProps } from 'react-native-svg';
import { useTheme } from '@react-navigation/native';

// ─── SVG Icons ──────────────────────────────────────────────────────────────

export const MenuIcon = (props: SvgProps) => (
  <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" {...props}>
    <Path
      d="M3 12H21M3 6H21M3 18H21"
      stroke={props.color || '#333333'}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const ChevronDownIcon = (props: SvgProps) => (
  <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" {...props}>
    <Path
      d="M6 9L12 15L18 9"
      stroke={props.color || '#333333'}
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const PencilIcon = (props: SvgProps) => (
  <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" {...props}>
    <Path
      d="M12 20h9M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4L16.5 3.5z"
      stroke={props.color || '#333333'}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const MoreVerticalIcon = (props: SvgProps) => (
  <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" {...props}>
    <Path
      d="M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0 M12 5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0 M12 19m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"
      stroke={props.color || '#333333'}
      strokeWidth={2.5}
      fill={props.color || '#333333'}
    />
  </Svg>
);

// ─── ChatHeader Component ────────────────────────────────────────────────────

interface ChatHeaderProps {
  onPressMenu: () => void;
  onPressModel: () => void;
  onPressNewChat: () => void;
  onPressMore: () => void;
  modelName?: string;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  onPressMenu,
  onPressModel,
  onPressNewChat,
  onPressMore,
  modelName = 'Gemma4-e4b',
}) => {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, 8), backgroundColor: colors.background }]}>
      {/* 1. Hamburger menu */}
      <TouchableOpacity
        onPress={onPressMenu}
        style={styles.iconButton}
        activeOpacity={0.7}
        accessibilityLabel="메뉴 열기"
      >
        <MenuIcon color={colors.text} />
      </TouchableOpacity>

      {/* 2. AI Model Selection Button */}
      <TouchableOpacity
        onPress={onPressModel}
        style={[styles.modelSelector, { backgroundColor: colors.card }]}
        activeOpacity={0.7}
        accessibilityLabel="모델 선택"
      >
        <Text style={[styles.modelText, { color: colors.text }]}>{modelName}</Text>
        <ChevronDownIcon color={colors.text} style={styles.chevron} />
      </TouchableOpacity>

      {/* 3 & 4. Right side icons */}
      <View style={styles.rightIconsContainer}>
        <TouchableOpacity
          onPress={onPressNewChat}
          style={styles.iconButton}
          activeOpacity={0.7}
          accessibilityLabel="새 채팅"
        >
          <PencilIcon color={colors.text} />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={onPressMore}
          style={[styles.iconButton, styles.moreButton]}
          activeOpacity={0.7}
          accessibilityLabel="더보기"
        >
          <MoreVerticalIcon color={colors.text} />
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 3,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  iconButton: {
    padding: 8,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modelSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F5F5F5',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  modelText: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#333333',
    marginRight: 4,
  },
  chevron: {
    marginTop: 2,
  },
  rightIconsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  moreButton: {
    marginLeft: 8,
  },
});
