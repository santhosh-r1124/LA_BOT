'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch, ApiRequestError } from './api-client';

/** Mirrors `GET /api/v1/status` (apps/api/app/api/v1/routes/meta.py). */
export interface PlatformStatus {
  generated_at: string;
  llm: {
    configured: boolean;
    provider: string | null;
    model: string | null;
    is_free_tier: boolean | null;
    /** Secondary provider used if the primary fails; null = none. */
    fallback_provider?: string | null;
    /** Outcome of the most recent real model call; null until the first one. */
    last_call_ok: boolean | null;
    last_call_at: string | null;
    last_error_code: string | null;
    last_error_message: string | null;
  };
  embeddings: { configured: boolean; model: string | null; provider?: string };
  knowledge_base: {
    available: boolean;
    documents_indexed: number | null;
    documents_failed: number | null;
    chunks_indexed: number | null;
    /** Chunks with an embedding (semantic search); the rest are keyword-only. */
    chunks_embedded?: number | null;
    last_indexed_at: string | null;
    /** Documents per origin: a Hugging Face dataset id, or "official sources". */
    sources?: Array<{ dataset: string; documents: number }>;
    /** Background Hugging Face load started with the API. */
    corpus_load?: {
      state: 'not_started' | 'disabled' | 'running' | 'done' | 'failed';
      dataset: string | null;
      message: string | null;
      updated_at: string | null;
    } | null;
  };
  advocate_directory: {
    available: boolean;
    /** All listed advocates, including sample (synthetic) listings. */
    verified_advocates: number | null;
    sample_advocates?: number | null;
  };
  /** Server feature switches (absent on older API versions). */
  features?: { open_login: boolean; general_answers: boolean };
  /** Live dependency checks (absent on older API versions). */
  dependencies?: {
    database: { ok: boolean | null; detail: string | null };
    redis: { ok: boolean | null; detail: string | null };
    vector_search: { ok: boolean | null; detail: string | null };
  };
}

/** Mirrors `POST /api/v1/status/check-llm`. */
export interface LlmCheck {
  ok: boolean;
  provider: string | null;
  model: string | null;
  latency_ms: number | null;
  error_code: string | null;
  error_message: string | null;
}

export const statusClient = {
  get: () => apiFetch<PlatformStatus>('/api/v1/status', { timeoutMs: 8_000 }),
  checkLlm: () =>
    apiFetch<LlmCheck>('/api/v1/status/check-llm', { method: 'POST', timeoutMs: 90_000 }),
};

export type StatusState =
  | { kind: 'loading' }
  | { kind: 'ready'; status: PlatformStatus }
  | { kind: 'error'; message: string };

/** Fetches platform status once on mount; `reload` refetches on demand. */
export function usePlatformStatus(): { state: StatusState; reload: () => void } {
  const [state, setState] = useState<StatusState>({ kind: 'loading' });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState((prev) => (prev.kind === 'ready' ? prev : { kind: 'loading' }));
    statusClient
      .get()
      .then((status) => {
        if (!cancelled) setState({ kind: 'ready', status });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          kind: 'error',
          message:
            err instanceof ApiRequestError && err.code !== 'network_error'
              ? err.message
              : 'The platform API is unreachable right now.',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { state, reload };
}

const PROVIDER_LABEL: Record<string, string> = {
  gemini: 'Google Gemini',
  groq: 'Groq',
  ollama: 'Ollama (local)',
  anthropic: 'Anthropic Claude',
};

export function providerLabel(provider: string | null): string {
  return provider ? (PROVIDER_LABEL[provider] ?? provider) : 'Not configured';
}
