import { describe, expect, jest, test } from 'bun:test';
import type { ChildProcess, spawn, SpawnOptions } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough, Readable, Writable } from 'node:stream';
import {
  agent,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type AgentApp,
  type InitializeRequest,
  type McpServer,
  type SessionUpdate,
} from '@agentclientprotocol/sdk';

import { augmentPromptForJsonSchema } from '../../shared/structured-output';
import type { MessageChunk } from '../../types';
import {
  driveDeepseekAcpTurn,
  runDeepseekAcpTurn,
  type DeepseekAcpTurnInput,
  type DeepseekProcessInput,
} from './acp-client';
import { DeepseekProviderError } from './errors';

const CWD = '/tmp/archon-deepseek-cwd';
const STDIO_MCP: McpServer[] = [
  {
    name: 'demo',
    command: '/usr/bin/true',
    args: ['--ok'],
    env: [{ name: 'A', value: '1' }],
  },
];
const HTTP_MCP: McpServer[] = [
  {
    type: 'http',
    name: 'remote',
    url: 'https://example.com/mcp',
    headers: [{ name: 'Authorization', value: 'Bearer x' }],
  },
];

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function baseInput(over: Partial<DeepseekAcpTurnInput> = {}): DeepseekAcpTurnInput {
  return {
    cwd: CWD,
    prompt: 'hello',
    providerRoute: 'deepseek-official',
    mcpServers: STDIO_MCP,
    ...over,
  };
}

async function collect(gen: AsyncGenerator<MessageChunk>): Promise<MessageChunk[]> {
  const chunks: MessageChunk[] = [];
  for await (const chunk of gen) {
    chunks.push(chunk);
  }
  return chunks;
}

function promptText(params: unknown): string {
  if (typeof params !== 'object' || params === null) return '';
  const prompt = (params as { prompt?: unknown }).prompt;
  if (!Array.isArray(prompt)) return '';
  return prompt
    .map((block: unknown) => {
      if (typeof block === 'object' && block !== null && 'text' in block) {
        const text = (block as { text: unknown }).text;
        return typeof text === 'string' ? text : '';
      }
      return '';
    })
    .join('');
}

interface RecordedCall {
  method: string;
  params: unknown;
}

interface FakeDsh {
  app: AgentApp;
  calls: RecordedCall[];
  methodsCalled: () => string[];
  permissionResponses: unknown[];
}

function defaultInitialize(): {
  protocolVersion: typeof PROTOCOL_VERSION;
  agentCapabilities: {
    sessionCapabilities: { resume: Record<string, never>; close: Record<string, never> };
    mcpCapabilities: { http: boolean };
  };
} {
  return {
    protocolVersion: PROTOCOL_VERSION,
    agentCapabilities: {
      sessionCapabilities: { resume: {}, close: {} },
      mcpCapabilities: { http: true },
    },
  };
}

function createFakeDsh(options?: {
  sessionId?: string;
  initialize?: (params: InitializeRequest) => ReturnType<typeof defaultInitialize>;
  resumeError?: Error;
  configError?: Error;
  configHold?: ReturnType<typeof createDeferred<void>>;
  closeError?: Error;
  closeHold?: ReturnType<typeof createDeferred<void>>;
  promptUpdates?: SessionUpdate[] | ((sessionId: string) => SessionUpdate[]);
  promptHold?: ReturnType<typeof createDeferred<void>>;
  /** When false, session/cancel does not release promptHold (hung cancelled prompt). Default true. */
  resolvePromptHoldOnCancel?: boolean;
  promptText?: string;
  requestPermission?: boolean;
  onPromptStart?: () => void;
  onPromptSettled?: () => void;
  onCancel?: () => void;
}): FakeDsh {
  const calls: RecordedCall[] = [];
  const permissionResponses: unknown[] = [];
  const sessionId = options?.sessionId ?? 'sess-new-1';

  const app = agent({ name: 'fake-dsh' })
    .onRequest(methods.agent.initialize, c => {
      calls.push({ method: methods.agent.initialize, params: c.params });
      if (options?.initialize) return options.initialize(c.params);
      return defaultInitialize();
    })
    .onRequest(methods.agent.session.new, c => {
      calls.push({ method: methods.agent.session.new, params: c.params });
      return { sessionId };
    })
    .onRequest(methods.agent.session.resume, c => {
      calls.push({ method: methods.agent.session.resume, params: c.params });
      if (options?.resumeError) throw options.resumeError;
      return {};
    })
    .onRequest(methods.agent.session.setConfigOption, c => {
      calls.push({ method: methods.agent.session.setConfigOption, params: c.params });
      return (async (): Promise<{ configOptions: [] }> => {
        if (options?.configHold !== undefined) {
          await options.configHold.promise;
        }
        if (options?.configError) throw options.configError;
        return { configOptions: [] };
      })();
    })
    .onRequest(methods.agent.session.prompt, async c => {
      calls.push({ method: methods.agent.session.prompt, params: c.params });
      options?.onPromptStart?.();
      if (options?.requestPermission) {
        const response = await c.client.request(methods.client.session.requestPermission, {
          sessionId: c.params.sessionId,
          toolCall: { toolCallId: 'perm-1', title: 'edit' },
          options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
        });
        permissionResponses.push(response);
      }
      const updates =
        typeof options?.promptUpdates === 'function'
          ? options.promptUpdates(c.params.sessionId)
          : (options?.promptUpdates ?? []);
      for (const update of updates) {
        await c.client.notify(methods.client.session.update, {
          sessionId: c.params.sessionId,
          update,
        });
      }
      if (options?.promptText !== undefined) {
        await c.client.notify(methods.client.session.update, {
          sessionId: c.params.sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: options.promptText },
          },
        });
      }
      if (options?.promptHold !== undefined) {
        await options.promptHold.promise;
      }
      options?.onPromptSettled?.();
      return { stopReason: 'end_turn' as const };
    })
    .onRequest(methods.agent.session.close, c => {
      calls.push({ method: methods.agent.session.close, params: c.params });
      return (async (): Promise<Record<string, never>> => {
        if (options?.closeHold !== undefined) {
          await options.closeHold.promise;
        }
        if (options?.closeError) throw options.closeError;
        return {};
      })();
    })
    .onNotification(methods.agent.session.cancel, c => {
      calls.push({ method: methods.agent.session.cancel, params: c.params });
      options?.onCancel?.();
      if (options?.resolvePromptHoldOnCancel !== false) {
        options?.promptHold?.resolve();
      }
    });

  return {
    app,
    calls,
    methodsCalled: () => calls.map(call => call.method),
    permissionResponses,
  };
}

class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly pid = 4242;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  killed = false;
  readonly signals: Array<NodeJS.Signals | number | undefined> = [];
  ignoreTerm = false;

  kill(signal?: NodeJS.Signals | number): boolean {
    this.signals.push(signal);
    this.killed = true;
    const name = signal ?? 'SIGTERM';
    if (name === 'SIGTERM' && this.ignoreTerm) {
      return true;
    }
    if (this.exitCode !== null || this.signalCode !== null) {
      return true;
    }
    const sig = typeof name === 'string' ? name : 'SIGTERM';
    queueMicrotask(() => {
      if (this.exitCode !== null || this.signalCode !== null) return;
      this.signalCode = sig as NodeJS.Signals;
      this.emit('exit', null, sig);
    });
    return true;
  }

  crash(code: number, stderrText?: string): void {
    if (stderrText !== undefined) this.stderr.write(stderrText);
    this.exitCode = code;
    this.stdin.destroy();
    this.stdout.destroy();
    this.emit('exit', code, null);
  }
}

function attachAgent(child: FakeChild, fake: FakeDsh): void {
  const stream = ndJsonStream(
    Writable.toWeb(child.stdout) as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdin) as ReadableStream<Uint8Array>
  );
  fake.app.connect(stream);
}

function processInput(over: Partial<DeepseekProcessInput> = {}): DeepseekProcessInput {
  return {
    ...baseInput(),
    nodeBin: '/usr/bin/node',
    dshEntrypoint: '/opt/dsh/lib/bin.js',
    profile: 'acp',
    env: { DEEPSEEK_API_KEY: 'sk-live-secret', PATH: '/usr/bin' },
    ...over,
  };
}

describe('driveDeepseekAcpTurn', () => {
  test('order is initialize, session/new, prompt, then session/close', async () => {
    const fake = createFakeDsh();
    await collect(driveDeepseekAcpTurn(fake.app, baseInput()));
    expect(fake.methodsCalled()).toEqual([
      methods.agent.initialize,
      methods.agent.session.new,
      methods.agent.session.prompt,
      methods.agent.session.close,
    ]);
  });

  test('new and resume receive the absolute cwd and complete mcpServers array', async () => {
    const fakeNew = createFakeDsh();
    await collect(driveDeepseekAcpTurn(fakeNew.app, baseInput()));
    expect(fakeNew.calls.find(call => call.method === methods.agent.session.new)?.params).toEqual({
      cwd: CWD,
      mcpServers: STDIO_MCP,
    });

    const fakeResume = createFakeDsh({ sessionId: 'sess-resume-1' });
    await collect(
      driveDeepseekAcpTurn(fakeResume.app, baseInput({ resumeSessionId: 'sess-resume-1' }))
    );
    expect(
      fakeResume.calls.find(call => call.method === methods.agent.session.resume)?.params
    ).toEqual({
      sessionId: 'sess-resume-1',
      cwd: CWD,
      mcpServers: STDIO_MCP,
    });
  });

  test('a fresh turn returns the session id from session/new', async () => {
    const fake = createFakeDsh({ sessionId: 'sess-fresh' });
    const chunks = await collect(driveDeepseekAcpTurn(fake.app, baseInput()));
    const result = chunks.find(chunk => chunk.type === 'result');
    expect(result).toMatchObject({
      type: 'result',
      sessionId: 'sess-fresh',
      stopReason: 'end_turn',
    });
  });

  test('a resumed turn uses the requested session id and never calls new', async () => {
    const fake = createFakeDsh({ sessionId: 'sess-resume-1' });
    const chunks = await collect(
      driveDeepseekAcpTurn(fake.app, baseInput({ resumeSessionId: 'sess-resume-1' }))
    );
    expect(fake.methodsCalled()).toEqual([
      methods.agent.initialize,
      methods.agent.session.resume,
      methods.agent.session.prompt,
      methods.agent.session.close,
    ]);
    expect(chunks.find(chunk => chunk.type === 'result')).toMatchObject({
      sessionId: 'sess-resume-1',
    });
  });

  test('rejected resume throws deepseek_resume_failed and never calls new, prompt, or close', async () => {
    const fake = createFakeDsh({ resumeError: new Error('unknown session') });
    const error = await collect(
      driveDeepseekAcpTurn(fake.app, baseInput({ resumeSessionId: 'sess-missing' }))
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DeepseekProviderError);
    expect((error as DeepseekProviderError).subtype).toBe('deepseek_resume_failed');
    expect((error as DeepseekProviderError).cause).toBeDefined();
    expect(fake.methodsCalled()).toEqual([methods.agent.initialize, methods.agent.session.resume]);
  });

  test('model config sends JSON.stringify([providerRoute, model])', async () => {
    const fake = createFakeDsh();
    await collect(driveDeepseekAcpTurn(fake.app, baseInput({ model: 'deepseek-chat' })));
    const config = fake.calls.find(call => call.method === methods.agent.session.setConfigOption);
    expect(config?.params).toEqual({
      sessionId: 'sess-new-1',
      configId: 'model',
      value: JSON.stringify(['deepseek-official', 'deepseek-chat']),
    });
  });

  test('no model config call is made when no model is configured', async () => {
    const fake = createFakeDsh();
    await collect(driveDeepseekAcpTurn(fake.app, baseInput()));
    expect(
      fake.calls.some(
        call =>
          call.method === methods.agent.session.setConfigOption &&
          typeof call.params === 'object' &&
          call.params !== null &&
          (call.params as { configId?: string }).configId === 'model'
      )
    ).toBe(false);
  });

  test('effort sends configId reasoning_effort with the already translated value', async () => {
    const fake = createFakeDsh();
    await collect(driveDeepseekAcpTurn(fake.app, baseInput({ effort: 'low' })));
    const config = fake.calls.find(
      call =>
        call.method === methods.agent.session.setConfigOption &&
        typeof call.params === 'object' &&
        call.params !== null &&
        (call.params as { configId?: string }).configId === 'reasoning_effort'
    );
    expect(config?.params).toEqual({
      sessionId: 'sess-new-1',
      configId: 'reasoning_effort',
      value: 'low',
    });
  });

  test('a config-option rejection fails the turn', async () => {
    const fake = createFakeDsh({ configError: new Error('bad model') });
    const error = await collect(
      driveDeepseekAcpTurn(fake.app, baseInput({ model: 'deepseek-chat' }))
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DeepseekProviderError);
    expect((error as DeepseekProviderError).subtype).toBe('deepseek_protocol_error');
    expect(fake.methodsCalled()).toContain(methods.agent.session.close);
  });

  test('first iterator.next receives a notification-derived assistant chunk while prompt is pending', async () => {
    const hold = createDeferred<void>();
    let promptSettled = false;
    const fake = createFakeDsh({
      promptHold: hold,
      promptUpdates: [
        {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'streaming' },
        },
      ],
      onPromptSettled: () => {
        promptSettled = true;
      },
    });
    const gen = driveDeepseekAcpTurn(fake.app, baseInput());
    const first = await gen.next();
    expect(first).toEqual({
      done: false,
      value: { type: 'assistant', content: 'streaming', textMode: 'delta' },
    });
    expect(promptSettled).toBe(false);
    hold.resolve();
    const rest = await collect(gen);
    expect(rest.some(chunk => chunk.type === 'result')).toBe(true);
  });

  test('tool events preserve call id and pinned-DSH nested content output', async () => {
    const fake = createFakeDsh({
      promptUpdates: [
        {
          sessionUpdate: 'tool_call',
          toolCallId: 'call-dsh',
          title: 'bash',
          name: 'bash',
        },
        {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'call-dsh',
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: 'ok' } }],
        },
      ],
    });
    const chunks = await collect(driveDeepseekAcpTurn(fake.app, baseInput()));
    expect(chunks).toEqual(
      expect.arrayContaining([
        {
          type: 'tool',
          toolName: 'bash',
          toolCallId: 'call-dsh',
        },
        {
          type: 'tool_result',
          toolName: 'bash',
          toolCallId: 'call-dsh',
          toolOutput: 'ok',
          toolOutcome: 'success',
        },
      ])
    );
  });

  test('final result contains sessionId and ACP stopReason and omits usage fields', async () => {
    const fake = createFakeDsh();
    const chunks = await collect(driveDeepseekAcpTurn(fake.app, baseInput()));
    const result = chunks.find(chunk => chunk.type === 'result');
    expect(result).toEqual({
      type: 'result',
      sessionId: 'sess-new-1',
      stopReason: 'end_turn',
    });
    expect(result).not.toHaveProperty('tokens');
    expect(result).not.toHaveProperty('usageBreakdown');
    expect(result).not.toHaveProperty('cost');
  });

  test('structured output augments the outbound prompt and places the parsed object on the result', async () => {
    const schema = { type: 'object', properties: { ok: { type: 'boolean' } } };
    const fake = createFakeDsh({ promptText: '{"ok":true}' });
    const chunks = await collect(
      driveDeepseekAcpTurn(fake.app, baseInput({ outputSchema: schema }))
    );
    const promptCall = fake.calls.find(call => call.method === methods.agent.session.prompt);
    expect(promptText(promptCall?.params)).toBe(augmentPromptForJsonSchema('hello', schema));
    expect(chunks.find(chunk => chunk.type === 'result')).toMatchObject({
      structuredOutput: { ok: true },
    });
  });

  test('a malformed structured reply leaves structuredOutput absent', async () => {
    const schema = { type: 'object', properties: { ok: { type: 'boolean' } } };
    const fake = createFakeDsh({ promptText: 'not-json' });
    const chunks = await collect(
      driveDeepseekAcpTurn(fake.app, baseInput({ outputSchema: schema }))
    );
    const result = chunks.find(chunk => chunk.type === 'result');
    expect(result).toBeDefined();
    expect(result).not.toHaveProperty('structuredOutput');
  });

  test('a fake permission request receives cancelled without an option id', async () => {
    const fake = createFakeDsh({ requestPermission: true });
    await collect(driveDeepseekAcpTurn(fake.app, baseInput()));
    expect(fake.permissionResponses).toEqual([{ outcome: { outcome: 'cancelled' } }]);
  });

  test('aborting during prompt sends cancel, closes the session, and emits local aborted result', async () => {
    const hold = createDeferred<void>();
    const fake = createFakeDsh({ promptHold: hold, sessionId: 'sess-abort-1' });
    const controller = new AbortController();
    const gen = driveDeepseekAcpTurn(fake.app, baseInput({ abortSignal: controller.signal }));
    const chunksPromise = collect(gen);
    await new Promise<void>(resolve => {
      const check = (): void => {
        if (fake.methodsCalled().includes(methods.agent.session.prompt)) resolve();
        else setTimeout(check, 1);
      };
      check();
    });
    controller.abort();
    const chunks = await chunksPromise;
    expect(fake.methodsCalled()).toContain(methods.agent.session.cancel);
    expect(fake.methodsCalled()).toContain(methods.agent.session.close);
    const result = chunks.find(chunk => chunk.type === 'result');
    expect(result).toEqual({
      type: 'result',
      sessionId: 'sess-abort-1',
      stopReason: 'aborted',
      isError: true,
      errorSubtype: 'deepseek_aborted',
    });
    expect(result).not.toHaveProperty('terminalReason');
  });

  test('aborting interruptSignal during prompt sends one cancel, closes, and emits exact abort result', async () => {
    const hold = createDeferred<void>();
    const fake = createFakeDsh({ promptHold: hold, sessionId: 'sess-interrupt-1' });
    const interrupt = new AbortController();
    const gen = driveDeepseekAcpTurn(fake.app, baseInput({ interruptSignal: interrupt.signal }));
    const chunksPromise = collect(gen);
    await new Promise<void>(resolve => {
      const check = (): void => {
        if (fake.methodsCalled().includes(methods.agent.session.prompt)) resolve();
        else setTimeout(check, 1);
      };
      check();
    });
    interrupt.abort();
    const chunks = await chunksPromise;
    const cancelCalls = fake.calls.filter(call => call.method === methods.agent.session.cancel);
    expect(cancelCalls).toHaveLength(1);
    expect(fake.methodsCalled()).toContain(methods.agent.session.close);
    expect(chunks.find(chunk => chunk.type === 'result')).toEqual({
      type: 'result',
      sessionId: 'sess-interrupt-1',
      stopReason: 'aborted',
      isError: true,
      errorSubtype: 'deepseek_aborted',
    });
  });

  test('Stop and Cancel race sends exactly one session/cancel', async () => {
    const hold = createDeferred<void>();
    const fake = createFakeDsh({ promptHold: hold });
    const nodeCancel = new AbortController();
    const interrupt = new AbortController();
    const gen = driveDeepseekAcpTurn(
      fake.app,
      baseInput({ abortSignal: nodeCancel.signal, interruptSignal: interrupt.signal })
    );
    const chunksPromise = collect(gen);
    await new Promise<void>(resolve => {
      const check = (): void => {
        if (fake.methodsCalled().includes(methods.agent.session.prompt)) resolve();
        else setTimeout(check, 1);
      };
      check();
    });
    nodeCancel.abort();
    interrupt.abort();
    const chunks = await chunksPromise;
    expect(fake.calls.filter(call => call.method === methods.agent.session.cancel)).toHaveLength(1);
    expect(chunks.find(chunk => chunk.type === 'result')).toMatchObject({
      stopReason: 'aborted',
      errorSubtype: 'deepseek_aborted',
      isError: true,
    });
  });

  test('already-aborted interruptSignal skips prompt, cancels once, and returns abort with session id', async () => {
    const fake = createFakeDsh({ sessionId: 'sess-preabort' });
    const interrupt = new AbortController();
    interrupt.abort();
    const chunks = await collect(
      driveDeepseekAcpTurn(fake.app, baseInput({ interruptSignal: interrupt.signal }))
    );
    expect(fake.methodsCalled()).toEqual([
      methods.agent.initialize,
      methods.agent.session.new,
      methods.agent.session.cancel,
      methods.agent.session.close,
    ]);
    expect(chunks.find(chunk => chunk.type === 'result')).toEqual({
      type: 'result',
      sessionId: 'sess-preabort',
      stopReason: 'aborted',
      isError: true,
      errorSubtype: 'deepseek_aborted',
    });
  });

  test('when both signals are already aborted, node Cancel is checked first and only one cancel is sent', async () => {
    const fake = createFakeDsh({ sessionId: 'sess-both-pre' });
    const nodeCancel = new AbortController();
    const interrupt = new AbortController();
    nodeCancel.abort();
    interrupt.abort();
    const chunks = await collect(
      driveDeepseekAcpTurn(
        fake.app,
        baseInput({ abortSignal: nodeCancel.signal, interruptSignal: interrupt.signal })
      )
    );
    expect(fake.calls.filter(call => call.method === methods.agent.session.cancel)).toHaveLength(1);
    expect(fake.methodsCalled()).not.toContain(methods.agent.session.prompt);
    expect(chunks.find(chunk => chunk.type === 'result')).toMatchObject({
      sessionId: 'sess-both-pre',
      stopReason: 'aborted',
      errorSubtype: 'deepseek_aborted',
    });
  });

  test('interrupt during set_config_option cancels once, skips prompt, closes, and yields abort result', async () => {
    const hold = createDeferred<void>();
    const fake = createFakeDsh({
      configHold: hold,
      sessionId: 'sess-config-interrupt',
    });
    const interrupt = new AbortController();
    const chunksPromise = collect(
      driveDeepseekAcpTurn(
        fake.app,
        baseInput({ model: 'deepseek-chat', interruptSignal: interrupt.signal })
      )
    );
    await new Promise<void>(resolve => {
      const check = (): void => {
        if (fake.methodsCalled().includes(methods.agent.session.setConfigOption)) resolve();
        else setTimeout(check, 1);
      };
      check();
    });
    interrupt.abort();
    hold.resolve();
    const chunks = await chunksPromise;
    expect(fake.calls.filter(call => call.method === methods.agent.session.cancel)).toHaveLength(1);
    expect(fake.methodsCalled()).not.toContain(methods.agent.session.prompt);
    expect(fake.methodsCalled()).toContain(methods.agent.session.close);
    expect(chunks.find(chunk => chunk.type === 'result')).toEqual({
      type: 'result',
      sessionId: 'sess-config-interrupt',
      stopReason: 'aborted',
      isError: true,
      errorSubtype: 'deepseek_aborted',
    });
  });

  test('natural prompt result winning a Stop race during session/close stays natural with no cancel', async () => {
    const closeHold = createDeferred<void>();
    const schema = { type: 'object', properties: { ok: { type: 'boolean' } } };
    const fake = createFakeDsh({
      closeHold,
      promptText: '{"ok":true}',
      sessionId: 'sess-natural-race',
    });
    const interrupt = new AbortController();
    const chunksPromise = collect(
      driveDeepseekAcpTurn(
        fake.app,
        baseInput({ interruptSignal: interrupt.signal, outputSchema: schema })
      )
    );
    await new Promise<void>(resolve => {
      const check = (): void => {
        if (fake.methodsCalled().includes(methods.agent.session.close)) resolve();
        else setTimeout(check, 1);
      };
      check();
    });
    interrupt.abort();
    closeHold.resolve();
    const chunks = await chunksPromise;
    expect(fake.methodsCalled()).not.toContain(methods.agent.session.cancel);
    expect(chunks.find(chunk => chunk.type === 'result')).toEqual({
      type: 'result',
      sessionId: 'sess-natural-race',
      stopReason: 'end_turn',
      structuredOutput: { ok: true },
    });
  });

  test('success, setup failure, and early return remove both signal listeners', async () => {
    const successAbort = new AbortController();
    const successInterrupt = new AbortController();
    const removeAbort = jest.spyOn(successAbort.signal, 'removeEventListener');
    const removeInterrupt = jest.spyOn(successInterrupt.signal, 'removeEventListener');
    await collect(
      driveDeepseekAcpTurn(
        createFakeDsh().app,
        baseInput({
          abortSignal: successAbort.signal,
          interruptSignal: successInterrupt.signal,
        })
      )
    );
    expect(removeAbort).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(removeInterrupt).toHaveBeenCalledWith('abort', expect.any(Function));
    removeAbort.mockRestore();
    removeInterrupt.mockRestore();

    const setupAbort = new AbortController();
    const setupInterrupt = new AbortController();
    const removeSetupAbort = jest.spyOn(setupAbort.signal, 'removeEventListener');
    const removeSetupInterrupt = jest.spyOn(setupInterrupt.signal, 'removeEventListener');
    const setupError = await collect(
      driveDeepseekAcpTurn(
        createFakeDsh({ configError: new Error('bad model') }).app,
        baseInput({
          model: 'deepseek-chat',
          abortSignal: setupAbort.signal,
          interruptSignal: setupInterrupt.signal,
        })
      )
    ).catch((caught: unknown) => caught);
    expect(setupError).toBeInstanceOf(DeepseekProviderError);
    expect(removeSetupAbort).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(removeSetupInterrupt).toHaveBeenCalledWith('abort', expect.any(Function));
    removeSetupAbort.mockRestore();
    removeSetupInterrupt.mockRestore();

    const hold = createDeferred<void>();
    const earlyAbort = new AbortController();
    const earlyInterrupt = new AbortController();
    const removeEarlyAbort = jest.spyOn(earlyAbort.signal, 'removeEventListener');
    const removeEarlyInterrupt = jest.spyOn(earlyInterrupt.signal, 'removeEventListener');
    const earlyFake = createFakeDsh({
      promptHold: hold,
      promptUpdates: [
        {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'partial' },
        },
      ],
    });
    const gen = driveDeepseekAcpTurn(
      earlyFake.app,
      baseInput({ abortSignal: earlyAbort.signal, interruptSignal: earlyInterrupt.signal })
    );
    await gen.next();
    await gen.return(undefined);
    expect(earlyFake.methodsCalled()).toContain(methods.agent.session.cancel);
    expect(removeEarlyAbort).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(removeEarlyInterrupt).toHaveBeenCalledWith('abort', expect.any(Function));
    hold.resolve();
    removeEarlyAbort.mockRestore();
    removeEarlyInterrupt.mockRestore();
  });

  test('CANCEL_DRAIN_GRACE_MS releases a hung cancelled prompt so close and abort result still run', async () => {
    jest.useFakeTimers();
    try {
      const hold = createDeferred<void>();
      let promptStarted = false;
      let cancelSeen = false;
      const fake = createFakeDsh({
        promptHold: hold,
        resolvePromptHoldOnCancel: false,
        sessionId: 'sess-drain',
        onPromptStart: () => {
          promptStarted = true;
        },
        onCancel: () => {
          cancelSeen = true;
        },
      });
      const interrupt = new AbortController();
      const chunksPromise = collect(
        driveDeepseekAcpTurn(fake.app, baseInput({ interruptSignal: interrupt.signal }))
      );

      // Drive microtasks until the fake observes session/prompt without real timers.
      for (let i = 0; i < 200 && !promptStarted; i += 1) {
        await Promise.resolve();
      }
      expect(promptStarted).toBe(true);

      interrupt.abort();
      for (let i = 0; i < 200 && !cancelSeen; i += 1) {
        await Promise.resolve();
      }
      expect(cancelSeen).toBe(true);
      expect(fake.methodsCalled()).toContain(methods.agent.session.cancel);
      expect(fake.methodsCalled()).not.toContain(methods.agent.session.close);

      jest.advanceTimersByTime(500);
      // Flush the timer callback and subsequent ACP close microtasks.
      for (let i = 0; i < 50; i += 1) {
        await Promise.resolve();
      }

      const chunks = await chunksPromise;
      expect(fake.methodsCalled()).toContain(methods.agent.session.close);
      expect(chunks.find(chunk => chunk.type === 'result')).toEqual({
        type: 'result',
        sessionId: 'sess-drain',
        stopReason: 'aborted',
        isError: true,
        errorSubtype: 'deepseek_aborted',
      });
    } finally {
      jest.useRealTimers();
    }
  });

  test('aborting during config reports a local aborted result when config rejects', async () => {
    const hold = createDeferred<void>();
    const fake = createFakeDsh({
      configHold: hold,
      configError: new Error('config cancelled'),
    });
    const controller = new AbortController();
    const chunksPromise = collect(
      driveDeepseekAcpTurn(
        fake.app,
        baseInput({ model: 'deepseek-chat', abortSignal: controller.signal })
      )
    );
    await new Promise<void>(resolve => {
      const check = (): void => {
        if (fake.methodsCalled().includes(methods.agent.session.setConfigOption)) resolve();
        else setTimeout(check, 1);
      };
      check();
    });

    controller.abort();
    hold.resolve();
    const chunks = await chunksPromise;

    expect(fake.methodsCalled()).toContain(methods.agent.session.cancel);
    expect(fake.methodsCalled()).toContain(methods.agent.session.close);
    expect(chunks.find(chunk => chunk.type === 'result')).toMatchObject({
      type: 'result',
      stopReason: 'aborted',
      errorSubtype: 'deepseek_aborted',
    });
  });

  test('consumer early return sends cancel for an active session and releases the connection', async () => {
    const hold = createDeferred<void>();
    const fake = createFakeDsh({
      promptHold: hold,
      promptUpdates: [
        {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'partial' },
        },
      ],
    });
    const gen = driveDeepseekAcpTurn(fake.app, baseInput());
    const first = await gen.next();
    expect(first.value).toEqual({ type: 'assistant', content: 'partial', textMode: 'delta' });
    await gen.return(undefined);
    expect(fake.methodsCalled()).toContain(methods.agent.session.cancel);
    hold.resolve();
  });

  test('close rejection is surfaced rather than hidden behind a successful result', async () => {
    const fake = createFakeDsh({ closeError: new Error('close failed') });
    const error = await collect(driveDeepseekAcpTurn(fake.app, baseInput())).catch(
      (caught: unknown) => caught
    );
    expect(error).toBeInstanceOf(DeepseekProviderError);
    expect((error as DeepseekProviderError).subtype).toBe('deepseek_protocol_error');
  });
});

describe('runDeepseekAcpTurn', () => {
  test('spawns the exact Node path with dshEntrypoint --profile acp, cwd, and env', async () => {
    const fake = createFakeDsh();
    const recorded: Array<{ command: string; args: readonly string[]; options: SpawnOptions }> = [];
    const child = new FakeChild();
    const spawnImpl = ((
      command: string,
      args: readonly string[],
      options: SpawnOptions
    ): ChildProcess => {
      recorded.push({ command, args, options });
      attachAgent(child, fake);
      return child as unknown as ChildProcess;
    }) as typeof spawn;

    const input = processInput();
    await collect(runDeepseekAcpTurn(input, { spawn: spawnImpl, terminateGraceMs: 0 }));
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.command).toBe('/usr/bin/node');
    expect(recorded[0]?.args).toEqual(['/opt/dsh/lib/bin.js', '--profile', 'acp']);
    expect(recorded[0]?.options).toMatchObject({
      cwd: CWD,
      env: input.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  });

  test('two message chunks stream as two ordered delta chunks before the terminal result', async () => {
    const fake = createFakeDsh({
      promptUpdates: [
        {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Hel' },
        } as SessionUpdate,
        {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'lo' },
        } as SessionUpdate,
      ],
    });
    const child = new FakeChild();
    const spawnImpl = (() => {
      attachAgent(child, fake);
      return child as unknown as ChildProcess;
    }) as unknown as typeof spawn;
    const chunks = await collect(
      runDeepseekAcpTurn(processInput(), { spawn: spawnImpl, terminateGraceMs: 0 })
    );
    expect(chunks.slice(0, 2)).toEqual([
      { type: 'assistant', content: 'Hel', textMode: 'delta' },
      { type: 'assistant', content: 'lo', textMode: 'delta' },
    ]);
    expect(
      chunks
        .filter(chunk => chunk.type === 'assistant')
        .map(chunk => (chunk as { content: string }).content)
        .join('')
    ).toBe('Hello');
    expect(chunks.at(-1)).toMatchObject({ type: 'result', stopReason: 'end_turn' });
  });

  test('success, protocol failure, abort, and consumer return all send SIGTERM and await exit', async () => {
    async function runAndSignals(
      drive: (child: FakeChild, fake: FakeDsh) => AsyncGenerator<MessageChunk>
    ): Promise<Array<NodeJS.Signals | number | undefined>> {
      const fake = createFakeDsh();
      const child = new FakeChild();
      const spawnImpl = ((_command: string, _args: readonly string[]): ChildProcess => {
        attachAgent(child, fake);
        return child as unknown as ChildProcess;
      }) as typeof spawn;
      void drive;
      await collect(runDeepseekAcpTurn(processInput(), { spawn: spawnImpl, terminateGraceMs: 0 }));
      return child.signals;
    }

    const successSignals = await runAndSignals(() =>
      (async function* (): AsyncGenerator<MessageChunk> {})()
    );
    expect(successSignals[0]).toBe('SIGTERM');

    const protocolFake = createFakeDsh({ configError: new Error('bad') });
    const protocolChild = new FakeChild();
    const protocolSpawn = ((_command: string): ChildProcess => {
      attachAgent(protocolChild, protocolFake);
      return protocolChild as unknown as ChildProcess;
    }) as typeof spawn;
    await collect(
      runDeepseekAcpTurn(processInput({ model: 'deepseek-chat' }), {
        spawn: protocolSpawn,
        terminateGraceMs: 0,
      })
    ).catch(() => undefined);
    expect(protocolChild.signals[0]).toBe('SIGTERM');
    expect(protocolChild.signalCode === 'SIGTERM' || protocolChild.exitCode !== null).toBe(true);

    const hold = createDeferred<void>();
    const abortFake = createFakeDsh({ promptHold: hold });
    const abortChild = new FakeChild();
    const abortSpawn = ((_command: string): ChildProcess => {
      attachAgent(abortChild, abortFake);
      return abortChild as unknown as ChildProcess;
    }) as typeof spawn;
    const controller = new AbortController();
    const abortGen = runDeepseekAcpTurn(processInput({ abortSignal: controller.signal }), {
      spawn: abortSpawn,
      terminateGraceMs: 0,
    });
    const abortChunks = collect(abortGen);
    await new Promise<void>(resolve => {
      const check = (): void => {
        if (abortFake.methodsCalled().includes(methods.agent.session.prompt)) resolve();
        else setTimeout(check, 1);
      };
      check();
    });
    controller.abort();
    await abortChunks;
    expect(abortChild.signals[0]).toBe('SIGTERM');

    const earlyHold = createDeferred<void>();
    const earlyFake = createFakeDsh({
      promptHold: earlyHold,
      promptUpdates: [
        {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'partial' },
        },
      ],
    });
    const earlyChild = new FakeChild();
    const earlySpawn = ((_command: string): ChildProcess => {
      attachAgent(earlyChild, earlyFake);
      return earlyChild as unknown as ChildProcess;
    }) as typeof spawn;
    const earlyGen = runDeepseekAcpTurn(processInput(), {
      spawn: earlySpawn,
      terminateGraceMs: 0,
    });
    await earlyGen.next();
    await earlyGen.return(undefined);
    earlyHold.resolve();
    expect(earlyChild.signals[0]).toBe('SIGTERM');
  });

  test('a child that ignores SIGTERM is SIGKILL-ed when terminateGraceMs is 0', async () => {
    const fake = createFakeDsh();
    const child = new FakeChild();
    child.ignoreTerm = true;
    const spawnImpl = ((_command: string): ChildProcess => {
      attachAgent(child, fake);
      return child as unknown as ChildProcess;
    }) as typeof spawn;
    await collect(runDeepseekAcpTurn(processInput(), { spawn: spawnImpl, terminateGraceMs: 0 }));
    expect(child.signals).toEqual(['SIGTERM', 'SIGKILL']);
  });

  test('spawn error surfaces deepseek_spawn_failed without the API key', async () => {
    const spawnImpl = (() => {
      throw new Error('ENOENT node sk-live-secret');
    }) as unknown as typeof spawn;
    const error = await collect(
      runDeepseekAcpTurn(processInput(), { spawn: spawnImpl, terminateGraceMs: 0 })
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DeepseekProviderError);
    expect((error as DeepseekProviderError).subtype).toBe('deepseek_spawn_failed');
    expect((error as DeepseekProviderError).message).not.toContain('sk-live-secret');
    expect((error as DeepseekProviderError).message).toContain('[REDACTED]');
  });

  test('ACP stream failures surface deepseek_acp_error instead of spawn failure', async () => {
    const child = new FakeChild();
    const spawnImpl = ((_command: string): ChildProcess => {
      queueMicrotask(() => {
        child.stdout.destroy(new Error('stream exploded'));
      });
      return child as unknown as ChildProcess;
    }) as typeof spawn;

    const error = await collect(
      runDeepseekAcpTurn(processInput(), { spawn: spawnImpl, terminateGraceMs: 0 })
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DeepseekProviderError);
    expect((error as DeepseekProviderError).subtype).toBe('deepseek_acp_error');
    expect(child.signals[0]).toBe('SIGTERM');
  });

  test('early child exit surfaces deepseek_spawn_failed with at most 4096 redacted stderr characters', async () => {
    const secret = 'sk-live-secret';
    const requestSecret = 'request-env-token-secret';
    const long = `${secret} ${requestSecret}${'x'.repeat(5000)}`;
    const child = new FakeChild();
    const spawnImpl = ((_command: string): ChildProcess => {
      queueMicrotask(() => child.crash(1, long));
      return child as unknown as ChildProcess;
    }) as typeof spawn;
    const error = await collect(
      runDeepseekAcpTurn(
        processInput({
          env: {
            ...processInput().env,
            ARCHON_DEEPSEEK_EXTRA_TOKEN: requestSecret,
          },
        }),
        { spawn: spawnImpl, terminateGraceMs: 0 }
      )
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DeepseekProviderError);
    expect((error as DeepseekProviderError).subtype).toBe('deepseek_spawn_failed');
    expect((error as DeepseekProviderError).message).not.toContain(secret);
    expect((error as DeepseekProviderError).message).not.toContain(requestSecret);
    expect((error as DeepseekProviderError).message).toContain('[REDACTED]');
    const redacted = (error as DeepseekProviderError).message;
    const stderrPart = redacted.slice(redacted.indexOf('[REDACTED]'));
    expect(stderrPart.length).toBeLessThanOrEqual(4096);
  });

  test('stderr redaction does not leak a secret prefix at the excerpt boundary', async () => {
    const secret = 'sk-live-secret';
    const long = `${'x'.repeat(4090)}${secret}${'y'.repeat(5000)}`;
    const child = new FakeChild();
    const spawnImpl = ((_command: string): ChildProcess => {
      queueMicrotask(() => child.crash(1, long));
      return child as unknown as ChildProcess;
    }) as typeof spawn;

    const error = await collect(
      runDeepseekAcpTurn(processInput(), { spawn: spawnImpl, terminateGraceMs: 0 })
    ).catch((caught: unknown) => caught);

    const message = (error as DeepseekProviderError).message;
    expect(error).toBeInstanceOf(DeepseekProviderError);
    expect((error as DeepseekProviderError).subtype).toBe('deepseek_spawn_failed');
    expect(message).not.toContain(secret);
    expect(message).not.toContain(secret.slice(0, 6));
  });

  test('a secret repeated until the cap leaks no fragment of itself', async () => {
    // Truncation splits the final copy in half; the surviving head is not a whole
    // secret, so redaction cannot match it. The excerpt must still drop it.
    const secret = 'sk-live-secret';
    const child = new FakeChild();
    const spawnImpl = ((_command: string): ChildProcess => {
      queueMicrotask(() => child.crash(1, secret.repeat(1000)));
      return child as unknown as ChildProcess;
    }) as typeof spawn;

    const error = await collect(
      runDeepseekAcpTurn(processInput(), { spawn: spawnImpl, terminateGraceMs: 0 })
    ).catch((caught: unknown) => caught);

    const message = (error as DeepseekProviderError).message;
    expect(error).toBeInstanceOf(DeepseekProviderError);
    expect(message).toContain('[REDACTED]');
    // Any prefix of 4+ characters is a real leak; assert every one is absent.
    for (let length = 4; length <= secret.length; length++) {
      expect(message).not.toContain(secret.slice(0, length));
    }
    expect(message.slice(message.indexOf('[REDACTED]')).length).toBeLessThanOrEqual(4096);
  });

  test('trimming a truncated tail never cuts into a complete secret', async () => {
    // The raw tail ends with `ecretsk-live-`, a prefix of the SECOND secret.
    // Measuring the trim against raw text eats 13 characters back into the
    // first, already-complete secret and exposes `sk-live-s`. Redaction must run
    // before the trim so only the truncation artifact disappears.
    const secret = 'sk-live-secret';
    const crossSecret = 'ecretsk-live-AAAA';
    // Mirrors the runner's buffer cap: output cap plus the longest secret.
    const bufferCap = 4096 + crossSecret.length;
    const splitFragment = 'sk-live-';
    const fillerCount = Math.floor((bufferCap - 3 - splitFragment.length) / secret.length);
    const padding = bufferCap - fillerCount * secret.length - splitFragment.length;
    // Land `splitFragment` exactly at the cap, then overflow so truncation bites.
    const stderrText =
      'x'.repeat(padding) + secret.repeat(fillerCount) + splitFragment + 'y'.repeat(100);
    expect(stderrText.length).toBeGreaterThan(bufferCap);
    expect(stderrText.slice(0, bufferCap).endsWith(crossSecret.slice(0, 13))).toBeTrue();

    const child = new FakeChild();
    const spawnImpl = ((_command: string): ChildProcess => {
      queueMicrotask(() => child.crash(1, stderrText));
      return child as unknown as ChildProcess;
    }) as typeof spawn;

    const error = await collect(
      runDeepseekAcpTurn(processInput({ secretValues: [crossSecret] }), {
        spawn: spawnImpl,
        terminateGraceMs: 0,
      })
    ).catch((caught: unknown) => caught);

    const message = (error as DeepseekProviderError).message;
    expect(error).toBeInstanceOf(DeepseekProviderError);
    expect(message).not.toContain(secret);
    expect(message).not.toContain(crossSecret);
    // Every 4+ character prefix of the real secret would be a genuine leak.
    for (let length = 4; length <= secret.length; length++) {
      expect(message).not.toContain(secret.slice(0, length));
    }
  });

  test('caller-supplied secretValues reach the runner and are redacted', async () => {
    // MCP header values never enter the child environment, so env-derived
    // redaction cannot see them — they must arrive through `secretValues`.
    // The header sits early in stderr so it is inside every possible buffer cap;
    // the overflow filler only forces truncation. Boundary splitting is covered
    // by the two tests above.
    const headerSecret = 'Bearer static-mcp-header-token';
    const envSecret = 'sk-live-secret';
    const stderrText = `${headerSecret} failed\n${'v'.repeat(6000)}`;

    const child = new FakeChild();
    const spawnImpl = ((_command: string): ChildProcess => {
      queueMicrotask(() => child.crash(1, stderrText));
      return child as unknown as ChildProcess;
    }) as typeof spawn;

    const error = await collect(
      runDeepseekAcpTurn(
        processInput({
          env: { DEEPSEEK_API_KEY: envSecret, PATH: '/usr/bin' },
          secretValues: [headerSecret],
        }),
        { spawn: spawnImpl, terminateGraceMs: 0 }
      )
    ).catch((caught: unknown) => caught);

    const message = (error as DeepseekProviderError).message;
    expect(error).toBeInstanceOf(DeepseekProviderError);
    // Sanity: without `secretValues` the header would survive verbatim, because
    // its name is not an env var name the collector can match.
    expect(stderrText).toContain(headerSecret);
    expect(message).toContain('[REDACTED]');
    expect(message).not.toContain(headerSecret);
    expect(message).not.toContain('Bearer');
    expect(message).not.toContain(envSecret);
  });

  test('stripping one tail fragment cannot expose a further secret prefix', async () => {
    // A single trim pass is not enough. With these two secrets a truncated tail of
    // `BBBBBBBBAAAA` ends with the first secret's 4-character prefix; removing
    // exactly that exposes `BBBBBBBB`, a genuine 8-character prefix of the second.
    // Stripping must repeat to a fixed point.
    const shortSecret = 'AAAAZZZZ';
    const longSecret = 'BBBBBBBBXXXXX';
    // Mirror the runner's buffer cap: output cap plus the longest secret.
    const bufferCap = 4096 + longSecret.length;
    const stackedTail = 'BBBBBBBBAAAA';
    // Whole copies of `longSecret` so redaction shrinks the text below the output
    // cap; otherwise the cap itself would slice the tail away and hide the leak.
    const copies = 200;
    const fillerCount = bufferCap - stackedTail.length - longSecret.length * copies;
    expect(fillerCount).toBeGreaterThan(0);
    const stderrText =
      'f'.repeat(fillerCount) +
      longSecret.repeat(copies) +
      stackedTail +
      'OVERFLOW-SENTINEL-0123456789';
    expect(stderrText.length).toBeGreaterThan(bufferCap);
    expect(stderrText.slice(0, bufferCap).endsWith(stackedTail)).toBeTrue();

    const child = new FakeChild();
    const spawnImpl = ((_command: string): ChildProcess => {
      queueMicrotask(() => child.crash(1, stderrText));
      return child as unknown as ChildProcess;
    }) as typeof spawn;

    const error = await collect(
      runDeepseekAcpTurn(
        // No sensitive env names, so the redaction set is exactly the two secrets.
        processInput({ env: { PATH: '/usr/bin' }, secretValues: [shortSecret, longSecret] }),
        { spawn: spawnImpl, terminateGraceMs: 0 }
      )
    ).catch((caught: unknown) => caught);

    const message = (error as DeepseekProviderError).message;
    expect(error).toBeInstanceOf(DeepseekProviderError);
    expect(message).toContain('[REDACTED]');
    // Every prefix of 4+ characters of either secret would be a real leak.
    for (const secret of [shortSecret, longSecret]) {
      for (let length = 4; length <= secret.length; length++) {
        expect(message).not.toContain(secret.slice(0, length));
      }
    }
  });
});
