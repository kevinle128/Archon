/**
 * Pair immutable tool call/result transcript rows into one presentation card.
 * Correlation uses tool-use id plus occurrence/attempt when metadata is present.
 * A result without a matching call stays a standalone result card.
 */

export interface PairableToolPayload {
  name: string;
  id: string;
  input?: unknown;
  output?: unknown;
}

export interface PairableToolMetadata {
  execution?: {
    occurrence_id?: string;
    attempt_id?: string;
  };
  tool_phase?: 'call' | 'result';
  outcome?: 'success' | 'error' | 'interrupted' | 'unknown';
  exit_code?: number;
  truncated?: boolean;
  output_state?: 'full' | 'truncated' | 'missing' | 'unknown';
  full_output_available?: boolean;
}

export interface PairableMessage {
  id: string;
  seq: number;
  kind: string;
  payload: unknown;
  metadata?: PairableToolMetadata | null;
}

export interface ToolTranscriptCard<T extends PairableMessage> {
  kind: 'tool-card';
  id: string;
  name: string;
  input: unknown;
  output: unknown;
  pending: boolean;
  outcome?: PairableToolMetadata['outcome'];
  exitCode?: number;
  truncated?: boolean;
  outputState?: PairableToolMetadata['output_state'];
  call: Extract<T, { kind: 'tool' }> | null;
  result: Extract<T, { kind: 'tool' }> | null;
  messages: Extract<T, { kind: 'tool' }>[];
}

export type ProjectedTranscriptItem<T extends PairableMessage> =
  | { kind: 'message'; message: T }
  | ToolTranscriptCard<T>;

type TTool = PairableMessage & { kind: 'tool'; payload: PairableToolPayload };

function isToolMessage<T extends PairableMessage>(
  message: T
): message is T & { kind: 'tool'; payload: PairableToolPayload } {
  return message.kind === 'tool';
}

function toolCorrelationKey(message: TTool): string {
  const occurrence = message.metadata?.execution?.occurrence_id ?? '';
  const attempt = message.metadata?.execution?.attempt_id ?? '';
  return `${message.payload.id}\0${occurrence}\0${attempt}`;
}

function isToolResult(message: TTool): boolean {
  if (message.metadata?.tool_phase === 'result') return true;
  if (message.metadata?.tool_phase === 'call') return false;
  return message.payload.output !== undefined;
}

/**
 * Map each call row to the result that actually belongs to it, tolerating a
 * tool-use id reused across turns of the same node execution (a provider
 * that restarts its own id numbering on a Stop + redirect, e.g. Codex's
 * `item_1` per `thread.runStreamed()` call — the same class of collision the
 * text-block ids solved with a per-turn nonce). At most one call is "open"
 * per correlation key at a time: a result closes the currently open call for
 * its key, and a later call under the SAME key supersedes whatever call was
 * still open there — that older call never received its own result (most
 * commonly because the turn that started it was cut off), so it renders
 * permanently pending instead of stealing a different call's outcome. This
 * also repairs rows already persisted by a build that emitted colliding ids:
 * no id uniqueness is assumed, only that a call and its true result are
 * adjacent in sequence order relative to any other call sharing its key.
 */
function pairCallsToResults(messages: readonly PairableMessage[]): Map<string, TTool> {
  const openCallByKey = new Map<string, TTool>();
  const resultForCallId = new Map<string, TTool>();
  for (const message of messages) {
    if (!isToolMessage(message)) continue;
    const key = toolCorrelationKey(message);
    if (isToolResult(message)) {
      const openCall = openCallByKey.get(key);
      if (openCall !== undefined) {
        resultForCallId.set(openCall.id, message);
        openCallByKey.delete(key);
      }
      continue;
    }
    openCallByKey.set(key, message);
  }
  return resultForCallId;
}

export function projectToolTranscript<T extends PairableMessage>(
  messages: readonly T[]
): ProjectedTranscriptItem<T>[] {
  const resultForCallId = pairCallsToResults(messages);
  const consumed = new Set<string>();
  const projected: ProjectedTranscriptItem<T>[] = [];
  for (const message of messages) {
    if (!isToolMessage(message)) {
      projected.push({ kind: 'message', message });
      continue;
    }
    if (consumed.has(message.id)) continue;

    if (isToolResult(message)) {
      // Reached only for a result no open call claimed above — a genuinely
      // standalone result row.
      projected.push(toCard(null, message));
      continue;
    }

    const result = resultForCallId.get(message.id) ?? null;
    if (result !== null) consumed.add(result.id);
    projected.push(toCard(message, result));
  }
  return projected;
}

function toCard<T extends PairableMessage>(
  call: TTool | null,
  result: TTool | null
): ToolTranscriptCard<T> {
  const primary = call ?? result;
  if (primary === null) {
    throw new Error('tool card requires a call or result row');
  }
  const messages = [call, result].filter((row): row is TTool => row !== null);
  const resultMeta = result?.metadata;
  return {
    kind: 'tool-card',
    id: primary.id,
    name: primary.payload.name,
    input: call?.payload.input ?? result?.payload.input,
    output: result?.payload.output ?? call?.payload.output,
    pending: result === null && call?.payload.output === undefined,
    ...(resultMeta?.outcome !== undefined ? { outcome: resultMeta.outcome } : {}),
    ...(resultMeta?.exit_code !== undefined ? { exitCode: resultMeta.exit_code } : {}),
    ...(resultMeta?.truncated !== undefined ? { truncated: resultMeta.truncated } : {}),
    ...(resultMeta?.output_state !== undefined ? { outputState: resultMeta.output_state } : {}),
    call: call as Extract<T, { kind: 'tool' }> | null,
    result: result as Extract<T, { kind: 'tool' }> | null,
    messages: messages as Extract<T, { kind: 'tool' }>[],
  };
}
