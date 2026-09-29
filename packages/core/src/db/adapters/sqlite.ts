/**
 * SQLite adapter using bun:sqlite
 */
import { Database, type SQLQueryBindings } from 'bun:sqlite';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { IDatabase, QueryResult, SqlDialect } from './types';
import { createLogger } from '@archon/paths';
import { APP_VERSION } from '../schema-version';

/** Lazy-initialized logger (deferred so test mocks can intercept createLogger) */
let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('db.sqlite');
  return cachedLog;
}

export class SqliteAdapter implements IDatabase {
  private db: Database;
  readonly dialect = 'sqlite' as const;
  readonly sql: SqlDialect = sqliteDialect;
  /**
   * Tail of the exclusive single-connection queue. bun:sqlite is one connection, so
   * overlapping BEGIN blocks would throw "cannot start a transaction within a
   * transaction." Transactions and public queries that must wait out an open
   * transaction chain onto this tail. A second transaction waits for the first to
   * COMMIT, then sees committed state — exactly what approval-gate CAS needs so a
   * concurrent second resolver cleanly loses (rowCount 0) instead of erroring.
   */
  private txTail: Promise<unknown> = Promise.resolve();
  /** True while an adapter-owned BEGIN…COMMIT/ROLLBACK is open on this connection. */
  private txOpen = false;

  constructor(dbPath: string) {
    // Ensure directory exists
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);

    // Install the lock wait before journal_mode: switching to WAL itself takes
    // a database lock, and concurrent CLI processes must not fail immediately
    // during adapter construction before the timeout exists.
    this.db.run('PRAGMA busy_timeout = 5000');

    // Enable WAL mode for better concurrent performance
    this.db.run('PRAGMA journal_mode = WAL');

    // Enable foreign keys
    this.db.run('PRAGMA foreign_keys = ON');

    // Initialize schema if needed
    this.initSchema();
  }

  async query<T>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
    // Public path never owns transaction control — withTransaction/withSnapshotRead do.
    const control = sql.trim().toUpperCase();
    if (
      control === 'BEGIN' ||
      control.startsWith('BEGIN ') ||
      control === 'COMMIT' ||
      control === 'ROLLBACK'
    ) {
      throw new Error(
        'SQLite adapter rejects public transaction-control statements. ' +
          'Use withTransaction() or withSnapshotRead() so the adapter owns BEGIN/COMMIT/ROLLBACK.'
      );
    }
    // An open adapter transaction must not absorb unrelated async work on this
    // connection. Queue the public query until after COMMIT/ROLLBACK.
    if (this.txOpen) {
      return this.enqueueExclusive(() => this.executeQuery<T>(sql, params));
    }
    return this.executeQuery<T>(sql, params);
  }

  async withTransaction<T>(
    fn: (query: <U>(sql: string, params?: unknown[]) => Promise<QueryResult<U>>) => Promise<T>
  ): Promise<T> {
    return this.withSerializedTransaction(fn);
  }

  /**
   * Snapshot-isolated multi-statement reads. bun:sqlite deferred BEGIN freezes
   * the database view at the first read for the life of the transaction, so
   * concurrent writers (other connections / WAL) cannot tear totals vs groups
   * vs coverage. Serialized on `txTail` with write transactions.
   */
  async withSnapshotRead<T>(
    fn: (query: <U>(sql: string, params?: unknown[]) => Promise<QueryResult<U>>) => Promise<T>
  ): Promise<T> {
    return this.withSerializedTransaction(fn);
  }

  /**
   * Chain work onto the exclusive queue. Failures are swallowed on the stored
   * tail so one rejection never blocks later work.
   */
  private enqueueExclusive<T>(run: () => Promise<T>): Promise<T> {
    const result = this.txTail.then(run, run);
    this.txTail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private withSerializedTransaction<T>(
    fn: (query: <U>(sql: string, params?: unknown[]) => Promise<QueryResult<U>>) => Promise<T>
  ): Promise<T> {
    const run = async (): Promise<T> => {
      // BEGIN/COMMIT/ROLLBACK go through executeQuery only — never public query() —
      // so they cannot deadlock on txOpen serialization or be issued by callers.
      await this.executeQuery('BEGIN');
      this.txOpen = true;
      try {
        // Transaction-scoped query path: runs immediately inside the open
        // transaction. Public adapter.query() from other async flows cannot
        // enter this scope (serialized outside via txOpen + txTail).
        const txQuery = <U>(sql: string, params?: unknown[]): Promise<QueryResult<U>> =>
          this.executeQuery<U>(sql, params);
        const result = await fn(txQuery);
        await this.executeQuery('COMMIT');
        return result;
      } catch (e) {
        try {
          await this.executeQuery('ROLLBACK');
        } catch (rollbackError) {
          getLog().error({ err: rollbackError as Error }, 'db.sqlite_transaction_rollback_failed');
        }
        throw e;
      } finally {
        this.txOpen = false;
      }
    };
    return this.enqueueExclusive(run);
  }

  /**
   * Execute one statement on the underlying connection with no queue/tx gating.
   * Callers must already hold exclusive access (no open foreign work, or the
   * active transaction callback).
   */
  private async executeQuery<T>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
    // Convert $1, $2, etc. to ? placeholders and reorder params to match
    const { sql: convertedSql, params: reorderedParams } = this.convertPlaceholders(
      sql,
      params ?? []
    );

    try {
      // Determine if this is a SELECT or mutation
      const trimmedSql = sql.trim().toUpperCase();
      const isSelect = trimmedSql.startsWith('SELECT') || trimmedSql.startsWith('WITH');

      // Cast params to SQLite's expected type
      const sqliteParams = reorderedParams as SQLQueryBindings[];

      if (isSelect) {
        const rows = this.queryRows<T>(convertedSql, sqliteParams);
        return { rows, rowCount: rows.length };
      } else {
        const upperSql = sql.toUpperCase();

        // Handle INSERT with RETURNING using native SQLite RETURNING (3.35+)
        // We must use .all() instead of .run() because .run() discards
        // RETURNING results, and its lastInsertRowid is unreliable when
        // ON CONFLICT DO UPDATE fires.
        if (upperSql.includes('RETURNING') && upperSql.includes('INSERT')) {
          const rows = this.queryRows<T>(convertedSql, sqliteParams);
          return { rows, rowCount: rows.length };
        }

        // UPDATE/DELETE with RETURNING not supported
        if (upperSql.includes('RETURNING')) {
          throw new Error(
            'SQLite adapter does not support RETURNING clause on UPDATE/DELETE statements. ' +
              `Query: ${convertedSql.substring(0, 100)}... ` +
              'Hint: Use a SELECT before the mutation if you need the row data.'
          );
        }

        // Standard INSERT/UPDATE/DELETE without RETURNING
        const stmt = this.db.prepare(convertedSql);
        try {
          const result = stmt.run(...sqliteParams);
          return { rows: [], rowCount: result.changes };
        } finally {
          stmt.finalize();
        }
      }
    } catch (error) {
      const err = error as Error;
      // Query parameters can contain credentials (for example provider-binding
      // receiver headers). Record shape only; never persist parameter values.
      getLog().error(
        { err, sql: convertedSql, paramCount: params?.length ?? 0 },
        'db.sqlite_query_failed'
      );
      throw error;
    }
  }

  async close(): Promise<void> {
    this.db.close(true);
  }

  private queryRows<T>(sql: string, params: SQLQueryBindings[] = []): T[] {
    const stmt = this.db.prepare(sql);
    try {
      return stmt.all(...params) as T[];
    } finally {
      stmt.finalize();
    }
  }

  /**
   * Convert PostgreSQL $1, $2 placeholders to SQLite ? placeholders.
   *
   * PostgreSQL uses explicit indices ($1, $2) so params can appear in any order
   * in SQL. SQLite uses positional ? — so params must be reordered to match the
   * left-to-right order of placeholders in the SQL string.
   *
   * Example: SQL has "$2 ... $1" with params [id, json] →
   *   converted SQL: "? ... ?" with reordered params [json, id]
   */
  private convertPlaceholders(sql: string, params: unknown[]): { sql: string; params: unknown[] } {
    // Collect $N placeholders in order of appearance
    const placeholderOrder: number[] = [];
    const convertedSql = sql
      .replace(/\$(\d+)/g, (_match, indexStr: string) => {
        placeholderOrder.push(Number(indexStr));
        return '?';
      })
      .replace(/::jsonb/g, '')
      .replace(/::INTERVAL/g, '');

    // Reorder params to match the positional order of ? in the SQL.
    // $N is 1-based, so $1 → params[0], $2 → params[1], etc.
    const reordered =
      placeholderOrder.length > 0 ? placeholderOrder.map(idx => params[idx - 1]) : params;

    return { sql: convertedSql, params: reordered };
  }

  /**
   * Initialize database schema.
   * Always runs createSchema() since all statements use IF NOT EXISTS,
   * ensuring new tables from migrations are created in existing databases.
   */
  private initSchema(): void {
    // Probe BEFORE createSchema(): once CREATE TABLE IF NOT EXISTS has run there is
    // no way left to tell a fresh database from one that predates version tracking.
    const preExisting = this.hasAnyArchonTable();
    this.createSchema();
    const allApplied = this.migrateColumns();
    this.recordSchemaVersion(preExisting, allApplied);
  }

  /** True when core Archon tables already exist — i.e. this is not a fresh database. */
  private hasAnyArchonTable(): boolean {
    const row = this.queryRows<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      ['remote_agent_codebases']
    )[0];
    return row !== undefined;
  }

  /**
   * Record which Archon build created this database and which last applied schema
   * to it (#2316). Diagnostic only — nothing gates on these values.
   *
   * Writes only when the value actually changes, so the common case (every CLI
   * invocation is a fresh process opening a fresh connection) stays read-only.
   *
   * Skipped entirely when `allApplied` is false: migrateColumns() suppresses each
   * table's failure so one bad ALTER cannot abort startup, which means the schema
   * may be genuinely incomplete. Stamping this build's version onto that database
   * would turn the vintage into a wrong answer that gets believed — strictly worse
   * than the "not recorded" / stale-version state a reader can act on. The next
   * successful open records it.
   */
  private recordSchemaVersion(preExisting: boolean, allApplied: boolean): void {
    if (!allApplied) {
      getLog().warn(
        { appVersion: APP_VERSION },
        'db.sqlite_schema_version_skipped_incomplete_migration'
      );
      return;
    }
    try {
      const existing = this.queryRows<{ app_version: string }>(
        'SELECT app_version FROM remote_agent_schema_version WHERE id = 1'
      )[0];

      if (!existing) {
        this.db.run(
          'INSERT INTO remote_agent_schema_version (id, created_app_version, app_version) VALUES (1, ?, ?)',
          // NULL, not a guess: a database that predates this table has an unknowable
          // creation vintage, and that unknowability is the fact worth reporting.
          [preExisting ? null : APP_VERSION, APP_VERSION]
        );
      } else if (existing.app_version !== APP_VERSION) {
        this.db.run(
          "UPDATE remote_agent_schema_version SET app_version = ?, applied_at = datetime('now') WHERE id = 1",
          [APP_VERSION]
        );
      }
    } catch (e: unknown) {
      // Deliberate, logged fallback: the vintage row is diagnostic metadata and must
      // never be able to stop the database from opening (e.g. a read-only DB file).
      getLog().warn({ err: e as Error }, 'db.sqlite_schema_version_record_failed');
    }
  }

  /**
   * Add columns to existing tables that predate newer schema additions.
   * SQLite's CREATE TABLE IF NOT EXISTS skips entirely for existing tables,
   * so new columns must be added via ALTER TABLE for databases created before
   * the columns were added to createSchema().
   */
  private migrateColumns(): boolean {
    // Each block below suppresses its own failure so one bad table cannot abort
    // schema init. This flag carries that outcome to recordSchemaVersion(): a
    // database missing a failed migration must NOT be stamped as fully applied
    // by this build, or the vintage becomes a wrong answer that gets believed.
    let allApplied = true;
    // Users columns. `role` is the web-auth identity seam (default 'admin').
    // Better Auth's own tables are PostgreSQL-only — web auth is never enabled
    // on SQLite — so only the role column is backfilled here.
    try {
      const userCols = this.queryRows<{ name: string }>("PRAGMA table_info('remote_agent_users')");
      const userColNames = new Set(userCols.map(c => c.name));
      if (!userColNames.has('role')) {
        this.db.run("ALTER TABLE remote_agent_users ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'");
      }
    } catch (e: unknown) {
      getLog().warn({ err: e as Error }, 'db.sqlite_migration_users_columns_failed');
      allApplied = false;
    }

    // Codebases columns
    try {
      const codebaseCols = this.queryRows<{ name: string }>(
        "PRAGMA table_info('remote_agent_codebases')"
      );
      const codebaseColNames = new Set(codebaseCols.map(c => c.name));

      if (!codebaseColNames.has('default_branch')) {
        this.db.run('ALTER TABLE remote_agent_codebases ADD COLUMN default_branch TEXT');
      }
      if (!codebaseColNames.has('kind')) {
        this.db.run(
          "ALTER TABLE remote_agent_codebases ADD COLUMN kind TEXT NOT NULL DEFAULT 'repo'"
        );
      }
    } catch (e: unknown) {
      getLog().warn({ err: e as Error }, 'db.sqlite_migration_codebases_columns_failed');
      allApplied = false;
    }

    // Conversations columns
    try {
      const cols = this.queryRows<{ name: string }>(
        "PRAGMA table_info('remote_agent_conversations')"
      );
      const colNames = new Set(cols.map(c => c.name));

      if (!colNames.has('title')) {
        this.db.run('ALTER TABLE remote_agent_conversations ADD COLUMN title TEXT');
      }
      if (!colNames.has('deleted_at')) {
        this.db.run('ALTER TABLE remote_agent_conversations ADD COLUMN deleted_at TEXT');
      }
      if (!colNames.has('hidden')) {
        this.db.run('ALTER TABLE remote_agent_conversations ADD COLUMN hidden INTEGER DEFAULT 0');
      }
      if (!colNames.has('user_id')) {
        this.db.run(
          'ALTER TABLE remote_agent_conversations ADD COLUMN user_id TEXT REFERENCES remote_agent_users(id) ON DELETE SET NULL'
        );
      }
      // Indexes must be created here, not in createSchema(): these columns don't
      // exist on older databases until the ALTER TABLE statements above run, and
      // CREATE INDEX on a missing column aborts the entire createSchema()
      // exec block. Idempotent so they're safe to run unconditionally.
      this.db.run(
        'CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON remote_agent_conversations(user_id) WHERE user_id IS NOT NULL'
      );
      this.db.run(
        'CREATE INDEX IF NOT EXISTS idx_conversations_hidden ON remote_agent_conversations(hidden)'
      );
      // idx_conversations_codebase was originally non-partial. Replace it once,
      // not on every open: an unconditional DROP + CREATE rebuilds the index
      // each time the adapter is constructed, and leaves a window where the
      // index is gone if the re-create fails.
      const existingCodebaseIdx = this.queryRows<{ sql: string | null }>(
        "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_conversations_codebase'"
      )[0];
      if (existingCodebaseIdx && !(existingCodebaseIdx.sql ?? '').includes('deleted_at IS NULL')) {
        this.db.run('DROP INDEX idx_conversations_codebase');
      }
      this.db.run(
        'CREATE INDEX IF NOT EXISTS idx_conversations_codebase ON remote_agent_conversations(codebase_id) WHERE deleted_at IS NULL'
      );
    } catch (e: unknown) {
      getLog().warn({ err: e as Error }, 'db.sqlite_migration_conversations_columns_failed');
      allApplied = false;
    }

    // Workflow runs columns
    try {
      const wfCols = this.queryRows<{ name: string }>(
        "PRAGMA table_info('remote_agent_workflow_runs')"
      );
      const wfColNames = new Set(wfCols.map(c => c.name));

      if (!wfColNames.has('parent_conversation_id')) {
        this.db.run(
          'ALTER TABLE remote_agent_workflow_runs ADD COLUMN parent_conversation_id TEXT'
        );
      }

      if (!wfColNames.has('working_path')) {
        this.db.run('ALTER TABLE remote_agent_workflow_runs ADD COLUMN working_path TEXT');
      }

      if (!wfColNames.has('user_id')) {
        this.db.run(
          'ALTER TABLE remote_agent_workflow_runs ADD COLUMN user_id TEXT REFERENCES remote_agent_users(id) ON DELETE SET NULL'
        );
      }
      // Run-tree parent (#2121 Phase 2). Self-referential FK — a `workflow:` sub-run
      // links back to its spawning parent. ON DELETE SET NULL so deleting a parent
      // orphans children rather than cascade-deleting their audit trail.
      if (!wfColNames.has('parent_run_id')) {
        this.db.run(
          'ALTER TABLE remote_agent_workflow_runs ADD COLUMN parent_run_id TEXT REFERENCES remote_agent_workflow_runs(id) ON DELETE SET NULL'
        );
      }
      // Durable output root (#2200). The resolved ~/.archon/workspaces/<project>/
      // directory this run's artifacts, logs, and state live under, written once
      // at run start so historical artifacts survive a codebase rename (#1192).
      if (!wfColNames.has('output_root')) {
        this.db.run('ALTER TABLE remote_agent_workflow_runs ADD COLUMN output_root TEXT');
      }
      // Same rationale as idx_conversations_user_id above.
      this.db.run(
        'CREATE INDEX IF NOT EXISTS idx_workflow_runs_user_id ON remote_agent_workflow_runs(user_id) WHERE user_id IS NOT NULL'
      );
      this.db.run(
        'CREATE INDEX IF NOT EXISTS idx_workflow_runs_parent_run ON remote_agent_workflow_runs(parent_run_id) WHERE parent_run_id IS NOT NULL'
      );
      this.db.run(
        'CREATE INDEX IF NOT EXISTS idx_workflow_runs_parent_conv ON remote_agent_workflow_runs(parent_conversation_id)'
      );
    } catch (e: unknown) {
      getLog().warn({ err: e as Error }, 'db.sqlite_migration_workflow_runs_columns_failed');
      allApplied = false;
    }

    // Sessions columns
    try {
      const sessCols = this.queryRows<{ name: string }>(
        "PRAGMA table_info('remote_agent_sessions')"
      );
      const sessColNames = new Set(sessCols.map(c => c.name));

      if (!sessColNames.has('ended_reason')) {
        this.db.run('ALTER TABLE remote_agent_sessions ADD COLUMN ended_reason TEXT');
      }
    } catch (e: unknown) {
      getLog().warn({ err: e as Error }, 'db.sqlite_migration_session_columns_failed');
      allApplied = false;
    }

    // Messages columns
    try {
      const cols = this.queryRows<{ name: string }>("PRAGMA table_info('remote_agent_messages')");
      const colNames = new Set(cols.map(c => c.name));
      if (!colNames.has('user_id')) {
        this.db.run(
          'ALTER TABLE remote_agent_messages ADD COLUMN user_id TEXT REFERENCES remote_agent_users(id) ON DELETE SET NULL'
        );
      }
    } catch (e: unknown) {
      getLog().warn({ err: e as Error }, 'db.sqlite_migration_messages_columns_failed');
      allApplied = false;
    }

    // Isolation environments columns
    try {
      const cols = this.queryRows<{ name: string }>(
        "PRAGMA table_info('remote_agent_isolation_environments')"
      );
      const colNames = new Set(cols.map(c => c.name));
      if (!colNames.has('created_by_user_id')) {
        this.db.run(
          'ALTER TABLE remote_agent_isolation_environments ADD COLUMN created_by_user_id TEXT REFERENCES remote_agent_users(id) ON DELETE SET NULL'
        );
      }
    } catch (e: unknown) {
      getLog().warn(
        { err: e as Error },
        'db.sqlite_migration_isolation_environments_columns_failed'
      );
      allApplied = false;
    }

    // User AI prefs columns. #1998: default_model is the per-user default
    // CHAT model, written atomically with default_provider. The table itself
    // shipped with Phase 3 (#1948), so pre-existing installs need this ALTER —
    // CREATE TABLE IF NOT EXISTS in createSchema() is a no-op for them.
    try {
      const cols = this.queryRows<{ name: string }>(
        "PRAGMA table_info('remote_agent_user_ai_prefs')"
      );
      const colNames = new Set(cols.map(c => c.name));
      if (!colNames.has('default_model')) {
        this.db.run('ALTER TABLE remote_agent_user_ai_prefs ADD COLUMN default_model TEXT');
      }
    } catch (e: unknown) {
      getLog().warn({ err: e as Error }, 'db.sqlite_migration_user_ai_prefs_columns_failed');
      allApplied = false;
    }

    // Workflow provider binding columns added after the table first shipped.
    try {
      const cols = this.queryRows<{ name: string }>(
        "PRAGMA table_info('remote_agent_workflow_provider_bindings')"
      );
      const colNames = new Set(cols.map(c => c.name));
      if (cols.length > 0 && !colNames.has('signing_secret')) {
        this.db.run(
          'ALTER TABLE remote_agent_workflow_provider_bindings ADD COLUMN signing_secret TEXT'
        );
      }
      if (cols.length > 0 && !colNames.has('event_types')) {
        this.db.run(
          "ALTER TABLE remote_agent_workflow_provider_bindings ADD COLUMN event_types TEXT NOT NULL DEFAULT '[]'"
        );
      }
      if (cols.length > 0 && !colNames.has('transform')) {
        this.db.run(
          'ALTER TABLE remote_agent_workflow_provider_bindings ADD COLUMN transform TEXT'
        );
      }
      if (cols.length > 0 && !colNames.has('delivery_headers')) {
        this.db.run(
          "ALTER TABLE remote_agent_workflow_provider_bindings ADD COLUMN delivery_headers TEXT NOT NULL DEFAULT '{}'"
        );
      }
    } catch (e: unknown) {
      getLog().warn({ err: e as Error }, 'db.sqlite_migration_provider_binding_columns_failed');
      allApplied = false;
    }

    // Lifecycle ordering: SQLite timestamps have one-second precision. A trigger
    // assigns a durable, monotonically increasing value for each inserted event.
    try {
      const cols = this.queryRows<{ name: string }>(
        "PRAGMA table_info('remote_agent_workflow_events')"
      );
      if (!new Set(cols.map(c => c.name)).has('event_order')) {
        this.db.run('ALTER TABLE remote_agent_workflow_events ADD COLUMN event_order INTEGER');
      }
      this.db.run(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_events_run_order
           ON remote_agent_workflow_events(workflow_run_id, event_order)
           WHERE event_order IS NOT NULL`
      );
      this.db.run(
        `CREATE TRIGGER IF NOT EXISTS remote_agent_workflow_events_assign_order
           AFTER INSERT ON remote_agent_workflow_events
           WHEN NEW.event_order IS NULL
           BEGIN
             UPDATE remote_agent_workflow_events
             SET event_order = (
               SELECT COALESCE(MAX(event_order), 0) + 1
               FROM remote_agent_workflow_events
             )
             WHERE rowid = NEW.rowid;
           END`
      );
    } catch (e: unknown) {
      getLog().warn({ err: e as Error }, 'db.sqlite_migration_workflow_events_columns_failed');
      allApplied = false;
    }

    try {
      const messageCols = this.queryRows<{ name: string }>(
        "PRAGMA table_info('remote_agent_workflow_node_messages')"
      );
      if (!new Set(messageCols.map(c => c.name)).has('metadata')) {
        this.db.run('ALTER TABLE remote_agent_workflow_node_messages ADD COLUMN metadata TEXT');
      }
    } catch (e: unknown) {
      getLog().warn({ err: e as Error }, 'db.sqlite_migration_node_messages_columns_failed');
      allApplied = false;
    }

    try {
      const pendingCols = this.queryRows<{ name: string }>(
        "PRAGMA table_info('remote_agent_pending_interactions')"
      );
      if (!new Set(pendingCols.map(c => c.name)).has('execution_scope')) {
        this.db.run(
          'ALTER TABLE remote_agent_pending_interactions ADD COLUMN execution_scope TEXT'
        );
      }
    } catch (e: unknown) {
      getLog().warn({ err: e as Error }, 'db.sqlite_migration_pending_interactions_columns_failed');
      allApplied = false;
    }

    try {
      const steeringQueueCols = this.queryRows<{ name: string }>(
        "PRAGMA table_info('remote_agent_steering_queue_entries')"
      );
      if (!new Set(steeringQueueCols.map(c => c.name)).has('dispatch_failure_count')) {
        this.db.run(
          'ALTER TABLE remote_agent_steering_queue_entries ADD COLUMN dispatch_failure_count INTEGER NOT NULL DEFAULT 0'
        );
      }
    } catch (e: unknown) {
      getLog().warn({ err: e as Error }, 'db.sqlite_migration_steering_queue_columns_failed');
      allApplied = false;
    }

    // #1955: credential rows are vendor-keyed (claude→anthropic, codex→openai,
    // copilot→github-copilot). Idempotent data fix mirroring
    // migrations/000_combined.sql: where both a legacy and a vendor row exist
    // for the same user, the vendor row wins; then legacy rows are renamed.
    // Transactional so a mid-sequence failure can't leave partial renames
    // (matches the Postgres path, which runs inside the schema-apply txn);
    // a failed run is also survivable — reads normalize legacy ids.
    try {
      this.db.run('BEGIN');
      try {
        this.db.run(
          `DELETE FROM remote_agent_user_provider_keys
           WHERE provider IN ('claude', 'codex', 'copilot')
             AND EXISTS (
               SELECT 1 FROM remote_agent_user_provider_keys v
               WHERE v.user_id = remote_agent_user_provider_keys.user_id
                 AND v.provider = CASE remote_agent_user_provider_keys.provider
                   WHEN 'claude' THEN 'anthropic'
                   WHEN 'codex' THEN 'openai'
                   WHEN 'copilot' THEN 'github-copilot'
                 END
             )`
        );
        this.db.run(
          "UPDATE remote_agent_user_provider_keys SET provider = 'anthropic' WHERE provider = 'claude'"
        );
        this.db.run(
          "UPDATE remote_agent_user_provider_keys SET provider = 'openai' WHERE provider = 'codex'"
        );
        this.db.run(
          "UPDATE remote_agent_user_provider_keys SET provider = 'github-copilot' WHERE provider = 'copilot'"
        );
        this.db.run('COMMIT');
      } catch (inner: unknown) {
        this.db.run('ROLLBACK');
        throw inner;
      }
    } catch (e: unknown) {
      getLog().warn({ err: e as Error }, 'db.sqlite_migration_provider_key_vendor_ids_failed');
      allApplied = false;
    }

    return allApplied;
  }

  /**
   * Create all tables.
   *
   * NOTE: NOT NULL constraint changes on existing columns (e.g., branch_name in
   * isolation_environments, user_message in workflow_runs, name in codebases) are only
   * enforced for new databases. For existing databases, CREATE TABLE IF NOT EXISTS is a
   * no-op so the old schema remains. SQLite lacks ALTER COLUMN support; enforcing new
   * constraints on existing tables would require a table rebuild via migrateColumns().
   */
  private createSchema(): void {
    this.db.run(`
      -- Schema vintage (#2316): which Archon build created this database, and which
      -- last applied schema to it. Diagnostic only — nothing gates on these values.
      -- Single row (id = 1); written by recordSchemaVersion() from APP_VERSION so the
      -- version string has exactly one source of truth.
      CREATE TABLE IF NOT EXISTS remote_agent_schema_version (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        created_app_version TEXT,
        app_version TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Users table (Archon identity, platform-agnostic)
      CREATE TABLE IF NOT EXISTS remote_agent_users (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        display_name TEXT,
        email TEXT,
        role TEXT NOT NULL DEFAULT 'admin',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      -- User identities table (per-platform mapping → users.id)
      CREATE TABLE IF NOT EXISTS remote_agent_user_identities (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        user_id TEXT NOT NULL REFERENCES remote_agent_users(id) ON DELETE CASCADE,
        platform TEXT NOT NULL,
        platform_user_id TEXT NOT NULL,
        platform_display_name TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(platform, platform_user_id)
      );

      -- User GitHub tokens (per-user device-flow tokens, encrypted at rest) [PR-C]
      CREATE TABLE IF NOT EXISTS remote_agent_user_github_tokens (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        user_id TEXT NOT NULL REFERENCES remote_agent_users(id) ON DELETE CASCADE,
        github_user_id INTEGER NOT NULL,
        github_login TEXT NOT NULL,
        access_token_encrypted TEXT NOT NULL,
        refresh_token_encrypted TEXT,
        access_token_expires_at TEXT,
        refresh_token_expires_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(user_id)
      );

      -- User AI-provider credentials (Phase 2): one row per (user_id, provider).
      -- Exactly one of api_key_encrypted / oauth_creds_encrypted is populated;
      -- the kind column records which. Encrypted at rest with TOKEN_ENCRYPTION_KEY.
      CREATE TABLE IF NOT EXISTS remote_agent_user_provider_keys (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        user_id TEXT NOT NULL REFERENCES remote_agent_users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        kind TEXT NOT NULL,
        api_key_encrypted TEXT,
        oauth_creds_encrypted TEXT,
        label TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(user_id, provider)
      );

      -- User AI preferences (Phase 3): personal model tiers, @custom aliases,
      -- and default assistant. NON-encrypted — model names are not secrets
      -- (mirrors codebase_env_vars, not the provider-key store). One row per
      -- user; cascades on user deletion. tiers/aliases are JSON-as-TEXT (parsed
      -- in the store layer so SQLite and Postgres behave identically).
      CREATE TABLE IF NOT EXISTS remote_agent_user_ai_prefs (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        user_id TEXT NOT NULL REFERENCES remote_agent_users(id) ON DELETE CASCADE,
        tiers TEXT,
        aliases TEXT,
        default_provider TEXT,
        default_model TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(user_id)
      );

      -- Codebases table
      CREATE TABLE IF NOT EXISTS remote_agent_codebases (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        name TEXT NOT NULL,
        repository_url TEXT,
        default_cwd TEXT NOT NULL,
        default_branch TEXT,
        ai_assistant_type TEXT DEFAULT 'claude',
        kind TEXT NOT NULL DEFAULT 'repo' CHECK (kind IN ('repo', 'folder')),
        commands TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      -- Codebase env vars table
      CREATE TABLE IF NOT EXISTS remote_agent_codebase_env_vars (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        codebase_id TEXT NOT NULL REFERENCES remote_agent_codebases(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(codebase_id, key)
      );

      -- Conversations table
      CREATE TABLE IF NOT EXISTS remote_agent_conversations (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        platform_type TEXT NOT NULL,
        platform_conversation_id TEXT NOT NULL,
        ai_assistant_type TEXT DEFAULT 'claude',
        codebase_id TEXT REFERENCES remote_agent_codebases(id) ON DELETE SET NULL,
        cwd TEXT,
        isolation_env_id TEXT,
        title TEXT,
        deleted_at TEXT,
        hidden INTEGER DEFAULT 0,
        user_id TEXT REFERENCES remote_agent_users(id) ON DELETE SET NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        last_activity_at TEXT DEFAULT (datetime('now')),
        UNIQUE(platform_type, platform_conversation_id)
      );

      -- Sessions table
      CREATE TABLE IF NOT EXISTS remote_agent_sessions (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        conversation_id TEXT NOT NULL REFERENCES remote_agent_conversations(id) ON DELETE CASCADE,
        codebase_id TEXT REFERENCES remote_agent_codebases(id) ON DELETE SET NULL,
        ai_assistant_type TEXT NOT NULL DEFAULT 'claude',
        assistant_session_id TEXT,
        active INTEGER DEFAULT 1,
        metadata TEXT DEFAULT '{}',
        started_at TEXT DEFAULT (datetime('now')),
        ended_at TEXT,
        parent_session_id TEXT REFERENCES remote_agent_sessions(id),
        transition_reason TEXT,
        ended_reason TEXT
      );

      -- Isolation environments table
      CREATE TABLE IF NOT EXISTS remote_agent_isolation_environments (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        codebase_id TEXT NOT NULL REFERENCES remote_agent_codebases(id) ON DELETE CASCADE,
        workflow_type TEXT NOT NULL,
        workflow_id TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'worktree',
        working_path TEXT NOT NULL,
        branch_name TEXT NOT NULL,
        created_by_platform TEXT,
        created_by_user_id TEXT REFERENCES remote_agent_users(id) ON DELETE SET NULL,
        metadata TEXT DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
        -- Note: uniqueness enforced via partial index below (only active environments)
      );

      -- Partial unique index: only active environments need uniqueness
      CREATE UNIQUE INDEX IF NOT EXISTS unique_active_workflow
        ON remote_agent_isolation_environments (codebase_id, workflow_type, workflow_id)
        WHERE status = 'active';

      -- Workflow runs table
      CREATE TABLE IF NOT EXISTS remote_agent_workflow_runs (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        conversation_id TEXT NOT NULL REFERENCES remote_agent_conversations(id) ON DELETE CASCADE,
        codebase_id TEXT REFERENCES remote_agent_codebases(id) ON DELETE SET NULL,
        workflow_name TEXT NOT NULL,
        user_message TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        current_step_index INTEGER,
        metadata TEXT DEFAULT '{}',
        parent_conversation_id TEXT REFERENCES remote_agent_conversations(id) ON DELETE SET NULL,
        user_id TEXT REFERENCES remote_agent_users(id) ON DELETE SET NULL,
        parent_run_id TEXT REFERENCES remote_agent_workflow_runs(id) ON DELETE SET NULL,
        started_at TEXT DEFAULT (datetime('now')),
        completed_at TEXT,
        last_activity_at TEXT DEFAULT (datetime('now')),
        working_path TEXT,
        output_root TEXT
      );

      -- Workflow events table
      CREATE TABLE IF NOT EXISTS remote_agent_workflow_events (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        workflow_run_id TEXT NOT NULL REFERENCES remote_agent_workflow_runs(id) ON DELETE CASCADE,
        event_order INTEGER,
        event_type TEXT NOT NULL,
        step_index INTEGER,
        step_name TEXT,
        data TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now'))
      );

      -- Per-node git checkpoints for manual failed-node retry setup
      CREATE TABLE IF NOT EXISTS remote_agent_workflow_node_checkpoints (
        workflow_run_id TEXT NOT NULL REFERENCES remote_agent_workflow_runs(id) ON DELETE CASCADE,
        node_id TEXT NOT NULL,
        retry_epoch INTEGER NOT NULL CHECK (retry_epoch >= 0),
        checkpoint_ref TEXT NOT NULL,
        commit_sha TEXT NOT NULL,
        created_commit INTEGER NOT NULL DEFAULT 0,
        fallback_from_node_id TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (workflow_run_id, node_id, retry_epoch)
      );

      -- Messages table (conversation history for Web UI)
      CREATE TABLE IF NOT EXISTS remote_agent_messages (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        conversation_id TEXT NOT NULL REFERENCES remote_agent_conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        metadata TEXT DEFAULT '{}',
        user_id TEXT REFERENCES remote_agent_users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- One row per node execution attempt (a node can execute more than once
      -- within a run: a loop body, a reactivated route target, a retried
      -- node). start_* is recorded before the execution begins; end_* is
      -- filled in after it finishes and stays NULL when the execution never
      -- reached that point. Read by the server to compute which repository
      -- paths that execution changed.
      CREATE TABLE IF NOT EXISTS remote_agent_workflow_node_execution_evidence (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        workflow_run_id TEXT NOT NULL REFERENCES remote_agent_workflow_runs(id) ON DELETE CASCADE,
        node_id TEXT NOT NULL,
        retry_epoch INTEGER NOT NULL DEFAULT 0,
        start_checkpoint_ref TEXT NOT NULL,
        start_commit_sha TEXT NOT NULL,
        started_at TEXT DEFAULT (datetime('now')),
        end_checkpoint_ref TEXT,
        end_commit_sha TEXT,
        ended_at TEXT
      );

      -- Per-node provider session IDs persisted across workflow re-runs
      CREATE TABLE IF NOT EXISTS remote_agent_workflow_node_sessions (
        workflow_name TEXT NOT NULL,
        node_id TEXT NOT NULL,
        scope_key TEXT NOT NULL,
        provider TEXT NOT NULL,
        provider_session_id TEXT NOT NULL,
        last_run_id TEXT REFERENCES remote_agent_workflow_runs(id) ON DELETE SET NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (workflow_name, node_id, scope_key, provider)
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_codebase_env_vars_codebase_id ON remote_agent_codebase_env_vars(codebase_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_platform ON remote_agent_conversations(platform_type, platform_conversation_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_conversation ON remote_agent_sessions(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_active ON remote_agent_sessions(active);
      CREATE INDEX IF NOT EXISTS idx_isolation_codebase ON remote_agent_isolation_environments(codebase_id);
      CREATE INDEX IF NOT EXISTS idx_isolation_workflow ON remote_agent_isolation_environments(workflow_type, workflow_id);
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_conversation ON remote_agent_workflow_runs(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON remote_agent_workflow_runs(status);
      CREATE INDEX IF NOT EXISTS idx_workflow_events_run_id ON remote_agent_workflow_events(workflow_run_id);
      CREATE INDEX IF NOT EXISTS idx_workflow_events_type ON remote_agent_workflow_events(event_type);
      CREATE INDEX IF NOT EXISTS idx_workflow_events_created_at ON remote_agent_workflow_events(created_at);
      CREATE INDEX IF NOT EXISTS idx_workflow_node_checkpoints_run ON remote_agent_workflow_node_checkpoints(workflow_run_id);
      CREATE INDEX IF NOT EXISTS idx_workflow_node_checkpoints_run_node_epoch
        ON remote_agent_workflow_node_checkpoints(workflow_run_id, node_id, retry_epoch DESC);
      CREATE INDEX IF NOT EXISTS idx_node_execution_evidence_run
        ON remote_agent_workflow_node_execution_evidence(workflow_run_id);
      CREATE INDEX IF NOT EXISTS idx_node_execution_evidence_run_node_epoch
        ON remote_agent_workflow_node_execution_evidence(workflow_run_id, node_id, retry_epoch DESC);
      -- NOTE: the idx_workflow_events_run_order index and the assign_order trigger
      -- are deliberately NOT created here. Both reference event_order, which does
      -- not exist on databases created before it was introduced — and CREATE INDEX
      -- (or a TRIGGER body) referencing a missing column aborts this entire exec
      -- block, so createSchema() throws before migrateColumns() can ever add the
      -- column. That is exactly the failure the user_id index comment above warns
      -- about. migrateColumns() creates both, after its ALTER TABLE, idempotently.
      CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON remote_agent_messages(conversation_id, created_at ASC);
      CREATE INDEX IF NOT EXISTS idx_workflow_node_sessions_scope ON remote_agent_workflow_node_sessions(scope_key);
      CREATE INDEX IF NOT EXISTS idx_workflow_node_sessions_workflow ON remote_agent_workflow_node_sessions(workflow_name);
      -- NOTE: idx_workflow_runs_parent_conv, idx_conversations_hidden and the
      -- partial idx_conversations_codebase are NOT created here either. They
      -- reference parent_conversation_id / hidden / deleted_at, which
      -- migrateColumns() adds — so they are missing on any database created
      -- before those columns existed, and a CREATE INDEX on a missing column
      -- aborts this whole exec block before migrateColumns() can run.
      CREATE INDEX IF NOT EXISTS idx_conversations_isolation_env_id ON remote_agent_conversations(isolation_env_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_codebase ON remote_agent_sessions(codebase_id);
      CREATE INDEX IF NOT EXISTS idx_isolation_env_status ON remote_agent_isolation_environments(status);

      -- From PG migration 009: staleness detection for running workflows
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_last_activity
        ON remote_agent_workflow_runs(last_activity_at) WHERE status = 'running';

      -- From PG migration 010: session audit trail
      CREATE INDEX IF NOT EXISTS idx_sessions_parent
        ON remote_agent_sessions(parent_session_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_conversation_started
        ON remote_agent_sessions(conversation_id, started_at DESC);

      -- User identity index. user_identities is a new table created above
      -- so its user_id column always exists. Indexes for the user_id columns
      -- added by migrateColumns() onto pre-existing tables (conversations,
      -- workflow_runs) are created there, alongside the ALTER TABLE — see
      -- the comment in migrateColumns() for why this is order-sensitive.
      CREATE INDEX IF NOT EXISTS idx_user_identities_user_id
        ON remote_agent_user_identities(user_id);

      -- Workflow provider bindings table
      CREATE TABLE IF NOT EXISTS remote_agent_workflow_provider_bindings (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        provider TEXT NOT NULL,
        name TEXT NOT NULL,
        codebase_id TEXT NOT NULL REFERENCES remote_agent_codebases(id) ON DELETE CASCADE,
        event_route TEXT NOT NULL,
        event_types TEXT NOT NULL DEFAULT '[]',
        signing_secret TEXT,
        transform TEXT,
        delivery_headers TEXT NOT NULL DEFAULT '{}',
        state TEXT NOT NULL DEFAULT 'active',
        binding_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE (provider, name)
      );

      CREATE INDEX IF NOT EXISTS idx_provider_bindings_codebase
        ON remote_agent_workflow_provider_bindings(codebase_id);
      CREATE INDEX IF NOT EXISTS idx_provider_bindings_provider_name
        ON remote_agent_workflow_provider_bindings(provider, name);

      -- Durable external workflow-event outbox
      CREATE TABLE IF NOT EXISTS remote_agent_workflow_event_outbox (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        event_id TEXT UNIQUE NOT NULL,
        idempotency_key TEXT NOT NULL,
        event_type TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'archon',
        workflow_run_id TEXT NOT NULL REFERENCES remote_agent_workflow_runs(id) ON DELETE CASCADE,
        codebase_id TEXT REFERENCES remote_agent_codebases(id) ON DELETE SET NULL,
        binding_id TEXT REFERENCES remote_agent_workflow_provider_bindings(id) ON DELETE SET NULL,
        event_route TEXT,
        event_body TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        not_routable_reason TEXT,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        last_attempt_at TEXT,
        next_attempt_at TEXT,
        last_error TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_workflow_event_outbox_due
        ON remote_agent_workflow_event_outbox(status, next_attempt_at);
      CREATE INDEX IF NOT EXISTS idx_workflow_event_outbox_run
        ON remote_agent_workflow_event_outbox(workflow_run_id);

      -- Append-only HTTP delivery attempt history
      CREATE TABLE IF NOT EXISTS remote_agent_workflow_event_delivery_attempts (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        outbox_event_id TEXT NOT NULL REFERENCES remote_agent_workflow_event_outbox(id) ON DELETE CASCADE,
        attempt_number INTEGER NOT NULL,
        request_url TEXT NOT NULL,
        request_method TEXT NOT NULL DEFAULT 'POST',
        request_headers TEXT NOT NULL,
        request_body TEXT NOT NULL,
        response_status INTEGER,
        response_headers TEXT,
        response_body TEXT,
        transport_error TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        duration_ms INTEGER,
        outcome TEXT NOT NULL DEFAULT 'pending'
      );

      CREATE INDEX IF NOT EXISTS idx_workflow_event_delivery_attempts_outbox
        ON remote_agent_workflow_event_delivery_attempts(outbox_event_id);

      -- Usage ledger (normalized child of node_usage_recorded events)
      CREATE TABLE IF NOT EXISTS remote_agent_usage_ledger (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        workflow_event_id TEXT NOT NULL REFERENCES remote_agent_workflow_events(id) ON DELETE CASCADE,
        entry_index INTEGER NOT NULL CHECK (entry_index >= 0),
        agent_provider TEXT NOT NULL CHECK (agent_provider <> ''),
        provider TEXT NOT NULL CHECK (provider <> ''),
        model TEXT,
        model_source TEXT NOT NULL CHECK (model_source IN ('reported', 'requested', 'unknown')),
        kind TEXT CHECK (kind IS NULL OR kind IN ('advisor', 'subagent')),
        tokens_input INTEGER CHECK (tokens_input IS NULL OR tokens_input >= 0),
        tokens_output INTEGER CHECK (tokens_output IS NULL OR tokens_output >= 0),
        tokens_reasoning INTEGER CHECK (tokens_reasoning IS NULL OR tokens_reasoning >= 0),
        tokens_cache_read INTEGER CHECK (tokens_cache_read IS NULL OR tokens_cache_read >= 0),
        tokens_cache_write INTEGER CHECK (tokens_cache_write IS NULL OR tokens_cache_write >= 0),
        requests INTEGER CHECK (requests IS NULL OR requests > 0),
        cost_usd REAL CHECK (cost_usd IS NULL OR cost_usd >= 0),
        cost_estimated_usd REAL CHECK (cost_estimated_usd IS NULL OR cost_estimated_usd >= 0),
        pricing_source TEXT CHECK (pricing_source IS NULL OR pricing_source IN ('config', 'catalog')),
        UNIQUE (workflow_event_id, entry_index),
        CHECK (
          tokens_input IS NOT NULL
          OR tokens_output IS NOT NULL
          OR tokens_reasoning IS NOT NULL
          OR tokens_cache_read IS NOT NULL
          OR tokens_cache_write IS NOT NULL
          OR requests IS NOT NULL
          OR cost_usd IS NOT NULL
          OR cost_estimated_usd IS NOT NULL
        ),
        CHECK (NOT (cost_usd IS NOT NULL AND cost_estimated_usd IS NOT NULL)),
        CHECK (
          (cost_estimated_usd IS NULL AND pricing_source IS NULL)
          OR (cost_estimated_usd IS NOT NULL AND pricing_source IS NOT NULL)
        ),
        CHECK (
          (model_source = 'unknown' AND model IS NULL)
          OR (model_source IN ('reported', 'requested') AND model IS NOT NULL AND model <> '')
        ),
        CHECK (
          tokens_reasoning IS NULL
          OR tokens_output IS NULL
          OR tokens_reasoning <= tokens_output
        )
      );

      CREATE INDEX IF NOT EXISTS idx_usage_ledger_agent_provider
        ON remote_agent_usage_ledger(agent_provider);
      CREATE INDEX IF NOT EXISTS idx_usage_ledger_provider_model
        ON remote_agent_usage_ledger(provider, model);
      CREATE INDEX IF NOT EXISTS idx_workflow_events_usage_created_at
        ON remote_agent_workflow_events(created_at)
        WHERE event_type = 'node_usage_recorded';
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_codebase_id
        ON remote_agent_workflow_runs(codebase_id);

      -- Workflow ENVs (named install-wide overlays)
      CREATE TABLE IF NOT EXISTS remote_agent_workflow_envs (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        workflow_name TEXT NOT NULL,
        name TEXT NOT NULL,
        patches TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        created_by_user_id TEXT REFERENCES remote_agent_users(id) ON DELETE SET NULL,
        CONSTRAINT uq_workflow_envs_workflow_name_name UNIQUE (workflow_name, name)
      );
      CREATE INDEX IF NOT EXISTS idx_workflow_envs_workflow_name
        ON remote_agent_workflow_envs(workflow_name);

      -- Workflow node messages (per-node transcript)
      CREATE TABLE IF NOT EXISTS remote_agent_workflow_node_messages (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        workflow_run_id TEXT NOT NULL REFERENCES remote_agent_workflow_runs(id) ON DELETE CASCADE,
        node_id TEXT NOT NULL,
        seq INTEGER NOT NULL CHECK (seq >= 1),
        kind TEXT NOT NULL CHECK (kind IN ('text', 'tool', 'status')),
        payload TEXT NOT NULL,
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        CONSTRAINT uq_workflow_node_messages_run_node_seq
          UNIQUE (workflow_run_id, node_id, seq)
      );

      -- Pending interactions (AskHuman / permission pauses)
      CREATE TABLE IF NOT EXISTS remote_agent_pending_interactions (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        workflow_run_id TEXT NOT NULL REFERENCES remote_agent_workflow_runs(id) ON DELETE CASCADE,
        node_id TEXT NOT NULL,
        tool_use_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('ask', 'permission')),
        status TEXT NOT NULL CHECK (status IN ('pending', 'answered', 'purged')),
        envelope TEXT NOT NULL,
        answer TEXT,
        provider_session_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        resolved_at TEXT,
        resolved_by TEXT,
        execution_scope TEXT,
        CONSTRAINT uq_pending_interactions_run_tool_use
          UNIQUE (workflow_run_id, tool_use_id)
      );

      -- Steering drafts (per-author composer draft, per node)
      CREATE TABLE IF NOT EXISTS remote_agent_steering_drafts (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        workflow_run_id TEXT NOT NULL REFERENCES remote_agent_workflow_runs(id) ON DELETE CASCADE,
        node_id TEXT NOT NULL,
        operator_user_id TEXT NOT NULL DEFAULT '',
        message TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        CONSTRAINT uq_steering_drafts_run_node_operator
          UNIQUE (workflow_run_id, node_id, operator_user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_steering_drafts_run_node
        ON remote_agent_steering_drafts(workflow_run_id, node_id);

      -- Steering queue entries (durable node-scoped guidance queue)
      CREATE TABLE IF NOT EXISTS remote_agent_steering_queue_entries (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        workflow_run_id TEXT NOT NULL REFERENCES remote_agent_workflow_runs(id) ON DELETE CASCADE,
        node_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        message TEXT NOT NULL,
        operator_user_id TEXT NOT NULL DEFAULT '',
        fifo_position INTEGER NOT NULL CHECK (fifo_position >= 1),
        state TEXT NOT NULL DEFAULT 'queued',
        last_error TEXT,
        dispatch_failure_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        CONSTRAINT uq_steering_queue_run_node_message
          UNIQUE (workflow_run_id, node_id, message_id),
        CONSTRAINT uq_steering_queue_run_node_position
          UNIQUE (workflow_run_id, node_id, fifo_position)
      );
      CREATE INDEX IF NOT EXISTS idx_steering_queue_run_node_position
        ON remote_agent_steering_queue_entries(workflow_run_id, node_id, fifo_position);
      CREATE INDEX IF NOT EXISTS idx_steering_queue_state
        ON remote_agent_steering_queue_entries(state);

      -- Steering node settings (durable per-node auto-send + provider)
      CREATE TABLE IF NOT EXISTS remote_agent_steering_node_settings (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        workflow_run_id TEXT NOT NULL REFERENCES remote_agent_workflow_runs(id) ON DELETE CASCADE,
        node_id TEXT NOT NULL,
        auto_send_enabled INTEGER NOT NULL DEFAULT 0,
        updated_by_user_id TEXT,
        provider_id TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        CONSTRAINT uq_steering_node_settings_run_node
          UNIQUE (workflow_run_id, node_id)
      );
    `);
    getLog().info('db.sqlite_schema_initialized');
  }
}

/**
 * SQLite SQL dialect helpers
 */
export const sqliteDialect: SqlDialect = {
  generateUuid(): string {
    return crypto.randomUUID();
  },

  now(): string {
    return "datetime('now')";
  },

  jsonMerge(column: string, paramIndex: number): string {
    // SQLite json_patch: merges two JSON objects
    // Use $N placeholder (not raw ?) so convertPlaceholders can reorder params correctly
    return `json_patch(${column}, $${String(paramIndex)})`;
  },

  jsonArrayContains(column: string, path: string, paramIndex: number): string {
    // SQLite: check if JSON array contains value using instr
    // Use $N placeholder for consistent param ordering
    return `instr(json_extract(${column}, '$.${path}'), $${String(paramIndex)}) > 0`;
  },

  nowMinusDays(paramIndex: number): string {
    return `datetime('now', '-' || $${String(paramIndex)} || ' days')`;
  },

  daysSince(column: string): string {
    return `(julianday('now') - julianday(${column}))`;
  },
};
