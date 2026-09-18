/**
 * Tests for `scripts/audit-generic-fallback.ts` (Issue #176, Story 1.3 /
 * CAP-2): the read-only generic-fallback audit the release gate reads.
 *
 * Two complementary layers:
 *  - In-process tests exercise the pairing/tally/record/check machinery and
 *    the SQLite corpus path against per-test fixture databases.
 *  - Subprocess tests prove the CLI contract: import performs no I/O, default
 *    mode only prints, --record writes atomically, --check never opens a
 *    database, and there is no implicit ~/.archon/DATABASE_URL target.
 *
 * The PostgreSQL path is exercised when ARCHON_AUDIT_TEST_PG_URL points at a
 * scratch server — the test creates and drops an isolated database so it never
 * touches a real corpus. Without the env var it reports a soft skip; SQLite
 * alone is not proof of both dialects, so CI should set it.
 *
 * Every test owns its sandbox through `withSandbox` and removes it in
 * `finally` — no module-level fixture state.
 */
import { describe, test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  auditSqlite,
  auditPostgres,
  checkRecord,
  fractionExceeded,
  tallyProjectedRows,
  toPairableMessage,
  writeRecordAtomic,
  parseArgs,
  computeAuditSourceSha256,
  AuditDataError,
  AuditPolicyError,
  MalformedRowError,
  type AuditRecord,
  type ProjectedRow,
} from './audit-generic-fallback';

const SCRIPT = resolve(import.meta.dir, 'audit-generic-fallback.ts');
const REPO_ROOT = resolve(import.meta.dir, '..');
const PG_TEST_URL = process.env.ARCHON_AUDIT_TEST_PG_URL;

interface Sandbox {
  readonly root: string;
  readonly dbPath: string;
  readonly recordPath: string;
}

async function withSandbox(body: (ctx: Sandbox) => Promise<void> | void): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'archon-audit-'));
  const ctx: Sandbox = {
    root,
    dbPath: join(root, 'corpus.db'),
    recordPath: join(root, 'record.json'),
  };
  try {
    await body(ctx);
  } finally {
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (error) {
      console.warn(`sandbox cleanup failed for ${root}: ${(error as Error).message}`);
    }
  }
}

const FIXTURE_SCHEMA = `
CREATE TABLE remote_agent_workflow_node_messages (
  id TEXT PRIMARY KEY,
  workflow_run_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  seq INTEGER NOT NULL CHECK (seq >= 1),
  kind TEXT NOT NULL CHECK (kind IN ('text', 'tool', 'status')),
  payload TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CONSTRAINT uq_workflow_node_messages_run_node_seq UNIQUE (workflow_run_id, node_id, seq)
)`;

interface FixtureRow {
  id: string;
  run?: string;
  node?: string;
  seq: number;
  kind?: 'text' | 'tool' | 'status';
  payload: unknown;
  metadata?: unknown;
}

function createFixture(dbPath: string, rows: FixtureRow[]): void {
  const db = new Database(dbPath);
  db.exec(FIXTURE_SCHEMA);
  const insert = db.prepare(
    `INSERT INTO remote_agent_workflow_node_messages
       (id, workflow_run_id, node_id, seq, kind, payload, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const row of rows) {
    insert.run(
      row.id,
      row.run ?? 'run-1',
      row.node ?? 'node-a',
      row.seq,
      row.kind ?? 'tool',
      typeof row.payload === 'string' ? row.payload : JSON.stringify(row.payload),
      row.metadata === undefined
        ? null
        : typeof row.metadata === 'string'
          ? row.metadata
          : JSON.stringify(row.metadata)
    );
  }
  db.close();
}

/** Modern call/result pair (tool_phase metadata present). */
function callRow(
  seq: number,
  name: string,
  id: string,
  input?: unknown,
  extra?: Partial<FixtureRow>
): FixtureRow {
  return {
    id: `c${seq}`,
    seq,
    payload: { name, id, ...(input === undefined ? {} : { input }) },
    metadata: { tool_phase: 'call' },
    ...extra,
  };
}

function resultRow(
  seq: number,
  name: string,
  id: string,
  input: unknown,
  output: unknown,
  extra?: Partial<FixtureRow>
): FixtureRow {
  return {
    id: `r${seq}`,
    seq,
    payload: { name, id, input, output },
    metadata: { tool_phase: 'result' },
    ...extra,
  };
}

function rowOf(
  seq: number,
  name: string,
  id: string,
  overrides?: Partial<ProjectedRow>
): ProjectedRow {
  return {
    id: `m${seq}`,
    workflow_run_id: 'run-1',
    node_id: 'node-a',
    seq,
    tool_use_id: id,
    name,
    input_json: null,
    output_present: 0,
    tool_phase: null,
    occurrence_id: null,
    attempt_id: null,
    ...overrides,
  };
}

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Scrubbed environment — ARCHON_HOME and DATABASE_URL never reach the child. */
function scrubbedEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ARCHON_HOME;
  delete env.DATABASE_URL;
  delete env.ARCHON_AUDIT_TEST_PG_URL;
  return { ...env, ...extra };
}

async function runCli(args: string[], cwd: string, env?: NodeJS.ProcessEnv): Promise<RunResult> {
  const proc = Bun.spawn(['bun', 'run', SCRIPT, ...args], {
    cwd,
    env: env ?? scrubbedEnv(),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

describe('toPairableMessage validation', () => {
  test('accepts a minimal call row', () => {
    const msg = toPairableMessage(rowOf(1, 'bash', 'tu_1', { tool_phase: 'call' }));
    expect(msg.kind).toBe('tool');
    const payload = msg.payload as { name: string; id: string; output?: unknown };
    expect(payload.name).toBe('bash');
    expect(payload.id).toBe('tu_1');
    expect(payload.output).toBeUndefined();
    expect(msg.metadata?.tool_phase).toBe('call');
  });

  test('sets the inert output sentinel for output presence', () => {
    const msg = toPairableMessage(rowOf(1, 'bash', 'tu_1', { output_present: 1 }));
    const payload = msg.payload as { output?: unknown };
    expect(payload.output).toBeDefined();
    expect(typeof payload.output).toBe('symbol');
  });

  test('parses input JSON text', () => {
    const msg = toPairableMessage(rowOf(1, 'bash', 'tu_1', { input_json: '{"command":"ls"}' }));
    const payload = msg.payload as { input?: unknown };
    expect(payload.input).toEqual({ command: 'ls' });
  });

  test('malformed row reports identity, never payload contents', () => {
    const row = rowOf(7, 'bash', 'tu_1', { name: null, input_json: '"SECRET_INPUT_SENTINEL"' });
    try {
      toPairableMessage(row);
      throw new Error('expected MalformedRowError');
    } catch (error) {
      expect(error).toBeInstanceOf(MalformedRowError);
      const message = (error as Error).message;
      expect(message).toContain('id=m7');
      expect(message).toContain('run=run-1');
      expect(message).toContain('seq=7');
      expect(message).not.toContain('SECRET_INPUT_SENTINEL');
    }
  });

  test('rejects non-positive seq and bad tool_phase', () => {
    expect(() => toPairableMessage(rowOf(0, 'bash', 'tu_1'))).toThrow(MalformedRowError);
    expect(() => toPairableMessage(rowOf(1, 'bash', 'tu_1', { tool_phase: 'weird' }))).toThrow(
      MalformedRowError
    );
    expect(() => toPairableMessage(rowOf(1, 'bash', 'tu_1', { input_json: 'not-json{' }))).toThrow(
      MalformedRowError
    );
  });
});

describe('tallyProjectedRows denominator', () => {
  test('two modern call/result pairs count as two logical cards', () => {
    const rows = [
      rowOf(1, 'bash', 'tu_1', { tool_phase: 'call' }),
      rowOf(2, 'bash', 'tu_1', { tool_phase: 'result', output_present: 1 }),
      rowOf(3, 'bash', 'tu_2', { tool_phase: 'call' }),
      rowOf(4, 'bash', 'tu_2', { tool_phase: 'result', output_present: 1 }),
    ];
    const tally = tallyProjectedRows(rows);
    expect(tally.logicalCards).toBe(2);
    expect(tally.genericCards).toBe(0);
    expect(tally.nodeGroups).toBe(1);
  });

  test('pending call-only card counts', () => {
    const tally = tallyProjectedRows([rowOf(1, 'bash', 'tu_1', { tool_phase: 'call' })]);
    expect(tally.logicalCards).toBe(1);
  });

  test('legacy result-only card counts via output presence', () => {
    const tally = tallyProjectedRows([rowOf(1, 'frobnicate', 'tu_1', { output_present: 1 })]);
    expect(tally.logicalCards).toBe(1);
    expect(tally.genericCards).toBe(1);
  });

  test('same tool id in different nodes and runs never cross-pairs', () => {
    const rows = [
      // pending call in node-a
      rowOf(1, 'bash', 'tu_x', { tool_phase: 'call', workflow_run_id: 'run-1', node_id: 'node-a' }),
      // result-only in node-b — must NOT consume run-1/node-a's call
      rowOf(1, 'bash', 'tu_x', {
        tool_phase: 'result',
        output_present: 1,
        workflow_run_id: 'run-1',
        node_id: 'node-b',
      }),
      // result-only in a different run entirely
      rowOf(1, 'bash', 'tu_x', {
        tool_phase: 'result',
        output_present: 1,
        workflow_run_id: 'run-2',
        node_id: 'node-a',
      }),
    ];
    const tally = tallyProjectedRows(rows);
    // 3 separate groups → 3 cards (pending call + two result-only cards)
    expect(tally.logicalCards).toBe(3);
    expect(tally.nodeGroups).toBe(3);
  });

  test('interleaved group order fails closed', () => {
    const rows = [
      rowOf(1, 'bash', 'a', { workflow_run_id: 'r1', node_id: 'n1' }),
      rowOf(1, 'bash', 'b', { workflow_run_id: 'r1', node_id: 'n2' }),
      rowOf(2, 'bash', 'c', { workflow_run_id: 'r1', node_id: 'n1' }),
    ];
    expect(() => tallyProjectedRows(rows)).toThrow(AuditDataError);
  });

  test('node over the tool-row ceiling fails closed', () => {
    const rows = Array.from({ length: 6 }, (_, i) => rowOf(i + 1, 'bash', `tu_${i}`));
    expect(() => tallyProjectedRows(rows, { maxNodeToolRows: 5 })).toThrow(/tool-row ceiling/);
  });

  test('generic name aggregation is bounded, token-only, and deterministic', () => {
    const rows = [
      rowOf(1, 'frobnicate', 'tu_1'),
      rowOf(2, 'frobnicate', 'tu_2'),
      rowOf(3, 'zebrapike', 'tu_3'),
      rowOf(4, 'mcp__srv__tool', 'tu_4'),
      // over the name bound: counted as generic but never recorded by name
      rowOf(5, 'x'.repeat(200), 'tu_5'),
    ];
    const tally = tallyProjectedRows(rows, { includeGenericNames: true });
    expect(tally.genericCards).toBe(5);
    // count desc, then name asc — deterministic
    expect(tally.genericNames).toEqual([
      { name: 'frobnicate', cards: 2 },
      { name: 'mcp__srv__tool', cards: 1 },
      { name: 'zebrapike', cards: 1 },
    ]);
  });
});

describe('fractionExceeded integer threshold', () => {
  test('exactly 2% fails, below passes, above fails', () => {
    expect(fractionExceeded(1, 50)).toBe(true); // exactly 2%
    expect(fractionExceeded(1, 51)).toBe(false); // ~1.96%
    expect(fractionExceeded(2, 50)).toBe(true); // 4%
    expect(fractionExceeded(0, 100)).toBe(false);
  });
});

describe('auditSqlite corpus path', () => {
  test('counts modern pairs, pending calls, and legacy results; excludes text/status', async () => {
    await withSandbox(ctx => {
      createFixture(ctx.dbPath, [
        { id: 't1', seq: 1, kind: 'text', payload: { text: 'hello' } },
        { id: 's1', seq: 2, kind: 'status', payload: { state: 'running' } },
        callRow(3, 'bash', 'tu_1', { command: 'ls' }),
        resultRow(4, 'bash', 'tu_1', { command: 'ls' }, { stdout: 'x' }),
        callRow(5, 'read', 'tu_2', { path: '/a' }), // pending
        // legacy result-only (no metadata): output key presence makes it a result
        {
          id: 'l1',
          seq: 6,
          payload: { name: 'frobnicate', id: 'tu_3', input: {}, output: { body: 'y'.repeat(500) } },
        },
      ]);
      const record = auditSqlite(ctx.dbPath, { sourceId: 'test' });
      expect(record.logicalCards).toBe(3);
      expect(record.genericCards).toBe(1);
      expect(record.dialect).toBe('sqlite');
      expect(record.source).toBe('test');
      expect(record.denominator).toBe('logical-tool-cards-v1');
      expect(record.auditSourceSha256).toBe(computeAuditSourceSha256(REPO_ROOT));
    });
  });

  test('call/result split across a keyset page boundary pairs once', async () => {
    await withSandbox(ctx => {
      createFixture(ctx.dbPath, [
        callRow(1, 'bash', 'tu_1', { command: 'ls' }),
        resultRow(2, 'bash', 'tu_1', { command: 'ls' }, { stdout: 'x' }),
        callRow(3, 'bash', 'tu_2', { command: 'pwd' }),
      ]);
      // pageSize=1 forces every row onto its own page
      const record = auditSqlite(ctx.dbPath, { pageSize: 1, sourceId: 'paged' });
      expect(record.logicalCards).toBe(2);
      expect(record.genericCards).toBe(0);
    });
  });

  test('scalar tool inputs project faithfully', async () => {
    await withSandbox(ctx => {
      createFixture(ctx.dbPath, [
        { id: 'a', seq: 1, payload: { name: 'bash', id: 't1', input: 'ls -la' } },
        { id: 'b', seq: 2, payload: { name: 'bash', id: 't2', input: 42 } },
        { id: 'c', seq: 3, payload: { name: 'bash', id: 't3', input: true } },
        { id: 'd', seq: 4, payload: { name: 'bash', id: 't4', input: null } },
        { id: 'e', seq: 5, payload: { name: 'bash', id: 't5' } },
        { id: 'f', seq: 6, payload: { name: 'bash', id: 't6', input: [1, 2] } },
      ]);
      const record = auditSqlite(ctx.dbPath, { sourceId: 'scalars' });
      expect(record.logicalCards).toBe(6);
    });
  });

  test('read-only: database bytes unchanged and no journal files created', async () => {
    await withSandbox(ctx => {
      createFixture(ctx.dbPath, [callRow(1, 'bash', 'tu_1', { command: 'ls' })]);
      const before = createHash('sha256').update(readFileSync(ctx.dbPath)).digest('hex');
      auditSqlite(ctx.dbPath, { sourceId: 'ro' });
      const after = createHash('sha256').update(readFileSync(ctx.dbPath)).digest('hex');
      expect(after).toBe(before);
      // The script must create no -journal/-wal/-shm sidecars.
      expect(readdirSync(ctx.root)).toEqual(['corpus.db']);
    });
  });

  test('reads a live WAL corpus while the writer holds it open', async () => {
    await withSandbox(ctx => {
      const writer = new Database(ctx.dbPath);
      writer.exec('PRAGMA journal_mode = WAL');
      writer.exec(FIXTURE_SCHEMA);
      writer
        .prepare(
          `INSERT INTO remote_agent_workflow_node_messages
             (id, workflow_run_id, node_id, seq, kind, payload, metadata)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          'm1',
          'run-1',
          'node-a',
          1,
          'tool',
          JSON.stringify({ name: 'bash', id: 'tu_1' }),
          null
        );
      try {
        const record = auditSqlite(ctx.dbPath, { sourceId: 'wal' });
        expect(record.logicalCards).toBe(1);
        // Audit created no sidecar files of its own.
        const files = readdirSync(ctx.root).sort();
        for (const f of files) {
          expect(['corpus.db', 'corpus.db-wal', 'corpus.db-shm']).toContain(f);
        }
      } finally {
        writer.close();
      }
    });
  });

  test('writes are impossible through the read-only handle the script uses', async () => {
    await withSandbox(ctx => {
      createFixture(ctx.dbPath, [callRow(1, 'bash', 'tu_1')]);
      const ro = new Database(ctx.dbPath, { readonly: true });
      ro.exec('PRAGMA query_only = ON');
      expect(() =>
        ro.run(
          `INSERT INTO remote_agent_workflow_node_messages (id, workflow_run_id, node_id, seq, kind, payload) VALUES ('x','r','n',1,'tool','{}')`
        )
      ).toThrow();
      ro.close();
    });
  });

  test('malformed stored JSON fails closed with row identity, not payload contents', async () => {
    await withSandbox(ctx => {
      const db = new Database(ctx.dbPath);
      db.exec(FIXTURE_SCHEMA);
      db.run(
        `INSERT INTO remote_agent_workflow_node_messages (id, workflow_run_id, node_id, seq, kind, payload, metadata)
         VALUES ('bad1', 'run-9', 'node-z', 3, 'tool', 'PAYLOAD_SENTINEL{not-json', NULL)`
      );
      db.close();
      try {
        auditSqlite(ctx.dbPath, { sourceId: 'bad' });
        throw new Error('expected AuditDataError');
      } catch (error) {
        expect(error).toBeInstanceOf(AuditDataError);
        const message = (error as Error).message;
        expect(message).toContain('id=bad1');
        expect(message).toContain('run=run-9');
        expect(message).toContain('seq=3');
        expect(message).not.toContain('PAYLOAD_SENTINEL');
      }
    });
  });

  test('zero-card corpus fails closed', async () => {
    await withSandbox(ctx => {
      createFixture(ctx.dbPath, [
        { id: 't1', seq: 1, kind: 'text', payload: { text: 'hi' } },
        { id: 's1', seq: 2, kind: 'status', payload: { state: 'done' } },
      ]);
      expect(() => auditSqlite(ctx.dbPath, { sourceId: 'empty' })).toThrow(
        /zero logical tool cards/
      );
    });
  });

  test('very large output bodies: only presence is projected', async () => {
    await withSandbox(ctx => {
      const bigOutput = 'O'.repeat(8 * 1024 * 1024); // 8 MB output body
      createFixture(ctx.dbPath, [
        callRow(1, 'bash', 'tu_1', { command: 'ls' }),
        resultRow(2, 'bash', 'tu_1', { command: 'ls' }, { stdout: bigOutput }),
      ]);
      const record = auditSqlite(ctx.dbPath, { sourceId: 'big' });
      expect(record.logicalCards).toBe(1);
      const serialized = JSON.stringify(record);
      expect(serialized.length).toBeLessThan(4096);
      expect(serialized).not.toContain('OOOO');
    });
  });

  test('large corpus across many groups stays bounded with a small page size', async () => {
    await withSandbox(ctx => {
      const db = new Database(ctx.dbPath);
      db.exec(FIXTURE_SCHEMA);
      const insert = db.prepare(
        `INSERT INTO remote_agent_workflow_node_messages
           (id, workflow_run_id, node_id, seq, kind, payload, metadata)
         VALUES (?, ?, ?, ?, 'tool', ?, ?)`
      );
      const groups = 200;
      const pairsPerGroup = 5;
      for (let g = 0; g < groups; g++) {
        for (let s = 0; s < pairsPerGroup * 2; s += 2) {
          const generic = g % 100 === 0;
          // a `command` key would classify ANY name as shell — generic rows need
          // input that carries no family signal
          const name = generic ? 'frobnicate' : 'bash';
          const input = generic ? {} : { command: 'x' };
          insert.run(
            `g${g}c${s}`,
            `run-${Math.floor(g / 50)}`,
            `node-${g % 50}`,
            s + 1,
            JSON.stringify({ name, id: `tu_${g}_${s}`, input }),
            JSON.stringify({ tool_phase: 'call' })
          );
          insert.run(
            `g${g}r${s}`,
            `run-${Math.floor(g / 50)}`,
            `node-${g % 50}`,
            s + 2,
            JSON.stringify({ name, id: `tu_${g}_${s}`, input, output: { o: 1 } }),
            JSON.stringify({ tool_phase: 'result' })
          );
        }
      }
      db.close();
      const record = auditSqlite(ctx.dbPath, { pageSize: 13, sourceId: 'large' });
      expect(record.logicalCards).toBe(groups * pairsPerGroup);
      // g%100===0 → groups 0 and 100 → 10 generic cards out of 1000 = 1%
      expect(record.genericCards).toBe(10);
      // record carries counts only — no row-level or group-level data
      expect(Object.keys(record).sort()).toEqual([
        'auditSourceSha256',
        'denominator',
        'dialect',
        'fraction',
        'generatedAt',
        'genericCards',
        'logicalCards',
        'schemaVersion',
        'source',
      ]);
    });
  });

  test('node above the configured ceiling fails closed', async () => {
    await withSandbox(ctx => {
      const db = new Database(ctx.dbPath);
      db.exec(FIXTURE_SCHEMA);
      const insert = db.prepare(
        `INSERT INTO remote_agent_workflow_node_messages
           (id, workflow_run_id, node_id, seq, kind, payload, metadata)
         VALUES (?, 'run-1', 'node-a', ?, 'tool', ?, NULL)`
      );
      for (let s = 1; s <= 6; s++) {
        insert.run(`m${s}`, s, JSON.stringify({ name: 'bash', id: `tu_${s}` }));
      }
      db.close();
      expect(() => auditSqlite(ctx.dbPath, { maxNodeToolRows: 5 })).toThrow(/tool-row ceiling/);
    });
  });

  test('access failure is an AuditDataError — never a fallback', async () => {
    await withSandbox(ctx => {
      const missing = join(ctx.root, 'does-not-exist.db');
      expect(() => auditSqlite(missing, { sourceId: 'gone' })).toThrow(AuditDataError);
      // and no fallback database file was created
      expect(existsSync(missing)).toBe(false);
      expect(readdirSync(ctx.root)).toEqual([]);
    });
  });
});

describe('record write + check', () => {
  function baseRecord(overrides: Partial<AuditRecord> = {}): AuditRecord {
    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      source: 'unit-test',
      dialect: 'sqlite',
      denominator: 'logical-tool-cards-v1',
      auditSourceSha256: computeAuditSourceSha256(REPO_ROOT),
      logicalCards: 100,
      genericCards: 1,
      fraction: 0.01,
      ...overrides,
    };
  }

  test('writeRecordAtomic writes a recomputable record that checkRecord accepts', async () => {
    await withSandbox(ctx => {
      const record = baseRecord();
      writeRecordAtomic(ctx.recordPath, record);
      expect(readdirSync(ctx.root)).toEqual(['record.json']);
      const checked = checkRecord(ctx.recordPath);
      expect(checked.logicalCards).toBe(100);
      expect(checked.genericCards).toBe(1);
    });
  });

  test('missing record fails the release check', async () => {
    await withSandbox(ctx => {
      expect(() => checkRecord(join(ctx.root, 'absent.json'))).toThrow(AuditPolicyError);
    });
  });

  test('stale record fails', async () => {
    await withSandbox(ctx => {
      const stale = baseRecord({ generatedAt: new Date(Date.now() - 120 * 86400e3).toISOString() });
      writeFileSync(ctx.recordPath, JSON.stringify(stale));
      expect(() => checkRecord(ctx.recordPath)).toThrow(/days old/);
    });
  });

  test('future-dated record fails', async () => {
    await withSandbox(ctx => {
      const future = baseRecord({ generatedAt: new Date(Date.now() + 3600e3).toISOString() });
      writeFileSync(ctx.recordPath, JSON.stringify(future));
      expect(() => checkRecord(ctx.recordPath)).toThrow(/future/);
    });
  });

  test('hash-mismatched record fails', async () => {
    await withSandbox(ctx => {
      const bad = baseRecord({ auditSourceSha256: '0'.repeat(64) });
      writeFileSync(ctx.recordPath, JSON.stringify(bad));
      expect(() => checkRecord(ctx.recordPath)).toThrow(/auditSourceSha256 mismatch/);
    });
  });

  test('malformed record fails', async () => {
    await withSandbox(ctx => {
      writeFileSync(ctx.recordPath, '{not json');
      expect(() => checkRecord(ctx.recordPath)).toThrow(AuditPolicyError);
      writeFileSync(ctx.recordPath, JSON.stringify({ schemaVersion: 99 }));
      expect(() => checkRecord(ctx.recordPath)).toThrow(AuditPolicyError);
    });
  });

  test('zero-card record fails', async () => {
    await withSandbox(ctx => {
      const zero = baseRecord({ logicalCards: 0, genericCards: 0, fraction: 0 });
      writeFileSync(ctx.recordPath, JSON.stringify(zero));
      expect(() => checkRecord(ctx.recordPath)).toThrow(/zero logical tool cards/);
    });
  });

  test('fraction disagreement is rejected', async () => {
    await withSandbox(ctx => {
      const lie = baseRecord({ fraction: 0.001 });
      writeFileSync(ctx.recordPath, JSON.stringify(lie));
      expect(() => checkRecord(ctx.recordPath)).toThrow(/fraction disagrees/);
    });
  });

  test('record at exactly 2% fails the gate', async () => {
    await withSandbox(ctx => {
      const edge = baseRecord({ logicalCards: 50, genericCards: 1, fraction: 0.02 });
      writeFileSync(ctx.recordPath, JSON.stringify(edge));
      expect(() => checkRecord(ctx.recordPath)).toThrow(/release gate failed/);
    });
  });
});

describe('CLI contract (subprocess)', () => {
  test('import performs no argument parsing, connection, output, or file writes', async () => {
    await withSandbox(async ctx => {
      const proc = Bun.spawn(['bun', '-e', `await import(${JSON.stringify(SCRIPT)}); `], {
        cwd: ctx.root,
        env: scrubbedEnv(),
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      expect(exitCode).toBe(0);
      expect(stdout).toBe('');
      expect(stderr).toBe('');
      expect(readdirSync(ctx.root)).toEqual([]);
    });
  });

  test('no corpus argument is an invocation error — no implicit target', async () => {
    await withSandbox(async ctx => {
      const env = scrubbedEnv({
        ARCHON_HOME: ctx.root, // even if set, must not be consulted
        DATABASE_URL: 'postgres://unused:unused@localhost:1/unused',
      });
      const result = await runCli([], ctx.root, env);
      expect(result.exitCode).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('no corpus specified');
      expect(readdirSync(ctx.root)).toEqual([]);
    });
  });

  test('default invocation prints the record only — no file writes', async () => {
    await withSandbox(async ctx => {
      createFixture(ctx.dbPath, [
        callRow(1, 'bash', 'tu_1', { command: 'ls' }),
        resultRow(2, 'bash', 'tu_1', { command: 'ls' }, { stdout: 'x' }),
      ]);
      const result = await runCli(['--sqlite', ctx.dbPath, '--source', 'cli'], ctx.root);
      expect(result.exitCode).toBe(0);
      const printed = JSON.parse(result.stdout) as AuditRecord;
      expect(printed.logicalCards).toBe(1);
      expect(printed.dialect).toBe('sqlite');
      // Only the fixture exists — nothing was written.
      expect(readdirSync(ctx.root)).toEqual(['corpus.db']);
    });
  });

  test('--record writes atomically and --check validates it', async () => {
    await withSandbox(async ctx => {
      createFixture(ctx.dbPath, [
        callRow(1, 'bash', 'tu_1', { command: 'ls' }),
        resultRow(2, 'bash', 'tu_1', { command: 'ls' }, { stdout: 'x' }),
      ]);
      const written = await runCli(
        ['--sqlite', ctx.dbPath, '--source', 'cli', '--record', ctx.recordPath],
        ctx.root
      );
      expect(written.exitCode).toBe(0);
      expect(existsSync(ctx.recordPath)).toBe(true);
      // no temp-file litter
      expect(readdirSync(ctx.root).sort()).toEqual(['corpus.db', 'record.json']);
      const checked = await runCli(['--check', ctx.recordPath], ctx.root);
      expect(checked.exitCode).toBe(0);
      expect(checked.stdout).toContain('audit record OK');
    });
  });

  test('--record requires --source', async () => {
    await withSandbox(async ctx => {
      createFixture(ctx.dbPath, [callRow(1, 'bash', 'tu_1')]);
      const result = await runCli(['--sqlite', ctx.dbPath, '--record', ctx.recordPath], ctx.root);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('--record requires --source');
      expect(existsSync(ctx.recordPath)).toBe(false);
    });
  });

  test('--check never opens a database and rejects audit flags', async () => {
    await withSandbox(async ctx => {
      writeFileSync(ctx.recordPath, '{bad json');
      const badRecord = await runCli(['--check', ctx.recordPath], ctx.root);
      expect(badRecord.exitCode).toBe(1);
      // --check combined with a corpus flag is an invocation error
      const combined = await runCli(['--check', ctx.recordPath, '--sqlite', ctx.dbPath], ctx.root);
      expect(combined.exitCode).toBe(2);
    });
  });

  test('missing corpus is a data/access failure, not a fallback', async () => {
    await withSandbox(async ctx => {
      const result = await runCli(
        ['--sqlite', join(ctx.root, 'absent.db'), '--source', 'x'],
        ctx.root,
        scrubbedEnv({ DATABASE_URL: 'postgres://unused@localhost:1/unused' })
      );
      expect(result.exitCode).toBe(3);
      expect(result.stderr).toContain('cannot open the SQLite corpus read-only');
      expect(readdirSync(ctx.root)).toEqual([]);
    });
  });

  test('threshold-breaching corpus exits policy on live audit', async () => {
    await withSandbox(async ctx => {
      const rows: FixtureRow[] = [];
      for (let i = 0; i < 50; i++) {
        rows.push({
          id: `g${i}`,
          seq: i + 1,
          payload: { name: i === 0 ? 'frobnicate' : 'bash', id: `tu_${i}` },
          metadata: { tool_phase: 'call' },
        });
      }
      createFixture(ctx.dbPath, rows);
      const result = await runCli(['--sqlite', ctx.dbPath, '--source', 'x'], ctx.root);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('release gate would fail');
    });
  });
});

describe('auditPostgres', () => {
  const pgTest = PG_TEST_URL !== undefined && PG_TEST_URL.length > 0 ? test : test.skip;

  async function withPgFixture(body: (url: string) => Promise<void>): Promise<void> {
    const { SQL } = await import('bun');
    const admin = new SQL(PG_TEST_URL as string);
    const dbName = `archon_audit_test_${process.pid}_${Date.now()}`;
    try {
      await admin.unsafe(`CREATE DATABASE ${dbName}`);
      const url = new URL(PG_TEST_URL as string);
      url.pathname = `/${dbName}`;
      const conn = new SQL(url.toString());
      await conn.unsafe(`
        CREATE TABLE remote_agent_workflow_node_messages (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          workflow_run_id UUID NOT NULL,
          node_id VARCHAR(255) NOT NULL,
          seq INTEGER NOT NULL CHECK (seq >= 1),
          kind VARCHAR(16) NOT NULL,
          payload JSONB NOT NULL,
          metadata JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (workflow_run_id, node_id, seq)
        )`);
      await conn.unsafe(
        `INSERT INTO remote_agent_workflow_node_messages
           (workflow_run_id, node_id, seq, kind, payload, metadata) VALUES
         ('11111111-1111-1111-1111-111111111111', 'node-a', 1, 'tool',
          '{"name":"bash","id":"tu_1","input":{"command":"ls"}}', '{"tool_phase":"call"}'),
         ('11111111-1111-1111-1111-111111111111', 'node-a', 2, 'tool',
          '{"name":"bash","id":"tu_1","input":{"command":"ls"},"output":{"stdout":"x"}}', '{"tool_phase":"result"}'),
         ('11111111-1111-1111-1111-111111111111', 'node-a', 3, 'tool',
          '{"name":"frobnicate","id":"tu_9","input":{},"output":{"o":1}}', NULL),
         ('11111111-1111-1111-1111-111111111111', 'node-a', 4, 'text', '{"text":"hi"}', NULL)`
      );
      await conn.close();
      await body(url.toString());
    } finally {
      await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await admin.close();
    }
  }

  pgTest('audits a PostgreSQL corpus inside a read-only transaction', async () => {
    await withPgFixture(async url => {
      const record = await auditPostgres(url, { pageSize: 1, sourceId: 'pg' });
      expect(record.logicalCards).toBe(2);
      expect(record.genericCards).toBe(1);
      expect(record.dialect).toBe('postgresql');
    });
  });

  pgTest('the read-only transaction cannot write', async () => {
    await withPgFixture(async url => {
      const { SQL } = await import('bun');
      const sql = new SQL(url);
      try {
        await sql.begin(async tx => {
          const runner = tx as unknown as { unsafe(q: string): Promise<unknown> };
          await runner.unsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
          let threw = false;
          try {
            await runner.unsafe(
              `INSERT INTO remote_agent_workflow_node_messages (workflow_run_id, node_id, seq, kind, payload) VALUES ('11111111-1111-1111-1111-111111111111','n',9,'tool','{}')`
            );
          } catch {
            threw = true;
          }
          expect(threw).toBe(true);
        });
      } finally {
        await sql.close();
      }
    });
  });
});

describe('parseArgs', () => {
  test('parses documented flags', () => {
    const args = parseArgs([
      '--sqlite',
      'x.db',
      '--source',
      'ci',
      '--record',
      'out.json',
      '--include-generic-names',
    ]);
    expect(args.sqlitePath).toBe('x.db');
    expect(args.sourceId).toBe('ci');
    expect(args.recordPath).toBe('out.json');
    expect(args.includeGenericNames).toBe(true);
  });
});
