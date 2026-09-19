/**
 * Framework-free steering-dock logic shared by the Legacy and Console
 * composer renderers: visibility/blocked predicates, the guarded submit
 * transition with stable retry ids, sessionStorage draft persistence, the
 * nested steering error surface both API helpers normalize onto, and the
 * Story 2.9 (#189) queue-reconciliation primitives — `queueGeneration`,
 * `applyQueueSnapshot`, `focusTargetAfterSnapshot`, and `startQueuePolling` —
 * that let every mounted dock converge on the one authoritative registry
 * queue while drafts and retry state stay per-tab.
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
  /**
   * Local queue-mutation counter, starting at 0. Every resolved send or
   * withdraw bumps it; a queue snapshot carries the generation captured when
   * its request fired, so a snapshot that predates this tab's latest mutation
   * is discarded instead of briefly resurrecting a row the operator just
   * withdrew or dropping one they just sent.
   */
  readonly queueGeneration: number;
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
    queueGeneration: 0,
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
 * never duplicates the row but still bumps `queueGeneration`, because the
 * server accepted the mutation either way. Clears the pending retry and any
 * stored refusal.
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
    queueGeneration: state.queueGeneration + 1,
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
 * preserved) and clears the active id plus any stored refusal. The generation
 * bumps even when a snapshot already removed the row — the server confirmed
 * the mutation either way. A stale or mismatched completion is a no-op.
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
    queueGeneration: state.queueGeneration + 1,
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

/**
 * A queue snapshot tagged with the `queueGeneration` captured when its
 * request fired. `applyQueueSnapshot` discards it unless the generation still
 * matches — a local send/withdraw that resolved mid-flight wins over a stale
 * read.
 */
export interface QueueSnapshot {
  readonly generation: number;
  readonly queued: readonly QueuedGuidanceRow[];
}

/**
 * Reconcile the rendered queue with the server's authoritative order. A
 * generation mismatch returns the identical state object — the snapshot
 * predates this tab's latest resolved mutation and must not resurrect or
 * drop rows. On match, `sent` is replaced wholesale with the server-ordered
 * queued receipts; `inFlight`, `pendingRetry`, `refusal`,
 * `withdrawingMessageId`, and `queueGeneration` are preserved. An identical
 * snapshot returns the identical state object so React skips a render. The
 * draft, sessionStorage, and a stored refusal are never touched — the server
 * has no opinion on any of them.
 */
export function applyQueueSnapshot(
  state: SteeringDockState,
  snapshot: QueueSnapshot
): SteeringDockState {
  if (snapshot.generation !== state.queueGeneration) return state;
  const nextSent: LocalSentReceipt[] = snapshot.queued.map(row => ({
    messageId: row.message_id,
    message: row.message,
    state: 'queued',
  }));
  const unchanged =
    nextSent.length === state.sent.length &&
    nextSent.every(
      (row, i) => row.messageId === state.sent[i].messageId && row.message === state.sent[i].message
    );
  if (unchanged) return state;
  return { ...state, sent: nextSent };
}

/**
 * Where focus goes after a snapshot replaces the queue: when the focused
 * row's delete button vanished because another operator/tab withdrew the
 * message, move to the next surviving row's delete button in the
 * pre-snapshot order, else the previous surviving one, else the composer
 * field. A surviving row keeps focus; an unknown focused id resolves to the
 * field. Never returns a `<body>` target — there is always an explicit
 * destination.
 */
export function focusTargetAfterSnapshot(input: {
  /** Queue order before the snapshot was applied. */
  readonly previousIds: readonly string[];
  /** Queue order after the snapshot was applied. */
  readonly nextIds: readonly string[];
  /** The row whose delete button held focus, or null when focus was elsewhere. */
  readonly focusedId: string | null;
}): RemovalFocusTarget {
  const { previousIds, nextIds, focusedId } = input;
  if (focusedId === null) return { kind: 'field' };
  if (nextIds.includes(focusedId)) return { kind: 'delete', messageId: focusedId };
  const index = previousIds.indexOf(focusedId);
  if (index === -1) return { kind: 'field' };
  for (let i = index + 1; i < previousIds.length; i++) {
    if (nextIds.includes(previousIds[i])) return { kind: 'delete', messageId: previousIds[i] };
  }
  for (let i = index - 1; i >= 0; i--) {
    if (nextIds.includes(previousIds[i])) return { kind: 'delete', messageId: previousIds[i] };
  }
  return { kind: 'field' };
}

/** Timer seams so tests can drive the poll deterministically. */
export interface QueuePollingTimers {
  readonly setTimeout: (fn: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
}

export interface StartQueuePollingOptions {
  /** One queue read; resolves with the wire payload, rejects on any failure. */
  readonly read: (
    signal: AbortSignal
  ) => Promise<{ readonly queued: readonly QueuedGuidanceRow[] }>;
  /** The dock's current `queueGeneration`, sampled as each request fires. */
  readonly generation: () => number;
  /** Receives the generation-tagged snapshot for each 200. */
  readonly onSnapshot: (snapshot: QueueSnapshot) => void;
  /** Reconcile cadence; defaults to ~1s. */
  readonly intervalMs?: number;
  readonly timers?: QueuePollingTimers;
}

const QUEUE_POLL_INTERVAL_MS = 1000;
// Statuses that end the poll: malformed, refused, gone, or finished — the
// dock only learns these through the read, so retrying would spin forever.
// Everything else (422 detached, 0 transport, 500 server) retries.
const QUEUE_POLL_STOP_STATUSES: ReadonlySet<number> = new Set([400, 401, 403, 404, 409]);

/**
 * Framework-free queue reconcile loop: fires one read immediately, then
 * schedules the next read only after the current one settles — requests
 * never overlap. Each request tags its snapshot with the generation sampled
 * at fire time; retryable failures reschedule silently; stop statuses end
 * the loop. The returned cleanup aborts the in-flight request, clears the
 * pending timer, and suppresses any late settle.
 */
export function startQueuePolling(options: StartQueuePollingOptions): () => void {
  const intervalMs = options.intervalMs ?? QUEUE_POLL_INTERVAL_MS;
  const timers: QueuePollingTimers = options.timers ?? {
    setTimeout: (fn, ms): unknown => setTimeout(fn, ms),
    clearTimeout: (handle): void => {
      clearTimeout(handle as Parameters<typeof clearTimeout>[0]);
    },
  };
  let stopped = false;
  let epoch = 0;
  let controller: AbortController | null = null;
  let timer: unknown = null;

  const schedule = (): void => {
    if (stopped) return;
    timer = timers.setTimeout(tick, intervalMs);
  };

  const tick = (): void => {
    if (stopped) return;
    const myEpoch = ++epoch;
    const generation = options.generation();
    const request = new AbortController();
    controller = request;
    void options.read(request.signal).then(
      payload => {
        if (stopped || epoch !== myEpoch) return;
        controller = null;
        options.onSnapshot({ generation, queued: payload.queued });
        schedule();
      },
      (error: unknown) => {
        if (stopped || epoch !== myEpoch) return;
        controller = null;
        if (QUEUE_POLL_STOP_STATUSES.has(toSteeringSendError(error).status)) {
          stopped = true;
          return;
        }
        schedule();
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
      timers.clearTimeout(timer);
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
