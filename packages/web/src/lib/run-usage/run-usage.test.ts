import { describe, expect, test } from 'bun:test';

import type { UsageMetrics, UsageReport, UsageReportGroup } from '@/lib/settings/usage';

import {
  aggregateUsageMetrics,
  collectUsageByNode,
  describeRunCost,
  readLegacyRunCost,
  sumNullableMetric,
  usageGroupDetail,
  usageGroupLabel,
} from './run-usage';

function metrics(overrides: Partial<UsageMetrics> = {}): UsageMetrics {
  return {
    tokensInput: 100,
    tokensOutput: 50,
    tokensReasoning: null,
    tokensCacheRead: null,
    tokensCacheWrite: null,
    requests: 1,
    reportedUsd: 0.42,
    estimatedUsd: null,
    recordCount: 1,
    missingTokensInput: 0,
    missingTokensOutput: 0,
    missingTokensReasoning: 1,
    missingTokensCacheRead: 1,
    missingTokensCacheWrite: 1,
    missingRequests: 0,
    rowsMissingUsd: 0,
    ...overrides,
  };
}

function group(
  nodeId: string | null | undefined,
  m: Partial<UsageMetrics> = {},
  model = 'claude-sonnet-4'
): UsageReportGroup {
  return {
    dimensions: {
      nodeId,
      provider: 'anthropic',
      model,
      modelSource: 'reported',
      kind: null,
    },
    metrics: metrics(m),
  };
}

function report(
  overrides: Partial<Omit<UsageReport, 'coverage'>> & {
    coverage?: Partial<UsageReport['coverage']>;
  } = {}
): UsageReport {
  const { coverage, ...rest } = overrides;
  return {
    scope: { from: null, to: null, includesChildRollup: false },
    groupBy: 'node',
    totals: metrics(),
    groups: [group('a')],
    coverage: {
      usageEventCount: 1,
      ledgeredEventCount: 1,
      unledgeredEventCount: 0,
      hasRecordedUsage: true,
      historicalBackfill: false,
      filterScope: 'date-project-run-node',
      ...coverage,
    },
    ...rest,
  };
}

describe('sumNullableMetric', () => {
  test('keeps null only when both sides are null and keeps zero', () => {
    expect(sumNullableMetric(null, null)).toBeNull();
    expect(sumNullableMetric(null, 0)).toBe(0);
    expect(sumNullableMetric(2, null)).toBe(2);
    expect(sumNullableMetric(2, 3)).toBe(5);
  });
});

describe('aggregateUsageMetrics', () => {
  test('sums nullable measures and counters, never mixing reported with estimated USD', () => {
    const total = aggregateUsageMetrics([
      group('a', { reportedUsd: 0.4, estimatedUsd: null, rowsMissingUsd: 1 }),
      group('a', { reportedUsd: null, estimatedUsd: 0.1, tokensInput: null }, 'other'),
    ]);
    expect(total.reportedUsd).toBe(0.4);
    expect(total.estimatedUsd).toBe(0.1);
    expect(total.tokensInput).toBe(100);
    expect(total.tokensReasoning).toBeNull();
    expect(total.recordCount).toBe(2);
    expect(total.rowsMissingUsd).toBe(1);
    expect(total.missingTokensReasoning).toBe(2);
  });

  test('returns all-null measures for no groups', () => {
    const total = aggregateUsageMetrics([]);
    expect(total.reportedUsd).toBeNull();
    expect(total.recordCount).toBe(0);
  });
});

describe('collectUsageByNode', () => {
  test('keeps every group that shares a node id and skips unattributed groups', () => {
    const map = collectUsageByNode(
      report({ groups: [group('a'), group('a', {}, 'other'), group('b'), group(null), group('')] })
    );
    expect([...map.keys()].sort()).toEqual(['a', 'b']);
    expect(map.get('a')?.groups).toHaveLength(2);
    expect(map.get('a')?.aggregate.recordCount).toBe(2);
  });

  test('is empty for a failed query or a report not grouped by node', () => {
    expect(collectUsageByNode(null).size).toBe(0);
    expect(collectUsageByNode(report({ groupBy: 'provider' })).size).toBe(0);
  });
});

describe('group labels', () => {
  test('label falls back to explicit unknown markers', () => {
    expect(usageGroupLabel(group('a'))).toBe('anthropic/claude-sonnet-4');
    const bare: UsageReportGroup = { dimensions: {}, metrics: metrics() };
    expect(usageGroupLabel(bare)).toBe('unknown provider/unknown model');
  });

  test('detail lists the model source and kind, and is empty when neither is known', () => {
    const advisor: UsageReportGroup = {
      dimensions: { modelSource: 'requested', kind: 'advisor' },
      metrics: metrics(),
    };
    expect(usageGroupDetail(advisor)).toBe('requested model · advisor');
    expect(usageGroupDetail({ dimensions: { modelSource: 'unknown' }, metrics: metrics() })).toBe(
      ''
    );
  });
});

describe('readLegacyRunCost', () => {
  test('accepts finite non-negative numbers including zero', () => {
    expect(readLegacyRunCost({ total_cost_usd: 0 })).toBe(0);
    expect(readLegacyRunCost({ total_cost_usd: 1.5 })).toBe(1.5);
  });

  test('rejects missing, negative, non-finite and non-number values', () => {
    expect(readLegacyRunCost(undefined)).toBeNull();
    expect(readLegacyRunCost({})).toBeNull();
    expect(readLegacyRunCost({ total_cost_usd: -1 })).toBeNull();
    expect(readLegacyRunCost({ total_cost_usd: Number.NaN })).toBeNull();
    expect(readLegacyRunCost({ total_cost_usd: '2' })).toBeNull();
  });
});

describe('describeRunCost', () => {
  test('a failed usage query is unavailable, even when a legacy total exists', () => {
    expect(describeRunCost(null, 3)).toEqual({ kind: 'unavailable' });
  });

  test('ledger data reports reported and estimated separately', () => {
    const state = describeRunCost(
      report({ totals: metrics({ reportedUsd: 0.42, estimatedUsd: 0.1 }) }),
      9
    );
    expect(state).toEqual({
      kind: 'ledger',
      reportedUsd: 0.42,
      estimatedUsd: 0.1,
      incompleteMessage: null,
    });
  });

  test('unledgered events beside ledger rows mark the totals incomplete', () => {
    const state = describeRunCost(
      report({ coverage: { usageEventCount: 3, ledgeredEventCount: 2, unledgeredEventCount: 1 } }),
      null
    );
    expect(state.kind).toBe('ledger');
    if (state.kind === 'ledger') {
      expect(state.incompleteMessage).toContain('1 usage event recorded without ledger rows');
    }
  });

  test('usage events without any ledger row is event-only, never not-recorded', () => {
    const state = describeRunCost(
      report({
        totals: metrics({ recordCount: 0 }),
        groups: [],
        coverage: { usageEventCount: 2, ledgeredEventCount: 0, unledgeredEventCount: 2 },
      }),
      null
    );
    expect(state.kind).toBe('event-only');
  });

  test('no recorded usage falls back to a labeled legacy total, else not-recorded', () => {
    const empty = report({
      totals: metrics({ recordCount: 0 }),
      groups: [],
      coverage: { usageEventCount: 0, ledgeredEventCount: 0, hasRecordedUsage: false },
    });
    expect(describeRunCost(empty, 0.75)).toEqual({ kind: 'legacy', costUsd: 0.75 });
    expect(describeRunCost(empty, null)).toEqual({ kind: 'not-recorded' });
  });
});
