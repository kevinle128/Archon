/**
 * Project immutable text transcript rows into complete Markdown blocks.
 * Deltas concatenate and snapshots replace only inside one matching stream/block.
 * Independent complete messages never concatenate.
 */

export interface ProjectableTextMetadata {
  stream_id?: string;
  message_id?: string;
  block_id?: string;
  text_mode?: 'complete' | 'delta' | 'snapshot';
  /** Which row family this text belongs to (assistant, thinking, operator,
   * prompt, advisor). Always part of the fold key: a delta/snapshot from one
   * family must never absorb another's text, even when both happen to share
   * a stream/block id or neither carries one. Missing on an older assistant
   * row, which is the implicit default family. */
  origin?: string;
  execution?: {
    occurrence_id?: string;
    attempt_id?: string;
  };
}

export interface ProjectableTextMessage {
  id: string;
  seq: number;
  kind: string;
  payload: unknown;
  metadata?: ProjectableTextMetadata | null;
}

function isTextMessage<T extends ProjectableTextMessage>(
  message: T
): message is T & { kind: 'text'; payload: { text: string } } {
  if (message.kind !== 'text') return false;
  const payload = message.payload;
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'text' in payload &&
    typeof (payload as { text: unknown }).text === 'string'
  );
}

/** Missing `origin` is the implicit assistant family — the only one that
 * predates this field, so this default reproduces every pre-existing row's
 * grouping unchanged. */
function originKey(metadata: ProjectableTextMetadata | null | undefined): string {
  return metadata?.origin ?? 'assistant';
}

function streamKey(metadata: ProjectableTextMetadata | null | undefined): string {
  const streamId = metadata?.stream_id ?? '';
  const messageId = metadata?.message_id ?? '';
  const blockId = metadata?.block_id ?? '';
  if (streamId.length === 0 && messageId.length === 0 && blockId.length === 0) {
    return '';
  }
  return `${originKey(metadata)}\0${streamId}\0${messageId}\0${blockId}\0${executionIdentity(metadata)}`;
}

function executionIdentity(metadata: ProjectableTextMetadata | null | undefined): string {
  const occurrence = metadata?.execution?.occurrence_id ?? '';
  const attempt = metadata?.execution?.attempt_id ?? '';
  return `${occurrence}\0${attempt}`;
}

function textMode(
  metadata: ProjectableTextMetadata | null | undefined
): 'complete' | 'delta' | 'snapshot' {
  return metadata?.text_mode ?? 'complete';
}

export function projectTextTranscript<T extends ProjectableTextMessage>(
  messages: readonly T[]
): T[] {
  const projected: T[] = [];
  const openByKey = new Map<string, T & { kind: 'text'; payload: { text: string } }>();
  // Keyless (no stream/message/block id) deltas fold by adjacency instead of
  // a proven id: at most one open span at a time, so a thinking delta can
  // never absorb an assistant delta or vice versa even when both are
  // keyless — a delta of a different family (or the same family in a
  // different execution) closes the previous span rather than reopening it,
  // which also keeps rows in the order they actually happened instead of
  // reordering an interleaved family's text to wherever its span first
  // opened. Any other interruption — a non-text row, or a 'complete'-mode
  // row — closes it too.
  let anonymousDelta: (T & { kind: 'text'; payload: { text: string } }) | undefined;
  let anonymousKey: string | undefined;

  for (const message of messages) {
    if (!isTextMessage(message)) {
      anonymousDelta = undefined;
      projected.push(message);
      continue;
    }

    const mode = textMode(message.metadata);
    const key = streamKey(message.metadata);

    if (mode === 'complete') {
      anonymousDelta = undefined;
      projected.push(message);
      continue;
    }

    if (mode === 'delta') {
      if (key.length === 0) {
        const nextAnonymousKey = `${originKey(message.metadata)}\0${executionIdentity(message.metadata)}`;
        if (anonymousDelta === undefined || anonymousKey !== nextAnonymousKey) {
          anonymousDelta = { ...message, payload: { text: message.payload.text } };
          anonymousKey = nextAnonymousKey;
          projected.push(anonymousDelta);
        } else {
          anonymousDelta.payload = { text: anonymousDelta.payload.text + message.payload.text };
        }
        continue;
      }
      anonymousDelta = undefined;
      const open = openByKey.get(key);
      if (open === undefined) {
        const next = { ...message, payload: { text: message.payload.text } };
        openByKey.set(key, next);
        projected.push(next);
      } else {
        open.payload = { text: open.payload.text + message.payload.text };
      }
      continue;
    }

    anonymousDelta = undefined;
    if (key.length === 0) {
      projected.push(message);
      continue;
    }
    const open = openByKey.get(key);
    if (open === undefined) {
      const next = { ...message, payload: { text: message.payload.text } };
      openByKey.set(key, next);
      projected.push(next);
    } else {
      open.payload = { text: message.payload.text };
    }
  }

  return projected;
}
