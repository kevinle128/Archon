/**
 * Node execution evidence store against a real SqliteAdapter.
 *
 * Own `bun test` segment — mock.module('./connection') conflicts with other
 * DB tests.
 */
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

mock.module('@archon/paths', () => ({
  createLogger: () => ({
    info() {},
    warn() {},
    error() {},
    debug() {},
    trace() {},
    fatal() {},
  }),
}));

const { SqliteAdapter, sqliteDialect } = await import('./adapters/sqlite');
const db = new SqliteAdapter(':memory:');

mock.module('./connection', () => ({
  pool: db,
  getDatabase: () => db,
  getDialect: () => sqliteDialect,
  getDatabaseType: () => 'sqlite',
}));

const {
  startWorkflowNodeExecutionEvidence,
  completeWorkflowNodeExecutionEvidence,
  listWorkflowNodeExecutionEvidenceForRun,
} = await import('./workflow-node-execution-evidence');

afterAll(async () => {
  await db.close();
});

async function seedRun(runId = 'run-1'): Promise<void> {
  const conversationId = `conversation-${runId}`;
  await db.query(
    'INSERT INTO remote_agent_conversations (id, platform_type, platform_conversation_id) VALUES ($1, $2, $3)',
    [conversationId, 'web', `${conversationId}-platform`]
  );
  await db.query(
    'INSERT INTO remote_agent_workflow_runs (id, workflow_name, conversation_id, user_message, status) VALUES ($1, $2, $3, $4, $5)',
    [runId, 'evidence-test', conversationId, 'go', 'running']
  );
}

beforeEach(async () => {
  await db.query('DELETE FROM remote_agent_workflow_node_execution_evidence');
  await db.query('DELETE FROM remote_agent_workflow_runs');
  await db.query('DELETE FROM remote_agent_conversations');
  await seedRun();
});

describe('startWorkflowNodeExecutionEvidence', () => {
  test('inserts an open evidence row with no end evidence yet', async () => {
    const row = await startWorkflowNodeExecutionEvidence({
      id: 'evidence-1',
      workflow_run_id: 'run-1',
      node_id: 'build',
      retry_epoch: 0,
      start_checkpoint_ref: 'refs/archon/evidence/run-1/evidence-1/start',
      start_commit_sha: 'a'.repeat(40),
    });

    expect(row.id).toBe('evidence-1');
    expect(row.node_id).toBe('build');
    expect(row.end_commit_sha).toBeNull();
    expect(row.end_checkpoint_ref).toBeNull();
    expect(row.ended_at).toBeNull();
  });

  test('two executions of the same node each get their own row', async () => {
    await startWorkflowNodeExecutionEvidence({
      id: 'evidence-1',
      workflow_run_id: 'run-1',
      node_id: 'build',
      retry_epoch: 0,
      start_checkpoint_ref: 'refs/archon/evidence/run-1/evidence-1/start',
      start_commit_sha: 'a'.repeat(40),
    });
    await startWorkflowNodeExecutionEvidence({
      id: 'evidence-2',
      workflow_run_id: 'run-1',
      node_id: 'build',
      retry_epoch: 0,
      start_checkpoint_ref: 'refs/archon/evidence/run-1/evidence-2/start',
      start_commit_sha: 'b'.repeat(40),
    });

    const rows = await listWorkflowNodeExecutionEvidenceForRun('run-1');
    expect(rows.map(r => r.id).sort()).toEqual(['evidence-1', 'evidence-2']);
  });
});

describe('completeWorkflowNodeExecutionEvidence', () => {
  test('fills in end evidence for an existing row', async () => {
    await startWorkflowNodeExecutionEvidence({
      id: 'evidence-1',
      workflow_run_id: 'run-1',
      node_id: 'build',
      retry_epoch: 0,
      start_checkpoint_ref: 'refs/archon/evidence/run-1/evidence-1/start',
      start_commit_sha: 'a'.repeat(40),
    });

    await completeWorkflowNodeExecutionEvidence({
      id: 'evidence-1',
      end_checkpoint_ref: 'refs/archon/evidence/run-1/evidence-1/end',
      end_commit_sha: 'b'.repeat(40),
    });

    const rows = await listWorkflowNodeExecutionEvidenceForRun('run-1');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.end_commit_sha).toBe('b'.repeat(40));
    expect(rows[0]?.end_checkpoint_ref).toBe('refs/archon/evidence/run-1/evidence-1/end');
    expect(rows[0]?.ended_at).toBeTruthy();
  });
});

describe('listWorkflowNodeExecutionEvidenceForRun', () => {
  test('returns rows in capture order and only for the requested run', async () => {
    await seedRun('run-2');
    await startWorkflowNodeExecutionEvidence({
      id: 'evidence-1',
      workflow_run_id: 'run-1',
      node_id: 'build',
      retry_epoch: 0,
      start_checkpoint_ref: 'refs/archon/evidence/run-1/evidence-1/start',
      start_commit_sha: 'a'.repeat(40),
    });
    await startWorkflowNodeExecutionEvidence({
      id: 'evidence-2',
      workflow_run_id: 'run-1',
      node_id: 'deploy',
      retry_epoch: 0,
      start_checkpoint_ref: 'refs/archon/evidence/run-1/evidence-2/start',
      start_commit_sha: 'b'.repeat(40),
    });
    await startWorkflowNodeExecutionEvidence({
      id: 'evidence-3',
      workflow_run_id: 'run-2',
      node_id: 'build',
      retry_epoch: 0,
      start_checkpoint_ref: 'refs/archon/evidence/run-2/evidence-3/start',
      start_commit_sha: 'c'.repeat(40),
    });

    const rows = await listWorkflowNodeExecutionEvidenceForRun('run-1');
    expect(rows.map(r => r.id)).toEqual(['evidence-1', 'evidence-2']);
  });

  test('returns an empty list for a run with no evidence', async () => {
    const rows = await listWorkflowNodeExecutionEvidenceForRun('run-1');
    expect(rows).toEqual([]);
  });
});
