/**
 * Framework-free steering-dock logic shared by the Legacy and Console
 * composer renderers: visibility/blocked predicates, the guarded submit
 * transitions with stable retry ids, the interrupt/Send-now turn model,
 * live queue polling/withdraw reconciliation, server-persisted draft
 * save/restore, and the nested steering error surface both API helpers
 * normalize onto.
 */
import type { FinishedIterationView } from './execution-room-model';

/**
 * Durable delivery state for one queue entry, mirrored from the engine's
 * `STEERING_QUEUE_VISIBLE_STATES` (`packages/workflows/src/schemas/steering.ts`).
 * Web must not import `@archon/workflows`; this is the intentional
 * package-boundary mirror. `withdrawn` is never wire-visible — a withdrawn
 * entry is dropped like a delete, so it is excluded here too.
 */
export type SteeringQueueItemState =
  | 'queued'
  | 'awaiting_send_now'
  | 'dispatching'
  | 'sent'
  | 'delivered'
  | 'delivery_unknown'
  | 'never_sent';

/** States still eligible for withdraw or per-item Send now (server-enforced). */
const STEERING_QUEUE_CLAIMABLE_STATES: readonly SteeringQueueItemState[] = [
  'queued',
  'awaiting_send_now',
];

/** States a mounted dock still tracks as pending (not yet resolved). */
const STEERING_QUEUE_PENDING_STATES: readonly SteeringQueueItemState[] = [
  'queued',
  'awaiting_send_now',
  'dispatching',
  'delivery_unknown',
];

export interface LocalSentReceipt {
  readonly messageId: string;
  readonly message: string;
  readonly state: SteeringQueueItemState;
  /** Author of the message; null for an unauthenticated/no-identity caller. */
  readonly operatorUserId: string | null;
}

export interface PendingSubmission {
  readonly messageId: string;
  readonly message: string;
}

export interface SteeringRefusal {
  /** Server error code; null when the request never reached a typed refusal. */
  readonly code: string | null;
  readonly message: string;
}

/** The agent's projected sub-state inside a still-running node. */
export type SteeringSubState = 'generating' | 'idle-after-interrupt';

export interface NeverSentEntry {
  /** Null only for a raw unsent draft that never received a message id. */
  readonly messageId: string | null;
  readonly message: string;
}

/** Durable capability + settings snapshot carried on every queue read. */
export type SteeringExecutionState = 'live' | 'recovery_required' | 'finished';

export interface SteeringDockState {
  /** Projected agent sub-state; null means a live queue-only handle. */
  readonly subState: SteeringSubState | null;
  /** Durable pending entries (`queued`/`awaiting_send_now`/`dispatching`/`delivery_unknown`). */
  readonly sent: readonly LocalSentReceipt[];
  /**
   * Durable `never_sent` rows read straight from the server. `null` until a
   * queue snapshot has been observed at least once; `[]` means the server
   * confirmed there are none. The operator's own current draft is folded in
   * at render time (see the finished-mode render path) — it is never stored
   * here, because the field is a live value, not a snapshot.
   */
  readonly neverSent: readonly NeverSentEntry[] | null;
  /** Last observed queue-read execution state; null until the first snapshot. */
  readonly executionState: SteeringExecutionState | null;
  /** Durable auto-send setting, from the last observed queue snapshot. */
  readonly autoSend: boolean;
  /** Verified soft-injection capability of the live provider, if known. */
  readonly softInjection: boolean;
  /** A send (Queue or Send now) request is in flight. */
  readonly sendInFlight: boolean;
  /** UI-local Stop press in flight; never projected or persisted. */
  readonly interruptInFlight: boolean;
  /**
   * Displayed accepted receipts plus the new Send-now draft, snapshotted when
   * submission began. Cleared from the visible band optimistically and
   * restored in order on failure. Only the draft's id is ever posted.
   */
  readonly inFlightBatch: readonly LocalSentReceipt[] | null;
  readonly pendingRetry: PendingSubmission | null;
  readonly refusal: SteeringRefusal | null;
  /** Text for the single polite role="status" region, set per transition. */
  readonly notice: string | null;
  /**
   * The one in-flight withdraw. A single active id is deliberate: the dock
   * has one refusal channel and one focus transfer, and simultaneous deletes
   * would let response order decide focus or let one success erase another
   * request's failure. The brief dock-wide delete guard never blocks send.
   */
  readonly withdrawingMessageId: string | null;
  /**
   * The one in-flight per-item Send now. Same one-active-id
   * rationale as `withdrawingMessageId`, and mutually exclusive with it in
   * practice since both act on the same queued row.
   */
  readonly sendingNowMessageId: string | null;
  /**
   * Local queue-mutation counter, starting at 0. Every resolved send or
   * withdraw bumps it; a queue snapshot carries the generation captured when
   * its request fired, so a snapshot that predates this tab's latest mutation
   * is discarded instead of briefly resurrecting a row the operator just
   * withdrew or dropping one they just sent.
   */
  readonly queueGeneration: number;
  /**
   * Every message id's last-observed delivery state from the durable queue
   * read, covering every row the server returned for this node — not just
   * the pending band `sent` tracks, since a `sent`/`delivered` row is
   * exactly the evidence a transcript operator row's delivery label needs.
   * Empty until the first snapshot.
   */
  readonly deliveryByMessageId: ReadonlyMap<string, SteeringQueueItemState>;
}

export type SteeringDockMode =
  | 'hidden'
  | 'blocked'
  | 'detached'
  | 'recovery-required'
  | 'composer'
  | 'finished-iteration'
  | 'finished';

/** The agent sub-state the dock renders — interrupting is UI-local only. */
export type SteeringAgentMode = 'queue-only' | 'generating' | 'interrupting' | 'idle';

export const STEERING_ASK_BLOCKED_REASON = "answer the agent's question first";
export const STEERING_DETACHED_DISCLOSURE =
  'not steerable here · this run was started detached, so its live session is not in this process';
export const STEERING_SEND_HINT = 'Cmd/Ctrl+Enter to send · saved for you';
export const STEERING_SEND_FAILED_MESSAGE = "couldn't send · back in the queue";
export const STEERING_INTERRUPT_FAILED_MESSAGE = "couldn't interrupt · try again";
export const STEERING_INTERRUPT_DISCLOSURE =
  'stopped after the last completed tool call · files already written stay written';
export const STEERING_AGENT_INTERRUPTING = 'agent interrupting';
export const STEERING_AGENT_IDLE = 'agent idle · Send now delivers';
export const STEERING_AGENT_GENERATING = 'agent generating';
export const STEERING_NEVER_SENT_DISCLOSURE = 'node finished · none of this was sent';
/** Idle-after-interrupt inactivity bound disclosure. */
export const STEERING_IDLE_AWAIT_DISCLOSURE =
  'no redirect ends this node after 30 min of inactivity · typing keeps it open';
/**
 * Terminal never-sent alert when the node failed for idle-await expiry
 * Other terminal causes keep STEERING_NEVER_SENT_DISCLOSURE.
 */
export const STEERING_NEVER_SENT_IDLE_EXPIRED_DISCLOSURE =
  'node failed · interrupted with no redirect · none of this was sent';
/**
 * Intentional package-boundary mirror of the engine's IDLE_AWAIT_EXPIRED_ERROR.
 * Web must not import @archon/workflows; the E2E guards the duplicated string.
 */
export const IDLE_AWAIT_EXPIRED_ERROR = 'interrupted by operator, no redirect received';
/** Leading-plus-trailing keepalive coalescer window (ms). */
export const STEERING_KEEPALIVE_COALESCE_MS = 30_000;

/** Select the never-sent alert copy for the exact idle-await expiry cause. */
export function neverSentDisclosure(idleAwaitExpired: boolean): string {
  return idleAwaitExpired
    ? STEERING_NEVER_SENT_IDLE_EXPIRED_DISCLOSURE
    : STEERING_NEVER_SENT_DISCLOSURE;
}

/** Exact finished-iteration disclosure; N is the proven live iteration. */
export function finishedIterationDisclosure(liveIteration: number): string {
  return `reading a finished iteration · the agent is working in iteration ${String(liveIteration)}`;
}

/** Exact Go control label for the finished-iteration dock. */
export function goToIterationLabel(liveIteration: number): string {
  return `Go to iteration ${String(liveIteration)}`;
}

const STEERING_NOT_STEERABLE_CODE = 'not_steerable_here';

/**
 * Restart-recovery band copy. A live provider process does not
 * survive a server restart; the durable draft and queue do, read-only, until
 * the operator invokes the existing workflow Resume action.
 */
export const STEERING_RECOVERY_DISCLOSURE =
  'restored after server restart · Resume the workflow to continue';

/**
 * Visibility/block precedence: a nonempty never-sent result with explicit
 * node-terminal evidence, OR the run itself no longer live, selects finished
 * first (so Cancel that flips the run non-live after observation still
 * surfaces recovery); otherwise a non-live run hides the dock entirely; a
 * proven finished-iteration descriptor wins before the terminal-row hide
 * check so a completed occurrence on a still-live loop can surface the
 * read-only dock; otherwise a non-generating row hides the dock
 * (historical/cold executions must never issue a request); a real pending
 * ask keeps its blocked reason even when a refusal is stored — no request
 * should have been made from that state; only then does a stored 422
 * `not_steerable_here` flip the dock to the detached disclosure.
 *
 * `neverSent` is the caller's render-time union of the server's durable
 * `never_sent` rows, the still-pending queue, and the operator's own
 * still-unsent draft text — never a client-side ledger. `finished` still
 * requires nonempty `neverSent`, so a terminal (or non-live) node with
 * nothing undelivered and a blank draft correctly falls through to hidden —
 * matching "no dock at all" once nothing survives to show. A cold-opened
 * terminal run reaches this mode as soon as its one-shot queue/draft reads
 * land, not only when a live session was mounted throughout.
 *
 * The run going non-live (Cancel/Abandon) qualifies for `finished` the same
 * way `nodeTerminal` does, because sending is impossible either way: an
 * abandoned run's still-queued item is exactly as undeliverable as a proven
 * `never_sent` row, and the read-only band must not vanish for the window
 * between the run leaving `live` and the node's own terminal event landing.
 *
 * An explicit `recoveryRequired` signal (server restart) is checked
 * before the terminal and liveness checks: it comes from the server telling
 * the client the live process is gone, not from a guess this code makes, so
 * it overrides what `live`/`rowStatus` would otherwise imply.
 */
export function steeringDockMode(input: {
  rowStatus: string;
  live: boolean;
  hasPendingAsk: boolean;
  refusal: SteeringRefusal | null;
  finishedIteration?: FinishedIterationView | null;
  neverSent?: readonly NeverSentEntry[] | null;
  nodeTerminal?: boolean;
  recoveryRequired?: boolean;
}): SteeringDockMode {
  if (input.recoveryRequired === true) return 'recovery-required';
  if (
    (input.nodeTerminal === true || !input.live) &&
    input.neverSent !== null &&
    input.neverSent !== undefined &&
    input.neverSent.length > 0
  ) {
    return 'finished';
  }
  if (!input.live) return 'hidden';
  if (input.finishedIteration !== null && input.finishedIteration !== undefined) {
    return 'finished-iteration';
  }
  if (input.rowStatus !== 'running' && input.rowStatus !== 'awaiting') return 'hidden';
  if (steeringBlockedReason(input) !== null) return 'blocked';
  if (input.refusal?.code === STEERING_NOT_STEERABLE_CODE) return 'detached';
  return 'composer';
}

/** A pending ask or an `awaiting` row blocks send before transport. */
export function steeringBlockedReason(input: {
  rowStatus: string;
  hasPendingAsk: boolean;
}): string | null {
  return input.rowStatus === 'awaiting' || input.hasPendingAsk ? STEERING_ASK_BLOCKED_REASON : null;
}

/**
 * Derived control anatomy: a missing projected sub-state is queue-only (not
 * detached); a defined projection or a local Stop press drives the rest.
 */
export function steeringAgentMode(input: {
  subState: SteeringSubState | null;
  interruptInFlight: boolean;
}): SteeringAgentMode {
  if (input.interruptInFlight) return 'interrupting';
  if (input.subState === 'generating') return 'generating';
  if (input.subState === 'idle-after-interrupt') return 'idle';
  return 'queue-only';
}

/**
 * The single guard shared by Queue, Send now, and the keyboard shortcut:
 * no send in flight, composer mode, and either a non-blank draft or (Send
 * now only, `agentMode === 'idle'`) at least one already-claimable queued
 * item — a blank Send now still delivers everything waiting (CAP-10).
 * `interrupting` does NOT block Queue — a message sent in the race waits
 * for Send now.
 */
export function canSubmitGuidance(input: {
  mode: SteeringDockMode;
  sendInFlight: boolean;
  draft: string;
  agentMode: SteeringAgentMode;
  willSendCount: number;
}): boolean {
  if (input.mode !== 'composer' || input.sendInFlight) return false;
  if (input.draft.trim().length > 0) return true;
  return input.agentMode === 'idle' && input.willSendCount > 0;
}

export interface SteeringShortcutEvent {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly isComposing: boolean;
  readonly keyCode: number;
}

/**
 * `Cmd`/`Ctrl`+`Enter` only — plain and Shift+Enter keep native newline
 * behavior. `isComposing` and key code 229 both guard IME composition.
 */
export function isQueueShortcut(event: SteeringShortcutEvent): boolean {
  return (
    event.key === 'Enter' &&
    (event.metaKey || event.ctrlKey) &&
    !event.isComposing &&
    event.keyCode !== 229
  );
}

/**
 * True when a keydown should count as composer activity for keepalive.
 * Only the exact Cmd/Ctrl+Enter submit shortcut is excluded — plain Enter,
 * navigation, and IME composition all remain eligible.
 */
export function isKeepaliveActivityKey(event: SteeringShortcutEvent): boolean {
  return !isQueueShortcut(event);
}

/**
 * Scope key identifying one (run, node) draft/queue pair. The draft and
 * queue are both durable and server-scoped by `(runId, nodeId)` only — never
 * per execution attempt — so this key drives attempt-reset detection but no
 * longer names a storage slot.
 */
export function steeringScopeKey(runId: string, nodeId: string): string {
  return `${runId}:${nodeId}`;
}

export function queuedCountPhrase(count: number): string {
  return count === 1 ? '1 message queued' : `${count.toString()} messages queued`;
}

export function willSendCountPhrase(count: number): string {
  return count === 1 ? '1 message will send' : `${count.toString()} messages will send`;
}

/** Lowercase DOM text; the renderer applies CSS uppercase + phase tracking. */
export function queueBandHeader(count: number): string {
  return `queued · ${count.toString()}`;
}

export function willSendBandHeader(count: number): string {
  return `will send · ${count.toString()}`;
}

export function queueListLabel(count: number): string {
  return `Queued messages, ${count.toString()}`;
}

export function willSendListLabel(count: number): string {
  return `Will send, ${count.toString()}`;
}

/** Lowercase DOM text; the renderer applies CSS uppercase + phase tracking. */
export function sendingBandHeader(count: number): string {
  return `sending · ${count.toString()}`;
}

export function sendingListLabel(count: number): string {
  return `Sending, ${count.toString()}`;
}

/**
 * True when every visible pending row is actively dispatching — a send
 * request in flight, never a claimable queued row. The band header must
 * never contradict the rows listed under it: `queued · 0` above a visible
 * `sending…` row claims nothing is happening while something plainly is.
 * `pendingQueueCount` already excludes `dispatching` from its count for the
 * same reason — this is the header-selection counterpart of that exclusion.
 */
export function allPendingDispatching(sent: readonly LocalSentReceipt[]): boolean {
  return sent.length > 0 && sent.every(receipt => receipt.state === 'dispatching');
}

/**
 * The live queue band's persistence line: the draft and queue
 * are server-persisted, so this always renders while the band is live.
 * `Auto-send on` reports the durable per-node setting from the last observed
 * queue snapshot; it appends only when the caller confirms it is on.
 */
export function savedToServerLine(autoSendEnabled: boolean): string {
  return autoSendEnabled ? 'saved to server · Auto-send on' : 'saved to server';
}

/** Lowercase DOM source heading; the renderer applies CSS uppercase tracking. */
export function neverSentBandHeader(count: number): string {
  return `never sent · ${count.toString()}`;
}

export function neverSentListLabel(count: number): string {
  return `Never sent, ${count.toString()}`;
}

export function queueButtonAccessibleName(count: number): string {
  return `Queue · Cmd/Ctrl+Enter to send · ${queuedCountPhrase(count)}`;
}

export function sendNowButtonAccessibleName(count: number): string {
  return `Send now · Cmd/Ctrl+Enter to send · ${willSendCountPhrase(count)}`;
}

/** A queue item can be withdrawn or soft-injected only while still claimable. */
export function isQueueItemClaimable(state: SteeringQueueItemState): boolean {
  return STEERING_QUEUE_CLAIMABLE_STATES.includes(state);
}

/**
 * The count a "queued · N" / "will send · N" band header states — every
 * pending entry except one already `dispatching`. control-states.md lists
 * `queued` and `dispatching` as distinct states: a message already being
 * delivered is not waiting, so counting it as queued misreports what is
 * actually happening (a provider whose delivery takes several seconds, not
 * the sub-second case this once assumed, made that reading visible). The
 * dispatching entry still renders in the list, labelled by
 * `queueItemStatusLabel`, so nothing disappears — it just is not counted
 * twice as "queued" and "in flight" at once.
 */
export function pendingQueueCount(sent: readonly LocalSentReceipt[]): number {
  return sent.filter(receipt => receipt.state !== 'dispatching').length;
}

/**
 * Per-item delivery label for a pending queue row. `queued`/`awaiting_send_now`
 * render with no label at all, matching the approved mockup's plain rows.
 * `dispatching` and `delivery_unknown` are the two pending states that must
 * never render silently as a plain queued row — control-states.md lists
 * `dispatching` as its own state, and a verified provider can take several
 * real seconds to accept a dispatched message, not the sub-second window
 * this once assumed. `sent`/`delivered`/`never_sent` never reach this
 * helper: once delivered the message is a transcript row, and never-sent
 * rows use their own band.
 */
export function queueItemStatusLabel(state: SteeringQueueItemState): string | null {
  if (state === 'delivery_unknown') return 'delivery unknown';
  if (state === 'dispatching') return 'sending…';
  return null;
}

export function createSteeringDockState(subState?: SteeringSubState): SteeringDockState {
  return {
    subState: subState ?? null,
    sent: [],
    neverSent: null,
    executionState: null,
    autoSend: false,
    softInjection: false,
    sendInFlight: false,
    interruptInFlight: false,
    inFlightBatch: null,
    pendingRetry: null,
    refusal: null,
    notice: null,
    withdrawingMessageId: null,
    sendingNowMessageId: null,
    queueGeneration: 0,
    deliveryByMessageId: new Map(),
  };
}

/**
 * Fold the projected sub-state into dock state. A defined projection is
 * authoritative and supersedes the local interrupting transient; an absent
 * projection only means queue-only — never a detached verdict — so the
 * transient survives until the caller's own interrupt response lands.
 */
export function syncProjectedSubState(
  state: SteeringDockState,
  projected: SteeringSubState | undefined
): SteeringDockState {
  const next = projected ?? null;
  if (state.subState === next) return state;
  return {
    ...state,
    subState: next,
    interruptInFlight: projected === undefined ? state.interruptInFlight : false,
    notice:
      next === 'idle-after-interrupt'
        ? STEERING_AGENT_IDLE
        : next === 'generating'
          ? STEERING_AGENT_GENERATING
          : state.notice,
  };
}

/**
 * Stamp one UUID per submission. An unchanged draft after an ambiguous
 * failure reuses the stored id; editing the draft mints a new one.
 */
export function beginGuidanceSubmission(
  state: SteeringDockState,
  draft: string,
  newId: () => string = () => crypto.randomUUID()
): { state: SteeringDockState; messageId: string } {
  const pendingRetry =
    state.pendingRetry !== null && state.pendingRetry.message === draft
      ? state.pendingRetry
      : { messageId: newId(), message: draft };
  return {
    state: { ...state, sendInFlight: true, pendingRetry },
    messageId: pendingRetry.messageId,
  };
}

/**
 * 200 appends once by `message_id`, in acceptance order — a replayed success
 * never duplicates the row. Clears the pending retry and any stored refusal.
 * The next queue poll reconciles the exact server state; this optimistic
 * entry only bridges the gap until it does.
 */
export function resolveGuidanceSuccess(
  state: SteeringDockState,
  receipt: { message_id: string; state?: SteeringQueueItemState }
): SteeringDockState {
  // A replayed success never duplicates the row but still bumps
  // `queueGeneration`, because the server accepted the mutation either way.
  // An active withdraw id is preserved across send resolve.
  const existing = state.sent.find(entry => entry.messageId === receipt.message_id);
  if (existing !== undefined) {
    return {
      ...state,
      sendInFlight: false,
      pendingRetry: null,
      refusal: null,
      withdrawingMessageId: state.withdrawingMessageId,
      queueGeneration: state.queueGeneration + 1,
    };
  }
  const accepted: LocalSentReceipt = {
    messageId: receipt.message_id,
    message: state.pendingRetry?.message ?? '',
    state: receipt.state ?? 'queued',
    operatorUserId: null,
  };
  const sent = [...state.sent, accepted];
  return {
    ...state,
    sent,
    sendInFlight: false,
    pendingRetry: null,
    refusal: null,
    withdrawingMessageId: state.withdrawingMessageId,
    queueGeneration: state.queueGeneration + 1,
    notice: queuedCountPhrase(sent.length),
  };
}

/** A failed submission keeps the pending retry so unchanged text reuses it. */
export function resolveGuidanceFailure(
  state: SteeringDockState,
  refusal: SteeringRefusal
): SteeringDockState {
  return { ...state, sendInFlight: false, refusal };
}

/**
 * Send now: snapshot the displayed accepted receipts plus the new draft into
 * the batch and clear the visible band optimistically, so nothing looks
 * pickable twice. Only the new draft posts (with its stable retry UUID);
 * earlier items already exist in the server registry. A blank draft (CAP-10:
 * deliver everything already queued, with nothing newly typed) carries a
 * retry id for response correlation but adds no placeholder row — there is
 * no new message to display.
 */
export function beginSendNow(
  state: SteeringDockState,
  draft: string,
  newId: () => string = () => crypto.randomUUID()
): { state: SteeringDockState; messageId: string } {
  const previousPending = state.pendingRetry;
  const pendingRetry =
    previousPending !== null && previousPending.message === draft
      ? previousPending
      : { messageId: newId(), message: draft };
  // Editing a failed Send-now draft replaces its optimistic display row. An
  // unchanged retry keeps the same row/id, while server-accepted receipts are
  // never removed or re-posted.
  const displayedReceipts =
    previousPending !== null && previousPending.message !== draft
      ? state.sent.filter(entry => entry.messageId !== previousPending.messageId)
      : state.sent;
  const isBlankDraft = draft.trim().length === 0;
  const inFlightBatch =
    isBlankDraft || displayedReceipts.some(entry => entry.messageId === pendingRetry.messageId)
      ? displayedReceipts
      : [
          ...displayedReceipts,
          {
            messageId: pendingRetry.messageId,
            message: pendingRetry.message,
            state: 'awaiting_send_now' as const,
            operatorUserId: null,
          },
        ];
  return {
    state: {
      ...state,
      sendInFlight: true,
      inFlightBatch,
      sent: [],
      pendingRetry,
      refusal: null,
    },
    messageId: pendingRetry.messageId,
  };
}

/**
 * Send-now success: the batch is discarded (server drained it), the sub-state
 * derives generating, and one composite announcement lands. A replayed
 * success after settlement is a no-op — the band never reappears.
 */
export function resolveSendNowSuccess(
  state: SteeringDockState,
  receipt: { message_id: string; state: SteeringQueueItemState }
): SteeringDockState {
  if (!state.sendInFlight || state.inFlightBatch === null) return state;
  if (state.pendingRetry?.messageId !== receipt.message_id) return state;
  // A Queue request with an ambiguous response may be retried after the node
  // becomes idle. Idempotency replays its original `queued` receipt and cannot
  // release the idle waiter. Keep the resolved message in Will send and require
  // a genuinely new draft instead of falsely showing generating or duplicating
  // the original content under a new id.
  if (receipt.state === 'queued') {
    return {
      ...state,
      sent: state.inFlightBatch,
      sendInFlight: false,
      inFlightBatch: null,
      pendingRetry: null,
      refusal: null,
      queueGeneration: state.queueGeneration + 1,
      notice: willSendCountPhrase(state.inFlightBatch.length),
    };
  }
  return {
    ...state,
    sendInFlight: false,
    inFlightBatch: null,
    pendingRetry: null,
    refusal: null,
    subState: 'generating',
    queueGeneration: state.queueGeneration + 1,
    notice: STEERING_AGENT_GENERATING,
  };
}

/**
 * Ambiguous Send-now failure: snapshotted receipts return to the front in
 * original order (including the new message), the new message keeps its retry
 * id, and the dock stays idle — an alert, not the polite region, carries the
 * failure.
 */
export function resolveSendNowFailure(
  state: SteeringDockState,
  refusal: SteeringRefusal
): SteeringDockState {
  return {
    ...state,
    sendInFlight: false,
    sent: [...(state.inFlightBatch ?? []), ...state.sent],
    inFlightBatch: null,
    refusal,
  };
}

/** One Stop press: local interrupting + exactly one polite announcement. */
export function beginInterrupt(state: SteeringDockState): SteeringDockState {
  return { ...state, interruptInFlight: true, notice: STEERING_AGENT_INTERRUPTING };
}

/**
 * Settled interrupt: the response's ACTUAL sub-state wins. `generating`
 * means the turn ended naturally or the queue auto-drained — a composite
 * announcement carries the drained count and no interrupted row is faked.
 */
export function resolveInterruptOutcome(
  state: SteeringDockState,
  outcome: SteeringSubState
): SteeringDockState {
  return {
    ...state,
    interruptInFlight: false,
    subState: outcome,
    notice:
      outcome === 'idle-after-interrupt'
        ? STEERING_AGENT_IDLE
        : `turn ended before stop · ${state.sent.length.toString()} sent · ${STEERING_AGENT_GENERATING}`,
  };
}

/**
 * Interrupt refusal: the transient clears, the draft/receipts survive, and
 * the refusal renders through the same alert path sends already use —
 * 409 `node_finished` waits on the authoritative row state, 422 flips the
 * dock to the detached disclosure, other failures return to generating.
 */
export function resolveInterruptError(
  state: SteeringDockState,
  refusal: SteeringRefusal
): SteeringDockState {
  return { ...state, interruptInFlight: false, refusal };
}

/**
 * Begin the single allowed withdraw. Sets the id only when the receipt is in
 * `sent` and no other withdraw is active; anything else is a same-state
 * no-op. Never alters send state or the stored refusal.
 */
export function beginWithdraw(state: SteeringDockState, messageId: string): SteeringDockState {
  if (state.withdrawingMessageId !== null) return state;
  if (!state.sent.some(entry => entry.messageId === messageId)) return state;
  return { ...state, withdrawingMessageId: messageId };
}

/**
 * A withdraw 200 removes exactly that receipt (sibling order and send state
 * preserved) and clears the active id plus any stored refusal. The generation
 * bumps even when a snapshot already removed the row — the server confirmed
 * the mutation either way. A stale or mismatched completion is a no-op.
 */
export function resolveWithdrawSuccess(
  state: SteeringDockState,
  messageId: string
): SteeringDockState {
  if (state.withdrawingMessageId !== messageId) return state;
  const sent = state.sent.filter(entry => entry.messageId !== messageId);
  return {
    ...state,
    sent,
    withdrawingMessageId: null,
    refusal: null,
    queueGeneration: state.queueGeneration + 1,
    notice:
      sent.length === 0
        ? state.subState === 'idle-after-interrupt'
          ? STEERING_AGENT_IDLE
          : state.subState === 'generating'
            ? STEERING_AGENT_GENERATING
            : null
        : sent.some(entry => entry.state === 'awaiting_send_now')
          ? willSendCountPhrase(sent.length)
          : queuedCountPhrase(sent.length),
  };
}

/**
 * A failed withdraw retains every row and all send state, clears the
 * matching active id, and stores the refusal. Mismatched id is a no-op.
 */
export function resolveWithdrawFailure(
  state: SteeringDockState,
  messageId: string,
  refusal: SteeringRefusal
): SteeringDockState {
  if (state.withdrawingMessageId !== messageId) return state;
  return { ...state, withdrawingMessageId: null, refusal };
}

/**
 * Begin the single allowed per-item Send now. Same shape as
 * `beginWithdraw` — sets the id only when the row is present and no other
 * per-item send is active.
 */
export function beginSendNowItem(state: SteeringDockState, messageId: string): SteeringDockState {
  if (state.sendingNowMessageId !== null) return state;
  if (!state.sent.some(entry => entry.messageId === messageId)) return state;
  return { ...state, sendingNowMessageId: messageId };
}

/**
 * A per-item Send now 200 removes the row from the pending band — it is now
 * `sent` and will appear as a transcript row, not a queue entry. Stop is
 * never invoked and no interrupt/idle transition happens on this path.
 */
export function resolveSendNowItemSuccess(
  state: SteeringDockState,
  messageId: string
): SteeringDockState {
  if (state.sendingNowMessageId !== messageId) return state;
  return {
    ...state,
    sent: state.sent.filter(entry => entry.messageId !== messageId),
    sendingNowMessageId: null,
    refusal: null,
    queueGeneration: state.queueGeneration + 1,
  };
}

/** A failed per-item Send now retains the row and stores the refusal. */
export function resolveSendNowItemFailure(
  state: SteeringDockState,
  messageId: string,
  refusal: SteeringRefusal
): SteeringDockState {
  if (state.sendingNowMessageId !== messageId) return state;
  return { ...state, sendingNowMessageId: null, refusal };
}

export const STEERING_DELETE_LABEL = '✕';
/** Visible label for the per-item soft-injection control. */
export const STEERING_SEND_NOW_ITEM_LABEL = 'Send now';

/**
 * Accessible name for the per-row delete control. The visible text stays
 * `delete`; the name identifies the specific message so the action is
 * unambiguous. Outer whitespace is trimmed.
 */
export function deleteButtonAccessibleName(message: string): string {
  return `delete · ${message.trim()}`;
}

/**
 * Accessible name for the per-item Send now control. Present only on a
 * queued item, only while a verified soft-injection transport can accept it
 * mid-turn — a queue-only provider never renders this control at all.
 */
export function sendNowItemAccessibleName(message: string): string {
  return `Send now · ${message.trim()}`;
}

export type RemovalFocusTarget =
  | { readonly kind: 'delete'; readonly messageId: string }
  | { readonly kind: 'field' };

/**
 * Where focus goes after a queued row is removed: the next row's delete
 * button in the activation-time order, otherwise the previous row's,
 * otherwise the composer field. An unknown id resolves to the field.
 */
export function nextFocusAfterRemoval(
  orderedIds: readonly string[],
  removedId: string
): RemovalFocusTarget {
  const index = orderedIds.indexOf(removedId);
  if (index === -1) return { kind: 'field' };
  const sibling = orderedIds[index + 1] ?? orderedIds[index - 1];
  return sibling === undefined ? { kind: 'field' } : { kind: 'delete', messageId: sibling };
}

/** One queued-guidance row exactly as the GET queue route returns it. */
export interface QueuedGuidanceRow {
  readonly message_id: string;
  readonly message: string;
  /** Author of the message; null for an unauthenticated/no-identity caller. */
  readonly operator_user_id: string | null;
  readonly state: SteeringQueueItemState;
}

/** The queue-read wire payload — the durable node queue in server FIFO order. */
export interface QueueSnapshot {
  readonly execution_state: SteeringExecutionState;
  readonly auto_send: boolean;
  readonly capabilities: { readonly soft_injection: boolean; readonly delivery_ack: boolean };
  readonly queued: readonly QueuedGuidanceRow[];
}

/**
 * Reconcile the rendered queue with the server's authoritative order. A
 * generation mismatch returns the identical state object — the snapshot
 * predates this tab's latest resolved mutation and must not resurrect or
 * drop rows. On match:
 *
 * - `sent` is replaced wholesale with the durable pending rows (`queued`,
 *   `awaiting_send_now`, `dispatching`, `delivery_unknown`) in server order.
 *   A `sent`/`delivered` row is dropped from this band — it is now a
 *   transcript row, not a queue entry — and never resurrected.
 * - `neverSent` is replaced wholesale with the durable `never_sent` rows.
 *   This is the sole source: a node opened cold, well after it
 *   went terminal, still learns exactly what was never delivered, because
 *   the server — not this tab's history — is what remembers.
 * - `executionState`, `autoSend`, and `softInjection` mirror the snapshot.
 *
 * `sendInFlight`, `pendingRetry`, `refusal`, `withdrawingMessageId`,
 * `sendingNowMessageId`, and `queueGeneration` are preserved exactly.
 * Identical content returns the identical state object so React skips a
 * render. The draft and a stored refusal are never touched — the server has
 * no opinion on either.
 */
export function applyQueueSnapshot(
  state: SteeringDockState,
  snapshot: QueueSnapshot,
  generationAtRequest: number
): SteeringDockState {
  if (generationAtRequest !== state.queueGeneration) return state;
  const nextSent: LocalSentReceipt[] = snapshot.queued
    .filter(row => STEERING_QUEUE_PENDING_STATES.includes(row.state))
    .map(row => ({
      messageId: row.message_id,
      message: row.message,
      state: row.state,
      operatorUserId: row.operator_user_id,
    }));
  const nextNeverSent: NeverSentEntry[] = snapshot.queued
    .filter(row => row.state === 'never_sent')
    .map(row => ({ messageId: row.message_id, message: row.message }));
  const nextDeliveryByMessageId = new Map(
    snapshot.queued.map(row => [row.message_id, row.state] as const)
  );

  const sentUnchanged =
    nextSent.length === state.sent.length &&
    nextSent.every(
      (row, i) =>
        row.messageId === state.sent[i].messageId &&
        row.message === state.sent[i].message &&
        row.state === state.sent[i].state &&
        row.operatorUserId === state.sent[i].operatorUserId
    );
  const neverSentUnchanged =
    state.neverSent !== null &&
    nextNeverSent.length === state.neverSent.length &&
    nextNeverSent.every(
      (row, i) =>
        row.messageId === state.neverSent?.[i]?.messageId &&
        row.message === state.neverSent[i]?.message
    );
  const deliveryUnchanged =
    nextDeliveryByMessageId.size === state.deliveryByMessageId.size &&
    [...nextDeliveryByMessageId].every(
      ([messageId, deliveryState]) => state.deliveryByMessageId.get(messageId) === deliveryState
    );
  const unchanged =
    sentUnchanged &&
    neverSentUnchanged &&
    deliveryUnchanged &&
    state.executionState === snapshot.execution_state &&
    state.autoSend === snapshot.auto_send &&
    state.softInjection === snapshot.capabilities.soft_injection;
  if (unchanged) return state;

  return {
    ...state,
    sent: sentUnchanged ? state.sent : nextSent,
    neverSent: neverSentUnchanged ? state.neverSent : nextNeverSent,
    deliveryByMessageId: deliveryUnchanged ? state.deliveryByMessageId : nextDeliveryByMessageId,
    executionState: snapshot.execution_state,
    autoSend: snapshot.auto_send,
    softInjection: snapshot.capabilities.soft_injection,
  };
}

/**
 * Where focus goes after a snapshot replaces the queue. Returns null when
 * nothing was focused or the focused row survived — no DOM move is needed.
 * When another operator/tab withdrew the focused row, pick the nearest
 * surviving next id in the pre-snapshot order, then the nearest surviving
 * previous id, then the composer field — skipping siblings removed by the
 * same snapshot. Never returns a `<body>` target: a moved focus always
 * lands on an explicit destination.
 */
export function focusTargetAfterSnapshot(
  previousIds: readonly string[],
  nextIds: readonly string[],
  focusedMessageId: string | null
): RemovalFocusTarget | null {
  if (focusedMessageId === null) return null;
  if (nextIds.includes(focusedMessageId)) return null;
  const index = previousIds.indexOf(focusedMessageId);
  if (index === -1) return { kind: 'field' };
  for (let i = index + 1; i < previousIds.length; i++) {
    if (nextIds.includes(previousIds[i])) return { kind: 'delete', messageId: previousIds[i] };
  }
  for (let i = index - 1; i >= 0; i--) {
    if (nextIds.includes(previousIds[i])) return { kind: 'delete', messageId: previousIds[i] };
  }
  return { kind: 'field' };
}

export interface QueuePollingOptions {
  /** One queue read; resolves with the wire payload, rejects on any failure. */
  readonly read: (signal: AbortSignal) => Promise<QueueSnapshot>;
  /** The dock's current `queueGeneration`, sampled as each request fires. */
  readonly currentGeneration: () => number;
  /**
   * Receives each 200 payload plus the generation captured when its request
   * fired — the pair `applyQueueSnapshot` needs to discard a stale read.
   */
  readonly onSnapshot: (snapshot: QueueSnapshot, generationAtRequest: number) => void;
  /**
   * Optional per-failure hook for read-only renderers. Invoked once with the
   * normalized error before the existing retry/stop decision. Omitted callers
   * keep today's behavior unchanged.
   */
  readonly onError?: (error: SteeringRequestError) => void;
  /** Reconcile cadence (~1s in the docks). */
  readonly intervalMs: number;
  readonly setTimer?: typeof setTimeout;
  readonly clearTimer?: typeof clearTimeout;
}

/**
 * Framework-free queue reconcile loop: fires one read immediately, then
 * schedules the next read only after the current promise settles — requests
 * never overlap. Each request samples `currentGeneration` at fire time and
 * hands it to `onSnapshot` so the caller can discard a stale read.
 * Synchronous throws and rejections both normalize through
 * `toSteeringRequestError`; optional `onError` receives that error once before
 * the retry/stop decision. 422, transport (0), and 5xx reschedule; any other
 * 4xx stops the loop without a snapshot callback. The returned cleanup aborts
 * the in-flight request, clears the pending timer, and suppresses every late
 * settle — an abort caused by stop() never schedules a retry.
 */
export function startQueuePolling(options: QueuePollingOptions): () => void {
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  let stopped = false;
  let epoch = 0;
  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = (): void => {
    if (stopped) return;
    timer = setTimer(tick, options.intervalMs);
  };

  const tick = (): void => {
    if (stopped) return;
    const myEpoch = ++epoch;
    const generationAtRequest = options.currentGeneration();
    const request = new AbortController();
    controller = request;

    const settle = (error: unknown): void => {
      if (stopped || epoch !== myEpoch) return;
      controller = null;
      const normalized = toSteeringRequestError(error);
      options.onError?.(normalized);
      const status = normalized.status;
      const retryable = status === 422 || status === 0 || status >= 500;
      if (!retryable) {
        stopped = true;
        return;
      }
      schedule();
    };

    let payload: Promise<QueueSnapshot>;
    try {
      payload = options.read(request.signal);
    } catch (error: unknown) {
      settle(error);
      return;
    }
    void payload.then(
      snapshot => {
        if (stopped || epoch !== myEpoch) return;
        controller = null;
        options.onSnapshot(snapshot, generationAtRequest);
        schedule();
      },
      (error: unknown) => {
        settle(error);
      }
    );
  };

  tick();

  return () => {
    stopped = true;
    epoch++;
    controller?.abort();
    controller = null;
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  };
}

export interface KeepaliveCoalescerOptions {
  /** Fire one keepalive; may return a promise. Rejection is swallowed. */
  readonly send: () => unknown;
  /** Injectable clock for deterministic tests. Defaults to Date.now. */
  readonly now?: () => number;
  readonly setTimer?: typeof setTimeout;
  readonly clearTimer?: typeof clearTimeout;
  /** Coalesce window; defaults to STEERING_KEEPALIVE_COALESCE_MS. */
  readonly windowMs?: number;
}

export interface KeepaliveCoalescer {
  /** Record eligible activity. Leading-plus-trailing within the window. */
  touch(): void;
  /** Cancel pending work and make late settles inert. */
  dispose(): void;
}

/**
 * Leading-plus-trailing keepalive coalescer. First eligible activity sends
 * immediately and opens a window; further activity inside the window schedules
 * exactly one trailing send at the boundary. Continuous activity never exceeds
 * one call per window, so the final keystroke is represented ≤ windowMs later
 * and never expires early from a leading-only throttle. dispose() cancels the
 * pending timer and suppresses in-flight completion side effects.
 */
export function createKeepaliveCoalescer(options: KeepaliveCoalescerOptions): KeepaliveCoalescer {
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  const windowMs = options.windowMs ?? STEERING_KEEPALIVE_COALESCE_MS;

  let disposed = false;
  let windowStartMs: number | null = null;
  let trailingDue = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;

  const clearPendingTimer = (): void => {
    if (timer === null) return;
    clearTimer(timer);
    timer = null;
  };

  const invokeSend = (): void => {
    if (disposed) return;
    trailingDue = false;
    clearPendingTimer();
    windowStartMs = now();
    const myGeneration = ++generation;
    let payload: unknown;
    try {
      payload = options.send();
    } catch {
      // Synchronous throw is a handled failure — window already opened.
      return;
    }
    void Promise.resolve(payload).then(
      () => {
        void myGeneration;
      },
      () => {
        // Rejection is intentional no-op: no UI mutation, no per-key retry.
        void myGeneration;
      }
    );
  };

  const scheduleTrailing = (): void => {
    if (disposed || windowStartMs === null) return;
    clearPendingTimer();
    const delay = Math.max(0, windowMs - (now() - windowStartMs));
    timer = setTimer((): void => {
      timer = null;
      if (disposed || !trailingDue) return;
      invokeSend();
    }, delay);
  };

  return {
    touch(): void {
      if (disposed) return;
      if (windowStartMs === null) {
        invokeSend();
        return;
      }
      if (now() - windowStartMs >= windowMs) {
        invokeSend();
        return;
      }
      trailingDue = true;
      if (timer === null) {
        scheduleTrailing();
      }
    },
    dispose(): void {
      disposed = true;
      trailingDue = false;
      windowStartMs = null;
      generation += 1;
      clearPendingTimer();
    },
  };
}

/**
 * Typed steering refusal surfaced by both API helpers on either steering
 * endpoint: carries the HTTP status plus the nested `error.code`/
 * `error.message` when the body held the canonical
 * `{success:false, error:{code,message}}` shape.
 */
export class SteeringRequestError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(status: number, code: string | null, message: string) {
    super(message);
    this.name = 'SteeringRequestError';
    this.status = status;
    this.code = code;
  }
}

function parseNestedSteeringError(
  bodyText: string
): { code: string | null; message: string | null } | null {
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (typeof parsed !== 'object' || parsed === null || !('error' in parsed)) return null;
    const nested = parsed.error;
    if (typeof nested !== 'object' || nested === null) return null;
    const code = 'code' in nested && typeof nested.code === 'string' ? nested.code : null;
    const message =
      'message' in nested && typeof nested.message === 'string' ? nested.message : null;
    return { code, message };
  } catch {
    return null;
  }
}

/**
 * Normalize any transport failure into a SteeringRequestError. Both API
 * layers embed the truncated error body differently: fetchJSON suffixes it
 * onto `Error.message` (`API error 422 (/path): {...}`) while the console's
 * HttpError exposes `bodySnippet`. A non-HTTP failure (offline fetch) has no
 * status and reports the given ambiguous-failure copy.
 */
export function toSteeringRequestError(
  error: unknown,
  ambiguousMessage: string = STEERING_SEND_FAILED_MESSAGE
): SteeringRequestError {
  if (error instanceof SteeringRequestError) return error;
  const status =
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number'
      ? error.status
      : 0;
  const messageText = error instanceof Error ? error.message : '';
  const bodyText =
    typeof error === 'object' &&
    error !== null &&
    'bodySnippet' in error &&
    typeof error.bodySnippet === 'string'
      ? error.bodySnippet
      : messageText.slice(Math.max(0, messageText.indexOf('{')));
  const nested = parseNestedSteeringError(bodyText);
  if (status === 0 && nested === null) {
    return new SteeringRequestError(0, null, ambiguousMessage);
  }
  return new SteeringRequestError(
    status,
    nested?.code ?? null,
    nested?.message ?? `Request failed (${status.toString()})`
  );
}

export function toSteeringRefusal(
  error: unknown,
  ambiguousMessage: string = STEERING_SEND_FAILED_MESSAGE
): SteeringRefusal {
  const normalized = toSteeringRequestError(error, ambiguousMessage);
  return { code: normalized.code, message: normalized.message };
}
