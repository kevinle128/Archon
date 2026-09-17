/**
 * Query boundary for a selected node transcript: drain cursor pages, poll live
 * runs, abort on scope change, and restore container scroll.
 */
import { useEffect, useRef, useState } from 'react';

import { buildAgentHistory, type AgentHistoryItem } from '@/lib/agent-history';
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
import { createScrollFollow, jumpToLatest, onRoomScroll } from '@/lib/room-scroll-follow';
import type { WorkflowRunStatus } from '@/lib/types';

import { AskCard, InvalidAskCard } from './AskCard';
import type { AskActionStateByRequest } from './ask-answer-controller';
import { resolveAskCardPresentation } from './ask-card-presentation';
import type { LogRow } from './build-log-rows';
import {
  selectVisibleNodeAskInteractions,
  UNSCOPED_INTERACTION_LIMITATION,
} from './merge-agent-room-items';
import { NodeRoom, selectNodeRoomMessages } from './NodeRoom';
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

function isLiveRunStatus(status: WorkflowRunStatus): boolean {
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
  onSubmitAsk: (requestId: string, body: AskAnswerBody) => Promise<void>;
  events?: readonly WorkflowEventResponse[];
  scopeKey?: string;
  initialScrollTop?: number;
  onScrollTopChange?: (scrollTop: number) => void;
  loadMessage?: typeof getWorkflowNodeMessage;
  askDrafts?: AskDraftByRequest;
  onAskDraftChange?: (requestId: string, draft: AskDraft) => void;
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
  onSubmitAsk,
  events = [],
  scopeKey,
  initialScrollTop,
  onScrollTopChange,
  loadMessage = getWorkflowNodeMessage,
  askDrafts,
  onAskDraftChange,
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

  const pageStateRef = useRef(pageState);
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadMessagesRef = useRef(loadMessages);
  const prevScopeRef = useRef(resolvedScopeKey);
  pageStateRef.current = pageState;
  loadMessagesRef.current = loadMessages;

  const nodeId = row?.nodeId ?? null;
  const rowId = row?.id ?? null;
  const rowStatus = row?.status ?? 'completed';
  const occurrenceId = row?.selection.kind === 'occurrence' ? row.selection.occurrenceId : null;
  const attemptId = row?.selection.kind === 'occurrence' ? (row.selection.attemptId ?? null) : null;

  useEffect(() => {
    if (prevScopeRef.current !== resolvedScopeKey) {
      prevScopeRef.current = resolvedScopeKey;
      setPageState(createNodeMessageState(resolvedScopeKey));
      setFollow(createScrollFollow(rowStatus, initialScrollTop));
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

  const allMessages = pageState.rows;
  const visibleMessages = row === null ? [] : selectNodeRoomMessages(allMessages, row.selection);
  const nowMs = Date.now();
  const items: AgentHistoryItem[] =
    row === null
      ? []
      : buildAgentHistory({
          rows: visibleMessages,
          events,
          nodeId: row.nodeId,
          nowMs,
        });
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

  const waitingForFirstPage =
    row !== null && pageState.rows.length === 0 && pageState.error === null && !pageState.complete;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        data-testid="node-transcript-scroll"
        className="min-h-0 flex-1 overflow-y-auto"
        style={{ overflowWrap: 'anywhere' }}
        onScroll={handleScroll}
      >
        <NodeRoom
          nodeId={row?.nodeId ?? null}
          items={items}
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
      {!follow.follow && (rowStatus === 'running' || rowStatus === 'awaiting') ? (
        <button type="button" className="px-3 py-2 text-xs text-primary" onClick={handleJump}>
          Jump to latest
        </button>
      ) : null}
    </div>
  );
}
