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
  formatChecks,
  summariseAi,
  summariseDirectory,
  summariseLibrary,
  summariseServices,
  type InfraHealth,
  type StatusCell,
} from '@/lib/status-summary';

type AiCheck =
  { kind: 'idle' } | { kind: 'running' } | { kind: 'done'; ok: boolean; message: string };

/**
 * `status-summary` keeps the exact, technical wording (and has tests for it). This
 * panel is read by people who have never heard of Redis or "fixtures", so the
 * words are swapped for plain ones here; the technical detail stays one click away.
 */
const PLAIN_WORDING: Array<[RegExp, string]> = [
  [
    /Test fixtures for local use, not real case law\./,
    'Sample passages for trying the product, not real case law.',
  ],
  [/Keyword and meaning-based search\./, 'Finds passages by your words and by meaning.'],
  [/Keyword search only\./, 'Finds passages by matching your words.'],
  [/The web server could not reach the API\./, 'This page could not reach the server.'],
];

function plainNote(note: string): string {
  return PLAIN_WORDING.reduce((text, [pattern, plain]) => text.replace(pattern, plain), note);
}

function plainAi(cell: StatusCell, offline: boolean): StatusCell {
  if (!offline) return cell;
  return {
    ...cell,
    badge: 'Switched off',
    note: 'AI answers are switched off on this computer. Replies show the passages that match your question and a risk level worked out by fixed rules, with no written explanation.',
  };
}

function plainServices(infra: InfraHealth): { cell: StatusCell; details: string } {
  const cell = summariseServices(infra);
  const details = formatChecks(infra.checks);
  const hasChecks = Object.keys(infra.checks ?? {}).length > 0;
  const unit = hasChecks ? 'parts running' : cell.unit;

  if (infra.status === 'ok') {
    return { cell: { ...cell, unit, note: 'Everything needed is running.' }, details };
  }
  if (infra.status === 'degraded') {
    return {
      cell: {
        ...cell,
        unit,
        note: 'Part of the system is not responding, so some features may fail.',
      },
      details,
    };
  }
  return { cell: { ...cell, note: plainNote(cell.note) }, details: '' };
}

function Cell({
  cell,
  details,
  children,
}: {
  cell: StatusCell;
  /** Technical detail for people who want it, collapsed by default. */
  details?: string;
  children?: React.ReactNode;
}) {
  return (
    <li className="bg-elevated flex min-w-0 flex-col items-start gap-3 p-5">
      <h3 className="caps subtle">{cell.label}</h3>
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="stat-value">{cell.figure}</span>
        {cell.unit && <span className="muted text-sm">{cell.unit}</span>}
      </p>
      <StatusBadge tone={cell.tone}>{cell.badge}</StatusBadge>
      <p className="muted text-sm leading-relaxed">{plainNote(cell.note)}</p>
      {details && (
        <details className="disclosure subtle w-full text-xs">
          <summary className="min-h-10 w-fit">Technical details</summary>
          <p className="mono mt-1 break-words">{details}</p>
        </details>
      )}
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
  const services = plainServices(infra);

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
            <button type="button" onClick={refresh} className="btn btn-secondary">
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
            <Cell cell={services.cell} details={services.details} />
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
                <Cell cell={plainAi(summariseAi(status.llm), !aiConfigured)}>
                  {aiConfigured && (
                    <div className="flex flex-col items-start gap-2">
                      <button
                        type="button"
                        onClick={testAi}
                        aria-busy={aiCheck.kind === 'running' ? true : undefined}
                        className="btn btn-secondary"
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
            <Cell cell={services.cell} details={services.details} />
          </ul>
        </>
      )}
    </section>
  );
}
