import { 
  type LLMAdapter, 
  type Platform, 
  type ChatMessage, 
  type ModelSpec, 
  type GenerateOptions, 
  type StreamChunk, 
  type ModelLoadState,
  type Attachment
} from '@repo/ai-core';
import { Engine, type Conversation, type EngineSettings } from '@litert-lm/core';
import { MODEL_REGISTRY } from '@repo/ai-core';

// ─── 유틸리티: Blob URL을 Base64로 변환 ─────────────────────────────
async function fetchBlobAsBase64(uri: string): Promise<string> {
  const response = await fetch(uri);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      resolve(reader.result as string);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ─── In-Context RAG: 문서 컨텍스트 빌더 ─────────────────────────────
const CHARS_PER_TOKEN = 3.0;
const MAX_CONTEXT_TOKENS = 4096;
const RESERVED_OUTPUT_TOKENS = 1024;
const RESERVED_CHAT_TOKENS = 512;
const AVAILABLE_DOC_TOKENS = MAX_CONTEXT_TOKENS - RESERVED_OUTPUT_TOKENS - RESERVED_CHAT_TOKENS;
const MAX_DOC_CHARS = Math.floor(AVAILABLE_DOC_TOKENS * CHARS_PER_TOKEN);

function truncateDocText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars);
  const lastNl = slice.lastIndexOf('\n');
  return slice.slice(0, lastNl > maxChars * 0.8 ? lastNl : maxChars);
}

function inlineBuildContext(messages: ChatMessage[]) {
  const last = [...messages].reverse().find((m) => m.role === 'user');
  if (!last) return null;

  const docs = (last.attachments || []).filter(
    (a: Attachment) => a.type === 'document' && a.textContent && a.textContent.trim().length > 0,
  );
  if (docs.length === 0) return null;

  const warnings: string[] = [];
  let wasTruncated = false;

  const blocks = docs.map((a: Attachment) =>
    `<document name="${a.name}">\n${a.textContent!.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim()}\n</document>`
  );
  let combined = blocks.join('\n\n');
  const originalChars = combined.length;

  if (combined.length > MAX_DOC_CHARS) {
    wasTruncated = true;
    const pct = Math.round((1 - MAX_DOC_CHARS / combined.length) * 100);
    combined = truncateDocText(combined, MAX_DOC_CHARS);
    warnings.push(`문서가 너무 길어 뒷부분 약 ${pct}%가 생략되었습니다.`);
  }

  const prompt =
    `<documents>\n아래는 사용자가 첨부한 문서의 내용입니다. 이 문서를 참고하여 사용자의 질문에 답변해 주세요.\n\n${combined}\n</documents>\n\n<user_query>\n${last.content}\n</user_query>`;

  return {
    prompt,
    wasTruncated,
    warnings,
    stats: {
      originalChars,
      injectedChars: combined.length,
      estimatedTokens: Math.ceil(prompt.length / CHARS_PER_TOKEN),
      documentCount: docs.length,
    },
  };
}

export class LiteRTLMAdapter implements LLMAdapter {
  readonly platform: Platform = 'web';
  private engine: Engine | null = null;
  private conversation: Conversation | null = null;
  private loadStateCallbacks: Set<(state: ModelLoadState) => void> = new Set();
  private currentLoadState: ModelLoadState = { status: 'idle' };
  private abortController: AbortController | null = null;

  constructor() {}

  private updateLoadState(state: ModelLoadState) {
    this.currentLoadState = state;
    this.loadStateCallbacks.forEach((cb) => cb(state));
  }

  async init(model: ModelSpec): Promise<void> {
    try {
      // LiteRT-LM has no initProgressCallback, so we just set to loading.
      this.updateLoadState({ status: 'loading', progress: 0 });

      if (this.engine) {
        try {
          await this.unload();
        } catch (e) {}
      }

      const registryEntry = MODEL_REGISTRY[model.id];
      const modelUrl = registryEntry?.platforms.web?.runtimeModelId;
      
      if (!modelUrl) {
        throw new Error(`Model URL not found for model id: ${model.id} on web platform`);
      }

      const engineSettings: EngineSettings = {
        model: modelUrl,
        mainExecutorSettings: {
          maxNumTokens: 2048,
        },
      };

      console.log(`[LiteRTLMAdapter] crossOriginIsolated: ${self.crossOriginIsolated}`);
      console.log(`[LiteRTLMAdapter] Starting Engine.create...`);
      const startTime = performance.now();
      this.engine = await Engine.create(engineSettings);
      const endTime = performance.now();
      console.log(`[LiteRTLMAdapter] Engine loaded in ${(endTime - startTime).toFixed(2)} ms`);
      
      this.updateLoadState({ status: 'ready' });
    } catch (err: any) {
      console.error('LiteRTLMAdapter init error:', err);
      const errMsg = err?.message || String(err);
      this.updateLoadState({ status: 'error', message: errMsg });
      throw err;
    }
  }

  private async getOrCreateConversation(messages: ChatMessage[] = []): Promise<Conversation> {
    if (!this.engine) {
      throw new Error('LLMEngine is not initialized. Call init() first.');
    }
    
    // If we already have a conversation, return it (for continuous chat)
    if (this.conversation) {
      return this.conversation;
    }

    // 시스템 프롬프트 추출
    const systemMsg = messages.find(m => m.role === 'system');
    const systemContent = systemMsg ? systemMsg.content : 'You are a helpful assistant.';

    // 이전 대화 기록 추출 (마지막 유저 메시지는 제외)
    const history = messages
      .filter(m => m.role !== 'system')
      .slice(0, -1) // 마지막 메시지(현재 질문) 제외
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        content: m.content
      }));

    this.conversation = await this.engine.createConversation({
      preface: {
        messages: [{ role: 'system', content: systemContent }, ...history],
      },
    });

    return this.conversation;
  }

  async generate(messages: ChatMessage[], options?: GenerateOptions): Promise<string> {
    let result = '';
    for await (const chunk of this.stream(messages, options)) {
      if (chunk.type === 'text-delta') {
        result += chunk.text;
      }
    }
    return result;
  }

  async *stream(messages: ChatMessage[], options?: GenerateOptions): AsyncIterable<StreamChunk> {
    try {
      const chat = await this.getOrCreateConversation(messages);
      
      this.abortController = new AbortController();

      const lastMessage = [...messages].reverse().find((m) => m.role === 'user');
      if (!lastMessage) return;

      // 문서 컨텍스트 병합 (inlineBuildContext)
      const contextResult = inlineBuildContext(messages);
      const cleanPrompt = contextResult ? contextResult.prompt : lastMessage.content;

      if (contextResult) {
        if (contextResult.wasTruncated) {
          console.warn('[LiteRTLMAdapter] 문서가 잘렸습니다:', contextResult.warnings);
        }
        console.log(`[LiteRTLMAdapter] 문서 컨텍스트 주입: ${contextResult.stats.documentCount}개 문서, ${contextResult.stats.injectedChars}자`);
      }

      // 비전 멀티모달 분기 처리
      const attachments = lastMessage.attachments || [];
      const imageAttachments = attachments.filter((a) => a.type === 'image');
      let payload: any;

      if (imageAttachments.length > 0) {
        // 이미지가 포함된 경우 (Base64 변환 후 멀티모달 Payload 생성)
        const imageParts = await Promise.all(
          imageAttachments.map(async (img) => {
            const base64Data = await fetchBlobAsBase64(img.uri);
            return { 
              type: 'image', 
              mime_type: img.mimeType, 
              // WASM 엔진 에러('must contain a path or blob')를 해결하기 위해 data 대신 blob 키 사용
              blob: base64Data.split(',')[1] 
            };
          })
        );
        
        payload = {
          role: 'user',
          content: [
            { type: 'text', text: cleanPrompt },
            ...imageParts
          ]
        };
        console.log(`[LiteRTLMAdapter] 멀티모달 Payload 생성 완료: 이미지 ${imageParts.length}장 첨부됨`);
      } else {
        // 텍스트(및 문서)만 있는 경우
        payload = cleanPrompt;
      }

      const startTime = performance.now();
      let tokenCount = 0;

      const chunkStream = chat.sendMessageStreaming(payload);

      if (!chunkStream || typeof chunkStream[Symbol.asyncIterator] !== 'function') {
        throw new Error('LLM 엔진이 스트리밍 응답을 생성하지 못했습니다. 사용 중인 브라우저가 WebGPU 추론에 필요한 기능을 완벽히 지원하지 않을 수 있습니다.');
      }

      for await (const chunk of chunkStream) {
        if (options?.signal?.aborted || this.abortController.signal.aborted) {
          break;
        }

        let delta = '';
        if (typeof chunk.content === 'string') {
          delta = chunk.content;
        } else if (Array.isArray(chunk.content)) {
          delta = (chunk.content[0] as any)?.text || '';
        }

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
      console.error('LiteRTLMAdapter stream error:', err);
      yield { type: 'error', message: err?.message || String(err) };
    } finally {
      this.abortController = null;
    }
  }

  async interrupt(): Promise<void> {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  async unload(): Promise<void> {
    if (this.engine) {
      // LiteRT-LM uses delete() to release resources
      await this.engine.delete();
      this.engine = null;
      this.conversation = null;
      this.updateLoadState({ status: 'idle' });
    }
  }

  async resetConversation(): Promise<void> {
    if (this.conversation) {
      this.conversation = null;
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
