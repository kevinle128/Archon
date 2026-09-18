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

export function projectToolTranscript<T extends PairableMessage>(
  messages: readonly T[]
): ProjectedTranscriptItem<T>[] {
  const consumed = new Set<string>();
  const resultByKey = new Map<string, TTool[]>();
  for (const message of messages) {
    if (!isToolMessage(message) || !isToolResult(message)) continue;
    const key = toolCorrelationKey(message);
    const bucket = resultByKey.get(key);
    if (bucket === undefined) {
      resultByKey.set(key, [message]);
    } else {
      bucket.push(message);
    }
  }

  const projected: ProjectedTranscriptItem<T>[] = [];
  for (const message of messages) {
    if (!isToolMessage(message)) {
      projected.push({ kind: 'message', message });
      continue;
    }
    if (consumed.has(message.id)) continue;

    if (isToolResult(message)) {
      projected.push(toCard(null, message));
      continue;
    }

    const key = toolCorrelationKey(message);
    const bucket = resultByKey.get(key);
    const result = bucket?.shift();
    if (result !== undefined) consumed.add(result.id);
    projected.push(toCard(message, result ?? null));
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
