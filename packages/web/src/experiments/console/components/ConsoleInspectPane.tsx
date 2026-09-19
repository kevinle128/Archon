/**
 * Persistent inspect split: Log, Graph, or Artifacts on the left, one mounted
 * node room on the right. View toggles must not remount the room.
 */
import { useMemo, useRef, type ReactElement, type ReactNode, type RefObject } from 'react';

import {
  buildExecutionHeader,
  type ExecutionHeaderModel,
  type ExecutionRow,
} from '@/lib/execution-room-model';
import { clampRoomRatio, roomPanelSizes } from '@/lib/room-split-layout';
import { useContainerSplitMode, type ContainerSplitMode } from '@/lib/use-container-split-mode';

import type { RunEvent } from '../primitives/event';
import type { Message } from '../primitives/message';
import type { Run } from '../primitives/run';
import {
  ConsolePanel,
  ConsolePanelGroup,
  ConsolePanelSeparator,
} from '../primitives/console-resizable';
import type {
  AskAnswerBody,
  PendingInteraction,
  WorkflowEvent,
  WorkflowNodeMessage,
  WorkflowNodeMessagesResponse,
  WorkflowNodeState,
} from '../skills/runs';
import type { UsageReport } from '../skills/usage';
import type { DagNode } from '../skills/workflows';
import { useEntity } from '../store/cache';
import { K } from '../store/keys';
import { StreamContextProvider } from '../lib/stream-context';
import type { AskActionStateByRequest } from './ask/ask-answer-controller';
import type { AskDraft, AskDraftByRequest } from './ask/parse-ask-envelope';
import { ArtifactPanel } from './ArtifactPanel';
import { ConsoleNodeRoom } from './ConsoleNodeRoom';
import { RunGraphPanel } from './RunGraphPanel';
import { RunStream } from './RunStream';
import type { ConsoleLogEntry } from './inspect/build-console-log-entries';
import {
  ConsoleExecutionHistory,
  shouldPollExecutionHistory,
} from './inspect/ConsoleExecutionHistory';
import type { LogRow } from './inspect/build-log-rows';
import type { ConsoleExecutionHeaderOption } from './inspect/ConsoleRoomHeader';
import { isInspectRunLive } from './inspect/inspect-status';
import { resolveRoomKind } from './inspect/resolve-room-kind';

export type ConsoleInspectView = 'log' | 'graph' | 'artifacts';

export interface ConsoleInspectPaneProps {
  view: ConsoleInspectView;
  run: Run;
  projectId: string;
  projectCwd: string;
  messages: Message[];
  events: RunEvent[];
  rawEvents: WorkflowEvent[];
  nodeStates: WorkflowNodeState[];
  approval: unknown;
  logEntries: ConsoleLogEntry[];
  usage: UsageReport | null;
  streamNodeFilter: string;
  selectedNodeId: string | null;
  selectedLogRowId: string | null;
  showToolCalls: boolean;
  showSystem: boolean;
  logHeader: ReactNode;
  logFooter: ReactNode;
  logScrollRef: RefObject<HTMLDivElement | null>;
  onSelectNode: (nodeId: string, rowId?: string) => void;
  onCloseRoom: () => void;
  roomRatio?: number;
  onRoomRatioChange?: (ratio: number) => void;
  splitMode?: ContainerSplitMode;
  loadDefinition: (workflowName: string, cwd: string) => Promise<DagNode[]>;
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
  viewerIsStarter: boolean;
  starterDisplayName: string | null;
  actionStates: AskActionStateByRequest;
  onSubmitAsk: (requestId: string, body: AskAnswerBody) => Promise<void>;
  scopeKey?: string;
  initialScrollTop?: number;
  onScrollTopChange?: (scrollTop: number) => void;
  askDrafts?: AskDraftByRequest;
  onAskDraftChange?: (requestId: string, draft: AskDraft) => void;
}

function toExecutionRow(row: LogRow): ExecutionRow {
  const next: ExecutionRow = {
    id: row.id,
    nodeId: row.nodeId,
    label: row.label,
    status: row.status,
    order: row.order,
    selection: row.selection,
  };
  if (row.startedAt !== undefined) next.startedAt = row.startedAt;
  if (row.durationMs !== undefined) next.durationMs = row.durationMs;
  if (row.startedOffsetMs !== undefined) next.startedOffsetMs = row.startedOffsetMs;
  if (row.unknownScope !== undefined) next.unknownScope = row.unknownScope;
  return next;
}

function resolveSelectedRow(
  entries: readonly ConsoleLogEntry[],
  selectedNodeId: string | null,
  selectedLogRowId: string | null
): LogRow | null {
  if (selectedNodeId === null) return null;
  if (selectedLogRowId !== null) {
    for (const entry of entries) {
      if (entry.row.id === selectedLogRowId && entry.row.nodeId === selectedNodeId) {
        return entry.row;
      }
    }
  }
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.row.nodeId === selectedNodeId) {
      return entry.row;
    }
  }
  return null;
}

function executionOptionsForNode(
  entries: readonly ConsoleLogEntry[],
  nodeId: string,
  events: readonly WorkflowEvent[],
  runStartedAt: string
): ConsoleExecutionHeaderOption[] {
  const options: ConsoleExecutionHeaderOption[] = [];
  for (const entry of entries) {
    if (entry.row.nodeId !== nodeId) continue;
    options.push({
      rowId: entry.row.id,
      label: buildExecutionHeader({
        row: toExecutionRow(entry.row),
        events,
        runStartedAt,
      }).executionLabel,
    });
  }
  return options;
}

export function ConsoleInspectPane({
  view,
  run,
  projectId,
  projectCwd,
  messages,
  events,
  rawEvents,
  nodeStates,
  approval,
  logEntries,
  usage,
  streamNodeFilter,
  selectedNodeId,
  selectedLogRowId,
  showToolCalls,
  showSystem,
  logHeader,
  logFooter,
  logScrollRef,
  onSelectNode,
  onCloseRoom,
  roomRatio = 40,
  onRoomRatioChange,
  splitMode,
  loadDefinition,
  loadMessages,
  loadMessage,
  pendingInteractions,
  viewerIsStarter,
  starterDisplayName,
  actionStates,
  onSubmitAsk,
  scopeKey,
  initialScrollTop,
  onScrollTopChange,
  askDrafts = {},
  onAskDraftChange,
}: ConsoleInspectPaneProps): ReactElement {
  const paneRef = useRef<HTMLDivElement>(null);
  const measuredMode = useContainerSplitMode(paneRef);
  const mode = splitMode ?? measuredMode;
  const definitionQuery = useEntity<DagNode[]>(K.workflowDagNodes(projectCwd, run.workflow), () =>
    loadDefinition(run.workflow, projectCwd)
  );
  const definitionError =
    definitionQuery.error === undefined ? null : definitionQuery.error.message;
  const definitionPending =
    definitionQuery.data === undefined && definitionQuery.error === undefined;
  const definitionNodes = definitionQuery.data ?? [];
  const selectedRow = useMemo(
    () => resolveSelectedRow(logEntries, selectedNodeId, selectedLogRowId),
    [logEntries, selectedNodeId, selectedLogRowId]
  );
  const ownsUnscopedInteractions =
    selectedRow !== null &&
    !logEntries.some(
      entry => entry.row.nodeId === selectedRow.nodeId && entry.row.order > selectedRow.order
    );
  const roomOpen = selectedNodeId !== null;
  const ratio = clampRoomRatio(roomRatio);
  const sizes = roomPanelSizes(ratio);
  const headerModel: ExecutionHeaderModel | null =
    selectedRow === null
      ? null
      : buildExecutionHeader({
          row: toExecutionRow(selectedRow),
          events: rawEvents,
          runStartedAt: run.startedAt,
        });
  const headerOptions =
    selectedNodeId === null
      ? []
      : executionOptionsForNode(logEntries, selectedNodeId, rawEvents, run.startedAt);

  const mainPane: ReactElement =
    view === 'log' ? (
      <div
        ref={logScrollRef}
        data-testid="console-run-log-scroll"
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {logHeader}
        <StreamContextProvider value={{ runStartedAt: run.startedAt }}>
          <RunStream
            messages={messages}
            events={events}
            showToolCalls={showToolCalls}
            showSystem={showSystem}
            selectedNodeId={streamNodeFilter}
            usage={usage}
            logEntries={logEntries}
            selectedLogRowId={selectedLogRowId}
            onSelectLogRow={(rowId: string, nodeId: string): void => {
              onSelectNode(nodeId, rowId);
            }}
            renderExecutionBody={(entry): ReactElement => (
              <ConsoleExecutionHistory
                entry={entry}
                allEntries={logEntries}
                run={run}
                events={rawEvents}
                isLive={shouldPollExecutionHistory(isInspectRunLive(run.status), entry.row.status)}
                suspended={entry.row.id === selectedLogRowId}
                loadMessages={loadMessages}
                loadMessage={loadMessage}
                pendingInteractions={pendingInteractions}
                nodeStates={nodeStates}
                outputFormat={
                  resolveRoomKind(entry.row.nodeId, definitionNodes, rawEvents, approval)
                    .definitionNode?.output_format
                }
                approval={approval}
                showToolCalls={showToolCalls}
                showSystem={showSystem}
                viewerIsStarter={viewerIsStarter}
                starterDisplayName={starterDisplayName}
                actionStates={actionStates}
                onSubmitAsk={onSubmitAsk}
                askDrafts={askDrafts}
                onAskDraftChange={onAskDraftChange}
              />
            )}
          />
        </StreamContextProvider>
        {logFooter}
      </div>
    ) : view === 'graph' ? (
      <div className="min-h-0 flex-1">
        <RunGraphPanel
          nodes={definitionNodes}
          nodeStates={nodeStates}
          selectedNodeId={selectedNodeId}
          definitionPending={definitionPending}
          definitionError={definitionError}
          onSelectNode={(nodeId: string): void => {
            onSelectNode(nodeId);
          }}
        />
      </div>
    ) : (
      <ArtifactPanel runId={run.id} />
    );

  const roomPane =
    selectedNodeId === null ? null : (
      <div
        data-testid="console-inspect-room"
        className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
      >
        <ConsoleNodeRoom
          run={run}
          projectId={projectId}
          nodeId={selectedNodeId}
          selectedRow={selectedRow}
          definitionNodes={definitionNodes}
          definitionPending={definitionPending}
          nodeStates={nodeStates}
          events={rawEvents}
          approval={approval}
          isLive={isInspectRunLive(run.status)}
          loadMessages={loadMessages}
          loadMessage={loadMessage}
          onClose={onCloseRoom}
          pendingInteractions={pendingInteractions}
          ownsUnscopedInteractions={ownsUnscopedInteractions}
          viewerIsStarter={viewerIsStarter}
          starterDisplayName={starterDisplayName}
          actionStates={actionStates}
          onSubmitAsk={onSubmitAsk}
          headerModel={headerModel}
          headerOptions={headerOptions}
          onSelectRow={(rowId: string): void => {
            onSelectNode(selectedNodeId, rowId);
          }}
          showToolCalls={showToolCalls}
          showSystem={showSystem}
          closeLabel={mode === 'single' ? 'Back' : 'Close'}
          scopeKey={scopeKey}
          initialScrollTop={initialScrollTop}
          onScrollTopChange={onScrollTopChange}
          askDrafts={askDrafts}
          onAskDraftChange={onAskDraftChange}
        />
      </div>
    );

  const handleLayoutChanged = (layout: Record<string, number>): void => {
    if (mode !== 'split') return;
    const roomSize = layout['console-run-room'];
    if (typeof roomSize !== 'number') return;
    onRoomRatioChange?.(clampRoomRatio(roomSize));
  };

  return (
    <div
      ref={paneRef}
      data-testid="console-inspect-pane"
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <ConsolePanelGroup
        orientation="horizontal"
        className="min-h-0 flex-1"
        defaultLayout={
          mode === 'single'
            ? roomOpen
              ? { 'console-run-view': 0, 'console-run-room': 100 }
              : { 'console-run-view': 100 }
            : roomOpen
              ? {
                  'console-run-view': 100 - ratio,
                  'console-run-room': ratio,
                }
              : { 'console-run-view': 100 }
        }
        onLayoutChanged={handleLayoutChanged}
      >
        <ConsolePanel
          id="console-run-view"
          className="flex min-h-0 flex-col"
          hidden={mode === 'single' && roomOpen}
          defaultSize={
            mode === 'single' && roomOpen ? '0%' : roomOpen ? sizes.view.defaultSize : '100%'
          }
          minSize={mode === 'single' && roomOpen ? '0%' : sizes.view.minSize}
        >
          {mainPane}
        </ConsolePanel>
        {roomOpen ? (
          <>
            {mode === 'split' ? <ConsolePanelSeparator aria-label="Resize node room" /> : null}
            <ConsolePanel
              id="console-run-room"
              defaultSize={mode === 'single' ? '100%' : sizes.room.defaultSize}
              minSize={mode === 'single' ? '100%' : sizes.room.minSize}
              maxSize={mode === 'single' ? '100%' : sizes.room.maxSize}
            >
              {roomPane}
            </ConsolePanel>
          </>
        ) : null}
      </ConsolePanelGroup>
    </div>
  );
}
