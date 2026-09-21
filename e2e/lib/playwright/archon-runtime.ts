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
const FILE_EDIT_WORKFLOW_FIXTURE = join(
  HERE,
  '..',
  '..',
  'fixtures',
  'workflows',
  'e2e-file-edit.yaml'
);
const QUEUE_GUIDANCE_WORKFLOW_FIXTURE = join(
  HERE,
  '..',
  '..',
  'fixtures',
  'workflows',
  'e2e-queue-guidance.yaml'
);
const QUEUE_GUIDANCE_LOOP_WORKFLOW_FIXTURE = join(
  HERE,
  '..',
  '..',
  'fixtures',
  'workflows',
  'e2e-queue-guidance-loop.yaml'
);
const TRANSCRIPT_DISPLAY_WORKFLOW_FIXTURE = join(
  HERE,
  '..',
  '..',
  'fixtures',
  'workflows',
  'e2e-transcript-display.yaml'
);
const QUEUE_GUIDANCE_PAIR_WORKFLOW_FIXTURE = join(
  HERE,
  '..',
  '..',
  'fixtures',
  'workflows',
  'e2e-queue-guidance-pair.yaml'
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
export const E2E_FILE_EDIT_WORKFLOW_NAME = 'e2e-file-edit';
export const FILE_EDIT_NODE = 'file-edit';
export const FILE_EDIT_FAILED_NODE = 'file-edit-failed';
export const FILE_EDIT_WRITE_NODE = 'file-edit-write';
export const FILE_EDIT_BARE_NODE = 'file-edit-bare';
export const E2E_QUEUE_GUIDANCE_WORKFLOW_NAME = 'e2e-queue-guidance';
export const E2E_QUEUE_GUIDANCE_LOOP_WORKFLOW_NAME = 'e2e-queue-guidance-loop';
export const QUEUE_GUIDANCE_NODE = 'steer-me';
export const QUEUE_GUIDANCE_LOOP_NODE = 'steer-loop';
export const E2E_QUEUE_GUIDANCE_PAIR_WORKFLOW_NAME = 'e2e-queue-guidance-pair';
export const QUEUE_GUIDANCE_PAIR_NODE_A = 'steer-a';
export const QUEUE_GUIDANCE_PAIR_NODE_B = 'steer-b';
export const E2E_TRANSCRIPT_DISPLAY_WORKFLOW_NAME = 'e2e-transcript-display';
/** `loop_group` child carrying the one-string `output_format` — exercises nested definition resolution. */
export const TRANSCRIPT_STRUCTURED_NODE = 'group.structured';
/** Definition sibling with no `output_format` — its seeded envelope must stay serialized. */
export const TRANSCRIPT_PLAIN_NODE = 'plain';
/** Node absent from the definition entirely — the deleted-definition fallback. */
export const TRANSCRIPT_GHOST_NODE = 'ghost';
export const TRANSCRIPT_STRUCTURED_TEXT = 'E2E structured report body';
export const TRANSCRIPT_PLAIN_TEXT = 'E2E plain raw envelope';
export const TRANSCRIPT_GHOST_TEXT = 'E2E ghost raw envelope';
/**
 * Delta fragments persisted for the structured node: they assemble to exactly
 * `transcriptReportEnvelope(TRANSCRIPT_STRUCTURED_TEXT)`, so projection merges
 * them and the one-string unwrap renders the inner string.
 */
export const TRANSCRIPT_FRAGMENT_A = '{"report":"E2E structured';
export const TRANSCRIPT_FRAGMENT_B = ' report body"}';
/**
 * Ineligible payloads seeded under the SAME `output_format` node — every one
 * must render byte-for-byte: malformed JSON, an extra key beside `report`,
 * multiple non-`report` fields, a duplicate key, a noncanonical escape, and a
 * whitespace variant.
 */
export const TRANSCRIPT_INELIGIBLE_TEXTS = [
  '{"report":"E2E malformed report',
  '{"report":"E2E extra-key stays raw","extra":1}',
  '{"a":"E2E multi-field stays raw","b":2}',
  '{"report":"first","report":"E2E dup-key stays raw"}',
  '{"report":"E2E escape\\u0020stays raw"}',
  '{ "report": "E2E spacing stays raw" }',
] as const;
/** Canonical serialization of the one-string `{report}` envelope, matching `presentedText`. */
export function transcriptReportEnvelope(text: string): string {
  return JSON.stringify({ report: text });
}

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
   * Run the four-node file-edit fixture: `file-edit` emits a qualified edit
   * pair, `file-edit-failed` the same pair with an error outcome,
   * `file-edit-write` a path+content write, and `file-edit-bare` a tool call
   * with no input — one persisted row per node for the inline-diff proof.
   */
  runFileEditWorkflow(): Promise<CliRunResult>;
  /**
   * Run the todo-strip fixture: `todo-plan` emits four folded todo calls plus a
   * long Read transcript; `no-todo` emits ordinary tool calls only.
   */
  runTodoStripWorkflow(): Promise<CliRunResult>;
  /**
   * Run the transcript-display fixture: `seed` (bash) completes while
   * `group.structured` and `plain` skip via an unsatisfiable `when:` guard, then
   * seeds each skipped node's durable `{report}` envelope transcript row under
   * its minted execution scope plus one `ghost` node absent from the definition
   * (deleted-definition fallback). The e2e-fake provider has no structuredOutput
   * support, so the persisted shape is seeded rather than executed — the same
   * modeling rationale as occurrence-navigation.spec.ts.
   */
  prepareTranscriptDisplayRun(): Promise<CliRunResult>;
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
  /**
   * Dispatch any seeded workflow from a real web conversation and return once
   * the run row reports `running`. Unlike runHitlWorkflowViaWeb this does not
   * wait for a terminal/paused state — the caller observes the in-flight turn.
   */
  startWorkflowViaWeb(workflowName: string, message: string): Promise<HitlWebRun>;
  /**
   * Spawn `archon workflow run <name>` as a tracked detached CLI child whose
   * `runId` resolves once the run row exists. The executor lives in the CLI
   * process, so the server's steering registry holds no handle for this run.
   */
  startDetachedWorkflow(workflowName: string, message?: string): Promise<LiveWorkflowRun>;
  /** Authenticated fetch carrying the starter web identity (`X-Archon-User`). */
  starterFetch(path: string, init?: RequestInit): Promise<Response>;
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

export interface CreateArchonRuntimeOptions {
  /** Extra env vars merged into the server spawn only (after isolatedEnv). */
  serverEnv?: Record<string, string>;
}

export async function createArchonRuntime(
  workerIndex: number,
  options?: CreateArchonRuntimeOptions
): Promise<ArchonRuntime> {
  if (!existsSync(WEB_DIST_INDEX)) {
    throw new Error(
      `Web UI bundle missing at ${WEB_DIST_INDEX}. Build it once with \`bun run build:web\` from the repo root before running e2e.`
    );
  }

  const portBase = Number(process.env.ARCHON_E2E_PORT_BASE ?? '3400');
  const port = portBase + workerIndex;
  if (!Number.isInteger(portBase) || portBase < 1024 || port > 65535) {
    throw new Error(
      'ARCHON_E2E_PORT_BASE must be an integer between 1024 and 65535 minus the worker index'
    );
  }
  if (await isPortListening(port)) {
    throw new Error(
      `Port ${port} is already in use by an unrelated process. Refusing to launch this worker's Archon server.`
    );
  }
  const base = mkdtempSync(join(tmpdir(), 'archon-e2e-'));
  const owned: OwnedProcess[] = [];
  const stop = async (): Promise<void> => {
    try {
      for (const item of [...owned].reverse()) {
        await terminateChild(item.child, item.exited);
      }
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  };
  let initialized = false;
  try {
    const runtime = await startArchonRuntime(port, base, owned, stop, options?.serverEnv);
    initialized = true;
    return runtime;
  } finally {
    if (!initialized) await stop();
  }
}

async function startArchonRuntime(
  port: number,
  base: string,
  owned: OwnedProcess[],
  stop: () => Promise<void>,
  serverEnv?: Record<string, string>
): Promise<ArchonRuntime> {
  const home = join(base, 'home');
  const workdir = join(base, 'workdir');
  mkdirSync(join(home, 'workflows'), { recursive: true });
  mkdirSync(workdir, { recursive: true });
  writeFileSync(
    join(home, 'workflows', `${E2E_WORKFLOW_NAME}.yaml`),
    readFileSync(WORKFLOW_FIXTURE)
  );
  writeFileSync(
    join(home, 'workflows', `${E2E_HITL_WORKFLOW_NAME}.yaml`),
    readFileSync(HITL_WORKFLOW_FIXTURE)
  );
  writeFileSync(
    join(home, 'workflows', `${E2E_HITL_LONG_WORKFLOW_NAME}.yaml`),
    readFileSync(HITL_LONG_WORKFLOW_FIXTURE)
  );
  writeFileSync(
    join(home, 'workflows', `${E2E_HITL_TWO_ASKS_WORKFLOW_NAME}.yaml`),
    readFileSync(HITL_TWO_ASKS_WORKFLOW_FIXTURE)
  );
  writeFileSync(
    join(home, 'workflows', `${E2E_TASK_DISPATCH_WORKFLOW_NAME}.yaml`),
    readFileSync(TASK_DISPATCH_WORKFLOW_FIXTURE)
  );

  writeFileSync(
    join(home, 'workflows', `${E2E_TODO_STRIP_WORKFLOW_NAME}.yaml`),
    readFileSync(TODO_STRIP_WORKFLOW_FIXTURE)
  );

  writeFileSync(
    join(home, 'workflows', `${E2E_FILE_EDIT_WORKFLOW_NAME}.yaml`),
    readFileSync(FILE_EDIT_WORKFLOW_FIXTURE)
  );

  writeFileSync(
    join(home, 'workflows', `${E2E_QUEUE_GUIDANCE_WORKFLOW_NAME}.yaml`),
    readFileSync(QUEUE_GUIDANCE_WORKFLOW_FIXTURE)
  );

  writeFileSync(
    join(home, 'workflows', `${E2E_QUEUE_GUIDANCE_LOOP_WORKFLOW_NAME}.yaml`),
    readFileSync(QUEUE_GUIDANCE_LOOP_WORKFLOW_FIXTURE)
  );

  writeFileSync(
    join(home, 'workflows', `${E2E_TRANSCRIPT_DISPLAY_WORKFLOW_NAME}.yaml`),
    readFileSync(TRANSCRIPT_DISPLAY_WORKFLOW_FIXTURE)
  );

  writeFileSync(
    join(home, 'workflows', `${E2E_QUEUE_GUIDANCE_PAIR_WORKFLOW_NAME}.yaml`),
    readFileSync(QUEUE_GUIDANCE_PAIR_WORKFLOW_FIXTURE)
  );

  writeFileSync(
    join(home, 'config.yaml'),
    [
      'pricing:',
      '  models:',
      `    - provider: ${PRICED_MODEL_PROVIDER}`,
      `      model: ${PRICED_MODEL}`,
      `      input: ${String(PRICED_RATE_INPUT_PER_M)}`,
      `      output: ${String(PRICED_RATE_OUTPUT_PER_M)}`,
      '',
    ].join('\n')
  );

  const baseURL = `http://127.0.0.1:${port}`;
  const starterUserId = randomUUID();
  const dbPath = join(home, 'archon.db');

  const track = (child: ChildProcess, command: string): Promise<number> => {
    const exited = new Promise<number>(resolve => {
      child.once('error', () => resolve(-1));
      child.once('exit', code => resolve(code ?? -1));
    });
    owned.push({ child, exited, command });
    return exited;
  };

  const server: ChildProcess = spawn('bun', [SERVER_ENTRY], {
    cwd: home,
    env: { ...isolatedEnv(home, port), ...(serverEnv ?? {}) },
    stdio: 'pipe',
  });
  let serverLog = '';
  server.stdout?.on('data', d => (serverLog += String(d)));
  server.stderr?.on('data', d => (serverLog += String(d)));
  server.once('error', error => (serverLog += error.message));
  const serverExited = track(server, `bun ${SERVER_ENTRY} PORT=${String(port)}`);

  try {
    await waitForHealth(baseURL, 30_000);
  } catch (err) {
    await terminateChild(server, serverExited);
    throw new Error(
      `${(err as Error).message}\n--- server log (tail) ---\n${serverLog.slice(-2000)}`
    );
  }

  const dbDeadline = Date.now() + 10_000;
  while (!existsSync(dbPath) && Date.now() < dbDeadline) {
    await new Promise(r => setTimeout(r, 50));
  }
  if (!existsSync(dbPath)) {
    await terminateChild(server, serverExited);
    throw new Error(`SQLite database was not created at ${dbPath}`);
  }
  seedStarterIdentities(dbPath, starterUserId);

  const spawnCli = (
    args: string[],
    env: NodeJS.ProcessEnv = isolatedEnv(home)
  ): { child: ChildProcess; stdout: { text: string }; exited: Promise<number> } => {
    const cli = spawn('bun', args, { cwd: workdir, env, stdio: 'pipe' });
    const buf = { text: '' };
    cli.stdout?.on('data', d => (buf.text += String(d)));
    cli.stderr?.on('data', d => (buf.text += String(d)));
    cli.once('error', error => (buf.text += error.message));
    const exited = track(cli, `bun ${args.join(' ')}`);
    return { child: cli, stdout: buf, exited };
  };

  const runCli = async (args: string[], env?: NodeJS.ProcessEnv): Promise<CliRunResult> => {
    const launched = spawnCli(args, env);
    const code = await launched.exited;
    if (code !== 0) {
      throw new Error(
        `\`bun ${args.join(' ')}\` exited ${code}\n--- output ---\n${launched.stdout.text}`
      );
    }
    return parseCliEnvelope(launched.stdout.text);
  };

  const runWorkflow = async (directive?: string): Promise<string> => {
    const args = [CLI_ENTRY, 'workflow', 'run', E2E_WORKFLOW_NAME];
    if (directive) args.push(directive);
    args.push('--folder', '--json');
    const result = await runCli(args);
    return result.runId;
  };

  const runHitlWorkflow = async (): Promise<CliRunResult> => {
    return runCli([CLI_ENTRY, 'workflow', 'run', E2E_HITL_WORKFLOW_NAME, '--folder', '--json']);
  };

  const runUnownedHitlWorkflow = async (): Promise<CliRunResult> => {
    // Empty ARCHON_USER_ID alone falls back to USER/USERNAME in resolveCliUserId.
    // Remove all three in this subprocess to exercise actual solo CLI ownership.
    return runCli([CLI_ENTRY, 'workflow', 'run', E2E_HITL_WORKFLOW_NAME, '--folder', '--json'], {
      ...isolatedEnv(home),
      ARCHON_USER_ID: '',
      USER: '',
      USERNAME: '',
    });
  };

  const runHitlLongHistoryWorkflow = async (): Promise<CliRunResult> => {
    try {
      return await runCli([
        CLI_ENTRY,
        'workflow',
        'run',
        E2E_HITL_LONG_WORKFLOW_NAME,
        '--folder',
        '--json',
      ]);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('e2e-fake: scenario directive failed validation') &&
        error.message.includes('"unrecognized_keys"') &&
        error.message.includes('"repeatTool"')
      ) {
        throw new UnsupportedSetupError(
          'Target fake provider rejects the long-history repeatTool directive',
          { cause: error }
        );
      }
      throw error;
    }
  };

  const runHitlTwoAsksWorkflow = async (): Promise<CliRunResult> => {
    return runCli([
      CLI_ENTRY,
      'workflow',
      'run',
      E2E_HITL_TWO_ASKS_WORKFLOW_NAME,
      '--folder',
      '--json',
    ]);
  };

  const runTaskDispatchWorkflow = async (): Promise<CliRunResult> => {
    return runCli([
      CLI_ENTRY,
      'workflow',
      'run',
      E2E_TASK_DISPATCH_WORKFLOW_NAME,
      '--folder',
      '--json',
    ]);
  };

  const runFileEditWorkflow = async (): Promise<CliRunResult> => {
    return runCli([
      CLI_ENTRY,
      'workflow',
      'run',
      E2E_FILE_EDIT_WORKFLOW_NAME,
      '--folder',
      '--json',
    ]);
  };

  const runTodoStripWorkflow = async (): Promise<CliRunResult> => {
    try {
      return await runCli([
        CLI_ENTRY,
        'workflow',
        'run',
        E2E_TODO_STRIP_WORKFLOW_NAME,
        '--folder',
        '--json',
      ]);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('e2e-fake: scenario directive failed validation') &&
        error.message.includes('"unrecognized_keys"') &&
        error.message.includes('"emitTodo"')
      ) {
        throw new UnsupportedSetupError(
          'Target fake provider rejects the todo-strip emitTodo directive',
          { cause: error }
        );
      }
      throw error;
    }
  };

  /**
   * Single SQLite entry point for the transcript-display fixture: one
   * `{report}` envelope text row per skipped node, scoped to the occurrence +
   * attempt the executor minted on its `node_skipped` event (read back from the
   * events table so the seeded `metadata.execution` matches), plus an unscoped
   * `node_started`/`node_completed` pair and one raw text row for `ghost`, the
   * node absent from the definition.
   */
  const seedTranscriptDisplayRows = (runId: string): void => {
    const script = `
      import { Database } from 'bun:sqlite';
      const db = new Database(process.env.E2E_DB_PATH);
      const runId = process.env.E2E_RUN_ID;
      const scoped = JSON.parse(process.env.E2E_SCOPED ?? '[]');
      const ghost = JSON.parse(process.env.E2E_GHOST ?? '{}');
      const baseMs = Date.now();
      db.run('BEGIN');
      try {
        for (const item of scoped) {
          const row = db
            .query(
              "SELECT data FROM remote_agent_workflow_events WHERE workflow_run_id = ? AND step_name = ? AND event_type = 'node_skipped' ORDER BY created_at DESC LIMIT 1"
            )
            .get(runId, item.nodeId);
          if (!row) throw new Error('no node_skipped event for ' + item.nodeId);
          const data = JSON.parse(row.data);
          const execution = { occurrence_id: data.occurrence_id, attempt_id: data.attempt_id };
          item.rows.forEach((text, index) => {
            const metadata = {
              execution,
              ...(item.deltas.includes(index) ? { text_mode: 'delta' } : {}),
            };
            db.run(
              'INSERT INTO remote_agent_workflow_node_messages (id, workflow_run_id, node_id, seq, kind, payload, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)',
              [
                crypto.randomUUID(),
                runId,
                item.nodeId,
                index + 1,
                'text',
                JSON.stringify({ text }),
                JSON.stringify(metadata),
              ]
            );
          });
        }
        if (ghost.nodeId) {
          ['node_started', 'node_completed'].forEach((eventType, index) => {
            db.run(
              'INSERT INTO remote_agent_workflow_events (id, workflow_run_id, event_type, step_name, data, created_at) VALUES (?, ?, ?, ?, ?, ?)',
              [
                crypto.randomUUID(),
                runId,
                eventType,
                ghost.nodeId,
                '{}',
                new Date(baseMs + index * 1000).toISOString(),
              ]
            );
          });
          db.run(
            'INSERT INTO remote_agent_workflow_node_messages (id, workflow_run_id, node_id, seq, kind, payload, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [
              crypto.randomUUID(),
              runId,
              ghost.nodeId,
              1,
              'text',
              JSON.stringify({ text: ghost.text }),
              null,
            ]
          );
        }
        db.run('COMMIT');
      } catch (error) {
        db.run('ROLLBACK');
        throw error;
      }
    `;
    const result = spawnSync('bun', ['-e', script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        E2E_DB_PATH: dbPath,
        E2E_RUN_ID: runId,
        E2E_SCOPED: JSON.stringify([
          {
            nodeId: TRANSCRIPT_STRUCTURED_NODE,
            rows: [TRANSCRIPT_FRAGMENT_A, TRANSCRIPT_FRAGMENT_B, ...TRANSCRIPT_INELIGIBLE_TEXTS],
            deltas: [0, 1],
          },
          {
            nodeId: TRANSCRIPT_PLAIN_NODE,
            rows: [transcriptReportEnvelope(TRANSCRIPT_PLAIN_TEXT)],
            deltas: [],
          },
        ]),
        E2E_GHOST: JSON.stringify({
          nodeId: TRANSCRIPT_GHOST_NODE,
          text: transcriptReportEnvelope(TRANSCRIPT_GHOST_TEXT),
        }),
      },
    });
    if (result.status !== 0) {
      throw new Error(`transcript-display seed failed:\n${result.stderr}\n${result.stdout}`);
    }
  };

  const prepareTranscriptDisplayRun = async (): Promise<CliRunResult> => {
    const result = await runCli([
      CLI_ENTRY,
      'workflow',
      'run',
      E2E_TRANSCRIPT_DISPLAY_WORKFLOW_NAME,
      '--folder',
      '--json',
    ]);
    seedTranscriptDisplayRows(result.runId);
    return result;
  };

  const listWorkflowRunIds = async (workflowName: string): Promise<string[]> => {
    const res = await fetch(`${baseURL}/api/workflows/runs?limit=50`);
    if (!res.ok) return [];
    const body = (await res.json()) as {
      runs?: { id?: string; workflow_name?: string; workflowName?: string }[];
    };
    return (body.runs ?? [])
      .filter(
        run =>
          Boolean(run.id) &&
          (run.workflow_name === workflowName || run.workflowName === workflowName)
      )
      .map(run => run.id as string);
  };

  const waitForRunId = async (
    workflowName: string,
    timeoutMs: number,
    excludeIds: ReadonlySet<string>
  ): Promise<string> => {
    const deadline = Date.now() + timeoutMs;
    let lastErr = 'no runs';
    while (Date.now() < deadline) {
      try {
        const ids = await listWorkflowRunIds(workflowName);
        const fresh = ids.find(id => !excludeIds.has(id));
        if (fresh) return fresh;
        lastErr = `no new ${workflowName} run yet (${String(ids.length)} listed)`;
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
      }
      await new Promise(r => setTimeout(r, 200));
    }
    throw new Error(
      `Live run id for ${workflowName} not observed within ${timeoutMs}ms (${lastErr})`
    );
  };

  const startDetachedWorkflow = async (
    workflowName: string,
    message?: string
  ): Promise<LiveWorkflowRun> => {
    const knownIds = new Set(await listWorkflowRunIds(workflowName));
    const args = [CLI_ENTRY, 'workflow', 'run', workflowName];
    if (message !== undefined) args.push(message);
    args.push('--folder', '--json');
    const launched = spawnCli(args);
    const pid = launched.child.pid;
    if (pid === undefined) {
      throw new Error(`workflow '${workflowName}' CLI spawned without a pid`);
    }
    const wait = async (): Promise<CliRunResult> => {
      const code = await launched.exited;
      if (code !== 0) {
        throw new Error(
          `live workflow '${workflowName}' exited ${code}\n--- output ---\n${launched.stdout.text}`
        );
      }
      return parseCliEnvelope(launched.stdout.text);
    };
    return {
      pid,
      command: `bun ${args.join(' ')}`,
      port,
      workdir,
      runId: waitForRunId(workflowName, 30_000, knownIds),
      wait,
    };
  };

  const startHitlWorkflow = async (): Promise<LiveWorkflowRun> => {
    return startDetachedWorkflow(E2E_HITL_WORKFLOW_NAME);
  };

  const resumeWorkflow = async (runId: string): Promise<CliRunResult> => {
    const args = [CLI_ENTRY, 'workflow', 'resume', runId];
    const cli = spawn('bun', args, { cwd: workdir, env: isolatedEnv(home), stdio: 'pipe' });
    let out = '';
    cli.stdout?.on('data', d => (out += String(d)));
    cli.stderr?.on('data', d => (out += String(d)));
    const code = await track(cli, `bun ${args.join(' ')}`);
    if (code !== 0) {
      throw new Error(`\`workflow resume\` exited ${code}\n--- output ---\n${out}`);
    }
    return { runId, stdout: out, state: 'completed' };
  };

  const starterFetch = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers);
    if (!headers.has('X-Archon-User')) {
      headers.set('X-Archon-User', E2E_STARTER_WEB_USER);
    }
    if (init.body !== undefined && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    return fetch(`${baseURL}${path}`, { ...init, headers });
  };

  const readRunStatus = async (runId: string): Promise<string | undefined> => {
    const res = await starterFetch(`/api/workflows/runs/${encodeURIComponent(runId)}`);
    if (!res.ok) return undefined;
    const body = (await res.json()) as { run?: { status?: string } };
    return body.run?.status;
  };

  const waitForRunStatus = async (
    runId: string,
    status: string,
    timeoutMs = 60_000
  ): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    let last = 'no status';
    while (Date.now() < deadline) {
      try {
        const current = await readRunStatus(runId);
        if (current === status) return;
        last = current ?? `HTTP miss`;
      } catch (err) {
        last = err instanceof Error ? err.message : String(err);
      }
      await new Promise(r => setTimeout(r, 250));
    }
    throw new Error(
      `Run ${runId} did not reach status '${status}' within ${timeoutMs}ms (last: ${last})`
    );
  };

  const dispatchWorkflowViaWeb = async (
    workflowName: string,
    message: string
  ): Promise<HitlWebRun> => {
    const knownIds = new Set(await listWorkflowRunIds(workflowName));
    const codebaseRes = await starterFetch('/api/codebases', {
      method: 'POST',
      body: JSON.stringify({ path: workdir }),
    });
    if (!codebaseRes.ok) {
      throw new Error(
        `register folder codebase failed: HTTP ${String(codebaseRes.status)}\n${await codebaseRes.text()}`
      );
    }
    const codebase = (await codebaseRes.json()) as { id?: string };
    if (!codebase.id) {
      throw new Error(`codebase response missing id: ${JSON.stringify(codebase)}`);
    }
    const convRes = await starterFetch('/api/conversations', {
      method: 'POST',
      body: JSON.stringify({ codebaseId: codebase.id }),
    });
    if (!convRes.ok) {
      throw new Error(
        `create conversation failed: HTTP ${String(convRes.status)}\n${await convRes.text()}`
      );
    }
    const conv = (await convRes.json()) as { conversationId?: string };
    if (!conv.conversationId) {
      throw new Error(`conversation response missing conversationId: ${JSON.stringify(conv)}`);
    }
    const runRes = await starterFetch(`/api/workflows/${encodeURIComponent(workflowName)}/run`, {
      method: 'POST',
      body: JSON.stringify({ conversationId: conv.conversationId, message }),
    });
    if (!runRes.ok) {
      throw new Error(
        `web workflow '${workflowName}' run failed: HTTP ${String(runRes.status)}\n${await runRes.text()}`
      );
    }
    const runId = await waitForRunId(workflowName, 30_000, knownIds);
    return { runId, conversationId: conv.conversationId, codebaseId: codebase.id };
  };

  const runHitlWorkflowViaWeb = async (): Promise<HitlWebRun> => {
    const run = await dispatchWorkflowViaWeb(E2E_HITL_WORKFLOW_NAME, 'e2e hitl web');
    await waitForRunStatus(run.runId, 'paused');
    return run;
  };

  const startWorkflowViaWeb = async (
    workflowName: string,
    message: string
  ): Promise<HitlWebRun> => {
    const run = await dispatchWorkflowViaWeb(workflowName, message);
    await waitForRunStatus(run.runId, 'running');
    return run;
  };

  return {
    baseURL,
    home,
    workdir,
    starterUserId,
    starterWebUser: E2E_STARTER_WEB_USER,
    teammateWebUser: E2E_TEAMMATE_WEB_USER,
    runWorkflow,
    runHitlWorkflow,
    runUnownedHitlWorkflow,
    runHitlLongHistoryWorkflow,
    runHitlTwoAsksWorkflow,
    runTaskDispatchWorkflow,
    runFileEditWorkflow,
    runTodoStripWorkflow,
    prepareTranscriptDisplayRun,
    startHitlWorkflow,
    resumeWorkflow,
    runHitlWorkflowViaWeb,
    startWorkflowViaWeb,
    startDetachedWorkflow,
    starterFetch,
    waitForRunStatus,
    stop,
  };
}
