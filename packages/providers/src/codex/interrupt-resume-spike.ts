/**
 * Diagnostic-only Codex stream-abort + same-thread resume spike.
 * Do not export from the providers package barrel. Do not call from tests or CI.
 *
 * Measures the locked @openai/codex-sdk abort/resume protocol that Phase 2
 * (US-002) must normalize:
 *  A. New-thread mid-tool interrupt via AbortSignal while a command is active
 *  B. Early operator intent deferred until thread.started id is retained
 *  C. Three interrupt/resume cycles via resumeThread(id) only (never startThread fallback)
 *  D. Descendant process cleanup + zero unhandledRejection/uncaughtException
 *
 * Writes a sanitized markdown report under the plan reports/ directory.
 * Exit 0 only when every required gate field is PASS for the host OS family;
 * missing credentials / wrong SDK / failed fields leave the report BLOCKED.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, platform as osPlatform, tmpdir, arch as osArch } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Codex, type Thread, type ThreadEvent, type ThreadOptions } from '@openai/codex-sdk';

const EXPECTED_SDK_VERSION = '0.144.5';
const DECLARED_SDK_RANGE = '^0.144.5';
const SETTLEMENT_TIMEOUT_MS = 60_000;
const RESUME_TIMEOUT_MS = 90_000;
const CASE_TIMEOUT_MS = 180_000;
const CLEANUP_WAIT_MS = 2_000;
const SURVIVOR_TERM_WAIT_MS = 1_000;
const LONG_COMMAND_SECONDS = 120;

/** Plan-local report path relative to the monorepo root. */
const REPORT_RELATIVE =
  'plans/260920-0216-issue-184-interrupt-and-redirect-codex-agent/reports/codex-interrupt-resume-spike.md';

type OsFamily = 'linux' | 'macos' | 'windows' | 'other';

interface ProcessFingerprint {
  pid: number;
  ppid: number;
  /** Platform-specific start fingerprint (lstart / CreationDate). */
  start: string;
}

interface TerminalEvidence {
  kind: 'throw' | 'clean-close' | 'timeout' | 'none';
  errorName: string | null;
  errorConstructor: string | null;
  /** Stable message fragments with stderr body and absolute paths stripped. */
  messageFragments: string[];
  rawMessageSanitized: string | null;
}

interface EventOrderSummary {
  types: string[];
  threadStartedIndex: number | null;
  commandStartedIndex: number | null;
  commandCompletedAfterAbort: boolean;
  turnCompletedSeen: boolean;
  turnFailedSeen: boolean;
}

interface CaseAEvidence {
  ran: boolean;
  threadIdRetained: boolean;
  abortedWhileCommandActive: boolean;
  eventOrder: EventOrderSummary;
  terminal: TerminalEvidence;
  settlementMs: number | null;
  settlementWithinBound: boolean;
  descendantsCaptured: number;
  descendantsSurvivingAfterCleanup: number;
  cleanupElapsedMs: number | null;
}

interface CaseBEvidence {
  ran: boolean;
  intentMarkedBeforeThreadStarted: boolean;
  abortDeferredUntilId: boolean;
  threadIdRetained: boolean;
  eventOrder: EventOrderSummary;
  terminal: TerminalEvidence;
  settlementMs: number | null;
  settlementWithinBound: boolean;
  sameTerminalClassAsA: boolean;
}

interface ResumeCycleEvidence {
  index: number;
  usedResumeThread: boolean;
  usedStartThreadFallback: boolean;
  completedNaturally: boolean;
  priorContextDemonstrated: boolean;
  settlementMs: number | null;
  settlementWithinBound: boolean;
  terminal: TerminalEvidence;
  errorSanitized: string | null;
}

interface RuntimeSafetyEvidence {
  unhandledRejections: number;
  uncaughtExceptions: number;
}

interface SpikeHostDocument {
  dateIso: string;
  osFamily: OsFamily;
  osPlatform: string;
  osArch: string;
  osRelease: string;
  bunVersion: string;
  declaredSdkRange: string;
  lockedSdkVersion: string;
  resolvedRuntimeVersion: string;
  runtimeVersionMatch: boolean;
  credentialsPresent: boolean;
  binaryResolvable: boolean;
  caseA: CaseAEvidence | null;
  caseB: CaseBEvidence | null;
  resumeCycles: ResumeCycleEvidence[];
  safety: RuntimeSafetyEvidence;
  gate: Record<string, 'PASS' | 'BLOCKED' | 'N/A'>;
  overall: 'PASS' | 'BLOCKED';
  blockReasons: string[];
}

interface UnhandledRecorder {
  rejections: number;
  exceptions: number;
  restore: () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function detectOsFamily(): OsFamily {
  switch (process.platform) {
    case 'darwin':
      return 'macos';
    case 'linux':
      return 'linux';
    case 'win32':
      return 'windows';
    default:
      return 'other';
  }
}

function repoRootFromSpike(): string {
  // packages/providers/src/codex/interrupt-resume-spike.ts → monorepo root
  return resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
}

function readInstalledCodexSdkVersion(expected: string): {
  version: string;
  entryPath: string;
  manifestPath: string;
} {
  const entry = Bun.resolveSync('@openai/codex-sdk', import.meta.dir);
  // Walk up from the resolved entry until package.json name matches.
  let dir = dirname(entry);
  let manifestPath: string | null = null;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, 'package.json');
    if (existsSync(candidate)) {
      const parsed: unknown = JSON.parse(readFileSync(candidate, 'utf8'));
      if (isRecord(parsed) && parsed.name === '@openai/codex-sdk') {
        manifestPath = candidate;
        if (typeof parsed.version !== 'string') {
          throw new Error('Codex SDK manifest version is unreadable');
        }
        if (parsed.version !== expected) {
          throw new Error(
            `Codex SDK version mismatch: resolved ${parsed.version}, expected ${expected}`
          );
        }
        return { version: parsed.version, entryPath: entry, manifestPath };
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Codex SDK package.json not found near resolved entry');
}

function credentialsPresent(): boolean {
  if (typeof process.env.OPENAI_API_KEY === 'string' && process.env.OPENAI_API_KEY.length > 0) {
    return true;
  }
  if (typeof process.env.CODEX_API_KEY === 'string' && process.env.CODEX_API_KEY.length > 0) {
    return true;
  }
  // Codex subscription auth is stored at ~/.codex/auth.json
  try {
    const authPath = join(homedir(), '.codex', 'auth.json');
    if (!existsSync(authPath)) return false;
    const parsed: unknown = JSON.parse(readFileSync(authPath, 'utf8'));
    return isRecord(parsed) && Object.keys(parsed).length > 0;
  } catch {
    return false;
  }
}

function installUnhandledRecorders(): UnhandledRecorder {
  let rejections = 0;
  let exceptions = 0;
  const onRejection = (): void => {
    rejections += 1;
  };
  const onException = (): void => {
    exceptions += 1;
  };
  process.on('unhandledRejection', onRejection);
  process.on('uncaughtException', onException);
  return {
    get rejections(): number {
      return rejections;
    },
    get exceptions(): number {
      return exceptions;
    },
    restore(): void {
      process.off('unhandledRejection', onRejection);
      process.off('uncaughtException', onException);
    },
  };
}

async function settleEventLoop(): Promise<void> {
  const tick = Promise.withResolvers<undefined>();
  setImmediate(() => {
    tick.resolve(undefined);
  });
  await tick.promise;
  const zero = Promise.withResolvers<undefined>();
  setTimeout(() => {
    zero.resolve(undefined);
  }, 0);
  await zero.promise;
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<undefined>();
  setTimeout(() => {
    resolve(undefined);
  }, ms);
  return promise;
}

function withTimeout<T>(ms: number, label: string, work: Promise<T>): Promise<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  const timer = setTimeout(() => {
    reject(new Error(`TimeoutError: ${label} exceeded ${ms}ms`));
  }, ms);
  work.then(
    value => {
      clearTimeout(timer);
      resolve(value);
    },
    (err: unknown) => {
      clearTimeout(timer);
      reject(err);
    }
  );
  return promise;
}

function emptyEventOrder(): EventOrderSummary {
  return {
    types: [],
    threadStartedIndex: null,
    commandStartedIndex: null,
    commandCompletedAfterAbort: false,
    turnCompletedSeen: false,
    turnFailedSeen: false,
  };
}

function emptyTerminal(): TerminalEvidence {
  return {
    kind: 'none',
    errorName: null,
    errorConstructor: null,
    messageFragments: [],
    rawMessageSanitized: null,
  };
}

/**
 * Strip secrets, home paths, absolute paths, thread ids, and command bodies.
 * Keep stable constructor-level fragments Phase 2 can enumerate.
 */
function sanitizeErrorMessage(message: string): string {
  let out = message;
  // Collapse home directory paths
  const home = homedir();
  if (home.length > 1) {
    out = out.split(home).join('~');
  }
  // Absolute POSIX / Windows paths → <path>
  out = out.replace(/(?:[A-Za-z]:)?(?:\/|\\)[^\s:'"]+/g, '<path>');
  // UUID-like thread ids
  out = out.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>');
  // Long hex tokens
  out = out.replace(/\b[0-9a-f]{16,}\b/gi, '<hex>');
  // API key-ish tokens
  out = out.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '<key>');
  // Collapse whitespace
  out = out.replace(/\s+/g, ' ').trim();
  // Cap length
  if (out.length > 240) out = `${out.slice(0, 240)}…`;
  return out;
}

function extractStableFragments(sanitized: string): string[] {
  const fragments: string[] = [];
  // Exact SDK abort throw shape from @openai/codex-sdk 0.144.5:
  //   `Codex Exec exited with signal ${signal}: ${stderr}`
  //   `Codex Exec exited with code ${code}: ${stderr}`
  const signalMatch = /Codex Exec exited with signal ([A-Za-z0-9_]+)/.exec(sanitized);
  if (signalMatch) {
    fragments.push('Codex Exec exited with signal');
    fragments.push(`signal ${signalMatch[1]}`);
  }
  const codeMatch = /Codex Exec exited with code (\d+)/.exec(sanitized);
  if (codeMatch) {
    fragments.push('Codex Exec exited with code');
    fragments.push(`code ${codeMatch[1]}`);
  }
  if (/AbortError/i.test(sanitized)) fragments.push('AbortError');
  if (/Query aborted/i.test(sanitized)) fragments.push('Query aborted');
  if (fragments.length === 0 && sanitized.length > 0) {
    // Keep a short head as a last-resort discriminant (already sanitized).
    fragments.push(sanitized.slice(0, 80));
  }
  return [...new Set(fragments)];
}

function terminalFromError(error: unknown): TerminalEvidence {
  if (error instanceof Error && error.message.startsWith('TimeoutError:')) {
    return {
      kind: 'timeout',
      errorName: error.name,
      errorConstructor: error.constructor?.name ?? 'Error',
      messageFragments: ['TimeoutError'],
      rawMessageSanitized: sanitizeErrorMessage(error.message),
    };
  }
  if (error instanceof Error) {
    const sanitized = sanitizeErrorMessage(error.message);
    return {
      kind: 'throw',
      errorName: error.name,
      errorConstructor: error.constructor?.name ?? 'Error',
      messageFragments: extractStableFragments(sanitized),
      rawMessageSanitized: sanitized,
    };
  }
  const sanitized = sanitizeErrorMessage(String(error));
  return {
    kind: 'throw',
    errorName: null,
    errorConstructor: null,
    messageFragments: extractStableFragments(sanitized),
    rawMessageSanitized: sanitized,
  };
}

function sameTerminalClass(a: TerminalEvidence, b: TerminalEvidence): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'clean-close' && b.kind === 'clean-close') return true;
  if (a.kind !== 'throw' || b.kind !== 'throw') return a.kind === b.kind;
  // Require at least one shared stable fragment.
  if (a.messageFragments.length === 0 || b.messageFragments.length === 0) return false;
  return a.messageFragments.some(f => b.messageFragments.includes(f));
}

function isCommandExecutionItem(item: unknown): item is {
  type: 'command_execution';
  status: string;
  command?: string;
} {
  return isRecord(item) && item.type === 'command_execution' && typeof item.status === 'string';
}

function eventTypeLabel(event: ThreadEvent): string {
  if (
    event.type === 'item.started' ||
    event.type === 'item.completed' ||
    event.type === 'item.updated'
  ) {
    const itemType =
      isRecord(event) && isRecord(event.item) && typeof event.item.type === 'string'
        ? event.item.type
        : 'unknown';
    return `${event.type}:${itemType}`;
  }
  return event.type;
}

function createDisposableRepo(nonce: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'archon-codex-interrupt-spike-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'spike@archon.invalid'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Archon Spike'], { cwd: dir });
  writeFileSync(join(dir, 'NONCE.txt'), `${nonce}\n`, 'utf8');
  writeFileSync(
    join(dir, 'README.md'),
    '# disposable spike workspace\n\nDo not use outside the Codex interrupt spike.\n',
    'utf8'
  );
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'spike nonce'], { cwd: dir });
  return dir;
}

function threadOptionsFor(cwd: string): ThreadOptions {
  return {
    workingDirectory: cwd,
    skipGitRepoCheck: false,
    sandboxMode: 'workspace-write',
    networkAccessEnabled: false,
    approvalPolicy: 'never',
    // Prefer a fast model when the environment allows; the SDK/CLI may override.
    model: process.env.CODEX_SPIKE_MODEL?.trim() || undefined,
  };
}

function createCodexClient(): Codex {
  const apiKey = process.env.CODEX_API_KEY ?? process.env.OPENAI_API_KEY;
  const codexPathOverride = process.env.CODEX_BIN_PATH?.trim() || undefined;
  return new Codex({
    ...(apiKey ? { apiKey } : {}),
    ...(codexPathOverride ? { codexPathOverride } : {}),
  });
}

function binaryResolvable(): boolean {
  try {
    if (process.env.CODEX_BIN_PATH && existsSync(process.env.CODEX_BIN_PATH)) return true;
    // The SDK resolves @openai/codex platform package; try to locate it the same way.
    const entry = Bun.resolveSync('@openai/codex-sdk', import.meta.dir);
    // Heuristic: presence of the SDK entry is enough; spawn will fail loudly later if binary missing.
    return typeof entry === 'string' && entry.length > 0;
  } catch {
    return false;
  }
}

// ─── Process table (POSIX + Windows) ─────────────────────────────────────

function listProcessTablePosix(): ProcessFingerprint[] {
  // pid, ppid, lstart (multi-word), command — use a custom format.
  // `ps -axo pid=,ppid=,lstart=,command=` is portable on macOS and Linux.
  const result = spawnSync('ps', ['-axo', 'pid=,ppid=,lstart=,command='], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0 || typeof result.stdout !== 'string') {
    throw new Error(`ps failed: ${result.stderr || result.status}`);
  }
  const rows: ProcessFingerprint[] = [];
  for (const line of result.stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // pid ppid Day Mon DD HH:MM:SS YYYY command...
    const match =
      /^(\d+)\s+(\d+)\s+([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.*)$/.exec(
        trimmed
      );
    if (!match) continue;
    rows.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      start: match[3],
    });
  }
  return rows;
}

function listProcessTableWindows(): ProcessFingerprint[] {
  // PowerShell CIM inventory: ProcessId, ParentProcessId, CreationDate
  const script =
    'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CreationDate | ConvertTo-Csv -NoTypeInformation';
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0 || typeof result.stdout !== 'string') {
    throw new Error(`powershell process inventory failed: ${result.stderr || result.status}`);
  }
  const lines = result.stdout.split(/\r?\n/).filter(l => l.trim().length > 0);
  const rows: ProcessFingerprint[] = [];
  // Skip header
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.replace(/^"|"$/g, ''));
    if (cols.length < 3) continue;
    const pid = Number(cols[0]);
    const ppid = Number(cols[1]);
    const start = cols[2] ?? '';
    if (!Number.isFinite(pid)) continue;
    rows.push({ pid, ppid, start });
  }
  return rows;
}

function listProcessTable(): ProcessFingerprint[] {
  return process.platform === 'win32' ? listProcessTableWindows() : listProcessTablePosix();
}

function captureDescendants(rootPid: number): ProcessFingerprint[] {
  const table = listProcessTable();
  const byParent = new Map<number, ProcessFingerprint[]>();
  for (const row of table) {
    const list = byParent.get(row.ppid) ?? [];
    list.push(row);
    byParent.set(row.ppid, list);
  }
  const out: ProcessFingerprint[] = [];
  const queue = [rootPid];
  const seen = new Set<number>([rootPid]);
  while (queue.length > 0) {
    const parent = queue.pop();
    if (parent === undefined) break;
    for (const child of byParent.get(parent) ?? []) {
      if (seen.has(child.pid)) continue;
      seen.add(child.pid);
      out.push(child);
      queue.push(child.pid);
    }
  }
  return out;
}

function processStillMatches(fp: ProcessFingerprint): boolean {
  const table = listProcessTable();
  const live = table.find(p => p.pid === fp.pid);
  if (!live) return false;
  // Re-verify start fingerprint so PID reuse cannot target an unrelated process.
  return live.start === fp.start;
}

function signalCaptured(fp: ProcessFingerprint, signal: 'SIGTERM' | 'SIGKILL'): void {
  if (!processStillMatches(fp)) return;
  try {
    if (process.platform === 'win32') {
      // taskkill /PID /F for KILL; without /F for soft (best-effort)
      const args = signal === 'SIGKILL' ? ['/PID', String(fp.pid), '/F'] : ['/PID', String(fp.pid)];
      spawnSync('taskkill', args, { encoding: 'utf8' });
    } else {
      process.kill(fp.pid, signal);
    }
  } catch {
    // ESRCH etc. — already gone
  }
}

async function ensureDescendantsGone(
  captured: ProcessFingerprint[]
): Promise<{ surviving: number; elapsedMs: number }> {
  const started = Date.now();
  await sleep(CLEANUP_WAIT_MS);
  let survivors = captured.filter(processStillMatches);
  if (survivors.length > 0) {
    for (const fp of survivors) signalCaptured(fp, 'SIGTERM');
    await sleep(SURVIVOR_TERM_WAIT_MS);
    survivors = captured.filter(processStillMatches);
    for (const fp of survivors) signalCaptured(fp, 'SIGKILL');
    await sleep(SURVIVOR_TERM_WAIT_MS);
    survivors = captured.filter(processStillMatches);
  }
  return { surviving: survivors.length, elapsedMs: Date.now() - started };
}

// ─── Cases ───────────────────────────────────────────────────────────────

/**
 * Prompt forces a long-running local shell command. Command text is never
 * written to the report — only event types are retained.
 */
function midToolPrompt(nonce: string): string {
  // Keep the instruction boring and deterministic. The agent must run sleep
  // inside the disposable workspace; network is disabled.
  return [
    `You are in a disposable git repository whose NONCE.txt contains the value ${nonce}.`,
    `Run exactly one shell command: sleep ${LONG_COMMAND_SECONDS}`,
    'Do not run any other command. Do not write files. Wait for the sleep to finish before replying.',
  ].join(' ');
}

function resumePrompt(followUp: string): string {
  return [
    'Reply with exactly two tokens separated by a single space and nothing else:',
    '1) the full contents of NONCE.txt (trim whitespace)',
    `2) the follow-up value ${followUp}`,
    `Example shape: <nonce> ${followUp}`,
  ].join(' ');
}

interface StreamConsumeResult {
  eventOrder: EventOrderSummary;
  threadId: string | null;
  terminal: TerminalEvidence;
  settlementMs: number;
  commandWasActiveAtAbort: boolean;
  aborted: boolean;
}

async function consumeWithAbortStrategy(args: {
  thread: Thread;
  prompt: string;
  signal: AbortSignal;
  controller: AbortController;
  /**
   * 'mid-tool' — abort once a command_execution item is in_progress.
   * 'defer-until-id' — operator intent is already marked; abort only after
   *                    a non-empty thread id is retained from thread.started
   *                    (and preferably once a command is active, else right after id).
   * 'pre-aborted' — controller already aborted before runStreamed (resumed id known).
   * 'none' — no abort; natural completion.
   */
  strategy: 'mid-tool' | 'defer-until-id' | 'pre-aborted' | 'none';
  /** When strategy is defer-until-id, intent was marked before iteration. */
  intentMarkedBeforeStart?: boolean;
  onBeforeAbort?: () => ProcessFingerprint[];
}): Promise<StreamConsumeResult & { descendantsAtAbort: ProcessFingerprint[] }> {
  const eventOrder = emptyEventOrder();
  let threadId: string | null =
    typeof args.thread.id === 'string' && args.thread.id.length > 0 ? args.thread.id : null;
  let terminal = emptyTerminal();
  let commandWasActiveAtAbort = false;
  let aborted = false;
  let descendantsAtAbort: ProcessFingerprint[] = [];
  const startedAt = Date.now();

  const markAbort = (): void => {
    if (aborted) return;
    if (args.onBeforeAbort) {
      descendantsAtAbort = args.onBeforeAbort();
    }
    aborted = true;
    commandWasActiveAtAbort = eventOrder.commandStartedIndex !== null;
    args.controller.abort();
  };

  try {
    const streamed = await args.thread.runStreamed(args.prompt, { signal: args.signal });
    for await (const event of streamed.events) {
      const label = eventTypeLabel(event);
      eventOrder.types.push(label);

      if (event.type === 'thread.started') {
        eventOrder.threadStartedIndex = eventOrder.types.length - 1;
        if (typeof event.thread_id === 'string' && event.thread_id.length > 0) {
          threadId = event.thread_id;
        }
        if (args.strategy === 'defer-until-id' && !aborted && threadId) {
          // Deferral contract: intent was marked before start; real abort fires
          // only once the id is retained. Prefer waiting for a live command if
          // one appears shortly; otherwise abort immediately after id.
          // We abort immediately here to prove the deferred-id path; case A
          // covers mid-tool. A short microtask wait lets any already-queued
          // events land before kill.
          markAbort();
        }
      }

      if (event.type === 'item.started' && isCommandExecutionItem(event.item)) {
        if (event.item.status === 'in_progress' || event.item.status === undefined) {
          if (eventOrder.commandStartedIndex === null) {
            eventOrder.commandStartedIndex = eventOrder.types.length - 1;
          }
          if (args.strategy === 'mid-tool' && !aborted && threadId) {
            markAbort();
          }
        }
      }

      if (event.type === 'item.completed' && isCommandExecutionItem(event.item) && aborted) {
        eventOrder.commandCompletedAfterAbort = true;
      }

      if (event.type === 'turn.completed') eventOrder.turnCompletedSeen = true;
      if (event.type === 'turn.failed') eventOrder.turnFailedSeen = true;
    }
    // Clean close — iterator exhausted without throw.
    if (terminal.kind === 'none') {
      terminal = {
        kind: 'clean-close',
        errorName: null,
        errorConstructor: null,
        messageFragments: ['clean-close'],
        rawMessageSanitized: null,
      };
    }
  } catch (error) {
    terminal = terminalFromError(error);
  }

  return {
    eventOrder,
    threadId,
    terminal,
    settlementMs: Date.now() - startedAt,
    commandWasActiveAtAbort,
    aborted,
    descendantsAtAbort,
  };
}

async function runCaseA(codex: Codex, cwd: string, nonce: string): Promise<CaseAEvidence> {
  const controller = new AbortController();
  const thread = codex.startThread(threadOptionsFor(cwd));
  const result = await withTimeout(
    CASE_TIMEOUT_MS,
    'caseA',
    consumeWithAbortStrategy({
      thread,
      prompt: midToolPrompt(nonce),
      signal: controller.signal,
      controller,
      strategy: 'mid-tool',
      onBeforeAbort: () => captureDescendants(process.pid),
    })
  );

  // Keep draining is already done inside consume; now cleanup descendants.
  const cleanup = await ensureDescendantsGone(result.descendantsAtAbort);

  return {
    ran: true,
    threadIdRetained: typeof result.threadId === 'string' && result.threadId.length > 0,
    abortedWhileCommandActive: result.commandWasActiveAtAbort && result.aborted,
    eventOrder: result.eventOrder,
    terminal: result.terminal,
    settlementMs: result.settlementMs,
    settlementWithinBound:
      result.settlementMs <= SETTLEMENT_TIMEOUT_MS && result.terminal.kind !== 'timeout',
    descendantsCaptured: result.descendantsAtAbort.length,
    descendantsSurvivingAfterCleanup: cleanup.surviving,
    cleanupElapsedMs: cleanup.elapsedMs,
  };
}

async function runCaseB(
  codex: Codex,
  cwd: string,
  nonce: string,
  caseATerminal: TerminalEvidence | null
): Promise<CaseBEvidence> {
  const controller = new AbortController();
  const thread = codex.startThread(threadOptionsFor(cwd));
  // Mark operator intent BEFORE runStreamed / before any event.
  const intentMarkedBeforeThreadStarted = true;
  // Do not abort yet — deferral is inside the consumer on thread.started.
  const result = await withTimeout(
    CASE_TIMEOUT_MS,
    'caseB',
    consumeWithAbortStrategy({
      thread,
      prompt: midToolPrompt(`${nonce}-B`),
      signal: controller.signal,
      controller,
      strategy: 'defer-until-id',
      intentMarkedBeforeStart: true,
    })
  );

  const terminalClassMatches =
    caseATerminal !== null ? sameTerminalClass(caseATerminal, result.terminal) : false;

  return {
    ran: true,
    intentMarkedBeforeThreadStarted,
    abortDeferredUntilId:
      result.eventOrder.threadStartedIndex !== null &&
      result.aborted &&
      typeof result.threadId === 'string' &&
      result.threadId.length > 0,
    threadIdRetained: typeof result.threadId === 'string' && result.threadId.length > 0,
    eventOrder: result.eventOrder,
    terminal: result.terminal,
    settlementMs: result.settlementMs,
    settlementWithinBound:
      result.settlementMs <= SETTLEMENT_TIMEOUT_MS && result.terminal.kind !== 'timeout',
    sameTerminalClassAsA: terminalClassMatches,
  };
}

async function runInterruptedThenResumeCycle(args: {
  codex: Codex;
  cwd: string;
  nonce: string;
  index: number;
}): Promise<ResumeCycleEvidence> {
  const { codex, cwd, nonce, index } = args;
  let usedResumeThread = false;
  const usedStartThreadFallback = false;
  const followUp = `FOLLOWUP_${index}_${randomBytes(3).toString('hex')}`;

  // Interrupt a fresh (or conceptually "current") turn to obtain an id.
  const interruptController = new AbortController();
  const fresh = codex.startThread(threadOptionsFor(cwd));
  const interrupted = await withTimeout(
    CASE_TIMEOUT_MS,
    `resume-cycle-${index}-interrupt`,
    consumeWithAbortStrategy({
      thread: fresh,
      prompt: midToolPrompt(`${nonce}-C${index}`),
      signal: interruptController.signal,
      controller: interruptController,
      strategy: 'mid-tool',
      onBeforeAbort: () => captureDescendants(process.pid),
    })
  );
  // Best-effort cleanup of this cycle's descendants.
  await ensureDescendantsGone(interrupted.descendantsAtAbort);

  const interruptedId = interrupted.threadId;
  if (!interruptedId) {
    return {
      index,
      usedResumeThread: false,
      usedStartThreadFallback: false,
      completedNaturally: false,
      priorContextDemonstrated: false,
      settlementMs: interrupted.settlementMs,
      settlementWithinBound: false,
      terminal: interrupted.terminal,
      errorSanitized: 'no thread id retained from interrupt leg',
    };
  }

  // Resume ONLY via resumeThread — never startThread fallback.
  let resumeThread: Thread;
  try {
    resumeThread = codex.resumeThread(interruptedId, threadOptionsFor(cwd));
    usedResumeThread = true;
  } catch (error) {
    return {
      index,
      usedResumeThread: false,
      usedStartThreadFallback: false,
      completedNaturally: false,
      priorContextDemonstrated: false,
      settlementMs: null,
      settlementWithinBound: false,
      terminal: terminalFromError(error),
      errorSanitized: sanitizeErrorMessage(error instanceof Error ? error.message : String(error)),
    };
  }

  const resumeController = new AbortController();
  const startedAt = Date.now();
  let completedNaturally = false;
  let priorContextDemonstrated = false;
  let terminal = emptyTerminal();
  let agentText = '';

  try {
    await withTimeout(
      RESUME_TIMEOUT_MS,
      `resume-cycle-${index}-resume`,
      (async (): Promise<void> => {
        const streamed = await resumeThread.runStreamed(resumePrompt(followUp), {
          signal: resumeController.signal,
        });
        for await (const event of streamed.events) {
          if (event.type === 'item.completed' && isRecord(event.item)) {
            if (event.item.type === 'agent_message' && typeof event.item.text === 'string') {
              agentText += event.item.text;
            }
          }
          if (event.type === 'turn.completed') {
            completedNaturally = true;
          }
        }
        if (!completedNaturally) {
          // Iterator closed without turn.completed — still inspect text.
          terminal = {
            kind: 'clean-close',
            errorName: null,
            errorConstructor: null,
            messageFragments: ['clean-close-without-turn-completed'],
            rawMessageSanitized: null,
          };
        } else {
          terminal = {
            kind: 'clean-close',
            errorName: null,
            errorConstructor: null,
            messageFragments: ['turn.completed'],
            rawMessageSanitized: null,
          };
        }
      })()
    );
  } catch (error) {
    terminal = terminalFromError(error);
  }

  // Prior context: nonce from the disposable repo + the follow-up value.
  const normalized = agentText.replace(/\s+/g, ' ').trim();
  // Never put nonce/followUp into the report; only boolean demonstration.
  priorContextDemonstrated =
    normalized.includes(nonce) && normalized.includes(followUp) && completedNaturally;

  const settlementMs = Date.now() - startedAt;
  return {
    index,
    usedResumeThread,
    usedStartThreadFallback,
    completedNaturally,
    priorContextDemonstrated,
    settlementMs,
    settlementWithinBound: settlementMs <= RESUME_TIMEOUT_MS && terminal.kind !== 'timeout',
    terminal,
    errorSanitized: terminal.rawMessageSanitized,
  };
}

// ─── Gate + report ───────────────────────────────────────────────────────

function evaluateGate(doc: SpikeHostDocument): void {
  const gate: Record<string, 'PASS' | 'BLOCKED' | 'N/A'> = {};
  const reasons: string[] = [];

  const pass = (key: string, ok: boolean, reason: string): void => {
    gate[key] = ok ? 'PASS' : 'BLOCKED';
    if (!ok) reasons.push(`${key}: ${reason}`);
  };

  pass('runtime_version', doc.runtimeVersionMatch, `resolved ${doc.resolvedRuntimeVersion}`);
  pass('credentials', doc.credentialsPresent, 'no OPENAI_API_KEY/CODEX_API_KEY/auth.json');
  pass('binary', doc.binaryResolvable, 'codex binary not resolvable');

  const a = doc.caseA;
  pass('caseA_ran', a?.ran === true, 'case A did not run');
  pass('caseA_thread_id_before_abort', a?.threadIdRetained === true, 'no thread id retained');
  pass(
    'caseA_mid_tool_abort',
    a?.abortedWhileCommandActive === true,
    'abort did not fire while command active (model may not have started sleep)'
  );
  pass(
    'caseA_terminal_deterministic',
    a !== null &&
      a.terminal.kind !== 'none' &&
      a.terminal.kind !== 'timeout' &&
      a.terminal.messageFragments.length > 0,
    `terminal=${a?.terminal.kind ?? 'missing'} fragments=${a?.terminal.messageFragments.join('|') ?? ''}`
  );
  pass(
    'caseA_settlement',
    a?.settlementWithinBound === true,
    `settlementMs=${a?.settlementMs ?? 'n/a'}`
  );
  pass(
    'caseA_descendants_gone',
    a?.descendantsSurvivingAfterCleanup === 0,
    `surviving=${a?.descendantsSurvivingAfterCleanup ?? 'n/a'}`
  );

  const b = doc.caseB;
  pass('caseB_ran', b?.ran === true, 'case B did not run');
  pass(
    'caseB_deferred_abort_with_id',
    b?.abortDeferredUntilId === true && b?.threadIdRetained,
    'deferred abort did not retain id'
  );
  pass(
    'caseB_same_terminal_class',
    b?.sameTerminalClassAsA === true,
    `B fragments=${b?.terminal.messageFragments.join('|') ?? ''} A fragments=${a?.terminal.messageFragments.join('|') ?? ''}`
  );
  pass(
    'caseB_settlement',
    b?.settlementWithinBound === true,
    `settlementMs=${b?.settlementMs ?? 'n/a'}`
  );

  const cycles = doc.resumeCycles;
  pass('resume_three_cycles', cycles.length === 3, `cycles=${cycles.length}`);
  for (const c of cycles) {
    pass(
      `resume_cycle_${c.index}_resumeThread`,
      c.usedResumeThread && !c.usedStartThreadFallback,
      c.errorSanitized ?? 'resumeThread not used'
    );
    pass(
      `resume_cycle_${c.index}_context`,
      c.completedNaturally && c.priorContextDemonstrated,
      `completed=${c.completedNaturally} context=${c.priorContextDemonstrated}`
    );
    pass(
      `resume_cycle_${c.index}_settlement`,
      c.settlementWithinBound,
      `settlementMs=${c.settlementMs ?? 'n/a'}`
    );
  }

  pass(
    'no_unhandled_rejection',
    doc.safety.unhandledRejections === 0,
    `count=${doc.safety.unhandledRejections}`
  );
  pass(
    'no_uncaught_exception',
    doc.safety.uncaughtExceptions === 0,
    `count=${doc.safety.uncaughtExceptions}`
  );

  doc.gate = gate;
  doc.blockReasons = reasons;
  doc.overall = reasons.length === 0 ? 'PASS' : 'BLOCKED';
}

function renderOsSection(doc: SpikeHostDocument): string {
  const lines: string[] = [];
  lines.push(`## ${doc.osFamily} (${doc.osPlatform}/${doc.osArch})`);
  lines.push('');
  lines.push(`- **Date**: ${doc.dateIso}`);
  lines.push(`- **OS release**: ${doc.osRelease}`);
  lines.push(`- **Bun**: ${doc.bunVersion}`);
  lines.push(`- **Declared SDK range**: \`${doc.declaredSdkRange}\``);
  lines.push(`- **Locked version (bun.lock / expected)**: \`${doc.lockedSdkVersion}\``);
  lines.push(`- **Resolved runtime version**: \`${doc.resolvedRuntimeVersion}\``);
  lines.push(`- **Credentials present**: ${doc.credentialsPresent ? 'yes' : 'no'}`);
  lines.push(`- **Binary resolvable**: ${doc.binaryResolvable ? 'yes' : 'no'}`);
  lines.push(`- **Overall**: **${doc.overall}**`);
  lines.push('');

  if (doc.caseA) {
    lines.push('### Case A — mid-tool interrupt');
    lines.push('');
    lines.push(`- Thread id retained before abort: ${doc.caseA.threadIdRetained}`);
    lines.push(`- Aborted while command active: ${doc.caseA.abortedWhileCommandActive}`);
    lines.push(
      `- Settlement ms: ${doc.caseA.settlementMs ?? 'n/a'} (bound ${SETTLEMENT_TIMEOUT_MS})`
    );
    lines.push(`- Settlement within bound: ${doc.caseA.settlementWithinBound}`);
    lines.push(
      `- Event order (types only): ${doc.caseA.eventOrder.types.length > 0 ? doc.caseA.eventOrder.types.join(' → ') : '(none)'}`
    );
    lines.push(
      `- thread.started index: ${doc.caseA.eventOrder.threadStartedIndex ?? 'n/a'}; command started index: ${doc.caseA.eventOrder.commandStartedIndex ?? 'n/a'}`
    );
    lines.push(
      `- Buffered command completed after abort: ${doc.caseA.eventOrder.commandCompletedAfterAbort}`
    );
    lines.push(
      `- Terminal kind: \`${doc.caseA.terminal.kind}\`; constructor: \`${doc.caseA.terminal.errorConstructor ?? 'n/a'}\`; name: \`${doc.caseA.terminal.errorName ?? 'n/a'}\``
    );
    lines.push(
      `- Terminal fragments: ${doc.caseA.terminal.messageFragments.map(f => `\`${f}\``).join(', ') || '(none)'}`
    );
    lines.push(
      `- Sanitized message: ${doc.caseA.terminal.rawMessageSanitized ? `\`${doc.caseA.terminal.rawMessageSanitized}\`` : '(none)'}`
    );
    lines.push(
      `- Descendants captured: ${doc.caseA.descendantsCaptured}; surviving after cleanup: ${doc.caseA.descendantsSurvivingAfterCleanup}; cleanup elapsed ms: ${doc.caseA.cleanupElapsedMs ?? 'n/a'}`
    );
    lines.push('');
  } else {
    lines.push('### Case A — mid-tool interrupt');
    lines.push('');
    lines.push('_Did not run._');
    lines.push('');
  }

  if (doc.caseB) {
    lines.push('### Case B — early operator intent (deferred abort)');
    lines.push('');
    lines.push(
      `- Intent marked before thread.started: ${doc.caseB.intentMarkedBeforeThreadStarted}`
    );
    lines.push(`- Abort deferred until id retained: ${doc.caseB.abortDeferredUntilId}`);
    lines.push(`- Thread id retained: ${doc.caseB.threadIdRetained}`);
    lines.push(`- Same terminal class as A: ${doc.caseB.sameTerminalClassAsA}`);
    lines.push(`- Settlement ms: ${doc.caseB.settlementMs ?? 'n/a'}`);
    lines.push(
      `- Event order (types only): ${doc.caseB.eventOrder.types.length > 0 ? doc.caseB.eventOrder.types.join(' → ') : '(none)'}`
    );
    lines.push(
      `- Terminal fragments: ${doc.caseB.terminal.messageFragments.map(f => `\`${f}\``).join(', ') || '(none)'}`
    );
    lines.push(
      `- Sanitized message: ${doc.caseB.terminal.rawMessageSanitized ? `\`${doc.caseB.terminal.rawMessageSanitized}\`` : '(none)'}`
    );
    lines.push('');
  } else {
    lines.push('### Case B — early operator intent (deferred abort)');
    lines.push('');
    lines.push('_Did not run._');
    lines.push('');
  }

  lines.push('### Case C — resume continuity (3 cycles)');
  lines.push('');
  if (doc.resumeCycles.length === 0) {
    lines.push('_Did not run._');
    lines.push('');
  } else {
    for (const c of doc.resumeCycles) {
      lines.push(
        `- Cycle ${c.index}: resumeThread=${c.usedResumeThread}; startThreadFallback=${c.usedStartThreadFallback}; naturalCompletion=${c.completedNaturally}; priorContext=${c.priorContextDemonstrated}; settlementMs=${c.settlementMs ?? 'n/a'}; withinBound=${c.settlementWithinBound}`
      );
      if (c.errorSanitized) {
        lines.push(`  - error: \`${c.errorSanitized}\``);
      }
    }
    lines.push('');
  }

  lines.push('### Case D — runtime safety');
  lines.push('');
  lines.push(`- unhandledRejection count: ${doc.safety.unhandledRejections}`);
  lines.push(`- uncaughtException count: ${doc.safety.uncaughtExceptions}`);
  lines.push('');

  lines.push('### Gate checklist');
  lines.push('');
  lines.push('| Field | Result |');
  lines.push('| --- | --- |');
  for (const [key, value] of Object.entries(doc.gate)) {
    lines.push(`| \`${key}\` | ${value} |`);
  }
  lines.push('');
  if (doc.blockReasons.length > 0) {
    lines.push('Block reasons:');
    for (const r of doc.blockReasons) lines.push(`- ${r}`);
    lines.push('');
  }

  return lines.join('\n');
}

function renderFullReport(args: { host: SpikeHostDocument; missingFamilies: OsFamily[] }): string {
  const { host, missingFamilies } = args;
  const lines: string[] = [];
  lines.push('# Codex interrupt + resume spike report');
  lines.push('');
  lines.push(
    "Real-SDK gate for the planned `interrupt: 'stream-abort'` capability seam on `@openai/codex-sdk`. Sanitized — no prompts, tokens, thread ids, home paths, or command content."
  );
  lines.push('');
  lines.push('## Command');
  lines.push('');
  lines.push('```bash');
  lines.push('cd packages/providers && bun run spike:interrupt:codex');
  lines.push('# => bun src/codex/interrupt-resume-spike.ts');
  lines.push('```');
  lines.push('');
  lines.push('## SDK pin');
  lines.push('');
  lines.push(`- Declared range (\`packages/providers/package.json\`): \`${DECLARED_SDK_RANGE}\``);
  lines.push(`- Locked / required runtime: \`${EXPECTED_SDK_VERSION}\` (matches \`bun.lock\`)`);
  lines.push('');
  lines.push('## Multi-OS matrix');
  lines.push('');
  lines.push(
    'Provider capabilities are not platform-scoped. Archon ships Linux, macOS, and Windows binaries; every required OS family must PASS. Untested families are **BLOCKED**, not skipped.'
  );
  lines.push('');
  lines.push('| OS family | Status | Notes |');
  lines.push('| --- | --- | --- |');
  lines.push(
    `| ${host.osFamily} | **${host.overall}** | ran on this host (${host.osPlatform}/${host.osArch}) |`
  );
  for (const fam of missingFamilies) {
    lines.push(`| ${fam} | **BLOCKED** | not executed in this spike run (no usable host) |`);
  }
  lines.push('');

  const matrixBlocked = missingFamilies.length > 0 || host.overall !== 'PASS';
  lines.push('## Outcome');
  lines.push('');
  lines.push(
    matrixBlocked
      ? `**BLOCKED** — ${
          missingFamilies.length > 0
            ? `untested OS families: ${missingFamilies.join(', ')}`
            : 'host gate failed'
        }${host.blockReasons.length > 0 ? `; host reasons: ${host.blockReasons.length}` : ''}.`
      : '**PASS** — every required field passed on every required OS family.'
  );
  lines.push('');
  lines.push(
    "Phase 2 (US-002) may enable `interrupt: 'stream-abort'` only when this report is PASS on native Linux, macOS, and Windows. A BLOCKED report leaves production capability `false`."
  );
  lines.push('');

  lines.push(renderOsSection(host));

  for (const fam of missingFamilies) {
    lines.push(`## ${fam}`);
    lines.push('');
    lines.push(
      '_No evidence collected. Recorded as BLOCKED per Phase 1 gate (untested OS family). WSL evidence would file under Linux, never Windows._'
    );
    lines.push('');
  }

  lines.push('## Phase 2 terminal predicate (from measured host variants)');
  lines.push('');
  if (host.caseA && host.caseA.terminal.messageFragments.length > 0) {
    lines.push(
      'Narrow discriminants observed on this host (do **not** broaden to generic `killed` / `signal` / `SUBPROCESS_CRASH_PATTERNS`):'
    );
    lines.push('');
    for (const f of host.caseA.terminal.messageFragments) {
      lines.push(`- \`${f}\``);
    }
    lines.push('');
    lines.push(
      `Constructor/name: \`${host.caseA.terminal.errorConstructor ?? 'n/a'}\` / \`${host.caseA.terminal.errorName ?? 'n/a'}\`; kind: \`${host.caseA.terminal.kind}\`.`
    );
  } else {
    lines.push(
      '_No stable terminal fragments measured on this host — Phase 2 must not invent a matcher._'
    );
  }
  lines.push('');
  lines.push('## Production impact');
  lines.push('');
  lines.push(
    'None. This spike does not modify `CODEX_CAPABILITIES`, `CodexProvider`, or `dag-executor.ts`.'
  );
  lines.push('');

  return lines.join('\n');
}

async function runHostProtocol(sdkVersion: string): Promise<SpikeHostDocument> {
  const doc: SpikeHostDocument = {
    dateIso: new Date().toISOString(),
    osFamily: detectOsFamily(),
    osPlatform: osPlatform(),
    osArch: osArch(),
    osRelease:
      process.platform === 'win32'
        ? (process.env.OSVERSION ?? '')
        : execFileSync('uname', ['-r'], { encoding: 'utf8' }).trim(),
    bunVersion: Bun.version,
    declaredSdkRange: DECLARED_SDK_RANGE,
    lockedSdkVersion: EXPECTED_SDK_VERSION,
    resolvedRuntimeVersion: sdkVersion,
    runtimeVersionMatch: sdkVersion === EXPECTED_SDK_VERSION,
    credentialsPresent: credentialsPresent(),
    binaryResolvable: binaryResolvable(),
    caseA: null,
    caseB: null,
    resumeCycles: [],
    safety: { unhandledRejections: 0, uncaughtExceptions: 0 },
    gate: {},
    overall: 'BLOCKED',
    blockReasons: [],
  };

  if (!doc.runtimeVersionMatch || !doc.credentialsPresent || !doc.binaryResolvable) {
    evaluateGate(doc);
    return doc;
  }

  const recorder = installUnhandledRecorders();
  const nonce = `N${randomBytes(8).toString('hex')}`;
  const cwd = createDisposableRepo(nonce);

  try {
    const codex = createCodexClient();

    // Case A
    try {
      doc.caseA = await runCaseA(codex, cwd, nonce);
    } catch (error) {
      doc.caseA = {
        ran: true,
        threadIdRetained: false,
        abortedWhileCommandActive: false,
        eventOrder: emptyEventOrder(),
        terminal: terminalFromError(error),
        settlementMs: null,
        settlementWithinBound: false,
        descendantsCaptured: 0,
        descendantsSurvivingAfterCleanup: 0,
        cleanupElapsedMs: null,
      };
    }

    // Case B
    try {
      doc.caseB = await runCaseB(codex, cwd, nonce, doc.caseA?.terminal ?? null);
    } catch (error) {
      doc.caseB = {
        ran: true,
        intentMarkedBeforeThreadStarted: true,
        abortDeferredUntilId: false,
        threadIdRetained: false,
        eventOrder: emptyEventOrder(),
        terminal: terminalFromError(error),
        settlementMs: null,
        settlementWithinBound: false,
        sameTerminalClassAsA: false,
      };
    }

    // Case C — three interrupt/resume cycles
    for (let i = 1; i <= 3; i++) {
      try {
        const cycle = await runInterruptedThenResumeCycle({ codex, cwd, nonce, index: i });
        doc.resumeCycles.push(cycle);
      } catch (error) {
        doc.resumeCycles.push({
          index: i,
          usedResumeThread: false,
          usedStartThreadFallback: false,
          completedNaturally: false,
          priorContextDemonstrated: false,
          settlementMs: null,
          settlementWithinBound: false,
          terminal: terminalFromError(error),
          errorSanitized: sanitizeErrorMessage(
            error instanceof Error ? error.message : String(error)
          ),
        });
      }
    }

    await settleEventLoop();
    doc.safety = {
      unhandledRejections: recorder.rejections,
      uncaughtExceptions: recorder.exceptions,
    };
  } finally {
    recorder.restore();
    try {
      rmSync(cwd, { recursive: true, force: true });
    } catch {
      // best-effort temp cleanup
    }
  }

  evaluateGate(doc);
  return doc;
}

function requiredMissingFamilies(ran: OsFamily): OsFamily[] {
  const required: OsFamily[] = ['linux', 'macos', 'windows'];
  return required.filter(f => f !== ran);
}

async function main(): Promise<void> {
  let sdkVersion: string;
  try {
    sdkVersion = readInstalledCodexSdkVersion(
      process.env.EXPECTED_CODEX_SDK_VERSION ?? EXPECTED_SDK_VERSION
    ).version;
  } catch (error) {
    process.stderr.write(
      `spike bootstrap failed: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
    // Still write a blocked report so the gate artifact exists.
    const blockedHost: SpikeHostDocument = {
      dateIso: new Date().toISOString(),
      osFamily: detectOsFamily(),
      osPlatform: osPlatform(),
      osArch: osArch(),
      osRelease: '',
      bunVersion: Bun.version,
      declaredSdkRange: DECLARED_SDK_RANGE,
      lockedSdkVersion: EXPECTED_SDK_VERSION,
      resolvedRuntimeVersion: 'unresolved',
      runtimeVersionMatch: false,
      credentialsPresent: credentialsPresent(),
      binaryResolvable: false,
      caseA: null,
      caseB: null,
      resumeCycles: [],
      safety: { unhandledRejections: 0, uncaughtExceptions: 0 },
      gate: {},
      overall: 'BLOCKED',
      blockReasons: [],
    };
    evaluateGate(blockedHost);
    const report = renderFullReport({
      host: blockedHost,
      missingFamilies: requiredMissingFamilies(blockedHost.osFamily),
    });
    const outPath = join(repoRootFromSpike(), REPORT_RELATIVE);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, report, 'utf8');
    process.stdout.write(
      'report_written path_sanitized=plans/.../codex-interrupt-resume-spike.md overall=BLOCKED\n'
    );
    return;
  }

  process.stderr.write(
    `codex interrupt spike starting sdk=${sdkVersion} os=${detectOsFamily()} bun=${Bun.version}\n`
  );

  const host = await runHostProtocol(sdkVersion);
  const missing = requiredMissingFamilies(host.osFamily);
  // Overall report is BLOCKED if any required family is missing OR host failed.
  const reportOverall = missing.length > 0 || host.overall !== 'PASS' ? 'BLOCKED' : 'PASS';

  const report = renderFullReport({ host, missingFamilies: missing });
  const outPath = join(repoRootFromSpike(), REPORT_RELATIVE);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, report, 'utf8');

  // Machine-readable one-liner for operators (no secrets).
  process.stdout.write(
    JSON.stringify({
      schemaVersion: 1,
      overall: reportOverall,
      hostFamily: host.osFamily,
      hostOverall: host.overall,
      missingFamilies: missing,
      terminalFragments: host.caseA?.terminal.messageFragments ?? [],
      terminalKind: host.caseA?.terminal.kind ?? null,
      blockReasonCount: host.blockReasons.length + missing.length,
      report: REPORT_RELATIVE,
    }) + '\n'
  );

  if (reportOverall !== 'PASS') process.exitCode = 1;
}

if (import.meta.main) {
  await main();
}
