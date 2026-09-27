import { describe, expect, test } from 'bun:test';

import type { PendingInteraction } from '../../skills/runs';

import type { ConsoleLogEntry } from './build-console-log-entries';
import {
  interactionsForExecution,
  UNSCOPED_INTERACTION_LIMITATION,
} from './execution-interactions';

const OCC_1 = '11111111-1111-4111-8111-111111111111';
const OCC_2 = '22222222-2222-4222-8222-222222222222';
const ATTEMPT_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ATTEMPT_2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function occurrenceEntry(
  id: string,
  occurrenceId: string,
  attemptId: string,
  order: number
): ConsoleLogEntry {
  return {
    row: {
      id,
      nodeId: 'review',
      label: 'Review',
      status: 'completed',
      order,
      sourceIndex: order,
      selection: { kind: 'occurrence', occurrenceId, attemptId },
    },
    displayStatus: 'completed',
    startedAt: '2026-09-06T00:00:00.000Z',
    durationMs: null,
    costUsd: null,
    numTurns: null,
    stopReason: null,
    skipReason: null,
    skipExpr: null,
    showNodeUsage: order === 1,
  };
}

function ask(overrides: Partial<PendingInteraction> = {}): PendingInteraction {
  return {
    id: 'ask-1',
    workflow_run_id: 'run-1',
    node_id: 'review',
    tool_use_id: 'tool-ask',
    kind: 'ask',
    status: 'pending',
    envelope: {},
    answer: null,
    provider_session_id: 'sess-1',
    created_at: '2026-09-06T00:00:02.000Z',
    resolved_at: null,
    resolved_by: null,
    ...overrides,
  };
}

describe('interactionsForExecution', () => {
  const first = occurrenceEntry('row-1', OCC_1, ATTEMPT_1, 0);
  const second = occurrenceEntry('row-2', OCC_2, ATTEMPT_2, 1);
  const all = [first, second];

  test('places a scoped Ask only on the exact second entry', () => {
    const interactions = [
      ask({ execution_scope: { occurrence_id: OCC_2, attempt_id: ATTEMPT_2 } }),
    ];
    const onFirst = interactionsForExecution(interactions, first, all);
    const onSecond = interactionsForExecution(interactions, second, all);
    expect(onFirst.interactions).toEqual([]);
    expect(onFirst.scopeLimitation).toBeNull();
    expect(onSecond.interactions).toHaveLength(1);
    expect(onSecond.interactions[0]?.tool_use_id).toBe('tool-ask');
    expect(onSecond.scopeLimitation).toBeNull();
    expect(onSecond.showApproval).toBe(false);
  });

  test('places an Ask on the entry whose occurrence matches even when attempt differs', () => {
    // A guidance turn (or a run recorded before it kept one attempt per
    // occurrence) can carry an ask under an attempt that no longer matches
    // the entry's own — the occurrence is still the same execution, so the
    // ask must land there rather than vanish.
    const interactions = [
      ask({ execution_scope: { occurrence_id: OCC_2, attempt_id: ATTEMPT_1 } }),
    ];
    expect(interactionsForExecution(interactions, first, all).interactions).toEqual([]);
    const onSecond = interactionsForExecution(interactions, second, all);
    expect(onSecond.interactions).toHaveLength(1);
    expect(onSecond.interactions[0]?.tool_use_id).toBe('tool-ask');
  });

  test('places an unscoped Ask only on the latest entry with a limitation', () => {
    const interactions = [ask()];
    const onFirst = interactionsForExecution(interactions, first, all);
    const onSecond = interactionsForExecution(interactions, second, all);
    expect(onFirst.interactions).toEqual([]);
    expect(onFirst.scopeLimitation).toBeNull();
    expect(onSecond.interactions).toHaveLength(1);
    expect(onSecond.scopeLimitation).toBe(UNSCOPED_INTERACTION_LIMITATION);
  });

  test('does not resurrect a purged Ask as actionable history', () => {
    const purged = ask({
      status: 'purged',
      execution_scope: { occurrence_id: OCC_2, attempt_id: ATTEMPT_2 },
    });
    expect(interactionsForExecution([purged], second, all).interactions).toEqual([]);
  });

  test('does not render a permission interaction as a workflow approval gate', () => {
    const permission = ask({
      id: 'permission-1',
      tool_use_id: 'tool-permission',
      kind: 'permission',
      execution_scope: { occurrence_id: OCC_2, attempt_id: ATTEMPT_2 },
    });
    const assigned = interactionsForExecution([permission], second, all);
    expect(assigned.interactions).toEqual([]);
    expect(assigned.showApproval).toBe(false);
    expect(assigned.scopeLimitation).toBeNull();
  });

  test('attaches an unscoped approval node id only to the greatest-order entry', () => {
    const onFirst = interactionsForExecution([], first, all, 'review');
    const onSecond = interactionsForExecution([], second, all, 'review');
    expect(onFirst.showApproval).toBe(false);
    expect(onFirst.scopeLimitation).toBeNull();
    expect(onSecond.showApproval).toBe(true);
    expect(onSecond.scopeLimitation).toBe(UNSCOPED_INTERACTION_LIMITATION);
  });

  test('never assigns unscoped items with Map<nodeId, firstEntry> behavior', () => {
    const reversed = [second, first];
    const interactions = [ask()];
    expect(interactionsForExecution(interactions, first, reversed).interactions).toEqual([]);
    expect(interactionsForExecution(interactions, second, reversed).interactions).toHaveLength(1);
    expect(interactionsForExecution([], first, reversed, 'review').showApproval).toBe(false);
    expect(interactionsForExecution([], second, reversed, 'review').showApproval).toBe(true);
  });
});
