/**
 * Query boundary for a selected node transcript: drain cursor pages, poll live
 * runs, abort on scope change, and restore container scroll. Owns the
 * consume-once focus handoff across keyed ComposerDock remounts for Story 2.10.
 */
import { useEffect, useId, useRef, useState } from 'react';

import { buildAgentHistory, type AgentHistory } from '@/lib/agent-history';
import {
  getWorkflowNodeMessage,
  type AskAnswerBody,
  type PendingInteraction,
  type WorkflowEventResponse,
  type WorkflowNodeMessageResponse,
  type WorkflowNodeStateResponse,
} from '@/lib/api';
import {
  beginNodeMessageRefresh,
  createNodeMessageState,
  drainNodeMessages,
  nodeMessageScopeKey,
  type NodeMessageLoader,
  type NodeMessageSelection,
  type NodeMessageState,
} from '@/lib/node-message-pages';
import { collectWrittenOperatorMessageIds } from '@/lib/steering-dock';
import type { FinishedIterationView } from '@/lib/execution-room-model';
import { groupByOccurrence } from '@/lib/occurrence-groups';
import {
  createScrollFollow,
  jumpToLatest,
  jumpToOccurrence,
  onRoomScroll,
} from '@/lib/room-scroll-follow';
import type { WorkflowRunStatus } from '@/lib/types';

import { AskCard, InvalidAskCard } from './AskCard';
import type { AskActionStateByRequest } from './ask-answer-controller';
import { resolveAskCardPresentation } from './ask-card-presentation';
import type { LogRow } from './build-log-rows';
import { ComposerDock } from './ComposerDock';
import {
  selectVisibleNodeAskInteractions,
  UNSCOPED_INTERACTION_LIMITATION,
} from './merge-agent-room-items';
import { NodeRoom, RoomRegion, selectNodeRoomMessages } from './NodeRoom';
import { TodoStrip } from './TodoStrip';
import { parseAskEnvelope, type AskDraft, type AskDraftByRequest } from './parse-ask-envelope';

export function transcriptRefetchInterval(status: WorkflowRunStatus): 1000 | false {
  switch (status) {
    case 'pending':
    case 'running':
    case 'paused':
      return 1000;
    case 'completed':
    case 'failed':
    case 'cancelled':
      return false;
  }
}

export function isLiveRunStatus(status: WorkflowRunStatus): boolean {
  return transcriptRefetchInterval(status) === 1000;
}

function selectionFromRow(row: LogRow): NodeMessageSelection {
  if (row.selection.kind === 'occurrence') {
    const selection: NodeMessageSelection = {
      kind: 'occurrence',
      occurrenceId: row.selection.occurrenceId,
    };
    if (row.selection.attemptId !== undefined) {
      selection.attemptId = row.selection.attemptId;
    }
    return selection;
  }
  return { kind: 'node', rowId: row.id };
}

export interface NodeTranscriptPaneProps {
  runId: string;
  row: LogRow | null;
  runStatus: WorkflowRunStatus;
  loadMessages: NodeMessageLoader;
  pendingInteractions: readonly PendingInteraction[];
  ownsUnscopedInteractions: boolean;
  viewerIsStarter: boolean;
  starterDisplayName: string | null;
  actionStates: AskActionStateByRequest;
  nodeState: WorkflowNodeStateResponse | undefined;
  /** Matched definition node's `output_format`; absent or ineligible schemas leave text untouched. */
  outputFormat?: Record<string, unknown> | null;
  onSubmitAsk: (requestId: string, body: AskAnswerBody) => Promise<void>;
  events?: readonly WorkflowEventResponse[];
  scopeKey?: string;
  initialScrollTop?: number;
  onScrollTopChange?: (scrollTop: number) => void;
  loadMessage?: typeof getWorkflowNodeMessage;
  askDrafts?: AskDraftByRequest;
  onAskDraftChange?: (requestId: string, draft: AskDraft) => void;
  /** Proven finished-iteration descriptor from the parent pane. */
  finishedIteration?: FinishedIterationView | null;
  /** Existing execution-selection callback used by the Go control. */
  onSelectLiveRow?: (liveRowId: string) => void;
  /** Actual node-terminal evidence from raw executions. Default false. */
  nodeTerminal?: boolean;
  /** True when latest terminal execution failed for idle-await expiry. Default false. */
  idleAwaitExpired?: boolean;
  /** Logical execution key from ordered events. Default null. */
  nodeExecutionKey?: string | null;
  /** Node-wide written operator ids for terminal reconciliation. Default null. */
  writtenOperatorMessageIds?: ReadonlySet<string> | null;
}

function collectToolIds(messages: readonly WorkflowNodeMessageResponse[]): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    if (message.kind === 'tool') {
      ids.add(message.payload.id);
    }
  }
  return ids;
}

export function NodeTranscriptPane({
  runId,
  row,
  runStatus,
  loadMessages,
  pendingInteractions,
  ownsUnscopedInteractions,
  viewerIsStarter,
  starterDisplayName,
  actionStates,
  nodeState,
  outputFormat,
  onSubmitAsk,
  events = [],
  scopeKey,
  initialScrollTop,
  onScrollTopChange,
  loadMessage = getWorkflowNodeMessage,
  askDrafts,
  onAskDraftChange,
  finishedIteration = null,
  nodeTerminal = false,
  idleAwaitExpired = false,
  nodeExecutionKey = null,
  writtenOperatorMessageIds: _externalWrittenIds = null,
  onSelectLiveRow,
}: NodeTranscriptPaneProps): React.ReactElement {
  const resolvedScopeKey =
    scopeKey ??
    (row === null
      ? 'run:none|node:none|sel:node:none'
      : nodeMessageScopeKey(runId, row.nodeId, selectionFromRow(row)));
  const [pageState, setPageState] = useState<NodeMessageState>(() =>
    createNodeMessageState(resolvedScopeKey)
  );
  /** Node-wide written operator ids from the terminal reconcile drain. null until complete. */
  const [reconcileWrittenIds, setReconcileWrittenIds] = useState<ReadonlySet<string> | null>(null);
  const [follow, setFollow] = useState(() =>
    createScrollFollow(row?.status ?? 'completed', initialScrollTop)
  );
  const [retryNonce, setRetryNonce] = useState(0);
  const [localAskDrafts, setLocalAskDrafts] = useState<AskDraftByRequest>({});
  const [navTarget, setNavTarget] = useState<string | null>(null);
  /** Consume-once autofocus after a Go-driven selection change. */
  const [autoFocusTarget, setAutoFocusTarget] = useState<'field' | 'go' | null>(null);
  const headingIdPrefix = useId();
  const navigatorSelectId = useId();

  const pageStateRef = useRef(pageState);
  const scrollRef = useRef<HTMLDivElement>(null);
  const navigatorSelectRef = useRef<HTMLSelectElement>(null);
  const navigatedHeadingRef = useRef<HTMLElement | null>(null);
  const loadMessagesRef = useRef(loadMessages);
  const prevScopeRef = useRef(resolvedScopeKey);
  /** Intended live row id set on Go; cleared before focusing after commit. */
  const pendingGoTargetRef = useRef<{ fromRowId: string; toRowId: string } | null>(null);
  pageStateRef.current = pageState;
  loadMessagesRef.current = loadMessages;

  const nodeId = row?.nodeId ?? null;
  const rowId = row?.id ?? null;
  const rowStatus = row?.status ?? 'completed';
  const occurrenceId = row?.selection.kind === 'occurrence' ? row.selection.occurrenceId : null;
  const attemptId = row?.selection.kind === 'occurrence' ? (row.selection.attemptId ?? null) : null;

  // After Go commits a new selection, clear the pending target then hand focus
  // to the live composer/blocked field, the new finished Go button, or the
  // transcript scroller when the dock disappears. Unrelated remounts never
  // set pendingGoTargetRef, so they never steal focus.
  useEffect(() => {
    const pending = pendingGoTargetRef.current;
    if (pending === null) return;
    // Still on the pre-Go row — wait for the parent selection to commit.
    if (rowId === pending.fromRowId) return;

    // Selection changed: consume before focusing so a later refetch cannot re-fire.
    pendingGoTargetRef.current = null;

    if (rowId === null) {
      scrollRef.current?.focus();
      return;
    }
    if (finishedIteration !== null) {
      // Target is finished (loop advanced, or raced past the intended live row).
      setAutoFocusTarget('go');
      return;
    }
    if (rowStatus === 'running' || rowStatus === 'awaiting') {
      setAutoFocusTarget('field');
      return;
    }
    // Dock gone (terminal) — focus the transcript scroller.
    scrollRef.current?.focus();
  }, [rowId, rowStatus, finishedIteration]);

  const handleSelectLiveRow = (liveRowId: string): void => {
    if (rowId !== null) {
      pendingGoTargetRef.current = { fromRowId: rowId, toRowId: liveRowId };
    }
    onSelectLiveRow?.(liveRowId);
  };

  useEffect(() => {
    if (prevScopeRef.current !== resolvedScopeKey) {
      prevScopeRef.current = resolvedScopeKey;
      setPageState(createNodeMessageState(resolvedScopeKey));
      setFollow(createScrollFollow(rowStatus, initialScrollTop));
      setNavTarget(null);
    }
  }, [initialScrollTop, rowStatus, resolvedScopeKey]);

  useEffect(() => {
    if (rowId === null || nodeId === null || row === null) {
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const live = isLiveRunStatus(runStatus);
    const selection = selectionFromRow(row);

    const runDrain = async (state: NodeMessageState): Promise<void> => {
      if (cancelled) return;
      const seeded =
        state.scopeKey === resolvedScopeKey
          ? { ...state, loading: true }
          : createNodeMessageState(resolvedScopeKey);
      if (!cancelled) setPageState(seeded);
      const next = await drainNodeMessages({
        runId,
        nodeId,
        selection,
        loader: loadMessagesRef.current,
        signal: controller.signal,
        state: seeded,
        onState: (updated): void => {
          if (!cancelled) setPageState(updated);
        },
      });
      if (cancelled || controller.signal.aborted) return;
      if (live && next.error === null) {
        timer = setTimeout(() => {
          void runDrain(beginNodeMessageRefresh(next));
        }, 1000);
      }
    };

    const startState =
      pageStateRef.current.scopeKey === resolvedScopeKey
        ? beginNodeMessageRefresh(pageStateRef.current)
        : createNodeMessageState(resolvedScopeKey);
    void runDrain(startState);

    return (): void => {
      cancelled = true;
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
      const el = scrollRef.current;
      if (el !== null) onScrollTopChange?.(el.scrollTop);
    };
  }, [
    attemptId,
    loadMessages,
    nodeId,
    occurrenceId,
    onScrollTopChange,
    resolvedScopeKey,
    retryNonce,
    row,
    rowId,
    runId,
    runStatus,
  ]);

  // Separate node-wide reconcile drain — never feeds pageState/transcript.
  // Starts only on real node-terminal evidence; publishes written ids only
  // after a complete error-free drain. Retries transport/incomplete failures
  // at 1s while mounted+terminal. Resets on run/node/key change or terminal drop.
  useEffect(() => {
    if (!nodeTerminal || nodeId === null) {
      setReconcileWrittenIds(null);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const executionRowId = nodeExecutionKey ?? `run:${runId}|node:${nodeId}`;
    const selection: NodeMessageSelection = { kind: 'node', rowId: executionRowId };

    const runReconcileDrain = async (): Promise<void> => {
      if (cancelled || controller.signal.aborted) return;
      const next = await drainNodeMessages({
        runId,
        nodeId,
        selection,
        loader: loadMessagesRef.current,
        signal: controller.signal,
        state: createNodeMessageState(nodeMessageScopeKey(runId, nodeId, selection)),
        onState: (): void => {
          // Intentionally ignore intermediate pages — never touch transcript state.
        },
      });
      if (cancelled || controller.signal.aborted) return;
      if (next.complete && next.error === null) {
        setReconcileWrittenIds(collectWrittenOperatorMessageIds(next.rows));
        return;
      }
      // Incomplete or transport error: read-only retry while still terminal.
      timer = setTimeout(() => {
        void runReconcileDrain();
      }, 1000);
    };

    setReconcileWrittenIds(null);
    void runReconcileDrain();

    return (): void => {
      cancelled = true;
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
      setReconcileWrittenIds(null);
    };
  }, [nodeExecutionKey, nodeId, nodeTerminal, runId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;
    if (follow.pinToBottom) {
      el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
      return;
    }
    if (follow.scrollTop !== null) {
      el.scrollTop = follow.scrollTop;
    }
  }, [follow, pageState.rows.length]);

  useEffect(() => {
    const heading = navigatedHeadingRef.current;
    if (heading === null || heading.isConnected) return;
    navigatedHeadingRef.current = null;
    const active = document.activeElement;
    if (active !== null && active !== document.body && active !== heading) return;
    const select = navigatorSelectRef.current;
    if (select !== null) {
      select.focus();
    } else {
      scrollRef.current?.focus();
    }
  });

  const allMessages = pageState.rows;
  const visibleMessages = row === null ? [] : selectNodeRoomMessages(allMessages, row.selection);
  const nowMs = Date.now();
  const agentHistory: AgentHistory =
    row === null
      ? { items: [], todos: [] }
      : buildAgentHistory({
          rows: visibleMessages,
          events,
          nodeId: row.nodeId,
          outputFormat: outputFormat ?? undefined,
          nowMs,
        });
  const items = agentHistory.items;
  const occurrenceGrouping = groupByOccurrence(items);
  const navTargetIsRendered =
    occurrenceGrouping.showHeaders &&
    navTarget !== null &&
    occurrenceGrouping.groups.some(group => group.key === navTarget);
  useEffect(() => {
    if (navTarget !== null && !navTargetIsRendered) setNavTarget(null);
  }, [navTarget, navTargetIsRendered]);
  const todos = agentHistory.todos;
  const visibleAsks =
    row === null
      ? []
      : selectVisibleNodeAskInteractions({
          pending: pendingInteractions,
          nodeId: row.nodeId,
          selection: row.selection,
          allMessages,
          visibleMessages,
          ownsUnscopedInteractions,
        });
  const visibleToolIds = collectToolIds(visibleMessages);
  const anchoredAsks = visibleAsks.filter(interaction =>
    visibleToolIds.has(interaction.tool_use_id)
  );
  const unanchoredAsks = visibleAsks.filter(
    interaction => !visibleToolIds.has(interaction.tool_use_id)
  );
  const orderedAsks = [
    ...visibleMessages.flatMap(message =>
      message.kind === 'tool'
        ? anchoredAsks.filter(interaction => interaction.tool_use_id === message.payload.id)
        : []
    ),
    ...unanchoredAsks,
  ];
  const firstActionableId = orderedAsks.find(interaction => {
    if (interaction.status !== 'pending') {
      return false;
    }
    if (parseAskEnvelope(interaction.envelope) === null) {
      return false;
    }
    return (
      resolveAskCardPresentation({
        interaction,
        action: actionStates[interaction.tool_use_id],
        nodeStatus: nodeState?.status,
        nodeError: nodeState?.error,
      }).viewState === 'pending'
    );
  })?.id;

  const agentDisplayName = row?.label ?? '';
  const displayNodeId = row?.nodeId ?? '';

  const renderAskCard = (interaction: PendingInteraction): React.ReactElement => {
    const questions = parseAskEnvelope(interaction.envelope);
    const limitation =
      interaction.execution_scope == null ? (
        <p className="text-xs text-warning">{UNSCOPED_INTERACTION_LIMITATION}</p>
      ) : null;
    if (questions === null) {
      return (
        <div key={interaction.id}>
          {limitation}
          <InvalidAskCard
            interaction={interaction}
            agentDisplayName={agentDisplayName}
            nodeId={displayNodeId}
          />
        </div>
      );
    }
    const requestId = interaction.tool_use_id;
    const presentation = resolveAskCardPresentation({
      interaction,
      action: actionStates[requestId],
      nodeStatus: nodeState?.status,
      nodeError: nodeState?.error,
    });
    const updateDraft = (next: AskDraft): void => {
      if (onAskDraftChange !== undefined) {
        onAskDraftChange(requestId, next);
        return;
      }
      setLocalAskDrafts(current => ({ ...current, [requestId]: next }));
    };
    return (
      <div key={interaction.id}>
        {limitation}
        <AskCard
          interaction={interaction}
          questions={questions}
          presentation={presentation}
          viewerIsStarter={viewerIsStarter}
          starterDisplayName={starterDisplayName}
          agentDisplayName={agentDisplayName}
          nodeId={displayNodeId}
          autoFocus={interaction.id === firstActionableId}
          nowMs={nowMs}
          mountContext="room"
          draft={(onAskDraftChange === undefined ? localAskDrafts : askDrafts)?.[requestId] ?? {}}
          onDraftChange={updateDraft}
          onSubmit={(body): void => {
            void onSubmitAsk(requestId, body);
          }}
          onDecline={(): void => {
            void onSubmitAsk(requestId, { decline: true });
          }}
        />
      </div>
    );
  };

  const handleScroll = (event: React.UIEvent<HTMLDivElement>): void => {
    const target = event.currentTarget;
    const next = onRoomScroll(follow, {
      scrollTop: target.scrollTop,
      scrollHeight: target.scrollHeight,
      clientHeight: target.clientHeight,
    });
    setFollow(next);
    onScrollTopChange?.(target.scrollTop);
  };

  const handleJump = (): void => {
    const el = scrollRef.current;
    setFollow(jumpToLatest(follow));
    if (el !== null) {
      el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
      onScrollTopChange?.(el.scrollTop);
    }
  };

  const handleJumpToOccurrence = (event: React.ChangeEvent<HTMLSelectElement>): void => {
    const targetId = event.currentTarget.value;
    setNavTarget(targetId);
    const el = scrollRef.current;
    const heading = document.getElementById(`${headingIdPrefix}occ-${targetId}`);
    if (el === null || heading === null) return;
    const scrollerRect = el.getBoundingClientRect();
    const headingRect = heading.getBoundingClientRect();
    const fullyVisible =
      headingRect.top >= scrollerRect.top && headingRect.bottom <= scrollerRect.bottom;
    let target = el.scrollTop;
    if (!fullyVisible) {
      const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
      target = Math.min(
        maxScrollTop,
        Math.max(0, el.scrollTop + headingRect.top - scrollerRect.top)
      );
    }
    setFollow(current => jumpToOccurrence(current, target));
    onScrollTopChange?.(target);
    navigatedHeadingRef.current = heading;
    heading.focus({ preventScroll: true });
  };

  const waitingForFirstPage =
    row !== null && pageState.rows.length === 0 && pageState.error === null && !pageState.complete;

  // The steering dock's focus fallback: the last rendered transcript row,
  // or the transcript scroller itself when no row exists yet — never body.
  const focusLastRow = (): void => {
    const el = scrollRef.current;
    if (el === null) return;
    const lastRow = el.querySelector<HTMLElement>('[data-last-row]');
    (lastRow ?? el).focus({ preventScroll: true });
  };

  const scroller = (
    <div
      ref={scrollRef}
      data-testid="node-transcript-scroll"
      tabIndex={-1}
      className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain"
      style={{ overflowWrap: 'anywhere' }}
      onScroll={handleScroll}
    >
      <NodeRoom
        embedded
        nodeId={row?.nodeId ?? null}
        items={items}
        occurrenceGrouping={occurrenceGrouping}
        headingIdPrefix={headingIdPrefix}
        unknownScope={row?.unknownScope ?? false}
        runId={runId}
        isPending={waitingForFirstPage}
        error={pageState.error}
        onRetry={(): void => {
          setRetryNonce(value => value + 1);
        }}
        loadMessage={loadMessage}
        renderAfterItem={(item): React.ReactNode => {
          if (item.kind !== 'tool') return null;
          const matching = anchoredAsks.filter(
            interaction => interaction.tool_use_id === item.toolUseId
          );
          if (matching.length === 0) return null;
          return matching.map(renderAskCard);
        }}
        renderAtEnd={unanchoredAsks.length === 0 ? undefined : unanchoredAsks.map(renderAskCard)}
      />
    </div>
  );
  const navSelectValue = navTargetIsRendered ? navTarget : '';
  const occurrenceNavigator = occurrenceGrouping.showHeaders ? (
    <div className="flex min-w-0 items-center gap-1 px-3 py-2">
      <label htmlFor={navigatorSelectId} className="shrink-0 text-xs text-text-secondary">
        Jump to
      </label>
      <select
        ref={navigatorSelectRef}
        id={navigatorSelectId}
        className="min-w-0 max-w-[10rem] flex-[0_1_10rem] truncate rounded border border-border bg-surface-elevated px-2 py-0.5 text-xs text-text-primary"
        value={navSelectValue}
        aria-controls={
          navSelectValue === '' ? undefined : `${headingIdPrefix}occ-${navSelectValue}`
        }
        onChange={handleJumpToOccurrence}
      >
        <option value="" disabled>
          {occurrenceGrouping.groups.length} occurrences
        </option>
        {occurrenceGrouping.groups.map(group => (
          <option key={group.key} value={group.key}>
            {group.label}
          </option>
        ))}
      </select>
    </div>
  ) : null;
  const jumpButton =
    !follow.follow && (rowStatus === 'running' || rowStatus === 'awaiting') ? (
      <button type="button" className="ml-auto px-3 py-2 text-xs text-primary" onClick={handleJump}>
        Jump to latest
      </button>
    ) : null;
  const controls =
    occurrenceNavigator !== null || jumpButton !== null ? (
      <div className="flex items-center justify-between gap-2">
        {occurrenceNavigator}
        {jumpButton}
      </div>
    ) : null;

  if (row === null) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {scroller}
        {controls}
      </div>
    );
  }

  return (
    <RoomRegion nodeId={row.nodeId} scrollable={false}>
      {scroller}
      {controls}
      {todos.length > 0 ? <TodoStrip key={resolvedScopeKey} phases={todos} /> : null}
      <ComposerDock
        key={`steering:run:${runId}|node:${row.nodeId}`}
        runId={runId}
        nodeId={row.nodeId}
        nodeLabel={agentDisplayName || row.nodeId}
        rowStatus={rowStatus}
        live={isLiveRunStatus(runStatus)}
        hasPendingAsk={visibleAsks.some(interaction => interaction.status === 'pending')}
        subState={nodeState?.steeringSubState}
        finishedIteration={finishedIteration}
        onSelectLiveRow={onSelectLiveRow === undefined ? undefined : handleSelectLiveRow}
        autoFocusTarget={autoFocusTarget}
        onAutoFocusApplied={(): void => {
          setAutoFocusTarget(null);
        }}
        focusLastRow={focusLastRow}
        nodeTerminal={nodeTerminal}
        idleAwaitExpired={idleAwaitExpired}
        nodeExecutionKey={nodeExecutionKey}
        writtenOperatorMessageIds={reconcileWrittenIds}
      />
    </RoomRegion>
  );
}
