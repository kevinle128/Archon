import type { CommandEntry, WorkflowListEntry } from '@/lib/api';
import { SectionLabel } from '@/components/ui/section-label';
import { NodeLibrary } from '@/components/workflows/NodeLibrary';

/** Node kinds the builder can author. Loop and approval nodes stay load-only. */
export type BuilderNodeKind = 'command' | 'prompt' | 'bash' | 'route_loop';

export const PALETTE: readonly {
  kind: BuilderNodeKind;
  code: string;
  label: string;
  description: string;
}[] = [
  { kind: 'command', code: 'CMD', label: 'Command', description: 'Run a command file' },
  { kind: 'prompt', code: 'PRM', label: 'Prompt', description: 'Ask the agent inline' },
  { kind: 'bash', code: 'SH', label: 'Bash', description: 'Run a shell script' },
  { kind: 'route_loop', code: 'ROUTE', label: 'Route', description: 'Branch on a condition' },
];

interface BuilderPaletteProps {
  workflows: readonly WorkflowListEntry[];
  /** Workflow the canvas started from, or "" for a blank workflow. */
  startFrom: string;
  onStartFrom: (name: string | null) => void;
  /** Where the next node goes, in words. */
  addHint: string;
  onAdd: (kind: BuilderNodeKind) => void;
  commands: CommandEntry[];
  commandsLoading: boolean;
  /** The command library drags into the graph view only. */
  showLibrary: boolean;
}

/** Left column of the Builder: start point, node palette, and the command library. */
export function BuilderPalette({
  workflows,
  startFrom,
  onStartFrom,
  addHint,
  onAdd,
  commands,
  commandsLoading,
  showLibrary,
}: BuilderPaletteProps): React.ReactElement {
  return (
    <aside
      aria-label="Builder palette"
      className="flex min-h-0 flex-col overflow-auto border-r-2 border-line-strong"
    >
      <div className="px-4 py-3">
        <h1 className="text-xl font-extrabold">Builder</h1>
        <label className="mt-2 flex flex-col gap-1 text-xs font-semibold text-text-secondary">
          Start from
          <select
            value={startFrom}
            onChange={(event): void => {
              onStartFrom(event.target.value === '' ? null : event.target.value);
            }}
            className="h-8 border border-line-strong bg-card px-2 text-[13px] text-text-primary"
          >
            <option value="">Blank workflow</option>
            {workflows.map(entry => (
              <option key={entry.workflow.name} value={entry.workflow.name}>
                {entry.workflow.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <SectionLabel className="px-4">Add node</SectionLabel>
      <p className="px-4 pt-1 pb-3 text-xs leading-[1.4] text-text-secondary">{addHint}</p>
      <div className="border-t border-border">
        {PALETTE.map(item => (
          <button
            key={item.kind}
            type="button"
            aria-label={`Add ${item.label} node`}
            onClick={(): void => {
              onAdd(item.kind);
            }}
            className="grid w-full grid-cols-[44px_minmax(0,1fr)_auto] items-baseline gap-2 border-b border-border px-4 py-2 text-left hover:bg-selection"
          >
            <span className="text-[10px] font-extrabold tracking-[0.04em] text-text-secondary">
              {item.code}
            </span>
            <span>
              <span className="block text-[13px] font-bold">{item.label}</span>
              <span className="block text-xs text-text-secondary">{item.description}</span>
            </span>
            <span aria-hidden="true" className="font-extrabold text-accent">
              +
            </span>
          </button>
        ))}
      </div>
      {showLibrary ? (
        <div className="mt-3 min-h-0 border-t border-border">
          <SectionLabel className="px-4 pt-3">Commands · drag into the graph</SectionLabel>
          <NodeLibrary commands={commands} isLoading={commandsLoading} />
        </div>
      ) : null}
    </aside>
  );
}
