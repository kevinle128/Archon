import { describe, expect, test } from 'bun:test';
import type { SessionUpdate } from '@agentclientprotocol/sdk';

import {
  closeOutstandingGrokAcpTools,
  createGrokAcpEventState,
  mapGrokAcpSessionUpdate,
} from './acp-event-bridge';

describe('mapGrokAcpSessionUpdate', () => {
  test('maps an agent_message_chunk to an assistant delta', () => {
    const state = createGrokAcpEventState();
    const update: SessionUpdate = {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'hello' },
    };
    expect(mapGrokAcpSessionUpdate(update, state)).toEqual([
      { type: 'assistant', content: 'hello', textMode: 'delta' },
    ]);
  });

  test('maps an agent_thought_chunk to a thinking chunk', () => {
    const state = createGrokAcpEventState();
    const update: SessionUpdate = {
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text: 'pondering' },
    };
    expect(mapGrokAcpSessionUpdate(update, state)).toEqual([
      { type: 'thinking', content: 'pondering' },
    ]);
  });

  test('ignores a non-text content block on message/thought chunks', () => {
    const state = createGrokAcpEventState();
    const update: SessionUpdate = {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'image', data: 'base64', mimeType: 'image/png' },
    };
    expect(mapGrokAcpSessionUpdate(update, state)).toEqual([]);
  });

  test('tool_call emits a tool chunk and remembers the name for later updates', () => {
    const state = createGrokAcpEventState();
    const toolCall: SessionUpdate = {
      sessionUpdate: 'tool_call',
      toolCallId: 'call-1',
      title: 'run_terminal_command',
      rawInput: { command: 'echo hi' },
    };
    expect(mapGrokAcpSessionUpdate(toolCall, state)).toEqual([
      {
        type: 'tool',
        toolName: 'run_terminal_command',
        toolCallId: 'call-1',
        toolInput: { command: 'echo hi' },
      },
    ]);

    const nonTerminal: SessionUpdate = {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call-1',
      status: 'in_progress',
      rawOutput: { partial: true },
    };
    expect(mapGrokAcpSessionUpdate(nonTerminal, state)).toEqual([]);

    const terminal: SessionUpdate = {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call-1',
      status: 'completed',
      rawOutput: { exit_code: 0, output_for_prompt: 'hi\n' },
    };
    expect(mapGrokAcpSessionUpdate(terminal, state)).toEqual([
      {
        type: 'tool_result',
        toolName: 'run_terminal_command',
        toolCallId: 'call-1',
        toolOutput: JSON.stringify({ exit_code: 0, output_for_prompt: 'hi\n' }),
        toolOutcome: 'success',
      },
    ]);
  });

  test('tool_call_update failed status maps to an error outcome', () => {
    const state = createGrokAcpEventState();
    mapGrokAcpSessionUpdate(
      { sessionUpdate: 'tool_call', toolCallId: 'call-2', title: 'read_file' },
      state
    );
    const failed: SessionUpdate = {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call-2',
      status: 'failed',
      content: [{ type: 'content', content: { type: 'text', text: 'not found' } }],
    };
    expect(mapGrokAcpSessionUpdate(failed, state)).toEqual([
      {
        type: 'tool_result',
        toolName: 'read_file',
        toolCallId: 'call-2',
        toolOutput: 'not found',
        toolOutcome: 'error',
      },
    ]);
  });

  test('tool_call_update falls back to the tool_call title when name is absent everywhere', () => {
    const state = createGrokAcpEventState();
    // No prior tool_call seen for this id (e.g. delivered out of order) and this
    // update carries neither `name` nor `title` — falls back to 'unknown'.
    const update: SessionUpdate = {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call-orphan',
      status: 'completed',
      rawOutput: 'done',
    };
    expect(mapGrokAcpSessionUpdate(update, state)).toEqual([
      {
        type: 'tool_result',
        toolName: 'unknown',
        toolCallId: 'call-orphan',
        toolOutput: 'done',
        toolOutcome: 'success',
      },
    ]);
  });

  test('administrative update kinds are ignored', () => {
    const state = createGrokAcpEventState();
    const update: SessionUpdate = {
      sessionUpdate: 'usage_update',
      usage: { inputTokens: 1 },
    };
    expect(mapGrokAcpSessionUpdate(update, state)).toEqual([]);
  });
});

describe('closeOutstandingGrokAcpTools', () => {
  test('synthesizes an unknown-outcome result for a tool never terminated', () => {
    const state = createGrokAcpEventState();
    mapGrokAcpSessionUpdate(
      { sessionUpdate: 'tool_call', toolCallId: 'call-hung', title: 'run_terminal_command' },
      state
    );
    expect(closeOutstandingGrokAcpTools(state)).toEqual([
      {
        type: 'tool_result',
        toolName: 'run_terminal_command',
        toolCallId: 'call-hung',
        toolOutput: 'Grok ended before reporting a tool result.',
        toolOutcome: 'unknown',
        outputState: 'unknown',
      },
    ]);
    // Draining clears state so a repeated call yields nothing further.
    expect(closeOutstandingGrokAcpTools(state)).toEqual([]);
  });

  test('is a no-op when every tool call already terminated', () => {
    const state = createGrokAcpEventState();
    mapGrokAcpSessionUpdate(
      { sessionUpdate: 'tool_call', toolCallId: 'call-3', title: 'grep' },
      state
    );
    mapGrokAcpSessionUpdate(
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'call-3',
        status: 'completed',
        rawOutput: 'ok',
      },
      state
    );
    expect(closeOutstandingGrokAcpTools(state)).toEqual([]);
  });
});
