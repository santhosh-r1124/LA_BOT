'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { buttonClass, Field, inputClass, secondaryButtonClass } from '@/components/form';
import { ApiRequestError } from '@/lib/api-client';
import { authClient } from '@/lib/auth-client';
import { useAuth } from '@/lib/auth-context';

export default function ProfilePage() {
  const router = useRouter();
  const { user, loading, logout, updateProfile, refreshUser } = useAuth();

  const [displayName, setDisplayName] = useState('');
  const [stateCode, setStateCode] = useState('');
  const [preferredLanguage, setPreferredLanguage] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendStatus, setResendStatus] = useState<'idle' | 'sending' | 'sent'>('idle');

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  useEffect(() => {
    if (user) {
      setDisplayName(user.display_name ?? '');
      setStateCode(user.state_code ?? '');
      setPreferredLanguage(user.preferred_language ?? '');
    }
  }, [user]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      await updateProfile({
        display_name: displayName || undefined,
        state_code: stateCode || undefined,
        preferred_language: preferredLanguage || undefined,
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not save your profile.');
    } finally {
      setSaving(false);
    }
  }

  async function onResendVerification() {
    if (!user) return;
    setResendStatus('sending');
    try {
      await authClient.resendVerification(user.email);
    } finally {
      setResendStatus('sent');
    }
  }

  async function onLogout() {
    await logout();
    router.push('/');
  }

  if (loading || !user) {
    return (
      <main className="text-fg-muted flex min-h-screen items-center justify-center">Loading…</main>
    );
  }

  return (
    <main className="surface auth-card">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="display text-2xl">Your profile</h1>
          <p className="text-fg-muted mt-1 text-sm">{user.email}</p>
        </div>
        <span className="badge">{user.role}</span>
      </div>

      {!user.email_verified && (
        <div className="alert alert-warn block">
          <p>Your email isn&apos;t verified yet.</p>
          <button
            type="button"
            onClick={onResendVerification}
            disabled={resendStatus !== 'idle'}
            className="mt-1 font-medium underline underline-offset-2 disabled:no-underline"
          >
            {resendStatus === 'sent' ? 'Verification email sent' : 'Resend verification email'}
          </button>
        </div>
      )}

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field label="Name">
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="State" hint="Two-letter code, e.g. KA, MH, DL.">
          <input
            type="text"
            maxLength={2}
            value={stateCode}
            onChange={(e) => setStateCode(e.target.value.toUpperCase())}
            className={inputClass}
          />
        </Field>
        <Field label="Preferred language" hint="e.g. en, hi, kn.">
          <input
            type="text"
            value={preferredLanguage}
            onChange={(e) => setPreferredLanguage(e.target.value)}
            className={inputClass}
          />
        </Field>

        {error && (
          <p role="alert" className="field-error text-sm">
            {error}
          </p>
        )}
        {saved && (
          <p role="status" className="text-ok text-sm">
            Saved.
          </p>
        )}

        <div className="flex gap-3">
          <button type="submit" disabled={saving} className={buttonClass}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <button type="button" onClick={() => void refreshUser()} className={secondaryButtonClass}>
            Refresh
          </button>
        </div>
      </form>

      <button
        type="button"
        onClick={() => void onLogout()}
        className={`${secondaryButtonClass} mt-auto`}
      >
        Log out
      </button>
    </main>
  );
}
