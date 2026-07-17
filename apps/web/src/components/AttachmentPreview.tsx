import React from 'react';
import type { Attachment } from '@repo/ai-core';

interface AttachmentPreviewProps {
  attachments: Attachment[];
  onRemove: (id: string) => void;
}

export const AttachmentPreview: React.FC<AttachmentPreviewProps> = ({ attachments, onRemove }) => {
  console.log('[AttachmentPreview] rendering attachments:', attachments);
  if (attachments.length === 0) return null;

  return (
    <div className="attachments-preview-container">
      <div className="attachments-preview-scroll">
        {attachments.map((attachment) => {
          console.log('[AttachmentPreview] Rendering item:', attachment.name, 'type:', attachment.type, 'uri:', attachment.uri);
          return (
            <div key={attachment.id} className="attachment-preview-item">
              {attachment.type === 'image' ? (
                <img
                  src={attachment.uri}
                  alt={attachment.name}
                  className="attachment-preview-image"
                  onError={(e) => {
                    console.error('[AttachmentPreview] Failed to load preview image:', attachment.uri, e);
                  }}
                />
              ) : (
                <div className="attachment-preview-doc">
                  <span className="attachment-preview-doc-icon">📄</span>
                </div>
              )}
              <button
                type="button"
                className="attachment-remove-btn"
                onClick={() => onRemove(attachment.id)}
                aria-label={`${attachment.name} 삭제`}
              >
                ✕
              </button>
              <span className="attachment-preview-name" title={attachment.name}>
                {attachment.name}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
