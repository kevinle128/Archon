import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough, Readable, Writable } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import {
  agent,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
  type AgentApp,
  type CreateElicitationRequest,
  type InitializeRequest,
  type InitializeResponse,
  type SessionUpdate,
} from '@agentclientprotocol/sdk';

import { AskHumanAwaitingError, type MessageChunk, type NativeTool } from '../../types';
import { driveDevinAcpTurn, runDevinAcpTurn, type DevinProcessInput } from './acp-client';
import { DevinProviderError } from './errors';

interface RecordedCall {
  method: string;
  params: unknown;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

function defaultInitialize(): InitializeResponse {
  return {
    protocolVersion: PROTOCOL_VERSION,
    agentCapabilities: { loadSession: true, mcpCapabilities: { http: false, sse: false } },
    authMethods: [{ id: 'devin-browser', name: 'Log in with browser' }],
  };
}

const DEFAULT_MODES = {
  currentModeId: 'accept-edits',
  availableModes: [
    { id: 'accept-edits', name: 'Code' },
    { id: 'bypass', name: 'Bypass Permissions' },
  ],
};

const MODEL_OPTION = {
  id: 'model',
  name: 'Model',
  category: 'model',
  type: 'select' as const,
  currentValue: 'fusion-default',
  options: [
    { value: 'fusion-default', name: 'Fusion' },
    { value: 'claude-opus-5-low', name: 'Claude Opus 5 Low' },
  ],
};

function askElicitation(sessionId: string): CreateElicitationRequest {
  return {
    sessionId,
    mode: 'form',
    message: 'Which color do you prefer?',
    requestedSchema: {
      type: 'object',
      properties: {
        q0: {
          title: 'Color',
          description: 'Which color do you prefer?',
          type: 'string',
          oneOf: [{ const: 'red' }, { const: 'blue' }],
        },
      },
      required: ['q0'],
    },
    _meta: { 'cognition.ai/allowOther': true },
  } as unknown as CreateElicitationRequest;
}

interface FakeDevin {
  app: AgentApp;
  calls: RecordedCall[];
  methodsCalled: () => string[];
  permissionResponses: unknown[];
  elicitationResponses: unknown[];
  cancelled: Deferred<void>;
}

function createFakeDevin(options?: {
  sessionId?: string;
  initialize?: (params: InitializeRequest) => InitializeResponse;
  loadError?: Error;
  modes?: { currentModeId: string; availableModes: { id: string; name: string }[] };
  newHold?: Deferred<void>;
  setModeError?: Error;
  replayUpdates?: SessionUpdate[];
  modelValueApplied?: string;
  modelError?: Error;
  promptUpdates?: SessionUpdate[];
  promptText?: string;
  promptHold?: Deferred<void>;
  requestPermission?: boolean;
  elicitAfterToolCall?: boolean;
  onPromptSettled?: () => void;
  ignoreCancel?: boolean;
  onNewStarted?: () => void;
}): FakeDevin {
  const calls: RecordedCall[] = [];
  const permissionResponses: unknown[] = [];
  const elicitationResponses: unknown[] = [];
  const cancelled = createDeferred<void>();
  const sessionId = options?.sessionId ?? 'sess-new-1';
  let currentModel = MODEL_OPTION.currentValue;

  const app = agent({ name: 'fake-devin' })
    // Passthrough: SDK 1.4.0's typed initialize parser fills fs/terminal/auth defaults,
    // which would hide whether Archon advertised elicitation.
    .onRequest(
      methods.agent.initialize,
      (params: unknown) => params as InitializeRequest,
      c => {
        calls.push({ method: methods.agent.initialize, params: c.params });
        return options?.initialize ? options.initialize(c.params) : defaultInitialize();
      }
    )
    .onRequest(methods.agent.session.new, async c => {
      calls.push({ method: methods.agent.session.new, params: c.params });
      options?.onNewStarted?.();
      if (options?.newHold !== undefined) await options.newHold.promise;
      return { sessionId, modes: options?.modes ?? DEFAULT_MODES, configOptions: [MODEL_OPTION] };
    })
    .onRequest(methods.agent.session.setMode, c => {
      calls.push({ method: methods.agent.session.setMode, params: c.params });
      if (options?.setModeError) throw options.setModeError;
      return {};
    })
    .onRequest(methods.agent.session.load, async c => {
      calls.push({ method: methods.agent.session.load, params: c.params });
      if (options?.loadError) throw options.loadError;
      for (const update of options?.replayUpdates ?? []) {
        await c.client.notify(methods.client.session.update, {
          sessionId: c.params.sessionId,
          update,
        });
      }
      return { modes: options?.modes ?? DEFAULT_MODES, configOptions: [MODEL_OPTION] };
    })
    .onRequest(methods.agent.session.setConfigOption, c => {
      calls.push({ method: methods.agent.session.setConfigOption, params: c.params });
      if (options?.modelError) throw options.modelError;
      currentModel = options?.modelValueApplied ?? String((c.params as { value: unknown }).value);
      return { configOptions: [{ ...MODEL_OPTION, currentValue: currentModel }] };
    })
    .onRequest(methods.agent.session.prompt, async c => {
      calls.push({ method: methods.agent.session.prompt, params: c.params });
      const sid = c.params.sessionId;
      if (options?.requestPermission) {
        permissionResponses.push(
          await c.client.request(methods.client.session.requestPermission, {
            sessionId: sid,
            toolCall: { toolCallId: 'perm-1', title: 'Delete the repository' },
            options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
          })
        );
        await cancelled.promise;
        return { stopReason: 'cancelled' as const };
      }
      for (const update of options?.promptUpdates ?? []) {
        await c.client.notify(methods.client.session.update, { sessionId: sid, update });
      }
      if (options?.elicitAfterToolCall) {
        await c.client.notify(methods.client.session.update, {
          sessionId: sid,
          update: {
            sessionUpdate: 'tool_call',
            toolCallId: 'call_ask_1',
            title: 'Asked user Which color do you prefer?',
            rawInput: { questions: [] },
            _meta: { 'cognition.ai/inferenceToolName': 'ask_user_question' },
          } as SessionUpdate,
        });
        elicitationResponses.push(
          await c.client.request(methods.client.elicitation.create, askElicitation(sid))
        );
        await cancelled.promise;
        await c.client.notify(methods.client.session.update, {
          sessionId: sid,
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'call_ask_1',
            status: 'failed',
            content: [
              {
                type: 'content',
                content: { type: 'text', text: 'Canceled due to user interrupt' },
              },
            ],
          } as SessionUpdate,
        });
        return { stopReason: 'cancelled' as const };
      }
      if (options?.promptText !== undefined) {
        await c.client.notify(methods.client.session.update, {
          sessionId: sid,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: options.promptText },
          },
        });
      }
      if (options?.promptHold !== undefined) {
        if (options.ignoreCancel) await options.promptHold.promise;
        else await Promise.race([options.promptHold.promise, cancelled.promise]);
      }
      options?.onPromptSettled?.();
      return {
        stopReason: 'end_turn' as const,
        usage: { totalTokens: 10, inputTokens: 8, outputTokens: 2, cachedReadTokens: 5 },
      };
    })
    .onNotification(methods.agent.session.cancel, c => {
      calls.push({ method: methods.agent.session.cancel, params: c.params });
      cancelled.resolve();
    });

  return {
    app,
    calls,
    methodsCalled: () => calls.map(call => call.method),
    permissionResponses,
    elicitationResponses,
    cancelled,
  };
}

async function collect(stream: AsyncGenerator<MessageChunk>): Promise<MessageChunk[]> {
  const chunks: MessageChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

function baseInput(overrides: Partial<Parameters<typeof driveDevinAcpTurn>[1]> = {}) {
  return { cwd: '/repo', prompt: 'hello', ...overrides };
}

function askTool(handler: NativeTool['handler']): NativeTool {
  return { name: 'AskHuman', description: 'ask', inputSchema: { type: 'object' }, handler };
}

describe('driveDevinAcpTurn — fresh turn', () => {
  test('initializes without elicitation, creates a session, streams text, and reports usage + model', async () => {
    const fake = createFakeDevin({ promptText: 'PONG' });
    const chunks = await collect(driveDevinAcpTurn(fake.app, baseInput()));
    expect(fake.methodsCalled()).toEqual([
      'initialize',
      'session/new',
      'session/set_mode',
      'session/prompt',
    ]);
    const init = fake.calls[0]?.params as InitializeRequest;
    expect(init.clientCapabilities).toEqual({});
    expect(chunks).toEqual([
      { type: 'assistant', content: 'PONG', textMode: 'delta' },
      {
        type: 'result',
        sessionId: 'sess-new-1',
        stopReason: 'end_turn',
        resolvedModel: { id: 'fusion-default' },
        usageBreakdown: [
          {
            provider: 'devin',
            model: 'fusion-default',
            modelSource: 'reported',
            inputTokens: 8,
            outputTokens: 2,
            cacheReadTokens: 5,
          },
        ],
      },
    ]);
  });

  test('never sends session/close or --model; applies the model through set_config_option', async () => {
    const fake = createFakeDevin({ promptText: 'ok' });
    const chunks = await collect(
      driveDevinAcpTurn(fake.app, baseInput({ model: 'claude-opus-5-low' }))
    );
    expect(fake.methodsCalled()).toEqual([
      'initialize',
      'session/new',
      'session/set_mode',
      'session/set_config_option',
      'session/prompt',
    ]);
    expect(fake.calls[3]?.params).toEqual({
      sessionId: 'sess-new-1',
      configId: 'model',
      value: 'claude-opus-5-low',
    });
    const result = chunks.at(-1);
    expect(result).toMatchObject({ type: 'result', resolvedModel: { id: 'claude-opus-5-low' } });
  });

  test('an unknown model fails with Devin reason before any prompt is sent', async () => {
    const fake = createFakeDevin({
      modelError: Object.assign(new RequestError(-32002, 'Resource not found'), {
        data: { uri: 'Model not found: opus. Available models: claude-opus-5-low' },
      }),
    });
    await expect(
      collect(driveDevinAcpTurn(fake.app, baseInput({ model: 'opus' })))
    ).rejects.toMatchObject({
      subtype: 'devin_unsupported_model',
      message: 'Model not found: opus. Available models: claude-opus-5-low',
    });
    expect(fake.methodsCalled()).not.toContain('session/prompt');
  });

  test('fails on protocol mismatch and on a missing loadSession capability', async () => {
    const mismatch = createFakeDevin({
      initialize: () => ({ ...defaultInitialize(), protocolVersion: 999 }),
    });
    await expect(collect(driveDevinAcpTurn(mismatch.app, baseInput()))).rejects.toMatchObject({
      subtype: 'devin_protocol_error',
    });
    const noLoad = createFakeDevin({
      initialize: () => ({ ...defaultInitialize(), agentCapabilities: { loadSession: false } }),
    });
    await expect(collect(driveDevinAcpTurn(noLoad.app, baseInput()))).rejects.toMatchObject({
      subtype: 'devin_protocol_error',
      message: expect.stringContaining('loadSession'),
    });
  });

  test('switches a new session to bypass mode right after session/new', async () => {
    const fake = createFakeDevin({ promptText: 'x' });
    await collect(driveDevinAcpTurn(fake.app, baseInput()));
    expect(fake.calls[2]).toEqual({
      method: 'session/set_mode',
      params: { sessionId: 'sess-new-1', modeId: 'bypass' },
    });
  });

  test('skips set_mode when the session already reports bypass', async () => {
    const fake = createFakeDevin({
      promptText: 'x',
      modes: { currentModeId: 'bypass', availableModes: DEFAULT_MODES.availableModes },
    });
    await collect(driveDevinAcpTurn(fake.app, baseInput()));
    expect(fake.methodsCalled()).toEqual(['initialize', 'session/new', 'session/prompt']);
  });

  test('fails before the prompt when bypass is not an available mode', async () => {
    const fake = createFakeDevin({
      modes: {
        currentModeId: 'accept-edits',
        availableModes: [{ id: 'accept-edits', name: 'Code' }],
      },
    });
    await expect(collect(driveDevinAcpTurn(fake.app, baseInput()))).rejects.toMatchObject({
      subtype: 'devin_protocol_error',
      message: expect.stringContaining('bypass'),
    });
    expect(fake.methodsCalled()).not.toContain('session/prompt');
  });

  test('a session/new that never answers fails within the setup timeout', async () => {
    const previous = process.env.DEVIN_ACP_SETUP_TIMEOUT_MS;
    process.env.DEVIN_ACP_SETUP_TIMEOUT_MS = '50';
    try {
      const fake = createFakeDevin({ newHold: createDeferred<void>() });
      await expect(collect(driveDevinAcpTurn(fake.app, baseInput()))).rejects.toMatchObject({
        subtype: 'devin_protocol_error',
        message: expect.stringContaining('did not answer within'),
      });
    } finally {
      if (previous === undefined) delete process.env.DEVIN_ACP_SETUP_TIMEOUT_MS;
      else process.env.DEVIN_ACP_SETUP_TIMEOUT_MS = previous;
    }
  });

  test('augments the prompt for structured output and parses the transcript', async () => {
    const fake = createFakeDevin({ promptText: '{"ok":true}' });
    const chunks = await collect(
      driveDevinAcpTurn(
        fake.app,
        baseInput({ outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } } })
      )
    );
    const prompt = (
      fake.calls.find(c => c.method === 'session/prompt')?.params as { prompt: { text: string }[] }
    ).prompt[0]?.text;
    expect(prompt).toContain('CRITICAL: Respond with ONLY a JSON object');
    expect(chunks.at(-1)).toMatchObject({ type: 'result', structuredOutput: { ok: true } });
  });

  test('a not-logged-in agent fails session/new with devin_not_logged_in', async () => {
    const fake = createFakeDevin();
    const app = agent({ name: 'auth-required' })
      .onRequest(methods.agent.initialize, () => defaultInitialize())
      .onRequest(methods.agent.session.new, () => {
        throw RequestError.authRequired();
      });
    void fake;
    await expect(collect(driveDevinAcpTurn(app, baseInput()))).rejects.toMatchObject({
      subtype: 'devin_not_logged_in',
    });
  });
});

describe('driveDevinAcpTurn — session load', () => {
  test('loads the stored session, suppresses replayed history, and streams only new events', async () => {
    const fake = createFakeDevin({
      sessionId: 'sess-old',
      replayUpdates: [
        { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'old prompt' } },
        { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'old answer' } },
        { sessionUpdate: 'tool_call', toolCallId: 'old-1', title: 'Read file' } as SessionUpdate,
      ],
      promptText: 'new answer',
    });
    const chunks = await collect(
      driveDevinAcpTurn(fake.app, baseInput({ resumeSessionId: 'sess-old' }))
    );
    expect(fake.methodsCalled()).toEqual([
      'initialize',
      'session/load',
      'session/set_mode',
      'session/prompt',
    ]);
    expect(fake.calls[1]?.params).toEqual({ sessionId: 'sess-old', cwd: '/repo', mcpServers: [] });
    expect(chunks).toEqual([
      { type: 'assistant', content: 'new answer', textMode: 'delta' },
      expect.objectContaining({ type: 'result', sessionId: 'sess-old' }),
    ]);
  });

  test('a failed load is terminal and never creates a new session', async () => {
    const fake = createFakeDevin({
      loadError: Object.assign(new RequestError(-32016, 'Session not found'), {
        data: { 'cognition.ai/errorKind': 'session_not_found' },
      }),
    });
    await expect(
      collect(driveDevinAcpTurn(fake.app, baseInput({ resumeSessionId: 'gone' })))
    ).rejects.toMatchObject({
      subtype: 'devin_session_load_failed',
    });
    expect(fake.methodsCalled()).toEqual(['initialize', 'session/load']);
  });

  test('an AskHuman re-entry sends only the answer message into the loaded session', async () => {
    const fake = createFakeDevin({ sessionId: 'sess-old', promptText: 'CHOSEN=blue' });
    const chunks = await collect(
      driveDevinAcpTurn(
        fake.app,
        baseInput({
          prompt: 'original node prompt',
          resumeSessionId: 'sess-old',
          askHuman: askTool(async () => 'unused'),
          resumeInteractions: [
            {
              tool_use_id: 'call_ask_1',
              payload: [{ questionId: 'q0', value: 'blue' }],
              declined: false,
            },
          ],
        })
      )
    );
    const promptParams = fake.calls.find(c => c.method === 'session/prompt')?.params as {
      prompt: { text: string }[];
    };
    expect(promptParams.prompt[0]?.text).toBe(
      'AskHuman call_ask_1 answers:\n[{"questionId":"q0","value":"blue"}]\n\nContinue the task using these answers. Do not call ask_user_question again for these questions.'
    );
    expect(promptParams.prompt[0]?.text).not.toContain('original node prompt');
    expect(chunks[0]).toEqual({ type: 'assistant', content: 'CHOSEN=blue', textMode: 'delta' });
  });
});

describe('driveDevinAcpTurn — AskHuman pause', () => {
  test('advertises elicitation only when AskHuman is supplied', async () => {
    const fake = createFakeDevin({ promptText: 'x' });
    await collect(driveDevinAcpTurn(fake.app, baseInput({ askHuman: askTool(async () => 'ok') })));
    const init = fake.calls[0]?.params as InitializeRequest;
    expect(init.clientCapabilities).toEqual({ elicitation: { form: {} } });
  });

  test('pauses: calls the handler with the tool-call id, cancels the turn, rethrows the control error', async () => {
    const fake = createFakeDevin({ elicitAfterToolCall: true });
    const seen: { input: unknown; context: unknown }[] = [];
    const awaiting = new AskHumanAwaitingError('call_ask_1', 'node-1', 'run-1');
    const handler: NativeTool['handler'] = async (input, context) => {
      seen.push({ input, context });
      throw awaiting;
    };
    const gen = driveDevinAcpTurn(fake.app, baseInput({ askHuman: askTool(handler) }));
    const chunks: MessageChunk[] = [];
    let thrown: unknown;
    try {
      for await (const chunk of gen) chunks.push(chunk);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(awaiting);
    expect(seen).toEqual([
      {
        input: {
          questions: [
            {
              id: 'q0',
              prompt: 'Which color do you prefer?',
              selection: 'single',
              options: ['red', 'blue'],
              allowOther: true,
            },
          ],
        },
        context: { toolUseId: 'call_ask_1', sessionId: 'sess-new-1' },
      },
    ]);
    expect(fake.elicitationResponses).toEqual([{ action: 'cancel' }]);
    expect(fake.methodsCalled()).toContain('session/cancel');
    expect(chunks.map(c => c.type)).toEqual(['tool', 'tool_result']);
    expect(chunks.some(c => c.type === 'result')).toBe(false);
  });

  test('a handler failure is terminal, not a pause, and never reads as a successful answer', async () => {
    const fake = createFakeDevin({ elicitAfterToolCall: true });
    await expect(
      collect(
        driveDevinAcpTurn(
          fake.app,
          baseInput({
            askHuman: askTool(async () => {
              throw new Error('db down');
            }),
          })
        )
      )
    ).rejects.toMatchObject({
      subtype: 'devin_protocol_error',
      message: expect.stringContaining('db down'),
    });
    expect(fake.elicitationResponses).toEqual([{ action: 'cancel' }]);
  });

  test('an elicitation without AskHuman is cancelled and fails the turn', async () => {
    const fake = createFakeDevin({ elicitAfterToolCall: true });
    await expect(collect(driveDevinAcpTurn(fake.app, baseInput()))).rejects.toMatchObject({
      subtype: 'devin_protocol_error',
      message: expect.stringContaining('elicitation'),
    });
  });
});

describe('driveDevinAcpTurn — permission and abort', () => {
  test('a permission request is cancelled and ends the turn naming the blocked action', async () => {
    const fake = createFakeDevin({ requestPermission: true });
    await expect(collect(driveDevinAcpTurn(fake.app, baseInput()))).rejects.toMatchObject({
      subtype: 'devin_permission_blocked',
      message: expect.stringContaining('Delete the repository'),
    });
    expect(fake.permissionResponses).toEqual([{ outcome: { outcome: 'cancelled' } }]);
    expect(fake.methodsCalled()).toContain('session/cancel');
  });

  test('abort during the prompt sends session/cancel and yields an aborted result', async () => {
    const hold = createDeferred<void>();
    const abort = new AbortController();
    const fake = createFakeDevin({ promptHold: hold, promptText: 'partial' });
    const gen = driveDevinAcpTurn(fake.app, baseInput({ abortSignal: abort.signal }));
    const first = await gen.next();
    expect(first.value).toEqual({ type: 'assistant', content: 'partial', textMode: 'delta' });
    abort.abort();
    const rest: MessageChunk[] = [];
    for await (const chunk of gen) rest.push(chunk);
    expect(rest).toEqual([
      {
        type: 'result',
        sessionId: 'sess-new-1',
        stopReason: 'aborted',
        isError: true,
        errorSubtype: 'devin_aborted',
      },
    ]);
    expect(fake.methodsCalled()).toContain('session/cancel');
  });

  test('a pre-aborted signal skips the prompt', async () => {
    const abort = new AbortController();
    abort.abort();
    const fake = createFakeDevin({ promptText: 'never' });
    const chunks = await collect(
      driveDevinAcpTurn(fake.app, baseInput({ abortSignal: abort.signal }))
    );
    expect(chunks).toEqual([
      {
        type: 'result',
        sessionId: 'sess-new-1',
        stopReason: 'aborted',
        isError: true,
        errorSubtype: 'devin_aborted',
      },
    ]);
    expect(fake.methodsCalled()).not.toContain('session/prompt');
  });

  test('abort during setup still cancels the session and skips the prompt', async () => {
    const hold = createDeferred<void>();
    const started = createDeferred<void>();
    const abort = new AbortController();
    const fake = createFakeDevin({ newHold: hold, onNewStarted: () => started.resolve() });
    const collecting = collect(
      driveDevinAcpTurn(fake.app, baseInput({ abortSignal: abort.signal }))
    );
    await started.promise;
    abort.abort();
    hold.resolve();
    const chunks = await collecting;
    expect(fake.methodsCalled()).not.toContain('session/prompt');
    expect(fake.calls.filter(c => c.method === 'session/cancel')).toHaveLength(1);
    expect(chunks).toEqual([
      {
        type: 'result',
        sessionId: 'sess-new-1',
        stopReason: 'aborted',
        isError: true,
        errorSubtype: 'devin_aborted',
      },
    ]);
  });

  test('abort completes the turn even when the agent ignores session/cancel', async () => {
    const hold = createDeferred<void>();
    const abort = new AbortController();
    const fake = createFakeDevin({
      promptText: 'partial',
      promptHold: hold,
      ignoreCancel: true,
    });
    try {
      const gen = driveDevinAcpTurn(fake.app, baseInput({ abortSignal: abort.signal }));
      const first = await gen.next();
      expect(first.value).toEqual({ type: 'assistant', content: 'partial', textMode: 'delta' });
      abort.abort();
      const rest: MessageChunk[] = [];
      for await (const chunk of gen) rest.push(chunk);
      expect(rest).toEqual([
        {
          type: 'result',
          sessionId: 'sess-new-1',
          stopReason: 'aborted',
          isError: true,
          errorSubtype: 'devin_aborted',
        },
      ]);
      expect(fake.methodsCalled()).toContain('session/cancel');
    } finally {
      hold.resolve();
    }
  });
});

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
    if (name === 'SIGTERM' && this.ignoreTerm) return true;
    if (this.exitCode !== null || this.signalCode !== null) return true;
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

function attachAgent(child: FakeChild, fake: FakeDevin): void {
  const stream = ndJsonStream(
    Writable.toWeb(child.stdout) as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdin) as ReadableStream<Uint8Array>
  );
  fake.app.connect(stream);
}

function processInput(overrides: Partial<DevinProcessInput> = {}): DevinProcessInput {
  return {
    cwd: '/repo',
    prompt: 'hello',
    binaryPath: '/usr/local/bin/devin',
    spawnArgs: ['--permission-mode', 'yolo', 'acp'],
    env: { PATH: '/usr/bin', DEVIN_API_TOKEN: 'tok-secret-1234' },
    ...overrides,
  };
}

describe('runDevinAcpTurn — process wrapper', () => {
  test('spawns the binary with cwd, args, and env, streams the turn, and reaps the child', async () => {
    const fake = createFakeDevin({ promptText: 'PONG' });
    const child = new FakeChild();
    const spawnCalls: unknown[] = [];
    const spawnImpl = ((command: string, args: string[], options: unknown) => {
      spawnCalls.push({ command, args, options });
      attachAgent(child, fake);
      return child as unknown as ChildProcess;
    }) as unknown as typeof import('node:child_process').spawn;
    const chunks = await collect(
      runDevinAcpTurn(processInput(), { spawn: spawnImpl, terminateGraceMs: 0 })
    );
    expect(spawnCalls).toEqual([
      {
        command: '/usr/local/bin/devin',
        args: ['--permission-mode', 'yolo', 'acp'],
        options: {
          cwd: '/repo',
          env: { PATH: '/usr/bin', DEVIN_API_TOKEN: 'tok-secret-1234' },
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      },
    ]);
    expect(chunks[0]).toEqual({ type: 'assistant', content: 'PONG', textMode: 'delta' });
    expect(child.signals).toContain('SIGTERM');
  });

  test('two message chunks stream as two ordered delta chunks before the terminal result', async () => {
    const fake = createFakeDevin({
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
    }) as unknown as typeof import('node:child_process').spawn;
    const chunks = await collect(
      runDevinAcpTurn(processInput(), { spawn: spawnImpl, terminateGraceMs: 0 })
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

  test('a child that dies mid-turn fails with devin_child_exited and redacted stderr', async () => {
    const fake = createFakeDevin({ promptHold: createDeferred<void>() });
    const child = new FakeChild();
    const spawnImpl = (() => {
      attachAgent(child, fake);
      queueMicrotask(() => child.crash(1, 'fatal: token tok-secret-1234 rejected'));
      return child as unknown as ChildProcess;
    }) as unknown as typeof import('node:child_process').spawn;
    let thrown: unknown;
    try {
      await collect(runDevinAcpTurn(processInput(), { spawn: spawnImpl, terminateGraceMs: 0 }));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(DevinProviderError);
    expect((thrown as DevinProviderError).subtype).toBe('devin_child_exited');
    expect((thrown as Error).message).toContain('[REDACTED]');
    expect((thrown as Error).message).not.toContain('tok-secret-1234');
  });

  test('a spawn failure maps to devin_spawn_failed', async () => {
    const spawnImpl = (() => {
      throw new Error('ENOENT');
    }) as unknown as typeof import('node:child_process').spawn;
    await expect(
      collect(runDevinAcpTurn(processInput(), { spawn: spawnImpl }))
    ).rejects.toMatchObject({
      subtype: 'devin_spawn_failed',
    });
  });

  test('AskHuman control errors pass through the wrapper untouched', async () => {
    const fake = createFakeDevin({ elicitAfterToolCall: true });
    const child = new FakeChild();
    const spawnImpl = (() => {
      attachAgent(child, fake);
      return child as unknown as ChildProcess;
    }) as unknown as typeof import('node:child_process').spawn;
    const awaiting = new AskHumanAwaitingError('call_ask_1', 'n', 'r');
    let thrown: unknown;
    try {
      await collect(
        runDevinAcpTurn(
          processInput({
            askHuman: askTool(async () => {
              throw awaiting;
            }),
          }),
          { spawn: spawnImpl, terminateGraceMs: 0 }
        )
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(awaiting);
    expect(child.signals).toContain('SIGTERM');
  });

  test('escalates to SIGKILL when the child ignores SIGTERM', async () => {
    const fake = createFakeDevin({ promptText: 'x' });
    const child = new FakeChild();
    child.ignoreTerm = true;
    const spawnImpl = (() => {
      attachAgent(child, fake);
      return child as unknown as ChildProcess;
    }) as unknown as typeof import('node:child_process').spawn;
    await collect(runDevinAcpTurn(processInput(), { spawn: spawnImpl, terminateGraceMs: 5 }));
    expect(child.signals).toEqual(['SIGTERM', 'SIGKILL']);
  });

  test('a truncated stderr tail cannot leak a split secret', async () => {
    const fake = createFakeDevin({ promptHold: createDeferred<void>() });
    const child = new FakeChild();
    const spawnImpl = (() => {
      attachAgent(child, fake);
      queueMicrotask(() => child.crash(1, `${'x'.repeat(4097)}tok-secret-1234`));
      return child as unknown as ChildProcess;
    }) as unknown as typeof import('node:child_process').spawn;
    let thrown: unknown;
    try {
      await collect(runDevinAcpTurn(processInput(), { spawn: spawnImpl, terminateGraceMs: 0 }));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(DevinProviderError);
    expect((thrown as DevinProviderError).subtype).toBe('devin_child_exited');
    expect((thrown as Error).message).not.toContain('tok-secret-123');
  });
});
