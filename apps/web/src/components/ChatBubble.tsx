import React from 'react';
import ReactMarkdown from 'react-markdown';

interface ChatBubbleProps {
  content: string;
  isUser: boolean;
}

export const ChatBubble: React.FC<ChatBubbleProps> = ({ content, isUser }) => {
  return (
    <div className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'} mb-6`}>
      <div
        className={`max-w-[80%] rounded-2xl px-5 py-4 shadow-sm ${
          isUser
            ? 'bg-[#3f51b5] text-white rounded-br-sm'
            : 'bg-[#1e1e38] text-[#e0e0ff] rounded-bl-sm border border-[#2e2e5c]'
        }`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap m-0 text-[15px] leading-relaxed">
            {content}
          </p>
        ) : (
          <div className="prose prose-invert prose-p:leading-relaxed prose-pre:bg-[#0a0a14] prose-pre:border prose-pre:border-[#3f3f74] max-w-none text-[15px]">
            <ReactMarkdown>{content || '...'}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
};
