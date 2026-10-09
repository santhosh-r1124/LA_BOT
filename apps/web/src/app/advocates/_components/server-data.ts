import type { AdvocateFacets } from '@/lib/advocate-client';
import { env } from '@/lib/env';

/*
 * Server-only helpers for the directory page: imported by the server `page.tsx`
 * and never by a client component.
 */

const FACETS_TIMEOUT_MS = 2500;

function isFacets(value: unknown): value is AdvocateFacets {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<AdvocateFacets>;
  return (
    typeof v.total === 'number' &&
    typeof v.sample_count === 'number' &&
    Array.isArray(v.practice_areas) &&
    Array.isArray(v.states) &&
    Array.isArray(v.languages) &&
    Array.isArray(v.cities)
  );
}

/**
 * The directory's filter values and sample-data counts, fetched while the page is
 * rendered so the first paint already knows whether to show the sample notice (a
 * notice that pops in later pushes the filters and the list down). Any failure
 * returns `null`, and the browser asks for the same data itself.
 */
export async function loadFacets(): Promise<AdvocateFacets | null> {
  if (!env.NEXT_PUBLIC_API_BASE_URL) return null;
  try {
    const res = await fetch(`${env.NEXT_PUBLIC_API_BASE_URL}/api/v1/advocates/facets`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(FACETS_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    return isFacets(body) ? body : null;
  } catch {
    return null;
  }
}
