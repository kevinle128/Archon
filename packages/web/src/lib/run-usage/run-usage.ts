/**
 * Pure view logic for the run detail cost display: per-node grouping of the run's
 * usage report and the run-level cost state. Reported and estimated USD are never
 * combined into one number, and "unavailable", "never recorded" and "zero" stay
 * distinct states.
 */
import type { UsageMetrics, UsageReport, UsageReportGroup } from '@/lib/settings/usage';
import { describeUsageState, eventOnlyUsageMessage } from '@/lib/settings/usage-view';

/** SQL-SUM nullability: all-null stays null; any present value participates (0 stays 0). */
export function sumNullableMetric(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}

function emptyMetrics(): UsageMetrics {
  return {
    tokensInput: null,
    tokensOutput: null,
    tokensReasoning: null,
    tokensCacheRead: null,
    tokensCacheWrite: null,
    requests: null,
    reportedUsd: null,
    estimatedUsd: null,
    recordCount: 0,
    missingTokensInput: 0,
    missingTokensOutput: 0,
    missingTokensReasoning: 0,
    missingTokensCacheRead: 0,
    missingTokensCacheWrite: 0,
    missingRequests: 0,
    rowsMissingUsd: 0,
  };
}

/** Sum ledger groups that share a node id. Nullable measures keep their missingness. */
export function aggregateUsageMetrics(groups: readonly UsageReportGroup[]): UsageMetrics {
  return groups.reduce<UsageMetrics>((acc, g) => {
    const m = g.metrics;
    return {
      tokensInput: sumNullableMetric(acc.tokensInput, m.tokensInput),
      tokensOutput: sumNullableMetric(acc.tokensOutput, m.tokensOutput),
      tokensReasoning: sumNullableMetric(acc.tokensReasoning, m.tokensReasoning),
      tokensCacheRead: sumNullableMetric(acc.tokensCacheRead, m.tokensCacheRead),
      tokensCacheWrite: sumNullableMetric(acc.tokensCacheWrite, m.tokensCacheWrite),
      requests: sumNullableMetric(acc.requests, m.requests),
      reportedUsd: sumNullableMetric(acc.reportedUsd, m.reportedUsd),
      estimatedUsd: sumNullableMetric(acc.estimatedUsd, m.estimatedUsd),
      recordCount: acc.recordCount + m.recordCount,
      missingTokensInput: acc.missingTokensInput + m.missingTokensInput,
      missingTokensOutput: acc.missingTokensOutput + m.missingTokensOutput,
      missingTokensReasoning: acc.missingTokensReasoning + m.missingTokensReasoning,
      missingTokensCacheRead: acc.missingTokensCacheRead + m.missingTokensCacheRead,
      missingTokensCacheWrite: acc.missingTokensCacheWrite + m.missingTokensCacheWrite,
      missingRequests: acc.missingRequests + m.missingRequests,
      rowsMissingUsd: acc.rowsMissingUsd + m.rowsMissingUsd,
    };
  }, emptyMetrics());
}

export interface NodeUsage {
  /** Every ledger group for the node (provider, model, source and kind splits stay separate). */
  groups: UsageReportGroup[];
  /** Metrics summed across those groups. */
  aggregate: UsageMetrics;
}

/**
 * Collect every ledger group under its node id. Groups that share a node id but
 * differ by provider or model are kept side by side, never overwritten.
 */
export function collectUsageByNode(usage: UsageReport | null): Map<string, NodeUsage> {
  const result = new Map<string, NodeUsage>();
  if (usage?.groupBy !== 'node') return result;

  const buckets = new Map<string, UsageReportGroup[]>();
  for (const group of usage.groups) {
    const id = group.dimensions.nodeId;
    if (id === null || id === undefined || id === '') continue;
    const bucket = buckets.get(id);
    if (bucket === undefined) buckets.set(id, [group]);
    else bucket.push(group);
  }
  for (const [id, groups] of buckets) {
    result.set(id, { groups, aggregate: aggregateUsageMetrics(groups) });
  }
  return result;
}

/** Human label for one node ledger group: `provider/model`. */
export function usageGroupLabel(group: UsageReportGroup): string {
  const d = group.dimensions;
  const provider = d.provider ?? 'unknown provider';
  const model = d.model === null || d.model === undefined ? 'unknown model' : d.model;
  return `${provider}/${model}`;
}

/** Secondary detail for a group: where the model name came from and the usage kind. */
export function usageGroupDetail(group: UsageReportGroup): string {
  const d = group.dimensions;
  const parts: string[] = [];
  if (d.modelSource !== undefined && d.modelSource !== 'unknown') {
    parts.push(`${d.modelSource} model`);
  }
  if (d.kind !== null && d.kind !== undefined) parts.push(d.kind);
  return parts.join(' · ');
}

/** Legacy run total written by older runs into run metadata; finite and non-negative only. */
export function readLegacyRunCost(metadata: Record<string, unknown> | undefined): number | null {
  if (metadata === undefined) return null;
  const raw = metadata.total_cost_usd;
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : null;
}

export type RunCostState =
  /** The usage query failed. This is not zero cost. */
  | { kind: 'unavailable' }
  /** Usage events exist but none reached the ledger, so any total would under-count. */
  | { kind: 'event-only'; message: string }
  | {
      kind: 'ledger';
      reportedUsd: number | null;
      estimatedUsd: number | null;
      /** Set when some usage events lack ledger rows and the totals under-count. */
      incompleteMessage: string | null;
    }
  /** No ledger data, but the run carries an older total. Shown with its own label. */
  | { kind: 'legacy'; costUsd: number }
  /** No usage events were ever recorded for this run. */
  | { kind: 'not-recorded' };

export function describeRunCost(
  usage: UsageReport | null,
  legacyCostUsd: number | null
): RunCostState {
  const state = describeUsageState(usage, false);
  if (state === 'unavailable' || usage === null) return { kind: 'unavailable' };
  if (state === 'event-only') {
    return { kind: 'event-only', message: eventOnlyUsageMessage(usage.coverage) };
  }
  if (state === 'has-data') {
    return {
      kind: 'ledger',
      reportedUsd: usage.totals.reportedUsd,
      estimatedUsd: usage.totals.estimatedUsd,
      incompleteMessage:
        usage.coverage.unledgeredEventCount > 0 ? eventOnlyUsageMessage(usage.coverage) : null,
    };
  }
  if (legacyCostUsd !== null) return { kind: 'legacy', costUsd: legacyCostUsd };
  return { kind: 'not-recorded' };
}

/** Run-wide integrity warning, labeled so it is never read as a node-local under-count. */
export function runWideCoverageMessage(coverage: UsageReport['coverage']): string {
  const n = coverage.unledgeredEventCount;
  const label = n === 1 ? '1 usage event lacks' : `${String(n)} usage events lack`;
  return `Run-wide: ${label} ledger rows. This is run-scope coverage, not this node's own under-count.`;
}
