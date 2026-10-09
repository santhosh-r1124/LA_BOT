import styles from '../directory.module.css';
import { AdvocateRowSkeleton } from './advocate-row';

/**
 * What the directory looks like for the instant the server spends fetching the
 * filter counts. It has the same frame as the real page (header, filter panel,
 * a full page of listings), and is tall enough to keep the footer below the fold,
 * so the footer does not jump when the page arrives.
 */
export function DirectoryLoading() {
  return (
    <main className={`page ${styles.loadingPage}`} aria-busy="true">
      <div role="status">
        <span className="sr-only">Loading the advocate directory</span>
      </div>

      <div className={styles.hero} aria-hidden="true">
        <div className="flex flex-col gap-3">
          <div className="skeleton h-3 w-32" />
          <div className="skeleton h-11 w-3/5 max-w-sm" />
          <div className="skeleton h-5 w-4/5 max-w-lg" />
        </div>
      </div>

      <div className={styles.layout} aria-hidden="true">
        <div className={styles.rail}>
          <div className={`skeleton ${styles.skToggle}`} />
          <div className={`surface ${styles.skPanel}`}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex flex-col gap-2">
                <div className="skeleton h-3.5 w-24" />
                <div className="skeleton h-11 w-full" />
              </div>
            ))}
          </div>
        </div>
        <div className="min-w-0">
          <div className="skeleton h-9 w-48" />
          <ul className={styles.list}>
            {Array.from({ length: 10 }, (_, i) => (
              <AdvocateRowSkeleton key={i} />
            ))}
          </ul>
        </div>
      </div>
    </main>
  );
}
