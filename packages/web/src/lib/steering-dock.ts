/**
 * Framework-free steering-dock logic shared by the Legacy and Console
 * composer renderers: visibility/blocked predicates, the guarded submit
 * transitions with stable retry ids, the interrupt/Send-now turn model,
 * live queue polling/withdraw reconciliation, sessionStorage draft
 * persistence, and the nested steering error surface both API helpers
 * normalize onto.
 */
import type { FinishedIterationView } from './execution-room-model';
import type { NodeMessageRow } from './node-message-pages';

export interface LocalSentReceipt {
  readonly messageId: string;
  readonly message: string;
  /** Wire-compatible display state (`queued | awaiting_send_now`). */
  readonly state: 'queued' | 'awaiting_send_now';
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

export interface SteeringDockState {
  /** Projected agent sub-state; null means a live queue-only handle. */
  readonly subState: SteeringSubState | null;
  readonly sent: readonly LocalSentReceipt[];
  /**
   * Every receipt this mounted attempt has observed, ordered by first
   * observation and deduplicated by messageId. Later snapshot omission never
   * erases entries; only this tab's confirmed withdraw removes one.
   */
  readonly observedLedger: readonly LocalSentReceipt[];
  /**
   * One-shot terminal reconciliation result. `null` until
   * `reconcileNeverSent` runs; `[]` means everything observed was written.
   */
  readonly neverSent: readonly NeverSentEntry[] | null;
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
   * Local queue-mutation counter, starting at 0. Every resolved send or
   * withdraw bumps it; a queue snapshot carries the generation captured when
   * its request fired, so a snapshot that predates this tab's latest mutation
   * is discarded instead of briefly resurrecting a row the operator just
   * withdrew or dropping one they just sent.
   */
  readonly queueGeneration: number;
}

export type SteeringDockMode =
  | 'hidden'
  | 'blocked'
  | 'detached'
  | 'composer'
  | 'finished-iteration'
  | 'finished';

/** The agent sub-state the dock renders — interrupting is UI-local only. */
export type SteeringAgentMode = 'queue-only' | 'generating' | 'interrupting' | 'idle';

export const STEERING_ASK_BLOCKED_REASON = "answer the agent's question first";
export const STEERING_DETACHED_DISCLOSURE =
  'not steerable here · this run was started detached, so its live session is not in this process';
export const STEERING_SEND_HINT = 'Cmd/Ctrl+Enter to send · this tab only';
export const STEERING_SEND_FAILED_MESSAGE = "couldn't send · back in the queue";
export const STEERING_INTERRUPT_FAILED_MESSAGE = "couldn't interrupt · try again";
export const STEERING_INTERRUPT_DISCLOSURE =
  'stopped after the last completed tool call · files already written stay written';
export const STEERING_IDLE_INACTIVITY_DISCLOSURE =
  'no redirect ends this node after 30 min of inactivity · typing keeps it open';
export const STEERING_IDLE_TIMEOUT_FAILURE_TEXT =
  'interrupted by operator, no redirect received · failed after 30-minute idle timeout';
export const STEERING_IDLE_TIMEOUT_STATUS =
  'node failed · interrupted with no redirect · none of this was sent';
export const STEERING_AGENT_INTERRUPTING = 'agent interrupting';
export const STEERING_AGENT_IDLE = 'agent idle · Send now delivers';
export const STEERING_AGENT_GENERATING = 'agent generating';
export const STEERING_NEVER_SENT_DISCLOSURE = 'node finished · none of this was sent';

/** Exact finished-iteration disclosure; N is the proven live iteration. */
export function finishedIterationDisclosure(liveIteration: number): string {
  return `reading a finished iteration · the agent is working in iteration ${String(liveIteration)}`;
}

/** Exact Go control label for the finished-iteration dock. */
export function goToIterationLabel(liveIteration: number): string {
  return `Go to iteration ${String(liveIteration)}`;
}

const STEERING_NOT_STEERABLE_CODE = 'not_steerable_here';
const STEERING_STORAGE_PREFIX = 'archon:steering-draft:';

/**
 * Visibility/block precedence: a nonempty never-sent result with explicit
 * node-terminal evidence selects finished first (so Cancel that flips the run
 * non-live after observation still surfaces recovery); a structured idle-timeout
 * failure also selects finished even with an empty Never sent list; otherwise a
 * non-live run hides the dock entirely; a proven finished-iteration descriptor
 * wins before the terminal-row hide check so a completed occurrence on a still-live
 * loop can surface the read-only dock; otherwise a non-generating row hides the
 * dock (historical/cold executions must never issue a request); a real pending
 * ask keeps its blocked reason even when a refusal is stored — no request
 * should have been made from that state; only then does a stored 422
 * `not_steerable_here` flip the dock to the detached disclosure.
 *
 * Reconcile still never *triggers* on `!live` alone — finished requires both
 * nonempty neverSent and nodeTerminal (or timeoutFailure + nodeTerminal). Cold
 * opens of terminal runs stay hidden because they never observed a ledger.
 */
export function steeringDockMode(input: {
  rowStatus: string;
  live: boolean;
  hasPendingAsk: boolean;
  refusal: SteeringRefusal | null;
  finishedIteration?: FinishedIterationView | null;
  neverSent?: readonly NeverSentEntry[] | null;
  nodeTerminal?: boolean;
  /** Structured idle-after-interrupt timeout failure for this node. */
  timeoutFailure?: boolean;
}): SteeringDockMode {
  if (input.nodeTerminal === true) {
    if (input.timeoutFailure === true) return 'finished';
    if (input.neverSent !== null && input.neverSent !== undefined && input.neverSent.length > 0) {
      return 'finished';
    }
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
 * non-blank draft, no send in flight, composer mode. `interrupting` does
 * NOT block Queue — a message sent in the race waits for Send now.
 */
export function canSubmitGuidance(input: {
  mode: SteeringDockMode;
  sendInFlight: boolean;
  draft: string;
}): boolean {
  return input.mode === 'composer' && !input.sendInFlight && input.draft.trim().length > 0;
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

/** sessionStorage key for the unsent draft + ambiguous retry id. */
export function steeringDraftStorageKey(runId: string, nodeId: string): string {
  return `${STEERING_STORAGE_PREFIX}${runId}:${nodeId}`;
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

export function createSteeringDockState(subState?: SteeringSubState): SteeringDockState {
  return {
    subState: subState ?? null,
    sent: [],
    observedLedger: [],
    neverSent: null,
    sendInFlight: false,
    interruptInFlight: false,
    inFlightBatch: null,
    pendingRetry: null,
    refusal: null,
    notice: null,
    withdrawingMessageId: null,
    queueGeneration: 0,
  };
}

/** Append receipts the first time each messageId is observed; preserve order. */
function appendObservedIfNew(
  ledger: readonly LocalSentReceipt[],
  entries: readonly LocalSentReceipt[]
): readonly LocalSentReceipt[] {
  let next: LocalSentReceipt[] | null = null;
  for (const entry of entries) {
    const exists = (next ?? ledger).some(row => row.messageId === entry.messageId);
    if (exists) continue;
    if (next === null) next = [...ledger];
    next.push(entry);
  }
  return next ?? ledger;
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
 */
export function resolveGuidanceSuccess(
  state: SteeringDockState,
  receipt: { message_id: string; state?: 'queued' | 'awaiting_send_now' }
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
      observedLedger: appendObservedIfNew(state.observedLedger, [existing]),
    };
  }
  const accepted: LocalSentReceipt = {
    messageId: receipt.message_id,
    message: state.pendingRetry?.message ?? '',
    state: receipt.state ?? 'queued',
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
    observedLedger: appendObservedIfNew(state.observedLedger, [accepted]),
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
 * earlier items already exist in the server registry.
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
  const inFlightBatch = displayedReceipts.some(entry => entry.messageId === pendingRetry.messageId)
    ? displayedReceipts
    : [
        ...displayedReceipts,
        {
          messageId: pendingRetry.messageId,
          message: pendingRetry.message,
          state: 'awaiting_send_now' as const,
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
  receipt: { message_id: string; state: 'queued' | 'awaiting_send_now' }
): SteeringDockState {
  if (!state.sendInFlight || state.inFlightBatch === null) return state;
  if (state.pendingRetry?.messageId !== receipt.message_id) return state;
  const observedLedger = appendObservedIfNew(state.observedLedger, state.inFlightBatch);
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
      observedLedger,
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
    observedLedger,
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
  const observedLedger = state.observedLedger.filter(entry => entry.messageId !== messageId);
  return {
    ...state,
    sent,
    observedLedger,
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

export const STEERING_DELETE_LABEL = 'delete';

/**
 * Accessible name for the per-row delete control. The visible text stays
 * `delete`; the name identifies the specific message so the action is
 * unambiguous. Outer whitespace is trimmed.
 */
export function deleteButtonAccessibleName(message: string): string {
  return `delete · ${message.trim()}`;
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
}

/** The queue-read wire payload: only still-pending rows in receipt order. */
export interface QueueSnapshot {
  readonly queued: readonly QueuedGuidanceRow[];
}

/**
 * Reconcile the rendered queue with the server's authoritative order. A
 * generation mismatch returns the identical state object — the snapshot
 * predates this tab's latest resolved mutation and must not resurrect or
 * drop rows. On match, `sent` is replaced wholesale with the server-ordered
 * queued receipts; `sendInFlight`, `pendingRetry`, `refusal`,
 * `withdrawingMessageId`, and `queueGeneration` are preserved exactly.
 * Identical ids, text, and order return the identical state object so React
 * skips a render. The draft, sessionStorage, and a stored refusal are never
 * touched — the server has no opinion on any of them.
 */
export function applyQueueSnapshot(
  state: SteeringDockState,
  snapshot: QueueSnapshot,
  generationAtRequest: number
): SteeringDockState {
  if (generationAtRequest !== state.queueGeneration) return state;
  const nextSent: LocalSentReceipt[] = snapshot.queued.map(row => ({
    messageId: row.message_id,
    message: row.message,
    state: 'queued',
  }));
  const observedLedger = appendObservedIfNew(state.observedLedger, nextSent);
  const sentUnchanged =
    nextSent.length === state.sent.length &&
    nextSent.every(
      (row, i) => row.messageId === state.sent[i].messageId && row.message === state.sent[i].message
    );
  if (sentUnchanged && observedLedger === state.observedLedger) return state;
  return { ...state, sent: nextSent, observedLedger };
}

/**
 * One-shot terminal reconciliation: restore every observed-but-unwritten
 * receipt, then an unmatched pending submission, then a different nonblank
 * raw draft. Pure — mutates no other state field. Writes `[]` when nothing
 * qualifies (never leaves `neverSent` null after a call).
 */
export function reconcileNeverSent(
  state: SteeringDockState,
  input: {
    readonly writtenMessageIds: ReadonlySet<string>;
    readonly draft: string;
  }
): SteeringDockState {
  const neverSent: NeverSentEntry[] = [];
  const listedIds = new Set<string>();

  for (const entry of state.observedLedger) {
    if (input.writtenMessageIds.has(entry.messageId) || listedIds.has(entry.messageId)) continue;
    listedIds.add(entry.messageId);
    neverSent.push({ messageId: entry.messageId, message: entry.message });
  }

  const pending = state.pendingRetry;
  if (
    pending !== null &&
    !input.writtenMessageIds.has(pending.messageId) &&
    !listedIds.has(pending.messageId)
  ) {
    listedIds.add(pending.messageId);
    neverSent.push({ messageId: pending.messageId, message: pending.message });
  }

  const draft = input.draft;
  if (draft.trim().length > 0 && draft !== pending?.message) {
    neverSent.push({ messageId: null, message: draft });
  }

  if (
    state.neverSent !== null &&
    state.neverSent.length === neverSent.length &&
    state.neverSent.every(
      (entry, index) =>
        entry.messageId === neverSent[index]?.messageId &&
        entry.message === neverSent[index]?.message
    )
  ) {
    return state;
  }

  return { ...state, neverSent };
}

/**
 * Collect message ids that the node-wide operator transcript actually wrote.
 * Only text rows with `metadata.origin === 'operator'` and a non-empty
 * `metadata.message_id` count — assistant/tool/malformed rows are ignored.
 */
export function collectWrittenOperatorMessageIds(rows: readonly NodeMessageRow[]): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.kind !== 'text') continue;
    const metadata = row.metadata;
    if (metadata?.origin !== 'operator') continue;
    const messageId = metadata.message_id;
    if (typeof messageId === 'string' && messageId.length > 0) {
      ids.add(messageId);
    }
  }
  return ids;
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

export interface SteeringDraftRecord {
  readonly draft: string;
  readonly pendingRetry: PendingSubmission | null;
}

/** Parse the persisted draft record; malformed or foreign content resets. */
export function loadSteeringDraft(storage: Storage | undefined, key: string): SteeringDraftRecord {
  const empty: SteeringDraftRecord = { draft: '', pendingRetry: null };
  if (storage === undefined) return empty;
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return empty;
  }
  if (raw === null) return empty;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return empty;
    const draft = 'draft' in parsed && typeof parsed.draft === 'string' ? parsed.draft : '';
    const retry = 'pendingRetry' in parsed ? parsed.pendingRetry : null;
    const pendingRetry =
      typeof retry === 'object' &&
      retry !== null &&
      'messageId' in retry &&
      typeof retry.messageId === 'string' &&
      'message' in retry &&
      typeof retry.message === 'string'
        ? { messageId: retry.messageId, message: retry.message }
        : null;
    return { draft, pendingRetry };
  } catch {
    return empty;
  }
}

/** Persist the draft/retry pair; an entirely empty record removes the key. */
export function saveSteeringDraft(
  storage: Storage | undefined,
  key: string,
  record: SteeringDraftRecord
): void {
  if (storage === undefined) return;
  try {
    if (record.draft === '' && record.pendingRetry === null) {
      storage.removeItem(key);
    } else {
      storage.setItem(key, JSON.stringify(record));
    }
  } catch {
    // Storage full or blocked — the in-memory draft still works this session.
  }
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
