import { INDIAN_STATE_NAMES, INDIAN_STATES } from '@legal-platform/shared';

/**
 * Choices for the "State" and "Preferred language" selects on the sign-up and
 * profile pages. Values are what the API stores: ISO-style state codes (KA, MH)
 * and two-letter language codes (en, hi).
 */

export interface SelectOption {
  value: string;
  label: string;
}

const NAMES: Record<string, string> = INDIAN_STATE_NAMES;

/** "Karnataka", or the code itself when it is not one we know. */
export function stateLabel(code: string | null | undefined): string {
  if (!code) return '';
  return NAMES[code] ?? code;
}

/**
 * All states and union territories, A to Z by name. A saved code that is not in
 * the list (for example one entered through an older version of the form) is
 * kept as an extra option, so opening the profile never silently drops it.
 */
export function stateOptions(current?: string | null): SelectOption[] {
  const options = INDIAN_STATES.map((code) => ({
    value: code as string,
    label: `${stateLabel(code)} (${code})`,
  })).sort((a, b) => a.label.localeCompare(b.label, 'en'));
  if (current && !options.some((o) => o.value === current)) {
    options.push({ value: current, label: `${stateLabel(current)} (${current})` });
  }
  return options;
}

export const LANGUAGES: readonly SelectOption[] = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'Hindi' },
  { value: 'bn', label: 'Bengali' },
  { value: 'ta', label: 'Tamil' },
  { value: 'te', label: 'Telugu' },
  { value: 'mr', label: 'Marathi' },
  { value: 'gu', label: 'Gujarati' },
  { value: 'kn', label: 'Kannada' },
  { value: 'ml', label: 'Malayalam' },
  { value: 'pa', label: 'Punjabi' },
  { value: 'or', label: 'Odia' },
  { value: 'as', label: 'Assamese' },
  { value: 'ur', label: 'Urdu' },
];

export function languageLabel(code: string | null | undefined): string {
  if (!code) return '';
  return LANGUAGES.find((l) => l.value === code)?.label ?? code;
}

/** The language list, plus the saved value when it is not one of them. */
export function languageOptions(current?: string | null): SelectOption[] {
  const options = [...LANGUAGES];
  if (current && !options.some((o) => o.value === current)) {
    options.push({ value: current, label: current });
  }
  return options;
}
