process.env.NODE_ENV = 'development';

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { StatusIcon } from './StatusIcon';

describe('StatusIcon', () => {
  test('renders an accessible awaiting glyph with accent tokens', () => {
    const markup = renderToStaticMarkup(<StatusIcon status="awaiting" />);
    expect(markup).toContain('text-accent');
    expect(markup).toContain('waiting on you');
    expect(markup).not.toContain('text-error');
  });
});
