/**
 * Project immutable text transcript rows into complete Markdown blocks.
 * Deltas concatenate and snapshots replace, but only while the matching
 * stream/block stays the single open row — any intervening row closes it.
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

/** A block's identity for folding purposes. Two rows fold together only when
 * this string matches exactly, including for rows that carry no explicit
 * stream/message/block id — those still get a stable key from their origin
 * and execution identity alone, so an unrelated keyless family never folds
 * into this one by accident. */
function foldKey(metadata: ProjectableTextMetadata | null | undefined): string {
  const streamId = metadata?.stream_id ?? '';
  const messageId = metadata?.message_id ?? '';
  const blockId = metadata?.block_id ?? '';
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
  // Only the single most recently pushed text row can ever be extended, and
  // only while its fold key still matches. Any other row — a different
  // block, a non-text row, or a 'complete'-mode row — closes it. A later
  // delta or snapshot that reuses that same key starts a fresh row rather
  // than reopening the closed one. This keeps a reply positioned after the
  // row that produced it even when a provider reuses a block id across
  // turns, and it is what lets an interleaved family (thinking vs assistant,
  // keyed or not) keep its own row instead of absorbing another family's
  // text.
  let openRow: (T & { kind: 'text'; payload: { text: string } }) | undefined;
  let openKey: string | undefined;

  for (const message of messages) {
    if (!isTextMessage(message)) {
      openRow = undefined;
      openKey = undefined;
      projected.push(message);
      continue;
    }

    const mode = textMode(message.metadata);

    if (mode === 'complete') {
      openRow = undefined;
      openKey = undefined;
      projected.push(message);
      continue;
    }

    const key = foldKey(message.metadata);

    if (openRow !== undefined && openKey === key) {
      openRow.payload =
        mode === 'delta'
          ? { text: openRow.payload.text + message.payload.text }
          : { text: message.payload.text };
      continue;
    }

    const next = { ...message, payload: { text: message.payload.text } };
    projected.push(next);
    openRow = next;
    openKey = key;
  }

  return projected;
}
