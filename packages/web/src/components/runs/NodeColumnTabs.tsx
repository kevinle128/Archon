import type { NodeColumnTab, NodeTab, RunTab } from '@/lib/runs/run-url';
import { cn } from '@/lib/utils';

const RUN_TAB_LABELS: Readonly<Record<RunTab, string>> = {
  changes: 'Changes',
  files: 'Files',
  terminal: 'Terminal',
  artifacts: 'Artifacts',
  logs: 'Logs',
  conversation: 'Chat',
};

interface NodeColumnTabsProps {
  tab: NodeColumnTab;
  onTabChange: (tab: NodeColumnTab) => void;
  /** True while the node runs. The first tab reads "Live stream", else "Transcript". */
  live: boolean;
  /** Executions of the node, shown as "History · N". */
  historyCount: number;
  /** False when no node is open; the node tabs are then disabled. */
  nodeOpen: boolean;
  /** Run tabs this run offers. */
  runTabs: readonly RunTab[];
}

function TabButton({
  value,
  active,
  disabled = false,
  onSelect,
  children,
}: {
  value: NodeColumnTab;
  active: boolean;
  disabled?: boolean;
  onSelect: (tab: NodeColumnTab) => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      role="tab"
      id={`node-column-tab-${value}`}
      aria-selected={active}
      disabled={disabled}
      onClick={(): void => {
        onSelect(value);
      }}
      className={cn(
        '-mb-px flex-none border-b-[3px] px-2.5 py-2.5 text-[13px] font-semibold whitespace-nowrap disabled:opacity-40',
        active
          ? 'border-accent text-text-primary'
          : 'border-transparent text-text-secondary hover:text-text-primary'
      )}
    >
      {children}
    </button>
  );
}

/** Node column tabs: node tabs, a divider, then the run-wide tabs. */
export function NodeColumnTabs({
  tab,
  onTabChange,
  live,
  historyCount,
  nodeOpen,
  runTabs,
}: NodeColumnTabsProps): React.ReactElement {
  const nodeTabs: readonly [NodeTab, string][] = [
    ['stream', live ? 'Live stream' : 'Transcript'],
    ['history', `History · ${String(historyCount)}`],
    ['output', 'Output'],
    ['raw', 'Raw'],
  ];
  return (
    <div
      role="tablist"
      aria-label="Node views"
      className="flex flex-none overflow-x-auto border-b border-border px-3 [scrollbar-width:thin]"
    >
      {nodeTabs.map(([value, label]) => (
        <TabButton
          key={value}
          value={value}
          active={tab === value}
          disabled={!nodeOpen}
          onSelect={onTabChange}
        >
          {label}
        </TabButton>
      ))}
      <span aria-hidden="true" className="mx-2 my-2 w-px flex-none bg-border" />
      {runTabs.map(value => (
        <TabButton key={value} value={value} active={tab === value} onSelect={onTabChange}>
          {RUN_TAB_LABELS[value]}
        </TabButton>
      ))}
    </div>
  );
}
