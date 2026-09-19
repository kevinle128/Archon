/**
 * Story 2.1 queue composer dock for the Console node room: guarded send into
 * the run's process-local steering queue while the selected agent node is
 * generating. Mirrors the Legacy ComposerDock semantics through console-owned
 * seams — the POST response is the only queue evidence (no polling, no queue
 * read, no rehydration). Sent receipts are in-memory only; the unsent draft
 * and ambiguous retry id persist in sessionStorage scoped by run + node id.
 *
 * The console-wide `.console-root :focus-visible` ring (--accent-ring at 0.3
 * alpha) composites to ~2:1 on the dock surfaces — under the 3:1 non-text
 * floor — so the dock's focusables declare the explicit accent-bright ring
 * used by ConsoleTodoStrip and other high-contrast console controls.
 */
import { useEffect, useId, useRef, useState } from 'react';

import {
  beginGuidanceSubmission,
  canSubmitGuidance,
  createSteeringDockState,
  isQueueShortcut,
  loadSteeringDraft,
  queueBandHeader,
  queueButtonAccessibleName,
  queueListLabel,
  queuedCountPhrase,
  resolveGuidanceFailure,
  resolveGuidanceSuccess,
  saveSteeringDraft,
  steeringBlockedReason,
  steeringDockMode,
  steeringDraftStorageKey,
  STEERING_DETACHED_DISCLOSURE,
  STEERING_SEND_HINT,
  toSteeringRefusal,
  type SteeringDockState,
} from '@/lib/steering-dock';

import {
  sendNodeGuidance,
  type SendWorkflowNodeBody,
  type SendWorkflowNodeResponse,
  type WorkflowNodeState,
} from '../skills/runs';

export type SendNodeGuidance = (
  runId: string,
  nodeId: string,
  body: SendWorkflowNodeBody
) => Promise<SendWorkflowNodeResponse>;

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
  send?: SendNodeGuidance;
  storage?: Storage;
}

const FIELD_CLASSES = [
  'min-h-[56px] w-full resize-none rounded-md border border-border bg-surface-inset',
  'px-[10px] py-[8px] font-sans text-[13px] leading-[1.45] text-text-primary',
  'focus-visible:outline-2 focus-visible:outline-accent-bright! focus-visible:outline-offset-2',
].join(' ');

const BLOCKED_REASON_CLASSES =
  'mt-[6px] font-mono text-[10.5px] leading-[1.45] text-text-secondary';
const REFUSAL_CLASSES = 'mt-[6px] font-mono text-[10.5px] leading-[1.45] text-error';

export function ConsoleComposerDock({
  runId,
  nodeId,
  nodeLabel,
  rowStatus,
  live,
  hasPendingAsk,
  send = sendNodeGuidance,
  storage,
}: ConsoleComposerDockProps): React.ReactElement | null {
  const store = storage ?? (typeof sessionStorage === 'undefined' ? undefined : sessionStorage);
  const storageKey = steeringDraftStorageKey(runId, nodeId);
  const fieldId = useId();
  const reasonId = useId();
  const bandHeaderId = useId();
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  const [dock, setDock] = useState<SteeringDockState>(() => ({
    ...createSteeringDockState(),
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
    setDock({ ...createSteeringDockState(), pendingRetry: saved.pendingRetry });
  }, [storageKey, store]);

  useEffect(() => {
    saveSteeringDraft(store, storageKey, { draft, pendingRetry: dock.pendingRetry });
  }, [store, storageKey, draft, dock.pendingRetry]);

  const mode = steeringDockMode({ rowStatus, live, hasPendingAsk, refusal: dock.refusal });
  const blockedReason = steeringBlockedReason({ rowStatus, hasPendingAsk });

  const submit = (): void => {
    if (!canSubmitGuidance({ mode, inFlight: dock.inFlight, draft })) return;
    const submittedDraft = draft;
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
  const statusText =
    blocked && blockedReason !== null
      ? blockedReason
      : dock.sent.length > 0
        ? queuedCountPhrase(dock.sent.length)
        : '';

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
            {queueBandHeader(dock.sent.length)}
          </h3>
          <div className="max-h-[33vh] overflow-y-auto px-[10px] pb-[8px] pt-[2px]">
            <ul aria-label={queueListLabel(dock.sent.length)}>
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
      <div className="flex-none border-t border-border bg-surface-elevated px-[10px] py-[8px]">
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
          <p className="min-w-0 flex-1 font-mono text-[10.5px] leading-[1.45] text-text-secondary">
            {STEERING_SEND_HINT}
          </p>
          <button
            type="button"
            aria-label={queueButtonAccessibleName(dock.sent.length)}
            aria-keyshortcuts="Meta+Enter Control+Enter"
            aria-disabled={blocked ? true : undefined}
            aria-describedby={blocked ? reasonId : undefined}
            onClick={submit}
            className={[
              'min-h-[32px] min-w-[84px] flex-none rounded-md border border-border bg-transparent',
              'px-3 font-mono text-[11px]',
              blocked ? 'text-text-secondary' : 'text-text-primary hover:bg-surface-inset',
              'transition-colors motion-reduce:transition-none',
              'focus-visible:outline-2 focus-visible:outline-accent-bright! focus-visible:outline-offset-2',
            ].join(' ')}
          >
            Queue
          </button>
        </div>
        <div role="status" className="sr-only">
          {statusText}
        </div>
      </div>
    </>
  );
}
