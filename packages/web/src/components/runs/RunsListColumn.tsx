import { useProject } from '@/contexts/ProjectContext';
import type { CodebaseResponse, DashboardRunResponse } from '@/lib/api';
import { projectDisplayName } from '@/lib/projects/display-name';
import { countForFilter, FILTER_LABELS } from '@/lib/runs/run-list-groups';
import {
  RUN_DATE_RANGES,
  RUNS_PAGE_SIZE,
  type RunDateRange,
  type RunsListResult,
} from '@/lib/runs/queries';
import { RUN_LIST_FILTERS, type RunListFilter } from '@/lib/runs/run-url';
import { cn } from '@/lib/utils';

import { RunListRow } from './RunListRow';
import { StartRunDialog } from './StartRunDialog';
import { useRunStrip } from './run-strip';

interface RunsListColumnProps {
  list: RunsListResult;
  filter: RunListFilter;
  search: string;
  range: RunDateRange;
  limit: number;
  selectedRunId: string | null;
  /** Link of a run row. Keeps the list filters. */
  linkFor: (runId: string) => string;
  onFilterChange: (filter: RunListFilter) => void;
  onSearchChange: (search: string) => void;
  onRangeChange: (range: RunDateRange) => void;
  onLoadMore: () => void;
}

function StripRow({
  run,
  codebase,
  selected,
  to,
}: {
  run: DashboardRunResponse;
  codebase: CodebaseResponse | undefined;
  selected: boolean;
  to: string;
}): React.ReactElement {
  const statuses = useRunStrip(run, codebase?.default_cwd);
  const projectName =
    codebase !== undefined ? projectDisplayName(codebase) : (run.codebase_name ?? null);
  return (
    <RunListRow
      run={run}
      projectName={projectName}
      statuses={statuses}
      selected={selected}
      to={to}
    />
  );
}

/** Left column of the Runs workspace: tabs, filter, and the run rows. */
export function RunsListColumn({
  list,
  filter,
  search,
  range,
  limit,
  selectedRunId,
  linkFor,
  onFilterChange,
  onSearchChange,
  onRangeChange,
  onLoadMore,
}: RunsListColumnProps): React.ReactElement {
  const { selectedProjectId, codebases } = useProject();
  const codebaseById = new Map((codebases ?? []).map(codebase => [codebase.id, codebase]));

  return (
    <aside
      aria-label="Runs"
      data-testid="runs-list"
      className="flex min-h-0 flex-col border-r-2 border-line-strong"
    >
      <div className="px-4 pt-3">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-xl font-extrabold">Runs</h1>
          <span className="text-xs text-text-secondary">
            {String(list.counts?.running ?? 0)} running
          </span>
        </div>
        <input
          type="search"
          value={search}
          data-list-filter=""
          aria-label="Filter runs"
          placeholder="Filter by workflow, input, id"
          onChange={(event): void => {
            onSearchChange(event.target.value);
          }}
          onKeyDown={(event): void => {
            if (event.key === 'Escape') onSearchChange('');
          }}
          className="mt-2 h-8 w-full border border-line-strong bg-background px-2 text-[13px] text-text-primary placeholder:text-text-tertiary"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <select
            value={range}
            aria-label="Date range"
            onChange={(event): void => {
              onRangeChange(event.target.value as RunDateRange);
            }}
            className="h-7 min-w-0 border border-line-strong bg-background px-1 text-xs text-text-primary"
          >
            {RUN_DATE_RANGES.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <StartRunDialog codebaseId={selectedProjectId} />
        </div>
        <div role="tablist" aria-label="Run filter" className="mt-2 flex border-b border-border">
          {RUN_LIST_FILTERS.map(option => {
            const active = option === filter;
            return (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={(): void => {
                  onFilterChange(option);
                }}
                className={cn(
                  '-mb-px mr-3 flex-none border-b-2 py-2 text-xs font-semibold whitespace-nowrap',
                  active
                    ? 'border-accent text-text-primary'
                    : 'border-transparent text-text-secondary hover:text-text-primary'
                )}
              >
                {FILTER_LABELS[option]} {String(countForFilter(option, list.counts))}
              </button>
            );
          })}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {list.isError && list.runs.length === 0 ? (
          <p className="p-4 text-[13px] text-error">Failed to load runs. Retrying.</p>
        ) : null}
        {list.isLoading && list.runs.length === 0 ? (
          <p className="p-4 text-[13px] text-text-secondary">Loading runs…</p>
        ) : null}
        {!list.isLoading && !list.isError && list.runs.length === 0 ? (
          <p className="p-4 text-[13px] text-text-secondary">No runs match.</p>
        ) : null}
        {list.runs.map(run => (
          <StripRow
            key={run.id}
            run={run}
            codebase={run.codebase_id !== null ? codebaseById.get(run.codebase_id) : undefined}
            selected={run.id === selectedRunId}
            to={linkFor(run.id)}
          />
        ))}
        {list.total > list.runs.length && list.runs.length >= limit ? (
          <button
            type="button"
            onClick={onLoadMore}
            className="w-full px-4 py-3 text-left text-[13px] font-semibold text-accent hover:bg-selection"
          >
            Load {String(Math.min(RUNS_PAGE_SIZE, list.total - list.runs.length))} more
          </button>
        ) : null}
      </div>
    </aside>
  );
}
