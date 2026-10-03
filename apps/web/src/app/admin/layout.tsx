'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { ADMIN_ROLES } from '@/lib/admin-client';
import { useAuth } from '@/lib/auth-context';

const TABS = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/advocates', label: 'Advocate verification' },
  { href: '/admin/risk', label: 'High-risk review' },
  { href: '/admin/knowledge', label: 'Knowledge base' },
  { href: '/admin/payments', label: 'Payments' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/audit', label: 'Audit log' },
];

/**
 * Admin & legal-ops console (Phase 12). Client-side gating is only for UX —
 * every admin endpoint enforces ADMIN/LEGAL_ADMIN itself (require_roles), so
 * a non-admin who bypasses this still gets 403s.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <main className="page">
        <div className="skeleton h-8 w-1/3" />
      </main>
    );
  }

  if (!ADMIN_ROLES.has(user.role)) {
    return (
      <main className="page page-narrow">
        <p role="alert" className="alert alert-danger">
          The admin console is only available to administrator accounts.
        </p>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="mb-6 flex flex-col gap-3">
        <span className="eyebrow">Admin &amp; legal ops</span>
        <nav aria-label="Admin sections" className="flex flex-wrap gap-1">
          {TABS.map((tab) => {
            const active =
              tab.href === '/admin' ? pathname === '/admin' : pathname.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={`btn btn-sm ${active ? 'btn-secondary' : 'btn-ghost'}`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>
      {children}
    </main>
  );
}
