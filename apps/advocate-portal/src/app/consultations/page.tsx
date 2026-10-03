'use client';

import { consultationStatusLabel, type Consultation } from '@legal-platform/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { buttonClass, Field, inputClass, secondaryButtonClass } from '@/components/form';
import { ApiRequestError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { consultationClient } from '@/lib/consultation-client';

const STATUS_BADGE: Record<Consultation['status'], string> = {
  REQUESTED: 'badge badge-warn',
  ACCEPTED: 'badge badge-ok',
  DECLINED: 'badge badge-danger',
  CANCELLED: 'badge',
  COMPLETED: 'badge badge-ok',
  CLOSED: 'badge',
};

function AcceptForm({
  consultation,
  token,
  onDone,
}: {
  consultation: Consultation;
  token: string;
  onDone: () => void;
}) {
  const [scheduledAt, setScheduledAt] = useState('');
  const [meetingLink, setMeetingLink] = useState('');
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<'accept' | 'decline' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    if (!scheduledAt) {
      setError('Pick a date and time.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await consultationClient.accept(
        consultation.id,
        new Date(scheduledAt).toISOString(),
        meetingLink,
        token,
      );
      onDone();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not accept.');
    } finally {
      setBusy(false);
    }
  }

  async function decline() {
    if (!reason.trim()) {
      setError('Add a short reason for the consumer.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await consultationClient.decline(consultation.id, reason.trim(), token);
      onDone();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not decline.');
    } finally {
      setBusy(false);
    }
  }

  if (mode === null) {
    return (
      <div className="flex gap-2">
        <button type="button" onClick={() => setMode('accept')} className={buttonClass}>
          Accept
        </button>
        <button type="button" onClick={() => setMode('decline')} className={secondaryButtonClass}>
          Decline
        </button>
      </div>
    );
  }

  if (mode === 'decline') {
    return (
      <div className="flex flex-col gap-2">
        <Field label="Reason for declining">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            className={inputClass}
          />
        </Field>
        {error && <p className="field-error text-sm">{error}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void decline()}
            className={buttonClass}
          >
            {busy ? 'Declining…' : 'Confirm decline'}
          </button>
          <button type="button" onClick={() => setMode(null)} className={secondaryButtonClass}>
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Field label="Scheduled date & time">
        <input
          type="datetime-local"
          value={scheduledAt}
          onChange={(e) => setScheduledAt(e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field
        label="Meeting link (optional)"
        hint="A Google Meet/Zoom link, or leave blank for phone/in-person"
      >
        <input
          type="url"
          value={meetingLink}
          onChange={(e) => setMeetingLink(e.target.value)}
          className={inputClass}
        />
      </Field>
      {error && <p className="field-error text-sm">{error}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={() => void accept()} className={buttonClass}>
          {busy ? 'Accepting…' : 'Confirm accept'}
        </button>
        <button type="button" onClick={() => setMode(null)} className={secondaryButtonClass}>
          Back
        </button>
      </div>
    </div>
  );
}

function ConsultationRow({
  consultation,
  token,
  onChanged,
}: {
  consultation: Consultation;
  token: string;
  onChanged: () => void;
}) {
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function complete() {
    setBusy(true);
    setError(null);
    try {
      await consultationClient.complete(consultation.id, notes, token);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not mark complete.');
    } finally {
      setBusy(false);
    }
  }

  async function close() {
    setBusy(true);
    setError(null);
    try {
      await consultationClient.close(consultation.id, token);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not close.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="surface flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{consultation.topic}</p>
          <p className="text-fg-muted text-sm">
            {consultation.consumer_display_name || 'A consumer'} · {consultation.practice_area} ·{' '}
            {consultation.mode}
          </p>
        </div>
        <span className={STATUS_BADGE[consultation.status]}>
          {consultationStatusLabel(consultation.status)}
        </span>
      </div>
      <p className="text-sm">{consultation.description}</p>
      {consultation.scheduled_at && (
        <p className="text-fg-muted text-xs">
          Scheduled: {new Date(consultation.scheduled_at).toLocaleString()}
          {consultation.meeting_link && (
            <>
              {' · '}
              <a
                href={consultation.meeting_link}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                Join link
              </a>
            </>
          )}
        </p>
      )}

      {consultation.status === 'REQUESTED' && (
        <AcceptForm consultation={consultation} token={token} onDone={onChanged} />
      )}

      {consultation.status === 'ACCEPTED' && (
        <div className="flex flex-col gap-2">
          <Field label="Matter notes (private, optional)">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className={inputClass}
            />
          </Field>
          {error && <p className="field-error text-sm">{error}</p>}
          <button
            type="button"
            disabled={busy}
            onClick={() => void complete()}
            className={buttonClass}
          >
            {busy ? 'Saving…' : 'Mark completed'}
          </button>
        </div>
      )}

      {consultation.status === 'COMPLETED' && (
        <div className="flex flex-col gap-2">
          {consultation.advocate_notes && (
            <p className="text-fg-muted text-sm">Notes: {consultation.advocate_notes}</p>
          )}
          {error && <p className="field-error text-sm">{error}</p>}
          <button
            type="button"
            disabled={busy}
            onClick={() => void close()}
            className={secondaryButtonClass}
          >
            {busy ? 'Closing…' : 'Close matter'}
          </button>
        </div>
      )}
    </li>
  );
}

export default function AdvocateConsultationsPage() {
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
        setError(err instanceof ApiRequestError ? err.message : 'Could not load requests.'),
      );
  }, [accessToken]);

  useEffect(() => {
    if (!authLoading && !user) router.replace('/login');
  }, [authLoading, user, router]);

  useEffect(() => {
    if (accessToken) load();
  }, [accessToken, load]);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10">
      <div>
        <h1 className="display text-2xl">Consultation requests</h1>
        <p className="text-fg-muted mt-1 text-sm">
          Accept or decline requests, then mark a matter complete and close it once you&apos;re
          done.
        </p>
      </div>

      {error ? (
        <p role="alert" className="alert alert-danger text-sm">
          {error}
        </p>
      ) : consultations === null ? (
        <p className="text-fg-muted text-sm">Loading…</p>
      ) : consultations.length === 0 ? (
        <p className="text-fg-muted surface-flat p-6 text-center text-sm">
          No consultation requests yet.
        </p>
      ) : accessToken ? (
        <ul className="flex flex-col gap-3">
          {consultations.map((c) => (
            <ConsultationRow key={c.id} consultation={c} token={accessToken} onChanged={load} />
          ))}
        </ul>
      ) : null}
    </main>
  );
}
