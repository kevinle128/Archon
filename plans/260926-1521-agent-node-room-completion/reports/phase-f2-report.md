# Phase F2 report — Codex and DeepSeek Stop, Codex file-change persistence

Worktree: `/Users/dale/orca/Archon/.claude/worktrees/agent-a5fbef3f63b72642c`
Branch: `worktree-agent-a5fbef3f63b72642c` (merged `develop-2` twice: once at
start for the durable steering store, once mid-task for Phase D's agent
context rows — both merges were clean, no conflicts)

## Scope

Stories 4.1 (persist successful Codex `file_change` rows), 8.4 (Codex Stop
and session continuation), 10.4 (Codex-supported tool status presentation —
backend half), 8.6 (DeepSeek Stop and continuation), and this phase's share
of 8.8 (truthful capability flags).

## Story 8.4 — Codex Stop and session continuation

**Files:** `packages/providers/src/codex/provider.ts`, `capabilities.ts`,
`provider.test.ts`; `packages/providers/src/index.ts` (export
`CODEX_CAPABILITIES`); `packages/workflows/src/dag-executor.ts`,
`dag-executor.test.ts`.

Codex's TypeScript SDK has no native mid-turn interrupt — the only lever is
aborting the `AbortSignal` passed to `runStreamed()`, which the SDK's own
subprocess-signal wiring turns into a killed child and a thrown `AbortError`
(measured: `interrupt-resume-spike.ts`, this repo, prior phase). There is no
clean terminal event on abort, so a naive implementation would lose the
thread id an operator needs to redirect on.

**Design.** `streamCodexEvents` now takes the per-attempt `abortSignal`
(unchanged meaning — the signal actually passed to the SDK) plus the two
external signals that can cause it to abort: `cancelSignal` (node-level
Cancel) and `interruptSignal` (operator Stop). A `buildInterruptedResult()`
closure decides, from those two signals alone, whether an abort is
interrupt-caused (interrupt signal aborted, cancel signal not) and if so
builds a `type: 'result'` chunk carrying `terminalReason: 'stream_aborted'`
(the existing shared constant, already documented in
`providers/types.ts` for "adapter-synthesized" stream-abort providers, but
until now applied by no registered provider) plus `sessionId` from the
locally-tracked `resolvedThreadId`. The whole event loop is wrapped in one
try/catch: whichever site an abort surfaces at — the pre-loop check, the
between-events check, or a thrown `AbortError` from the SDK's own iterator —
funnels through the same `buildInterruptedResult()` decision, so the yielded
shape is identical regardless of _where_ Codex's SDK happens to throw.

`isError: true` and `errorSubtype: 'stream_aborted'` ride alongside
`terminalReason` even though the executor's interrupt check only needs the
terminal reason. Reason: `isInterruptMarkedResult` (dag-executor.ts) only
classifies a turn as interrupted when the operator's own live handle proves
it asked for a stop; the identical marker arriving on a turn the executor
does **not** recognize as operator-interrupted must still fail loudly
through the ordinary SDK-error path instead of quietly completing on
truncated output. Verified by a dedicated test in
`dag-executor.test.ts`'s new `codex conformance` block (mirrors the existing
`deepseek conformance` block): "stream_aborted without operator flag follows
the normal SDK failure path."

**Thread-id race.** A fresh (never-resumed) thread's id is only assigned
once the SDK's internal event parser reaches `thread.started` — confirmed by
reading `@openai/codex-sdk`'s own source (`Thread._id` is set inside
`runStreamedInternal`'s per-line loop, before the event is yielded). Aborting
before that line is parsed would kill the child before the id ever exists,
losing the only handle the operator could redirect to. `onOperatorInterrupt`
(in `sendQuery`'s retry loop, mirroring the existing `onCallerAbort` wiring
for node-level Cancel) checks `thread.id` — a live getter, current the
instant it's read, decoupled from how far this provider's own consumer has
progressed through the event stream — and aborts immediately if it is
already known, or defers via a bounded `setTimeout` (`CODEX_INTERRUPT_THREAD_ID_WAIT_MS`
= 500 ms, matching OMP's own `INTERRUPT_SESSION_HEADER_WAIT_MS` precedent)
if not, so Stop can never hang on a thread that never starts. A _resumed_
thread already knows its id synchronously (passed in as the constructor's 4th
argument), so the defer path never applies to a redirect turn. Both branches
are unit-tested with a fake SDK, including the pathological case where the id
never arrives at all (the wait still fires, unconditionally, and the executor's
own "no session id to resume" fail-fast takes over — matching Claude's and
DeepSeek's identical edge case).

**Capability value.** `CODEX_CAPABILITIES.interrupt` is now `'stream-abort'`
(was `false`) — matches the documented union exactly (`'native' | 'stream-abort'
| false` in `providers/types.ts`): Codex genuinely kills its own stream/child
and synthesizes the marker, unlike Claude's true in-process interrupt.

### Live verification (real Codex SDK, real ChatGPT-plan subscription)

Isolated app per the task: `ARCHON_HOME` at a scratch dir copied from the
real `~/.archon/archon.db`/`config.yaml`/`credential-key`; server on port
3325 (`bun run src/index.ts`, not `--watch` — its auto-restart on file change
did not reliably come back up, so capability-flag edits were followed by an
explicit manual restart); a throwaway local git repo with a `file://` self
remote (needed only so Archon's worktree/sync machinery has _a_ remote to
resolve — this repo never pushes anywhere).

**Mid-tool Stop.** Workflow `codex-stop-test` (`provider: codex`, `effort:
low`, prompt: run `sleep 90 && echo done` via the shell tool). `POST
.../nodes/worker/interrupt` while the tool was in flight returned `{success:
true, sub_state: "idle-after-interrupt"}` in the same second it was sent.
Server log: `provider.codex … codex.query_interrupted` immediately followed
by `workflow.dag-executor … dag.node_turn_interrupted`. The run's event
stream shows `tool_completed` for the `sleep` call with `tool_outcome:
"interrupted"` — direct evidence for 8.4's "persisted tool row becomes
interrupted" criterion. The workflow run stayed `running` (node never
failed).

**Redirect, same thread.** `POST .../nodes/worker/send` with `intent:
"send_now"` and the message "forget the sleep, reply with the word BANANA".
Server log shows a **second** `codex.thread_started` line carrying the
_exact same_ thread id as the first (`01a0de50-6713-7e31-aa6d-dbb13bef4510`
in one run) — Codex's SDK emits this event on `resumeThread()` too, not only
on a genuinely new thread, and the identical id across both lines is direct
proof the redirect landed on the same conversation, not a silent new one.
The node completed with `node_output: "BANANA"` and the workflow completed.

**Mid-generation Stop.** A second attempt intended to isolate the
no-tool-in-flight case hit a workflow-discovery staleness artifact in this
scratch setup (a `file://` self-remote occasionally serves a cached clone a
few commits behind — a test-harness quirk, not a product bug) and re-ran the
already-committed `sleep`-prompt version instead of the intended essay
prompt, so it re-proved the mid-tool case a second time rather than adding a
new one. Mid-generation interrupt is proven by construction instead: the
provider's abort path (`buildInterruptedResult` triggered by
`attemptController.abort()`) does not branch on what kind of Codex event is
in flight when the signal fires — the same code handles a tool-call abort
and a text-generation abort identically, and this is exercised directly and
deterministically by the unit tests (`mid-generation interrupt yields a
stream_aborted result instead of throwing`, using a fake SDK stream that
aborts between two `agent_message` events with no tool in between).

## Story 10.4 — Codex-supported tool status presentation (backend half)

My share is proving turn-level interruption and session continuation
**separately** from glyph presentation — done above. The glyph exclusion
itself ("a Codex tool row never uses the interrupted warning glyph … no
provider-specific branch in the presenter") is presentation-layer logic in
`packages/web/src/lib/agent-history.ts` / `tool-presentation.ts`, owned by
another phase; I did not touch those files. What this phase's backend
guarantees for that later work: the persisted `tool_completed` event's
`tool_outcome` is `'interrupted'` for Codex exactly the same way it already
is for every other provider (`settleRunningToolsOutcome` in dag-executor.ts
is provider-neutral and untouched), and `CODEX_CAPABILITIES.interrupt` is
`'stream-abort'` — a capability-driven signal a presenter can key off
instead of a hardcoded provider id, if that is the mechanism the presenting
phase chooses.

## Story 4.1 — Persist successful Codex file-change rows

**Files:** `packages/providers/src/codex/provider.ts`, `provider.test.ts`.

Read `@openai/codex-sdk`'s own type declarations before writing anything:
`FileChangeItem.changes: FileUpdateChange[]` where `FileUpdateChange = {
path: string; kind: 'add' | 'delete' | 'update' }` — confirmed no
before/after content field exists anywhere on this type. A diff can
therefore never be built from a Codex `file_change` event; the honest
evidence available is the path plus whatever the file currently contains on
disk.

**Design.** On a successful (`status !== 'failed'`) `file_change` item, the
provider now yields one `{type: 'tool', toolName: 'apply_patch', toolInput:
{path, kind}, toolCallId}` / `{type: 'tool_result', ...}` pair **per changed
path**, in `changes[]` order, instead of the old single formatted `system`
string. `apply_patch` case-folds to `applypatch`, an existing Tier-1 file
alias in the shared presenter's resolver (`tool-presentation-contract.md`),
and `path` is a Tier-2 duck-typed key the presenter already reads for the
headline — no presenter change was needed for the row to resolve to the
file family. `toolCallId` is `${item.id}:${index}` so multiple paths in one
patch don't collide and ordering survives into the transcript's `seq`
column via emission order. The failed-patch path is unchanged (still a
single formatted `system` message) — explicitly out of this story's scope,
confirmed against the acceptance criteria's "successful" framing.

The tool_result's `toolOutput` is the changed file's **current on-disk
content**, read via a new `readFileChangePreview()` helper (bounded to 65,536
bytes, matching the presenter's own display ceiling; a `delete` never
attempts a read — there is nothing left to preview; a read failure — e.g. a
later step already removed the file — yields `undefined` rather than
throwing, since the patch itself already succeeded). This is not a
fabricated diff; it is the same category of evidence a plain file-read tool
would supply, and the shared presenter's `file` body arm already falls back
to exactly this shape (`path` + `preview`) whenever no before/after pair is
present.

### Verification — real event, persisted row, rendered presentation

Test evidence starts at a realistic provider fixture (`FileChangeItem` shape
matching the SDK's actual type, including a genuine `id`) and asserts the
exact `tool`/`tool_result` chunks emitted — no synthetic no-input row is
used or accepted as evidence (`provider.test.ts`: "successful file_change
yields one tool/tool_result pair per path, in order", plus a real-tempdir
test that writes an actual file and asserts the preview text matches its
real content byte for byte).

Live evidence against the real Codex SDK: workflow `codex-file-change-test`
told the agent to edit `README.md` via its file tool. The real Codex CLI (a
ChatGPT-plan account) needed a forceful, explicit prompt before it actually
invoked the tool rather than just replying "done" — a model-behavior quirk
of the test prompt, not a code issue; confirmed on disk (`README.md`
unchanged) versus the successful attempt where it was genuinely edited.
`LOG_LEVEL=debug` on the isolated server showed the real event sequence:
`item.started(file_change)` → `item.completed(file_change)` — no synthetic
insertion. The persisted `workflow_node_messages` row for that run:

```
kind=tool  payload={"name":"apply_patch","id":"item_0:0","input":{"path":"<absolute path>/README.md","kind":"add"}}
kind=tool  payload={"name":"apply_patch","id":"item_0:0","output":"# test repo\nEdited by Codex for file-change verification.\n"}
```

(Codex reported `kind: "add"` for what was actually an overwrite of an
existing file — the SDK's own classification, passed through unchanged, not
something this adapter infers.) `README.md` on disk in the run's worktree
matched that output byte for byte.

Screenshots (`plans/260926-1521-agent-node-room-completion/evidence/phase-f2/`):

- `console-codex-file-row.png` — Console shell, collapsed transcript: an
  `apply_patch` chip with the real path as headline, resolved cleanly (no
  raw JSON) by the existing shared presenter.
- `legacy-codex-file-row.png` — Legacy shell, the same row expanded: `file ·
3ms` body kind (family = file, confirmed), the full path, and the preview
  text showing the real post-edit file content.

Both screenshots are the **existing, unmodified** shared presenter
correctly resolving a family and rendering a readable body from data this
phase persisted — no presenter code was touched to produce them.

## Story 8.6 — DeepSeek Stop and continuation

**Files:** `packages/providers/src/community/deepseek/acp-client.ts`,
`acp-client.test.ts`, `capabilities.ts`, `config.test.ts`;
`packages/providers/src/registry.test.ts`;
`packages/workflows/src/dag-executor.test.ts` (comment/fixture cleanup only
— the interrupt seam and its session/cancel wiring were already fully
implemented and unit-tested by a prior phase; this phase's job was
live verification and, on finding one, a correctness fix).

### The blocker, and how it resolved

Initial live attempts (direct-provider script, real HTTP call, and the
literal CLI — `bun src/cli.ts workflow run … --no-worktree`) all failed with
the identical error from the real DSH `acp` binary:

```
Node 'worker' failed: SDK returned deepseek_protocol_error — Internal error: turn failed:
llm-deepseek: no API key for provider route "deepseek-official"; store DEEPSEEK_API_KEY
through the credentials service (the web Models page writes it), or export DEEPSEEK_API_KEY
in the launching environment
```

`~/.archon/config.yaml` has no `deepseek:` assistant entry, Archon's
per-user provider-key vault has no deepseek rows, and no `DEEPSEEK_API_KEY`
exists in any shell profile or the running environment — all consistent
with that error and with the prior phase's own spike report
(`plans/reports/deepseek-interrupt-resume-spike.md`, recorded Block /
missing-env). The user clarified DeepSeek on this machine authenticates
through an Alibaba token-plan route, not `deepseek-official`, and gave the
exact model reference: `alibaba/deepseek-v4.1-flash`.

Root cause was **not** an adapter bug. `resolveModelSelection()`
(`community/deepseek/config.ts`, pre-existing) already splits any
`<route>/<model>` string on its first `/` into `{providerRoute, model}` —
that is its entire purpose. Setting the workflow node's `model:
alibaba/deepseek-v4.1-flash` was sufficient; Archon's _default_ of
`deepseek-official` only applies when no model is configured at all. No
adapter or config-schema change was needed for the route to pass through.

### The real bug this verification did find

With the correct route, a live mid-tool Stop worked, but the persisted tool
row read `tool_outcome: "error"` instead of `"interrupted"`. Root cause:
DSH's ACP transport reports a cancelled in-flight tool as ordinary
`tool_call_update` `status: 'failed'` — there is no distinct "cancelled"
status — and the existing event-bridge maps `failed` unconditionally to
`error`. This is exactly the scenario the prior phase's spike report
flagged as deferred ("Conditional bridge mapping … not applied … unnecessary
until live evidence shows a cancelled in-flight tool arriving as ACP
`status:'failed'` before the abort result") — now observed directly.

**Fix:** `acp-client.ts` adds `applyOperatorInterruptToolMapping()`, applied
to every chunk `mapDeepseekSessionUpdate` produces before it reaches the
queue. It remaps `tool_result` + `toolOutcome: 'error'` to `'interrupted'`
**only** when `cancellationCause === 'operator-interrupt'` — never for
node-level Cancel or process cleanup, matching the spike's own documented
plan exactly. Two new tests cover both branches: an operator-Stop cancel
remaps to `interrupted`; a node-level Cancel on an otherwise identical fixture
keeps `error` (proving the gate, not just the remap). Re-verified live after
the fix — the tool row now reads `interrupted`.

### Live verification (real DSH binary, real Alibaba-routed subscription)

Same isolated app as the Codex verification (same scratch `ARCHON_HOME`,
same throwaway repo). Workflow node: `provider: deepseek`, `model:
alibaba/deepseek-v4.1-flash`.

**Mid-tool Stop.** Prompt: run `sleep 90 && echo done` via the shell tool.
`POST .../interrupt` returned `{success: true, sub_state:
"idle-after-interrupt"}` immediately. Event stream: `tool_completed` for the
`bash` call with `tool_outcome: "interrupted"` (after the fix above; `"error"`
before it — both captured). Redirect via `POST .../send` with `intent:
"send_now"` and "reply with the word BANANA" completed the node with
`node_output: "BANANA"`.

**Mid-generation Stop (no tool in flight).** A second workflow prompted for
a long essay with no tool use. `POST .../interrupt` again returned
`idle-after-interrupt` immediately, confirmed via the event stream that no
`tool_called` event had fired for this run (a genuine no-tool-in-flight
case, unlike the Codex mid-generation attempt above). Redirect to "reply
with the word PINEAPPLE" completed the node with `node_output:
"PINEAPPLE"`.

**Same-session continuation — structural proof, not inference from reply
text.** `driveDeepseekAcpTurn`'s resume path calls `session/resume` with the
interrupted turn's own session id and throws `deepseek_resume_failed` if DSH
rejects it (existing code, unit-tested: "a resumed turn uses the requested
session id and never calls new"). Both live redirects above completed
successfully with no `deepseek_resume_failed` anywhere in the run's event
stream — the only way that is possible is if DSH accepted `session/resume`
against the exact session id from the interrupted turn. This is the same
provider-neutral dag-executor redirect mechanism already verified for Codex
(`interruptedSessionId = newSessionId ?? turnResumeId`, threaded into the
next `sendQuery` call as `resumeSessionId`); DeepSeek's own part — turning
that id into a real `session/resume` RPC rather than a fresh `session/new` —
is what this evidence proves.

**Capability value.** `DEEPSEEK_CAPABILITIES.interrupt` is now
`'stream-abort'` (was `false`). Not `'native'`: DSH's ACP `session/close` +
cold `session/resume` tear down and re-establish the session rather than
keeping it warm in-process the way Claude's native interrupt does — the
adapter genuinely cancels-and-reconnects, matching the "stream-abort"
category's own definition.

## Story 8.8 (this phase's share) — truthful capability flags

- `CODEX_CAPABILITIES.interrupt`: `false` → `'stream-abort'`, on live proof.
- `DEEPSEEK_CAPABILITIES.interrupt`: `false` → `'stream-abort'`, on live
  proof (after finding the correct route — the flag was kept `false` for the
  entire period the real error was unresolved; it was never flipped on
  unverified evidence).
- `softInjection` and `deliveryAck` stay `false` for both — untouched by this
  phase's work, matching what was actually proven (nothing).
- Capability matrix regenerated (`bun run generate:capability-matrix`);
  `check:capability-matrix` passes.

## Tests

- `packages/providers/src/codex/provider.test.ts` — 101 tests (was 93): 7 new
  interrupt tests (mid-generation, mid-tool, resumed-thread, cancel-dominates,
  no-retry-after-interrupt, defer-until-thread-id, defer-timeout-fallback) + 2
  new file-change tests (per-path pairs, real-tempdir preview) + 1 updated
  (successful file_change no longer emits a system summary) + 1 updated
  (`getCapabilities` now expects `'stream-abort'`).
- `packages/providers/src/community/deepseek/acp-client.test.ts` — 41 tests
  (was 39): 2 new (`operator-interrupt` remap applies; node-level `Cancel`
  does not).
- `packages/providers/src/community/deepseek/config.test.ts` — capability
  snapshot updated to `'stream-abort'`.
- `packages/providers/src/registry.test.ts` — "only Codex advertises
  stream-abort" renamed and widened to assert `['codex', 'deepseek']`.
- `packages/workflows/src/dag-executor.test.ts` — new `codex conformance`
  describe block mirroring the existing `deepseek conformance` one (direct
  path idle+redirect+one-interrupted-tool+no-reask; unmarked `stream_aborted`
  fails loudly; AI-loop idle+redirect); `deepseek conformance` block's
  stale "Phase 1 spike … stays false" comment corrected to match the now-true
  capability; `STREAM_ABORTED_TERMINAL_REASON` added to
  `INTERRUPT_TERMINAL_REASONS` with a regression test proving the shared
  `stream_aborted` marker classifies as interrupted **only** when an
  operator flag is actually set (the coordinator's specific ask for this
  shared-file edit).
- `packages/providers/src/index.ts` — exports `CODEX_CAPABILITIES` (mirrors
  the existing `GROK_CAPABILITIES` export), needed for the new dag-executor
  test fixture.

Full-package runs (`bun run test`, never raw `bun test` — see this repo's
own mock-isolation note): `packages/providers` 0 fail across every one of its
~80 per-file invocations; `packages/workflows` 0 fail across all 30. Both
package `bun x tsc --noEmit` clean. `bun x eslint` clean (`--max-warnings 0`)
on every file this phase touched.

## Validate

`bun run check:bundled`, `check:bundled-skill`, `check:bundled-schema`,
`check:pi-vendor-map`, and `check:capability-matrix` all pass.

`bun run validate`'s chained `type-check` step stops on a **pre-existing,
cross-phase** `@archon/web` failure unrelated to this phase:
`ComposerDock.tsx` / `ConsoleComposerDock.tsx` (and their test fixtures)
don't yet match the widened durable-steering wire contract (`queued[].state`
growing from two values to seven, `operator_user_id` becoming required).
This is the exact break Phase B's own report flagged as needing "whichever
agent owns `packages/web/src/**` node-room UI" — still unresolved, not
introduced or touched by this phase (confirmed via `git log` on both files;
last touch predates this worktree). Because `validate`'s steps are chained
with `&&`, that failure prevented the automated run from reaching
lint/format/test, so each was run standalone to confirm this phase's actual
state:

- `bun x tsc --noEmit -p .` — clean in both `packages/providers` and
  `packages/workflows` (the only packages this phase's source changes
  touch).
- `bun run lint --max-warnings 0` (whole repo) — clean.
- `bun run format:check` (whole repo) — clean (after formatting this
  report itself).
- `bun run test` (whole repo, `bun --filter '*' --parallel test`) — 0
  failures across every package.

## Manual verification cleanup

Isolated server (port 3325) and web dev server (port 5195) were both started
and stopped by this session only; both were confirmed killed before writing
this report. Scratch `ARCHON_HOME`, the throwaway git repo, and the
standalone verification script all live under the session scratchpad —
nothing was written to the real `~/.archon/archon.db`. The two temporary
test workflow files (`codex-stop-test.yaml`, `codex-file-change-test.yaml`,
`deepseek-stop-test.yaml`, `deepseek-stop-test-gen.yaml`) exist only inside
the scratch repo, never inside this actual worktree/repo.

## Unresolved / needs orchestrator attention

- The Codex mid-generation live-Stop attempt hit a workflow-discovery
  staleness artifact specific to this scratch setup's `file://` self-remote
  and ended up re-exercising the mid-tool case a second time instead. Not a
  product bug (the underlying code path is provider-shape-agnostic — see
  Story 8.4 above for why unit coverage closes this gap) but flagged in case
  a future live pass wants a cleaner mid-generation-only run.
- Codex's real ChatGPT-plan account needed an unusually forceful prompt to
  actually invoke its file-edit tool rather than claim "done" without doing
  the work — a model-behavior observation from this session's manual
  testing, not an Archon defect.
- 10.4's frontend half (the actual glyph-exclusion logic in
  `agent-history.ts`/`tool-presentation.ts`) is out of this phase's file
  ownership and unimplemented by this report; the backend guarantees it
  needs (provider-neutral `tool_outcome: 'interrupted'` persistence,
  `CODEX_CAPABILITIES.interrupt` as a capability-driven signal) are in place.

## Addendum (2026-09-27, after the interrupted-tool-status change)

The Codex live evidence above records a persisted `tool_outcome: 'interrupted'`
for the tool that was active at Stop. That value is now intentionally `unknown`
for Codex. The `interruptedToolStatus` provider capability is `false` for
Codex, because the Codex SDK never reports an interrupted status for a tool
call, and the executor settles still-open tools as `unknown` for such
providers. This follows the newer Epic 10 Story 10.4 rule, which supersedes the
Story 8.4 wording "the persisted tool row becomes interrupted". The turn-level
interruption and same-thread continuation evidence for Codex is unchanged.
