'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import {
  compactErrors,
  Field,
  FormAlert,
  inputClass,
  LengthMeter,
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
  MIN_PASSWORD_LENGTH,
  validateDisplayName,
  validateEmail,
  validateNewPassword,
  type MappedAuthError,
} from '../login/_shared/auth-logic';
import { DemoNotice, useAuthMode } from '../login/_shared/auth-mode';
import { AuthShell } from '../login/_shared/auth-shell';
import styles from '../login/_shared/auth-shell.module.css';
import { stateOptions } from '../login/_shared/options';

/** Sign up. Email and password first; name and state are optional and say so. */
export function RegisterForm({ next }: { next: string | null }) {
  const router = useRouter();
  const { user, loading, register, logout } = useAuth();
  const { demo, lenient } = useAuthMode();
  const target = next ?? DEFAULT_AFTER_LOGIN;
  const states = useMemo(() => stateOptions(), []);

  const form = useFormFields({ email: '', password: '', displayName: '', stateCode: '' }, (v) =>
    compactErrors({
      email: validateEmail(v.email, lenient),
      password: validateNewPassword(v.password, lenient),
      displayName: validateDisplayName(v.displayName),
      stateCode: null,
    }),
  );
  const { rootRef, requestFocus } = useErrorFocus();
  const [submitting, setSubmitting] = useState(false);
  const [problem, setProblem] = useState<MappedAuthError | null>(null);
  const [created, setCreated] = useState(false);

  const phase = created ? 'created' : !loading && user ? 'already' : 'form';
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
      const name = form.values.displayName.trim();
      await register({
        email: form.values.email.trim(),
        password: form.values.password,
        display_name: name || undefined,
        state_code: form.values.stateCode || undefined,
      });
      setCreated(true);
      router.push(target);
    } catch (err) {
      const mapped = mapAuthError(err, 'register');
      form.setServerErrors(mapped.fields);
      setProblem(mapped);
      requestFocus();
    } finally {
      setSubmitting(false);
    }
  }

  if (phase === 'created') {
    return (
      <AuthShell
        headingRef={headingRef}
        status={{ tone: 'ok', icon: <CheckIcon /> }}
        title="Account created"
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
        title="You already have an account"
        lede={
          <>
            You are signed in as <span className={styles.emailChip}>{user.email}</span>.
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
            Log out to create another account
          </button>
        </div>
      </AuthShell>
    );
  }

  const password = form.values.password;
  const passwordHint = lenient ? (
    demo ? (
      'Demo mode: any password works, even a short one.'
    ) : (
      `Use at least ${MIN_PASSWORD_LENGTH} characters.`
    )
  ) : password ? (
    <LengthMeter value={password} min={MIN_PASSWORD_LENGTH} />
  ) : (
    `Use at least ${MIN_PASSWORD_LENGTH} characters.`
  );

  return (
    <AuthShell
      headingRef={headingRef}
      eyebrow="Sign up"
      title="Create your account"
      lede="Free, and kept on this computer. An account saves your conversation history."
      busy={submitting}
      footer={
        <p>
          Already have an account?{' '}
          <Link href={authHref('/login', next)} className="link font-medium">
            Log in
          </Link>
        </p>
      }
      centerFooter
    >
      {demo && (
        <DemoNotice>
          Any email and any password works. If the account already exists you are simply signed in.
        </DemoNotice>
      )}

      <form
        ref={rootRef}
        onSubmit={onSubmit}
        noValidate
        method="post"
        className="flex flex-col gap-5"
      >
        <Field
          label="Email"
          error={form.errorFor('email')}
          errorAction={
            problem?.kind === 'email_taken' ? (
              <Link href={authHref('/login', next)} className="link whitespace-nowrap">
                Log in instead
              </Link>
            ) : undefined
          }
        >
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

        <PasswordField
          label="Password"
          {...form.bind('password')}
          error={form.errorFor('password')}
          autoComplete="new-password"
          required={!lenient}
          hint={passwordHint}
        />

        <p className={styles.sectionLabel}>About you</p>

        <div className={styles.pair}>
          <Field label="Name" optional error={form.errorFor('displayName')}>
            <input
              {...form.bind('displayName')}
              type="text"
              autoComplete="name"
              className={inputClass}
            />
          </Field>
          <Field label="State" optional error={form.errorFor('stateCode')}>
            <select {...form.bind('stateCode')} autoComplete="off" className={inputClass}>
              <option value="">Not set</option>
              {states.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <p className={`${styles.fineprint} -mt-2`}>
          Many rules, such as stamp duty and tenancy law, differ by state. You can change both later
          on your profile.
        </p>

        {problem?.form && (
          <FormAlert title={errorTitle(problem.kind, 'register')}>{problem.form}</FormAlert>
        )}

        <SubmitButton loading={submitting} loadingLabel="Creating account…">
          Create account
        </SubmitButton>

        <p className={styles.fineprint}>
          Legal Advisor gives general information about Indian law. It is not legal advice and does
          not make anyone your advocate.
        </p>
      </form>
    </AuthShell>
  );
}
