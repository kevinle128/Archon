import type { WorkflowDefinition, WorkflowSource } from '@/lib/api';
import { getWorkflowCategory, getWorkflowDisplayName } from '@/lib/workflow-metadata';
import { cn } from '@/lib/utils';

interface WorkflowCardProps {
  workflow: WorkflowDefinition;
  source: WorkflowSource;
  isSelected: boolean;
  onSelect: (name: string) => void;
}

/** One row of the workflow library list: name, node count, source and category. */
export function WorkflowCard({
  workflow,
  source,
  isSelected,
  onSelect,
}: WorkflowCardProps): React.ReactElement {
  const displayName = getWorkflowDisplayName(workflow.name);
  const category = getWorkflowCategory(workflow.name, workflow.description ?? '');
  const nodeCount = workflow.nodes.length;

  return (
    <button
      type="button"
      title={workflow.name}
      aria-label={`Select workflow: ${displayName}`}
      aria-current={isSelected ? 'true' : undefined}
      onClick={(): void => {
        onSelect(workflow.name);
      }}
      className={cn(
        'grid min-h-16 w-full cursor-pointer gap-1 border-b border-border px-6 py-3 text-left transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset motion-reduce:transition-none',
        isSelected ? 'bg-accent-muted' : 'hover:bg-surface'
      )}
    >
      <span className="truncate font-mono text-sm font-medium text-text-primary">
        {workflow.name}
      </span>
      <span className={cn('text-xs', isSelected ? 'text-text-secondary' : 'text-text-tertiary')}>
        {String(nodeCount)} {nodeCount === 1 ? 'node' : 'nodes'} · {source} · {category}
      </span>
    </button>
  );
}
