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

  test('sizes the mark for the top bar and the login page', () => {
    expect(renderToStaticMarkup(<PixelLogo size="sm" />)).toContain('h-5 w-5');
    expect(renderToStaticMarkup(<PixelLogo size="lg" />)).toContain('h-7 w-7');
    expect(renderToStaticMarkup(<PixelLogo />)).toContain('h-6 w-6');
  });

  test('header tone draws in the top bar colors', () => {
    const markup = renderToStaticMarkup(<PixelLogo active tone="header" />);
    expect(markup).toContain('text-header-fg');
    expect(markup).toContain('fill="var(--header-accent)"');
    expect(renderToStaticMarkup(<PixelLogo active />)).toContain('fill="var(--accent)"');
  });
});
