'use client';

import type { ReactNode } from 'react';
import { InfoIcon } from '@/components/icons';
import { usePlatformStatus } from '@/lib/status-client';

/**
 * What the server says about sign-in.
 *
 * - `demo`: the server runs with open login (`status.features.open_login`). Only
 *   then do we say that any email and any password works.
 * - `lenient`: the client must not be stricter than the server. True in demo
 *   mode and while the status is still unknown (loading, or the API is down);
 *   the server validates either way and its answer is mapped to a message.
 */
export function useAuthMode(): { demo: boolean; lenient: boolean } {
  const { state } = usePlatformStatus();
  const known = state.kind === 'ready';
  const demo = known && (state.status.features?.open_login ?? false);
  return { demo, lenient: demo || !known };
}

/** The "demo mode is on" notice. A plain alert; it is not a form error. */
export function DemoNotice({ children }: { children: ReactNode }) {
  return (
    <div className="alert alert-info fade-in">
      <InfoIcon />
      <div className="min-w-0">
        <p className="alert-title">Demo mode is on</p>
        <p className="mt-0.5">{children}</p>
      </div>
    </div>
  );
}
