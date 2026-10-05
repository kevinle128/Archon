/**
 * Database operations for node execution git evidence (start/end snapshots
 * used to compute which repository paths a node execution changed).
 */
import { createLogger } from '@archon/paths';
import type { WorkflowNodeExecutionEvidence } from '@archon/workflows/store';

import { pool } from './connection';

let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('db.workflow-node-execution-evidence');
  return cachedLog;
}

export interface StartWorkflowNodeExecutionEvidenceInput {
  id: string;
  workflow_run_id: string;
  node_id: string;
  retry_epoch: number;
  start_checkpoint_ref: string;
  start_commit_sha: string;
}

export interface CompleteWorkflowNodeExecutionEvidenceInput {
  id: string;
  end_checkpoint_ref: string;
  end_commit_sha: string;
}

export async function startWorkflowNodeExecutionEvidence(
  input: StartWorkflowNodeExecutionEvidenceInput
): Promise<WorkflowNodeExecutionEvidence> {
  // started_at/ended_at are computed here (millisecond precision) rather than
  // left to a SQL NOW() default: SQLite's datetime('now') truncates to whole
  // seconds, which would make two fast, genuinely sequential executions look
  // like they overlapped and lose provable attribution for no real reason.
  const result = await pool.query<WorkflowNodeExecutionEvidence>(
    `INSERT INTO remote_agent_workflow_node_execution_evidence
       (id, workflow_run_id, node_id, retry_epoch, start_checkpoint_ref, start_commit_sha, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      input.id,
      input.workflow_run_id,
      input.node_id,
      input.retry_epoch,
      input.start_checkpoint_ref,
      input.start_commit_sha,
      new Date().toISOString(),
    ]
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error(
      `Failed to record start execution evidence for id ${input.id}: no row returned`
    );
  }
  return row;
}

export async function completeWorkflowNodeExecutionEvidence(
  input: CompleteWorkflowNodeExecutionEvidenceInput
): Promise<void> {
  try {
    await pool.query(
      `UPDATE remote_agent_workflow_node_execution_evidence
       SET end_checkpoint_ref = $1, end_commit_sha = $2, ended_at = $3
       WHERE id = $4`,
      [input.end_checkpoint_ref, input.end_commit_sha, new Date().toISOString(), input.id]
    );
  } catch (err) {
    getLog().error(
      { err: err as Error, evidenceId: input.id },
      'db.node_execution_evidence_complete_failed'
    );
    throw err;
  }
}

/** All evidence rows for a run, in capture order — read by the git attribution route. */
export async function listWorkflowNodeExecutionEvidenceForRun(
  workflowRunId: string
): Promise<WorkflowNodeExecutionEvidence[]> {
  const result = await pool.query<WorkflowNodeExecutionEvidence>(
    `SELECT * FROM remote_agent_workflow_node_execution_evidence
     WHERE workflow_run_id = $1
     ORDER BY started_at ASC`,
    [workflowRunId]
  );
  return [...result.rows];
}
