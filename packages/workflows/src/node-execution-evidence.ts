/**
 * Records the git evidence bracketing one node execution attempt, for
 * server-side change attribution. Never throws: a node's own outcome must
 * never depend on whether this bookkeeping succeeded. When a capture fails,
 * the execution simply carries no proven evidence and attribution for it
 * reports unknown instead of guessing.
 */
import { randomUUID } from 'node:crypto';

import { captureExecutionEvidenceSnapshot, isGitWorkTree, toWorktreePath } from '@archon/git';
import { createLogger } from '@archon/paths';

import type { WorkflowDeps } from './deps';

let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('workflows.node-execution-evidence');
  return cachedLog;
}

export interface BeginNodeExecutionEvidenceParams {
  deps: WorkflowDeps;
  cwd: string;
  workflowRunId: string;
  nodeId: string;
  retryEpoch: number;
}

/**
 * Captures the pre-execution snapshot and opens a new evidence row. Returns
 * the row id on success, or `undefined` when evidence could not be captured
 * (non-git checkout, no store wiring, or a git failure) — the caller must
 * treat `undefined` as "do not attempt end capture for this execution".
 */
export async function beginNodeExecutionEvidence(
  params: BeginNodeExecutionEvidenceParams
): Promise<string | undefined> {
  if (!params.deps.store.startWorkflowNodeExecutionEvidence) {
    getLog().debug(
      { workflowRunId: params.workflowRunId, nodeId: params.nodeId },
      'execution_evidence_store_unavailable'
    );
    return undefined;
  }

  try {
    if (!(await isGitWorkTree(toWorktreePath(params.cwd)))) {
      // Folder projects and non-git roots have no checkout to snapshot.
      return undefined;
    }

    const executionId = randomUUID();
    const snapshot = await captureExecutionEvidenceSnapshot(
      params.cwd,
      { runId: params.workflowRunId, executionId, boundary: 'start' },
      `archon evidence: ${params.nodeId} start`
    );
    const row = await params.deps.store.startWorkflowNodeExecutionEvidence({
      id: executionId,
      workflow_run_id: params.workflowRunId,
      node_id: params.nodeId,
      retry_epoch: params.retryEpoch,
      start_checkpoint_ref: snapshot.ref,
      start_commit_sha: snapshot.commitSha,
    });
    return row.id;
  } catch (err) {
    getLog().warn(
      { err: err as Error, workflowRunId: params.workflowRunId, nodeId: params.nodeId },
      'execution_evidence_start_capture_failed'
    );
    return undefined;
  }
}

export interface EndNodeExecutionEvidenceParams {
  deps: WorkflowDeps;
  cwd: string;
  workflowRunId: string;
  nodeId: string;
  /** The row id returned by `beginNodeExecutionEvidence`. */
  evidenceId: string;
}

/** Captures the post-execution snapshot and completes the evidence row. */
export async function endNodeExecutionEvidence(
  params: EndNodeExecutionEvidenceParams
): Promise<void> {
  if (!params.deps.store.completeWorkflowNodeExecutionEvidence) return;

  try {
    const snapshot = await captureExecutionEvidenceSnapshot(
      params.cwd,
      { runId: params.workflowRunId, executionId: params.evidenceId, boundary: 'end' },
      `archon evidence: ${params.nodeId} end`
    );
    await params.deps.store.completeWorkflowNodeExecutionEvidence({
      id: params.evidenceId,
      end_checkpoint_ref: snapshot.ref,
      end_commit_sha: snapshot.commitSha,
    });
  } catch (err) {
    getLog().warn(
      { err: err as Error, workflowRunId: params.workflowRunId, nodeId: params.nodeId },
      'execution_evidence_end_capture_failed'
    );
  }
}
