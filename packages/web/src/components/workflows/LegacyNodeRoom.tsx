import { useCallback, useRef, useState } from 'react';

import {
  getWorkflowNodeMessages,
  type AskAnswerBody,
  type DagNode,
  type PendingInteraction,
  type WorkflowEventResponse,
  type WorkflowNodeStateResponse,
} from '@/lib/api';
import {
  nodeKindChip,
  shouldRefetchRunOnDockFinished,
  type ExecutionHeaderModel,
  type FinishedIterationView,
  type RunOfTotal,
} from '@/lib/execution-room-model';
import type { SteeringExecutionState, SteeringNodeOutcome } from '@/lib/steering-dock';
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
  /** See `LegacyGraphLogsPaneProps.followingLive`. */
  followingLive?: boolean;
  headerModel?: ExecutionHeaderModel;
  headerOptions?: readonly ExecutionHeaderOption[];
  /** Uncapped execution total for the node, for the header's "of N · max 8" caption. */
  executionCount?: number;
  /** Retry position/count for the selected row, from the parent pane. */
  runOfTotal?: RunOfTotal | null;
  onSelectRow?: (rowId: string) => void;
  /** Proven finished-iteration descriptor; pass-through only. */
  finishedIteration?: FinishedIterationView | null;
  /** Actual node-terminal evidence from raw executions. Default false. */
  nodeTerminal?: boolean;
  /** True when latest terminal execution failed for idle-await expiry. Default false. */
  idleAwaitExpired?: boolean;
  /** Logical execution key from ordered events. Default null. */
  nodeExecutionKey?: string | null;
  onClose?: () => void;
  closeLabel?: 'Close' | 'Back';
  scopeKey?: string;
  initialScrollTop?: number;
  onScrollTopChange?: (scrollTop: number) => void;
  askDrafts?: AskDraftByRequest;
  onAskDraftChange?: (requestId: string, draft: AskDraft) => void;
  /**
   * Invalidate the cached run entity on the exact edge this room's own dock
   * learns (via its faster-cadenced queue read) that the node just settled,
   * before the run's own status poll/SSE has caught up — see
   * `shouldRefetchRunOnDockFinished`. Omitted in a context with no run-entity
   * cache to invalidate.
   */
  onRunSettleHint?: () => void;
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
  followingLive = false,
  headerModel,
  headerOptions,
  executionCount,
  runOfTotal = null,
  onSelectRow,
  finishedIteration = null,
  nodeTerminal = false,
  idleAwaitExpired = false,
  nodeExecutionKey = null,
  onClose,
  closeLabel = 'Close',
  scopeKey,
  initialScrollTop,
  onScrollTopChange,
  askDrafts,
  onAskDraftChange,
  onRunSettleHint,
}: LegacyNodeRoomProps): React.ReactElement {
  // Reported by the dock's own queue poll — the only place restart recovery
  // is currently observable. A fresh dock mount reports null immediately, so
  // switching rows/nodes clears a stale recovery pill without extra plumbing.
  const [dockExecutionState, setDockExecutionState] = useState<SteeringExecutionState | null>(null);
  // Tracks the dock's own PREVIOUS execution_state so the edge into
  // `finished` can be detected without depending on `dockExecutionState`
  // itself (a state setter's read of its own current value only reflects
  // last render, not necessarily the most recent report when several land
  // before this component re-renders).
  const previousDockExecutionStateRef = useRef<SteeringExecutionState | null>(null);
  const handleDockExecutionStateChange = useCallback(
    (next: SteeringExecutionState | null): void => {
      const previous = previousDockExecutionStateRef.current;
      previousDockExecutionStateRef.current = next;
      // The dock's own ~1s queue poll routinely learns a node settled before
      // the run entity cache does (SSE can miss a tab whose stream lost the
      // single-connection-per-conversation slot to a sibling tab on the same
      // run; the heartbeat fallback can take up to 30s). Durable terminal
      // state takes precedence the instant this dock itself learns it,
      // regardless of when the tab was opened.
      if (shouldRefetchRunOnDockFinished(previous, next, runStatus)) {
        onRunSettleHint?.();
      }
      setDockExecutionState(next);
    },
    [onRunSettleHint, runStatus]
  );
  // Reported by the dock's own queue read the instant the node is known
  // terminal — the header pill folds this onto its own row/run status so it
  // never shows `Running` beside the dock's own `node finished` disclosure.
  // Same fresh-mount-reports-null reasoning as `dockExecutionState` above.
  const [dockNodeOutcome, setDockNodeOutcome] = useState<SteeringNodeOutcome | null>(null);

  if (row === null) return <RoomPlaceholder>Select a node</RoomPlaceholder>;

  const resolution = resolveRoomKind(row.nodeId, definitionNodes, events, approval);
  const waitingForDefinition =
    definitionPending &&
    resolution.definitionNode === null &&
    resolution.kind === 'agent' &&
    resolution.nodeType === 'unknown';
  const resolvedOptions = headerOptions ?? [];
  const resolvedExecutionCount = executionCount ?? resolvedOptions.length;
  const kindChip = nodeKindChip(resolution.nodeType);
  // Viewing a proven-finished iteration while the node still runs live
  // elsewhere: the header leads with that iteration number and drops the
  // run count, matching the mockup's stale-history reading.
  const iterationPrefix =
    finishedIteration !== null && row.selection.kind === 'occurrence'
      ? (row.selection.iteration ?? null)
      : null;

  const header =
    headerModel !== undefined && onSelectRow !== undefined && onClose !== undefined ? (
      <NodeRoomHeader
        model={headerModel}
        options={resolvedOptions}
        selectedRowId={row.id}
        onSelectRow={onSelectRow}
        onClose={onClose}
        closeLabel={closeLabel}
        kindChip={kindChip}
        executionCount={resolvedExecutionCount}
        runOfTotal={runOfTotal}
        idleAwaitExpired={idleAwaitExpired}
        iterationPrefix={iterationPrefix}
        recoveryRequired={dockExecutionState === 'recovery_required'}
        terminalOutcome={dockNodeOutcome}
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
            followingLive={followingLive}
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
            onSelectLiveRow={onSelectRow}
            onExecutionStateChange={handleDockExecutionStateChange}
            onNodeOutcomeChange={setDockNodeOutcome}
            recoveryRequired={dockExecutionState === 'recovery_required'}
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
