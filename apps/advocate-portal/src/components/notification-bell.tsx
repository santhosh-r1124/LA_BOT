'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { notificationClient } from '@/lib/notification-client';

const POLL_MS = 60_000;

/** Header link to /notifications with the unread count. Polls once a minute. */
export function NotificationBell() {
  const { accessToken } = useAuth();
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    const refresh = () =>
      notificationClient
        .unreadCount(accessToken)
        .then((res) => {
          if (!cancelled) setUnread(res.unread);
        })
        .catch(() => undefined); // a missed poll is harmless
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // Re-poll on navigation so reading notifications clears the badge promptly.
  }, [accessToken, pathname]);

  if (!accessToken) return null;

  const label = unread > 0 ? `Notifications, ${unread} unread` : 'Notifications';
  return (
    <Link href="/notifications" className="btn btn-ghost btn-sm relative" aria-label={label}>
      <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" fill="none">
        <path
          d="M10 3a4 4 0 0 0-4 4v2.6L4.6 12.4A.6.6 0 0 0 5.1 13.3h9.8a.6.6 0 0 0 .5-.9L14 9.6V7a4 4 0 0 0-4-4Zm-1.7 12a1.8 1.8 0 0 0 3.4 0"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {unread > 0 && (
        <span className="badge badge-accent absolute -right-1 -top-1 px-1.5 py-0 text-[10px]">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </Link>
  );
}
