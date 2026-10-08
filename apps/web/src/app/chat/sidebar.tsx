'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { CloseIcon } from '@/components/icons';
import type { ConversationSummary } from '@/lib/chat-client';
import { groupHistory } from './chat-helpers';
import { PlusIcon } from './chat-icons';
import styles from './chat.module.css';

export interface SetupSummary {
  /** `null` while the status is still loading or unreachable. */
  aiOn: boolean | null;
  documents: number | null;
  fixtureOnly: boolean;
  advocates: number | null;
  advocatesAreSamples: boolean;
}

export function HistoryPanel({
  signedIn,
  history,
  historyError,
  activeId,
  loadingId,
  onNew,
  onSelect,
  onRetryHistory,
  setup,
}: {
  signedIn: boolean;
  history: ConversationSummary[] | null;
  historyError: boolean;
  activeId: string | null;
  loadingId: string | null;
  onNew: () => void;
  onSelect: (id: string) => void;
  onRetryHistory: () => void;
  setup: SetupSummary | null;
}) {
  const groups = useMemo(() => (history ? groupHistory(history) : []), [history]);

  return (
    <div className={styles.panel}>
      <button type="button" onClick={onNew} className="btn btn-secondary btn-block">
        <PlusIcon />
        New conversation
      </button>

      {signedIn ? (
        <nav aria-label="Conversation history">
          {historyError ? (
            <div className="flex flex-col items-start gap-2 px-2.5">
              <p className="text-danger text-sm">Couldn&apos;t load your history.</p>
              <button type="button" className="btn btn-secondary btn-sm" onClick={onRetryHistory}>
                Try again
              </button>
            </div>
          ) : history === null ? (
            <div className="flex flex-col gap-2.5 px-2.5" role="status">
              <span className="sr-only">Loading history</span>
              <div className="skeleton h-4 w-16" aria-hidden="true" />
              <div className="skeleton h-4" aria-hidden="true" />
              <div className="skeleton h-4 w-3/4" aria-hidden="true" />
              <div className="skeleton h-4 w-5/6" aria-hidden="true" />
            </div>
          ) : history.length === 0 ? (
            <p className={styles.historyNote}>No past conversations yet. Ask a question and it will appear here.</p>
          ) : (
            groups.map((group) => (
              <section key={group.label} className={styles.historyGroup}>
                <h2 className={styles.historyLabel}>{group.label}</h2>
                <ul className={styles.historyList}>
                  {group.items.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        className={styles.historyItem}
                        onClick={() => onSelect(c.id)}
                        aria-current={c.id === activeId ? 'true' : undefined}
                        disabled={loadingId !== null}
                        title={c.title || 'Untitled conversation'}
                      >
                        {c.title || 'Untitled conversation'}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </nav>
      ) : (
        <p className={styles.historyNote}>
          You&apos;re chatting anonymously.{' '}
          <Link href="/login" className="link">
            Log in
          </Link>{' '}
          to keep your history across devices.
        </p>
      )}

      {setup && (
        <section className={styles.setup} aria-label="About this setup">
          <h2 className={styles.setupTitle}>This setup</h2>
          <dl className={styles.setupList}>
            <dt>AI answers</dt>
            <dd>{setup.aiOn === null ? 'Unknown' : setup.aiOn ? 'On' : 'Off'}</dd>
            <dt>Library</dt>
            <dd>
              {setup.documents === null
                ? 'Unknown'
                : `${setup.documents.toLocaleString('en-IN')} document${setup.documents === 1 ? '' : 's'}`}
              {setup.fixtureOnly && ' (test fixtures)'}
            </dd>
            {setup.advocates !== null && (
              <>
                <dt>Advocates</dt>
                <dd>
                  {setup.advocates.toLocaleString('en-IN')}
                  {setup.advocatesAreSamples ? ' sample listings' : ' listed'}
                </dd>
              </>
            )}
          </dl>
        </section>
      )}
    </div>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

/**
 * Slide-in panel for the history on screens below 1024px. Esc and the scrim
 * close it, Tab stays inside it, the page behind does not scroll, and focus
 * returns to whatever opened it.
 */
export function Drawer({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    root.style.overflow = 'hidden';
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);

    // The drawer has no meaning once the sidebar is visible.
    const wide = window.matchMedia('(min-width: 1024px)');
    const onWide = () => wide.matches && onClose();
    wide.addEventListener('change', onWide);

    return () => {
      document.removeEventListener('keydown', onKey);
      wide.removeEventListener('change', onWide);
      root.style.overflow = previousOverflow;
      opener?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <>
      <div className={styles.scrim} onClick={onClose} aria-hidden="true" />
      <div ref={panelRef} className={styles.drawer} role="dialog" aria-modal="true" aria-label={title}>
        <div className={styles.drawerHead}>
          <p className={styles.drawerTitle}>{title}</p>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close history">
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>
        <div className={styles.drawerBody}>{children}</div>
      </div>
    </>
  );
}
