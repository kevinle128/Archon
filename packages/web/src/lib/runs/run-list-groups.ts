import type { DashboardCounts } from '@/lib/api';
import type { WorkflowRunStatus } from '@/lib/types';

import type { RunListFilter } from './run-url';

/** Run statuses each list tab shows. `null` means every status. */
export const FILTER_STATUSES: Readonly<Record<RunListFilter, readonly WorkflowRunStatus[] | null>> =
  {
    active: ['running', 'paused'],
    needs: ['paused'],
    finished: ['completed', 'failed'],
    all: null,
  };

export const FILTER_LABELS: Readonly<Record<RunListFilter, string>> = {
  active: 'Active',
  needs: 'Needs you',
  finished: 'Finished',
  all: 'All',
};

/** Number of runs in a list tab, from the server's per-status counts. */
export function countForFilter(filter: RunListFilter, counts: DashboardCounts | undefined): number {
  if (counts === undefined) return 0;
  const statuses = FILTER_STATUSES[filter];
  if (statuses === null) return counts.all;
  return statuses.reduce((sum, status) => sum + counts[status], 0);
}

/** True when a run with this status belongs in the list tab. */
export function statusInFilter(filter: RunListFilter, status: WorkflowRunStatus): boolean {
  const statuses = FILTER_STATUSES[filter];
  return statuses === null || statuses.includes(status);
}
