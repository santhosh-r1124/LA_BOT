'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Checklist } from '@/components/checklist';
import { ChipGroup, Field, FormMessage } from '@/components/form';
import {
  AlertIcon,
  CheckIcon,
  ExternalLinkIcon,
  InfoIcon,
  MapPinIcon,
  ShieldIcon,
} from '@/components/icons';
import { LogOutIcon } from '@/components/portal-icons';
import { PageSkeleton, SessionErrorPanel, SignedOutNotice } from '@/components/session-error';
import { CheckStatusButton, StatusBadge, VerificationPanel } from '@/components/status';
import { useAuth } from '@/lib/auth-context';
import { authClient } from '@/lib/auth-client';
import {
  LIMITS,
  PROFILE_FIELDS,
  describeApiError,
  mapServerError,
  profileChanged,
  profileToValues,
  toProfilePayload,
  type FormValues,
  type ProfileField,
} from '@/lib/forms';
import { DIRECTORY_URL } from '@/lib/links';
import {
  initialsOf,
  languageOptions,
  practiceAreaOptions,
  stateName,
  stateOptions,
} from '@/lib/options';
import { useFormErrors } from '@/lib/use-form-errors';
import styles from './profile.module.css';

/** Element ids. The checklist on the home page links to these as `#id`. */
const IDS: Record<ProfileField, string> = {
  stateCode: 'location',
  city: 'city',
  practiceAreas: 'practice',
  languages: 'languages',
  fee: 'fee',
  experience: 'experience',
  bio: 'bio',
};

const LABELS: Record<ProfileField, string> = {
  stateCode: 'State',
  city: 'City',
  practiceAreas: 'Practice areas',
  languages: 'Languages',
  fee: 'Consultation fee',
  experience: 'Years of experience',
  bio: 'Short bio',
};

export default function ProfilePage() {
  const router = useRouter();
  const { user, profile, loading, sessionIssue } = useAuth();

  // A visitor who arrives signed out belongs on the login page. Someone whose
  // session ends while the page is open gets a notice instead, so logging out
  // from the menu can take them home without a redirect fighting it.
  const hadUser = useRef(false);
  if (user) hadUser.current = true;
  useEffect(() => {
    if (!loading && !user && sessionIssue === null && !hadUser.current) router.replace('/login');
  }, [loading, user, sessionIssue, router]);

  if (!loading && !user && sessionIssue === 'network') return <SessionErrorPanel />;
  if (!loading && !user && hadUser.current) return <SignedOutNotice />;
  if (loading || !user || !profile) return <PageSkeleton />;
  return <ProfileView />;
}

function ProfileView() {
  const router = useRouter();
  const { user, profile, logout, refresh } = useAuth();
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

  async function signOut() {
    await logout();
    router.push('/');
  }

  const initials = initialsOf(user.display_name, user.email);

  return (
    <main className="page">
      <header className={styles.head}>
        <div className={styles.headMain}>
          <span className="avatar avatar-xl" aria-hidden="true">
            {initials}
          </span>
          <div className={styles.headText}>
            <p className="eyebrow">Your profile</p>
            <h1 className={`display ${styles.name}`}>{user.display_name || user.email}</h1>
            <ul className={styles.meta}>
              <li>
                <MapPinIcon />
                {profile.city}, {stateName(profile.state_code)}
              </li>
              <li>
                <StatusBadge status={profile.verification_status} />
              </li>
            </ul>
          </div>
        </div>
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
            <AlertIcon className="mt-px size-3.5 shrink-0" />
            {checkError}
          </p>
        )}
      </div>

      <div className={styles.grid}>
        <div className={styles.areaChecklist}>
          <Checklist profile={profile} />
        </div>
        <div className={styles.areaForm}>
          <ProfileForm />
        </div>
        <div className={styles.areaAccount}>
          <AccountCard onSignOut={() => void signOut()} />
        </div>
      </div>
    </main>
  );
}

// ---- The editable form ----------------------------------------------------------------

function ProfileForm() {
  const { profile, updateProfile } = useAuth();
  const baseline = useMemo(() => (profile ? profileToValues(profile) : null), [profile]);
  const [values, setValues] = useState<FormValues>(() => baseline as FormValues);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const formErrorRef = useRef<HTMLDivElement>(null);
  const savedRef = useRef<HTMLDivElement>(null);
  const errors = useFormErrors(PROFILE_FIELDS, values);
  const { errorFor, touch, clearServer, submit, setServer } = errors;

  const changed = baseline ? profileChanged(values, baseline) : false;
  const changedRef = useRef(changed);
  changedRef.current = changed;

  // Take in changes from the server (a refresh) unless there are unsaved edits.
  const baselineKey = JSON.stringify(baseline);
  const lastKey = useRef(baselineKey);
  useEffect(() => {
    if (lastKey.current === baselineKey) return;
    lastKey.current = baselineKey;
    if (baseline && !changedRef.current) setValues(baseline);
  }, [baselineKey, baseline]);

  // Warn before leaving the page with unsaved edits.
  useEffect(() => {
    if (!changed) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [changed]);

  // Opening /profile#practice (from the checklist) lands on that field.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return;
    const el = document.getElementById(id);
    el?.scrollIntoView({ block: 'center' });
    el?.focus({ preventScroll: true });
  }, []);

  if (!profile || !baseline) return null;

  const practiceOptions = practiceAreaOptions(baseline.practiceAreas);
  const languageOpts = languageOptions(baseline.languages);
  const stateOpts = stateOptions(baseline.stateCode);

  function set<K extends ProfileField>(key: K, value: FormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    clearServer(key);
    setSavedAt(null);
    setFormError(null);
  }

  function discard() {
    if (!baseline) return;
    setValues(baseline);
    setServer({});
    setShowSummary(false);
    setFormError(null);
  }

  const problems = PROFILE_FIELDS.filter((f) => errorFor(f) !== undefined);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    setSavedAt(null);
    const found = submit();
    if (PROFILE_FIELDS.some((f) => found[f])) {
      setShowSummary(true);
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    setShowSummary(false);
    setSaving(true);
    try {
      const next = await updateProfile(toProfilePayload(values));
      setValues(profileToValues(next));
      setSavedAt(new Date());
      requestAnimationFrame(() => savedRef.current?.focus());
    } catch (err) {
      const mapped = mapServerError(err, PROFILE_FIELDS, 'Your changes were not saved. Try again.');
      setServer(mapped.fields);
      setFormError(mapped.form);
      const hasFields = PROFILE_FIELDS.some((f) => mapped.fields[f]);
      setShowSummary(hasFields);
      requestAnimationFrame(() => {
        if (hasFields) summaryRef.current?.focus();
        else formErrorRef.current?.focus();
      });
    } finally {
      setSaving(false);
    }
  }

  const listed = profile.verification_status === 'VERIFIED';

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className={`surface ${styles.form}`}
      aria-label="Edit your profile"
      aria-busy={saving || undefined}
    >
      <div className={styles.formHead}>
        <h2 className={styles.formTitle}>Edit your details</h2>
        <p className={styles.formLede}>
          {listed
            ? 'Changes you save are shown in the public directory.'
            : 'Changes are saved to your profile. They are not in the public directory until it is verified.'}
        </p>
      </div>

      <div className={styles.messages} aria-live="polite">
        {savedAt && (
          <FormMessage tone="ok" title="Profile saved" messageRef={savedRef} live="off">
            <p>
              Saved at {savedAt.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}
              .{' '}
              {listed
                ? 'The directory now shows these details.'
                : 'Verification has not changed: an administrator still has to review the profile.'}
            </p>
          </FormMessage>
        )}
        {showSummary && problems.length > 0 && (
          <FormMessage
            tone="danger"
            title={`Fix ${problems.length} ${problems.length === 1 ? 'field' : 'fields'} before saving`}
            messageRef={summaryRef}
            live="off"
          >
            <ul className={styles.problems}>
              {problems.map((f) => (
                <li key={f}>
                  <a
                    href={`#${IDS[f]}`}
                    onClick={(e) => {
                      e.preventDefault();
                      document.getElementById(IDS[f])?.focus();
                    }}
                  >
                    {LABELS[f]}
                  </a>
                  : {errorFor(f)}
                </li>
              ))}
            </ul>
          </FormMessage>
        )}
        {formError && (
          <FormMessage tone="danger" title="Your changes were not saved" messageRef={formErrorRef}>
            <p>{formError}</p>
          </FormMessage>
        )}
      </div>

      <section className={styles.section} aria-labelledby="where-title">
        <h3 id="where-title" className={styles.sectionTitle}>
          Where you practise
        </h3>
        <div className={styles.twoCol}>
          <Field id={IDS.stateCode} label="State or union territory" error={errorFor('stateCode')}>
            {(c) => (
              <select
                {...c}
                value={values.stateCode}
                onChange={(e) => set('stateCode', e.target.value)}
                onBlur={() => touch('stateCode')}
                className="input select"
              >
                <option value="">Choose one</option>
                {stateOpts.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field id={IDS.city} label="City" error={errorFor('city')}>
            {(c) => (
              <input
                {...c}
                type="text"
                autoComplete="address-level2"
                value={values.city}
                onChange={(e) => set('city', e.target.value)}
                onBlur={() => touch('city')}
                className="input"
              />
            )}
          </Field>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="practice-title">
        <h3 id="practice-title" className={styles.sectionTitle}>
          Practice areas
        </h3>
        <p className={styles.sectionLede}>People search the directory by legal topic.</p>
        <ChipGroup
          id={IDS.practiceAreas}
          legend="Choose all that apply"
          describe="practice areas"
          options={practiceOptions}
          value={values.practiceAreas}
          onChange={(next) => set('practiceAreas', next)}
          error={errorFor('practiceAreas')}
        />
      </section>

      <section className={styles.section} aria-labelledby="languages-title">
        <h3 id="languages-title" className={styles.sectionTitle}>
          Languages
        </h3>
        <p className={styles.sectionLede}>The languages you can advise in.</p>
        <ChipGroup
          id={IDS.languages}
          legend="Choose all that apply"
          describe="languages"
          options={languageOpts}
          value={values.languages}
          onChange={(next) => set('languages', next)}
          error={errorFor('languages')}
        />
      </section>

      <section className={styles.section} aria-labelledby="exp-title">
        <h3 id="exp-title" className={styles.sectionTitle}>
          Experience and fee
        </h3>
        <div className={styles.twoCol}>
          <Field
            id={IDS.experience}
            label="Years of experience"
            optional
            error={errorFor('experience')}
          >
            {(c) => (
              <input
                {...c}
                type="text"
                inputMode="numeric"
                maxLength={2}
                value={values.experience}
                onChange={(e) => set('experience', e.target.value)}
                onBlur={() => touch('experience')}
                className="input"
              />
            )}
          </Field>
          <Field
            id={IDS.fee}
            label="Consultation fee"
            optional
            error={errorFor('fee')}
            hint="In rupees, for a first consultation."
          >
            {(c) => (
              <span className={styles.prefixWrap}>
                <span className={styles.prefix} aria-hidden="true">
                  ₹
                </span>
                <input
                  {...c}
                  type="text"
                  inputMode="decimal"
                  value={values.fee}
                  onChange={(e) => set('fee', e.target.value)}
                  onBlur={() => touch('fee')}
                  className={`input ${styles.prefixInput}`}
                />
              </span>
            )}
          </Field>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="about-title">
        <h3 id="about-title" className={styles.sectionTitle}>
          About you
        </h3>
        <Field
          id={IDS.bio}
          label="Short bio"
          optional
          error={errorFor('bio')}
          hint={
            <span className={values.bio.length > LIMITS.bioMax ? styles.countOver : styles.count}>
              {values.bio.length} of {LIMITS.bioMax} characters
            </span>
          }
        >
          {(c) => (
            <textarea
              {...c}
              rows={5}
              value={values.bio}
              onChange={(e) => set('bio', e.target.value)}
              onBlur={() => touch('bio')}
              className="input textarea"
            />
          )}
        </Field>
      </section>

      <div className={styles.saveBar} data-sticky={changed || saving || undefined}>
        <p
          className={`${styles.saveState} ${changed ? styles.saveDirty : savedAt ? styles.saveOk : ''}`}
          role="status"
        >
          {changed ? (
            <>
              <AlertIcon />
              You have unsaved changes
            </>
          ) : savedAt ? (
            <>
              <CheckIcon />
              All changes saved
            </>
          ) : (
            <>
              <InfoIcon />
              No changes yet
            </>
          )}
        </p>
        <div className={styles.saveActions}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={discard}
            disabled={!changed || saving}
          >
            Discard changes
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            aria-busy={saving || undefined}
            disabled={!changed || saving}
          >
            {saving ? 'Saving' : 'Save changes'}
          </button>
        </div>
      </div>
    </form>
  );
}

// ---- Account card -----------------------------------------------------------------------------

function AccountCard({ onSignOut }: { onSignOut: () => void }) {
  const { user } = useAuth();
  const [resend, setResend] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [resendError, setResendError] = useState<string | null>(null);

  if (!user) return null;
  const email = user.email;

  async function resendVerification() {
    setResend('sending');
    setResendError(null);
    try {
      await authClient.resendVerification(email);
      setResend('sent');
    } catch (err) {
      setResendError(describeApiError(err, 'Could not request a new link.'));
      setResend('error');
    }
  }

  return (
    <section className={`surface-flat ${styles.account}`} aria-labelledby="account-heading">
      <h2 id="account-heading" className="title title-lg">
        Account
      </h2>

      <div className={styles.accountRow}>
        <span className="caps">Email</span>
        <p className={styles.accountEmail}>{email}</p>
        <p className={styles.accountNote}>Shown on your public profile once you are verified.</p>
      </div>

      <div className={styles.accountRow}>
        <span className="caps">Email address check</span>
        {user.email_verified ? (
          <span className="badge badge-ok self-start">
            <CheckIcon />
            Email verified
          </span>
        ) : (
          <>
            <span className="badge badge-warn self-start">
              <AlertIcon />
              Email not verified
            </span>
            <p className={styles.accountNote}>
              Confirming your address is separate from the profile review. No email is sent in this
              setup: the link is written to the API log.
            </p>
            <div>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => void resendVerification()}
                disabled={resend === 'sending' || resend === 'sent'}
                aria-busy={resend === 'sending' || undefined}
              >
                {resend === 'sending'
                  ? 'Requesting'
                  : resend === 'sent'
                    ? 'Link requested'
                    : 'Request a new link'}
              </button>
            </div>
            {resend === 'sent' && (
              <p className="field-error !text-ok" role="status">
                <CheckIcon className="mt-px size-3.5 shrink-0" />A new link was requested.
              </p>
            )}
            {resend === 'error' && resendError && (
              <p className="field-error" role="alert">
                <AlertIcon className="mt-px size-3.5 shrink-0" />
                {resendError}
              </p>
            )}
          </>
        )}
      </div>

      <div className={styles.accountActions}>
        <a
          href={DIRECTORY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-secondary"
        >
          <ShieldIcon />
          Public directory
          <ExternalLinkIcon />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
        <button type="button" className="btn btn-secondary" onClick={onSignOut}>
          <LogOutIcon />
          Log out
        </button>
      </div>
    </section>
  );
}
