import type { ReactNode } from 'react';

/** Small building blocks shared by the /admin pages. */

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function Pager({
  offset,
  limit,
  total,
  onChange,
}: {
  offset: number;
  limit: number;
  total: number;
  onChange: (offset: number) => void;
}) {
  if (total <= limit) return null;
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.ceil(total / limit);
  return (
    <div className="mt-4 flex items-center justify-between gap-3 text-sm">
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        disabled={offset === 0}
        onClick={() => onChange(Math.max(0, offset - limit))}
      >
        ← Previous
      </button>
      <span className="muted">
        Page {page} of {pages} · {total} total
      </span>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        disabled={offset + limit >= total}
        onClick={() => onChange(offset + limit)}
      >
        Next →
      </button>
    </div>
  );
}

export function CountCard({
  title,
  counts,
  footer,
}: {
  title: string;
  counts: Record<string, number>;
  footer?: ReactNode;
}) {
  const entries = Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
  const total = entries.reduce((sum, [, n]) => sum + n, 0);
  return (
    <section className="surface flex flex-col gap-3 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        <span className="text-xl font-semibold">{total}</span>
      </div>
      {entries.length === 0 ? (
        <p className="subtle text-xs">None yet.</p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          {entries.map(([key, n]) => (
            <div key={key} className="contents">
              <dt className="muted">{key.replaceAll('_', ' ').toLowerCase()}</dt>
              <dd className="text-right font-medium">{n}</dd>
            </div>
          ))}
        </dl>
      )}
      {footer}
    </section>
  );
}

export function SelectFilter({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="muted">{label}</span>
      <select className="input py-1" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o.replaceAll('_', ' ')}
          </option>
        ))}
      </select>
    </label>
  );
}
