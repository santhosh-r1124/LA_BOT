'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from 'react';
import { ChipGroup, Field, FormMessage, PasswordInput, RuleCheck } from '@/components/form';
import { CheckIcon } from '@/components/icons';
import { useAuth } from '@/lib/auth-context';
import {
  LIMITS,
  REGISTER_FIELDS,
  mapServerError,
  toRegisterPayload,
  validateRegister,
  type FormValues,
  type RegisterField,
} from '@/lib/forms';
import { languageOptions, practiceAreaOptions, stateOptions } from '@/lib/options';
import { useFormErrors } from '@/lib/use-form-errors';
import styles from './register.module.css';

const EMPTY: FormValues = {
  email: '',
  password: '',
  displayName: '',
  stateCode: '',
  city: '',
  practiceAreas: [],
  languages: [],
  fee: '',
  experience: '',
  bio: '',
};

/** Element ids, so an error summary can focus the field it names. */
const IDS: Record<RegisterField, string> = {
  email: 'reg-email',
  password: 'reg-password',
  displayName: 'reg-name',
  stateCode: 'reg-state',
  city: 'reg-city',
  practiceAreas: 'reg-practice',
  languages: 'reg-languages',
  fee: 'reg-fee',
  experience: 'reg-experience',
  bio: 'reg-bio',
};

const LABELS: Record<RegisterField, string> = {
  email: 'Email',
  password: 'Password',
  displayName: 'Full name',
  stateCode: 'State',
  city: 'City',
  practiceAreas: 'Practice areas',
  languages: 'Languages',
  fee: 'Consultation fee',
  experience: 'Years of experience',
  bio: 'Short bio',
};

const SECTIONS = [
  { id: 'account', title: 'Account', need: 'Required' },
  { id: 'practice', title: 'Practice areas', need: 'Recommended' },
  { id: 'location', title: 'Location', need: 'Required' },
  { id: 'languages', title: 'Languages', need: 'Recommended' },
  { id: 'fee', title: 'Experience and fee', need: 'Optional' },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

const AFTER = [
  'You land on your profile page, signed in.',
  'An administrator reviews the profile. Until it is verified you are not in the public directory.',
  'The status on your profile changes to Verified, or Not approved with a note.',
];

const PRACTICE_OPTIONS = practiceAreaOptions();
const LANGUAGE_OPTIONS = languageOptions();
const STATE_OPTIONS = stateOptions();

export default function RegisterPage() {
  const router = useRouter();
  const { user, loading, registerAdvocate } = useAuth();

  const [values, setValues] = useState<FormValues>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const formErrorRef = useRef<HTMLDivElement>(null);
  const errors = useFormErrors(REGISTER_FIELDS, values);
  const { errorFor, touch, clearServer, submit, setServer } = errors;

  // Someone who is already signed in has no use for this page.
  useEffect(() => {
    if (!loading && user && !submitting) router.replace('/profile');
  }, [loading, user, submitting, router]);

  function set<K extends RegisterField>(key: K, value: FormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    clearServer(key);
  }

  const problems = REGISTER_FIELDS.filter((f) => errorFor(f) !== undefined);

  const done = useMemo<Record<SectionId, boolean>>(() => {
    const c = validateRegister(values);
    return {
      account: !c.email && !c.password && !c.displayName,
      practice: values.practiceAreas.length > 0,
      location: !c.stateCode && !c.city,
      languages: values.languages.length > 0,
      fee:
        Boolean(values.fee.trim() || values.experience.trim() || values.bio.trim()) &&
        !c.fee &&
        !c.experience &&
        !c.bio,
    };
  }, [values]);

  function focusField(field: RegisterField) {
    document.getElementById(IDS[field])?.focus();
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    const found = submit();
    if (REGISTER_FIELDS.some((f) => found[f])) {
      setShowSummary(true);
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    setShowSummary(false);
    setSubmitting(true);
    try {
      await registerAdvocate(toRegisterPayload(values));
      router.push('/profile');
    } catch (err) {
      const mapped = mapServerError(
        err,
        REGISTER_FIELDS,
        'Something went wrong and your profile was not created. Try again.',
      );
      setServer(mapped.fields);
      setFormError(mapped.form);
      setSubmitting(false);
      const hasFields = REGISTER_FIELDS.some((f) => mapped.fields[f]);
      setShowSummary(hasFields);
      requestAnimationFrame(() => {
        if (hasFields) summaryRef.current?.focus();
        else formErrorRef.current?.focus();
      });
    }
  }

  return (
    <main className="hero-bg" aria-busy={submitting || undefined}>
      <div className={styles.shell}>
        <div className={`rise-in ${styles.intro}`}>
          <div className={styles.introHead}>
            <p className="eyebrow eyebrow-rule">For advocates</p>
            <h1 className={`display ${styles.title}`}>Register as an advocate</h1>
            <p className={styles.lede}>
              Create your profile for the Legal Advisor directory. It takes a few minutes, and you
              can change every detail afterwards.
            </p>
          </div>

          <nav aria-label="Form sections" className={styles.toc}>
            <p className="caps">In this form</p>
            <ol className={styles.tocList}>
              {SECTIONS.map((s, i) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className={styles.tocLink} data-done={done[s.id]}>
                    <span className={styles.tocNum} aria-hidden="true">
                      {done[s.id] ? <CheckIcon /> : i + 1}
                    </span>
                    <span>{s.title}</span>
                    <span className={styles.tocState}>{done[s.id] ? 'Done' : s.need}</span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <details className={`surface-flat disclosure ${styles.disclosureBox}`}>
            <summary>What happens after you register</summary>
            <ol className={styles.afterList}>
              {AFTER.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ol>
          </details>
        </div>

        <form
          onSubmit={onSubmit}
          noValidate
          className={`surface rise-in ${styles.card}`}
          style={{ '--i': 1 } as CSSProperties}
          aria-label="Advocate registration"
        >
          {/* 1 · Account */}
          <section id="account" className={styles.section} aria-labelledby="account-title">
            <SectionHead n={1} id="account-title" title="Account">
              How you log in, and the name that appears on your profile.
            </SectionHead>
            <Field
              id={IDS.email}
              label="Email"
              error={errorFor('email')}
              hint="Shown on your public profile once you are verified, so people can contact you."
            >
              {(c) => (
                <input
                  {...c}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  value={values.email}
                  onChange={(e) => set('email', e.target.value)}
                  onBlur={() => touch('email')}
                  className="input"
                />
              )}
            </Field>
            <Field
              id={IDS.password}
              label="Password"
              error={errorFor('password')}
              hint={
                <RuleCheck met={values.password.length >= LIMITS.passwordMin}>
                  At least {LIMITS.passwordMin} characters
                </RuleCheck>
              }
            >
              {(c) => (
                <PasswordInput
                  {...c}
                  autoComplete="new-password"
                  required
                  value={values.password}
                  onChange={(e) => set('password', e.target.value)}
                  onBlur={() => touch('password')}
                />
              )}
            </Field>
            <Field
              id={IDS.displayName}
              label="Full name"
              error={errorFor('displayName')}
              hint="As you want it to appear in the directory."
            >
              {(c) => (
                <input
                  {...c}
                  type="text"
                  autoComplete="name"
                  required
                  value={values.displayName}
                  onChange={(e) => set('displayName', e.target.value)}
                  onBlur={() => touch('displayName')}
                  className="input"
                />
              )}
            </Field>
          </section>

          {/* 2 · Practice areas */}
          <section id="practice" className={styles.section} aria-labelledby="practice-title">
            <SectionHead n={2} id="practice-title" title="Practice areas">
              The kinds of matter you take. People search the directory by legal topic.
            </SectionHead>
            <ChipGroup
              id={IDS.practiceAreas}
              legend="Choose all that apply"
              describe="practice areas"
              options={PRACTICE_OPTIONS}
              value={values.practiceAreas}
              onChange={(next) => set('practiceAreas', next)}
              error={errorFor('practiceAreas')}
            />
          </section>

          {/* 3 · Location */}
          <section id="location" className={styles.section} aria-labelledby="location-title">
            <SectionHead n={3} id="location-title" title="Location">
              Where you practise. People filter the directory by state and city.
            </SectionHead>
            <div className={styles.twoCol}>
              <Field
                id={IDS.stateCode}
                label="State or union territory"
                error={errorFor('stateCode')}
              >
                {(c) => (
                  <select
                    {...c}
                    required
                    value={values.stateCode}
                    onChange={(e) => set('stateCode', e.target.value)}
                    onBlur={() => touch('stateCode')}
                    className="input select"
                  >
                    <option value="">Choose one</option>
                    {STATE_OPTIONS.map((o) => (
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
                    required
                    value={values.city}
                    onChange={(e) => set('city', e.target.value)}
                    onBlur={() => touch('city')}
                    className="input"
                  />
                )}
              </Field>
            </div>
          </section>

          {/* 4 · Languages */}
          <section id="languages" className={styles.section} aria-labelledby="languages-title">
            <SectionHead n={4} id="languages-title" title="Languages">
              The languages you can advise in. Clients look for someone who speaks theirs.
            </SectionHead>
            <ChipGroup
              id={IDS.languages}
              legend="Choose all that apply"
              describe="languages"
              options={LANGUAGE_OPTIONS}
              value={values.languages}
              onChange={(next) => set('languages', next)}
              error={errorFor('languages')}
            />
          </section>

          {/* 5 · Experience, fee and bio */}
          <section id="fee" className={styles.section} aria-labelledby="fee-title">
            <SectionHead n={5} id="fee-title" title="Experience and fee">
              All optional. Add them now or later from your profile.
            </SectionHead>
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
            <Field
              id={IDS.bio}
              label="Short bio"
              optional
              error={errorFor('bio')}
              hint={
                <span
                  className={values.bio.length > LIMITS.bioMax ? styles.countOver : styles.count}
                >
                  {values.bio.length} of {LIMITS.bioMax} characters
                </span>
              }
            >
              {(c) => (
                <textarea
                  {...c}
                  rows={4}
                  value={values.bio}
                  onChange={(e) => set('bio', e.target.value)}
                  onBlur={() => touch('bio')}
                  className="input textarea"
                />
              )}
            </Field>
          </section>

          <div className={styles.submitArea}>
            {showSummary && problems.length > 0 && (
              <FormMessage
                tone="danger"
                title={`Fix ${problems.length} ${problems.length === 1 ? 'field' : 'fields'} before you register`}
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
                          focusField(f);
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
              <FormMessage
                tone="danger"
                title="Your profile was not created"
                messageRef={formErrorRef}
              >
                <p>{formError}</p>
              </FormMessage>
            )}

            <button
              type="submit"
              className="btn btn-primary btn-lg btn-block"
              aria-busy={submitting || undefined}
              disabled={submitting}
            >
              {submitting ? 'Creating your profile' : 'Register'}
            </button>
            <p className={styles.fineprint}>
              By registering you confirm these details are accurate. An administrator may not
              approve a profile it cannot verify.
            </p>
            <p className={styles.alreadyRegistered}>
              Already registered?{' '}
              <Link href="/login" className="link font-medium">
                Log in
              </Link>
            </p>
          </div>
        </form>
      </div>
    </main>
  );
}

function SectionHead({
  n,
  id,
  title,
  children,
}: {
  n: number;
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.sectionHead}>
      <span className={styles.sectionNum} aria-hidden="true">
        {n}
      </span>
      <div>
        <h2 id={id} className={styles.sectionTitle}>
          {title}
        </h2>
        <p className={styles.sectionLede}>{children}</p>
      </div>
    </div>
  );
}
