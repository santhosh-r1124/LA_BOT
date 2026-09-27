import type { ReactNode } from 'react';

/**
 * Small presentational primitives built on the shared design system.
 * Every status indicator pairs colour with text so meaning never depends on
 * colour alone (WCAG 1.4.1).
 */

export type Tone = 'ok' | 'warn' | 'danger' | 'neutral' | 'accent';

const TONE_CLASS: Record<Tone, string> = {
  ok: 'badge badge-ok',
  warn: 'badge badge-warn',
  danger: 'badge badge-danger',
  neutral: 'badge',
  accent: 'badge badge-accent',
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
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex max-w-2xl flex-col gap-1.5">
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1 className="display text-2xl sm:text-3xl">{title}</h1>
        {description && <p className="muted text-sm">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

export function LoadingBlock({ label, lines = 3 }: { label: string; lines?: number }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-2">
      <span className="sr-only">{label}</span>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={`h-4 ${i === lines - 1 ? 'w-2/3' : 'w-full'}`} />
      ))}
    </div>
  );
}

export function ErrorState({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div role="alert" className="alert alert-danger items-start justify-between">
      <div>
        <p className="font-semibold">{title}</p>
        <p className="muted mt-0.5 text-sm">{message}</p>
      </div>
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn btn-secondary btn-sm">
          Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="surface-flat flex flex-col items-center gap-2 px-6 py-10 text-center">
      <p className="font-semibold">{title}</p>
      {children && <div className="muted max-w-md text-sm">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Disclaimer({ text }: { text: string }) {
  return (
    <p className="subtle border-line mx-auto mt-8 max-w-3xl border-t pt-4 text-center text-xs leading-relaxed">
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
