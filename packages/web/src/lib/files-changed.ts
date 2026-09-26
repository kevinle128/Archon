/**
 * Shared, render-neutral helpers for the run-level Files Changed panel.
 * Both Node Room shells import from here and write their own thin JSX —
 * this file owns no markup.
 */
import type { AttributedNodeExecution, FilesChangedPath, FilesChangedResponse } from './api';

export type { AttributedNodeExecution, FilesChangedPath, FilesChangedResponse };

export const FILES_CHANGED_EMPTY_COPY = 'No repository changes recorded for this run.';

/** True when the response carries no changed paths — the approved empty state, not an error. */
export function isFilesChangedEmpty(response: FilesChangedResponse): boolean {
  return response.files.length === 0;
}

/**
 * Elides a repository path in the middle, keeping the file name and enough of
 * the leading directory to stay recognizable — matching the shared rule that
 * path headlines elide in the middle (commands and patterns elide at the end
 * instead, elsewhere).
 */
export function elidePathMiddle(path: string, maxLength: number): string {
  if (path.length <= maxLength || maxLength <= 1) return path;
  const ellipsis = '…';
  const keep = maxLength - ellipsis.length;
  const headLength = Math.ceil(keep / 2);
  const tailLength = Math.floor(keep / 2);
  return `${path.slice(0, headLength)}${ellipsis}${path.slice(path.length - tailLength)}`;
}

/**
 * Renders a path's node executions as a short summary label. Empty means the
 * path changed but no execution's evidence explains it — the caller renders
 * that as "unknown", never as zero.
 */
export function describeFilesChangedExecutions(
  executions: readonly AttributedNodeExecution[]
): string {
  if (executions.length === 0) return 'unknown';
  if (executions.length === 1) return executions[0]?.nodeId ?? 'unknown';
  return `${executions.length.toString()} node executions`;
}

/** Deterministic repository order is the order the server already returned. */
export function orderedFilesChangedPaths(
  response: FilesChangedResponse
): readonly FilesChangedPath[] {
  return response.files;
}
