import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { PixelLogo } from './PixelLogo';

const FILLED_PIXELS = 30;

function countRects(markup: string): number {
  return (markup.match(/<rect /g) ?? []).length;
}

describe('PixelLogo', () => {
  test('draws the 7x7 glyph without a runner by default', () => {
    const markup = renderToStaticMarkup(<PixelLogo />);
    expect(countRects(markup)).toBe(FILLED_PIXELS);
    expect(markup).not.toContain('pixel-logo-runner');
    expect(markup).toContain('shape-rendering="crispEdges"');
  });

  test('adds one runner pixel on the crossbar when active', () => {
    const markup = renderToStaticMarkup(<PixelLogo active />);
    expect(countRects(markup)).toBe(FILLED_PIXELS + 1);
    expect(markup).toContain('class="pixel-logo-runner"');
  });

  test('exposes an accessible name, or hides a decorative logo', () => {
    expect(renderToStaticMarkup(<PixelLogo />)).toContain('aria-label="Archon"');
    const decorative = renderToStaticMarkup(<PixelLogo label="" />);
    expect(decorative).toContain('aria-hidden="true"');
    expect(decorative).not.toContain('aria-label');
  });
});
