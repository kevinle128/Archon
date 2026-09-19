---
title: 'Issue 190 see queued guidance while viewing a finished iteration'
description: 'Implementation-ready plan for the read-only steering dock shown when an operator views a finished iteration of a still-live loop node, on both node-room shells, with a recorded reachability decision.'
status: pending
priority: P1
effort: '3 phases'
issue: 'https://github.com/kevinle128/Archon/issues/190'
branch: archon/thread-177b5b5d
tags: [issue-190, agent-node-room, web, e2e, tdd, feature, frontend]
blockedBy: []
blocks: []
created: 2026-09-19
mode: deep
---

# Issue 190: see queued guidance while viewing a finished iteration

## Goal and user outcome

Story 2.10 (ANR, Epic 2). When an operator opens an **earlier, finished iteration**
of a loop node that is **still running**, the node room must keep them oriented
without letting them steer the wrong thing:

- the dock collapses to one line — `reading a finished iteration · the agent is
  working in iteration N` — plus a `Go to iteration N` control that returns to the
  live iteration;
- below it, a **read-only band** mirrors the node's live registry queue (the same
  `queued · n` list every tab converges on since Story 2.9), with no composer, no
  `Queue`/`Send now`, and no `delete`;
- the client issues **no steering mutation** (no `POST …/send`, `DELETE …/queue/:id`,
  `POST …/interrupt`) for the finished iteration — only the existing `GET …/queue`
  read that the band needs;
- returning to the live iteration restores the normal composer, and the queue keeps
  its server order;
- an operator message already delivered during that iteration is read from the
  transcript's occurrence group, never duplicated in the band;
- viewing a **different non-live execution** (a retry attempt, a different run)
  keeps today's behaviour: the dock is absent.

No server change is required: `GET /api/workflows/runs/:runId/nodes/:nodeId/queue`
is keyed `(runId, nodeId)`, is not iteration-aware, and already returns the live
queue for a running or parked loop handle
(`packages/server/src/routes/api.ts:5487-5555`).

## Authority inspected

- Issue #190 and its blockers #180 (Story 1.7, merged as PR #206) and #189
  (Story 2.9, merged as PR #213).
- Story 2.10 acceptance criteria:
  `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md:704-728`.
- `_bmad-output/specs/spec-agent-node-room/control-states.md:50-58` — the only
  spec prose for this dock state (copy, band semantics, "no steering route call").
- `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md:183`
  — the states table row "Viewing an execution that is not the live one" places the
  finished-iteration dock under the Execution `<select>` and names Story 2.10.
- `_bmad-output/planning-artifacts/architecture/architecture-Archon-readable-agent-transcript-2026-09-12/ARCHITECTURE-SPINE.md:121-133`
  — AD-7 and its 2026-09-19 B1 amendment, which records Story 2.10 as "blocked on a
  future reachability decision, which would be a new AD if it is ever taken".
- `plans/260918-1711-issue-180-navigate-occurrences-and-loop-iterations/plan.md:104-120`
  — the B1 record and the reachability table.
- Current code: `packages/web/src/lib/steering-dock.ts`,
  `packages/web/src/components/workflows/{ComposerDock,NodeTranscriptPane,LegacyNodeRoom,LegacyGraphLogsPane,build-log-rows,resolve-graph-room-row}.tsx|ts`,
  `packages/web/src/experiments/console/components/{ConsoleComposerDock,ConsoleNodeRoom,ConsoleInspectPane}.tsx`,
  `packages/web/src/lib/execution-room-model.ts`,
  `packages/server/src/routes/workflow-execution-history.ts`,
  `e2e/fixtures/workflows/e2e-queue-guidance-loop.yaml`, `e2e/ui/agent-queue-convergence.spec.ts`.

## Recorded decisions

### D1 — Reachability: the Execution selection is the entry point (needs owner ratification)

The B1 amendment on AD-7 left Story 2.10 blocked because the Story 1.7 **navigator**
(`Jump to` select) only scrolls within one node-scoped transcript; it never changes
the selected row, so it cannot put the room "on" a finished iteration. The room does,
however, already reach that state through the **Execution selection**: the header
`<select aria-label="Execution">` (`NodeRoomHeader.tsx:64-76`, `ConsoleRoomHeader`),
the Legacy Logs list (`NodeRunList`), and graph occurrence rows all switch
`selectedRow` to an iteration-scoped `LogRow` (`selection.kind === 'occurrence'`
carrying `iteration`, built from server `nodeExecutions` in `build-log-rows.ts:99-112`).
`EXPERIENCE.md:183` already describes this dock state under exactly that control.

This plan adopts that reading as the reachability decision. It is a **reinterpretation**
of the AC's phrase "selected through Story 1.7" (the navigator cannot select an
iteration), and per the amendment's own rule it is recorded as a **new AD** in the
readable-transcript spine (next free number, "AD-13 — Finished-iteration reachability
for steering"), cross-linked from AD-7, not as another amendment:

> A **finished iteration of a live loop node** is a room whose selected row carries an
> iteration number (`selection.kind === 'occurrence'` with `iteration`, or the
> event-fallback `loop_iteration`), whose row `status` is terminal
> (`completed` | `failed` | `skipped`), while the node's live projection
> (`WorkflowNodeStateResponse.status` for that `nodeId`) is `running` | `awaiting`,
> the run is live, and a non-terminal iteration row exists for the same node (the
> `Go to iteration N` target). The Story 1.7 `Jump to` navigator is **not** an entry
> point and is untouched.

Note on the node-scoped path: modern loop nodes opened through their occurrence rows
never show the Story 1.7 navigator (AD-7 B1); the navigator appears only on
historical/fallback **node-scoped** rows that carry several occurrences. That row
type keeps the live composer and is covered as a regression case, not as a loop case.

Today that path returns `steeringDockMode() === 'hidden'`
(`steering-dock.ts:68-80` — a terminal `rowStatus` hides the dock), so selecting
iteration 1 while iteration 3 runs removes the dock entirely. Phase 1 records the
decision as new AD-13 (back-referenced from AD-7) and in `control-states.md`, only
after the owner ratifies it; the decision is the first validation question. **Nothing here claims 2.10 is unblocked until that record
exists.**

### D2 — One new dock mode, computed by the shared core

`SteeringDockMode` gains `'finished-iteration'`. The predicate and the
`Go to iteration N` target resolver are pure functions in `lib/steering-dock.ts`
(framework-free, shared by both shells per the existing pattern). The parent that
already owns the row list computes the target once and passes one prop down; the
dock never re-derives it from DOM or from the transcript.

### D3 — Band semantics reuse Story 2.9 verbatim

The read-only band is the existing `queued · n` band (`queueBandHeader`,
`queueListLabel`, `applyQueueSnapshot`, `startQueuePolling`) rendered **without** the
delete button, textarea, hint, or `Queue` control. It shows only server-pending items,
which is what makes the "delivered message is not repeated in the band" criterion
hold by construction. `GET …/queue` polling is enabled in the new mode; a `422`
(detached run) keeps polling silently as today (`steering-dock.ts:400-410`) and the
band never renders (a band renders only when it holds something); the new mode also
surfaces the read refusal as a `not steerable here` line (red-team Finding 4).

### D4 — Scope boundaries stated so no reviewer re-derives them

- "Client sends no steering request" is read as **no mutation** (`send`,
  `queue/:id` delete, `interrupt`). The `GET …/queue` read is required by the band and
  is asserted, not forbidden.
- The inline half of the fourth acceptance criterion ("the delivered message appears
  inline in its occurrence group") is Story 2.8's operator row (`origin='operator'`),
  which `sprint-status.yaml` still lists as `backlog` and the issue does not list as
  a blocker. This plan guarantees the band side (pending-only) and records the inline
  side as verified once 2.8 lands; it adds no operator-row rendering.
- A retry attempt (`Run 1` while `Run 2` runs) carries no `iteration`, so it stays
  `hidden` per `EXPERIENCE.md:183`. A different run is `live === false` and stays
  hidden. Both are negative tests.
- The unsent draft is already node-scoped (`steeringDraftStorageKey(runId, nodeId)`),
  so it survives switching iterations without new work; the finished-iteration dock
  never renders it.
- At the exact iteration boundary (iteration N finished, N+1 not yet started) no
  non-terminal iteration row exists; the resolver returns `null` and the dock stays
  hidden for that window, exactly as today, then re-renders on the next run-data
  refetch. Accepted and documented; no timer or guess is added.

## Architecture

```text
LegacyGraphLogsPane (rows, selectedRow, onSelectExecution)        ConsoleInspectPane (logEntries, selectedRow, onSelectNode)
        │ resolveFinishedIterationView(rows, selectedRow, nodeStatus, live)   │
        ▼                                                                      ▼
LegacyNodeRoom ──► NodeTranscriptPane ──► ComposerDock            ConsoleNodeRoom ──► ConsoleComposerDock
        finishedIteration: { liveRowId, liveIteration } | null + onGoToIteration(rowId)
                                   │
                                   ▼
                  steeringDockMode({ live, rowStatus, hasPendingAsk, refusal, finishedIteration })
                                   │
              'finished-iteration' ─┴─► one-line disclosure + `Go to iteration N` + read-only queue band
                                        polling: GET /queue only; no textarea, no Queue, no delete
```

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Record the reachability decision and build the shared dock core](./phase-01-start.md) | Pending |
| 2 | [Both shells render the finished-iteration dock](./phase-02-both-shells-render-the-finished-iteration-dock.md) | Pending |
| 3 | [End-to-end evidence and doc sync](./phase-03-end-to-end-evidence-and-doc-sync.md) | Pending |

Deep mode: Phase 1 is fully scouted and detailed; Phases 2 and 3 are outlined with
their file ownership and test matrices and receive a dedicated scout pass before
execution (`/ak:cook` runs it per phase).

## Dependency map

- Phase 1 → Phase 2: gated on the D1 approval record; the mode, copy constants, and resolver exported from
  `lib/steering-dock.ts` are consumed by both docks and both parents.
- Phase 2 → Phase 3: E2E drives the rendered controls; doc sync cites the shipped
  markup.
- External: Story 2.8 (operator rows) for the inline half of AC 4 — recorded, not
  blocking.

## File inventory

| File | Action | Size | Test impact |
|------|--------|------|-------------|
| `packages/web/src/lib/steering-dock.ts` | modify | +80 lines | `steering-dock.test.ts` (Phase 1) |
| `packages/web/src/lib/steering-dock.test.ts` | modify | +150 lines | new mode/resolver cases |
| `packages/web/src/components/workflows/ComposerDock.tsx` | modify | +70 lines | `ComposerDock.test.tsx` |
| `packages/web/src/experiments/console/components/ConsoleComposerDock.tsx` | modify | +70 lines | `ConsoleComposerDock.test.tsx` |
| `packages/web/src/components/workflows/NodeTranscriptPane.tsx` | modify | +10 lines | `NodeTranscriptPane.test.tsx` |
| `packages/web/src/components/workflows/LegacyNodeRoom.tsx` | modify | +6 lines | `LegacyNodeRoom.test.tsx` |
| `packages/web/src/components/workflows/LegacyGraphLogsPane.tsx` | modify | +12 lines | `LegacyGraphLogsPane.test.tsx` |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx` | modify | +10 lines | `ConsoleNodeRoom.test.tsx` |
| `packages/web/src/experiments/console/components/ConsoleInspectPane.tsx` | modify | +12 lines | `ConsoleInspectPane.test.tsx` |
| `e2e/ui/agent-finished-iteration.spec.ts` | create | ~400 lines | Playwright, both shells |
| `e2e/fixtures/workflows/e2e-finished-iteration-loop.yaml` + `archon-runtime.ts` wiring | create/modify | ~20 lines | E2E fixture with a 60 s iteration window |
| `_bmad-output/.../ARCHITECTURE-SPINE.md` (readable-transcript) | modify | new AD-13 + back-reference on AD-7 | doc |
| `_bmad-output/specs/spec-agent-node-room/control-states.md` | modify | +3 lines | doc |
| `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml` | modify | 1 line | issue AC |

## Test scenario matrix

| Path | Scenario | Level | Phase |
|------|----------|-------|-------|
| Critical | Finished iteration of a live loop node → `'finished-iteration'` mode; disclosure copy names live iteration N | unit + renderer | 1, 2 |
| Critical | Read-only band lists the polled queue in server order; no delete/textarea/Queue in the DOM | renderer | 2 |
| Critical | Zero mutation requests while viewing the finished iteration; `GET …/queue` observed | renderer (fake API) + E2E | 2, 3 |
| Critical | `Go to iteration N` selects the live row; composer + queue return; order unchanged; focus not on `<body>` | renderer + E2E | 2, 3 |
| High | Retry attempt of a live node (no `iteration`) → `hidden` | unit + renderer | 1, 2 |
| High | Finished iteration of a **non-live** run → `hidden` | unit + E2E | 1, 3 |
| High | Historical/fallback node-scoped row with several occurrences (the only place the Story 1.7 navigator renders) → unchanged live composer | unit + renderer | 1, 2 |
| High | A retry attempt or second run (`Run 2` live, `Run 1` selected) → dock absent (AC 5 proper) | unit + E2E | 1, 3 |
| Medium | Live iteration advances between render and click of `Go to iteration N` → lands on a now-finished row and re-renders as finished-iteration for the new live N; no intermediate composer flash | renderer | 2 |
| Medium | Unrelated remount of the same scope after a completed `Go to iteration N` does not steal focus (consume-once ref) | renderer | 2 |
| High | Live loop node is `awaiting` (ask pending on live iteration) → still `'finished-iteration'`; band read-only | unit | 1 |
| Medium | Iteration boundary: no non-terminal iteration row → resolver `null` → `hidden` | unit | 1 |
| Medium | Poll `422` in finished-iteration mode → no disclosure change, band stays empty | renderer | 2 |
| Medium | Draft typed on the live iteration survives a visit to a finished iteration and back | renderer | 2 |
| Medium | Both shells at 460px: single-line disclosure, band scrolls within `max-h-[33vh]` | E2E screenshot | 3 |

## Success criteria

- [ ] D1 is ratified and recorded in AD-7 and `control-states.md` before Phase 2 markup lands.
- [ ] Story 2.10 acceptance criteria in `epics.md:704-728` are satisfied on Legacy and Console, with the AC-4 inline half explicitly deferred to Story 2.8.
- [ ] Unit, renderer, and E2E evidence recorded under `plans/260919-1901-issue-190-queued-guidance-finished-iteration/reports/`.
- [ ] `bun run validate` passes; `sprint-status.yaml` entry moved to `done` in the PR that closes #190.

## Risks

| Risk | Mitigation |
|------|------------|
| Owner rejects D1 (wants a different entry point) | Phase 1 stops at the record; no markup is written against an unratified path. |
| Two `LogRow` types (Legacy and Console copies) drift | The resolver takes a minimal structural row type; both parents satisfy it without casts. |
| Band polling doubles request volume when both a live and a finished view are open | Same 1 s cadence as Story 2.9 per mounted dock; one dock per room; no new endpoint. |
| Focus lands on `<body>` after `Go to iteration N` remounts the dock | Explicit focus handoff to the composer field on mount (Phase 2), covered by renderer test. |

## Rollback

All changes are additive web-only code plus doc text. Reverting the PR restores the
`hidden` behaviour with no data or API impact.

## Unresolved questions (for the validation gate)

1. Ratify D1 — the Execution selection is the entry point for "finished iteration selected through Story 1.7"; the Jump-to navigator stays scroll-only.
2. Band visibility — render the read-only band only when the queue is non-empty (mirrors the existing draft-box rule) versus always rendering an empty `queued · 0` shell.
3. `Go to iteration N` focus target — composer field (recommended) versus the room scroller.
4. Iteration-boundary window — accept the brief `hidden` dock (recommended) versus targeting the outer loop occurrence row with generic copy.
5. Story closure with AC-4's inline half deferred to Story 2.8 — mark `done` plus a tracked follow-up issue (recommended) versus holding the story in an intermediate status until 2.8 ships.

Gate state as of 2026-09-20: the red-team session below is recorded and applied; the
validation interview (questions 1–5) was offered and **deferred by the operator** in
the planning session, so it is deliberately unanswered — run `/ak:plan validate` on
this directory (or answer the five questions) before cooking. D1 is unratified until
question 1 is answered; Phase 1 stops at the record if it is rejected.

## Red Team Review

### Session — 2026-09-20 (Security Adversary, Failure Mode Analyst, Assumption Destroyer)
**Findings:** 16 (14 accepted, 2 duplicates)
**Severity breakdown:** 2 Critical, 6 High, 8 Medium

| # | Finding | Severity | Disposition | Applied To |
|---|---------|----------|-------------|------------|
| 1 | D1 ratification was a checklist item, not a blocking gate | Critical | Accept | Phase 1 Requirements (GATE), Phase 2 frontmatter `gate` |
| 2 | `control-states.md` still says "the operator's" queue; band is cross-operator since 2.9 | Medium | Accept | Phase 1 Doc records item 3 |
| 3 | Closing the story with AC-4's inline half unmet | High | Accept | Validation question 5; Phase 3 sprint-status step |
| 4 | Empty band indistinguishable from failing reads (422) in the new mode | Medium | Accept | Phase 1 `onRefusal` hook; Phase 2 requirement + test |
| 5 | `loop_group` body rows never exercised by the resolver tests | Medium | Accept | Phase 1 scout pass + fixture |
| 6 | `sprint-status.yaml` known-stale for 1.7/2.1 yet used as the done marker | Medium | Accept | Phase 3: name stale entries in the PR description |
| 7 | D1 must be a new AD (spine rule) and is a reinterpretation of the AC; navigator never renders for modern loops | Critical | Accept | plan.md D1; Phase 1 Doc records; matrix row relabelled |
| 8 | 25 s loop fixture leaves no E2E margin for screenshots + network capture | High | Accept | Phase 3: dedicated 60 s fixture |
| 9 | No enforced gate between Phase 1 and Phase 2 | High | Duplicate of #1 (already applied) | — |
| 10 | Focus-handoff ref has no specified reset point | Medium | Accept | Phase 2 focus handoff: consume-once effect + test |
| 11 | `Go to iteration N` target can go stale between render and click | Medium | Accept | Phase 2 requirement + matrix row |
| 12 | Phase 3 step 8 mislabels a same-run revisit as AC 5 | Medium | Accept | Phase 3 Journey A: second-run case added; step 8 relabelled |
| 13 | Resolver cannot exclude a different retry epoch of the same loop node | High | Accept | Phase 1 `IterationRowLike.retryEpoch` + candidate rule + test |
| 14 | E2E drain window measured from iteration start, tighter than stated | High | Duplicate of #8; elapsed-time annotations added | Phase 3 step 9 |
| 15 | "Mirrors `chooseExecutionForNode`" invites porting its terminal-row fallback | High | Accept | Phase 1 step 5 reworded + null test |
| 16 | Questions 2 and 4 are pre-encoded in pseudocode without a gate | Medium | Accept | Phase 1 step 5 and Phase 2 render branch marked provisional |

Contract verification: all six changed contracts (`steeringDockMode`, both dock
mounts, `NodeTranscriptPane`, `LegacyNodeRoom`, `ConsoleNodeRoom`) have exactly one
production caller each; all accounted for. Flow traces (dock remount on iteration
switch, `GET …/queue` 200 for a live/parked loop handle, 422 retry / 409 stop, loop
node status stays `running` across iterations) all hold.

### Whole-Plan Consistency Sweep — 2026-09-20
Decision deltas applied across all files: D1 is a new AD (AD-13) not an amendment;
the Story 1.7 navigator is a regression case, not a loop entry point; the read-only
mode surfaces read refusals via `onRefusal`; the resolver scopes candidates by
`retryEpoch` and never falls back to a terminal row; the E2E uses a dedicated 60 s
fixture; AC 5 has its own second-run case; story closure is validation question 5.
Searched all four files for the superseded terms ("dated amendment on AD-7",
"mirrors `chooseExecutionForNode`", "25 s window", "(AC 5)" on step 8,
"no change is needed for the read-only mode"); none remain. No contradictions
outstanding. The validation interview (questions 1–5) is still the open gate.

Fact-check: 22 citations sampled, all verified (minor line offsets on three). One
framing correction folded into D3: the existing `detached` mode does not poll; the
"422 keeps polling" behaviour belongs to composer/blocked polling, which the new mode
extends.

<!-- slug: issue-190-queued-guidance-finished-iteration -->
