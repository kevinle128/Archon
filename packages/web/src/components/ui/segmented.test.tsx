process.env.NODE_ENV = 'development';

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { Segmented } from './segmented';

const OPTIONS = [
  { value: 'worktree', label: 'Worktree' },
  { value: 'in-place', label: 'In place' },
] as const;

describe('Segmented', () => {
  test('uses radio-group semantics and checks the selected option', () => {
    const markup = renderToStaticMarkup(
      <Segmented
        aria-label="Isolation"
        value="in-place"
        onValueChange={() => undefined}
        options={OPTIONS}
      />
    );
    expect(markup).toContain('role="radiogroup"');
    expect(markup).toContain('aria-label="Isolation"');
    expect((markup.match(/role="radio"/g) ?? []).length).toBe(2);
    expect(markup).toMatch(/aria-checked="true"[^>]*>In place/);
    expect(markup).toMatch(/aria-checked="false"[^>]*>Worktree/);
  });

  test('the selected segment is inverted', () => {
    const markup = renderToStaticMarkup(
      <Segmented
        aria-label="Tier"
        value="worktree"
        onValueChange={() => undefined}
        options={OPTIONS}
      />
    );
    expect(markup).toContain('bg-foreground text-background');
  });
});
