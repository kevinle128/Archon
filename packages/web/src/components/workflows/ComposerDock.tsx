/**
 * Steering composer dock for the Legacy node room: guarded send into the
 * run's durable steering queue, plus the turn model — `Stop` interrupts the
 * agent's current generation, `Send now` delivers a typed message on the
 * same session once the agent is idle-after-interrupt. A serial abortable
 * poll of `GET .../queue` hydrates and reconciles the durable queue, the
 * `never_sent` band, and the recovery/auto-send/soft-injection signals the
 * server carries on every read; local POST/DELETE responses still update
 * immediately. The composer draft is saved on the server per operator via
 * `GET`/`PUT`/`DELETE .../draft`, debounced while typing. A read-only
 * finished-iteration branch (GET poll only) covers a completed occurrence of
 * a still-live loop node.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

import {
  clearNodeDraft,
  interruptNode,
  keepaliveNode,
  readNodeDraft,
  readNodeGuidanceQueue,
  saveNodeDraft,
  sendNodeGuidance,
  withdrawNodeGuidance,
  type ClearSteeringDraftResponse,
  type InterruptWorkflowNodeResponse,
  type KeepaliveWorkflowNodeResponse,
  type PutSteeringDraftBody,
  type ReadWorkflowNodeQueueResponse,
  type SendWorkflowNodeBody,
  type SendWorkflowNodeResponse,
  type SteeringDraftResponse,
  type WithdrawWorkflowNodeResponse,
  type WorkflowNodeStateResponse,
} from '@/lib/api';
import type { FinishedIterationView } from '@/lib/execution-room-model';
import {
  allPendingDispatching,
  applyQueueSnapshot,
  beginGuidanceSubmission,
  beginInterrupt,
  beginSendNow,
  beginSendNowItem,
  beginWithdraw,
  canSubmitGuidance,
  createKeepaliveCoalescer,
  createSteeringDockState,
  deleteButtonAccessibleName,
  sendNowItemAccessibleName,
  finishedIterationDisclosure,
  focusTargetAfterSnapshot,
  goToIterationLabel,
  isKeepaliveActivityKey,
  isQueueItemClaimable,
  isQueueShortcut,
  neverSentBandHeader,
  neverSentDisclosure,
  neverSentListLabel,
  nextFocusAfterRemoval,
  pendingQueueCount,
  queueBandHeader,
  queueButtonAccessibleName,
  queueItemStatusLabel,
  queueListLabel,
  queuedCountPhrase,
  resolveGuidanceFailure,
  resolveGuidanceSuccess,
  resolveInterruptError,
  resolveInterruptOutcome,
  resolveSendNowFailure,
  resolveSendNowItemFailure,
  resolveSendNowItemSuccess,
  resolveSendNowSuccess,
  resolveWithdrawFailure,
  resolveWithdrawSuccess,
  savedToServerLine,
  sendingBandHeader,
  sendingListLabel,
  sendNowButtonAccessibleName,
  startQueuePolling,
  steeringAgentMode,
  steeringBlockedReason,
  steeringDockMode,
  steeringScopeKey,
  syncProjectedSubState,
  STEERING_DELETE_LABEL,
  STEERING_SEND_NOW_ITEM_LABEL,
  STEERING_DETACHED_DISCLOSURE,
  STEERING_RECOVERY_DISCLOSURE,
  STEERING_IDLE_AWAIT_DISCLOSURE,
  STEERING_INTERRUPT_DISCLOSURE,
  STEERING_INTERRUPT_FAILED_MESSAGE,
  STEERING_SEND_HINT,
  toSteeringRefusal,
  willSendBandHeader,
  willSendListLabel,
  toSteeringRequestError,
  type KeepaliveCoalescer,
  type NeverSentEntry,
  type RemovalFocusTarget,
  type SteeringDockMode,
  type SteeringDockState,
  type SteeringExecutionState,
  type SteeringQueueItemState,
  type SteeringSubState,
} from '@/lib/steering-dock';
import { cn } from '@/lib/utils';

export type SendNodeGuidance = (
  runId: string,
  nodeId: string,
  body: SendWorkflowNodeBody
) => Promise<SendWorkflowNodeResponse>;

export type InterruptNode = (
  runId: string,
  nodeId: string
) => Promise<InterruptWorkflowNodeResponse>;

export type KeepaliveNode = (
  runId: string,
  nodeId: string
) => Promise<KeepaliveWorkflowNodeResponse>;

export type WithdrawNodeGuidance = (
  runId: string,
  nodeId: string,
  messageId: string
) => Promise<WithdrawWorkflowNodeResponse>;

export type ReadNodeGuidanceQueue = (
  runId: string,
  nodeId: string,
  options?: { signal?: AbortSignal }
) => Promise<ReadWorkflowNodeQueueResponse>;

export type ReadNodeDraft = (
  runId: string,
  nodeId: string,
  options?: { signal?: AbortSignal }
) => Promise<SteeringDraftResponse>;

export type SaveNodeDraft = (
  runId: string,
  nodeId: string,
  body: PutSteeringDraftBody
) => Promise<SteeringDraftResponse>;

export type ClearNodeDraft = (runId: string, nodeId: string) => Promise<ClearSteeringDraftResponse>;

export interface ComposerDockProps {
  runId: string;
  /** Namespaced node id — the send route segment and draft scope key. */
  nodeId: string;
  /** Display label for the field's accessible name. */
  nodeLabel: string;
  rowStatus: WorkflowNodeStateResponse['status'];
  /** Whether the owning run is still live; historical runs never steer. */
  live: boolean;
  /** This node's pending ask blocks send; sibling asks must not reach here. */
  hasPendingAsk: boolean;
  /**
   * Projected agent sub-state from the run payload. Absent means a live
   * queue-only handle — never a detached verdict on its own.
   */
  subState?: SteeringSubState;
  /**
   * Proven same-lineage live iteration. Non-null selects finished-iteration
   * mode; omitted/null keeps today's visibility table.
   */
  finishedIteration?: FinishedIterationView | null;
  /**
   * Existing execution-selection callback. Required for an enabled Go control;
   * without it the finished dock must not render.
   */
  onSelectLiveRow?: (liveRowId: string) => void;
  /**
   * Parent-owned consume-once autofocus after a Go-driven dock remount.
   * Cleared via onAutoFocusApplied once focus is moved.
   */
  autoFocusTarget?: 'field' | 'go' | null;
  onAutoFocusApplied?: () => void;
  /**
   * The last observed queue-read execution state, reported on every change
   * (including back to null on a scope reset) so the room header can show
   * `Recovery required` — the dock is the only place this durable signal is
   * currently read.
   */
  onExecutionStateChange?: (state: SteeringExecutionState | null) => void;
  /**
   * Every message id's last-observed delivery state, reported on every
   * change so a transcript operator row can show the proven `sent` /
   * `delivered` / `delivery unknown` state instead of a hard-coded guess —
   * the dock's queue read is the only place this durable, per-message
   * evidence is currently read.
   */
  onDeliveryStatesChange?: (states: ReadonlyMap<string, SteeringQueueItemState>) => void;
  send?: SendNodeGuidance;
  interrupt?: InterruptNode;
  withdraw?: WithdrawNodeGuidance;
  /** Queue snapshot reader; defaults to the Legacy API helper. */
  readQueue?: ReadNodeGuidanceQueue;
  /** Draft read/write/clear; default to the Legacy API helpers. */
  readDraft?: ReadNodeDraft;
  saveDraft?: SaveNodeDraft;
  clearDraft?: ClearNodeDraft;
  /** Draft-save debounce in ms; production default 600, narrow test seam only. */
  draftSaveDelayMs?: number;
  /** Poll cadence in ms; production default 1000, narrow test seam only. */
  pollIntervalMs?: number;
  /**
   * Focuses the last rendered transcript row (scroller fallback) when the
   * Stop control or the whole dock leaves the DOM — focus must never land
   * on `<body>`.
   */
  focusLastRow?: () => void;
  /**
   * True only when the parent has actual node-terminal evidence. Run-level
   * terminal status is not sufficient. Default false.
   */
  nodeTerminal?: boolean;
  /**
   * Logical node-execution attempt key from the event fold. Replacing one
   * non-null key with another resets attempt-scoped observation state while
   * preserving the raw draft. Default null.
   */
  nodeExecutionKey?: string | null;
  /**
   * Bodyless idle-await keepalive. Defaults to the Legacy API helper.
   * Injectable for tests.
   */
  keepalive?: KeepaliveNode;
  /**
   * True when the selected node's latest terminal execution failed for the
   * idle-await expiry cause. Drives the never-sent alert copy. Default false.
   */
  idleAwaitExpired?: boolean;
}

const FIELD_CLASSES = cn(
  'min-h-[56px] w-full resize-none rounded-md border border-border bg-surface-inset',
  'px-[10px] py-[8px] font-sans text-[13px] leading-[1.45] text-text-primary',
  'focus-visible:outline-2 focus-visible:outline-accent-bright focus-visible:-outline-offset-2'
);

const CONTROL_BASE_CLASSES = cn(
  'min-h-[32px] flex-none rounded-md border bg-transparent px-3 font-mono text-[11px]',
  'transition-colors motion-reduce:transition-none',
  'focus-visible:outline-2 focus-visible:outline-accent-bright focus-visible:-outline-offset-2'
);
const CONTROL_ENABLED_CLASSES = 'border-border-bright text-text-primary hover:bg-surface-inset';
const CONTROL_DISABLED_CLASSES = 'border-border text-text-secondary';

const BLOCKED_REASON_CLASSES =
  'mt-[6px] font-mono text-[10.5px] leading-[1.45] text-text-secondary';
const REFUSAL_CLASSES = 'mt-[6px] font-mono text-[10.5px] leading-[1.45] text-error';
const DEFAULT_DRAFT_SAVE_DELAY_MS = 600;

/** Modes where the dock's focusable controls are in the DOM. */
function controlsMounted(mode: SteeringDockMode): boolean {
  // finished-iteration mounts Go; finished is read-only with no focusables.
  return mode === 'composer' || mode === 'blocked' || mode === 'finished-iteration';
}

// The Legacy surface's running colour is --accent-bright — matches TodoStrip.tsx.
const QUEUE_RUNNING_MARKER = 'shadow-[inset_2px_0_0_var(--accent-bright)]';

/**
 * Queue/never-sent/recovery band header. Shares the pinned todo strip's
 * collapsible header idiom (DESIGN.md: "shares that strip's header idiom and
 * item geometry"). `label` carries the header word and count together (e.g.
 * "queued · 1"); CSS renders it uppercase without changing the text a reader
 * or test sees.
 */
function QueueBandHeader({
  label,
  savedLine,
  open,
  onToggle,
  bodyId,
}: {
  label: string;
  savedLine: string | null;
  open: boolean;
  onToggle: () => void;
  bodyId: string;
}): React.ReactElement {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={bodyId}
      onClick={onToggle}
      className="flex min-h-[24px] w-full items-center gap-2 overflow-hidden whitespace-nowrap px-[10px] py-[6px] text-left hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent-bright focus-visible:-outline-offset-2"
    >
      <span className="flex-none text-[10px] font-bold uppercase tracking-[0.07em] text-text-secondary">
        {label}
      </span>
      {savedLine === null ? null : (
        <span className="ml-auto flex-none text-[10px] text-text-secondary">{savedLine}</span>
      )}
      <span
        aria-hidden="true"
        className={cn(
          'w-[9px] flex-none text-center text-[9px] leading-none text-text-tertiary transition-transform duration-[120ms] motion-reduce:transition-none',
          open && 'rotate-180'
        )}
      >
        ▾
      </span>
    </button>
  );
}

/**
 * One queue/never-sent/recovery band item: a 1-based position number plus
 * the message text, with trailing status text and action buttons supplied
 * by the caller. `accent` marks the next item due out — only the live
 * composer band's own head item, never a read-only band.
 */
function QueueBandItem({
  ord,
  dataMessageId,
  text,
  accent,
  children,
}: {
  ord: number;
  dataMessageId?: string;
  text: string;
  accent: boolean;
  children?: React.ReactNode;
}): React.ReactElement {
  return (
    <li
      {...(dataMessageId !== undefined ? { 'data-message-id': dataMessageId } : {})}
      className={cn(
        'flex items-baseline gap-2 rounded-[4px] py-[1px] pr-[4px] pl-[2px] font-mono text-[11.5px] leading-[1.85]',
        accent ? cn('bg-surface text-text-primary', QUEUE_RUNNING_MARKER) : 'text-text-secondary'
      )}
    >
      <span
        aria-hidden="true"
        className="w-[12px] flex-none text-center text-[10px] text-text-secondary"
      >
        {ord}
      </span>
      <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{text}</span>
      {children}
    </li>
  );
}

export function ComposerDock({
  runId,
  nodeId,
  nodeLabel,
  rowStatus,
  live,
  hasPendingAsk,
  subState,
  finishedIteration = null,
  onSelectLiveRow,
  autoFocusTarget = null,
  onAutoFocusApplied,
  onExecutionStateChange,
  onDeliveryStatesChange,
  send = sendNodeGuidance,
  interrupt = interruptNode,
  withdraw = withdrawNodeGuidance,
  readQueue = readNodeGuidanceQueue,
  readDraft = readNodeDraft,
  saveDraft = saveNodeDraft,
  clearDraft = clearNodeDraft,
  draftSaveDelayMs = DEFAULT_DRAFT_SAVE_DELAY_MS,
  keepalive = keepaliveNode,
  pollIntervalMs = 1000,
  focusLastRow,
  nodeTerminal = false,
  nodeExecutionKey = null,
  idleAwaitExpired = false,
}: ComposerDockProps): React.ReactElement | null {
  const scopeKey = steeringScopeKey(runId, nodeId);
  const fieldId = useId();
  const reasonId = useId();
  const queueBodyId = useId();
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const wellRef = useRef<HTMLDivElement>(null);
  const goButtonRef = useRef<HTMLButtonElement>(null);
  const neverSentAlertRef = useRef<HTMLParagraphElement>(null);
  const deleteButtonsRef = useRef<Map<string, HTMLButtonElement>>(new Map());
  const pendingFocusRef = useRef<RemovalFocusTarget | null>(null);
  const detachedAlertRef = useRef<HTMLParagraphElement>(null);
  const dockRef = useRef<SteeringDockState>(createSteeringDockState(subState));
  /** Bumped on run/node scope change or execution-key/attempt reset. */
  const attemptGenerationRef = useRef(0);
  const prevScopeRef = useRef(scopeKey);
  const prevExecutionKeyRef = useRef<string | null>(nodeExecutionKey);
  const prevNodeTerminalRef = useRef(nodeTerminal);
  const coalescerRef = useRef<KeepaliveCoalescer | null>(null);
  const keepaliveRef = useRef(keepalive);
  keepaliveRef.current = keepalive;

  const [dock, setDock] = useState<SteeringDockState>(() => createSteeringDockState(subState));
  const [draft, setDraft] = useState('');
  // Shared across the four mutually-exclusive band renders below; only one
  // ever mounts at a time. Default open matches the approved mockup.
  const [queueBandOpen, setQueueBandOpen] = useState(true);
  /** Finished-iteration poll 422: show detached alert without leaving the mode. */
  const [readDetached, setReadDetached] = useState(false);
  /** Finished-iteration other 4xx notify copy (poll stopped). */
  const [readNotify, setReadNotify] = useState<string | null>(null);
  dockRef.current = dock;

  // Draft hydration/persistence. The draft is server-scoped by (run, node)
  // only — never per execution attempt — so it survives a loop iteration or
  // a resumed attempt on the same node, and this effect keys on scope alone.
  // `lastKnownServerDraftRef` is `null` until hydration settles (blocking any
  // save) and otherwise holds the last value known to match the server —
  // updated by hydration and by every successful save/clear. A save is only
  // ever scheduled when the local draft differs from that value, so an
  // echoed hydration (including an empty one) never needs a separate
  // "consume once" flag that could otherwise stay wrongly armed.
  const lastKnownServerDraftRef = useRef<string | null>(null);
  const userEditedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    lastKnownServerDraftRef.current = null;
    userEditedRef.current = false;
    const controller = new AbortController();
    void readDraft(runId, nodeId, { signal: controller.signal }).then(
      (response): void => {
        const value = response.draft?.message ?? '';
        lastKnownServerDraftRef.current = value;
        // A read that resolves after the operator already started typing must
        // never overwrite what they are mid-way through composing.
        if (!userEditedRef.current) setDraft(value);
      },
      (): void => {
        // Treat a failed read as "assume empty" rather than blocking saves
        // forever; a later edit still reaches the server once retried.
        lastKnownServerDraftRef.current = '';
      }
    );
    return (): void => {
      controller.abort();
    };
    // Intentionally keyed on scope only.
  }, [runId, nodeId]);

  const scheduleDraftSave = (nextDraft: string): void => {
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const known = lastKnownServerDraftRef.current;
    if (known === null || known === nextDraft) return;
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      if (nextDraft.trim().length === 0) {
        void clearDraft(runId, nodeId).then(
          () => {
            lastKnownServerDraftRef.current = '';
          },
          () => {
            // Best-effort; a later edit reschedules.
          }
        );
      } else {
        void saveDraft(runId, nodeId, { message: nextDraft }).then(
          () => {
            lastKnownServerDraftRef.current = nextDraft;
          },
          () => {
            // Best-effort; a later save reconciles.
          }
        );
      }
    }, draftSaveDelayMs);
  };

  useEffect(() => {
    scheduleDraftSave(draft);
    return (): void => {
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
    // scheduleDraftSave closes over stable deps and is called directly, not
    // listed as a dependency.
  }, [draft, runId, nodeId, draftSaveDelayMs]);

  // A host without a selection callback must never show an enabled Go control.
  const usableFinishedIteration =
    finishedIteration !== null && finishedIteration !== undefined && onSelectLiveRow !== undefined
      ? finishedIteration
      : null;

  // Durable never-sent rows plus this operator's own still-unsent draft,
  // folded in as the trailing item (control-states.md: "the half-typed line
  // folds in as the last item"). A `delivery_unknown` row that survives to a
  // terminal node (no reconcile touches it) counts too — undelivered content
  // must remain readable regardless of which exact state it froze in.
  // `dispatching` is excluded: it means a send is actively in flight, which
  // is the opposite of undelivered, so it must never render as "never sent"
  // before the terminal reconciliation result (server truth) arrives.
  const finishedEntries: NeverSentEntry[] = [
    ...dock.sent
      .filter(receipt => receipt.state !== 'dispatching')
      .map(receipt => ({ messageId: receipt.messageId, message: receipt.message })),
    ...(dock.neverSent ?? []),
    ...(draft.trim().length > 0 ? [{ messageId: null, message: draft }] : []),
  ];

  const mode = steeringDockMode({
    rowStatus,
    live,
    hasPendingAsk,
    refusal: dock.refusal,
    finishedIteration: usableFinishedIteration,
    neverSent: finishedEntries,
    nodeTerminal,
    recoveryRequired: dock.executionState === 'recovery_required',
  });

  // One-shot fetch on the terminal transition (never gated on any local
  // state): the durable `never_sent`/`delivery_unknown` rows the executor
  // wrote are readable the instant the node is known terminal, whether this
  // dock watched the whole run live or was opened cold well afterward.
  // Declared before the scope-reset effect below so a scope change can also
  // reset it — a new (runId, nodeId) attempt must get its own fetch even
  // while `nodeTerminal` stays continuously true across the swap.
  const terminalFetchedRef = useRef(false);

  // Attempt reset run in layout before passive async continuations so a
  // generation bump invalidates in-flight work first.
  useLayoutEffect(() => {
    const scopeChanged = prevScopeRef.current !== scopeKey;
    if (scopeChanged) {
      prevScopeRef.current = scopeKey;
      attemptGenerationRef.current += 1;
      prevExecutionKeyRef.current = nodeExecutionKey;
      prevNodeTerminalRef.current = nodeTerminal;
      pendingFocusRef.current = null;
      terminalFetchedRef.current = false;
      setDock(createSteeringDockState(subState));
      setReadDetached(false);
      setReadNotify(null);
      // Clear the previous scope's text synchronously so it never flashes
      // under the new scope while that scope's own draft is still loading;
      // the hydration effect (keyed on the same runId/nodeId) fills it in.
      // No save fires for this clear: the same effect resets
      // lastKnownServerDraftRef to null first, and a null "known" value
      // blocks scheduleDraftSave outright until the new scope hydrates.
      setDraft('');
    } else {
      const prevKey = prevExecutionKeyRef.current;
      const nextKey = nodeExecutionKey;
      const keyReplaced =
        typeof prevKey === 'string' && typeof nextKey === 'string' && prevKey !== nextKey;
      const terminalFailSafe =
        prevKey === null && nextKey === null && prevNodeTerminalRef.current && !nodeTerminal;

      if (keyReplaced || terminalFailSafe) {
        attemptGenerationRef.current += 1;
        pendingFocusRef.current = null;
        setDock(createSteeringDockState(subState));
        setReadDetached(false);
        setReadNotify(null);
      }

      prevExecutionKeyRef.current = nodeExecutionKey;
      prevNodeTerminalRef.current = nodeTerminal;
    }
  }, [scopeKey, subState, nodeExecutionKey, nodeTerminal]);

  useEffect(() => {
    setDock(current => syncProjectedSubState(current, subState));
  }, [subState]);

  // The only reader of the durable queue snapshot's execution state today —
  // report every change, including the reset back to null on a scope swap,
  // so a parent header can show `Recovery required` without polling twice.
  useEffect(() => {
    onExecutionStateChange?.(dock.executionState);
  }, [dock.executionState, onExecutionStateChange]);

  useEffect(() => {
    onDeliveryStatesChange?.(dock.deliveryByMessageId);
  }, [dock.deliveryByMessageId, onDeliveryStatesChange]);

  useEffect(() => {
    // A non-live run (Cancel/Abandon) qualifies exactly like nodeTerminal
    // does — see steeringDockMode — so a cold mount opened during the window
    // between the run leaving `live` and this node's own terminal event
    // still hydrates the queue instead of showing nothing.
    if (!nodeTerminal && live) {
      terminalFetchedRef.current = false;
      return;
    }
    if (terminalFetchedRef.current) return;
    terminalFetchedRef.current = true;
    const controller = new AbortController();
    void readQueue(runId, nodeId, { signal: controller.signal }).then(
      snapshot => {
        setDock(current => applyQueueSnapshot(current, snapshot, current.queueGeneration));
      },
      () => {
        // Read-only hydration; a failure here just leaves less to show.
      }
    );
    return (): void => {
      controller.abort();
      // Synchronous, not inside the rejection handler above: StrictMode's
      // dev-only double-invoke runs this cleanup, then the setup again, with
      // the SAME ref instance, before the aborted fetch's rejection ever
      // resolves — leaving the flag `true` here would make the second
      // invocation see "already fetched" and skip its own (unaborted) fetch,
      // permanently losing this node's terminal hydration for the mount.
      terminalFetchedRef.current = false;
    };
  }, [nodeTerminal, live, runId, nodeId, readQueue]);

  // Shared-queue reads while composer/blocked/finished-iteration/recovery are
  // mounted. Recovery keeps polling (not just a one-shot) so this dock can
  // observe the moment Resume re-establishes a live handle and the mode
  // reverts on its own. finished-iteration polls GET only (no mutation
  // handlers bound). finished mode never polls — the one-shot above covers
  // it, and nothing can mutate a terminal node's queue.
  const pollingEnabled =
    mode === 'composer' ||
    mode === 'blocked' ||
    mode === 'finished-iteration' ||
    mode === 'recovery-required';

  useEffect(() => {
    if (!pollingEnabled) return;
    const finishedMode = mode === 'finished-iteration';
    const attemptGen = attemptGenerationRef.current;
    return startQueuePolling({
      read: signal => readQueue(runId, nodeId, { signal }),
      currentGeneration: () => dockRef.current.queueGeneration,
      onSnapshot: (snapshot, generationAtRequest): void => {
        if (attemptGenerationRef.current !== attemptGen) return;
        if (finishedMode) {
          setReadDetached(false);
          setReadNotify(null);
        }
        let focusedId: string | null = null;
        for (const [messageId, button] of deleteButtonsRef.current) {
          if (button === document.activeElement) {
            focusedId = messageId;
            break;
          }
        }
        setDock(current => {
          const previousIds = current.sent
            .filter(receipt => isQueueItemClaimable(receipt.state))
            .map(receipt => receipt.messageId);
          const next = applyQueueSnapshot(current, snapshot, generationAtRequest);
          if (next === current) return current;
          const nextIds = next.sent
            .filter(receipt => isQueueItemClaimable(receipt.state))
            .map(receipt => receipt.messageId);
          if (
            !finishedMode &&
            focusedId !== null &&
            previousIds.includes(focusedId) &&
            !nextIds.includes(focusedId) &&
            pendingFocusRef.current === null
          ) {
            pendingFocusRef.current = focusTargetAfterSnapshot(previousIds, nextIds, focusedId);
          }
          return next;
        });
      },
      onError: finishedMode
        ? (error): void => {
            if (attemptGenerationRef.current !== attemptGen) return;
            const normalized = toSteeringRequestError(error);
            if (normalized.status === 422 && normalized.code === 'not_steerable_here') {
              setReadDetached(true);
              setReadNotify(null);
              setDock(current => (current.sent.length === 0 ? current : { ...current, sent: [] }));
              return;
            }
            if (normalized.status === 409) {
              setReadDetached(false);
              setReadNotify(null);
              setDock(current => (current.sent.length === 0 ? current : { ...current, sent: [] }));
              return;
            }
            // network (0) / 5xx: silent retry; last snapshot retained
            if (normalized.status === 0 || normalized.status >= 500) return;
            // other 4xx: notify + stop (poller already stops non-retryable)
            setReadDetached(false);
            setReadNotify(normalized.message);
          }
        : undefined,
      intervalMs: pollIntervalMs,
    });
    // nodeExecutionKey: cleanup aborts the old poller on attempt reset.
  }, [runId, nodeId, readQueue, pollIntervalMs, pollingEnabled, mode, nodeExecutionKey]);

  // When the dock's controls leave the DOM — terminal state hides the dock,
  // a 422 swaps it for the detached disclosure — focus must move to the
  // transcript rather than fall to <body>.
  const focusLastRowRef = useRef(focusLastRow);
  useEffect(() => {
    focusLastRowRef.current = focusLastRow;
  });
  // Track whether focus ever sat inside the dock so an unmount moves it to
  // the transcript only when the dock actually held it — a StrictMode mount
  // replay must never steal focus it never owned.
  const focusInsideRef = useRef(false);
  const controlsMountedRef = useRef(controlsMounted(mode));
  useEffect(() => {
    const wasMounted = controlsMountedRef.current;
    controlsMountedRef.current = controlsMounted(mode);
    if (!wasMounted || controlsMountedRef.current) return;
    const active = document.activeElement;
    if (
      focusInsideRef.current ||
      active === null ||
      active === document.body ||
      !document.contains(active)
    ) {
      focusLastRowRef.current?.();
    }
  });
  useEffect(
    () => (): void => {
      if (!controlsMountedRef.current) return;
      const active = document.activeElement;
      const inside =
        focusInsideRef.current || (active !== null && (wellRef.current?.contains(active) ?? false));
      if (inside) focusLastRowRef.current?.();
    },
    []
  );

  // A stored 422 replaces the dock with the detached disclosure — move focus
  // to it instead of returning keyboard users to <body>. Send- and
  // withdraw-triggered 422s share this one disclosure path.
  useEffect(() => {
    if (mode === 'detached') detachedAlertRef.current?.focus();
  }, [mode]);

  // Cancel can hide the dock (live→false) before neverSent is ready, then
  // re-enter finished. The composer→hidden handoff may miss; ensure finished
  // never leaves keyboard focus on <body>.
  useEffect(() => {
    if (mode !== 'finished') return;
    const active = document.activeElement;
    if (
      active === null ||
      active === document.body ||
      !document.contains(active) ||
      focusInsideRef.current
    ) {
      focusLastRowRef.current?.();
    }
  }, [mode]);

  // Parent-owned consume-once autofocus after Go-driven selection remount.
  useEffect(() => {
    if (autoFocusTarget === null || autoFocusTarget === undefined) return;
    if (autoFocusTarget === 'field') {
      fieldRef.current?.focus();
    } else if (autoFocusTarget === 'go') {
      goButtonRef.current?.focus();
    }
    onAutoFocusApplied?.();
  }, [autoFocusTarget, onAutoFocusApplied]);

  // After a successful withdraw removes its row, move focus to the target
  // captured at activation time (next row → previous row → field). The same
  // path restores focus after a remote snapshot removes the focused row.
  useEffect(() => {
    const target = pendingFocusRef.current;
    // A concurrent send also changes `sent`. Keep the target pending until the
    // withdraw itself settles so an unrelated append cannot move focus early
    // or consume the focus restoration needed if the withdraw later succeeds.
    if (target === null || dock.withdrawingMessageId !== null) return;
    pendingFocusRef.current = null;
    const button =
      target.kind === 'delete' ? deleteButtonsRef.current.get(target.messageId) : undefined;
    (button ?? fieldRef.current)?.focus();
  }, [dock.sent, dock.withdrawingMessageId]);

  const blockedReason = steeringBlockedReason({ rowStatus, hasPendingAsk });
  const agentMode = steeringAgentMode(dock);
  const canSubmit = canSubmitGuidance({
    mode,
    sendInFlight: dock.sendInFlight,
    draft,
    agentMode,
    willSendCount: dock.sent.filter(entry => isQueueItemClaimable(entry.state)).length,
  });

  // One coalescer per idle attempt. Leaving idle / attempt-key change / unmount
  // disposes it so a late result cannot affect a new attempt.
  useEffect(() => {
    coalescerRef.current?.dispose();
    coalescerRef.current = null;
    if (agentMode !== 'idle') return;
    const attemptGen = attemptGenerationRef.current;
    const attemptKey = nodeExecutionKey;
    const coalescer = createKeepaliveCoalescer({
      send: () => {
        if (attemptGenerationRef.current !== attemptGen) return;
        if (steeringAgentMode(dockRef.current) !== 'idle') return;
        if (nodeExecutionKey !== attemptKey) return;
        return keepaliveRef.current(runId, nodeId);
      },
    });
    coalescerRef.current = coalescer;
    return (): void => {
      coalescer.dispose();
      if (coalescerRef.current === coalescer) {
        coalescerRef.current = null;
      }
    };
  }, [agentMode, nodeExecutionKey, runId, nodeId]);

  const cancelPendingDraftSave = (): void => {
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  };

  const submit = (): void => {
    if (!canSubmit) return;
    const submittedDraft = draft;
    const attemptGen = attemptGenerationRef.current;
    // Cancel any pending debounced PUT first — a submission that succeeds
    // clears the server draft explicitly below, and a stale PUT firing after
    // that DELETE would resurrect exactly the text the operator just sent.
    cancelPendingDraftSave();
    if (agentMode === 'idle') {
      // Send now cancels pending trailing keepalive and never issues one of its own.
      coalescerRef.current?.dispose();
      coalescerRef.current = null;
      const begun = beginSendNow(dock, draft);
      setDock(begun.state);
      void send(runId, nodeId, {
        message: draft,
        message_id: begun.messageId,
        intent: 'send_now',
      }).then(
        (receipt): void => {
          if (attemptGenerationRef.current !== attemptGen) return;
          setDock(current => resolveSendNowSuccess(current, receipt));
          setDraft(current => (current === submittedDraft ? '' : current));
          void clearDraft(runId, nodeId).then(
            () => {
              lastKnownServerDraftRef.current = '';
            },
            () => {
              // Best-effort; a later save reconciles.
            }
          );
          fieldRef.current?.focus();
        },
        (error: unknown): void => {
          if (attemptGenerationRef.current !== attemptGen) return;
          setDock(current => resolveSendNowFailure(current, toSteeringRefusal(error)));
          // The draft never left the field; re-establish it on the server
          // since the debounce that would have done so was just cancelled.
          void saveDraft(runId, nodeId, { message: submittedDraft }).then(
            () => {
              lastKnownServerDraftRef.current = submittedDraft;
            },
            () => {
              // Best-effort; a later save reconciles.
            }
          );
        }
      );
      return;
    }
    const begun = beginGuidanceSubmission(dock, draft);
    setDock(begun.state);
    void send(runId, nodeId, {
      message: draft,
      message_id: begun.messageId,
      intent: 'queue',
    }).then(
      (receipt): void => {
        if (attemptGenerationRef.current !== attemptGen) return;
        setDock(current => resolveGuidanceSuccess(current, receipt));
        // The field stays editable while the POST is in flight. Clear only the
        // text that was accepted; preserve anything the operator typed next.
        setDraft(current => (current === submittedDraft ? '' : current));
        void clearDraft(runId, nodeId).then(
          () => {
            lastKnownServerDraftRef.current = '';
          },
          () => {
            // Best-effort; a later save reconciles.
          }
        );
        fieldRef.current?.focus();
      },
      (error: unknown): void => {
        if (attemptGenerationRef.current !== attemptGen) return;
        setDock(current => resolveGuidanceFailure(current, toSteeringRefusal(error)));
        void saveDraft(runId, nodeId, { message: submittedDraft }).then(
          () => {
            lastKnownServerDraftRef.current = submittedDraft;
          },
          () => {
            // Best-effort; a later save reconciles.
          }
        );
      }
    );
  };

  const stop = (): void => {
    if (dock.interruptInFlight || dock.subState !== 'generating') return;
    const attemptGen = attemptGenerationRef.current;
    setDock(current => beginInterrupt(current));
    void interrupt(runId, nodeId).then(
      (response): void => {
        if (attemptGenerationRef.current !== attemptGen) return;
        setDock(current => resolveInterruptOutcome(current, response.sub_state));
        if (response.sub_state === 'idle-after-interrupt') {
          focusLastRowRef.current?.();
        }
      },
      (error: unknown): void => {
        if (attemptGenerationRef.current !== attemptGen) return;
        setDock(current =>
          resolveInterruptError(
            current,
            toSteeringRefusal(error, STEERING_INTERRUPT_FAILED_MESSAGE)
          )
        );
      }
    );
  };

  const withdrawMessage = (messageId: string): void => {
    // One active withdraw per dock — a second click while one is in flight
    // issues no request.
    if (dock.withdrawingMessageId !== null) return;
    const attemptGen = attemptGenerationRef.current;
    pendingFocusRef.current = nextFocusAfterRemoval(
      dock.sent
        .filter(receipt => isQueueItemClaimable(receipt.state))
        .map(receipt => receipt.messageId),
      messageId
    );
    setDock(current => beginWithdraw(current, messageId));
    void withdraw(runId, nodeId, messageId).then(
      (): void => {
        if (attemptGenerationRef.current !== attemptGen) return;
        setDock(current => resolveWithdrawSuccess(current, messageId));
      },
      (error: unknown): void => {
        if (attemptGenerationRef.current !== attemptGen) return;
        pendingFocusRef.current = null;
        setDock(current => resolveWithdrawFailure(current, messageId, toSteeringRefusal(error)));
      }
    );
  };

  const sendQueuedMessageNow = (item: { messageId: string; message: string }): void => {
    if (dock.sendingNowMessageId !== null) return;
    const attemptGen = attemptGenerationRef.current;
    setDock(current => beginSendNowItem(current, item.messageId));
    void send(runId, nodeId, {
      message: item.message,
      message_id: crypto.randomUUID(),
      intent: 'send_now',
      queued_message_id: item.messageId,
    }).then(
      (): void => {
        if (attemptGenerationRef.current !== attemptGen) return;
        setDock(current => resolveSendNowItemSuccess(current, item.messageId));
      },
      (error: unknown): void => {
        if (attemptGenerationRef.current !== attemptGen) return;
        setDock(current =>
          resolveSendNowItemFailure(current, item.messageId, toSteeringRefusal(error))
        );
      }
    );
  };

  if (mode === 'hidden') return null;

  if (mode === 'recovery-required') {
    const pendingCount = pendingQueueCount(dock.sent);
    return (
      <section
        aria-label={queueBandHeader(pendingCount)}
        className="flex-none border-t border-border bg-surface-elevated"
      >
        {dock.sent.length === 0 ? null : (
          <>
            <QueueBandHeader
              label={queueBandHeader(pendingCount)}
              savedLine={savedToServerLine(dock.autoSend)}
              open={queueBandOpen}
              onToggle={(): void => {
                setQueueBandOpen(value => !value);
              }}
              bodyId={queueBodyId}
            />
            <div
              id={queueBodyId}
              hidden={!queueBandOpen}
              className="max-h-[33vh] overflow-y-auto px-[10px] pb-[8px] pt-[2px]"
            >
              <ul aria-label={queueListLabel(pendingCount)}>
                {dock.sent.map((receipt, index) => (
                  <QueueBandItem
                    key={receipt.messageId}
                    dataMessageId={receipt.messageId}
                    ord={index + 1}
                    text={receipt.message}
                    accent={false}
                  >
                    {queueItemStatusLabel(receipt.state) === null ? null : (
                      <span className="flex-none">{queueItemStatusLabel(receipt.state)}</span>
                    )}
                  </QueueBandItem>
                ))}
              </ul>
            </div>
          </>
        )}
        <p
          role="alert"
          tabIndex={-1}
          className="border-t border-border px-[10px] py-[8px] font-mono text-[10.5px] leading-[1.45] text-text-secondary"
        >
          {STEERING_RECOVERY_DISCLOSURE}
        </p>
      </section>
    );
  }

  if (mode === 'detached') {
    return (
      <div className="flex-none border-t border-border bg-surface-elevated px-[10px] py-[8px]">
        <p
          role="alert"
          ref={detachedAlertRef}
          tabIndex={-1}
          className="font-mono text-[10.5px] leading-[1.45] text-text-secondary"
        >
          {STEERING_DETACHED_DISCLOSURE}
        </p>
      </div>
    );
  }

  if (mode === 'finished' && finishedEntries.length > 0) {
    const neverSentEntries = dock.neverSent ?? [];
    const draftOrd = dock.sent.length + neverSentEntries.length + 1;
    return (
      <section
        aria-label={neverSentBandHeader(finishedEntries.length)}
        className="flex-none border-t border-border bg-surface-elevated"
      >
        <QueueBandHeader
          label={neverSentBandHeader(finishedEntries.length)}
          savedLine={null}
          open={queueBandOpen}
          onToggle={(): void => {
            setQueueBandOpen(value => !value);
          }}
          bodyId={queueBodyId}
        />
        <div
          id={queueBodyId}
          hidden={!queueBandOpen}
          className="max-h-[33vh] overflow-y-auto px-[10px] pb-[8px] pt-[2px]"
        >
          <ul aria-label={neverSentListLabel(finishedEntries.length)}>
            {dock.sent.map((receipt, index) => (
              <QueueBandItem
                key={receipt.messageId}
                dataMessageId={receipt.messageId}
                ord={index + 1}
                text={receipt.message}
                accent={false}
              >
                {queueItemStatusLabel(receipt.state) === null ? null : (
                  <span className="flex-none">{queueItemStatusLabel(receipt.state)}</span>
                )}
              </QueueBandItem>
            ))}
            {neverSentEntries.map((entry, index) => (
              <QueueBandItem
                key={entry.messageId ?? `never-sent-${String(index)}`}
                dataMessageId={entry.messageId ?? undefined}
                ord={dock.sent.length + index + 1}
                text={entry.message}
                accent={false}
              />
            ))}
            {draft.trim().length > 0 ? (
              <QueueBandItem key="never-sent-draft" ord={draftOrd} text={draft} accent={false} />
            ) : null}
          </ul>
        </div>
        <p
          ref={neverSentAlertRef}
          role="alert"
          className="border-t border-border px-[10px] py-[8px] font-mono text-[10.5px] leading-[1.45] text-text-secondary"
        >
          {neverSentDisclosure(idleAwaitExpired)}
        </p>
      </section>
    );
  }

  if (mode === 'finished-iteration' && usableFinishedIteration !== null) {
    const liveIteration = usableFinishedIteration.liveIteration;
    const liveRowId = usableFinishedIteration.liveRowId;
    return (
      <>
        <div className="flex-none border-t border-border bg-surface-elevated px-[10px] py-[8px]">
          <div className="flex min-w-0 items-start gap-3">
            <p className="min-w-0 flex-1 font-mono text-[10.5px] leading-[1.45] text-text-secondary">
              {finishedIterationDisclosure(liveIteration)}
            </p>
            <button
              type="button"
              ref={goButtonRef}
              onClick={(): void => {
                onSelectLiveRow?.(liveRowId);
              }}
              className={cn(
                'min-h-[32px] flex-none shrink-0 rounded-md border border-border bg-transparent',
                'px-3 font-mono text-[11px] text-text-primary hover:bg-surface-inset',
                'transition-colors motion-reduce:transition-none',
                'focus-visible:outline-2 focus-visible:outline-accent-bright focus-visible:-outline-offset-2'
              )}
            >
              {goToIterationLabel(liveIteration)}
            </button>
          </div>
          {readDetached ? (
            <p
              role="alert"
              className="mt-[6px] font-mono text-[10.5px] leading-[1.45] text-text-secondary"
            >
              {STEERING_DETACHED_DISCLOSURE}
            </p>
          ) : null}
          {readNotify !== null ? (
            <p role="alert" className={REFUSAL_CLASSES}>
              {readNotify}
            </p>
          ) : null}
        </div>
        {dock.sent.length === 0 ? null : (
          <section
            aria-label={
              allPendingDispatching(dock.sent)
                ? sendingBandHeader(dock.sent.length)
                : queueBandHeader(pendingQueueCount(dock.sent))
            }
            className="flex-none border-t border-border bg-surface-elevated"
          >
            <QueueBandHeader
              label={
                allPendingDispatching(dock.sent)
                  ? sendingBandHeader(dock.sent.length)
                  : queueBandHeader(pendingQueueCount(dock.sent))
              }
              savedLine={null}
              open={queueBandOpen}
              onToggle={(): void => {
                setQueueBandOpen(value => !value);
              }}
              bodyId={queueBodyId}
            />
            <div
              id={queueBodyId}
              hidden={!queueBandOpen}
              className="max-h-[33vh] overflow-y-auto px-[10px] pb-[8px] pt-[2px]"
            >
              <ul
                aria-label={
                  allPendingDispatching(dock.sent)
                    ? sendingListLabel(dock.sent.length)
                    : queueListLabel(pendingQueueCount(dock.sent))
                }
              >
                {dock.sent.map((receipt, index) => (
                  <QueueBandItem
                    key={receipt.messageId}
                    dataMessageId={receipt.messageId}
                    ord={index + 1}
                    text={receipt.message}
                    accent={false}
                  >
                    {queueItemStatusLabel(receipt.state) === null ? null : (
                      <span className="flex-none">{queueItemStatusLabel(receipt.state)}</span>
                    )}
                  </QueueBandItem>
                ))}
              </ul>
            </div>
          </section>
        )}
      </>
    );
  }

  const blocked = mode === 'blocked';
  const idle = agentMode === 'idle';
  const pendingCount = pendingQueueCount(dock.sent);
  const statusText =
    blocked && blockedReason !== null
      ? blockedReason
      : (dock.notice ?? (pendingCount > 0 ? queuedCountPhrase(pendingCount) : ''));
  const showStop = agentMode === 'generating' || agentMode === 'interrupting';
  const stopping = agentMode === 'interrupting';
  // Per-item Send now is honest only while the turn genuinely accepts a
  // mid-turn message: generating, on a provider with proven soft injection,
  // and only for a row the server can still claim.
  const canSendItemNow = dock.softInjection && agentMode === 'generating';

  const queueBandLabel = allPendingDispatching(dock.sent)
    ? sendingBandHeader(dock.sent.length)
    : idle
      ? willSendBandHeader(pendingCount)
      : queueBandHeader(pendingCount);

  return (
    <>
      {dock.sent.length === 0 ? null : (
        <section
          aria-label={queueBandLabel}
          className="flex-none border-t border-border bg-surface-elevated"
        >
          <QueueBandHeader
            label={queueBandLabel}
            savedLine={savedToServerLine(dock.autoSend)}
            open={queueBandOpen}
            onToggle={(): void => {
              setQueueBandOpen(value => !value);
            }}
            bodyId={queueBodyId}
          />
          <div
            id={queueBodyId}
            hidden={!queueBandOpen}
            className="max-h-[33vh] overflow-y-auto px-[10px] pb-[8px] pt-[2px]"
          >
            <ul
              aria-label={
                allPendingDispatching(dock.sent)
                  ? sendingListLabel(dock.sent.length)
                  : idle
                    ? willSendListLabel(pendingCount)
                    : queueListLabel(pendingCount)
              }
            >
              {dock.sent.map((receipt, index) => {
                const claimable = isQueueItemClaimable(receipt.state);
                const statusLabel = queueItemStatusLabel(receipt.state);
                return (
                  <QueueBandItem
                    key={receipt.messageId}
                    dataMessageId={receipt.messageId}
                    ord={index + 1}
                    text={receipt.message}
                    accent={index === 0}
                  >
                    {statusLabel === null ? null : <span className="flex-none">{statusLabel}</span>}
                    {claimable && canSendItemNow ? (
                      <button
                        type="button"
                        aria-label={sendNowItemAccessibleName(receipt.message)}
                        aria-disabled={dock.sendingNowMessageId !== null ? true : undefined}
                        onClick={(): void => {
                          sendQueuedMessageNow(receipt);
                        }}
                        className={cn(
                          'min-h-[24px] flex-none whitespace-nowrap rounded-md border border-border px-[7px] font-sans text-[10.5px]',
                          'text-text-secondary hover:border-border-bright hover:text-text-primary',
                          'focus-visible:outline-2 focus-visible:outline-accent-bright focus-visible:-outline-offset-2'
                        )}
                      >
                        {STEERING_SEND_NOW_ITEM_LABEL}
                      </button>
                    ) : null}
                    {claimable ? (
                      <button
                        type="button"
                        ref={(el): void => {
                          if (el === null) {
                            deleteButtonsRef.current.delete(receipt.messageId);
                          } else {
                            deleteButtonsRef.current.set(receipt.messageId, el);
                          }
                        }}
                        aria-label={deleteButtonAccessibleName(receipt.message)}
                        aria-disabled={dock.withdrawingMessageId !== null ? true : undefined}
                        onClick={(): void => {
                          withdrawMessage(receipt.messageId);
                        }}
                        className={cn(
                          'min-h-[24px] min-w-[24px] flex-none rounded-md px-2 font-mono text-[11px]',
                          'text-text-secondary hover:bg-surface-inset',
                          'focus-visible:outline-2 focus-visible:outline-accent-bright focus-visible:-outline-offset-2'
                        )}
                      >
                        {STEERING_DELETE_LABEL}
                      </button>
                    ) : null}
                  </QueueBandItem>
                );
              })}
            </ul>
          </div>
        </section>
      )}
      <div
        ref={wellRef}
        onFocusCapture={(): void => {
          focusInsideRef.current = true;
        }}
        onBlurCapture={(event): void => {
          if (
            event.relatedTarget instanceof Node &&
            event.currentTarget.contains(event.relatedTarget)
          ) {
            return;
          }
          focusInsideRef.current = false;
        }}
        className="flex-none border-t border-border bg-surface-elevated px-[10px] py-[8px]"
      >
        {idle ? (
          <>
            <p className="mb-[6px] font-mono text-[10.5px] leading-[1.45] text-text-secondary">
              {STEERING_INTERRUPT_DISCLOSURE}
            </p>
            <p className="mb-[6px] font-mono text-[10.5px] leading-[1.45] text-text-secondary">
              {STEERING_IDLE_AWAIT_DISCLOSURE}
            </p>
          </>
        ) : null}
        <label htmlFor={fieldId} className="sr-only">
          message to {nodeLabel}
        </label>
        <textarea
          id={fieldId}
          ref={fieldRef}
          value={draft}
          rows={2}
          placeholder="Message the agent…"
          onChange={(event): void => {
            userEditedRef.current = true;
            setDraft(event.target.value);
          }}
          onFocus={(): void => {
            if (agentMode === 'idle') {
              coalescerRef.current?.touch();
            }
          }}
          onKeyDown={(event): void => {
            const shortcut = {
              key: event.key,
              metaKey: event.metaKey,
              ctrlKey: event.ctrlKey,
              isComposing: event.nativeEvent.isComposing,
              keyCode: event.keyCode,
            };
            if (isQueueShortcut(shortcut)) {
              event.preventDefault();
              submit();
              return;
            }
            if (agentMode === 'idle' && isKeepaliveActivityKey(shortcut)) {
              coalescerRef.current?.touch();
            }
          }}
          className={FIELD_CLASSES}
        />
        {dock.refusal === null ? null : (
          <p role="alert" className={REFUSAL_CLASSES}>
            {dock.refusal.message}
          </p>
        )}
        {blocked && blockedReason !== null ? (
          <p id={reasonId} className={BLOCKED_REASON_CLASSES}>
            {blockedReason}
          </p>
        ) : null}
        <div className="mt-[6px] flex items-center gap-3">
          {showStop ? (
            <button
              type="button"
              aria-disabled={stopping ? true : undefined}
              onClick={stop}
              className={cn(
                CONTROL_BASE_CLASSES,
                stopping ? CONTROL_DISABLED_CLASSES : CONTROL_ENABLED_CLASSES
              )}
            >
              {stopping ? 'Stopping…' : 'Stop'}
            </button>
          ) : null}
          <p className="min-w-0 flex-1 font-mono text-[10.5px] leading-[1.45] text-text-secondary">
            {STEERING_SEND_HINT}
          </p>
          <button
            type="button"
            aria-label={
              idle
                ? sendNowButtonAccessibleName(pendingCount)
                : queueButtonAccessibleName(pendingCount)
            }
            aria-keyshortcuts="Meta+Enter Control+Enter"
            aria-disabled={canSubmit ? undefined : true}
            aria-describedby={blocked ? reasonId : undefined}
            onClick={submit}
            className={cn(
              CONTROL_BASE_CLASSES,
              'min-w-[84px]',
              canSubmit ? CONTROL_ENABLED_CLASSES : CONTROL_DISABLED_CLASSES
            )}
          >
            {idle ? 'Send now' : 'Queue'}
          </button>
        </div>
        <div role="status" className="sr-only">
          {statusText}
        </div>
      </div>
    </>
  );
}
