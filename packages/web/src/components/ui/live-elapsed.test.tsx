process.env.NODE_ENV = 'development';

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { formatElapsed, LiveElapsed } from './live-elapsed';

describe('formatElapsed', () => {
  test.each([
    [0, '0s'],
    [42_000, '42s'],
    [362_000, '6m 02s'],
    [3_600_000, '1h 0m'],
    [3_840_000, '1h 4m'],
    [-5_000, '0s'],
  ])('%d ms reads as %s', (ms, text) => {
    expect(formatElapsed(ms)).toBe(text);
  });
});

describe('LiveElapsed', () => {
  test('a finished span shows the fixed duration', () => {
    const markup = renderToStaticMarkup(
      <LiveElapsed since="2026-10-10T10:00:00Z" until="2026-10-10T10:06:02Z" />
    );
    expect(markup).toContain('6m 02s');
  });

  test('a running span counts from the start time', () => {
    const markup = renderToStaticMarkup(<LiveElapsed since={Date.now() - 125_000} />);
    expect(markup).toMatch(/>2m \d\ds</);
  });

  test('an invalid start time renders nothing', () => {
    expect(renderToStaticMarkup(<LiveElapsed since="not a date" />)).toBe('');
  });
});
