import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import type { AgentHistoryItem } from '@/lib/agent-history';
import type { WorkflowNodeMessageResponse } from '@/lib/api';
import { toolRowPresentation } from '@/lib/tool-presentation';

import { NodeRoom, selectNodeRoomMessages } from './NodeRoom';

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
    expect(row).not.toContain('truncated-output');
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
    expect(bar?.[2]).toContain('whitespace-nowrap');
    expect(bar?.[2]).toContain('overflow-hidden');
    expect(bar?.[4]).toContain('aria-expanded="false"');
    expect(bar?.[4]).toContain('type="button"');

    // The file body arm: node-command path, then the preview, in the inset box.
    expect(body).toContain('tool-family-body');
    expect(body).toContain('bg-surface-inset');
    expect(body).toContain('text-node-command">a.ts<');
    expect(body).toContain('truncated-output');
    // No nested disclosures survive; Raw is the only body toggle.
    expect(/<details/.exec(body)).toBeNull();
    expect(body).not.toContain('>Input<');
    expect(body).not.toContain('>Output<');
    // Body precedes the full-output control.
    expect(body.indexOf('tool-family-body')).toBeLessThan(body.indexOf('View full output'));
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
    // Non-tool content keeps its own vertical margins.
    expect(markup).toContain('<div class="my-1.5"><div class="chat-markdown');
    expect(markup).toContain(
      '<div class="my-1.5"><p class="text-xs text-text-secondary">completed'
    );
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
