/**
 * Framework-free Story 2.1 steering-dock logic shared by the Legacy and
 * Console composer renderers: visibility/blocked predicates, the guarded
 * submit transition with stable retry ids, sessionStorage draft persistence,
 * and the nested steering error surface both API helpers normalize onto.
 *
 * The POST response is the only queue evidence — there is no queue read,
 * polling, rehydration, or cross-tab convergence in this story (Story 2.9+).
 */
export interface LocalSentReceipt {
  readonly messageId: string;
  readonly message: string;
  readonly state: 'queued';
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

export interface SteeringDockState {
  readonly sent: readonly LocalSentReceipt[];
  readonly inFlight: boolean;
  readonly pendingRetry: PendingSubmission | null;
  readonly refusal: SteeringRefusal | null;
  /**
   * The one in-flight withdraw. A single active id is deliberate: the dock
   * has one refusal channel and one focus transfer, and simultaneous deletes
   * would let response order decide focus or let one success erase another
   * request's failure. The brief dock-wide delete guard never blocks send.
   */
  readonly withdrawingMessageId: string | null;
}

export type SteeringDockMode = 'hidden' | 'blocked' | 'detached' | 'composer';

export const STEERING_ASK_BLOCKED_REASON = "answer the agent's question first";
export const STEERING_DETACHED_DISCLOSURE =
  'not steerable here · this run was started detached, so its live session is not in this process';
export const STEERING_SEND_HINT = 'Cmd/Ctrl+Enter to send · this tab only';
export const STEERING_SEND_FAILED_MESSAGE = "couldn't send · back in the queue";

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

/** The single guard shared by the Queue button and the keyboard shortcut. */
export function canSubmitGuidance(input: {
  mode: SteeringDockMode;
  inFlight: boolean;
  draft: string;
}): boolean {
  return input.mode === 'composer' && !input.inFlight && input.draft.trim().length > 0;
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

/** Lowercase DOM text; the renderer applies CSS uppercase + phase tracking. */
export function queueBandHeader(count: number): string {
  return `queued · ${count.toString()}`;
}

export function queueListLabel(count: number): string {
  return `Queued messages, ${count.toString()}`;
}

export function queueButtonAccessibleName(count: number): string {
  return `Queue · Cmd/Ctrl+Enter to send · ${queuedCountPhrase(count)}`;
}

export function createSteeringDockState(): SteeringDockState {
  return {
    sent: [],
    inFlight: false,
    pendingRetry: null,
    refusal: null,
    withdrawingMessageId: null,
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
  return { state: { ...state, inFlight: true, pendingRetry }, messageId: pendingRetry.messageId };
}

/**
 * 200 appends once by `message_id`, in acceptance order — a replayed success
 * never duplicates the row. Clears the pending retry and any stored refusal.
 */
export function resolveGuidanceSuccess(
  state: SteeringDockState,
  receipt: { message_id: string }
): SteeringDockState {
  const sent = state.sent.some(entry => entry.messageId === receipt.message_id)
    ? state.sent
    : [
        ...state.sent,
        {
          messageId: receipt.message_id,
          message: state.pendingRetry?.message ?? '',
          state: 'queued' as const,
        },
      ];
  return {
    sent,
    inFlight: false,
    pendingRetry: null,
    refusal: null,
    // A send resolving during a withdraw appends its row without losing the
    // active withdraw id.
    withdrawingMessageId: state.withdrawingMessageId,
  };
}

/** A failed submission keeps the pending retry so unchanged text reuses it. */
export function resolveGuidanceFailure(
  state: SteeringDockState,
  refusal: SteeringRefusal
): SteeringDockState {
  return { ...state, inFlight: false, refusal };
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
 * preserved) and clears the active id plus any stored refusal. A stale or
 * mismatched completion is a no-op.
 */
export function resolveWithdrawSuccess(
  state: SteeringDockState,
  messageId: string
): SteeringDockState {
  if (state.withdrawingMessageId !== messageId) return state;
  return {
    ...state,
    sent: state.sent.filter(entry => entry.messageId !== messageId),
    withdrawingMessageId: null,
    refusal: null,
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
 * Typed steering refusal surfaced by both API helpers: carries the HTTP
 * status plus the nested `error.code`/`error.message` when the body held the
 * canonical `{success:false, error:{code,message}}` shape.
 */
export class SteeringSendError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(status: number, code: string | null, message: string) {
    super(message);
    this.name = 'SteeringSendError';
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
 * Normalize any transport failure into a SteeringSendError. Both API layers
 * embed the truncated error body differently: fetchJSON suffixes it onto
 * `Error.message` (`API error 422 (/path): {...}`) while the console's
 * HttpError exposes `bodySnippet`. A non-HTTP failure (offline fetch) has no
 * status and reports the ambiguous-failure copy.
 */
export function toSteeringSendError(error: unknown): SteeringSendError {
  if (error instanceof SteeringSendError) return error;
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
    return new SteeringSendError(0, null, STEERING_SEND_FAILED_MESSAGE);
  }
  return new SteeringSendError(
    status,
    nested?.code ?? null,
    nested?.message ?? `Request failed (${status.toString()})`
  );
}

export function toSteeringRefusal(error: unknown): SteeringRefusal {
  const normalized = toSteeringSendError(error);
  return { code: normalized.code, message: normalized.message };
}
