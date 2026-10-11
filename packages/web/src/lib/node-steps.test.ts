import { describe, expect, test } from 'bun:test';

import type { DagNode } from '@/lib/api';

import { groupNodesIntoSteps, NODE_KIND_CODE, summarizeNodeKinds } from './node-steps';

function node(id: string, body: Record<string, unknown>, dependsOn?: string[]): DagNode {
  return { id, depends_on: dependsOn, ...body } as DagNode;
}

describe('groupNodesIntoSteps', () => {
  test('groups nodes by the longest dependency chain', () => {
    const steps = groupNodesIntoSteps([
      node('a', { command: 'x' }),
      node('b', { prompt: 'p' }, ['a']),
      node('c', { bash: 'echo' }, ['a']),
      node('d', { prompt: 'p' }, ['b', 'c']),
    ]);
    expect(steps.map(s => s.nodes.map(n => n.id))).toEqual([['a'], ['b', 'c'], ['d']]);
    expect(steps.map(s => s.number)).toEqual(['01', '02', '03']);
    expect(steps.map(s => s.parallel)).toEqual([false, true, false]);
  });

  test('a node that depends on a late node lands after it', () => {
    const steps = groupNodesIntoSteps([
      node('a', { command: 'x' }),
      node('b', { command: 'x' }, ['a']),
      node('c', { command: 'x' }, ['a', 'b']),
    ]);
    expect(steps.map(s => s.nodes.map(n => n.id))).toEqual([['a'], ['b'], ['c']]);
  });

  test('ignores unknown dependencies and survives a cycle', () => {
    const steps = groupNodesIntoSteps([
      node('a', { command: 'x' }, ['ghost']),
      node('b', { command: 'x' }, ['c']),
      node('c', { command: 'x' }, ['b']),
    ]);
    expect(steps.flatMap(s => s.nodes.map(n => n.id)).sort()).toEqual(['a', 'b', 'c']);
  });

  test('returns no steps for no nodes', () => {
    expect(groupNodesIntoSteps([])).toEqual([]);
  });

  test('keeps loop group children nested', () => {
    const steps = groupNodesIntoSteps([
      node('g', {
        loop_group: { nodes: [node('inner', { prompt: 'p' }), node('check', { bash: 'true' })] },
      }),
    ]);
    expect(steps).toHaveLength(1);
    const group = steps[0]?.nodes[0];
    expect(group?.code).toBe('GROUP');
    expect(group?.children.map(c => [c.id, c.code])).toEqual([
      ['inner', 'PRM'],
      ['check', 'SH'],
    ]);
  });

  test('maps every body kind to a code', () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ command: 'c' }, 'CMD'],
      [{ prompt: 'p' }, 'PRM'],
      [{ bash: 'b' }, 'SH'],
      [{ script: 's' }, 'SCR'],
      [{ loop: { prompt: 'p' } }, 'LOOP'],
      [{ approval: { message: 'm' } }, 'GATE'],
      [{ plannotator_gate: {} }, 'GATE'],
      [{ workflow: 'w' }, 'WF'],
      [{ route_loop: {} }, 'ROUTE'],
      [{ loop_group: { nodes: [] } }, 'GROUP'],
    ];
    for (const [body, code] of cases) {
      const [step] = groupNodesIntoSteps([node('n', body)]);
      expect(step?.nodes[0]?.code).toBe(code);
    }
    expect(NODE_KIND_CODE.unknown).toBe('NODE');
  });
});

describe('summarizeNodeKinds', () => {
  test('counts kinds in order of first appearance', () => {
    expect(
      summarizeNodeKinds([
        node('a', { command: 'x' }),
        node('b', { bash: 'x' }),
        node('c', { command: 'x' }),
        node('d', { prompt: 'x' }),
        node('e', { command: 'x' }),
        node('f', { prompt: 'x' }),
      ])
    ).toBe('3 CMD · 1 SH · 2 PRM');
  });

  test('is empty for no nodes', () => {
    expect(summarizeNodeKinds([])).toBe('');
  });
});
