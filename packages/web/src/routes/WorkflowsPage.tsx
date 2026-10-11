import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { StartRunColumn } from '@/components/workflows-library/StartRunColumn';
import { WorkflowDetailColumn } from '@/components/workflows-library/WorkflowDetailColumn';
import { WorkflowsListColumn } from '@/components/workflows-library/WorkflowsListColumn';
import { partitionWorkflows } from '@/components/workflows/partition-workflows';
import { useProject } from '@/contexts/ProjectContext';
import { listWorkflows, type WorkflowListEntry } from '@/lib/api';
import { getWorkflowCategory, type WorkflowCategory } from '@/lib/workflow-metadata';

/** Workflows screen: library list, workflow detail, and the start-a-run column. */
export function WorkflowsPage(): React.ReactElement {
  const { codebases, selectedProjectId } = useProject();
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<WorkflowCategory>('All');

  const listCwd =
    selectedProjectId === null
      ? undefined
      : codebases?.find(cb => cb.id === selectedProjectId)?.default_cwd;

  const { data, isLoading, isError } = useQuery({
    queryKey: ['workflows', listCwd ?? null],
    queryFn: () => listWorkflows(listCwd),
  });
  const entries = useMemo(() => data?.workflows ?? [], [data?.workflows]);

  // Search narrows first; category counts come from the searched set so each tab
  // shows how many rows it would reveal.
  const { searched, recommended, rest } = useMemo(() => {
    const text = query.trim().toLowerCase();
    const searchedEntries = entries.filter(({ workflow }) => {
      if (text === '') return true;
      return (
        workflow.name.toLowerCase().includes(text) ||
        workflow.description.toLowerCase().includes(text)
      );
    });
    const visible = searchedEntries.filter(
      ({ workflow }) =>
        category === 'All' || getWorkflowCategory(workflow.name, workflow.description) === category
    );
    const parts = partitionWorkflows(
      visible.map(entry => ({ ...entry, name: entry.workflow.name })),
      data?.recommended ?? []
    );
    return { searched: searchedEntries, recommended: parts.recommended, rest: parts.rest };
  }, [entries, query, category, data?.recommended]);

  const visible: WorkflowListEntry[] = [...recommended, ...rest];
  // The detail column is never empty while the list has rows: fall back to the first row.
  const selected =
    visible.find(entry => entry.workflow.name === selectedName) ?? visible[0] ?? null;

  const status = isLoading ? (
    <p className="p-4 text-[13px] text-text-secondary">Loading workflows…</p>
  ) : isError ? (
    <p className="p-4 text-[13px] text-error">
      Failed to load workflows. Check server connectivity.
    </p>
  ) : entries.length === 0 ? (
    <p className="p-4 text-[13px] text-text-secondary">
      {selectedProjectId !== null
        ? 'No workflows in this project. Add definitions to .archon/workflows/ in the project root.'
        : 'No workflows are available. Check that defaults.loadDefaultWorkflows is enabled.'}
    </p>
  ) : null;

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(240px,300px)_minmax(0,1fr)_minmax(300px,380px)]">
      <WorkflowsListColumn
        searched={searched}
        recommended={recommended}
        rest={rest}
        total={entries.length}
        selectedName={selected?.workflow.name ?? null}
        onSelect={setSelectedName}
        query={query}
        onQueryChange={setQuery}
        category={category}
        onCategoryChange={setCategory}
        status={status}
      />
      {selected !== null ? (
        <>
          <WorkflowDetailColumn
            key={selected.workflow.name}
            entry={selected}
            projectCwd={listCwd ?? null}
            listCwd={listCwd}
          />
          <StartRunColumn
            entry={selected}
            codebases={codebases ?? []}
            filterProjectId={selectedProjectId}
          />
        </>
      ) : null}
    </div>
  );
}
