import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { NeedsYouButton } from './NeedsYouButton';

describe('NeedsYouButton', () => {
  test('is filled with the waiting color when runs wait', () => {
    const html = renderToStaticMarkup(<NeedsYouButton count={2} onClick={(): void => undefined} />);
    expect(html).toContain('bg-status-waiting');
    expect(html).toContain('data-waiting="true"');
    expect(html).toContain('aria-label="2 runs need you"');
  });

  test('is muted when no run waits', () => {
    const html = renderToStaticMarkup(<NeedsYouButton count={0} onClick={(): void => undefined} />);
    expect(html).toContain('bg-transparent');
    expect(html).toContain('text-header-muted');
    expect(html).not.toContain('data-waiting');
  });

  test('uses the singular for one run', () => {
    const html = renderToStaticMarkup(<NeedsYouButton count={1} onClick={(): void => undefined} />);
    expect(html).toContain('aria-label="1 run needs you"');
  });
});
