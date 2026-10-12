import { Link } from 'react-router';

import { SectionLabel } from '@/components/ui/section-label';
import { ProgressStrip } from '@/components/ui/progress-strip';
import type { WorkflowRunResponse } from '@/lib/api';
import { CHAT_COMMANDS, commandPrefill } from '@/lib/chat/chat-commands';
import { buildRunPath } from '@/lib/runs/run-url';
import { getStatusPresentation, STATUS_TONE_TEXT_CLASS } from '@/lib/status-presentation';
import { cn } from '@/lib/utils';
import { useRunStrip } from '@/components/runs/run-strip';

interface ChatContextPanelProps {
  projectName: string | null;
  branch: string | null;
  path: string | null;
  /** Runs this conversation started, newest first. */
  runs: readonly WorkflowRunResponse[];
  /** Project cwd, for the run strips' workflow definitions. */
  cwd: string | undefined;
  onPrefill: (text: string) => void;
}

function ChatRunRow({
  run,
  cwd,
}: {
  run: WorkflowRunResponse;
  cwd: string | undefined;
}): React.ReactElement {
  const statuses = useRunStrip(run, cwd);
  const presentation = getStatusPresentation(run.status);
  const done = statuses.filter(status => status === 'completed').length;
  return (
    <Link
      to={buildRunPath(run.id)}
      className="block border-b border-border py-2 text-text-primary no-underline hover:bg-selection"
    >
      <span className="flex justify-between gap-2 text-[13px]">
        <span className="font-bold break-words">{run.workflow_name}</span>
        <span
          aria-label={presentation.label}
          className={cn('flex-none font-bold', STATUS_TONE_TEXT_CLASS[presentation.tone])}
        >
          {presentation.glyph}
        </span>
      </span>
      <ProgressStrip statuses={statuses} className="mt-1.5" />
      <span className="mt-1 block text-[11px] text-text-secondary">
        {run.id.slice(0, 8)} · {String(done)} of {String(statuses.length)} done
      </span>
    </Link>
  );
}

/** Right column of Chat: where the conversation runs, its runs, and the commands. */
export function ChatContextPanel({
  projectName,
  branch,
  path,
  runs,
  cwd,
  onPrefill,
}: ChatContextPanelProps): React.ReactElement {
  return (
    <aside
      aria-label="Conversation context"
      className="flex min-h-0 flex-col overflow-auto bg-background max-lg:hidden"
    >
      <div className="border-b border-border px-6 py-4">
        <SectionLabel>Context</SectionLabel>
        <dl className="mt-2 grid grid-cols-[64px_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">
          <dt className="text-text-secondary">Project</dt>
          <dd className="font-semibold break-words">{projectName ?? 'No project'}</dd>
          <dt className="text-text-secondary">Branch</dt>
          <dd className="font-mono text-xs font-semibold">{branch ?? 'no git'}</dd>
          <dt className="text-text-secondary">Path</dt>
          <dd className="font-mono text-xs font-semibold break-all">{path ?? '–'}</dd>
        </dl>
      </div>
      <div className="border-b border-border px-6 py-4">
        <SectionLabel>Runs from this chat</SectionLabel>
        {runs.map(run => (
          <ChatRunRow key={run.id} run={run} cwd={cwd} />
        ))}
        {runs.length === 0 ? (
          <p className="py-2 text-[13px] text-text-secondary">
            None yet. Type /workflow run to start one.
          </p>
        ) : null}
      </div>
      <div className="px-6 py-4">
        <SectionLabel>Commands</SectionLabel>
        {CHAT_COMMANDS.map(command => (
          <button
            key={command.template}
            type="button"
            onClick={(): void => {
              onPrefill(commandPrefill(command.template));
            }}
            className="flex w-full flex-col gap-0.5 border-b border-border py-2 text-left hover:bg-selection"
          >
            <span className="font-mono text-xs font-bold">{command.template}</span>
            <span className="text-xs text-text-secondary">{command.description}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
