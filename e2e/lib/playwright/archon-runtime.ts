import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
// e2e/lib/playwright -> repo root is three levels up.
const REPO_ROOT = process.env.ARCHON_E2E_REPO_ROOT
  ? resolve(process.env.ARCHON_E2E_REPO_ROOT)
  : join(HERE, '..', '..', '..');
const CLI_ENTRY = join(REPO_ROOT, 'packages', 'cli', 'src', 'cli.ts');
const SERVER_ENTRY = join(REPO_ROOT, 'packages', 'server', 'src', 'index.ts');
const WEB_DIST_INDEX = join(REPO_ROOT, 'packages', 'web', 'dist', 'index.html');
const WORKFLOW_FIXTURE = join(HERE, '..', '..', 'fixtures', 'workflows', 'e2e-usage-record.yaml');
const HITL_WORKFLOW_FIXTURE = join(HERE, '..', '..', 'fixtures', 'workflows', 'e2e-hitl-run.yaml');
const HITL_LONG_WORKFLOW_FIXTURE = join(
  HERE,
  '..',
  '..',
  'fixtures',
  'workflows',
  'e2e-hitl-long-history.yaml'
);
const HITL_TWO_ASKS_WORKFLOW_FIXTURE = join(
  HERE,
  '..',
  '..',
  'fixtures',
  'workflows',
  'e2e-hitl-two-asks.yaml'
);
const TASK_DISPATCH_WORKFLOW_FIXTURE = join(
  HERE,
  '..',
  '..',
  'fixtures',
  'workflows',
  'e2e-task-dispatch.yaml'
);

const TODO_STRIP_WORKFLOW_FIXTURE = join(
  HERE,
  '..',
  '..',
  'fixtures',
  'workflows',
  'e2e-todo-strip.yaml'
);

/** Name of the seeded workflow whose single AI node runs on the fake provider. */
export const E2E_WORKFLOW_NAME = 'e2e-usage-record';
export const E2E_HITL_WORKFLOW_NAME = 'e2e-hitl-run';
export const E2E_HITL_LONG_WORKFLOW_NAME = 'e2e-hitl-long-history';
export const E2E_HITL_TWO_ASKS_WORKFLOW_NAME = 'e2e-hitl-two-asks';
export const E2E_TODO_STRIP_WORKFLOW_NAME = 'e2e-todo-strip';
export const TODO_STRIP_TODO_NODE = 'todo-plan';
export const TODO_STRIP_NO_TODO_NODE = 'no-todo';
export const E2E_STARTER_WEB_USER = 'e2e-hitl-starter';
export const E2E_TEAMMATE_WEB_USER = 'e2e-hitl-teammate';
export const E2E_CLI_USER = 'e2e-hitl-cli';
export const HITL_TOOL_OUTPUT = 'HITL_TOOL_OUTPUT_VISIBLE';
export const HITL_INSPECT_NODE = 'inspect-file';
export const HITL_LOOP_NODE = 'inspect-twice';
export const HITL_ASK_NODE = 'ask-starter';
export const HITL_LONG_NODE = 'long-history';
export const HITL_ASK_ANSWER_NODE = 'ask-answer';
export const HITL_ASK_DECLINE_NODE = 'ask-decline';
export const E2E_TASK_DISPATCH_WORKFLOW_NAME = 'e2e-task-dispatch';
export const TASK_DISPATCH_OMP_NODE = 'omp-dispatch';
export const TASK_DISPATCH_CLAUDE_NODE = 'claude-dispatch';

/**
 * The one model the seeded config prices. A usage entry for
 * `(provider: 'openai', model: PRICED_MODEL)` with NO reported cost gets an
 * estimated cost of input 2.0 + output 10.0 (USD per 1M tokens); any other
 * (provider, model) stays unpriced. Lets the estimate path be exercised without
 * a real vendor rate.
 */
export const PRICED_MODEL = 'e2e-priced-model';
export const PRICED_MODEL_PROVIDER = 'openai';
export const PRICED_RATE_INPUT_PER_M = 2.0;
export const PRICED_RATE_OUTPUT_PER_M = 10.0;

export interface CliRunResult {
  runId: string;
  state?: string;
  terminal?: boolean;
  stdout: string;
}

export class UnsupportedSetupError extends Error {
  readonly code = 'UNSUPPORTED_SETUP';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'UnsupportedSetupError';
  }
}

export interface LiveWorkflowRun {
  pid: number;
  command: string;
  port: number;
  workdir: string;
  runId: Promise<string>;
  wait(): Promise<CliRunResult>;
}

export interface HitlWebRun {
  runId: string;
  conversationId: string;
  codebaseId: string;
}

export interface ArchonRuntime {
  /** Base URL of this worker's isolated Archon server (API + SPA). */
  baseURL: string;
  /** Isolated ARCHON_HOME (SQLite DB, home-scoped workflows) for this worker. */
  home: string;
  /** Non-git folder-project workspace used for `--folder` runs. */
  workdir: string;
  /** Internal UUID shared by the CLI starter and the starter web identity. */
  starterUserId: string;
  starterWebUser: string;
  teammateWebUser: string;
  /**
   * Run the seeded workflow for real (executor -> usage recorder -> ledger),
   * with the AI faked by the env-gated `e2e-fake` provider. `directive` is the
   * `<<E2E_USAGE>>...<</E2E_USAGE>>` block that tells the fake what usage to
   * emit; omit it to exercise the no-usage path. Resolves with the run id.
   */
  runWorkflow(directive?: string): Promise<string>;
  /** Run the HITL fixture to a CLI envelope (typically `paused` at Ask). */
  runHitlWorkflow(): Promise<CliRunResult>;
  /** Real CLI run without ARCHON_USER_ID or its USER/USERNAME identity fallbacks. */
  runUnownedHitlWorkflow(): Promise<CliRunResult>;
  /** Run the multi-page HITL history fixture through the existing CLI runner. */
  runHitlLongHistoryWorkflow(): Promise<CliRunResult>;
  /** Run two parallel AskHuman nodes so answered and declined records coexist. */
  runHitlTwoAsksWorkflow(): Promise<CliRunResult>;
  /** Run the two-node task-dispatch fixture (OMP batch + Claude single) to completion. */
  runTaskDispatchWorkflow(): Promise<CliRunResult>;
  /**
   * Start the HITL fixture without waiting for CLI exit. `runId` resolves as
   * soon as the run row exists. Use only while work is still running.
   */
  startHitlWorkflow(): Promise<LiveWorkflowRun>;
  /** Blocking CLI resume after a browser Ask answer. */
  resumeWorkflow(runId: string): Promise<CliRunResult>;
  /**
   * Dispatch the HITL fixture from a real web conversation (parent_conversation_id set).
   * Polls until the run exists, then until it pauses at Ask.
   */
  runHitlWorkflowViaWeb(): Promise<HitlWebRun>;
  /** Poll GET /api/workflows/runs/:id until `run.status` matches. */
  waitForRunStatus(runId: string, status: string, timeoutMs?: number): Promise<void>;
  /** Stop the server and delete the isolated temp tree. */
  stop(): Promise<void>;
}

/**
 * Isolated env for the spawned Archon processes.
 * `DATABASE_URL: ''` (empty, NOT unset) selects SQLite — an unset value would let
 * the server's dotenv re-inject the repo `.env` Postgres URL. `ARCHON_E2E_FAKE_PROVIDER`
 * registers the fake AI provider (no-op in any process without it).
 */
export function isolatedEnv(home: string, port?: number): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ARCHON_HOME: home,
    HOST: '127.0.0.1',
    DATABASE_URL: '',
    SLACK_BOT_TOKEN: '',
    SLACK_APP_TOKEN: '',
    TELEGRAM_BOT_TOKEN: '',
    DISCORD_BOT_TOKEN: '',
    GITHUB_TOKEN: '',
    GITHUB_APP_ID: '',
    GITEA_TOKEN: '',
    GITLAB_TOKEN: '',
    BETTER_AUTH_SECRET: '',
    ARCHON_TELEMETRY_DISABLED: '1',
    ARCHON_E2E_FAKE_PROVIDER: '1',
    DEFAULT_AI_ASSISTANT: 'e2e-fake',
    ARCHON_USER_ID: E2E_CLI_USER,
    LOG_LEVEL: 'warn',
    ...(port ? { PORT: String(port) } : {}),
  };
}

async function waitForHealth(baseURL: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr = 'no response';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseURL}/api/health`);
      if (res.ok) return;
      lastErr = `HTTP ${res.status}`;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(
    `Archon server not healthy at ${baseURL} within ${timeoutMs}ms (last: ${lastErr})`
  );
}

function isPortListening(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = createConnection({ port, host: '127.0.0.1' }, () => {
      socket.end();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function parseCliEnvelope(stdout: string): CliRunResult {
  const line = stdout
    .split('\n')
    .reverse()
    .find(l => l.includes('workflowRunRef'));
  if (!line) throw new Error(`No run envelope in CLI output:\n${stdout}`);
  const envelope = JSON.parse(line) as {
    workflowRunRef?: { runId?: string };
    result?: { state?: string; terminal?: boolean };
  };
  const runId = envelope.workflowRunRef?.runId;
  if (!runId) throw new Error(`Run envelope missing runId:\n${line}`);
  return {
    runId,
    state: envelope.result?.state,
    terminal: envelope.result?.terminal,
    stdout,
  };
}

function seedStarterIdentities(dbPath: string, userId: string): void {
  const script = `
    import { Database } from 'bun:sqlite';
    const dbPath = process.env.E2E_DB_PATH;
    const userId = process.env.E2E_USER_ID;
    const cliId = process.env.E2E_CLI_USER;
    const webId = process.env.E2E_WEB_USER;
    if (!dbPath || !userId || !cliId || !webId) throw new Error('identity seed env missing');
    const db = new Database(dbPath);
    db.run('INSERT INTO remote_agent_users (id, display_name, role) VALUES (?, ?, ?)', [userId, 'e2e-starter', 'admin']);
    db.run(
      'INSERT INTO remote_agent_user_identities (user_id, platform, platform_user_id, platform_display_name) VALUES (?, ?, ?, ?)',
      [userId, 'cli', cliId, 'e2e-starter']
    );
    db.run(
      'INSERT INTO remote_agent_user_identities (user_id, platform, platform_user_id, platform_display_name) VALUES (?, ?, ?, ?)',
      [userId, 'web', webId, 'e2e-starter']
    );
  `;
  const result = spawnSync('bun', ['-e', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      E2E_DB_PATH: dbPath,
      E2E_USER_ID: userId,
      E2E_CLI_USER,
      E2E_WEB_USER: E2E_STARTER_WEB_USER,
    },
  });
  if (result.status !== 0) {
    throw new Error(`identity seed failed:\n${result.stderr}\n${result.stdout}`);
  }
}

async function terminateChild(child: ChildProcess, exited: Promise<number>): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) {
    await exited;
    return;
  }
  child.kill('SIGTERM');
  const timedOut = await Promise.race([
    exited.then(() => false),
    new Promise<boolean>(resolve => setTimeout(() => resolve(true), 3_000)),
  ]);
  if (timedOut && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await Promise.race([exited, new Promise(r => setTimeout(r, 1_000))]);
  }
}

interface OwnedProcess {
  child: ChildProcess;
  exited: Promise<number>;
  command: string;
}

export async function createArchonRuntime(workerIndex: number): Promise<ArchonRuntime> {
  if (!existsSync(WEB_DIST_INDEX)) {

[Showing lines 1-300 of 734. Use :301 to continue]