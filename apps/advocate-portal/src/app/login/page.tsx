'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AsideIntro, AuthShell } from '@/components/auth-shell';
import { Field, FormMessage, PasswordInput } from '@/components/form';
import { AdvocateIcon, ExternalLinkIcon, ShieldIcon } from '@/components/icons';
import { useAuth } from '@/lib/auth-context';
import { loginErrorMessage, validateEmail } from '@/lib/forms';
import { WEB_URL } from '@/lib/links';

const POINTS = [
  {
    Icon: ShieldIcon,
    title: 'See where your review stands',
    text: 'Awaiting review, In review, Verified or Not approved, with the reviewer note if there is one.',
  },
  {
    Icon: AdvocateIcon,
    title: 'Keep your profile current',
    text: 'Update your practice areas, languages, fee and bio. Verified profiles show the change in the directory.',
  },
];

export default function LoginPage() {
  const router = useRouter();
  const { user, loading, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailTouched, setEmailTouched] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ title: string; message: string; register?: boolean } | null>(
    null,
  );
  const errorRef = useRef<HTMLDivElement>(null);

  // Someone who is already signed in has no use for this page.
  useEffect(() => {
    if (!loading && user && !submitting) router.replace('/profile');
  }, [loading, user, submitting, router]);

  const emailError = emailTouched || submitted ? validateEmail(email) : undefined;
  const passwordError = submitted && !password ? 'Enter your password.' : undefined;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitted(true);
    if (validateEmail(email) || !password) {
      document.getElementById(validateEmail(email) ? 'login-email' : 'login-password')?.focus();
      return;
    }
    setSubmitting(true);
    try {
      await login({ email: email.trim(), password });
      router.push('/profile');
    } catch (err) {
      const notAdvocate =
        typeof err === 'object' &&
        err !== null &&
        (err as { code?: string }).code === 'not_an_advocate';
      setError({
        title: notAdvocate ? 'This email is not an advocate account' : 'Could not log you in',
        message: loginErrorMessage(err),
        register: notAdvocate,
      });
      setSubmitting(false);
      requestAnimationFrame(() => errorRef.current?.focus());
    }
  }

  return (
    <AuthShell
      eyebrow="For advocates"
      title="Log in to the portal"
      lede="Use the email and password you registered with."
      busy={submitting || loading}
      footer={
        <>
          <span>New here?</span>
          <Link href="/register" className="link font-medium">
            Register as an advocate
          </Link>
        </>
      }
      aside={
        <AsideIntro
          eyebrow="Advocate Portal"
          title="Your profile, and where it stands."
          points={POINTS}
        >
          <p className="note max-w-[46ch]">
            This portal is for advocates only. To ask a legal question or draft a document, use{' '}
            <a
              href={WEB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="link inline-flex items-center gap-1"
            >
              Legal Advisor
              <ExternalLinkIcon className="size-3.5" />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
            .
          </p>
        </AsideIntro>
      }
    >
      {loading ? (
        <div className="flex flex-col gap-4" aria-hidden="true">
          <div className="skeleton h-16" />
          <div className="skeleton h-16" />
          <div className="skeleton h-10" />
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          {error && (
            <FormMessage tone="danger" title={error.title} messageRef={errorRef}>
              <p>{error.message}</p>
              {error.register && (
                <p className="mt-1">
                  <Link href="/register" className="link font-medium">
                    Register as an advocate
                  </Link>
                </p>
              )}
            </FormMessage>
          )}

          <Field id="login-email" label="Email" error={emailError}>
            {(c) => (
              <input
                {...c}
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => setEmailTouched(true)}
                className="input"
              />
            )}
          </Field>

          <Field
            id="login-password"
            label="Password"
            error={passwordError}
            hint={
              <>
                Forgot it?{' '}
                <a
                  href={`${WEB_URL}/reset-password`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="link"
                >
                  Reset it on Legal Advisor
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
                . No email is sent in this setup; the reset link is written to the API log.
              </>
            }
          >
            {(c) => (
              <PasswordInput
                {...c}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>

          <button
            type="submit"
            className="btn btn-primary btn-lg btn-block"
            aria-busy={submitting || undefined}
            disabled={submitting}
          >
            {submitting ? 'Logging in' : 'Log in'}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
