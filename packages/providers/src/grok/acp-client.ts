import { spawn, type ChildProcess } from 'node:child_process';
import { Readable, Writable } from 'node:stream';

import { createLogger } from '@archon/paths';

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

import type { MessageChunk, ModelUsageEntry, SoftInjectionChannel, UsageBreakdown } from '../types';
import { STREAM_ABORTED_TERMINAL_REASON } from '../types';
import { toUsageBreakdown } from '../usage-breakdown';
import {
  closeOutstandingGrokAcpTools,
  createGrokAcpEventState,
  mapGrokAcpSessionUpdate,
} from './acp-event-bridge';
import { AsyncQueue } from './async-queue';

let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  cachedLog ??= createLogger('provider.grok.acp');
  return cachedLog;
}

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

/**
 * Vendor ACP method that hands a message to the running prompt. Verified live
 * (`{sessionId, text}` -> `{result: {status: 'queued'}}`): a message sent while a tool
 * call is in flight is consumed by the model at its next step inside the SAME
 * `session/prompt` turn, so the prompt settles once. The flat `text` field is
 * the shape the agent accepts; a `ContentBlock[]` is rejected.
 */
const GROK_INTERJECT_METHOD = '_x.ai/interject';

interface GrokInterjectParams {
  sessionId: string;
  text: string;
}

interface GrokInterjectResponse {
  result?: { status?: string };
}

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
  /**
   * Mid-turn message channel (per-item Send now). A handler is registered only
   * while the prompt is in flight and is removed before `session/close`.
   */
  softInjection?: SoftInjectionChannel;
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
      let unregisterSoftInjection: (() => void) | undefined;
      try {
        if (cancellationCause === undefined && input.softInjection !== undefined) {
          unregisterSoftInjection = input.softInjection.ready(async request => {
            if (cancellationCause !== undefined || promptSettledNaturally) return false;
            try {
              const ack = await ctx.request<GrokInterjectResponse, GrokInterjectParams>(
                GROK_INTERJECT_METHOD,
                { sessionId, text: request.text }
              );
              if (ack.result?.status !== 'queued') {
                getLog().warn({ status: ack.result?.status }, 'grok.acp_interject_not_queued');
                return false;
              }
              return true;
            } catch (error) {
              // A refused or failed interject leaves the durable entry queued;
              // the caller reverts its claim on `false`.
              getLog().warn(
                { err: error as Error, errorType: (error as Error).constructor.name },
                'grok.acp_interject_failed'
              );
              return false;
            }
          });
        }
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
        unregisterSoftInjection?.();
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

  // Reaping the child must never depend on THIS generator being resumed
  // again. A caller that stops pulling once it sees `input.abortSignal`
  // fire (`withIdleTimeout`'s external-abort branch is exactly this) can
  // leave this generator suspended at its last `yield` forever — no further
  // `.next()` call ever arrives to run any cleanup an in-loop race would
  // depend on, `finally` included. So this reap is armed as a plain
  // listener on the signal itself: it fires `abortStuckGraceMs` after
  // abort — well past `driveGrokAcpTurn`'s own graceful in-flight-prompt
  // cancel (`CANCEL_DRAIN_GRACE_MS`), so a normally responsive agent's
  // cancel always finishes and clears it first — and kills the child
  // directly. `reapOnce` is idempotent with the `finally` block's own
  // reap below, so both can fire without conflict; killing the process
  // also unblocks whatever ACP request `driveGrokAcpTurn` was stuck
  // awaiting, letting its own cleanup settle on its own schedule even
  // though nothing is consuming its output anymore.
  let reaped = false;
  const reapOnce = async (): Promise<void> => {
    if (reaped) return;
    reaped = true;
    await reapChild(child, terminateGraceMs);
  };
  let abortStuckTimer: ReturnType<typeof setTimeout> | undefined;
  const abortSignal = input.abortSignal;
  const armAbortStuckReap = (): void => {
    abortStuckTimer = setTimeout(() => {
      if (finished) return;
      void reapOnce();
    }, abortStuckGraceMs);
  };
  if (abortSignal !== undefined) {
    if (abortSignal.aborted) armAbortStuckReap();
    else abortSignal.addEventListener('abort', armAbortStuckReap, { once: true });
  }

  try {
    for (;;) {
      const next = gen.next();
      const winner = await Promise.race([
        next.then((result: IteratorResult<MessageChunk>) => ({ kind: 'chunk' as const, result })),
        death.then((error: Error) => ({ kind: 'death' as const, error })),
      ]);
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
    finished = true;
    if (abortStuckTimer !== undefined) clearTimeout(abortStuckTimer);
    // `{ once: true }` self-removes once fired, but a turn that completes
    // (or fails) BEFORE abort ever fires leaves the listener attached — the
    // dag-executor reuses one AbortController across every turn of a node,
    // so a long-running node would otherwise accumulate one dead listener
    // per turn.
    abortSignal?.removeEventListener('abort', armAbortStuckReap);
    try {
      await gen.return(undefined);
    } catch {
      // Turn already failed or completed.
    }
    await reapOnce();
  }
}
