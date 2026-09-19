/**
 * Framework-free steering-dock logic shared by the Legacy and Console
 * composer renderers: visibility/blocked predicates, the guarded submit
 * transitions with stable retry ids, the interrupt/Send-now turn model,
 * sessionStorage draft persistence, and the nested steering error surface
 * both API helpers normalize onto.
 *
 * The POST response is the only queue evidence — there is no queue read,
 * polling, rehydration, or cross-tab convergence in this story (Story 2.9+).
 */
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

export interface SteeringDockState {
  /** Projected agent sub-state; null means a live queue-only handle. */
  readonly subState: SteeringSubState | null;
  readonly sent: readonly LocalSentReceipt[];
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
}

export type SteeringDockMode = 'hidden' | 'blocked' | 'detached' | 'composer';

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
export const STEERING_AGENT_INTERRUPTING = 'agent interrupting';
export const STEERING_AGENT_IDLE = 'agent idle · Send now delivers';
export const STEERING_AGENT_GENERATING = 'agent generating';

const STEERING_NOT_STEERABLE_CODE = 'not_steerable_here';
const STEERING_STORAGE_PREFIX = 'archon:steering-draft:';

/**
 * Visibility/block precedence: a non-live run or non-generating row hides the
 * dock entirely (historical/cold executions must never issue a request); a
 * real pending ask keeps its blocked reason even when a refusal is stored —
 * no request should have been made from that state; only then does a stored
 * 422 `not_steerable_here` flip the dock to the detached disclosure.
 */
export function steeringDockMode(input: {
  rowStatus: string;
  live: boolean;
  hasPendingAsk: boolean;
  refusal: SteeringRefusal | null;
}): SteeringDockMode {
  if (!input.live) return 'hidden';
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
    sendInFlight: false,
    interruptInFlight: false,
    inFlightBatch: null,
    pendingRetry: null,
    refusal: null,
    notice: null,
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
 */
export function resolveGuidanceSuccess(
  state: SteeringDockState,
  receipt: { message_id: string; state?: 'queued' | 'awaiting_send_now' }
): SteeringDockState {
  if (state.sent.some(entry => entry.messageId === receipt.message_id)) {
    return { ...state, sendInFlight: false, pendingRetry: null, refusal: null };
  }
  const sent = [
    ...state.sent,
    {
      messageId: receipt.message_id,
      message: state.pendingRetry?.message ?? '',
      state: receipt.state ?? 'queued',
    },
  ];
  return {
    ...state,
    sent,
    sendInFlight: false,
    pendingRetry: null,
    refusal: null,
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
