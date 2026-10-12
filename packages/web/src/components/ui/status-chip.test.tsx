process.env.NODE_ENV = 'development';

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { StatusChip } from './status-chip';

describe('StatusChip', () => {
  test('shows glyph and label in the tone color', () => {
    const markup = renderToStaticMarkup(<StatusChip status="failed" />);
    expect(markup).toContain('✕');
    expect(markup).toContain('Failed');
    expect(markup).toContain('text-status-failed');
  });

  test('the waiting tone is a filled chip', () => {
    const markup = renderToStaticMarkup(<StatusChip status="paused" />);
    expect(markup).toContain('Awaiting you');
    expect(markup).toContain('bg-status-waiting');
    expect(markup).toContain('text-status-waiting-fg');
  });

  test('a label override replaces the default label', () => {
    expect(renderToStaticMarkup(<StatusChip status="completed" label="Done" />)).toContain('Done');
  });
});
