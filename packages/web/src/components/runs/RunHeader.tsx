import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';

import { Button } from '@/components/ui/button';
import { LiveElapsed } from '@/components/ui/live-elapsed';
import { getHealth } from '@/lib/api';
import { ideUri } from '@/lib/ide-uri';
import { buildRunPath } from '@/lib/runs/run-url';
import { getStatusPresentation, STATUS_TONE_TEXT_CLASS } from '@/lib/status-presentation';
import type { WorkflowRunStatus } from '@/lib/types';
import { cn } from '@/lib/utils';

import { ConfirmRunActionDialog } from './ConfirmRunActionDialog';

export interface RunActionHandlers {
  onCancel: () => void;
  onRetryFromFailed: () => void;
  onResume: () => void;
  onAbandon: () => void;
  onDelete: () => void;
  onOpenArtifacts: () => void;
  onRunAgain: () => void;
}

export interface RunActionsProps extends RunActionHandlers {
  status: WorkflowRunStatus;
  workflowName: string;
  workingPath: string | null;
  /** Chat that started the run, if any. */
  chatId: string | null;
  plannotatorUrl: string | null;
  /** True while the server reports a Docker install, where IDE links do not open. */
  isDocker: boolean;
  isWsl: boolean;
  wslDistro?: string;
}

const ACTIVE: readonly WorkflowRunStatus[] = ['pending', 'running', 'paused'];

/** Run actions by status, then a "More" menu with the rarer ones. */
export function RunActions(props: RunActionsProps): React.ReactElement {
  const active = ACTIVE.includes(props.status);
  const worktreeHref =
    props.workingPath !== null && !props.isDocker
      ? ideUri(props.workingPath, { is_wsl: props.isWsl, wsl_distro: props.wslDistro })
      : null;
  const openWorktree =
    worktreeHref !== null ? (
      <Button asChild variant="secondary" size="sm">
        <a href={worktreeHref}>Open worktree</a>
      </Button>
    ) : null;

  return (
    <div className="mt-3 flex flex-wrap items-start gap-2">
      {active ? (
        <>
          <ConfirmRunActionDialog
            trigger={
              <Button variant="secondary" size="sm">
                Cancel run
              </Button>
            }
            title="Cancel this run?"
            description={
              <>
                <strong>{props.workflowName}</strong> stops after the current step.
              </>
            }
            confirmLabel="Cancel run"
            onConfirm={props.onCancel}
          />
          {openWorktree}
        </>
      ) : props.status === 'failed' ? (
        <>
          <Button variant="secondary" size="sm" onClick={props.onRetryFromFailed}>
            Retry from failed node
          </Button>
          {openWorktree}
        </>
      ) : props.status === 'completed' ? (
        <>
          <Button variant="secondary" size="sm" onClick={props.onOpenArtifacts}>
            Open artifacts
          </Button>
          <Button variant="secondary" size="sm" onClick={props.onRunAgain}>
            Run again
          </Button>
        </>
      ) : (
        openWorktree
      )}
      <details className="relative">
        <summary className="inline-flex h-7 cursor-pointer list-none items-center border border-line-strong bg-card px-3 text-sm font-semibold text-foreground hover:bg-selection [&::-webkit-details-marker]:hidden">
          More
        </summary>
        <div className="absolute left-0 z-20 mt-1 grid min-w-44 border border-line-strong bg-card py-1">
          {props.status === 'paused' ? (
            <MenuButton onClick={props.onResume}>Resume</MenuButton>
          ) : null}
          {props.chatId !== null ? (
            <MenuLink to={`/chat/${encodeURIComponent(props.chatId)}`}>Open chat</MenuLink>
          ) : null}
          {props.plannotatorUrl !== null ? (
            <a
              href={props.plannotatorUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 text-left text-[13px] text-text-primary no-underline hover:bg-selection"
            >
              Open Plannotator
            </a>
          ) : null}
          {active ? (
            <ConfirmRunActionDialog
              trigger={<MenuButton danger>Abandon</MenuButton>}
              title="Abandon this run?"
              description="The run is marked cancelled and its child runs stop."
              confirmLabel="Abandon"
              onConfirm={props.onAbandon}
            />
          ) : (
            <ConfirmRunActionDialog
              trigger={<MenuButton danger>Delete</MenuButton>}
              title="Delete this run?"
              description="The run and its events are removed. This cannot be undone."
              confirmLabel="Delete"
              onConfirm={props.onDelete}
            />
          )}
        </div>
      </details>
    </div>
  );
}

function MenuButton({
  children,
  danger = false,
  ...props
}: React.ComponentProps<'button'> & { danger?: boolean }): React.ReactElement {
  return (
    <button
      type="button"
      className={cn(
        'px-3 py-1.5 text-left text-[13px] hover:bg-selection',
        danger ? 'text-error' : 'text-text-primary'
      )}
      {...props}
    >
      {children}
    </button>
  );
}

function MenuLink({ to, children }: { to: string; children: React.ReactNode }): React.ReactElement {
  return (
    <Link
      to={to}
      className="px-3 py-1.5 text-left text-[13px] text-text-primary no-underline hover:bg-selection"
    >
      {children}
    </Link>
  );
}

/** Server environment facts the IDE link needs. Docker hides the link until known. */
export function useIdeEnvironment(): { isDocker: boolean; isWsl: boolean; wslDistro?: string } {
  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: getHealth,
    staleTime: 10_000,
  });
  return {
    isDocker: health?.is_docker ?? true,
    isWsl: health?.is_wsl ?? false,
    wslDistro: health?.wsl_distro,
  };
}

interface RunHeaderProps {
  runId: string;
  projectName: string | null;
  workflowName: string;
  status: WorkflowRunStatus;
  startedAt: number;
  /** Set once the run is terminal; the timer stops there. */
  completedAt?: number;
  input: string;
  parentRunId: string | null;
  /** Shown on narrow screens, where the runs list is hidden. */
  showBackToList: boolean;
  /** Cost and env rows, from the run usage components. */
  costRow: React.ReactNode;
  envRow: React.ReactNode;
  /** Awaiting-input chrome that jumps to the waiting node. */
  askChrome: React.ReactNode;
  actions: React.ReactNode;
  actionError: string | null;
  loadError: string | null;
}

/** Header of the run column: context line, name, status, facts, actions. */
export function RunHeader(props: RunHeaderProps): React.ReactElement {
  const presentation = getStatusPresentation(props.status);
  const waiting = presentation.tone === 'waiting';
  return (
    <header className="flex-none border-b border-border px-6 py-4">
      {props.showBackToList ? (
        <Link to="/runs" className="mb-2 inline-block text-xs font-semibold text-accent">
          ← Runs
        </Link>
      ) : null}
      <div className="flex min-w-0 items-center gap-2 text-xs text-text-secondary">
        <span className="truncate">{props.projectName ?? 'No project'}</span>
        <span aria-hidden="true">·</span>
        <span className="flex-none">{props.runId.slice(0, 8)}</span>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-3">
        <h2 className="min-w-0 text-2xl leading-[1.15] font-extrabold break-words">
          {props.workflowName}
        </h2>
        <span
          data-status={props.status}
          className={cn(
            'border px-2 py-0.5 text-xs font-bold',
            waiting
              ? 'border-status-waiting bg-status-waiting text-status-waiting-fg'
              : cn('border-current bg-transparent', STATUS_TONE_TEXT_CLASS[presentation.tone])
          )}
        >
          {presentation.label}
        </span>
        {props.askChrome}
      </div>
      <dl className="mt-3 grid grid-cols-[64px_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-text-secondary">Workflow</dt>
        <dd className="truncate font-semibold">{props.workflowName}</dd>
        <dt className="text-text-secondary">Elapsed</dt>
        <dd className="font-semibold">
          {props.startedAt > 0 ? (
            <LiveElapsed since={props.startedAt} until={props.completedAt} />
          ) : (
            '–'
          )}
        </dd>
        <dt className="text-text-secondary">Input</dt>
        <dd className="truncate font-semibold" title={props.input}>
          {props.input === '' ? '–' : props.input}
        </dd>
        {props.costRow}
        {props.envRow}
        {props.parentRunId !== null ? (
          <>
            <dt className="text-text-secondary">Parent</dt>
            <dd className="truncate font-semibold">
              <Link to={buildRunPath(props.parentRunId)}>{props.parentRunId.slice(0, 8)}</Link>
            </dd>
          </>
        ) : null}
      </dl>
      {props.actions}
      {props.actionError !== null ? (
        <p role="alert" className="mt-2 text-xs font-semibold text-error">
          {props.actionError}
        </p>
      ) : null}
      {props.loadError !== null ? (
        <p className="mt-2 text-xs text-error">Failed to load. Retrying.</p>
      ) : null}
    </header>
  );
}
