process.env.NODE_ENV = 'development';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Root } from 'react-dom/client';

import { installHappyDom, restoreHappyDom } from '@/experiments/console/test/install-happy-dom';
import type { AgentHistoryItem } from '@/lib/agent-history';
import type { WorkflowNodeMessageResponse } from '@/lib/api';

import { NodeRoom, selectNodeRoomMessages } from './NodeRoom';

const react = await import('react');
const reactDomClient = await import('react-dom/client');

const act = react.act;
const createRoot = reactDomClient.createRoot;

const CREATED_AT = '2026-09-06T00:00:00.000Z';

const ITERATION_TWO_STARTED: WorkflowNodeMessageResponse = {
  id: 'm5',
  seq: 5,
  kind: 'status',
  payload: { state: 'iteration_started', detail: '2' },
  created_at: CREATED_AT,
};

const TOOL_READ: WorkflowNodeMessageResponse = {
  id: 'm6',
  seq: 6,
  kind: 'tool',
  payload: { name: 'Read', id: 'tool-1', input: { path: 'a.ts' } },
  created_at: CREATED_AT,
};

const FIXTURE: readonly WorkflowNodeMessageResponse[] = [
  { id: 'm1', seq: 1, kind: 'status', payload: { state: 'started' }, created_at: CREATED_AT },
  {
    id: 'm2',
    seq: 2,
    kind: 'status',
    payload: { state: 'iteration_started', detail: '1' },
    created_at: CREATED_AT,
  },
  { id: 'm3', seq: 3, kind: 'text', payload: { text: 'first' }, created_at: CREATED_AT },
  {
    id: 'm4',
    seq: 4,
    kind: 'status',
    payload: { state: 'iteration_completed', detail: '1' },
    created_at: CREATED_AT,
  },
  ITERATION_TWO_STARTED,
  TOOL_READ,
  {
    id: 'm7',
    seq: 7,
    kind: 'status',
    payload: { state: 'iteration_failed', detail: '2' },
    created_at: CREATED_AT,
  },
  { id: 'm8', seq: 8, kind: 'status', payload: { state: 'failed' }, created_at: CREATED_AT },
];

function ids(messages: readonly WorkflowNodeMessageResponse[]): string[] {
  return messages.map(message => message.id);
}

function visibleText(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstToolSummaryMarkup(markup: string): string {
  const marker = 'data-testid="tool-summary"';
  const markerAt = markup.indexOf(marker);
  if (markerAt < 0) {
    throw new Error('missing tool-summary');
  }
  const start = markup.lastIndexOf('<summary', markerAt);
  const end = markup.indexOf('</summary>', markerAt);
  if (start < 0 || end < 0) {
    throw new Error('malformed tool-summary');
  }
  return markup.slice(start, end + '</summary>'.length);
}

function firstToolDetailsStartTag(markup: string): string {
  const tag = /<details\b[^>]*data-tool-id="[^"]*"[^>]*>/.exec(markup)?.[0];
  if (tag === undefined) {
    throw new Error('missing tool details');
  }
  return tag;
}

function assistantItem(id: string, seq: number, text: string): AgentHistoryItem {
  return { kind: 'assistant', id, seq, role: 'assistant', text };
}

function lifecycleItem(
  id: string,
  seq: number,
  state: string,
  detail: string | null = null
): AgentHistoryItem {
  return { kind: 'lifecycle', id, seq, state, detail };
}

function toolItem(
  overrides: Partial<Extract<AgentHistoryItem, { kind: 'tool' }>> = {}
): Extract<AgentHistoryItem, { kind: 'tool' }> {
  return {
    kind: 'tool',
    id: 'tool-1',
    seq: 2,
    role: 'tool',
    name: 'Read',
    toolUseId: 'tool-use-1',
    input: { path: 'a.ts' },
    output: 'truncated-output',
    outcome: 'succeeded',
    exitCode: null,
    presentation: {
      family: 'file',
      label: 'Read',
      chipAriaLabel: 'Read, file tool',
      headline: 'a.ts',
      headlineKind: 'path',
      badges: [],
    },
    durationMs: 1500,
    canLoadFullOutput: true,
    outputState: 'truncated',
    messageId: 'msg-tool-1',
    ...overrides,
  };
}

function renderRoom(
  overrides: {
    nodeId?: string | null;
    items?: readonly AgentHistoryItem[];
    unknownScope?: boolean;
    isPending?: boolean;
    error?: string | null;
    renderAfterItem?: (item: AgentHistoryItem) => React.ReactNode;
    renderAtEnd?: React.ReactNode;
  } = {}
): string {
  const defaultItems: AgentHistoryItem[] = [
    lifecycleItem('life-1', 1, 'started'),
    assistantItem('asst-1', 2, 'first'),
    toolItem(),
    lifecycleItem('life-2', 3, 'failed'),
  ];
  return renderToStaticMarkup(
    <NodeRoom
      nodeId={overrides.nodeId === undefined ? 'review' : overrides.nodeId}
      items={overrides.items === undefined ? defaultItems : overrides.items}
      unknownScope={overrides.unknownScope ?? false}
      runId="run-1"
      isPending={overrides.isPending ?? false}
      error={overrides.error === undefined ? null : overrides.error}
      onRetry={(): void => {
        return;
      }}
      renderAfterItem={overrides.renderAfterItem}
      renderAtEnd={overrides.renderAtEnd}
    />
  );
}

describe('selectNodeRoomMessages', () => {
  test('sorts a copy by seq and returns all rows for non-loop selections', () => {
    const reversed = [...FIXTURE].reverse();
    const nodeRows = selectNodeRoomMessages(reversed, { kind: 'node' });
    const routeRows = selectNodeRoomMessages(reversed, {
      kind: 'route_iteration',
      executionSeq: 4,
    });

    expect(ids(nodeRows)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8']);
    expect(ids(routeRows)).toEqual(ids(nodeRows));
    expect(ids(reversed)).toEqual(['m8', 'm7', 'm6', 'm5', 'm4', 'm3', 'm2', 'm1']);
  });

  test('selecting iteration 2 returns only the marker-bounded rows', () => {
    const sliced = selectNodeRoomMessages(FIXTURE, { kind: 'loop_iteration', iteration: 2 });
    expect(ids(sliced)).toEqual(['m5', 'm6', 'm7']);
  });

  test('a missing iteration start marker returns the full sorted transcript', () => {
    const sliced = selectNodeRoomMessages(FIXTURE, { kind: 'loop_iteration', iteration: 9 });
    expect(ids(sliced)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8']);
  });

  test('without a terminal marker, the slice stops before the next iteration start', () => {
    const openIteration: readonly WorkflowNodeMessageResponse[] = [
      ITERATION_TWO_STARTED,
      TOOL_READ,
      {
        id: 'm9',
        seq: 9,
        kind: 'status',
        payload: { state: 'iteration_started', detail: '3' },
        created_at: CREATED_AT,
      },
    ];
    const sliced = selectNodeRoomMessages(openIteration, { kind: 'loop_iteration', iteration: 2 });
    expect(ids(sliced)).toEqual(['m5', 'm6']);
  });

  test('without a terminal or next start marker, the slice continues to the end', () => {
    const openEnd: readonly WorkflowNodeMessageResponse[] = [
      ITERATION_TWO_STARTED,
      TOOL_READ,
      {
        id: 'm10',
        seq: 10,
        kind: 'text',
        payload: { text: 'still going' },
        created_at: CREATED_AT,
      },
    ];
    const sliced = selectNodeRoomMessages(openEnd, { kind: 'loop_iteration', iteration: 2 });
    expect(ids(sliced)).toEqual(['m5', 'm6', 'm10']);
  });
});

describe('NodeRoom', () => {
  test('renders assistant, tool, and lifecycle history with expanded I/O', () => {
    const unselected = renderRoom({ nodeId: null, items: [] });
    expect(visibleText(unselected)).toBe('Select a node');
    expect(unselected).not.toContain('role="region"');

    const loading = renderRoom({ isPending: true, items: [] });
    expect(visibleText(loading)).toBe('Loading node transcript');
    expect(loading).toContain('aria-label="review room"');

    const errorMarkup = renderRoom({ error: 'boom', items: [] });
    expect(errorMarkup).toContain('Failed to load node transcript');
    expect(errorMarkup).toContain('Retry');
    expect(errorMarkup).toContain('boom');

    const empty = renderRoom({ items: [] });
    expect(visibleText(empty)).toBe("Node hasn't produced output");

    const loaded = renderRoom();
    expect(loaded).toContain('ASSISTANT');
    expect(loaded).toContain('first');
    expect(loaded).toContain('Read');
    expect(loaded).toContain('data-tool-id="tool-use-1"');
    expect(loaded).toContain('data-testid="tool-summary"');
    expect(loaded).toContain('a.ts');
    expect(loaded).toContain('succeeded');
    expect(loaded).toContain('1.5s');
    expect(loaded).toContain('<details');
    expect(loaded).toContain('Input');
    expect(loaded).toContain('Output');
    expect(loaded).toContain('View full output');
    expect(loaded).toContain('truncated');
    expect(loaded).toContain('started');
    expect(loaded).toContain('failed');
    expect(loaded.indexOf('first')).toBeLessThan(loaded.indexOf('Read'));
    expect(loaded.indexOf('Read')).toBeLessThan(loaded.lastIndexOf('failed'));
  });

  test('shows unknown-scope notice and keeps truncated output when detail load is offered', () => {
    const markup = renderRoom({ unknownScope: true });
    expect(markup).toContain(
      'Execution scope was not recorded; this history may include other executions of the same node.'
    );
  });

  test('renders generic transcript extension slots', () => {
    const items: AgentHistoryItem[] = [
      assistantItem('text-1', 1, 'alpha'),
      toolItem({
        id: 'tool-1',
        messageId: 'tool-1',
        toolUseId: 't1',
        canLoadFullOutput: false,
        durationMs: null,
      }),
    ];
    const renderAfterItem = (item: AgentHistoryItem): React.ReactNode => `extension-${item.id}`;
    const ordered = renderRoom({ items, renderAfterItem, renderAtEnd: 'end-extension' });
    expect(ordered.indexOf('alpha')).toBeGreaterThan(-1);
    expect(ordered.indexOf('extension-text-1')).toBeGreaterThan(ordered.indexOf('alpha'));
    expect(ordered.indexOf('Read')).toBeGreaterThan(ordered.indexOf('extension-text-1'));
    expect(ordered.indexOf('extension-tool-1')).toBeGreaterThan(ordered.indexOf('Read'));
    expect(ordered.indexOf('end-extension')).toBeGreaterThan(ordered.indexOf('extension-tool-1'));

    const empty = renderRoom({ items: [], renderAfterItem, renderAtEnd: 'end-extension' });
    expect(visibleText(empty)).toBe('end-extension');

    const errorMarkup = renderRoom({
      error: 'boom',
      items: [],
      renderAfterItem,
      renderAtEnd: 'end-extension',
    });
    expect(errorMarkup.indexOf('end-extension')).toBeGreaterThan(errorMarkup.indexOf('Retry'));
  });
});

describe('NodeRoom tool disclosure', () => {
  test('renders a succeeded tool as a closed native row with a scannable summary', () => {
    const markup = renderRoom({ items: [toolItem()] });
    const detailsStart = firstToolDetailsStartTag(markup);
    const summaryMarkup = firstToolSummaryMarkup(markup);
    const summaryText = visibleText(summaryMarkup);

    expect(detailsStart).not.toContain('open=""');
    expect(summaryMarkup).toContain('data-testid="tool-summary"');
    expect(summaryMarkup).toContain('role="img"');
    expect(summaryMarkup).toContain('aria-label="succeeded"');
    expect(summaryMarkup).toContain('aria-label="Read, file tool"');
    expect(summaryMarkup).toContain('title="file"');
    expect(summaryText).toContain('✓');
    expect(summaryText).toContain('Read');
    expect(summaryText).toContain('a.ts');
    expect(summaryText).not.toMatch(/[{["]/);
    expect(markup).toContain('Input');
    expect(markup).toContain('Output');
    expect(markup).toContain('View full output');
  });

  test('renders a failed tool open with glyph, chip, filename tail, and exit badge', () => {
    const markup = renderRoom({
      items: [
        toolItem({
          outcome: 'failed',
          exitCode: 1,
          input: { path: 'a.ts', extra: { nested: true } },
          output: { stdout: '["fail"]', code: 1 },
        }),
      ],
    });
    const detailsStart = firstToolDetailsStartTag(markup);
    const summaryMarkup = firstToolSummaryMarkup(markup);
    const summaryText = visibleText(summaryMarkup);

    expect(detailsStart).toContain('open=""');
    expect(summaryMarkup).toContain('aria-label="failed"');
    expect(summaryMarkup).toContain('aria-label="Read, file tool"');
    expect(summaryMarkup).toContain('title="file"');
    expect(summaryText).toContain('✕');
    expect(summaryText).toContain('Read');
    expect(summaryText).toContain('a.ts');
    expect(summaryText).toContain('exit 1');
    expect(summaryText).not.toMatch(/[{["]/);
  });
});

describe('NodeRoom tool disclosure live transitions', () => {
  let win: ReturnType<typeof installHappyDom>;
  let host: Element;
  let root: Root;

  beforeEach(() => {
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

  function liveTool(
    overrides: Partial<Extract<AgentHistoryItem, { kind: 'tool' }>> = {}
  ): Extract<AgentHistoryItem, { kind: 'tool' }> {
    return toolItem({
      outcome: 'running',
      exitCode: null,
      outputState: 'missing',
      canLoadFullOutput: false,
      durationMs: null,
      ...overrides,
    });
  }

  function renderLive(items: readonly AgentHistoryItem[]): void {
    root.render(
      <NodeRoom
        nodeId="review"
        items={items}
        unknownScope={false}
        runId="run-1"
        isPending={false}
        error={null}
        onRetry={(): void => {
          return;
        }}
      />
    );
  }

  function detailsEl(): HTMLDetailsElement {
    const el = host.querySelector('details[data-tool-id="tool-use-1"]');
    if (el === null) {
      throw new Error('missing tool details');
    }
    return el as unknown as HTMLDetailsElement;
  }

  function summaryEl(): HTMLElement {
    const el = host.querySelector('[data-testid="tool-summary"]');
    if (el === null) {
      throw new Error('missing tool-summary');
    }
    return el as unknown as HTMLElement;
  }

  test('untouched running row auto-opens when it fails', async () => {
    const running = liveTool();
    await act(async () => {
      renderLive([running]);
    });
    expect(detailsEl().open).toBe(false);

    await act(async () => {
      renderLive([{ ...running, outcome: 'failed', exitCode: 1 }]);
    });
    expect(detailsEl().open).toBe(true);
  });

  test('manually toggled row stays closed when it later fails', async () => {
    const running = liveTool();
    await act(async () => {
      renderLive([running]);
    });
    expect(detailsEl().open).toBe(false);

    await act(async () => {
      summaryEl().click();
    });
    expect(detailsEl().open).toBe(true);

    await act(async () => {
      summaryEl().click();
    });
    expect(detailsEl().open).toBe(false);

    await act(async () => {
      renderLive([{ ...running, outcome: 'failed', exitCode: 1 }]);
    });
    expect(detailsEl().open).toBe(false);
  });
});
