import { describe, expect, test } from 'bun:test';

import { AskHumanAwaitingError, type MessageChunk, type NativeTool } from '../types';
import { E2E_FAKE_CAPABILITIES } from './capabilities';
import {
  E2E_FAKE_AGENT_INPUT,
  E2E_FAKE_AGENT_TOOL_NAME,
  E2E_FAKE_LOOP_DONE,
  E2E_FAKE_TASK_OMP_INPUT,
  E2E_FAKE_TASK_TOOL_NAME,
  E2E_FAKE_TODO_INPUTS,
  E2E_FAKE_TODO_OUTPUT,
  E2E_FAKE_TODO_TOOL_NAME,
  E2E_FAKE_TOOL_NAME,
  E2E_FAKE_TOOL_OUTPUT,
  E2E_FAKE_TOOL_PASS_TEXT,
  E2eFakeProvider,
} from './provider';

const USAGE =
  '<<E2E_USAGE>>[{"provider":"anthropic","model":"claude-sonnet-4","modelSource":"reported","inputTokens":1,"outputTokens":1,"costUsd":0.01}]<</E2E_USAGE>>';

async function collect(stream: AsyncGenerator<MessageChunk>): Promise<MessageChunk[]> {
  const chunks: MessageChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

function askTool(handler: NativeTool['handler']): NativeTool {
  return {
    name: 'AskHuman',
    description: 'test AskHuman',
    inputSchema: { type: 'object' },
    handler,
  };
}

describe('E2eFakeProvider', () => {
  const provider = new E2eFakeProvider();

  test('retains no-directive assistant + result with no usage', async () => {
    const chunks = await collect(provider.sendQuery('plain prompt', '/tmp'));
    expect(chunks).toEqual([
      { type: 'assistant', content: '[e2e-fake] deterministic response' },
      { type: 'result', sessionId: expect.any(String) },
    ]);
    const result = chunks[1];
    if (result.type !== 'result') throw new Error('expected result');
    expect(result.usageBreakdown).toBeUndefined();
    expect(result.resumed).toBeUndefined();
  });

  test('retains usage-directive result entries', async () => {
    const chunks = await collect(provider.sendQuery(USAGE, '/tmp'));
    const result = chunks[chunks.length - 1];
    if (result.type !== 'result') throw new Error('expected result');
    expect(result.usageBreakdown).toEqual([
      {
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        modelSource: 'reported',
        inputTokens: 1,
        outputTokens: 1,
        costUsd: 0.01,
      },
    ]);
  });

  test('emits tool call and tool_result for emitTool scenario', async () => {
    const prompt = '<<E2E_SCENARIO>>{"emitTool":true}<</E2E_SCENARIO>>';
    const chunks = await collect(provider.sendQuery(prompt, '/tmp'));
    expect(chunks[0]).toEqual({ type: 'assistant', content: E2E_FAKE_TOOL_PASS_TEXT });
    expect(chunks[1]).toMatchObject({
      type: 'tool',
      toolName: E2E_FAKE_TOOL_NAME,
      toolInput: { path: 'HITL_TOOL_INPUT.txt' },
    });
    expect(chunks[2]).toMatchObject({
      type: 'tool_result',
      toolName: E2E_FAKE_TOOL_NAME,
      toolOutput: E2E_FAKE_TOOL_OUTPUT,
      toolOutcome: 'success',
    });
    if (chunks[1].type !== 'tool' || chunks[2].type !== 'tool_result') {
      throw new Error('expected tool pair');
    }
    expect(chunks[1].toolCallId).toBe(chunks[2].toolCallId);
  });

  test('omitted repeatTool keeps the unsuffixed tool id and chunk sequence', async () => {
    const prompt = '<<E2E_SCENARIO>>{"emitTool":true}<</E2E_SCENARIO>>';
    const chunks = await collect(provider.sendQuery(prompt, '/tmp', 'sess'));
    expect(chunks[0]).toEqual({ type: 'assistant', content: E2E_FAKE_TOOL_PASS_TEXT });
    expect(chunks[1]).toMatchObject({
      type: 'tool',
      toolName: E2E_FAKE_TOOL_NAME,
      toolCallId: 'e2e-fake-tool-sess',
    });
    expect(chunks[2]).toMatchObject({
      type: 'tool_result',
      toolName: E2E_FAKE_TOOL_NAME,
      toolOutput: E2E_FAKE_TOOL_OUTPUT,
      toolCallId: 'e2e-fake-tool-sess',
      toolOutcome: 'success',
    });
    const tools = chunks.filter(chunk => chunk.type === 'tool');
    expect(tools).toHaveLength(1);
  });

  test('repeatTool emits distinct sequential call/result pairs', async () => {
    const prompt = '<<E2E_SCENARIO>>{"emitTool":true,"repeatTool":3}<</E2E_SCENARIO>>';
    const chunks = await collect(provider.sendQuery(prompt, '/tmp', 'sess'));
    expect(chunks[0]).toEqual({ type: 'assistant', content: E2E_FAKE_TOOL_PASS_TEXT });
    const tools = chunks.filter(chunk => chunk.type === 'tool');
    const results = chunks.filter(chunk => chunk.type === 'tool_result');
    expect(tools).toHaveLength(3);
    expect(results).toHaveLength(3);
    const ids = tools.map(chunk => {
      if (chunk.type !== 'tool') throw new Error('expected tool');
      return chunk.toolCallId;
    });
    expect(ids).toEqual(['e2e-fake-tool-sess-1', 'e2e-fake-tool-sess-2', 'e2e-fake-tool-sess-3']);
    expect(new Set(ids).size).toBe(3);
    for (let index = 0; index < 3; index += 1) {
      const tool = tools[index];
      const result = results[index];
      if (tool?.type !== 'tool' || result?.type !== 'tool_result') {
        throw new Error('expected tool pair');
      }
      expect(tool.toolCallId).toBe(result.toolCallId);
      expect(chunks[1 + index * 2]?.type).toBe('tool');
      expect(chunks[2 + index * 2]?.type).toBe('tool_result');
    }
  });
  test('largeLastToolOutput expands only the final repeated result', async () => {
    const prompt =
      '<<E2E_SCENARIO>>{"emitTool":true,"repeatTool":2,"largeLastToolOutput":true}<</E2E_SCENARIO>>';
    const chunks = await collect(provider.sendQuery(prompt, '/tmp', 'sess'));
    const results = chunks.filter(chunk => chunk.type === 'tool_result');
    expect(results).toHaveLength(2);
    expect(results[0]?.type === 'tool_result' ? results[0].toolOutput : '').toBe(
      E2E_FAKE_TOOL_OUTPUT
    );
    const lastOutput = results[1]?.type === 'tool_result' ? results[1].toolOutput : '';
    expect(lastOutput.length).toBeGreaterThan(16_384);
    expect(lastOutput).toContain('[e2e-fake] full output tail');
  });


  test('taskDispatch omp emits one Task call with the exact batch input and paired result', async () => {
    const prompt = '<<E2E_SCENARIO>>{"taskDispatch":"omp"}<</E2E_SCENARIO>>';
    const chunks = await collect(provider.sendQuery(prompt, '/tmp', 'sess'));
    expect(chunks).toHaveLength(4);
    expect(chunks[0]).toEqual({ type: 'assistant', content: E2E_FAKE_TOOL_PASS_TEXT });
    expect(chunks[1]).toEqual({
      type: 'tool',
      toolName: E2E_FAKE_TASK_TOOL_NAME,
      toolInput: E2E_FAKE_TASK_OMP_INPUT,
      toolCallId: 'e2e-fake-tool-sess',
    });
    expect(chunks[2]).toEqual({
      type: 'tool_result',
      toolName: E2E_FAKE_TASK_TOOL_NAME,
      toolOutput: E2E_FAKE_TOOL_OUTPUT,
      toolCallId: 'e2e-fake-tool-sess',
      toolOutcome: 'success',
    });
    expect(chunks[3]).toMatchObject({ type: 'result', sessionId: 'sess' });
  });

  test('taskDispatch omp input carries markdown context and two distinct subtasks', async () => {
    const prompt = '<<E2E_SCENARIO>>{"taskDispatch":"omp"}<</E2E_SCENARIO>>';
    const chunks = await collect(provider.sendQuery(prompt, '/tmp', 'sess'));
    const tool = chunks[1];
    if (tool?.type !== 'tool') throw new Error('expected tool');
    const input = tool.toolInput as {
      context: string;
      tasks: { name: string; agent: string; task: string }[];
    };
    expect(input.context).toContain('**');
    expect(input.context).toContain('- ');
    expect(input.context).toContain('![');
    expect(input.context).toContain('javascript:');
    expect(input.tasks).toHaveLength(2);
    expect(new Set(input.tasks.map(t => t.name)).size).toBe(2);
    expect(new Set(input.tasks.map(t => t.agent)).size).toBe(2);
    for (const task of input.tasks) expect(task.task).toContain('\n');
  });

  test('taskDispatch claude emits one Agent call with no subagent_type key', async () => {
    const prompt = '<<E2E_SCENARIO>>{"taskDispatch":"claude"}<</E2E_SCENARIO>>';
    const chunks = await collect(provider.sendQuery(prompt, '/tmp', 'sess'));
    expect(chunks).toHaveLength(4);
    expect(chunks[0]).toEqual({ type: 'assistant', content: E2E_FAKE_TOOL_PASS_TEXT });
    const tool = chunks[1];
    if (tool?.type !== 'tool') throw new Error('expected tool');
    expect(tool.toolName).toBe(E2E_FAKE_AGENT_TOOL_NAME);
    expect(tool.toolInput).toEqual(E2E_FAKE_AGENT_INPUT);
    expect(Object.hasOwn(tool.toolInput as Record<string, unknown>, 'subagent_type')).toBe(false);
    const result = chunks[2];
    if (result?.type !== 'tool_result') throw new Error('expected tool_result');
    expect(result.toolName).toBe(E2E_FAKE_AGENT_TOOL_NAME);
    expect(result.toolCallId).toBe(tool.toolCallId);
    expect(result.toolOutcome).toBe('success');
    expect(result.toolOutput).toBe(E2E_FAKE_TOOL_OUTPUT);
  });

  test('rejects taskDispatch combined with emitTool, repeatTool, or largeLastToolOutput', async () => {
    const invalid = [
      '{"taskDispatch":"omp","emitTool":true}',
      '{"taskDispatch":"claude","emitTool":false}',
      '{"taskDispatch":"omp","repeatTool":2}',
      '{"taskDispatch":"claude","largeLastToolOutput":true}',
      '{"taskDispatch":"serial"}',
    ];
    for (const body of invalid) {
      await expect(
        collect(provider.sendQuery(`<<E2E_SCENARIO>>${body}<</E2E_SCENARIO>>`, '/tmp'))
      ).rejects.toThrow('scenario directive failed validation');
    }
  });


  test('emitTodo emits four ordered todo call/result pairs first', async () => {
    const prompt = '<<E2E_SCENARIO>>{"emitTodo":true}<</E2E_SCENARIO>>';
    const chunks = await collect(provider.sendQuery(prompt, '/tmp', 'sess'));
    const tools = chunks.filter(chunk => chunk.type === 'tool');
    const results = chunks.filter(chunk => chunk.type === 'tool_result');
    expect(tools).toHaveLength(E2E_FAKE_TODO_INPUTS.length);
    expect(results).toHaveLength(E2E_FAKE_TODO_INPUTS.length);
    for (let index = 0; index < E2E_FAKE_TODO_INPUTS.length; index += 1) {
      const tool = tools[index];
      const result = results[index];
      if (tool?.type !== 'tool' || result?.type !== 'tool_result') {
        throw new Error('expected tool pair');
      }
      const toolCallId = `e2e-fake-todo-sess-${String(index + 1)}`;
      expect(tool.toolName).toBe(E2E_FAKE_TODO_TOOL_NAME);
      expect(tool.toolCallId).toBe(toolCallId);
      expect(tool.toolInput).toEqual(E2E_FAKE_TODO_INPUTS[index]);
      expect(result.toolName).toBe(E2E_FAKE_TODO_TOOL_NAME);
      expect(result.toolCallId).toBe(toolCallId);
      expect(result.toolOutput).toBe(E2E_FAKE_TODO_OUTPUT);
      expect(result.toolOutcome).toBe('success');
      expect(chunks[index * 2]?.type).toBe('tool');
      expect(chunks[index * 2 + 1]?.type).toBe('tool_result');
    }
    expect(chunks[8]).toEqual({
      type: 'assistant',
      content: '[e2e-fake] deterministic response',
    });
    expect(chunks[9]).toMatchObject({ type: 'result', sessionId: 'sess' });
  });

  test('emitTodo + emitTool + repeatTool keeps todo pairs first and Read calls unchanged', async () => {
    const prompt =
      '<<E2E_SCENARIO>>{"emitTodo":true,"emitTool":true,"repeatTool":3}<</E2E_SCENARIO>>';
    const chunks = await collect(provider.sendQuery(prompt, '/tmp', 'sess'));
    const tools = chunks.filter(chunk => chunk.type === 'tool');
    const results = chunks.filter(chunk => chunk.type === 'tool_result');
    expect(tools).toHaveLength(4 + 3);
    expect(results).toHaveLength(4 + 3);
    expect(chunks[8]).toEqual({ type: 'assistant', content: E2E_FAKE_TOOL_PASS_TEXT });
    for (let index = 0; index < 4; index += 1) {
      const tool = tools[index];
      if (tool?.type !== 'tool') throw new Error('expected tool');
      expect(tool.toolName).toBe(E2E_FAKE_TODO_TOOL_NAME);
      expect(tool.toolCallId).toBe(`e2e-fake-todo-sess-${String(index + 1)}`);
      expect(chunks[index * 2]?.type).toBe('tool');
      expect(chunks[index * 2 + 1]?.type).toBe('tool_result');
    }
    for (let index = 0; index < 3; index += 1) {
      const tool = tools[4 + index];
      if (tool?.type !== 'tool') throw new Error('expected tool');
      expect(tool.toolName).toBe(E2E_FAKE_TOOL_NAME);
      expect(tool.toolInput).toEqual({ path: 'HITL_TOOL_INPUT.txt' });
      expect(tool.toolCallId).toBe(`e2e-fake-tool-sess-${String(index + 1)}`);
      expect(chunks[9 + index * 2]?.type).toBe('tool');
      expect(chunks[10 + index * 2]?.type).toBe('tool_result');
    }
  });

  test('rejects non-boolean emitTodo and unknown keys alongside it', async () => {
    const invalid = ['{"emitTodo":"yes"}', '{"emitTodo":1}', '{"emitTodo":true,"bogus":true}'];
    for (const body of invalid) {
      await expect(
        collect(provider.sendQuery(`<<E2E_SCENARIO>>${body}<</E2E_SCENARIO>>`, '/tmp'))
      ).rejects.toThrow('scenario directive failed validation');
    }
  });

  test('emitTodo absent or false yields no todo chunks and preserves old behavior', async () => {
    const cases = [
      {
        body: '{"emitTool":true}',
        expectedToolCalls: 1,
        firstChunk: { type: 'assistant', content: E2E_FAKE_TOOL_PASS_TEXT },
      },
      {
        body: '{"emitTodo":false}',
        expectedToolCalls: 0,
        firstChunk: { type: 'assistant', content: '[e2e-fake] deterministic response' },
      },
      {
        body: '{"emitTodo":false,"emitTool":true,"repeatTool":2}',
        expectedToolCalls: 2,
        firstChunk: { type: 'assistant', content: E2E_FAKE_TOOL_PASS_TEXT },
      },
    ];
    for (const { body, expectedToolCalls, firstChunk } of cases) {
      const chunks = await collect(
        provider.sendQuery(`<<E2E_SCENARIO>>${body}<</E2E_SCENARIO>>`, '/tmp', 'sess')
      );
      expect(chunks[0]).toEqual(firstChunk);
      const tools = chunks.filter(chunk => chunk.type === 'tool');
      expect(tools).toHaveLength(expectedToolCalls);
      expect(
        chunks.some(chunk => chunk.type === 'tool' && chunk.toolName === E2E_FAKE_TODO_TOOL_NAME)
      ).toBe(false);
    }
  });

  test('rejects 0, 201, non-integer, and non-number repeatTool', async () => {
    const invalid = [
      '{"emitTool":true,"repeatTool":0}',
      '{"emitTool":true,"repeatTool":201}',
      '{"emitTool":true,"repeatTool":1.5}',
      '{"emitTool":true,"repeatTool":"3"}',
      '{"emitTool":true,"repeatTool":true}',
    ];
    for (const body of invalid) {
      await expect(
        collect(provider.sendQuery(`<<E2E_SCENARIO>>${body}<</E2E_SCENARIO>>`, '/tmp'))
      ).rejects.toThrow('scenario directive failed validation');
    }
  });

  test('throws when askHuman scenario has no native tool', async () => {
    const prompt = '<<E2E_SCENARIO>>{"askHuman":true}<</E2E_SCENARIO>>';
    await expect(collect(provider.sendQuery(prompt, '/tmp'))).rejects.toThrow(
      'requires the registered AskHuman native tool'
    );
  });

  test('calls AskHuman handler with tool-use id and session id, then rethrows pause', async () => {
    const prompt = '<<E2E_SCENARIO>>{"askHuman":true}<</E2E_SCENARIO>>';
    let seenToolUseId: string | undefined;
    let seenSessionId: string | undefined;
    const tool = askTool(async (input, context) => {
      seenToolUseId = context?.toolUseId;
      seenSessionId = context?.sessionId;
      const questions = (input as { questions: unknown }).questions;
      expect(Array.isArray(questions) && questions.length >= 1).toBe(true);
      throw new AskHumanAwaitingError(context?.toolUseId ?? 'missing', 'ask-starter', 'run-1');
    });

    await expect(
      collect(
        provider.sendQuery(prompt, '/tmp', undefined, {
          nativeTools: [tool],
        })
      )
    ).rejects.toBeInstanceOf(AskHumanAwaitingError);
    expect(seenToolUseId).toMatch(/^e2e-fake-ask-/);
    expect(seenSessionId).toMatch(/^e2e-fake-/);
  });

  test('concurrent askHuman calls get distinct tool-use ids', async () => {
    const prompt = '<<E2E_SCENARIO>>{"askHuman":true}<</E2E_SCENARIO>>';
    const seen: string[] = [];
    const tool = askTool(async (_input, context) => {
      seen.push(context?.toolUseId ?? 'missing');
      throw new AskHumanAwaitingError(context?.toolUseId ?? 'missing', 'ask-starter', 'run-1');
    });
    const results = await Promise.allSettled([
      collect(provider.sendQuery(prompt, '/tmp', undefined, { nativeTools: [tool] })),
      collect(provider.sendQuery(prompt, '/tmp', undefined, { nativeTools: [tool] })),
    ]);
    expect(results.every(result => result.status === 'rejected')).toBe(true);
    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toBe(seen[1]);
  });

  test('consumes resumeInteractions and does not call AskHuman', async () => {
    const prompt = '<<E2E_SCENARIO>>{"askHuman":true}<</E2E_SCENARIO>>';
    let handlerCalls = 0;
    const tool = askTool(async () => {
      handlerCalls += 1;
      return 'should-not-run';
    });
    const chunks = await collect(
      provider.sendQuery(prompt, '/tmp', 'sess-resume', {
        nativeTools: [tool],
        resumeInteractions: [
          {
            tool_use_id: 'ask-1',
            payload: { answers: [{ questionId: 'proceed', value: 'yes' }] },
            declined: false,
          },
        ],
      })
    );
    expect(handlerCalls).toBe(0);
    expect(chunks[0]).toMatchObject({ type: 'assistant' });
    const result = chunks[chunks.length - 1];
    expect(result).toMatchObject({ type: 'result', sessionId: 'sess-resume', resumed: true });
  });

  test('emits loop-done text when the prompt contains the marker', async () => {
    const prompt = `<<E2E_SCENARIO>>{"doneWhenPromptIncludes":"${E2E_FAKE_TOOL_PASS_TEXT}"}<</E2E_SCENARIO>>\n${E2E_FAKE_TOOL_PASS_TEXT}`;
    const chunks = await collect(provider.sendQuery(prompt, '/tmp'));
    expect(
      chunks.some(chunk => chunk.type === 'assistant' && chunk.content === E2E_FAKE_LOOP_DONE)
    ).toBe(true);
  });

  test('does not treat the scenario JSON itself as the loop-done marker', async () => {
    const prompt = `<<E2E_SCENARIO>>{"doneWhenPromptIncludes":"${E2E_FAKE_TOOL_PASS_TEXT}"}<</E2E_SCENARIO>>`;
    const chunks = await collect(provider.sendQuery(prompt, '/tmp'));
    expect(
      chunks.some(chunk => chunk.type === 'assistant' && chunk.content === E2E_FAKE_LOOP_DONE)
    ).toBe(false);
  });

  test('throws Query aborted when the signal is already aborted', async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(
      collect(provider.sendQuery('x', '/tmp', undefined, { abortSignal: abort.signal }))
    ).rejects.toThrow('Query aborted');
  });

  test('throws Query aborted during delayMs', async () => {
    const abort = new AbortController();
    const prompt = '<<E2E_SCENARIO>>{"delayMs":5000}<</E2E_SCENARIO>>';
    const pending = collect(
      provider.sendQuery(prompt, '/tmp', undefined, { abortSignal: abort.signal })
    );
    abort.abort();
    await expect(pending).rejects.toThrow('Query aborted');
  });

  test('advertises only implemented nativeTools, askHuman, and sessionResume', () => {
    expect(provider.getCapabilities()).toEqual(E2E_FAKE_CAPABILITIES);
    expect(E2E_FAKE_CAPABILITIES.nativeTools).toBe(true);
    expect(E2E_FAKE_CAPABILITIES.askHuman).toBe(true);
    expect(E2E_FAKE_CAPABILITIES.sessionResume).toBe(true);
    expect(E2E_FAKE_CAPABILITIES.mcp).toBe(false);
  });
});
