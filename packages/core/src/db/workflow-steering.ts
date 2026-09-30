/**
 * Database operations for durable steering state: composer drafts, the node
 * guidance queue, and per-node settings (auto-send, resolved provider id).
 *
 * FIFO position is assigned as MAX(fifo_position)+1 inside a transaction,
 * mirroring the sequence assignment in workflow-node-messages.ts. A duplicate
 * `message_id` is detected by a read inside the same transaction and returns
 * the existing receipt; a genuine position race retries exactly once in a
 * fresh transaction.
 *
 * `operator_user_id` stores an empty string as the identity-less sentinel (an
 * install with no web auth), because a NULL column value is never equal to
 * another NULL under a UNIQUE constraint on either dialect — the sentinel is
 * translated to/from `null` at this module's boundary so every other layer
 * sees the ordinary nullable identity.
 *
 * Every UPDATE avoids `RETURNING`: the SQLite adapter rejects it on UPDATE
 * (see workflows.ts resumeWorkflowRun), so a claim reads the target rows
 * first, then updates by id.
 *
 * Corrupt stored rows fail closed and never log message content.
 */
import { createLogger } from '@archon/paths';
import {
  claimedSteeringMessageSchema,
  enqueueSteeringMessageInputSchema,
  steeringDraftKeySchema,
  steeringDraftSchema,
  steeringNodeSettingsSchema,
  steeringQueueEntrySchema,
  upsertSteeringDraftInputSchema,
  upsertSteeringNodeSettingsInputSchema,
  STEERING_QUEUE_CLAIMABLE_STATES,
  STEERING_QUEUE_VISIBLE_STATES,
  type ClaimedSteeringMessage,
  type EnqueueSteeringMessageInput,
  type EnqueueSteeringMessageResult,
  type SteeringDispatchFailureKind,
  type SteeringDraft,
  type SteeringDraftKey,
  type SteeringNodeSettings,
  type SteeringQueueEntry,
  type UpsertSteeringDraftInput,
  type UpsertSteeringNodeSettingsInput,
} from '@archon/workflows/schemas/steering';
import { getDatabase, getDatabaseType, getDialect, pool } from './connection';

let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('db.workflow-steering');
  return cachedLog;
}

/** Stored row failed schema normalization. Logs id only, never content. */
export class SteeringRowCorruptError extends Error {
  constructor(readonly rowId: string) {
    super(`Steering row corrupt: ${rowId}`);
    this.name = 'SteeringRowCorruptError';
  }
}

function throwCorrupt(rowId: string): never {
  getLog().error({ rowId }, 'db.steering_row_corrupt');
  throw new SteeringRowCorruptError(rowId);
}

/** Identity-less sentinel: an empty string means "no resolved identity". */
function toDbUserId(userId: string | null): string {
  return userId ?? '';
}

function fromDbUserId(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function toDbBool(value: boolean): boolean {
  return value;
}

function fromDbBool(value: unknown): boolean {
  return typeof value === 'number' ? value !== 0 : Boolean(value);
}

const DRAFT_COLUMNS = 'id, workflow_run_id, node_id, operator_user_id, message, updated_at';

function parseDraftRow(raw: unknown): SteeringDraft {
  const row = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const rowId = typeof row.id === 'string' ? row.id : 'unknown';
  const parsed = steeringDraftSchema.safeParse({
    ...row,
    operator_user_id: fromDbUserId(row.operator_user_id),
  });
  if (!parsed.success) throwCorrupt(rowId);
  return parsed.data;
}

export async function getSteeringDraft(key: SteeringDraftKey): Promise<SteeringDraft | null> {
  const parsed = steeringDraftKeySchema.parse(key);
  const result = await pool.query<Record<string, unknown>>(
    `SELECT ${DRAFT_COLUMNS} FROM remote_agent_steering_drafts
     WHERE workflow_run_id = $1 AND node_id = $2 AND operator_user_id = $3`,
    [parsed.workflow_run_id, parsed.node_id, toDbUserId(parsed.operator_user_id)]
  );
  const row = result.rows[0];
  return row === undefined ? null : parseDraftRow(row);
}

export async function upsertSteeringDraft(input: UpsertSteeringDraftInput): Promise<SteeringDraft> {
  const parsed = upsertSteeringDraftInputSchema.parse(input);
  const db = getDatabase();
  const dialect = getDialect();
  const dbUserId = toDbUserId(parsed.operator_user_id);

  return db.withTransaction(async query => {
    const existing = await query<{ id: string }>(
      `SELECT id FROM remote_agent_steering_drafts
       WHERE workflow_run_id = $1 AND node_id = $2 AND operator_user_id = $3`,
      [parsed.workflow_run_id, parsed.node_id, dbUserId]
    );
    const existingId = existing.rows[0]?.id;
    if (existingId !== undefined) {
      await query(
        `UPDATE remote_agent_steering_drafts
         SET message = $2, updated_at = ${dialect.now()}
         WHERE id = $1`,
        [existingId, parsed.message]
      );
      const reloaded = await query<Record<string, unknown>>(
        `SELECT ${DRAFT_COLUMNS} FROM remote_agent_steering_drafts WHERE id = $1`,
        [existingId]
      );
      return parseDraftRow(reloaded.rows[0]);
    }
    const id = dialect.generateUuid();
    await query(
      `INSERT INTO remote_agent_steering_drafts
         (id, workflow_run_id, node_id, operator_user_id, message)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, parsed.workflow_run_id, parsed.node_id, dbUserId, parsed.message]
    );
    const inserted = await query<Record<string, unknown>>(
      `SELECT ${DRAFT_COLUMNS} FROM remote_agent_steering_drafts WHERE id = $1`,
      [id]
    );
    return parseDraftRow(inserted.rows[0]);
  });
}

export async function clearSteeringDraft(key: SteeringDraftKey): Promise<void> {
  const parsed = steeringDraftKeySchema.parse(key);
  await pool.query(
    `DELETE FROM remote_agent_steering_drafts
     WHERE workflow_run_id = $1 AND node_id = $2 AND operator_user_id = $3`,
    [parsed.workflow_run_id, parsed.node_id, toDbUserId(parsed.operator_user_id)]
  );
}

const NODE_SETTINGS_COLUMNS =
  'id, workflow_run_id, node_id, auto_send_enabled, updated_by_user_id, provider_id, updated_at';

function parseNodeSettingsRow(raw: unknown): SteeringNodeSettings {
  const row = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const rowId = typeof row.id === 'string' ? row.id : 'unknown';
  const parsed = steeringNodeSettingsSchema.safeParse({
    ...row,
    auto_send_enabled: fromDbBool(row.auto_send_enabled),
    updated_by_user_id: fromDbUserId(row.updated_by_user_id),
    provider_id: typeof row.provider_id === 'string' ? row.provider_id : null,
  });
  if (!parsed.success) throwCorrupt(rowId);
  return parsed.data;
}

export async function getSteeringNodeSettings(
  workflowRunId: string,
  nodeId: string
): Promise<SteeringNodeSettings | null> {
  const result = await pool.query<Record<string, unknown>>(
    `SELECT ${NODE_SETTINGS_COLUMNS} FROM remote_agent_steering_node_settings
     WHERE workflow_run_id = $1 AND node_id = $2`,
    [workflowRunId, nodeId]
  );
  const row = result.rows[0];
  return row === undefined ? null : parseNodeSettingsRow(row);
}

/** Partial merge — only the fields present on `input` change on an existing row. */
export async function upsertSteeringNodeSettings(
  input: UpsertSteeringNodeSettingsInput
): Promise<SteeringNodeSettings> {
  const parsed = upsertSteeringNodeSettingsInputSchema.parse(input);
  const db = getDatabase();
  const dialect = getDialect();

  return db.withTransaction(async query => {
    const existing = await query<Record<string, unknown>>(
      `SELECT ${NODE_SETTINGS_COLUMNS} FROM remote_agent_steering_node_settings
       WHERE workflow_run_id = $1 AND node_id = $2`,
      [parsed.workflow_run_id, parsed.node_id]
    );
    const current =
      existing.rows[0] === undefined ? undefined : parseNodeSettingsRow(existing.rows[0]);

    const nextAutoSend = parsed.auto_send_enabled ?? current?.auto_send_enabled ?? false;
    const nextUpdatedBy =
      parsed.updated_by_user_id !== undefined
        ? parsed.updated_by_user_id
        : (current?.updated_by_user_id ?? null);
    const nextProvider = parsed.provider_id ?? current?.provider_id ?? null;

    if (current !== undefined) {
      await query(
        `UPDATE remote_agent_steering_node_settings
         SET auto_send_enabled = $2, updated_by_user_id = $3, provider_id = $4, updated_at = ${dialect.now()}
         WHERE id = $1`,
        [current.id, toDbBool(nextAutoSend), toDbUserId(nextUpdatedBy), nextProvider]
      );
      const reloaded = await query<Record<string, unknown>>(
        `SELECT ${NODE_SETTINGS_COLUMNS} FROM remote_agent_steering_node_settings WHERE id = $1`,
        [current.id]
      );
      return parseNodeSettingsRow(reloaded.rows[0]);
    }

    const id = dialect.generateUuid();
    await query(
      `INSERT INTO remote_agent_steering_node_settings
         (id, workflow_run_id, node_id, auto_send_enabled, updated_by_user_id, provider_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        id,
        parsed.workflow_run_id,
        parsed.node_id,
        toDbBool(nextAutoSend),
        toDbUserId(nextUpdatedBy),
        nextProvider,
      ]
    );
    const inserted = await query<Record<string, unknown>>(
      `SELECT ${NODE_SETTINGS_COLUMNS} FROM remote_agent_steering_node_settings WHERE id = $1`,
      [id]
    );
    return parseNodeSettingsRow(inserted.rows[0]);
  });
}

const QUEUE_COLUMNS =
  'id, workflow_run_id, node_id, message_id, message, operator_user_id, fifo_position, state, last_error, dispatch_failure_count, last_failure_kind, created_at, updated_at';

function parseQueueRow(raw: unknown): SteeringQueueEntry {
  const row = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const rowId = typeof row.id === 'string' ? row.id : 'unknown';
  const parsed = steeringQueueEntrySchema.safeParse({
    ...row,
    operator_user_id: fromDbUserId(row.operator_user_id),
    fifo_position: Number(row.fifo_position),
    dispatch_failure_count: Number(row.dispatch_failure_count),
  });
  if (!parsed.success) throwCorrupt(rowId);
  return parsed.data;
}

/**
 * Map a dialect unique violation on the steering queue table to which
 * constraint fired, so the caller retries a position race but never retries
 * a duplicate `message_id` (that path re-reads the existing receipt instead).
 */
function classifySteeringQueueConflict(error: unknown): 'position' | 'message_id' | 'other' {
  if (!(error instanceof Error)) return 'other';
  const dbError = error as Error & { code?: string; constraint?: string };
  if (dbError.code === '23505') {
    if (dbError.constraint === 'uq_steering_queue_run_node_position') return 'position';
    if (dbError.constraint === 'uq_steering_queue_run_node_message') return 'message_id';
    return 'other';
  }
  if (!/UNIQUE constraint failed/i.test(dbError.message)) return 'other';
  const columns = dbError.message
    .replace(/^[\s\S]*UNIQUE constraint failed:\s*/i, '')
    .split(',')
    .map(column => column.trim().toLowerCase());
  if (columns.includes('remote_agent_steering_queue_entries.fifo_position')) return 'position';
  if (columns.includes('remote_agent_steering_queue_entries.message_id')) return 'message_id';
  return 'other';
}

async function fetchQueueEntryByMessageId(
  workflowRunId: string,
  nodeId: string,
  messageId: string
): Promise<SteeringQueueEntry | undefined> {
  const result = await pool.query<Record<string, unknown>>(
    `SELECT ${QUEUE_COLUMNS} FROM remote_agent_steering_queue_entries
     WHERE workflow_run_id = $1 AND node_id = $2 AND message_id = $3`,
    [workflowRunId, nodeId, messageId]
  );
  const row = result.rows[0];
  return row === undefined ? undefined : parseQueueRow(row);
}

async function enqueueOnce(
  parsed: EnqueueSteeringMessageInput
): Promise<EnqueueSteeringMessageResult> {
  const db = getDatabase();
  const dialect = getDialect();
  return db.withTransaction(async query => {
    const existing = await query<Record<string, unknown>>(
      `SELECT ${QUEUE_COLUMNS} FROM remote_agent_steering_queue_entries
       WHERE workflow_run_id = $1 AND node_id = $2 AND message_id = $3`,
      [parsed.workflow_run_id, parsed.node_id, parsed.message_id]
    );
    if (existing.rows[0] !== undefined) {
      return { entry: parseQueueRow(existing.rows[0]), duplicate: true };
    }
    const next = await query<{ next_position: number | string }>(
      `SELECT COALESCE(MAX(fifo_position), 0) + 1 AS next_position
       FROM remote_agent_steering_queue_entries WHERE workflow_run_id = $1 AND node_id = $2`,
      [parsed.workflow_run_id, parsed.node_id]
    );
    const position = Number(next.rows[0]?.next_position ?? 1);
    const id = dialect.generateUuid();
    await query(
      `INSERT INTO remote_agent_steering_queue_entries
         (id, workflow_run_id, node_id, message_id, message, operator_user_id, fifo_position, state)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        parsed.workflow_run_id,
        parsed.node_id,
        parsed.message_id,
        parsed.message,
        toDbUserId(parsed.operator_user_id),
        position,
        parsed.initial_state,
      ]
    );
    const inserted = await query<Record<string, unknown>>(
      `SELECT ${QUEUE_COLUMNS} FROM remote_agent_steering_queue_entries WHERE id = $1`,
      [id]
    );
    return { entry: parseQueueRow(inserted.rows[0]), duplicate: false };
  });
}

export async function enqueueSteeringMessage(
  input: EnqueueSteeringMessageInput
): Promise<EnqueueSteeringMessageResult> {
  const parsed = enqueueSteeringMessageInputSchema.parse(input);
  try {
    return await enqueueOnce(parsed);
  } catch (error) {
    const conflict = classifySteeringQueueConflict(error);
    if (conflict === 'message_id') {
      const existing = await fetchQueueEntryByMessageId(
        parsed.workflow_run_id,
        parsed.node_id,
        parsed.message_id
      );
      if (existing !== undefined) return { entry: existing, duplicate: true };
      throw error;
    }
    if (conflict === 'position') {
      return enqueueOnce(parsed);
    }
    throw error;
  }
}

export async function withdrawSteeringMessage(
  workflowRunId: string,
  nodeId: string,
  messageId: string
): Promise<{ removed: boolean }> {
  const dialect = getDialect();
  const claimableList = STEERING_QUEUE_CLAIMABLE_STATES.map((_, i) => `$${String(i + 4)}`).join(
    ', '
  );
  const result = await pool.query(
    `UPDATE remote_agent_steering_queue_entries
     SET state = 'withdrawn', updated_at = ${dialect.now()}
     WHERE workflow_run_id = $1 AND node_id = $2 AND message_id = $3
       AND state IN (${claimableList})`,
    [workflowRunId, nodeId, messageId, ...STEERING_QUEUE_CLAIMABLE_STATES]
  );
  return { removed: (result.rowCount ?? 0) > 0 };
}

export async function listSteeringQueue(
  workflowRunId: string,
  nodeId: string
): Promise<SteeringQueueEntry[]> {
  const visibleList = STEERING_QUEUE_VISIBLE_STATES.map((_, i) => `$${String(i + 3)}`).join(', ');
  const result = await pool.query<Record<string, unknown>>(
    `SELECT ${QUEUE_COLUMNS} FROM remote_agent_steering_queue_entries
     WHERE workflow_run_id = $1 AND node_id = $2 AND state IN (${visibleList})
     ORDER BY fifo_position ASC`,
    [workflowRunId, nodeId, ...STEERING_QUEUE_VISIBLE_STATES]
  );
  return result.rows.map(parseQueueRow);
}

function toClaimedMessage(entry: SteeringQueueEntry): ClaimedSteeringMessage {
  return claimedSteeringMessageSchema.parse({
    message_id: entry.message_id,
    message: entry.message,
    operator_user_id: entry.operator_user_id,
  });
}

export async function claimSteeringQueue(
  workflowRunId: string,
  nodeId: string,
  limit: number | 'all'
): Promise<ClaimedSteeringMessage[]> {
  const db = getDatabase();
  const dialect = getDialect();
  const lockSuffix = getDatabaseType() === 'postgresql' ? ' FOR UPDATE' : '';
  const claimableList = STEERING_QUEUE_CLAIMABLE_STATES.map((_, i) => `$${String(i + 3)}`).join(
    ', '
  );
  const limitSql =
    limit === 'all' ? '' : ` LIMIT $${String(3 + STEERING_QUEUE_CLAIMABLE_STATES.length)}`;
  const params: unknown[] = [workflowRunId, nodeId, ...STEERING_QUEUE_CLAIMABLE_STATES];
  if (limit !== 'all') params.push(limit);

  return db.withTransaction(async query => {
    const selected = await query<Record<string, unknown>>(
      `SELECT ${QUEUE_COLUMNS} FROM remote_agent_steering_queue_entries
       WHERE workflow_run_id = $1 AND node_id = $2 AND state IN (${claimableList})
       ORDER BY fifo_position ASC${limitSql}${lockSuffix}`,
      params
    );
    if (selected.rows.length === 0) return [];
    const entries = selected.rows.map(parseQueueRow);
    for (const entry of entries) {
      await query(
        `UPDATE remote_agent_steering_queue_entries
         SET state = 'dispatching', updated_at = ${dialect.now()}
         WHERE id = $1`,
        [entry.id]
      );
    }
    return entries.map(toClaimedMessage);
  });
}

/**
 * `dispatching` -> `sent` once a transcript receipt exists for these ids. Also
 * accepts a prior `delivery_unknown`: a transcript receipt is stronger
 * evidence than an earlier ambiguous-claim judgment, so a message once
 * marked ambiguous still advances correctly if the same claim goes on to
 * deliver after all.
 */
export async function markSteeringMessagesSent(
  workflowRunId: string,
  nodeId: string,
  messageIds: readonly string[]
): Promise<void> {
  if (messageIds.length === 0) return;
  const dialect = getDialect();
  const idPlaceholders = messageIds.map((_, i) => `$${String(i + 5)}`).join(', ');
  await pool.query(
    `UPDATE remote_agent_steering_queue_entries
     SET state = 'sent', updated_at = ${dialect.now()}
     WHERE workflow_run_id = $1 AND node_id = $2 AND state IN ($3, $4)
       AND message_id IN (${idPlaceholders})`,
    [workflowRunId, nodeId, 'dispatching', 'delivery_unknown', ...messageIds]
  );
}

/**
 * `sent` -> `delivered`, once the live provider turn echoes a verified
 * acknowledgement for this exact caller-stamped message id. A missing row or
 * a row not currently `sent` (already delivered, withdrawn, reconciled, or
 * never claimed) is a silent no-op — delivery ack correlates by id alone and
 * must never advance a different entry.
 */
export async function markSteeringMessageDelivered(
  workflowRunId: string,
  nodeId: string,
  messageId: string
): Promise<void> {
  const dialect = getDialect();
  await pool.query(
    `UPDATE remote_agent_steering_queue_entries
     SET state = 'delivered', updated_at = ${dialect.now()}
     WHERE workflow_run_id = $1 AND node_id = $2 AND message_id = $3 AND state = 'sent'`,
    [workflowRunId, nodeId, messageId]
  );
}

/**
 * Reverts a claimed (`dispatching`) automatic-dispatch entry back to
 * `queued` after a retryable failure — a thrown provider/execution error on
 * a guidance turn whose session is still established (never a session-losing
 * failure; that path keeps failing the node, unchanged). Deliberately
 * `queued`, not a distinct terminal state: the entry must stay re-claimable
 * — `STEERING_QUEUE_CLAIMABLE_STATES` never grew a `failed` value — and
 * `fifo_position` is left untouched, so the SAME `ORDER BY fifo_position ASC`
 * claim SQL already puts it back at the front among claimable entries (it
 * was claimed first, so its position was already the smallest). `last_error`
 * carries the durable evidence the dock renders; `dispatch_failure_count`
 * is incremented, never capped — an operator's own Send now decides when to
 * stop retrying, not a server-side limit. `failureKind` names the attempt
 * that claimed the entry (`automatic` or `send_now`) so the dock's failure
 * copy never assumes automatic. Idempotent: the `state = 'dispatching'`
 * guard makes a second call for an already-reverted (or since-advanced)
 * entry a no-op.
 */
export async function revertSteeringQueueClaim(
  workflowRunId: string,
  nodeId: string,
  messageIds: readonly string[],
  failureMessage: string,
  failureKind: SteeringDispatchFailureKind
): Promise<void> {
  if (messageIds.length === 0) return;
  const dialect = getDialect();
  const idPlaceholders = messageIds.map((_, i) => `$${String(i + 5)}`).join(', ');
  await pool.query(
    `UPDATE remote_agent_steering_queue_entries
     SET state = 'queued',
         last_error = $3,
         dispatch_failure_count = dispatch_failure_count + 1,
         last_failure_kind = $4,
         updated_at = ${dialect.now()}
     WHERE workflow_run_id = $1 AND node_id = $2 AND state = 'dispatching'
       AND message_id IN (${idPlaceholders})`,
    [workflowRunId, nodeId, failureMessage, failureKind, ...messageIds]
  );
}

/**
 * Reverts a soft-injection claim back to `queued` when the live provider
 * turn did not actually accept the request. `claimSteeringMessageForSoftInjection`
 * durably claims the entry to `sent` before delivery is attempted (so the
 * durable claim itself is the seam per `engine-integration.md`), so a refused
 * or unreachable live turn must not strand the entry there — the queue must
 * stay unchanged from the caller's perspective per the API contract's "every
 * rejected request leaves the queue unchanged" rule. No-op when the entry is
 * no longer `sent` (e.g. a concurrent path already advanced it further).
 */
export async function revertSteeringSoftInjectionClaim(
  workflowRunId: string,
  nodeId: string,
  messageId: string
): Promise<void> {
  const dialect = getDialect();
  await pool.query(
    `UPDATE remote_agent_steering_queue_entries
     SET state = 'queued', updated_at = ${dialect.now()}
     WHERE workflow_run_id = $1 AND node_id = $2 AND message_id = $3 AND state = 'sent'`,
    [workflowRunId, nodeId, messageId]
  );
}

export async function claimSteeringMessageForSoftInjection(
  workflowRunId: string,
  nodeId: string,
  messageId: string
): Promise<ClaimedSteeringMessage | null> {
  const db = getDatabase();
  const dialect = getDialect();
  const claimableList = STEERING_QUEUE_CLAIMABLE_STATES.map((_, i) => `$${String(i + 4)}`).join(
    ', '
  );
  return db.withTransaction(async query => {
    const cas = await query(
      `UPDATE remote_agent_steering_queue_entries
       SET state = 'sent', updated_at = ${dialect.now()}
       WHERE workflow_run_id = $1 AND node_id = $2 AND message_id = $3
         AND state IN (${claimableList})`,
      [workflowRunId, nodeId, messageId, ...STEERING_QUEUE_CLAIMABLE_STATES]
    );
    if ((cas.rowCount ?? 0) === 0) return null;
    const reloaded = await query<Record<string, unknown>>(
      `SELECT ${QUEUE_COLUMNS} FROM remote_agent_steering_queue_entries
       WHERE workflow_run_id = $1 AND node_id = $2 AND message_id = $3`,
      [workflowRunId, nodeId, messageId]
    );
    const row = reloaded.rows[0];
    return row === undefined ? null : toClaimedMessage(parseQueueRow(row));
  });
}

/**
 * Returns every `sent` entry of one node that has no operator row in the
 * durable transcript to `queued`, keeping its FIFO position (the front of the
 * queue). A soft-injected message is `sent` as soon as the transport takes it,
 * but only the operator row proves the model read it, and the in-memory
 * ledger that tracks the gap does not survive a restart. Entries whose row
 * exists are left as they are. Idempotent.
 */
export async function restoreUnreadSoftInjections(
  workflowRunId: string,
  nodeId: string
): Promise<{ count: number }> {
  const dialect = getDialect();
  const messageIdSql =
    getDatabaseType() === 'postgresql'
      ? "(m.metadata->>'message_id')"
      : "json_extract(m.metadata, '$.message_id')";
  const result = await pool.query(
    `UPDATE remote_agent_steering_queue_entries
     SET state = 'queued', updated_at = ${dialect.now()}
     WHERE workflow_run_id = $1 AND node_id = $2 AND state = 'sent'
       AND NOT EXISTS (
         SELECT 1 FROM remote_agent_workflow_node_messages m
         WHERE m.workflow_run_id = $1 AND m.node_id = $2
           AND ${messageIdSql} = remote_agent_steering_queue_entries.message_id
       )`,
    [workflowRunId, nodeId]
  );
  return { count: result.rowCount ?? 0 };
}

const RECONCILE_STATES = ['queued', 'awaiting_send_now', 'dispatching'] as const;

/**
 * Marks every still-open entry (`queued`, `awaiting_send_now`, or
 * `dispatching`) for one (run, node) as `never_sent`. Called by the executor
 * that owned the node, from its own terminal `finally`, at the moment it
 * knows the node will never claim another entry — so a `dispatching` row
 * only ever resolves through the same in-process authority that could see
 * it live, never through a separate process guessing at another one's
 * outcome. This is why no table-wide sweep runs at server startup either:
 * the CLI drives the same executor against the same database
 * (single-tenant-per-install means one install, not one writer process), so
 * a `dispatching` row this process cannot see live may still be owned by a
 * different one, and mutating it anyway is exactly what the "No Autonomous
 * Lifecycle Mutation Across Process Boundaries" rule forbids. The queue
 * read's `execution_state: 'recovery_required'` combined with a queued
 * item's own `dispatching` state already gives an honest, unmutated view of
 * that ambiguity instead.
 */
export async function reconcileNeverSentSteeringMessages(
  workflowRunId: string,
  nodeId: string
): Promise<{ count: number }> {
  const dialect = getDialect();
  const stateList = RECONCILE_STATES.map((_, i) => `$${String(i + 3)}`).join(', ');
  const result = await pool.query(
    `UPDATE remote_agent_steering_queue_entries
     SET state = 'never_sent', updated_at = ${dialect.now()}
     WHERE workflow_run_id = $1 AND node_id = $2 AND state IN (${stateList})`,
    [workflowRunId, nodeId, ...RECONCILE_STATES]
  );
  return { count: result.rowCount ?? 0 };
}
