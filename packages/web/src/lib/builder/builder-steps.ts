import type { Edge } from '@xyflow/react';

import type { RouteLoopOutcome } from '@/lib/api';
import type { NodeStep } from '@/lib/node-steps';

/** Route outcome handles. An edge from one of these is a route, not a dependency. */
export const ROUTE_OUTCOMES = [
  'positive',
  'negative',
  'exhausted',
] as const satisfies readonly RouteLoopOutcome[];

export function isRouteOutcome(value: unknown): value is RouteLoopOutcome {
  return ROUTE_OUTCOMES.some(outcome => outcome === value);
}

/**
 * Replaces a node's dependencies. A dependency is an edge into the node that is not a
 * route outcome; route edges and every other node's edges stay as they are.
 */
export function withNodeDependencies(
  edges: readonly Edge[],
  nodeId: string,
  dependsOn: readonly string[]
): Edge[] {
  const kept = edges.filter(edge => edge.target !== nodeId || isRouteOutcome(edge.sourceHandle));
  const unique = [...new Set(dependsOn)].filter(dep => dep !== nodeId);
  return [
    ...kept,
    ...unique.map(dep => ({
      id: `${dep}->${nodeId}`,
      source: dep,
      target: nodeId,
      type: 'smoothstep',
    })),
  ];
}

/** Index of the step that holds a node, or -1. */
export function stepIndexOf(steps: readonly NodeStep[], nodeId: string): number {
  return steps.findIndex(step => step.nodes.some(node => node.id === nodeId));
}

/**
 * Dependencies that place a node in step `targetIndex` (0-based): every node of the
 * step before it, or none for the first step. Step moves and "Add node" use this
 * rule only when the operator asks; loading or saving never rewrites edges.
 */
export function dependenciesForStep(
  steps: readonly NodeStep[],
  targetIndex: number,
  movingNodeId?: string
): string[] {
  if (targetIndex <= 0) return [];
  const previous = steps[targetIndex - 1];
  if (previous === undefined) return [];
  return previous.nodes.map(node => node.id).filter(id => id !== movingNodeId);
}
