import { describe, expect, test } from 'bun:test';
import type { Edge } from '@xyflow/react';

import type { DagNode } from '@/lib/api';
import { groupNodesIntoSteps } from '@/lib/node-steps';

import { dependenciesForStep, stepIndexOf, withNodeDependencies } from './builder-steps';

const NODES = [
  { id: 'plan', prompt: 'p' },
  { id: 'build', prompt: 'b', depends_on: ['plan'] },
  { id: 'lint', bash: 'l', depends_on: ['plan'] },
  { id: 'ship', prompt: 's', depends_on: ['build', 'lint'] },
] as DagNode[];

describe('withNodeDependencies', () => {
  const edges: Edge[] = [
    { id: 'plan->build', source: 'plan', target: 'build' },
    { id: 'router->build', source: 'router', target: 'build', sourceHandle: 'positive' },
    { id: 'plan->lint', source: 'plan', target: 'lint' },
  ];

  test('replaces dependency edges and keeps route edges', () => {
    const next = withNodeDependencies(edges, 'build', ['lint']);
    expect(
      next
        .filter(edge => edge.target === 'build')
        .map(edge => edge.source)
        .sort()
    ).toEqual(['lint', 'router']);
    expect(next.some(edge => edge.id === 'plan->lint')).toBe(true);
  });

  test('drops duplicates and a self dependency', () => {
    const next = withNodeDependencies([], 'build', ['plan', 'plan', 'build']);
    expect(next.map(edge => edge.source)).toEqual(['plan']);
  });

  test('an empty list removes every dependency', () => {
    expect(withNodeDependencies(edges, 'lint', []).some(edge => edge.target === 'lint')).toBe(
      false
    );
  });
});

describe('step placement', () => {
  const steps = groupNodesIntoSteps(NODES);

  test('finds the step of a node', () => {
    expect(stepIndexOf(steps, 'plan')).toBe(0);
    expect(stepIndexOf(steps, 'lint')).toBe(1);
    expect(stepIndexOf(steps, 'missing')).toBe(-1);
  });

  test('depends on every node of the step before the target', () => {
    expect(dependenciesForStep(steps, 2).sort()).toEqual(['build', 'lint']);
    expect(dependenciesForStep(steps, 0)).toEqual([]);
  });

  test('a moving node never depends on itself', () => {
    expect(dependenciesForStep(steps, 2, 'lint')).toEqual(['build']);
  });
});
