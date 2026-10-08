import { INDIAN_STATE_NAMES, LANGUAGE_NAMES } from '@legal-platform/shared';

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

/** `CYBER_LAW` -> `Cyber Law`, `DOCUMENT_GUIDANCE` -> `Document Guidance`. */
export function practiceAreaLabel(code: string): string {
  return formatEnumLabel(code);
}

export function stateName(code: string): string {
  return (INDIAN_STATE_NAMES as Record<string, string>)[code] ?? code;
}

/** `TN` -> `TN — Tamil Nadu`: the stored code first, as filtered on. */
export function stateOptionLabel(code: string): string {
  const name = stateName(code);
  return name === code ? code : `${code} — ${name}`;
}

export function languageName(code: string): string {
  return LANGUAGE_NAMES[code] ?? code;
}

/** `ta` -> `ta — Tamil`. */
export function languageOptionLabel(code: string): string {
  const name = languageName(code);
  return name === code ? code : `${code} — ${name}`;
}

/** Indian 10-digit mobiles as `+91 98765 43210`; anything else unchanged. */
export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  const local = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  if (local.length === 10 && /^[6-9]/.test(local)) {
    return `+91 ${local.slice(0, 5)} ${local.slice(5)}`;
  }
  return phone;
}

/** `tel:` target for {@link formatPhone}'s input. */
export function phoneHref(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, '');
  return `tel:${digits.length === 10 ? `+91${digits}` : digits}`;
}
