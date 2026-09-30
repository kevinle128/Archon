import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronRight, Play, Redo2, Undo2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { listWorkflows } from '@/lib/api';
import { useProject } from '@/contexts/ProjectContext';
import { useProviders } from '@/hooks/useProviders';

export type ViewMode = 'hidden' | 'split' | 'full';

export interface BuilderToolbarProps {
  workflowName: string;
  workflowDescription: string;
  provider: string | undefined;
  model: string | undefined;
  hasUnsavedChanges: boolean;
  validationErrors: string[];
  viewMode: ViewMode;
  onNameChange: (name: string) => void;
  onDescriptionChange: (desc: string) => void;
  onProviderChange: (p: string | undefined) => void;
  onModelChange: (m: string | undefined) => void;
  onViewModeChange: (mode: ViewMode) => void;
  onValidate: () => void;
  onSave: () => void;
  onRun: () => void;
  onLoadWorkflow: (name: string) => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
}

const VIEW_MODE_LABELS: readonly { value: ViewMode; label: string }[] = [
  { value: 'hidden', label: 'Graph' },
  { value: 'split', label: 'Split' },
  { value: 'full', label: 'YAML' },
];

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-background';
const controlBase = `inline-flex h-10 items-center justify-center gap-2 rounded-[10px] px-3 text-sm font-medium cursor-pointer transition-colors duration-200 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;
const iconButton = `inline-flex size-10 items-center justify-center rounded-[10px] text-text-secondary cursor-pointer transition-colors duration-200 motion-reduce:transition-none hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent ${focusRing}`;
const fieldClass = `h-10 rounded-[10px] border border-border bg-surface px-2.5 text-sm text-text-primary placeholder:text-text-tertiary ${focusRing}`;

export function BuilderToolbar({
  workflowName,
  workflowDescription,
  provider,
  model,
  hasUnsavedChanges,
  validationErrors,
  viewMode,
  onNameChange,
  onDescriptionChange,
  onProviderChange,
  onModelChange,
  onViewModeChange,
  onValidate,
  onSave,
  onRun,
  onLoadWorkflow,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
}: BuilderToolbarProps): React.ReactElement {
  const navigate = useNavigate();
  const { codebases, selectedProjectId } = useProject();
  const cwd = selectedProjectId
    ? codebases?.find(cb => cb.id === selectedProjectId)?.default_cwd
    : undefined;

  const { providers } = useProviders();
  const [showDescription, setShowDescription] = useState(false);

  const { data: workflowsResult, isError: workflowsError } = useQuery({
    queryKey: ['workflows', cwd],
    queryFn: () => listWorkflows(cwd),
  });
  const workflows = workflowsResult?.workflows;

  const invalidCount = validationErrors.length;

  return (
    <>
      <div className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-background px-4 py-2">
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5">
          <button
            type="button"
            onClick={(): void => {
              navigate('/workflows');
            }}
            className={cn(
              'shrink-0 rounded-md px-1 text-sm text-text-secondary cursor-pointer transition-colors duration-200 hover:text-text-primary',
              focusRing
            )}
          >
            Workflows
          </button>
          <ChevronRight className="size-4 shrink-0 text-text-tertiary" aria-hidden="true" />
          <input
            type="text"
            aria-label="Workflow name"
            value={workflowName}
            onChange={(e): void => {
              onNameChange(e.target.value);
            }}
            placeholder="workflow-name"
            className={cn(
              'h-10 w-56 min-w-[120px] max-w-[280px] rounded-[10px] border border-transparent bg-transparent px-2 font-mono text-sm font-semibold text-text-primary placeholder:text-text-tertiary hover:border-border',
              focusRing
            )}
          />
          {hasUnsavedChanges && (
            <span className="shrink-0 text-xs font-medium text-warning">Unsaved changes</span>
          )}
        </nav>

        {showDescription ? (
          <input
            type="text"
            aria-label="Workflow description"
            value={workflowDescription}
            onChange={(e): void => {
              onDescriptionChange(e.target.value);
            }}
            onBlur={(): void => {
              setShowDescription(false);
            }}
            autoFocus
            placeholder="Description"
            className={cn(fieldClass, 'w-56')}
          />
        ) : (
          <button
            type="button"
            onClick={(): void => {
              setShowDescription(true);
            }}
            className={cn(
              'max-w-[160px] shrink-0 truncate rounded-md px-1 text-xs text-text-tertiary cursor-pointer transition-colors duration-200 hover:text-text-secondary',
              focusRing
            )}
            title={workflowDescription || 'Add description'}
          >
            {workflowDescription || 'Add description'}
          </button>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select
            value=""
            aria-label="Load workflow"
            onChange={(e): void => {
              if (e.target.value) onLoadWorkflow(e.target.value);
            }}
            className={cn(fieldClass, 'w-20 shrink-0 text-text-secondary cursor-pointer')}
            title={
              workflowsError
                ? 'Failed to load workflows — check server connection'
                : 'Load workflow'
            }
          >
            <option value="">{workflowsError ? 'Load failed' : 'Load...'}</option>
            {(workflows ?? []).map(entry => (
              <option key={entry.workflow.name} value={entry.workflow.name}>
                {entry.workflow.name}
              </option>
            ))}
          </select>

          <select
            value={provider ?? ''}
            aria-label="Provider"
            onChange={(e): void => {
              onProviderChange(e.target.value || undefined);
            }}
            className={cn(fieldClass, 'w-44 cursor-pointer')}
          >
            <option value="">Provider</option>
            {providers.map(p => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
          </select>

          <input
            type="text"
            aria-label="Model"
            value={model ?? ''}
            onChange={(e): void => {
              onModelChange(e.target.value || undefined);
            }}
            placeholder="Model"
            className={cn(fieldClass, 'w-24 font-mono')}
          />

          <div
            role="group"
            aria-label="View mode"
            className="flex h-10 items-center gap-0.5 rounded-[10px] border border-border bg-surface p-0.5"
          >
            {VIEW_MODE_LABELS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                aria-pressed={viewMode === value}
                onClick={(): void => {
                  onViewModeChange(value);
                }}
                className={cn(
                  'h-full rounded-lg px-3 text-sm font-medium cursor-pointer transition-colors duration-200 motion-reduce:transition-none',
                  focusRing,
                  viewMode === value
                    ? 'bg-accent-muted text-text-primary'
                    : 'text-text-secondary hover:text-text-primary'
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <button
            type="button"
            aria-label="Undo"
            title="Undo"
            onClick={onUndo}
            disabled={!canUndo}
            className={iconButton}
          >
            <Undo2 className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Redo"
            title="Redo"
            onClick={onRedo}
            disabled={!canRedo}
            className={iconButton}
          >
            <Redo2 className="size-4" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={onValidate}
            className={cn(
              controlBase,
              'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
            )}
          >
            <Check className="size-4" aria-hidden="true" />
            Validate
            {invalidCount > 0 && (
              <span
                className="rounded-full bg-error/15 px-1.5 text-xs font-medium text-error"
                aria-label={`${String(invalidCount)} problems`}
              >
                {invalidCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={onRun}
            disabled={!workflowName.trim() || hasUnsavedChanges}
            title={hasUnsavedChanges ? 'Save the workflow before running' : undefined}
            className={cn(
              controlBase,
              'border border-border bg-surface text-text-primary hover:bg-surface-hover'
            )}
          >
            <Play className="size-4" aria-hidden="true" />
            Run
          </button>

          <button
            type="button"
            onClick={onSave}
            disabled={!workflowName.trim()}
            className={cn(
              controlBase,
              'min-w-20 bg-accent px-4 text-accent-foreground hover:bg-accent-hover'
            )}
          >
            Save
          </button>
        </div>
      </div>

      {workflowsError && (
        <div className="border-b border-border bg-surface-inset px-4 py-1.5 text-xs text-error">
          Failed to load workflow list. The load dropdown may be empty.
        </div>
      )}
    </>
  );
}
