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

/** `1000` -> `1,000`, with Indian digit grouping (`1,00,000`). */
export function formatCount(n: number): string {
  return n.toLocaleString('en-IN');
}

/** `1536` -> `1.5 KB`. Used for the size of a file picked for upload. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const HONORIFIC = /^(adv(ocate)?|dr|mr|mrs|ms|miss|smt|shri|sri|shree|prof)\.?\s+/i;

/**
 * Up to two initials for an avatar: `Shalini Naidu` -> `SN`, `Adv. Dr. R. K. Rao`
 * -> `RR`. Leading titles are skipped; an empty name gives `A` (for "Advocate").
 */
export function initials(name: string | null | undefined): string {
  let rest = (name ?? '').trim();
  while (HONORIFIC.test(rest)) rest = rest.replace(HONORIFIC, '');
  const words = rest.split(/\s+/).filter((w) => /\p{L}/u.test(w));
  if (words.length === 0) return 'A';
  const letter = (w: string) => (w.match(/\p{L}/u)?.[0] ?? '').toUpperCase();
  const first = words[0] as string;
  const last = words[words.length - 1] as string;
  return words.length === 1 ? letter(first) : letter(first) + letter(last);
}

/** Text for the sample-listing badge, kept in one place so every page says the same. */
export const SAMPLE_LISTING_LABEL = 'Sample listing';
