/** How much of the directory is sample data, in words for the small badge near the count. */
export function sampleBadgeLabel(sampleCount: number, total: number): string {
  if (total > 0 && sampleCount >= total) return 'Sample data, not real advocates';
  return sampleCount * 2 >= total ? 'Mostly sample data' : 'Includes sample data';
}
