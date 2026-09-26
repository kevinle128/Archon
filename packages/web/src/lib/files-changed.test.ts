import { describe, expect, test } from 'bun:test';

import {
  describeFilesChangedExecutions,
  elidePathMiddle,
  isFilesChangedEmpty,
  orderedFilesChangedPaths,
} from './files-changed';
import type { FilesChangedResponse } from './api';

describe('isFilesChangedEmpty', () => {
  test('is true for zero files', () => {
    expect(isFilesChangedEmpty({ files: [] })).toBe(true);
  });

  test('is false when any path changed', () => {
    expect(isFilesChangedEmpty({ files: [{ path: 'a.ts', status: 'M', executions: [] }] })).toBe(
      false
    );
  });

  test('is true for the CAP-6 empty envelope', () => {
    expect(isFilesChangedEmpty({ emptyReason: 'no_checkout', files: [] })).toBe(true);
  });
});

describe('elidePathMiddle', () => {
  test('returns the path unchanged when it already fits', () => {
    expect(elidePathMiddle('src/a.ts', 20)).toBe('src/a.ts');
  });

  test('elides in the middle, keeping the start and end', () => {
    const path = 'packages/workflows/src/very/deeply/nested/module/file.ts';
    const result = elidePathMiddle(path, 24);
    expect(result.length).toBe(24);
    expect(result).toContain('…');
    expect(result.startsWith('packages/wor')).toBe(true);
    expect(result.endsWith('file.ts')).toBe(true);
  });
});

describe('describeFilesChangedExecutions', () => {
  test('reports unknown for no proven executions', () => {
    expect(describeFilesChangedExecutions([])).toBe('unknown');
  });

  test('names the single execution', () => {
    expect(
      describeFilesChangedExecutions([
        { nodeId: 'build', retryEpoch: 0, startedAt: 't1', endedAt: 't2' },
      ])
    ).toBe('build');
  });

  test('summarizes multiple executions by count', () => {
    expect(
      describeFilesChangedExecutions([
        { nodeId: 'build', retryEpoch: 0, startedAt: 't1', endedAt: 't2' },
        { nodeId: 'deploy', retryEpoch: 0, startedAt: 't3', endedAt: 't4' },
      ])
    ).toBe('2 node executions');
  });
});

describe('orderedFilesChangedPaths', () => {
  test('preserves the server-provided order', () => {
    const response: FilesChangedResponse = {
      files: [
        { path: 'b.ts', status: 'M', executions: [] },
        { path: 'a.ts', status: 'A', executions: [] },
      ],
    };
    expect(orderedFilesChangedPaths(response).map(f => f.path)).toEqual(['b.ts', 'a.ts']);
  });
});
