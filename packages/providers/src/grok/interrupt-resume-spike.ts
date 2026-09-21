/**
 * Diagnostic-only Grok interrupt/resume spike (round 2).
 * Do not export from the providers package barrel. Do not call from tests or CI.
 *
 * Proves Story 2.6 Phase-1 gates against the real Grok CLI before production code
 * advertises interrupt: 'stream-abort':
 *  B0 natural assigned-session completion
 *  B1 spawn-time Stop (negative control)
 *  B2 earliest safe boundary M discovery + text/reasoning/tool shapes
 *  B3 resumed-turn Stop policy at/after M
 *  B4 forked-turn Stop before M
 *  B5 repeated Stop on one retained session
 *  B6 mid-tool Stop in legacy spawn mode
 *  B7 mid-tool Stop in owned-tree spawn mode
 *  B8 natural completion races Stop
 *  B9 node-Cancel tree termination shape
 *  W1 native Windows matrix (only on win32)
 *  Latency: ≥10 new + ≥10 resumed + ≥10 forked samples with Stop before M
 *
 * Invocations go through production buildGrokArgs() + buildSpawnCommand().
 * Deliberate diagnostic-only differences (recorded in the report):
 *  - --no-auto-update + GROK_DISABLE_AUTOUPDATER=1 (reproducibility)
 *  - --session-id / fork --session-id appended for identity tests (Phase-2 seam)
 *  - no --sandbox workspace (not contract-neutral per round-one evidence)
 *
 * Output: sanitized JSON on stdout (event types, timings, booleans only —
 * never credentials, prompts, markers, model text, home paths, or session
 * contents). Non-zero exit when any required gate on this host is blocked.
 *
 * Optional env:
 *  GROK_SPIKE_REPORT_PATH  write sanitized markdown report
 *  GROK_SPIKE_ONLY=B0,B2    scope scenarios
 *  GROK_SPIKE_SAMPLES=N     override latency sample count (default 10)
 *  GROK_SPIKE_HOST_KIND     native|container (default native)
 *  GROK_SPIKE_BIN_PATH      override binary path
 */
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
import { setTimeout as delay } from 'node:timers/promises';

import { resolveGrokBinaryPath } from './binary-resolver';
import { buildGrokArgs, buildSpawnCommand } from './provider';

const EXPERIMENT_TIMEOUT_MS = 180_000;
const PID_WAIT_MS = 45_000;
const EXIT_WAIT_MS = 15_000;
/** Interrupt-path settlement ceiling from Story 2.6 / UX authority. */
const REQUEST_TO_SETTLEMENT_BUDGET_MS = 1_000;
/** Cancel-only grace matching production TERMINATION_GRACE_MS. */
const CANCEL_GRACE_MS = 5_000;
/** Interrupt-path SIGTERM→SIGKILL ceiling (must keep full path under 1000 ms). */
const INTERRUPT_GRACE_MS = 800;
const DEFAULT_LATENCY_SAMPLES = 10;
const SLOW_SCRIPT = 'slow_tool.sh';
const SLOW_PID_FILE = 'slow_tool.pid';
const DENIED_TOOLS_NO_SHELL = [
  'run_terminal_command',
  'run_terminal_cmd',
  'Agent',
  'write',
  'search_replace',
  'web_search',
  'web_fetch',
] as const;
const ALLOWED_SHELL_TOOLS = ['run_terminal_command', 'run_terminal_cmd'] as const;

type GateStatus = 'PASS' | 'BLOCKED' | 'SKIPPED';
type ScenarioId =
  | 'B0'
  | 'B1'
  | 'B2'
  | 'B3'
  | 'B4'
  | 'B5'
  | 'B6'
  | 'B7'
  | 'B8'
  | 'B9'
  | 'W1'
  | 'LAT';
type SpawnMode = 'legacy' | 'owned-tree';
type PromptShape = 'text-only' | 'reasoning-first' | 'tool-first';
type TriggerKind =
  | { kind: 'spawn' }
  | { kind: 'first-stdout-event' }
  | { kind: 'first-event'; eventType: string }
  | { kind: 'pid-file' };

interface ParsedLine {
  type: string;
  stopReason?: string;
  sessionId?: string;
  hasUsage?: boolean;
  hasEndUsage?: boolean;
  toolStatus?: string;
  /** In-memory only — never written to reports. */
  textData?: string;
}

interface TimingFields {
  spawnToRequestMs: number | null;
  requestToBoundaryMs: number | null;
  requestToSignalMs: number | null;
  signalToExitMs: number | null;
  requestToSettlementMs: number | null;
}

interface MarkerRetention {
  current: boolean | null;
  inherited: boolean | null;
  fork: boolean | null;
  sourceWithoutFork: boolean | null;
}

interface ScenarioResult {
  id: ScenarioId;
  platform: string;
  spawnMode: SpawnMode;
  promptShape?: PromptShape;
  trigger?: string;
  eventTypes: string[];
  endStopReason: string | null;
  assignedSessionId: string | null;
  expectedSessionId: string | null;
  reportedSessionId: string | null;
  sessionIdEqual: boolean | null;
  standaloneUsageSeen: boolean;
  finalUsageSeen: boolean;
  exitCode: number | null;
  usedSigkill: boolean;
  escalation: 'none' | 'sigkill' | 'taskkill-tree' | null;
  childFingerprints: string[];
  descendantsAliveAfterExit: boolean | null;
  markerRetention: MarkerRetention;
  resumeExitCode: number | null;
  resumeSameSession: boolean | null;
  timings: TimingFields;
  samples?: LatencySampleSummary[];
  passed: boolean;
  notes: string[];
}

interface LatencySampleSummary {
  turnKind: 'new' | 'resumed' | 'forked';
  n: number;
  minMs: number | null;
  medianMs: number | null;
  maxMs: number | null;
  allUnderBudget: boolean;
  failures: number;
}

interface ReleaseGate {
  id: string;
  title: string;
  status: GateStatus;
  evidence: string;
}

interface SpikeDocument {
  schemaVersion: 2;
  kind: 'grok-interrupt-resume-spike-round-2';
  cliVersion: string;
  currentStableCheck: string;
  binaryPathBasename: string;
  platform: string;
  arch: string;
  hostKind: 'native' | 'container';
  bunVersion: string;
  commandShape: string[];
  deliberateDifferences: string[];
  chosenBoundaryM: string | null;
  resumedTurnPolicy: string;
  treePrimitives: { posix: string; windows: string };
  scenarios: ScenarioResult[];
  releaseGates: ReleaseGate[];
  timingSummary: LatencySampleSummary[];
  validatedBuildNote: string;
  proposedGraceMs: { interrupt: number; cancel: number };
  cleanup: {
    sessionsDeleted: number;
    sessionsDeleteFailed: string[];
    tempDirRemoved: boolean;
  };
  overall: 'PASS' | 'BLOCKED';
  verdictNotes: string[];
}

interface RunOutcome extends TimingFields {
  exitCode: number | null;
  eventTypes: string[];
  endStopReason: string | null;
  reportedSessionId: string | null;
  standaloneUsageSeen: boolean;
  finalUsageSeen: boolean;
  usedSigkill: boolean;
  escalation: 'none' | 'sigkill' | 'taskkill-tree';
  firstEventType: string | null;
  sawToolInProgress: boolean;
  /** In-memory marker hits — never logged. */
  textBlob: string;
  childFingerprints: string[];
  descendantsAliveAfterExit: boolean | null;
  /** A Stop arriving after a valid terminal end was deliberately ignored. */
  stopRequestedAfterNaturalEnd: boolean;
  errorMessage: string | null;
}

interface ExitObservation {
  code: number | null;
  signal: NodeJS.Signals | null;
}

interface OwnedProcess {
  stdout: ReadableStream<Uint8Array> | null;
  stderr: ReadableStream<Uint8Array> | null;
  pid: number;
  exited: Promise<ExitObservation>;
  currentExit: () => ExitObservation | null;
  killTree: (signal: NodeJS.Signals) => boolean;
}

interface CommandResult {
  success: boolean;
  stdout: string;
}

function runCommand(command: string[], cwd?: string): CommandResult {
  try {
    const result = Bun.spawnSync(command, {
      ...(cwd ? { cwd } : {}),
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'ignore',
      windowsHide: true,
    });
    return {
      success: result.success,
      stdout: new TextDecoder().decode(result.stdout ?? new Uint8Array()),
    };
  } catch {
    return { success: false, stdout: '' };
  }
}

function runCommandOrThrow(command: string[], cwd?: string): string {
  const result = runCommand(command, cwd);
  if (!result.success) throw new Error(`command failed: ${command[0] ?? 'unknown'}`);
  return result.stdout;
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
  const data = event.data;
  const textData =
    type === 'text' && typeof data === 'string'
      ? data
      : type === 'text' && data !== null && typeof data === 'object' && !Array.isArray(data)
        ? fieldString(data as Record<string, unknown>, 'text')
        : undefined;
  return {
    type,
    stopReason: fieldString(event, 'stopReason'),
    sessionId: fieldString(event, 'sessionId'),
    hasUsage: type === 'usage' ? true : usageObj !== null,
    hasEndUsage: type === 'end' && (usageObj !== null || modelUsageObj !== null),
    toolStatus: fieldString(event, 'status'),
    textData,
  };
}

function emptyMarkerRetention(): MarkerRetention {
  return {
    current: null,
    inherited: null,
    fork: null,
    sourceWithoutFork: null,
  };
}

function emptyTimings(): TimingFields {
  return {
    spawnToRequestMs: null,
    requestToBoundaryMs: null,
    requestToSignalMs: null,
    signalToExitMs: null,
    requestToSettlementMs: null,
  };
}

function emptyScenario(
  id: ScenarioId,
  platform: string,
  spawnMode: SpawnMode = 'legacy'
): ScenarioResult {
  return {
    id,
    platform,
    spawnMode,
    eventTypes: [],
    endStopReason: null,
    assignedSessionId: null,
    expectedSessionId: null,
    reportedSessionId: null,
    sessionIdEqual: null,
    standaloneUsageSeen: false,
    finalUsageSeen: false,
    exitCode: null,
    usedSigkill: false,
    escalation: null,
    childFingerprints: [],
    descendantsAliveAfterExit: null,
    markerRetention: emptyMarkerRetention(),
    resumeExitCode: null,
    resumeSameSession: null,
    timings: emptyTimings(),
    passed: false,
    notes: [],
  };
}

function triggerLabel(trigger: TriggerKind): string {
  if (trigger.kind === 'first-event') return `first-event:${trigger.eventType}`;
  return trigger.kind;
}

function markerToken(kind: string): string {
  return `MK_${kind}_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
}

function promptForShape(shape: PromptShape, marker: string, cwdHasSlowScript: boolean): string {
  switch (shape) {
    case 'text-only':
      return `Reply with exactly ${marker} and nothing else. Do not use tools.`;
    case 'reasoning-first':
      return `Think carefully step by step about why 2+2 equals 4, then reply with exactly ${marker} and nothing else. Do not use tools.`;
    case 'tool-first':
      if (!cwdHasSlowScript) {
        return `List the current directory with a shell tool once, then reply with exactly ${marker}.`;
      }
      return `Using the shell tool, execute the local script ./${SLOW_SCRIPT} in the foreground. Do not background it. After it finishes, reply with exactly ${marker}.`;
  }
}

function continuationPrompt(markers: string[]): string {
  const joined = markers.join(' ');
  return `Reply with exactly these tokens in order, separated by single spaces, and nothing else: ${joined}`;
}

function buildDiagnosticArgs(input: {
  prompt: string;
  cwd: string;
  sessionId?: string;
  resumeSessionId?: string;
  forkSession?: boolean;
  allowedTools?: readonly string[];
  deniedTools?: readonly string[];
}): string[] {
  const { args } = buildGrokArgs({
    prompt: input.prompt,
    cwd: input.cwd,
    config: { permissionMode: 'bypassPermissions' },
    requestOptions: {
      forkSession: input.forkSession === true ? true : undefined,
      nodeConfig: {
        ...(input.allowedTools ? { allowed_tools: [...input.allowedTools] } : {}),
        ...(input.deniedTools ? { denied_tools: [...input.deniedTools] } : {}),
      },
    },
    resumeSessionId: input.resumeSessionId,
  });
  // Deliberate diagnostic-only reproducibility flag (recorded in report).
  args.push('--no-auto-update');
  // Identity assignment for interrupt-capable turns (Phase-2 seam; diagnostic only here).
  if (input.sessionId) {
    args.push('--session-id', input.sessionId);
  }
  return args;
}

function fingerprint(pid: number, startTime: string | null): string {
  return startTime ? `pid=${String(pid)};start=${startTime}` : `pid=${String(pid)}`;
}

function readStartTime(pid: number): string | null {
  try {
    if (process.platform === 'linux') {
      const stat = readFileSync(`/proc/${String(pid)}/stat`, 'utf8');
      const closeParen = stat.lastIndexOf(')');
      const fields = stat.slice(closeParen + 2).split(' ');
      // field 20 (0-based from after comm) is starttime — index 19 in remainder
      return fields[19] ?? null;
    }
    if (process.platform === 'darwin') {
      const out = runCommand(['ps', '-o', 'lstart=', '-p', String(pid)]).stdout.trim();
      return out.length > 0 ? out : null;
    }
  } catch {
    return null;
  }
  return null;
}

function readProcessState(pid: number): string | null {
  try {
    if (process.platform === 'linux') {
      const stat = readFileSync(`/proc/${String(pid)}/stat`, 'utf8');
      const closeParen = stat.lastIndexOf(')');
      return stat.slice(closeParen + 2, closeParen + 3) || null;
    }
    if (process.platform === 'darwin') {
      const out = runCommand(['ps', '-o', 'stat=', '-p', String(pid)]).stdout.trim();
      return out.length > 0 ? (out[0] ?? null) : null;
    }
  } catch {
    return null;
  }
  return null;
}

function isFingerprintAlive(fp: string): boolean {
  const match = /^pid=(\d+)/.exec(fp);
  if (!match) return false;
  const pid = Number(match[1]);
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  // A zombie has exited. `kill(pid, 0)` still succeeds until its parent reaps
  // it, so treating that as a surviving descendant would be a false tree-leak.
  const state = readProcessState(pid);
  if (state === 'Z' || state === 'X') return false;
  const expectedStart = /;start=(.+)$/.exec(fp)?.[1] ?? null;
  if (!expectedStart) return true;
  const liveStart = readStartTime(pid);
  if (liveStart === null) return true;
  return liveStart === expectedStart;
}

function listChildPids(parentPid: number): number[] {
  try {
    if (process.platform === 'darwin' || process.platform === 'linux') {
      const out = runCommand(['ps', '-axo', 'pid=,ppid=']).stdout;
      const children: number[] = [];
      for (const line of out.split('\n')) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 2) continue;
        const pid = Number(parts[0]);
        const ppid = Number(parts[1]);
        if (ppid === parentPid && Number.isFinite(pid)) children.push(pid);
      }
      return children;
    }
  } catch {
    return [];
  }
  return [];
}

function collectDescendantFingerprints(rootPid: number | undefined): string[] {
  if (rootPid === undefined || rootPid <= 0) return [];
  const found: string[] = [];
  const queue = [rootPid];
  const seen = new Set<number>();
  while (queue.length > 0) {
    const pid = queue.shift();
    if (pid === undefined || seen.has(pid)) continue;
    seen.add(pid);
    if (pid !== rootPid) {
      found.push(fingerprint(pid, readStartTime(pid)));
    }
    for (const child of listChildPids(pid)) queue.push(child);
  }
  return found;
}

function windowsTreeKill(pid: number): boolean {
  return runCommand(['taskkill', '/PID', String(pid), '/T', '/F']).success;
}

function spawnGrok(binaryPath: string, args: string[], cwd: string, mode: SpawnMode): OwnedProcess {
  const command = buildSpawnCommand(binaryPath, args);
  const detached = mode === 'owned-tree' && process.platform !== 'win32';
  const child = Bun.spawn(command, {
    cwd,
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => entry[1] !== undefined
        )
      ),
      GROK_DISABLE_AUTOUPDATER: '1',
    },
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    windowsHide: true,
    detached,
  });
  const currentExit = (): ExitObservation | null => {
    if (child.exitCode === null && child.signalCode === null) return null;
    return { code: child.exitCode, signal: child.signalCode };
  };
  return {
    pid: child.pid,
    stdout: child.stdout instanceof ReadableStream ? child.stdout : null,
    stderr: child.stderr instanceof ReadableStream ? child.stderr : null,
    exited: child.exited.then(() => currentExit() ?? { code: null, signal: null }),
    currentExit,
    killTree: (signal: NodeJS.Signals): boolean => {
      try {
        if (process.platform === 'win32') {
          return windowsTreeKill(child.pid);
        }
        if (mode === 'owned-tree' && detached) {
          try {
            process.kill(-child.pid, signal);
            return true;
          } catch {
            try {
              child.kill(signal);
              return true;
            } catch {
              return false;
            }
          }
        }
        child.kill(signal);
        return true;
      } catch {
        return false;
      }
    },
  };
}

async function waitForExit(
  process: OwnedProcess,
  timeoutMs: number
): Promise<ExitObservation | null> {
  const already = process.currentExit();
  if (already) return already;
  const { promise, resolve } = Promise.withResolvers<ExitObservation | null>();
  const timer = setTimeout(() => {
    resolve(null);
  }, timeoutMs);
  void process.exited.then(observation => {
    clearTimeout(timer);
    resolve(observation);
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

function boundaryReached(
  trigger: TriggerKind,
  eventType: string | null,
  firstStdout: boolean,
  pidFileReady: boolean
): boolean {
  switch (trigger.kind) {
    case 'spawn':
      return true;
    case 'first-stdout-event':
      return firstStdout;
    case 'first-event':
      return eventType === trigger.eventType;
    case 'pid-file':
      return pidFileReady;
  }
}

async function runGrokTurn(input: {
  binaryPath: string;
  cwd: string;
  prompt: string;
  sessionId?: string;
  resumeSessionId?: string;
  forkSession?: boolean;
  allowedTools?: readonly string[];
  deniedTools?: readonly string[];
  spawnMode?: SpawnMode;
  /** Operator Stop is requested immediately after listener registration. */
  requestStopImmediately?: boolean;
  /** Operator Stop is requested when the trigger is reached (mid-tool cases). */
  requestStopAtBoundary?: boolean;
  /** Simulate a Stop received only after the terminal end has been accepted. */
  requestStopAfterNaturalEnd?: boolean;
  /** Actual tree signal waits for this trigger. Omit for natural completion. */
  terminateOn?: TriggerKind;
  /** When set, terminate uses Cancel grace instead of interrupt grace. */
  cancelMode?: boolean;
  pidFilePath?: string;
  timeoutMs?: number;
}): Promise<RunOutcome> {
  const spawnMode = input.spawnMode ?? 'legacy';
  const args = buildDiagnosticArgs({
    prompt: input.prompt,
    cwd: input.cwd,
    sessionId: input.sessionId,
    resumeSessionId: input.resumeSessionId,
    forkSession: input.forkSession,
    allowedTools: input.allowedTools,
    deniedTools: input.deniedTools ?? DENIED_TOOLS_NO_SHELL,
  });
  const spawnedAt = Date.now();
  const owned = spawnGrok(input.binaryPath, args, input.cwd, spawnMode);

  let usedSigkill = false;
  let escalation: 'none' | 'sigkill' | 'taskkill-tree' = 'none';
  let processExited = false;
  let stopRequestedAt: number | null = null;
  let boundaryAt: number | null = null;
  let signalSentAt: number | null = null;
  let exitedAt: number | null = null;
  let lastExit: ExitObservation | null = null;
  let errorMessage: string | null = null;
  let stderrTail = '';
  let firstStdout = false;
  let firstEventType: string | null = null;
  let pidFileReady = false;
  let signalled = false;
  let childFingerprints: string[] = [];
  let descendantsAliveAfterExit: boolean | null = null;
  let stopRequestedAfterNaturalEnd = false;
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  const graceMs = input.cancelMode === true ? CANCEL_GRACE_MS : INTERRUPT_GRACE_MS;
  // No default kill — natural turns omit terminateOn entirely.
  const terminateOn = input.terminateOn;

  void owned.exited.then(observation => {
    processExited = true;
    exitedAt = Date.now();
    lastExit = observation;
    if (graceTimer) clearTimeout(graceTimer);
    graceTimer = undefined;
  });

  const requestStop = (): void => {
    if (stopRequestedAt !== null) return;
    stopRequestedAt = Date.now();
  };

  const sendSignal = (): void => {
    if (signalled || processExited) return;
    signalled = true;
    if (boundaryAt === null) boundaryAt = Date.now();
    signalSentAt = Date.now();
    childFingerprints = collectDescendantFingerprints(owned.pid);
    if (input.pidFilePath) {
      const toolPid = readPidFile(input.pidFilePath);
      if (toolPid !== null) {
        const fp = fingerprint(toolPid, readStartTime(toolPid));
        if (!childFingerprints.includes(fp)) childFingerprints.push(fp);
      }
    }
    const ok = owned.killTree('SIGTERM');
    if (!ok && process.platform === 'win32') {
      windowsTreeKill(owned.pid);
      escalation = 'taskkill-tree';
    }
    graceTimer = setTimeout(() => {
      if (!processExited) {
        usedSigkill = true;
        if (process.platform === 'win32') {
          windowsTreeKill(owned.pid);
          escalation = 'taskkill-tree';
        } else {
          owned.killTree('SIGKILL');
          escalation = 'sigkill';
        }
      }
    }, graceMs);
  };

  let lastSeenEventType: string | null = null;

  const maybeSignalFromBoundary = (): void => {
    if (!terminateOn || signalled || processExited) return;
    if (
      boundaryReached(terminateOn, lastSeenEventType, firstStdout, pidFileReady) ||
      terminateOn.kind === 'spawn'
    ) {
      if (boundaryAt === null) boundaryAt = Date.now();
      if (input.requestStopAtBoundary === true && stopRequestedAt === null) requestStop();
      if (stopRequestedAt !== null || terminateOn.kind === 'spawn') {
        if (stopRequestedAt === null) requestStop();
        sendSignal();
      }
    }
  };

  const stderrPromise = (async (): Promise<void> => {
    const stderr = owned.stderr;
    if (!stderr) return;
    const reader = stderr.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) return;
        if (stderrTail.length < 4_000) {
          stderrTail += decoder
            .decode(next.value, { stream: true })
            .slice(0, 4_000 - stderrTail.length);
        }
      }
    } finally {
      reader.releaseLock();
    }
  })();

  const pidWatcher =
    terminateOn?.kind === 'pid-file' || input.pidFilePath !== undefined
      ? (async (): Promise<void> => {
          const deadline = Date.now() + PID_WAIT_MS;
          const pidPath = input.pidFilePath;
          if (!pidPath) return;
          while (Date.now() < deadline) {
            if (existsSync(pidPath)) {
              const toolPid = readPidFile(pidPath);
              if (toolPid !== null && isFingerprintAlive(fingerprint(toolPid, null))) {
                pidFileReady = true;
                // The PID file is the mid-tool boundary. Record the operator
                // Stop before the brief fingerprint-collection wait so the
                // reported request-to-settlement interval includes that work.
                if (input.requestStopAtBoundary === true) requestStop();
                await delay(50);
                maybeSignalFromBoundary();
                return;
              }
            }
            if (processExited) return;
            await delay(50);
          }
          errorMessage ??= 'pid-file-timeout';
          if (stopRequestedAt !== null) sendSignal();
        })()
      : Promise.resolve();

  const eventTypes: string[] = [];
  let endStopReason: string | null = null;
  let reportedSessionId: string | null = null;
  let standaloneUsageSeen = false;
  let finalUsageSeen = false;
  let sawToolInProgress = false;
  let textBlob = '';
  let buffer = '';

  const stdoutPromise = (async (): Promise<void> => {
    const stdout = owned.stdout;
    if (!stdout) return;
    const reader = stdout.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        if (!firstStdout) {
          firstStdout = true;
          maybeSignalFromBoundary();
        }
        const piece = decoder.decode(next.value, { stream: true });
        buffer += piece;
        let nl = buffer.indexOf('\n');
        while (nl >= 0) {
          const parsed = parseLine(buffer.slice(0, nl));
          buffer = buffer.slice(nl + 1);
          if (parsed) {
            eventTypes.push(parsed.type);
            if (parsed.type !== 'non_json' && parsed.type !== 'non_object') {
              lastSeenEventType = parsed.type;
              if (firstEventType === null) firstEventType = parsed.type;
            }
            if (parsed.textData) textBlob += parsed.textData;
            if (parsed.type === 'usage') standaloneUsageSeen = true;
            if (parsed.type === 'end') {
              endStopReason = parsed.stopReason ?? null;
              reportedSessionId = parsed.sessionId ?? null;
              finalUsageSeen = Boolean(parsed.hasEndUsage) || finalUsageSeen;
              if (input.requestStopAfterNaturalEnd === true) {
                requestStop();
                stopRequestedAfterNaturalEnd = true;
              }
            }
            if (
              parsed.type === 'tool_call' ||
              (parsed.type === 'tool_call_update' && parsed.toolStatus === 'in_progress')
            ) {
              sawToolInProgress = true;
            }
            maybeSignalFromBoundary();
          }
          nl = buffer.indexOf('\n');
        }
      }
      buffer += decoder.decode();
      if (buffer.trim().length > 0) {
        const parsed = parseLine(buffer);
        if (parsed) {
          eventTypes.push(parsed.type);
          if (parsed.textData) textBlob += parsed.textData;
        }
      }
    } catch {
      // stdout may close under signal
    } finally {
      reader.releaseLock();
    }
  })();

  // The immediate-Stop measurement starts only after both stream listeners are live.
  if (terminateOn && (input.requestStopImmediately === true || terminateOn.kind === 'spawn')) {
    requestStop();
    if (terminateOn.kind === 'spawn') sendSignal();
    else maybeSignalFromBoundary();
  }

  const timeoutMs = input.timeoutMs ?? EXPERIMENT_TIMEOUT_MS;
  const initialExit = await waitForExit(owned, timeoutMs);
  if (!initialExit && !processExited) {
    usedSigkill = true;
    escalation = process.platform === 'win32' ? 'taskkill-tree' : 'sigkill';
    owned.killTree('SIGKILL');
  }

  await Promise.race([stdoutPromise, delay(2_000)]);
  await Promise.race([stderrPromise, delay(2_000)]);
  await pidWatcher.catch(() => undefined);

  if (!processExited) {
    const late = await waitForExit(owned, EXIT_WAIT_MS);
    if (late) lastExit = late;
  }
  if (!processExited) {
    usedSigkill = true;
    escalation = process.platform === 'win32' ? 'taskkill-tree' : 'sigkill';
    owned.killTree('SIGKILL');
    const forced = await waitForExit(owned, EXIT_WAIT_MS);
    if (forced) lastExit = forced;
  }
  if (graceTimer) clearTimeout(graceTimer);
  graceTimer = undefined;

  if (childFingerprints.length > 0) {
    // Brief settle so graceful group members can exit before the liveness sample.
    await delay(150);
    descendantsAliveAfterExit = childFingerprints.some(fp => isFingerprintAlive(fp));
    if (descendantsAliveAfterExit) {
      // One more grace poll before declaring survival.
      await delay(350);
      descendantsAliveAfterExit = childFingerprints.some(fp => isFingerprintAlive(fp));
    }
    if (descendantsAliveAfterExit) {
      for (const fp of childFingerprints) {
        if (!isFingerprintAlive(fp)) continue;
        const pid = Number(/^pid=(\d+)/.exec(fp)?.[1] ?? 0);
        if (pid > 0) {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            // ignore
          }
        }
      }
    }
  } else if (signalled) {
    descendantsAliveAfterExit = false;
  }

  if (errorMessage === null && /auth|credential|sign.?in|login|unauthorized/i.test(stderrTail)) {
    errorMessage = 'authentication';
  }

  const settledAt = exitedAt ?? Date.now();
  return {
    exitCode: normalizeExitCode(lastExit ?? owned.currentExit()),
    eventTypes,
    endStopReason,
    reportedSessionId,
    standaloneUsageSeen,
    finalUsageSeen,
    usedSigkill,
    escalation,
    firstEventType,
    sawToolInProgress,
    textBlob,
    childFingerprints,
    descendantsAliveAfterExit,
    stopRequestedAfterNaturalEnd,
    errorMessage,
    spawnToRequestMs: stopRequestedAt !== null ? Math.max(0, stopRequestedAt - spawnedAt) : null,
    requestToBoundaryMs:
      stopRequestedAt !== null && boundaryAt !== null
        ? Math.max(0, boundaryAt - stopRequestedAt)
        : null,
    requestToSignalMs:
      stopRequestedAt !== null && signalSentAt !== null
        ? Math.max(0, signalSentAt - stopRequestedAt)
        : null,
    signalToExitMs:
      signalSentAt !== null && exitedAt !== null ? Math.max(0, exitedAt - signalSentAt) : null,
    requestToSettlementMs:
      stopRequestedAt !== null ? Math.max(0, settledAt - stopRequestedAt) : null,
  };
}

function writeSlowToolScript(cwd: string): { pidPath: string } {
  const scriptPath = join(cwd, SLOW_SCRIPT);
  const pidPath = join(cwd, SLOW_PID_FILE);
  writeFileSync(
    scriptPath,
    `#!/usr/bin/env sh
set -eu
echo $$ > "${SLOW_PID_FILE}"
sleep 120
`,
    { encoding: 'utf8' }
  );
  chmodSync(scriptPath, 0o755);
  try {
    rmSync(pidPath, { force: true });
  } catch {
    // ignore
  }
  return { pidPath };
}

function readPidFile(pidPath: string): number | null {
  try {
    const raw = readFileSync(pidPath, 'utf8').trim();
    const pid = Number(raw);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function ensureTempGitRepo(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'archon-grok-spike-'));
  runCommandOrThrow(['git', 'init'], cwd);
  writeFileSync(join(cwd, 'README.md'), 'spike\n', 'utf8');
  runCommandOrThrow(['git', 'add', 'README.md'], cwd);
  runCommandOrThrow(
    ['git', '-c', 'user.email=spike@example.com', '-c', 'user.name=spike', 'commit', '-m', 'init'],
    cwd
  );
  return cwd;
}

function deleteSession(binaryPath: string, cwd: string, sessionId: string): boolean {
  return runCommand([binaryPath, 'sessions', 'delete', sessionId], cwd).success;
}

function readCliVersion(binaryPath: string): string {
  const result = runCommand([binaryPath, '--version']);
  return result.success ? result.stdout.trim() : 'unknown';
}

function containsMarker(text: string, marker: string): boolean {
  return text.includes(marker);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const even = sorted.length % 2 === 0;
  if (even) {
    const left = sorted[mid - 1];
    const right = sorted[mid];
    if (left === undefined || right === undefined) return null;
    return Math.round((left + right) / 2);
  }
  return sorted[mid] ?? null;
}

function summarizeSamples(
  turnKind: 'new' | 'resumed' | 'forked',
  settlements: (number | null)[],
  failures: number
): LatencySampleSummary {
  const nums = settlements.filter((v): v is number => v !== null);
  return {
    turnKind,
    n: settlements.length,
    minMs: nums.length > 0 ? Math.min(...nums) : null,
    medianMs: median(nums),
    maxMs: nums.length > 0 ? Math.max(...nums) : null,
    allUnderBudget:
      failures === 0 &&
      nums.length === settlements.length &&
      nums.every(v => v < REQUEST_TO_SETTLEMENT_BUDGET_MS),
    failures,
  };
}

async function runContinuation(input: {
  binaryPath: string;
  cwd: string;
  sessionId: string;
  expectedMarkers: string[];
  trackSession: (id: string) => void;
}): Promise<{
  exitCode: number | null;
  sameSession: boolean;
  markersPresent: boolean;
  reportedSessionId: string | null;
  eventTypes: string[];
}> {
  const turn = await runGrokTurn({
    binaryPath: input.binaryPath,
    cwd: input.cwd,
    resumeSessionId: input.sessionId,
    prompt: continuationPrompt(input.expectedMarkers),
    deniedTools: DENIED_TOOLS_NO_SHELL,
    timeoutMs: 90_000,
  });
  if (turn.reportedSessionId) input.trackSession(turn.reportedSessionId);
  const markersPresent = input.expectedMarkers.every(m => containsMarker(turn.textBlob, m));
  return {
    exitCode: turn.exitCode,
    sameSession: turn.reportedSessionId === input.sessionId,
    markersPresent:
      turn.exitCode === 0 && turn.reportedSessionId === input.sessionId && markersPresent,
    reportedSessionId: turn.reportedSessionId,
    eventTypes: turn.eventTypes,
  };
}

function applyTurnMeta(result: ScenarioResult, turn: RunOutcome, expectedId: string | null): void {
  result.eventTypes = turn.eventTypes;
  result.endStopReason = turn.endStopReason;
  result.reportedSessionId = turn.reportedSessionId;
  result.expectedSessionId = expectedId;
  result.sessionIdEqual =
    expectedId === null || turn.reportedSessionId === null
      ? turn.reportedSessionId === null && expectedId === null
        ? null
        : turn.reportedSessionId === expectedId
      : turn.reportedSessionId === expectedId;
  result.standaloneUsageSeen = turn.standaloneUsageSeen;
  result.finalUsageSeen = turn.finalUsageSeen;
  result.exitCode = turn.exitCode;
  result.usedSigkill = turn.usedSigkill;
  result.escalation = turn.escalation;
  result.childFingerprints = turn.childFingerprints;
  result.descendantsAliveAfterExit = turn.descendantsAliveAfterExit;
  result.timings = {
    spawnToRequestMs: turn.spawnToRequestMs,
    requestToBoundaryMs: turn.requestToBoundaryMs,
    requestToSignalMs: turn.requestToSignalMs,
    signalToExitMs: turn.signalToExitMs,
    requestToSettlementMs: turn.requestToSettlementMs,
  };
  if (turn.errorMessage) result.notes.push(turn.errorMessage);
  if (turn.firstEventType) result.notes.push(`firstEventType=${turn.firstEventType}`);
}

async function runB0(
  binaryPath: string,
  cwd: string,
  platform: string,
  trackSession: (id: string) => void
): Promise<ScenarioResult> {
  const result = emptyScenario('B0', platform, 'legacy');
  const sessionId = randomUUID();
  const marker = markerToken('B0');
  result.assignedSessionId = sessionId;
  trackSession(sessionId);
  const turn = await runGrokTurn({
    binaryPath,
    cwd,
    sessionId,
    prompt: promptForShape('text-only', marker, false),
    deniedTools: DENIED_TOOLS_NO_SHELL,
    timeoutMs: 90_000,
  });
  applyTurnMeta(result, turn, sessionId);
  const cont = await runContinuation({
    binaryPath,
    cwd,
    sessionId,
    expectedMarkers: [marker],
    trackSession,
  });
  result.resumeExitCode = cont.exitCode;
  result.resumeSameSession = cont.sameSession;
  result.markerRetention.current = cont.markersPresent;
  result.passed =
    turn.exitCode === 0 &&
    result.sessionIdEqual === true &&
    turn.endStopReason !== null &&
    cont.markersPresent;
  if (!result.passed) {
    result.notes.push(
      `B0 exit=${String(turn.exitCode)} sessionEqual=${String(result.sessionIdEqual)} marker=${String(cont.markersPresent)}`
    );
  }
  return result;
}

async function runB1(
  binaryPath: string,
  cwd: string,
  platform: string,
  trackSession: (id: string) => void
): Promise<ScenarioResult> {
  const result = emptyScenario('B1', platform, 'legacy');
  const sessionId = randomUUID();
  const marker = markerToken('B1');
  result.assignedSessionId = sessionId;
  result.trigger = 'spawn';
  trackSession(sessionId);
  const turn = await runGrokTurn({
    binaryPath,
    cwd,
    sessionId,
    prompt: promptForShape('text-only', marker, false),
    deniedTools: DENIED_TOOLS_NO_SHELL,
    requestStopImmediately: true,
    terminateOn: { kind: 'spawn' },
    timeoutMs: 60_000,
  });
  applyTurnMeta(result, turn, sessionId);
  const cont = await runContinuation({
    binaryPath,
    cwd,
    sessionId,
    expectedMarkers: [marker],
    trackSession,
  });
  result.resumeExitCode = cont.exitCode;
  result.resumeSameSession = cont.sameSession;
  result.markerRetention.current = cont.markersPresent;
  // Negative control: never counts as M unless current marker + latency both pass.
  const settlementOk =
    turn.requestToSettlementMs !== null &&
    turn.requestToSettlementMs < REQUEST_TO_SETTLEMENT_BUDGET_MS;
  result.passed = cont.markersPresent && settlementOk && !turn.usedSigkill;
  result.notes.push(
    `negative-control resumeMarker=${String(cont.markersPresent)} settlementMs=${String(turn.requestToSettlementMs)}`
  );
  return result;
}

async function probeBoundaryCandidate(input: {
  binaryPath: string;
  cwd: string;
  platform: string;
  shape: PromptShape;
  trigger: TriggerKind;
  trackSession: (id: string) => void;
}): Promise<ScenarioResult> {
  const result = emptyScenario('B2', input.platform, 'owned-tree');
  result.promptShape = input.shape;
  result.trigger = triggerLabel(input.trigger);
  const sessionId = randomUUID();
  const marker = markerToken('B2');
  result.assignedSessionId = sessionId;
  input.trackSession(sessionId);

  let pidPath: string | undefined;
  let allowedTools: readonly string[] | undefined;
  let deniedTools: readonly string[] = DENIED_TOOLS_NO_SHELL;
  if (input.shape === 'tool-first' || input.trigger.kind === 'pid-file') {
    pidPath = writeSlowToolScript(input.cwd).pidPath;
    allowedTools = ALLOWED_SHELL_TOOLS;
    deniedTools = DENIED_TOOLS_NO_SHELL.filter(t => !ALLOWED_SHELL_TOOLS.includes(t as never));
  }

  const turn = await runGrokTurn({
    binaryPath: input.binaryPath,
    cwd: input.cwd,
    sessionId,
    prompt: promptForShape(input.shape, marker, pidPath !== undefined),
    allowedTools,
    deniedTools,
    spawnMode: 'owned-tree',
    requestStopImmediately: true,
    terminateOn: input.trigger,
    pidFilePath: pidPath,
    timeoutMs: 120_000,
  });
  applyTurnMeta(result, turn, sessionId);

  // Natural end before boundary is not a failure for M discovery — record it.
  if (turn.endStopReason !== null && !turn.usedSigkill && turn.escalation === 'none') {
    result.notes.push('natural-end-before-or-without-kill');
  }

  const cont = await runContinuation({
    binaryPath: input.binaryPath,
    cwd: input.cwd,
    sessionId,
    expectedMarkers: [marker],
    trackSession: input.trackSession,
  });
  result.resumeExitCode = cont.exitCode;
  result.resumeSameSession = cont.sameSession;
  result.markerRetention.current = cont.markersPresent;
  const settlementOk =
    turn.requestToSettlementMs !== null &&
    turn.requestToSettlementMs < REQUEST_TO_SETTLEMENT_BUDGET_MS;
  result.passed =
    cont.markersPresent &&
    cont.sameSession &&
    !turn.usedSigkill &&
    settlementOk &&
    (turn.descendantsAliveAfterExit === false || turn.descendantsAliveAfterExit === null);
  if (!result.passed) {
    result.notes.push(
      `boundaryFail marker=${String(cont.markersPresent)} sameSession=${String(cont.sameSession)} resumeExit=${String(cont.exitCode)} settlement=${String(turn.requestToSettlementMs)} sigkill=${String(turn.usedSigkill)} descendantsAlive=${String(turn.descendantsAliveAfterExit)} sessionEqual=${String(result.sessionIdEqual)} exit=${String(turn.exitCode)}`
    );
  }
  return result;
}

async function discoverM(input: {
  binaryPath: string;
  cwd: string;
  platform: string;
  trackSession: (id: string) => void;
  b1: ScenarioResult;
}): Promise<{ m: TriggerKind | null; probes: ScenarioResult[]; chosenLabel: string | null }> {
  const candidates: TriggerKind[] = [
    { kind: 'first-stdout-event' },
    { kind: 'first-event', eventType: 'available_commands' },
    { kind: 'first-event', eventType: 'thought' },
    { kind: 'first-event', eventType: 'text' },
    { kind: 'first-event', eventType: 'tool_call' },
  ];
  // Spawn is negative control — only if B1 somehow passed both marker+latency.
  if (input.b1.passed) candidates.unshift({ kind: 'spawn' });

  const shapes: PromptShape[] = ['text-only', 'reasoning-first', 'tool-first'];
  const probes: ScenarioResult[] = [];

  for (const trigger of candidates) {
    const shapeResults: ScenarioResult[] = [];
    let allPass = true;
    for (const shape of shapes) {
      // tool_call trigger only applies to tool-first; skip mismatch.
      if (
        trigger.kind === 'first-event' &&
        trigger.eventType === 'tool_call' &&
        shape !== 'tool-first'
      ) {
        continue;
      }
      if (
        trigger.kind === 'first-event' &&
        trigger.eventType === 'text' &&
        shape === 'tool-first'
      ) {
        // tool-first may emit tool_call before text; still try.
      }
      const probe = await probeBoundaryCandidate({
        binaryPath: input.binaryPath,
        cwd: input.cwd,
        platform: input.platform,
        shape,
        trigger,
        trackSession: input.trackSession,
      });
      probes.push(probe);
      shapeResults.push(probe);
      if (!probe.passed) allPass = false;
    }
    // A content-dependent event that some shapes omit is invalid alone.
    // Require every exercised shape for this trigger to pass.
    if (allPass && shapeResults.length > 0) {
      return { m: trigger, probes, chosenLabel: triggerLabel(trigger) };
    }
  }

  // Also try pid-file for tool-first only as supplemental (not universal M alone).
  const pidProbe = await probeBoundaryCandidate({
    binaryPath: input.binaryPath,
    cwd: input.cwd,
    platform: input.platform,
    shape: 'tool-first',
    trigger: { kind: 'pid-file' },
    trackSession: input.trackSession,
  });
  probes.push(pidProbe);

  return { m: null, probes, chosenLabel: null };
}

async function runB3(
  binaryPath: string,
  cwd: string,
  platform: string,
  m: TriggerKind,
  trackSession: (id: string) => void
): Promise<ScenarioResult> {
  const result = emptyScenario('B3', platform, 'owned-tree');
  result.trigger = triggerLabel(m);
  const sessionId = randomUUID();
  const inherited = markerToken('B3i');
  const current = markerToken('B3c');
  result.assignedSessionId = sessionId;
  trackSession(sessionId);

  // Seed session.
  const seed = await runGrokTurn({
    binaryPath,
    cwd,
    sessionId,
    prompt: promptForShape('text-only', inherited, false),
    deniedTools: DENIED_TOOLS_NO_SHELL,
    timeoutMs: 90_000,
  });
  if (seed.exitCode !== 0) {
    result.notes.push('seed-failed');
    applyTurnMeta(result, seed, sessionId);
    return result;
  }

  // Resumed turn: Stop before M (request immediate, signal at M).
  const deferred = await runGrokTurn({
    binaryPath,
    cwd,
    resumeSessionId: sessionId,
    prompt: promptForShape('text-only', current, false),
    deniedTools: DENIED_TOOLS_NO_SHELL,
    spawnMode: 'owned-tree',
    requestStopImmediately: true,
    terminateOn: m,
    timeoutMs: 120_000,
  });
  applyTurnMeta(result, deferred, sessionId);

  const cont = await runContinuation({
    binaryPath,
    cwd,
    sessionId,
    expectedMarkers: [inherited, current],
    trackSession,
  });
  result.resumeExitCode = cont.exitCode;
  result.resumeSameSession = cont.sameSession;
  result.markerRetention.inherited = cont.markersPresent;
  result.markerRetention.current = cont.markersPresent;

  // Immediate-signal comparison at/after M (second sample).
  const current2 = markerToken('B3c2');
  const immediate = await runGrokTurn({
    binaryPath,
    cwd,
    resumeSessionId: sessionId,
    prompt: promptForShape('text-only', current2, false),
    deniedTools: DENIED_TOOLS_NO_SHELL,
    spawnMode: 'owned-tree',
    requestStopImmediately: true,
    terminateOn: m,
    timeoutMs: 120_000,
  });
  // If we can request stop and signal only once boundary hits, "immediate at M"
  // is the same as deferred-to-M when request is early. Record settlement comparison.
  result.notes.push(
    `deferredSettlementMs=${String(deferred.requestToSettlementMs)} immediateAtMSettlementMs=${String(immediate.requestToSettlementMs)}`
  );

  const settlementOk =
    deferred.requestToSettlementMs !== null &&
    deferred.requestToSettlementMs < REQUEST_TO_SETTLEMENT_BUDGET_MS;
  result.passed = cont.markersPresent && cont.sameSession && !deferred.usedSigkill && settlementOk;
  if (!result.passed) {
    result.notes.push(
      `B3 marker=${String(cont.markersPresent)} settlement=${String(deferred.requestToSettlementMs)}`
    );
  }
  // Policy: resumed turns must also wait for M (same as new) when deferred path is the one that works.
  return result;
}

async function runB4(
  binaryPath: string,
  cwd: string,
  platform: string,
  m: TriggerKind,
  trackSession: (id: string) => void
): Promise<ScenarioResult> {
  const result = emptyScenario('B4', platform, 'owned-tree');
  result.trigger = triggerLabel(m);
  const sourceId = randomUUID();
  const forkId = randomUUID();
  const sourceMarker = markerToken('B4s');
  const forkMarker = markerToken('B4f');
  result.assignedSessionId = forkId;
  trackSession(sourceId);
  trackSession(forkId);

  const seed = await runGrokTurn({
    binaryPath,
    cwd,
    sessionId: sourceId,
    prompt: promptForShape('text-only', sourceMarker, false),
    deniedTools: DENIED_TOOLS_NO_SHELL,
    timeoutMs: 90_000,
  });
  if (seed.exitCode !== 0) {
    result.notes.push('source-seed-failed');
    applyTurnMeta(result, seed, sourceId);
    return result;
  }

  const forked = await runGrokTurn({
    binaryPath,
    cwd,
    resumeSessionId: sourceId,
    forkSession: true,
    sessionId: forkId,
    prompt: promptForShape('text-only', forkMarker, false),
    deniedTools: DENIED_TOOLS_NO_SHELL,
    spawnMode: 'owned-tree',
    requestStopImmediately: true,
    terminateOn: m,
    timeoutMs: 120_000,
  });
  applyTurnMeta(result, forked, forkId);

  const forkCont = await runContinuation({
    binaryPath,
    cwd,
    sessionId: forkId,
    expectedMarkers: [sourceMarker, forkMarker],
    trackSession,
  });
  result.resumeExitCode = forkCont.exitCode;
  result.resumeSameSession = forkCont.sameSession;
  result.markerRetention.inherited = forkCont.markersPresent;
  result.markerRetention.fork = forkCont.markersPresent;
  result.markerRetention.current = forkCont.markersPresent;

  const sourceCont = await runContinuation({
    binaryPath,
    cwd,
    sessionId: sourceId,
    expectedMarkers: [sourceMarker],
    trackSession,
  });
  // Source must retain source marker; fork marker is not required on source session.
  result.markerRetention.sourceWithoutFork = sourceCont.markersPresent && sourceCont.sameSession;

  const settlementOk =
    forked.requestToSettlementMs !== null &&
    forked.requestToSettlementMs < REQUEST_TO_SETTLEMENT_BUDGET_MS;
  result.passed =
    forkCont.markersPresent &&
    forkCont.sameSession &&
    result.markerRetention.sourceWithoutFork &&
    !forked.usedSigkill &&
    settlementOk;
  if (!result.passed) {
    result.notes.push(
      `B4 forkMarker=${String(forkCont.markersPresent)} sourceOk=${String(result.markerRetention.sourceWithoutFork)} settlement=${String(forked.requestToSettlementMs)}`
    );
  }
  return result;
}

async function runB5(
  binaryPath: string,
  cwd: string,
  platform: string,
  m: TriggerKind,
  trackSession: (id: string) => void
): Promise<ScenarioResult> {
  const result = emptyScenario('B5', platform, 'owned-tree');
  result.trigger = triggerLabel(m);
  const sessionId = randomUUID();
  result.assignedSessionId = sessionId;
  trackSession(sessionId);
  const markers: string[] = [];

  for (let i = 0; i < 3; i++) {
    const marker = markerToken(`B5_${String(i)}`);
    markers.push(marker);
    const turn = await runGrokTurn({
      binaryPath,
      cwd,
      ...(i === 0 ? { sessionId } : { resumeSessionId: sessionId }),
      prompt: promptForShape('text-only', marker, false),
      deniedTools: DENIED_TOOLS_NO_SHELL,
      spawnMode: 'owned-tree',
      requestStopImmediately: true,
      terminateOn: m,
      timeoutMs: 120_000,
    });
    applyTurnMeta(result, turn, sessionId);
    if (turn.usedSigkill) {
      result.notes.push(`iter${String(i)}-sigkill`);
      result.passed = false;
      return result;
    }
    if (
      turn.requestToSettlementMs === null ||
      turn.requestToSettlementMs >= REQUEST_TO_SETTLEMENT_BUDGET_MS
    ) {
      result.notes.push(`iter${String(i)}-slow-settlement=${String(turn.requestToSettlementMs)}`);
      result.passed = false;
      return result;
    }
  }

  const cont = await runContinuation({
    binaryPath,
    cwd,
    sessionId,
    expectedMarkers: markers,
    trackSession,
  });
  result.resumeExitCode = cont.exitCode;
  result.resumeSameSession = cont.sameSession;
  result.markerRetention.current = cont.markersPresent;
  result.passed = cont.markersPresent && cont.sameSession;
  if (!result.passed) result.notes.push(`B5 allMarkers=${String(cont.markersPresent)}`);
  return result;
}

async function runMidTool(
  id: 'B6' | 'B7',
  binaryPath: string,
  cwd: string,
  platform: string,
  mode: SpawnMode,
  trackSession: (id: string) => void
): Promise<ScenarioResult> {
  const result = emptyScenario(id, platform, mode);
  result.trigger = 'pid-file';
  const sessionId = randomUUID();
  const marker = markerToken(id);
  result.assignedSessionId = sessionId;
  trackSession(sessionId);
  const { pidPath } = writeSlowToolScript(cwd);
  const denied = DENIED_TOOLS_NO_SHELL.filter(t => !ALLOWED_SHELL_TOOLS.includes(t as never));
  const turn = await runGrokTurn({
    binaryPath,
    cwd,
    sessionId,
    prompt: promptForShape('tool-first', marker, true),
    allowedTools: ALLOWED_SHELL_TOOLS,
    deniedTools: denied,
    spawnMode: mode,
    requestStopAtBoundary: true,
    terminateOn: { kind: 'pid-file' },
    pidFilePath: pidPath,
    timeoutMs: 120_000,
  });
  applyTurnMeta(result, turn, sessionId);

  const cont = await runContinuation({
    binaryPath,
    cwd,
    sessionId,
    expectedMarkers: [marker],
    trackSession,
  });
  result.resumeExitCode = cont.exitCode;
  result.resumeSameSession = cont.sameSession;
  result.markerRetention.current = cont.markersPresent;

  if (id === 'B6') {
    // Comparison evidence only — pass if we observed the child fingerprint outcome.
    result.passed = turn.descendantsAliveAfterExit !== null || turn.sawToolInProgress;
    result.notes.push(
      `legacy-child-alive=${String(turn.descendantsAliveAfterExit)} (comparison only)`
    );
  } else {
    const settlementOk =
      turn.requestToSettlementMs !== null &&
      turn.requestToSettlementMs < REQUEST_TO_SETTLEMENT_BUDGET_MS;
    result.passed =
      turn.descendantsAliveAfterExit === false &&
      cont.markersPresent &&
      cont.sameSession &&
      !turn.usedSigkill &&
      settlementOk;
    if (!result.passed) {
      result.notes.push(
        `B7 childAlive=${String(turn.descendantsAliveAfterExit)} marker=${String(cont.markersPresent)} settlement=${String(turn.requestToSettlementMs)}`
      );
    }
  }
  return result;
}

async function runB8(
  binaryPath: string,
  cwd: string,
  platform: string,
  trackSession: (id: string) => void
): Promise<ScenarioResult> {
  const result = emptyScenario('B8', platform, 'legacy');
  const sessionId = randomUUID();
  const marker = markerToken('B8');
  result.assignedSessionId = sessionId;
  trackSession(sessionId);
  // Natural completion with a late Stop request that should lose the race.
  const turn = await runGrokTurn({
    binaryPath,
    cwd,
    sessionId,
    prompt: promptForShape('text-only', marker, false),
    deniedTools: DENIED_TOOLS_NO_SHELL,
    // Simulate a Stop after the parser has accepted the terminal end. It must
    // not send a stale tree signal or relabel the completed turn as interrupted.
    requestStopAfterNaturalEnd: true,
    timeoutMs: 90_000,
  });
  applyTurnMeta(result, turn, sessionId);
  result.passed =
    turn.exitCode === 0 &&
    turn.endStopReason !== null &&
    !turn.usedSigkill &&
    turn.escalation === 'none' &&
    result.sessionIdEqual === true &&
    turn.stopRequestedAfterNaturalEnd;
  if (!result.passed) {
    result.notes.push(
      `B8 natural exit=${String(turn.exitCode)} stopReason=${String(turn.endStopReason)}`
    );
  } else {
    result.notes.push('natural-end-accepted-before-stop-without-kill');
  }
  return result;
}

async function runB9(
  binaryPath: string,
  cwd: string,
  platform: string,
  trackSession: (id: string) => void
): Promise<ScenarioResult> {
  const result = emptyScenario('B9', platform, 'owned-tree');
  result.trigger = 'pid-file';
  const sessionId = randomUUID();
  const marker = markerToken('B9');
  result.assignedSessionId = sessionId;
  trackSession(sessionId);
  const { pidPath } = writeSlowToolScript(cwd);
  const denied = DENIED_TOOLS_NO_SHELL.filter(t => !ALLOWED_SHELL_TOOLS.includes(t as never));
  const turn = await runGrokTurn({
    binaryPath,
    cwd,
    sessionId,
    prompt: promptForShape('tool-first', marker, true),
    allowedTools: ALLOWED_SHELL_TOOLS,
    deniedTools: denied,
    spawnMode: 'owned-tree',
    requestStopAtBoundary: true,
    terminateOn: { kind: 'pid-file' },
    cancelMode: true,
    pidFilePath: pidPath,
    timeoutMs: 120_000,
  });
  applyTurnMeta(result, turn, sessionId);
  // Cancel does not need session resume; require descendants gone within cancel grace path.
  result.passed =
    turn.descendantsAliveAfterExit === false &&
    (turn.signalToExitMs === null || turn.signalToExitMs <= CANCEL_GRACE_MS);
  if (!result.passed) {
    result.notes.push(
      `B9 childAlive=${String(turn.descendantsAliveAfterExit)} signalToExitMs=${String(turn.signalToExitMs)}`
    );
  }
  return result;
}

async function runLatencyMatrix(input: {
  binaryPath: string;
  cwd: string;
  platform: string;
  m: TriggerKind;
  samples: number;
  trackSession: (id: string) => void;
}): Promise<ScenarioResult> {
  const result = emptyScenario('LAT', input.platform, 'owned-tree');
  result.trigger = triggerLabel(input.m);
  const newSettlements: (number | null)[] = [];
  const resumedSettlements: (number | null)[] = [];
  const forkedSettlements: (number | null)[] = [];
  let failures = 0;

  for (let i = 0; i < input.samples; i++) {
    const sessionId = randomUUID();
    const marker = markerToken(`Lnew${String(i)}`);
    input.trackSession(sessionId);
    const turn = await runGrokTurn({
      binaryPath: input.binaryPath,
      cwd: input.cwd,
      sessionId,
      prompt: promptForShape('text-only', marker, false),
      deniedTools: DENIED_TOOLS_NO_SHELL,
      spawnMode: 'owned-tree',
      requestStopImmediately: true,
      terminateOn: input.m,
      timeoutMs: 120_000,
    });
    newSettlements.push(turn.requestToSettlementMs);
    const cont = await runContinuation({
      binaryPath: input.binaryPath,
      cwd: input.cwd,
      sessionId,
      expectedMarkers: [marker],
      trackSession: input.trackSession,
    });
    if (
      !cont.markersPresent ||
      turn.usedSigkill ||
      turn.requestToSettlementMs === null ||
      turn.requestToSettlementMs >= REQUEST_TO_SETTLEMENT_BUDGET_MS
    ) {
      failures += 1;
      result.notes.push(`new[${String(i)}]-fail settlement=${String(turn.requestToSettlementMs)}`);
    }
  }

  for (let i = 0; i < input.samples; i++) {
    const sessionId = randomUUID();
    const inherited = markerToken(`Lri${String(i)}`);
    const current = markerToken(`Lrc${String(i)}`);
    input.trackSession(sessionId);
    const seed = await runGrokTurn({
      binaryPath: input.binaryPath,
      cwd: input.cwd,
      sessionId,
      prompt: promptForShape('text-only', inherited, false),
      deniedTools: DENIED_TOOLS_NO_SHELL,
      timeoutMs: 90_000,
    });
    if (seed.exitCode !== 0) {
      failures += 1;
      resumedSettlements.push(null);
      result.notes.push(`resumed[${String(i)}]-seed-fail`);
      continue;
    }
    const turn = await runGrokTurn({
      binaryPath: input.binaryPath,
      cwd: input.cwd,
      resumeSessionId: sessionId,
      prompt: promptForShape('text-only', current, false),
      deniedTools: DENIED_TOOLS_NO_SHELL,
      spawnMode: 'owned-tree',
      requestStopImmediately: true,
      terminateOn: input.m,
      timeoutMs: 120_000,
    });
    resumedSettlements.push(turn.requestToSettlementMs);
    const cont = await runContinuation({
      binaryPath: input.binaryPath,
      cwd: input.cwd,
      sessionId,
      expectedMarkers: [inherited, current],
      trackSession: input.trackSession,
    });
    if (
      !cont.markersPresent ||
      turn.usedSigkill ||
      turn.requestToSettlementMs === null ||
      turn.requestToSettlementMs >= REQUEST_TO_SETTLEMENT_BUDGET_MS
    ) {
      failures += 1;
      result.notes.push(
        `resumed[${String(i)}]-fail settlement=${String(turn.requestToSettlementMs)}`
      );
    }
  }

  for (let i = 0; i < input.samples; i++) {
    const sourceId = randomUUID();
    const forkId = randomUUID();
    const sourceMarker = markerToken(`Lfs${String(i)}`);
    const forkMarker = markerToken(`Lff${String(i)}`);
    input.trackSession(sourceId);
    input.trackSession(forkId);
    const seed = await runGrokTurn({
      binaryPath: input.binaryPath,
      cwd: input.cwd,
      sessionId: sourceId,
      prompt: promptForShape('text-only', sourceMarker, false),
      deniedTools: DENIED_TOOLS_NO_SHELL,
      timeoutMs: 90_000,
    });
    if (seed.exitCode !== 0) {
      failures += 1;
      forkedSettlements.push(null);
      result.notes.push(`forked[${String(i)}]-seed-fail`);
      continue;
    }
    const turn = await runGrokTurn({
      binaryPath: input.binaryPath,
      cwd: input.cwd,
      resumeSessionId: sourceId,
      forkSession: true,
      sessionId: forkId,
      prompt: promptForShape('text-only', forkMarker, false),
      deniedTools: DENIED_TOOLS_NO_SHELL,
      spawnMode: 'owned-tree',
      requestStopImmediately: true,
      terminateOn: input.m,
      timeoutMs: 120_000,
    });
    forkedSettlements.push(turn.requestToSettlementMs);
    const cont = await runContinuation({
      binaryPath: input.binaryPath,
      cwd: input.cwd,
      sessionId: forkId,
      expectedMarkers: [sourceMarker, forkMarker],
      trackSession: input.trackSession,
    });
    if (
      !cont.markersPresent ||
      turn.usedSigkill ||
      turn.requestToSettlementMs === null ||
      turn.requestToSettlementMs >= REQUEST_TO_SETTLEMENT_BUDGET_MS
    ) {
      failures += 1;
      result.notes.push(
        `forked[${String(i)}]-fail settlement=${String(turn.requestToSettlementMs)}`
      );
    }
  }

  result.samples = [
    summarizeSamples('new', newSettlements, 0),
    summarizeSamples('resumed', resumedSettlements, 0),
    summarizeSamples('forked', forkedSettlements, 0),
  ];
  // Recompute failures into summaries more accurately
  result.samples = [
    summarizeSamples(
      'new',
      newSettlements,
      newSettlements.filter(v => v === null || v >= REQUEST_TO_SETTLEMENT_BUDGET_MS).length
    ),
    summarizeSamples(
      'resumed',
      resumedSettlements,
      resumedSettlements.filter(v => v === null || v >= REQUEST_TO_SETTLEMENT_BUDGET_MS).length
    ),
    summarizeSamples(
      'forked',
      forkedSettlements,
      forkedSettlements.filter(v => v === null || v >= REQUEST_TO_SETTLEMENT_BUDGET_MS).length
    ),
  ];
  result.passed =
    failures === 0 && result.samples.every(s => s.allUnderBudget && s.n >= input.samples);
  if (!result.passed) result.notes.push(`latency-failures=${String(failures)}`);
  return result;
}

function evaluateGates(input: {
  scenarios: ScenarioResult[];
  chosenM: string | null;
  platform: string;
  hostKind: 'native' | 'container';
}): ReleaseGate[] {
  const byId = new Map(input.scenarios.map(s => [s.id, s]));
  const b0 = byId.get('B0');
  const b2 = byId.get('B2');
  const b3 = byId.get('B3');
  const b4 = byId.get('B4');
  const b5 = byId.get('B5');
  const b7 = byId.get('B7');
  const b8 = byId.get('B8');
  const b9 = byId.get('B9');
  const lat = byId.get('LAT');
  const w1 = byId.get('W1');
  const isMac = process.platform === 'darwin';
  const isLinux = process.platform === 'linux';
  const isWin = process.platform === 'win32';

  const hostPass = (s: ScenarioResult | undefined): boolean => Boolean(s?.passed);

  return [
    {
      id: 'B0',
      title: 'New assigned session completes naturally',
      status: hostPass(b0) ? 'PASS' : 'BLOCKED',
      evidence: b0
        ? `exit=${String(b0.exitCode)} sessionEqual=${String(b0.sessionIdEqual)} marker=${String(b0.markerRetention.current)}`
        : 'missing',
    },
    {
      id: 'B2',
      title: 'Earliest safe boundary M with current-prompt retention',
      status: input.chosenM && hostPass(b2) ? 'PASS' : 'BLOCKED',
      evidence: `M=${input.chosenM ?? 'none'} b2passed=${String(b2?.passed)}`,
    },
    {
      id: 'B3',
      title: 'Resumed turn Stop retains inherited+current markers under 1000ms',
      status: hostPass(b3) ? 'PASS' : 'BLOCKED',
      evidence: b3
        ? `markers=${String(b3.markerRetention.current)} settlement=${String(b3.timings.requestToSettlementMs)}`
        : 'missing',
    },
    {
      id: 'B4',
      title: 'Forked turn Stop retains source+fork markers; source unchanged',
      status: hostPass(b4) ? 'PASS' : 'BLOCKED',
      evidence: b4
        ? `forkMarkers=${String(b4.markerRetention.fork)} sourceOk=${String(b4.markerRetention.sourceWithoutFork)} settlement=${String(b4.timings.requestToSettlementMs)}`
        : 'missing',
    },
    {
      id: 'B5',
      title: 'Repeated Stop retains all markers on one session',
      status: hostPass(b5) ? 'PASS' : 'BLOCKED',
      evidence: b5 ? `markers=${String(b5.markerRetention.current)}` : 'missing',
    },
    {
      id: 'B7',
      title: 'Owned-tree mid-tool Stop reaps exact descendants',
      status: hostPass(b7) ? 'PASS' : 'BLOCKED',
      evidence: b7
        ? `descendantsAlive=${String(b7.descendantsAliveAfterExit)} marker=${String(b7.markerRetention.current)}`
        : 'missing',
    },
    {
      id: 'B8',
      title: 'Natural completion wins Stop race without kill',
      status: hostPass(b8) ? 'PASS' : 'BLOCKED',
      evidence: b8 ? `exit=${String(b8.exitCode)} escalation=${String(b8.escalation)}` : 'missing',
    },
    {
      id: 'B9',
      title: 'Node-Cancel tree termination reaps descendants',
      status: hostPass(b9) ? 'PASS' : 'BLOCKED',
      evidence: b9
        ? `descendantsAlive=${String(b9.descendantsAliveAfterExit)} signalToExitMs=${String(b9.timings.signalToExitMs)}`
        : 'missing',
    },
    {
      id: 'LAT',
      title: '≥10 new+resumed+forked samples all request-to-settlement <1000ms',
      status: hostPass(lat) ? 'PASS' : 'BLOCKED',
      evidence: lat?.samples
        ? lat.samples
            .map(
              s =>
                `${s.turnKind}:n=${String(s.n)} min=${String(s.minMs)} med=${String(s.medianMs)} max=${String(s.maxMs)} ok=${String(s.allUnderBudget)}`
            )
            .join('; ')
        : 'missing',
    },
    {
      id: 'HOST-MAC',
      title: 'Native macOS B0–B9 evidence',
      status:
        isMac && input.hostKind === 'native'
          ? [b0, b2, b3, b4, b5, b7, b8, b9].every(hostPass) && input.chosenM
            ? 'PASS'
            : 'BLOCKED'
          : isMac
            ? 'BLOCKED'
            : 'SKIPPED',
      evidence: isMac
        ? `native=${String(input.hostKind === 'native')} M=${input.chosenM ?? 'none'}`
        : 'not-this-host',
    },
    {
      id: 'HOST-LINUX',
      title: 'Native Linux B0–B9 evidence',
      status:
        isLinux && input.hostKind === 'native'
          ? [b0, b2, b3, b4, b5, b7, b8, b9].every(hostPass) && input.chosenM
            ? 'PASS'
            : 'BLOCKED'
          : 'BLOCKED',
      evidence: isLinux
        ? `native=${String(input.hostKind === 'native')} M=${input.chosenM ?? 'none'}`
        : 'host-unavailable-pending-operator-evidence',
    },
    {
      id: 'W1',
      title: 'Native Windows B0–B9 via real .exe/.cmd launch path',
      status: isWin ? (hostPass(w1) ? 'PASS' : 'BLOCKED') : 'BLOCKED',
      evidence: isWin
        ? w1?.notes.join('; ') || 'ran-on-windows'
        : 'host-unavailable-pending-operator-evidence',
    },
  ];
}

function renderReport(doc: SpikeDocument): string {
  const lines: string[] = [
    '# Grok interrupt/resume spike evidence (round 2)',
    '',
    `- **Overall**: **${doc.overall}**`,
    `- **Date**: ${new Date().toISOString().slice(0, 10)}`,
    '- **Issue**: #186',
    `- **CLI version (exact)**: \`${doc.cliVersion}\``,
    `- **Current stable check**: ${doc.currentStableCheck}`,
    `- **Binary basename**: \`${doc.binaryPathBasename}\``,
    `- **Host**: \`${doc.platform}\` / \`${doc.arch}\` (${doc.hostKind})`,
    `- **Bun**: \`${doc.bunVersion}\``,
    `- **Chosen M**: \`${doc.chosenBoundaryM ?? 'BLOCKED — none'}\``,
    `- **Resumed-turn policy**: ${doc.resumedTurnPolicy}`,
    `- **Tree primitives**: POSIX \`${doc.treePrimitives.posix}\`; Windows \`${doc.treePrimitives.windows}\``,
    `- **Grace**: interrupt ${String(doc.proposedGraceMs.interrupt)} ms / cancel ${String(doc.proposedGraceMs.cancel)} ms`,
    '',
    '## Validated build note',
    '',
    doc.validatedBuildNote,
    '',
    '## Command shape',
    '',
    '```text',
    ...doc.commandShape,
    '```',
    '',
    '## Deliberate diagnostic differences vs production argv',
    '',
    ...doc.deliberateDifferences.map(d => `- ${d}`),
    '',
    '## Scenario table',
    '',
    '| ID | Mode | Trigger | Passed | Exit | Settlement ms | SIGKILL | Session equal | Markers (cur/inh/fork/src) | Descendants alive |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const s of doc.scenarios) {
    if (s.id === 'LAT') continue;
    const markers = `${String(s.markerRetention.current)}/${String(s.markerRetention.inherited)}/${String(s.markerRetention.fork)}/${String(s.markerRetention.sourceWithoutFork)}`;
    lines.push(
      `| ${s.id} | ${s.spawnMode} | ${s.trigger ?? '—'} | ${String(s.passed)} | ${String(s.exitCode)} | ${String(s.timings.requestToSettlementMs)} | ${String(s.usedSigkill)} | ${String(s.sessionIdEqual)} | ${markers} | ${String(s.descendantsAliveAfterExit)} |`
    );
  }
  lines.push('', '### Exact descendant fingerprints', '');
  for (const s of doc.scenarios) {
    if (s.childFingerprints.length === 0) continue;
    lines.push(`- **${s.id}**: ${s.childFingerprints.join(', ')}`);
  }
  lines.push('', '### Event types (no payloads)', '');
  for (const s of doc.scenarios) {
    if (s.id === 'LAT') continue;
    lines.push(`- **${s.id}**: ${s.eventTypes.join(', ') || '(none)'}`);
    if (s.notes.length > 0) lines.push(`  - notes: ${s.notes.join(' | ')}`);
  }
  lines.push('', '## Latency summary (request→settlement)', '');
  lines.push('| Turn kind | n | min ms | median ms | max ms | all <1000 | failures |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const s of doc.timingSummary) {
    lines.push(
      `| ${s.turnKind} | ${String(s.n)} | ${String(s.minMs)} | ${String(s.medianMs)} | ${String(s.maxMs)} | ${String(s.allUnderBudget)} | ${String(s.failures)} |`
    );
  }
  lines.push(
    '',
    '## Release gates',
    '',
    '| ID | Gate | Status | Evidence |',
    '| --- | --- | --- | --- |'
  );
  for (const g of doc.releaseGates) {
    lines.push(`| ${g.id} | ${g.title} | **${g.status}** | ${g.evidence} |`);
  }
  lines.push(
    '',
    '## Cleanup',
    '',
    `- sessions deleted: ${String(doc.cleanup.sessionsDeleted)} (UUIDs omitted when delete succeeded)`,
    `- sessions delete failed: ${String(doc.cleanup.sessionsDeleteFailed.length)}${doc.cleanup.sessionsDeleteFailed.length > 0 ? ` — UUIDs: ${doc.cleanup.sessionsDeleteFailed.join(', ')}` : ''}`,
    `- temp dir removed: ${String(doc.cleanup.tempDirRemoved)}`,
    '',
    '## Verdict',
    '',
    ...doc.verdictNotes.map(n => `- ${n}`),
    '',
    '## Sanitization',
    '',
    'No credentials, prompts, markers, model text, session contents, home paths, raw stderr, or env values. Session UUIDs listed only on delete failure. Descendant fingerprints use pid+start-time only.',
    ''
  );
  return `${lines.join('\n')}\n`;
}

async function main(): Promise<void> {
  const binaryPath = await resolveGrokBinaryPath(process.env.GROK_SPIKE_BIN_PATH, process.env);
  const hostKind = process.env.GROK_SPIKE_HOST_KIND === 'container' ? 'container' : 'native';
  const only = process.env.GROK_SPIKE_ONLY?.trim();
  const sampleCount = Math.max(
    1,
    Number(process.env.GROK_SPIKE_SAMPLES ?? DEFAULT_LATENCY_SAMPLES) || DEFAULT_LATENCY_SAMPLES
  );
  const wanted = only ? new Set(only.split(',').map(s => s.trim().toUpperCase())) : null;
  const want = (id: string): boolean => wanted === null || wanted.has(id);

  if (only) process.stderr.write(`spike scope override GROK_SPIKE_ONLY=${only}\n`);
  process.stderr.write(`spike samples per turn kind: ${String(sampleCount)}\n`);

  const platform = `${process.platform}/${process.arch}`;
  const cliVersion = readCliVersion(binaryPath);
  const cwd = ensureTempGitRepo();
  const sessions = new Set<string>();
  const sessionsDeleteFailed: string[] = [];
  let sessionsDeleted = 0;
  const scenarios: ScenarioResult[] = [];
  let tempDirRemoved = false;
  let chosenM: TriggerKind | null = null;
  let chosenLabel: string | null = null;

  const trackSession = (id: string | null | undefined): void => {
    if (id) sessions.add(id);
  };

  try {
    if (want('B0')) scenarios.push(await runB0(binaryPath, cwd, platform, trackSession));
    if (want('B1')) scenarios.push(await runB1(binaryPath, cwd, platform, trackSession));

    if (want('B2')) {
      const b1 = scenarios.find(s => s.id === 'B1') ?? emptyScenario('B1', platform);
      const discovery = await discoverM({
        binaryPath,
        cwd,
        platform,
        trackSession,
        b1,
      });
      chosenM = discovery.m;
      chosenLabel = discovery.chosenLabel;
      // Collapse probes into one B2 row representing the chosen M (or best effort).
      const b2 = emptyScenario('B2', platform, 'owned-tree');
      b2.trigger = chosenLabel ?? 'none';
      const passing = discovery.probes.filter(p => p.passed);
      const representative =
        (chosenLabel
          ? discovery.probes.find(p => p.trigger === chosenLabel && p.passed)
          : undefined) ??
        passing[0] ??
        discovery.probes[discovery.probes.length - 1];
      if (representative) {
        b2.eventTypes = representative.eventTypes;
        b2.exitCode = representative.exitCode;
        b2.timings = representative.timings;
        b2.markerRetention = representative.markerRetention;
        b2.sessionIdEqual = representative.sessionIdEqual;
        b2.usedSigkill = representative.usedSigkill;
        b2.descendantsAliveAfterExit = representative.descendantsAliveAfterExit;
        b2.resumeSameSession = representative.resumeSameSession;
        b2.assignedSessionId = representative.assignedSessionId;
        b2.reportedSessionId = representative.reportedSessionId;
      }
      b2.passed = chosenM !== null;
      b2.notes.push(
        ...discovery.probes.map(p => {
          const detail = p.notes.filter(n => n.startsWith('boundaryFail')).join(';');
          return `probe:${p.trigger ?? '?'}/${p.promptShape ?? '?'}=${p.passed ? 'pass' : 'fail'} settle=${String(p.timings.requestToSettlementMs)}${detail ? ` ${detail}` : ''}`;
        })
      );
      scenarios.push(b2);
    }

    if (chosenM && want('B3')) {
      scenarios.push(await runB3(binaryPath, cwd, platform, chosenM, trackSession));
    } else if (want('B3')) {
      const blocked = emptyScenario('B3', platform);
      blocked.notes.push('skipped — no M');
      scenarios.push(blocked);
    }

    if (chosenM && want('B4')) {
      scenarios.push(await runB4(binaryPath, cwd, platform, chosenM, trackSession));
    } else if (want('B4')) {
      const blocked = emptyScenario('B4', platform);
      blocked.notes.push('skipped — no M');
      scenarios.push(blocked);
    }

    if (chosenM && want('B5')) {
      scenarios.push(await runB5(binaryPath, cwd, platform, chosenM, trackSession));
    } else if (want('B5')) {
      const blocked = emptyScenario('B5', platform);
      blocked.notes.push('skipped — no M');
      scenarios.push(blocked);
    }

    if (want('B6'))
      scenarios.push(await runMidTool('B6', binaryPath, cwd, platform, 'legacy', trackSession));
    if (want('B7'))
      scenarios.push(await runMidTool('B7', binaryPath, cwd, platform, 'owned-tree', trackSession));
    if (want('B8')) scenarios.push(await runB8(binaryPath, cwd, platform, trackSession));
    if (want('B9')) scenarios.push(await runB9(binaryPath, cwd, platform, trackSession));

    if (want('W1')) {
      if (process.platform !== 'win32') {
        const w1 = emptyScenario('W1', 'win32');
        w1.notes.push('host-unavailable-pending-operator-evidence');
        w1.passed = false;
        scenarios.push(w1);
      } else {
        // On Windows, treat aggregate of local B0–B9 as W1.
        const w1 = emptyScenario('W1', platform, 'owned-tree');
        w1.passed = scenarios
          .filter(s => s.id !== 'W1' && s.id !== 'LAT' && s.id !== 'B1' && s.id !== 'B6')
          .every(s => s.passed);
        w1.notes.push('windows-aggregate-of-local-matrix');
        scenarios.push(w1);
      }
    }

    if (chosenM && want('LAT')) {
      scenarios.push(
        await runLatencyMatrix({
          binaryPath,
          cwd,
          platform,
          m: chosenM,
          samples: sampleCount,
          trackSession,
        })
      );
    } else if (want('LAT')) {
      const lat = emptyScenario('LAT', platform);
      lat.notes.push('skipped — no M');
      scenarios.push(lat);
    }

    for (const id of sessions) {
      if (deleteSession(binaryPath, cwd, id)) sessionsDeleted += 1;
      else sessionsDeleteFailed.push(id);
    }
    try {
      rmSync(cwd, { recursive: true, force: true });
      tempDirRemoved = true;
    } catch {
      tempDirRemoved = false;
    }

    const releaseGates = evaluateGates({
      scenarios,
      chosenM: chosenLabel,
      platform,
      hostKind,
    });
    // HOST-LINUX and W1 are expected BLOCKED on macOS-only agent hosts — overall
    // for *this host* still BLOCKED per decision rules (all three natives required).
    const overall: 'PASS' | 'BLOCKED' = releaseGates.every(
      g => g.status === 'PASS' || g.status === 'SKIPPED'
    )
      ? 'PASS'
      : 'BLOCKED';

    const lat = scenarios.find(s => s.id === 'LAT');
    const b3 = scenarios.find(s => s.id === 'B3');
    const resumedPolicy = b3?.passed
      ? 'resumed turns must wait for M (Stop may be requested earlier; signal deferred to M); full request-to-settlement stays under 1000 ms'
      : 'undecided — B3 did not pass';

    const versionLine = (cliVersion.split('\n')[0] ?? cliVersion).trim();
    const verdictNotes: string[] = [];
    if (!chosenLabel) {
      verdictNotes.push(
        'No production-observable M satisfied current-prompt retention + sub-second settlement across text/reasoning/tool shapes on this host.'
      );
    } else {
      verdictNotes.push(`Chosen M on this host: ${chosenLabel}.`);
    }
    if (process.platform !== 'linux') {
      verdictNotes.push(
        'Native Linux evidence unavailable in this environment — HOST-LINUX BLOCKED.'
      );
    }
    if (process.platform !== 'win32') {
      verdictNotes.push('Native Windows evidence unavailable in this environment — W1 BLOCKED.');
    }
    verdictNotes.push(
      'Do not flip GROK_CAPABILITIES.interrupt until B0–B9 pass on native macOS+Linux and W1 on native Windows.'
    );
    verdictNotes.push(
      'One successful build is a validated build, not a minimum-version floor — no doctor rejection from this phase.'
    );

    const document: SpikeDocument = {
      schemaVersion: 2,
      kind: 'grok-interrupt-resume-spike-round-2',
      cliVersion: versionLine,
      currentStableCheck: `local --version reports ${versionLine}; treated as current installed stable for this host (changelog not fetched to avoid network coupling in the runner)`,
      binaryPathBasename: basename(binaryPath),
      platform,
      arch: process.arch,
      hostKind,
      bunVersion: Bun.version,
      commandShape: [
        'grok --version',
        'grok --single <nonce-prompt> --verbatim --cwd <temp-git-repo> \\',
        '  --output-format streaming-json --permission-mode bypassPermissions \\',
        '  --disallowed-tools <node denied_tools> [--tools <allowed_tools>] \\',
        '  --no-auto-update \\',
        '  [--session-id <uuid>] [--resume <uuid> [--fork-session --session-id <uuid>]]',
        '# owned-tree: detached POSIX process group; Windows taskkill /T tree primitive',
        '# env: GROK_DISABLE_AUTOUPDATER=1',
        '# NOT used for contract evidence: --sandbox workspace',
        'grok sessions delete <uuid>  # disposable cwd only; runner-created UUIDs only',
      ],
      deliberateDifferences: [
        '--no-auto-update flag and GROK_DISABLE_AUTOUPDATER=1 for reproducibility',
        '--session-id / fork --session-id appended after buildGrokArgs() for identity tests (Phase-2 production seam)',
        '--sandbox workspace intentionally omitted (changed Linux startup in round one)',
      ],
      chosenBoundaryM: chosenLabel,
      resumedTurnPolicy: resumedPolicy,
      treePrimitives: {
        posix: 'detached process group (child.pid group) via process.kill(-pid, SIGTERM|SIGKILL)',
        windows:
          'taskkill /PID <pid> /T [/F on escalation] (recorded; proven only on native Windows)',
      },
      scenarios,
      releaseGates,
      timingSummary: lat?.samples ?? [],
      validatedBuildNote: `Validated build observed this run: ${versionLine}. This is evidence of compatibility, not a minimum supported version.`,
      proposedGraceMs: { interrupt: INTERRUPT_GRACE_MS, cancel: CANCEL_GRACE_MS },
      cleanup: {
        sessionsDeleted,
        sessionsDeleteFailed,
        tempDirRemoved,
      },
      overall,
      verdictNotes,
    };

    const reportPath = process.env.GROK_SPIKE_REPORT_PATH?.trim();
    if (reportPath) {
      mkdirSync(dirname(reportPath), { recursive: true });
      writeFileSync(reportPath, renderReport(document), 'utf8');
    }

    // Sanitize scenarios for stdout JSON: drop any chance of text blobs (already not stored).
    process.stdout.write(`${JSON.stringify(document)}\n`);
    if (document.overall !== 'PASS') process.exitCode = 1;
  } catch (error) {
    for (const id of sessions) {
      if (deleteSession(binaryPath, cwd, id)) sessionsDeleted += 1;
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
