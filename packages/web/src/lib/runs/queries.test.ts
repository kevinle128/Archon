import { describe, expect, test } from 'bun:test';

import type { DashboardRunResponse, DashboardRunsResult } from '@/lib/api';

import { mergeRunPages, parseRunDateRange, rangeStart } from './queries';

function run(id: string, startedAt: string): DashboardRunResponse {
  return { id, started_at: startedAt } as DashboardRunResponse;
}

function page(runs: DashboardRunResponse[], total: number): DashboardRunsResult {
  return {
    runs,
    total,
    counts: { all: 9, running: 1, paused: 1, completed: 5, failed: 2, cancelled: 0, pending: 0 },
  };
}

describe('mergeRunPages', () => {
  test('merges status pages newest first and sums totals', () => {
    const merged = mergeRunPages(
      [
        page([run('a', '2026-10-01T10:00:00Z')], 1),
        page([run('b', '2026-10-02T10:00:00Z'), run('c', '2026-09-30T10:00:00Z')], 4),
      ],
      50
    );
    expect(merged.runs.map(r => r.id)).toEqual(['b', 'a', 'c']);
    expect(merged.total).toBe(5);
    expect(merged.counts?.all).toBe(9);
  });

  test('cuts the merged list to the limit', () => {
    const merged = mergeRunPages(
      [page([run('a', '2026-10-01T10:00:00Z'), run('b', '2026-10-02T10:00:00Z')], 2)],
      1
    );
    expect(merged.runs.map(r => r.id)).toEqual(['b']);
  });

  test('ignores pages that have not loaded', () => {
    expect(mergeRunPages([undefined], 50)).toEqual({ runs: [], total: 0, counts: undefined });
  });
});

describe('date range', () => {
  test('parses known ranges and defaults to all time', () => {
    expect(parseRunDateRange('7d')).toBe('7d');
    expect(parseRunDateRange('year')).toBe('all');
    expect(parseRunDateRange(null)).toBe('all');
  });

  test('all time has no lower bound', () => {
    expect(rangeStart('all')).toBeUndefined();
  });

  test('today starts at local midnight', () => {
    const now = new Date(2026, 9, 12, 15, 30);
    expect(rangeStart('today', now)).toBe(new Date(2026, 9, 12, 0, 0).toISOString());
  });

  test('7 days starts a week earlier', () => {
    const now = new Date(2026, 9, 12, 15, 30);
    expect(rangeStart('7d', now)).toBe(new Date(2026, 9, 5, 15, 30).toISOString());
  });
});
