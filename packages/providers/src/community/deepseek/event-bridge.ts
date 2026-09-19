import type { ContentBlock, SessionUpdate, ToolCallContent } from '@agentclientprotocol/sdk';

import type { MessageChunk } from '../../types';

export interface DeepseekEventState {
  readonly tools: Map<string, { name: string; input?: Record<string, unknown> }>;
}

export function createDeepseekEventState(): DeepseekEventState {
  return { tools: new Map() };
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
    .map(item => {
      if (item.type === 'content') return flattenContentBlock(item.content);
      return JSON.stringify(item);
    })
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

function rememberedName(
  update: { name?: string | null; title?: string | null },
  stored: { name: string } | undefined
): string {
  if (typeof update.name === 'string' && update.name.length > 0) return update.name;
  if (stored?.name) return stored.name;
  if (typeof update.title === 'string' && update.title.length > 0) return update.title;
  return 'unknown';
}

/**
 * Translate one ACP SessionUpdate into zero or more Archon MessageChunks.
 * Never maps usage_update into tokens, usageBreakdown, or cost.
 */
export function mapDeepseekSessionUpdate(
  update: SessionUpdate,
  state: DeepseekEventState
): MessageChunk[] {
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
      const name = update.name ?? update.title;
      const input = asToolInput(update.rawInput);
      state.tools.set(update.toolCallId, {
        name,
        ...(input !== undefined ? { input } : {}),
      });
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
      const name = rememberedName(update, stored);
      const input = update.rawInput !== undefined ? asToolInput(update.rawInput) : stored?.input;
      const terminal = update.status === 'completed' || update.status === 'failed';
      if (!terminal) {
        state.tools.set(update.toolCallId, {
          name,
          ...(input !== undefined ? { input } : {}),
        });
        return [];
      }
      state.tools.delete(update.toolCallId);
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
