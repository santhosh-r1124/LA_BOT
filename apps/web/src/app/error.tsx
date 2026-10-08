'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { AlertIcon, HomeIcon, RefreshIcon } from '@/components/icons';

/**
 * Route-level error boundary. Shows a calm, plain message and a way forward.
 * It never prints the error message or a stack trace; the optional reference
 * (`digest`) is what you would quote when looking the error up in the server log.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    // The details go to the console for whoever is running the app.
    console.error('[legal-advisor] page error', error);
    headingRef.current?.focus();
  }, [error]);

  return (
    <main className="page page-narrow flex flex-col items-start gap-6 pb-16 pt-14 sm:pt-20">
      <span className="border-danger-line bg-danger-bg text-danger rounded-item grid size-12 place-items-center border">
        <AlertIcon className="size-6" />
      </span>
      <div className="flex flex-col gap-3">
        <p className="eyebrow eyebrow-rule">Something went wrong</p>
        <h1 ref={headingRef} tabIndex={-1} className="display display-md outline-none">
          This page ran into a problem.
        </h1>
        <p className="lede">
          Try again. If it keeps happening, go back to the home page and start from there.
        </p>
      </div>

      <div className="cluster">
        <button type="button" onClick={reset} className="btn btn-primary btn-lg">
          <RefreshIcon />
          Try again
        </button>
        <Link href="/" className="btn btn-secondary btn-lg">
          <HomeIcon />
          Home page
        </Link>
      </div>

      {error.digest && (
        <p className="subtle text-xs">
          Reference: <span className="tag">{error.digest}</span>
        </p>
      )}
    </main>
  );
}
