import { useState, useEffect, useRef } from 'react';
import { 
  MODEL_REGISTRY, 
  type ChatMessage, 
  type ModelSpec
} from '@repo/ai-core';
import { 
  type ChatSession, 
  type ChatSessionSummary, 
  type ChatPhase 
} from '@repo/chat-state';
import { 
  type AuthSession
} from '@repo/auth-shared';
import { buildWebSearchContext } from '@repo/prompt-kit';

import { LiteRTLMAdapter } from './adapters/LiteRTLMAdapter';
import { WebStorageAdapter } from './adapters/WebStorageAdapter';
import { WebAuthAdapter } from './adapters/WebAuthAdapter';
import { WebRemoteChatAdapter } from './adapters/WebRemoteChatAdapter';

import { ChatBubble } from './components/ChatBubble';
import { AttachmentPreview } from './components/AttachmentPreview';
import { SocialLogin } from './components/SocialLogin';
import { ModelLoadingOverlay } from './components/ModelLoadingOverlay';
import { ModelGalleryModal } from './components/ModelGalleryModal';
import { useTheme } from './context/ThemeContext';
import { useFileAttachment } from './hooks/useFileAttachment';

import './App.css';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

// 1. 공통 어댑터 인스턴스 싱글톤 생성
const llmAdapter = new LiteRTLMAdapter();
const storageAdapter = new WebStorageAdapter();
const authAdapter = new WebAuthAdapter();
const remoteChatAdapter = new WebRemoteChatAdapter(authAdapter);


export default function App() {
  // WebGPU 진단 상태
  const [webGpuState, setWebGpuState] = useState<{
    supported: boolean | null;
    adapterInfo: string | null;
    error: string | null;
  }>({ supported: null, adapterInfo: null, error: null });

  const { isDarkMode, setDarkMode } = useTheme();

  // 모델 로드 및 선택 상태
  // 공통 MODEL_REGISTRY에서 첫 번째 모델의 실제 WebLLM 런타임 모델 ID를 초기값으로 지정합니다.
  const initialModelId = 'gemma4-e2b';
  const [selectedModelId, setSelectedModelId] = useState(initialModelId);
  const [loadedModelId, setLoadedModelId] = useState<string | null>(null);

  // 세션 및 상태 머신(ChatPhase) 상태
  const [sessionList, setSessionList] = useState<ChatSessionSummary[]>([]);
  const [currentSession, setCurrentSession] = useState<ChatSession | null>(null);
  const [chatPhase, setChatPhase] = useState<ChatPhase>('idle');

  // 대화 및 입력 상태
  const [systemPrompt, setSystemPrompt] = useState('You are a helpful local-first AI assistant running entirely in the browser using WebGPU.');
  const [input, setInput] = useState('');
  const [generationStats, setGenerationStats] = useState<{
    ttftMs?: number;
    tokensPerSec?: number;
    totalTokens?: number;
    totalMs?: number;
  }>({ });
  
  // 인증 세션 상태
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);

  // 프로필 이미지 로드 에러 추적 (네이버 등에서 Tracking Prevention으로 차단되는 경우 대응)
  const [imageLoadErrors, setImageLoadErrors] = useState<Record<string, boolean>>({});

  // IndexedDB 대용량 벤치마크 상태 및 로그인 상태 제거됨 (미니멀 UI를 위해 제거)
  
  // Ref 관리
  const chatEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // 사이드바 토글 상태 (모바일 브라우저에서는 기본 비활성화 false, PC에서는 활성화 true)
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth >= 768;
    }
    return true;
  });

  // 설정 모달 상태
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState<'general' | 'theme' | 'terms'>('general');

  // AI 모델 갤러리 모달 상태
  const [isModelGalleryOpen, setIsModelGalleryOpen] = useState(false);

  // 소셜 로그인 화면 상태
  const [isLoginScreenOpen, setIsLoginScreenOpen] = useState(false);

  // 웹 검색(SearXNG RAG) 토글 상태
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);

  // 첨부파일 훅
  const {
    pendingAttachments,
    imageInputRef,
    documentInputRef,
    triggerImageSelect,
    triggerDocumentSelect,
    handleImageFiles,
    handleDocumentFiles,
    removeAttachment,
    clearAttachments,
  } = useFileAttachment();

  // 첨부 메뉴 상태
  const [isAttachMenuOpen, setIsAttachMenuOpen] = useState(false);
  const attachMenuRef = useRef<HTMLDivElement>(null);

  // 첨부 메뉴 외부 클릭 감지
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) {
        setIsAttachMenuOpen(false);
      }
    };
    if (isAttachMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isAttachMenuOpen]);

  // 계정 관리 팝업 상태
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);

  // 계정 관리 팝업 외부 클릭 감지
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(e.target as Node)) {
        setIsAccountMenuOpen(false);
      }
    };
    if (isAccountMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isAccountMenuOpen]);

  // 모바일 사이드바 드로어 오픈 시 본문 스크롤 방지 (overflow-hidden)
  useEffect(() => {
    const handleScrollLock = () => {
      if (isSidebarOpen && window.innerWidth < 768) {
        document.body.classList.add('overflow-hidden');
      } else {
        document.body.classList.remove('overflow-hidden');
      }
    };

    handleScrollLock();
    window.addEventListener('resize', handleScrollLock);

    return () => {
      document.body.classList.remove('overflow-hidden');
      window.removeEventListener('resize', handleScrollLock);
    };
  }, [isSidebarOpen]);

  // textarea 높이 조절
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const handleInputInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = '24px';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  };

  // 1. 초기 진단 및 기기 어댑터 바인딩
  useEffect(() => {
    const initDiagnostics = async () => {
      // Safari는 WebGPU(navigator.gpu) 객체가 존재하더라도 아직 LLM 추론에 필요한 
      // compute shader 등 전체 스펙을 온전히 지원하지 못해 런타임 에러가 발생합니다.
      const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

      if (!navigator.gpu || isSafari) {
        setWebGpuState({
          supported: false,
          adapterInfo: null,
          error: isSafari 
            ? 'Safari는 아직 WebGPU를 온전히 지원하지 않습니다. Chrome 브라우저를 권장합니다.'
            : '이 브라우저는 WebGPU API를 지원하지 않습니다. 최신 Chromium 브라우저를 사용하세요.'
        });
      } else {
        try {
          const adapter = await navigator.gpu.requestAdapter();
          if (adapter) {
            setWebGpuState({ supported: true, adapterInfo: 'WebGPU 획득 성공 (하드웨어 가속 가능)', error: null });
          } else {
            setWebGpuState({ supported: false, adapterInfo: null, error: 'WebGPU 어댑터 획득에 실패했습니다.' });
          }
        } catch (e: any) {
          setWebGpuState({ supported: false, adapterInfo: null, error: `초기화 실패: ${e?.message || e}` });
        }
      }

      await refreshSessionList();

      authAdapter.onAuthStateChange((session) => {
        setAuthSession(session);
      });

      llmAdapter.onLoadStateChange((state) => {
        if (state.status === 'ready') {
          setChatPhase('idle');
        } else if (state.status === 'error') {
          setChatPhase('model-error');
        } else if (state.status === 'downloading' || state.status === 'loading') {
          setChatPhase('model-loading');
        }
      });
    };

    initDiagnostics();
  }, []);

  // 대화 및 스냅 자동 스크롤
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentSession?.messages, chatPhase]);

  // 오프라인/재연결 시 펜딩 데이터 통합 재시도 함수 (인증 가드 포함)
  const retryPendingSync = async () => {
    const session = await authAdapter.getSession();
    if (!session?.isAuthenticated) return;

    try {
      const summaries = await storageAdapter.listSessions();
      for (const summary of summaries) {
        const chatSession = await storageAdapter.loadSession(summary.id);
        if (!chatSession) continue;

        let sessionReady = true;

        if (chatSession.sessionSyncStatus === 'pending') {
          try {
            await remoteChatAdapter.createSession({
              id: chatSession.id,
              title: chatSession.title,
              model_id: chatSession.modelId,
              created_at: new Date(chatSession.createdAt).toISOString(),
              updated_at: new Date(chatSession.updatedAt).toISOString(),
            });
            chatSession.sessionSyncStatus = 'synced';
            await storageAdapter.saveSession(chatSession);
          } catch (e: any) {
            if (e.message?.includes('410')) {
              await storageAdapter.deleteSession(chatSession.id);
              continue;
            }
            console.warn(`[Web retryPendingSync] 세션 ${chatSession.id} 생성 실패:`, e);
            sessionReady = false;
          }
        }

        if (!sessionReady) continue;

        let hasUpdates = false;
        const pendingMsgs = chatSession.messages.filter(m => m.syncStatus === 'pending');
        for (const msg of pendingMsgs) {
          try {
            await remoteChatAdapter.postMessage(chatSession.id, {
              id: msg.id,
              role: msg.role,
              content: msg.content,
              created_at: new Date(msg.timestamp).toISOString(),
            });
            msg.syncStatus = 'synced';
            hasUpdates = true;
          } catch (e) {
            console.warn(`[Web retryPendingSync] 메시지 ${msg.id} 전송 실패:`, e);
            break;
          }
        }

        if (hasUpdates) {
          await storageAdapter.saveSession(chatSession);
        }
      }
    } catch (e) {
      console.warn('[Web retryPendingSync] 오류:', e);
    }
  };

  // 2. 세션 리스트 갱신 함수 (원격 서버 목록 동기화 포함)
  const refreshSessionList = async () => {
    const session = await authAdapter.getSession();
    if (session?.isAuthenticated) {
      // 1회성 마이그레이션 (유저별 lastSyncedAt 체크)
      const lastSyncedKey = `web_lastSyncedAt_${session.user.id}`;
      const lastSyncedAt = localStorage.getItem(lastSyncedKey);
      if (!lastSyncedAt) {
        const localList = await storageAdapter.listSessions();
        const syncPayload = [];
        for (const s of localList) {
          const loaded = await storageAdapter.loadSession(s.id);
          if (loaded) {
            syncPayload.push({
              id: loaded.id,
              title: loaded.title,
              model_id: loaded.modelId,
              status: loaded.status,
              created_at: new Date(loaded.createdAt).toISOString(),
              updated_at: new Date(loaded.updatedAt).toISOString(),
              messages: loaded.messages.map(m => ({
                id: m.id,
                role: m.role,
                content: m.content,
                created_at: new Date(m.timestamp).toISOString(),
              })),
            });
          }
        }
        if (syncPayload.length > 0) {
          try {
            await remoteChatAdapter.syncPush(syncPayload);
          } catch (e) {
            console.warn('[Web refreshSessionList] syncPush 실패:', e);
          }
        }
        localStorage.setItem(lastSyncedKey, Date.now().toString());
      }

      try {
        const remoteSessions = await remoteChatAdapter.fetchSessions();
        const localList = await storageAdapter.listSessions();
        const localMap = new Map(localList.map(s => [s.id, s]));
        const remoteMap = new Map(remoteSessions.map(s => [s.id, s]));

        // 1. 서버 세션 로컬 반영/업데이트
        for (const rs of remoteSessions) {
          const createdAt = new Date(rs.created_at).getTime();
          const updatedAt = new Date(rs.updated_at).getTime();
          if (!localMap.has(rs.id)) {
            const newLocalSession: ChatSession = {
              id: rs.id,
              title: rs.title,
              status: (rs.status as any) || 'active',
              messages: [],
              modelId: rs.model_id || initialModelId,
              createdAt,
              updatedAt,
              sessionSyncStatus: 'synced',
            };
            await storageAdapter.saveSession(newLocalSession);
          } else {
            const existing = await storageAdapter.loadSession(rs.id);
            if (existing && (existing.title !== rs.title || existing.updatedAt !== updatedAt)) {
              existing.title = rs.title;
              existing.updatedAt = updatedAt;
              await storageAdapter.saveSession(existing);
            }
          }
        }

        // 2. 서버에서 소프트 삭제된 세션 로컬 정리
        for (const ls of localList) {
          if (!remoteMap.has(ls.id)) {
            const fullLocal = await storageAdapter.loadSession(ls.id);
            if (fullLocal?.sessionSyncStatus !== 'pending') {
              await storageAdapter.deleteSession(ls.id);
            }
          }
        }

      } catch (e) {
        console.warn('[Web refreshSessionList] 원격 세션 목록 로드 실패, 로컬 사용:', e);
      }
    }

    const list = await storageAdapter.listSessions();
    setSessionList(list);
  };


  // online / visibilitychange / authStateChange / OAuth callback 이벤트 연동
  useEffect(() => {
    // OAuth 리디렉트 콜백 파라미터 처리 (?auth_code=... 또는 ?code=...)
    const urlParams = new URLSearchParams(window.location.search);
    const authCode = urlParams.get('auth_code') || urlParams.get('code');
    const authState = urlParams.get('auth_state') || urlParams.get('state');
    const authError = urlParams.get('auth_error') || urlParams.get('error');

    if (authCode || authError) {
      const payload = {
        type: 'OAUTH_CALLBACK',
        code: authCode,
        state: authState,
        error: authError,
        timestamp: Date.now()
      };
      
      try {
        const bc = new BroadcastChannel('oauth_channel');
        bc.postMessage(payload);
        setTimeout(() => { try { bc.close(); } catch(e){} }, 1000);
      } catch (e) {}

      try {
        localStorage.setItem('oauth_callback_data', JSON.stringify(payload));
      } catch (e) {}

      if (window.opener || window.name === 'oauth_popup') {
        setTimeout(() => {
          try { window.close(); } catch (e) {}
        }, 500);
      }

      window.history.replaceState({}, document.title, window.location.pathname);
    }

    const handleOnline = () => {
      retryPendingSync().then(() => refreshSessionList());
    };
    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        retryPendingSync().then(() => refreshSessionList());
      }
    };

    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);

    const unsubscribeAuth = authAdapter.onAuthStateChange((s) => {
      setAuthSession(s);
      if (s?.isAuthenticated) {
        refreshSessionList().then(() => retryPendingSync());
      }
    });

    return () => {
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      unsubscribeAuth();
    };

  }, []);

  // 3. 모델 로드 트리거
  const handleLoadModel = async (overrideModelId?: string) => {
    if (chatPhase === 'model-loading') {
      console.warn('[handleLoadModel] Already loading a model, ignoring concurrent request.');
      return;
    }
    setChatPhase('model-loading');
    setLoadedModelId(null);
    setGenerationStats({});

    const targetModelId = overrideModelId || selectedModelId;
    const actualModelId = MODEL_REGISTRY[targetModelId] ? targetModelId : initialModelId;
    setSelectedModelId(actualModelId);

    const spec: ModelSpec = MODEL_REGISTRY[actualModelId]?.spec || {
      id: actualModelId,
      family: 'gemma',
      variant: '4-e4b',
      contextWindow: 32768
    };

    try {
      await llmAdapter.init(spec);
      const loadedModelName = MODEL_REGISTRY[actualModelId]?.label || actualModelId;
      console.log(`[LiteRTLMAdapter] ${loadedModelName}가 로드 완료되었습니다.`);
      setLoadedModelId(actualModelId);
      setSelectedModelId(actualModelId);
      setChatPhase('idle');
      toast.dismiss('model-load');
      toast.success('AI 모델이 성공적으로 로드되었습니다.', { toastId: 'model-load' });
      await handleNewSession(true);
    } catch (e: any) {
      console.error(e);
      setChatPhase('model-error');
      toast.dismiss('model-load');
      toast.error('모델 로딩 중 오류가 발생했습니다.', { toastId: 'model-load' });
    }
  };

  // 3-1. 모델 로드 취소
  const handleCancelLoadModel = async () => {
    try {
      await llmAdapter.unload();
    } catch (e) {}
    setChatPhase('idle');
    setLoadedModelId(null);
    toast.dismiss('model-load');
    toast.info('모델 로딩이 취소되었습니다.');
  };

  // 4. 새 세션 시작
  const handleNewSession = async (silent: boolean | React.MouseEvent = false) => {
    const isSilent = silent === true;
    // 중복 생성 방지: 이미 빈 채팅('새로운 대화')이 존재하면 재사용
    const existingEmptySessionInfo = sessionList.find(s => s.title === '새로운 대화');
    if (existingEmptySessionInfo) {
      if (currentSession?.id !== existingEmptySessionInfo.id) {
        await handleRestoreSession(existingEmptySessionInfo.id);
      }
      return;
    }

    const newSession: ChatSession = {
      id: `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      title: '새로운 대화',
      status: 'active',
      messages: [{ id: 'sys_0', role: 'system', content: systemPrompt, timestamp: Date.now(), syncStatus: 'synced' }],
      modelId: selectedModelId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sessionSyncStatus: 'pending',
    };
    
    // 새 세션 시작 시 LLM 대화 컨텍스트 리셋
    llmAdapter.resetConversation?.();

    const authSession = await authAdapter.getSession();
    if (authSession?.isAuthenticated) {
      try {
        await remoteChatAdapter.createSession({
          id: newSession.id,
          title: newSession.title,
          model_id: newSession.modelId,
          created_at: new Date(newSession.createdAt).toISOString(),
          updated_at: new Date(newSession.updatedAt).toISOString(),
        });
        newSession.sessionSyncStatus = 'synced';
      } catch (e) {
        console.warn('[handleNewSession] 원격 세션 생성 실패 (로컬 펜딩):', e);
      }
    }

    await storageAdapter.saveSession(newSession);
    setCurrentSession(newSession);
    await refreshSessionList();
    
    if (!isSilent) {
      toast.dismiss('session-action');
      toast.success('새 채팅이 시작되었습니다.', { toastId: 'session-action' });
    }
  };

  // 5. 대화 세션 복원 (원격 메시지 동기화 포함)
  const handleRestoreSession = async (sessionId: string) => {
    if (chatPhase === 'generating') return;
    let session = await storageAdapter.loadSession(sessionId);
    
    const authSess = await authAdapter.getSession();
    if (authSess?.isAuthenticated) {
      if (!session) {
        const item = sessionList.find(s => s.id === sessionId);
        session = {
          id: sessionId,
          title: item?.title || '대화 세션',
          status: 'active',
          messages: [],
          modelId: item?.modelId || initialModelId,
          createdAt: item?.createdAt || Date.now(),
          updatedAt: item?.updatedAt || Date.now(),
          sessionSyncStatus: 'synced',
        };
      }
      try {
        const remoteMsgs = await remoteChatAdapter.fetchMessages(sessionId);
        if (remoteMsgs && remoteMsgs.length > 0) {
          const restoredMsgs = remoteMsgs.map(rm => ({
            id: rm.id,
            role: rm.role as any,
            content: rm.content,
            timestamp: new Date(rm.created_at).getTime(),
            syncStatus: 'synced' as const,
          }));
          if (session) {
            session = { ...session, messages: restoredMsgs, sessionSyncStatus: 'synced' };
            await storageAdapter.saveSession(session);
          }
        }
      } catch (e) {
        console.warn('[handleRestoreSession] 원격 메시지 로드 실패 (로컬 사용):', e);
      }
    }


    if (session) {
      setCurrentSession(session);
      const isValidModel = !!MODEL_REGISTRY[session.modelId];
      const newModelId = isValidModel ? session.modelId : initialModelId;
      if (loadedModelId !== newModelId) {
        setSelectedModelId(newModelId);
      }
      llmAdapter.resetConversation?.();
    }
  };

  // 6. 대화 세션 소프트 삭제
  const handleDeleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (chatPhase === 'generating') return;
    
    await storageAdapter.deleteSession(sessionId);

    const authSess = await authAdapter.getSession();
    if (authSess?.isAuthenticated) {
      try {
        await remoteChatAdapter.deleteSession(sessionId);
      } catch (err) {
        console.warn('[handleDeleteSession] 원격 세션 삭제 실패:', err);
      }
    }

    if (currentSession?.id === sessionId) {
      setCurrentSession(null);
    }
    await refreshSessionList();
    toast.dismiss('session-action');
    toast.success('채팅방이 삭제되었습니다.', { toastId: 'session-action' });
  };


  // 7. 메시지 전송 및 스트리밍 추론 루프
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!loadedModelId) return;
    if (chatPhase === 'generating') return;

    const hasAttachments = pendingAttachments.length > 0;

    if (!input.trim() && !hasAttachments) {
      toast.dismiss('empty-input');
      toast.warning('입력창이 비어 있습니다.', { toastId: 'empty-input' });
      return;
    }

    const promptText = input.trim();
    const sentAttachments = hasAttachments ? [...pendingAttachments] : undefined;
    setInput('');
    clearAttachments();
    setChatPhase('generating');
    setGenerationStats({});

    if (!currentSession) return;

    const userMsg: ChatMessage & { syncStatus?: 'pending' | 'synced' } = {
      id: `msg_${Date.now()}_u`,
      role: 'user',
      content: promptText,
      attachments: sentAttachments,
      timestamp: Date.now(),
      syncStatus: 'pending',
    };

    const authSess = await authAdapter.getSession();
    if (authSess?.isAuthenticated) {
      try {
        await remoteChatAdapter.postMessage(currentSession.id, {
          id: userMsg.id,
          role: userMsg.role,
          content: userMsg.content,
          created_at: new Date(userMsg.timestamp).toISOString(),
        });
        userMsg.syncStatus = 'synced';
      } catch (e) {
        console.warn('[handleSendMessage] 유저 메시지 원격 전송 실패:', e);
      }
    }

    const updatedMessages = [...currentSession.messages, userMsg];
    let workingSession: ChatSession = {
      ...currentSession,
      messages: updatedMessages,
      updatedAt: Date.now()
    };
    setCurrentSession(workingSession);
    await storageAdapter.saveSession(workingSession);

    const assistantMsgId = `msg_${Date.now()}_a`;
    workingSession = {
      ...workingSession,
      messages: [...workingSession.messages, { id: assistantMsgId, role: 'assistant', content: '', timestamp: Date.now(), syncStatus: 'pending' }]
    };
    setCurrentSession(workingSession);

    abortControllerRef.current = new AbortController();
    let fullResponse = '';
    let firstTokenTime: number | null = null;
    const startTime = performance.now();

    try {
      // ── 웹 검색 활성화 시 RAG 파이프라인 ──────────────────────────────
      let messagesForLLM = updatedMessages;
      const hasImageAttachment = sentAttachments?.some((a) => a.type === 'image') ?? false;

      // 이미지가 첨부되어 있을 때는 모호한 텍스트 검색을 건너뛰고 이미지 시각 분석을 우선함
      if (webSearchEnabled && !hasImageAttachment) {
        try {
          const searchResult = await remoteChatAdapter.searchWeb(promptText);
          if (searchResult && (searchResult.widget || (searchResult.snippets && searchResult.snippets.length > 0) || searchResult.compressed_context)) {
            const { systemPrompt: searchAugmentedPrompt } = buildWebSearchContext(
              searchResult,
              systemPrompt,
            );
            // 검색 활성화 시 히스토리를 최근 2턴(최대 4개)으로 절삭하여 토큰 예산 보호
            const nonSystemMessages = updatedMessages.filter((m) => m.role !== 'system');
            const recentTurns = nonSystemMessages.slice(-4);
            messagesForLLM = [
              { id: 'sys_0', role: 'system' as const, content: searchAugmentedPrompt, timestamp: 0 },
              ...recentTurns,
            ];
          } else {
            // 활성 엔진 모두 결과가 없는 경우
            toast.dismiss('search-fallback');
            toast.info('🔍 검색 결과가 없어 기본 AI 지식으로 답변합니다.', { toastId: 'search-fallback' });
          }
        } catch (searchErr) {
          // 검색 서버 미구동/503/타임아웃 시 graceful fallback
          console.warn('[handleSendMessage] 웹 검색 실패, 기본 AI로 진행:', searchErr);
          toast.dismiss('search-fallback');
          toast.info('🔍 웹 검색에 실패했습니다. 기본 AI 지식으로 답변합니다.', { toastId: 'search-fallback' });
        }
      }

      const chunks = llmAdapter.stream(messagesForLLM, {
        temperature: 0.7,
        signal: abortControllerRef.current.signal
      });

      let lastRenderTime = 0;

      const flushUpdate = () => {
        setCurrentSession(prev => {
          if (!prev) return null;
          const nextMsgs = prev.messages.map(m => 
            m.id === assistantMsgId ? { ...m, content: fullResponse } : m
          );
          return { ...prev, messages: nextMsgs };
        });
      };

      for await (const chunk of chunks) {
        if (chunk.type === 'text-delta') {
          if (firstTokenTime === null) {
            firstTokenTime = performance.now();
            setGenerationStats(prev => ({
              ...prev,
              ttftMs: Math.round(firstTokenTime! - startTime)
            }));
          }

          fullResponse += chunk.text;
          
          const now = performance.now();
          if (now - lastRenderTime > 32) { // Max ~30fps batch update during rapid streaming
            lastRenderTime = now;
            flushUpdate();
          }
        } else if (chunk.type === 'done' && chunk.stats) {
          flushUpdate();
          setGenerationStats(prev => ({
            ...prev,
            totalMs: Math.round(chunk.stats?.totalMs || 0),
            totalTokens: chunk.stats?.tokenCount,
            tokensPerSec: chunk.stats?.tokensPerSecond
          }));
        } else if (chunk.type === 'error') {
          throw new Error(chunk.message);
        }
      }
      flushUpdate();

      let finalTitle = workingSession.title;
      if (finalTitle === '새로운 대화' && promptText) {
        finalTitle = promptText.slice(0, 18) + (promptText.length > 18 ? '...' : '');
      }

      let assistantSyncStatus: 'pending' | 'synced' = 'pending';
      if (authSess?.isAuthenticated) {
        try {
          if (finalTitle !== workingSession.title) {
            await remoteChatAdapter.createSession({
              id: workingSession.id,
              title: finalTitle,
              model_id: workingSession.modelId,
              created_at: new Date(workingSession.createdAt).toISOString(),
              updated_at: new Date().toISOString(),
            });
          }
          await remoteChatAdapter.postMessage(workingSession.id, {
            id: assistantMsgId,
            role: 'assistant',
            content: fullResponse,
            created_at: new Date().toISOString(),
          });
          assistantSyncStatus = 'synced';
        } catch (e) {
          console.warn('[handleSendMessage] 원격 전송 실패:', e);
        }
      }

      const finalSession: ChatSession = {
        ...workingSession,
        title: finalTitle,
        messages: workingSession.messages.map(m => 
          m.id === assistantMsgId ? { ...m, content: fullResponse, syncStatus: assistantSyncStatus } : m
        ),
        updatedAt: Date.now()
      };
      
      setCurrentSession(finalSession);
      await storageAdapter.saveSession(finalSession);
      await refreshSessionList();
      setChatPhase('idle');



    } catch (err: any) {
      console.error(err);
      setCurrentSession(prev => {
        if (!prev) return null;
        return {
          ...prev,
          messages: prev.messages.map(m => 
            m.id === assistantMsgId ? { ...m, content: `추론 중 오류가 발생하였습니다: ${err?.message || err}` } : m
          )
        };
      });
      setChatPhase('error');
    }
  };

  // 8. 스트리밍 중단
  const handleInterrupt = async () => {
    if (chatPhase !== 'generating') return;
    
    abortControllerRef.current?.abort();
    await llmAdapter.interrupt();
    setChatPhase('interrupted');
    
    if (currentSession) {
      await storageAdapter.saveSession({
        ...currentSession,
        updatedAt: Date.now()
      });
      await refreshSessionList();
    }
    toast.dismiss('generation-interrupted');
    toast.info('답변 생성이 중지되었습니다.', { toastId: 'generation-interrupted' });
  };


  // 10. 로그인 핸들러
  const handleLogin = async () => {
    setIsLoginScreenOpen(true);
  };

  /**
   * 소셜 로그인 핸들러 — WebAuthAdapter의 팝업 기반 OAuth 플로우 실행
   * SocialLogin 컴포넌트의 onLoginProvider prop으로 전달됨
   */
  const handleLoginProvider = async (provider: 'apple' | 'google' | 'naver' | 'kakao') => {
    await authAdapter.startLogin(provider);
    setIsLoginScreenOpen(false);
  };

  const displayEmail = (() => {
    if (authSession?.user?.linkedProviders?.includes('naver')) return '네이버 계정';
    if (authSession?.user?.linkedProviders?.includes('kakao')) return '카카오 계정';
    return authSession?.user?.email || 'guest@local';
  })();

  const loadingModelName = MODEL_REGISTRY[selectedModelId]?.label || selectedModelId;

  return (
    <div className="poc-container monorepo-web">
      {/* ── 모델 로딩 풀스크린 오버레이 ── */}
      <ModelLoadingOverlay
        isVisible={chatPhase === 'model-loading'}
        modelName={loadingModelName}
        onCancel={handleCancelLoadModel}
      />
      {/*
       * [레이아웃 충돌 수정 원리]
       * 기존: isSidebarOpen===false 시 사이드바를 grid 0px로 숨기고
       *       absolute 포지션 햄버거 버튼을 메인 위에 띄움 → 헤더와 겹침 버그 발생
       *
       * 개선: 사이드바를 절대로 숨기지 않고 64px 미니 트랙으로 축소.
       *       grid 컬럼이 항상 자체 공간을 점유하므로 메인 콘텐츠와 완전히 격리됨.
       *       absolute 포지션 햄버거 버튼은 완전히 제거.
       */}
      <main
        className="poc-grid"
        style={{
          gridTemplateColumns: isSidebarOpen ? '280px 1fr' : '64px 1fr',
          transition: 'grid-template-columns 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        {/* =====================================================
         *  사이드바: open/mini 두 상태 모두 항상 렌더링 유지
         *  (절대 DOM에서 제거하지 않음 → 겹침 버그 원천 차단)
         * ===================================================== */}
        <section 
          className={`poc-sidebar ${
            isSidebarOpen 
              ? 'mobile-open md:static md:w-auto md:h-full' 
              : 'mini mobile-closed'
          }`}
        >

          {/* ─── 영역 1 (최상단): 로고 + 토글/닫기 버튼 ─────────────── */}
          <div className="sidebar-header flex items-center justify-between p-4 flex-shrink-0">
            {/* 로고: 펼침 상태에서는 텍스트, 미니 상태에서는 클릭 가능한 첫 글자 */}
            <div 
              className={`sidebar-logo ${!isSidebarOpen ? 'clickable' : ''}`}
              onClick={() => { if (!isSidebarOpen) setIsSidebarOpen(true); }}
            >
              {isSidebarOpen ? (
                <span style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-light)', letterSpacing: '-0.02em' }}>
                  옾피티
                </span>
              ) : (
                <span style={{ fontSize: '18px', fontWeight: 800, color: 'var(--accent)' }}>옾</span>
              )}
            </div>

            {/* 데스크톱 전용 접기(화살표) 버튼: PC 화면(md 이상)에서만 표시 */}
            {isSidebarOpen && (
              <button
                className="sidebar-toggle-btn hidden md:inline-flex"
                onClick={() => setIsSidebarOpen(false)}
                title="사이드바 접기"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </button>
            )}

            {/* 모바일 전용 닫기(X) 인라인 SVG 버튼: 모바일 화면(md 미만)에서만 표시 */}
            {isSidebarOpen && (
              <button 
                type="button"
                onClick={() => setIsSidebarOpen(false)} 
                aria-label="Close menu" 
                className="p-2 rounded-lg hover:bg-neutral-800 text-gray-400 hover:text-white transition-colors flex md:hidden"
              >
                <svg className="w-6 h-6 text-current" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* ─── 영역 2: 새 채팅 버튼 ────────────────────────── */}
          <div className="sidebar-new-chat">
            {isSidebarOpen ? (
              /* 펼침: 텍스트가 있는 큼직한 버튼 */
              <button
                type="button"
                className="sidebar-new-chat-btn full"
                onClick={handleNewSession}
                disabled={!loadedModelId || chatPhase === 'generating'}
              >
                {/* 연필 아이콘 */}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                </svg>
                새 대화
              </button>
            ) : (
              /* 미니: 아이콘만 */
              <button
                type="button"
                className="sidebar-new-chat-btn icon-only"
                onClick={handleNewSession}
                disabled={!loadedModelId || chatPhase === 'generating'}
                title="새 대화"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                </svg>
              </button>
            )}
          </div>

          {/* ─── 영역 3: 채팅 히스토리 (펼침 상태에서만 렌더링) ── */}
          {isSidebarOpen && (
            <div className="sidebar-history">
              <h3 className="sidebar-section-label">최근</h3>
              <div className="history-viewport">
                {!authSession?.isAuthenticated ? (
                  <div className="text-muted" style={{ textAlign: 'center', padding: '20px 0', fontSize: '12px' }}>
                    로그인 하세요
                  </div>
                ) : sessionList.length === 0 ? (
                  <div className="text-muted" style={{ textAlign: 'center', padding: '20px 0', fontSize: '12px' }}>
                    대화 기록이 없습니다.
                  </div>
                ) : (
                  sessionList.map((s) => (
                    <div
                      key={s.id}
                      className={`history-item ${currentSession?.id === s.id ? 'active' : ''}`}
                      onClick={() => handleRestoreSession(s.id)}
                    >
                      <div style={{ flex: '1', minWidth: 0 }}>
                        <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-light)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {s.title}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: '2px' }}>
                          {s.lastMessagePreview}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => handleDeleteSession(s.id, e)}
                        className="history-delete-btn"
                        title="삭제"
                      >
                        ✕
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* ─── 영역 4 (최하단): 계정 정보 ─────────────────── */}
          <div className="sidebar-footer">
            {!authSession?.isAuthenticated ? (
              /* 비로그인 상태: 로그인 버튼만 표시 */
              isSidebarOpen ? (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  style={{ width: '100%', borderRadius: '10px', padding: '10px 16px', fontWeight: 600, fontSize: '14px' }}
                  onClick={handleLogin}
                >
                  로그인
                </button>
              ) : (
                /* 미니 상태: 아이콘 버튼 */
                <button
                  type="button"
                  className="sidebar-icon-btn"
                  title="로그인"
                  onClick={handleLogin}
                  style={{ margin: '0 auto' }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                    <polyline points="10 17 15 12 10 7" />
                    <line x1="15" y1="12" x2="3" y2="12" />
                  </svg>
                </button>
              )
            ) : (
              /* 로그인 상태: 기존 아바타 + 아이콘 버튼 */
              <div 
                className={`sidebar-account-container ${!isSidebarOpen ? 'mini' : ''}`}
                ref={accountMenuRef}
                style={{ position: 'relative' }}
              >
                {/* 아바타 + 계정 정보 */}
                <div 
                  className={`sidebar-account ${!isSidebarOpen ? 'mini' : ''}`}
                  onClick={() => setIsAccountMenuOpen((prev) => !prev)}
                  style={{ cursor: 'pointer' }}
                >
                  {/* 아바타 원형 */}
                  <div className="sidebar-avatar" style={{ overflow: 'hidden', padding: 0 }}>
                    {authSession?.user?.profileImageUrl && !imageLoadErrors[authSession.user.profileImageUrl] ? (
                      <img 
                        src={authSession.user.profileImageUrl} 
                        alt="Profile" 
                        referrerPolicy="no-referrer"
                        onError={() => {
                          if (authSession?.user?.profileImageUrl) {
                            setImageLoadErrors(prev => ({ ...prev, [authSession.user.profileImageUrl!]: true }));
                          }
                        }}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} 
                      />
                    ) : (
                      authSession?.user?.displayName?.charAt(0) || 'U'
                    )}
                  </div>
                  {/* 펼침 상태에서만 이름/이메일 텍스트 표시 */}
                  {isSidebarOpen && (
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-light)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {authSession?.user?.displayName || '사용자'}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {displayEmail}
                      </div>
                    </div>
                  )}
                </div>

                {/* 계정 관리 Drawer / Popover (첨부 이미지와 100% 동일한 레이아웃 + 이용약관) */}
                {isAccountMenuOpen && (
                  <div
                    className="account-popover-overlay"
                    onClick={() => setIsAccountMenuOpen(false)}
                  >
                    <div
                      className="account-popover-card"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* 닫기 X 버튼 */}
                      <button
                        type="button"
                        className="account-popover-close-btn"
                        onClick={() => setIsAccountMenuOpen(false)}
                        aria-label="닫기"
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>

                      {/* 상단 프로필 헤더 */}
                      <div className="account-popover-header">
                        {/* 큰 아바타 원형 (80px) */}
                        <div className="account-popover-avatar">
                          {authSession?.user?.profileImageUrl && !imageLoadErrors[authSession.user.profileImageUrl] ? (
                            <img 
                              src={authSession.user.profileImageUrl} 
                              alt="Profile" 
                              referrerPolicy="no-referrer"
                              onError={() => {
                                if (authSession?.user?.profileImageUrl) {
                                  setImageLoadErrors(prev => ({ ...prev, [authSession.user.profileImageUrl!]: true }));
                                }
                              }}
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                            />
                          ) : (
                            authSession?.user?.displayName?.charAt(0) || 'U'
                          )}
                        </div>

                        {/* 인사말 */}
                        <div className="account-popover-greeting">
                          {authSession?.user?.displayName || '사용자'}님, 안녕하세요.
                        </div>

                        {/* 계정관리 버튼 */}
                        <button
                          type="button"
                          className="account-popover-settings-btn"
                          onClick={() => {
                            setIsAccountMenuOpen(false);
                            setIsSettingsOpen(true);
                          }}
                        >
                          계정관리
                        </button>
                      </div>

                      {/* 주요 메뉴 그룹 카드 */}
                      <div className="account-popover-menu-card">
                        {/* 1. 다크 모드 토글 */}
                        <div className="account-menu-item">
                          <div className="account-menu-item-left">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                            </svg>
                            <span>다크 모드</span>
                          </div>
                          <div 
                            className={`toggle-switch ${isDarkMode ? 'checked' : ''}`}
                            onClick={() => setDarkMode(!isDarkMode)}
                          >
                            <div className="toggle-switch-handle" />
                          </div>
                        </div>

                        <div className="account-menu-divider" />

                        {/* 2. 이용약관 (노션 URL 바로 이동) */}
                        <div 
                          className="account-menu-item clickable"
                          onClick={() => {
                            window.open('https://plum-puppet-fa1.notion.site/3b9af4da8994803db04ac71d9b8f5d48?source=copy_link', '_blank');
                          }}
                        >
                          <div className="account-menu-item-left">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                              <polyline points="14 2 14 8 20 8" />
                              <line x1="16" y1="13" x2="8" y2="13" />
                              <line x1="16" y1="17" x2="8" y2="17" />
                              <polyline points="10 9 9 9 8 9" />
                            </svg>
                            <span>이용약관</span>
                          </div>
                        </div>

                        <div className="account-menu-divider" />

                        {/* 3. 로그아웃 (Red) */}
                        <div 
                          className="account-menu-item clickable"
                          onClick={async () => {
                            console.log('로그아웃');
                            await authAdapter.logout();
                            setIsAccountMenuOpen(false);
                          }}
                        >
                          <div className="account-menu-item-left">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                              <polyline points="16 17 21 12 16 7" />
                              <line x1="21" y1="12" x2="9" y2="12" />
                            </svg>
                            <span style={{ color: '#ef4444' }}>로그아웃</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', gap: '4px' }}>
                  {/* 설정 버튼 */}
                  <button 
                    className="sidebar-icon-btn" 
                    title="설정"
                    onClick={() => setIsAccountMenuOpen(true)}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                    </svg>
                  </button>
                </div>
              </div>
            )}
          </div>

        </section>

        {/* 오른쪽 메인 콘텐츠 영역 */}
        {!authSession?.isAuthenticated ? (
          /* ── 비로그인 상태: 히어로 페이지 ── */
          <section className="poc-main" style={{ gap: '0' }}>
            {/* 상단 헤더 (모바일 햄버거 메뉴 + 우측 로그인 버튼) */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', flexShrink: 0 }}>
              <button
                type="button"
                onClick={() => setIsSidebarOpen(true)}
                aria-label="Open menu"
                className="p-2 rounded-lg text-gray-300 hover:bg-neutral-800 transition-colors md:hidden"
              >
                <svg className="w-6 h-6 text-current" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <button
                type="button"
                className="btn btn-primary ml-auto"
                style={{ width: 'auto', padding: '10px 24px', borderRadius: '24px', fontSize: '14px', fontWeight: 600 }}
                onClick={handleLogin}
              >
                로그인
              </button>
            </div>

            {/* 히어로 중앙 영역 */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 40px 80px' }}>
              <h1 className="hero-title">기록이 서버에 저장되지 않는<br />LLM을 사용해보세요.</h1>
              {/* 비활성화된 인풋 바 (시각적 미리보기용) */}
              <div className="chat-input-bar-wrapper" style={{ width: '100%', maxWidth: '720px', marginTop: '32px', position: 'relative', bottom: 'unset', left: 'unset', padding: '0', background: 'transparent' }}>
                <div className="chat-input-bar" style={{ margin: '0' }}>
                  <div className="capsule-input-box">
                    <textarea
                      placeholder="로그인 후 대화를 시작할 수 있습니다."
                      disabled
                      style={{ minHeight: '44px' }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </section>
        ) : (
          /* ── 로그인 상태: 기존 채팅 UI ── */
          <section className="poc-main" style={{ gap: '0' }}>
            
            {/* 상단 은은한 헤더 바 (모델 선택기) */}
            <div style={{ padding: '16px 24px', display: 'flex', justifyContent: 'flex-start', alignItems: 'center' }}>
              {/* 모바일 전용 햄버거 메뉴 열기 버튼 */}
              <button
                type="button"
                onClick={() => setIsSidebarOpen(true)}
                aria-label="Open menu"
                className="p-2 rounded-lg text-gray-300 hover:bg-neutral-800 transition-colors md:hidden mr-2 flex-shrink-0"
              >
                <svg className="w-6 h-6 text-current" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>

              {/* 헤더 모델 선택기 (클릭 시 ModelGalleryModal 팝업 노출) */}
              <button
                type="button"
                onClick={() => setIsModelGalleryOpen(true)}
                disabled={chatPhase === 'model-loading' || chatPhase === 'generating'}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid var(--card-border)',
                  padding: '6px 14px',
                  borderRadius: '12px',
                  cursor: chatPhase === 'model-loading' || chatPhase === 'generating' ? 'not-allowed' : 'pointer',
                  transition: 'background 0.2s, border-color 0.2s',
                }}
                title="AI 모델 갤러리 열기"
              >
                <span style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-light)' }}>
                  {MODEL_REGISTRY[loadedModelId || selectedModelId]?.label || (loadedModelId || selectedModelId)}
                </span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-muted)' }}>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              
              
              {/* 모델 로드/언로드 상태 및 WebGPU 지원 여부 간략 표시 */}
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '12px' }}>
                {generationStats.tokensPerSec && (
                  <div style={{ fontSize: '11px', color: '#10b981', fontWeight: 600 }}>
                    Speed: {generationStats.tokensPerSec} t/s
                  </div>
                )}
                {/* Dummy usage for setSystemPrompt to pass TS check */}
                <div style={{ display: 'none' }} onClick={() => setSystemPrompt('')}>{systemPrompt}</div>

                {!loadedModelId && (
                  <button 
                    type="button" 
                    className="btn btn-primary btn-sm" 
                    onClick={() => handleLoadModel()}
                    disabled={chatPhase === 'model-loading' || webGpuState.supported === false}
                    style={{ borderRadius: '999px', padding: '6px 16px', fontSize: '13px' }}
                  >
                    {chatPhase === 'model-loading' ? '모델 준비 중...' : '모델 로드'}
                  </button>
                )}
              </div>
            </div>

            {/* 메인 대화창 뷰포트 */}
            {webGpuState.supported === false && (
              <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.08)', color: '#ef4444', padding: '20px 24px', borderRadius: '12px', margin: '16px', display: 'flex', flexDirection: 'column', gap: '12px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '24px' }}>⚠️</span>
                  <div>
                    <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>WebGPU 미지원 브라우저 환경</h4>
                    <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: 'var(--text-muted)' }}>{webGpuState.error || '현재 브라우저는 WebGPU 하드웨어 가속을 지원하지 않습니다.'}</p>
                  </div>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.5', background: 'rgba(0,0,0,0.2)', padding: '10px 14px', borderRadius: '8px' }}>
                  💡 Gemma 로컬 모델은 WebGPU 호환 브라우저(Chrome 113+, Edge 113+, Safari 18+)에서 최상의 성능으로 구동됩니다. 최신 브라우저 환경에서 접속해 주세요.
                </div>
              </div>
            )}
            <div className="chat-card">

              <div className="chat-viewport">
                {chatPhase === 'model-error' && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', padding: '40px' }}>
                    <h2 className="gemini-welcome-text" style={{ color: '#ef4444', marginBottom: 0 }}>모델 로드 실패</h2>
                    <p style={{ color: 'var(--text-muted)' }}>모델을 로드하는 중 오류가 발생했습니다. 다시 시도해 주세요.</p>
                    <button className="btn btn-primary" onClick={() => handleLoadModel()} style={{ borderRadius: '999px', padding: '8px 24px' }}>
                      다시 시도
                    </button>
                  </div>
                )}
                {(!currentSession || currentSession.messages.filter(msg => msg.role !== 'system').length === 0) ? (
                  <div className="chat-empty">
                    <h2 className="gemini-welcome-text">무엇을 도와드릴까요?</h2>

                    <div className="prompt-grid" style={{ maxWidth: '640px', margin: '32px auto 0' }}>
                      <div className="gemini-prompt-card" style={{ cursor: 'default' }}>
                        <span className="icon">🔒</span>
                        <p>대화 내용은 서버로 전송되지 않고 사용자 기기 내부에서 처리됩니다.</p>
                      </div>
                      <div className="gemini-prompt-card" style={{ cursor: 'default' }}>
                        <span className="icon">📡</span>
                        <p>인터넷 연결 없이도 로컬 AI 추론이 가능합니다.</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  currentSession.messages.filter(msg => msg.role !== 'system').map((msg, _idx, arr) => {
                    const isLastAssistant = msg.role === 'assistant' && msg === arr.filter(m => m.role === 'assistant').pop();
                    const isThinking = msg.role === 'assistant' && !msg.content && chatPhase === 'generating';
                    const isInterrupted = isLastAssistant && (chatPhase === 'interrupted');
                    return (
                      <ChatBubble 
                        key={msg.id} 
                        content={msg.content || ''} 
                        isUser={msg.role === 'user'}
                        isThinking={isThinking}
                        isInterrupted={isInterrupted}
                        attachments={msg.attachments}
                      />
                    );
                  })
                )}
                <div ref={chatEndRef} />
              </div>

              {/* 제미나이 스타일 플로팅 인풋 바 */}
              <div className="chat-input-bar-wrapper">
                <div className="chat-input-bar">
                  {/* 첨부파일 미리보기 */}
                  <AttachmentPreview
                    attachments={pendingAttachments}
                    onRemove={removeAttachment}
                  />

                  {/* 웹 검색 활성화 알림 배너 */}
                  {webSearchEnabled && (
                    <div className="web-search-active-banner">
                      <div className="web-search-banner-content">
                        <span className="web-search-banner-pulse"></span>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10"></circle>
                          <line x1="2" y1="12" x2="22" y2="12"></line>
                          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                        </svg>
                        {pendingAttachments.some((a) => a.type === 'image') ? (
                          <span className="web-search-banner-title">🖼️ 이미지 첨부 중에는 이미지 시각 분석이 우선 적용됩니다</span>
                        ) : (
                          <span className="web-search-banner-title">최신 웹 정보를 검색하여 답변에 반영합니다</span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="web-search-banner-close"
                        title="웹 검색 끄기"
                        onClick={() => setWebSearchEnabled(false)}
                      >
                        ✕
                      </button>
                    </div>
                  )}

                  <div className="capsule-input-box">
                    <textarea
                      ref={textareaRef}
                      value={input}
                      onChange={handleInputInput}
                      className={chatPhase === 'model-loading' ? 'loading-placeholder' : ''}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          if ((input.trim() || pendingAttachments.length > 0) && loadedModelId && chatPhase !== 'generating') {
                            handleSendMessage(e as any);
                          }
                        }
                      }}
                      placeholder={
                        chatPhase === 'model-loading'
                          ? "AI 모델을 로드하는 중입니다..."
                          : loadedModelId
                            ? "프롬프트를 입력하세요"
                            : "상단의 모델 적재를 먼저 눌러주세요."
                      }
                      disabled={chatPhase === 'model-loading' || chatPhase === 'generating' || !loadedModelId}
                    />
                    <div className="capsule-actions">
                      {/* 첨부파일 버튼 + 드롭다운 메뉴 */}
                      <div className="attachment-menu-wrapper" ref={attachMenuRef}>
                        <button
                          type="button"
                          className="action-icon-btn"
                          title="파일 첨부"
                          onClick={() => setIsAttachMenuOpen((prev) => !prev)}
                          disabled={chatPhase === 'model-loading' || chatPhase === 'generating' || !loadedModelId}
                        >
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="12" y1="5" x2="12" y2="19"></line>
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                          </svg>
                        </button>
                        {isAttachMenuOpen && (
                          <div className="attachment-menu">
                            <button
                              type="button"
                              className="attachment-menu-item"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                triggerImageSelect();
                                setIsAttachMenuOpen(false);
                              }}
                            >
                              <span className="attachment-menu-icon">🖼️</span>
                              <span>이미지 선택</span>
                            </button>
                            <button
                              type="button"
                              className="attachment-menu-item"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                triggerDocumentSelect();
                                setIsAttachMenuOpen(false);
                              }}
                            >
                              <span className="attachment-menu-icon">📄</span>
                              <span>문서 첨부</span>
                            </button>
                          </div>
                        )}
                      </div>

                      {/* 웹 검색 토글 버튼 */}
                      <button
                        type="button"
                        className={`search-toggle-btn${webSearchEnabled ? ' active' : ''}`}
                        title={webSearchEnabled ? '웹 검색 활성화됨 (클릭하여 끄기)' : '웹 검색 비활성화됨 (클릭하여 켜기)'}
                        onClick={() => setWebSearchEnabled((prev) => !prev)}
                        disabled={chatPhase === 'model-loading' || !loadedModelId}
                        aria-pressed={webSearchEnabled}
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="search-btn-icon">
                          <circle cx="11" cy="11" r="8"></circle>
                          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                        </svg>
                        <span className="search-toggle-label">웹 검색</span>
                        {webSearchEnabled && <span className="search-active-pill">ON</span>}
                      </button>

                      {/* Hidden file inputs */}
                      <input
                        ref={imageInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                        multiple
                        style={{ display: 'none' }}
                        onChange={handleImageFiles}
                      />
                      <input
                        ref={documentInputRef}
                        type="file"
                        accept=".txt,.pdf,.csv,.json,.md,text/plain,application/pdf,text/csv,application/json,text/markdown"
                        multiple
                        style={{ display: 'none' }}
                        onChange={handleDocumentFiles}
                      />

                      {chatPhase === 'generating' ? (
                        <button type="button" className="btn-stop-pill" onClick={handleInterrupt} title="중지">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <rect x="6" y="6" width="12" height="12" rx="2" ry="2"></rect>
                          </svg>
                        </button>
                      ) : (
                        <button 
                          type="button" 
                          className="action-icon-btn send" 
                          onClick={handleSendMessage}
                          disabled={(!input.trim() && pendingAttachments.length === 0) || chatPhase === 'model-loading' || !loadedModelId}
                          title="전송"
                        >
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z"></path>
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 벤치마크 패널 제거됨 */}
          </section>
        )}
      </main>
      <ToastContainer
        position="top-right"
        autoClose={1500}
        hideProgressBar={false}
        newestOnTop={false}
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
      />

      {/* 설정 모달 */}
      {isSettingsOpen && (
        <div 
          className="settings-modal-overlay"
          onClick={() => setIsSettingsOpen(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            backgroundColor: 'rgba(0, 0, 0, 0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2000,
          }}
        >
          <div 
            className="settings-modal-container"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '800px',
              height: '550px',
              backgroundColor: 'var(--bg)',
              border: '1px solid var(--card-border)',
              borderRadius: '20px',
              boxShadow: '0 16px 48px rgba(0, 0, 0, 0.4)',
              display: 'grid',
              gridTemplateColumns: '220px 1fr',
              overflow: 'hidden',
              animation: 'settingsScaleUp 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
            }}
          >
            {/* 좌측 메뉴 탭 영역 */}
            <div 
              className="settings-modal-sidebar"
              style={{
                borderRight: '1px solid var(--card-border)',
                backgroundColor: 'var(--sidebar-bg)',
                padding: '24px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-light)', marginBottom: '16px', paddingLeft: '8px' }}>설정</h2>
              
              <button
                type="button"
                onClick={() => setActiveSettingsTab('general')}
                className={`settings-tab-btn ${activeSettingsTab === 'general' ? 'active' : ''}`}
              >
                일반
              </button>
              <button
                type="button"
                onClick={() => setActiveSettingsTab('theme')}
                className={`settings-tab-btn ${activeSettingsTab === 'theme' ? 'active' : ''}`}
              >
                테마
              </button>
              <button
                type="button"
                onClick={() => setActiveSettingsTab('terms')}
                className={`settings-tab-btn ${activeSettingsTab === 'terms' ? 'active' : ''}`}
              >
                이용약관
              </button>
            </div>

            {/* 우측 메인 상세 설정 영역 */}
            <div 
              className="settings-modal-content"
              style={{
                padding: '32px',
                display: 'flex',
                flexDirection: 'column',
                overflowY: 'auto',
              }}
            >
              {/* 헤더 */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <h3 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-light)' }}>
                  {typeof window !== 'undefined' && window.innerWidth < 768 
                    ? '계정 설정' 
                    : (
                      activeSettingsTab === 'general' ? '일반 설정' :
                      activeSettingsTab === 'theme' ? '테마 설정' : '이용약관'
                    )}
                </h3>
                <button 
                  type="button"
                  onClick={() => setIsSettingsOpen(false)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-muted)',
                    fontSize: '20px',
                    cursor: 'pointer',
                    padding: '4px',
                  }}
                >
                  ✕
                </button>
              </div>

              {/* 탭별 내용 (모바일 뷰포트에서는 '일반' 탭 전용 노출) */}
              {(activeSettingsTab === 'general' || (typeof window !== 'undefined' && window.innerWidth < 768)) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                  {/* 프로필 섹션 */}
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '8px', paddingLeft: '4px' }}>
                      프로필
                    </div>
                    <div 
                      style={{ 
                        backgroundColor: 'var(--card-bg)', 
                        border: '1px solid var(--card-border)', 
                        borderRadius: '16px', 
                        overflow: 'hidden' 
                      }}
                    >
                      {/* Row 1: 프로필 이미지 + 이름 */}
                      <div style={{ display: 'flex', alignItems: 'center', padding: '16px', gap: '14px' }}>
                        <div 
                          style={{
                            width: '36px',
                            height: '36px',
                            borderRadius: '50%',
                            backgroundColor: 'var(--accent)',
                            color: '#000',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '16px',
                            fontWeight: 700,
                            flexShrink: 0,
                            overflow: 'hidden',
                          }}
                        >
                          {authSession?.user?.profileImageUrl && !imageLoadErrors[authSession.user.profileImageUrl] ? (
                            <img 
                              src={authSession.user.profileImageUrl} 
                              alt="Profile" 
                              referrerPolicy="no-referrer"
                              onError={() => {
                                if (authSession?.user?.profileImageUrl) {
                                  setImageLoadErrors(prev => ({ ...prev, [authSession.user.profileImageUrl!]: true }));
                                }
                              }}
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                            />
                          ) : (
                            authSession?.user?.displayName?.charAt(0) || 'U'
                          )}
                        </div>
                        <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-light)' }}>
                          {authSession?.user?.displayName || '사용자'}
                        </div>
                      </div>

                      <div style={{ height: '1px', backgroundColor: 'var(--card-border)', marginLeft: '66px' }} />

                      {/* Row 2: 이메일 */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', gap: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-light)' }}>
                            <path d="M4 7.00005L10.2 11.65C11.2667 12.45 12.7333 12.45 13.8 11.65L20 7" />
                            <rect x="3" y="5" width="18" height="14" rx="2" />
                          </svg>
                          <span style={{ fontSize: '15px', color: 'var(--text-light)', fontWeight: 500 }}>이메일</span>
                        </div>
                        <span style={{ fontSize: '14px', color: 'var(--text-muted)' }}>{displayEmail}</span>
                      </div>

                      <div style={{ height: '1px', backgroundColor: 'var(--card-border)', marginLeft: '66px' }} />

                      {/* Row 3: 소셜 연동 계정 */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', gap: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          {authSession?.user?.linkedProviders?.[0] === 'google' ? (
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                              <path d="M22.56 12.25C22.56 11.47 22.49 10.72 22.36 10H12V14.26H17.92C17.67 15.63 16.89 16.79 15.73 17.57V20.34H19.29C21.37 18.42 22.56 15.6 22.56 12.25Z" fill="#4285F4" />
                              <path d="M12 23C14.97 23 17.46 22.02 19.29 20.34L15.73 17.57C14.74 18.23 13.48 18.63 12 18.63C9.14 18.63 6.7 16.7 5.84 14.11H2.17V16.96C3.99 20.57 7.68 23 12 23Z" fill="#34A853" />
                              <path d="M5.84 14.11C5.62 13.45 5.49 12.74 5.49 12C5.49 11.26 5.62 10.55 5.84 9.89V7.04H2.17C1.42 8.52 1 10.21 1 12C1 13.79 1.42 15.48 2.17 16.96L5.84 14.11Z" fill="#FBBC05" />
                              <path d="M12 5.38C13.62 5.38 15.07 5.94 16.22 7.03L19.37 3.88C17.46 2.09 14.97 1 12 1C7.68 1 3.99 3.43 2.17 7.04L5.84 9.89C6.7 7.3 9.14 5.38 12 5.38Z" fill="#EA4335" />
                            </svg>
                          ) : authSession?.user?.linkedProviders?.[0] === 'naver' ? (
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                              <path d="M13.6 12.32L10.16 7H7V17H10.4V11.68L13.84 17H17V7H13.6V12.32Z" fill="#03C75A" />
                            </svg>
                          ) : authSession?.user?.linkedProviders?.[0] === 'kakao' ? (
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                              <path d="M12 3C7.03 3 3 6.36 3 10.5C3 13.03 4.45 15.27 6.68 16.69L5.78 19.94C5.72 20.17 5.97 20.36 6.17 20.23L9.93 17.77C10.6 17.87 11.29 17.92 12 17.92C16.97 17.92 21 14.56 21 10.5C21 6.36 16.97 3 12 3Z" fill="#FEE500" />
                            </svg>
                          ) : (
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                              <path d="M22.56 12.25C22.56 11.47 22.49 10.72 22.36 10H12V14.26H17.92C17.67 15.63 16.89 16.79 15.73 17.57V20.34H19.29C21.37 18.42 22.56 15.6 22.56 12.25Z" fill="#4285F4" />
                            </svg>
                          )}
                          <span style={{ fontSize: '15px', color: 'var(--text-light)', fontWeight: 500 }}>
                            {authSession?.user?.linkedProviders?.[0] 
                              ? (authSession.user.linkedProviders[0] === 'google' ? 'Google' : authSession.user.linkedProviders[0] === 'naver' ? '네이버' : authSession.user.linkedProviders[0] === 'kakao' ? '카카오' : authSession.user.linkedProviders[0])
                              : '소셜 계정'}
                          </span>
                        </div>
                        <span style={{ fontSize: '14px', color: 'var(--text-muted)' }}>연결됨</span>
                      </div>
                    </div>
                  </div>

                  {/* 계정 삭제 섹션 */}
                  <div>
                    <div 
                      style={{ 
                        backgroundColor: 'var(--card-bg)', 
                        border: '1px solid var(--card-border)', 
                        borderRadius: '16px', 
                        overflow: 'hidden',
                        cursor: 'pointer',
                        transition: 'background-color 0.2s',
                      }}
                      onClick={async () => {
                        if (confirm('정말로 탈퇴하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) {
                          console.log('탈퇴하기');
                          await authAdapter.deleteAccount();
                          setIsSettingsOpen(false);
                        }
                      }}
                    >
                      <div style={{ padding: '16px', textAlign: 'center', color: '#ef4444', fontWeight: 600, fontSize: '15px' }}>
                        계정 삭제
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeSettingsTab === 'theme' && (typeof window !== 'undefined' && window.innerWidth >= 768) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <p style={{ fontSize: '14px', color: 'var(--text-muted)' }}>화면 테마를 변경할 수 있습니다.</p>
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <button
                      type="button"
                      className={`settings-theme-btn ${!isDarkMode ? 'active' : ''}`}
                      onClick={() => setDarkMode(false)}
                    >
                      라이트 모드
                    </button>
                    <button
                      type="button"
                      className={`settings-theme-btn ${isDarkMode ? 'active' : ''}`}
                      onClick={() => setDarkMode(true)}
                    >
                      다크 모드
                    </button>
                  </div>
                </div>
              )}

              {activeSettingsTab === 'terms' && (typeof window !== 'undefined' && window.innerWidth >= 768) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', alignItems: 'flex-start' }}>
                  <p style={{ fontSize: '14px', color: 'var(--text-muted)', lineHeight: '1.6' }}>
                    서비스 이용에 필요한 약관 및 개인정보 처리방침 상세 내용을 확인하실 수 있습니다.
                  </p>
                  
                  <a
                    href="https://plum-puppet-fa1.notion.site/3b9af4da8994803db04ac71d9b8f5d48?source=copy_link"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-primary"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      padding: '10px 18px',
                      borderRadius: '10px',
                      fontSize: '13.5px',
                      fontWeight: 600,
                      textDecoration: 'none',
                      width: 'fit-content',
                    }}
                  >
                    <span>이용약관 문서 보기</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                      <polyline points="15 3 21 3 21 9"></polyline>
                      <line x1="10" y1="14" x2="21" y2="3"></line>
                    </svg>
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {isLoginScreenOpen && (
        <SocialLogin
          onClose={() => setIsLoginScreenOpen(false)}
          onLoginProvider={handleLoginProvider}
        />
      )}

      {/* AI 모델 갤러리 팝업 모달 */}
      <ModelGalleryModal
        isOpen={isModelGalleryOpen}
        onClose={() => setIsModelGalleryOpen(false)}
        currentLoadedModelId={loadedModelId}
        selectedModelId={selectedModelId}
        isLoading={chatPhase === 'model-loading'}
        onSelectAndLoadModel={(targetModelId) => {
          setIsModelGalleryOpen(false);
          setSelectedModelId(targetModelId);
          handleLoadModel(targetModelId);
        }}
      />
    </div>
  );
}
