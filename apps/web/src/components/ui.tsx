import type { ReactNode } from 'react';
import { AlertIcon, CheckIcon, InfoIcon, type IconComponent } from '@/components/icons';

/**
 * Small presentational primitives built on the shared design system
 * (packages/shared/src/styles, docs/design-system.md).
 *
 * Every status indicator pairs colour with text so meaning never depends on
 * colour alone (WCAG 1.4.1). Colours come from theme tokens only, so all of
 * these follow the light and dark themes.
 */

export type Tone = 'ok' | 'warn' | 'danger' | 'neutral' | 'accent' | 'info';

const TONE_CLASS: Record<Tone, string> = {
  ok: 'badge badge-ok',
  warn: 'badge badge-warn',
  danger: 'badge badge-danger',
  neutral: 'badge',
  accent: 'badge badge-accent',
  info: 'badge badge-info',
};

export function StatusBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={TONE_CLASS[tone]}>
      <span className="dot" aria-hidden="true" />
      {children}
    </span>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex max-w-2xl flex-col gap-2">
        {eyebrow && <span className="eyebrow eyebrow-rule">{eyebrow}</span>}
        <h1 className="display display-sm">{title}</h1>
        {description && <p className="muted max-w-[60ch]">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

/** Section heading row: eyebrow, serif title, one muted line, optional actions. */
export function SectionHeader({
  id,
  eyebrow,
  title,
  description,
  actions,
}: {
  id?: string;
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="section-head">
      <div>
        {eyebrow && <p className="eyebrow mb-1.5">{eyebrow}</p>}
        <h2 id={id} className="section-title">
          {title}
        </h2>
        {description && <p className="section-lede">{description}</p>}
      </div>
      {actions && <div className="cluster">{actions}</div>}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

export function LoadingBlock({ label, lines = 3 }: { label: string; lines?: number }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-2.5">
      <span className="sr-only">{label}</span>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={`h-4 ${i === lines - 1 ? 'w-2/3' : 'w-full'}`} />
      ))}
    </div>
  );
}

export type NoticeTone = 'info' | 'ok' | 'warn' | 'danger';

const NOTICE_ICON: Record<NoticeTone, IconComponent> = {
  info: InfoIcon,
  ok: CheckIcon,
  warn: AlertIcon,
  danger: AlertIcon,
};

/**
 * Inline message with an icon, an optional bold title and an optional action.
 * Use for "AI answers are off", sample-data labels, success and error messages.
 * Danger notices announce themselves (`role="alert"`); others stay quiet unless
 * you pass `role="status"` for a message that appears after an action.
 */
export function Notice({
  tone = 'info',
  title,
  children,
  action,
  icon,
  role,
  className = '',
}: {
  tone?: NoticeTone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  icon?: IconComponent;
  role?: 'status' | 'alert';
  className?: string;
}) {
  const Icon = icon ?? NOTICE_ICON[tone];
  return (
    <div
      role={role ?? (tone === 'danger' ? 'alert' : undefined)}
      className={`alert alert-${tone} ${className}`.trim()}
    >
      <Icon />
      <div className="min-w-0 flex-1">
        {title && <p className="alert-title">{title}</p>}
        {children && <div className={title ? 'mt-0.5' : undefined}>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title,
  message,
  onRetry,
  retryLabel = 'Retry',
}: {
  title: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <Notice
      tone="danger"
      title={title}
      action={
        onRetry ? (
          <button type="button" onClick={onRetry} className="btn btn-secondary">
            {retryLabel}
          </button>
        ) : undefined
      }
    >
      <span className="muted">{message}</span>
    </Notice>
  );
}

/** Nothing to show yet: say why and what to do next. */
export function EmptyState({
  title,
  children,
  action,
  icon: Icon,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  icon?: IconComponent;
}) {
  return (
    <div className="surface-flat flex flex-col items-center gap-2 px-6 py-12 text-center">
      {Icon && (
        <span className="border-accent-line bg-accent-soft text-accent-strong rounded-item mb-2 grid size-12 place-items-center border">
          <Icon className="size-6" />
        </span>
      )}
      <p className="title">{title}</p>
      {children && <div className="muted max-w-md text-sm">{children}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Disclaimer({ text }: { text: string }) {
  return (
    <p className="subtle border-line mx-auto mt-10 max-w-3xl border-t pt-4 text-center text-xs leading-relaxed">
      {text}
    </p>
  );
}

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
