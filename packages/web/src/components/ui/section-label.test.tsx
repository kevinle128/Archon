process.env.NODE_ENV = 'development';

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { SectionLabel } from './section-label';

describe('SectionLabel', () => {
  test('is small, spaced, and uppercase', () => {
    const markup = renderToStaticMarkup(<SectionLabel>Nodes</SectionLabel>);
    expect(markup).toContain('Nodes');
    expect(markup).toContain('uppercase');
    expect(markup).toContain('tracking-[0.08em]');
    expect(markup).toContain('text-[11px]');
  });
});
