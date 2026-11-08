/**
 * Status-log writer against a real SQLite database in a temporary
 * ARCHON_HOME (never the user's ~/.archon).
 */
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { WorkflowEmitterEvent } from '@archon/workflows/event-emitter';

const archonHome = mkdtempSync(join(tmpdir(), 'archon-mcp-status-log-'));
process.env.ARCHON_HOME = archonHome;
delete process.env.DATABASE_URL;

const { pool, closeDatabase } = await import('@archon/core/db/connection');
const workflowDb = await import('@archon/core/db/workflows');
const { listStatusLogRows } = await import('@archon/core/db/workflow-run-status-log');
const { StatusLogSignal, createDbStatusLogStore, startRunStatusLogWriter } =
  await import('./run-status-log');

afterAll(async () => {
  await closeDatabase();
  rmSync(archonHome, { recursive: true, force: true });
});

const BASE = 'https://archon.example.ts.net';

class FakeEmitter {
  private listener: ((event: WorkflowEmitterEvent) => void) | undefined;
  subscribe(listener: (event: WorkflowEmitterEvent) => void): () => void {
    this.listener = listener;
    return () => {
      this.listener = undefined;
    };
  }
  emit(event: WorkflowEmitterEvent): void {
    this.listener?.(event);
  }
  get subscribed(): boolean {
    return this.listener !== undefined;
  }
}

let emitter: FakeEmitter;
let signal: InstanceType<typeof StatusLogSignal>;
let writer: ReturnType<typeof startRunStatusLogWriter>;
let notifications = 0;

async function seedRun(
  id: string,
  status = 'running',
  metadata: Record<string, unknown> = {}
): Promise<void> {
  await pool.query(
    'INSERT INTO remote_agent_conversations (id, platform_type, platform_conversation_id) VALUES ($1, $2, $3)',
    [`conv-${id}`, 'web', `web-${id}`]
  );
  await pool.query(
    'INSERT INTO remote_agent_workflow_runs (id, workflow_name, conversation_id, user_message, status, metadata) VALUES ($1, $2, $3, $4, $5, $6)',
    [id, 'resolve', `conv-${id}`, 'go', status, JSON.stringify(metadata)]
  );
}

let eventClock = 0;
async function addEvent(
  runId: string,
  eventType: string,
  stepName: string,
  data: Record<string, unknown>
): Promise<void> {
  eventClock += 1;
  await pool.query(
    'INSERT INTO remote_agent_workflow_events (workflow_run_id, event_type, step_name, data, created_at) VALUES ($1, $2, $3, $4, $5)',
    [
      runId,
      eventType,
      stepName,
      JSON.stringify(data),
      `2026-11-08T00:00:${String(eventClock).padStart(2, '0')}.000Z`,
    ]
  );
}

async function setRun(
  id: string,
  status: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  await pool.query(
    'UPDATE remote_agent_workflow_runs SET status = $1, metadata = $2 WHERE id = $3',
    [status, JSON.stringify(metadata), id]
  );
}

async function rows(runId: string): Promise<Awaited<ReturnType<typeof listStatusLogRows>>> {
  return listStatusLogRows({ after: 0, runId, limit: 100 });
}

/** Wait until every queued refresh ran (the writer serializes them). */
async function drain(): Promise<void> {
  await writer.refresh('drain-marker-run-that-does-not-exist');
}

function emit(type: WorkflowEmitterEvent['type'], runId: string): void {
  emitter.emit({ type, runId } as WorkflowEmitterEvent);
}

beforeEach(async () => {
  await pool.query('DELETE FROM remote_agent_workflow_run_status_log');
  await pool.query('DELETE FROM remote_agent_workflow_events');
  await pool.query('DELETE FROM remote_agent_workflow_runs');
  await pool.query('DELETE FROM remote_agent_conversations');
  emitter = new FakeEmitter();
  signal = new StatusLogSignal();
  notifications = 0;
  signal.subscribe(() => {
    notifications += 1;
  });
  writer = startRunStatusLogWriter({
    baseUrl: BASE,
    emitter,
    signal,
    reconcileIntervalMs: 60_000,
    nodeCompletedRecheckMs: 5,
  });
  await writer.ready;
});

afterEach(() => {
  writer.stop();
});

describe('emitter-triggered writes', () => {
  test('an emitter event appends one row with the event payload', async () => {
    await seedRun('r1');
    emit('workflow_started', 'r1');
    await drain();

    const logged = await rows('r1');
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ seq: 1, status: 'running', gate_key: null });
    expect(logged[0]?.data).toEqual({
      run_id: 'r1',
      workflow: 'resolve',
      status: 'running',
      task_status: 'working',
      url: `${BASE}/runs/r1`,
    });
    expect(notifications).toBe(1);
  });

  test('the same state twice appends nothing', async () => {
    await seedRun('r1');
    emit('workflow_started', 'r1');
    emit('node_completed', 'r1');
    await drain();
    await writer.refresh('r1');
    expect(await rows('r1')).toHaveLength(1);
    expect(notifications).toBe(1);
  });

  test('ignores emitter events that cannot change the snapshot', async () => {
    await seedRun('r1');
    emit('tool_started', 'r1');
    await drain();
    expect(await rows('r1')).toHaveLength(0);
  });

  test('a pause records the gate key and question; resolving it clears the key', async () => {
    await seedRun('r1');
    emit('workflow_started', 'r1');
    await drain();
    await setRun('r1', 'paused', {
      approval: { nodeId: 'decide', message: 'Ours or theirs?', type: 'approval', resolved: null },
    });
    emit('approval_pending', 'r1');
    await drain();
    await setRun('r1', 'paused', {
      approval: {
        nodeId: 'decide',
        message: 'Ours or theirs?',
        type: 'approval',
        resolved: 'approved',
      },
    });
    emit('interaction_resolved', 'r1');
    await drain();

    const logged = await rows('r1');
    expect(logged.map(r => [r.status, r.gate_key])).toEqual([
      ['running', null],
      ['paused', 'approval-decide'],
      ['paused', null],
    ]);
    expect(logged[1]?.data).toMatchObject({
      task_status: 'input_required',
      question: 'Ours or theirs?',
    });
    expect(logged[2]?.data).toMatchObject({ task_status: 'working' });
  });

  test('quick in-process transitions are each recorded in order', async () => {
    await seedRun('r1');
    emit('workflow_started', 'r1');
    await setRun('r1', 'paused', {
      approval: { nodeId: 'decide', message: 'q', type: 'approval', resolved: null },
    });
    emit('approval_pending', 'r1');
    await setRun('r1', 'completed');
    emit('workflow_completed', 'r1');
    await drain();

    expect((await rows('r1')).map(r => r.status)).toEqual(['running', 'paused', 'completed']);
  });

  test('a PR link appearing while running adds one event with pr_url', async () => {
    await seedRun('r1');
    emit('workflow_started', 'r1');
    await drain();
    await addEvent('r1', 'node_completed', 'publish', {
      node_output: JSON.stringify({ pr_url: 'https://github.com/o/r/pull/5', number: 5 }),
    });
    emit('node_completed', 'r1');
    await drain();
    await new Promise(resolve => setTimeout(resolve, 20));
    await drain();

    const logged = await rows('r1');
    expect(logged).toHaveLength(2);
    expect(logged[1]).toMatchObject({ seq: 2, status: 'running' });
    expect(logged[1]?.data.pr_url).toBe('https://github.com/o/r/pull/5');
  });

  test('the terminal event carries the CI result from the final output', async () => {
    await seedRun('r1');
    await addEvent('r1', 'node_completed', 'finalize', {
      node_output: JSON.stringify({
        outcome: 'ci_failed',
        pr_url: 'https://github.com/o/r/pull/5',
        ci: {
          conclusion: 'failure',
          failed: ['lint'],
          checks_url: 'https://github.com/o/r/pull/5/checks',
        },
      }),
    });
    await setRun('r1', 'completed');
    emit('workflow_completed', 'r1');
    await drain();

    const logged = await rows('r1');
    expect(logged.at(-1)?.data).toMatchObject({
      status: 'completed',
      task_status: 'completed',
      pr_url: 'https://github.com/o/r/pull/5',
      ci: {
        conclusion: 'failure',
        failed: ['lint'],
        checks_url: 'https://github.com/o/r/pull/5/checks',
      },
    });
  });
});

describe('reconcile', () => {
  test('picks up a change made directly in the database by another process', async () => {
    await seedRun('r1');
    await writer.reconcile();
    await setRun('r1', 'cancelled');
    await writer.reconcile();

    expect((await rows('r1')).map(r => r.status)).toEqual(['running', 'cancelled']);
    // Terminal run with a terminal last row: no longer a reconcile candidate.
    await writer.reconcile();
    expect(await rows('r1')).toHaveLength(2);
  });

  test('runs a reconcile pass at start', async () => {
    writer.stop();
    await seedRun('r1');
    writer = startRunStatusLogWriter({
      baseUrl: BASE,
      emitter,
      signal,
      reconcileIntervalMs: 60_000,
    });
    await writer.ready;
    expect(await rows('r1')).toHaveLength(1);
  });

  test('two runs refreshed at once get distinct positions', async () => {
    await seedRun('r1');
    await seedRun('r2');
    await Promise.all([writer.refresh('r1'), writer.refresh('r2')]);
    const all = await listStatusLogRows({ after: 0, limit: 10 });
    expect(all.map(r => r.position)).toEqual([1, 2]);
  });
});

describe('terminal output that lands late', () => {
  const finalOutput = {
    node_output: JSON.stringify({
      outcome: 'pr_ready',
      pr_url: 'https://github.com/o/r/pull/8',
      ci: { conclusion: 'success', failed: [], checks_url: 'https://github.com/o/r/pull/8/checks' },
    }),
  };

  test('a CI result that appears after the terminal row appends a corrected row', async () => {
    await seedRun('r1');
    await setRun('r1', 'completed');
    await writer.refresh('r1');
    await addEvent('r1', 'node_completed', 'finalize', finalOutput);
    await writer.refresh('r1');
    await writer.refresh('r1');

    const logged = await rows('r1');
    expect(logged.map(r => r.status)).toEqual(['completed', 'completed']);
    expect(logged[0]?.data.ci).toBeUndefined();
    expect(logged[1]?.data.ci).toEqual({
      conclusion: 'success',
      failed: [],
      checks_url: 'https://github.com/o/r/pull/8/checks',
    });
  });

  test('the first terminal row schedules one more look after the short delay', async () => {
    writer.stop();
    writer = startRunStatusLogWriter({
      baseUrl: BASE,
      emitter,
      signal,
      reconcileIntervalMs: 60_000,
      nodeCompletedRecheckMs: 50,
    });
    await writer.ready;
    await seedRun('r1');
    await setRun('r1', 'completed');
    emit('workflow_completed', 'r1');
    await drain();
    expect(await rows('r1')).toHaveLength(1);
    await addEvent('r1', 'node_completed', 'finalize', finalOutput);

    for (let i = 0; i < 100 && (await rows('r1')).length < 2; i++) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const logged = await rows('r1');
    expect(logged).toHaveLength(2);
    expect(logged[1]?.data.ci).toMatchObject({ conclusion: 'success' });
  });
});

describe('reconcile cost', () => {
  function countingWriter(): { counts: Map<string, number> } {
    const counts = new Map<string, number>();
    const base = createDbStatusLogStore();
    writer.stop();
    writer = startRunStatusLogWriter({
      baseUrl: BASE,
      emitter,
      signal,
      reconcileIntervalMs: 60_000,
      store: {
        ...base,
        listEvents: async (runId: string) => {
          counts.set(runId, (counts.get(runId) ?? 0) + 1);
          return base.listEvents(runId);
        },
      },
    });
    return { counts };
  }

  test('a paused run whose status and gate are unchanged is not re-read on reconcile', async () => {
    await seedRun('p1', 'paused', {
      approval: { nodeId: 'decide', message: 'q', type: 'approval', resolved: null },
    });
    const { counts } = countingWriter();
    await writer.ready;
    expect(counts.get('p1')).toBe(1);
    await writer.reconcile();
    await writer.reconcile();
    expect(counts.get('p1')).toBe(1);
    expect(await rows('p1')).toHaveLength(1);

    // Answering the gate changes the run row, so the next pass reads events again.
    await setRun('p1', 'paused', {
      approval: { nodeId: 'decide', message: 'q', type: 'approval', resolved: 'approved' },
    });
    await writer.reconcile();
    expect(counts.get('p1')).toBe(2);
    expect((await rows('p1')).map(r => r.gate_key)).toEqual(['approval-decide', null]);
  });

  test('a running run is re-read on every reconcile pass', async () => {
    await seedRun('r1');
    const { counts } = countingWriter();
    await writer.ready;
    await writer.reconcile();
    expect(counts.get('r1')).toBe(2);
  });

  test('an emitter trigger always reads events', async () => {
    await seedRun('p1', 'paused', {
      approval: { nodeId: 'decide', message: 'q', type: 'approval', resolved: null },
    });
    const { counts } = countingWriter();
    await writer.ready;
    emit('node_completed', 'p1');
    await drain();
    expect(counts.get('p1')).toBe(2);
  });
});

describe('observer only', () => {
  test('never calls a run-mutating function', async () => {
    const spies = [
      spyOn(workflowDb, 'updateWorkflowRun'),
      spyOn(workflowDb, 'failWorkflowRun'),
      spyOn(workflowDb, 'completeWorkflowRun'),
      spyOn(workflowDb, 'cancelWorkflowRun'),
      spyOn(workflowDb, 'pauseWorkflowRun'),
      spyOn(workflowDb, 'resumeWorkflowRun'),
      spyOn(workflowDb, 'updateWorkflowActivity'),
    ];
    try {
      await seedRun('r1');
      await seedRun('stale', 'running');
      emit('workflow_started', 'r1');
      await setRun('r1', 'paused', {
        approval: { nodeId: 'decide', message: 'q', type: 'approval', resolved: null },
      });
      emit('approval_pending', 'r1');
      await writer.reconcile();
      await drain();
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
      // The orphan-looking run is still running: the writer recorded it, nothing more.
      expect((await workflowDb.getWorkflowRun('stale'))?.status).toBe('running');
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  test('the default store exposes no run-mutating method', () => {
    expect(Object.keys(createDbStatusLogStore()).sort()).toEqual([
      'appendRow',
      'getLastRow',
      'getRun',
      'listEvents',
      'listReconcileRunIds',
      'resolveReturnsNodeId',
    ]);
  });

  test('stop unsubscribes from the emitter', () => {
    expect(emitter.subscribed).toBe(true);
    writer.stop();
    expect(emitter.subscribed).toBe(false);
  });
});

// Keep last: it drops the table.
describe('missing table', () => {
  test('a write failure is logged and the writer keeps running', async () => {
    await seedRun('r1');
    await pool.query('DROP TABLE remote_agent_workflow_run_status_log');
    emit('workflow_started', 'r1');
    await drain();
    await expect(writer.reconcile()).resolves.toBeUndefined();
    expect(notifications).toBe(0);
  });
});
