// Types
export type {
  RepoPath,
  BranchName,
  WorktreePath,
  GitResult,
  GitError,
  WorkspaceSyncMode,
  WorkspaceSyncState,
  WorkspaceSyncResult,
  WorktreeInfo,
} from './types';
export { toRepoPath, toBranchName, toWorktreePath } from './types';

// Process and filesystem wrappers
export { execFileAsync, mkdirAsync, resolveBashPath } from './exec';

// Live file bytes and Now diffs
export { fileAt, fileDiff } from './file-read';
export type {
  DiffChange,
  DiffHunk,
  FileAtBytesResult,
  FileAtIntent,
  FileAtRequest,
  FileAtResult,
  FileAtSource,
  FileAtStreamResult,
  FileDiffRequest,
  FileDiffResult,
} from './file-read';
export type { GitFilePresentation } from './viewer-limits';

// Worktree operations
export {
  getWorktreeBase,
  isProjectScopedWorktreeBase,
  worktreeExists,
  listWorktrees,
  findWorktreeByBranch,
  isWorktreePath,
  removeWorktree,
  getCanonicalRepoPath,
  verifyWorktreeOwnership,
} from './worktree';
export type { WorktreeLayout, WorktreeBaseOverride } from './worktree';

// Branch operations
export {
  getDefaultBranch,
  getUniqueCommitCount,
  getCurrentBranch,
  countCommitsAhead,
  checkout,
  hasUncommittedChanges,
  commitAllChanges,
  isBranchMerged,
  isPatchEquivalent,
  isAncestorOf,
  getLastCommitDate,
} from './branch';

// Changed files (live uncommitted status)
export {
  changedFiles,
  isGitWorkTree,
  parseNameStatusZ,
  parsePorcelainV1Z,
  projectChangedFiles,
} from './changed-files';
export type {
  ChangedFile,
  ChangedFileStatus,
  ChangedFilesRequest,
  ChangedFilesResult,
  PorcelainEntry,
} from './changed-files';

// Commit log (run-branch history)
export { GIT_LOG_MAX_COMMITS, log } from './git-log';
export type { GitLogCommit, GitLogResult } from './git-log';

// Forge detection
export { detectForge } from './forge';
export type { ForgeType, ForgeInfo } from './forge';

// Repository operations
export {
  findRepoRoot,
  getDefaultRemote,
  getRemoteUrl,
  listChildRepos,
  syncWorkspace,
  cloneRepository,
  syncRepository,
  addSafeDirectory,
} from './repo';

// Manual failed-node retry ref helpers
export {
  buildCheckpointRef,
  buildRetrySafetyRef,
  assertGitRepository,
  validateGitRef,
  verifyCommitRef,
  isCommitAncestorOfHead,
  hasGitVisibleChanges,
  hasTrackedChanges,
  createGitVisibleChangesCommit,
  createTrackedChangesCommit,
  upsertCheckpointRef,
  createRetrySafetyRef,
  resetTrackedFilesToCommit,
  deleteRetryRefsByRunId,
} from './retry-refs';
export type {
  RetryRefIdentity,
  CheckpointRefIdentity,
  RetrySafetyRefIdentity,
  RetryRefResult,
  DeleteRetryRefsResult,
} from './retry-refs';

// Node execution git evidence (start/end snapshots for change attribution)
export {
  buildExecutionEvidenceRef,
  captureExecutionEvidenceSnapshot,
  diffCommitRange,
} from './execution-evidence';
export type { ExecutionEvidenceRefIdentity, ExecutionEvidenceSnapshot } from './execution-evidence';
