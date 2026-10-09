'use client';

import { InfoIcon, ShieldIcon } from '@/components/icons';
import { usePlatformStatus } from '@/lib/status-client';
import styles from './documents.module.css';

export type DraftingMode = 'ai' | 'offline' | 'unknown';

export interface DraftingInfo {
  mode: DraftingMode;
  /** True while the status request is still running. */
  loading: boolean;
  /** Advocate listings on this server that are synthetic samples. */
  sampleAdvocates: number;
}

/**
 * Whether this server writes drafts with an AI model or assembles templates. It
 * only changes the wording on the page: the result always follows the
 * `generation_mode` the create call returns.
 */
export function useDraftingInfo(): DraftingInfo {
  const { state } = usePlatformStatus();
  if (state.kind !== 'ready') {
    return { mode: 'unknown', loading: state.kind === 'loading', sampleAdvocates: 0 };
  }
  const llm = state.status.llm;
  const mode = llm.mode ?? (llm.configured ? 'ai' : 'offline');
  return {
    mode,
    loading: false,
    sampleAdvocates: state.status.advocate_directory.sample_advocates ?? 0,
  };
}

/** A short "how your draft is made" note that tells the truth about this setup. */
export function ModeNote({ mode, loading }: Pick<DraftingInfo, 'mode' | 'loading'>) {
  if (loading) {
    return (
      <div className={styles.mode} role="status">
        <InfoIcon />
        <div className="w-full">
          <span className="sr-only">Checking how drafts are made</span>
          <div className="skeleton mb-2 h-4 w-2/5" aria-hidden="true" />
          <div className="skeleton mb-1.5 h-3.5 w-full" aria-hidden="true" />
          <div className="skeleton h-3.5 w-4/5" aria-hidden="true" />
        </div>
      </div>
    );
  }

  if (mode === 'offline') {
    return (
      <div className={styles.mode}>
        <InfoIcon />
        <div>
          <p className={styles.modeTitle}>AI is off in this setup</p>
          <p className={styles.modeText}>
            Drafts are templates assembled from your answers and standard clauses, not written by an
            AI model. Anything we cannot fill in is marked{' '}
            <span className="blank">[LIKE THIS]</span> for you to complete.
          </p>
        </div>
      </div>
    );
  }

  if (mode === 'ai') {
    return (
      <div className={styles.mode}>
        <ShieldIcon />
        <div>
          <p className={styles.modeTitle}>Drafted by an AI model</p>
          <p className={styles.modeText}>
            An AI model writes the draft from your answers. It can make mistakes or leave out
            clauses that matter in your state, so have an advocate check it before you sign.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.mode}>
      <InfoIcon />
      <div>
        <p className={styles.modeTitle}>Every draft is a starting point</p>
        <p className={styles.modeText}>
          You get a labelled draft plus notes on stamping, registration and review. An advocate
          should check it before you sign anything.
        </p>
      </div>
    </div>
  );
}
