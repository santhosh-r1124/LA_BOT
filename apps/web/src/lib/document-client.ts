import { ApiRequestError, apiFetch } from './api-client';

export interface QuestionOut {
  key: string;
  label: string;
  required: boolean;
  help_text: string | null;
}

export interface DocumentTypeInfoOut {
  document_type: string;
  questions: QuestionOut[];
}

export interface DocumentRequestOut {
  id: string;
  document_type: string;
  state_code: string | null;
  answers: Record<string, string>;
  draft_text: string;
  created_at: string;
}

/**
 * How a draft was produced. "ai": written by the configured model. "template":
 * no AI provider is configured, so the server assembled the draft from the
 * user's answers and standard clauses (its first line says so).
 */
export type GenerationMode = 'ai' | 'template';

export interface CreateDocumentResponse {
  document: DocumentRequestOut;
  disclaimer: string;
  /** Absent on API versions that predate offline mode; treat as "ai". */
  generation_mode?: GenerationMode;
}

/** The mode of a create response, defaulting to "ai" for older API versions. */
export function generationModeOf(
  response: Pick<CreateDocumentResponse, 'generation_mode'>,
): GenerationMode {
  return response.generation_mode === 'template' ? 'template' : 'ai';
}

/** Bindings for `/api/v1/documents/*`. Works with or without a token (public tier). */
export const documentClient = {
  listTypes: () => apiFetch<DocumentTypeInfoOut[]>('/api/v1/documents/types'),

  create: (documentType: string, answers: Record<string, string>, token: string | null) =>
    apiFetch<CreateDocumentResponse>('/api/v1/documents', {
      method: 'POST',
      body: { document_type: documentType, answers },
      token,
      // A full draft + notes takes well over the 10s default on free tiers.
      timeoutMs: 120_000,
    }),

  listMine: (token: string) => apiFetch<DocumentRequestOut[]>('/api/v1/documents', { token }),

  get: (documentId: string, token: string | null) =>
    apiFetch<DocumentRequestOut>(`/api/v1/documents/${documentId}`, { token }),
};

export type DocumentFailureKind =
  'network' | 'rate_limited' | 'invalid' | 'unavailable' | 'unknown';

/** A request failure turned into something safe and useful to show a person. */
export interface DocumentFailure {
  kind: DocumentFailureKind;
  title: string;
  message: string;
  /** Seconds until a retry can succeed (rate limit only), when the server said. */
  retryAfterSeconds: number | null;
  /** Server-side field problems, by question key (validation errors only). */
  fieldErrors: Record<string, string>;
}

/** "Please wait 23s and try again" -> 23. Null when the message has no wait. */
export function parseRetryAfter(message: string): number | null {
  const match = /wait\s+(\d{1,3})\s*s(?:ec(?:onds?)?)?\b/i.exec(message);
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 120) : null;
}

/**
 * Map any error from {@link documentClient} to display copy. Server messages are
 * only used where they are written for people (rate limit, validation); anything
 * else gets fixed wording so no provider name, status line or stack trace leaks.
 *
 * @param subject "draft" for creating a document, "types" for loading the picker.
 */
export function describeDocumentFailure(
  err: unknown,
  subject: 'draft' | 'types' = 'draft',
): DocumentFailure {
  const base = { retryAfterSeconds: null, fieldErrors: {} } as const;
  const loading = subject === 'types';

  if (!(err instanceof ApiRequestError) || err.code === 'network_error' || err.status === 0) {
    return {
      ...base,
      kind: 'network',
      title: loading ? "Can't load the document types" : "Can't reach the document service",
      message: loading
        ? 'Check your connection and that the app server is running, then try again.'
        : 'Check your connection and that the app server is running, then try again. Your answers are still in the form.',
    };
  }

  if (err.status === 429 || err.code === 'rate_limited') {
    const wait = parseRetryAfter(err.message);
    return {
      ...base,
      kind: 'rate_limited',
      title: 'Too many requests in a short time',
      message: wait
        ? `Wait ${wait} seconds, then try again. Your answers are still in the form.`
        : 'Wait a minute, then try again. Your answers are still in the form.',
      retryAfterSeconds: wait,
    };
  }

  if (err.status === 422 || err.code === 'validation_error') {
    const fieldErrors: Record<string, string> = {};
    for (const detail of err.details ?? []) {
      const key = detail.field.replace(/^answers\./, '');
      if (key && !(key in fieldErrors))
        fieldErrors[key] = detail.message || 'This answer is required.';
    }
    return {
      ...base,
      kind: 'invalid',
      title: 'Some answers need another look',
      message: 'The server could not use one or more answers. Check the fields marked below.',
      fieldErrors,
    };
  }

  if (err.status === 503 || err.status === 502 || err.status === 504) {
    return {
      ...base,
      kind: 'unavailable',
      title: loading ? 'Document types are unavailable' : "The draft couldn't be written",
      message: loading
        ? 'The document service is temporarily unavailable. Try again in a moment.'
        : 'The drafting service did not return a draft this time. Your answers are still in the form; try again in a moment.',
    };
  }

  return {
    ...base,
    kind: 'unknown',
    title: loading ? "Can't load the document types" : "The draft couldn't be created",
    message: loading
      ? 'Something went wrong on our side. Try again in a moment.'
      : 'Something went wrong on our side. Your answers are still in the form; try again in a moment.',
  };
}
