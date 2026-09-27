import type { ContentBlock, SessionUpdate, ToolCallContent } from '@agentclientprotocol/sdk';

import type { MessageChunk } from '../types';

export interface GrokAcpEventState {
  readonly tools: Map<string, { name: string; input?: Record<string, unknown> }>;
}

export function createGrokAcpEventState(): GrokAcpEventState {
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

/**
 * Matches the `--single` transport's `serialize()` in `event-parser.ts`: pass
 * strings through, JSON-stringify everything else. Grok's ACP `rawOutput`
 * carries the same rich per-tool object shape observed live (e.g. `{type:
 * 'Bash', output, exit_code, output_for_prompt, ...}`), so serializing it
 * keeps `toolOutput` shaped the same across both transports.
 */
function serializeToolOutput(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
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
  if (update.rawOutput !== undefined) return serializeToolOutput(update.rawOutput);
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
 *
 * Unlike the `--single` transport's `GrokEventParser` (which throws on a
 * malformed NDJSON record — that stream has no schema guarantee), ACP's
 * `ToolCall`/`ToolCallUpdate` shapes are protocol-typed with `toolCallId` and
 * `title` always present, so this bridge degrades gracefully (best-effort
 * name resolution) rather than throwing on an unexpected field.
 */
export function mapGrokAcpSessionUpdate(
  update: SessionUpdate,
  state: GrokAcpEventState
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

/** Any tool call still open when the turn ends (e.g. process torn down mid-tool). */
export function closeOutstandingGrokAcpTools(state: GrokAcpEventState): MessageChunk[] {
  const chunks: MessageChunk[] = [];
  for (const [toolCallId, tool] of state.tools) {
    chunks.push({
      type: 'tool_result',
      toolName: tool.name,
      toolCallId,
      toolOutput: 'Grok ended before reporting a tool result.',
      toolOutcome: 'unknown',
      outputState: 'unknown' as const,
    });
  }
  state.tools.clear();
  return chunks;
}
