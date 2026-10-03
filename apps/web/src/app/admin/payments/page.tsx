'use client';

import type { Payment } from '@legal-platform/shared';
import { useCallback, useEffect, useState } from 'react';
import { formatDateTime, Pager, SelectFilter } from '@/components/admin';
import { EmptyState, ErrorState, StatusBadge, type Tone } from '@/components/ui';
import { adminClient, type Paginated } from '@/lib/admin-client';
import { ApiRequestError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { formatInr } from '@/lib/format';

const TONE: Record<Payment['status'], Tone> = {
  CREATED: 'neutral',
  CAPTURED: 'ok',
  FAILED: 'danger',
  REFUNDED: 'accent',
};

function RefundControl({
  payment,
  token,
  onDone,
}: {
  payment: Payment;
  token: string;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refund() {
    const label = amount ? formatInr(amount) : `the full ${formatInr(payment.amount)}`;
    if (!window.confirm(`Refund ${label} to the consumer? This calls the payment gateway.`)) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await adminClient.refund(token, payment.id, amount || undefined);
      setMessage(
        `Refund ${res.refund_id} ${res.status}. The payment shows as refunded once the gateway confirms.`,
      );
      onDone();
    } catch (err) {
      setMessage(err instanceof ApiRequestError ? err.message : 'Refund failed.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
        Refund…
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <input
        type="number"
        min={1}
        step="0.01"
        placeholder={`Full (${payment.amount})`}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        className="input w-32 py-1"
        aria-label="Refund amount in rupees (leave blank for a full refund)"
      />
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={busy}
        onClick={() => void refund()}
      >
        {busy ? 'Refunding…' : 'Confirm refund'}
      </button>
      {message && <span aria-live="polite">{message}</span>}
    </div>
  );
}

export default function AdminPaymentsPage() {
  const { accessToken } = useAuth();
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<Paginated<Payment> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!accessToken) return;
    setError(null);
    adminClient
      .payments(accessToken, { status: status || undefined, offset })
      .then(setData)
      .catch((err: unknown) =>
        setError(err instanceof ApiRequestError ? err.message : 'Could not load payments.'),
      );
  }, [accessToken, status, offset]);

  useEffect(() => load(), [load]);

  return (
    <section aria-labelledby="payments-heading">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 id="payments-heading" className="display mb-1 text-2xl">
            Payments
          </h1>
          <p className="muted text-sm">
            Every payment attempt, including failed ones. Gateway status is authoritative.
          </p>
        </div>
        <SelectFilter
          label="Status"
          value={status}
          options={['CREATED', 'CAPTURED', 'FAILED', 'REFUNDED']}
          onChange={(v) => {
            setStatus(v);
            setOffset(0);
          }}
        />
      </div>
      {error ? (
        <ErrorState title="Payments unavailable" message={error} onRetry={load} />
      ) : !data ? (
        <div className="skeleton h-40" />
      ) : data.items.length === 0 ? (
        <EmptyState title="No payments yet" />
      ) : (
        <>
          <div className="surface overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="subtle text-xs uppercase tracking-wider">
                <tr>
                  <th className="p-3 font-medium">Created</th>
                  <th className="p-3 font-medium">Amount</th>
                  <th className="p-3 font-medium">Status</th>
                  <th className="p-3 font-medium">Gateway ids</th>
                  <th className="p-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((p) => (
                  <tr key={p.id} className="border-t border-white/5 align-top">
                    <td className="p-3">{formatDateTime(p.created_at)}</td>
                    <td className="p-3">
                      {formatInr(p.amount)}
                      {p.refunded_amount && (
                        <span className="subtle block text-xs">
                          refunded {formatInr(p.refunded_amount)}
                        </span>
                      )}
                    </td>
                    <td className="p-3">
                      <StatusBadge tone={TONE[p.status]}>{p.status}</StatusBadge>
                      {p.failure_reason && (
                        <span className="field-error block text-xs">{p.failure_reason}</span>
                      )}
                    </td>
                    <td className="subtle p-3 font-mono text-xs">
                      {p.gateway_order_id}
                      {p.gateway_payment_id && (
                        <span className="block">{p.gateway_payment_id}</span>
                      )}
                    </td>
                    <td className="p-3">
                      {p.status === 'CAPTURED' && accessToken && (
                        <RefundControl payment={p} token={accessToken} onDone={load} />
                      )}
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
