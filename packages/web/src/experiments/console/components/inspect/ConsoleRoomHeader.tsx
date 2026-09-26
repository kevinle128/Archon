/**
 * Sticky execution header for the Console run room. Null provider/model/start
 * and duration stay off the chrome so a missing field never renders a placeholder.
 */
import type { ReactElement } from 'react';

import type { ExecutionHeaderModel } from '@/lib/execution-room-model';

import { formatDurationMs } from '../../lib/format';
import { inspectStatusLabel } from './inspect-status';

export interface ConsoleExecutionHeaderOption {
  rowId: string;
  label: string;
}

export interface ConsoleRoomHeaderProps {
  model: ExecutionHeaderModel;
  options: readonly ConsoleExecutionHeaderOption[];
  selectedRowId: string;
  onSelectRow: (rowId: string) => void;
  onClose: () => void;
  closeLabel?: 'Close' | 'Back';
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-accent/20 text-accent',
  running: 'bg-accent/20 text-accent',
  awaiting: 'bg-warning/20 text-warning',
  completed: 'bg-success/20 text-success',
  failed: 'bg-error/20 text-error',
  skipped: 'bg-surface text-text-secondary',
  cancelled: 'bg-surface text-text-secondary',
};

function startedOffsetLabel(startedOffsetMs: number | null): string | null {
  if (startedOffsetMs === null) return null;
  return `+${formatDurationMs(startedOffsetMs)}`;
}

export function ConsoleRoomHeader({
  model,
  options,
  selectedRowId,
  onSelectRow,
  onClose,
  closeLabel = 'Close',
}: ConsoleRoomHeaderProps): ReactElement {
  const started = startedOffsetLabel(model.startedOffsetMs);
  const duration = model.durationMs === null ? null : formatDurationMs(model.durationMs);
  const statusClass = STATUS_COLORS[model.status] ?? 'bg-surface text-text-secondary';

  return (
    <header className="sticky top-0 z-10 min-w-0 overflow-hidden border-b border-border bg-surface">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2">
        <div className="min-w-[8rem] flex-1 truncate text-sm font-medium text-text-primary">
          {model.nodeLabel}
        </div>
        <div className="shrink-0 text-xs text-text-secondary">{model.executionLabel}</div>
        {options.length > 1 ? (
          <select
            aria-label="Execution"
            className="min-w-0 max-w-[10rem] flex-[0_1_10rem] truncate rounded border border-border bg-surface-elevated px-2 py-0.5 text-xs text-text-primary"
            value={selectedRowId}
            onChange={(event): void => {
              onSelectRow(event.currentTarget.value);
            }}
          >
            {options.map(option => (
              <option key={option.rowId} value={option.rowId}>
                {option.label}
              </option>
            ))}
          </select>
        ) : null}
        <span className={`rounded-full px-2 py-0.5 text-xs ${statusClass}`}>
          {inspectStatusLabel(model.status)}
        </span>
        {started !== null ? (
          <span className="shrink-0 text-xs text-text-secondary">{started}</span>
        ) : null}
        {duration !== null ? (
          <span className="shrink-0 text-xs text-text-secondary">{duration}</span>
        ) : null}
        {model.provider !== null ? (
          <span className="min-w-0 max-w-[10rem] truncate text-xs text-text-secondary">
            {model.provider}
          </span>
        ) : null}
        {model.model !== null ? (
          <span className="min-w-0 max-w-[12rem] truncate text-xs text-text-secondary">
            {model.model}
          </span>
        ) : null}
        <button
          type="button"
          className="ml-auto shrink-0 text-xs text-primary hover:text-accent-bright"
          onClick={onClose}
        >
          {closeLabel}
        </button>
      </div>
    </header>
  );
}
