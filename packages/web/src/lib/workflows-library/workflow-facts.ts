import type { WorkflowDefinition, WorkflowSource } from '@/lib/api';

/** Where a workflow's YAML lives, as the detail header shows it. */
export function workflowFilePath(
  name: string,
  source: WorkflowSource,
  filename?: string | null
): string {
  const file =
    filename !== undefined && filename !== null && filename !== '' ? filename : `${name}.yaml`;
  switch (source) {
    case 'project':
      return `.archon/workflows/${file}`;
    case 'global':
      return `~/.archon/workflows/${file}`;
    default:
      return `defaults/${file}`;
  }
}

/**
 * The workflow's isolation policy, read-only. A run cannot choose isolation:
 * the workflow YAML decides it (`worktree.enabled`, `container.enabled`).
 */
export function isolationPolicy(workflow: Pick<WorkflowDefinition, 'worktree' | 'container'>): {
  label: string;
  note: string;
} {
  if (workflow.container?.enabled === true) {
    return {
      label: 'Runs in a container',
      note: 'Changes come back to the project only after you approve them.',
    };
  }
  if (workflow.worktree?.enabled === false) {
    return {
      label: 'Runs in place',
      note: 'The run edits the project checkout directly.',
    };
  }
  if (workflow.worktree?.enabled === true) {
    return {
      label: 'Runs in a worktree',
      note: 'The run works on its own branch, so the checkout stays untouched.',
    };
  }
  return {
    label: 'Default: worktree',
    note: 'The workflow sets no policy, so the run gets its own worktree.',
  };
}

/** Label of the run input: the declared input names, or free text. */
export function inputLabel(workflow: Pick<WorkflowDefinition, 'inputs'>): string {
  const names = Object.keys(workflow.inputs ?? {});
  return names.length === 0 ? 'Free text' : names.join(', ');
}
