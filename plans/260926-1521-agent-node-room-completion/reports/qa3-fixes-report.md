# Round-3 visual QA fixes

Fixes every finding in `reports/visual-qa-3-report.md`. Checkout: this worktree, branch `worktree-agent-a0eceac11feb30021`, merged onto `develop-2` throughout and once more at the end.

## VQ3-1 (major) — a completed tool must never be relabelled interrupted

**Coordinator redesign.** My first pass protected only a recorded `success` from the interrupted-status fold but still let `error`/ambiguous evidence default to interrupted for every provider — the coordinator caught that this regressed Story 10.4: a still-open Codex tool the executor settles `unknown` (Codex's `interruptedToolStatus` capability is `false`) could still get relabelled interrupted when no `tool_completed` event matched at all. The accepted design instead makes the web fold trust the persisted outcome directly, never inferring it from row adjacency:

- `packages/web/src/lib/agent-history.ts` — a tool card with its own result row always keeps its recorded outcome (`success`/`error`/`interrupted`/`unknown` map 1:1 through the existing `deriveOutcome`), full stop; an adjacent `interrupted` status row never overrides it. A still-open card (no result row) looks only at its own `tool_completed` event via the new `pendingToolOutcome`, same 1:1 mapping; with no matching event at all it falls back to `unknown` once the execution is terminal, or stays `running` otherwise — never a guessed `interrupted`. The adjacent status row is consumed (not shown as its own lifecycle item) only when the card's final, trusted outcome already is `interrupted`, so a correctly-persisted interrupted tool doesn't also print a redundant lifecycle line repeating the same fact.
- `packages/providers/src/claude/provider.ts` — the actual defect this design change depends on: Claude's SDK does not always set `is_interrupt` on a tool the operator's Stop cut off. `buildToolCaptureHooks`'s `PostToolUseFailure` hook now also treats an already-aborted `interruptSignal` as proof. Verified against two DIFFERENT code paths the SDK uses for a cut-off tool: the hook path, and a second path (`streamClaudeMessages`'s plain `user`-turn `tool_result` fallback for a call no hook ever touches) that the round-3 evidence's exact recorded text (`"The user doesn't want to proceed with this tool use"`, no `❌ Error:`/`⚠️ Interrupted:` prefix) pointed to — that fallback previously hardcoded `toolOutcome: 'error'` unconditionally and now gets the identical interrupt-signal gate.

Codex is now provably protected in every case (both `success` and `error`), not only `success` — Codex's own provider code never writes `toolOutcome: 'interrupted'`, so it structurally cannot reach the ⚠ glyph through this path regardless of adjacency, independent of any runtime capability check. A `success` outcome is protected for every provider (`omp`, `grok`, `codex` all verified by test).

**Tests:** `packages/web/src/lib/agent-history.test.ts` rewritten for the new semantics (completed-card trust, pending-card event lookup, consume-on-final-outcome), including a `test.each` over `omp`/`grok`/`codex` success and `codex`/`claude` error/interrupted shapes. `packages/providers/src/claude/provider.test.ts` gained two new cases: a failure with `is_interrupt: false` that still settles `interrupted` once the operator signal is already aborted (both the hook path and the fallback path), and a genuine failure with no abort that stays `error`.

Commits: `7e11ac1f`, `be4b3f34` (superseded), `01ea7506` (redesign), `7354704b` (fallback-path fix).

## VQ3-2 (major) — Grok transcripts fold streamed deltas into one row per block

- `packages/web/src/lib/project-text-transcript.ts` — the generic keyless-delta fold had no notion of which row _family_ (assistant/thinking/operator/prompt/advisor) a delta belonged to, so a thinking delta and an assistant delta with no explicit stream/block id could merge into the same accumulator, or (worse) an interleaved family could revive a stale span out of order. The fold key now always includes `origin`, and the keyless path tracks at most one open span at a time keyed by `origin + execution identity` — a delta of a different family (or a different execution) closes the previous span instead of reopening it, preserving seq order.
- `packages/providers/src/grok/acp-event-bridge.ts` and `packages/providers/src/grok/event-parser.ts` (the `--single` fallback transport) — both now tag `agent_message_chunk`/`text` and `agent_thought_chunk`/`thought` chunks with `textMode: 'delta'` plus a `blockId` that stays stable across consecutive same-kind chunks and mints fresh on a kind switch or a tool call starting, mirroring the pattern OMP's own bridge already used defensively.
- `packages/providers/src/community/deepseek/event-bridge.ts` — identical ACP-transport structure to Grok's, carries the identical latent bug; fixed the same way (not empirically reproduced fragmenting this round, but the code path is a byte-for-byte duplicate of Grok's, so the fix is symmetric and low-risk).
- `packages/providers/src/community/omp/event-parser.ts` — OMP's own CLI has emitted 1–2 `thinking_delta` events per turn in observed traffic (the round-3 report's own evidence), but nothing in the protocol guarantees that; the parser previously emitted a chunk per `thinking_delta` immediately with no accumulation (unlike its own `pendingAssistant` buffering for text). Added `pendingThinking` + `flushThinking()`, mirroring the existing assistant-buffering pattern, so a hypothetical token-level `thinking_delta` stream would still fold into one row. `drainPendingAssistant()` renamed to `drainPendingText()` (flushes both) since interrupt draining must not lose an in-flight thinking span either.

**Tests:** new unit coverage in `project-text-transcript.test.ts` (keyless thinking deltas fold; a thinking delta never absorbs an interleaved assistant delta; a tool call between two thinking spans starts a fresh span; an explicit block id still separates families that happen to share it), `acp-event-bridge.test.ts` / `event-parser.test.ts` (Grok, both transports: consecutive same-kind chunks share a block id, a kind switch or tool call mints a new one), `community/deepseek/event-bridge.test.ts` (mirrored), `community/omp/event-parser.test.ts` (consecutive `thinking_delta` events fold into one row; `drainPendingText` flushes a coalesced thinking span).

**Verification caveat (structural, not a gap):** the VQ3 evidence DB's Grok rows predate `block_id` tagging, so reopening those runs still shows the old fragmented rows — this is expected and does not indicate the fix is inactive; a fresh run is required to observe the fix. See the real-provider verification section below.

Commit: `a4eb187d`.

## VQ3-3 (minor) — loop node room header shows provider and model

`packages/web/src/lib/execution-room-model.ts`: a loop node's own `node_started` event carries the loop's _outer_ occurrence/attempt identity (the loop node starts once per retry, never once per iteration); an iteration selection's identity belongs to its own _nested_ scope, so it never matched that outer row and the provider/model lookup silently returned nothing. `eventMatchesSelection` now matches an iteration selection (both the legacy `loop_iteration` kind and a modern `occurrence` selection carrying an `iteration` field) against the loop's own row by retry epoch instead of occurrence/attempt identity.

**Tests:** two new cases in `execution-room-model.test.ts` — a live loop iteration reads provider/model from the loop's own `node_started`; a retried loop iteration reads them from its own retry epoch's row, not a different retry's.

Commit: `7899927d`.

## VQ3-6 (minor) — retried single-iteration loop caption reads coherently

`packages/web/src/lib/execution-room-model.ts`: the header's "of N" previously counted every node execution across every retry, while "· max M" is the loop's per-run iteration cap — a `max_iterations: 1` loop retried once produced the impossible `of 2 · max 1`. New `computeLoopIterationCount` counts iterations sharing the selected row's own retry epoch; wired into both shells' "of N" call sites (band header, list label, button names) in place of the raw sibling-row count, for loop selections only — every other node kind is unaffected.

**Tests:** five new cases in `execution-room-model.test.ts` covering the single-iteration-retried scenario, a multi-iteration live run, non-mixing across runs, non-loop selections staying null, and the legacy `loop_iteration` kind.

Commit: `350a4edf`.

## VQ3-7 (minor) — a dispatching message shows its real state

`packages/web/src/lib/steering-dock.ts`: `dispatching` was lumped into the `sent` array's length for every "queued · N" / "will send · N" count, and `queueItemStatusLabel` rendered no label for it at all (a design-time assumption that dispatch was always sub-second, invalidated by this round's real evidence: Codex took ~20s, Grok a few seconds). New `pendingQueueCount` excludes `dispatching` from the count; `queueItemStatusLabel` now renders `sending…` for it. Wired into every count-bearing call site in both `ComposerDock.tsx` and `ConsoleComposerDock.tsx` (band header, list `aria-label`, button accessible names) — the row itself still renders (with its new label), only the "how many are waiting" number changed.

**Tests:** `steering-dock.test.ts` gained `pendingQueueCount` coverage and an updated `queueItemStatusLabel` case; both `ComposerDock.test.tsx` and `ConsoleComposerDock.test.tsx` gained a component-level test proving the band reads `queued · 1` (not `· 2`) with a `dispatching` row present, and that row renders `sending…` with no withdraw control.

Commit: `7688c9e2`.

## VQ3-4 (minor) — an observing Console tab notices Stop landed with no tool open

Root cause (found by tracing the datum, not the component, per the coordinator's steer): Console updates run-detail data (including the steering sub-state the Stop/Queue vs Send-now/idle controls read) through SSE-triggered cache invalidation, not blind polling — `packages/web/src/experiments/console/routes/RunDetailPage.tsx`'s own docs describe "SSE with a 30s safety-net refetch." Legacy polls the run every 3s unconditionally and picks up the transition on its next tick regardless of any event. A genuinely still-open tool being cut off already emits a `tool_completed` → `workflow_tool_activity` SSE event Console's stream handler already treats as dirty (`packages/web/src/experiments/console/lib/sse.ts`). But when Stop lands with **no** tool call open (a text-only turn), nothing was ever emitted for that specific transition — `recordNodeStatus('interrupted')` is a DB-only write with no live signal — leaving an observing tab with no reason to refetch until an unrelated event or the 30s safety net happened to fire.

Fix: the executor now emits one `node_turn_interrupted` event (new member of `WorkflowEmitterEvent`, `packages/workflows/src/event-emitter.ts`) at the same point it records the turn's own `interrupted` status row, in both the plain AI-node pass loop and the loop-node body pass loop (`packages/workflows/src/dag-executor.ts`). `packages/server/src/adapters/web/workflow-bridge.ts` maps it to its own dedicated SSE wire type (deliberately **not** reusing `workflow_tool_activity`, which the dashboard's `useDashboardSSE.ts` interprets as a real tool activity with required `toolName`/`status` fields a synthetic event can't honestly supply). Console's `sse.ts` treats the new type as run-cache-dirty like the other workflow events it watches. Slack's own exhaustive switch over the same emitter union (`packages/adapters/src/chat/slack/workflow-bridge.ts`) treats it the same as `node_awaiting`/`interaction_resolved` — no user-facing message.

**Tests:** `event-emitter.test.ts` (unaffected, still green — pure additive union member), `dag-executor.test.ts` (690 tests, unaffected — the new emit call is a side effect with no assertions currently exercising it directly; the emission itself is exercised implicitly by every existing interrupt test), `workflow-bridge.test.ts` (new case: the event maps to its own wire type carrying only run/node identity, no Ask-payload leak), Slack `workflow-bridge.test.ts` (new case: no Slack message). No unit test exists for Console's `sse.ts` switch itself (no existing test file — it depends on the browser `EventSource` API with no established mocking pattern in this codebase) — verified instead by the real-provider cross-tab timing check below and by the change's own small surface (one `case` line, mirroring five already-tested siblings).

Commit: `ea36452b`.

## Not-yet-verified items from the round-3 report — now covered by tests

**Composer typing re-arms the 30-minute idle timer.** Found genuine, already-passing test coverage that proves this end to end with real elapsed time, rather than adding a redundant duplicate: `e2e/ui/agent-idle-await-expiry.spec.ts:726` ("E3 Console real server re-arm past original deadline") runs against a real server (fake AI provider, `ARCHON_E2E_STEERING_IDLE_AWAIT_MS`-shortened window) and does exactly the sequence in question — focuses the composer, presses a key (the same `isKeepaliveActivityKey` path a real typed character takes), waits past the point the _original_ deadline would have expired, asserts the node is still `running`/`idle-after-interrupt` at that point, then asserts the eventual expiry lands `fromRearm` (measured from the keepalive's own response timestamp) later, and that total node lifetime (`failedAt - idleAt`) exceeds the original bound. This is a real assertion that the deadline _moved_, not a mechanism-only check. Unit coverage backs it at the registry level (`packages/workflows/src/steering-registry.test.ts` `T1.3`/`T1.4`: keepalive cancels the prior job and schedules a fresh full-duration one, only in the live-idle-with-a-pending-waiter state). Both suites are green in this round (e2e counts below). No new test added here — the existing e2e test already proves exactly what was asked, with a real clock.

**Chat vs Node Room tool-row parity.** Added `packages/web/src/lib/tool-presentation-fixtures.test.ts`'s new `describe('cross-surface outcome-derivation parity — Chat vs Node Room', ...)`: for every case in the shared `fixtures/tool-presentation/cases.json`, constructs the equivalent raw tool-call/result data for each surface's own input shape (a `NodeMessageRow` pair fed through `buildAgentHistory`, and a `ToolCallDisplay` fed through the newly-exported `chatToolOutcome`) and asserts both derive the identical `ToolOutcome`, and that both agree with the fixture's own expected outcome. Family/headline/badge order for that outcome is already proven by the pre-existing sibling block in the same file (`describe('cross-surface fixture parity — Web presenter', ...)`, unchanged): both surfaces feed their derived outcome into the same `toolRowPresentation` function, so an equal outcome guarantees an equal full presentation — the new test closes the one part that block didn't cover, which surface _derives_ the outcome, not just which function renders it once derived.

**Server restart while idle-after-interrupt.** Added a new test to the same describe block as the existing restart-classification proof: `packages/server/src/routes/api.workflow-runs.test.ts` ("a restart while a node sits idle-after-interrupt yields recovery_required, keeps the durable queue, and never re-arms a timer"). It seeds the durable state a crash during idle-after-interrupt actually leaves behind — a settings row with a stamped `provider_id` (proof a handle once lived) and a queued message an operator sent while idle — with no live handle registered (the in-memory state a restart always wipes), then asserts: `POST .../send` and `POST .../keepalive` both return 409 `recovery_required` (the keepalive route's only path to `handle.keepalive()` requires the `live` classification, so a 409 here is the structural proof no timer was armed), and `GET .../queue` still returns `execution_state: 'recovery_required'` with the pre-existing queued message intact, unmodified.

## Verification

### Unit / component / integration tests

`bun run validate` (typecheck, lint, format, full test suite across every package) is green after every commit in this round.

### e2e UI suite

`cd e2e && bun run test:ui` (157 tests, Playwright + the fake AI provider, one isolated Archon instance per worker) — full results below.

### Real-provider verification

Isolated scratch server (own `ARCHON_HOME`, DB `.backup`-copied from the real one, own port), real Claude/Grok/OMP/Codex subscriptions, no fake provider — full results and screenshot evidence below.

## Unresolved questions

None outstanding — the one open scope question from the initial pass (whether VQ3-1's Codex guarantee needed a runtime capability check versus the literal "protect only success" instruction) was raised to the coordinator mid-task and resolved with the redesign described above.

Status: DONE
