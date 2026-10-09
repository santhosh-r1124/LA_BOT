import { PRACTICE_AREAS } from '@legal-platform/shared';
import type { AdvocateSearchFilters } from '@/lib/advocate-client';

export const PAGE_SIZE = 20;

export interface Filters {
  practiceArea: string;
  state: string;
  city: string;
  language: string;
}

export type FilterKey = keyof Filters;

export const NO_FILTERS: Filters = { practiceArea: '', state: '', city: '', language: '' };

export const FILTER_NAMES: Record<FilterKey, string> = {
  practiceArea: 'Practice area',
  state: 'State or UT',
  city: 'City',
  language: 'Language',
};

/** Filters as the API's query parameters (and the page URL's). */
export function toQuery(f: Filters, page: number): AdvocateSearchFilters {
  return {
    practice_area: f.practiceArea || undefined,
    state: f.state || undefined,
    city: f.city || undefined,
    language_code: f.language || undefined,
    page,
    page_size: PAGE_SIZE,
  };
}

const AREA_CODES: readonly string[] = PRACTICE_AREAS;

/** `Cyber Law` / `cyber_law` -> `CYBER_LAW` when that is a known practice area. */
function normaliseArea(raw: string): string {
  const trimmed = raw.trim();
  const code = trimmed.toUpperCase().replace(/[\s-]+/g, '_');
  return AREA_CODES.includes(code) ? code : trimmed;
}

/** Filters and page from a query string, so a search can be shared or reloaded. */
export function fromSearch(search: string): { filters: Filters; page: number } {
  const q = new URLSearchParams(search);
  const page = Math.floor(Number(q.get('page')));
  return {
    filters: {
      practiceArea: normaliseArea(q.get('practice_area') ?? ''),
      // The API's codes are case-sensitive: states upper, languages lower.
      state: (q.get('state') ?? q.get('state_code') ?? '').trim().toUpperCase(),
      city: (q.get('city') ?? '').trim(),
      language: (q.get('language_code') ?? q.get('language') ?? '').trim().toLowerCase(),
    },
    page: Number.isFinite(page) && page >= 1 ? page : 1,
  };
}

/** The query string (with leading `?`, or empty) for the address bar. */
export function toSearch(f: Filters, page: number): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(toQuery(f, page))) {
    if (value !== undefined && key !== 'page_size' && !(key === 'page' && value === 1)) {
      q.set(key, String(value));
    }
  }
  const qs = q.toString();
  return qs ? `?${qs}` : '';
}

export function activeFilterKeys(f: Filters): FilterKey[] {
  return (Object.keys(NO_FILTERS) as FilterKey[]).filter((k) => f[k] !== '');
}
