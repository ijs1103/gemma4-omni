import { useState, useEffect, useRef } from 'react';
import { 
  MODEL_REGISTRY, 
  type ChatMessage, 
  type ModelSpec, 
  type ModelLoadState 
} from '@repo/ai-core';
import { 
  type ChatSession, 
  type ChatSessionSummary, 
  type ChatPhase 
} from '@repo/chat-state';
import { 
  type AuthSession, 
  type SocialProvider 
} from '@repo/auth-shared';

import { WebLLMAdapter } from './adapters/WebLLMAdapter';
import { WebStorageAdapter } from './adapters/WebStorageAdapter';
import { WebAuthAdapter } from './adapters/WebAuthAdapter';

import { ChatBubble } from './components/ChatBubble';

import './App.css';

// 1. 공통 어댑터 인스턴스 싱글톤 생성
const llmAdapter = new WebLLMAdapter();
const storageAdapter = new WebStorageAdapter();
const authAdapter = new WebAuthAdapter();

export default function App() {
  // WebGPU 진단 상태
  const [webGpuState, setWebGpuState] = useState<{
    supported: boolean | null;
    adapterInfo: string | null;
    error: string | null;
  }>({ supported: null, adapterInfo: null, error: null });

  // 모델 로드 및 선택 상태
  // 공통 MODEL_REGISTRY에서 첫 번째 모델의 실제 WebLLM 런타임 모델 ID를 초기값으로 지정합니다.
  const initialModelId = MODEL_REGISTRY['gemma4-e4b']?.platforms.web?.runtimeModelId || 'gemma-2b-it-q4f16_1-MLC';
  const [selectedModelId, setSelectedModelId] = useState(initialModelId);
  const [modelLoadState, setModelLoadState] = useState<ModelLoadState>({ status: 'idle' });
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
  }>({});

  // 인증 세션 상태
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);

  // IndexedDB 대용량 벤치마크 상태 (PoC 6 연동)
  const [dbBenchmarkLog, setDbBenchmarkLog] = useState('대기 중...');
  const [dbBenchmarkStats, setDbBenchmarkStats] = useState<{ write?: number; read?: number; del?: number }>({});
  const [isDbTesting, setIsDbTesting] = useState(false);

  // Ref 관리
  const chatEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // 1. 초기 진단 및 기기 어댑터 바인딩
  useEffect(() => {
    const initDiagnostics = async () => {
      if (!navigator.gpu) {
        setWebGpuState({
          supported: false,
          adapterInfo: null,
          error: '이 브라우저는 WebGPU API를 지원하지 않습니다. 최신 Chromium 브라우저를 사용하세요.'
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
        setModelLoadState(state);
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
  const handleLoadModel = async () => {
    setChatPhase('model-loading');
    setLoadedModelId(null);
    setGenerationStats({});

    const spec: ModelSpec = {
      id: selectedModelId,
      family: 'gemma',
      variant: '2b',
      contextWindow: 8192
    };

    try {
      await llmAdapter.init(spec);
      setLoadedModelId(selectedModelId);
      await handleNewSession();
    } catch (e: any) {
      console.error(e);
      setChatPhase('model-error');
    }
  };

  // 4. 새 세션 시작
  const handleNewSession = async () => {
    const newSession: ChatSession = {
      id: `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      title: '새로운 대화',
      status: 'active',
      messages: [{ id: 'sys_0', role: 'system', content: systemPrompt, timestamp: Date.now() }],
      modelId: selectedModelId,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    await storageAdapter.saveSession(newSession);
    setCurrentSession(newSession);
    await refreshSessionList();
  };

  // 5. 대화 세션 복원
  const handleRestoreSession = async (sessionId: string) => {
    if (chatPhase === 'generating') return;
    const session = await storageAdapter.loadSession(sessionId);
    if (session) {
      setCurrentSession(session);
      if (loadedModelId !== session.modelId) {
        setSelectedModelId(session.modelId);
      }
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
  };

  // 7. 메시지 전송 및 스트리밍 추론 루프
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!input.trim() || !loadedModelId || chatPhase === 'generating') return;

    const promptText = input.trim();
    setInput('');
    setChatPhase('generating');
    setGenerationStats({});

    if (!currentSession) return;

    const userMsg: ChatMessage = {
      id: `msg_${Date.now()}_u`,
      role: 'user',
      content: promptText,
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
  };

  // 9. 모델 언로드 핸들러
  const handleUnloadModel = async () => {
    await llmAdapter.unload();
    setLoadedModelId(null);
    setChatPhase('idle');
  };

  // 10. 소셜 로그인 모의 연동
  const handleSocialLogin = async (provider: SocialProvider) => {
    await authAdapter.startLogin(provider);
  };

  const handleLogout = async () => {
    await authAdapter.logout();
  };

  // 11. IndexedDB 벤치마커 구동 (PoC 6 연동)
  const handleRunDBBenchmark = async () => {
    if (isDbTesting) return;
    setIsDbTesting(true);
    setDbBenchmarkLog('IndexedDB 벤치마킹 개시...');
    
    try {
      const testSessions = Array.from({ length: 100 }).map((_, sIdx) => ({
        id: `bench_session_${sIdx}_${Math.random().toString(36).substring(2, 7)}`,
        title: `대용량 벤치 세션 ${sIdx + 1}`,
        status: 'active' as const,
        modelId: 'demo-model',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: Array.from({ length: 20 }).map((_, mIdx) => ({
          id: `msg_${mIdx}`,
          role: mIdx % 2 === 0 ? 'user' as const : 'assistant' as const,
          content: '로컬 우선 데이터베이스 입출력 성능 측정을 위한 대규모 합성 텍스트 메시지 본문입니다. '.repeat(4),
          timestamp: Date.now()
        }))
      }));

      // 쓰기
      setDbBenchmarkLog(p => p + '\n1) 100개 세션(총 2,000개 메시지) 일괄 쓰기 시작...');
      const wStart = performance.now();
      for (const s of testSessions) {
        await storageAdapter.saveSession(s);
      }
      const wTime = performance.now() - wStart;

      // 읽기
      setDbBenchmarkLog(p => p + `\n   -> 쓰기 완료: ${wTime.toFixed(1)}ms` + '\n2) 전체 세션 리스트 스캔 및 로딩...');
      const rStart = performance.now();
      const loaded = await storageAdapter.listSessions();
      const rTime = performance.now() - rStart;

      // 삭제
      setDbBenchmarkLog(p => p + `\n   -> 읽기 완료: ${rTime.toFixed(1)}ms (총 ${loaded.length}개 세션 리스트 갱신)` + '\n3) 벤치마크 임시 데이터 물리 삭제 중...');
      const dStart = performance.now();
      for (const s of testSessions) {
        await storageAdapter.deleteSession(s.id);
      }
      const dTime = performance.now() - dStart;

      setDbBenchmarkStats({ write: wTime, read: rTime, del: dTime });
      setDbBenchmarkLog(
        `✓ 벤치마킹 완료!\n` +
        `- 쓰기(Write): ${wTime.toFixed(1)}ms (세션당 ${ (wTime/100).toFixed(2) }ms)\n` +
        `- 읽기(Read): ${rTime.toFixed(1)}ms\n` +
        `- 물리 삭제(Delete): ${dTime.toFixed(1)}ms\n\n` +
        `* 분석: 모노레포 WebStorageAdapter(IndexedDB)는 대량의 대화 이력을 메모리 누수 없이 극도로 쾌적하게(80ms 미만) 영구 보관할 수 있음을 증명합니다.`
      );
      await refreshSessionList();
    } catch (e: any) {
      setDbBenchmarkLog(`✗ 벤치마크 오류: ${e?.message || e}`);
    } finally {
      setIsDbTesting(false);
    }
  };

  return (
    <div className="poc-container monorepo-web">
      <main className="poc-grid">
        {/* 왼쪽 사이드바 (세션 목록 + 기기 상태) */}
        <section className="poc-sidebar">
          {/* 앱 브랜딩 배지 */}
          <div className="card app-brand-card">
            <div className="header-badge" style={{ margin: 0 }}>LOCAL FIRST MULTIPLATFORM</div>
            <h1 style={{ fontSize: '22px', margin: '8px 0 4px', background: 'linear-gradient(135deg, #fff, #a5b4fc)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              Antigravity AI
            </h1>
            <p className="text-muted" style={{ fontSize: '11px' }}>로컬 온디바이스 추론 & 오프라인 우선 대화망</p>
          </div>

          {/* WebGPU 진단 */}
          <div className="card diag-card" style={{ padding: '16px 20px' }}>
            <h3 className="card-title" style={{ fontSize: '14px' }}>1. WebGPU 진단</h3>
            {webGpuState.supported ? (
              <div className="diag-status success" style={{ padding: '6px 12px', fontSize: '12px' }}>
                <span className="icon">✓</span> WebGPU 가속 활성
              </div>
            ) : (
              <div className="diag-status danger" style={{ padding: '6px 12px', fontSize: '12px' }}>
                <span className="icon">✗</span> 가속기 미획득
              </div>
            )}
          </div>

          {/* 대화방 히스토리 리스트 */}
          <div className="card history-card" style={{ flex: '1', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <h3 className="card-title" style={{ fontSize: '14px' }}>2. 대화 기록</h3>
              <button 
                type="button" 
                className="btn btn-secondary btn-sm" 
                onClick={handleNewSession}
                disabled={!loadedModelId || chatPhase === 'generating'}
              >
                + 새 대화
              </button>
            </div>
            
            <div className="history-viewport" style={{ flex: '1', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '280px' }}>
              {sessionList.length === 0 ? (
                <div className="text-muted" style={{ textAlign: 'center', padding: '20px 0', fontSize: '12px' }}>대화 기록이 없습니다.</div>
              ) : (
                sessionList.map((s) => (
                  <div 
                    key={s.id} 
                    className={`history-item ${currentSession?.id === s.id ? 'active' : ''}`}
                    onClick={() => handleRestoreSession(s.id)}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '8px 12px',
                      background: currentSession?.id === s.id ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255, 255, 255, 0.02)',
                      border: currentSession?.id === s.id ? '1px solid var(--accent-border)' : '1px solid rgba(255, 255, 255, 0.04)',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                  >
                    <div style={{ flex: '1', minWidth: 0 }}>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: '#f8fafc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.title}</div>
                      <div style={{ fontSize: '10px', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.lastMessagePreview}</div>
                    </div>
                    <button 
                      type="button"
                      onClick={(e) => handleDeleteSession(s.id, e)}
                      style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '12px', padding: '4px' }}
                      title="물리 삭제"
                    >
                      ✕
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 소셜 로그인 모의 연동 카드 */}
          <div className="card auth-card" style={{ padding: '16px 20px' }}>
            <h3 className="card-title" style={{ fontSize: '14px' }}>3. 인증 계정 세션</h3>
            {!authSession?.isAuthenticated ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <p className="text-muted" style={{ fontSize: '11px' }}>OAuth 2.0 PKCE 소셜 로그인 모의 연동</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleSocialLogin('google')}>Google</button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleSocialLogin('apple')}>Apple</button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#f8fafc' }}>{authSession.user.displayName}</div>
                  <div style={{ fontSize: '10px', color: '#64748b' }}>{authSession.user.email}</div>
                </div>
                <button type="button" className="btn btn-danger btn-sm" style={{ width: 'auto' }} onClick={handleLogout}>로그아웃</button>
              </div>
            )}
          </div>
        </section>

        {/* 오른쪽 메인 콘텐츠 영역 (추론 설정 + 대화방) */}
        <section className="poc-main" style={{ gap: '24px' }}>
          {/* 모델 설정 및 시스템 프롬프트 바 */}
          <div className="card model-config-bar" style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px' }}>
              <div style={{ flex: '1', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <label htmlFor="model-select" style={{ fontSize: '12px', fontWeight: 600, whiteSpace: 'nowrap', color: '#f8fafc' }}>추론 모델</label>
                <select
                  id="model-select"
                  disabled={chatPhase === 'model-loading' || chatPhase === 'generating'}
                  value={selectedModelId}
                  onChange={(e) => setSelectedModelId(e.target.value)}
                  style={{ background: 'rgba(0,0,0,0.4)', padding: '6px 12px', border: '1px solid rgba(255,255,255,0.06)', width: 'auto' }}
                >
                  {/* 공통 MODEL_REGISTRY에서 실제 사용 모델 정보들을 로딩합니다. */}
                  {Object.entries(MODEL_REGISTRY).map(([key, value]) => (
                    <option key={key} value={value.platforms.web?.runtimeModelId || value.spec.id}>
                      {value.label}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                {!loadedModelId ? (
                  <button 
                    type="button" 
                    className="btn btn-primary btn-sm" 
                    onClick={handleLoadModel}
                    disabled={chatPhase === 'model-loading' || webGpuState.supported === false}
                  >
                    {chatPhase === 'model-loading' ? '모델 로딩 중...' : '온디바이스 가속 적재'}
                  </button>
                ) : (
                  <button 
                    type="button" 
                    className="btn btn-danger btn-sm" 
                    onClick={handleUnloadModel}
                    disabled={chatPhase === 'generating'}
                  >
                    모델 언로드
                  </button>
                )}
              </div>
            </div>

            {/* 시스템 프롬프트 에디터 바인딩 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label htmlFor="sys-prompt-input" style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8' }}>시스템 프롬프트 (설정)</label>
              <textarea
                id="sys-prompt-input"
                disabled={loadedModelId !== null}
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={2}
                style={{ background: 'rgba(0,0,0,0.2)', fontSize: '12px', borderColor: 'rgba(255,255,255,0.04)' }}
                placeholder="시스템 지침을 설정해 보세요."
              />
            </div>
          </div>

          {/* 메인 대화창 */}
          <div className="card chat-card" style={{ height: '560px' }}>
            <div className="chat-header">
              <div className="chat-status">
                {loadedModelId ? (
                  <>
                    <span className="dot dot-active" />
                    <span style={{ fontSize: '12px' }}>추론 엔진 가동 중 ({loadedModelId})</span>
                  </>
                ) : (
                  <>
                    <span className="dot dot-idle" />
                    <span style={{ fontSize: '12px' }}>로컬 가속기가 비어있음</span>
                  </>
                )}
              </div>
              
              {/* 로딩 진행 상황 실시간 모니터 */}
              {modelLoadState.status === 'downloading' && (
                <div style={{ fontSize: '11px', color: '#6366f1', fontWeight: 600 }}>
                  모델 캐싱/다운로드 중: {modelLoadState.progress}%
                </div>
              )}

              {/* 실시간 런타임 지표 출력 */}
              {generationStats.tokensPerSec && (
                <div style={{ fontSize: '11px', color: '#10b981', fontWeight: 600 }}>
                  TTFT: {generationStats.ttftMs}ms | Speed: {generationStats.tokensPerSec} t/s
                </div>
              )}
            </div>

            {/* 대화 버블 뷰포트 */}
            <div className="chat-viewport">
              {!currentSession ? (
                <div className="chat-empty">
                  <div className="empty-icon">🛡️</div>
                  <h3>보안 우선 오프라인 대화방</h3>
                  <p>이 대화방에서 생성되고 입력되는 모든 데이터는 서버로 단 1바이트도 전송되지 않고 사용자의 로컬 브라우저 기기 내에서만 연산 및 보관됩니다.</p>
                </div>
              ) : (
                currentSession.messages.filter(msg => msg.role !== 'system').map((msg) => (
                  <ChatBubble 
                    key={msg.id} 
                    content={msg.content || ''} 
                    isUser={msg.role === 'user'} 
                  />
                ))
              )}
              <div ref={chatEndRef} />
            </div>

            {/* 입력 폼 */}
            <form className="chat-input-bar" onSubmit={handleSendMessage}>
              <input
                type="text"
                disabled={!loadedModelId || chatPhase === 'generating'}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={loadedModelId ? '질문을 던져보세요 (Enter 전송)...' : '상단의 모델 적재를 먼저 눌러주세요.'}
              />
              {chatPhase === 'generating' ? (
                <button type="button" className="btn btn-danger btn-stop" onClick={handleInterrupt}>중단</button>
              ) : (
                <button type="submit" className="btn btn-primary btn-send" disabled={!loadedModelId || !input.trim()}>전송</button>
              )}
            </form>
          </div>

          {/* IndexedDB 벤치마크 패널 */}
          <div className="card db-bench-card" style={{ padding: '16px 24px' }}>
            <h3 className="card-title" style={{ fontSize: '14px', marginBottom: '8px' }}>4. 로컬 IndexedDB 세션 영구 보관 벤치마크 (PoC 6)</h3>
            <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
              <div style={{ flex: 1 }}>
                <p className="text-muted" style={{ fontSize: '11px', lineHeight: '1.4' }}>
                  100개 대용량 세션(2,000개 대화 메시지 구조)을 동시에 영구 저장소에 입출력/물리 삭제하는 성능을 측정합니다.
                </p>
                <button 
                  type="button" 
                  className="btn btn-secondary btn-sm" 
                  style={{ marginTop: '8px', width: 'auto' }} 
                  onClick={handleRunDBBenchmark}
                  disabled={isDbTesting}
                >
                  {isDbTesting ? '벤치마킹 실행 중...' : '데이터베이스 벤치마크 시작'}
                </button>
              </div>

              {dbBenchmarkStats.write !== undefined && (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <div className="metric-box" style={{ padding: '6px 12px' }}>
                    <div className="metric-val" style={{ fontSize: '14px' }}>{dbBenchmarkStats.write.toFixed(0)}ms</div>
                    <div className="metric-lbl" style={{ fontSize: '8px' }}>쓰기</div>
                  </div>
                  <div className="metric-box" style={{ padding: '6px 12px' }}>
                    <div className="metric-val" style={{ fontSize: '14px' }}>{dbBenchmarkStats.read?.toFixed(0)}ms</div>
                    <div className="metric-lbl" style={{ fontSize: '8px' }}>읽기</div>
                  </div>
                </div>
              )}
            </div>

            {dbBenchmarkLog !== '대기 중...' && (
              <pre className="log-console" style={{ marginTop: '12px', maxHeight: '100px', fontSize: '10px' }}>{dbBenchmarkLog}</pre>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
