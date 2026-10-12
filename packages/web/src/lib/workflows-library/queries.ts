import { useQuery } from '@tanstack/react-query';

import {
  listDashboardRuns,
  listWorkflowRuns,
  type DashboardRunResponse,
  type WorkflowRunResponse,
} from '@/lib/api';

/** How many recent runs the detail column lists. */
const RECENT_RUNS_LIMIT = 20;

/** How often and how long the start panel looks for the new run's id. */
export const RUN_ID_POLL_MS = 1_000;
export const RUN_ID_POLL_LIMIT_MS = 30_000;

/** Runs whose workflow is exactly `name`. The API search also matches inputs, so it is a superset. */
export function exactWorkflowRuns(
  runs: readonly DashboardRunResponse[],
  name: string
): DashboardRunResponse[] {
  return runs.filter(run => run.workflow_name === name);
}

/** Recent runs of one workflow, scoped to a project or to all projects. */
export function useRecentRuns(
  name: string | null,
  codebaseId: string | null
): { runs: DashboardRunResponse[]; isLoading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboardRuns', { recentFor: name, codebaseId }],
    queryFn: () =>
      listDashboardRuns({
        codebaseId: codebaseId ?? undefined,
        search: name ?? undefined,
        limit: RECENT_RUNS_LIMIT,
      }),
    enabled: name !== null,
    refetchInterval: 10_000,
  });
  return { runs: name === null ? [] : exactWorkflowRuns(data?.runs ?? [], name), isLoading };
}

/** How many recent runs the start poller reads to find the new one. */
const STARTED_RUN_SCAN_LIMIT = 20;

/**
 * Runs a conversation started. A web run records the chat that started it as
 * `parent_conversation_id` and runs in its own worker conversation, so both ids match.
 */
export function runsOfConversation(
  runs: readonly WorkflowRunResponse[],
  conversationDbId: string
): WorkflowRunResponse[] {
  return runs.filter(
    run =>
      run.parent_conversation_id === conversationDbId || run.conversation_id === conversationDbId
  );
}

/** The newest run of a conversation, or null when it has none yet. */
export function newestRun(runs: readonly WorkflowRunResponse[]): WorkflowRunResponse | null {
  let newest: WorkflowRunResponse | null = null;
  for (const run of runs) {
    if (newest === null || Date.parse(run.started_at) > Date.parse(newest.started_at)) newest = run;
  }
  return newest;
}

/**
 * The run a start created. Starting a run returns no id, so this polls recent runs
 * for the new conversation, which only this start uses. Stops after a time limit.
 */
export function useStartedRun(
  conversationDbId: string | null,
  startedAtMs: number
): { run: WorkflowRunResponse | null; gaveUp: boolean } {
  const { data } = useQuery({
    queryKey: ['startedRun', conversationDbId],
    queryFn: async () =>
      newestRun(
        runsOfConversation(
          await listWorkflowRuns({ limit: STARTED_RUN_SCAN_LIMIT }),
          conversationDbId ?? ''
        )
      ),
    enabled: conversationDbId !== null,
    refetchInterval: query =>
      query.state.data !== null && query.state.data !== undefined
        ? false
        : Date.now() - startedAtMs > RUN_ID_POLL_LIMIT_MS
          ? false
          : RUN_ID_POLL_MS,
  });
  const run = data ?? null;
  return { run, gaveUp: run === null && Date.now() - startedAtMs > RUN_ID_POLL_LIMIT_MS };
}
