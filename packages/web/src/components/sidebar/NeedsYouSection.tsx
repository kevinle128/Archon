import { Link } from 'react-router';
import { CircleHelp } from 'lucide-react';
import type { DashboardRunResponse } from '@/lib/api';
import { formatStarted } from '@/lib/format';
import { SidebarSectionHeader } from '@/components/sidebar/SidebarSectionHeader';

interface NeedsYouSectionProps {
  /** Paused runs in API order. */
  runs: readonly DashboardRunResponse[];
  /** Server-side total of paused runs, which may exceed the loaded list. */
  total: number;
}

/** Runs that wait for a human answer or approval. Renders nothing when there are none. */
export function NeedsYouSection({ runs, total }: NeedsYouSectionProps): React.ReactElement | null {
  if (runs.length === 0) return null;
  return (
    <section aria-label="Needs you">
      <SidebarSectionHeader
        title="Needs you"
        badge={String(total)}
        badgeLabel={`${String(total)} runs waiting`}
      />
      <div className="grid gap-0.5">
        {runs.map(run => (
          <Link
            key={run.id}
            to={`/workflows/runs/${run.id}`}
            className="grid min-h-11 grid-cols-[16px_minmax(0,1fr)] items-start gap-x-3 rounded-lg px-3 py-2 text-text-primary transition-colors duration-150 hover:bg-surface-elevated"
          >
            <CircleHelp className="mt-0.5 h-4 w-4 text-accent" strokeWidth={1.5} aria-hidden />
            <span className="min-w-0">
              <span className="block truncate text-sm">
                {run.workflow_name}
                {run.current_step_name && (
                  <>
                    {' at '}
                    <span className="font-mono text-[13px]">{run.current_step_name}</span>
                  </>
                )}
              </span>
              <span className="block truncate text-xs text-text-tertiary">
                Waiting since {formatStarted(run.last_activity_at ?? run.started_at)}
              </span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
