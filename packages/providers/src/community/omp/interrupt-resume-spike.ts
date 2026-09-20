/**
 * Diagnostic-only OMP turn-interrupt spike.
 * Do not export from the providers package barrel. Do not call from tests or CI.
 *
 * Two layers:
 *  1. Raw characterization (US-001) — spawn the installed OMP binary directly,
 *     SIGTERM on a deterministic JSONL trigger, and record sanitized facts
 *     about event order, timings, and owned-process cleanup.
 *  2. Provider conformance scaffold (US-003) — instantiate OmpProvider with a
 *     spike-only teeing spawner so signal-to-full-provider-return is measurable
 *     once the US-002 stream-abort seam exists. Inert until then.
 *
 * Output is a single sanitized JSON evidence document on stdout (no prompt
 * text, no credentials, no model content, no raw session ids) plus a
 * non-zero exit when raw characterization cannot complete.
 */
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveOmpBinaryPath } from './binary-resolver';
import { OMP_CAPABILITIES } from './capabilities';
import { OmpProvider, type OmpProcess, type OmpSpawnOptions, type OmpSpawner } from './provider';

const EXPERIMENT_TIMEOUT_MS = 180_000;
const TERMINATION_GRACE_MS = 5_000;
const PROCESS_POLL_MS = 25;
const TOOL_SLEEP_SECONDS = 30;
const TOOL_PID_MARKER_PREFIX = 'archon-omp-spike-tool-';
const RESOLVER_SUPPORTED_PLATFORMS = ['darwin', 'linux', 'win32'] as const;

type FailureCategory =
  | 'timeout'
  | 'authentication'
  | 'model-unavailable'
  | 'binary-missing'
  | 'runtime-error'
  | null;

type CaseKind = 'assistant-text' | 'active-tool';
type TriggerEvent = 'assistant_text_delta' | 'tool_execution_start' | 'none';

interface OwnedPidRecord {
  role: 'omp-child' | 'tool-descendant';
  /** Hashed correlation only — never the raw PID value in output. */
  pidHash: string;
  aliveAfterProviderReturn: boolean;
}

interface RawCaseEvidence {
  kind: CaseKind;
  triggerEvent: TriggerEvent;
  /** Ordered top-level JSONL `type` values observed before SIGTERM. */
  preSignalEventTypes: string[];
  /** Ordered top-level JSONL `type` values observed after SIGTERM. */
  postSignalEventTypes: string[];
  /** True when the first observed event type was `session`. */
  sessionWasFirst: boolean;
  /** ms from process spawn to first `session` event; null if never seen. */
  sessionHeaderLatencyMs: number | null;
  /** Hashed session id correlation (sha256 prefix); null if never seen. */
  sessionIdHash: string | null;
  /** Wall-clock ms from SIGTERM to child exit; null if signal never sent. */
  sigtermToExitMs: number | null;
  /** True when the 5 s SIGKILL fallback actually ran. */
  sigkillFired: boolean;
  /** Child exit code (or null if never observed). */
  exitCode: number | null;
  sawToolEndAfterSignal: boolean;
  sawMessageEndAfterSignal: boolean;
  sawAgentEndAfterSignal: boolean;
  /** Whether any usage-bearing message_end was observed (presence only). */
  sawUsageAfterSignal: boolean;
  ownedPids: OwnedPidRecord[];
  /** True when every tracked owned PID is dead after the run returns. */
  noOwnedDescendantAlive: boolean;
  failureCategory: FailureCategory;
  errorCode: string | null;
}

interface ConformanceCaseScaffold {
  kind: CaseKind;
  /** false until US-002 wires interruptSignal into OmpProvider. */
  implemented: boolean;
  skipReason: string | null;
  /** ms from interruptSignal abort to provider generator return; null if skipped. */
  signalToProviderReturnMs: number | null;
  terminalReason: string | null;
  resultIsError: boolean | null;
  sessionIdHash: string | null;
  recordedEventTypes: string[];
}

export interface OmpInterruptSpikeDocument {
  schemaVersion: 1;
  leg: 'raw-characterization' | 'mixed';
  ompVersion: string;
  platform: string;
  arch: string;
  /** Platforms the binary resolver supports; only the current host is exercised here. */
  resolverSupportedPlatforms: readonly string[];
  platformsCharacterized: string[];
  platformsUncharacterized: string[];
  /** Capability value at spike time — must remain false for US-001. */
  interruptCapability: typeof OMP_CAPABILITIES.interrupt;
  raw: {
    assistantText: RawCaseEvidence | null;
    activeTool: RawCaseEvidence | null;
  };
  /**
   * Post-implementation conformance scaffold. Runs only when OmpProvider
   * accepts interruptSignal; otherwise records an explicit skip.
   */
  conformance: {
    assistantText: ConformanceCaseScaffold;
    activeTool: ConformanceCaseScaffold;
  };
  failureCategory: FailureCategory;
}

interface ReapResult {
  sigkillFired: boolean;
  exitCode: number | null;
  sigtermToExitMs: number | null;
}

/** Minimal surface of a Bun.spawn child used by the raw characterization leg. */
interface SpikeChildProcess {
  readonly pid: number;
  readonly stdout: ReadableStream<Uint8Array> | null;
  readonly stderr: ReadableStream<Uint8Array> | null;
  readonly exited: Promise<number>;
  kill: (signal?: NodeJS.Signals) => void;
}

function hashOpaque(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function classifyFailure(error: unknown): FailureCategory {
  if (error instanceof Error && error.name === 'TimeoutError') return 'timeout';
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes('timed out') || lower.includes('timeout')) return 'timeout';
  if (
    lower.includes('credential') ||
    lower.includes('authenticated') ||
    lower.includes('/login') ||
    lower.includes('unauthorized') ||
    lower.includes('api key') ||
    lower.includes('oauth') ||
    lower.includes('401')
  ) {
    return 'authentication';
  }
  if (
    lower.includes('model') &&
    (lower.includes('unavailable') ||
      lower.includes('not found') ||
      lower.includes('invalid model') ||
      lower.includes('404'))
  ) {
    return 'model-unavailable';
  }
  if (lower.includes('could not find omp') || lower.includes('omp_bin_path')) {
    return 'binary-missing';
  }
  return 'runtime-error';
}

function readOmpVersion(binaryPath: string): string {
  try {
    const output = execFileSync(binaryPath, ['--version'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10_000,
    });
    return output.trim() || 'unknown';
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`omp --version failed: ${message}`);
  }
}

function emptyRawCase(kind: CaseKind): RawCaseEvidence {
  return {
    kind,
    triggerEvent: 'none',
    preSignalEventTypes: [],
    postSignalEventTypes: [],
    sessionWasFirst: false,
    sessionHeaderLatencyMs: null,
    sessionIdHash: null,
    sigtermToExitMs: null,
    sigkillFired: false,
    exitCode: null,
    sawToolEndAfterSignal: false,
    sawMessageEndAfterSignal: false,
    sawAgentEndAfterSignal: false,
    sawUsageAfterSignal: false,
    ownedPids: [],
    noOwnedDescendantAlive: true,
    failureCategory: null,
    errorCode: null,
  };
}

async function runWithTimeout<T>(ms: number, work: () => Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutGate = Promise.withResolvers<T>();
  try {
    timer = setTimeout(() => {
      const err = new Error(`spike timed out after ${String(ms)}ms`);
      err.name = 'TimeoutError';
      timeoutGate.reject(err);
    }, ms);
    return await Promise.race([work(), timeoutGate.promise]);
  } finally {
    clearTimeout(timer);
  }
}

async function* streamLines(stream: ReadableStream<Uint8Array> | null): AsyncGenerator<string> {
  if (!stream) return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      buffer += decoder.decode(next.value, { stream: true });
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, '');
        buffer = buffer.slice(newlineIndex + 1);
        yield line;
        newlineIndex = buffer.indexOf('\n');
      }
    }
    buffer += decoder.decode();
    if (buffer.length > 0) yield buffer.replace(/\r$/, '');
  } finally {
    reader.releaseLock();
  }
}

function parseJsonObject(line: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function eventTypeOf(line: string): string | null {
  const parsed = parseJsonObject(line);
  if (!parsed) {
    try {
      JSON.parse(line);
      return null;
    } catch {
      return 'invalid_json';
    }
  }
  return typeof parsed.type === 'string' && parsed.type.length > 0 ? parsed.type : null;
}

function sessionIdOf(line: string): string | null {
  const parsed = parseJsonObject(line);
  if (parsed?.type !== 'session') return null;
  return typeof parsed.id === 'string' && parsed.id.length > 0 ? parsed.id : null;
}

function isAssistantTextDelta(line: string): boolean {
  const parsed = parseJsonObject(line);
  if (parsed?.type !== 'message_update') return false;
  const evt = parsed.assistantMessageEvent;
  if (typeof evt !== 'object' || evt === null || Array.isArray(evt)) return false;
  const record = evt as Record<string, unknown>;
  return (
    record.type === 'text_delta' && typeof record.delta === 'string' && record.delta.length > 0
  );
}

function isToolExecutionStart(line: string): boolean {
  return eventTypeOf(line) === 'tool_execution_start';
}

function messageEndHasUsage(line: string): boolean {
  const parsed = parseJsonObject(line);
  if (parsed?.type !== 'message_end') return false;
  const message = parsed.message;
  if (typeof message !== 'object' || message === null || Array.isArray(message)) return false;
  const record = message as Record<string, unknown>;
  const hasUsage =
    typeof record.usage === 'object' && record.usage !== null && !Array.isArray(record.usage);
  const hasCost =
    typeof record.cost === 'object' && record.cost !== null && !Array.isArray(record.cost);
  return hasUsage || hasCost;
}

function buildSpawnArgs(cwd: string, prompt: string, resumeSessionId?: string): string[] {
  // Match production argv shape from buildOmpArgs (provider.ts) so the spike
  // characterizes the same CLI surface the provider will terminate.
  const args = ['--mode', 'json', '--cwd', cwd, '--yolo', '--no-title', '--no-extensions'];
  if (resumeSessionId) {
    args.push('--resume', resumeSessionId);
  }
  args.push('--', prompt);
  return args;
}

function assistantPrompt(): string {
  // Long-form generation so SIGTERM can land mid-stream after the first delta.
  return 'Count from 1 to 200, one number per line, with no other commentary.';
}

function toolPrompt(pidFileName: string, marker: string): string {
  // Unique marker in the command so we never match unrelated processes.
  // The shell writes its own PID then sleeps; interrupt while active.
  return (
    'Run exactly one shell command and nothing else: ' +
    `echo $$ > ${pidFileName} && echo ${marker} && sleep ${String(TOOL_SLEEP_SECONDS)}. ` +
    'Do not read files. Do not edit files. Do not run any other command.'
  );
}

function spawnOmp(
  binaryPath: string,
  args: string[],
  cwd: string,
  env: Record<string, string>
): SpikeChildProcess {
  const proc = Bun.spawn([binaryPath, ...args], {
    cwd,
    env,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    pid: proc.pid,
    stdout: proc.stdout,
    stderr: proc.stderr,
    exited: proc.exited,
    kill: (signal?: NodeJS.Signals): void => {
      proc.kill(signal);
    },
  };
}

async function sleep(ms: number): Promise<void> {
  await Bun.sleep(ms);
}

function tryKill(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

async function waitForExitOrGrace(
  exited: Promise<number>,
  graceMs: number
): Promise<number | null> {
  let exitCode: number | null = null;
  const exitWait = exited.then(code => {
    exitCode = code;
    return code;
  });
  const graceGate = Promise.withResolvers<null>();
  const graceTimer = setTimeout(() => {
    graceGate.resolve(null);
  }, graceMs);
  try {
    await Promise.race([exitWait, graceGate.promise]);
  } finally {
    clearTimeout(graceTimer);
  }
  return exitCode;
}

async function reapOwned(
  handle: SpikeChildProcess,
  extraPids: number[],
  graceMs: number
): Promise<ReapResult> {
  const signalAt = Date.now();
  let sigkillFired = false;

  try {
    handle.kill('SIGTERM');
  } catch {
    // Already exited.
  }

  let exitCode = await waitForExitOrGrace(handle.exited, graceMs + 2_000);

  if (exitCode === null && isPidAlive(handle.pid)) {
    sigkillFired = true;
    try {
      handle.kill('SIGKILL');
    } catch {
      // gone
    }
    for (const pid of extraPids) {
      if (isPidAlive(pid)) tryKill(pid, 'SIGKILL');
    }
    exitCode = await waitForExitOrGrace(handle.exited, 2_000);
  }

  if (isPidAlive(handle.pid)) {
    if (tryKill(handle.pid, 'SIGKILL')) sigkillFired = true;
  }
  for (const pid of extraPids) {
    if (isPidAlive(pid) && tryKill(pid, 'SIGKILL')) sigkillFired = true;
  }

  await sleep(PROCESS_POLL_MS * 4);

  return {
    sigkillFired,
    exitCode,
    sigtermToExitMs: exitCode !== null || !isPidAlive(handle.pid) ? Date.now() - signalAt : null,
  };
}

function buildOwnedRecords(ompPid: number, toolPid: number | null): OwnedPidRecord[] {
  const records: OwnedPidRecord[] = [
    {
      role: 'omp-child',
      pidHash: hashOpaque(`pid:${String(ompPid)}`),
      aliveAfterProviderReturn: isPidAlive(ompPid),
    },
  ];
  if (toolPid !== null) {
    records.push({
      role: 'tool-descendant',
      pidHash: hashOpaque(`pid:${String(toolPid)}`),
      aliveAfterProviderReturn: isPidAlive(toolPid),
    });
  }
  return records;
}

function readToolPid(pidFilePath: string): number | null {
  if (!existsSync(pidFilePath)) return null;
  const raw = readFileSync(pidFilePath, 'utf8').trim();
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function waitForToolPid(pidFilePath: string, budgetMs: number): Promise<number | null> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    const pid = readToolPid(pidFilePath);
    if (pid !== null) return pid;
    await sleep(PROCESS_POLL_MS);
  }
  return readToolPid(pidFilePath);
}

async function escalateAfterSignal(
  handle: SpikeChildProcess,
  extraPids: number[],
  signalAt: number
): Promise<ReapResult> {
  let settled = false;
  let exitCode: number | null = null;
  const exitWait = handle.exited.then(code => {
    settled = true;
    exitCode = code;
    return code;
  });

  let sigkillFired = false;
  const killTimer = setTimeout(() => {
    if (settled) return;
    sigkillFired = true;
    try {
      handle.kill('SIGKILL');
    } catch {
      // gone
    }
    for (const pid of extraPids) {
      tryKill(pid, 'SIGKILL');
    }
  }, TERMINATION_GRACE_MS);

  const graceGate = Promise.withResolvers<null>();
  const graceTimer = setTimeout(() => {
    graceGate.resolve(null);
  }, TERMINATION_GRACE_MS + 2_000);
  try {
    await Promise.race([exitWait, graceGate.promise]);
  } finally {
    clearTimeout(killTimer);
    clearTimeout(graceTimer);
  }

  if (isPidAlive(handle.pid) && tryKill(handle.pid, 'SIGKILL')) sigkillFired = true;
  for (const pid of extraPids) {
    if (isPidAlive(pid) && tryKill(pid, 'SIGKILL')) sigkillFired = true;
  }
  await sleep(PROCESS_POLL_MS * 4);

  return {
    sigkillFired,
    exitCode,
    sigtermToExitMs: Date.now() - signalAt,
  };
}

async function runRawCase(input: {
  kind: CaseKind;
  binaryPath: string;
  cwd: string;
  env: Record<string, string>;
}): Promise<RawCaseEvidence> {
  const evidence = emptyRawCase(input.kind);
  const marker = `${TOOL_PID_MARKER_PREFIX}${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const pidFileName = `${marker}.pid`;
  const pidFilePath = join(input.cwd, pidFileName);
  const prompt =
    input.kind === 'assistant-text' ? assistantPrompt() : toolPrompt(pidFileName, marker);
  const args = buildSpawnArgs(input.cwd, prompt);
  const handle = spawnOmp(input.binaryPath, args, input.cwd, input.env);
  const spawnAt = Date.now();
  let signaled = false;
  let signalAt: number | null = null;
  let toolPid: number | null = null;
  const extraPids: number[] = [];

  // Drain stderr so the pipe cannot block; never record content.
  const stderrDrain: Promise<void> = (async (): Promise<void> => {
    try {
      for await (const line of streamLines(handle.stderr)) {
        void line;
      }
    } catch {
      // transport closed
    }
  })();

  try {
    for await (const line of streamLines(handle.stdout)) {
      if (line.trim().length === 0) continue;
      const type = eventTypeOf(line) ?? 'unknown';

      if (!signaled) {
        evidence.preSignalEventTypes.push(type);
        if (evidence.preSignalEventTypes.length === 1) {
          evidence.sessionWasFirst = type === 'session';
        }
        if (type === 'session' && evidence.sessionHeaderLatencyMs === null) {
          evidence.sessionHeaderLatencyMs = Date.now() - spawnAt;
          const sid = sessionIdOf(line);
          if (sid) evidence.sessionIdHash = hashOpaque(sid);
        }

        const shouldSignal =
          input.kind === 'assistant-text' ? isAssistantTextDelta(line) : isToolExecutionStart(line);

        if (shouldSignal) {
          evidence.triggerEvent =
            input.kind === 'assistant-text' ? 'assistant_text_delta' : 'tool_execution_start';
          // Tool case: give the child a moment to write its PID file after start.
          if (input.kind === 'active-tool') {
            toolPid = await waitForToolPid(pidFilePath, 1_500);
            if (toolPid !== null) extraPids.push(toolPid);
          }
          signaled = true;
          signalAt = Date.now();
          try {
            handle.kill('SIGTERM');
          } catch {
            // already dead
          }
          continue;
        }
      } else {
        evidence.postSignalEventTypes.push(type);
        if (type === 'tool_execution_end') evidence.sawToolEndAfterSignal = true;
        if (type === 'message_end') {
          evidence.sawMessageEndAfterSignal = true;
          if (messageEndHasUsage(line)) evidence.sawUsageAfterSignal = true;
        }
        if (type === 'agent_end') evidence.sawAgentEndAfterSignal = true;
        if (type === 'session' && evidence.sessionIdHash === null) {
          const sid = sessionIdOf(line);
          if (sid) evidence.sessionIdHash = hashOpaque(sid);
        }
      }
    }
  } catch (error: unknown) {
    evidence.failureCategory = classifyFailure(error);
    evidence.errorCode = 'stdout_read_failed';
  }

  let reap: ReapResult;
  if (signaled && signalAt !== null) {
    reap = await escalateAfterSignal(handle, extraPids, signalAt);
  } else {
    if (evidence.triggerEvent === 'none') {
      evidence.errorCode = evidence.errorCode ?? 'trigger_never_observed';
      evidence.failureCategory = evidence.failureCategory ?? 'runtime-error';
    }
    reap = await reapOwned(handle, extraPids, TERMINATION_GRACE_MS);
  }

  if (toolPid === null) toolPid = readToolPid(pidFilePath);
  await stderrDrain.catch(() => undefined);

  evidence.sigkillFired = reap.sigkillFired;
  evidence.exitCode = reap.exitCode;
  evidence.sigtermToExitMs = reap.sigtermToExitMs;
  evidence.ownedPids = buildOwnedRecords(handle.pid, toolPid);
  evidence.noOwnedDescendantAlive = evidence.ownedPids.every(p => !p.aliveAfterProviderReturn);
  return evidence;
}

/**
 * OmpProvider currently ignores interruptSignal (only abortSignal terminates).
 * US-002 flips this by wiring first-cause interrupt ownership. Keep the
 * readiness gate explicit so the scaffold activates automatically once the
 * seam lands — without importing private provider internals.
 */
function providerInterruptSeamReady(): boolean {
  return false;
}

function skippedConformance(kind: CaseKind, reason: string): ConformanceCaseScaffold {
  return {
    kind,
    implemented: false,
    skipReason: reason,
    signalToProviderReturnMs: null,
    terminalReason: null,
    resultIsError: null,
    sessionIdHash: null,
    recordedEventTypes: [],
  };
}

/**
 * Future US-003 entry point. Intentionally mostly unused until
 * providerInterruptSeamReady() returns true. Kept inside the spike file
 * (not package-exported) so signal-to-full-provider-return is measurable
 * after the US-002 seam lands.
 */
async function runProviderConformanceCase(input: {
  kind: CaseKind;
  binaryPath: string;
  cwd: string;
  env: Record<string, string>;
}): Promise<ConformanceCaseScaffold> {
  if (!providerInterruptSeamReady()) {
    return skippedConformance(
      input.kind,
      'OmpProvider interruptSignal seam not implemented (awaiting US-002)'
    );
  }

  // Scaffold body for US-003: tee stdout through a recording spawner, abort
  // interruptSignal on the case trigger, measure signal→generator-return.
  const recordedEventTypes: string[] = [];
  const teeingSpawner: OmpSpawner = (command, options: OmpSpawnOptions): OmpProcess => {
    const proc = Bun.spawn(command, {
      cwd: options.cwd,
      env: options.env,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });
    // Identity pipe for the provider; a parallel tee records event types.
    // Full tee wiring lands with US-003 once the seam is live.
    void recordedEventTypes;
    return {
      stdout: proc.stdout,
      stderr: proc.stderr,
      exited: proc.exited,
      kill: (signal?: NodeJS.Signals): void => {
        proc.kill(signal);
      },
    };
  };

  const provider = new OmpProvider({ spawn: teeingSpawner });
  void provider;
  void input.binaryPath;
  return skippedConformance(input.kind, 'conformance body not activated');
}

async function runSpike(binaryPath: string): Promise<OmpInterruptSpikeDocument> {
  const ompVersion = readOmpVersion(binaryPath);
  const platform = process.platform;
  const arch = process.arch;
  const platformsCharacterized = [platform];
  const platformsUncharacterized = RESOLVER_SUPPORTED_PLATFORMS.filter(p => p !== platform);

  const document: OmpInterruptSpikeDocument = {
    schemaVersion: 1,
    leg: 'raw-characterization',
    ompVersion,
    platform,
    arch,
    resolverSupportedPlatforms: RESOLVER_SUPPORTED_PLATFORMS,
    platformsCharacterized,
    platformsUncharacterized: [...platformsUncharacterized],
    interruptCapability: OMP_CAPABILITIES.interrupt,
    raw: { assistantText: null, activeTool: null },
    conformance: {
      assistantText: skippedConformance(
        'assistant-text',
        'OmpProvider interruptSignal seam not implemented (awaiting US-002)'
      ),
      activeTool: skippedConformance(
        'active-tool',
        'OmpProvider interruptSignal seam not implemented (awaiting US-002)'
      ),
    },
    failureCategory: null,
  };

  const cwd = mkdtempSync(join(tmpdir(), 'archon-omp-interrupt-spike-'));
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)
  );

  try {
    try {
      execFileSync('git', ['init', '-q'], { cwd });
    } catch {
      // A plain directory still satisfies the CLI cwd requirement.
    }
    writeFileSync(join(cwd, 'README.spike'), 'archon omp interrupt spike disposable repo\n');

    await runWithTimeout(EXPERIMENT_TIMEOUT_MS, async () => {
      document.raw.assistantText = await runRawCase({
        kind: 'assistant-text',
        binaryPath,
        cwd,
        env,
      });
      document.raw.activeTool = await runRawCase({
        kind: 'active-tool',
        binaryPath,
        cwd,
        env,
      });

      document.conformance.assistantText = await runProviderConformanceCase({
        kind: 'assistant-text',
        binaryPath,
        cwd,
        env,
      });
      document.conformance.activeTool = await runProviderConformanceCase({
        kind: 'active-tool',
        binaryPath,
        cwd,
        env,
      });
    });
  } catch (error: unknown) {
    document.failureCategory = classifyFailure(error);
    process.stderr.write(
      `spike error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }

  return document;
}

function rawCaseOk(caseEvidence: RawCaseEvidence | null): boolean {
  if (!caseEvidence) return false;
  if (caseEvidence.failureCategory !== null) return false;
  if (caseEvidence.triggerEvent === 'none') return false;
  if (caseEvidence.sessionHeaderLatencyMs === null) return false;
  if (!caseEvidence.sessionWasFirst) return false;
  if (caseEvidence.sigtermToExitMs === null) return false;
  if (!caseEvidence.noOwnedDescendantAlive) return false;
  return true;
}

function unresolvedBinaryDocument(error: unknown): OmpInterruptSpikeDocument {
  return {
    schemaVersion: 1,
    leg: 'raw-characterization',
    ompVersion: 'unresolved',
    platform: process.platform,
    arch: process.arch,
    resolverSupportedPlatforms: RESOLVER_SUPPORTED_PLATFORMS,
    platformsCharacterized: [],
    platformsUncharacterized: [...RESOLVER_SUPPORTED_PLATFORMS],
    interruptCapability: OMP_CAPABILITIES.interrupt,
    raw: { assistantText: null, activeTool: null },
    conformance: {
      assistantText: skippedConformance('assistant-text', 'binary unresolved'),
      activeTool: skippedConformance('active-tool', 'binary unresolved'),
    },
    failureCategory: classifyFailure(error) ?? 'binary-missing',
  };
}

async function main(): Promise<void> {
  let binaryPath: string;
  try {
    binaryPath = await resolveOmpBinaryPath();
  } catch (error: unknown) {
    process.stdout.write(`${JSON.stringify(unresolvedBinaryDocument(error))}\n`);
    process.exitCode = 1;
    return;
  }

  const document = await runSpike(binaryPath);
  process.stdout.write(`${JSON.stringify(document)}\n`);

  const rawOk = rawCaseOk(document.raw.assistantText) && rawCaseOk(document.raw.activeTool);
  if (!rawOk || document.failureCategory !== null || document.interruptCapability !== false) {
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await main();
}
