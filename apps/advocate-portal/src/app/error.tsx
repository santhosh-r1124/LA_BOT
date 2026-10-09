'use client';

import Link from 'next/link';
import { AlertIcon, RefreshIcon } from '@/components/icons';

/** Last-resort error screen. It never shows the error itself, only what to do. */
export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="page page-narrow">
      <div className="alert alert-danger" role="alert">
        <AlertIcon />
        <div className="flex flex-col gap-3">
          <div>
            <p className="alert-title">Something went wrong on this page</p>
            <p>
              The page could not be shown. Nothing you saved has been lost. Try again, and if it
              keeps happening, go back to the overview.
            </p>
          </div>
          <div className="btn-group">
            <button type="button" className="btn btn-secondary" onClick={reset}>
              <RefreshIcon />
              Try again
            </button>
            <Link href="/" className="btn btn-ghost">
              Go to the overview
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
