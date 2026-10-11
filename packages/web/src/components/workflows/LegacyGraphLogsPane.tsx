/**
 * Run and node columns of the Runs workspace: the run's node list (or graph) on
 * the left, the selected node's room and the run-wide tabs on the right.
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { NodeColumnTabs } from '@/components/runs/NodeColumnTabs';
import { NodeStepList, type NodeRowInfo } from '@/components/runs/NodeStepList';
import { formatElapsed, LiveElapsed } from '@/components/ui/live-elapsed';
import { SectionLabel } from '@/components/ui/section-label';
import { Segmented } from '@/components/ui/segmented';
import {
  getWorkflowNodeMessages,
  type AskAnswerBody,
  type ConversationResponse,
  type DagNode,
  type MessageResponse,
  type NodeExecution,
  type PendingInteraction,
  type WorkflowEventResponse,
  type WorkflowNodeStateResponse,
} from '@/lib/api';
import { readApprovalContext, type WebApprovalContext } from '@/lib/approval-context';
import { ensureUtc } from '@/lib/format';
import {
  chooseExecutionForNode,
  hasTerminalNodeEvidence,
  hasIdleAwaitExpiredEvidence,
  isLiveRowStatus,
  latestNodeExecutionKey,
  resolveFinishedIterationView,
  roomOpenerId,
  type ExecutionHeaderModel,
  type RunOfTotal,
} from '@/lib/execution-room-model';
import { groupNodesIntoSteps, type NodeStep } from '@/lib/node-steps';
import { nodeExtras } from '@/lib/runs/node-extras';
import { isRunTab, type NodeColumnTab, type RunTab } from '@/lib/runs/run-url';
import type { DagNodeState, WorkflowRunStatus } from '@/lib/types';
import { useContainerSplitMode, type ContainerSplitMode } from '@/lib/use-container-split-mode';
import { cn } from '@/lib/utils';

import { AskCard, InvalidAskCard } from './AskCard';
import type { AskActionStateByRequest } from './ask-answer-controller';
import { resolveAskCardPresentation } from './ask-card-presentation';
import { buildChatTimeline, type ChatTimelineEntry } from './build-chat-timeline';

import { buildLogRows, type LogRow } from './build-log-rows';
import { ChatTimeline } from './ChatTimeline';
import { LegacyNodeRoom } from './LegacyNodeRoom';
import { RoomPlaceholder } from './NodeRoom';
import { isLiveRunStatus } from './NodeTranscriptPane';
import { NodeRunList } from './NodeRunList';
import type { ExecutionHeaderOption } from './NodeRoomHeader';
import { resolveGraphRoomRow } from './resolve-graph-room-row';
import { resolveRoomKind } from './resolve-room-kind';
import { resolveTimelineRoomRow } from './resolve-timeline-room-row';
import { parseAskEnvelope, type AskDraft, type AskDraftByRequest } from './parse-ask-envelope';
import { RunChatComposer } from './RunChatComposer';
import { selectNodeStdout } from './select-room-data';

/** Width below which the run and node columns show one at a time. */
const SPLIT_MIN_REM = 34;

export type RunNodeView = 'list' | 'graph';

export interface LegacyGraphLogsPaneProps {
  /** Run column body: the node step list or the graph. */
  nodeView: RunNodeView;
  onNodeViewChange?: (view: RunNodeView) => void;
  /** Node column tab. */
  tab: NodeColumnTab;
  onTabChange?: (tab: NodeColumnTab) => void;
  /** Run-wide tabs this run offers, in display order. */
  runTabs?: readonly RunTab[];
  /** Content of a run-wide tab. The pane renders "conversation" itself. */
  renderRunTab?: (tab: Exclude<RunTab, 'conversation'>) => ReactNode;
  /** Run header at the top of the run column. */
  runHeader?: ReactNode;
  /** Live per-node state, for loop iterations in the node list. */
  dagNodes?: readonly DagNodeState[];
  renderGraph: (input: {
    selectedNodeId: string | null;
    onNodeClick: (nodeId: string) => void;
  }) => ReactNode;
  selectedNodeId: string | null;
  selectedLogRowId: string | null;
  /**
   * True while the room is following the live execution rather than pinned
   * to an explicit pick — see `RoomVisitSelection.followingLive`. Feeds the
   * gap-hold override that keeps the dock in composer mode between one
   * loop iteration's row completing and the next iteration's row starting,
   * when `selectedLogRowId` resolves to that just-finished row because
   * nothing live exists yet to follow.
   */
  followingLive?: boolean;
  lastExplicitRowByNode?: Record<string, string>;
  onOpenRoom: (
    rowId: string,
    nodeId: string,
    openerId: string | null,
    rememberExplicit: boolean
  ) => void;
  onCloseRoom: () => void;
  splitMode?: ContainerSplitMode;
  runId: string;
  runStartedAt: string;
  nodeStates: readonly WorkflowNodeStateResponse[];
  events: readonly WorkflowEventResponse[];
  nodeExecutions?: readonly NodeExecution[];
  loadMessages: typeof getWorkflowNodeMessages;
  parentPlatformId: string | null;
  loadParentMessages: (conversationId: string) => Promise<MessageResponse[]>;
  loadParentConversation: (conversationId: string) => Promise<ConversationResponse>;
  sendParentMessage: (
    conversationId: string,
    message: string
  ) => Promise<{ accepted: boolean; status: string }>;
  roomHeader?: ReactNode;
  roomFooter?: ReactNode;
  definitionNodes: readonly DagNode[];
  definitionPending: boolean;
  runStatus: WorkflowRunStatus;
  approval: unknown;
  onApprove: () => Promise<void>;
  onReject: (reason?: string) => Promise<void>;
  pendingInteractions: readonly PendingInteraction[];
  viewerIsStarter: boolean;
  starterDisplayName: string | null;
  actionStates: AskActionStateByRequest;
  onSubmitAsk: (requestId: string, body: AskAnswerBody) => Promise<void>;
  headerModel?: ExecutionHeaderModel;
  headerOptions?: readonly ExecutionHeaderOption[];
  /** Uncapped execution total for the node, for the header's "of N · max 8" caption. */
  executionCount?: number;
  /** Retry position/count for the selected row, from the parent pane. */
  runOfTotal?: RunOfTotal | null;
  onSelectExecution?: (rowId: string) => void;
  scopeKey?: string;
  initialScrollTop?: number;
  onScrollTopChange?: (scrollTop: number) => void;
  askDrafts?: AskDraftByRequest;
  onAskDraftChange?: (requestId: string, draft: AskDraft) => void;
  /**
   * Invalidate the cached run entity on the exact edge a node room's own
   * dock learns (via its faster-cadenced queue read) that the node just
   * settled, before the run's own status poll/SSE has caught up — see
   * `shouldRefetchRunOnDockFinished`. Omitted in a context with no run-entity
   * cache to invalidate (e.g. a standalone render in tests).
   */
  onRunSettleHint?: () => void;
  /** Forwarded to the composer dock; see its own doc comment. Default 0. */
  terminalEdgeKick?: number;
}

export function runChatMessagesRefetchInterval(status: WorkflowRunStatus): 3000 | false {
  switch (status) {
    case 'pending':
    case 'running':
    case 'paused':
      return 3000;
    case 'completed':
    case 'failed':
    case 'cancelled':
      return false;
  }
}

function isSelectablePauseContext(context: WebApprovalContext): boolean {
  return (
    context.type === undefined ||
    context.type === 'approval' ||
    context.type === 'plannotator_gate' ||
    context.type === 'child_workflow'
  );
}

function isSelectableApprovalEvent(event: WorkflowEventResponse): boolean {
  if (event.event_type !== 'approval_requested') return false;
  const gateType = event.data.gateType;
  return gateType === 'approval' || gateType === 'plannotator_gate';
}

function syntheticStatusFromEvent(
  event: WorkflowEventResponse
): WorkflowNodeStateResponse['status'] | null {
  if (event.event_type === 'loop_iteration_started') return 'running';
  if (event.event_type === 'loop_iteration_completed') return 'completed';
  if (event.event_type === 'loop_iteration_failed') return 'failed';
  if (isSelectableApprovalEvent(event)) return 'running';
  return null;
}

function eventNodeId(event: WorkflowEventResponse): string | null {
  if (typeof event.step_name === 'string' && event.step_name.length > 0) {
    return event.step_name;
  }
  const nodeId = event.data.nodeId;
  if (typeof nodeId === 'string' && nodeId.length > 0) return nodeId;
  return null;
}

function synthesizeLegacyLogNodeStates(input: {
  nodeStates: readonly WorkflowNodeStateResponse[];
  events: readonly WorkflowEventResponse[];
  runStatus: WorkflowRunStatus;
  approval: unknown;
}): readonly WorkflowNodeStateResponse[] {
  const seen = new Set(input.nodeStates.map(state => state.nodeId));
  const next: WorkflowNodeStateResponse[] = [...input.nodeStates];

  // Some control-flow pauses do not persist node_started, so the server
  // projection has no nodeState until the gate or group resolves.
  const addSynthetic = (nodeId: string, status: WorkflowNodeStateResponse['status']): void => {
    if (seen.has(nodeId)) return;
    seen.add(nodeId);
    next.push({ nodeId, name: nodeId, status, retryEpoch: 0 });
  };

  for (const event of input.events) {
    const status = syntheticStatusFromEvent(event);
    if (status === null) continue;
    const nodeId = eventNodeId(event);
    if (nodeId !== null) addSynthetic(nodeId, status);
  }

  const context = readApprovalContext(input.approval);
  if (input.runStatus === 'paused' && context !== null && isSelectablePauseContext(context)) {
    addSynthetic(context.nodeId, 'running');
  }

  return next.length === input.nodeStates.length ? input.nodeStates : next;
}

/** Steps for a run without a loaded definition: each known node is its own step. */
function fallbackSteps(nodeStates: readonly WorkflowNodeStateResponse[]): NodeStep[] {
  return nodeStates.map((state, position) => ({
    index: position + 1,
    number: String(position + 1).padStart(2, '0'),
    parallel: false,
    nodes: [
      {
        id: state.nodeId,
        node: { id: state.nodeId } as DagNode,
        kind: 'unknown',
        code: 'NODE',
        children: [],
      },
    ],
  }));
}

/**
 * A definition node by runtime id. A loop-group body node runs as
 * `<groupId>.<bodyId>`, so the lookup descends into the group by that prefix.
 */
function findDefinitionNode(nodes: readonly DagNode[], nodeId: string): DagNode | undefined {
  for (const node of nodes) {
    if (node.id === nodeId) return node;
    const body = node.loop_group?.nodes;
    if (body !== undefined && nodeId.startsWith(`${node.id}.`)) {
      const child = findDefinitionNode(body as DagNode[], nodeId.slice(node.id.length + 1));
      if (child !== undefined) return child;
    }
  }
  return undefined;
}

function rowRight(status: string, latest: LogRow | undefined): React.ReactNode {
  if (latest === undefined) return undefined;
  if (status === 'running' && latest.startedAt !== undefined) {
    return <LiveElapsed since={ensureUtc(latest.startedAt)} />;
  }
  if (status === 'awaiting' && latest.startedAt !== undefined) {
    return (
      <>
        waiting <LiveElapsed since={ensureUtc(latest.startedAt)} />
      </>
    );
  }
  return latest.durationMs !== undefined ? formatElapsed(latest.durationMs) : undefined;
}

export function LegacyGraphLogsPane({
  nodeView,
  onNodeViewChange,
  tab,
  onTabChange,
  runTabs = ['conversation'],
  renderRunTab,
  runHeader,
  dagNodes = [],
  renderGraph,
  selectedNodeId,
  selectedLogRowId,
  followingLive = false,
  lastExplicitRowByNode = {},
  onOpenRoom,
  onCloseRoom,
  splitMode: splitModeOverride,
  runId,
  runStartedAt,
  nodeStates,
  events,
  nodeExecutions,
  loadMessages,
  parentPlatformId,
  loadParentMessages,
  loadParentConversation,
  sendParentMessage,
  roomHeader,
  roomFooter,
  definitionNodes,
  definitionPending,
  runStatus,
  approval,
  onApprove,
  onReject,
  pendingInteractions,
  viewerIsStarter,
  starterDisplayName,
  actionStates,
  onSubmitAsk,
  headerModel,
  headerOptions,
  executionCount,
  runOfTotal = null,
  onSelectExecution,
  scopeKey,
  initialScrollTop,
  onScrollTopChange,
  askDrafts,
  onAskDraftChange,
  onRunSettleHint,
  terminalEdgeKick = 0,
}: LegacyGraphLogsPaneProps): React.ReactElement {
  const paneRef = useRef<HTMLDivElement>(null);
  const measuredMode = useContainerSplitMode(paneRef, SPLIT_MIN_REM);
  const mode = splitModeOverride ?? measuredMode;
  const visibleNodeStates = useMemo(
    () => synthesizeLegacyLogNodeStates({ nodeStates, events, runStatus, approval }),
    [approval, events, nodeStates, runStatus]
  );
  const rows = useMemo(
    () => buildLogRows(visibleNodeStates, events, nodeExecutions, runStartedAt),
    [events, nodeExecutions, runStartedAt, visibleNodeStates]
  );
  const [selectedTimelineEntryId, setSelectedTimelineEntryId] = useState<string | null>(null);
  const [chatDraft, setChatDraft] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [chatSendError, setChatSendError] = useState<string | null>(null);
  // Run tabs mount on first open and stay mounted while hidden, so a terminal
  // session or a diff position survives a node change or a tab change.
  const [mountedRunTabs, setMountedRunTabs] = useState<readonly RunTab[]>(() =>
    isRunTab(tab) ? [tab] : []
  );
  const sendGeneration = useRef(0);
  const previousRunId = useRef(runId);
  const explicitSelectedRow =
    selectedLogRowId === null
      ? null
      : (rows.find(row => row.id === selectedLogRowId && row.nodeId === selectedNodeId) ?? null);
  const selectedRow =
    selectedNodeId === null
      ? null
      : explicitSelectedRow !== null
        ? explicitSelectedRow
        : resolveGraphRoomRow({
            rows,
            nodeId: selectedNodeId,
            liveStatus: visibleNodeStates,
          });
  const roomOpen = selectedRow !== null;
  const ownsUnscopedInteractions =
    selectedRow !== null &&
    !rows.some(row => row.nodeId === selectedRow.nodeId && row.order > selectedRow.order);

  const selectedNodeState =
    selectedRow === null
      ? undefined
      : visibleNodeStates.find(state => state.nodeId === selectedRow.nodeId);
  // Descriptor only when the host can act on Go via the existing selection path.
  const finishedIteration =
    selectedRow === null || onSelectExecution === undefined
      ? null
      : resolveFinishedIterationView({
          rows,
          selected: selectedRow,
          nodeStatus: selectedNodeState?.status ?? selectedRow.status,
          live: isLiveRunStatus(runStatus),
        });
  const nodeTerminal =
    selectedNodeId === null ? false : hasTerminalNodeEvidence(nodeExecutions, selectedNodeId);
  const idleAwaitExpired =
    selectedNodeId === null ? false : hasIdleAwaitExpiredEvidence(nodeExecutions, selectedNodeId);
  const nodeExecutionKey =
    selectedNodeId === null ? null : latestNodeExecutionKey(events, selectedNodeId);

  const conversationOpen = mountedRunTabs.includes('conversation');
  const parentMessagesQuery = useQuery({
    queryKey: ['runChatMessages', parentPlatformId],
    enabled: conversationOpen && parentPlatformId !== null,
    queryFn: async (): Promise<MessageResponse[]> => {
      if (parentPlatformId === null) throw new Error('Parent conversation is unavailable');
      return loadParentMessages(parentPlatformId);
    },
    retry: false,
    refetchInterval: runChatMessagesRefetchInterval(runStatus),
  });

  const parentConversationQuery = useQuery({
    queryKey: ['runChatConversation', parentPlatformId],
    enabled: conversationOpen && parentPlatformId !== null,
    queryFn: async (): Promise<ConversationResponse> => {
      if (parentPlatformId === null) throw new Error('Parent conversation is unavailable');
      return loadParentConversation(parentPlatformId);
    },
    retry: false,
    staleTime: Infinity,
  });

  const composerDisabledReason =
    parentPlatformId === null
      ? 'This run has no parent conversation, so replies cannot be delivered.'
      : parentConversationQuery.fetchStatus === 'fetching' &&
          parentConversationQuery.data === undefined
        ? 'Loading conversation…'
        : parentConversationQuery.isError
          ? 'Unable to load conversation details.'
          : parentConversationQuery.data?.platform_type !== 'web'
            ? 'Continuing chats from other platforms in the Web UI is coming soon'
            : null;

  const chatEntries = useMemo(
    () =>
      buildChatTimeline({
        messages: parentMessagesQuery.data ?? [],
        events,
        nodeStates: visibleNodeStates,
        resolveNodeType: (nodeId: string) =>
          resolveRoomKind(nodeId, definitionNodes, events, approval).nodeType,
        rows,
        pendingInteractions,
        approval,
      }),
    [
      approval,
      definitionNodes,
      events,
      parentMessagesQuery.data,
      pendingInteractions,
      rows,
      visibleNodeStates,
    ]
  );

  const parentMessagesError = parentMessagesQuery.isError
    ? parentMessagesQuery.error instanceof Error
      ? parentMessagesQuery.error.message
      : 'Failed to load conversation turns.'
    : null;

  useEffect(() => {
    if (previousRunId.current === runId) return;
    previousRunId.current = runId;
    sendGeneration.current += 1;
    setChatDraft('');
    setChatSending(false);
    setChatSendError(null);
    setSelectedTimelineEntryId(null);
    setMountedRunTabs(isRunTab(tab) ? [tab] : []);
    // A run change resets the run tabs once; the active tab is read, not tracked.
  }, [runId]);

  useEffect(() => {
    if (!isRunTab(tab)) return;
    setMountedRunTabs(current => (current.includes(tab) ? current : [...current, tab]));
  }, [tab]);

  useEffect(() => {
    if (selectedNodeId === null) setSelectedTimelineEntryId(null);
  }, [selectedNodeId]);

  const handleGraphNodeClick = (nodeId: string): void => {
    setSelectedTimelineEntryId(null);
    const lastExplicit = selectedNodeId === nodeId ? null : (lastExplicitRowByNode[nodeId] ?? null);
    const chosen = chooseExecutionForNode(rows, nodeId, lastExplicit);
    const row =
      chosen ??
      resolveGraphRoomRow({
        rows,
        nodeId,
        liveStatus: visibleNodeStates,
      });
    if (row === null) return;
    onOpenRoom(row.id, nodeId, roomOpenerId('legacy', 'graph', nodeId), false);
  };

  const handleLogRowSelect = (row: LogRow): void => {
    setSelectedTimelineEntryId(null);
    onOpenRoom(row.id, row.nodeId, roomOpenerId('legacy', 'log', row.id), true);
  };

  const handleNodeStatusSelect = (
    entry: Extract<ChatTimelineEntry, { kind: 'node_status' }>
  ): void => {
    const row = resolveTimelineRoomRow({
      rows,
      entry,
      liveStatus: visibleNodeStates,
    });
    setSelectedTimelineEntryId(entry.id);
    onOpenRoom(row.id, row.nodeId, null, true);
    // The room shows in the stream tab; the conversation stays mounted behind it.
    onTabChange?.('stream');
  };

  const handleChatSubmit = (): void => {
    const message = chatDraft.trim();
    if (parentPlatformId === null || message.length === 0 || composerDisabledReason !== null) {
      return;
    }
    const generation = ++sendGeneration.current;
    setChatSending(true);
    setChatSendError(null);
    void sendParentMessage(parentPlatformId, message)
      .then((): void => {
        if (sendGeneration.current !== generation) return;
        setChatDraft('');
        void parentMessagesQuery.refetch();
      })
      .catch((error: unknown): void => {
        if (sendGeneration.current !== generation) return;
        setChatSendError(error instanceof Error ? error.message : 'Failed to send message.');
      })
      .finally((): void => {
        if (sendGeneration.current === generation) setChatSending(false);
      });
  };

  const steps = useMemo((): NodeStep[] => {
    if (definitionNodes.length === 0) return fallbackSteps(visibleNodeStates);
    const defined = groupNodesIntoSteps(definitionNodes);
    // A node that ran but is no longer in the definition still gets a row, after
    // the defined steps, so its room stays reachable.
    const known = new Set(
      defined.flatMap(step =>
        step.nodes.flatMap(node => [node.id, ...node.children.map(child => child.id)])
      )
    );
    const orphans = fallbackSteps(visibleNodeStates.filter(state => !known.has(state.nodeId)));
    return [
      ...defined,
      ...orphans.map((step, offset) => {
        const index = defined.length + offset + 1;
        return { ...step, index, number: String(index).padStart(2, '0') };
      }),
    ];
  }, [definitionNodes, visibleNodeStates]);
  const topLevelIds = steps.flatMap(step => step.nodes.map(node => node.id));
  const statusOf = (nodeId: string): string =>
    visibleNodeStates.find(state => state.nodeId === nodeId)?.status ?? 'pending';
  const doneCount = topLevelIds.filter(id => statusOf(id) === 'completed').length;
  const infoOf = (nodeId: string): NodeRowInfo => {
    const status = statusOf(nodeId);
    const nodeRows = rows.filter(row => row.nodeId === nodeId);
    return {
      status,
      right: rowRight(status, nodeRows[nodeRows.length - 1]),
      extras: nodeExtras({
        definition: findDefinitionNode(definitionNodes, nodeId),
        state: dagNodes.find(node => node.nodeId === nodeId),
        rows: nodeRows,
      }),
    };
  };

  const runColumnBody =
    nodeView === 'graph' ? (
      <div className="h-full min-h-[320px]">
        {renderGraph({
          selectedNodeId: selectedRow?.nodeId ?? selectedNodeId,
          onNodeClick: handleGraphNodeClick,
        })}
      </div>
    ) : (
      <NodeStepList
        steps={steps}
        infoOf={infoOf}
        selectedNodeId={selectedRow?.nodeId ?? selectedNodeId}
        onSelect={handleGraphNodeClick}
      />
    );

  const conversationPane = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <ChatTimeline
          entries={chatEntries}
          selectedEntryId={selectedTimelineEntryId}
          onSelectNodeStatus={handleNodeStatusSelect}
          loading={
            parentMessagesQuery.fetchStatus === 'fetching' && parentMessagesQuery.data === undefined
          }
          error={parentMessagesError}
          renderAsk={(entry): React.ReactNode => {
            const questions = parseAskEnvelope(entry.interaction.envelope);
            if (questions === null) {
              const row = rows.find(candidate => candidate.id === entry.rowId);
              return (
                <InvalidAskCard
                  interaction={entry.interaction}
                  agentDisplayName={row?.label ?? entry.interaction.node_id}
                  nodeId={entry.interaction.node_id}
                />
              );
            }
            const requestId = entry.interaction.tool_use_id;
            const row = rows.find(candidate => candidate.id === entry.rowId);
            return (
              <AskCard
                interaction={entry.interaction}
                questions={questions}
                presentation={resolveAskCardPresentation({
                  interaction: entry.interaction,
                  action: actionStates[requestId],
                  nodeStatus: visibleNodeStates.find(
                    state => state.nodeId === entry.interaction.node_id
                  )?.status,
                  nodeError: visibleNodeStates.find(
                    state => state.nodeId === entry.interaction.node_id
                  )?.error,
                })}
                viewerIsStarter={viewerIsStarter}
                starterDisplayName={starterDisplayName}
                agentDisplayName={row?.label ?? entry.interaction.node_id}
                nodeId={entry.interaction.node_id}
                autoFocus={false}
                nowMs={Date.now()}
                mountContext="chat"
                draft={askDrafts?.[requestId] ?? {}}
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
            );
          }}
        />
      </div>
      <RunChatComposer
        value={chatDraft}
        onValueChange={setChatDraft}
        onSubmit={handleChatSubmit}
        sending={chatSending}
        disabledReason={composerDisabledReason}
        error={chatSendError}
      />
    </div>
  );

  const historyRows =
    selectedRow === null ? [] : rows.filter(row => row.nodeId === selectedRow.nodeId);
  const tabs = (
    <NodeColumnTabs
      tab={tab}
      onTabChange={(next): void => {
        onTabChange?.(next);
      }}
      live={selectedRow !== null && isLiveRowStatus(selectedRow.status)}
      historyCount={historyRows.length}
      nodeOpen={roomOpen}
      runTabs={runTabs}
    />
  );
  const nodeTabActive = !isRunTab(tab);
  const selectedDefinition =
    selectedRow === null ? undefined : findDefinitionNode(definitionNodes, selectedRow.nodeId);

  const nodeTabBody =
    selectedRow === null ? null : tab === 'history' ? (
      <div className="min-h-0 flex-1 overflow-auto">
        <NodeRunList
          rows={historyRows}
          selectedRowId={selectedRow.id}
          onSelect={(row): void => {
            // A History pick shows that execution's transcript, as in the prototype.
            handleLogRowSelect(row);
            onTabChange?.('stream');
          }}
        />
      </div>
    ) : tab === 'output' ? (
      <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
        <SectionLabel>Output</SectionLabel>
        {((): React.ReactElement => {
          const text = selectNodeStdout(events, selectedRow).text;
          return text === null || text === '' ? (
            <p className="mt-2 text-sm text-text-secondary">This node has no output yet.</p>
          ) : (
            <div className="mt-2 max-w-[60ch] text-base leading-[1.55] whitespace-pre-wrap">
              {text}
            </div>
          );
        })()}
      </div>
    ) : tab === 'raw' ? (
      <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
        <pre className="bg-code-bg p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-code-fg">
          {JSON.stringify(
            { state: selectedNodeState ?? null, definition: selectedDefinition ?? null },
            null,
            2
          )}
        </pre>
      </div>
    ) : null;

  const nodeColumn = (
    <div
      data-testid="node-column"
      className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background"
    >
      {selectedRow === null ? (
        <>
          {tabs}
          {nodeTabActive ? <RoomPlaceholder>Select a node</RoomPlaceholder> : null}
        </>
      ) : (
        <div
          id="legacy-run-room"
          data-testid="legacy-node-room"
          className={cn(
            'flex min-w-0 flex-col overflow-hidden',
            tab === 'stream' ? 'min-h-0 flex-1' : 'flex-none'
          )}
        >
          {roomHeader}
          <LegacyNodeRoom
            runId={runId}
            row={selectedRow}
            loadMessages={loadMessages}
            definitionNodes={definitionNodes}
            definitionPending={definitionPending}
            events={events}
            runStatus={runStatus}
            approval={approval}
            onApprove={onApprove}
            onReject={onReject}
            pendingInteractions={pendingInteractions}
            ownsUnscopedInteractions={ownsUnscopedInteractions}
            viewerIsStarter={viewerIsStarter}
            starterDisplayName={starterDisplayName}
            actionStates={actionStates}
            onSubmitAsk={onSubmitAsk}
            nodeState={selectedNodeState}
            followingLive={followingLive}
            headerModel={headerModel}
            headerOptions={headerOptions}
            executionCount={executionCount}
            runOfTotal={runOfTotal}
            onSelectRow={onSelectExecution}
            finishedIteration={finishedIteration}
            nodeTerminal={nodeTerminal}
            idleAwaitExpired={idleAwaitExpired}
            nodeExecutionKey={nodeExecutionKey}
            onClose={onCloseRoom}
            closeLabel={mode === 'single' ? 'Back' : 'Close'}
            scopeKey={scopeKey}
            initialScrollTop={initialScrollTop}
            onScrollTopChange={onScrollTopChange}
            askDrafts={askDrafts}
            onAskDraftChange={onAskDraftChange}
            onRunSettleHint={onRunSettleHint}
            terminalEdgeKick={terminalEdgeKick}
            tabs={tabs}
            showBody={tab === 'stream'}
          />
          {roomFooter}
        </div>
      )}
      {nodeTabBody}
      {mountedRunTabs.map(runTab => (
        <div
          key={runTab}
          role="tabpanel"
          aria-labelledby={`node-column-tab-${runTab}`}
          hidden={runTab !== tab}
          className={runTab === tab ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'hidden'}
        >
          {runTab === 'conversation' ? conversationPane : renderRunTab?.(runTab)}
        </div>
      ))}
    </div>
  );

  const runColumn = (
    <div
      id="legacy-run-view"
      data-testid="run-column"
      className="flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-border"
    >
      {runHeader}
      <div className="flex flex-none items-center justify-between gap-3 px-6 pt-3 pb-2">
        <div className="flex items-baseline gap-3">
          <SectionLabel>Nodes</SectionLabel>
          <span className="text-[11px] tracking-[0.08em] text-text-secondary uppercase">
            {String(doneCount)} of {String(topLevelIds.length)} done
          </span>
        </div>
        {onNodeViewChange !== undefined ? (
          <Segmented
            aria-label="Node view"
            value={nodeView}
            onValueChange={onNodeViewChange}
            options={[
              { value: 'list', label: 'List' },
              { value: 'graph', label: 'Graph' },
            ]}
          />
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-6 pb-6">{runColumnBody}</div>
    </div>
  );

  // A narrow pane shows one column at a time: the node column once a node is
  // open, with a Back control in its header, else the run column.
  if (mode === 'single') {
    return (
      <div ref={paneRef} className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)]">
        {roomOpen ? nodeColumn : runColumn}
      </div>
    );
  }

  return (
    <div
      ref={paneRef}
      className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(260px,0.85fr)_minmax(0,1.4fr)]"
    >
      {runColumn}
      {nodeColumn}
    </div>
  );
}
