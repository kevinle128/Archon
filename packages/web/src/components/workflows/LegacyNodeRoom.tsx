import {
  getWorkflowNodeMessages,
  type AskAnswerBody,
  type DagNode,
  type PendingInteraction,
  type WorkflowEventResponse,
  type WorkflowNodeStateResponse,
} from '@/lib/api';
import { type ExecutionHeaderModel, type FinishedIterationView } from '@/lib/execution-room-model';
import type { WorkflowRunStatus } from '@/lib/types';
import { cn } from '@/lib/utils';

import type { AskActionStateByRequest } from './ask-answer-controller';
import { nodeStatusLabel } from './awaiting-chrome';
import type { LogRow } from './build-log-rows';
import { ChildWorkflowRoom } from './ChildWorkflowRoom';
import { GateRoom } from './GateRoom';
import { LoopGroupRoom } from './LoopGroupRoom';
import { NodeRoomHeader, type ExecutionHeaderOption } from './NodeRoomHeader';
import { NodeTranscriptPane } from './NodeTranscriptPane';
import { RoomPlaceholder, RoomRegion } from './NodeRoom';
import type { AskDraft, AskDraftByRequest } from './parse-ask-envelope';
import { resolveRoomKind, type NodeBodyKind } from './resolve-room-kind';
import { RouteControllerRoom } from './RouteControllerRoom';
import { StdoutRoom } from './StdoutRoom';
import {
  selectChildRun,
  selectGateChrome,
  selectLoopGroupChrome,
  selectNodeStdout,
  selectRouteDecision,
} from './select-room-data';

export interface LegacyNodeRoomProps {
  runId: string;
  row: LogRow | null;
  loadMessages: typeof getWorkflowNodeMessages;
  definitionNodes: readonly DagNode[];
  definitionPending: boolean;
  events: readonly WorkflowEventResponse[];
  runStatus: WorkflowRunStatus;
  approval: unknown;
  onApprove: () => Promise<void>;
  onReject: (reason?: string) => Promise<void>;
  pendingInteractions: readonly PendingInteraction[];
  ownsUnscopedInteractions: boolean;
  viewerIsStarter: boolean;
  starterDisplayName: string | null;
  actionStates: AskActionStateByRequest;
  onSubmitAsk: (requestId: string, body: AskAnswerBody) => Promise<void>;
  nodeState: WorkflowNodeStateResponse | undefined;
  headerModel?: ExecutionHeaderModel;
  headerOptions?: readonly ExecutionHeaderOption[];
  onSelectRow?: (rowId: string) => void;
  /** Proven finished-iteration descriptor; pass-through only. */
  finishedIteration?: FinishedIterationView | null;
  /** Actual node-terminal evidence from raw executions. Default false. */
  nodeTerminal?: boolean;
  /** True when latest terminal execution failed for idle-await expiry. Default false. */
  idleAwaitExpired?: boolean;
  /** Logical execution key from ordered events. Default null. */
  nodeExecutionKey?: string | null;
  /** Node-wide written operator ids for terminal reconciliation. Default null. */
  writtenOperatorMessageIds?: ReadonlySet<string> | null;
  onClose?: () => void;
  closeLabel?: 'Close' | 'Back';
  scopeKey?: string;
  initialScrollTop?: number;
  onScrollTopChange?: (scrollTop: number) => void;
  askDrafts?: AskDraftByRequest;
  onAskDraftChange?: (requestId: string, draft: AskDraft) => void;
}

const TYPE_LABELS: Record<NodeBodyKind, string> = {
  command: 'Command',
  prompt: 'Prompt',
  loop: 'Loop',
  bash: 'Bash',
  script: 'Script',
  approval: 'Approval',
  plannotator_gate: 'Plannotator gate',
  workflow: 'Workflow',
  route_loop: 'Route loop',
  loop_group: 'Loop group',
  unknown: 'Agent',
};

const STATUS_COLORS: Record<LogRow['status'], string> = {
  pending: 'bg-accent/20 text-accent',
  running: 'bg-accent/20 text-accent',
  awaiting: 'bg-warning/20 text-warning',
  completed: 'bg-success/20 text-success',
  failed: 'bg-error/20 text-error',
  skipped: 'bg-surface text-text-secondary',
};

function assertNever(value: never): never {
  throw new Error('Unhandled legacy room kind: ' + String(value));
}

export function LegacyNodeRoom({
  runId,
  row,
  loadMessages,
  definitionNodes,
  definitionPending,
  events,
  runStatus,
  approval,
  onApprove,
  onReject,
  pendingInteractions,
  ownsUnscopedInteractions,
  viewerIsStarter,
  starterDisplayName,
  actionStates,
  onSubmitAsk,
  nodeState,
  headerModel,
  headerOptions,
  onSelectRow,
  finishedIteration = null,
  nodeTerminal = false,
  idleAwaitExpired = false,
  nodeExecutionKey = null,
  writtenOperatorMessageIds = null,
  onClose,
  closeLabel = 'Close',
  scopeKey,
  initialScrollTop,
  onScrollTopChange,
  askDrafts,
  onAskDraftChange,
}: LegacyNodeRoomProps): React.ReactElement {
  if (row === null) return <RoomPlaceholder>Select a node</RoomPlaceholder>;

  const resolution = resolveRoomKind(row.nodeId, definitionNodes, events, approval);
  const waitingForDefinition =
    definitionPending &&
    resolution.definitionNode === null &&
    resolution.kind === 'agent' &&
    resolution.nodeType === 'unknown';

  const header =
    headerModel !== undefined && onSelectRow !== undefined && onClose !== undefined ? (
      <NodeRoomHeader
        model={headerModel}
        options={headerOptions ?? []}
        selectedRowId={row.id}
        onSelectRow={onSelectRow}
        onClose={onClose}
        closeLabel={closeLabel}
      />
    ) : (
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">
          {row.label}
        </h2>
        <span className="rounded bg-surface-elevated px-2 py-0.5 text-xs text-text-secondary">
          {waitingForDefinition ? 'Loading' : TYPE_LABELS[resolution.nodeType]}
        </span>
        <span className={cn('rounded-full px-2 py-0.5 text-xs', STATUS_COLORS[row.status])}>
          {nodeStatusLabel(row.status)}
        </span>
        {onClose !== undefined ? (
          <button
            type="button"
            className="ml-auto shrink-0 text-xs text-primary hover:text-accent-bright"
            onClick={onClose}
          >
            {closeLabel}
          </button>
        ) : null}
      </div>
    );

  let body: React.ReactElement;

  if (waitingForDefinition) {
    body = (
      <RoomRegion nodeId={row.nodeId}>
        <RoomPlaceholder>Loading node room</RoomPlaceholder>
      </RoomRegion>
    );
  } else {
    switch (resolution.kind) {
      case 'agent':
        body = (
          <NodeTranscriptPane
            runId={runId}
            row={row}
            runStatus={runStatus}
            loadMessages={loadMessages}
            pendingInteractions={pendingInteractions}
            ownsUnscopedInteractions={ownsUnscopedInteractions}
            viewerIsStarter={viewerIsStarter}
            starterDisplayName={starterDisplayName}
            actionStates={actionStates}
            nodeState={nodeState}
            outputFormat={resolution.definitionNode?.output_format}
            onSubmitAsk={onSubmitAsk}
            events={events}
            scopeKey={scopeKey}
            initialScrollTop={initialScrollTop}
            onScrollTopChange={onScrollTopChange}
            askDrafts={askDrafts}
            onAskDraftChange={onAskDraftChange}
            finishedIteration={finishedIteration}
            nodeTerminal={nodeTerminal}
            idleAwaitExpired={idleAwaitExpired}
            nodeExecutionKey={nodeExecutionKey}
            writtenOperatorMessageIds={writtenOperatorMessageIds}
            onSelectLiveRow={onSelectRow}
          />
        );
        break;
      case 'stdout':
        body = <StdoutRoom nodeId={row.nodeId} stdout={selectNodeStdout(events, row)} />;
        break;
      case 'gate':
        body = (
          <GateRoom
            nodeId={row.nodeId}
            runId={runId}
            chrome={selectGateChrome({
              definitionNode: resolution.definitionNode,
              events,
              row,
              approval,
              runStatus,
              gateType:
                resolution.nodeType === 'plannotator_gate' ? 'plannotator_gate' : 'approval',
            })}
            onApprove={onApprove}
            onReject={onReject}
          />
        );
        break;
      case 'workflow':
        body = (
          <ChildWorkflowRoom
            nodeId={row.nodeId}
            child={selectChildRun({ events, approval, row, runStatus })}
          />
        );
        break;
      case 'route_loop':
        body = (
          <RouteControllerRoom nodeId={row.nodeId} decision={selectRouteDecision(events, row)} />
        );
        break;
      case 'loop_group':
        body = (
          <LoopGroupRoom
            nodeId={row.nodeId}
            chrome={selectLoopGroupChrome({
              definitionNode: resolution.definitionNode,
              events,
              row,
            })}
          />
        );
        break;
      default:
        body = assertNever(resolution.kind);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}
      {body}
    </div>
  );
}
