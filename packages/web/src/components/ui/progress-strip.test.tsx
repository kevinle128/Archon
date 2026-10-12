process.env.NODE_ENV = 'development';

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { ProgressStrip } from './progress-strip';

describe('ProgressStrip', () => {
  test('draws one segment per item colored by status', () => {
    const markup = renderToStaticMarkup(
      <ProgressStrip statuses={['completed', 'running', 'paused', 'failed', 'pending']} />
    );
    expect((markup.match(/data-segment=/g) ?? []).length).toBe(5);
    expect(markup).toContain('bg-status-done');
    expect(markup).toContain('bg-status-running');
    expect(markup).toContain('bg-status-waiting');
    expect(markup).toContain('bg-status-failed');
    expect(markup).toContain('bg-segment-pending');
  });

  test('names the done count for assistive technology', () => {
    const markup = renderToStaticMarkup(<ProgressStrip statuses={['completed', 'pending']} />);
    expect(markup).toContain('aria-label="1 of 2 done"');
  });

  test('an empty strip renders no segments', () => {
    expect(renderToStaticMarkup(<ProgressStrip statuses={[]} />)).not.toContain('data-segment');
  });
});
