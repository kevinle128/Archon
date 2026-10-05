/**
 * Pure view logic for the usage and cost section: money formatting, group labels,
 * report state classification, and filter to query conversion. Reported and
 * estimated USD stay separate; there is never a combined total.
 */
import type {
  UsageGroupBy,
  UsageKindFilter,
  UsageMetrics,
  UsageQuery,
  UsageReport,
  UsageReportGroup,
} from './usage';
import { inclusiveUtcRangeToApi, utcDateOnly, utcMonthStart } from './usage';

/** Positive amounts strictly below this floor use the `<$0.000001` form. */
const USD_POSITIVE_FLOOR = 0.000_001;
const ONE_CENT = 0.01;

/**
 * Format a USD amount for usage/cost surfaces (usage section, run header, node rows).
 *
 * Matches CLI `archon usage` rules:
 * - null/undefined → `n/a`
 * - exact 0 → `$0.00` or `≈$0.00`
 * - positive below 1e-6 → `<$0.000001` / `≈<$0.000001` (never rounds to zero)
 * - positive below one cent → up to six significant decimals
 * - otherwise → two decimals
 * - estimated amounts prefix `≈`
 */
export function formatUsdAmount(amount: number | null | undefined, estimated = false): string {
  if (amount === null || amount === undefined) {
    return 'n/a';
  }
  const approx = estimated ? '≈' : '';
  if (amount === 0) {
    return `${approx}$0.00`;
  }
  if (amount > 0 && amount < USD_POSITIVE_FLOOR) {
    return `${approx}<$0.000001`;
  }
  if (amount > 0 && amount < ONE_CENT) {
    const fixed = amount.toFixed(6);
    const trimmed = fixed.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
    if (trimmed === '0' || trimmed === '0.0') {
      return `${approx}<$0.000001`;
    }
    return `${approx}$${trimmed}`;
  }
  return `${approx}$${amount.toFixed(2)}`;
}

/** Token counts render with thousands separators; null means the provider reported none. */
export function fmtTok(n: number | null): string {
  return n === null ? 'n/a' : n.toLocaleString('en-US');
}

/**
 * Human label for one report group — includes every dimension fixed for `groupBy`
 * so exact groups never collide in the UI solely because secondary dims were omitted.
 */
export function groupLabel(group: UsageReportGroup, groupBy: UsageGroupBy): string {
  const d = group.dimensions;
  switch (groupBy) {
    case 'agent':
      return d.agentProvider ?? '(unknown agent)';
    case 'provider':
      return d.provider ?? '(unknown provider)';
    case 'model': {
      // Fixed dims: provider, model, modelSource
      const p = d.provider ?? '(unknown provider)';
      const m = d.model === null || d.model === undefined ? '(unknown model)' : d.model;
      return `${p}/${m} · ${formatModelSourceLabel(d.modelSource)}`;
    }
    case 'project': {
      // Fixed dims: codebaseId, codebaseName (null = unassigned/deleted)
      const name =
        d.codebaseName === null || d.codebaseName === undefined
          ? '(no project name)'
          : d.codebaseName;
      const id =
        d.codebaseId === null || d.codebaseId === undefined ? '(no project id)' : d.codebaseId;
      return `${name} · id ${id}`;
    }
    case 'run': {
      // Fixed dims: runId, workflowName, codebaseId — full runId, never truncated
      const run = d.runId !== undefined && d.runId !== '' ? d.runId : '(unknown run)';
      const wf = d.workflowName ?? '(unknown workflow)';
      const projectId =
        d.codebaseId === null || d.codebaseId === undefined || d.codebaseId === ''
          ? '(no project id)'
          : d.codebaseId;
      return `${run} · ${wf} · project ${projectId}`;
    }
    case 'day':
      return d.day ?? '(unknown day)';
    case 'node': {
      // Fixed dims: runId, nodeId, agentProvider, provider, model, modelSource, kind
      const nodeId = d.nodeId === null || d.nodeId === undefined ? '(unattributed)' : d.nodeId;
      const runId = d.runId !== undefined && d.runId !== '' ? d.runId : '(unknown run)';
      const agent = d.agentProvider ?? '(unknown agent)';
      const provider = d.provider ?? '(unknown provider)';
      const model = d.model === null || d.model === undefined ? '(unknown model)' : d.model;
      return [
        nodeId,
        `run ${runId}`,
        `agent ${agent}`,
        `${provider}/${model}`,
        formatModelSourceLabel(d.modelSource),
        formatKindLabel(d.kind),
      ].join(' · ');
    }
  }
}

/** Explicit modelSource label — missing/unknown never look like a real source id. */
function formatModelSourceLabel(modelSource: string | undefined): string {
  if (modelSource === undefined || modelSource === 'unknown') {
    return 'unknown model source';
  }
  return `source ${modelSource}`;
}

/** Explicit kind label — null/undefined map to unclassified (SQL NULL). */
function formatKindLabel(kind: string | null | undefined): string {
  if (kind === null || kind === undefined) {
    return 'unclassified kind';
  }
  return `kind ${kind}`;
}

/**
 * Pure helpers exported for unit tests — loading/error/empty/event-only/filter states.
 *
 * Order matters:
 * 1. unavailable / null
 * 2. historical never-recorded (`hasRecordedUsage: false`)
 * 3. true event-only (base scope has usage events and ZERO ledgered rows)
 * 4. dimension-filter no-match (base scope has any ledgered rows, zero matched groups;
 *    partial unledgered may still ride as a separate base-scope warning)
 * 5. has-data (matched ledger rows; partial unledgered is a warning inside this state)
 *
 * Coverage is conservative date/project/run/node integrity and does NOT include
 * provider/model/kind filters. True event-only is defined from base ledger coverage
 * (`ledgeredEventCount === 0`), never from `recordCount===0` alone under dimension filters.
 * A base with any ledgered event + empty matched groups is a filter miss — not wholly
 * event-only — even when some sibling events remain unledgered.
 */
export type UsageUiState =
  | 'unavailable'
  | 'not-recorded'
  | 'event-only'
  | 'filter-empty'
  | 'has-data';

export function describeUsageState(report: UsageReport | null, unavailable: boolean): UsageUiState {
  if (unavailable || report === null) return 'unavailable';
  if (!report.coverage.hasRecordedUsage) return 'not-recorded';

  const { unledgeredEventCount, ledgeredEventCount, usageEventCount } = report.coverage;
  if (report.totals.recordCount === 0) {
    // True event-only: base scope recorded usage events but materialised ZERO ledger rows.
    // Dimension filters must not reclassify a partially-ledgered base as wholly event-only.
    if (ledgeredEventCount === 0 && (unledgeredEventCount > 0 || usageEventCount > 0)) {
      return 'event-only';
    }
    // Any ledgered base event + zero matched ledger rows = provider/model/kind filter miss.
    // Partial unledgered (if any) is a separate base-scope warning, not this empty state.
    return 'filter-empty';
  }
  return 'has-data';
}

/** Compact per-dimension missing counters — separate from unpriced USD / ledger coverage. */
export function formatMissingMeasures(m: UsageMetrics): string {
  return [
    `in:${String(m.missingTokensInput)}`,
    `out:${String(m.missingTokensOutput)}`,
    `reason:${String(m.missingTokensReasoning)}`,
    `cacheR:${String(m.missingTokensCacheRead)}`,
    `cacheW:${String(m.missingTokensCacheWrite)}`,
    `req:${String(m.missingRequests)}`,
  ].join(' ');
}

/**
 * Shared warning copy for Cost table + run header when events lack ledger rows.
 * Always uses exact `unledgeredEventCount` — never substitutes total event count.
 */
export function eventOnlyUsageMessage(coverage: UsageReport['coverage']): string {
  const n = coverage.unledgeredEventCount;
  const label = n === 1 ? '1 usage event' : `${String(n)} usage events`;
  return `${label} recorded without ledger rows (event-only fallback). Totals are incomplete and under-counted.`;
}

export const USAGE_GROUP_OPTIONS: readonly { value: UsageGroupBy; label: string }[] = [
  { value: 'provider', label: 'Provider' },
  { value: 'agent', label: 'Agent' },
  { value: 'model', label: 'Model' },
  { value: 'project', label: 'Project' },
  { value: 'run', label: 'Run' },
  { value: 'day', label: 'Day' },
  { value: 'node', label: 'Node (needs run id)' },
];

export const USAGE_KIND_OPTIONS: readonly { value: '' | UsageKindFilter; label: string }[] = [
  { value: '', label: 'Any kind' },
  { value: 'unclassified', label: 'Unclassified' },
  { value: 'advisor', label: 'Advisor' },
  { value: 'subagent', label: 'Subagent' },
];

export interface CostFilters {
  fromDay: string;
  throughDay: string;
  codebaseId: string;
  agentProvider: string;
  provider: string;
  model: string;
  kind: '' | UsageKindFilter;
  runId: string;
  nodeId: string;
  groupBy: UsageGroupBy;
}

export function defaultCostFilters(): CostFilters {
  const now = new Date();
  return {
    fromDay: utcMonthStart(now),
    throughDay: utcDateOnly(now),
    codebaseId: '',
    agentProvider: '',
    provider: '',
    model: '',
    kind: '',
    runId: '',
    nodeId: '',
    groupBy: 'provider',
  };
}

export function costFiltersToQuery(f: CostFilters): UsageQuery | { error: string } {
  const range = inclusiveUtcRangeToApi(f.fromDay, f.throughDay);
  if ('error' in range) return range;
  if (f.groupBy === 'node' && f.runId.trim() === '') {
    return { error: 'Grouping by node requires a run id.' };
  }
  if (f.nodeId.trim() !== '' && f.runId.trim() === '') {
    return { error: 'Node filter requires a run id.' };
  }
  const q: UsageQuery = {
    from: range.from,
    to: range.to,
    groupBy: f.groupBy,
  };
  if (f.codebaseId !== '') q.codebaseId = f.codebaseId;
  if (f.agentProvider.trim() !== '') q.agentProvider = f.agentProvider.trim();
  if (f.provider.trim() !== '') q.provider = f.provider.trim();
  if (f.model.trim() !== '') q.model = f.model.trim();
  if (f.kind !== '') q.kind = f.kind;
  if (f.runId.trim() !== '') q.runId = f.runId.trim();
  if (f.nodeId.trim() !== '') q.nodeId = f.nodeId.trim();
  return q;
}
