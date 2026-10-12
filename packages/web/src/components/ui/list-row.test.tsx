process.env.NODE_ENV = 'development';

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { ListRow } from './list-row';

describe('ListRow', () => {
  test('a selected row has the accent bar and aria-current', () => {
    const markup = renderToStaticMarkup(<ListRow selected>Run</ListRow>);
    expect(markup).toContain('aria-current="true"');
    expect(markup).toContain('border-l-accent');
    expect(markup).toContain('bg-selection');
  });

  test('an unselected row has a transparent bar and no aria-current', () => {
    const markup = renderToStaticMarkup(<ListRow>Run</ListRow>);
    expect(markup).not.toContain('aria-current');
    expect(markup).toContain('border-l-transparent');
    expect(markup).toContain('border-l-[3px]');
  });
});
