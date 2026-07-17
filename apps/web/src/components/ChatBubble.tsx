import React, { useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { toast } from 'react-toastify';
import type { Attachment } from '@repo/ai-core';

interface ChatBubbleProps {
  content: string;
  isUser: boolean;
  isThinking?: boolean;
  isInterrupted?: boolean;
  attachments?: Attachment[];
}

const fallbackCopyTextToClipboard = (text: string) => {
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.style.top = "0";
  textArea.style.left = "0";
  textArea.style.position = "fixed";

  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  try {
    const successful = document.execCommand('copy');
    toast.dismiss('copy-toast');
    if (successful) {
      toast.success('채팅이 복사되었습니다.', { toastId: 'copy-toast' });
    } else {
      toast.error('복사에 실패했습니다.', { toastId: 'copy-toast' });
    }
  } catch (err) {
    console.error('Fallback copy failed', err);
    toast.dismiss('copy-toast');
    toast.error('복사에 실패했습니다.', { toastId: 'copy-toast' });
  }

  document.body.removeChild(textArea);
};

export const ChatBubble: React.FC<ChatBubbleProps> = ({
  content,
  isUser,
  isThinking = false,
  isInterrupted = false,
  attachments,
}) => {
  const handleCopy = useCallback(() => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(content)
        .then(() => {
          toast.dismiss('copy-toast');
          toast.success('채팅이 복사되었습니다.', { toastId: 'copy-toast' });
        })
        .catch((err) => {
          console.error('Failed to copy: ', err);
          fallbackCopyTextToClipboard(content);
        });
    } else {
      fallbackCopyTextToClipboard(content);
    }
  }, [content]);

  return (
    <div className="bubble-wrapper">
      <div className={`message-bubble ${isUser ? 'user' : 'assistant'}`}>
        {isUser ? (
          <>
            {attachments && attachments.length > 0 && (
              <div className="bubble-attachments-container">
                {attachments.map((att) => (
                  <div key={att.id} className="bubble-attachment-item">
                    {att.type === 'image' ? (
                      <img src={att.uri} alt={att.name} className="bubble-attachment-image" />
                    ) : (
                      <div className="bubble-attachment-doc">
                        <span className="bubble-attachment-doc-icon">📄</span>
                        <span className="bubble-attachment-doc-name">{att.name}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {content && <p className="message-text">{content}</p>}
          </>
        ) : (
          <>
            {isThinking ? (
              <div className="thinking-container">
                <div className="thinking-dot" style={{ animationDelay: '0s' }} />
                <div className="thinking-dot" style={{ animationDelay: '0.15s' }} />
                <div className="thinking-dot" style={{ animationDelay: '0.3s' }} />
                <span className="thinking-label">추론 중...</span>
              </div>
            ) : (
              <div className="ai-markdown-content prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown 
                  remarkPlugins={[remarkGfm, remarkMath]}
                  rehypePlugins={[rehypeKatex]}
                >
                  {content || '...'}
                </ReactMarkdown>
              </div>
            )}
            {isInterrupted && !isThinking && (
              <div className="stopped-notice">대답이 중지되었습니다.</div>
            )}
          </>
        )}
      </div>

      {!isThinking && (
        <div
          className="bubble-action-row"
          style={{ justifyContent: isUser ? 'flex-end' : 'flex-start' }}
        >
          <button
            className="bubble-action-btn"
            onClick={handleCopy}
            aria-label="Copy message"
            style={isUser ? { marginRight: 4 } : { marginLeft: 4 }}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
};
