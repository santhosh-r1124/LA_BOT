'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatDateTime, Pager, SelectFilter } from '@/components/admin';
import { EmptyState, ErrorState, StatusBadge, type Tone } from '@/components/ui';
import {
  adminClient,
  DISCOVERY_PROVIDERS,
  type CatalogEntry,
  type LegalDocument,
  type Paginated,
  type ProviderRunResult,
} from '@/lib/admin-client';
import { ApiRequestError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';

const CATALOG_TONE: Record<CatalogEntry['status'], Tone> = {
  NEW: 'accent',
  INGESTED: 'ok',
  INVALID: 'danger',
  SKIPPED: 'neutral',
};
const DOC_TONE: Record<LegalDocument['ingestion_status'], Tone> = {
  PENDING: 'neutral',
  PROCESSING: 'warn',
  COMPLETED: 'ok',
  FAILED: 'danger',
};

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiRequestError ? err.message : fallback;
}

function DiscoveryPanel({ token, onDone }: { token: string; onDone: () => void }) {
  const [selected, setSelected] = useState<string[]>([...DISCOVERY_PROVIDERS]);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ProviderRunResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (selected.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await adminClient.discover(token, selected);
      setResults(res.results);
      onDone();
    } catch (err) {
      setError(errorMessage(err, 'Discovery failed.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="surface flex flex-col gap-3 p-4" aria-labelledby="discover-heading">
      <h2 id="discover-heading" className="font-semibold">
        Discover sources
      </h2>
      <p className="muted text-sm">
        Finds candidate Indian Acts and adds them to the catalog below. Nothing is ingested until
        you ingest it. Live providers need outbound access to India Code / Hugging Face.
      </p>
      <fieldset className="flex flex-wrap gap-4">
        <legend className="sr-only">Providers</legend>
        {DISCOVERY_PROVIDERS.map((p) => (
          <label key={p} className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={selected.includes(p)}
              onChange={(e) =>
                setSelected((prev) =>
                  e.target.checked ? [...prev, p] : prev.filter((x) => x !== p),
                )
              }
            />
            {p}
          </label>
        ))}
      </fieldset>
      <button
        type="button"
        className="btn btn-primary btn-sm self-start"
        disabled={busy || selected.length === 0}
        onClick={() => void run()}
      >
        {busy ? 'Discovering…' : 'Run discovery'}
      </button>
      {error && (
        <p role="alert" className="field-error text-sm">
          {error}
        </p>
      )}
      {results && (
        <ul className="flex flex-col gap-1 text-sm" aria-live="polite">
          {results.map((r) => (
            <li key={r.provider} className={r.error ? 'field-error' : ''}>
              <strong>{r.provider}</strong>:{' '}
              {r.error ? r.error : `${r.discovered} found, ${r.upserted} added/refreshed`}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CatalogPanel({
  token,
  refreshKey,
  onIngested,
}: {
  token: string;
  refreshKey: number;
  onIngested: () => void;
}) {
  const [status, setStatus] = useState('NEW');
  const [provider, setProvider] = useState('');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<Paginated<CatalogEntry> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [batchSize, setBatchSize] = useState(10);
  const [batchMessage, setBatchMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    adminClient
      .catalog(token, { status: status || undefined, provider: provider || undefined, offset })
      .then(setData)
      .catch((err: unknown) => setError(errorMessage(err, 'Could not load the catalog.')));
  }, [token, status, provider, offset]);

  useEffect(() => load(), [load, refreshKey]);

  async function ingestOne(id: string) {
    setBusyId(id);
    try {
      await adminClient.ingestCatalogEntry(token, id);
    } catch (err) {
      setError(errorMessage(err, 'Ingestion failed.'));
    } finally {
      setBusyId(null);
      load();
      onIngested();
    }
  }

  async function ingestBatch() {
    setBusyId('batch');
    setBatchMessage(null);
    try {
      const res = await adminClient.ingestCatalogBatch(token, {
        provider: provider || undefined,
        limit: batchSize,
      });
      setBatchMessage(`${res.completed} ingested, ${res.failed} failed of ${res.attempted}.`);
    } catch (err) {
      setError(errorMessage(err, 'Batch ingestion failed.'));
    } finally {
      setBusyId(null);
      load();
      onIngested();
    }
  }

  return (
    <section className="surface flex flex-col gap-3 p-4" aria-labelledby="catalog-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="catalog-heading" className="font-semibold">
          Discovered catalog
        </h2>
        <div className="flex flex-wrap gap-3">
          <SelectFilter
            label="Status"
            value={status}
            options={['NEW', 'INGESTED', 'INVALID', 'SKIPPED']}
            onChange={(v) => {
              setStatus(v);
              setOffset(0);
            }}
          />
          <SelectFilter
            label="Provider"
            value={provider}
            options={DISCOVERY_PROVIDERS}
            onChange={(v) => {
              setProvider(v);
              setOffset(0);
            }}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="muted">Ingest the next</span>
        <input
          type="number"
          min={1}
          max={200}
          value={batchSize}
          onChange={(e) => setBatchSize(Math.max(1, Math.min(200, Number(e.target.value) || 1)))}
          className="input w-20 py-1"
          aria-label="Batch size"
        />
        <span className="muted">NEW entries{provider ? ` from ${provider}` : ''}</span>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={busyId !== null}
          onClick={() => void ingestBatch()}
        >
          {busyId === 'batch' ? 'Ingesting…' : 'Ingest batch'}
        </button>
        {batchMessage && <span aria-live="polite">{batchMessage}</span>}
      </div>
      <p className="subtle text-xs">
        Ingestion downloads, chunks and embeds each source — it needs GEMINI_API_KEY and can take
        about a minute per Act on the free tier.
      </p>
      {error && <ErrorState title="Catalog error" message={error} onRetry={load} />}
      {!data ? (
        <div className="skeleton h-24" />
      ) : data.items.length === 0 ? (
        <EmptyState title="No entries">Run discovery to populate the catalog.</EmptyState>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-white/5">
            {data.items.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{entry.title}</p>
                  <p className="subtle truncate text-xs">
                    {entry.provider} · {entry.state_code ? `State: ${entry.state_code}` : 'Central'}{' '}
                    ·{' '}
                    <a
                      href={entry.source_url}
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      source
                    </a>
                  </p>
                  {entry.notes && <p className="field-error mt-1 text-xs">{entry.notes}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge tone={CATALOG_TONE[entry.status]}>{entry.status}</StatusBadge>
                  {(entry.status === 'NEW' || entry.status === 'INVALID') && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busyId !== null}
                      onClick={() => void ingestOne(entry.id)}
                    >
                      {busyId === entry.id
                        ? 'Ingesting…'
                        : entry.status === 'INVALID'
                          ? 'Retry'
                          : 'Ingest'}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <Pager offset={offset} limit={data.limit} total={data.total} onChange={setOffset} />
        </>
      )}
    </section>
  );
}

function DocumentsPanel({ token, refreshKey }: { token: string; refreshKey: number }) {
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<Paginated<LegalDocument> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    adminClient
      .documents(token, { status: status || undefined, offset })
      .then(setData)
      .catch((err: unknown) => setError(errorMessage(err, 'Could not load documents.')));
  }, [token, status, offset]);

  useEffect(() => load(), [load, refreshKey]);

  async function reindex(id: string) {
    setBusyId(id);
    try {
      await adminClient.reindexDocument(token, id);
    } catch (err) {
      setError(errorMessage(err, 'Re-index failed.'));
    } finally {
      setBusyId(null);
      load();
    }
  }

  async function remove(doc: LegalDocument) {
    if (!window.confirm(`Remove “${doc.title}” and all its passages from the knowledge base?`))
      return;
    setBusyId(doc.id);
    try {
      await adminClient.deleteDocument(token, doc.id);
    } catch (err) {
      setError(errorMessage(err, 'Delete failed.'));
    } finally {
      setBusyId(null);
      load();
    }
  }

  return (
    <section className="surface flex flex-col gap-3 p-4" aria-labelledby="docs-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="docs-heading" className="font-semibold">
          Ingested documents
        </h2>
        <SelectFilter
          label="Status"
          value={status}
          options={['COMPLETED', 'FAILED', 'PROCESSING', 'PENDING']}
          onChange={(v) => {
            setStatus(v);
            setOffset(0);
          }}
        />
      </div>
      {error && <ErrorState title="Documents error" message={error} onRetry={load} />}
      {!data ? (
        <div className="skeleton h-24" />
      ) : data.items.length === 0 ? (
        <EmptyState title="Knowledge base is empty">
          Chat answers “insufficient verified information” until sources are ingested.
        </EmptyState>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-white/5">
            {data.items.map((doc) => (
              <li key={doc.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{doc.title}</p>
                  <p className="subtle text-xs">
                    {doc.chunk_count} passages ·{' '}
                    {doc.state_code ? `State: ${doc.state_code}` : 'Central'} · ingested{' '}
                    {formatDateTime(doc.created_at)}
                  </p>
                  {doc.ingestion_error && (
                    <p className="field-error mt-1 text-xs">{doc.ingestion_error}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge tone={DOC_TONE[doc.ingestion_status]}>
                    {doc.ingestion_status}
                  </StatusBadge>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={busyId !== null}
                    onClick={() => void reindex(doc.id)}
                  >
                    {busyId === doc.id ? 'Working…' : 'Re-index'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={busyId !== null}
                    onClick={() => void remove(doc)}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <Pager offset={offset} limit={data.limit} total={data.total} onChange={setOffset} />
        </>
      )}
    </section>
  );
}

export default function AdminKnowledgePage() {
  const { accessToken } = useAuth();
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = useCallback(() => setRefreshKey((k) => k + 1), []);

  if (!accessToken) return null;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="display mb-1 text-2xl">Knowledge base</h1>
        <p className="muted text-sm">
          Discover Indian legal sources, ingest them into the retrieval index, and maintain
          what&apos;s already there.
        </p>
      </div>
      <DiscoveryPanel token={accessToken} onDone={bump} />
      <CatalogPanel token={accessToken} refreshKey={refreshKey} onIngested={bump} />
      <DocumentsPanel token={accessToken} refreshKey={refreshKey} />
    </div>
  );
}
