'use client';

import Link from 'next/link';
import { AlertIcon, InfoIcon, RefreshIcon } from '@/components/icons';
import { NETWORK_MESSAGE } from '@/lib/forms';
import { useAuth } from '@/lib/auth-context';

/**
 * Shown when a saved login exists but the API did not answer. The saved login is
 * kept, so retrying picks the session back up with nothing lost.
 */
export function SessionErrorPanel() {
  const { retrySession, loading } = useAuth();
  return (
    <div className="page page-narrow">
      <div className="alert alert-danger" role="alert">
        <AlertIcon />
        <div className="flex flex-col gap-3">
          <div>
            <p className="alert-title">We could not check your login</p>
            <p>{NETWORK_MESSAGE} You are still signed in.</p>
          </div>
          <div>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void retrySession()}
              aria-busy={loading || undefined}
              disabled={loading}
            >
              <RefreshIcon />
              {loading ? 'Trying again' : 'Try again'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Placeholder with the shape of a signed-in page while the session loads. */
export function PageSkeleton() {
  return (
    <div className="page" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading your account</span>
      <div className="flex flex-col gap-3" aria-hidden="true">
        <div className="skeleton h-3.5 w-24" />
        <div className="skeleton h-9 w-full max-w-md" />
        <div className="skeleton h-4 w-64 max-w-full" />
      </div>
      <div className="skeleton skeleton-block mt-8 h-72 w-full" aria-hidden="true" />
      <div className="mt-6 grid gap-4 md:grid-cols-2" aria-hidden="true">
        <div className="skeleton skeleton-block h-64" />
        <div className="skeleton skeleton-block h-64" />
      </div>
    </div>
  );
}

/**
 * Shown on a signed-in page when the session ends while it is open: the person
 * logged out in another tab, or the saved login expired and could not be renewed.
 */
export function SignedOutNotice() {
  return (
    <div className="page page-narrow">
      <div className="alert alert-info" role="status">
        <InfoIcon />
        <div className="flex flex-col gap-3">
          <div>
            <p className="alert-title">You are logged out</p>
            <p>Log in again to pick up where you left off. Nothing you saved has been lost.</p>
          </div>
          <div className="btn-group">
            <Link href="/login" className="btn btn-primary">
              Log in
            </Link>
            <Link href="/" className="btn btn-secondary">
              Go to the overview
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
