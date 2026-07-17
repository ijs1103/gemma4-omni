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

import { LiteRTLMAdapter } from './adapters/LiteRTLMAdapter';
import { WebStorageAdapter } from './adapters/WebStorageAdapter';
import { WebAuthAdapter } from './adapters/WebAuthAdapter';

import { ChatBubble } from './components/ChatBubble';
import { AttachmentPreview } from './components/AttachmentPreview';
import { SocialLogin } from './components/SocialLogin';
import { useTheme } from './context/ThemeContext';
import { useFileAttachment } from './hooks/useFileAttachment';

import './App.css';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

// 1. 공통 어댑터 인스턴스 싱글톤 생성
const llmAdapter = new LiteRTLMAdapter();
const storageAdapter = new WebStorageAdapter();
const authAdapter = new WebAuthAdapter();

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

  // IndexedDB 대용량 벤치마크 상태 및 로그인 상태 제거됨 (미니멀 UI를 위해 제거)
  
  // Ref 관리
  const chatEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // 사이드바 토글 상태
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // 설정 모달 상태
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState<'general' | 'theme' | 'notifications'>('general');

  // 소셜 로그인 화면 상태
  const [isLoginScreenOpen, setIsLoginScreenOpen] = useState(false);

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

  // 2. 세션 리스트 갱신 함수
  const refreshSessionList = async () => {
    const list = await storageAdapter.listSessions();
    setSessionList(list);
  };

  // 3. 모델 로드 트리거
  const handleLoadModel = async (overrideModelId?: string) => {
    setChatPhase('model-loading');
    setLoadedModelId(null);
    setGenerationStats({});

    const targetModelId = overrideModelId || selectedModelId;
    const actualModelId = MODEL_REGISTRY[targetModelId] ? targetModelId : initialModelId;
    if (selectedModelId !== actualModelId) {
      setSelectedModelId(actualModelId);
    }

    const spec: ModelSpec = {
      id: actualModelId,
      family: 'gemma',
      variant: '2b',
      contextWindow: 8192
    };

    try {
      await llmAdapter.init(spec);
      const loadedModelName = MODEL_REGISTRY[actualModelId]?.label || actualModelId;
      console.log(`[LiteRTLMAdapter] ${loadedModelName}가 로드 완료되었습니다.`);
      setLoadedModelId(actualModelId);
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
      messages: [{ id: 'sys_0', role: 'system', content: systemPrompt, timestamp: Date.now() }],
      modelId: selectedModelId,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    
    // 새 세션 시작 시 LLM 대화 컨텍스트 리셋
    llmAdapter.resetConversation?.();

    await storageAdapter.saveSession(newSession);
    setCurrentSession(newSession);
    await refreshSessionList();
    
    if (!isSilent) {
      toast.dismiss('session-action');
      toast.success('새 채팅이 시작되었습니다.', { toastId: 'session-action' });
    }
  };

  // 5. 대화 세션 복원
  const handleRestoreSession = async (sessionId: string) => {
    if (chatPhase === 'generating') return;
    const session = await storageAdapter.loadSession(sessionId);
    if (session) {
      setCurrentSession(session);
      // Validate modelId against registry
      const isValidModel = !!MODEL_REGISTRY[session.modelId];
      const newModelId = isValidModel ? session.modelId : initialModelId;
      if (loadedModelId !== newModelId) {
        setSelectedModelId(newModelId);
      }
      
      // 세션 전환 시 LLM 대화 컨텍스트 리셋
      llmAdapter.resetConversation?.();
    }
  };

  // 6. 대화 세션 물리 삭제
  const handleDeleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (chatPhase === 'generating') return;
    
    await storageAdapter.deleteSession(sessionId);
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

    const userMsg: ChatMessage = {
      id: `msg_${Date.now()}_u`,
      role: 'user',
      content: promptText,
      attachments: sentAttachments,
      timestamp: Date.now()
    };

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
      messages: [...workingSession.messages, { id: assistantMsgId, role: 'assistant', content: '', timestamp: Date.now() }]
    };
    setCurrentSession(workingSession);

    abortControllerRef.current = new AbortController();
    let fullResponse = '';
    let firstTokenTime: number | null = null;
    const startTime = performance.now();

    try {
      const chunks = llmAdapter.stream(updatedMessages, {
        temperature: 0.7,
        signal: abortControllerRef.current.signal
      });

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
          
          setCurrentSession(prev => {
            if (!prev) return null;
            const nextMsgs = prev.messages.map(m => 
              m.id === assistantMsgId ? { ...m, content: fullResponse } : m
            );
            return { ...prev, messages: nextMsgs };
          });
        } else if (chunk.type === 'done' && chunk.stats) {
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

      let finalTitle = workingSession.title;
      if (finalTitle === '새로운 대화' && promptText) {
        finalTitle = promptText.slice(0, 15) + (promptText.length > 15 ? '...' : '');
      }

      const finalSession: ChatSession = {
        ...workingSession,
        title: finalTitle,
        messages: workingSession.messages.map(m => 
          m.id === assistantMsgId ? { ...m, content: fullResponse } : m
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

  // 9. 모델 언로드 핸들러
  const handleUnloadModel = async () => {
    await llmAdapter.unload();
    setLoadedModelId(null);
    setChatPhase('idle');
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

  return (
    <div className="poc-container monorepo-web">
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
        <section className={`poc-sidebar ${!isSidebarOpen ? 'mini' : ''}`}>

          {/* ─── 영역 1 (최상단): 로고 + 토글 버튼 ─────────────── */}
          <div className="sidebar-header">
            {/* 로고: 펼침 상태에서는 텍스트, 미니 상태에서는 클릭 가능한 첫 글자 */}
            <div 
              className={`sidebar-logo ${!isSidebarOpen ? 'clickable' : ''}`}
              onClick={() => { if (!isSidebarOpen) setIsSidebarOpen(true); }}
            >
              {isSidebarOpen ? (
                <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-light)', letterSpacing: '-0.02em' }}>
                  Gemma<span style={{ color: 'var(--accent)' }}>4</span>
                </span>
              ) : (
                <span style={{ fontSize: '16px', fontWeight: 800, color: 'var(--accent)' }}>G</span>
              )}
            </div>

            {/* 토글 버튼: open 상태에서만 표시 (접기 화살표) */}
            {isSidebarOpen && (
              <button
                className="sidebar-toggle-btn"
                onClick={() => setIsSidebarOpen(false)}
                title="사이드바 접기"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 18l-6-6 6-6" />
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
                    {authSession?.user?.profileImageUrl ? (
                      <img 
                        src={authSession.user.profileImageUrl} 
                        alt="Profile" 
                        referrerPolicy="no-referrer"
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

                {/* 계정 관리 팝업 */}
                {isAccountMenuOpen && (
                  <div 
                    className="account-popover"
                    style={{
                      position: 'fixed',
                      bottom: '80px',
                      left: isSidebarOpen ? '16px' : '72px',
                      width: isSidebarOpen ? '248px' : '240px',
                      backgroundColor: 'var(--card-bg)',
                      border: '1px solid var(--card-border)',
                      borderRadius: '16px',
                      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.24)',
                      padding: '20px',
                      zIndex: 1000,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '16px',
                    }}
                  >
                    {/* 프로필 영역 */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: '8px' }}>
                      <div 
                        style={{
                          width: '56px',
                          height: '56px',
                          borderRadius: '50%',
                          backgroundColor: 'var(--accent)',
                          color: '#000',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '24px',
                          fontWeight: 700,
                          overflow: 'hidden',
                        }}
                      >
                        {authSession?.user?.profileImageUrl ? (
                          <img 
                            src={authSession.user.profileImageUrl} 
                            alt="Profile" 
                            referrerPolicy="no-referrer"
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                          />
                        ) : (
                          authSession?.user?.displayName?.charAt(0) || 'U'
                        )}
                      </div>
                      <div style={{ minWidth: 0, width: '100%' }}>
                        <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-light)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {authSession?.user?.displayName || '사용자'}
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '2px' }}>
                          {displayEmail}
                        </div>
                      </div>
                    </div>

                    {/* 여백 및 구분선 */}
                    <div style={{ height: '1px', backgroundColor: 'var(--card-border)', width: '100%' }} />

                    {/* 로그아웃 버튼 */}
                    <button
                      type="button"
                      className="btn btn-danger"
                      style={{
                        width: '100%',
                        padding: '10px 16px',
                        borderRadius: '10px',
                        fontSize: '13px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                      onClick={async () => {
                        console.log('로그아웃');
                        await authAdapter.logout();
                        setIsAccountMenuOpen(false);
                      }}
                    >
                      로그아웃
                    </button>
                  </div>
                )}

                <div style={{ display: 'flex', gap: '4px' }}>
                  {/* 설정 버튼 */}
                  <button 
                    className="sidebar-icon-btn" 
                    title="설정"
                    onClick={() => setIsSettingsOpen(true)}
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
            {/* 우측 상단 로그인 버튼 */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '16px 24px', flexShrink: 0 }}>
              <button
                type="button"
                className="btn btn-primary"
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
              <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: '8px', background: 'transparent', padding: '6px 12px', borderRadius: '12px', cursor: 'pointer' }}>
                <span style={{ fontSize: '18px', fontWeight: 500, color: 'var(--text-light)' }}>
                  {MODEL_REGISTRY[selectedModelId]?.label || selectedModelId}
                </span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-muted)' }}>
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
                {/* Note: 실제 셀렉트 기능은 커스텀 드롭다운으로 확장 가능하지만, 일단 투명한 네이티브 select를 겹쳐서 동작하게 함 */}
                <select
                  disabled={chatPhase === 'model-loading' || chatPhase === 'generating'}
                  value={selectedModelId}
                  onChange={(e) => {
                    const newModelId = e.target.value;
                    setSelectedModelId(newModelId);
                  }}
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}
                >
                  {Object.entries(MODEL_REGISTRY).map(([key, value]) => (
                    <option key={key} value={key}>{value.label}</option>
                  ))}
                </select>
              </div>
              
              
              {/* 모델 로드/언로드 상태 및 WebGPU 지원 여부 간략 표시 */}
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '12px' }}>
                {generationStats.tokensPerSec && (
                  <div style={{ fontSize: '11px', color: '#10b981', fontWeight: 600 }}>
                    Speed: {generationStats.tokensPerSec} t/s
                  </div>
                )}
                {/* Dummy usage for setSystemPrompt to pass TS check */}
                <div style={{ display: 'none' }} onClick={() => setSystemPrompt('')}>{systemPrompt}</div>

                {!loadedModelId ? (
                  <button 
                    type="button" 
                    className="btn btn-primary btn-sm" 
                    onClick={() => handleLoadModel()}
                    disabled={chatPhase === 'model-loading' || webGpuState.supported === false}
                    style={{ borderRadius: '999px', padding: '6px 16px', fontSize: '13px' }}
                  >
                    {chatPhase === 'model-loading' ? '모델 준비 중...' : '모델 로드'}
                  </button>
                ) : (
                  <button 
                    type="button" 
                    className="btn btn-secondary btn-sm" 
                    onClick={handleUnloadModel}
                    disabled={chatPhase === 'generating'}
                    style={{ borderRadius: '999px', padding: '6px 16px', fontSize: '13px', background: 'rgba(255,255,255,0.05)', color: 'var(--text-light)', border: 'none' }}
                  >
                    언로드
                  </button>
                )}
              </div>
            </div>

            {/* 메인 대화창 뷰포트 */}
            {webGpuState.supported === false && (
              <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', padding: '12px 24px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid rgba(239, 68, 68, 0.2)' }}>
                <span style={{ fontSize: '16px' }}>⚠️</span> {webGpuState.error}
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
                    
                    <div className="prompt-grid">
                      <div className="gemini-prompt-card" onClick={() => setInput('현재 선택된 Gemma 모델의 강점은 무엇인가요?')}>
                        <span className="icon">✨</span>
                        <p>현재 선택된 모델의 강점은 무엇인가요?</p>
                      </div>
                      <div className="gemini-prompt-card" onClick={() => setInput('리액트 네이티브에서 WebGPU를 사용할 수 있는 방법론을 설명해줘.')}>
                        <span className="icon">📱</span>
                        <p>모바일 기기 내장 WebGPU 활용 방안</p>
                      </div>
                      <div className="gemini-prompt-card" onClick={() => setInput('온디바이스 AI의 프라이버시 이점 3가지를 요약해줘.')}>
                        <span className="icon">🔒</span>
                        <p>온디바이스 AI의 프라이버시 이점 요약</p>
                      </div>
                      <div className="gemini-prompt-card" onClick={() => setInput('최신 프론트엔드 모노레포 아키텍처 트렌드를 알려줘.')}>
                        <span className="icon">🏗️</span>
                        <p>최신 프론트엔드 모노레포 아키텍처</p>
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
                onClick={() => setActiveSettingsTab('notifications')}
                className={`settings-tab-btn ${activeSettingsTab === 'notifications' ? 'active' : ''}`}
              >
                알림
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
                  {activeSettingsTab === 'general' && '일반 설정'}
                  {activeSettingsTab === 'theme' && '테마 설정'}
                  {activeSettingsTab === 'notifications' && '알림 설정'}
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

              {/* 탭별 내용 */}
              {activeSettingsTab === 'general' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  {/* 프로필 이미지 영역 - 카메라 아이콘 없음 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginBottom: '12px' }}>
                    <div 
                      style={{
                        width: '72px',
                        height: '72px',
                        borderRadius: '50%',
                        backgroundColor: 'var(--accent)',
                        color: '#000',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '32px',
                        fontWeight: 700,
                        flexShrink: 0,
                        overflow: 'hidden',
                      }}
                    >
                      {authSession?.user?.profileImageUrl ? (
                        <img 
                          src={authSession.user.profileImageUrl} 
                          alt="Profile" 
                          referrerPolicy="no-referrer"
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                        />
                      ) : (
                        authSession?.user?.displayName?.charAt(0) || 'U'
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <span style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-light)' }}>프로필 사진</span>
                      <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>기본 아바타 이미지가 사용 중입니다.</span>
                    </div>
                  </div>

                  {/* 입력 필드들 - readOnly & disabled */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-light)' }}>사용자 이름</label>
                      <input 
                        type="text" 
                        value={authSession?.user?.displayName || '사용자'} 
                        readOnly 
                        disabled
                        className="settings-readonly-input"
                      />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-light)' }}>이메일 주소</label>
                      <input 
                        type="text" 
                        value={displayEmail} 
                        readOnly 
                        disabled
                        className="settings-readonly-input"
                      />
                    </div>

                    {/* 탈퇴하기 버튼 - 생일 입력 필드 대체 */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '12px' }}>
                      <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-light)' }}>계정 탈퇴</label>
                      <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                        <button
                          type="button"
                          className="btn btn-danger"
                          style={{
                            padding: '10px 16px',
                            borderRadius: '10px',
                            fontSize: '13px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            width: 'auto',
                          }}
                          onClick={async () => {
                            if (confirm('정말로 탈퇴하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) {
                              console.log('탈퇴하기');
                              await authAdapter.deleteAccount();
                              setIsSettingsOpen(false);
                            }
                          }}
                        >
                          탈퇴하기
                        </button>
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                          계정을 삭제하고 서비스 이용 정보를 영구 삭제합니다.
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeSettingsTab === 'theme' && (
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

              {activeSettingsTab === 'notifications' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <p style={{ fontSize: '14px', color: 'var(--text-muted)' }}>알림 수신 설정을 변경합니다.</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '14px', color: 'var(--text-light)' }}>
                      <input type="checkbox" defaultChecked />
                      <span>이메일 공지사항 및 기능 업데이트 수신</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '14px', color: 'var(--text-light)' }}>
                      <input type="checkbox" defaultChecked />
                      <span>브라우저 데스크톱 푸시 알림 수신</span>
                    </label>
                  </div>
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
    </div>
  );
}
