'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { CountCard } from '@/components/admin';
import { ErrorState } from '@/components/ui';
import { adminClient, type AdminOverview } from '@/lib/admin-client';
import { ApiRequestError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';

export default function AdminOverviewPage() {
  const { accessToken } = useAuth();
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!accessToken) return;
    setError(null);
    adminClient
      .overview(accessToken)
      .then(setData)
      .catch((err: unknown) =>
        setError(err instanceof ApiRequestError ? err.message : 'Could not load the overview.'),
      );
  }, [accessToken]);

  useEffect(() => load(), [load]);

  if (error) return <ErrorState title="Overview unavailable" message={error} onRetry={load} />;
  if (!data) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" role="status">
        <span className="sr-only">Loading overview</span>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="skeleton h-36" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          href="/admin/advocates"
          className="surface surface-interactive flex items-center justify-between p-4"
        >
          <span className="font-semibold">Advocates awaiting verification</span>
          <span
            className={`badge ${data.advocates_awaiting_verification > 0 ? 'badge-warn' : 'badge-ok'}`}
          >
            {data.advocates_awaiting_verification}
          </span>
        </Link>
        <Link
          href="/admin/risk"
          className="surface surface-interactive flex items-center justify-between p-4"
        >
          <span className="font-semibold">High-risk queries to review</span>
          <span className={`badge ${data.risk_review_pending > 0 ? 'badge-warn' : 'badge-ok'}`}>
            {data.risk_review_pending}
          </span>
        </Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <CountCard title="Users" counts={data.users_by_role} />
        <CountCard title="Consultations" counts={data.consultations_by_status} />
        <CountCard title="Payments" counts={data.payments_by_status} />
        <CountCard
          title="Ingested documents"
          counts={data.legal_documents_by_status}
          footer={
            <Link href="/admin/knowledge" className="link text-sm">
              Manage knowledge base
            </Link>
          }
        />
        <CountCard title="Discovered sources" counts={data.catalog_by_status} />
      </div>
    </div>
  );
}
