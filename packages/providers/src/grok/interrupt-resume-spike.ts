/**
 * Diagnostic-only Grok turn-interrupt spike.
 * Do not export from the providers package barrel. Do not run the live spike in tests or CI.
 *
 * Proves Phase-1 release gates against the real Grok CLI before production code
 * advertises interrupt: 'stream-abort':
 *  S0 preflight assigned --session-id acceptance
 *  S1 POSIX mid-tool SIGTERM + same-ID resume
 *  S2 earliest SIGTERM immediately after spawn + same-ID resume
 *  S3 repeated Stop on the S1 session
 *  S4 native Windows path (only when process.platform === 'win32')
 *
 * Output: sanitized JSON evidence on stdout (no prompt text, credentials,
 * model content, home paths, or session contents). Non-zero exit when any
 * required gate on this host is blocked.
 *
 * Optional: GROK_SPIKE_REPORT_PATH writes a sanitized markdown report.
 * Optional: GROK_SPIKE_ONLY=S0,S1 scopes experiments.
 */
import { execFileSync, spawn, type ChildProcessByStdio } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';

import { resolveGrokBinaryPath } from './binary-resolver';

const EXPERIMENT_TIMEOUT_MS = 180_000;
const PID_WAIT_MS = 45_000;
const EXIT_WAIT_MS = 15_000;
/** Proposed interrupt grace matching production provider SIGTERM→SIGKILL window. */
const PROPOSED_GRACE_MS = 5_000;
const SIGNAL_TO_EXIT_BUDGET_MS = 1_000;
const CONTINUATION_PREFIX = 'SPIKE_CONT_';
const SLOW_PID_FILE = 'slow_tool.pid';
const NO_SHELL_DISALLOWED =
  'run_terminal_command,run_terminal_cmd,Agent,write,search_replace,web_search,web_fetch';

type GateStatus = 'PASS' | 'BLOCKED' | 'SKIPPED';
type ExperimentId = 'S0' | 'S1' | 'S2' | 'S3' | 'S4';

interface ParsedLine {
  type: string;
  stopReason?: string;
  sessionId?: string;
  text?: string;
  hasUsage?: boolean;
  hasEndUsage?: boolean;
  toolStatus?: string;
}

interface ExperimentResult {
  id: ExperimentId;
  platform: string;
  eventTypes: string[];
  endStopReason: string | null;
  assignedSessionId: string | null;
  reportedSessionId: string | null;
  sessionIdEqual: boolean | null;
  standaloneUsageSeen: boolean;
  finalUsageSeen: boolean;
  exitCode: number | null;
  signalToExitMs: number | null;
  usedSigkill: boolean;
  childPid: number | null;
  childAliveAfterParentExit: boolean | null;
  resumeExitCode: number | null;
  resumeSameSession: boolean | null;
  resumeContextRetained: boolean | null;
  passed: boolean;
  notes: string[];
}

interface ReleaseGate {
  id: number;
  title: string;
  status: GateStatus;
  evidence: string;
}

export interface SpikeDocument {
  schemaVersion: 1;
  kind: 'grok-interrupt-resume-spike';
  cliVersion: string;
  binaryPathBasename: string;
  platform: string;
  arch: string;
  hostKind: 'native' | 'container';
  experiments: ExperimentResult[];
  releaseGates: ReleaseGate[];
  minimumVersionDecision: string;
  processGroupDecision: string;
  proposedGraceMs: number;
  cleanup: {
    sessionsDeleted: string[];
    sessionsDeleteFailed: string[];
    tempDirRemoved: boolean;
  };
  overall: 'PASS' | 'BLOCKED';
}

type SanitizedExperimentResult = Omit<
  ExperimentResult,
  'assignedSessionId' | 'reportedSessionId' | 'childPid'
>;

export type SanitizedSpikeDocument = Omit<SpikeDocument, 'experiments' | 'cleanup'> & {
  experiments: SanitizedExperimentResult[];
  cleanup: {
    sessionsDeleted: number;
    sessionsDeleteFailed: string[];
    tempDirRemoved: boolean;
  };
};

interface RunOutcome {
  exitCode: number | null;
  eventTypes: string[];
  endStopReason: string | null;
  reportedSessionId: string | null;
  standaloneUsageSeen: boolean;
  finalUsageSeen: boolean;
  signalToExitMs: number | null;
  usedSigkill: boolean;
  firstStdoutAtMs: number | null;
  sawToolInProgress: boolean;
  expectedTextSeen: boolean | null;
  errorMessage: string | null;
}

interface ExitObservation {
  code: number | null;
  signal: NodeJS.Signals | null;
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function fieldString(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function parseLine(line: string): ParsedLine | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { type: 'non_json' };
  }
  const event = parseJsonObject(parsed);
  if (!event) return { type: 'non_object' };
  const type = fieldString(event, 'type') ?? 'unknown';
  const usageObj = parseJsonObject(event.usage);
  const modelUsageObj = parseJsonObject(event.modelUsage);
  return {
    type,
    stopReason: fieldString(event, 'stopReason'),
    sessionId: fieldString(event, 'sessionId'),
    text: type === 'text' ? fieldString(event, 'data') : undefined,
    hasUsage: type === 'usage' ? true : usageObj !== null,
    hasEndUsage: type === 'end' && (usageObj !== null || modelUsageObj !== null),
    toolStatus: fieldString(event, 'status'),
  };
}

function emptyExperiment(id: ExperimentId, platform: string): ExperimentResult {
  return {
    id,
    platform,
    eventTypes: [],
    endStopReason: null,
    assignedSessionId: null,
    reportedSessionId: null,
    sessionIdEqual: null,
    standaloneUsageSeen: false,
    finalUsageSeen: false,
    exitCode: null,
    signalToExitMs: null,
    usedSigkill: false,
    childPid: null,
    childAliveAfterParentExit: null,
    resumeExitCode: null,
    resumeSameSession: null,
    resumeContextRetained: null,
    passed: false,
    notes: [],
  };
}

function buildSpawnCommand(binaryPath: string, args: string[]): string[] {
  if (process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(binaryPath)) {
    return ['cmd.exe', '/d', '/s', '/c', binaryPath, ...args];
  }
  return [binaryPath, ...args];
}

function buildHeadlessArgs(input: {
  prompt: string;
  cwd: string;
  sessionId?: string;
  resumeSessionId?: string;
  tools?: string;
  disallowedTools?: string;
}): string[] {
  const args = [
    '--single',
    input.prompt,
    '--verbatim',
    '--cwd',
    input.cwd,
    '--output-format',
    'streaming-json',
    '--permission-mode',
    'bypassPermissions',
    '--no-auto-update',
    '--sandbox',
    'workspace',
    '--disable-web-search',
    '--no-subagents',
  ];
  if (input.sessionId) args.push('--session-id', input.sessionId);
  if (input.resumeSessionId) args.push('--resume', input.resumeSessionId);
  if (input.tools) args.push('--tools', input.tools);
  if (input.disallowedTools) args.push('--disallowed-tools', input.disallowedTools);
  return args;
}

type SpawnedGrokChild = ChildProcessByStdio<null, Readable, Readable>;

interface OwnedProcess {
  child: SpawnedGrokChild;
  kill: (signal: NodeJS.Signals) => boolean;
}

function spawnGrok(binaryPath: string, args: string[], cwd: string): OwnedProcess {
  const command = buildSpawnCommand(binaryPath, args);
  const [file, ...rest] = command;
  if (!file) throw new Error('empty spawn command');
  const child = spawn(file, rest, {
    cwd,
    env: { ...process.env, GROK_DISABLE_AUTOUPDATER: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  return {
    child,
    kill: (signal: NodeJS.Signals): boolean => {
      try {
        return child.kill(signal);
      } catch {
        return false;
      }
    },
  };
}

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForPidExit(pid: number, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return true;
    await delay(50);
  }
  return !isPidAlive(pid);
}

function currentExit(child: SpawnedGrokChild): ExitObservation | null {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }
  return null;
}

async function waitForExit(
  child: SpawnedGrokChild,
  timeoutMs: number
): Promise<ExitObservation | null> {
  const already = currentExit(child);
  if (already) return already;
  const { promise, resolve } = Promise.withResolvers<ExitObservation | null>();
  const timer = setTimeout(() => {
    resolve(null);
  }, timeoutMs);
  child.once('exit', (code, signal) => {
    clearTimeout(timer);
    resolve({ code, signal });
  });
  child.once('error', () => {
    clearTimeout(timer);
    resolve(null);
  });
  return await promise;
}

function normalizeExitCode(obs: ExitObservation | null): number | null {
  if (!obs) return null;
  if (obs.code !== null) return obs.code;
  if (obs.signal === 'SIGTERM') return 143;
  if (obs.signal === 'SIGINT') return 130;
  if (obs.signal === 'SIGKILL') return 137;
  return null;
}

export async function consumeStdout(
  child: SpawnedGrokChild,
  onEvent?: (event: ParsedLine) => void,
  expectedText?: string
): Promise<{
  eventTypes: string[];
  endStopReason: string | null;
  reportedSessionId: string | null;
  standaloneUsageSeen: boolean;
  finalUsageSeen: boolean;
  sawToolInProgress: boolean;
  firstStdoutAtMs: number | null;
  expectedTextSeen: boolean | null;
}> {
  const started = Date.now();
  const eventTypes: string[] = [];
  let endStopReason: string | null = null;
  let reportedSessionId: string | null = null;
  let standaloneUsageSeen = false;
  let finalUsageSeen = false;
  let sawToolInProgress = false;
  let firstStdoutAtMs: number | null = null;
  let textOutput = '';
  let buffer = '';

  const recordParsedLine = (parsed: ParsedLine | null): void => {
    if (!parsed) return;
    onEvent?.(parsed);
    eventTypes.push(parsed.type);
    if (parsed.type === 'usage') standaloneUsageSeen = true;
    if (parsed.type === 'end') {
      endStopReason = parsed.stopReason ?? null;
      reportedSessionId = parsed.sessionId ?? null;
      finalUsageSeen = Boolean(parsed.hasEndUsage) || finalUsageSeen;
    }
    if (
      parsed.type === 'tool_call' ||
      (parsed.type === 'tool_call_update' && parsed.toolStatus === 'in_progress')
    ) {
      sawToolInProgress = true;
    }
    if (parsed.type === 'text' && parsed.text !== undefined) textOutput += parsed.text;
  };

  try {
    for await (const chunk of child.stdout) {
      if (firstStdoutAtMs === null) {
        firstStdoutAtMs = Date.now() - started;
      }
      const piece = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
      buffer += piece;
      let nl = buffer.indexOf('\n');
      while (nl >= 0) {
        recordParsedLine(parseLine(buffer.slice(0, nl)));
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf('\n');
      }
    }
    if (buffer.trim().length > 0) {
      recordParsedLine(parseLine(buffer));
    }
  } catch {
    // stdout may close under signal; recorded types so far still count
  }

  return {
    eventTypes,
    endStopReason,
    reportedSessionId,
    standaloneUsageSeen,
    finalUsageSeen,
    sawToolInProgress,
    firstStdoutAtMs,
    expectedTextSeen: expectedText === undefined ? null : textOutput.trim() === expectedText,
  };
}

async function runGrokTurn(input: {
  binaryPath: string;
  cwd: string;
  prompt: string;
  sessionId?: string;
  resumeSessionId?: string;
  tools?: string;
  disallowedTools?: string;
  /** SIGTERM when the first assistant text event proves the turn is active. */
  interruptOnFirstText?: boolean;
  interruptWhenPidFile?: string;
  /** SIGTERM immediately after spawn, before any stdout. */
  interruptImmediately?: boolean;
  /** Exact response expected from a same-session continuation, never reported. */
  expectedText?: string;
  timeoutMs?: number;
}): Promise<RunOutcome> {
  const args = buildHeadlessArgs({
    prompt: input.prompt,
    cwd: input.cwd,
    sessionId: input.sessionId,
    resumeSessionId: input.resumeSessionId,
    tools: input.tools,
    disallowedTools: input.disallowedTools,
  });
  const owned = spawnGrok(input.binaryPath, args, input.cwd);
  let usedSigkill = false;
  let interrupted = false;
  let processExited = false;
  let signalSentAt: number | null = null;
  let exitedAt: number | null = null;
  let lastExit: ExitObservation | null = null;
  let errorMessage: string | null = null;
  let stderrTail = '';
  let sigkillTimer: ReturnType<typeof setTimeout> | undefined;

  owned.child.once('exit', (code, signal) => {
    processExited = true;
    exitedAt = Date.now();
    lastExit = { code, signal };
    if (sigkillTimer !== undefined) clearTimeout(sigkillTimer);
  });

  const maybeInterrupt = (): void => {
    if (interrupted || processExited) return;
    interrupted = true;
    signalSentAt = Date.now();
    sigkillTimer = setTimeout(() => {
      // Signal deaths leave exitCode null — gate on processExited, not exitCode.
      if (!processExited) {
        usedSigkill = true;
        owned.kill('SIGKILL');
      }
    }, PROPOSED_GRACE_MS);
    owned.kill('SIGTERM');
  };

  if (input.interruptImmediately) {
    maybeInterrupt();
  }

  owned.child.stderr.setEncoding('utf8');
  owned.child.stderr.on('data', (chunk: string) => {
    if (stderrTail.length < 4_000) stderrTail += chunk.slice(0, 4_000 - stderrTail.length);
  });

  const pidPath = input.interruptWhenPidFile;
  const pidWatcher =
    pidPath !== undefined
      ? (async (): Promise<void> => {
          const deadline = Date.now() + PID_WAIT_MS;
          while (Date.now() < deadline) {
            if (existsSync(pidPath)) {
              await delay(50);
              maybeInterrupt();
              return;
            }
            if (processExited) return;
            await delay(50);
          }
          errorMessage ??= 'pid-file-timeout';
          maybeInterrupt();
        })()
      : Promise.resolve();

  const stdoutPromise = consumeStdout(
    owned.child,
    event => {
      if (input.interruptOnFirstText && event.type === 'text') maybeInterrupt();
    },
    input.expectedText
  );

  const timeoutMs = input.timeoutMs ?? EXPERIMENT_TIMEOUT_MS;
  const timelyExit = await waitForExit(owned.child, timeoutMs);
  if (timelyExit === null && !processExited) {
    usedSigkill = true;
    owned.kill('SIGKILL');
  }

  const stdout = await waitForStdout(stdoutPromise);
  await pidWatcher.catch(() => undefined);

  if (!processExited) {
    const late = await waitForExit(owned.child, EXIT_WAIT_MS);
    if (late) lastExit = late;
  }
  if (!processExited) {
    usedSigkill = true;
    owned.kill('SIGKILL');
    const forced = await waitForExit(owned.child, EXIT_WAIT_MS);
    if (forced) lastExit = forced;
  }
  if (sigkillTimer !== undefined) clearTimeout(sigkillTimer);

  if (errorMessage === null && /auth|credential|sign.?in|login|unauthorized/i.test(stderrTail)) {
    errorMessage = 'authentication';
  }

  return {
    exitCode: normalizeExitCode(lastExit ?? currentExit(owned.child)),
    eventTypes: stdout.eventTypes,
    endStopReason: stdout.endStopReason,
    reportedSessionId: stdout.reportedSessionId,
    standaloneUsageSeen: stdout.standaloneUsageSeen,
    finalUsageSeen: stdout.finalUsageSeen,
    signalToExitMs:
      signalSentAt !== null && exitedAt !== null ? Math.max(0, exitedAt - signalSentAt) : null,
    usedSigkill,
    firstStdoutAtMs: stdout.firstStdoutAtMs,
    sawToolInProgress: stdout.sawToolInProgress,
    expectedTextSeen: stdout.expectedTextSeen,
    errorMessage,
  };
}

async function waitForStdout(
  output: ReturnType<typeof consumeStdout>
): Promise<Awaited<ReturnType<typeof consumeStdout>>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      output,
      new Promise<Awaited<ReturnType<typeof consumeStdout>>>(resolve => {
        timer = setTimeout(() => {
          resolve({
            eventTypes: [],
            endStopReason: null,
            reportedSessionId: null,
            standaloneUsageSeen: false,
            finalUsageSeen: false,
            sawToolInProgress: false,
            firstStdoutAtMs: null,
            expectedTextSeen: null,
          });
        }, 2_000);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function writeSlowToolScript(cwd: string): { pidPath: string; command: string } {
  const isWindows = process.platform === 'win32';
  const scriptName = isWindows ? 'slow_tool.cmd' : 'slow_tool.sh';
  const scriptPath = join(cwd, scriptName);
  const pidPath = join(cwd, SLOW_PID_FILE);
  rmSync(pidPath, { force: true });
  writeFileSync(
    scriptPath,
    isWindows
      ? `@echo off\r\npowershell -NoProfile -Command "$PID | Set-Content -NoNewline -Encoding ascii ${SLOW_PID_FILE}; Start-Sleep -Seconds 120"\r\n`
      : `#!/usr/bin/env sh
set -eu
echo $$ > "${SLOW_PID_FILE}"
sleep 120
`,
    { encoding: 'utf8' }
  );
  try {
    chmodSync(scriptPath, 0o755);
  } catch {
    // Windows may ignore mode bits.
  }
  return {
    pidPath,
    command: isWindows ? `cmd.exe /d /s /c ${scriptName}` : `./${scriptName}`,
  };
}

function readPidFile(pidPath: string): number | null {
  try {
    const pid = Number.parseInt(readFileSync(pidPath, 'utf8').trim(), 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function ensureTempGitRepo(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'archon-grok-interrupt-spike-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd, stdio: 'ignore' });
  } catch {
    // Plain directory still satisfies --cwd.
  }
  writeFileSync(join(cwd, 'README'), 'spike\n', 'utf8');
  return cwd;
}

function deleteSession(binaryPath: string, cwd: string, sessionId: string): boolean {
  try {
    const [file, ...args] = buildSpawnCommand(binaryPath, ['sessions', 'delete', sessionId]);
    if (!file) return false;
    execFileSync(file, args, {
      cwd,
      stdio: 'ignore',
      env: { ...process.env, GROK_DISABLE_AUTOUPDATER: '1' },
      timeout: 30_000,
    });
    return true;
  } catch {
    return false;
  }
}

function readCliVersion(binaryPath: string): string {
  try {
    const [file, ...args] = buildSpawnCommand(binaryPath, ['--version']);
    if (!file) throw new Error('empty version command');
    return execFileSync(file, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GROK_DISABLE_AUTOUPDATER: '1' },
      timeout: 15_000,
    }).trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to read grok --version: ${message}`);
  }
}

function continuationMarker(): string {
  return `${CONTINUATION_PREFIX}${randomUUID().replaceAll('-', '').slice(0, 16)}`;
}

function applyTurnFields(result: ExperimentResult, turn: RunOutcome, assigned: string): void {
  result.eventTypes = turn.eventTypes;
  result.endStopReason = turn.endStopReason;
  result.reportedSessionId = turn.reportedSessionId;
  result.sessionIdEqual =
    turn.reportedSessionId === null ? null : turn.reportedSessionId === assigned;
  result.standaloneUsageSeen = turn.standaloneUsageSeen;
  result.finalUsageSeen = turn.finalUsageSeen;
  result.exitCode = turn.exitCode;
  result.signalToExitMs = turn.signalToExitMs;
  result.usedSigkill = turn.usedSigkill;
  if (turn.errorMessage) result.notes.push(turn.errorMessage);
}

async function runResumeCheck(input: {
  binaryPath: string;
  cwd: string;
  sessionId: string;
  contextMarker: string;
}): Promise<{
  exitCode: number | null;
  sameSession: boolean;
  retained: boolean;
  eventTypes: string[];
}> {
  const turn = await runGrokTurn({
    binaryPath: input.binaryPath,
    cwd: input.cwd,
    resumeSessionId: input.sessionId,
    prompt:
      'Reply with only the exact non-secret context token from the interrupted turn. Do not add commentary.',
    disallowedTools: NO_SHELL_DISALLOWED,
    expectedText: input.contextMarker,
    timeoutMs: 90_000,
  });
  return {
    exitCode: turn.exitCode,
    sameSession: turn.reportedSessionId === input.sessionId,
    retained:
      turn.exitCode === 0 &&
      turn.reportedSessionId === input.sessionId &&
      turn.endStopReason !== null &&
      turn.expectedTextSeen === true,
    eventTypes: turn.eventTypes,
  };
}

async function runS0(binaryPath: string, cwd: string, platform: string): Promise<ExperimentResult> {
  const result = emptyExperiment('S0', platform);
  const sessionId = randomUUID();
  result.assignedSessionId = sessionId;
  const turn = await runGrokTurn({
    binaryPath,
    cwd,
    sessionId,
    prompt: 'Reply with exactly OK and nothing else.',
    disallowedTools: NO_SHELL_DISALLOWED,
    timeoutMs: 90_000,
  });
  applyTurnFields(result, turn, sessionId);
  result.passed =
    turn.exitCode === 0 && result.sessionIdEqual === true && turn.endStopReason !== null;
  if (!result.passed) result.notes.push('S0 requires exit 0 and end.sessionId === assigned UUID');
  return result;
}

async function runS1(binaryPath: string, cwd: string, platform: string): Promise<ExperimentResult> {
  const result = emptyExperiment('S1', platform);
  const sessionId = randomUUID();
  result.assignedSessionId = sessionId;
  const marker = continuationMarker();
  const { pidPath, command } = writeSlowToolScript(cwd);
  const turn = await runGrokTurn({
    binaryPath,
    cwd,
    sessionId,
    prompt: `Remember this exact non-secret context token for a later turn: ${marker}. Using the shell tool, execute ${command} in the foreground. Do not background it yourself. Do not edit files.`,
    tools: 'run_terminal_command,run_terminal_cmd',
    interruptWhenPidFile: pidPath,
    timeoutMs: 120_000,
  });
  applyTurnFields(result, turn, sessionId);
  const childPid = readPidFile(pidPath);
  result.childPid = childPid;
  // Parent exit must be observed before the liveness check.
  result.childAliveAfterParentExit = childPid !== null ? isPidAlive(childPid) : null;
  if (childPid !== null && result.childAliveAfterParentExit === true) {
    try {
      process.kill(childPid, 'SIGKILL');
      if (await waitForPidExit(childPid)) {
        result.notes.push('exact-child-pid-cleaned-by-spike');
      } else {
        result.notes.push('exact-child-pid-still-alive-after-sigkill');
      }
    } catch {
      // exact-PID cleanup only
      result.notes.push('exact-child-pid-cleanup-failed');
    }
  }
  if (!turn.sawToolInProgress && childPid === null) result.notes.push('mid-tool-not-observed');

  const resume = await runResumeCheck({ binaryPath, cwd, sessionId, contextMarker: marker });
  result.resumeExitCode = resume.exitCode;
  result.resumeSameSession = resume.sameSession;
  result.resumeContextRetained = resume.retained;
  result.eventTypes = [...result.eventTypes, ...resume.eventTypes.map(t => `resume:${t}`)];

  const fastExit =
    result.signalToExitMs !== null &&
    result.signalToExitMs < SIGNAL_TO_EXIT_BUDGET_MS &&
    result.signalToExitMs <= PROPOSED_GRACE_MS;
  result.passed =
    !result.usedSigkill &&
    fastExit &&
    (result.exitCode === 143 || result.exitCode === 130) &&
    result.childAliveAfterParentExit === false &&
    resume.exitCode === 0 &&
    resume.sameSession &&
    resume.retained &&
    (result.reportedSessionId === null || result.reportedSessionId === sessionId);
  if (!result.passed) {
    result.notes.push(
      `S1 checks: sigkill=${String(result.usedSigkill)} signalToExitMs=${String(result.signalToExitMs)} exit=${String(result.exitCode)} childAlive=${String(result.childAliveAfterParentExit)} resumeExit=${String(resume.exitCode)} resumeSame=${String(resume.sameSession)}`
    );
  }
  return result;
}

async function runS2(binaryPath: string, cwd: string, platform: string): Promise<ExperimentResult> {
  const result = emptyExperiment('S2', platform);
  const sessionId = randomUUID();
  result.assignedSessionId = sessionId;
  const marker = continuationMarker();
  const turn = await runGrokTurn({
    binaryPath,
    cwd,
    sessionId,
    prompt: `Remember this exact non-secret context token for a later turn: ${marker}. Count slowly from 1 to 10000, one number per line, with no other commentary.`,
    disallowedTools: NO_SHELL_DISALLOWED,
    interruptImmediately: true,
    timeoutMs: 90_000,
  });
  applyTurnFields(result, turn, sessionId);
  if (turn.firstStdoutAtMs !== null) {
    result.notes.push(`firstStdoutAtMs=${String(turn.firstStdoutAtMs)}`);
  }

  const resume = await runResumeCheck({ binaryPath, cwd, sessionId, contextMarker: marker });
  result.resumeExitCode = resume.exitCode;
  result.resumeSameSession = resume.sameSession;
  result.resumeContextRetained = resume.retained;

  result.passed =
    !result.usedSigkill &&
    result.signalToExitMs !== null &&
    result.signalToExitMs < SIGNAL_TO_EXIT_BUDGET_MS &&
    turn.firstStdoutAtMs === null &&
    (result.exitCode === 143 || result.exitCode === 130) &&
    resume.exitCode === 0 &&
    resume.sameSession &&
    resume.retained;
  if (!result.passed) {
    result.notes.push(
      `S2 checks: sigkill=${String(result.usedSigkill)} signalToExitMs=${String(result.signalToExitMs)} exit=${String(result.exitCode)} resumeExit=${String(resume.exitCode)} resumeSame=${String(resume.sameSession)}`
    );
  }
  return result;
}

async function runS3(
  binaryPath: string,
  cwd: string,
  platform: string,
  priorSessionId: string | null
): Promise<ExperimentResult> {
  const result = emptyExperiment('S3', platform);
  if (!priorSessionId) {
    result.notes.push('S1 did not provide a resumable session for repeated-stop verification');
    return result;
  }
  const sessionId = priorSessionId;
  result.assignedSessionId = sessionId;
  const marker = continuationMarker();
  const turn = await runGrokTurn({
    binaryPath,
    cwd,
    resumeSessionId: sessionId,
    prompt: `Remember this exact non-secret context token for a later turn: ${marker}. Count slowly from 1 to 10000, one number per line, with no other commentary.`,
    disallowedTools: NO_SHELL_DISALLOWED,
    interruptOnFirstText: true,
    timeoutMs: 90_000,
  });
  applyTurnFields(result, turn, sessionId);

  const resume = await runResumeCheck({ binaryPath, cwd, sessionId, contextMarker: marker });
  result.resumeExitCode = resume.exitCode;
  result.resumeSameSession = resume.sameSession;
  result.resumeContextRetained = resume.retained;

  result.passed =
    !result.usedSigkill &&
    result.signalToExitMs !== null &&
    result.signalToExitMs < SIGNAL_TO_EXIT_BUDGET_MS &&
    (result.exitCode === 143 || result.exitCode === 130) &&
    resume.exitCode === 0 &&
    resume.sameSession &&
    resume.retained;
  if (!result.passed) {
    result.notes.push(
      `S3 checks: sigkill=${String(result.usedSigkill)} signalToExitMs=${String(result.signalToExitMs)} exit=${String(result.exitCode)} resumeExit=${String(resume.exitCode)} resumeSame=${String(resume.sameSession)}`
    );
  }
  return result;
}

async function runS4(
  binaryPath: string,
  cwd: string,
  trackSession: (sessionId: string | null | undefined) => void
): Promise<ExperimentResult> {
  const result = emptyExperiment('S4', 'win32');
  if (process.platform !== 'win32') {
    result.notes.push('host-is-not-native-windows');
    result.passed = false;
    return result;
  }
  const s1 = await runS1(binaryPath, cwd, 'win32');
  trackSession(s1.assignedSessionId);
  const s2 = await runS2(binaryPath, cwd, 'win32');
  trackSession(s2.assignedSessionId);
  result.eventTypes = [...s1.eventTypes, ...s2.eventTypes];
  result.assignedSessionId = s1.assignedSessionId;
  result.reportedSessionId = s1.reportedSessionId;
  result.sessionIdEqual = s1.sessionIdEqual;
  result.exitCode = s1.exitCode;
  result.signalToExitMs = s1.signalToExitMs;
  result.usedSigkill = s1.usedSigkill || s2.usedSigkill;
  result.childPid = s1.childPid;
  result.childAliveAfterParentExit = s1.childAliveAfterParentExit;
  result.resumeExitCode = s2.resumeExitCode;
  result.resumeSameSession = Boolean(s1.resumeSameSession) && Boolean(s2.resumeSameSession);
  result.resumeContextRetained =
    Boolean(s1.resumeContextRetained) && Boolean(s2.resumeContextRetained);
  result.standaloneUsageSeen = s1.standaloneUsageSeen || s2.standaloneUsageSeen;
  result.finalUsageSeen = s1.finalUsageSeen || s2.finalUsageSeen;
  result.passed = s1.passed && s2.passed;
  result.notes.push(...s1.notes.map(n => `S1:${n}`), ...s2.notes.map(n => `S2:${n}`));
  return result;
}

function evaluateGates(
  experiments: ExperimentResult[],
  minimumVersionDecision: string
): ReleaseGate[] {
  const byId = new Map(experiments.map(e => [e.id, e]));
  const s0 = byId.get('S0');
  const s1 = byId.get('S1');
  const s2 = byId.get('S2');
  const s3 = byId.get('S3');
  const s4 = byId.get('S4');

  return [
    {
      id: 1,
      title: 'caller-assigned session IDs accepted and returned',
      status: s0?.passed ? 'PASS' : 'BLOCKED',
      evidence: s0
        ? `S0 exit=${String(s0.exitCode)} sessionIdEqual=${String(s0.sessionIdEqual)}`
        : 'S0 missing',
    },
    {
      id: 2,
      title: 'S1/S2/S3 resume same session with retained context',
      status:
        s1?.resumeSameSession === true &&
        s1?.resumeContextRetained === true &&
        s2?.resumeSameSession === true &&
        s2?.resumeContextRetained === true &&
        s3?.resumeSameSession === true &&
        s3?.resumeContextRetained === true
          ? 'PASS'
          : 'BLOCKED',
      evidence: `S1resume=${String(s1?.resumeSameSession)}/${String(s1?.resumeContextRetained)} S2resume=${String(s2?.resumeSameSession)}/${String(s2?.resumeContextRetained)} S3resume=${String(s3?.resumeSameSession)}/${String(s3?.resumeContextRetained)}`,
    },
    {
      id: 3,
      title: 'ordinary SIGTERM exits <1s inside grace without SIGKILL',
      status:
        s1 &&
        s2 &&
        !s1.usedSigkill &&
        !s2.usedSigkill &&
        s1.signalToExitMs !== null &&
        s2.signalToExitMs !== null &&
        s1.signalToExitMs < SIGNAL_TO_EXIT_BUDGET_MS &&
        s2.signalToExitMs < SIGNAL_TO_EXIT_BUDGET_MS
          ? 'PASS'
          : 'BLOCKED',
      evidence: `S1ms=${String(s1?.signalToExitMs)} S2ms=${String(s2?.signalToExitMs)} sigkill=${String(Boolean(s1?.usedSigkill || s2?.usedSigkill))}`,
    },
    {
      id: 4,
      title: 'slow-tool child gone after parent exit (or process-group required)',
      // Phase-1 gate allows either child reaped OR an explicit process-group requirement.
      status:
        s1?.childAliveAfterParentExit === false || s1?.childAliveAfterParentExit === true
          ? 'PASS'
          : 'BLOCKED',
      evidence:
        s1?.childAliveAfterParentExit === false
          ? `child gone after parent exit (pid recorded=${String(s1.childPid != null)})`
          : s1?.childAliveAfterParentExit === true
            ? 'child survived parent exit — Phase 2 MUST own a POSIX process group and signal it'
            : `childAliveAfterParentExit=${String(s1?.childAliveAfterParentExit)} childPidRecorded=${String(s1?.childPid != null)}`,
    },
    {
      id: 5,
      title: 'S4 native Windows under real launch path',
      status: s4?.passed ? 'PASS' : 'BLOCKED',
      evidence: s4?.notes.join('; ') || 'S4 missing',
    },
    {
      id: 6,
      title: 'minimum supported CLI version/floor explicit',
      status: s0?.passed ? 'PASS' : 'BLOCKED',
      evidence: minimumVersionDecision,
    },
    {
      id: 7,
      title: 'standalone/final usage presence recorded without inventing spend',
      status: 'PASS',
      evidence: experiments
        .map(
          e =>
            `${e.id}:standalone=${String(e.standaloneUsageSeen)},final=${String(e.finalUsageSeen)}`
        )
        .join('; '),
    },
  ];
}

function decideProcessGroup(s1: ExperimentResult | undefined): string {
  if (!s1) return 'unknown — S1 not run';
  if (s1.childAliveAfterParentExit === false) {
    return 'no process-group ownership required — exact child PID was gone after parent SIGTERM exit';
  }
  if (s1.childAliveAfterParentExit === true) {
    return 'Phase 2 MUST add POSIX process-group ownership — exact child PID survived parent exit';
  }
  return 'inconclusive — child PID was not observed; do not assume group semantics';
}

function renderReport(doc: SpikeDocument): string {
  const lines: string[] = [
    '# Grok interrupt/resume spike evidence',
    '',
    `- **Overall**: ${doc.overall}`,
    `- **CLI version**: \`${doc.cliVersion}\``,
    `- **Binary basename**: \`${doc.binaryPathBasename}\``,
    `- **Platform**: \`${doc.platform}\` (${doc.hostKind})`,
    `- **Arch**: \`${doc.arch}\``,
    `- **Proposed grace**: ${String(doc.proposedGraceMs)} ms`,
    '',
    '## Minimum version decision',
    '',
    doc.minimumVersionDecision,
    '',
    '## Process-group decision',
    '',
    doc.processGroupDecision,
    '',
    '## Experiments',
    '',
    '| ID | Platform | Passed | Exit | Signal→exit ms | SIGKILL | Session equal | Resume same | Child alive | Standalone usage | Final usage |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const e of doc.experiments) {
    lines.push(
      `| ${e.id} | ${e.platform} | ${String(e.passed)} | ${String(e.exitCode)} | ${String(e.signalToExitMs)} | ${String(e.usedSigkill)} | ${String(e.sessionIdEqual)} | ${String(e.resumeSameSession)} | ${String(e.childAliveAfterParentExit)} | ${String(e.standaloneUsageSeen)} | ${String(e.finalUsageSeen)} |`
    );
  }
  lines.push('', '### Event types (no payloads)', '');
  for (const e of doc.experiments) {
    lines.push(`- **${e.id}**: ${e.eventTypes.join(', ') || '(none)'}`);
    if (e.notes.length > 0) lines.push(`  - notes: ${e.notes.join(' | ')}`);
  }
  lines.push(
    '',
    '## Release gates',
    '',
    '| # | Gate | Status | Evidence |',
    '| --- | --- | --- | --- |'
  );
  for (const g of doc.releaseGates) {
    lines.push(`| ${String(g.id)} | ${g.title} | **${g.status}** | ${g.evidence} |`);
  }
  lines.push(
    '',
    '## Cleanup',
    '',
    `- sessions deleted: ${String(doc.cleanup.sessionsDeleted.length)} (UUIDs omitted when delete succeeded)`,
    `- sessions delete failed: ${String(doc.cleanup.sessionsDeleteFailed.length)}${doc.cleanup.sessionsDeleteFailed.length > 0 ? ` — UUIDs: ${doc.cleanup.sessionsDeleteFailed.join(', ')}` : ''}`,
    `- temp dir removed: ${String(doc.cleanup.tempDirRemoved)}`,
    '',
    '## Commands (shape only)',
    '',
    '```text',
    'grok --version',
    'grok --single <nonce-prompt> --verbatim --cwd <temp-git-repo> --output-format streaming-json --permission-mode bypassPermissions --no-auto-update --sandbox workspace --session-id <uuid> [--resume <uuid>] [--tools run_terminal_command]',
    'grok sessions delete <uuid>   # from the matching temp cwd only',
    '```',
    '',
    '## Sanitization',
    '',
    'This report contains no credentials, prompt/model output, home paths, or session transcript contents. Session UUIDs are listed only when delete failed and manual cleanup is required.',
    ''
  );
  return `${lines.join('\n')}\n`;
}

export function sanitizeSpikeDocument(doc: SpikeDocument): SanitizedSpikeDocument {
  return {
    ...doc,
    experiments: doc.experiments.map(experiment => {
      const { assignedSessionId, reportedSessionId, childPid, ...sanitized } = experiment;
      void assignedSessionId;
      void reportedSessionId;
      void childPid;
      return sanitized;
    }),
    cleanup: {
      sessionsDeleted: doc.cleanup.sessionsDeleted.length,
      sessionsDeleteFailed: doc.cleanup.sessionsDeleteFailed,
      tempDirRemoved: doc.cleanup.tempDirRemoved,
    },
  };
}

async function main(): Promise<void> {
  const binaryPath = await resolveGrokBinaryPath(process.env.GROK_SPIKE_BIN_PATH, process.env);
  const hostKind = process.env.GROK_SPIKE_HOST_KIND === 'container' ? 'container' : 'native';
  const only = process.env.GROK_SPIKE_ONLY?.trim();
  const skipS3 = process.env.GROK_SPIKE_SKIP_S3 === '1';
  const skipS4 = process.env.GROK_SPIKE_SKIP_S4 === '1' || process.platform !== 'win32';
  const wanted = only ? new Set(only.split(',').map(s => s.trim().toUpperCase())) : null;
  const want = (id: string): boolean => wanted === null || wanted.has(id);

  if (only) process.stderr.write(`spike scope override GROK_SPIKE_ONLY=${only}\n`);

  const platform = `${process.platform}/${process.arch}`;
  const cliVersion = readCliVersion(binaryPath);
  const cwd = ensureTempGitRepo();
  const sessions = new Set<string>();
  const sessionsDeleted: string[] = [];
  const sessionsDeleteFailed: string[] = [];
  const experiments: ExperimentResult[] = [];
  let tempDirRemoved = false;
  let s1Session: string | null = null;

  const track = (id: string | null | undefined): void => {
    if (id) sessions.add(id);
  };

  try {
    if (want('S0')) {
      const s0 = await runS0(binaryPath, cwd, platform);
      track(s0.assignedSessionId);
      experiments.push(s0);
    }
    if (want('S1')) {
      const s1 = await runS1(binaryPath, cwd, platform);
      track(s1.assignedSessionId);
      s1Session = s1.assignedSessionId;
      experiments.push(s1);
    }
    if (want('S2')) {
      const s2 = await runS2(binaryPath, cwd, platform);
      track(s2.assignedSessionId);
      experiments.push(s2);
    }
    if (want('S3') && !skipS3) {
      const s3 = await runS3(binaryPath, cwd, platform, s1Session);
      track(s3.assignedSessionId);
      experiments.push(s3);
    }
    if (want('S4')) {
      if (skipS4) {
        const skipped = emptyExperiment('S4', 'win32');
        skipped.notes.push(
          process.platform === 'win32' ? 'skipped-by-environment' : 'not-run-on-non-windows-host'
        );
        skipped.passed = false;
        experiments.push(skipped);
      } else {
        const s4 = await runS4(binaryPath, cwd, track);
        experiments.push(s4);
      }
    }

    const s0 = experiments.find(e => e.id === 'S0');
    const s1 = experiments.find(e => e.id === 'S1');
    const versionLine = (cliVersion.split('\n')[0] ?? cliVersion).trim();
    const minimumVersionDecision = s0?.passed
      ? `Minimum supported CLI version floor: ${versionLine} (exact tested build). Older builds unproven — doctor should fail below this floor until re-spiked.`
      : `S0 not passed on ${versionLine}; no minimum version can be published from this run.`;

    for (const id of sessions) {
      if (deleteSession(binaryPath, cwd, id)) sessionsDeleted.push(id);
      else sessionsDeleteFailed.push(id);
    }
    try {
      rmSync(cwd, { recursive: true, force: true });
      tempDirRemoved = true;
    } catch {
      tempDirRemoved = false;
    }

    const releaseGates = evaluateGates(experiments, minimumVersionDecision);
    const overall: 'PASS' | 'BLOCKED' = releaseGates.every(g => g.status === 'PASS')
      ? 'PASS'
      : 'BLOCKED';

    const document: SpikeDocument = {
      schemaVersion: 1,
      kind: 'grok-interrupt-resume-spike',
      cliVersion: versionLine,
      binaryPathBasename: basename(binaryPath),
      platform,
      arch: process.arch,
      hostKind,
      experiments,
      releaseGates,
      minimumVersionDecision,
      processGroupDecision: decideProcessGroup(s1),
      proposedGraceMs: PROPOSED_GRACE_MS,
      cleanup: { sessionsDeleted, sessionsDeleteFailed, tempDirRemoved },
      overall,
    };

    const reportPath = process.env.GROK_SPIKE_REPORT_PATH?.trim();
    if (reportPath) {
      mkdirSync(dirname(reportPath), { recursive: true });
      writeFileSync(reportPath, renderReport(document), 'utf8');
    }

    process.stdout.write(`${JSON.stringify(sanitizeSpikeDocument(document))}\n`);
    if (document.overall !== 'PASS') process.exitCode = 1;
  } catch (error) {
    for (const id of sessions) {
      if (deleteSession(binaryPath, cwd, id)) sessionsDeleted.push(id);
      else sessionsDeleteFailed.push(id);
    }
    try {
      rmSync(cwd, { recursive: true, force: true });
    } catch {
      // ignore
    }
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(`spike error: ${message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await main();
}
