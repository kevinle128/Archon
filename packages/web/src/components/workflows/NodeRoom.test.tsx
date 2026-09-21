import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Root } from 'react-dom/client';

import type { AgentHistoryItem, TranscriptExecution } from '@/lib/agent-history';
import type { WorkflowNodeMessageResponse } from '@/lib/api';
import { groupByOccurrence, type OccurrenceGrouping } from '@/lib/occurrence-groups';
import type { TodoPhase } from '@/lib/todo-state';
import { toolRowPresentation } from '@/lib/tool-presentation';

import { NodeRoom, selectNodeRoomMessages } from './NodeRoom';
import { TodoStrip } from './TodoStrip';

const react = await import('react');
const reactDomClient = await import('react-dom/client');

const act = react.act;
const createElement = react.createElement;
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

function execution(
  occurrenceId: string,
  overrides: Partial<TranscriptExecution> = {}
): TranscriptExecution {
  return {
    occurrence_id: occurrenceId,
    attempt_id: `${occurrenceId}-attempt-1`,
    ...overrides,
  };
}

function assistantItem(
  id: string,
  seq: number,
  text: string,
  execution: TranscriptExecution | null = null
): AgentHistoryItem {
  return { kind: 'assistant', id, seq, role: 'assistant', text, execution };
}

function lifecycleItem(
  id: string,
  seq: number,
  state: string,
  detail: string | null = null,
  execution: TranscriptExecution | null = null
): AgentHistoryItem {
  return { kind: 'lifecycle', id, seq, state, detail, execution };
}

function toolItem(
  overrides: Partial<Extract<AgentHistoryItem, { kind: 'tool' }>> = {}
): Extract<AgentHistoryItem, { kind: 'tool' }> {
  const base = {
    kind: 'tool' as const,
    id: 'tool-1',
    seq: 2,
    role: 'tool' as const,
    name: 'Read',
    toolUseId: 'tool-use-1',
    input: { path: 'a.ts' },
    output: 'truncated-output',
    outcome: 'succeeded' as const,
    exitCode: null,
    durationMs: 1500,
    canLoadFullOutput: true,
    outputState: 'truncated' as const,
    messageId: 'msg-tool-1',
    execution: null,
    ...overrides,
  };
  return {
    ...base,
    presentation:
      overrides.presentation ??
      toolRowPresentation(
        { name: base.name, input: base.input, output: base.output },
        {
          outcome: base.outcome,
          exitCode: base.exitCode,
          durationMs: base.durationMs,
          outputState: base.outputState,
        }
      ),
  };
}

/** A settled row that mounts open so the expanded body renders in static markup. */
function openToolItem(
  overrides: Partial<Extract<AgentHistoryItem, { kind: 'tool' }>> = {}
): Extract<AgentHistoryItem, { kind: 'tool' }> {
  const item = toolItem(overrides);
  return { ...item, presentation: { ...item.presentation, initialOpen: true } };
}

function rowMarkup(markup: string, toolUseId: string): string {
  const start = markup.indexOf(`<details data-tool-id="${toolUseId}"`);
  if (start < 0) throw new Error(`tool row ${toolUseId} not found`);
  let depth = 0;
  const tag = /<\/?details\b[^>]*>/g;
  tag.lastIndex = start;
  for (let match = tag.exec(markup); match !== null; match = tag.exec(markup)) {
    depth += match[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return markup.slice(start, match.index + match[0].length);
  }
  throw new Error(`tool row ${toolUseId} never closes`);
}

function rowOpenTag(row: string): string {
  return row.slice(0, row.indexOf('>') + 1);
}

function summaryMarkup(row: string): string {
  const start = row.indexOf('<summary');
  const end = row.indexOf('</summary>');
  if (start < 0 || end < 0) throw new Error('summary missing');
  return row.slice(start, end + '</summary>'.length);
}

function badgeMarkup(row: string, text: string): string {
  const match = new RegExp(
    `<span([^>]*)>${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</span>`
  ).exec(row);
  if (match === null) throw new Error(`badge ${text} not found`);
  return match[0];
}

/** Text a screen reader would announce for the row: skips aria-hidden, uses chip aria-label. */
function accessibleName(markup: string): string {
  let text = markup;
  let previous = '';
  while (previous !== text) {
    previous = text;
    text = text.replace(/<([a-zA-Z]+)[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/\1>/g, ' ');
  }
  text = text.replace(/<([a-zA-Z]+)[^>]*aria-label="([^"]*)"[^>]*>[\s\S]*?<\/\1>/g, ' $2 ');
  text = text.replace(/<[^>]+>/g, ' ');
  return text.replace(/\s+/g, ' ').trim();
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
    embedded?: boolean;
    occurrenceGrouping?: OccurrenceGrouping;
    headingIdPrefix?: string;
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
      embedded={overrides.embedded ?? false}
      occurrenceGrouping={overrides.occurrenceGrouping}
      headingIdPrefix={overrides.headingIdPrefix ?? 'test-room-'}
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
  test('renders assistant, tool, and lifecycle history', () => {
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
    expect(loaded).toContain('assistant');
    expect(loaded).toContain('first');
    expect(loaded).toContain('Read');
    expect(loaded).toContain('data-tool-id="tool-use-1"');
    expect(loaded).toContain('succeeded');
    expect(loaded).toContain('1.5s');
    expect(loaded).toContain('<details');
    expect(loaded).toContain('truncated');
    expect(loaded).toContain('started');
    expect(loaded).toContain('failed');
    expect(loaded.indexOf('first')).toBeLessThan(loaded.indexOf('Read'));
    expect(loaded.indexOf('Read')).toBeLessThan(loaded.lastIndexOf('failed'));

    // The tool call renders as one collapsed disclosure row, not an expanded card.
    const row = rowMarkup(loaded, 'tool-use-1');
    expect(rowOpenTag(row)).not.toMatch(/\sopen(\s|=|>)/);
    const summary = summaryMarkup(row);
    expect(summary).toContain('>Read<');
    expect(summary).toContain('a.ts');
    // A closed row mounts no body at all: no family body, no Raw toggle, no
    // full-output control, and never the serialized payload.
    expect(row).not.toContain('tool-family-body');
    expect(row).not.toContain('aria-expanded');
    expect(row).not.toContain('>Raw<');
    expect(row).not.toContain('View full output');
    expect(row).not.toContain('<pre');
    expect(row).not.toContain('truncated-output');
    expect(row).not.toContain('>Input<');
    expect(row).not.toContain('>Output<');
    expect(row.match(/<details[^>]*\sopen(\s|=|>)/g)).toBeNull();
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
    expect(ordered).toContain('<div class="mt-1.5">end-extension</div>');

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

  test('marks only the last rendered item as the dock focus target', () => {
    const markup = renderRoom();
    const markers = markup.match(/data-last-row=""/g) ?? [];
    expect(markers).toHaveLength(1);
    expect(markup).toContain('data-last-row="" tabindex="-1"');
    // The marker sits on the last item's wrapper — after the tool row.
    const markerAt = markup.indexOf('data-last-row');
    expect(markerAt).toBeGreaterThan(markup.indexOf('data-tool-id="tool-use-1"'));
    const unmarked = renderRoom({ items: [] });
    expect(unmarked).not.toContain('data-last-row');
  });
});

describe('NodeRoom tool rows', () => {
  test('maps the five outcomes to closed/open and the exact glyph + hidden status word', () => {
    const items: AgentHistoryItem[] = [
      toolItem({ id: 't-ok', toolUseId: 't-ok', outcome: 'succeeded' }),
      toolItem({ id: 't-bad', toolUseId: 't-bad', outcome: 'failed', exitCode: 2 }),
      toolItem({ id: 't-run', toolUseId: 't-run', outcome: 'running', outputState: 'missing' }),
      toolItem({ id: 't-int', toolUseId: 't-int', outcome: 'interrupted' }),
      toolItem({ id: 't-unk', toolUseId: 't-unk', outcome: 'unknown' }),
    ];
    const markup = renderRoom({ items });

    const expected: [string, boolean, string, string][] = [
      ['t-ok', false, 'succeeded', '✓'],
      ['t-bad', true, 'failed', '✕'],
      ['t-run', false, 'running', '◐'],
      ['t-int', false, 'interrupted', '⚠'],
      ['t-unk', false, 'unknown', '–'],
    ];
    for (const [toolUseId, open, word, glyph] of expected) {
      const row = rowMarkup(markup, toolUseId);
      const openTag = rowOpenTag(row);
      expect(openTag.startsWith('<details data-tool-id=')).toBe(true);
      expect(/\sopen(\s|=|>)/.test(openTag)).toBe(open);
      const summary = summaryMarkup(row);
      expect(summary).toContain(`<span class="sr-only">${word}</span>`);
      expect(summary).toContain(glyph);
      // Glyph and chevron are decorative; the hidden word carries the state.
      expect(/aria-hidden="true"[^>]*>▶/.exec(summary)).not.toBeNull();
      expect(new RegExp(`aria-hidden="true"[^>]*>${glyph}`).exec(summary)).not.toBeNull();
    }
  });

  test('summary exposes status, family·label chip, target, then facts in accessible-name order', () => {
    const row = rowMarkup(renderRoom(), 'tool-use-1');
    const summary = summaryMarkup(row);
    expect(summary).toContain('title="file · Read"');
    expect(summary).toContain('aria-label="file · Read"');
    expect(accessibleName(summary)).toBe('succeeded file · Read a.ts truncated 1.5s');
    // The collapsed row never shows serialized-data punctuation or I/O labels.
    expect(summary).not.toContain('{');
    expect(summary).not.toContain('[1]');
    expect(summary).not.toContain('>Input<');
    expect(summary).not.toContain('>Output<');
    expect(summary).not.toContain('truncated-output');
  });

  test('chip falls back to a bare family title when the sent name is not chip-worthy', () => {
    const items: AgentHistoryItem[] = [
      toolItem({
        name: 'mcp__github__create_issue',
        input: { title: 'x' },
        toolUseId: 't-mcp',
      }),
      toolItem({ name: 'some unknown tool', input: { a: 1 }, toolUseId: 't-gen' }),
    ];
    const markup = renderRoom({ items });
    const mcpSummary = summaryMarkup(rowMarkup(markup, 't-mcp'));
    expect(mcpSummary).toContain('>github · create_issue<');
    expect(mcpSummary).toContain('title="generic · github · create_issue"');
    const genSummary = summaryMarkup(rowMarkup(markup, 't-gen'));
    expect(genSummary).toContain('>generic<');
    expect(genSummary).toContain('title="generic"');
    expect(genSummary).not.toContain('some unknown tool');
  });

  test('path headlines split into a shrinkable secondary head and fixed primary tail', () => {
    const items: AgentHistoryItem[] = [
      toolItem({ toolUseId: 't-posix', input: { file_path: 'crates/x/src/auto_retry.rs' } }),
      toolItem({ toolUseId: 't-win', input: { file_path: 'crates\\x\\auto_retry.rs' } }),
      toolItem({
        toolUseId: 't-url',
        name: 'WebFetch',
        input: { url: 'https://doc.rust-lang.org/std/time/struct.Duration.html' },
      }),
      toolItem({ toolUseId: 't-trail', input: { file_path: 'crates/tests/' } }),
      toolItem({ toolUseId: 't-flat', input: { file_path: 'auto_retry.rs' } }),
    ];
    const markup = renderRoom({ items });

    const posix = summaryMarkup(rowMarkup(markup, 't-posix'));
    const head = /<span class="([^"]*text-text-secondary[^"]*)">crates\/x\/src\/<\/span>/.exec(
      posix
    );
    const tail = /<span class="([^"]*text-text-primary[^"]*)">auto_retry\.rs<\/span>/.exec(posix);
    expect(head?.[1]).toContain('min-w-0');
    expect(head?.[1]).toContain('text-ellipsis');
    expect(tail?.[1]).toContain('max-w-full');
    expect(tail?.[1]).toContain('text-ellipsis');
    expect(posix.indexOf('crates/x/src/')).toBeLessThan(posix.indexOf('auto_retry.rs'));

    expect(summaryMarkup(rowMarkup(markup, 't-win'))).toContain('crates\\x\\');
    const url = summaryMarkup(rowMarkup(markup, 't-url'));
    expect(url).toContain('https://doc.rust-lang.org/std/time/');
    expect(url).toContain('>struct.Duration.html<');

    // A trailing separator stays with the tail.
    const trailing = summaryMarkup(rowMarkup(markup, 't-trail'));
    expect(trailing).toContain('crates/');
    expect(trailing).toContain('>tests/<');

    // No usable separator renders a single primary tail.
    const flat = summaryMarkup(rowMarkup(markup, 't-flat'));
    expect(/text-text-secondary[^"]*">[^<]*auto_retry/.exec(flat)).toBeNull();
    expect(flat).toContain('>auto_retry.rs<');
  });

  test('text headlines use one end-ellipsis span', () => {
    const items: AgentHistoryItem[] = [
      toolItem({
        toolUseId: 't-shell',
        name: 'Bash',
        input: { command: 'cargo test -p web' },
      }),
    ];
    const summary = summaryMarkup(rowMarkup(renderRoom({ items }), 't-shell'));
    const headline = /<span class="([^"]*text-text-primary[^"]*)">cargo test -p web<\/span>/.exec(
      summary
    );
    expect(headline?.[1]).toContain('min-w-0');
    expect(headline?.[1]).toContain('flex-1');
    expect(headline?.[1]).toContain('text-ellipsis');
    expect(headline?.[1]).toContain('whitespace-nowrap');
    expect(summary).toContain('title="shell · Bash"');
  });

  test('badges stay right-aligned and non-wrapping while duration drops first', () => {
    const row = rowMarkup(renderRoom(), 'tool-use-1');
    const summary = summaryMarkup(row);
    const group = /<span class="([^"]*)"[^>]*><span class="contents">/.exec(summary);
    expect(group?.[1]).toContain('whitespace-nowrap');
    expect(group?.[1]).toContain('text-[11px]');
    expect(badgeMarkup(summary, 'truncated')).toContain('flex-none');
    expect(badgeMarkup(summary, '1.5s')).toContain('flex-[0_1_auto]');
    expect(badgeMarkup(summary, '1.5s')).toContain('min-w-0');
    expect(badgeMarkup(summary, '1.5s')).toContain('overflow-hidden');
    // Separators are decorative.
    const separator = /<span aria-hidden="true"[^>]*>·<\/span>/.exec(summary);
    expect(separator).not.toBeNull();
  });

  test('nonzero exit uses a token-derived error mix; state badges and the placeholder stay decorative', () => {
    const items: AgentHistoryItem[] = [
      toolItem({ id: 't-fail', toolUseId: 't-fail', outcome: 'failed', exitCode: 101 }),
      toolItem({ id: 't-zero', toolUseId: 't-zero', outcome: 'succeeded', exitCode: 0 }),
      toolItem({
        id: 't-run',
        toolUseId: 't-run',
        outcome: 'running',
        outputState: 'missing',
        canLoadFullOutput: false,
        durationMs: null,
        presentation: toolRowPresentation(
          { name: 'Bash', input: { command: 'npm test' }, output: undefined },
          { outcome: 'running', runningElapsedMs: 30_000 }
        ),
      }),
      toolItem({
        id: 't-plain',
        toolUseId: 't-plain',
        name: 'unknown-thing',
        input: {},
        outputState: 'full',
        canLoadFullOutput: false,
        durationMs: null,
      }),
    ];
    const markup = renderRoom({ items });

    const failBadge = badgeMarkup(summaryMarkup(rowMarkup(markup, 't-fail')), 'exit 101');
    expect(failBadge).toContain('color-mix(in oklch, var(--error)');
    expect(failBadge).toContain('var(--text-primary)');
    const zeroBadge = badgeMarkup(summaryMarkup(rowMarkup(markup, 't-zero')), 'exit 0');
    expect(zeroBadge).not.toContain('var(--error)');

    const runningBadge = badgeMarkup(summaryMarkup(rowMarkup(markup, 't-run')), 'running · 30.0s');
    expect(runningBadge).toContain('aria-hidden="true"');
    const plainSummary = summaryMarkup(rowMarkup(markup, 't-plain'));
    expect(badgeMarkup(plainSummary, '—')).toContain('aria-hidden="true"');
  });

  test('family chips carry their token tone and the summary carries row geometry', () => {
    const items: AgentHistoryItem[] = [
      toolItem({ toolUseId: 't-shell', name: 'Bash', input: { command: 'ls' } }),
      toolItem({ toolUseId: 't-file', name: 'Read', input: { path: 'a.ts' } }),
      toolItem({ toolUseId: 't-search', name: 'Grep', input: { pattern: 'x' } }),
      toolItem({ toolUseId: 't-todo', name: 'todo', input: {} }),
      toolItem({ toolUseId: 't-gen', name: 'unknown-thing', input: {} }),
    ];
    const markup = renderRoom({ items });

    const chip = (id: string): string => {
      const summary = summaryMarkup(rowMarkup(markup, id));
      const match =
        /<span class="([^"]*)" style="([^"]*)" title="/.exec(summary) ??
        /<span class="([^"]*)" title="/.exec(summary);
      if (match === null) throw new Error(`chip for ${id} not found`);
      return match[0];
    };

    expect(chip('t-shell')).toContain('text-node-bash');
    expect(chip('t-shell')).toContain('var(--node-bash) 40%');
    expect(chip('t-file')).toContain('var(--node-command) 40%');
    expect(chip('t-search')).toContain('var(--node-prompt) 70%');
    expect(chip('t-search')).toContain('var(--node-prompt) 45%');
    expect(chip('t-todo')).toContain('var(--node-approval) 40%');
    expect(chip('t-gen')).toContain('text-text-secondary');
    const todoSummary = summaryMarkup(rowMarkup(markup, 't-todo'));
    expect(todoSummary).toContain('text-text-secondary">todo updated</span>');
    expect(todoSummary).not.toContain('text-text-primary">todo updated</span>');

    const summary = summaryMarkup(rowMarkup(markup, 't-shell'));
    expect(summary).toContain('font-mono');
    expect(summary).toContain('text-[12px]');
    expect(summary).toContain('min-h-[24px]');
    expect(summary).toContain('gap-2');
    expect(summary).toContain('px-1.5');
    expect(summary).toContain('py-1');
    expect(summary).toContain('rounded-[6px]');
    expect(summary).toContain('hover:bg-surface-hover');
    expect(summary).toContain('focus-visible:outline-accent-bright');
    expect(summary).toContain('-outline-offset-2');
    // The summary is the containing block for its absolutely-positioned
    // sr-only status label; without `relative` the label escapes into the
    // document's overflow and grows the root scroll height.
    expect(summary).toContain('relative');
    // Chevron: fixed 9px column, 90°/120ms rotation, reduced-motion opt out.
    const chevron = /<span aria-hidden="true" class="([^"]*)">▶<\/span>/.exec(summary);
    expect(chevron?.[1]).toContain('w-[9px]');
    expect(chevron?.[1]).toContain('text-[10px]');
    expect(chevron?.[1]).toContain('duration-[120ms]');
    expect(chevron?.[1]).toContain('motion-reduce:transition-none');
    // Glyph: bold, fixed 12px column; only the glyph is bold inside the row.
    const glyph = /<span aria-hidden="true" class="([^"]*)">✓<\/span>/.exec(summary);
    expect(glyph?.[1]).toContain('w-[12px]');
    expect(glyph?.[1]).toContain('font-bold');
    expect(summary.match(/font-bold/g)?.length).toBe(1);
    // Rest state: no inset card fill/border/shadow on the row itself.
    const openTag = rowOpenTag(rowMarkup(markup, 't-shell'));
    expect(openTag).not.toContain('ptool');
    expect(openTag).not.toContain('bg-surface-inset');
    expect(openTag).not.toContain('border');
    expect(openTag).not.toContain('shadow');
  });

  test('opened body bar carries family then facts and the Raw toggle; the file body renders below', () => {
    const items: AgentHistoryItem[] = [
      toolItem({ outcome: 'failed', exitCode: 2, toolUseId: 't-fail' }),
    ];
    const markup = renderRoom({ items });
    const row = rowMarkup(markup, 't-fail');
    expect(rowOpenTag(row)).toMatch(/\sopen(\s|=|>)/);

    const bodyStart = row.indexOf('</summary>') + '</summary>'.length;
    const body = row.slice(bodyStart);
    expect(body).toContain('ml-[29px]');
    expect(body).toContain('border-l-2');
    expect(body).toContain('pl-2.5');

    // The bar opens with the family, then the facts, then the Raw toggle.
    const bar =
      /<div class="([^"]*)"[^>]*><span class="([^"]*)"[^>]*>([^<]*)<\/span><button([^>]*)>/.exec(
        body
      );
    expect(bar?.[3]).toBe('file · exit 2 · truncated · 1.5s');
    expect(bar?.[1]).toContain('text-[10.5px]');
    expect(bar?.[1]).toContain('font-mono');
    expect(bar?.[1]).toContain('text-text-secondary');
    expect(bar?.[2]).toContain('min-w-0');
    expect(bar?.[2]).toContain('whitespace-nowrap');
    expect(bar?.[2]).toContain('overflow-hidden');
    expect(bar?.[4]).toContain('aria-expanded="false"');
    expect(bar?.[4]).toContain('type="button"');

    // Exactly one Raw control: native button, closed by default, 24px target.
    const raw = /<button([^>]*)>Raw[\s\S]*?<\/button>/.exec(body);
    expect(raw).not.toBeNull();
    expect(raw?.[1]).toContain('type="button"');
    expect(raw?.[1]).toContain('aria-expanded="false"');
    expect(raw?.[1]).not.toContain('aria-controls');
    expect(raw?.[1]).toContain('min-h-[24px]');
    expect(raw?.[1]).toContain('border-border');
    expect(raw?.[1]).toContain('text-text-secondary');
    expect(raw?.[1]).toContain('hover:border-border-bright');
    expect(raw?.[1]).toContain('hover:text-text-primary');
    expect(raw?.[1]).toContain('focus-visible:border-border-bright');
    expect(raw?.[1]).toContain('focus-visible:text-text-primary');
    expect(raw?.[1]).toContain('focus-visible:outline-accent-bright');
    expect(body.match(/<button[^>]*>Raw[\s\S]*?<\/button>/g)).toHaveLength(1);

    // The file body arm: node-command path, then the preview, in the inset box.
    expect(body).toContain('tool-family-body');
    expect(body).toContain('bg-surface-inset');
    expect(body).toContain('text-node-command">a.ts<');
    expect(body).toContain('truncated-output');
    // A failed auto-opened row still exposes no serialized payload or diagnostic labels.
    expect(body).not.toContain('<pre');
    expect(body).not.toContain('>Input<');
    expect(body).not.toContain('>Output<');
    // No nested disclosures survive; Raw is the only body toggle.
    expect(body.match(/<details/g)).toBeNull();
    // Body precedes the full-output control, which stays mounted while Raw is closed.
    expect(body.indexOf('tool-family-body')).toBeLessThan(body.indexOf('View full output'));
    expect(body).toContain('View full output');
  });

  test('collapsed tool rows sit flush while mixed content keeps per-item separation', () => {
    const items: AgentHistoryItem[] = [
      toolItem({ id: 't-1', toolUseId: 't-1', seq: 1 }),
      toolItem({ id: 't-2', toolUseId: 't-2', seq: 2, name: 'Bash', input: { command: 'ls' } }),
      assistantItem('a-1', 3, 'notes'),
      lifecycleItem('l-1', 4, 'completed'),
    ];
    const markup = renderRoom({ items });
    expect(markup).toContain('<div><details data-tool-id="t-1"');
    expect(markup).toContain('</details></div><div><details data-tool-id="t-2"');
    expect(markup).not.toContain('gap-3');
    expect(markup).toContain('px-3');
    expect(markup).toContain('py-2.5');
    // Non-tool content keeps its own vertical margins; the last item's
    // wrapper additionally carries the dock focus-target marker.
    expect(markup).toContain('class="my-1.5"');
    expect(markup).toContain('chat-markdown max-w-none font-sans text-[12.5px]');
    expect(markup).toContain('<p class="text-xs text-text-secondary">completed');
  });

  test('extension slots keep their anchor and gain separation below the row', () => {
    const items: AgentHistoryItem[] = [toolItem()];
    const markup = renderRoom({
      items,
      renderAfterItem: item => `after-${item.id}`,
      renderAtEnd: 'at-end',
    });
    const toolIndex = markup.indexOf('data-tool-id="tool-use-1"');
    const afterIndex = markup.indexOf('after-tool-1');
    expect(afterIndex).toBeGreaterThan(toolIndex);
    expect(markup).toContain('<div class="mt-1.5">after-tool-1</div>');
    expect(markup).toContain('<div class="mt-1.5">at-end</div>');
  });

  test('embedded mode returns the body without a room region for the pane to re-own', () => {
    const markup = renderRoom({ embedded: true });
    expect(markup).not.toContain('role="region"');
    expect(markup).not.toContain('aria-label="review room"');
    expect(markup).toContain('first');
    expect(markup).toContain('data-tool-id="tool-use-1"');
  });
});

const TODO_STRIP_PHASES: TodoPhase[] = [
  {
    phase: 'Research',
    items: [
      { content: 'Read the spec', status: 'completed' },
      { content: 'Map the message path', status: 'in_progress' },
      { content: 'Check contract conflicts', status: 'pending' },
      { content: 'Inspect the mockups', status: 'pending' },
      { content: 'Confirm the tokens', status: 'pending' },
      { content: 'Define acceptance cases', status: 'pending' },
    ],
  },
  {
    phase: 'Implement',
    items: [
      { content: 'Add the fold', status: 'pending' },
      { content: 'Wire Legacy', status: 'pending' },
      { content: 'Wire Console', status: 'pending' },
      { content: 'Add the tests', status: 'pending' },
      { content: 'Run the suite', status: 'blocked', blocker: 'CI has one build job' },
      { content: 'Review output', status: 'abandoned' },
    ],
  },
];

function stripBody(markup: string): string {
  const start = markup.indexOf('data-testid="todo-list"');
  if (start < 0) throw new Error('todo list body missing');
  return markup.slice(start);
}

function stripRow(body: string, content: string): string {
  const index = body.indexOf(content);
  if (index < 0) throw new Error(`strip row ${content} missing`);
  const start = body.lastIndexOf('<li', index);
  const end = body.indexOf('</li>', index);
  return body.slice(start, end + '</li>'.length);
}

function stripRowTag(row: string): string {
  return row.slice(0, row.indexOf('>') + 1);
}

describe('TodoStrip markup', () => {
  function stripMarkup(phases: readonly TodoPhase[] = TODO_STRIP_PHASES): string {
    return renderToStaticMarkup(<TodoStrip phases={phases} />);
  }

  test('renders nothing when the folded todo state is empty', () => {
    expect(stripMarkup([])).toBe('');
  });

  test('renders a collapsed full-bleed section, disclosure button, meter, count, and hidden body', () => {
    const markup = stripMarkup();
    const sectionTag = /<section[^>]*>/.exec(markup)?.[0] ?? '';
    expect(sectionTag).toContain('aria-label="Todo"');
    expect(sectionTag).toContain('flex-none');
    expect(sectionTag).toContain('border-b');
    expect(sectionTag).toContain('bg-surface-elevated');
    expect(sectionTag).not.toContain('rounded');
    // The strip is not a landmark: the room region owns the landmark.
    expect(markup.match(/role="region"/g)).toBeNull();

    const buttonTag = /<button[^>]*>/.exec(markup)?.[0] ?? '';
    expect(buttonTag).toContain('type="button"');
    expect(buttonTag).toContain('aria-expanded="false"');
    expect(buttonTag).toContain('w-full');
    expect(buttonTag).toContain('min-h-[24px]');
    expect(buttonTag).toContain('px-[10px]');
    expect(buttonTag).toContain('py-[6px]');
    expect(buttonTag).toContain('gap-2');
    expect(buttonTag).toContain('whitespace-nowrap');
    expect(buttonTag).toContain('hover:bg-surface-hover');
    expect(buttonTag).toContain('focus-visible:outline-accent-bright');
    expect(buttonTag).toContain('-outline-offset-2');
    const controls = /aria-controls="([^"]+)"/.exec(buttonTag)?.[1];
    expect(controls ?? '').not.toBe('');

    const bodyTag = /<div[^>]*data-testid="todo-list"[^>]*>/.exec(markup)?.[0] ?? '';
    expect(bodyTag).toContain(`id="${controls ?? 'missing'}"`);
    expect(bodyTag).toContain('hidden');
    expect(bodyTag).toContain('max-h-[168px]');
    expect(bodyTag).toContain('overflow-y-auto');
    expect(bodyTag).toContain('border-t');

    expect(markup).toContain('>TODO<');
    // Representative item: in-progress content, glyph, and a hidden status phrase.
    expect(markup).toContain('Map the message path');
    expect(markup).toContain('<span class="sr-only">in progress</span>');
    expect(markup).toContain('◐');
    // Meter is decorative; the count carries the fact in text.
    const meterTag = /<span[^>]*data-testid="todo-meter"[^>]*>/.exec(markup)?.[0] ?? '';
    expect(meterTag).toContain('aria-hidden="true"');
    expect(markup.match(/h-\[3px\]/g)?.length).toBe(12);
    expect(markup).toContain('>1/12<');
    // The caret is decorative and communicates state through rotation only.
    expect(markup).toContain('▾');
    const caret = /<span aria-hidden="true"[^>]*>▾<\/span>/.exec(markup)?.[0] ?? '';
    expect(caret).not.toContain('rotate-180');
    expect(markup).not.toContain('Raw');
  });

  test('renders phase headings and item rows with one accessible status phrase each', () => {
    const markup = stripMarkup();
    const body = stripBody(markup);
    expect(markup.match(/<h3[^>]*>/g)?.length).toBe(2);
    const headingTag = /<h3[^>]*>/.exec(markup)?.[0] ?? '';
    expect(headingTag).toContain('uppercase');
    expect(headingTag).toContain('text-[10px]');
    expect(markup).toContain('>Research<');
    expect(markup).toContain('>Implement<');
    expect(markup.match(/<ul/g)?.length).toBe(2);
    expect(markup.match(/<li/g)?.length).toBe(12);

    expect(accessibleName(stripRow(body, 'Read the spec'))).toBe('completed Read the spec');
    expect(accessibleName(stripRow(body, 'Map the message path'))).toBe(
      'in progress Map the message path'
    );
    expect(accessibleName(stripRow(body, 'Check contract conflicts'))).toBe(
      'pending Check contract conflicts'
    );
    // The hidden phrase carries the reason; the visible suffix stays decorative.
    expect(accessibleName(stripRow(body, 'Run the suite'))).toBe(
      'blocked — CI has one build job Run the suite'
    );
    expect(accessibleName(stripRow(body, 'Review output'))).toBe('abandoned Review output');

    expect(body.match(/· blocked: CI has one build job/g)?.length).toBe(1);
    expect(body.match(/· dropped/g)?.length).toBe(1);
    const suffix = /<span aria-hidden="true"[^>]*>· blocked: CI has one build job<\/span>/.exec(
      body
    );
    expect(suffix).not.toBeNull();

    // The current row gets the surface fill and inset running marker; no other
    // row (blocked or otherwise) does.
    const currentTag = stripRowTag(stripRow(body, 'Map the message path'));
    expect(currentTag).toContain('bg-surface');
    expect(currentTag).toContain('text-text-primary');
    expect(currentTag).toContain('shadow-[inset_2px_0_0_var(--accent-bright)]');
    expect(stripRowTag(stripRow(body, 'Run the suite'))).not.toContain('bg-surface');
    expect(stripRowTag(stripRow(body, 'Read the spec'))).not.toContain('bg-surface');
    expect(stripRow(stripRow(body, 'Review output'), 'Review output')).toContain('line-through');
  });

  test('never puts agent-authored strings into ids, labels, titles, or classes', () => {
    const markup = stripMarkup();
    expect(
      markup.match(
        /(?:id|aria-label|title|class)="[^"]*(?:Read the spec|Map the message path|blocked:|· dropped)[^"]*"/g
      )
    ).toBeNull();
  });

  test('keeps the fixed-height internally scrolling body for long lists', () => {
    const many: TodoPhase[] = [
      {
        phase: 'All',
        items: Array.from({ length: 40 }, (_, index) => ({
          content: `Task ${index}`,
          status: 'pending' as const,
        })),
      },
    ];
    const markup = stripMarkup(many);
    expect(markup).toContain('max-h-[168px]');
    expect(markup).toContain('overflow-y-auto');
    expect(markup).toContain('>0/40<');
    expect(markup.match(/h-\[3px\]/g)?.length).toBe(40);
    // No in-progress item falls back to the first pending item in the header.
    expect(markup).toContain('Task 0');
    expect(markup).toContain('<span class="sr-only">pending</span>');
  });
});

const INSTALLED_GLOBAL_KEYS = [
  'window',
  'document',
  'self',
  'HTMLElement',
  'Element',
  'Node',
  'Text',
  'DocumentFragment',
  'SVGElement',
  'HTMLButtonElement',
  'navigator',
  'location',
  'getComputedStyle',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'MutationObserver',
  'Event',
  'CustomEvent',
  'KeyboardEvent',
  'MouseEvent',
  'FocusEvent',
  'IS_REACT_ACT_ENVIRONMENT',
] as const;

const previousGlobals = new Map<string, PropertyDescriptor | undefined>();

function snapshotGlobals(): void {
  previousGlobals.clear();
  for (const key of INSTALLED_GLOBAL_KEYS) {
    previousGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  }
}

function restoreGlobals(): void {
  for (const key of INSTALLED_GLOBAL_KEYS) {
    const descriptor = previousGlobals.get(key);
    if (descriptor === undefined) {
      Reflect.deleteProperty(globalThis, key);
    } else {
      Object.defineProperty(globalThis, key, descriptor);
    }
  }
  previousGlobals.clear();
}

function installHappyDom(): Window {
  snapshotGlobals();
  const win = new Window({ url: 'https://localhost/' });
  const bag: Record<string, unknown> = {
    window: win,
    document: win.document,
    self: win,
    HTMLElement: win.HTMLElement,
    Element: win.Element,
    Node: win.Node,
    Text: win.Text,
    DocumentFragment: win.DocumentFragment,
    SVGElement: win.SVGElement,
    HTMLButtonElement: win.HTMLButtonElement,
    navigator: win.navigator,
    location: win.location,
    getComputedStyle: win.getComputedStyle.bind(win),
    requestAnimationFrame: (cb: FrameRequestCallback): number => {
      const handle = win.requestAnimationFrame(cb as unknown as (time: number) => void);
      return Number(handle);
    },
    cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
    MutationObserver: win.MutationObserver,
    Event: win.Event,
    CustomEvent: win.CustomEvent,
    KeyboardEvent: win.KeyboardEvent,
    MouseEvent: win.MouseEvent,
    FocusEvent: win.FocusEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  Object.assign(globalThis as object, bag);
  return win;
}

describe('TodoStrip interaction', () => {
  let win: Window;
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
    restoreGlobals();
  });

  test('opens and closes on click, keeps aria-expanded/hidden in agreement, and holds focus', async () => {
    await act(async () => {
      root.render(createElement(TodoStrip, { phases: TODO_STRIP_PHASES }));
    });
    const strip = host.querySelector('section[aria-label="Todo"]');
    if (strip === null) throw new Error('missing todo strip');
    const buttonEl = strip.querySelector('button');
    if (buttonEl === null) throw new Error('missing strip button');
    const button = buttonEl as HTMLElement;
    const bodyId = button.getAttribute('aria-controls');
    if (bodyId === null) throw new Error('missing aria-controls');
    const body = strip.querySelector(`[id="${bodyId}"]`);
    if (body === null) throw new Error('missing strip body');

    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(body.hasAttribute('hidden')).toBe(true);
    expect(strip.textContent).toContain('TODO');
    expect(strip.textContent).toContain('1/12');

    await act(async () => {
      button.focus();
      button.click();
    });
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(body.hasAttribute('hidden')).toBe(false);
    expect((win.document.activeElement as unknown) === button).toBe(true);
    expect(strip.textContent).toContain('Run the suite');

    await act(async () => {
      button.click();
    });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(body.hasAttribute('hidden')).toBe(true);
    expect((win.document.activeElement as unknown) === button).toBe(true);
  });
});

describe('NodeRoom task dispatch bodies', () => {
  const OMP_INPUT: Record<string, unknown> = {
    context: 'Read-only review. **Do not edit.**\n\n- skip formatters\n- report file:line',
    tasks: [
      {
        name: 'ScoutBackoff',
        agent: 'scout',
        task: 'Map every call site of retry_backoff and backoff across crates/, recording file:line, the attempt argument, whether the caller overrides the ceiling, and any nearby jitter configuration — TAILMARKER.',
      },
      {
        name: 'ScoutCI',
        agent: 'scout',
        task: 'Where is CARGO_BUILD_JOBS pinned in .github/workflows?',
      },
    ],
  };

  type ToolItem = Extract<AgentHistoryItem, { kind: 'tool' }>;

  function taskToolItem(
    input: Record<string, unknown>,
    toolUseId: string,
    overrides: Partial<ToolItem> = {}
  ): ToolItem {
    return toolItem({
      id: toolUseId,
      toolUseId,
      name: 'Task',
      input,
      outputState: 'full',
      durationMs: null,
      canLoadFullOutput: false,
      ...overrides,
    });
  }

  /** A subtask card is one flat details — no nested details inside it. */
  function cardMarkup(row: string, index: number): string {
    const marker = `<details data-subtask-index="${index}"`;
    const start = row.indexOf(marker);
    if (start < 0) throw new Error(`subtask card ${index} not found: ${row}`);
    const end = row.indexOf('</details>', start);
    if (end < 0) throw new Error(`subtask card ${index} never closes`);
    return row.slice(start, end + '</details>'.length);
  }

  test('OMP batch: collapsed row carries the subagent badge and no body', () => {
    const markup = renderRoom({ items: [taskToolItem(OMP_INPUT, 'task-omp')] });
    const row = rowMarkup(markup, 'task-omp');
    expect(rowOpenTag(row)).not.toMatch(/\sopen(\s|=|>)/);
    expect(summaryMarkup(row)).toContain('2 subagents');
    // The shared body-bar text and cards mount only once the row opens.
    expect(row).not.toContain('>task · batch · 2 subtasks<');
    expect(row.match(/data-subtask-index="\d+"/g)).toBeNull();
  });

  test('OMP batch body: markdown context precedes one card per subtask, after the Raw bar', () => {
    const markup = renderRoom({
      items: [taskToolItem(OMP_INPUT, 'task-omp', { outcome: 'failed' })],
    });
    const row = rowMarkup(markup, 'task-omp');
    expect(rowOpenTag(row)).toMatch(/\sopen(\s|=|>)/);
    const body = row.slice(row.indexOf('</summary>'));
    expect(body).toContain('>task · batch · 2 subtasks<');
    const rawAt = body.indexOf('>Raw<');
    const contextAt = body.indexOf('Read-only review.');
    const firstCardAt = body.indexOf('data-subtask-index="0"');
    const secondCardAt = body.indexOf('data-subtask-index="1"');
    expect(rawAt).toBeGreaterThan(-1);
    expect(contextAt).toBeGreaterThan(-1);
    expect(rawAt).toBeLessThan(contextAt);
    expect(contextAt).toBeLessThan(firstCardAt);
    expect(firstCardAt).toBeLessThan(secondCardAt);
    expect(body.match(/data-subtask-index="\d+"/g)).toHaveLength(2);
    expect(body).not.toContain('>Input<');
    expect(body).not.toContain('>Output<');
  });

  test('subtask card anatomy: approval agent, bold name, secondary excerpt, prompt only inside', () => {
    const markup = renderRoom({
      items: [taskToolItem(OMP_INPUT, 'task-omp', { outcome: 'failed' })],
    });
    const row = rowMarkup(markup, 'task-omp');
    const card = cardMarkup(row, 0);
    expect(card).toContain('group/subtask');
    expect(card).toContain('mt-[5px]');
    expect(card).toContain('rounded-[6px]');
    expect(card).toContain('bg-surface-elevated');
    expect(card).toContain('px-[9px]');
    expect(card).toContain('py-[6px]');

    const summary = summaryMarkup(card);
    expect(summary).toContain('min-h-[24px]');
    expect(summary).toContain('text-[11.5px]');
    expect(summary).toContain('whitespace-nowrap');
    expect(summary).toContain('focus-visible:outline-accent-bright');
    expect(summary).toContain('-outline-offset-2');
    const agent = /<span class="[^"]*text-node-approval[^"]*">([^<]*)<\/span>/.exec(summary);
    expect(agent?.[1]).toBe('scout');
    const agentGroup = /<span class="([^"]*)"><span class="[^"]*text-node-approval/.exec(summary);
    expect(agentGroup?.[1]).toContain('min-w-0');
    expect(agentGroup?.[1]).toContain('shrink');
    expect(agentGroup?.[1]).toContain('overflow-hidden');
    expect(agentGroup?.[1]).toContain('text-ellipsis');
    const name = /<span class="([^"]*font-bold[^"]*)"[^>]*>([^<]*)<\/span>/.exec(summary);
    expect(name?.[2]).toBe('ScoutBackoff');
    expect(name?.[1]).toContain('min-w-0');
    expect(name?.[1]).toContain('shrink');
    expect(name?.[1]).toContain('overflow-hidden');
    expect(name?.[1]).toContain('text-ellipsis');
    expect(summary).toContain('text-text-secondary');
    // Excerpt is the collapsed-whitespace prefix — the tail stays in the nested body.
    expect(summary).toContain('Map every call site');
    expect(summary).not.toContain('TAILMARKER');

    const chevron = /<span aria-hidden="true" class="([^"]*)">▶<\/span>/.exec(summary);
    const classes = chevron?.[1].split(' ') ?? [];
    expect(classes).toContain('group-open/subtask:rotate-90');
    expect(classes).not.toContain('rotate-90');
    expect(classes).toContain('w-[9px]');
    expect(classes).toContain('text-[10px]');
    expect(classes).toContain('duration-[120ms]');
    expect(classes).toContain('motion-reduce:transition-none');

    const box = card.slice(card.indexOf('</summary>'));
    expect(box).toContain('TAILMARKER');
    expect(box).toContain('whitespace-pre-wrap');
    expect(box).toContain('break-words');
    expect(box).toContain('bg-surface-inset');
    // Payload strings are React text — never attributes.
    expect(card).not.toContain('title=');
    expect(card).not.toContain('aria-label=');
  });

  test('Claude single dispatch: single-dispatch bar, exactly one card, no context block', () => {
    const markup = renderRoom({
      items: [
        taskToolItem(
          {
            description: 'Scout retry-backoff call sites',
            prompt:
              'Find every caller of retry_backoff() and backoff() in crates/, reporting file:line and the attempt argument verbatim.',
            subagent_type: 'Explore',
          },
          'task-claude',
          { name: 'Agent', outcome: 'failed' }
        ),
      ],
    });
    const row = rowMarkup(markup, 'task-claude');
    expect(row).toContain('>task · single dispatch<');
    expect(summaryMarkup(row)).toContain('1 subagent');
    expect(row.match(/data-subtask-index="\d+"/g)).toHaveLength(1);
    // No context block: Raw sits in the bar, then the single card.
    const barAt = row.indexOf('>task · single dispatch<');
    const rawAt = row.indexOf('>Raw<');
    const cardAt = row.indexOf('data-subtask-index="0"');
    expect(barAt).toBeGreaterThan(-1);
    expect(rawAt).toBeGreaterThan(barAt);
    expect(cardAt).toBeGreaterThan(rawAt);
    const card = cardMarkup(row, 0);
    const summary = summaryMarkup(card);
    expect(summary).toContain('>Explore<');
    expect(summary).toContain('Scout retry-backoff call sites');
    expect(card.slice(card.indexOf('</summary>'))).toContain('the attempt argument verbatim.');
  });

  test('Claude single dispatch without subagent_type renders no orphan separator', () => {
    const markup = renderRoom({
      items: [
        taskToolItem(
          {
            description: 'Scout retry-backoff call sites',
            prompt: 'Find every caller of retry_backoff() and backoff() in crates/.',
          },
          'task-claude',
          { name: 'Agent', outcome: 'failed' }
        ),
      ],
    });
    const row = rowMarkup(markup, 'task-claude');
    const summary = summaryMarkup(cardMarkup(row, 0));
    expect(summary).not.toContain('·');
    expect(summary).toContain('Scout retry-backoff call sites');
    expect(summary).toContain('— Find every caller');
  });

  test('singular batch wording uses 1 subtask and 1 subagent', () => {
    const markup = renderRoom({
      items: [
        taskToolItem(
          { context: 'ctx', tasks: [{ name: 'OnlyTask', agent: 'scout', task: 'do it' }] },
          'task-one',
          { outcome: 'failed' }
        ),
      ],
    });
    const row = rowMarkup(markup, 'task-one');
    expect(row).toContain('>task · batch · 1 subtask<');
    expect(summaryMarkup(row)).toContain('1 subagent');
    expect(summaryMarkup(row)).not.toContain('subagents');
  });

  test('the 64-subtask boundary renders every card', () => {
    const tasks = Array.from({ length: 64 }, (_, index) => ({
      name: `subtask-${index}`,
      agent: 'scout',
      task: `prompt ${index}`,
    }));
    const markup = renderRoom({
      items: [taskToolItem({ context: '', tasks }, 'task-max', { outcome: 'failed' })],
    });
    const row = rowMarkup(markup, 'task-max');
    expect(row.match(/data-subtask-index="\d+"/g)).toHaveLength(64);
    expect(row).toContain('data-subtask-index="63"');
    expect(row).toContain('>task · batch · 64 subtasks<');
  });

  test('malformed task input falls back to bounded generic fields with no cards or count badge', () => {
    const markup = renderRoom({
      items: [taskToolItem({ tasks: 'nope', note: 'x' }, 'task-bad', { outcome: 'failed' })],
    });
    const row = rowMarkup(markup, 'task-bad');
    expect(row.match(/data-subtask-index="\d+"/g)).toBeNull();
    expect(summaryMarkup(row)).not.toContain('subagent');
    expect(row).toContain('>task<');
    const body = row.slice(row.indexOf('</summary>'));
    expect(body).toContain('>tasks<');
    expect(body).toContain('>nope<');
    expect(body).toContain('>note<');
    expect(body).toContain('>x<');
    // Generic rows are key/value text — never a serialized dump.
    expect(body).not.toContain('"tasks"');
  });

  test('task context markdown keeps structure and suppresses images, unsafe links, and raw HTML', () => {
    const input: Record<string, unknown> = {
      context:
        'Intro **bold** tail\n\n- first\n- second\n\n![tracker](https://tracker.example/pixel.png)\n\n[click](javascript:alert(1))\n\n<div onclick="boom()">raw</div>',
      tasks: [{ name: 'ScoutBackoff', agent: 'scout', task: 'do it' }],
    };
    const markup = renderRoom({
      items: [taskToolItem(input, 'task-md', { outcome: 'failed' })],
    });
    const row = rowMarkup(markup, 'task-md');
    // Raw JSON is not in the DOM while closed; sanitize the readable body
    // (bar through the first card, which holds the prompt).
    const body = row.slice(row.indexOf('</summary>'), row.indexOf('data-subtask-index'));
    expect(body).toContain('<strong>bold</strong>');
    expect(body).toContain('>first</li>');
    expect(body).not.toContain('<img');
    expect(body).not.toContain('javascript:');
    expect(body).not.toContain('<div onclick');
    expect(body).toContain('>click</a>');
  });
});

describe('NodeRoom tool bodies', () => {
  /** The expanded region markup: everything after the row summary. */
  function bodyOf(markup: string, toolUseId: string): string {
    const row = rowMarkup(markup, toolUseId);
    const start = row.indexOf('</summary>');
    if (start < 0) throw new Error('summary missing');
    return row.slice(start + '</summary>'.length);
  }

  test('terminal body: $ prompt in node-bash, bounded command, output, FAILED word + error color', () => {
    const items: AgentHistoryItem[] = [
      openToolItem({
        toolUseId: 't-sh',
        name: 'Bash',
        input: { command: 'npm test' },
        output: 'boom',
        outcome: 'failed',
        exitCode: 1,
      }),
    ];
    const body = bodyOf(renderRoom({ items }), 't-sh');
    expect(body).toContain('tool-family-body');
    expect(body).toContain('text-node-bash">$</span>');
    expect(body).toContain('npm test');
    expect(body).toContain('boom');
    // Failure is a word, not colour alone — and the word carries the error mix.
    expect(body).toContain('FAILED');
    expect(body).toContain('var(--error)');
    expect(body).toContain('font-bold');
  });

  test('terminal body states: running copy, empty output copy, unreadable copy', () => {
    const items: AgentHistoryItem[] = [
      openToolItem({
        toolUseId: 't-run',
        name: 'Bash',
        input: { command: 'npm test' },
        output: undefined,
        outcome: 'running',
        outputState: 'missing',
        canLoadFullOutput: false,
        durationMs: null,
      }),
      openToolItem({
        toolUseId: 't-quiet',
        name: 'Bash',
        input: { command: 'true' },
        output: undefined,
        outputState: 'full',
        canLoadFullOutput: false,
        durationMs: null,
      }),
      openToolItem({
        toolUseId: 't-corrupt',
        name: 'Bash',
        input: { command: 'x' },
        output: '{"unterminated',
        canLoadFullOutput: false,
        durationMs: null,
      }),
    ];
    const markup = renderRoom({ items });
    expect(bodyOf(markup, 't-run')).toContain('running — no output yet');
    expect(bodyOf(markup, 't-quiet')).toContain('>no output<');
    expect(bodyOf(markup, 't-corrupt')).toContain('output unreadable — open Raw');
  });

  test('file body: node-command path then preview; no-preview and unreadable states', () => {
    const items: AgentHistoryItem[] = [
      openToolItem({ toolUseId: 't-file', input: { path: 'a.ts' }, output: 'chunk' }),
      openToolItem({
        toolUseId: 't-nopreview',
        input: { path: 'b.ts' },
        output: undefined,
        outputState: 'missing',
        canLoadFullOutput: false,
      }),
      openToolItem({
        toolUseId: 't-unread',
        input: { path: 'c.ts' },
        output: '{"unterminated',
        canLoadFullOutput: false,
      }),
    ];
    const markup = renderRoom({ items });
    const file = bodyOf(markup, 't-file');
    expect(file).toContain('text-node-command">a.ts<');
    expect(file).toContain('chunk');
    expect(file.indexOf('a.ts')).toBeLessThan(file.indexOf('chunk'));
    const none = bodyOf(markup, 't-nopreview');
    expect(none).toContain('text-node-command">b.ts<');
    expect(none).toContain('>no preview<');
    const unreadable = bodyOf(markup, 't-unread');
    expect(unreadable).toContain('output unreadable — open Raw');
  });

  describe('file-edit diff bodies', () => {
    const BACKOFF_BEFORE =
      '  pub fn backoff(attempt: u32) -> Duration {\n' +
      '     let secs = 2u64.pow(attempt).min(31);\n' +
      '     Duration::from_secs(secs + 1)\n' +
      '  }';
    const BACKOFF_AFTER =
      '  pub fn backoff(attempt: u32) -> Duration {\n' +
      '     let secs = 2u64.pow(attempt).min(30);\n' +
      '     Duration::from_secs(secs)\n' +
      '  }';
    const EDIT_INPUT: Record<string, unknown> = {
      file_path: 'src/auto_retry.rs',
      old_string: BACKOFF_BEFORE,
      new_string: BACKOFF_AFTER,
      replace_all: false,
    };

    function editItem(
      toolUseId: string,
      overrides: Partial<Extract<AgentHistoryItem, { kind: 'tool' }>> = {}
    ): Extract<AgentHistoryItem, { kind: 'tool' }> {
      return openToolItem({
        toolUseId,
        name: 'Edit',
        input: EDIT_INPUT,
        output: 'File updated successfully',
        outputState: 'full',
        canLoadFullOutput: false,
        ...overrides,
      });
    }

    test('changed pair: path first, one unified table in jsdiff order, markers, snippet numbers', () => {
      const body = bodyOf(renderRoom({ items: [editItem('t-edit')] }), 't-edit');
      expect(body).toContain('text-node-command">src/auto_retry.rs<');
      expect(body.indexOf('src/auto_retry.rs')).toBeLessThan(body.indexOf('tool-diff'));
      expect(body).toContain('diff diff-unified tool-diff');
      // jsdiff order for this fixture: context, both deletes, both inserts, context.
      const cellTypes = [...body.matchAll(/diff-code diff-code-(normal|delete|insert)/g)].map(
        match => match[1]
      );
      expect(cellTypes).toEqual(['normal', 'delete', 'delete', 'insert', 'insert', 'normal']);
      // The +/− markers are the required non-color cue, exposed to AT.
      const markers = [...body.matchAll(/tool-diff-marker">([^<]*)</g)].map(match => match[1]);
      expect(markers).toEqual(['', '−', '−', '+', '+', '']);
      const numbers = [...body.matchAll(/tool-diff-line-number">([^<]*)</g)].map(match => match[1]);
      expect(numbers).toEqual(['1', '2', '3', '2', '3', '4']);
      // The duplicated new-side gutter cells react-diff-view emits stay empty;
      // CSS hides them — only the old-side cell carries content.
      expect(body.match(/diff-gutter-[a-z]+" data-change-key="[^"]+"><\/td>/g)?.length).toBe(6);
      // One hunk needs no @@ decoration row.
      expect(body).not.toContain('diff-decoration');
      // Success prose stays behind Raw; the sent payload never serializes.
      expect(body).not.toContain('File updated successfully');
      expect(body).not.toContain('old_string');
    });

    test('summary carries +2/−2 badges; the bar shows hunk and replace_all facts without counts', () => {
      const markup = renderRoom({ items: [editItem('t-edit')] });
      const row = rowMarkup(markup, 't-edit');
      const summary = summaryMarkup(row);
      expect(badgeMarkup(summary, '+2')).toContain('text-success');
      const removed = badgeMarkup(summary, '−2');
      expect(removed).toContain('var(--error)');
      // The bar keeps the facts and drops the diff badges — no repeated counts.
      const body = bodyOf(markup, 't-edit');
      const bar = /<span class="[^"]*whitespace-nowrap[^"]*"[^>]*>([^<]*)<\/span>/.exec(body);
      expect(bar?.[1]).toBe('file · 1 hunk · replace_all: false · 1.5s');
      expect(bar?.[1]).not.toContain('+2');
      expect(bar?.[1]).not.toContain('−2');
    });

    test('a failed row keeps the table and adds its normalized output in a second inset box', () => {
      const body = bodyOf(
        renderRoom({
          items: [
            editItem('t-edit-fail', {
              output: 'edit failed: permission denied',
              outcome: 'failed',
              exitCode: 1,
            }),
          ],
        }),
        't-edit-fail'
      );
      expect(body.match(/tool-family-body/g)?.length).toBe(2);
      expect(body).toContain('diff diff-unified tool-diff');
      expect(body.indexOf('tool-diff')).toBeLessThan(body.indexOf('permission denied'));
      // The failure output lives in the second box, not the diff box.
      const boxes = body.split('tool-family-body');
      expect(boxes[1]).not.toContain('permission denied');
      expect(boxes[2]).toContain('edit failed: permission denied');
      expect(body).toContain('mt-1.5');
    });

    test('later hunks get a text-only @@ decoration; the first hunk has none', () => {
      const before = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join('\n');
      const after = Array.from({ length: 20 }, (_, index) =>
        index === 4 || index === 15 ? `line ${index + 1} changed` : `line ${index + 1}`
      ).join('\n');
      const body = bodyOf(
        renderRoom({
          items: [
            openToolItem({
              toolUseId: 't-two',
              name: 'Edit',
              input: { file_path: 'src/two.ts', old_string: before, new_string: after },
              output: 'done',
              outputState: 'full',
              canLoadFullOutput: false,
            }),
          ],
        }),
        't-two'
      );
      expect(body).toContain('diff diff-unified tool-diff');
      // Exactly one decoration: the second hunk's synthesized header.
      expect(body.match(/<tbody class="diff-decoration"/g)?.length).toBe(1);
      expect(body).toContain('diff-decoration-content');
      expect(body).toContain('colSpan="3"');
      expect(body).toContain('@@ -12,9 +12,9 @@');
      // It sits between hunk one's last line and hunk two's first line.
      expect(body.indexOf('>line 9<')).toBeLessThan(body.indexOf('@@ -12,9 +12,9 @@'));
      expect(body.indexOf('@@ -12,9 +12,9 @@')).toBeLessThan(body.indexOf('>line 12<'));
      expect(body).toContain('file · 2 hunks · 1.5s');
    });

    test('identical sides render the no-changes note with no table or diff badges', () => {
      const same = 'same content\nsecond line';
      const markup = renderRoom({
        items: [
          openToolItem({
            toolUseId: 't-same',
            name: 'Edit',
            input: { file_path: 'same.ts', old_string: same, new_string: same },
            output: 'done',
            outputState: 'full',
            canLoadFullOutput: false,
          }),
        ],
      });
      const body = bodyOf(markup, 't-same');
      expect(body).toContain('text-node-command">same.ts<');
      expect(body).toContain('>no changes<');
      expect(body).not.toContain('tool-diff');
      expect(body).toContain('file · no changes · 1.5s');
      const summary = summaryMarkup(rowMarkup(markup, 't-same'));
      expect(summary).not.toContain('>+');
      expect(summary).not.toContain('>−');
    });

    test('one-sided, no-input, and refused pairs keep the path-plus-preview fallback', () => {
      const markup = renderRoom({
        items: [
          openToolItem({
            toolUseId: 't-write',
            name: 'Write',
            input: { file_path: 'w.ts', content: 'brand new file' },
            output: 'written',
          }),
          openToolItem({
            toolUseId: 't-naked',
            name: 'Edit',
            input: {},
            output: 'done',
            outputState: 'full',
            canLoadFullOutput: false,
          }),
          openToolItem({
            toolUseId: 't-huge',
            name: 'Edit',
            input: { file_path: 'big.ts', old_string: 'x'.repeat(70_000), new_string: 'y' },
            output: 'done',
          }),
        ],
      });
      // One-sided Write: content alone never fabricates an after side.
      const write = bodyOf(markup, 't-write');
      expect(write).toContain('text-node-command">w.ts<');
      expect(write).toContain('written');
      expect(write).not.toContain('tool-diff');
      expect(write).toContain('file · truncated · 1.5s');
      // Bare Edit input: the family label stands in for the path, preview shown.
      const naked = bodyOf(markup, 't-naked');
      expect(naked).toContain('text-node-command">Edit<');
      expect(naked).toContain('done');
      expect(naked).not.toContain('tool-diff');
      // Over-limit pair: the differ refuses and the row falls back intact.
      const huge = bodyOf(markup, 't-huge');
      expect(huge).toContain('text-node-command">big.ts<');
      expect(huge).toContain('done');
      expect(huge).not.toContain('tool-diff');
      expect(huge).toContain('file · truncated · 1.5s');
      // None of the three rows earns a hunk fact or a diff badge.
      for (const id of ['t-write', 't-naked', 't-huge']) {
        const body = bodyOf(markup, id);
        expect(body).not.toContain('hunk');
        expect(body).not.toContain('no changes');
        const summary = summaryMarkup(rowMarkup(markup, id));
        expect(summary).not.toContain('>+');
        expect(summary).not.toContain('>−');
      }
    });

    test('control characters render as bounded escapes, one DOM row per change', () => {
      const body = bodyOf(
        renderRoom({
          items: [
            openToolItem({
              toolUseId: 't-ctl',
              name: 'Edit',
              input: {
                file_path: 'ctl.ts',
                old_string: 'plain',
                new_string: 'mark\u{2028}\u{001B}[31mred',
              },
              output: 'done',
              outputState: 'full',
              canLoadFullOutput: false,
            }),
          ],
        }),
        't-ctl'
      );
      // One hunk, one delete row, one insert row — each change is one DOM row.
      expect(body.match(/<tr class="diff-line"/g)?.length).toBe(2);
      expect(body.match(/diff-code-delete/g)?.length).toBe(1);
      expect(body.match(/diff-code-insert/g)?.length).toBe(1);
      // ANSI is stripped; U+2028 survives only as the visible escape text.
      const insert = /diff-code-insert"[^>]*>([^<]*)</.exec(body)?.[1] ?? '';
      expect(insert).toBe('mark\\u{2028}red');
      expect(body).not.toContain('\u{2028}');
      expect(body).not.toContain('\u{001B}');
    });
  });

  test('matches body: pattern + scope header, path:line rows, and text-only lines', () => {
    const items: AgentHistoryItem[] = [
      openToolItem({
        toolUseId: 't-grep',
        name: 'Grep',
        input: { pattern: 'fn x', path: 'crates/', output_mode: 'content' },
        output: 'src/a.ts:12: hit\nplain tail',
      }),
    ];
    const body = bodyOf(renderRoom({ items }), 't-grep');
    expect(body).toContain('>fn x<');
    expect(body).toContain(' in crates/');
    expect(body).toContain('text-node-command">src/a.ts<');
    expect(body).toContain('text-text-secondary">:12<');
    expect(body).toContain('hit');
    // A line that is not path:line: stays as plain text.
    expect(body).toContain('plain tail');
  });

  test('paths body: one node-command path per line for grep files_with_matches and glob', () => {
    const items: AgentHistoryItem[] = [
      openToolItem({
        toolUseId: 't-paths',
        name: 'Grep',
        input: { pattern: 'x', output_mode: 'files_with_matches' },
        output: { filenames: ['src/a.ts', 'src/b.ts'] },
      }),
      openToolItem({
        toolUseId: 't-glob',
        name: 'glob',
        input: { pattern: '**/*.rs' },
        output: 'src/a.rs\nsrc/b.rs',
      }),
    ];
    const markup = renderRoom({ items });
    const paths = bodyOf(markup, 't-paths');
    expect(paths).toContain('text-node-command">src/a.ts<');
    expect(paths).toContain('text-node-command">src/b.ts<');
    // No line-number parsing on a files_with_matches body.
    expect(paths.match(/text-text-secondary">:\d+</g)).toBeNull();
    const glob = bodyOf(markup, 't-glob');
    expect(glob).toContain('text-node-command">src/a.rs<');
    expect(glob).toContain('text-node-command">src/b.rs<');
  });

  test('list tails: exact remainder is "+n more", an unknowable tail is "more results omitted"', () => {
    const longList = Array.from({ length: 502 }, (_, i) => `f${i}.rs`).join('\n');
    const items: AgentHistoryItem[] = [
      openToolItem({
        toolUseId: 't-more',
        name: 'glob',
        input: { pattern: '**/*.rs' },
        output: longList,
      }),
      openToolItem({
        toolUseId: 't-omitted',
        name: 'glob',
        input: { pattern: '**/*.rs' },
        output: 'x'.repeat(70_000),
      }),
    ];
    const markup = renderRoom({ items });
    expect(bodyOf(markup, 't-more')).toContain('+2 more');
    expect(bodyOf(markup, 't-omitted')).toContain('more results omitted');
  });

  test('code body: fenced source highlights with the language, result in a second box', () => {
    const items: AgentHistoryItem[] = [
      openToolItem({
        toolUseId: 't-code',
        name: 'eval',
        input: { code: 'const answer = 42;', language: 'rust' },
        output: 'ok',
      }),
    ];
    const body = bodyOf(renderRoom({ items }), 't-code');
    expect(body).toContain('language-rust');
    expect(body).toContain('hljs-keyword');
    expect(body.match(/tool-family-body/g)?.length).toBe(2);
    expect(body).toContain('mt-1.5');
    expect(body.indexOf('language-rust')).toBeLessThan(body.indexOf('>ok</div>'));
  });

  test('code body: unknown language renders plain source and a hostile language stays inert', () => {
    const items: AgentHistoryItem[] = [
      openToolItem({
        toolUseId: 't-unknown',
        name: 'eval',
        input: { code: 'select 1', language: 'madeuplang' },
        output: undefined,
        outputState: 'missing',
        canLoadFullOutput: false,
      }),
      openToolItem({
        toolUseId: 't-hostile',
        name: 'eval',
        input: { code: 'x', language: 'rust" onload="alert(1)' },
        output: undefined,
        outputState: 'missing',
        canLoadFullOutput: false,
      }),
    ];
    const markup = renderRoom({ items });
    const unknown = bodyOf(markup, 't-unknown');
    expect(unknown).toContain('select 1');
    expect(unknown).not.toContain('hljs-keyword');
    const hostile = bodyOf(markup, 't-hostile');
    expect(hostile).toContain('x');
    // The value can appear only as escaped bar text — never a language class
    // or an unescaped attribute.
    expect(hostile).toContain('onload=&quot;');
    expect(hostile).not.toContain('" onload="');
    expect(hostile).not.toContain('language-rust');
  });

  test('code body: a fence inside the source can never close the fence early', () => {
    const items: AgentHistoryItem[] = [
      openToolItem({
        toolUseId: 't-fence',
        name: 'eval',
        input: { code: 'const doc = "```";', language: 'js' },
        output: undefined,
        outputState: 'missing',
        canLoadFullOutput: false,
      }),
    ];
    const body = bodyOf(renderRoom({ items }), 't-fence');
    // The inner run survives as literal text inside the highlighted block.
    expect(body).toContain('```');
    expect(body).toContain('doc');
  });

  test('web body: inert url header, title, and stored markdown — no anchors, no fetches', () => {
    const items: AgentHistoryItem[] = [
      openToolItem({
        toolUseId: 't-web',
        name: 'WebFetch',
        input: { url: 'https://doc.io/x' },
        output: { result: 'Read **the** docs', url: 'https://doc.io/x', title: 'Doc Page' },
      }),
      openToolItem({
        toolUseId: 't-search',
        name: 'WebSearch',
        input: { query: 'x' },
        output: { results: [{ title: 'Hit', url: 'https://hit.io' }] },
      }),
    ];
    const markup = renderRoom({ items });
    const web = bodyOf(markup, 't-web');
    expect(web).toContain('text-node-command">https://doc.io/x<');
    expect(web).toContain('font-bold">Doc Page<');
    expect(web).toContain('<strong>the</strong>');
    expect(web).not.toContain('<a ');
    const search = bodyOf(markup, 't-search');
    // Result markdown renders the title plus a parenthesized destination, inert.
    expect(search).toContain('Hit');
    expect(search).toContain('(https://hit.io)');
    expect(search).not.toContain('<a ');
  });

  test('stored markdown attacks render inert: no anchors, images, raw HTML, or scripts', () => {
    const items: AgentHistoryItem[] = [
      openToolItem({
        toolUseId: 't-attack',
        name: 'WebFetch',
        input: { url: 'https://x.io' },
        output: {
          result:
            '[click](https://e.io) ![pic](https://e.io/p.png) https://auto.io ' +
            '[x](javascript:alert(1)) <script>alert(1)</script> <b onmouseover="hack()">hi</b>',
          url: 'https://x.io',
        },
      }),
    ];
    const body = bodyOf(renderRoom({ items }), 't-attack');
    expect(body).not.toContain('<a ');
    expect(body).not.toContain('<img');
    expect(body).not.toContain('<script');
    expect(body).not.toContain('onmouseover="');
    expect(body).not.toContain('javascript:');
    // Link label plus parenthesized destination; bare autolinks dedupe.
    expect(body).toContain('click');
    expect(body).toContain('(https://e.io)');
    expect(body).toContain('pic');
    expect(body).toContain('[image omitted]');
    expect(body.match(/https:\/\/auto\.io/g)?.length).toBe(1);
    // Raw HTML survives only as escaped text — never as live markup.
    expect(body).toContain('&lt;script&gt;');
    expect(body).toContain('&lt;b onmouseover=&quot;hack()&quot;&gt;hi&lt;/b&gt;');
  });

  test('generic body: at most three key:value rows, {…}/[n] markers, sent name in the bar', () => {
    const items: AgentHistoryItem[] = [
      openToolItem({
        toolUseId: 't-gen',
        name: 'get_command_or_subagent_output',
        input: { command_id: 'cmd_7f3a', tags: ['a', 'b'], filters: { x: 1 }, extra: 'dropped' },
        output: 'plain note',
      }),
    ];
    const body = bodyOf(renderRoom({ items }), 't-gen');
    // The 30-char name cannot ride the chip, so the body bar carries it whole.
    expect(body).toContain('generic · get_command_or_subagent_output');
    expect(body.match(/w-\[11ch\]/g)?.length).toBe(3);
    expect(body).toContain('cmd_7f3a');
    expect(body).toContain('[2]');
    expect(body).toContain('{…}');
    expect(body).not.toContain('dropped');
    // No serialized-object syntax survives into the generic body.
    expect(body).not.toContain('&quot;');
    expect(body).toContain('plain note');
  });

  test('todo and task rows open to the bar and Raw toggle with no body box', () => {
    const items: AgentHistoryItem[] = [
      openToolItem({
        toolUseId: 't-todo',
        name: 'todo',
        input: { todos: [{ content: 'x' }] },
        canLoadFullOutput: false,
      }),
      openToolItem({
        toolUseId: 't-task',
        name: 'Task',
        input: { description: 'd', prompt: 'p' },
        canLoadFullOutput: false,
      }),
    ];
    const markup = renderRoom({ items });
    for (const id of ['t-todo', 't-task']) {
      const body = bodyOf(markup, id);
      expect(body).not.toContain('tool-family-body');
      expect(body).toContain('aria-expanded="false"');
      expect(body).toContain('>Raw');
    }
  });
});

describe('NodeRoom occurrence headings', () => {
  function headingTexts(markup: string): string[] {
    return [...markup.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/g)].map(match =>
      visibleText(match[1] ?? '')
    );
  }

  test('renders no occurrence headings and no navigator for zero or one occurrence', () => {
    const unscoped: AgentHistoryItem[] = [
      assistantItem('a1', 1, 'solo'),
      lifecycleItem('s1', 2, 'completed'),
    ];
    const flat = renderRoom({ items: unscoped, occurrenceGrouping: groupByOccurrence(unscoped) });
    expect(flat).not.toContain('<h3');
    expect(flat).not.toContain('Jump to');

    const single: AgentHistoryItem[] = [
      assistantItem('a1', 1, 'solo', execution('occ-a')),
      lifecycleItem('s1', 2, 'completed', null, execution('occ-a')),
    ];
    const oneGroup = renderRoom({ items: single, occurrenceGrouping: groupByOccurrence(single) });
    expect(oneGroup).not.toContain('<h3');
    expect(oneGroup).not.toContain('Jump to');
  });

  test('renders one h3 heading per occurrence in group order with the exact core labels', () => {
    const items: AgentHistoryItem[] = [
      lifecycleItem('s1', 1, 'started', null, execution('occ-a', { retry_epoch: 0 })),
      assistantItem('a1', 2, 'first-run', execution('occ-a', { retry_epoch: 0 })),
      assistantItem('a2', 3, 'second-run', execution('occ-b', { retry_epoch: 1 })),
      lifecycleItem('s2', 4, 'failed', null, execution('occ-b', { retry_epoch: 1 })),
    ];
    const markup = renderRoom({ items, occurrenceGrouping: groupByOccurrence(items) });
    expect(headingTexts(markup)).toEqual(['Run 1', 'Run 2 · retry · failed']);
    expect(markup.match(/<h3/g)?.length).toBe(2);
    expect(markup.match(/<h3[^>]*tabindex="-1"/g)?.length).toBe(2);
    expect(markup).toContain('id="test-room-occ-occ-a"');
    expect(markup).toContain('id="test-room-occ-occ-b"');
    const headingTag = /<h3[^>]*>/.exec(markup)?.[0] ?? '';
    expect(headingTag).toContain('font-mono');
    expect(headingTag).toContain('text-[10.5px]');
    expect(headingTag).toContain('uppercase');
    expect(headingTag).toContain('tracking-[0.08em]');
    expect(headingTag).toContain('text-text-secondary');
    expect(headingTag).toContain('mt-[10px]');
    expect(headingTag).toContain('mb-[5px]');
    expect(markup).toContain('bg-border');
    expect(markup.indexOf('Run 1')).toBeLessThan(markup.indexOf('first-run'));
    expect(markup.indexOf('first-run')).toBeLessThan(markup.indexOf('Run 2'));
    expect(markup.indexOf('Run 2')).toBeLessThan(markup.indexOf('second-run'));
  });

  test('disambiguates colliding base labels into distinct B4-qualified headings', () => {
    const routed: AgentHistoryItem[] = [
      assistantItem(
        'a1',
        1,
        'route one',
        execution('occ-a', { retry_epoch: 0, route_activation_seq: 1 })
      ),
      assistantItem(
        'a2',
        2,
        'route two',
        execution('occ-b', { retry_epoch: 0, route_activation_seq: 2 })
      ),
    ];
    const markup = renderRoom({ items: routed, occurrenceGrouping: groupByOccurrence(routed) });
    expect(headingTexts(markup)).toEqual(['Run 1 #1', 'Run 1 #2']);

    const nested: AgentHistoryItem[] = [
      assistantItem(
        'a1',
        1,
        'x',
        execution('occ-a', {
          loop_ancestry: [
            { node_id: 'outer', iteration: 1 },
            { node_id: 'inner', iteration: 3 },
          ],
        })
      ),
      assistantItem(
        'a2',
        2,
        'y',
        execution('occ-b', {
          loop_ancestry: [
            { node_id: 'outer', iteration: 2 },
            { node_id: 'inner', iteration: 3 },
          ],
        })
      ),
    ];
    const nestedMarkup = renderRoom({
      items: nested,
      occurrenceGrouping: groupByOccurrence(nested),
    });
    expect(headingTexts(nestedMarkup)).toEqual([
      'Iteration 1 › Iteration 3',
      'Iteration 2 › Iteration 3',
    ]);
  });

  test('renders no extra heading for multiple attempts inside one occurrence', () => {
    const items: AgentHistoryItem[] = [
      assistantItem(
        'a1',
        1,
        'attempt one',
        execution('occ-a', { attempt_id: 'att-1', retry_epoch: 0 })
      ),
      assistantItem(
        'a2',
        2,
        'attempt two',
        execution('occ-a', { attempt_id: 'att-2', retry_epoch: 0 })
      ),
      assistantItem('b1', 3, 'other', execution('occ-b', { retry_epoch: 1 })),
    ];
    const markup = renderRoom({ items, occurrenceGrouping: groupByOccurrence(items) });
    expect(headingTexts(markup)).toEqual(['Run 1', 'Run 2 · retry']);
    expect(markup.match(/<h3/g)?.length).toBe(2);
    expect(markup.indexOf('attempt one')).toBeLessThan(markup.indexOf('attempt two'));
    expect(markup.indexOf('attempt two')).toBeLessThan(markup.indexOf('Run 2'));
  });

  test('renders a leading unscoped prefix once before the first heading', () => {
    const items: AgentHistoryItem[] = [
      assistantItem('pre', 1, 'before-scope'),
      assistantItem('a1', 2, 'scoped-a', execution('occ-a', { retry_epoch: 0 })),
      assistantItem('b1', 3, 'scoped-b', execution('occ-b', { retry_epoch: 1 })),
    ];
    const markup = renderRoom({ items, occurrenceGrouping: groupByOccurrence(items) });
    expect(markup.match(/before-scope/g)?.length).toBe(1);
    expect(markup.indexOf('before-scope')).toBeLessThan(markup.indexOf('<h3'));
    expect(headingTexts(markup)).toEqual(['Run 1', 'Run 2 · retry']);
  });

  test('renders non-contiguous occurrence rows once under one unique heading', () => {
    const items: AgentHistoryItem[] = [
      assistantItem('a1', 1, 'a-first', execution('occ-a', { retry_epoch: 0 })),
      assistantItem('b1', 2, 'b-first', execution('occ-b', { retry_epoch: 1 })),
      assistantItem('a2', 3, 'a-second', execution('occ-a', { retry_epoch: 0 })),
    ];
    const markup = renderRoom({ items, occurrenceGrouping: groupByOccurrence(items) });
    expect(headingTexts(markup)).toEqual(['Run 1', 'Run 2 · retry']);
    expect(markup.match(/a-second/g)?.length).toBe(1);
    expect(markup.indexOf('a-first')).toBeLessThan(markup.indexOf('a-second'));
    expect(markup.indexOf('a-second')).toBeLessThan(markup.indexOf('Run 2'));
    expect(markup.indexOf('Run 2')).toBeLessThan(markup.indexOf('b-first'));
  });

  test('keeps assistant, tool, and lifecycle order stable inside each group', () => {
    const items: AgentHistoryItem[] = [
      assistantItem('a1', 1, 'notes-a', execution('occ-a')),
      toolItem({ id: 't1', toolUseId: 't1', seq: 2, execution: execution('occ-a') }),
      lifecycleItem('s1', 3, 'completed', null, execution('occ-a')),
      assistantItem('a2', 4, 'notes-b', execution('occ-b')),
      toolItem({ id: 't2', toolUseId: 't2', seq: 5, execution: execution('occ-b') }),
      lifecycleItem('s2', 6, 'failed', null, execution('occ-b')),
    ];
    const markup = renderRoom({ items, occurrenceGrouping: groupByOccurrence(items) });
    expect(headingTexts(markup)).toEqual(['Run 1', 'Run 1 · occurrence 2 · failed']);
    const secondHeading = markup.indexOf('Run 1 · occurrence 2');
    expect(markup.indexOf('notes-a')).toBeLessThan(markup.indexOf('data-tool-id="t1"'));
    expect(markup.indexOf('data-tool-id="t1"')).toBeLessThan(markup.indexOf('completed'));
    expect(markup.indexOf('completed')).toBeLessThan(secondHeading);
    expect(secondHeading).toBeLessThan(markup.indexOf('notes-b'));
    expect(markup.indexOf('notes-b')).toBeLessThan(markup.indexOf('data-tool-id="t2"'));
    expect(markup.indexOf('data-tool-id="t2"')).toBeLessThan(markup.lastIndexOf('failed'));
  });

  test('keeps renderAfterItem attached to its item and renderAtEnd after all groups', () => {
    const items: AgentHistoryItem[] = [
      assistantItem('a1', 1, 'alpha', execution('occ-a')),
      toolItem({ id: 't1', toolUseId: 't1', seq: 2, execution: execution('occ-b') }),
    ];
    const markup = renderRoom({
      items,
      occurrenceGrouping: groupByOccurrence(items),
      renderAfterItem: (item): string => `after-${item.id}`,
      renderAtEnd: 'end-extension',
    });
    expect(markup.indexOf('after-a1')).toBeGreaterThan(markup.indexOf('alpha'));
    expect(markup.indexOf('after-a1')).toBeLessThan(markup.indexOf('Run 1 · occurrence 2'));
    expect(markup.indexOf('after-t1')).toBeGreaterThan(markup.indexOf('data-tool-id="t1"'));
    expect(markup.indexOf('end-extension')).toBeGreaterThan(markup.indexOf('after-t1'));
  });

  test('keeps the partial-page error, retry, and unknown-scope warning visible', () => {
    const items: AgentHistoryItem[] = [
      assistantItem('a1', 1, 'alpha', execution('occ-a')),
      assistantItem('b1', 2, 'beta', execution('occ-b')),
    ];
    const markup = renderRoom({
      items,
      occurrenceGrouping: groupByOccurrence(items),
      error: 'boom',
      unknownScope: true,
    });
    expect(headingTexts(markup)).toEqual(['Run 1', 'Run 1 · occurrence 2']);
    expect(markup).toContain('Execution scope was not recorded');
    expect(markup).toContain('Failed to load node transcript');
    expect(markup).toContain('Retry');
    expect(markup.indexOf('Failed to load node transcript')).toBeGreaterThan(
      markup.indexOf('beta')
    );
  });

  test('never lets item content text alter the headings', () => {
    const items: AgentHistoryItem[] = [
      assistantItem('a1', 1, 'Run 99', execution('occ-a')),
      assistantItem('a2', 2, 'Iteration 99', execution('occ-b')),
    ];
    const markup = renderRoom({ items, occurrenceGrouping: groupByOccurrence(items) });
    expect(headingTexts(markup)).toEqual(['Run 1', 'Run 1 · occurrence 2']);
  });
});
