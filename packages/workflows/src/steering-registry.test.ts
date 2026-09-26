import { describe, expect, mock, spyOn, test } from 'bun:test';

import {
  createSteeringRegistry,
  getSteeringRegistry,
  resolveIdleAwaitInactivityMs,
  scheduleIdleExpiryWithTimeout,
  STEERING_IDLE_AWAIT_INACTIVITY_MS,
  type NodeSteeringHandle,
  type ScheduleIdleExpiry,
  type SteeringIdleWake,
  type SteeringRegistry,
} from './steering-registry';

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
    singleton.clearForTests();
    expect(singleton.get('run-1', 'node-1')).toBeUndefined();
    expect(handle.snapshot().phase).toBe('closed');
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
    expect(registry.register('run-1', 'node-1')).toBe(handle);
  });

  test('register resumes a parked handle', () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1');
    handle.park();
    const resumed = registry.register('run-1', 'node-1');
    expect(resumed).toBe(handle);
    expect(resumed.snapshot().phase).toBe('live');
  });

  test('register replaces a closed handle for a genuinely new execution', () => {
    const registry = createSteeringRegistry();
    const first = registry.register('run-1', 'node-1');
    first.close();
    const second = registry.register('run-1', 'node-1');
    expect(second).not.toBe(first);
    expect(second.snapshot().phase).toBe('live');
    expect(first.snapshot().phase).toBe('closed');
  });

  test('unregister removes the handle so register starts fresh', () => {
    const registry = createSteeringRegistry();
    const first = registry.register('run-1', 'node-1');
    registry.unregister('run-1', 'node-1');
    expect(registry.get('run-1', 'node-1')).toBeUndefined();
    const second = registry.register('run-1', 'node-1');
    expect(second).not.toBe(first);
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
// park / resume / close
// ---------------------------------------------------------------------------

describe('park/resume/close', () => {
  test('park moves a live handle to parked; resume re-lives the same handle', () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1');
    handle.park();
    expect(handle.snapshot().phase).toBe('parked');
    handle.resume();
    expect(handle.snapshot().phase).toBe('live');
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
  });
});

// ---------------------------------------------------------------------------
// discardRun
// ---------------------------------------------------------------------------

describe('discardRun', () => {
  test('closes and removes every handle for only the named run', () => {
    const registry = createSteeringRegistry();
    const h1 = registry.register('run-1', 'node-1');
    const h2 = registry.register('run-1', 'node-2');
    const other = registry.register('run-2', 'node-1');
    h2.park();

    const counts = registry.discardRun('run-1');
    expect(counts).toEqual({ handles: 2 });
    expect(registry.get('run-1', 'node-1')).toBeUndefined();
    expect(registry.get('run-1', 'node-2')).toBeUndefined();

    expect(h1.snapshot().phase).toBe('closed');
    expect(h2.snapshot().phase).toBe('closed');

    // Other runs are untouched.
    expect(registry.get('run-2', 'node-1')).toBe(other);
    expect(other.snapshot().phase).toBe('live');
  });

  test('discardRun on an unknown run returns a zero count', () => {
    const registry = createSteeringRegistry();
    registry.register('run-1', 'node-1');
    expect(registry.discardRun('run-2')).toEqual({ handles: 0 });
    expect(registry.get('run-1', 'node-1')).toBeDefined();
  });

  test('a handle re-registered after discardRun starts a fresh execution', () => {
    const registry = createSteeringRegistry();
    const first = registry.register('run-1', 'node-1');
    registry.discardRun('run-1');
    const second = registry.register('run-1', 'node-1');
    expect(second).not.toBe(first);
    expect(second.snapshot().phase).toBe('live');
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
// wakeForSendNow / awaitSendNowAgain (#183) — content-free idle wake
// ---------------------------------------------------------------------------

describe('wakeForSendNow + awaitSendNowAgain', () => {
  test('wakeForSendNow resolves the waiter but leaves sub-state idle until a turn begins', async () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1', { interruptible: true });
    const token = handle.beginTurn(new AbortController());
    handle.interrupt();
    const waiter = handle.enterIdle(token);
    expect(handle.wakeForSendNow()).toBe('woken');
    await expect(waiter).resolves.toEqual({ kind: 'send_now' });
    // The claim can still find nothing (a race with withdraw) — sub-state
    // must not report generating before a real turn actually begins.
    expect(handle.steeringSubState()).toBe('idle-after-interrupt');
    const newToken = handle.beginTurn(new AbortController());
    expect(handle.steeringSubState()).toBe('generating');
    handle.settleTurn(newToken, 'node_finished');
  });

  test('wakeForSendNow is a no-op off a generating, parked, or closed handle', () => {
    const registry = createSteeringRegistry();
    const generating = registry.register('run-1', 'gen', { interruptible: true });
    generating.beginTurn(new AbortController());
    expect(generating.wakeForSendNow()).toBe('not_idle');

    const queueOnly = registry.register('run-1', 'queue-only');
    expect(queueOnly.wakeForSendNow()).toBe('not_idle');

    const parked = registry.register('run-1', 'parked', { interruptible: true });
    parked.park();
    expect(parked.wakeForSendNow()).toBe('not_idle');

    const closed = registry.register('run-1', 'closed', { interruptible: true });
    closed.close();
    expect(closed.wakeForSendNow()).toBe('not_idle');
  });

  test('a duplicate wake after the waiter already fired is inert', async () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1', { interruptible: true });
    const token = handle.beginTurn(new AbortController());
    handle.interrupt();
    const waiter = handle.enterIdle(token);
    expect(handle.wakeForSendNow()).toBe('woken');
    await waiter;
    // The waiter is already consumed — a second wake attempt (e.g. a
    // replayed duplicate message id) finds no idle waiter to resolve.
    expect(handle.wakeForSendNow()).toBe('not_idle');
  });

  test('awaitSendNowAgain re-installs a waiter after a claim finds nothing', async () => {
    const registry = createSteeringRegistry();
    const handle = registry.register('run-1', 'node-1', { interruptible: true });
    const token = handle.beginTurn(new AbortController());
    handle.interrupt();
    void handle.enterIdle(token);
    expect(handle.wakeForSendNow()).toBe('woken');

    // The executor's claim found nothing (a race with withdraw) — it re-waits.
    const again = handle.awaitSendNowAgain();
    expect(handle.wakeForSendNow()).toBe('woken');
    await expect(again).resolves.toEqual({ kind: 'send_now' });
  });

  test('awaitSendNowAgain fails outside a live idle handle or with a waiter already installed', () => {
    const registry = createSteeringRegistry();
    const generating = registry.register('run-1', 'gen', { interruptible: true });
    generating.beginTurn(new AbortController());
    expect(() => generating.awaitSendNowAgain()).toThrow(/idle-after-interrupt/);

    const handle = registry.register('run-1', 'node-1', { interruptible: true });
    const token = handle.beginTurn(new AbortController());
    handle.interrupt();
    void handle.enterIdle(token);
    expect(() => handle.awaitSendNowAgain()).toThrow(/already installed/);
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

  test('T1.5 wakeForSendNow cancels the job and resolves the waiter once', async () => {
    const scheduler = createManualScheduler();
    const registry = createSteeringRegistry({
      idleAwaitInactivityMs: 10_000,
      scheduleIdleExpiry: scheduler.schedule,
    });
    const handle = registry.register('run-1', 'node-1', { interruptible: true });
    const waiter = enterIdleFor(handle);
    const job = scheduler.activeJobs()[0]!;

    expect(handle.wakeForSendNow()).toBe('woken');
    expect(job.cancelled).toBe(true);
    await expect(waiter).resolves.toEqual({ kind: 'send_now' });
    expect(handle.steeringSubState()).toBe('idle-after-interrupt');

    scheduler.fire(job);
    expect(handle.steeringSubState()).toBe('idle-after-interrupt');
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
    await sealCase('clearForTests', (r, _h) => {
      r.clearForTests();
    });
  });

  test('T1.8 post-expiry handle stays live/idle and accepts a later wake', async () => {
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
    // Expiry resolved the waiter, but the handle stays idle for the executor
    // to re-wait through awaitSendNowAgain — mirroring production behavior.
    const again = handle.awaitSendNowAgain();
    expect(handle.wakeForSendNow()).toBe('woken');
    await expect(again).resolves.toEqual({ kind: 'send_now' });
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
      const job = scheduler.activeJobs()[0]!;
      expect(handle.wakeForSendNow()).toBe('woken');
      await expect(waiter).resolves.toEqual({ kind: 'send_now' });
      scheduler.fire(job);
      // Wake already resolved the waiter — expiry cannot resolve it again.
      expect(handle.steeringSubState()).toBe('idle-after-interrupt');
      handle.close();
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
      scheduler.fire(scheduler.activeJobs()[0]!);
      await expect(waiter).resolves.toEqual({ kind: 'expired' });
      // Post-expiry wake cannot resolve the already-settled waiter — the
      // handle stays idle-after-interrupt until awaitSendNowAgain re-waits.
      expect(handle.wakeForSendNow()).toBe('not_idle');
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
      const job = scheduler.activeJobs()[0]!;
      handle.close();
      await expect(waiter).resolves.toEqual({ kind: 'terminated' });
      scheduler.fire(job); // inert after teardown
      expect(handle.snapshot().phase).toBe('closed');
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
