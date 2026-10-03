'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { consultationClient } from '@/lib/consultation-client';

const STATUS: Record<string, { label: string; className: string; next: string }> = {
  PENDING: {
    label: 'Awaiting verification',
    className: 'badge badge-warn',
    next: 'An administrator will review your enrolment details. Keep your profile complete in the meantime.',
  },
  IN_REVIEW: {
    label: 'In review',
    className: 'badge badge-accent',
    next: 'Your enrolment is being reviewed.',
  },
  VERIFIED: {
    label: 'Verified',
    className: 'badge badge-ok',
    next: 'Your profile is listed in the public advocate directory.',
  },
  REJECTED: {
    label: 'Not approved',
    className: 'badge badge-danger',
    next: 'See the reviewer note on your profile page.',
  },
};

// Still-planned portal features. Listed plainly as not yet available — no
// placeholder counts or fake activity. Consultation requests/matters moved
// out of this list in Phase 9, now that they're real (app/consultations).
// Earnings needs Phase 10 (payments) before any figure here would be real.
const PLANNED = ['Scheduling & availability sync', 'Client messaging', 'Document exchange'];

interface RequestCounts {
  pending: number;
  upcoming: number;
  completed: number;
}

export default function AdvocatePortalHome() {
  const { user, profile, accessToken, loading } = useAuth();
  const [counts, setCounts] = useState<RequestCounts | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    Promise.all([
      consultationClient.listMine(accessToken, 'REQUESTED'),
      consultationClient.listMine(accessToken, 'ACCEPTED'),
      consultationClient.listMine(accessToken, 'COMPLETED'),
    ])
      .then(([pending, upcoming, completed]) => {
        if (!cancelled) {
          setCounts({
            pending: pending.total,
            upcoming: upcoming.total,
            completed: completed.total,
          });
        }
      })
      .catch(() => {
        if (!cancelled) setCounts(null);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  if (loading) {
    return (
      <main className="page page-narrow" aria-busy="true">
        <div className="skeleton h-8 w-1/2" />
        <div className="skeleton mt-4 h-32" />
      </main>
    );
  }

  if (!user || !profile) {
    return (
      <main className="page page-narrow flex flex-col gap-5 pt-12">
        <span className="eyebrow">For advocates</span>
        <h1 className="display text-3xl">Be found by people who need an advocate.</h1>
        <p className="muted max-w-xl">
          Register with your enrolment details, practice areas and languages. Once an administrator
          verifies your profile, it appears in the public directory on the Legal Advisor platform.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href="/register" className="btn btn-primary">
            Register as an advocate
          </Link>
          <Link href="/login" className="btn btn-secondary">
            Log in
          </Link>
        </div>
      </main>
    );
  }

  const status = STATUS[profile.verification_status] ?? {
    label: profile.verification_status,
    className: 'badge',
    next: '',
  };
  const missing = [
    !profile.practice_areas?.length && 'practice areas',
    !profile.languages?.length && 'languages',
    !profile.bio && 'a short bio',
    !profile.consultation_fee && 'consultation fee',
  ].filter(Boolean) as string[];

  return (
    <main className="page page-narrow">
      <span className="eyebrow">Dashboard</span>
      <h1 className="display mt-1 text-2xl sm:text-3xl">
        Welcome, {user.display_name || user.email}
      </h1>

      <section className="surface mt-6 p-5" aria-labelledby="listing-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="listing-heading" className="font-semibold">
            Directory listing
          </h2>
          <span className={status.className}>
            <span className="dot" aria-hidden="true" />
            {status.label}
          </span>
        </div>
        <p className="muted mt-2 text-sm">{status.next}</p>
        {missing.length > 0 ? (
          <p className="alert alert-warn mt-4 block text-sm">
            Your profile is missing {missing.join(', ')}. Complete profiles are easier for clients
            to evaluate.{' '}
            <Link href="/profile" className="link">
              Edit profile
            </Link>
          </p>
        ) : (
          <Link href="/profile" className="btn btn-secondary btn-sm mt-4">
            View profile
          </Link>
        )}
      </section>

      <section className="surface mt-6 p-5" aria-labelledby="requests-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="requests-heading" className="font-semibold">
            Consultation requests
          </h2>
          <Link href="/consultations" className="btn btn-secondary btn-sm">
            View all
          </Link>
        </div>
        {counts === null ? (
          <p className="muted mt-3 text-sm">Loading…</p>
        ) : (
          <dl className="mt-4 grid grid-cols-3 gap-3 text-center">
            <div className="surface-flat p-3">
              <dt className="subtle text-xs">Awaiting response</dt>
              <dd className="mt-1 text-xl font-semibold">{counts.pending}</dd>
            </div>
            <div className="surface-flat p-3">
              <dt className="subtle text-xs">Scheduled</dt>
              <dd className="mt-1 text-xl font-semibold">{counts.upcoming}</dd>
            </div>
            <div className="surface-flat p-3">
              <dt className="subtle text-xs">Completed, awaiting close</dt>
              <dd className="mt-1 text-xl font-semibold">{counts.completed}</dd>
            </div>
          </dl>
        )}
        <p className="subtle mt-3 text-xs">
          Earnings aren&apos;t shown yet — payments aren&apos;t wired up (roadmap Phase 10), so a
          figure here would be fake.
        </p>
      </section>

      <section className="mt-8" aria-labelledby="planned-heading">
        <h2 id="planned-heading" className="subtle text-xs font-semibold uppercase tracking-wider">
          Not available yet
        </h2>
        <p className="muted mt-2 text-sm">
          These portal features are planned but not built. They&apos;ll appear here when
          consultation booking launches.
        </p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {PLANNED.map((s) => (
            <li key={s} className="badge">
              {s}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
