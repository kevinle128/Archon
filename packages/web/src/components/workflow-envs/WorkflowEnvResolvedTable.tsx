import { type ReactElement } from 'react';

/** One provider-turn row of a persisted overlay snapshot. */
export interface RunEnvResolvedRow {
  nodeId: string;
  provider: string;
  model?: string;
  tier?: 'small' | 'medium' | 'large';
  modelReasoningEffort?: string;
  effort?: string;
  thinking?: { type: string; budgetTokens?: number };
}

/**
 * Run-owned ENV overlay metadata. A pending snapshot omits `resolved` until the
 * executor writes the complete form.
 */
export interface RunEnvOverlay {
  envId: string;
  envName: string;
  workflowName: string;
  complete: boolean;
  skippedNodeIds: string[];
  latestMissingNodeIds: string[];
  resolved: RunEnvResolvedRow[] | null;
}

export interface WorkflowEnvResolvedTableProps {
  overlay: RunEnvOverlay;
}

/** Caption distinguishing planned request settings from node events / final models. */
export const RESOLVED_REQUEST_CAPTION =
  'Latest planned request settings at this start/resume; providers may ignore unsupported thinking. A resume may skip completed nodes. Node events show actual attempts and provider-reported final models.';

function formatThinking(thinking: RunEnvResolvedRow['thinking']): string | null {
  if (thinking === undefined) return null;
  if (thinking.type === 'adaptive') return 'adaptive';
  if (thinking.type === 'disabled') return 'disabled';
  if (thinking.budgetTokens !== undefined) {
    return `enabled(${String(thinking.budgetTokens)})`;
  }
  if (thinking.type === 'enabled') return 'enabled';
  return thinking.type;
}

function formatModel(row: RunEnvResolvedRow): string {
  if (row.model !== undefined && row.model.length > 0) return row.model;
  if (row.tier !== undefined) return `tier:${row.tier}`;
  return '—';
}

/**
 * Run-detail table for persisted ENV overlay request metadata.
 * Never renders prompt/bash bodies. Malformed overlays are omitted upstream.
 */
export function WorkflowEnvResolvedTable({ overlay }: WorkflowEnvResolvedTableProps): ReactElement {
  const rows = overlay.resolved ?? [];
  const skipped = overlay.skippedNodeIds;
  const missing = overlay.latestMissingNodeIds;

  return (
    <div
      className="grid gap-2 rounded-xl border border-border bg-surface px-4 py-3"
      data-testid="workflow-env-resolved-table"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-medium text-text-secondary">
          Planned request settings
          <span className="ml-2 font-mono font-normal text-text-tertiary">
            env: {overlay.envName}
            {!overlay.complete ? ' (pending)' : ''}
          </span>
        </p>
        <p className="max-w-[36rem] text-xs text-text-tertiary">{RESOLVED_REQUEST_CAPTION}</p>
      </div>

      {skipped.length > 0 ? (
        <p className="text-xs text-warning" role="status">
          Skipped missing nodes at start: {skipped.join(', ')}
        </p>
      ) : null}

      {missing.length > 0 ? (
        <p className="text-xs text-warning" role="status">
          Originally applied ids missing on latest resume: {missing.join(', ')}
        </p>
      ) : null}

      {!overlay.complete ? (
        <p className="text-xs text-text-tertiary">
          Overlay selected; resolved request rows appear once execution starts.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-text-tertiary">
          No provider-turn request rows recorded for this overlay.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-left font-mono text-xs">
            <thead>
              <tr className="border-b border-border text-text-tertiary">
                <th className="py-1 pr-3 font-medium">Node</th>
                <th className="py-1 pr-3 font-medium">Provider</th>
                <th className="py-1 pr-3 font-medium">Model / tier</th>
                <th className="py-1 pr-3 font-medium">Effort</th>
                <th className="py-1 font-medium">Thinking</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const thinking = formatThinking(row.thinking);
                const effort =
                  row.effort ??
                  (row.modelReasoningEffort !== undefined ? row.modelReasoningEffort : null);
                return (
                  <tr key={row.nodeId} className="border-b border-border/60 text-text-secondary">
                    <td className="py-1.5 pr-3 text-text-primary">{row.nodeId}</td>
                    <td className="py-1.5 pr-3">{row.provider}</td>
                    <td className="py-1.5 pr-3">{formatModel(row)}</td>
                    <td className="py-1.5 pr-3">{effort ?? '—'}</td>
                    <td className="py-1.5">{thinking ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
