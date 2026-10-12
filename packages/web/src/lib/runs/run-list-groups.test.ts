import { describe, expect, test } from 'bun:test';

import type { DashboardCounts } from '@/lib/api';

import { countForFilter, statusInFilter } from './run-list-groups';

const COUNTS: DashboardCounts = {
  all: 20,
  running: 3,
  paused: 2,
  completed: 9,
  failed: 4,
  cancelled: 1,
  pending: 1,
};

describe('countForFilter', () => {
  test('Active counts running and paused runs', () => {
    expect(countForFilter('active', COUNTS)).toBe(5);
  });

  test('Needs you counts paused runs', () => {
    expect(countForFilter('needs', COUNTS)).toBe(2);
  });

  test('Finished counts completed and failed runs', () => {
    expect(countForFilter('finished', COUNTS)).toBe(13);
  });

  test('All counts every run', () => {
    expect(countForFilter('all', COUNTS)).toBe(20);
  });

  test('missing counts are 0', () => {
    expect(countForFilter('all', undefined)).toBe(0);
  });
});

describe('statusInFilter', () => {
  test('places each status in its tabs', () => {
    expect(statusInFilter('active', 'paused')).toBe(true);
    expect(statusInFilter('needs', 'running')).toBe(false);
    expect(statusInFilter('finished', 'cancelled')).toBe(false);
    expect(statusInFilter('all', 'cancelled')).toBe(true);
  });
});
