import type { DagNode } from '@/lib/api';
import { loopMaxIterationsForNode } from '@/lib/execution-room-model';
import type { DagNodeState } from '@/lib/types';

/** One execution of a node, as the node run list knows it. */
export interface NodeExtrasRow {
  nodeId: string;
  selection:
    | { kind: 'node' }
    | { kind: 'loop_iteration'; iteration: number }
    | { kind: 'route_iteration'; executionSeq: number }
    | { kind: 'occurrence'; retryEpoch?: number; iteration?: number };
}

/** Distinct retry epochs of a node's executions. A row without an epoch counts as epoch 0. */
function attemptCount(rows: readonly NodeExtrasRow[]): number {
  const epochs = new Set<number>();
  for (const row of rows) {
    epochs.add(row.selection.kind === 'occurrence' ? (row.selection.retryEpoch ?? 0) : 0);
  }
  return epochs.size;
}

/**
 * Second-line extras of a node row: "iteration n of max", "N attempts", "conditional".
 * Each part appears only when it applies.
 */
export function nodeExtras(input: {
  definition: DagNode | undefined;
  state: Pick<DagNodeState, 'currentIteration' | 'maxIterations'> | undefined;
  rows: readonly NodeExtrasRow[];
}): string[] {
  const extras: string[] = [];
  const max = input.state?.maxIterations ?? loopMaxIterationsForNode(input.definition);
  const current = input.state?.currentIteration;
  if (current !== undefined && current > 0) {
    extras.push(
      max !== null && max !== undefined
        ? `iteration ${String(current)} of ${String(max)}`
        : `iteration ${String(current)}`
    );
  }
  const attempts = attemptCount(input.rows.filter(row => row.nodeId === input.definition?.id));
  if (attempts > 1) extras.push(`${String(attempts)} attempts`);
  if (input.definition?.when !== undefined && input.definition.when !== '') {
    extras.push('conditional');
  }
  return extras;
}
