import type { ReactNode } from 'react';

/**
 * Form primitives shared by the auth/profile pages. Visual styles come from
 * the design system (packages/shared/src/styles/design-system.css) — these
 * exports keep the call sites unchanged.
 */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export const inputClass = 'input';

export const buttonClass = 'btn btn-primary';

export const secondaryButtonClass = 'btn btn-secondary';
