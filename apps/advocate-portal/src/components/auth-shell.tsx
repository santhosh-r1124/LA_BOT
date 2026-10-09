import type { ReactNode, Ref } from 'react';
import type { IconComponent } from '@/components/icons';
import styles from './auth-shell.module.css';

/**
 * Shared frame for the log in page: a centred card with the brand mark, and from
 * 960px a short panel beside it. Everything in the panel is plain information
 * about this portal; nothing in it is a promise the app does not keep.
 */
export function AuthShell({
  title,
  lede,
  eyebrow,
  footer,
  aside,
  headingRef,
  busy,
  children,
}: {
  /** The page's `<h1>`. */
  title: ReactNode;
  lede?: ReactNode;
  /** Small label beside the brand mark. */
  eyebrow?: string;
  /** Links under the card body. */
  footer?: ReactNode;
  /** Wide screens only. */
  aside?: ReactNode;
  headingRef?: Ref<HTMLHeadingElement>;
  busy?: boolean;
  children?: ReactNode;
}) {
  return (
    <main className="hero-bg" aria-busy={busy ? true : undefined}>
      <div className={styles.shell}>
        <section className={`surface rise-in ${styles.card}`} aria-labelledby="auth-title">
          <header className={styles.head}>
            <div className={styles.mark}>
              <span className="brand-mark" aria-hidden="true">
                §
              </span>
              {eyebrow && <span className={styles.markLabel}>{eyebrow}</span>}
            </div>
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
          {footer && <footer className={styles.foot}>{footer}</footer>}
        </section>
        {aside && <aside className={styles.aside}>{aside}</aside>}
      </div>
    </main>
  );
}

/** Content for the aside: a statement and a few short points with icons. */
export function AsideIntro({
  eyebrow,
  title,
  points,
  children,
}: {
  eyebrow: string;
  title: string;
  points: Array<{ Icon: IconComponent; title: string; text: string }>;
  children?: ReactNode;
}) {
  return (
    <>
      <div className="flex flex-col gap-4">
        <p className="eyebrow eyebrow-rule">{eyebrow}</p>
        <p className={styles.asideTitle}>{title}</p>
      </div>
      <ul className={styles.points}>
        {points.map(({ Icon, title: pointTitle, text }) => (
          <li key={pointTitle} className={styles.point}>
            <span className={styles.pointIcon} aria-hidden="true">
              <Icon />
            </span>
            <span>
              <span className={styles.pointTitle}>{pointTitle}</span>
              <span className={styles.pointText}>{text}</span>
            </span>
          </li>
        ))}
      </ul>
      {children}
    </>
  );
}
