/**
 * Sticky execution header for the Console run room: node identity on line 1,
 * runtime facts on line 2, and the execution picker on line 3 when the node
 * has more than one execution to choose from. Null provider/model/start,
 * duration, and retry-count stay off the chrome so a missing field never
 * renders a placeholder.
 */
import type { CSSProperties, ReactElement } from 'react';

import {
  headerMetaLine,
  statusPill,
  type ExecutionHeaderModel,
  type NodeKindChip,
  type RunOfTotal,
} from '@/lib/execution-room-model';

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
  /** Node-kind chip for line 1, or null when the kind has no established token. */
  kindChip: NodeKindChip | null;
  /** Uncapped execution total for this node, for the "of N" (and, on a loop, "· max N") caption. */
  executionCount: number;
  /** Retry position/count for the selected row, or null when it never retried. */
  runOfTotal?: RunOfTotal | null;
  /** Latest terminal execution failed for idle-await expiry. Default false. */
  idleAwaitExpired?: boolean;
  /** Set only when viewing a finished iteration while the node runs live elsewhere. */
  iterationPrefix?: number | null;
  /** Server-reported restart recovery for the selected row. Default false. */
  recoveryRequired?: boolean;
}

// Tailwind's build scans source for literal class names, so a chip/pill tone
// resolves through this fixed table instead of `text-${tone}` interpolation
// — the same convention ConsoleAgentHistoryList.tsx uses for tool-row colors.
const KIND_CHIP_STYLE: Readonly<Record<string, { className: string; style: CSSProperties }>> = {
  'node-command': {
    className: 'text-node-command',
    style: { borderColor: 'color-mix(in oklch, var(--node-command) 40%, transparent)' },
  },
  'node-prompt': {
    className: 'text-node-prompt',
    style: { borderColor: 'color-mix(in oklch, var(--node-prompt) 40%, transparent)' },
  },
  'node-bash': {
    className: 'text-node-bash',
    style: { borderColor: 'color-mix(in oklch, var(--node-bash) 40%, transparent)' },
  },
  'node-loop': {
    className: 'text-node-loop',
    style: { borderColor: 'color-mix(in oklch, var(--node-loop) 40%, transparent)' },
  },
  'node-approval': {
    className: 'text-node-approval',
    style: { borderColor: 'color-mix(in oklch, var(--node-approval) 40%, transparent)' },
  },
};

interface StatusPillStyle {
  className: string;
  style: CSSProperties;
}

// Every tone renders 10px/700 with no dot, matching the mockup room header
// pill (measured against the live mockup, not the run-level page header
// pill it was once confused with). `lineHeight: 'normal'` matches the
// mockup's pill exactly: the mockup's own markup sets no line-height on the
// pill, so the browser's own default for its font wins there (measured 18px
// tall); without this override the inherited cascade left the app's pill at
// 21px.
const STATUS_PILL_STYLE: Readonly<Record<string, StatusPillStyle>> = {
  accent: {
    className: 'text-[10px] font-bold text-[color:var(--running)]',
    style: {
      borderColor: 'color-mix(in oklch, var(--running) 40%, transparent)',
      lineHeight: 'normal',
    },
  },
  warning: {
    className: 'text-[10px] font-bold text-warning',
    style: { borderColor: 'var(--status-pill-border-warning)', lineHeight: 'normal' },
  },
  success: {
    className: 'text-[10px] font-bold text-success',
    style: {
      borderColor: 'color-mix(in oklch, var(--success) 40%, transparent)',
      lineHeight: 'normal',
    },
  },
  error: {
    className: 'text-[10px] font-bold text-error',
    style: {
      borderColor: 'color-mix(in oklch, var(--error) 40%, transparent)',
      lineHeight: 'normal',
    },
  },
};

const NEUTRAL_PILL_STYLE: StatusPillStyle = {
  className: 'text-[10px] font-bold text-text-secondary',
  style: { borderColor: 'var(--border)', lineHeight: 'normal' },
};

export function ConsoleRoomHeader({
  model,
  options,
  selectedRowId,
  onSelectRow,
  onClose,
  closeLabel = 'Close',
  kindChip,
  executionCount,
  runOfTotal = null,
  idleAwaitExpired = false,
  iterationPrefix = null,
  recoveryRequired = false,
}: ConsoleRoomHeaderProps): ReactElement {
  const pill = statusPill(model.status, recoveryRequired);
  const pillStyle = pill.tone === null ? NEUTRAL_PILL_STYLE : STATUS_PILL_STYLE[pill.tone];
  const chipStyle = kindChip === null ? null : (KIND_CHIP_STYLE[kindChip.tone] ?? null);
  const metaLine = headerMetaLine({
    startedAt: model.startedAt,
    status: model.status,
    durationMs: model.durationMs,
    runOfTotal,
    provider: model.provider,
    model: model.model,
    idleAwaitExpired,
    statusReason: model.statusReason,
    waitingOnOperator: model.waitingOnOperator,
    iterationPrefix,
    recoveryRequired,
  });

  return (
    <header className="sticky top-0 z-10 min-w-0 overflow-hidden border-b border-border bg-surface">
      <div className="flex min-w-0 flex-col gap-1.5 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          {kindChip !== null && chipStyle !== null ? (
            <span
              className={`shrink-0 rounded border px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide ${chipStyle.className}`}
              style={chipStyle.style}
            >
              {kindChip.label}
            </span>
          ) : null}
          <div className="min-w-0 truncate font-mono text-[13px] font-bold text-text-primary">
            {model.nodeLabel}
          </div>
          <span
            className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 ${pillStyle.className}`}
            style={pillStyle.style}
          >
            {pill.label}
          </span>
          <button
            type="button"
            aria-label={closeLabel}
            className="ml-auto shrink-0 rounded px-1.5 py-1 text-[13px] text-text-tertiary hover:text-text-primary"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        {metaLine !== null ? (
          <div className="truncate text-[11px] text-text-tertiary">{metaLine}</div>
        ) : null}
        {options.length > 1 || model.isLoopIteration ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="shrink-0 text-xs text-text-secondary">{model.executionLabel}</span>
            {options.length > 1 ? (
              <>
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
                <span className="shrink-0 text-[11px] text-text-secondary">
                  of {executionCount}
                  {model.loopMaxIterations !== null
                    ? ` · max ${String(model.loopMaxIterations)}`
                    : ''}
                </span>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </header>
  );
}
