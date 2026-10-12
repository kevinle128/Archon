import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { installHappyDom, restoreHappyDom } from '@/test/install-happy-dom';
import { RedirectWithSearch } from './RedirectWithSearch';

function LocationProbe(): React.ReactElement {
  const location = useLocation();
  return createElement('output', null, `${location.pathname}${location.search}`);
}

describe('RedirectWithSearch', () => {
  let win: ReturnType<typeof installHappyDom>;
  let host: Element;
  let root: Root;

  beforeEach(() => {
    process.env.NODE_ENV = 'development';
    win = installHappyDom();
    const el = win.document.createElement('div');
    win.document.body.appendChild(el);
    host = el as unknown as Element;
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    win.close();
    restoreHappyDom();
  });

  async function renderAt(entry: string): Promise<string> {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path="/dashboard" element={<RedirectWithSearch to="/runs" />} />
            <Route path="/runs" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>
      );
    });
    return host.querySelector('output')?.textContent ?? '';
  }

  test('keeps the query string', async () => {
    expect(await renderAt('/dashboard?status=paused')).toBe('/runs?status=paused');
  });

  test('works without a query string', async () => {
    expect(await renderAt('/dashboard')).toBe('/runs');
  });
});
