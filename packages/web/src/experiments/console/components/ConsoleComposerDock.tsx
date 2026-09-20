/**
 * Steering composer dock for the Console node room: guarded send into the
 * run's process-local steering queue, plus the Story 2.3 turn model —
 * `Stop` interrupts the agent's current generation, `Send now` delivers a
 * typed message on the same session once the agent is idle-after-interrupt.
 * Story 2.9 hydrates and reconciles the shared registry queue via a serial
 * abortable poll; local POST/DELETE responses still update immediately.
 * Mirrors the Legacy ComposerDock semantics through console-owned seams.
 * Sent receipts are in-memory; the unsent draft and ambiguous retry id
 * persist in sessionStorage scoped by run + node id. Story 2.10 adds a
 * read-only finished-iteration branch (GET poll only).
 *
 * The console-wide `.console-root :focus-visible` ring (--accent-ring at 0.3
 * alpha) composites to ~2:1 on the dock surfaces — under the 3:1 non-text
 * floor — so the dock's focusables declare the explicit accent-bright ring
 * used by ConsoleTodoStrip and other high-contrast console controls.
 */
import { useEffect, useId, useRef, useState } from 'react';

import {
  applyQueueSnapshot,
  beginGuidanceSubmission,
  beginInterrupt,
  beginSendNow,
  beginWithdraw,
  canSubmitGuidance,
  createSteeringDockState,
  deleteButtonAccessibleName,
  finishedIterationDisclosure,
  focusTargetAfterSnapshot,
  goToIterationLabel,
  isQueueShortcut,
  loadSteeringDraft,
  nextFocusAfterRemoval,
  queueBandHeader,
  queueButtonAccessibleName,
  queueListLabel,
  queuedCountPhrase,
  resolveGuidanceFailure,
  resolveGuidanceSuccess,
  resolveInterruptError,
  resolveInterruptOutcome,
  resolveSendNowFailure,
  resolveSendNowSuccess,
  resolveWithdrawFailure,
  resolveWithdrawSuccess,
  saveSteeringDraft,
  sendNowButtonAccessibleName,
  startQueuePolling,
  steeringAgentMode,
  steeringBlockedReason,
  steeringDockMode,
  steeringDraftStorageKey,
  syncProjectedSubState,
  STEERING_DELETE_LABEL,
  STEERING_DETACHED_DISCLOSURE,
  STEERING_INTERRUPT_DISCLOSURE,
  STEERING_INTERRUPT_FAILED_MESSAGE,
  STEERING_SEND_HINT,
  toSteeringRefusal,
  willSendBandHeader,
  willSendListLabel,
  toSteeringRequestError,
  type RemovalFocusTarget,
  type SteeringDockState,
  type SteeringSubState,
} from '@/lib/steering-dock';
import type { FinishedIterationView } from '@/lib/execution-room-model';

import {
  interruptNode,
  readNodeGuidanceQueue,
  sendNodeGuidance,
  withdrawNodeGuidance,
  type InterruptWorkflowNodeResponse,
  type ReadWorkflowNodeQueueResponse,
  type SendWorkflowNodeBody,
  type SendWorkflowNodeResponse,
  type WithdrawWorkflowNodeResponse,
  type WorkflowNodeState,
} from '../skills/runs';

export type SendNodeGuidance = (
  runId: string,
  nodeId: string,
  body: SendWorkflowNodeBody
) => Promise<SendWorkflowNodeResponse>;

export type InterruptNode = (
  runId: string,
  nodeId: string
) => Promise<InterruptWorkflowNodeResponse>;

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

export interface ConsoleComposerDockProps {
  runId: string;
  /** Namespaced node id — the send route segment and draft scope key. */
  nodeId: string;
  /** Display label for the field's accessible name. */
  nodeLabel: string;
  rowStatus: WorkflowNodeState['status'];
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
  send?: SendNodeGuidance;
  interrupt?: InterruptNode;
  withdraw?: WithdrawNodeGuidance;
  /** Queue snapshot reader; defaults to the Console API helper. */
  readQueue?: ReadNodeGuidanceQueue;
  /** Poll cadence in ms; production default 1000, narrow test seam only. */
  pollIntervalMs?: number;
  storage?: Storage;
  /**
   * Focuses the last rendered transcript row (scroller fallback) when the
   * Stop control or the whole dock leaves the DOM — focus must never land
   * on `<body>`.
   */
  focusLastRow?: () => void;
}

const FIELD_CLASSES = [
  'min-h-[56px] w-full resize-none rounded-md border border-border bg-surface-inset',
  'px-[10px] py-[8px] font-sans text-[13px] leading-[1.45] text-text-primary',
  'focus-visible:outline-2 focus-visible:outline-accent-bright! focus-visible:outline-offset-2',
].join(' ');

const CONTROL_BASE_CLASSES = [
  'min-h-[32px] flex-none rounded-md border bg-transparent px-3 font-mono text-[11px]',
  'transition-colors motion-reduce:transition-none',
  'focus-visible:outline-2 focus-visible:outline-accent-bright! focus-visible:outline-offset-2',
].join(' ');
const CONTROL_ENABLED_CLASSES = 'border-border-bright text-text-primary hover:bg-surface-inset';
const CONTROL_DISABLED_CLASSES = 'border-border text-text-secondary';

const BLOCKED_REASON_CLASSES =
  'mt-[6px] font-mono text-[10.5px] leading-[1.45] text-text-secondary';
const REFUSAL_CLASSES = 'mt-[6px] font-mono text-[10.5px] leading-[1.45] text-error';

/** Modes where the dock's focusable controls are in the DOM. */
function controlsMounted(
  mode: 'hidden' | 'blocked' | 'detached' | 'composer' | 'finished-iteration'
): boolean {
  return mode === 'composer' || mode === 'blocked';
}

export function ConsoleComposerDock({
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
  send = sendNodeGuidance,
  interrupt = interruptNode,
  withdraw = withdrawNodeGuidance,
  readQueue = readNodeGuidanceQueue,
  pollIntervalMs = 1000,
  storage,
  focusLastRow,
}: ConsoleComposerDockProps): React.ReactElement | null {
  const store = storage ?? (typeof sessionStorage === 'undefined' ? undefined : sessionStorage);
  const storageKey = steeringDraftStorageKey(runId, nodeId);
  const fieldId = useId();
  const reasonId = useId();
  const bandHeaderId = useId();
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const wellRef = useRef<HTMLDivElement>(null);
  const goButtonRef = useRef<HTMLButtonElement>(null);
  const deleteButtonsRef = useRef<Map<string, HTMLButtonElement>>(new Map());
  const pendingFocusRef = useRef<RemovalFocusTarget | null>(null);
  const detachedAlertRef = useRef<HTMLParagraphElement>(null);
  const dockRef = useRef<SteeringDockState>(createSteeringDockState(subState));

  const [dock, setDock] = useState<SteeringDockState>(() => ({
    ...createSteeringDockState(subState),
    pendingRetry: loadSteeringDraft(store, storageKey).pendingRetry,
  }));
  const [draft, setDraft] = useState<string>(() => loadSteeringDraft(store, storageKey).draft);
  /** Finished-iteration poll 422: show detached alert without leaving the mode. */
  const [readDetached, setReadDetached] = useState(false);
  /** Finished-iteration other 4xx notify copy (poll stopped). */
  const [readNotify, setReadNotify] = useState<string | null>(null);
  dockRef.current = dock;

  // Receipts live for the mounted execution only; a scope change resets them
  // while the persisted draft for the new scope hydrates from storage.
  const prevScopeRef = useRef(storageKey);
  useEffect(() => {
    if (prevScopeRef.current === storageKey) return;
    prevScopeRef.current = storageKey;
    const saved = loadSteeringDraft(store, storageKey);
    setDraft(saved.draft);
    setDock({ ...createSteeringDockState(subState), pendingRetry: saved.pendingRetry });
    setReadDetached(false);
    setReadNotify(null);
  }, [storageKey, store, subState]);

  useEffect(() => {
    saveSteeringDraft(store, storageKey, { draft, pendingRetry: dock.pendingRetry });
  }, [store, storageKey, draft, dock.pendingRetry]);

  // The projected sub-state is authoritative; the local interrupting
  // transient yields to it when a defined projection arrives.
  useEffect(() => {
    setDock(current => syncProjectedSubState(current, subState));
  }, [subState]);

  // A host without a selection callback must never show an enabled Go control.
  const usableFinishedIteration =
    finishedIteration !== null && finishedIteration !== undefined && onSelectLiveRow !== undefined
      ? finishedIteration
      : null;

  const mode = steeringDockMode({
    rowStatus,
    live,
    hasPendingAsk,
    refusal: dock.refusal,
    finishedIteration: usableFinishedIteration,
  });
  // Shared-queue reads while composer/blocked/finished-iteration are mounted.
  // Hidden historical/terminal rooms and send-triggered detached disclosures
  // never poll — Story 2.9 gives queue reads no capability-state transition.
  // finished-iteration polls GET only (no mutation handlers bound).
  const pollingEnabled = mode === 'composer' || mode === 'blocked' || mode === 'finished-iteration';

  useEffect(() => {
    if (!pollingEnabled) return;
    const finishedMode = mode === 'finished-iteration';
    return startQueuePolling({
      read: signal => readQueue(runId, nodeId, { signal }),
      currentGeneration: () => dockRef.current.queueGeneration,
      onSnapshot: (snapshot, generationAtRequest): void => {
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
          const previousIds = current.sent.map(receipt => receipt.messageId);
          const next = applyQueueSnapshot(current, snapshot, generationAtRequest);
          if (next === current) return current;
          const nextIds = next.sent.map(receipt => receipt.messageId);
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
  }, [runId, nodeId, readQueue, pollIntervalMs, pollingEnabled, mode]);

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
  const canSubmit = canSubmitGuidance({ mode, sendInFlight: dock.sendInFlight, draft });

  const submit = (): void => {
    if (!canSubmit) return;
    const submittedDraft = draft;
    if (agentMode === 'idle') {
      const begun = beginSendNow(dock, draft);
      setDock(begun.state);
      void send(runId, nodeId, {
        message: draft,
        message_id: begun.messageId,
        intent: 'send_now',
      }).then(
        (receipt): void => {
          setDock(current => resolveSendNowSuccess(current, receipt));
          setDraft(current => (current === submittedDraft ? '' : current));
          fieldRef.current?.focus();
        },
        (error: unknown): void => {
          setDock(current => resolveSendNowFailure(current, toSteeringRefusal(error)));
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
        setDock(current => resolveGuidanceSuccess(current, receipt));
        // The field stays editable while the POST is in flight. Clear only the
        // text that was accepted; preserve anything the operator typed next.
        setDraft(current => (current === submittedDraft ? '' : current));
        fieldRef.current?.focus();
      },
      (error: unknown): void => {
        setDock(current => resolveGuidanceFailure(current, toSteeringRefusal(error)));
      }
    );
  };

  const stop = (): void => {
    if (dock.interruptInFlight || dock.subState !== 'generating') return;
    setDock(current => beginInterrupt(current));
    void interrupt(runId, nodeId).then(
      (response): void => {
        setDock(current => resolveInterruptOutcome(current, response.sub_state));
        if (response.sub_state === 'idle-after-interrupt') {
          focusLastRowRef.current?.();
        }
      },
      (error: unknown): void => {
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
    pendingFocusRef.current = nextFocusAfterRemoval(
      dock.sent.map(receipt => receipt.messageId),
      messageId
    );
    setDock(current => beginWithdraw(current, messageId));
    void withdraw(runId, nodeId, messageId).then(
      (): void => {
        setDock(current => resolveWithdrawSuccess(current, messageId));
      },
      (error: unknown): void => {
        pendingFocusRef.current = null;
        setDock(current => resolveWithdrawFailure(current, messageId, toSteeringRefusal(error)));
      }
    );
  };

  if (mode === 'hidden') return null;

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
              className={[
                'min-h-[32px] flex-none shrink-0 rounded-md border border-border bg-transparent',
                'px-3 font-mono text-[11px] text-text-primary hover:bg-surface-inset',
                'transition-colors motion-reduce:transition-none',
                'focus-visible:outline-2 focus-visible:outline-accent-bright! focus-visible:outline-offset-2',
              ].join(' ')}
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
            aria-labelledby={bandHeaderId}
            className="flex-none border-t border-border bg-surface-elevated"
          >
            <h3
              id={bandHeaderId}
              className="px-[10px] pt-[6px] text-[10px] font-bold uppercase tracking-[0.07em] text-text-secondary"
            >
              {queueBandHeader(dock.sent.length)}
            </h3>
            <div className="max-h-[33vh] overflow-y-auto px-[10px] pb-[8px] pt-[2px]">
              <ul aria-label={queueListLabel(dock.sent.length)}>
                {dock.sent.map(receipt => (
                  <li
                    key={receipt.messageId}
                    data-message-id={receipt.messageId}
                    className="flex items-baseline gap-2 py-[1px] font-mono text-[11.5px] leading-[1.85] text-text-secondary"
                  >
                    <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                      {receipt.message}
                    </span>
                    <span className="flex-none">sent</span>
                  </li>
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
  const statusText =
    blocked && blockedReason !== null
      ? blockedReason
      : (dock.notice ?? (dock.sent.length > 0 ? queuedCountPhrase(dock.sent.length) : ''));
  const showStop = agentMode === 'generating' || agentMode === 'interrupting';
  const stopping = agentMode === 'interrupting';

  return (
    <>
      {dock.sent.length === 0 ? null : (
        <section
          aria-labelledby={bandHeaderId}
          className="flex-none border-t border-border bg-surface-elevated"
        >
          <h3
            id={bandHeaderId}
            className="px-[10px] pt-[6px] text-[10px] font-bold uppercase tracking-[0.07em] text-text-secondary"
          >
            {idle ? willSendBandHeader(dock.sent.length) : queueBandHeader(dock.sent.length)}
          </h3>
          <div className="max-h-[33vh] overflow-y-auto px-[10px] pb-[8px] pt-[2px]">
            <ul
              aria-label={
                idle ? willSendListLabel(dock.sent.length) : queueListLabel(dock.sent.length)
              }
            >
              {dock.sent.map(receipt => (
                <li
                  key={receipt.messageId}
                  data-message-id={receipt.messageId}
                  className="flex items-baseline gap-2 py-[1px] font-mono text-[11.5px] leading-[1.85] text-text-secondary"
                >
                  <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                    {receipt.message}
                  </span>
                  <span className="flex-none">sent</span>
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
                    className={[
                      'min-h-[24px] min-w-[24px] flex-none rounded-md px-2 font-mono text-[11px]',
                      'text-text-secondary hover:bg-surface-inset',
                      'focus-visible:outline-2 focus-visible:outline-accent-bright! focus-visible:outline-offset-2',
                    ].join(' ')}
                  >
                    {STEERING_DELETE_LABEL}
                  </button>
                </li>
              ))}
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
          <p className="mb-[6px] font-mono text-[10.5px] leading-[1.45] text-text-secondary">
            {STEERING_INTERRUPT_DISCLOSURE}
          </p>
        ) : null}
        <label htmlFor={fieldId} className="sr-only">
          message to {nodeLabel}
        </label>
        <textarea
          id={fieldId}
          ref={fieldRef}
          value={draft}
          rows={2}
          onChange={(event): void => {
            setDraft(event.target.value);
          }}
          onKeyDown={(event): void => {
            if (
              isQueueShortcut({
                key: event.key,
                metaKey: event.metaKey,
                ctrlKey: event.ctrlKey,
                isComposing: event.nativeEvent.isComposing,
                keyCode: event.keyCode,
              })
            ) {
              event.preventDefault();
              submit();
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
              className={[
                CONTROL_BASE_CLASSES,
                stopping ? CONTROL_DISABLED_CLASSES : CONTROL_ENABLED_CLASSES,
              ].join(' ')}
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
                ? sendNowButtonAccessibleName(dock.sent.length)
                : queueButtonAccessibleName(dock.sent.length)
            }
            aria-keyshortcuts="Meta+Enter Control+Enter"
            aria-disabled={canSubmit ? undefined : true}
            aria-describedby={blocked ? reasonId : undefined}
            onClick={submit}
            className={[
              CONTROL_BASE_CLASSES,
              'min-w-[84px]',
              canSubmit ? CONTROL_ENABLED_CLASSES : CONTROL_DISABLED_CLASSES,
            ].join(' ')}
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
