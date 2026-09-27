const UPPER = new Set(['IT', 'IP', 'NDA']);

/** `DATA_PROTECTION` -> `Data Protection`, keeping acronyms (IT, IP, NDA) upper-case. */
export function formatEnumLabel(value: string): string {
  return value
    .split('_')
    .map((w) => (UPPER.has(w) ? w : (w[0] ?? '') + w.slice(1).toLowerCase()))
    .join(' ');
}

/** Pydantic serialises Decimal as a string ("1500.00") — render as ₹1,500. */
export function formatInr(value: string | null): string | null {
  if (value === null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  });
}
