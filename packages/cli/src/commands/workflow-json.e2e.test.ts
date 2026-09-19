import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  rmSync,
  readdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  statSync,
  mkdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Database } from 'bun:sqlite';

// RED-PHASE E2E SCAFFOLD (EXECUTABLE) — Story 3.3b "Provide Archon Start And
// Status CLI JSON". First-party consumer surface: a real controller (Hermes)
// invokes `archon workflow run <name> [message] --json` / `archon workflow
// get <run-id> --json` as a subprocess and parses stdout. Mirrors
// provider-binding.e2e.test.ts's real-subprocess `runCli()` harness — the
// harness (cli.ts, Bun) already exists, so these run the REAL CLI entry
// point rather than importing `./workflow` or `./cli` directly.
//
// Every test below drives cli.ts genuinely (no `test.skip()`): the dispatch
// route already exists (`case 'workflow': switch (subcommand) { case 'run':
// ... case 'get': ... }`), so these fail for real against TODAY's plain-text
// usage errors / legacy `{ok:false}` JSON, not vacuously. Verified manually
// before writing (see story research): `workflow run --json` with a missing
// name prints "Usage: ..." to stderr and exits 1 with EMPTY stdout;
// `workflow get <uuid> --json` for a not-found run prints the legacy
// `{ok:false, runId, error:'not_found'}` shape with no `correlationId`.

const CLI_ENTRY = join(import.meta.dir, '..', 'cli.ts');
const CLI_PROCESS_TIMEOUT_MS = 20_000;

// Leave enough headroom for SQLite's 5s busy timeout and startup under package-parallel load.
setDefaultTimeout(30_000);

let isolatedHome: string;
let isolatedRepo: string;
let isolatedRetryProofRepo: string;

beforeAll(async () => {
  isolatedHome = mkdtempSync(join(tmpdir(), 'archon-workflow-json-e2e-'));
  isolatedRepo = mkdtempSync(join(tmpdir(), 'archon-workflow-json-repo-'));
  isolatedRetryProofRepo = mkdtempSync(join(tmpdir(), 'archon-retry-proof-repo-'));
  execFileSync('git', ['init', isolatedRepo], { stdio: 'ignore' });
  execFileSync('git', ['init', isolatedRetryProofRepo], { stdio: 'ignore' });
  await initializeIsolatedDatabase();
});

afterAll(async () => {
  await Promise.all([
    removeTestDirectory(isolatedHome),
    removeTestDirectory(isolatedRepo),
    removeTestDirectory(isolatedRetryProofRepo),
  ]);
});

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function removeTestDirectory(path: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt === 49 || (code !== 'EBUSY' && code !== 'EPERM' && code !== 'ENOTEMPTY')) {
        throw error;
      }
      await Bun.sleep(100);
    }
  }
}

async function runCli(args: string[], cwd: string = isolatedRepo): Promise<CliResult> {
  const childEnv: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ARCHON_HOME: isolatedHome,
  };
  delete childEnv.DATABASE_URL;
  // Avoid Bun's FORCE_COLOR/NO_COLOR conflict warning leaking into stderr and
  // breaking --json envelope purity assertions under agent/CI environments.
  delete childEnv.FORCE_COLOR;
  childEnv.NO_COLOR = '1';
  const proc = Bun.spawn(['bun', CLI_ENTRY, ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: childEnv,
    timeout: CLI_PROCESS_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

async function initializeIsolatedDatabase(): Promise<void> {
  // `workflow list` does not touch the database. Initialize the isolated SQLite
  // schema explicitly so focused `-t` runs cannot depend on an earlier test
  // happening to issue a DB-backed command first.
  const initialized = await runCli(['workflow', 'runs', '--all', '--json']);
  expect(initialized.exitCode).toBe(0);
  expect(JSON.parse(initialized.stdout) as Record<string, unknown>).toHaveProperty('runs');

  const db = new Database(join(isolatedHome, 'archon.db'), { readonly: true });
  try {
    const table = db
      .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get('remote_agent_workflow_runs') as { name: string } | undefined;
    expect(table?.name).toBe('remote_agent_workflow_runs');
  } finally {
    db.close();
  }
}

function parseSoleJsonLine(stdout: string): Record<string, unknown> {
  const lines = stdout.trim().split('\n').filter(Boolean);
  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0] as string) as Record<string, unknown>;
}

function openWriteDatabase(): Database {
  const db = new Database(join(isolatedHome, 'archon.db'));
  db.run('PRAGMA busy_timeout = 5000');
  return db;
}

async function seedFailedRun(
  runId: string,
  workingPath: string,
  workflowName: string = 'test-workflow'
): Promise<void> {
  const db = openWriteDatabase();
  try {
    db.run('PRAGMA foreign_keys = OFF');
    db.run(
      `INSERT OR IGNORE INTO remote_agent_conversations (id, platform_type, platform_conversation_id)
       VALUES ('seed-conv-e2e', 'cli', 'seed-conv-e2e')`
    );
    db.run(
      `INSERT INTO remote_agent_workflow_runs (id, conversation_id, workflow_name, user_message, status, working_path, metadata)
       VALUES (?, 'seed-conv-e2e', ?, 'seed failed run', 'failed', ?, '{}')`,
      [runId, workflowName, workingPath]
    );
  } finally {
    db.close();
  }
}

async function seedRunWithStatus(
  runId: string,
  workingPath: string,
  status: string
): Promise<void> {
  const db = openWriteDatabase();
  try {
    db.run('PRAGMA foreign_keys = OFF');
    db.run(
      `INSERT OR IGNORE INTO remote_agent_conversations (id, platform_type, platform_conversation_id)
       VALUES ('seed-conv-e2e', 'cli', 'seed-conv-e2e')`
    );
    db.run(
      `INSERT INTO remote_agent_workflow_runs (id, conversation_id, workflow_name, user_message, status, working_path, metadata)
       VALUES (?, 'seed-conv-e2e', 'test-workflow', 'seed run', ?, ?, '{}')`,
      [runId, status, workingPath]
    );
  } finally {
    db.close();
  }
}

function isSqliteBusyError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'SQLITE_BUSY';
}

function queryRunStatus(runId: string): string | null {
  const db = new Database(join(isolatedHome, 'archon.db'), { readonly: true });
  try {
    const row = db
      .query('SELECT status FROM remote_agent_workflow_runs WHERE id = ?')
      .get(runId) as { status: string } | undefined;
    return row?.status ?? null;
  } catch (error) {
    if (isSqliteBusyError(error)) return null;
    throw error;
  } finally {
    db.close();
  }
}

function queryEventCount(runId: string): number {
  const db = new Database(join(isolatedHome, 'archon.db'), { readonly: true });
  try {
    const row = db
      .query('SELECT COUNT(*) as cnt FROM remote_agent_workflow_events WHERE workflow_run_id = ?')
      .get(runId) as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  } catch (error) {
    if (isSqliteBusyError(error)) return 0;
    throw error;
  } finally {
    db.close();
  }
}

function seedNodeEvent(
  runId: string,
  eventType: 'node_completed' | 'node_failed',
  nodeId: string,
  data: Record<string, unknown>
): void {
  const db = openWriteDatabase();
  try {
    db.run(
      `INSERT INTO remote_agent_workflow_events (workflow_run_id, event_type, step_name, data)
       VALUES (?, ?, ?, ?)`,
      [runId, eventType, nodeId, JSON.stringify(data)]
    );
  } finally {
    db.close();
  }
}

function queryNodeEventCount(runId: string, eventType: string, nodeId: string): number {
  const db = new Database(join(isolatedHome, 'archon.db'), { readonly: true });
  try {
    const row = db
      .query(
        `SELECT COUNT(*) as cnt FROM remote_agent_workflow_events
         WHERE workflow_run_id = ? AND event_type = ? AND step_name = ?`
      )
      .get(runId, eventType, nodeId) as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  } catch (error) {
    if (isSqliteBusyError(error)) return 0;
    throw error;
  } finally {
    db.close();
  }
}

function queryLatestNodeOutput(runId: string, nodeId: string): string | null {
  const db = new Database(join(isolatedHome, 'archon.db'), { readonly: true });
  try {
    const row = db
      .query(
        `SELECT data FROM remote_agent_workflow_events
         WHERE workflow_run_id = ? AND event_type = 'node_completed' AND step_name = ?
         ORDER BY created_at DESC, event_order DESC
         LIMIT 1`
      )
      .get(runId, nodeId) as { data: string } | undefined;
    if (!row?.data) return null;
    const parsed = JSON.parse(row.data) as { node_output?: unknown };
    return typeof parsed.node_output === 'string' ? parsed.node_output : null;
  } catch (error) {
    if (isSqliteBusyError(error)) return null;
    throw error;
  } finally {
    db.close();
  }
}

function installWorkflowFixture(
  repoPath: string,
  fileName: string,
  yaml: string,
  commitMessage: string
): void {
  const relativePath = `.archon/workflows/${fileName}`;
  mkdirSync(join(repoPath, '.archon', 'workflows'), { recursive: true });
  writeFileSync(join(repoPath, relativePath), yaml);
  execFileSync('git', ['-C', repoPath, 'config', 'user.email', 'proof@example.invalid']);
  execFileSync('git', ['-C', repoPath, 'config', 'user.name', 'Archon Proof']);
  execFileSync('git', ['-C', repoPath, 'add', relativePath]);
  execFileSync('git', ['-C', repoPath, 'commit', '-m', commitMessage], { stdio: 'ignore' });
}

function queryRunMetadata(runId: string): Record<string, unknown> | null {
  const dbPath = join(isolatedHome, 'archon.db');
  const db = new Database(dbPath);
  try {
    const row = db
      .query('SELECT metadata FROM remote_agent_workflow_runs WHERE id = ?')
      .get(runId) as { metadata: string } | undefined;
    return row?.metadata ? JSON.parse(row.metadata) : null;
  } finally {
    db.close();
  }
}

function queryRunUpdatedAt(runId: string): string | null {
  const dbPath = join(isolatedHome, 'archon.db');
  const db = new Database(dbPath);
  try {
    const row = db
      .query('SELECT last_activity_at FROM remote_agent_workflow_runs WHERE id = ?')
      .get(runId) as { last_activity_at: string } | undefined;
    return row?.last_activity_at ?? null;
  } finally {
    db.close();
  }
}

describe('workflow run/get --json CLI dispatch E2E — real subprocess (Story 3.3b)', () => {
  // 3.3B-CLI-031 [P0] R-003,RC-09,RC-10 — a missing `workflow run` name under
  // --json must become a `workflow.start` MALFORMED_REQUEST envelope with
  // exitCode 64, not today's plain "Usage: ..." stderr text + empty stdout.
  test('3.3B-CLI-031: `workflow run --json` with no name emits one MALFORMED_REQUEST envelope, exit 64', async () => {
    const { stdout, stderr, exitCode } = await runCli(['workflow', 'run', '--json']);

    expect(stdout.trim()).not.toBe('');
    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.start');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3B-CLI-032 [P0] R-003,R-009 — a mutually-exclusive flag combination
  // (--branch + --no-worktree) under --json must reach workflowRunCommand's
  // fail-closed boundary as a classified envelope, not cli.ts's plain-text
  // `console.error` shortcut that bypasses --json entirely today.
  test('3.3B-CLI-032: `workflow run <name> --branch x --no-worktree --json` emits one classified envelope, not a console.error shortcut', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'run',
      'archon-assist',
      '--branch',
      'x',
      '--no-worktree',
      '--json',
    ]);

    expect(stdout.trim()).not.toBe('');
    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3B-CLI-033 [P0] R-003,RC-09,RC-10 — a missing `workflow get` run id
  // under --json must become a `workflow.status` MALFORMED_REQUEST envelope
  // with exitCode 64, not today's plain "Usage: ..." stderr text.
  test('3.3B-CLI-033: `workflow get --json` with no run id emits one MALFORMED_REQUEST envelope, exit 64', async () => {
    const { stdout, stderr, exitCode } = await runCli(['workflow', 'get', '--json']);

    expect(stdout.trim()).not.toBe('');
    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.status');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3B-CLI-035 [P0] R-003,R-004,R-009 — an unknown workflow name under
  // --json must fail closed as ONE classified WORKFLOW_NOT_FOUND envelope
  // (exit 78), never today's uncaught rejection surfacing as a raw
  // "Error: Workflow '...' not found." line via cli.ts's generic catch.
  test('3.3B-CLI-035: unknown workflow name under --json emits one WORKFLOW_NOT_FOUND envelope, exit 78', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'run',
      'totally-nonexistent-workflow-story-3-3b',
      '--json',
    ]);

    expect(stdout.trim()).not.toBe('');
    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('WORKFLOW_NOT_FOUND');
    expect(error?.category).toBe('unexpected_state');
    expect(exitCode).toBe(78);
    expect(stderr).toBe('');
  });

  // 3.3B-CLI-034 [P1] R-010 — `--correlation-id` (already a registered
  // global parseArgs option since Story 3.1) is threaded through to both
  // `workflow run --json` and `workflow get --json` and echoed verbatim.
  describe('3.3B-CLI-034: --correlation-id argv threading', () => {
    test('is echoed on a `workflow run --json` failure envelope', async () => {
      const { stdout } = await runCli([
        'workflow',
        'run',
        'totally-nonexistent-workflow-story-3-3b',
        '--json',
        '--correlation-id',
        'corr-cli-034-run',
      ]);
      const envelope = parseSoleJsonLine(stdout);
      expect(envelope.correlationId).toBe('corr-cli-034-run');
    });

    test('is echoed on a `workflow get --json` not-found envelope', async () => {
      const { stdout } = await runCli([
        'workflow',
        'get',
        '00000000-0000-0000-0000-000000000000',
        '--json',
        '--correlation-id',
        'corr-cli-034-get',
      ]);
      const envelope = parseSoleJsonLine(stdout);
      // Today this is the legacy `{ok:false, runId, error:'not_found'}` shape
      // with no `correlationId` key at all — genuinely red, not a value
      // mismatch on a key that already exists.
      expect(envelope.correlationId).toBe('corr-cli-034-get');
    });
  });

  test('RF-35: `workflow run --json --correlation-id=` emits MALFORMED_REQUEST, not an internal or lookup error', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'run',
      'totally-nonexistent-workflow-story-3-3b',
      '--json',
      '--correlation-id=',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.start');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(error?.category).toBe('provider_contract');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  test('RF-35: `workflow get --json --correlation-id=` emits MALFORMED_REQUEST, not an internal error', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'get',
      '00000000-0000-0000-0000-000000000000',
      '--json',
      '--correlation-id=',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.status');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(error?.category).toBe('provider_contract');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  test('RF-36: `workflow run --json=true` emits a malformed-request envelope', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'run',
      'archon-assist',
      '--json=true',
      '--correlation-id',
      'corr-rf-36-run',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.start');
    expect(envelope.success).toBe(false);
    expect(envelope.correlationId).toBe('corr-rf-36-run');
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(error?.category).toBe('provider_contract');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  test('RF-36: `workflow run --json=true` without a supplied correlation id still emits one malformed-request envelope', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'run',
      'archon-assist',
      '--json=true',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.start');
    expect(envelope.success).toBe(false);
    expect(typeof envelope.correlationId).toBe('string');
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(error?.category).toBe('provider_contract');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  test('RF-40: `workflow get --json=true` emits a malformed-request envelope', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'get',
      '00000000-0000-0000-0000-000000000000',
      '--json=true',
      '--correlation-id',
      'corr-rf-40-get',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.status');
    expect(envelope.success).toBe(false);
    expect(envelope.correlationId).toBe('corr-rf-40-get');
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(error?.category).toBe('provider_contract');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  test('RF-41: bare `--correlation-id` cannot consume `--json` and bypass the get envelope path', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'get',
      '00000000-0000-0000-0000-000000000000',
      '--correlation-id',
      '--json',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.status');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(error?.category).toBe('provider_contract');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  test('RF-41: bare `--correlation-id` cannot consume `--json` and bypass the run envelope path', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'run',
      'archon-assist',
      '--correlation-id',
      '--json',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.start');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(error?.category).toBe('provider_contract');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  test('RF-44: `--json=true` after `--` stays positional and does not emit a workflow.start envelope', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'run',
      'totally-nonexistent-workflow-story-3-3b',
      '--',
      '--json=true',
    ]);

    expect(exitCode).toBe(1);
    expect(stdout).not.toContain('workflow-command-envelope.v1');
    expect(stdout).not.toContain('"command":"workflow.start"');
    expect(stderr).toContain("Workflow 'totally-nonexistent-workflow-story-3-3b' not found.");
  });

  test('RF-34: git-preflight JSON fallback does not emit workflow.start for unrelated workflow JSON commands', async () => {
    const nonGitCwd = mkdtempSync(join(tmpdir(), 'archon-non-git-'));
    try {
      const { stdout, exitCode } = await runCli(['workflow', 'list', '--json'], nonGitCwd);

      expect(exitCode).not.toBe(0);
      if (stdout.trim().length > 0) {
        const envelope = parseSoleJsonLine(stdout);
        expect(envelope.command).not.toBe('workflow.start');
      } else {
        expect(stdout).not.toContain('workflow.start');
      }
    } finally {
      rmSync(nonGitCwd, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// RED-PHASE E2E SCAFFOLD — Story 3.3c "Provide Archon Provider Decision
// Command CLI JSON". First-party consumer surface: a real controller (Hermes)
// invokes `archon workflow approve <run-id> --json` / `archon workflow reject
// <run-id> --json` as a subprocess and parses stdout.
//
// Tests below drive the REAL CLI entry point (cli.ts) as a subprocess.
// Currently genuinely red: today's `workflow approve --json` with a missing
// run-id prints "Usage: ..." to stderr and exits 1 (no MALFORMED_REQUEST
// envelope), and `workflow reject --json` behaves the same.
//
// ACTIVATION: getWorkflowCommandEnvelopeCommand in cli.ts must map
// 'approve' → 'workflow.approve' and 'reject' → 'workflow.reject', and
// the missing-run-id handler must emit a MALFORMED_REQUEST envelope in
// JSON mode.
// ---------------------------------------------------------------------------

describe('workflow approve/reject --json CLI dispatch E2E — real subprocess (Story 3.3c)', () => {
  // 3.3C-CLI-001 [P0] AC #2 — missing run-id on approve --json
  test('3.3C-CLI-001: `workflow approve --json` with no run-id emits one MALFORMED_REQUEST envelope, exit 64', async () => {
    const { stdout, stderr, exitCode } = await runCli(['workflow', 'approve', '--json']);

    expect(stdout.trim()).not.toBe('');
    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.approve');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    const details = error?.details as Record<string, unknown> | undefined;
    expect(details?.missingArgument).toBe('run-id');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3C-CLI-002 [P0] AC #2 — missing run-id on reject --json
  test('3.3C-CLI-002: `workflow reject --json` with no run-id emits one MALFORMED_REQUEST envelope, exit 64', async () => {
    const { stdout, stderr, exitCode } = await runCli(['workflow', 'reject', '--json']);

    expect(stdout.trim()).not.toBe('');
    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.reject');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    const details = error?.details as Record<string, unknown> | undefined;
    expect(details?.missingArgument).toBe('run-id');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3C-CLI-003 [P1] AC #2 — correlation-id threaded on approve --json
  test('3.3C-CLI-003: --correlation-id is echoed on a `workflow approve --json` envelope', async () => {
    const { stdout } = await runCli([
      'workflow',
      'approve',
      '00000000-0000-0000-0000-000000000000',
      '--json',
      '--correlation-id',
      'corr-cli-003-approve',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.correlationId).toBe('corr-cli-003-approve');
  });

  // 3.3C-CLI-004 [P1] AC #2 — correlation-id threaded on reject --json
  test('3.3C-CLI-004: --correlation-id is echoed on a `workflow reject --json` envelope', async () => {
    const { stdout } = await runCli([
      'workflow',
      'reject',
      '00000000-0000-0000-0000-000000000000',
      'some reason',
      '--json',
      '--correlation-id',
      'corr-cli-004-reject',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.correlationId).toBe('corr-cli-004-reject');
  });

  // 3.3C-CLI-005 [P0] AC #2 — blank correlation-id on approve emits MALFORMED_REQUEST
  test('3.3C-CLI-005: `workflow approve --json --correlation-id=` emits MALFORMED_REQUEST', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'approve',
      '00000000-0000-0000-0000-000000000000',
      '--json',
      '--correlation-id=',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.approve');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(error?.category).toBe('provider_contract');
    const details005 = error?.details as Record<string, unknown> | undefined;
    const fieldErrors005 = details005?.fieldErrors as Array<Record<string, unknown>> | undefined;
    expect(fieldErrors005).toBeDefined();
    expect(fieldErrors005).toContainEqual({ path: '/correlationId', code: 'required' });
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3C-CLI-006 [P0] AC #2 — blank correlation-id on reject emits MALFORMED_REQUEST
  test('3.3C-CLI-006: `workflow reject --json --correlation-id=` emits MALFORMED_REQUEST', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'reject',
      '00000000-0000-0000-0000-000000000000',
      'reason',
      '--json',
      '--correlation-id=',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.reject');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(error?.category).toBe('provider_contract');
    const details006 = error?.details as Record<string, unknown> | undefined;
    const fieldErrors006 = details006?.fieldErrors as Array<Record<string, unknown>> | undefined;
    expect(fieldErrors006).toBeDefined();
    expect(fieldErrors006).toContainEqual({ path: '/correlationId', code: 'required' });
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3C-CLI-007 [P1] AC #2 — invalid JSON flag (--json=true) on approve
  test('3.3C-CLI-007: `workflow approve --json=true` emits MALFORMED_REQUEST envelope', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'approve',
      '00000000-0000-0000-0000-000000000000',
      '--json=true',
      '--correlation-id',
      'corr-cli-007',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.approve');
    expect(envelope.success).toBe(false);
    expect(envelope.correlationId).toBe('corr-cli-007');
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(error?.category).toBe('provider_contract');
    const details007 = error?.details as Record<string, unknown> | undefined;
    const fieldErrors007 = details007?.fieldErrors as Array<Record<string, unknown>> | undefined;
    expect(fieldErrors007).toBeDefined();
    expect(fieldErrors007).toContainEqual({ path: '/json', code: 'must_be_boolean_flag' });
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3C-CLI-008 [P1] AC #2 — invalid JSON flag (--json=true) on reject
  test('3.3C-CLI-008: `workflow reject --json=true` emits MALFORMED_REQUEST envelope', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'reject',
      '00000000-0000-0000-0000-000000000000',
      'reason',
      '--json=true',
      '--correlation-id',
      'corr-cli-008',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.reject');
    expect(envelope.success).toBe(false);
    expect(envelope.correlationId).toBe('corr-cli-008');
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(error?.category).toBe('provider_contract');
    const details008 = error?.details as Record<string, unknown> | undefined;
    const fieldErrors008 = details008?.fieldErrors as Array<Record<string, unknown>> | undefined;
    expect(fieldErrors008).toBeDefined();
    expect(fieldErrors008).toContainEqual({ path: '/json', code: 'must_be_boolean_flag' });
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3C-CLI-009 [P1] — bare --correlation-id consuming --json on approve
  test('3.3C-CLI-009: bare `--correlation-id` cannot consume `--json` and bypass the approve envelope path', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'approve',
      '00000000-0000-0000-0000-000000000000',
      '--correlation-id',
      '--json',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.approve');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(error?.category).toBe('provider_contract');
    const details009 = error?.details as Record<string, unknown> | undefined;
    const fieldErrors009 = details009?.fieldErrors as Array<Record<string, unknown>> | undefined;
    expect(fieldErrors009).toBeDefined();
    expect(fieldErrors009).toContainEqual({ path: '/correlationId', code: 'required' });
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3C-CLI-010 [P1] — bare --correlation-id consuming --json on reject
  test('3.3C-CLI-010: bare `--correlation-id` cannot consume `--json` and bypass the reject envelope path', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'reject',
      '00000000-0000-0000-0000-000000000000',
      'reason',
      '--correlation-id',
      '--json',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.reject');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(error?.category).toBe('provider_contract');
    const details010 = error?.details as Record<string, unknown> | undefined;
    const fieldErrors010 = details010?.fieldErrors as Array<Record<string, unknown>> | undefined;
    expect(fieldErrors010).toBeDefined();
    expect(fieldErrors010).toContainEqual({ path: '/correlationId', code: 'required' });
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3C-CLI-011 [P0] — not-a-git-repo emits envelope (inherited from cli.ts guard)
  test('3.3C-CLI-011: `workflow approve --json` from a non-git directory emits MALFORMED_REQUEST', async () => {
    const nonGitCwd = mkdtempSync(join(tmpdir(), 'archon-non-git-3c-'));
    try {
      const { stdout, stderr, exitCode } = await runCli(
        ['workflow', 'approve', '00000000-0000-0000-0000-000000000000', '--json'],
        nonGitCwd
      );

      expect(stdout.trim()).not.toBe('');
      const envelope = parseSoleJsonLine(stdout);
      expect(envelope.command).toBe('workflow.approve');
      expect(envelope.success).toBe(false);
      const error = envelope.error as Record<string, unknown> | undefined;
      expect(error?.code).toBe('MALFORMED_REQUEST');
      const details011 = error?.details as Record<string, unknown> | undefined;
      const fieldErrors011 = details011?.fieldErrors as Array<Record<string, unknown>> | undefined;
      expect(fieldErrors011).toBeDefined();
      expect(fieldErrors011?.length).toBeGreaterThanOrEqual(1);
      expect(fieldErrors011).toContainEqual({ path: '/cwd', code: 'not_a_git_repository' });
      expect(exitCode).toBe(64);
      expect(stderr).toBe('');
    } finally {
      rmSync(nonGitCwd, { recursive: true, force: true });
    }
  });

  // 3.3C-CLI-014 [P0] — reject from non-git directory emits envelope (RF-09, RF-11)
  test('3.3C-CLI-014: `workflow reject --json` from a non-git directory emits MALFORMED_REQUEST with /cwd field error', async () => {
    const nonGitCwd = mkdtempSync(join(tmpdir(), 'archon-non-git-3c-rj-'));
    try {
      const { stdout, stderr, exitCode } = await runCli(
        ['workflow', 'reject', '00000000-0000-0000-0000-000000000000', 'reason', '--json'],
        nonGitCwd
      );

      expect(stdout.trim()).not.toBe('');
      const envelope = parseSoleJsonLine(stdout);
      expect(envelope.command).toBe('workflow.reject');
      expect(envelope.success).toBe(false);
      const error = envelope.error as Record<string, unknown> | undefined;
      expect(error?.code).toBe('MALFORMED_REQUEST');
      const details = error?.details as Record<string, unknown> | undefined;
      const fieldErrors = details?.fieldErrors as Array<Record<string, unknown>> | undefined;
      expect(fieldErrors).toBeDefined();
      expect(fieldErrors?.length).toBeGreaterThanOrEqual(1);
      expect(fieldErrors).toContainEqual({ path: '/cwd', code: 'not_a_git_repository' });
      expect(exitCode).toBe(64);
      expect(stderr).toBe('');
    } finally {
      rmSync(nonGitCwd, { recursive: true, force: true });
    }
  });

  // 3.3C-CLI-012 [P0] — nonexistent --cwd emits envelope (inherited from cli.ts guard)
  test('3.3C-CLI-012: `workflow approve --json --cwd /nonexistent` emits MALFORMED_REQUEST', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'approve',
      '00000000-0000-0000-0000-000000000000',
      '--json',
      '--cwd',
      '/nonexistent-dir-archon-e2e',
    ]);

    expect(stdout.trim()).not.toBe('');
    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.approve');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    const details012 = error?.details as Record<string, unknown> | undefined;
    const fieldErrors012 = details012?.fieldErrors as Array<Record<string, unknown>> | undefined;
    expect(fieldErrors012).toBeDefined();
    expect(fieldErrors012).toContainEqual({ path: '/cwd', code: 'directory_not_found' });
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3C-CLI-013 [P0] — nonexistent --cwd emits envelope for reject too
  test('3.3C-CLI-013: `workflow reject --json --cwd /nonexistent` emits MALFORMED_REQUEST', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'reject',
      '00000000-0000-0000-0000-000000000000',
      'reason',
      '--json',
      '--cwd',
      '/nonexistent-dir-archon-e2e',
    ]);

    expect(stdout.trim()).not.toBe('');
    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.reject');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    const details013 = error?.details as Record<string, unknown> | undefined;
    const fieldErrors013 = details013?.fieldErrors as Array<Record<string, unknown>> | undefined;
    expect(fieldErrors013).toBeDefined();
    expect(fieldErrors013).toContainEqual({ path: '/cwd', code: 'directory_not_found' });
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });
});

// ---------------------------------------------------------------------------
// RED-PHASE E2E SCAFFOLD — Story 3.3d "Provide Archon Recovery Command CLI
// JSON". First-party consumer surface: a real controller (Hermes) invokes
// `archon workflow resume/retry/cancel <run-id> --json` as a subprocess and
// parses stdout.
//
// Tests below drive the REAL CLI entry point (cli.ts) as a subprocess.
// Resume tests are EXECUTABLE (today's `workflow resume --json` with a missing
// run-id prints usage text, not an envelope).
// Retry/cancel tests: `workflow retry` and `workflow cancel` subcommands do
// not exist yet, so the CLI dispatcher falls through to the default case
// (usage text + exit 1), not an envelope. These fail genuinely.
//
// ACTIVATION for retry/cancel: cli.ts switch must handle 'retry' and 'cancel'
// subcommands, getWorkflowCommandEnvelopeCommand must map them to
// 'workflow.retry' and 'workflow.cancel', and the missing-run-id pre-handler
// must emit a MALFORMED_REQUEST envelope in JSON mode.
// ---------------------------------------------------------------------------

describe('workflow resume/retry/cancel --json CLI dispatch E2E — real subprocess (Story 3.3d)', () => {
  // 3.3D-CLI-001 [P0] AC #1 — missing run-id on resume --json
  test('3.3D-CLI-001: `workflow resume --json` with no run-id emits one MALFORMED_REQUEST envelope, exit 64', async () => {
    const { stdout, stderr, exitCode } = await runCli(['workflow', 'resume', '--json']);

    expect(stdout.trim()).not.toBe('');
    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.resume');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    const details = error?.details as Record<string, unknown> | undefined;
    expect(details?.missingArgument).toBe('run-id');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-002 [P0] AC #1 — correlation-id threaded on resume --json
  test('3.3D-CLI-002: --correlation-id is echoed on a `workflow resume --json` envelope', async () => {
    const { stdout } = await runCli([
      'workflow',
      'resume',
      '00000000-0000-0000-0000-000000000000',
      '--json',
      '--correlation-id',
      'corr-cli-002-resume',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.correlationId).toBe('corr-cli-002-resume');
  });

  // 3.3D-CLI-003 [P0] AC #1 — blank correlation-id on resume emits MALFORMED_REQUEST
  test('3.3D-CLI-003: `workflow resume --json --correlation-id=` emits MALFORMED_REQUEST', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'resume',
      '00000000-0000-0000-0000-000000000000',
      '--json',
      '--correlation-id=',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.resume');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(error?.category).toBe('provider_contract');
    const details = error?.details as Record<string, unknown> | undefined;
    const fieldErrors = details?.fieldErrors as Array<Record<string, unknown>> | undefined;
    expect(fieldErrors).toContainEqual({ path: '/correlationId', code: 'required' });
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-004 [P1] AC #1 — invalid JSON flag (--json=true) on resume
  test('3.3D-CLI-004: `workflow resume --json=true` emits MALFORMED_REQUEST envelope', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'resume',
      '00000000-0000-0000-0000-000000000000',
      '--json=true',
      '--correlation-id',
      'corr-cli-004',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.resume');
    expect(envelope.success).toBe(false);
    expect(envelope.correlationId).toBe('corr-cli-004');
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(error?.category).toBe('provider_contract');
    const details = error?.details as Record<string, unknown> | undefined;
    const fieldErrors = details?.fieldErrors as Array<Record<string, unknown>> | undefined;
    expect(fieldErrors).toContainEqual({ path: '/json', code: 'must_be_boolean_flag' });
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-005 [P0] AC #1 — not-a-git-repo emits envelope for resume
  test('3.3D-CLI-005: `workflow resume --json` from a non-git directory emits MALFORMED_REQUEST', async () => {
    const nonGitCwd = mkdtempSync(join(tmpdir(), 'archon-non-git-3d-rs-'));
    try {
      const { stdout, stderr, exitCode } = await runCli(
        ['workflow', 'resume', '00000000-0000-0000-0000-000000000000', '--json'],
        nonGitCwd
      );

      expect(stdout.trim()).not.toBe('');
      const envelope = parseSoleJsonLine(stdout);
      expect(envelope.command).toBe('workflow.resume');
      expect(envelope.success).toBe(false);
      const error = envelope.error as Record<string, unknown> | undefined;
      expect(error?.code).toBe('MALFORMED_REQUEST');
      const details = error?.details as Record<string, unknown> | undefined;
      const fieldErrors = details?.fieldErrors as Array<Record<string, unknown>> | undefined;
      expect(fieldErrors).toContainEqual({ path: '/cwd', code: 'not_a_git_repository' });
      expect(exitCode).toBe(64);
      expect(stderr).toBe('');
    } finally {
      rmSync(nonGitCwd, { recursive: true, force: true });
    }
  });

  // 3.3D-CLI-006 [P0] AC #1 — nonexistent --cwd emits envelope for resume
  test('3.3D-CLI-006: `workflow resume --json --cwd /nonexistent` emits MALFORMED_REQUEST', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'resume',
      '00000000-0000-0000-0000-000000000000',
      '--json',
      '--cwd',
      '/nonexistent-dir-archon-3d',
    ]);

    expect(stdout.trim()).not.toBe('');
    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.resume');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    const details = error?.details as Record<string, unknown> | undefined;
    const fieldErrors = details?.fieldErrors as Array<Record<string, unknown>> | undefined;
    expect(fieldErrors).toContainEqual({ path: '/cwd', code: 'directory_not_found' });
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-007 [P0] AC #1 — resume with a not-found run-id emits UNEXPECTED_STATE
  test('3.3D-CLI-007: `workflow resume <unknown-uuid> --json` emits envelope with exit 78', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'resume',
      '00000000-0000-0000-0000-000000000000',
      '--json',
    ]);

    expect(stdout.trim()).not.toBe('');
    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('UNEXPECTED_STATE');
    expect(error?.category).toBe('unexpected_state');
    expect(exitCode).toBe(78);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-008 [P0] AC #2 — missing run-id on retry --json
  test('3.3D-CLI-008: `workflow retry --json` with no run-id emits one MALFORMED_REQUEST envelope, exit 64', async () => {
    const { stdout, stderr, exitCode } = await runCli(['workflow', 'retry', '--json']);

    expect(stdout.trim()).not.toBe('');
    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.retry');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    const details = error?.details as Record<string, unknown> | undefined;
    expect(details?.missingArgument).toBe('run-id');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-009 [P0] AC #4 — missing run-id on cancel --json
  test('3.3D-CLI-009: `workflow cancel --json` with no run-id emits one MALFORMED_REQUEST envelope, exit 64', async () => {
    const { stdout, stderr, exitCode } = await runCli(['workflow', 'cancel', '--json']);

    expect(stdout.trim()).not.toBe('');
    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.cancel');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    const details = error?.details as Record<string, unknown> | undefined;
    expect(details?.missingArgument).toBe('run-id');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-010 [P1] AC #2 — correlation-id threaded on retry --json
  test('3.3D-CLI-010: --correlation-id is echoed on a `workflow retry --json` envelope', async () => {
    const { stdout } = await runCli([
      'workflow',
      'retry',
      '00000000-0000-0000-0000-000000000000',
      '--json',
      '--correlation-id',
      'corr-cli-010-retry',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.correlationId).toBe('corr-cli-010-retry');
  });

  // 3.3D-CLI-011 [P1] AC #4 — correlation-id threaded on cancel --json
  test('3.3D-CLI-011: --correlation-id is echoed on a `workflow cancel --json` envelope', async () => {
    const { stdout } = await runCli([
      'workflow',
      'cancel',
      '00000000-0000-0000-0000-000000000000',
      '--json',
      '--correlation-id',
      'corr-cli-011-cancel',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.correlationId).toBe('corr-cli-011-cancel');
  });

  // 3.3D-CLI-012 [P0] AC #2 — blank correlation-id on retry emits MALFORMED_REQUEST
  test('3.3D-CLI-012: `workflow retry --json --correlation-id=` emits MALFORMED_REQUEST', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'retry',
      '00000000-0000-0000-0000-000000000000',
      '--json',
      '--correlation-id=',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.retry');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(error?.category).toBe('provider_contract');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-013 [P0] AC #4 — blank correlation-id on cancel emits MALFORMED_REQUEST
  test('3.3D-CLI-013: `workflow cancel --json --correlation-id=` emits MALFORMED_REQUEST', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'cancel',
      '00000000-0000-0000-0000-000000000000',
      '--json',
      '--correlation-id=',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.cancel');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(error?.category).toBe('provider_contract');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-014 [P1] AC #2 — invalid JSON flag (--json=true) on retry
  test('3.3D-CLI-014: `workflow retry --json=true` emits MALFORMED_REQUEST envelope', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'retry',
      '00000000-0000-0000-0000-000000000000',
      '--json=true',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.retry');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(error?.category).toBe('provider_contract');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-015 [P1] AC #4 — invalid JSON flag (--json=true) on cancel
  test('3.3D-CLI-015: `workflow cancel --json=true` emits MALFORMED_REQUEST envelope', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'cancel',
      '00000000-0000-0000-0000-000000000000',
      '--json=true',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.cancel');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(error?.category).toBe('provider_contract');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-016 [P0] — retry from non-git directory emits envelope
  test('3.3D-CLI-016: `workflow retry --json` from a non-git directory emits MALFORMED_REQUEST', async () => {
    const nonGitCwd = mkdtempSync(join(tmpdir(), 'archon-non-git-3d-rt-'));
    try {
      const { stdout, stderr, exitCode } = await runCli(
        ['workflow', 'retry', '00000000-0000-0000-0000-000000000000', '--json'],
        nonGitCwd
      );

      expect(stdout.trim()).not.toBe('');
      const envelope = parseSoleJsonLine(stdout);
      expect(envelope.command).toBe('workflow.retry');
      expect(envelope.success).toBe(false);
      const error = envelope.error as Record<string, unknown> | undefined;
      expect(error?.code).toBe('MALFORMED_REQUEST');
      const details = error?.details as Record<string, unknown> | undefined;
      const fieldErrors = details?.fieldErrors as Array<Record<string, unknown>> | undefined;
      expect(fieldErrors).toContainEqual({ path: '/cwd', code: 'not_a_git_repository' });
      expect(exitCode).toBe(64);
      expect(stderr).toBe('');
    } finally {
      rmSync(nonGitCwd, { recursive: true, force: true });
    }
  });

  // 3.3D-CLI-017 [P0] — cancel from non-git directory emits envelope
  test('3.3D-CLI-017: `workflow cancel --json` from a non-git directory emits MALFORMED_REQUEST', async () => {
    const nonGitCwd = mkdtempSync(join(tmpdir(), 'archon-non-git-3d-cn-'));
    try {
      const { stdout, stderr, exitCode } = await runCli(
        ['workflow', 'cancel', '00000000-0000-0000-0000-000000000000', '--json'],
        nonGitCwd
      );

      expect(stdout.trim()).not.toBe('');
      const envelope = parseSoleJsonLine(stdout);
      expect(envelope.command).toBe('workflow.cancel');
      expect(envelope.success).toBe(false);
      const error = envelope.error as Record<string, unknown> | undefined;
      expect(error?.code).toBe('MALFORMED_REQUEST');
      const details = error?.details as Record<string, unknown> | undefined;
      const fieldErrors = details?.fieldErrors as Array<Record<string, unknown>> | undefined;
      expect(fieldErrors).toContainEqual({ path: '/cwd', code: 'not_a_git_repository' });
      expect(exitCode).toBe(64);
      expect(stderr).toBe('');
    } finally {
      rmSync(nonGitCwd, { recursive: true, force: true });
    }
  });

  // 3.3D-CLI-018 [P0] — non-JSON `workflow retry` emits usage guidance (TD-009)
  test('3.3D-CLI-018: `workflow retry` without --json emits usage guidance pointing to retry-node', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'retry',
      '00000000-0000-0000-0000-000000000000',
    ]);

    const output = stdout + stderr;
    expect(output).toContain('retry-node');
    expect(exitCode).not.toBe(0);
    expect(stdout).not.toContain('workflow-command-envelope.v1');
  });

  // 3.3D-CLI-019 [P0] — non-JSON `workflow cancel` emits usage guidance (TD-009)
  test('3.3D-CLI-019: `workflow cancel` without --json emits dedicated usage guidance pointing to abandon', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'cancel',
      '00000000-0000-0000-0000-000000000000',
    ]);

    const output = stdout + stderr;
    // Must contain dedicated guidance text like "use `workflow abandon`", not
    // just "abandon" appearing in a generic "Available:" subcommand list.
    expect(output).toMatch(/use.*abandon|workflow abandon/i);
    expect(exitCode).not.toBe(0);
    expect(stdout).not.toContain('workflow-command-envelope.v1');
  });

  // 3.3D-CLI-020 [P1] — bare --correlation-id cannot consume --json on retry
  test('3.3D-CLI-020: bare `--correlation-id` cannot consume `--json` and bypass the retry envelope path', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'retry',
      '00000000-0000-0000-0000-000000000000',
      '--correlation-id',
      '--json',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.retry');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(error?.category).toBe('provider_contract');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-021 [P1] — bare --correlation-id cannot consume --json on cancel
  test('3.3D-CLI-021: bare `--correlation-id` cannot consume `--json` and bypass the cancel envelope path', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'cancel',
      '00000000-0000-0000-0000-000000000000',
      '--correlation-id',
      '--json',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.cancel');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(error?.category).toBe('provider_contract');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-022 [P0] R1-F14, R1-F34 — real-subprocess retry success envelope + worker spawn evidence
  test('3.3D-CLI-022: `workflow retry <failed-run> --json` emits a success envelope matching retry-success.json shape and creates a detached worker log', async () => {
    const runId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    await seedFailedRun(runId, isolatedRepo);

    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'retry',
      runId,
      '--json',
      '--correlation-id',
      'corr-cli-022-retry-success',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.schemaVersion).toBe('workflow-command-envelope.v1');
    expect(envelope.command).toBe('workflow.retry');
    expect(envelope.success).toBe(true);
    expect(envelope.correlationId).toBe('corr-cli-022-retry-success');

    const wfRef = envelope.workflowRunRef as Record<string, unknown> | undefined;
    expect(wfRef?.provider).toBe('archon');
    expect(wfRef?.runId).toBe(runId);
    expect(wfRef?.workflowName).toBe('test-workflow');

    const result = envelope.result as Record<string, unknown> | undefined;
    expect(result?.operation).toBe('retry');
    expect(result?.scope).toBe('run');
    expect(result?.dispatched).toBe(true);
    expect(result?.detached).toBe(true);

    expect(exitCode).toBe(0);
    expect(stderr).toBe('');

    // R1-F34: verify the detached worker log was created (spawn evidence).
    // The retry handler creates the log synchronously before spawn, so it
    // exists immediately after the parent exits.
    const logDir = join(isolatedHome, 'logs');
    expect(existsSync(logDir)).toBe(true);
    const logFiles = readdirSync(logDir).filter(f => f.startsWith('detached-retry-'));
    expect(logFiles.length).toBeGreaterThanOrEqual(1);
    expect(logFiles.some(f => f.includes(runId))).toBe(true);
  });

  // 3.3D-CLI-023 [P0] R1-F14 — worker-boundary proof: parent succeeds regardless
  // of detached worker outcome. The spawned child runs `workflow resume <id>`
  // which will fail (no real workflow engine), but the parent already emitted
  // success and exited 0.
  test('3.3D-CLI-023: retry dispatch parent exits 0 with success envelope even though detached worker will fail', async () => {
    const runId = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
    await seedFailedRun(runId, isolatedRepo);

    const { stdout, stderr, exitCode } = await runCli(['workflow', 'retry', runId, '--json']);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.success).toBe(true);
    const result = envelope.result as Record<string, unknown> | undefined;
    expect(result?.dispatched).toBe(true);
    expect(result?.detached).toBe(true);

    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-024 [P0] TD-003 — parent acknowledges dispatch; exact-node worker owns validation
  test('3.3D-CLI-024: targeted retry matches the JSON contract and records invalid-node validation as a later worker outcome', async () => {
    const runId = 'cccccccc-dddd-eeee-ffff-aaaaaaaaaaaa';
    installWorkflowFixture(
      isolatedRepo,
      'targeted-proof-workflow.yaml',
      [
        'name: targeted-proof-workflow',
        'description: Deterministic targeted retry ownership proof',
        'nodes:',
        '  - id: already-complete',
        '    bash: "echo \'prior-output\'"',
        '  - id: real-target',
        '    bash: "echo \'target-output\'"',
        '    depends_on: [already-complete]',
        '',
      ].join('\n'),
      'add targeted retry proof workflow'
    );
    await seedFailedRun(runId, isolatedRepo, 'targeted-proof-workflow');
    seedNodeEvent(runId, 'node_completed', 'already-complete', {
      type: 'bash',
      node_output: 'prior-output',
    });

    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'retry',
      runId,
      '--node',
      'missing-target',
      '--json',
      '--correlation-id',
      'corr-cli-024-retry-node',
    ]);

    const envelope = parseSoleJsonLine(stdout);

    // R1-F42: full envelope contract validation against retry-node-success.json shape
    expect(envelope.schemaVersion).toBe('workflow-command-envelope.v1');
    expect(envelope.intendedProducer).toBe('Archon');
    expect(envelope.intendedConsumer).toBe('Hermes');
    expect(envelope.owningSubproject).toBe('archon');
    expect(envelope.provider).toBe('archon');
    expect(envelope.command).toBe('workflow.retry');
    expect(envelope.success).toBe(true);
    expect(envelope.correlationId).toBe('corr-cli-024-retry-node');
    expect(typeof envelope.issuedAt).toBe('string');

    const wfRef = envelope.workflowRunRef as Record<string, unknown> | undefined;
    expect(wfRef?.provider).toBe('archon');
    expect(wfRef?.runId).toBe(runId);
    expect(wfRef?.workflowName).toBe('targeted-proof-workflow');

    const result = envelope.result as Record<string, unknown> | undefined;
    expect(result?.operation).toBe('retry');
    expect(result?.scope).toBe('node');
    expect(result?.nodeId).toBe('missing-target');
    expect(result?.dispatched).toBe(true);
    expect(result?.detached).toBe(true);

    // No worker-derived fields in the parent result
    expect(result).not.toHaveProperty('state');
    expect(result).not.toHaveProperty('resumed');
    expect(result).not.toHaveProperty('attempt');

    expect(exitCode).toBe(0);
    expect(stderr).toBe('');

    // The parent must not validate node existence. The exact worker later loads
    // the persisted workflow, rejects the requested node, and leaves the run
    // failed without retroactively changing the successful parent envelope.
    const logDir = join(isolatedHome, 'logs');
    const logFiles = readdirSync(logDir).filter(
      f => f.startsWith('detached-retry-') && f.includes(runId)
    );
    expect(logFiles.length).toBeGreaterThanOrEqual(1);
    const logPath = join(logDir, logFiles[0] as string);
    let logContent = '';
    for (let i = 0; i < 50; i++) {
      try {
        logContent = readFileSync(logPath, 'utf8');
        if (logContent.includes("Retry target node 'missing-target'")) break;
      } catch {
        // Detached worker has not opened the log yet.
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    expect(logContent).toContain("Retry target node 'missing-target'");
    expect(queryRunStatus(runId)).toBe('failed');
  });

  // 3.3D-CLI-025 [P0] R1-F23 — resume success envelope for a paused run
  test('3.3D-CLI-025: `workflow resume <paused-run> --json` emits success envelope with resumable:true, executed:false', async () => {
    const runId = 'dddddddd-eeee-ffff-0000-111111111111';
    await seedRunWithStatus(runId, isolatedRepo, 'paused');

    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'resume',
      runId,
      '--json',
      '--correlation-id',
      'corr-cli-025-resume-success',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.schemaVersion).toBe('workflow-command-envelope.v1');
    expect(envelope.command).toBe('workflow.resume');
    expect(envelope.success).toBe(true);
    expect(envelope.correlationId).toBe('corr-cli-025-resume-success');

    const result = envelope.result as Record<string, unknown> | undefined;
    expect(result?.operation).toBe('resume');
    expect(result?.resumable).toBe(true);
    expect(result?.executed).toBe(false);
    expect(result?.validated).toBe(true);
    expect(result?.state).toBe('paused');

    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-026 [P0] R1-F23 — resume UNEXPECTED_STATE for completed run
  test('3.3D-CLI-026: `workflow resume <completed-run> --json` emits UNEXPECTED_STATE envelope, exit 78', async () => {
    const runId = 'eeeeeeee-ffff-0000-1111-222222222222';
    await seedRunWithStatus(runId, isolatedRepo, 'completed');

    const { stdout, stderr, exitCode } = await runCli(['workflow', 'resume', runId, '--json']);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('UNEXPECTED_STATE');
    expect(exitCode).toBe(78);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-027 [P0] — resume SUCCESS for a cancelled run.
  // Cancelled runs are resumable; in JSON mode `workflow resume` validates
  // eligibility without inline execution, so a cancelled run resumes like a
  // paused one (validated, not executed).
  test('3.3D-CLI-027: `workflow resume <cancelled-run> --json` emits success envelope with resumable:true, executed:false', async () => {
    const runId = 'ffffffff-0000-1111-2222-333333333333';
    await seedRunWithStatus(runId, isolatedRepo, 'cancelled');

    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'resume',
      runId,
      '--json',
      '--correlation-id',
      'corr-cli-027-resume-cancelled',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.schemaVersion).toBe('workflow-command-envelope.v1');
    expect(envelope.command).toBe('workflow.resume');
    expect(envelope.success).toBe(true);
    expect(envelope.correlationId).toBe('corr-cli-027-resume-cancelled');

    const result = envelope.result as Record<string, unknown> | undefined;
    expect(result?.operation).toBe('resume');
    expect(result?.resumable).toBe(true);
    expect(result?.executed).toBe(false);
    expect(result?.validated).toBe(true);
    expect(result?.state).toBe('cancelled');

    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-028 [P0] R1-F23 — cancel success envelope for a paused run
  test('3.3D-CLI-028: `workflow cancel <paused-run> --json` emits success envelope with terminal:true', async () => {
    const runId = '00000000-1111-2222-3333-444444444444';
    await seedRunWithStatus(runId, isolatedRepo, 'paused');

    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'cancel',
      runId,
      '--json',
      '--correlation-id',
      'corr-cli-028-cancel-success',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.schemaVersion).toBe('workflow-command-envelope.v1');
    expect(envelope.command).toBe('workflow.cancel');
    expect(envelope.success).toBe(true);
    expect(envelope.correlationId).toBe('corr-cli-028-cancel-success');

    const result = envelope.result as Record<string, unknown> | undefined;
    expect(result?.operation).toBe('cancel');
    expect(result?.state).toBe('cancelled');
    expect(result?.terminal).toBe(true);

    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-029 [P0] R1-F23 — cancel UNEXPECTED_STATE for completed run
  test('3.3D-CLI-029: `workflow cancel <completed-run> --json` emits UNEXPECTED_STATE envelope, exit 78', async () => {
    const runId = '11111111-2222-3333-4444-555555555555';
    await seedRunWithStatus(runId, isolatedRepo, 'completed');

    const { stdout, stderr, exitCode } = await runCli(['workflow', 'cancel', runId, '--json']);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('UNEXPECTED_STATE');
    expect(exitCode).toBe(78);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-030 [P0] R1-F23 — cancel UNEXPECTED_STATE for cancelled run
  test('3.3D-CLI-030: `workflow cancel <cancelled-run> --json` emits UNEXPECTED_STATE envelope, exit 78', async () => {
    const runId = '22222222-3333-4444-5555-666666666666';
    await seedRunWithStatus(runId, isolatedRepo, 'cancelled');

    const { stdout, stderr, exitCode } = await runCli(['workflow', 'cancel', runId, '--json']);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('UNEXPECTED_STATE');
    expect(exitCode).toBe(78);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-031 [P1] R1-F19 — unsupported flag on resume --json
  test('3.3D-CLI-031: `workflow resume <run> --json --force` emits MALFORMED_REQUEST for unsupported flag', async () => {
    const runId = '33333333-4444-5555-6666-777777777777';
    await seedRunWithStatus(runId, isolatedRepo, 'paused');

    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'resume',
      runId,
      '--json',
      '--force',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-032 [P1] R1-F19 — unsupported flag on retry --json
  test('3.3D-CLI-032: `workflow retry <run> --json --verbose` emits MALFORMED_REQUEST for unsupported flag', async () => {
    const runId = '44444444-5555-6666-7777-888888888888';
    await seedFailedRun(runId, isolatedRepo);

    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'retry',
      runId,
      '--json',
      '--verbose',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-033 [P1] R1-F19 — unsupported flag on cancel --json
  test('3.3D-CLI-033: `workflow cancel <run> --json --detach` emits MALFORMED_REQUEST for unsupported flag', async () => {
    const runId = '55555555-6666-7777-8888-999999999999';
    await seedRunWithStatus(runId, isolatedRepo, 'paused');

    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'cancel',
      runId,
      '--json',
      '--detach',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-034 [P0] R1-F27 — resume UNEXPECTED_STATE for running run
  test('3.3D-CLI-034: `workflow resume <running-run> --json` emits UNEXPECTED_STATE envelope, exit 78', async () => {
    const runId = '66666666-7777-8888-9999-aaaaaaaaaaaa';
    await seedRunWithStatus(runId, isolatedRepo, 'running');

    const { stdout, stderr, exitCode } = await runCli(['workflow', 'resume', runId, '--json']);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('UNEXPECTED_STATE');
    expect(exitCode).toBe(78);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-035 [P0] TD-002 — parent dispatches; worker owns lifecycle eligibility
  test('3.3D-CLI-035: `workflow retry <completed-run> --json` returns dispatch acknowledgement', async () => {
    const runId = '77777777-8888-9999-aaaa-bbbbbbbbbbbb';
    await seedRunWithStatus(runId, isolatedRepo, 'completed');

    const { stdout, stderr, exitCode } = await runCli(['workflow', 'retry', runId, '--json']);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.success).toBe(true);
    const result = envelope.result as Record<string, unknown> | undefined;
    expect(result?.scope).toBe('run');
    expect(result?.dispatched).toBe(true);
    expect(result?.detached).toBe(true);
    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-036 [P0] R1-F27 — targeted retry UNEXPECTED_STATE for unknown run
  test('3.3D-CLI-036: `workflow retry <unknown-run> --node <id> --json` emits UNEXPECTED_STATE envelope, exit 78', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'retry',
      '99999999-aaaa-bbbb-cccc-dddddddddddd',
      '--node',
      'implement-story',
      '--json',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('UNEXPECTED_STATE');
    expect(exitCode).toBe(78);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-037 [P0] R1-F24 — raw --json consumed as string option value
  test('3.3D-CLI-037: `workflow resume <run> --effort --json` emits MALFORMED_REQUEST when --json is consumed as option value', async () => {
    const runId = '88888888-9999-aaaa-bbbb-cccccccccccc';
    await seedRunWithStatus(runId, isolatedRepo, 'paused');

    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'resume',
      runId,
      '--effort',
      '--json',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });
});

// ---------------------------------------------------------------------------
// R1-F30 — Durable side-effect proofs: verify DB state after recovery commands
// ---------------------------------------------------------------------------
describe('R1-F30 — durable side-effect proofs (Story 3.3d)', () => {
  // 3.3D-CLI-038 [P0] — cancel actually transitions the DB row to 'cancelled'
  test('3.3D-CLI-038: `workflow cancel --json` durably transitions run status to cancelled in DB', async () => {
    const runId = 'aaaa1111-bbbb-cccc-dddd-eeeeeeeeeeee';
    await seedRunWithStatus(runId, isolatedRepo, 'paused');
    expect(queryRunStatus(runId)).toBe('paused');

    const { stdout, exitCode } = await runCli(['workflow', 'cancel', runId, '--json']);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.success).toBe(true);
    expect(exitCode).toBe(0);

    const statusAfter = queryRunStatus(runId);
    expect(statusAfter).toBe('cancelled');
  });

  // 3.3D-CLI-039 [P0] R1-F48 — resume validate-only does NOT mutate DB state
  test('3.3D-CLI-039: `workflow resume --json` does not mutate run status, timestamps, events, or metadata in DB (validate-only)', async () => {
    const runId = 'bbbb2222-cccc-dddd-eeee-ffffffffffff';
    await seedRunWithStatus(runId, isolatedRepo, 'paused');
    expect(queryRunStatus(runId)).toBe('paused');
    const updatedAtBefore = queryRunUpdatedAt(runId);
    const eventsBefore = queryEventCount(runId);
    const metadataBefore = queryRunMetadata(runId);

    const { stdout, exitCode } = await runCli(['workflow', 'resume', runId, '--json']);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.success).toBe(true);
    expect(exitCode).toBe(0);

    // R1-F48: full no-mutation contract — status, timestamps, events, metadata unchanged
    expect(queryRunStatus(runId)).toBe('paused');
    expect(queryRunUpdatedAt(runId)).toBe(updatedAtBefore);
    expect(queryEventCount(runId)).toBe(eventsBefore);
    expect(queryRunMetadata(runId)).toEqual(metadataBefore);
  });

  // 3.3D-CLI-040 [P0] R1-F38 — retry parent dispatch does not mutate run status,
  // events, or metadata in DB. Checks are deterministic: the parent returns
  // immediately after spawn, and these DB assertions run before the detached
  // worker can claim the run (worker must re-resolve the run and win a CAS).
  test('3.3D-CLI-040: `workflow retry --json` parent dispatch does not mutate run status, events, or metadata in DB', async () => {
    const runId = 'cccc3333-dddd-eeee-ffff-aaaaaaaaaaaa';
    await seedFailedRun(runId, isolatedRepo);
    expect(queryRunStatus(runId)).toBe('failed');
    expect(queryEventCount(runId)).toBe(0);
    const metadataBefore = queryRunMetadata(runId);

    const { stdout, exitCode } = await runCli(['workflow', 'retry', runId, '--json']);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.success).toBe(true);
    expect(exitCode).toBe(0);

    // Deterministic side-effect proofs: parent dispatch is read-only on the run.
    expect(queryRunStatus(runId)).toBe('failed');
    expect(queryEventCount(runId)).toBe(0);
    expect(queryRunMetadata(runId)).toEqual(metadataBefore);
  });

  // 3.3D-CLI-041 [P1] R1-F41 — option-looking --node values rejected as MALFORMED_REQUEST
  test('3.3D-CLI-041: `workflow retry <run> --node --correlation-id <val> --json` rejects option-looking node value', async () => {
    const runId = 'f1f1f1f1-a2a2-b3b3-c4c4-d5d5d5d5d5d5';
    await seedFailedRun(runId, isolatedRepo);

    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'retry',
      runId,
      '--node',
      '--correlation-id',
      'corr-cli-041',
      '--json',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.retry');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-042 [P1] R1-F45 — single-dash option-looking --node values rejected
  test('3.3D-CLI-042: `workflow retry <run> --node -n --json` rejects single-dash option-looking node value as MALFORMED_REQUEST', async () => {
    const runId = 'a2a2a2a2-b3b3-c4c4-d5d5-e6e6e6e6e6e6';
    await seedFailedRun(runId, isolatedRepo);

    const { stdout, stderr, exitCode } = await runCli([
      'workflow',
      'retry',
      runId,
      '--node',
      '-n',
      '--json',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.command).toBe('workflow.retry');
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('MALFORMED_REQUEST');
    expect(exitCode).toBe(64);
    expect(stderr).toBe('');
  });

  // 3.3D-CLI-043 [P1] R1-F46 — working_path that is a file (not directory) rejected
  test('3.3D-CLI-043: `workflow resume --json` rejects run whose working_path is a file, not a directory', async () => {
    const runId = 'b3b3b3b3-c4c4-d5d5-e6e6-f7f7f7f7f7f7';
    // Create a regular file to use as working_path
    const filePath = join(isolatedRepo, 'not-a-directory.txt');
    writeFileSync(filePath, 'this is a file, not a directory');

    await runCli(['workflow', 'list', '--json']);
    const db = openWriteDatabase();
    try {
      db.run('PRAGMA foreign_keys = OFF');
      db.run(
        `INSERT OR IGNORE INTO remote_agent_conversations (id, platform_type, platform_conversation_id)
         VALUES ('seed-conv-e2e', 'cli', 'seed-conv-e2e')`
      );
      db.run(
        `INSERT INTO remote_agent_workflow_runs (id, conversation_id, workflow_name, user_message, status, working_path, metadata)
         VALUES (?, 'seed-conv-e2e', 'test-workflow', 'seed run', 'paused', ?, '{}')`,
        [runId, filePath]
      );
    } finally {
      db.close();
    }

    const { stdout, exitCode } = await runCli(['workflow', 'resume', runId, '--json']);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.success).toBe(false);
    const error = envelope.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe('UNEXPECTED_STATE');
    expect(exitCode).toBe(78);
  });

  // 3.3D-CLI-044 [P0] TD-002 — detached worker reaches an observable terminal outcome
  test('3.3D-CLI-044: `workflow retry <failed-run> --json` worker completes a deterministic workflow and emits events', async () => {
    const runId = 'c4c4c4c4-d5d5-e6e6-f7f7-a8a8a8a8a8a8';
    installWorkflowFixture(
      isolatedRetryProofRepo,
      'retry-proof-workflow.yaml',
      [
        'name: retry-proof-workflow',
        'description: Deterministic detached retry proof',
        'nodes:',
        '  - id: already-complete',
        '    bash: "echo \'prior-output\'"',
        '  - id: retry-proof',
        '    bash: "echo \'retry-worker-proof\'"',
        '    depends_on: [already-complete]',
        '',
      ].join('\n'),
      'add retry proof workflow'
    );
    await seedFailedRun(runId, isolatedRetryProofRepo, 'retry-proof-workflow');
    seedNodeEvent(runId, 'node_completed', 'already-complete', {
      type: 'bash',
      node_output: 'prior-output',
    });

    const { stdout, exitCode } = await runCli(['workflow', 'retry', runId, '--json']);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.success).toBe(true);
    expect(exitCode).toBe(0);

    const logDir = join(isolatedHome, 'logs');
    const logFiles = readdirSync(logDir).filter(
      f => f.startsWith('detached-retry-') && f.includes(runId)
    );
    expect(logFiles.length).toBeGreaterThanOrEqual(1);
    const logPath = join(logDir, logFiles[0] as string);

    // A dispatch acknowledgement proves only that spawn returned a pid. Poll the
    // durable run/event state to prove the exact worker actually executed and
    // reached a terminal outcome.
    let status = queryRunStatus(runId);
    let eventCount = queryEventCount(runId);
    for (let i = 0; i < 80 && (status !== 'completed' || eventCount === 0); i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      status = queryRunStatus(runId);
      eventCount = queryEventCount(runId);
    }

    // Keep the log assertion as a secondary diagnostic, but it is no longer the
    // proof oracle: file creation alone cannot establish successful execution.
    // The worker redirects stdout to this file; CLIAdapter prints the sink
    // node's output (retry-worker-proof) via console.log AFTER
    // completeWorkflowRun. Breaking on the first non-empty read raced the
    // summary write and failed CI while the DAG had already completed.
    let logContent = '';
    for (let i = 0; i < 50; i++) {
      try {
        logContent = readFileSync(logPath, 'utf8');
        if (logContent.includes('retry-worker-proof')) break;
      } catch {
        // log file may not be readable yet
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (status !== 'completed' || eventCount === 0) {
      throw new Error(
        `Detached retry proof did not complete (status=${status}, events=${eventCount}). Worker log:\n${logContent}`
      );
    }

    expect(queryLatestNodeOutput(runId, 'retry-proof')).toContain('retry-worker-proof');
    expect(logContent).toContain('retry-worker-proof');
  });

  // 3.3D-CLI-045 [P0] TD-003 — exact-node worker owns claim, preparation, and execution
  test('3.3D-CLI-045: targeted retry worker claims and completes the exact persisted failed node once', async () => {
    const runId = 'd5d5d5d5-e6e6-f7f7-a8a8-b9b9b9b9b9b9';
    installWorkflowFixture(
      isolatedRetryProofRepo,
      'targeted-success-proof.yaml',
      [
        'name: targeted-success-proof',
        'description: Deterministic exact-node retry success proof',
        'mutates_checkout: false',
        'nodes:',
        '  - id: already-complete-targeted',
        '    bash: "echo \'prior-targeted-output\'"',
        '  - id: exact-target',
        '    bash: "echo \'exact-target-worker-proof\'"',
        '    depends_on: [already-complete-targeted]',
        '',
      ].join('\n'),
      'add exact-node retry success proof'
    );
    await seedFailedRun(runId, isolatedRetryProofRepo, 'targeted-success-proof');
    seedNodeEvent(runId, 'node_completed', 'already-complete-targeted', {
      type: 'bash',
      node_output: 'prior-targeted-output',
    });
    seedNodeEvent(runId, 'node_failed', 'exact-target', {
      type: 'bash',
      error: 'seeded target failure',
    });

    const { stdout, exitCode } = await runCli([
      'workflow',
      'retry',
      runId,
      '--node',
      'exact-target',
      '--json',
    ]);

    const envelope = parseSoleJsonLine(stdout);
    expect(envelope.success).toBe(true);
    expect((envelope.result as Record<string, unknown>).nodeId).toBe('exact-target');
    expect(exitCode).toBe(0);

    let status = queryRunStatus(runId);
    let targetCompletionCount = queryNodeEventCount(runId, 'node_completed', 'exact-target');
    for (let i = 0; i < 80 && (status !== 'completed' || targetCompletionCount !== 1); i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      status = queryRunStatus(runId);
      targetCompletionCount = queryNodeEventCount(runId, 'node_completed', 'exact-target');
    }

    expect(status).toBe('completed');
    expect(targetCompletionCount).toBe(1);
    expect(queryNodeEventCount(runId, 'node_retry_requested', 'exact-target')).toBe(1);
  });

  // 3.3D-CLI-046 [P0] TD-002 — duplicate parents may ack; exactly one worker executes
  test('3.3D-CLI-046: concurrent whole-run retry dispatches produce one winning worker execution', async () => {
    const runId = 'e6e6e6e6-f7f7-a8a8-b9b9-c0c0c0c0c0c0';
    installWorkflowFixture(
      isolatedRetryProofRepo,
      'concurrent-retry-proof.yaml',
      [
        'name: concurrent-retry-proof',
        'description: Deterministic retry claim race proof',
        'nodes:',
        '  - id: already-complete-race',
        '    bash: "echo \'prior-race-output\'"',
        '  - id: one-winner',
        '    bash: "echo \'concurrent-worker-proof\'"',
        '    depends_on: [already-complete-race]',
        '',
      ].join('\n'),
      'add concurrent retry proof'
    );
    await seedFailedRun(runId, isolatedRetryProofRepo, 'concurrent-retry-proof');
    seedNodeEvent(runId, 'node_completed', 'already-complete-race', {
      type: 'bash',
      node_output: 'prior-race-output',
    });

    const [first, second] = await Promise.all([
      runCli(['workflow', 'retry', runId, '--json']),
      runCli(['workflow', 'retry', runId, '--json']),
    ]);

    for (const parent of [first, second]) {
      const envelope = parseSoleJsonLine(parent.stdout);
      expect(envelope.success).toBe(true);
      expect((envelope.result as Record<string, unknown>).dispatched).toBe(true);
      expect(parent.exitCode).toBe(0);
    }

    let status = queryRunStatus(runId);
    let winnerCompletionCount = queryNodeEventCount(runId, 'node_completed', 'one-winner');
    for (let i = 0; i < 100 && (status !== 'completed' || winnerCompletionCount !== 1); i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      status = queryRunStatus(runId);
      winnerCompletionCount = queryNodeEventCount(runId, 'node_completed', 'one-winner');
    }

    expect(status).toBe('completed');
    expect(winnerCompletionCount).toBe(1);
    // The DB status flips to completed before the detached worker's log file
    // finishes flushing stdout; poll the file with the same bounded cadence.
    let logFiles: string[] = [];
    let combinedLogs = '';
    for (
      let i = 0;
      i < 100 && (logFiles.length === 0 || !combinedLogs.includes('concurrent-worker-proof'));
      i++
    ) {
      await new Promise(resolve => setTimeout(resolve, 100));
      logFiles = readdirSync(join(isolatedHome, 'logs')).filter(
        file => file.startsWith('detached-retry-') && file.includes(runId)
      );
      combinedLogs = logFiles
        .map(file => readFileSync(join(isolatedHome, 'logs', file), 'utf8'))
        .join('\n');
    }
    expect(logFiles.length).toBeGreaterThanOrEqual(1);
    expect(combinedLogs.split('concurrent-worker-proof').length - 1).toBe(1);
  }, 30000);
});

// ---------------------------------------------------------------------------
// AC #6 — Consumer boundary: Archon adds no consumer classification code
// ---------------------------------------------------------------------------
describe('AC #6 consumer boundary — Archon has no consumer classification (Story 3.3d)', () => {
  test('packages/cli contains no UNEXPECTED_EXIT, SCHEMA_MISMATCH, or consumer TIMEOUT classification', async () => {
    const { readFileSync } = await import('node:fs');
    const { readdirSync, statSync } = await import('node:fs');
    const cliSrc = join(import.meta.dir, '..');

    function readAllTs(dir: string): string {
      let content = '';
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          content += readAllTs(full);
        } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
          content += readFileSync(full, 'utf8');
        }
      }
      return content;
    }

    const allSource = readAllTs(cliSrc);
    expect(allSource).not.toContain("'UNEXPECTED_EXIT'");
    expect(allSource).not.toContain("'SCHEMA_MISMATCH'");
    // Consumer's TIMEOUT classification (not Archon's COMMAND_TIMEOUT):
    expect(allSource).not.toContain("code: 'TIMEOUT'");
  });
});
