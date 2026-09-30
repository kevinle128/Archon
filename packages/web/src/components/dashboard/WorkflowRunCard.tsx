import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import {
  AlertTriangle,
  Ban,
  CheckCircle,
  ExternalLink,
  FileText,
  MessageSquare,
  PlayCircle,
  Trash2,
  XCircle,
} from 'lucide-react';
import type { DashboardRunResponse } from '@/lib/api';
import { getPlannotatorReviewUrl } from '@/lib/approval-context';
import { cn } from '@/lib/utils';
import { ideUri } from '@/lib/ide-uri';
import { formatDuration, formatStarted } from '@/lib/format';
import { useWorkflowStore } from '@/stores/workflow-store';
import { ConfirmRunActionDialog } from './ConfirmRunActionDialog';

interface WorkflowRunCardProps {
  run: DashboardRunResponse;
  isDocker?: boolean;
  isWsl?: boolean;
  wslDistro?: string;
  onCancel: (runId: string) => void;
  onResume?: (runId: string) => void;
  onAbandon?: (runId: string) => void;
  onDelete?: (runId: string) => void;
  onApprove?: (runId: string) => void;
  onReject?: (runId: string, reason?: string) => void;
}

interface NodeCounts {
  completed: number;
  failed: number;
  skipped: number;
  total: number;
}

function isValidNodeCounts(value: unknown): value is NodeCounts {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.completed === 'number' &&
    typeof obj.failed === 'number' &&
    typeof obj.skipped === 'number' &&
    typeof obj.total === 'number'
  );
}

const STATUS_LABEL: Record<DashboardRunResponse['status'], string> = {
  pending: 'Pending',
  running: 'Running',
  paused: 'Awaiting input',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const STATUS_TONE: Record<DashboardRunResponse['status'], string> = {
  pending: 'text-text-secondary',
  running: 'text-accent',
  paused: 'text-accent border-accent',
  completed: 'text-success',
  failed: 'text-error',
  cancelled: 'text-text-secondary',
};

const ROW_BUTTON =
  'inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-[10px] border px-4 text-sm font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none';
const ROW_BUTTON_NEUTRAL = `${ROW_BUTTON} border-border bg-background text-text-primary hover:bg-surface`;
// Awaiting rows carry the accent treatment; the fill stays soft because the
// dashboard has no solid primary action.
const ROW_BUTTON_ACCENT = `${ROW_BUTTON} border-accent bg-accent-muted text-text-primary hover:bg-accent-muted/70`;
const ICON_BUTTON =
  'inline-flex size-8 cursor-pointer items-center justify-center rounded-[10px] text-text-tertiary outline-none transition-colors duration-150 hover:bg-surface hover:text-text-primary focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none';
const TEXT_BUTTON =
  'inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-[10px] px-2 text-xs font-medium outline-none transition-colors duration-150 hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none';

export function WorkflowRunCard({
  run,
  isDocker,
  isWsl,
  wslDistro,
  onCancel,
  onResume,
  onAbandon,
  onDelete,
  onApprove,
  onReject,
}: WorkflowRunCardProps): React.ReactElement {
  const navigate = useNavigate();
  const [elapsed, setElapsed] = useState(() => formatDuration(run.started_at, run.completed_at));

  // Live SSE state from Zustand store overrides REST-polled data when present
  const liveState = useWorkflowStore(state => state.workflows.get(run.id));

  useEffect(() => {
    if (run.status !== 'running' && run.status !== 'paused') return;
    const interval = setInterval(() => {
      setElapsed(formatDuration(run.started_at, null));
    }, 1000);
    return (): void => {
      clearInterval(interval);
    };
  }, [run.status, run.started_at]);

  const chatId = run.parent_platform_id ?? run.worker_platform_id;
  const isAwaiting = run.status === 'paused';
  const isActive = run.status === 'running' || run.status === 'pending' || isAwaiting;
  const plannotatorReviewUrl = getPlannotatorReviewUrl({
    status: run.status,
    approval: run.metadata.approval,
  });

  // Progress: live DAG state while active, persisted counts once terminal.
  const dagNodes = liveState?.dagNodes ?? [];
  const persistedCounts = isValidNodeCounts(run.metadata?.node_counts)
    ? run.metadata.node_counts
    : null;
  const totalNodes = dagNodes.length || persistedCounts?.total || run.total_steps || 0;
  const doneNodes = dagNodes.length
    ? dagNodes.filter(n => n.status === 'completed').length
    : (persistedCounts?.completed ?? 0);
  const percent = totalNodes > 0 ? Math.min(100, Math.round((doneNodes / totalNodes) * 100)) : 0;
  const runningNode = dagNodes
    .slice()
    .reverse()
    .find(n => n.status === 'running');
  const stepName = runningNode?.name ?? run.current_step_name;
  const approvalMessage =
    isAwaiting && run.metadata?.approval != null
      ? ((run.metadata.approval as { message?: string }).message ?? null)
      : null;
  const errorText =
    run.status === 'failed' && typeof run.metadata?.error === 'string' ? run.metadata.error : null;

  const openRun = (): void => {
    navigate(`/workflows/runs/${run.id}`);
  };

  return (
    <div
      className={cn(
        'grid grid-cols-[148px_minmax(0,1fr)_128px_120px_300px] items-center gap-x-6 gap-y-2 border-b border-l-[3px] border-border py-4 pl-4 max-[1180px]:grid-cols-[124px_minmax(0,1fr)_96px_280px] max-[1180px]:gap-x-4 max-[1180px]:[&_.run-when]:hidden',
        isAwaiting ? 'border-l-accent' : 'border-l-transparent'
      )}
    >
      <span>
        <span
          className={cn(
            'inline-flex h-6 items-center gap-2 whitespace-nowrap rounded-full border border-border px-2.5 text-xs font-medium before:size-1.5 before:shrink-0 before:rounded-full before:bg-current',
            STATUS_TONE[run.status],
            run.status === 'pending' && 'before:border before:border-current before:bg-transparent'
          )}
        >
          {STATUS_LABEL[run.status]}
        </span>
      </span>

      <span className="grid min-w-0 gap-1">
        <button
          type="button"
          onClick={openRun}
          className="cursor-pointer truncate rounded text-left font-mono text-sm font-medium text-text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          {run.workflow_name}
        </button>
        <span className="truncate text-xs text-text-tertiary">
          {run.codebase_name ?? 'Unknown project'} ·{' '}
          <span className="font-mono">{run.id.slice(0, 8)}</span>
          {run.user_message && (
            <>
              {' '}
              · <span title={run.user_message}>{run.user_message}</span>
            </>
          )}
          {isActive && stepName && (
            <>
              {' '}
              · at <span className="text-text-secondary">{stepName}</span>
            </>
          )}
        </span>
      </span>

      <span className="grid gap-2 font-mono text-xs text-text-secondary">
        <span>
          {totalNodes > 0 ? `${String(doneNodes)}/${String(totalNodes)} nodes` : '\u2014'}
        </span>
        <span
          role="progressbar"
          aria-label="Node progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="block h-1 overflow-hidden rounded-full bg-border"
        >
          <span
            className={cn('block h-full rounded-full', isActive ? 'bg-accent' : 'bg-text-tertiary')}
            style={{ width: `${String(percent)}%` }}
          />
        </span>
      </span>

      <span className="run-when whitespace-nowrap font-mono text-xs leading-relaxed text-text-secondary">
        {formatStarted(run.started_at)}
        <span className="block text-text-tertiary">{elapsed}</span>
      </span>

      <span className="flex flex-wrap items-center justify-end gap-1">
        {plannotatorReviewUrl && (
          <a
            href={plannotatorReviewUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Open Plannotator"
            className={ICON_BUTTON}
          >
            <ExternalLink className="size-4" strokeWidth={1.75} />
            <span className="sr-only">Open Plannotator</span>
          </a>
        )}
        {run.working_path && !isDocker && (
          <a
            href={ideUri(run.working_path, { is_wsl: isWsl, wsl_distro: wslDistro })}
            target="_blank"
            rel="noopener noreferrer"
            title="Open in IDE"
            className={ICON_BUTTON}
          >
            <ExternalLink className="size-4" strokeWidth={1.75} />
            <span className="sr-only">Open in IDE</span>
          </a>
        )}
        {chatId && (
          <button
            type="button"
            title="Open chat"
            onClick={(): void => {
              navigate(`/chat/${encodeURIComponent(chatId)}`);
            }}
            className={ICON_BUTTON}
          >
            <MessageSquare className="size-4" strokeWidth={1.75} />
            <span className="sr-only">Open Chat</span>
          </button>
        )}
        <button type="button" title="View logs" onClick={openRun} className={ICON_BUTTON}>
          <FileText className="size-4" strokeWidth={1.75} />
          <span className="sr-only">View Logs</span>
        </button>
        {isAwaiting && onApprove && (
          <button
            type="button"
            onClick={(): void => {
              onApprove(run.id);
            }}
            className={cn(TEXT_BUTTON, 'text-success')}
          >
            <CheckCircle className="size-4" strokeWidth={1.75} />
            Approve
          </button>
        )}
        {isAwaiting && onReject && (
          <ConfirmRunActionDialog
            trigger={
              <button type="button" className={cn(TEXT_BUTTON, 'text-error')}>
                <XCircle className="size-4" strokeWidth={1.75} />
                Reject
              </button>
            }
            title="Reject workflow?"
            description={
              <>
                Reject the paused workflow <strong>{run.workflow_name}</strong>. If the approval
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
              onReject(run.id, reason);
            }}
          />
        )}
        {run.status === 'running' && onAbandon && (
          <ConfirmRunActionDialog
            trigger={
              <button
                type="button"
                title="Abandon"
                className={cn(ICON_BUTTON, 'hover:text-warning')}
              >
                <Ban className="size-4" strokeWidth={1.75} />
                <span className="sr-only">Abandon</span>
              </button>
            }
            title="Abandon workflow?"
            description={
              <>
                Mark <strong>{run.workflow_name}</strong> as cancelled. Already-completed nodes
                remain in the database; the run will not continue.
              </>
            }
            confirmLabel="Abandon"
            onConfirm={(): void => {
              onAbandon(run.id);
            }}
          />
        )}
        {(run.status === 'running' || run.status === 'pending') && (
          <ConfirmRunActionDialog
            trigger={
              <button type="button" title="Cancel" className={cn(ICON_BUTTON, 'hover:text-error')}>
                <XCircle className="size-4" strokeWidth={1.75} />
                <span className="sr-only">Cancel</span>
              </button>
            }
            title="Cancel workflow?"
            description={
              <>
                Cancel <strong>{run.workflow_name}</strong>. The run will be marked as cancelled and
                any in-flight subprocess will be terminated.
              </>
            }
            confirmLabel="Cancel workflow"
            onConfirm={(): void => {
              onCancel(run.id);
            }}
          />
        )}
        {onDelete && !isActive && (
          <ConfirmRunActionDialog
            trigger={
              <button type="button" title="Delete" className={cn(ICON_BUTTON, 'hover:text-error')}>
                <Trash2 className="size-4" strokeWidth={1.75} />
                <span className="sr-only">Delete</span>
              </button>
            }
            title="Delete workflow run?"
            description={
              <>
                Permanently delete the run record for <strong>{run.workflow_name}</strong> and its
                events. This cannot be undone.
              </>
            }
            confirmLabel="Delete"
            onConfirm={(): void => {
              onDelete(run.id);
            }}
          />
        )}
        {isAwaiting ? (
          <button type="button" onClick={openRun} className={ROW_BUTTON_ACCENT}>
            Answer
          </button>
        ) : run.status === 'failed' && onResume ? (
          <button
            type="button"
            onClick={(): void => {
              onResume(run.id);
            }}
            className={ROW_BUTTON_NEUTRAL}
          >
            <PlayCircle className="size-4" strokeWidth={1.75} />
            Resume
          </button>
        ) : (
          <button type="button" onClick={openRun} className={ROW_BUTTON_NEUTRAL}>
            {isActive ? 'Open' : 'View'}
          </button>
        )}
      </span>

      {approvalMessage && (
        <span className="col-start-2 -col-end-1 text-xs text-text-secondary">
          {approvalMessage}
        </span>
      )}
      {errorText && (
        <span className="col-start-2 -col-end-1 flex items-start gap-2 font-mono text-xs text-error [overflow-wrap:anywhere]">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
          <span>{errorText}</span>
        </span>
      )}
    </div>
  );
}
