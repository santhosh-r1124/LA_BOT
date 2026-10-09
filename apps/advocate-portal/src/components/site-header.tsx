'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  DropdownMenu,
  MenuButton,
  MenuLabel,
  MenuLink,
  MenuSeparator,
} from '@/components/dropdown-menu';
import {
  AdvocateIcon,
  AlertIcon,
  ChevronDownIcon,
  CloseIcon,
  ExternalLinkIcon,
  HomeIcon,
  MenuIcon,
  UsersIcon,
  type IconComponent,
} from '@/components/icons';
import { LogOutIcon } from '@/components/portal-icons';
import { ThemeSwitch, ThemeToggle } from '@/components/theme-toggle';
import { DIRECTORY_URL } from '@/lib/links';
import { initialsOf } from '@/lib/options';
import { useAuth } from '@/lib/auth-context';
import { StatusBadge } from '@/components/status';
import styles from './site-header.module.css';

interface NavItem {
  href: string;
  label: string;
  Icon: IconComponent;
  /** Only shown to signed-in advocates. */
  auth?: boolean;
}

const NAV: NavItem[] = [
  { href: '/', label: 'Overview', Icon: HomeIcon },
  { href: '/profile', label: 'Your profile', Icon: AdvocateIcon, auth: true },
];

function isActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

function Brand() {
  return (
    <Link href="/" className="brand" aria-label="Advocate Portal, home">
      <span className="brand-mark" aria-hidden="true">
        §
      </span>
      <span className="brand-name">Advocate Portal</span>
    </Link>
  );
}

/** Opens the public directory in a new tab. */
function DirectoryLink({ className, children }: { className: string; children: ReactNode }) {
  return (
    <a href={DIRECTORY_URL} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
      <ExternalLinkIcon className="size-3.5 opacity-70" />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

/** Stands in for the login buttons while a saved session cannot be checked. */
function UnreachableBadge() {
  return (
    <span className="badge badge-warn">
      <AlertIcon />
      Server unreachable
    </span>
  );
}

export function SiteHeader() {
  const { user, profile, loading, logout, sessionIssue } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close the mobile menu whenever the route changes.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Escape closes the mobile menu and returns focus to its button; a press
  // outside closes it; widening the window past the breakpoint resets it.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !toggleRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const wide = window.matchMedia('(min-width: 768px)');
    const onWide = () => wide.matches && setOpen(false);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    wide.addEventListener('change', onWide);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
      wide.removeEventListener('change', onWide);
    };
  }, [open]);

  const signOut = useCallback(async () => {
    await logout();
    setOpen(false);
    router.push('/');
  }, [logout, router]);

  const name = user ? user.display_name || user.email : '';
  const initials = user ? initialsOf(user.display_name, user.email) : '';
  const nav = NAV.filter((item) => !item.auth || user);

  const desktopAccount = loading ? (
    <span className="skeleton h-9 w-24" aria-hidden="true" />
  ) : user ? (
    <DropdownMenu
      label={`Account menu for ${name}`}
      triggerClassName="btn btn-ghost gap-2 pl-1.5"
      trigger={
        <>
          <span
            className={`avatar avatar-sm ${styles.initials}`}
            data-initials={initials}
            aria-hidden="true"
          />
          <span className="hidden max-w-[10rem] truncate lg:inline">{name}</span>
          <ChevronDownIcon className="size-4 opacity-70" />
        </>
      }
    >
      <MenuLabel>Signed in as</MenuLabel>
      <p
        role="presentation"
        className="text-fg-muted max-w-[16rem] truncate px-[0.65rem] pb-1 text-sm"
        title={user.email}
      >
        {user.email}
      </p>
      {profile && (
        <p role="presentation" className="px-[0.65rem] pb-1">
          <StatusBadge status={profile.verification_status} small />
        </p>
      )}
      <MenuSeparator />
      <MenuLink
        href="/profile"
        icon={<AdvocateIcon className="size-4" />}
        current={isActive(pathname, '/profile')}
      >
        Your profile
      </MenuLink>
      <a
        role="menuitem"
        tabIndex={-1}
        className="menu-item"
        href={DIRECTORY_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        <UsersIcon className="size-4" />
        <span className="flex-1">Public directory</span>
        <ExternalLinkIcon className="size-3.5 opacity-70" />
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
      <MenuSeparator />
      <MenuButton onSelect={signOut} icon={<LogOutIcon className="size-4" />}>
        Log out
      </MenuButton>
    </DropdownMenu>
  ) : sessionIssue ? (
    <UnreachableBadge />
  ) : (
    <>
      <Link href="/login" className="btn btn-ghost">
        Log in
      </Link>
      <Link href="/register" className="btn btn-primary">
        Register
      </Link>
    </>
  );

  return (
    <header className="site-header">
      <a
        href="#main"
        className="bg-accent text-accent-fg rounded-control sr-only z-50 px-4 py-2 text-sm font-semibold focus:not-sr-only focus:absolute focus:left-3 focus:top-3"
      >
        Skip to content
      </a>

      <div className="site-header-inner">
        <Brand />

        <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
          {nav.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="nav-link"
              aria-current={isActive(pathname, href) ? 'page' : undefined}
            >
              {label}
            </Link>
          ))}
          <DirectoryLink className="nav-link">Public directory</DirectoryLink>
        </nav>

        <div className="flex items-center gap-1.5">
          <ThemeToggle />
          <div className="hidden items-center gap-1.5 md:flex">{desktopAccount}</div>
          <button
            ref={toggleRef}
            type="button"
            className="btn btn-ghost btn-icon md:hidden"
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <CloseIcon className="size-5" /> : <MenuIcon className="size-5" />}
          </button>
        </div>
      </div>

      {open && (
        <div
          ref={panelRef}
          id="mobile-nav"
          className="border-line bg-elevated shadow-float absolute inset-x-0 top-full max-h-[calc(100dvh-var(--header-h))] overflow-y-auto border-b md:hidden"
        >
          <div className="max-w-(--page-max) mx-auto flex flex-col gap-4 px-4 py-4 sm:px-6">
            <nav aria-label="Primary">
              <ul className="flex flex-col gap-1">
                {nav.map(({ href, label, Icon }) => (
                  <li key={href}>
                    <Link
                      href={href}
                      className="nav-link w-full py-2.5"
                      aria-current={isActive(pathname, href) ? 'page' : undefined}
                    >
                      <Icon className="size-5" />
                      {label}
                    </Link>
                  </li>
                ))}
                <li>
                  <DirectoryLink className="nav-link w-full py-2.5">
                    <UsersIcon className="size-5" />
                    Public directory
                  </DirectoryLink>
                </li>
              </ul>
            </nav>

            <div className="divider !my-0" />

            {loading ? (
              <span className="skeleton h-10 w-full" aria-hidden="true" />
            ) : user ? (
              <div className="flex flex-col gap-3">
                <p className="flex items-center gap-3">
                  <span className="avatar" aria-hidden="true">
                    {initials}
                  </span>
                  <span className="min-w-0">
                    <span className="subtle block text-xs">Signed in as</span>
                    <span className="block truncate text-sm font-semibold">{name}</span>
                    {profile && (
                      <span className="mt-1 block">
                        <StatusBadge status={profile.verification_status} small />
                      </span>
                    )}
                  </span>
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Link href="/profile" className="btn btn-secondary">
                    Your profile
                  </Link>
                  <button type="button" className="btn btn-secondary" onClick={signOut}>
                    Log out
                  </button>
                </div>
              </div>
            ) : sessionIssue ? (
              <UnreachableBadge />
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <Link href="/login" className="btn btn-secondary">
                  Log in
                </Link>
                <Link href="/register" className="btn btn-primary">
                  Register
                </Link>
              </div>
            )}

            <ThemeSwitch />
          </div>
        </div>
      )}
    </header>
  );
}
