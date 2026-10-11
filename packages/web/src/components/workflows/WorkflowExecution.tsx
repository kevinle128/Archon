import { useState, useEffect, useMemo, useRef, useCallback, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import { RunActions, RunHeader, useIdeEnvironment } from '@/components/runs/RunHeader';
import { getPlannotatorReviewUrl } from '@/lib/approval-context';
import { projectDisplayName } from '@/lib/projects/display-name';
import {
  buildRunPath,
  isRunTab,
  keepListParams,
  RUN_TABS,
  type NodeColumnTab,
  type RunTab,
} from '@/lib/runs/run-url';

import { useQuery, useQueryClient } from '@tanstack/react-query';

import { LegacyGraphLogsPane, type RunNodeView } from './LegacyGraphLogsPane';
import { WorkflowAskChrome } from './WorkflowAskChrome';
import {
  createAskAnswerController,
  type AskActionState,
  type AskActionStateByRequest,
} from './ask-answer-controller';
import { buildLogRows } from './build-log-rows';
import { StepLogs } from './StepLogs';
import { WorkflowLogs } from './WorkflowLogs';
import { WorkflowDagViewer } from './WorkflowDagViewer';
import { RunArtifactsPanel } from '@/components/run-artifacts/RunArtifactsPanel';
import { WorkflowNodeRetryAction } from './WorkflowNodeRetryAction';
import { SourceControlTab } from './source-control/source-control-tab';
import { FilesChangedTab } from './source-control/files-changed-tab';
import { TerminalTab } from './terminal/terminal-tab';
import { useWorkflowStore } from '@/stores/workflow-store';
import { useRunTerminalEdge } from '@/hooks/useRunTerminalEdge';
import {
  abandonWorkflowRun,
  answerAskHuman,
  approveWorkflowRun,
  cancelWorkflowRun,
  createConversation,
  deleteWorkflowRun,
  getConversation,
  getMessages,
  getWorkflowRun,
  getWorkflowRunByWorker,
  getCodebase,
  getWorkflow,
  getWorkflowNodeMessages,
  rejectWorkflowRun,
  resumeWorkflowRun,
  runWorkflow,
  sendMessage,
  type NodeExecution,
  type PendingInteraction,
  type WorkflowEventResponse,
} from '@/lib/api';
import {
  applyRoomDeepLink,
  buildExecutionHeader,
  capExecutionOptions,
  selectableExecutionRows,
  chooseExecutionForInteraction,
  closeRoom,
  computeLoopIterationCount,
  computeRunOfTotal,
  disambiguateExecutionOptions,
  isLiveRowStatus,
  loopMaxIterationsForNode,
  openRoom,
  openExplicitRoom,
  askCardId,
  rememberRoomScroll,
  resetRoomVisit,
  resolveRunDetailRefetchIntervalMs,
  resolveFollowedRow,
  type RoomVisitState,
} from '@/lib/execution-room-model';
import { nodeMessageScopeKey, type NodeMessageSelection } from '@/lib/node-message-pages';
import type { AskDraft, AskDraftByRequest } from './parse-ask-envelope';
import { ensureUtc } from '@/lib/format';
import { parseRunEnvOverlay } from '@/lib/run-usage/parse-run-env-overlay';
import { readLegacyRunCost } from '@/lib/run-usage/run-usage';
import type { RunEnvOverlay } from '@/components/workflow-envs/WorkflowEnvResolvedTable';
import { RunEnvOverlayMeta } from '@/components/run-usage/RunEnvOverlayMeta';
import type { RunDetailUsage } from '@/lib/settings/usage';
import { RunCostMeta } from '@/components/run-usage/RunCostMeta';
import { runUsageContext, type RunUsageValue } from '@/components/run-usage/run-usage-context';
import { settleRunningDagNodesForTerminalStatus } from '@/lib/workflow-utils';
import type {
  WorkflowState,
  ArtifactType,
  WorkflowRunStatus,
  DagNodeState,
  LoopIterationInfo,
  RuntimeThinkingMetadata,
  RuntimeEffortLevel,
  RuntimeModelReasoningEffort,
  RuntimeNodeMetadata,
} from '@/lib/types';

/** Tool call event extracted from workflow_events for display in WorkflowLogs. */
export interface ToolEvent {
  id: string;
  name: string;
  input: Record<string, unknown>;
  stepName?: string;
  stepIndex?: number;
  createdAt: string;
  duration?: number;
}

const TERMINAL_STATUSES: readonly WorkflowRunStatus[] = ['completed', 'failed', 'cancelled'];

function isTerminal(status: WorkflowRunStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

function formatRouteDecisionField(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

type WorkflowRunNodeState = NonNullable<
  Awaited<ReturnType<typeof getWorkflowRun>>['nodeStates']
>[number];

export interface WorkflowRunQueryData {
  workflowState: WorkflowState;
  /** The run row as the API returns it: input, worktree path, parent run, metadata. */
  runRecord: Awaited<ReturnType<typeof getWorkflowRun>>['run'];
  workerPlatformId: string | null;
  parentPlatformId: string | null;
  conversationPlatformId: string | null;
  codebaseId: string | null;
  events: WorkflowEventResponse[];
  nodeStates: WorkflowRunNodeState[];
  nodeExecutions: NodeExecution[] | undefined;
  approval: unknown;
  pendingInteractions: PendingInteraction[];
  viewerIsStarter: boolean;
  starterDisplayName: string | null;
  runError: string | null;
  /** Direct-run usage grouped by node; null when the usage query failed. */
  usage: RunDetailUsage;
  legacyCostUsd: number | null;
  /** Strictly parsed `metadata.envOverlay`; null when absent or malformed. */
  envOverlay: RunEnvOverlay | null;
}

export function mapWorkflowRunDetail(
  data: Awaited<ReturnType<typeof getWorkflowRun>>
): WorkflowRunQueryData {
  const status = data.run.status;
  const dagNodes = settleRunningDagNodesForTerminalStatus(
    status,
    buildWorkflowDagNodeStates(data.nodeStates, data.events)
  );
  const metadataError = data.run.metadata.error;
  return {
    workflowState: {
      runId: data.run.id,
      workflowName: data.run.workflow_name,
      status,
      dagNodes,
      artifacts: data.events
        .filter(e => e.event_type === 'workflow_artifact')
        .map(e => {
          const d = e.data;
          return {
            type: (d.artifactType as ArtifactType) ?? 'commit',
            label: (d.label as string) ?? '',
            url: d.url as string | undefined,
            path: d.path as string | undefined,
          };
        })
        .filter(a => a.label || a.url || a.path),
      startedAt: new Date(ensureUtc(data.run.started_at)).getTime(),
      completedAt: data.run.completed_at
        ? new Date(ensureUtc(data.run.completed_at)).getTime()
        : undefined,
    },
    runRecord: data.run,
    workerPlatformId: data.run.worker_platform_id ?? null,
    parentPlatformId: data.run.parent_platform_id ?? null,
    conversationPlatformId: data.run.conversation_platform_id ?? null,
    codebaseId: data.run.codebase_id ?? null,
    events: data.events,
    nodeStates: data.nodeStates,
    nodeExecutions: data.nodeExecutions,
    approval: data.run.metadata.approval ?? null,
    pendingInteractions: data.pending_interactions,
    viewerIsStarter: data.viewer_is_starter,
    starterDisplayName: data.starter_display_name,
    runError: typeof metadataError === 'string' ? metadataError : null,
    usage: data.usage,
    legacyCostUsd: readLegacyRunCost(data.run.metadata),
    envOverlay: parseRunEnvOverlay(data.run.metadata),
  };
}

export function emptyAskActionStates(): AskActionStateByRequest {
  return {};
}

function isRuntimeModelReasoningEffort(value: unknown): value is RuntimeModelReasoningEffort {
  return typeof value === 'string' && value.length > 0;
}

function isRuntimeEffortLevel(value: unknown): value is RuntimeEffortLevel {
  return typeof value === 'string' && value.length > 0;
}

function isRuntimeThinkingMetadata(value: unknown): value is RuntimeThinkingMetadata {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.type !== 'adaptive' && record.type !== 'enabled' && record.type !== 'disabled') {
    return false;
  }
  return record.budgetTokens === undefined || typeof record.budgetTokens === 'number';
}

function runtimeMetadataFromEventData(data: Record<string, unknown>): Partial<DagNodeState> {
  return {
    ...(typeof data.provider === 'string' ? { provider: data.provider } : {}),
    ...(typeof data.model === 'string' ? { model: data.model } : {}),
    ...(typeof data.tier === 'string' ? { tier: data.tier } : {}),
    ...(isRuntimeModelReasoningEffort(data.modelReasoningEffort)
      ? { modelReasoningEffort: data.modelReasoningEffort }
      : {}),
    ...(isRuntimeEffortLevel(data.effort) ? { effort: data.effort } : {}),
    ...(isRuntimeThinkingMetadata(data.thinking) ? { thinking: data.thinking } : {}),
  };
}

function toDagNodeState(nodeState: WorkflowRunNodeState): DagNodeState {
  return {
    nodeId: nodeState.nodeId,
    name: nodeState.name,
    status: nodeState.status,
    duration: nodeState.duration,
    error: nodeState.error,
    reason:
      nodeState.reason === 'when_condition' || nodeState.reason === 'trigger_rule'
        ? nodeState.reason
        : undefined,
    provider: nodeState.provider,
    model: nodeState.model,
    tier: nodeState.tier,
    modelReasoningEffort: isRuntimeModelReasoningEffort(nodeState.modelReasoningEffort)
      ? nodeState.modelReasoningEffort
      : undefined,
    effort: nodeState.effort,
    thinking: nodeState.thinking,
  };
}

function enrichDagNodesWithLoopIterations(
  nodes: DagNodeState[],
  events: WorkflowEventResponse[]
): DagNodeState[] {
  const nodeMap = new Map(nodes.map(node => [node.nodeId, node]));
  for (const e of events.filter(ev => ev.event_type.startsWith('loop_iteration_'))) {
    const nodeId = e.step_name ?? '';
    if (!nodeId) continue;
    const existing = nodeMap.get(nodeId);
    if (!existing) continue;

    const iteration = e.data.iteration as number | undefined;
    const maxIter = e.data.maxIterations as number | undefined;
    if (iteration === undefined) continue;

    let iterStatus: LoopIterationInfo['status'];
    if (e.event_type === 'loop_iteration_started') {
      iterStatus = 'running';
    } else if (e.event_type === 'loop_iteration_completed') {
      iterStatus = 'completed';
    } else {
      iterStatus = 'failed';
    }

    const existingIters: LoopIterationInfo[] = existing.iterations ?? [];
    const iterIdx = existingIters.findIndex(it => it.iteration === iteration);
    const iterState: LoopIterationInfo = {
      iteration,
      status: iterStatus,
      duration: e.data.duration_ms as number | undefined,
    };
    const newIters = [...existingIters];
    if (iterIdx >= 0) {
      newIters[iterIdx] = iterState;
    } else {
      newIters.push(iterState);
    }

    nodeMap.set(nodeId, {
      ...existing,
      currentIteration: iteration,
      maxIterations: maxIter ?? existing.maxIterations,
      iterations: newIters,
    });
  }
  return Array.from(nodeMap.values());
}

function enrichDagNodesWithRouteDecisions(
  nodes: DagNodeState[],
  events: WorkflowEventResponse[]
): DagNodeState[] {
  const nodeMap = new Map(nodes.map(node => [node.nodeId, node]));
  for (const e of events.filter(ev => ev.event_type === 'node_routed')) {
    const nodeId = e.step_name ?? '';
    if (!nodeId) continue;
    const existing = nodeMap.get(nodeId);
    if (!existing) continue;
    nodeMap.set(nodeId, { ...existing, routeDecision: e.data });
  }
  return Array.from(nodeMap.values());
}

function enrichDagNodesWithLoopProgress(
  nodes: DagNodeState[],
  events: WorkflowEventResponse[]
): DagNodeState[] {
  const nodeMap = new Map(nodes.map(node => [node.nodeId, node]));
  for (const e of events) {
    if (e.event_type !== 'node_completed') continue;
    const lp = e.data.loop_progress as
      | { targetNodeId?: unknown; expectedIterations?: unknown }
      | undefined;
    if (
      !lp ||
      typeof lp.targetNodeId !== 'string' ||
      lp.targetNodeId.trim().length === 0 ||
      typeof lp.expectedIterations !== 'number' ||
      !Number.isSafeInteger(lp.expectedIterations) ||
      lp.expectedIterations <= 0
    ) {
      continue;
    }
    const target = nodeMap.get(lp.targetNodeId);
    if (!target) continue;
    nodeMap.set(lp.targetNodeId, { ...target, expectedIterations: lp.expectedIterations });
  }
  return Array.from(nodeMap.values());
}

export function buildWorkflowDagNodeStates(
  nodeStates: WorkflowRunNodeState[] | undefined,
  events: WorkflowEventResponse[]
): DagNodeState[] {
  const baseNodes = (nodeStates ?? []).map(toDagNodeState);
  return enrichDagNodesWithLoopProgress(
    enrichDagNodesWithLoopIterations(enrichDagNodesWithRouteDecisions(baseNodes, events), events),
    events
  );
}

interface WorkflowExecutionProps {
  runId: string;
  /** Node from the URL `/runs/:runId/:nodeId`, or null. */
  nodeId?: string | null;
  /** Node column tab from the URL. */
  tab?: NodeColumnTab;
  /** True on narrow screens, where the runs list is hidden. */
  showBackToList?: boolean;
  /** Open the most relevant node when the URL names none. Off on narrow screens. */
  autoSelectNode?: boolean;
}

/**
 * Node to open when the URL names none: the live one, else the last failed one,
 * else the last one that ran. Null before any node ran.
 */
export function defaultRoomRow<T extends { status: string }>(rows: readonly T[]): T | null {
  const lastWhere = (match: (row: T) => boolean): T | null => {
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index];
      if (row !== undefined && match(row)) return row;
    }
    return null;
  };
  return (
    lastWhere(row => isLiveRowStatus(row.status)) ??
    lastWhere(row => row.status === 'failed') ??
    lastWhere(() => true)
  );
}

function nodeMessageSelectionFromRow(row: {
  id: string;
  selection: import('./build-log-rows').LogRowSelection;
}): NodeMessageSelection {
  if (row.selection.kind === 'occurrence') {
    const selection: NodeMessageSelection = {
      kind: 'occurrence',
      occurrenceId: row.selection.occurrenceId,
    };
    if (row.selection.attemptId !== undefined) {
      selection.attemptId = row.selection.attemptId;
    }
    return selection;
  }
  return { kind: 'node', rowId: row.id };
}

export function WorkflowExecution({
  runId,
  nodeId = null,
  tab = 'stream',
  showBackToList = false,
  autoSelectNode = false,
}: WorkflowExecutionProps): React.ReactElement {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const ideEnvironment = useIdeEnvironment();
  const queryClient = useQueryClient();
  const liveWorkflow = useWorkflowStore(s => s.workflows.get(runId));
  const [room, setRoom] = useState<RoomVisitState>(() => resetRoomVisit(runId));
  const [codebaseCwd, setCodebaseCwd] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [workerRunId, setWorkerRunId] = useState<string | null>(null);
  const [nodeView, setNodeView] = useState<RunNodeView>('list');
  const [actionError, setActionError] = useState<string | null>(null);
  // Increments on every user-initiated node click to trigger scroll in WorkflowLogs
  const [nodeScrollTrigger, setNodeScrollTrigger] = useState(0);
  // Track which codebaseId we've already fetched to avoid stale re-fetches during runId transitions
  const fetchedCodebaseIdRef = useRef<string | null>(null);
  const [askActionStates, setAskActionStates] =
    useState<AskActionStateByRequest>(emptyAskActionStates);
  const [askDrafts, setAskDrafts] = useState<AskDraftByRequest>({});
  const updateAskDraft = useCallback((requestId: string, draft: AskDraft): void => {
    setAskDrafts(current => ({ ...current, [requestId]: draft }));
  }, []);
  const selectedDagNode = room.selection?.nodeId ?? null;
  const queryNode = nodeId;

  // Reset local state when navigating to a different workflow run
  useEffect(() => {
    setCodebaseCwd(null);
    setProjectName(null);
    setWorkerRunId(null);
    setNodeView('list');
    setNodeScrollTrigger(0);
    fetchedCodebaseIdRef.current = null;
    setAskActionStates(emptyAskActionStates());
    setAskDrafts({});
  }, [runId]);

  const setAskActionState = useCallback((requestId: string, state: AskActionState): void => {
    setAskActionStates(previous => ({ ...previous, [requestId]: state }));
  }, []);

  const invalidateAskQueries = useCallback(async (): Promise<void> => {
    await Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: ['workflowRun', runId] }),
      queryClient.invalidateQueries({ queryKey: ['workflowNodeMessages', runId] }),
    ]);
  }, [queryClient, runId]);

  // The Legacy node room's own dock learns a node settled (via its
  // faster-cadenced queue read) before this run entity's own poll/SSE
  // catches up — force the cached run entity stale on that exact edge
  // instead of waiting out the slower refresh. See
  // `shouldRefetchRunOnDockFinished`.
  const handleRunSettleHint = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: ['workflowRun', runId] });
  }, [queryClient, runId]);

  // The opposite edge from `handleRunSettleHint` above: a near-instant
  // `__dashboard__` SSE signal (not this page's own 3s run-detail poll)
  // reports the run's node/status changed on the server, before the dock's
  // own ~1s queue poll has had a chance to notice on its own. Refresh the
  // run entity AND kick the dock's own read on that exact edge, instead of
  // leaving Stop/Queue visible until the dock's next regular tick.
  // Deliberately does not touch `useWorkflowStore` — this is a targeted
  // refresh trigger, not a live-data feed.
  const [terminalEdgeKick, setTerminalEdgeKick] = useState(0);
  const handleTerminalEdge = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: ['workflowRun', runId] });
    setTerminalEdgeKick(tick => tick + 1);
  }, [queryClient, runId]);
  useRunTerminalEdge(runId, handleTerminalEdge);

  const askController = useMemo(
    () =>
      createAskAnswerController({
        runId,
        postAnswer: answerAskHuman,
        setActionState: setAskActionState,
        invalidate: invalidateAskQueries,
        now: (): Date => new Date(),
      }),
    [invalidateAskQueries, runId, setAskActionState]
  );

  // Fetch workflow run data with polling while running
  const { data: queryData, error: queryError } = useQuery({
    queryKey: ['workflowRun', runId],
    queryFn: async (): Promise<WorkflowRunQueryData> => {
      const data = await getWorkflowRun(runId);
      return mapWorkflowRunDetail(data);
    },
    refetchInterval: (query): number | false => {
      const data = query.state.data;
      return resolveRunDetailRefetchIntervalMs(data?.workflowState.status, data?.nodeExecutions);
    },
    // Catch-up must keep polling even if the tab briefly blurs while a cancelled
    // run still waits on node_failed / purged-Ask projection.
    refetchIntervalInBackground: true,
    staleTime: 0,
  });

  const initialData = queryData?.workflowState ?? null;
  const workerPlatformId = queryData?.workerPlatformId ?? null;
  const parentPlatformId = queryData?.parentPlatformId ?? null;
  const conversationPlatformId = queryData?.conversationPlatformId ?? null;
  const error = queryError
    ? queryError instanceof Error
      ? queryError.message
      : String(queryError)
    : null;

  // Extract tool_called events from workflow events for WorkflowLogs,
  // matching each with its corresponding tool_completed to get duration.
  const toolEvents = useMemo((): ToolEvent[] => {
    const allEvents = queryData?.events ?? [];
    const completedEvents = allEvents
      .filter(ev => ev.event_type === 'tool_completed')
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    // Greedy match: claim the earliest tool_completed with matching name after evTime.
    // usedCompleted tracks claimed IDs to prevent double-use. Local mutation is intentional.
    const usedCompleted = new Set<string>();

    return allEvents
      .filter(ev => ev.event_type === 'tool_called')
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .map(ev => {
        const evTime = new Date(ev.created_at).getTime();
        const toolName = ev.data.tool_name as string;
        const stepName = ev.step_name ?? undefined;
        const completed = completedEvents.find(
          c =>
            !usedCompleted.has(c.id) &&
            (c.data.tool_name as string) === toolName &&
            new Date(c.created_at).getTime() >= evTime &&
            (c.step_name ?? undefined) === stepName
        );
        if (completed) usedCompleted.add(completed.id);
        return {
          id: ev.id,
          name: toolName,
          input: (ev.data.tool_input as Record<string, unknown>) ?? {},
          stepName: ev.step_name ?? undefined,
          stepIndex: ev.step_index ?? undefined,
          createdAt: ev.created_at,
          duration: completed ? (completed.data.duration_ms as number | undefined) : undefined,
        };
      });
  }, [queryData?.events]);

  // Fetch codebase name when run data becomes available
  const codebaseId = queryData?.codebaseId ?? null;
  useEffect(() => {
    if (!codebaseId || fetchedCodebaseIdRef.current === codebaseId) return;
    fetchedCodebaseIdRef.current = codebaseId;
    void getCodebase(codebaseId)
      .then(cb => {
        setCodebaseCwd(cb.default_cwd);
        setProjectName(projectDisplayName(cb));
      })
      .catch((err: unknown) => {
        console.warn('[WorkflowExecution] Failed to load codebase name', {
          codebaseId,
          error: err instanceof Error ? err.message : err,
        });
      });
  }, [codebaseId]);

  // Fetch workflow definition for DAG topology (depends_on edges).
  // Only gated on workflowName — codebaseCwd is optional; when absent the server tries the
  // first registered codebase before falling back to bundled defaults (handles CLI runs and
  // "No project" web runs).
  const {
    data: workflowDef,
    error: workflowDefError,
    isPending: workflowDefPending,
  } = useQuery({
    queryKey: ['workflowDefinition', initialData?.workflowName, codebaseCwd],
    queryFn: () => getWorkflow(initialData?.workflowName ?? '', codebaseCwd ?? undefined),
    enabled: !!initialData?.workflowName,
    staleTime: Infinity,
  });
  const dagDefinitionNodes = workflowDef?.workflow?.nodes ?? null;
  const dagDefinitionErrorMessage = workflowDefError
    ? workflowDefError instanceof Error
      ? workflowDefError.message
      : String(workflowDefError)
    : null;
  // Use workflow definition when available, fall back to dagNodes from run state.
  const isDag = dagDefinitionNodes !== null || (initialData?.dagNodes.length ?? 0) > 0;

  // When SSE reports a terminal status but React Query data is still stale,
  // invalidate the cache to trigger an immediate re-fetch with correct data.
  const liveStatus = liveWorkflow?.status;
  useEffect(() => {
    if (!liveStatus || !isTerminal(liveStatus)) return;
    if (initialData && isTerminal(initialData.status)) return; // Already up to date
    void queryClient.invalidateQueries({ queryKey: ['workflowRun', runId] });
  }, [runId, liveStatus, initialData, queryClient]);

  // Look up the workflow run associated with this worker conversation
  useEffect(() => {
    if (!workerPlatformId) return;
    getWorkflowRunByWorker(workerPlatformId)
      .then(result => {
        if (result) {
          setWorkerRunId(result.run.id);
        }
      })
      .catch((err: unknown) => {
        // Non-critical — "View Run" link just won't appear
        console.warn('[WorkflowExecution] Failed to look up worker run', {
          workerPlatformId,
          error: err instanceof Error ? err.message : err,
        });
      });
  }, [workerPlatformId]);

  // Merge REST (initialData) and SSE (liveWorkflow) data.
  // REST provides structural data (steps, startedAt, artifacts) from DB.
  // SSE provides live status updates (status, completedAt, error).
  // When a `running` SSE event is missed (no buffering), the first SSE event
  // seen is `completed` — which creates liveWorkflow with steps:[] and
  // startedAt=completionTime. We must preserve initialData's structure in that case.
  const workflow = ((): WorkflowState | null => {
    if (!liveWorkflow) return initialData;
    if (!initialData) return liveWorkflow;
    if (isTerminal(initialData.status) && !isTerminal(liveWorkflow.status)) {
      console.warn('[WorkflowExecution] REST overrides stale SSE status', {
        runId,
        restStatus: initialData.status,
        sseStatus: liveWorkflow.status,
      });
      return initialData;
    }
    if (isTerminal(initialData.status)) return initialData;

    const dagNodes = settleRunningDagNodesForTerminalStatus(
      liveWorkflow.status,
      liveWorkflow.dagNodes.length > 0 ? liveWorkflow.dagNodes : initialData.dagNodes
    );

    // Merge: use liveWorkflow's dynamic status but preserve initialData's
    // structural data when liveWorkflow is sparse (missed earlier events).
    return {
      ...initialData,
      status: liveWorkflow.status,
      completedAt: liveWorkflow.completedAt ?? initialData.completedAt,
      error: liveWorkflow.error ?? initialData.error,
      // SSE accumulates dagNodes/artifacts incrementally — prefer them when populated,
      // otherwise fall back to the REST snapshot.
      dagNodes,
      artifacts: liveWorkflow.artifacts.length > 0 ? liveWorkflow.artifacts : initialData.artifacts,

      currentIteration: liveWorkflow.currentIteration ?? initialData.currentIteration,
      maxIterations: liveWorkflow.maxIterations ?? initialData.maxIterations,
    };
  })();

  const executionRows = useMemo(
    () =>
      buildLogRows(
        queryData?.nodeStates ?? [],
        queryData?.events ?? [],
        queryData?.nodeExecutions,
        queryData?.workflowState.startedAt
      ),
    [
      queryData?.events,
      queryData?.nodeExecutions,
      queryData?.nodeStates,
      queryData?.workflowState.startedAt,
    ]
  );

  useEffect(() => {
    if (queryData === undefined) return;
    setRoom(previous => {
      const base = previous.runId === runId ? previous : resetRoomVisit(runId);
      return applyRoomDeepLink(base, queryNode, executionRows);
    });
  }, [executionRows, queryData, queryNode, runId]);

  // A wide screen always shows a node: open the most relevant one once per run
  // when the URL names none. A node the user closes stays closed.
  const autoSelectedRun = useRef<string | null>(null);
  useEffect(() => {
    if (!autoSelectNode || queryNode !== null || autoSelectedRun.current === runId) return;
    const row = defaultRoomRow(executionRows);
    if (row === null) return;
    autoSelectedRun.current = runId;
    setRoom(previous =>
      previous.selection !== null
        ? previous
        : openRoom(previous, {
            nodeId: row.nodeId,
            rowId: row.id,
            openerId: null,
            followingLive: isLiveRowStatus(row.status),
          })
    );
  }, [autoSelectNode, executionRows, queryNode, runId]);

  // Force re-render every second while workflow is running (for live timer)
  const [, setTick] = useState(0);
  useEffect(() => {
    if (workflow?.status !== 'running' && workflow?.status !== 'pending') return;
    const interval = setInterval(() => {
      setTick(t => t + 1);
    }, 1000);
    return (): void => {
      clearInterval(interval);
    };
  }, [workflow?.status]);

  // Derive the currently executing node/step from events data
  const currentlyExecuting = useMemo(():
    | ({ nodeName: string; startedAt: number } & RuntimeNodeMetadata)
    | null => {
    if (!queryData?.events || workflow?.status !== 'running') return null;
    const events = queryData.events;

    // Find nodes that started but haven't completed/failed/skipped
    const startedNodes = new Set<string>();
    const completedNodes = new Set<string>();

    for (const e of events) {
      const nodeId = e.step_name ?? '';
      if (e.event_type === 'node_started') startedNodes.add(nodeId);
      if (
        e.event_type === 'node_completed' ||
        e.event_type === 'node_routed' ||
        e.event_type === 'node_failed' ||
        e.event_type === 'node_skipped'
      ) {
        completedNodes.add(nodeId);
      }
    }

    // Find the first started-but-not-completed node
    for (const nodeId of startedNodes) {
      if (!completedNodes.has(nodeId)) {
        const startEvent = events.find(
          e => e.event_type === 'node_started' && e.step_name === nodeId
        );
        if (startEvent) {
          return {
            nodeName: nodeId,
            startedAt: new Date(ensureUtc(startEvent.created_at)).getTime(),
            ...runtimeMetadataFromEventData(startEvent.data),
          };
        }
      }
    }

    return null;
  }, [queryData?.events, workflow?.status]);

  // Compute formatted log lines for the selected DAG node from DB events.
  const stepLogLines = useMemo((): string[] => {
    const events = queryData?.events ?? [];
    const stepEvents =
      selectedDagNode !== null ? events.filter(e => e.step_name === selectedDagNode) : [];
    if (stepEvents.length === 0) return [];

    return stepEvents.map(e => {
      const ts = new Date(ensureUtc(e.created_at)).toLocaleTimeString();
      switch (e.event_type) {
        case 'loop_iteration_started':
          return `[${ts}] Iteration ${String(e.data.iteration)}/${String((e.data.maxIterations as number | undefined) ?? '?')} started`;
        case 'loop_iteration_completed': {
          const dur = e.data.duration_ms as number | undefined;
          const durStr = dur !== undefined ? ` (${String(Math.round(dur / 100) / 10)}s)` : '';
          return `[${ts}] Iteration ${String(e.data.iteration)} completed${durStr}`;
        }
        case 'loop_iteration_failed':
          return `[${ts}] Iteration ${String(e.data.iteration)} failed: ${(e.data.error as string | undefined) ?? 'Unknown error'}`;
        case 'node_started':
          return `[${ts}] Node started: ${e.step_name ?? 'node'}`;
        case 'node_completed':
          return `[${ts}] Node completed: ${e.step_name ?? 'node'}`;
        case 'node_routed':
          return `[${ts}] Route decision: ${formatRouteDecisionField(e.data.outcome, 'unknown')} -> ${formatRouteDecisionField(e.data.to, 'unknown')}`;
        case 'node_failed':
          return `[${ts}] Node failed: ${e.step_name ?? 'node'}: ${(e.data.error as string | undefined) ?? 'Unknown error'}`;
        case 'node_skipped':
          return `[${ts}] Node skipped: ${e.step_name ?? 'node'}`;
        default:
          return `[${ts}] ${e.event_type}${e.step_name ? `: ${e.step_name}` : ''}`;
      }
    });
  }, [queryData?.events, selectedDagNode]);

  // Detect whether the selected node has any DB events so we can show an empty-state
  // overlay when a node has no output. Guard with isRunning so we never hide the live stream
  // for a currently-executing node that hasn't emitted events yet.
  const selectedStepHasEvents = useMemo((): boolean => {
    if (!queryData?.events || selectedDagNode === null) return false;
    return queryData.events.some(e => e.step_name === selectedDagNode);
  }, [queryData?.events, selectedDagNode]);

  // Compute start timestamps for each DAG node from workflow events.
  // Used to scroll the logs panel to the right position when a node is selected.
  const nodeStartTimes = useMemo((): Map<string, number> => {
    const map = new Map<string, number>();
    for (const e of queryData?.events ?? []) {
      if (e.event_type === 'node_started' && e.step_name) {
        map.set(e.step_name, new Date(ensureUtc(e.created_at)).getTime());
      }
    }
    return map;
  }, [queryData?.events]);

  const scrollToNodeTimestamp = selectedDagNode
    ? (nodeStartTimes.get(selectedDagNode) ?? null)
    : null;

  const handleOpenRoom = useCallback(
    (rowId: string, nodeId: string, openerId: string | null, rememberExplicit: boolean): void => {
      const row = executionRows.find(candidate => candidate.id === rowId);
      const selection = {
        nodeId,
        rowId,
        openerId,
        followingLive: row !== undefined && isLiveRowStatus(row.status),
      };
      setRoom(previous => ({
        ...(rememberExplicit
          ? openExplicitRoom(previous, selection)
          : openRoom(previous, selection)),
        // The URL below names this node; the deep-link effect must not pick a row again.
        appliedDeepLinkNode: nodeId,
      }));
      setNodeScrollTrigger(prev => prev + 1);
      // Prototype rule: Output and Raw stay; any other tab returns to the stream.
      const nextTab = tab === 'output' || tab === 'raw' ? tab : 'stream';
      if (nodeId !== queryNode || nextTab !== tab) {
        void navigate(keepListParams(buildRunPath(runId, nodeId, nextTab), searchParams), {
          replace: true,
        });
      }
    },
    [executionRows, navigate, queryNode, runId, searchParams, tab]
  );

  const handleCloseRoom = useCallback((): void => {
    const openerId = room.selection?.openerId ?? null;
    setRoom(closeRoom);
    if (queryNode !== null) {
      void navigate(keepListParams(buildRunPath(runId, null, tab), searchParams), {
        replace: true,
      });
    }
    requestAnimationFrame(() => {
      if (openerId !== null) document.getElementById(openerId)?.focus({ preventScroll: true });
    });
  }, [navigate, queryNode, room.selection?.openerId, runId, searchParams, tab]);

  const selectedExecutionRow = resolveFollowedRow(room.selection, executionRows);
  const runStartedAtIso = workflow === null ? '' : new Date(workflow.startedAt).toISOString();
  const executionRowsForSelectedNode =
    selectedExecutionRow === null
      ? []
      : selectableExecutionRows(
          executionRows.filter(candidate => candidate.nodeId === selectedExecutionRow.nodeId),
          selectedExecutionRow.id
        );
  const selectedDefinitionNode =
    selectedExecutionRow === null
      ? undefined
      : dagDefinitionNodes?.find(candidate => candidate.id === selectedExecutionRow.nodeId);
  const selectedRoomNodeState =
    selectedExecutionRow === null
      ? undefined
      : queryData?.nodeStates?.find(state => state.nodeId === selectedExecutionRow.nodeId);
  const headerModel =
    selectedExecutionRow === null
      ? undefined
      : buildExecutionHeader({
          row: selectedExecutionRow,
          events: queryData?.events ?? [],
          runStartedAt: runStartedAtIso,
          siblingRows: executionRowsForSelectedNode,
          loopMaxIterations: loopMaxIterationsForNode(selectedDefinitionNode),
          nodeStatus: selectedRoomNodeState?.status,
          nodeError: selectedRoomNodeState?.error,
          nodeSteeringSubState: selectedRoomNodeState?.steeringSubState,
          runStatus: workflow?.status,
        });
  const headerOptions =
    selectedExecutionRow === null
      ? []
      : disambiguateExecutionOptions(
          capExecutionOptions(executionRowsForSelectedNode).map(candidate => ({
            id: candidate.id,
            label: buildExecutionHeader({
              row: candidate,
              events: queryData?.events ?? [],
              runStartedAt: runStartedAtIso,
              siblingRows: executionRowsForSelectedNode,
            }).executionLabel,
            status: candidate.status,
          }))
        ).map(option => ({ rowId: option.id, label: option.label }));
  // A loop node's "of N" pairs with its own "· max M" cap in the header, so
  // both must describe the same run — count iterations within the selected
  // row's own run rather than every node execution across every retry.
  const loopIterationCount =
    selectedExecutionRow === null
      ? null
      : computeLoopIterationCount(executionRowsForSelectedNode, selectedExecutionRow.id);
  const executionCount = loopIterationCount ?? executionRowsForSelectedNode.length;
  const runOfTotal =
    selectedExecutionRow === null
      ? null
      : computeRunOfTotal(executionRowsForSelectedNode, selectedExecutionRow.id);
  const handleSelectExecution = useCallback(
    (rowId: string): void => {
      const next = executionRows.find(candidate => candidate.id === rowId);
      if (next === undefined) return;
      setRoom(previous =>
        openExplicitRoom(previous, {
          nodeId: next.nodeId,
          rowId: next.id,
          openerId: previous.selection?.openerId ?? null,
          followingLive: isLiveRowStatus(next.status),
        })
      );
    },
    [executionRows]
  );
  const transcriptScopeKey =
    selectedExecutionRow === null
      ? undefined
      : nodeMessageScopeKey(
          runId,
          selectedExecutionRow.nodeId,
          nodeMessageSelectionFromRow(selectedExecutionRow)
        );
  const initialScrollTop =
    transcriptScopeKey === undefined ? undefined : room.scrollTopByScope[transcriptScopeKey];
  const handleScrollTopChange = useCallback(
    (scrollTop: number): void => {
      if (transcriptScopeKey === undefined) return;
      setRoom(previous => rememberRoomScroll(previous, transcriptScopeKey, scrollTop));
    },
    [transcriptScopeKey]
  );

  const handleTabChange = useCallback(
    (next: NodeColumnTab): void => {
      void navigate(keepListParams(buildRunPath(runId, queryNode, next), searchParams), {
        replace: true,
      });
    },
    [navigate, queryNode, runId, searchParams]
  );

  const handleRetryDispatched = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: ['workflowRun', runId] });
    void queryClient.invalidateQueries({ queryKey: ['dashboardRuns'] });
    void queryClient.invalidateQueries({ queryKey: ['workflowRuns'] });
    void queryClient.invalidateQueries({ queryKey: ['workflow-runs-status'] });
  }, [queryClient, runId]);

  const handleRunAction = useCallback(
    async (action: 'resume' | 'abandon' | 'cancel' | 'delete'): Promise<void> => {
      setActionError(null);
      try {
        if (action === 'resume') await resumeWorkflowRun(runId);
        else if (action === 'abandon') await abandonWorkflowRun(runId);
        else if (action === 'cancel') await cancelWorkflowRun(runId);
        else {
          await deleteWorkflowRun(runId);
          void queryClient.invalidateQueries({ queryKey: ['dashboardRuns'] });
          void navigate(keepListParams('/runs', searchParams), { replace: true });
          return;
        }
        await queryClient.invalidateQueries({ queryKey: ['workflowRun', runId] });
        void queryClient.invalidateQueries({ queryKey: ['dashboardRuns'] });
        void queryClient.invalidateQueries({ queryKey: ['workflowRuns'] });
      } catch (err) {
        console.error('[WorkflowExecution] Run action failed', {
          runId,
          action,
          error: err instanceof Error ? err.message : err,
        });
        setActionError(err instanceof Error ? err.message : `Failed to ${action} the run`);
      }
    },
    [navigate, queryClient, runId, searchParams]
  );

  // "Run again": a new conversation in the same project, then the same workflow and input.
  const handleRunAgain = useCallback(async (): Promise<void> => {
    const record = queryData?.runRecord;
    if (record === undefined) return;
    setActionError(null);
    try {
      const { conversationId } = await createConversation(record.codebase_id ?? undefined);
      await runWorkflow(record.workflow_name, conversationId, record.user_message);
      void queryClient.invalidateQueries({ queryKey: ['dashboardRuns'] });
      void navigate(`/chat/${encodeURIComponent(conversationId)}`);
    } catch (err) {
      console.error('[WorkflowExecution] Run again failed', {
        runId,
        error: err instanceof Error ? err.message : err,
      });
      setActionError(err instanceof Error ? err.message : 'Failed to start the run again');
    }
  }, [navigate, queryClient, queryData?.runRecord, runId]);

  const handleGateApprove = useCallback(async (): Promise<void> => {
    await approveWorkflowRun(runId);
    await queryClient.invalidateQueries({ queryKey: ['workflowRun', runId] });
  }, [queryClient, runId]);

  const handleGateReject = useCallback(
    async (reason?: string): Promise<void> => {
      await rejectWorkflowRun(runId, reason);
      await queryClient.invalidateQueries({ queryKey: ['workflowRun', runId] });
    },
    [queryClient, runId]
  );

  // react-query keeps the last successful `data` on a background refetch
  // failure (it never clears it just because `error` is now set), so a
  // failed re-read after the run has already loaded once must not swap the
  // whole room for this error page — only a first load that never succeeded
  // does. The non-blocking "Failed to load — retrying" hint below the header
  // covers the "last read failed" case instead.
  if (error && !workflow) {
    return (
      <div className="flex items-center justify-center h-full text-error">
        <p>Failed to load workflow run: {error}</p>
      </div>
    );
  }

  if (!workflow) {
    return (
      <div className="flex items-center justify-center h-full text-text-secondary">
        <p>Loading workflow execution...</p>
      </div>
    );
  }

  // Only trust initialData.startedAt (from DB) for elapsed calculation.
  // SSE's startedAt is unreliable when 'running' was missed and the first event
  // is 'completed', which sets startedAt = completedAt = same Date.now().
  // Show 0 until REST fetch provides the authoritative timestamp.
  const startedAt = initialData?.startedAt ?? 0;
  const completedAt =
    initialData && isTerminal(initialData.status) && initialData.completedAt
      ? initialData.completedAt
      : (workflow.completedAt ?? (startedAt ? Date.now() : 0));

  const isRunning = workflow.status === 'running' || workflow.status === 'pending';
  const runUsageValue: RunUsageValue | undefined =
    queryData === undefined
      ? undefined
      : { usage: queryData.usage, legacyCostUsd: queryData.legacyCostUsd };

  // Pick the platform ID for logs: worker takes precedence over conversation.
  const logsPlatformId = workerPlatformId ?? conversationPlatformId;
  const selectedNodeState =
    selectedDagNode !== null
      ? (workflow.dagNodes.find(node => node.nodeId === selectedDagNode) ?? null)
      : null;
  const retryActionPanel = (
    <WorkflowNodeRetryAction
      runId={runId}
      runStatus={workflow.status}
      node={selectedNodeState}
      parentPlatformId={parentPlatformId}
      conversationPlatformId={conversationPlatformId}
      onRetried={handleRetryDispatched}
    />
  );

  // Sequential non-DAG runs keep the merged logs panel and selected-node empty state.
  const sequentialLogsPanel = (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0 h-full">
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        {logsPlatformId && !selectedStepHasEvents && !isRunning ? (
          <div className="flex-1 flex items-center justify-center text-text-secondary text-sm">
            No output available for this step.
          </div>
        ) : logsPlatformId ? (
          <WorkflowLogs
            conversationId={logsPlatformId}
            startedAt={initialData?.startedAt}
            isRunning={isRunning}
            workflowStatus={workflow.status}
            completedAt={workflow.completedAt}
            currentlyExecuting={currentlyExecuting}
            toolEvents={toolEvents}
            scrollToNodeTimestamp={scrollToNodeTimestamp}
            nodeScrollTrigger={nodeScrollTrigger}
          />
        ) : (
          <StepLogs runId={runId} lines={stepLogLines} />
        )}
      </div>
    </div>
  );

  const renderGraph = (input: {
    selectedNodeId: string | null;
    onNodeClick: (nodeId: string) => void;
  }): ReactNode => {
    if (dagDefinitionNodes) {
      return (
        <WorkflowDagViewer
          dagNodes={dagDefinitionNodes}
          liveStatus={workflow.dagNodes}
          isRunning={isRunning}
          currentlyExecuting={currentlyExecuting ?? undefined}
          selectedNodeId={input.selectedNodeId}
          onNodeClick={input.onNodeClick}
        />
      );
    }
    if (dagDefinitionErrorMessage) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-text-secondary px-4 text-center">
          <p className="text-error mb-1">Failed to load workflow graph</p>
          <p className="text-xs mb-3">{dagDefinitionErrorMessage}</p>
          <button
            type="button"
            onClick={(): void => {
              queryClient
                .resetQueries({
                  queryKey: ['workflowDefinition', initialData?.workflowName, codebaseCwd],
                })
                .catch((err: unknown) => {
                  console.error('[WorkflowExecution] Retry resetQueries failed', {
                    workflowName: initialData?.workflowName,
                    error: err instanceof Error ? err.message : err,
                  });
                });
            }}
            className="text-xs text-primary hover:text-accent-bright transition-colors"
          >
            Retry
          </button>
        </div>
      );
    }
    if (workflowDefPending) {
      return (
        <div className="flex items-center justify-center h-full text-text-secondary">
          <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent mr-2" />
          Loading graph...
        </div>
      );
    }
    return (
      <div className="flex items-center justify-center h-full text-text-secondary px-4 text-center">
        <p>Workflow graph unavailable for this run.</p>
      </div>
    );
  };

  const runRecord = queryData?.runRecord;
  const chatId = parentPlatformId ?? workerPlatformId;
  const plannotatorUrl = getPlannotatorReviewUrl({
    status: workflow.status,
    approval: queryData?.approval ?? null,
  });

  const askChrome = (
    <WorkflowAskChrome
      status={workflow.status}
      pendingInteractions={queryData?.pendingInteractions ?? []}
      nodeStates={queryData?.nodeStates ?? []}
      runError={queryData?.runError ?? null}
      onSelectAwaitingNode={(nodeId, interaction): void => {
        const row = chooseExecutionForInteraction(executionRows, interaction);
        if (row === null) return;
        handleOpenRoom(row.id, nodeId, null, false);
        const requestId = interaction.tool_use_id;
        let attempts = 0;
        const focusAsk = (): void => {
          const card = document.getElementById(askCardId(requestId, 'room'));
          if (card === null) {
            if (attempts < 30) {
              attempts += 1;
              requestAnimationFrame(focusAsk);
            }
            return;
          }
          card.focus();
          const control = card.querySelector(
            'input:not([disabled]), textarea:not([disabled]), button:not([disabled])'
          );
          if (control instanceof HTMLElement) control.focus();
        };
        requestAnimationFrame(focusAsk);
      }}
      onRequestGraphView={(): void => undefined}
    />
  );

  const renderRunTab = (runTab: Exclude<RunTab, 'conversation'>): ReactNode => {
    switch (runTab) {
      case 'changes':
        return <SourceControlTab runId={runId} />;
      case 'files':
        return <FilesChangedTab runId={runId} />;
      case 'terminal':
        return <TerminalTab runId={runId} />;
      case 'artifacts':
        return (
          <RunArtifactsPanel
            runId={runId}
            reportedArtifacts={workflow.artifacts}
            onClose={(): void => {
              // The panel stays mounted behind other tabs; only the open tab closes.
              if (tab === 'artifacts') handleTabChange('stream');
            }}
          />
        );
      case 'logs':
        return sequentialLogsPanel;
    }
  };

  const runHeader = (
    <RunHeader
      runId={runId}
      projectName={projectName}
      workflowName={workflow.workflowName}
      status={workflow.status}
      startedAt={startedAt}
      completedAt={isTerminal(workflow.status) ? completedAt : undefined}
      input={runRecord?.user_message ?? ''}
      parentRunId={runRecord?.parent_run_id ?? null}
      showBackToList={showBackToList}
      costRow={
        <>
          <dt className="text-text-secondary">Cost</dt>
          <dd className="min-w-0">
            <RunCostMeta />
          </dd>
        </>
      }
      envRow={
        queryData?.envOverlay != null ? (
          <>
            <dt className="text-text-secondary">Env</dt>
            <dd className="min-w-0">
              <RunEnvOverlayMeta overlay={queryData.envOverlay} />
            </dd>
          </>
        ) : null
      }
      askChrome={
        <>
          {askChrome}
          {workerRunId !== null && workerRunId !== runId ? (
            <button
              type="button"
              onClick={(): void => {
                void navigate(buildRunPath(workerRunId));
              }}
              className="text-xs font-semibold text-accent"
            >
              Run details
            </button>
          ) : null}
        </>
      }
      actions={
        <RunActions
          status={workflow.status}
          workflowName={workflow.workflowName}
          workingPath={runRecord?.working_path ?? null}
          chatId={chatId}
          plannotatorUrl={plannotatorUrl}
          isDocker={ideEnvironment.isDocker}
          isWsl={ideEnvironment.isWsl}
          wslDistro={ideEnvironment.wslDistro}
          onCancel={(): void => {
            void handleRunAction('cancel');
          }}
          onRetryFromFailed={(): void => {
            void handleRunAction('resume');
          }}
          onResume={(): void => {
            void handleRunAction('resume');
          }}
          onAbandon={(): void => {
            void handleRunAction('abandon');
          }}
          onDelete={(): void => {
            void handleRunAction('delete');
          }}
          onOpenArtifacts={(): void => {
            handleTabChange('artifacts');
          }}
          onRunAgain={(): void => {
            void handleRunAgain();
          }}
        />
      }
      actionError={actionError}
      loadError={error}
    />
  );

  // A run without a DAG has no node rooms; its logs are the whole story.
  const effectiveTab: NodeColumnTab = !isDag && !isRunTab(tab) ? 'logs' : tab;

  return (
    <runUsageContext.Provider value={runUsageValue}>
      <div className="legacy-run-view flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
        <LegacyGraphLogsPane
          nodeView={nodeView}
          onNodeViewChange={setNodeView}
          tab={effectiveTab}
          onTabChange={handleTabChange}
          runTabs={RUN_TABS}
          renderRunTab={renderRunTab}
          runHeader={runHeader}
          dagNodes={workflow.dagNodes}
          renderGraph={renderGraph}
          selectedNodeId={selectedDagNode}
          // The RESOLVED row — while `room.selection.followingLive` holds,
          // this can be a newer row than `room.selection.rowId` itself once
          // the room advances to a live iteration; the pane must render the
          // same row the header above it describes, never the raw pinned id.
          selectedLogRowId={selectedExecutionRow?.id ?? null}
          followingLive={room.selection?.followingLive ?? false}
          lastExplicitRowByNode={room.lastExplicitRowByNode}
          onOpenRoom={handleOpenRoom}
          onCloseRoom={handleCloseRoom}
          runId={runId}
          runStartedAt={runStartedAtIso}
          nodeStates={queryData?.nodeStates ?? []}
          events={queryData?.events ?? []}
          nodeExecutions={queryData?.nodeExecutions}
          loadMessages={getWorkflowNodeMessages}
          parentPlatformId={parentPlatformId}
          loadParentMessages={getMessages}
          loadParentConversation={getConversation}
          sendParentMessage={sendMessage}
          roomHeader={<div data-testid="legacy-run-shell-chrome">{retryActionPanel}</div>}
          definitionNodes={dagDefinitionNodes ?? []}
          definitionPending={workflowDefPending}
          runStatus={workflow.status}
          approval={queryData?.approval ?? null}
          onApprove={handleGateApprove}
          onReject={handleGateReject}
          pendingInteractions={queryData?.pendingInteractions ?? []}
          viewerIsStarter={queryData?.viewerIsStarter ?? false}
          starterDisplayName={queryData?.starterDisplayName ?? null}
          actionStates={askActionStates}
          onSubmitAsk={askController.submit}
          headerModel={headerModel}
          headerOptions={headerOptions}
          executionCount={executionCount}
          runOfTotal={runOfTotal}
          onSelectExecution={handleSelectExecution}
          scopeKey={transcriptScopeKey}
          initialScrollTop={initialScrollTop}
          onScrollTopChange={handleScrollTopChange}
          askDrafts={askDrafts}
          onAskDraftChange={updateAskDraft}
          onRunSettleHint={handleRunSettleHint}
          terminalEdgeKick={terminalEdgeKick}
        />
      </div>
    </runUsageContext.Provider>
  );
}
