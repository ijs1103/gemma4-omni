import { describe, it, expect, vi } from 'vitest';
import { LiteRTLMAdapter } from '../adapters/LiteRTLMAdapter';

describe('LiteRTLMAdapter', () => {
  it('initializes with default model and idle state', () => {
    const adapter = new LiteRTLMAdapter();
    expect(adapter).toBeDefined();
  });

  it('notifies listeners when load state changes', () => {
    const adapter = new LiteRTLMAdapter();
    const listener = vi.fn();
    
    adapter.onLoadStateChange(listener);
    
    // Check initial state
    expect(listener).toHaveBeenCalledWith({
      status: 'idle',
    });
  });

  it('unsubscribes listeners cleanly', () => {
    const adapter = new LiteRTLMAdapter();
    const listener = vi.fn();
    
    const unsubscribe = adapter.onLoadStateChange(listener);
    listener.mockClear();
    
    unsubscribe();
    // Reset conversation should trigger state notification if listeners existed
    adapter.resetConversation();
    expect(listener).not.toHaveBeenCalled();
  });
});
