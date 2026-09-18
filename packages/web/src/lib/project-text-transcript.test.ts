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

  test('replaces snapshots only inside the matching stream', () => {
    const projected = projectTextTranscript([
      text('t1', 'old', { text_mode: 'snapshot', message_id: 'm1', block_id: 'b1' }),
      text('t2', 'keep', { text_mode: 'complete' }),
      text('t3', 'new', { text_mode: 'snapshot', message_id: 'm1', block_id: 'b1' }),
    ]);
    expect(projected.map(row => (row.kind === 'text' ? row.payload.text : ''))).toEqual([
      'new',
      'keep',
    ]);
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
