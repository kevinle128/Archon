/**
 * Project recorded node-message rows and workflow events into render-neutral
 * agent history items. Text and tool pairing stay in the existing projectors;
 * this module maps those results onto assistant, operator, tool, and lifecycle items.
 */
import type { components } from './api.generated';
import { ensureUtc } from './format';
import type { NodeMessageRow } from './node-message-pages';
import type { ToolTranscriptCard } from './pair-tool-transcript';
import { projectToolTranscript } from './pair-tool-transcript';
import { projectTextTranscript } from './project-text-transcript';
import type { SteeringQueueItemState } from './steering-dock';
import { projectTodoState, type TodoPhase } from './todo-state';
import { toolRowPresentation, type ToolRowPresentation } from './tool-presentation';

/** The delivery states an operator transcript row's badge distinguishes; every other wire state renders as `sent`, the safe default with no evidence yet. */
export type OperatorDeliveryState = 'sent' | 'delivered' | 'delivery_unknown';

export interface AgentHistoryInput {
  rows: readonly NodeMessageRow[];
  events: readonly components['schemas']['WorkflowEvent'][];
  nodeId: string;
  nowMs: number;
  /** Matched definition node's `output_format`; absent or ineligible schemas leave text untouched. */
  outputFormat?: Record<string, unknown>;
  /**
   * The selected execution has already reached a terminal lifecycle status
   * (or a restart left it durable with no live process). A finished
   * execution can never write a late `tool_completed` for a call still
   * showing `running`, so that call settles to `unknown` here — the same
   * verdict `settledToolOutcome` already gives an ambiguous interrupt —
   * rather than the presenter claiming a process is still active. Default
   * false.
   */
  nodeTerminal?: boolean;
  /**
   * Every message id's last-observed delivery state from the durable
   * steering queue read, joined onto each operator row by its stamped
   * `message_id`. Undefined (no queue snapshot observed) or an id absent
   * from the map both render `sent` — never inferred from the row's text or
   * age, only from this proven evidence.
   */
  deliveryStateByMessageId?: ReadonlyMap<string, SteeringQueueItemState>;
}

/** Typed execution scope carried on wire rows; `null` on pre-scope history. */
export type TranscriptExecution = NonNullable<NonNullable<NodeMessageRow['metadata']>['execution']>;

export type AgentHistoryItem =
  | {
      kind: 'assistant';
      id: string;
      seq: number;
      role: 'assistant';
      text: string;
      structuredFields?: { name: string; value: string }[];
      execution: TranscriptExecution | null;
    }
  | {
      kind: 'operator';
      id: string;
      seq: number;
      role: 'operator';
      text: string;
      operatorUserId: string | null;
      operatorDisplayName: string | null;
      messageId: string | null;
      delivery: OperatorDeliveryState;
      execution: TranscriptExecution | null;
    }
  | {
      kind: 'thinking';
      id: string;
      seq: number;
      role: 'thinking';
      text: string;
      execution: TranscriptExecution | null;
    }
  | {
      kind: 'prompt';
      id: string;
      seq: number;
      role: 'prompt';
      text: string;
      actorUserId: string | null;
      /** Display name resolved server-side from `actorUserId`; null when there is no actor. */
      actorDisplayName: string | null;
      source: 'node_prompt' | 'command_file' | 'reask';
      execution: TranscriptExecution | null;
    }
  | {
      kind: 'advisor';
      id: string;
      seq: number;
      role: 'advisor';
      text: string;
      advisorModel: string | null;
      execution: TranscriptExecution | null;
    }
  | {
      kind: 'tool';
      id: string;
      seq: number;
      role: 'tool';
      name: string;
      toolUseId: string;
      input: unknown;
      output: unknown;
      outcome: 'running' | 'succeeded' | 'failed' | 'interrupted' | 'unknown';
      exitCode: number | null;
      durationMs: number | null;
      canLoadFullOutput: boolean;
      outputState: 'full' | 'truncated' | 'missing' | 'unknown';
      presentation: ToolRowPresentation;
      messageId: string;
      execution: TranscriptExecution | null;
    }
  | {
      kind: 'lifecycle';
      id: string;
      seq: number;
      state: string;
      detail: string | null;
      execution: TranscriptExecution | null;
    };

export interface AgentHistory {
  items: AgentHistoryItem[];
  todos: TodoPhase[];
}

/**
 * Shared label text for a `prompt` item's label line, read by both node room
 * shells. Never a raw id fragment: `actorDisplayName` is resolved
 * server-side (a real display name, or the neutral `unknown user` fallback
 * — never the id itself) from the same user lookup the operator label
 * already uses; the local fallback here only covers older data that
 * predates the field.
 */
export function promptActorLabel(
  actorUserId: string | null,
  actorDisplayName: string | null
): string {
  if (actorUserId === null) return 'run';
  const trimmed = actorDisplayName?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : 'unknown user';
}

const PROMPT_SOURCE_LABEL: Record<Extract<AgentHistoryItem, { kind: 'prompt' }>['source'], string> =
  {
    node_prompt: 'prompt',
    command_file: 'command',
    reask: 'retry',
  };

/**
 * Shared label text for a `prompt` item's source, read by both node room
 * shells, or null for `node_prompt` — the row's own `prompt ·` label already
 * says that, so the source segment would repeat the word for no added
 * information. `command_file` and `reask` still carry it (`command`/`retry`).
 */
export function promptSourceLabel(
  source: Extract<AgentHistoryItem, { kind: 'prompt' }>['source']
): string | null {
  return source === 'node_prompt' ? null : PROMPT_SOURCE_LABEL[source];
}

export interface OperatorDeliveryPresentation {
  readonly label: string;
  readonly tone: 'neutral' | 'success' | 'warning';
}

const OPERATOR_DELIVERY_PRESENTATION: Readonly<
  Record<OperatorDeliveryState, OperatorDeliveryPresentation>
> = {
  sent: { label: 'sent', tone: 'neutral' },
  delivered: { label: 'delivered', tone: 'success' },
  delivery_unknown: { label: 'delivery unknown', tone: 'warning' },
};

/**
 * Shared label and tone for an operator row's delivery badge, read by both
 * node room shells. The word alone carries the state (per the approved
 * mockup); `tone` is added on top, never instead — a renderer with no color
 * token for `tone` can still show the correct word.
 */
export function operatorDeliveryPresentation(
  delivery: OperatorDeliveryState
): OperatorDeliveryPresentation {
  return OPERATOR_DELIVERY_PRESENTATION[delivery];
}

/**
 * The proven delivery state for one operator row, by its stamped message
 * id. `delivered` and `delivery_unknown` are the only wire states this row
 * distinguishes; every other state (including a missing id, or no queue
 * snapshot observed yet) renders `sent` — the safe default with no evidence
 * yet, never inferred from the row's text or age.
 */
function resolveOperatorDelivery(
  messageId: string | null,
  deliveryStateByMessageId: ReadonlyMap<string, SteeringQueueItemState> | undefined
): OperatorDeliveryState {
  if (messageId === null || deliveryStateByMessageId === undefined) return 'sent';
  const state = deliveryStateByMessageId.get(messageId);
  return state === 'delivered' || state === 'delivery_unknown' ? state : 'sent';
}

type ToolOutcome = Extract<AgentHistoryItem, { kind: 'tool' }>['outcome'];
type ToolCard = ToolTranscriptCard<NodeMessageRow>;
type ToolRow = Extract<NodeMessageRow, { kind: 'tool' }>;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

/**
 * The declared property key when `outputFormat` is exactly an object schema with
 * one `type: 'string'` property; null for every other shape. Annotations and
 * constraints on the property do not disqualify it.
 */
function singleStringSchemaKey(outputFormat: Record<string, unknown> | undefined): string | null {
  const schema = asRecord(outputFormat);
  if (schema?.type !== 'object') return null;
  const properties = asRecord(schema.properties);
  if (properties === null) return null;
  const keys = Object.keys(properties);
  const key = keys[0];
  if (keys.length !== 1 || key === undefined) return null;
  const property = asRecord(properties[key]);
  if (property?.type !== 'string') return null;
  return key;
}

/**
 * The envelope's string value when `text` is the canonical serialization of the
 * declared one-key object; otherwise the input text unchanged. Any ambiguity —
 * malformed, extra or missing keys, non-string value, non-canonical bytes —
 * fails closed so audit text survives byte-for-byte.
 */
function presentedText(schemaKey: string | null, text: string): string {
  if (schemaKey === null) return text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text;
  }
  const record = asRecord(parsed);
  if (record === null) return text;
  const keys = Object.keys(record);
  if (keys.length !== 1 || keys[0] !== schemaKey) return text;
  const value = record[schemaKey];
  if (typeof value !== 'string') return text;
  if (text !== JSON.stringify(parsed)) return text;
  return value;
}

/** Keep the original text for audit while presenting canonical multi-field results as fields. */
function structuredFields(
  outputFormat: Record<string, unknown> | undefined,
  text: string
): { name: string; value: string }[] | undefined {
  if (outputFormat?.type !== 'object') return undefined;
  const properties = asRecord(outputFormat.properties);
  if (properties === null || Object.keys(properties).length < 2) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const record = asRecord(parsed);
  if (record === null || text !== JSON.stringify(parsed)) return undefined;
  const keys = Object.keys(record);
  if (
    keys.length !== Object.keys(properties).length ||
    keys.some(key => !Object.hasOwn(properties, key))
  ) {
    return undefined;
  }
  return keys.map(name => ({
    name,
    value: typeof record[name] === 'string' ? record[name] : JSON.stringify(record[name]),
  }));
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

function recordedExitCode(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function recordedDurationMs(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

function fullOutputAvailable(metadata: unknown): boolean {
  return asRecord(metadata)?.full_output_available === true;
}

function recordedOutputState(
  metadata: unknown
): 'full' | 'truncated' | 'missing' | 'unknown' | null {
  const state = asRecord(metadata)?.output_state;
  if (state === 'full' || state === 'truncated' || state === 'missing' || state === 'unknown') {
    return state;
  }
  return null;
}

function deriveOutputState(card: ToolCard): 'full' | 'truncated' | 'missing' | 'unknown' {
  const recorded =
    recordedOutputState(card.result?.metadata) ?? recordedOutputState(card.call?.metadata);
  if (recorded !== null) return recorded;
  if (fullOutputAvailable(card.result?.metadata) || fullOutputAvailable(card.call?.metadata)) {
    return 'truncated';
  }
  if (card.result === null || card.output === undefined || card.output === null) return 'missing';
  return 'full';
}

function extraToolFields(row: ToolRow | null): {
  outcome: string | null;
  exitCode: number | null;
  error: unknown;
} {
  const record = asRecord(row?.metadata);
  if (record === null) {
    return { outcome: null, exitCode: null, error: undefined };
  }
  return {
    outcome: stringField(record, 'outcome'),
    exitCode: recordedExitCode(record.exit_code),
    error: record.error,
  };
}

/** Result metadata wins over call metadata, then the paired card — extracted once per card. */
function toolExitCode(card: ToolCard): number | null {
  return (
    extraToolFields(card.result).exitCode ??
    extraToolFields(card.call).exitCode ??
    recordedExitCode(card.exitCode) ??
    null
  );
}

function deriveOutcome(card: ToolCard, exitCode: number | null): ToolOutcome {
  if (card.pending) return 'running';

  const resultFields = extraToolFields(card.result);
  const callFields = extraToolFields(card.call);
  const recordedOutcome = resultFields.outcome ?? callFields.outcome ?? card.outcome ?? null;
  const error = resultFields.error ?? callFields.error;

  if (exitCode !== null && exitCode !== 0) return 'failed';
  if (recordedOutcome === 'error' || recordedOutcome === 'failed') return 'failed';
  if (typeof error === 'string' && error.length > 0) return 'failed';
  if (recordedOutcome === 'success') return 'succeeded';
  if (recordedOutcome === 'interrupted') return 'interrupted';
  if (card.call === null || recordedOutcome === 'unknown') return 'unknown';
  return 'succeeded';
}

function toolUseIdFrom(card: ToolCard): string {
  const row = card.call ?? card.result;
  if (row !== null && typeof row.payload.id === 'string' && row.payload.id.length > 0) {
    return row.payload.id;
  }
  return card.id;
}

function toToolItem(
  card: ToolCard,
  events: readonly components['schemas']['WorkflowEvent'][],
  nodeId: string,
  nowMs: number,
  outcomeOverride?: ToolOutcome
): Extract<AgentHistoryItem, { kind: 'tool' }> {
  const toolUseId = toolUseIdFrom(card);
  const exitCode = toolExitCode(card);
  const outcome = outcomeOverride ?? deriveOutcome(card, exitCode);
  const durationMs = toolRuntime(events, nodeId, toolUseId).durationMs;
  const outputState = deriveOutputState(card);
  const runningElapsedMs =
    outcome === 'running' ? runningElapsed(events, nodeId, toolUseId, nowMs) : null;
  return {
    kind: 'tool',
    id: card.id,
    seq: card.call?.seq ?? card.result?.seq ?? 0,
    role: 'tool',
    name: card.name,
    toolUseId,
    input: card.input,
    output: card.output,
    outcome,
    exitCode,
    durationMs,
    canLoadFullOutput:
      fullOutputAvailable(card.call?.metadata) || fullOutputAvailable(card.result?.metadata),
    outputState,
    presentation: toolRowPresentation(
      { name: card.name, input: card.input, output: card.output },
      { outcome, exitCode, durationMs, outputState, runningElapsedMs }
    ),
    messageId: card.result?.id ?? card.call?.id ?? card.id,
    execution: card.call?.metadata?.execution ?? card.result?.metadata?.execution ?? null,
  };
}

/** Exactly one matching `tool_called` start, or null — missing, ambiguous, and unparseable starts yield no elapsed badge. */
function toolStartedAtMs(
  events: readonly components['schemas']['WorkflowEvent'][],
  nodeId: string,
  toolUseId: string
): number | null {
  const matches: string[] = [];
  for (const workflowEvent of events) {
    if (workflowEvent.event_type !== 'tool_called') continue;
    if (workflowEvent.step_name !== nodeId) continue;
    const data = asRecord(workflowEvent.data);
    if (data === null) continue;
    if (data.tool_call_id !== toolUseId) continue;
    matches.push(workflowEvent.created_at);
  }
  if (matches.length !== 1) return null;
  const startedAt = new Date(ensureUtc(matches[0] ?? '')).getTime();
  return Number.isFinite(startedAt) ? startedAt : null;
}

function runningElapsed(
  events: readonly components['schemas']['WorkflowEvent'][],
  nodeId: string,
  toolUseId: string,
  nowMs: number
): number | null {
  const startedAt = toolStartedAtMs(events, nodeId, toolUseId);
  if (startedAt === null) return null;
  return Math.max(0, nowMs - startedAt);
}

/**
 * The outcome the executor actually settled a still-open tool call with, read
 * from its matching `tool_completed` event's `tool_outcome` field. A provider
 * that cannot tie an interrupt marker to a specific tool call settles that
 * field `'unknown'` rather than `'interrupted'` — this lets the fold below
 * respect that distinction without knowing which provider produced it.
 * Ambiguous data (no match, or more than one) defaults to `'interrupted'`,
 * matching every row recorded before this distinction existed.
 */
function settledToolOutcome(
  events: readonly components['schemas']['WorkflowEvent'][],
  nodeId: string,
  toolUseId: string
): 'interrupted' | 'unknown' {
  const matches: unknown[] = [];
  for (const workflowEvent of events) {
    if (workflowEvent.event_type !== 'tool_completed') continue;
    if (workflowEvent.step_name !== nodeId) continue;
    const data = asRecord(workflowEvent.data);
    if (data === null) continue;
    if (data.tool_call_id !== toolUseId) continue;
    matches.push(data.tool_outcome);
  }
  return matches.length === 1 && matches[0] === 'unknown' ? 'unknown' : 'interrupted';
}

export function toolRuntime(
  events: readonly components['schemas']['WorkflowEvent'][],
  nodeId: string,
  toolUseId: string
): { durationMs: number | null } {
  const matches: number[] = [];
  for (const workflowEvent of events) {
    if (workflowEvent.event_type !== 'tool_completed') continue;
    if (workflowEvent.step_name !== nodeId) continue;
    const data = asRecord(workflowEvent.data);
    if (data === null) continue;
    if (data.tool_call_id !== toolUseId) continue;
    const durationMs = recordedDurationMs(data.duration_ms);
    if (durationMs === null) continue;
    matches.push(durationMs);
  }
  if (matches.length !== 1) {
    return { durationMs: null };
  }
  return { durationMs: matches[0] ?? null };
}

export function buildAgentHistory(input: AgentHistoryInput): AgentHistory {
  const projected = projectToolTranscript(projectTextTranscript(input.rows));
  const envelopeKey = singleStringSchemaKey(input.outputFormat);
  const items: AgentHistoryItem[] = [];
  for (let index = 0; index < projected.length; index++) {
    const item = projected[index];
    if (item === undefined) continue;
    if (item.kind === 'tool-card') {
      const next = projected[index + 1];
      const interrupted =
        next?.kind === 'message' &&
        next.message.kind === 'status' &&
        next.message.payload.state === 'interrupted';
      const settledOutcome = interrupted
        ? settledToolOutcome(input.events, input.nodeId, toolUseIdFrom(item))
        : item.pending && input.nodeTerminal === true
          ? 'unknown'
          : undefined;
      items.push(toToolItem(item, input.events, input.nodeId, input.nowMs, settledOutcome));
      // Consume the status row only when it proved the interrupted outcome —
      // that reads as this row's own glyph. Otherwise the row still recorded
      // that Stop landed here and stays visible as its own lifecycle item,
      // since an 'unknown' tool glyph does not carry that fact on its own.
      if (settledOutcome === 'interrupted') index++;
      continue;
    }
    const message = item.message;
    if (message.kind === 'text' && message.metadata?.origin === 'operator') {
      const operatorUserId = message.metadata.operator_user_id ?? null;
      const responseName = message.operator_display_name;
      const trimmedResponseName = typeof responseName === 'string' ? responseName.trim() : '';
      const operatorDisplayName =
        trimmedResponseName.length > 0
          ? trimmedResponseName
          : operatorUserId !== null
            ? operatorUserId.slice(0, 8)
            : null;
      const messageId = message.metadata.message_id ?? null;
      items.push({
        kind: 'operator',
        id: message.id,
        seq: message.seq,
        role: 'operator',
        text: message.payload.text,
        operatorUserId,
        operatorDisplayName,
        messageId,
        delivery: resolveOperatorDelivery(messageId, input.deliveryStateByMessageId),
        execution: message.metadata.execution ?? null,
      });
      continue;
    }
    if (message.kind === 'text' && message.metadata?.origin === 'thinking') {
      items.push({
        kind: 'thinking',
        id: message.id,
        seq: message.seq,
        role: 'thinking',
        text: message.payload.text,
        execution: message.metadata.execution ?? null,
      });
      continue;
    }
    if (message.kind === 'text' && message.metadata?.origin === 'prompt') {
      items.push({
        kind: 'prompt',
        id: message.id,
        seq: message.seq,
        role: 'prompt',
        text: message.payload.text,
        actorUserId: message.metadata.actor_user_id ?? null,
        actorDisplayName: message.prompt_display_name ?? null,
        source: message.metadata.prompt_source ?? 'node_prompt',
        execution: message.metadata.execution ?? null,
      });
      continue;
    }
    if (message.kind === 'text' && message.metadata?.origin === 'advisor') {
      items.push({
        kind: 'advisor',
        id: message.id,
        seq: message.seq,
        role: 'advisor',
        text: message.payload.text,
        advisorModel: message.metadata.advisor_model ?? null,
        execution: message.metadata.execution ?? null,
      });
      continue;
    }
    if (message.kind === 'text' && message.metadata?.origin !== undefined) {
      // A `text` row whose origin is none of the recognized values (older
      // client reading a newer row, or a corrupt write) must never render as
      // the agent's own words — it becomes a visible but neutral lifecycle
      // notice instead of silently turning into assistant prose.
      items.push({
        kind: 'lifecycle',
        id: message.id,
        seq: message.seq,
        state: 'unrecognized-origin',
        detail: null,
        execution: message.metadata.execution ?? null,
      });
      continue;
    }
    if (message.kind === 'text') {
      const fields = structuredFields(input.outputFormat, message.payload.text);
      items.push({
        kind: 'assistant',
        id: message.id,
        seq: message.seq,
        role: 'assistant',
        text: presentedText(envelopeKey, message.payload.text),
        ...(fields === undefined ? {} : { structuredFields: fields }),
        execution: message.metadata?.execution ?? null,
      });
      continue;
    }
    if (message.kind === 'status') {
      items.push({
        kind: 'lifecycle',
        id: message.id,
        seq: message.seq,
        state: message.payload.state,
        detail: message.payload.detail ?? null,
        execution: message.metadata?.execution ?? null,
      });
    }
  }
  // Fold recorded inputs of todo-family tools in projected seq order; the
  // projection above may keep arrival order when rows arrive unsorted.
  const todoInputs = items
    .filter(
      (item): item is Extract<AgentHistoryItem, { kind: 'tool' }> =>
        item.kind === 'tool' && item.presentation.family === 'todo'
    )
    .sort((left, right) => left.seq - right.seq)
    .map(item => item.input);
  return { items, todos: projectTodoState(todoInputs) };
}
