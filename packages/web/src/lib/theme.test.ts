import { afterEach, describe, expect, it } from 'bun:test';
import {
  THEME_STORAGE_KEY,
  applyTheme,
  isThemeChoice,
  readStoredTheme,
  resolveTheme,
  storeTheme,
} from './theme';

describe('resolveTheme', () => {
  it('follows the system setting for "system"', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('lets an explicit choice override the system setting', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('isThemeChoice', () => {
  it('accepts only the three known values', () => {
    expect(isThemeChoice('light')).toBe(true);
    expect(isThemeChoice('dark')).toBe(true);
    expect(isThemeChoice('system')).toBe(true);
    expect(isThemeChoice('sepia')).toBe(false);
    expect(isThemeChoice(null)).toBe(false);
  });
});

describe('theme storage', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

  afterEach(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  });

  function stubStorage(impl: Pick<Storage, 'getItem' | 'setItem'>): void {
    Object.defineProperty(globalThis, 'localStorage', { value: impl, configurable: true });
  }

  it('reads a saved choice', () => {
    stubStorage({ getItem: () => 'dark', setItem: () => undefined });
    expect(readStoredTheme()).toBe('dark');
  });

  it('falls back to "system" for a stale or unknown value', () => {
    stubStorage({ getItem: () => 'sepia', setItem: () => undefined });
    expect(readStoredTheme()).toBe('system');
  });

  it('falls back to "system" when storage throws on read', () => {
    stubStorage({
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => undefined,
    });
    expect(readStoredTheme()).toBe('system');
  });

  it('does not throw when storage rejects a write', () => {
    stubStorage({
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    });
    expect(() => {
      storeTheme('light');
    }).not.toThrow();
  });

  it('writes the choice under the documented key', () => {
    const writes: string[][] = [];
    stubStorage({
      getItem: () => null,
      setItem: (key: string, value: string) => {
        writes.push([key, value]);
      },
    });
    storeTheme('dark');
    expect(writes).toEqual([[THEME_STORAGE_KEY, 'dark']]);
  });
});

describe('applyTheme', () => {
  it('toggles the dark class on the document root', () => {
    const classes = new Set<string>();
    const root = {
      classList: {
        toggle: (name: string, force: boolean): void => {
          if (force) classes.add(name);
          else classes.delete(name);
        },
      },
    };
    const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'document', {
      value: { documentElement: root },
      configurable: true,
    });
    try {
      applyTheme('dark');
      expect(classes.has('dark')).toBe(true);
      applyTheme('light');
      expect(classes.has('dark')).toBe(false);
    } finally {
      if (original) Object.defineProperty(globalThis, 'document', original);
      else Reflect.deleteProperty(globalThis, 'document');
    }
  });
});
