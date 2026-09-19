# Scout report: Claude provider interrupt seam (issue #183, Story 2.3)

Scope: `@archon/providers` only. `dag-executor.ts` wiring is out of scope
(see `scout-executor`) but cited where spec docs already constrain the
provider-layer design.

Grounding: `gh issue view 183`,
`_bmad-output/planning-artifacts/epics-agent-node-room/epics.md:472-511`
(Story 2.3 AC), and spec companions
`_bmad-output/specs/spec-agent-node-room/{engine-integration,control-states,provider-steering-matrix}.md`.
`provider-steering-matrix.md:13` confirms `interrupt()` (SDK ≥0.3.205) and
`AsyncIterable` prompt input (SDK ≤0.3.142) are both already satisfied at the
pinned **0.3.209** — no SDK bump needed. `engine-integration.md:25` already
commits the executor to `AbortSignal.any([nodeAbortController.signal, perTurnSignal])`
fed to `sendQuery` as one combined signal — this directly answers §2.

---

## 1. Claude `sendQuery` anatomy

`packages/providers/src/claude/provider.ts` (1812 lines). `sendQuery` starts
`:1532`; retry loop `:1620-1780`.

**`buildBaseClaudeOptions` — `:815-897`.** Builds a fresh `Options` per retry
attempt (called `:1634`). Sets `abortController: controller` (`:854`, a
**fresh `AbortController` per attempt**, `:1630`, distinct from
`requestOptions.abortSignal` — bridged only via the `onAbort` listener below);
copies `model`/`outputFormat`/`maxBudgetUsd`/`fallbackModel`/`persistSession`/`forkSession`
1:1 from `requestOptions` (`:848-865`); always sets
`permissionMode: 'bypassPermissions'` (`:866`); installs
`hooks: buildToolCaptureHooks(...)` (`:874`, `PostToolUse`/`PostToolUseFailure`
at `:900-966`) unconditionally; sets a `stderr` callback (`:875-897`), not
`includePartialMessages` — that field is **never set anywhere in this file**
(zero grep hits); container spawn override at `:826-833`.

`resume`/`forkSession` consumption, native-tool MCP registration, and
`applyNodeConfig`'s hooks/skills/mcp mutation all happen **after**
`buildBaseClaudeOptions` returns, on the same `Options` object: `:1644`
(`applyNodeConfig`), `:1652-1663` (native-tool MCP server), `:1671-1685`
(`options.resume = resumeSessionId`). **All of these mutate `options`, never
`prompt`** — confirmed by `applyNodeConfig`'s signature (`:527`,
`async function applyNodeConfig(options: Options, nodeConfig, cwd, skillSearch)`,
never touches `prompt`) — so switching `prompt` from `string` to
`AsyncIterable<SDKUserMessage>` is orthogonal to every one of them.

**`withFirstMessageTimeout` (`:410-448`)** and **`captureFirstSessionId`
(`:994-1014`)** both wrap the raw SDK event stream and are prompt-shape
agnostic — no change needed.

**`streamClaudeMessages` (`:1080-1391`)**, `result` branch `:1273-1367`.
`resultMsg.terminal_reason === 'api_error'` is read **only** as a
disambiguator (`:1288-1298`) for the `is_error`+`success` ambiguity, to decide
whether to throw `ClaudeApiResultError`. The final
`yield { type: 'result', ... }` (`:1359-1374`) never forwards
`terminal_reason` — confirmed against `MessageChunk`'s `result` variant
(`types.ts:328-357`), which has no `terminalReason` field today.

**What must change:** the SDK's `SDKResultSuccess`
(`/tmp/claude-sdk-0.3.209.d.ts:4165-4189`) carries
`terminal_reason?: TerminalReason` including `'aborted_streaming'` /
`'aborted_tools'` (union at `d.ts:6721`) on a clean interrupt. The `result`
branch needs a new **unconditional** forward — e.g.
`...( resultMsg.terminal_reason ? { terminalReason: resultMsg.terminal_reason } : {} )`
spread into the `:1359` yield — additive, leaving the `:1298` api_error read
untouched. This is what lets the executor's five-case end-cause rule
(`engine-integration.md:33`) work on Claude without depending on
`operatorInterrupt` bookkeeping alone.

`withResumedOutcome` (`shared/resumed.ts:17-27`, applied `provider.ts:1709-1712`)
shows the established pattern of stamping a field onto `result` chunks
post-hoc — but doing the `terminalReason` stamp inline in
`streamClaudeMessages` (where `resultMsg` is already destructured) is simpler.

**Retry loop / `onAbort` / `closeQuery` — `:1596-1780`.**
```
1601  const onAbort = (): void => {
1602    currentController?.abort();
1603    closeQuery(currentQuery, 'request_abort');
1604  };
1605  if (requestOptions?.abortSignal) {
1606    requestOptions.abortSignal.addEventListener('abort', onAbort, { once: true });
1607  }
```
Registered **once, outside** the retry `for` loop, against
`requestOptions.abortSignal` — matches the test asserting a single listener
survives retries (`provider.test.ts:2013-2014`). `currentController`/
`currentQuery` are reassigned per attempt (`:1630`, `:1687`) and reset in the
loop's `finally` (`:1780`). `closeQuery` (`:83-90`) calls `.close()` in a
try/catch — the Cancel-grade **hard kill**: terminates the subprocess, and per
the SDK doc ("no further messages will be received", `d.ts:2508-2509`) is
incompatible with wanting a `result` back for the interrupted turn.

For a per-turn interrupt seam, `onAbort` must NOT unconditionally
`closeQuery` — it must call `currentQuery.interrupt()` (soft, session
survives, still yields a `result`) instead. `query()` returns a `Query`
(extends `AsyncGenerator<SDKMessage, void>` plus `interrupt()`,
`d.ts:2227-2247`), so `currentQuery` already has the right runtime type.
`interrupt(): Promise<SDKControlInterruptResponse | undefined>` is async but
`onAbort` today is a synchronous `void` callback — needs
`void currentQuery.interrupt().catch(...)` or an async-aware restructure.
**`interrupt()` only works "when streaming input/output is used"
(`d.ts:2231-2234`)** — this is why `prompt` must become
`AsyncIterable<SDKUserMessage>`; today it is always a `string`
(`sendQuery(prompt: string, ...)`, `:1533-1538`; `buildClaudeAskResumePrompt`
also returns a `string`, `:1485-1495`).

**Streaming-input — no existing precedent.**
`grep -rn "\.interrupt(\|streamInput\|AsyncIterable<SDKUserMessage>\|SDKUserMessage" packages/`
returns **zero hits** outside the SDK's own `.d.ts`. `askhuman-resume-spike.ts`
(diagnostic-only, barred from export/CI) is the closest analog but does
**not** use streaming input — `runHostAbortExperiment` (`:301-343`) always
calls `query({ prompt: <string>, options })` and implements its "host-abort"
protocol via a plain `AbortController.abort()` (killing the process) followed
by a **second, fresh** `query()` call with `resume: first.sessionId`
(`:326-333`) — this predates and does not exercise native `interrupt()`.

Minimal one-message wrapper (must be written new — not present anywhere):
```ts
async function* singleMessagePrompt(text: string): AsyncGenerator<SDKUserMessage> {
  yield { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null };
}
```

**Open question, unverified:** whether the input generator may `return`
after yielding once, or must stay open for `interrupt()` to remain callable
for the turn's duration. `Query.streamInput(stream)` (`d.ts:2498`, "Used
internally for multi-turn conversations") is a *separate* channel for pushing
more input onto a live query, suggesting the initial `prompt` iterable's
lifecycle may be decoupled from the query's lifetime. Since "Send now"
delivers the redirect as a new turn through the same session via a **fresh**
`sendQuery()` call with `resume: sessionId` (`engine-integration.md:44`, "the
session-resume carriage is reused as-is") — not a persisted live
`streamInput` channel across turns — the lower-risk design is: one
`AsyncIterable` prompt per `sendQuery()` call, yielding exactly one message,
used only to unlock `interrupt()` for that call's duration. Should be spiked
empirically (a throwaway script mirroring `askhuman-resume-spike.ts`) before
being trusted.

**Interaction with resume/forkSession/ask-resume/hooks/native-tool MCP/outputFormat:**
all confirmed independent of `prompt` shape, **except** `hasAskResume`
(`:1608-1620`) which builds the prompt itself via
`buildClaudeAskResumePrompt(resumeInteractions)` (`:1616`, returns a
`string`). Ask-resume and interrupt-seam are different turn types that should
not co-occur in one turn, so this is a documented edge, not a blocker.

---

## 2. `AgentRequestOptions`/`SendQueryOptions` and `abortSignal`

**Shape — `types.ts:591-611`:**
```ts
export interface AgentRequestOptions {
  model?: string;
  abortSignal?: AbortSignal;
  systemPrompt?: SystemPromptInput;
  outputFormat?: { type: 'json_schema'; schema: Record<string, unknown> };
  env?: Record<string, string>;
  maxBudgetUsd?: number;
  fallbackModel?: string;
  forkSession?: boolean;
  persistSession?: boolean;
  traceContext?: AgentTraceContext;
  nativeTools?: NativeTool[];
}
```
`SendQueryOptions extends AgentRequestOptions` (`:732-750`) adds `nodeConfig`,
`assistantConfig`, `execContext`, `resumeInteractions`. Exactly **one**
`abortSignal` field exists — no per-turn/per-node split today.

**`abortSignal` consumption, one line each:**

| Provider | File:line |
|---|---|
| claude | `claude/provider.ts:1605-1606` `abortSignal.addEventListener('abort', onAbort, {once:true})` |
| codex | `codex/provider.ts:1066-1067` same pattern, removed `:1186-1187` |
| grok | `grok/provider.ts:334`, removed `:406` |
| e2e-fake | `e2e-fake/provider.ts:335`, inside `waitUnlessAborted` (`:319-335`) |
| community/pi | `community/pi/provider.ts:1071` forwarded as a positional arg |
| community/omp | `community/omp/provider.ts:424-426`, removed `:517` |
| community/deepseek | `community/deepseek/provider.ts:211` forwarded into ACP client call |
| community/opencode | `community/opencode/provider.ts:105,113,213` `.aborted` checks + forwarded |
| community/copilot | `community/copilot/provider.ts:616` forwarded positionally |
| community/qodercli | `community/qodercli/provider.ts:472-530` add/removeEventListener pair |
| community/devin | `community/devin/provider.ts:110-111` spread conditionally |

Every provider treats `abortSignal` as one signal, one meaning ("stop now",
hard). None discriminates by `signal.reason` today.

**`AbortSignal.any` reason-forwarding — verified this session (Bun 1.3.14):**
```
$ bun -e 'const a=new AbortController(); const c=AbortSignal.any([a.signal]);
a.abort("custom-reason-A"); console.log(c.reason)'
custom-reason-A
```
Confirmed: `AbortSignal.any([...])` forwards the triggering source's
`.reason` onto the combined signal.

**Recommendation: do not add `interruptSignal?: AbortSignal`.** The
executor-side spec (`engine-integration.md:25`) already commits to composing
`AbortSignal.any([nodeAbortController.signal, perTurnSignal])` **before**
calling `sendQuery` and passing the result as the single `abortSignal` —
matching every other provider's existing contract (table above) and
requiring zero `AgentRequestOptions` shape changes. Discrimination point is
`signal.reason` (verified to survive `AbortSignal.any`): the executor calls
`perTurnController.abort('operator_interrupt')` for a steering interrupt,
`nodeAbortController.abort()` with default reason for Cancel. Only Claude's
`onAbort` needs new logic — branch on
`requestOptions.abortSignal.reason === 'operator_interrupt'` to call
`currentQuery.interrupt()` instead of `closeQuery(...)`. Every other
provider's handler is untouched (they already do a hard stream-abort per
`provider-steering-matrix.md`), so this requires zero non-Claude changes for
Story 2.3. A second option field would instead require every call site
(executor, orchestrator, tests) to thread two signals for a distinction only
Claude currently acts on.

---

## 3. `ProviderCapabilities` and the capability-matrix generator

**Shape — `types.ts:755-815`.** 17 boolean/tiered fields + 2 advisory
(`knownToolNames?`, `renamedTools?`), ending `askHuman: boolean;` at `:815`.
No `interrupt`/`steering` field exists. `CLAUDE_CAPABILITIES`
(`claude/capabilities.ts:47-65`) sets all relevant booleans `true`. A new
field requires a value in **every** provider's `capabilities.ts` (codex,
grok, each `community/*/capabilities.ts`, `e2e-fake/capabilities.ts:15-31`) —
`ProviderCapabilities` is a closed interface; TS fails any literal missing a
required field.

**Generator — `scripts/generate-capability-matrix.ts` (320 lines).** `AXES`
(`:51-69`) is the ordered `{key, label}` row list — adding a capability
requires appending here. `SKIP_KEYS` (`:79`) excludes advisory-only fields.
**Exact fail point** — `assertTotalCoverage` (`:163-179`):
```ts
function assertTotalCoverage(providers: ProviderInfo[]): void {
  const covered = new Set<string>([...AXES.map(a => a.key), ...SKIP_KEYS]);
  const uncovered = new Set<string>();
  for (const p of providers) {
    for (const key of Object.keys(p.capabilities)) {
      if (!covered.has(key)) uncovered.add(key);
    }
  }
  if (uncovered.size > 0) throw new Error(`ProviderCapabilities field(s) not represented...`);
}
```
Fires under both `bun run generate:capability-matrix` and `--check`
(`main()`, `:290-320`). `renderCell` (`:150-157`) renders booleans as
`✅`/`❌`; only `structuredOutput` gets tiered rendering — a tiered
`interrupt` field needs a similar branch. `CAVEATS` (`:90-127`) is optional
per-cell nuance text.

**Commands:** `bun run generate:capability-matrix` (writes
`packages/docs-web/.../provider-capabilities.md`) and
`bun run check:capability-matrix` (exit 2 if stale) — both part of
`bun run validate`. e2e-fake never appears in the matrix because
`registerE2eFakeProvider()` (`e2e-fake/registration.ts:17`) is gated on
`ARCHON_E2E_FAKE_PROVIDER`, unset when the generator runs.

**Recommendation:** a **tiered** field mirroring `structuredOutput` —
`interrupt: 'native' | 'stream-abort'` (never `false`; per
`provider-steering-matrix.md:5`, "No provider is disqualified from
interrupt"). `CLAUDE_CAPABILITIES` declares `'native'`; every other provider
(including `e2e-fake`, per §5) declares `'stream-abort'` — avoids a `false`
case the executor would need to special-case.

---

## 4. Claude provider tests

`packages/providers/src/claude/provider.test.ts` (3814 lines).

**Mocking: `mock.module` for the SDK, `spyOn` for internal exports.**
```ts
// :8-10
mock.module('@archon/paths', () => ({ createLogger: mock(() => mockLogger) }));
// :18-35
const mockQuery = mock(async function* () {});
mock.module('@anthropic-ai/claude-agent-sdk', () => ({
  query: mockQuery, tool: (...) => {...}, createSdkMcpServer: config => config,
}));
```
This replaces the SDK import process-wide (why the file runs as its own `bun
test` invocation). `spyOn` is reserved for internal functions the provider
file itself exports, e.g. `spyOn(claudeModule, 'getProcessUid')`
(`:114,129,135`), `spyOn(binaryResolver, 'resolveClaudeBinaryPath')`
(`:1098,1128`). `mockQuery.mockImplementation(...)` is reassigned per test —
sometimes a plain async generator, sometimes a hand-built object with
`next`/`return`/`throw`/`close`. **No test constructs an `interrupt` method
today.**

**Existing abort tests — `:1986-2065`:**
1. `'abort signal cancels query across retries without listener leak'`
   (`:1986-2014`) — asserts `callCount === 1` after abort fires mid-retry-delay.
2. `'abort signal closes the active SDK query'` (`:2018-2064`) — hand-rolled
   `source` object with `close: mock(...)`; asserts
   `expect(close).toHaveBeenCalledTimes(1)` (`:2064`) after
   `abortController.abort()` — directly tests the hard-kill path.

**Building an interrupt test:** extend the `source` mock with
`interrupt: mock(async () => ({ still_queued: [] }))` (shape from
`SDKControlInterruptResponse`, `d.ts:3402-3404`). New test would: (1) drive
`sendQuery` with an `abortSignal` carrying `reason: 'operator_interrupt'`;
(2) assert `source.interrupt` called once and `source.close` NOT called;
(3) have `next()` end with a synthetic `result` carrying
`terminal_reason: 'aborted_streaming'`, then assert the yielded
`MessageChunk` has `sessionId` + the new abort-marker field rather than the
generator throwing. Signal-composition itself (`AbortSignal.any` +
`.reason`) can be unit-tested independently of the SDK mock.

**`package.json` test script:** a single line of ~90 sequential
`bun test <file> &&`-joined invocations; `bun test src/claude/provider.test.ts`
runs first, standalone (own process per the mock-pollution isolation rule). A
new interrupt suite can extend `provider.test.ts` directly or, if the mock
shape conflicts, ship as its own file appended to the chain (mirroring
`src/claude/askhuman-resume-spike.test.ts`).

---

## 5. e2e-fake provider

`packages/providers/src/e2e-fake/provider.ts` (517 lines).

**`abortSignal` — hard-only, mirrors Cancel.** `waitUnlessAborted(delayMs, abortSignal)`
(`:319-335`) races a `setTimeout` against `abort`, and on abort **rejects**
with `Error('Query aborted')` (`:332`), re-checked and re-thrown at `:397-398`.
No soft path exists — confirmed by three of its own tests all asserting a
`throw`: `'echoPrompt still throws Query aborted during delayMs'`
(`:517-526`), `'throws Query aborted when the signal is already aborted'`
(`:528-534`), `'throws Query aborted during delayMs'` (`:536-543`).

**`echoPrompt`, chunks, session ids.** `scenarioSchema` (`:128-151`, Zod
`.strict()` + `superRefine` for `taskDispatch` mutual exclusivity) includes
`echoPrompt: z.boolean().optional()` (`:138`). `sessionId = resumeSessionId ?? e2e-fake-${randomUUID()}`
(`:388`). Chunk order (`:388-517`): optional delay → optional `emitTodo`
pairs (`:420-436`) → `emitTool`/`taskDispatch`/plain-assistant (`:438-478`) →
optional `echoPrompt` echo (`:489-492`, prefix differs on `resumeSessionId`)
→ optional `doneWhenPromptIncludes` marker (`:494-499`) → optional
`askHuman` → terminal `{type:'result', sessionId, usageBreakdown?, resumed}`
(`:508-516`). `resumeInteractions` short-circuits into a dedicated
ask-resume echo + result (`:401-413`).

**Story 2.1 fixtures / Playwright driver.**
`e2e/fixtures/workflows/e2e-queue-guidance.yaml` — node `steer-me`, provider
`e2e-fake`, directive `{"delayMs":30000}`. Sibling
`e2e-queue-guidance-loop.yaml` — loop node `steer-loop`, `{"delayMs":25000}`,
`until: E2E_LOOP_DONE`, `max_iterations: 3`. `e2e/lib/playwright/archon-runtime.ts`
defines the fixture paths (`:52-65`), exported names
`E2E_QUEUE_GUIDANCE_WORKFLOW_NAME`/`E2E_QUEUE_GUIDANCE_LOOP_WORKFLOW_NAME`
(`:90-91`), node ids `QUEUE_GUIDANCE_NODE`/`QUEUE_GUIDANCE_LOOP_NODE`
(`:92-93`); `ARCHON_E2E_FAKE_PROVIDER: '1'` set in `isolatedEnv(...)`
(`:225`). Web-dispatch start helper:
```ts
// :780-787
const startWorkflowViaWeb = async (workflowName, message): Promise<HitlWebRun> => {
  const run = await dispatchWorkflowViaWeb(workflowName, message);
  await waitForRunStatus(run.runId, 'running');
  return run;
};
```

**No "Stop"/"Send now" UI exists yet.**
`grep -n "Stop\|interrupt\|Send now" packages/web/src/components/workflows/NodeRoom.tsx`
returns only a CSS class token (`interrupted: 'text-warning'`, `:322`) — no
button/action. Story 2.3's dock states are not built; a Playwright e2e has no
surface to drive until that ships.

**Recommendation:** add a scenario field `interruptible: z.boolean().optional()`
alongside `delayMs` that makes `waitUnlessAborted` check `signal.reason` the
same way as the real Claude provider (§2) — `reason === 'operator_interrupt'`
resolves the wait early and the generator yields a terminal `result` carrying
the new abort-marker field (§1) plus the **same** `sessionId`, instead of
throwing. A second `sendQuery()` call with matching `resumeSessionId` (mirror
of "Send now → next turn, same session") can reuse `echoPrompt` to prove the
redirect text reached the same session — exactly how `echoPrompt` already
lets `agent-queue-guidance.spec.ts` prove queued text became the next real
turn (header comment, `:31-34`). `E2E_FAKE_CAPABILITIES`
(`e2e-fake/capabilities.ts:15-31`) would set the new §3 field to
`'stream-abort'`.

---

## 6. Registration and `getProviderCapabilities` resolution

`packages/providers/src/registry.ts` (216 lines):
`registerProvider(entry)` (`:47-53`) throws on duplicate id, else
`registry.set(...)` into a module-level `Map` (`:41`).
`getProviderCapabilities(id)` (`:84-86`) is `getRegistration(id).capabilities`
— `getRegistration` (`:72-78`) throws `UnknownProviderError` if unregistered.
`registerBuiltinProviders()` (`:118-176`) registers claude/codex/grok,
idempotent (`:173`). `registerCommunityProviders()` (`:197-207`) calls each
community `register<Name>Provider()`, ending `registerE2eFakeProvider()`
(`:206`, env-gated per §5). Both must run once at process entrypoints before
lookup — `scripts/generate-capability-matrix.ts:main()` (`:290-291`) does
this before `getProviderInfoList()`.

Executor consumption (`packages/workflows/src`): `node-model-resolution.ts:275`,
`loader.ts:1036`, `model-validation.ts:247`
(`getProviderCapabilities(provider).effortControl ? EFFORT_LEVELS : null`),
`dag-executor.ts:1317,1815,2254,5918,10134,10212`, `validator.ts:474`. The
comment at `dag-executor.ts:1315-1316` ("`getProviderCapabilities` is safe:
`resolveNodeExecutionRequest` already rejected...") documents the invariant a
new `interrupt` field would rely on: resolve `provider` →
`getProviderCapabilities(provider)` → branch on the field to pick the
Claude-native `interrupt()` path vs. the universal stream-abort.

---

Status: DONE
Summary: Full anatomy of Claude `sendQuery` (options building, retry loop, `onAbort`/`closeQuery`, result normalization) mapped with exact anchors; confirmed no streaming-input/`interrupt()` precedent exists anywhere in the repo; confirmed `AbortSignal.any` forwards `.reason` in Bun 1.3.14; recommend reusing the single `abortSignal` field with reason-discrimination (already implied by `engine-integration.md`) rather than a second `interruptSignal` option, plus a tiered `interrupt` capability axis and an opt-in e2e-fake "interruptible" scenario field for deterministic Playwright coverage.
Concerns/Blockers: Unverified whether the streaming-input prompt generator may complete after yielding once or must stay open for `interrupt()` to remain callable for the turn's duration — recommend a throwaway spike script (mirroring `askhuman-resume-spike.ts`) against a real Claude session before committing to the wrapper shape. No UI (Stop/Send now dock) exists yet in `packages/web` — a Playwright e2e for Story 2.3 has no surface to drive until that ships, likely in a sibling story/PR.
