'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { buttonClass, Field, inputClass, secondaryButtonClass } from '@/components/form';
import { ApiRequestError } from '@/lib/api-client';
import { authClient } from '@/lib/auth-client';
import { useAuth } from '@/lib/auth-context';

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'badge badge-warn',
  IN_REVIEW: 'badge badge-accent',
  VERIFIED: 'badge badge-ok',
  REJECTED: 'badge badge-danger',
};

export default function ProfilePage() {
  const router = useRouter();
  const { user, profile, loading, logout, updateProfile, refresh } = useAuth();

  const [city, setCity] = useState('');
  const [stateCode, setStateCode] = useState('');
  const [practiceAreas, setPracticeAreas] = useState('');
  const [languages, setLanguages] = useState('');
  const [consultationFee, setConsultationFee] = useState('');
  const [bio, setBio] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendStatus, setResendStatus] = useState<'idle' | 'sending' | 'sent'>('idle');

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  useEffect(() => {
    if (profile) {
      setCity(profile.city);
      setStateCode(profile.state_code);
      setPracticeAreas(profile.practice_areas.join(', '));
      setLanguages(profile.languages.join(', '));
      setConsultationFee(profile.consultation_fee ?? '');
      setBio(profile.bio ?? '');
    }
  }, [profile]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      await updateProfile({
        city,
        state_code: stateCode,
        practice_areas: practiceAreas
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        languages: languages
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        consultation_fee: consultationFee || undefined,
        bio: bio || undefined,
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

  if (loading || !user || !profile) {
    return (
      <main className="text-fg-muted flex min-h-screen items-center justify-center">Loading…</main>
    );
  }

  return (
    <main className="surface auth-card">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="display text-2xl">{user.display_name}</h1>
          <p className="text-fg-muted mt-1 text-sm">{user.email}</p>
        </div>
        <span className={STATUS_STYLES[profile.verification_status] ?? 'badge'}>
          {profile.verification_status.replace('_', ' ')}
        </span>
      </div>

      {profile.verification_status === 'PENDING' && (
        <p className="alert alert-warn block">
          Your profile is awaiting admin verification. You can keep it updated in the meantime.
        </p>
      )}
      {profile.verification_status === 'REJECTED' && profile.verification_note && (
        <p className="alert alert-danger block">Rejected: {profile.verification_note}</p>
      )}

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
        <div className="grid grid-cols-2 gap-4">
          <Field label="State">
            <input
              type="text"
              maxLength={2}
              value={stateCode}
              onChange={(e) => setStateCode(e.target.value.toUpperCase())}
              className={inputClass}
            />
          </Field>
          <Field label="City">
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>
        <Field label="Practice areas" hint="Comma-separated">
          <input
            type="text"
            value={practiceAreas}
            onChange={(e) => setPracticeAreas(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Languages" hint="Comma-separated">
          <input
            type="text"
            value={languages}
            onChange={(e) => setLanguages(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Consultation fee (₹)">
          <input
            type="number"
            min={0}
            step="0.01"
            value={consultationFee}
            onChange={(e) => setConsultationFee(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Bio">
          <textarea
            rows={4}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
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
          <button type="button" onClick={() => void refresh()} className={secondaryButtonClass}>
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
