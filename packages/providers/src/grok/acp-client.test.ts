import { describe, expect, test } from 'bun:test';
import type { ChildProcess, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough, Readable, Writable } from 'node:stream';
import {
  agent,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type AgentApp,
  type InitializeRequest,
  type SessionUpdate,
} from '@agentclientprotocol/sdk';

import { STREAM_ABORTED_TERMINAL_REASON } from '../types';
import type { MessageChunk } from '../types';
import {
  buildGrokAcpUsageBreakdown,
  driveGrokAcpTurn,
  runGrokAcpTurn,
  type GrokAcpProcessInput,
  type GrokAcpTurnInput,
} from './acp-client';

const CWD = '/tmp/archon-grok-cwd';

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(res => {
    resolve = res;
  });
  return { promise, resolve };
}

function baseInput(over: Partial<GrokAcpTurnInput> = {}): GrokAcpTurnInput {
  return { cwd: CWD, prompt: 'hello', ...over };
}

async function collect(gen: AsyncGenerator<MessageChunk>): Promise<MessageChunk[]> {
  const chunks: MessageChunk[] = [];
  for await (const chunk of gen) {
    chunks.push(chunk);
  }
  return chunks;
}

async function waitForMethod(methodsCalled: () => string[], method: string): Promise<void> {
  await new Promise<void>(resolve => {
    const check = (): void => {
      if (methodsCalled().includes(method)) resolve();
      else setTimeout(check, 1);
    };
    check();
  });
}

interface RecordedCall {
  method: string;
  params: unknown;
}

type NotifySessionUpdate = (sessionId: string, update: SessionUpdate) => Promise<void>;

interface FakeGrokAgent {
  app: AgentApp;
  calls: RecordedCall[];
  methodsCalled: () => string[];
  permissionResponses: unknown[];
}

function defaultInitialize(): {
  protocolVersion: typeof PROTOCOL_VERSION;
  agentCapabilities: {
    loadSession: boolean;
    sessionCapabilities: { resume: Record<string, never>; close: Record<string, never> };
  };
} {
  return {
    protocolVersion: PROTOCOL_VERSION,
    agentCapabilities: {
      loadSession: true,
      sessionCapabilities: { resume: {}, close: {} },
    },
  };
}

function createFakeGrokAgent(options?: {
  sessionId?: string;
  initialize?: (params: InitializeRequest) => ReturnType<typeof defaultInitialize>;
  resumeError?: Error;
  promptUpdates?: SessionUpdate[];
  promptHold?: ReturnType<typeof createDeferred<void>>;
  promptUsageMeta?: Record<string, unknown>;
  requestPermission?: boolean;
  onCancel?: (notify: NotifySessionUpdate) => void | Promise<void>;
}): FakeGrokAgent {
  const calls: RecordedCall[] = [];
  const permissionResponses: unknown[] = [];
  const sessionId = options?.sessionId ?? 'sess-new-1';

  const app = agent({ name: 'fake-grok' })
    .onRequest(methods.agent.initialize, c => {
      calls.push({ method: methods.agent.initialize, params: c.params });
      return options?.initialize ? options.initialize(c.params) : defaultInitialize();
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
    .onRequest(methods.agent.session.prompt, async c => {
      calls.push({ method: methods.agent.session.prompt, params: c.params });
      if (options?.requestPermission) {
        const response = await c.client.request(methods.client.session.requestPermission, {
          sessionId: c.params.sessionId,
          toolCall: { toolCallId: 'perm-1', title: 'edit' },
          options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
        });
        permissionResponses.push(response);
      }
      for (const update of options?.promptUpdates ?? []) {
        await c.client.notify(methods.client.session.update, {
          sessionId: c.params.sessionId,
          update,
        });
      }
      if (options?.promptHold !== undefined) {
        await options.promptHold.promise;
      }
      return {
        stopReason: 'end_turn' as const,
        _meta: options?.promptUsageMeta ? { usage: options.promptUsageMeta } : undefined,
      };
    })
    .onRequest(methods.agent.session.close, c => {
      calls.push({ method: methods.agent.session.close, params: c.params });
      return {};
    })
    .onNotification(methods.agent.session.cancel, c => {
      calls.push({ method: methods.agent.session.cancel, params: c.params });
      const notify: NotifySessionUpdate = (targetSessionId, update) =>
        c.client.notify(methods.client.session.update, { sessionId: targetSessionId, update });
      void Promise.resolve(options?.onCancel?.(notify)).then(() => {
        options?.promptHold?.resolve();
      });
    });

  return { app, calls, methodsCalled: () => calls.map(call => call.method), permissionResponses };
}

describe('buildGrokAcpUsageBreakdown', () => {
  test('single reported model produces one detailed row with USD converted from ticks', () => {
    const breakdown = buildGrokAcpUsageBreakdown(
      {
        modelUsage: {
          'grok-4.7-build': {
            inputTokens: 160086,
            outputTokens: 101,
            reasoningTokens: 58,
            cachedReadTokens: 80768,
            cacheCreationTokens: 0,
            modelCalls: 2,
            costUsdTicks: 678728400,
          },
        },
      },
      undefined
    );
    expect(breakdown).toEqual([
      {
        provider: 'xai',
        model: 'grok-4.7-build',
        modelSource: 'reported',
        inputTokens: 160086,
        outputTokens: 101,
        reasoningTokens: 58,
        cacheReadTokens: 80768,
        cacheWriteTokens: 0,
        requests: 2,
        costUsd: 0.06787284,
      },
    ]);
  });

  test('multiple reported models keep per-model requests plus one aggregate unknown row', () => {
    const breakdown = buildGrokAcpUsageBreakdown(
      {
        inputTokens: 100,
        outputTokens: 20,
        costUsdTicks: 500000000,
        modelUsage: {
          'grok-4.7': { modelCalls: 1 },
          'grok-4.7-fast': { modelCalls: 3 },
        },
      },
      undefined
    );
    expect(breakdown).toEqual([
      { provider: 'xai', model: 'grok-4.7', modelSource: 'reported', requests: 1 },
      { provider: 'xai', model: 'grok-4.7-fast', modelSource: 'reported', requests: 3 },
      {
        provider: 'xai',
        model: null,
        modelSource: 'unknown',
        inputTokens: 100,
        outputTokens: 20,
        costUsd: 0.05,
      },
    ]);
  });

  test('no modelUsage falls back to the requested model, then to unknown', () => {
    expect(buildGrokAcpUsageBreakdown({ inputTokens: 5 }, 'grok-4.7')).toEqual([
      { provider: 'xai', model: 'grok-4.7', modelSource: 'requested', inputTokens: 5 },
    ]);
    expect(buildGrokAcpUsageBreakdown({ inputTokens: 5 }, undefined)).toEqual([
      { provider: 'xai', model: null, modelSource: 'unknown', inputTokens: 5 },
    ]);
  });

  test('a non-object or empty usage payload produces no breakdown', () => {
    expect(buildGrokAcpUsageBreakdown(undefined, 'grok-4.7')).toBeUndefined();
    expect(buildGrokAcpUsageBreakdown(null, 'grok-4.7')).toBeUndefined();
    expect(buildGrokAcpUsageBreakdown({}, undefined)).toBeUndefined();
  });
});

describe('driveGrokAcpTurn', () => {
  test('a fresh turn is initialize, session/new, prompt, then session/close', async () => {
    const fake = createFakeGrokAgent({ sessionId: 'sess-fresh' });
    const chunks = await collect(driveGrokAcpTurn(fake.app, baseInput()));
    expect(fake.methodsCalled()).toEqual([
      methods.agent.initialize,
      methods.agent.session.new,
      methods.agent.session.prompt,
      methods.agent.session.close,
    ]);
    expect(chunks.find(chunk => chunk.type === 'result')).toEqual({
      type: 'result',
      sessionId: 'sess-fresh',
      stopReason: 'end_turn',
    });
  });

  test('session/new carries the yoloMode _meta flag and no MCP servers', async () => {
    const fake = createFakeGrokAgent();
    await collect(driveGrokAcpTurn(fake.app, baseInput()));
    expect(fake.calls.find(call => call.method === methods.agent.session.new)?.params).toEqual({
      cwd: CWD,
      mcpServers: [],
      _meta: { yoloMode: true },
    });
  });

  test('a resumed turn calls session/resume and never session/new', async () => {
    const fake = createFakeGrokAgent({ sessionId: 'sess-resume-1' });
    const chunks = await collect(
      driveGrokAcpTurn(fake.app, baseInput({ resumeSessionId: 'sess-resume-1' }))
    );
    expect(fake.methodsCalled()).toEqual([
      methods.agent.initialize,
      methods.agent.session.resume,
      methods.agent.session.prompt,
      methods.agent.session.close,
    ]);
    expect(fake.calls.find(call => call.method === methods.agent.session.resume)?.params).toEqual({
      sessionId: 'sess-resume-1',
      cwd: CWD,
      mcpServers: [],
    });
    expect(chunks.find(chunk => chunk.type === 'result')).toMatchObject({
      sessionId: 'sess-resume-1',
      stopReason: 'end_turn',
      resumed: true,
    });
  });

  test('a fresh (non-resumed) turn omits the resumed field entirely', async () => {
    const fake = createFakeGrokAgent({ sessionId: 'sess-fresh-resumed-flag' });
    const chunks = await collect(driveGrokAcpTurn(fake.app, baseInput()));
    const result = chunks.find(chunk => chunk.type === 'result');
    expect(result).not.toHaveProperty('resumed');
  });

  test('a rejected resume yields grok_acp_resume_failed and never calls prompt or close', async () => {
    // The ACP SDK's JSON-RPC transport does not carry a thrown handler
    // Error's message back to the client verbatim (it surfaces as a generic
    // "Internal error"), so this asserts the result shape and subtype, not
    // literal message text.
    const fake = createFakeGrokAgent({ resumeError: new Error('unknown session') });
    const chunks = await collect(
      driveGrokAcpTurn(fake.app, baseInput({ resumeSessionId: 'sess-missing' }))
    );
    expect(fake.methodsCalled()).toEqual([methods.agent.initialize, methods.agent.session.resume]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      type: 'result',
      sessionId: 'sess-missing',
      isError: true,
      errorSubtype: 'grok_acp_resume_failed',
      resumed: false,
    });
    const result = chunks[0] as Extract<MessageChunk, { type: 'result' }>;
    expect(result.errors).toHaveLength(1);
    expect(typeof result.errors?.[0]).toBe('string');
  });

  test('tool_call and a terminal tool_call_update stream as tool then tool_result', async () => {
    const fake = createFakeGrokAgent({
      promptUpdates: [
        { sessionUpdate: 'tool_call', toolCallId: 'call-1', title: 'run_terminal_command' },
        {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'call-1',
          status: 'completed',
          rawOutput: { exit_code: 0 },
        },
      ],
    });
    const chunks = await collect(driveGrokAcpTurn(fake.app, baseInput()));
    expect(chunks).toContainEqual({
      type: 'tool',
      toolName: 'run_terminal_command',
      toolCallId: 'call-1',
    });
    expect(chunks).toContainEqual({
      type: 'tool_result',
      toolName: 'run_terminal_command',
      toolCallId: 'call-1',
      toolOutput: JSON.stringify({ exit_code: 0 }),
      toolOutcome: 'success',
    });
  });

  test('a fresh turn maps _meta.usage into the terminal result usageBreakdown', async () => {
    const fake = createFakeGrokAgent({
      sessionId: 'sess-usage',
      promptUsageMeta: { inputTokens: 10, outputTokens: 5, costUsdTicks: 100000000 },
    });
    const chunks = await collect(driveGrokAcpTurn(fake.app, baseInput({ model: 'grok-4.7' })));
    expect(chunks.find(chunk => chunk.type === 'result')).toMatchObject({
      usageBreakdown: [
        {
          provider: 'xai',
          model: 'grok-4.7',
          modelSource: 'requested',
          inputTokens: 10,
          outputTokens: 5,
          costUsd: 0.01,
        },
      ],
    });
  });

  test('a real permission request is always declined, never approved', async () => {
    const fake = createFakeGrokAgent({ requestPermission: true });
    await collect(driveGrokAcpTurn(fake.app, baseInput()));
    expect(fake.permissionResponses).toEqual([{ outcome: { outcome: 'cancelled' } }]);
  });

  test('node-level Cancel sends session/cancel, closes the session, then throws Query aborted', async () => {
    const hold = createDeferred<void>();
    const fake = createFakeGrokAgent({ promptHold: hold, sessionId: 'sess-abort-1' });
    const controller = new AbortController();
    const gen = driveGrokAcpTurn(fake.app, baseInput({ abortSignal: controller.signal }));
    const chunksPromise = collect(gen);
    await waitForMethod(fake.methodsCalled, methods.agent.session.prompt);
    controller.abort();
    await expect(chunksPromise).rejects.toThrow('Query aborted');
    expect(fake.methodsCalled()).toContain(methods.agent.session.cancel);
    expect(fake.methodsCalled()).toContain(methods.agent.session.close);
  });

  test('operator Stop sends one session/cancel, closes, and yields the stream-abort marker (no throw)', async () => {
    const hold = createDeferred<void>();
    const fake = createFakeGrokAgent({ promptHold: hold, sessionId: 'sess-interrupt-1' });
    const interrupt = new AbortController();
    const gen = driveGrokAcpTurn(fake.app, baseInput({ interruptSignal: interrupt.signal }));
    const chunksPromise = collect(gen);
    await waitForMethod(fake.methodsCalled, methods.agent.session.prompt);
    interrupt.abort();
    const chunks = await chunksPromise;
    expect(fake.calls.filter(call => call.method === methods.agent.session.cancel)).toHaveLength(1);
    expect(fake.methodsCalled()).toContain(methods.agent.session.close);
    expect(chunks.find(chunk => chunk.type === 'result')).toEqual({
      type: 'result',
      sessionId: 'sess-interrupt-1',
      terminalReason: STREAM_ABORTED_TERMINAL_REASON,
      isError: true,
      errorSubtype: STREAM_ABORTED_TERMINAL_REASON,
    });
  });

  test('a tool cut short by operator Stop settles unknown, not a guessed interrupted', async () => {
    // Measured live: cancel mid-tool leaves the tool_call with no terminal
    // tool_call_update at all (unlike DeepSeek, which reports status:'failed').
    // `closeOutstandingGrokAcpTools` is the only source of a settled outcome.
    const hold = createDeferred<void>();
    const fake = createFakeGrokAgent({
      promptHold: hold,
      sessionId: 'sess-tool-interrupt',
      promptUpdates: [
        { sessionUpdate: 'tool_call', toolCallId: 'call-1', title: 'run_terminal_command' },
      ],
    });
    const interrupt = new AbortController();
    const gen = driveGrokAcpTurn(fake.app, baseInput({ interruptSignal: interrupt.signal }));
    const chunksPromise = collect(gen);
    await waitForMethod(fake.methodsCalled, methods.agent.session.prompt);
    interrupt.abort();
    const chunks = await chunksPromise;
    expect(chunks).toContainEqual({
      type: 'tool_result',
      toolName: 'run_terminal_command',
      toolCallId: 'call-1',
      toolOutput: 'Grok ended before reporting a tool result.',
      toolOutcome: 'unknown',
      outputState: 'unknown',
    });
  });

  test('Stop and Cancel race sends exactly one session/cancel and Cancel wins (throws)', async () => {
    const hold = createDeferred<void>();
    const fake = createFakeGrokAgent({ promptHold: hold });
    const nodeCancel = new AbortController();
    const interrupt = new AbortController();
    const gen = driveGrokAcpTurn(
      fake.app,
      baseInput({ abortSignal: nodeCancel.signal, interruptSignal: interrupt.signal })
    );
    const chunksPromise = collect(gen);
    await waitForMethod(fake.methodsCalled, methods.agent.session.prompt);
    nodeCancel.abort();
    interrupt.abort();
    await expect(chunksPromise).rejects.toThrow('Query aborted');
    expect(fake.calls.filter(call => call.method === methods.agent.session.cancel)).toHaveLength(1);
  });

  test('already-aborted interruptSignal skips the prompt, cancels once, and returns the abort marker', async () => {
    const fake = createFakeGrokAgent({ sessionId: 'sess-preabort' });
    const interrupt = new AbortController();
    interrupt.abort();
    const chunks = await collect(
      driveGrokAcpTurn(fake.app, baseInput({ interruptSignal: interrupt.signal }))
    );
    expect(fake.methodsCalled()).toEqual([
      methods.agent.initialize,
      methods.agent.session.new,
      methods.agent.session.cancel,
      methods.agent.session.close,
    ]);
    expect(fake.methodsCalled()).not.toContain(methods.agent.session.prompt);
    expect(chunks.find(chunk => chunk.type === 'result')).toEqual({
      type: 'result',
      sessionId: 'sess-preabort',
      terminalReason: STREAM_ABORTED_TERMINAL_REASON,
      isError: true,
      errorSubtype: STREAM_ABORTED_TERMINAL_REASON,
    });
  });

  test('a natural result winning a race during session/close ignores a late Stop', async () => {
    const fake = createFakeGrokAgent({ sessionId: 'sess-natural-race' });
    const interrupt = new AbortController();
    const gen = driveGrokAcpTurn(fake.app, baseInput({ interruptSignal: interrupt.signal }));
    const chunks: MessageChunk[] = [];
    for await (const chunk of gen) {
      chunks.push(chunk);
      if (chunk.type === 'result') interrupt.abort();
    }
    expect(fake.methodsCalled()).not.toContain(methods.agent.session.cancel);
    expect(chunks).toEqual([
      { type: 'result', sessionId: 'sess-natural-race', stopReason: 'end_turn' },
    ]);
  });

  test('consumer early return still requests cancel for a live session', async () => {
    const hold = createDeferred<void>();
    const fake = createFakeGrokAgent({
      promptHold: hold,
      sessionId: 'sess-early-return',
      promptUpdates: [
        { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'partial' } },
      ],
    });
    const gen = driveGrokAcpTurn(fake.app, baseInput());
    // The generator must be suspended AT a `yield` (not mid-`await`) for
    // `.return()` to trigger its `finally` block synchronously per spec —
    // pulling the first streamed chunk puts it there.
    const first = await gen.next();
    expect(first.value).toMatchObject({
      type: 'assistant',
      content: 'partial',
      textMode: 'delta',
    });
    // The turn id inside the block id is random per turn, so only the
    // fixed prefix/suffix shape is asserted here.
    expect((first.value as { blockId: string }).blockId).toMatch(
      /^grok-acp-[0-9a-f-]{36}-assistant-1$/
    );
    await gen.return(undefined);
    expect(fake.methodsCalled()).toContain(methods.agent.session.cancel);
    expect(fake.methodsCalled()).toContain(methods.agent.session.close);
    hold.resolve();
  });
});

class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly pid = 4242;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly signals: (NodeJS.Signals | number | undefined)[] = [];

  kill(signal?: NodeJS.Signals | number): boolean {
    this.signals.push(signal);
    if (this.exitCode !== null || this.signalCode !== null) return true;
    const sig = typeof signal === 'string' ? signal : 'SIGTERM';
    queueMicrotask(() => {
      if (this.exitCode !== null || this.signalCode !== null) return;
      this.signalCode = sig;
      // A real OS kill closes the process's own file descriptors, which is
      // what actually unblocks a pending ACP request stuck reading from
      // stdout — see `crash()`'s own comment. Without this, a test using
      // `kill()` to simulate an abort-driven reap would hang exactly like a
      // fake with open pipes but no process behind them, never reproducing
      // what a genuine kill unblocks.
      this.stdin.destroy();
      this.stdout.destroy();
      this.emit('exit', null, sig);
    });
    return true;
  }

  /**
   * Destroying stdin/stdout is load-bearing: without it the ACP stream stays
   * "open" from the SDK's perspective, so a pending `ctx.request()` (e.g.
   * `initialize`) never settles and `gen.return()` on the inner turn
   * generator never resolves either (async generator `.return()` only takes
   * effect once execution reaches a `yield` or completes, not mid-`await`).
   */
  crash(code: number, stderrText?: string): void {
    if (stderrText !== undefined) this.stderr.write(stderrText);
    this.exitCode = code;
    this.stdin.destroy();
    this.stdout.destroy();
    this.emit('exit', code, null);
  }
}

function attachAgent(child: FakeChild, fake: FakeGrokAgent): void {
  const stream = ndJsonStream(
    Writable.toWeb(child.stdout) as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdin) as ReadableStream<Uint8Array>
  );
  fake.app.connect(stream);
}

function fakeSpawn(child: FakeChild): typeof spawn {
  return (() => child as unknown as ChildProcess) as typeof spawn;
}

function processInput(over: Partial<GrokAcpProcessInput> = {}): GrokAcpProcessInput {
  return { cwd: CWD, prompt: 'hello', binaryPath: '/usr/local/bin/grok', ...over };
}

describe('runGrokAcpTurn', () => {
  test('spawns grok agent --always-approve --no-leader [-m] [--reasoning-effort] stdio', async () => {
    const child = new FakeChild();
    const fake = createFakeGrokAgent();
    attachAgent(child, fake);
    let spawnedBinary = '';
    let spawnedArgs: readonly string[] = [];
    const spy: typeof spawn = ((binary: string, args: readonly string[]) => {
      spawnedBinary = binary;
      spawnedArgs = args;
      return child as unknown as ChildProcess;
    }) as typeof spawn;

    await collect(
      runGrokAcpTurn(processInput({ model: 'grok-4.7', effort: 'high' }), { spawn: spy })
    );
    expect(spawnedBinary).toBe('/usr/local/bin/grok');
    expect(spawnedArgs).toEqual([
      'agent',
      '--always-approve',
      '--no-leader',
      '-m',
      'grok-4.7',
      '--reasoning-effort',
      'high',
      'stdio',
    ]);
  });

  test('omits -m and --reasoning-effort when model/effort are unset', async () => {
    const child = new FakeChild();
    const fake = createFakeGrokAgent();
    attachAgent(child, fake);
    let spawnedArgs: readonly string[] = [];
    const spy: typeof spawn = ((_binary: string, args: readonly string[]) => {
      spawnedArgs = args;
      return child as unknown as ChildProcess;
    }) as typeof spawn;

    await collect(runGrokAcpTurn(processInput(), { spawn: spy }));
    expect(spawnedArgs).toEqual(['agent', '--always-approve', '--no-leader', 'stdio']);
  });

  test('a successful turn reaps the child with SIGTERM after the connection closes', async () => {
    const child = new FakeChild();
    const fake = createFakeGrokAgent({ sessionId: 'sess-reap' });
    attachAgent(child, fake);
    const chunks = await collect(runGrokAcpTurn(processInput(), { spawn: fakeSpawn(child) }));
    expect(chunks.find(chunk => chunk.type === 'result')).toMatchObject({ sessionId: 'sess-reap' });
    expect(child.signals).toContain('SIGTERM');
  });

  test('an early child exit surfaces a clear error with captured stderr', async () => {
    const child = new FakeChild();
    const promise = collect(runGrokAcpTurn(processInput(), { spawn: fakeSpawn(child) }));
    child.crash(1, 'not authenticated\n');
    await expect(promise).rejects.toThrow(/exited before the turn completed/);
    await expect(promise).rejects.toThrow(/not authenticated/);
  });

  test('a spawn failure throws without ever attaching the ACP stream', async () => {
    const spawnError = new Error('ENOENT');
    const spy: typeof spawn = (() => {
      throw spawnError;
    }) as typeof spawn;
    await expect(collect(runGrokAcpTurn(processInput(), { spawn: spy }))).rejects.toThrow(
      'Failed to spawn Grok ACP agent: ENOENT'
    );
  });

  test('an abort while stuck on an unanswered ACP request still reaps the child', async () => {
    // No agent attached — nothing ever responds to `initialize`, simulating
    // a subprocess that is alive but has stopped answering the ACP
    // protocol. `driveGrokAcpTurn`'s own cancel race only covers an
    // in-flight `session/prompt`, which is never even sent here. The reap
    // is armed as a plain listener on `abortSignal`, independent of this
    // generator ever being resumed again — the guarantee a caller that
    // stops pulling on abort (e.g. `withIdleTimeout`'s external-abort
    // branch) would otherwise defeat, leaking the process (what this test
    // guards). Killing the child closes its stdio, which is what actually
    // unblocks the stuck request — the turn then rejects with the ordinary
    // "process exited" error `death` already produces for any child exit,
    // not a synthesized abort message.
    const child = new FakeChild();
    const controller = new AbortController();
    const promise = collect(
      runGrokAcpTurn(processInput({ abortSignal: controller.signal }), {
        spawn: fakeSpawn(child),
        // A responsive agent's graceful cancel is expected to win this race
        // within CANCEL_DRAIN_GRACE_MS (500ms); this test's agent is never
        // even attached, so it can never win, and a short grace here just
        // keeps the test fast instead of waiting out the 3s production default.
        abortStuckGraceMs: 5,
      })
    );
    controller.abort();
    await expect(promise).rejects.toThrow('exited before the turn completed');
    expect(child.signals).toContain('SIGTERM');
  });

  test('a caller that stops pulling after abort still gets the child reaped, with no further .next() call', async () => {
    // This reproduces the exact shape a caller like `withIdleTimeout`
    // produces in production: it pulls one chunk, observes the node's
    // AbortController fire, and never calls `.next()` again. An async
    // generator that has just yielded is suspended AT that yield — any
    // cleanup living inside its own loop (a `finally` included) requires a
    // further `.next()` to even reach, so a reap wired only into the loop's
    // own race can never fire here. This differs from the "unanswered ACP
    // request" test above, where the outer generator is still parked INSIDE
    // its very first, still-running `gen.next()`/`Promise.race` call — an
    // in-loop race can still resolve that specific await. Here the loop has
    // already produced one chunk and stopped being resumed entirely, which
    // is what the reap must not depend on.
    const hold = createDeferred<void>();
    const fake = createFakeGrokAgent({
      sessionId: 'sess-parked',
      promptUpdates: [
        { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'partial' } },
      ],
      promptHold: hold,
      // No `onCancel` handler: `session/cancel` is acknowledged but never
      // resolves `promptHold`, so the graceful cancel path can never win
      // either — only the generator-independent stuck-reap listener can end this.
    });
    const child = new FakeChild();
    attachAgent(child, fake);
    const controller = new AbortController();
    const gen = runGrokAcpTurn(processInput({ abortSignal: controller.signal }), {
      spawn: fakeSpawn(child),
      abortStuckGraceMs: 5,
    });

    const first = await gen.next();
    expect(first.done).toBe(false);
    expect(first.value).toMatchObject({ type: 'assistant', content: 'partial' });

    controller.abort();
    // Deliberately never call gen.next() again below — proving the reap
    // does not depend on it.
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(child.signals).toContain('SIGTERM');

    hold.resolve();
    await gen.return(undefined).catch(() => undefined);
  });
});
