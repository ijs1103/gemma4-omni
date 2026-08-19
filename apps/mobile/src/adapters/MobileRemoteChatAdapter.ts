import type {
  RemoteChatClient,
  RemoteChatSession,
  RemoteMessage,
  CreateSessionRequest,
  CreateMessageRequest,
  SyncSessionPayload,
  SyncPushResponse,
} from '@repo/chat-state';
import type { MobileAuthAdapter } from './MobileAuthAdapter';

const API_HOST_FOR_APP = '127.0.0.1:8000';
const API_URL = `http://${API_HOST_FOR_APP}/api/v1/chats`;

export class MobileRemoteChatAdapter implements RemoteChatClient {
  constructor(private authAdapter: MobileAuthAdapter) {}

  private async fetchWithAuth(path: string, options?: RequestInit, isRetry = false): Promise<Response> {
    let token = await this.authAdapter.getAccessToken();
    if (!token) {
      const refreshed = await this.authAdapter.refresh();
      token = refreshed?.accessToken || null;
    }
    if (!token) throw new Error('Not authenticated');

    const res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...options?.headers,
      },
    });

    if (res.status === 401 && !isRetry) {
      const refreshed = await this.authAdapter.refresh();
      if (refreshed?.accessToken) {
        return this.fetchWithAuth(path, options, true);
      }
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`API error ${res.status}: ${body}`);
    }
    return res;
  }


  async fetchSessions(): Promise<RemoteChatSession[]> {
    const res = await this.fetchWithAuth('');
    return res.json();
  }

  async fetchMessages(sessionId: string): Promise<RemoteMessage[]> {
    const res = await this.fetchWithAuth(`/${sessionId}/messages`);
    const data = await res.json();
    return data.messages;
  }

  async createSession(session: CreateSessionRequest): Promise<RemoteChatSession> {
    const res = await this.fetchWithAuth('', {
      method: 'POST',
      body: JSON.stringify(session),
    });
    return res.json();
  }

  async postMessage(sessionId: string, message: CreateMessageRequest): Promise<RemoteMessage> {
    const res = await this.fetchWithAuth(`/${sessionId}/messages`, {
      method: 'POST',
      body: JSON.stringify(message),
    });
    return res.json();
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.fetchWithAuth(`/${sessionId}`, { method: 'DELETE' });
  }

  async syncPush(sessions: SyncSessionPayload[]): Promise<SyncPushResponse> {
    const res = await this.fetchWithAuth('/sync', {
      method: 'POST',
      body: JSON.stringify({ sessions }),
    });
    return res.json();
  }
}
