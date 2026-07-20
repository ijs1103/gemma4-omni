import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Animated,
  Keyboard,
  ActionSheetIOS,
  Alert,
  Image,
  ScrollView,
  NativeEventEmitter,
  NativeModules,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import { pick, types, isErrorWithCode, errorCodes } from '@react-native-documents/picker';
import RNFS from 'react-native-fs';
import { LiteRTLMAdapter } from '../adapters/LiteRTLMAdapter';
import { MobileStorageAdapter } from '../adapters/MobileStorageAdapter';
import type { ChatMessage, ModelLoadState, Attachment } from '@repo/ai-core';
import Markdown from 'react-native-markdown-display';
import { preprocessMarkdown } from '../utils/markdown';
import Clipboard from '@react-native-clipboard/clipboard';
import { Copy, Menu, Sparkles, Plus, Square } from 'lucide-react-native';
import BottomSheet from '@gorhom/bottom-sheet';
import { ChatHeader } from '../components/ChatHeader';
import { ChatBottomSheet } from '../components/ChatBottomSheet';
import { RenameChatModal } from '../components/RenameChatModal';
import { DeleteConfirmModal } from '../components/DeleteConfirmModal';
import { useChat } from '../context/ChatContext';
import { useTheme } from '@react-navigation/native';

// 싱글톤 어댑터 — 네이티브 브릿지가 준비된 후 컴포넌트 초기화 시점에 생성
// (모듈 최상위에서 즉시 생성하면 NativeModules가 undefined 상태일 수 있음)
let _modelAdapter: LiteRTLMAdapter | null = null;
let _storage: MobileStorageAdapter | null = null;
function getModelAdapter(): LiteRTLMAdapter {
  if (!_modelAdapter) _modelAdapter = new LiteRTLMAdapter();
  return _modelAdapter;
}
function getStorage(): MobileStorageAdapter {
  if (!_storage) _storage = new MobileStorageAdapter();
  return _storage;
}

// ─── [전략 A: Soft Stop] 정지 후 백그라운드 정리 상태 감지용 이벤트 브릿지 ──────
// LiteRTModule이 발송하는 onGenerationInterrupted / onGenerationSettled를 직접 구독한다.
// - onGenerationInterrupted: 네이티브가 실제로 중단을 반영한 시점
//   (전략 B 적용 후에는 항상 decode 단계 진입 후에만 발생 — prefill 중 발생하지 않음)
// - onGenerationSettled: 네이티브 생성이 실제로 완전히 끝나 "새 질문을 보내도 안전한" 시점
// 이 신호를 기반으로 정지 직후~완전 정리 전까지 입력을 잠가서, BUSY 에러가 사용자에게 노출되는 상황 자체를 예방한다.
const LiteRTNativeModule = NativeModules.LiteRT;
const liteRTLifecycleEmitter = LiteRTNativeModule
  ? new NativeEventEmitter(LiteRTNativeModule)
  : null;

// ─── AI 버블 전용 메시지 타입 ────────────────────────────────────────────────
// isThinking: true → 로딩 점 애니메이션 표시
// isThinking: false + content → 완성된 텍스트 표시 (내부 스크롤)
interface DisplayMessage extends ChatMessage {
  isThinking?: boolean;
  isInterrupted?: boolean;
}

// ─── 로딩 점 애니메이션 컴포넌트 ─────────────────────────────────────────────
function ThinkingDots() {
  const dots = [useRef(new Animated.Value(0)).current,
                useRef(new Animated.Value(0)).current,
                useRef(new Animated.Value(0)).current];

  useEffect(() => {
    const animations = dots.map((dot, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 160),
          Animated.timing(dot, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0, duration: 300, useNativeDriver: true }),
          Animated.delay((dots.length - i - 1) * 160),
        ])
      )
    );
    const parallel = Animated.parallel(animations);
    parallel.start();
    return () => parallel.stop();
  }, []);

  return (
    <View style={styles.thinkingContainer}>
      {dots.map((dot, i) => (
        <Animated.View
          key={i}
          style={[
            styles.thinkingDot,
            {
              opacity: dot,
              transform: [{ translateY: dot.interpolate({ inputRange: [0, 1], outputRange: [0, -5] }) }],
            },
          ]}
        />
      ))}
      <Text style={styles.thinkingLabel}>추론 중...</Text>
    </View>
  );
}

// ─── AI 버블 컴포넌트 ─────────────────────────────────────────────────────────
// isThinking=true 이면 로딩 UI, false 이면 텍스트를 그대로 표시 (버블 크기 가변)
function AIMessageBubble({ message }: { message: DisplayMessage }) {
  const { dark } = useTheme();

  const handleCopy = () => {
    Clipboard.setString(message.content || '');
    if (Platform.OS === 'ios') {
      Alert.alert('복사 완료', '채팅 내용이 클립보드에 복사되었습니다.');
    }
  };

  return (
    <View style={styles.bubbleWrapperContainer}>
      <View style={[styles.messageBubble, styles.aiBubble, dark && dynamicStyles.aiBubbleDark]}>
        {message.isThinking ? (
          <ThinkingDots />
        ) : (
          <Markdown style={dark ? markdownStylesDark : markdownStylesLight}>
            {preprocessMarkdown(message.content || '')}
          </Markdown>
        )}
        {/* 중단 안내 텍스트: 버블 내부 본문 바로 아래에 시스템 문구체로 표시 */}
        {message.isInterrupted && (
          <Text style={styles.stoppedNoticeText}>대답이 중지되었습니다.</Text>
        )}
      </View>
      {!message.isThinking && (
        <View style={[styles.bubbleActionRow, { alignSelf: 'flex-start', marginLeft: 4 }]}>
          <TouchableOpacity onPress={handleCopy} style={styles.bubbleActionButton}>
            <Copy size={15} color="#a0a0d0" style={styles.bubbleActionIconSvg} />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

export default function ChatRoomScreen({ route, navigation }: any) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const initialSessionId = route.params?.sessionId;
  const {
    activeSessionId,
    setActiveSessionId,
    currentChatTitle,
    setCurrentChatTitle,
    updateSessionTitle,
    deleteSession,
    loadSessions,
  } = useChat();
  const [sessionCreatedAt, setSessionCreatedAt] = useState<number | undefined>(undefined);
  const [isRenameModalVisible, setIsRenameModalVisible] = useState(false);
  const [isDeleteModalVisible, setIsDeleteModalVisible] = useState(false);

  const [inputText, setInputText] = useState('');
  const [modelState, setModelState] = useState<ModelLoadState>({ status: 'idle' });
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  // [전략 A 추가] 정지 버튼을 누른 뒤부터 onGenerationSettled를 받기 전까지 true.
  // 이 구간 동안은 새 질문 전송을 UI 레벨에서 차단해서 BUSY 에러 노출을 예방한다.
  const [isSettling, setIsSettling] = useState(false);
  // [전략 B 추가] 정지 버튼을 눌렀지만 아직 prefill 중이라 네이티브 중단 호출이
  // "예약"만 되어있는 상태. 첫 토큰이 도착해 실제 interrupt가 실행되면 false로 전환된다.
  const [isDeferredStop, setIsDeferredStop] = useState(false);
  const [isKeyboardVisible, setKeyboardVisible] = useState(false);
  const [hasKeyboardOpened, setHasKeyboardOpened] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);

  const flatListRef = useRef<FlatList>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [inputHeight, setInputHeight] = useState(60);

  // Sync initialSessionId to activeSessionId in ChatContext
  useEffect(() => {
    setActiveSessionId(initialSessionId);
  }, [initialSessionId, setActiveSessionId]);

  // Sync currentChatTitle state to navigation title
  useEffect(() => {
    navigation.setOptions({ title: currentChatTitle });
  }, [currentChatTitle, navigation]);

  // stale closure 방지: cleanup에서 최신 state 참조용 ref
  const messagesRef = useRef<DisplayMessage[]>(messages);
  const activeSessionIdRef = useRef<string | undefined>(activeSessionId);
  const sessionCreatedAtRef = useRef<number | undefined>(sessionCreatedAt);
  // 중단 플래그: handleInterrupt에서 세팅, sendMessage 완료 시 확인 후 리셋
  const isInterruptedRef = useRef(false);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { activeSessionIdRef.current = activeSessionId; }, [activeSessionId]);
  useEffect(() => { sessionCreatedAtRef.current = sessionCreatedAt; }, [sessionCreatedAt]);

  // ─── [전략 A 추가] 정지 후 백그라운드 정리 상태 구독 ──────────────────────
  // onGenerationInterrupted: 네이티브가 실제로 중단을 반영한 시점 → 입력 잠금 시작
  //   (전략 B 적용 후에는 이 이벤트가 항상 decode 진입 후에만 발생하므로,
  //    "정지 예약(isDeferredStop)" 상태도 여기서 함께 해제한다.)
  // onGenerationSettled: 네이티브 정리 완료 시점 → 입력 잠금 해제
  useEffect(() => {
    const interruptedSub = liteRTLifecycleEmitter?.addListener(
      'onGenerationInterrupted',
      () => {
        setIsSettling(true);
        setIsDeferredStop(false);
      },
    );
    const settledSub = liteRTLifecycleEmitter?.addListener(
      'onGenerationSettled',
      () => {
        setIsSettling(false);
        setIsDeferredStop(false);
      },
    );
    return () => {
      interruptedSub?.remove();
      settledSub?.remove();
    };
  }, []);

  // ─── 바텀시트 Ref 및 헤더/바텀시트 이벤트 핸들러 ──────────────────────
  const bottomSheetRef = useRef<BottomSheet>(null);

  const handleRename = () => {
    console.log('이름변경 버튼 클릭됨');
    bottomSheetRef.current?.close();
    if (activeSessionId) {
      setIsRenameModalVisible(true);
    } else {
      Alert.alert('알림', '대화가 시작된 후에 이름을 변경할 수 있습니다.');
    }
  };

  const handleRenameSave = async (newTitle: string) => {
    if (activeSessionId) {
      await updateSessionTitle(activeSessionId, newTitle);
      setIsRenameModalVisible(false);
      Alert.alert('성공', '채팅방 이름이 변경되었습니다.');
    }
  };

  const handleDelete = () => {
    console.log('삭제 버튼 클릭됨');
    bottomSheetRef.current?.close();
    if (activeSessionId) {
      setIsDeleteModalVisible(true);
    } else {
      Alert.alert('알림', '삭제할 대화 내역이 없습니다.');
    }
  };

  const handleDeleteConfirm = async () => {
    if (activeSessionId) {
      const idToDelete = activeSessionId;
      setIsDeleteModalVisible(false);
      handleHeaderNewChat();
      await deleteSession(idToDelete);
    }
  };

  const handleHeaderMenu = () => {
    console.log('헤더 햄버거 메뉴 클릭됨');
    navigation.openDrawer();
  };

  const handleHeaderModel = () => {
    console.log('헤더 AI 모델 선택 클릭됨');
    Alert.alert('알림', '모델 선택 기능이 트리거되었습니다.');
  };

  const handleHeaderNewChat = () => {
    console.log('헤더 새 채팅 클릭됨');
    navigation.setParams({ sessionId: undefined });
    setMessages([]);
    setActiveSessionId(undefined);
    setSessionCreatedAt(Date.now());
    setShowScrollBottom(false);
  };

  const handleHeaderMore = () => {
    console.log('헤더 더보기 메뉴 클릭됨');
    bottomSheetRef.current?.expand();
  };

  const handleAttachment = () => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['취소', '사진 촬영', '앨범에서 선택', '문서 첨부'],
          cancelButtonIndex: 0,
        },
        (buttonIndex) => {
          if (buttonIndex === 1) openCamera();
          else if (buttonIndex === 2) openImagePicker();
          else if (buttonIndex === 3) openDocumentPicker();
        }
      );
    } else {
      Alert.alert('첨부', '원하시는 첨부 방식을 선택하세요.', [
        { text: '사진 촬영', onPress: openCamera },
        { text: '앨범에서 선택', onPress: openImagePicker },
        { text: '문서 첨부', onPress: openDocumentPicker },
        { text: '취소', style: 'cancel' },
      ]);
    }
  };

  const openCamera = async () => {
    try {
      const result = await launchCamera({ mediaType: 'photo', quality: 0.8 });
      if (result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        if (asset.uri) {
          setPendingAttachments((prev) => [
            ...prev,
            {
              id: Date.now().toString(),
              type: 'image',
              uri: asset.uri!,
              name: asset.fileName || 'photo.jpg',
              mimeType: asset.type || 'image/jpeg',
              sizeBytes: asset.fileSize,
            },
          ]);
        }
      }
    } catch (e) {
      console.log('Camera cancelled or failed', e);
    }
  };

  const openImagePicker = async () => {
    try {
      const result = await launchImageLibrary({ mediaType: 'photo', quality: 0.8, selectionLimit: 3 });
      if (result.assets) {
        const newAttachments: Attachment[] = result.assets.map((asset, idx) => ({
          id: (Date.now() + idx).toString(),
          type: 'image',
          uri: asset.uri!,
          name: asset.fileName || 'photo.jpg',
          mimeType: asset.type || 'image/jpeg',
          sizeBytes: asset.fileSize,
        }));
        setPendingAttachments((prev) => [...prev, ...newAttachments].slice(0, 5));
      }
    } catch (e) {
      console.log('Image picker cancelled or failed', e);
    }
  };

  const openDocumentPicker = async () => {
    try {
      const result = await pick({
        type: [types.plainText, types.pdf, types.csv, 'application/json', 'text/markdown'],
        allowMultiSelection: true,
      });

      for (const res of result) {
        let textContent: string | undefined = undefined;
        const isPdf = res.type === 'application/pdf' || res.name?.toLowerCase().endsWith('.pdf');

        if (isPdf) {
          // PDF 파일 → parsePdfFromUri()로 텍스트 추출
          try {
            const { parsePdfFromUri } = require('../utils/pdf-parser');
            const parseResult = await parsePdfFromUri(res.uri, res.name || 'document.pdf');
            textContent = parseResult.document.rawText;
            if (parseResult.warnings.length > 0) {
              console.warn('[ChatRoom] PDF 파싱 경고:', parseResult.warnings);
            }
            if (!textContent || textContent.trim().length === 0) {
              Alert.alert(
                '알림',
                '이 PDF에서 텍스트를 추출할 수 없습니다. 이미지 기반(스캔) PDF일 수 있습니다.',
              );
            }
          } catch (pdfError: any) {
            console.error('[ChatRoom] PDF 파싱 실패:', pdfError);
            Alert.alert('오류', `PDF 텍스트 추출 실패: ${pdfError.message}`);
          }
        } else if (res.type && (res.type.includes('text') || res.type.includes('json') || res.type.includes('csv'))) {
          // 일반 텍스트 파일 → RNFS로 직접 읽기
          try {
            textContent = await RNFS.readFile(res.uri, 'utf8');
          } catch (e) {
            console.error('Failed to read document text', e);
          }
        }

        setPendingAttachments((prev) => [
          ...prev,
          {
            id: Date.now().toString() + Math.random().toString(),
            type: 'document' as const,
            uri: res.uri,
            name: res.name || 'document',
            mimeType: res.type || 'application/octet-stream',
            sizeBytes: res.size || 0,
            textContent,
          },
        ].slice(0, 5));
      }
    } catch (err) {
      if (!(isErrorWithCode(err) && err.code === errorCodes.OPERATION_CANCELED)) {
        Alert.alert('오류', '문서를 불러올 수 없습니다.');
      }
    }
  };

  const removeAttachment = (id: string) => {
    setPendingAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const handleScroll = (event: any) => {
    const offsetY = event.nativeEvent.contentOffset.y;
    const contentHeight = event.nativeEvent.contentSize.height;
    const layoutHeight = event.nativeEvent.layoutMeasurement.height;

    // 150px 이상 위로 스크롤하면 최하단 이동 버튼 표시
    const isCloseToBottom = layoutHeight + offsetY >= contentHeight - 150;
    setShowScrollBottom(!isCloseToBottom);
  };

  // ── 키보드 가시성 추적 (Safe Area 동적 제어) ──────────────────────────────────
  useEffect(() => {
    // iOS는 애니메이션이 부드러운 WillShow/Hide, Android는 DidShow/Hide 사용
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, () => {
      setKeyboardVisible(true);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardVisible(false);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // 커스텀 헤더 높이 계산 (ChatHeader 56px + modelStatusHeader 약 40px + 노치/상태바 높이)
  const headerHeight = 56 + 40 + insets.top;

  // 고정 높이 사용: KAV 내부 컨텐츠의 높이가 변하면 iOS에서 두 번째 포커스 시점부터
  // 여백이 비정상적으로 누적되는 버그(baseline accumulation)를 방지하기 위함입니다.
  const bottomOffset = 12;

  // ── 세션 로드 + 미완료 추론 복원 ────────────────────────────────────────────
  useEffect(() => {
    const loadSessionData = async () => {
      if (initialSessionId) {
        try {
          const loaded = await getStorage().loadSession(initialSessionId);
          if (loaded) {
            const loadedMsgs = loaded.messages as DisplayMessage[];
            setMessages(loadedMsgs);
            setSessionCreatedAt(loaded.createdAt);
            setCurrentChatTitle(loaded.title || '대화방');

            // 마지막 메시지가 isThinking=true 상태이면 → 추론이 중단된 것
            // 모델이 준비되면 이어서 추론
            const lastMsg = loadedMsgs[loadedMsgs.length - 1];
            if (lastMsg?.role === 'assistant' && (lastMsg as DisplayMessage).isThinking) {
              const thinkingId = lastMsg.id;
              // 추론 대상: isThinking 버블 직전까지의 메시지
              const contextMsgs = loadedMsgs.slice(0, loadedMsgs.length - 1);
              setIsGenerating(true);

              (async () => {
                try {
                  await getModelAdapter().waitForReady();
                  const responseStream = getModelAdapter().stream(contextMsgs);
                  let accumulatedText = '';
                  for await (const chunk of responseStream) {
                    if (chunk.type === 'text-delta') {
                      accumulatedText += chunk.text;
                      setMessages((prev) =>
                        prev.map((m) =>
                          m.id === thinkingId
                            ? { ...m, content: accumulatedText, isThinking: false }
                            : m
                        )
                      );
                    }
                  }
                  const completedMsg: DisplayMessage = {
                    id: thinkingId,
                    role: 'assistant',
                    content: accumulatedText,
                    timestamp: Date.now(),
                    isThinking: false,
                  };
                  const finalMsgs: DisplayMessage[] = [...contextMsgs, completedMsg];
                  setMessages(finalMsgs);

                  const firstUserMsg = finalMsgs.find((m) => m.role === 'user');
                  const sessionTitle = firstUserMsg
                    ? firstUserMsg.content.slice(0, 18) + (firstUserMsg.content.length > 18 ? '...' : '')
                    : '채팅 세션';
                  await getStorage().saveSession({
                    id: initialSessionId,
                    title: sessionTitle,
                    status: 'active',
                    modelId: 'litert-gemma-4-e4b',
                    createdAt: loaded.createdAt,
                    updatedAt: Date.now(),
                    messages: finalMsgs,
                  });
                } catch (err) {
                  console.error('[ChatRoom] 복원 추론 실패:', err);
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === thinkingId
                        ? { ...m, content: '추론 도중 오류가 발생했습니다. 다시 질문해 주세요.', isThinking: false }
                        : m
                    )
                  );
                } finally {
                  setIsGenerating(false);
                }
              })();
            }
          }
        } catch (e) {
          console.error('Failed to load saved session', e);
        }
      } else {
        setMessages([]);
        setSessionCreatedAt(Date.now());
      }
    };
    loadSessionData();
  }, [initialSessionId]);

  // ── 모델 초기화 ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const unsubscribe = getModelAdapter().onLoadStateChange((state) => {
      setModelState(state);
      // 모델이 ready 상태가 되면 현재 UI state를 동기화
    });

    const initModel = async () => {
      try {
        await getModelAdapter().init({
          id: 'litert-gemma-4-e4b',
          family: 'gemma',
          variant: '4-E4B',
        });
      } catch (error) {
        console.error('Model loading failed', error);
      }
    };

    initModel();

    // Cleanup: 구독만 해제. 모델은 언로드하지 않음 (싱글톤 유지)
    return () => {
      unsubscribe();
      // 최신 ref 값으로 현재 세션 저장
      const curSessionId = activeSessionIdRef.current;
      const curMessages = messagesRef.current;
      const curCreatedAt = sessionCreatedAtRef.current;
      if (curSessionId && curMessages.length > 0) {
        const firstUserMsg = curMessages.find((m) => m.role === 'user');
        const sessionTitle = firstUserMsg
          ? firstUserMsg.content.slice(0, 18) + (firstUserMsg.content.length > 18 ? '...' : '')
          : '채팅 세션';
        getStorage().saveSession({
          id: curSessionId,
          title: sessionTitle,
          status: 'active',
          modelId: 'litert-gemma-4-e4b',
          createdAt: curCreatedAt || Date.now(),
          updatedAt: Date.now(),
          messages: curMessages as any,
        }).catch((e) => console.error('[ChatRoom] cleanup 저장 실패:', e));
      }
      // ❌ getModelAdapter().unload() 호출 제거 → 모델 상태 유지
    };
  }, []);

  // ── 메시지 추가 시 FlatList 맨 아래로 스크롤 ───────────────────────────────
  useEffect(() => {
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 100);
  }, [messages.length]);

  // ── 메시지 전송 및 추론 ──────────────────────────────────────────────────────
  const sendMessage = async () => {
    // [전략 A 추가] isSettling 중에는 전송 자체를 막는다.
    // (네이티브가 아직 백그라운드에서 이전 생성을 정리 중인 상태)
    if ((!inputText.trim() && pendingAttachments.length === 0) || isGenerating || isSettling) return;

    let curSessionId = activeSessionId;
    let curCreatedAt = sessionCreatedAt;

    if (!curSessionId) {
      curSessionId = Date.now().toString();
      curCreatedAt = Date.now();
      setActiveSessionId(curSessionId);
      setSessionCreatedAt(curCreatedAt);
    }

    // 1. 사용자 메시지 추가
    const userMsg: DisplayMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: inputText,
      attachments: pendingAttachments.length > 0 ? [...pendingAttachments] : undefined,
      timestamp: Date.now(),
    };

    const updatedMessagesWithUser = [...messages, userMsg];
    setMessages(updatedMessagesWithUser);
    setInputText('');
    setPendingAttachments([]);
    setIsGenerating(true);

    // 2. AI 로딩 버블 추가 (isThinking: true)
    const assistantMsgId = (Date.now() + 1).toString();
    const thinkingMsg: DisplayMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      timestamp: Date.now() + 1,
      isThinking: true,
    };

    const msgsWithThinking = [...updatedMessagesWithUser, thinkingMsg];
    setMessages(msgsWithThinking);

    // ★ 핵심: 추론 시작 전에 isThinking=true 상태를 storage에 즉시 저장
    // → 뒤로가기 후 재진입해도 추론 중 버블이 복원되고 이어서 추론함
    const firstUserMsgForTitle = updatedMessagesWithUser.find((m) => m.role === 'user');
    const sessionTitleEarly = firstUserMsgForTitle
      ? firstUserMsgForTitle.content.slice(0, 18) + (firstUserMsgForTitle.content.length > 18 ? '...' : '')
      : '새로운 로컬 대화';
    if (!initialSessionId) {
      setCurrentChatTitle(sessionTitleEarly);
    }
    getStorage().saveSession({
      id: curSessionId,
      title: sessionTitleEarly,
      status: 'active',
      modelId: 'litert-gemma-4-e4b',
      createdAt: curCreatedAt || Date.now(),
      updatedAt: Date.now(),
      messages: msgsWithThinking as any,
    }).then(() => loadSessions()).catch((e) => console.error('[ChatRoom] 추론 전 저장 실패:', e));

    try {
      // 3. 모델 준비 대기 후 스트리밍
      await getModelAdapter().waitForReady();
      const responseStream = getModelAdapter().stream(updatedMessagesWithUser);

      let accumulatedText = '';
      for await (const chunk of responseStream) {
        if (chunk.type === 'text-delta') {
          accumulatedText += chunk.text;
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMsgId
                ? { ...msg, content: accumulatedText, isThinking: false }
                : msg
            )
          );
        }
      }

      // 4. 추론 완료 or 중단 후 스트림 종료
      //    isInterruptedRef가 true면 중단된 것이므로 isInterrupted 플래그 포함
      const wasInterrupted = isInterruptedRef.current;
      isInterruptedRef.current = false; // 리셋

      const completedAssistantMsg: DisplayMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: accumulatedText,
        timestamp: Date.now(),
        isThinking: false,
        ...(wasInterrupted ? { isInterrupted: true } : {}),
      };

      const finalMessages: DisplayMessage[] = [...updatedMessagesWithUser, completedAssistantMsg];
      setMessages(finalMessages);

      // 5. 완료된 세션 최종 저장
      const firstUserMsg = finalMessages.find((m) => m.role === 'user');
      const sessionTitle = firstUserMsg
        ? firstUserMsg.content.slice(0, 18) + (firstUserMsg.content.length > 18 ? '...' : '')
        : '새로운 로컬 대화';

      await getStorage().saveSession({
        id: curSessionId,
        title: sessionTitle,
        status: 'active',
        modelId: 'litert-gemma-4-e4b',
        createdAt: curCreatedAt || Date.now(),
        updatedAt: Date.now(),
        messages: finalMessages,
      });
      await loadSessions();
    } catch (error) {
      console.error('Error during streaming', error);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMsgId
            ? { ...msg, content: '죄송합니다. 답변 생성 도중 로컬 추론 오류가 발생했습니다.', isThinking: false }
            : msg
        )
      );
      // 에러 상태도 storage에 반영
      const errMsgs = msgsWithThinking.map((msg) =>
        msg.id === assistantMsgId
          ? { ...msg, content: '죄송합니다. 답변 생성 도중 로컬 추론 오류가 발생했습니다.', isThinking: false }
          : msg
      );
      getStorage().saveSession({
        id: curSessionId,
        title: sessionTitleEarly,
        status: 'active',
        modelId: 'litert-gemma-4-e4b',
        createdAt: curCreatedAt || Date.now(),
        updatedAt: Date.now(),
        messages: errMsgs as any,
      }).then(() => loadSessions()).catch(() => {});
    } finally {
      setIsGenerating(false);
    }
  };

  // ── 생성 중단(Interrupt) 핸들러 ──────────────────────────────────────────────
  const handleInterrupt = async () => {
    console.log(`[LiteRTPerf] ⏹ Stop button tapped at ${Date.now()}`);
    console.log('[ChatRoom] Interrupt requested');

    // sendMessage 완료 코드가 이 값을 보고 isInterrupted를 포함시킴
    isInterruptedRef.current = true;

    // 낙관적 UI 업데이트: 즉시 생성 중단 상태로 전환
    setIsGenerating(false);
    // [전략 A 추가] 네이티브의 onGenerationInterrupted 이벤트를 기다리지 않고
    // 여기서도 즉시 isSettling을 켜서 탭 반응성을 최대한 빠르게 만든다.
    // (실제 해제는 onGenerationSettled 수신 시점에만 일어난다)
    setIsSettling(true);

    // 핵심 수정: isThinking은 첫 토큰이 도착하는 즉시 false가 되므로
    // isThinking 조건으로는 절대 매칭되지 않음.
    // 대신 리스트 맨 마지막 assistant 메시지(= 현재 스트리밍 중인 버블)를 찾아 표시.
    setMessages(prev => {
      // 뒤에서부터 첫 번째 assistant 메시지 인덱스를 찾음
      let lastAssistantIdx = -1;
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].role === 'assistant') {
          lastAssistantIdx = i;
          break;
        }
      }
      if (lastAssistantIdx === -1) return prev;
      return prev.map((m, idx) =>
        idx === lastAssistantIdx
          ? { ...m, isThinking: false, isInterrupted: true }
          : m
      );
    });

    // [전략 B 추가] 네이티브 중단 호출 — adapter가 내부적으로
    // "아직 prefill 중이면 예약만 하고, 첫 토큰 도착 시 실제 실행"하도록 처리한다.
    // interrupt()는 인터페이스 계약(Promise<void>)을 지키므로,
    // 예약 여부는 별도 getter(wasInterruptDeferred)로 즉시 확인한다.
    try {
      await getModelAdapter().interrupt();
      if (getModelAdapter().wasInterruptDeferred) {
        console.log('[ChatRoom] ⏳ Interrupt deferred until TTFT (still in prefill)');
        setIsDeferredStop(true);
      }
    } catch (e) {
      console.error('[ChatRoom] Interrupt failed:', e);
    }

    // 중단 상태를 세션에 저장
    const curSessionId = activeSessionIdRef.current;
    const curCreatedAt = sessionCreatedAtRef.current;
    if (curSessionId) {
      const raw = messagesRef.current;
      let lastAsstIdx = -1;
      for (let i = raw.length - 1; i >= 0; i--) {
        if (raw[i].role === 'assistant') { lastAsstIdx = i; break; }
      }
      const currentMsgs = raw.map((m, idx) =>
        idx === lastAsstIdx
          ? { ...m, isThinking: false, isInterrupted: true }
          : m
      );
      const firstUserMsg = currentMsgs.find(m => m.role === 'user');
      const sessionTitle = firstUserMsg
        ? firstUserMsg.content.slice(0, 18) + (firstUserMsg.content.length > 18 ? '...' : '')
        : '채팅 세션';
      getStorage().saveSession({
        id: curSessionId,
        title: sessionTitle,
        status: 'active',
        modelId: 'litert-gemma-4-e4b',
        createdAt: curCreatedAt || Date.now(),+
        updatedAt: Date.now(),
        messages: currentMsgs as any,
      }).then(() => loadSessions()).catch(e => console.error('[ChatRoom] 중단 저장 실패:', e));
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* 커스텀 네비게이션 헤더 */}
      <ChatHeader
        onPressMenu={handleHeaderMenu}
        onPressModel={handleHeaderModel}
        onPressNewChat={handleHeaderNewChat}
        onPressMore={handleHeaderMore}
        modelName="Gemma4-e4b"
      />

      {/* 모델 상태 배너 (헤더 바로 아래에 배치) */}
      <View style={[styles.modelStatusHeader, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <View style={styles.statusIndicatorContainer}>
          <View
            style={[
              styles.statusDot,
              modelState.status === 'downloading' ? styles.statusDotLoading : 
              modelState.status === 'ready' ? styles.statusDotReady : 
              { backgroundColor: colors.border }
            ]}
          />
          <Text style={[styles.modelStatusText, { color: colors.text }]}>
            {modelState.status === 'downloading' && `온디바이스 LLM 다운로드 중... (${(modelState as any).progress}%)`}
            {modelState.status === 'loading' && '모델 메모리 적재 중...'}
            {/* [전략 B 추가] prefill 중 정지 눌러서 아직 실제 중단이 예약된 상태 */}
            {modelState.status === 'ready' && isDeferredStop && '정지 예약됨 · 첫 응답 대기 중...'}
            {/* [전략 A 추가] 정지 후 백그라운드 정리 중임을 사용자에게 알림 */}
            {modelState.status === 'ready' && !isDeferredStop && isSettling && '이전 응답 정리 중...'}
            {modelState.status === 'ready' && !isDeferredStop && !isSettling && 'Gemma 4 E4B (Local 추론 준비 완료)'}
            {modelState.status === 'idle' && '대기 중...'}
          </Text>
        </View>
        {modelState.status === 'downloading' && (
          <View style={styles.progressBarBg}>
            <View style={[styles.progressBarFill, { width: `${(modelState as any).progress}%` }]} />
          </View>
        )}
      </View>

      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior="padding"
        keyboardVerticalOffset={0}
      >
        <View style={styles.innerContainer}>

          {messages.length === 0 ? (
            <View style={styles.emptyStateContainer}>
              <Sparkles size={48} color="#0b57d0" />
              <Text style={styles.emptyStateGreeting}>대화를 시작해 볼까요?</Text>
            </View>
          ) : (
            <FlatList
              style={{ flex: 1 }}
              ref={flatListRef}
              data={messages}
              keyExtractor={(item) => item.id || ''}
              // paddingBottom은 버블 목록 자체의 여백만 (16px).
              // 입력창이 flex 흐름에 있으므로 동적 보정 불필요.
              contentContainerStyle={styles.messageList}
              onScroll={handleScroll}
              scrollEventThrottle={16}
              renderItem={({ item }) => {
                if (item.role === 'assistant') {
                  return <AIMessageBubble message={item} />;
                }
                return <UserMessageBubble message={item} />;
              }}
            />
          )}

          {showScrollBottom && (
            <TouchableOpacity 
              style={[
                styles.scrollToBottomFab,
                { 
                  bottom: bottomOffset + inputHeight + 16
                }
              ]}
              onPress={() => {
                setShowScrollBottom(false);
                flatListRef.current?.scrollToEnd({ animated: true });
              }}
            >
              <Text style={styles.scrollToBottomIcon}>↓</Text>
            </TouchableOpacity>
          )}

          <View 
            onLayout={(e) => setInputHeight(e.nativeEvent.layout.height)}
            style={[
            styles.floatingInputWrapper, 
            { 
              paddingBottom: bottomOffset,
            }
          ]}>
            {pendingAttachments.length > 0 && (
              <ScrollView 
                horizontal 
                showsHorizontalScrollIndicator={false}
                style={styles.attachmentsPreviewContainer}
                contentContainerStyle={styles.attachmentsPreviewContent}
              >
                {pendingAttachments.map((attachment: Attachment) => (
                  <View key={attachment.id} style={styles.attachmentPreviewItem}>
                    {attachment.type === 'image' ? (
                      <Image source={{ uri: attachment.uri }} style={styles.attachmentPreviewImage} />
                    ) : (
                      <View style={styles.attachmentPreviewDoc}>
                        <Text style={styles.attachmentPreviewDocIcon}>📄</Text>
                      </View>
                    )}
                    <TouchableOpacity 
                      style={styles.attachmentRemoveBtn}
                      onPress={() => removeAttachment(attachment.id)}
                    >
                      <Text style={styles.attachmentRemoveText}>✕</Text>
                    </TouchableOpacity>
                    <Text style={styles.attachmentPreviewName} numberOfLines={1}>
                      {attachment.name}
                    </Text>
                  </View>
                ))}
              </ScrollView>
            )}

            {/* [전략 A 추가] isSettling 상태를 disabled 스타일/조건에도 함께 반영 */}
            <View style={[styles.floatingPill, (isGenerating || isSettling) && styles.disabledFloatingPill]}>
              <TouchableOpacity 
                style={styles.plusButton} 
                onPress={handleAttachment}
                disabled={isGenerating || isSettling}
              >
                <Plus size={24} color="#5f6368" />
              </TouchableOpacity>
              
              <TextInput
                style={[styles.pillInput, (isGenerating || isSettling) && styles.disabledPillInput]}
                value={inputText}
                onChangeText={setInputText}
                placeholder={isSettling ? '이전 응답 정리 중입니다...' : '무엇이든 물어보세요..'}
                placeholderTextColor="#8e9eab"
                multiline
                editable={modelState.status === 'ready' && !isGenerating && !isSettling}
              />

              {isGenerating ? (
                <TouchableOpacity
                  style={styles.pillStopButton}
                  onPress={handleInterrupt}
                >
                  <Square size={16} color="#ffffff" fill="#ffffff" />
                </TouchableOpacity>
              ) : inputText.trim() ? (
                <TouchableOpacity
                  style={[
                    styles.pillSendButton,
                    (modelState.status !== 'ready' || isSettling) && styles.disabledSendButton,
                  ]}
                  onPress={sendMessage}
                  disabled={modelState.status !== 'ready' || isSettling}
                >
                  <Text style={styles.pillSendIcon}>↑</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* Safe Area 고정 여백: 
          KAV 밖에서 안전영역을 잡아줌으로써, 키보드가 열릴 때 KAV가 정확히 
          (키보드 높이 - 안전영역) 만큼만 패딩을 올리도록 유도합니다. 
          안드로이드의 네비게이션바 오버랩 문제도 방지합니다. */}
      {!isKeyboardVisible && insets.bottom > 0 && (
        <View style={{ height: insets.bottom }} />
      )}

      {/* 바텀시트 UI */}
      <ChatBottomSheet
        ref={bottomSheetRef}
        onRename={handleRename}
        onDelete={handleDelete}
      />

      {/* 이름 변경 모달 */}
      <RenameChatModal
        visible={isRenameModalVisible}
        currentTitle={currentChatTitle}
        onClose={() => setIsRenameModalVisible(false)}
        onRename={handleRenameSave}
      />

      {/* 삭제 확인 모달 */}
      <DeleteConfirmModal
        visible={isDeleteModalVisible}
        onClose={() => setIsDeleteModalVisible(false)}
        onDelete={handleDeleteConfirm}
      />
    </View>
  );
}

// 사용자 버블 (더보기 지원)
const UserMessageBubble = ({ message }: { message: DisplayMessage }) => {
  const [expanded, setExpanded] = useState(false);
  const [isTruncated, setIsTruncated] = useState(false);

  const handleTextLayout = (e: any) => {
    if (!expanded && e.nativeEvent.lines.length > 6) {
      setIsTruncated(true);
    }
  };

  return (
    <View style={styles.bubbleWrapperContainer}>
      <View style={[styles.messageBubble, styles.userBubble]}>
        {message.attachments && message.attachments.length > 0 && (
          <View style={styles.bubbleAttachmentsContainer}>
            {message.attachments.map((attachment: Attachment) => (
              <View key={attachment.id} style={styles.bubbleAttachmentItem}>
                {attachment.type === 'image' ? (
                  <Image source={{ uri: attachment.uri }} style={styles.bubbleAttachmentImage} />
                ) : (
                  <View style={styles.bubbleAttachmentDoc}>
                    <Text style={styles.bubbleAttachmentDocIcon}>📄</Text>
                    <Text style={styles.bubbleAttachmentDocName} numberOfLines={1}>{attachment.name}</Text>
                  </View>
                )}
              </View>
            ))}
          </View>
        )}
        {message.content ? (
          <>
            <Text 
              style={styles.messageText} 
              numberOfLines={expanded ? undefined : 6}
              onTextLayout={handleTextLayout}
            >
              {message.content}
            </Text>
            {(isTruncated || message.content.length > 150) && !expanded && (
              <TouchableOpacity onPress={() => setExpanded(true)} style={styles.expandUserBubbleBtn}>
                <Text style={styles.expandUserBubbleIcon}>∨</Text>
              </TouchableOpacity>
            )}
            {expanded && (
              <TouchableOpacity onPress={() => setExpanded(false)} style={styles.expandUserBubbleBtn}>
                <Text style={styles.expandUserBubbleIcon}>∧</Text>
              </TouchableOpacity>
            )}
          </>
        ) : null}
      </View>

      {message.content ? (
        <View style={[styles.bubbleActionRow, { alignSelf: 'flex-end', marginRight: 4 }]}>
          <TouchableOpacity onPress={() => {
            Clipboard.setString(message.content || '');
            if (Platform.OS === 'ios') {
              Alert.alert('복사 완료', '채팅 내용이 클립보드에 복사되었습니다.');
            }
          }} style={styles.bubbleActionButton}>
            <Copy size={15} color="#a0a0d0" style={styles.bubbleActionIconSvg} />
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f4f9',
  },
  modelStatusHeader: {
    padding: 12,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  statusIndicatorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  statusDotLoading: {
    backgroundColor: '#ffb900',
  },
  statusDotReady: {
    backgroundColor: '#00e676',
  },
  modelStatusText: {
    color: '#5f6368',
    fontSize: 13,
    fontWeight: '600',
  },
  progressBarBg: {
    height: 3,
    backgroundColor: '#2b2b52',
    borderRadius: 1.5,
    marginTop: 8,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#4e54c8',
  },
  keyboardView: {
    flex: 1,
  },
  innerContainer: {
    flex: 1,
    position: 'relative',
  },
  topBar: {
    position: 'absolute',
    top: 10,
    left: 16,
    zIndex: 10,
  },
  menuButton: {
    padding: 8,
  },
  emptyStateContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyStateGreeting: {
    fontSize: 24,
    fontWeight: '600',
    color: '#202124',
    marginTop: 16,
  },
  messageList: {
    padding: 15,
    // 마지막 버블 아래 복사 버튼 등이 완전히 보이도록 여유 마진 확보
    paddingBottom: 32,
  },
  scrollToBottomFab: {
    position: 'absolute',
    alignSelf: 'center',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
    zIndex: 10,
  },
  scrollToBottomIcon: {
    fontSize: 20,
    color: '#444',
    fontWeight: 'bold',
  },
  // ── 공통 버블 ──
  bubbleWrapperContainer: {
    marginBottom: 16,
    width: '100%',
  },
  messageBubble: {
    borderRadius: 14,
    marginBottom: 4,
    maxWidth: '82%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  // ── 사용자 버블 ──
  userBubble: {
    padding: 14,
    backgroundColor: '#e9eef6',
    alignSelf: 'flex-end',
    borderBottomRightRadius: 2,
  },
  // ── AI 버블 (완전 가변 높이 — 채팅창 전체 스크롤로 탐색) ──
  aiBubble: {
    padding: 14,
    backgroundColor: '#ffffff',
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 2,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  messageText: {
    color: '#202124',
    fontSize: 15,
    lineHeight: 23,
  },
  expandUserBubbleBtn: {
    backgroundColor: '#ffffff',
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  expandUserBubbleIcon: {
    color: '#444',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  bubbleActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bubbleActionButton: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  bubbleActionIconSvg: {
    opacity: 0.85,
  },
  // ── 로딩 점 ──
  thinkingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 16,
    gap: 6,
  },
  thinkingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#7c7cff',
    marginRight: 4,
  },
  thinkingLabel: {
    color: '#6060a0',
    fontSize: 12,
    marginLeft: 4,
    fontStyle: 'italic',
  },
  // ── 플로팅 입력 영역 (Gemini 스타일 Pill) ──
  floatingInputWrapper: {
    // position: 'absolute' 제거 → FlatList가 입력창 위 공간만 차지하게 되어
    // scrollToEnd()가 '입력창 바로 위'를 정확히 타겟팅함.
    // 배경은 투명 유지하여 시각적 플로팅 효과 그대로 살림.
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    width: '100%',
    backgroundColor: 'transparent',
  },
  floatingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 30,
    paddingHorizontal: 8,
    paddingVertical: 6,
    width: '100%',
    // 훨씬 강한 그림자 효과로 떠 있는 느낌(Depth) 완벽하게 구현
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 14,
    elevation: 12,
  },
  disabledFloatingPill: {
    opacity: 0.7,
  },
  plusButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pillInput: {
    flex: 1,
    color: '#202124',
    fontSize: 16,
    paddingHorizontal: 4,
    paddingVertical: 12,
    maxHeight: 120,
    minHeight: 44,
  },
  disabledPillInput: {
    color: '#8e9eab',
  },
  pillSendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#e3f2fd',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 4,
  },
  disabledSendButton: {
    backgroundColor: '#f1f3f4',
  },
  pillSendIcon: {
    color: '#1a73e8', // 선명한 블루 아이콘
    fontSize: 22,
    fontWeight: 'bold',
  },
  pillStopButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#d93025',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 4,
  },
  stoppedNoticeText: {
    // 버블 내부 본문 아래에서 시스템 안내 문구처럼 표시
    // 연한 회색, 작은 폰트로 본문보다 덜 강조
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#d0d0d0',
    color: '#9e9e9e',
    fontSize: 12,
    lineHeight: 16,
    // 다음 새 메시지와의 간격을 확보하는 핵심 여백
    marginBottom: 4,
  },
  attachmentsPreviewContainer: {
    width: '100%',
    marginBottom: 8,
  },
  attachmentsPreviewContent: {
    paddingHorizontal: 4,
    gap: 8,
  },
  attachmentPreviewItem: {
    width: 60,
    alignItems: 'center',
    position: 'relative',
  },
  attachmentPreviewImage: {
    width: 60,
    height: 60,
    borderRadius: 8,
    backgroundColor: '#2e2e5c',
  },
  attachmentPreviewDoc: {
    width: 60,
    height: 60,
    borderRadius: 8,
    backgroundColor: '#2e2e5c',
    justifyContent: 'center',
    alignItems: 'center',
  },
  attachmentPreviewDocIcon: {
    fontSize: 24,
  },
  attachmentRemoveBtn: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#ff4444',
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#fff',
    zIndex: 10,
  },
  attachmentRemoveText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  attachmentPreviewName: {
    color: '#a0a0d0',
    fontSize: 10,
    marginTop: 4,
    textAlign: 'center',
  },
  bubbleAttachmentsContainer: {
    marginBottom: 6,
    gap: 8,
  },
  bubbleAttachmentItem: {
    borderRadius: 8,
    overflow: 'hidden',
  },
  bubbleAttachmentImage: {
    width: 200,
    height: 200,
    borderRadius: 8,
    backgroundColor: '#2e2e5c',
  },
  bubbleAttachmentDoc: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    padding: 8,
    borderRadius: 8,
    gap: 6,
  },
  bubbleAttachmentDocIcon: {
    fontSize: 16,
  },
  bubbleAttachmentDocName: {
    color: '#fff',
    fontSize: 13,
    flexShrink: 1,
  },
});

const dynamicStyles = StyleSheet.create({
  aiBubbleDark: {
    // 순수 검은 배경(#000000)과 구분되는 어두운 회색으로 공간감 부여
    backgroundColor: '#1E1E1E',
    borderColor: '#333333',
  },
});

const markdownStylesLight = StyleSheet.create({
  body: { color: '#202124', fontSize: 15, lineHeight: 24 },
  heading1: { color: '#000000', fontSize: 22, fontWeight: 'bold', marginTop: 16, marginBottom: 10 },
  heading2: { color: '#000000', fontSize: 20, fontWeight: 'bold', marginTop: 14, marginBottom: 8 },
  heading3: { color: '#202124', fontSize: 18, fontWeight: '600', marginTop: 12, marginBottom: 6 },
  strong: { fontWeight: 'bold', color: '#0b57d0' },
  em: { fontStyle: 'italic', color: '#5f6368' },
  code_inline: { backgroundColor: '#f1f3f4', color: '#d93025', borderRadius: 4, paddingHorizontal: 4 },
  code_block: { backgroundColor: '#f8f9fa', color: '#202124', padding: 12, borderRadius: 8, marginVertical: 10, borderWidth: 1, borderColor: '#e5e7eb' },
  fence: { backgroundColor: '#f8f9fa', color: '#202124', padding: 12, borderRadius: 8, marginVertical: 10, borderWidth: 1, borderColor: '#e5e7eb' },
  blockquote: { borderLeftWidth: 4, borderLeftColor: '#0b57d0', paddingLeft: 12, marginLeft: 0, marginVertical: 8, opacity: 0.9 },
  link: { color: '#0b57d0', textDecorationLine: 'underline' },
  bullet_list: { marginVertical: 6 },
  ordered_list: { marginVertical: 6 },
});

const markdownStylesDark = StyleSheet.create({
  // 오프화이트 텍스트로 눈부심 방지 및 가독성 확보
  body: { color: '#E0E0E0', fontSize: 15, lineHeight: 24 },
  heading1: { color: '#F5F5F5', fontSize: 22, fontWeight: 'bold', marginTop: 16, marginBottom: 10 },
  heading2: { color: '#F5F5F5', fontSize: 20, fontWeight: 'bold', marginTop: 14, marginBottom: 8 },
  heading3: { color: '#E0E0E0', fontSize: 18, fontWeight: '600', marginTop: 12, marginBottom: 6 },
  strong: { fontWeight: 'bold', color: '#90caf9' },
  em: { fontStyle: 'italic', color: '#b0b0d0' },
  code_inline: { backgroundColor: '#2a2a4a', color: '#ffab91', borderRadius: 4, paddingHorizontal: 4 },
  code_block: { backgroundColor: '#1E1E1E', color: '#a9b7c6', padding: 12, borderRadius: 8, marginVertical: 10, borderWidth: 1, borderColor: '#333333' },
  fence: { backgroundColor: '#1E1E1E', color: '#a9b7c6', padding: 12, borderRadius: 8, marginVertical: 10, borderWidth: 1, borderColor: '#333333' },
  blockquote: { borderLeftWidth: 4, borderLeftColor: '#3f51b5', paddingLeft: 12, marginLeft: 0, marginVertical: 8, opacity: 0.9 },
  link: { color: '#64b5f6', textDecorationLine: 'underline' },
  bullet_list: { marginVertical: 6 },
  ordered_list: { marginVertical: 6 },
});