'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type SVGProps } from 'react';
import {
  DropdownMenu,
  MenuButton,
  MenuLabel,
  MenuLink,
  MenuSeparator,
} from '@/components/dropdown-menu';
import {
  AdvocateIcon,
  ChatIcon,
  ChevronDownIcon,
  CloseIcon,
  DocumentIcon,
  MenuIcon,
  UsersIcon,
  type IconComponent,
} from '@/components/icons';
import { ThemeSwitch, ThemeToggle } from '@/components/theme-toggle';
import { useAuth } from '@/lib/auth-context';
import { initialsOf, isNavActive } from '@/lib/shell-helpers';

const NAV: Array<{ href: string; label: string; Icon: IconComponent }> = [
  { href: '/chat', label: 'Legal chat', Icon: ChatIcon },
  { href: '/documents', label: 'Documents', Icon: DocumentIcon },
  { href: '/advocates', label: 'Advocates', Icon: UsersIcon },
];

/** Door and arrow: the shared icon set has no log-out glyph. */
function LogOutIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      aria-hidden="true"
      {...props}
    >
      <path d="M9.5 4H7A2.5 2.5 0 0 0 4.5 6.5v11A2.5 2.5 0 0 0 7 20h2.5" />
      <path d="m15 8 4 4-4 4M19 12H9.5" />
    </svg>
  );
}

function Brand() {
  return (
    <Link href="/" className="brand min-h-10" aria-label="Legal Advisor, home">
      <span className="brand-mark" aria-hidden="true">
        §
      </span>
      <span className="brand-name">Legal Advisor</span>
    </Link>
  );
}

export function SiteHeader() {
  const { user, loading, logout } = useAuth();
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

  const desktopAccount = loading ? (
    <span className="skeleton h-10 w-24" aria-hidden="true" />
  ) : user ? (
    <DropdownMenu
      label={`Account menu for ${name}`}
      triggerClassName="btn btn-ghost gap-2 pl-1.5"
      trigger={
        <>
          <span className="avatar avatar-sm" aria-hidden="true">
            {initials}
          </span>
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
      <MenuSeparator />
      <MenuLink
        href="/profile"
        icon={<AdvocateIcon className="size-4" />}
        current={isNavActive(pathname, '/profile')}
      >
        Your profile
      </MenuLink>
      <MenuButton onSelect={signOut} icon={<LogOutIcon className="size-4" />}>
        Log out
      </MenuButton>
    </DropdownMenu>
  ) : (
    <>
      <Link href="/login" className="btn btn-ghost">
        Log in
      </Link>
      <Link href="/register" className="btn btn-primary">
        Sign up
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
          {NAV.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="nav-link min-h-10"
              aria-current={isNavActive(pathname, href) ? 'page' : undefined}
            >
              {label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-1.5">
          {/* One theme control per width: this menu from md up, the Light / Dark /
              System switch inside the mobile menu below md. */}
          <div className="hidden md:block">
            <ThemeToggle />
          </div>
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
                {NAV.map(({ href, label, Icon }) => (
                  <li key={href}>
                    <Link
                      href={href}
                      className="nav-link w-full py-2.5"
                      aria-current={isNavActive(pathname, href) ? 'page' : undefined}
                    >
                      <Icon className="size-5" />
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>

            <div className="divider !my-0" />

            {loading ? (
              <span className="skeleton h-10 w-full" aria-hidden="true" />
            ) : user ? (
              <div className="flex flex-col gap-2">
                <p className="flex items-center gap-3">
                  <span className="avatar" aria-hidden="true">
                    {initials}
                  </span>
                  <span className="min-w-0">
                    <span className="subtle block text-xs">Signed in as</span>
                    <span className="block truncate text-sm font-semibold">{name}</span>
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
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <Link href="/login" className="btn btn-secondary">
                  Log in
                </Link>
                <Link href="/register" className="btn btn-primary">
                  Sign up
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
