import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { ChevronDown, Workflow } from 'lucide-react';
import {
  listDashboardRuns,
  cancelWorkflowRun,
  resumeWorkflowRun,
  abandonWorkflowRun,
  deleteWorkflowRun,
  approveWorkflowRun,
  rejectWorkflowRun,
  listCodebases,
  getHealth,
  type DashboardCounts,
} from '@/lib/api';
import type { WorkflowRunStatus } from '@/lib/types';
import { ensureUtc } from '@/lib/format';
import { StatusSummaryBar } from '@/components/dashboard/StatusSummaryBar';
import { WorkflowRunCard } from '@/components/dashboard/WorkflowRunCard';
import { useDashboardSSE } from '@/hooks/useDashboardSSE';
import { useWorkflowStore } from '@/stores/workflow-store';

const DEFAULT_PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

/** Date range presets. "all" means no date filter. */
type DateRange = 'today' | '7d' | '30d' | 'all';

function getDateBounds(range: DateRange): { after?: string; before?: string } {
  if (range === 'all') return {};
  const now = new Date();
  const start = new Date(now);
  if (range === 'today') {
    start.setHours(0, 0, 0, 0);
  } else if (range === '7d') {
    start.setDate(start.getDate() - 7);
  } else if (range === '30d') {
    start.setDate(start.getDate() - 30);
  }
  return { after: start.toISOString() };
}

export function DashboardPage(): React.ReactElement {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  // Connect to multiplexed dashboard SSE stream (all workflow events → Zustand store)
  useDashboardSSE();

  const hydrateWorkflow = useWorkflowStore(state => state.hydrateWorkflow);

  // Hydrate filter state from URL (supports bookmarkable views)
  const statusFilter = searchParams.get('status') ?? null;
  const searchQuery = searchParams.get('q') ?? '';
  const projectFilter = searchParams.get('project') ?? null;
  const dateRange: DateRange = (searchParams.get('range') as DateRange) ?? 'all';
  const page = Math.max(0, Number(searchParams.get('page') ?? '0'));
  const pageSizeParam = Number(searchParams.get('pageSize') ?? '0');
  const pageSize = PAGE_SIZE_OPTIONS.includes(pageSizeParam as (typeof PAGE_SIZE_OPTIONS)[number])
    ? pageSizeParam
    : DEFAULT_PAGE_SIZE;

  // Debounced search: type instantly in the input, but delay the server request
  const [searchInput, setSearchInput] = useState(searchQuery);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Sync searchInput when URL changes externally (e.g., back/forward)
  useEffect(() => {
    setSearchInput(searchParams.get('q') ?? '');
  }, [searchParams]);

  /** Helper to update URL params (replaces history entry to avoid back-spam). */
  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      setSearchParams(
        prev => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(updates)) {
            if (v === null || v === '' || v === '0' || v === 'all') {
              next.delete(k);
            } else {
              next.set(k, v);
            }
          }
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const setStatusFilter = useCallback(
    (status: string | null) => {
      updateParams({ status, page: null });
    },
    [updateParams]
  );
  const setProjectFilter = useCallback(
    (project: string | null) => {
      updateParams({ project, page: null });
    },
    [updateParams]
  );
  const setDateRange = useCallback(
    (range: DateRange) => {
      updateParams({ range, page: null });
    },
    [updateParams]
  );
  const setPage = useCallback(
    (p: number) => {
      updateParams({ page: p === 0 ? null : String(p) });
    },
    [updateParams]
  );

  const setPageSize = useCallback(
    (size: number) => {
      updateParams({
        pageSize: size === DEFAULT_PAGE_SIZE ? null : String(size),
        page: null,
      });
    },
    [updateParams]
  );

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchInput(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        updateParams({ q: value || null, page: null });
      }, 300);
    },
    [updateParams]
  );

  // Compute date bounds from range preset
  const dateBounds = useMemo(() => getDateBounds(dateRange), [dateRange]);

  // Server-side fetch with all filters
  const {
    data: dashboardData,
    isLoading,
    isError,
    error: fetchError,
    dataUpdatedAt,
  } = useQuery({
    queryKey: [
      'dashboardRuns',
      {
        status: statusFilter,
        codebaseId: projectFilter,
        search: searchQuery,
        dateRange,
        page,
        pageSize,
      },
    ],
    queryFn: () =>
      listDashboardRuns({
        status: (statusFilter as WorkflowRunStatus) ?? undefined,
        codebaseId: projectFilter ?? undefined,
        search: searchQuery || undefined,
        after: dateBounds.after,
        before: dateBounds.before,
        limit: pageSize,
        offset: page * pageSize,
      }),
    refetchInterval: 5_000,
  });

  const runs = dashboardData?.runs ?? [];
  const total = dashboardData?.total ?? 0;
  const counts: DashboardCounts = dashboardData?.counts ?? {
    all: 0,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    pending: 0,
    paused: 0,
  };

  // Hydrate Zustand store from REST-polled data for active runs.
  // Only sets initial state if the run isn't already tracked by SSE.
  useEffect(() => {
    for (const run of runs) {
      if (run.status === 'running' || run.status === 'pending' || run.status === 'paused') {
        hydrateWorkflow({
          runId: run.id,
          workflowName: run.workflow_name,
          status: run.status,
          dagNodes: [],
          artifacts: [],
          startedAt: new Date(ensureUtc(run.started_at)).getTime(),
          currentTool: null,
        });
      }
    }
  }, [runs, hydrateWorkflow]);

  const { data: codebases } = useQuery({
    queryKey: ['codebases'],
    queryFn: () => listCodebases(),
  });

  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: getHealth,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });

  const [actionError, setActionError] = useState<string | null>(null);

  async function runAction(
    action: (runId: string) => Promise<unknown>,
    runId: string,
    fallbackMessage: string
  ): Promise<void> {
    try {
      setActionError(null);
      await action(runId);
      void queryClient.invalidateQueries({ queryKey: ['dashboardRuns'] });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : fallbackMessage);
    }
  }

  const handleCancel = (runId: string): Promise<void> =>
    runAction(cancelWorkflowRun, runId, 'Failed to cancel workflow');
  const handleResume = (runId: string): Promise<void> =>
    runAction(resumeWorkflowRun, runId, 'Failed to resume workflow');
  const handleAbandon = (runId: string): Promise<void> =>
    runAction(abandonWorkflowRun, runId, 'Failed to abandon workflow');
  const handleDelete = (runId: string): Promise<void> =>
    runAction(deleteWorkflowRun, runId, 'Failed to delete workflow run');
  const handleApprove = (runId: string): Promise<void> =>
    runAction(approveWorkflowRun, runId, 'Failed to approve workflow');
  // Reject differs from the rest of the lifecycle actions because it takes a
  // second argument (the optional reason). Inline it rather than squeezing
  // through `runAction`'s `(id) => Promise` signature with a closure — keeps
  // `runAction` usefully narrow for the single-arg actions above.
  async function handleReject(runId: string, reason?: string): Promise<void> {
    try {
      setActionError(null);
      await rejectWorkflowRun(runId, reason);
      void queryClient.invalidateQueries({ queryKey: ['dashboardRuns'] });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to reject workflow');
    }
  }

  const totalPages = Math.ceil(total / pageSize);
  const hasMore = page + 1 < totalPages;

  const rowProps = {
    isDocker: health?.is_docker,
    isWsl: health?.is_wsl,
    wslDistro: health?.wsl_distro,
    onCancel: handleCancel,
    onResume: handleResume,
    onAbandon: handleAbandon,
    onDelete: handleDelete,
    onApprove: handleApprove,
    onReject: handleReject,
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-auto">
        <div className="mx-auto grid w-full max-w-[1200px] gap-6 px-8 py-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="grid gap-2">
              <h1 className="text-[28px] font-semibold leading-tight text-text-primary">
                Dashboard
              </h1>
              <p className="text-base text-text-secondary">All workflow runs across projects.</p>
            </div>
            <div className="flex flex-col items-end gap-1 font-mono text-xs text-text-secondary">
              {health && (
                <span>
                  Capacity{' '}
                  <b className="font-medium text-text-primary">
                    {String(health.concurrency.active)}/{String(health.concurrency.maxConcurrent)}
                  </b>{' '}
                  active
                </span>
              )}
              {dataUpdatedAt > 0 && (
                <span className="text-text-tertiary">
                  Last updated {new Date(dataUpdatedAt).toLocaleTimeString()}
                </span>
              )}
            </div>
          </div>

          <StatusSummaryBar
            counts={counts}
            activeFilter={statusFilter}
            onFilterChange={setStatusFilter}
            searchQuery={searchInput}
            onSearchChange={handleSearchChange}
            projectFilter={projectFilter}
            onProjectFilterChange={setProjectFilter}
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            codebases={codebases}
          />

          {actionError && (
            <div
              role="alert"
              className="rounded-[10px] border border-error/30 px-4 py-3 text-sm text-error"
            >
              {actionError}
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <span className="text-sm text-text-tertiary">Loading...</span>
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <p className="text-sm text-error">
                Failed to load workflow runs
                {fetchError instanceof Error ? `: ${fetchError.message}` : ''}
              </p>
            </div>
          ) : runs.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <Workflow className="size-10 text-text-tertiary" strokeWidth={1.75} />
              <p className="text-sm text-text-tertiary">No workflow runs found</p>
            </div>
          ) : (
            <>
              {/* Hairline-divided list; the filters block above supplies its own bottom rule. */}
              <div className="-mt-2 border-t border-border">
                {runs.map(run => (
                  <WorkflowRunCard key={run.id} run={run} {...rowProps} />
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 text-sm text-text-secondary">
                <span>
                  Showing {String(page * pageSize + 1)}&ndash;
                  {String(Math.min((page + 1) * pageSize, total))} of {String(total)} runs
                </span>
                <div className="flex items-center gap-2">
                  <div className="relative w-32">
                    <label className="sr-only" htmlFor="dashboard-page-size">
                      Per page
                    </label>
                    <select
                      id="dashboard-page-size"
                      value={pageSize}
                      onChange={(e): void => {
                        setPageSize(Number(e.target.value));
                      }}
                      className="min-h-11 w-full appearance-none rounded-[10px] border border-border bg-background px-3 pr-9 text-sm text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {PAGE_SIZE_OPTIONS.map(size => (
                        <option key={size} value={size}>
                          {String(size)} per page
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-text-tertiary"
                      strokeWidth={1.75}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={(): void => {
                      setPage(page - 1);
                    }}
                    disabled={page === 0}
                    className="min-h-11 cursor-pointer rounded-[10px] px-4 text-sm font-medium text-text-secondary outline-none transition-colors duration-150 hover:bg-surface hover:text-text-primary focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:text-text-tertiary disabled:hover:bg-transparent"
                  >
                    Previous
                  </button>
                  <span className="text-xs text-text-tertiary">
                    Page {String(page + 1)} of {String(Math.max(1, totalPages))}
                  </span>
                  <button
                    type="button"
                    onClick={(): void => {
                      setPage(page + 1);
                    }}
                    disabled={!hasMore}
                    className="min-h-11 cursor-pointer rounded-[10px] px-4 text-sm font-medium text-text-secondary outline-none transition-colors duration-150 hover:bg-surface hover:text-text-primary focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:text-text-tertiary disabled:hover:bg-transparent"
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
