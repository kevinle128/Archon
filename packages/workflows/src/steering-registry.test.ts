import { describe, expect, test } from 'bun:test';

import {
  createSteeringRegistry,
  getSteeringRegistry,
  type QueuedOperatorMessage,
} from './steering-registry';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let seq = 0;
function msg(id?: string, text = `guidance-${seq}`): QueuedOperatorMessage {
  seq += 1;
  return {
    messageId: id ?? `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    message: text,
    operatorUserId: 'user-1',
    receivedAt: `2026-09-19T01:00:${String(seq % 60).padStart(2, '0')}.000Z`,
  };
}

// ---------------------------------------------------------------------------
// Registry construction
// ---------------------------------------------------------------------------

describe('registry construction', () => {
  test('getSteeringRegistry returns the same process singleton', () => {
    const singleton = getSteeringRegistry();
    try {
      expect(getSteeringRegistry()).toBe(singleton);
    } finally {
      singleton.clearForTests();
    }
  });

  test('createSteeringRegistry returns isolated instances', () => {
    const a = createSteeringRegistry();
    const b = createSteeringRegistry();
    expect(a).not.toBe(b);
    a.register('run-1', 'node-1');
    expect(b.get('run-1', 'node-1')).toBeUndefined();
  });

  test('singleton state does not leak into isolated instances', () => {
    const singleton = getSteeringRegistry();
    try {
      singleton.register('run-1', 'node-1');
      const isolated = createSteeringRegistry();
      expect(isolated.get('run-1', 'node-1')).toBeUndefined();
    } finally {
      singleton.clearForTests();
    }
  });

  test('clearForTests empties the singleton and seals held handles', () => {
    const singleton = getSteeringRegistry();
    const handle = singleton.register('run-1', 'node-1');
    handle.enqueue(msg('m-1'));
    singleton.clearForTests();
    expect(singleton.get('run-1', 'node-1')).toBeUndefined();
    const result = handle.enqueue(msg('m-2'));
    expect(result).toEqual({ ok: false, reason: 'closed' });
    expect(handle.drain()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// register / get / unregister
// ---------------------------------------------------------------------------

describe('register/get/unregister', () => {
  test('register creates a live handle retrievable via get', () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1');
    expect(handle.snapshot().phase).toBe('live');
    expect(registry.get('run-1', 'node-1')).toBe(handle);
    expect(registry.get('run-1', 'node-2')).toBeUndefined();
    expect(registry.get('run-2', 'node-1')).toBeUndefined();
  });

  test('register on a live handle returns the same handle', () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1');
    handle.enqueue(msg('m-1'));
    expect(registry.register('run-1', 'node-1')).toBe(handle);
    expect(handle.pendingCount()).toBe(1);
  });

  test('register resumes a parked handle with its queue intact', () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1');
    handle.enqueue(msg('m-1'));
    handle.park();
    const resumed = registry.register('run-1', 'node-1');
    expect(resumed).toBe(handle);
    expect(resumed.snapshot().phase).toBe('live');
    expect(resumed.pendingCount()).toBe(1);
  });

  test('register replaces a closed handle for a genuinely new execution', () => {
    const registry = createSteeringRegistry();
    const first = registry.register('run-1', 'node-1');
    first.enqueue(msg('m-1'));
    first.close();
    const second = registry.register('run-1', 'node-1');
    expect(second).not.toBe(first);
    expect(second.snapshot().phase).toBe('live');
    expect(second.pendingCount()).toBe(0);
    // Fresh idempotency scope: the id accepted by the closed handle is new here.
    const again = second.enqueue(msg('m-1'));
    expect(again).toEqual({
      ok: true,
      duplicate: false,
      receipt: { messageId: 'm-1', state: 'queued' },
    });
    // The replaced handle stays closed and undisturbed.
    expect(first.snapshot().phase).toBe('closed');
    expect(first.snapshot().queued).toHaveLength(1);
  });

  test('unregister removes the handle so register starts fresh', () => {
    const registry = createSteeringRegistry();
    const first = registry.register('run-1', 'node-1');
    first.enqueue(msg('m-1'));
    registry.unregister('run-1', 'node-1');
    expect(registry.get('run-1', 'node-1')).toBeUndefined();
    const second = registry.register('run-1', 'node-1');
    expect(second).not.toBe(first);
    expect(second.enqueue(msg('m-1')).duplicate).toBe(false);
  });

  test('unregister is a no-op for unknown keys', () => {
    const registry = createSteeringRegistry();
    registry.unregister('run-1', 'node-1');
    registry.register('run-1', 'node-1');
    registry.unregister('run-1', 'node-2');
    expect(registry.get('run-1', 'node-1')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// enqueue ordering and receipts
// ---------------------------------------------------------------------------

describe('enqueue', () => {
  test('live appends in receipt order with caller-supplied ISO receipt time', () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1');
    const first = msg('m-1', 'first');
    const second = msg('m-2', 'second');
    expect(handle.enqueue(first)).toEqual({
      ok: true,
      duplicate: false,
      receipt: { messageId: 'm-1', state: 'queued' },
    });
    expect(handle.enqueue(second)).toEqual({
      ok: true,
      duplicate: false,
      receipt: { messageId: 'm-2', state: 'queued' },
    });
    expect(handle.snapshot().queued).toEqual([first, second]);
    expect(handle.snapshot().queued[0]?.receivedAt).toBe(first.receivedAt);
    expect(handle.pendingCount()).toBe(2);
    expect(handle.snapshot().acceptedCount).toBe(2);
  });

  test('receipt carries no message content', () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1');
    const result = handle.enqueue(msg('m-1', 'secret prose'));
    expect(result).toEqual({
      ok: true,
      duplicate: false,
      receipt: { messageId: 'm-1', state: 'queued' },
    });
  });

  test('parked handle refuses new ids with not_live', () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1');
    handle.park();
    expect(handle.enqueue(msg('m-1'))).toEqual({ ok: false, reason: 'not_live' });
    expect(handle.pendingCount()).toBe(0);
  });

  test('closed handle refuses new ids with closed', () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1');
    handle.close();
    expect(handle.enqueue(msg('m-1'))).toEqual({ ok: false, reason: 'closed' });
  });
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

describe('idempotency', () => {
  test('duplicate id before drain returns the original receipt and adds no item', () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1');
    handle.enqueue(msg('m-1', 'original'));
    const dup = handle.enqueue(msg('m-1', 'original'));
    expect(dup).toEqual({
      ok: true,
      duplicate: true,
      receipt: { messageId: 'm-1', state: 'queued' },
    });
    expect(handle.pendingCount()).toBe(1);
    expect(handle.snapshot().acceptedCount).toBe(1);
  });

  test('duplicate id after drain still returns the original receipt', () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1');
    handle.enqueue(msg('m-1', 'original'));
    expect(handle.drain()).toHaveLength(1);
    const dup = handle.enqueue(msg('m-1', 'original'));
    expect(dup).toEqual({
      ok: true,
      duplicate: true,
      receipt: { messageId: 'm-1', state: 'queued' },
    });
    expect(handle.pendingCount()).toBe(0);
    expect(handle.snapshot().acceptedCount).toBe(1);
  });

  test('duplicate id while parked returns the original receipt before phase logic', () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1');
    handle.enqueue(msg('m-1'));
    handle.park();
    const dup = handle.enqueue(msg('m-1'));
    expect(dup).toEqual({
      ok: true,
      duplicate: true,
      receipt: { messageId: 'm-1', state: 'queued' },
    });
    // A new id on the same parked handle is still refused.
    expect(handle.enqueue(msg('m-2'))).toEqual({ ok: false, reason: 'not_live' });
  });

  test('duplicate id while closed returns the original receipt before phase logic', () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1');
    handle.enqueue(msg('m-1'));
    handle.close();
    expect(handle.enqueue(msg('m-1'))).toEqual({
      ok: true,
      duplicate: true,
      receipt: { messageId: 'm-1', state: 'queued' },
    });
    expect(handle.enqueue(msg('m-2'))).toEqual({ ok: false, reason: 'closed' });
  });

  test('duplicate id with different prose keeps the original and adds no item', () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1');
    handle.enqueue(msg('m-1', 'original prose'));
    const dup = handle.enqueue(msg('m-1', 'different prose'));
    expect(dup).toEqual({
      ok: true,
      duplicate: true,
      receipt: { messageId: 'm-1', state: 'queued' },
    });
    expect(handle.pendingCount()).toBe(1);
    expect(handle.snapshot().queued[0]?.message).toBe('original prose');
  });

  test('more than 500 accepted ids still leaves the first id idempotent', () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1');
    const firstId = 'm-first';
    handle.enqueue(msg(firstId));
    for (let i = 0; i < 600; i++) {
      handle.enqueue(msg(`m-${i}`));
    }
    expect(handle.snapshot().acceptedCount).toBe(601);
    const dup = handle.enqueue(msg(firstId));
    expect(dup).toEqual({
      ok: true,
      duplicate: true,
      receipt: { messageId: firstId, state: 'queued' },
    });
    expect(handle.pendingCount()).toBe(601);
  });
});

// ---------------------------------------------------------------------------
// closeIfEmpty / drain / park / resume / close
// ---------------------------------------------------------------------------

describe('closeIfEmpty', () => {
  test('closes an empty live handle synchronously and returns true', () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1');
    expect(handle.closeIfEmpty()).toBe(true);
    expect(handle.snapshot().phase).toBe('closed');
    expect(handle.enqueue(msg('m-1'))).toEqual({ ok: false, reason: 'closed' });
  });

  test('returns false without mutation when items exist', () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1');
    handle.enqueue(msg('m-1'));
    expect(handle.closeIfEmpty()).toBe(false);
    expect(handle.snapshot().phase).toBe('live');
    expect(handle.pendingCount()).toBe(1);
  });

  test('returns false on a parked handle even when empty', () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1');
    handle.park();
    expect(handle.closeIfEmpty()).toBe(false);
    expect(handle.snapshot().phase).toBe('parked');
  });

  test('seals before a racing enqueue - no receipt succeeds after the gate', () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1');
    expect(handle.closeIfEmpty()).toBe(true);
    expect(handle.enqueue(msg('m-1'))).toEqual({ ok: false, reason: 'closed' });
  });
});

describe('drain', () => {
  test('drain atomically returns pending items without closing the handle', () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1');
    const a = msg('m-1', 'a');
    const b = msg('m-2', 'b');
    handle.enqueue(a);
    handle.enqueue(b);
    const items = handle.drain();
    expect(items).toEqual([a, b]);
    expect(handle.pendingCount()).toBe(0);
    expect(handle.snapshot().phase).toBe('live');
    // Accepted-id memory survives drain.
    expect(handle.enqueue(msg('m-1'))).toEqual({
      ok: true,
      duplicate: true,
      receipt: { messageId: 'm-1', state: 'queued' },
    });
    // And new ids still append after a drain.
    expect(handle.enqueue(msg('m-3'))).toEqual({
      ok: true,
      duplicate: false,
      receipt: { messageId: 'm-3', state: 'queued' },
    });
  });

  test('drain on an empty handle returns no items and keeps the phase', () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1');
    expect(handle.drain()).toEqual([]);
    expect(handle.snapshot().phase).toBe('live');
  });
});

describe('withdraw', () => {
  test('removing B from pending A/B/C leaves A/C in order, phase live, pendingCount decremented', () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1');
    const a = msg('m-1', 'a');
    const b = msg('m-2', 'b');
    const c = msg('m-3', 'c');
    handle.enqueue(a);
    handle.enqueue(b);
    handle.enqueue(c);

    expect(handle.withdraw('m-2')).toBe(true);
    const snap = handle.snapshot();
    expect(snap.queued).toEqual([a, c]);
    expect(snap.phase).toBe('live');
    expect(snap.acceptedCount).toBe(3);
    expect(handle.pendingCount()).toBe(2);
  });

  test('never-seen and already-drained ids return false without changing the snapshot', () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1');
    handle.enqueue(msg('m-1'));
    handle.enqueue(msg('m-2'));
    handle.drain();
    const before = handle.snapshot();

    expect(handle.withdraw('m-1')).toBe(false);
    expect(handle.withdraw('m-never-seen')).toBe(false);
    const after = handle.snapshot();
    expect(after.phase).toBe(before.phase);
    expect(after.queued).toEqual(before.queued);
    expect(after.acceptedCount).toBe(before.acceptedCount);
  });

  test('repeating a successful withdraw returns false and is mutation-free', () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1');
    handle.enqueue(msg('m-1'));
    handle.enqueue(msg('m-2'));

    expect(handle.withdraw('m-1')).toBe(true);
    const before = handle.snapshot();
    expect(handle.withdraw('m-1')).toBe(false);
    const after = handle.snapshot();
    expect(after.phase).toBe(before.phase);
    expect(after.queued).toEqual(before.queued);
    expect(after.acceptedCount).toBe(before.acceptedCount);
  });

  test('replaying enqueue(A) after withdraw returns the original duplicate receipt without requeueing', () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1');
    handle.enqueue(msg('m-1', 'original'));
    expect(handle.withdraw('m-1')).toBe(true);
    expect(handle.pendingCount()).toBe(0);

    const dup = handle.enqueue(msg('m-1', 'original'));
    expect(dup).toEqual({
      ok: true,
      duplicate: true,
      receipt: { messageId: 'm-1', state: 'queued' },
    });
    expect(handle.pendingCount()).toBe(0);
    expect(handle.snapshot().acceptedCount).toBe(1);
  });

  test('a parked handle removes A while remaining parked; resume drains only the retained siblings', () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1');
    const a = msg('m-1', 'a');
    const b = msg('m-2', 'b');
    const c = msg('m-3', 'c');
    handle.enqueue(a);
    handle.enqueue(b);
    handle.enqueue(c);
    handle.park();

    expect(handle.withdraw('m-1')).toBe(true);
    expect(handle.snapshot().phase).toBe('parked');
    expect(handle.snapshot().queued).toEqual([b, c]);

    handle.resume();
    expect(handle.drain()).toEqual([b, c]);
    expect(handle.snapshot().phase).toBe('live');
  });

  test('a closed handle containing A returns false and keeps the full snapshot unchanged', () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1');
    handle.enqueue(msg('m-1'));
    handle.enqueue(msg('m-2'));
    handle.close();
    const before = handle.snapshot();

    expect(handle.withdraw('m-1')).toBe(false);
    const after = handle.snapshot();
    expect(after.phase).toBe('closed');
    expect(after.queued).toEqual(before.queued);
    expect(after.acceptedCount).toBe(before.acceptedCount);
  });

  test('removing the last live item does not close the handle - only closeIfEmpty seals', () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1');
    handle.enqueue(msg('m-1'));

    expect(handle.withdraw('m-1')).toBe(true);
    expect(handle.snapshot().phase).toBe('live');
    expect(handle.pendingCount()).toBe(0);
    // The executor's last gate still owns the seal, and it still applies.
    expect(handle.closeIfEmpty()).toBe(true);
    expect(handle.snapshot().phase).toBe('closed');
  });

  test('a later drain cannot return a previously withdrawn item', () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1');
    const a = msg('m-1', 'a');
    const b = msg('m-2', 'b');
    handle.enqueue(a);
    handle.enqueue(b);

    expect(handle.withdraw('m-1')).toBe(true);
    expect(handle.drain()).toEqual([b]);
    expect(handle.drain()).toEqual([]);
  });
});

describe('park/resume/close', () => {
  test('park retains queued items and blocks enqueue; resume re-lives the same handle', () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1');
    handle.enqueue(msg('m-1'));
    handle.park();
    expect(handle.snapshot().phase).toBe('parked');
    expect(handle.pendingCount()).toBe(1);
    expect(handle.enqueue(msg('m-2'))).toEqual({ ok: false, reason: 'not_live' });
    handle.resume();
    expect(handle.snapshot().phase).toBe('live');
    expect(handle.enqueue(msg('m-2'))).toEqual({
      ok: true,
      duplicate: false,
      receipt: { messageId: 'm-2', state: 'queued' },
    });
    expect(handle.snapshot().queued).toHaveLength(2);
  });

  test('park on a closed handle does not resurrect it', () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1');
    handle.close();
    handle.park();
    expect(handle.snapshot().phase).toBe('closed');
  });

  test('resume on a closed handle does not resurrect it', () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1');
    handle.close();
    handle.resume();
    expect(handle.snapshot().phase).toBe('closed');
    expect(handle.enqueue(msg('m-1'))).toEqual({ ok: false, reason: 'closed' });
  });

  test('close refuses later enqueues but retains items for counting', () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1');
    handle.enqueue(msg('m-1'));
    handle.enqueue(msg('m-2'));
    handle.close();
    expect(handle.enqueue(msg('m-3'))).toEqual({ ok: false, reason: 'closed' });
    const snap = handle.snapshot();
    expect(snap.phase).toBe('closed');
    expect(snap.queued).toHaveLength(2);
    expect(snap.acceptedCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// discardRun
// ---------------------------------------------------------------------------

describe('discardRun', () => {
  test('closes, clears, and removes every handle for only the named run', () => {
    const registry = createSteeringRegistry();
    const h1 = registry.register('run-1', 'node-1');
    const h2 = registry.register('run-1', 'node-2');
    const other = registry.register('run-2', 'node-1');
    h1.enqueue(msg('m-1'));
    h1.enqueue(msg('m-2'));
    h2.enqueue(msg('m-3'));
    h2.park();
    other.enqueue(msg('m-4'));

    const counts = registry.discardRun('run-1');
    expect(counts).toEqual({ handles: 2, queued: 3 });
    expect(registry.get('run-1', 'node-1')).toBeUndefined();
    expect(registry.get('run-1', 'node-2')).toBeUndefined();

    // Held references are closed and emptied - they cannot drain or accept.
    expect(h1.snapshot().phase).toBe('closed');
    expect(h1.snapshot().queued).toEqual([]);
    expect(h1.drain()).toEqual([]);
    expect(h1.enqueue(msg('m-9'))).toEqual({ ok: false, reason: 'closed' });
    // Accepted-id memory is cleared too: a replayed id is refused, not replayed.
    expect(h1.enqueue(msg('m-1'))).toEqual({ ok: false, reason: 'closed' });
    expect(h2.snapshot().phase).toBe('closed');

    // Other runs are untouched.
    expect(registry.get('run-2', 'node-1')).toBe(other);
    expect(other.snapshot().phase).toBe('live');
    expect(other.pendingCount()).toBe(1);
    expect(other.enqueue(msg('m-5'))).toEqual({
      ok: true,
      duplicate: false,
      receipt: { messageId: 'm-5', state: 'queued' },
    });
  });

  test('discardRun on an unknown run returns zero counts', () => {
    const registry = createSteeringRegistry();
    registry.register('run-1', 'node-1');
    expect(registry.discardRun('run-2')).toEqual({ handles: 0, queued: 0 });
    expect(registry.get('run-1', 'node-1')).toBeDefined();
  });

  test('a handle re-registered after discardRun starts a fresh execution', () => {
    const registry = createSteeringRegistry();
    const first = registry.register('run-1', 'node-1');
    first.enqueue(msg('m-1'));
    registry.discardRun('run-1');
    const second = registry.register('run-1', 'node-1');
    expect(second).not.toBe(first);
    expect(second.snapshot().phase).toBe('live');
    expect(second.enqueue(msg('m-1'))).toEqual({
      ok: true,
      duplicate: false,
      receipt: { messageId: 'm-1', state: 'queued' },
    });
  });
});
