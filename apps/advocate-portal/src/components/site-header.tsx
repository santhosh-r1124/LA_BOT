'use client';

import Link from 'next/link';
import { NotificationBell } from '@/components/notification-bell';
import { useAuth } from '@/lib/auth-context';

export function SiteHeader() {
  const { user, loading } = useAuth();

  return (
    <header className="border-line bg-canvas/70 sticky top-0 z-30 border-b backdrop-blur-xl">
      <a
        href="#main"
        className="focus:bg-elevated sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="border-accent/40 bg-accent-soft font-display text-accent-strong grid h-7 w-7 place-items-center rounded-md border text-sm font-bold"
          >
            §
          </span>
          <span className="display text-base">Advocate Portal</span>
        </Link>
        <nav aria-label="Account" className="flex items-center gap-2">
          {!loading && user && (
            <>
              <Link href="/consultations" className="btn btn-ghost btn-sm">
                Consultations
              </Link>
              <NotificationBell />
            </>
          )}
          {loading ? (
            <span className="skeleton h-8 w-20" aria-hidden="true" />
          ) : user ? (
            <Link href="/profile" className="btn btn-ghost btn-sm max-w-[14rem] truncate">
              {user.display_name || user.email}
            </Link>
          ) : (
            <>
              <Link href="/login" className="btn btn-ghost btn-sm">
                Log in
              </Link>
              <Link href="/register" className="btn btn-primary btn-sm">
                Register
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
