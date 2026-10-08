'use client';

import { INDIAN_STATES } from '@legal-platform/shared';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { AlertIcon, ArrowRightIcon, CheckIcon, InfoIcon } from '@/components/icons';
import type { DocumentFailure, DocumentTypeInfoOut, QuestionOut } from '@/lib/document-client';
import { stateName } from '@/lib/format';
import { ArrowLeftGlyph } from './doc-icons';
import { fieldMeta, groupQuestions, typeLabel, typeMeta } from './doc-types';
import styles from './documents.module.css';
import {
  buildPayload,
  isBlank,
  layoutFields,
  missingRequired,
  plural,
  progressOf,
  requiredMessage,
} from './form-helpers';
import { ModeNote, type DraftingInfo } from './mode-note';

const STATE_OPTIONS = [...INDIAN_STATES].sort((a, b) => stateName(a).localeCompare(stateName(b)));

const MUTUAL_CHOICES = [
  { value: 'Mutual', title: 'Mutual', note: 'Both sides share information.' },
  { value: 'One-way', title: 'One-way', note: 'Only the disclosing party shares.' },
  { value: '', title: 'Not sure yet', note: 'Leave it open for the advocate.' },
];

const WIDE_QUERY = '(min-width: 1024px)';

function subscribeWide(onChange: () => void) {
  const query = window.matchMedia(WIDE_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/** True at the width where the side rail has room (matches the CSS breakpoint). */
function useIsWide(): boolean {
  return useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE_QUERY).matches,
    () => false,
  );
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Move keyboard focus to a question's control and bring it to the middle of the screen. */
function focusQuestion(key: string) {
  const el = document.getElementById(`q-${key}`);
  if (!el) return;
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

// ---------------------------------------------------------------------------
// One question
// ---------------------------------------------------------------------------

function QuestionField({
  documentType,
  question,
  value,
  error,
  onChange,
  onBlur,
}: {
  documentType: string;
  question: QuestionOut;
  value: string;
  error: string | null;
  onChange: (value: string) => void;
  onBlur: () => void;
}) {
  const meta = fieldMeta(documentType, question.key);
  const id = `q-${question.key}`;
  const hint = question.help_text ?? meta.hint ?? null;
  const describedBy = [hint ? `h-${question.key}` : '', error ? `e-${question.key}` : '']
    .filter(Boolean)
    .join(' ');
  const common = {
    id,
    required: question.required,
    'aria-invalid': error ? (true as const) : undefined,
    'aria-describedby': describedBy || undefined,
    onBlur,
  };

  const marker = question.required ? (
    <>
      <span className={styles.req} aria-hidden="true">
        *
      </span>
      <span className="sr-only"> (required)</span>
    </>
  ) : (
    <span className={styles.optional}> (optional)</span>
  );

  const hintEl = hint ? (
    <span id={`h-${question.key}`} className="hint">
      {hint}
    </span>
  ) : null;

  const errorEl = error ? (
    <span id={`e-${question.key}`} className="field-error">
      <AlertIcon className="mt-0.5 size-3.5 shrink-0" />
      <span>{error}</span>
    </span>
  ) : null;

  if (meta.kind === 'mutual') {
    return (
      <fieldset
        className="field m-0 min-w-0 border-0 p-0"
        aria-describedby={describedBy || undefined}
      >
        <legend className="label mb-1.5 p-0">
          {question.label}
          {marker}
        </legend>
        {hintEl}
        <div className={styles.choices}>
          {MUTUAL_CHOICES.map((choice, i) => (
            <label key={choice.title} className={styles.choiceCard}>
              <input
                type="radio"
                name={id}
                id={i === 0 ? id : undefined}
                className="radio mt-0.5"
                value={choice.value}
                checked={value === choice.value}
                onChange={() => onChange(choice.value)}
              />
              <span>
                <span className={styles.choiceTitle}>{choice.title}</span>
                <span className={styles.choiceNote}>{choice.note}</span>
              </span>
            </label>
          ))}
        </div>
        {errorEl}
      </fieldset>
    );
  }

  let control;
  if (meta.kind === 'state') {
    control = (
      <select
        {...common}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input"
      >
        <option value="">Select a state or union territory</option>
        {STATE_OPTIONS.map((code) => (
          <option key={code} value={code}>
            {stateName(code)}
          </option>
        ))}
      </select>
    );
  } else if (meta.kind === 'long') {
    const rows = meta.rows ?? 3;
    control = (
      <textarea
        {...common}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={meta.placeholder}
        autoComplete={meta.autoComplete ?? 'off'}
        className={`input ${rows <= 3 ? styles.compact : ''}`.trim()}
      />
    );
  } else if (meta.kind === 'money' || meta.kind === 'months') {
    const money = meta.kind === 'money';
    control = (
      <div className={styles.affix}>
        {money && (
          <span className={styles.affixPrefix} aria-hidden="true">
            ₹
          </span>
        )}
        <input
          {...common}
          type="text"
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={meta.placeholder}
          autoComplete="off"
          className={`input ${money ? styles.withPrefix : styles.withSuffix}`}
        />
        {!money && (
          <span className={styles.affixSuffix} aria-hidden="true">
            months
          </span>
        )}
      </div>
    );
  } else {
    control = (
      <input
        {...common}
        type={meta.kind === 'date' ? 'date' : 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={meta.placeholder}
        autoComplete={meta.autoComplete ?? 'off'}
        className="input"
      />
    );
  }

  return (
    <div className="field">
      <label htmlFor={id} className="label">
        {question.label}
        {marker}
      </label>
      {hintEl}
      {control}
      {errorEl}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Failure banner with an optional retry countdown
// ---------------------------------------------------------------------------

function FailureNotice({
  failure,
  busy,
  onRetry,
}: {
  failure: DocumentFailure;
  busy: boolean;
  onRetry: () => void;
}) {
  const [left, setLeft] = useState(failure.retryAfterSeconds ?? 0);

  useEffect(() => {
    setLeft(failure.retryAfterSeconds ?? 0);
  }, [failure]);

  useEffect(() => {
    if (left <= 0) return;
    const timer = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [left]);

  const canRetry = failure.kind !== 'invalid';
  return (
    <div className={`alert alert-danger ${styles.failureAlert}`} data-testid="draft-failure">
      <AlertIcon />
      <div className={styles.failureBody}>
        <div role="alert">
          <p className="alert-title">{failure.title}</p>
          <p className="muted mt-0.5">{failure.message}</p>
        </div>
      </div>
      {canRetry && (
        <div className={styles.failureAction}>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={left > 0 || busy}
            onClick={onRetry}
          >
            {left > 0 ? `Try again in ${left}s` : 'Try again'}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Side information (desktop rail, and inline on small screens)
// ---------------------------------------------------------------------------

function AnswersNote() {
  return (
    <p className={styles.asideNote}>
      Your answers are sent to this app&apos;s server to build the draft and are stored with it.
      Leave out anything you would rather not have stored, such as ID numbers: add those by hand
      afterwards.
    </p>
  );
}

// ---------------------------------------------------------------------------
// The questionnaire
// ---------------------------------------------------------------------------

export interface QuestionnaireProps {
  info: DocumentTypeInfoOut;
  answers: Record<string, string>;
  onChange: (key: string, value: string) => void;
  onSubmit: (payload: Record<string, string>) => void;
  onClear: () => void;
  submitting: boolean;
  failure: DocumentFailure | null;
  drafting: DraftingInfo;
}

export function Questionnaire({
  info,
  answers,
  onChange,
  onSubmit,
  onClear,
  submitting,
  failure,
  drafting,
}: QuestionnaireProps) {
  const isWide = useIsWide();
  const [attempted, setAttempted] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const failureRef = useRef<HTMLDivElement>(null);
  // The answers as they were when the last request failed, to tell which have changed since.
  const [failedAnswers, setFailedAnswers] = useState<Record<string, string>>({});
  const [focusRequest, setFocusRequest] = useState<{ key: string; n: number } | null>(null);

  const meta = typeMeta(info.document_type);
  const label = typeLabel(info.document_type);
  const groups = useMemo(
    () => groupQuestions(info.document_type, info.questions),
    [info.document_type, info.questions],
  );
  const missing = missingRequired(info.questions, answers);
  const progress = progressOf(info.questions, answers);
  const requiredQuestions = info.questions.filter((q) => q.required);
  const anyAnswer = info.questions.some((q) => !isBlank(answers[q.key]));

  // Keep anything the browser scrolls to (a newly focused field, the failure notice, a "jump to
  // this question" link) clear of the sticky site header and the sticky submit bar below the
  // form (WCAG 2.2 "Focus Not Obscured"). Chrome does not scroll a half-visible field, so a
  // per-element scroll margin is not enough; scroll-padding on the page shrinks the region it
  // treats as visible. Set only while this form is mounted, and put back on the way out.
  useEffect(() => {
    const root = document.documentElement;
    const previous = {
      top: root.style.scrollPaddingTop,
      bottom: root.style.scrollPaddingBottom,
    };
    root.style.scrollPaddingTop = 'calc(var(--header-h) + 1rem)';
    root.style.scrollPaddingBottom = '6.5rem';
    return () => {
      root.style.scrollPaddingTop = previous.top;
      root.style.scrollPaddingBottom = previous.bottom;
    };
  }, []);

  useEffect(() => {
    if (failure) setFailedAnswers(answers);
    // Only a new failure takes a snapshot, not every keystroke afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failure]);

  // A failed request is announced at the top of the form; make sure it is on screen, since the
  // person pressed the button on the bar at the bottom.
  useEffect(() => {
    if (failure) {
      failureRef.current?.scrollIntoView({
        block: 'nearest',
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      });
    }
  }, [failure]);

  // Focus after the render that shows the errors, so the page does not jump under the cursor.
  useEffect(() => {
    if (focusRequest) focusQuestion(focusRequest.key);
  }, [focusRequest]);

  function errorFor(q: QuestionOut): string | null {
    const blank = isBlank(answers[q.key]);
    const serverMessage = failure?.fieldErrors[q.key];
    // A server complaint stands until that answer is changed.
    if (serverMessage && (answers[q.key] ?? '') === (failedAnswers[q.key] ?? '')) {
      return serverMessage;
    }
    if (q.required && blank && (attempted || touched[q.key])) {
      return requiredMessage(fieldMeta(info.document_type, q.key).kind);
    }
    return null;
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setAttempted(true);
    const first = missing[0];
    if (first) {
      setFocusRequest({ key: first.key, n: Date.now() });
      return;
    }
    onSubmit(buildPayload(info.document_type, info.questions, answers));
  }

  const total = info.questions.length;
  const requiredCount = requiredQuestions.length;

  return (
    <>
      <header className={styles.intro}>
        <div className="flex max-w-2xl flex-col gap-2">
          <Link href="/documents" className="btn btn-ghost -ml-2 w-fit">
            <ArrowLeftGlyph />
            All document types
          </Link>
          <span className="eyebrow eyebrow-rule">Document assistant</span>
          <h1 id="doc-heading" tabIndex={-1} className="display display-sm outline-none">
            {label}
          </h1>
          <p className="muted max-w-[60ch]">{meta.description}</p>
          <p className="subtle text-sm">
            {total} {plural(total, 'question')}, {requiredCount} required. Fields marked{' '}
            <span className={styles.req} aria-hidden="true">
              *
            </span>
            <span className="sr-only">with an asterisk</span> are required.
          </p>
        </div>
      </header>

      <div className={styles.formLayout}>
        <div className={styles.formMain}>
          {!isWide && (
            <details className={`disclosure ${styles.infoDetails}`}>
              <summary>
                <InfoIcon />
                <span>
                  {drafting.mode === 'offline'
                    ? 'AI is off: your draft will be a template'
                    : drafting.mode === 'ai'
                      ? 'An AI model will write your draft'
                      : 'How your draft is made'}
                </span>
              </summary>
              <div className={`${styles.infoBody} flex flex-col gap-3`}>
                <ModeNote mode={drafting.mode} loading={drafting.loading} />
                <AnswersNote />
              </div>
            </details>
          )}
          <form
            id="doc-form"
            noValidate
            className={styles.formStack}
            aria-label={`${label} questions`}
            onSubmit={handleSubmit}
          >
            {failure && (
              <div ref={failureRef} className={styles.failureWrap}>
                <FailureNotice
                  failure={failure}
                  busy={submitting}
                  onRetry={() =>
                    onSubmit(buildPayload(info.document_type, info.questions, answers))
                  }
                />
              </div>
            )}

            {attempted && missing.length > 0 && (
              <div className="alert alert-danger" data-testid="required-summary">
                <AlertIcon />
                <div className={styles.summary}>
                  <p className="alert-title">
                    {missing.length} required {plural(missing.length, 'answer')} still empty
                  </p>
                  <ul>
                    {missing.map((q) => (
                      <li key={q.key}>
                        <button
                          type="button"
                          className={styles.summaryLink}
                          onClick={() => focusQuestion(q.key)}
                        >
                          {q.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {groups.map((group, groupIndex) => (
              <section
                key={group.id}
                className={styles.group}
                aria-labelledby={`group-${group.id}`}
              >
                <div className={styles.groupHead}>
                  {groups.length > 1 && (
                    <span className={styles.groupNum} aria-hidden="true">
                      {String(groupIndex + 1).padStart(2, '0')}
                    </span>
                  )}
                  <h2 id={`group-${group.id}`} className={styles.groupTitle}>
                    {group.title}
                  </h2>
                </div>
                {group.description && <p className={styles.groupDesc}>{group.description}</p>}
                <div className={styles.fields}>
                  {layoutFields(info.document_type, group.questions).map(({ question, wide }) => (
                    <div key={question.key} className={wide ? styles.wide : undefined}>
                      <QuestionField
                        documentType={info.document_type}
                        question={question}
                        value={answers[question.key] ?? ''}
                        error={errorFor(question)}
                        onChange={(value) => onChange(question.key, value)}
                        onBlur={() => setTouched((prev) => ({ ...prev, [question.key]: true }))}
                      />
                    </div>
                  ))}
                </div>
              </section>
            ))}

            <div className={styles.footerRow}>
              <button
                type="button"
                className="btn btn-ghost -ml-2"
                disabled={!anyAnswer || submitting}
                onClick={() => {
                  onClear();
                  setAttempted(false);
                  setTouched({});
                }}
              >
                Clear answers
              </button>
              <p className="subtle text-xs">Nothing is sent until you press Generate draft.</p>
            </div>

            <div className={styles.bar}>
              <div className={styles.meter}>
                <span className={styles.meterText}>
                  {progress.complete && progress.total > 0 ? (
                    <>
                      <CheckIcon />
                      <span>
                        <strong>All {progress.total}</strong> required answered
                      </span>
                    </>
                  ) : (
                    <span>
                      <strong>{progress.answered}</strong> of {progress.total} required answered
                    </span>
                  )}
                </span>
                <div
                  className={styles.track}
                  role="progressbar"
                  aria-label="Required questions answered"
                  aria-valuemin={0}
                  aria-valuemax={progress.total}
                  aria-valuenow={progress.answered}
                >
                  <span className={styles.fill} style={{ width: `${progress.percent}%` }} />
                </div>
              </div>
              <button
                type="submit"
                className="btn btn-primary shrink-0"
                aria-busy={submitting || undefined}
              >
                {submitting ? 'Drafting…' : 'Generate draft'}
                {!submitting && <ArrowRightIcon />}
              </button>
            </div>
          </form>
        </div>

        {isWide && (
          <aside className={styles.aside} aria-label="Progress and how drafts are made">
            <div className={styles.panel}>
              <div className={styles.panelHead}>
                <h2 className={styles.panelTitle}>Required answers</h2>
                <span className={styles.panelCount}>
                  {progress.answered}
                  <small> / {progress.total}</small>
                </span>
              </div>
              <ul className={styles.reqList}>
                {requiredQuestions.map((q) => {
                  const done = !isBlank(answers[q.key]);
                  return (
                    <li key={q.key}>
                      <button
                        type="button"
                        className={`${styles.reqItem} ${done ? styles.reqDone : ''}`.trim()}
                        onClick={() => focusQuestion(q.key)}
                      >
                        <span className={styles.reqMark} aria-hidden="true">
                          {done && <CheckIcon />}
                        </span>
                        <span>
                          {q.label}
                          <span className="sr-only">
                            {done ? ' (answered)' : ' (not answered)'}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
            <ModeNote mode={drafting.mode} loading={drafting.loading} />
            <AnswersNote />
          </aside>
        )}
      </div>
    </>
  );
}
