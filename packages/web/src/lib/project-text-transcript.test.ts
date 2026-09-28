import { describe, expect, test } from 'bun:test';
import { projectTextTranscript } from './project-text-transcript';

function text(
  id: string,
  body: string,
  metadata?: {
    text_mode?: 'complete' | 'delta' | 'snapshot';
    stream_id?: string;
    message_id?: string;
    block_id?: string;
    origin?: string;
    execution?: { occurrence_id?: string; attempt_id?: string };
  }
): {
  id: string;
  seq: number;
  kind: 'text';
  payload: { text: string };
  metadata?: typeof metadata;
} {
  return {
    id,
    seq: Number(id.replace('t', '')),
    kind: 'text',
    payload: { text: body },
    ...(metadata !== undefined ? { metadata } : {}),
  };
}

/** A non-text row (e.g. a tool call) — closes any open keyless delta span. */
function tool(id: string): { id: string; seq: number; kind: 'tool'; payload: unknown } {
  return { id, seq: Number(id.replace('t', '')), kind: 'tool', payload: {} };
}

describe('projectTextTranscript', () => {
  test('keeps complete messages independent', () => {
    const projected = projectTextTranscript([
      text('t1', '# One'),
      text('t2', '# Two', { text_mode: 'complete' }),
    ]);
    expect(projected.map(row => (row.kind === 'text' ? row.payload.text : ''))).toEqual([
      '# One',
      '# Two',
    ]);
  });

  test('concatenates deltas inside one stream and block', () => {
    const projected = projectTextTranscript([
      text('t1', 'Hel', { text_mode: 'delta', message_id: 'm1', block_id: 'b1' }),
      text('t2', 'lo', { text_mode: 'delta', message_id: 'm1', block_id: 'b1' }),
    ]);
    expect(projected).toHaveLength(1);
    expect(projected[0]?.kind === 'text' ? projected[0].payload.text : '').toBe('Hello');
  });

  test('does not concatenate independent streams', () => {
    const projected = projectTextTranscript([
      text('t1', 'A', { text_mode: 'delta', message_id: 'm1' }),
      text('t2', 'B', { text_mode: 'delta', message_id: 'm2' }),
    ]);
    expect(projected).toHaveLength(2);
  });

  test('replaces an adjacent snapshot of the same stream and block', () => {
    const projected = projectTextTranscript([
      text('t1', 'old', { text_mode: 'snapshot', message_id: 'm1', block_id: 'b1' }),
      text('t2', 'new', { text_mode: 'snapshot', message_id: 'm1', block_id: 'b1' }),
    ]);
    expect(projected).toHaveLength(1);
    expect(projected[0]?.kind === 'text' ? projected[0].payload.text : '').toBe('new');
  });

  test('an intervening row closes a snapshot span, so a later snapshot with the same key starts fresh', () => {
    const projected = projectTextTranscript([
      text('t1', 'old', { text_mode: 'snapshot', message_id: 'm1', block_id: 'b1' }),
      text('t2', 'keep', { text_mode: 'complete' }),
      text('t3', 'new', { text_mode: 'snapshot', message_id: 'm1', block_id: 'b1' }),
    ]);
    expect(projected.map(row => (row.kind === 'text' ? row.payload.text : ''))).toEqual([
      'old',
      'keep',
      'new',
    ]);
  });

  test('a delta that reuses an earlier block id after an intervening row starts a fresh row instead of re-merging', () => {
    // A provider that restarts its block-id counter every turn can hand back
    // the same id for an unrelated later block. The fold must not let that
    // later delta land inside the row from the earlier turn.
    const projected = projectTextTranscript([
      text('t1', 'turn-one', {
        text_mode: 'delta',
        origin: 'thinking',
        block_id: 'thinking-1',
        execution: { occurrence_id: 'occ-a', attempt_id: 'att-1' },
      }),
      tool('t2'),
      text('t3', 'operator says redirect', { text_mode: 'complete', origin: 'operator' }),
      text('t4', 'turn-two', {
        text_mode: 'delta',
        origin: 'thinking',
        block_id: 'thinking-1',
        execution: { occurrence_id: 'occ-a', attempt_id: 'att-1' },
      }),
    ]);
    expect(
      projected
        .filter(row => row.kind === 'text')
        .map(row => (row as { payload: { text: string } }).payload.text)
    ).toEqual(['turn-one', 'operator says redirect', 'turn-two']);
  });

  test('keeps identical keyed streams in different occurrences as separate blocks', () => {
    const occurrence = (id: string): { occurrence_id: string; attempt_id: string } => ({
      occurrence_id: id,
      attempt_id: 'att-1',
    });
    const projected = projectTextTranscript([
      text('t1', 'Hel', {
        text_mode: 'delta',
        message_id: 'm1',
        block_id: 'b1',
        execution: occurrence('occ-a'),
      }),
      text('t2', 'lo', {
        text_mode: 'delta',
        message_id: 'm1',
        block_id: 'b1',
        execution: occurrence('occ-a'),
      }),
      text('t3', 'Hel', {
        text_mode: 'delta',
        message_id: 'm1',
        block_id: 'b1',
        execution: occurrence('occ-b'),
      }),
      text('t4', 'lo', {
        text_mode: 'delta',
        message_id: 'm1',
        block_id: 'b1',
        execution: occurrence('occ-b'),
      }),
    ]);
    expect(projected).toHaveLength(2);
    expect(projected.map(row => (row.kind === 'text' ? row.payload.text : ''))).toEqual([
      'Hello',
      'Hello',
    ]);
  });

  test('keeps identical keyed streams in different attempts of one occurrence separate', () => {
    const projected = projectTextTranscript([
      text('t1', 'Hel', {
        text_mode: 'delta',
        message_id: 'm1',
        block_id: 'b1',
        execution: { occurrence_id: 'occ-a', attempt_id: 'att-1' },
      }),
      text('t2', 'lo', {
        text_mode: 'delta',
        message_id: 'm1',
        block_id: 'b1',
        execution: { occurrence_id: 'occ-a', attempt_id: 'att-2' },
      }),
    ]);
    expect(projected).toHaveLength(2);
    expect(projected.map(row => (row.kind === 'text' ? row.payload.text : ''))).toEqual([
      'Hel',
      'lo',
    ]);
  });

  test('merges anonymous deltas only while execution identity is unchanged', () => {
    const projected = projectTextTranscript([
      text('t1', 'a', {
        text_mode: 'delta',
        execution: { occurrence_id: 'occ-a', attempt_id: 'att-1' },
      }),
      text('t2', 'b', {
        text_mode: 'delta',
        execution: { occurrence_id: 'occ-a', attempt_id: 'att-1' },
      }),
      text('t3', 'x', {
        text_mode: 'delta',
        execution: { occurrence_id: 'occ-b', attempt_id: 'att-1' },
      }),
      text('t4', 'y', {
        text_mode: 'delta',
        execution: { occurrence_id: 'occ-b', attempt_id: 'att-1' },
      }),
      text('t5', 'z', { text_mode: 'delta' }),
    ]);
    expect(projected.map(row => (row.kind === 'text' ? row.payload.text : ''))).toEqual([
      'ab',
      'xy',
      'z',
    ]);
  });

  test('preserves historical behavior for a metadata-less sequence', () => {
    const projected = projectTextTranscript([
      text('t1', 'a', { text_mode: 'delta' }),
      text('t2', 'b', { text_mode: 'delta' }),
      text('t3', 'c', { text_mode: 'delta', message_id: 'm1' }),
      text('t4', 'd', { text_mode: 'delta', message_id: 'm1' }),
      text('t5', 'e', { text_mode: 'delta' }),
    ]);
    expect(projected.map(row => (row.kind === 'text' ? row.payload.text : ''))).toEqual([
      'ab',
      'cd',
      'e',
    ]);
  });

  test('folds consecutive keyless thinking deltas into one row, not one per delta', () => {
    const projected = projectTextTranscript([
      text('t1', 'Pond', { text_mode: 'delta', origin: 'thinking' }),
      text('t2', 'ering', { text_mode: 'delta', origin: 'thinking' }),
      text('t3', ' more', { text_mode: 'delta', origin: 'thinking' }),
    ]);
    expect(projected).toHaveLength(1);
    expect(projected[0]?.kind === 'text' ? projected[0].payload.text : '').toBe('Pondering more');
  });

  test('a keyless thinking delta never absorbs an interleaved keyless assistant delta', () => {
    const projected = projectTextTranscript([
      text('t1', 'thinking-1', { text_mode: 'delta', origin: 'thinking' }),
      text('t2', 'assistant-1', { text_mode: 'delta' }),
      text('t3', 'thinking-2', { text_mode: 'delta', origin: 'thinking' }),
      text('t4', 'assistant-2', { text_mode: 'delta' }),
    ]);
    // Each family keeps its own open span: the assistant deltas never land
    // inside the thinking row and vice versa, even though neither carries an
    // explicit stream/block id.
    expect(projected.map(row => (row.kind === 'text' ? row.payload.text : ''))).toEqual([
      'thinking-1',
      'assistant-1',
      'thinking-2',
      'assistant-2',
    ]);
  });

  test('a tool call between two keyless thinking spans starts a fresh span', () => {
    const projected = projectTextTranscript([
      text('t1', 'thinking-1a', { text_mode: 'delta', origin: 'thinking' }),
      text('t2', 'thinking-1b', { text_mode: 'delta', origin: 'thinking' }),
      tool('t3'),
      text('t4', 'thinking-2', { text_mode: 'delta', origin: 'thinking' }),
    ]);
    expect(
      projected
        .filter(row => row.kind === 'text')
        .map(row => (row as { payload: { text: string } }).payload.text)
    ).toEqual(['thinking-1athinking-1b', 'thinking-2']);
  });

  test('an explicit block id still separates families that happen to share it', () => {
    const projected = projectTextTranscript([
      text('t1', 'thinking-text', {
        text_mode: 'delta',
        origin: 'thinking',
        block_id: 'b0',
      }),
      text('t2', 'assistant-text', { text_mode: 'delta', block_id: 'b0' }),
    ]);
    expect(projected.map(row => (row.kind === 'text' ? row.payload.text : ''))).toEqual([
      'thinking-text',
      'assistant-text',
    ]);
  });

  test('does not mutate input rows or the input array', () => {
    const rows = [
      text('t1', 'Hel', { text_mode: 'delta', message_id: 'm1', block_id: 'b1' }),
      text('t2', 'lo', { text_mode: 'delta', message_id: 'm1', block_id: 'b1' }),
      text('t3', 'x', { text_mode: 'delta' }),
      text('t4', 'y', { text_mode: 'delta' }),
    ];
    const projected = projectTextTranscript(rows);
    expect(rows).toHaveLength(4);
    expect(rows.map(row => row.payload.text)).toEqual(['Hel', 'lo', 'x', 'y']);
    expect(projected).toHaveLength(2);
    expect(projected[0]?.kind === 'text' ? projected[0].payload.text : '').toBe('Hello');
  });
});
