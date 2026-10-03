'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { NotificationBell } from '@/components/notification-bell';
import { ADMIN_ROLES } from '@/lib/admin-client';
import { useAuth } from '@/lib/auth-context';

const NAV = [
  { href: '/chat', label: 'Legal chat' },
  { href: '/documents', label: 'Documents' },
  { href: '/advocates', label: 'Advocates' },
  { href: '/consultations', label: 'Consultations' },
];

export function SiteHeader() {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the mobile menu on navigation.
  useEffect(() => setOpen(false), [pathname]);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const account = loading ? (
    <span className="skeleton h-8 w-20" aria-hidden="true" />
  ) : user ? (
    <>
      {ADMIN_ROLES.has(user.role) && (
        <Link href="/admin" className="btn btn-ghost btn-sm">
          Admin
        </Link>
      )}
      <NotificationBell />
      <Link href="/profile" className="btn btn-ghost btn-sm max-w-[14rem] truncate">
        {user.display_name || user.email}
      </Link>
    </>
  ) : (
    <>
      <Link href="/login" className="btn btn-ghost btn-sm">
        Log in
      </Link>
      <Link href="/register" className="btn btn-primary btn-sm">
        Sign up
      </Link>
    </>
  );

  return (
    <header className="border-line bg-canvas/70 sticky top-0 z-30 border-b backdrop-blur-xl">
      <a
        href="#main"
        className="focus:bg-elevated sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="border-accent/40 bg-accent-soft font-display text-accent-strong grid h-7 w-7 place-items-center rounded-md border text-sm font-bold"
          >
            §
          </span>
          <span className="display text-base">Legal Advisor</span>
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? 'page' : undefined}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                isActive(item.href)
                  ? 'text-fg bg-white/[0.06]'
                  : 'text-fg-muted hover:text-fg hover:bg-white/[0.04]'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">{account}</div>

        <button
          type="button"
          className="btn btn-ghost btn-sm md:hidden"
          aria-expanded={open}
          aria-controls="mobile-nav"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="sr-only">{open ? 'Close menu' : 'Open menu'}</span>
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
            {open ? (
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" />
            ) : (
              <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="1.6" />
            )}
          </svg>
        </button>
      </div>

      {open && (
        <nav
          id="mobile-nav"
          aria-label="Primary"
          className="border-line bg-canvas/95 border-t px-4 pb-4 pt-2 md:hidden"
        >
          <ul className="flex flex-col">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isActive(item.href) ? 'page' : undefined}
                  className={`block rounded-md px-3 py-2.5 text-sm ${
                    isActive(item.href) ? 'text-fg bg-white/[0.06]' : 'text-fg-muted'
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="border-line mt-3 flex gap-2 border-t pt-3">{account}</div>
        </nav>
      )}
    </header>
  );
}
