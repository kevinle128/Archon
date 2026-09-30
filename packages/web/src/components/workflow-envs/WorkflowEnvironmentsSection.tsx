import { useState, type ReactElement } from 'react';
import { Pencil, Plus, Settings2 } from 'lucide-react';
import { useWorkflowEnvs } from '@/lib/workflow-envs/queries';
import { WorkflowEnvManageDialog, type WorkflowEnvDialogView } from './WorkflowEnvManageDialog';
import { GHOST_BUTTON_CLASS } from './styles';

export interface WorkflowEnvironmentsSectionProps {
  workflowName: string;
  /** Project cwd used for baseline preview; create and edit need one. */
  projectCwd: string | undefined;
}

/**
 * "Environments" block of the workflow detail pane: the named overlays for this
 * workflow with entry points into the manage dialog (create, edit, delete).
 */
export function WorkflowEnvironmentsSection({
  workflowName,
  projectCwd,
}: WorkflowEnvironmentsSectionProps): ReactElement {
  const { data: envs, error, loading } = useWorkflowEnvs(workflowName);
  const [dialog, setDialog] = useState<{ open: boolean; view: WorkflowEnvDialogView }>({
    open: false,
    view: { view: 'list' },
  });
  const needsProject = projectCwd === undefined || projectCwd.length === 0;

  const openDialog = (view: WorkflowEnvDialogView): void => {
    setDialog({ open: true, view });
  };

  return (
    <div className="grid gap-2" data-testid="workflow-envs-section">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text-primary">Environments</h3>
        <div className="-mr-3 flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              openDialog({ view: 'create' });
            }}
            disabled={needsProject}
            title={needsProject ? 'Select a project to create environments.' : undefined}
            className={GHOST_BUTTON_CLASS}
          >
            <Plus className="size-4" strokeWidth={1.75} />
            New environment
          </button>
          <button
            type="button"
            onClick={() => {
              openDialog({ view: 'list' });
            }}
            className={GHOST_BUTTON_CLASS}
          >
            <Settings2 className="size-4" strokeWidth={1.75} />
            Manage
          </button>
        </div>
      </div>
      <p className="-mt-1 max-w-[68ch] text-xs text-text-tertiary">
        Named overlays that change the provider, model or prompt of chosen nodes for one run. The
        workflow YAML is never modified.
      </p>
      {loading && envs === undefined ? (
        <p className="text-sm text-text-tertiary">Loading...</p>
      ) : error !== undefined && envs === undefined ? (
        <p role="alert" className="text-sm text-error">
          Failed to load environments: {error.message}
        </p>
      ) : (envs ?? []).length === 0 ? (
        <p className="text-sm text-text-tertiary">No environments yet.</p>
      ) : (
        <ul className="border-t border-border" data-testid="workflow-env-rows">
          {(envs ?? []).map(env => (
            <li
              key={env.id}
              className="flex items-center justify-between gap-2 border-b border-border py-1"
            >
              <span className="min-w-0 truncate font-mono text-sm text-text-primary">
                {env.name}
              </span>
              <button
                type="button"
                onClick={() => {
                  openDialog({ view: 'edit', envId: env.id });
                }}
                disabled={needsProject}
                aria-label={`Edit environment ${env.name}`}
                title={needsProject ? 'Select a project to edit environments.' : undefined}
                className={GHOST_BUTTON_CLASS}
              >
                <Pencil className="size-4" strokeWidth={1.75} />
                Edit
              </button>
            </li>
          ))}
        </ul>
      )}
      <WorkflowEnvManageDialog
        workflowName={workflowName}
        projectCwd={projectCwd}
        open={dialog.open}
        initialView={dialog.view}
        onClose={() => {
          setDialog(prev => ({ ...prev, open: false }));
        }}
      />
    </div>
  );
}
