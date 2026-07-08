import { 
  type LLMAdapter, 
  type Platform, 
  type ChatMessage, 
  type ModelSpec, 
  type GenerateOptions, 
  type StreamChunk, 
  type ModelLoadState 
} from '@repo/ai-core';
import { CreateMLCEngine, type MLCEngine, prebuiltAppConfig } from '@mlc-ai/web-llm';

export class WebLLMAdapter implements LLMAdapter {
  readonly platform: Platform = 'web';
  private engine: MLCEngine | null = null;
  private loadStateCallbacks: Set<(state: ModelLoadState) => void> = new Set();
  private currentLoadState: ModelLoadState = { status: 'idle' };

  constructor() {}

  private updateLoadState(state: ModelLoadState) {
    this.currentLoadState = state;
    this.loadStateCallbacks.forEach((cb) => cb(state));
  }

  async init(model: ModelSpec): Promise<void> {
    try {
      this.updateLoadState({ status: 'downloading', progress: 0 });

      if (this.engine) {
        try {
          await this.engine.unload();
        } catch (e) {}
      }

      const appConfig = { ...prebuiltAppConfig };
      const modelRecord = appConfig.model_list.find(m => m.model_id === model.id);
      if (modelRecord) {
        modelRecord.overrides = {
          ...modelRecord.overrides,
          context_window_size: -1,
          attention_sink_size: 16
        };
      }

      const engine = await CreateMLCEngine(model.id, {
        appConfig,
        initProgressCallback: (report) => {
          const progress = Math.round(report.progress * 100);
          if (progress < 100) {
            this.updateLoadState({ status: 'downloading', progress });
          } else {
            this.updateLoadState({ status: 'loading', progress: 100 });
          }
        }
      });

      this.engine = engine;
      this.updateLoadState({ status: 'ready' });
    } catch (err: any) {
      console.error('WebLLMAdapter init error:', err);
      const errMsg = err?.message || String(err);
      this.updateLoadState({ status: 'error', message: errMsg });
      throw err;
    }
  }

  async generate(messages: ChatMessage[], options?: GenerateOptions): Promise<string> {
    if (!this.engine) {
      throw new Error('LLMEngine is not initialized. Call init() first.');
    }

    const formattedMessages = messages.map(msg => ({
      role: msg.role === 'tool' ? 'assistant' : msg.role,
      content: msg.content
    }));

    const response = await this.engine.chat.completions.create({
      messages: formattedMessages as any,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens,
      top_p: options?.topP,
      stop: options?.stop,
      stream: false
    });

    return response.choices[0]?.message?.content || '';
  }

  async *stream(messages: ChatMessage[], options?: GenerateOptions): AsyncIterable<StreamChunk> {
    if (!this.engine) {
      yield { type: 'error', message: 'LLMEngine is not initialized.' };
      return;
    }

    try {
      const formattedMessages = messages.map(msg => ({
        role: msg.role === 'tool' ? 'assistant' : msg.role,
        content: msg.content
      }));

      const chunks = await this.engine.chat.completions.create({
        messages: formattedMessages as any,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 512, // 안전장치: 최대 생성 토큰 수 제한
        top_p: options?.topP,
        stop: options?.stop,
        stream: true
      });

      let tokenCount = 0;
      const startTime = performance.now();

      for await (const chunk of chunks) {
        if (options?.signal?.aborted) {
          break;
        }

        const delta = chunk.choices[0]?.delta?.content || '';
        if (delta) {
          tokenCount++;
          yield { type: 'text-delta', text: delta };
        }
      }

      const totalTimeMs = performance.now() - startTime;
      yield { 
        type: 'done', 
        stats: {
          totalMs: totalTimeMs,
          tokenCount,
          tokensPerSecond: tokenCount > 0 ? parseFloat((tokenCount / (totalTimeMs / 1000)).toFixed(2)) : 0
        }
      };

    } catch (err: any) {
      console.error('WebLLMAdapter stream error:', err);
      yield { type: 'error', message: err?.message || String(err) };
    }
  }

  async interrupt(): Promise<void> {
    if (this.engine) {
      await this.engine.interruptGenerate();
    }
  }

  async unload(): Promise<void> {
    if (this.engine) {
      await this.engine.unload();
      this.engine = null;
      this.updateLoadState({ status: 'idle' });
    }
  }

  onLoadStateChange(callback: (state: ModelLoadState) => void): () => void {
    this.loadStateCallbacks.add(callback);
    callback(this.currentLoadState);
    
    return () => {
      this.loadStateCallbacks.delete(callback);
    };
  }
}
