import { describe, expect, test } from 'bun:test';
import type { SessionUpdate } from '@agentclientprotocol/sdk';

import {
  closeOutstandingGrokAcpTools,
  createGrokAcpEventState,
  mapGrokAcpSessionUpdate,
} from './acp-event-bridge';

describe('mapGrokAcpSessionUpdate', () => {
  test('maps an agent_message_chunk to an assistant delta with a stable block id', () => {
    const state = createGrokAcpEventState('turn-1');
    const update: SessionUpdate = {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'hello' },
    };
    expect(mapGrokAcpSessionUpdate(update, state)).toEqual([
      {
        type: 'assistant',
        content: 'hello',
        textMode: 'delta',
        blockId: 'grok-acp-turn-1-assistant-1',
      },
    ]);
  });

  test('maps an agent_thought_chunk to a thinking delta with a stable block id', () => {
    const state = createGrokAcpEventState('turn-1');
    const update: SessionUpdate = {
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text: 'pondering' },
    };
    expect(mapGrokAcpSessionUpdate(update, state)).toEqual([
      {
        type: 'thinking',
        content: 'pondering',
        textMode: 'delta',
        blockId: 'grok-acp-turn-1-thinking-1',
      },
    ]);
  });

  test('two turns mint different block ids for the same kind and sequence number', () => {
    // Each turn gets a fresh state whose block-id counter restarts at 1, so
    // the turn id is what keeps a later turn's first thinking block from
    // colliding with an earlier turn's block of the same kind and sequence.
    const thought = (text: string): SessionUpdate => ({
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text },
    });
    const [firstTurn] = mapGrokAcpSessionUpdate(thought('a'), createGrokAcpEventState());
    const [secondTurn] = mapGrokAcpSessionUpdate(thought('a'), createGrokAcpEventState());
    expect(firstTurn?.type === 'thinking' ? firstTurn.blockId : undefined).not.toBe(
      secondTurn?.type === 'thinking' ? secondTurn.blockId : undefined
    );
  });

  test('consecutive same-kind chunks share one block id; a kind switch mints a new one', () => {
    const state = createGrokAcpEventState();
    const thought = (text: string): SessionUpdate => ({
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text },
    });
    const message = (text: string): SessionUpdate => ({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text },
    });

    const [first] = mapGrokAcpSessionUpdate(thought('a'), state);
    const [second] = mapGrokAcpSessionUpdate(thought('b'), state);
    expect(first?.type === 'thinking' ? first.blockId : undefined).toBe(
      second?.type === 'thinking' ? second.blockId : undefined
    );

    const [assistant] = mapGrokAcpSessionUpdate(message('c'), state);
    expect(assistant?.type === 'assistant' ? assistant.blockId : undefined).not.toBe(
      first?.type === 'thinking' ? first.blockId : undefined
    );

    // Thinking resumes after the assistant chunk — it must not revive the
    // block from before the switch, or the row would fold out of order.
    const [thirdThought] = mapGrokAcpSessionUpdate(thought('d'), state);
    expect(thirdThought?.type === 'thinking' ? thirdThought.blockId : undefined).not.toBe(
      first?.type === 'thinking' ? first.blockId : undefined
    );
  });

  test('a tool call closes the open text block so the next chunk of either kind starts fresh', () => {
    const state = createGrokAcpEventState();
    const [beforeTool] = mapGrokAcpSessionUpdate(
      { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'thinking' } },
      state
    );
    mapGrokAcpSessionUpdate(
      { sessionUpdate: 'tool_call', toolCallId: 'call-x', title: 'run_terminal_command' },
      state
    );
    const [afterTool] = mapGrokAcpSessionUpdate(
      { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'thinking again' } },
      state
    );
    expect(afterTool?.type === 'thinking' ? afterTool.blockId : undefined).not.toBe(
      beforeTool?.type === 'thinking' ? beforeTool.blockId : undefined
    );
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

  test('a completed status carrying a BackgroundTaskStarted payload is not a real completion', () => {
    const state = createGrokAcpEventState();
    mapGrokAcpSessionUpdate(
      { sessionUpdate: 'tool_call', toolCallId: 'call-bg', title: 'run_terminal_command' },
      state
    );
    const backgrounded: SessionUpdate = {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call-bg',
      status: 'completed',
      rawOutput: { type: 'BackgroundTaskStarted', status: 'running' },
    };
    // No tool_result yet — the command is still running, not succeeded.
    expect(mapGrokAcpSessionUpdate(backgrounded, state)).toEqual([]);
    // The call stays open: turn end settles it 'unknown', never a guessed
    // outcome, and never twice (draining is idempotent).
    expect(closeOutstandingGrokAcpTools(state)).toEqual([
      {
        type: 'tool_result',
        toolName: 'run_terminal_command',
        toolCallId: 'call-bg',
        toolOutput: 'Grok ended before reporting a tool result.',
        toolOutcome: 'unknown',
        outputState: 'unknown',
      },
    ]);
    expect(closeOutstandingGrokAcpTools(state)).toEqual([]);
  });

  test('a later real completion after a backgrounded update still settles the call', () => {
    const state = createGrokAcpEventState();
    mapGrokAcpSessionUpdate(
      { sessionUpdate: 'tool_call', toolCallId: 'call-bg2', title: 'run_terminal_command' },
      state
    );
    mapGrokAcpSessionUpdate(
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'call-bg2',
        status: 'completed',
        rawOutput: { type: 'BackgroundTaskStarted', status: 'running' },
      },
      state
    );
    const finished: SessionUpdate = {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call-bg2',
      status: 'completed',
      rawOutput: { exit_code: 0, output_for_prompt: 'done\n' },
    };
    expect(mapGrokAcpSessionUpdate(finished, state)).toEqual([
      {
        type: 'tool_result',
        toolName: 'run_terminal_command',
        toolCallId: 'call-bg2',
        toolOutput: JSON.stringify({ exit_code: 0, output_for_prompt: 'done\n' }),
        toolOutcome: 'success',
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
