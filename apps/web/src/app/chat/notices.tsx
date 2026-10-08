'use client';

import { AlertIcon, ChevronDownIcon, InfoIcon } from '@/components/icons';
import styles from './chat.module.css';

/**
 * Persistent, calm notice for the offline setup. It states what the user will
 * get ("matching passages") rather than warning about what is missing, and
 * keeps the longer explanation one click away.
 */
export function ModeNotice({ details }: { details: string[] }) {
  return (
    <div className={styles.notice} role="status">
      <InfoIcon className={styles.noticeIcon} />
      <div className={styles.noticeBody}>
        <p>
          <strong>AI answers are off</strong> &ndash; showing matching passages from the legal library.
        </p>
        <details className={styles.noticeMore}>
          <summary>
            What this means
            <ChevronDownIcon />
          </summary>
          <ul className={styles.noticeList}>
            {details.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
      </div>
    </div>
  );
}

/** The status call is still in flight: hold the space so the page does not jump. */
export function NoticeSkeleton() {
  return (
    <div role="status">
      <span className="sr-only">Checking the setup</span>
      <div className="skeleton skeleton-block h-[3.1rem]" aria-hidden="true" />
    </div>
  );
}

export function StatusErrorNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <div className={`${styles.notice} ${styles.noticeWarn}`} role="status">
      <AlertIcon className={styles.noticeIcon} />
      <div className={styles.noticeBody}>
        <p>
          <strong>Can&apos;t reach the Legal Advisor service.</strong> Questions may fail until it is running again.
        </p>
        <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={onRetry}>
          Check again
        </button>
      </div>
    </div>
  );
}

export function EmptyLibraryNotice({ children }: { children: string }) {
  return (
    <div className={`${styles.notice} ${styles.noticeWarn}`} role="status">
      <AlertIcon className={styles.noticeIcon} />
      <div className={styles.noticeBody}>
        <p>
          <strong>The legal library is empty.</strong> {children}
        </p>
      </div>
    </div>
  );
}
