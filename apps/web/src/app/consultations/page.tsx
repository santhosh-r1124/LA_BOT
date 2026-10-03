'use client';

import { consultationStatusLabel, type Consultation } from '@legal-platform/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { EmptyState, ErrorState, PageHeader, StatusBadge } from '@/components/ui';
import { ApiRequestError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { consultationClient } from '@/lib/consultation-client';
import { formatInr } from '@/lib/format';

const STATUS_TONE: Record<Consultation['status'], 'ok' | 'warn' | 'danger' | 'neutral'> = {
  REQUESTED: 'warn',
  ACCEPTED: 'ok',
  DECLINED: 'danger',
  CANCELLED: 'neutral',
  COMPLETED: 'ok',
  CLOSED: 'neutral',
};

function ConsultationCard({
  consultation,
  onCancel,
}: {
  consultation: Consultation;
  onCancel: (id: string) => void;
}) {
  const [cancelling, setCancelling] = useState(false);
  const canCancel = consultation.status === 'REQUESTED' || consultation.status === 'ACCEPTED';

  return (
    <li className="surface flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{consultation.topic}</p>
          <p className="muted text-sm">
            with {consultation.advocate_display_name || 'an advocate'} ·{' '}
            {consultation.practice_area}
          </p>
        </div>
        <StatusBadge tone={STATUS_TONE[consultation.status]}>
          {consultationStatusLabel(consultation.status)}
        </StatusBadge>
      </div>
      <p className="text-sm">{consultation.description}</p>
      <dl className="muted flex flex-wrap gap-x-6 gap-y-1 text-xs">
        {consultation.scheduled_at && (
          <div>
            <dt className="inline font-medium">Scheduled: </dt>
            <dd className="inline">{new Date(consultation.scheduled_at).toLocaleString()}</dd>
          </div>
        )}
        {consultation.fee_amount && (
          <div>
            <dt className="inline font-medium">Fee: </dt>
            <dd className="inline">{formatInr(consultation.fee_amount)}</dd>
          </div>
        )}
        {consultation.meeting_link && (
          <div>
            <dt className="inline font-medium">Link: </dt>
            <dd className="inline">
              <a
                href={consultation.meeting_link}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                Join
              </a>
            </dd>
          </div>
        )}
      </dl>
      {consultation.status === 'DECLINED' && consultation.decline_reason && (
        <p className="alert alert-danger text-sm">Declined: {consultation.decline_reason}</p>
      )}
      {consultation.status === 'CANCELLED' && consultation.cancellation_reason && (
        <p className="alert text-sm">Cancelled: {consultation.cancellation_reason}</p>
      )}
      {canCancel && (
        <button
          type="button"
          disabled={cancelling}
          onClick={() => {
            setCancelling(true);
            onCancel(consultation.id);
          }}
          className="btn btn-ghost btn-sm self-start"
        >
          {cancelling ? 'Cancelling…' : 'Cancel'}
        </button>
      )}
    </li>
  );
}

export default function ConsultationsPage() {
  const router = useRouter();
  const { user, accessToken, loading: authLoading } = useAuth();
  const [consultations, setConsultations] = useState<Consultation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!accessToken) return;
    setError(null);
    consultationClient
      .listMine(accessToken)
      .then((res) => setConsultations(res.items))
      .catch((err: unknown) =>
        setError(err instanceof ApiRequestError ? err.message : 'Could not load consultations.'),
      );
  }, [accessToken]);

  useEffect(() => {
    if (!authLoading && !user) router.replace('/login');
  }, [authLoading, user, router]);

  useEffect(() => {
    if (accessToken) load();
  }, [accessToken, load]);

  async function cancel(id: string) {
    if (!accessToken) return;
    try {
      await consultationClient.cancel(id, 'Cancelled by consumer.', accessToken);
    } finally {
      load();
    }
  }

  return (
    <main className="page page-narrow">
      <PageHeader
        eyebrow="Advocate connect"
        title="Your consultations"
        description="Requests you've sent to advocates and their status."
      />
      {error ? (
        <ErrorState title="Couldn't load consultations" message={error} onRetry={load} />
      ) : consultations === null ? (
        <div className="flex flex-col gap-3" role="status">
          <span className="sr-only">Loading consultations</span>
          {[0, 1].map((i) => (
            <div key={i} className="skeleton h-28" />
          ))}
        </div>
      ) : consultations.length === 0 ? (
        <EmptyState title="No consultations yet">
          Find an advocate in the directory and request a consultation.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {consultations.map((c) => (
            <ConsultationCard key={c.id} consultation={c} onCancel={cancel} />
          ))}
        </ul>
      )}
    </main>
  );
}
