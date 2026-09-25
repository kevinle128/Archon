# Story 10.1: Fix room geometry and execution selection

Status: ready-for-dev

<!-- Create Mode leaves this story in draft. -->
<!-- Run a clean independent Validate Mode before changing the story to ready-for-dev. -->

## Story

As an operator,
I want the approved Node Room dimensions and bounded execution selector,
so that the live execution is clear and stale history cannot affect live work.

## Acceptance Criteria

1. **Given** the Console Node Room is open<br>
   **When** the room renders<br>
   **Then** its width is fixed at 520 pixels until close<br>
   **And** the transcript scrolls above the sibling todo strip, queue band, and composer dock.

2. **Given** the Legacy Node Room is open<br>
   **When** the room renders<br>
   **Then** its width is fixed at 460 pixels until close<br>
   **And** it uses the same approved vertical order without overlaying the last transcript row.

3. **Given** a loop node has more than one execution and no explicit execution selection<br>
   **When** the `Execution` selector first renders<br>
   **Then** the live execution is selected<br>
   **And** the selector exposes no more than eight executions.

4. **Given** the operator selects one exposed execution<br>
   **When** the selection changes<br>
   **Then** the room immediately projects that execution<br>
   **And** writable steering controls appear only when the selected execution id matches the resolved live execution id, even if an older row still reports `running`<br>
   **And** a stale execution is read-only and cannot send, withdraw, interrupt, or otherwise steer the live execution.

5. **Given** a node has only one execution<br>
   **When** the room renders<br>
   **Then** the execution selector is absent.

6. **Given** an open room has one execution selected implicitly and no `Execution` selector<br>
   **When** a second same-node execution starts without reopening the room<br>
   **Then** the selector first appears with the resolved live execution selected<br>
   **And** the transcript, message request scope, and dock state immediately match that live execution in Legacy and Console.

7. **Given** an operator explicitly opened an execution from Logs or a graph occurrence, or chose one through an existing `Execution` selector<br>
   **When** another same-node execution starts without reopening the room<br>
   **Then** the selected execution, transcript, and message request scope remain on the chosen row in Legacy and Console<br>
   **And** its dock is read-only if that row is no longer live.

## Scope Boundary

- Story 10.1 owns manifest features M001, M002, and M005 in both Node Room shells.
- M001 fixes the Console room at 520 CSS pixels in desktop split mode and keeps its lower bands outside the transcript scroller.
- M002 fixes the Legacy room at 460 CSS pixels in desktop split mode and keeps the same non-overlay vertical order.
- M005 keeps the action identity `select-node-execution`, selects the live execution on a fresh multi-execution visit or when a second execution makes the selector first appear after an implicit selection, exposes at most eight same-node executions, and projects one selected execution immediately.
- An explicit operator, Logs, or graph occurrence selection takes precedence over the live default when execution rows update.
- Every approved visible mockup behavior remains current Epic 10 scope.
- Stories 10.2 through 10.4 own M007, M008, M009, M010, and M013.
- This story must not change the historical Cancel action, add individual-tool cancellation, or change CLI `--detach` behavior.
- This story must not add a new shell, token system, selection identity, aggregate occurrence view, or combined `Execution` and `Jump to` control.
- This story must not change run chrome, tabs, node lists, room titles, or the Close and Back action identities.
- This story must not change provider capability rules, steering storage, queue storage, API schemas, database schemas, or generated API types.

## Normative Contract Ledger

| Feature | Required observable                                                                                                                                                                                                                                           | Action identity          | Implementation tasks | Required proof                                                                                                                                                      |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M001    | Console is 520 CSS pixels in desktop split mode until close, and its transcript ends above sibling lower bands.                                                                                                                                               | No action identity.      | Tasks 1 and 2.       | Exact browser geometry, no resize separator, correct DOM order, and visible last transcript row.                                                                    |
| M002    | Legacy is 460 CSS pixels in desktop split mode until close, and its transcript ends above sibling lower bands.                                                                                                                                                | No action identity.      | Tasks 1 and 2.       | Exact browser geometry, no resize separator, correct DOM order, and visible last transcript row.                                                                    |
| M005    | A native `Execution` select appears only for multiple executions, starts on live for implicit selection, exposes at most eight entries, and immediately projects one selection, while only the selected live execution can expose writable steering controls. | `select-node-execution`. | Tasks 3 and 4.       | Both-shell one-to-two transition and explicit-selection retention, keyboard selection, transcript and request scope, dock state, and zero stale steering mutations. |

## Tasks / Subtasks

- [ ] Task 1: Replace the percentage room contract with fixed desktop split widths. (AC: 1, 2)
  - [ ] Replace the ratio, clamp, and local-storage contract in `packages/web/src/lib/room-split-layout.ts` with shared Console and Legacy width values of 520 and 460 CSS pixels.
  - [ ] Remove Node Room ratio state, writes, resize callbacks, resizable panel groups, and resize separators from the Legacy and Console call paths.
  - [ ] Render each desktop split room as a non-shrinking fixed-width sibling of its primary work area.
  - [ ] Ignore old `archon.run-room.ratio.*` values without a migration because they no longer own visible behavior.
  - [ ] Preserve the existing single-pane responsive flow below the room container breakpoint, with the room using the available width and Back restoring the mounted primary view.
  - [ ] Preserve close focus restoration, query-driven opening, graph and Logs selection, run-change reset, scroll memory, and hidden-main-view behavior.
  - [ ] Remove or update the stale `--rv-panel-*` variables in `packages/web/src/index.css` only if they remain tied to Node Room sizing.
  - [ ] Keep the generic Legacy resizable primitive because other product surfaces still use it.

- [ ] Task 2: Apply the approved vertical room order in both shells. (AC: 1, 2)
  - [ ] Change Legacy `NodeTranscriptPane` from `todo -> transcript -> occurrence controls -> dock` to `transcript -> occurrence controls -> todo -> dock`.
  - [ ] Change Console `ConsoleNodeRoom` to the same order with Console-owned markup and tokens.
  - [ ] Keep the transcript scroller as `min-h-0 flex-1` so the lower siblings cannot cover the last row.
  - [ ] Keep occurrence navigation outside the scroller and before the todo strip.
  - [ ] Keep the todo strip immediately above the applicable queue band and composer or read-only dock.
  - [ ] Leave absent todo and queue bands absent without empty reserved space.
  - [ ] Preserve scroll-follow, scroll restoration, focus, row disclosure, and transcript accessibility behavior.

- [ ] Task 3: Centralize the bounded execution option projection. (AC: 3, 4, 5, 6, 7)
  - [ ] Add one pure render-neutral helper to `packages/web/src/lib/execution-room-model.ts` for same-node execution options.
  - [ ] Filter by the current node before applying the limit.
  - [ ] Expose no more than eight options.
  - [ ] Keep the live execution in the exposed set when one can be resolved.
  - [ ] Keep the active explicit selection in the exposed set so the controlled select always has its current value.
  - [ ] Preserve the existing chronological display order after bounding.
  - [ ] Use one deterministic policy for all other eligible rows and use that same helper in both shells.
  - [ ] Treat the exact preference among remaining non-live and non-selected rows as internal implementation behavior, not as a new product promise.
  - [ ] Keep `chooseExecutionForNode` as the live-choice owner for a fresh room visit and the first selector appearance after an implicit one-execution selection, with awaiting preferred before running and the latest row used only when no live row exists.
  - [ ] Preserve an explicit operator selection across normal re-renders and the established graph reopen path.

- [ ] Task 4: Render and apply execution selection without weakening stale safety. (AC: 3, 4, 5, 6, 7)
  - [ ] Pass the bounded options into Legacy `NodeRoomHeader` and Console `ConsoleRoomHeader`.
  - [ ] Render the native `<select aria-label="Execution">` only when at least two options exist.
  - [ ] Keep the existing single-execution text context without an empty or disabled selector.
  - [ ] When one implicitly selected execution becomes two while the room remains open, reconcile `RoomVisitState` to the resolved live row before the new selector is shown.
  - [ ] Apply that row to the transcript, message request scope, and dock in both shells without a close or reopen.
  - [ ] Do not replace a row chosen through `Execution`, Logs, or a graph occurrence when execution rows update; preserve the established explicit-selection memory and graph reopen behavior.
  - [ ] Keep selection immediate by updating `RoomVisitState` and the message request scope through the existing shell flows.
  - [ ] Keep `Execution` as a filter or scope control and keep Story 1.7 `Jump to` as a separate scroll-only control.
  - [ ] Reuse `resolveFinishedIterationView` and `steeringDockMode` instead of creating a second stale-state model.
  - [ ] In both shells, resolve the same-node live row without an explicit-selection override and compare its id with the selected row id before exposing any writable steering control or handler.
  - [ ] A live run and a selected row with status `running` or `awaiting` are insufficient on their own; hide writable controls when the ids differ or no active live row can be resolved.
  - [ ] Do not re-key the live steering ledger by the selected stale execution.
  - [ ] Keep a different non-live execution without a steering dock.
  - [ ] Keep the approved finished iteration of the same still-live loop read-only, with the shared queue band and authenticated node-scoped queue `GET` allowed.
  - [ ] Render no composer, Send, Send now, withdraw, Stop, interrupt, redirect, or other steering mutation for a stale selection.
  - [ ] Fail closed and hide the finished-iteration dock when same-lineage liveness cannot be proved.

- [ ] Task 5: Update focused shared and shell tests. (AC: 1-7)
  - [ ] Replace percentage, clamp, and storage assertions in `room-split-layout.test.ts` with exact surface-width assertions.
  - [ ] Add `execution-room-model.test.ts` cases for zero, one, two, eight, nine, and more executions.
  - [ ] Prove same-node filtering, live retention, selected stale retention, deterministic order, and the eight-option maximum.
  - [ ] Update both room-header test files to prove selector absence for one option and a named native selector for two or more options.
  - [ ] Prove keyboard selection retains focus and projects the selected execution.
  - [ ] Update both room-body test files to prove the approved sibling order.
  - [ ] Update both split-owner test files to prove fixed split structure, full-width single mode, and no resize separator.
  - [ ] Update both route or page owner tests to prove a fresh visit selects live and an explicit selection projects immediately.
  - [ ] In `execution-room-model.test.ts` and both route or page owner tests, start with one implicitly selected execution, add a second live same-node execution without reopening, and prove the first selector appearance selects that live row.
  - [ ] In both shells, assert the transition changes the displayed transcript, message request scope, and writable dock state to the live row.
  - [ ] In both shells, add a second row after an explicit Logs or graph occurrence opening, and add a later row after a choice through an existing `Execution` selector; assert the chosen row, transcript, and request scope remain selected while the dock becomes read-only if the row is stale.
  - [ ] In both shells, prove that selecting an older same-node row still marked `running` hides the writable dock while the newer resolved live row can show it.
  - [ ] Prove the older-row selection binds no send, withdraw, Stop, interrupt, redirect, or queue-submit handler, while the proven finished-iteration read-only dock remains available.
  - [ ] Keep equal semantic assertions in Legacy and Console while preserving their separate JSX and token roots.

- [ ] Task 6: Update real browser evidence and affected visual fixtures. (AC: 1-7)
  - [ ] Update `e2e/ui/workflow-run-hitl-room.spec.ts` to measure Console at 520 CSS pixels and Legacy at 460 CSS pixels with at most one CSS pixel of tolerance.
  - [ ] Replace its ratio persistence proof with fixed-width persistence-through-render and reload proof.
  - [ ] Keep its close, deep-link, focus, selection memory, scope, and narrow single-pane Back coverage.
  - [ ] Update `e2e/ui/agent-todo-strip.spec.ts` to prove transcript, occurrence controls, todo, queue, and dock geometry in the approved order.
  - [ ] Use a long transcript, expanded todo content, and queue content to prove the last transcript row remains visible and uncovered.
  - [ ] Extend `e2e/ui/agent-finished-iteration.spec.ts` to prove the selector value, stale transcript projection, shared queue `GET`, and zero mutation requests in both shells.
  - [ ] Prove one execution hides the selector, two executions show it with live selected, eight remain available, and nine are bounded to eight.
  - [ ] In Legacy and Console, keep a one-execution room mounted while a second execution starts; prove the selector first appears on the live row and the transcript, message request scope, and dock update without reopening.
  - [ ] Repeat the one-to-two update in both shells after an explicit Logs or graph occurrence opening, and update rows after a choice through an existing `Execution` selector; prove the chosen row stays selected and becomes read-only when stale.
  - [ ] Prove keyboard selection changes the transcript without reload or room reopen.
  - [ ] In both shells, use hermetic browser data with an older selected row still marked `running` and a newer resolved live row; prove the older row projects read-only with zero steering mutation requests.
  - [ ] Update `e2e/ui/verifier-visual.spec.ts`, `e2e/ui/agent-tool-row-visual.spec.ts`, `e2e/ui/file-edit-diff.spec.ts`, and `e2e/ui/task-dispatch-body.spec.ts` to remove ratio-key setup and desktop Console-at-460 assumptions.
  - [ ] Measure desktop Console at 520 CSS pixels and Legacy at 460 CSS pixels in those fixtures; keep any 460-pixel Console stress case in the established single-pane flow or an isolated renderer fixture.
  - [ ] Update only screenshots whose intended geometry changes from the approved Console or Legacy width.
  - [ ] Keep browser fixtures hermetic and label seeded renderer-integration evidence honestly when a real workflow cannot reach the required execution shape.

- [ ] Task 7: Run the scoped and repository quality gates. (AC: 1-7)
  - [ ] Run the shared model tests from `packages/web`.
  - [ ] Run the Legacy component tests from `packages/web` with `NODE_ENV=development`.
  - [ ] Run the Console component tests from `packages/web` with `NODE_ENV=development`.
  - [ ] Run `bun --filter @archon/web test`.
  - [ ] Run `bun run typecheck` from `e2e`.
  - [ ] Run the focused Playwright room, todo, occurrence-navigation, finished-iteration, verifier-visual, agent-tool-row-visual, file-edit-diff, and task-dispatch-body specs.
  - [ ] Run `bun run validate` from the repository root.
  - [ ] Do not run root `bun test` because it breaks the repository's test-isolation contract.

## Dev Notes

### Authority and Product Context

- The 2026-09-22 course correction makes Epic 10 the owner of all current implementation work for approved mockup gaps M001, M002, M005, M007, M008, M009, M010, and M013.
- Epic 1 through Epic 9 remain completed historical planning records and provide evidence or dependency context only.
- Story 10.1 implements M001, M002, and M005.
- Completed Epic 3 supplies the two-shell anatomy, todo placement, scroll behavior, and accessibility baseline that this story must preserve.
- When a mock image conflicts with the corrected SPEC, UX, architecture, Epic 10, or manifest, the corrected written contract wins.
- The current manifest classifies M001, M002, and M005 as `CURRENT`, `CHANGE_FEATURE`, and `PROVEN`, with no open question.

### Contract Reconciliation

- The fixed 520 and 460 widths replace the current percentage and drag-resize behavior in desktop split mode.
- The existing responsive contract owns a single-pane mode below 60 rem where the room uses the available container width and Back restores the primary view.
- Apply the exact fixed widths only while `useContainerSplitMode` reports `split`.
- This responsive rule preserves the completed narrow-container behavior and avoids forcing a 520-pixel panel into a 390-pixel viewport.
- The phrase "until close" means that content, re-renders, old ratio storage, and desktop container changes do not resize an open split-mode room.
- A deliberate transition into established single-pane mode is not a user resize and must not create horizontal overflow.
- Historical Story 1.7 used broad loop-selector wording, but the final UX and readable-transcript architecture define separate controls.
- `Execution` changes the loaded execution scope.
- The live default applies when selection is implicit, including the first selector appearance during an open room visit; explicit operator, Logs, and graph occurrence selections remain authoritative.
- `Jump to` scrolls only within the transcript that is already loaded.
- A general stale execution has no dock.
- A finished iteration of the same still-live loop is the narrow AD-16 exception and receives only the approved read-only shared queue band.

### Current Implementation State

- `packages/web/src/lib/room-split-layout.ts` owns a 40 percent default, a 24 to 60 percent clamp, percentage panel sizes, and per-surface local-storage keys.
- `WorkflowExecution.tsx` and `RunDetailPage.tsx` read, store, and persist those percentages.
- `LegacyGraphLogsPane.tsx` and `ConsoleInspectPane.tsx` render resizable split groups and separators.
- `NodeTranscriptPane.tsx` and `ConsoleNodeRoom.tsx` currently render the todo strip before the transcript scroller.
- `NodeRoomHeader.tsx` and `ConsoleRoomHeader.tsx` currently render the execution select even when only one option exists.
- Legacy builds every same-node execution option in `WorkflowExecution.tsx`.
- Console builds every same-node execution option in `ConsoleInspectPane.tsx`.
- `chooseExecutionForNode` already owns the live-first selection rule and should remain the single owner.
- `applyRoomDeepLink` keeps an already applied query node's row id when execution rows update, so a one-to-two transition can leave the first visible selector on the former execution.
- `openExplicitRoom` and the Console selection flow already update the selected row and request scope immediately.
- `rememberRoomScroll` already isolates scroll state by execution scope.
- `resolveFinishedIterationView` already proves same-lineage liveness and fails closed when identity is uncertain.
- `steeringDockMode` distinguishes a live run, a proven read-only finished iteration, and terminal stale rows, but it does not receive selected or live execution ids.
- Both shells currently pass run liveness to their dock; an older selected row still marked `running` can therefore receive composer mode unless the room checks execution identity first.

### Architecture Compliance

- Keep shared option projection and width constants as pure render-neutral logic under `packages/web/src/lib/`.
- Keep Legacy markup under `packages/web/src/components/workflows/`.
- Keep Console markup under `packages/web/src/experiments/console/`.
- Console must not import Legacy components or `@/components/`.
- Do not import `@archon/workflows` into `@archon/web`.
- Use current generated web types through the established web API seam.
- Keep strict TypeScript and complete function annotations.
- Do not add `any` or lint suppressions.
- Do not add a dependency.
- Do not add a feature flag.
- Do not add an API route, schema, migration, or generated artifact.
- Do not encode plan, story, manifest, or finding identifiers in code comments or test names.

### File Ownership and Expected Changes

| Path                                                                                                                                           | Current owner                                            | Required change                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/web/src/lib/room-split-layout.ts`                                                                                                    | Shared room geometry.                                    | Replace ratio persistence and percentage output with fixed per-surface split widths.                                                  |
| `packages/web/src/lib/execution-room-model.ts`                                                                                                 | Shared execution selection and finished-iteration proof. | Add bounded same-node options and reconcile the first selector appearance after an implicit one-execution selection.                  |
| `packages/web/src/components/workflows/WorkflowExecution.tsx`                                                                                  | Legacy selection owner.                                  | Remove ratio state, use bounded options, and apply the implicit one-to-two transition without replacing explicit selection.           |
| `packages/web/src/components/workflows/LegacyGraphLogsPane.tsx`                                                                                | Legacy split and selected-row owner.                     | Render fixed split geometry, preserve full-width single mode, and guard writable steering by selected-versus-live execution identity. |
| `packages/web/src/components/workflows/NodeTranscriptPane.tsx`                                                                                 | Legacy room body.                                        | Move the todo strip below transcript controls and above the dock.                                                                     |
| `packages/web/src/components/workflows/NodeRoomHeader.tsx`                                                                                     | Legacy room header.                                      | Hide the native selector for one option.                                                                                              |
| `packages/web/src/experiments/console/routes/RunDetailPage.tsx`                                                                                | Console room visit owner.                                | Remove ratio state and apply the implicit one-to-two transition while preserving explicit selection and visit memory.                 |
| `packages/web/src/experiments/console/components/ConsoleInspectPane.tsx`                                                                       | Console split, option, and selected-row owner.           | Render fixed split geometry, consume bounded options, and guard writable steering by selected-versus-live execution identity.         |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx`                                                                          | Console room body.                                       | Move the todo strip below transcript controls and above the dock.                                                                     |
| `packages/web/src/experiments/console/components/inspect/ConsoleRoomHeader.tsx`                                                                | Console room header.                                     | Hide the native selector for one option.                                                                                              |
| Matching `*.test.tsx` and `*.test.ts` files                                                                                                    | Unit and component proof.                                | Replace old geometry assumptions and add equal shell assertions.                                                                      |
| Existing E2E room, todo, occurrence, visual, and finished-iteration specs                                                                      | Browser proof.                                           | Remove old ratio setup and prove exact approved geometry and selector safety, including a stale row still marked `running`.           |
| `e2e/ui/verifier-visual.spec.ts`, `e2e/ui/agent-tool-row-visual.spec.ts`, `e2e/ui/file-edit-diff.spec.ts`, `e2e/ui/task-dispatch-body.spec.ts` | Ratio-driven visual fixtures.                            | Replace saved-ratio and desktop Console-at-460 setup with the approved per-surface geometry, then run all four specs.                 |

- `LegacyNodeRoom.tsx` is a pass-through owner and does not need a geometry change unless implementation evidence proves otherwise.
- The generic resizable primitives remain because source-control and other callers still use them.
- The current CSS panel variables must be removed only if no remaining consumer owns them.

### Behavior That Must Remain Unchanged

- The Console shell, Console room header anatomy, Legacy metadata, tabs, node list, titles, and close controls remain unchanged.
- Active steering controls retain their current action identities and capability boundaries.
- Layout rendering and execution selection cause no active-work effect and no queue collection mutation.
- A selection changes visible and requested execution scope only.
- Per-execution transcript rows, stale read-only presentation, and return-to-live navigation remain intact.
- Opening from Logs or a graph occurrence continues to target that explicit execution.
- A row chosen through `Execution`, Logs, or a graph occurrence remains selected when another execution starts.
- A graph-node reopen continues to use the established explicit-selection memory before the normal live-choice fallback.
- Completed executions continue to restore at the top and active executions continue to follow at the bottom according to existing rules.
- Closing the room continues to restore focus when the opener still exists.
- A run change continues to clear room visit state, explicit selection memory, scroll positions, drafts, and query application state.
- Native select semantics, keyboard access, visible focus, and non-color state cues remain intact.

### Execution Cap Implementation Latitude

- The approved sources define a maximum of eight executions but do not define which non-live and non-selected rows must survive the cap.
- The implementation must keep the resolved live row and the current explicit selection when each exists.
- The implementation must preserve the current chronological display order for retained rows.
- One shared deterministic helper must choose any remaining rows.
- Tests must record that helper's internal choice so both shells cannot drift.
- Product copy, public contracts, and comments must not promote the remaining-row preference into a new product guarantee.

### Proof Requirements

| Contract             | Positive proof                                                                                                                                                             | Negative proof                                                                                                                                                                       | Boundary proof                                                                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Console geometry     | Measure the open desktop split room at 520 CSS pixels.                                                                                                                     | Prove no resize separator and no old ratio value can change it.                                                                                                                      | Prove the established narrow single-pane Back flow still uses available width without overflow.                                                    |
| Legacy geometry      | Measure the open desktop split room at 460 CSS pixels.                                                                                                                     | Prove no resize separator and no content change can resize it.                                                                                                                       | Prove close removes the room and releases the main-view width.                                                                                     |
| Vertical order       | Assert transcript, occurrence controls, todo, queue, and dock box order.                                                                                                   | Prove absent optional bands leave no empty block.                                                                                                                                    | Expand todos and queue content, scroll to bottom, and prove the last row is not covered.                                                           |
| Live default         | Open a fresh multi-execution node and match selector, transcript, and live dock scope.                                                                                     | Prove a terminal-only node is not presented as live.                                                                                                                                 | Cover exactly two executions and preserve a later explicit selection across re-renders.                                                            |
| Selector appearance  | In each shell, add a second live execution to an open room with one implicit selection; match selector value, transcript, message request scope, and dock to the live row. | Prove a Logs or graph occurrence opening stays selected through one-to-two, and a choice through an existing selector stays selected when a later row starts.                        | Keep the room mounted with no close or reopen, show the selector absent before the second row, and verify a stale chosen row has no writable dock. |
| Eight-option cap     | Render all eight when exactly eight are eligible.                                                                                                                          | Exclude executions that belong to another node.                                                                                                                                      | With nine or more, retain live and selected stale rows while rendering exactly eight.                                                              |
| Immediate projection | Select a stale execution and observe its transcript and request scope without reopen.                                                                                      | Prove the prior live transcript is no longer the displayed scope.                                                                                                                    | Select with the keyboard and keep focus on the select.                                                                                             |
| Stale read-only      | Show the approved finished-iteration band and shared queue read.                                                                                                           | In both shells, an older selected row still marked `running` has no writable controls and records zero send, withdraw, stop, interrupt, redirect, delete, or queue-submit mutations. | Return to the resolved live row and prove the composer returns; keep the proven finished-iteration read-only queue `GET`.                          |
| Single execution     | Render the room context for one execution.                                                                                                                                 | Assert no `Execution` selector exists.                                                                                                                                               | With two options, assert one native select named `Execution` exists.                                                                               |

### Focused Validation Commands

```sh
(cd packages/web && bun test src/lib/execution-room-model.test.ts src/lib/room-split-layout.test.ts)

(cd packages/web && NODE_ENV=development bun test \
  src/components/workflows/NodeRoomHeader.test.tsx \
  src/components/workflows/NodeTranscriptPane.test.tsx \
  src/components/workflows/LegacyGraphLogsPane.test.tsx \
  src/components/workflows/WorkflowExecution.test.tsx)

(cd packages/web && NODE_ENV=development bun test \
  src/experiments/console/components/inspect/ConsoleRoomHeader.test.tsx \
  src/experiments/console/components/ConsoleNodeRoom.test.tsx \
  src/experiments/console/components/ConsoleInspectPane.test.tsx \
  src/experiments/console/routes/RunDetailPage.test.tsx)

bun --filter @archon/web test

(cd e2e && bun run typecheck)

(cd e2e && bun run test:ui -- \
  workflow-run-hitl-room.spec.ts \
  agent-todo-strip.spec.ts \
  occurrence-navigation.spec.ts \
  agent-finished-iteration.spec.ts \
  verifier-visual.spec.ts \
  agent-tool-row-visual.spec.ts \
  file-edit-diff.spec.ts \
  task-dispatch-body.spec.ts)

bun run validate
```

### Git and Historical Intelligence

- Commit `56c61f72` introduced the current percentage room and is the implementation being replaced by this approved geometry contract.
- Commit `81ba296f` proves the separate occurrence-navigation work even though the old sprint tracker still marks Story 1.7 as backlog.
- Commit `0d935ef2` added the finished-iteration read-only queue behavior and its network-mutation proof.
- Commits for Stories 2.11 and 2.12 use shared pure helpers plus both-shell and browser evidence.
- Use source, tests, and git evidence for completed Epic 1 through Epic 9 behavior instead of their stale sprint-status values.
- Do not edit historical Epic 1 through Epic 9 status entries as part of this story.

### Project Structure Notes

- No new production module is needed because `room-split-layout.ts` and `execution-room-model.ts` already own the shared seams.
- Reuse existing shell components and tests instead of adding a third room abstraction.
- Prefer updating existing E2E room and steering specs instead of creating a duplicate browser harness.
- Keep the implementation limited to `packages/web` and `e2e`.
- Preserve the Console isolation test and the monorepo dependency direction.

### References

- [Source: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md:1660-1706`]
- [Source: `_bmad-output/specs/spec-agent-node-room/SPEC.md:80-89`]
- [Source: `_bmad-output/specs/spec-agent-node-room/SPEC.md:188-201`]
- [Source: `_bmad-output/specs/spec-agent-node-room/SPEC.md:235-239`]
- [Source: `_bmad-output/planning-artifacts/architecture/architecture-Archon-readable-agent-transcript-2026-09-12/ARCHITECTURE-SPINE.md:161-180`]
- [Source: `_bmad-output/planning-artifacts/architecture/architecture-Archon-readable-agent-transcript-2026-09-12/ARCHITECTURE-SPINE.md:206-211`]
- [Source: `_bmad-output/planning-artifacts/architecture/architecture-Archon-live-agent-steering-2026-09-12/ARCHITECTURE-SPINE.md:252-274`]
- [Source: `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/DESIGN.md:537-541`]
- [Source: `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/DESIGN.md:619-679`]
- [Source: `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md:60-68`]
- [Source: `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md:192-216`]
- [Source: `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md:246-250`]
- [Source: `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md:293-296`]
- [Source: `_bmad-output/planning-artifacts/mockup-manifests/agent-node-room.json:1862-2249`]
- [Source: `_bmad-output/planning-artifacts/mockup-manifests/agent-node-room.json:2902-3167`]
- [Source: `_bmad-output/planning-artifacts/mockup-manifests/agent-node-room.json:3431-3453`]
- [Source: `_bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md:146-165`]
- [Source: `packages/web/src/lib/room-split-layout.ts`]
- [Source: `packages/web/src/lib/execution-room-model.ts`]
- [Source: `packages/web/src/lib/use-container-split-mode.ts`]
- [Source: `packages/web/src/components/workflows/WorkflowExecution.tsx`]
- [Source: `packages/web/src/components/workflows/LegacyGraphLogsPane.tsx`]
- [Source: `packages/web/src/components/workflows/NodeTranscriptPane.tsx`]
- [Source: `packages/web/src/experiments/console/routes/RunDetailPage.tsx`]
- [Source: `packages/web/src/experiments/console/components/ConsoleInspectPane.tsx`]
- [Source: `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx`]

## Dev Agent Record

### Agent Model Used

To be completed by the implementation agent.

### Debug Log References

To be completed by the implementation agent.

### Completion Notes List

To be completed by the implementation agent after all acceptance evidence passes.

### File List

To be completed by the implementation agent with the exact changed paths.

## Validation Completion Status

- The source, UX, architecture, manifest, code paths, tests, and relevant git history were analyzed.
- The story maps M001, M002, and M005 to implementation tasks and observable proof.
- The first selector appearance after an implicit one-to-two execution transition and explicit-selection retention have both-shell proof requirements.
- Independent validation found no blocking gap in the approved contracts or implementation proof plan.
- The story and matching sprint entry are `ready-for-dev`.
- Epic 10 is `in-progress` because its first story artifact now exists.

## Unresolved Questions

None.
