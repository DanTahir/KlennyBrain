import type { AskRequest, AskStreamEvent } from '@app-starter/shared';
import { API_BASE_URL } from './api-client';
import { authStorage, type StoredUser } from './auth-storage';

export type ApiErrorLike = { message: string; statusCode: number };

export function isApiErrorLike(value: unknown): value is ApiErrorLike {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.message === 'string' && typeof record.statusCode === 'number';
}

/**
 * Buffered Server-Sent Events parser. Feed raw text chunks with `push`; each
 * complete frame's JSON `data` payload is forwarded to `onEvent`.
 */
export function createSseParser(onEvent: (event: AskStreamEvent) => void): {
  push(chunk: string): void;
  flush(): void;
} {
  let buffer = '';

  const processFrame = (frame: string): void => {
    const dataLines: string[] = [];
    for (const line of frame.split('\n')) {
      if (line === '' || line.startsWith(':')) continue;
      if (line.startsWith('data:')) {
        let value = line.slice(5);
        if (value.startsWith(' ')) value = value.slice(1);
        dataLines.push(value);
      }
      // `event:`, `id:`, `retry:` and unknown fields are ignored; the JSON carries `type`.
    }
    if (dataLines.length === 0) return;
    const data = dataLines.join('\n');
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    if (parsed && typeof parsed === 'object' && typeof (parsed as { type?: unknown }).type === 'string') {
      onEvent(parsed as AskStreamEvent);
    }
  };

  return {
    push(chunk: string): void {
      buffer += chunk;
      buffer = buffer.replace(/\r\n?/g, '\n');
      let index = buffer.indexOf('\n\n');
      while (index !== -1) {
        const frame = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        processFrame(frame);
        index = buffer.indexOf('\n\n');
      }
    },
    flush(): void {
      const rest = buffer.replace(/\r\n?/g, '\n');
      buffer = '';
      if (rest.trim() !== '') processFrame(rest);
    },
  };
}

interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
  user: StoredUser;
}

function isAbortError(error: unknown): boolean {
  return (
    (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

async function refreshTokens(): Promise<boolean> {
  const refreshToken = authStorage.getRefreshToken();
  if (!refreshToken) return false;
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      credentials: 'include',
    });
    if (!response.ok) return false;
    const data = (await response.json()) as RefreshResponse;
    authStorage.setTokens(data.accessToken, data.refreshToken);
    authStorage.setUser(data.user);
    return true;
  } catch {
    return false;
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  let text = '';
  try {
    text = await response.text();
  } catch {
    return response.statusText || 'An error occurred';
  }
  try {
    const data = JSON.parse(text) as { message?: unknown; error?: unknown };
    if (Array.isArray(data.message)) {
      return data.message.filter((m): m is string => typeof m === 'string').join(', ');
    }
    if (typeof data.message === 'string') return data.message;
    if (typeof data.error === 'string') return data.error;
  } catch {
    // Not JSON; fall through to raw text.
  }
  return text || response.statusText || 'An error occurred';
}

/**
 * Stream an answer from `POST /api/organizations/:id/ask/stream`. Resolves once
 * the server sends `done` or `error`, or quietly when aborted.
 */
export async function streamAsk(
  organizationId: string,
  body: AskRequest,
  options: { onEvent: (event: AskStreamEvent) => void; signal?: AbortSignal },
): Promise<void> {
  const { onEvent, signal } = options;
  const url = `${API_BASE_URL}/api/organizations/${encodeURIComponent(organizationId)}/ask/stream`;

  const send = (): Promise<Response> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    };
    const token = authStorage.getAccessToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      credentials: 'include',
      signal,
    });
  };

  let response: Response;
  try {
    response = await send();
    if (response.status === 401) {
      const refreshed = await refreshTokens();
      if (refreshed) {
        response = await send();
      }
    }
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) return;
    throw { message: 'Network error. Please check your connection.', statusCode: 0 } satisfies ApiErrorLike;
  }

  if (!response.ok) {
    const message = await readErrorMessage(response);
    throw { message, statusCode: response.status } satisfies ApiErrorLike;
  }

  if (!response.body) {
    throw {
      message: 'The answer stream ended unexpectedly. Please try again.',
      statusCode: 0,
    } satisfies ApiErrorLike;
  }

  let terminal = false;
  const parser = createSseParser((event) => {
    if (event.type === 'heartbeat') return;
    if (event.type === 'done' || event.type === 'error') terminal = true;
    onEvent(event);
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    const tail = decoder.decode();
    if (tail) parser.push(tail);
    parser.flush();
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) return;
    if (terminal) return;
    throw { message: 'Network error. Please check your connection.', statusCode: 0 } satisfies ApiErrorLike;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Reader already released.
    }
  }

  if (!terminal && !signal?.aborted) {
    throw {
      message: 'The answer stream ended unexpectedly. Please try again.',
      statusCode: 0,
    } satisfies ApiErrorLike;
  }
}