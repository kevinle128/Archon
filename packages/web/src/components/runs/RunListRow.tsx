import { Link } from 'react-router';

import { LiveElapsed } from '@/components/ui/live-elapsed';
import { ProgressStrip } from '@/components/ui/progress-strip';
import type { DashboardRunResponse } from '@/lib/api';
import { ensureUtc } from '@/lib/format';
import { getStatusPresentation, STATUS_TONE_TEXT_CLASS } from '@/lib/status-presentation';
import { cn } from '@/lib/utils';

/** First line of the run input, shown beside the workflow name. */
export function runNote(userMessage: string): string {
  return userMessage.split('\n', 1)[0]?.trim() ?? '';
}

/** "10:04" for a time today, otherwise "Oct 3". */
export function shortTime(iso: string, now: Date = new Date()): string {
  const date = new Date(ensureUtc(iso));
  if (Number.isNaN(date.getTime())) return '';
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function RowTime({ run }: { run: DashboardRunResponse }): React.ReactElement {
  if (run.status === 'running') return <LiveElapsed since={ensureUtc(run.started_at)} />;
  if (run.status === 'paused') {
    return <span>since {shortTime(run.last_activity_at ?? run.started_at)}</span>;
  }
  return <span>{shortTime(run.started_at)}</span>;
}

interface RunListRowProps {
  run: DashboardRunResponse;
  /** Project display name such as `owner/repo`, or null for a run without a project. */
  projectName: string | null;
  statuses: readonly string[];
  selected: boolean;
  to: string;
}

/** One run in the runs list. */
export function RunListRow({
  run,
  projectName,
  statuses,
  selected,
  to,
}: RunListRowProps): React.ReactElement {
  const presentation = getStatusPresentation(run.status);
  const toneClass = STATUS_TONE_TEXT_CLASS[presentation.tone];
  const slash = projectName?.lastIndexOf('/') ?? -1;
  const owner = projectName !== null && slash > 0 ? projectName.slice(0, slash + 1) : '';
  const repo = projectName === null ? 'No project' : projectName.slice(slash + 1);
  const note = runNote(run.user_message);

  return (
    <Link
      to={to}
      data-run-id={run.id}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'flex w-full flex-col gap-1.5 border-b border-l-[3px] border-b-border px-4 py-3 text-left text-text-primary no-underline hover:bg-selection',
        selected ? 'border-l-accent bg-selection' : 'border-l-transparent'
      )}
    >
      <span className="truncate pl-5 text-[11px] font-bold tracking-[0.02em] text-text-secondary">
        <span className="font-normal">{owner}</span>
        <span className="text-text-primary">{repo}</span>
      </span>
      <span className="flex w-full items-baseline gap-2">
        <span
          className={cn('w-3 flex-none text-[13px] font-extrabold', toneClass)}
          aria-hidden="true"
        >
          {presentation.glyph}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-bold">
          {run.workflow_name}
          {note !== '' ? <span className="font-normal text-text-secondary"> · {note}</span> : null}
        </span>
        <span className="flex-none text-xs text-text-secondary">
          <RowTime run={run} />
        </span>
      </span>
      <ProgressStrip statuses={statuses} className="w-full pl-5" />
      <span className="flex w-full justify-between gap-2 pl-5 text-xs text-text-secondary">
        <span className="min-w-0 truncate">{run.id.slice(0, 8)}</span>
        <span className={cn('flex-none font-semibold', toneClass)}>{presentation.label}</span>
      </span>
    </Link>
  );
}
