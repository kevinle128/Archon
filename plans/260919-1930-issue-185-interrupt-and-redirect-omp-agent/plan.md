---
title: 'Issue 185 interrupt and redirect a running OMP agent'
description: 'Implementation-ready plan for Agent Node Room Story 2.5: stop the active OMP turn by aborting its process stream without cancelling the node, keep the session resumable, wait for Send now, then continue on the same OMP session.'
status: pending
priority: P1
effort: '3 phases'
issue: 'https://github.com/kevinle128/Archon/issues/185'
branch: archon/thread-9aa07a8e
tags: [issue-185, agent-node-room, providers, workflows, omp, tdd]
blockedBy: []
blocks: []
created: 2026-09-20
---

# Issue 185: interrupt and redirect a running OMP agent

## Goal and user outcome

An operator watching a live OMP-backed node can press `Stop`, see the current OMP turn end while the workflow node stays `running`, add a correction, and press `Send now` so the pending guidance runs as the next turn on the **same OMP session**. Story 2.3 (#183, shipped as #214) already built the registry, executor classification, idle-await, interrupt route, and both docks for Claude; this story makes OMP the first `stream-abort` provider to flow through that same machinery.

The successful flow is:

1. `Stop` aborts the fresh per-turn `interruptSignal`; the OMP provider terminates its child process (SIGTERM, existing SIGKILL grace) — never the node-level Cancel controller.
2. The provider drains any buffered partial assistant text, yields one abort-marked `result` carrying the real OMP session id and the usage observed so far, then returns.
3. The executor classifies the end as interrupted (five-case rule, case 2), settles still-open tool cards as `interrupted`, writes one `interrupted` status row, and enters `idle-after-interrupt` without emitting `dag_node_failed`.
4. `Send now` drains queued receipts plus the new message in written order and starts the next turn with `--resume <same session id>`; the dock returns to generating.

Mode: `--deep --tdd`. Phase 1 is planned in full; Phases 2 and 3 are outlined and each gets a dedicated scout pass before execution (see "Deep-mode execution note").

## Authority and resolved conflicts

Authority order for this story:

1. Issue #185 and Story 2.5 acceptance criteria in `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md` (lines 553–583).
2. Ratified companions in `_bmad-output/specs/spec-agent-node-room/`: `provider-steering-matrix.md`, `steering-test-plan.md`.
3. Current source and tests, above all the #214 executor/registry contract (commit `79ed773a` on `develop`; Story 2.3 is `done` in `sprint-status.yaml`, so this plan carries no open `blockedBy` edge).

Three conflicts are resolved explicitly:

- **"OMP reports `Query aborted`" vs. resumability.** Story 2.5 and `steering-test-plan.md` describe OMP's interrupt as a thrown `Query aborted` (that is today's *Cancel* shape at `packages/providers/src/community/omp/provider.ts:317,450`). But a throw carries no session id: `sessionId` travels only on `type: 'result'` chunks (`packages/providers/src/types.ts:334`), the executor records it only there (`dag-executor.ts:2711`, `:6438`), and the OMP parser swallows the `session` header event (`event-parser.ts:160-166` returns `[]`). A throw-only interrupt would therefore hit the explicit "returned no session id to resume" failure (`dag-executor.ts:3489-3495`) on every first-turn Stop. **Resolution:** the OMP interrupt end is *result-shaped* — one abort-marked `result` with the real session id and observed usage, then a clean return (executor case 2). The executor's case-3 recognition of `Query aborted` (`isAbortLikeStreamError`, `dag-executor.ts:476-484`) stays unchanged so the thrown shape remains classified if it ever occurs; the story's Given/Then is satisfied by the executor fixture in Phase 2. Do not add a trailing `throw new Error('Query aborted')` after the result to imitate the Claude SDK's accidental sequence.
- **Marker vocabulary.** `INTERRUPT_TERMINAL_REASONS` (`dag-executor.ts:456-459`) is documented as "the Claude SDK's two abort markers" (`aborted_streaming`, `aborted_tools`). OMP must not reuse them — that lies about provenance. **Resolution:** add one provider-neutral marker, `stream_aborted`, that a `stream-abort` provider sets from the fact that *its own* `interruptSignal` fired (deterministic), never inferred from OMP stdout. Fix the docstring.
- **Trap 1 in `provider-steering-matrix.md` (RPC vs ACP) does not apply.** Story 2.5 explicitly ships interrupt-then-continue only; mid-turn soft-inject (`steer`, `abort_and_prompt`) stays gated by G4. This story keeps `--mode json` and the argv prompt. No RPC/ACP mode work.

## Scope

In scope:

- `OMP_CAPABILITIES.interrupt: 'stream-abort'` — the first provider to declare the reserved value;
- the OMP provider honours `interruptSignal`: pre-aborted guard before spawn, SIGTERM→SIGKILL termination via the existing `terminate()` path, Cancel-dominant ordering after reap, one abort-marked result with session id + observed usage, listener cleanup in `finally`;
- `OmpEventParser.buildInterruptedResult()` — an interrupted turn is *expectedly* incomplete and must not be decorated `omp_incomplete_output`;
- a real-binary spike (`spike:interrupt:omp`) proving SIGTERM mid-turn keeps the session resumable, with a sanitized evidence report;
- executor: `stream_aborted` joins the marker set; OMP conformance fixtures in the direct, AI-loop, and loop-group-body paths;
- docs: regenerated capability matrix, OMP section of `ai-assistants.md`, stale `types.ts` docstrings;
- `sprint-status.yaml` → `done` at close.

Out of scope, owners preserved:

- RPC mode, `steer`, `set_steering_mode`, `abort_and_prompt`, delivery confirmation (G2/G4; `provider-steering-matrix.md`);
- Codex, Grok, DeepSeek interrupt (Stories 2.4, 2.6, 2.7);
- 30-minute idle expiry and keepalive (Story 2.12), operator transcript rows and `NEVER SENT` reconciliation (2.8, 2.11);
- **web and server code.** Verified: the executor gates on `interrupt !== false` (`dag-executor.ts:3196`, `:5964`); the route joins `registry.get(...).snapshot().subState` with no capability branch (`packages/server/src/routes/api.ts:283-296`); the dock derives `queue-only | generating | interrupting | idle` from the projected sub-state alone (`packages/web/src/lib/steering-dock.ts:116-124`). Flipping the capability alone makes the OMP handle interruptible, projects `steeringSubState`, and shows `Stop`. The only `=== 'native'` check in the tree is `registry.test.ts:200`.
- Playwright. The AC's "conformance fixture" is the per-provider unit fixture named in `steering-test-plan.md` §"Providers — interrupt conformance"; the e2e-fake already exercises the dock flow end to end.

## Repository evidence inspected

| Area | Evidence and verified implication |
| --- | --- |
| Product contract | Issue #185; Story 2.5 (`epics.md:553-583`); `provider-steering-matrix.md` (omp row: stream-abort; traps 1–2 are soft-inject-only); `steering-test-plan.md` (omp fixture routes the abort to idle-await, not `dag_node_failed`). |
| OMP binary | `/Users/agent/.bun/bin/omp` v18.1.21 is installed and configured (`~/.omp/agent/`, sessions under `~/.omp/agent/sessions/<cwd-slug>/`). `plans/reports/scoutcli-260912-midturn-cli-providers.md` §1.6 reports (from *source*, v18.1.16) that SIGINT/SIGTERM/SIGHUP share the keypress teardown that disposes and persists the session. Measured behaviour on 18.1.21 is the Phase 1 gate. |
| Provider | `omp/provider.ts`: one-shot `--mode json` child; `abortSignal` listener at `:426`; reap at `:446`; Cancel throw at `:450`; `lateIoError`/`protocolError`/non-zero-exit branches at `:455-513` would otherwise decorate a SIGTERM'd child as `omp_transport_error`/`omp_exit_nonzero`; `finally` at `:517`. `event-parser.ts`: `session` header stored privately (`:160-166`); `buildResult` marks any open tool/message as `omp_incomplete_output` (`:78-104`) and treats `stopReason === 'aborted'` as an error. |
| Provider tests | `omp/provider.test.ts` has a fake spawner with `makeRunningProcess(exitOn, stdoutFailure?)`, `makeSpawner`, `collect`, `waitFor` (`:200-230`) and Cancel tests at `:526-561` (pre-aborted, SIGTERM→SIGKILL, stdout rejection) to mirror. |
| Types | `types.ts:602-609` says only `'native'` providers use `interruptSignal`; `:843-844` says `'stream-abort'` is "reserved; no provider declares it yet"; `result.terminalReason` (`:351-356`) documents Claude vocabulary only. |
| Engine | `dag-executor.ts`: marker set `:452-464`; abort-like throw helper `:466-484`; direct path result classification `:2684-2777`, catch `:3096-3126`, idle entry `:3477-3511`; loop path `:6407-6514`, `:6784-6800`, `:7060-7102`; capability gate `:3196`, `:5964`. The executor never branches on `'native'` vs `'stream-abort'`. |
| Engine tests | `dag-executor.test.ts:27068-27800` — the #183 matrix (19 scenarios). `invokeDag` takes `assistant: 'claude' \| 'pi'` and `minimalConfig` lists `{ claude: {}, codex: {} }`; `registerOmpProvider()` is already called at `:84`, so `getProviderCapabilities('omp')` resolves the real constant; `deps.getAgentProvider` is mocked. |
| Registry tests | `registry.test.ts:190-204`: totality test accepts `'stream-abort'`; "only Claude advertises native interrupt" filters on `=== 'native'` and stays true. |
| Docs | `scripts/generate-capability-matrix.ts:153-155` already renders `**stream-abort**`; `provider-capabilities.md` legend at `:80-83`; OMP section of `ai-assistants.md:389-478` has no steering note. |

## Technical decisions

### D1 — OMP interrupt is a process stream-abort, Cancel-dominant

`interruptSignal` abort calls the existing `terminate()` (SIGTERM, then SIGKILL after `TERMINATION_GRACE_MS`). `terminate()` stays a single no-argument closure shared by Cancel, Stop, and the I/O-failure handlers; if the spike's Adjust branch fires, the ONE grace constant is raised for every cause (Cancel included) — Cancel dominance is a classification property, not a termination-timing one, and a dual-grace design cannot be expressed on the shared first-caller-wins `killTimer` guard (red team F3/A4). After `Promise.all([exit, stderr])` the checks run in this exact order: `abortSignal.aborted` → throw `Query aborted` (case 5, unchanged); `interruptSignal.aborted` → yield the interrupted result and `return`; only then `lateIoError`, `protocolError`, non-zero exit. A SIGTERM'd child exits non-zero and may error stdout — those branches must not fire on an interrupted turn. The listener mirrors the Cancel listener (`{ once: true }`, removed in `finally`). A pre-aborted `interruptSignal` throws `Query interrupted` before spawn (the e2e-fake/Claude guard).

### D2 — Result-shaped interrupted end with a provider-neutral marker

The OMP parser coalesces `text_delta`s in `pendingAssistant` and releases them only on a later event (`event-parser.ts` `consumeMessageUpdate`/`flushAssistant`), so the provider must first yield `parser.drainPendingAssistant()` — a public wrapper over the private flush — or a mid-message Stop would drop the partial text the dock promises was not undone. Then `OmpEventParser.buildInterruptedResult(requestedSessionId)` returns the observed result (`sessionId`, tokens/cost/`usageBreakdown`/`resolvedModel` when seen) plus `terminalReason: 'stream_aborted'`, with no `isError`/`errorSubtype` — incompleteness is the expected state of an interrupted turn. When a resume was requested, `resumed` is `observedSessionId === requestedSessionId` (the existing `false` contract: "resume requested but the provider fell back to fresh"), not an unconditional `true` (red team A3). `INTERRUPT_TERMINAL_REASONS` gains `stream_aborted`.

Hidden-session usage enrichment (`maybeEnrichResult`) **runs** on the interrupted result. The child has already exited when it is called, the pre-spawn snapshot is valid, and the existing byte-delta path already warns-and-omits on a mid-record tail. Skipping it would lose the interrupted turn's advisor/subagent spend permanently, because the redirect turn's own pre-spawn snapshot then treats those bytes as history (red team F2). Primary-stream usage OMP has not yet reported at `message_end` time is not recoverable and is documented in Phase 3; the spike records whether OMP's teardown emits a final `message_end` with usage.

### D3 — No session id means an explicit failure, never a fresh session

If Stop lands before OMP prints its `session` header, the interrupted result has no `sessionId` and the executor's existing explicit failure fires. The spike measures how wide that window is; the plan does not paper over it with a fresh session, which would silently discard the redirect target.

### D4 — Spike gate before executor work

Phase 2 must not start until `spike:interrupt:omp` records, on the installed binary: SIGTERM mid-turn exit code and time-to-exit; stdout events emitted between signal and close; `--resume <id>` succeeding after a SIGTERM exit **and** after a SIGKILL-escalated exit; when the `session` header arrives relative to the first assistant event; and that the resumed turn sees the interrupted turn's context. If SIGKILL loses resumability, the single shared `TERMINATION_GRACE_MS` is raised for every termination cause (D1) and the spike is re-run.

### D5 — Non-interrupted OMP runs are byte-for-byte unchanged

Every provider pass now receives an `interruptSignal`. Tests must prove a never-aborted signal changes no argv, no spawn option, no result shape, no listener leak.

## Phases

| # | Phase | Depends on |
| --- | --- | --- |
| 1 | [OMP stream-abort seam and real-binary gate](./phase-01-omp-stream-abort-seam-and-real-binary-gate.md) | — |
| 2 | [Executor conformance and the `stream_aborted` marker](./phase-02-executor-conformance-and-stream-aborted-marker.md) | 1 |
| 3 | [Docs, capability matrix, and closeout](./phase-03-docs-matrix-and-closeout.md) | 1–2 |

## Deep-mode execution note

Phase 1 is fully specified. Phases 2 and 3 are outlined against the anchors verified today; before executing each, run a scout pass over the files in its inventory (line numbers drift — use the stable text anchors named in the phase) and update the phase file with any deltas before writing tests.

## Acceptance criteria

- [ ] `OMP_CAPABILITIES.interrupt === 'stream-abort'`; every registered provider still declares a total interrupt axis; only Claude declares `'native'`.
- [ ] Stop on a running OMP turn sends SIGTERM (SIGKILL after grace) through the fresh per-turn signal; the node-level Cancel controller is untouched; the node stays `running`.
- [ ] The interrupted turn yields exactly one `result` with `terminalReason: 'stream_aborted'`, the real OMP session id, observed usage plus fail-soft hidden-session enrichment, and `resumed` reflecting observed-vs-requested session equality; no `omp_exit_nonzero`/`omp_transport_error`/`omp_incomplete_output` decoration even when the fake child exits 143/137; no throw.
- [ ] Cancel that co-fires with Stop still throws `Query aborted` (Cancel dominates); a pre-aborted interrupt signal spawns nothing.
- [ ] The executor classifies the OMP end as interrupted in direct, AI-loop, and loop-group-body paths: still-open tools settle `interrupted`, one `interrupted` status row, `idle-after-interrupt` projected, no `dag_node_failed`; a thrown `Query aborted` with the flag set is still routed to idle (story Given/Then); a missing session id fails explicitly in BOTH the direct and the loop path.
- [ ] `Send now` resumes with the interrupted session id as `resumeSessionId` and the drained messages in written order; the loop path continues the interrupted iteration before the completion check.
- [ ] Real-binary spike evidence recorded and sanitized; resumability after SIGTERM and after SIGKILL-escalation is stated with measured numbers.
- [ ] Capability matrix regenerated and checked; `ai-assistants.md` OMP section documents Stop semantics; `types.ts` docstrings no longer call `'stream-abort'` reserved.
- [ ] `bun run validate` passes; `sprint-status.yaml` entry `2-5-interrupt-and-redirect-a-running-omp-agent` moved to `done` only after the gate.

## Compatibility, operations, and rollback

- All changes are additive: one capability value flip, one optional marker string, one new parser method. No schema, route, wire, or UI change. No new persisted state *kinds*: the one `interrupted` status row per interrupt is the existing `workflow_node_messages` row #183 already writes (`recordNodeStatus`/`recordLoopStatus`).
- Chat/orchestrator callers never pass `interruptSignal`, so direct chat on OMP is unaffected.
- Rollback is the capability flip back to `false` (Stop disappears, OMP returns to queue-only) plus removal of the provider listener. Already-written `interrupted` rows stay as harmless transcript history. A run parked in `idle-after-interrupt` across a restart or rollback is the behaviour #183 already disclosed: its in-process idle waiter is gone, the node stays `running`, and the operator cancels or abandons it — nothing auto-fails it (AGENTS.md "No Autonomous Lifecycle Mutation Across Process Boundaries") (red team F1).
- Authorization posture is inherited, not re-decided: the interrupt and send routes grant any authenticated user (starter, member, admin; identity-less runs allowed) per `steering-test-plan.md` §"Registry and routes" and the actor-ladder tests. OMP runs unsandboxed with host-user permissions (`ai-assistants.md` OMP section), so flipping the capability lets any member redirect an unsandboxed session. This is a spec decision surfaced to the user in the Validation Log, not silently changed here (red team S2).
- Follow-ups explicitly NOT in this story (recorded so they are not lost): process-group termination of bash-tool grandchildren on Stop/Cancel — pre-existing for Cancel, `terminate()` signals only the spawned handle; the spike's post-kill process-table check decides whether an issue is opened (red team S1/S4). Rate-limiting Stop→Send now cycling and identity on the interrupt route's log line are server-scope follow-ups (red team S3/S5).
- Process hygiene: the spike spawns real `omp` children in a disposable temp git repo; it must reap every child it starts (SIGKILL fallback), check the process table afterwards, and never leave one behind.

## Validation sequence

Run the focused commands named in each phase, then:

```bash
bun run generate:capability-matrix
bun run check:capability-matrix
bun run validate
```

Do not run root `bun test`. Do not mark `sprint-status.yaml` done until the final gate and the evidence report are complete.

## Red Team Review

### Session — 2026-09-20
**Findings:** 15 raw → 13 after dedup (10 accepted, 3 rejected)
**Severity breakdown:** 4 Critical, 5 High, 4 Medium (post-dedup)
**Reviewers:** Assumption Destroyer (A), Failure Mode Analyst (F), Security Adversary (S); Standard-tier verification (Fact Checker + Contract Verifier), 40 claims checked, 1 factual FAILED (A1, fixed), 0 unresolved.

| # | Finding | Severity | Disposition | Applied To |
|---|---------|----------|-------------|------------|
| A1 | `makeRunningProcess` always resolves exit 0, so test 4's "no `omp_exit_nonzero` even though the fake exits non-zero" was unfalsifiable | Critical | Accept | Phase 1 (fixture `exitCode` param, tests 4/5) |
| A2 | Manual real-binary gate has no policy for a missing/expired OMP login or a changed binary version | High | Accept | Phase 1 (gate policy: BLOCKED, version recorded, re-run on version change) |
| A3 | `resumed: true` was unconditional; a silently fresh OMP session would pass as resumed | High | Accept (narrowed to the interrupted result; success path unchanged) | Plan D2, Phase 1 parser contract + test 7b, Phase 2 row |
| A4 + F3 | Dual-grace Adjust branch is not expressible on the shared first-caller-wins `terminate()` | High | Accept (single shared grace raised for all causes) | Plan D1/D4, Phase 1 Adjust + Refactor |
| A5 + F2 | Skipping hidden-session enrichment on the interrupted turn permanently loses advisor/subagent spend; primary-stream spend before first `message_end` is undisclosed | High | Accept (enrichment runs fail-soft; disclosure added) | Plan D2, Phase 1 provider contract + test 12, Phase 3 doc note |
| F1 | Rollback section said "nothing persisted" while the plan mandates a persisted `interrupted` row; stranded idle run across restart unaddressed | Critical | Accept (reworded; behaviour is the #183 disclosed one) | Plan "Compatibility, operations, and rollback" |
| F4 | Missing-session-id safety net tested only on the direct path; the loop path has its own copy | High | Accept | Phase 2 matrix row |
| F5 | Mirrored SIGTERM→SIGKILL test needs the explicit `7_000` ms override; real-timer wait stacking | Medium | Accept | Phase 1 test 5 |
| S1 | `terminate()` signals only the spawned handle; bash-tool grandchildren survive Stop | Critical | Reject for this story — pre-existing Cancel behaviour, `Bun.spawn` has no process-group option; recorded as follow-up, decided by the spike's process-table check | Plan "Compatibility" follow-ups; Phase 1 spike step 5 |
| S2 | Capability flip inherits the any-authenticated-user actor grant onto an unsandboxed provider | Critical | Accept as documentation + user decision (spec-owned posture, not silently changed) | Plan "Compatibility"; Validation Log Q1 |
| S3 | No rate limit on Stop→Send now cycling (per-cycle `omp` spawn + model call) | High | Reject — actor is authenticated and bills the install's own credential; spec defines no throttle; not story-specific; recorded as follow-up | Plan "Compatibility" follow-ups |
| S4 | Spike never checks for orphaned grandchildren after kill | Medium | Accept | Phase 1 spike step 5 |
| S5 | Interrupt route logs no requester identity | Medium | Reject — server scope, out of this story; recorded as follow-up | Plan "Compatibility" follow-ups |

### Whole-Plan Consistency Sweep
Decision delta: (1) enrichment runs on the interrupted result; (2) `resumed` computed from observed-vs-requested id; (3) one shared grace, no dual grace; (4) fixture exit codes 143/137; (5) loop-path no-session row; (6) rollback wording; (7) spike gains process-table check, version stamp, login policy. Searched all four files for `skipped on the interrupted`, `interrupt-only grace`, `buildInterruptedResult(resumed`, `nothing persisted`, `Do not call maybeEnrichResult`, `resumed flag is true` — the only survivors were D4's "interrupt-only grace" sentence, the Phase 1 risk bullet, and parser test 13's `buildInterruptedResult(true)` signature, all rewritten in this sweep. No unresolved contradictions remain.


## Validation Log

### Session 1 — 2026-09-20

**Verification Results** (carried from the red-team pass; Standard tier, Fact Checker + Contract Verifier)
- Claims checked: 40 | Verified: 39 | Failed: 1 (A1 fixture exit code — fixed in Phase 1) | Unverified: 1 (Bun `Subprocess.exited` value for a signal-killed child — moot for correctness because the interrupt check precedes the exit-code branch; the spike records the actual value)

**Questions asked:** 4 (all answered with the recommended option)

| # | Decision | Answer | Propagated to |
|---|----------|--------|---------------|
| Q1 | Interrupt end shape vs. spec wording "throws `Query aborted`" | Result-shaped interrupt end, no trailing throw | Plan "Authority and resolved conflicts", D2; Phase 1 provider contract; Phase 2 story-literal rows |
| Q2 | Authorization posture after the capability flip | Keep the spec's actor grant (any authenticated user); document only, no server change | Plan "Compatibility, operations, and rollback"; Phase 3 doc note |
| Q3 | Hidden-session usage enrichment on an interrupted turn | Run enrichment fail-soft | D2; Phase 1 provider contract + test 12; Phase 3 doc note |
| Q4 | Process-group termination of bash-tool grandchildren | Out of this story; spike measures, follow-up issue only if orphaning observed | Plan follow-ups; Phase 1 spike step 5 |

### Whole-Plan Consistency Sweep
All four answers matched what the red-team session had already applied, so no phase text changed in this session. Re-read `plan.md` and every `phase-*.md`: the interrupt shape, enrichment, auth posture, and process-group statements agree across the index, D1–D5, the three phases, and the Red Team table. No unresolved contradictions.

**Recommendation:** proceed — `Failed: 0` outstanding after the A1 fix; eligible for `/ak:cook`.
