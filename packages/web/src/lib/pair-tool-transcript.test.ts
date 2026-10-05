import { describe, expect, test } from 'bun:test';

import { projectToolTranscript } from './pair-tool-transcript';

const OCC = '11111111-1111-4111-8111-111111111111';
const ATT = '22222222-2222-4222-8222-222222222222';

describe('projectToolTranscript', () => {
  test('pairs call and result with the same tool id and scope at the call position', () => {
    const call = {
      id: 'm1',
      seq: 1,
      kind: 'tool' as const,
      payload: { name: 'Read', id: 'tool-1', input: { path: 'a.ts' } },
      metadata: {
        execution: { occurrence_id: OCC, attempt_id: ATT },
        tool_phase: 'call' as const,
      },
    };
    const text = {
      id: 'm2',
      seq: 2,
      kind: 'text' as const,
      payload: { text: 'between' },
    };
    const result = {
      id: 'm3',
      seq: 3,
      kind: 'tool' as const,
      payload: { name: 'Read', id: 'tool-1', output: 'HITL_TOOL_OUTPUT' },
      metadata: {
        execution: { occurrence_id: OCC, attempt_id: ATT },
        tool_phase: 'result' as const,
      },
    };
    const projected = projectToolTranscript([call, text, result]);
    expect(projected).toHaveLength(2);
    expect(projected[0]).toMatchObject({
      kind: 'tool-card',
      name: 'Read',
      input: { path: 'a.ts' },
      output: 'HITL_TOOL_OUTPUT',
      pending: false,
    });
    expect(projected[1]).toEqual({ kind: 'message', message: text });
  });

  test('does not pair the same tool id across different occurrences', () => {
    const first = {
      id: 'c1',
      seq: 1,
      kind: 'tool' as const,
      payload: { name: 'Read', id: 'tool-1', input: { path: 'a.ts' } },
      metadata: {
        execution: { occurrence_id: OCC, attempt_id: ATT },
        tool_phase: 'call' as const,
      },
    };
    const other = {
      id: 'r2',
      seq: 2,
      kind: 'tool' as const,
      payload: { name: 'Read', id: 'tool-1', output: 'other' },
      metadata: {
        execution: {
          occurrence_id: '33333333-3333-4333-8333-333333333333',
          attempt_id: ATT,
        },
        tool_phase: 'result' as const,
      },
    };
    const projected = projectToolTranscript([first, other]);
    expect(projected).toHaveLength(2);
    expect(projected[0]).toMatchObject({ kind: 'tool-card', pending: true, output: undefined });
    expect(projected[1]).toMatchObject({ kind: 'tool-card', output: 'other', call: null });
  });

  test('a call whose turn was cut off never steals a later turn reusing its id', () => {
    // Turn 1 starts a tool call that is interrupted — its provider never
    // produced a result row for it (only the settle event landed, not a
    // transcript row). Turn 2 reuses the same raw id (a provider that
    // restarts its own numbering per turn, e.g. Codex `item_1`) for a
    // genuinely different, successful call.
    const turn1Call = {
      id: 'c1',
      seq: 1,
      kind: 'tool' as const,
      payload: { name: 'Bash', id: 'item_1', input: { command: 'step-1' } },
      metadata: {
        execution: { occurrence_id: OCC, attempt_id: ATT },
        tool_phase: 'call' as const,
      },
    };
    const operatorRedirect = {
      id: 'op1',
      seq: 2,
      kind: 'text' as const,
      payload: { text: 'wrong command, try again' },
    };
    const turn2Call = {
      id: 'c2',
      seq: 3,
      kind: 'tool' as const,
      payload: { name: 'Bash', id: 'item_1', input: { command: 'step-1' } },
      metadata: {
        execution: { occurrence_id: OCC, attempt_id: ATT },
        tool_phase: 'call' as const,
      },
    };
    const turn2Result = {
      id: 'r2',
      seq: 4,
      kind: 'tool' as const,
      payload: { name: 'Bash', id: 'item_1', output: 'step-1\n' },
      metadata: {
        execution: { occurrence_id: OCC, attempt_id: ATT },
        tool_phase: 'result' as const,
        outcome: 'success' as const,
      },
    };
    const projected = projectToolTranscript([turn1Call, operatorRedirect, turn2Call, turn2Result]);
    expect(projected).toHaveLength(3);
    // Turn 1's call never claims turn 2's result.
    expect(projected[0]).toMatchObject({ kind: 'tool-card', pending: true, output: undefined });
    expect(projected[1]).toEqual({ kind: 'message', message: operatorRedirect });
    // Turn 2's call is paired with its OWN result, not left pending.
    expect(projected[2]).toMatchObject({
      kind: 'tool-card',
      pending: false,
      output: 'step-1\n',
      outcome: 'success',
    });
  });

  test('a result without a call is a standalone result card', () => {
    const result = {
      id: 'r1',
      seq: 1,
      kind: 'tool' as const,
      payload: { name: 'Read', id: 'tool-1', output: 'only-out' },
    };
    const projected = projectToolTranscript([result]);
    expect(projected[0]).toMatchObject({
      kind: 'tool-card',
      output: 'only-out',
      call: null,
      pending: false,
    });
  });
});
