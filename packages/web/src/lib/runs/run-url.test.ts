import { describe, expect, test } from 'bun:test';

import {
  buildRunPath,
  filterFromLegacyStatus,
  isRunTab,
  keepListParams,
  legacyRunTarget,
  parseNodeColumnTab,
  parseRunListFilter,
} from './run-url';

describe('buildRunPath', () => {
  test('builds run, node and tab paths', () => {
    expect(buildRunPath('run-1')).toBe('/runs/run-1');
    expect(buildRunPath('run-1', 'review')).toBe('/runs/run-1/review');
    expect(buildRunPath('run-1', 'review', 'history')).toBe('/runs/run-1/review?tab=history');
  });

  test('does not write the default tab', () => {
    expect(buildRunPath('run-1', 'review', 'stream')).toBe('/runs/run-1/review');
  });

  test('encodes ids', () => {
    expect(buildRunPath('a b', 'x/y')).toBe('/runs/a%20b/x%2Fy');
  });

  test('a run tab without a node keeps the tab', () => {
    expect(buildRunPath('run-1', null, 'terminal')).toBe('/runs/run-1?tab=terminal');
  });
});

describe('parseNodeColumnTab', () => {
  test('accepts node and run tabs', () => {
    expect(parseNodeColumnTab('raw')).toBe('raw');
    expect(parseNodeColumnTab('changes')).toBe('changes');
  });

  test('falls back to the stream tab', () => {
    expect(parseNodeColumnTab(null)).toBe('stream');
    expect(parseNodeColumnTab('graph')).toBe('stream');
  });

  test('tells run tabs from node tabs', () => {
    expect(isRunTab('terminal')).toBe(true);
    expect(isRunTab('history')).toBe(false);
  });
});

describe('run list filter', () => {
  test('parses known filters and defaults to active', () => {
    expect(parseRunListFilter('needs')).toBe('needs');
    expect(parseRunListFilter(null)).toBe('active');
    expect(parseRunListFilter('paused')).toBe('active');
  });

  test('maps old dashboard statuses to tabs', () => {
    expect(filterFromLegacyStatus('running')).toBe('active');
    expect(filterFromLegacyStatus('paused')).toBe('needs');
    expect(filterFromLegacyStatus('completed')).toBe('finished');
    expect(filterFromLegacyStatus('failed')).toBe('finished');
    expect(filterFromLegacyStatus('cancelled')).toBe('all');
    expect(filterFromLegacyStatus('pending')).toBe('all');
  });
});

describe('legacyRunTarget', () => {
  test('moves the node query into the path', () => {
    expect(legacyRunTarget('run-1', '?node=review')).toBe('/runs/run-1/review');
  });

  test('keeps a link without a node', () => {
    expect(legacyRunTarget('run-1', '')).toBe('/runs/run-1');
  });
});

describe('keepListParams', () => {
  test('carries the list filters to a run path', () => {
    const current = new URLSearchParams('filter=needs&q=fix&tab=raw');
    expect(keepListParams('/runs/run-1', current)).toBe('/runs/run-1?filter=needs&q=fix');
  });

  test('keeps the path query and adds the filters after it', () => {
    const current = new URLSearchParams('range=7d');
    expect(keepListParams('/runs/run-1/a?tab=history', current)).toBe(
      '/runs/run-1/a?tab=history&range=7d'
    );
  });

  test('a path without filters stays as it is', () => {
    expect(keepListParams('/runs/run-1', new URLSearchParams())).toBe('/runs/run-1');
  });
});
