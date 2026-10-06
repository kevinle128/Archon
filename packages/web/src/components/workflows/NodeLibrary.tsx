import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { groupCommandsBySource } from '@/lib/command-groups';
import type { CommandEntry } from '@/lib/api';

type LibraryNodeType = 'command' | 'prompt' | 'bash' | 'route_loop';

interface NodeLibraryProps {
  commands: CommandEntry[];
  isLoading: boolean;
}

const NODE_TYPE_COLORS: Record<string, string> = {
  command: 'bg-node-command',
  prompt: 'bg-node-prompt',
  bash: 'bg-node-bash',
  route_loop: 'bg-node-loop',
};

interface QuickNode {
  type: Exclude<LibraryNodeType, 'command'>;
  name: string;
  displayName: string;
  description: string;
  /** Extra words the search box matches besides the display name. */
  keywords: string;
}

interface QuickNodeGroup {
  title: string;
  nodes: readonly QuickNode[];
}

const QUICK_NODE_GROUPS: readonly QuickNodeGroup[] = [
  {
    title: 'Basics',
    nodes: [
      {
        type: 'prompt',
        name: 'Prompt',
        displayName: 'Prompt',
        description: 'Ask the AI agent to do a task',
        keywords: 'ai agent inline',
      },
      {
        type: 'bash',
        name: 'Shell',
        displayName: 'Bash',
        description: 'Run a shell script, no AI',
        keywords: 'shell script',
      },
    ],
  },
  {
    title: 'Flow',
    nodes: [
      {
        type: 'route_loop',
        name: 'Route',
        displayName: 'Route Loop',
        description: 'Branch on a review outcome',
        keywords: 'route_loop branch',
      },
    ],
  },
];

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface';

function onDragStart(e: React.DragEvent, type: LibraryNodeType, name: string): void {
  e.dataTransfer.setData('application/reactflow-type', type);
  e.dataTransfer.setData('application/reactflow-command', name);
  e.dataTransfer.effectAllowed = 'move';
}

function LoadingSkeleton(): React.ReactElement {
  return (
    <div className="flex flex-col gap-2 p-4">
      {Array.from({ length: 6 }, (_, i) => (
        <div
          key={i}
          className="h-10 rounded-[10px] bg-surface-elevated animate-pulse motion-reduce:animate-none"
        />
      ))}
    </div>
  );
}

function DraggableItem({
  type,
  name,
  displayName,
  description,
  mono,
}: {
  type: LibraryNodeType;
  name: string;
  displayName: string;
  description?: string;
  mono?: boolean;
}): React.ReactElement {
  return (
    <div
      draggable
      onDragStart={(e): void => {
        onDragStart(e, type, name);
      }}
      className="flex min-w-0 cursor-grab items-start gap-2.5 rounded-[10px] border border-border bg-background px-3 py-2 transition-colors duration-200 motion-reduce:transition-none hover:border-border-bright hover:bg-surface-hover active:cursor-grabbing"
    >
      <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', NODE_TYPE_COLORS[type])} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn(
            'truncate text-sm font-medium text-text-primary',
            mono && 'font-mono text-xs'
          )}
        >
          {displayName}
        </span>
        {description && <span className="text-xs text-text-tertiary">{description}</span>}
      </span>
    </div>
  );
}

function GroupHeading({ children }: { children: React.ReactNode }): React.ReactElement {
  return <h3 className="px-1 text-xs font-medium text-text-tertiary">{children}</h3>;
}

function CollapsibleSection({
  title,
  count,
  defaultOpen,
  children,
}: {
  title: string;
  count: number;
  defaultOpen: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={(): void => {
          setOpen(!open);
        }}
        className={cn(
          'flex items-center gap-1 rounded-md px-1 py-1 text-xs font-medium text-text-secondary cursor-pointer transition-colors duration-200 hover:text-text-primary',
          focusRing
        )}
      >
        {open ? (
          <ChevronDown className="size-3.5" aria-hidden="true" />
        ) : (
          <ChevronRight className="size-3.5" aria-hidden="true" />
        )}
        <span>{title}</span>
        <span className="ml-auto text-text-tertiary">{count}</span>
      </button>
      {open && <div className="flex flex-col gap-1.5">{children}</div>}
    </div>
  );
}

export function NodeLibrary({ commands, isLoading }: NodeLibraryProps): React.ReactElement {
  const [search, setSearch] = useState('');

  const groups = useMemo(() => groupCommandsBySource(commands), [commands]);
  const term = search.trim().toLowerCase();

  const filteredGroups = useMemo(() => {
    if (!term) return groups;
    return groups
      .map(group => ({
        ...group,
        commands: group.commands.filter(cmd => cmd.name.toLowerCase().includes(term)),
      }))
      .filter(group => group.commands.length > 0);
  }, [groups, term]);

  const quickGroups = useMemo(
    () =>
      QUICK_NODE_GROUPS.map(group => ({
        ...group,
        nodes: group.nodes.filter(
          n =>
            !term || `${n.displayName} ${n.keywords} ${n.description}`.toLowerCase().includes(term)
        ),
      })).filter(group => group.nodes.length > 0),
    [term]
  );

  const showAdvanced = filteredGroups.length > 0;

  return (
    <aside
      aria-label="Node library"
      className="flex h-full flex-col overflow-hidden border-r border-border bg-surface"
    >
      <div className="p-4 pb-2">
        <label className="relative block">
          <span className="sr-only">Search nodes</span>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-tertiary"
            aria-hidden="true"
          />
          <input
            type="search"
            value={search}
            onChange={(e): void => {
              setSearch(e.target.value);
            }}
            placeholder="Search"
            className={cn(
              'h-10 w-full rounded-[10px] border border-border bg-background pl-9 pr-3 text-sm text-text-primary placeholder:text-text-tertiary',
              focusRing
            )}
          />
        </label>
      </div>

      {isLoading ? (
        <LoadingSkeleton />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div className="flex flex-col gap-4 p-4 pt-2">
            {quickGroups.map(group => (
              <section key={group.title} className="flex flex-col gap-1.5">
                <GroupHeading>{group.title}</GroupHeading>
                {group.nodes.map(n => (
                  <DraggableItem
                    key={n.type}
                    type={n.type}
                    name={n.name}
                    displayName={n.displayName}
                    description={n.description}
                  />
                ))}
              </section>
            ))}

            {showAdvanced && (
              <section className="flex flex-col gap-1.5">
                <GroupHeading>Advanced</GroupHeading>
                <p className="px-1 text-xs text-text-tertiary">Run a named command file</p>
                {filteredGroups.map(group => (
                  <CollapsibleSection
                    key={group.source}
                    title={group.label}
                    count={group.commands.length}
                    defaultOpen={group.source === 'project' || Boolean(term)}
                  >
                    {group.commands.map(cmd => (
                      <DraggableItem
                        key={cmd.name}
                        type="command"
                        name={cmd.name}
                        displayName={cmd.name}
                        mono
                      />
                    ))}
                  </CollapsibleSection>
                ))}
              </section>
            )}

            {!showAdvanced && quickGroups.length === 0 && (
              <p className="px-2 py-4 text-center text-sm text-text-tertiary">No matching nodes</p>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
