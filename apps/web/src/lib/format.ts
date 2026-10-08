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

// Category codes that read oddly as an advocate's practice area.
const PRACTICE_AREA_LABELS: Record<string, string> = {
  ADVOCATE_REQUIRED: 'Disputes & Litigation',
  DOCUMENT_GUIDANCE: 'Documents & Drafting',
};

export function practiceAreaLabel(code: string): string {
  return PRACTICE_AREA_LABELS[code] ?? formatEnumLabel(code);
}

export function stateName(code: string): string {
  return (INDIAN_STATE_NAMES as Record<string, string>)[code] ?? code;
}

export function languageName(code: string): string {
  return LANGUAGE_NAMES[code] ?? code;
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
