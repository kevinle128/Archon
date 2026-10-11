process.env.NODE_ENV = 'development';

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { StatusIcon } from './StatusIcon';

describe('StatusIcon', () => {
  test('renders an accessible awaiting glyph with the waiting tone', () => {
    const markup = renderToStaticMarkup(<StatusIcon status="awaiting" />);
    expect(markup).toContain('text-status-waiting');
    expect(markup).toContain('waiting on you');
    expect(markup).toContain('>!<');
    expect(markup).not.toContain('text-status-failed');
  });

  test.each([
    ['completed', '✓', 'text-status-done'],
    ['running', '▶', 'text-status-running'],
    ['failed', '✕', 'text-status-failed'],
    ['cancelled', '–', 'text-status-pending'],
    ['skipped', '–', 'text-status-pending'],
    ['pending', '○', 'text-status-pending'],
    ['unheard-of', '○', 'text-status-pending'],
  ])('%s shows %s in %s', (status, glyph, toneClass) => {
    const markup = renderToStaticMarkup(<StatusIcon status={status} />);
    expect(markup).toContain(`>${glyph}<`);
    expect(markup).toContain(toneClass);
    expect(markup).toContain('aria-hidden="true"');
  });
});
