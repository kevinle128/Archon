# Scout report: DeepSeek Stop/interrupt gating (Story 2.7)

Read-only scouting. No files modified other than this report.

## Headline verdict

The hypothesis is **confirmed with one addition the task didn't name**: everything
gates on `getProviderCapabilities(provider).interrupt !== false`, and the
capability type is not a boolean — it's a 3-way axis
(`packages/providers/src/types.ts:847`):

```ts
interrupt: 'native' | 'stream-abort' | false;
```

`'stream-abort'` is **already defined and documented as reserved for exactly this
case** ("the provider can only end the turn by aborting its stream (reserved; no
provider declares it yet)" — `packages/providers/src/types.ts:842-845`). DeepSeek's
`ACP`/stream-based abort marker is a `stream-abort` provider, not `'native'`
(Claude's `Query.interrupt()` keeps the process alive; DeepSeek's abort tears down
and restarts the stream). Nothing downstream (registry, executor, routes, docks)
branches on which of `'native'`/`'stream-abort'` it is — every gate is `!== false`
— so setting `DEEPSEEK_CAPABILITIES.interrupt = 'stream-abort'` is sufficient on
that axis.

The executor's classification, however, keys off `msg.terminalReason` via a
hardcoded `Set` of two Claude-specific string literals — confirmed below — so the
task's claim that `INTERRUPT_TERMINAL_REASONS` needs a DeepSeek marker is correct
and is the one non-capability code change required. A second, previously-unstated
requirement was found: **`dag-executor.test.ts` does not currently register the
DeepSeek provider** in its bootstrap block, so `getProviderCapabilities('deepseek')`
would throw `UnknownProviderError` in that test file today.

---

## 1. Provider-id gating audit

Greps run:

```
grep -rn "provider === 'claude'\|getType() ===\|providerId ===\|=== 'claude'\|'claude' ===" packages/workflows/src packages/server/src packages/web/src packages/core/src
grep -rn "\.interrupt\b\|interrupt:" packages/workflows/src/*.ts packages/providers/src/**/*.ts
grep -rln "steeringSubState" packages/workflows/src packages/server/src packages/web/src packages/core/src
grep -n "provider ===\|getType()\|'claude'" packages/server/src/routes/api.ts
```

**Result: zero hits of provider-id branching in steering/interrupt/Stop/send_now/steeringSubState logic.** The `'claude'` string hits that do exist are all unrelated to steering:

- `packages/workflows/src/validator.ts:648,674,702,706` — Claude-only YAML fields (`hooks`, `agents`, `settingSources`) validated at load time, unrelated to interrupt.
- `packages/web/src/experiments/console/lib/model-options.ts:99`, `packages/web/src/routes/SettingsPage.tsx:496`, `packages/core/src/orchestrator/orchestrator-agent.ts:2087` — model-picker / credential UI, unrelated to steering.
- `packages/workflows/src/dag-executor.test.ts:17121`, `packages/workflows/src/loader.test.ts:6789` — unrelated test assertions (provider field presence in loader tests).

Every real steering/interrupt gate is exactly the capability check:

```
packages/workflows/src/dag-executor.ts:3196:  const providerInterruptible = getProviderCapabilities(provider).interrupt !== false;
packages/workflows/src/dag-executor.ts:5964:  const providerInterruptible = getProviderCapabilities(workflowProvider).interrupt !== false;
```

`getProviderCapabilities(id: string)` (`packages/providers/src/registry.ts:84-86`) is a **real registry lookup by provider id string** — `getRegistration(id).capabilities` — not the mocked `aiClient.getCapabilities()`. This matters for the test-harness section below.

## 2. Executor classification sites

**`INTERRUPT_TERMINAL_REASONS` / `isInterruptTerminalReason`** (`packages/workflows/src/dag-executor.ts:452-463`):

```ts
/**
 * The ONLY provider terminal reasons that classify a result as an operator
 * interrupt (#183): the Claude SDK's two abort markers. No prefix or prose
 * matching — a result without an abort marker is a natural end even when a
 * Stop raced it (five-case classification, case 1).
 */
const INTERRUPT_TERMINAL_REASONS: ReadonlySet<string> = new Set([
  'aborted_streaming',
  'aborted_tools',
]);

function isInterruptTerminalReason(reason: string | undefined): boolean {
  return reason !== undefined && INTERRUPT_TERMINAL_REASONS.has(reason);
}
```

This set is **explicitly Claude-only per its own docstring** ("the Claude SDK's two abort markers"). It is populated from `msg.terminalReason`, a provider-neutral field on the shared result-message shape (`packages/providers/src/types.ts:356`, doc comment at 350-355: "Provider-native terminal reason forwarded verbatim from the SDK result (Claude `terminal_reason`...)"). Claude sets it at `packages/providers/src/claude/provider.ts:1367,1431` from `resultMsg.terminal_reason`.

**Direct-path `interruptMarked`** (`packages/workflows/src/dag-executor.ts:2683-2692`, not 2683-2695 but adjacent):

```ts
const interruptMarked =
  passTurn?.token !== undefined &&
  interruptibleHandle !== undefined &&
  interruptibleHandle.wasOperatorInterrupted(passTurn.token) &&
  isInterruptTerminalReason(msg.terminalReason);
```

**Classification of the hypothetical DeepSeek result** `{ type:'result', sessionId, stopReason:'aborted', isError:true, errorSubtype:'deepseek_aborted', terminalReason: <new-value> }`:

- If `<new-value>` (e.g. `'stream_aborted'` or similar) is **added to `INTERRUPT_TERMINAL_REASONS`**, and the operator-interrupt flag is set (`wasOperatorInterrupted(token)` true, which requires `interruptibleHandle !== undefined` — itself gated only on `providerInterruptible` at line 3196), then `interruptMarked` is `true` exactly as for Claude. No other field in the hypothetical shape (`isError`, `errorSubtype`, `stopReason`) participates in this boolean — only `terminalReason` does.
- If `<new-value>` is **not** added to the set, `interruptMarked` is `false` even with the operator flag set, and the message falls through to the generic error-result guard.

**The `isError` guard interaction is the load-bearing risk** (`packages/workflows/src/dag-executor.ts:2764` and the mirrored loop-path guard at `6502`/`6526`):

```ts
2771:          if (interruptMarked) {
                // Interrupted end (#183): all captures above already folded
                // session/usage/cost/model; now skip the error-result guard, the
                // background-task wait, and any further stream consumption — the
                // executor classifies and idles the turn.
                if (passTurn !== undefined) {
                  passTurn.interrupted = true;
                }
                break;
              }
              ...
2764:          if (msg.isError && msg.errorSubtype !== 'success') {
                ...
                throw new Error(`Node '${node.id}' failed: SDK returned ${subtype}${errorsDetail}`);
              }
```

(Order in source: the `interruptMarked` block at 2771 appears textually *before* the generic isError-throw at 2800 in file order within the same `if/else` chain — the `break` at the interrupt block exits the loop before the isError check is ever reached for an interrupted result.) **If `terminalReason` is missing from `INTERRUPT_TERMINAL_REASONS`, DeepSeek's `isError:true` abort marker will hit the generic "Fail loudly on any other SDK error result" guard and the node will be recorded as `node_failed` instead of `interrupted`.** This is exactly the risk the task's premise called out, confirmed by reading the code path — not merely inferred.

**Nothing else in the direct path behaves differently for DeepSeek vs Claude**, because every other field consumed from the `result` message (`sessionId`, `resumed`, `tokens`, `cost`, `stopReason`, `numTurns`, `resolvedModel`, `structuredOutput`, `usageBreakdown`) is read generically off `msg.*` with no provider-id branch (`packages/workflows/src/dag-executor.ts:2705-2764`). The empty-output guard (`dag-executor.ts:3574`, `nodeOutputText.trim() === '' && structuredOutput === undefined`) sits *after* the turn-interrupted early-return/continue block (3477-3510), so an interrupted turn never reaches it regardless of provider. `passTerminalError`/`passErrorSubtype` capture (`dag-executor.ts:2758-2763`) also runs before the `interruptMarked` branch and is provider-neutral.

**Redirect resume id — confirmed by direct read, direct path** (`packages/workflows/src/dag-executor.ts:3477-3510`, exact line `3488`):

```ts
3477:      if (turnInterrupted && interruptibleHandle !== undefined && lastPassToken !== undefined) {
             // The redirect resumes the session that was interrupted: this turn's
             // own emitted id when a result carried one, else the id the turn was
             // resuming (a throw can interrupt before any result arrives). A
             // fresh first turn with neither fails fast rather than dropping the
             // queued guidance into an unresumable session.
3488:        const interruptedSessionId = newSessionId ?? turnResumeId;
             if (interruptedSessionId === undefined) {
               steeringHandle?.close();
               throw new Error(
                 `Node '${node.id}' was interrupted but the provider turn returned no session id to resume — failing instead of losing resumability.`
               );
             }
             ...
             const idleWaiter = interruptibleHandle.enterIdle(lastPassToken);
             const wake = await raceIdleWake(deps, workflowRun.id, idleWaiter);
             if (wake.kind === 'send_now') {
               turnPrompt = wake.messages.map(item => item.message).join('\n\n');
               turnResumeId = interruptedSessionId;   // <-- becomes resumeSessionId on the next sendQuery call
               turnIsGuidance = true;
               continue turns;
             }
```

**Yes — the redirect turn's `resumeSessionId` (`turnResumeId`, threaded into the next `sendQuery(...)` call) is set from `newSessionId ?? turnResumeId`** — i.e. the session id captured off the abort-marked result (`msg.sessionId` → `newSessionId`), falling back to the id the interrupted turn was itself resuming if the abort happened before any result arrived. This is provider-neutral: it depends only on `msg.sessionId` being populated on the abort-marked result, which DeepSeek's ACP bridge must do (same as Claude's `terminalReason`).

**Loop-path mirror** (`packages/workflows/src/dag-executor.ts:6406-6420` classification, `~7060-7100` idle entry):

```ts
6406:              const interruptMarked =
                     turnToken !== undefined &&
                     interruptibleHandle !== undefined &&
                     interruptibleHandle.wasOperatorInterrupted(turnToken) &&
                     isInterruptTerminalReason(msg.terminalReason);
```

```ts
7060:      if (turnInterrupted && interruptibleHandle !== undefined && turnToken !== undefined) {
             // The redirect resumes the loop's conversation thread: attempt 0's
             // session id when this turn emitted one, else the inherited thread a
             // re-ask pass was anchored to...
             const interruptedSessionId = settledTurnSessionId ?? currentSessionId;
             ...
             turnResumeId = interruptedSessionId;
             turnIsGuidance = true;
             continue turns;
```

Same `isInterruptTerminalReason`/capability-gated logic, same redirect-resume-id pattern (`settledTurnSessionId ?? currentSessionId` instead of `newSessionId ?? turnResumeId` — the loop path threads attempt-0's session per #2563 re-ask semantics, but the *mechanism* is identical). No provider-id branch anywhere in this path either.

**Throw-path (`isAbortLikeStreamError`) direct path** at `packages/workflows/src/dag-executor.ts:2683-2695` catch block, and loop-path mirror at `6785-6800` — quoted above in the tool-call excerpts — both gate on `wasOperatorInterrupted(token)` + `controller?.signal.aborted` + `isAbortLikeStreamError(err)`, none of which are provider-id-specific. `isAbortLikeStreamError` checks `err.name === 'AbortError'` and two more shape checks (not fully re-quoted here; defined at `dag-executor.ts:2691-2695+`) — again shape-based, not provider-id-based.

## 3. Executor test harness

### Definitions (top of file, not inside the #183 describe block)

**`createMockStore`** — `packages/workflows/src/dag-executor.test.ts:139` (full `IWorkflowStore` mock factory; ~160 lines).

**`mockClaudeCapabilities`** — `dag-executor.test.ts:301-315`:

```ts
/** All-true capabilities for Claude mock */
const mockClaudeCapabilities = () => ({
  sessionResume: true,
  mcp: true,
  hooks: true,
  skills: true,
  agents: true,
  toolRestrictions: true,
  structuredOutput: 'enforced' as const,
  envInjection: true,
  costControl: true,
  effortControl: true,
  thinkingControl: true,
  fallbackModel: true,
  sandbox: true,
  settingSources: true,
});
```

Note: this literal **omits** `nativeTools`/`containerExec`/`askHuman`/`interrupt` (a subset cast, presumably satisfying a `Partial`/structurally-compatible mock type or `as any`) — it is *not* what feeds `getProviderCapabilities('claude')`; that call reads the **real registered `CLAUDE_CAPABILITIES`** from `packages/providers/src/registry.ts`, independent of this mock object. `mockClaudeCapabilities` only feeds the mocked `aiClient.getCapabilities()` used elsewhere in the executor (e.g. `sessionResume` gating the steering-handle registration itself at `dag-executor.ts:3197`).

**`mockSendQueryDag`** — `dag-executor.test.ts:336-339`:

```ts
const mockSendQueryDag = mock(function* () {
  yield { type: 'assistant', content: 'DAG AI response' };
  yield { type: 'result', sessionId: 'dag-session-id' };
});
```

**`mockGetAgentProviderDag`** — `dag-executor.test.ts:341-345`:

```ts
const mockGetAgentProviderDag = mock(() => ({
  sendQuery: mockSendQueryDag,
  getType: () => 'claude',
  getCapabilities: mockClaudeCapabilities,
}));
```

**Provider registry bootstrap (file top, before all describes)** — `dag-executor.test.ts:71-90`:

```ts
import {
  registerBuiltinProviders,
  registerOmpProvider,
  registerOpencodeProvider,
  registerPiProvider,
  registerQoderCliProvider,
  registerDevinProvider,
  DEVIN_CAPABILITIES,
  clearRegistry,
} from '@archon/providers';
clearRegistry();
registerBuiltinProviders();
registerOmpProvider();
registerOpencodeProvider();
registerPiProvider();
registerDevinProvider();
registerQoderCliProvider();
```

**`registerDeepseekProvider()` is NOT called anywhere in this file** (confirmed by grep — the only two hits for `registerDeepseekProvider` repo-wide are in `packages/workflows/src/loader.test.ts:35,651` and `packages/providers/src/registry.ts:27,203` inside `registerCommunityProviders()`, which `dag-executor.test.ts` does not call). `registerBuiltinProviders()` only registers `claude`/`codex`/`grok` (`packages/providers/src/registry.ts:118-172`); DeepSeek is registered exclusively via `registerCommunityProviders()` or an explicit `registerDeepseekProvider()` call (`packages/providers/src/registry.ts:203` inside `registerCommunityProviders`). **A Story 2.7 test that calls `getProviderCapabilities('deepseek')` (directly or via `invokeDag(..., { provider: 'deepseek' })`) will throw `UnknownProviderError` unless the test file's bootstrap block is extended with `import { registerDeepseekProvider } from '@archon/providers'; registerDeepseekProvider();`.**

**`invokeDag`** — defined inside the `#183` describe block at `dag-executor.test.ts:27176-27207`:

```ts
async function invokeDag(
  store: IWorkflowStore,
  nodes: DagNode[],
  opts?: { runId?: string; assistant?: 'claude' | 'pi' }
): Promise<IWorkflowPlatform> {
  const assistant = opts?.assistant ?? 'claude';
  const config =
    assistant === 'pi'
      ? {
          ...minimalConfig,
          assistant: 'pi' as const,
          assistants: { ...minimalConfig.assistants, pi: {} },
        }
      : minimalConfig;
  const platform = createMockPlatform();
  await executeDagWorkflow(
    createMockDeps(store),
    platform,
    'conv-dag',
    testDir,
    { name: 'interrupt-test', nodes },
    makeWorkflowRun(opts?.runId ?? RUN_ID),
    assistant,
    undefined,
    join(testDir, 'artifacts'),
    join(testDir, 'state'),
    join(testDir, 'logs'),
    'main',
    'docs/',
    config
  );
  return platform;
}
```

Its `opts.assistant` union type is **hardcoded to `'claude' | 'pi'`** — a DeepSeek test would need either to widen this union (e.g. `'claude' | 'pi' | 'deepseek'`) or pass a per-node `provider: 'deepseek'` on the `DagNode` (the queue-only-provider test at `27667` uses the per-node-`provider` approach: `{ id: 'review', prompt: 'do work', provider: 'pi' }` combined with `opts: { assistant: 'pi' }`). The workflow-level `assistant` param feeds `config`/`minimalConfig.assistants` shape checks unrelated to interrupt capability resolution; `getProviderCapabilities(provider)` reads the **node's/workflow's resolved provider id string**, so a DeepSeek interrupt test likely needs `assistants: { ...minimalConfig.assistants, deepseek: {} }` mirroring the `pi` branch, plus registry registration (above).

**`beforeEach`/`afterEach` re-wire the mock to `getType: () => 'claude'`** (`dag-executor.test.ts:27079-27084`, `27089-27094`) — every test in this describe block that doesn't override `mockGetAgentProviderDag.mockImplementation` inherits `'claude'`.

### Full test bodies

**`'interrupt parks an abort-marked result in idle and Send now drains old + new receipts in order on the same session'`** (`dag-executor.test.ts:27212-27267`):

```ts
it('interrupt parks an abort-marked result in idle and Send now drains old + new receipts in order on the same session', async () => {
  let calls = 0;
  let interruptOutcome: Promise<string> | undefined;
  const seenInterruptSignals: (AbortSignal | undefined)[] = [];
  mockSendQueryDag.mockImplementation(async function* (
    _prompt: string,
    _cwd: string,
    _resume?: string,
    options?: SendQueryOptions
  ) {
    calls++;
    seenInterruptSignals.push(options?.interruptSignal);
    if (calls === 1) {
      interruptOutcome = liveHandle(RUN_ID, 'review').interrupt() as Promise<string>;
      yield { type: 'assistant', content: 'partial output' };
      yield { type: 'result', sessionId: 'sess-1', terminalReason: 'aborted_streaming' };
      return;
    }
    yield { type: 'assistant', content: 'redirected output' };
    yield { type: 'result', sessionId: 'sess-2' };
  });
  const store = createMockStore();
  const run = invokeDag(store, [{ id: 'review', prompt: 'do work' }]);

  const idle = await awaitIdle(RUN_ID, 'review');
  expect(await interruptOutcome).toBe('idle-after-interrupt');
  const states = await transcriptStates(store, RUN_ID, 'review');
  expect(states.filter(s => s === 'interrupted').length).toBe(1);
  expect(states).not.toContain('failed');
  expect(storedEventTypes(store)).not.toContain('node_failed');

  enqueue(RUN_ID, 'review', 'm-old-1', 'old note one');
  enqueue(RUN_ID, 'review', 'm-old-2', 'old note two');
  expect(idle.snapshot().queued.length).toBe(2);
  sendNow(RUN_ID, 'review', 'm-new', 'new instruction');
  await run;

  expect(mockSendQueryDag.mock.calls.length).toBe(2);
  expect(sendQueryArg<string>(1, 0)).toBe('old note one\n\nold note two\n\nnew instruction');
  expect(sendQueryArg<string | undefined>(1, 2)).toBe('sess-1');
  expect(sendQueryArg<SendQueryOptions>(1, 3).forkSession).toBe(false);
  expect(seenInterruptSignals[0]).toBeDefined();
  expect(seenInterruptSignals[1]).toBeDefined();
  expect(seenInterruptSignals[0]).not.toBe(seenInterruptSignals[1]);
  expect(seenInterruptSignals[0]!.aborted).toBe(true);
  expect(seenInterruptSignals[1]!.aborted).toBe(false);
  expect(storedEventTypes(store)).toContain('node_completed');
  expect(storedEventTypes(store)).not.toContain('node_failed');
  expect(getSteeringRegistry().get(RUN_ID, 'review')).toBeUndefined();
});
```

This is the canonical shape a DeepSeek equivalent would clone — note `sendQueryArg<string | undefined>(1, 2)` asserts the resume-session-id positional arg (`'sess-1'`) on the redirect call, matching the `interruptedSessionId = newSessionId ?? turnResumeId` finding in §2.

**`'interrupt stays unavailable on a queue-only provider'`** (`dag-executor.test.ts:27667-27692`, quoted in full):

```ts
it('interrupt stays unavailable on a queue-only provider', async () => {
  let observed: { subState: unknown; interruptSignal: unknown; outcome?: string } | undefined;
  mockSendQueryDag.mockImplementation(async function* (
    _prompt: string,
    _cwd: string,
    _resume?: string,
    options?: SendQueryOptions
  ) {
    const handle = getSteeringRegistry().get(RUN_ID, 'review');
    observed = {
      subState: handle?.steeringSubState(),
      interruptSignal: options?.interruptSignal,
    };
    if (handle) {
      observed.outcome = await handle.interrupt();
    }
    yield { type: 'assistant', content: 'done' };
    yield { type: 'result', sessionId: 'sess-pi' };
  });
  const store = createMockStore();
  await invokeDag(store, [{ id: 'review', prompt: 'do work', provider: 'pi' }], {
    assistant: 'pi',
  });

  expect(observed).toBeDefined();
  expect(observed!.subState).toBeUndefined();
  expect(observed!.interruptSignal).toBeUndefined();
  expect(observed!.outcome).toBe('not_steerable_here');
  expect(storedEventTypes(store)).toContain('node_completed');
});
```

Uses `provider: 'pi'` (real registry: `interrupt: false`, `packages/providers/src/community/pi/capabilities.ts:37`) as the queue-only exemplar — not a mock-level override, the **real** capability drives it (per §1's `getProviderCapabilities` finding).

**`'interrupt in an AI loop idles inside the iteration and Send now resumes without consuming one'`** (`dag-executor.test.ts:27698-27738`, quoted in full):

```ts
it('interrupt in an AI loop idles inside the iteration and Send now resumes without consuming one', async () => {
  let calls = 0;
  mockSendQueryDag.mockImplementation(async function* () {
    calls++;
    if (calls === 1) {
      void liveHandle(RUN_ID, 'my-loop').interrupt();
      yield { type: 'assistant', content: 'iteration work' };
      yield { type: 'result', sessionId: 'loop-sess-1', terminalReason: 'aborted_streaming' };
      return;
    }
    yield { type: 'assistant', content: 'redirected. <promise>COMPLETE</promise>' };
    yield { type: 'result', sessionId: 'loop-sess-2' };
  });
  const store = createMockStore();
  const run = invokeDag(store, [
    {
      id: 'my-loop',
      loop: { prompt: 'Do a task.', until: 'COMPLETE', max_iterations: 5 },
    },
  ]);

  await awaitIdle(RUN_ID, 'my-loop');
  const states = await transcriptStates(store, RUN_ID, 'my-loop');
  expect(states).toContain('interrupted');
  sendNow(RUN_ID, 'my-loop', 'm-1', 'redirect the loop');
  await run;

  expect(mockSendQueryDag.mock.calls.length).toBe(2);
  expect(sendQueryArg<string>(1, 0)).toBe('redirect the loop');
  expect(sendQueryArg<string | undefined>(1, 2)).toBe('loop-sess-1');
  const iterationCompleted = (
    store.createWorkflowEvent as ReturnType<typeof mock>
  ).mock.calls.filter(
    call =>
      (call[0] as { event_type: string }).event_type === 'loop_iteration_completed' ||
      (call[0] as { event_type: string }).event_type === 'node_completed'
  );
  expect(iterationCompleted.length).toBeGreaterThan(0);
  expect(storedEventTypes(store)).toContain('node_completed');
  expect(storedEventTypes(store)).not.toContain('node_failed');
  expect(getSteeringRegistry().get(RUN_ID, 'my-loop')).toBeUndefined();
});
```

**Loop node fields used:** `{ id, loop: { prompt, until, max_iterations } }` — a plain AI loop declared via inline `until:` prose sentinel (the loop's own three completion tiers — see AGENTS.md's Natural-Language-Is-Not-A-Wire-Format note — this test uses the prose `until` tier, matched by `<promise>COMPLETE</promise>` stripped via `stripCompletionTags`).

**`'interrupt settles an outstanding tool interrupted and leaves a settled one untouched — one status row'`** (`dag-executor.test.ts:27502-27531`, quoted in full):

```ts
it('interrupt settles an outstanding tool interrupted and leaves a settled one untouched — one status row', async () => {
  let calls = 0;
  mockSendQueryDag.mockImplementation(async function* () {
    calls++;
    if (calls === 1) {
      void liveHandle(RUN_ID, 'review').interrupt();
      yield { type: 'tool', toolName: 'Read', toolCallId: 'tool-done', toolInput: {} };
      yield {
        type: 'tool_result',
        toolName: 'Read',
        toolCallId: 'tool-done',
        toolOutcome: 'success',
      };
      yield { type: 'tool', toolName: 'Bash', toolCallId: 'tool-open', toolInput: {} };
      yield { type: 'result', sessionId: 'sess-1', terminalReason: 'aborted_tools' };
      return;
    }
    yield { type: 'assistant', content: 'resumed' };
    yield { type: 'result', sessionId: 'sess-2' };
  });
  const store = createMockStore();
  const run = invokeDag(store, [{ id: 'review', prompt: 'do work' }]);

  await awaitIdle(RUN_ID, 'review');
  const outcomes = toolCompletedOutcomes(store);
  expect(outcomes.get('tool-done')).toEqual(['success']);
  expect(outcomes.get('tool-open')).toEqual(['interrupted']);
  sendNow(RUN_ID, 'review', 'm-1', 'carry on');
  await run;

  expect(storedEventTypes(store)).toContain('node_completed');
});
```

**Tool event chunk shapes used:** `{ type: 'tool', toolName, toolCallId, toolInput }` (open) and `{ type: 'tool_result', toolName, toolCallId, toolOutcome }` (settled). The still-open `tool-open` call is settled `'interrupted'` by `settleRunningToolsOutcome(..., interruptMarked ? 'interrupted' : 'unknown', ...)` when the terminal `result` chunk arrives with `terminalReason: 'aborted_tools'` (`§2`, direct-path `interruptMarked` block).

## 4. Existing provider-parametrized conformance test?

Greps run:

```
grep -rn "conformance\|describe.each\|for (const provider of" packages/workflows/src/*.test.ts packages/providers/src
```

**Only one hit, unrelated to steering**: `packages/workflows/src/model-validation.test.ts:575` — `for (const provider of ['claude', 'codex', 'pi', 'copilot'])`, inside model/tier validation tests, nothing to do with interrupt/steering.

**No shared, provider-parametrized "steering conformance" test exists anywhere in the tree.** The entire `#183` describe block in `dag-executor.test.ts` is Claude-mock-driven (with one `pi` exemplar for the queue-only case); there is no `describe.each(providers)` harness a Story 2.7 DeepSeek test could plug into. A DeepSeek interrupt test suite would be new sibling `it()`s (or a new describe block) inside `dag-executor.test.ts`, following the same hand-written pattern as the four tests quoted above, not an extension of a generic loop.

## 5. Docs surfaces

`packages/docs-web/src/content/docs/getting-started/ai-assistants.md` — grepped for `^#|Stop|Interrupt|Steer|Send now|send_now`: **zero mentions of Stop/interrupt/steering anywhere in this file, including under the `## Claude Code` section** (headings only: `## Claude Code`, `### Install Claude Code`, `### Binary path configuration`, `### Authentication Options`, `### Option 1/2/3`, `### Claude Configuration Options`, `### Set as Default`). Story 2.3 did not add a Claude-Stop sentence to this guide, so there is no existing Claude sentence for a DeepSeek equivalent to mirror in `ai-assistants.md` itself.

**DeepSeek section headings** (`ai-assistants.md:879-915`): `## DeepSeek Harness (Community Provider)` and one subheading `### See also`. Body content quoted in full above covers auth, config keys (`model`, `baseUrl`, `providerRoute`, `profile`, `permissionMode`, `effort`, `nodeBin`), model-ref splitting, `maxTokens` rejection, binary-build unavailability, and usage/cost reporting gaps — no interrupt/Stop content currently.

**Repo-wide grep for steering/interrupt doc mentions**:

```
grep -rln "steering\|Send now\|send_now\|interrupt" packages/docs-web/src/content/docs/
```

Hits:
- `packages/docs-web/src/content/docs/guides/approval-nodes.md:184` — "...for the full semantics, `signal_completes`, and the AI-approver steering pattern." (unrelated — approval-node steering, not turn-interrupt.)
- `packages/docs-web/src/content/docs/guides/hooks.md:199` — `### Inject steering instructions after every tool call` (unrelated — hook-based prompt injection, not operator Stop.)
- `packages/docs-web/src/content/docs/guides/loop-nodes.md:564` — "**AI approvers / relay steering.** An orchestrating agent can steer another run's gate:" (unrelated — cross-run approval steering.)
- `packages/docs-web/src/content/docs/guides/authoring-workflows.md:1916` — "A child left `running` or `pending` by an interrupted process is **not** auto-cancelled —" (unrelated — process-level interruption, not operator Stop.)
- **`packages/docs-web/src/content/docs/reference/provider-capabilities.md`** — this is the one directly relevant surface. It is **auto-generated** (`<!-- AUTO-GENERATED — DO NOT EDIT. Regenerate with: bun run generate:capability-matrix -->`, line 11) from each provider's `capabilities.ts`. Current row (`:60`):

```
| Turn interrupt (operator Stop) | **native** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
```

(columns: claude, codex, grok, opencode, pi, copilot, qodercli, omp, deepseek, devin — deepseek is the 9th column, currently ❌). The legend (`:78-83`) **already documents the `stream-abort` value** as a defined, generator-aware state: "`stream-abort` (the turn ends by aborting the provider's stream)" — confirming the doc generator already knows how to render a `stream-abort` capability value; flipping `DEEPSEEK_CAPABILITIES.interrupt` and running `bun run generate:capability-matrix` would be sufficient to update this table (per AGENTS.md's generated-file rule), no manual doc edit needed for the matrix itself. A DeepSeek subsection addition to `ai-assistants.md` mirroring a Claude "Stop" sentence would be new prose, not a mirror of existing prose (since none exists for Claude there).

## 6. Web dock gating

`packages/web/src/lib/steering-dock.ts:113-124`:

```ts
/**
 * Derived control anatomy: a missing projected sub-state is queue-only (not
 * detached); a defined projection or a local Stop press drives the rest.
 */
export function steeringAgentMode(input: {
  subState: SteeringSubState | null;
  interruptInFlight: boolean;
}): SteeringAgentMode {
  if (input.interruptInFlight) return 'interrupting';
  if (input.subState === 'generating') return 'generating';
  if (input.subState === 'idle-after-interrupt') return 'idle';
  return 'queue-only';
}
```

Consumed identically by both dock components:

`packages/web/src/components/workflows/ComposerDock.tsx:306,415`:
```ts
const agentMode = steeringAgentMode(dock);
...
const showStop = agentMode === 'generating' || agentMode === 'interrupting';
```

`packages/web/src/experiments/console/components/ConsoleComposerDock.tsx:312,421` — identical two lines.

**Confirmed: `showStop` depends only on `agentMode`, which depends only on `dock.subState` (sourced from `steeringSubState` / `SteeringSubState`) and the UI-local `interruptInFlight` flag. Neither `steeringAgentMode` nor either consuming component contains a provider-name check** (grepped `provider` across `steering-dock.ts` — zero matches; grepped both dock `.tsx` files — zero `provider ===`/`getType` matches). The docks are wired to render `Stop` for **any** provider whose node currently projects `subState: 'generating'`, which server-side is gated only by the registry's `interrupt !== false` check propagated through `NodeSteeringHandle.steeringSubState()` (`steering-registry.ts:155-157`) and the `GET`/interrupt route (`packages/server/src/routes/api.ts:167,279-294,1647-1649`) — no provider-id logic anywhere in that chain either (confirmed in §1).

---

## Net implication for the plan

1. **Capability flip**: `packages/providers/src/community/deepseek/capabilities.ts:25` — change `interrupt: false` to `interrupt: 'stream-abort'`. This alone flips the registry gate at `dag-executor.ts:3196`/`5964`, the steering-handle registration, the route's `steeringSubState` projection, and both web docks' `showStop` — all with zero further code changes on those surfaces (confirmed empty grep in §1).
2. **Executor terminal-reason set**: `INTERRUPT_TERMINAL_REASONS` (`dag-executor.ts:456-459`) must gain whatever literal DeepSeek's ACP bridge places in `msg.terminalReason` on an operator-abort — otherwise a real DeepSeek abort with `isError: true` falls through to the generic "Fail loudly on any other SDK error result" throw (`dag-executor.ts:2764`/`6502`) instead of being classified `interruptMarked`. The DeepSeek provider layer (`packages/providers/src/community/deepseek/provider.ts` — not read in this scout, but implied by the ACP bridge pattern) must be the one setting `terminalReason` on its abort-marked result, mirroring Claude's `provider.ts:1367,1431`.
3. **Session id on the abort result**: DeepSeek's abort-marked result must carry `sessionId` (or the pre-abort turn must have one to fall back to via `turnResumeId`) — confirmed load-bearing at `dag-executor.ts:3488` (`newSessionId ?? turnResumeId`) and its loop-path mirror (`settledTurnSessionId ?? currentSessionId`) — else the node fails fast with "no session id to resume" (`dag-executor.ts:3491-3496`).
4. **Test bootstrap gap**: `dag-executor.test.ts` must add `registerDeepseekProvider()` to its top-of-file registry bootstrap (currently absent — only `registerBuiltinProviders/Omp/Opencode/Pi/Devin/QoderCli`), and `invokeDag`'s `opts.assistant` union (`'claude' | 'pi'`, line 27178) needs widening (or per-node `provider: 'deepseek'` + `assistants.deepseek: {}` config, mirroring the `pi` branch) for a DeepSeek-flavored clone of the four #183 tests.
5. **Docs**: the capability-matrix row is generator-owned (`bun run generate:capability-matrix`) and its `stream-abort` legend entry already exists — no manual doc edit needed there. `ai-assistants.md` has no existing Claude "Stop" sentence to mirror (none exists), so any DeepSeek doc addition would be new prose, not a mirror.

---

Status: DONE
Summary: Confirmed the capability-gating hypothesis end-to-end (registry → executor → server route → both web docks, zero provider-id branches found) and located the exact non-capability change required: `INTERRUPT_TERMINAL_REASONS` (dag-executor.ts:456-459) is a hardcoded Claude-string set fed by the provider-neutral `msg.terminalReason` field, and the redirect turn's resume session id is `newSessionId ?? turnResumeId` (dag-executor.ts:3488) / `settledTurnSessionId ?? currentSessionId` (loop path) — both must be populated by DeepSeek's abort-marked result. Also found two facts not in the original hypothesis: the capability type is a 3-way `'native' | 'stream-abort' | false` axis with `'stream-abort'` pre-reserved and pre-documented for exactly this case, and `dag-executor.test.ts` does not currently register the DeepSeek provider in its bootstrap block (would throw `UnknownProviderError` on `getProviderCapabilities('deepseek')` today).
Concerns/Blockers: none — this was pure read-only scouting per instructions; the DeepSeek provider's own `provider.ts` (ACP bridge internals — how/whether it already surfaces an abort-shaped result with `terminalReason`/`sessionId` populated) was not read in this pass and should be checked before finalizing the plan's scope for the provider-layer half of the work.
