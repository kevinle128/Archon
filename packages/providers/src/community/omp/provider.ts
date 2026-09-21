import { createLogger } from '@archon/paths';

import type {
  IAgentProvider,
  MessageChunk,
  ProviderCapabilities,
  SendQueryOptions,
  SystemPromptInput,
} from '../../types';
import { augmentPromptForJsonSchema } from '../../shared/structured-output';
import { resolveOmpBinaryPath } from './binary-resolver';
import { OMP_CAPABILITIES } from './capabilities';
import { parseOmpConfig, type OmpProviderDefaults } from './config';
import { OmpEventParser } from './event-parser';
import {
  collectHiddenSessionUsage,
  enrichResultWithHiddenUsage,
  snapshotHiddenSessionFiles,
  type SessionUsageSnapshot,
} from './session-usage';

const MAX_CAPTURE_CHARS = 1_000_000;
const TERMINATION_GRACE_MS = 5_000;
/** Bounded wait for a session header after operator Stop on a fresh turn. */
export const INTERRUPT_SESSION_HEADER_WAIT_MS = 500;

type TerminationCause =
  | 'interrupt'
  | 'interrupt-unresumable'
  | 'cancel'
  | 'transport'
  | 'protocol'
  | 'cleanup';

/** Test-only override so force-kill paths avoid a second real 5s wait. */
let terminationGraceMsForTest: number | undefined;

export function setTerminationGraceMsForTest(ms: number | undefined): void {
  terminationGraceMsForTest = ms;
}

function terminationGraceMs(): number {
  return terminationGraceMsForTest ?? TERMINATION_GRACE_MS;
}

let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  cachedLog ??= createLogger('provider.omp');
  return cachedLog;
}

export interface OmpProcess {
  stdout: ReadableStream<Uint8Array> | null;
  stderr: ReadableStream<Uint8Array> | null;
  exited: Promise<number>;
  kill: (signal?: NodeJS.Signals) => void;
}

export interface OmpSpawnOptions {
  cwd: string;
  env: Record<string, string>;
}

export type OmpSpawner = (command: string[], options: OmpSpawnOptions) => OmpProcess;

interface BuildOmpArgsInput {
  prompt: string;
  cwd: string;
  config: OmpProviderDefaults;
  requestOptions?: SendQueryOptions;
  resumeSessionId?: string;
}

interface BuildOmpArgsResult {
  args: string[];
  model?: string;
  thinking?: string;
}

type ProcessOutcome<T> = { ok: true; value: T } | { ok: false; error: Error };

function defaultSpawner(command: string[], options: OmpSpawnOptions): OmpProcess {
  const proc = Bun.spawn(command, {
    cwd: options.cwd,
    env: options.env,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    stdout: proc.stdout,
    stderr: proc.stderr,
    exited: proc.exited,
    kill: (signal?: NodeJS.Signals): void => {
      proc.kill(signal);
    },
  };
}

function buildProviderEnv(requestEnv?: Record<string, string>): Record<string, string> {
  const baseEnv = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );
  return { ...baseEnv, ...(requestEnv ?? {}) };
}

function buildSpawnCommand(binaryPath: string, args: string[]): string[] {
  if (process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(binaryPath)) {
    return ['cmd.exe', '/d', '/s', '/c', binaryPath, ...args];
  }
  return [binaryPath, ...args];
}

function resolveSystemPrompt(
  input: SystemPromptInput | undefined
): { flag: '--system-prompt' | '--append-system-prompt'; value: string } | undefined {
  if (typeof input === 'string') {
    return input.length > 0 ? { flag: '--system-prompt', value: input } : undefined;
  }
  if (Array.isArray(input)) {
    const value = input.filter(part => part.length > 0).join('\n\n');
    return value.length > 0 ? { flag: '--system-prompt', value } : undefined;
  }
  if (input?.type === 'preset' && typeof input.append === 'string' && input.append.length > 0) {
    return { flag: '--append-system-prompt', value: input.append };
  }
  return undefined;
}

function resolveThinking(
  requestOptions: SendQueryOptions | undefined,
  config: OmpProviderDefaults
): string | undefined {
  const rawThinking = requestOptions?.nodeConfig?.thinking;
  if (typeof rawThinking === 'string') {
    if (rawThinking.length === 0) throw new Error('OMP thinking must be a non-empty string.');
    return rawThinking;
  }
  const rawEffort = requestOptions?.nodeConfig?.effort;
  if (typeof rawEffort === 'string') {
    if (rawEffort.length === 0) throw new Error('OMP effort must be a non-empty string.');
    return rawEffort;
  }
  return config.modelReasoningEffort;
}

export function buildOmpArgs(input: BuildOmpArgsInput): BuildOmpArgsResult {
  if (input.resumeSessionId && input.requestOptions?.persistSession === false) {
    throw new Error('OMP cannot resume a session when persistSession is false.');
  }

  const args = ['--mode', 'json', '--cwd', input.cwd, '--yolo', '--no-title'];
  if (input.config.enableExtensions !== true) args.push('--no-extensions');

  const model = input.requestOptions?.model ?? input.config.model;
  if (model) args.push('--model', model);

  const thinking = resolveThinking(input.requestOptions, input.config);
  if (thinking) args.push('--thinking', thinking);

  const systemPrompt = resolveSystemPrompt(
    input.requestOptions?.systemPrompt ?? input.requestOptions?.nodeConfig?.systemPrompt
  );
  if (systemPrompt) args.push(systemPrompt.flag, systemPrompt.value);

  const skills = input.requestOptions?.nodeConfig?.skills;
  if (skills && skills.length > 0) args.push('--skills', skills.join(','));

  if (input.requestOptions?.persistSession === false) args.push('--no-session');
  else if (input.resumeSessionId) {
    args.push(input.requestOptions?.forkSession === true ? '--fork' : '--resume');
    args.push(input.resumeSessionId);
  }

  args.push('--', input.prompt);
  return { args, model, thinking };
}

async function readStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return '';
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = '';
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (output.length < MAX_CAPTURE_CHARS) {
        output += decoder
          .decode(next.value, { stream: true })
          .slice(0, MAX_CAPTURE_CHARS - output.length);
      }
    }
    if (output.length < MAX_CAPTURE_CHARS) {
      output += decoder.decode().slice(0, MAX_CAPTURE_CHARS - output.length);
    }
    return output;
  } finally {
    reader.releaseLock();
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

function scheduleKill(proc: OmpProcess, onSigkill: () => void): ReturnType<typeof setTimeout> {
  proc.kill('SIGTERM');
  return setTimeout(() => {
    onSigkill();
    proc.kill('SIGKILL');
  }, terminationGraceMs());
}

/**
 * Interrupted-result `resumed` only. Ordinary resume requires id equality;
 * fork requires an observed session header; no request omits the field.
 */
function interruptedResumed(
  resumeSessionId: string | undefined,
  forkSession: boolean | undefined,
  observedSessionId: string | undefined
): boolean | undefined {
  if (resumeSessionId === undefined) return undefined;
  if (forkSession === true) return observedSessionId !== undefined;
  return observedSessionId !== undefined && observedSessionId === resumeSessionId;
}

function buildExitErrorMessage(exitCode: number, stderr: string): string {
  const detail = stderr.trim().slice(0, 1000);
  const lower = detail.toLowerCase();
  if (
    lower.includes('credential') ||
    lower.includes('authenticated model') ||
    lower.includes('/login')
  ) {
    return (
      'OMP CLI is not ready for headless use. Run `omp setup` or start `omp` and complete ' +
      '`/login`, then retry.' +
      (detail ? ` OMP said: ${detail}` : '')
    );
  }
  return detail
    ? `OMP CLI exited with code ${String(exitCode)}: ${detail}`
    : `OMP CLI exited with code ${String(exitCode)}.`;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function buildTransportErrorResult(
  parser: OmpEventParser,
  errorSubtype: 'omp_protocol_error' | 'omp_exit_nonzero' | 'omp_transport_error',
  message: string,
  resumeRequested: boolean
): MessageChunk {
  const observed = parser.buildResult(resumeRequested ? false : undefined);
  return {
    ...observed,
    type: 'result',
    isError: true,
    errorSubtype,
    errors: [message, ...(observed.errors ?? []).filter(error => error !== message)],
  };
}

function hasAuthoritativeUsage(result: MessageChunk): boolean {
  return (
    result.type === 'result' &&
    Array.isArray(result.usageBreakdown) &&
    result.usageBreakdown.length > 0
  );
}

async function maybeEnrichResult(
  result: MessageChunk,
  options: {
    env: Record<string, string>;
    cwd: string;
    noSession: boolean;
    snapshot: SessionUsageSnapshot | null | undefined;
  }
): Promise<MessageChunk> {
  if (result.type !== 'result') return result;
  const sessionId = result.sessionId;
  if (!sessionId || options.noSession) return result;
  try {
    const hidden = await collectHiddenSessionUsage({
      env: options.env,
      cwd: options.cwd,
      sessionId,
      noSession: options.noSession,
      snapshot: options.snapshot,
    });
    if (!hidden || hidden.entries.length === 0) return result;
    return enrichResultWithHiddenUsage(result, hidden);
  } catch (error: unknown) {
    getLog().warn(
      {
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : typeof error,
      },
      'omp.session_usage_enrich_failed'
    );
    return result;
  }
}

export class OmpProvider implements IAgentProvider {
  private readonly spawn: OmpSpawner;

  constructor(options?: { spawn?: OmpSpawner }) {
    this.spawn = options?.spawn ?? defaultSpawner;
  }

  getType(): string {
    return 'omp';
  }

  getCapabilities(): ProviderCapabilities {
    return OMP_CAPABILITIES;
  }

  async *sendQuery(
    prompt: string,
    cwd: string,
    resumeSessionId?: string,
    requestOptions?: SendQueryOptions
  ): AsyncGenerator<MessageChunk> {
    if (requestOptions?.abortSignal?.aborted) throw new Error('Query aborted');

    const config = parseOmpConfig(requestOptions?.assistantConfig ?? {});
    const env = buildProviderEnv(requestOptions?.env);
    const binaryPath = await resolveOmpBinaryPath(config.ompBinaryPath, env);
    const outputFormat = requestOptions?.outputFormat;
    const wantsStructured = outputFormat?.type === 'json_schema';
    const effectivePrompt = wantsStructured
      ? augmentPromptForJsonSchema(prompt, outputFormat.schema)
      : prompt;
    const { args, model, thinking } = buildOmpArgs({
      prompt: effectivePrompt,
      cwd,
      config,
      requestOptions,
      resumeSessionId,
    });

    const rawThinking = requestOptions?.nodeConfig?.thinking;
    if (rawThinking !== null && typeof rawThinking === 'object') {
      yield {
        type: 'system',
        content:
          '⚠️ Warning: OMP ignored object-form `thinking`; use a string `thinking` or provider-owned `effort` value.',
      };
    }

    const command = buildSpawnCommand(binaryPath, args);
    getLog().info(
      {
        cwd,
        model,
        thinking,
        resumed: resumeSessionId !== undefined,
        forked: requestOptions?.forkSession === true,
      },
      'omp.query_started'
    );

    const noSession = requestOptions?.persistSession === false;
    // Resume/fork need a pre-spawn snapshot so copied history is not double-counted.
    // null = snapshot failed → skip hidden enrichment after exit; undefined = fresh run.
    let snapshot: SessionUsageSnapshot | null | undefined;
    if (!noSession && resumeSessionId) {
      try {
        snapshot = await snapshotHiddenSessionFiles({
          env,
          cwd,
          resumeSessionId,
        });
      } catch (error: unknown) {
        getLog().warn(
          {
            error: error instanceof Error ? error.message : String(error),
            errorType: error instanceof Error ? error.constructor.name : typeof error,
          },
          'omp.session_usage_snapshot_failed'
        );
        snapshot = null;
      }
    }

    const parser = new OmpEventParser(wantsStructured);
    const proc = this.spawn(command, { cwd, env });
    const abortSignal = requestOptions?.abortSignal;
    const interruptSignal = requestOptions?.interruptSignal;
    let processExited = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let headerWaitTimer: ReturnType<typeof setTimeout> | undefined;
    let terminationCause: TerminationCause | undefined;
    let sigkillFired = false;
    let pendingInterrupt = false;
    let protocolError: Error | undefined;
    let transportError: Error | undefined;

    const clearKillTimer = (): void => {
      if (!killTimer) return;
      clearTimeout(killTimer);
      killTimer = undefined;
    };
    const clearHeaderWait = (): void => {
      if (!headerWaitTimer) return;
      clearTimeout(headerWaitTimer);
      headerWaitTimer = undefined;
    };
    const recordCause = (cause: TerminationCause): boolean => {
      if (terminationCause !== undefined) return false;
      terminationCause = cause;
      return true;
    };
    const scheduleTerminate = (): void => {
      if (processExited || killTimer) return;
      killTimer = scheduleKill(proc, () => {
        sigkillFired = true;
      });
    };
    const claimInterruptOwnership = (): void => {
      if (parser.hasNaturalTurnEnded()) return;
      if (parser.hasSession()) {
        pendingInterrupt = false;
        clearHeaderWait();
        if (recordCause('interrupt')) {
          parser.beginOperatorInterrupt();
          scheduleTerminate();
        }
        return;
      }
      if (parser.hasTurnActivity()) {
        pendingInterrupt = false;
        clearHeaderWait();
        if (recordCause('interrupt-unresumable')) scheduleTerminate();
        return;
      }
      // No session yet and no turn activity — defer until header or deadline.
      pendingInterrupt = true;
      if (headerWaitTimer) return;
      headerWaitTimer = setTimeout(() => {
        headerWaitTimer = undefined;
        if (!pendingInterrupt) return;
        pendingInterrupt = false;
        if (parser.hasSession()) {
          claimInterruptOwnership();
          return;
        }
        if (recordCause('interrupt-unresumable')) scheduleTerminate();
      }, INTERRUPT_SESSION_HEADER_WAIT_MS);
    };
    const onAbort = (): void => {
      // Cancel wins final classification whenever aborted, even if Stop fired first.
      if (
        terminationCause === undefined ||
        terminationCause === 'interrupt' ||
        terminationCause === 'interrupt-unresumable'
      ) {
        terminationCause = 'cancel';
      }
      pendingInterrupt = false;
      clearHeaderWait();
      scheduleTerminate();
    };
    const onInterrupt = (): void => {
      if (abortSignal?.aborted) return;
      claimInterruptOwnership();
    };
    const afterParsedLine = (): void => {
      if (!pendingInterrupt) return;
      if (parser.hasSession() || parser.hasTurnActivity()) {
        claimInterruptOwnership();
      }
    };
    const exitOutcomePromise = proc.exited.then<ProcessOutcome<number>, ProcessOutcome<number>>(
      exitCode => {
        processExited = true;
        clearKillTimer();
        clearHeaderWait();
        pendingInterrupt = false;
        // A non-zero child exit is a real provider failure.  Record it before
        // a later Stop listener can claim the already-dead process as its own.
        if (exitCode !== 0) recordCause('transport');
        return { ok: true, value: exitCode };
      },
      (error: unknown) => {
        const normalized = toError(error);
        transportError ??= normalized;
        recordCause('transport');
        scheduleTerminate();
        return { ok: false, error: normalized };
      }
    );
    const stderrOutcomePromise = readStream(proc.stderr).then<
      ProcessOutcome<string>,
      ProcessOutcome<string>
    >(
      stderr => ({ ok: true, value: stderr }),
      (error: unknown) => {
        const normalized = toError(error);
        transportError ??= normalized;
        recordCause('transport');
        scheduleTerminate();
        return { ok: false, error: normalized };
      }
    );

    if (abortSignal) {
      if (abortSignal.aborted) onAbort();
      else abortSignal.addEventListener('abort', onAbort, { once: true });
    }
    // No pre-aborted no-spawn guard for interruptSignal — fresh-turn Stop still spawns.
    if (interruptSignal) {
      if (interruptSignal.aborted) onInterrupt();
      else interruptSignal.addEventListener('abort', onInterrupt, { once: true });
    }

    try {
      try {
        for await (const line of streamLines(proc.stdout)) {
          if (line.trim().length === 0) continue;
          try {
            const chunks = parser.consumeLine(line);
            // Fire pending interrupt as soon as the header is consumed, before yielding work.
            afterParsedLine();
            for (const chunk of chunks) yield chunk;
          } catch (error: unknown) {
            // Interrupt-owned truncated JSON / protocol noise after SIGTERM stays graceful.
            if (terminationCause === 'interrupt') break;
            protocolError = toError(error);
            recordCause('protocol');
            scheduleTerminate();
            break;
          }
        }
      } catch (error: unknown) {
        if (terminationCause !== 'interrupt') {
          transportError ??= toError(error);
          recordCause('transport');
          scheduleTerminate();
        }
      }

      const [exitOutcome, stderrOutcome] = await Promise.all([
        exitOutcomePromise,
        stderrOutcomePromise,
      ]);
      // Cancel dominates final classification whenever the node abort fired.
      if (abortSignal?.aborted) throw new Error('Query aborted');

      const enrichOptions = { env, cwd, noSession, snapshot };
      const resumedForInterrupt = interruptedResumed(
        resumeSessionId,
        requestOptions?.forkSession,
        parser.getSessionId()
      );

      // SIGKILL during an interrupt attempt → unmarked force-kill error (never idle).
      if (
        sigkillFired &&
        (terminationCause === 'interrupt' || terminationCause === 'interrupt-unresumable')
      ) {
        for (const chunk of parser.drainPendingAssistant()) yield chunk;
        yield await maybeEnrichResult(
          parser.buildForceKilledResult(resumedForInterrupt),
          enrichOptions
        );
        return;
      }

      if (terminationCause === 'interrupt-unresumable') {
        for (const chunk of parser.drainPendingAssistant()) yield chunk;
        yield parser.buildSessionUnavailableResult();
        return;
      }

      if (terminationCause === 'interrupt') {
        // Drain pending assistant → one marked result → fail-soft usage enrich → return (no throw).
        for (const chunk of parser.drainPendingAssistant()) yield chunk;
        yield await maybeEnrichResult(
          parser.buildInterruptedResult(resumedForInterrupt),
          enrichOptions
        );
        getLog().info({ sessionId: parser.getSessionId() }, 'omp.query_interrupted');
        return;
      }

      // Late I/O after the parser already accepted authoritative usage must
      // yield one terminal isError result (not throw) so the executor can
      // record spend before failing the node. No-usage I/O still throws.
      const lateIoError =
        transportError ??
        (!exitOutcome.ok ? exitOutcome.error : undefined) ??
        (!stderrOutcome.ok ? stderrOutcome.error : undefined);
      if (lateIoError) {
        const observed = parser.buildResult(resumeSessionId !== undefined ? false : undefined);
        if (hasAuthoritativeUsage(observed)) {
          const message = lateIoError.message;
          yield { type: 'system', content: message };
          yield await maybeEnrichResult(
            buildTransportErrorResult(
              parser,
              'omp_transport_error',
              message,
              resumeSessionId !== undefined
            ),
            enrichOptions
          );
          return;
        }
        throw lateIoError;
      }
      // lateIoError already covered both failure arms; re-check to narrow the union.
      if (!exitOutcome.ok) throw exitOutcome.error;
      if (!stderrOutcome.ok) throw stderrOutcome.error;

      if (protocolError) {
        const message = protocolError.message;
        yield { type: 'system', content: message };
        yield await maybeEnrichResult(
          buildTransportErrorResult(
            parser,
            'omp_protocol_error',
            message,
            resumeSessionId !== undefined
          ),
          enrichOptions
        );
        return;
      }

      if (exitOutcome.value !== 0) {
        const message = buildExitErrorMessage(exitOutcome.value, stderrOutcome.value);
        yield { type: 'system', content: message };
        yield await maybeEnrichResult(
          buildTransportErrorResult(
            parser,
            'omp_exit_nonzero',
            message,
            resumeSessionId !== undefined
          ),
          enrichOptions
        );
        return;
      }

      yield await maybeEnrichResult(
        parser.buildResult(resumeSessionId === undefined ? undefined : true),
        enrichOptions
      );
      getLog().info({ sessionId: parser.getSessionId() }, 'omp.query_completed');
    } finally {
      if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
      if (interruptSignal) interruptSignal.removeEventListener('abort', onInterrupt);
      clearHeaderWait();
      pendingInterrupt = false;
      if (!processExited) {
        recordCause('cleanup');
        scheduleTerminate();
      }
      await Promise.all([exitOutcomePromise, stderrOutcomePromise]);
      if (processExited) clearKillTimer();
    }
  }
}
