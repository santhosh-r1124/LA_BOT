'use client';

import { MANDATORY_DISCLAIMER } from '@legal-platform/shared';
import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import { Disclaimer, ErrorState, StatusBadge } from '@/components/ui';
import { buttonClass, Field, inputClass } from '@/components/form';
import { ApiRequestError } from '@/lib/api-client';
import { advocateClient, type AdvocateDirectoryEntry } from '@/lib/advocate-client';
import { consultationClient, type CreateConsultationPayload } from '@/lib/consultation-client';
import { useAuth } from '@/lib/auth-context';
import { formatEnumLabel, formatInr } from '@/lib/format';

const MODES: Array<{ value: CreateConsultationPayload['mode']; label: string }> = [
  { value: 'VIDEO', label: 'Video call' },
  { value: 'PHONE', label: 'Phone call' },
  { value: 'IN_PERSON', label: 'In person' },
];

function BookConsultationForm({
  advocateProfileId,
  defaultPracticeArea,
}: {
  advocateProfileId: string;
  defaultPracticeArea: string;
}) {
  const { user, accessToken } = useAuth();
  const [topic, setTopic] = useState('');
  const [description, setDescription] = useState('');
  const [mode, setMode] = useState<CreateConsultationPayload['mode']>('VIDEO');
  const [practiceArea, setPracticeArea] = useState(defaultPracticeArea);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [booked, setBooked] = useState(false);

  if (!user) {
    return (
      <p className="alert mt-6 text-sm">
        <Link href="/login" className="font-medium underline underline-offset-2">
          Sign in
        </Link>{' '}
        as a consumer to book a consultation with this advocate.
      </p>
    );
  }

  if (user.role === 'ADVOCATE' || user.role === 'ADMIN' || user.role === 'LEGAL_ADMIN') {
    return null;
  }

  if (booked) {
    return (
      <div className="alert alert-ok mt-6 text-sm" role="status">
        <p className="font-semibold">Request sent.</p>
        <p className="mt-1">
          The advocate will accept or decline it shortly.{' '}
          <Link href="/consultations" className="font-medium underline underline-offset-2">
            View your consultations
          </Link>
          .
        </p>
      </div>
    );
  }

  async function onSubmit() {
    if (!accessToken || submitting) return;
    if (!topic.trim() || !description.trim() || !practiceArea.trim()) {
      setError('Please fill in the practice area, topic and description.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await consultationClient.create(
        {
          advocate_profile_id: advocateProfileId,
          practice_area: practiceArea.trim(),
          topic: topic.trim(),
          description: description.trim(),
          mode,
        },
        accessToken,
      );
      setBooked(true);
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : 'Could not send the request. Try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="surface-flat mt-6 p-5" aria-labelledby="book-heading">
      <h2 id="book-heading" className="display text-lg">
        Book a consultation
      </h2>
      <form
        className="mt-4 flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit();
        }}
      >
        <Field label="Practice area">
          <input
            type="text"
            value={practiceArea}
            onChange={(e) => setPracticeArea(e.target.value)}
            className={inputClass}
            required
          />
        </Field>
        <Field label="Topic">
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            className={inputClass}
            placeholder="e.g. Reviewing a vendor agreement"
            required
          />
        </Field>
        <Field label="Describe what you need help with">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className="input resize-y"
            required
          />
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="label">Preferred mode</legend>
          <div className="flex flex-wrap gap-2">
            {MODES.map((m) => (
              <label key={m.value} className="flex items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  name="mode"
                  value={m.value}
                  checked={mode === m.value}
                  onChange={() => setMode(m.value)}
                />
                {m.label}
              </label>
            ))}
          </div>
        </fieldset>

        {error && (
          <p role="alert" className="field-error text-sm">
            {error}
          </p>
        )}

        <button type="submit" disabled={submitting} className={buttonClass}>
          {submitting ? 'Sending request…' : 'Request consultation'}
        </button>
        <p className="subtle text-xs">
          This sends a request to the advocate — it isn&apos;t confirmed until they accept. Payment
          isn&apos;t handled by the platform yet.
        </p>
      </form>
    </section>
  );
}

export default function AdvocateProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [advocate, setAdvocate] = useState<AdvocateDirectoryEntry | null>(null);
  const [error, setError] = useState<{ message: string; retryable: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const retry = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    advocateClient
      .get(id)
      .then((res) => {
        if (!cancelled) setAdvocate(res);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const notFound = err instanceof ApiRequestError && err.status === 404;
        setError({
          message: notFound
            ? 'This advocate could not be found, or is no longer listed.'
            : 'Could not load this advocate right now.',
          retryable: !notFound,
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, nonce]);

  const fee = advocate ? formatInr(advocate.consultation_fee) : null;

  return (
    <main className="page page-narrow">
      <Link href="/advocates" className="btn btn-ghost btn-sm -ml-2 mb-4">
        ← Back to directory
      </Link>

      {loading ? (
        <div className="surface flex flex-col gap-3 p-6" role="status">
          <span className="sr-only">Loading advocate profile</span>
          <div className="skeleton h-7 w-1/2" />
          <div className="skeleton h-4 w-1/3" />
          <div className="skeleton mt-4 h-20" />
        </div>
      ) : error || !advocate ? (
        <ErrorState
          title="Profile unavailable"
          message={error?.message ?? 'Advocate not found.'}
          onRetry={error?.retryable ? retry : undefined}
        />
      ) : (
        <article className="surface p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="display text-2xl">{advocate.display_name || 'Advocate'}</h1>
              <p className="muted mt-1 text-sm">
                {advocate.city}, {advocate.state_code}
              </p>
            </div>
            <StatusBadge tone="ok">Verified by platform</StatusBadge>
          </div>

          <dl className="mt-6 grid gap-4 sm:grid-cols-2">
            {advocate.experience_years != null && (
              <div className="surface-flat p-3">
                <dt className="subtle text-xs">Experience</dt>
                <dd className="mt-0.5 font-semibold">{advocate.experience_years} years</dd>
              </div>
            )}
            {fee && (
              <div className="surface-flat p-3">
                <dt className="subtle text-xs">Consultation fee (set by advocate)</dt>
                <dd className="mt-0.5 font-semibold">{fee}</dd>
              </div>
            )}
            {advocate.languages.length > 0 && (
              <div className="surface-flat p-3">
                <dt className="subtle text-xs">Languages</dt>
                <dd className="mt-0.5">{advocate.languages.join(', ')}</dd>
              </div>
            )}
            {advocate.practice_areas.length > 0 && (
              <div className="surface-flat p-3 sm:col-span-2">
                <dt className="subtle text-xs">Practice areas</dt>
                <dd className="mt-1.5 flex flex-wrap gap-1.5">
                  {advocate.practice_areas.map((a) => (
                    <span key={a} className="badge">
                      {formatEnumLabel(a)}
                    </span>
                  ))}
                </dd>
              </div>
            )}
          </dl>

          {advocate.bio && (
            <section className="mt-6">
              <h2 className="subtle text-xs font-semibold uppercase tracking-wider">About</h2>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{advocate.bio}</p>
            </section>
          )}

          <BookConsultationForm
            advocateProfileId={advocate.id}
            defaultPracticeArea={advocate.practice_areas[0] ?? ''}
          />
        </article>
      )}

      <Disclaimer text={MANDATORY_DISCLAIMER} />
    </main>
  );
}
