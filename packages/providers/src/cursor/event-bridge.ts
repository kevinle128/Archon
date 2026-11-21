import type { SDKMessage, TokenUsage as CursorTokenUsage } from '@cursor/sdk';

import type { MessageChunk, ModelUsageEntry, TokenUsage } from '../types';

export interface CursorEventState {
  usage?: CursorTokenUsage;
}

function stringifyToolValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable tool result]';
  }
}

function toToolInput(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

export function toArchonTokenUsage(usage: CursorTokenUsage | undefined): TokenUsage | undefined {
  if (!usage) return undefined;
  return {
    input: usage.inputTokens,
    output: usage.outputTokens,
  };
}

export function toCursorUsageEntry(
  usage: CursorTokenUsage | undefined,
  model: string | undefined
): ModelUsageEntry | undefined {
  if (!usage) return undefined;
  return {
    provider: 'cursor',
    model: model ?? null,
    modelSource: model ? 'reported' : 'unknown',
    requests: 1,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    ...(usage.reasoningTokens !== undefined ? { reasoningTokens: usage.reasoningTokens } : {}),
  };
}

export function mapCursorMessage(message: SDKMessage, state: CursorEventState): MessageChunk[] {
  switch (message.type) {
    case 'assistant':
      return message.message.content.flatMap(block => {
        switch (block.type) {
          case 'text':
            return block.text.length > 0
              ? [{ type: 'assistant' as const, content: block.text, textMode: 'complete' as const }]
              : [];
          case 'tool_use':
            // Cursor emits authoritative tool lifecycle through `tool_call`.
            return [];
          default: {
            const exhaustive: never = block;
            return exhaustive;
          }
        }
      });

    case 'thinking':
      return message.text.length > 0
        ? [{ type: 'thinking', content: message.text, textMode: 'complete' }]
        : [];

    case 'tool_call':
      if (message.status === 'running') {
        return [
          {
            type: 'tool',
            toolName: message.name,
            toolCallId: message.call_id,
            ...(toToolInput(message.args) ? { toolInput: toToolInput(message.args) } : {}),
          },
        ];
      }
      return [
        {
          type: 'tool_result',
          toolName: message.name,
          toolCallId: message.call_id,
          toolOutput: stringifyToolValue(message.result),
          toolOutcome: message.status === 'completed' ? 'success' : 'error',
          ...(message.truncated?.result !== undefined
            ? {
                truncated: message.truncated.result,
                outputState: message.truncated.result ? ('truncated' as const) : ('full' as const),
              }
            : {}),
        },
      ];

    case 'usage':
      state.usage = message.usage;
      return [];

    case 'status':
      return message.status === 'ERROR' && message.message
        ? [{ type: 'system', content: `Cursor run error: ${message.message}` }]
        : [];

    case 'task':
      return message.text ? [{ type: 'system', content: message.text }] : [];

    case 'summary':
      return message.status === 'error'
        ? [{ type: 'system', content: 'Cursor could not summarize the conversation.' }]
        : [];

    case 'system':
    case 'user':
    case 'request':
      return [];

    default: {
      const exhaustive: never = message;
      return exhaustive;
    }
  }
}
