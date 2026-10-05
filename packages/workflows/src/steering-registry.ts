/**
 * SteeringRegistry - process-local live turn handle for a running agent node.
 *
 * Lives in @archon/workflows so the DAG executor and the server steering
 * routes can share one registry. Keyed by (runId, stepName) where stepName is
 * the namespaced node id used by transcript routes and loop-group bodies.
 *
 * This registry is the VOLATILE execution plane only: the live provider turn
 * handle, its per-turn interrupt controller, and the idle-after-interrupt
 * wait. It holds no guidance content and no queue. The durable control plane
 * (drafts, the node guidance queue, FIFO order, delivery state, auto-send) is
 * `IWorkflowSteeringStore` in `./store` — the executor is the sole claimer of
 * that durable queue, and every route mutates it, never this registry's
 * in-memory state. A live SDK handle is never serialized; a server restart
 * always loses it, by design.
 *
 * Design:
 * - Singleton for production via getSteeringRegistry(); createSteeringRegistry()
 *   builds isolated instances for tests.
 * - Turn transitions (beginTurn/endTurnStream/settleTurn/interrupt/enterIdle)
 *   stay fully synchronous where the executor's teardown ordering depends on
 *   it, so a Stop can never race past a settlement the executor already made.
 *
 * Per-turn interruption (#183): an interruptible handle additionally models
 * ONE active provider turn at a time, tokenized by a monotonically increasing
 * counter. The executor calls beginTurn() immediately before each sendQuery
 * (every pass — initial, re-ask, guidance, loop iteration — gets a fresh
 * token and a fresh AbortController), endTurnStream() in its stream finally,
 * and settleTurn() (or enterIdle()) once the turn's outcome is classified.
 * interrupt() aborts only the currently-stored controller and waits on a
 * shared settlement promise, so a Stop racing a natural end resolves to the
 * classified outcome instead of guessing. Sub-state projection
 * ('generating' | 'idle-after-interrupt') exists only on live interruptible
 * handles; queue-only providers never expose one.
 *
 * Turn-scoped interrupt downgrade: a provider whose capability is otherwise
 * interruptible can still run ONE turn on a fallback transport with no
 * interrupt hook (e.g. Grok's `--single` path). `markTurnNotInterruptible()`
 * lets the executor record that report against the CURRENT turn only; while
 * it holds, `steeringSubState()` projects `undefined` (no Stop control) and
 * `interrupt()` settles `not_steerable_here` immediately instead of aborting
 * a controller nothing reads or waiting on the turn's natural end. The flag
 * lives on the turn object beginTurn() creates, so the next beginTurn() call
 * starts clean — a later turn is interruptible again unless it reports the
 * same downgrade itself.
 *
 * Idle-await inactivity (#192 / Story 2.12): while a live interruptible handle
 * sits in `idle-after-interrupt`, one process-local timer bounds how long the
 * executor may wait for a redirect. Expiry resolves the SAME idle waiter as
 * `{ kind: 'expired' }` — it is NOT the stream idle-timeout path
 * (`withIdleTimeout` / `nodeIdleTimedOut` / `STEP_IDLE_TIMEOUT_MS`), which
 * *completes* a node. Keepalive re-arms the timer without waking the waiter.
 * Duration is a fixed product rule (30 minutes); no config key, YAML field, or
 * DB state. Timer + handle are process-local and do not survive restart.
 *
 * `wakeForSendNow()` is a content-free wake: it only signals "durable guidance
 * may now be claimable" so the executor re-checks the durable store. The
 * executor may find nothing there (a race with a concurrent withdraw) and
 * must re-wait via `awaitSendNowAgain()` rather than start a turn with no
 * guidance.
 *
 * Exported only via the ./steering-registry subpath - never through the
 * workflows package root.
 */

import type { SoftInjectionChannel, SoftInjectionRequest } from '@archon/providers/types';

/** Fixed product rule: 30 minutes of genuine composer inactivity ends idle-await. */
export const STEERING_IDLE_AWAIT_INACTIVITY_MS = 30 * 60_000;

/**
 * Schedules one idle-expiry callback and returns an idempotent cancel.
 * Production wraps `setTimeout` + guarded `unref`; tests inject a manual
 * scheduler so no real clocks or ms sleeps are required.
 */
export type ScheduleIdleExpiry = (callback: () => void, delayMs: number) => () => void;

export interface SteeringRegistryOptions {
  readonly idleAwaitInactivityMs?: number;
  readonly scheduleIdleExpiry?: ScheduleIdleExpiry;
}

/**
 * Production idle-expiry scheduler. Conditionally `unref`s the timeout so a
 * parked idle waiter cannot keep a CLI process alive by itself.
 *
 * @internal Exported for direct unit coverage of unref/cancel behavior.
 */
export function scheduleIdleExpiryWithTimeout(callback: () => void, delayMs: number): () => void {
  const timer = setTimeout(callback, delayMs);
  const handle = timer as unknown as { unref?: () => void };
  if (typeof handle.unref === 'function') {
    handle.unref();
  }
  let cancelled = false;
  return (): void => {
    if (cancelled) return;
    cancelled = true;
    clearTimeout(timer);
  };
}

/**
 * Resolve the idle-await duration for a registry. Production always uses
 * {@link STEERING_IDLE_AWAIT_INACTIVITY_MS}. The E2E override is honored ONLY
 * when `ARCHON_E2E_FAKE_PROVIDER === '1'` exactly AND
 * `ARCHON_E2E_STEERING_IDLE_AWAIT_MS` parses to an integer in
 * `[1, STEERING_IDLE_AWAIT_INACTIVITY_MS]`; every other shape falls back.
 */
export function resolveIdleAwaitInactivityMs(
  environment: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): number {
  if (environment.ARCHON_E2E_FAKE_PROVIDER !== '1') {
    return STEERING_IDLE_AWAIT_INACTIVITY_MS;
  }
  const raw = environment.ARCHON_E2E_STEERING_IDLE_AWAIT_MS;
  if (typeof raw !== 'string' || raw === '') {
    return STEERING_IDLE_AWAIT_INACTIVITY_MS;
  }
  // Strict decimal integer only — reject fractions, signs, scientific notation,
  // whitespace padding, and overflow forms that Number() would coerce.
  if (!/^\d+$/.test(raw)) {
    return STEERING_IDLE_AWAIT_INACTIVITY_MS;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > STEERING_IDLE_AWAIT_INACTIVITY_MS) {
    return STEERING_IDLE_AWAIT_INACTIVITY_MS;
  }
  return parsed;
}

export type SteeringHandlePhase = 'live' | 'parked' | 'closed';

/**
 * Projected steering sub-state (#183) — live interruptible handles only.
 * `generating` covers every live non-idle moment (active provider turn AND
 * the synchronous drain/boundary windows between turns); there is no
 * `interrupting` projection — that badge is UI-local only.
 */
export type SteeringSubState = 'generating' | 'idle-after-interrupt';

/**
 * Settlement classification resolved onto a pending `interrupt()` promise
 * (#183). The executor decides the outcome; the registry only relays it:
 * - `idle-after-interrupt` — the interrupted turn ended cleanly; the handle
 *   is parked in the resumable idle slot awaiting `send_now`.
 * - `generating` — the turn already ended naturally or queued guidance
 *   drained the handle into the next pass before Stop could take effect.
 * - `node_finished` — natural empty end (the handle sealed before the
 *   interrupt resolved).
 * - `not_steerable_here` — the handle was parked/discarded (e.g. run
 *   deleted, AskHuman park) while the interrupt was in flight.
 */
export type InterruptSettlement =
  | 'idle-after-interrupt'
  | 'generating'
  | 'node_finished'
  | 'not_steerable_here';

/**
 * What an idle executor wakes to (#183 / #192). `send_now` is content-free —
 * it means "durable guidance may now be claimable", and the executor must
 * claim from the durable store to find out; a race with a concurrent
 * withdraw can legitimately find nothing, and the executor re-waits via
 * `awaitSendNowAgain()` rather than starting a turn with no guidance.
 * `terminated` is teardown (Cancel/park/discard/close); `expired` is the
 * inactivity timer — distinct from stream idle-timeout completion. Exactly
 * one of these settles the single idle waiter.
 */
export type SteeringIdleWake =
  | { readonly kind: 'send_now' }
  | { readonly kind: 'terminated' }
  | { readonly kind: 'expired' };

export interface SteeringHandleSnapshot {
  readonly phase: SteeringHandlePhase;
  /** Only ever set on live interruptible handles (#183). */
  readonly subState: SteeringSubState | undefined;
}

interface PendingInterrupt {
  readonly promise: Promise<InterruptSettlement>;
  readonly resolve: (outcome: InterruptSettlement) => void;
}

/**
 * Concrete, executor-owned soft-injection controller — the companion to the
 * interrupt `AbortController` (#183). `channel` is the read-only view handed
 * to the provider adapter through `AgentRequestOptions.softInjection`;
 * `push()` is called only by `NodeSteeringHandle.softInject()`, mirroring how
 * only `interrupt()` ever calls the matching turn's `controller.abort()`.
 */
export interface SoftInjectionController {
  readonly channel: SoftInjectionChannel;
  /** Resolves `true` only when a currently-registered handler accepted the request. */
  push(request: SoftInjectionDelivery): Promise<boolean>;
}

/**
 * One operator message offered to a live turn. The provider handler only ever
 * sees `messageId` and `text`; `operatorUserId` stays executor-side so the
 * accepted message can be recorded as an attributed operator transcript row.
 */
export interface SoftInjectionDelivery extends SoftInjectionRequest {
  readonly operatorUserId?: string | null;
}

/**
 * Builds one turn-scoped soft-injection controller. A fresh instance is
 * required per turn (never reused across passes), exactly like the interrupt
 * `AbortController` it accompanies — an adapter's `ready()` registration from
 * a settled turn must never receive a request meant for its successor.
 */
export function createSoftInjectionController(
  onAccepted?: (request: SoftInjectionDelivery) => Promise<void>
): SoftInjectionController {
  let handler: ((request: SoftInjectionRequest) => Promise<boolean>) | undefined;
  return {
    channel: {
      ready(next): () => void {
        handler = next;
        return (): void => {
          if (handler === next) handler = undefined;
        };
      },
    },
    async push(request): Promise<boolean> {
      if (handler === undefined) return false;
      const accepted = await handler({ messageId: request.messageId, text: request.text });
      // Runs before the caller learns of the acceptance, so the operator row
      // exists by the time the client re-reads the transcript.
      if (accepted && onAccepted !== undefined) await onAccepted(request);
      return accepted;
    },
  };
}

/**
 * Outcome of one `NodeSteeringHandle.softInject()` call:
 * - `delivered` — a registered handler accepted the request into the live turn.
 * - `not_ready` — a live turn exists but no handler is currently registered
 *   (the provider's adapter has not reached its injectable window, or the
 *   handler itself declined).
 * - `no_active_turn` — no live interruptible turn exists to inject into
 *   (between turns, idle-after-interrupt, or the handle is not live).
 */
export type SoftInjectionOutcome = 'delivered' | 'not_ready' | 'no_active_turn';

interface ActiveTurn {
  readonly token: number;
  controller: AbortController | undefined;
  settled: boolean;
  /** Set the first time `interrupt()` lands on this token; released on settle. */
  operatorInterrupted: boolean;
  pendingInterrupt: PendingInterrupt | undefined;
  /** Undefined for a queue-only provider or a provider without the capability. */
  softInjection: SoftInjectionController | undefined;
  /**
   * Set by `markTurnNotInterruptible()` when the provider reports THIS turn
   * cannot honor an operator Stop despite the handle's provider-wide
   * capability. Turn-scoped: a fresh `ActiveTurn` from the next `beginTurn()`
   * always starts with this `false`.
   */
  interruptUnavailable: boolean;
}

export class NodeSteeringHandle {
  private phase: SteeringHandlePhase = 'live';
  private readonly interruptible: boolean;
  private readonly idleAwaitInactivityMs: number;
  private readonly scheduleIdleExpiry: ScheduleIdleExpiry;
  private subState: SteeringSubState | undefined;
  private turnSeq = 0;
  private currentTurn: ActiveTurn | undefined;
  private idleWaiter: { resolve: (wake: SteeringIdleWake) => void } | undefined;
  /** Cancel fn for the active idle-expiry job; cleared on fire/cancel. */
  private cancelIdleExpiryFn: (() => void) | undefined;
  /** Monotonic generation — stale/cancelled callbacks compare against this. */
  private idleExpiryGeneration = 0;

  constructor(options?: {
    interruptible?: boolean;
    idleAwaitInactivityMs?: number;
    scheduleIdleExpiry?: ScheduleIdleExpiry;
  }) {
    this.interruptible = options?.interruptible ?? false;
    this.idleAwaitInactivityMs =
      options?.idleAwaitInactivityMs ?? STEERING_IDLE_AWAIT_INACTIVITY_MS;
    this.scheduleIdleExpiry = options?.scheduleIdleExpiry ?? scheduleIdleExpiryWithTimeout;
  }

  isInterruptible(): boolean {
    return this.interruptible;
  }

  /** Terminal seal — closed handles are replaced by the next `register`. */
  isClosed(): boolean {
    return this.phase === 'closed';
  }

  /**
   * Projected sub-state for reporting (route/UI): only live interruptible
   * handles project one; queue-only and non-live handles return `undefined`.
   * Also `undefined` while the current turn is flagged
   * `interruptUnavailable` — a control this specific turn cannot honor is
   * never shown, even though the handle is otherwise interruptible.
   */
  steeringSubState(): SteeringSubState | undefined {
    if (!this.interruptible || this.phase !== 'live') return undefined;
    if (this.currentTurn?.interruptUnavailable === true) return undefined;
    return this.subState;
  }

  /**
   * Begin a provider pass on a live interruptible handle. Returns the fresh
   * monotonic token the executor uses for all subsequent per-turn calls.
   * Fails fast when a prior token is still unsettled — even if its stream
   * ended, the executor must classify it (settle/enterIdle) first so an
   * in-flight `interrupt()` is never abandoned across pass boundaries.
   */
  beginTurn(controller: AbortController, softInjection?: SoftInjectionController): number {
    if (!this.interruptible) {
      throw new Error('beginTurn requires an interruptible steering handle');
    }
    if (this.phase !== 'live') {
      throw new Error(`beginTurn requires a live handle (phase: ${this.phase})`);
    }
    if (this.currentTurn !== undefined && !this.currentTurn.settled) {
      throw new Error(`beginTurn while turn ${String(this.currentTurn.token)} is still unsettled`);
    }
    this.turnSeq += 1;
    const token = this.turnSeq;
    this.currentTurn = {
      token,
      controller,
      settled: false,
      operatorInterrupted: false,
      pendingInterrupt: undefined,
      softInjection,
      interruptUnavailable: false,
    };
    this.subState = 'generating';
    return token;
  }

  /**
   * Record a provider report that the CURRENT live turn cannot honor an
   * operator Stop (e.g. a fallback transport with no interrupt hook), even
   * though this handle's provider capability is otherwise interruptible.
   * Stale or already-settled tokens are a no-op — the flag is meaningless
   * once its turn is gone, and the next `beginTurn()` always starts a fresh
   * turn with the flag clear.
   *
   * Handles the race where `interrupt()` already landed on this turn before
   * the provider's report arrived: that call aborted a controller nothing
   * reads (inert) and is still waiting on the turn's eventual natural
   * settlement — exactly the hang this feature exists to prevent. Clear the
   * stale operator-interrupt flag (a later abort-marked-result check must
   * never attribute this turn's end to an operator Stop that the provider
   * never honored) and resolve the waiting caller with the truthful outcome
   * right now instead of leaving it pending.
   */
  markTurnNotInterruptible(token: number): void {
    const turn = this.currentTurn;
    if (turn?.token !== token || turn.settled) return;
    turn.interruptUnavailable = true;
    if (turn.operatorInterrupted) {
      turn.operatorInterrupted = false;
      turn.pendingInterrupt?.resolve('not_steerable_here');
    }
  }

  /**
   * Offer one operator message to the current live turn without invoking
   * Stop (#183 companion to `interrupt()`). Only a live interruptible handle
   * with an unsettled current turn and a registered adapter handler can
   * accept it; every other case resolves `no_active_turn` without throwing,
   * exactly like `interrupt()` resolving a truthful projection instead of
   * failing.
   */
  softInject(request: SoftInjectionDelivery): Promise<SoftInjectionOutcome> {
    if (!this.interruptible || this.phase !== 'live') {
      return Promise.resolve('no_active_turn');
    }
    const turn = this.currentTurn;
    if (turn === undefined || turn.settled || turn.softInjection === undefined) {
      return Promise.resolve('no_active_turn');
    }
    return turn.softInjection
      .push(request)
      .then(accepted => (accepted ? 'delivered' : 'not_ready'));
  }

  /**
   * Stream-side end of a turn: clears ONLY the matching stored controller so
   * a late `interrupt()` can never abort a dead provider stream — but does
   * NOT resolve a pending interrupt (that is classification's job). Stale
   * tokens are a no-op.
   */
  endTurnStream(token: number): void {
    if (this.currentTurn?.token === token && !this.currentTurn.settled) {
      this.currentTurn.controller = undefined;
    }
  }

  /**
   * Classification writes the terminal outcome for a turn: resolves that
   * token's pending interrupt (if any) exactly once and releases the slot so
   * the next `beginTurn` can proceed. Stale or duplicate calls are no-ops.
   */
  settleTurn(token: number, outcome: InterruptSettlement): void {
    const turn = this.currentTurn;
    if (turn?.token !== token || turn.settled) return;
    turn.settled = true;
    this.currentTurn = undefined;
    turn.pendingInterrupt?.resolve(outcome);
  }

  /**
   * Operator-interrupt flag, queryable ONLY by the matching live token —
   * after `endTurnStream` cleared the controller but before `settleTurn` ran,
   * so the executor's five-case classification can tell "provider end that an
   * operator interrupt caused" from "provider end that merely raced a Stop".
   * Returns `false` for stale tokens and after settle (a resumed turn never
   * inherits the flag).
   */
  wasOperatorInterrupted(token: number): boolean {
    const turn = this.currentTurn;
    return turn?.token === token && turn.operatorInterrupted;
  }

  /**
   * Request interruption of the current turn (#183). Synchronously sets the
   * operator-interrupt flag and aborts the stored controller at most once;
   * repeated calls share one settlement promise resolved by the executor's
   * classification. After `endTurnStream` the call waits for classification
   * without touching the dead controller. With no live turn the call resolves
   * immediately to the handle's truthful projection. A turn flagged
   * `interruptUnavailable` also resolves immediately as `not_steerable_here`
   * — never aborting a controller the provider does not read and never
   * waiting on the turn's natural end.
   */
  interrupt(): Promise<InterruptSettlement> {
    if (!this.interruptible || this.phase === 'parked') {
      return Promise.resolve('not_steerable_here');
    }
    if (this.phase === 'closed') {
      return Promise.resolve('node_finished');
    }
    if (this.subState === 'idle-after-interrupt') {
      return Promise.resolve('idle-after-interrupt');
    }
    const turn = this.currentTurn;
    if (turn === undefined || turn.settled) {
      // Live but between turns (synchronous drain/boundary window) — the node
      // is generating; there is no live controller to abort.
      return Promise.resolve('generating');
    }
    if (turn.interruptUnavailable) {
      return Promise.resolve('not_steerable_here');
    }
    const pending = this.ensurePendingInterrupt(turn);
    if (!turn.operatorInterrupted) {
      turn.operatorInterrupted = true;
      turn.controller?.abort();
    }
    return pending.promise;
  }

  /**
   * Move a classified-interrupted turn into `idle-after-interrupt`: resolves
   * that token's pending interrupt as `idle-after-interrupt`, releases the
   * turn slot, arms the inactivity timer, and returns ONE waiter resolved by
   * the first of `send_now` (content-free — the executor claims the durable
   * store to find out what to send), inactivity expiry, discard, or terminal
   * cleanup. Fails fast on a stale/already-settled token — idle entry is a
   * classification outcome, not a fallback.
   */
  enterIdle(token: number): Promise<SteeringIdleWake> {
    const turn = this.currentTurn;
    if (!this.interruptible || this.phase !== 'live') {
      throw new Error('enterIdle requires a live interruptible handle');
    }
    if (turn?.token !== token || turn.settled) {
      throw new Error('enterIdle for stale or already-settled turn token');
    }
    turn.settled = true;
    this.currentTurn = undefined;
    turn.pendingInterrupt?.resolve('idle-after-interrupt');
    this.subState = 'idle-after-interrupt';
    // Install the waiter first, then arm — a zero-delay test scheduler must
    // still observe a pending waiter when its callback runs.
    const promise = new Promise<SteeringIdleWake>(resolve => {
      this.idleWaiter = { resolve };
    });
    this.armIdleExpiry();
    return promise;
  }

  /**
   * Re-wait for another `send_now` after a wake produced no claimable durable
   * content (a race with a concurrent withdraw). Requires the handle to
   * already be idle-after-interrupt with no waiter currently installed.
   * Re-arms the inactivity timer, exactly like the original `enterIdle` wait.
   */
  awaitSendNowAgain(): Promise<SteeringIdleWake> {
    if (!this.interruptible || this.phase !== 'live' || this.subState !== 'idle-after-interrupt') {
      throw new Error('awaitSendNowAgain requires a live idle-after-interrupt handle');
    }
    if (this.idleWaiter !== undefined) {
      throw new Error('awaitSendNowAgain while a waiter is already installed');
    }
    const promise = new Promise<SteeringIdleWake>(resolve => {
      this.idleWaiter = { resolve };
    });
    this.armIdleExpiry();
    return promise;
  }

  /**
   * Re-arm the inactivity timer without waking the idle waiter. Returns
   * `rearmed` only for a live interruptible handle in `idle-after-interrupt`
   * with a still-pending waiter; every other state is a no-op `not_idle`.
   */
  keepalive(): 'rearmed' | 'not_idle' {
    if (
      !this.interruptible ||
      this.phase !== 'live' ||
      this.subState !== 'idle-after-interrupt' ||
      this.idleWaiter === undefined
    ) {
      return 'not_idle';
    }
    this.armIdleExpiry();
    return 'rearmed';
  }

  /**
   * Drive the same expiry transition the production timer uses, cancelling
   * any scheduled job first. Executor tests use this instead of mutating a
   * singleton duration or sleeping on real clocks.
   *
   * @internal
   */
  expireIdleForTests(): void {
    this.cancelScheduledIdleExpiry();
    this.onIdleExpiry(this.idleExpiryGeneration);
  }

  /**
   * Content-free wake for a route that durably enqueued a `send_now` message
   * while the handle sat idle-after-interrupt. Cancels the inactivity timer
   * and resolves the idle waiter with no payload — the executor claims the
   * durable store to learn what to send. Sub-state stays `idle-after-interrupt`
   * until a turn actually begins: the claim can legitimately find nothing (a
   * race with a concurrent withdraw), and the handle must not report
   * `generating` to a reader before real work starts. Returns `not_idle` (a
   * no-op) when the handle is not currently an idle handle with a waiter
   * installed, e.g. a Stop already landed, or a duplicate call arrives after
   * the first wake already fired.
   */
  wakeForSendNow(): 'woken' | 'not_idle' {
    if (
      !this.interruptible ||
      this.phase !== 'live' ||
      this.subState !== 'idle-after-interrupt' ||
      this.idleWaiter === undefined
    ) {
      return 'not_idle';
    }
    this.invalidateIdleExpiry();
    const waiter = this.idleWaiter;
    this.idleWaiter = undefined;
    waiter.resolve({ kind: 'send_now' });
    return 'woken';
  }

  park(): void {
    if (this.phase === 'live') {
      // A pending interrupt resolves `not_steerable_here` — a parked ask 422s.
      this.seal('not_steerable_here', 'parked');
    }
  }

  resume(): void {
    if (this.phase === 'parked') {
      this.phase = 'live';
    }
  }

  /**
   * Terminal seal: later enqueues are refused but queued items and accepted-id
   * memory are retained for counting/idempotent replay until discard().
   * Pending interrupt resolves `node_finished`; an idle waiter terminates.
   */
  close(): void {
    this.seal('node_finished');
  }

  snapshot(): SteeringHandleSnapshot {
    return {
      phase: this.phase,
      subState: this.steeringSubState(),
    };
  }

  /**
   * Registry-internal teardown: seals the handle. A pending interrupt
   * resolves `not_steerable_here` (the park/discard race -> 422) and the idle
   * waiter resolves terminated so the executor lands on its existing Cancel
   * path. Durable queue content is untouched here — it is reconciled by the
   * executor's own terminal path, never by registry teardown. Called only by
   * SteeringRegistry.discardRun()/clearForTests() - never by executor or
   * route code.
   */
  discard(): void {
    this.seal('not_steerable_here');
  }

  /**
   * Shared terminal settlement — every phase transition out of `live`
   * resolves the active turn's pending interrupt AND the idle waiter exactly
   * once, so no caller can strand a route request or an executor waiter.
   * Cancels the inactivity timer before resolving so a late callback cannot
   * produce a second terminal outcome.
   */
  private seal(outcome: InterruptSettlement, nextPhase: SteeringHandlePhase = 'closed'): void {
    const turn = this.currentTurn;
    if (turn !== undefined && !turn.settled) {
      turn.settled = true;
      turn.pendingInterrupt?.resolve(outcome);
    }
    this.currentTurn = undefined;
    this.invalidateIdleExpiry();
    const waiter = this.idleWaiter;
    this.idleWaiter = undefined;
    waiter?.resolve({ kind: 'terminated' });
    this.phase = nextPhase;
    this.subState = undefined;
  }

  private armIdleExpiry(): void {
    this.invalidateIdleExpiry();
    const generation = this.idleExpiryGeneration;
    this.cancelIdleExpiryFn = this.scheduleIdleExpiry(() => {
      this.onIdleExpiry(generation);
    }, this.idleAwaitInactivityMs);
  }

  private invalidateIdleExpiry(): void {
    this.idleExpiryGeneration += 1;
    this.cancelScheduledIdleExpiry();
  }

  private cancelScheduledIdleExpiry(): void {
    const cancel = this.cancelIdleExpiryFn;
    this.cancelIdleExpiryFn = undefined;
    cancel?.();
  }

  /**
   * Inactivity expiry: take-and-clear the idle waiter as `{ kind: 'expired' }`
   * without changing phase, sub-state, queue, accepted-id memory, or turn
   * state. The handle stays live/idle so ordinary failure teardown and
   * queue-intent acceptance can still run until the executor seals it.
   */
  private onIdleExpiry(generation: number): void {
    if (generation !== this.idleExpiryGeneration) return;
    this.cancelIdleExpiryFn = undefined;
    const waiter = this.idleWaiter;
    if (waiter === undefined) return;
    this.idleWaiter = undefined;
    waiter.resolve({ kind: 'expired' });
  }

  private ensurePendingInterrupt(turn: ActiveTurn): PendingInterrupt {
    if (turn.pendingInterrupt === undefined) {
      let resolve!: (outcome: InterruptSettlement) => void;
      const promise = new Promise<InterruptSettlement>(r => {
        resolve = r;
      });
      // Never rejects; attach a catch anyway so an abandoned settlement can
      // never surface as an unhandled rejection.
      void promise.catch(() => undefined);
      turn.pendingInterrupt = { promise, resolve };
    }
    return turn.pendingInterrupt;
  }
}

export class SteeringRegistry {
  private readonly runs = new Map<string, Map<string, NodeSteeringHandle>>();
  private readonly idleAwaitInactivityMs: number;
  private readonly scheduleIdleExpiry: ScheduleIdleExpiry;

  constructor(options?: SteeringRegistryOptions) {
    this.idleAwaitInactivityMs =
      options?.idleAwaitInactivityMs ?? STEERING_IDLE_AWAIT_INACTIVITY_MS;
    this.scheduleIdleExpiry = options?.scheduleIdleExpiry ?? scheduleIdleExpiryWithTimeout;
  }

  /**
   * Returns the live handle for (runId, nodeId): creates one when absent,
   * resumes a parked handle with its queue intact, returns an already-live
   * handle unchanged, and replaces a closed handle with a fresh live handle
   * (fresh idempotency scope) for a genuinely new execution.
   *
   * Capability-aware (#183): an existing live/parked handle is reused ONLY
   * when its interruptibility agrees — mismatched overlapping executions
   * fail fast instead of silently downgrading a parked interruptible handle
   * (or pretending a queue-only one can interrupt).
   */
  register(
    runId: string,
    nodeId: string,
    options?: { interruptible?: boolean }
  ): NodeSteeringHandle {
    const interruptible = options?.interruptible ?? false;
    const existing = this.get(runId, nodeId);
    if (existing !== undefined && !existing.isClosed()) {
      if (existing.isInterruptible() !== interruptible) {
        throw new Error(
          `steering handle for run=${runId} node=${nodeId} already registered ` +
            `with interruptible=${String(existing.isInterruptible())}, cannot re-register ` +
            `with interruptible=${String(interruptible)}`
        );
      }
      existing.resume();
      return existing;
    }
    const handle = new NodeSteeringHandle({
      interruptible,
      idleAwaitInactivityMs: this.idleAwaitInactivityMs,
      scheduleIdleExpiry: this.scheduleIdleExpiry,
    });
    let nodes = this.runs.get(runId);
    if (nodes === undefined) {
      nodes = new Map<string, NodeSteeringHandle>();
      this.runs.set(runId, nodes);
    }
    nodes.set(nodeId, handle);
    return handle;
  }

  get(runId: string, nodeId: string): NodeSteeringHandle | undefined {
    return this.runs.get(runId)?.get(nodeId);
  }

  unregister(runId: string, nodeId: string): void {
    const nodes = this.runs.get(runId);
    if (nodes === undefined) return;
    nodes.delete(nodeId);
    if (nodes.size === 0) {
      this.runs.delete(runId);
    }
  }

  /**
   * Closes and removes every handle for the named run only, returning a
   * content-free count for the caller to log. Handles still referenced
   * elsewhere (e.g. an executor unwinding after Cancel) are left closed so
   * they cannot accept a new turn. Never touches database state — durable
   * queue reconciliation is the executor's own terminal path, not this call.
   */
  discardRun(runId: string): { readonly handles: number } {
    const nodes = this.runs.get(runId);
    if (nodes === undefined) {
      return { handles: 0 };
    }
    for (const handle of nodes.values()) {
      handle.discard();
    }
    this.runs.delete(runId);
    return { handles: nodes.size };
  }

  clearForTests(): void {
    for (const nodes of this.runs.values()) {
      for (const handle of nodes.values()) {
        handle.discard();
      }
    }
    this.runs.clear();
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: SteeringRegistry | null = null;

/**
 * Process-wide registry used by the executor and the server send route.
 * Duration is resolved once from the process environment at first access.
 */
export function getSteeringRegistry(): SteeringRegistry {
  if (instance === null) {
    instance = new SteeringRegistry({
      idleAwaitInactivityMs: resolveIdleAwaitInactivityMs(process.env),
    });
  }
  return instance;
}

/**
 * Isolated registry construction for tests - never shares state with the
 * production singleton. Optional duration/scheduler options forward to every
 * handle the registry creates.
 */
export function createSteeringRegistry(options?: SteeringRegistryOptions): SteeringRegistry {
  return new SteeringRegistry(options);
}
