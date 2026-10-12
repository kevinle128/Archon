import { describe, expect, test } from 'bun:test';

import type { DagNode } from '@/lib/api';

import { nodeExtras, type NodeExtrasRow } from './node-extras';

function node(fields: Record<string, unknown>): DagNode {
  return { id: 'build', ...fields } as DagNode;
}

function occurrence(retryEpoch: number): NodeExtrasRow {
  return { nodeId: 'build', selection: { kind: 'occurrence', retryEpoch } };
}

describe('nodeExtras', () => {
  test('shows the loop iteration against the loop cap', () => {
    expect(
      nodeExtras({
        definition: node({ loop: { max_iterations: 8 } }),
        state: { currentIteration: 3 },
        rows: [],
      })
    ).toEqual(['iteration 3 of 8']);
  });

  test('prefers the live max over the authored cap', () => {
    expect(
      nodeExtras({
        definition: node({ loop: { max_iterations: 8 } }),
        state: { currentIteration: 2, maxIterations: 5 },
        rows: [],
      })
    ).toEqual(['iteration 2 of 5']);
  });

  test('counts retry epochs as attempts', () => {
    expect(
      nodeExtras({
        definition: node({}),
        state: undefined,
        rows: [occurrence(0), occurrence(1), occurrence(1)],
      })
    ).toEqual(['2 attempts']);
  });

  test('one attempt is not shown', () => {
    expect(nodeExtras({ definition: node({}), state: undefined, rows: [occurrence(0)] })).toEqual(
      []
    );
  });

  test('a when condition marks the node conditional', () => {
    expect(
      nodeExtras({ definition: node({ when: '$a.output == "x"' }), state: undefined, rows: [] })
    ).toEqual(['conditional']);
  });

  test('rows of other nodes do not count', () => {
    expect(
      nodeExtras({
        definition: node({}),
        state: undefined,
        rows: [
          { nodeId: 'other', selection: { kind: 'occurrence', retryEpoch: 1 } },
          occurrence(0),
        ],
      })
    ).toEqual([]);
  });
});
