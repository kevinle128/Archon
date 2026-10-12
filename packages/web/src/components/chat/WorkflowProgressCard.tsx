import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle, Loader2, Pause, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { approveWorkflowRun, getWorkflowRunByWorker, rejectWorkflowRun } from '@/lib/api';
import { useWorkflowStore } from '@/stores/workflow-store';
import { ConfirmRunActionDialog } from '@/components/runs/ConfirmRunActionDialog';
import { StatusIcon } from '@/components/workflows/StatusIcon';
import { formatDurationMs } from '@/lib/format';
import { isTerminalStatus } from '@/lib/workflow-utils';
import type { DagNodeState } from '@/lib/types';
import { buildRunPath } from '@/lib/runs/run-url';
import { getStatusPresentation, STATUS_TONE_TEXT_CLASS } from '@/lib/status-presentation';
import { ProgressStrip } from '@/components/ui/progress-strip';

const STATUS_CHIP: Record<string, { label: string; className: string }> = {
  pending: { label: 'Starting', className: 'text-text-secondary' },
  running: { label: 'Running', className: 'text-accent' },
  paused: { label: 'Needs you', className: 'text-warning' },
  completed: { label: 'Completed', className: 'text-success' },
  failed: { label: 'Failed', className: 'text-error' },
  cancelled: { label: 'Cancelled', className: 'text-text-secondary' },
};

/** Node rows shown before the rest collapse into a "+N more" line. */
const VISIBLE_NODE_ROWS = 5;

interface WorkflowProgressCardProps {
  workflowName: string;
  workerConversationId: string;
}

export function WorkflowProgressCard({
  workflowName,
  workerConversationId,
}: WorkflowProgressCardProps): React.ReactElement {
  const navigate = useNavigate();

  // REST polling for run data (stops when terminal)
  const {
    data: runData,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['workflowRunByWorker', workerConversationId],
    queryFn: () => getWorkflowRunByWorker(workerConversationId),
    refetchInterval: (query): number | false => {
      const status = query.state.data?.run?.status;
      if (status === 'completed' || status === 'failed' || status === 'cancelled') return false;
      return 3000;
    },
  });

  const runId = runData?.run?.id;
  const restStatus = runData?.run?.status;

  // Live SSE state from Zustand store
  const liveState = useWorkflowStore(state => (runId ? state.workflows.get(runId) : undefined));

  // Merge: prefer live state when available
  const status = liveState?.status ?? restStatus;
  const dagNodes: DagNodeState[] = liveState?.dagNodes ?? [];
  const currentTool = liveState?.currentTool ?? null;
  const approval = liveState?.approval ?? null;
  const error = liveState?.error;
  const startedAt = liveState?.startedAt;

  const completedCount = dagNodes.filter(n => n.status === 'completed').length;
  const totalNodes = dagNodes.length;
  const currentNode = dagNodes.find(n => n.status === 'running');
  const chip = STATUS_CHIP[status ?? 'pending'] ?? STATUS_CHIP.pending;
  const isRunning = status === 'running' || status === 'pending';
  const isPaused = status === 'paused';

  // Expand/collapse state
  const [expanded, setExpanded] = useState(false);
  const userToggled = useRef(false);

  // Auto-expand when running or paused, auto-collapse when terminal (unless user toggled)
  useEffect(() => {
    if (userToggled.current) return;
    if (isRunning || isPaused) {
      setExpanded(true);
    } else if (isTerminalStatus(status)) {
      setExpanded(false);
    }
  }, [isRunning, isPaused, status]);

  // Live elapsed timer
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!isRunning || !startedAt) return;
    setElapsed(Date.now() - startedAt);
    const interval = setInterval(() => {
      setElapsed(Date.now() - startedAt);
    }, 1000);
    return (): void => {
      clearInterval(interval);
    };
  }, [isRunning, startedAt]);

  // Approve/reject mutations
  const approveMutation = useMutation({
    mutationFn: () => approveWorkflowRun(runId ?? ''),
  });
  const rejectMutation = useMutation({
    mutationFn: (reason?: string) => rejectWorkflowRun(runId ?? '', reason),
  });
  const mutationError = approveMutation.error ?? rejectMutation.error;

  // Completed duration from live state
  const completedAt = liveState?.completedAt;
  const finalDuration = completedAt && startedAt ? completedAt - startedAt : null;

  const handleHeaderClick = (): void => {
    userToggled.current = true;
    setExpanded(prev => !prev);
  };

  const handleViewFullScreen = (): void => {
    if (runId) {
      navigate(buildRunPath(runId));
    } else {
      navigate(`/chat/${encodeURIComponent(workerConversationId)}`);
    }
  };

  // Loading state: no run data yet
  if (!runData && !isError) {
    return (
      <div className="flex max-w-[520px] items-center gap-2 border border-line-strong bg-card px-4 py-3 text-xs">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary motion-reduce:animate-none" />
        <span className="truncate text-text-primary font-medium">{workflowName}</span>
        <span className="text-text-tertiary">Starting...</span>
      </div>
    );
  }

  // Error state: couldn't fetch run
  if (isError && !runData) {
    return (
      <div className="flex max-w-[520px] items-center gap-2 border border-line-strong bg-card px-4 py-3 text-xs">
        <span className="text-error text-xs shrink-0">&#x26A0;</span>
        <span className="truncate text-text-primary font-medium">{workflowName}</span>
        <button
          onClick={(): void => {
            refetch();
          }}
          className="text-primary hover:text-accent-bright transition-colors shrink-0"
        >
          Retry
        </button>
      </div>
    );
  }

  const visibleNodes = dagNodes.slice(0, VISIBLE_NODE_ROWS);
  const hiddenCount = dagNodes.length - visibleNodes.length;

  const presentation = getStatusPresentation(status ?? 'pending');

  return (
    <article
      aria-label={`Run ${workflowName}`}
      className={cn(
        'max-w-[520px] border bg-card',
        isPaused ? 'border-status-waiting' : 'border-line-strong'
      )}
    >
      {/* Header: identity, status, and the expand control */}
      <div className="flex items-baseline justify-between gap-2 px-4 pt-3 pb-2">
        <button
          type="button"
          onClick={handleHeaderClick}
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse run details' : 'Expand run details'}
          className="min-w-0 cursor-pointer text-left"
        >
          <span className="block text-[11px] text-text-secondary">
            {runId !== undefined ? runId.slice(0, 8) : 'Starting'}
          </span>
          <span className="block text-sm font-bold break-words text-text-primary">
            {workflowName}
          </span>
        </button>
        <span
          className={cn('flex-none text-xs font-bold', STATUS_TONE_TEXT_CLASS[presentation.tone])}
        >
          {presentation.glyph} {chip.label}
        </span>
      </div>
      {totalNodes > 0 && (
        <ProgressStrip statuses={dagNodes.map(node => node.status)} className="mx-4" />
      )}
      <div className="flex items-baseline justify-between gap-2 px-4 pt-2 pb-3 text-xs text-text-secondary">
        <span>
          {totalNodes > 0
            ? `${String(completedCount)} of ${String(totalNodes)} nodes`
            : 'Waiting for nodes'}
          {currentNode ? <span className="text-accent"> · {currentNode.name}</span> : null}
          {isRunning && elapsed > 0 ? (
            <span className="font-mono"> · {formatDurationMs(elapsed)}</span>
          ) : finalDuration != null ? (
            <span className="font-mono"> · {formatDurationMs(finalDuration)}</span>
          ) : null}
        </span>
        <button
          type="button"
          onClick={handleViewFullScreen}
          className="flex-none cursor-pointer font-bold text-accent hover:underline"
        >
          Open in Runs →
        </button>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div className="mt-3">
          {/* Node list */}
          {visibleNodes.length > 0 && (
            <div className="mx-4 grid">
              {visibleNodes.map((node: DagNodeState) => (
                <div
                  key={node.nodeId}
                  className={cn(
                    'grid min-h-8 grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-3 border-t border-border text-sm',
                    node.status === 'running' && 'font-medium'
                  )}
                >
                  <span className="shrink-0">
                    <StatusIcon status={node.status} />
                  </span>
                  <span
                    className={cn(
                      'truncate',
                      node.status === 'running' ? 'text-accent' : 'text-text-primary'
                    )}
                  >
                    {node.name}
                  </span>
                  {node.duration !== undefined && (
                    <span className="font-mono text-xs text-text-secondary">
                      {formatDurationMs(node.duration)}
                    </span>
                  )}
                </div>
              ))}
              {hiddenCount > 0 && (
                <div className="border-t border-border py-2 text-xs text-text-secondary">
                  +{String(hiddenCount)} more nodes
                </div>
              )}
            </div>
          )}

          {/* Approval request banner */}
          {isPaused && (
            <div className="space-y-2 border-t border-border px-4 py-3">
              <div className="flex items-start gap-2">
                <Pause className="mt-0.5 h-4 w-4 shrink-0 text-warning" strokeWidth={1.5} />
                <p className="text-sm text-text-secondary">
                  {approval?.message ?? 'Waiting for approval'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    approveMutation.mutate();
                  }}
                  disabled={!runId || approveMutation.isPending || rejectMutation.isPending}
                  className="flex min-h-11 cursor-pointer items-center gap-1.5 px-3 text-sm text-success transition-colors duration-150 hover:bg-surface-elevated focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
                >
                  <CheckCircle className="h-4 w-4" strokeWidth={1.5} />
                  Approve
                </button>
                <ConfirmRunActionDialog
                  trigger={
                    <button
                      disabled={!runId || approveMutation.isPending || rejectMutation.isPending}
                      className="flex min-h-11 cursor-pointer items-center gap-1.5 px-3 text-sm text-error transition-colors duration-150 hover:bg-surface-elevated focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
                    >
                      <XCircle className="h-4 w-4" strokeWidth={1.5} />
                      Reject
                    </button>
                  }
                  title="Reject workflow?"
                  description={
                    <>
                      Reject the paused workflow <strong>{workflowName}</strong>. If the approval
                      node defines an <code>on_reject</code> prompt, it runs with your reason as{' '}
                      <code>$REJECTION_REASON</code>; otherwise the run is cancelled.
                    </>
                  }
                  confirmLabel="Reject"
                  reasonInput={{
                    label: 'Reason (optional)',
                    placeholder: 'Why are you rejecting? Visible to the on_reject prompt.',
                  }}
                  onConfirm={(reason): void => {
                    rejectMutation.mutate(reason);
                  }}
                />
              </div>
              {(approveMutation.isError || rejectMutation.isError) && (
                <p className="text-xs text-error">
                  {mutationError instanceof Error
                    ? mutationError.message
                    : 'Action failed — please try again'}
                </p>
              )}
            </div>
          )}

          {/* Current tool activity */}
          {currentTool?.status === 'running' && (
            <div className="flex items-center gap-2 border-t border-border px-4 py-2 text-xs">
              <Loader2
                className="h-3 w-3 shrink-0 animate-spin text-accent motion-reduce:animate-none"
                strokeWidth={1.5}
              />
              <span className="truncate font-mono text-text-secondary">{currentTool.name}</span>
            </div>
          )}

          {/* Error message */}
          {status === 'failed' && error && (
            <div
              className="truncate border-t border-border px-4 py-2 text-xs text-error"
              title={error}
            >
              {error.slice(0, 120)}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
