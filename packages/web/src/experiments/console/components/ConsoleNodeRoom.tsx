/**
 * Console-owned inspect room: one persistent surface for every Story 5.5
 * node body, with Ask cards inline at agent tool invocations.
 */
import {
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type UIEvent,
} from 'react';
import { buildAgentHistory, type AgentHistory } from '@/lib/agent-history';
import { buildExecutionHeader, type ExecutionHeaderModel } from '@/lib/execution-room-model';
import {
  beginNodeMessageRefresh,
  createNodeMessageState,
  drainNodeMessages,
  nodeMessageScopeKey,
  type NodeMessageState,
} from '@/lib/node-message-pages';
import { createScrollFollow, jumpToLatest, onRoomScroll } from '@/lib/room-scroll-follow';

import type { Run } from '../primitives/run';
import type {
  AskAnswerBody,
  PendingInteraction,
  WorkflowEvent,
  WorkflowNodeMessage,
  WorkflowNodeMessagesResponse,
  WorkflowNodeState,
} from '../skills/runs';
import { getNodeMessage, submitRunReviewFeedback } from '../skills/runs';
import type { DagNode } from '../skills/workflows';
import { ApprovalPanel } from './ApprovalPanel';
import { ConsoleTodoStrip } from './ConsoleTodoStrip';
import { ConsoleAskCard, ConsoleInvalidAskCard } from './ask/ConsoleAskCard';
import type { AskActionStateByRequest } from './ask/ask-answer-controller';
import { resolveAskCardPresentation } from './ask/ask-card-presentation';
import { parseAskEnvelope, type AskDraft, type AskDraftByRequest } from './ask/parse-ask-envelope';
import { selectVisibleNodeAskInteractions } from './ask/select-visible-node-ask-interactions';
import { UNSCOPED_INTERACTION_LIMITATION } from './inspect/execution-interactions';
import type { LogRow } from './inspect/build-log-rows';
import { ConsoleAgentHistoryList } from './inspect/ConsoleAgentHistoryList';
import { ConsoleRoomHeader, type ConsoleExecutionHeaderOption } from './inspect/ConsoleRoomHeader';
import { inspectStatusLabel } from './inspect/inspect-status';
import { resolveRoomKind, type RoomKind, type RoomResolution } from './inspect/resolve-room-kind';
import { selectNodeRoomMessages } from './inspect/select-node-room-messages';
import {
  selectChildRun,
  selectGateChrome,
  selectLoopGroupChrome,
  selectNodeStdout,
  selectRouteDecision,
  type GateChrome,
  type LoopGroupChrome,
  type RouteDecisionView,
  type StdoutView,
} from './inspect/select-room-data';

export interface ConsoleNodeRoomProps {
  run: Run;
  projectId: string;
  nodeId: string | null;
  selectedRow: LogRow | null;
  definitionNodes: readonly DagNode[];
  definitionPending: boolean;
  nodeStates: readonly WorkflowNodeState[];
  events: readonly WorkflowEvent[];
  approval: unknown;
  isLive: boolean;
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
  loadMessage?: typeof getNodeMessage;
  onClose: () => void;
  pendingInteractions: readonly PendingInteraction[];
  ownsUnscopedInteractions: boolean;
  viewerIsStarter: boolean;
  starterDisplayName: string | null;
  actionStates: AskActionStateByRequest;
  onSubmitAsk: (requestId: string, body: AskAnswerBody) => Promise<void>;
  headerModel?: ExecutionHeaderModel | null;
  headerOptions?: readonly ConsoleExecutionHeaderOption[];
  onSelectRow?: (rowId: string) => void;
  showToolCalls?: boolean;
  showSystem?: boolean;
  closeLabel?: 'Close' | 'Back';
  scopeKey?: string;
  initialScrollTop?: number;
  onScrollTopChange?: (scrollTop: number) => void;
  askDrafts?: AskDraftByRequest;
  onAskDraftChange?: (requestId: string, draft: AskDraft) => void;
}

const ROUTE_FIELDS = [
  ['Outcome', 'outcome'],
  ['Target', 'to'],
  ['Condition', 'condition'],
  ['Condition result', 'conditionResult'],
  ['Attempt', 'attempt'],
  ['Execution', 'executionSeq'],
  ['Negative count', 'negativeCount'],
  ['Maximum iterations', 'maxIterations'],
] as const;

function assertNever(value: never): never {
  void value;
  throw new Error('Unsupported workflow node message kind');
}

function inspectRow(
  nodeId: string,
  selectedRow: LogRow | null,
  nodeStates: readonly WorkflowNodeState[]
): LogRow {
  if (selectedRow !== null && selectedRow.nodeId === nodeId) return selectedRow;
  const state = nodeStates.find(item => item.nodeId === nodeId);
  return {
    id: nodeId,
    nodeId,
    label: state?.name ?? nodeId,
    status: state?.status ?? 'pending',
    order: 0,
    sourceIndex: 0,
    selection: { kind: 'node' },
    unknownScope: true,
  };
}

function RoomPlaceholder({ children }: { children: string }): ReactElement {
  return (
    <div className="flex flex-1 items-center justify-center px-4 text-center text-[13px] text-text-secondary">
      {children}
    </div>
  );
}

function RoomRegion({
  nodeId,
  children,
  allowOutsetFocus = false,
}: {
  nodeId: string;
  children: ReactNode;
  allowOutsetFocus?: boolean;
}): ReactElement {
  return (
    <section
      role="region"
      aria-label={nodeId + ' room'}
      className={
        allowOutsetFocus
          ? 'm-[4px] flex min-h-0 flex-1 flex-col overflow-clip [overflow-clip-margin:4px]'
          : 'flex min-h-0 flex-1 flex-col overflow-clip [overflow-clip-margin:4px]'
      }
    >
      {children}
    </section>
  );
}

function collectToolIds(messages: readonly WorkflowNodeMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    if (message.kind === 'tool') {
      ids.add(message.payload.id);
    }
  }
  return ids;
}

function StdoutBody({ stdout }: { stdout: StdoutView }): ReactElement {
  return (
    <div className="space-y-3 p-4">
      <p className="text-[11px] text-text-secondary">Status: {inspectStatusLabel(stdout.status)}</p>
      {stdout.truncated ? (
        <p className="text-[11px] text-warning">
          {stdout.originalBytes === null
            ? 'Output truncated'
            : `Output truncated from ${String(stdout.originalBytes)} bytes`}
        </p>
      ) : null}
      {stdout.failedDetail ? <p className="text-[13px] text-error">{stdout.failedDetail}</p> : null}
      {stdout.text === null ? (
        <RoomPlaceholder>Node hasn't produced output</RoomPlaceholder>
      ) : (
        <pre className="overflow-x-auto whitespace-pre-wrap bg-surface-inset p-3 font-mono text-[13px] text-text-primary">
          {stdout.text}
        </pre>
      )}
      {stdout.exitCode === 0 ? (
        <p className="text-[11px] text-text-secondary">Exit status: 0</p>
      ) : null}
    </div>
  );
}

function GateBody({
  chrome,
  run,
  nodeId,
}: {
  chrome: GateChrome;
  run: Run;
  nodeId: string;
}): ReactElement {
  const [annotationDraft, setAnnotationDraft] = useState('');
  const [annotationPending, setAnnotationPending] = useState(false);
  const [annotationError, setAnnotationError] = useState<string | null>(null);
  const [receiptStatus, setReceiptStatus] = useState<string | null>(chrome.feedbackReceiptStatus);
  return (
    <div className="space-y-3 p-4">
      {chrome.showInactiveNotice ? (
        <div className="rounded-md border border-warning/20 bg-warning/5 px-3 py-2">
          <p className="text-[13px] text-text-secondary">Gate is not the active pause</p>
        </div>
      ) : null}
      {chrome.decision !== null ? (
        <p className="text-[13px] text-text-primary">
          {chrome.decision === 'approved' ? 'Approved' : 'Rejected'}
        </p>
      ) : null}
      {chrome.canDecide && chrome.decision === null ? (
        <p className="text-[13px] text-text-secondary">Waiting for approval</p>
      ) : null}
      <p className="text-[13px] text-text-primary">{chrome.message}</p>
      {chrome.document !== null ? (
        <pre className="overflow-x-auto whitespace-pre-wrap bg-surface-inset p-3 font-mono text-[13px] text-text-primary">
          {chrome.document}
        </pre>
      ) : null}
      {chrome.reviewUrl !== null ? (
        <a
          href={chrome.reviewUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center text-[13px] text-primary underline decoration-primary/40 hover:decoration-primary"
        >
          Open Plannotator
        </a>
      ) : null}
      {chrome.gateType === 'plannotator_gate' &&
      chrome.canDecide &&
      chrome.reviewSessionId !== null &&
      chrome.gateId !== null ? (
        <div className="space-y-2">
          <input
            type="text"
            value={annotationDraft}
            onChange={(event): void => {
              setAnnotationDraft(event.target.value);
            }}
            placeholder="Annotations / comment…"
            className="w-full rounded-md border border-border bg-surface-inset px-2 py-1.5 text-[13px] text-text-primary"
            disabled={annotationPending}
          />
          <button
            type="button"
            disabled={annotationPending || annotationDraft.trim().length === 0}
            className="rounded-md px-2 py-1 text-[12px] text-primary hover:bg-primary/10 disabled:opacity-50"
            onClick={(): void => {
              const gateId = chrome.gateId;
              const reviewSessionId = chrome.reviewSessionId;
              if (gateId === null || reviewSessionId === null) return;
              void (async (): Promise<void> => {
                setAnnotationError(null);
                setAnnotationPending(true);
                try {
                  const receipt = await submitRunReviewFeedback(run.id, {
                    nodeId,
                    gateId,
                    reviewSessionId,
                    requestId: crypto.randomUUID(),
                    feedback: annotationDraft.trim(),
                  });
                  setReceiptStatus(receipt.status);
                  setAnnotationDraft('');
                } catch (error: unknown) {
                  setAnnotationError(error instanceof Error ? error.message : String(error));
                } finally {
                  setAnnotationPending(false);
                }
              })();
            }}
          >
            Send annotations
          </button>
          {receiptStatus !== null ? (
            <p className="text-[11px] text-text-secondary">Annotations {receiptStatus}</p>
          ) : null}
          {annotationError !== null ? (
            <p className="text-[11px] text-error">{annotationError}</p>
          ) : null}
        </div>
      ) : null}
      {chrome.canDecide ? <ApprovalPanel run={run} /> : null}
    </div>
  );
}

function WorkflowBody({
  projectId,
  childRunId,
  fanOut,
  output,
  paused,
  message,
}: {
  projectId: string;
  childRunId: string | null;
  fanOut: boolean;
  output: string | null;
  paused: boolean;
  message: string | null;
}): ReactElement {
  const hasContent = childRunId !== null || fanOut || output !== null || paused;
  return (
    <div className="space-y-3 p-4">
      <h3 className="text-[13px] font-medium text-text-primary">Child run</h3>
      {paused ? (
        <p className="rounded border border-warning/20 bg-warning/5 p-3 text-[13px] text-warning">
          {message ?? 'Sub-run is paused pending review'}
        </p>
      ) : null}
      {fanOut ? (
        <p className="text-[13px] text-text-secondary">This node spawned multiple child runs</p>
      ) : null}
      {childRunId !== null ? (
        <a
          href={`/console/p/${encodeURIComponent(projectId)}/r/${encodeURIComponent(childRunId)}`}
          className="text-[13px] text-primary hover:underline"
        >
          Open child run
        </a>
      ) : null}
      {output !== null ? (
        <pre className="overflow-x-auto whitespace-pre-wrap bg-surface-inset p-3 font-mono text-[13px] text-text-primary">
          {output}
        </pre>
      ) : null}
      {!hasContent ? <RoomPlaceholder>Child run has not started</RoomPlaceholder> : null}
    </div>
  );
}

function RouteBody({ decision }: { decision: RouteDecisionView | null }): ReactElement {
  return (
    <div className="space-y-3 p-4">
      <h3 className="text-[13px] font-medium text-text-primary">Routing decision</h3>
      {decision === null ? (
        <RoomPlaceholder>Node hasn't produced output</RoomPlaceholder>
      ) : (
        <dl className="space-y-2">
          {ROUTE_FIELDS.map(([label, key]) =>
            decision[key] === null ? null : (
              <div key={key} className="grid grid-cols-[9rem_1fr] gap-2 text-[13px]">
                <dt className="text-text-secondary">{label}</dt>
                <dd className="font-mono text-text-primary">{decision[key]}</dd>
              </div>
            )
          )}
        </dl>
      )}
    </div>
  );
}

function LoopGroupBody({ chrome }: { chrome: LoopGroupChrome }): ReactElement {
  return (
    <div className="space-y-4 p-4">
      <h3 className="text-[13px] font-medium text-text-primary">Loop group</h3>
      <div className="space-y-2">
        <h4 className="text-[11px] font-medium uppercase text-text-secondary">Body nodes</h4>
        {chrome.body.map(node => (
          <div key={node.qualifiedId} className="text-[13px] text-text-primary">
            <span className="font-mono">{node.id}</span>
            <span className="ml-2 text-text-secondary">
              {node.dependsOn.length === 0 ? 'Start' : `After ${node.dependsOn.join(', ')}`}
            </span>
          </div>
        ))}
      </div>
      {chrome.iterations.length === 0 ? (
        <RoomPlaceholder>Node hasn't produced output</RoomPlaceholder>
      ) : (
        chrome.iterations.map(iteration => {
          const selected = iteration.iteration === chrome.selectedIteration;
          return (
            <details
              key={iteration.iteration}
              open={selected}
              aria-current={selected ? 'true' : undefined}
              className="rounded border border-border bg-surface-elevated p-3"
            >
              <summary className="cursor-pointer text-[13px] text-text-primary">
                {'×' + String(iteration.iteration) + ' ' + iteration.status}
              </summary>
              <div className="mt-2 space-y-1">
                {iteration.body.map(node => (
                  <p key={node.qualifiedId} className="text-[13px] text-text-secondary">
                    <span className="font-mono text-text-primary">{node.qualifiedId}</span>{' '}
                    {node.status}
                  </p>
                ))}
              </div>
            </details>
          );
        })
      )}
    </div>
  );
}

function isUnknownAgentFallback(resolution: RoomResolution | null): boolean {
  return resolution !== null && resolution.kind === 'agent' && resolution.nodeType === 'unknown';
}

function isAgentKind(kind: RoomKind | undefined): boolean {
  return kind === 'agent';
}

function selectionFromRow(
  row: LogRow
):
  | { kind: 'occurrence'; occurrenceId: string; attemptId?: string }
  | { kind: 'node'; rowId: string } {
  if (row.selection.kind === 'occurrence') {
    const selection: { kind: 'occurrence'; occurrenceId: string; attemptId?: string } = {
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

export function ConsoleNodeRoom({
  run,
  projectId,
  nodeId,
  selectedRow,
  definitionNodes,
  definitionPending,
  nodeStates,
  events,
  approval,
  isLive,
  loadMessages,
  loadMessage = getNodeMessage,
  onClose,
  pendingInteractions,
  ownsUnscopedInteractions,
  viewerIsStarter,
  starterDisplayName,
  actionStates,
  onSubmitAsk,
  headerModel,
  headerOptions,
  onSelectRow,
  showToolCalls = true,
  showSystem = true,
  closeLabel = 'Close',
  scopeKey,
  initialScrollTop,
  onScrollTopChange,
  askDrafts = {},
  onAskDraftChange,
}: ConsoleNodeRoomProps): ReactElement {
  const resolution =
    nodeId === null ? null : resolveRoomKind(nodeId, definitionNodes, events, approval);
  const waitingOnDefinition = definitionPending && isUnknownAgentFallback(resolution);
  const agentActive = nodeId !== null && isAgentKind(resolution?.kind) && !waitingOnDefinition;
  const row = nodeId === null ? null : inspectRow(nodeId, selectedRow, nodeStates);
  const resolvedScopeKey =
    scopeKey ??
    (row === null
      ? 'run:none|node:none|sel:node:none'
      : nodeMessageScopeKey(run.id, row.nodeId, selectionFromRow(row)));
  const [pageState, setPageState] = useState<NodeMessageState>(() =>
    createNodeMessageState(resolvedScopeKey)
  );
  const [follow, setFollow] = useState(() =>
    createScrollFollow(row?.status ?? 'completed', initialScrollTop)
  );
  const [retryNonce, setRetryNonce] = useState(0);
  const pageStateRef = useRef(pageState);
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadMessagesRef = useRef(loadMessages);
  const prevScopeRef = useRef(resolvedScopeKey);
  pageStateRef.current = pageState;
  loadMessagesRef.current = loadMessages;

  const nodeKey = row?.nodeId ?? null;
  const rowId = row?.id ?? null;
  const rowStatus = row?.status ?? 'completed';

  useEffect(() => {
    if (prevScopeRef.current !== resolvedScopeKey) {
      prevScopeRef.current = resolvedScopeKey;
      setPageState(createNodeMessageState(resolvedScopeKey));
      setFollow(createScrollFollow(rowStatus, initialScrollTop));
    }
  }, [initialScrollTop, rowStatus, resolvedScopeKey]);

  useEffect(() => {
    if (!agentActive || rowId === null || nodeKey === null || row === null) {
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const selection = selectionFromRow(row);

    const runDrain = async (state: NodeMessageState): Promise<void> => {
      if (cancelled) return;
      const seeded =
        state.scopeKey === resolvedScopeKey
          ? { ...state, loading: true }
          : createNodeMessageState(resolvedScopeKey);
      if (!cancelled) setPageState(seeded);
      const next = await drainNodeMessages({
        runId: run.id,
        nodeId: nodeKey,
        selection,
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
      const el = scrollRef.current;
      if (el !== null) onScrollTopChange?.(el.scrollTop);
    };
  }, [
    agentActive,
    isLive,
    nodeKey,
    onScrollTopChange,
    resolvedScopeKey,
    retryNonce,
    row,
    rowId,
    run.id,
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

  const computedHeader: ExecutionHeaderModel | null =
    headerModel ??
    (row === null
      ? null
      : buildExecutionHeader({
          row: {
            id: row.id,
            nodeId: row.nodeId,
            label: row.label,
            status: row.status,
            order: row.order,
            selection: row.selection,
            startedAt: row.startedAt,
            durationMs: row.durationMs,
            startedOffsetMs: row.startedOffsetMs,
            unknownScope: row.unknownScope,
          },
          events,
          runStartedAt: run.startedAt,
        }));
  const computedOptions: readonly ConsoleExecutionHeaderOption[] =
    headerOptions ??
    (computedHeader === null || row === null
      ? []
      : [{ rowId: row.id, label: computedHeader.executionLabel }]);

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
          nowMs,
        });
  const items = agentHistory.items;
  const showTodoStrip = agentActive && agentHistory.todos.length > 0;
  const visibleAsks =
    row !== null && resolution?.kind === 'agent'
      ? selectVisibleNodeAskInteractions({
          pending: pendingInteractions,
          nodeId: row.nodeId,
          selection: row.selection,
          allMessages,
          visibleMessages,
          ownsUnscopedInteractions,
        })
      : [];
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
  const selectedNodeState =
    row === null ? undefined : nodeStates.find(state => state.nodeId === row.nodeId);
  const firstActionableId = orderedAsks.find(interaction => {
    if (interaction.status !== 'pending') return false;
    if (parseAskEnvelope(interaction.envelope) === null) return false;
    return (
      resolveAskCardPresentation({
        interaction,
        action: actionStates[interaction.tool_use_id],
        nodeStatus: selectedNodeState?.status,
        nodeError: selectedNodeState?.error,
      }).viewState === 'pending'
    );
  })?.id;
  const agentDisplayName = row?.label ?? '';
  const roomNodeId = row?.nodeId ?? '';

  const renderAskCard = (interaction: PendingInteraction): ReactElement => {
    const questions = parseAskEnvelope(interaction.envelope);
    const limitation =
      interaction.execution_scope == null ? (
        <p className="text-xs text-warning">{UNSCOPED_INTERACTION_LIMITATION}</p>
      ) : null;
    if (questions === null) {
      return (
        <div key={interaction.id}>
          {limitation}
          <ConsoleInvalidAskCard
            interaction={interaction}
            agentDisplayName={agentDisplayName}
            nodeId={roomNodeId}
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
            nodeStatus: selectedNodeState?.status,
            nodeError: selectedNodeState?.error,
          })}
          viewerIsStarter={viewerIsStarter}
          starterDisplayName={starterDisplayName}
          agentDisplayName={agentDisplayName}
          nodeId={roomNodeId}
          autoFocus={interaction.id === firstActionableId}
          nowMs={nowMs}
          mountContext="room"
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

  const handleScroll = (event: UIEvent<HTMLDivElement>): void => {
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
    agentActive &&
    pageState.rows.length === 0 &&
    pageState.error === null &&
    (pageState.loading || !pageState.complete);

  let body: ReactNode;
  if (nodeId === null || resolution === null || row === null) {
    body = <RoomPlaceholder>Select a node</RoomPlaceholder>;
  } else if (waitingOnDefinition) {
    body = <RoomPlaceholder>Loading workflow definition</RoomPlaceholder>;
  } else if (resolution.kind === 'agent') {
    const history = (
      <ConsoleAgentHistoryList
        items={items}
        showToolCalls={showToolCalls}
        showSystem={showSystem}
        unknownScope={row.unknownScope === true}
        onLoadFullOutput={async (item): Promise<unknown> => {
          const message = await loadMessage(run.id, row.nodeId, item.messageId);
          return message.kind === 'tool' ? message.payload.output : undefined;
        }}
        renderAfterItem={(item): ReactNode => {
          if (item.kind !== 'tool') return null;
          const matching = anchoredAsks.filter(
            interaction => interaction.tool_use_id === item.toolUseId
          );
          if (matching.length === 0) return null;
          return matching.map(renderAskCard);
        }}
        renderAtEnd={unanchoredAsks.length === 0 ? undefined : unanchoredAsks.map(renderAskCard)}
      />
    );
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
          {unanchoredAsks.length === 0 ? null : (
            <div className="flex flex-col gap-3 p-3">{unanchoredAsks.map(renderAskCard)}</div>
          )}
        </div>
      );
    } else if (waitingForFirstPage) {
      body = <RoomPlaceholder>Loading node transcript</RoomPlaceholder>;
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
  } else if (resolution.kind === 'stdout') {
    body = <StdoutBody stdout={selectNodeStdout(events, row)} />;
  } else if (resolution.kind === 'gate') {
    body = (
      <GateBody
        run={run}
        nodeId={row.nodeId}
        chrome={selectGateChrome({
          definitionNode: resolution.definitionNode,
          events,
          row,
          approval,
          runStatus: run.status,
          gateType: resolution.nodeType === 'plannotator_gate' ? 'plannotator_gate' : 'approval',
        })}
      />
    );
  } else if (resolution.kind === 'workflow') {
    const child = selectChildRun({ events, approval, row, runStatus: run.status });
    body = (
      <WorkflowBody
        projectId={projectId}
        childRunId={child.childRunId}
        fanOut={child.fanOut}
        output={child.output}
        paused={child.paused}
        message={child.message}
      />
    );
  } else if (resolution.kind === 'route_loop') {
    body = <RouteBody decision={selectRouteDecision(events, row)} />;
  } else if (resolution.kind === 'loop_group') {
    body = (
      <LoopGroupBody
        chrome={selectLoopGroupChrome({
          definitionNode: resolution.definitionNode,
          events,
          row,
        })}
      />
    );
  } else {
    body = assertNever(resolution.kind);
  }

  const header =
    computedHeader === null ? null : (
      <ConsoleRoomHeader
        model={computedHeader}
        options={computedOptions}
        selectedRowId={row?.id ?? computedOptions[0]?.rowId ?? ''}
        onSelectRow={(rowIdValue: string): void => {
          onSelectRow?.(rowIdValue);
        }}
        onClose={onClose}
        closeLabel={closeLabel}
      />
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      {header}
      {nodeId === null ? (
        body
      ) : (
        <RoomRegion nodeId={nodeId} allowOutsetFocus={showTodoStrip}>
          {showTodoStrip ? (
            <ConsoleTodoStrip key={resolvedScopeKey} phases={agentHistory.todos} />
          ) : null}
          <div
            ref={scrollRef}
            data-testid="console-node-room-scroll"
            className="min-h-0 flex-1 overflow-y-auto"
            style={{ overflowWrap: 'anywhere' }}
            onScroll={handleScroll}
          >
            {body}
          </div>
          {!follow.follow && (rowStatus === 'running' || rowStatus === 'awaiting') ? (
            <button type="button" className="px-3 py-2 text-xs text-primary" onClick={handleJump}>
              Jump to latest
            </button>
          ) : null}
        </RoomRegion>
      )}
    </div>
  );
}
