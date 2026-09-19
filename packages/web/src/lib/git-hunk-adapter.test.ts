import { describe, expect, test } from 'bun:test';
import type { HunkData } from 'react-diff-view';

import type { components } from '@/lib/api.generated';

import { hunksForSide, toChangeData, toHunkData } from './git-hunk-adapter';

type GitDiffChange = components['schemas']['GitDiffChange'];
type GitDiffHunk = components['schemas']['GitDiffHunk'];

const SAMPLE_HUNK: GitDiffHunk = {
  header: '@@ -1,3 +1,3 @@',
  oldStart: 1,
  oldLines: 3,
  newStart: 1,
  newLines: 3,
  changes: [
    { type: 'normal', content: 'same', oldLine: 1, newLine: 1 },
    { type: 'delete', content: 'old', oldLine: 2 },
    { type: 'insert', content: 'new', newLine: 2 },
    { type: 'normal', content: 'tail', oldLine: 3, newLine: 3 },
  ],
};

describe('toChangeData', () => {
  test('maps insert, delete, and normal changes onto react-diff-view 3.3.3 unions', () => {
    expect(toChangeData({ type: 'insert', content: 'new', newLine: 2 })).toEqual({
      type: 'insert',
      content: 'new',
      lineNumber: 2,
      isInsert: true,
    });
    expect(toChangeData({ type: 'delete', content: 'old', oldLine: 3 })).toEqual({
      type: 'delete',
      content: 'old',
      lineNumber: 3,
      isDelete: true,
    });
    expect(
      toChangeData({
        type: 'normal',
        content: 'same',
        oldLine: 4,
        newLine: 5,
      })
    ).toEqual({
      type: 'normal',
      content: 'same',
      oldLineNumber: 4,
      newLineNumber: 5,
      isNormal: true,
    });
  });

  test('throws Invalid git hunk change when a required line number is missing', () => {
    const malformed = { type: 'insert', content: 'new' } as GitDiffChange;
    expect(() => toChangeData(malformed)).toThrow('Invalid git hunk change');
  });
});

describe('toHunkData', () => {
  test('copies hunk coordinates and maps each change', () => {
    expect(toHunkData(SAMPLE_HUNK)).toEqual({
      content: '@@ -1,3 +1,3 @@',
      oldStart: 1,
      oldLines: 3,
      newStart: 1,
      newLines: 3,
      changes: [
        {
          type: 'normal',
          content: 'same',
          oldLineNumber: 1,
          newLineNumber: 1,
          isNormal: true,
        },
        { type: 'delete', content: 'old', lineNumber: 2, isDelete: true },
        { type: 'insert', content: 'new', lineNumber: 2, isInsert: true },
        {
          type: 'normal',
          content: 'tail',
          oldLineNumber: 3,
          newLineNumber: 3,
          isNormal: true,
        },
      ],
    });
  });
});

describe('hunksForSide', () => {
  test('old drops insertions and new drops deletions while both keep normal lines', () => {
    const hunks: readonly HunkData[] = [toHunkData(SAMPLE_HUNK)];

    expect(hunksForSide(hunks, 'old')[0]?.changes.map(change => change.type)).toEqual([
      'normal',
      'delete',
      'normal',
    ]);
    expect(hunksForSide(hunks, 'new')[0]?.changes.map(change => change.type)).toEqual([
      'normal',
      'insert',
      'normal',
    ]);
  });

  test('drops a hunk whose remaining side has no changes', () => {
    const insertOnly = toHunkData({
      header: '@@ -0,0 +1,1 @@',
      oldStart: 0,
      oldLines: 0,
      newStart: 1,
      newLines: 1,
      changes: [{ type: 'insert', content: 'added', newLine: 1 }],
    });

    expect(hunksForSide([insertOnly], 'old')).toEqual([]);
    expect(hunksForSide([insertOnly], 'new')).toHaveLength(1);
  });
});
