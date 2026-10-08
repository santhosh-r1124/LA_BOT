'use client';

import { MANDATORY_DISCLAIMER } from '@legal-platform/shared';
import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import { Disclaimer, ErrorState, StatusBadge } from '@/components/ui';
import { ApiRequestError } from '@/lib/api-client';
import { advocateClient, type AdvocateDirectoryEntry } from '@/lib/advocate-client';
import {
  formatInr,
  formatPhone,
  languageOptionLabel,
  phoneHref,
  practiceAreaLabel,
  stateOptionLabel,
} from '@/lib/format';

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
                {advocate.city}, {stateOptionLabel(advocate.state_code)}
              </p>
            </div>
            {advocate.is_sample ? (
              <StatusBadge tone="warn">Sample listing · not verified</StatusBadge>
            ) : (
              <StatusBadge tone="ok">Verified by platform</StatusBadge>
            )}
          </div>

          {advocate.is_sample && (
            <div className="alert alert-warn mt-4" role="note">
              <p className="text-sm">
                This is synthetic sample data for trying the directory, not a real advocate. The
                name and contact details are made up and have not been verified. Don&apos;t contact
                them or rely on them for legal help.
              </p>
            </div>
          )}

          {advocate.is_sample && (advocate.phone || advocate.email) && (
            <section className="surface-flat mt-6 p-4">
              <h2 className="subtle text-xs font-semibold uppercase tracking-wider">
                Contact (sample data, not real)
              </h2>
              <p className="muted mt-1.5 text-sm">
                {[advocate.phone && formatPhone(advocate.phone), advocate.email]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </section>
          )}

          {!advocate.is_sample && (advocate.phone || advocate.email) && (
            <section className="surface-flat mt-6 flex flex-wrap items-center gap-3 p-4">
              <h2 className="subtle w-full text-xs font-semibold uppercase tracking-wider">
                Contact
              </h2>
              {advocate.phone && (
                <a href={phoneHref(advocate.phone)} className="btn btn-primary btn-sm">
                  Call {formatPhone(advocate.phone)}
                </a>
              )}
              {advocate.email && (
                <a href={`mailto:${advocate.email}`} className="btn btn-secondary btn-sm">
                  Email {advocate.email}
                </a>
              )}
            </section>
          )}

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
                <dd className="mt-0.5">{advocate.languages.map(languageOptionLabel).join(', ')}</dd>
              </div>
            )}
            {advocate.practice_areas.length > 0 && (
              <div className="surface-flat p-3 sm:col-span-2">
                <dt className="subtle text-xs">Practice areas</dt>
                <dd className="mt-1.5 flex flex-wrap gap-1.5">
                  {advocate.practice_areas.map((a) => (
                    <span key={a} className="badge">
                      {practiceAreaLabel(a)}
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

          <p className="alert mt-6 text-sm">
            Online booking isn&apos;t available yet. Contact the advocate directly to arrange a
            consultation.
          </p>
        </article>
      )}

      <Disclaimer text={MANDATORY_DISCLAIMER} />
    </main>
  );
}
