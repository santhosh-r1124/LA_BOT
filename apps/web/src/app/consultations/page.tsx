'use client';

import { consultationStatusLabel, type Consultation } from '@legal-platform/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { EmptyState, ErrorState, PageHeader, StatusBadge } from '@/components/ui';
import { ApiRequestError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { consultationClient } from '@/lib/consultation-client';
import { formatInr } from '@/lib/format';
import { openRazorpayCheckout } from '@/lib/razorpay-checkout';

const STATUS_TONE: Record<Consultation['status'], 'ok' | 'warn' | 'danger' | 'neutral'> = {
  REQUESTED: 'warn',
  ACCEPTED: 'ok',
  DECLINED: 'danger',
  CANCELLED: 'neutral',
  COMPLETED: 'ok',
  CLOSED: 'neutral',
};

const PAYMENT_LABEL: Record<
  Consultation['payment_status'],
  { tone: 'ok' | 'warn' | 'neutral'; label: string }
> = {
  UNPAID: { tone: 'warn', label: 'Unpaid' },
  PENDING: { tone: 'warn', label: 'Payment pending' },
  PAID: { tone: 'ok', label: 'Paid' },
  REFUNDED: { tone: 'neutral', label: 'Refunded' },
  WAIVED: { tone: 'neutral', label: 'Fee waived' },
};

function PayButton({ consultation, onPaid }: { consultation: Consultation; onPaid: () => void }) {
  const { user, accessToken } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay() {
    if (!accessToken || busy) return;
    setBusy(true);
    setError(null);
    try {
      const order = await consultationClient.createPaymentOrder(consultation.id, accessToken);
      if (!order.key_id) throw new Error('Payments are not configured on this server yet.');
      const result = await openRazorpayCheckout({
        keyId: order.key_id,
        orderId: order.gateway_order_id,
        amountMinor: order.amount_minor,
        currency: order.currency,
        description: consultation.topic,
        email: user?.email,
      });
      await consultationClient.verifyPayment(
        consultation.id,
        {
          payment_id: order.payment.id,
          gateway_payment_id: result.razorpay_payment_id,
          signature: result.razorpay_signature,
        },
        accessToken,
      );
      onPaid();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        disabled={busy}
        onClick={() => void pay()}
        className="btn btn-primary btn-sm self-start"
      >
        {busy ? 'Opening payment…' : `Pay ${formatInr(consultation.fee_amount) ?? ''}`}
      </button>
      {error && (
        <p role="alert" className="field-error text-sm">
          {error}
        </p>
      )}
    </div>
  );
}

function ConsultationCard({
  consultation,
  onCancel,
  onChanged,
}: {
  consultation: Consultation;
  onCancel: (id: string) => void;
  onChanged: () => void;
}) {
  const [cancelling, setCancelling] = useState(false);
  const canCancel = consultation.status === 'REQUESTED' || consultation.status === 'ACCEPTED';
  const canPay =
    (consultation.status === 'ACCEPTED' || consultation.status === 'COMPLETED') &&
    (consultation.payment_status === 'UNPAID' || consultation.payment_status === 'PENDING') &&
    consultation.fee_amount !== null &&
    Number(consultation.fee_amount) > 0;
  const payment = PAYMENT_LABEL[consultation.payment_status];

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
            <dd className="inline">
              {formatInr(consultation.fee_amount)} · {payment.label}
            </dd>
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
      <div className="flex flex-wrap items-start gap-2">
        {canPay && <PayButton consultation={consultation} onPaid={onChanged} />}
        {canCancel && (
          <button
            type="button"
            disabled={cancelling}
            onClick={() => {
              setCancelling(true);
              onCancel(consultation.id);
            }}
            className="btn btn-ghost btn-sm"
          >
            {cancelling ? 'Cancelling…' : 'Cancel'}
          </button>
        )}
      </div>
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
            <ConsultationCard key={c.id} consultation={c} onCancel={cancel} onChanged={load} />
          ))}
        </ul>
      )}
    </main>
  );
}
