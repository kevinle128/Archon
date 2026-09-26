import { execFileAsync } from './exec';
import { parseNameStatusZ, projectChangedFiles, type ChangedFile } from './changed-files';
import { createGitVisibleChangesCommit, validateGitRef } from './retry-refs';

/**
 * Identifies one boundary (start or end) of one node execution's git snapshot.
 * `executionId` must be unique per node execution so repeated executions of
 * the same node (a retried node, a loop body, a reactivated route target)
 * never share a ref and never overwrite each other's evidence.
 */
export interface ExecutionEvidenceRefIdentity {
  runId: string;
  executionId: string;
  boundary: 'start' | 'end';
}

export interface ExecutionEvidenceSnapshot {
  ref: string;
  commitSha: string;
  createdCommit: boolean;
}

export function buildExecutionEvidenceRef(identity: ExecutionEvidenceRefIdentity): string {
  return `refs/archon/evidence/${identity.runId}/${identity.executionId}/${identity.boundary}`;
}

/**
 * Snapshots the current repository state (tracked and Git-visible untracked
 * changes, never ignored files) into an immutable commit and points a
 * dedicated ref at it. Reuses the same commit-then-bookmark technique as the
 * retry checkpoint mechanism: when nothing changed since the last commit, no
 * new commit is created and the ref simply bookmarks the existing HEAD.
 */
export async function captureExecutionEvidenceSnapshot(
  repoPath: string,
  identity: ExecutionEvidenceRefIdentity,
  message: string
): Promise<ExecutionEvidenceSnapshot> {
  const ref = buildExecutionEvidenceRef(identity);
  await validateGitRef(repoPath, ref);
  const result = await createGitVisibleChangesCommit(repoPath, message);
  await execFileAsync('git', ['update-ref', ref, result.commitSha], { cwd: repoPath });
  return { ref, commitSha: result.commitSha, createdCommit: result.createdCommit };
}

/**
 * Lists paths that differ between two commits, in deterministic repository
 * order. Used to compute what one node execution changed by comparing its
 * start and end snapshot commits. Returns an empty list when the two commits
 * are identical (nothing happened between the two boundaries).
 */
export async function diffCommitRange(
  repoPath: string,
  fromCommitSha: string,
  toCommitSha: string
): Promise<ChangedFile[]> {
  if (fromCommitSha === toCommitSha) return [];
  const result = await execFileAsync(
    'git',
    [
      '-C',
      repoPath,
      '--literal-pathspecs',
      '--no-optional-locks',
      'diff',
      '--name-status',
      '-z',
      '-M',
      '-C',
      fromCommitSha,
      toCommitSha,
    ],
    { cwd: repoPath }
  );
  return projectChangedFiles(parseNameStatusZ(result.stdout));
}
