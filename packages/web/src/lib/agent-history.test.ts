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
    const items = buildAgentHistory({
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
    const items = buildAgentHistory({
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
    const items = buildAgentHistory({
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
    const items = buildAgentHistory({
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
    const items = buildAgentHistory({
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
      const tool = buildAgentHistory({ nodeId: NODE_ID, nowMs, events, rows })[0];
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
    const items = buildAgentHistory({
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
    const items = buildAgentHistory({
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
    });
    expect(pendingFolded).toMatchObject({ id: 'call-p', seq: 5, outcome: 'interrupted' });
  });

  test('does not fold across intervening items, detail text, or non-exact states', () => {
    const items = buildAgentHistory({
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
    const items = buildAgentHistory({
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
    const items = buildAgentHistory({
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
    })[0];
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
    })[0];
    if (paired?.kind !== 'tool') throw new Error('expected a tool item');
    expect(paired.id).toBe(pending.id);
    expect(toolRawPayloadJson(pending.presentation.rawPayload)).not.toContain('done');
    const parsed = JSON.parse(toolRawPayloadJson(paired.presentation.rawPayload)) as Record<
      string,
      unknown
    >;
    expect(parsed).toEqual({ name: 'Bash', input: { cmd: 'make' }, output: 'done' });
  });
});
