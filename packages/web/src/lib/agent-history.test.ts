import { describe, expect, test } from 'bun:test';

import type { components } from './api.generated';
import type { NodeMessageRow } from './node-message-pages';
import {
  buildAgentHistory,
  initialToolExpanded,
  toolContext,
  toolRowView,
  toolRuntime,
  type AgentHistoryItem,
  type ToolOutcome,
} from './agent-history';

const CREATED_AT = '2026-09-08T00:00:00.000Z';
const NODE_ID = 'review';
const LONG_CMD = `bun test ${'x'.repeat(120)} src/lib/agent-history.test.ts`;

type WorkflowEvent = components['schemas']['WorkflowEvent'];
type ToolMetadata = NonNullable<Extract<NodeMessageRow, { kind: 'tool' }>['metadata']> & {
  outcome?: 'success' | 'error' | 'interrupted' | 'unknown';
  exit_code?: number;
  full_output_available?: boolean;
};

function textRow(
  id: string,
  seq: number,
  body: string,
  metadata?: NonNullable<Extract<NodeMessageRow, { kind: 'text' }>['metadata']>
): NodeMessageRow {
  return {
    id,
    seq,
    kind: 'text',
    payload: { text: body },
    created_at: CREATED_AT,
    ...(metadata === undefined ? {} : { metadata }),
  };
}

function statusRow(id: string, seq: number, state: string, detail?: string): NodeMessageRow {
  return {
    id,
    seq,
    kind: 'status',
    payload: detail === undefined ? { state } : { state, detail },
    created_at: CREATED_AT,
  };
}

function toolRow(args: {
  id: string;
  seq: number;
  name: string;
  toolUseId: string;
  input?: unknown;
  output?: unknown;
  metadata?: ToolMetadata;
}): NodeMessageRow {
  const payload: { name: string; id: string; input?: unknown; output?: unknown } = {
    name: args.name,
    id: args.toolUseId,
  };
  if (args.input !== undefined) payload.input = args.input;
  if (args.output !== undefined) payload.output = args.output;
  return {
    id: args.id,
    seq: args.seq,
    kind: 'tool',
    payload,
    created_at: CREATED_AT,
    metadata: args.metadata as Extract<NodeMessageRow, { kind: 'tool' }>['metadata'],
  };
}

function event(args: {
  id: string;
  eventType: string;
  stepName: string | null;
  data: Record<string, unknown>;
}): WorkflowEvent {
  return {
    id: args.id,
    workflow_run_id: 'run-1',
    event_type: args.eventType,
    step_index: null,
    step_name: args.stepName,
    data: args.data,
    created_at: CREATED_AT,
  };
}

function kinds(items: readonly AgentHistoryItem[]): Array<AgentHistoryItem['kind']> {
  return items.map(item => item.kind);
}

describe('toolContext', () => {
  test('returns full trimmed allowlisted values and ignores every other field', () => {
    expect(
      toolContext({
        cmd: `  ${LONG_CMD}  `,
        path: '  src/lib/agent-history.ts  ',
        file_path: '  packages/web/src/lib/api.ts  ',
        query: '  node messages  ',
        url: '  https://archon.diy/docs  ',
        timeout: 30,
        command: 'ignored-alias',
        nested: { path: 'nope' },
      })
    ).toEqual([
      { label: 'cmd', value: LONG_CMD },
      { label: 'path', value: 'src/lib/agent-history.ts' },
      { label: 'file_path', value: 'packages/web/src/lib/api.ts' },
      { label: 'query', value: 'node messages' },
      { label: 'url', value: 'https://archon.diy/docs' },
    ]);
    expect(LONG_CMD.length).toBeGreaterThan(120);
  });

  test('returns an empty list for non-objects', () => {
    expect(toolContext(null)).toEqual([]);
    expect(toolContext('cmd')).toEqual([]);
  });
});

describe('toolRuntime', () => {
  test('joins duration only when exactly one matching completion event has a finite nonnegative duration', () => {
    const match = event({
      id: 'e-match',
      eventType: 'tool_completed',
      stepName: NODE_ID,
      data: { tool_call_id: 'tool-1', duration_ms: 42 },
    });
    expect(toolRuntime([match], NODE_ID, 'tool-1')).toEqual({ durationMs: 42 });
    expect(toolRuntime([], NODE_ID, 'tool-1')).toEqual({ durationMs: null });
    expect(
      toolRuntime(
        [
          match,
          event({
            id: 'e-again',
            eventType: 'tool_completed',
            stepName: NODE_ID,
            data: { tool_call_id: 'tool-1', duration_ms: 99 },
          }),
        ],
        NODE_ID,
        'tool-1'
      )
    ).toEqual({ durationMs: null });
  });

  test('ignores other nodes, other tools, other event types, and invalid durations', () => {
    expect(
      toolRuntime(
        [
          event({
            id: 'e-other-node',
            eventType: 'tool_completed',
            stepName: 'other',
            data: { tool_call_id: 'tool-1', duration_ms: 10 },
          }),
          event({
            id: 'e-other-tool',
            eventType: 'tool_completed',
            stepName: NODE_ID,
            data: { tool_call_id: 'tool-2', duration_ms: 10 },
          }),
          event({
            id: 'e-called',
            eventType: 'tool_called',
            stepName: NODE_ID,
            data: { tool_call_id: 'tool-1', duration_ms: 10 },
          }),
          event({
            id: 'e-negative',
            eventType: 'tool_completed',
            stepName: NODE_ID,
            data: { tool_call_id: 'tool-1', duration_ms: -1 },
          }),
        ],
        NODE_ID,
        'tool-1'
      )
    ).toEqual({ durationMs: null });
  });
});

describe('buildAgentHistory', () => {
  test('projects assistant, tool, and lifecycle items in sequence without duplicating snapshot text', () => {
    const items = buildAgentHistory({
      nodeId: NODE_ID,
      events: [
        event({
          id: 'e-bash',
          eventType: 'tool_completed',
          stepName: NODE_ID,
          data: { tool_call_id: 'bash-1', duration_ms: 18 },
        }),
      ],
      rows: [
        textRow('t-delta-1', 1, 'Hel', {
          text_mode: 'delta',
          message_id: 'm1',
          block_id: 'b1',
        }),
        textRow('t-delta-2', 2, 'lo', {
          text_mode: 'delta',
          message_id: 'm1',
          block_id: 'b1',
        }),
        textRow('t-snapshot-old', 3, 'stale snapshot', {
          text_mode: 'snapshot',
          message_id: 'm2',
          block_id: 'b2',
        }),
        textRow('t-snapshot-new', 4, 'Final answer', {
          text_mode: 'snapshot',
          message_id: 'm2',
          block_id: 'b2',
        }),
        toolRow({
          id: 'tool-call-bash',
          seq: 5,
          name: 'Bash',
          toolUseId: 'bash-1',
          input: { cmd: 'ls', extra: true },
          metadata: { tool_phase: 'call' },
        }),
        statusRow('status-1', 6, 'iteration_started', '1'),
        toolRow({
          id: 'tool-result-bash',
          seq: 7,
          name: 'Bash',
          toolUseId: 'bash-1',
          output: { stdout: 'ok', code: 1 },
          metadata: { tool_phase: 'result', exit_code: 1 },
        }),
        toolRow({
          id: 'tool-call-read',
          seq: 8,
          name: 'Read',
          toolUseId: 'read-1',
          input: { path: 'a.ts' },
          metadata: { tool_phase: 'call' },
        }),
        toolRow({
          id: 'tool-result-read',
          seq: 9,
          name: 'Read',
          toolUseId: 'read-1',
          output: 'file contents',
          metadata: { tool_phase: 'result', truncated: true, output_state: 'truncated' },
        }),
      ],
    });

    expect(kinds(items)).toEqual(['assistant', 'assistant', 'tool', 'lifecycle', 'tool']);
    expect(items.map(item => item.seq)).toEqual([1, 3, 5, 6, 8]);

    const [firstAssistant, secondAssistant, failedTool, lifecycle, truncatedTool] = items;
    expect(firstAssistant).toMatchObject({
      kind: 'assistant',
      role: 'assistant',
      text: 'Hello',
    });
    expect(secondAssistant).toMatchObject({
      kind: 'assistant',
      text: 'Final answer',
    });
    expect(secondAssistant?.kind === 'assistant' ? secondAssistant.text : '').not.toContain(
      'stale snapshot'
    );

    expect(failedTool).toMatchObject({
      kind: 'tool',
      seq: 5,
      role: 'tool',
      name: 'Bash',
      toolUseId: 'bash-1',
      input: { cmd: 'ls', extra: true },
      output: { stdout: 'ok', code: 1 },
      outcome: 'failed',
      durationMs: 18,
      canLoadFullOutput: false,
      outputState: 'full',
      messageId: 'tool-result-bash',
      context: [{ label: 'cmd', value: 'ls' }],
    });

    expect(lifecycle).toEqual({
      kind: 'lifecycle',
      id: 'status-1',
      seq: 6,
      state: 'iteration_started',
      detail: '1',
    });

    expect(truncatedTool).toMatchObject({
      kind: 'tool',
      seq: 8,
      toolUseId: 'read-1',
      outcome: 'succeeded',
      durationMs: null,
      canLoadFullOutput: false,
      outputState: 'truncated',
      messageId: 'tool-result-read',
    });
  });

  test('marks pending calls running and unmatched results unknown without parsing output prose', () => {
    const items = buildAgentHistory({
      nodeId: NODE_ID,
      events: [],
      rows: [
        toolRow({
          id: 'pending-call',
          seq: 1,
          name: 'Bash',
          toolUseId: 'pending-1',
          input: { cmd: 'sleep 1' },
          metadata: { tool_phase: 'call' },
        }),
        toolRow({
          id: 'orphan-result',
          seq: 2,
          name: 'Read',
          toolUseId: 'orphan-1',
          output: 'error: failed with exit 1',
          metadata: { tool_phase: 'result' },
        }),
      ],
    });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      kind: 'tool',
      outcome: 'running',
      seq: 1,
      canLoadFullOutput: false,
      outputState: 'missing',
      messageId: 'pending-call',
    });
    expect(items[1]).toMatchObject({
      kind: 'tool',
      outcome: 'unknown',
      seq: 2,
      canLoadFullOutput: false,
      outputState: 'full',
      messageId: 'orphan-result',
    });
  });

  test('distinguishes retrievable response truncation and preserves interrupted outcomes', () => {
    const items = buildAgentHistory({
      nodeId: NODE_ID,
      events: [],
      rows: [
        toolRow({
          id: 'source-call',
          seq: 1,
          name: 'Read',
          toolUseId: 'source',
          metadata: { tool_phase: 'call' },
        }),
        toolRow({
          id: 'source-result',
          seq: 2,
          name: 'Read',
          toolUseId: 'source',
          output: 'provider-truncated',
          metadata: { tool_phase: 'result', truncated: true, output_state: 'truncated' },
        }),
        toolRow({
          id: 'response-call',
          seq: 3,
          name: 'Read',
          toolUseId: 'response',
          metadata: { tool_phase: 'call' },
        }),
        toolRow({
          id: 'response-result',
          seq: 4,
          name: 'Read',
          toolUseId: 'response',
          output: 'response-truncated',
          metadata: {
            tool_phase: 'result',
            truncated: true,
            output_state: 'truncated',
            full_output_available: true,
          },
        }),
        toolRow({
          id: 'interrupted-call',
          seq: 5,
          name: 'Bash',
          toolUseId: 'interrupted',
          metadata: { tool_phase: 'call' },
        }),
        toolRow({
          id: 'interrupted-result',
          seq: 6,
          name: 'Bash',
          toolUseId: 'interrupted',
          output: 'partial',
          metadata: { tool_phase: 'result', outcome: 'interrupted' },
        }),
      ],
    });
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      canLoadFullOutput: false,
      outputState: 'truncated',
    });
    expect(items[1]).toMatchObject({
      canLoadFullOutput: true,
      outputState: 'truncated',
    });
    expect(items[2]).toMatchObject({
      outcome: 'interrupted',
      outputState: 'full',
    });
  });

  test('projects a failed Bash pair with exitCode, shell presentation, and exit badge', () => {
    const items = buildAgentHistory({
      nodeId: NODE_ID,
      events: [],
      rows: [
        toolRow({
          id: 'bash-call',
          seq: 1,
          name: 'Bash',
          toolUseId: 'bash-fail',
          input: { cmd: 'bun test' },
          metadata: { tool_phase: 'call' },
        }),
        toolRow({
          id: 'bash-result',
          seq: 2,
          name: 'Bash',
          toolUseId: 'bash-fail',
          output: { stdout: 'fail' },
          metadata: { tool_phase: 'result', exit_code: 1 },
        }),
      ],
    });
    const tool = items[0];
    expect(tool).toMatchObject({
      kind: 'tool',
      outcome: 'failed',
      exitCode: 1,
      presentation: {
        family: 'shell',
        label: 'Bash',
        headline: 'bun test',
        headlineKind: 'text',
      },
    });
    if (tool === undefined || tool.kind !== 'tool') {
      throw new Error('expected a tool item');
    }
    expect(toolRowView(tool).badges).toContainEqual({
      text: 'exit 1',
      tone: 'error',
      priority: 'sticky',
    });
  });

  test('folds an interrupted lifecycle into the immediately preceding tool', () => {
    const items = buildAgentHistory({
      nodeId: NODE_ID,
      events: [],
      rows: [
        toolRow({
          id: 'call',
          seq: 1,
          name: 'Bash',
          toolUseId: 'bash-1',
          input: { cmd: 'sleep 1' },
          metadata: { tool_phase: 'call' },
        }),
        toolRow({
          id: 'result',
          seq: 2,
          name: 'Bash',
          toolUseId: 'bash-1',
          output: 'partial',
          metadata: { tool_phase: 'result' },
        }),
        statusRow('int', 3, 'interrupted'),
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'tool', outcome: 'interrupted' });
  });

  test('keeps a non-interrupted lifecycle row after a tool', () => {
    const items = buildAgentHistory({
      nodeId: NODE_ID,
      events: [],
      rows: [
        toolRow({
          id: 'call',
          seq: 1,
          name: 'Read',
          toolUseId: 'read-1',
          input: { path: 'a.ts' },
          metadata: { tool_phase: 'call' },
        }),
        toolRow({
          id: 'result',
          seq: 2,
          name: 'Read',
          toolUseId: 'read-1',
          output: 'ok',
          metadata: { tool_phase: 'result' },
        }),
        statusRow('life', 3, 'iteration_started', '1'),
      ],
    });
    expect(kinds(items)).toEqual(['tool', 'lifecycle']);
    expect(items[1]).toMatchObject({ kind: 'lifecycle', state: 'iteration_started' });
  });

  test('keeps an orphan interrupted lifecycle when no tool immediately precedes it', () => {
    const items = buildAgentHistory({
      nodeId: NODE_ID,
      events: [],
      rows: [statusRow('int', 1, 'interrupted')],
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'lifecycle', state: 'interrupted' });
  });
});

const EXPANSION_CASES: readonly [ToolOutcome, boolean][] = [
  ['succeeded', false],
  ['failed', true],
  ['running', false],
  ['interrupted', false],
  ['unknown', false],
];

const STATUS_GLYPH_CASES: readonly [ToolOutcome, string][] = [
  ['succeeded', '✓'],
  ['failed', '✕'],
  ['running', '◐'],
  ['interrupted', '⚠'],
  ['unknown', '–'],
];

function rowViewItem(
  overrides: Partial<Extract<AgentHistoryItem, { kind: 'tool' }>>
): Extract<AgentHistoryItem, { kind: 'tool' }> {
  return {
    kind: 'tool',
    id: 'tool-1',
    seq: 1,
    role: 'tool',
    name: 'Read',
    toolUseId: 'tool-use-1',
    context: [],
    input: {},
    output: {},
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
    durationMs: null,
    canLoadFullOutput: false,
    outputState: 'full',
    messageId: 'msg-1',
    ...overrides,
  };
}

describe('initialToolExpanded', () => {
  test('initial expansion is table-driven for all five outcomes', () => {
    for (const [outcome, expanded] of EXPANSION_CASES) {
      expect(initialToolExpanded(outcome)).toBe(expanded);
    }
  });
});

describe('toolRowView', () => {
  test('orders payload, non-zero exit, output-state, then droppable duration', () => {
    const view = toolRowView(
      rowViewItem({
        presentation: {
          family: 'code',
          label: 'Eval',
          chipAriaLabel: 'Eval, code tool',
          headline: 'source',
          headlineKind: 'text',
          badges: ['javascript'],
        },
        exitCode: 1,
        outputState: 'truncated',
        durationMs: 1500,
        outcome: 'failed',
      })
    );
    expect(view.badges.map(badge => badge.text)).toEqual([
      'javascript',
      'exit 1',
      'truncated',
      '1.5s',
    ]);
    expect(
      view.badges.filter(badge => badge.priority === 'droppable').map(badge => badge.text)
    ).toEqual(['1.5s']);
  });

  test('projects status glyphs through the shared row view', () => {
    for (const [outcome, glyph] of STATUS_GLYPH_CASES) {
      expect(toolRowView(rowViewItem({ outcome })).glyph).toBe(glyph);
    }
  });
});
