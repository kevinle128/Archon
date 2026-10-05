import { describe, test, expect } from 'bun:test';
import {
  costFiltersToQuery,
  defaultCostFilters,
  describeUsageState,
  formatUsdAmount,
  groupLabel,
} from './usage-view';
import type { UsageReport, UsageReportGroup } from './usage';

function report(over: {
  hasRecordedUsage?: boolean;
  recordCount?: number;
  ledgered?: number;
  unledgered?: number;
  events?: number;
}): UsageReport {
  return {
    coverage: {
      hasRecordedUsage: over.hasRecordedUsage ?? true,
      ledgeredEventCount: over.ledgered ?? 0,
      unledgeredEventCount: over.unledgered ?? 0,
      usageEventCount: over.events ?? 0,
    },
    totals: { recordCount: over.recordCount ?? 0 },
    groups: [],
    groupBy: 'provider',
  } as unknown as UsageReport;
}

describe('formatUsdAmount', () => {
  test('null is n/a, zero is $0.00, estimates get a tilde prefix', () => {
    expect(formatUsdAmount(null)).toBe('n/a');
    expect(formatUsdAmount(0)).toBe('$0.00');
    expect(formatUsdAmount(1.234, true)).toBe('\u2248$1.23');
  });
  test('sub-cent amounts stay visible', () => {
    expect(formatUsdAmount(0.0042)).toBe('$0.0042');
    expect(formatUsdAmount(0.0000001)).toBe('<$0.000001');
  });
});

describe('describeUsageState', () => {
  test('null report or unavailable flag is unavailable', () => {
    expect(describeUsageState(null, false)).toBe('unavailable');
    expect(describeUsageState(report({}), true)).toBe('unavailable');
  });
  test('never recorded is distinct from event-only', () => {
    expect(describeUsageState(report({ hasRecordedUsage: false }), false)).toBe('not-recorded');
  });
  test('events with zero ledger rows are event-only', () => {
    expect(describeUsageState(report({ unledgered: 3, events: 3 }), false)).toBe('event-only');
  });
  test('ledgered base with no matched rows is a filter miss', () => {
    expect(describeUsageState(report({ ledgered: 2, events: 2 }), false)).toBe('filter-empty');
  });
  test('matched rows are has-data', () => {
    expect(describeUsageState(report({ recordCount: 4, ledgered: 4, events: 4 }), false)).toBe(
      'has-data'
    );
  });
});

describe('groupLabel', () => {
  const g = (dimensions: Record<string, unknown>): UsageReportGroup =>
    ({ dimensions }) as unknown as UsageReportGroup;
  test('provider falls back to an explicit unknown label', () => {
    expect(groupLabel(g({ provider: 'anthropic' }), 'provider')).toBe('anthropic');
    expect(groupLabel(g({}), 'provider')).toBe('(unknown provider)');
  });
  test('model label carries provider, model and source', () => {
    expect(
      groupLabel(g({ provider: 'openai', model: 'gpt-5.5', modelSource: 'sdk' }), 'model')
    ).toBe('openai/gpt-5.5 \u00b7 source sdk');
  });
});

describe('costFiltersToQuery', () => {
  test('default filters produce a half-open UTC range and a provider grouping', () => {
    const q = costFiltersToQuery({
      ...defaultCostFilters(),
      fromDay: '2026-09-01',
      throughDay: '2026-09-30',
    });
    expect(q).toMatchObject({
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-10-01T00:00:00.000Z',
      groupBy: 'provider',
    });
  });
  test('node grouping and node filter both require a run id', () => {
    const base = { ...defaultCostFilters(), fromDay: '2026-09-01', throughDay: '2026-09-02' };
    expect(costFiltersToQuery({ ...base, groupBy: 'node' })).toHaveProperty('error');
    expect(costFiltersToQuery({ ...base, nodeId: 'n1' })).toHaveProperty('error');
    expect(costFiltersToQuery({ ...base, groupBy: 'node', runId: 'r1' })).not.toHaveProperty(
      'error'
    );
  });
  test('blank filters are omitted from the query', () => {
    const q = costFiltersToQuery({
      ...defaultCostFilters(),
      fromDay: '2026-09-01',
      throughDay: '2026-09-02',
      model: '  ',
    });
    expect(q).not.toHaveProperty('model');
  });
});
