/**
 * Diagnostic-only Claude soft-injection / delivery-acknowledgement spike.
 * Do not export from the providers package barrel. Do not call from tests or CI.
 *
 * Proves, against the real Claude SDK, the two open questions Story 8.3 needs
 * answered before any capability flag can flip:
 *
 *  1. Soft injection: can a second `SDKUserMessage` be pushed onto the SAME
 *     streaming-input iterable AFTER the turn has started generating, and
 *     does the model actually incorporate it into the CURRENT turn (no Stop,
 *     no new turn) rather than being ignored or deferred to a turn that never
 *     happens because the input stays open?
 *  2. Delivery acknowledgement: does any message on the output stream echo
 *     the injected message's caller-stamped `uuid` back, so Archon can
 *     correlate a specific durable queue entry to "the provider accepted it"
 *     without inferring anything from text or timing?
 *
 * Output is a single sanitized JSON evidence document on stdout: message
 * TYPES and boolean/uuid-shaped facts only — no prompt text, no model
 * output, no credentials.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  query,
  type Options,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';

import { runWithExperimentTimeout, type ClaudeFailureCategory } from './askhuman-resume-spike';

const EXPERIMENT_TIMEOUT_MS = 120_000;
/**
 * Sequential tool calls so injection can target the gap BETWEEN tool calls
 * (the boundary the OMP `immediate` interrupt-mode doc describes), not only
 * mid-token-stream on a single completion.
 */
const TOOL_USING_PROMPT =
  'Use the Bash tool to run "sleep 1" exactly three times, one call at a time, ' +
  'waiting for each result before starting the next. After the third call ' +
  'returns, reply with exactly the word DONE and nothing else.';

function classifyFailure(error: unknown): ClaudeFailureCategory {
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
    (lower.includes('unavailable') || lower.includes('not found') || lower.includes('404'))
  ) {
    return 'model-unavailable';
  }
  return 'runtime-error';
}

/**
 * A streaming-input iterable that can accept additional `SDKUserMessage`s
 * pushed in AFTER the first one has already been yielded and consumed —
 * the exact shape a live soft-injection channel needs. Closing ends the
 * iterable (query EOF); pushing after close is a silent no-op (mirrors a
 * channel that is no longer `ready()`).
 */
interface PushableInput {
  push(message: SDKUserMessage): void;
  close(): void;
}

function createPushableInput(): {
  iterable: AsyncGenerator<SDKUserMessage, void, undefined>;
  controller: PushableInput;
} {
  const queue: SDKUserMessage[] = [];
  let wake: (() => void) | undefined;
  let closed = false;
  const iterable = (async function* (): AsyncGenerator<SDKUserMessage, void, undefined> {
    for (;;) {
      while (queue.length > 0) {
        const next = queue.shift();
        if (next !== undefined) yield next;
      }
      if (closed) return;
      await new Promise<void>(resolve => {
        wake = resolve;
      });
    }
  })();
  return {
    iterable,
    controller: {
      push(message): void {
        if (closed) return;
        queue.push(message);
        wake?.();
        wake = undefined;
      },
      close(): void {
        closed = true;
        wake?.();
        wake = undefined;
      },
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Every field this spike can read off a raw SDK message without touching content. */
interface ObservedMessage {
  type: string;
  hasUuid: boolean;
  uuidMatchesInjected: boolean;
  isReplay: boolean;
  hasSessionId: boolean;
}

function observe(message: SDKMessage, injectedId: string): ObservedMessage {
  const record = message as unknown as Record<string, unknown>;
  const uuid = typeof record.uuid === 'string' ? record.uuid : undefined;
  return {
    type: message.type,
    hasUuid: uuid !== undefined,
    uuidMatchesInjected: uuid === injectedId,
    isReplay: record.isReplay === true,
    hasSessionId: typeof record.session_id === 'string' && record.session_id.length > 0,
  };
}

export interface SoftInjectionEvidence {
  sdkVersion: string;
  model: string;
  sessionId: string | null;
  /** The injected message's stamped id ever appeared on ANY output message. */
  injectedUuidEchoed: boolean;
  /** Specifically on an `isReplay: true` message (the suspected echo shape). */
  echoedViaReplayMessage: boolean;
  /** The message type that carried the echo, if any (diagnostic only). */
  echoMessageType: string | null;
  /** The FIRST result seen after injection contained the post-injection marker. */
  firstResultContainedMarker: boolean;
  /**
   * Count of `result` messages observed after injection. `1` means the
   * injected content landed in the SAME turn as the original request; `2`+
   * means `streamInput()` produced at least one additional turn.
   */
  resultCountAfterInjection: number;
  /** At least one more `stream_event` (partial token) arrived after injection — proof tokens were still streaming. */
  genuinelyMidGeneration: boolean;
  /** streamInput() resolved without throwing. */
  streamInputResolved: boolean;
  streamInputError: string | null;
  /** Ordered message types observed after the injection point (diagnostic only). */
  postInjectionEventTypes: string[];
  resultSeen: boolean;
  terminalReason: string | null;
  failureCategory: ClaudeFailureCategory | null;
}

function emptyEvidence(sdkVersion: string, model: string): SoftInjectionEvidence {
  return {
    sdkVersion,
    model,
    sessionId: null,
    injectedUuidEchoed: false,
    echoedViaReplayMessage: false,
    echoMessageType: null,
    firstResultContainedMarker: false,
    resultCountAfterInjection: 0,
    genuinelyMidGeneration: false,
    streamInputResolved: false,
    streamInputError: null,
    postInjectionEventTypes: [],
    resultSeen: false,
    terminalReason: null,
    failureCategory: null,
  };
}

async function runSoftInjectionSpike(
  sdkVersion: string,
  model: string
): Promise<SoftInjectionEvidence> {
  const cwd = mkdtempSync(join(tmpdir(), 'archon-claude-soft-inject-spike-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd });
  } catch {
    // A plain directory still satisfies the query cwd requirement.
  }

  const evidence = emptyEvidence(sdkVersion, model);
  const marker = `SOFT_INJECT_ACK_${randomUUID().replaceAll('-', '')}`;
  const injectedId = randomUUID();

  const options: Options = {
    cwd,
    model,
    settingSources: [],
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    maxTurns: 1,
    maxBudgetUsd: 0.5,
    // Required so injection happens while the model is still emitting the
    // current message's tokens — waiting for a full `assistant` SDKMessage
    // means the content block (and often the whole turn) has already
    // finished, which is too late to prove genuine mid-turn delivery.
    includePartialMessages: true,
  };

  try {
    await runWithExperimentTimeout(EXPERIMENT_TIMEOUT_MS, async () => {
      const { iterable, controller } = createPushableInput();
      controller.push({
        type: 'user',
        message: { role: 'user', content: TOOL_USING_PROMPT },
        parent_tool_use_id: null,
      });

      const stream = query({ prompt: iterable, options });
      let injected = false;
      let sawInjectionTrigger = false;
      let assistantMessageCount = 0;
      let streamEventsAfterInjection = 0;
      try {
        for await (const message of stream) {
          const seen = observe(message, injectedId);
          if (seen.hasSessionId) {
            const sessionId = (message as unknown as Record<string, unknown>).session_id;
            if (typeof sessionId === 'string') evidence.sessionId = sessionId;
          }

          if (message.type === 'stream_event' && injected) {
            streamEventsAfterInjection += 1;
          }
          if (message.type === 'assistant') assistantMessageCount += 1;

          // Inject in the gap BETWEEN tool calls: after the model's SECOND
          // assistant message starts (the first dispatched tool call #1 and
          // received its result; the second is either dispatching tool call
          // #2 or already past it) — this is the "between tool calls"
          // boundary the OMP `immediate` interrupt-mode doc describes,
          // deliberately distinct from mid-single-completion injection.
          if (!injected && message.type === 'assistant' && assistantMessageCount >= 2) {
            sawInjectionTrigger = true;
            injected = true;
            try {
              await stream.streamInput(
                (async function* (): AsyncGenerator<SDKUserMessage, void, undefined> {
                  yield {
                    type: 'user',
                    message: {
                      role: 'user',
                      content: `Also, once you finish the sleep calls, append the exact line ${marker} after DONE.`,
                    },
                    parent_tool_use_id: null,
                    uuid: injectedId,
                  };
                })()
              );
              evidence.streamInputResolved = true;
            } catch (error) {
              evidence.streamInputError = error instanceof Error ? error.message : String(error);
            }
            continue;
          }

          if (injected) {
            evidence.postInjectionEventTypes.push(seen.type);
            if (seen.hasUuid && seen.uuidMatchesInjected) {
              evidence.injectedUuidEchoed = true;
              evidence.echoMessageType = seen.type;
              if (seen.isReplay) evidence.echoedViaReplayMessage = true;
            }
          }

          if (message.type === 'result') {
            evidence.resultSeen = true;
            evidence.resultCountAfterInjection += 1;
            if (evidence.resultCountAfterInjection === 1) {
              // Positive proof the injection landed WHILE tokens were still
              // streaming, not strictly after the whole turn had finished.
              evidence.genuinelyMidGeneration = streamEventsAfterInjection > 0;
              evidence.terminalReason =
                (message as { terminal_reason?: string }).terminal_reason ?? null;
              if (message.subtype === 'success') {
                evidence.firstResultContainedMarker = message.result.includes(marker);
              }
            }
            // A SECOND `result` proves `streamInput()` started a NEW turn
            // rather than continuing the one in flight — stop draining once
            // that is settled instead of paying for a third turn.
            if (evidence.resultCountAfterInjection >= 2) {
              controller.close();
              break;
            }
          }
        }
      } finally {
        controller.close();
        try {
          stream.close();
        } catch {
          // may already be closed
        }
      }
      if (!sawInjectionTrigger) {
        throw new Error('never observed a second assistant message to inject after');
      }
    });
  } catch (error) {
    evidence.failureCategory = classifyFailure(error);
    process.stderr.write(
      `spike error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }

  return evidence;
}

export type SoftInjectionVerdict = 'verified' | 'unverified';

/**
 * The spec's bar for flipping `softInjection`: the injected message must
 * land in the SAME turn (exactly one `result`, not a queued additional one)
 * while tokens were provably still streaming, with no experiment failure.
 * Anything else — including the two-`result` shape this spike actually
 * observed against the real SDK — stays `unverified`, and the capability
 * stays `false`.
 */
export function classifySoftInjectionVerdict(
  evidence: SoftInjectionEvidence
): SoftInjectionVerdict {
  if (evidence.failureCategory !== null) return 'unverified';
  if (!evidence.streamInputResolved) return 'unverified';
  if (!evidence.genuinelyMidGeneration) return 'unverified';
  if (evidence.resultCountAfterInjection !== 1) return 'unverified';
  return 'verified';
}

/**
 * The spec's bar for flipping `deliveryAck`: the provider must echo the
 * caller-stamped `uuid` on some output message. Correlation is by id alone.
 */
export function classifyDeliveryAckVerdict(evidence: SoftInjectionEvidence): SoftInjectionVerdict {
  return evidence.injectedUuidEchoed ? 'verified' : 'unverified';
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

async function main(): Promise<void> {
  const expected = process.env.EXPECTED_CLAUDE_SDK_VERSION ?? '0.3.209';
  const sdkVersion = readInstalledClaudeSdkVersion(expected);
  const model = process.env.CLAUDE_SPIKE_MODEL?.trim() || 'haiku';
  const evidence = await runSoftInjectionSpike(sdkVersion, model);
  const document = {
    ...evidence,
    softInjectionVerdict: classifySoftInjectionVerdict(evidence),
    deliveryAckVerdict: classifyDeliveryAckVerdict(evidence),
  };
  process.stdout.write(`${JSON.stringify(document)}\n`);
  if (
    document.softInjectionVerdict === 'unverified' &&
    document.deliveryAckVerdict === 'unverified'
  ) {
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await main();
}
