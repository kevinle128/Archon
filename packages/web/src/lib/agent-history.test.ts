import { describe, expect, test } from 'bun:test';

import type { components } from './api.generated';
import type { NodeMessageRow } from './node-message-pages';
import { buildAgentHistory, toolRuntime, type AgentHistoryItem } from './agent-history';
import { toolRawPayloadJson } from './tool-presentation';

const CREATED_AT = '2026-09-08T00:00:00.000Z';
const NOW_MS = Date.parse(CREATED_AT) + 30_000;
const NODE_ID = 'review';

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

function statusRow(
  id: string,
  seq: number,
  state: string,
  detail?: string,
  metadata?: NonNullable<Extract<NodeMessageRow, { kind: 'status' }>['metadata']>
): NodeMessageRow {
  return {
    id,
    seq,
    kind: 'status',
    payload: detail === undefined ? { state } : { state, detail },
    created_at: CREATED_AT,
    ...(metadata === undefined ? {} : { metadata }),
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
  createdAt?: string;
}): WorkflowEvent {
  return {
    id: args.id,
    workflow_run_id: 'run-1',
    event_type: args.eventType,
    step_index: null,
    step_name: args.stepName,
    data: args.data,
    created_at: args.createdAt ?? CREATED_AT,
  };
}

function kinds(items: readonly AgentHistoryItem[]): Array<AgentHistoryItem['kind']> {
  return items.map(item => item.kind);
}

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
    const { items } = buildAgentHistory({
      nodeId: NODE_ID,
      nowMs: NOW_MS,
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
    });

    expect(lifecycle).toEqual({
      kind: 'lifecycle',
      id: 'status-1',
      seq: 6,
      state: 'iteration_started',
      detail: '1',
      execution: null,
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
    const { items } = buildAgentHistory({
      nodeId: NODE_ID,
      nowMs: NOW_MS,
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
    const { items } = buildAgentHistory({
      nodeId: NODE_ID,
      nowMs: NOW_MS,
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

  test('carries exit code and a ready row presentation on every tool item', () => {
    const { items } = buildAgentHistory({
      nodeId: NODE_ID,
      nowMs: NOW_MS,
      events: [
        event({
          id: 'e-done',
          eventType: 'tool_completed',
          stepName: NODE_ID,
          data: { tool_call_id: 'bash-a', duration_ms: 18 },
        }),
      ],
      rows: [
        toolRow({
          id: 'call-a',
          seq: 1,
          name: 'Bash',
          toolUseId: 'bash-a',
          input: { cmd: 'ls' },
          metadata: { tool_phase: 'call' },
        }),
        toolRow({
          id: 'result-a',
          seq: 2,
          name: 'Bash',
          toolUseId: 'bash-a',
          output: 'ok',
          metadata: { tool_phase: 'result', outcome: 'success', exit_code: 0 },
        }),
      ],
    });
    const tool = items[0];
    expect(tool).toMatchObject({
      kind: 'tool',
      outcome: 'succeeded',
      exitCode: 0,
      durationMs: 18,
      outputState: 'full',
    });
    if (tool?.kind !== 'tool') throw new Error('expected a tool item');
    expect(tool.presentation).toMatchObject({
      family: 'shell',
      label: 'Bash',
      headline: 'ls',
      glyph: '✓',
      statusLabel: 'succeeded',
      initialOpen: false,
    });
    expect(tool.presentation.badges).toEqual([
      { kind: 'exit', text: 'exit 0', tone: 'neutral' },
      { kind: 'duration', text: '18ms', tone: 'muted' },
    ]);
  });

  test('extracts exit code once with result-over-call precedence and shares it with the presenter', () => {
    const { items } = buildAgentHistory({
      nodeId: NODE_ID,
      nowMs: NOW_MS,
      events: [],
      rows: [
        toolRow({
          id: 'call-1',
          seq: 1,
          name: 'Bash',
          toolUseId: 't1',
          metadata: { tool_phase: 'call', exit_code: 9 },
        }),
        toolRow({
          id: 'result-1',
          seq: 2,
          name: 'Bash',
          toolUseId: 't1',
          output: 'x',
          metadata: { tool_phase: 'result', exit_code: 2 },
        }),
        toolRow({
          id: 'call-2',
          seq: 3,
          name: 'Bash',
          toolUseId: 't2',
          metadata: { tool_phase: 'call', exit_code: 4 },
        }),
        toolRow({
          id: 'result-2',
          seq: 4,
          name: 'Bash',
          toolUseId: 't2',
          output: 'x',
          metadata: { tool_phase: 'result', outcome: 'success' },
        }),
      ],
    });
    const [first, second] = items;
    expect(first).toMatchObject({ outcome: 'failed', exitCode: 2 });
    expect(second).toMatchObject({ outcome: 'failed', exitCode: 4 });
    if (first?.kind !== 'tool' || second?.kind !== 'tool') {
      throw new Error('expected tool items');
    }
    expect(first.presentation.badges).toContainEqual({
      kind: 'exit',
      text: 'exit 2',
      tone: 'danger',
    });
    expect(second.presentation.badges).toContainEqual({
      kind: 'exit',
      text: 'exit 4',
      tone: 'danger',
    });
  });

  test('derives deterministic running elapsed from the one matching tool_called event', () => {
    const { items } = buildAgentHistory({
      nodeId: NODE_ID,
      nowMs: NOW_MS,
      events: [
        event({
          id: 'e-called',
          eventType: 'tool_called',
          stepName: NODE_ID,
          data: { tool_call_id: 'run-1' },
        }),
      ],
      rows: [
        toolRow({
          id: 'call-run',
          seq: 1,
          name: 'Bash',
          toolUseId: 'run-1',
          input: { cmd: 'sleep 5' },
          metadata: { tool_phase: 'call' },
        }),
      ],
    });
    const tool = items[0];
    expect(tool).toMatchObject({ outcome: 'running', durationMs: null });
    if (tool?.kind !== 'tool') throw new Error('expected a tool item');
    expect(tool.presentation.badges).toEqual([
      { kind: 'state', text: 'running · 30.0s', tone: 'running' },
    ]);
  });

  test('produces no elapsed guess when the tool_called start is missing, ambiguous, or invalid', () => {
    const rows = [
      toolRow({
        id: 'call-run',
        seq: 1,
        name: 'Bash',
        toolUseId: 'run-1',
        input: { cmd: 'sleep 5' },
        metadata: { tool_phase: 'call' },
      }),
    ];
    const called = (id: string, createdAt?: string): WorkflowEvent =>
      event({
        id,
        eventType: 'tool_called',
        stepName: NODE_ID,
        data: { tool_call_id: 'run-1' },
        ...(createdAt === undefined ? {} : { createdAt }),
      });
    const stateTexts = (events: WorkflowEvent[], nowMs = NOW_MS): string[] => {
      const tool = buildAgentHistory({ nodeId: NODE_ID, nowMs, events, rows }).items[0];
      if (tool?.kind !== 'tool') throw new Error('expected a tool item');
      return tool.presentation.badges.map(badge => badge.text);
    };

    expect(stateTexts([])).toEqual(['running']);
    expect(stateTexts([called('e1'), called('e2')])).toEqual(['running']);
    expect(stateTexts([called('e1', 'not-a-timestamp')])).toEqual(['running']);
    expect(
      stateTexts([
        event({
          id: 'e-other',
          eventType: 'tool_called',
          stepName: 'other-node',
          data: { tool_call_id: 'run-1' },
        }),
      ])
    ).toEqual(['running']);
    // The future start still renders a badge, clamped to zero elapsed.
    expect(stateTexts([called('e1')], Date.parse(CREATED_AT) - 5)).toEqual(['running · 0ms']);
  });

  test('keeps a direct-result interrupted outcome and presentation without a status row', () => {
    const { items } = buildAgentHistory({
      nodeId: NODE_ID,
      nowMs: NOW_MS,
      events: [],
      rows: [
        toolRow({
          id: 'call-i',
          seq: 1,
          name: 'Bash',
          toolUseId: 'int-1',
          metadata: { tool_phase: 'call' },
        }),
        toolRow({
          id: 'result-i',
          seq: 2,
          name: 'Bash',
          toolUseId: 'int-1',
          output: 'partial',
          metadata: { tool_phase: 'result', outcome: 'interrupted' },
        }),
      ],
    });
    const tool = items[0];
    expect(tool).toMatchObject({ outcome: 'interrupted' });
    if (tool?.kind !== 'tool') throw new Error('expected a tool item');
    expect(tool.presentation).toMatchObject({
      glyph: '⚠',
      statusLabel: 'interrupted',
      initialOpen: false,
    });
    expect(tool.presentation.badges).toContainEqual({
      kind: 'state',
      text: 'interrupted',
      tone: 'warning',
    });
  });

  test('folds an immediately following interrupted status into the tool row', () => {
    const { items } = buildAgentHistory({
      nodeId: NODE_ID,
      nowMs: NOW_MS,
      events: [],
      rows: [
        toolRow({
          id: 'call-f',
          seq: 1,
          name: 'Bash',
          toolUseId: 'fold-1',
          input: { cmd: 'ls' },
          metadata: { tool_phase: 'call' },
        }),
        toolRow({
          id: 'result-f',
          seq: 2,
          name: 'Bash',
          toolUseId: 'fold-1',
          output: 'partial',
          metadata: { tool_phase: 'result', outcome: 'success', exit_code: 2 },
        }),
        statusRow('s-interrupt', 3, 'interrupted'),
        statusRow('s-next', 4, 'iteration_started', '2'),
        toolRow({
          id: 'call-p',
          seq: 5,
          name: 'Read',
          toolUseId: 'fold-2',
          input: { path: 'a.ts' },
          metadata: { tool_phase: 'call' },
        }),
        statusRow('s-interrupt-2', 6, 'interrupted'),
      ],
    });
    expect(kinds(items)).toEqual(['tool', 'lifecycle', 'tool']);
    const [folded, lifecycle, pendingFolded] = items;
    // The interrupted override beats the recorded failure for display while the
    // exit fact survives; the folded status row leaves no lifecycle item.
    expect(folded).toMatchObject({ id: 'call-f', seq: 1, outcome: 'interrupted', exitCode: 2 });
    if (folded?.kind !== 'tool') throw new Error('expected a tool item');
    expect(folded.presentation).toMatchObject({ glyph: '⚠', statusLabel: 'interrupted' });
    expect(folded.presentation.badges).toContainEqual({
      kind: 'state',
      text: 'interrupted',
      tone: 'warning',
    });
    expect(folded.presentation.badges).toContainEqual({
      kind: 'exit',
      text: 'exit 2',
      tone: 'danger',
    });
    expect(lifecycle).toEqual({
      kind: 'lifecycle',
      id: 's-next',
      seq: 4,
      state: 'iteration_started',
      detail: '2',
      execution: null,
    });
    expect(pendingFolded).toMatchObject({ id: 'call-p', seq: 5, outcome: 'interrupted' });
  });

  test('does not fold across intervening items, detail text, or non-exact states', () => {
    const { items } = buildAgentHistory({
      nodeId: NODE_ID,
      nowMs: NOW_MS,
      events: [],
      rows: [
        toolRow({
          id: 'call-n1',
          seq: 1,
          name: 'Bash',
          toolUseId: 'n1',
          metadata: { tool_phase: 'call' },
        }),
        toolRow({
          id: 'result-n1',
          seq: 2,
          name: 'Bash',
          toolUseId: 'n1',
          output: 'ok',
          metadata: { tool_phase: 'result', outcome: 'success' },
        }),
        textRow('t-between', 3, 'note'),
        statusRow('s-late', 4, 'interrupted'),
        toolRow({
          id: 'call-n2',
          seq: 5,
          name: 'Bash',
          toolUseId: 'n2',
          metadata: { tool_phase: 'call' },
        }),
        toolRow({
          id: 'result-n2',
          seq: 6,
          name: 'Bash',
          toolUseId: 'n2',
          output: 'ok',
          metadata: { tool_phase: 'result', outcome: 'success' },
        }),
        statusRow('s-detail', 7, 'completed', 'interrupted'),
        toolRow({
          id: 'call-n3',
          seq: 8,
          name: 'Bash',
          toolUseId: 'n3',
          metadata: { tool_phase: 'call' },
        }),
        toolRow({
          id: 'result-n3',
          seq: 9,
          name: 'Bash',
          toolUseId: 'n3',
          output: 'ok',
          metadata: { tool_phase: 'result', outcome: 'success' },
        }),
        statusRow('s-prefix', 10, 'interrupted_by_user'),
      ],
    });
    expect(kinds(items)).toEqual([
      'tool',
      'assistant',
      'lifecycle',
      'tool',
      'lifecycle',
      'tool',
      'lifecycle',
    ]);
    expect(items.map(item => item.id)).toEqual([
      'call-n1',
      't-between',
      's-late',
      'call-n2',
      's-detail',
      'call-n3',
      's-prefix',
    ]);
    expect(items[0]).toMatchObject({ outcome: 'succeeded' });
    expect(items[3]).toMatchObject({ outcome: 'succeeded' });
    expect(items[5]).toMatchObject({ outcome: 'succeeded' });
    expect(items[2]).toMatchObject({ kind: 'lifecycle', state: 'interrupted' });
  });

  test('a paired call/result carries the canonical raw payload', () => {
    const { items } = buildAgentHistory({
      nodeId: NODE_ID,
      nowMs: NOW_MS,
      events: [],
      rows: [
        toolRow({
          id: 'call-raw',
          seq: 1,
          name: 'mcp__github__create_issue',
          toolUseId: 'raw-1',
          input: { title: 'bug' },
          metadata: { tool_phase: 'call' },
        }),
        toolRow({
          id: 'result-raw',
          seq: 2,
          name: 'mcp__github__create_issue',
          toolUseId: 'raw-1',
          output: { issue: 42 },
          metadata: { tool_phase: 'result', outcome: 'success' },
        }),
      ],
    });
    const tool = items[0];
    if (tool?.kind !== 'tool') throw new Error('expected a tool item');
    // The raw payload keeps the provider-facing name, not the mcp chip label.
    expect(tool.presentation.label).toBe('github · create_issue');
    expect(tool.presentation.rawPayload).toEqual({
      name: 'mcp__github__create_issue',
      input: { title: 'bug' },
      output: { issue: 42 },
    });
  });

  test('a pending call serializes its raw payload without an output key', () => {
    const { items } = buildAgentHistory({
      nodeId: NODE_ID,
      nowMs: NOW_MS,
      events: [],
      rows: [
        toolRow({
          id: 'call-pending',
          seq: 1,
          name: 'Bash',
          toolUseId: 'pend-1',
          input: { cmd: 'sleep 1' },
          metadata: { tool_phase: 'call' },
        }),
      ],
    });
    const tool = items[0];
    if (tool?.kind !== 'tool') throw new Error('expected a tool item');
    const parsed = JSON.parse(toolRawPayloadJson(tool.presentation.rawPayload)) as Record<
      string,
      unknown
    >;
    expect(parsed).toEqual({ name: 'Bash', input: { cmd: 'sleep 1' } });
    expect('output' in parsed).toBe(false);
  });

  test('pairing the result keeps the card id and updates the raw payload output', () => {
    const callRow = toolRow({
      id: 'call-evolve',
      seq: 1,
      name: 'Bash',
      toolUseId: 'ev-1',
      input: { cmd: 'make' },
      metadata: { tool_phase: 'call' },
    });
    const pending = buildAgentHistory({
      nodeId: NODE_ID,
      nowMs: NOW_MS,
      events: [],
      rows: [callRow],
    }).items[0];
    if (pending?.kind !== 'tool') throw new Error('expected a tool item');
    const paired = buildAgentHistory({
      nodeId: NODE_ID,
      nowMs: NOW_MS,
      events: [],
      rows: [
        callRow,
        toolRow({
          id: 'result-evolve',
          seq: 2,
          name: 'Bash',
          toolUseId: 'ev-1',
          output: 'done',
          metadata: { tool_phase: 'result', outcome: 'success' },
        }),
      ],
    }).items[0];
    if (paired?.kind !== 'tool') throw new Error('expected a tool item');
    expect(paired.id).toBe(pending.id);
    expect(toolRawPayloadJson(pending.presentation.rawPayload)).not.toContain('done');
    const parsed = JSON.parse(toolRawPayloadJson(paired.presentation.rawPayload)) as Record<
      string,
      unknown
    >;
    expect(parsed).toEqual({ name: 'Bash', input: { cmd: 'make' }, output: 'done' });
  });

  test('a paired task dispatch carries its body, facts, and body bar on the item presentation', () => {
    const { items } = buildAgentHistory({
      nodeId: NODE_ID,
      nowMs: NOW_MS,
      events: [
        event({
          id: 'e-task',
          eventType: 'tool_completed',
          stepName: NODE_ID,
          data: { tool_call_id: 'task-1', duration_ms: 40 },
        }),
      ],
      rows: [
        toolRow({
          id: 'call-task',
          seq: 1,
          name: 'Task',
          toolUseId: 'task-1',
          input: {
            context: 'ctx',
            tasks: [
              { name: 'a', agent: 'x', task: 'prompt a' },
              { name: 'b', agent: 'y', task: 'prompt b' },
            ],
          },
          metadata: { tool_phase: 'call' },
        }),
        toolRow({
          id: 'result-task',
          seq: 2,
          name: 'Task',
          toolUseId: 'task-1',
          output: 'done',
          metadata: { tool_phase: 'result', outcome: 'success' },
        }),
      ],
    });
    const tool = items[0];
    if (tool?.kind !== 'tool') throw new Error('expected a tool item');
    expect(tool.presentation.body).toMatchObject({
      kind: 'task',
      context: 'ctx',
      subtasks: [
        { name: 'a', agent: 'x', prompt: 'prompt a' },
        { name: 'b', agent: 'y', prompt: 'prompt b' },
      ],
    });
    expect(tool.presentation.bodyFacts).toEqual(['batch', '2 subtasks']);
    expect(tool.presentation.bodyBarText).toBe('task · batch · 2 subtasks · 40ms');
    expect(tool.presentation.badges).toContainEqual({
      kind: 'count',
      text: '2 subagents',
      tone: 'neutral',
    });
  });

  describe('operator rows', () => {
    const EXECUTION = {
      occurrence_id: '11111111-1111-4111-8111-111111111111',
      attempt_id: '22222222-2222-4222-8222-222222222222',
      retry_epoch: 0,
    };
    const SENDER_ID = 'abcdef12-3456-4789-a012-3456789abcde';

    function operatorRow(
      id: string,
      seq: number,
      body: string,
      extras: {
        operatorUserId?: string | null;
        messageId?: string;
        execution?: typeof EXECUTION;
        operatorDisplayName?: string | null;
      } = {}
    ): Extract<NodeMessageRow, { kind: 'text' }> {
      return {
        id,
        seq,
        kind: 'text',
        payload: { text: body },
        created_at: CREATED_AT,
        metadata: {
          origin: 'operator',
          operator_user_id: extras.operatorUserId === undefined ? SENDER_ID : extras.operatorUserId,
          ...(extras.messageId === undefined ? {} : { message_id: extras.messageId }),
          ...(extras.execution === undefined ? {} : { execution: extras.execution }),
        },
        ...('operatorDisplayName' in extras
          ? { operator_display_name: extras.operatorDisplayName }
          : {}),
      };
    }

    test('projects verbatim text, sent delivery, message id, and execution without transforms', () => {
      const body = '  keep **md** and\n\n  spaces  ';
      const { items } = buildAgentHistory({
        nodeId: NODE_ID,
        nowMs: NOW_MS,
        events: [],
        rows: [
          operatorRow('op-1', 1, body, {
            messageId: 'msg-op-1',
            execution: EXECUTION,
            operatorDisplayName: 'e2e-starter',
          }),
        ],
      });
      expect(items).toEqual([
        {
          kind: 'operator',
          id: 'op-1',
          seq: 1,
          role: 'operator',
          text: body,
          operatorUserId: SENDER_ID,
          operatorDisplayName: 'e2e-starter',
          messageId: 'msg-op-1',
          delivery: 'sent',
          execution: EXECUTION,
        },
      ]);
    });

    test('keeps a one-property output_format envelope serialized for operator while unwrapping assistant', () => {
      const reportSchema = {
        type: 'object',
        properties: { report: { type: 'string' } },
      };
      const envelope = '{"report":"# Report"}';
      const { items } = buildAgentHistory({
        nodeId: NODE_ID,
        nowMs: NOW_MS,
        events: [],
        outputFormat: reportSchema,
        rows: [
          operatorRow('op-env', 1, envelope, { operatorDisplayName: 'ops' }),
          textRow('as-env', 2, envelope),
        ],
      });
      expect(kinds(items)).toEqual(['operator', 'assistant']);
      expect(items[0]).toMatchObject({ kind: 'operator', text: envelope });
      expect(items[1]).toMatchObject({ kind: 'assistant', text: '# Report' });
    });

    test('prefers the response display name, falls back to 8-char id, and keeps null identity null', () => {
      const { items } = buildAgentHistory({
        nodeId: NODE_ID,
        nowMs: NOW_MS,
        events: [],
        rows: [
          operatorRow('op-name', 1, 'named', {
            operatorDisplayName: '  e2e-starter  ',
          }),
          operatorRow('op-blank', 2, 'blank-name', {
            operatorDisplayName: '   ',
          }),
          operatorRow('op-missing', 3, 'missing-name'),
          operatorRow('op-null', 4, 'null-id', {
            operatorUserId: null,
            operatorDisplayName: null,
          }),
        ],
      });
      expect(
        items.map(item => (item.kind === 'operator' ? item.operatorDisplayName : null))
      ).toEqual(['e2e-starter', SENDER_ID.slice(0, 8), SENDER_ID.slice(0, 8), null]);
      expect(items[3]).toMatchObject({
        kind: 'operator',
        operatorUserId: null,
        operatorDisplayName: null,
      });
    });

    test('keeps an operator row between assistant deltas as its own seq-ordered item', () => {
      const { items } = buildAgentHistory({
        nodeId: NODE_ID,
        nowMs: NOW_MS,
        events: [],
        rows: [
          textRow('a-1', 1, 'Hel', {
            text_mode: 'delta',
            message_id: 'm1',
            block_id: 'b1',
          }),
          operatorRow('op-mid', 2, 'steer now', {
            messageId: 'msg-mid',
            operatorDisplayName: 'ops',
          }),
          textRow('a-2', 3, 'lo', {
            text_mode: 'delta',
            message_id: 'm2',
            block_id: 'b2',
          }),
        ],
      });
      expect(kinds(items)).toEqual(['assistant', 'operator', 'assistant']);
      expect(items.map(item => item.seq)).toEqual([1, 2, 3]);
      expect(items[0]).toMatchObject({ kind: 'assistant', text: 'Hel' });
      expect(items[1]).toMatchObject({
        kind: 'operator',
        text: 'steer now',
        messageId: 'msg-mid',
      });
      expect(items[2]).toMatchObject({ kind: 'assistant', text: 'lo' });
    });

    test('todo folding ignores operator prose and still folds todo-family tools', () => {
      const { items, todos } = buildAgentHistory({
        nodeId: NODE_ID,
        nowMs: NOW_MS,
        events: [],
        rows: [
          operatorRow('op-todo', 1, 'op: init\nitems:\n- fake todo', {
            operatorDisplayName: 'ops',
          }),
          toolRow({
            id: 'todo-call',
            seq: 2,
            name: 'todo',
            toolUseId: 'todo-1',
            input: { op: 'init', phase: 'Research', items: ['Read the spec'] },
            metadata: { tool_phase: 'call' },
          }),
        ],
      });
      expect(kinds(items)).toEqual(['operator', 'tool']);
      expect(items[0]).toMatchObject({
        kind: 'operator',
        text: 'op: init\nitems:\n- fake todo',
      });
      expect(todos).toEqual([
        {
          phase: 'Research',
          items: [{ content: 'Read the spec', status: 'in_progress' }],
        },
      ]);
    });
  });

  test('returns empty todos when no tool resolves to the todo family', () => {
    const { items, todos } = buildAgentHistory({
      nodeId: NODE_ID,
      nowMs: NOW_MS,
      events: [],
      rows: [
        textRow('t-note', 1, 'note'),
        toolRow({
          id: 'call-bash',
          seq: 2,
          name: 'Bash',
          toolUseId: 'bash-1',
          input: { cmd: 'ls' },
          metadata: { tool_phase: 'call' },
        }),
        statusRow('s-done', 3, 'completed'),
      ],
    });
    expect(kinds(items)).toEqual(['assistant', 'tool', 'lifecycle']);
    expect(todos).toEqual([]);
  });

  test('folds todo-family tool inputs in projected seq order even when rows arrive unsorted', () => {
    const { items, todos } = buildAgentHistory({
      nodeId: NODE_ID,
      nowMs: NOW_MS,
      events: [],
      rows: [
        toolRow({
          id: 'call-done',
          seq: 3,
          name: 'todo',
          toolUseId: 'todo-done',
          input: { op: 'done', task: 'Read the spec' },
          metadata: { tool_phase: 'call' },
        }),
        toolRow({
          id: 'call-init',
          seq: 1,
          name: 'todo',
          toolUseId: 'todo-init',
          input: {
            op: 'init',
            phase: 'Research',
            items: ['Read the spec', 'Map the message path'],
          },
          metadata: { tool_phase: 'call' },
        }),
      ],
    });
    // The item projection keeps arrival order; only the fold re-orders by seq.
    expect(items.map(item => item.seq)).toEqual([3, 1]);
    expect(todos).toEqual([
      {
        phase: 'Research',
        items: [
          { content: 'Read the spec', status: 'completed' },
          { content: 'Map the message path', status: 'in_progress' },
        ],
      },
    ]);
  });

  test('a later Claude snapshot replaces folded OMP state', () => {
    const { todos } = buildAgentHistory({
      nodeId: NODE_ID,
      nowMs: NOW_MS,
      events: [],
      rows: [
        toolRow({
          id: 'call-init',
          seq: 1,
          name: 'todo',
          toolUseId: 'todo-init',
          input: { op: 'init', phase: 'Research', items: ['Read the spec'] },
          metadata: { tool_phase: 'call' },
        }),
        toolRow({
          id: 'call-write',
          seq: 2,
          name: 'TodoWrite',
          toolUseId: 'tw-1',
          input: {
            todos: [
              { content: 'Ship the change', status: 'in_progress', activeForm: 'Shipping' },
              { content: 'File the report', status: 'pending' },
            ],
          },
          metadata: { tool_phase: 'call' },
        }),
      ],
    });
    expect(todos).toEqual([
      {
        phase: 'Tasks',
        items: [
          { content: 'Ship the change', status: 'in_progress' },
          { content: 'File the report', status: 'pending' },
        ],
      },
    ]);
  });

  test('non-todo tools carrying op-shaped inputs and lifecycle rows do not fold', () => {
    const { items, todos } = buildAgentHistory({
      nodeId: NODE_ID,
      nowMs: NOW_MS,
      events: [],
      rows: [
        toolRow({
          id: 'call-init',
          seq: 1,
          name: 'todo',
          toolUseId: 'todo-init',
          input: { op: 'init', phase: 'Research', items: ['Read the spec'] },
          metadata: { tool_phase: 'call' },
        }),
        toolRow({
          id: 'call-bash',
          seq: 2,
          name: 'Bash',
          toolUseId: 'bash-1',
          input: {
            op: 'done',
            task: 'Read the spec',
            items: ['Decoy'],
            list: [{ phase: 'X', items: ['Decoy'] }],
          },
          metadata: { tool_phase: 'call' },
        }),
        textRow('t-note', 3, 'progress note'),
        statusRow('s-iter', 4, 'iteration_started', '2'),
      ],
    });
    expect(kinds(items)).toEqual(['tool', 'tool', 'assistant', 'lifecycle']);
    expect(todos).toEqual([
      { phase: 'Research', items: [{ content: 'Read the spec', status: 'in_progress' }] },
    ]);
  });

  test('terminal and lifecycle rows do not rewrite folded todo statuses', () => {
    const { items, todos } = buildAgentHistory({
      nodeId: NODE_ID,
      nowMs: NOW_MS,
      events: [],
      rows: [
        toolRow({
          id: 'call-init',
          seq: 1,
          name: 'todo',
          toolUseId: 'todo-init',
          input: {
            op: 'init',
            phase: 'Research',
            items: ['Read the spec', 'Map the message path'],
          },
          metadata: { tool_phase: 'call' },
        }),
        statusRow('s-completed', 2, 'completed'),
        statusRow('s-finished', 3, 'node_completed'),
      ],
    });
    expect(kinds(items)).toEqual(['tool', 'lifecycle', 'lifecycle']);
    expect(todos).toEqual([
      {
        phase: 'Research',
        items: [
          { content: 'Read the spec', status: 'in_progress' },
          { content: 'Map the message path', status: 'pending' },
        ],
      },
    ]);
  });

  test('a running todo call with no result still folds its recorded input', () => {
    const { items, todos } = buildAgentHistory({
      nodeId: NODE_ID,
      nowMs: NOW_MS,
      events: [],
      rows: [
        toolRow({
          id: 'call-running',
          seq: 1,
          name: 'todo',
          toolUseId: 'todo-running',
          input: { op: 'init', items: ['Read the spec', 'Run the suite'] },
          metadata: { tool_phase: 'call' },
        }),
      ],
    });
    expect(items[0]).toMatchObject({ kind: 'tool', outcome: 'running' });
    expect(todos).toEqual([
      {
        phase: 'Tasks',
        items: [
          { content: 'Read the spec', status: 'in_progress' },
          { content: 'Run the suite', status: 'pending' },
        ],
      },
    ]);
  });

  test('an interrupted todo tool keeps its input in the fold', () => {
    const { items, todos } = buildAgentHistory({
      nodeId: NODE_ID,
      nowMs: NOW_MS,
      events: [],
      rows: [
        toolRow({
          id: 'call-init',
          seq: 1,
          name: 'todo',
          toolUseId: 'todo-init',
          input: { op: 'init', phase: 'Research', items: ['Read the spec'] },
          metadata: { tool_phase: 'call' },
        }),
        toolRow({
          id: 'call-block',
          seq: 2,
          name: 'todo',
          toolUseId: 'todo-block',
          input: { op: 'block', task: 'Read the spec', reason: 'CI has one build job' },
          metadata: { tool_phase: 'call' },
        }),
        statusRow('s-interrupt', 3, 'interrupted'),
      ],
    });
    // The interrupted status folds into the second tool row, leaving no lifecycle item.
    expect(kinds(items)).toEqual(['tool', 'tool']);
    expect(items[1]).toMatchObject({ outcome: 'interrupted' });
    expect(todos).toEqual([
      {
        phase: 'Research',
        items: [{ content: 'Read the spec', status: 'blocked', blocker: 'CI has one build job' }],
      },
    ]);
  });

  test('carries projected message execution onto assistant and lifecycle items', () => {
    const execution = {
      occurrence_id: 'occ-1',
      attempt_id: 'att-1',
      retry_epoch: 1,
    };
    const { items } = buildAgentHistory({
      nodeId: NODE_ID,
      nowMs: NOW_MS,
      events: [],
      rows: [
        textRow('t-scoped', 1, 'scoped text', { execution }),
        statusRow('s-scoped', 2, 'completed', undefined, { execution }),
      ],
    });
    expect(items[0]).toMatchObject({
      kind: 'assistant',
      text: 'scoped text',
      execution,
    });
    expect(items[1]).toMatchObject({
      kind: 'lifecycle',
      state: 'completed',
      execution,
    });
  });

  test('carries call then result execution onto tool items', () => {
    const execution = { occurrence_id: 'occ-1', attempt_id: 'att-1' };
    const { items } = buildAgentHistory({
      nodeId: NODE_ID,
      nowMs: NOW_MS,
      events: [],
      rows: [
        toolRow({
          id: 'call-scoped',
          seq: 1,
          name: 'Bash',
          toolUseId: 'scoped-1',
          metadata: { tool_phase: 'call', execution },
        }),
        toolRow({
          id: 'result-scoped',
          seq: 2,
          name: 'Bash',
          toolUseId: 'scoped-1',
          output: 'ok',
          metadata: { tool_phase: 'result', outcome: 'success', execution },
        }),
        toolRow({
          id: 'result-lone',
          seq: 3,
          name: 'Read',
          toolUseId: 'lone-1',
          output: 'orphan',
          metadata: {
            tool_phase: 'result',
            outcome: 'success',
            execution: { occurrence_id: 'occ-2', attempt_id: 'att-2' },
          },
        }),
      ],
    });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: 'tool', execution });
    expect(items[1]).toMatchObject({
      kind: 'tool',
      execution: { occurrence_id: 'occ-2', attempt_id: 'att-2' },
    });
  });

  test('produces execution null on every item variant for historical rows without scope', () => {
    const { items } = buildAgentHistory({
      nodeId: NODE_ID,
      nowMs: NOW_MS,
      events: [],
      rows: [
        textRow('t-old', 1, 'old text'),
        toolRow({
          id: 'call-old',
          seq: 2,
          name: 'Bash',
          toolUseId: 'old-1',
          metadata: { tool_phase: 'call' },
        }),
        statusRow('s-old', 3, 'completed'),
      ],
    });
    expect(kinds(items)).toEqual(['assistant', 'tool', 'lifecycle']);
    for (const item of items) {
      expect(item.execution).toBeNull();
    }
  });

  describe('one-string structured envelope presentation', () => {
    const REPORT_SCHEMA: Record<string, unknown> = {
      type: 'object',
      properties: { report: { type: 'string' } },
    };
    const CANONICAL = '{"report":"# Report\\n\\nFindings **bold**"}';

    test('presents canonical multi-field output without changing its raw text', () => {
      const text = '{"status":"blocked","story_path":"","reason":"Inspecting the story"}';
      const schema = {
        type: 'object',
        properties: {
          status: { type: 'string' },
          story_path: { type: 'string' },
          reason: { type: 'string' },
        },
      };
      const { items } = buildAgentHistory({
        nodeId: NODE_ID,
        nowMs: NOW_MS,
        events: [],
        rows: [textRow('multi', 1, text)],
        outputFormat: schema,
      });
      expect(items[0]).toMatchObject({
        kind: 'assistant',
        text,
        structuredFields: [
          { name: 'status', value: 'blocked' },
          { name: 'story_path', value: '' },
          { name: 'reason', value: 'Inspecting the story' },
        ],
      });
      const { items: unmatched } = buildAgentHistory({
        nodeId: NODE_ID,
        nowMs: NOW_MS,
        events: [],
        rows: [
          textRow(
            'extra',
            1,
            '{"status":"blocked","story_path":"","reason":"Inspecting the story","extra":1}'
          ),
        ],
        outputFormat: schema,
      });
      expect(unmatched[0]).not.toHaveProperty('structuredFields');
    });

    function historyFor(
      rows: NodeMessageRow[],
      outputFormat?: Record<string, unknown>
    ): ReturnType<typeof buildAgentHistory> {
      return buildAgentHistory({
        nodeId: NODE_ID,
        nowMs: NOW_MS,
        events: [],
        ...(outputFormat === undefined ? {} : { outputFormat }),
        rows,
      });
    }

    test('unwraps a canonical one-string envelope to its Markdown string value', () => {
      const { items } = historyFor([textRow('t-1', 1, CANONICAL)], REPORT_SCHEMA);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        kind: 'assistant',
        id: 't-1',
        seq: 1,
        text: '# Report\n\nFindings **bold**',
      });
    });

    test('unwraps text assembled from compatible deltas once after assembly', () => {
      const { items } = historyFor(
        [
          textRow('d-1', 1, '{"report":"# Tit', {
            text_mode: 'delta',
            message_id: 'm1',
            block_id: 'b1',
          }),
          textRow('d-2', 2, 'le"}', { text_mode: 'delta', message_id: 'm1', block_id: 'b1' }),
        ],
        REPORT_SCHEMA
      );
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        kind: 'assistant',
        id: 'd-1',
        seq: 1,
        text: '# Title',
      });
    });

    test('leaves a lone delta fragment byte-for-byte when assembly never completes', () => {
      const { items } = historyFor(
        [textRow('d-1', 1, '{"report":"# Tit', { text_mode: 'delta' })],
        REPORT_SCHEMA
      );
      expect(items[0]).toMatchObject({ kind: 'assistant', text: '{"report":"# Tit' });
    });

    test('unwraps matching blocks on both sides of a tool boundary without joining them', () => {
      const { items } = historyFor(
        [
          textRow('a-1', 1, '{"report":"First"}', { text_mode: 'delta' }),
          toolRow({
            id: 'call-1',
            seq: 2,
            name: 'Bash',
            toolUseId: 'b-1',
            metadata: { tool_phase: 'call' },
          }),
          textRow('b-1', 3, '{"report":"Second"}', { text_mode: 'delta' }),
        ],
        REPORT_SCHEMA
      );
      expect(kinds(items)).toEqual(['assistant', 'tool', 'assistant']);
      expect(items[0]).toMatchObject({ text: 'First' });
      expect(items[1]).toMatchObject({ kind: 'tool', toolUseId: 'b-1' });
      expect(items[2]).toMatchObject({ text: 'Second' });
    });

    test('returns the original text byte-for-byte for every ineligible schema or payload', () => {
      const cases: Array<{
        name: string;
        outputFormat?: Record<string, unknown>;
        text: string;
      }> = [
        { name: 'absent schema', text: CANONICAL },
        {
          name: 'non-record schema',
          outputFormat: [] as unknown as Record<string, unknown>,
          text: CANONICAL,
        },
        { name: 'non-object schema type', outputFormat: { type: 'string' }, text: CANONICAL },
        { name: 'missing properties', outputFormat: { type: 'object' }, text: CANONICAL },
        {
          name: 'non-record properties',
          outputFormat: {
            type: 'object',
            properties: [] as unknown as Record<string, unknown>,
          },
          text: CANONICAL,
        },
        {
          name: 'zero properties',
          outputFormat: { type: 'object', properties: {} },
          text: CANONICAL,
        },
        {
          name: 'multiple properties',
          outputFormat: {
            type: 'object',
            properties: { report: { type: 'string' }, extra: { type: 'string' } },
          },
          text: CANONICAL,
        },
        {
          name: 'non-record property',
          outputFormat: { type: 'object', properties: { report: 'string' } },
          text: CANONICAL,
        },
        {
          name: 'non-string property type',
          outputFormat: { type: 'object', properties: { report: { type: 'number' } } },
          text: CANONICAL,
        },
        {
          name: 'missing property type',
          outputFormat: { type: 'object', properties: { report: {} } },
          text: CANONICAL,
        },
        { name: 'malformed payload', outputFormat: REPORT_SCHEMA, text: '{"report":' },
        {
          name: 'fenced payload',
          outputFormat: REPORT_SCHEMA,
          text: '```json\n{"report":"A"}\n```',
        },
        {
          name: 'prose-wrapped payload',
          outputFormat: REPORT_SCHEMA,
          text: 'Here: {"report":"A"}',
        },
        { name: 'array payload', outputFormat: REPORT_SCHEMA, text: '[{"report":"A"}]' },
        {
          name: 'string payload',
          outputFormat: REPORT_SCHEMA,
          text: '"{\\"report\\":\\"A\\"}"',
        },
        { name: 'number payload', outputFormat: REPORT_SCHEMA, text: '42' },
        { name: 'boolean payload', outputFormat: REPORT_SCHEMA, text: 'true' },
        { name: 'null payload', outputFormat: REPORT_SCHEMA, text: 'null' },
        { name: 'missing declared key', outputFormat: REPORT_SCHEMA, text: '{"other":"A"}' },
        {
          name: 'extra key',
          outputFormat: REPORT_SCHEMA,
          text: '{"report":"A","extra":1}',
        },
        { name: 'non-string value', outputFormat: REPORT_SCHEMA, text: '{"report":123}' },
        { name: 'null value', outputFormat: REPORT_SCHEMA, text: '{"report":null}' },
        {
          name: 'duplicate keys',
          outputFormat: REPORT_SCHEMA,
          text: '{"report":"a","report":"b"}',
        },
        {
          name: 'whitespace variation',
          outputFormat: REPORT_SCHEMA,
          text: '{ "report": "A" }',
        },
        {
          name: 'non-canonical escaping',
          outputFormat: REPORT_SCHEMA,
          text: '{"report":"\\u0041"}',
        },
        {
          name: 'reordered extra keys',
          outputFormat: REPORT_SCHEMA,
          text: '{"extra":1,"report":"A"}',
        },
        {
          name: 'extra key under annotation-tolerant schema',
          outputFormat: {
            type: 'object',
            required: ['report'],
            properties: { report: { type: 'string' } },
          },
          text: '{"report":"A","extra":1}',
        },
      ];
      const results = cases.map(entry => {
        const { items } = historyFor([textRow('t-case', 1, entry.text)], entry.outputFormat);
        const item = items[0];
        return {
          name: entry.name,
          preserved: item?.kind === 'assistant' && item.text === entry.text,
        };
      });
      expect(results).toEqual(cases.map(entry => ({ name: entry.name, preserved: true })));
    });

    test('unwraps annotated schemas, empty values, and string values that look like JSON', () => {
      const annotated = {
        type: 'object',
        title: 'Report',
        required: ['report'],
        additionalProperties: false,
        properties: { report: { type: 'string', description: 'Markdown body', minLength: 1 } },
      };
      const { items: annotatedItems } = historyFor(
        [textRow('t-1', 1, '{"report":"A"}')],
        annotated
      );
      expect(annotatedItems[0]).toMatchObject({ text: 'A' });

      const nested = JSON.stringify({ report: '{"nested":true}' });
      const { items: nestedItems } = historyFor([textRow('t-2', 1, nested)], REPORT_SCHEMA);
      expect(nestedItems[0]).toMatchObject({ text: '{"nested":true}' });

      const { items: emptyItems } = historyFor([textRow('t-3', 1, '{"report":""}')], REPORT_SCHEMA);
      expect(emptyItems[0]).toMatchObject({ text: '' });
    });

    test('copies only the qualifying text and never mutates input rows', () => {
      const execution = { occurrence_id: 'occ-1', attempt_id: 'att-1', retry_epoch: 0 };
      const rows = [
        textRow('t-1', 1, CANONICAL, { execution }),
        textRow('t-2', 2, '{ "report": "loose" }'),
      ];
      const { items } = historyFor(rows, REPORT_SCHEMA);
      expect(items[0]).toMatchObject({
        kind: 'assistant',
        id: 't-1',
        seq: 1,
        text: '# Report\n\nFindings **bold**',
        execution,
      });
      expect(items[1]).toMatchObject({
        kind: 'assistant',
        id: 't-2',
        text: '{ "report": "loose" }',
        execution: null,
      });
      expect(rows[0]?.payload).toEqual({ text: CANONICAL });
      expect(rows[1]?.payload).toEqual({ text: '{ "report": "loose" }' });
      expect(items[0]).not.toBe(rows[0]);
    });
  });
});
