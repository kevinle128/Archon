import { useQuery } from '@tanstack/react-query';

import { listDashboardRuns, type DashboardCounts } from '@/lib/api';

/** How often the shell counts refresh. Same interval as the old sidebar. */
const COUNTS_REFETCH_MS = 10_000;

/**
 * Per-status run counts for one project, or for all projects when `codebaseId` is null.
 * The server computes counts over every status, so one row is enough. The key stays
 * under `dashboardRuns` so run actions that invalidate that key refresh these counts.
 */
export function useRunCounts(codebaseId: string | null): DashboardCounts | undefined {
  const { data } = useQuery({
    queryKey: ['dashboardRuns', { counts: true, codebaseId }],
    queryFn: () => listDashboardRuns({ codebaseId: codebaseId ?? undefined, limit: 1 }),
    refetchInterval: COUNTS_REFETCH_MS,
  });
  return data?.counts;
}
