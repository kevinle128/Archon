/**
 * Light/dark theme resolution and persistence.
 *
 * The saved choice lives in localStorage under `archon-theme`. "system" (also
 * the default when nothing is saved) follows `prefers-color-scheme`. The
 * resolved theme is applied as the `dark` class on <html>. The inline script
 * in index.html applies the same rule before first paint, so keep the two in
 * step.
 */
import { useCallback, useEffect, useState } from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'archon-theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === 'light' || value === 'dark' || value === 'system';
}

/** Pure resolution rule: an explicit choice wins, "system" follows the OS. */
export function resolveTheme(choice: ThemeChoice, systemPrefersDark: boolean): ResolvedTheme {
  if (choice === 'system') return systemPrefersDark ? 'dark' : 'light';
  return choice;
}

/**
 * Read the saved choice. Storage can throw (Safari private mode, blocked site
 * data) and can hold a stale or hand-edited value. Both cases fall back to
 * "system": the UI stays usable and only the persistence is lost.
 */
export function readStoredTheme(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeChoice(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

/** Persist the choice. A storage failure is safe: the choice lasts for this page view. */
export function storeTheme(choice: ThemeChoice): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Storage blocked: keep the in-memory choice, skip persistence.
  }
}

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches;
}

/** Apply a resolved theme to the document root. */
export function applyTheme(resolved: ResolvedTheme): void {
  document.documentElement.classList.toggle('dark', resolved === 'dark');
}

export interface UseTheme {
  choice: ThemeChoice;
  resolved: ResolvedTheme;
  setChoice: (choice: ThemeChoice) => void;
  /** Switch between light and dark based on what is showing now. */
  toggle: () => void;
}

export function useTheme(): UseTheme {
  const [choice, setChoiceState] = useState<ThemeChoice>(readStoredTheme);
  const [prefersDark, setPrefersDark] = useState<boolean>(systemPrefersDark);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(DARK_QUERY);
    const onChange = (event: MediaQueryListEvent): void => {
      setPrefersDark(event.matches);
    };
    query.addEventListener('change', onChange);
    return (): void => {
      query.removeEventListener('change', onChange);
    };
  }, []);

  const resolved = resolveTheme(choice, prefersDark);

  useEffect(() => {
    applyTheme(resolved);
  }, [resolved]);

  const setChoice = useCallback((next: ThemeChoice): void => {
    storeTheme(next);
    setChoiceState(next);
  }, []);

  const toggle = useCallback((): void => {
    setChoice(resolved === 'dark' ? 'light' : 'dark');
  }, [resolved, setChoice]);

  return { choice, resolved, setChoice, toggle };
}
