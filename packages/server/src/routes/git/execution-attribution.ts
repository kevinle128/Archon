/**
 * Attributes a run's changed repository paths to the node executions that
 * proved them, using only recorded git evidence — never provider prose or
 * tool names.
 *
 * Rules:
 *  - An execution counts only when its end commit is still an ancestor of
 *    (or equal to) the checkout's current HEAD. A `checkoutStrategy:
 *    'checkpoint'` retry resets the checkout to an earlier commit, orphaning
 *    every execution that ran after it — their end commits fall out of
 *    HEAD's ancestry and they are excluded. A `checkoutStrategy: 'current'`
 *    retry never resets anything, so an earlier attempt's commits stay
 *    exactly where they were and remain ancestors of HEAD — that attempt is
 *    still counted alongside the retry. Retry epoch number is never used as
 *    a proxy for this: only git ancestry decides.
 *  - An execution with no end evidence proves nothing.
 *  - Two executions whose recorded time ranges overlap share one checkout at
 *    the same moment, so neither one's diff can be trusted to be its own —
 *    both are excluded from confident attribution for every path.
 *  - A changed path with no execution that proves it is unknown, not
 *    omitted: the path still changed, we just cannot say which execution did
 *    it.
 */
import type { ChangedFile } from '@archon/git';
import type { WorkflowNodeExecutionEvidence } from '@archon/workflows/store';

/** True when `commitSha` is still an ancestor of (or equal to) the checkout's current HEAD. */
export type IsAncestorOfHead = (commitSha: string) => Promise<boolean>;

export interface AttributedNodeExecution {
  nodeId: string;
  retryEpoch: number;
  startedAt: string;
  endedAt: string;
}

export interface PathAttribution {
  path: string;
  status: ChangedFile['status'];
  /** Every execution proven (by non-overlapping git evidence) to have touched this path, in stable chronological order. Empty means unknown. */
  executions: AttributedNodeExecution[];
}

interface UsableExecution {
  evidenceId: string;
  nodeId: string;
  retryEpoch: number;
  startCommitSha: string;
  endCommitSha: string;
  startedAtIso: string;
  endedAtIso: string;
  startedAtMs: number;
  endedAtMs: number;
}

function toIso(value: Date | string): string {
  return typeof value === 'string' ? value : value.toISOString();
}

function toMs(value: Date | string): number {
  return typeof value === 'string' ? new Date(value).getTime() : value.getTime();
}

/**
 * Drops rows with no proven end state — an open or failed-to-capture
 * execution proves nothing — then keeps only executions whose end commit is
 * still an ancestor of HEAD (see the module docstring: this is the sole test
 * for whether a retry reset an earlier attempt away, never the epoch
 * number). An end commit that is still an ancestor of HEAD proves its start
 * commit is too, by transitivity along the same checkout lineage.
 */
async function toUsableExecutions(
  evidence: readonly WorkflowNodeExecutionEvidence[],
  isAncestorOfHead: IsAncestorOfHead
): Promise<UsableExecution[]> {
  const usable: UsableExecution[] = [];
  for (const row of evidence) {
    if (row.end_commit_sha === null || row.ended_at === null) continue;
    if (!(await isAncestorOfHead(row.end_commit_sha))) continue;
    usable.push({
      evidenceId: row.id,
      nodeId: row.node_id,
      retryEpoch: row.retry_epoch,
      startCommitSha: row.start_commit_sha,
      endCommitSha: row.end_commit_sha,
      startedAtIso: toIso(row.started_at),
      endedAtIso: toIso(row.ended_at),
      startedAtMs: toMs(row.started_at),
      endedAtMs: toMs(row.ended_at),
    });
  }
  return usable;
}

function timeRangesOverlap(a: UsableExecution, b: UsableExecution): boolean {
  return a.startedAtMs < b.endedAtMs && b.startedAtMs < a.endedAtMs;
}

/** Splits executions into ones whose time range never overlaps another's, and ones that do. */
function partitionByOverlap(executions: readonly UsableExecution[]): {
  confident: UsableExecution[];
  ambiguous: UsableExecution[];
} {
  const overlappingIds = new Set<string>();
  for (let i = 0; i < executions.length; i += 1) {
    for (let j = i + 1; j < executions.length; j += 1) {
      const a = executions[i];
      const b = executions[j];
      if (a && b && timeRangesOverlap(a, b)) {
        overlappingIds.add(a.evidenceId);
        overlappingIds.add(b.evidenceId);
      }
    }
  }
  const confident: UsableExecution[] = [];
  const ambiguous: UsableExecution[] = [];
  for (const execution of executions) {
    (overlappingIds.has(execution.evidenceId) ? ambiguous : confident).push(execution);
  }
  return { confident, ambiguous };
}

/**
 * The commit to diff against `HEAD` to find everything this run has changed
 * so far. It is the start snapshot of the temporally earliest execution
 * whose start commit is still an ancestor of the checkout's current state —
 * a retried node's reset-away attempt is excluded because its start commit
 * no longer is one, regardless of retry epoch. An execution still open (no
 * end commit yet) is included: nothing later can have reset past a
 * currently-active execution's own start. `undefined` when the run has no
 * usable evidence at all.
 */
export async function selectRunBaselineCommit(
  evidence: readonly WorkflowNodeExecutionEvidence[],
  isAncestorOfHead: IsAncestorOfHead
): Promise<string | undefined> {
  let earliest: { commitSha: string; startedAtMs: number } | undefined;
  for (const row of evidence) {
    if (!(await isAncestorOfHead(row.start_commit_sha))) continue;
    const startedAtMs = toMs(row.started_at);
    if (earliest === undefined || startedAtMs < earliest.startedAtMs) {
      earliest = { commitSha: row.start_commit_sha, startedAtMs };
    }
  }
  return earliest?.commitSha;
}

export interface ComputeFileAttributionParams {
  /** The run's changed paths, in deterministic repository order (already computed by the caller). */
  files: readonly ChangedFile[];
  /** Every evidence row recorded for this run, any order. */
  evidence: readonly WorkflowNodeExecutionEvidence[];
  /** Reads the paths changed between two commits. Injected so this stays a pure, testable algorithm. */
  diffCommitRange: (fromCommitSha: string, toCommitSha: string) => Promise<readonly ChangedFile[]>;
  /** Proves an execution's commits are still reachable from HEAD rather than reset away. */
  isAncestorOfHead: IsAncestorOfHead;
}

export async function computeFileAttribution(
  params: ComputeFileAttributionParams
): Promise<PathAttribution[]> {
  const usable = await toUsableExecutions(params.evidence, params.isAncestorOfHead);
  const { confident } = partitionByOverlap(usable);
  // Chronological order makes "every proven execution is shown in stable
  // order" a property of insertion order below, not a sort at read time.
  confident.sort((a, b) => a.startedAtMs - b.startedAtMs);

  const executionsByPath = new Map<string, AttributedNodeExecution[]>();
  for (const execution of confident) {
    const changed = await params.diffCommitRange(execution.startCommitSha, execution.endCommitSha);
    for (const file of changed) {
      const ref: AttributedNodeExecution = {
        nodeId: execution.nodeId,
        retryEpoch: execution.retryEpoch,
        startedAt: execution.startedAtIso,
        endedAt: execution.endedAtIso,
      };
      const existing = executionsByPath.get(file.path);
      if (existing) existing.push(ref);
      else executionsByPath.set(file.path, [ref]);
    }
  }

  return params.files.map(file => ({
    path: file.path,
    status: file.status,
    executions: executionsByPath.get(file.path) ?? [],
  }));
}
