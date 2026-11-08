/**
 * Pure mapping from an Archon workflow run to the MCP shapes this server
 * exposes: the tasks-extension `DetailedTask`, the tool summary returned by
 * `get_run` / `list_runs`, and the `workflow_run.status_changed` event payload.
 *
 * Every caller (REST-backed MCP handlers and the in-process status-log writer)
 * reduces its data to `RunSnapshot` + `RunEventSnapshot[]` first, so the
 * mapping has exactly one implementation.
 */

/** Tasks stay addressable for 30 days; the server never fails or drops a task because of TTL. */
export const TASK_TTL_MS = 2_592_000_000;
/** Recommended `tasks/get` interval for clients. */
export const TASK_POLL_INTERVAL_MS = 5_000;

/**
 * Normalize a stored timestamp to ISO 8601 UTC. SQLite returns
 * `YYYY-MM-DD HH:MM:SS` (UTC, no zone); PostgreSQL rows arrive as `Date` or
 * ISO strings. A value that does not parse is returned unchanged.
 */
export function toIsoTimestamp(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const sqliteForm = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(value);
  const parsed = new Date(sqliteForm ? `${value.replace(' ', 'T')}Z` : value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

/**
 * A run id as either dialect stores it: a canonical UUID (PostgreSQL, and ids
 * chosen by MCP callers) or the hyphen-less 32-hex form SQLite generates by
 * default. PostgreSQL accepts both forms as `uuid` input, so a value that
 * passes never makes the database reject the lookup.
 */
const RUN_ID_PATTERN = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

export function isRunId(value: string): boolean {
  return RUN_ID_PATTERN.test(value);
}

export type TaskStatus = 'working' | 'input_required' | 'completed' | 'failed' | 'cancelled';

export interface RunSnapshot {
  id: string;
  workflow_name: string;
  /** Archon run status: pending, running, paused, completed, failed, cancelled. */
  status: string;
  metadata: Record<string, unknown>;
  /** ISO-8601, or null when unknown. */
  started_at: string | null;
  completed_at: string | null;
  last_activity_at: string | null;
}

export interface RunEventSnapshot {
  event_type: string;
  step_name: string | null;
  data: Record<string, unknown>;
  /** ISO-8601, when known. */
  created_at?: string | null;
}

export interface MappingOptions {
  /** Base URL of the Archon web UI, without a trailing slash. */
  baseUrl: string;
  /** The workflow's `returns:` node id, when known. */
  returnsNodeId?: string;
}

/** Gate types the MCP layer can answer with approve/reject. */
const ANSWERABLE_GATE_TYPES = new Set(['approval', 'interactive_loop']);

interface ApprovalView {
  nodeId: string;
  message: string;
  type: string;
  resolved: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function approvalOf(run: RunSnapshot): ApprovalView | undefined {
  const approval = asRecord(run.metadata.approval);
  if (typeof approval?.nodeId !== 'string') return undefined;
  return {
    nodeId: approval.nodeId,
    message: typeof approval.message === 'string' ? approval.message : '',
    // A pause written before `type` existed is a plain approval node.
    type: typeof approval.type === 'string' ? approval.type : 'approval',
    resolved: typeof approval.resolved === 'string' ? approval.resolved : null,
  };
}

/** Web UI link for one run. */
export function runUrl(baseUrl: string, runId: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/runs/${encodeURIComponent(runId)}`;
}

/** The approval gate the MCP client can answer now, or undefined. */
function openAnswerableGate(run: RunSnapshot): ApprovalView | undefined {
  if (run.status !== 'paused') return undefined;
  const approval = approvalOf(run);
  if (approval?.resolved !== null) return undefined;
  return ANSWERABLE_GATE_TYPES.has(approval.type) ? approval : undefined;
}

/**
 * Input request key for the open gate. Keys must be unique over the task's
 * lifetime, so the pause number of this node in this run is appended from the
 * second pause on: `approval-<nodeId>`, then `approval-<nodeId>-<n>`.
 *
 * The pause number is the count of `approval_requested` events for the node.
 * The engine writes that event just after it pauses the run, so while the
 * newest pause has no event yet the count of answers (`approval_received`)
 * plus one gives the same number; the larger of the two is used.
 */
export function inputRequestKey(
  run: RunSnapshot,
  events: readonly RunEventSnapshot[]
): string | undefined {
  const gate = openAnswerableGate(run);
  if (!gate) return undefined;
  let requests = 0;
  let answers = 0;
  for (const event of events) {
    if (event.event_type === 'approval_requested') {
      const nodeId = typeof event.data.nodeId === 'string' ? event.data.nodeId : event.step_name;
      if (nodeId === gate.nodeId) requests += 1;
    } else if (event.event_type === 'approval_received' && event.step_name === gate.nodeId) {
      answers += 1;
    }
  }
  const pause = Math.max(requests, answers + 1);
  return pause > 1 ? `approval-${gate.nodeId}-${String(pause)}` : `approval-${gate.nodeId}`;
}

export function taskStatusOf(run: RunSnapshot): TaskStatus {
  switch (run.status) {
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'paused':
      return openAnswerableGate(run) ? 'input_required' : 'working';
    default:
      return 'working';
  }
}

/** The node that started last and has not finished, or null. */
export function currentNode(events: readonly RunEventSnapshot[]): string | null {
  const open: string[] = [];
  for (const event of events) {
    const name = event.step_name;
    if (!name) continue;
    if (event.event_type === 'node_started') {
      const at = open.indexOf(name);
      if (at >= 0) open.splice(at, 1);
      open.push(name);
    } else if (
      event.event_type === 'node_completed' ||
      event.event_type === 'node_failed' ||
      event.event_type === 'node_skipped'
    ) {
      const at = open.indexOf(name);
      if (at >= 0) open.splice(at, 1);
    }
  }
  return open.at(-1) ?? null;
}

/** Parse a node output as the engine does for `$node.output.field`: the whole text must be JSON. */
function parseNodeOutput(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return '';
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return raw;
  }
}

function completedOutputs(events: readonly RunEventSnapshot[]): RunEventSnapshot[] {
  return events.filter(e => e.event_type === 'node_completed' && 'node_output' in e.data);
}

/**
 * The run's result value: the `returns:` node's output when that node
 * completed, else the output of the last completed node. JSON is parsed;
 * other text stays a string. Undefined when no node completed.
 */
export function selectRunOutput(
  events: readonly RunEventSnapshot[],
  returnsNodeId?: string
): unknown {
  const completed = completedOutputs(events);
  const fromReturns =
    returnsNodeId !== undefined
      ? completed.filter(e => e.step_name === returnsNodeId).at(-1)
      : undefined;
  const chosen = fromReturns ?? completed.at(-1);
  return chosen === undefined ? undefined : parseNodeOutput(chosen.data.node_output);
}

/** The newest completed node output that is a JSON object with a string `pr_url`. */
export function findPrUrl(events: readonly RunEventSnapshot[]): string | undefined {
  const completed = completedOutputs(events);
  for (let i = completed.length - 1; i >= 0; i--) {
    const parsed = asRecord(parseNodeOutput(completed[i]?.data.node_output));
    if (parsed && typeof parsed.pr_url === 'string' && parsed.pr_url.length > 0) {
      return parsed.pr_url;
    }
  }
  return undefined;
}

export interface CiResult {
  conclusion: unknown;
  failed: unknown;
  checks_url: unknown;
}

function ciOf(output: unknown): CiResult | undefined {
  const ci = asRecord(asRecord(output)?.ci);
  if (!ci) return undefined;
  return { conclusion: ci.conclusion, failed: ci.failed, checks_url: ci.checks_url };
}

function runError(run: RunSnapshot): string | undefined {
  return typeof run.metadata.error === 'string' && run.metadata.error.length > 0
    ? run.metadata.error
    : undefined;
}

/** Summary returned by `get_run` and, per run, by `list_runs`. */
export interface RunSummary {
  run_id: string;
  workflow: string;
  status: string;
  task_status: TaskStatus;
  current_node: string | null;
  question?: string;
  pr_url?: string;
  url: string;
  started_at: string | null;
  completed_at: string | null;
  error?: string;
}

export function buildRunSummary(
  run: RunSnapshot,
  events: readonly RunEventSnapshot[],
  options: MappingOptions
): RunSummary {
  const gate = openAnswerableGate(run);
  const prUrl = findPrUrl(events);
  const error = runError(run);
  return {
    run_id: run.id,
    workflow: run.workflow_name,
    status: run.status,
    task_status: taskStatusOf(run),
    current_node: currentNode(events),
    ...(gate ? { question: gate.message } : {}),
    ...(prUrl ? { pr_url: prUrl } : {}),
    url: runUrl(options.baseUrl, run.id),
    started_at: run.started_at,
    completed_at: run.completed_at,
    ...(error ? { error } : {}),
  };
}

/** `workflow_run.status_changed` event payload. */
export interface StatusEventPayload {
  run_id: string;
  workflow: string;
  status: string;
  task_status: TaskStatus;
  node?: string;
  question?: string;
  pr_url?: string;
  ci?: CiResult;
  url: string;
  error?: string;
}

export function buildStatusEventPayload(
  run: RunSnapshot,
  events: readonly RunEventSnapshot[],
  options: MappingOptions
): StatusEventPayload {
  const gate = openAnswerableGate(run);
  // While a gate waits for an answer no node runs, so the gate's node is the one
  // the client must show next to the question.
  const node = gate?.nodeId ?? currentNode(events);
  const prUrl = findPrUrl(events);
  const error = runError(run);
  const ci =
    run.status === 'completed' ? ciOf(selectRunOutput(events, options.returnsNodeId)) : undefined;
  return {
    run_id: run.id,
    workflow: run.workflow_name,
    status: run.status,
    task_status: taskStatusOf(run),
    ...(node ? { node } : {}),
    ...(gate ? { question: gate.message } : {}),
    ...(prUrl ? { pr_url: prUrl } : {}),
    ...(ci ? { ci } : {}),
    url: runUrl(options.baseUrl, run.id),
    ...(error ? { error } : {}),
  };
}

/** JSON Schema of the approval form; `decision` is required, `comment` optional. */
export const APPROVAL_REQUESTED_SCHEMA = {
  type: 'object',
  properties: {
    decision: { type: 'string', enum: ['approve', 'reject'] },
    comment: { type: 'string' },
  },
  required: ['decision'],
} as const;

export interface DetailedTaskOptions extends MappingOptions {
  /** Whether the `tasks/get` request declared the elicitation client capability. */
  elicitation: boolean;
}

export interface DetailedTask {
  taskId: string;
  status: TaskStatus;
  statusMessage?: string;
  createdAt: string;
  lastUpdatedAt: string;
  ttlMs: number;
  pollIntervalMs: number;
  inputRequests?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: Record<string, unknown> };
}

/**
 * `createdAt` must not move over the task's life, but a resume rewrites the
 * run's `started_at`. The earliest of `started_at` and the run's event times
 * is stable once the first event exists.
 */
function timestamps(
  run: RunSnapshot,
  events: readonly RunEventSnapshot[]
): { createdAt: string; lastUpdatedAt: string } {
  const candidates = [run.started_at, ...events.map(e => e.created_at)]
    .filter((t): t is string => typeof t === 'string' && !Number.isNaN(Date.parse(t)))
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  const createdAt = candidates[0] ?? new Date(0).toISOString();
  return {
    createdAt,
    lastUpdatedAt: run.completed_at ?? run.last_activity_at ?? createdAt,
  };
}

/** Fields shared by `CreateTaskResult` and every `DetailedTask`. */
export function taskBase(
  run: RunSnapshot,
  events: readonly RunEventSnapshot[]
): Omit<DetailedTask, 'status'> {
  return {
    taskId: run.id,
    ...timestamps(run, events),
    ttlMs: TASK_TTL_MS,
    pollIntervalMs: TASK_POLL_INTERVAL_MS,
  };
}

export function buildDetailedTask(
  run: RunSnapshot,
  events: readonly RunEventSnapshot[],
  options: DetailedTaskOptions
): DetailedTask {
  const url = runUrl(options.baseUrl, run.id);
  const status = taskStatusOf(run);
  const base = { ...taskBase(run, events), status };

  if (status === 'input_required') {
    const gate = openAnswerableGate(run);
    const key = inputRequestKey(run, events);
    if (!gate || !key) return { ...base, status: 'working' };
    if (!options.elicitation) {
      // A server must not send elicitation/create to a client that did not
      // declare elicitation. The field stays present (the tasks spec requires it
      // on input_required) but empty; the question and the UI link go into the
      // status message instead. tasks/update still accepts a known key.
      return {
        ...base,
        statusMessage: `${gate.message} Answer in the Archon UI: ${url}`,
        inputRequests: {},
      };
    }
    return {
      ...base,
      statusMessage: gate.message,
      inputRequests: {
        [key]: {
          method: 'elicitation/create',
          params: {
            mode: 'form',
            message: `${gate.message}\n\nRun: ${url}`,
            requestedSchema: APPROVAL_REQUESTED_SCHEMA,
          },
        },
      },
    };
  }

  if (status === 'working') {
    const approval = run.status === 'paused' ? approvalOf(run) : undefined;
    if (approval && approval.resolved !== null) {
      return { ...base, statusMessage: 'answer received' };
    }
    if (approval) {
      return {
        ...base,
        statusMessage: `Paused at a ${approval.type} gate that this MCP server cannot answer. See ${url}`,
      };
    }
    const node = currentNode(events);
    return node ? { ...base, statusMessage: node } : base;
  }

  if (status === 'completed') {
    const output = selectRunOutput(events, options.returnsNodeId);
    const outputRecord = asRecord(output);
    const prUrl =
      typeof outputRecord?.pr_url === 'string' && outputRecord.pr_url.length > 0
        ? outputRecord.pr_url
        : undefined;
    const outcome = outputRecord?.outcome;
    const ci = ciOf(output);
    return {
      ...base,
      result: {
        resultType: 'complete',
        content: [
          {
            type: 'text',
            text: `Workflow ${run.workflow_name} completed.${prUrl ? ` PR: ${prUrl}` : ''} Run: ${url}`,
          },
        ],
        structuredContent: {
          run_id: run.id,
          workflow: run.workflow_name,
          ...(outcome !== undefined ? { outcome } : {}),
          ...(prUrl ? { pr_url: prUrl } : {}),
          ...(ci ? { ci } : {}),
          url,
          output: output ?? null,
        },
      },
    };
  }

  if (status === 'failed') {
    const output = selectRunOutput(events, options.returnsNodeId);
    const message = runError(run) ?? `Workflow ${run.workflow_name} failed.`;
    return {
      ...base,
      statusMessage: message,
      error: {
        code: -32603,
        message,
        data: { run_id: run.id, url, ...(output !== undefined ? { output } : {}) },
      },
    };
  }

  return base;
}

/** Text form of a structured value, for tool `content`. */
export function toText(value: unknown): string {
  if (value === undefined) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}
