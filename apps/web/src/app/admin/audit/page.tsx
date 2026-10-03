'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatDateTime, Pager, SelectFilter } from '@/components/admin';
import { EmptyState, ErrorState } from '@/components/ui';
import { adminClient, type AuditEvent, type Paginated } from '@/lib/admin-client';
import { ApiRequestError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';

const ACTIONS = [
  'advocate.verified',
  'advocate.rejected',
  'user.suspended',
  'user.activated',
  'risk_query.reviewed',
  'payment.refund_requested',
  'legal_source.ingested',
  'legal_source.discovery_run',
  'legal_source.catalog_entry_ingested',
  'legal_source.catalog_batch_ingested',
  'legal_source.reindexed',
  'legal_source.deleted',
] as const;

export default function AdminAuditPage() {
  const { accessToken } = useAuth();
  const [action, setAction] = useState('');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<Paginated<AuditEvent> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!accessToken) return;
    setError(null);
    adminClient
      .audit(accessToken, { action: action || undefined, offset })
      .then(setData)
      .catch((err: unknown) =>
        setError(err instanceof ApiRequestError ? err.message : 'Could not load the audit log.'),
      );
  }, [accessToken, action, offset]);

  useEffect(() => load(), [load]);

  return (
    <section aria-labelledby="audit-heading">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 id="audit-heading" className="display mb-1 text-2xl">
            Audit log
          </h1>
          <p className="muted text-sm">
            Append-only record of privileged actions. Entries can&apos;t be edited or deleted.
          </p>
        </div>
        <SelectFilter
          label="Action"
          value={action}
          options={ACTIONS}
          onChange={(v) => {
            setAction(v);
            setOffset(0);
          }}
        />
      </div>
      {error ? (
        <ErrorState title="Audit log unavailable" message={error} onRetry={load} />
      ) : !data ? (
        <div className="skeleton h-40" />
      ) : data.items.length === 0 ? (
        <EmptyState title="No entries" />
      ) : (
        <>
          <div className="surface overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="subtle text-xs uppercase tracking-wider">
                <tr>
                  <th className="p-3 font-medium">When</th>
                  <th className="p-3 font-medium">Who</th>
                  <th className="p-3 font-medium">Action</th>
                  <th className="p-3 font-medium">Target</th>
                  <th className="p-3 font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((e) => (
                  <tr key={e.id} className="border-t border-white/5 align-top">
                    <td className="whitespace-nowrap p-3">{formatDateTime(e.created_at)}</td>
                    <td className="p-3">
                      {e.actor_email ?? '—'}
                      {e.ip_address && <span className="subtle block text-xs">{e.ip_address}</span>}
                    </td>
                    <td className="p-3 font-mono text-xs">{e.action}</td>
                    <td className="subtle p-3 text-xs">
                      {e.target_type}
                      {e.target_id && <span className="block font-mono">{e.target_id}</span>}
                    </td>
                    <td className="subtle max-w-xs break-words p-3 font-mono text-xs">
                      {e.details ? JSON.stringify(e.details) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager offset={offset} limit={data.limit} total={data.total} onChange={setOffset} />
        </>
      )}
    </section>
  );
}
