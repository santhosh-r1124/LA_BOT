/**
 * Remembers the directory's last query string for this tab, so "Back" from a
 * profile returns to the same filters and page. Storage can be blocked, so
 * every access is guarded.
 */
const KEY = 'la-advocates-last-search';

export function rememberDirectorySearch(search: string): void {
  try {
    window.sessionStorage.setItem(KEY, search);
  } catch {
    /* no memory: the back link just opens the full directory */
  }
}

/** `/advocates` plus the remembered query string (only ever a `?key=value` string). */
export function directoryHref(): string {
  try {
    const saved = window.sessionStorage.getItem(KEY);
    if (saved && /^\?[\w%.=&+~-]*$/.test(saved)) return `/advocates${saved}`;
  } catch {
    /* fall through */
  }
  return '/advocates';
}
