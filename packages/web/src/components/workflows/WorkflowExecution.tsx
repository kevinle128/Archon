import { useState, useEffect, useMemo, useRef, useCallback, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import { useQuery, useQueryClient } from '@tanstack/react-query';

import { DagNodeProgress } from './DagNodeProgress';
import { LegacyGraphLogsPane } from './LegacyGraphLogsPane';
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
import { ArtifactSummary } from './ArtifactSummary';
import { WorkflowNodeRetryAction } from './WorkflowNodeRetryAction';
import { DagRunTabs, type WorkflowRunView } from './source-control/dag-run-tabs';
import { SourceControlTab } from './source-control/source-control-tab';
import { TerminalTab } from './terminal/terminal-tab';
import { useWorkflowStore } from '@/stores/workflow-store';
import {
  answerAskHuman,
  approveWorkflowRun,
  getConversation,
  getMessages,
  getWorkflowRun,
  getWorkflowRunByWorker,
  getCodebase,
  getWorkflow,
  getWorkflowNodeMessages,
  rejectWorkflowRun,
  sendMessage,
  type NodeExecution,
  type PendingInteraction,
  type WorkflowEventResponse,
} from '@/lib/api';
import {
  applyRoomDeepLink,
  buildExecutionHeader,
  chooseExecutionForInteraction,
  chooseExecutionForNode,
  closeRoom,
  openRoom,
  openExplicitRoom,
  askCardId,
  rememberRoomScroll,
  resetRoomVisit,
  resolveRunDetailRefetchIntervalMs,
  roomOpenerId,
  type RoomVisitState,
} from '@/lib/execution-room-model';
import { nodeMessageScopeKey, type NodeMessageSelection } from '@/lib/node-message-pages';
import type { AskDraft, AskDraftByRequest } from './parse-ask-envelope';
import { ensureUtc, formatDurationMs } from '@/lib/format';
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

export type WorkflowExecutionBody =
  | 'graph-logs-pane'
  | 'source-control'
  | 'terminal'
  | 'sequential';

export function resolveWorkflowExecutionBody(input: {
  isDag: boolean;
  activeView: WorkflowRunView;
}): WorkflowExecutionBody {
  if (!input.isDag) return 'sequential';
  if (input.activeView === 'source-control') return 'source-control';
  if (input.activeView === 'terminal') return 'terminal';
  return 'graph-logs-pane';
}

interface WorkflowExecutionProps {
  runId: string;
}

function StatusBadge({ status }: { status: string }): React.ReactElement {
  const colors: Record<string, string> = {
    pending: 'bg-accent/20 text-accent',
    running: 'bg-accent/20 text-accent',
    completed: 'bg-success/20 text-success',
    failed: 'bg-error/20 text-error',
    cancelled: 'bg-surface text-text-secondary',
  };
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] ?? 'bg-surface text-text-secondary'}`}
    >
      {status}
    </span>
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

export function WorkflowExecution({ runId }: WorkflowExecutionProps): React.ReactElement {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const liveWorkflow = useWorkflowStore(s => s.workflows.get(runId));
  const [room, setRoom] = useState<RoomVisitState>(() => resetRoomVisit(runId));
  const [codebaseName, setCodebaseName] = useState<string | null>(null);
  const [codebaseCwd, setCodebaseCwd] = useState<string | null>(null);
  const [workerRunId, setWorkerRunId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<WorkflowRunView>('graph');
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
  const queryNode = searchParams.get('node');

  // Reset local state when navigating to a different workflow run
  useEffect(() => {
    setCodebaseName(null);
    setCodebaseCwd(null);
    setWorkerRunId(null);
    setActiveView('graph');
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
        setCodebaseName(cb.name);
        setCodebaseCwd(cb.default_cwd);
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
      const selection = { nodeId, rowId, openerId };
      setRoom(previous =>
        rememberExplicit ? openExplicitRoom(previous, selection) : openRoom(previous, selection)
      );
      setNodeScrollTrigger(prev => prev + 1);
    },
    []
  );

  const handleCloseRoom = useCallback((): void => {
    const openerId = room.selection?.openerId ?? null;
    setRoom(closeRoom);
    requestAnimationFrame(() => {
      if (openerId !== null) document.getElementById(openerId)?.focus({ preventScroll: true });
    });
  }, [room.selection?.openerId]);

  const selectedExecutionRow =
    executionRows.find(candidate => candidate.id === room.selection?.rowId) ?? null;
  const runStartedAtIso = workflow === null ? '' : new Date(workflow.startedAt).toISOString();
  const headerModel =
    selectedExecutionRow === null
      ? undefined
      : buildExecutionHeader({
          row: selectedExecutionRow,
          events: queryData?.events ?? [],
          runStartedAt: runStartedAtIso,
        });
  const headerOptions =
    selectedExecutionRow === null
      ? []
      : executionRows
          .filter(candidate => candidate.nodeId === selectedExecutionRow.nodeId)
          .map(candidate => ({
            rowId: candidate.id,
            label: buildExecutionHeader({
              row: candidate,
              events: queryData?.events ?? [],
              runStartedAt: runStartedAtIso,
            }).executionLabel,
          }));
  const handleSelectExecution = useCallback(
    (rowId: string): void => {
      const next = executionRows.find(candidate => candidate.id === rowId);
      if (next === undefined) return;
      setRoom(previous =>
        openExplicitRoom(previous, {
          nodeId: next.nodeId,
          rowId: next.id,
          openerId: previous.selection?.openerId ?? null,
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

  // Handler for user-initiated node clicks (graph or sidebar).
  // Increments scroll trigger so WorkflowLogs scrolls to the node's section.
  const handleNodeClick = useCallback(
    (nodeId: string): void => {
      const lastExplicit = room.lastExplicitRowByNode[nodeId] ?? null;
      const row = chooseExecutionForNode(executionRows, nodeId, lastExplicit);
      if (row === null) {
        setRoom(previous =>
          openRoom(previous, {
            nodeId,
            rowId: `node:${nodeId}`,
            openerId: roomOpenerId('legacy', 'graph', nodeId),
          })
        );
      } else {
        setRoom(previous =>
          openRoom(previous, {
            nodeId,
            rowId: row.id,
            openerId: roomOpenerId('legacy', 'graph', nodeId),
          })
        );
      }
      setNodeScrollTrigger(prev => prev + 1);
    },
    [executionRows, room.lastExplicitRowByNode]
  );

  const handleRetryDispatched = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: ['workflowRun', runId] });
    void queryClient.invalidateQueries({ queryKey: ['dashboardRuns'] });
    void queryClient.invalidateQueries({ queryKey: ['workflowRuns'] });
    void queryClient.invalidateQueries({ queryKey: ['workflow-runs-status'] });
  }, [queryClient, runId]);

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

  if (error) {
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
  const elapsed = startedAt ? Math.max(0, completedAt - startedAt) : 0;

  const isRunning = workflow.status === 'running' || workflow.status === 'pending';

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

  const renderBody = (): React.ReactElement => {
    const body = resolveWorkflowExecutionBody({
      isDag,
      activeView,
    });
    if (body === 'graph-logs-pane') {
      return (
        <LegacyGraphLogsPane
          activeView={activeView === 'chat' ? 'chat' : activeView === 'graph' ? 'graph' : 'logs'}
          renderGraph={renderGraph}
          selectedNodeId={selectedDagNode}
          selectedLogRowId={room.selection?.rowId ?? null}
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
          onSelectExecution={handleSelectExecution}
          scopeKey={transcriptScopeKey}
          initialScrollTop={initialScrollTop}
          onScrollTopChange={handleScrollTopChange}
          askDrafts={askDrafts}
          onAskDraftChange={updateAskDraft}
        />
      );
    }
    if (body === 'source-control') {
      return <SourceControlTab key={runId} runId={runId} />;
    }
    if (body === 'terminal') {
      return <TerminalTab key={runId} runId={runId} />;
    }
    return (
      <div className="flex flex-1 overflow-hidden min-h-0">
        <div className="w-64 border-r border-border overflow-auto">
          <DagNodeProgress
            nodes={workflow.dagNodes}
            activeNodeId={selectedDagNode}
            onNodeClick={handleNodeClick}
          />
        </div>
        {sequentialLogsPanel}
      </div>
    );
  };

  return (
    <div className="legacy-run-view flex flex-col h-full min-h-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <button
          onClick={(): void => {
            if (window.history.length > 1) {
              navigate(-1);
            } else {
              navigate('/legacy/workflows');
            }
          }}
          className="text-text-secondary hover:text-text-primary transition-colors text-sm"
          title="Back"
        >
          &larr;
        </button>
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="font-semibold text-text-primary truncate">{workflow.workflowName}</h2>
          <StatusBadge status={workflow.status} />
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
        </div>
        <div className="flex items-center gap-2 ml-auto shrink-0">
          {codebaseName && <span className="text-xs text-text-secondary">{codebaseName}</span>}
          {workerRunId && (
            <button
              onClick={(): void => {
                navigate(`/legacy/workflows/runs/${workerRunId}`);
              }}
              className="flex items-center gap-1 text-xs text-primary hover:text-accent-bright transition-colors"
              title="View workflow run details"
            >
              <span>Run Details</span>
            </button>
          )}
          <span className="text-xs text-text-secondary">{formatDurationMs(elapsed)}</span>
        </div>
      </div>

      {/* View tabs — only for DAG workflows */}
      {isDag && (
        <div className="flex items-center px-4 py-1.5 border-b border-border">
          <DagRunTabs
            activeView={activeView}
            parentPlatformId={parentPlatformId}
            onValueChange={setActiveView}
          />
        </div>
      )}
      <div data-testid="legacy-run-shell-chrome">
        {retryActionPanel}
        {!isRunning && workflow.artifacts.length > 0 ? (
          <div className="border-t border-border p-3">
            <ArtifactSummary artifacts={workflow.artifacts} runId={runId} />
          </div>
        ) : null}
      </div>
      {renderBody()}
    </div>
  );
}
