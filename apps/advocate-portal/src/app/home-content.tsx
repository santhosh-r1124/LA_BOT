'use client';

import Link from 'next/link';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { Checklist } from '@/components/checklist';
import {
  AdvocateIcon,
  ArrowRightIcon,
  BriefcaseIcon,
  ExternalLinkIcon,
  LanguageIcon,
  MapPinIcon,
  ShieldIcon,
  UsersIcon,
  type IconComponent,
} from '@/components/icons';
import { PlannedList } from '@/components/planned';
import { EditIcon } from '@/components/portal-icons';
import { SessionErrorPanel, PageSkeleton } from '@/components/session-error';
import { CheckStatusButton, VerificationPanel } from '@/components/status';
import { useAuth } from '@/lib/auth-context';
import { describeApiError } from '@/lib/forms';
import { DIRECTORY_URL } from '@/lib/links';
import { formatFee, languageName, listLabels, practiceAreaLabel, stateName } from '@/lib/options';
import styles from './home.module.css';

const STEPS: Array<{ title: string; text: string }> = [
  {
    title: 'Register',
    text: 'Give your name, state and city. Practice areas, languages, fee and experience can go in now or later, but a profile with them is easier to find.',
  },
  {
    title: 'An administrator reviews it',
    text: 'Each new profile is checked before it can be listed. Your status here reads Awaiting review, In review, Verified or Not approved, with a reviewer note if it is not approved.',
  },
  {
    title: 'You appear in the directory',
    text: 'Verified profiles can be found by state, practice area and language on the Legal Advisor site. Your account email is shown on your public profile as your contact address.',
  },
];

const AVAILABLE: Array<{ title: string; text: string; Icon: IconComponent }> = [
  {
    title: 'Directory profile',
    text: 'Your name, location, practice areas, languages, fee, experience and a short bio.',
    Icon: AdvocateIcon,
  },
  {
    title: 'Verification status',
    text: 'See where your review stands in plain words, and read the reviewer note if a profile is not approved.',
    Icon: ShieldIcon,
  },
  {
    title: 'Profile editing',
    text: 'Change any detail whenever you like. Once you are verified, the directory shows the change.',
    Icon: EditIcon,
  },
];

export function HomeContent() {
  const { user, profile, loading, sessionIssue } = useAuth();

  if (loading) return <PageSkeleton />;
  if (sessionIssue === 'network' && !user) return <SessionErrorPanel />;
  if (!user || !profile) return <Landing />;
  return <Dashboard />;
}

// ---- Signed out -------------------------------------------------------------

function Landing() {
  return (
    <main>
      <section className="hero-bg" aria-labelledby="hero-title">
        <span className="hero-sign lg:hidden" aria-hidden="true">
          §
        </span>
        <div className={`page ${styles.heroGrid}`}>
          <div className={`rise-in ${styles.heroText}`}>
            <p className="eyebrow eyebrow-rule max-sm:before:hidden">For advocates</p>
            <h1 id="hero-title" className="display display-lg">
              Be found by people who <em>need</em> an advocate.
            </h1>
            <p className="lede">
              Create a profile with your practice areas, languages and location. Once an
              administrator has verified it, people using the Legal Advisor directory can find you.
            </p>
            <div className="cluster">
              <Link href="/register" className="btn btn-primary btn-lg">
                Register as an advocate
                <ArrowRightIcon />
              </Link>
              <Link href="/login" className="btn btn-secondary btn-lg">
                Log in
              </Link>
            </div>
            <ul className={styles.facts}>
              <Fact Icon={ShieldIcon}>Every profile is checked before it is listed</Fact>
              <Fact Icon={UsersIcon}>Found by state, practice area and language</Fact>
            </ul>
          </div>

          <ListingIllustration />
        </div>
      </section>

      <div className="page pt-0">
        <section className="section-sm" aria-labelledby="flow-title">
          <div className="section-head">
            <div>
              <p className="eyebrow">How you get listed</p>
              <h2 id="flow-title" className="section-title mt-2">
                Three steps to a verified listing
              </h2>
            </div>
          </div>
          <ol className={styles.flow}>
            {STEPS.map((step, i) => (
              <li key={step.title} className={styles.flowStep}>
                <span className={styles.flowNum} aria-hidden="true">
                  {i + 1}
                </span>
                <h3 className="title title-lg">
                  <span className="sr-only">Step {i + 1}: </span>
                  {step.title}
                </h3>
                <p className="muted text-sm">{step.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className={`section ${styles.today}`} aria-labelledby="today-title">
          <div className={styles.todayAvailable}>
            <div className="section-head !mb-4">
              <div>
                <p className="eyebrow">What the portal does today</p>
                <h2 id="today-title" className="section-title mt-2">
                  Available now
                </h2>
              </div>
            </div>
            <ul className="list">
              {AVAILABLE.map(({ title, text, Icon }) => (
                <li key={title} className={styles.availableRow}>
                  <span className={styles.availableIcon} aria-hidden="true">
                    <Icon />
                  </span>
                  <span className="list-row-main">
                    <span className="list-row-title block">{title}</span>
                    <span className="muted block text-sm">{text}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <PlannedList />
        </section>

        <section className={`section ${styles.cta}`} aria-labelledby="cta-title">
          <div>
            <h2 id="cta-title" className="section-title">
              Ready to set up your profile?
            </h2>
            <p className="muted mt-1 max-w-[52ch] text-sm">
              This setup runs on this computer. Your profile is stored in its own database and is
              shown only in the Legal Advisor site running next to it.
            </p>
          </div>
          <div className="cluster">
            <Link href="/register" className="btn btn-primary">
              Register
              <ArrowRightIcon />
            </Link>
            <Link href="/login" className="btn btn-secondary">
              Log in
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}

function Fact({ Icon, children }: { Icon: IconComponent; children: ReactNode }) {
  return (
    <li className={styles.fact}>
      <Icon />
      <span>{children}</span>
    </li>
  );
}

/**
 * A directory listing drawn with bars: which details a listing shows. It uses
 * placeholder text only, because no real advocate belongs in an illustration.
 */
function ListingIllustration() {
  return (
    <figure className={`rise-in ${styles.listing}`} style={{ '--i': 2 } as CSSProperties}>
      <div className={styles.listingCard} aria-hidden="true">
        <div className={styles.listingTop}>
          <span className="avatar avatar-lg">§</span>
          <span className={styles.listingName}>
            <span className={styles.bar} style={{ width: '70%' }} />
            <span className={styles.listingMeta}>
              <MapPinIcon /> City, State
            </span>
          </span>
          <span className="badge badge-ok badge-sm">
            <span className="dot" />
            Verified
          </span>
        </div>
        <div className={styles.listingTags}>
          <span className="tag">Practice area</span>
          <span className="tag">Practice area</span>
          <span className="tag">Practice area</span>
        </div>
        <div className={styles.listingRows}>
          <span className={styles.listingRow}>
            <LanguageIcon /> Languages you speak
          </span>
          <span className={styles.listingRow}>
            <BriefcaseIcon /> Years of experience
          </span>
        </div>
        <div className={styles.listingLines}>
          <span className={styles.bar} style={{ width: '96%' }} />
          <span className={styles.bar} style={{ width: '82%' }} />
          <span className={styles.bar} style={{ width: '58%' }} />
        </div>
        <div className={styles.listingFoot}>
          <span>Consultation fee</span>
          <span className={styles.bar} style={{ width: '4.5rem' }} />
        </div>
      </div>
      <figcaption className={styles.listingCaption}>
        Illustration of how a listing is laid out. No real advocate is shown.
      </figcaption>
    </figure>
  );
}

// ---- Signed in --------------------------------------------------------------

function Dashboard() {
  const { user, profile, refresh } = useAuth();
  const [checking, setChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);

  if (!user || !profile) return null;

  async function check() {
    setChecking(true);
    setCheckError(null);
    try {
      await refresh();
      setCheckedAt(new Date());
    } catch (err) {
      setCheckError(describeApiError(err, 'Could not check your status.'));
    } finally {
      setChecking(false);
    }
  }

  const fee = formatFee(profile.consultation_fee);

  return (
    <main className="page">
      <header className={styles.welcome}>
        <p className="eyebrow">Advocate dashboard</p>
        <h1 className="display display-md mt-1">Welcome, {user.display_name || user.email}</h1>
        <p className="muted mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="inline-flex items-center gap-1.5">
            <MapPinIcon className="size-4" />
            {profile.city}, {stateName(profile.state_code)}
          </span>
          <span className="break-all">{user.email}</span>
        </p>
      </header>

      <div className="mt-6 flex flex-col gap-3">
        <VerificationPanel
          status={profile.verification_status}
          note={profile.verification_note}
          actions={
            <CheckStatusButton onClick={() => void check()} busy={checking} checkedAt={checkedAt} />
          }
        />
        {checkError && (
          <p className="field-error" role="alert">
            {checkError}
          </p>
        )}
      </div>

      <div className={`section-sm ${styles.dashGrid}`}>
        <Checklist profile={profile} />

        <section className={`surface-flat ${styles.summary}`} aria-labelledby="listing-heading">
          <div className={styles.summaryHead}>
            <h2 id="listing-heading" className="title title-lg">
              Your listing
            </h2>
            <Link href="/profile" className="btn btn-secondary">
              <EditIcon />
              Edit profile
            </Link>
          </div>
          <dl className="dl">
            <dt>Location</dt>
            <dd>
              {profile.city}, {stateName(profile.state_code)}
            </dd>
            <dt>Practice areas</dt>
            <dd>
              {profile.practice_areas.length > 0 ? (
                <span className={styles.tags}>
                  {profile.practice_areas.map((c) => (
                    <span key={c} className="badge badge-sm">
                      {practiceAreaLabel(c)}
                    </span>
                  ))}
                </span>
              ) : (
                <span className="subtle">Not added yet</span>
              )}
            </dd>
            <dt>Languages</dt>
            <dd>
              {profile.languages.length > 0 ? (
                listLabels(profile.languages, languageName)
              ) : (
                <span className="subtle">Not added yet</span>
              )}
            </dd>
            <dt>Experience</dt>
            <dd>
              {profile.experience_years !== null ? (
                `${profile.experience_years} ${profile.experience_years === 1 ? 'year' : 'years'}`
              ) : (
                <span className="subtle">Not added yet</span>
              )}
            </dd>
            <dt>Consultation fee</dt>
            <dd>{fee ?? <span className="subtle">Not added yet</span>}</dd>
          </dl>
          {profile.verification_status === 'VERIFIED' ? (
            <a
              href={DIRECTORY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.directoryLink}
            >
              Find your listing in the public directory
              <ExternalLinkIcon />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : (
            <p className="subtle text-sm">
              Not in the public directory yet: the profile has not been verified.
            </p>
          )}
        </section>
      </div>

      <div className="section-sm">
        <PlannedList compact />
      </div>
    </main>
  );
}
