/**
 * Server-owned workflow execution history.
 *
 * Groups lifecycle events into ordered occurrences without selecting
 * transcript bodies. Old rows without occurrence_id are paired from
 * unambiguous start/terminal markers; overlapping unmarked starts stay
 * unknown-scope rather than being assigned to the first iteration.
 *
 * After lifecycle pairing, purged/answered Ask interactions may close
 * exact scoped open executions (and uniquely proven loop owners) in this
 * read model only — no lifecycle rows are fabricated or mutated.
 */
import type { WorkflowEventRow } from '@archon/core/schemas/workflow-event';
import { nodeExecutionSchema, type NodeExecution } from '@archon/workflows/schemas/node-execution';
import type { PendingInteraction } from '@archon/workflows/schemas/pending-interaction';

const START_EVENTS = new Set(['node_started', 'loop_iteration_started']);
const TERMINAL_EVENTS = new Set([
  'node_completed',
  'node_failed',
  'node_skipped',
  'node_skipped_prior_success',
  'loop_iteration_completed',
  'loop_iteration_failed',
]);
const TERMINAL_EXECUTION_STATUSES = new Set(['completed', 'failed', 'skipped']);

interface StartMeta {
  eventType: 'node_started' | 'loop_iteration_started';
  iteration: number | undefined;
  /** Index in the sorted event stream used for "later start" proofs. */
  sortedIndex: number;
}

export interface ProjectWorkflowExecutionHistoryInput {
  events: readonly WorkflowEventRow[];
  pendingInteractions?: readonly PendingInteraction[];
  runStartedAt?: string;
}

function asRecord(data: unknown): Record<string, unknown> {
  return data !== null && typeof data === 'object' ? (data as Record<string, unknown>) : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asEpoch(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function asLoopAncestry(value: unknown): NodeExecution['loop_ancestry'] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const entries: NonNullable<NodeExecution['loop_ancestry']> = [];
  for (const item of value) {
    const rec = asRecord(item);
    const nodeId = asString(rec.node_id);
    if (nodeId === undefined) return undefined;
    if (
      typeof rec.iteration !== 'number' ||
      !Number.isInteger(rec.iteration) ||
      rec.iteration < 1
    ) {
      return undefined;
    }
    entries.push({ node_id: nodeId, iteration: rec.iteration });
  }
  return entries;
}

function eventMs(row: WorkflowEventRow): number {
  const parsed = Date.parse(row.created_at);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortEvents(events: readonly WorkflowEventRow[]): WorkflowEventRow[] {
  return events.slice().sort((left, right) => {
    const orderLeft = left.event_order ?? Number.MAX_SAFE_INTEGER;
    const orderRight = right.event_order ?? Number.MAX_SAFE_INTEGER;
    if (orderLeft !== orderRight) return orderLeft - orderRight;
    const byTime = eventMs(left) - eventMs(right);
    if (byTime !== 0) return byTime;
    return left.id.localeCompare(right.id);
  });
}

function statusFromEvent(eventType: string, data: Record<string, unknown>): string {
  if (eventType === 'node_completed' || eventType === 'loop_iteration_completed')
    return 'completed';
  if (eventType === 'node_failed' || eventType === 'loop_iteration_failed') return 'failed';
  if (eventType === 'node_skipped' || eventType === 'node_skipped_prior_success') return 'skipped';
  if (eventType === 'node_started' || eventType === 'loop_iteration_started') return 'running';
  const awaiting = asString(data.state);
  return awaiting ?? eventType;
}

function pushOccurrence(
  openByOccurrence: Map<string, NodeExecution[]>,
  occurrenceId: string,
  execution: NodeExecution
): void {
  const stack = openByOccurrence.get(occurrenceId);
  if (stack === undefined) openByOccurrence.set(occurrenceId, [execution]);
  else stack.push(execution);
}

function popOccurrence(
  openByOccurrence: Map<string, NodeExecution[]>,
  occurrenceId: string
): NodeExecution | undefined {
  const stack = openByOccurrence.get(occurrenceId);
  if (stack === undefined || stack.length === 0) return undefined;
  const open = stack.pop();
  if (stack.length === 0) openByOccurrence.delete(occurrenceId);
  return open;
}

function closeExecution(
  open: NodeExecution,
  row: WorkflowEventRow,
  data: Record<string, unknown>,
  runStartedMs: number | undefined
): NodeExecution {
  const endedAt = row.created_at;
  const startedMs = open.started_at !== undefined ? Date.parse(open.started_at) : Number.NaN;
  const endedMs = Date.parse(endedAt);
  const durationMs =
    Number.isFinite(startedMs) && Number.isFinite(endedMs) && endedMs >= startedMs
      ? endedMs - startedMs
      : undefined;
  const startOffsetMs =
    runStartedMs !== undefined && Number.isFinite(startedMs) && startedMs >= runStartedMs
      ? startedMs - runStartedMs
      : open.start_offset_ms;
  const attemptId = asString(data.attempt_id);
  const retryEpoch = asEpoch(data.retry_epoch);
  const loopAncestry = asLoopAncestry(data.loop_ancestry);
  const routeActivationSeq = asEpoch(data.route_activation_seq);
  return nodeExecutionSchema.parse({
    ...open,
    ...(attemptId !== undefined ? { attempt_id: attemptId } : {}),
    ...(retryEpoch !== undefined ? { retry_epoch: retryEpoch } : {}),
    ...(loopAncestry !== undefined ? { loop_ancestry: loopAncestry } : {}),
    ...(routeActivationSeq !== undefined ? { route_activation_seq: routeActivationSeq } : {}),
    status: statusFromEvent(row.event_type, data),
    ended_at: endedAt,
    ...(durationMs !== undefined ? { duration_ms: durationMs } : {}),
    ...(startOffsetMs !== undefined ? { start_offset_ms: startOffsetMs } : {}),
    ...(asString(data.error) !== undefined ? { error: asString(data.error) } : {}),
  });
}

function asResolvedAtIso(value: unknown): string | undefined {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
  }
  if (typeof value === 'string' && value.length > 0) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
  }
  return undefined;
}

function isOpenExecution(execution: NodeExecution): boolean {
  return !TERMINAL_EXECUTION_STATUSES.has(execution.status);
}

function ancestryEquals(
  left: NodeExecution['loop_ancestry'] | undefined,
  right: readonly { readonly node_id: string; readonly iteration: number }[] | undefined
): boolean {
  const a = left ?? [];
  const b = right ?? [];
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const leftEntry = a[i];
    const rightEntry = b[i];
    if (
      leftEntry?.node_id !== rightEntry?.node_id ||
      leftEntry.iteration !== rightEntry.iteration
    ) {
      return false;
    }
  }
  return true;
}

function markFailedFromResolution(execution: NodeExecution, endedAt: string): void {
  if (!isOpenExecution(execution)) return;
  execution.status = 'failed';
  execution.ended_at = endedAt;
  const startedMs =
    execution.started_at !== undefined ? Date.parse(execution.started_at) : Number.NaN;
  const endedMs = Date.parse(endedAt);
  if (Number.isFinite(startedMs) && Number.isFinite(endedMs) && endedMs >= startedMs) {
    execution.duration_ms = endedMs - startedMs;
  } else {
    delete execution.duration_ms;
  }
}

/** Answered resume only considers starts that precede the matching resolved event. */
function isPreResolutionStart(
  execution: NodeExecution,
  startMeta: ReadonlyMap<NodeExecution, StartMeta>,
  beforeSortedIndex: number | undefined
): boolean {
  if (beforeSortedIndex === undefined) return true;
  const meta = startMeta.get(execution);
  return meta !== undefined && meta.sortedIndex < beforeSortedIndex;
}

/**
 * Prefer exact occurrence+attempt; otherwise one unambiguous same-node/same-occurrence
 * open execution may adopt the scope (re-ask rollover), clearing stale start timing.
 * When beforeSortedIndex is set (answered resume), only pre-resolution starts qualify.
 */
function findScopedOpenExecution(
  executions: readonly NodeExecution[],
  startMeta: ReadonlyMap<NodeExecution, StartMeta>,
  nodeId: string,
  occurrenceId: string,
  attemptId: string,
  retryEpoch: number | undefined,
  beforeSortedIndex: number | undefined
): NodeExecution | undefined {
  const exact: NodeExecution[] = [];
  const sameOccurrence: NodeExecution[] = [];
  for (const execution of executions) {
    if (execution.node_id !== nodeId || execution.occurrence_id !== occurrenceId) continue;
    if (!isOpenExecution(execution)) continue;
    if (!isPreResolutionStart(execution, startMeta, beforeSortedIndex)) continue;
    sameOccurrence.push(execution);
    if (execution.attempt_id === attemptId) exact.push(execution);
  }
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return undefined;
  if (sameOccurrence.length !== 1) return undefined;
  const adopted = sameOccurrence[0];
  if (adopted === undefined) return undefined;
  adopted.attempt_id = attemptId;
  if (retryEpoch !== undefined) adopted.retry_epoch = retryEpoch;
  delete adopted.started_at;
  delete adopted.start_offset_ms;
  delete adopted.duration_ms;
  delete adopted.ended_at;
  delete adopted.error;
  return adopted;
}

function uniqueOpenMatch(candidates: readonly NodeExecution[]): NodeExecution | undefined {
  return candidates.length === 1 ? candidates[0] : undefined;
}

function findIterationOwner(
  executions: readonly NodeExecution[],
  startMeta: ReadonlyMap<NodeExecution, StartMeta>,
  nodeId: string,
  iteration: number,
  prefix: readonly { readonly node_id: string; readonly iteration: number }[],
  beforeSortedIndex: number | undefined
): NodeExecution | undefined {
  const candidates: NodeExecution[] = [];
  for (const execution of executions) {
    if (!isOpenExecution(execution) || execution.node_id !== nodeId) continue;
    if (!isPreResolutionStart(execution, startMeta, beforeSortedIndex)) continue;
    const meta = startMeta.get(execution);
    if (meta?.eventType !== 'loop_iteration_started') continue;
    if (meta.iteration !== iteration) continue;
    if (!ancestryEquals(execution.loop_ancestry, prefix)) continue;
    candidates.push(execution);
  }
  return uniqueOpenMatch(candidates);
}

function findLoopContainerOwner(
  executions: readonly NodeExecution[],
  startMeta: ReadonlyMap<NodeExecution, StartMeta>,
  nodeId: string,
  parentPrefix: readonly { readonly node_id: string; readonly iteration: number }[],
  beforeSortedIndex: number | undefined
): NodeExecution | undefined {
  const candidates: NodeExecution[] = [];
  const expectedAncestry = parentPrefix.length > 0 ? parentPrefix : undefined;
  for (const execution of executions) {
    if (!isOpenExecution(execution) || execution.node_id !== nodeId) continue;
    if (!isPreResolutionStart(execution, startMeta, beforeSortedIndex)) continue;
    if (execution.node_type !== 'loop') continue;
    const meta = startMeta.get(execution);
    if (meta?.eventType !== 'node_started') continue;
    if (!ancestryEquals(execution.loop_ancestry, expectedAncestry)) continue;
    candidates.push(execution);
  }
  return uniqueOpenMatch(candidates);
}

function hasLaterMatchingStart(
  sortedEvents: readonly WorkflowEventRow[],
  afterIndex: number,
  predicate: (row: WorkflowEventRow, data: Record<string, unknown>) => boolean
): boolean {
  for (let index = afterIndex + 1; index < sortedEvents.length; index += 1) {
    const row = sortedEvents[index];
    if (row === undefined || !START_EVENTS.has(row.event_type)) continue;
    if (predicate(row, asRecord(row.data))) return true;
  }
  return false;
}

function laterStartProvesOwner(
  sortedEvents: readonly WorkflowEventRow[],
  afterIndex: number,
  execution: NodeExecution,
  meta: StartMeta | undefined
): boolean {
  if (meta?.eventType === 'loop_iteration_started') {
    return hasLaterMatchingStart(
      sortedEvents,
      afterIndex,
      (row, data) =>
        row.event_type === 'loop_iteration_started' &&
        row.step_name === execution.node_id &&
        typeof data.iteration === 'number'
    );
  }
  if (meta?.eventType === 'node_started' && execution.node_type === 'loop') {
    return hasLaterMatchingStart(
      sortedEvents,
      afterIndex,
      (row, data) =>
        row.event_type === 'node_started' &&
        row.step_name === execution.node_id &&
        asString(data.type) === 'loop'
    );
  }
  return hasLaterMatchingStart(
    sortedEvents,
    afterIndex,
    (row, data) =>
      row.event_type === 'node_started' &&
      row.step_name === execution.node_id &&
      asString(data.occurrence_id) === execution.occurrence_id &&
      asString(data.attempt_id) === execution.attempt_id
  );
}

function closeAncestryOwners(args: {
  executions: readonly NodeExecution[];
  startMeta: ReadonlyMap<NodeExecution, StartMeta>;
  ancestry: NonNullable<NodeExecution['loop_ancestry']>;
  endedAt: string;
  requireLaterStart: boolean;
  sortedEvents: readonly WorkflowEventRow[];
  resolvedEventIndex: number;
  beforeSortedIndex: number | undefined;
}): void {
  const {
    executions,
    startMeta,
    ancestry,
    endedAt,
    requireLaterStart,
    sortedEvents,
    resolvedEventIndex,
    beforeSortedIndex,
  } = args;
  for (let depth = 0; depth < ancestry.length; depth += 1) {
    const entry = ancestry[depth];
    if (entry === undefined) continue;
    const prefix = ancestry.slice(0, depth + 1);
    const parentPrefix = ancestry.slice(0, depth);

    const iterationOwner = findIterationOwner(
      executions,
      startMeta,
      entry.node_id,
      entry.iteration,
      prefix,
      beforeSortedIndex
    );
    if (iterationOwner !== undefined) {
      const meta = startMeta.get(iterationOwner);
      if (
        !requireLaterStart ||
        laterStartProvesOwner(sortedEvents, resolvedEventIndex, iterationOwner, meta)
      ) {
        markFailedFromResolution(iterationOwner, endedAt);
      }
    }

    const containerOwner = findLoopContainerOwner(
      executions,
      startMeta,
      entry.node_id,
      parentPrefix,
      beforeSortedIndex
    );
    if (containerOwner !== undefined) {
      const meta = startMeta.get(containerOwner);
      if (
        !requireLaterStart ||
        laterStartProvesOwner(sortedEvents, resolvedEventIndex, containerOwner, meta)
      ) {
        markFailedFromResolution(containerOwner, endedAt);
      }
    }
  }
}

function findResumedAskResolvedIndex(
  sortedEvents: readonly WorkflowEventRow[],
  nodeId: string,
  toolUseId: string
): number {
  for (let index = 0; index < sortedEvents.length; index += 1) {
    const row = sortedEvents[index];
    if (row?.event_type !== 'interaction_resolved') continue;
    if (row.step_name !== nodeId) continue;
    const data = asRecord(row.data);
    if (asString(data.kind) !== 'ask') continue;
    if (asString(data.tool_use_id) !== toolUseId) continue;
    if (data.resumed !== true) continue;
    return index;
  }
  return -1;
}

/**
 * Read-model only: close open executions proven superseded by a purged parked Ask
 * or a resumed answered Ask. Never fabricates lifecycle rows or mutates inputs.
 */
function applyAskResolutionClosures(args: {
  executions: NodeExecution[];
  startMeta: ReadonlyMap<NodeExecution, StartMeta>;
  sortedEvents: readonly WorkflowEventRow[];
  interactions: readonly PendingInteraction[];
}): void {
  const { executions, startMeta, sortedEvents, interactions } = args;

  for (const row of interactions) {
    if (row.kind !== 'ask') continue;
    if (row.status !== 'purged' && row.status !== 'answered') continue;

    const scope = row.execution_scope;
    if (scope == null) continue;
    const occurrenceId = scope.occurrence_id;
    const attemptId = scope.attempt_id;
    if (typeof occurrenceId !== 'string' || occurrenceId.length === 0) continue;
    if (typeof attemptId !== 'string' || attemptId.length === 0) continue;

    const endedAt = asResolvedAtIso(row.resolved_at);
    if (endedAt === undefined) continue;

    const requireLaterStart = row.status === 'answered';
    let resolvedEventIndex = -1;
    let beforeSortedIndex: number | undefined;
    if (requireLaterStart) {
      resolvedEventIndex = findResumedAskResolvedIndex(sortedEvents, row.node_id, row.tool_use_id);
      if (resolvedEventIndex < 0) continue;
      beforeSortedIndex = resolvedEventIndex;
    }

    const scoped = findScopedOpenExecution(
      executions,
      startMeta,
      row.node_id,
      occurrenceId,
      attemptId,
      scope.retry_epoch,
      beforeSortedIndex
    );
    if (scoped !== undefined) {
      const meta = startMeta.get(scoped);
      if (
        !requireLaterStart ||
        laterStartProvesOwner(sortedEvents, resolvedEventIndex, scoped, meta)
      ) {
        markFailedFromResolution(scoped, endedAt);
      }
    }

    const ancestry = scope.loop_ancestry;
    if (ancestry !== undefined && ancestry.length > 0) {
      closeAncestryOwners({
        executions,
        startMeta,
        ancestry,
        endedAt,
        requireLaterStart,
        sortedEvents,
        resolvedEventIndex,
        beforeSortedIndex,
      });
    }
  }
}

export function projectWorkflowExecutionHistory(
  input: ProjectWorkflowExecutionHistoryInput
): NodeExecution[] {
  const runStartedMs =
    input.runStartedAt !== undefined ? Date.parse(input.runStartedAt) : Number.NaN;
  const runStart = Number.isFinite(runStartedMs) ? runStartedMs : undefined;
  const completed: NodeExecution[] = [];
  const openByOccurrence = new Map<string, NodeExecution[]>();
  const openUnscopedByStep = new Map<string, NodeExecution>();
  const startMeta = new Map<NodeExecution, StartMeta>();
  const sortedEvents = sortEvents(input.events);

  for (let sortedIndex = 0; sortedIndex < sortedEvents.length; sortedIndex += 1) {
    const row = sortedEvents[sortedIndex];
    if (row === undefined) continue;
    const stepName = row.step_name;
    if (stepName === null || stepName.length === 0) continue;
    const data = asRecord(row.data);
    const occurrenceId = asString(data.occurrence_id);
    const attemptId = asString(data.attempt_id);
    const retryEpoch = asEpoch(data.retry_epoch);
    const nodeType = asString(data.type);

    if (START_EVENTS.has(row.event_type)) {
      const startOffsetMs =
        runStart !== undefined ? Math.max(0, eventMs(row) - runStart) : undefined;
      const loopAncestry = asLoopAncestry(data.loop_ancestry);
      const routeActivationSeq = asEpoch(data.route_activation_seq);
      const base: NodeExecution = nodeExecutionSchema.parse({
        node_id: stepName,
        status: 'running',
        started_at: row.created_at,
        ...(nodeType !== undefined ? { node_type: nodeType } : {}),
        ...(occurrenceId !== undefined ? { occurrence_id: occurrenceId } : {}),
        ...(attemptId !== undefined ? { attempt_id: attemptId } : {}),
        ...(retryEpoch !== undefined ? { retry_epoch: retryEpoch } : {}),
        ...(loopAncestry !== undefined ? { loop_ancestry: loopAncestry } : {}),
        ...(routeActivationSeq !== undefined ? { route_activation_seq: routeActivationSeq } : {}),
        ...(startOffsetMs !== undefined ? { start_offset_ms: startOffsetMs } : {}),
      });
      const iteration =
        typeof data.iteration === 'number' &&
        Number.isInteger(data.iteration) &&
        data.iteration >= 1
          ? data.iteration
          : undefined;
      startMeta.set(base, {
        eventType: row.event_type as 'node_started' | 'loop_iteration_started',
        iteration,
        sortedIndex,
      });
      if (occurrenceId !== undefined) {
        pushOccurrence(openByOccurrence, occurrenceId, base);
        continue;
      }
      const previousUnscoped = openUnscopedByStep.get(stepName);
      if (previousUnscoped !== undefined) {
        completed.push(
          nodeExecutionSchema.parse({
            ...previousUnscoped,
            unknown_scope: true,
            unknown_reason: 'overlapping_unscoped_starts',
          })
        );
      }
      openUnscopedByStep.set(stepName, base);
      continue;
    }

    if (!TERMINAL_EVENTS.has(row.event_type)) continue;

    if (occurrenceId !== undefined) {
      const open = popOccurrence(openByOccurrence, occurrenceId);
      if (open !== undefined) {
        completed.push(closeExecution(open, row, data, runStart));
        continue;
      }
      if (row.event_type === 'node_skipped' || row.event_type === 'node_skipped_prior_success') {
        completed.push(
          nodeExecutionSchema.parse({
            node_id: stepName,
            status: 'skipped',
            ended_at: row.created_at,
            started_at: row.created_at,
            ...(asString(data.type) !== undefined ? { node_type: asString(data.type) } : {}),
            occurrence_id: occurrenceId,
            ...(attemptId !== undefined ? { attempt_id: attemptId } : {}),
            ...(retryEpoch !== undefined ? { retry_epoch: retryEpoch } : {}),
          })
        );
        continue;
      }
    }
    const unscoped = openUnscopedByStep.get(stepName);
    if (unscoped !== undefined) {
      completed.push(closeExecution(unscoped, row, data, runStart));
      openUnscopedByStep.delete(stepName);
      continue;
    }
    completed.push(
      nodeExecutionSchema.parse({
        node_id: stepName,
        status: statusFromEvent(row.event_type, data),
        ended_at: row.created_at,
        unknown_scope: true,
        unknown_reason: 'terminal_without_matching_start',
        ...(asString(data.error) !== undefined ? { error: asString(data.error) } : {}),
        ...(occurrenceId !== undefined ? { occurrence_id: occurrenceId } : {}),
        ...(retryEpoch !== undefined ? { retry_epoch: retryEpoch } : {}),
      })
    );
  }

  for (const stack of openByOccurrence.values()) {
    for (const open of stack) completed.push(open);
  }
  for (const open of openUnscopedByStep.values()) completed.push(open);

  const awaiting = (input.pendingInteractions ?? []).filter(row => row.status === 'pending');
  for (const pending of awaiting) {
    const scope = pending.execution_scope;
    if (scope?.occurrence_id !== undefined) {
      const matchingAttempt = completed.find(
        item => item.occurrence_id === scope.occurrence_id && item.attempt_id === scope.attempt_id
      );
      const existing =
        matchingAttempt ?? completed.find(item => item.occurrence_id === scope.occurrence_id);
      if (existing !== undefined) {
        existing.status = 'awaiting';
        existing.attempt_id = scope.attempt_id;
        existing.retry_epoch = scope.retry_epoch;
        existing.loop_ancestry = scope.loop_ancestry;
        existing.route_activation_seq = scope.route_activation_seq;
        if (matchingAttempt === undefined) {
          delete existing.started_at;
          delete existing.start_offset_ms;
        }
        delete existing.ended_at;
        delete existing.duration_ms;
        delete existing.error;
        continue;
      }
    }
    completed.push(
      nodeExecutionSchema.parse({
        node_id: pending.node_id,
        status: 'awaiting',
        ...(scope != null
          ? {
              occurrence_id: scope.occurrence_id,
              attempt_id: scope.attempt_id,
              retry_epoch: scope.retry_epoch,
            }
          : { unknown_scope: true, unknown_reason: 'pending_without_execution_scope' }),
      })
    );
  }

  applyAskResolutionClosures({
    executions: completed,
    startMeta,
    sortedEvents,
    interactions: input.pendingInteractions ?? [],
  });

  return completed.sort((left, right) => {
    const leftStart = left.started_at ?? left.ended_at ?? '';
    const rightStart = right.started_at ?? right.ended_at ?? '';
    if (leftStart !== rightStart) return leftStart.localeCompare(rightStart);
    return left.node_id.localeCompare(right.node_id);
  });
}
