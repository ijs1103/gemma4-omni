import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ChatBubble } from '../components/ChatBubble';

describe('ChatBubble', () => {
  it('renders user text message correctly', () => {
    render(<ChatBubble content="안녕하세요 로컬 AI 모델" isUser={true} />);
    expect(screen.getByText('안녕하세요 로컬 AI 모델')).toBeInTheDocument();
  });

  it('renders assistant thinking state', () => {
    render(<ChatBubble content="" isUser={false} isThinking={true} />);
    expect(screen.getByText('추론 중...')).toBeInTheDocument();
  });

  it('renders assistant markdown content', () => {
    render(<ChatBubble content="Hello **World**" isUser={false} />);
    expect(screen.getByText('World')).toBeInTheDocument();
  });

  it('renders interrupted notice when generation stopped', () => {
    render(<ChatBubble content="응답 내용" isUser={false} isInterrupted={true} />);
    expect(screen.getByText('대답이 중지되었습니다.')).toBeInTheDocument();
  });
});
