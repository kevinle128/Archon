/**
 * One log-section body: drain the exact execution, render Console agent history,
 * and place scoped Ask cards plus the approval gate when assigned here.
 */
import { useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';

import { buildAgentHistory } from '@/lib/agent-history';
import {
  beginNodeMessageRefresh,
  createNodeMessageState,
  drainNodeMessages,
  nodeMessageScopeKey,
  type NodeMessageSelection,
  type NodeMessageState,
} from '@/lib/node-message-pages';
import { groupByOccurrence } from '@/lib/occurrence-groups';

import type { Run } from '../../primitives/run';
import type {
  AskAnswerBody,
  PendingInteraction,
  WorkflowEvent,
  WorkflowNodeMessage,
  WorkflowNodeMessagesResponse,
  WorkflowNodeState,
} from '../../skills/runs';
import { getNodeMessage } from '../../skills/runs';
import { ApprovalPanel } from '../ApprovalPanel';
import type { AskActionStateByRequest } from '../ask/ask-answer-controller';
import { resolveAskCardPresentation } from '../ask/ask-card-presentation';
import { ConsoleAskCard, ConsoleInvalidAskCard } from '../ask/ConsoleAskCard';
import { parseAskEnvelope, type AskDraft, type AskDraftByRequest } from '../ask/parse-ask-envelope';
import { ConsoleAgentHistoryList, historyItemRowVisible } from './ConsoleAgentHistoryList';
import type { ConsoleLogEntry } from './build-console-log-entries';
import type { LogRow } from './build-log-rows';
import { interactionsForExecution } from './execution-interactions';
import { readApprovalContext } from './read-approval-context';
import { selectNodeRoomMessages } from './select-node-room-messages';

export function shouldPollExecutionHistory(
  runIsLive: boolean,
  status: WorkflowNodeState['status']
): boolean {
  return runIsLive && (status === 'running' || status === 'awaiting');
}

function ownsUnscopedHistory(row: LogRow, entries: readonly ConsoleLogEntry[]): boolean {
  if (row.selection.kind !== 'route_iteration') return true;
  const routeRows = entries.filter(
    candidate =>
      candidate.row.nodeId === row.nodeId && candidate.row.selection.kind === 'route_iteration'
  );
  const latest = routeRows.reduce<ConsoleLogEntry | null>(
    (current, candidate) =>
      current === null || candidate.row.order > current.row.order ? candidate : current,
    null
  );
  return latest?.row.id === row.id;
}

export interface ConsoleExecutionHistoryProps {
  entry: ConsoleLogEntry;
  allEntries: readonly ConsoleLogEntry[];
  run: Run;
  events: readonly WorkflowEvent[];
  isLive: boolean;
  suspended?: boolean;
  loadMessages: (
    runId: string,
    nodeId: string,
    options?: {
      afterSeq?: number;
      limit?: number;
      occurrenceId?: string;
      attemptId?: string;
      signal?: AbortSignal;
    }
  ) => Promise<WorkflowNodeMessagesResponse>;
  loadMessage?: (
    runId: string,
    nodeId: string,
    messageId: string,
    options?: { signal?: AbortSignal }
  ) => Promise<WorkflowNodeMessage>;
  pendingInteractions: readonly PendingInteraction[];
  nodeStates?: readonly WorkflowNodeState[];
  approval?: unknown;
  showToolCalls: boolean;
  showSystem: boolean;
  viewerIsStarter: boolean;
  starterDisplayName: string | null;
  actionStates: AskActionStateByRequest;
  onSubmitAsk: (requestId: string, body: AskAnswerBody) => Promise<void>;
  askDrafts?: AskDraftByRequest;
  onAskDraftChange?: (requestId: string, draft: AskDraft) => void;
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

export function ConsoleExecutionHistory({
  entry,
  allEntries,
  run,
  events,
  isLive,
  suspended = false,
  loadMessages,
  loadMessage = getNodeMessage,
  pendingInteractions,
  nodeStates = [],
  approval,
  showToolCalls,
  showSystem,
  viewerIsStarter,
  starterDisplayName,
  actionStates,
  onSubmitAsk,
  askDrafts = {},
  onAskDraftChange,
}: ConsoleExecutionHistoryProps): ReactElement {
  const row = entry.row;
  const selection = selectionFromRow(row);
  const resolvedScopeKey = nodeMessageScopeKey(run.id, row.nodeId, selection);
  const ownsHistory = ownsUnscopedHistory(row, allEntries);
  const [pageState, setPageState] = useState<NodeMessageState>(() =>
    createNodeMessageState(resolvedScopeKey)
  );
  const [retryNonce, setRetryNonce] = useState(0);
  const headingIdPrefix = useId();
  const pageStateRef = useRef(pageState);
  const loadMessagesRef = useRef(loadMessages);
  const prevScopeRef = useRef(resolvedScopeKey);
  pageStateRef.current = pageState;
  loadMessagesRef.current = loadMessages;

  useEffect(() => {
    if (prevScopeRef.current !== resolvedScopeKey) {
      prevScopeRef.current = resolvedScopeKey;
      setPageState(createNodeMessageState(resolvedScopeKey));
    }
  }, [resolvedScopeKey]);

  useEffect(() => {
    if (!ownsHistory) {
      setPageState({ ...createNodeMessageState(resolvedScopeKey), complete: true });
      return;
    }
    if (suspended) return;
    const controller = new AbortController();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const drainSelection = selectionFromRow(row);

    const runDrain = async (state: NodeMessageState): Promise<void> => {
      if (cancelled) return;
      const seeded =
        state.scopeKey === resolvedScopeKey
          ? { ...state, loading: true }
          : createNodeMessageState(resolvedScopeKey);
      if (!cancelled) setPageState(seeded);
      const next = await drainNodeMessages({
        runId: run.id,
        nodeId: row.nodeId,
        selection: drainSelection,
        loader: loadMessagesRef.current,
        signal: controller.signal,
        state: seeded,
        onState: (updated): void => {
          if (!cancelled) setPageState(updated);
        },
      });
      if (cancelled || controller.signal.aborted) return;
      if (isLive && next.error === null) {
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
    };
  }, [isLive, ownsHistory, resolvedScopeKey, retryNonce, row.nodeId, run.id, suspended]);

  const visibleRows = ownsHistory ? selectNodeRoomMessages(pageState.rows, row.selection) : [];
  const nowMs = Date.now();
  const { items } = buildAgentHistory({
    rows: visibleRows,
    events,
    nodeId: row.nodeId,
    nowMs,
  });
  // A group stays in the display only when a row is visible under the Console
  // filters — Ask/approval extras are unanchored renderAtEnd content and never
  // keep a group alive here.
  const occurrenceBase = groupByOccurrence(items);
  const displayableGroups = occurrenceBase.groups.filter(group =>
    group.items.some(item => historyItemRowVisible(item, { showToolCalls, showSystem }))
  );
  const occurrenceGrouping = {
    prefixItems: occurrenceBase.prefixItems,
    groups: displayableGroups,
    showHeaders: displayableGroups.length >= 2,
  };
  const approvalNodeId = readApprovalContext(approval)?.nodeId ?? null;
  const assignment = interactionsForExecution(
    pendingInteractions,
    entry,
    allEntries,
    approvalNodeId
  );
  const nodeState = nodeStates.find(state => state.nodeId === row.nodeId);

  const renderAskCard = (interaction: PendingInteraction): ReactElement => {
    const questions = parseAskEnvelope(interaction.envelope);
    const limitation =
      assignment.scopeLimitation === null ? null : (
        <p className="text-xs text-warning">{assignment.scopeLimitation}</p>
      );
    if (questions === null) {
      return (
        <div key={interaction.id}>
          {limitation}
          <ConsoleInvalidAskCard
            interaction={interaction}
            agentDisplayName={row.label}
            nodeId={row.nodeId}
          />
        </div>
      );
    }
    const requestId = interaction.tool_use_id;
    return (
      <div key={interaction.id}>
        {limitation}
        <ConsoleAskCard
          interaction={interaction}
          questions={questions}
          presentation={resolveAskCardPresentation({
            interaction,
            action: actionStates[requestId],
            nodeStatus: nodeState?.status,
            nodeError: nodeState?.error,
          })}
          viewerIsStarter={viewerIsStarter}
          starterDisplayName={starterDisplayName}
          agentDisplayName={row.label}
          nodeId={row.nodeId}
          autoFocus={false}
          nowMs={nowMs}
          mountContext={`log:${entry.row.id}`}
          draft={askDrafts[requestId] ?? {}}
          onDraftChange={(next): void => {
            onAskDraftChange?.(requestId, next);
          }}
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

  const waitingForFirstPage =
    !suspended &&
    pageState.rows.length === 0 &&
    pageState.error === null &&
    (pageState.loading || !pageState.complete);

  const askCards = assignment.interactions.map(renderAskCard);
  const approvalBlock = assignment.showApproval ? (
    <div>
      {assignment.scopeLimitation !== null && assignment.interactions.length === 0 ? (
        <p className="text-xs text-warning">{assignment.scopeLimitation}</p>
      ) : null}
      <ApprovalPanel run={run} />
    </div>
  ) : null;

  const extras: ReactNode =
    askCards.length === 0 && approvalBlock === null ? undefined : (
      <>
        {askCards}
        {approvalBlock}
      </>
    );

  const history = (
    <ConsoleAgentHistoryList
      items={items}
      occurrenceGrouping={occurrenceGrouping}
      headingIdPrefix={headingIdPrefix}
      showToolCalls={showToolCalls}
      showSystem={showSystem}
      unknownScope={row.unknownScope === true}
      onLoadFullOutput={async (item): Promise<unknown> => {
        const message = await loadMessage(run.id, row.nodeId, item.messageId);
        return message.kind === 'tool' ? message.payload.output : undefined;
      }}
      renderAtEnd={extras}
    />
  );

  let body: ReactNode;
  if (pageState.error !== null && items.length === 0) {
    body = (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center text-[13px] text-text-secondary">
          <p>Failed to load node transcript</p>
          {pageState.error.length > 0 ? <p>{pageState.error}</p> : null}
          <button
            type="button"
            className="text-[12px] text-primary transition-colors hover:text-accent-bright"
            onClick={(): void => {
              setRetryNonce(value => value + 1);
            }}
          >
            Retry
          </button>
        </div>
        {extras}
      </div>
    );
  } else if (waitingForFirstPage) {
    body = <div className="px-3 py-2 text-[13px] text-text-secondary">Loading node transcript</div>;
  } else if (pageState.error !== null) {
    body = (
      <div className="flex min-h-0 flex-1 flex-col">
        {history}
        <div className="flex items-center justify-center gap-2 px-4 py-3 text-center text-[13px] text-text-secondary">
          <p>Failed to load node transcript</p>
          <button
            type="button"
            className="text-[12px] text-primary transition-colors hover:text-accent-bright"
            onClick={(): void => {
              setRetryNonce(value => value + 1);
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  } else {
    body = history;
  }

  return <div data-testid="console-execution-history">{body}</div>;
}
