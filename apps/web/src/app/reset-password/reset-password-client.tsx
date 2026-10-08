'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import {
  compactErrors,
  Field,
  FormAlert,
  inputClass,
  LengthMeter,
  PasswordField,
  SubmitButton,
  useErrorFocus,
  useFocusOnChange,
  useFormFields,
} from '@/components/form';
import { AlertIcon, CheckIcon, InfoIcon } from '@/components/icons';
import { authClient } from '@/lib/auth-client';
import { ArrowLeftIcon, KeyIcon, MailIcon } from '../login/_shared/auth-icons';
import {
  errorTitle,
  mapAuthError,
  MIN_PASSWORD_LENGTH,
  problemMessage,
  validateConfirmation,
  validateEmail,
  validateNewPassword,
  type MappedAuthError,
} from '../login/_shared/auth-logic';
import { DemoNotice, useAuthMode } from '../login/_shared/auth-mode';
import { AuthShell } from '../login/_shared/auth-shell';
import styles from '../login/_shared/auth-shell.module.css';

/**
 * One page, two steps. Without `?token=` it asks for an email and requests a
 * reset link; with a token (from the link) it sets a new password.
 */
export function ResetPasswordClient({ token }: { token: string | null }) {
  return token ? <SetNewPassword token={token} /> : <RequestResetLink />;
}

const BACK_TO_LOGIN = (
  <Link href="/login" className="link inline-flex items-center gap-1.5 font-medium">
    <ArrowLeftIcon className="h-4 w-4" />
    Back to log in
  </Link>
);

// ---------------------------------------------------------------------------
// Step 1: ask for a link
// ---------------------------------------------------------------------------

/** How long "Send it again" waits, so a double click cannot send two links. */
const RESEND_WAIT_SECONDS = 30;

function RequestResetLink() {
  const { demo } = useAuthMode();
  // The API accepts a real email address only here, even in demo mode.
  const form = useFormFields({ email: '' }, (v) =>
    compactErrors({ email: validateEmail(v.email, false) }),
  );
  const { rootRef, requestFocus } = useErrorFocus();
  const [submitting, setSubmitting] = useState(false);
  const [problem, setProblem] = useState<MappedAuthError | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const [resent, setResent] = useState(false);

  const headingRef = useFocusOnChange(sentTo ? 'sent' : 'form');

  // Counts the resend wait down once a second while it is running.
  const counting = wait > 0;
  useEffect(() => {
    if (!counting) return;
    const id = window.setInterval(() => setWait((w) => Math.max(0, w - 1)), 1000);
    return () => window.clearInterval(id);
  }, [counting]);

  async function send(address: string): Promise<boolean> {
    setSubmitting(true);
    setProblem(null);
    try {
      await authClient.forgotPassword(address);
      setSentTo(address);
      setWait(RESEND_WAIT_SECONDS);
      return true;
    } catch (err) {
      const mapped = mapAuthError(err, 'request');
      form.setServerErrors(mapped.fields);
      setProblem(mapped);
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    const errors = form.validateAll();
    if (Object.keys(errors).length > 0) {
      requestFocus();
      return;
    }
    const ok = await send(form.values.email.trim());
    if (!ok) requestFocus();
  }

  async function onResend() {
    if (!sentTo || submitting || wait > 0) return;
    setResent(false);
    if (await send(sentTo)) setResent(true);
  }

  if (sentTo) {
    return (
      <AuthShell
        headingRef={headingRef}
        status={{ tone: 'accent', icon: <MailIcon /> }}
        title="Check your email"
        lede={
          <>
            If an account exists for <span className={styles.emailChip}>{sentTo}</span>, a reset
            link is on its way. It works once and expires after 1 hour.
          </>
        }
        busy={submitting}
        footer={BACK_TO_LOGIN}
        centerFooter
      >
        <div className="alert alert-info">
          <InfoIcon />
          <div className="min-w-0">
            <p className="alert-title">No real email is sent in this setup</p>
            <p className="mt-0.5">
              Nothing arrives in an inbox. The link is written to the API server&apos;s log on this
              computer; open that log to copy it.
            </p>
          </div>
        </div>

        {problem && (
          <FormAlert title={errorTitle(problem.kind, 'request')}>
            {problemMessage(problem)}
          </FormAlert>
        )}
        {resent && !problem && (
          <p role="status" className="text-ok flex items-center gap-2 text-sm">
            <CheckIcon className="h-4 w-4" />A new link was requested.
          </p>
        )}

        <div className={styles.actions}>
          <button
            type="button"
            className="btn btn-secondary btn-block"
            onClick={() => void onResend()}
            aria-busy={submitting ? true : undefined}
            aria-disabled={wait > 0 ? true : undefined}
          >
            {wait > 0 ? `Send it again in ${wait}s` : 'Send it again'}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-block"
            onClick={() => {
              setSentTo(null);
              setResent(false);
              setProblem(null);
            }}
          >
            Use a different email
          </button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      headingRef={headingRef}
      eyebrow="Account recovery"
      title="Reset your password"
      lede="Enter the email you signed up with and we'll create a link to choose a new password."
      busy={submitting}
      footer={BACK_TO_LOGIN}
      centerFooter
    >
      {demo && (
        <DemoNotice>
          Consumer accounts sign in with any password, so there is usually nothing to reset.
          Advocate and admin accounts still need their real password.
        </DemoNotice>
      )}

      <form
        ref={rootRef}
        onSubmit={onSubmit}
        noValidate
        method="post"
        className="flex flex-col gap-5"
      >
        <Field label="Email" error={form.errorFor('email')}>
          <input
            {...form.bind('email')}
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            className={inputClass}
          />
        </Field>

        {problem?.form && (
          <FormAlert title={errorTitle(problem.kind, 'request')}>{problem.form}</FormAlert>
        )}

        <SubmitButton loading={submitting} loadingLabel="Sending…">
          Send reset link
        </SubmitButton>

        <p className={styles.fineprint}>
          This setup has no email service connected. The link is written to the API server&apos;s
          log on this computer instead of being delivered.
        </p>
      </form>
    </AuthShell>
  );
}

// ---------------------------------------------------------------------------
// Step 2: choose a new password
// ---------------------------------------------------------------------------

type Phase = 'form' | 'done' | 'invalid';

function SetNewPassword({ token }: { token: string }) {
  const form = useFormFields({ password: '', confirm: '' }, (v) =>
    compactErrors({
      password: validateNewPassword(v.password, false),
      confirm: validateConfirmation(v.password, v.confirm),
    }),
  );
  const { rootRef, requestFocus } = useErrorFocus();
  const [submitting, setSubmitting] = useState(false);
  const [problem, setProblem] = useState<MappedAuthError | null>(null);
  const [phase, setPhase] = useState<Phase>('form');

  const headingRef = useFocusOnChange(phase);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setProblem(null);
    const errors = form.validateAll();
    if (Object.keys(errors).length > 0) {
      requestFocus();
      return;
    }
    setSubmitting(true);
    try {
      await authClient.resetPassword(token, form.values.password);
      setPhase('done');
    } catch (err) {
      const mapped = mapAuthError(err, 'reset');
      if (mapped.kind === 'invalid_token') {
        setPhase('invalid');
      } else {
        form.setServerErrors(mapped.fields);
        setProblem(mapped);
        requestFocus();
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (phase === 'done') {
    return (
      <AuthShell
        headingRef={headingRef}
        status={{ tone: 'ok', icon: <CheckIcon /> }}
        title="Password updated"
        lede="You can now log in with your new password. Any other sessions on this account were signed out."
      >
        <Link href="/login" className="btn btn-primary btn-lg btn-block">
          Log in
        </Link>
      </AuthShell>
    );
  }

  if (phase === 'invalid') {
    return (
      <AuthShell
        headingRef={headingRef}
        status={{ tone: 'danger', icon: <AlertIcon /> }}
        title="This reset link can't be used"
        lede="Reset links work once and expire after 1 hour. This one has expired, was already used, or was copied incompletely."
        footer={BACK_TO_LOGIN}
        centerFooter
      >
        <Link href="/reset-password" className="btn btn-primary btn-lg btn-block">
          Request a new link
        </Link>
      </AuthShell>
    );
  }

  const password = form.values.password;
  return (
    <AuthShell
      headingRef={headingRef}
      status={{ tone: 'accent', icon: <KeyIcon /> }}
      title="Choose a new password"
      lede="Pick one you have not used elsewhere. Saving it signs you out of this account everywhere."
      busy={submitting}
      footer={BACK_TO_LOGIN}
      centerFooter
    >
      <form
        ref={rootRef}
        onSubmit={onSubmit}
        noValidate
        method="post"
        className="flex flex-col gap-5"
      >
        <PasswordField
          label="New password"
          {...form.bind('password')}
          error={form.errorFor('password')}
          autoComplete="new-password"
          required
          hint={
            password ? (
              <LengthMeter value={password} min={MIN_PASSWORD_LENGTH} />
            ) : (
              `Use at least ${MIN_PASSWORD_LENGTH} characters.`
            )
          }
        />
        <PasswordField
          label="Confirm new password"
          {...form.bind('confirm')}
          error={form.errorFor('confirm')}
          autoComplete="new-password"
          required
        />

        {problem?.form && (
          <FormAlert title={errorTitle(problem.kind, 'reset')}>{problem.form}</FormAlert>
        )}

        <SubmitButton loading={submitting} loadingLabel="Saving…">
          Save new password
        </SubmitButton>
      </form>
    </AuthShell>
  );
}
