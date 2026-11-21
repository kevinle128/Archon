#!/usr/bin/env bun
/**
 * Archon CLI - Run AI workflows from the command line
 *
 * Usage:
 *   archon workflow list              List available workflows
 *   archon workflow run <name> [msg]  Run a workflow
 *   archon version                    Show version info
 */
// Must be the very first import — strips Bun-auto-loaded CWD .env keys before
// any module reads process.env at init time (e.g. @archon/paths/logger reads LOG_LEVEL).
import '@archon/paths/strip-cwd-env-boot';
// Then load archon-owned env from ~/.archon/.env (user scope) and
// <cwd>/.archon/.env (repo scope, wins over user). Both with override: true.
// See packages/paths/src/env-loader.ts and the three-path model (#1302 / #1303).
import { loadArchonEnv } from '@archon/paths/env-loader';
loadArchonEnv(process.cwd());

import { parseArgs } from 'util';
import { resolve } from 'path';
import { existsSync, realpathSync } from 'fs';

// Smart defaults for Claude auth
// If no explicit tokens, default to global auth from `claude /login`
if (!process.env.CLAUDE_API_KEY && !process.env.CLAUDE_CODE_OAUTH_TOKEN) {
  if (process.env.CLAUDE_USE_GLOBAL_AUTH === undefined) {
    process.env.CLAUDE_USE_GLOBAL_AUTH = 'true';
  }
}

// DATABASE_URL is no longer required - SQLite will be used as default

// Bootstrap provider registry before any provider lookups
import {
  registerBuiltinProviders,
  registerCommunityProviders,
  shutdownLangfuse,
} from '@archon/providers';
registerBuiltinProviders();
registerCommunityProviders();

// Import commands after dotenv is loaded
import { versionCommand } from './commands/version';
import {
  workflowListCommand,
  workflowRunCommand,
  workflowStatusCommand,
  workflowGetCommand,
  workflowRunsCommand,
  workflowResumeCommand,
  workflowRetryCommand,
  workflowRetryNodeCommand,
  workflowCancelCommand,
  workflowAbandonCommand,
  workflowApproveCommand,
  workflowReviewOpenCommand,
  workflowRejectCommand,
  workflowCleanupCommand,
  workflowResetSessionsCommand,
  workflowEventEmitCommand,
  workflowSearchCommand,
  workflowInstallCommand,
  isValidEventType,
} from './commands/workflow';
import { WORKFLOW_EVENT_TYPES } from '@archon/workflows/store';
import {
  isolationListCommand,
  isolationCleanupCommand,
  isolationCleanupMergedCommand,
  isolationCompleteCommand,
} from './commands/isolation';
import {
  providerBindingCreateCommand,
  providerBindingUpdateCommand,
  providerBindingStatusCommand,
  providerBindingRotateCommand,
  providerBindingDisableCommand,
  providerBindingUnsupportedCommand,
} from './commands/provider-binding';
import { providerBindingTestCommand } from './commands/provider-binding-test';
import { continueCommand } from './commands/continue';
import { chatCommand } from './commands/chat';
import { setupCommand } from './commands/setup';
import { skillInstallCommand } from './commands/skill';
import { validateWorkflowsCommand, validateCommandsCommand } from './commands/validate';
import { serveCommand } from './commands/serve';
import { doctorCommand } from './commands/doctor';
import { authGithubCommand } from './commands/auth';
import {
  aiKeySetCommand,
  aiListCommand,
  aiLogoutCommand,
  aiLoginCommand,
  aiTierSetCommand,
  aiTierListCommand,
  aiTierUnsetCommand,
  aiAliasSetCommand,
  aiAliasListCommand,
  aiAliasUnsetCommand,
  aiDefaultCommand,
} from './commands/ai';
import { telemetryStatusCommand, telemetryResetCommand } from './commands/telemetry';
import { usageCommand } from './commands/usage';
import { writeStdout } from './utils/stdout';
import { closeDatabase } from '@archon/core';
import type { WorkflowProviderCommand } from './commands/workflow-provider-command-envelope';
import {
  setLogLevel,
  createLogger,
  checkForUpdate,
  BUNDLED_IS_BINARY,
  BUNDLED_VERSION,
  shutdownTelemetry,
  captureArchonStarted,
  isVerboseBoot,
} from '@archon/paths';
import * as git from '@archon/git';

/** Lazy-initialized logger (deferred so test mocks can intercept createLogger) */
let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('cli');
  return cachedLog;
}

type WorkflowCommandEnvelopeCommand = Extract<
  WorkflowProviderCommand,
  | 'workflow.start'
  | 'workflow.status'
  | 'workflow.approve'
  | 'workflow.reject'
  | 'workflow.resume'
  | 'workflow.retry'
  | 'workflow.cancel'
>;

function getWorkflowCommandEnvelopeCommand(
  command: string | undefined,
  subcommand: string | undefined
): WorkflowCommandEnvelopeCommand | undefined {
  if (command !== 'workflow') return undefined;
  if (subcommand === 'run') return 'workflow.start';
  if (subcommand === 'get') return 'workflow.status';
  if (subcommand === 'approve') return 'workflow.approve';
  if (subcommand === 'reject') return 'workflow.reject';
  if (subcommand === 'resume') return 'workflow.resume';
  if (subcommand === 'retry') return 'workflow.retry';
  if (subcommand === 'cancel') return 'workflow.cancel';
  return undefined;
}

interface RawWorkflowProviderOptions {
  jsonRequested: boolean;
  jsonAssigned: boolean;
  correlationIdValue: string | undefined;
  correlationIdMissingValue: boolean;
}

function scanRawWorkflowProviderOptions(args: string[]): RawWorkflowProviderOptions {
  const end = args.indexOf('--');
  const scanArgs = end === -1 ? args : args.slice(0, end);
  const result: RawWorkflowProviderOptions = {
    jsonRequested: false,
    jsonAssigned: false,
    correlationIdValue: undefined,
    correlationIdMissingValue: false,
  };

  for (let i = 0; i < scanArgs.length; i += 1) {
    const arg = scanArgs[i];
    if (arg === '--json') {
      result.jsonRequested = true;
      continue;
    }
    if (arg.startsWith('--json=')) {
      result.jsonRequested = true;
      result.jsonAssigned = true;
      continue;
    }
    if (arg === '--correlation-id') {
      const next = scanArgs[i + 1];
      if (next === undefined || next.startsWith('--')) {
        result.correlationIdMissingValue = true;
        continue;
      }
      result.correlationIdValue = next;
      i += 1;
      continue;
    }
    if (arg.startsWith('--correlation-id=')) {
      result.correlationIdValue = arg.slice('--correlation-id='.length);
    }
  }

  return result;
}

function findUnsupportedFlag(args: string[], allowedFlags: Set<string>): string | undefined {
  const end = args.indexOf('--');
  const scanArgs = end === -1 ? args : args.slice(0, end);
  for (const arg of scanArgs) {
    if (!arg.startsWith('-')) continue;
    const name = arg.startsWith('--') ? arg.split('=')[0] : arg;
    if (!allowedFlags.has(name)) return name;
  }
  return undefined;
}

const RECOVERY_BASE_FLAGS = new Set(['--json', '--correlation-id', '--cwd', '--help', '-h']);
const RESUME_ALLOWED_FLAGS = RECOVERY_BASE_FLAGS;
const RETRY_ALLOWED_FLAGS = new Set([...RECOVERY_BASE_FLAGS, '--node']);
const CANCEL_ALLOWED_FLAGS = RECOVERY_BASE_FLAGS;

function isBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length === 0;
}

async function emitWorkflowCommandMalformedEnvelope(
  command: WorkflowCommandEnvelopeCommand,
  details: Record<string, unknown>,
  correlationId?: string
): Promise<number> {
  const { safeStringify, resolveCorrelationId, resolveIssuedAt, buildErrorEnvelope } =
    await import('./commands/workflow-provider-command-envelope.js');
  console.log(
    safeStringify(
      buildErrorEnvelope(
        {
          command,
          provider: 'archon',
          correlationId: resolveCorrelationId(correlationId),
          issuedAt: resolveIssuedAt(),
        },
        {
          code: 'MALFORMED_REQUEST',
          category: 'provider_contract',
          retryable: false,
          details,
          exitCode: 64,
        },
        Date.now()
      )
    )
  );
  return 64;
}

async function emitWorkflowCommandInternalErrorEnvelope(
  command: WorkflowCommandEnvelopeCommand,
  details: Record<string, unknown>,
  correlationId?: string
): Promise<number> {
  const { safeStringify, resolveCorrelationId, resolveIssuedAt, buildErrorEnvelope } =
    await import('./commands/workflow-provider-command-envelope.js');
  console.log(
    safeStringify(
      buildErrorEnvelope(
        {
          command,
          provider: 'archon',
          correlationId: resolveCorrelationId(correlationId),
          issuedAt: resolveIssuedAt(),
        },
        {
          code: 'INTERNAL_ERROR',
          category: 'implementation_defect',
          retryable: false,
          details,
          exitCode: 70,
        },
        Date.now()
      )
    )
  );
  return 70;
}

/**
 * Print usage information
 */
function printUsage(): void {
  console.log(`
Archon CLI - Run AI workflows from the command line

Usage:
  archon <command> [subcommand] [options] [arguments]

Commands:
  chat <message>             Send a message to the orchestrator
  setup                      Interactive setup wizard for credentials and config
  workflow list              List available workflows in current directory
  workflow run <name> [msg]  Run a workflow with optional message
  workflow status            Show status of running/paused workflows
  workflow runs              List recent runs (all statuses) for this project
  workflow get <run-id>      Show detail for a single run (any status)
  workflow retry-node <run-id> <node-id> Retry one DAG node in a failed/cancelled/completed run
  workflow resume <run-id>   Resume a failed or paused run from completed nodes
  workflow search [query]    Search the workflow marketplace
  workflow install <slug>    Install a workflow from the marketplace
  isolation list             List all active worktrees/environments
  isolation cleanup [days]   Remove stale environments (default: 7 days)
  isolation cleanup --merged Remove environments with branches merged into main
  continue <branch> [msg]    Continue work on an existing worktree with prior context
  complete <branch> [...]    Complete branch lifecycle (remove worktree + branches)
  serve                      Start the web UI server (downloads web UI on first run)
  skill install [path]       Install the bundled Archon skill into .claude/skills/archon
  doctor [--full]            Verify your Archon setup (Claude/Codex/Grok CLIs, Cursor API key, gh auth, DB, adapters; --full also probes OpenCode)
  auth github                Connect your GitHub identity via device flow (multi-user installs)
  ai key set <provider>      Connect an AI provider API key (multi-user installs; key read from prompt/stdin)
  ai login <provider>        Connect a subscription (claude/copilot) via OAuth — codex is API-key only
  ai list                    List your connected AI provider keys
  ai logout <provider>       Disconnect an AI provider key
  ai tier set <t> <p> <m>    Set a model tier (small/medium/large) → provider/model [--effort <e>] [--scope user|install]
  ai tier list [--json]      Show configured tiers (install + yours) vs built-in defaults
  ai tier unset <tier>       Reset a tier to its built-in default [--scope user|install]
  ai alias set <@n> <p> <m>  Set a @custom model alias [--effort <e>] [--scope user|install]
  ai alias list [--json]     Show configured @custom aliases (install + yours)
  ai alias unset <@name>     Remove a @custom alias [--scope user|install]
  ai default <p> [<model>]   Set the default assistant (+ chat model) [--scope user|install]
  telemetry status           Show anonymous telemetry state (enabled, reason, ID, host)
  telemetry reset            Rotate the anonymous install UUID
  validate workflows [name]  Validate workflow definitions and their references
  usage                       Installation-wide workflow usage/cost report (--since/--until, --json)
  validate commands [name]   Validate command files
  provider-binding create    Create a provider binding (--transform-file, --receiver-headers-file)
  provider-binding update    Update a provider binding (--transform-file, --receiver-headers-file)
  provider-binding test      Dry-run a binding transform (--transform-file, --envelope-file, --json)
  version, --version, -V     Show version info (also -v when used alone)
  help                       Show this help message

Options:
  --cwd <path>               Override working directory (default: current directory)
  --branch, -b <name>        Create worktree for branch (or reuse existing)
  --from, --from-branch <name> Create new branch from specific start point
  --base <branch>            Per-dispatch base override for epic slices (worktree cut-from + PR target)
  --no-worktree              Run on branch directly without worktree isolation
  --folder                   Register the current non-git directory as a folder project and run in place
  --input <name>=<value>     Supply a declared workflow input; repeat per input (mutually exclusive with --resume)
  --resume                   Resume the most recent failed or paused run of the workflow (mutually exclusive with --branch)
  --dry-run                  Simulate workflow DAG control flow without creating a run or contacting a provider
  --stubs <path>             YAML node-output map for --dry-run
  --exec-code                Execute trusted bash/script nodes during --dry-run (default: require stubs)
  --pause-at-gates           Stop a dry-run at approval gates instead of auto-approving
  --spawn                    Open setup wizard in a new terminal window (for setup command)
  --quiet, -q                Reduce log verbosity to warnings and errors only
  --verbose, -v              Show debug-level output
  --json                     Output machine-readable JSON (list/status/get/runs/approve/reject/abandon/resume)
  --events                   For verbose JSON status/get: output raw event rows instead of node summaries
  --detach                   Run 'workflow run' in a detached background child (returns immediately)
  --all                      For 'workflow runs': list across all projects (ignore cwd scope)
  --status <status>          For 'workflow runs': filter to one status (running, completed, failed, ...)
  --limit <n>                For 'workflow runs': max rows (default 20)
  --workflow <name>          Workflow to run for 'continue' (default: archon-assist)
  --no-context               Skip context injection for 'continue'
  --conversation-id <id>     Reuse a stable conversation scope across runs (enables
                             persist_session resume between separate CLI invocations)
  --port <port>              Override server port for 'serve' (default: 3090)
  --download-only            Download web UI without starting the server
  --force                    Overwrite existing file (for workflow install)

Examples:
  archon chat "What does the orchestrator do?"
  archon workflow list
  archon workflow run investigate-issue "Fix the login bug"
  archon workflow run plan --cwd /path/to/repo "Add dark mode"
  archon workflow run implement --branch feature-auth "Implement auth"
  archon workflow run quick-fix --no-worktree "Fix typo"
  archon workflow run assist --folder "List every repo under this multi-repo root"
  archon workflow run archon-assist --detach "Investigate the flaky test"
  archon workflow run assist --dry-run --stubs ./stubs.yaml --json
  archon workflow runs --json
  archon workflow get <run-id> --json
  archon workflow retry-node <run-id> <node-id>
  archon workflow resume <run-id>
  archon continue fix/issue-42 --workflow archon-smart-pr-review "Review the changes"
  archon skill install
  archon skill install /path/to/project
  archon workflow search "pr review"
  archon workflow install archon-piv-loop
`);
}

/**
 * Safely close the database connection
 */
async function closeDb(): Promise<void> {
  try {
    await closeDatabase();
  } catch (error) {
    const err = error as Error;
    // Log with details but don't throw - we want the original error to be visible
    getLog().warn({ err }, 'db_close_failed');
  }
}

async function printUpdateNotice(quiet: boolean | undefined): Promise<void> {
  if (quiet || !BUNDLED_IS_BINARY) return;
  try {
    const result = await checkForUpdate(BUNDLED_VERSION);
    if (result?.updateAvailable) {
      process.stderr.write(
        `Update available: v${result.currentVersion} → v${result.latestVersion} — ${result.releaseUrl}\n`
      );
    }
  } catch (err) {
    getLog().debug({ err }, 'update_check.notice_failed');
  }
}

/**
 * Main CLI entry point
 * Returns exit code (0 = success, non-zero = failure)
 */
/**
 * Detect a request for version output. Treats `--version`, `-V`, and the
 * single-dash typo `-version` as version flags anywhere in argv. `-v` keeps
 * its role as the short alias for `--verbose`, except when used alone — then
 * it falls back to version output to match the convention used by node, npm,
 * bun, and most other CLIs.
 */
function isVersionRequest(args: string[]): boolean {
  if (args.length === 1 && args[0] === '-v') return true;
  return args.some(arg => arg === '--version' || arg === '-V' || arg === '-version');
}

function normalizeProviderBindingArgs(args: string[]): string[] {
  if (!args.includes('provider-binding')) return args;

  const stringOptions = new Set([
    '--provider',
    '--name',
    '--project-ref',
    '--route',
    '--event-types',
    '--correlation-id',
    '--transform-file',
    '--receiver-headers-file',
    '--envelope-file',
  ]);
  const normalized: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    normalized.push(arg);
    if (!stringOptions.has(arg) || arg.includes('=')) continue;

    const next = args[i + 1];
    if (next === undefined || next.startsWith('-')) {
      normalized.push('');
    }
  }

  return normalized;
}

async function main(): Promise<number> {
  const args = normalizeProviderBindingArgs(process.argv.slice(2));
  const rawWorkflowProviderOptions = scanRawWorkflowProviderOptions(args);
  const providerBindingIndex = args.indexOf('provider-binding');
  const isSideEffectFreeBindingTest =
    providerBindingIndex >= 0 && args[providerBindingIndex + 1] === 'test';

  // Anonymous once-per-invocation startup event (self-gates on opt-out).
  // The provider-binding dry-run is explicitly side-effect-free, including
  // telemetry and first-run notice state.
  // Emitted before any early return so EVERY invocation — including bare
  // `archon`, `--help`, and `--version` — is counted, matching the
  // "once per CLI invocation" contract. Each early-return path below flushes
  // via shutdownTelemetry(); the main command path flushes in its finally.
  if (!isSideEffectFreeBindingTest) captureArchonStarted({ surface: 'cli' });

  // Handle no arguments - show help and exit successfully
  if (args.length === 0) {
    printUsage();
    await shutdownTelemetry();
    return 0;
  }

  // Version flag aliases bypass option parsing and the git-repo check so
  // `archon --version` works the same as `archon version` from any directory.
  if (isVersionRequest(args)) {
    try {
      await versionCommand();
      return 0;
    } finally {
      await shutdownTelemetry();
      await closeDb();
    }
  }

  // Parse global options
  let parsedArgs: { values: Record<string, unknown>; positionals: string[] };

  try {
    parsedArgs = parseArgs({
      args,
      options: {
        cwd: { type: 'string', default: process.cwd() },
        help: { type: 'boolean', short: 'h' },
        branch: { type: 'string', short: 'b' },
        from: { type: 'string' },
        'from-branch': { type: 'string' },
        base: { type: 'string' },
        'no-worktree': { type: 'boolean' },
        folder: { type: 'boolean' },
        container: { type: 'boolean' },
        resume: { type: 'boolean' },
        spawn: { type: 'boolean' },
        quiet: { type: 'boolean', short: 'q' },
        verbose: { type: 'boolean', short: 'v' },
        json: { type: 'boolean' },
        events: { type: 'boolean' },
        'run-id': { type: 'string' },
        type: { type: 'string' },
        data: { type: 'string' },
        comment: { type: 'string' },
        reason: { type: 'string' },
        workflow: { type: 'string' },
        'no-context': { type: 'boolean' },
        port: { type: 'string' },
        'download-only': { type: 'boolean' },
        scope: { type: 'string' },
        node: { type: 'string' },
        yes: { type: 'boolean' },
        force: { type: 'boolean' },
        'conversation-id': { type: 'string' },
        detach: { type: 'boolean' },
        all: { type: 'boolean' },
        status: { type: 'string' },
        limit: { type: 'string' },
        effort: { type: 'string' },
        provider: { type: 'string' },
        name: { type: 'string' },
        'project-ref': { type: 'string' },
        route: { type: 'string' },
        'event-types': { type: 'string' },
        'correlation-id': { type: 'string' },
        'transform-file': { type: 'string' },
        'receiver-headers-file': { type: 'string' },
        'envelope-file': { type: 'string' },
        full: { type: 'boolean' },
        since: { type: 'string' },
        until: { type: 'string' },
        by: { type: 'string' },
        'codebase-id': { type: 'string' },
        agent: { type: 'string' },
        model: { type: 'string' },
        kind: { type: 'string' },
        'dry-run': { type: 'boolean' },
        stubs: { type: 'string' },
        'exec-code': { type: 'boolean' },
        'pause-at-gates': { type: 'boolean' },
        // Repeatable: `--input a=1 --input b=2` yields ['a=1', 'b=2'] (#2554).
        input: { type: 'string', multiple: true },
      },
      allowPositionals: true,
      strict: false, // Allow unknown flags to pass through
    });
  } catch (error) {
    const err = error as Error;
    if (rawWorkflowProviderOptions.jsonRequested) {
      const envelopeCommand = getWorkflowCommandEnvelopeCommand(args[0], args[1]);
      if (envelopeCommand !== undefined) {
        const exitCode = await emitWorkflowCommandMalformedEnvelope(
          envelopeCommand,
          {
            parseError: err.message,
            requestAccepted: false,
          },
          rawWorkflowProviderOptions.correlationIdValue
        );
        await shutdownTelemetry();
        return exitCode;
      }
    }
    console.error(`Error parsing arguments: ${err.message}`);
    printUsage();
    await shutdownTelemetry();
    return 1;
  }

  const { values, positionals } = parsedArgs;
  const cwdValue = values.cwd;
  const cwd = resolve(typeof cwdValue === 'string' ? cwdValue : process.cwd());
  const branchName = values.branch as string | undefined;
  const fromBranch =
    (values.from as string | undefined) ?? (values['from-branch'] as string | undefined);
  const baseBranch = values.base as string | undefined;
  const noWorktree = values['no-worktree'] as boolean | undefined;
  const folderFlag = values.folder as boolean | undefined;
  const containerFlag = values.container as boolean | undefined;
  const resumeFlag = values.resume as boolean | undefined;
  const spawnFlag = values.spawn as boolean | undefined;
  const rawJsonValue = values.json;
  const invalidJsonFlag = rawJsonValue !== undefined && typeof rawJsonValue !== 'boolean';
  const jsonFlag = rawJsonValue === true ? true : undefined;
  const detachFlag = values.detach as boolean | undefined;
  const dryRunFlag = values['dry-run'] as boolean | undefined;
  const stubsPath = values.stubs as string | undefined;
  const execCodeFlag = values['exec-code'] as boolean | undefined;
  const pauseAtGatesFlag = values['pause-at-gates'] as boolean | undefined;
  // Handle help flag
  if (values.help) {
    printUsage();
    await shutdownTelemetry();
    return 0;
  }

  // Get command and subcommand
  const command = positionals[0];
  const subcommand = positionals[1];
  const envelopeCommand = getWorkflowCommandEnvelopeCommand(command, subcommand);
  const workflowProviderJsonRequested =
    envelopeCommand !== undefined &&
    (jsonFlag === true || invalidJsonFlag || rawWorkflowProviderOptions.jsonRequested);

  // Commands that don't require git repo validation
  const noGitCommands = [
    'version',
    'help',
    'setup',
    'chat',
    'continue',
    'serve',
    'skill',
    'doctor',
    'telemetry',
    'auth',
    'ai',
    'provider-binding',
    'usage',
  ];
  const requiresGitRepo = !noGitCommands.includes(command ?? '');

  try {
    // setup/doctor/telemetry default to warn to avoid Pino info JSON interleaving with their human-readable output; lazy loggers pick up this level at first creation
    const isInteractiveCommand =
      command === 'setup' || command === 'doctor' || command === 'telemetry' || command === 'usage';
    const suppressByDefault = isInteractiveCommand && !values.verbose && !isVerboseBoot();
    // --json must keep stdout to EXACTLY the machine-readable payload. Pino's
    // default destination is stdout, so even one warn/error line would precede
    // the JSON and break JSON.parse for a consuming agent. Silence logs entirely
    // (not just lower to 'warn' — warnings still print at that level): every
    // --json command surfaces failures inside its own { ok: false } envelope, so
    // no diagnostic the caller needs is lost.
    if (jsonFlag || workflowProviderJsonRequested) {
      setLogLevel('silent');
    } else if (values.quiet || suppressByDefault) {
      setLogLevel('warn');
    } else if (values.verbose) {
      setLogLevel('debug');
    }

    if (workflowProviderJsonRequested && envelopeCommand !== undefined) {
      const parsedCorrelationId = values['correlation-id'];
      if (
        rawWorkflowProviderOptions.correlationIdMissingValue ||
        isBlankString(parsedCorrelationId)
      ) {
        return await emitWorkflowCommandMalformedEnvelope(envelopeCommand, {
          fieldErrors: [{ path: '/correlationId', code: 'required' }],
          requestAccepted: false,
        });
      }
      if (invalidJsonFlag || rawWorkflowProviderOptions.jsonAssigned) {
        return await emitWorkflowCommandMalformedEnvelope(
          envelopeCommand,
          {
            fieldErrors: [{ path: '/json', code: 'must_be_boolean_flag' }],
            requestAccepted: false,
          },
          parsedCorrelationId as string | undefined
        );
      }
      if (rawWorkflowProviderOptions.jsonRequested && jsonFlag === undefined && !invalidJsonFlag) {
        return await emitWorkflowCommandMalformedEnvelope(
          envelopeCommand,
          {
            fieldErrors: [{ path: '/json', code: 'consumed_as_option_value' }],
            requestAccepted: false,
          },
          parsedCorrelationId as string | undefined
        );
      }
    }

    // Note: orphaned run cleanup moved to `workflow cleanup` command only.
    // Running it on every CLI startup killed parallel workflow runs (all
    // 'running' status rows were marked failed by each new process).

    // Marketplace search doesn't need a git repo — handle before git validation
    if (command === 'workflow' && subcommand === 'search') {
      const query = positionals[2];
      try {
        await workflowSearchCommand(query, jsonFlag);
      } catch (error) {
        const err = error as Error;
        console.error(`Error: ${err.message}`);
        return 1;
      }
      return 0;
    }

    // Validate working directory exists
    let effectiveCwd = cwd;
    if (requiresGitRepo) {
      if (!existsSync(cwd)) {
        const envelopeCommand = getWorkflowCommandEnvelopeCommand(command, subcommand);
        if (jsonFlag && envelopeCommand !== undefined) {
          return await emitWorkflowCommandMalformedEnvelope(
            envelopeCommand,
            {
              fieldErrors: [{ path: '/cwd', code: 'directory_not_found' }],
              requestAccepted: false,
            },
            values['correlation-id'] as string | undefined
          );
        }
        console.error(`Error: Directory does not exist: ${cwd}`);
        return 1;
      }

      // Validate git repository and resolve to root
      let repoRoot: string | null;
      try {
        repoRoot = await git.findRepoRoot(cwd);
      } catch (gitError) {
        // Unexpected git failure (binary missing, permission error) — not "not a repo".
        const envelopeCommand = getWorkflowCommandEnvelopeCommand(command, subcommand);
        if (jsonFlag && envelopeCommand !== undefined) {
          return await emitWorkflowCommandInternalErrorEnvelope(
            envelopeCommand,
            {
              fieldErrors: [{ path: '/cwd', code: 'git_preflight_failed' }],
              requestAccepted: false,
            },
            values['correlation-id'] as string | undefined
          );
        }
        throw gitError;
      }
      if (repoRoot) {
        // Use repo root as working directory (handles subdirectory case)
        effectiveCwd = repoRoot;
      } else if (dryRunFlag && command === 'workflow' && subcommand === 'run') {
        // Dry-run only discovers workflow files and simulates in memory. It does
        // not need project registration, a database lookup, or a git worktree.
        effectiveCwd = cwd;
      } else {
        // Not a git repo. It may still be a registered FOLDER project (a
        // multi-repo root or plain ops folder). Consult the DB before rejecting.
        // Canonicalize symlinks first so the lookup matches the realpath'd
        // default_cwd that registration stores: process.cwd() resolves symlinks,
        // but an explicit --cwd does not, so realpath here covers both. (cwd is
        // already validated to exist above; fall back to cwd if realpath fails.)
        let realCwd = cwd;
        try {
          realCwd = realpathSync(cwd);
        } catch {
          // keep the resolved cwd
        }
        // The DB may be unreachable. A lookup failure must NOT crash pre-dispatch
        // (workflow/isolation commands still need to surface a clear error rather
        // than a stack trace) — capture it and, if connection-shaped, report
        // "database unavailable" instead of the misleading "not a git repository".
        let folderCodebase: { default_cwd: string; kind: 'repo' | 'folder' } | null = null;
        let gateLookupError: Error | null = null;
        try {
          const codebaseDb = await import('@archon/core/db/codebases');
          folderCodebase =
            (await codebaseDb.findCodebaseByDefaultCwd(realCwd)) ??
            (await codebaseDb.findCodebaseByPathPrefix(realCwd));
        } catch (dbError) {
          gateLookupError = dbError as Error;
          getLog().warn(
            { err: gateLookupError, cwd: realCwd },
            'cli.folder_project_gate_lookup_failed'
          );
        }

        const looksLikeConnectionError = (e: Error): boolean => {
          const m = e.message.toLowerCase();
          return m.includes('econnrefused') || m.includes('etimedout') || m.includes('connect');
        };

        if (folderCodebase?.kind === 'folder') {
          // Registered folder project — run in place at its root.
          effectiveCwd = folderCodebase.default_cwd;
        } else if (folderFlag && command === 'workflow' && subcommand === 'run') {
          // First-use `workflow run --folder` from an unregistered non-git dir:
          // let it through so the run command registers the folder project.
          effectiveCwd = realCwd;
        } else if (gateLookupError && looksLikeConnectionError(gateLookupError)) {
          // A DB outage is an infrastructure failure, not a malformed request.
          if (jsonFlag && envelopeCommand !== undefined) {
            return await emitWorkflowCommandInternalErrorEnvelope(
              envelopeCommand,
              {
                fieldErrors: [{ path: '/cwd', code: 'database_unavailable' }],
                requestAccepted: false,
              },
              values['correlation-id'] as string | undefined
            );
          }
          console.error(
            'Error: Could not verify project registration — the database is unavailable.'
          );
          console.error(`  ${gateLookupError.message}`);
          console.error(
            '  Check that your database is running (or DATABASE_URL is set), then retry.'
          );
          return 1;
        } else {
          if (jsonFlag && envelopeCommand !== undefined) {
            return await emitWorkflowCommandMalformedEnvelope(
              envelopeCommand,
              {
                fieldErrors: [{ path: '/cwd', code: 'not_a_git_repository' }],
                requestAccepted: false,
              },
              values['correlation-id'] as string | undefined
            );
          }
          console.error('Error: Not in a git repository.');
          console.error('The Archon CLI must be run from within a git repository.');
          console.error('Either navigate to a git repo or use --cwd to specify one.');
          console.error(
            'Or register this folder as a project: run with --folder, or use /register-project in chat.'
          );
          return 1;
        }
      }
    }

    switch (command) {
      case 'version':
        await versionCommand();
        break;

      case 'help':
        printUsage();
        break;

      case 'chat': {
        const chatMessage = positionals.slice(1).join(' ');
        if (!chatMessage) {
          console.error('Usage: archon chat <message>');
          return 1;
        }
        await chatCommand(chatMessage);
        break;
      }

      case 'setup': {
        const rawScope = values.scope as string | undefined;
        if (rawScope !== undefined && rawScope !== 'home' && rawScope !== 'project') {
          console.error(`Error: Invalid --scope: "${rawScope}". Must be "home" or "project".`);
          return 1;
        }
        const scope: 'home' | 'project' = rawScope ?? 'home';
        const forceFlag = (values.force as boolean | undefined) ?? false;
        // For --scope project, resolve to the git repo root so running from a
        // subdirectory writes to <repo-root>/.archon/.env (what loadArchonEnv
        // reads at boot) — not <subdir>/.archon/.env.
        let repoPath = cwd;
        if (scope === 'project') {
          const repoRoot = await git.findRepoRoot(cwd);
          if (!repoRoot) {
            console.error('Error: --scope project requires running from inside a git repository.');
            console.error('Run from the repo root, pass --cwd <repo>, or use --scope home.');
            return 1;
          }
          repoPath = repoRoot;
        }
        await setupCommand({ spawn: spawnFlag, repoPath, scope, force: forceFlag });
        break;
      }

      case 'workflow':
        switch (subcommand) {
          case 'list':
            await workflowListCommand(effectiveCwd, jsonFlag);
            break;

          case 'run': {
            const workflowName = positionals[2];
            const correlationId = values['correlation-id'];
            if (jsonFlag && isBlankString(correlationId)) {
              return await emitWorkflowCommandMalformedEnvelope('workflow.start', {
                fieldErrors: [{ path: '/correlationId', code: 'required' }],
                requestAccepted: false,
              });
            }
            if (!workflowName) {
              if (jsonFlag) {
                // Let workflowRunCommand handle the missing name as a MALFORMED_REQUEST envelope.
                // Pass an empty string; the function's discovery + resolveWorkflowName will throw
                // "not found" which the fail-closed boundary converts to the envelope.
              } else {
                console.error('Usage: archon workflow run <name> [message]');
                return 1;
              }
            }
            const userMessage = positionals.slice(3).join(' ') || '';
            if (!jsonFlag) {
              if (branchName !== undefined && noWorktree) {
                console.error(
                  'Error: --branch and --no-worktree are mutually exclusive.\n' +
                    '  --branch creates an isolated worktree (safe).\n' +
                    '  --no-worktree runs directly in your repo (no isolation).\n' +
                    'Use one or the other.'
                );
                return 1;
              }
              if (noWorktree && fromBranch !== undefined) {
                console.error(
                  'Error: --from/--from-branch has no effect with --no-worktree.\n' +
                    'Remove --from or drop --no-worktree.'
                );
                return 1;
              }
              if (noWorktree && baseBranch !== undefined) {
                console.error(
                  'Error: --base has no effect with --no-worktree.\n' +
                    'Remove --base or drop --no-worktree.'
                );
                return 1;
              }
              if (resumeFlag && branchName !== undefined) {
                console.error(
                  'Error: --resume and --branch are mutually exclusive.\n' +
                    '  --resume reuses the existing worktree from the failed run.\n' +
                    '  Remove --branch when using --resume.'
                );
                return 1;
              }
            }
            const options = {
              branchName,
              fromBranch,
              baseBranch,
              noWorktree,
              folder: folderFlag,
              container: containerFlag,
              resume: resumeFlag,
              quiet: values.quiet as boolean | undefined,
              verbose: values.verbose as boolean | undefined,
              conversationId: values['conversation-id'] as string | undefined,
              detach: detachFlag,
              json: jsonFlag,
              correlationId: correlationId as string | undefined,
              dryRun: dryRunFlag,
              stubsPath,
              execCode: execCodeFlag,
              pauseAtGates: pauseAtGatesFlag,
              // Raw `name=value` assignments; parsed at the invocation gate (#2554).
              inputs: values.input as string[] | undefined,
            };
            return await workflowRunCommand(effectiveCwd, workflowName ?? '', userMessage, options);
          }

          case 'status':
            await workflowStatusCommand(
              jsonFlag,
              values.verbose as boolean | undefined,
              values.events as boolean | undefined
            );
            break;

          case 'get': {
            const getRunId = positionals[2];
            const correlationId = values['correlation-id'];
            if (jsonFlag && isBlankString(correlationId)) {
              return await emitWorkflowCommandMalformedEnvelope('workflow.status', {
                fieldErrors: [{ path: '/correlationId', code: 'required' }],
                requestAccepted: false,
              });
            }
            if (!getRunId) {
              if (jsonFlag) {
                // Emit a workflow.status MALFORMED_REQUEST envelope for missing run id.
                const {
                  safeStringify: ss,
                  resolveCorrelationId: rci,
                  resolveIssuedAt: ria,
                  buildErrorEnvelope: bee,
                } = await import('./commands/workflow-provider-command-envelope.js');
                let corrId = 'unknown';
                let issuedAt = new Date(0).toISOString();
                try {
                  corrId = rci(values['correlation-id'] as string | undefined);
                  issuedAt = ria();
                } catch {
                  // Helpers currently never throw, but guard against future changes
                }
                console.log(
                  ss(
                    bee(
                      {
                        command: 'workflow.status',
                        provider: 'archon',
                        correlationId: corrId,
                        issuedAt,
                      },
                      {
                        code: 'MALFORMED_REQUEST',
                        category: 'provider_contract',
                        retryable: false,
                        details: {
                          fieldErrors: [{ path: '/runId', code: 'required' }],
                          requestAccepted: false,
                        },
                        exitCode: 64,
                      },
                      Date.now()
                    )
                  )
                );
                return 64;
              }
              console.error('Usage: archon workflow get <run-id> [--json] [--verbose] [--events]');
              return 1;
            }
            return await workflowGetCommand(
              getRunId,
              jsonFlag,
              values.verbose as boolean | undefined,
              effectiveCwd,
              correlationId as string | undefined,
              values.events as boolean | undefined
            );
          }

          case 'runs': {
            const rawLimit = values.limit as string | undefined;
            let limit: number | undefined;
            if (rawLimit !== undefined) {
              limit = Number(rawLimit);
              if (!Number.isInteger(limit) || limit < 1) {
                console.error(`Error: --limit must be a positive integer, got '${rawLimit}'.`);
                return 1;
              }
            }
            await workflowRunsCommand(effectiveCwd, {
              json: jsonFlag,
              all: values.all as boolean | undefined,
              status: values.status as string | undefined,
              limit,
            });
            break;
          }

          case 'resume': {
            const resumeRunId = positionals[2];
            if (!resumeRunId) {
              if (jsonFlag && envelopeCommand) {
                return await emitWorkflowCommandMalformedEnvelope(
                  envelopeCommand,
                  {
                    missingArgument: 'run-id',
                    usage: 'archon workflow resume <run-id> [--json]',
                  },
                  rawWorkflowProviderOptions.correlationIdValue
                );
              }
              console.error('Usage: archon workflow resume <run-id>');
              return 1;
            }
            if (positionals[3] !== undefined) {
              if (jsonFlag && envelopeCommand) {
                return await emitWorkflowCommandMalformedEnvelope(
                  envelopeCommand,
                  {
                    parseError: 'Unexpected extra argument after run-id',
                    requestAccepted: false,
                  },
                  rawWorkflowProviderOptions.correlationIdValue
                );
              }
              console.error(
                'Error: unexpected extra argument after run-id. Usage: archon workflow resume <run-id> [--json]'
              );
              return 1;
            }
            if (jsonFlag && envelopeCommand) {
              const unsupported = findUnsupportedFlag(args, RESUME_ALLOWED_FLAGS);
              if (unsupported) {
                return await emitWorkflowCommandMalformedEnvelope(
                  envelopeCommand,
                  {
                    parseError: `Unsupported flag for resume --json: '${unsupported}'`,
                    requestAccepted: false,
                  },
                  rawWorkflowProviderOptions.correlationIdValue
                );
              }
            }
            await workflowResumeCommand(
              resumeRunId,
              jsonFlag,
              effectiveCwd,
              values['correlation-id'] as string | undefined
            );
            break;
          }

          case 'retry-node': {
            const retryRunId = positionals[2];
            const retryNodeId = positionals[3];
            if (!retryRunId || !retryNodeId) {
              console.error('Usage: archon workflow retry-node <run-id> <node-id>');
              return 1;
            }
            if (jsonFlag) {
              console.error(
                'Error: workflow retry-node does not support --json in v1 because retry execution streams output.'
              );
              return 1;
            }
            await workflowRetryNodeCommand(retryRunId, retryNodeId, jsonFlag);
            break;
          }

          case 'retry': {
            if (!jsonFlag) {
              console.error(
                'Error: `workflow retry` requires --json. For interactive retry, use `workflow retry-node <run-id> <node-id>`.'
              );
              return 1;
            }
            const retryRunId = positionals[2];
            if (!retryRunId) {
              if (envelopeCommand) {
                return await emitWorkflowCommandMalformedEnvelope(
                  envelopeCommand,
                  {
                    missingArgument: 'run-id',
                    usage: 'archon workflow retry <run-id> [--node <node-id>] --json',
                  },
                  rawWorkflowProviderOptions.correlationIdValue
                );
              }
              console.error('Usage: archon workflow retry <run-id> [--node <node-id>] --json');
              return 1;
            }
            if (positionals[3] !== undefined) {
              if (envelopeCommand) {
                return await emitWorkflowCommandMalformedEnvelope(
                  envelopeCommand,
                  {
                    parseError: 'Unexpected extra argument after run-id',
                    requestAccepted: false,
                  },
                  rawWorkflowProviderOptions.correlationIdValue
                );
              }
              console.error(
                'Error: unexpected extra argument after run-id. Usage: archon workflow retry <run-id> [--node <node-id>] --json'
              );
              return 1;
            }
            const rawNodeId = values.node;
            if (
              rawNodeId !== undefined &&
              (typeof rawNodeId !== 'string' ||
                rawNodeId.trim() === '' ||
                rawNodeId.startsWith('-'))
            ) {
              if (envelopeCommand) {
                return await emitWorkflowCommandMalformedEnvelope(
                  envelopeCommand,
                  {
                    fieldErrors: [{ path: '/node', code: 'must_be_non_blank_string' }],
                    requestAccepted: false,
                  },
                  rawWorkflowProviderOptions.correlationIdValue
                );
              }
              console.error('Error: --node value must be a non-blank string');
              return 1;
            }
            const nodeId = typeof rawNodeId === 'string' ? rawNodeId : undefined;
            {
              const unsupported = findUnsupportedFlag(args, RETRY_ALLOWED_FLAGS);
              if (unsupported && envelopeCommand) {
                return await emitWorkflowCommandMalformedEnvelope(
                  envelopeCommand,
                  {
                    parseError: `Unsupported flag for retry --json: '${unsupported}'`,
                    requestAccepted: false,
                  },
                  rawWorkflowProviderOptions.correlationIdValue
                );
              }
            }
            await workflowRetryCommand(
              retryRunId,
              nodeId,
              jsonFlag,
              effectiveCwd,
              values['correlation-id'] as string | undefined
            );
            break;
          }

          case 'cancel': {
            if (!jsonFlag) {
              console.error(
                'Error: `workflow cancel` requires --json. Use `workflow abandon <run-id>` to cancel a run interactively.'
              );
              return 1;
            }
            const cancelRunId = positionals[2];
            if (!cancelRunId) {
              if (envelopeCommand) {
                return await emitWorkflowCommandMalformedEnvelope(
                  envelopeCommand,
                  {
                    missingArgument: 'run-id',
                    usage: 'archon workflow cancel <run-id> --json',
                  },
                  rawWorkflowProviderOptions.correlationIdValue
                );
              }
              console.error('Usage: archon workflow cancel <run-id> --json');
              return 1;
            }
            if (positionals[3] !== undefined) {
              if (envelopeCommand) {
                return await emitWorkflowCommandMalformedEnvelope(
                  envelopeCommand,
                  {
                    parseError: 'Unexpected extra argument after run-id',
                    requestAccepted: false,
                  },
                  rawWorkflowProviderOptions.correlationIdValue
                );
              }
              console.error(
                'Error: unexpected extra argument after run-id. Usage: archon workflow cancel <run-id> --json'
              );
              return 1;
            }
            {
              const unsupported = findUnsupportedFlag(args, CANCEL_ALLOWED_FLAGS);
              if (unsupported && envelopeCommand) {
                return await emitWorkflowCommandMalformedEnvelope(
                  envelopeCommand,
                  {
                    parseError: `Unsupported flag for cancel --json: '${unsupported}'`,
                    requestAccepted: false,
                  },
                  rawWorkflowProviderOptions.correlationIdValue
                );
              }
            }
            await workflowCancelCommand(
              cancelRunId,
              jsonFlag,
              effectiveCwd,
              values['correlation-id'] as string | undefined
            );
            break;
          }

          case 'abandon': {
            const abandonRunId = positionals[2];
            if (!abandonRunId) {
              console.error('Usage: archon workflow abandon <run-id>');
              return 1;
            }
            await workflowAbandonCommand(abandonRunId, jsonFlag, effectiveCwd);
            break;
          }

          case 'approve': {
            const approveRunId = positionals[2];
            if (!approveRunId) {
              if (workflowProviderJsonRequested && envelopeCommand) {
                return await emitWorkflowCommandMalformedEnvelope(
                  envelopeCommand,
                  {
                    missingArgument: 'run-id',
                    usage: 'archon workflow approve <run-id> [comment]',
                  },
                  rawWorkflowProviderOptions.correlationIdValue
                );
              }
              console.error('Usage: archon workflow approve <run-id> [comment]');
              return 1;
            }
            // Accept comment as positional args (everything after run ID) or --comment flag.
            // Explicit empty→undefined conversion (not `|| undefined`): "no comment" must
            // reach approveWorkflow as undefined so a signal-bearing interactive-loop gate
            // finalizes instead of re-running (#2074, loop_feedback_given).
            const rawApproveComment =
              (values.comment as string | undefined) || positionals.slice(3).join(' ');
            const approveComment = rawApproveComment.length > 0 ? rawApproveComment : undefined;
            return await workflowApproveCommand(
              approveRunId,
              approveComment,
              jsonFlag,
              values['correlation-id'] as string | undefined,
              effectiveCwd
            );
          }

          case 'review-open': {
            const reviewOpenRunId = positionals[2];
            if (!reviewOpenRunId) {
              console.error('Usage: archon workflow review-open <run-id>');
              return 1;
            }
            return await workflowReviewOpenCommand(reviewOpenRunId, jsonFlag, effectiveCwd);
          }

          case 'reject': {
            const rejectRunId = positionals[2];
            if (!rejectRunId) {
              if (workflowProviderJsonRequested && envelopeCommand) {
                return await emitWorkflowCommandMalformedEnvelope(
                  envelopeCommand,
                  { missingArgument: 'run-id', usage: 'archon workflow reject <run-id> [reason]' },
                  rawWorkflowProviderOptions.correlationIdValue
                );
              }
              console.error('Usage: archon workflow reject <run-id> [reason]');
              return 1;
            }
            const rawRejectReason =
              (values.reason as string | undefined) || positionals.slice(3).join(' ');
            const rejectReason = rawRejectReason.length > 0 ? rawRejectReason : undefined;
            return await workflowRejectCommand(
              rejectRunId,
              rejectReason,
              jsonFlag,
              values['correlation-id'] as string | undefined,
              effectiveCwd
            );
          }

          case 'cleanup': {
            const days = positionals[2] ? Number(positionals[2]) : 7;
            if (Number.isNaN(days) || days < 0) {
              console.error('Usage: archon workflow cleanup [days]');
              console.error('  days: delete terminal runs older than N days (default: 7)');
              return 1;
            }
            await workflowCleanupCommand(days);
            break;
          }

          case 'reset-sessions': {
            const workflowName = positionals[2];
            const extras = positionals.slice(3);
            if (!workflowName) {
              console.error(
                'Usage: archon workflow reset-sessions <workflow-name> [--scope <key>] [--node <id>] [--yes] [--json]'
              );
              console.error(
                '  Without --scope: deletes persisted sessions across ALL scopes (requires --yes).'
              );
              return 1;
            }
            // Reject extra positionals — this is a destructive command and silently
            // dropping `archon workflow reset-sessions wf planner` (likely intent: filter to
            // node "planner") to a cross-scope wipe would be a foot-gun.
            if (extras.length > 0) {
              console.error(
                'Usage: archon workflow reset-sessions <workflow-name> [--scope <key>] [--node <id>] [--yes] [--json]'
              );
              console.error(
                `Error: unexpected positional argument(s): ${extras.join(' ')}. Use --node <id> to filter by node.`
              );
              return 1;
            }
            await workflowResetSessionsCommand(workflowName, {
              scope: values.scope as string | undefined,
              node: values.node as string | undefined,
              yes: values.yes as boolean | undefined,
              json: jsonFlag,
            });
            break;
          }

          case 'event': {
            const action = positionals[2];
            if (action !== 'emit') {
              if (action === undefined) {
                console.error('Missing workflow event subcommand');
              } else {
                console.error(`Unknown workflow event subcommand: ${action}`);
              }
              console.error('Available: emit');
              return 1;
            }
            const runId = values['run-id'] as string | undefined;
            const eventType = values.type as string | undefined;
            if (!runId) {
              console.error(
                'Usage: archon workflow event emit --run-id <uuid> --type <event-type>'
              );
              console.error('Error: --run-id is required');
              return 1;
            }
            if (!eventType) {
              console.error(
                'Usage: archon workflow event emit --run-id <uuid> --type <event-type>'
              );
              console.error('Error: --type is required');
              return 1;
            }
            if (!isValidEventType(eventType)) {
              console.error(`Error: unknown event type: ${eventType}`);
              console.error(`Valid types: ${WORKFLOW_EVENT_TYPES.join(', ')}`);
              return 1;
            }
            let eventData: Record<string, unknown> | undefined;
            const rawData = values.data as string | undefined;
            if (rawData) {
              try {
                eventData = JSON.parse(rawData) as Record<string, unknown>;
              } catch {
                console.warn(
                  `Warning: --data is not valid JSON — event will be emitted without data payload: ${rawData}`
                );
              }
            }
            await workflowEventEmitCommand(runId, eventType, eventData);
            break;
          }

          case 'install': {
            const installSlug = positionals[2];
            if (!installSlug) {
              console.error('Usage: archon workflow install <slug> [--force]');
              return 1;
            }
            const forceFlag = values.force as boolean | undefined;
            await workflowInstallCommand(installSlug, effectiveCwd, forceFlag);
            break;
          }

          default:
            if (subcommand === undefined) {
              console.error('Missing workflow subcommand');
            } else {
              console.error(`Unknown workflow subcommand: ${subcommand}`);
            }
            console.error(
              'Available: list, run, status, get, runs, resume, retry, retry-node, cancel, abandon, approve, review-open, reject, cleanup, event, search, install'
            );
            return 1;
        }
        break;

      case 'isolation':
        switch (subcommand) {
          case 'list':
            await isolationListCommand();
            break;

          case 'cleanup': {
            // Check for --merged flag in remaining args
            const mergedFlag = args.includes('--merged') || positionals.includes('--merged');
            if (mergedFlag) {
              const includeClosed = args.includes('--include-closed');
              await isolationCleanupMergedCommand({ includeClosed });
            } else {
              const days = parseInt(positionals[2] ?? '7', 10);
              await isolationCleanupCommand(days);
            }
            break;
          }

          default:
            if (subcommand === undefined) {
              console.error('Missing isolation subcommand');
            } else {
              console.error(`Unknown isolation subcommand: ${subcommand}`);
            }
            console.error('Available: list, cleanup');
            return 1;
        }
        break;

      case 'provider-binding': {
        const bindingOpts = {
          json: jsonFlag ?? false,
          log: (line: string): void => {
            console.log(line);
          },
        };
        const bindingArgs = {
          provider: values.provider as string | undefined,
          name: values.name as string | undefined,
          projectRef: values['project-ref'] as string | undefined,
          route: values.route as string | undefined,
          eventTypes: values['event-types'] as string | undefined,
          correlationId: values['correlation-id'] as string | undefined,
          transformFile: values['transform-file'] as string | undefined,
          receiverHeadersFile: values['receiver-headers-file'] as string | undefined,
          envelopeFile: values['envelope-file'] as string | undefined,
        };
        switch (subcommand) {
          case 'create':
            return await providerBindingCreateCommand(bindingArgs, bindingOpts);
          case 'update':
            return await providerBindingUpdateCommand(bindingArgs, bindingOpts);
          case 'status':
            return await providerBindingStatusCommand(bindingArgs, bindingOpts);
          case 'rotate':
            return await providerBindingRotateCommand(bindingArgs, bindingOpts);
          case 'disable':
            return await providerBindingDisableCommand(bindingArgs, bindingOpts);
          case 'test':
            return await providerBindingTestCommand(bindingArgs, {
              ...bindingOpts,
              log: (line: string): Promise<void> => writeStdout(`${line}\n`),
            });
          default:
            if (jsonFlag) {
              return await providerBindingUnsupportedCommand(subcommand, bindingArgs, bindingOpts);
            }
            if (subcommand === undefined) {
              console.error('Missing provider-binding subcommand');
            } else {
              console.error(`Unknown provider-binding subcommand: ${subcommand}`);
            }
            console.error('Available: create, update, status, rotate, disable, test');
            return 1;
        }
      }

      case 'validate':
        switch (subcommand) {
          case 'workflows': {
            const validateName = positionals[2];
            return await validateWorkflowsCommand(effectiveCwd, validateName, jsonFlag);
          }

          case 'commands': {
            const validateName = positionals[2];
            return await validateCommandsCommand(effectiveCwd, validateName, jsonFlag);
          }

          default:
            if (subcommand === undefined) {
              console.error('Missing validate target');
            } else {
              console.error(`Unknown validate target: ${subcommand}`);
            }
            console.error('Available: workflows, commands');
            return 1;
        }

      case 'complete': {
        const branches = positionals.slice(1);
        if (branches.length === 0) {
          console.error('Usage: archon complete <branch-name> [branch2 ...]');
          return 1;
        }
        const forceFlag = args.includes('--force');
        await isolationCompleteCommand(branches, { force: forceFlag, deleteRemote: true });
        break;
      }

      case 'continue': {
        const continueBranch = positionals[1];
        if (!continueBranch) {
          console.error('Usage: archon continue <branch> [--workflow <name>] "instruction"');
          return 1;
        }
        const continueMessage = positionals.slice(2).join(' ') || '';
        const continueWorkflow = values.workflow as string | undefined;
        const noContextFlag = values['no-context'] as boolean | undefined;
        await continueCommand(continueBranch, continueMessage, {
          workflow: continueWorkflow,
          noContext: noContextFlag,
        });
        break;
      }

      case 'serve': {
        const servePort = values.port !== undefined ? Number(values.port) : undefined;
        const downloadOnly = Boolean(values['download-only']);
        return await serveCommand({ port: servePort, downloadOnly });
      }

      case 'doctor': {
        return await doctorCommand(undefined, Boolean(values.full));
      }

      case 'usage': {
        // Top-level parse is strict:false; reject typos and worktree-only --from/--to.
        const USAGE_ALLOWED_FLAGS = new Set([
          '--since',
          '--until',
          '--by',
          '--codebase-id',
          '--agent',
          '--provider',
          '--model',
          '--kind',
          '--run-id',
          '--node',
          '--json',
          '--cwd',
          '--help',
          '-h',
          '--quiet',
          '-q',
          '--verbose',
          '-v',
        ]);
        const unsupported = findUnsupportedFlag(args, USAGE_ALLOWED_FLAGS);
        if (unsupported) {
          console.error(
            `Error: unsupported flag for usage: ${unsupported}. Supported: --since --until --by --codebase-id --agent --provider --model --kind --run-id --node --json`
          );
          return 1;
        }
        return await usageCommand({
          since: values.since as string | undefined,
          until: values.until as string | undefined,
          by: values.by as string | undefined,
          codebaseId: values['codebase-id'] as string | undefined,
          agent: values.agent as string | undefined,
          provider: values.provider as string | undefined,
          model: values.model as string | undefined,
          kind: values.kind as string | undefined,
          runId: values['run-id'] as string | undefined,
          node: values.node as string | undefined,
          json: jsonFlag,
        });
      }

      case 'auth': {
        switch (subcommand) {
          case 'github':
            return await authGithubCommand();
          default:
            if (subcommand === undefined) {
              console.error('Missing auth subcommand');
            } else {
              console.error(`Unknown auth subcommand: ${subcommand}`);
            }
            console.error('Available: github');
            return 1;
        }
      }

      case 'ai': {
        switch (subcommand) {
          case 'key': {
            const action = positionals[2];
            if (action !== 'set') {
              console.error('Usage: archon ai key set <provider>');
              return 1;
            }
            return await aiKeySetCommand(positionals[3]);
          }
          case 'list':
            return await aiListCommand();
          case 'logout':
            return await aiLogoutCommand(positionals[2]);
          case 'login':
            return await aiLoginCommand(positionals[2]);
          case 'tier': {
            const action = positionals[2];
            const scopeFlag = values.scope as string | undefined;
            switch (action) {
              case 'set':
                return await aiTierSetCommand(
                  positionals[3],
                  positionals[4],
                  positionals[5],
                  values.effort as string | undefined,
                  scopeFlag
                );
              case 'list':
                return await aiTierListCommand(jsonFlag);
              case 'unset':
                return await aiTierUnsetCommand(positionals[3], scopeFlag);
              default:
                console.error(
                  'Usage: archon ai tier set <small|medium|large> <provider> <model> [--effort <e>] [--scope user|install] | tier list [--json] | tier unset <tier> [--scope user|install]'
                );
                return 1;
            }
          }
          case 'alias': {
            const action = positionals[2];
            const scopeFlag = values.scope as string | undefined;
            switch (action) {
              case 'set':
                return await aiAliasSetCommand(
                  positionals[3],
                  positionals[4],
                  positionals[5],
                  values.effort as string | undefined,
                  scopeFlag
                );
              case 'list':
                return await aiAliasListCommand(jsonFlag);
              case 'unset':
                return await aiAliasUnsetCommand(positionals[3], scopeFlag);
              default:
                console.error(
                  'Usage: archon ai alias set <@name> <provider> <model> [--effort <e>] [--scope user|install] | alias list [--json] | alias unset <@name> [--scope user|install]'
                );
                return 1;
            }
          }
          case 'default':
            return await aiDefaultCommand(
              positionals[2],
              positionals[3],
              values.scope as string | undefined
            );
          default:
            if (subcommand === undefined) {
              console.error('Missing ai subcommand');
            } else {
              console.error(`Unknown ai subcommand: ${subcommand}`);
            }
            console.error(
              'Available: key set <provider>, login <provider>, list, logout <provider>, tier set|list|unset, alias set|list|unset, default <provider> [<model>]'
            );
            return 1;
        }
      }

      case 'telemetry': {
        switch (subcommand) {
          case 'status':
            return telemetryStatusCommand();
          case 'reset':
            return telemetryResetCommand();
          default:
            if (subcommand === undefined) {
              console.error('Missing telemetry subcommand');
            } else {
              console.error(`Unknown telemetry subcommand: ${subcommand}`);
            }
            console.error('Available: status, reset');
            return 1;
        }
      }

      case 'skill': {
        switch (subcommand) {
          case 'install': {
            // Optional positional path; otherwise install into the resolved cwd.
            const targetArg = positionals[2];
            const targetPath = targetArg ? resolve(targetArg) : cwd;
            return await skillInstallCommand(targetPath);
          }

          default:
            if (subcommand === undefined) {
              console.error('Missing skill subcommand');
            } else {
              console.error(`Unknown skill subcommand: ${subcommand}`);
            }
            console.error('Available: install');
            return 1;
        }
      }

      default:
        if (command === undefined) {
          console.error('Missing command');
        } else {
          console.error(`Unknown command: ${command}`);
        }
        printUsage();
        return 1;
    }
    if (!workflowProviderJsonRequested) {
      await printUpdateNotice(values.quiet as boolean | undefined);
    }
    return typeof process.exitCode === 'number' ? process.exitCode : 0;
  } catch (error) {
    const err = error as Error;
    console.error(`Error: ${err.message}`);
    if (process.env.DEBUG) {
      console.error(err.stack);
    }
    return 1;
  } finally {
    // Flush queued observability and telemetry events before the CLI process exits.
    // Short-lived CLI commands lose buffered events if shutdown is skipped.
    await shutdownLangfuse();
    await shutdownTelemetry();
    // Always close database connection
    await closeDb();
  }
}

// Exit explicitly so a lingering handle (DB pool, spawned child, timer) can
// never leave the CLI hanging after its work is done.
//
// This is safe for piped output because every machine-readable payload is
// emitted through `writeStdout()`/`writeJsonLine()` (src/utils/stdout.ts), which
// resolves only once the bytes have reached the OS. The #2384 truncation
// happened inside `console.log` at call time — not at exit — so deferring the
// exit would not have recovered it.
main()
  .then(exitCode => {
    process.exit(exitCode);
  })
  .catch((error: unknown) => {
    const err = error as Error;
    console.error('Fatal error:', err.message);
    process.exit(1);
  });
