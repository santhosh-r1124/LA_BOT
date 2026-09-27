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
  };
  embeddings: { configured: boolean; model: string | null };
  knowledge_base: {
    available: boolean;
    documents_indexed: number | null;
    documents_failed: number | null;
    chunks_indexed: number | null;
    last_indexed_at: string | null;
  };
  advocate_directory: { available: boolean; verified_advocates: number | null };
}

export const statusClient = {
  get: () => apiFetch<PlatformStatus>('/api/v1/status', { timeoutMs: 8_000 }),
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
