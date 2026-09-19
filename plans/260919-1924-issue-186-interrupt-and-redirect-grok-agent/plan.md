---
title: 'Issue 186 interrupt and redirect a running Grok agent'
description: 'Implementation-ready plan for Agent Node Room Story 2.6: stream-abort the active Grok turn without cancelling the node, keep the Grok session resumable, and continue on that session with the queued guidance on Send now.'
status: pending
priority: P1
effort: '4 phases'
issue: 'https://github.com/kevinle128/Archon/issues/186'
branch: archon/thread-e5318172
tags: [issue-186, agent-node-room, providers, workflows, grok, tdd, deep]
blockedBy: []
blocks: []
created: 2026-09-20
---

# Issue 186: interrupt and redirect a running Grok agent

## Goal and user outcome

An operator watching a live Grok-backed node can press `Stop`, see the current Grok turn end, and press `Send now` to continue the same Grok session with the queued guidance followed by the new message. The workflow node stays `running`, no `dag_node_failed` is written, the interrupted tool call renders `⚠ interrupted`, and node Cancel keeps its existing behaviour.

The successful flow is:

1. `Stop` aborts the fresh per-turn `interruptSignal` the executor already hands to interrupt-capable providers (#183 / #214). The Grok provider terminates its `grok --single` subprocess, keeps the session id, and yields one abort-marked terminal `result`.
2. The existing executor classification (five-case rule, `dag-executor.ts:452-483`) reads the abort marker plus the operator-interrupt flag, settles the in-flight tool as `interrupted`, writes one `interrupted` status row, and enters `idle-after-interrupt` on the same session id — no executor logic change is expected for this story.
3. The existing dock (both shells) shows `Send now`; the route, registry, and UI are provider-blind and already shipped for Claude.
4. `Send now` drains queued receipts plus the new message as the next `grok --single … --resume <sessionId>` turn.

This story is **interrupt-then-continue only**. Hook-based soft-inject (`pre_tool_use`) stays gated by G3 and is not built here.

## Authority and resolved conflicts

Authority order for this story:

1. Issue #186 and Story 2.6 acceptance criteria in `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md` (lines 585-609).
2. `_bmad-output/specs/spec-agent-node-room/provider-steering-matrix.md` (Grok row: stream-abort; `x.ai/interject` unreachable), `engine-integration.md`, and `steering-test-plan.md` ("grok — stream-abort; fixture pins its abort terminal shape").
3. The shipped #183 contract in source: `packages/providers/src/types.ts` (`interruptSignal`, `ProviderCapabilities.interrupt`, `result.terminalReason`), `packages/workflows/src/dag-executor.ts`, `packages/workflows/src/steering-registry.ts`, and their tests.
4. The installed Grok CLI (`grok 1.0.34`) and its shipped docs (`~/.grok/docs/user-guide/14-headless-mode.md`, `17-sessions.md`).

Conflicts resolved explicitly:

- `provider-steering-matrix.md` and `engine-integration.md` describe stream-abort as riding "the executor's `AbortController`" / `AbortSignal.any(...)`. #183 shipped a **distinct** `interruptSignal` beside `abortSignal` (`types.ts:602-609`) and never combines them. This plan follows the shipped seam: Grok listens on `interruptSignal` separately; `abortSignal` (Cancel) is untouched.
- `INTERRUPT_TERMINAL_REASONS` in `dag-executor.ts:452-461` is documented as "the Claude SDK's two abort markers", yet e2e-fake already emits the same strings (`e2e-fake/provider.ts:511-533`). This plan treats `aborted_streaming` / `aborted_tools` as Archon's normalized cross-provider abort vocabulary and Grok emits them too; the comment is corrected in Phase 3. No Grok-specific reason string is added.
- Grok's session id is only observed on the `end` event (`grok/event-parser.ts:290-292`), and stream-abort kills the process that would emit it. Grok's docs say `-s/--session-id <UUID>` creates a new session with a caller-chosen id (`14-headless-mode.md:25`, verified: `--single … --session-id not-a-uuid` fails before any model call with "must be a valid UUID"). This plan pre-assigns the session id for interrupt-capable new turns so resumability never depends on a flushed `end` line. Whether a killed session is actually resumable is spike-gated in Phase 1.

## Scope

In scope:

- `GROK_CAPABILITIES.interrupt = 'stream-abort'` — the first declarer of the reserved value;
- Grok provider honours `interruptSignal`: SIGTERM (existing SIGKILL grace) on abort, outstanding tools settled `interrupted`, one abort-marked non-error `result` carrying the session id, Cancel still dominant;
- pre-assigned `--session-id` for interrupt-capable new and forked Grok turns;
- a real-CLI spike proving SIGTERM shape, exit code, and same-session resume after a mid-turn kill, with a sanitized report;
- Grok-shaped conformance scenarios in the #183 executor matrix for direct, AI loop, and loop-group body paths;
- capability matrix regeneration, docstring updates, sprint-status closeout.

Out of scope, owners preserved:

- hook-based soft-inject through Grok `pre_tool_use` (G3) and any ACP / `grok agent stdio` transport migration;
- new server routes, schema changes, dock or web changes (Story 2.3 shipped them provider-blind — Phase 3 proves they apply);
- Codex / OMP / DeepSeek interrupt (Stories 2.4, 2.5, 2.7);
- partial-spend capture from Grok's per-response `usage` lines on an interrupted turn (the parser ignores them today; spend is recorded only if Grok still emits `end`);
- the 30-minute idle expiry, keepalive, withdraw, cross-tab sync (Stories 2.2, 2.8-2.12);
- Playwright/E2E: the e2e-fake provider already exercises the interrupt branch end-to-end; Grok cannot run in CI.

## Repository evidence inspected

| Area | Evidence and verified implication |
| --- | --- |
| Product contract | Issue #186; Story 2.6 (`epics.md:585-609`); `provider-steering-matrix.md:19,51-57`; `steering-test-plan.md:33-41,75`. Stream-abort, same-session continue, `⚠` on the interrupted call, direct+loop parity, no node failure. |
| Grok provider | `packages/providers/src/grok/provider.ts` — `sendQuery` (line 264+) spawns `grok --single … --output-format streaming-json`, listens only on `abortSignal` (`onAbort → terminate()`, SIGTERM then SIGKILL after `TERMINATION_GRACE_MS = 5000`), throws `'Query aborted'` after stream end when Cancel fired, then routes late I/O / protocol / non-zero exit into `isError` results. `buildGrokArgs` (line 110) already emits `--resume` / `--fork-session`; no `--session-id`. |
| Grok parser | `packages/providers/src/grok/event-parser.ts` — `closeOutstandingTools()` (line 97) hard-codes `toolOutcome: 'unknown'`; `buildResult()` (line 113) returns `grok_incomplete_output` when no `end` was seen; `sessionId` is set only by `consumeEnd` (line 290-292). |
| Grok CLI | `grok 1.0.34` installed at `~/.grok/bin/grok`, logged in. `14-headless-mode.md`: `end` is always last, `end.stopReason` includes `cancelled`; on SIGTERM "session state saved up to the last completed tool call", exit code 143; resume with `--resume <id>`. `-s/--session-id` creates a new session (UUID required; with `--resume` only alongside `--fork-session`). Session dirs live at `~/.grok/sessions/<encoded-cwd>/<id>/`; the docs (`17-sessions.md:27-36`) name `updates.jsonl` as the authoritative log that drives resume, while a local session created by `grok 1.0.30` showed `summary.json`, `chat_history.jsonl`, `events.jsonl` — the spike records the layout the pinned 1.0.34 actually writes. Grok's sandbox is off by default (`18-sandbox.md:5`); the provider never passes `--sandbox`. |
| Contract layer | `packages/providers/src/types.ts:602-609` (`interruptSignal`), `:839-847` (`interrupt: 'native' \| 'stream-abort' \| false`, docstring still says stream-abort is "reserved; no provider declares it yet"), `result.terminalReason`. |
| Engine | `dag-executor.ts:3196-3205` and `:5964-5973` gate everything on `interrupt !== false`, so `'stream-abort'` is already interruptible. Classification: `:452-483` (markers + abort-like throws), direct result path `:2684-2777`, throw path `:3099-3133`, idle entry `:3482-3511` (`interruptedSessionId = newSessionId ?? turnResumeId`, explicit failure when neither exists); loop path `:6319-6325`, `:6407-6421`, `:7065-7102`. Tool results forwarded with `toolOutcome` (`:2639-2664`), so a provider-emitted `interrupted` tool_result becomes the `⚠` row. |
| Registry | `steering-registry.ts` has no `=== 'native'` branch; `interruptible` is a boolean option. |
| Existing tests | `dag-executor.test.ts:27068-27800` — 19 #183 scenarios with a mocked provider (`getType: () => 'claude'`); helpers `liveHandle`, `awaitIdle`, `sendNow`, `toolCompletedOutcomes`, `transcriptStates`. `grok/provider.test.ts` — fake `GrokSpawner` with `processFor()` (stdout closes immediately; `kill` is a no-op). `registry.test.ts:190-201` — total axis check plus "only Claude advertises native interrupt" (still true). |
| Docs/generation | `scripts/generate-capability-matrix.ts:70,153` renders the Interrupt row; `provider-capabilities.md:60` currently shows ❌ for grok. `bun run check:capability-matrix` fails on drift. |

## Technical decisions

### D1 — Stream-abort through the shipped `interruptSignal`, Cancel untouched

The Grok provider attaches a second listener for `requestOptions.interruptSignal`. On abort while the process is still alive it records `interruptedInFlight = true` and calls the existing `terminate()` (SIGTERM, SIGKILL after 5 s). The `abortSignal` listener and the post-stream `if (abortSignal?.aborted) throw new Error('Query aborted')` check stay byte-for-byte, and that check runs **before** the interrupt branch so a co-firing Cancel wins (five-case rule, case 5). A spent `interruptSignal` at entry throws `'Query interrupted'` before spawning, mirroring Claude (`claude/provider.ts:1730`).

If the interrupt signal fires after the process already exited, the turn ended naturally: no abort marker is emitted (case 1 — a natural result even when Stop raced it).

### D2 — One abort-marked, non-error terminal result

After the stream closes on an in-flight interrupt, the provider yields, in order:

1. `closeOutstandingTools('interrupted')` — each still-open tool becomes a `tool_result` with `toolOutcome: 'interrupted'` (this is what the reader fold renders as `⚠`); the parser's default outcome stays `'unknown'` for every other path.
2. One `result` with `terminalReason: 'aborted_tools'` when a tool was open at the kill, else `'aborted_streaming'`; `sessionId` (D3); `resumed` as today; any spend the parser captured if Grok did flush an `end`; **no** `isError`/`errorSubtype`. The interrupt branch returns before the late-I/O, protocol-error, and non-zero-exit branches so exit 143 (or a stdout read error after kill) is never reported as `grok_exit_nonzero` / a genuine failure.

The existing unconditional `closeOutstandingTools()` call (`provider.ts:352-354`) must become the single outcome-parameterised call above, or the map is already emptied as `unknown` before the interrupt branch runs and no `⚠` row is ever written.

The parser gains `buildInterruptedResult(sessionId, terminalReason, resumed)` beside `buildResult` so the interrupted shape never inherits `grok_incomplete_output`.

### D3 — Pre-assigned session id for interrupt-capable turns

When `interruptSignal` is present and the call starts a new session (no `resumeSessionId`) or forks (`forkSession: true`), `buildGrokArgs` adds `--session-id <crypto.randomUUID()>`. Calls without `interruptSignal` (direct chat, non-steering callers) keep today's argv exactly. Note the real blast radius: because the executor attaches `interruptSignal` on every pass of an interruptible provider, every new Grok **workflow-node** session gets an Archon-minted id once the capability flips — not only interrupted turns. Session ids are opaque strings everywhere in Archon, so this is a provenance change, not a contract change. The interrupted result's `sessionId` is `parser.getSessionId() ?? preAssignedSessionId ?? resumeSessionId`; when `end` did arrive its id must equal the pre-assigned one (asserted in tests, verified by the spike). The provider never invents an id outside this rule; if none exists the executor's existing explicit failure applies.

### D4 — Spike-gated, three outcomes

Phase 1 runs a real `grok` spike (no CI) and records a sanitized report. Outcomes:

- **A** — SIGTERM mid-turn flushes `end` (`stopReason: 'cancelled'`, session id) before exit 143 and `--resume <id>` continues: proceed; D2 keeps the flushed spend.
- **B** — no `end` on SIGTERM but `--resume <pre-assigned id>` continues with prior context: proceed; D3 is the id source.
- **C** — a session killed mid-turn is not resumable (resume errors or starts empty): **blocker**. Stop, record evidence, do not fabricate an id, do not downgrade to Cancel, do not fall back to a fresh session. If only a kill *before the first completed tool call* is unresumable (docs: "saved up to the last completed tool call"), proceed with an explicit provider error naming that limitation on the redirect turn and record it as a known limitation in the report and plan.

### D5 — Executor and registry unchanged; conformance proves it

No branch, marker, or option is added to the executor for Grok. Phase 3 adds Grok-shaped scenarios to the existing #183 matrix (`getType: () => 'grok'`, `GROK_CAPABILITIES`, mocked `sendQuery` yielding the D2 shape) for the direct, AI-loop, and loop-group-body paths and asserts the shared contract: one `interrupted` status row, `tool_completed.tool_outcome === 'interrupted'`, no `node_failed`, redirect on the same session id with `forkSession: false`, queued + new guidance joined in receipt order. The only executor edit is the comment on `INTERRUPT_TERMINAL_REASONS` and the `terminalReason` docstring, which must stop claiming the vocabulary is Claude-only.

### D6 — Tests first, fake spawner extended

Provider tests use the existing fake `GrokSpawner`, extended with a controllable process whose stdout stays open until `kill()` is invoked and whose `exited` then resolves (143 for the SIGTERM path, and a variant where `end` is flushed before close). Every new behaviour is written as a failing test first (`--tdd`), and the regression set (existing `grok/provider.test.ts`, `event-parser.test.ts`, `registry.test.ts`) must stay green throughout.

## Phases

Deep mode: Phase 1 is fully detailed. Phases 2-4 are outlined with real file paths, test matrices, and verification commands; each gets a dedicated scout pass before execution (`/ak:cook` runs it), and Phase 2 must not start until the Phase 1 gate reports outcome A or B.

| # | Phase | Depends on |
| --- | --- | --- |
| 1 | [Grok stream-abort spike gate](./phase-01-grok-stream-abort-spike-gate.md) | — |
| 2 | [Grok provider stream-abort seam](./phase-02-grok-provider-stream-abort-seam.md) | 1 (outcome A or B) |
| 3 | [Engine conformance: direct, loop, loop-group](./phase-03-engine-conformance-direct-loop-loop-group.md) | 2 |
| 4 | [Capability matrix, docs, and closeout](./phase-04-capability-matrix-docs-and-closeout.md) | 1-3 |

## Acceptance criteria

- [ ] AC1 (Story: Stop) — With Grok generating, aborting the per-turn `interruptSignal` terminates only the current `grok` subprocess; the node stays `running`, `abortSignal` is never aborted by the provider, and the handle projects `idle-after-interrupt`.
- [ ] AC2 (Story: Send now) — After `send_now`, the next Grok call receives `resumeSessionId` equal to the interrupted turn's session id, `forkSession: false`, and a prompt of the queued messages then the new message joined by `\n\n` in receipt order.
- [ ] AC3 (Story: `⚠`) — A tool open at the kill produces exactly one `tool_completed` row with `tool_outcome: 'interrupted'` and no duplicate `unknown` row; the interrupted status row count is exactly one.
- [ ] AC4 (Story: direct + loop parity) — Grok-shaped scenarios pass for a direct AI node, an AI loop node (idles inside the iteration, Send now does not consume an iteration), and a provider-calling loop-group body node (namespaced step name) with no `node_failed` and no `dag_node_failed`.
- [ ] AC5 (Story: G3 boundary) — No hook, `pre_tool_use`, or ACP code is introduced; `GROK_CAPABILITIES.hooks` stays `false`.
- [ ] AC6 (Cancel dominance) — Cancel and Stop firing on the same turn still throw `'Query aborted'` and take the existing Cancel failure path; a Stop that lands after the process exited naturally yields an unmarked result.
- [ ] AC7 (No regression) — Calls without `interruptSignal` build byte-identical argv and behave exactly as before; all existing Grok, registry, observability, and #183 executor tests pass unchanged except for the corrected comments.
- [ ] AC8 (Evidence) — `reports/grok-interrupt-resume-spike.md` records the sanitized spike outcome (A or B) against `grok 1.0.34`; `provider-capabilities.md` shows `stream-abort` for grok; `bun run check:capability-matrix` and `bun run validate` pass; `sprint-status.yaml` entry `2-6-interrupt-and-redirect-a-running-grok-agent` is moved to `done` last.

## Compatibility, operations, and rollback

- Additive only: one capability value, one optional argv flag gated on `interruptSignal`, one parser method, one parser parameter. No schema, route, or UI change.
- Pre-assigned session ids are fresh UUIDs; Grok rejects a duplicate id under the same session directory, which surfaces as an ordinary provider error rather than silent reuse.
- A stream-abort leaves the worktree exactly as Grok's own SIGTERM would ("file modifications by tools are not rolled back") — the same hazard the existing Cancel path already has; the dock's written-work disclosure (Story 2.3) already states it.
- Rollback: revert `capabilities.ts` to `interrupt: false` and the executor stops handing Grok an `interruptSignal`; the provider code then never enters the interrupt branch. No data rollback.

## Red Team Review

### Session — 2026-09-20
**Findings:** 13 (10 accepted, 1 accepted-modified, 2 rejected)
**Severity breakdown:** 3 Critical (all the same defect), 6 High, 4 Medium

| # | Finding | Severity | Disposition | Applied To |
|---|---------|----------|-------------|------------|
| 1 | Existing unconditional `closeOutstandingTools()` (`provider.ts:352-354`) empties the tool map before the interrupt branch — no `⚠` row (raised by all three reviewers and the advisor) | Critical | Accept | Phase 2 step 3, D2 |
| 2 | T15 session-id mismatch had no implementation spec | High | Accept | Phase 2 step 3b |
| 3 | 5 s grace tuned for Cancel; truncated persist not attributable | High | Accept | Phase 2 steps 3c, 4; T17 |
| 4 | Capability flip pre-assigns ids for every Grok workflow session, not only interrupted turns | Medium | Accept | D3, Phase 2 risks |
| 5 | Loop-group token scoping asserted, not cited | Medium | Reject — `dag-executor.test.ts:27781` already proves namespaced parking; G8 mirrors it | — |
| 6 | Killed `grok` may orphan tool children (`container-spawn.ts:99-119` precedent) | High | Accept | Phase 1 E7, Phase 2 step 3d, T16 |
| 7 | Spike isolation overstated — sandbox off by default, `--cwd` is no boundary | High | Accept | Phase 1 experiments + security |
| 8 | Session dir layout cited `events.jsonl`; docs name `updates.jsonl` | Medium | Accept (modified) — local 1.0.30 session did contain `events.jsonl`; plan now records both and defers to the spike | plan.md evidence |
| 9 | `onInterrupt` snippet contradicted the "no `end` consumed" prose | High | Accept | Phase 2 step 3 |
| 10 | E7 remediation not carried into Phase 2 | High | Accept (already added as step 3d; T16 added) | Phase 2 |
| 11 | No spike experiment for a Stop before any event | High | Accept | Phase 1 E8, C-partial |
| 12 | Grace widening was discretionary prose | Medium | Accept | Phase 2 step 4, Todo, T17 |
| 13 | e2e-fake marks interrupted results `isError: true`; Grok shape does not | Medium | Reject — executor's marker check wins over `isError` (`dag-executor.test.ts:27269`); the non-error shape is deliberate (D2) | — |

### Whole-Plan Consistency Sweep
Re-read all five files after applying: experiment ranges updated to E1-E8, test ranges to T1-T17, C-partial covers E3 and E8, D2/D3 and Phase 2 agree on the single outcome-parameterised close and on the `getSessionId() === undefined` gate. No contradictions remain.

## Gates pending

- The validation interview (`/ak:plan validate <this dir>`), task hydration, and the journal entry did not run in the planning session; run validate before Phase 2 starts.
- Cited line numbers were fact-checked against the worktree at planning time (`provider.ts`, `event-parser.ts`, `dag-executor.ts`).

## Validation sequence

Run the focused commands in each phase, then:

```bash
cd packages/providers && bun test src/grok/event-parser.test.ts && bun test src/grok/provider.test.ts && bun test src/registry.test.ts && bun test src/observability.test.ts
cd packages/workflows && bun test src/dag-executor.test.ts -t 'interrupt'
bun run generate:capability-matrix && bun run check:capability-matrix
bun run validate
```

Never run root `bun test`. Do not move `sprint-status.yaml` to `done` before Phase 4's evidence list is complete.

<!-- slug: issue-186-interrupt-and-redirect-grok-agent -->
