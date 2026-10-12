import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { MainNav, NAV_ITEMS } from './TopBar';

function navAt(path: string): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <MainNav />
    </MemoryRouter>
  );
}

/** The label of the link marked as the current page, or null. */
function currentLabel(html: string): string | null {
  const match = /<a[^>]*aria-current="page"[^>]*>([^<]+)<\/a>/.exec(html);
  return match?.[1] ?? null;
}

describe('MainNav', () => {
  test('is the navigation landmark named Main with every screen', () => {
    const html = navAt('/runs');
    expect(html).toContain('aria-label="Main"');
    expect(NAV_ITEMS.map(item => item.label)).toEqual([
      'Runs',
      'Workflows',
      'Chat',
      'Builder',
      'Settings',
    ]);
    for (const { label } of NAV_ITEMS) expect(html).toContain(`>${label}</a>`);
  });

  test('marks the active screen with aria-current and the accent underline', () => {
    const html = navAt('/runs');
    expect(currentLabel(html)).toBe('Runs');
    expect(html).toContain('border-header-accent');
  });

  test('the builder URL activates Builder, not Workflows', () => {
    expect(currentLabel(navAt('/workflows/builder'))).toBe('Builder');
  });

  test('the workflows URL activates Workflows', () => {
    expect(currentLabel(navAt('/workflows'))).toBe('Workflows');
  });
});
