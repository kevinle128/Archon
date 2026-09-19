/**
 * SteeringRegistry - process-local queue for operator guidance sent to a
 * running agent node.
 *
 * Lives in @archon/workflows so the DAG executor and the server send route can
 * share one registry. Keyed by (runId, stepName) where stepName is the
 * namespaced node id used by transcript routes and loop-group bodies.
 *
 * Design:
 * - Singleton for production via getSteeringRegistry(); createSteeringRegistry()
 *   builds isolated instances for tests.
 * - Fully synchronous: accept/enqueue and the closeIfEmpty() last gate never
 *   await, so no receipt can succeed after the executor commits to teardown.
 * - Idempotent for a handle's entire lifetime: every accepted message_id maps
 *   to its original receipt (and original message) until the handle is
 *   discarded. There is no queue-depth, message-length, or accepted-id cap.
 * - Message content is never logged anywhere in this module.
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
 * Exported only via the ./steering-registry subpath - never through the
 * workflows package root.
 */

export interface QueuedOperatorMessage {
  readonly messageId: string;
  readonly message: string;
  readonly operatorUserId: string | null;
  readonly receivedAt: string;
}

export interface AcceptedSteeringReceipt {
  readonly messageId: string;
  /**
   * `queued` while the node is generating/interrupting; `awaiting_send_now`
   * while the handle sits in `idle-after-interrupt` — accepted onto the
   * pending queue but NOT an implicit wake (#183 — a stopped turn does not
   * surprise-resume on later queueing). Receipts are immutable: an
   * `awaiting_send_now` row is never rewritten to `queued`.
   */
  readonly state: 'queued' | 'awaiting_send_now';
}

export type SteeringHandlePhase = 'live' | 'parked' | 'closed';

export type EnqueueResult =
  | { readonly ok: true; readonly duplicate: boolean; readonly receipt: AcceptedSteeringReceipt }
  | { readonly ok: false; readonly reason: 'not_live' | 'closed' };

/** Atomic accept surface (#183) — same result shape as {@link EnqueueResult}. */
export type AcceptResult = EnqueueResult;

export type SteeringIntent = 'queue' | 'send_now';

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
 * What an idle executor wakes to (#183). `send_now` carries the full drained
 * batch in accepted order; `terminated` covers both discard and the
 * cancel-status poll — the executor re-reads run status and lands on the
 * existing Cancel path.
 */
export type SteeringIdleWake =
  | { readonly kind: 'send_now'; readonly messages: readonly QueuedOperatorMessage[] }
  | { readonly kind: 'terminated' };

export interface SteeringHandleSnapshot {
  readonly phase: SteeringHandlePhase;
  readonly queued: readonly QueuedOperatorMessage[];
  readonly acceptedCount: number;
  /** Only ever set on live interruptible handles (#183). */
  readonly subState: SteeringSubState | undefined;
}

interface AcceptedEntry {
  readonly receipt: AcceptedSteeringReceipt;
  readonly message: QueuedOperatorMessage;
}

interface PendingInterrupt {
  readonly promise: Promise<InterruptSettlement>;
  readonly resolve: (outcome: InterruptSettlement) => void;
}

interface ActiveTurn {
  readonly token: number;
  controller: AbortController | undefined;
  settled: boolean;
  /** Set the first time `interrupt()` lands on this token; released on settle. */
  operatorInterrupted: boolean;
  pendingInterrupt: PendingInterrupt | undefined;
}

export class NodeSteeringHandle {
  private phase: SteeringHandlePhase = 'live';
  private pending: QueuedOperatorMessage[] = [];
  private readonly accepted = new Map<string, AcceptedEntry>();
  private readonly interruptible: boolean;
  private subState: SteeringSubState | undefined;
  private turnSeq = 0;
  private currentTurn: ActiveTurn | undefined;
  private idleWaiter: { resolve: (wake: SteeringIdleWake) => void } | undefined;

  constructor(options?: { interruptible?: boolean }) {
    this.interruptible = options?.interruptible ?? false;
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
   */
  steeringSubState(): SteeringSubState | undefined {
    return this.interruptible && this.phase === 'live' ? this.subState : undefined;
  }

  /**
   * Begin a provider pass on a live interruptible handle. Returns the fresh
   * monotonic token the executor uses for all subsequent per-turn calls.
   * Fails fast when a prior token is still unsettled — even if its stream
   * ended, the executor must classify it (settle/enterIdle) first so an
   * in-flight `interrupt()` is never abandoned across pass boundaries.
   */
  beginTurn(controller: AbortController): number {
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
    };
    this.subState = 'generating';
    return token;
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
   * immediately to the handle's truthful projection.
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
   * turn slot, and returns ONE waiter resolved by the first of `send_now`
   * (with the drained batch), discard, or terminal cleanup. Fails fast on a
   * stale/already-settled token — idle entry is a classification outcome,
   * not a fallback.
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
    return new Promise<SteeringIdleWake>(resolve => {
      this.idleWaiter = { resolve };
    });
  }

  /**
   * Atomic accept for operator guidance (#183). The pending queue and the
   * idle waiter are updated in ONE synchronous mutation, so a duplicate
   * `send_now` can never produce a second drain and a queue-intent row can
   * never wake the idle executor implicitly.
   */
  accept(message: QueuedOperatorMessage, intent: SteeringIntent): AcceptResult {
    const existing = this.accepted.get(message.messageId);
    if (existing !== undefined) {
      return { ok: true, duplicate: true, receipt: existing.receipt };
    }
    if (this.phase === 'closed') {
      return { ok: false, reason: 'closed' };
    }
    if (this.phase !== 'live') {
      return { ok: false, reason: 'not_live' };
    }
    const idle = this.subState === 'idle-after-interrupt';
    const receipt: AcceptedSteeringReceipt = {
      messageId: message.messageId,
      state: idle ? 'awaiting_send_now' : 'queued',
    };
    this.pending.push(message);
    this.accepted.set(message.messageId, { receipt, message });
    if (
      idle &&
      intent === 'send_now' &&
      message.message.trim() !== '' &&
      this.idleWaiter !== undefined
    ) {
      // First-wins release: drain the whole pending batch in accepted order,
      // flip the handle back to generating, and resolve the idle waiter in
      // the same synchronous tick — no second drain is possible after this.
      const batch = this.pending;
      this.pending = [];
      this.subState = 'generating';
      const waiter = this.idleWaiter;
      this.idleWaiter = undefined;
      waiter.resolve({ kind: 'send_now', messages: batch });
    }
    return { ok: true, duplicate: false, receipt };
  }

  /**
   * Queue-intent accept — the sole mutation surface for `#181` callers
   * (server send route) that predate intent. Identical to
   * `accept(message, 'queue')`: on an idle handle the row lands as
   * `awaiting_send_now` and never implicitly wakes the executor.
   */
  enqueue(message: QueuedOperatorMessage): EnqueueResult {
    return this.accept(message, 'queue');
  }

  pendingCount(): number {
    return this.pending.length;
  }

  /**
   * The executor's last gate before teardown: synchronously seals an empty
   * live handle in the same tick so no later receipt can succeed. Sealing
   * resolves a pending interrupt as `node_finished` and any idle waiter as
   * terminated.
   */
  closeIfEmpty(): boolean {
    if (this.phase === 'live' && this.pending.length === 0) {
      this.seal('node_finished');
      return true;
    }
    return false;
  }

  /**
   * Atomically returns and removes the pending items without closing the
   * handle. Accepted-id memory is preserved, so drained ids stay idempotent.
   */
  drain(): readonly QueuedOperatorMessage[] {
    const items = this.pending;
    this.pending = [];
    return items;
  }

  /**
   * Removes one still-pending message from a live or parked queue. Accepted-id
   * memory and handle phase are preserved. Closed handles are immutable.
   */
  withdraw(messageId: string): boolean {
    if (this.phase === 'closed') return false;
    const index = this.pending.findIndex(item => item.messageId === messageId);
    if (index === -1) return false;
    this.pending.splice(index, 1);
    return true;
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
      queued: [...this.pending],
      acceptedCount: this.accepted.size,
      subState: this.steeringSubState(),
    };
  }

  /**
   * Registry-internal teardown: seals the handle and drops all pending items
   * and accepted-id memory. A pending interrupt resolves `not_steerable_here`
   * (the park/discard race → 422) and the idle waiter resolves terminated so
   * the executor lands on its existing Cancel path. Returns the number of
   * pending items dropped, for content-free cleanup logging by the caller.
   * Called only by SteeringRegistry.discardRun()/clearForTests() - never by
   * executor or route code.
   */
  discard(): number {
    const dropped = this.pending.length;
    this.pending = [];
    this.accepted.clear();
    this.seal('not_steerable_here');
    return dropped;
  }

  /**
   * Shared terminal settlement — every phase transition out of `live`
   * resolves the active turn's pending interrupt AND the idle waiter exactly
   * once, so no caller can strand a route request or an executor waiter.
   */
  private seal(outcome: InterruptSettlement, nextPhase: SteeringHandlePhase = 'closed'): void {
    const turn = this.currentTurn;
    if (turn !== undefined && !turn.settled) {
      turn.settled = true;
      turn.pendingInterrupt?.resolve(outcome);
    }
    this.currentTurn = undefined;
    const waiter = this.idleWaiter;
    this.idleWaiter = undefined;
    waiter?.resolve({ kind: 'terminated' });
    this.phase = nextPhase;
    this.subState = undefined;
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
    const handle = new NodeSteeringHandle({ interruptible });
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
   * Closes, clears, and removes every handle for the named run only, returning
   * content-free counts for the caller to log. Handles still referenced
   * elsewhere (e.g. an executor unwinding after Cancel) are left closed and
   * emptied so they cannot drain or accept. Never touches database state.
   */
  discardRun(runId: string): { readonly handles: number; readonly queued: number } {
    const nodes = this.runs.get(runId);
    if (nodes === undefined) {
      return { handles: 0, queued: 0 };
    }
    let queued = 0;
    for (const handle of nodes.values()) {
      queued += handle.discard();
    }
    this.runs.delete(runId);
    return { handles: nodes.size, queued };
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
 */
export function getSteeringRegistry(): SteeringRegistry {
  if (instance === null) {
    instance = new SteeringRegistry();
  }
  return instance;
}

/**
 * Isolated registry construction for tests - never shares state with the
 * production singleton.
 */
export function createSteeringRegistry(): SteeringRegistry {
  return new SteeringRegistry();
}
