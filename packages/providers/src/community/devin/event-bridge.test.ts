import { describe, expect, test } from 'bun:test';
import type { SessionUpdate } from '@agentclientprotocol/sdk';

import { createDevinEventState, devinToolName, mapDevinSessionUpdate } from './event-bridge';

const text = (
  kind: 'agent_message_chunk' | 'agent_thought_chunk' | 'user_message_chunk',
  t: string
): SessionUpdate => ({ sessionUpdate: kind, content: { type: 'text', text: t } }) as SessionUpdate;

describe('mapDevinSessionUpdate', () => {
  test('maps message and thought chunks; drops user chunks and housekeeping updates', () => {
    const state = createDevinEventState();
    expect(mapDevinSessionUpdate(text('agent_message_chunk', 'hi'), state)).toEqual([
      { type: 'assistant', content: 'hi', textMode: 'delta' },
    ]);
    expect(mapDevinSessionUpdate(text('agent_thought_chunk', 'hmm'), state)).toEqual([
      { type: 'thinking', content: 'hmm' },
    ]);
    expect(mapDevinSessionUpdate(text('user_message_chunk', 'me'), state)).toEqual([]);
    for (const update of [
      { sessionUpdate: 'usage_update', used: 1, size: 2 },
      { sessionUpdate: 'available_commands_update', availableCommands: [] },
      { sessionUpdate: 'current_mode_update', currentModeId: 'accept-edits' },
      { sessionUpdate: 'session_info_update' },
      { sessionUpdate: 'config_option_update', configOptions: [] },
    ] as unknown as SessionUpdate[]) {
      expect(mapDevinSessionUpdate(update, state)).toEqual([]);
    }
  });

  test('drops everything while replaying a loaded session', () => {
    const state = createDevinEventState();
    state.replaying = true;
    expect(mapDevinSessionUpdate(text('agent_message_chunk', 'old'), state)).toEqual([]);
    expect(
      mapDevinSessionUpdate(
        { sessionUpdate: 'tool_call', toolCallId: 'old-1', title: 'Read file' } as SessionUpdate,
        state
      )
    ).toEqual([]);
    expect(state.tools.size).toBe(0);
    state.replaying = false;
    expect(mapDevinSessionUpdate(text('agent_message_chunk', 'new'), state)).toEqual([
      { type: 'assistant', content: 'new', textMode: 'delta' },
    ]);
  });

  test('names tools from cognition.ai/inferenceToolName, then name, then title', () => {
    expect(
      devinToolName({ title: 'Read file', _meta: { 'cognition.ai/inferenceToolName': 'read' } })
    ).toBe('read');
    expect(devinToolName({ title: 'Read file', name: 'reader' })).toBe('reader');
    expect(devinToolName({ title: 'Read file' })).toBe('Read file');
    expect(devinToolName({})).toBeUndefined();
  });

  test('emits tool then tool_result with the remembered name and terminal status', () => {
    const state = createDevinEventState();
    const call = {
      sessionUpdate: 'tool_call',
      toolCallId: 'call_1',
      title: 'Listed MCP tools for gitnexus',
      rawInput: { server_name: 'gitnexus' },
      _meta: { 'cognition.ai/inferenceToolName': 'mcp_list_tools' },
    } as SessionUpdate;
    expect(mapDevinSessionUpdate(call, state)).toEqual([
      {
        type: 'tool',
        toolName: 'mcp_list_tools',
        toolCallId: 'call_1',
        toolInput: { server_name: 'gitnexus' },
      },
    ]);
    expect(
      mapDevinSessionUpdate(
        {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'call_1',
          status: 'in_progress',
        } as SessionUpdate,
        state
      )
    ).toEqual([]);
    expect(
      mapDevinSessionUpdate(
        {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'call_1',
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: '- `query`' } }],
        } as SessionUpdate,
        state
      )
    ).toEqual([
      {
        type: 'tool_result',
        toolName: 'mcp_list_tools',
        toolCallId: 'call_1',
        toolOutput: '- `query`',
        toolOutcome: 'success',
      },
    ]);
    expect(state.tools.has('call_1')).toBe(false);
  });

  test('records ask_user_question tool-call ids in order for elicitation correlation', () => {
    const state = createDevinEventState();
    const ask = (id: string): SessionUpdate =>
      ({
        sessionUpdate: 'tool_call',
        toolCallId: id,
        title: 'Asked user Which color?',
        rawInput: { questions: [] },
        _meta: { 'cognition.ai/inferenceToolName': 'ask_user_question' },
      }) as SessionUpdate;
    mapDevinSessionUpdate(ask('call_a'), state);
    mapDevinSessionUpdate(ask('call_b'), state);
    expect(state.pendingAskToolCallIds).toEqual(['call_a', 'call_b']);
    expect(
      mapDevinSessionUpdate(
        {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'call_a',
          status: 'failed',
          content: [
            { type: 'content', content: { type: 'text', text: 'Canceled due to user interrupt' } },
          ],
        } as SessionUpdate,
        state
      )
    ).toEqual([
      {
        type: 'tool_result',
        toolName: 'ask_user_question',
        toolCallId: 'call_a',
        toolOutput: 'Canceled due to user interrupt',
        toolOutcome: 'error',
      },
    ]);
  });

  test('removes a terminal ask id that no elicitation claimed', () => {
    const state = createDevinEventState();
    const ask = (id: string): SessionUpdate =>
      ({
        sessionUpdate: 'tool_call',
        toolCallId: id,
        title: 'Asked user Which color?',
        rawInput: { questions: [] },
        _meta: { 'cognition.ai/inferenceToolName': 'ask_user_question' },
      }) as SessionUpdate;
    mapDevinSessionUpdate(ask('call_a'), state);
    mapDevinSessionUpdate(ask('call_b'), state);
    mapDevinSessionUpdate(
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'call_a',
        status: 'failed',
      } as SessionUpdate,
      state
    );
    expect(state.pendingAskToolCallIds).toEqual(['call_b']);
  });
});
