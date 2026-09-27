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
  OmpRpcSession,
  RpcFrameParseError,
  handleOutOfBandFrame,
  performReadyHandshakeAndGetSessionId,
  spawnOmpRpcSession,
  defaultRpcSpawner,
  type OmpRpcSpawner,
  type RpcFrame,
} from './rpc-transport';
import {
  collectHiddenSessionUsage,
  enrichResultWithHiddenUsage,
  snapshotHiddenSessionFiles,
  type SessionUsageSnapshot,
} from './session-usage';

export type { OmpRpcProcess, OmpRpcSpawnOptions, OmpRpcSpawner } from './rpc-transport';

const TERMINATION_GRACE_MS = 5_000;
const READY_TIMEOUT_MS = 15_000;
const GET_STATE_TIMEOUT_MS = 15_000;
/**
 * How long a warm `--mode rpc` process is kept alive with no new turn before
 * it is closed. Must exceed the workflow engine's own operator-redirect
 * window (`STEERING_IDLE_AWAIT_INACTIVITY_MS`, 30 minutes,
 * packages/workflows/src/steering-registry.ts) — otherwise a Stop that the
 * operator is slow to redirect would evict the very process this transport
 * exists to keep warm, silently falling back to (still correct, but
 * slower and now merely disk-resumable) fresh-spawn `--resume`. `@archon/providers`
 * cannot import that constant (workflows depends on providers, not the
 * reverse), so this is a deliberately generous, independently-chosen margin
 * rather than a shared value — revisit both together if either changes.
 */
const WARM_SESSION_IDLE_EVICTION_MS = 40 * 60_000;

/** Test-only override so force-kill paths avoid a real 5s wait. */
let terminationGraceMsForTest: number | undefined;

export function setTerminationGraceMsForTest(ms: number | undefined): void {
  terminationGraceMsForTest = ms;
}

function terminationGraceMs(): number {
  return terminationGraceMsForTest ?? TERMINATION_GRACE_MS;
}

/** Test-only override so idle-eviction tests do not wait 40 real minutes. */
let idleEvictionMsForTest: number | undefined;

export function setWarmSessionIdleEvictionMsForTest(ms: number | undefined): void {
  idleEvictionMsForTest = ms;
}

function warmSessionIdleEvictionMs(): number {
  return idleEvictionMsForTest ?? WARM_SESSION_IDLE_EVICTION_MS;
}

let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  cachedLog ??= createLogger('provider.omp');
  return cachedLog;
}

export interface OmpSpawnOptions {
  cwd: string;
  env: Record<string, string>;
}

interface BuildOmpArgsInput {
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

/**
 * Builds the argv for a `--mode rpc` OMP child. Unlike the retired `--mode
 * json` transport, the prompt travels over stdin as a `{type:"prompt"}`
 * frame — never in argv — so a fresh turn on an already-warm process needs
 * no args at all.
 */
export function buildOmpArgs(input: BuildOmpArgsInput): BuildOmpArgsResult {
  if (input.resumeSessionId && input.requestOptions?.persistSession === false) {
    throw new Error('OMP cannot resume a session when persistSession is false.');
  }

  const args = ['--mode', 'rpc', '--cwd', input.cwd, '--yolo', '--no-title'];
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

  return { args, model, thinking };
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

/**
 * Interrupted-result `resumed` only. Ordinary resume requires id equality;
 * fork requires an observed session id; no request omits the field.
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

function assistantMessageStopReason(frame: RpcFrame): string | undefined {
  const message = frame.message;
  if (typeof message !== 'object' || message === null) return undefined;
  const record = message as { role?: unknown; stopReason?: unknown };
  if (record.role !== 'assistant') return undefined;
  return typeof record.stopReason === 'string' ? record.stopReason : undefined;
}

/** Classification outcome of one turn's drain loop. */
type DrainOutcome =
  | { kind: 'natural' }
  | { kind: 'interrupted' }
  | { kind: 'protocol'; error: Error }
  | { kind: 'transport'; error: Error };

/** Bounded escalation kill for a warm session (operator Cancel — no attempt at a clean exit). */
function scheduleHardKill(
  session: OmpRpcSession,
  onSigkill: () => void
): ReturnType<typeof setTimeout> {
  session.kill('SIGTERM');
  return setTimeout(() => {
    onSigkill();
    session.kill('SIGKILL');
  }, terminationGraceMs());
}

export class OmpProvider implements IAgentProvider {
  private readonly spawn: OmpRpcSpawner;
  private warmSession: OmpRpcSession | undefined;
  private evictionTimer: ReturnType<typeof setTimeout> | undefined;
  private cancelListenerSignal: AbortSignal | undefined;

  constructor(options?: { spawn?: OmpRpcSpawner }) {
    this.spawn = options?.spawn ?? defaultRpcSpawner;
  }

  getType(): string {
    return 'omp';
  }

  getCapabilities(): ProviderCapabilities {
    return OMP_CAPABILITIES;
  }

  private disarmEviction(): void {
    if (!this.evictionTimer) return;
    clearTimeout(this.evictionTimer);
    this.evictionTimer = undefined;
  }

  private armEviction(): void {
    this.disarmEviction();
    if (!this.warmSession) return;
    this.evictionTimer = setTimeout(() => {
      getLog().info({ sessionId: this.warmSession?.sessionId }, 'omp.warm_session_idle_evicted');
      this.disposeWarmSession('idle-timeout');
    }, warmSessionIdleEvictionMs());
  }

  /** Called once a turn ends without error: keep the session warm, unless it was ephemeral. */
  private finishTurnKeepWarm(noSession: boolean): void {
    if (noSession) this.disposeWarmSession('ephemeral');
    else this.armEviction();
  }

  /** Tears down the current warm session, if any. Idempotent; safe with no session. */
  private disposeWarmSession(
    reason: 'cancel' | 'mismatch' | 'idle-timeout' | 'crash' | 'ephemeral'
  ): void {
    this.disarmEviction();
    const session = this.warmSession;
    this.warmSession = undefined;
    if (!session || session.disposed) return;
    if (reason === 'cancel' || reason === 'crash') {
      // A process that just proved its protocol stream unreliable, or that
      // Cancel means to abandon outright, is not worth a graceful stdin-close.
      scheduleHardKill(session, () => undefined);
    } else {
      void session.closeGracefully(terminationGraceMs());
    }
  }

  /**
   * Registers exactly one Cancel listener per node execution. `abortSignal`
   * is the same `AbortController.signal` reused by the dag-executor across
   * every turn of one node (fresh only per node, not per turn) — a single
   * listener kills the warm session even while it is idling between turns,
   * with no dispose()/cancel() hook needed on `IAgentProvider`.
   */
  private ensureCancelListener(abortSignal: AbortSignal | undefined): void {
    if (!abortSignal || this.cancelListenerSignal === abortSignal) return;
    this.cancelListenerSignal = abortSignal;
    if (abortSignal.aborted) {
      this.disposeWarmSession('cancel');
      return;
    }
    abortSignal.addEventListener(
      'abort',
      () => {
        this.disposeWarmSession('cancel');
      },
      { once: true }
    );
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

    const rawThinking = requestOptions?.nodeConfig?.thinking;
    if (rawThinking !== null && typeof rawThinking === 'object') {
      yield {
        type: 'system',
        content:
          '⚠️ Warning: OMP ignored object-form `thinking`; use a string `thinking` or provider-owned `effort` value.',
      };
    }

    const abortSignal = requestOptions?.abortSignal;
    const interruptSignal = requestOptions?.interruptSignal;
    const noSession = requestOptions?.persistSession === false;
    this.ensureCancelListener(abortSignal);
    // Binary resolution above awaited — re-check before spawning anything.
    if (abortSignal?.aborted) throw new Error('Query aborted');

    const warmSession = this.warmSession;
    const reusable =
      warmSession !== undefined &&
      !warmSession.disposed &&
      !noSession &&
      requestOptions?.forkSession !== true &&
      resumeSessionId !== undefined &&
      warmSession.sessionId === resumeSessionId;

    let session: OmpRpcSession;
    if (reusable && warmSession !== undefined) {
      session = warmSession;
      this.disarmEviction();
    } else {
      if (this.warmSession) this.disposeWarmSession('mismatch');
      const { args, model, thinking } = buildOmpArgs({
        cwd,
        config,
        requestOptions,
        resumeSessionId,
      });
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
      session = await spawnOmpRpcSession(this.spawn, command, { cwd, env });
      // Registered as the Cancel target IMMEDIATELY — a Cancel that fires
      // during the handshake below must still find and kill this process,
      // even for an ephemeral (`--no-session`) request (cleared below once
      // the call's outcome is known).
      this.warmSession = session;
      try {
        const sessionId = await performReadyHandshakeAndGetSessionId(
          session,
          READY_TIMEOUT_MS,
          GET_STATE_TIMEOUT_MS
        );
        session.sessionId = sessionId;
      } catch (error: unknown) {
        this.warmSession = undefined;
        session.kill('SIGKILL');
        throw toError(error);
      }
    }

    // Resume/fork need a pre-spawn snapshot so copied history is not double-counted.
    // null = snapshot failed → skip hidden enrichment after exit; undefined = fresh session.
    let snapshot: SessionUsageSnapshot | null | undefined;
    if (!noSession && resumeSessionId) {
      try {
        snapshot = await snapshotHiddenSessionFiles({ env, cwd, resumeSessionId });
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
    // `--mode rpc` never emits the `session` header frame `--mode json` does
    // (verified against the real binary) — seed the parser's existing
    // extension point with the id already known from get_state/reuse,
    // through the exact event shape it already handles for `--mode json`.
    parser.consumeLine(JSON.stringify({ type: 'session', id: session.sessionId }));

    let interruptSent = false;
    const onInterrupt = (): void => {
      if (abortSignal?.aborted) return; // Cancel wins final classification.
      if (parser.hasNaturalTurnEnded()) return; // Raced a natural end — not an interrupt.
      if (interruptSent) return;
      interruptSent = true;
      parser.beginOperatorInterrupt();
      // The abort command's own JSON-RPC response is unreliable (verified
      // against the real binary: never observed to echo back by id across
      // repeated runs) — stamped with an id anyway for OMP's own
      // diagnostics, but classification never waits on or reads it.
      session.writeFrame({ id: crypto.randomUUID(), type: 'abort' });
    };
    if (interruptSignal) {
      if (interruptSignal.aborted) onInterrupt();
      else interruptSignal.addEventListener('abort', onInterrupt, { once: true });
    }

    const enrichOptions = { env, cwd, noSession, snapshot };
    const resumedForInterrupt = interruptedResumed(
      resumeSessionId,
      requestOptions?.forkSession,
      session.sessionId
    );

    try {
      const promptId = crypto.randomUUID();
      session.writeFrame({ id: promptId, type: 'prompt', message: effectivePrompt });

      let observedAbortedStopReason = false;
      let outcome: DrainOutcome | undefined;

      while (outcome === undefined) {
        let next: { frame: RpcFrame } | { exited: number };
        try {
          next = await session.nextFrameOrExit();
        } catch (error: unknown) {
          // A malformed frame on the wire is a protocol error; any other
          // stream failure (I/O, decode) is a transport error.
          outcome =
            error instanceof RpcFrameParseError
              ? { kind: 'protocol', error }
              : { kind: 'transport', error: toError(error) };
          break;
        }
        if ('exited' in next) {
          const stderr = session.stderrSnapshot();
          const message =
            next.exited === 0
              ? 'OMP RPC CLI exited unexpectedly while a turn was in progress.'
              : buildExitErrorMessage(next.exited, stderr);
          outcome = { kind: 'transport', error: new Error(message) };
          break;
        }
        const frame = next.frame;
        if (frame.type === 'response' && frame.id === promptId) {
          if (frame.success !== true) {
            outcome = {
              kind: 'protocol',
              error: new Error(
                `OMP RPC CLI rejected the prompt request: ${String((frame as { error?: unknown }).error)}`
              ),
            };
            break;
          }
          continue;
        }
        if (interruptSent && assistantMessageStopReason(frame) === 'aborted') {
          observedAbortedStopReason = true;
        }
        try {
          handleOutOfBandFrame(session, frame);
        } catch (error: unknown) {
          outcome = { kind: 'protocol', error: toError(error) };
          break;
        }
        try {
          for (const chunk of parser.consumeLine(JSON.stringify(frame))) yield chunk;
        } catch (error: unknown) {
          outcome = { kind: 'protocol', error: toError(error) };
          break;
        }
        if (parser.hasNaturalTurnEnded()) {
          outcome =
            interruptSent && observedAbortedStopReason
              ? { kind: 'interrupted' }
              : { kind: 'natural' };
        }
      }
      // Every loop exit sets `outcome` before `break`; narrow explicitly
      // rather than relying on TS to see that through the while-condition.
      if (outcome === undefined)
        throw new Error('OMP RPC drain loop exited without a classification.');

      if (abortSignal?.aborted) throw new Error('Query aborted');

      if (outcome.kind === 'interrupted') {
        this.finishTurnKeepWarm(noSession);
        for (const chunk of parser.drainPendingText()) yield chunk;
        yield await maybeEnrichResult(
          parser.buildInterruptedResult(resumedForInterrupt),
          enrichOptions
        );
        getLog().info({ sessionId: session.sessionId }, 'omp.query_interrupted');
        return;
      }

      if (outcome.kind === 'protocol') {
        this.disposeWarmSession('crash');
        const message = outcome.error.message;
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

      if (outcome.kind === 'transport') {
        this.disposeWarmSession('crash');
        const observed = parser.buildResult(resumeSessionId !== undefined ? false : undefined);
        if (hasAuthoritativeUsage(observed)) {
          const message = outcome.error.message;
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
        throw outcome.error;
      }

      // Natural end.
      this.finishTurnKeepWarm(noSession);
      yield await maybeEnrichResult(
        parser.buildResult(resumeSessionId === undefined ? undefined : true),
        enrichOptions
      );
      getLog().info({ sessionId: session.sessionId }, 'omp.query_completed');
    } finally {
      if (interruptSignal) interruptSignal.removeEventListener('abort', onInterrupt);
      // Ephemeral (`--no-session`) turns are never stored on `this.warmSession`
      // (see the reuse guard above), so their teardown closes the LOCAL
      // handle directly rather than through `disposeWarmSession`.
      if (noSession && !session.disposed) {
        void session.closeGracefully(terminationGraceMs());
      }
    }
  }
}
