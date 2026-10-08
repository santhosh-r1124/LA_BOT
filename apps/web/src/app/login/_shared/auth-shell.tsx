import type { ReactNode, Ref } from 'react';
import { ChatIcon, DocumentIcon, LockIcon, UsersIcon } from '@/components/icons';
import styles from './auth-shell.module.css';

export type ShellTone = 'ok' | 'danger' | 'info' | 'accent';

const TONE_CLASS: Record<ShellTone, string> = {
  ok: styles.toneOk ?? '',
  danger: styles.toneDanger ?? '',
  info: styles.toneInfo ?? '',
  accent: styles.toneAccent ?? '',
};

export interface AuthShellProps {
  /** The page's `<h1>`. */
  title: ReactNode;
  /** One or two sentences under the title. */
  lede?: ReactNode;
  /** Small label beside the brand mark, e.g. "Log in". */
  eyebrow?: string;
  /**
   * For a result state (sent, verified, failed): shows a round tinted icon in
   * place of the brand mark. The tone is always backed by the title text.
   */
  status?: { tone: ShellTone; icon: ReactNode };
  /** Links under the card body: "Forgot password?", "Create an account". */
  footer?: ReactNode;
  centerFooter?: boolean;
  /** Lets the page move focus to the heading when its state changes. */
  headingRef?: Ref<HTMLHeadingElement>;
  /** Marks the card busy for assistive tech while a request is running. */
  busy?: boolean;
  children?: ReactNode;
}

/**
 * Shared frame for the sign-in, sign-up, recovery and verification pages: a
 * centred card with the brand mark, and from 960px a short value statement
 * beside it. Everything on the page is plain information about this product;
 * nothing in the aside is a promise the app does not keep.
 */
export function AuthShell({
  title,
  lede,
  eyebrow,
  status,
  footer,
  centerFooter,
  headingRef,
  busy,
  children,
}: AuthShellProps) {
  return (
    <main className="hero-bg" aria-busy={busy ? true : undefined}>
      <div className={styles.shell}>
        <section className={`surface rise-in ${styles.card}`} aria-labelledby="auth-title">
          <header className={styles.head}>
            {status ? (
              <span className={`${styles.medallion} ${TONE_CLASS[status.tone]}`}>
                {status.icon}
              </span>
            ) : (
              <div className={styles.mark}>
                <span className="brand-mark" aria-hidden="true">
                  §
                </span>
                {eyebrow && <span className={styles.markLabel}>{eyebrow}</span>}
              </div>
            )}
            <h1
              id="auth-title"
              ref={headingRef}
              tabIndex={-1}
              className={`display ${styles.title}`}
            >
              {title}
            </h1>
            {lede && <p className={styles.lede}>{lede}</p>}
          </header>

          <div className={styles.body}>{children}</div>

          {footer && (
            <footer className={`${styles.foot} ${centerFooter ? styles.footCenter : ''}`}>
              {footer}
            </footer>
          )}
        </section>

        <ValueStatement />
      </div>
    </main>
  );
}

const POINTS = [
  {
    Icon: ChatIcon,
    title: 'Ask in plain language',
    text: 'Answers point to the passages they come from, so you can read the source yourself.',
  },
  {
    Icon: DocumentIcon,
    title: 'Draft common documents',
    text: 'Eleven kinds of agreement, notice and affidavit as templates to review with an advocate.',
  },
  {
    Icon: UsersIcon,
    title: 'Find an advocate',
    text: 'Browse by state and practice area. The listings in this setup are synthetic samples.',
  },
] as const;

/** Wide screens only. Hidden below 960px, where the card is the whole page. */
function ValueStatement() {
  return (
    <aside className={styles.aside} aria-label="About Legal Advisor">
      <div className="flex flex-col gap-4">
        <p className="eyebrow eyebrow-rule">Legal Advisor, India</p>
        <p className={`display ${styles.asideTitle}`}>
          Legal information you can check against <em>its source</em>.
        </p>
        <p className={styles.asideLede}>
          An account keeps your conversation history together on this computer. You can use the rest
          of the app without one.
        </p>
      </div>

      <ul className={styles.points}>
        {POINTS.map(({ Icon, title, text }) => (
          <li key={title} className={styles.point}>
            <span className={styles.pointIcon}>
              <Icon />
            </span>
            <div>
              <p className={styles.pointTitle}>{title}</p>
              <p className={styles.pointText}>{text}</p>
            </div>
          </li>
        ))}
      </ul>

      <p className={styles.fine}>
        <LockIcon />
        <span>
          General information about Indian law, not legal advice. This copy runs on this computer
          only; nothing is hosted online.
        </span>
      </p>
    </aside>
  );
}

/** Placeholder card for a page that has to wait before it knows what to show. */
export function AuthShellSkeleton({ label }: { label: string }) {
  return (
    <main className="hero-bg" aria-busy="true">
      <div className={styles.shell}>
        <section className={`surface ${styles.card}`} aria-label={label}>
          <div role="status" className={styles.skeletonStack}>
            <span className="sr-only">{label}</span>
            <span
              className="skeleton skeleton-block h-[1.875rem] w-[1.875rem]"
              aria-hidden="true"
            />
            <span className="skeleton h-8 w-3/4" aria-hidden="true" />
            <span className="skeleton h-4 w-full" aria-hidden="true" />
            <span className="skeleton skeleton-block h-11 w-full" aria-hidden="true" />
            <span className="skeleton skeleton-block h-11 w-full" aria-hidden="true" />
            <span className="skeleton skeleton-block h-12 w-full" aria-hidden="true" />
          </div>
        </section>
        <div className={styles.aside} aria-hidden="true" />
      </div>
    </main>
  );
}
