---
title: "Issue 186: interrupt and redirect a running Grok agent (unblock, then ship)"
description: "Second spike round to clear the two BLOCKED release gates from PR #217, then the Grok stream-abort provider seam, executor conformance, capability flip, and closeout for ANR Story 2.6."
status: pending
priority: P1
effort: 4-5d
issue: 186
branch: archon/thread-34dc83fe
tags: [feature, backend, providers, workflows, grok, agent-node-room, tdd]
blockedBy: []
blocks: []
created: 2026-09-20
---

# Issue 186: interrupt and redirect a running Grok agent

## Overview

Operator `Stop` on a Grok-backed workflow node must end only the current Grok CLI turn; the node stays `running`, enters `idle-after-interrupt`, and `Send now` continues **the same Grok session** with queued guidance in receipt order. An open tool is recorded `interrupted` (rendered `⚠`), never failed, and `dag_node_failed` is never emitted for an operator interrupt. This must hold on direct AI nodes, AI loops, and provider-calling loop-group bodies (Story 2.6, `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md:585`).

This is an **unblock-then-implement** plan. PR #217 (branch `archon/thread-e5318172`, unmerged) shipped the Phase 1 spike runner and returned **BLOCKED**: gate 2 failed (S2 — SIGTERM at 0 ms after spawn leaves no resumable session) and gate 5 is unproven (S4 — no native Windows host). Gates 1, 3, 4, 6, 7 passed on `grok 1.0.34 (3736acbc8658) [stable]`, and gate 4 proved a slow-tool child **survives** parent exit. Phases 2–4 are conditional on Phase 1 clearing gates 2 and 5 (or an explicit product decision recorded in the Validation Log). `GROK_CAPABILITIES.interrupt` stays `false` until then.

## Locked design decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Materialization-armed interrupt (fresh/forked turns).** Stop received before Grok has persisted a **new** session is held *pending* and fired at the first proven-safe stream event `M` (Phase 1 finds `M`; candidates: first stdout line, first `thought`, first `text`/`tool_call`). If `M` does not arrive within `INTERRUPT_ARM_TIMEOUT_MS`, the provider terminates and returns a **genuine failure** (`grok_interrupt_unpersisted`), never an abort marker. Resumed turns already own a persisted session: if Phase 1 S3b proves SIGTERM-at-spawn keeps it resumable, they fire immediately and fall back to `resumeSessionId` (red-team #16). | S2 failed because the CLI had not started; S1/S3 (after first text) pass. The executor fails fast on an interrupted turn without a resumable id (`dag-executor.ts:3554-3561`), so the provider must guarantee one or fail honestly. |
| D2 | **POSIX process-group ownership.** `Bun.spawn({ detached: true })` + `process.kill(-pid, sig)` for both Stop (SIGTERM) and Cancel (SIGTERM→SIGKILL). Verified on Bun 1.3.14 in this worktree: group kill reaps a backgrounded grandchild. Group signals are sent only while `exited` is unresolved, with an immediate `processExited` re-check, to narrow the PID-reuse window (red-team #3). | Gate 4 evidence: exact slow-tool child PID survived parent exit. Cancel must move to the group too or it keeps the orphan bug. |
| D3 | **Abort marker = exact Grok triple** `{ stopReason: 'aborted', isError: true, errorSubtype: 'grok_aborted' }` + `sessionId` (+ `resumed`), and `isInterruptMarkedResult` in `packages/workflows/src/dag-executor.ts:481` gains a Grok clause. | Follows the #215 DeepSeek precedent (`acp-client.ts:112-119`). `terminalReason` is documented as forwarded verbatim from the Claude SDK; synthesizing Claude's vocabulary for Grok would turn a Claude string into a cross-provider wire format. `steering-test-plan.md:40` says the Grok fixture "pins its abort terminal shape". |
| D4 | **Provider-owned tool settlement on interrupt.** `closeOutstandingTools('interrupted')` emits one interrupted `tool_result` per open tool *before* the abort-marked result; the executor's `settleRunningToolsOutcome` then finds nothing left to settle. Exactly one `tool_completed` row per tool. | Today the parser closes tools as `unknown` before the result (`event-parser.ts:97-111`), which would pre-empt the executor's `interrupted` settlement. Provider-owned closure also serves non-executor consumers. |
| D5 | **Caller-assigned session id** (`--session-id <uuid>`) for every interrupt-capable new or forked Grok turn, so a turn interrupted before `end` still names the session Grok persisted. A reported `end.sessionId` that differs from the assigned/resumed id is a fail-closed `grok_session_id_mismatch` failure (red-team #2). | Gate 1 PASS: caller-assigned ids are accepted and echoed. Parser learns the id only from `end` today (`event-parser.ts:292`). |
| D6 | **Windows is a release gate, not an inferred limitation.** Phase 1 attempts native evidence via a `workflow_dispatch`-only GitHub Actions job on `windows-latest` (CI matrix is ubuntu-only today, `.github/workflows/test.yml:17`). If no evidence can be produced, the capability flip waits for a product decision recorded in the Validation Log — the plan does not pre-empt it. | Windows `proc.kill` is TerminateProcess; the launch path is `cmd.exe /d /s /c grok.cmd` (`provider.ts:83-88`); `process.kill(-pid)` does not exist there. Static capabilities must stay host-independent (matrix generator). |
| D7 | **Version floor** `grok 1.0.34` owned by one constant in `packages/providers/src/grok/config.ts`; `archon doctor` fails closed below it (or on unparsable output) before the authenticated `models` probe. | Gate 6 PASS with 1.0.34 as the only tested build. |

## Relationship to PR #217

- Phase 1 **cherry-picks** the spike-runner commit(s) from `archon/thread-e5318172` (`packages/providers/src/grok/interrupt-resume-spike.ts`, the `spike:interrupt:grok` script, `plans/reports/spike-260920-0243-grok-interrupt-resume.md`) onto this branch rather than waiting on a merge. The prior plan directory and `prd.*`/`progress.txt` ledgers are **not** cherry-picked; this plan supersedes them.
- Recommend closing #217 as superseded, or stripping `Closes #186` from its body before any merge — `develop` is the default branch, so merging it as written auto-closes a still-blocked story.

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Unblock evidence gates (spike round 2)](./phase-01-unblock-evidence-gates-spike-round-2.md) | Pending |
| 2 | [Grok provider stream-abort seam](./phase-02-grok-provider-stream-abort-seam.md) | Pending |
| 3 | [Engine conformance: direct, loop, loop-group](./phase-03-engine-conformance-direct-loop-loop-group.md) | Pending |
| 4 | [Capability flip, docs, doctor, closeout](./phase-04-capability-flip-docs-doctor-closeout.md) | Pending |

Per `--deep`, Phase 1 is specified in full; Phases 2–4 carry their design and TDD matrices but each gets a dedicated scout pass at cook time to re-read the exact line ranges named here (the executor file is ~10k lines and moves).

## Dependency map

```
Phase 1 ──gates 2,5 PASS (or recorded decision)──▶ Phase 2 ──▶ Phase 3 ──▶ Phase 4
   │ M boundary, INTERRUPT_ARM_TIMEOUT_MS, grace, group decision, Windows path, version floor
   └────────────────────────────────────────────────────────────────────────────▲
                                 (Phase 4 doctor floor + docs platform claims read Phase 1 values)
```

## Success criteria

- [ ] Phase 1 report answers all four blocking questions with recorded evidence; gates 2 and 5 are PASS, or the Validation Log records the product decision that replaces them.
- [ ] `Stop` on a generating Grok node ends the turn, keeps the node `running`, writes one `interrupted` status row, settles open tools `interrupted` exactly once, and never emits `dag_node_failed`.
- [ ] `Send now` resumes the **same** session id with `forkSession: false`; queued and new guidance arrive in receipt order.
- [ ] Direct, AI-loop, and loop-group-body conformance fixtures pass with Grok's exact result shape; the generic #183 suite stays green and unchanged.
- [ ] No abort-marked result is ever emitted without a resumable session id; SIGKILL escalation and arm-timeout are genuine failures.
- [ ] No Grok grandchild survives Stop or Cancel on POSIX.
- [ ] `GROK_CAPABILITIES.interrupt === 'stream-abort'`; matrix regenerated; Grok guide documents floor, platforms, and written-work semantics; doctor fails below the floor.
- [ ] `bun run validate` passes; `sprint-status.yaml` row `2-6-interrupt-and-redirect-a-running-grok-agent` moves to `done` last.

## Non-goals

- Hook-based soft-inject (gate G3) and the `leader.sock` channel.
- Any executor, registry, route, store, or UI change beyond the `isInterruptMarkedResult` clause and comment corrections.
- Rolling back files Grok tools already wrote.
- Estimating spend for a no-`end` interrupted turn.

## Rollback

Code-only: set `GROK_CAPABILITIES.interrupt` back to `false`. The executor stops issuing Grok `interruptSignal`s; the provider seam is dormant; already-assigned session ids remain valid opaque ids.

<!-- slug: issue-186-grok-interrupt-redirect -->

## Validation Log

### Open decisions for the operator (answer before Phase 2 starts)

1. **Windows (D6):** block the capability flip until native `windows-latest` evidence exists (recommended — Phase 1 ships the `workflow_dispatch` job and needs an `XAI_API_KEY` secret), ship POSIX-only with an explicit win32 runtime posture, or scope Windows out of Story 2.6.
2. **PR #217:** close as superseded after Phase 1 cherry-picks the spike runner (recommended), or merge it first with `Closes #186` removed.
3. **Abort marker (D3):** exact Grok triple + predicate clause (recommended, matches #215), or reuse Claude's `terminalReason` vocabulary with executor comments only.
4. **If S2b and S2c both fail resume:** wait for a newer Grok CLI, or revise the promise to "Stop is honoured from the first model output".

Phase 1 records its measured values (`M`, `INTERRUPT_ARM_TIMEOUT_MS`, grace, group decision, Windows verdict, floor) here when it completes.

## Red Team Review

### Session — 2026-09-20 (Security Adversary, Failure Mode Analyst, Assumption Destroyer)
**Findings:** 16 (14 accepted, 2 rejected)
**Severity breakdown:** 5 Critical, 6 High, 5 Medium

| # | Finding | Severity | Disposition | Applied To |
|---|---------|----------|-------------|------------|
| 1 | Windows spike job runs production argv (`bypassPermissions`, no sandbox, full env) with a live `XAI_API_KEY`, dispatchable on any ref | Critical | Accept (modified: keep production argv for the signal/session path, but the spike always appends `--sandbox workspace` and a tool allow/deny list as its one recorded delta; job gets `environment:` approval, `permissions: contents: read`, `persist-credentials: false`) | Phase 1 |
| 2 | Reported `end.sessionId` silently overrides the assigned/resumed id on mismatch | High | Accept — mismatch is now a fail-closed `grok_session_id_mismatch` failure, never a warn-and-proceed | Phase 2 (D5) |
| 3 | `process.kill(-pid)` has a PID-reuse race after the leader exits | High | Accept (modified: signal the group only while `exited` is unresolved, re-check `processExited` immediately before the syscall, and document the residual window; leader kill goes through Bun's handle) | Phase 2 (D2) |
| 4 | Grok CLI installer in the Windows job is unpinned while the secret is in scope | High | Accept — pin to a checksummed release matching the floor; export the secret only in the spike step | Phase 1 |
| 5 | No enforced scrub of the "sanitized" report before artifact upload | Medium | Accept — CI step fails the job if stdout/stderr/report contain the secret value; `::add-mask::` applied | Phase 1 |
| 6 | Doctor version parse not anchored or length-capped | Medium | Accept — anchored regex on trimmed stdout, raw string capped at 1000 chars | Phase 4 |

| 7 | Cancel-first settlement order drops the `closeOutstandingTools()` emission that today precedes the `Query aborted` throw, orphaning open tool rows (executor settles tools only on a `result` chunk) | Critical | Accept — tool closure runs unconditionally before the Cancel check (`interrupted` when cause is interrupt, else `unknown`); new T22 | Phase 2 |
| 8 | `assignedSessionId` fallback trusts an id Grok never confirmed when the final line is truncated | Critical | **Reject** the `sawEnd` requirement: round-1 S1/S3 resumed the assigned id with **no** `end` event (`Final usage: False`), so requiring `end` would break the main interrupt path; the id is confirmed by Phase 1 evidence, not by `end`. Accept the narrow part: a protocol error claimed **after** the interrupt (truncated trailing fragment) must not relabel the interrupt, and a protocol error claimed **before** it keeps failing (T13); new T23 | Phase 2 |
| 9 | `INTERRUPT_ARM_TIMEOUT_MS ≥ 30 s` leaves Stop with no visible effect while `stop-pending` | High | Accept (modified: documented UX gap — the window exists only when Grok has emitted nothing, node Cancel stays immediate throughout, a structured `grok.interrupt_pending` log marks entry; no UI work in this story) | Phase 2, Phase 4 |
| 10 | Required `GrokProcess.pid` breaks five existing test fakes not enumerated | Medium | Accept — refactor step lists the four helpers plus the inline fake | Phase 2 |
| 11 | `detached: true` orphans the Grok group if Archon itself crashes | High | **Reject** as introduced risk: a child of a crashed server is re-parented and survives whether or not it is detached (no controlling TTY, so no SIGHUP either way) — the orphan class exists today for every subprocess provider. Documented as a pre-existing operational note in Phase 2 risks | Phase 2 |
| 12 | Windows decision (c) "scope out" names no runtime behaviour, yet the host-independent capability still offers Stop on win32 | Medium | Accept — for decisions (b) and (c), the win32 branch fails the turn with an explicit `grok_interrupt_unsupported_platform` error **when the interrupt fires** (never a silent no-op, never at spawn), and Phase 4 documents it | Phase 2, Phase 4 |
| 13 | Shared `killTimer` idempotency guard loses per-cause SIGKILL attribution when Stop and Cancel both fire | Medium | Accept — track `causesPendingKill: Set<'interrupt' \| 'cancel'>` independent of timer scheduling; Cancel dominates at settlement | Phase 2 |

| 14 | Phase 4 claims the existing `checkGrok` tests "stay green", but two fixtures use `grok 1.0.0` (below the 1.0.34 floor) and would fail closed before `models` | Critical | Accept — those two fixtures (`doctor.test.ts:316-329`, `:333-345`) are bumped to a version ≥ the floor; the "Tests before" claim now says *modified*, not preserved | Phase 4 |
| 15 | T7 assumes SIGTERM mid-tool flushes an `end` with usage; round-1 S1 shows no `end` arrives (final usage `false`) | Critical | Accept — T7 rewritten to the observed shape (assigned id, no usage); the `end`-arrives-after-SIGTERM race kept as T7b, explicitly a robustness case not the expected path | Phase 2 |
| 16 | D1 applies the fresh-turn arm-timeout failure to resumed turns whose session already exists, and Phase 1 never tests a resumed turn stopped at spawn | High | Accept — new Phase 1 scenario **S3b** (SIGTERM at spawn on a resumed session). If S3b passes, resumed turns skip `stop-pending` and fire immediately, falling back to `resumeSessionId`; only fresh/forked turns wait for `M`. If S3b fails, resumed turns use the uniform path | Phase 1, Phase 2 |

### Whole-Plan Consistency Sweep — 2026-09-20

Decision deltas applied: fail-closed session-id mismatch (D5), group-kill PID-reuse guard (D2), spike-only sandbox delta and hardened Windows job (Phase 1), unconditional tool closure before Cancel (Phase 2 settlement), per-cause kill attribution, win32 behaviour for decisions (b)/(c), T7 corrected to no-`end`, resumed-turn immediate Stop gated on S3b, doctor fixtures bumped. `plan.md` D1/D2/D5 rows, Phase 1 scenarios/decision rules, Phase 2 architecture/T-matrix/todos, Phase 4 tests-before/docs were re-read and reconciled; no contradictory claim remains. Two rejections (#8 `sawEnd` requirement, #11 detached orphan) are recorded with their evidence above.

**Red-team gate: cleared.** Remaining blockers before cook are the operator decisions in `## Validation Log` (no validation interview was run in this session).
