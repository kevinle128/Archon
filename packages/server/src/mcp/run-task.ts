/**
 * Pure mapping from an Archon workflow run to the MCP shapes this server
 * exposes: the tasks-extension `DetailedTask`, the tool summary returned by
 * `get_run` / `list_runs`, and the `workflow_run.status_changed` event payload.
 *
 * Every caller (REST-backed MCP handlers and the in-process status-log writer)
 * reduces its data to `RunSnapshot` + `RunEventSnapshot[]` first, so the
 * mapping has exactly one implementation.
 */

import type {
  AskAnswerBody,
  AskHumanQuestion,
} from '@archon/workflows/schemas/pending-interaction';
import { askHumanQuestionSchema } from '@archon/workflows/schemas/pending-interaction';
import { createLogger } from '@archon/paths';

let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('mcp.run-task');
  return cachedLog;
}

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

/** One AskHuman or permission row of a run, as far as the MCP layer needs it. */
export interface InteractionSnapshot {
  tool_use_id: string;
  node_id: string;
  kind: 'ask' | 'permission';
  status: 'pending' | 'answered' | 'purged';
  envelope: Record<string, unknown>;
}

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
  /** Human-input rows of the run, oldest first. Absent = none known. */
  interactions?: readonly InteractionSnapshot[];
  /** Whether the caller started the run (permission confirm is starter-only). Absent = unknown. */
  viewer_is_starter?: boolean;
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

/**
 * Interactions a person can answer now: pending rows of a paused run. A pending
 * row on a running run is not open yet; the tool pauses the run right after the
 * insert, and the resolve route refuses until then.
 */
function openInteractions(run: RunSnapshot): InteractionSnapshot[] {
  if (run.status !== 'paused') return [];
  return (run.interactions ?? []).filter(row => row.status === 'pending');
}

export interface OpenInput {
  key: string;
  kind: 'approval' | 'ask' | 'permission';
  nodeId: string;
  interaction?: InteractionSnapshot;
}

/** Input request key of one interaction. `tool_use_id` is unique per run, so the key never repeats. */
export function interactionKey(interaction: InteractionSnapshot): string {
  return `${interaction.kind}-${interaction.tool_use_id}`;
}

/**
 * Everything the run waits on: the open approval gate first, then the open
 * interactions in creation order.
 */
export function openInputs(run: RunSnapshot, events: readonly RunEventSnapshot[]): OpenInput[] {
  const inputs: OpenInput[] = [];
  const gate = openAnswerableGate(run);
  const gateKey = inputRequestKey(run, events);
  if (gate && gateKey) inputs.push({ key: gateKey, kind: 'approval', nodeId: gate.nodeId });
  for (const interaction of openInteractions(run)) {
    inputs.push({
      key: interactionKey(interaction),
      kind: interaction.kind,
      nodeId: interaction.node_id,
      interaction,
    });
  }
  return inputs;
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
      return openAnswerableGate(run) || openInteractions(run).length > 0
        ? 'input_required'
        : 'working';
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

/** A CI wait prints its result at the top level: `conclusion` plus `checks_url`. */
function topLevelCiOf(output: unknown): CiResult | undefined {
  const record = asRecord(output);
  if (!record || typeof record.conclusion !== 'string' || !('checks_url' in record)) {
    return undefined;
  }
  return { conclusion: record.conclusion, failed: record.failed, checks_url: record.checks_url };
}

/**
 * The newest CI result in a completed node output, as a `ci` object or at the
 * top level. A run that is cancelled or fails after its CI wait still reports it.
 */
export function findCi(events: readonly RunEventSnapshot[]): CiResult | undefined {
  const completed = completedOutputs(events);
  for (let i = completed.length - 1; i >= 0; i--) {
    const output = parseNodeOutput(completed[i]?.data.node_output);
    const ci = ciOf(output) ?? topLevelCiOf(output);
    if (ci) return ci;
  }
  return undefined;
}

/**
 * CI result reported with a terminal status: the result node's `ci` for a
 * completed run, else the newest CI result of any completed node. Undefined
 * while the run is active, so CI adds no event of its own.
 */
function terminalCi(
  run: RunSnapshot,
  events: readonly RunEventSnapshot[],
  options: MappingOptions
): CiResult | undefined {
  switch (run.status) {
    case 'completed':
      return ciOf(selectRunOutput(events, options.returnsNodeId)) ?? findCi(events);
    case 'failed':
    case 'cancelled':
      return findCi(events);
    default:
      return undefined;
  }
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
  ci?: CiResult;
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
  const ci = findCi(events);
  const error = runError(run);
  return {
    run_id: run.id,
    workflow: run.workflow_name,
    status: run.status,
    task_status: taskStatusOf(run),
    current_node: currentNode(events),
    ...(gate ? { question: gate.message } : {}),
    ...(prUrl ? { pr_url: prUrl } : {}),
    ...(ci ? { ci } : {}),
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
  /** Keys of the open AskHuman and permission requests; never their content. */
  input_request_keys?: string[];
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
  const interactions = openInteractions(run);
  const node = gate?.nodeId ?? interactions[0]?.node_id ?? currentNode(events);
  const prUrl = findPrUrl(events);
  const error = runError(run);
  const ci = terminalCi(run, events, options);
  return {
    run_id: run.id,
    workflow: run.workflow_name,
    status: run.status,
    task_status: taskStatusOf(run),
    ...(node ? { node } : {}),
    ...(gate ? { question: gate.message } : {}),
    // The approval gate is already signalled by `question`; only interactions add keys.
    ...(interactions.length > 0 ? { input_request_keys: interactions.map(interactionKey) } : {}),
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

/** Elicitation form of a permission request: one free-text decision. */
export const PERMISSION_REQUESTED_SCHEMA = {
  type: 'object',
  properties: { intent: { type: 'string', title: 'Your decision', minLength: 1 } },
  required: ['intent'],
} as const;

interface FormProperty {
  type: 'string' | 'array';
  title: string;
  enum?: string[];
  minItems?: number;
  items?: { type: 'string'; enum: string[] };
}

export interface AskRequestedSchema {
  type: 'object';
  properties: Record<string, FormProperty>;
  required: string[];
}

/** The questions of an Ask row, or undefined when the stored envelope is not a valid question list. */
export function questionsOf(envelope: Record<string, unknown>): AskHumanQuestion[] | undefined {
  const raw = envelope.questions;
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const questions: AskHumanQuestion[] = [];
  for (const item of raw) {
    const parsed = askHumanQuestionSchema.safeParse(item);
    if (!parsed.success) return undefined;
    questions.push(parsed.data);
  }
  return questions;
}

const questionName = (index: number): string => `q${String(index + 1)}`;
const otherName = (index: number): string => `${questionName(index)}_other`;

/**
 * Elicitation form for a question list. The form schema allows only flat
 * primitive properties and no field mixes an enum with free text, so
 * `allowOther` becomes a second optional string property per question.
 * Property names are positional, so a question id can never collide with them.
 */
export function buildAskRequestedSchema(
  questions: readonly AskHumanQuestion[]
): AskRequestedSchema {
  const properties: Record<string, FormProperty> = {};
  const required: string[] = [];
  questions.forEach((question, index) => {
    const name = questionName(index);
    const title = question.prompt;
    if (question.options.length === 0) {
      // Free text. Without `allowOther` core accepts no value, but the person can still decline.
      properties[name] = { type: 'string', title };
      required.push(name);
      return;
    }
    properties[name] =
      question.selection === 'multi'
        ? {
            type: 'array',
            title,
            ...(question.allowOther ? {} : { minItems: 1 }),
            items: { type: 'string', enum: [...question.options] },
          }
        : { type: 'string', title, enum: [...question.options] };
    if (question.allowOther) {
      properties[otherName(index)] = { type: 'string', title: `${title} (other answer)` };
    } else {
      required.push(name);
    }
  });
  return { type: 'object', properties, required };
}

export type AskAnswerMapping = { ok: true; body: AskAnswerBody } | { ok: false; message: string };

/** Accept content of the form from `buildAskRequestedSchema` to the answer route body. */
export function askAnswerFromContent(
  questions: readonly AskHumanQuestion[],
  content: Record<string, unknown>
): AskAnswerMapping {
  const answers: { questionId: string; value: string | string[] }[] = [];
  for (const [index, question] of questions.entries()) {
    const picked = content[questionName(index)];
    const otherRaw = content[otherName(index)];
    const other = typeof otherRaw === 'string' && otherRaw.trim() !== '' ? otherRaw : undefined;
    const missing: AskAnswerMapping = {
      ok: false,
      message: `Question ${String(index + 1)} needs an answer`,
    };
    if (question.selection === 'multi') {
      const values =
        typeof picked === 'string'
          ? [picked]
          : Array.isArray(picked) && picked.every(v => typeof v === 'string')
            ? picked
            : [];
      const value = other !== undefined ? [...values, other] : values;
      if (value.length === 0) return missing;
      answers.push({ questionId: question.id, value });
    } else {
      const value = other ?? (typeof picked === 'string' ? picked : undefined);
      if (value === undefined) return missing;
      answers.push({ questionId: question.id, value });
    }
  }
  return { ok: true, body: { answers } };
}

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

function describeWaiting(inputs: readonly OpenInput[], viewerIsStarter: boolean): string {
  const parts: string[] = [];
  const asks = inputs.filter(input => input.kind === 'ask');
  if (asks.length > 0) {
    const nodes = [...new Set(asks.map(input => input.nodeId))].join(', ');
    parts.push(
      `Waiting for an answer at node ${nodes} (${String(asks.length)} question ${asks.length === 1 ? 'list' : 'lists'}).`
    );
  }
  for (const input of inputs.filter(item => item.kind === 'permission')) {
    parts.push(
      viewerIsStarter
        ? `Waiting for a permission decision at node ${input.nodeId}.`
        : `Waiting for the run starter to confirm a permission at node ${input.nodeId}.`
    );
  }
  return parts.join(' ');
}

function askRequest(interaction: InteractionSnapshot, runId: string): Record<string, unknown> {
  const questions = questionsOf(interaction.envelope);
  if (!questions) {
    // The person can still decline; the answer itself has to happen in the UI.
    getLog().warn({ runId, toolUseId: interaction.tool_use_id }, 'mcp.ask_envelope_invalid');
    return {
      method: 'elicitation/create',
      params: {
        mode: 'form',
        message: `Node ${interaction.node_id} asks a question that this client cannot show. Answer in the Archon UI.`,
        requestedSchema: { type: 'object', properties: {}, required: [] },
      },
    };
  }
  const message =
    questions.length === 1 && questions[0]
      ? questions[0].prompt
      : `Answer ${String(questions.length)} questions from node ${interaction.node_id}.`;
  return {
    method: 'elicitation/create',
    params: { mode: 'form', message, requestedSchema: buildAskRequestedSchema(questions) },
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
    const inputs = openInputs(run, events);
    if (inputs.length === 0) return { ...base, status: 'working' };
    const gate = openAnswerableGate(run);
    const gateInput = inputs.find(input => input.kind === 'approval');
    const waiting = gate ? gate.message : describeWaiting(inputs, run.viewer_is_starter === true);
    if (!options.elicitation) {
      // A server must not send elicitation/create to a client that did not
      // declare elicitation. The field stays present (the tasks spec requires it
      // on input_required) but empty; the question and the UI link go into the
      // status message instead. tasks/update still accepts a known key.
      return {
        ...base,
        statusMessage: `${waiting} Answer in the Archon UI: ${url}`,
        inputRequests: {},
      };
    }
    const inputRequests: Record<string, unknown> = {};
    if (gate && gateInput) {
      inputRequests[gateInput.key] = {
        method: 'elicitation/create',
        params: {
          mode: 'form',
          message: `${gate.message}\n\nRun: ${url}`,
          requestedSchema: APPROVAL_REQUESTED_SCHEMA,
        },
      };
    }
    for (const input of inputs) {
      if (!input.interaction) continue;
      if (input.kind === 'ask') {
        inputRequests[input.key] = askRequest(input.interaction, run.id);
      } else if (run.viewer_is_starter === true) {
        // Only the run starter can confirm a permission; the route refuses anyone else.
        inputRequests[input.key] = {
          method: 'elicitation/create',
          params: {
            mode: 'form',
            // The permission envelope has no contract and may hold sensitive data, so none of it is copied.
            message: `Node ${input.nodeId} asks for permission. Write your decision.`,
            requestedSchema: PERMISSION_REQUESTED_SCHEMA,
          },
        };
      }
    }
    return { ...base, statusMessage: waiting, inputRequests };
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
    const prUrl = findPrUrl(events);
    const ci = terminalCi(run, events, options);
    return {
      ...base,
      statusMessage: message,
      error: {
        code: -32603,
        message,
        data: {
          run_id: run.id,
          url,
          ...(prUrl ? { pr_url: prUrl } : {}),
          ...(ci ? { ci } : {}),
          ...(output !== undefined ? { output } : {}),
        },
      },
    };
  }

  if (status === 'cancelled') {
    // A cancelled task has no result; the status message still names the PR the
    // run opened and its last CI conclusion, so the client can report them.
    const prUrl = findPrUrl(events);
    const ci = terminalCi(run, events, options);
    if (!prUrl && !ci) return base;
    const conclusion = typeof ci?.conclusion === 'string' ? ci.conclusion : undefined;
    return {
      ...base,
      statusMessage:
        `Workflow ${run.workflow_name} cancelled.` +
        (prUrl ? ` PR: ${prUrl}.` : '') +
        (conclusion ? ` CI: ${conclusion}.` : '') +
        ` Run: ${url}`,
    };
  }

  return base;
}

/** Text form of a structured value, for tool `content`. */
export function toText(value: unknown): string {
  if (value === undefined) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}
