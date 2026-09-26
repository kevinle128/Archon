/**
 * Attributes a run's changed repository paths to the node executions that
 * proved them, using only recorded git evidence — never provider prose or
 * tool names.
 *
 * Rules:
 *  - Only the most recent retry attempt of each node is considered: an
 *    earlier attempt's evidence points at commits a later retry reset away.
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

/** Keeps, per node id, only the rows from that node's highest retry epoch. */
function selectLatestEpochPerNode(
  evidence: readonly WorkflowNodeExecutionEvidence[]
): WorkflowNodeExecutionEvidence[] {
  const maxEpochByNode = new Map<string, number>();
  for (const row of evidence) {
    const current = maxEpochByNode.get(row.node_id);
    if (current === undefined || row.retry_epoch > current) {
      maxEpochByNode.set(row.node_id, row.retry_epoch);
    }
  }
  return evidence.filter(row => maxEpochByNode.get(row.node_id) === row.retry_epoch);
}

/** Drops rows with no proven end state — an open or failed-to-capture execution proves nothing. */
function toUsableExecutions(evidence: readonly WorkflowNodeExecutionEvidence[]): UsableExecution[] {
  const usable: UsableExecution[] = [];
  for (const row of evidence) {
    if (row.end_commit_sha === null || row.ended_at === null) continue;
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
 * so far. It is the start snapshot of the temporally earliest execution still
 * relevant to the checkout's current state (a retried node's earlier attempt
 * is excluded, since its start commit was reset away and is no longer HEAD's
 * ancestor). `undefined` when the run has no usable evidence at all.
 */
export function selectRunBaselineCommit(
  evidence: readonly WorkflowNodeExecutionEvidence[]
): string | undefined {
  const latestPerNode = selectLatestEpochPerNode(evidence);
  let earliest: { commitSha: string; startedAtMs: number } | undefined;
  for (const row of latestPerNode) {
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
}

export async function computeFileAttribution(
  params: ComputeFileAttributionParams
): Promise<PathAttribution[]> {
  const latestPerNode = selectLatestEpochPerNode(params.evidence);
  const usable = toUsableExecutions(latestPerNode);
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
