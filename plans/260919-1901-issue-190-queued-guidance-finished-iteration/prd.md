# PRD — Issue #190: See queued guidance while viewing a finished iteration

Source plan: `./plan.md` + `./phase-01-start.md`, `./phase-02-both-shells-render-the-finished-iteration-dock.md`, `./phase-03-end-to-end-evidence-and-doc-sync.md` (same directory). GitHub issue: `https://github.com/kevinle128/Archon/issues/190`. Epic story: Story 2.10 in `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md`.

## Overview / problem

When an operator selects an earlier, **completed** iteration of a loop execution whose
current iteration is still live, the steering dock renders nothing today:
`steeringDockMode()` (`packages/web/src/lib/steering-dock.ts:68`) returns `hidden`
for any terminal row. The operator loses orientation — they cannot see that the agent
is working in a later iteration, cannot see the node's shared pending-guidance queue,
and have no safe way back to the live iteration.

The danger being avoided: exposing a composer or any send/withdraw/interrupt control
aimed at the wrong execution context. Any guidance sent while viewing iteration 1
would land on the live iteration — so the finished view must be strictly read-only.

## Solution

Add a fourth steering-dock mode, `finished-iteration`, shown only when identity is
proven:

- Disclosure `reading a finished iteration · the agent is working in iteration N`
  plus a native `Go to iteration N` button.
- The existing full-width `queued · n` band mirrors the live node's server queue
  (server order, `sent` labels, `max-h-[33vh]`) — read-only: no textarea, no send
  hint, no Queue/Send control, no per-message delete, no bound mutation handler.
- The only new request the mode performs is the existing authenticated node-scoped
  `GET /api/workflows/runs/:runId/nodes/:nodeId/queue` poll (1 s serial loop already
  in `startQueuePolling`, `steering-dock.ts:380`).
- `Go` returns to the resolved live row through the **existing** execution-selection
  callback — no new selection state — restoring composer, focus, queue order, and the
  tab-local draft (draft key is `(runId, nodeId)`, iteration-agnostic).
- Fail closed (dock stays `hidden`) for: different run, different retry epoch,
  different route activation, different nested-loop ancestry prefix, unknown-scope
  rows, old event-fallback rows, terminal node/run, non-occurrence selections.
- AC 4 (delivered guidance shown once as an operator transcript row, absent from the
  pending band) is gated on issue #188 / Story 2.8 — merged separately, not
  implemented here.

## Decisions adopted for this headless run

The plan lists B1/B2 as owner-blocking decisions with recommended resolutions. No
human is available; adopt the recommendations verbatim and record them as ratified:

- **B1 — entry point + request semantics.** The `Execution` selection controls
  (header select, Logs row, graph occurrence) are the Story 2.10 entry point; Story
  1.7 `Jump to` stays scroll-only. "No steering request" means no send, withdraw, or
  interrupt **mutation**; the `GET …/queue` read is allowed. The band is the node's
  shared pending queue across operators/tabs (Story 2.9 semantics). Record as a new
  AD in the readable-transcript spine — headings are `### AD-n`; AD-15 is the
  highest today so AD-16 is next, but re-scan `### AD-` immediately before editing —
  and back-reference it from AD-7.
- **B2 — 460px layout.** One flex/control row; the complete disclosure may wrap
  inside its flexible cell; the Go button stays fully visible and ≥32px high; no
  horizontal overflow; queue band below the control row. Record in `DESIGN.md` +
  `EXPERIENCE.md`.
- **B3 — closure gate.** #190 may implement/merge the read-only dock before #188
  lands, but Story 2.10 is not `done`, #190 is not closed, and AC 4 is not claimed
  until #188 merges and its criterion passes end to end. Early PRs use `Refs #190`;
  only the completion PR uses `Closes #190`.

## Goals and success metrics

Maps 1:1 to the plan's acceptance criteria (plan.md §Acceptance criteria) and
Story 2.10 ACs:

- **AC 1** — finished occurrence selected via the ratified Execution entry point
  shows exact disclosure + Go control on **both** shells (Legacy and Console).
- **AC 2** — live node queue mirrors read-only, in server order, only when
  `sent.length > 0` (no empty band shell).
- **AC 3** — no mutation control rendered and zero send/withdraw/interrupt requests
  observed while finished is selected (renderer spies + E2E request recorder).
- **AC 4** — after #188: delivered guidance appears exactly once as an operator
  transcript row in the selected occurrence and never duplicates in the pending band.
- **AC 5** — `Go` restores composer/blocked state, focus, queue order, and unsent
  draft; unrelated identities and non-live runs keep the dock hidden.
- Measurable visuals: no horizontal overflow at 460×900 and 1440×900; band caps at
  33vh; Go ≥32px; DOM order disclosure → Go → alert → band; focus never lands on
  `<body>`.
- Gates: focused unit/renderer tests, affected steering/occurrence E2E specs, and
  `bun run validate` all pass; evidence under `plans/reports/`.

## Non-goals

- No server route, OpenAPI, generated API type, workflow schema, database, or
  migration changes (`packages/server/src/routes/api.ts` queue route already
  returns the ordered no-store snapshot: hot-path read, 422 detached, 409 terminal).
- No Story 2.8 implementation (operator transcript rows) inside this issue.
- No aggregate all-iterations transcript; no changes to Story 1.7 `Jump to`; no
  client fetching across occurrence pages.
- No new polling cadence, caching layer, feature flag, or queue endpoint.
- No provider/executor steering-behavior changes
  (`packages/workflows/src/dag-executor.ts` drains are context only).
- No cross-surface UI abstraction for the two dock renderers — Legacy and Console
  stay deliberately parallel thin renderers (AD-1, HITL AD-4).

## Technical context (verified refs)

Shared core (story US-002):

- `packages/web/src/lib/execution-room-model.ts:13` — `ExecutionRowSelection`;
  `occurrence` arm at :17–24 currently carries `occurrenceId/attemptId/retryEpoch/
iteration/routeActivationSeq` but **no** ancestry. Add
  `ExecutionLoopAncestryEntry { nodeId, iteration }`,
  `loopAncestry?: readonly ExecutionLoopAncestryEntry[]` on that arm,
  `FinishedIterationView { liveRowId, liveIteration }`, and
  `resolveFinishedIterationView()` beside `chooseExecutionForNode()` (:132).
- `packages/web/src/components/workflows/build-log-rows.ts:95–115` — Legacy
  projection reads `loop_ancestry` last entry / `route_activation_seq` /
  `retry_epoch` but discards all but the final iteration. Map full ancestry
  `{node_id, iteration}` → `{nodeId, iteration}`, order preserved.
- `packages/web/src/experiments/console/components/inspect/build-log-rows.ts` —
  Console copy; same change. Event-fallback rows must not fabricate ancestry.
- `packages/web/src/lib/steering-dock.ts:50` — `SteeringDockMode` union gains
  `'finished-iteration'`; `steeringDockMode()` (:68) precedence:
  `!live → hidden; finishedIteration != null → 'finished-iteration';
rowStatus not running/awaiting → hidden;` then existing blocked → detached →
  composer unchanged. Copy helpers near `STEERING_DETACHED_DISCLOSURE` (:53),
  `queueBandHeader` (:129), `queueListLabel` (:133).
- `steering-dock.ts:351` — `QueuePollingOptions` gains optional
  `onError(error: SteeringSendError)`, called once per failed read before the
  existing retry/stop classification; omitted → behavior identical.

Resolver rule (fail-closed identity): non-null only when run is live AND node
projects `running`/`awaiting`; selected row is a known-scope `occurrence`,
`completed`, non-empty ancestry whose final entry equals its displayed iteration; a
known-scope candidate for the same `nodeId` is `running`/`awaiting` with ancestry
agreement, `iteration > selected`, identical `retryEpoch ?? 0`, identical optional
`routeActivationSeq` (both-absent ≠ numeric), same final ancestry `nodeId`, same
ancestry prefix (nodeId+iteration per entry). Prefer `awaiting` → `running` →
greatest `order`; never a terminal row.

Shells (US-003 Legacy / US-004 Console):

- Legacy chain: `LegacyGraphLogsPane.tsx` (owns `rows` + selection; compute
  descriptor once) → `LegacyNodeRoom.tsx` (typed pass-through) →
  `NodeTranscriptPane.tsx` (survives row switch; owns consume-once focus ref) →
  `ComposerDock.tsx` (keyed remount; new read-only branch).
- Console chain: `ConsoleInspectPane.tsx` (compute from
  `logEntries.map(e => e.row)`; liveness via `isInspectRunLive`,
  `experiments/console/components/inspect/inspect-status.ts:21`) →
  `ConsoleNodeRoom.tsx` (owns transcript scroll/focus + consume-once ref) →
  `ConsoleComposerDock.tsx`. Console imports **no** Legacy component.
- Poll-error semantics in the finished branch: 422 `not_steerable_here` → show
  `STEERING_DETACHED_DISCLOSURE` as alert + clear snapshot, keep polling; next 200
  clears alert + restores snapshot; network/5xx → silent retry, last snapshot may
  stay; 409 → clear snapshot + stop, never labeled detached; other 4xx → notify +
  stop, no new copy.
- Focus handoff (consume-once, cleared before focusing): target still live →
  composer/blocked textarea; target became finished (loop advanced) → new Go
  button; run/node terminal → transcript scroller. Never `<body>`; unrelated
  refetches never steal focus.

E2E (US-005/US-006):

- New `e2e/ui/agent-finished-iteration.spec.ts`, parameterized `legacy`/`console`,
  verification ids `steer.finished-iteration-legacy` / `-console`.
- Reuse fixture `e2e/fixtures/workflows/e2e-queue-guidance-loop.yaml` via
  `E2E_QUEUE_GUIDANCE_LOOP_WORKFLOW_NAME` / `QUEUE_GUIDANCE_LOOP_NODE` exported
  from `e2e/.../archon-runtime.ts`; 25 s delayed iterations; event-poll
  `loop_iteration_completed` / `loop_iteration_started` (no fixed sleeps); budget ≥
  `T.xlong * 2`. Precedents: `agent-queue-guidance.spec.ts`,
  `agent-queue-convergence.spec.ts` (request recording, room opening, 460px/wide
  viewports, fake provider `doneWhenPromptIncludes`), `occurrence-navigation.spec.ts`
  (execution-select helpers — lift only on third stable caller).
- Run per `e2e/package.json` scripts (Bun-managed; do not assume `npx`).

Canonical docs to reconcile (US-001, re-check in US-006):

- `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md` (Story 2.10)
- `_bmad-output/specs/spec-agent-node-room/SPEC.md` (CAP-6 finished-iteration clause,
  CAP-8/CAP-11), `control-states.md` ("Viewing a finished iteration of a live loop
  node"), `steering-api-contract.md`, `steering-test-plan.md`
- `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/`
  `EXPERIENCE.md` + `DESIGN.md` (460px authority width, full-width band, no empty
  queue shell, 33vh cap; `mockups/key-steering-dock.html` has no finished state)
- `_bmad-output/planning-artifacts/architecture/architecture-Archon-readable-agent-transcript-2026-09-12/ARCHITECTURE-SPINE.md`
  (AD-7 scroll-only navigator, AD-12 shell-owned behaviors; new AD next)
- `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml` —
  flip only `2-10-see-queued-guidance-while-viewing-a-finished-iteration` to `done`
  at closure.
- Story 2.8 gap is real: `packages/web/src/lib/agent-history.ts` emits only
  `assistant | tool | lifecycle`; `nodeTranscriptMetadataSchema` has no operator
  metadata; executor drains forward only `item.message`. Check these (and
  `gh issue view 188`) before attempting AC 4.

Validation commands:

- Focused: `cd packages/web && bun test src/lib/execution-room-model.test.ts
src/lib/steering-dock.test.ts src/components/workflows/build-log-rows.test.ts
src/experiments/console/components/inspect/build-log-rows.test.ts` (plus changed
  component test files).
- Package: web type-check, lint, and test scripts per `packages/web/package.json`.
- Repo gate: `bun run validate` from root; `git diff --check`.
- E2E regression set: `agent-queue-guidance.spec.ts`,
  `agent-withdraw-guidance.spec.ts`, `agent-queue-convergence.spec.ts`,
  `occurrence-navigation.spec.ts`.

## Story overview

| ID     | Story                                                                                                        | Depends on     | Gate                         |
| ------ | ------------------------------------------------------------------------------------------------------------ | -------------- | ---------------------------- |
| US-001 | Ratify B1/B2 in canonical docs (new AD, doc sync, Validation Log)                                            | —              | doc-only                     |
| US-002 | Shared core: lineage preservation, `resolveFinishedIterationView`, `finished-iteration` mode, poll `onError` | US-001         | unit tests                   |
| US-003 | Legacy shell: descriptor threading, read-only dock branch, focus handoff                                     | US-002         | renderer + integration tests |
| US-004 | Console shell: same contract, parallel renderer                                                              | US-002         | renderer + integration tests |
| US-005 | Real-loop E2E journey on both shells + test-plan ids + regression specs                                      | US-003, US-004 | E2E green                    |
| US-006 | Closure: #188-gated AC 4, acceptance report, evidence, doc drift, sprint status, `bun run validate`          | US-005         | all ACs pass; #188 merged    |
