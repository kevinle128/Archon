import { describe, expect, test } from 'bun:test';

import type {
  NodeMessageLoader,
  NodeMessagePage,
  NodeMessageRow,
  NodeMessageState,
} from './node-message-pages';
import {
  beginNodeMessageRefresh,
  createNodeMessageState,
  drainNodeMessages,
  nodeMessageScopeKey,
  reduceNodeMessageFailure,
  reduceNodeMessagePage,
} from './node-message-pages';

function message(seq: number): NodeMessageRow {
  return {
    id: `message-${String(seq)}`,
    seq,
    kind: 'text',
    payload: { text: `text-${String(seq)}` },
    created_at: '2026-09-08T00:00:00.000Z',
  };
}

function page(seq: number): NodeMessagePage {
  return {
    messages: [message(seq)],
    hasMore: false,
    highWatermark: seq,
    nextCursor: String(seq),
  };
}

function abortError(): Error {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

describe('nodeMessageScopeKey', () => {
  test('includes rowId in unscoped node fallback keys so historical rows stay isolated', () => {
    const first = nodeMessageScopeKey('run-1', 'review', { kind: 'node', rowId: 'row-a' });
    const second = nodeMessageScopeKey('run-1', 'review', { kind: 'node', rowId: 'row-b' });
    expect(first).toContain('run-1');
    expect(first).toContain('review');
    expect(first).toContain('row-a');
    expect(second).toContain('row-b');
    expect(first).not.toBe(second);
  });

  test('includes occurrence and attempt in scoped keys', () => {
    const withAttempt = nodeMessageScopeKey('run-1', 'review', {
      kind: 'occurrence',
      occurrenceId: 'occ-1',
      attemptId: 'att-1',
    });
    const withoutAttempt = nodeMessageScopeKey('run-1', 'review', {
      kind: 'occurrence',
      occurrenceId: 'occ-1',
    });
    expect(withAttempt).toContain('occ-1');
    expect(withAttempt).toContain('att-1');
    expect(withoutAttempt).not.toBe(withAttempt);
  });
});
describe('beginNodeMessageRefresh', () => {
  test('keeps loaded rows and cursor while capturing a fresh snapshot boundary', () => {
    const loaded: NodeMessageState = {
      scopeKey: 'scope-a',
      rows: [message(1), message(2)],
      afterSeq: 2,
      highWatermark: 2,
      complete: true,
      loading: false,
      error: null,
    };

    expect(beginNodeMessageRefresh(loaded)).toEqual({
      ...loaded,
      highWatermark: null,
      complete: false,
    });
  });
});

describe('reduceNodeMessagePage', () => {
  test('sorts by seq and keeps one row for duplicate seq values', () => {
    const state = reduceNodeMessagePage(createNodeMessageState('scope-a'), 'scope-a', {
      messages: [message(2), message(1), message(2)],
      hasMore: false,
      highWatermark: 2,
      nextCursor: '2',
    });
    expect(state.rows.map(row => row.seq)).toEqual([1, 2]);
  });

  test('is complete only after hasMore is false and the scoped watermark is reached', () => {
    const first = reduceNodeMessagePage(createNodeMessageState('scope-a'), 'scope-a', {
      messages: [message(1)],
      hasMore: false,
      highWatermark: 3,
      nextCursor: '1',
    });
    expect(first.complete).toBe(false);
    const second = reduceNodeMessagePage(first, 'scope-a', {
      messages: [message(2), message(3)],
      hasMore: false,
      highWatermark: 3,
      nextCursor: '3',
    });
    expect(second.complete).toBe(true);
  });

  test('keeps the first watermark stable when newer rows arrive during a drain', () => {
    const first = reduceNodeMessagePage(createNodeMessageState('scope-a'), 'scope-a', {
      messages: [message(1)],
      hasMore: false,
      highWatermark: 2,
      nextCursor: '1',
    });
    expect(first.complete).toBe(false);
    const second = reduceNodeMessagePage(first, 'scope-a', {
      messages: [message(2)],
      hasMore: true,
      highWatermark: 3,
      nextCursor: '2',
    });
    expect(second.highWatermark).toBe(2);
    expect(second.complete).toBe(true);
    expect(second.rows.map(row => row.seq)).toEqual([1, 2]);
  });

  test('ignores a page and a failure from an obsolete scope', () => {
    const current = createNodeMessageState('scope-b');
    expect(reduceNodeMessagePage(current, 'scope-a', page(1))).toBe(current);
    expect(reduceNodeMessageFailure(current, 'scope-a', new Error('late'))).toBe(current);
  });

  test('retains loaded rows and exposes retry after a later-page failure', () => {
    const loaded = reduceNodeMessagePage(createNodeMessageState('scope-a'), 'scope-a', page(1));
    const failed = reduceNodeMessageFailure(loaded, 'scope-a', new Error('network'));
    expect(failed.rows.map(row => row.seq)).toEqual([1]);
    expect(failed.error).toBe('network');
    expect(failed.complete).toBe(false);
  });

  test('completes the compatibility shape when paging keys are absent', () => {
    const state = reduceNodeMessagePage(createNodeMessageState('scope-a'), 'scope-a', {
      messages: [message(4), message(1)],
    });
    expect(state.rows.map(row => row.seq)).toEqual([1, 4]);
    expect(state.afterSeq).toBe(4);
    expect(state.complete).toBe(true);
  });

  test('treats an empty nonterminal page with no cursor progress as an error', () => {
    const loaded = reduceNodeMessagePage(createNodeMessageState('scope-a'), 'scope-a', {
      messages: [message(1)],
      hasMore: true,
      highWatermark: 4,
      nextCursor: '1',
    });
    const stalled = reduceNodeMessagePage(loaded, 'scope-a', {
      messages: [],
      hasMore: true,
      highWatermark: 4,
      nextCursor: '1',
    });
    expect(stalled.rows.map(row => row.seq)).toEqual([1]);
    expect(stalled.complete).toBe(false);
    expect(stalled.error).not.toBeNull();
  });
});

describe('drainNodeMessages', () => {
  test('requests limit 100 one page at a time, scoped to occurrence only', async () => {
    const calls: Array<{
      afterSeq: number;
      limit: number;
      occurrenceId?: string;
      attemptId?: string;
    }> = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const loader: NodeMessageLoader = async (_runId, _nodeId, options) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      calls.push({
        afterSeq: options.afterSeq,
        limit: options.limit,
        occurrenceId: options.occurrenceId,
        attemptId: options.attemptId,
      });
      await Promise.resolve();
      inFlight -= 1;
      if (options.afterSeq === 0) {
        return {
          messages: [message(1)],
          hasMore: true,
          highWatermark: 2,
          nextCursor: '1',
        };
      }
      return {
        messages: [message(2)],
        hasMore: false,
        highWatermark: 2,
        nextCursor: '2',
      };
    };
    const states: NodeMessageState[] = [];
    // attemptId travels on the selection (e.g. from a projected execution's
    // current attempt) but must never reach the loader — CAP-6 scopes the
    // fetch to the occurrence, so a guidance turn's rows under a different
    // attempt are never filtered out of the page.
    const result = await drainNodeMessages({
      runId: 'run-1',
      nodeId: 'review',
      selection: { kind: 'occurrence', occurrenceId: 'occ-1', attemptId: 'att-1' },
      loader,
      onState(next: NodeMessageState): void {
        states.push(next);
      },
    });
    expect(maxInFlight).toBe(1);
    expect(calls).toEqual([
      { afterSeq: 0, limit: 100, occurrenceId: 'occ-1', attemptId: undefined },
      { afterSeq: 1, limit: 100, occurrenceId: 'occ-1', attemptId: undefined },
    ]);
    expect(result.complete).toBe(true);
    expect(result.rows.map(row => row.seq)).toEqual([1, 2]);
    expect(states.length).toBeGreaterThan(0);
    expect(states.at(-1)?.complete).toBe(true);
  });

  test('stops when the first page reaches its watermark despite a stale hasMore flag', async () => {
    const afterSeqs: number[] = [];
    const loader: NodeMessageLoader = async (_runId, _nodeId, options) => {
      afterSeqs.push(options.afterSeq);
      expect(options.limit).toBe(100);
      if (options.afterSeq === 0) {
        return {
          messages: [message(1), message(2)],
          hasMore: true,
          highWatermark: 2,
          nextCursor: '2',
        };
      }
      return {
        messages: [],
        hasMore: false,
        highWatermark: 2,
        nextCursor: '2',
      };
    };
    const result = await drainNodeMessages({
      runId: 'run-1',
      nodeId: 'review',
      selection: { kind: 'node', rowId: 'row-1' },
      loader,
      onState(): void {},
    });
    expect(afterSeqs).toEqual([0]);
    expect(result.complete).toBe(true);
    expect(result.rows.map(row => row.seq)).toEqual([1, 2]);
    expect(result.error).toBeNull();
  });

  test('stops at the first watermark while a live transcript keeps growing', async () => {
    const afterSeqs: number[] = [];
    const loader: NodeMessageLoader = async (_runId, _nodeId, options) => {
      afterSeqs.push(options.afterSeq);
      if (options.afterSeq === 0) {
        return {
          messages: [message(1)],
          hasMore: false,
          highWatermark: 2,
          nextCursor: '1',
        };
      }
      if (options.afterSeq === 1) {
        return {
          messages: [message(2)],
          hasMore: true,
          highWatermark: 3,
          nextCursor: '2',
        };
      }
      throw new Error('drain chased messages beyond its first watermark');
    };
    const result = await drainNodeMessages({
      runId: 'run-1',
      nodeId: 'review',
      selection: { kind: 'node', rowId: 'row-1' },
      loader,
      onState(): void {},
    });
    expect(afterSeqs).toEqual([0, 1]);
    expect(result.highWatermark).toBe(2);
    expect(result.complete).toBe(true);
    expect(result.rows.map(row => row.seq)).toEqual([1, 2]);
  });

  test('halts on abort without converting AbortError to retry error', async () => {
    const controller = new AbortController();
    const loader: NodeMessageLoader = async (_runId, _nodeId, options) => {
      return await new Promise((_resolve, reject) => {
        const fail = (): void => {
          reject(abortError());
        };
        if (options.signal?.aborted === true) {
          fail();
          return;
        }
        options.signal?.addEventListener('abort', fail, { once: true });
      });
    };
    const states: NodeMessageState[] = [];
    const drain = drainNodeMessages({
      runId: 'run-1',
      nodeId: 'review',
      selection: { kind: 'node', rowId: 'row-1' },
      loader,
      signal: controller.signal,
      onState(next: NodeMessageState): void {
        states.push(next);
      },
    });
    await Promise.resolve();
    controller.abort();
    const result = await drain;
    expect(result.complete).toBe(false);
    expect(result.error).toBeNull();
    expect(states.every(entry => entry.error === null)).toBe(true);
  });

  test('resumes from retained afterSeq after a later-page failure', async () => {
    let round = 0;
    const afterSeqs: number[] = [];
    const loader: NodeMessageLoader = async (_runId, _nodeId, options) => {
      round += 1;
      afterSeqs.push(options.afterSeq);
      if (round === 1) {
        return {
          messages: [message(1)],
          hasMore: true,
          highWatermark: 3,
          nextCursor: '1',
        };
      }
      if (round === 2) {
        throw new Error('network');
      }
      return {
        messages: [message(2), message(3)],
        hasMore: false,
        highWatermark: 3,
        nextCursor: '3',
      };
    };
    const first = await drainNodeMessages({
      runId: 'run-1',
      nodeId: 'review',
      selection: { kind: 'occurrence', occurrenceId: 'occ-1', attemptId: 'att-1' },
      loader,
      onState(): void {},
    });
    expect(first.error).toBe('network');
    expect(first.complete).toBe(false);
    expect(first.rows.map(row => row.seq)).toEqual([1]);
    const second = await drainNodeMessages({
      runId: 'run-1',
      nodeId: 'review',
      selection: { kind: 'occurrence', occurrenceId: 'occ-1', attemptId: 'att-1' },
      loader,
      state: first,
      onState(): void {},
    });
    expect(afterSeqs).toEqual([0, 1, 1]);
    expect(second.complete).toBe(true);
    expect(second.error).toBeNull();
    expect(second.rows.map(row => row.seq)).toEqual([1, 2, 3]);
  });

  test('does not pass occurrence fields for unscoped node selections', async () => {
    const loader: NodeMessageLoader = async (_runId, _nodeId, options) => {
      expect(options.occurrenceId).toBeUndefined();
      expect(options.attemptId).toBeUndefined();
      expect(options.limit).toBe(100);
      return {
        messages: [message(1)],
        hasMore: false,
        highWatermark: 1,
        nextCursor: '1',
      };
    };
    const result = await drainNodeMessages({
      runId: 'run-1',
      nodeId: 'review',
      selection: { kind: 'node', rowId: 'row-1' },
      loader,
      onState(): void {},
    });
    expect(result.complete).toBe(true);
  });
});
