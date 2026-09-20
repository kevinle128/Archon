/**
 * Exact execution identity, header data, and room visit transitions.
 *
 * Selection, labels, opener ids, runtime fields, and visit reducers stay
 * pure so Legacy and Console can share the same resolution without sharing UI.
 * Focus restoration stays the caller's DOM responsibility via openerId.
 */
import type { components } from './api.generated';
import type { RoomSurface } from './room-split-layout';

type WorkflowEvent = components['schemas']['WorkflowEvent'];

export interface ExecutionLoopAncestryEntry {
  readonly nodeId: string;
  readonly iteration: number;
}

export type ExecutionRowSelection =
  | { kind: 'node' }
  | { kind: 'loop_iteration'; iteration: number }
  | { kind: 'route_iteration'; executionSeq: number }
  | {
      kind: 'occurrence';
      occurrenceId: string;
      attemptId?: string;
      retryEpoch?: number;
      iteration?: number;
      routeActivationSeq?: number;
      loopAncestry?: readonly ExecutionLoopAncestryEntry[];
    };

export interface FinishedIterationView {
  readonly liveRowId: string;
  readonly liveIteration: number;
}

export interface ExecutionRow {
  id: string;
  nodeId: string;
  label: string;
  status: string;
  order: number;
  selection: ExecutionRowSelection;
  startedAt?: string;
  durationMs?: number;
  startedOffsetMs?: number;
  unknownScope?: boolean;
}

export interface ExecutionHeaderModel {
  nodeId: string;
  nodeLabel: string;
  executionLabel: string;
  status: string;
  startedOffsetMs: number | null;
  durationMs: number | null;
  provider: string | null;
  model: string | null;
  unknownScope: boolean;
}

export interface ExecutionHeaderInput {
  row: ExecutionRow;
  events: readonly WorkflowEvent[];
  runStartedAt: string;
}

export type RoomOpenerKind = 'log' | 'graph';

interface ExecutionChoiceRow {
  id: string;
  nodeId: string;
  status: string;
  order: number;
}

interface FinishedIterationRow {
  id: string;
  nodeId: string;
  status: string;
  order: number;
  selection: ExecutionRowSelection;
  unknownScope?: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function latestByOrder<T extends { order: number }>(rows: readonly T[]): T {
  return rows.reduce((best, row) => (row.order >= best.order ? row : best));
}

function executionLabel(selection: ExecutionRowSelection): string {
  if (selection.kind === 'loop_iteration') {
    return `Iteration ${String(selection.iteration)}`;
  }
  if (selection.kind === 'route_iteration') {
    return `Route ${String(selection.executionSeq)}`;
  }
  if (selection.kind === 'occurrence') {
    const context: string[] = [];
    if (selection.routeActivationSeq !== undefined) {
      context.push(`Route ${String(selection.routeActivationSeq)}`);
    }
    if (selection.iteration !== undefined) {
      context.push(`Iteration ${String(selection.iteration)}`);
    }
    if (selection.retryEpoch !== undefined && selection.retryEpoch > 0) {
      context.push(`Attempt ${String(selection.retryEpoch + 1)}`);
    }
    return context.length > 0 ? context.join(' · ') : 'Attempt 1';
  }
  return 'Execution unknown';
}

function startedOffsetMs(row: ExecutionRow, runStartedAt: string): number | null {
  if (row.startedAt !== undefined) {
    const started = Date.parse(row.startedAt);
    const runStarted = Date.parse(runStartedAt);
    if (Number.isFinite(started) && Number.isFinite(runStarted)) {
      return Math.max(0, started - runStarted);
    }
  }
  return row.startedOffsetMs ?? null;
}

function eventMatchesSelection(event: WorkflowEvent, row: ExecutionRow): boolean {
  if (event.event_type !== 'node_started' || event.step_name !== row.nodeId) {
    return false;
  }
  const data = asRecord(event.data);
  if (data === null) return false;
  const occurrenceId = stringField(data, 'occurrence_id');
  const attemptId = stringField(data, 'attempt_id');
  if (row.selection.kind === 'occurrence') {
    if (occurrenceId !== row.selection.occurrenceId) return false;
    const expectedAttempt = row.selection.attemptId ?? null;
    return attemptId === expectedAttempt;
  }
  return occurrenceId === null && attemptId === null;
}

export function chooseExecutionForNode<T extends ExecutionChoiceRow>(
  rows: readonly T[],
  nodeId: string,
  lastExplicitRowId?: string | null
): T | null {
  const forNode = rows.filter(row => row.nodeId === nodeId);
  if (forNode.length === 0) return null;
  if (lastExplicitRowId !== undefined && lastExplicitRowId !== null) {
    const explicit = forNode.find(row => row.id === lastExplicitRowId);
    if (explicit !== undefined) return explicit;
  }
  const awaiting = forNode.filter(row => row.status === 'awaiting');
  if (awaiting.length > 0) return latestByOrder(awaiting);
  const running = forNode.filter(row => row.status === 'running');
  if (running.length > 0) return latestByOrder(running);
  return latestByOrder(forNode);
}

function sameAncestryPrefix(
  left: readonly ExecutionLoopAncestryEntry[],
  right: readonly ExecutionLoopAncestryEntry[]
): boolean {
  const leftPrefix = left.slice(0, -1);
  const rightPrefix = right.slice(0, -1);
  if (leftPrefix.length !== rightPrefix.length) return false;
  for (let index = 0; index < leftPrefix.length; index += 1) {
    const a = leftPrefix[index];
    const b = rightPrefix[index];
    if (a === undefined || b === undefined) return false;
    if (a.nodeId !== b.nodeId || a.iteration !== b.iteration) return false;
  }
  return true;
}

/**
 * Prove a same-lineage live iteration for a finished occurrence selection.
 * Fail closed on any identity doubt — shells only render finished-iteration
 * mode when this returns non-null.
 */
export function resolveFinishedIterationView(input: {
  rows: readonly FinishedIterationRow[];
  selected: FinishedIterationRow;
  nodeStatus: string;
  live: boolean;
}): FinishedIterationView | null {
  if (!input.live) return null;
  if (input.nodeStatus !== 'running' && input.nodeStatus !== 'awaiting') return null;

  const selected = input.selected;
  if (selected.unknownScope === true || selected.status !== 'completed') return null;
  if (selected.selection.kind !== 'occurrence') return null;

  const selectedAncestry = selected.selection.loopAncestry;
  if (selectedAncestry === undefined || selectedAncestry.length === 0) return null;
  const selectedFinal = selectedAncestry[selectedAncestry.length - 1];
  if (selectedFinal === undefined) return null;
  if (selected.selection.iteration !== selectedFinal.iteration) return null;

  const selectedIteration = selectedFinal.iteration;
  const selectedRetry = selected.selection.retryEpoch ?? 0;
  const selectedRoute = selected.selection.routeActivationSeq;

  const candidates = input.rows.filter(row => {
    if (row.id === selected.id) return false;
    if (row.nodeId !== selected.nodeId) return false;
    if (row.unknownScope === true) return false;
    if (row.status !== 'running' && row.status !== 'awaiting') return false;
    if (row.selection.kind !== 'occurrence') return false;

    const ancestry = row.selection.loopAncestry;
    if (ancestry === undefined || ancestry.length === 0) return false;
    const finalEntry = ancestry[ancestry.length - 1];
    if (finalEntry === undefined) return false;
    if (row.selection.iteration !== finalEntry.iteration) return false;
    if (finalEntry.iteration <= selectedIteration) return false;
    if (finalEntry.nodeId !== selectedFinal.nodeId) return false;
    if ((row.selection.retryEpoch ?? 0) !== selectedRetry) return false;

    const candidateRoute = row.selection.routeActivationSeq;
    if (selectedRoute === undefined || candidateRoute === undefined) {
      if (selectedRoute !== candidateRoute) return false;
    } else if (selectedRoute !== candidateRoute) {
      return false;
    }

    return sameAncestryPrefix(ancestry, selectedAncestry);
  });

  if (candidates.length === 0) return null;

  const awaiting = candidates.filter(row => row.status === 'awaiting');
  const preferred =
    awaiting.length > 0
      ? latestByOrder(awaiting)
      : latestByOrder(candidates.filter(row => row.status === 'running'));

  if (preferred.selection.kind !== 'occurrence') return null;
  const preferredAncestry = preferred.selection.loopAncestry;
  if (preferredAncestry === undefined || preferredAncestry.length === 0) return null;
  const preferredFinal = preferredAncestry[preferredAncestry.length - 1];
  if (preferredFinal === undefined) return null;

  return {
    liveRowId: preferred.id,
    liveIteration: preferredFinal.iteration,
  };
}

export function chooseExecutionForInteraction<
  T extends ExecutionChoiceRow & { selection: ExecutionRowSelection },
>(
  rows: readonly T[],
  interaction: {
    node_id: string;
    execution_scope?: { occurrence_id: string; attempt_id: string } | null;
  }
): T | null {
  const forNode = rows.filter(row => row.nodeId === interaction.node_id);
  if (forNode.length === 0) return null;
  if (interaction.execution_scope == null) return latestByOrder(forNode);
  return (
    forNode.find(
      row =>
        row.selection.kind === 'occurrence' &&
        row.selection.occurrenceId === interaction.execution_scope?.occurrence_id &&
        row.selection.attemptId === interaction.execution_scope.attempt_id
    ) ?? null
  );
}

export function runtimeForSelection(
  events: readonly WorkflowEvent[],
  row: ExecutionRow
): { provider: string; model: string } | null {
  const matches = events.filter(event => eventMatchesSelection(event, row));
  if (matches.length === 0) return null;
  const selected = row.selection.kind === 'occurrence' ? matches[0] : matches[matches.length - 1];
  if (selected === undefined) return null;
  const data = asRecord(selected.data);
  if (data === null) return null;
  const provider = stringField(data, 'provider');
  const model = stringField(data, 'model');
  if (provider === null && model === null) return null;
  return { provider: provider ?? '', model: model ?? '' };
}

export function buildExecutionHeader(input: ExecutionHeaderInput): ExecutionHeaderModel {
  const runtime = runtimeForSelection(input.events, input.row);
  return {
    nodeId: input.row.nodeId,
    nodeLabel: input.row.label,
    executionLabel: executionLabel(input.row.selection),
    status: input.row.status,
    startedOffsetMs: startedOffsetMs(input.row, input.runStartedAt),
    durationMs: input.row.durationMs ?? null,
    provider: runtime?.provider || null,
    model: runtime?.model || null,
    unknownScope: input.row.unknownScope ?? true,
  };
}

export function roomOpenerId(surface: RoomSurface, kind: RoomOpenerKind, key: string): string {
  return `${surface}-${kind}-${encodeURIComponent(key)}`;
}

export function askCardId(requestId: string, mountContext?: string): string {
  const base = `run-ask-card-${encodeURIComponent(requestId)}`;
  return mountContext === undefined || mountContext === 'default'
    ? base
    : `${base}-${encodeURIComponent(mountContext)}`;
}

export interface RoomVisitSelection {
  nodeId: string;
  rowId: string;
  openerId: string | null;
}

export interface RoomVisitState {
  runId: string;
  selection: RoomVisitSelection | null;
  lastExplicitRowByNode: Record<string, string>;
  appliedDeepLinkNode: string | null;
  scrollTopByScope: Record<string, number>;
}

export function resetRoomVisit(runId: string): RoomVisitState {
  return {
    runId,
    selection: null,
    lastExplicitRowByNode: {},
    appliedDeepLinkNode: null,
    scrollTopByScope: {},
  };
}

export function openRoom(state: RoomVisitState, selection: RoomVisitSelection): RoomVisitState {
  return { ...state, selection };
}

export function openExplicitRoom(
  state: RoomVisitState,
  selection: RoomVisitSelection
): RoomVisitState {
  return {
    ...openRoom(state, selection),
    lastExplicitRowByNode: {
      ...state.lastExplicitRowByNode,
      [selection.nodeId]: selection.rowId,
    },
  };
}

export function closeRoom(state: RoomVisitState): RoomVisitState {
  return { ...state, selection: null };
}

export function rememberRoomScroll(
  state: RoomVisitState,
  scopeKey: string,
  scrollTop: number
): RoomVisitState {
  return {
    ...state,
    scrollTopByScope: { ...state.scrollTopByScope, [scopeKey]: scrollTop },
  };
}

export function applyRoomDeepLink(
  state: RoomVisitState,
  queryNode: string | null,
  rows: readonly ExecutionChoiceRow[]
): RoomVisitState {
  if (queryNode === null) {
    if (state.appliedDeepLinkNode === null) return state;
    return { ...state, appliedDeepLinkNode: null };
  }
  if (state.appliedDeepLinkNode === queryNode) return state;
  const row = chooseExecutionForNode(rows, queryNode, state.lastExplicitRowByNode[queryNode]);
  if (row === null) {
    return rows.length === 0 ? state : { ...state, appliedDeepLinkNode: queryNode };
  }
  return openRoom(
    { ...state, appliedDeepLinkNode: queryNode },
    { nodeId: queryNode, rowId: row.id, openerId: null }
  );
}

type NodeExecution = components['schemas']['NodeExecution'];

/** Only completed/failed/skipped are terminal raw execution statuses. */
function isTerminalNodeExecutionStatus(status: string): boolean {
  return status === 'completed' || status === 'failed' || status === 'skipped';
}

function compareWorkflowEvents(left: WorkflowEvent, right: WorkflowEvent): number {
  const orderLeft = left.event_order ?? Number.MAX_SAFE_INTEGER;
  const orderRight = right.event_order ?? Number.MAX_SAFE_INTEGER;
  if (orderLeft !== orderRight) return orderLeft - orderRight;
  const leftMs = Date.parse(left.created_at);
  const rightMs = Date.parse(right.created_at);
  const byTime = (Number.isFinite(leftMs) ? leftMs : 0) - (Number.isFinite(rightMs) ? rightMs : 0);
  if (byTime !== 0) return byTime;
  return left.id.localeCompare(right.id);
}

/**
 * True when any raw execution is still open. Undefined/empty history is settled
 * (no catch-up traffic). Unknown future statuses fail closed as unsettled.
 */
export function hasUnsettledNodeExecutions(
  executions: readonly NodeExecution[] | null | undefined
): boolean {
  if (executions === null || executions === undefined || executions.length === 0) {
    return false;
  }
  return executions.some(execution => !isTerminalNodeExecutionStatus(execution.status));
}

function isTerminalRunStatus(status: string): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

/**
 * Live runs poll every 3s. Terminal runs keep the same 3s cadence only while
 * raw nodeExecutions still contain an unsettled row; otherwise polling stops.
 */
export function resolveRunDetailRefetchIntervalMs(
  status: string | undefined,
  executions: readonly NodeExecution[] | null | undefined
): number | false {
  if (status !== undefined && isTerminalRunStatus(status)) {
    return hasUnsettledNodeExecutions(executions) ? 3000 : false;
  }
  return 3000;
}

/**
 * True only when the selected node has ≥1 raw execution and every one of them
 * is terminal. Sibling history never marks the selected node terminal.
 */
export function hasTerminalNodeEvidence(
  executions: readonly NodeExecution[] | null | undefined,
  nodeId: string
): boolean {
  if (executions === null || executions === undefined || executions.length === 0) {
    return false;
  }
  const forNode = executions.filter(execution => execution.node_id === nodeId);
  if (forNode.length === 0) return false;
  return forNode.every(execution => isTerminalNodeExecutionStatus(execution.status));
}

/**
 * Stable logical execution key for a node from ordered raw events.
 * Ask resume (`interaction_resolved` kind ask + resumed true) keeps the prior
 * key across the next same-node start; every other start adopts occurrence/event
 * identity. Loop-iteration starts and siblings are ignored.
 */
export function latestNodeExecutionKey(
  events: readonly WorkflowEvent[] | null | undefined,
  nodeId: string
): string | null {
  if (events === null || events === undefined || events.length === 0) return null;

  let key: string | null = null;
  let askContinuationArmed = false;

  for (const event of events.slice().sort(compareWorkflowEvents)) {
    if (event.step_name !== nodeId) continue;

    if (event.event_type === 'interaction_resolved') {
      const data = event.data as Record<string, unknown>;
      if (data.kind === 'ask' && data.resumed === true) {
        askContinuationArmed = true;
      }
      continue;
    }

    if (
      event.event_type === 'node_retry_requested' ||
      event.event_type === 'node_completed' ||
      event.event_type === 'node_failed' ||
      event.event_type === 'node_skipped' ||
      event.event_type === 'node_skipped_prior_success'
    ) {
      askContinuationArmed = false;
      continue;
    }

    if (event.event_type !== 'node_started') continue;

    const occurrence = (event.data as Record<string, unknown>).occurrence_id;
    const identity =
      typeof occurrence === 'string' && occurrence.length > 0 ? occurrence : event.id;

    if (askContinuationArmed) {
      askContinuationArmed = false;
      if (key === null) {
        key = identity;
      }
      continue;
    }

    key = identity;
  }

  return key;
}

/**
 * True when the latest logical execution for `nodeId` failed with structured
 * `failure_reason: 'idle_after_interrupt_timeout'`. Ordering uses
 * `compareWorkflowEvents`. A later start/complete/skip/retry for the same node
 * clears the cause; sibling-node and loop-iteration events are ignored.
 */
export function latestNodeFailedByIdleExpiry(
  events: readonly WorkflowEvent[] | null | undefined,
  nodeId: string
): boolean {
  if (events === null || events === undefined || events.length === 0) return false;

  let failedByIdle = false;

  for (const event of events.slice().sort(compareWorkflowEvents)) {
    if (event.step_name !== nodeId) continue;
    if (event.event_type.startsWith('loop_iteration_')) continue;

    if (
      event.event_type === 'node_started' ||
      event.event_type === 'node_completed' ||
      event.event_type === 'node_skipped' ||
      event.event_type === 'node_skipped_prior_success' ||
      event.event_type === 'node_retry_requested'
    ) {
      failedByIdle = false;
      continue;
    }

    if (event.event_type !== 'node_failed') continue;

    const data = asRecord(event.data);
    failedByIdle = data !== null && data.failure_reason === 'idle_after_interrupt_timeout';
  }

  return failedByIdle;
}
