/**
 * Sticky execution header for the legacy run room: node identity on line 1,
 * runtime facts on line 2, and the execution picker on line 3 when the node
 * has more than one execution to choose from. Null provider/model/start,
 * duration, and retry-count stay off the chrome so a missing field never
 * renders a placeholder.
 */
import {
  effectiveNodeRoomStatus,
  headerMetaLine,
  statusPill,
  type ExecutionHeaderModel,
  type NodeKindChip,
  type RunOfTotal,
} from '@/lib/execution-room-model';
import type { SteeringNodeOutcome } from '@/lib/steering-dock';
import { cn } from '@/lib/utils';

export interface ExecutionHeaderOption {
  rowId: string;
  label: string;
}

export interface NodeRoomHeaderProps {
  model: ExecutionHeaderModel;
  options: readonly ExecutionHeaderOption[];
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
  /**
   * The node's own settled outcome, from the steering dock's own terminal
   * reconciliation — folded onto `model.status` before either the pill or
   * the meta line reads it, so a still-`running`/`awaiting` row status never
   * outlives the proven outcome. Null/undefined leaves `model.status`
   * unchanged.
   */
  terminalOutcome?: SteeringNodeOutcome | null;
}

/** Status text color per pill tone. A tone of null reads as the pending tone. */
const PILL_TONE_CLASS: Readonly<Record<string, string>> = {
  accent: 'text-status-running',
  warning: 'text-status-waiting',
  success: 'text-status-done',
  error: 'text-status-failed',
};

/** Glyph per pill tone, from the shared status language. */
const PILL_TONE_GLYPH: Readonly<Record<string, string>> = {
  accent: '▶',
  warning: '!',
  success: '✓',
  error: '✕',
};

export function NodeRoomHeader({
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
  terminalOutcome = null,
}: NodeRoomHeaderProps): React.ReactElement {
  const effectiveStatus = effectiveNodeRoomStatus(model.status, terminalOutcome);
  const pill = statusPill(effectiveStatus, recoveryRequired);
  const metaLine = headerMetaLine({
    startedAt: model.startedAt,
    status: effectiveStatus,
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

  const toneClass = pill.tone === null ? 'text-status-pending' : PILL_TONE_CLASS[pill.tone];
  const glyph = pill.tone === null ? '○' : PILL_TONE_GLYPH[pill.tone];

  return (
    <header className="sticky top-0 z-10 min-w-0 overflow-hidden bg-background">
      <div className="flex min-w-0 items-start gap-3 px-6 pt-4">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {kindChip !== null ? (
            <span className="block text-xs text-text-secondary first-letter:uppercase">
              {model.model !== null ? `${kindChip.label} · ${model.model}` : kindChip.label}
            </span>
          ) : null}
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <h2 className="min-w-0 text-xl font-extrabold break-words text-text-primary">
              {model.nodeLabel}
            </h2>
            <span
              data-slot="node-status"
              data-tone={pill.tone ?? 'pending'}
              className={cn('shrink-0 text-[13px] font-bold whitespace-nowrap', toneClass)}
            >
              <span aria-hidden="true">{glyph} </span>
              {pill.label}
            </span>
          </div>
          {metaLine !== null ? (
            <div className="truncate text-xs text-text-secondary">{metaLine}</div>
          ) : null}
          {options.length > 1 || model.isLoopIteration ? (
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="shrink-0 text-[11px] text-text-secondary">execution</span>
              {options.length > 1 ? (
                <>
                  <select
                    aria-label="Execution"
                    className="h-7 min-w-0 max-w-[12rem] flex-[0_1_12rem] truncate border border-line-strong bg-card px-1.5 text-xs text-text-primary"
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
              ) : (
                <span className="shrink-0 text-xs text-text-primary">{model.executionLabel}</span>
              )}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          aria-label={closeLabel}
          className="inline-flex h-8 min-w-8 shrink-0 cursor-pointer items-center justify-center px-2 text-[13px] font-semibold text-text-secondary hover:text-text-primary"
          onClick={onClose}
        >
          {closeLabel === 'Back' ? '← Back' : '✕'}
        </button>
      </div>
    </header>
  );
}
