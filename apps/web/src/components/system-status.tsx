'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatRelativeTime, StatusBadge, type Tone } from '@/components/ui';
import { ApiRequestError } from '@/lib/api-client';
import { providerLabel, statusClient, usePlatformStatus } from '@/lib/status-client';

type InfraStatus = 'loading' | 'ok' | 'degraded' | 'error';

interface InfraHealth {
  status: InfraStatus;
  detail: string;
  checks?: Record<string, { status: string }>;
}

const INFRA_TONE: Record<InfraStatus, Tone> = {
  loading: 'neutral',
  ok: 'ok',
  degraded: 'warn',
  error: 'danger',
};

const INFRA_LABEL: Record<InfraStatus, string> = {
  loading: 'Checking',
  ok: 'Operational',
  degraded: 'Degraded',
  error: 'Unreachable',
};

function Row({
  label,
  value,
  badge,
}: {
  label: string;
  value: React.ReactNode;
  badge: React.ReactNode;
}) {
  return (
    <div className="border-line flex items-start justify-between gap-4 border-b py-3 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{label}</p>
        <p className="muted mt-0.5 break-words text-xs">{value}</p>
      </div>
      <div className="shrink-0">{badge}</div>
    </div>
  );
}

/**
 * Real platform status: infrastructure (web -> API -> Postgres/Redis via the
 * `/api/health` route) plus capability status from `GET /api/v1/status`.
 * Nothing here is inferred or decorative — every value is read at load time
 * and "Refresh" re-reads it.
 */
export function SystemStatus() {
  const { state, reload } = usePlatformStatus();
  const [infra, setInfra] = useState<InfraHealth>({ status: 'loading', detail: 'Checking…' });
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [aiCheck, setAiCheck] = useState<
    { kind: 'idle' } | { kind: 'running' } | { kind: 'done'; ok: boolean; message: string }
  >({ kind: 'idle' });

  const testAi = () => {
    setAiCheck({ kind: 'running' });
    statusClient
      .checkLlm()
      .then((r) =>
        setAiCheck({
          kind: 'done',
          ok: r.ok,
          message: r.ok
            ? `Working: ${providerLabel(r.provider)} (${r.model}) answered in ${Math.round(r.latency_ms ?? 0)} ms.`
            : (r.error_message ?? 'The AI check failed.'),
        }),
      )
      .catch((err: unknown) =>
        setAiCheck({
          kind: 'done',
          ok: false,
          message: err instanceof ApiRequestError ? err.message : 'Could not run the check.',
        }),
      )
      .finally(reload);
  };

  const loadInfra = useCallback(() => {
    setInfra((prev) => ({ ...prev, status: 'loading' }));
    fetch('/api/health', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: InfraHealth) => setInfra(data))
      .catch(() => setInfra({ status: 'error', detail: 'Status route unreachable' }))
      .finally(() => setCheckedAt(new Date().toISOString()));
  }, []);

  useEffect(() => loadInfra(), [loadInfra]);

  const refresh = () => {
    loadInfra();
    reload();
  };

  const status = state.kind === 'ready' ? state.status : null;
  const kb = status?.knowledge_base;
  const llm = status?.llm;
  const dir = status?.advocate_directory;

  return (
    <section aria-labelledby="status-heading" className="surface p-5">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h2 id="status-heading" className="text-sm font-semibold">
          Platform status
        </h2>
        <button type="button" onClick={refresh} className="btn btn-ghost btn-sm">
          Refresh
        </button>
      </div>
      <p className="subtle text-xs" aria-live="polite">
        {checkedAt ? `Checked ${formatRelativeTime(checkedAt)}` : 'Checking…'}
      </p>

      <div className="mt-2">
        <Row
          label="Services"
          value={
            infra.checks
              ? Object.entries(infra.checks)
                  .map(([name, c]) => `${name}: ${c.status}`)
                  .join(' · ')
              : infra.detail
          }
          badge={
            <StatusBadge tone={INFRA_TONE[infra.status]}>{INFRA_LABEL[infra.status]}</StatusBadge>
          }
        />

        {state.kind === 'loading' && (
          <div className="flex flex-col gap-3 py-3" role="status">
            <span className="sr-only">Loading capability status</span>
            <div className="skeleton h-9" />
            <div className="skeleton h-9" />
            <div className="skeleton h-9" />
          </div>
        )}

        {state.kind === 'error' && (
          <p className="text-danger py-3 text-sm" role="alert">
            Capability status unavailable — {state.message}
          </p>
        )}

        {status && kb && llm && dir && (
          <>
            <Row
              label="Knowledge base"
              value={
                !kb.available
                  ? 'Could not read the knowledge base.'
                  : kb.documents_indexed
                    ? `${kb.documents_indexed} official source${kb.documents_indexed === 1 ? '' : 's'} · ${(kb.chunks_indexed ?? 0).toLocaleString('en-IN')} passages · updated ${formatRelativeTime(kb.last_indexed_at)}`
                    : 'No official sources indexed yet — chat gives general legal information.'
              }
              badge={
                !kb.available ? (
                  <StatusBadge tone="danger">Unavailable</StatusBadge>
                ) : kb.documents_indexed ? (
                  <StatusBadge tone="ok">Indexed</StatusBadge>
                ) : (
                  <StatusBadge tone="warn">Empty</StatusBadge>
                )
              }
            />
            <Row
              label="AI model"
              value={
                !llm.configured
                  ? 'No model provider configured on the server.'
                  : llm.last_call_ok === false
                    ? `${providerLabel(llm.provider)} · last request failed: ${llm.last_error_message ?? 'unknown error'}`
                    : `${providerLabel(llm.provider)} · ${llm.model}${llm.is_free_tier ? ' · free tier' : ''}`
              }
              badge={
                !llm.configured ? (
                  <StatusBadge tone="danger">Not configured</StatusBadge>
                ) : llm.last_call_ok === false ? (
                  <StatusBadge tone="danger">Failing</StatusBadge>
                ) : llm.last_call_ok ? (
                  <StatusBadge tone="ok">Working</StatusBadge>
                ) : (
                  <StatusBadge tone="ok">Configured</StatusBadge>
                )
              }
            />
            {llm.configured && (
              <div className="border-line -mt-px flex flex-wrap items-center gap-3 border-b pb-3">
                <button
                  type="button"
                  onClick={testAi}
                  disabled={aiCheck.kind === 'running'}
                  className="btn btn-secondary btn-sm"
                >
                  {aiCheck.kind === 'running' ? 'Testing…' : 'Test AI connection'}
                </button>
                {aiCheck.kind === 'done' && (
                  <p role="status" className={`text-xs ${aiCheck.ok ? 'text-ok' : 'text-danger'}`}>
                    {aiCheck.message}
                  </p>
                )}
              </div>
            )}
            <Row
              label="Advocate directory"
              value={
                dir.available
                  ? `${dir.verified_advocates ?? 0} verified advocate${dir.verified_advocates === 1 ? '' : 's'}`
                  : 'Could not read the directory.'
              }
              badge={
                !dir.available ? (
                  <StatusBadge tone="danger">Unavailable</StatusBadge>
                ) : dir.verified_advocates ? (
                  <StatusBadge tone="ok">Listed</StatusBadge>
                ) : (
                  <StatusBadge tone="neutral">None yet</StatusBadge>
                )
              }
            />
          </>
        )}
      </div>
    </section>
  );
}
