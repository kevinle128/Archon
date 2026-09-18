#!/usr/bin/env bun
/**
 * Read-only generic-fallback audit (Issue #176, Story 1.3 / CAP-2).
 *
 * Measures what the release gate needs to know: of the logical UI tool cards a
 * corpus presents — one card per invocation after `projectToolTranscript()`
 * pairing, exactly as the node rooms render them — how many resolve to the
 * `generic` family. Release fails when that fraction is >= 2% (integer compare:
 * `genericCards * 100 >= logicalCards * 2`).
 *
 * Usage:
 *   bun run scripts/audit-generic-fallback.ts --sqlite <db-path>
 *       --source <id> [--record <path>] [--include-generic-names]
 *   bun run scripts/audit-generic-fallback.ts --postgres-env <VAR>
 *       --source <id> [--record <path>] [--include-generic-names]
 *   bun run scripts/audit-generic-fallback.ts --check <record-path>
 *
 * Safety contract:
 *   - Importing this module performs no argument parsing, connection, output,
 *     or file write; main() runs only under `import.meta.main`.
 *   - No implicit database target: ~/.archon and DATABASE_URL are never read.
 *     SQLite takes an explicit path; PostgreSQL takes the NAME of an
 *     environment variable holding the connection URL so credentials never
 *     reach the command line.
 *   - SQLite opens with `{ readonly: true }` plus `PRAGMA query_only = ON`
 *     inside a single deferred transaction (consistent snapshot). A cleanly
 *     checkpointed WAL database has no -shm/-wal for a read-only handle to
 *     attach to and fails open — run while the install is up, or audit a
 *     checkpointed copy. PostgreSQL uses a direct `Bun.sql` client inside a
 *     `READ ONLY` + `REPEATABLE READ` transaction — never @archon/core adapters
 *     (they apply schema on construction) and never the transitive `pg` dep.
 *   - The projection selects only id/run/node/seq, payload id/name/input, an
 *     output-key-present boolean, and metadata tool_phase/occurrence/attempt.
 *     Output bodies never leave the database; the inert OUTPUT_PRESENT sentinel
 *     stands in so legacy result detection (`payload.output !== undefined`)
 *     matches the UI without reading output content.
 *   - Rows are consumed in keyset order inside the snapshot, one
 *     (workflow_run_id, node_id) group at a time; a node over
 *     MAX_NODE_TOOL_ROWS fails closed with an actionable error.
 *   - `--record` writes via same-directory temp file + atomic rename.
 *   - `--check` reads only the record plus AUDIT_SOURCE_FILES — never a
 *     database — and validates schema, source hash, freshness, nonzero
 *     denominator, fraction consistency, and the 2% threshold.
 *   - Credentials, payload bodies, file paths, database URLs, and absolute
 *     database paths never enter stdout or the record.
 *
 * Exit codes: 0 pass — 1 policy failure (threshold breach, or an
 * unusable/stale/mismatched record at --check) — 2 invocation error — 3
 * data/access failure (unreachable corpus, malformed rows, empty corpus).
 *
 * `auditSourceSha256` covers AUDIT_SOURCE_FILES — the classification resolver
 * (`tool-presentation.ts`), its bounded-normalizer dependency
 * (`tool-output.ts`), and the pairing projector (`pair-tool-transcript.ts`) —
 * so a release record is invalidated when the measured semantics change.
 */
import { Database } from 'bun:sqlite';
import { SQL } from 'bun';
import { createHash } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  projectToolTranscript,
  type PairableMessage,
  type PairableToolMetadata,
} from '../packages/web/src/lib/pair-tool-transcript';
import { toolPresentation } from '../packages/web/src/lib/tool-presentation';

export const DENOMINATOR = 'logical-tool-cards-v1';
export const THRESHOLD_PERCENT = 2;
export const RECORD_SCHEMA_VERSION = 1;
/** Release rejects records older than this many days. */
export const MAX_RECORD_AGE_DAYS = 90;
/** Tolerance for a record timestamped slightly in the future (clock skew). */
export const MAX_FUTURE_SKEW_MS = 10 * 60 * 1000;
/** Keyset page size in tool rows. */
export const PAGE_SIZE = 500;
/** Fail-closed bound on tool rows inside a single (run, node) group. */
export const MAX_NODE_TOOL_ROWS = 10_000;
/** Aggregated generic sent names recorded under --include-generic-names. */
export const MAX_GENERIC_NAMES = 25;
/** Per-name bound, matching MAX_ALIAS_NAME_CODE_UNITS in tool-presentation. */
export const MAX_GENERIC_NAME_CODE_UNITS = 128;
/** Malformed-row identities listed before the audit aborts. */
export const MAX_MALFORMED_REPORTED = 10;

export const AUDIT_SOURCE_FILES = [
  'packages/web/src/lib/tool-presentation.ts',
  'packages/web/src/lib/tool-output.ts',
  'packages/web/src/lib/pair-tool-transcript.ts',
] as const;

export const EXIT_POLICY = 1;
export const EXIT_USAGE = 2;
export const EXIT_DATA = 3;

/** The record/check path says "stop the release"; run/data faults are not that. */
export class AuditPolicyError extends Error {}
/** Bad or incomplete invocation: flags, mutual exclusions, unset env var. */
export class AuditUsageError extends Error {}
/** The corpus could not be measured: access, malformed rows, empty corpus. */
export class AuditDataError extends Error {}

/** Inert stand-in for a stored output key: defined, never the real content. */
const OUTPUT_PRESENT: unknown = Symbol('audit-generic-fallback.output-present');

export type AuditDialect = 'sqlite' | 'postgresql';

/** One projected tool row exactly as the dialect query returns it. */
export interface ProjectedRow {
  id: unknown;
  workflow_run_id: unknown;
  node_id: unknown;
  seq: unknown;
  tool_use_id: unknown;
  name: unknown;
  input_json: unknown;
  output_present: unknown;
  tool_phase: unknown;
  occurrence_id: unknown;
  attempt_id: unknown;
}

/** Row identity safe to print — column fields only, never payload contents. */
interface RowIdentity {
  id: string;
  workflowRunId: string;
  nodeId: string;
  seq: string;
}

type IdentityFields = Pick<ProjectedRow, 'id' | 'workflow_run_id' | 'node_id' | 'seq'>;

function safeIdentity(row: IdentityFields): RowIdentity {
  return {
    id: typeof row.id === 'string' && row.id.length > 0 ? row.id : '?',
    workflowRunId:
      typeof row.workflow_run_id === 'string' && row.workflow_run_id.length > 0
        ? row.workflow_run_id
        : '?',
    nodeId: typeof row.node_id === 'string' && row.node_id.length > 0 ? row.node_id : '?',
    seq: typeof row.seq === 'number' && Number.isFinite(row.seq) ? String(row.seq) : '?',
  };
}

function identityText(identity: RowIdentity): string {
  return `row id=${identity.id} run=${identity.workflowRunId} node=${identity.nodeId} seq=${identity.seq}`;
}

export class MalformedRowError extends AuditDataError {
  constructor(identity: RowIdentity, field: string) {
    super(`malformed tool row (${identityText(identity)}): ${field}`);
    this.name = 'MalformedRowError';
  }
}

function requireNonEmptyString(row: IdentityFields, value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new MalformedRowError(safeIdentity(row), `${field} is not a non-empty string`);
  }
  return value;
}

function optionalString(row: IdentityFields, value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new MalformedRowError(safeIdentity(row), `${field} is not a string`);
  }
  return value;
}

/**
 * Validate one projected row into the minimal PairableMessage the UI contract
 * requires. Output content is never present — only its presence bit.
 */
export function toPairableMessage(row: ProjectedRow): PairableMessage {
  const identity = safeIdentity(row);
  const id = requireNonEmptyString(row, row.id, 'id');
  requireNonEmptyString(row, row.workflow_run_id, 'workflow_run_id');
  requireNonEmptyString(row, row.node_id, 'node_id');
  if (typeof row.seq !== 'number' || !Number.isInteger(row.seq) || row.seq < 1) {
    throw new MalformedRowError(identity, 'seq is not a positive integer');
  }
  const toolUseId = requireNonEmptyString(row, row.tool_use_id, 'payload.id');
  const name = requireNonEmptyString(row, row.name, 'payload.name');

  let input: unknown;
  let inputPresent = false;
  if (row.input_json !== null && row.input_json !== undefined) {
    if (typeof row.input_json !== 'string') {
      throw new MalformedRowError(identity, 'payload.input projection is not JSON text');
    }
    try {
      input = JSON.parse(row.input_json) as unknown;
    } catch {
      throw new MalformedRowError(identity, 'payload.input is not parseable JSON');
    }
    inputPresent = true;
  }

  let toolPhase: 'call' | 'result' | null = null;
  if (row.tool_phase !== null && row.tool_phase !== undefined) {
    if (row.tool_phase !== 'call' && row.tool_phase !== 'result') {
      throw new MalformedRowError(identity, 'metadata.tool_phase is not call|result');
    }
    toolPhase = row.tool_phase;
  }
  const occurrenceId = optionalString(row, row.occurrence_id, 'metadata.execution.occurrence_id');
  const attemptId = optionalString(row, row.attempt_id, 'metadata.execution.attempt_id');

  const payload: { name: string; id: string; input?: unknown; output?: unknown } = {
    name,
    id: toolUseId,
  };
  if (inputPresent) payload.input = input;
  if (row.output_present === true || row.output_present === 1) {
    payload.output = OUTPUT_PRESENT;
  }

  let metadata: PairableToolMetadata | null = null;
  if (toolPhase !== null || occurrenceId !== null || attemptId !== null) {
    metadata = {};
    if (toolPhase !== null) metadata.tool_phase = toolPhase;
    if (occurrenceId !== null || attemptId !== null) {
      metadata.execution = {};
      if (occurrenceId !== null) metadata.execution.occurrence_id = occurrenceId;
      if (attemptId !== null) metadata.execution.attempt_id = attemptId;
    }
  }

  return {
    id,
    seq: row.seq,
    kind: 'tool',
    payload,
    metadata,
  };
}

export interface AuditTally {
  logicalCards: number;
  genericCards: number;
  toolRows: number;
  nodeGroups: number;
  genericNames: { name: string; cards: number }[] | null;
}

export interface TallyOptions {
  /** Aggregate generic sent names for the record — only single-token bounded names. */
  includeGenericNames?: boolean;
  /** Fail-closed bound on tool rows in one (run, node) group. */
  maxNodeToolRows?: number;
}

/**
 * A sent name earns a place in the record only when it is one bounded
 * whitespace-free token — the same rule that earns the chip. A name carrying
 * whitespace is a command line (Codex), not an identifier, and may embed
 * arguments or paths; it is counted in genericCards but never recorded by name.
 */
function isAggregatableName(name: string): boolean {
  if (name.length === 0 || name.length > MAX_GENERIC_NAME_CODE_UNITS) return false;
  return !/\s/.test(name);
}

interface GroupKey {
  runId: string;
  nodeId: string;
}

/**
 * Streaming accumulator: consume projected tool rows ordered by
 * (workflow_run_id, node_id, seq, id), pair each (run, node) group through
 * projectToolTranscript() once complete, and classify every projected tool
 * card with output omitted — output cannot reclassify family, so the audit
 * never pays normalization cost. One card per invocation is the denominator.
 * Memory is bounded by the current group plus aggregates.
 */
export class ToolCardTally {
  private logicalCards = 0;
  private genericCards = 0;
  private toolRows = 0;
  private nodeGroups = 0;
  private readonly names: Map<string, number> | null;
  private readonly maxNodeToolRows: number;
  private currentKey: GroupKey | null = null;
  private group: PairableMessage[] = [];
  private readonly completedGroups = new Set<string>();

  constructor(options?: TallyOptions) {
    this.names = options?.includeGenericNames === true ? new Map<string, number>() : null;
    this.maxNodeToolRows = options?.maxNodeToolRows ?? MAX_NODE_TOOL_ROWS;
  }

  push(row: ProjectedRow): void {
    const runId = requireNonEmptyString(row, row.workflow_run_id, 'workflow_run_id');
    const nodeId = requireNonEmptyString(row, row.node_id, 'node_id');
    const message = toPairableMessage(row);
    const key = `${runId}\n${nodeId}`;
    if (this.currentKey === null || key !== `${this.currentKey.runId}\n${this.currentKey.nodeId}`) {
      if (this.completedGroups.has(key)) {
        throw new AuditDataError(
          `tool rows for ${identityText(safeIdentity(row))} arrived out of order — ` +
            'the keyset page stream must stay ordered by (workflow_run_id, node_id, seq)'
        );
      }
      this.flush();
      this.currentKey = { runId, nodeId };
    }
    if (this.group.length >= this.maxNodeToolRows) {
      throw new AuditDataError(
        `node group exceeds the tool-row ceiling of ${String(this.maxNodeToolRows)} ` +
          `(${identityText(safeIdentity(row))}) — inspect this node's transcript before rerunning`
      );
    }
    this.group.push(message);
    this.toolRows++;
  }

  private flush(): void {
    if (this.group.length === 0) return;
    this.nodeGroups++;
    for (const item of projectToolTranscript(this.group)) {
      if (item.kind !== 'tool-card') continue;
      this.logicalCards++;
      const family = toolPresentation({
        name: item.name,
        input: item.input,
        output: undefined,
      }).family;
      if (family !== 'generic') continue;
      this.genericCards++;
      if (this.names !== null && isAggregatableName(item.name)) {
        this.names.set(item.name, (this.names.get(item.name) ?? 0) + 1);
      }
    }
    if (this.currentKey !== null) {
      this.completedGroups.add(`${this.currentKey.runId}\n${this.currentKey.nodeId}`);
    }
    this.group = [];
  }

  result(): AuditTally {
    this.flush();
    const genericNames =
      this.names === null
        ? null
        : [...this.names.entries()]
            .map(([name, cards]) => ({ name, cards }))
            .sort((a, b) => b.cards - a.cards || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
            .slice(0, MAX_GENERIC_NAMES);
    return {
      logicalCards: this.logicalCards,
      genericCards: this.genericCards,
      toolRows: this.toolRows,
      nodeGroups: this.nodeGroups,
      genericNames,
    };
  }
}

/** Convenience wrapper used by tests and any caller holding a materialized stream. */
export function tallyProjectedRows(
  rows: Iterable<ProjectedRow>,
  options?: TallyOptions
): AuditTally {
  const tally = new ToolCardTally(options);
  for (const row of rows) tally.push(row);
  return tally.result();
}

/** Integer threshold: exactly 2% fails — no float ambiguity. */
export function fractionExceeded(genericCards: number, logicalCards: number): boolean {
  return genericCards * 100 >= logicalCards * THRESHOLD_PERCENT;
}

export interface AuditRecord {
  schemaVersion: typeof RECORD_SCHEMA_VERSION;
  generatedAt: string;
  /** Non-secret corpus identity supplied by the operator via --source. */
  source: string;
  dialect: AuditDialect;
  denominator: typeof DENOMINATOR;
  auditSourceSha256: string;
  logicalCards: number;
  genericCards: number;
  /** Informational only — the checker recomputes and rejects disagreement. */
  fraction: number;
  genericNames?: { name: string; cards: number }[];
}

export function computeAuditSourceSha256(repoRoot: string): string {
  const hash = createHash('sha256');
  for (const file of AUDIT_SOURCE_FILES) {
    hash.update(file);
    hash.update('\n');
    hash.update(readFileSync(resolve(repoRoot, file)));
    hash.update('\n');
  }
  return hash.digest('hex');
}

interface Cursor {
  workflowRunId: string;
  nodeId: string;
  seq: number;
  id: string;
}

const SQLITE_PRE_SCAN_SQL = `SELECT id, workflow_run_id, node_id, seq
  FROM remote_agent_workflow_node_messages
  WHERE kind = 'tool'
    AND (json_valid(payload) = 0 OR (metadata IS NOT NULL AND json_valid(metadata) = 0))
  LIMIT ${String(MAX_MALFORMED_REPORTED + 1)}`;

/**
 * `->` returns JSON text for composite input but the raw SQLite value for
 * scalars; the CASE re-wraps scalars so input_json is always JSON text (or
 * NULL when the input key is absent — JSON null stays distinguishable).
 */
const SQLITE_PAGE_SELECT = `SELECT id, workflow_run_id, node_id, seq,
    CASE WHEN json_type(payload, '$.id') = 'text' THEN payload ->> '$.id' END AS tool_use_id,
    CASE WHEN json_type(payload, '$.name') = 'text' THEN payload ->> '$.name' END AS name,
    CASE json_type(payload, '$.input')
      WHEN 'object' THEN payload -> '$.input'
      WHEN 'array' THEN payload -> '$.input'
      WHEN 'text' THEN json_quote(payload ->> '$.input')
      WHEN 'integer' THEN CAST(payload ->> '$.input' AS TEXT)
      WHEN 'real' THEN CAST(payload ->> '$.input' AS TEXT)
      WHEN 'true' THEN 'true'
      WHEN 'false' THEN 'false'
      WHEN 'null' THEN 'null'
    END AS input_json,
    (json_type(payload, '$.output') IS NOT NULL) AS output_present,
    metadata ->> '$.tool_phase' AS tool_phase,
    metadata ->> '$.execution.occurrence_id' AS occurrence_id,
    metadata ->> '$.execution.attempt_id' AS attempt_id
  FROM remote_agent_workflow_node_messages`;

const SQLITE_PAGE_ORDER = 'ORDER BY workflow_run_id, node_id, seq, id LIMIT ?';

/**
 * `(payload -> 'input')::text` renders every jsonb input — scalars included —
 * as JSON text; a missing key yields SQL NULL. jsonb `->`/`->>` return NULL on
 * non-object shapes rather than erroring, so the guards keep non-object
 * payloads flowing to validation as malformed instead of aborting the query.
 */
const PG_PAGE_SELECT = `SELECT id::text AS id, workflow_run_id::text AS workflow_run_id, node_id, seq,
    CASE WHEN jsonb_typeof(payload) = 'object' AND jsonb_typeof(payload -> 'id') = 'string'
      THEN payload ->> 'id' END AS tool_use_id,
    CASE WHEN jsonb_typeof(payload) = 'object' AND jsonb_typeof(payload -> 'name') = 'string'
      THEN payload ->> 'name' END AS name,
    CASE WHEN jsonb_typeof(payload) = 'object' THEN (payload -> 'input')::text END AS input_json,
    (jsonb_typeof(payload) = 'object' AND jsonb_exists(payload, 'output')) AS output_present,
    CASE WHEN jsonb_typeof(metadata) = 'object' THEN metadata ->> 'tool_phase' END AS tool_phase,
    CASE WHEN jsonb_typeof(metadata) = 'object'
      THEN metadata -> 'execution' ->> 'occurrence_id' END AS occurrence_id,
    CASE WHEN jsonb_typeof(metadata) = 'object'
      THEN metadata -> 'execution' ->> 'attempt_id' END AS attempt_id
  FROM remote_agent_workflow_node_messages`;

const PG_PAGE_ORDER = 'ORDER BY workflow_run_id, node_id, seq, id';

const PG_KEYSET = 'AND (workflow_run_id, node_id, seq, id) > ($1::uuid, $2, $3, $4::uuid)';

export interface AuditRunOptions {
  sourceId?: string;
  includeGenericNames?: boolean;
  pageSize?: number;
  maxNodeToolRows?: number;
  now?: Date;
  /** Defaults to the repository root (parent of this script's directory). */
  repoRoot?: string;
}

function buildRecord(
  tally: AuditTally,
  dialect: AuditDialect,
  options?: AuditRunOptions
): AuditRecord {
  if (tally.logicalCards === 0) {
    throw new AuditDataError(
      'corpus produced zero logical tool cards — refusing to report a vacuous measurement'
    );
  }
  const now = options?.now ?? new Date();
  const repoRoot = options?.repoRoot ?? resolve(import.meta.dir, '..');
  const record: AuditRecord = {
    schemaVersion: RECORD_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    source: options?.sourceId ?? 'unspecified',
    dialect,
    denominator: DENOMINATOR,
    auditSourceSha256: computeAuditSourceSha256(repoRoot),
    logicalCards: tally.logicalCards,
    genericCards: tally.genericCards,
    fraction: tally.genericCards / tally.logicalCards,
  };
  if (tally.genericNames !== null) record.genericNames = tally.genericNames;
  return record;
}

function sqlitePageSql(cursor: Cursor | null): { sql: string; params: (string | number)[] } {
  const where =
    cursor === null
      ? "WHERE kind = 'tool'"
      : "WHERE kind = 'tool' AND (workflow_run_id, node_id, seq, id) > (?, ?, ?, ?)";
  const params =
    cursor === null ? [] : [cursor.workflowRunId, cursor.nodeId, cursor.seq, cursor.id];
  return { sql: `${SQLITE_PAGE_SELECT} ${where} ${SQLITE_PAGE_ORDER}`, params };
}

function assertNoMalformedSqliteRows(db: Database): void {
  const bad = db.query<IdentityFields, []>(SQLITE_PRE_SCAN_SQL).all();
  if (bad.length === 0) return;
  const listed = bad
    .slice(0, MAX_MALFORMED_REPORTED)
    .map(row => identityText(safeIdentity(row)))
    .join('\n  ');
  const extra =
    bad.length > MAX_MALFORMED_REPORTED
      ? `\n  ...and more (list capped at ${String(MAX_MALFORMED_REPORTED)})`
      : '';
  throw new AuditDataError(
    `malformed tool row(s): stored JSON is not parseable\n  ${listed}${extra}`
  );
}

function cursorFrom(page: ProjectedRow[]): Cursor | null {
  const last = page[page.length - 1];
  if (last === undefined) return null;
  return {
    workflowRunId: String(last.workflow_run_id),
    nodeId: String(last.node_id),
    seq: Number(last.seq),
    id: String(last.id),
  };
}

/**
 * SQLite corpus: true readonly handle plus query_only, one deferred
 * transaction for a consistent snapshot, keyset-paged projection.
 */
export function auditSqlite(dbPath: string, options?: AuditRunOptions): AuditRecord {
  const pageSize = options?.pageSize ?? PAGE_SIZE;
  let db: Database;
  try {
    db = new Database(dbPath, { readonly: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const walHint = /unable to open|cannot open/i.test(detail)
      ? ' — if this is a cleanly checkpointed WAL database there is no -shm for a ' +
        'read-only handle to attach to; run while the install is up or audit a checkpointed copy'
      : '';
    throw new AuditDataError(`cannot open the SQLite corpus read-only: ${detail}${walHint}`);
  }
  try {
    db.exec('PRAGMA query_only = ON');
    db.exec('BEGIN');
    const tally = new ToolCardTally(options);
    try {
      assertNoMalformedSqliteRows(db);
      let cursor: Cursor | null = null;
      for (;;) {
        const { sql, params } = sqlitePageSql(cursor);
        const page = db.query<ProjectedRow, (string | number)[]>(sql).all(...params, pageSize);
        for (const row of page) tally.push(row);
        if (page.length < pageSize) break;
        const next = cursorFrom(page);
        if (next === null) break;
        cursor = next;
      }
      db.exec('COMMIT');
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // Transaction may already be closed; the read-only handle makes it harmless.
      }
      throw error;
    }
    return buildRecord(tally.result(), 'sqlite', options);
  } finally {
    db.close();
  }
}

interface PgQueryRunner {
  unsafe(query: string, values?: unknown[]): Promise<ProjectedRow[]>;
}

/**
 * PostgreSQL corpus: a direct Bun.sql client (never PostgresAdapter, never the
 * transitive pg dep) inside a REPEATABLE READ + READ ONLY transaction, with
 * the same keyset paging and projection contract as the SQLite path.
 */
export async function auditPostgres(
  connectionUrl: string,
  options?: AuditRunOptions
): Promise<AuditRecord> {
  const pageSize = options?.pageSize ?? PAGE_SIZE;
  const sql = new SQL(connectionUrl);
  try {
    return await sql.begin(async tx => {
      const runner = tx as unknown as PgQueryRunner;
      await runner.unsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      const tally = new ToolCardTally(options);
      let cursor: Cursor | null = null;
      for (;;) {
        const where = cursor === null ? "WHERE kind = 'tool'" : `WHERE kind = 'tool' ${PG_KEYSET}`;
        const params: unknown[] =
          cursor === null ? [] : [cursor.workflowRunId, cursor.nodeId, cursor.seq, cursor.id];
        params.push(pageSize);
        const page = await runner.unsafe(
          `${PG_PAGE_SELECT} ${where} ${PG_PAGE_ORDER} LIMIT $${String(params.length)}`,
          params
        );
        for (const row of page) tally.push(row);
        if (page.length < pageSize) break;
        const next = cursorFrom(page);
        if (next === null) break;
        cursor = next;
      }
      return buildRecord(tally.result(), 'postgresql', options);
    });
  } catch (error) {
    if (error instanceof AuditDataError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new AuditDataError(`cannot complete the PostgreSQL audit: ${detail}`);
  } finally {
    await sql.close().catch(() => undefined);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function failCheck(reason: string): never {
  throw new AuditPolicyError(
    `${reason} — refresh the record with ` +
      '`bun run scripts/audit-generic-fallback.ts --sqlite <corpus> --source <id> --record <path>` ' +
      'or the equivalent --postgres-env invocation'
  );
}

function requireRecordField<T>(
  record: Record<string, unknown>,
  field: string,
  check: (value: unknown) => T | null
): T {
  const result = check(record[field]);
  if (result === null) failCheck(`record field ${field} is missing or malformed`);
  return result;
}

const isNonEmptyString = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 ? v : null;

const isSafeInt = (v: unknown): number | null =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;

/**
 * Validate a release record: schema, freshness, source hash, nonzero
 * denominator, recomputed fraction, then the 2% threshold. --check never
 * opens a database; every failure is a policy failure (exit 1) because it
 * means the release cannot prove the corpus is under the gate.
 */
export function checkRecord(
  recordPath: string,
  options?: { now?: Date; repoRoot?: string }
): AuditRecord {
  let raw: string;
  try {
    raw = readFileSync(recordPath, 'utf8');
  } catch {
    failCheck('audit record is missing or unreadable');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    failCheck('audit record is not valid JSON');
  }
  if (!isRecord(parsed)) failCheck('audit record is not a JSON object');

  requireRecordField(parsed, 'schemaVersion', v =>
    v === RECORD_SCHEMA_VERSION ? RECORD_SCHEMA_VERSION : null
  );
  requireRecordField(parsed, 'denominator', v => (v === DENOMINATOR ? DENOMINATOR : null));
  const source = requireRecordField(parsed, 'source', isNonEmptyString);
  const dialect = requireRecordField(parsed, 'dialect', v =>
    v === 'sqlite' || v === 'postgresql' ? v : null
  );
  const auditSourceSha256 = requireRecordField(parsed, 'auditSourceSha256', isNonEmptyString);
  const generatedAt = requireRecordField(parsed, 'generatedAt', isNonEmptyString);
  const logicalCards = requireRecordField(parsed, 'logicalCards', isSafeInt);
  const genericCards = requireRecordField(parsed, 'genericCards', isSafeInt);
  const fraction = requireRecordField(parsed, 'fraction', v =>
    typeof v === 'number' && Number.isFinite(v) ? v : null
  );

  const repoRoot = options?.repoRoot ?? resolve(import.meta.dir, '..');
  const expectedHash = computeAuditSourceSha256(repoRoot);
  if (auditSourceSha256 !== expectedHash) {
    failCheck(
      'audit record was generated against different classification/pairing sources ' +
        '(auditSourceSha256 mismatch) — rerun the audit so the record reflects the shipped code'
    );
  }

  const generatedMs = Date.parse(generatedAt);
  if (Number.isNaN(generatedMs)) failCheck('record generatedAt is not a parseable timestamp');
  const now = options?.now ?? new Date();
  const ageMs = now.getTime() - generatedMs;
  if (ageMs < -MAX_FUTURE_SKEW_MS) failCheck('record generatedAt is in the future');
  if (ageMs > MAX_RECORD_AGE_DAYS * 24 * 60 * 60 * 1000) {
    failCheck(
      `record is ${String(Math.floor(ageMs / (24 * 60 * 60 * 1000)))} days old ` +
        `(max ${String(MAX_RECORD_AGE_DAYS)})`
    );
  }

  if (logicalCards === 0) {
    failCheck('record reports zero logical tool cards — an empty corpus cannot prove the gate');
  }
  if (genericCards > logicalCards) {
    failCheck('record genericCards exceeds logicalCards — malformed');
  }
  const expectedFraction = genericCards / logicalCards;
  if (fraction !== expectedFraction) {
    failCheck('record fraction disagrees with genericCards/logicalCards — malformed');
  }

  if (parsed.genericNames !== undefined) {
    if (
      !Array.isArray(parsed.genericNames) ||
      !parsed.genericNames.every(
        entry =>
          isRecord(entry) &&
          isNonEmptyString(entry.name) !== null &&
          isSafeInt(entry.cards) !== null &&
          (entry.cards as number) > 0
      )
    ) {
      failCheck('record genericNames is malformed');
    }
  }

  if (fractionExceeded(genericCards, logicalCards)) {
    const pct = ((genericCards / logicalCards) * 100).toFixed(2);
    failCheck(
      `generic-fallback fraction ${pct}% is not below ${String(THRESHOLD_PERCENT)}% ` +
        `(${String(genericCards)}/${String(logicalCards)} logical cards) — release gate failed`
    );
  }

  const record: AuditRecord = {
    schemaVersion: RECORD_SCHEMA_VERSION,
    generatedAt,
    source,
    dialect,
    denominator: DENOMINATOR,
    auditSourceSha256,
    logicalCards,
    genericCards,
    fraction,
  };
  if (parsed.genericNames !== undefined) {
    record.genericNames = parsed.genericNames as { name: string; cards: number }[];
  }
  return record;
}

export function writeRecordAtomic(recordPath: string, record: AuditRecord): void {
  const tmp = `${recordPath}.${String(process.pid)}.${String(Date.now())}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  renameSync(tmp, recordPath);
}

interface CliArgs {
  sqlitePath?: string;
  postgresEnv?: string;
  recordPath?: string;
  sourceId?: string;
  checkPath?: string;
  includeGenericNames: boolean;
  help: boolean;
}

const USAGE = `Usage:
  bun run scripts/audit-generic-fallback.ts --sqlite <db-path> --source <id> [--record <path>] [--include-generic-names]
  bun run scripts/audit-generic-fallback.ts --postgres-env <VAR> --source <id> [--record <path>] [--include-generic-names]
  bun run scripts/audit-generic-fallback.ts --check <record-path>

Options:
  --sqlite <path>            SQLite corpus path (explicit; never ~/.archon by default)
  --postgres-env <VAR>       env var NAME holding the PostgreSQL connection URL
  --source <id>              non-secret corpus identity stored in the record (required with --record)
  --record <path>            write the audit record atomically to <path>
  --check <path>             validate a previously written record; never touches a database
  --include-generic-names    record deterministic generic tool-name aggregates
  --help                     show this help
`;

function takeValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new AuditUsageError(`${flag} requires a value`);
  }
  return value;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { includeGenericNames: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--sqlite':
        args.sqlitePath = takeValue(argv, i, arg);
        i++;
        break;
      case '--postgres-env':
        args.postgresEnv = takeValue(argv, i, arg);
        i++;
        break;
      case '--record':
        args.recordPath = takeValue(argv, i, arg);
        i++;
        break;
      case '--source':
        args.sourceId = takeValue(argv, i, arg);
        i++;
        break;
      case '--check':
        args.checkPath = takeValue(argv, i, arg);
        i++;
        break;
      case '--include-generic-names':
        args.includeGenericNames = true;
        break;
      default:
        throw new AuditUsageError(`unknown argument: ${arg}`);
    }
  }
  return args;
}

export async function main(argv: string[]): Promise<number> {
  try {
    const args = parseArgs(argv);
    if (args.help) {
      process.stdout.write(USAGE);
      return 0;
    }
    if (args.checkPath !== undefined) {
      if (
        args.sqlitePath !== undefined ||
        args.postgresEnv !== undefined ||
        args.recordPath !== undefined ||
        args.sourceId !== undefined ||
        args.includeGenericNames
      ) {
        throw new AuditUsageError('--check does not combine with audit or record flags');
      }
      const record = checkRecord(args.checkPath);
      const pct = (record.fraction * 100).toFixed(2);
      process.stdout.write(
        `audit record OK: ${String(record.genericCards)}/${String(record.logicalCards)} ` +
          `generic cards (${pct}% < ${String(THRESHOLD_PERCENT)}%), dialect=${record.dialect}, ` +
          `generated=${record.generatedAt}\n`
      );
      return 0;
    }
    if (args.sqlitePath !== undefined && args.postgresEnv !== undefined) {
      throw new AuditUsageError('pass exactly one corpus: --sqlite or --postgres-env');
    }
    if (args.sqlitePath === undefined && args.postgresEnv === undefined) {
      throw new AuditUsageError(
        'no corpus specified — pass --sqlite <path> or --postgres-env <VAR>; ' +
          'there is no implicit ~/.archon or DATABASE_URL target'
      );
    }
    if (args.recordPath !== undefined && args.sourceId === undefined) {
      throw new AuditUsageError('--record requires --source <id> (a non-secret corpus identity)');
    }
    const options: AuditRunOptions = { includeGenericNames: args.includeGenericNames };
    if (args.sourceId !== undefined) options.sourceId = args.sourceId;
    let record: AuditRecord;
    if (args.sqlitePath !== undefined) {
      record = auditSqlite(args.sqlitePath, options);
    } else if (args.postgresEnv !== undefined) {
      const url = process.env[args.postgresEnv];
      if (url === undefined || url.length === 0) {
        throw new AuditUsageError(
          `environment variable ${args.postgresEnv} is not set — it must hold the PostgreSQL ` +
            'connection URL so credentials stay off the command line'
        );
      }
      record = await auditPostgres(url, options);
    } else {
      throw new AuditUsageError('no corpus specified');
    }
    if (args.recordPath !== undefined) writeRecordAtomic(args.recordPath, record);
    process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
    if (fractionExceeded(record.genericCards, record.logicalCards)) {
      const pct = (record.fraction * 100).toFixed(2);
      process.stderr.write(
        `generic-fallback fraction ${pct}% is not below ${String(THRESHOLD_PERCENT)}% — ` +
          'release gate would fail\n'
      );
      return EXIT_POLICY;
    }
    return 0;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (error instanceof AuditUsageError) {
      process.stderr.write(`error: ${detail}\n\n${USAGE}`);
      return EXIT_USAGE;
    }
    if (error instanceof AuditPolicyError) {
      process.stderr.write(`release check failed: ${detail}\n`);
      return EXIT_POLICY;
    }
    process.stderr.write(`error: ${detail}\n`);
    return EXIT_DATA;
  }
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
