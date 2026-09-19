import { describe, expect, test } from 'bun:test';

import type { AgentHistoryItem, TranscriptExecution } from './agent-history';
import { groupByOccurrence } from './occurrence-groups';
import { toolRowPresentation } from './tool-presentation';

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

function assistant(id: string, exec: TranscriptExecution | null, text?: string): AgentHistoryItem {
  return {
    kind: 'assistant',
    id,
    seq: 0,
    role: 'assistant',
    text: text ?? `text ${id}`,
    execution: exec,
  };
}

function lifecycle(id: string, exec: TranscriptExecution | null, state: string): AgentHistoryItem {
  return { kind: 'lifecycle', id, seq: 0, state, detail: null, execution: exec };
}

function tool(id: string, exec: TranscriptExecution | null): AgentHistoryItem {
  const outcome = 'succeeded' as const;
  const outputState = 'full' as const;
  const input = { name: 'Read', input: { path: 'a.ts' }, output: 'ok' };
  return {
    kind: 'tool',
    id,
    seq: 0,
    role: 'tool',
    name: 'Read',
    toolUseId: `use-${id}`,
    input: input.input,
    output: input.output,
    outcome,
    exitCode: 0,
    durationMs: null,
    canLoadFullOutput: false,
    outputState,
    presentation: toolRowPresentation(input, {
      outcome,
      exitCode: 0,
      durationMs: null,
      outputState,
    }),
    messageId: `msg-${id}`,
    execution: exec,
  };
}

function groupedIds(grouping: ReturnType<typeof groupByOccurrence>): string[] {
  return [...grouping.prefixItems, ...grouping.groups.flatMap(group => group.items)].map(
    item => item.id
  );
}

describe('groupByOccurrence', () => {
  test('places every item in prefixItems when no item carries an occurrence', () => {
    const items = [assistant('a1', null), tool('t1', null), lifecycle('s1', null, 'completed')];
    const grouping = groupByOccurrence(items);
    expect(grouping.prefixItems).toEqual(items);
    expect(grouping.groups).toEqual([]);
    expect(grouping.showHeaders).toBe(false);
  });

  test('groups one occurrence but keeps showHeaders false', () => {
    const exec = execution('occ-a');
    const grouping = groupByOccurrence([assistant('a1', exec), lifecycle('s1', exec, 'completed')]);
    expect(grouping.prefixItems).toEqual([]);
    expect(grouping.groups).toHaveLength(1);
    expect(grouping.groups[0]?.key).toBe('occ-a');
    expect(grouping.groups[0]?.label).toBe('Run 1');
    expect(grouping.showHeaders).toBe(false);
  });

  test('orders one unique group per occurrence by first appearance', () => {
    const grouping = groupByOccurrence([
      assistant('a1', execution('occ-b')),
      assistant('a2', execution('occ-a')),
      assistant('a3', execution('occ-b')),
    ]);
    expect(grouping.groups.map(group => group.key)).toEqual(['occ-b', 'occ-a']);
    expect(grouping.groups[0]?.items.map(item => item.id)).toEqual(['a1', 'a3']);
    expect(grouping.groups[1]?.items.map(item => item.id)).toEqual(['a2']);
    expect(grouping.showHeaders).toBe(true);
  });

  test('labels retry epochs 0 and 1 as Run 1 and Run 2 · retry', () => {
    const grouping = groupByOccurrence([
      assistant('a1', execution('occ-a', { retry_epoch: 0 })),
      assistant('a2', execution('occ-b', { retry_epoch: 1 })),
    ]);
    expect(grouping.groups.map(group => group.label)).toEqual(['Run 1', 'Run 2 · retry']);
    expect(grouping.groups[0]?.retryEpoch).toBe(0);
    expect(grouping.groups[1]?.retryEpoch).toBe(1);
    expect(grouping.groups[0]?.failed).toBe(false);
  });

  test('composes retry then failed suffixes on a failed retried group', () => {
    const grouping = groupByOccurrence([
      assistant('a1', execution('occ-a', { retry_epoch: 0 })),
      lifecycle('s1', execution('occ-a', { retry_epoch: 0 }), 'completed'),
      assistant('a2', execution('occ-b', { retry_epoch: 1 })),
      lifecycle('s2', execution('occ-b', { retry_epoch: 1 }), 'failed'),
      assistant('a3', execution('occ-c', { retry_epoch: 2 })),
    ]);
    expect(grouping.groups.map(group => group.label)).toEqual([
      'Run 1',
      'Run 2 · retry · failed',
      'Run 3 · retry',
    ]);
    expect(grouping.groups[1]?.failed).toBe(true);
    expect(grouping.groups[0]?.failed).toBe(false);
  });

  test('labels the final loop ancestry entry as Iteration N with no suffix', () => {
    const grouping = groupByOccurrence([
      assistant(
        'a1',
        execution('occ-a', {
          loop_ancestry: [
            { node_id: 'outer', iteration: 1 },
            { node_id: 'inner', iteration: 3 },
          ],
        })
      ),
      lifecycle(
        's1',
        execution('occ-b', { loop_ancestry: [{ node_id: 'loop', iteration: 2 }] }),
        'failed'
      ),
    ]);
    expect(grouping.groups.map(group => group.label)).toEqual(['Iteration 3', 'Iteration 2']);
    expect(grouping.groups[0]?.iteration).toBe(3);
    expect(grouping.groups[1]?.iteration).toBe(2);
    // An Iteration label carries no reason suffix even when the group failed.
    expect(grouping.groups[1]?.failed).toBe(true);
  });

  test('disambiguates route activations sharing retry_epoch with the #N suffix', () => {
    const grouping = groupByOccurrence([
      assistant('a1', execution('occ-a', { retry_epoch: 0, route_activation_seq: 1 })),
      assistant('a2', execution('occ-b', { retry_epoch: 0, route_activation_seq: 2 })),
    ]);
    expect(grouping.groups.map(group => group.label)).toEqual(['Run 1 #1', 'Run 1 #2']);
  });

  test('expands nested loop ancestry into an iteration path when final entries collide', () => {
    const grouping = groupByOccurrence([
      assistant(
        'a1',
        execution('occ-a', {
          loop_ancestry: [
            { node_id: 'outer', iteration: 1 },
            { node_id: 'inner', iteration: 3 },
          ],
        })
      ),
      assistant(
        'a2',
        execution('occ-b', {
          loop_ancestry: [
            { node_id: 'outer', iteration: 2 },
            { node_id: 'inner', iteration: 3 },
          ],
        })
      ),
    ]);
    expect(grouping.groups.map(group => group.label)).toEqual([
      'Iteration 1 › Iteration 3',
      'Iteration 2 › Iteration 3',
    ]);
  });

  test('appends the nearest differing ancestry node_id when iteration paths still tie', () => {
    const grouping = groupByOccurrence([
      assistant(
        'a1',
        execution('occ-a', {
          loop_ancestry: [
            { node_id: 'outer', iteration: 1 },
            { node_id: 'fetch_pages', iteration: 3 },
          ],
        })
      ),
      assistant(
        'a2',
        execution('occ-b', {
          loop_ancestry: [
            { node_id: 'outer', iteration: 1 },
            { node_id: 'parse_pages', iteration: 3 },
          ],
        })
      ),
    ]);
    expect(grouping.groups.map(group => group.label)).toEqual([
      'Iteration 1 › Iteration 3 · fetch_pages',
      'Iteration 1 › Iteration 3 · parse_pages',
    ]);
  });

  test('falls back to · occurrence K for collisions typed fields cannot separate', () => {
    const grouping = groupByOccurrence([
      assistant('a1', execution('occ-a', { retry_epoch: 0 })),
      assistant('a2', execution('occ-b', { retry_epoch: 0 })),
      lifecycle('s1', execution('occ-c', { retry_epoch: 0 }), 'failed'),
    ]);
    expect(grouping.groups.map(group => group.label)).toEqual([
      'Run 1',
      'Run 1 · occurrence 2',
      'Run 1 · occurrence 3 · failed',
    ]);
  });

  test('keeps one group across multiple attempts of the same occurrence', () => {
    const grouping = groupByOccurrence([
      assistant('a1', execution('occ-a', { attempt_id: 'attempt-1' })),
      assistant('a2', execution('occ-a', { attempt_id: 'attempt-2' })),
      assistant('a3', execution('occ-a', { attempt_id: 'attempt-3' })),
    ]);
    expect(grouping.groups).toHaveLength(1);
    expect(grouping.groups[0]?.items.map(item => item.id)).toEqual(['a1', 'a2', 'a3']);
    expect(grouping.showHeaders).toBe(false);
  });

  test('joins metadata-less items after a key into the nearest preceding group', () => {
    const grouping = groupByOccurrence([
      assistant('a1', execution('occ-a')),
      assistant('mid', null),
      assistant('a2', execution('occ-b')),
      lifecycle('tail', null, 'completed'),
    ]);
    expect(grouping.prefixItems).toEqual([]);
    expect(grouping.groups[0]?.items.map(item => item.id)).toEqual(['a1', 'mid']);
    expect(grouping.groups[1]?.items.map(item => item.id)).toEqual(['a2', 'tail']);
  });

  test('keeps metadata-less items before the first key in prefixItems', () => {
    const grouping = groupByOccurrence([
      assistant('pre', null),
      assistant('a1', execution('occ-a')),
      assistant('post', null),
    ]);
    expect(grouping.prefixItems.map(item => item.id)).toEqual(['pre']);
    expect(grouping.groups[0]?.items.map(item => item.id)).toEqual(['a1', 'post']);
  });

  test('rejoins a non-contiguous occurrence into its first group exactly once', () => {
    const grouping = groupByOccurrence([
      assistant('a1', execution('occ-a')),
      assistant('b1', execution('occ-b')),
      assistant('a2', execution('occ-a')),
      assistant('b2', execution('occ-b')),
      assistant('a3', execution('occ-a')),
    ]);
    expect(grouping.groups.map(group => group.key)).toEqual(['occ-a', 'occ-b']);
    expect(grouping.groups[0]?.items.map(item => item.id)).toEqual(['a1', 'a2', 'a3']);
    expect(grouping.groups[1]?.items.map(item => item.id)).toEqual(['b1', 'b2']);
    expect(groupedIds(grouping).sort()).toEqual(['a1', 'a2', 'a3', 'b1', 'b2']);
  });

  test('ignores agent-authored Run and Iteration text when composing labels', () => {
    const grouping = groupByOccurrence([
      assistant('a1', execution('occ-a', { retry_epoch: 0 }), 'Run 99'),
      assistant('a2', execution('occ-b', { retry_epoch: 0 }), 'Iteration 99'),
      assistant('a3', execution('occ-c', { retry_epoch: 1 }), 'Run 2 · retry'),
    ]);
    expect(grouping.groups.map(group => group.label)).toEqual([
      'Run 1',
      'Run 1 · occurrence 2',
      'Run 2 · retry',
    ]);
  });

  test('does not mutate the input array, items, or shared executions', () => {
    const exec = execution('occ-a');
    const first = assistant('a1', exec);
    const second = assistant('a2', null);
    const items = [first, second];
    const grouping = groupByOccurrence(items);
    expect(items).toEqual([first, second]);
    expect(grouping.groups[0]?.items).not.toBe(items);
    expect(grouping.prefixItems).not.toBe(items);
    const again = groupByOccurrence(items);
    expect(again.groups[0]?.items).not.toBe(grouping.groups[0]?.items);
    expect(again.prefixItems).not.toBe(grouping.prefixItems);
    expect(exec).toEqual({ occurrence_id: 'occ-a', attempt_id: 'occ-a-attempt-1' });
  });
});
