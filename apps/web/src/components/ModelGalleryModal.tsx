import React from 'react';

interface ModelGalleryModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentLoadedModelId: string | null;
  selectedModelId: string;
  isLoading?: boolean;
  onSelectAndLoadModel: (modelId: string) => void;
}

interface ModelMeta {
  id: string;
  name: string;
  badge: string;
  sizeLabel: string;
  ramLabel: string;
  description: string;
  licenseUrl: string;
}

const MODEL_CATALOG_WEB: ModelMeta[] = [
  {
    id: 'gemma4-e2b',
    name: 'Gemma 4 E2B',
    badge: '저사양 추천',
    sizeLabel: 'ssd 용량: 900 MB',
    ramLabel: '최소 RAM 4GB',
    description: '모바일 및 저사양 기기 환경에 최적화된 경량화 Gemma 4 모델입니다. 빠른 응답속도와 효율적인 메모리 사용이 특징입니다.',
    licenseUrl: 'https://ai.google.dev/gemma/docs/core/model_card_4?hl=ko',
  },
  {
    id: 'gemma4-e4b',
    name: 'Gemma 4 E4B',
    badge: '고사양 추천',
    sizeLabel: 'ssd 용량: 1.8 GB',
    ramLabel: '최소 RAM 6GB',
    description: '복잡한 연산 및 긴 맥락 처리에 뛰어난 고성능 Gemma 4 모델입니다. 우수한 추론 능력과 코딩 및 작문 능력을 제공합니다.',
    licenseUrl: 'https://ai.google.dev/gemma/docs/core/model_card_4?hl=ko',
  },
];

export const ModelGalleryModal: React.FC<ModelGalleryModalProps> = ({
  isOpen,
  onClose,
  currentLoadedModelId,
  selectedModelId: _selectedModelId,
  isLoading = false,
  onSelectAndLoadModel,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="model-gallery-overlay"
      onClick={onClose}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(8px)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
    >
      <div
        className="model-gallery-container"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '740px',
          maxWidth: '100%',
          maxHeight: '90vh',
          backgroundColor: 'var(--bg)',
          border: '1px solid var(--card-border)',
          borderRadius: '20px',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'settingsScaleUp 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
      >
        {/* Header Bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '20px 24px',
            borderBottom: '1px solid var(--card-border)',
            backgroundColor: 'var(--sidebar-bg)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                backgroundColor: 'rgba(59, 130, 246, 0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#3b82f6',
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            </div>
            <div>
              <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-light)', margin: 0 }}>
                모델 선택
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: '6px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body content */}
        <div style={{ padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {MODEL_CATALOG_WEB.map((model) => {
              const isLoaded = currentLoadedModelId === model.id;

              return (
                <div
                  key={model.id}
                  style={{
                    backgroundColor: 'var(--card-bg)',
                    border: isLoaded ? '2px solid #3b82f6' : '1px solid var(--card-border)',
                    borderRadius: '16px',
                    padding: '20px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                    position: 'relative',
                    transition: 'border-color 0.2s, box-shadow 0.2s',
                    boxShadow: isLoaded ? '0 4px 20px rgba(59, 130, 246, 0.15)' : 'none',
                  }}
                >
                  {/* Badge & Tag */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span
                      style={{
                        backgroundColor: 'rgba(234, 179, 8, 0.12)',
                        color: '#eab308',
                        fontSize: '12px',
                        fontWeight: 600,
                        padding: '4px 10px',
                        borderRadius: '20px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      <span>⭐</span> {model.badge}
                    </span>

                    {isLoaded && (
                      <span
                        style={{
                          backgroundColor: 'rgba(16, 185, 129, 0.12)',
                          color: '#10b981',
                          fontSize: '12px',
                          fontWeight: 600,
                          padding: '4px 10px',
                          borderRadius: '20px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        ✓ 현재 로드됨
                      </span>
                    )}
                  </div>

                  {/* Model Name */}
                  <h4 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-light)', margin: 0 }}>
                    {model.name}
                  </h4>

                  {/* Specs & Memory Info */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '13px', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      {model.sizeLabel}
                    </span>
                    <span>•</span>
                    <span>{model.ramLabel}</span>
                  </div>

                  {/* Learn more link */}
                  <a
                    href={model.licenseUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontSize: '13px',
                      color: '#3b82f6',
                      textDecoration: 'none',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontWeight: 500,
                    }}
                  >
                    <span>Learn more and see model license</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </a>

                  {/* Description */}
                  <p style={{ fontSize: '13.5px', color: 'var(--text-muted)', lineHeight: '1.5', margin: 0 }}>
                    {model.description}
                  </p>

                  {/* Action Button */}
                  <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'flex-end' }}>
                    {isLoaded ? (
                      <button
                        type="button"
                        disabled
                        style={{
                          width: '100%',
                          padding: '12px 20px',
                          borderRadius: '24px',
                          backgroundColor: 'rgba(16, 185, 129, 0.1)',
                          color: '#10b981',
                          border: '1px solid rgba(16, 185, 129, 0.3)',
                          fontSize: '14px',
                          fontWeight: 700,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px',
                          cursor: 'default',
                        }}
                      >
                        <span>✓ 사용 중 (로드 완료됨)</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={isLoading}
                        onClick={() => onSelectAndLoadModel(model.id)}
                        style={{
                          width: '100%',
                          padding: '12px 20px',
                          borderRadius: '24px',
                          backgroundColor: isLoading ? '#93c5fd' : '#1A73E8',
                          color: '#ffffff',
                          border: 'none',
                          fontSize: '14px',
                          fontWeight: 700,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px',
                          cursor: isLoading ? 'not-allowed' : 'pointer',
                          transition: 'background-color 0.2s',
                        }}
                      >
                        <span>{isLoading ? '로딩 중...' : 'Try it'}</span>
                        {!isLoading && (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="5" y1="12" x2="19" y2="12" />
                            <polyline points="12 5 19 12 12 19" />
                          </svg>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
