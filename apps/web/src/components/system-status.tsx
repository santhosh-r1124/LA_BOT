'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatRelativeTime, StatusBadge, type Tone } from '@/components/ui';
import { providerLabel, usePlatformStatus } from '@/lib/status-client';

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
                    : 'No sources indexed yet — answers will report insufficient evidence.'
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
                llm.configured
                  ? `${providerLabel(llm.provider)} · ${llm.model}${llm.is_free_tier ? ' · free tier' : ''}`
                  : 'No model provider configured on the server.'
              }
              badge={
                llm.configured ? (
                  <StatusBadge tone="ok">Configured</StatusBadge>
                ) : (
                  <StatusBadge tone="danger">Not configured</StatusBadge>
                )
              }
            />
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
