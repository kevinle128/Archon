/**
 * Diagnostic-only OMP turn-interrupt spike.
 * Do not export from the providers package barrel. Do not call from tests or CI.
 *
 * Two layers:
 *  1. Raw characterization (US-001) — spawn the installed OMP binary directly,
 *     SIGTERM on a deterministic JSONL trigger, and record sanitized facts
 *     about event order, timings, and owned-process cleanup.
 *  2. Provider conformance (US-003) — instantiate OmpProvider with a spike-only
 *     teeing spawner so signal-to-full-provider-return is measurable through
 *     the stream-abort seam; resume same-id + boolean context challenge.
 *
 * Output is a single sanitized JSON evidence document on stdout (no prompt
 * text, no credentials, no model content, no raw session ids) plus a
 * non-zero exit when the exercised gate cannot complete.
 */
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { setLogLevel } from '@archon/paths';
import { resolveOmpBinaryPath } from './binary-resolver';
import { OMP_CAPABILITIES } from './capabilities';
import {
  INTERRUPT_SESSION_HEADER_WAIT_MS,
  OmpProvider,
  type OmpProcess,
  type OmpSpawnOptions,
  type OmpSpawner,
} from './provider';
import { STREAM_ABORTED_TERMINAL_REASON, type MessageChunk } from '../../types';

const EXPERIMENT_TIMEOUT_MS = 180_000;
const TERMINATION_GRACE_MS = 5_000;
const PROCESS_POLL_MS = 25;
const TOOL_SLEEP_SECONDS = 30;
const TOOL_PID_MARKER_PREFIX = 'archon-omp-spike-tool-';
const PROVIDER_RETURN_BUDGET_MS = 1_000;
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

interface ConformanceCaseEvidence {
  kind: CaseKind;
  /** false only when the US-002 interrupt seam is absent. */
  implemented: boolean;
  skipReason: string | null;
  /** ms from interruptSignal abort to provider generator return. */
  signalToProviderReturnMs: number | null;
  terminalReason: string | null;
  resultIsError: boolean | null;
  sessionIdHash: string | null;
  /** True when first teed event type was `session`. */
  sessionWasFirst: boolean | null;
  /** True when provider kill path used SIGTERM only (no SIGKILL). */
  gracefulSigterm: boolean | null;
  sigkillFired: boolean | null;
  noOwnedDescendantAlive: boolean | null;
  /** Resume leg: observed id hash equals interrupted id hash. */
  resumeSameId: boolean | null;
  /** Resume leg reached a natural `agent_end` / non-error result. */
  resumeReachedAgentEnd: boolean | null;
  /** Resume boolean challenge proved prior context (YES observed). */
  resumeContextProved: boolean | null;
  resumeSessionIdHash: string | null;
  recordedEventTypes: string[];
  ownedPids: OwnedPidRecord[];
  pass: boolean;
  failReasons: string[];
  failureCategory: FailureCategory;
}

export interface OmpInterruptSpikeDocument {
  schemaVersion: 1;
  leg: 'raw-characterization' | 'mixed' | 'conformance';
  ompVersion: string;
  platform: string;
  arch: string;
  /** Platforms the binary resolver supports; only the current host is exercised here. */
  resolverSupportedPlatforms: readonly string[];
  platformsCharacterized: string[];
  platformsUncharacterized: string[];
  /**
   * Capability value observed while the spike ran. Flip is a separate production
   * edit gated on platform-wide evidence (or an owner-scoped decision).
   */
  interruptCapability: typeof OMP_CAPABILITIES.interrupt;
  raw: {
    assistantText: RawCaseEvidence | null;
    activeTool: RawCaseEvidence | null;
  };
  /**
   * Post-implementation conformance through OmpProvider + interruptSignal.
   */
  conformance: {
    assistantText: ConformanceCaseEvidence;
    activeTool: ConformanceCaseEvidence;
  };
  /** Overall gate for the platforms actually exercised this run. */
  gate: {
    thisPlatformPass: boolean;
    allResolverPlatformsCovered: boolean;
    ownerScopedPlatformDecisionRecorded: boolean;
    capabilityFlipAllowed: boolean;
    blockReasons: string[];
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
  return (evt as Record<string, unknown>).type === 'text_delta';
}

function assistantPrompt(): string {
  // Long-form generation so SIGTERM can land mid-stream after the first delta.
  return 'Count from 1 to 200, one number per line, with no other commentary.';
}

/** Short completed turn so OMP flushes a resumable session before mid-text Stop. */
function assistantSeedPrompt(token: string): string {
  return `Remember the single code token ${token}. Reply with exactly the single token OK and nothing else.`;
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
 * US-002 exported INTERRUPT_SESSION_HEADER_WAIT_MS with the interrupt seam.
 * Presence of that export is the readiness signal (no private internals).
 */
function providerInterruptSeamReady(): boolean {
  return (
    typeof INTERRUPT_SESSION_HEADER_WAIT_MS === 'number' && INTERRUPT_SESSION_HEADER_WAIT_MS > 0
  );
}

function emptyConformance(kind: CaseKind): ConformanceCaseEvidence {
  return {
    kind,
    implemented: true,
    skipReason: null,
    signalToProviderReturnMs: null,
    terminalReason: null,
    resultIsError: null,
    sessionIdHash: null,
    sessionWasFirst: null,
    gracefulSigterm: null,
    sigkillFired: null,
    noOwnedDescendantAlive: null,
    resumeSameId: null,
    resumeReachedAgentEnd: null,
    resumeContextProved: null,
    resumeSessionIdHash: null,
    recordedEventTypes: [],
    ownedPids: [],
    pass: false,
    failReasons: [],
    failureCategory: null,
  };
}

function skippedConformance(kind: CaseKind, reason: string): ConformanceCaseEvidence {
  return {
    ...emptyConformance(kind),
    implemented: false,
    skipReason: reason,
    failReasons: [reason],
  };
}

function resumeChallengePrompt(kind: CaseKind, seedToken?: string): string {
  if (seedToken) {
    return (
      'Reply with exactly the single token YES if you were told to remember the code token ' +
      `${seedToken}, otherwise reply with exactly NO. No other words.`
    );
  }
  if (kind === 'assistant-text') {
    return (
      'Reply with exactly the single token YES if your immediately previous turn ' +
      'was counting numbers line by line, otherwise reply with exactly NO. ' +
      'No other words.'
    );
  }
  return (
    'Your previous turn started a long-running shell sleep. ' +
    'Reply with exactly the single token YES if that is true, otherwise exactly NO. ' +
    'No punctuation. No other words.'
  );
}

function assistantTextProvesYes(chunks: MessageChunk[]): boolean {
  const text = chunks
    .filter(chunk => chunk.type === 'assistant')
    .map(chunk => {
      if (!('content' in chunk) || chunk.content == null) return '';
      return typeof chunk.content === 'string' ? chunk.content : '';
    })
    .join('\n')
    .trim()
    .toUpperCase();
  if (text.length === 0) return false;
  // Never log model text. Accept YES as the whole reply or the first token,
  // with optional surrounding quotes/punctuation the model sometimes adds.
  const normalized = text
    .replace(/["'`.,!;:()[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (normalized === 'YES') return true;
  const firstToken = normalized.split(' ')[0];
  if (firstToken === 'YES') return true;
  // Whole-reply contains a clear affirmative token and no leading NO.
  if (normalized.startsWith('NO')) return false;
  return /(^|\s)YES(\s|$)/.test(normalized);
}

async function runResumeChallenge(input: {
  kind: CaseKind;
  cwd: string;
  env: Record<string, string>;
  sessionId: string;
  seedToken?: string;
}): Promise<{
  sameId: boolean;
  reachedAgentEnd: boolean;
  contextProved: boolean;
  sessionIdHash: string | null;
  failureCategory: FailureCategory;
}> {
  const attempt = async (): Promise<{
    sameId: boolean;
    reachedAgentEnd: boolean;
    contextProved: boolean;
    sessionIdHash: string | null;
    failureCategory: FailureCategory;
  }> => {
    const provider = new OmpProvider();
    const chunks: MessageChunk[] = [];
    let failureCategory: FailureCategory = null;
    try {
      for await (const chunk of provider.sendQuery(
        resumeChallengePrompt(input.kind, input.seedToken),
        input.cwd,
        input.sessionId,
        {
          env: input.env,
        }
      )) {
        chunks.push(chunk);
      }
    } catch (error: unknown) {
      failureCategory = classifyFailure(error);
    }

    const result = [...chunks].reverse().find(chunk => chunk.type === 'result');
    const observedId =
      result && 'sessionId' in result && typeof result.sessionId === 'string'
        ? result.sessionId
        : null;
    const sameId = observedId === input.sessionId;
    const isError =
      result !== undefined && 'isError' in result && result.isError === true ? true : false;
    const reachedAgentEnd = result !== undefined && !isError && failureCategory === null;
    return {
      sameId,
      reachedAgentEnd,
      contextProved: assistantTextProvesYes(chunks),
      sessionIdHash: observedId ? hashOpaque(observedId) : null,
      failureCategory,
    };
  };

  const first = await attempt();
  if (first.sameId && first.reachedAgentEnd && first.contextProved) return first;
  // One retry — model wording on the boolean challenge can miss once without
  // implying session loss (sameId/agent_end already prove resume mechanics).
  if (first.sameId && first.reachedAgentEnd && !first.contextProved) {
    const second = await attempt();
    if (second.contextProved || second.failureCategory) return second;
    return { ...first, contextProved: second.contextProved };
  }
  return first;
}

/**
 * OMP does not flush a session file when SIGTERM lands mid-first-assistant-message
 * on a brand-new session (session id is emitted, but --resume cannot find it).
 * Seed one short completed turn first so the interrupted generation rides a
 * real on-disk session — matching multi-turn production nodes.
 */
async function seedAssistantSession(input: {
  cwd: string;
  env: Record<string, string>;
  seedToken: string;
}): Promise<{ sessionId: string | null; failureCategory: FailureCategory }> {
  const provider = new OmpProvider();
  let sessionId: string | null = null;
  try {
    for await (const chunk of provider.sendQuery(
      assistantSeedPrompt(input.seedToken),
      input.cwd,
      undefined,
      {
        env: input.env,
      }
    )) {
      if (
        chunk.type === 'result' &&
        'sessionId' in chunk &&
        typeof chunk.sessionId === 'string' &&
        chunk.sessionId.length > 0 &&
        chunk.isError !== true
      ) {
        sessionId = chunk.sessionId;
      }
    }
  } catch (error: unknown) {
    return { sessionId: null, failureCategory: classifyFailure(error) };
  }
  return { sessionId, failureCategory: null };
}

/**
 * Provider conformance through the real OmpProvider interruptSignal path.
 * Spike-only teeing spawner records event types and trigger timing without
 * changing production parsing.
 */
async function runProviderConformanceCase(input: {
  kind: CaseKind;
  binaryPath: string;
  cwd: string;
  env: Record<string, string>;
}): Promise<ConformanceCaseEvidence> {
  if (!providerInterruptSeamReady()) {
    return skippedConformance(
      input.kind,
      'OmpProvider interruptSignal seam not implemented (awaiting US-002)'
    );
  }

  const evidence = emptyConformance(input.kind);
  const marker = `${TOOL_PID_MARKER_PREFIX}${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const pidFileName = `${marker}.pid`;
  const pidFilePath = join(input.cwd, pidFileName);
  const prompt =
    input.kind === 'assistant-text' ? assistantPrompt() : toolPrompt(pidFileName, marker);
  const providerEnv = {
    ...input.env,
    OMP_BIN_PATH: input.binaryPath,
  };

  // Seed a flushed session first. OMP emits a session id on a brand-new
  // mid-text SIGTERM but does not write the session file, so --resume fails.
  // A one-turn seed matches multi-turn production nodes and gives a stable
  // boolean context token for the post-interrupt resume challenge.
  let resumeSessionId: string | undefined;
  const seedToken = `T${randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`;
  {
    const seeded = await seedAssistantSession({
      cwd: input.cwd,
      env: providerEnv,
      seedToken,
    });
    if (seeded.failureCategory) evidence.failureCategory = seeded.failureCategory;
    if (!seeded.sessionId) {
      evidence.failReasons = ['seed_session_failed'];
      evidence.pass = false;
      return evidence;
    }
    resumeSessionId = seeded.sessionId;
  }

  const interrupt = new AbortController();
  const recordedEventTypes: string[] = [];
  const killSignals: NodeJS.Signals[] = [];
  let ompPid: number | null = null;
  let toolPid: number | null = null;
  let signalAt: number | null = null;
  let triggerFired = false;
  let sessionWasFirst: boolean | null = null;
  let firstEventSeen = false;
  let rawSessionId: string | null = null;

  const teeDrainTasks: Promise<void>[] = [];

  const teeingSpawner: OmpSpawner = (command, options: OmpSpawnOptions): OmpProcess => {
    const proc = Bun.spawn(command, {
      cwd: options.cwd,
      env: options.env,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });
    ompPid = proc.pid;

    if (!proc.stdout) {
      return {
        stdout: null,
        stderr: proc.stderr,
        exited: proc.exited,
        kill: (signal?: NodeJS.Signals): void => {
          const sig = signal ?? 'SIGTERM';
          killSignals.push(sig);
          proc.kill(sig);
        },
      };
    }

    const [providerStdout, recordStdout] = proc.stdout.tee();

    teeDrainTasks.push(
      (async (): Promise<void> => {
        try {
          for await (const line of streamLines(recordStdout)) {
            if (line.trim().length === 0) continue;
            const type = eventTypeOf(line) ?? 'unknown';
            recordedEventTypes.push(type);

            if (!firstEventSeen) {
              firstEventSeen = true;
              sessionWasFirst = type === 'session';
            }

            if (type === 'session' && rawSessionId === null) {
              const sid = sessionIdOf(line);
              if (sid) rawSessionId = sid;
            }

            if (triggerFired) continue;

            const shouldSignal =
              input.kind === 'assistant-text'
                ? isAssistantTextDelta(line)
                : isToolExecutionStart(line);

            if (!shouldSignal) continue;

            triggerFired = true;
            if (input.kind === 'active-tool') {
              toolPid = await waitForToolPid(pidFilePath, 1_500);
            }
            signalAt = Date.now();
            interrupt.abort();
          }
        } catch {
          // stream closed
        }
      })()
    );

    return {
      stdout: providerStdout,
      stderr: proc.stderr,
      exited: proc.exited,
      kill: (signal?: NodeJS.Signals): void => {
        const sig = signal ?? 'SIGTERM';
        killSignals.push(sig);
        try {
          proc.kill(sig);
        } catch {
          // already dead
        }
      },
    };
  };

  const provider = new OmpProvider({ spawn: teeingSpawner });
  const chunks: MessageChunk[] = [];
  let providerError: unknown = null;

  try {
    for await (const chunk of provider.sendQuery(prompt, input.cwd, resumeSessionId, {
      env: providerEnv,
      interruptSignal: interrupt.signal,
    })) {
      chunks.push(chunk);
    }
  } catch (error: unknown) {
    providerError = error;
    evidence.failureCategory = classifyFailure(error);
  }

  const providerReturnAt = Date.now();
  await Promise.all(teeDrainTasks.map(task => task.catch(() => undefined)));

  if (toolPid === null) toolPid = readToolPid(pidFilePath);
  if (ompPid !== null) {
    // Final safety reap of owned PIDs only — never broad pkill.
    if (isPidAlive(ompPid)) tryKill(ompPid, 'SIGKILL');
    if (toolPid !== null && isPidAlive(toolPid)) tryKill(toolPid, 'SIGKILL');
    await sleep(PROCESS_POLL_MS * 4);
  }

  const result = [...chunks].reverse().find(chunk => chunk.type === 'result');
  const resultSessionId =
    result && 'sessionId' in result && typeof result.sessionId === 'string'
      ? result.sessionId
      : rawSessionId;
  const terminalReason =
    result && 'terminalReason' in result && typeof result.terminalReason === 'string'
      ? result.terminalReason
      : null;
  const resultIsError =
    result !== undefined && 'isError' in result ? Boolean(result.isError) : null;

  evidence.recordedEventTypes = recordedEventTypes;
  evidence.sessionWasFirst = sessionWasFirst;
  evidence.sessionIdHash = resultSessionId ? hashOpaque(resultSessionId) : null;
  evidence.terminalReason = terminalReason;
  evidence.resultIsError = resultIsError;
  evidence.signalToProviderReturnMs =
    signalAt !== null ? Math.max(0, providerReturnAt - signalAt) : null;
  evidence.sigkillFired = killSignals.includes('SIGKILL');
  evidence.gracefulSigterm = killSignals.includes('SIGTERM') && !killSignals.includes('SIGKILL');
  evidence.ownedPids = ompPid !== null ? buildOwnedRecords(ompPid, toolPid) : [];
  evidence.noOwnedDescendantAlive =
    evidence.ownedPids.length > 0 && evidence.ownedPids.every(p => !p.aliveAfterProviderReturn);

  // Resume same-id + boolean context challenge (only when we have a real id).
  if (resultSessionId && terminalReason === STREAM_ABORTED_TERMINAL_REASON) {
    const resume = await runResumeChallenge({
      kind: input.kind,
      cwd: input.cwd,
      env: providerEnv,
      sessionId: resultSessionId,
      seedToken,
    });
    evidence.resumeSameId = resume.sameId;
    evidence.resumeReachedAgentEnd = resume.reachedAgentEnd;
    evidence.resumeContextProved = resume.contextProved;
    evidence.resumeSessionIdHash = resume.sessionIdHash;
    if (resume.failureCategory && evidence.failureCategory === null) {
      evidence.failureCategory = resume.failureCategory;
    }
  }

  const failReasons: string[] = [];
  if (providerError) failReasons.push('provider_threw');
  if (!triggerFired) failReasons.push('trigger_never_observed');
  if (sessionWasFirst !== true) failReasons.push('session_not_first');
  if (evidence.signalToProviderReturnMs === null) {
    failReasons.push('signal_to_return_unmeasured');
  } else if (evidence.signalToProviderReturnMs >= PROVIDER_RETURN_BUDGET_MS) {
    failReasons.push(`provider_return_over_budget_ms:${String(evidence.signalToProviderReturnMs)}`);
  }
  if (!evidence.gracefulSigterm) failReasons.push('not_graceful_sigterm');
  if (evidence.sigkillFired) failReasons.push('sigkill_fired');
  if (terminalReason !== STREAM_ABORTED_TERMINAL_REASON) {
    failReasons.push(`terminal_reason:${terminalReason ?? 'null'}`);
  }
  if (resultIsError === true) failReasons.push('result_is_error');
  if (!resultSessionId) failReasons.push('session_id_missing');
  if (!evidence.noOwnedDescendantAlive) failReasons.push('owned_descendant_alive');
  if (evidence.resumeSameId !== true) failReasons.push('resume_id_mismatch_or_missing');
  if (evidence.resumeReachedAgentEnd !== true) failReasons.push('resume_no_agent_end');
  if (evidence.resumeContextProved !== true) failReasons.push('resume_context_not_proved');

  evidence.failReasons = failReasons;
  evidence.pass = failReasons.length === 0;
  return evidence;
}

function evaluateGate(input: {
  platform: string;
  conformance: {
    assistantText: ConformanceCaseEvidence;
    activeTool: ConformanceCaseEvidence;
  };
  platformsCharacterized: string[];
}): OmpInterruptSpikeDocument['gate'] {
  const blockReasons: string[] = [];
  const thisPlatformPass =
    input.conformance.assistantText.pass && input.conformance.activeTool.pass;

  if (!input.conformance.assistantText.pass) {
    blockReasons.push(
      `assistant-text failed: ${input.conformance.assistantText.failReasons.join(',') || 'unknown'}`
    );
  }
  if (!input.conformance.activeTool.pass) {
    blockReasons.push(
      `active-tool failed: ${input.conformance.activeTool.failReasons.join(',') || 'unknown'}`
    );
  }

  const characterized = new Set(input.platformsCharacterized);
  const missing = RESOLVER_SUPPORTED_PLATFORMS.filter(p => !characterized.has(p));
  const allResolverPlatformsCovered = missing.length === 0;
  // No owner-scoped decision is on record in plan.md / prd — require full coverage.
  const ownerScopedPlatformDecisionRecorded = false;

  if (!allResolverPlatformsCovered && !ownerScopedPlatformDecisionRecorded) {
    blockReasons.push(
      `platform_coverage_incomplete: missing ${missing.join(',')} (no owner-scoped decision recorded)`
    );
  }

  const capabilityFlipAllowed =
    thisPlatformPass && (allResolverPlatformsCovered || ownerScopedPlatformDecisionRecorded);

  return {
    thisPlatformPass,
    allResolverPlatformsCovered,
    ownerScopedPlatformDecisionRecorded,
    capabilityFlipAllowed,
    blockReasons,
  };
}

async function runSpike(binaryPath: string): Promise<OmpInterruptSpikeDocument> {
  const ompVersion = readOmpVersion(binaryPath);
  const platform = process.platform;
  const arch = process.arch;
  const platformsCharacterized = [platform];
  const platformsUncharacterized = RESOLVER_SUPPORTED_PLATFORMS.filter(p => p !== platform);

  const document: OmpInterruptSpikeDocument = {
    schemaVersion: 1,
    leg: 'mixed',
    ompVersion,
    platform,
    arch,
    resolverSupportedPlatforms: RESOLVER_SUPPORTED_PLATFORMS,
    platformsCharacterized,
    platformsUncharacterized: [...platformsUncharacterized],
    interruptCapability: OMP_CAPABILITIES.interrupt,
    raw: { assistantText: null, activeTool: null },
    conformance: {
      assistantText: skippedConformance('assistant-text', 'not-run'),
      activeTool: skippedConformance('active-tool', 'not-run'),
    },
    gate: {
      thisPlatformPass: false,
      allResolverPlatformsCovered: false,
      ownerScopedPlatformDecisionRecorded: false,
      capabilityFlipAllowed: false,
      blockReasons: ['not-evaluated'],
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

    await runWithTimeout(EXPERIMENT_TIMEOUT_MS * 2, async () => {
      // Raw characterization remains useful context; conformance is the gate.
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

  document.gate = evaluateGate({
    platform,
    conformance: document.conformance,
    platformsCharacterized: document.platformsCharacterized,
  });
  // Reflect live capability constant (still false until a separate flip edit).
  document.interruptCapability = OMP_CAPABILITIES.interrupt;

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
    gate: {
      thisPlatformPass: false,
      allResolverPlatformsCovered: false,
      ownerScopedPlatformDecisionRecorded: false,
      capabilityFlipAllowed: false,
      blockReasons: ['binary unresolved'],
    },
    failureCategory: classifyFailure(error) ?? 'binary-missing',
  };
}

async function main(): Promise<void> {
  // Keep stdout to exactly one JSON document (CLI --json convention).
  setLogLevel('silent');

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
  const conformanceOk =
    document.conformance.assistantText.pass && document.conformance.activeTool.pass;

  // Exit 0 only when this-platform conformance passes (raw is supporting evidence).
  // Platform-wide capability flip is a separate production decision.
  if (!conformanceOk || document.failureCategory !== null) {
    process.exitCode = 1;
  } else if (!rawOk) {
    // Raw failed but conformance passed — still non-zero so operators notice.
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await main();
}
