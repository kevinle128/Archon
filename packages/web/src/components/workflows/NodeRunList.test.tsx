import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { NodeRunList } from './NodeRunList';
import type { LogRow } from './build-log-rows';

function row(overrides: LogRow): LogRow {
  return overrides;
}

const ROWS: readonly LogRow[] = [
  row({
    id: 'start-review',
    nodeId: 'review',
    label: 'Review',
    status: 'running',
    order: 0,
    sourceIndex: 0,
    selection: { kind: 'node' },
  }),
  row({
    id: 'loop-start-2',
    nodeId: 'loop',
    label: 'Loop ×2',
    status: 'completed',
    order: 1,
    sourceIndex: 1,
    selection: { kind: 'loop_iteration', iteration: 2 },
  }),
  row({
    id: 'route-4',
    nodeId: 'router',
    label: 'Router #4',
    status: 'failed',
    order: 2,
    sourceIndex: 2,
    selection: { kind: 'route_iteration', executionSeq: 4 },
  }),
];

function renderList(selectedRowId: string | null = 'loop-start-2'): string {
  return renderToStaticMarkup(
    <NodeRunList
      rows={ROWS}
      selectedRowId={selectedRowId}
      onSelect={(_row: LogRow): void => {
        return;
      }}
    />
  );
}

function visibleText(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('NodeRunList', () => {
  test('renders accessible buttons with labels, selected markup, and status text', () => {
    const markup = renderList();

    expect(markup).toContain('aria-label="Node runs"');
    expect(markup.split('<button').length - 1).toBe(3);
    expect(markup).toContain('type="button"');

    expect(markup).toContain('id="legacy-log-start-review"');
    expect(markup).toContain('id="legacy-log-loop-start-2"');
    expect(markup).toContain('data-node-id="review"');
    expect(markup).toContain('Loop ×2');
    expect(markup).toContain('Router #4');
    expect(markup).toContain('running');
    expect(markup).toContain('completed');
    expect(markup).toContain('failed');

    const selected = /<button\b[^>]*aria-current="true"[^>]*>[\s\S]*?<\/button>/.exec(markup);
    expect(selected?.[0]).toContain('Loop ×2');
    expect(markup.split('aria-current="true"').length - 1).toBe(1);

    expect(visibleText(markup)).toBe('Review running Loop ×2 completed Router #4 failed');
  });

  test('renders awaiting status with accent tokens and waiting on you', () => {
    const awaitingRow = row({
      id: 'start-ask',
      nodeId: 'ask',
      label: 'Ask',
      status: 'awaiting',
      order: 3,
      sourceIndex: 3,
      selection: { kind: 'node' },
    });
    const markup = renderToStaticMarkup(
      <NodeRunList
        rows={[ROWS[0], awaitingRow, ROWS[2]]}
        selectedRowId={null}
        onSelect={(_row: LogRow): void => {
          return;
        }}
      />
    );

    expect(markup).toContain('waiting on you');
    expect(markup).toContain('text-accent');
    expect(markup).toContain('running');
    expect(markup).toContain('text-accent');
    expect(markup).toContain('failed');
    expect(markup).toContain('text-error');
    expect(visibleText(markup)).toBe('Review running Ask waiting on you Router #4 failed');
  });
});
