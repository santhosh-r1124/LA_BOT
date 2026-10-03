'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatDateTime, Pager } from '@/components/admin';
import { EmptyState, ErrorState, StatusBadge } from '@/components/ui';
import { adminClient, type Paginated, type RiskReviewItem } from '@/lib/admin-client';
import { ApiRequestError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { formatEnumLabel } from '@/lib/format';

function RiskCard({
  item,
  token,
  onDone,
}: {
  item: RiskReviewItem;
  token: string;
  onDone: () => void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showReply, setShowReply] = useState(false);

  async function review() {
    setBusy(true);
    setError(null);
    try {
      await adminClient.markReviewed(token, item.id, note.trim());
      onDone();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not mark as reviewed.');
      setBusy(false);
    }
  }

  return (
    <li className="surface flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={item.risk_level === 'CRITICAL' ? 'danger' : 'warn'}>
            {item.risk_level}
          </StatusBadge>
          {item.legal_category && (
            <span className="badge">{formatEnumLabel(item.legal_category)}</span>
          )}
          {item.jurisdiction_scope && (
            <span className="badge">{formatEnumLabel(item.jurisdiction_scope)}</span>
          )}
          <span className="subtle text-xs">
            {item.is_anonymous ? 'Anonymous visitor' : 'Signed-in user'}
          </span>
        </div>
        <span className="subtle text-xs">{formatDateTime(item.created_at)}</span>
      </div>
      <blockquote className="surface-flat whitespace-pre-wrap p-3 text-sm">
        {item.content}
      </blockquote>
      {item.assistant_reply && (
        <div>
          <button
            type="button"
            className="btn btn-ghost btn-sm -ml-2"
            aria-expanded={showReply}
            onClick={() => setShowReply((v) => !v)}
          >
            {showReply ? 'Hide' : 'Show'} the assistant&apos;s reply
          </button>
          {showReply && (
            <p className="muted mt-1 whitespace-pre-wrap text-sm">{item.assistant_reply}</p>
          )}
        </div>
      )}
      {item.reviewed_at ? (
        <p className="alert text-sm">
          Reviewed {formatDateTime(item.reviewed_at)}
          {item.review_note ? ` — ${item.review_note}` : ''}
        </p>
      ) : (
        <>
          <label className="flex flex-col gap-1.5">
            <span className="label">Review note (optional, internal)</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="input resize-y"
            />
          </label>
          {error && (
            <p role="alert" className="field-error text-sm">
              {error}
            </p>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => void review()}
            className="btn btn-primary btn-sm self-start"
          >
            {busy ? 'Saving…' : 'Mark reviewed'}
          </button>
        </>
      )}
    </li>
  );
}

export default function AdminRiskReviewPage() {
  const { accessToken } = useAuth();
  const [reviewed, setReviewed] = useState(false);
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<Paginated<RiskReviewItem> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!accessToken) return;
    setError(null);
    adminClient
      .riskQueue(accessToken, { reviewed, offset })
      .then(setData)
      .catch((err: unknown) =>
        setError(err instanceof ApiRequestError ? err.message : 'Could not load the queue.'),
      );
  }, [accessToken, reviewed, offset]);

  useEffect(() => load(), [load]);

  return (
    <section aria-labelledby="risk-heading">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 id="risk-heading" className="display mb-1 text-2xl">
            High-risk query review
          </h1>
          <p className="muted text-sm">
            Chat questions classified HIGH or CRITICAL. Critical first, then oldest first.
          </p>
        </div>
        <div className="flex gap-1" role="group" aria-label="Queue filter">
          {[false, true].map((value) => (
            <button
              key={String(value)}
              type="button"
              aria-pressed={reviewed === value}
              className={`btn btn-sm ${reviewed === value ? 'btn-secondary' : 'btn-ghost'}`}
              onClick={() => {
                setReviewed(value);
                setOffset(0);
              }}
            >
              {value ? 'Reviewed' : 'To review'}
            </button>
          ))}
        </div>
      </div>
      {error ? (
        <ErrorState title="Queue unavailable" message={error} onRetry={load} />
      ) : !data ? (
        <div className="skeleton h-40" />
      ) : data.items.length === 0 ? (
        <EmptyState title={reviewed ? 'Nothing reviewed yet' : 'Queue is empty'}>
          {reviewed ? 'Reviewed queries will appear here.' : 'No high-risk queries need review.'}
        </EmptyState>
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {data.items.map((item) =>
              accessToken ? (
                <RiskCard key={item.id} item={item} token={accessToken} onDone={load} />
              ) : null,
            )}
          </ul>
          <Pager offset={offset} limit={data.limit} total={data.total} onChange={setOffset} />
        </>
      )}
    </section>
  );
}
