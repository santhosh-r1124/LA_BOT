'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import {
  compactErrors,
  Field,
  FormAlert,
  inputClass,
  PasswordField,
  PendingLine,
  SubmitButton,
  useErrorFocus,
  useFocusOnChange,
  useFormFields,
} from '@/components/form';
import { CheckIcon } from '@/components/icons';
import { useAuth } from '@/lib/auth-context';
import {
  authHref,
  DEFAULT_AFTER_LOGIN,
  destinationLabel,
  errorTitle,
  mapAuthError,
  validateEmail,
  validateLoginPassword,
  type MappedAuthError,
} from './_shared/auth-logic';
import { DemoNotice, useAuthMode } from './_shared/auth-mode';
import { AuthShell } from './_shared/auth-shell';
import styles from './_shared/auth-shell.module.css';

/**
 * Sign in. Three things can be on screen: the form, a short "signed in" screen
 * while the next page loads, or (for someone who opens /login with a session
 * already running) a "you are already signed in" screen instead of a pointless
 * form.
 */
export function LoginForm({ next }: { next: string | null }) {
  const router = useRouter();
  const { user, loading, login, logout } = useAuth();
  const { demo, lenient } = useAuthMode();
  const target = next ?? DEFAULT_AFTER_LOGIN;

  const form = useFormFields({ email: '', password: '' }, (v) =>
    compactErrors({
      email: validateEmail(v.email, lenient),
      password: validateLoginPassword(v.password, lenient),
    }),
  );
  const { rootRef, requestFocus } = useErrorFocus();
  const [submitting, setSubmitting] = useState(false);
  const [problem, setProblem] = useState<MappedAuthError | null>(null);
  const [justSignedIn, setJustSignedIn] = useState(false);

  const phase = justSignedIn ? 'redirecting' : !loading && user ? 'already' : 'form';
  const headingRef = useFocusOnChange(phase);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Enter in a field still submits while the button is busy: ignore it.
    if (submitting) return;
    setProblem(null);
    const errors = form.validateAll();
    if (Object.keys(errors).length > 0) {
      requestFocus();
      return;
    }
    setSubmitting(true);
    try {
      await login({ email: form.values.email.trim(), password: form.values.password });
      setJustSignedIn(true);
      router.push(target);
    } catch (err) {
      const mapped = mapAuthError(err, 'login');
      form.setServerErrors(mapped.fields);
      setProblem(mapped);
      requestFocus();
    } finally {
      setSubmitting(false);
    }
  }

  if (phase === 'redirecting') {
    return (
      <AuthShell
        headingRef={headingRef}
        status={{ tone: 'ok', icon: <CheckIcon /> }}
        title="You're signed in"
        lede={`Taking you to ${destinationLabel(target)}.`}
        busy
      >
        <PendingLine>One moment…</PendingLine>
        <Link href={target} className="btn btn-secondary btn-block">
          Continue now
        </Link>
      </AuthShell>
    );
  }

  if (phase === 'already' && user) {
    return (
      <AuthShell
        headingRef={headingRef}
        status={{ tone: 'ok', icon: <CheckIcon /> }}
        title="You're already signed in"
        lede={
          <>
            Signed in as <span className={styles.emailChip}>{user.email}</span>.
          </>
        }
      >
        <div className={styles.actions}>
          <Link href={target} className="btn btn-primary btn-lg btn-block">
            {target === DEFAULT_AFTER_LOGIN ? 'Go to your profile' : 'Continue'}
          </Link>
          <button
            type="button"
            className="btn btn-secondary btn-block"
            onClick={() => void logout()}
          >
            Log out and use another account
          </button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      headingRef={headingRef}
      eyebrow="Log in"
      title="Welcome back"
      lede="Log in to keep your conversation history together on this computer."
      busy={submitting}
      footer={
        <p>
          New here?{' '}
          <Link href={authHref('/register', next)} className="link font-medium">
            Create an account
          </Link>
        </p>
      }
      centerFooter
    >
      {demo && (
        <DemoNotice>
          Any email and any password signs you in as a consumer. A new account is created the first
          time you log in.
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
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            className={inputClass}
          />
        </Field>

        <PasswordField
          label="Password"
          {...form.bind('password')}
          error={form.errorFor('password')}
          autoComplete="current-password"
          required={!lenient}
          labelAction={
            <Link
              href={authHref('/reset-password')}
              className="link inline-flex min-h-6 items-center text-[0.8125rem]"
            >
              Forgot password?
            </Link>
          }
        />

        {problem?.form && (
          <FormAlert title={errorTitle(problem.kind, 'login')}>{problem.form}</FormAlert>
        )}

        <SubmitButton loading={submitting} loadingLabel="Logging in…">
          Log in
        </SubmitButton>
      </form>
    </AuthShell>
  );
}
