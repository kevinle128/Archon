import { type ReactElement } from 'react';
import type { WorkflowEnvPreview } from '@/lib/workflow-envs/api';

export interface WorkflowEnvPreviewTableProps {
  preview: WorkflowEnvPreview | undefined;
  loading?: boolean;
  error?: Error | undefined;
  /** When an ENV is selected, loading/error are blocking; None is advisory. */
  envSelected: boolean;
}

const PREVIEW_DISCLAIMER =
  'Preview only — the ENV, workflow, or model profile may change before the run starts.';

function formatThinking(
  thinking: WorkflowEnvPreview['resolved'][number]['thinking']
): string | null {
  if (thinking === undefined) return null;
  if (thinking.type === 'adaptive') return 'adaptive';
  if (thinking.type === 'disabled') return 'disabled';
  if (thinking.budgetTokens !== undefined) {
    return `enabled(${String(thinking.budgetTokens)})`;
  }
  return 'enabled';
}

function formatModel(row: WorkflowEnvPreview['resolved'][number]): string {
  if (row.model !== undefined && row.model.length > 0) return row.model;
  if (row.tier !== undefined) return `tier:${row.tier}`;
  return '—';
}

/**
 * Non-authoritative preview of provider-turn request metadata shown before a run starts.
 * Never renders prompt/bash bodies.
 */
export function WorkflowEnvPreviewTable({
  preview,
  loading = false,
  error,
  envSelected,
}: WorkflowEnvPreviewTableProps): ReactElement {
  if (error !== undefined) {
    return (
      <div className="rounded-xl border border-error/40 bg-surface px-4 py-3" role="alert">
        <p className="text-xs text-error">
          {envSelected
            ? 'ENV preview failed — Run is disabled until this resolves.'
            : 'Preview unavailable (running from the YAML still works).'}
        </p>
        <p className="mt-1 text-xs text-text-tertiary">{error.message}</p>
      </div>
    );
  }

  if (loading || preview === undefined) {
    return (
      <div className="rounded-xl border border-border bg-surface px-4 py-3">
        <p className="text-xs text-text-tertiary">
          {envSelected ? 'Loading ENV preview…' : 'Loading preview…'}
        </p>
      </div>
    );
  }

  const rows = preview.resolved;
  const skipped = preview.skippedNodeIds;

  return (
    <div className="grid gap-2 rounded-xl border border-border bg-surface px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-medium text-text-secondary">
          Request preview
          {preview.envName !== null ? (
            <span className="ml-2 font-mono font-normal text-text-tertiary">
              env: {preview.envName}
            </span>
          ) : (
            <span className="ml-2 font-mono font-normal text-text-tertiary">YAML</span>
          )}
        </p>
        <p className="text-xs text-text-tertiary">{PREVIEW_DISCLAIMER}</p>
      </div>

      {skipped.length > 0 ? (
        <p className="text-xs text-warning" role="status">
          Skipped missing nodes: {skipped.join(', ')}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="text-xs text-text-tertiary">No provider-turn nodes in this workflow.</p>
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

export { PREVIEW_DISCLAIMER };
