import { ChevronDown, Search } from 'lucide-react';
import type { DashboardCounts, CodebaseResponse } from '@/lib/api';
import { cn } from '@/lib/utils';

type DateRange = 'today' | '7d' | '30d' | 'all';

interface StatusSummaryBarProps {
  counts: DashboardCounts;
  activeFilter: string | null;
  onFilterChange: (status: string | null) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  projectFilter: string | null;
  onProjectFilterChange: (codebaseId: string | null) => void;
  dateRange: DateRange;
  onDateRangeChange: (range: DateRange) => void;
  codebases: CodebaseResponse[] | undefined;
}

const STATUS_TABS = [
  { status: 'running', label: 'Running' },
  { status: 'paused', label: 'Paused' },
  { status: 'completed', label: 'Completed' },
  { status: 'failed', label: 'Failed' },
  { status: 'cancelled', label: 'Cancelled' },
  { status: 'pending', label: 'Pending' },
] as const;

const DATE_RANGE_OPTIONS: { value: DateRange; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'all', label: 'All time' },
];

const CONTROL_CLASS =
  'min-h-11 w-full rounded-[10px] border border-border bg-background px-3 text-sm text-text-primary placeholder:text-text-tertiary outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none';

function Figure({
  label,
  value,
  accent,
  first,
}: {
  label: string;
  value: number;
  accent?: boolean;
  first?: boolean;
}): React.ReactElement {
  return (
    <div
      className={cn(
        'grid gap-1 py-6 pr-6',
        !first && 'border-l border-border pl-6 max-[700px]:pl-4'
      )}
    >
      <span className={cn('text-xs font-medium', accent ? 'text-accent' : 'text-text-secondary')}>
        {label}
      </span>
      <span
        className={cn(
          'text-[28px] font-semibold leading-tight tabular-nums',
          accent ? 'text-accent' : 'text-text-primary'
        )}
      >
        {String(value)}
      </span>
    </div>
  );
}

/** Summary figures plus the status, search, project and time-range filters. */
export function StatusSummaryBar({
  counts,
  activeFilter,
  onFilterChange,
  searchQuery,
  onSearchChange,
  projectFilter,
  onProjectFilterChange,
  dateRange,
  onDateRangeChange,
  codebases,
}: StatusSummaryBarProps): React.ReactElement {
  const tabs = [
    { status: null, label: 'All', count: counts.all },
    ...STATUS_TABS.map(t => ({
      status: t.status as string | null,
      label: t.label,
      count: counts[t.status],
    })),
  ];

  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-4 border-y border-border max-[700px]:grid-cols-2">
        <Figure first label="Running" value={counts.running} />
        <Figure label="Awaiting input" value={counts.paused} accent={counts.paused > 0} />
        <Figure label="Failed" value={counts.failed} />
        <Figure label="Cancelled" value={counts.cancelled} />
      </div>

      <div className="grid gap-4">
        <div
          role="tablist"
          aria-label="Status"
          className="flex flex-wrap gap-1 border-b border-border"
        >
          {tabs.map((tab, index) => {
            const selected = activeFilter === tab.status;
            return (
              <button
                key={tab.label}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={(): void => {
                  onFilterChange(tab.status);
                }}
                className={cn(
                  'inline-flex min-h-11 cursor-pointer items-center gap-2 border-b-2 px-3 text-sm font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none',
                  index === 0 && 'pl-0',
                  selected
                    ? 'border-accent text-text-primary'
                    : 'border-transparent text-text-secondary hover:text-text-primary'
                )}
              >
                {tab.label}
                <span className="font-mono text-xs font-normal text-text-tertiary">
                  {String(tab.count)}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <label className="sr-only" htmlFor="dashboard-search">
              Search runs
            </label>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-tertiary"
              strokeWidth={1.75}
            />
            <input
              id="dashboard-search"
              type="search"
              value={searchQuery}
              onChange={(e): void => {
                onSearchChange(e.target.value);
              }}
              placeholder="Search runs, issues, ids"
              className={cn(CONTROL_CLASS, 'pl-9')}
            />
          </div>
          <div className="relative w-48">
            <label className="sr-only" htmlFor="dashboard-project">
              Project
            </label>
            <select
              id="dashboard-project"
              value={projectFilter ?? ''}
              onChange={(e): void => {
                onProjectFilterChange(e.target.value || null);
              }}
              className={cn(CONTROL_CLASS, 'appearance-none pr-9')}
            >
              <option value="">All projects</option>
              {codebases?.map(cb => (
                <option key={cb.id} value={cb.id}>
                  {cb.name}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-text-tertiary"
              strokeWidth={1.75}
            />
          </div>
          <div className="relative w-40">
            <label className="sr-only" htmlFor="dashboard-range">
              Date range
            </label>
            <select
              id="dashboard-range"
              value={dateRange}
              onChange={(e): void => {
                onDateRangeChange(e.target.value as DateRange);
              }}
              className={cn(CONTROL_CLASS, 'appearance-none pr-9')}
            >
              {DATE_RANGE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-text-tertiary"
              strokeWidth={1.75}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
