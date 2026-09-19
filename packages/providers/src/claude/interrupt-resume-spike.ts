/**
 * Diagnostic-only Claude turn-interrupt spike.
 * Do not export from the providers package barrel. Do not call from tests or CI.
 *
 * Proves the US-002 substrate against the real Claude SDK:
 *  1. A new-session query on streaming input can be ended mid-turn via
 *     Query.interrupt() — control ack observed, stream finishes with an
 *     abort-marked result (terminal_reason), session id retained.
 *  2. The same experiment resumed on that session id interrupts again with
 *     session-id equality.
 *  3. A third resume completes a turn normally — the session stays usable
 *     after interrupts, so the operator can redirect it with a new message.
 *  4. The one-message input iterable stays open for the whole query lifetime
 *     and the query still completes.
 *
 * Output is a single sanitized JSON evidence document on stdout (no prompt
 * text, no credentials, no model content) plus a non-zero exit when the
 * protocol cannot be proven.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  query,
  type Options,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { runWithExperimentTimeout, type ClaudeFailureCategory } from './askhuman-resume-spike';

function classifyFailure(error: unknown): ClaudeFailureCategory {
  if (error instanceof Error && error.name === 'TimeoutError') return 'timeout';
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes('timed out') || lower.includes('timeout')) return 'timeout';
  if (
    lower.includes('auth') ||
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
  return 'runtime-error';
}

export type ClaudeInterruptProtocol = 'interrupt-turn-resume' | 'inconclusive';

export interface InterruptRunEvidence {
  /** 'new' = fresh session; 'resumed' = options.resume of the prior session id. */
  kind: 'new' | 'resumed';
  sessionId: string | null;
  /** interrupt() was invoked after an observable assistant event. */
  interruptDelivered: boolean;
  /** The interrupt() promise resolved (control ack), vs rejected/never fired. */
  ackResolved: boolean;
  /** still_queued uuid count from the receipt; null when the CLI did not advertise it. */
  stillQueuedCount: number | null;
  /** Ordered message.type values observed after the ack resolved. */
  postInterruptEventTypes: string[];
  /** A result event terminated the stream (no hang, no throw). */
  resultSeen: boolean;
  subtype: string | null;
  isError: boolean | null;
  stopReason: string | null;
  terminalReason: string | null;
  /**
   * The stream threw after an acknowledged interrupt — the CLI can end an
   * early-aborted turn with an error-level result the SDK surfaces as a throw
   * (e.g. `result_type=user`). Recorded message text (diagnostic codes only).
   */
  streamErrorMessage: string | null;
  /** The input iterator was still open (awaiting its hold gate) at stream end. */
  openIteratorAtCompletion: boolean;
}

export interface InterruptSpikeDocument {
  schemaVersion: 1;
  sdkVersion: string;
  model: string;
  newSession: InterruptRunEvidence | null;
  resumedSession: InterruptRunEvidence | null;
  continuation: { resumedSameSession: boolean; completed: boolean } | null;
  sessionIdConsistent: boolean;
  failureCategory: ClaudeFailureCategory | null;
  protocol: ClaudeInterruptProtocol;
}

const EXPERIMENT_TIMEOUT_MS = 120_000;
const INTERRUPTIBLE_PROMPT = 'Count from 1 to 200, one number per line, with no other commentary.';
const CONTINUATION_MARKER_PREFIX = 'SPIKE_CONTINUATION_';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface InputGateState {
  gateAwaited: boolean;
  gateSettled: boolean;
}

/** One user message, then the iterable stays open until `holdOpen` resolves. */
async function* spikeTurnInput(
  text: string,
  holdOpen: Promise<void>,
  state: InputGateState
): AsyncGenerator<SDKUserMessage, void, undefined> {
  yield {
    type: 'user',
    message: { role: 'user', content: text },
    parent_tool_use_id: null,
  };
  state.gateAwaited = true;
  await holdOpen;
  state.gateSettled = true;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

function readSessionId(message: SDKMessage): string | null {
  if (!('session_id' in message)) return null;
  const sessionId = message.session_id;
  return typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : null;
}

function isAbortTerminalReason(reason: string | null): boolean {
  return reason === 'aborted_streaming' || reason === 'aborted_tools';
}

function emptyRunEvidence(kind: InterruptRunEvidence['kind']): InterruptRunEvidence {
  return {
    kind,
    sessionId: null,
    interruptDelivered: false,
    ackResolved: false,
    stillQueuedCount: null,
    postInterruptEventTypes: [],
    resultSeen: false,
    subtype: null,
    isError: null,
    stopReason: null,
    terminalReason: null,
    streamErrorMessage: null,
    openIteratorAtCompletion: false,
  };
}

function spikeQueryOptions(model: string, cwd: string, extras: Partial<Options> = {}): Options {
  return {
    cwd,
    model,
    settingSources: [],
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    maxTurns: 1,
    maxBudgetUsd: 0.5,
    ...extras,
  };
}

/**
 * Run one interruptible turn on streaming input. Interrupts on the first
 * assistant event (the observable "turn is running" signal), records the
 * control acknowledgement, then collects the remaining event ordering until
 * the stream ends. The interrupt() promise must NOT be awaited inside the
 * read loop — its response is processed by the same pump the loop drives.
 */
async function runInterruptTurn(
  kind: InterruptRunEvidence['kind'],
  promptText: string,
  options: Options
): Promise<InterruptRunEvidence> {
  const evidence = emptyRunEvidence(kind);
  const gate = deferred();
  const gateState: InputGateState = { gateAwaited: false, gateSettled: false };
  const input = spikeTurnInput(promptText, gate.promise, gateState);
  const stream = query({ prompt: input, options });
  let interrupted = false;
  try {
    for await (const message of stream) {
      const sessionId = readSessionId(message);
      if (sessionId !== null) evidence.sessionId = sessionId;

      if (!interrupted && message.type === 'assistant') {
        interrupted = true;
        evidence.interruptDelivered = true;
        void stream.interrupt().then(
          ack => {
            evidence.ackResolved = true;
            evidence.stillQueuedCount = ack?.still_queued?.length ?? null;
          },
          () => {
            evidence.ackResolved = false;
          }
        );
        continue;
      }
      if (interrupted) {
        evidence.postInterruptEventTypes.push(message.type);
      }
      if (message.type === 'result') {
        evidence.resultSeen = true;
        evidence.subtype = message.subtype;
        evidence.isError = message.is_error;
        evidence.stopReason = message.stop_reason;
        evidence.terminalReason = message.terminal_reason ?? null;
        // The terminal result arrived while the input iterator was still open.
        evidence.openIteratorAtCompletion = gateState.gateAwaited && !gateState.gateSettled;
        // Input EOF lets the subprocess exit — the stream stays open awaiting
        // the next streamed message otherwise.
        gate.resolve();
      }
    }
  } catch (error) {
    // An abort landing before the first assistant content can end the turn
    // with an error-level result the SDK throws — record it, don't fail.
    evidence.streamErrorMessage = error instanceof Error ? error.message : String(error);
    if (!evidence.openIteratorAtCompletion) {
      evidence.openIteratorAtCompletion = gateState.gateAwaited && !gateState.gateSettled;
    }
  } finally {
    gate.resolve();
    try {
      stream.close();
    } catch {
      // The iterator may already have closed after a normal or aborted result.
    }
  }
  return evidence;
}

/** A normal (uninterrupted) turn proving the session remains usable. */
async function runContinuationTurn(
  promptText: string,
  options: Options,
  marker: string
): Promise<{ resumedSameSession: boolean; completed: boolean }> {
  const gate = deferred();
  const gateState: InputGateState = { gateAwaited: false, gateSettled: false };
  const input = spikeTurnInput(promptText, gate.promise, gateState);
  const stream = query({ prompt: input, options });
  let sessionId: string | null = null;
  let completed = false;
  try {
    for await (const message of stream) {
      const seen = readSessionId(message);
      if (seen !== null) sessionId = seen;
      if (
        message.type === 'result' &&
        message.subtype === 'success' &&
        message.result.includes(marker)
      ) {
        completed = true;
      }
      if (message.type === 'result') {
        gate.resolve();
      }
    }
  } finally {
    gate.resolve();
    try {
      stream.close();
    } catch {
      // closed already
    }
  }
  return {
    resumedSameSession: sessionId !== null && sessionId === options.resume,
    completed,
  };
}

function classifyDocument(
  document: Omit<InterruptSpikeDocument, 'protocol'>
): ClaudeInterruptProtocol {
  const first = document.newSession;
  const resumed = document.resumedSession;
  const continuation = document.continuation;
  if (!first || !resumed || !continuation || document.failureCategory !== null) {
    return 'inconclusive';
  }
  const interruptedCleanly = (run: InterruptRunEvidence): boolean =>
    run.interruptDelivered &&
    run.ackResolved &&
    ((run.resultSeen && isAbortTerminalReason(run.terminalReason)) ||
      run.streamErrorMessage !== null) &&
    run.openIteratorAtCompletion;

  const proved =
    interruptedCleanly(first) &&
    interruptedCleanly(resumed) &&
    first.sessionId !== null &&
    resumed.sessionId === first.sessionId &&
    document.sessionIdConsistent &&
    continuation.resumedSameSession &&
    continuation.completed;

  return proved ? 'interrupt-turn-resume' : 'inconclusive';
}

function readInstalledClaudeSdkVersion(expected: string): string {
  const entry = Bun.resolveSync('@anthropic-ai/claude-agent-sdk', import.meta.dir);
  const manifestPath = join(dirname(entry), 'package.json');
  const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (!isRecord(parsed) || typeof parsed.version !== 'string') {
    throw new Error('Claude SDK manifest is unreadable');
  }
  if (parsed.version !== expected) {
    throw new Error('Claude SDK version mismatch');
  }
  return parsed.version;
}

async function runInterruptSpike(
  sdkVersion: string,
  model: string
): Promise<InterruptSpikeDocument> {
  const cwd = mkdtempSync(join(tmpdir(), 'archon-claude-interrupt-spike-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd });
  } catch {
    // A plain directory still satisfies the query cwd requirement.
  }

  const document: InterruptSpikeDocument = {
    schemaVersion: 1,
    sdkVersion,
    model,
    newSession: null,
    resumedSession: null,
    continuation: null,
    sessionIdConsistent: false,
    failureCategory: null,
    protocol: 'inconclusive',
  };

  try {
    await runWithExperimentTimeout(EXPERIMENT_TIMEOUT_MS, async () => {
      // 1. New-session interrupt.
      const first = await runInterruptTurn(
        'new',
        INTERRUPTIBLE_PROMPT,
        spikeQueryOptions(model, cwd)
      );
      document.newSession = first;

      // 2. Resumed-session interrupt on the retained session id.
      if (first.sessionId !== null) {
        const resumed = await runInterruptTurn(
          'resumed',
          'Count from 201 to 400, one number per line, with no other commentary.',
          spikeQueryOptions(model, cwd, { resume: first.sessionId })
        );
        document.resumedSession = resumed;
      }

      // 3. Same-session continuation: a normal turn after two interrupts.
      if (first.sessionId !== null) {
        const marker = `${CONTINUATION_MARKER_PREFIX}${randomUUID().replaceAll('-', '')}`;
        document.continuation = await runContinuationTurn(
          `Reply with exactly ${marker} and nothing else.`,
          spikeQueryOptions(model, cwd, { resume: first.sessionId }),
          marker
        );
      }

      document.sessionIdConsistent =
        document.newSession?.sessionId !== null &&
        document.resumedSession?.sessionId === document.newSession?.sessionId;
    });
  } catch (error) {
    document.failureCategory = classifyFailure(error);
    process.stderr.write(
      `spike error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }

  document.protocol = classifyDocument(document);
  return document;
}

async function main(): Promise<void> {
  const expected = process.env.EXPECTED_CLAUDE_SDK_VERSION ?? '0.3.209';
  const sdkVersion = readInstalledClaudeSdkVersion(expected);
  const model = process.env.CLAUDE_SPIKE_MODEL?.trim() || 'haiku';
  const document = await runInterruptSpike(sdkVersion, model);
  process.stdout.write(`${JSON.stringify(document)}\n`);
  if (document.protocol === 'inconclusive') process.exitCode = 1;
}

if (import.meta.main) {
  await main();
}
