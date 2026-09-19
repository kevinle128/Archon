---
title: 'Issue 186 interrupt and redirect a running Grok agent'
description: 'Implementation plan for ending one Grok CLI turn without cancelling the workflow node, then continuing the same Grok session with operator guidance.'
status: pending
priority: P1
effort: '4 phases'
issue: 'https://github.com/kevinle128/Archon/issues/186'
branch: archon/thread-e5318172
tags: [issue-186, agent-node-room, providers, workflows, grok, tdd]
blockedBy: []
blocks: []
created: 2026-09-20
---

# Issue 186: interrupt and redirect a running Grok agent

## Goal and user outcome

When a Grok-backed workflow node is generating, an operator can press `Stop` to end only the current Grok turn. The node remains `running` and enters `idle-after-interrupt`; an open tool is recorded as `interrupted`, not failed. `Send now` then sends queued guidance followed by the newly typed message on the **same Grok session**. Node-level Cancel retains its existing terminal behaviour.

The implementation is complete only if this works for direct AI nodes, AI loops, and provider-calling loop-group body nodes. A fresh session, an unresumable early interrupt, or a forced-kill result presented as successfully interrupted does not meet the story.

## Verified starting point

- Story 2.6 in `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md` requires stream-abort, same-session continuation, `⚠ interrupted`, direct/loop parity, and no node failure. Issue #186 matches that outcome and is still open.
- `_bmad-output/specs/spec-agent-node-room/provider-steering-matrix.md` selects stream-abort for Grok because `x.ai/interject` is unreachable. Grok hook-based soft injection remains unverified and outside this story.
- Story 2.3 / PR #214 already shipped the provider-blind route, registry, executor turn loop, transcript projection, and Legacy/Console dock states. Source confirms that any provider whose capability is not `false` receives a distinct per-turn `interruptSignal`; Cancel continues to use `abortSignal`.
- `packages/workflows/src/dag-executor.test.ts` already contains 19 generic interrupt cases covering queue order, same-session continuation, natural-end races, Cancel dominance, missing session IDs, repeated interrupts, structured-output handling, usage, AI loops, and loop-group namespacing. This plan adds only Grok-shape conformance cases.
- `packages/providers/src/grok/provider.ts` currently listens only to `abortSignal`, sends SIGTERM followed by SIGKILL after five seconds, and treats missing `end` as a provider error. `packages/providers/src/grok/event-parser.ts` closes open tools as `unknown` and learns the session ID only from `end`.
- The installed Grok CLI reports `grok 1.0.34`. Its bundled headless-mode docs state that SIGINT/SIGTERM save the session up to the last completed tool call and exit 130/143, and that `--session-id <UUID>` assigns a new session ID. The bundled session docs identify `updates.jsonl` as authoritative and say `--session-id` may accompany `--resume` only when forking.
- Archon's Grok resolver explicitly supports Windows, and the current `.cmd`/`.bat` path is launched through `cmd.exe`. Node documents that SIGTERM/SIGINT/SIGKILL are forceful on Windows, while Bun documents detached process groups without promising a graceful Windows signal path. Therefore Windows same-session persistence is unverified and is a release gate, not an accepted limitation: [Node child processes](https://nodejs.org/api/child_process.html), [Bun spawn](https://bun.sh/reference/bun/spawn).
- No mockup, wireframe, or prototype is co-located with this plan. The referenced Agent Node Room `DESIGN.md`, `EXPERIENCE.md`, reconciliation/validation records, and key steering/transcript/Legacy/Console mockups were inspected. `reconcile-live-steering.md` supersedes the older header placement and puts Stop on the bottom dock; the later provider contract also supersedes the stale transcript-mock note that only Claude can produce `⚠ interrupted`. The shipped UI is capability/data-driven, so no new UI work is required.

## Scope

### In scope

- prove the Grok CLI's interruption, session persistence, child-process, timing, version, and platform behaviour before advertising the capability;
- pre-assign a UUID for interrupt-capable new/forked Grok workflow turns so a missing `end` cannot erase the session identity;
- make the Grok provider honour the distinct `interruptSignal`, settle open tools as `interrupted`, and return Archon's existing normalized abort marker only after graceful termination;
- preserve natural results, real protocol/transport failures, and Cancel precedence under races;
- set `GROK_CAPABILITIES.interrupt` to `'stream-abort'` only after every Phase 1 release gate passes;
- add focused provider/parser tests and three Grok-shaped executor conformance tests;
- regenerate the capability matrix, document operation and compatibility, record acceptance evidence, and close the sprint item last.

### Out of scope

- Grok `pre_tool_use` hooks, `x.ai/interject`, leader sockets, ACP, or another transport;
- new routes, database changes, workflow-language changes, or new dock/reader UI;
- changes to Codex, OMP, DeepSeek, or other providers;
- changing the 30-minute idle-after-interrupt lifecycle or cross-process steering boundary;
- inventing partial cost: without an authoritative `end`, Grok's standalone `usage` events contain tokens but not spend. Phase 1 records their presence; this story does not fabricate USD or introduce an unverified aggregation rule.

## Design and invariants

### 1. Keep interrupt and Cancel separate

Grok listens to `requestOptions.interruptSignal` in addition to the existing `abortSignal`. A spent Cancel signal fails before spawn as today. A spent interrupt signal fails before spawn with `Query interrupted`. After the subprocess exists, listeners are installed and both signals are immediately rechecked so an abort during binary resolution/spawn cannot be missed. Cancel is checked first after shutdown and remains dominant if both signals fire.

Do not combine signals with `AbortSignal.any()`: the shipped engine intentionally passes two signals so the provider and executor can distinguish a node Cancel from an operator Stop.

### 2. Assign the session ID before interruptible new/forked turns

When `interruptSignal` is present:

- new session: generate a UUID and pass `--session-id <uuid>`;
- resumed session without fork: use `resumeSessionId`; do not pass `--session-id` because Grok rejects that combination;
- resumed session with `forkSession: true`: generate a UUID and pass it with `--resume … --fork-session`.

Calls without `interruptSignal` keep their argv unchanged. Once the capability flips, every new Grok **workflow** turn receives an interrupt signal, so caller-assigned IDs apply to all new Grok workflow sessions, not only sessions that are eventually interrupted. Session IDs are opaque to engine consumers.

The CLI-reported `end.sessionId` is the authoritative persisted ID. If it differs from the assigned ID, use the reported ID and write a structured warning; do not emit a user-facing `system` chunk because the loop path does not forward those chunks consistently. An abort-marked result is never emitted without a concrete assigned, resumed, or reported session ID.

### 3. Classify shutdown by the first real cause

Track enough state to distinguish:

1. natural completion (`end` consumed before Stop): return the natural result;
2. Cancel: keep the current `Query aborted` path;
3. operator interrupt claimed while the process is alive and before `end`: graceful stream-abort;
4. protocol/transport failure claimed before Stop: retain the real failure;
5. forced SIGKILL: fail with a distinct non-abort error because session durability is no longer proven.

An interrupt-induced stdout/stderr closure after case 3 must not be reclassified as a transport error. Conversely, a protocol/transport failure observed first must not be hidden merely because Stop arrives later. Add an explicit `hasEnded()` parser query; absence of a session ID is not a valid proxy because an invalid `end` may omit one.

### 4. Normalize only a proven graceful interrupt

For case 3, after the process exits within the evidence-backed grace period:

1. close each still-open parser tool exactly once with `toolOutcome: 'interrupted'`;
2. yield one non-error result with `terminalReason: 'aborted_tools'` if a tool was open, otherwise `'aborted_streaming'`;
3. include the concrete session ID and any authoritative aggregate usage already received in `end`;
4. return before non-zero-exit handling, because a graceful SIGTERM exit of 143 is expected.

The existing unconditional `closeOutstandingTools()` call must be replaced, not followed by a second close, or the persisted tool outcome will remain `unknown`. Normal/error paths retain `unknown`.

### 5. Fail closed on process and platform uncertainty

The Phase 1 spike sets the grace period. A normal interrupted run must exit on SIGTERM within it. The runtime may retain SIGKILL as cleanup, but if escalation occurs the provider reports a real failure and never claims the session is resumable.

If a tool child survives the parent, the provider must own a POSIX process group and terminate that group; the fake process interface and tests must cover this. Do not copy the Claude container implementation blindly because Grok's local process topology is different.

The capability is static and generated into public docs. It must not be flipped if native Windows cannot preserve and resume the same session under the actual `cmd.exe`/Grok launch path. If Windows fails, stop for an explicit product/architecture decision; this plan does not silently create an undocumented POSIX-only capability.

### 6. Reuse the engine contract

`'stream-abort'` already passes the engine's `interrupt !== false` gate, and the engine already recognizes `aborted_streaming` / `aborted_tools`. No Grok branch belongs in the executor or registry. Only provider-neutral comments/docstrings that incorrectly say “Claude-only” should change.

## Delivery phases

| # | Phase | Gate |
| --- | --- | --- |
| 1 | [Protocol, process, version, and platform spike](./phase-01-grok-stream-abort-spike-gate.md) | All release gates pass; otherwise stop |
| 2 | [Grok provider stream-abort seam](./phase-02-grok-provider-stream-abort-seam.md) | Phase 1 evidence recorded |
| 3 | [Engine conformance: direct, loop, loop-group](./phase-03-engine-conformance-direct-loop-loop-group.md) | Provider shape complete |
| 4 | [Capability matrix, docs, validation, and closeout](./phase-04-capability-matrix-docs-and-closeout.md) | Phases 1-3 green |

## Acceptance criteria

- [ ] **Stop affects one turn:** aborting Grok's per-turn `interruptSignal` gracefully ends only that CLI turn; the workflow node remains `running`, reaches `idle-after-interrupt`, and writes no `node_failed` / `dag_node_failed` event.
- [ ] **Same-session redirect:** `Send now` makes the next provider call with `resumeSessionId` equal to the interrupted turn's concrete session ID, `forkSession: false`, and queued messages followed by the new message in receipt order.
- [ ] **Interrupted tool:** a tool open at Stop produces exactly one `tool_completed` event with `tool_outcome: 'interrupted'`; no duplicate `unknown` or failed outcome is written.
- [ ] **All provider-calling paths:** the exact Grok result shape passes direct AI, AI-loop, and loop-group-body conformance; the interrupted AI-loop iteration is resumed rather than consumed.
- [ ] **Races are causal:** natural completion remains natural; Cancel remains terminal; interrupt-induced I/O/exit 143 remains interrupted; a pre-existing protocol/transport failure remains a failure; a missed-listener window is covered.
- [ ] **Stop is responsive:** on each supported native platform, the Phase 1 signal-to-exit measurement for ordinary S1/S2 interruption is below one second, matching the ratified `Stopping…` transient; the longer grace exists only as cleanup protection.
- [ ] **Failure is honest:** missing session identity, unsuccessful resume, surviving child process, or SIGKILL escalation cannot produce an abort-marked success result.
- [ ] **Compatibility is explicit:** the tested CLI version and minimum supported version for this feature are documented; `archon doctor` reports an actionable failure for an older configured Grok CLI; non-workflow calls without `interruptSignal` keep their existing argv.
- [ ] **Platform support is proved:** the same-session interruption gate passes on every advertised native platform, including Windows, or implementation stops for an explicit scope decision before capability publication.
- [ ] **No UI regression:** the existing provider-blind dock remains unchanged and the conformance tests prove the data that drives `Stop` → `Stopping…` → `Send now` and `⚠ interrupted`. If implementation unexpectedly touches UI, stop and add visual checks at the Legacy 460 px panel and the Console mock's 520 px panel against `control-states.md` before proceeding.
- [ ] **Evidence and gates:** the sanitized spike and acceptance reports exist under `plans/reports/`; focused tests, capability-matrix check, and `bun run validate` pass; the sprint row changes to `done` only after final review.

## Compatibility, rollout, operations, and rollback

- This is a capability rollout, not a data migration. There are no schema, API, route, or workflow-YAML changes.
- Phase 1 establishes a conservative minimum Grok CLI version. If vendor history cannot prove an earlier floor, the exact version tested is the floor. The guide and doctor surface it; a CLI that rejects `--session-id` does so during argument parsing before a billable query, and Archon never falls back to a fresh session.
- Interruption does not roll back files already changed by Grok tools. Preserve the existing UI disclosure and document the behaviour in the Grok guide.
- Real-CLI evidence is sanitized: no credentials, prompt/model output, home paths, or session contents. The spike deletes only the exact session UUIDs it created and always cleans up any spike-owned child process.
- Structured logs distinguish `query_interrupted`, session-ID mismatch, graceful-timeout escalation, and real transport/protocol failures without leaking prompt content.
- Rollback is code-only: restore `GROK_CAPABILITIES.interrupt` to `false`. The executor then stops issuing Grok interrupt signals; assigned session IDs already stored remain valid opaque IDs and need no cleanup.

## Evidence inspected

- Product and design: issue #186; Story 2.6 in `epics.md`; `SPEC.md`; `control-states.md`; `engine-integration.md`; `provider-steering-matrix.md`; `steering-test-plan.md`; sprint status.
- Provider and contracts: Grok provider, event parser, capabilities, usage-contract fixture/tests, binary resolver, provider registry, `AgentRequestOptions`, `ProviderCapabilities`, and `MessageChunk` types.
- Engine end to end: steering registry; direct and loop executor paths; transcript/tool outcome persistence; all existing #183 interrupt tests; e2e-fake and Claude interrupt precedents.
- User/operational surfaces: capability generator and generated matrix; Grok assistant guide; setup/doctor implementation and tests; provider package scripts; Agent Node Room `DESIGN.md`, `EXPERIENCE.md`, reconciliation/validation records, and steering/transcript/Legacy/Console HTML mockups.
- Runtime evidence: installed Grok 1.0.34 help and bundled headless/session/sandbox docs; official Node and Bun process/signal documentation.
- Plan directory: all four draft phases; no co-located design artifacts or reports.

## Remaining decisions owned by Phase 1

These are implementation blockers, not assumptions an engineer may waive:

1. Does SIGTERM preserve a resumable session when Stop arrives immediately after spawn, before any output?
2. Does the actual native Windows launch path exit gracefully and preserve the same session?
3. Does Grok reap a long-running tool child, and what grace interval reliably permits session persistence?
4. What minimum CLI version can be supported and diagnosed honestly?

Phase 2 starts only when the spike report answers all four and records a pass. An evidence failure changes the design or blocks the story; it is not converted into a “known limitation.”
