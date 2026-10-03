'use client';

import type { AppNotification } from '@legal-platform/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { notificationClient } from '@/lib/notification-client';

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function NotificationsPage() {
  const router = useRouter();
  const { user, accessToken, loading: authLoading } = useAuth();
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!accessToken) return;
    setError(null);
    notificationClient
      .list(accessToken)
      .then((res) => {
        setItems(res.items);
        setUnread(res.unread);
      })
      .catch((err: unknown) =>
        setError(err instanceof ApiRequestError ? err.message : 'Could not load notifications.'),
      );
  }, [accessToken]);

  useEffect(() => {
    if (!authLoading && !user) router.replace('/login');
  }, [authLoading, user, router]);

  useEffect(() => load(), [load]);

  async function open(notification: AppNotification) {
    if (accessToken && !notification.read_at) {
      await notificationClient.markRead(notification.id, accessToken).catch(() => undefined);
    }
    if (notification.link) router.push(notification.link);
    else load();
  }

  async function markAll() {
    if (!accessToken) return;
    await notificationClient.markAllRead(accessToken).catch(() => undefined);
    load();
  }

  return (
    <main className="page page-narrow">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display text-2xl sm:text-3xl">Notifications</h1>
          <p className="muted mt-1 text-sm">
            {unread > 0 ? `${unread} unread` : 'You’re all caught up.'}
          </p>
        </div>
        {unread > 0 && (
          <button type="button" onClick={() => void markAll()} className="btn btn-secondary btn-sm">
            Mark all as read
          </button>
        )}
      </div>

      {error ? (
        <p role="alert" className="alert alert-danger text-sm">
          {error}
        </p>
      ) : items === null ? (
        <div className="flex flex-col gap-2" role="status">
          <span className="sr-only">Loading notifications</span>
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-16" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="surface-flat muted p-8 text-center text-sm">
          No notifications yet. Updates about your consultations and payments will appear here.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => void open(n)}
                className={`surface-flat surface-interactive flex w-full flex-col gap-1 p-4 text-left ${
                  n.read_at ? 'opacity-70' : ''
                }`}
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 font-semibold">
                    {!n.read_at && <span className="dot text-accent" aria-label="Unread" />}
                    {n.title}
                  </span>
                  <span className="subtle shrink-0 text-xs">{formatWhen(n.created_at)}</span>
                </span>
                <span className="muted text-sm">{n.body}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="subtle mt-6 text-xs">
        Emails are sent for these too when email delivery is configured.{' '}
        <Link href="/" className="underline underline-offset-2">
          Home
        </Link>
      </p>
    </main>
  );
}
