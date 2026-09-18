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

function streamKey(metadata: ProjectableTextMetadata | null | undefined): string {
  const streamId = metadata?.stream_id ?? '';
  const messageId = metadata?.message_id ?? '';
  const blockId = metadata?.block_id ?? '';
  if (streamId.length === 0 && messageId.length === 0 && blockId.length === 0) {
    return '';
  }
  return `${streamId}\0${messageId}\0${blockId}\0${executionIdentity(metadata)}`;
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
  let anonymousDelta: (T & { kind: 'text'; payload: { text: string } }) | undefined;
  let anonymousIdentity: string | undefined;

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
        const identity = executionIdentity(message.metadata);
        if (anonymousDelta === undefined || anonymousIdentity !== identity) {
          anonymousDelta = { ...message, payload: { text: message.payload.text } };
          anonymousIdentity = identity;
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
