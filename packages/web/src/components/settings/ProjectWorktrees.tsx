import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getCodebaseEnvironments, type IsolationEnvironment } from '@/lib/api';

/** Active worktrees of one project, with the age of their last activity. */
export function ProjectWorktrees({ codebaseId }: { codebaseId: string }): ReactElement | null {
  const { data: environments, isError } = useQuery({
    queryKey: ['environments', { codebaseId }],
    queryFn: () => getCodebaseEnvironments(codebaseId),
    refetchInterval: 30_000,
  });
  const active = environments?.filter((e: IsolationEnvironment) => e.status === 'active') ?? [];
  if (!isError && active.length === 0) return null;

  return (
    <div className="col-span-full grid gap-1">
      <span className="text-xs font-semibold text-text-secondary">
        Active worktrees{!isError && ` (${String(active.length)})`}
      </span>
      {isError ? (
        <span className="text-xs text-error">Failed to load worktrees. Retrying.</span>
      ) : (
        <ul className="grid gap-0.5">
          {active.map(env => (
            <li key={env.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate font-mono text-text-primary">{env.branch_name}</span>
              <span className="shrink-0 text-text-tertiary">
                {env.days_since_activity === 0
                  ? 'today'
                  : `${String(env.days_since_activity)}d ago`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
