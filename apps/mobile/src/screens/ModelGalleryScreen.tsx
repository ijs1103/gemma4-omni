import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  useColorScheme,
  Linking,
  StatusBar,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import { MODEL_CATALOG, type ModelId, type ModelDownloadState, type ModelCatalogEntry } from '../types/models';
import { getLiteRTAdapter } from '../adapters/LiteRTLMAdapter';

// ─────────────────────────────────────────────────────────────────────────────
// Navigation types
// ─────────────────────────────────────────────────────────────────────────────

type RootStackParamList = {
  Main: {
    screen?: string;
    params?: { modelId: ModelId };
  };
  ModelGallery: undefined;
};

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'ModelGallery'>;

// ─────────────────────────────────────────────────────────────────────────────
// Theme color palettes
// ─────────────────────────────────────────────────────────────────────────────

interface ThemeColors {
  // Backgrounds
  screenBg: string;
  cardBg: string;
  headerBg: string;

  // Text
  titleText: string;
  subtitleText: string;
  sectionTitle: string;
  modelName: string;
  metaText: string;
  descriptionText: string;
  linkText: string;

  // Badges
  bestBadgeBg: string;
  bestBadgeText: string;
  bestBadgeIcon: string;

  // Buttons
  downloadBtnBg: string;
  downloadBtnText: string;
  tryItBtnBg: string;
  tryItBtnText: string;

  // Progress / Status
  progressBg: string;
  progressFill: string;
  progressText: string;
  downloadingBg: string;
  downloadingText: string;

  // Misc
  indicatorBar: string;
  divider: string;
  cardShadow: string;
  iconDefault: string;
  errorText: string;
}

const LightColors: ThemeColors = {
  screenBg: '#F0F4F9',
  cardBg: '#FFFFFF',
  headerBg: '#F0F4F9',

  titleText: '#1A1A2E',
  subtitleText: '#5F6368',
  sectionTitle: '#1A1A2E',
  modelName: '#1A1A2E',
  metaText: '#5F6368',
  descriptionText: '#3C4043',
  linkText: '#1A73E8',

  bestBadgeBg: '#FEF7E0',
  bestBadgeText: '#B06000',
  bestBadgeIcon: '#EAB308',

  downloadBtnBg: '#1A73E8',
  downloadBtnText: '#FFFFFF',
  tryItBtnBg: '#1A73E8',
  tryItBtnText: '#FFFFFF',

  progressBg: '#E0E4E8',
  progressFill: '#1A73E8',
  progressText: '#5F6368',
  downloadingBg: '#E8F0FE',
  downloadingText: '#1A73E8',

  indicatorBar: '#1A73E8',
  divider: '#DADCE0',
  cardShadow: 'rgba(0, 0, 0, 0.08)',
  iconDefault: '#5F6368',
  errorText: '#D93025',
};

const DarkColors: ThemeColors = {
  screenBg: '#121212',
  cardBg: '#1E1E1E',
  headerBg: '#121212',

  titleText: '#E8EAED',
  subtitleText: '#9AA0A6',
  sectionTitle: '#E8EAED',
  modelName: '#E8EAED',
  metaText: '#9AA0A6',
  descriptionText: '#BDC1C6',
  linkText: '#8AB4F8',

  bestBadgeBg: '#3E2C00',
  bestBadgeText: '#FDD663',
  bestBadgeIcon: '#FDD663',

  downloadBtnBg: '#8AB4F8',
  downloadBtnText: '#1A1A2E',
  tryItBtnBg: '#8AB4F8',
  tryItBtnText: '#1A1A2E',

  progressBg: '#2C2C2C',
  progressFill: '#8AB4F8',
  progressText: '#9AA0A6',
  downloadingBg: '#1E3A5F',
  downloadingText: '#8AB4F8',

  indicatorBar: '#8AB4F8',
  divider: '#3C4043',
  cardShadow: 'rgba(0, 0, 0, 0.4)',
  iconDefault: '#9AA0A6',
  errorText: '#F28B82',
};

// ─────────────────────────────────────────────────────────────────────────────
// Badge config per model
// ─────────────────────────────────────────────────────────────────────────────

interface BadgeConfig {
  label: string;
  iconName: string;
}

const MODEL_BADGES: Record<ModelId, BadgeConfig> = {
  'litert-gemma-4-e2b': { label: '저사양 폰 추천', iconName: 'star' },
  'litert-gemma-4-e4b': { label: '고사양 폰 추천', iconName: 'star' },
};

// ─────────────────────────────────────────────────────────────────────────────
// Model Card Component
// ─────────────────────────────────────────────────────────────────────────────

interface ModelCardProps {
  entry: ModelCatalogEntry;
  state: ModelDownloadState;
  colors: ThemeColors;
  onDownload: () => void;
  onTryIt: () => void;
}

const ModelCard: React.FC<ModelCardProps> = ({
  entry,
  state,
  colors,
  onDownload,
  onTryIt,
}) => {
  const badge = MODEL_BADGES[entry.id];
  const badgeBg = colors.bestBadgeBg;
  const badgeText = colors.bestBadgeText;
  const badgeIcon = colors.bestBadgeIcon;

  const cardStyle: ViewStyle[] = [
    styles.card,
    {
      backgroundColor: colors.cardBg,
      shadowColor: colors.cardShadow,
    },
  ];

  const handleLearnMore = () => {
    Linking.openURL('https://ai.google.dev/gemma/docs/core/model_card_4?hl=ko');
  };

  return (
    <View style={cardStyle}>
      {/* ── Top row: badge ── */}
      <View style={styles.cardTopRow}>
        <View style={[styles.badge, { backgroundColor: badgeBg }]}>
          <MaterialIcons name={badge.iconName} size={14} color={badgeIcon} />
          <Text style={[styles.badgeText, { color: badgeText }]}>{badge.label}</Text>
        </View>
      </View>

      {/* ── Model name ── */}
      <Text style={[styles.modelName, { color: colors.modelName }]}>{entry.name}</Text>

      {/* ── Meta info: size ── */}
      <View style={styles.metaRow}>
        <MaterialIcons
          name={state.status === 'ready' ? 'check-circle' : 'help-outline'}
          size={16}
          color={state.status === 'ready' ? '#34A853' : colors.metaText}
        />
        <Text style={[styles.metaText, { color: colors.metaText }]}>{entry.sizeLabel}</Text>
      </View>

      {/* ── Learn more link ── */}
      <TouchableOpacity style={styles.linkRow} onPress={handleLearnMore}>
        <MaterialIcons name="open-in-new" size={15} color={colors.linkText} />
        <Text style={[styles.linkText, { color: colors.linkText }]}>
          Learn more and see model license
        </Text>
      </TouchableOpacity>

      {/* ── Description ── */}
      <Text style={[styles.description, { color: colors.descriptionText }]}>
        {entry.description}
      </Text>

      {/* ── Action buttons ── */}
      <View style={styles.actionArea}>
        {/* idle or error → Download */}
        {(state.status === 'idle' || state.status === 'error') && (
          <View style={styles.fullWidthBtnContainer}>
            {state.status === 'error' && (
              <Text style={[styles.errorText, { color: colors.errorText }]}>
                {state.message || '다운로드 실패'}
              </Text>
            )}
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: colors.downloadBtnBg }]}
              onPress={onDownload}
              activeOpacity={0.8}
            >
              <MaterialIcons name="download" size={18} color={colors.downloadBtnText} style={{ marginRight: 6 }} />
              <Text style={[styles.primaryBtnText, { color: colors.downloadBtnText }]}>Download</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* downloading → Status indicator */}
        {state.status === 'downloading' && (
          <View style={[styles.downloadingIndicator, { backgroundColor: colors.downloadingBg }]}>
            <MaterialIcons name="cloud-download" size={18} color={colors.downloadingText} />
            <Text style={[styles.downloadingText, { color: colors.downloadingText }]}>
              다운로드중
            </Text>
          </View>
        )}

        {/* loading → Loading indicator */}
        {state.status === 'loading' && (
          <View style={[styles.downloadingIndicator, { backgroundColor: colors.downloadingBg }]}>
            <MaterialIcons name="hourglass-top" size={18} color={colors.downloadingText} />
            <Text style={[styles.downloadingText, { color: colors.downloadingText }]}>
              메모리에 로딩중...
            </Text>
          </View>
        )}

        {/* ready → Try it */}
        {state.status === 'ready' && (
          <View style={styles.fullWidthBtnContainer}>
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: colors.tryItBtnBg }]}
              onPress={onTryIt}
              activeOpacity={0.8}
            >
              <Text style={[styles.primaryBtnText, { color: colors.tryItBtnText }]}>Try it</Text>
              <MaterialIcons name="arrow-forward" size={16} color={colors.tryItBtnText} style={{ marginLeft: 4 }} />
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Screen
// ─────────────────────────────────────────────────────────────────────────────

export const ModelGalleryScreen = () => {
  const navigation = useNavigation<NavigationProp>();
  const adapter = getLiteRTAdapter();
  const colorScheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const colors = colorScheme === 'dark' ? DarkColors : LightColors;

  const [downloadStates, setDownloadStates] = useState<Record<ModelId, ModelDownloadState>>({
    'litert-gemma-4-e2b': adapter.getDownloadState('litert-gemma-4-e2b'),
    'litert-gemma-4-e4b': adapter.getDownloadState('litert-gemma-4-e4b'),
  });

  useEffect(() => {
    const unsubscribes = MODEL_CATALOG.map((entry) =>
      adapter.onDownloadStateChange(entry.id, (state: ModelDownloadState) => {
        setDownloadStates((prev) => ({ ...prev, [entry.id]: state }));
      }),
    );
    return () => unsubscribes.forEach((unsub) => unsub());
  }, []);

  const handleDownload = useCallback(async (id: ModelId, sizeBytes: number) => {
    const hasSpace = await adapter.checkFreeSpace(sizeBytes);
    if (!hasSpace) {
      Alert.alert(
        '용량 부족',
        '디바이스에 저장 공간이 부족합니다. 여유 공간을 확보한 후 다시 시도해주세요.',
      );
      return;
    }
    await adapter.downloadModel(id);
  }, []);

  const handleTryIt = useCallback((id: ModelId) => {
    (navigation as any).navigate('Main', {
      screen: 'ChatRoom',
      params: { modelId: id, sessionId: undefined },
    });
  }, [navigation]);

  return (
    <View style={[styles.container, { backgroundColor: colors.screenBg }]}>
      <StatusBar
        barStyle={colorScheme === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={colors.headerBg}
      />

      {/* ── Header ── */}
      <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor: colors.headerBg }]}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <MaterialIcons name="arrow-back" size={24} color={colors.titleText} />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: colors.titleText }]}>모델 선택</Text>
          <View style={[styles.headerIndicator, { backgroundColor: colors.indicatorBar }]} />
        </View>

        {/* Spacer to balance the back arrow */}
        <View style={styles.headerSpacer} />
      </View>

      {/* ── Scrollable body ── */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {MODEL_CATALOG.map((entry) => {
          const state = downloadStates[entry.id] || { status: 'idle' };
          return (
            <ModelCard
              key={entry.id}
              entry={entry}
              state={state}
              colors={colors}
              onDownload={() => handleDownload(entry.id, entry.sizeBytes)}
              onTryIt={() => handleTryIt(entry.id)}
            />
          );
        })}
      </ScrollView>
    </View>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Styles (color-agnostic; all colors are applied inline via theme)
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // ── Layout ──
  container: {
    flex: 1,
  } as ViewStyle,
  scrollView: {
    flex: 1,
  } as ViewStyle,
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
  } as ViewStyle,

  // ── Header ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
  } as ViewStyle,
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  } as ViewStyle,
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.2,
  } as TextStyle,
  headerIndicator: {
    width: 28,
    height: 3,
    borderRadius: 1.5,
    marginTop: 6,
  } as ViewStyle,
  headerSpacer: {
    width: 40,
  } as ViewStyle,
  headerSubtitle: {
    fontSize: 13,
    textAlign: 'center',
    paddingBottom: 8,
  } as TextStyle,

  // ── Section ──
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 14,
    paddingHorizontal: 2,
  } as TextStyle,

  // ── Card ──
  card: {
    borderRadius: 18,
    padding: 18,
    marginBottom: 16,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 3,
  } as ViewStyle,
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  } as ViewStyle,

  // ── Badge ──
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    gap: 5,
  } as ViewStyle,
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
  } as TextStyle,

  // ── Model info ──
  modelName: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 10,
  } as TextStyle,
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  } as ViewStyle,
  metaText: {
    fontSize: 13,
    fontWeight: '500',
  } as TextStyle,

  // ── Link ──
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 10,
  } as ViewStyle,
  linkText: {
    fontSize: 13,
    fontWeight: '500',
  } as TextStyle,

  // ── Description ──
  description: {
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 8,
  } as TextStyle,

  // ── Action area ──
  actionArea: {
    marginTop: 12,
  } as ViewStyle,
  fullWidthBtnContainer: {
    width: '100%',
  } as ViewStyle,

  // ── Buttons ──
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    borderRadius: 24,
    flex: 1,
  } as ViewStyle,
  primaryBtnText: {
    fontSize: 14,
    fontWeight: '700',
  } as TextStyle,

  // ── Downloading indicator ──
  downloadingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    borderRadius: 24,
    gap: 8,
  } as ViewStyle,
  downloadingText: {
    fontSize: 14,
    fontWeight: '600',
  } as TextStyle,

  // ── Error ──
  errorText: {
    fontSize: 12,
    marginBottom: 8,
    textAlign: 'center',
  } as TextStyle,
});
