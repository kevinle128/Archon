import { Link } from 'react-router';

import { SectionLabel } from '@/components/ui/section-label';
import type { WorkflowListEntry, WorkflowSource } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  CATEGORIES,
  getWorkflowCategory,
  parseWorkflowDescription,
  type WorkflowCategory,
} from '@/lib/workflow-metadata';

const SOURCE_TAG: Readonly<Record<WorkflowSource, { label: string; className: string }>> = {
  project: { label: 'Project', className: 'text-accent' },
  global: { label: 'Global', className: 'text-text-secondary' },
  bundled: { label: 'Bundled', className: 'text-text-tertiary' },
};

/** One-line summary for a row: the "when to use" part, else the whole description. */
export function rowDescription(description: string): string {
  const parsed = parseWorkflowDescription(description);
  return parsed.whenToUse !== '' ? parsed.whenToUse : description;
}

/** Category counts over the searched list. "All" counts every entry. */
export function categoryCounts(
  entries: readonly WorkflowListEntry[]
): Map<WorkflowCategory, number> {
  const counts = new Map<WorkflowCategory, number>(CATEGORIES.map(category => [category, 0]));
  for (const { workflow } of entries) {
    const category = getWorkflowCategory(workflow.name, workflow.description);
    counts.set(category, (counts.get(category) ?? 0) + 1);
    counts.set('All', (counts.get('All') ?? 0) + 1);
  }
  return counts;
}

function WorkflowRow({
  entry,
  selected,
  onSelect,
}: {
  entry: WorkflowListEntry;
  selected: boolean;
  onSelect: (name: string) => void;
}): React.ReactElement {
  const { workflow, source } = entry;
  const tag = SOURCE_TAG[source];
  const nodeCount = workflow.nodes.length;
  return (
    <button
      type="button"
      title={workflow.name}
      aria-current={selected ? 'true' : undefined}
      onClick={(): void => {
        onSelect(workflow.name);
      }}
      className={cn(
        'flex w-full flex-col gap-1 border-b border-l-[3px] border-b-border px-4 py-3 text-left hover:bg-selection',
        selected ? 'border-l-accent bg-selection' : 'border-l-transparent'
      )}
    >
      <span className="text-sm font-bold break-words text-text-primary">{workflow.name}</span>
      {workflow.description !== '' ? (
        <span className="line-clamp-2 text-xs leading-[1.45] text-text-secondary">
          {rowDescription(workflow.description)}
        </span>
      ) : null}
      <span className="flex w-full justify-between gap-2 text-[11px] text-text-secondary">
        <span>
          {String(nodeCount)} {nodeCount === 1 ? 'node' : 'nodes'}
          {entry.parseWarnings !== undefined && entry.parseWarnings.length > 0 ? (
            <span className="ml-2 font-bold text-status-waiting">Warnings</span>
          ) : null}
        </span>
        <span className={cn('font-bold', tag.className)}>{tag.label}</span>
      </span>
    </button>
  );
}

interface WorkflowsListColumnProps {
  /** Entries after the search filter, before the category filter. */
  searched: readonly WorkflowListEntry[];
  /** Entries shown in the active category, recommended ones first. */
  recommended: readonly WorkflowListEntry[];
  rest: readonly WorkflowListEntry[];
  total: number;
  selectedName: string | null;
  onSelect: (name: string) => void;
  query: string;
  onQueryChange: (query: string) => void;
  category: WorkflowCategory;
  onCategoryChange: (category: WorkflowCategory) => void;
  /** Shown instead of rows while the list loads or failed to load. */
  status: React.ReactNode;
}

/** Left column of the Workflows screen. */
export function WorkflowsListColumn({
  searched,
  recommended,
  rest,
  total,
  selectedName,
  onSelect,
  query,
  onQueryChange,
  category,
  onCategoryChange,
  status,
}: WorkflowsListColumnProps): React.ReactElement {
  const counts = categoryCounts(searched);
  const empty = recommended.length === 0 && rest.length === 0;
  return (
    <aside aria-label="Workflows" className="flex min-h-0 flex-col border-r-2 border-line-strong">
      <div className="px-4 pt-3">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-xl font-extrabold">Workflows</h1>
          <span className="flex items-baseline gap-3 text-xs text-text-secondary">
            {String(total)}
            <Link to="/workflows/builder" className="font-semibold text-accent">
              New
            </Link>
          </span>
        </div>
        <input
          type="search"
          value={query}
          data-list-filter=""
          aria-label="Search workflows"
          placeholder="Filter by name or description"
          onChange={(event): void => {
            onQueryChange(event.target.value);
          }}
          onKeyDown={(event): void => {
            if (event.key === 'Escape') onQueryChange('');
          }}
          className="mt-2 h-8 w-full border border-line-strong bg-background px-2 text-[13px] text-text-primary placeholder:text-text-tertiary"
        />
        <div
          role="tablist"
          aria-label="Category"
          className="mt-2 flex overflow-x-auto border-b border-border [scrollbar-width:none]"
        >
          {CATEGORIES.map(option => {
            const active = option === category;
            return (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={(): void => {
                  onCategoryChange(option);
                }}
                className={cn(
                  '-mb-px mr-3 flex-none border-b-2 py-2 text-xs font-semibold whitespace-nowrap',
                  active
                    ? 'border-accent text-text-primary'
                    : 'border-transparent text-text-secondary hover:text-text-primary'
                )}
              >
                {option} {String(counts.get(option) ?? 0)}
              </button>
            );
          })}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {status}
        {status === null && empty ? (
          <p className="p-4 text-[13px] text-text-secondary">No workflows match.</p>
        ) : null}
        {recommended.length > 0 ? (
          <>
            <SectionLabel className="px-4 pt-3 pb-1">Recommended</SectionLabel>
            {recommended.map(entry => (
              <WorkflowRow
                key={entry.workflow.name}
                entry={entry}
                selected={entry.workflow.name === selectedName}
                onSelect={onSelect}
              />
            ))}
            {rest.length > 0 ? (
              <SectionLabel className="px-4 pt-3 pb-1">All workflows</SectionLabel>
            ) : null}
          </>
        ) : null}
        {rest.map(entry => (
          <WorkflowRow
            key={entry.workflow.name}
            entry={entry}
            selected={entry.workflow.name === selectedName}
            onSelect={onSelect}
          />
        ))}
      </div>
    </aside>
  );
}
