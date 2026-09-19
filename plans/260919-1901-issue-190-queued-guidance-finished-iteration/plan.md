---
title: 'Issue 190: see queued guidance while viewing a finished iteration'
description: 'Verified delivery plan for the read-only steering dock shown when an operator views a finished iteration of a still-live loop execution.'
status: blocked
priority: P1
effort: '3 phases after the decision gates clear'
issue: 'https://github.com/kevinle128/Archon/issues/190'
branch: archon/thread-177b5b5d
tags: [issue-190, agent-node-room, web, e2e, tdd, feature, frontend]
blockedBy:
  - 'Owner ratification of the reachability contract (new readable-transcript AD; next free number is currently AD-16)'
  - 'Approved narrow-layout treatment for the long disclosure plus Go control at the 460px authority width'
  - 'Issue #188 / Story 2.8 before Story 2.10 can close, because AC 4 requires operator transcript rows'
blocks: []
created: 2026-09-19
reviewed: 2026-09-20
mode: deep
---

# Issue 190: see queued guidance while viewing a finished iteration

## Goal and user outcome

When an operator selects an earlier, completed iteration of a loop execution whose
current iteration is still live, keep the operator oriented without exposing a
mutation that could steer the wrong context:

- show `reading a finished iteration · the agent is working in iteration N` and a
  `Go to iteration N` control;
- mirror the live node's server queue in the existing full-width `queued · n` band,
  but without a composer, send control, or per-message delete action;
- issue only the authenticated node-scoped queue **read** needed to mirror that band;
  issue no send, withdraw, or interrupt mutation while the finished iteration is
  selected;
- return to the actual live iteration and restore the normal composer without
  changing queue order or the tab-local unsent draft;
- continue hiding the dock for a different run, retry epoch, route activation,
  nested-loop invocation, unknown-scope historical row, or terminal node/run; and
- once Story 2.8 is present, show guidance delivered during the selected iteration
  as an operator transcript row and never duplicate that delivered message in the
  pending queue band.

This is the actual Story 2.10 outcome in `epics.md`. The dock-only subset is useful
but is not the complete story: the fourth acceptance criterion cannot pass until
Story 2.8 writes and renders operator rows.

## Verified authority and evidence

### Product and design authority

- GitHub issues #190, #180, #189, and #188 were read with `gh`. Issues #180 and
  #189 are closed by PRs #206 and #213; #188 is open with no closing PR.
- Story 2.10: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md`
  under `Story 2.10`.
- Capability contract: `_bmad-output/specs/spec-agent-node-room/SPEC.md`, CAP-6
  finished-iteration clause and CAP-8/CAP-11.
- Dock states: `_bmad-output/specs/spec-agent-node-room/control-states.md`,
  `Viewing a finished iteration of a live loop node`.
- Queue wire contract: `_bmad-output/specs/spec-agent-node-room/steering-api-contract.md`.
- UX: `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md`, especially the Information Architecture distinction between
  `Execution` filtering and `Jump to` scrolling, the non-live-execution state, and
  the focus/accessibility floor.
- Visual system: the same directory's `DESIGN.md` and final
  `mockups/key-steering-dock.html`. They define the full-width queue band, hide an
  empty queue shell, cap it at `33vh`, require a 460px verification width, and use
  the existing dock typography/surfaces. The mockup does **not** contain the
  finished-iteration state, so it does not settle that state's narrow arrangement.
- Architecture:
  `_bmad-output/planning-artifacts/architecture/architecture-Archon-readable-agent-transcript-2026-09-12/ARCHITECTURE-SPINE.md`, AD-7 amendment and AD-12.
  AD-13 already exists; the next free number is currently AD-16.

### Current code and tests

- Execution identity and selection:
  `packages/web/src/lib/execution-room-model.ts`, both copies of
  `build-log-rows.ts`, `packages/server/src/routes/workflow-execution-history.ts`,
  and `packages/workflows/src/transcript-execution-scope.ts`.
- Legacy flow:
  `LegacyGraphLogsPane` → `LegacyNodeRoom` → `NodeTranscriptPane` →
  `ComposerDock`.
- Console flow:
  `ConsoleInspectPane` → `ConsoleNodeRoom` → `ConsoleComposerDock`.
- Shared queue/mode logic: `packages/web/src/lib/steering-dock.ts` and its test.
- Queue endpoint and route tests: `packages/server/src/routes/api.ts` and
  `api.workflow-runs.test.ts`.
- Executor behavior: direct and loop guidance drains in
  `packages/workflows/src/dag-executor.ts`; the drain currently forwards only
  `item.message` to the provider and does not append operator transcript rows.
- Transcript projection: `packages/web/src/lib/agent-history.ts` currently emits
  only `assistant | tool | lifecycle`, so an operator row is not yet renderable.
- E2E precedents: `agent-queue-guidance.spec.ts`,
  `agent-queue-convergence.spec.ts`, `occurrence-navigation.spec.ts`, the existing
  `e2e-queue-guidance-loop.yaml`, and the Playwright runtime helpers.

## Verified current behavior

1. A selected terminal row makes `steeringDockMode()` return `hidden`; Story 2.10
   has no rendered state today.
2. The header `Execution` select, Legacy Logs list, and graph occurrence selection
   change the selected `LogRow`. The Story 1.7 `Jump to` control only scrolls among
   groups already loaded into one node-scoped transcript and never changes the row.
3. Modern loop occurrence rooms receive one server-filtered occurrence, so their
   Story 1.7 navigator is absent by the recorded AD-7 contract.
4. Server `nodeExecutions` preserve `retry_epoch`, the complete `loop_ancestry`,
   and `route_activation_seq`, but both `LogRowSelection` copies currently discard
   all but the final iteration number. Matching only `(nodeId, retryEpoch)` can jump
   across a different route activation or nested-loop parent invocation.
5. Old event-fallback `loop_iteration` rows do not carry enough identity to prove
   retry, route, or nested-loop equivalence. They must fail closed rather than
   expose a potentially wrong `Go to` target.
6. `GET /api/workflows/runs/:runId/nodes/:nodeId/queue` is the authoritative,
   ordered, no-store queue snapshot. It is a hot-path registry read when the live
   handle is local, returns 422 for a detached live node, and returns 409 for a
   terminal run/node. No server or generated API change is needed.
7. `startQueuePolling()` already serializes reads, aborts on unmount/scope change,
   retries 422/network/5xx, and stops on other 4xx. Existing callers receive no
   read-error signal.
8. The draft key is `(runId, nodeId)`, not iteration-scoped, so the unsent draft
   already survives switching between iterations.
9. Story 2.8 is genuinely absent, not merely stale tracker data: no operator
   metadata exists in `nodeTranscriptMetadataSchema`, executor drains do not write
   receipts, and `AgentHistoryItem` has no operator kind.

## Blocking decisions and dependencies

### B1 — Reachability contract (APPROVED 2026-09-20 — headless adoption of recommended resolution)

There is a normative conflict:

- Story 2.10 and CAP-6 say the finished iteration is selected through the Story 1.7
  iteration selector.
- AD-7 and the shipped implementation say that selector is scroll-only and absent
  for modern loop occurrence rows.
- `EXPERIENCE.md` separately establishes the header `Execution` select as the
  filtering control that can select those occurrence rows.

Recommended resolution: make the **Execution selection** the Story 2.10 entry point
while retaining `Jump to` as scroll-only. Record this as a new readable-transcript
decision (the next free number is currently AD-16, but recheck immediately before
editing) and back-reference it from AD-7. Approval is recorded in the Validation Log below; implementation may proceed against this wording.

The decision must also define “no steering request” precisely: the finished view
performs the existing node-scoped `GET …/queue` read, but exposes and invokes no
send, withdraw, or interrupt mutation. Update all conflicting authority together:
`epics.md`, `SPEC.md`, `control-states.md`, `EXPERIENCE.md`, and the architecture
spine.

### B2 — Narrow visual arrangement (APPROVED 2026-09-20 — headless adoption of recommended wrap arrangement)

The canonical disclosure is too long to remain fully visible beside the Go button
on one visual line at the authoritative 460px room width. `EXPERIENCE.md` says the
dock remains one structural control row under pressure, while `DESIGN.md` and the
final mockup do not contain this state or say whether disclosure text may wrap
inside that row. The repository therefore does not resolve wrapping versus visual
elision for the required complete copy.

Recommended resolution: retain one flex/control row but allow the disclosure text
to wrap inside its flexible cell while the button remains fully visible and at
least 32px high; preserve the complete copy in visible text, avoid horizontal
overflow, and keep the queue band below it. If the owner interprets the generic
one-row rule as one visual text line, the design authority must specify the approved
elision and accessible-name treatment. Record the chosen interpretation in
`DESIGN.md`/`EXPERIENCE.md` before Phase 2.

### B3 — Story 2.8 is a closure dependency, not deferrable scope

Issue #190 may implement and merge the read-only dock before #188, but it must not
claim every Story 2.10 criterion, move the sprint entry to `done`, or close #190
until #188 has landed and AC 4 passes end to end. Do not open a follow-up to waive
the criterion: #188 is already the owning issue.

## Proposed technical decisions (conditional on B1/B2)

### D1 — Resolve live targets in the execution model

Add `resolveFinishedIterationView()` to
`packages/web/src/lib/execution-room-model.ts`, beside the existing execution-row
selection functions. `steering-dock.ts` should consume its small result but should
not own execution-lineage reasoning.

Preserve full ancestry on both local row shapes:

```ts
export interface ExecutionLoopAncestryEntry {
  readonly nodeId: string;
  readonly iteration: number;
}

// Add to the `occurrence` arm in ExecutionRowSelection and both LogRowSelection copies.
readonly loopAncestry?: readonly ExecutionLoopAncestryEntry[];

export interface FinishedIterationView {
  readonly liveRowId: string;
  readonly liveIteration: number;
}
```

Both `build-log-rows.ts` copies map the complete wire `loop_ancestry` into this
camel-case shape while retaining the existing final `iteration` field and labels.

The resolver returns non-null only when all conditions hold:

1. The run is live and the projected node state is `running` or `awaiting`.
2. The selected row is a known-scope server-occurrence row
   (`selection.kind === 'occurrence'`) with non-empty full ancestry; event-fallback,
   node, outer-loop, retry-only, route-only, and `unknownScope` rows fail closed.
3. The selected row is `completed`; its final ancestry entry agrees with the
   selection's displayed iteration.
4. A known-scope candidate for the same `nodeId` is `running` or `awaiting`, carries
   full ancestry whose final entry agrees with its displayed iteration, has the same
   normalized retry epoch, the same route activation, the same final ancestry
   `nodeId`, and the same ancestry prefix excluding the final iteration entry.
5. The candidate iteration is greater than the selected iteration. Prefer
   `awaiting`, then `running`, and latest `order` within that status. Never fall
   back to a terminal row.

This identity prevents crossing retry epochs, route activations, or outer nested-loop
iterations while still supporting a top-level `loop:` and an agent body row repeated
by a `loop_group:`.

### D2 — One explicit dock mode, two thin renderers

Extend `SteeringDockMode` with `finished-iteration`. Its precedence is:

```ts
if (!live) return 'hidden';
if (finishedIteration !== null) return 'finished-iteration';
if (rowStatus !== 'running' && rowStatus !== 'awaiting') return 'hidden';
// existing blocked → detached → composer order remains unchanged
```

The parents that already own the complete row list compute the descriptor once:
`LegacyGraphLogsPane` from `rows`, and `ConsoleInspectPane` from
`logEntries.map(entry => entry.row)`. The result and an existing selection callback
flow through the room chain. The docks render the same content with their existing
surface-specific classes; Console still imports no Legacy component. If a host has
no usable execution-selection callback, it passes no descriptor and exposes no dead
Go button.

### D3 — Read-only band reuses the Story 2.9 queue contract

- Poll in `finished-iteration` mode with the existing 1-second serial loop.
- Render the full-width band only when `sent.length > 0`, as required by the final
  `DESIGN.md` rule against empty queue shells.
- Reuse `queueBandHeader`, `queueListLabel`, server order, message text, and `sent`.
- Omit the textarea, hint, Queue/Send control, and every delete button.
- Bind no mutation handler in this branch. Renderer and E2E tests must observe zero
  send/withdraw/interrupt calls while it is selected.
- Add an optional `onError` callback receiving the normalized `SteeringSendError`.
  Existing callers remain unchanged when it is omitted. The finished mode stores
  read failure separately from send/withdraw refusal: a 422
  `not_steerable_here` clears the displayed read-only snapshot and renders the
  existing `STEERING_DETACHED_DISCLOSURE` as an alert below the finished-iteration
  disclosure; the next successful snapshot clears it. Network/5xx retain silent
  retry and may retain the last successful snapshot. A 409 clears the displayed
  snapshot and stops polling while the normal run refresh removes the dock; never
  label it “detached.”

### D4 — Focus follows the state transition once

The room component that survives the row switch owns a consume-once target ref:
`NodeTranscriptPane` for Legacy and `ConsoleNodeRoom` for Console.

- Clicking Go records `liveRowId`, invokes the existing selection callback, and does
  not mutate queue state.
- After the selected row commits, focus the composer textarea when that row is still
  live; if the target became finished because the loop advanced, focus the new Go
  button; if the dock disappeared because the run ended, focus the transcript
  scroller. Focus never falls to `<body>`.
- Clear the target before focusing so unrelated refetches/remounts never steal focus.

## Scope

### In scope

- Shared execution-lineage resolver and row-shape preservation.
- Shared dock mode/copy/poll error seam.
- Legacy and Console renderers and selection/focus wiring.
- Canonical decision/design records after owner approval.
- Focused unit/renderer tests and one real-loop E2E journey per shell.
- Story 2.10 closure evidence after Story 2.8 lands.

### Out of scope

- Server route, OpenAPI, generated API type, database, or migration changes.
- Implementing Story 2.8 inside this issue.
- An aggregate “all iterations” transcript, changes to the Story 1.7 `Jump to`
  navigator, or client-side fetching across occurrence pages.
- New polling cadence, caching layer, feature flag, or queue endpoint.
- Provider or executor steering behavior changes.

## Architecture

```text
nodeExecutions (retry + full loop ancestry + route activation)
        │
        ├─ Legacy buildLogRows ──► LegacyGraphLogsPane
        └─ Console buildLogRows ─► ConsoleInspectPane
                                      │
                 resolveFinishedIterationView (execution-room-model)
                                      │
                  { liveRowId, liveIteration } | null
                         ┌────────────┴────────────┐
                         ▼                         ▼
             NodeTranscriptPane            ConsoleNodeRoom
                         │                         │
                         ▼                         ▼
                    ComposerDock          ConsoleComposerDock
                         └──── finished-iteration ────┘
                             disclosure + Go + GET-only band
```

## Phases

| #   | Phase                                                                                                | Status    | Gate                          |
| --- | ---------------------------------------------------------------------------------------------------- | --------- | ----------------------------- |
| 1   | [Ratify authority and build the shared execution/dock core](./phase-01-start.md)                     | Unblocked | B1 and B2 recorded 2026-09-20 |
| 2   | [Render and wire both shells](./phase-02-both-shells-render-the-finished-iteration-dock.md)          | Pending   | Phase 1                       |
| 3   | [Prove the real flow and close only after Story 2.8](./phase-03-end-to-end-evidence-and-doc-sync.md) | Pending   | Phase 2 and #188 for closure  |

## File inventory

| File                                                                                                | Planned action                                                                  |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `packages/web/src/lib/execution-room-model.ts` + test                                               | Add full-lineage resolver and matrix                                            |
| Both `components/.../build-log-rows.ts` copies + tests                                              | Preserve full camel-case loop ancestry                                          |
| `packages/web/src/lib/steering-dock.ts` + test                                                      | Add mode/copy and optional polling-error callback                               |
| `ComposerDock.tsx` + test                                                                           | Legacy read-only mode, poll, error, focus target                                |
| `ConsoleComposerDock.tsx` + test                                                                    | Console-equivalent markup/behavior                                              |
| `LegacyGraphLogsPane.tsx`, `LegacyNodeRoom.tsx`, `NodeTranscriptPane.tsx` + focused tests           | Resolve, pass through, select, consume focus                                    |
| `ConsoleInspectPane.tsx`, `ConsoleNodeRoom.tsx` + focused tests                                     | Resolve, pass through, select, consume focus                                    |
| `epics.md`, `SPEC.md`, `control-states.md`, `EXPERIENCE.md`, `DESIGN.md`, readable-transcript spine | Reconcile ratified entry/read/layout contract                                   |
| `steering-test-plan.md`                                                                             | Add Story 2.10 verification IDs                                                 |
| `e2e/ui/agent-finished-iteration.spec.ts`                                                           | Real loop journey on both shells; reuse existing loop fixture/runtime constants |
| `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml`                          | Set Story 2.10 to done only after all ACs, including #188-backed AC 4, pass     |

## Test matrix

| Priority      | Scenario                                                                                                           | Evidence                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| Critical      | Completed iteration and later live iteration in the same lineage resolve to the new mode                           | execution-model unit + shell renderer       |
| Critical      | Different retry epoch, route activation, or outer ancestry prefix fails closed                                     | execution-model unit                        |
| Critical      | Node/event-fallback/outer occurrence/route-only row and non-live run fail closed                                   | execution-model unit                        |
| Critical      | Full ancestry survives both `buildLogRows` implementations                                                         | both build-log-row unit suites              |
| Critical      | Read-only band preserves server order and contains no mutation controls                                            | both dock renderer suites                   |
| Critical      | Finished view performs GET reads and zero send/withdraw/interrupt mutations                                        | renderer spies + E2E network recorder       |
| Critical      | Go selects the resolved live row; queue order and tab-local draft survive                                          | parent integration + E2E                    |
| Critical      | Delivered operator row is inline in the selected occurrence and absent from pending band                           | Story 2.8-backed E2E; closure gate          |
| High          | Awaiting live iteration is a valid target and returns to the blocked composer                                      | unit + renderer                             |
| High          | 422 read shows existing detached disclosure; later 200 clears it; 409 is not called detached                       | polling unit + renderer                     |
| High          | Target advances before click: no composer flash; focus moves to the new Go button                                  | room renderer                               |
| High          | Run ends during click: dock disappears and focus moves to transcript scroller                                      | room renderer                               |
| High          | Empty queue shows disclosure + Go only, with no empty band                                                         | both dock renderers                         |
| High          | Normal composer, blocked, detached, and hidden visibility rows stay unchanged                                      | shared dock regression table                |
| Visual        | Approved layout at 460×900 and 1440×900 has no horizontal overflow; band caps at 33vh                              | E2E measurements/screenshots on both shells |
| Accessibility | DOM order is disclosure → Go → band; exact accessible names; visible focus; activation by keyboard; never `<body>` | renderer + E2E                              |

## Acceptance criteria

- [x] B1 and B2 are explicitly approved and recorded in the Validation Log and
      canonical authorities before implementation begins.
- [ ] A finished iteration is recognized only with proven same-execution lineage;
      uncertain or different execution identities hide the dock.
- [ ] Both shells show the same copy, controls, band semantics, failure state, and
      focus behavior.
- [ ] No steering mutation is reachable or observed from the finished view; the
      existing GET queue read is the only request added by that mode.
- [ ] Returning live restores the correct composer/blocked state, ordered queue, and
      tab-local draft.
- [ ] The approved layout and queue scrolling behavior pass measurable visual
      assertions without overflow at 460×900 and 1440×900.
- [ ] Story 2.8 is merged and the delivered-message inline/no-duplicate criterion
      passes before #190 closes or its sprint entry moves to `done`.
- [ ] Focused tests, affected steering/occurrence E2E specs, and `bun run validate`
      pass; evidence is recorded under `plans/reports/`.

## Operations, compatibility, and rollback

- No persisted data, API shape, deployment setting, or migration changes.
- Added polling has the existing one-request-at-a-time, 1-second cadence and uses
  the server's O(queued items) snapshot hot path. One room mounts one dock; no new
  background process exists.
- Old/unknown-scope rows remain readable but do not gain the new dock because their
  lineage cannot be proven.
- Rollback is a focused revert of web and canonical-doc changes; the prior behavior
  (dock hidden on completed rows) returns immediately.
- Do not change the sprint tracker to `done`, close #190, or use a follow-up issue to
  waive AC 4 while #188 is open.

## Validation Log

- 2026-09-20 plan verification: repository, canonical docs, final mockup, current
  issues, code paths, tests, queue route, executor drains, and E2E harness inspected.
- Existing execution-model, steering-dock, and both build-log-row baseline suites:
  **134 passed, 0 failed** on 2026-09-20.
- All named existing source/test/doc paths were checked; the agent-node-room sprint
  tracker path was corrected to its actual package-specific location.
- B1: **APPROVED 2026-09-20** — headless adoption of this plan's recommended
  resolution (no human owner present). Final wording: the `Execution` selection
  controls (header select, Logs row, graph occurrence) are the Story 2.10
  occurrence-switching entry point; Story 1.7 `Jump to` stays scroll-only; "no
  steering request" means no send/withdraw/interrupt **mutation** while the
  existing authenticated node-scoped `GET …/queue` read is allowed; the band is
  the node's shared pending queue across operators/tabs (Story 2.9). Recorded as
  AD-16 in the readable-transcript spine with a back-reference from AD-7; same
  rule written into `epics.md` Story 2.10, CAP-6, `control-states.md`, and
  `EXPERIENCE.md`.
- B2: **APPROVED 2026-09-20** — headless adoption of this plan's recommended
  resolution. Final wording: one flex/control row; the complete disclosure may
  wrap inside its flexible cell; the Go button stays fully visible and ≥32px
  high; no horizontal overflow; queue band below the control row (only when
  non-empty; 33vh cap). Recorded in `DESIGN.md` (Finished-iteration dock) and
  `EXPERIENCE.md`.
- B3: **verified blocker for closure** — issue #188 is open and operator rows are
  absent from current code. #190 may implement the read-only dock before #188,
  but must not claim AC 4, flip sprint `done`, or close #190 until #188 lands.

## Unresolved questions

1. ~~Approve B1~~ — **resolved 2026-09-20** (Execution selection entry point;
   Jump to scroll-only; mutations banned; GET queue allowed; shared band).
2. ~~Approve B2~~ — **resolved 2026-09-20** (wrap disclosure in flex cell at
   460px; Go ≥32px; band below).

<!-- slug: issue-190-queued-guidance-finished-iteration -->
