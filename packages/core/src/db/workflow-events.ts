/**
 * Database operations for workflow events (lean UI-relevant events).
 *
 * Stores step transitions, parallel agent status, artifacts, and errors.
 * Verbose assistant/tool content stays in JSONL logs only.
 *
 * All write operations use fire-and-forget pattern (catch + log, never throw)
 * because workflow execution must not fail due to event logging.
 * Read operations also throw on error — callers own the degradation policy.
 */
import { pool, getDialect, getDatabaseType } from './connection';
import type { QueryResult } from './adapters/types';
import type { WorkflowEventRow } from '../schemas/workflow-event';
import { createLogger } from '@archon/paths';
import { projectLatestEffectiveNodeStates } from '@archon/workflows/retry-state';

/** Lazy-initialized logger (deferred so test mocks can intercept createLogger) */
let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('db.workflow-events');
  return cachedLog;
}

export type { WorkflowEventRow } from '../schemas/workflow-event';

/**
 * Format a Date for a `created_at` comparison param to match how each dialect
 * STORES it. SQLite stores `datetime('now')` → "YYYY-MM-DD HH:MM:SS" as TEXT and
 * compares lexicographically, so the cursor MUST use that exact shape — an ISO
 * string ("…T…Z") sorts wrong (the space at index 10 is below 'T'), so
 * `created_at >= cursor` would silently match nothing. Postgres has a native
 * timestamptz and accepts the ISO string.
 */
function toDbDateParam(d: Date): string {
  return getDatabaseType() === 'sqlite'
    ? d.toISOString().replace('T', ' ').slice(0, 19) // "YYYY-MM-DD HH:MM:SS"
    : d.toISOString();
}

/**
 * Parse a row's `data` JSON defensively. A single malformed row must not abort a
 * whole batch — for the dashboard poller that would freeze the cursor and stop
 * all live updates (the same query keeps re-throwing). Bad data degrades to `{}`.
 */
function parseEventRow(row: WorkflowEventRow): WorkflowEventRow {
  if (typeof row.data !== 'string') return row;
  try {
    return { ...row, data: JSON.parse(row.data) as Record<string, unknown> };
  } catch (err) {
    getLog().warn(
      { err: err as Error, eventId: row.id, runId: row.workflow_run_id },
      'db.workflow_event_data_parse_failed'
    );
    return { ...row, data: {} };
  }
}

/** The column payload for a single workflow-event row. */
export interface WorkflowEventInput {
  workflow_run_id: string;
  event_type: string;
  step_index?: number;
  step_name?: string;
  data?: Record<string, unknown>;
  /**
   * Optional caller-generated event id. When omitted, a UUID is generated.
   * The usage recorder supplies a pre-tx id so the event-only fallback can
   * reuse it without creating a second row.
   */
  id?: string;
}

/** Options for the throwing insert primitive. */
export interface InsertWorkflowEventOptions {
  /**
   * When true, ignore primary-key collisions (`ON CONFLICT (id) DO NOTHING`).
   * Restricted to the usage-recorder event-only fallback path so an ambiguous
   * commit cannot create a second `node_usage_recorded` event.
   * Default path still throws on duplicate ids.
   */
  ignoreDuplicateId?: boolean;
}

/**
 * A query function scoped to a specific connection — either the module-level
 * `pool` or a transaction-scoped query from `IDatabase.withTransaction`. The row
 * type is unused (INSERT returns none), so it is fixed to `unknown` rather than
 * generic, which lets a generic transaction query be passed directly.
 */
type EventInsertQuery = (sql: string, params?: unknown[]) => Promise<QueryResult<unknown>>;

/**
 * Insert one workflow-event row via `query` and THROW on failure. This is the
 * single source of truth for the event columns and dialect UUID; the
 * fire-and-forget createWorkflowEvent wraps it in try/catch, while callers that
 * need the write to be atomic with another mutation (the approval-gate CAS in
 * db/workflows.ts, #2146) pass a transaction-scoped query so a failed event
 * write rolls back the enclosing UPDATE instead of stranding a resolved gate
 * with no audit trail.
 *
 * Returns the inserted (or caller-supplied) event id. Existing callers may
 * ignore the return value. Optional `ignoreDuplicateId` is for the usage
 * recorder fallback only.
 */
export async function insertWorkflowEvent(
  query: EventInsertQuery,
  data: WorkflowEventInput,
  options?: InsertWorkflowEventOptions
): Promise<string> {
  const dialect = getDialect();
  const id = data.id ?? dialect.generateUuid();
  const conflictClause = options?.ignoreDuplicateId ? '\n     ON CONFLICT (id) DO NOTHING' : '';
  await query(
    `INSERT INTO remote_agent_workflow_events (id, workflow_run_id, event_type, step_index, step_name, data)
     VALUES ($1, $2, $3, $4, $5, $6)${conflictClause}`,
    [
      id,
      data.workflow_run_id,
      data.event_type,
      data.step_index ?? null,
      data.step_name ?? null,
      JSON.stringify(data.data ?? {}),
    ]
  );
  return id;
}

/**
 * Create a workflow event. Fire-and-forget - never throws.
 */
export async function createWorkflowEvent(data: WorkflowEventInput): Promise<void> {
  try {
    await insertWorkflowEvent((sql, params) => pool.query(sql, params), data);
  } catch (error) {
    getLog().error(
      { err: error as Error, eventType: data.event_type, runId: data.workflow_run_id },
      'db.workflow_event_create_failed'
    );
    // Fire-and-forget: never throw
  }
}

/**
 * List all events for a workflow run in lifecycle order. `event_order` is
 * allocated by the database, so it preserves insertion order when timestamps tie.
 */
export async function listWorkflowEvents(workflowRunId: string): Promise<WorkflowEventRow[]> {
  try {
    const result = await pool.query<WorkflowEventRow>(
      `SELECT * FROM remote_agent_workflow_events
       WHERE workflow_run_id = $1
       ORDER BY created_at ASC, COALESCE(event_order, 0) ASC, id ASC`,
      [workflowRunId]
    );
    return [...result.rows].map(row => ({
      ...row,
      data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data,
    }));
  } catch (error) {
    getLog().error({ err: error as Error, runId: workflowRunId }, 'db.workflow_events_list_failed');
    throw new Error(`Failed to list workflow events: ${(error as Error).message}`);
  }
}

/**
 * List recent events for a workflow run since a given timestamp.
 */
export async function listRecentEvents(
  workflowRunId: string,
  since?: Date
): Promise<WorkflowEventRow[]> {
  try {
    if (since) {
      const result = await pool.query<WorkflowEventRow>(
        `SELECT * FROM remote_agent_workflow_events
         WHERE workflow_run_id = $1 AND created_at > $2
         ORDER BY created_at ASC, COALESCE(event_order, 0) ASC, id ASC`,
        [workflowRunId, since.toISOString()]
      );
      return [...result.rows].map(row => ({
        ...row,
        data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data,
      }));
    }
    return await listWorkflowEvents(workflowRunId);
  } catch (error) {
    getLog().error(
      { err: error as Error, runId: workflowRunId },
      'db.workflow_events_list_recent_failed'
    );
    throw new Error(`Failed to list recent workflow events: ${(error as Error).message}`);
  }
}

/**
 * List workflow events across ALL runs created at or after `after`, oldest first,
 * capped at `limit`. Used by the dashboard event poller to tail events written by
 * any process (incl. out-of-process CLI runs) and replay them to the SSE dashboard.
 *
 * `>=` (not `>`) so events sharing the boundary timestamp are not skipped — SQLite's
 * `datetime('now')` is 1-second resolution, so ties are common; the caller dedupes by
 * id at the boundary and tolerates harmless duplicates (the dashboard reacts to events
 * by refetching, which is idempotent).
 *
 * `eventTypes` (when given) filters to those event types in SQL. The poller passes the
 * small set of dashboard-relevant types, which keeps high-frequency `tool_*` rows out of
 * the result — so a single 1-second bucket realistically never exceeds `limit`, and the
 * boundary `>=` + seen-set paging can't stall on overflow.
 */
export async function listWorkflowEventsSince(
  after: Date,
  limit: number,
  eventTypes?: readonly string[]
): Promise<WorkflowEventRow[]> {
  try {
    const params: unknown[] = [toDbDateParam(after)];
    let typeClause = '';
    if (eventTypes && eventTypes.length > 0) {
      const placeholders = eventTypes.map((_, i) => `$${String(i + 2)}`).join(', ');
      typeClause = ` AND event_type IN (${placeholders})`;
      params.push(...eventTypes);
    }
    params.push(limit);
    const limitParam = `$${String(params.length)}`;
    const result = await pool.query<WorkflowEventRow>(
      `SELECT * FROM remote_agent_workflow_events
       WHERE created_at >= $1${typeClause}
       ORDER BY created_at ASC, COALESCE(event_order, 0) ASC, id ASC
       LIMIT ${limitParam}`,
      params
    );
    return [...result.rows].map(parseEventRow);
  } catch (error) {
    getLog().error({ err: error as Error }, 'db.workflow_events_list_since_failed');
    throw new Error(
      `Failed to list workflow events since ${after.toISOString()}: ${(error as Error).message}`
    );
  }
}

/**
 * Return completed node outputs and cumulative token usage for a workflow run.
 * Used by the DAG executor to restore state when resuming a failed run.
 * Throws on DB error — caller owns the degradation policy.
 */
export async function getDagResumeSnapshot(workflowRunId: string): Promise<{
  completedNodeOutputs: Map<string, string>;
  tokens: { input: number; output: number };
}> {
  const result = await pool.query<{
    step_name: string | null;
    event_type: 'node_completed' | 'node_skipped_prior_success';
    data: string | Record<string, unknown>;
  }>(
    `SELECT step_name, event_type, data FROM remote_agent_workflow_events
     WHERE workflow_run_id = $1 AND event_type IN ('node_completed', 'node_skipped_prior_success')
     ORDER BY created_at ASC, COALESCE(event_order, 0) ASC, id ASC`,
    [workflowRunId]
  );
  const completedNodeOutputs = new Map<string, string>();
  const tokens = { input: 0, output: 0 };
  for (const row of result.rows) {
    if (!row.step_name) continue;
    let data: Record<string, unknown>;
    try {
      data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
    } catch (parseErr) {
      getLog().warn(
        { err: parseErr as Error, runId: workflowRunId, stepName: row.step_name },
        'db.workflow_dag_node_output_parse_failed'
      );
      continue;
    }
    if (typeof data.node_output === 'string') {
      completedNodeOutputs.set(row.step_name, data.node_output);
    }
    if (row.event_type === 'node_completed' && data.tokens !== undefined) {
      const eventTokens = data.tokens;
      if (
        typeof eventTokens === 'object' &&
        eventTokens !== null &&
        'input' in eventTokens &&
        'output' in eventTokens &&
        typeof eventTokens.input === 'number' &&
        typeof eventTokens.output === 'number' &&
        Number.isFinite(eventTokens.input) &&
        Number.isFinite(eventTokens.output)
      ) {
        tokens.input += eventTokens.input;
        tokens.output += eventTokens.output;
      } else {
        getLog().warn(
          { runId: workflowRunId, stepName: row.step_name, tokens: eventTokens },
          'db.workflow_dag_node_tokens_invalid_ignored'
        );
      }
    }
  }
  return { completedNodeOutputs, tokens };
}

/** Node-lifecycle event types marking a node's execution as settled. */
const TERMINAL_NODE_EVENT_TYPES: ReadonlySet<string> = new Set([
  'node_completed',
  'node_failed',
  'node_skipped',
  'node_routed',
  'node_skipped_prior_success',
]);

/**
 * Execution-scope keys `executionScopeEventFields`/loop-iteration bookkeeping
 * write onto a node's own lifecycle events (`transcript-execution-scope.ts`,
 * `dag-executor.ts`'s `iterationData`). Carried forward verbatim so a
 * synthesized terminal event attaches to the same execution/iteration row a
 * live cancel's own write would have, instead of landing unscoped.
 */
const SCOPE_DATA_KEYS = [
  'occurrence_id',
  'attempt_id',
  'retry_epoch',
  'loop_ancestry',
  'route_activation_seq',
  'iteration',
] as const;

function extractScopeData(data: Record<string, unknown>): Record<string, unknown> {
  const scope: Record<string, unknown> = {};
  for (const key of SCOPE_DATA_KEYS) {
    if (data[key] !== undefined) scope[key] = data[key];
  }
  return scope;
}

export interface NonTerminalNode {
  readonly nodeId: string;
  /** This node's own execution-scope fields, read off its latest event. */
  readonly scope: Record<string, unknown>;
}

/**
 * Every node (`step_name`) whose LATEST recorded event for this run is not
 * one of the terminal lifecycle types — a node currently mid-execution (or
 * mid-retry: a node that failed and then produced a fresh `node_started` is
 * correctly non-terminal again, which is why this reads the latest event
 * per node rather than merely checking whether a terminal event ever
 * occurred). Used to detect a node an executor abandoned mid-flight without
 * ever writing its own terminal event, typically because the process
 * running it exited (crash or restart) before it could.
 */
export async function findNonTerminalNodes(
  workflowRunId: string
): Promise<readonly NonTerminalNode[]> {
  const events = await listWorkflowEvents(workflowRunId);
  const latestByNode = new Map<string, WorkflowEventRow>();
  for (const event of events) {
    if (event.step_name === null || event.step_name === undefined) continue;
    // `listWorkflowEvents` orders ascending, so the last write for a given
    // step_name always overwrites the map entry with the newest event.
    latestByNode.set(event.step_name, event);
  }
  const result: NonTerminalNode[] = [];
  for (const [nodeId, latest] of latestByNode) {
    if (TERMINAL_NODE_EVENT_TYPES.has(latest.event_type)) continue;
    const data = typeof latest.data === 'object' && latest.data !== null ? latest.data : {};
    result.push({ nodeId, scope: extractScopeData(data) });
  }
  return result;
}

/**
 * Return node outputs from the latest effective retry epoch projection.
 *
 * Unlike getCompletedDagNodeOutputs(), this entry point reads the complete run
 * event history and applies node_retry_requested invalidation before returning
 * outputs. Older outputs for invalidated nodes are ignored until those nodes
 * complete again in the active retry epoch.
 */
export async function getEpochAwareCompletedDagNodeOutputs(
  workflowRunId: string
): Promise<Map<string, string>> {
  const events = await listWorkflowEvents(workflowRunId);
  const projected = projectLatestEffectiveNodeStates(events);
  const outputs = new Map<string, string>();
  for (const [nodeId, state] of projected) {
    if (state.state === 'completed') {
      outputs.set(nodeId, state.output);
    }
  }
  return outputs;
}

export async function getRetryPreservedDagNodeOutputs(
  workflowRunId: string,
  invalidatedNodeIds: readonly string[]
): Promise<Map<string, string>> {
  const outputs = await getEpochAwareCompletedDagNodeOutputs(workflowRunId);
  for (const nodeId of invalidatedNodeIds) {
    outputs.delete(nodeId);
  }
  return outputs;
}

/**
 * Look up a prior `review_feedback` receipt by run + request ID under an active
 * transaction. Returns the parsed event data, or null when no matching event
 * exists. Bounded: never reads transcript bodies; only event data fields.
 */
export async function findReviewFeedbackEventByRequestId(
  query: EventInsertQuery,
  runId: string,
  requestId: string
): Promise<Record<string, unknown> | null> {
  // Dialect-aware JSON extraction filters by data.requestId in SQL so we only
  // fetch matching events; a full scan over review_feedback rows is bounded.
  const extract =
    getDatabaseType() === 'postgresql' ? "data->>'requestId'" : "json_extract(data, '$.requestId')";
  const result = await query(
    `SELECT data FROM remote_agent_workflow_events
     WHERE workflow_run_id = $1 AND event_type = 'review_feedback' AND ${extract} = $2
     ORDER BY created_at DESC LIMIT 1`,
    [runId, requestId]
  );
  const row = result.rows[0] as { data: unknown } | undefined;
  if (!row) return null;
  const rawData = row.data;
  if (typeof rawData === 'string') {
    try {
      return JSON.parse(rawData) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return typeof rawData === 'object' && rawData !== null
    ? (rawData as Record<string, unknown>)
    : null;
}
