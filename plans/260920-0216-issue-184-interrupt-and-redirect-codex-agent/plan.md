---
title: 'Issue 184 interrupt and redirect a running Codex agent'
description: 'Implementation plan for Story 2.4: stop only the active Codex turn, preserve its thread, and apply queued guidance on that same thread.'
status: ready
priority: P1
effort: '3 phases'
issue: 'https://github.com/kevinle128/Archon/issues/184'
branch: archon/thread-cad139be
tags: [issue-184, agent-node-room, providers, workflows, codex, web, tdd]
blockedBy: []
blocks: []
created: 2026-09-20
revised: 2026-09-20
---

# Issue 184: interrupt and redirect a running Codex agent

## Goal and user outcome

While a Codex-backed workflow node is generating, an operator can press `Stop` to end only the current provider turn. The node stays `running` and moves to `idle-after-interrupt`; an unfinished tool row becomes `⚠ interrupted`. `Send now` then delivers the queued correction on the **same Codex thread**, in receipt order, without silently starting a fresh conversation.

The project need is exactly Story 2.4 in `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md`: bring Codex onto the provider-independent interrupt/redirect path shipped by Story 2.3. It does not require a new route, registry, sub-state, transcript shape, or persistence model.

## Verified authority and constraints

1. Issue #184 and Story 2.4 acceptance criteria in `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md` define the outcome.
2. `_bmad-output/specs/spec-agent-node-room/SPEC.md` and its listed companions are the canonical product, engine, provider, and UX contract. `EXPERIENCE.md` wins over mockups when they disagree.
3. Story 2.3's implementation in `packages/workflows/src/dag-executor.ts`, `packages/workflows/src/steering-registry.ts`, the interrupt server route, both web shells, and `e2e/ui/agent-interrupt-redirect.spec.ts` is the compatibility baseline.
4. `@openai/codex-sdk` is declared as `^0.144.5`, while `bun.lock` resolves exactly `0.144.5`. This story does not upgrade it. Runtime behavior must be measured at the locked version before the capability is exposed.

Important constraints discovered in the current code:

- `CodexProvider.sendQuery()` currently passes one per-attempt controller to the SDK and to `streamCodexEvents()`. That signal represents node Cancel today. Operator Stop must not make the normalizer mistake the new turn-scoped interrupt for node Cancel.
- A new Codex thread has no resumable id until the stream yields `thread.started`. Killing the subprocess before retaining that id makes the same-thread acceptance criterion impossible.
- Codex's crash classifier treats strings containing `killed`, `signal`, or `codex exec` as retryable and retries with `startThread()`. That cold retry is forbidden after an operator interrupt and on a strict guidance resume.
- The executor recognizes only terminal reasons in `INTERRUPT_TERMINAL_REASONS`; a new normalized marker and the Codex capability flip must therefore ship atomically.
- A guidance turn already passes the interrupted session id with `forkSession: false`. For Codex this is the existing, typed indication that the caller requires in-place continuation; it can be used to prohibit the provider's legacy cold-start fallback without adding another request option.
- The shipped disclosure says the turn stopped "after the last completed tool call". Codex stream-abort can terminate a command while it is running, so that statement is false for this provider. The canonical UX and shipped copy must be corrected in this story.
- Archon publishes Linux, macOS, and Windows binaries, while provider capability is not platform-scoped. Subprocess abort and descendant cleanup must therefore pass on all three native OS families before Codex interrupt is advertised globally; WSL is Linux evidence, not native Windows evidence.

## Solution contract

### 1. Measure the locked SDK before enabling anything

Add a credentialed, bounded real-SDK spike which records the exact abort terminal shape, event ordering, iterator settlement, thread-id availability, descendant-process cleanup, and resume continuity at runtime version `0.144.5`. The spike is diagnostic only: Phase 1 changes no capability or production path. An unknown or unsafe result blocks implementation rather than being generalized into a broad error matcher.

### 2. Separate node Cancel from operator Stop

For each provider attempt, keep three distinct facts:

- the raw node `abortSignal` (whole-node Cancel);
- the raw operator `interruptSignal` (turn-only Stop intent);
- the per-attempt controller passed to `runStreamed()`.

Node Cancel always aborts the attempt and wins if both signals fire. Operator Stop aborts the attempt only after a resumable thread id is known. On a fresh thread, an early Stop is held until `thread.started` is consumed and its id retained; on a resumed thread the id is already known. The stream normalizer must continue consuming any already-buffered `item.completed` event so a completed tool remains successful.

The provider emits the shared normalized terminal marker `STREAM_ABORT_TERMINAL_REASON = 'stream_aborted'` only when there is positive evidence that this provider attempt ended because Archon forwarded that operator interrupt. The exact thrown/result/clean-close variant or narrow OS-specific variants accepted as evidence are pinned by Phase 1. A natural `turn.completed` wins a race. An unknown exception or unrelated `turn.failed` remains a real failure even if Stop was pressed; generic `killed`/`signal` string matching is not sufficient evidence.

An operator interrupt never enters the cold retry path. If it arrives during retry backoff, the delay ends immediately and the preceding unmarked provider error is surfaced; Stop did not cause that error and must not reclassify it. Node Cancel keeps the existing `Query aborted` contract.

### 3. Enforce same-thread redirect

When `resumeSessionId` is present and `forkSession === false`, Codex must either use `resumeThread(resumeSessionId)` or fail explicitly. In this strict in-place mode:

- synchronous `resumeThread()` failure must not fall back to `startThread()`;
- the skill-catalog compatibility retry may recreate the client, but it must resume the same id or fail;
- a later subprocess crash must not cold-retry with `startThread()`.

Calls whose `forkSession` is `true` or omitted retain the current best-effort fallback behavior. Codex does not support AskHuman, so the only current Codex workflow caller using `forkSession: false` is the guidance continuation this story must protect.

### 4. Enable the executor path atomically

Export the marker from `@archon/providers/types`, add it to the executor's interrupt-terminal set, implement and test the provider behavior, then set `CODEX_CAPABILITIES.interrupt` to `'stream-abort'` in the same deliverable. There must be no intermediate revision that advertises Stop while the executor can classify its terminal result as natural completion.

### 5. Make the stop state truthful for every provider

Replace the idle disclosure with:

`turn stopped · in-flight work may be partial · written files stay written`

This remains provider-neutral, states that Stop is not node Cancel or undo, and covers both between-tool native interrupts and a mid-tool stream kill. Update the canonical spec/UX artifacts first, then the shared web constant, both shells' assertions, the current steering mockup/handoff, and the existing two-shell Playwright scenario.

## Scope

In scope:

- a real Codex SDK interrupt/resume gate and plan-local sanitized report;
- correct signal ownership, deferred early abort, exact terminal normalization, retry suppression, listener cleanup, and strict same-thread resume in `CodexProvider`;
- the shared terminal constant, executor recognition, and the Codex capability flip as one feature slice;
- focused provider tests plus direct, AI-loop, and loop-group executor conformance;
- the truthful stop disclosure across canonical/current design artifacts, both shipped shells, unit tests, and existing visual/e2e evidence;
- generated capability docs, provider/test companions, acceptance evidence, and sprint status.

Out of scope:

- new server routes or schemas, steering-registry behavior, database changes, durable queue state, or new event kinds;
- Codex app-server `turn/steer`, soft injection, SDK upgrades, or other providers' interrupt stories;
- undo/rollback of filesystem writes, a Stop/Send-now rate limit, detached-run steering, idle expiry, or delivery confirmation;
- changing best-effort resume behavior for ordinary Codex session reuse where `forkSession` is not explicitly `false`.

## End-to-end flow

```mermaid
sequenceDiagram
    participant UI as Composer dock
    participant REG as Live steering handle
    participant EX as DAG executor
    participant CX as CodexProvider
    participant SDK as Codex SDK / codex exec

    EX->>REG: beginTurn(fresh interrupt controller)
    EX->>CX: sendQuery(prompt, resumeId?, {node abort, turn interrupt})
    CX->>SDK: runStreamed(..., per-attempt signal)
    SDK-->>CX: thread.started(id), then tool events
    UI->>REG: Stop
    REG-->>CX: turn interrupt aborts
    CX->>SDK: abort per-attempt signal after id is retained
    SDK-->>CX: measured abort terminal shape
    CX-->>EX: result(id, terminalReason='stream_aborted')
    EX->>EX: settle open tool interrupted; enter idle-after-interrupt
    UI->>EX: Send now
    EX->>CX: guidance + same resumeId + forkSession=false
    CX->>SDK: resumeThread(same id); never startThread fallback
```

## Phases

| #   | Phase                                                                                                        | Depends on | Exit condition                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | [Measure the Codex abort/resume protocol](./phase-01-codex-stream-abort-seam-and-real-sdk-gate.md)           | —          | Locked SDK passes every safety and continuity gate; no production capability changed.                                                      |
| 2   | [Implement the provider/executor slice and conformance](./phase-02-executor-marker-and-codex-conformance.md) | 1          | Provider and executor tests prove safe interrupt, exact classification, and strict same-thread redirect; capability is enabled atomically. |
| 3   | [Correct UX truth, regenerate docs, and close out](./phase-03-closeout-matrix-docs-sprint-status.md)         | 2          | Canonical/current UX, two-shell UI evidence, generated docs, full validation, and acceptance record agree.                                 |

## Acceptance criteria

- [ ] **Stop ends only the active turn.** For a generating Codex node, Stop aborts only the SDK attempt, not the node signal; the node remains `running`, projects `idle-after-interrupt`, writes exactly one `interrupted` status row, runs no validation/re-ask, and emits no node-failure event.
- [ ] **Early Stop remains resumable.** On a new thread, an interrupt requested before `thread.started` is not forwarded until the non-empty thread id is retained. The terminal marker always carries that id. Failure before an id is ever produced remains a real failure, not a fabricated resumable stop.
- [ ] **Send now uses the same thread.** The next guidance turn receives the interrupted id and `forkSession: false`; Codex calls `resumeThread()` with that exact id. Every synchronous, compatibility, or retry fallback that would call `startThread()` is prohibited in this strict path and fails visibly.
- [ ] **Transcript and ordering stay correct.** An open tool settles once as `toolOutcome: 'interrupted'` (`⚠`); an already completed tool stays successful; previously queued messages plus the new Send-now message are delivered in server receipt order.
- [ ] **Classification is evidence-based.** A measured, operator-forwarded abort becomes `stream_aborted`; a natural completion racing Stop remains natural; node Cancel remains `Query aborted`; an unknown/unmarked exception or unrelated `turn.failed` is a real failure and never a cold retry.
- [ ] **Direct and loop paths conform.** Direct AI, AI loop, and provider-calling loop-group body coverage proves the same idle/resume behavior and namespaced handle behavior already established for Claude, without duplicating the entire provider-independent Story 2.3 matrix.
- [ ] **The UI tells the truth.** In both Legacy and Console idle states the exact disclosure is `turn stopped · in-flight work may be partial · written files stay written`; Stop is absent, `Send now` and `WILL SEND` are present as applicable, and the interrupted tool uses `⚠`, not failure styling.
- [ ] **Visual/accessibility contract holds.** At Legacy 460px, Console's 520px reference panel, and both shells' 460px responsive state, the disclosure is a single readable line with no clipping or horizontal overflow; generating, `Stopping…`, idle, and generating-again layouts preserve control positions, focus, `aria-disabled`, live announcements, and reduced-motion behavior.
- [ ] **Operational gate passes.** On native Linux, macOS, and Windows, the locked-SDK spike reports no unhandled rejection/exception, hung iterator, lost thread context, or surviving captured descendant; focused tests, generated-doc checks, `bun run validate`, and the targeted Playwright scenario pass before sprint status becomes `done`.

## Compatibility, operations, and rollback

- No API, database, workflow YAML, transcript schema, or durable-state migration changes.
- Interrupted Codex turns may have no usage record because usage arrives on `turn.completed`; existing aggregation already accepts absent usage.
- Stop is not undo. A killed command may leave partial filesystem or external side effects; the revised disclosure states this. The engine must not attempt speculative cleanup.
- Any `unhandledRejection` or `uncaughtException` observed by the spike blocks the feature. Do not broaden the server's process-level rejection allowlist: that would hide an SDK/process-lifecycle defect and continuing after an uncaught exception is unsafe.
- Each Stop/Send-now cycle launches another `codex exec`; no new cycle bound is introduced. Existing authorization, queue ordering, and provider rate limits remain the governing controls.
- Rollback is one coherent slice: set Codex interrupt back to `false` and revert its interrupt normalization. The shared marker recognition and truthful disclosure are safe to retain; no data rollback is required.

## Remaining execution gate

The exact terminal behavior of the locked SDK after its subprocess signal is deliberately unresolved until Phase 1 runs with a usable Codex credential and binary on the supported OS matrix. Phase 1 defines pass/fail criteria and permitted implementation shapes. If the iterator hangs, a new-thread id cannot be retained before abort, resume loses context, process descendants survive, an unhandled process error occurs, or an OS family cannot be verified, do not enable the static capability and do not weaken the acceptance criteria; record the result as blocked in the spike report.
