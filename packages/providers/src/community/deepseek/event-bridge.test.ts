import { describe, expect, test } from 'bun:test';
import type { SessionUpdate } from '@agentclientprotocol/sdk';

import { createDeepseekEventState, mapDeepseekSessionUpdate } from './event-bridge';

describe('mapDeepseekSessionUpdate', () => {
  test('agent_message_chunk text maps to one assistant chunk', () => {
    const update = {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'hello from dsh' },
    } satisfies SessionUpdate;
    expect(mapDeepseekSessionUpdate(update, createDeepseekEventState())).toEqual([
      { type: 'assistant', content: 'hello from dsh', textMode: 'delta' },
    ]);
  });

  test('agent_thought_chunk text maps to one thinking chunk', () => {
    const update = {
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text: 'pondering' },
    } satisfies SessionUpdate;
    expect(mapDeepseekSessionUpdate(update, createDeepseekEventState())).toEqual([
      { type: 'thinking', content: 'pondering' },
    ]);
  });

  test('non-text message content is ignored rather than stringified', () => {
    const image = {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'image', data: 'abc', mimeType: 'image/png' },
    } satisfies SessionUpdate;
    const thoughtImage = {
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'image', data: 'abc', mimeType: 'image/png' },
    } satisfies SessionUpdate;
    expect(mapDeepseekSessionUpdate(image, createDeepseekEventState())).toEqual([]);
    expect(mapDeepseekSessionUpdate(thoughtImage, createDeepseekEventState())).toEqual([]);
  });

  test('tool_call emits a tool chunk with name ?? title, toolCallId, and object rawInput', () => {
    const named = {
      sessionUpdate: 'tool_call',
      toolCallId: 'call-1',
      title: 'Read file',
      name: 'read_file',
      rawInput: { path: '/tmp/a.ts' },
    } satisfies SessionUpdate;
    expect(mapDeepseekSessionUpdate(named, createDeepseekEventState())).toEqual([
      {
        type: 'tool',
        toolName: 'read_file',
        toolCallId: 'call-1',
        toolInput: { path: '/tmp/a.ts' },
      },
    ]);

    const titled = {
      sessionUpdate: 'tool_call',
      toolCallId: 'call-2',
      title: 'Shell',
      rawInput: { cmd: 'ls' },
    } satisfies SessionUpdate;
    expect(mapDeepseekSessionUpdate(titled, createDeepseekEventState())).toEqual([
      {
        type: 'tool',
        toolName: 'Shell',
        toolCallId: 'call-2',
        toolInput: { cmd: 'ls' },
      },
    ]);
  });

  test('non-object rawInput is preserved as { rawInput: value }', () => {
    const update = {
      sessionUpdate: 'tool_call',
      toolCallId: 'call-str',
      title: 'echo',
      rawInput: 'plain-string',
    } satisfies SessionUpdate;
    expect(mapDeepseekSessionUpdate(update, createDeepseekEventState())).toEqual([
      {
        type: 'tool',
        toolName: 'echo',
        toolCallId: 'call-str',
        toolInput: { rawInput: 'plain-string' },
      },
    ]);
  });

  test('in-progress tool_call_update stores name/input but emits no terminal result', () => {
    const state = createDeepseekEventState();
    mapDeepseekSessionUpdate(
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'call-3',
        title: 'old-title',
        name: 'old_name',
        rawInput: { a: 1 },
      } satisfies SessionUpdate,
      state
    );
    const chunks = mapDeepseekSessionUpdate(
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'call-3',
        status: 'in_progress',
        name: 'new_name',
        rawInput: { a: 2 },
      } satisfies SessionUpdate,
      state
    );
    expect(chunks).toEqual([]);
    expect(state.tools.get('call-3')).toEqual({ name: 'new_name', input: { a: 2 } });
  });

  test('completed update with no name uses the name stored from the matching start', () => {
    const state = createDeepseekEventState();
    mapDeepseekSessionUpdate(
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'call-4',
        title: 'Grep',
        name: 'grep',
        rawInput: { pattern: 'foo' },
      } satisfies SessionUpdate,
      state
    );
    expect(
      mapDeepseekSessionUpdate(
        {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'call-4',
          status: 'completed',
          content: [
            {
              type: 'content',
              content: { type: 'text', text: 'match' },
            },
          ],
        } satisfies SessionUpdate,
        state
      )
    ).toEqual([
      {
        type: 'tool_result',
        toolName: 'grep',
        toolCallId: 'call-4',
        toolOutput: 'match',
        toolOutcome: 'success',
      },
    ]);
  });

  test('pinned DSH nested content extracts the text string when rawOutput is absent', () => {
    const state = createDeepseekEventState();
    mapDeepseekSessionUpdate(
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'call-dsh',
        title: 'bash',
        name: 'bash',
      } satisfies SessionUpdate,
      state
    );
    expect(
      mapDeepseekSessionUpdate(
        {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'call-dsh',
          status: 'completed',
          content: [
            {
              type: 'content',
              content: { type: 'text', text: 'ok' },
            },
          ],
        } satisfies SessionUpdate,
        state
      )
    ).toEqual([
      {
        type: 'tool_result',
        toolName: 'bash',
        toolCallId: 'call-dsh',
        toolOutput: 'ok',
        toolOutcome: 'success',
      },
    ]);
  });

  test('structured rawOutput is JSON.stringified and takes precedence over display content', () => {
    const state = createDeepseekEventState();
    mapDeepseekSessionUpdate(
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'call-raw',
        title: 'search',
        name: 'search',
      } satisfies SessionUpdate,
      state
    );
    expect(
      mapDeepseekSessionUpdate(
        {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'call-raw',
          status: 'completed',
          rawOutput: { hits: 2 },
          content: [
            {
              type: 'content',
              content: { type: 'text', text: 'display only' },
            },
          ],
        } satisfies SessionUpdate,
        state
      )
    ).toEqual([
      {
        type: 'tool_result',
        toolName: 'search',
        toolCallId: 'call-raw',
        toolOutput: JSON.stringify({ hits: 2 }),
        toolOutcome: 'success',
      },
    ]);
  });

  test('completed maps to success and failed maps to error', () => {
    const state = createDeepseekEventState();
    mapDeepseekSessionUpdate(
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'ok-id',
        title: 'ok',
        name: 'ok',
      } satisfies SessionUpdate,
      state
    );
    mapDeepseekSessionUpdate(
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'err-id',
        title: 'err',
        name: 'err',
      } satisfies SessionUpdate,
      state
    );
    expect(
      mapDeepseekSessionUpdate(
        {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'ok-id',
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: 'done' } }],
        } satisfies SessionUpdate,
        state
      )[0]
    ).toMatchObject({ toolOutcome: 'success' });
    expect(
      mapDeepseekSessionUpdate(
        {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'err-id',
          status: 'failed',
          content: [{ type: 'content', content: { type: 'text', text: 'boom' } }],
        } satisfies SessionUpdate,
        state
      )[0]
    ).toMatchObject({ toolOutcome: 'error' });
  });

  test('a terminal update deletes stored tool state so a reused id cannot inherit stale data', () => {
    const state = createDeepseekEventState();
    mapDeepseekSessionUpdate(
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'reuse',
        title: 'first',
        name: 'first',
        rawInput: { n: 1 },
      } satisfies SessionUpdate,
      state
    );
    mapDeepseekSessionUpdate(
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'reuse',
        status: 'completed',
        content: [{ type: 'content', content: { type: 'text', text: 'one' } }],
      } satisfies SessionUpdate,
      state
    );
    expect(state.tools.has('reuse')).toBe(false);

    mapDeepseekSessionUpdate(
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'reuse',
        title: 'second',
        name: 'second',
        rawInput: { n: 2 },
      } satisfies SessionUpdate,
      state
    );
    expect(
      mapDeepseekSessionUpdate(
        {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'reuse',
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: 'two' } }],
        } satisfies SessionUpdate,
        state
      )
    ).toEqual([
      {
        type: 'tool_result',
        toolName: 'second',
        toolCallId: 'reuse',
        toolOutput: 'two',
        toolOutcome: 'success',
      },
    ]);
  });

  test('usage, plans, modes, config, session info, compaction, and user messages emit no chunks', () => {
    const state = createDeepseekEventState();
    const ignored: SessionUpdate[] = [
      {
        sessionUpdate: 'usage_update',
        used: 12,
        size: 128000,
        cost: { amount: 1.5, currency: 'USD' },
      },
      {
        sessionUpdate: 'plan',
        entries: [{ content: 'step', priority: 'medium', status: 'pending' }],
      },
      {
        sessionUpdate: 'plan_update',
        plan: { type: 'markdown', planId: 'p1', content: '# plan' },
      },
      { sessionUpdate: 'plan_removed', planId: 'p1' },
      { sessionUpdate: 'available_commands_update', availableCommands: [] },
      { sessionUpdate: 'current_mode_update', currentModeId: 'code' },
      { sessionUpdate: 'config_option_update', configOptions: [] },
      { sessionUpdate: 'session_info_update', title: 'session' },
      { sessionUpdate: 'compaction_update', compactionId: 'c1', status: 'in_progress' },
      {
        sessionUpdate: 'compaction_summary_chunk',
        compactionId: 'c1',
        content: { type: 'text', text: 'compacted' },
      },
      { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'user said hi' } },
    ];
    for (const update of ignored) {
      const chunks = mapDeepseekSessionUpdate(update, state);
      expect(chunks).toEqual([]);
      expect(JSON.stringify(chunks)).not.toMatch(/tokens|usageBreakdown|cost/);
    }
  });
});
