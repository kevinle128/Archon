/**
 * Project recorded node-message rows and workflow events into render-neutral
 * agent history items. Text and tool pairing stay in the existing projectors;
 * this module only maps those results onto assistant, tool, and lifecycle items.
 */
import type { components } from './api.generated';
import { ensureUtc } from './format';
import type { NodeMessageRow } from './node-message-pages';
import type { ToolTranscriptCard } from './pair-tool-transcript';
import { projectToolTranscript } from './pair-tool-transcript';
import { projectTextTranscript } from './project-text-transcript';
import { projectTodoState, type TodoPhase } from './todo-state';
import { toolRowPresentation, type ToolRowPresentation } from './tool-presentation';

export interface AgentHistoryInput {
  rows: readonly NodeMessageRow[];
  events: readonly components['schemas']['WorkflowEvent'][];
  nodeId: string;
  nowMs: number;
  /** Matched definition node's `output_format`; absent or ineligible schemas leave text untouched. */
  outputFormat?: Record<string, unknown>;
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
      items.push(
        toToolItem(
          item,
          input.events,
          input.nodeId,
          input.nowMs,
          interrupted ? 'interrupted' : undefined
        )
      );
      if (interrupted) index++;
      continue;
    }
    const message = item.message;
    if (message.kind === 'text') {
      items.push({
        kind: 'assistant',
        id: message.id,
        seq: message.seq,
        role: 'assistant',
        text: presentedText(envelopeKey, message.payload.text),
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
