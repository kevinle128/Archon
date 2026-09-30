import { useEffect, useRef, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Play, Plus, Search } from 'lucide-react';
import {
  listWorkflows,
  createConversation,
  runWorkflow,
  deleteConversation,
  type DagNode,
  type WorkflowDefinition,
  type WorkflowSource,
} from '@/lib/api';
import { useProject } from '@/contexts/ProjectContext';
import { WorkflowCard } from '@/components/workflows/WorkflowCard';
import { WorkflowEnvPicker } from '@/components/workflow-envs/WorkflowEnvPicker';
import { WorkflowEnvPreviewTable } from '@/components/workflow-envs/WorkflowEnvPreviewTable';
import { WorkflowEnvironmentsSection } from '@/components/workflow-envs/WorkflowEnvironmentsSection';
import { runWorkflowWithEnv } from '@/lib/workflow-envs/api';
import { envStartBlockReason, isStartBlockedBySelectedEnv } from '@/lib/workflow-envs/draft-env';
import { useWorkflowEnvPreview, useWorkflowEnvs } from '@/lib/workflow-envs/queries';
import { partitionWorkflows } from '@/components/workflows/partition-workflows';
import { cn } from '@/lib/utils';
import {
  getWorkflowCategory,
  getWorkflowDisplayName,
  parseWorkflowDescription,
  CATEGORIES,
  type WorkflowCategory,
} from '@/lib/workflow-metadata';

interface WorkflowEntry {
  workflow: WorkflowDefinition;
  source: WorkflowSource;
}

const ENV_NEEDS_PROJECT = 'Select a project to run with an environment.';

const CONTROL_CLASS =
  'min-h-11 w-full rounded-[10px] border border-border bg-background px-3 text-sm text-text-primary placeholder:text-text-tertiary outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none disabled:opacity-50';

/** Body kind of a DAG node, in the same precedence the engine uses to pick a node type. */
function nodeKind(node: DagNode): string {
  if (node.route_loop !== undefined) return 'route_loop';
  if (node.loop_group !== undefined) return 'loop_group';
  if (node.loop !== undefined) return 'loop';
  if (node.plannotator_gate !== undefined) return 'plannotator';
  if (node.approval !== undefined) return 'approval';
  if (node.bash !== undefined) return 'bash';
  if (node.script !== undefined) return 'script';
  if (node.workflow !== undefined) return 'workflow';
  if (node.command !== undefined) return 'command';
  if (node.prompt !== undefined) return 'prompt';
  return 'node';
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="grid gap-2">
      <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
      {children}
    </div>
  );
}

interface WorkflowDetailProps {
  entry: WorkflowEntry;
  runMessage: string;
  onRunMessageChange: (value: string) => void;
  projectId: string | null;
  onProjectChange: (id: string | null) => void;
  /** Project cwd of the chosen project; ENV previews and editing need it. */
  projectCwd: string | undefined;
  /** Selected ENV overlay id for this workflow, or null for the plain YAML. */
  envId: string | null;
  onEnvChange: (envId: string | null) => void;
  running: boolean;
  runError: string | null;
  onRun: (envId: string | null) => void;
}

function WorkflowDetail({
  entry,
  runMessage,
  onRunMessageChange,
  projectId,
  onProjectChange,
  projectCwd,
  envId,
  onEnvChange,
  running,
  runError,
  onRun,
}: WorkflowDetailProps): React.ReactElement {
  const { codebases } = useProject();
  const { workflow, source } = entry;
  const parsed = parseWorkflowDescription(workflow.description ?? '');
  const category = getWorkflowCategory(workflow.name, workflow.description ?? '');
  const hasSections = parsed.whenToUse || parsed.does || parsed.constraints;
  const whenText = parsed.whenToUse || (hasSections ? '' : (workflow.description ?? ''));

  const kindCounts = new Map<string, number>();
  for (const node of workflow.nodes) {
    const kind = nodeKind(node);
    kindCounts.set(kind, (kindCounts.get(kind) ?? 0) + 1);
  }
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
  const kindSummary = [...kindCounts.entries()].map(([k, n]) => `${String(n)} ${k}`).join(', ');

  return (
    <div className="grid max-w-[800px] gap-8 px-12 py-10 max-[1100px]:px-8">
      <div className="grid gap-2">
        <span className="text-xs text-text-secondary">
          {category} · {source}
        </span>
        <h2 className="text-[28px] font-semibold leading-tight text-text-primary">
          {getWorkflowDisplayName(workflow.name)}
        </h2>
        <span className="font-mono text-sm text-text-secondary">{workflow.name}</span>
      </div>

      <div className="grid gap-2">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2 max-[1100px]:grid-cols-1">
          <label className="sr-only" htmlFor="workflow-run-message">
            Message for this workflow
          </label>
          <input
            id="workflow-run-message"
            type="text"
            value={runMessage}
            onChange={(e): void => {
              onRunMessageChange(e.target.value);
            }}
            placeholder="Describe the task for this workflow"
            className={CONTROL_CLASS}
            disabled={running}
            onKeyDown={(e): void => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!envBlocksRun) onRun(effectiveEnvId);
              }
            }}
          />
          <button
            type="button"
            onClick={(): void => {
              onRun(effectiveEnvId);
            }}
            disabled={running || !runMessage.trim() || envBlocksRun}
            className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-[10px] bg-accent px-4 text-sm font-medium text-on-accent outline-none transition-opacity duration-150 hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
          >
            <Play className="size-4" strokeWidth={1.75} />
            {running ? 'Starting...' : 'Run'}
          </button>
          <Link
            to={`/workflows/builder?edit=${encodeURIComponent(workflow.name)}`}
            className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-[10px] border border-border bg-background px-4 text-sm font-medium text-text-primary outline-none transition-colors duration-150 hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
          >
            Edit in Builder
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-text-secondary">
          <div className="flex items-center gap-2">
            <label htmlFor="workflow-run-project">Project</label>
            <div className="relative w-56">
              <select
                id="workflow-run-project"
                value={projectId ?? ''}
                onChange={(e): void => {
                  onProjectChange(e.target.value || null);
                }}
                className={cn(CONTROL_CLASS, 'appearance-none pr-9')}
              >
                <option value="">No project</option>
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
          </div>
          <div className="flex items-center gap-2" title={hasCwd ? undefined : ENV_NEEDS_PROJECT}>
            <span aria-hidden>Environment</span>
            <WorkflowEnvPicker
              envs={envSummaries ?? []}
              value={effectiveEnvId}
              onChange={onEnvChange}
              disabled={running || !hasCwd}
              listError={envListError !== undefined}
            />
          </div>
        </div>
        {effectiveEnvId !== null && (
          <WorkflowEnvPreviewTable
            preview={envPreview}
            loading={
              envPreviewLoading || (envPreview === undefined && envPreviewError === undefined)
            }
            error={envPreviewError}
            envSelected
          />
        )}
        {envBlockReason !== null && !runError && (
          <p className="text-xs text-text-tertiary">{envBlockReason}</p>
        )}
        {runError && (
          <p role="alert" className="text-xs text-error">
            {runError}
          </p>
        )}
      </div>

      <WorkflowEnvironmentsSection workflowName={workflow.name} projectCwd={projectCwd} />

      {whenText && (
        <DetailSection title="When to use">
          <p className="max-w-[68ch] text-base leading-relaxed text-text-secondary">{whenText}</p>
        </DetailSection>
      )}
      {parsed.triggers.length > 0 && (
        <DetailSection title="Triggers">
          <div className="flex flex-wrap gap-2">
            {parsed.triggers.map(trigger => (
              <span
                key={trigger}
                className="inline-flex h-6 items-center rounded-full border border-border px-2.5 text-xs text-text-secondary"
              >
                {trigger}
              </span>
            ))}
          </div>
        </DetailSection>
      )}
      {parsed.does && (
        <DetailSection title="Does">
          <p className="max-w-[68ch] text-base leading-relaxed text-text-secondary">
            {parsed.does}
          </p>
        </DetailSection>
      )}
      {parsed.constraints && (
        <DetailSection title="Not for">
          <p className="max-w-[68ch] text-base leading-relaxed text-text-secondary">
            {parsed.constraints}
          </p>
        </DetailSection>
      )}

      <DetailSection title="Nodes">
        <p className="-mt-1 text-xs text-text-tertiary">
          {String(workflow.nodes.length)}
          {kindSummary ? ` · ${kindSummary}` : ''}
        </p>
        <ol className="border-t border-border">
          {workflow.nodes.map((node, index) => {
            const deps = node.depends_on ?? [];
            const model = [node.provider, node.model].filter(Boolean).join(' ');
            return (
              <li
                key={node.id}
                className="grid grid-cols-[32px_72px_minmax(0,1fr)] items-baseline gap-4 border-b border-border py-3"
              >
                <span className="font-mono text-xs text-text-tertiary">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="font-mono text-xs text-text-tertiary">{nodeKind(node)}</span>
                <span className="min-w-0">
                  <span className="block truncate font-mono text-sm text-text-primary">
                    {node.id}
                  </span>
                  <span className="block text-xs text-text-tertiary">
                    {deps.length > 0 ? `after ${deps.join(', ')}` : 'entry node'} ·{' '}
                    {model || 'inherits model'}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      </DetailSection>
    </div>
  );
}

export function WorkflowList(): React.ReactElement {
  const navigate = useNavigate();
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [runMessage, setRunMessage] = useState('');
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  // The overlay choice is stored with its workflow name so switching workflows
  // (including the list's fallback selection) never carries an overlay across.
  const [envChoice, setEnvChoice] = useState<{ workflow: string; envId: string | null } | null>(
    null
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<WorkflowCategory>('All');
  const { codebases, selectedProjectId } = useProject();
  const [localProjectId, setLocalProjectId] = useState<string | null>(selectedProjectId);
  const detailRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLocalProjectId(selectedProjectId);
  }, [selectedProjectId]);

  const selectWorkflow = (name: string): void => {
    setSelectedName(name);
    setRunMessage('');
    setRunError(null);
    detailRef.current?.scrollTo({ top: 0 });
  };

  const handleRun = async (workflowName: string, envId: string | null): Promise<void> => {
    if (!runMessage.trim() || running) return;
    setRunning(true);
    setRunError(null);
    let conversationId: string | undefined;
    let workflowStarted = false;
    try {
      ({ conversationId } = await createConversation(localProjectId ?? undefined));
      const message = runMessage.trim();
      if (envId !== null) {
        await runWorkflowWithEnv(workflowName, conversationId, message, envId);
      } else {
        await runWorkflow(workflowName, conversationId, message);
      }
      workflowStarted = true;
      setRunMessage('');
      navigate(`/chat/${conversationId}`);
    } catch (error) {
      console.error('[Workflows] Failed to run workflow', { error });
      setRunError(
        error instanceof Error
          ? `Failed to start workflow: ${error.message}`
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

  const selectedCwd = localProjectId
    ? codebases?.find(cb => cb.id === localProjectId)?.default_cwd
    : undefined;

  const {
    data: workflowsResult,
    isLoading: loadingWorkflows,
    isError: workflowsError,
  } = useQuery({
    queryKey: ['workflows', selectedCwd ?? null],
    queryFn: () => listWorkflows(selectedCwd),
  });

  const entries = workflowsResult?.workflows;
  const recommendedNames = workflowsResult?.recommended ?? [];

  // Search narrows the list first; category counts are computed over the searched
  // set so each tab shows how many rows it would reveal.
  const { searched, categoryCounts, filtered, recommended, rest } = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const searchedEntries = (entries ?? []).filter(({ workflow: wf }) => {
      if (!query) return true;
      return (
        wf.name.toLowerCase().includes(query) ||
        (wf.description?.toLowerCase().includes(query) ?? false)
      );
    });
    const counts = new Map<WorkflowCategory, number>();
    for (const cat of CATEGORIES) counts.set(cat, 0);
    for (const { workflow: wf } of searchedEntries) {
      const cat = getWorkflowCategory(wf.name, wf.description ?? '');
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
      counts.set('All', (counts.get('All') ?? 0) + 1);
    }
    const visible = searchedEntries.filter(
      ({ workflow: wf }) =>
        activeCategory === 'All' ||
        getWorkflowCategory(wf.name, wf.description ?? '') === activeCategory
    );
    const parts = partitionWorkflows(
      visible.map(e => ({ ...e, name: e.workflow.name })),
      recommendedNames
    );
    return {
      searched: searchedEntries,
      categoryCounts: counts,
      filtered: visible,
      recommended: parts.recommended,
      rest: parts.rest,
    };
  }, [entries, searchQuery, activeCategory, recommendedNames]);

  if (loadingWorkflows) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-text-secondary">
        Loading workflows...
      </div>
    );
  }

  if (workflowsError) {
    return (
      <div className="p-6 text-sm text-error">
        Failed to load workflows. Check server connectivity.
      </div>
    );
  }

  const hasWorkflows = entries != null && entries.length > 0;
  // Fall back to the first visible row so the detail pane is never empty while a list exists.
  const selectedEntry = filtered.find(e => e.workflow.name === selectedName) ?? filtered[0] ?? null;
  const renderRow = (e: WorkflowEntry): React.ReactElement => (
    <WorkflowCard
      key={e.workflow.name}
      workflow={e.workflow}
      source={e.source}
      isSelected={selectedEntry?.workflow.name === e.workflow.name}
      onSelect={selectWorkflow}
    />
  );

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[360px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] max-[1100px]:grid-cols-[320px_minmax(0,1fr)]">
      <div className="flex min-h-0 flex-col border-r border-border">
        <div className="grid gap-4 px-6 pb-2 pt-8">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-[28px] font-semibold leading-tight text-text-primary">Workflows</h1>
            <Link
              to="/workflows/builder"
              className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-[10px] px-3 text-sm font-medium text-text-secondary outline-none transition-colors duration-150 hover:bg-surface hover:text-text-primary focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
            >
              <Plus className="size-4" strokeWidth={1.75} />
              New
            </Link>
          </div>
          {hasWorkflows && (
            <>
              <div className="relative">
                <label className="sr-only" htmlFor="workflow-search">
                  Search workflows
                </label>
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-tertiary"
                  strokeWidth={1.75}
                />
                <input
                  id="workflow-search"
                  type="search"
                  value={searchQuery}
                  onChange={(e): void => {
                    setSearchQuery(e.target.value);
                  }}
                  placeholder="Search workflows"
                  className={cn(CONTROL_CLASS, 'pl-9')}
                />
              </div>
              <div role="tablist" aria-label="Category" className="-mx-3 flex flex-wrap gap-1">
                {CATEGORIES.map(cat => (
                  <button
                    key={cat}
                    type="button"
                    role="tab"
                    aria-selected={activeCategory === cat}
                    onClick={(): void => {
                      setActiveCategory(cat);
                    }}
                    className={cn(
                      'inline-flex min-h-11 cursor-pointer items-center gap-2 border-b-2 px-3 text-sm font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none',
                      activeCategory === cat
                        ? 'border-accent text-text-primary'
                        : 'border-transparent text-text-secondary hover:text-text-primary'
                    )}
                  >
                    {cat}
                    <span className="font-mono text-xs font-normal text-text-tertiary">
                      {String(categoryCounts.get(cat) ?? 0)}
                    </span>
                  </button>
                ))}
              </div>
              <span className="text-xs text-text-tertiary">
                {String(filtered.length)} of {String(entries.length)} workflows · bundled, global
                and project sources
              </span>
            </>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-auto border-t border-border">
          {!hasWorkflows ? (
            <div className="m-6 text-sm text-text-secondary">
              {localProjectId ? (
                <>
                  No workflows found in this project. Add workflow definitions to{' '}
                  <code className="rounded bg-surface-inset px-1 py-0.5 text-xs">
                    .archon/workflows/
                  </code>{' '}
                  in the project root.
                </>
              ) : (
                <>
                  No workflows are available. Bundled defaults should appear here automatically; if
                  they do not, check that{' '}
                  <code className="rounded bg-surface-inset px-1 py-0.5 text-xs">
                    defaults.loadDefaultWorkflows
                  </code>{' '}
                  is enabled in your config.
                </>
              )}
            </div>
          ) : filtered.length === 0 ? (
            <div className="m-6 text-sm text-text-secondary">
              {searched.length === 0
                ? 'No workflows match your search.'
                : 'No workflows in this category.'}
            </div>
          ) : (
            <>
              {recommended.length > 0 && (
                <>
                  <h2 className="px-6 pb-1 pt-4 text-xs font-medium text-text-secondary">
                    Recommended for this project
                  </h2>
                  {recommended.map(renderRow)}
                  {rest.length > 0 && (
                    <h2 className="px-6 pb-1 pt-4 text-xs font-medium text-text-secondary">
                      All workflows
                    </h2>
                  )}
                </>
              )}
              {rest.map(renderRow)}
            </>
          )}
        </div>
      </div>

      <div ref={detailRef} className="min-h-0 overflow-auto">
        {selectedEntry && (
          <WorkflowDetail
            entry={selectedEntry}
            runMessage={runMessage}
            onRunMessageChange={setRunMessage}
            projectId={localProjectId}
            onProjectChange={setLocalProjectId}
            projectCwd={selectedCwd}
            envId={envChoice?.workflow === selectedEntry.workflow.name ? envChoice.envId : null}
            onEnvChange={(envId): void => {
              setEnvChoice({ workflow: selectedEntry.workflow.name, envId });
            }}
            running={running}
            runError={runError}
            onRun={(envId): void => {
              void handleRun(selectedEntry.workflow.name, envId);
            }}
          />
        )}
      </div>
    </div>
  );
}
