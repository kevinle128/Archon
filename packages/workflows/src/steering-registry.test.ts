import { describe, expect, mock, spyOn, test } from 'bun:test';

import {
  createSteeringRegistry,
  getSteeringRegistry,
  resolveIdleAwaitInactivityMs,
  scheduleIdleExpiryWithTimeout,
  STEERING_IDLE_AWAIT_INACTIVITY_MS,
  type NodeSteeringHandle,
  type QueuedOperatorMessage,
  type ScheduleIdleExpiry,
  type SteeringIdleWake,
  type SteeringRegistry,
} from './steering-registry';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let seq = 0;
function msg(
  id?: string,
  text = `guidance-${seq}`,
  operatorUserId: string | null = 'user-1'
): QueuedOperatorMessage {
  seq += 1;
  return {
    messageId: id ?? `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    message: text,
    operatorUserId,
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
    handle.enqueue(msg('m-1', 'original prose', 'op-a'));
    const dup = handle.enqueue(msg('m-1', 'different prose', 'op-b'));
    expect(dup).toEqual({
      ok: true,
      duplicate: true,
      receipt: { messageId: 'm-1', state: 'queued' },
    });
    expect(handle.pendingCount()).toBe(1);
    expect(handle.snapshot().queued[0]?.message).toBe('original prose');
    expect(handle.snapshot().queued[0]?.operatorUserId).toBe('op-a');
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

  test('mixed senders keep order and attribution through drain', () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1');
    const a1 = msg('a1', 'from-a-1', 'op-a');
    const b1 = msg('b1', 'from-b-1', 'op-b');
    const a2 = msg('a2', 'from-a-2', 'op-a');
    const b2 = msg('b2', 'from-b-2', 'op-b');
    handle.accept(a1, 'queue');
    handle.accept(b1, 'queue');
    handle.accept(a2, 'queue');
    handle.accept(b2, 'queue');

    const queued = handle.snapshot().queued;
    expect(queued.map(m => m.messageId)).toEqual(['a1', 'b1', 'a2', 'b2']);
    expect(queued.map(m => m.operatorUserId)).toEqual(['op-a', 'op-b', 'op-a', 'op-b']);
    expect(queued.filter(m => m.operatorUserId === 'op-a').map(m => m.messageId)).toEqual([
      'a1',
      'a2',
    ]);
    expect(queued.filter(m => m.operatorUserId === 'op-b').map(m => m.messageId)).toEqual([
      'b1',
      'b2',
    ]);

    const drained = handle.drain();
    expect(drained).toEqual([a1, b1, a2, b2]);
    expect(handle.drain()).toEqual([]);
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

// ---------------------------------------------------------------------------
// Capability-aware registration (#183)
// ---------------------------------------------------------------------------

describe('capability-aware registration', () => {
  test('live/parked handles are reused only when interruptibility agrees', () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1', { interruptible: true });
    expect(handle.isInterruptible()).toBe(true);
    expect(registry.register('run-1', 'node-1', { interruptible: true })).toBe(handle);
    handle.park();
    expect(registry.register('run-1', 'node-1', { interruptible: true })).toBe(handle);
  });

  test('mismatched overlapping executions fail fast', () => {
    const registry = createSteeringRegistry();
    registry.register('run-1', 'node-1', { interruptible: true });
    expect(() => registry.register('run-1', 'node-1')).toThrow(/interruptible/);
    expect(() => registry.register('run-1', 'node-1', { interruptible: false })).toThrow(
      /interruptible/
    );
  });

  test('mismatched parked handle fails fast too — no silent downgrade', () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1', { interruptible: true });
    handle.park();
    expect(() => registry.register('run-1', 'node-1')).toThrow(/interruptible/);
    expect(registry.register('run-1', 'node-1', { interruptible: true })).toBe(handle);
  });

  test('a closed handle is replaced regardless of interruptibility', () => {
    const registry = createSteeringRegistry();
    const first = registry.register('run-1', 'node-1', { interruptible: true });
    first.close();
    const second = registry.register('run-1', 'node-1');
    expect(second).not.toBe(first);
    expect(second.isInterruptible()).toBe(false);
    const third = registry.register('run-1', 'node-2');
    third.close();
    const fourth = registry.register('run-1', 'node-2', { interruptible: true });
    expect(fourth.isInterruptible()).toBe(true);
  });

  test('non-interruptible handles keep queue-only shape: no sub-state, no turns', () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1');
    expect(handle.isInterruptible()).toBe(false);
    expect(handle.steeringSubState()).toBeUndefined();
    expect(handle.snapshot().subState).toBeUndefined();
    expect(() => handle.beginTurn(new AbortController())).toThrow(/interruptible/);
    expect(handle.enqueue(msg('m-1'))).toEqual({
      ok: true,
      duplicate: false,
      receipt: { messageId: 'm-1', state: 'queued' },
    });
  });
});

// ---------------------------------------------------------------------------
// Tokenized turns (#183)
// ---------------------------------------------------------------------------

describe('tokenized turns', () => {
  test('beginTurn returns monotonic tokens and projects generating', () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1', { interruptible: true });
    const t1 = handle.beginTurn(new AbortController());
    expect(t1).toBe(1);
    expect(handle.steeringSubState()).toBe('generating');
    expect(handle.snapshot().subState).toBe('generating');
    handle.endTurnStream(t1);
    handle.settleTurn(t1, 'generating');
    const t2 = handle.beginTurn(new AbortController());
    expect(t2).toBe(2);
    expect(t2).toBeGreaterThan(t1);
  });

  test('beginTurn fails while the prior token is unsettled — even after stream end', () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1', { interruptible: true });
    const t1 = handle.beginTurn(new AbortController());
    handle.endTurnStream(t1); // stream ended but classification pending
    expect(() => handle.beginTurn(new AbortController())).toThrow(/unsettled/);
    handle.settleTurn(t1, 'node_finished');
    expect(() => handle.beginTurn(new AbortController())).not.toThrow();
  });

  test('beginTurn fails on non-live handles', () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1', { interruptible: true });
    handle.park();
    expect(() => handle.beginTurn(new AbortController())).toThrow(/live/);
    handle.resume();
    const t = handle.beginTurn(new AbortController());
    handle.settleTurn(t, 'node_finished');
    handle.close();
    expect(() => handle.beginTurn(new AbortController())).toThrow(/live/);
  });

  test('endTurnStream clears only the matching controller; stale tokens no-op', async () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1', { interruptible: true });
    const controller = new AbortController();
    const t1 = handle.beginTurn(controller);
    handle.endTurnStream(999); // stale — no-op
    const pending = handle.interrupt();
    expect(controller.signal.aborted).toBe(true); // still-abortable turn aborts
    handle.endTurnStream(t1);
    handle.settleTurn(t1, 'generating');
    await expect(pending).resolves.toBe('generating');
  });

  test('settleTurn resolves the matching pending interrupt exactly once', async () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1', { interruptible: true });
    const t1 = handle.beginTurn(new AbortController());
    const pending = handle.interrupt();
    handle.settleTurn(999, 'generating'); // stale — no-op
    handle.settleTurn(t1, 'node_finished');
    handle.settleTurn(t1, 'generating'); // duplicate — no-op
    await expect(pending).resolves.toBe('node_finished');
    expect(handle.wasOperatorInterrupted(t1)).toBe(false); // flag cleared on settle
  });
});

// ---------------------------------------------------------------------------
// interrupt() (#183)
// ---------------------------------------------------------------------------

describe('interrupt', () => {
  test('aborts the current controller once and shares one settlement promise', async () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1', { interruptible: true });
    const controller = new AbortController();
    const token = handle.beginTurn(controller);
    let abortEvents = 0;
    controller.signal.addEventListener('abort', () => {
      abortEvents += 1;
    });
    const first = handle.interrupt();
    const second = handle.interrupt();
    expect(first).toBe(second); // shared settlement promise
    expect(controller.signal.aborted).toBe(true);
    expect(abortEvents).toBe(1); // never aborted twice
    expect(handle.wasOperatorInterrupted(token)).toBe(true);
    handle.endTurnStream(token);
    handle.settleTurn(token, 'idle-after-interrupt');
    await expect(first).resolves.toBe('idle-after-interrupt');
  });

  test('after stream end but before classification: waits without aborting the old controller', async () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1', { interruptible: true });
    const controller = new AbortController();
    const token = handle.beginTurn(controller);
    handle.endTurnStream(token);
    const pending = handle.interrupt();
    expect(controller.signal.aborted).toBe(false); // dead controller untouched
    expect(handle.wasOperatorInterrupted(token)).toBe(true); // flag set for classification
    handle.settleTurn(token, 'generating');
    await expect(pending).resolves.toBe('generating');
  });

  test('idle calls return idle immediately', async () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1', { interruptible: true });
    const token = handle.beginTurn(new AbortController());
    handle.interrupt();
    void handle.enterIdle(token);
    await expect(handle.interrupt()).resolves.toBe('idle-after-interrupt');
  });

  test('non-interruptible, parked, and closed handles resolve without a turn', async () => {
    const registry = createSteeringRegistry();
    const queueOnly = registry.register('run-1', 'node-1');
    await expect(queueOnly.interrupt()).resolves.toBe('not_steerable_here');
    const parked = registry.register('run-1', 'node-2', { interruptible: true });
    parked.park();
    await expect(parked.interrupt()).resolves.toBe('not_steerable_here');
    const closed = registry.register('run-1', 'node-3', { interruptible: true });
    closed.close();
    await expect(closed.interrupt()).resolves.toBe('node_finished');
  });

  test('park/discard/cancel resolve a pending interrupt exactly once', async () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1', { interruptible: true });
    handle.beginTurn(new AbortController());
    const pending = handle.interrupt();
    handle.park();
    await expect(pending).resolves.toBe('not_steerable_here');

    const natural = registry.register('run-1', 'node-2', { interruptible: true });
    natural.beginTurn(new AbortController());
    const pendingClose = natural.interrupt();
    natural.close();
    await expect(pendingClose).resolves.toBe('node_finished');
  });
});

// ---------------------------------------------------------------------------
// Atomic accept + idle await (#183)
// ---------------------------------------------------------------------------

describe('accept + enterIdle', () => {
  test('queue intent while generating lands as queued', () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1', { interruptible: true });
    handle.beginTurn(new AbortController());
    expect(handle.accept(msg('m-1'), 'queue')).toEqual({
      ok: true,
      duplicate: false,
      receipt: { messageId: 'm-1', state: 'queued' },
    });
    expect(handle.pendingCount()).toBe(1);
  });

  test('queue intent while interrupting lands as queued — no wake semantics', async () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1', { interruptible: true });
    const token = handle.beginTurn(new AbortController());
    const pending = handle.interrupt();
    expect(handle.accept(msg('m-1'), 'queue')).toEqual({
      ok: true,
      duplicate: false,
      receipt: { messageId: 'm-1', state: 'queued' },
    });
    handle.settleTurn(token, 'idle-after-interrupt');
    await expect(pending).resolves.toBe('idle-after-interrupt');
  });

  test('queue intent while idle lands as awaiting_send_now and never wakes', async () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1', { interruptible: true });
    const token = handle.beginTurn(new AbortController());
    handle.interrupt();
    const waiter = handle.enterIdle(token);
    expect(handle.steeringSubState()).toBe('idle-after-interrupt');
    expect(handle.accept(msg('m-1', 'hold'), 'queue')).toEqual({
      ok: true,
      duplicate: false,
      receipt: { messageId: 'm-1', state: 'awaiting_send_now' },
    });
    // The waiter stays pending — racing it against a resolved sentinel proves
    // no implicit wake.
    const settled = await Promise.race([waiter.then(() => 'woke'), Promise.resolve('still-idle')]);
    expect(settled).toBe('still-idle');
    expect(handle.pendingCount()).toBe(1);
    handle.close(); // test cleanup — resolves the waiter
    await expect(waiter).resolves.toEqual({ kind: 'terminated' });
  });

  test('send_now while idle drains in order and resolves the waiter in the same tick', async () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1', { interruptible: true });
    const token = handle.beginTurn(new AbortController());
    handle.interrupt();
    const waiter = handle.enterIdle(token);
    const first = msg('m-1', 'first', 'op-a');
    const second = msg('m-2', 'second', 'op-b');
    const trigger = msg('m-3', 'go');
    handle.accept(first, 'queue');
    handle.accept(second, 'send_now'); // non-blank: drains [m-1, m-2] itself
    const wake1 = await waiter;
    expect(wake1).toEqual({ kind: 'send_now', messages: [first, second] });
    expect(handle.steeringSubState()).toBe('generating');

    // Second idle cycle: a later send_now drains the whole batch in order.
    const token2 = handle.beginTurn(new AbortController());
    handle.interrupt();
    const waiter2 = handle.enterIdle(token2);
    handle.accept(trigger, 'send_now');
    const wake2 = await waiter2;
    expect(wake2.kind).toBe('send_now');
    if (wake2.kind === 'send_now') {
      expect(wake2.messages.map(m => m.messageId)).toEqual(['m-3']);
    }
  });

  test('duplicate ids replay the original receipt and never release a second drain', async () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1', { interruptible: true });
    const token = handle.beginTurn(new AbortController());
    handle.interrupt();
    const waiter = handle.enterIdle(token);
    handle.accept(msg('m-1', 'go'), 'send_now');
    const wake = await waiter;
    expect(wake.kind).toBe('send_now');
    // Replay: the original receipt comes back — no re-enqueue, no waiter release.
    const dup = handle.accept(msg('m-1', 'go'), 'send_now');
    expect(dup).toEqual({
      ok: true,
      duplicate: true,
      receipt: { messageId: 'm-1', state: 'awaiting_send_now' },
    });
    expect(handle.pendingCount()).toBe(0);
  });

  test('send_now while generating queues normally — never drains the live turn', () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1', { interruptible: true });
    handle.beginTurn(new AbortController());
    expect(handle.accept(msg('m-1', 'not now'), 'send_now')).toEqual({
      ok: true,
      duplicate: false,
      receipt: { messageId: 'm-1', state: 'queued' },
    });
    expect(handle.pendingCount()).toBe(1);
    expect(handle.steeringSubState()).toBe('generating');
  });

  test('enterIdle resolves the in-flight interrupt as idle and fails on stale tokens', async () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1', { interruptible: true });
    const token = handle.beginTurn(new AbortController());
    const pending = handle.interrupt();
    void handle.enterIdle(token);
    await expect(pending).resolves.toBe('idle-after-interrupt');
    expect(() => handle.enterIdle(token)).toThrow(/stale/);
    expect(() => handle.enterIdle(999)).toThrow(/stale/);
    handle.close();
  });

  test('close/park/discard resolve the idle waiter exactly once', async () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1', { interruptible: true });
    const token = handle.beginTurn(new AbortController());
    handle.interrupt();
    const waiter = handle.enterIdle(token);
    handle.discard();
    await expect(waiter).resolves.toEqual({ kind: 'terminated' });

    const second = registry.register('run-1', 'node-2', { interruptible: true });
    const t2 = second.beginTurn(new AbortController());
    second.interrupt();
    const waiter2 = second.enterIdle(t2);
    second.close();
    await expect(waiter2).resolves.toEqual({ kind: 'terminated' });
  });

  test('clearForTests resolves outstanding idle waiters — no unresolved promises', async () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1', { interruptible: true });
    const token = handle.beginTurn(new AbortController());
    handle.interrupt();
    const waiter = handle.enterIdle(token);
    registry.clearForTests();
    await expect(waiter).resolves.toEqual({ kind: 'terminated' });
  });
});

// ---------------------------------------------------------------------------
// Idle-await inactivity timer + keepalive (#192 / Story 2.12)
// ---------------------------------------------------------------------------

interface ManualIdleJob {
  readonly delayMs: number;
  cancelled: boolean;
  readonly callback: () => void;
}

interface ManualScheduler {
  readonly schedule: ScheduleIdleExpiry;
  readonly jobs: ManualIdleJob[];
  activeJobs(): ManualIdleJob[];
  fire(job: ManualIdleJob): void;
}

function createManualScheduler(): ManualScheduler {
  const jobs: ManualIdleJob[] = [];
  const schedule: ScheduleIdleExpiry = (callback, delayMs) => {
    const job: ManualIdleJob = {
      delayMs,
      cancelled: false,
      callback,
    };
    jobs.push(job);
    return () => {
      job.cancelled = true;
    };
  };
  return {
    schedule,
    jobs,
    activeJobs: () => jobs.filter(job => !job.cancelled),
    // Always invoke — generation + cancel guards must make cancelled/stale
    // callbacks inert even when a scheduler still delivers them.
    fire: (job: ManualIdleJob) => {
      job.callback();
    },
  };
}

function enterIdleFor(handle: NodeSteeringHandle): Promise<SteeringIdleWake> {
  const token = handle.beginTurn(new AbortController());
  handle.interrupt();
  return handle.enterIdle(token);
}

describe('idle-await inactivity timer + keepalive', () => {
  test('T1.1 production default schedules STEERING_IDLE_AWAIT_INACTIVITY_MS on idle entry', async () => {
    expect(STEERING_IDLE_AWAIT_INACTIVITY_MS).toBe(30 * 60_000);
    expect(STEERING_IDLE_AWAIT_INACTIVITY_MS).toBe(1_800_000);

    const scheduler = createManualScheduler();
    const registry = createSteeringRegistry({ scheduleIdleExpiry: scheduler.schedule });
    const handle = registry.register('run-1', 'node-1', { interruptible: true });
    const waiter = enterIdleFor(handle);

    expect(scheduler.activeJobs()).toHaveLength(1);
    expect(scheduler.activeJobs()[0]?.delayMs).toBe(STEERING_IDLE_AWAIT_INACTIVITY_MS);

    handle.close();
    await expect(waiter).resolves.toEqual({ kind: 'terminated' });
  });

  test('T1.2 firing the active job resolves the waiter once as expired', async () => {
    const scheduler = createManualScheduler();
    const registry = createSteeringRegistry({
      idleAwaitInactivityMs: 60_000,
      scheduleIdleExpiry: scheduler.schedule,
    });
    const handle = registry.register('run-1', 'node-1', { interruptible: true });
    const waiter = enterIdleFor(handle);
    const job = scheduler.activeJobs()[0];
    expect(job).toBeDefined();

    scheduler.fire(job!);
    await expect(waiter).resolves.toEqual({ kind: 'expired' });
    expect(handle.keepalive()).toBe('not_idle');
    expect(handle.steeringSubState()).toBe('idle-after-interrupt');
    expect(handle.snapshot().phase).toBe('live');

    // Second fire is inert — waiter already taken.
    scheduler.fire(job!);
    expect(handle.keepalive()).toBe('not_idle');
  });

  test('T1.3 keepalive cancels prior job, schedules a full-duration job, leaves waiter pending', async () => {
    const scheduler = createManualScheduler();
    const registry = createSteeringRegistry({
      idleAwaitInactivityMs: 45_000,
      scheduleIdleExpiry: scheduler.schedule,
    });
    const handle = registry.register('run-1', 'node-1', { interruptible: true });
    const waiter = enterIdleFor(handle);
    const first = scheduler.activeJobs()[0]!;

    expect(handle.keepalive()).toBe('rearmed');
    expect(first.cancelled).toBe(true);
    expect(scheduler.activeJobs()).toHaveLength(1);
    const second = scheduler.activeJobs()[0]!;
    expect(second).not.toBe(first);
    expect(second.delayMs).toBe(45_000);
    expect(handle.steeringSubState()).toBe('idle-after-interrupt');

    // Cancelled generation is inert even if the scheduler still invokes it.
    scheduler.fire(first);
    const stillPending = await Promise.race([
      waiter.then(() => 'woke'),
      Promise.resolve('still-idle'),
    ]);
    expect(stillPending).toBe('still-idle');

    scheduler.fire(second);
    await expect(waiter).resolves.toEqual({ kind: 'expired' });
  });

  test('T1.4 keepalive state guard — only live idle with a pending waiter rearms', async () => {
    const scheduler = createManualScheduler();
    const registry = createSteeringRegistry({
      idleAwaitInactivityMs: 10_000,
      scheduleIdleExpiry: scheduler.schedule,
    });

    // Generating
    const generating = registry.register('run-1', 'gen', { interruptible: true });
    generating.beginTurn(new AbortController());
    expect(generating.keepalive()).toBe('not_idle');
    expect(scheduler.jobs).toHaveLength(0);

    // Between-turn (live interruptible, no current turn, not idle)
    const between = registry.register('run-1', 'between', { interruptible: true });
    const bt = between.beginTurn(new AbortController());
    between.settleTurn(bt, 'generating');
    expect(between.steeringSubState()).toBe('generating');
    expect(between.keepalive()).toBe('not_idle');
    expect(scheduler.jobs).toHaveLength(0);

    // Queue-only
    const queueOnly = registry.register('run-1', 'queue-only');
    expect(queueOnly.keepalive()).toBe('not_idle');
    expect(scheduler.jobs).toHaveLength(0);

    // Parked
    const parked = registry.register('run-1', 'parked', { interruptible: true });
    const pt = parked.beginTurn(new AbortController());
    parked.interrupt();
    void parked.enterIdle(pt);
    expect(scheduler.activeJobs().length).toBeGreaterThan(0);
    const jobsBeforePark = scheduler.jobs.length;
    parked.park();
    expect(parked.keepalive()).toBe('not_idle');
    expect(scheduler.jobs.length).toBe(jobsBeforePark); // no new schedule

    // Closed
    const closed = registry.register('run-1', 'closed', { interruptible: true });
    closed.close();
    expect(closed.keepalive()).toBe('not_idle');

    // Already-expired
    const expired = registry.register('run-1', 'expired', { interruptible: true });
    const waiter = enterIdleFor(expired);
    const job = scheduler.activeJobs().at(-1)!;
    scheduler.fire(job);
    await expect(waiter).resolves.toEqual({ kind: 'expired' });
    const jobsAfterExpiry = scheduler.jobs.length;
    expect(expired.keepalive()).toBe('not_idle');
    expect(scheduler.jobs.length).toBe(jobsAfterExpiry);

    // Only live idle rearms
    const idle = registry.register('run-1', 'idle', { interruptible: true });
    const idleWaiter = enterIdleFor(idle);
    expect(idle.keepalive()).toBe('rearmed');
    idle.close();
    await expect(idleWaiter).resolves.toEqual({ kind: 'terminated' });
  });

  test('T1.5 send_now cancels the job, drains once, and later expiry cannot resolve again', async () => {
    const scheduler = createManualScheduler();
    const registry = createSteeringRegistry({
      idleAwaitInactivityMs: 10_000,
      scheduleIdleExpiry: scheduler.schedule,
    });
    const handle = registry.register('run-1', 'node-1', { interruptible: true });
    const waiter = enterIdleFor(handle);
    const first = msg('m-1', 'hold');
    const trigger = msg('m-2', 'go');
    handle.accept(first, 'queue');
    const job = scheduler.activeJobs()[0]!;

    handle.accept(trigger, 'send_now');
    expect(job.cancelled).toBe(true);
    const wake = await waiter;
    expect(wake).toEqual({ kind: 'send_now', messages: [first, trigger] });
    expect(handle.pendingCount()).toBe(0);
    expect(handle.steeringSubState()).toBe('generating');

    scheduler.fire(job);
    expect(handle.pendingCount()).toBe(0);
    expect(handle.steeringSubState()).toBe('generating');
  });

  test('T1.6 queue intent neither rearms nor resolves; expiry leaves the row pending', async () => {
    const scheduler = createManualScheduler();
    const registry = createSteeringRegistry({
      idleAwaitInactivityMs: 10_000,
      scheduleIdleExpiry: scheduler.schedule,
    });
    const handle = registry.register('run-1', 'node-1', { interruptible: true });
    const waiter = enterIdleFor(handle);
    const job = scheduler.activeJobs()[0]!;

    expect(handle.accept(msg('m-1', 'hold'), 'queue')).toEqual({
      ok: true,
      duplicate: false,
      receipt: { messageId: 'm-1', state: 'awaiting_send_now' },
    });
    expect(job.cancelled).toBe(false);
    expect(scheduler.activeJobs()).toHaveLength(1);
    expect(scheduler.activeJobs()[0]).toBe(job);

    const stillPending = await Promise.race([
      waiter.then(() => 'woke'),
      Promise.resolve('still-idle'),
    ]);
    expect(stillPending).toBe('still-idle');

    scheduler.fire(job);
    await expect(waiter).resolves.toEqual({ kind: 'expired' });
    expect(handle.accept(msg('m-2', 'after'), 'queue')).toEqual({
      ok: true,
      duplicate: false,
      receipt: { messageId: 'm-2', state: 'awaiting_send_now' },
    });
    expect(handle.pendingCount()).toBe(2);
  });

  test('T1.7 every seal path cancels the active job and resolves terminated once', async () => {
    async function sealCase(
      name: string,
      seal: (registry: SteeringRegistry, handle: NodeSteeringHandle) => void
    ): Promise<void> {
      const scheduler = createManualScheduler();
      const registry = createSteeringRegistry({
        idleAwaitInactivityMs: 10_000,
        scheduleIdleExpiry: scheduler.schedule,
      });
      const handle = registry.register('run-1', name, { interruptible: true });
      const waiter = enterIdleFor(handle);
      const job = scheduler.activeJobs()[0]!;
      seal(registry, handle);
      expect(job.cancelled).toBe(true);
      await expect(waiter).resolves.toEqual({ kind: 'terminated' });
      scheduler.fire(job); // inert after seal
    }

    await sealCase('close', (_r, h) => h.close());
    await sealCase('park', (_r, h) => h.park());
    await sealCase('discard', (_r, h) => {
      h.discard();
    });
    await sealCase('closeIfEmpty', (_r, h) => {
      expect(h.closeIfEmpty()).toBe(true);
    });
    await sealCase('clearForTests', (r, _h) => {
      r.clearForTests();
    });
  });

  test('T1.8 post-expiry handle stays live/idle for queue reconciliation', async () => {
    const scheduler = createManualScheduler();
    const registry = createSteeringRegistry({
      idleAwaitInactivityMs: 10_000,
      scheduleIdleExpiry: scheduler.schedule,
    });
    const handle = registry.register('run-1', 'node-1', { interruptible: true });
    const waiter = enterIdleFor(handle);
    scheduler.fire(scheduler.activeJobs()[0]!);
    await expect(waiter).resolves.toEqual({ kind: 'expired' });

    expect(handle.snapshot().phase).toBe('live');
    expect(handle.steeringSubState()).toBe('idle-after-interrupt');
    expect(handle.accept(msg('m-1', 'held'), 'queue')).toEqual({
      ok: true,
      duplicate: false,
      receipt: { messageId: 'm-1', state: 'awaiting_send_now' },
    });
    expect(handle.pendingCount()).toBe(1);
    expect(handle.closeIfEmpty()).toBe(false);
    handle.close();
  });

  test('T1.9 first-wins orders: send-then-expiry, expiry-then-send, teardown-then-expiry', async () => {
    // send then expiry
    {
      const scheduler = createManualScheduler();
      const registry = createSteeringRegistry({
        idleAwaitInactivityMs: 10_000,
        scheduleIdleExpiry: scheduler.schedule,
      });
      const handle = registry.register('run-a', 'n1', { interruptible: true });
      const waiter = enterIdleFor(handle);
      handle.accept(msg('a-1', 'hold'), 'queue');
      const job = scheduler.activeJobs()[0]!;
      handle.accept(msg('a-2', 'go'), 'send_now');
      await expect(waiter).resolves.toMatchObject({ kind: 'send_now' });
      scheduler.fire(job);
      // Queue was drained by send_now — not silently re-drained by expiry.
      expect(handle.pendingCount()).toBe(0);
    }

    // expiry then send
    {
      const scheduler = createManualScheduler();
      const registry = createSteeringRegistry({
        idleAwaitInactivityMs: 10_000,
        scheduleIdleExpiry: scheduler.schedule,
      });
      const handle = registry.register('run-b', 'n1', { interruptible: true });
      const waiter = enterIdleFor(handle);
      handle.accept(msg('b-1', 'hold'), 'queue');
      scheduler.fire(scheduler.activeJobs()[0]!);
      await expect(waiter).resolves.toEqual({ kind: 'expired' });
      // Post-expiry send_now cannot resolve the already-settled waiter; row stays.
      const before = handle.pendingCount();
      handle.accept(msg('b-2', 'too-late'), 'send_now');
      expect(handle.pendingCount()).toBe(before + 1);
      expect(handle.steeringSubState()).toBe('idle-after-interrupt');
      handle.close();
    }

    // teardown then expiry
    {
      const scheduler = createManualScheduler();
      const registry = createSteeringRegistry({
        idleAwaitInactivityMs: 10_000,
        scheduleIdleExpiry: scheduler.schedule,
      });
      const handle = registry.register('run-c', 'n1', { interruptible: true });
      const waiter = enterIdleFor(handle);
      handle.accept(msg('c-1', 'hold'), 'queue');
      const job = scheduler.activeJobs()[0]!;
      handle.close();
      await expect(waiter).resolves.toEqual({ kind: 'terminated' });
      // Teardown does not silently drain — items retained until discard.
      expect(handle.pendingCount()).toBe(1);
      scheduler.fire(job);
      expect(handle.pendingCount()).toBe(1);
    }
  });

  test('T1.10 two registries with different options schedule independently', async () => {
    const aScheduler = createManualScheduler();
    const bScheduler = createManualScheduler();
    const a = createSteeringRegistry({
      idleAwaitInactivityMs: 1_000,
      scheduleIdleExpiry: aScheduler.schedule,
    });
    const b = createSteeringRegistry({
      idleAwaitInactivityMs: 2_000,
      scheduleIdleExpiry: bScheduler.schedule,
    });

    const ha = a.register('run-1', 'node-1', { interruptible: true });
    const hb = b.register('run-1', 'node-1', { interruptible: true });
    const wa = enterIdleFor(ha);
    const wb = enterIdleFor(hb);

    expect(aScheduler.activeJobs()[0]?.delayMs).toBe(1_000);
    expect(bScheduler.activeJobs()[0]?.delayMs).toBe(2_000);

    a.clearForTests();
    await expect(wa).resolves.toEqual({ kind: 'terminated' });
    // Clearing A must not settle B or cancel B's job.
    expect(bScheduler.activeJobs()).toHaveLength(1);
    const stillPending = await Promise.race([wb.then(() => 'woke'), Promise.resolve('still-idle')]);
    expect(stillPending).toBe('still-idle');

    // Singleton is untouched by isolated registries.
    const singleton = getSteeringRegistry();
    expect(singleton.get('run-1', 'node-1')).toBeUndefined();

    b.clearForTests();
    await expect(wb).resolves.toEqual({ kind: 'terminated' });
  });

  test('T1.11 resolveIdleAwaitInactivityMs E2E env gate', () => {
    expect(resolveIdleAwaitInactivityMs({})).toBe(STEERING_IDLE_AWAIT_INACTIVITY_MS);
    expect(resolveIdleAwaitInactivityMs({ ARCHON_E2E_FAKE_PROVIDER: 'true' })).toBe(
      STEERING_IDLE_AWAIT_INACTIVITY_MS
    );
    expect(resolveIdleAwaitInactivityMs({ ARCHON_E2E_FAKE_PROVIDER: 'false' })).toBe(
      STEERING_IDLE_AWAIT_INACTIVITY_MS
    );
    expect(resolveIdleAwaitInactivityMs({ ARCHON_E2E_FAKE_PROVIDER: '0' })).toBe(
      STEERING_IDLE_AWAIT_INACTIVITY_MS
    );
    expect(
      resolveIdleAwaitInactivityMs({
        ARCHON_E2E_FAKE_PROVIDER: '1',
        ARCHON_E2E_STEERING_IDLE_AWAIT_MS: '2500',
      })
    ).toBe(2500);
    expect(
      resolveIdleAwaitInactivityMs({
        ARCHON_E2E_FAKE_PROVIDER: '1',
        ARCHON_E2E_STEERING_IDLE_AWAIT_MS: '1',
      })
    ).toBe(1);
    expect(
      resolveIdleAwaitInactivityMs({
        ARCHON_E2E_FAKE_PROVIDER: '1',
        ARCHON_E2E_STEERING_IDLE_AWAIT_MS: String(STEERING_IDLE_AWAIT_INACTIVITY_MS),
      })
    ).toBe(STEERING_IDLE_AWAIT_INACTIVITY_MS);

    // Invalid under the exact fake gate — fall back.
    for (const bad of [
      undefined,
      '',
      'abc',
      '0',
      '-1',
      '1.5',
      '1e3',
      '1e309',
      String(STEERING_IDLE_AWAIT_INACTIVITY_MS + 1),
      ' 2500 ',
    ]) {
      expect(
        resolveIdleAwaitInactivityMs({
          ARCHON_E2E_FAKE_PROVIDER: '1',
          ARCHON_E2E_STEERING_IDLE_AWAIT_MS: bad,
        })
      ).toBe(STEERING_IDLE_AWAIT_INACTIVITY_MS);
    }
  });

  test('T1.12 production scheduler conditionally unrefs and cancel is idempotent', () => {
    const unref = mock(() => undefined);
    const fakeHandle = { unref };
    const setSpy = spyOn(globalThis, 'setTimeout').mockImplementation((() => fakeHandle) as never);
    const clearSpy = spyOn(globalThis, 'clearTimeout').mockImplementation(() => undefined);

    try {
      let fired = 0;
      const cancel = scheduleIdleExpiryWithTimeout(() => {
        fired += 1;
      }, 12_345);
      expect(setSpy).toHaveBeenCalledTimes(1);
      expect(setSpy.mock.calls[0]?.[1]).toBe(12_345);
      expect(unref).toHaveBeenCalledTimes(1);

      cancel();
      expect(clearSpy).toHaveBeenCalledTimes(1);
      expect(clearSpy.mock.calls[0]?.[0]).toBe(fakeHandle);

      cancel();
      expect(clearSpy).toHaveBeenCalledTimes(1);
      expect(fired).toBe(0);

      // unref absence is tolerated.
      setSpy.mockImplementation((() => ({})) as never);
      const cancel2 = scheduleIdleExpiryWithTimeout(() => undefined, 1);
      cancel2();
      expect(clearSpy).toHaveBeenCalledTimes(2);
    } finally {
      setSpy.mockRestore();
      clearSpy.mockRestore();
    }
  });

  test('expireIdleForTests drives the same expiry transition without a real timer', async () => {
    const scheduler = createManualScheduler();
    const registry = createSteeringRegistry({
      idleAwaitInactivityMs: 10_000,
      scheduleIdleExpiry: scheduler.schedule,
    });
    const handle = registry.register('run-1', 'node-1', { interruptible: true });
    const waiter = enterIdleFor(handle);
    const job = scheduler.activeJobs()[0]!;

    handle.expireIdleForTests();
    expect(job.cancelled).toBe(true);
    await expect(waiter).resolves.toEqual({ kind: 'expired' });
    expect(handle.steeringSubState()).toBe('idle-after-interrupt');
    expect(handle.keepalive()).toBe('not_idle');
  });
});
