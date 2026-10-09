import type { ReactNode } from 'react';
import {
  AlertIcon,
  CheckIcon,
  CloseIcon,
  ExternalLinkIcon,
  InfoIcon,
  RefreshIcon,
  ShieldIcon,
  type IconComponent,
} from '@/components/icons';
import { CircleIcon, ClockIcon } from '@/components/portal-icons';
import { DIRECTORY_URL } from '@/lib/links';
import {
  statusInfo,
  stepCaption,
  stepStates,
  STEP_LABELS,
  type StepState,
  type Tone,
} from '@/lib/verification';
import styles from './status.module.css';

const BADGE: Record<Tone, string> = {
  ok: 'badge-ok',
  warn: 'badge-warn',
  danger: 'badge-danger',
  accent: 'badge-accent',
  neutral: '',
};

const TONE: Record<Tone, string> = {
  ok: styles.toneOk ?? '',
  warn: styles.toneWarn ?? '',
  danger: styles.toneDanger ?? '',
  accent: styles.toneAccent ?? '',
  neutral: styles.toneNeutral ?? '',
};

const TONE_ICON: Record<Tone, IconComponent> = {
  ok: ShieldIcon,
  warn: ClockIcon,
  accent: ClockIcon,
  danger: AlertIcon,
  neutral: InfoIcon,
};

const STEP_ICON: Record<StepState, IconComponent> = {
  done: CheckIcon,
  current: ClockIcon,
  failed: CloseIcon,
  todo: CircleIcon,
};

/** The status as a pill. The word is always there; the dot only adds to it. */
export function StatusBadge({ status, small }: { status: string; small?: boolean }) {
  const info = statusInfo(status);
  return (
    <span className={`badge ${small ? 'badge-sm' : ''} ${BADGE[info.tone]}`.trim()}>
      <span className="dot" aria-hidden="true" />
      {info.label}
    </span>
  );
}

/**
 * The verification panel: where the profile stands, what that means in plain
 * words, the three steps, and what to do next. For a rejected profile it also
 * quotes the reviewer's note.
 */
export function VerificationPanel({
  status,
  note,
  headingLevel = 2,
  actions,
  headingId = 'verification-heading',
}: {
  status: string;
  note?: string | null;
  headingLevel?: 2 | 3;
  actions?: ReactNode;
  headingId?: string;
}) {
  const info = statusInfo(status);
  const states = stepStates(status);
  const Icon = TONE_ICON[info.tone];
  const Heading = `h${headingLevel}` as 'h2' | 'h3';

  return (
    <section className={`surface ${styles.panel} ${TONE[info.tone]}`} aria-labelledby={headingId}>
      <div className={styles.head}>
        <span className={styles.medallion} aria-hidden="true">
          <Icon />
        </span>
        <div className={styles.headText}>
          <div className={styles.kicker}>
            <span className="caps">Directory verification</span>
            <StatusBadge status={status} small />
          </div>
          <Heading id={headingId} className={styles.heading}>
            {info.headline}
          </Heading>
        </div>
      </div>

      <p className={styles.explain}>{info.explain}</p>

      {status === 'REJECTED' && (
        <blockquote className={styles.note}>
          <span className={styles.noteLabel}>Reviewer note</span>
          <p className={styles.noteBody}>
            {note?.trim() ? note : 'The reviewer did not leave a note.'}
          </p>
        </blockquote>
      )}

      <ol className={styles.steps} aria-label="Verification steps">
        {STEP_LABELS.map((label, i) => {
          const state = states[i] ?? 'todo';
          const StepIcon = STEP_ICON[state];
          return (
            <li key={label} className={styles.step} data-state={state}>
              <span className={styles.marker} aria-hidden="true">
                <StepIcon />
              </span>
              <span className={styles.stepText}>
                <span className={styles.stepLabel}>{label}</span>
                <span className={styles.stepCaption}>{stepCaption(state, status, i)}</span>
              </span>
            </li>
          );
        })}
      </ol>

      <p className={styles.next}>
        <InfoIcon />
        <span>{info.next}</span>
      </p>

      {(actions || info.listed) && (
        <div className={styles.actions}>
          {actions}
          {info.listed && (
            <a
              href={DIRECTORY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary"
            >
              See the public directory
              <ExternalLinkIcon />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
        </div>
      )}
    </section>
  );
}

/** "Check status" button with its own busy state and the time of the last check. */
export function CheckStatusButton({
  onClick,
  busy,
  checkedAt,
}: {
  onClick: () => void;
  busy: boolean;
  checkedAt: Date | null;
}) {
  return (
    <>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={onClick}
        aria-busy={busy || undefined}
        disabled={busy}
      >
        <RefreshIcon />
        {busy ? 'Checking' : 'Check status'}
      </button>
      {checkedAt && (
        <span className={styles.checked} role="status">
          Checked at {checkedAt.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}
        </span>
      )}
    </>
  );
}
