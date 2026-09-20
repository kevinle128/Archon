/**
 * Shared Graph/Logs/Chat composition: one left navigation and one typed room.
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import {
  PercentResizablePanel,
  ResizableHandle,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
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
import {
  chooseExecutionForNode,
  hasTerminalNodeEvidence,
  latestNodeExecutionKey,
  resolveFinishedIterationView,
  roomOpenerId,
  type ExecutionHeaderModel,
} from '@/lib/execution-room-model';
import { clampRoomRatio, roomPanelSizes } from '@/lib/room-split-layout';
import type { WorkflowRunStatus } from '@/lib/types';
import { useContainerSplitMode, type ContainerSplitMode } from '@/lib/use-container-split-mode';

import { AskCard, InvalidAskCard } from './AskCard';
import type { AskActionStateByRequest } from './ask-answer-controller';
import { resolveAskCardPresentation } from './ask-card-presentation';
import { buildChatTimeline, type ChatTimelineEntry } from './build-chat-timeline';

import { buildLogRows, type LogRow } from './build-log-rows';
import { ChatTimeline } from './ChatTimeline';
import { LegacyNodeRoom } from './LegacyNodeRoom';
import { isLiveRunStatus } from './NodeTranscriptPane';
import { NodeRunList } from './NodeRunList';
import type { ExecutionHeaderOption } from './NodeRoomHeader';
import { resolveGraphRoomRow } from './resolve-graph-room-row';
import { resolveRoomKind } from './resolve-room-kind';
import { resolveTimelineRoomRow } from './resolve-timeline-room-row';
import { parseAskEnvelope, type AskDraft, type AskDraftByRequest } from './parse-ask-envelope';
import { RunChatComposer } from './RunChatComposer';
import { useStackedViewport } from './source-control/use-stacked-viewport';

export interface LegacyGraphLogsPaneProps {
  activeView: 'graph' | 'logs' | 'chat';
  renderGraph: (input: {
    selectedNodeId: string | null;
    onNodeClick: (nodeId: string) => void;
  }) => ReactNode;
  selectedNodeId: string | null;
  selectedLogRowId: string | null;
  lastExplicitRowByNode?: Record<string, string>;
  onOpenRoom: (
    rowId: string,
    nodeId: string,
    openerId: string | null,
    rememberExplicit: boolean
  ) => void;
  onCloseRoom: () => void;
  roomRatio: number;
  onRoomRatioChange: (ratio: number) => void;
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
  onSelectExecution?: (rowId: string) => void;
  scopeKey?: string;
  initialScrollTop?: number;
  onScrollTopChange?: (scrollTop: number) => void;
  askDrafts?: AskDraftByRequest;
  onAskDraftChange?: (requestId: string, draft: AskDraft) => void;
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

export function LegacyGraphLogsPane({
  activeView,
  renderGraph,
  selectedNodeId,
  selectedLogRowId,
  lastExplicitRowByNode = {},
  onOpenRoom,
  onCloseRoom,
  roomRatio,
  onRoomRatioChange,
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
  onSelectExecution,
  scopeKey,
  initialScrollTop,
  onScrollTopChange,
  askDrafts,
  onAskDraftChange,
}: LegacyGraphLogsPaneProps): React.ReactElement {
  const stacked = useStackedViewport();
  const paneRef = useRef<HTMLDivElement>(null);
  const measuredMode = useContainerSplitMode(paneRef);
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
  const sendGeneration = useRef(0);
  const previousRunId = useRef(runId);
  const sizes = roomPanelSizes(roomRatio);
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
  const nodeExecutionKey =
    selectedNodeId === null ? null : latestNodeExecutionKey(events, selectedNodeId);

  const parentMessagesQuery = useQuery({
    queryKey: ['runChatMessages', parentPlatformId],
    enabled: activeView === 'chat' && parentPlatformId !== null,
    queryFn: async (): Promise<MessageResponse[]> => {
      if (parentPlatformId === null) throw new Error('Parent conversation is unavailable');
      return loadParentMessages(parentPlatformId);
    },
    retry: false,
    refetchInterval: runChatMessagesRefetchInterval(runStatus),
  });

  const parentConversationQuery = useQuery({
    queryKey: ['runChatConversation', parentPlatformId],
    enabled: activeView === 'chat' && parentPlatformId !== null,
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
  }, [runId]);

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

  const leftPane =
    activeView === 'graph' ? (
      <div className="h-full min-h-0">
        {renderGraph({ selectedNodeId, onNodeClick: handleGraphNodeClick })}
      </div>
    ) : activeView === 'logs' ? (
      <div className="h-full min-h-0 overflow-auto">
        <NodeRunList
          rows={rows}
          selectedRowId={selectedRow?.id ?? null}
          onSelect={handleLogRowSelect}
        />
      </div>
    ) : (
      <div className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1">
          <ChatTimeline
            entries={chatEntries}
            selectedEntryId={selectedTimelineEntryId}
            onSelectNodeStatus={handleNodeStatusSelect}
            loading={
              parentMessagesQuery.fetchStatus === 'fetching' &&
              parentMessagesQuery.data === undefined
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

  const wrappedLeft = <div className="flex h-full min-h-0 flex-col">{leftPane}</div>;

  const roomPane = (
    <div
      data-testid="legacy-node-room"
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
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
        headerModel={headerModel}
        headerOptions={headerOptions}
        onSelectRow={onSelectExecution}
        finishedIteration={finishedIteration}
        nodeTerminal={nodeTerminal}
        nodeExecutionKey={nodeExecutionKey}
        onClose={onCloseRoom}
        closeLabel={mode === 'single' ? 'Back' : 'Close'}
        scopeKey={scopeKey}
        initialScrollTop={initialScrollTop}
        onScrollTopChange={onScrollTopChange}
        askDrafts={askDrafts}
        onAskDraftChange={onAskDraftChange}
      />
      {roomFooter}
    </div>
  );

  const handleLayoutChanged = (layout: Record<string, number>): void => {
    if (mode !== 'split') return;
    const roomSize = layout['legacy-run-room'];
    if (typeof roomSize !== 'number') return;
    onRoomRatioChange(clampRoomRatio(roomSize));
  };

  return (
    <div ref={paneRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ResizablePanelGroup
        orientation={mode === 'split' && stacked ? 'vertical' : 'horizontal'}
        className="min-h-0 flex-1"
        defaultLayout={
          mode === 'single'
            ? roomOpen
              ? { 'legacy-run-view': 0, 'legacy-run-room': 100 }
              : { 'legacy-run-view': 100 }
            : roomOpen
              ? {
                  'legacy-run-view': 100 - clampRoomRatio(roomRatio),
                  'legacy-run-room': clampRoomRatio(roomRatio),
                }
              : { 'legacy-run-view': 100 }
        }
        onLayoutChanged={handleLayoutChanged}
      >
        <PercentResizablePanel
          id="legacy-run-view"
          className="flex min-h-0 flex-col"
          hidden={mode === 'single' && roomOpen}
          defaultSize={
            mode === 'single' && roomOpen ? '0%' : roomOpen ? sizes.view.defaultSize : '100%'
          }
          minSize={mode === 'single' && roomOpen ? '0%' : sizes.view.minSize}
        >
          {wrappedLeft}
        </PercentResizablePanel>
        {roomOpen ? (
          <>
            {mode === 'split' ? <ResizableHandle withHandle aria-label="Resize node room" /> : null}
            <PercentResizablePanel
              id="legacy-run-room"
              className="min-h-0 min-w-0 overflow-hidden"
              style={{ overflow: 'hidden' }}
              defaultSize={mode === 'single' ? '100%' : sizes.room.defaultSize}
              minSize={mode === 'single' ? '100%' : sizes.room.minSize}
              maxSize={mode === 'single' ? '100%' : sizes.room.maxSize}
            >
              {roomPane}
            </PercentResizablePanel>
          </>
        ) : null}
      </ResizablePanelGroup>
    </div>
  );
}
