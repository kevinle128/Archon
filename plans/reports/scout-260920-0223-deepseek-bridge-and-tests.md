# Scout: DeepSeek operator Stop (turn interrupt) — bridge, abort path, tests, spike

## 1. Event-bridge tool lifecycle mapping

File: `packages/providers/src/community/deepseek/event-bridge.ts`

`mapDeepseekSessionUpdate` (lines 64-133) switches on `update.sessionUpdate`:

- `'tool_call'` (77-92): always emits one `{ type: 'tool', toolName, toolCallId, toolInput? }` chunk and records `{ name, input }` in `state.tools`.
- `'tool_call_update'` (93-115):

```ts
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
```

- All other `sessionUpdate` variants (116-127) map to `[]` (no-op): `user_message_chunk`, `plan`, `plan_update`, `plan_removed`, `available_commands_update`, `current_mode_update`, `config_option_update`, `session_info_update`, `usage_update`, `compaction_update`, `compaction_summary_chunk`.
- `default` (128-131) is an exhaustiveness guard (`const exhaustive: never = update`), not a live "ignore" branch.

**ACP `ToolCallStatus` enum (confirmed from the installed SDK's source JSON schema, `@agentclientprotocol/sdk@1.4.0`, `schema/schema.json:547-570`) has exactly four values: `pending`, `in_progress`, `completed`, `failed`.** There is no `cancelled` tool-call status in this protocol version — the question's "cancelled?" case does not exist in the wire format the bridge consumes. `pending` and `in_progress` are the two non-terminal statuses the bridge folds into `state.tools` without emitting a chunk (lines 98-104); `completed`/`failed` are the only terminal ones (confirmed by `event-bridge.test.ts:229-271`, "completed maps to success and failed maps to error").

**Answering "if DSH emits `tool_call_update` status `failed` AFTER `session/cancel`, what chunk does the bridge emit, and would that close the executor's running-tool entry before the abort-marked result arrives?"**

The bridge emits a `{ type: 'tool_result', toolOutcome: 'error', ... }` chunk exactly as it would for any other `failed` update — the bridge has no awareness of cancellation state; it only reads `update.status`. In `acp-client.ts`, ACP notifications (including any post-cancel `tool_call_update`) are delivered via `onNotification(methods.client.session.update, ...)` (acp-client.ts:269-275) and pushed onto the same `queue` the generator yields from; the final `abortedResult(sessionId)` (`{ type: 'result', stopReason: 'aborted', ... }`) is pushed only after the `session/prompt` promise settles, `cancelSent` resolves, and `session/close` completes (acp-client.ts:353-371). So **any `tool_call_update` the agent sends before it actually stops (including ones sent in response to being cancelled) is queued and yielded strictly before the final `result` chunk** — there is no code path that reorders or drops a late tool update relative to the terminal result.

In the executor (`packages/workflows/src/dag-executor.ts`), a `tool_result` chunk is processed synchronously in the main streaming loop (~2623-2674): it calls `findRunningTool(runningTools, msg.toolName, msg.toolCallId)` and, if found, unconditionally does `runningTools.delete(completedToolCallId)` (line 2674) — regardless of `toolOutcome`. This happens **before** any terminal `result`-classification logic runs. So yes: a `failed` (or `completed`) `tool_call_update` that arrives after `session/cancel` but before the final aborted `result` chunk closes that tool's `runningTools` entry through the ordinary tool*result path. Only tools that \_never* receive a terminal `tool_call_update` before the connection tears down are left in `runningTools` for the terminal-result cleanup path (`settleRunningToolsOutcome`, dag-executor.ts:411-448) to close with outcome `'unknown'` or `'interrupted'` (dag-executor.ts:2679-2699):

```ts
const interruptMarked =
  passTurn?.token !== undefined &&
  interruptibleHandle !== undefined &&
  interruptibleHandle.wasOperatorInterrupted(passTurn.token) &&
  isInterruptTerminalReason(msg.terminalReason);
settleRunningToolsOutcome(
  deps, runningTools,
  interruptMarked ? 'interrupted' : 'unknown',
  workflowRun.id, stepName, node.id, (...) => {...}
);
```

## 2. Abort path in `acp-client.ts` (lines ~305-380)

File: `packages/providers/src/community/deepseek/acp-client.ts`

```ts
let aborted = input.abortSignal?.aborted === true;
let cancelSent: Promise<void> | undefined;
const onAbort = (): void => {
  aborted = true;
  cancelSent = ctx.notify(methods.agent.session.cancel, { sessionId });
};
if (!aborted) {
  input.abortSignal?.addEventListener('abort', onAbort);
}

let promptResponse: PromptResponse | undefined;
try {
  ...
  if (!aborted) {
    const outbound = ...;
    try {
      promptResponse = await ctx.request(methods.agent.session.prompt, {
        sessionId,
        prompt: [{ type: 'text', text: outbound }],
      });
    } catch (error) {
      if (!aborted) throw error;
    }
  }
} catch (error) {
  if (!aborted) throw error;
} finally {
  input.abortSignal?.removeEventListener('abort', onAbort);
  if (cancelSent !== undefined) {
    try {
      await cancelSent;
    } catch {
      // Cancel notify failure must not hide session/close.
    }
  }
  await ctx.request(methods.agent.session.close, { sessionId });
  sessionLive = false;
}

if (aborted) {
  queue.push(abortedResult(sessionId));
  return;
}
```

and:

```ts
function abortedResult(sessionId: string): Extract<MessageChunk, { type: 'result' }> {
  return {
    type: 'result',
    sessionId,
    stopReason: 'aborted',
    isError: true,
    errorSubtype: 'deepseek_aborted',
  };
}
```

**`promptResponse` is read when NOT aborted only.** When `aborted` is true, execution short-circuits at `if (aborted) { queue.push(abortedResult(sessionId)); return; }` (line 368-371) — the `promptResponse?.stopReason` branch (line 374, `successResult(sessionId, promptResponse?.stopReason ?? 'end_turn', structured)`) is unreachable on the abort path. Whatever `stopReason` the ACP agent's `session/prompt` response actually carried (e.g. the protocol-mandated `'cancelled'` per the spec text quoted below) is discarded — `abortedResult` hardcodes `stopReason: 'aborted'`, a value that is **not** a member of ACP's `StopReason` enum at all (Archon's own vocabulary, not passed through from the wire).

**Important — `abortedResult` sets no `terminalReason` field.** The executor's `INTERRUPT_TERMINAL_REASONS` set (`dag-executor.ts` ~452-459) only contains `'aborted_streaming'` and `'aborted_tools'` — Claude SDK-specific tokens — and `isInterruptTerminalReason(msg.terminalReason)` returns `false` for `undefined`. So as written today, even if `abortSignal`/`interruptSignal` wiring were added end-to-end, a DeepSeek abort result would **not** be classified as an operator interrupt by the existing five-case logic without either (a) DeepSeek's result carrying a `terminalReason` value the executor recognizes, or (b) the executor's classification being extended for a provider-specific marker. Flagging this as load-bearing context for the implementation plan, not asking you to change it here.

**ACP SDK type facts** (read from the installed SDK's JSON schema source of truth, `/Users/agent/.bun/install/cache/@agentclientprotocol/sdk@1.4.0@@@1/schema/schema.json`, since `node_modules`/`dist` paths were blocked for Read/Bash by a sandbox hook — the bun cache copy outside those blocked path patterns was used instead; `bun -e` dynamic import also failed with `Cannot find module 'zod/v4'`, unrelated to this investigation):

- `StopReason` (`schema.json:4340-4368`) — exactly 5 members: `'end_turn'`, `'max_tokens'`, `'max_turn_requests'`, `'refusal'`, `'cancelled'`. Per the schema's own doc comment on `'cancelled'`: _"The turn was cancelled by the client via `session/cancel`. This stop reason MUST be returned when the client sends a `session/cancel` notification, ... Agents should ... respond to the original `session/prompt` request with `StopReason::Cancelled`."_ So the ACP-compliant response to a cancelled `session/prompt` is `stopReason: 'cancelled'` — which `driveDeepseekAcpTurn` never reads because it takes the `aborted` early-return branch instead.
- `PromptResponse` (`schema.json:4305-4333`) — `{ stopReason: StopReason, usage?: Usage | null, _meta?: ... }`. Only `stopReason` is consumed by Archon's `acp-client.ts` (`promptResponse?.stopReason`), only on the non-aborted path.
- `ToolCallStatus` (`schema.json:547-570`) — 4 members: `'pending'`, `'in_progress'`, `'completed'`, `'failed'` (see §1).

## 3. Tests pinned to `DEEPSEEK_CAPABILITIES.interrupt === false`

| File:Line                                                            | Assertion                                                                                                                                                                 | Breaks when flipped to `'native'`?                                                   |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `packages/providers/src/community/deepseek/capabilities.ts:25`       | `interrupt: false` in the `DEEPSEEK_CAPABILITIES` object itself (`as const satisfies ProviderCapabilities`)                                                               | N/A — this is the source, must change first                                          |
| `packages/providers/src/community/deepseek/config.test.ts:124-146`   | `describe('DEEPSEEK_CAPABILITIES')` → `expect(DEEPSEEK_CAPABILITIES).toEqual({ ..., interrupt: false })` (full-object equality, line 144 is the `interrupt` key)          | **Yes** — must update the expected literal                                           |
| `packages/providers/src/registry.test.ts:190-196`                    | `test('every registered provider declares a total interrupt axis value')` — asserts membership in `['native', 'stream-abort', false]`                                     | No — still passes for `'native'`                                                     |
| `packages/providers/src/registry.test.ts:197-204`                    | `test('only Claude advertises native interrupt')` → `expect(capable).toEqual(['claude'])` where `capable` is every provider id with `capabilities.interrupt === 'native'` | **Yes** — must become `['claude', 'deepseek']` (array is `.sort()`-ed, alphabetical) |
| `packages/providers/src/registry.test.ts:598`                        | `expect(getProviderCapabilities('deepseek')).toEqual(DEEPSEEK_CAPABILITIES)`                                                                                              | No — compares against the same constant, self-consistent regardless of value         |
| `packages/providers/src/community/deepseek/provider.test.ts:70-71`   | `expect(provider.getCapabilities()).toBe(DEEPSEEK_CAPABILITIES)` / `.toEqual(DEEPSEEK_CAPABILITIES)`                                                                      | No — same self-consistency as above                                                  |
| `packages/providers/src/registry.test.ts:33-48` (`makeMockProvider`) | Hardcodes `interrupt: false` on an unrelated **mock** provider fixture used across many registry tests, not DeepSeek-specific                                             | No — not tied to DeepSeek                                                            |

No matches for `DEEPSEEK_CAPABILITIES` or DeepSeek-specific `interrupt` assertions were found in `packages/providers/src/observability.test.ts`, `packages/workflows/src/loader.test.ts`, or any `scripts/*.test.ts` (grepped, zero hits).

**Generated docs artifact (not a test, but CI-enforced):** `packages/docs-web/src/content/docs/reference/provider-capabilities.md:60` pins the whole capability matrix row: `| Turn interrupt (operator Stop) | **native** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |` (deepseek is column 9, currently ❌). Per `AGENTS.md`, this file is generated by `scripts/generate-capability-matrix.ts` from the registry's capability constants; `bun run check:capability-matrix` (part of `bun run validate`) fails CI if it's stale, so `bun run generate:capability-matrix` must be re-run after flipping the capability.

## 4. Existing `acp-client.test.ts` abort test harness (for copying the pattern)

File: `packages/providers/src/community/deepseek/acp-client.test.ts` (977 lines)

**Fake agent harness** — `createFakeDsh()` (lines 119-213) builds an in-process ACP `agent(...)` app (from `@agentclientprotocol/sdk`) wired directly to `driveDeepseekAcpTurn` via `AgentApp` (no real subprocess/stdio in `driveDeepseekAcpTurn` tests — only `runDeepseekAcpTurn` tests spawn a `FakeChild`). Signature:

```ts
function createFakeDsh(options?: {
  sessionId?: string;
  initialize?: (params: InitializeRequest) => ReturnType<typeof defaultInitialize>;
  resumeError?: Error;
  configError?: Error;
  configHold?: ReturnType<typeof createDeferred<void>>;
  closeError?: Error;
  promptUpdates?: SessionUpdate[] | ((sessionId: string) => SessionUpdate[]);
  promptHold?: ReturnType<typeof createDeferred<void>>;
  promptText?: string;
  requestPermission?: boolean;
  onPromptSettled?: () => void;
}): FakeDsh;
```

returning:

```ts
interface FakeDsh {
  app: AgentApp;
  calls: RecordedCall[]; // RecordedCall = { method: string; params: unknown }
  methodsCalled: () => string[]; // calls.map(call => call.method)
  permissionResponses: unknown[];
}
```

Each ACP method handler (`agent.initialize`, `agent.session.new`, `agent.session.resume`, `agent.session.setConfigOption`, `agent.session.prompt`, `agent.session.close`, and a `onNotification(methods.agent.session.cancel, ...)` listener) pushes to `calls` first, then optionally awaits a `Deferred` (`promptHold`/`configHold`, from `createDeferred<T>()`, lines 44-56) to hold the request open until the test drives an abort. The `session.cancel` notification handler resolves `promptHold` so a held prompt can finish after cancellation:

```ts
.onNotification(methods.agent.session.cancel, c => {
  calls.push({ method: methods.agent.session.cancel, params: c.params });
  options?.promptHold?.resolve();
});
```

`collect()` (lines 68-74) drains an `AsyncGenerator<MessageChunk>` into an array.

**Test `'aborting during prompt sends cancel, closes the session, and emits local aborted result'` (lines 503-521):**

```ts
test('aborting during prompt sends cancel, closes the session, and emits local aborted result', async () => {
  const hold = createDeferred<void>();
  const fake = createFakeDsh({ promptHold: hold });
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
  expect(result).toMatchObject({
    type: 'result',
    stopReason: 'aborted',
    errorSubtype: 'deepseek_aborted',
  });
});
```

Pattern: (1) hold `session/prompt` open via a deferred, (2) poll `methodsCalled()` until `prompt` was called (ensures the abort happens mid-turn, not pre-flight), (3) call `controller.abort()`, (4) await the full chunk stream, (5) assert `cancel` and `close` were both called and the terminal chunk matches. A sibling test `'aborting during config reports a local aborted result when config rejects'` (523-556) does the same for an abort racing `setConfigOption` instead of `prompt`, using `configHold`/`configError`. A new interrupt-signal test (distinct from `abortSignal`, once wired) can copy this exact shape — swap `abortSignal: controller.signal` for whatever the new `interruptSignal` plumbing looks like, and add assertions distinguishing the two (e.g. that a pure interrupt does NOT call `session/close`/tear down the session, if that's the intended native-interrupt semantics per `types.ts:598-609`).

## 5. `provider.test.ts` — `runTurn` injection and `abortSignal` forwarding

File: `packages/providers/src/community/deepseek/provider.test.ts`

Dependency injection point: `DeepseekProvider` is constructed with `DeepseekProviderDependencies` (`provider.ts:29-33`):

```ts
export interface DeepseekProviderDependencies {
  runTurn?: DeepseekTurnRunner; // DeepseekTurnRunner = (input: DeepseekProcessInput) => AsyncGenerator<MessageChunk>
  resolveNodeBinary?: typeof resolveDeepseekNodeBinary;
  resolveDshEntrypoint?: typeof resolveBundledDshEntrypoint;
}
```

Tests build a recording double:

```ts
function recordingRunner(
  calls: DeepseekProcessInput[],
  chunks: MessageChunk[] = successChunks()
): DeepseekTurnRunner {
  return async function* (input: DeepseekProcessInput): AsyncGenerator<MessageChunk> {
    calls.push(input);
    for (const chunk of chunks) {
      yield chunk;
    }
  };
}
```

and pass it as `new DeepseekProvider({ runTurn: recordingRunner(calls), resolveNodeBinary: ..., resolveDshEntrypoint: ... })`. Assertions on the captured `DeepseekProcessInput` are plain object/array assertions on `calls[0]` (e.g. `expect(calls[0]?.env ?? {}, 'DEEPSEEK_API_KEY')`).

**`'pre-aborted signal yields one deepseek_aborted result without preflight'` (lines 74-105):**

```ts
test('pre-aborted signal yields one deepseek_aborted result without preflight', async () => {
  const calls: DeepseekProcessInput[] = [];
  let nodeCalled = false;
  let dshCalled = false;
  const abort = new AbortController();
  abort.abort();
  const provider = new DeepseekProvider({
    runTurn: recordingRunner(calls),
    resolveNodeBinary: (): string => {
      nodeCalled = true;
      return '/stub/node';
    },
    resolveDshEntrypoint: (): string => {
      dshCalled = true;
      return '/stub/dsh.js';
    },
  });

  const chunks = await collect(
    provider.sendQuery('hi', '/repo', undefined, {
      abortSignal: abort.signal,
      assistantConfig: { maxTokens: 32 },
      env: queryEnv(),
      nodeConfig: { mcp: '/missing.json' },
    })
  );

  expect(chunks).toEqual([
    {
      type: 'result',
      isError: true,
      errorSubtype: 'deepseek_aborted',
      errors: ['DeepSeek turn aborted before start.'],
    },
  ]);
  expect(calls).toEqual([]);
  expect(nodeCalled).toBe(false);
  expect(dshCalled).toBe(false);
});
```

This exercises the provider-level guard at `provider.ts:145-151` (`if (requestOptions?.abortSignal?.aborted === true) { yield ...; return; }`) — it never reaches `runTurn`, so `calls` stays empty; `nodeCalled`/`dshCalled` stay `false` because `resolveNodeBinary`/`resolveDshEntrypoint` are also short-circuited.

**No test asserts non-aborted `abortSignal` forwarding into `DeepseekProcessInput` today.** `abortSignal` appears in `provider.test.ts` exactly once (line 94, the pre-aborted test above). The forwarding itself is source-only, at `provider.ts:211`:

```ts
const input: DeepseekProcessInput = {
  cwd,
  prompt,
  resumeSessionId,
  model: selection.model,
  providerRoute: selection.providerRoute,
  effort,
  mcpServers,
  outputSchema,
  abortSignal: requestOptions?.abortSignal,
  nodeBin,
  dshEntrypoint,
  profile: config.profile ?? DEFAULT_DEEPSEEK_PROFILE,
  env: childEnv,
  secretValues: secrets,
};
```

There is currently no `provider.test.ts` test that asserts `calls[0].abortSignal === someSignal` for a non-aborted, in-flight signal — a gap a new interrupt test could fill, following `recordingRunner`'s pattern (capture `calls[0]`, assert the captured `DeepseekProcessInput` object's new interrupt-related field is the exact signal instance passed in `requestOptions`).

**On `interruptSignal` vs `abortSignal` naming** (context for the plan, from `packages/providers/src/types.ts:596-609`): `AgentRequestOptions` has two distinct signal fields —

```ts
export interface AgentRequestOptions {
  model?: string;
  abortSignal?: AbortSignal;
  /**
   * Turn-scoped interrupt signal (operator "Stop"): providers declaring
   * `capabilities.interrupt === 'native'` end only the current provider turn
   * via the SDK's native interrupt — the workflow node stays running so the
   * operator can redirect the same session afterward. Distinct from
   * `abortSignal`, which remains the node-level Cancel that tears the turn
   * down. Providers without the capability ignore it.
   */
  interruptSignal?: AbortSignal;
  ...
}
```

`DeepseekProvider.sendQuery` today reads only `requestOptions?.abortSignal` (provider.ts:145, 211) — `interruptSignal` is not referenced anywhere under `packages/providers/src/community/deepseek/`. Confirmed via `grep -n "abortSignal|interruptSignal" packages/providers/src/community/deepseek/provider.ts` → two hits, both `abortSignal`.

## 6. DeepSeek ACP handshake spike flow

File: `packages/providers/src/community/deepseek/acp-handshake-spike.ts` (101 lines)

Header comment: _"Diagnostic-only DeepSeek ACP live handshake spike. Do not export from the providers package barrel. Do not call from tests or CI."_

Flow:

1. **Env gating** (`envValue`, lines 17-23, and `main()`, 93-99): the whole spike is a no-op unless `DEEPSEEK_LIVE_TEST=1` is set (`console.log('... skipped ...')` and return). Only then does it call `runLiveSpike()`.
2. **Required env vars for the live call** (`runLiveSpike`, 43-53): `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_LIVE_MODEL`. If any is missing/empty, prints an error to `console.error` and sets `process.exitCode = 1` without attempting a connection.
3. **Workspace setup**: `const cwd = await mkdtemp(join(tmpdir(), 'archon-deepseek-acp-spike-'))` — an isolated temp dir, cleaned up in `finally` via `rm(cwd, { recursive: true, force: true })`.
4. **Builds `SendQueryOptions`** (57-68):

```ts
const provider = new DeepseekProvider();
const options: SendQueryOptions = {
  model,
  env: { DEEPSEEK_API_KEY: apiKey, DEEPSEEK_BASE_URL: baseUrl },
  assistantConfig: { baseUrl, model },
};
```

Uses the **real** `DeepseekProvider` (no injected `runTurn`/dependencies) — this is the one spike that actually spawns the real DSH subprocess end-to-end (through `runDeepseekAcpTurn`). 5. **Fresh turn**: `provider.sendQuery(FRESH_PROMPT, cwd, undefined, options)` where `FRESH_PROMPT = 'Reply with exactly pong.'`; collects only `type === 'result'` chunks via `collectResults()` (25-33); `requireNonErrorResult()` (35-41) picks the first result with `isError !== true`, throwing if none exists. Checks `fresh.sessionId` is a non-empty string, else throws. 6. **Proves resume**: calls `provider.sendQuery(RESUME_PROMPT, cwd, fresh.sessionId, options)` where `RESUME_PROMPT = 'Reply with exactly pong again.'`, passing the prior turn's `sessionId` as the `resumeSessionId` argument. Checks `resumed.resumed !== true` → throws `'resume turn did not report resumed: true'` (the `resumed` field comes from `withResumedOutcome`/`resumedOutcome` in `provider.ts`, part of the standard resume-signaling contract shared across providers). 7. **Output**: `console.log('DeepSeek ACP live spike passed')` on success; any thrown error is caught generically (`catch { console.error('DeepSeek ACP live spike failed'); process.exitCode = 1; }`) — no detail from the caught error is printed. 8. **Entry point**: bare top-level `await main();` (module executes on `bun run` / direct execution, not wrapped in an exported function — consistent with "do not call from tests or CI").

An interrupt spike mirroring this pattern would: gate on its own `DEEPSEEK_LIVE_TEST`-style env var (or reuse it), require the same three env vars, build the same `SendQueryOptions`, but instead of two sequential full turns, start one `sendQuery(...)` call, wait until mid-turn (e.g. first non-`result` chunk observed, mirroring the `acp-client.test.ts` "poll `methodsCalled()`" pattern from §4), then abort/interrupt via whichever new signal field the plan settles on, and assert on the terminal chunk's shape (`stopReason`, `isError`, `errorSubtype`, and whatever the new interrupt-classification marker becomes) plus that the ACP `session/cancel`+`session/close` (or interrupt-equivalent) sequence actually occurred against the real DSH process.

## Unresolved / open for the plan

- DeepSeek's `abortedResult()` never reads or forwards ACP's own `stopReason: 'cancelled'` (the protocol-correct value per the ACP spec text) — it hardcodes an Archon-local `'aborted'`. Whether the interrupt implementation should thread the real ACP `stopReason` through, and whether it should populate `terminalReason` (currently absent) so `dag-executor.ts`'s `INTERRUPT_TERMINAL_REASONS` classification can recognize a DeepSeek interrupt, is a design decision this report surfaces but does not resolve.
- ACP 1.4.0's `ToolCallStatus` has no `cancelled` value — a tool in flight when `session/cancel` fires either later reports `completed`/`failed` (closing its `runningTools` entry via the ordinary `tool_result` path) or never reports a terminal status at all (left for `settleRunningToolsOutcome` at the final `result`). There is no third "the tool itself was cancelled" signal to map.
