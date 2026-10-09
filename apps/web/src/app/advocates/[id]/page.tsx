'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import { LanguageIcon, MapPinIcon, PhoneIcon, UsersIcon } from '@/components/icons';
import { EmptyState, ErrorState, Notice } from '@/components/ui';
import { ApiRequestError } from '@/lib/api-client';
import { advocateClient, type AdvocateDirectoryEntry } from '@/lib/advocate-client';
import {
  SAMPLE_LISTING_LABEL,
  fieldsOfPractice,
  formatInr,
  formatPhone,
  initials,
  languageName,
  phoneHref,
  practiceAreaLabel,
  stateName,
} from '@/lib/format';
import { CopyButton } from '../_components/copy-button';
import { directoryHref } from '../_components/directory-memory';
import { ArrowLeftIcon } from '../_components/local-icons';
import { otherAdvocates } from '../_components/similar';
import styles from '../profile.module.css';

const SIMILAR_COUNT = 3;
/** Fetched per search, so that hiding repeats still leaves enough to show. */
const SIMILAR_FETCH = 12;

function BackLink({ href }: { href: string }) {
  return (
    <Link href={href} className="btn btn-ghost -ml-2 mb-3">
      <ArrowLeftIcon />
      Back to directory
    </Link>
  );
}

function ProfileSkeleton() {
  return (
    <div role="status">
      <span className="sr-only">Loading advocate profile</span>
      <div className={`surface ${styles.hero}`} aria-hidden="true">
        <div className={`skeleton skeleton-circle ${styles.heroAvatar}`} />
        <div className="flex flex-1 flex-col gap-3">
          <div className="skeleton h-3 w-24" />
          <div className="skeleton h-8 w-2/3" />
          <div className="skeleton h-4 w-1/2" />
        </div>
      </div>
      <div className={styles.grid} aria-hidden="true">
        <div className={styles.main}>
          <div className="skeleton h-24" />
          <div className="skeleton h-36" />
        </div>
        <div className={styles.aside}>
          <div className="skeleton h-48" />
        </div>
      </div>
    </div>
  );
}

export default function AdvocateProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [advocate, setAdvocate] = useState<AdvocateDirectoryEntry | null>(null);
  const [similar, setSimilar] = useState<AdvocateDirectoryEntry[]>([]);
  const [error, setError] = useState<{ message: string; retryable: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const [backHref, setBackHref] = useState('/advocates');

  const retry = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => setBackHref(directoryHref()), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSimilar([]);
    advocateClient
      .get(id)
      .then((res) => {
        if (!cancelled) setAdvocate(res);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // An id that is not a valid uuid is rejected with 400/422: same as "not listed".
        const notFound = err instanceof ApiRequestError && [400, 404, 422].includes(err.status);
        setAdvocate(null);
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

  // The browser tab names the advocate once the profile is known.
  const displayName = advocate?.display_name || (advocate ? 'Advocate' : null);
  useEffect(() => {
    if (!displayName) return;
    const previous = document.title;
    document.title = `${displayName} · Legal Advisor`;
    return () => {
      document.title = previous;
    };
  }, [displayName]);

  // Other advocates in the same state with the same first field of practice, from the
  // public search endpoint. Failing here just hides the section.
  const area = advocate ? fieldsOfPractice(advocate.practice_areas)[0] : undefined;
  const state = advocate?.state_code;
  useEffect(() => {
    if (!advocate || !state) return;
    let cancelled = false;
    advocateClient
      .search({ state, practice_area: area, page_size: SIMILAR_FETCH })
      .then((res) => {
        if (cancelled) return;
        setSimilar(otherAdvocates(res.items, advocate).slice(0, SIMILAR_COUNT));
      })
      .catch(() => {
        if (!cancelled) setSimilar([]);
      });
    return () => {
      cancelled = true;
    };
  }, [advocate, area, state]);

  const areas = advocate ? fieldsOfPractice(advocate.practice_areas) : [];
  const fee = advocate ? formatInr(advocate.consultation_fee) : null;
  const phone = advocate?.phone ? formatPhone(advocate.phone) : null;
  const location = advocate ? `${advocate.city}, ${stateName(advocate.state_code)}` : '';

  const notFound = !loading && error !== null && !error.retryable;

  return (
    <main className="page">
      {/* The not-found card has its own button back, so only one is shown there. */}
      {!notFound && <BackLink href={backHref} />}

      {loading ? (
        <ProfileSkeleton />
      ) : error || !advocate ? (
        notFound ? (
          <EmptyState
            icon={UsersIcon}
            title="Advocate not found"
            action={
              <Link href={backHref} className="btn btn-secondary">
                Back to directory
              </Link>
            }
          >
            {error?.message}
          </EmptyState>
        ) : (
          <ErrorState
            title="Profile unavailable"
            message={error?.message ?? 'Advocate not found.'}
            onRetry={retry}
          />
        )
      ) : (
        <article>
          <header className={`surface ${styles.hero}`}>
            <span className={`avatar ${styles.heroAvatar}`} aria-hidden="true">
              {initials(advocate.display_name)}
            </span>
            <div className={styles.heroBody}>
              <div className="cluster">
                <span className="eyebrow">Advocate profile</span>
                {advocate.is_sample ? (
                  <span className="badge badge-warn badge-sm">
                    <span className="dot" aria-hidden="true" />
                    {SAMPLE_LISTING_LABEL}
                  </span>
                ) : (
                  <span className="badge badge-ok badge-sm">
                    <span className="dot" aria-hidden="true" />
                    Verified listing
                  </span>
                )}
              </div>
              <h1 className={`display display-sm ${styles.heroName}`}>
                {advocate.display_name || 'Advocate'}
              </h1>
              <div className={styles.heroMeta}>
                <span className={styles.heroMetaItem}>
                  <MapPinIcon />
                  {location}
                </span>
                {advocate.languages.length > 0 && (
                  <span className={styles.heroMetaItem}>
                    <LanguageIcon />
                    {advocate.languages.map(languageName).join(', ')}
                  </span>
                )}
              </div>
            </div>
          </header>

          {advocate.is_sample && (
            <Notice tone="warn" title="Not a verified advocate" className="mt-4">
              <p className="muted">
                This is a sample listing: the name, location and contact details were made up to
                show how the directory works. No real person is behind it, so do not contact them or
                rely on them for legal help. Real advocates appear here once an administrator
                imports or verifies them.
              </p>
            </Notice>
          )}

          {/* A verified advocate's contact card sits right under the header on narrow screens. */}
          <div className={styles.grid} data-contact-first={!advocate.is_sample}>
            <div className={styles.main}>
              {areas.length > 0 && (
                <section aria-labelledby="areas-heading">
                  <div className={styles.sectionHead}>
                    <h2 id="areas-heading" className="caps">
                      Practice areas
                    </h2>
                  </div>
                  <ul className={styles.areas}>
                    {areas.map((a) => (
                      <li key={a} className="badge badge-accent">
                        {practiceAreaLabel(a)}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section aria-labelledby="details-heading">
                <div className={styles.sectionHead}>
                  <h2 id="details-heading" className="caps">
                    Details
                  </h2>
                </div>
                <div className={styles.facts}>
                  <dl className="dl">
                    <dt>Location</dt>
                    <dd>
                      {location} ({advocate.state_code})
                    </dd>
                    {advocate.languages.length > 0 && (
                      <>
                        <dt>Languages</dt>
                        <dd>{advocate.languages.map(languageName).join(', ')}</dd>
                      </>
                    )}
                    {advocate.experience_years != null && (
                      <>
                        <dt>Experience</dt>
                        <dd>
                          {advocate.experience_years}{' '}
                          {advocate.experience_years === 1 ? 'year' : 'years'}
                        </dd>
                      </>
                    )}
                    {fee && (
                      <>
                        <dt>Consultation fee</dt>
                        <dd>{fee}, as set by the advocate</dd>
                      </>
                    )}
                    <dt>Listing</dt>
                    <dd>
                      {advocate.is_sample
                        ? 'Sample listing with synthetic data'
                        : 'Verified listing, added by an administrator'}
                    </dd>
                  </dl>
                </div>
              </section>

              {advocate.bio && (
                <section aria-labelledby="about-heading">
                  <div className={styles.sectionHead}>
                    <h2 id="about-heading" className="caps">
                      About
                    </h2>
                  </div>
                  <p className={styles.bio}>{advocate.bio}</p>
                </section>
              )}
            </div>

            <aside className={styles.aside} aria-labelledby="contact-heading">
              <section className={`surface ${styles.contact}`}>
                <div>
                  <h2 id="contact-heading" className="title">
                    {advocate.is_sample ? 'Sample contact details' : 'Contact details'}
                  </h2>
                  {advocate.is_sample && (
                    <p className="hint mt-1">Made up for this sample. They do not reach anyone.</p>
                  )}
                </div>

                {!advocate.email && !phone && (
                  <p className="muted text-sm">No contact details are listed for this advocate.</p>
                )}

                {advocate.email && (
                  <div className={styles.contactRow}>
                    <div className={styles.contactHead}>
                      <span className={styles.contactLabel}>Email</span>
                      <CopyButton text={advocate.email} what="email address" />
                    </div>
                    <span className={styles.contactValue}>{advocate.email}</span>
                  </div>
                )}

                {phone && advocate.phone && (
                  <div className={styles.contactRow}>
                    <div className={styles.contactHead}>
                      <span className={styles.contactLabel}>Phone</span>
                      <CopyButton text={phone} what="phone number" />
                    </div>
                    <span className={`${styles.contactValue} tabular`}>{phone}</span>
                  </div>
                )}

                {!advocate.is_sample && (advocate.phone || advocate.email) && (
                  <div className="btn-group">
                    {advocate.phone && (
                      <a href={phoneHref(advocate.phone)} className="btn btn-primary btn-sm">
                        <PhoneIcon />
                        Call
                      </a>
                    )}
                    {advocate.email && (
                      <a href={`mailto:${advocate.email}`} className="btn btn-secondary btn-sm">
                        Send an email
                      </a>
                    )}
                  </div>
                )}

                {!advocate.is_sample && (
                  <p className="note">
                    Online booking isn&apos;t available yet. Contact the advocate directly to
                    arrange a consultation.
                  </p>
                )}
              </section>
            </aside>
          </div>

          {similar.length > 0 && (
            <section className={styles.similar} aria-labelledby="similar-heading">
              <div className="section-head !mb-4">
                <div>
                  <h2 id="similar-heading" className="section-title">
                    More advocates in {stateName(advocate.state_code)}
                  </h2>
                  <p className="section-lede">
                    {area
                      ? `Also listed under ${practiceAreaLabel(area)}.`
                      : `Other advocates listed in ${stateName(advocate.state_code)}.`}
                  </p>
                </div>
                <Link
                  href={`/advocates?state=${encodeURIComponent(advocate.state_code)}${
                    area ? `&practice_area=${encodeURIComponent(area)}` : ''
                  }`}
                  className={`link text-sm font-medium ${styles.seeAll}`}
                >
                  See all
                </Link>
              </div>
              <ul className={styles.similarGrid}>
                {similar.map((a) => (
                  <li key={a.id} className={styles.similarItem}>
                    <span className="avatar avatar-sm" aria-hidden="true">
                      {initials(a.display_name)}
                    </span>
                    <div className="min-w-0">
                      <Link href={`/advocates/${a.id}`} className={styles.similarName}>
                        {a.display_name || 'Advocate'}
                      </Link>
                      <p className={styles.similarMeta}>
                        {a.city}
                        {a.is_sample && <span className="subtle"> · Sample listing</span>}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </article>
      )}
    </main>
  );
}
