/**
 * Query boundary for a selected node transcript: drain cursor pages, poll live
 * runs, abort on scope change, and restore container scroll. Owns the
 * consume-once focus handoff across keyed ComposerDock remounts.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

import { buildAgentHistory, type AgentHistory, type AgentHistoryItem } from '@/lib/agent-history';
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
import {
  bareNodeLabel,
  resolveGapHoldStatus,
  type FinishedIterationView,
} from '@/lib/execution-room-model';
import { groupByOccurrence, type OccurrenceGrouping } from '@/lib/occurrence-groups';
import {
  createScrollFollow,
  jumpToLatest,
  jumpToOccurrence,
  onRoomScroll,
} from '@/lib/room-scroll-follow';
import type {
  SteeringExecutionState,
  SteeringNodeOutcome,
  SteeringQueueItemState,
} from '@/lib/steering-dock';
import { projectTerminalTodoState } from '@/lib/todo-state';
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
  /**
   * True while the room is following the live execution rather than pinned
   * to an explicit pick (`RoomVisitSelection.followingLive`). Feeds the
   * dock's own `rowStatus` only — see `resolveGapHoldStatus` — so the
   * composer stays open through the gap between one loop iteration's row
   * completing and the next iteration's row starting. Default false.
   */
  followingLive?: boolean;
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
  /** Forwarded to the composer dock; see its own doc comment. */
  onExecutionStateChange?: (state: SteeringExecutionState | null) => void;
  /** Forwarded to the composer dock; see its own doc comment. */
  onNodeOutcomeChange?: (outcome: SteeringNodeOutcome | null) => void;
  /**
   * Server-reported restart recovery for the selected row (owned by the
   * parent room, which reads it from the dock's own `onExecutionStateChange`
   * report) — a still-open tool call settles the same way a terminal row's
   * does, since no live process backs either. Default false.
   */
  recoveryRequired?: boolean;
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
  followingLive = false,
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
  onSelectLiveRow,
  onExecutionStateChange,
  onNodeOutcomeChange,
  recoveryRequired = false,
}: NodeTranscriptPaneProps): React.ReactElement {
  const resolvedScopeKey =
    scopeKey ??
    (row === null
      ? 'run:none|node:none|sel:node:none'
      : nodeMessageScopeKey(runId, row.nodeId, selectionFromRow(row)));
  const [pageState, setPageState] = useState<NodeMessageState>(() =>
    createNodeMessageState(resolvedScopeKey)
  );
  const [follow, setFollow] = useState(() =>
    createScrollFollow(row?.status ?? 'completed', initialScrollTop)
  );
  const [retryNonce, setRetryNonce] = useState(0);
  const [localAskDrafts, setLocalAskDrafts] = useState<AskDraftByRequest>({});
  const [deliveryStates, setDeliveryStates] = useState<ReadonlyMap<string, SteeringQueueItemState>>(
    () => new Map()
  );
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
  /**
   * The deepest element focused inside the transcript scroller, tracked on
   * every focus so an iteration boundary that removes the ROW currently
   * holding it (the old iteration's rows are replaced wholesale when the
   * room follows a new live iteration — resolveFollowedRow) can be told
   * apart from an unrelated blur. Never cleared on blur: `document.contains`
   * below is what proves the specific tracked node is actually gone, not
   * merely that focus moved elsewhere for the moment.
   */
  const lastFocusedTranscriptRowRef = useRef<Element | null>(null);
  /**
   * True only while the scroller itself holds focus because THIS
   * mechanism's own redirect (below) parked it there for want of a real row
   * at that moment. Distinguishes "reclaim once a row appears" from a
   * DIFFERENT, deliberate final destination on the bare scroller — e.g. the
   * occurrence navigator dropping to one group — which must never be
   * overridden.
   */
  const parkedOnScrollerFallbackRef = useRef(false);
  pageStateRef.current = pageState;
  loadMessagesRef.current = loadMessages;

  const nodeId = row?.nodeId ?? null;
  const rowId = row?.id ?? null;
  const rowStatus = row?.status ?? 'completed';
  // The dock's OWN input only: between one loop iteration's row completing
  // and the next iteration's row starting, `resolveFollowedRow` is still
  // following live but has nothing live to show yet, so `rowStatus` above
  // reads the just-finished row's terminal status. Substituting the node's
  // own live status there — never anywhere else `rowStatus` is read in this
  // file — keeps the composer open through that gap instead of dropping it.
  const composerRowStatus = resolveGapHoldStatus({
    followingLive,
    rowStatus,
    nodeStatus: nodeState?.status,
  });
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

  // The scroller's own box can shrink or grow with no new row arriving — the
  // queue band, todo strip, or dock changing height all resize it — so a
  // pinned reader must re-pin on the scroller's own resize too, not only when
  // a new row arrives.
  useEffect(() => {
    const el = scrollRef.current;
    if (el === null || !follow.pinToBottom) return;
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
    });
    observer.observe(el);
    return (): void => {
      observer.disconnect();
    };
  }, [follow.pinToBottom]);

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
  // A restart-recovery row stays 'running' in its own lifecycle status — the
  // server durably reports the process is gone, not the row's own status —
  // so a still-open tool call there needs the same settle rule as a genuinely
  // terminal row: no live process can ever complete it.
  const noLiveProcessForRow =
    (rowStatus !== 'running' && rowStatus !== 'awaiting') || recoveryRequired;
  const agentHistory: AgentHistory =
    row === null
      ? { items: [], todos: [] }
      : buildAgentHistory({
          rows: visibleMessages,
          events,
          nodeId: row.nodeId,
          outputFormat: outputFormat ?? undefined,
          nowMs,
          nodeTerminal: noLiveProcessForRow,
          deliveryStateByMessageId: deliveryStates,
        });
  const items = agentHistory.items;
  // Every operator message id already rendered as a transcript row, so the
  // dock can hide its own dispatching-band row for the same message the
  // instant the transcript shows it — the two must never both display the
  // same message at once. `items` is rebuilt fresh every render (not
  // memoized), so this is too; the set itself is cheap for a room's message
  // count and the dock only reads it during render, never as an effect
  // dependency.
  const deliveredMessageIds = new Set(
    items
      .filter(
        (item): item is Extract<AgentHistoryItem, { kind: 'operator' }> => item.kind === 'operator'
      )
      .map(item => item.messageId)
      .filter((messageId): messageId is string => messageId !== null)
  );
  const occurrenceGrouping = groupByOccurrence(items);
  // Raw lifecycle rows (`started`, `iteration_started 1`, the terminal
  // `failed …` line) are engine state identifiers, not one of the room's
  // approved row types — grouping still sees the full list first so its own
  // `failed` detection (which reads a lifecycle item) is unaffected; only
  // what actually renders is filtered, mirroring Console's System-off default.
  // A status-only occurrence (e.g. a failed retry, or a nested-loop
  // disambiguation group, with no model/tool output at all) legitimately has
  // nothing left once lifecycle rows are stripped — its header is still
  // load-bearing (it is the only signal that occurrence existed), so groups
  // are never dropped for going empty here. `groupByOccurrence` never
  // produces a zero-item group, so this filtering can only ever empty a
  // group's body, never remove a group that had no content in the first
  // place.
  const displayItems = items.filter(item => item.kind !== 'lifecycle');
  const displayGroups = occurrenceGrouping.groups.map(group => ({
    ...group,
    items: group.items.filter(item => item.kind !== 'lifecycle'),
  }));
  const displayGrouping: OccurrenceGrouping = {
    prefixItems: occurrenceGrouping.prefixItems.filter(item => item.kind !== 'lifecycle'),
    groups: displayGroups,
    showHeaders: displayGroups.length >= 2,
  };
  const navTargetIsRendered =
    displayGrouping.showHeaders &&
    navTarget !== null &&
    displayGrouping.groups.some(group => group.key === navTarget);
  useEffect(() => {
    if (navTarget !== null && !navTargetIsRendered) setNavTarget(null);
  }, [navTarget, navTargetIsRendered]);
  // The strip and the latest todo row's inline checklist share this one
  // terminal-projected fold — a terminal node never keeps showing an
  // `in_progress` item as still running (todo-fold-contract.md).
  const todos = projectTerminalTodoState(agentHistory.todos, rowStatus);
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

  // A loop iteration boundary the operator did not drive through Go (the
  // room follows a newly live iteration on its own — resolveFollowedRow)
  // replaces the whole rendered row list. If the operator's focus was on a
  // row in the OLD list, the browser has already blurred it to `<body>` by
  // the time this runs (the DOM removal happens during commit, before any
  // effect) — `lastFocusedTranscriptRowRef` is what lets this tell "that
  // exact row is now gone" from "focus is at body for some unrelated
  // reason". Layout, not passive: a passive effect's own DOM focus() call
  // can still land after the browser paints the blurred frame.
  //
  // No dependency array: the row prop and the transcript content it
  // resolves to (a separate query, keyed by scope) do not necessarily
  // settle in the same commit — keying this on `rowId` alone can fire once,
  // find the old row still present (content hasn't caught up yet), and
  // never fire again once it actually gets removed a render later. Running
  // after every commit is safe because every check here is idempotent: a
  // still-connected tracked row, or any focus other than a bare `<body>`,
  // is a no-op.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;
    // Self-heal, but only the fallback THIS effect itself created: reclaim
    // focus into a just-appeared real row only while `parkedOnScrollerFallbackRef`
    // is still true. A different focus destination since (including a
    // DELIBERATE final landing on the bare scroller from elsewhere, e.g. the
    // occurrence navigator dropping to one group) clears the flag instead of
    // being overridden.
    if (parkedOnScrollerFallbackRef.current) {
      if (document.activeElement !== el) {
        parkedOnScrollerFallbackRef.current = false;
      } else {
        const lastRow = el.querySelector<HTMLElement>('[data-last-row]');
        if (lastRow !== null) {
          parkedOnScrollerFallbackRef.current = false;
          lastRow.focus({ preventScroll: true });
          return;
        }
      }
    }
    const trackedRow = lastFocusedTranscriptRowRef.current;
    if (trackedRow === null) return;
    if (document.contains(trackedRow)) return;
    if (document.activeElement !== null && document.activeElement !== document.body) return;
    lastFocusedTranscriptRowRef.current = null;
    const lastRow = el.querySelector<HTMLElement>('[data-last-row]');
    if (lastRow !== null) {
      lastRow.focus({ preventScroll: true });
    } else {
      parkedOnScrollerFallbackRef.current = true;
      el.focus({ preventScroll: true });
    }
  });

  const scroller = (
    <div
      ref={scrollRef}
      data-testid="node-transcript-scroll"
      tabIndex={-1}
      onFocusCapture={(event): void => {
        // Scoped to actual transcript rows (`[data-last-row]`, the only
        // elements `focusLastRow` ever targets) — the scroller also hosts
        // occurrence headings and other focusables with their own,
        // unrelated focus-restoration paths that must not be overridden.
        if (event.target.hasAttribute('data-last-row')) {
          lastFocusedTranscriptRowRef.current = event.target;
        }
      }}
      // The todo strip below stays flex-none at its full content height, so an
      // expanded strip on a very short room can squeeze this flex-1 sibling
      // toward zero. A tiny floor keeps the scroller present rather than
      // fully collapsed, while it still absorbs almost all of the squeeze.
      className="flex min-h-[4px] flex-1 flex-col overflow-y-auto overscroll-y-contain"
      style={{ overflowWrap: 'anywhere' }}
      onScroll={handleScroll}
    >
      <NodeRoom
        embedded
        nodeId={row?.nodeId ?? null}
        items={displayItems}
        occurrenceGrouping={displayGrouping}
        headingIdPrefix={headingIdPrefix}
        unknownScope={row?.unknownScope ?? false}
        todos={todos}
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
  const occurrenceNavigator = displayGrouping.showHeaders ? (
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
          {displayGrouping.groups.length} occurrences
        </option>
        {displayGrouping.groups.map(group => (
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
      {todos.length > 0 ? <TodoStrip key={resolvedScopeKey} phases={todos} /> : null}
      {controls}
      <ComposerDock
        key={`steering:run:${runId}|node:${row.nodeId}`}
        runId={runId}
        nodeId={row.nodeId}
        nodeLabel={bareNodeLabel(agentDisplayName || row.nodeId)}
        rowStatus={composerRowStatus}
        live={isLiveRunStatus(runStatus)}
        hasPendingAsk={visibleAsks.some(interaction => interaction.status === 'pending')}
        subState={nodeState?.steeringSubState}
        finishedIteration={finishedIteration}
        onSelectLiveRow={onSelectLiveRow === undefined ? undefined : handleSelectLiveRow}
        autoFocusTarget={autoFocusTarget}
        onAutoFocusApplied={(): void => {
          setAutoFocusTarget(null);
        }}
        onExecutionStateChange={onExecutionStateChange}
        onNodeOutcomeChange={onNodeOutcomeChange}
        onDeliveryStatesChange={setDeliveryStates}
        focusLastRow={focusLastRow}
        nodeTerminal={nodeTerminal}
        idleAwaitExpired={idleAwaitExpired}
        nodeExecutionKey={nodeExecutionKey}
        deliveredMessageIds={deliveredMessageIds}
      />
    </RoomRegion>
  );
}
