'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertIcon, CloseIcon } from '@/components/icons';
import { formatCount } from '@/lib/format';

const STORAGE_KEY = 'la-advocates-sample-notice';

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'dismissed';
  } catch {
    return false; // storage blocked: just show the notice every time
  }
}

/**
 * Whether the directory-wide "these are samples" notice has been dismissed.
 * `null` until the browser has been asked, so the notice never flashes in and out.
 */
export function useSampleNoticeDismissed(): [boolean | null, () => void] {
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  useEffect(() => setDismissed(readDismissed()), []);
  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      window.localStorage.setItem(STORAGE_KEY, 'dismissed');
    } catch {
      /* the notice stays dismissed for this visit only */
    }
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
  const all = total > 0 && sampleCount === total;
  return (
    <div className="alert alert-warn mb-6" role="note" data-testid="sample-notice">
      <AlertIcon />
      <p className="min-w-0 flex-1">
        <strong className="alert-title">
          {all
            ? `All ${formatCount(total)} listings are sample data.`
            : `${formatCount(sampleCount)} of ${formatCount(total)} listings are sample data.`}
        </strong>{' '}
        <span className="muted">
          They are synthetic records, not real or verified advocates, and their contact details do
          not work. Do not rely on them for legal help.
        </span>
      </p>
      <button
        type="button"
        className="btn btn-ghost btn-sm btn-icon -my-1 -mr-2 shrink-0"
        onClick={onDismiss}
        aria-label="Dismiss the sample data notice"
      >
        <CloseIcon />
      </button>
    </div>
  );
}
