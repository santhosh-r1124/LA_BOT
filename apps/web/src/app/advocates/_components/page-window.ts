/** Pure paging maths for the directory pager (kept out of the component so it is easy to test). */
export type PageItem = number | 'gap-start' | 'gap-end';

/**
 * Page numbers to show: always the first and last, the current page and one on
 * each side, with a gap marker where pages are skipped. `1 … 4 5 6 … 50`.
 */
export function pageWindow(current: number, total: number, siblings = 1): PageItem[] {
  if (total <= 1) return [1];
  const keep = new Set<number>([1, total]);
  for (let p = current - siblings; p <= current + siblings; p++) {
    if (p >= 1 && p <= total) keep.add(p);
  }
  const sorted = [...keep].sort((a, b) => a - b);
  const items: PageItem[] = [];
  sorted.forEach((p, i) => {
    const prev = sorted[i - 1];
    if (prev !== undefined && p - prev > 1) {
      // A single skipped page is shown as the page itself, not as a gap.
      if (p - prev === 2) items.push(prev + 1);
      else items.push(i === sorted.length - 1 ? 'gap-end' : 'gap-start');
    }
    items.push(p);
  });
  return items;
}
