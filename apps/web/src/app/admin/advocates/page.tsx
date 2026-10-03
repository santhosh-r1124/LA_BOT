'use client';

import { useCallback, useEffect, useState } from 'react';
import { Pager } from '@/components/admin';
import { EmptyState, ErrorState } from '@/components/ui';
import { adminClient, type AdminAdvocate, type Paginated } from '@/lib/admin-client';
import { ApiRequestError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { formatEnumLabel, formatInr } from '@/lib/format';

function AdvocateReviewCard({
  advocate,
  token,
  onDone,
}: {
  advocate: AdminAdvocate;
  token: string;
  onDone: () => void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'verify' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(kind: 'verify' | 'reject') {
    if (kind === 'reject' && !note.trim()) {
      setError('A rejection needs a note — the advocate sees it.');
      return;
    }
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'verify') await adminClient.verifyAdvocate(token, advocate.id, note.trim());
      else await adminClient.rejectAdvocate(token, advocate.id, note.trim());
      onDone();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Action failed.');
      setBusy(null);
    }
  }

  return (
    <li className="surface flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{advocate.display_name || 'Unnamed advocate'}</p>
          <p className="muted text-sm">
            {advocate.email} · {advocate.city}, {advocate.state_code}
          </p>
        </div>
        <span className="badge badge-warn">{advocate.verification_status.replace('_', ' ')}</span>
      </div>
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div>
          <dt className="subtle inline text-xs">Practice areas: </dt>
          <dd className="inline">
            {advocate.practice_areas.map(formatEnumLabel).join(', ') || '—'}
          </dd>
        </div>
        <div>
          <dt className="subtle inline text-xs">Languages: </dt>
          <dd className="inline">{advocate.languages.join(', ') || '—'}</dd>
        </div>
        <div>
          <dt className="subtle inline text-xs">Experience: </dt>
          <dd className="inline">
            {advocate.experience_years != null ? `${advocate.experience_years} years` : '—'}
          </dd>
        </div>
        <div>
          <dt className="subtle inline text-xs">Fee: </dt>
          <dd className="inline">{formatInr(advocate.consultation_fee) ?? '—'}</dd>
        </div>
      </dl>
      {advocate.bio && <p className="muted text-sm">{advocate.bio}</p>}
      <p className="alert text-xs">
        Check the enrolment number with the relevant State Bar Council before verifying — the
        platform does not do this automatically.
      </p>
      <label className="flex flex-col gap-1.5">
        <span className="label">Reviewer note (required to reject; shown to the advocate)</span>
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
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void act('verify')}
          className="btn btn-primary btn-sm"
        >
          {busy === 'verify' ? 'Verifying…' : 'Verify'}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void act('reject')}
          className="btn btn-secondary btn-sm"
        >
          {busy === 'reject' ? 'Rejecting…' : 'Reject'}
        </button>
      </div>
    </li>
  );
}

export default function AdminAdvocatesPage() {
  const { accessToken } = useAuth();
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<Paginated<AdminAdvocate> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!accessToken) return;
    setError(null);
    adminClient
      .pendingAdvocates(accessToken, offset)
      .then(setData)
      .catch((err: unknown) =>
        setError(err instanceof ApiRequestError ? err.message : 'Could not load the queue.'),
      );
  }, [accessToken, offset]);

  useEffect(() => load(), [load]);

  return (
    <section aria-labelledby="advocates-heading">
      <h1 id="advocates-heading" className="display mb-1 text-2xl">
        Advocate verification
      </h1>
      <p className="muted mb-4 text-sm">
        Oldest first. Verified advocates appear in the public directory and can receive bookings.
      </p>
      {error ? (
        <ErrorState title="Queue unavailable" message={error} onRetry={load} />
      ) : !data ? (
        <div className="skeleton h-40" />
      ) : data.items.length === 0 ? (
        <EmptyState title="Nobody waiting">No advocates are awaiting verification.</EmptyState>
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {data.items.map((a) =>
              accessToken ? (
                <AdvocateReviewCard key={a.id} advocate={a} token={accessToken} onDone={load} />
              ) : null,
            )}
          </ul>
          <Pager offset={offset} limit={data.limit} total={data.total} onChange={setOffset} />
        </>
      )}
    </section>
  );
}
