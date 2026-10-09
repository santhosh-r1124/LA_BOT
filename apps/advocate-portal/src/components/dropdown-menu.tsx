'use client';

import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { CheckIcon } from '@/components/icons';

/**
 * Accessible dropdown menu (WAI-ARIA menu button pattern) on the design
 * system's `.menu` classes.
 *
 * - The trigger is a real button with `aria-haspopup="menu"` and `aria-expanded`.
 * - Opening moves focus to the checked item (or the first); Arrow keys, Home and
 *   End move between items; Escape closes and returns focus to the trigger; Tab
 *   closes; a press outside closes.
 * - Choosing an item closes the menu (focus goes back to the trigger unless the
 *   item is a link, because the page is about to change).
 */
export function DropdownMenu({
  label,
  trigger,
  triggerClassName = 'btn btn-ghost btn-icon',
  align = 'right',
  children,
}: {
  /** Accessible name of the trigger button. */
  label: string;
  trigger: ReactNode;
  triggerClassName?: string;
  align?: 'left' | 'right';
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const items = useCallback(
    () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []),
    [],
  );

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const list = items();
    (list.find((el) => el.getAttribute('aria-checked') === 'true') ?? list[0])?.focus();

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, items]);

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
    }
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    if (list.length === 0) return;
    const index = list.indexOf(document.activeElement as HTMLElement);
    const focusAt = (i: number) => list[(i + list.length) % list.length]?.focus();
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusAt(index + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusAt(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusAt(0);
        break;
      case 'End':
        event.preventDefault();
        focusAt(list.length - 1);
        break;
      case 'Escape':
        event.preventDefault();
        close(true);
        break;
      case 'Tab':
        close(false);
        break;
    }
  };

  const onMenuClick = (event: MouseEvent<HTMLDivElement>) => {
    const item = (event.target as HTMLElement).closest<HTMLElement>('[role^="menuitem"]');
    if (!item) return;
    close(item.tagName !== 'A');
  };

  return (
    <div ref={rootRef} className="menu-anchor">
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
      >
        {trigger}
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          className={`menu menu-pop ${align === 'left' ? 'menu-pop-left' : ''}`}
          onKeyDown={onMenuKeyDown}
          onClick={onMenuClick}
        >
          {children}
        </div>
      )}
    </div>
  );
}

type ItemBase = { children: ReactNode; icon?: ReactNode; danger?: boolean };

/** A link row inside a DropdownMenu. */
export function MenuLink({
  href,
  children,
  icon,
  current,
}: ItemBase & { href: string; current?: boolean }) {
  return (
    <Link
      href={href}
      role="menuitem"
      tabIndex={-1}
      aria-current={current ? 'page' : undefined}
      className="menu-item"
    >
      {icon}
      {children}
    </Link>
  );
}

/** A button row inside a DropdownMenu. */
export function MenuButton({
  onSelect,
  children,
  icon,
  danger,
}: ItemBase & { onSelect: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      className={`menu-item ${danger ? 'menu-item-danger' : ''}`}
      onClick={onSelect}
    >
      {icon}
      {children}
    </button>
  );
}

/** A single-choice row (theme, sort order). A check mark shows the current one. */
export function MenuRadio({
  checked,
  onSelect,
  children,
  icon,
}: ItemBase & { checked: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      tabIndex={-1}
      className="menu-item"
      onClick={onSelect}
    >
      {icon}
      <span className="flex-1">{children}</span>
      {checked && <CheckIcon className="size-4 shrink-0" />}
    </button>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <div role="presentation" className="menu-label">
      {children}
    </div>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="menu-sep" />;
}
