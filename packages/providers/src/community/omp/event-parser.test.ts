import { describe, expect, test } from 'bun:test';

import { STREAM_ABORTED_TERMINAL_REASON } from '../../types';
import { OmpEventParser, messageUsageToEntry } from './event-parser';

const OMP_SUCCESS_LINES = [
  JSON.stringify({
    type: 'session',
    version: 3,
    id: 'omp-session-1',
    timestamp: '2026-08-06T00:00:00.000Z',
    cwd: '/repo',
  }),
  JSON.stringify({ type: 'message_start', message: { role: 'assistant', content: [] } }),
  JSON.stringify({
    type: 'message_update',
    assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: 'Think' },
  }),
  JSON.stringify({
    type: 'message_update',
    assistantMessageEvent: { type: 'text_delta', contentIndex: 1, delta: 'Hel' },
  }),
  JSON.stringify({
    type: 'message_update',
    assistantMessageEvent: { type: 'text_delta', contentIndex: 1, delta: 'lo' },
  }),
  JSON.stringify({
    type: 'message_end',
    message: {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Think' },
        { type: 'text', text: 'Hello' },
      ],
      provider: 'openai-codex',
      model: 'gpt-6-sol',
      usage: {
        input: 10,
        output: 5,
        cacheRead: 2,
        cacheWrite: 0,
        totalTokens: 17,
        cost: { input: 0.1, output: 0.1, cacheRead: 0, cacheWrite: 0, total: 0.2 },
      },
      stopReason: 'toolUse',
    },
  }),
  JSON.stringify({
    type: 'tool_execution_start',
    toolCallId: 'tool-1',
    toolName: 'read',
    args: { path: 'README.md' },
  }),
  JSON.stringify({
    type: 'tool_execution_end',
    toolCallId: 'tool-1',
    toolName: 'read',
    result: { content: [{ type: 'text', text: 'contents' }] },
    isError: false,
  }),
  JSON.stringify({ type: 'message_start', message: { role: 'assistant', content: [] } }),
  JSON.stringify({
    type: 'message_update',
    assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Done' },
  }),
  JSON.stringify({
    type: 'message_end',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'Done' }],
      provider: 'openai-codex',
      model: 'gpt-6-sol',
      usage: {
        input: 8,
        output: 2,
        cacheRead: 1,
        cacheWrite: 0,
        totalTokens: 11,
        cost: { input: 0.02, output: 0.03, cacheRead: 0, cacheWrite: 0, total: 0.05 },
      },
      stopReason: 'stop',
    },
  }),
  JSON.stringify({ type: 'agent_end', messages: [] }),
];

describe('OmpEventParser', () => {
  test('maps session, thinking, coalesced text, tools, usage, and model', () => {
    const parser = new OmpEventParser(true);
    const chunks = OMP_SUCCESS_LINES.flatMap(line => parser.consumeLine(line));
    const result = parser.buildResult(true);
    expect(chunks).toEqual([
      { type: 'thinking', content: 'Think' },
      { type: 'assistant', content: 'Hello' },
      { type: 'tool', toolName: 'read', toolInput: { path: 'README.md' }, toolCallId: 'tool-1' },
      {
        type: 'tool_result',
        toolName: 'read',
        toolOutput: '{"content":[{"type":"text","text":"contents"}]}',
        toolCallId: 'tool-1',
        toolOutcome: 'success',
        outputState: 'full',
      },
      { type: 'assistant', content: 'Done' },
    ]);
    expect(result).toMatchObject({
      type: 'result',
      sessionId: 'omp-session-1',
      tokens: { input: 18, output: 7, total: 28, cost: 0.25 },
      cost: 0.25,
      stopReason: 'stop',
      numTurns: 2,
      resolvedModel: { id: 'openai-codex/gpt-6-sol' },
      resumed: true,
      usageBreakdown: [
        {
          provider: 'openai-codex',
          model: 'gpt-6-sol',
          modelSource: 'reported',
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 2,
          cacheWriteTokens: 0,
          requests: 1,
          costUsd: 0.2,
        },
        {
          provider: 'openai-codex',
          model: 'gpt-6-sol',
          modelSource: 'reported',
          inputTokens: 8,
          outputTokens: 2,
          cacheReadTokens: 1,
          cacheWriteTokens: 0,
          requests: 1,
          costUsd: 0.05,
        },
      ],
    });
  });

  test('repairs only a strict missing suffix from message_end', () => {
    const parser = new OmpEventParser(false);
    parser.consumeLine(JSON.stringify({ type: 'session', id: 'session-tail' }));
    parser.consumeLine(JSON.stringify({ type: 'message_start', message: { role: 'assistant' } }));
    parser.consumeLine(
      JSON.stringify({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'hel' },
      })
    );
    expect(
      parser.consumeLine(
        JSON.stringify({ type: 'message_update', assistantMessageEvent: { type: 'text_end' } })
      )
    ).toEqual([{ type: 'assistant', content: 'hel' }]);
    expect(
      parser.consumeLine(
        JSON.stringify({
          type: 'message_end',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'hello' }],
            model: 'gpt-6-sol',
            usage: { input: 1, output: 1, totalTokens: 2, cost: { total: 0 } },
            stopReason: 'stop',
          },
        })
      )
    ).toEqual([{ type: 'assistant', content: 'lo' }]);
    parser.consumeLine(JSON.stringify({ type: 'agent_end', messages: [] }));
  });

  test('marks model errors on the terminal result', () => {
    const parser = new OmpEventParser(false);
    parser.consumeLine(JSON.stringify({ type: 'session', id: 'session-error' }));
    parser.consumeLine(
      JSON.stringify({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [],
          model: 'gpt-6-sol',
          usage: { input: 2, output: 0, totalTokens: 2, cost: { total: 0 } },
          stopReason: 'error',
          errorMessage: 'rate limited',
        },
      })
    );
    parser.consumeLine(JSON.stringify({ type: 'agent_end', messages: [] }));
    expect(parser.buildResult(undefined)).toMatchObject({
      type: 'result',
      isError: true,
      errorSubtype: 'error',
      errors: ['rate limited'],
    });
  });

  test('parses best-effort structured output from assistant text', () => {
    const parser = new OmpEventParser(true);
    parser.consumeLine(JSON.stringify({ type: 'session', id: 'session-json' }));
    parser.consumeLine(
      JSON.stringify({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: '{"answer":"ok"}' },
      })
    );
    parser.consumeLine(
      JSON.stringify({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: '{"answer":"ok"}' }],
          model: 'gpt-6-sol',
          usage: { input: 1, output: 1, totalTokens: 2, cost: { total: 0 } },
          stopReason: 'stop',
        },
      })
    );
    parser.consumeLine(JSON.stringify({ type: 'agent_end', messages: [] }));
    expect(parser.buildResult(undefined)).toMatchObject({ structuredOutput: { answer: 'ok' } });
  });

  test('rejects malformed NDJSON with a bounded preview', () => {
    const parser = new OmpEventParser(false);
    const recognizableTail = 'TAIL_MUST_NOT_APPEAR';
    const malformed = `${'x'.repeat(1_001)}${recognizableTail}`;
    let thrown: unknown;
    try {
      parser.consumeLine(malformed);
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain('invalid JSON');
    expect((thrown as Error).message).not.toContain(recognizableTail);
  });

  test('rejects records without a non-empty string event type', () => {
    for (const event of [{}, { type: '' }, { type: 42 }]) {
      const parser = new OmpEventParser(false);
      expect(() => parser.consumeLine(JSON.stringify(event))).toThrow(
        'non-empty string event type'
      );
    }
  });

  test('ignores unknown future string event types', () => {
    const parser = new OmpEventParser(false);
    expect(
      parser.consumeLine(JSON.stringify({ type: 'future_event', payload: { version: 2 } }))
    ).toEqual([]);
  });

  test('fails incomplete success streams instead of inventing a result', () => {
    const parser = new OmpEventParser(false);
    parser.consumeLine(JSON.stringify({ type: 'session', id: 'session-incomplete' }));
    expect(parser.buildResult(undefined)).toMatchObject({
      isError: true,
      errorSubtype: 'omp_incomplete_output',
    });
  });

  test('succeeds when a finished assistant turn has no agent_end', () => {
    const parser = new OmpEventParser(false);
    for (const line of OMP_SUCCESS_LINES.slice(0, -1)) parser.consumeLine(line);
    const result = parser.buildResult(undefined);
    expect(result).toMatchObject({
      sessionId: 'omp-session-1',
      stopReason: 'stop',
    });
    expect(result).not.toHaveProperty('isError');
  });

  test('fails an unfinished later assistant turn without emitting its tail', () => {
    const parser = new OmpEventParser(false);
    parser.consumeLine(JSON.stringify({ type: 'session', id: 'session-partial' }));
    parser.consumeLine(JSON.stringify({ type: 'message_end', message: completeMessage('first') }));
    parser.consumeLine(JSON.stringify({ type: 'message_start', message: { role: 'assistant' } }));
    parser.consumeLine(
      JSON.stringify({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'partial' },
      })
    );
    expect(parser.consumeLine(JSON.stringify({ type: 'agent_end' }))).toEqual([]);
    expect(parser.buildResult(undefined)).toMatchObject({
      isError: true,
      errorSubtype: 'omp_incomplete_output',
    });
  });

  test('rejects overlapping assistant messages and conflicting session headers', () => {
    const parser = new OmpEventParser(false);
    parser.consumeLine(JSON.stringify({ type: 'session', id: 'session-one' }));
    expect(() =>
      parser.consumeLine(JSON.stringify({ type: 'session', id: 'session-two' }))
    ).toThrow('conflicting');
    parser.consumeLine(JSON.stringify({ type: 'message_start', message: { role: 'assistant' } }));
    expect(() =>
      parser.consumeLine(JSON.stringify({ type: 'message_start', message: { role: 'assistant' } }))
    ).toThrow('unfinished');
  });

  test('tolerates an orphan tool end but rejects malformed and mismatched tool events', () => {
    const parser = new OmpEventParser(false);
    parser.consumeLine(JSON.stringify({ type: 'session', id: 'session-tools' }));
    expect(() =>
      parser.consumeLine(
        JSON.stringify({ type: 'tool_execution_start', toolName: 'read', args: {} })
      )
    ).toThrow('toolCallId');
    // A superseded/duplicate end whose start is not open is swallowed, not fatal.
    expect(
      parser.consumeLine(
        JSON.stringify({
          type: 'tool_execution_end',
          toolCallId: 'missing',
          toolName: 'read',
          result: {},
        })
      )
    ).toEqual([]);
    parser.consumeLine(
      JSON.stringify({
        type: 'tool_execution_start',
        toolCallId: 'one',
        toolName: 'read',
        args: {},
      })
    );
    expect(() =>
      parser.consumeLine(
        JSON.stringify({
          type: 'tool_execution_end',
          toolCallId: 'one',
          toolName: 'write',
          result: {},
        })
      )
    ).toThrow('mismatched');
    expect(() =>
      parser.consumeLine(
        JSON.stringify({
          type: 'tool_execution_end',
          toolCallId: 'one',
          toolName: 'read',
          isError: true,
        })
      )
    ).toThrow('result');
  });

  test('does not duplicate mismatched final text or use it as structured output', () => {
    const parser = new OmpEventParser(true);
    parser.consumeLine(JSON.stringify({ type: 'session', id: 'session-mismatch' }));
    parser.consumeLine(JSON.stringify({ type: 'message_start', message: { role: 'assistant' } }));
    parser.consumeLine(
      JSON.stringify({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: '{"answer":"streamed"}' },
      })
    );
    expect(
      parser.consumeLine(
        JSON.stringify({ type: 'message_update', assistantMessageEvent: { type: 'text_end' } })
      )
    ).toEqual([{ type: 'assistant', content: '{"answer":"streamed"}' }]);
    expect(
      parser.consumeLine(
        JSON.stringify({ type: 'message_end', message: completeMessage('{"answer":"final"}') })
      )
    ).toEqual([]);
    parser.consumeLine(JSON.stringify({ type: 'agent_end' }));
    expect(parser.buildResult(undefined)).toMatchObject({
      isError: true,
      errorSubtype: 'omp_stream_mismatch',
    });
    expect(parser.buildResult(undefined)).not.toHaveProperty('structuredOutput');
  });

  test('rejects invalid assistant terminals and outstanding tools at agent_end', () => {
    const parser = new OmpEventParser(false);
    parser.consumeLine(JSON.stringify({ type: 'session', id: 'session-terminal' }));
    expect(() =>
      parser.consumeLine(
        JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: [] } })
      )
    ).toThrow('usage');
    parser.consumeLine(JSON.stringify({ type: 'message_end', message: completeMessage('done') }));
    parser.consumeLine(JSON.stringify({ type: 'agent_end' }));

    const withTool = new OmpEventParser(false);
    withTool.consumeLine(JSON.stringify({ type: 'session', id: 'session-open-tool' }));
    withTool.consumeLine(
      JSON.stringify({
        type: 'tool_execution_start',
        toolCallId: 'one',
        toolName: 'read',
        args: {},
      })
    );
    expect(() => withTool.consumeLine(JSON.stringify({ type: 'agent_end' }))).toThrow(
      'outstanding tool'
    );
  });

  test('treats agent_end as turn end and ignores trailing maintenance events', () => {
    const parser = new OmpEventParser(false);
    for (const line of OMP_SUCCESS_LINES) parser.consumeLine(line);
    expect(
      parser.consumeLine(JSON.stringify({ type: 'notice', message: 'Todo completion reminder' }))
    ).toEqual([]);
    expect(
      parser.consumeLine(JSON.stringify({ type: 'custom_message', customType: 'advisor' }))
    ).toEqual([]);
    expect(parser.consumeLine(JSON.stringify({ type: 'agent_end', messages: [] }))).toEqual([]);
    const result = parser.buildResult(undefined);
    expect(result).toMatchObject({
      sessionId: 'omp-session-1',
      stopReason: 'stop',
    });
    expect(result).not.toHaveProperty('isError');
  });

  test('parses a follow-up assistant turn after agent_end', () => {
    const parser = new OmpEventParser(false);
    for (const line of OMP_SUCCESS_LINES) parser.consumeLine(line);
    const chunks = [
      JSON.stringify({ type: 'message_start', message: { role: 'assistant', content: [] } }),
      JSON.stringify({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Again' },
      }),
      JSON.stringify({ type: 'message_end', message: completeMessage('Again') }),
      JSON.stringify({ type: 'agent_end' }),
    ].flatMap(line => parser.consumeLine(line));
    expect(chunks).toEqual([{ type: 'assistant', content: 'Again' }]);
    const result = parser.buildResult(undefined);
    expect(result).toMatchObject({
      sessionId: 'omp-session-1',
      stopReason: 'stop',
    });
    expect(result).not.toHaveProperty('isError');
  });

  test('continues after an orphan tool_execution_end instead of aborting the run', () => {
    // Regression: a tool_execution_end can arrive whose start is not open (its id
    // was already closed, or its start was never seen). The parser used to throw
    // 'unmatched tool_execution_end', which made the provider raise
    // omp_protocol_error and SIGTERM the CLI, failing the node. It must stay
    // non-fatal so the turn completes.
    const parser = new OmpEventParser(false);
    parser.consumeLine(JSON.stringify({ type: 'session', id: 'omp-session-1' }));
    parser.consumeLine(
      JSON.stringify({ type: 'tool_execution_start', toolCallId: 't1', toolName: 'read', args: {} })
    );
    expect(
      parser.consumeLine(
        JSON.stringify({
          type: 'tool_execution_end',
          toolCallId: 't1',
          toolName: 'read',
          result: { content: [{ type: 'text', text: 'ok' }] },
        })
      )
    ).toEqual([
      {
        type: 'tool_result',
        toolName: 'read',
        toolOutput: expect.any(String),
        toolCallId: 't1',
        toolOutcome: 'success',
        outputState: 'full',
      },
    ]);
    // Superseding synthetic end for the already-closed call — previously fatal.
    expect(
      parser.consumeLine(
        JSON.stringify({
          type: 'tool_execution_end',
          toolCallId: 't1',
          toolName: 'read',
          isError: true,
          result: { content: [{ type: 'text', text: 'Tool execution was aborted.' }] },
        })
      )
    ).toEqual([]);
    parser.consumeLine(JSON.stringify({ type: 'message_end', message: completeMessage('done') }));
    parser.consumeLine(JSON.stringify({ type: 'agent_end' }));
    const result = parser.buildResult(undefined);
    expect(result).toMatchObject({ sessionId: 'omp-session-1', stopReason: 'stop' });
    expect(result).not.toHaveProperty('isError');
  });

  test('exposes session/turn/natural-end queries without changing happy-path chunks', () => {
    const parser = new OmpEventParser(false);
    expect(parser.hasSession()).toBe(false);
    expect(parser.hasTurnActivity()).toBe(false);
    expect(parser.hasNaturalTurnEnded()).toBe(false);

    parser.consumeLine(JSON.stringify({ type: 'session', id: 's1' }));
    expect(parser.hasSession()).toBe(true);
    expect(parser.hasTurnActivity()).toBe(false);

    parser.consumeLine(
      JSON.stringify({ type: 'message_start', message: { role: 'assistant', content: [] } })
    );
    expect(parser.hasTurnActivity()).toBe(true);

    parser.consumeLine(
      JSON.stringify({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'Hi' },
      })
    );
    parser.consumeLine(JSON.stringify({ type: 'message_end', message: completeMessage('Hi') }));
    expect(parser.hasNaturalTurnEnded()).toBe(false);
    parser.consumeLine(JSON.stringify({ type: 'agent_end', messages: [] }));
    expect(parser.hasNaturalTurnEnded()).toBe(true);
  });

  test('drainPendingAssistant is idempotent over flushAssistant', () => {
    const parser = new OmpEventParser(false);
    parser.consumeLine(JSON.stringify({ type: 'session', id: 's1' }));
    parser.consumeLine(
      JSON.stringify({ type: 'message_start', message: { role: 'assistant', content: [] } })
    );
    parser.consumeLine(
      JSON.stringify({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'Hel' },
      })
    );
    parser.consumeLine(
      JSON.stringify({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'lo' },
      })
    );
    expect(parser.drainPendingAssistant()).toEqual([{ type: 'assistant', content: 'Hello' }]);
    expect(parser.drainPendingAssistant()).toEqual([]);
  });

  test('buildInterruptedResult keeps only session/accounting/model and stream_aborted marker', () => {
    const parser = new OmpEventParser(true);
    parser.consumeLine(JSON.stringify({ type: 'session', id: 's-int' }));
    parser.consumeLine(
      JSON.stringify({ type: 'message_start', message: { role: 'assistant', content: [] } })
    );
    parser.consumeLine(
      JSON.stringify({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: '{"a":1}' },
      })
    );
    parser.consumeLine(
      JSON.stringify({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: '{"a":1}' }],
          provider: 'openai-codex',
          model: 'gpt-6-sol',
          usage: { input: 3, output: 2, totalTokens: 5, cost: { total: 0.1 } },
          stopReason: 'error',
          errorMessage: 'should not leak',
        },
      })
    );
    const result = parser.buildInterruptedResult(true);
    expect(result).toEqual({
      type: 'result',
      sessionId: 's-int',
      tokens: { input: 3, output: 2, total: 5, cost: 0.1 },
      cost: 0.1,
      numTurns: 1,
      usageBreakdown: [
        {
          provider: 'openai-codex',
          model: 'gpt-6-sol',
          modelSource: 'reported',
          inputTokens: 3,
          outputTokens: 2,
          requests: 1,
          costUsd: 0.1,
        },
      ],
      resolvedModel: { id: 'openai-codex/gpt-6-sol' },
      resumed: true,
      terminalReason: STREAM_ABORTED_TERMINAL_REASON,
    });
    expect(result).not.toHaveProperty('stopReason');
    expect(result).not.toHaveProperty('structuredOutput');
    expect(result).not.toHaveProperty('isError');
    expect(result).not.toHaveProperty('errorSubtype');
    expect(result).not.toHaveProperty('errors');
  });

  test('buildInterruptedResult never fabricates a session id', () => {
    const parser = new OmpEventParser(false);
    const result = parser.buildInterruptedResult(undefined);
    expect(result).toEqual({
      type: 'result',
      terminalReason: STREAM_ABORTED_TERMINAL_REASON,
    });
    expect(result).not.toHaveProperty('sessionId');
    expect(result).not.toHaveProperty('resumed');
  });

  test('interrupt mode maps Stop-caused errored tool end to interrupted without failure warning', () => {
    const parser = new OmpEventParser(false);
    parser.consumeLine(JSON.stringify({ type: 'session', id: 's-tool' }));
    const startChunks = parser.consumeLine(
      JSON.stringify({
        type: 'tool_execution_start',
        toolCallId: 't1',
        toolName: 'bash',
        args: { command: 'sleep 10' },
      })
    );
    expect(startChunks).toEqual([
      { type: 'tool', toolName: 'bash', toolInput: { command: 'sleep 10' }, toolCallId: 't1' },
    ]);
    parser.beginOperatorInterrupt();
    const endChunks = parser.consumeLine(
      JSON.stringify({
        type: 'tool_execution_end',
        toolCallId: 't1',
        toolName: 'bash',
        isError: true,
        result: 'signal',
      })
    );
    expect(endChunks).toEqual([
      {
        type: 'tool_result',
        toolName: 'bash',
        toolOutput: 'signal',
        toolCallId: 't1',
        toolOutcome: 'interrupted',
        outputState: 'full',
      },
    ]);
    expect(endChunks.some(c => c.type === 'system')).toBe(false);
  });

  test('interrupt mode keeps late successful tool end as success', () => {
    const parser = new OmpEventParser(false);
    parser.consumeLine(JSON.stringify({ type: 'session', id: 's-tool' }));
    parser.consumeLine(
      JSON.stringify({
        type: 'tool_execution_start',
        toolCallId: 't1',
        toolName: 'read',
        args: { path: 'a' },
      })
    );
    parser.beginOperatorInterrupt();
    expect(
      parser.consumeLine(
        JSON.stringify({
          type: 'tool_execution_end',
          toolCallId: 't1',
          toolName: 'read',
          isError: false,
          result: 'ok',
        })
      )
    ).toEqual([
      {
        type: 'tool_result',
        toolName: 'read',
        toolOutput: 'ok',
        toolCallId: 't1',
        toolOutcome: 'success',
        outputState: 'full',
      },
    ]);
  });

  test('without beginOperatorInterrupt errored tool end keeps failure warning', () => {
    const parser = new OmpEventParser(false);
    parser.consumeLine(JSON.stringify({ type: 'session', id: 's-tool' }));
    parser.consumeLine(
      JSON.stringify({
        type: 'tool_execution_start',
        toolCallId: 't1',
        toolName: 'bash',
        args: { command: 'x' },
      })
    );
    const chunks = parser.consumeLine(
      JSON.stringify({
        type: 'tool_execution_end',
        toolCallId: 't1',
        toolName: 'bash',
        isError: true,
        result: 'boom',
      })
    );
    expect(chunks[0]).toMatchObject({
      type: 'system',
      content: expect.stringContaining('failed'),
    });
    expect(chunks[1]).toMatchObject({ toolOutcome: 'error' });
  });
});

function completeMessage(text: string): Record<string, unknown> {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    model: 'gpt-6-sol',
    usage: { input: 1, output: 1, totalTokens: 2, cost: { total: 0 } },
    stopReason: 'stop',
  };
}

describe('usageBreakdown missingness (US-017)', () => {
  test('messageUsageToEntry omits missing/blank provider without fabricating unknown', () => {
    const usage = { input: 3, output: 1, totalTokens: 4, cost: { total: 0.02 } };
    expect(messageUsageToEntry({ model: 'm' }, usage)).toBeUndefined();
    expect(messageUsageToEntry({ provider: '', model: 'm' }, usage)).toBeUndefined();
    expect(messageUsageToEntry({ provider: '   ', model: 'm' }, usage)).toBeUndefined();
    expect(messageUsageToEntry({ provider: 'openai-codex', model: 'm' }, usage)).toMatchObject({
      provider: 'openai-codex',
      model: 'm',
      modelSource: 'reported',
      inputTokens: 3,
      outputTokens: 1,
      costUsd: 0.02,
      requests: 1,
    });
  });

  test('primary stream keeps valid siblings and legacy totals when one provider is blank', () => {
    const parser = new OmpEventParser(false);
    parser.consumeLine(JSON.stringify({ type: 'session', id: 'omp-miss' }));
    for (const message of [
      {
        role: 'assistant',
        provider: 'openai-codex',
        model: 'first',
        content: [{ type: 'text', text: 'A' }],
        usage: { input: 2, output: 1, totalTokens: 3, cost: { total: 0.1 } },
        stopReason: 'stop',
      },
      {
        role: 'assistant',
        provider: '',
        model: 'blank',
        content: [{ type: 'text', text: 'B' }],
        usage: { input: 9, output: 9, totalTokens: 18, cost: { total: 0.9 } },
        stopReason: 'stop',
      },
      {
        role: 'assistant',
        model: 'missing',
        content: [{ type: 'text', text: 'C' }],
        usage: { input: 4, output: 1, totalTokens: 5, cost: { total: 0.04 } },
        stopReason: 'stop',
      },
      {
        role: 'assistant',
        provider: 'anthropic',
        model: 'last',
        content: [{ type: 'text', text: 'D' }],
        usage: { input: 1, output: 0, totalTokens: 1, cost: { total: 0 } },
        stopReason: 'stop',
      },
    ]) {
      parser.consumeLine(JSON.stringify({ type: 'message_start', message: { role: 'assistant' } }));
      parser.consumeLine(
        JSON.stringify({
          type: 'message_update',
          assistantMessageEvent: { type: 'text_delta', delta: message.content[0].text },
        })
      );
      parser.consumeLine(JSON.stringify({ type: 'message_end', message }));
    }
    parser.consumeLine(JSON.stringify({ type: 'agent_end', messages: [] }));
    const result = parser.buildResult(undefined);
    expect(result.tokens).toEqual({ input: 16, output: 11, total: 27, cost: 1.04 });
    expect(result.cost).toBe(1.04);
    expect(result.stopReason).toBe('stop');
    expect(result.numTurns).toBe(4);
    expect(result.usageBreakdown).toEqual([
      {
        provider: 'openai-codex',
        model: 'first',
        modelSource: 'reported',
        inputTokens: 2,
        outputTokens: 1,
        requests: 1,
        costUsd: 0.1,
      },
      {
        provider: 'anthropic',
        model: 'last',
        modelSource: 'reported',
        inputTokens: 1,
        outputTokens: 0,
        requests: 1,
        costUsd: 0,
      },
    ]);
    expect(result.usageBreakdown?.some(e => e.provider === 'unknown')).toBe(false);
  });
});
