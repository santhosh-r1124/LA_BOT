import { isApiError } from '@legal-platform/shared';
import { apiFetch, ApiRequestError } from './api-client';
import { env } from './env';

export interface SourceOut {
  document_id: string;
  document_title: string;
  section: string | null;
  article: string | null;
  source_url: string;
  /** Present only when the source dataset provides them; never inferred. */
  court?: string | null;
  date?: string | null;
  citation?: string | null;
  case_name?: string | null;
  /** Hugging Face dataset id the document came from. */
  dataset?: string | null;
  /** Opening of the retrieved passage, for in-chat inspection. */
  excerpt?: string | null;
}

/** A verified directory advocate suggested for a HIGH/CRITICAL question. */
export interface RecommendedAdvocate {
  id: string;
  display_name: string | null;
  practice_areas: string[];
  state_code: string;
  city: string;
  experience_years: number | null;
  /** The practice area that matched (the question's own, or a related one). */
  matched_area: string;
  exact_match: boolean;
  same_state: boolean;
  is_sample: boolean;
}

/**
 * How a reply was produced. `ai`: a model wrote the text. `sources_only`: AI
 * answers are off, so the server laid out the matching library passages
 * instead (offline mode). Absent on older API versions, which only had `ai`.
 */
export type AnswerMode = 'ai' | 'sources_only';

export interface ChatMessageOut {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  legal_category: string | null;
  jurisdiction_scope: string | null;
  is_out_of_scope: boolean | null;
  // LOW/MEDIUM/HIGH/CRITICAL. HIGH/CRITICAL already get an advocate
  // recommendation appended to the assistant reply's `content` server-side —
  // this field is exposed for potential admin/debug use, not rendered here.
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | null;
  // Assistant messages only: sources retrieved to ground the answer. Null
  // for out-of-scope replies; [] means retrieval found nothing relevant.
  sources?: SourceOut[] | null;
  /** Not stored with a message today; present if the API starts returning it. */
  answer_mode?: AnswerMode;
  created_at: string;
}

export interface SendMessageResponse {
  conversation_id: string;
  user_message: ChatMessageOut;
  assistant_message: ChatMessageOut;
  disclaimer: string;
  recommended_advocates?: RecommendedAdvocate[];
  answer_mode?: AnswerMode;
}

export interface ConversationSummary {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationDetail {
  id: string;
  title: string | null;
  messages: ChatMessageOut[];
}

/** First event of a streamed reply: the turn's classification + sources. */
export interface StreamStart {
  conversation_id: string;
  legal_category: string;
  jurisdiction_scope: string;
  risk_level: ChatMessageOut['risk_level'];
  is_out_of_scope: boolean;
  answer_mode?: AnswerMode;
  sources: SourceOut[] | null;
  recommended_advocates?: RecommendedAdvocate[];
}

export interface StreamHandlers {
  onStart?: (start: StreamStart) => void;
  onDelta?: (text: string) => void;
  signal?: AbortSignal;
}

/** Split an SSE buffer into complete `event:`/`data:` frames. */
export function parseSseFrames(buffer: string): {
  frames: Array<{ event: string; data: string }>;
  rest: string;
} {
  const frames: Array<{ event: string; data: string }> = [];
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? '';
  for (const part of parts) {
    let event = 'message';
    const data: string[] = [];
    for (const line of part.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (data.length > 0) frames.push({ event, data: data.join('\n') });
  }
  return { frames, rest };
}

/**
 * POST `/api/v1/chat/messages/stream` and consume its Server-Sent Events.
 * Resolves with the persisted turn (the `done` event); rejects with
 * {@link ApiRequestError} for HTTP errors *and* for an in-stream `error`
 * event, so callers handle both the same way.
 */
export async function streamMessage(
  message: string,
  conversationId: string | null,
  token: string | null,
  handlers: StreamHandlers = {},
): Promise<SendMessageResponse> {
  let response: Response;
  try {
    response = await fetch(`${env.NEXT_PUBLIC_API_BASE_URL}/api/v1/chat/messages/stream`, {
      method: 'POST',
      signal: handlers.signal,
      headers: {
        Accept: 'text/event-stream',
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ message, conversation_id: conversationId ?? undefined }),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiRequestError(0, 'network_error', 'Could not reach the API.');
  }

  if (!response.ok || !response.body) {
    const payload: unknown = await response.json().catch(() => null);
    if (isApiError(payload)) {
      throw new ApiRequestError(
        response.status,
        payload.error.code,
        payload.error.message,
        payload.error.request_id,
      );
    }
    throw new ApiRequestError(
      response.status,
      'http_error',
      `Request failed (${response.status}).`,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { frames, rest } = parseSseFrames(buffer);
    buffer = rest;
    for (const frame of frames) {
      let data: unknown;
      try {
        data = JSON.parse(frame.data);
      } catch {
        // A garbled frame is a broken stream, not a crash: surface it like any
        // other interruption so the caller shows its retry state.
        throw new ApiRequestError(0, 'stream_interrupted', 'The response was interrupted. Try again.');
      }
      if (frame.event === 'start') handlers.onStart?.(data as StreamStart);
      else if (frame.event === 'delta') handlers.onDelta?.((data as { text: string }).text);
      else if (frame.event === 'done') return data as SendMessageResponse;
      else if (frame.event === 'error') {
        const { code, message: msg } = data as { code: string; message: string };
        throw new ApiRequestError(503, code, msg);
      }
    }
  }
  throw new ApiRequestError(0, 'stream_interrupted', 'The response was interrupted. Try again.');
}

/** Bindings for `/api/v1/chat/*`. Works with or without a token (public tier). */
export const chatClient = {
  sendMessage: (message: string, conversationId: string | null, token: string | null) =>
    apiFetch<SendMessageResponse>('/api/v1/chat/messages', {
      method: 'POST',
      body: { message, conversation_id: conversationId ?? undefined },
      token,
      // Classification + retrieval + generation can legitimately take a while
      // on free-tier models; the old 10s default aborted slow-but-fine replies.
      timeoutMs: 120_000,
    }),

  streamMessage,

  listConversations: (token: string) =>
    apiFetch<ConversationSummary[]>('/api/v1/chat/conversations', { token }),

  getConversation: (conversationId: string, token: string | null) =>
    apiFetch<ConversationDetail>(`/api/v1/chat/conversations/${conversationId}`, { token }),
};
