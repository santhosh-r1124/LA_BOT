'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { RefreshIcon } from '@/components/icons';
import {
  ErrorState,
  formatRelativeTime,
  SectionHeader,
  Skeleton,
  StatusBadge,
} from '@/components/ui';
import { ApiRequestError } from '@/lib/api-client';
import { providerLabel, statusClient, usePlatformStatus } from '@/lib/status-client';
import {
  aiMode,
  summariseAi,
  summariseDirectory,
  summariseLibrary,
  summariseServices,
  type InfraHealth,
  type StatusCell,
} from '@/lib/status-summary';

type AiCheck =
  { kind: 'idle' } | { kind: 'running' } | { kind: 'done'; ok: boolean; message: string };

function Cell({ cell, children }: { cell: StatusCell; children?: React.ReactNode }) {
  return (
    <li className="bg-elevated flex min-w-0 flex-col items-start gap-3 p-5">
      <h3 className="caps subtle">{cell.label}</h3>
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="stat-value">{cell.figure}</span>
        {cell.unit && <span className="muted text-sm">{cell.unit}</span>}
      </p>
      <StatusBadge tone={cell.tone}>{cell.badge}</StatusBadge>
      <p className="muted text-sm leading-relaxed">{cell.note}</p>
      {children}
    </li>
  );
}

function CellSkeleton() {
  return (
    <li className="bg-elevated flex flex-col gap-3 p-5" aria-hidden="true">
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-8 w-2/5" />
      <Skeleton className="rounded-pill h-6 w-24" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
    </li>
  );
}

/**
 * Real platform status: infrastructure (web -> API -> Postgres/Redis via the
 * `/api/health` route) plus capability status from `GET /api/v1/status`.
 * Nothing here is inferred or decorative: every value is read at load time and
 * "Refresh" reads it again. "AI answers: off" is shown as a mode, not a fault.
 */
export function SystemStatus() {
  const headingId = useId();
  const { state, reload } = usePlatformStatus();
  const [infra, setInfra] = useState<InfraHealth>({ status: 'loading', detail: 'Checking…' });
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [aiCheck, setAiCheck] = useState<AiCheck>({ kind: 'idle' });

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

  const status = state.kind === 'ready' ? state.status : null;
  const aiConfigured = status ? aiMode(status) === 'ai' : false;

  return (
    <section aria-labelledby={headingId} className="section">
      <SectionHeader
        id={headingId}
        eyebrow="This setup"
        title="What is running on this machine"
        description="Read from the local server each time you open this page. Nothing here is estimated."
        actions={
          <>
            <span className="subtle text-xs" aria-live="polite">
              {checkedAt ? `Checked ${formatRelativeTime(checkedAt)}` : 'Checking…'}
            </span>
            <button type="button" onClick={refresh} className="btn btn-secondary btn-sm">
              <RefreshIcon />
              Refresh
            </button>
          </>
        }
      />

      {state.kind === 'error' ? (
        <div className="flex flex-col gap-3">
          <ErrorState
            title="Could not read the platform status"
            message={`${state.message} The pages still open, but questions cannot be answered until the server responds.`}
            onRetry={refresh}
          />
          <ul className="border-line bg-line rounded-item grid gap-px overflow-hidden border">
            <Cell cell={summariseServices(infra)} />
          </ul>
        </div>
      ) : (
        <>
          <span className="sr-only" role="status">
            {state.kind === 'loading' ? 'Loading platform status' : ''}
          </span>
          <ul className="border-line bg-line rounded-item grid gap-px overflow-hidden border sm:grid-cols-2 lg:grid-cols-4">
            {status ? (
              <>
                <Cell cell={summariseLibrary(status.knowledge_base)} />
                <Cell cell={summariseAi(status.llm)}>
                  {aiConfigured && (
                    <div className="flex flex-col items-start gap-2">
                      <button
                        type="button"
                        onClick={testAi}
                        aria-busy={aiCheck.kind === 'running' ? true : undefined}
                        className="btn btn-secondary btn-sm"
                      >
                        {aiCheck.kind === 'running' ? 'Testing' : 'Test AI connection'}
                      </button>
                      {aiCheck.kind === 'done' && (
                        <p
                          role="status"
                          className={`text-xs ${aiCheck.ok ? 'text-ok' : 'text-danger'}`}
                        >
                          {aiCheck.message}
                        </p>
                      )}
                    </div>
                  )}
                </Cell>
                <Cell cell={summariseDirectory(status.advocate_directory)} />
              </>
            ) : (
              <>
                <CellSkeleton />
                <CellSkeleton />
                <CellSkeleton />
              </>
            )}
            <Cell cell={summariseServices(infra)} />
          </ul>
        </>
      )}
    </section>
  );
}
