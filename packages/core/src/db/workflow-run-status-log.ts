/**
 * Database operations for the workflow run status log: an append-only record
 * of each observed change in a run's externally visible state (status, open
 * human gate, PR link). The MCP events surface serves these rows.
 *
 * Two orderings:
 * - `position` is global and strictly increasing. It is the replay cursor, so
 *   one cursor value is valid for every subscription filter.
 * - `seq` counts per run from 1. `<workflow_run_id>:<seq>` is the stable event id.
 *
 * Both are assigned as MAX()+1 inside one transaction. The caller passes the
 * `seq` of the last row it compared against; when another writer appended for
 * the same run first, the (workflow_run_id, seq) constraint rejects the insert
 * and the append is a no-op (the other writer already recorded that state). A
 * conflict on `position` only (two different runs at once) is retried, because
 * dropping it would lose a real transition.
 *
 * `created_at` is written explicitly as an ISO-8601 string with milliseconds,
 * so SQLite `since` filters compare correctly as text and both dialects give
 * the same precision.
 */
import { createLogger } from '@archon/paths';

import { getDatabase, getDialect, pool } from './connection';

let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('db.workflow-run-status-log');
  return cachedLog;
}

const TABLE = 'remote_agent_workflow_run_status_log';
const COLUMNS =
  'l.id, l.workflow_run_id, l.position, l.seq, l.status, l.gate_key, l.data, l.created_at';
const NON_TERMINAL_STATUSES = ['pending', 'running', 'paused'] as const;
const MAX_POSITION_RETRIES = 3;

export interface WorkflowRunStatusLogRow {
  id: string;
  workflow_run_id: string;
  position: number;
  seq: number;
  status: string;
  gate_key: string | null;
  data: Record<string, unknown>;
  /** ISO-8601 timestamp. */
  created_at: string;
}

export interface AppendStatusLogRowInput {
  workflow_run_id: string;
  status: string;
  gate_key: string | null;
  data: Record<string, unknown>;
  /** `seq` of the last row the caller compared against; 0 when the run has no row yet. */
  previous_seq: number;
}

export interface ListStatusLogRowsQuery {
  /** Return rows with `position > after`. */
  after: number;
  /** Return rows with `position <= through`. */
  through?: number;
  runId?: string;
  workflow?: string;
  /** ISO-8601; return rows with `created_at >= since`. */
  since?: string;
  /** ISO-8601; return rows with `created_at < before`. */
  before?: string;
  limit: number;
}

/** Stored row could not be normalized. Logs the row id only. */
export class WorkflowRunStatusLogCorruptRowError extends Error {
  constructor(readonly rowId: string) {
    super(`Workflow run status log row corrupt: ${rowId}`);
    this.name = 'WorkflowRunStatusLogCorruptRowError';
  }
}

type ConstraintName = 'uq_workflow_run_status_log_run_seq' | 'uq_workflow_run_status_log_position';

/**
 * Which unique constraint a dialect error names, if any. PostgreSQL reports the
 * constraint name; SQLite lists the fully qualified columns.
 */
function uniqueConstraintOf(error: unknown): ConstraintName | undefined {
  if (!(error instanceof Error)) return undefined;
  const dbError = error as Error & { code?: string; constraint?: string };
  if (dbError.code === '23505') {
    if (dbError.constraint === 'uq_workflow_run_status_log_run_seq') return dbError.constraint;
    if (dbError.constraint === 'uq_workflow_run_status_log_position') return dbError.constraint;
    return undefined;
  }
  if (!/UNIQUE constraint failed/i.test(dbError.message)) return undefined;
  const columns = dbError.message
    .replace(/^[\s\S]*UNIQUE constraint failed:\s*/i, '')
    .split(',')
    .map(column => column.trim().toLowerCase());
  if (columns.includes(`${TABLE}.seq`)) return 'uq_workflow_run_status_log_run_seq';
  if (columns.includes(`${TABLE}.position`)) return 'uq_workflow_run_status_log_position';
  return undefined;
}

function toIso(value: unknown, rowId: string): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value.length > 0) return value;
  getLog().error({ rowId, reason: 'created_at' }, 'db.workflow_run_status_log_corrupt_row');
  throw new WorkflowRunStatusLogCorruptRowError(rowId);
}

function parseRow(raw: unknown): WorkflowRunStatusLogRow {
  const row = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const rowId = typeof row.id === 'string' ? row.id : 'unknown';
  let data: unknown = row.data;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data) as unknown;
    } catch {
      getLog().error(
        { rowId, reason: 'data_json_parse' },
        'db.workflow_run_status_log_corrupt_row'
      );
      throw new WorkflowRunStatusLogCorruptRowError(rowId);
    }
  }
  // pg returns BIGINT as a string; SQLite returns a number.
  const position = Number(row.position);
  const seq = Number(row.seq);
  if (
    typeof row.workflow_run_id !== 'string' ||
    typeof row.status !== 'string' ||
    !Number.isSafeInteger(position) ||
    !Number.isSafeInteger(seq) ||
    data === null ||
    typeof data !== 'object' ||
    Array.isArray(data)
  ) {
    getLog().error({ rowId, reason: 'row_shape' }, 'db.workflow_run_status_log_corrupt_row');
    throw new WorkflowRunStatusLogCorruptRowError(rowId);
  }
  return {
    id: rowId,
    workflow_run_id: row.workflow_run_id,
    position,
    seq,
    status: row.status,
    gate_key: typeof row.gate_key === 'string' ? row.gate_key : null,
    data: data as Record<string, unknown>,
    created_at: toIso(row.created_at, rowId),
  };
}

async function appendOnce(input: AppendStatusLogRowInput): Promise<WorkflowRunStatusLogRow> {
  const db = getDatabase();
  const dialect = getDialect();
  return db.withTransaction(async query => {
    const next = await query<{ next_position: number | string }>(
      `SELECT COALESCE(MAX(l.position), 0) + 1 AS next_position FROM ${TABLE} l`
    );
    const position = Number(next.rows[0]?.next_position ?? 1);
    const id = dialect.generateUuid();
    await query(
      `INSERT INTO ${TABLE}
         (id, workflow_run_id, position, seq, status, gate_key, data, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        input.workflow_run_id,
        position,
        input.previous_seq + 1,
        input.status,
        input.gate_key,
        JSON.stringify(input.data),
        new Date().toISOString(),
      ]
    );
    const inserted = await query<Record<string, unknown>>(
      `SELECT ${COLUMNS} FROM ${TABLE} l WHERE l.id = $1`,
      [id]
    );
    return parseRow(inserted.rows[0]);
  });
}

/**
 * Append one row with `seq = previous_seq + 1`.
 *
 * Returns `null` when another writer already appended that `seq` for the run
 * (the caller's view of the last row is stale, so its row would duplicate or
 * misorder the log). Throws on any other database error.
 */
export async function appendStatusLogRow(
  input: AppendStatusLogRowInput
): Promise<WorkflowRunStatusLogRow | null> {
  if (!Number.isInteger(input.previous_seq) || input.previous_seq < 0) {
    throw new Error(
      `previous_seq must be a non-negative integer, got ${String(input.previous_seq)}`
    );
  }
  for (let attempt = 1; ; attempt++) {
    try {
      return await appendOnce(input);
    } catch (error) {
      const constraint = uniqueConstraintOf(error);
      if (constraint === 'uq_workflow_run_status_log_run_seq') {
        getLog().debug(
          { workflowRunId: input.workflow_run_id, seq: input.previous_seq + 1 },
          'db.workflow_run_status_log_seq_taken'
        );
        return null;
      }
      if (constraint === 'uq_workflow_run_status_log_position' && attempt < MAX_POSITION_RETRIES) {
        continue;
      }
      getLog().error(
        { err: error as Error, workflowRunId: input.workflow_run_id },
        'db.workflow_run_status_log_append_failed'
      );
      throw error;
    }
  }
}

export async function getLastStatusLogRow(
  workflowRunId: string
): Promise<WorkflowRunStatusLogRow | null> {
  const result = await pool.query<Record<string, unknown>>(
    `SELECT ${COLUMNS} FROM ${TABLE} l WHERE l.workflow_run_id = $1 ORDER BY l.seq DESC LIMIT 1`,
    [workflowRunId]
  );
  const row = result.rows[0];
  return row === undefined ? null : parseRow(row);
}

/** Highest position in the log; 0 when the log is empty. */
export async function getMaxStatusLogPosition(): Promise<number> {
  const result = await pool.query<{ max_position: number | string | null }>(
    `SELECT MAX(l.position) AS max_position FROM ${TABLE} l`
  );
  const raw = result.rows[0]?.max_position;
  return raw === null || raw === undefined ? 0 : Number(raw);
}

/** Rows in position order, filtered by run, workflow name, and creation time. */
export async function listStatusLogRows(
  query: ListStatusLogRowsQuery
): Promise<WorkflowRunStatusLogRow[]> {
  if (!Number.isInteger(query.limit) || query.limit < 1) {
    throw new Error(`limit must be a positive integer, got ${String(query.limit)}`);
  }
  const values: unknown[] = [query.after];
  const where: string[] = ['l.position > $1'];
  if (query.through !== undefined) {
    values.push(query.through);
    where.push(`l.position <= $${String(values.length)}`);
  }
  if (query.runId !== undefined) {
    values.push(query.runId);
    where.push(`l.workflow_run_id = $${String(values.length)}`);
  }
  if (query.workflow !== undefined) {
    values.push(query.workflow);
    where.push(`r.workflow_name = $${String(values.length)}`);
  }
  if (query.since !== undefined) {
    values.push(query.since);
    where.push(`l.created_at >= $${String(values.length)}`);
  }
  if (query.before !== undefined) {
    values.push(query.before);
    where.push(`l.created_at < $${String(values.length)}`);
  }
  values.push(query.limit);
  const join =
    query.workflow !== undefined
      ? ' JOIN remote_agent_workflow_runs r ON r.id = l.workflow_run_id'
      : '';
  const result = await pool.query<Record<string, unknown>>(
    `SELECT ${COLUMNS} FROM ${TABLE} l${join}
     WHERE ${where.join(' AND ')}
     ORDER BY l.position ASC
     LIMIT $${String(values.length)}`,
    values
  );
  return result.rows.map(parseRow);
}

/**
 * Run ids the status-log writer must re-check: runs that are not terminal, and
 * runs whose last log row is not terminal (a change made by another process,
 * such as a CLI cancel, is caught by the next check).
 */
export async function listStatusLogReconcileRunIds(): Promise<string[]> {
  const statuses = NON_TERMINAL_STATUSES.map(s => `'${s}'`).join(', ');
  const result = await pool.query<{ id: string }>(
    `SELECT r.id AS id FROM remote_agent_workflow_runs r WHERE r.status IN (${statuses})
     UNION
     SELECT l.workflow_run_id AS id FROM ${TABLE} l
     WHERE l.status IN (${statuses})
       AND l.seq = (SELECT MAX(l2.seq) FROM ${TABLE} l2 WHERE l2.workflow_run_id = l.workflow_run_id)`
  );
  return result.rows.map(row => row.id);
}
