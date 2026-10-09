'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertIcon, CloseIcon } from '@/components/icons';
import { formatCount } from '@/lib/format';
import { legacyNoticeDismissed, rememberNoticeDismissed } from './notice-cookie';

/**
 * Whether the directory-wide "these are samples" notice has been dismissed.
 * `initial` comes from the server (it reads the cookie), so the first paint is
 * already right. A dismissal saved by the old localStorage version is picked up
 * once on mount and moved to the cookie.
 */
export function useSampleNoticeDismissed(initial: boolean): [boolean, () => void] {
  const [dismissed, setDismissed] = useState(initial);
  useEffect(() => {
    if (!initial && legacyNoticeDismissed()) {
      setDismissed(true);
      rememberNoticeDismissed();
    }
  }, [initial]);
  const dismiss = useCallback(() => {
    setDismissed(true);
    rememberNoticeDismissed();
  }, []);
  return [dismissed, dismiss];
}

/** Compact, dismissible honesty notice. The per-listing badges always stay. */
export function SampleNotice({
  sampleCount,
  total,
  onDismiss,
}: {
  sampleCount: number;
  total: number;
  onDismiss: () => void;
}) {
  const all = total > 0 && sampleCount >= total;
  return (
    <div className="alert alert-warn" role="note" data-testid="sample-notice">
      <AlertIcon />
      <p className="min-w-0 flex-1 text-sm leading-relaxed">
        <strong className="alert-title">
          {all
            ? `All ${formatCount(total)} listings are samples.`
            : `${formatCount(sampleCount)} of ${formatCount(total)} listings are samples.`}
        </strong>{' '}
        <span className="muted">
          They are synthetic records, not real advocates, and their contact details do not work.
          Do not rely on them for legal help.
        </span>
      </p>
      <button
        type="button"
        className="btn btn-ghost btn-icon -my-2 -mr-2.5 size-11 shrink-0"
        onClick={onDismiss}
        aria-label="Dismiss the sample data notice"
      >
        <CloseIcon />
      </button>
    </div>
  );
}
