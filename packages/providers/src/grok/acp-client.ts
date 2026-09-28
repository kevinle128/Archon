import { spawn, type ChildProcess } from 'node:child_process';
import { Readable, Writable } from 'node:stream';

import {
  client,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type AgentApp,
  type ClientContext,
  type InitializeResponse,
  type PromptResponse,
  type Stream,
} from '@agentclientprotocol/sdk';

import type { MessageChunk, ModelUsageEntry, UsageBreakdown } from '../types';
import { STREAM_ABORTED_TERMINAL_REASON } from '../types';
import { toUsageBreakdown } from '../usage-breakdown';
import {
  closeOutstandingGrokAcpTools,
  createGrokAcpEventState,
  mapGrokAcpSessionUpdate,
} from './acp-event-bridge';
import { AsyncQueue } from './async-queue';

const DEFAULT_TERMINATE_GRACE_MS = 5_000;
/** Post-cancel window for the agent to flush trailing updates and settle the prompt before a hung one is released. Mirrors the DeepSeek ACP client's drain window. */
const CANCEL_DRAIN_GRACE_MS = 500;
/**
 * How long, after `abortSignal` fires, `runGrokAcpTurn` waits before
 * concluding the ACP protocol itself is stuck and force-killing the process
 * — well past `CANCEL_DRAIN_GRACE_MS`, the graceful in-flight-prompt cancel
 * path's own expected settlement time, so a normally responsive agent's
 * cancel always wins first and never trips this fallback.
 */
const DEFAULT_ABORT_STUCK_GRACE_MS = 3_000;
/** `_meta.usage.costUsdTicks` is fixed-point USD: `docs/…/cli.md` "1 USD = 10^10 ticks" (verified against a live `costUsdTicks`/dollar pair). */
const USD_TICKS_PER_DOLLAR = 1e10;

type GrokAcpCancellationCause = 'node-cancel' | 'operator-interrupt' | 'cleanup';

export interface GrokAcpTurnInput {
  cwd: string;
  prompt: string;
  resumeSessionId?: string;
  /**
   * Requested model, for the usage breakdown's `modelSource: 'requested'`
   * fallback only — the ACP session itself is not configurable per-turn
   * (Grok has no verified `session/setConfigOption` equivalent), so the
   * ACTUAL model in effect is whatever `runGrokAcpTurn` spawned the process
   * with (see `GrokAcpProcessInput.model`).
   */
  model?: string;
  /** Node-level Cancel — tears down the turn via ACP session/cancel + process kill, then throws. */
  abortSignal?: AbortSignal;
  /** Operator Stop — cancels only the current prompt via ACP session/cancel; same wire path, distinct first-cause and distinct outcome (a resumable marked result, not a throw). */
  interruptSignal?: AbortSignal;
}

export interface GrokAcpProcessInput extends GrokAcpTurnInput {
  binaryPath: string;
  effort?: string;
}

export interface GrokAcpProcessDependencies {
  spawn?: typeof spawn;
  terminateGraceMs?: number;
  /** See `DEFAULT_ABORT_STUCK_GRACE_MS`. Overridable for tests only. */
  abortStuckGraceMs?: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

interface GrokAcpUsageFields {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  requests?: number;
  costUsd?: number;
}

function usageFields(raw: Record<string, unknown>): GrokAcpUsageFields {
  const inputTokens = finiteNumber(raw.inputTokens);
  const outputTokens = finiteNumber(raw.outputTokens);
  const reasoningTokens = finiteNumber(raw.reasoningTokens);
  const cacheReadTokens = finiteNumber(raw.cachedReadTokens);
  const cacheWriteTokens = finiteNumber(raw.cacheCreationTokens);
  const requests = finiteNumber(raw.modelCalls);
  const costUsdTicks = finiteNumber(raw.costUsdTicks);
  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
    ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
    ...(requests !== undefined ? { requests } : {}),
    ...(costUsdTicks !== undefined ? { costUsd: costUsdTicks / USD_TICKS_PER_DOLLAR } : {}),
  };
}

/**
 * Build a normalized usage breakdown from `PromptResponse._meta.usage` — Grok's
 * `x.ai` extension field, not the generic ACP `Usage` type (Grok never
 * populates the spec-level `usage` field; verified against a live `_meta.usage`
 * payload). Mirrors `GrokEventParser`'s multi-model apportioning rule from the
 * `--single` transport: with exactly one reported model, its detailed measures
 * ride one row; with several, only `requests` per model plus one aggregate
 * `unknown` row (never split aggregate tokens/USD across model names).
 */
export function buildGrokAcpUsageBreakdown(
  usageMeta: unknown,
  requestedModel: string | undefined
): UsageBreakdown | undefined {
  if (!isPlainObject(usageMeta)) return undefined;
  const aggregate = usageFields(usageMeta);
  const modelUsage = isPlainObject(usageMeta.modelUsage) ? usageMeta.modelUsage : undefined;
  const modelIds = modelUsage ? Object.keys(modelUsage).filter(id => id.trim().length > 0) : [];

  const entries: ModelUsageEntry[] = [];
  if (modelIds.length === 1) {
    const modelId = modelIds[0];
    const perModel = isPlainObject(modelUsage?.[modelId]) ? modelUsage[modelId] : {};
    entries.push({
      provider: 'xai',
      model: modelId,
      modelSource: 'reported',
      ...usageFields(perModel),
    });
  } else if (modelIds.length > 1) {
    for (const modelId of modelIds) {
      const perModel = isPlainObject(modelUsage?.[modelId]) ? modelUsage[modelId] : {};
      const requests = finiteNumber(perModel.modelCalls);
      if (requests === undefined) continue;
      entries.push({ provider: 'xai', model: modelId, modelSource: 'reported', requests });
    }
    entries.push({ provider: 'xai', model: null, modelSource: 'unknown', ...aggregate });
  } else if (requestedModel) {
    entries.push({
      provider: 'xai',
      model: requestedModel,
      modelSource: 'requested',
      ...aggregate,
    });
  } else {
    entries.push({ provider: 'xai', model: null, modelSource: 'unknown', ...aggregate });
  }

  const breakdown = toUsageBreakdown(entries);
  return breakdown.length > 0 ? breakdown : undefined;
}

function abortedThrow(): Error {
  return new Error('Query aborted');
}

/**
 * `resumed` mirrors `MessageChunk.result.resumed`: `undefined` when no resume
 * was requested, otherwise whether it succeeded. Built here per-branch
 * (rather than via the shared `withResumedOutcome` wrapper) because a failed
 * resume yields its OWN result chunk with `resumed: false` — a fixed
 * post-hoc stamp over every chunk (what `withResumedOutcome` does) cannot
 * express that a specific chunk means resume did NOT succeed.
 */
function resumedFlag(resumeSessionId: string | undefined, succeeded: boolean): boolean | undefined {
  return resumeSessionId === undefined ? undefined : succeeded;
}

function interruptedResult(
  sessionId: string | undefined,
  usageBreakdown: UsageBreakdown | undefined,
  resumed: boolean | undefined
): Extract<MessageChunk, { type: 'result' }> {
  return {
    type: 'result',
    ...(sessionId ? { sessionId } : {}),
    terminalReason: STREAM_ABORTED_TERMINAL_REASON,
    isError: true,
    errorSubtype: STREAM_ABORTED_TERMINAL_REASON,
    ...(usageBreakdown ? { usageBreakdown } : {}),
    ...(resumed !== undefined ? { resumed } : {}),
  };
}

function successResult(
  sessionId: string,
  stopReason: string,
  usageBreakdown: UsageBreakdown | undefined,
  resumed: boolean | undefined
): Extract<MessageChunk, { type: 'result' }> {
  return {
    type: 'result',
    sessionId,
    stopReason,
    ...(usageBreakdown ? { usageBreakdown } : {}),
    ...(resumed !== undefined ? { resumed } : {}),
  };
}

function transportErrorResult(
  subtype: 'grok_acp_protocol_error' | 'grok_acp_resume_failed',
  message: string,
  sessionId: string | undefined,
  resumed: boolean | undefined
): Extract<MessageChunk, { type: 'result' }> {
  return {
    type: 'result',
    ...(sessionId ? { sessionId } : {}),
    isError: true,
    errorSubtype: subtype,
    errors: [message],
    ...(resumed !== undefined ? { resumed } : {}),
  };
}

function requireGrokAcpAgentCapabilities(init: InitializeResponse, resuming: boolean): void {
  if (init.protocolVersion !== PROTOCOL_VERSION) {
    throw new Error(
      `ACP protocol version mismatch: expected ${String(PROTOCOL_VERSION)}, got ${String(init.protocolVersion)}.`
    );
  }
  // Checked only when a resume was actually requested — a Grok build that
  // dropped this capability would otherwise surface as an opaque
  // -32601-style JSON-RPC error from session/resume itself.
  if (resuming && init.agentCapabilities?.sessionCapabilities?.resume == null) {
    throw new Error('Grok ACP agent no longer advertises sessionCapabilities.resume.');
  }
}

function waitMs(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve: () => void) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Drive one ACP turn against an in-process agent or an stdio stream.
 *
 * Continuation uses `session/resume` (not `session/load`): Grok's agent
 * advertises `sessionCapabilities.resume` and, verified live, recalls prior
 * turn context with no replayed `session/update` content notifications —
 * unlike `session/load`, which replays the whole prior transcript before
 * resolving. That makes `session/resume` safe to drive through the same
 * notification handler this turn also uses for live content, with no
 * turn-boundary filtering needed (same posture as the DeepSeek ACP client).
 */
export async function* driveGrokAcpTurn(
  target: Stream | AgentApp,
  input: GrokAcpTurnInput
): AsyncGenerator<MessageChunk> {
  const queue = new AsyncQueue<MessageChunk>();
  const eventState = createGrokAcpEventState();
  let activeSessionId: string | undefined;
  let sessionLive = false;
  let clientCtx: ClientContext | undefined;

  // Shared turn cancellation state — first cause wins; a natural prompt
  // result freezes the outcome against a late Stop during session/close.
  let cancellationCause: GrokAcpCancellationCause | undefined;
  let cancelSent: Promise<void> | undefined;
  let promptSettledNaturally = false;
  let resolveLocalCancellation!: () => void;
  const localCancellation = new Promise<void>((resolve: () => void) => {
    resolveLocalCancellation = resolve;
  });

  const requestCancel = (cause: GrokAcpCancellationCause): void => {
    if (cancellationCause !== undefined) return;
    cancellationCause = cause;
    resolveLocalCancellation();
  };
  const flushCancel = (): void => {
    if (
      cancellationCause === undefined ||
      promptSettledNaturally ||
      clientCtx === undefined ||
      activeSessionId === undefined ||
      cancelSent !== undefined
    ) {
      return;
    }
    cancelSent = clientCtx.notify(methods.agent.session.cancel, { sessionId: activeSessionId });
  };
  const onNodeCancel = (): void => {
    requestCancel('node-cancel');
    flushCancel();
  };
  const onOperatorInterrupt = (): void => {
    requestCancel('operator-interrupt');
    flushCancel();
  };

  const app = client({ name: 'archon-grok' })
    // `--always-approve` fully suppresses `session/request_permission` at the
    // protocol level (verified live, 6/6 trials). If a request ever reaches
    // this handler anyway, that means the intended bypass did not apply —
    // auto-cancel rather than auto-approve, so a broken bypass fails closed
    // instead of silently approving a tool call the configured permission
    // mode never actually authorized.
    .onRequest(methods.client.session.requestPermission, () => ({
      outcome: { outcome: 'cancelled' as const },
    }))
    .onNotification(methods.client.session.update, ({ params }) => {
      // Load-bearing beyond routing multi-session traffic: `activeSessionId`
      // is still undefined while `session/new`/`session/resume` itself is
      // in flight, so any update that arrives during that request (verified
      // live: session/resume's own ack can carry some) is dropped here
      // rather than misattributed to a session that doesn't exist yet.
      if (params.sessionId !== activeSessionId) return;
      for (const chunk of mapGrokAcpSessionUpdate(params.update, eventState)) queue.push(chunk);
    });

  // SDK exposes connectWith(Stream) and connectWith(AgentApp) overloads; runtime dispatch accepts both validated members.
  const targetForConnect = target as Stream & AgentApp;

  const connected: Promise<void> = app
    .connectWith(targetForConnect, async (ctx: ClientContext) => {
      clientCtx = ctx;
      const init = await ctx.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {},
      });
      requireGrokAcpAgentCapabilities(init, input.resumeSessionId !== undefined);

      if (input.resumeSessionId !== undefined) {
        try {
          await ctx.request(methods.agent.session.resume, {
            sessionId: input.resumeSessionId,
            cwd: input.cwd,
            mcpServers: [],
          });
        } catch (error) {
          queue.push(
            transportErrorResult(
              'grok_acp_resume_failed',
              errorMessage(error),
              input.resumeSessionId,
              false
            )
          );
          return;
        }
        activeSessionId = input.resumeSessionId;
      } else {
        const created = await ctx.request(methods.agent.session.new, {
          cwd: input.cwd,
          mcpServers: [],
          _meta: { yoloMode: true },
        });
        activeSessionId = created.sessionId;
      }

      const sessionId = activeSessionId;
      sessionLive = true;

      // Node Cancel dominates when both are already aborted at session start.
      if (input.abortSignal?.aborted === true) {
        requestCancel('node-cancel');
      } else if (input.interruptSignal?.aborted === true) {
        requestCancel('operator-interrupt');
      }

      let listenersAttached = false;
      if (cancellationCause === undefined) {
        input.abortSignal?.addEventListener('abort', onNodeCancel);
        input.interruptSignal?.addEventListener('abort', onOperatorInterrupt);
        listenersAttached = true;
      }
      flushCancel();

      let promptResponse: PromptResponse | undefined;
      try {
        if (cancellationCause === undefined) {
          try {
            promptResponse = await Promise.race([
              ctx.request(methods.agent.session.prompt, {
                sessionId,
                prompt: [{ type: 'text', text: input.prompt }],
              }),
              localCancellation.then(async () => {
                await waitMs(CANCEL_DRAIN_GRACE_MS);
                return undefined;
              }),
            ]);
          } catch (error) {
            if (cancellationCause === undefined) throw error;
          }
        }
        if (promptResponse !== undefined && cancellationCause === undefined) {
          promptSettledNaturally = true;
        }
      } finally {
        if (listenersAttached) {
          input.abortSignal?.removeEventListener('abort', onNodeCancel);
          input.interruptSignal?.removeEventListener('abort', onOperatorInterrupt);
        }
        if (cancelSent !== undefined) {
          try {
            await cancelSent;
          } catch {
            // Cancel notify failure must not hide session/close.
          }
        }
        await ctx.request(methods.agent.session.close, { sessionId });
        sessionLive = false;
      }

      // A tool cut short by cancel/close never received its terminal
      // completed/failed update — verified live (a fingerprinted tool_call
      // mid-cancel emitted no terminal tool_call_update before the prompt
      // settled). Synthesize the same defensive 'unknown' outcome the
      // `--single` transport's `GrokEventParser.closeOutstandingTools()` uses.
      for (const chunk of closeOutstandingGrokAcpTools(eventState)) queue.push(chunk);

      const usageBreakdown = buildGrokAcpUsageBreakdown(
        isPlainObject(promptResponse?._meta) ? promptResponse?._meta.usage : undefined,
        input.model
      );
      if (cancellationCause === 'node-cancel') {
        throw abortedThrow();
      }
      const resumed = resumedFlag(input.resumeSessionId, true);
      if (cancellationCause !== undefined && !promptSettledNaturally) {
        queue.push(interruptedResult(sessionId, usageBreakdown, resumed));
        return;
      }
      queue.push(
        successResult(sessionId, promptResponse?.stopReason ?? 'end_turn', usageBreakdown, resumed)
      );
    })
    .then(
      () => {
        queue.close();
      },
      (error: unknown) => {
        queue.fail(error);
      }
    );

  try {
    for await (const chunk of queue) {
      yield chunk;
    }
  } finally {
    // Early consumer return and any other unfinished turn: one cancel path.
    if (sessionLive) {
      requestCancel('cleanup');
      flushCancel();
    }
    await connected.catch(() => undefined);
  }
}

function childHasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

async function reapChild(child: ChildProcess, terminateGraceMs: number): Promise<void> {
  if (childHasExited(child)) return;
  const exited = new Promise<void>((resolve: () => void) => {
    child.once('exit', () => {
      resolve();
    });
  });
  if (childHasExited(child)) return;

  child.kill('SIGTERM');
  if (childHasExited(child)) {
    await exited;
    return;
  }
  await Promise.race([exited, waitMs(terminateGraceMs)]);
  if (!childHasExited(child)) child.kill('SIGKILL');
  await exited;
}

/**
 * Spawn `grok agent … stdio` and drive one ACP turn over its stdio pipes.
 *
 * `--no-leader` is load-bearing: without it Grok may attach to the user's
 * shared leader process/socket, and `session/cancel` would target that
 * shared backend rather than this call's own process. `clientCapabilities:
 * {}` is also load-bearing (in `driveGrokAcpTurn`): advertising `terminal`
 * support tells Grok the CLIENT will run shell tools via `terminal/create`,
 * so no descendant of THIS process exists for `session/cancel` to reap —
 * verified against a live binary with a fingerprinted, confirmed-alive tool
 * descendant (clean reap only with an empty `clientCapabilities`).
 */
export async function* runGrokAcpTurn(
  input: GrokAcpProcessInput,
  dependencies?: GrokAcpProcessDependencies
): AsyncGenerator<MessageChunk> {
  const spawnFn = dependencies?.spawn ?? spawn;
  const terminateGraceMs = dependencies?.terminateGraceMs ?? DEFAULT_TERMINATE_GRACE_MS;
  const abortStuckGraceMs = dependencies?.abortStuckGraceMs ?? DEFAULT_ABORT_STUCK_GRACE_MS;

  const args = ['agent', '--always-approve', '--no-leader'];
  if (input.model) args.push('-m', input.model);
  if (input.effort) args.push('--reasoning-effort', input.effort);
  args.push('stdio');

  let child: ChildProcess;
  try {
    child = spawnFn(input.binaryPath, args, { cwd: input.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (error) {
    throw new Error(`Failed to spawn Grok ACP agent: ${errorMessage(error)}`, { cause: error });
  }

  let stderrText = '';
  if (child.stderr !== null) {
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderrText += (typeof chunk === 'string' ? chunk : chunk.toString('utf8')).slice(0, 4096);
      stderrText = stderrText.slice(0, 4096);
    });
  }

  let finished = false;
  let spawnError: Error | undefined;
  let rejectDeath: ((error: Error) => void) | undefined;
  const death = new Promise<Error>((resolve: (error: Error) => void) => {
    rejectDeath = resolve;
  });
  child.once('error', (error: Error) => {
    spawnError = error;
    if (!finished) rejectDeath?.(error);
  });
  child.once('exit', (code: number | null, signal: NodeJS.Signals | null) => {
    if (!finished) {
      rejectDeath?.(
        new Error(
          `Grok ACP agent exited before the turn completed (code=${String(code)}, signal=${String(signal)}).`
        )
      );
    }
  });

  if (child.stdin === null || child.stdout === null) {
    finished = true;
    await reapChild(child, terminateGraceMs);
    throw new Error('Grok ACP agent process is missing stdio pipes.');
  }

  const stream = ndJsonStream(
    Writable.toWeb(child.stdin) as unknown as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>
  );
  const gen = driveGrokAcpTurn(stream, input);

  // `driveGrokAcpTurn` races `input.abortSignal` against its own in-flight
  // `session/prompt` request and settles gracefully within
  // `CANCEL_DRAIN_GRACE_MS` — but every OTHER ACP round trip it awaits
  // (`initialize`, `session/new`, `session/resume`, `session/close`) is not
  // raced against anything, so a Grok subprocess that stops responding
  // after one of those leaves that `await` permanently pending, and this
  // loop's `gen.next()` never settles either. This is a SEPARATE, delayed
  // race against the same signal — armed only `abortStuckGraceMs` after
  // abort fires, well past the graceful path's own expected settlement
  // time, so a normally responsive agent's cancel always wins this race
  // first and this branch never fires for it. It exists purely as the
  // fallback that guarantees the child is still reaped when the protocol
  // itself never gets a chance to unwind.
  let abortedWhileWaiting = false;
  const abortSignal = input.abortSignal;
  let abortStuckTimer: ReturnType<typeof setTimeout> | undefined;
  const aborted: Promise<{ kind: 'aborted' }> | undefined =
    abortSignal === undefined
      ? undefined
      : new Promise(resolve => {
          const arm = (): void => {
            abortStuckTimer = setTimeout(() => {
              resolve({ kind: 'aborted' });
            }, abortStuckGraceMs);
          };
          if (abortSignal.aborted) {
            arm();
            return;
          }
          abortSignal.addEventListener('abort', arm, { once: true });
        });

  try {
    for (;;) {
      const next = gen.next();
      const racers: Promise<
        | { kind: 'chunk'; result: IteratorResult<MessageChunk> }
        | { kind: 'death'; error: Error }
        | { kind: 'aborted' }
      >[] = [
        next.then((result: IteratorResult<MessageChunk>) => ({ kind: 'chunk' as const, result })),
        death.then((error: Error) => ({ kind: 'death' as const, error })),
      ];
      if (aborted !== undefined) racers.push(aborted);
      const winner = await Promise.race(racers);
      if (winner.kind === 'aborted') {
        abortedWhileWaiting = true;
        // Prevent an unhandled rejection once the reap below unblocks
        // whatever ACP request `gen` was stuck awaiting.
        next.catch(() => undefined);
        throw abortedThrow();
      }
      if (winner.kind === 'death') throw winner.error;
      if (winner.result.done) break;
      yield winner.result.value;
    }
    finished = true;
  } catch (error) {
    finished = true;
    const detail = stderrText.trim();
    const suffix = detail.length > 0 ? `\n${detail}` : '';
    if (spawnError !== undefined) {
      throw new Error(`Failed to spawn Grok ACP agent: ${errorMessage(spawnError)}${suffix}`, {
        cause: spawnError,
      });
    }
    throw error instanceof Error
      ? new Error(`${error.message}${suffix}`, { cause: error })
      : new Error(`${String(error)}${suffix}`);
  } finally {
    if (abortStuckTimer !== undefined) clearTimeout(abortStuckTimer);
    finished = true;
    if (abortedWhileWaiting) {
      // Kill first: `gen` may be stuck awaiting an ACP request the
      // subprocess will never answer (that is exactly why the race above
      // fired), so calling `gen.return()` before the process is dead would
      // wait on the very thing being torn down. Killing first closes the
      // stdio pipes, which unblocks that pending request and lets `gen`'s
      // own cleanup settle quickly in the background — not awaited, since
      // the process being gone is what this function actually promises.
      await reapChild(child, terminateGraceMs);
      void gen.return(undefined).catch(() => undefined);
    } else {
      try {
        await gen.return(undefined);
      } catch {
        // Turn already failed or completed.
      }
      await reapChild(child, terminateGraceMs);
    }
  }
}
