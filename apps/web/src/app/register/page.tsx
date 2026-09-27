'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ApiRequestError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { buttonClass, Field, inputClass } from '@/components/form';

export default function RegisterPage() {
  const router = useRouter();
  const { register } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [stateCode, setStateCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await register({
        email,
        password,
        display_name: displayName || undefined,
        state_code: stateCode || undefined,
      });
      router.push('/profile');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="surface auth-card">
      <div>
        <h1 className="display text-2xl">Create an account</h1>
        <p className="text-fg-muted mt-1 text-sm">
          Free — ask legal questions, generate document guidance, and find an advocate.
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field label="Email">
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Password" hint="At least 8 characters.">
          <input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Name (optional)">
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="State (optional)" hint="Two-letter code, e.g. KA, MH, DL.">
          <input
            type="text"
            maxLength={2}
            value={stateCode}
            onChange={(e) => setStateCode(e.target.value.toUpperCase())}
            className={inputClass}
          />
        </Field>

        {error && (
          <p role="alert" className="field-error text-sm">
            {error}
          </p>
        )}

        <button type="submit" disabled={submitting} className={buttonClass}>
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      <p className="text-fg-muted text-center text-sm">
        Already have an account?{' '}
        <Link href="/login" className="link font-medium">
          Log in
        </Link>
      </p>
    </main>
  );
}
