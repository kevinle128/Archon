import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { nextThemeChoice, ThemeToggle } from './ThemeToggle';

describe('ThemeToggle', () => {
  test('cycles light, dark, system', () => {
    expect(nextThemeChoice('light')).toBe('dark');
    expect(nextThemeChoice('dark')).toBe('system');
    expect(nextThemeChoice('system')).toBe('light');
  });

  test('names the current choice', () => {
    const html = renderToStaticMarkup(
      <ThemeToggle choice="system" onChange={(): void => undefined} />
    );
    expect(html).toContain('aria-label="Theme: system"');
  });
});
