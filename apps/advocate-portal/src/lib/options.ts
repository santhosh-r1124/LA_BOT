import {
  INDIAN_STATE_NAMES,
  INDIAN_STATES,
  LANGUAGE_NAMES,
  PRACTICE_AREAS,
} from '@legal-platform/shared';

/**
 * Choices for the state select and the practice-area and language chips.
 * Values are exactly what the API stores (state codes like KA, category codes
 * like CYBER_LAW, language codes like hi); only the labels are for people.
 */

export interface Option {
  value: string;
  label: string;
}

const STATE_NAMES: Record<string, string> = INDIAN_STATE_NAMES;
const ACRONYMS = new Set(['IT', 'IP', 'NDA']);

/** `DATA_PROTECTION` -> `Data Protection`; IT, IP and NDA stay upper-case. */
export function practiceAreaLabel(code: string): string {
  return code
    .split('_')
    .map((w) => (ACRONYMS.has(w) ? w : (w[0] ?? '') + w.slice(1).toLowerCase()))
    .join(' ');
}

/** "Karnataka", or the code itself when it is not one we know. */
export function stateName(code: string | null | undefined): string {
  if (!code) return '';
  return STATE_NAMES[code] ?? code;
}

export function languageName(code: string | null | undefined): string {
  if (!code) return '';
  return LANGUAGE_NAMES[code] ?? code;
}

/**
 * Every state and union territory, A to Z by name, labelled "Karnataka (KA)".
 * A saved code that is not in the list (a legacy code, for example) is kept as
 * an extra option, so opening the profile never silently drops it.
 */
export function stateOptions(current?: string | null): Option[] {
  const options = INDIAN_STATES.map((code) => ({
    value: code as string,
    label: `${stateName(code)} (${code})`,
  })).sort((a, b) => a.label.localeCompare(b.label, 'en'));
  if (current && !options.some((o) => o.value === current)) {
    options.push({ value: current, label: `${stateName(current)} (${current})` });
  }
  return options;
}

/**
 * Practice areas an advocate can list. ADVOCATE_REQUIRED is the classifier's
 * "needs an advocate" bucket rather than a field of practice, so it is not
 * offered, but one already saved on a profile stays visible and removable.
 */
export function practiceAreaOptions(current: readonly string[] = []): Option[] {
  const base = PRACTICE_AREAS.filter((c) => c !== 'ADVOCATE_REQUIRED') as string[];
  const extras = current.filter((c) => !base.includes(c));
  return [...base, ...extras].map((value) => ({ value, label: practiceAreaLabel(value) }));
}

const LANGUAGE_FIRST = ['en', 'hi'];

/** English and Hindi first, then A to Z; saved codes we do not know are kept. */
export function languageOptions(current: readonly string[] = []): Option[] {
  const known = Object.keys(LANGUAGE_NAMES);
  const rest = known
    .filter((c) => !LANGUAGE_FIRST.includes(c))
    .sort((a, b) => languageName(a).localeCompare(languageName(b), 'en'));
  const extras = current.filter((c) => !known.includes(c));
  return [...LANGUAGE_FIRST, ...rest, ...extras].map((value) => ({
    value,
    label: languageName(value),
  }));
}

/** Comma-separated names for display: "Cyber Law, IT Law". */
export function listLabels(codes: readonly string[], label: (code: string) => string): string {
  return codes.map(label).join(', ');
}

/** "AB" from "Adv. Anita Bose"; falls back to the email's first letter. */
export function initialsOf(name: string | null | undefined, email: string): string {
  const words = (name ?? '')
    .replace(/^(adv\.?|advocate|dr\.?|mr\.?|mrs\.?|ms\.?|shri|smt\.?)\s+/i, '')
    .split(/\s+/)
    .filter(Boolean);
  const first = words[0]?.[0] ?? email[0] ?? '?';
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** "₹1,500" for a fee string like "1500.00"; null when it is not a number. */
export function formatFee(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: Number.isInteger(n) ? 0 : 2,
  });
}
