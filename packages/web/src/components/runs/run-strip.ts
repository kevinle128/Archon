import { useQuery } from '@tanstack/react-query';

import { getWorkflow, getWorkflowRun, type DagNode, type DashboardRunResponse } from '@/lib/api';
import type { DagNodeState } from '@/lib/types';
import {
  mapWorkflowRunDetail,
  type WorkflowRunQueryData,
} from '@/components/workflows/WorkflowExecution';

/** Poll interval for a live run's strip. Terminal runs never refetch. */
const LIVE_STRIP_REFETCH_MS = 5_000;

const TERMINAL: readonly DashboardRunResponse['status'][] = ['completed', 'failed', 'cancelled'];

/**
 * One status per top-level workflow node, in declared order. A node with no state
 * yet is pending. Without a definition, the run's own node states are the strip.
 */
export function stripStatuses(
  definitionNodes: readonly Pick<DagNode, 'id'>[] | undefined,
  nodeStates: readonly Pick<DagNodeState, 'nodeId' | 'status'>[] | undefined
): string[] {
  const states = nodeStates ?? [];
  if (definitionNodes === undefined || definitionNodes.length === 0) {
    return states.map(state => state.status);
  }
  return definitionNodes.map(
    node => states.find(state => state.nodeId === node.id)?.status ?? 'pending'
  );
}

/**
 * Node statuses for a runs list row. Reads the same cache entries as the run page,
 * so opening a run after it was listed costs no extra request.
 */
export function useRunStrip(
  run: Pick<DashboardRunResponse, 'id' | 'status' | 'workflow_name'>,
  cwd: string | undefined
): string[] {
  const live = !TERMINAL.includes(run.status);
  const detail = useQuery({
    queryKey: ['workflowRun', run.id],
    queryFn: async (): Promise<WorkflowRunQueryData> =>
      mapWorkflowRunDetail(await getWorkflowRun(run.id)),
    staleTime: live ? 0 : Infinity,
    refetchInterval: live ? LIVE_STRIP_REFETCH_MS : false,
  });
  const definition = useQuery({
    queryKey: ['workflowDefinition', run.workflow_name, cwd ?? null],
    queryFn: () => getWorkflow(run.workflow_name, cwd),
    staleTime: Infinity,
  });
  return stripStatuses(definition.data?.workflow.nodes, detail.data?.workflowState.dagNodes);
}
