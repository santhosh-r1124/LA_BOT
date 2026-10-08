/**
 * Theme contract (shared with apps/web and packages/shared styles):
 *
 * - `<html data-theme="light|dark">` forces a theme; no attribute follows the OS.
 * - The choice lives in `localStorage["la-theme"]` ("light" | "dark"); the key is
 *   removed for "system".
 * - `themeInitScript` runs before first paint (inline in the layout `<head>`) so
 *   a saved choice never flashes the wrong theme.
 *
 * The DOM attribute is the source of truth at runtime, not React state, so the
 * choice still works when storage is blocked (private windows) for the session.
 */

export type ThemeChoice = 'light' | 'dark' | 'system';

export const THEME_STORAGE_KEY = 'la-theme';
export const THEME_EVENT = 'la-theme-change';

/** Browser-UI colours, matching `--color-canvas` in the dark and light themes. */
export const THEME_COLOR = { dark: '#0a0f1a', light: '#f5f1e8' } as const;

export const THEME_LABEL: Record<ThemeChoice, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
};

/** Maps a stored value to a choice; anything unknown means "system". */
export function choiceFromStored(value: string | null | undefined): ThemeChoice {
  return value === 'light' || value === 'dark' ? value : 'system';
}

/** The `<meta name="theme-color">` content for a choice and the tag's media query. */
export function themeColorFor(choice: ThemeChoice, media: string | null): string {
  if (choice === 'dark') return THEME_COLOR.dark;
  if (choice === 'light') return THEME_COLOR.light;
  return media && /dark/.test(media) ? THEME_COLOR.dark : THEME_COLOR.light;
}

/**
 * Inline no-flash script. Kept as a string so the layout can inline it; it only
 * sets the attribute (the toggle syncs `theme-color` once React is running).
 */
export const themeInitScript = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

function setAttribute(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
}

/** Keeps the browser chrome colour in step with an explicit choice. */
export function syncThemeColor(choice: ThemeChoice): void {
  if (typeof document === 'undefined') return;
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
    meta.setAttribute('content', themeColorFor(choice, meta.getAttribute('media')));
  });
}

/** What the page is showing right now, read from the DOM. */
export function getThemeSnapshot(): ThemeChoice {
  if (typeof document === 'undefined') return 'system';
  return choiceFromStored(document.documentElement.getAttribute('data-theme'));
}

export function getServerThemeSnapshot(): ThemeChoice {
  return 'system';
}

/** Applies and persists a choice, then tells every mounted toggle. */
export function applyThemeChoice(choice: ThemeChoice): void {
  if (typeof document === 'undefined') return;
  try {
    if (choice === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Storage blocked: the choice still applies for this page view.
  }
  setAttribute(choice);
  syncThemeColor(choice);
  window.dispatchEvent(new Event(THEME_EVENT));
}

/** `useSyncExternalStore` subscription: same-tab changes and other tabs. */
export function subscribeTheme(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
    const next = choiceFromStored(event.key === null ? null : event.newValue);
    setAttribute(next);
    syncThemeColor(next);
    onChange();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(THEME_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(THEME_EVENT, onChange);
  };
}
