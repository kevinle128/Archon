import type { ContentBlock, SessionUpdate, ToolCallContent } from '@agentclientprotocol/sdk';

import type { MessageChunk } from '../../types';

/** Devin's native question tool; its calls are answered through ACP elicitation. */
export const DEVIN_ASK_TOOL_NAME = 'ask_user_question';

const INFERENCE_TOOL_NAME_META = 'cognition.ai/inferenceToolName';

export interface DevinEventState {
  readonly tools: Map<string, { name: string; input?: Record<string, unknown> }>;
  /**
   * ask_user_question tool-call ids in arrival order, not yet claimed by an
   * elicitation request. Devin sends the tool_call notification before the
   * elicitation request on the same ordered stream, so FIFO correlation gives
   * the elicitation the transcript's own tool-call id.
   */
  readonly pendingAskToolCallIds: string[];
  /** True while session/load replays history; every update is dropped then. */
  replaying: boolean;
}

export function createDevinEventState(): DevinEventState {
  return { tools: new Map(), pendingAskToolCallIds: [], replaying: false };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asToolInput(rawInput: unknown): Record<string, unknown> | undefined {
  if (rawInput === undefined) return undefined;
  if (isPlainObject(rawInput)) return rawInput;
  return { rawInput };
}

function flattenContentBlock(block: ContentBlock): string {
  if (block.type === 'text') return block.text;
  return JSON.stringify(block);
}

function flattenToolContent(content: readonly ToolCallContent[] | null | undefined): string {
  if (!content || content.length === 0) return '';
  return content
    .map(item =>
      item.type === 'content' ? flattenContentBlock(item.content) : JSON.stringify(item)
    )
    .join('');
}

function toolOutputFromUpdate(update: {
  rawOutput?: unknown;
  content?: readonly ToolCallContent[] | null;
}): string {
  if (update.rawOutput !== undefined) {
    return typeof update.rawOutput === 'string'
      ? update.rawOutput
      : JSON.stringify(update.rawOutput);
  }
  return flattenToolContent(update.content);
}

/**
 * Devin reports the tool identity in `_meta`; `name` is absent and `title` is a
 * human sentence. Prefer the machine name, then any declared name, then title.
 */
export function devinToolName(update: {
  name?: string | null;
  title?: string | null;
  _meta?: Record<string, unknown> | null;
}): string | undefined {
  const inferred = update._meta?.[INFERENCE_TOOL_NAME_META];
  if (typeof inferred === 'string' && inferred.length > 0) return inferred;
  if (typeof update.name === 'string' && update.name.length > 0) return update.name;
  if (typeof update.title === 'string' && update.title.length > 0) return update.title;
  return undefined;
}

/**
 * Translate one ACP SessionUpdate into zero or more Archon MessageChunks.
 * usage_update never maps: it carries context occupancy and cumulative
 * counters, not this turn's bill.
 */
export function mapDevinSessionUpdate(
  update: SessionUpdate,
  state: DevinEventState
): MessageChunk[] {
  if (state.replaying) return [];

  switch (update.sessionUpdate) {
    case 'agent_message_chunk': {
      if (update.content.type !== 'text') return [];
      return [{ type: 'assistant', content: update.content.text, textMode: 'delta' }];
    }
    case 'agent_thought_chunk': {
      if (update.content.type !== 'text') return [];
      return [{ type: 'thinking', content: update.content.text }];
    }
    case 'tool_call': {
      const name = devinToolName(update) ?? 'unknown';
      const input = asToolInput(update.rawInput);
      state.tools.set(update.toolCallId, { name, ...(input !== undefined ? { input } : {}) });
      if (name === DEVIN_ASK_TOOL_NAME) state.pendingAskToolCallIds.push(update.toolCallId);
      return [
        {
          type: 'tool',
          toolName: name,
          toolCallId: update.toolCallId,
          ...(input !== undefined ? { toolInput: input } : {}),
        },
      ];
    }
    case 'tool_call_update': {
      const stored = state.tools.get(update.toolCallId);
      const name = devinToolName(update) ?? stored?.name ?? 'unknown';
      const input = update.rawInput !== undefined ? asToolInput(update.rawInput) : stored?.input;
      const terminal = update.status === 'completed' || update.status === 'failed';
      if (!terminal) {
        state.tools.set(update.toolCallId, { name, ...(input !== undefined ? { input } : {}) });
        return [];
      }
      state.tools.delete(update.toolCallId);
      const pendingAskIndex = state.pendingAskToolCallIds.indexOf(update.toolCallId);
      if (pendingAskIndex !== -1) state.pendingAskToolCallIds.splice(pendingAskIndex, 1);
      return [
        {
          type: 'tool_result',
          toolName: name,
          toolCallId: update.toolCallId,
          toolOutput: toolOutputFromUpdate(update),
          toolOutcome: update.status === 'completed' ? 'success' : 'error',
        },
      ];
    }
    case 'user_message_chunk':
    case 'plan':
    case 'plan_update':
    case 'plan_removed':
    case 'available_commands_update':
    case 'current_mode_update':
    case 'config_option_update':
    case 'session_info_update':
    case 'usage_update':
    case 'compaction_update':
    case 'compaction_summary_chunk':
      return [];
    default: {
      const exhaustive: never = update;
      return exhaustive;
    }
  }
}
