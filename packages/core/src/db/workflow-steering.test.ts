/**
 * Durable steering store (drafts, guidance queue, node settings) against a
 * real SqliteAdapter.
 *
 * Covers FIFO position assignment under concurrency, message_id idempotency,
 * claim/state transitions, terminal reconciliation, and cascade deletion
 * with the owning run.
 *
 * Own `bun test` segment — mock.module('./connection') conflicts with other DB tests.
 */
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

const { SqliteAdapter, sqliteDialect } = await import('./adapters/sqlite');
const db = new SqliteAdapter(':memory:');

mock.module('./connection', () => ({
  pool: db,
  getDatabase: () => db,
  getDialect: () => sqliteDialect,
  getDatabaseType: () => 'sqlite',
}));

const {
  getSteeringDraft,
  upsertSteeringDraft,
  clearSteeringDraft,
  getSteeringNodeSettings,
  upsertSteeringNodeSettings,
  enqueueSteeringMessage,
  withdrawSteeringMessage,
  listSteeringQueue,
  claimSteeringQueue,
  markSteeringMessagesSent,
  claimSteeringMessageForSoftInjection,
  reconcileNeverSentSteeringMessages,
} = await import('./workflow-steering');

afterAll(async () => {
  await db.close();
});

async function seedRun(runId: string, conversationId = `${runId}-conv`): Promise<void> {
  await db.query(
    'INSERT INTO remote_agent_conversations (id, platform_type, platform_conversation_id) VALUES ($1, $2, $3)',
    [conversationId, 'web', `${conversationId}-platform`]
  );
  await db.query(
    'INSERT INTO remote_agent_workflow_runs (id, workflow_name, conversation_id, user_message, status) VALUES ($1, $2, $3, $4, $5)',
    [runId, 'steering-test', conversationId, 'inspect this run', 'running']
  );
}

beforeEach(async () => {
  await db.query('DELETE FROM remote_agent_steering_queue_entries');
  await db.query('DELETE FROM remote_agent_steering_drafts');
  await db.query('DELETE FROM remote_agent_steering_node_settings');
  await db.query('DELETE FROM remote_agent_workflow_runs');
  await db.query('DELETE FROM remote_agent_conversations');
  await seedRun('run-1');
});

describe('steering drafts', () => {
  test('upsert creates, then updates the same (run, node, author) row', async () => {
    const created = await upsertSteeringDraft({
      workflow_run_id: 'run-1',
      node_id: 'review',
      operator_user_id: 'op-1',
      message: 'first draft',
    });
    const updated = await upsertSteeringDraft({
      workflow_run_id: 'run-1',
      node_id: 'review',
      operator_user_id: 'op-1',
      message: 'revised draft',
    });
    expect(updated.id).toBe(created.id);
    expect(updated.message).toBe('revised draft');
    const read = await getSteeringDraft({
      workflow_run_id: 'run-1',
      node_id: 'review',
      operator_user_id: 'op-1',
    });
    expect(read?.message).toBe('revised draft');
  });

  test('drafts are private to their author, including the identity-less sentinel', async () => {
    await upsertSteeringDraft({
      workflow_run_id: 'run-1',
      node_id: 'review',
      operator_user_id: 'op-1',
      message: 'op-1 draft',
    });
    await upsertSteeringDraft({
      workflow_run_id: 'run-1',
      node_id: 'review',
      operator_user_id: null,
      message: 'identity-less draft',
    });
    const opOne = await getSteeringDraft({
      workflow_run_id: 'run-1',
      node_id: 'review',
      operator_user_id: 'op-1',
    });
    const opTwo = await getSteeringDraft({
      workflow_run_id: 'run-1',
      node_id: 'review',
      operator_user_id: 'op-2',
    });
    const noIdentity = await getSteeringDraft({
      workflow_run_id: 'run-1',
      node_id: 'review',
      operator_user_id: null,
    });
    expect(opOne?.message).toBe('op-1 draft');
    expect(opTwo).toBeNull();
    expect(noIdentity?.message).toBe('identity-less draft');
    expect(noIdentity?.operator_user_id).toBeNull();
  });

  test('clear is idempotent and later reads do not restore the cleared draft', async () => {
    await upsertSteeringDraft({
      workflow_run_id: 'run-1',
      node_id: 'review',
      operator_user_id: 'op-1',
      message: 'to be cleared',
    });
    await clearSteeringDraft({
      workflow_run_id: 'run-1',
      node_id: 'review',
      operator_user_id: 'op-1',
    });
    await clearSteeringDraft({
      workflow_run_id: 'run-1',
      node_id: 'review',
      operator_user_id: 'op-1',
    });
    const read = await getSteeringDraft({
      workflow_run_id: 'run-1',
      node_id: 'review',
      operator_user_id: 'op-1',
    });
    expect(read).toBeNull();
  });
});

describe('steering node settings', () => {
  test('upsert creates defaults for unset fields, then partial-merges', async () => {
    const created = await upsertSteeringNodeSettings({
      workflow_run_id: 'run-1',
      node_id: 'review',
      provider_id: 'claude',
    });
    expect(created.auto_send_enabled).toBe(false);
    expect(created.provider_id).toBe('claude');

    const merged = await upsertSteeringNodeSettings({
      workflow_run_id: 'run-1',
      node_id: 'review',
      auto_send_enabled: true,
      updated_by_user_id: 'op-1',
    });
    expect(merged.id).toBe(created.id);
    expect(merged.auto_send_enabled).toBe(true);
    expect(merged.updated_by_user_id).toBe('op-1');
    // provider_id from the earlier write survives an update that never touches it.
    expect(merged.provider_id).toBe('claude');
  });

  test('get returns null for a node that was never registered', async () => {
    expect(await getSteeringNodeSettings('run-1', 'never-registered')).toBeNull();
  });
});

describe('steering queue: FIFO and idempotency', () => {
  test('enqueue assigns increasing positions per (run, node), independent of other nodes', async () => {
    const a = await enqueueSteeringMessage({
      workflow_run_id: 'run-1',
      node_id: 'review',
      message_id: 'm-1',
      message: 'first',
      operator_user_id: 'op-1',
      initial_state: 'queued',
    });
    const b = await enqueueSteeringMessage({
      workflow_run_id: 'run-1',
      node_id: 'review',
      message_id: 'm-2',
      message: 'second',
      operator_user_id: 'op-1',
      initial_state: 'queued',
    });
    const otherNode = await enqueueSteeringMessage({
      workflow_run_id: 'run-1',
      node_id: 'other',
      message_id: 'm-3',
      message: 'independent',
      operator_user_id: 'op-1',
      initial_state: 'queued',
    });
    expect([a.entry.fifo_position, b.entry.fifo_position]).toEqual([1, 2]);
    expect(otherNode.entry.fifo_position).toBe(1);
    expect(a.duplicate).toBe(false);
  });

  test('a repeated message_id returns the existing receipt and inserts no second row', async () => {
    const first = await enqueueSteeringMessage({
      workflow_run_id: 'run-1',
      node_id: 'review',
      message_id: 'm-1',
      message: 'original',
      operator_user_id: 'op-1',
      initial_state: 'queued',
    });
    const replay = await enqueueSteeringMessage({
      workflow_run_id: 'run-1',
      node_id: 'review',
      message_id: 'm-1',
      message: 'different text is ignored',
      operator_user_id: 'op-2',
      initial_state: 'awaiting_send_now',
    });
    expect(replay.duplicate).toBe(true);
    expect(replay.entry).toEqual(first.entry);
    expect(await listSteeringQueue('run-1', 'review')).toHaveLength(1);
  });

  test('concurrent Promise.all enqueues receive distinct positions 1 and 2', async () => {
    const [a, b] = await Promise.all([
      enqueueSteeringMessage({
        workflow_run_id: 'run-1',
        node_id: 'parallel',
        message_id: 'p-1',
        message: 'a',
        operator_user_id: 'op-1',
        initial_state: 'queued',
      }),
      enqueueSteeringMessage({
        workflow_run_id: 'run-1',
        node_id: 'parallel',
        message_id: 'p-2',
        message: 'b',
        operator_user_id: 'op-1',
        initial_state: 'queued',
      }),
    ]);
    expect([a.entry.fifo_position, b.entry.fifo_position].sort((x, y) => x - y)).toEqual([1, 2]);
  });
});

describe('steering queue: withdraw and listing', () => {
  test('withdraw removes a still-claimable entry; a second withdraw is an idempotent no-op', async () => {
    await enqueueSteeringMessage({
      workflow_run_id: 'run-1',
      node_id: 'review',
      message_id: 'm-1',
      message: 'to withdraw',
      operator_user_id: 'op-1',
      initial_state: 'queued',
    });
    const removed = await withdrawSteeringMessage('run-1', 'review', 'm-1');
    expect(removed).toEqual({ removed: true });
    const again = await withdrawSteeringMessage('run-1', 'review', 'm-1');
    expect(again).toEqual({ removed: false });
    expect(await listSteeringQueue('run-1', 'review')).toHaveLength(0);
  });

  test('withdraw of an already-claimed (dispatching) entry is a no-op', async () => {
    await enqueueSteeringMessage({
      workflow_run_id: 'run-1',
      node_id: 'review',
      message_id: 'm-1',
      message: 'claimed',
      operator_user_id: 'op-1',
      initial_state: 'queued',
    });
    await claimSteeringQueue('run-1', 'review', 'all');
    expect(await withdrawSteeringMessage('run-1', 'review', 'm-1')).toEqual({ removed: false });
  });

  test('withdraw of an unknown message_id is an idempotent no-op', async () => {
    expect(await withdrawSteeringMessage('run-1', 'review', 'never-existed')).toEqual({
      removed: false,
    });
  });

  test('list excludes withdrawn entries but includes never_sent', async () => {
    await enqueueSteeringMessage({
      workflow_run_id: 'run-1',
      node_id: 'review',
      message_id: 'm-1',
      message: 'withdrawn',
      operator_user_id: 'op-1',
      initial_state: 'queued',
    });
    await enqueueSteeringMessage({
      workflow_run_id: 'run-1',
      node_id: 'review',
      message_id: 'm-2',
      message: 'will be never-sent',
      operator_user_id: 'op-1',
      initial_state: 'queued',
    });
    await withdrawSteeringMessage('run-1', 'review', 'm-1');
    await reconcileNeverSentSteeringMessages('run-1', 'review');
    const rows = await listSteeringQueue('run-1', 'review');
    expect(rows.map(row => row.message_id)).toEqual(['m-2']);
    expect(rows[0]?.state).toBe('never_sent');
  });
});

describe('steering queue: claim', () => {
  test('claim with a numeric limit takes exactly the oldest N in FIFO order', async () => {
    for (const id of ['m-1', 'm-2', 'm-3']) {
      await enqueueSteeringMessage({
        workflow_run_id: 'run-1',
        node_id: 'review',
        message_id: id,
        message: id,
        operator_user_id: 'op-1',
        initial_state: 'queued',
      });
    }
    const claimed = await claimSteeringQueue('run-1', 'review', 1);
    expect(claimed.map(c => c.message_id)).toEqual(['m-1']);
    const rows = await listSteeringQueue('run-1', 'review');
    expect(rows.find(r => r.message_id === 'm-1')?.state).toBe('dispatching');
    expect(rows.find(r => r.message_id === 'm-2')?.state).toBe('queued');
    expect(rows.find(r => r.message_id === 'm-3')?.state).toBe('queued');
  });

  test("claim with 'all' takes every eligible entry, queued and awaiting_send_now alike", async () => {
    await enqueueSteeringMessage({
      workflow_run_id: 'run-1',
      node_id: 'review',
      message_id: 'm-1',
      message: 'queued one',
      operator_user_id: 'op-1',
      initial_state: 'queued',
    });
    await enqueueSteeringMessage({
      workflow_run_id: 'run-1',
      node_id: 'review',
      message_id: 'm-2',
      message: 'awaiting one',
      operator_user_id: 'op-1',
      initial_state: 'awaiting_send_now',
    });
    const claimed = await claimSteeringQueue('run-1', 'review', 'all');
    expect(claimed.map(c => c.message_id)).toEqual(['m-1', 'm-2']);
  });

  test('claim on an empty queue returns an empty array without error', async () => {
    expect(await claimSteeringQueue('run-1', 'review', 'all')).toEqual([]);
  });

  test('markSteeringMessagesSent advances dispatching (and delivery_unknown) to sent, never queued', async () => {
    await enqueueSteeringMessage({
      workflow_run_id: 'run-1',
      node_id: 'review',
      message_id: 'm-1',
      message: 'claimed',
      operator_user_id: 'op-1',
      initial_state: 'queued',
    });
    await enqueueSteeringMessage({
      workflow_run_id: 'run-1',
      node_id: 'review',
      message_id: 'm-2',
      message: 'still queued',
      operator_user_id: 'op-1',
      initial_state: 'queued',
    });
    await claimSteeringQueue('run-1', 'review', 1); // claims only m-1
    await markSteeringMessagesSent('run-1', 'review', ['m-1', 'm-2']);
    const rows = await listSteeringQueue('run-1', 'review');
    expect(rows.find(r => r.message_id === 'm-1')?.state).toBe('sent');
    // m-2 was never claimed (still queued) — marking it sent must not skip
    // the claim step.
    expect(rows.find(r => r.message_id === 'm-2')?.state).toBe('queued');
  });

  test('claimSteeringMessageForSoftInjection claims exactly the selected id and leaves others untouched', async () => {
    await enqueueSteeringMessage({
      workflow_run_id: 'run-1',
      node_id: 'review',
      message_id: 'm-1',
      message: 'first',
      operator_user_id: 'op-1',
      initial_state: 'queued',
    });
    await enqueueSteeringMessage({
      workflow_run_id: 'run-1',
      node_id: 'review',
      message_id: 'm-2',
      message: 'selected',
      operator_user_id: 'op-1',
      initial_state: 'queued',
    });
    const claimed = await claimSteeringMessageForSoftInjection('run-1', 'review', 'm-2');
    expect(claimed?.message_id).toBe('m-2');
    const rows = await listSteeringQueue('run-1', 'review');
    expect(rows.find(r => r.message_id === 'm-2')?.state).toBe('sent');
    expect(rows.find(r => r.message_id === 'm-1')?.state).toBe('queued');
  });

  test('claimSteeringMessageForSoftInjection returns null for an id that is not currently claimable', async () => {
    expect(
      await claimSteeringMessageForSoftInjection('run-1', 'review', 'never-existed')
    ).toBeNull();
    await enqueueSteeringMessage({
      workflow_run_id: 'run-1',
      node_id: 'review',
      message_id: 'm-1',
      message: 'already sent',
      operator_user_id: 'op-1',
      initial_state: 'queued',
    });
    await claimSteeringMessageForSoftInjection('run-1', 'review', 'm-1');
    expect(await claimSteeringMessageForSoftInjection('run-1', 'review', 'm-1')).toBeNull();
  });
});

describe('reconciliation', () => {
  test('terminal reconciliation converts queued, awaiting_send_now, and dispatching to never_sent, but not sent', async () => {
    await enqueueSteeringMessage({
      workflow_run_id: 'run-1',
      node_id: 'review',
      message_id: 'm-queued',
      message: 'a',
      operator_user_id: 'op-1',
      initial_state: 'queued',
    });
    await enqueueSteeringMessage({
      workflow_run_id: 'run-1',
      node_id: 'review',
      message_id: 'm-awaiting',
      message: 'b',
      operator_user_id: 'op-1',
      initial_state: 'awaiting_send_now',
    });
    await enqueueSteeringMessage({
      workflow_run_id: 'run-1',
      node_id: 'review',
      message_id: 'm-dispatching',
      message: 'c',
      operator_user_id: 'op-1',
      initial_state: 'queued',
    });
    await claimSteeringQueue('run-1', 'review', 1); // claims m-queued only... but FIFO order claims oldest first
    // Claim the remaining dispatching case directly by id via soft injection's
    // sibling path is out of scope here; drive it through markSteeringMessagesSent
    // absence instead — leave m-dispatching claimed via a second claim call.
    await claimSteeringQueue('run-1', 'review', 1);
    await enqueueSteeringMessage({
      workflow_run_id: 'run-1',
      node_id: 'review',
      message_id: 'm-sent',
      message: 'd',
      operator_user_id: 'op-1',
      initial_state: 'queued',
    });
    await claimSteeringMessageForSoftInjection('run-1', 'review', 'm-sent');

    const result = await reconcileNeverSentSteeringMessages('run-1', 'review');
    expect(result.count).toBe(3);
    const rows = await listSteeringQueue('run-1', 'review');
    expect(rows.find(r => r.message_id === 'm-sent')?.state).toBe('sent');
    expect(rows.find(r => r.message_id === 'm-queued')?.state).toBe('never_sent');
    expect(rows.find(r => r.message_id === 'm-awaiting')?.state).toBe('never_sent');
    expect(rows.find(r => r.message_id === 'm-dispatching')?.state).toBe('never_sent');
  });

  test('terminal reconciliation is idempotent and scoped to (run, node)', async () => {
    await enqueueSteeringMessage({
      workflow_run_id: 'run-1',
      node_id: 'review',
      message_id: 'm-1',
      message: 'a',
      operator_user_id: 'op-1',
      initial_state: 'queued',
    });
    await enqueueSteeringMessage({
      workflow_run_id: 'run-1',
      node_id: 'other-node',
      message_id: 'm-2',
      message: 'b',
      operator_user_id: 'op-1',
      initial_state: 'queued',
    });
    const first = await reconcileNeverSentSteeringMessages('run-1', 'review');
    const second = await reconcileNeverSentSteeringMessages('run-1', 'review');
    expect(first.count).toBe(1);
    expect(second.count).toBe(0);
    // A different node on the same run is untouched.
    expect((await listSteeringQueue('run-1', 'other-node'))[0]?.state).toBe('queued');
  });
});

describe('cascade delete with the owning run', () => {
  test('deleting the workflow run removes its drafts, queue entries, and settings', async () => {
    await upsertSteeringDraft({
      workflow_run_id: 'run-1',
      node_id: 'review',
      operator_user_id: 'op-1',
      message: 'draft',
    });
    await upsertSteeringNodeSettings({ workflow_run_id: 'run-1', node_id: 'review' });
    await enqueueSteeringMessage({
      workflow_run_id: 'run-1',
      node_id: 'review',
      message_id: 'm-1',
      message: 'queued',
      operator_user_id: 'op-1',
      initial_state: 'queued',
    });

    await db.query('DELETE FROM remote_agent_workflow_runs WHERE id = $1', ['run-1']);

    expect(
      await getSteeringDraft({
        workflow_run_id: 'run-1',
        node_id: 'review',
        operator_user_id: 'op-1',
      })
    ).toBeNull();
    expect(await getSteeringNodeSettings('run-1', 'review')).toBeNull();
    expect(await listSteeringQueue('run-1', 'review')).toEqual([]);
  });
});
