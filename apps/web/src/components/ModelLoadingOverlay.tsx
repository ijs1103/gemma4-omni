import { useEffect, useState } from 'react';

interface ModelLoadingOverlayProps {
  isVisible: boolean;
  modelName?: string;
  onCancel?: () => void;
}

const STAGES = [
  { label: 'WebGPU 컨텍스트 초기화 중', duration: 4000 },
  { label: '모델 헤더 및 메타데이터 로딩', duration: 8000 },
  { label: '토크나이저 초기화 중', duration: 5000 },
  { label: '모델 가중치 GPU 메모리에 업로드 중', duration: 45000 },
  { label: '셰이더 컴파일 및 최적화 중', duration: 12000 },
];

const TIPS = [
  '브라우저를 처음 로드하는 경우, 모델 파일을 다운로드하는 데 시간이 걸릴 수 있습니다.',
  '한 번 로드된 모델은 브라우저 캐시에 저장되어 다음 방문 시 더 빠르게 실행됩니다.',
  '모든 대화는 서버에 저장되지 않으며, 오직 내 기기에서만 처리됩니다.',
  'WebGPU를 통해 GPU를 직접 활용하기 때문에 CPU 대비 수십 배 빠른 추론이 가능합니다.',
  '로딩이 완료되면 인터넷 연결 없이도 AI와 대화할 수 있습니다.',
];

export function ModelLoadingOverlay({ isVisible, modelName = 'AI 모델', onCancel }: ModelLoadingOverlayProps) {
  const [stageIndex, setStageIndex] = useState(0);
  const [tipIndex, setTipIndex] = useState(0);
  const [tipFade, setTipFade] = useState(true);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [startTime, setStartTime] = useState<number | null>(null);

  // Reset timer and simulate stage progression when isVisible becomes true
  useEffect(() => {
    if (!isVisible) {
      setStageIndex(0);
      setElapsedMs(0);
      setStartTime(null);
      return;
    }

    const now = Date.now();
    setStartTime(now);
    setElapsedMs(0);
    setStageIndex(0);

    let cumulative = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    STAGES.forEach((stage, i) => {
      const t = setTimeout(() => {
        setStageIndex(i);
      }, cumulative);
      timers.push(t);
      cumulative += stage.duration;
    });

    return () => timers.forEach(clearTimeout);
  }, [isVisible]);

  // Elapsed time ticker
  useEffect(() => {
    if (!isVisible || startTime === null) return;
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - startTime);
    }, 1000);
    return () => clearInterval(interval);
  }, [isVisible, startTime]);

  // Rotating tips
  useEffect(() => {
    if (!isVisible) return;
    const interval = setInterval(() => {
      setTipFade(false);
      setTimeout(() => {
        setTipIndex((prev) => (prev + 1) % TIPS.length);
        setTipFade(true);
      }, 400);
    }, 5000);
    return () => clearInterval(interval);
  }, [isVisible]);

  if (!isVisible) return null;

  const elapsedSec = Math.floor(elapsedMs / 1000);

  return (
    <div className="model-loading-overlay">
      {/* Animated background blobs */}
      <div className="loading-bg-blob loading-bg-blob-1" />
      <div className="loading-bg-blob loading-bg-blob-2" />
      <div className="loading-bg-blob loading-bg-blob-3" />

      <div className="loading-content">
        {/* AI Orb */}
        <div className="loading-orb-wrapper">
          <div className="loading-orb">
            <div className="loading-orb-inner" />
            <div className="loading-orb-ring loading-orb-ring-1" />
            <div className="loading-orb-ring loading-orb-ring-2" />
            <div className="loading-orb-ring loading-orb-ring-3" />
          </div>
        </div>

        {/* Title */}
        <h1 className="loading-title">
          <span className="loading-title-gradient">{modelName}</span>
          <br />
          <span>을 준비하고 있습니다</span>
        </h1>
        <p className="loading-subtitle">
          처음 로드 시 GPU에 모델 가중치를 업로드하는 과정이 포함되어<br />
          약 <strong>1~2분</strong> 정도 소요됩니다.
        </p>

        {/* Elapsed time */}
        <div className="loading-elapsed">
          경과 시간: {elapsedSec}초
        </div>

        {/* Stages */}
        <div className="loading-stages">
          {STAGES.map((stage, i) => {
            const isDone = i < stageIndex;
            const isCurrent = i === stageIndex;
            return (
              <div
                key={i}
                className={`loading-stage-item ${isDone ? 'done' : ''} ${isCurrent ? 'current' : ''}`}
              >
                <div className="loading-stage-dot">
                  {isDone ? (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : isCurrent ? (
                    <div className="loading-stage-spinner" />
                  ) : null}
                </div>
                <span className="loading-stage-label">{stage.label}</span>
              </div>
            );
          })}
        </div>

        {/* Progress bar */}
        <div className="loading-progress-track">
          <div
            className="loading-progress-bar"
            style={{ width: `${((stageIndex + 1) / STAGES.length) * 100}%` }}
          />
        </div>

        {/* Tip */}
        <div className={`loading-tip ${tipFade ? 'tip-visible' : 'tip-hidden'}`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: '1px' }}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{TIPS[tipIndex]}</span>
        </div>

        {/* Cancel button */}
        {onCancel && (
          <button
            type="button"
            className="loading-cancel-btn"
            onClick={onCancel}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            <span>로딩 취소</span>
          </button>
        )}
      </div>
    </div>
  );
}
