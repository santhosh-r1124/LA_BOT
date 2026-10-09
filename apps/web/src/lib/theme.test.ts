import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyThemeChoice,
  choiceFromStored,
  getThemeSnapshot,
  nextChoice,
  subscribeTheme,
  THEME_COLOR,
  THEME_STORAGE_KEY,
  themeColorFor,
  themeInitScript,
} from './theme';

function resetDom() {
  document.documentElement.removeAttribute('data-theme');
  document.head.innerHTML = '';
  window.localStorage.clear();
}

beforeEach(resetDom);
afterEach(() => {
  vi.restoreAllMocks();
  resetDom();
});

describe('choiceFromStored', () => {
  it('accepts only light and dark', () => {
    expect(choiceFromStored('light')).toBe('light');
    expect(choiceFromStored('dark')).toBe('dark');
    expect(choiceFromStored('system')).toBe('system');
    expect(choiceFromStored('purple')).toBe('system');
    expect(choiceFromStored(null)).toBe('system');
    expect(choiceFromStored(undefined)).toBe('system');
  });
});

describe('themeColorFor', () => {
  it('uses the chosen theme colour regardless of the OS media query', () => {
    expect(themeColorFor('dark', '(prefers-color-scheme: light)')).toBe(THEME_COLOR.dark);
    expect(themeColorFor('light', '(prefers-color-scheme: dark)')).toBe(THEME_COLOR.light);
  });

  it('follows each tag media query for "system"', () => {
    expect(themeColorFor('system', '(prefers-color-scheme: dark)')).toBe(THEME_COLOR.dark);
    expect(themeColorFor('system', '(prefers-color-scheme: light)')).toBe(THEME_COLOR.light);
    expect(themeColorFor('system', null)).toBe(THEME_COLOR.light);
  });
});

describe('nextChoice', () => {
  it('cycles system -> light -> dark -> system', () => {
    expect(nextChoice('system')).toBe('light');
    expect(nextChoice('light')).toBe('dark');
    expect(nextChoice('dark')).toBe('system');
  });
});

describe('themeInitScript', () => {
  const run = () => new Function(themeInitScript)();

  it('applies a saved dark or light choice before paint', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    run();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    run();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('leaves the attribute off for a missing or unknown value', () => {
    run();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    window.localStorage.setItem(THEME_STORAGE_KEY, 'sepia');
    run();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('does not throw when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(run).not.toThrow();
  });
});

describe('applyThemeChoice', () => {
  function addThemeColorMetas() {
    document.head.innerHTML =
      '<meta name="theme-color" content="#0a0f1a" media="(prefers-color-scheme: dark)">' +
      '<meta name="theme-color" content="#f5f1e8" media="(prefers-color-scheme: light)">';
  }

  it('sets, persists and reads back an explicit choice', () => {
    applyThemeChoice('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(getThemeSnapshot()).toBe('dark');
  });

  it('removes the attribute and the key for "system"', () => {
    applyThemeChoice('light');
    applyThemeChoice('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(getThemeSnapshot()).toBe('system');
  });

  it('still applies the theme for this page view when storage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => applyThemeChoice('dark')).not.toThrow();
    expect(getThemeSnapshot()).toBe('dark');
  });

  it('keeps both theme-color tags in step with an explicit choice, then restores them', () => {
    addThemeColorMetas();
    const colours = () =>
      Array.from(document.querySelectorAll('meta[name="theme-color"]')).map((m) =>
        m.getAttribute('content'),
      );

    applyThemeChoice('light');
    expect(colours()).toEqual([THEME_COLOR.light, THEME_COLOR.light]);
    applyThemeChoice('dark');
    expect(colours()).toEqual([THEME_COLOR.dark, THEME_COLOR.dark]);
    applyThemeChoice('system');
    expect(colours()).toEqual([THEME_COLOR.dark, THEME_COLOR.light]);
  });

  it('notifies subscribers, and stops after unsubscribe', () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeTheme(onChange);
    applyThemeChoice('dark');
    expect(onChange).toHaveBeenCalledTimes(1);
    unsubscribe();
    applyThemeChoice('light');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('follows a change made in another tab', () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeTheme(onChange);
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: 'dark' }));
    expect(getThemeSnapshot()).toBe('dark');
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: null }));
    expect(getThemeSnapshot()).toBe('system');
    window.dispatchEvent(new StorageEvent('storage', { key: 'something-else', newValue: 'dark' }));
    expect(getThemeSnapshot()).toBe('system');
    expect(onChange).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});
