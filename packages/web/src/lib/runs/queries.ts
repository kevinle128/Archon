import { useQueries, useQuery } from '@tanstack/react-query';

import {
  listDashboardRuns,
  type DashboardCounts,
  type DashboardRunResponse,
  type DashboardRunsResult,
} from '@/lib/api';
import type { WorkflowRunStatus } from '@/lib/types';

import { FILTER_STATUSES } from './run-list-groups';
import type { RunListFilter } from './run-url';

/** How often the shell counts refresh. Same interval as the old sidebar. */
const COUNTS_REFETCH_MS = 10_000;

/** How often the runs list refreshes. */
const LIST_REFETCH_MS = 10_000;

/** Rows each "Load more" adds, and the first page size. */
export const RUNS_PAGE_SIZE = 50;

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

/** Date range presets of the runs list. `all` means no date filter. */
export type RunDateRange = 'today' | '7d' | '30d' | 'all';

export const RUN_DATE_RANGES: readonly { value: RunDateRange; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
];

export function parseRunDateRange(value: string | null): RunDateRange {
  return RUN_DATE_RANGES.some(range => range.value === value) ? (value as RunDateRange) : 'all';
}

/** Lower bound of a date range as an ISO string, or undefined for all time. */
export function rangeStart(range: RunDateRange, now: Date = new Date()): string | undefined {
  if (range === 'all') return undefined;
  const start = new Date(now);
  if (range === 'today') start.setHours(0, 0, 0, 0);
  else start.setDate(start.getDate() - (range === '7d' ? 7 : 30));
  return start.toISOString();
}

export interface RunsListQuery {
  filter: RunListFilter;
  codebaseId: string | null;
  search: string;
  range: RunDateRange;
  /** Rows to show. Grows by `RUNS_PAGE_SIZE` on each "Load more". */
  limit: number;
}

export interface RunsListResult {
  runs: DashboardRunResponse[];
  /** Runs that match the tab, including rows not loaded yet. */
  total: number;
  counts: DashboardCounts | undefined;
  isLoading: boolean;
  isError: boolean;
}

/**
 * Merges per-status pages into one list, newest first. A tab with two statuses
 * (Active, Finished) reads one page per status, because the API filters by one status.
 */
export function mergeRunPages(
  pages: readonly (DashboardRunsResult | undefined)[],
  limit: number
): Pick<RunsListResult, 'runs' | 'total' | 'counts'> {
  const loaded = pages.filter((page): page is DashboardRunsResult => page !== undefined);
  const runs = loaded
    .flatMap(page => page.runs)
    .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))
    .slice(0, limit);
  return {
    runs,
    total: loaded.reduce((sum, page) => sum + page.total, 0),
    counts: loaded[0]?.counts,
  };
}

/** The runs of one list tab, scoped by project, search text, and date range. */
export function useRunsList(query: RunsListQuery): RunsListResult {
  const statuses: readonly (WorkflowRunStatus | undefined)[] = FILTER_STATUSES[query.filter] ?? [
    undefined,
  ];
  const after = rangeStart(query.range);
  const results = useQueries({
    queries: statuses.map(status => ({
      queryKey: [
        'dashboardRuns',
        {
          list: true,
          status: status ?? null,
          codebaseId: query.codebaseId,
          search: query.search,
          range: query.range,
          limit: query.limit,
        },
      ],
      queryFn: (): Promise<DashboardRunsResult> =>
        listDashboardRuns({
          status,
          codebaseId: query.codebaseId ?? undefined,
          search: query.search || undefined,
          after,
          limit: query.limit,
        }),
      refetchInterval: LIST_REFETCH_MS,
      placeholderData: (
        previous: DashboardRunsResult | undefined
      ): DashboardRunsResult | undefined => previous,
    })),
  });
  return {
    ...mergeRunPages(
      results.map(result => result.data),
      query.limit
    ),
    isLoading: results.some(result => result.isLoading),
    isError: results.some(result => result.isError),
  };
}
