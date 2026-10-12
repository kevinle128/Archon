import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router';

import { RunsListColumn } from '@/components/runs/RunsListColumn';
import {
  WorkflowExecution,
  type WorkflowRunQueryData,
} from '@/components/workflows/WorkflowExecution';
import { useProject } from '@/contexts/ProjectContext';
import { useDashboardSSE } from '@/hooks/useDashboardSSE';
import {
  parseRunDateRange,
  RUNS_PAGE_SIZE,
  useRunsList,
  type RunDateRange,
} from '@/lib/runs/queries';
import {
  buildRunPath,
  filterFromLegacyStatus,
  keepListParams,
  parseNodeColumnTab,
  parseRunListFilter,
  type NodeColumnTab,
  type RunListFilter,
} from '@/lib/runs/run-url';
import { cn } from '@/lib/utils';

/** Delay before a typed filter reaches the API. */
const SEARCH_DEBOUNCE_MS = 300;

/** The three columns show from this width. Below it the list hides while a run is open. */
const WIDE_QUERY = '(min-width: 1024px)';

function useWideViewport(): boolean {
  const [wide, setWide] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(WIDE_QUERY).matches
  );
  useEffect(() => {
    const media = window.matchMedia(WIDE_QUERY);
    const onChange = (): void => {
      setWide(media.matches);
    };
    onChange();
    media.addEventListener('change', onChange);
    return (): void => {
      media.removeEventListener('change', onChange);
    };
  }, []);
  return wide;
}

/** Runs workspace: runs list, selected run, selected node. */
export function RunsPage(): React.ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { runId, nodeId } = useParams<{ runId?: string; nodeId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { selectedProjectId } = useProject();
  const wide = useWideViewport();
  useDashboardSSE();

  // Old Dashboard links carry `status`; map it to the list tab that contains it.
  const legacyStatus = searchParams.get('status');
  useEffect(() => {
    if (legacyStatus === null) return;
    const next = new URLSearchParams(searchParams);
    next.delete('status');
    next.set('filter', filterFromLegacyStatus(legacyStatus));
    setSearchParams(next, { replace: true });
  }, [legacyStatus, searchParams, setSearchParams]);

  const filter = parseRunListFilter(
    legacyStatus !== null ? filterFromLegacyStatus(legacyStatus) : searchParams.get('filter')
  );
  const range = parseRunDateRange(searchParams.get('range'));
  const tab: NodeColumnTab = parseNodeColumnTab(searchParams.get('tab'));
  const [searchInput, setSearchInput] = useState(searchParams.get('q') ?? '');
  const [search, setSearch] = useState(searchInput);
  const [limit, setLimit] = useState(RUNS_PAGE_SIZE);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
    }, SEARCH_DEBOUNCE_MS);
    return (): void => {
      clearTimeout(timer);
    };
  }, [searchInput]);

  useEffect(() => {
    setLimit(RUNS_PAGE_SIZE);
  }, [filter, range, search, selectedProjectId]);

  const list = useRunsList({ filter, codebaseId: selectedProjectId, search, range, limit });

  const updateParam = (key: string, value: string | null): void => {
    const next = new URLSearchParams(searchParams);
    if (value === null) next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  };

  // On a wide screen a run is always open, like the prototype: open the first listed run.
  // Wait for an old `status` link to become `filter` first, so the filter stays in the URL.
  const firstRunId = list.runs[0]?.id ?? null;
  useEffect(() => {
    if (!wide || runId !== undefined || firstRunId === null || legacyStatus !== null) return;
    void navigate(keepListParams(buildRunPath(firstRunId), searchParams), { replace: true });
  }, [wide, runId, firstRunId, legacyStatus, navigate, searchParams]);

  // Project change: when the open run is not in the new project, open that project's first run.
  const previousProject = useRef(selectedProjectId);
  useEffect(() => {
    if (previousProject.current === selectedProjectId || list.isLoading) return;
    previousProject.current = selectedProjectId;
    if (runId === undefined || selectedProjectId === null) return;
    const detail = queryClient.getQueryData<WorkflowRunQueryData>(['workflowRun', runId]);
    if (detail?.codebaseId === selectedProjectId) return;
    const target = firstRunId === null ? '/runs' : buildRunPath(firstRunId);
    void navigate(keepListParams(target, searchParams), { replace: true });
  }, [selectedProjectId, list.isLoading, firstRunId, runId, navigate, queryClient, searchParams]);

  const listHidden = !wide && runId !== undefined;

  return (
    <div
      className={cn(
        'grid min-h-0 flex-1',
        listHidden
          ? 'grid-cols-[minmax(0,1fr)]'
          : runId === undefined && !wide
            ? 'grid-cols-[minmax(0,1fr)]'
            : 'grid-cols-[minmax(240px,300px)_minmax(0,1fr)]'
      )}
    >
      {listHidden ? null : (
        <RunsListColumn
          list={list}
          filter={filter}
          search={searchInput}
          range={range}
          limit={limit}
          selectedRunId={runId ?? null}
          linkFor={(id: string): string => keepListParams(buildRunPath(id), searchParams)}
          onFilterChange={(next: RunListFilter): void => {
            updateParam('filter', next === 'active' ? null : next);
          }}
          onSearchChange={(next: string): void => {
            setSearchInput(next);
            updateParam('q', next === '' ? null : next);
          }}
          onRangeChange={(next: RunDateRange): void => {
            updateParam('range', next === 'all' ? null : next);
          }}
          onLoadMore={(): void => {
            setLimit(current => current + RUNS_PAGE_SIZE);
          }}
        />
      )}
      {runId !== undefined ? (
        <WorkflowExecution
          key={runId}
          runId={runId}
          nodeId={nodeId ?? null}
          tab={tab}
          showBackToList={listHidden}
          autoSelectNode={wide}
        />
      ) : wide ? (
        <div className="flex min-h-0 items-center justify-center p-8 text-sm text-text-secondary">
          {list.isLoading ? 'Loading runs…' : 'No run is selected.'}
        </div>
      ) : null}
    </div>
  );
}
