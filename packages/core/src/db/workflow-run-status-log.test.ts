/**
 * Workflow run status log store, and caller-chosen run ids, against a real
 * in-memory SqliteAdapter.
 *
 * Own `bun test` segment — mock.module('./connection') conflicts with other
 * DB tests.
 */
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

// Spread the real module: ./workflows (imported for the run-id tests) needs
// other @archon/paths exports at link time.
const realPaths = await import('@archon/paths');
mock.module('@archon/paths', () => ({
  ...realPaths,
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
  appendStatusLogRow,
  getLastStatusLogRow,
  getMaxStatusLogPosition,
  listStatusLogRows,
  listStatusLogReconcileRunIds,
} = await import('./workflow-run-status-log');
const { createWorkflowRun, getWorkflowRun } = await import('./workflows');

afterAll(async () => {
  await db.close();
});

async function seedRun(runId: string, workflowName = 'wf-a', status = 'running'): Promise<void> {
  const conversationId = `conversation-${runId}`;
  await db.query(
    'INSERT INTO remote_agent_conversations (id, platform_type, platform_conversation_id) VALUES ($1, $2, $3)',
    [conversationId, 'web', `${conversationId}-platform`]
  );
  await db.query(
    'INSERT INTO remote_agent_workflow_runs (id, workflow_name, conversation_id, user_message, status) VALUES ($1, $2, $3, $4, $5)',
    [runId, workflowName, conversationId, 'go', status]
  );
}

beforeEach(async () => {
  await db.query('DELETE FROM remote_agent_workflow_run_status_log');
  await db.query('DELETE FROM remote_agent_workflow_runs');
  await db.query('DELETE FROM remote_agent_conversations');
});

describe('createWorkflowRun with a caller-chosen id', () => {
  test('stores the given id', async () => {
    await db.query(
      'INSERT INTO remote_agent_conversations (id, platform_type, platform_conversation_id) VALUES ($1, $2, $3)',
      ['conv-x', 'web', 'conv-x-platform']
    );
    const id = '0f3c2b1a-4d5e-4f60-8a7b-9c0d1e2f3a4b';
    const run = await createWorkflowRun({
      id,
      workflow_name: 'wf-a',
      conversation_id: 'conv-x',
      user_message: 'go',
    });
    expect(run.id).toBe(id);
    expect((await getWorkflowRun(id))?.workflow_name).toBe('wf-a');
  });

  test('a duplicate id throws instead of reusing the row', async () => {
    await db.query(
      'INSERT INTO remote_agent_conversations (id, platform_type, platform_conversation_id) VALUES ($1, $2, $3)',
      ['conv-y', 'web', 'conv-y-platform']
    );
    const id = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
    await createWorkflowRun({
      id,
      workflow_name: 'wf-a',
      conversation_id: 'conv-y',
      user_message: 'a',
    });
    await expect(
      createWorkflowRun({ id, workflow_name: 'wf-b', conversation_id: 'conv-y', user_message: 'b' })
    ).rejects.toThrow('Failed to create workflow run');
    expect((await getWorkflowRun(id))?.workflow_name).toBe('wf-a');
  });
});

describe('appendStatusLogRow', () => {
  test('assigns per-run seq and global position', async () => {
    await seedRun('run-1');
    await seedRun('run-2');

    const a = await appendStatusLogRow({
      workflow_run_id: 'run-1',
      status: 'running',
      gate_key: null,
      data: { status: 'running' },
      previous_seq: 0,
    });
    const b = await appendStatusLogRow({
      workflow_run_id: 'run-2',
      status: 'running',
      gate_key: null,
      data: { status: 'running' },
      previous_seq: 0,
    });
    const c = await appendStatusLogRow({
      workflow_run_id: 'run-1',
      status: 'paused',
      gate_key: 'approval-review',
      data: { status: 'paused', question: 'ok?' },
      previous_seq: 1,
    });

    expect([a?.seq, b?.seq, c?.seq]).toEqual([1, 1, 2]);
    expect([a?.position, b?.position, c?.position]).toEqual([1, 2, 3]);
    expect(c?.gate_key).toBe('approval-review');
    expect(c?.data).toEqual({ status: 'paused', question: 'ok?' });
    expect(c?.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(await getMaxStatusLogPosition()).toBe(3);
    expect((await getLastStatusLogRow('run-1'))?.seq).toBe(2);
  });

  test('a stale previous_seq is a no-op and does not consume a position', async () => {
    await seedRun('run-1');
    await appendStatusLogRow({
      workflow_run_id: 'run-1',
      status: 'running',
      gate_key: null,
      data: {},
      previous_seq: 0,
    });

    const lost = await appendStatusLogRow({
      workflow_run_id: 'run-1',
      status: 'running',
      gate_key: null,
      data: {},
      previous_seq: 0,
    });

    expect(lost).toBeNull();
    expect(await getMaxStatusLogPosition()).toBe(1);
  });

  test('rejects a negative previous_seq', async () => {
    await seedRun('run-1');
    await expect(
      appendStatusLogRow({
        workflow_run_id: 'run-1',
        status: 'running',
        gate_key: null,
        data: {},
        previous_seq: -1,
      })
    ).rejects.toThrow('previous_seq');
  });

  test('rows cascade-delete with their run', async () => {
    await seedRun('run-1');
    await appendStatusLogRow({
      workflow_run_id: 'run-1',
      status: 'running',
      gate_key: null,
      data: {},
      previous_seq: 0,
    });
    await db.query('DELETE FROM remote_agent_workflow_runs WHERE id = $1', ['run-1']);
    expect(await getLastStatusLogRow('run-1')).toBeNull();
  });
});

describe('getMaxStatusLogPosition / getLastStatusLogRow on an empty log', () => {
  test('returns 0 and null', async () => {
    expect(await getMaxStatusLogPosition()).toBe(0);
    expect(await getLastStatusLogRow('missing')).toBeNull();
  });
});

describe('listStatusLogRows', () => {
  async function seedLog(): Promise<void> {
    await seedRun('run-1', 'wf-a');
    await seedRun('run-2', 'wf-b');
    await appendStatusLogRow({
      workflow_run_id: 'run-1',
      status: 'running',
      gate_key: null,
      data: {},
      previous_seq: 0,
    });
    await appendStatusLogRow({
      workflow_run_id: 'run-2',
      status: 'running',
      gate_key: null,
      data: {},
      previous_seq: 0,
    });
    await appendStatusLogRow({
      workflow_run_id: 'run-1',
      status: 'completed',
      gate_key: null,
      data: {},
      previous_seq: 1,
    });
  }

  test('returns rows after a position, in position order', async () => {
    await seedLog();
    const rows = await listStatusLogRows({ after: 1, limit: 10 });
    expect(rows.map(r => r.position)).toEqual([2, 3]);
  });

  test('filters by run id and by workflow name', async () => {
    await seedLog();
    expect(
      (await listStatusLogRows({ after: 0, runId: 'run-1', limit: 10 })).map(r => r.seq)
    ).toEqual([1, 2]);
    expect(
      (await listStatusLogRows({ after: 0, workflow: 'wf-b', limit: 10 })).map(
        r => r.workflow_run_id
      )
    ).toEqual(['run-2']);
  });

  test('applies through and limit', async () => {
    await seedLog();
    expect(
      (await listStatusLogRows({ after: 0, through: 2, limit: 10 })).map(r => r.position)
    ).toEqual([1, 2]);
    expect((await listStatusLogRows({ after: 0, limit: 1 })).map(r => r.position)).toEqual([1]);
  });

  test('filters by creation time with since and before', async () => {
    await seedLog();
    await db.query(
      'UPDATE remote_agent_workflow_run_status_log SET created_at = $1 WHERE position = 1',
      ['2020-01-01T00:00:00.000Z']
    );
    const since = '2021-01-01T00:00:00.000Z';
    expect((await listStatusLogRows({ after: 0, since, limit: 10 })).map(r => r.position)).toEqual([
      2, 3,
    ]);
    expect(
      (await listStatusLogRows({ after: 0, before: since, limit: 10 })).map(r => r.position)
    ).toEqual([1]);
  });

  test('rejects a non-positive limit', async () => {
    await expect(listStatusLogRows({ after: 0, limit: 0 })).rejects.toThrow('limit');
  });
});

describe('listStatusLogReconcileRunIds', () => {
  test('lists non-terminal runs and runs whose last row is non-terminal', async () => {
    await seedRun('live', 'wf-a', 'running');
    await seedRun('done-logged-done', 'wf-a', 'completed');
    await seedRun('done-logged-running', 'wf-a', 'cancelled');
    await appendStatusLogRow({
      workflow_run_id: 'done-logged-done',
      status: 'running',
      gate_key: null,
      data: {},
      previous_seq: 0,
    });
    await appendStatusLogRow({
      workflow_run_id: 'done-logged-done',
      status: 'completed',
      gate_key: null,
      data: {},
      previous_seq: 1,
    });
    await appendStatusLogRow({
      workflow_run_id: 'done-logged-running',
      status: 'running',
      gate_key: null,
      data: {},
      previous_seq: 0,
    });

    const ids = (await listStatusLogReconcileRunIds()).sort();
    expect(ids).toEqual(['done-logged-running', 'live']);
  });
});
