import type { AdvocateDirectoryEntry } from '@/lib/advocate-client';

function listingKey(a: AdvocateDirectoryEntry): string {
  return `${(a.display_name ?? '').trim().toLowerCase()}|${a.city.trim().toLowerCase()}`;
}

/**
 * Other listings for the "More advocates" strip. The same name in the same city
 * reads as one person listed twice, so each is shown once, and never the profile
 * being viewed (or a copy of it).
 */
export function otherAdvocates(
  list: AdvocateDirectoryEntry[],
  current: AdvocateDirectoryEntry,
): AdvocateDirectoryEntry[] {
  const seen = new Set<string>([listingKey(current)]);
  return list.filter((a) => {
    if (a.id === current.id) return false;
    const key = listingKey(a);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
