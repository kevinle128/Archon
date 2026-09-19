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
 * - Fully synchronous: enqueue and the closeIfEmpty() last gate never await, so
 *   no receipt can succeed after the executor commits to teardown.
 * - Idempotent for a handle's entire lifetime: every accepted message_id maps
 *   to its original receipt (and original message) until the handle is
 *   discarded. There is no queue-depth, message-length, or accepted-id cap.
 * - Message content is never logged anywhere in this module.
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
  readonly state: 'queued';
}

export type SteeringHandlePhase = 'live' | 'parked' | 'closed';

export type EnqueueResult =
  | { readonly ok: true; readonly duplicate: boolean; readonly receipt: AcceptedSteeringReceipt }
  | { readonly ok: false; readonly reason: 'not_live' | 'closed' };

export interface SteeringHandleSnapshot {
  readonly phase: SteeringHandlePhase;
  readonly queued: readonly QueuedOperatorMessage[];
  readonly acceptedCount: number;
}

interface AcceptedEntry {
  readonly receipt: AcceptedSteeringReceipt;
  readonly message: QueuedOperatorMessage;
}

export class NodeSteeringHandle {
  private phase: SteeringHandlePhase = 'live';
  private pending: QueuedOperatorMessage[] = [];
  private readonly accepted = new Map<string, AcceptedEntry>();

  /**
   * Synchronously accept or refuse a message. A previously accepted id replays
   * its original receipt before any phase logic (both before and after drain,
   * and even when the handle has since parked or closed); a duplicate with
   * different prose never replaces the original. New ids append in receipt
   * order on a live handle, and are refused on parked ('not_live') and closed
   * ('closed') handles.
   */
  enqueue(message: QueuedOperatorMessage): EnqueueResult {
    const existing = this.accepted.get(message.messageId);
    if (existing) {
      return { ok: true, duplicate: true, receipt: existing.receipt };
    }
    if (this.phase === 'closed') {
      return { ok: false, reason: 'closed' };
    }
    if (this.phase !== 'live') {
      return { ok: false, reason: 'not_live' };
    }
    const receipt: AcceptedSteeringReceipt = {
      messageId: message.messageId,
      state: 'queued',
    };
    this.pending.push(message);
    this.accepted.set(message.messageId, { receipt, message });
    return { ok: true, duplicate: false, receipt };
  }

  pendingCount(): number {
    return this.pending.length;
  }

  /**
   * The executor's last gate before teardown: synchronously seals an empty
   * live handle in the same tick so no later receipt can succeed. Returns
   * false without mutation when the handle is not live or items remain.
   */
  closeIfEmpty(): boolean {
    if (this.phase === 'live' && this.pending.length === 0) {
      this.phase = 'closed';
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
      this.phase = 'parked';
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
   */
  close(): void {
    this.phase = 'closed';
  }

  snapshot(): SteeringHandleSnapshot {
    return {
      phase: this.phase,
      queued: [...this.pending],
      acceptedCount: this.accepted.size,
    };
  }

  /**
   * Registry-internal teardown: seals the handle and drops all pending items
   * and accepted-id memory. Returns the number of pending items dropped, for
   * content-free cleanup logging by the caller. Called only by
   * SteeringRegistry.discardRun()/clearForTests() - never by executor or route
   * code.
   */
  discard(): number {
    const dropped = this.pending.length;
    this.phase = 'closed';
    this.pending = [];
    this.accepted.clear();
    return dropped;
  }
}

export class SteeringRegistry {
  private readonly runs = new Map<string, Map<string, NodeSteeringHandle>>();

  /**
   * Returns the live handle for (runId, nodeId): creates one when absent,
   * resumes a parked handle with its queue intact, returns an already-live
   * handle unchanged, and replaces a closed handle with a fresh live handle
   * (fresh idempotency scope) for a genuinely new execution.
   */
  register(runId: string, nodeId: string): NodeSteeringHandle {
    const existing = this.get(runId, nodeId);
    if (existing) {
      const phase = existing.snapshot().phase;
      if (phase === 'parked') {
        existing.resume();
      }
      if (phase !== 'closed') {
        return existing;
      }
    }
    const handle = new NodeSteeringHandle();
    let nodes = this.runs.get(runId);
    if (!nodes) {
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
    if (!nodes) return;
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
    if (!nodes) {
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
  if (!instance) {
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
