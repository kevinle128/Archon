/**
 * Steering composer dock for the Legacy node room: guarded send into the
 * run's process-local steering queue, plus the Story 2.3 turn model —
 * `Stop` interrupts the agent's current generation, `Send now` delivers a
 * typed message on the same session once the agent is idle-after-interrupt.
 * The POST response is the only queue evidence — no polling, no queue read,
 * no rehydration (Story 2.9 owns that later). Sent receipts are in-memory
 * only; the unsent draft and ambiguous retry id persist in sessionStorage
 * scoped by run + namespaced node id.
 */
import { useEffect, useId, useRef, useState } from 'react';

import {
  interruptNode,
  sendNodeGuidance,
  type InterruptWorkflowNodeResponse,
  type SendWorkflowNodeBody,
  type SendWorkflowNodeResponse,
  type WorkflowNodeStateResponse,
} from '@/lib/api';
import {
  beginGuidanceSubmission,
  beginInterrupt,
  beginSendNow,
  canSubmitGuidance,
  createSteeringDockState,
  isQueueShortcut,
  loadSteeringDraft,
  queueBandHeader,
  queueButtonAccessibleName,
  queueListLabel,
  resolveGuidanceFailure,
  resolveGuidanceSuccess,
  resolveInterruptError,
  resolveInterruptOutcome,
  resolveSendNowFailure,
  resolveSendNowSuccess,
  saveSteeringDraft,
  sendNowButtonAccessibleName,
  steeringAgentMode,
  steeringBlockedReason,
  steeringDockMode,
  steeringDraftStorageKey,
  syncProjectedSubState,
  STEERING_DETACHED_DISCLOSURE,
  STEERING_INTERRUPT_DISCLOSURE,
  STEERING_INTERRUPT_FAILED_MESSAGE,
  STEERING_SEND_HINT,
  toSteeringRefusal,
  willSendBandHeader,
  willSendListLabel,
  type SteeringDockState,
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
  send?: SendNodeGuidance;
  interrupt?: InterruptNode;
  storage?: Storage;
  /**
   * Focuses the last rendered transcript row (scroller fallback) when the
   * Stop control or the whole dock leaves the DOM — focus must never land
   * on `<body>`.
   */
  focusLastRow?: () => void;
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

/** Modes where the dock's focusable controls are in the DOM. */
function controlsMounted(mode: 'hidden' | 'blocked' | 'detached' | 'composer'): boolean {
  return mode === 'composer' || mode === 'blocked';
}

export function ComposerDock({
  runId,
  nodeId,
  nodeLabel,
  rowStatus,
  live,
  hasPendingAsk,
  subState,
  send = sendNodeGuidance,
  interrupt = interruptNode,
  storage,
  focusLastRow,
}: ComposerDockProps): React.ReactElement | null {
  const store = storage ?? (typeof sessionStorage === 'undefined' ? undefined : sessionStorage);
  const storageKey = steeringDraftStorageKey(runId, nodeId);
  const fieldId = useId();
  const reasonId = useId();
  const bandHeaderId = useId();
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const wellRef = useRef<HTMLDivElement>(null);

  const [dock, setDock] = useState<SteeringDockState>(() => ({
    ...createSteeringDockState(subState),
    pendingRetry: loadSteeringDraft(store, storageKey).pendingRetry,
  }));
  const [draft, setDraft] = useState<string>(() => loadSteeringDraft(store, storageKey).draft);

  // Receipts live for the mounted execution only; a scope change resets them
  // while the persisted draft for the new scope hydrates from storage.
  const prevScopeRef = useRef(storageKey);
  useEffect(() => {
    if (prevScopeRef.current === storageKey) return;
    prevScopeRef.current = storageKey;
    const saved = loadSteeringDraft(store, storageKey);
    setDraft(saved.draft);
    setDock({ ...createSteeringDockState(subState), pendingRetry: saved.pendingRetry });
  }, [storageKey, store, subState]);

  useEffect(() => {
    saveSteeringDraft(store, storageKey, { draft, pendingRetry: dock.pendingRetry });
  }, [store, storageKey, draft, dock.pendingRetry]);

  // The projected sub-state is authoritative; the local interrupting
  // transient yields to it when a defined projection arrives.
  useEffect(() => {
    setDock(current => syncProjectedSubState(current, subState));
  }, [subState]);

  const mode = steeringDockMode({ rowStatus, live, hasPendingAsk, refusal: dock.refusal });

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

  if (mode === 'hidden') return null;

  if (mode === 'detached') {
    return (
      <div className="flex-none border-t border-border bg-surface-elevated px-[10px] py-[8px]">
        <p role="alert" className="font-mono text-[10.5px] leading-[1.45] text-text-secondary">
          {STEERING_DETACHED_DISCLOSURE}
        </p>
      </div>
    );
  }

  const blocked = mode === 'blocked';
  const idle = agentMode === 'idle';
  const statusText = blocked && blockedReason !== null ? blockedReason : (dock.notice ?? '');
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
                ? sendNowButtonAccessibleName(dock.sent.length)
                : queueButtonAccessibleName(dock.sent.length)
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
