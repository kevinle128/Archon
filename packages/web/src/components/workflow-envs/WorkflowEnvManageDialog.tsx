/**
 * Workflow-specific ENV management dialog. Semantics are install-wide overlay
 * CRUD driven by server baseline preview targets, never a client-side field
 * matrix. The workflows library opens it in list, create or edit view.
 */
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { deleteWorkflowEnv, type WorkflowEnvSummary } from '@/lib/workflow-envs/api';
import {
  LOOP_GROUP_BODY_NOTE,
  PLAINTEXT_NOTICE,
  formatWorkflowEnvActionError,
} from '@/lib/workflow-envs/editor';
import {
  invalidateWorkflowEnvQueries,
  useWorkflowEnvPreview,
  useWorkflowEnvs,
} from '@/lib/workflow-envs/queries';
import { WorkflowEnvEditorView } from './WorkflowEnvEditor';
import { GHOST_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from './styles';

export type WorkflowEnvDialogView =
  | { view: 'list' }
  | { view: 'create' }
  | { view: 'edit'; envId: string };

export interface WorkflowEnvManageDialogProps {
  workflowName: string;
  /** Project cwd. Baseline preview targets need it, so create and edit are disabled without one. */
  projectCwd: string | undefined;
  open: boolean;
  onClose: () => void;
  /** View to show each time the dialog opens. Defaults to the list. */
  initialView?: WorkflowEnvDialogView;
}

const NO_PROJECT_HINT = 'Select a project to create or edit environments.';

/** Modal shell. The body mounts only while open so list and preview queries refresh on each open. */
export function WorkflowEnvManageDialog({
  workflowName,
  projectCwd,
  open,
  onClose,
  initialView = { view: 'list' },
}: WorkflowEnvManageDialogProps): ReactElement {
  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        className="flex max-h-[90vh] max-w-[720px] flex-col overflow-hidden rounded-xl p-6 shadow-none"
        aria-label={`Workflow ENVs for ${workflowName}`}
      >
        <DialogHeader className="shrink-0 gap-1 text-left">
          <DialogTitle className="text-xl">Environments</DialogTitle>
          <DialogDescription>
            Named install-wide overlays for{' '}
            <span className="font-mono text-text-primary">{workflowName}</span>. Patches apply when
            a run starts; the YAML on disk is never modified.
          </DialogDescription>
        </DialogHeader>
        <WorkflowEnvManageBody
          workflowName={workflowName}
          projectCwd={projectCwd}
          initialView={initialView}
          onClose={onClose}
        />
      </DialogContent>
    </Dialog>
  );
}

interface BodyProps {
  workflowName: string;
  projectCwd: string | undefined;
  initialView: WorkflowEnvDialogView;
  onClose: () => void;
}

function WorkflowEnvManageBody({
  workflowName,
  projectCwd,
  initialView,
  onClose,
}: BodyProps): ReactElement {
  const queryClient = useQueryClient();

  // Drop the list and preview caches on open so the dialog reflects external
  // edits (CLI or another session) instead of stale in-memory rows.
  useEffect(() => {
    invalidateWorkflowEnvQueries(queryClient, workflowName);
  }, [queryClient, workflowName]);

  const { data: summaries, error: listError, loading: listLoading } = useWorkflowEnvs(workflowName);

  // Baseline preview (no envId): server-authoritative targets and allowed fields.
  const {
    data: baseline,
    error: baselineError,
    loading: baselineLoading,
  } = useWorkflowEnvPreview(workflowName, projectCwd, null);
  const needsProject = projectCwd === undefined || projectCwd.length === 0;
  const targets = baseline?.targets ?? [];
  const targetsError = needsProject ? new Error(NO_PROJECT_HINT) : baselineError;

  const [view, setView] = useState<WorkflowEnvDialogView>(initialView);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const backToList = useCallback((): void => {
    setView({ view: 'list' });
    setActionError(null);
  }, []);

  const remove = async (env: WorkflowEnvSummary): Promise<void> => {
    setActionError(null);
    setBusy(true);
    try {
      await deleteWorkflowEnv(workflowName, env.id);
      invalidateWorkflowEnvQueries(queryClient, workflowName);
    } catch (err: unknown) {
      setActionError(formatWorkflowEnvActionError(err));
    } finally {
      setPendingDeleteId(null);
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {view.view === 'list' ? (
          <ListView
            summaries={summaries}
            listLoading={listLoading}
            listError={listError}
            busy={busy}
            needsProject={needsProject}
            pendingDeleteId={pendingDeleteId}
            onCreate={() => {
              setActionError(null);
              setView({ view: 'create' });
            }}
            onEdit={envId => {
              setActionError(null);
              setView({ view: 'edit', envId });
            }}
            onAskDelete={setPendingDeleteId}
            onDelete={env => {
              void remove(env);
            }}
          />
        ) : (
          <WorkflowEnvEditorView
            mode={view.view === 'create' ? 'create' : 'edit'}
            workflowName={workflowName}
            envId={view.view === 'edit' ? view.envId : null}
            targets={targets}
            targetsLoading={
              !needsProject &&
              (baselineLoading || (baseline === undefined && baselineError === undefined))
            }
            targetsError={targetsError}
            busy={busy}
            setBusy={setBusy}
            actionError={actionError}
            setActionError={setActionError}
            onCancel={backToList}
            onSaved={() => {
              invalidateWorkflowEnvQueries(queryClient, workflowName);
              backToList();
            }}
          />
        )}
      </div>

      {actionError !== null && view.view === 'list' ? (
        <p role="alert" className="shrink-0 text-sm text-error">
          {actionError}
        </p>
      ) : null}

      <div className="grid shrink-0 gap-2">
        <p
          className="rounded-xl border border-border bg-surface px-4 py-3 text-xs leading-relaxed text-text-secondary"
          data-testid="env-plaintext-notice"
        >
          {PLAINTEXT_NOTICE}
        </p>
        <p className="text-xs leading-relaxed text-text-tertiary" data-testid="env-loop-group-note">
          {LOOP_GROUP_BODY_NOTE}
        </p>
      </div>

      {view.view === 'list' ? (
        <div className="flex shrink-0 justify-end">
          <button type="button" onClick={onClose} className={SECONDARY_BUTTON_CLASS}>
            Close
          </button>
        </div>
      ) : null}
    </div>
  );
}

interface ListViewProps {
  summaries: WorkflowEnvSummary[] | undefined;
  listLoading: boolean;
  listError: Error | undefined;
  busy: boolean;
  needsProject: boolean;
  pendingDeleteId: string | null;
  onCreate: () => void;
  onEdit: (envId: string) => void;
  onAskDelete: (envId: string | null) => void;
  onDelete: (env: WorkflowEnvSummary) => void;
}

function ListView({
  summaries,
  listLoading,
  listError,
  busy,
  needsProject,
  pendingDeleteId,
  onCreate,
  onEdit,
  onAskDelete,
  onDelete,
}: ListViewProps): ReactElement {
  if (listLoading && summaries === undefined) {
    return <p className="text-sm text-text-tertiary">Loading...</p>;
  }
  if (listError !== undefined && summaries === undefined) {
    return (
      <p role="alert" className="text-sm text-error">
        {listError.message}
      </p>
    );
  }

  const rows = summaries ?? [];
  return (
    <div className="grid gap-3">
      <ul
        className="max-h-[36vh] divide-y divide-border overflow-y-auto rounded-xl border border-border bg-surface"
        data-testid="env-summary-list"
      >
        {rows.length === 0 ? (
          <li className="px-6 py-6 text-center text-sm text-text-tertiary">No environments yet.</li>
        ) : (
          rows.map(env => (
            <li key={env.id} className="flex items-center justify-between gap-2 py-2 pl-4 pr-2">
              <div className="min-w-0">
                <span className="block truncate font-mono text-sm text-text-primary">
                  {env.name}
                </span>
                <span className="block truncate font-mono text-xs text-text-tertiary">
                  {env.id}
                </span>
              </div>
              {pendingDeleteId === env.id ? (
                <div className="flex shrink-0 items-center gap-1">
                  <span className="text-xs text-text-secondary">Delete {env.name}?</span>
                  <button
                    type="button"
                    onClick={() => {
                      onDelete(env);
                    }}
                    disabled={busy}
                    className={cn(GHOST_BUTTON_CLASS, 'text-error hover:text-error')}
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onAskDelete(null);
                    }}
                    disabled={busy}
                    className={GHOST_BUTTON_CLASS}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      onEdit(env.id);
                    }}
                    disabled={busy || needsProject}
                    title={needsProject ? NO_PROJECT_HINT : `Edit ${env.name}`}
                    aria-label={`Edit ${env.name}`}
                    className={GHOST_BUTTON_CLASS}
                  >
                    <Pencil className="size-4" strokeWidth={1.75} />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onAskDelete(env.id);
                    }}
                    disabled={busy}
                    title={`Delete ${env.name}`}
                    aria-label={`Delete ${env.name}`}
                    className={cn(GHOST_BUTTON_CLASS, 'w-11 px-0 hover:text-error')}
                  >
                    <Trash2 className="size-4" strokeWidth={1.75} />
                  </button>
                </div>
              )}
            </li>
          ))
        )}
      </ul>
      <button
        type="button"
        onClick={onCreate}
        disabled={busy || needsProject}
        className={cn(SECONDARY_BUTTON_CLASS, 'w-full border-dashed')}
      >
        <Plus className="size-4" strokeWidth={1.75} />
        Create environment
      </button>
      {needsProject ? <p className="text-xs text-text-tertiary">{NO_PROJECT_HINT}</p> : null}
    </div>
  );
}
