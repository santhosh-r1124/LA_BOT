'use client';

import type { AuthUser } from '@legal-platform/auth';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  compactErrors,
  Field,
  FormAlert,
  inputClass,
  PendingLine,
  SubmitButton,
  useErrorFocus,
  useFormFields,
} from '@/components/form';
import {
  AdvocateIcon,
  AlertIcon,
  ArrowRightIcon,
  ChatIcon,
  CheckIcon,
  DocumentIcon,
  ExternalLinkIcon,
  InfoIcon,
  LockIcon,
  ShieldIcon,
  UsersIcon,
} from '@/components/icons';
import { authClient } from '@/lib/auth-client';
import { useAuth } from '@/lib/auth-context';
import { initialsOf } from '@/lib/shell-helpers';
import { LogOutIcon } from '../login/_shared/auth-icons';
import {
  asUpdatePayload,
  authHref,
  buildProfilePatch,
  errorTitle,
  isProfileDirty,
  mapAuthError,
  problemMessage,
  profileValuesOf,
  roleLabel,
  validateDisplayName,
  type MappedAuthError,
} from '../login/_shared/auth-logic';
import { AuthShell } from '../login/_shared/auth-shell';
import { languageOptions, stateOptions } from '../login/_shared/options';
import styles from './profile.module.css';

/** The advocate portal is a second app on this computer. */
const ADVOCATE_PORTAL_URL = 'http://localhost:3001';

export function ProfileClient() {
  const router = useRouter();
  const { user, loading, logout } = useAuth();
  // Set when the person chose to log out, so the "not signed in" redirect below
  // does not race the push to the home page.
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!loading && !user && !leaving) router.replace(authHref('/login', '/profile'));
  }, [loading, user, leaving, router]);

  async function onLogout() {
    setLeaving(true);
    await logout();
    router.push('/');
  }

  if (loading) return <ProfileSkeleton />;

  if (!user) {
    return (
      <AuthShell
        status={{ tone: 'info', icon: <LockIcon /> }}
        title="Log in to see your profile"
        lede="Your profile is part of your account, so it needs you to be signed in."
        busy
      >
        <PendingLine>Taking you to the log in page…</PendingLine>
        <Link href={authHref('/login', '/profile')} className="btn btn-primary btn-lg btn-block">
          Log in
        </Link>
      </AuthShell>
    );
  }

  return <ProfileView user={user} leaving={leaving} onLogout={() => void onLogout()} />;
}

// ---------------------------------------------------------------------------
// Signed in
// ---------------------------------------------------------------------------

function ProfileView({
  user,
  leaving,
  onLogout,
}: {
  user: AuthUser;
  leaving: boolean;
  onLogout: () => void;
}) {
  const hasName = Boolean(user.display_name?.trim());
  const isAdvocate = user.role === 'ADVOCATE';

  return (
    <main className="page">
      <header className={styles.header}>
        <div className={styles.identity}>
          <span className={`avatar avatar-xl ${styles.avatar}`} aria-hidden="true">
            {initialsOf(user.display_name, user.email)}
          </span>
          <div className={styles.who}>
            <p className="eyebrow">Your account</p>
            <h1 className={`display ${styles.name}`}>
              {hasName ? user.display_name?.trim() : 'Your profile'}
            </h1>
            <p className={styles.email}>{user.email}</p>
            <div className={styles.badges}>
              <span className="badge badge-accent">
                <ShieldIcon />
                {roleLabel(user.role)}
              </span>
              {user.email_verified ? (
                <span className="badge badge-ok">
                  <CheckIcon />
                  Email verified
                </span>
              ) : (
                <span className="badge badge-warn">
                  <AlertIcon />
                  Email not verified
                </span>
              )}
            </div>
          </div>
        </div>
        <button
          type="button"
          className={`btn btn-secondary ${styles.logout}`}
          onClick={onLogout}
          aria-busy={leaving ? true : undefined}
        >
          <LogOutIcon />
          {leaving ? 'Logging out…' : 'Log out'}
        </button>
      </header>

      <div className={styles.cols}>
        <div className="flex min-w-0 flex-col gap-6">
          {!user.email_verified && <VerifyEmailNotice email={user.email} />}
          <DetailsPanel user={user} />
        </div>

        <aside className={styles.side} aria-label="Shortcuts">
          <section>
            <h2 className={`caps subtle ${styles.sideTitle}`}>Pick up where you left off</h2>
            <ul className={styles.links}>
              <ShortcutRow
                href="/chat"
                icon={<ChatIcon />}
                title="Chat history"
                meta="Your past conversations are listed beside the chat."
              />
              <ShortcutRow
                href="/documents"
                icon={<DocumentIcon />}
                title="Documents"
                meta="Draft a template agreement, notice or affidavit."
              />
              <ShortcutRow
                href="/advocates"
                icon={<UsersIcon />}
                title="Advocate directory"
                meta="Browse sample listings by state and practice area."
              />
            </ul>
          </section>

          {isAdvocate ? (
            <section className="card card-accent card-roomy">
              <div className={styles.portal}>
                <h2 className={`title ${styles.portalTitle}`}>
                  <AdvocateIcon />
                  Your advocate portal
                </h2>
                <p className={styles.portalText}>
                  Your listing, practice areas and verification are managed in the advocate portal,
                  a separate app that runs on this computer. Log in there with the same email and
                  password.
                </p>
                <a
                  href={ADVOCATE_PORTAL_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-primary btn-block"
                >
                  Open the advocate portal
                  <ExternalLinkIcon />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
                <p className={styles.portalUrl}>Opens {ADVOCATE_PORTAL_URL} in a new tab.</p>
              </div>
            </section>
          ) : (
            <p className="note">
              Are you an advocate? You can create a listing in the{' '}
              <a
                href={`${ADVOCATE_PORTAL_URL}/register`}
                target="_blank"
                rel="noopener noreferrer"
                className="link"
              >
                advocate portal
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
              , a separate app on this computer.
            </p>
          )}

          <p className={styles.dataNote}>
            Stored on this computer. Your account lives in the local database: your email, a hashed
            password, the details on this page and your saved conversations.
          </p>
        </aside>
      </div>
    </main>
  );
}

function ShortcutRow({
  href,
  icon,
  title,
  meta,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  meta: string;
}) {
  return (
    <li>
      <Link href={href} className={styles.linkRow}>
        <span className={styles.linkIcon}>{icon}</span>
        <span className={styles.linkText}>
          <span className={styles.linkTitle}>{title}</span>
          <span className={styles.linkMeta}>{meta}</span>
        </span>
        <ArrowRightIcon className={styles.linkArrow} />
      </Link>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Email verification notice
// ---------------------------------------------------------------------------

function VerifyEmailNotice({ email }: { email: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const [problem, setProblem] = useState<MappedAuthError | null>(null);

  async function resend() {
    if (state === 'sending') return;
    setState('sending');
    setProblem(null);
    try {
      await authClient.resendVerification(email);
      setState('sent');
    } catch (err) {
      setProblem(mapAuthError(err, 'request'));
      setState('failed');
    }
  }

  return (
    <div className="alert alert-warn">
      <AlertIcon />
      <div className="min-w-0">
        <p className="alert-title">Your email is not verified yet</p>
        <p className="mt-0.5">
          Verifying confirms the address on your account belongs to you. No real email is sent in
          this setup; the link is written to the API server&apos;s log on this computer.
        </p>
        <div className={styles.verifyRow}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => void resend()}
            aria-busy={state === 'sending' ? true : undefined}
          >
            {state === 'sending'
              ? 'Sending…'
              : state === 'sent'
                ? 'Send another link'
                : 'Send a verification link'}
          </button>
          {state === 'sent' && (
            <span role="status" className="text-ok flex items-center gap-1.5 text-sm">
              <CheckIcon className="h-4 w-4" />A link was created.
            </span>
          )}
          {state === 'failed' && problem && (
            <span role="alert" className="text-danger flex items-center gap-1.5 text-sm">
              <AlertIcon className="h-4 w-4 flex-none" />
              {problemMessage(problem)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Details form
// ---------------------------------------------------------------------------

function DetailsPanel({ user }: { user: AuthUser }) {
  const { updateProfile } = useAuth();
  const form = useFormFields(profileValuesOf(user), (v) =>
    compactErrors({
      displayName: validateDisplayName(v.displayName),
      stateCode: null,
      language: null,
    }),
  );
  const { rootRef, requestFocus } = useErrorFocus();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [problem, setProblem] = useState<MappedAuthError | null>(null);

  const dirty = isProfileDirty(form.values, user);
  const states = useMemo(() => stateOptions(user.state_code), [user.state_code]);
  const languages = useMemo(
    () => languageOptions(user.preferred_language),
    [user.preferred_language],
  );

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving || !dirty) return;
    setProblem(null);
    setSaved(false);
    const errors = form.validateAll();
    if (Object.keys(errors).length > 0) {
      requestFocus();
      return;
    }
    setSaving(true);
    try {
      await updateProfile(asUpdatePayload(buildProfilePatch(form.values, user)));
      // Keep what was typed, minus stray spaces, as the new saved baseline.
      form.reset({ ...form.values, displayName: form.values.displayName.trim() });
      setSaved(true);
    } catch (err) {
      const mapped = mapAuthError(err, 'profile');
      form.setServerErrors(mapped.fields);
      setProblem(mapped);
      requestFocus();
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={`surface ${styles.panel}`} aria-labelledby="details-title">
      <div className={styles.panelHead}>
        <h2 id="details-title" className={`display ${styles.panelTitle}`}>
          Your details
        </h2>
        <p className={styles.panelLede}>
          Saved to your account on this computer. Every field is optional. Your email, shown above,
          is how you sign in and can&apos;t be changed from this page.
        </p>
      </div>

      <form
        ref={rootRef}
        onSubmit={onSubmit}
        noValidate
        method="post"
        className="flex flex-col gap-5"
      >
        <Field label="Name" optional error={form.errorFor('displayName')}>
          <input
            {...form.bind('displayName')}
            type="text"
            autoComplete="name"
            className={inputClass}
          />
        </Field>

        <div className={styles.pair}>
          <Field
            label="State"
            optional
            error={form.errorFor('stateCode')}
            hint="Many rules, such as stamp duty and tenancy law, differ by state."
          >
            <select {...form.bind('stateCode')} autoComplete="off" className={inputClass}>
              <option value="">Not set</option>
              {states.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Preferred language"
            optional
            error={form.errorFor('language')}
            hint="Saved for later. It does not change the app's language yet."
          >
            <select {...form.bind('language')} autoComplete="off" className={inputClass}>
              <option value="">Not set</option>
              {languages.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {problem?.form && (
          <FormAlert title={errorTitle(problem.kind, 'profile')}>
            {problem.form}
            {problem.kind === 'session_expired' && (
              <>
                {' '}
                <Link href={authHref('/login', '/profile')} className="link">
                  Log in again
                </Link>
              </>
            )}
          </FormAlert>
        )}

        {saved && !dirty && !problem && (
          <div role="status" className="alert alert-ok fade-in">
            <CheckIcon />
            <div className="min-w-0">
              <p className="alert-title">Changes saved</p>
            </div>
          </div>
        )}

        <div className={styles.actions}>
          <SubmitButton
            loading={saving}
            loadingLabel="Saving…"
            block={false}
            large={false}
            disabled={!dirty && !saving}
          >
            Save changes
          </SubmitButton>
          {dirty && !saving && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                form.reset(profileValuesOf(user));
                setProblem(null);
                setSaved(false);
              }}
            >
              Discard changes
            </button>
          )}
          {!dirty && !saved && (
            <p className="subtle flex items-center gap-1.5 text-sm">
              <InfoIcon className="h-4 w-4" />
              Nothing to save yet.
            </p>
          )}
        </div>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Waiting for the saved session
// ---------------------------------------------------------------------------

function ProfileSkeleton() {
  return (
    <main className="page" aria-busy="true">
      <div role="status">
        <span className="sr-only">Loading your profile…</span>
        <div className={styles.skeletonHead} aria-hidden="true">
          <span className="skeleton skeleton-circle h-20 w-20 flex-none" />
          <div className="flex flex-1 flex-col gap-2.5">
            <span className="skeleton h-3 w-24" />
            <span className="skeleton h-9 w-2/3 max-w-xs" />
            <span className="skeleton h-4 w-1/2 max-w-[14rem]" />
          </div>
        </div>
        <div className={styles.cols} aria-hidden="true">
          <div className={`surface ${styles.panel}`}>
            <span className="skeleton h-8 w-40" />
            <div className={styles.skeletonStack}>
              <span className="skeleton skeleton-block h-11 w-full" />
              <span className="skeleton skeleton-block h-11 w-full" />
              <span className="skeleton skeleton-block h-11 w-full" />
            </div>
          </div>
          <div className={styles.side}>
            <span className="skeleton skeleton-block h-48 w-full" />
          </div>
        </div>
      </div>
    </main>
  );
}
