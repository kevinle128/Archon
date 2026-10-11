import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';

import { Button } from '@/components/ui/button';
import { SectionLabel } from '@/components/ui/section-label';
import { getWorkflow, saveWorkflow, type WorkflowListEntry } from '@/lib/api';
import { groupNodesIntoSteps, summarizeNodeKinds, type StepNode } from '@/lib/node-steps';
import { hasStatus } from '@/lib/settings/http';
import { cn } from '@/lib/utils';
import { inputLabel, workflowFilePath } from '@/lib/workflows-library/workflow-facts';
import {
  getWorkflowCategory,
  getWorkflowDisplayName,
  parseWorkflowDescription,
} from '@/lib/workflow-metadata';
import type { NodeBodyKind } from '@/components/workflows/resolve-room-kind';

const KIND_LABEL: Readonly<Record<NodeBodyKind, string>> = {
  command: 'Command',
  prompt: 'Prompt',
  bash: 'Bash',
  script: 'Script',
  loop: 'Loop',
  approval: 'Approval',
  plannotator_gate: 'Plannotator gate',
  workflow: 'Workflow',
  route_loop: 'Route loop',
  loop_group: 'Loop group',
  unknown: 'Node',
};

/** Highest suffix tried when the copy name is taken. */
const MAX_COPY_SUFFIX = 9;

/** First `<name>-copy`, `<name>-copy-2`, … that has no project workflow yet. */
async function freeCopyName(name: string, cwd: string): Promise<string> {
  for (let suffix = 1; suffix <= MAX_COPY_SUFFIX; suffix += 1) {
    const candidate = suffix === 1 ? `${name}-copy` : `${name}-copy-${String(suffix)}`;
    try {
      const existing = await getWorkflow(candidate, cwd);
      if (existing.source !== 'project') return candidate;
    } catch (error) {
      // Only "not found" means the name is free; any other failure must not lead to a save.
      if (hasStatus(error, 404)) return candidate;
      throw error;
    }
  }
  throw new Error(`Every copy name up to ${name}-copy-${String(MAX_COPY_SUFFIX)} is taken`);
}

function StepNodeButton({
  node,
  dependsOn,
  open,
  onToggle,
}: {
  node: StepNode;
  dependsOn: readonly string[];
  open: boolean;
  onToggle: (id: string) => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={(): void => {
        onToggle(node.id);
      }}
      className={cn(
        '-ml-2 my-0.5 grid w-full grid-cols-[44px_minmax(0,1fr)] items-baseline gap-x-2 gap-y-0.5 border-l-[3px] px-2 py-2 text-left hover:bg-selection',
        open ? 'border-l-accent bg-selection' : 'border-l-transparent'
      )}
    >
      <span className="text-[10px] font-extrabold tracking-[0.04em] text-text-secondary">
        {node.code}
      </span>
      <span className="text-sm font-semibold break-words">{node.id}</span>
      {open ? (
        <>
          <span />
          <span className="mt-1 grid grid-cols-[76px_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-xs">
            <span className="text-text-secondary">Kind</span>
            <span>
              {KIND_LABEL[node.kind]}
              {node.node.description !== undefined && node.node.description !== ''
                ? ` · ${node.node.description}`
                : ''}
            </span>
            <span className="text-text-secondary">Depends on</span>
            <span>{dependsOn.length > 0 ? dependsOn.join(', ') : 'Nothing, runs first'}</span>
          </span>
        </>
      ) : null}
    </button>
  );
}

interface WorkflowDetailColumnProps {
  entry: WorkflowListEntry;
  /** Project the copy goes to, or null when the filter is "All projects". */
  projectCwd: string | null;
  /** cwd the workflow list was read from, for the file name lookup. */
  listCwd: string | undefined;
}

/** Middle column of the Workflows screen: what the workflow is and how it runs. */
export function WorkflowDetailColumn({
  entry,
  projectCwd,
  listCwd,
}: WorkflowDetailColumnProps): React.ReactElement {
  const { workflow, source } = entry;
  const [openNode, setOpenNode] = useState<string | null>(null);
  const [copy, setCopy] = useState<
    | { state: 'idle' }
    | { state: 'saving' }
    | { state: 'done'; name: string }
    | { state: 'error'; message: string }
  >({ state: 'idle' });

  const { data: detail } = useQuery({
    queryKey: ['workflowDetail', workflow.name, listCwd ?? null],
    queryFn: () => getWorkflow(workflow.name, listCwd),
    staleTime: 60_000,
  });

  const parsed = parseWorkflowDescription(workflow.description);
  const description = parsed.whenToUse !== '' ? parsed.whenToUse : workflow.description;
  const category = getWorkflowCategory(workflow.name, workflow.description);
  const steps = groupNodesIntoSteps(workflow.nodes);
  const canDuplicate = source !== 'project';

  const duplicate = async (): Promise<void> => {
    if (projectCwd === null) return;
    setCopy({ state: 'saving' });
    try {
      const name = await freeCopyName(workflow.name, projectCwd);
      await saveWorkflow(name, { ...workflow, name }, projectCwd);
      setCopy({ state: 'done', name });
    } catch (error) {
      setCopy({
        state: 'error',
        message: error instanceof Error ? error.message : 'Failed to copy the workflow',
      });
    }
  };

  return (
    <section aria-label="Workflow detail" className="flex min-h-0 flex-col border-r border-border">
      <header className="flex-none border-b border-border px-6 py-4">
        <div className="text-xs text-text-secondary">
          {category} · {workflowFilePath(workflow.name, source, detail?.filename)}
        </div>
        <h2 className="mt-0.5 text-2xl leading-[1.15] font-extrabold break-words">
          {getWorkflowDisplayName(workflow.name)}
        </h2>
        {description !== '' ? (
          <p className="mt-2 max-w-[64ch] text-sm leading-[1.55]">{description}</p>
        ) : null}
        <dl className="mt-3 grid grid-cols-[64px_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
          <dt className="text-text-secondary">Nodes</dt>
          <dd className="font-semibold">{summarizeNodeKinds(workflow.nodes) || '–'}</dd>
          <dt className="text-text-secondary">Input</dt>
          <dd className="font-semibold">{inputLabel(workflow)}</dd>
          <dt className="text-text-secondary">Steps</dt>
          <dd className="font-semibold">{String(steps.length)}</dd>
          {parsed.does !== '' ? (
            <>
              <dt className="text-text-secondary">Does</dt>
              <dd>{parsed.does}</dd>
            </>
          ) : null}
          {parsed.constraints !== '' ? (
            <>
              <dt className="text-text-secondary">Not for</dt>
              <dd>{parsed.constraints}</dd>
            </>
          ) : null}
          {parsed.triggers.length > 0 ? (
            <>
              <dt className="text-text-secondary">Triggers</dt>
              <dd>{parsed.triggers.join(' · ')}</dd>
            </>
          ) : null}
          {entry.parseWarnings !== undefined && entry.parseWarnings.length > 0 ? (
            <>
              <dt className="text-status-waiting">Warnings</dt>
              <dd className="text-status-waiting">{entry.parseWarnings.join(' ')}</dd>
            </>
          ) : null}
        </dl>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button asChild variant="secondary" size="sm">
            <Link to={`/workflows/builder?edit=${encodeURIComponent(workflow.name)}`}>
              Open in Builder
            </Link>
          </Button>
          {canDuplicate ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={projectCwd === null || copy.state === 'saving' || copy.state === 'done'}
              title={
                projectCwd === null ? 'Pick a project in the top bar to copy into it.' : undefined
              }
              onClick={(): void => {
                void duplicate();
              }}
            >
              {copy.state === 'done'
                ? 'Copied to .archon/workflows'
                : copy.state === 'saving'
                  ? 'Copying…'
                  : 'Duplicate to project'}
            </Button>
          ) : null}
        </div>
        {copy.state === 'done' ? (
          <p className="mt-2 text-xs text-text-secondary">
            Saved as <span className="font-mono">{copy.name}</span>.
          </p>
        ) : null}
        {copy.state === 'error' ? (
          <p role="alert" className="mt-2 text-xs font-semibold text-error">
            {copy.message}
          </p>
        ) : null}
      </header>
      <div className="flex flex-none justify-between px-6 pt-3 pb-1">
        <SectionLabel>Nodes</SectionLabel>
        <span className="text-[11px] tracking-[0.08em] text-text-secondary uppercase">
          {String(workflow.nodes.length)} in {String(steps.length)}{' '}
          {steps.length === 1 ? 'step' : 'steps'}
        </span>
      </div>
      <ol aria-label="Workflow nodes" className="min-h-0 flex-1 overflow-auto px-6 pb-6">
        {steps.map(step => (
          <li
            key={step.index}
            className="grid grid-cols-[28px_minmax(0,1fr)] border-t border-border"
          >
            <span className="pt-2.5 text-[11px] text-text-tertiary">{step.number}</span>
            <div className={cn('flex flex-col', step.parallel && 'border-l-2 border-border pl-3')}>
              {step.parallel ? (
                <span className="pt-1.5 text-[11px] text-text-tertiary">
                  Parallel · {String(step.nodes.length)}
                </span>
              ) : null}
              {step.nodes.map(node => (
                <StepNodeButton
                  key={node.id}
                  node={node}
                  dependsOn={node.node.depends_on ?? []}
                  open={openNode === node.id}
                  onToggle={(id): void => {
                    setOpenNode(current => (current === id ? null : id));
                  }}
                />
              ))}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
