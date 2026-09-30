import { roomOpenerId } from '@/lib/execution-room-model';
import { cn } from '@/lib/utils';

import { nodeStatusLabel } from './awaiting-chrome';
import type { LogRow } from './build-log-rows';

export interface NodeRunListProps {
  rows: readonly LogRow[];
  selectedRowId: string | null;
  onSelect: (row: LogRow) => void;
}

// Quiet list: status is a text label, tinted only when it needs attention.
const STATUS_COLORS: Record<LogRow['status'], string> = {
  pending: 'text-text-tertiary',
  running: 'text-accent',
  awaiting: 'text-accent',
  completed: 'text-success',
  failed: 'text-error',
  skipped: 'text-text-tertiary',
};

export function NodeRunList({
  rows,
  selectedRowId,
  onSelect,
}: NodeRunListProps): React.ReactElement {
  return (
    <nav
      aria-label="Node runs"
      className="flex min-h-0 w-56 shrink-0 flex-col gap-1 overflow-y-auto p-2"
    >
      {rows.map(row => {
        const selected = row.id === selectedRowId;
        return (
          <button
            key={row.id}
            id={roomOpenerId('legacy', 'log', row.id)}
            data-node-id={row.nodeId}
            type="button"
            aria-current={selected ? 'true' : undefined}
            className={cn(
              'flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 rounded-[10px] px-3 py-2 text-left text-sm transition-colors duration-150 motion-reduce:transition-none',
              selected ? 'bg-accent-muted' : 'hover:bg-surface'
            )}
            onClick={(): void => {
              onSelect(row);
            }}
          >
            <span className="truncate text-text-primary">{row.label}</span>
            <span className={cn('shrink-0 text-xs font-medium', STATUS_COLORS[row.status])}>
              {nodeStatusLabel(row.status)}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
