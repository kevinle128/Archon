import { createLogger } from '@archon/paths';

import {
  STREAM_ABORTED_TERMINAL_REASON,
  type MessageChunk,
  type ModelUsageEntry,
  type TokenUsage,
} from '../../types';
import { normalizeModelUsageEntry, toUsageBreakdown } from '../../usage-breakdown';
import { tryParseStructuredOutput } from '../../shared/structured-output';

const MAX_ERROR_PREVIEW_CHARS = 1000;
const log = createLogger('provider.omp.event-parser');

type JsonObject = Record<string, unknown>;
type ResultChunk = Extract<MessageChunk, { type: 'result' }>;

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isFollowUpTurnEvent(type: string): boolean {
  return (
    type === 'message_start' ||
    type === 'message_update' ||
    type === 'message_end' ||
    type === 'tool_execution_start' ||
    type === 'tool_execution_end'
  );
}

function numberField(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function serializeToolResult(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export class OmpEventParser {
  private sessionId: string | undefined;
  private sawAgentEnd = false;
  private sawAssistantMessage = false;
  private sawTurnActivity = false;
  private activeAssistantMessage = false;
  private pendingAssistant = '';
  private currentMessageText = '';
  private structuredText = '';
  private streamError: string | undefined;
  private readonly activeTools = new Map<string, string>();
  /** Tool call ids that were open when operator interrupt ownership began. */
  private toolsActiveAtInterrupt = new Set<string>();
  private operatorInterrupt = false;
  private tokens: TokenUsage = { input: 0, output: 0, total: 0, cost: 0 };
  private readonly usageEntries: ModelUsageEntry[] = [];
  private stopReason: string | undefined;
  private errorMessage: string | undefined;
  private resolvedModel: string | undefined;
  private numTurns = 0;

  constructor(private readonly wantsStructured: boolean) {}

  consumeLine(line: string): MessageChunk[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      const preview = line.slice(0, MAX_ERROR_PREVIEW_CHARS);
      throw new Error(`OMP CLI emitted invalid JSON: ${preview}`);
    }
    const event = asObject(parsed);
    if (!event) throw new Error('OMP CLI emitted a non-object JSON record.');
    return this.consumeEvent(event);
  }

  buildResult(resumed: boolean | undefined): ResultChunk {
    const observedResult = this.buildObservedResult(resumed);
    // OMP can dispose a finished turn without emitting agent_end on stdout.
    if (
      !this.sessionId ||
      !this.sawAssistantMessage ||
      this.activeAssistantMessage ||
      this.activeTools.size > 0
    ) {
      const missing = !this.sessionId
        ? 'session header'
        : !this.sawAssistantMessage
          ? 'assistant message'
          : this.activeAssistantMessage
            ? 'completed assistant message'
            : 'completed tool call';
      return {
        ...observedResult,
        isError: true,
        errorSubtype: 'omp_incomplete_output',
        errors: [
          `OMP CLI completed without a required ${missing}.`,
          ...((this.streamError ?? this.errorMessage)
            ? [this.streamError ?? this.errorMessage ?? '']
            : []),
        ],
        ...(resumed !== undefined ? { resumed: false } : {}),
      };
    }

    const isError =
      this.streamError !== undefined ||
      this.stopReason === 'error' ||
      this.stopReason === 'aborted';
    return {
      ...observedResult,
      ...(isError
        ? {
            isError: true,
            errorSubtype: this.streamError ?? this.stopReason,
            ...((this.streamError ?? this.errorMessage)
              ? { errors: [this.streamError ?? this.errorMessage ?? ''] }
              : {}),
          }
        : {}),
    };
  }

  getSessionId(): string | undefined {
    return this.sessionId;
  }

  hasSession(): boolean {
    return this.sessionId !== undefined;
  }

  /** True once any assistant/tool/agent work event has been observed. */
  hasTurnActivity(): boolean {
    return this.sawTurnActivity;
  }

  /** True only for the current turn's observed `agent_end`. */
  hasNaturalTurnEnded(): boolean {
    return this.sawAgentEnd;
  }

  /**
   * Enter interrupt mode after the provider claims interrupt ownership.
   * Snapshots currently-open tools so Stop-caused errored ends map to
   * `toolOutcome: 'interrupted'` instead of failure warnings.
   */
  beginOperatorInterrupt(): void {
    if (this.operatorInterrupt) return;
    this.operatorInterrupt = true;
    this.toolsActiveAtInterrupt = new Set(this.activeTools.keys());
  }

  /** Idempotent drain of coalesced assistant text (wraps flushAssistant). */
  drainPendingAssistant(): MessageChunk[] {
    return this.flushAssistant();
  }

  /**
   * Interrupted result: session + accounting/model only, plus optional
   * `resumed` and the stream-abort marker. Never fabricates a session id;
   * never carries completion/error fields even if prior subevents set them.
   */
  buildInterruptedResult(resumed: boolean | undefined): ResultChunk {
    const usageBreakdown = toUsageBreakdown(this.usageEntries);
    return {
      type: 'result',
      ...(this.sessionId ? { sessionId: this.sessionId } : {}),
      ...(this.numTurns > 0
        ? { tokens: this.tokens, cost: this.tokens.cost, numTurns: this.numTurns }
        : {}),
      ...(usageBreakdown.length > 0 ? { usageBreakdown } : {}),
      ...(this.resolvedModel ? { resolvedModel: { id: this.resolvedModel } } : {}),
      ...(resumed !== undefined ? { resumed } : {}),
      terminalReason: STREAM_ABORTED_TERMINAL_REASON,
    };
  }

  /**
   * Force-kill error result after SIGKILL fired during an interrupt attempt.
   * Unmarked (no stream_aborted) so the executor fails rather than idling.
   */
  buildForceKilledResult(resumed: boolean | undefined): ResultChunk {
    const usageBreakdown = toUsageBreakdown(this.usageEntries);
    return {
      type: 'result',
      ...(this.sessionId ? { sessionId: this.sessionId } : {}),
      ...(this.numTurns > 0
        ? { tokens: this.tokens, cost: this.tokens.cost, numTurns: this.numTurns }
        : {}),
      ...(usageBreakdown.length > 0 ? { usageBreakdown } : {}),
      ...(this.resolvedModel ? { resolvedModel: { id: this.resolvedModel } } : {}),
      ...(resumed !== undefined ? { resumed } : {}),
      isError: true,
      errorSubtype: 'omp_interrupt_force_killed',
      errors: ['OMP CLI did not exit after SIGTERM; SIGKILL fallback fired.'],
    };
  }

  /** Unmarked error when Stop cannot obtain a resumable session id. */
  buildSessionUnavailableResult(): ResultChunk {
    return {
      type: 'result',
      isError: true,
      errorSubtype: 'omp_interrupt_session_unavailable',
      errors: [
        'OMP interrupt could not obtain a session header before turn activity or the header wait deadline.',
      ],
    };
  }

  private buildObservedResult(resumed: boolean | undefined): ResultChunk {
    const structuredOutput =
      this.wantsStructured && !this.streamError
        ? tryParseStructuredOutput(this.structuredText)
        : undefined;
    const usageBreakdown = toUsageBreakdown(this.usageEntries);
    return {
      type: 'result',
      ...(this.sessionId ? { sessionId: this.sessionId } : {}),
      ...(this.numTurns > 0
        ? { tokens: this.tokens, cost: this.tokens.cost, numTurns: this.numTurns }
        : {}),
      ...(usageBreakdown.length > 0 ? { usageBreakdown } : {}),
      ...(this.stopReason ? { stopReason: this.stopReason } : {}),
      ...(this.resolvedModel ? { resolvedModel: { id: this.resolvedModel } } : {}),
      ...(structuredOutput !== undefined ? { structuredOutput } : {}),
      ...(resumed !== undefined ? { resumed } : {}),
    };
  }

  private consumeEvent(event: JsonObject): MessageChunk[] {
    const type = stringField(event.type);
    if (!type) throw new Error('OMP CLI emitted a record without a non-empty string event type.');
    // agent_end ends a turn, not the stream. OMP may then emit maintenance
    // events or start another turn (todo reminder, advisor, compaction).
    if (this.sawAgentEnd) {
      if (!isFollowUpTurnEvent(type)) return [];
      this.sawAgentEnd = false;
    }
    switch (type) {
      case 'session': {
        const sessionId = stringField(event.id);
        if (!sessionId) throw new Error('OMP CLI emitted a session event without an id.');
        if (this.sessionId && this.sessionId !== sessionId)
          throw new Error('OMP CLI emitted conflicting session headers.');
        this.sessionId = sessionId;
        return [];
      }
      case 'message_start': {
        const message = asObject(event.message);
        if (stringField(message?.role) === 'assistant') {
          if (this.activeAssistantMessage || this.pendingAssistant)
            throw new Error(
              'OMP CLI started an assistant message before the unfinished message ended.'
            );
          this.sawTurnActivity = true;
          this.activeAssistantMessage = true;
          this.currentMessageText = '';
        }
        return [];
      }
      case 'message_update':
        return this.consumeMessageUpdate(asObject(event.assistantMessageEvent));
      case 'message_end':
        return this.consumeMessageEnd(asObject(event.message));
      case 'tool_execution_start':
        return this.consumeToolStart(event);
      case 'tool_execution_end':
        return this.consumeToolEnd(event);
      case 'notice': {
        const chunks = this.flushAssistant();
        const message = stringField(event.message);
        return message ? [...chunks, { type: 'system', content: message }] : chunks;
      }
      case 'auto_retry_start': {
        const chunks = this.flushAssistant();
        const attempt = event.attempt;
        const error = stringField(event.errorMessage) ?? stringField(event.error);
        const details = [
          typeof attempt === 'number' && Number.isFinite(attempt)
            ? `attempt ${attempt}`
            : undefined,
          error,
        ].filter((value): value is string => value !== undefined);
        return details.length > 0
          ? [...chunks, { type: 'system', content: `OMP auto retry: ${details.join(': ')}` }]
          : chunks;
      }
      case 'agent_end':
        if (this.activeTools.size > 0)
          throw new Error('OMP CLI ended with an outstanding tool call.');
        this.sawTurnActivity = true;
        this.sawAgentEnd = true;
        return this.activeAssistantMessage ? [] : this.flushAssistant();
      default:
        return this.flushAssistant();
    }
  }

  private consumeMessageUpdate(event: JsonObject | undefined): MessageChunk[] {
    const type = stringField(event?.type);
    const delta = stringField(event?.delta);
    if (type === 'text_delta' && delta) {
      this.sawTurnActivity = true;
      this.pendingAssistant += delta;
      this.currentMessageText += delta;
      return [];
    }
    if (type === 'thinking_delta' && delta) {
      this.sawTurnActivity = true;
      return [...this.flushAssistant(), { type: 'thinking', content: delta }];
    }
    return type === 'text_end' || type === 'done' || type === 'error' ? this.flushAssistant() : [];
  }

  private consumeMessageEnd(message: JsonObject | undefined): MessageChunk[] {
    if (!message || stringField(message.role) !== 'assistant') return [];
    if (!Array.isArray(message.content))
      throw new Error('OMP CLI assistant message_end is missing content.');
    const usage = asObject(message.usage);
    if (!usage) throw new Error('OMP CLI assistant message_end is missing usage.');
    const model = stringField(message.model);
    if (!model) throw new Error('OMP CLI assistant message_end is missing model.');
    const stopReason = stringField(message.stopReason);
    if (!stopReason) throw new Error('OMP CLI assistant message_end is missing stop reason.');
    this.assertUsage(usage);
    this.sawTurnActivity = true;
    const content = message.content;
    const completeText = content
      .map(asObject)
      .map(block => (stringField(block?.type) === 'text' ? (stringField(block?.text) ?? '') : ''))
      .join('');
    let chunks: MessageChunk[] = [];
    if (completeText.startsWith(this.currentMessageText)) {
      const suffix = completeText.slice(this.currentMessageText.length);
      this.pendingAssistant += suffix;
      this.currentMessageText += suffix;
      if (this.wantsStructured) this.structuredText += completeText;
      chunks = this.flushAssistant();
    } else {
      log.warn(
        { streamedLength: this.currentMessageText.length, completeLength: completeText.length },
        'omp.streaming_text_mismatch'
      );
      chunks = this.flushAssistant();
      this.streamError = 'omp_stream_mismatch';
    }
    this.sawAssistantMessage = true;
    this.activeAssistantMessage = false;
    this.accumulateUsage(usage);
    const usageEntry = messageUsageToEntry(message, usage);
    if (usageEntry) {
      const normalized = normalizeModelUsageEntry(usageEntry);
      if (normalized.ok) this.usageEntries.push(normalized.entry);
    }
    this.numTurns += 1;
    const provider = stringField(message.provider);
    this.resolvedModel = provider && model ? `${provider}/${model}` : model;
    this.stopReason = stopReason;
    this.errorMessage = stringField(message.errorMessage);
    return chunks;
  }

  private consumeToolStart(event: JsonObject): MessageChunk[] {
    const chunks = this.flushAssistant();
    const toolName = stringField(event.toolName);
    if (!toolName) throw new Error('OMP CLI tool_execution_start is missing toolName.');
    const toolCallId = stringField(event.toolCallId);
    if (!toolCallId) throw new Error('OMP CLI tool_execution_start is missing toolCallId.');
    const toolInput = asObject(event.args);
    if (!toolInput) throw new Error('OMP CLI tool_execution_start has invalid args.');
    if (this.activeTools.has(toolCallId))
      throw new Error('OMP CLI emitted a duplicate active toolCallId.');
    this.sawTurnActivity = true;
    this.activeTools.set(toolCallId, toolName);
    return [
      ...chunks,
      {
        type: 'tool',
        toolName,
        toolInput,
        toolCallId,
      },
    ];
  }

  private consumeToolEnd(event: JsonObject): MessageChunk[] {
    const chunks = this.flushAssistant();
    const toolName = stringField(event.toolName);
    if (!toolName) throw new Error('OMP CLI tool_execution_end is missing toolName.');
    const toolCallId = stringField(event.toolCallId);
    if (!toolCallId) throw new Error('OMP CLI tool_execution_end is missing toolCallId.');
    const startedToolName = this.activeTools.get(toolCallId);
    if (!startedToolName) {
      // No active tool call matches this orphan end. Ignore it so later valid
      // events continue. Every other tool-lifecycle check stays strict.
      log.warn({ toolCallId, toolName }, 'omp.unmatched_tool_end');
      return chunks;
    }
    if (startedToolName !== toolName)
      throw new Error('OMP CLI emitted a mismatched tool_execution_end.');
    if (!Object.hasOwn(event, 'result'))
      throw new Error('OMP CLI errored tool_execution_end is missing result.');
    this.sawTurnActivity = true;
    this.activeTools.delete(toolCallId);
    const result: MessageChunk[] = [...chunks];
    const wasActiveAtInterrupt =
      this.operatorInterrupt && this.toolsActiveAtInterrupt.has(toolCallId);
    if (event.isError === true) {
      if (wasActiveAtInterrupt) {
        // Stop-caused errored end: interrupted outcome, no failure warning.
        result.push({
          type: 'tool_result',
          toolName,
          toolOutput: serializeToolResult(event.result),
          toolCallId,
          toolOutcome: 'interrupted',
          outputState: 'full' as const,
        });
        return result;
      }
      result.push({
        type: 'system',
        content: `OMP tool ${toolName} failed: ${serializeToolResult(event.result)}`,
      });
    }
    result.push({
      type: 'tool_result',
      toolName,
      toolOutput: serializeToolResult(event.result),
      toolCallId,
      toolOutcome: event.isError === true ? 'error' : 'success',
      outputState: 'full' as const,
    });
    return result;
  }

  private flushAssistant(): MessageChunk[] {
    if (this.pendingAssistant.length === 0) return [];
    const content = this.pendingAssistant;
    this.pendingAssistant = '';
    return [{ type: 'assistant', content }];
  }

  private accumulateUsage(usage: JsonObject | undefined): void {
    const cost = asObject(usage?.cost);
    this.tokens = {
      input: this.tokens.input + numberField(usage?.input),
      output: this.tokens.output + numberField(usage?.output),
      total: (this.tokens.total ?? 0) + numberField(usage?.totalTokens),
      cost: (this.tokens.cost ?? 0) + numberField(cost?.total),
    };
  }

  private assertUsage(usage: JsonObject): void {
    const cost = asObject(usage.cost);
    if (
      !cost ||
      !Number.isFinite(usage.input) ||
      !Number.isFinite(usage.output) ||
      !Number.isFinite(usage.totalTokens) ||
      !Number.isFinite(cost.total)
    ) {
      throw new Error('OMP CLI assistant message_end has invalid usage.');
    }
  }
}

/**
 * Map one OMP assistant message + usage object to a normalized observation.
 * Stream and transcript parsers share this so primary and hidden rows stay aligned.
 * Missing/blank provider yields no observation — never fabricate `unknown`.
 * Legacy accumulateUsage stays separate and still sums whatever the stream reported.
 */
export function messageUsageToEntry(
  message: JsonObject,
  usage: JsonObject,
  kind?: ModelUsageEntry['kind']
): ModelUsageEntry | undefined {
  const provider =
    typeof message.provider === 'string' && message.provider.trim().length > 0
      ? message.provider.trim()
      : undefined;
  if (!provider) return undefined;

  const modelRaw = stringField(message.model);
  let model: string | null;
  let modelSource: ModelUsageEntry['modelSource'];
  if (modelRaw) {
    model = modelRaw;
    modelSource = 'reported';
  } else {
    model = null;
    modelSource = 'unknown';
  }

  const cost = asObject(usage.cost);
  const entry: ModelUsageEntry = {
    provider,
    model,
    modelSource,
    requests: 1,
  };

  if (typeof usage.input === 'number' && Number.isFinite(usage.input)) {
    entry.inputTokens = usage.input;
  }
  if (typeof usage.output === 'number' && Number.isFinite(usage.output)) {
    entry.outputTokens = usage.output;
  }
  if (typeof usage.cacheRead === 'number' && Number.isFinite(usage.cacheRead)) {
    entry.cacheReadTokens = usage.cacheRead;
  }
  if (typeof usage.cacheWrite === 'number' && Number.isFinite(usage.cacheWrite)) {
    entry.cacheWriteTokens = usage.cacheWrite;
  }
  const reasoning =
    typeof usage.reasoningTokens === 'number'
      ? usage.reasoningTokens
      : typeof usage.reasoning === 'number'
        ? usage.reasoning
        : undefined;
  if (typeof reasoning === 'number' && Number.isFinite(reasoning)) {
    entry.reasoningTokens = reasoning;
  }
  if (cost && typeof cost.total === 'number' && Number.isFinite(cost.total)) {
    entry.costUsd = cost.total;
  }
  if (kind) entry.kind = kind;
  return entry;
}
