'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { FormAlert, useFocusOnChange } from '@/components/form';
import { AlertIcon, CheckIcon, InfoIcon, SpinnerIcon } from '@/components/icons';
import { authClient } from '@/lib/auth-client';
import { useAuth } from '@/lib/auth-context';
import { MailIcon } from '../login/_shared/auth-icons';
import {
  errorTitle,
  mapAuthError,
  problemMessage,
  type MappedAuthError,
} from '../login/_shared/auth-logic';
import { AuthShell } from '../login/_shared/auth-shell';
import styles from '../login/_shared/auth-shell.module.css';

type Phase =
  | { kind: 'missing' }
  | { kind: 'verifying' }
  | { kind: 'success' }
  | { kind: 'invalid' }
  | { kind: 'failed'; problem: MappedAuthError };

/**
 * One verification request per token, shared by every caller. React runs effects
 * twice in development; a second request with a one-time token would be refused
 * and the page would report a failure for a link that just worked.
 */
const requests = new Map<string, Promise<void>>();

function verifyOnce(token: string): Promise<void> {
  let request = requests.get(token);
  if (!request) {
    request = authClient.verifyEmail(token).then(() => undefined);
    requests.set(token, request);
    // A failure is not remembered, so "Try again" makes a fresh request.
    request.catch(() => {
      if (requests.get(token) === request) requests.delete(token);
    });
  }
  return request;
}

export function VerifyEmailClient({ token }: { token: string | null }) {
  const { user, loading, refreshUser } = useAuth();
  const [result, setPhase] = useState<Phase>(token ? { kind: 'verifying' } : { kind: 'missing' });
  const [attempt, setAttempt] = useState(0);
  // The screens for "verified" and "link not usable" depend on whether someone is
  // signed in, so they wait for the saved session to be read (a moment at most).
  const phase: Phase =
    loading && (result.kind === 'success' || result.kind === 'invalid')
      ? { kind: 'verifying' }
      : result;
  const headingRef = useFocusOnChange(phase.kind);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setPhase({ kind: 'verifying' });
    verifyOnce(token).then(
      () => {
        if (cancelled) return;
        setPhase({ kind: 'success' });
        // Signed in on this browser: pick up the new "verified" flag.
        void refreshUser().catch(() => undefined);
      },
      (err: unknown) => {
        if (cancelled) return;
        const problem = mapAuthError(err, 'verify');
        setPhase(
          problem.kind === 'invalid_token' ? { kind: 'invalid' } : { kind: 'failed', problem },
        );
      },
    );
    return () => {
      cancelled = true;
    };
    // refreshUser changes identity when the session does; verifying must not rerun for that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, attempt]);

  switch (phase.kind) {
    case 'verifying':
      return (
        <AuthShell
          headingRef={headingRef}
          status={{ tone: 'accent', icon: <SpinnerIcon /> }}
          title="Verifying your email"
          lede="This only takes a moment."
          busy
        >
          <p role="status" className="sr-only">
            Verifying your email address.
          </p>
        </AuthShell>
      );

    case 'success':
      return (
        <AuthShell
          headingRef={headingRef}
          status={{ tone: 'ok', icon: <CheckIcon /> }}
          title="Email verified"
          lede={
            user ? (
              <>
                <span className={styles.emailChip}>{user.email}</span> is confirmed on your account.
              </>
            ) : (
              'Your email address is confirmed. Log in to carry on.'
            )
          }
        >
          {user ? (
            <Link href="/profile" className="btn btn-primary btn-lg btn-block">
              Go to your profile
            </Link>
          ) : (
            <Link href="/login" className="btn btn-primary btn-lg btn-block">
              Log in
            </Link>
          )}
        </AuthShell>
      );

    case 'invalid':
      return (
        <AuthShell
          headingRef={headingRef}
          status={{ tone: 'danger', icon: <AlertIcon /> }}
          title="This verification link can't be used"
          lede="Verification links work once and expire after 24 hours. This one has expired or was already used. If you have used it before, your email is probably verified already."
        >
          <GetNewLink email={user?.email ?? null} />
        </AuthShell>
      );

    case 'failed':
      return (
        <AuthShell
          headingRef={headingRef}
          status={{ tone: 'danger', icon: <AlertIcon /> }}
          title="We couldn't check your link"
          lede="Nothing is wrong with the link as far as we can tell. The check itself did not go through."
        >
          <FormAlert title={errorTitle(phase.problem.kind, 'verify')}>
            {phase.problem.form}
          </FormAlert>
          <button
            type="button"
            className="btn btn-primary btn-lg btn-block"
            onClick={() => setAttempt((n) => n + 1)}
          >
            Try again
          </button>
        </AuthShell>
      );

    default:
      return (
        <AuthShell
          headingRef={headingRef}
          status={{ tone: 'info', icon: <MailIcon /> }}
          title="Open the link from your email"
          lede="This page confirms an email address. It needs the personal link sent when an account is created or when you ask for a new one."
        >
          <div className="alert alert-info">
            <InfoIcon />
            <div className="min-w-0">
              <p className="alert-title">No real email is sent in this setup</p>
              <p className="mt-0.5">
                The link is written to the API server&apos;s log on this computer instead.
              </p>
            </div>
          </div>
          <GetNewLink email={user?.email ?? null} />
        </AuthShell>
      );
  }
}

/**
 * What to do with a link that cannot be used. Signed in: ask for a new one right
 * here. Not signed in: log in first, because a new link goes to the account's
 * own email address.
 */
function GetNewLink({ email }: { email: string | null }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const [problem, setProblem] = useState<MappedAuthError | null>(null);

  const resend = useCallback(async () => {
    if (!email || state === 'sending') return;
    setState('sending');
    setProblem(null);
    try {
      await authClient.resendVerification(email);
      setState('sent');
    } catch (err) {
      setProblem(mapAuthError(err, 'request'));
      setState('failed');
    }
  }, [email, state]);

  if (!email) {
    return (
      <div className={styles.actions}>
        <Link href="/login" className="btn btn-primary btn-lg btn-block">
          Log in to get a new link
        </Link>
        <p className={styles.fineprint}>
          A new link is sent to the email address on your account, so log in first.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.actions}>
      {state === 'sent' && (
        <p role="status" className="text-ok flex items-start gap-2 text-sm">
          <CheckIcon className="mt-0.5 h-4 w-4 flex-none" />
          <span>
            If <span className={styles.emailChip}>{email}</span> still needs verifying, a new link
            has been created.
          </span>
        </p>
      )}
      {state === 'failed' && problem && (
        <FormAlert title={errorTitle(problem.kind, 'request')}>{problemMessage(problem)}</FormAlert>
      )}
      <button
        type="button"
        className="btn btn-primary btn-lg btn-block"
        aria-busy={state === 'sending' ? true : undefined}
        onClick={() => void resend()}
      >
        {state === 'sending'
          ? 'Sending…'
          : state === 'sent'
            ? 'Send another link'
            : 'Send me a new link'}
      </button>
      <Link href="/profile" className="btn btn-ghost btn-block">
        Go to your profile
      </Link>
    </div>
  );
}
