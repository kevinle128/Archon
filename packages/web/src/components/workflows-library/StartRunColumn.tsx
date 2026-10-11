import { useEffect, useState } from 'react';
import { Link } from 'react-router';

import { Button } from '@/components/ui/button';
import { SectionLabel } from '@/components/ui/section-label';
import { WorkflowEnvPicker } from '@/components/workflow-envs/WorkflowEnvPicker';
import { WorkflowEnvPreviewTable } from '@/components/workflow-envs/WorkflowEnvPreviewTable';
import { WorkflowEnvironmentsSection } from '@/components/workflow-envs/WorkflowEnvironmentsSection';
import {
  createConversation,
  deleteConversation,
  runWorkflow,
  type CodebaseResponse,
  type WorkflowListEntry,
} from '@/lib/api';
import { projectDisplayName } from '@/lib/projects/display-name';
import { buildRunPath } from '@/lib/runs/run-url';
import { getStatusPresentation, STATUS_TONE_TEXT_CLASS } from '@/lib/status-presentation';
import { cn } from '@/lib/utils';
import { runWorkflowWithEnv } from '@/lib/workflow-envs/api';
import { envStartBlockReason, isStartBlockedBySelectedEnv } from '@/lib/workflow-envs/draft-env';
import { useWorkflowEnvPreview, useWorkflowEnvs } from '@/lib/workflow-envs/queries';
import { useRecentRuns, useStartedRun } from '@/lib/workflows-library/queries';
import { inputLabel, isolationPolicy } from '@/lib/workflows-library/workflow-facts';
import { runNote } from '@/components/runs/RunListRow';

const ENV_NEEDS_PROJECT = 'Select a project to run with an environment.';

const FIELD_LABEL_CLASS = 'flex flex-col gap-1 text-xs font-semibold text-text-secondary';
const CONTROL_CLASS =
  'w-full border border-line-strong bg-card px-2 text-sm text-text-primary placeholder:text-text-tertiary disabled:opacity-50';

interface Started {
  /** Platform id, for the chat link. */
  conversationId: string;
  /** Database id, which the run records as its parent conversation. */
  conversationDbId: string;
  workflow: string;
  projectName: string | null;
  startedAtMs: number;
}

function StartedCard({ started }: { started: Started }): React.ReactElement {
  const { run, gaveUp } = useStartedRun(started.conversationDbId, started.startedAtMs);
  const href =
    run !== null ? buildRunPath(run.id) : `/chat/${encodeURIComponent(started.conversationId)}`;
  return (
    <div
      role="status"
      className="mt-4 border-2 border-accent bg-selection px-4 py-3"
      data-testid="started-run-card"
    >
      <div className="text-[11px] font-bold tracking-[0.08em] text-accent uppercase">
        ▶ {run === null ? 'Starting' : 'Running'}
      </div>
      <div className="mt-0.5 text-sm font-bold break-words">
        {run === null ? 'Waiting for the run id' : run.id.slice(0, 8)} · {started.workflow}
      </div>
      <div className="mt-0.5 text-xs text-text-secondary">
        {started.projectName ?? 'No project'}
        {run?.working_path ? ` · ${run.working_path}` : ''}
      </div>
      <Link to={href} className="mt-2 inline-block text-[13px] font-bold">
        {run !== null || !gaveUp ? 'Follow in Runs →' : 'Open the chat →'}
      </Link>
    </div>
  );
}

function RecentRuns({
  workflowName,
  codebaseId,
  scopeLabel,
}: {
  workflowName: string;
  codebaseId: string | null;
  scopeLabel: string;
}): React.ReactElement {
  const { runs, isLoading } = useRecentRuns(workflowName, codebaseId);
  return (
    <div className="px-6 py-4">
      <div className="flex justify-between gap-2">
        <SectionLabel>Recent runs</SectionLabel>
        <span className="text-[11px] tracking-[0.08em] text-text-secondary uppercase">
          {scopeLabel}
        </span>
      </div>
      {runs.map(run => {
        const presentation = getStatusPresentation(run.status);
        const tone = STATUS_TONE_TEXT_CLASS[presentation.tone];
        const note = runNote(run.user_message);
        return (
          <Link
            key={run.id}
            to={buildRunPath(run.id)}
            className="grid grid-cols-[14px_minmax(0,1fr)_auto] items-baseline gap-2 border-b border-border py-2 text-text-primary no-underline hover:bg-selection"
          >
            <span aria-hidden="true" className={cn('text-xs font-extrabold', tone)}>
              {presentation.glyph}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-bold">
                {run.id.slice(0, 8)}
                {note !== '' ? (
                  <span className="font-normal text-text-secondary"> · {note}</span>
                ) : null}
              </span>
              <span className="block truncate text-[11px] text-text-secondary">
                {run.codebase_name ?? 'No project'}
              </span>
            </span>
            <span className={cn('text-xs font-semibold', tone)}>{presentation.label}</span>
          </Link>
        );
      })}
      {!isLoading && runs.length === 0 ? (
        <p className="py-3 text-[13px] text-text-secondary">No runs of this workflow yet.</p>
      ) : null}
    </div>
  );
}

interface StartRunColumnProps {
  entry: WorkflowListEntry;
  codebases: readonly CodebaseResponse[];
  /** Project picked in the top bar, or null for "All projects". */
  filterProjectId: string | null;
}

/** Right column of the Workflows screen: start a run, environments, recent runs. */
export function StartRunColumn({
  entry,
  codebases,
  filterProjectId,
}: StartRunColumnProps): React.ReactElement {
  const { workflow } = entry;
  const [projectId, setProjectId] = useState<string | null>(filterProjectId);
  const [input, setInput] = useState('');
  const [envId, setEnvId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState<Started | null>(null);

  useEffect(() => {
    setProjectId(filterProjectId);
  }, [filterProjectId]);

  // A different workflow starts from a clean form; an overlay never carries across.
  useEffect(() => {
    setInput('');
    setEnvId(null);
    setError(null);
    setStarted(null);
  }, [workflow.name]);

  const project = projectId === null ? undefined : codebases.find(cb => cb.id === projectId);
  const projectCwd = project?.default_cwd;
  // Previews need a project cwd, so without one an ENV cannot be used and the run falls back to YAML.
  const hasCwd = projectCwd !== undefined && projectCwd.length > 0;
  const effectiveEnvId = hasCwd ? envId : null;
  const { data: envSummaries, error: envListError } = useWorkflowEnvs(workflow.name);
  const {
    data: envPreview,
    error: envPreviewError,
    loading: envPreviewLoading,
  } = useWorkflowEnvPreview(workflow.name, projectCwd, effectiveEnvId);
  const envBlockArgs = {
    selectedEnvId: effectiveEnvId,
    preview: envPreview,
    previewError: envPreviewError,
  };
  const envBlocksRun = isStartBlockedBySelectedEnv(envBlockArgs);
  const envBlockReason = envStartBlockReason(envBlockArgs);
  const isolation = isolationPolicy(workflow);
  const label = inputLabel(workflow);

  const start = async (): Promise<void> => {
    const message = input.trim();
    if (message === '') {
      setError(`Add the ${label === 'Free text' ? 'input' : label} first.`);
      return;
    }
    if (running || envBlocksRun) return;
    setRunning(true);
    setError(null);
    let conversationId: string | undefined;
    let conversationDbId = '';
    let workflowStarted = false;
    try {
      ({ conversationId, id: conversationDbId } = await createConversation(projectId ?? undefined));
      if (effectiveEnvId !== null) {
        await runWorkflowWithEnv(workflow.name, conversationId, message, effectiveEnvId);
      } else {
        await runWorkflow(workflow.name, conversationId, message);
      }
      workflowStarted = true;
      setInput('');
      setStarted({
        conversationId,
        conversationDbId,
        workflow: workflow.name,
        projectName: project !== undefined ? projectDisplayName(project) : null,
        startedAtMs: Date.now(),
      });
    } catch (startError) {
      console.error('[Workflows] Failed to run workflow', { error: startError });
      setError(
        startError instanceof Error
          ? `Failed to start workflow: ${startError.message}`
          : 'Failed to start workflow. Check server connectivity.'
      );
      if (conversationId !== undefined && !workflowStarted) {
        void deleteConversation(conversationId).catch((cleanupErr: unknown) => {
          console.warn('[Workflows] Failed to clean up orphan conversation', {
            conversationId,
            error: cleanupErr,
          });
        });
      }
    } finally {
      setRunning(false);
    }
  };

  const filterProject =
    filterProjectId === null ? undefined : codebases.find(cb => cb.id === filterProjectId);

  return (
    <section aria-label="Start a run" className="flex min-h-0 flex-col overflow-auto bg-background">
      <div className="border-b-2 border-line-strong px-6 py-4">
        <h2 className="text-xl font-extrabold">Start a run</h2>
        <div className="mt-3 flex flex-col gap-3">
          <label className={FIELD_LABEL_CLASS}>
            Project
            <select
              id="workflow-run-project"
              value={projectId ?? ''}
              disabled={running}
              onChange={(event): void => {
                setProjectId(event.target.value === '' ? null : event.target.value);
              }}
              className={cn(CONTROL_CLASS, 'h-9')}
            >
              <option value="">No project</option>
              {codebases.map(cb => (
                <option key={cb.id} value={cb.id}>
                  {projectDisplayName(cb)}
                </option>
              ))}
            </select>
          </label>
          <label className={FIELD_LABEL_CLASS}>
            {label === 'Free text' ? 'Input' : `Input · ${label}`}
            <textarea
              id="workflow-run-message"
              rows={3}
              value={input}
              disabled={running}
              placeholder="Describe the task for this workflow"
              onChange={(event): void => {
                setInput(event.target.value);
                if (error !== null) setError(null);
              }}
              onKeyDown={(event): void => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void start();
                }
              }}
              className={cn(CONTROL_CLASS, 'resize-y py-1.5')}
            />
          </label>
          <div className={FIELD_LABEL_CLASS} title={hasCwd ? undefined : ENV_NEEDS_PROJECT}>
            <span>Environment</span>
            <WorkflowEnvPicker
              envs={envSummaries ?? []}
              value={effectiveEnvId}
              onChange={setEnvId}
              disabled={running || !hasCwd}
              listError={envListError !== undefined}
            />
          </div>
          {effectiveEnvId !== null ? (
            <WorkflowEnvPreviewTable
              preview={envPreview}
              loading={
                envPreviewLoading || (envPreview === undefined && envPreviewError === undefined)
              }
              error={envPreviewError}
              envSelected
            />
          ) : null}
          <div className={FIELD_LABEL_CLASS}>
            Isolation
            <span className="border border-line-strong bg-card px-3 py-2 text-[13px] font-semibold text-text-primary">
              {isolation.label}
            </span>
            <span className="leading-[1.45] font-normal">{isolation.note}</span>
          </div>
          {envBlockReason !== null && error === null ? (
            <p className="text-xs text-text-secondary">{envBlockReason}</p>
          ) : null}
          {error !== null ? (
            <p role="alert" className="text-[13px] font-semibold text-error">
              {error}
            </p>
          ) : null}
          <Button
            size="lg"
            className="h-10 justify-between"
            disabled={running || envBlocksRun}
            onClick={(): void => {
              void start();
            }}
          >
            {running ? 'Starting…' : 'Start run'}
            <span aria-hidden="true">→</span>
          </Button>
        </div>
        {started !== null ? <StartedCard started={started} /> : null}
      </div>
      <div className="border-b border-border px-6 py-4">
        <WorkflowEnvironmentsSection workflowName={workflow.name} projectCwd={projectCwd} />
      </div>
      <RecentRuns
        workflowName={workflow.name}
        codebaseId={filterProjectId}
        scopeLabel={
          filterProject !== undefined ? projectDisplayName(filterProject) : 'All projects'
        }
      />
    </section>
  );
}
