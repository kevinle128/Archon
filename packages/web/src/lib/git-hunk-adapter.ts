import type { ChangeData, HunkData } from 'react-diff-view';

import type { components } from '@/lib/api.generated';

type GitDiffChange = components['schemas']['GitDiffChange'];
type GitDiffHunk = components['schemas']['GitDiffHunk'];

function requiredLine(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error('Invalid git hunk change');
  }
  return value;
}

export function toChangeData(change: GitDiffChange): ChangeData {
  switch (change.type) {
    case 'insert':
      return {
        type: 'insert',
        content: change.content,
        lineNumber: requiredLine(change.newLine),
        isInsert: true,
      };
    case 'delete':
      return {
        type: 'delete',
        content: change.content,
        lineNumber: requiredLine(change.oldLine),
        isDelete: true,
      };
    case 'normal':
      return {
        type: 'normal',
        content: change.content,
        oldLineNumber: requiredLine(change.oldLine),
        newLineNumber: requiredLine(change.newLine),
        isNormal: true,
      };
  }
}

export function toHunkData(hunk: GitDiffHunk): HunkData {
  return {
    content: hunk.header,
    oldStart: hunk.oldStart,
    oldLines: hunk.oldLines,
    newStart: hunk.newStart,
    newLines: hunk.newLines,
    changes: hunk.changes.map(toChangeData),
  };
}

export function hunksForSide(hunks: readonly HunkData[], side: 'old' | 'new'): HunkData[] {
  return hunks.flatMap(hunk => {
    const changes = hunk.changes.filter(change =>
      side === 'old' ? change.type !== 'insert' : change.type !== 'delete'
    );
    return changes.length === 0 ? [] : [{ ...hunk, changes }];
  });
}
