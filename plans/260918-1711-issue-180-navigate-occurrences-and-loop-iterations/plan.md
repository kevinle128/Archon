---
title: 'Issue 180 navigate transcript occurrences and loop iterations'
description: 'Implementation-ready plan for Story 1.7 / CAP-6: group a node transcript by occurrence_id with one header per occurrence, add a loop-iteration selector that navigates to those headers, and make the multi-occurrence view reachable for loop nodes on both node rooms.'
status: pending
priority: P1
effort: '3 phases / about 15h'
issue: 'https://github.com/kevinle128/Archon/issues/180'
branch: archon/thread-499eb44c
tags: [issue-180, agent-node-room, web, tdd, epic-1, frontend]
blockedBy: []
blocks: []
created: 2026-09-18
mode: deep
tdd: true
---

# Issue 180 navigate transcript occurrences and loop iterations

## Goal and user outcome

An operator reviewing a node that ran more than once — a retried node, or a `loop:` node with several iterations — sees the transcript as one labelled group per occurrence instead of one undifferentiated stream. Each group starts with a section heading (`Run 1 · failed`, `Run 2 · retry`, `Iteration 3`). A loop-iteration selector pinned above the transcript jumps straight to the matching heading and moves keyboard focus there. A node with a single occurrence renders neither headings nor a selector.

This is Story 1.7 / CAP-6 of `SPEC-agent-node-room`. It is a Web presentation feature over data already persisted on every node-message row (`metadata.execution`). It needs no schema, migration, API, generated-type, or provider change, so it improves every historical run the moment it ships.

## Verified evidence and authority

Authority order for the implementation, highest first:

1. `_bmad-output/specs/spec-agent-node-room/SPEC.md` CAP-6 and Story 1.7 in `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md` (lines 371–394): one header per `occurrence_id`, never `attempt_id`; the selector navigates to the matching header; keyboard and focus behaviour equivalent on both surfaces; a single occurrence renders neither.
2. Read-spine AD-7 and AD-12 item 7 in `_bmad-output/planning-artifacts/architecture/architecture-Archon-readable-agent-transcript-2026-09-12/ARCHITECTURE-SPINE.md`: grouping is a separate pure function in `packages/web/src/lib/occurrence-groups.ts`; every item (assistant, tool, lifecycle) carries `metadata.execution`; metadata-less rows attach to the nearest preceding group; the label is composed by the core (`Run N` from `retry_epoch`, `Iteration N` from `loop_ancestry`) and shells only render it; the selector is shell-owned behaviour #7, written twice, asserted identically in `NodeRoom.test.tsx` and `ConsoleNodeRoom.test.tsx`.
3. `EXPERIENCE.md` "Occurrence grouping" (line 288) and Component Patterns line 125: `Run N` with `· retry` / `· failed` suffixes only when known, `Iteration N` with no suffix, `Attempt` and `Pass` forbidden; the header carries a heading role so a screen-reader user can jump between executions.
4. `DESIGN.md` `components.occurrence-header`: 10.5 px mono, uppercase, 0.08em tracking, `text-secondary`, a 1 px `border` rule filling the width after the label, margin `10px 0 5px`; `text-tertiary` is never used for a transcript fact.
5. `test-plan.md` "Renderer tests — CAP-1, CAP-6, CAP-7": a multi-occurrence node renders occurrence headers and a single-occurrence node renders none, on both surfaces.
6. Current code and tests own every existing public behaviour this story must preserve.

Repository inspection established:

- `packages/web/src/lib/agent-history.ts` builds `AgentHistoryItem[]` from `projectToolTranscript(projectTextTranscript(rows))`. No item variant carries `metadata.execution` today; `projectTextTranscript` returns the row type, so the merged text row keeps its first row's metadata.
- Every node-message row written by the executor carries `metadata.execution = { occurrence_id, attempt_id, retry_epoch?, loop_ancestry?, route_activation_seq? }` (`packages/workflows/src/schemas/node-execution.ts`); the generated type is `components['schemas']['WorkflowNodeMessage']['metadata']['execution']`.
- The four transcript fetch sites resolve a `LogRow` to a `NodeMessageSelection` with four identical local helpers: `NodeTranscriptPane.tsx:57`, `WorkflowExecution.tsx:355`, `ConsoleNodeRoom.tsx:431`, `ConsoleExecutionHistory.tsx:97`. An `occurrence` row is server-filtered by exact `occurrence_id` (`packages/core/src/db/workflow-node-messages.ts:149-165`); a `node` row is unfiltered.
- **Live database evidence (read-only query, 2026-09-18):** a `loop:` node mints one outer occurrence for the node itself plus one occurrence per iteration. Run `448373788ab9e98c1cfde4e871beb891`, node `ralph-loop-run`: outer occurrence `182c057b…` holds exactly two lifecycle rows at `seq` 1 and `seq` 3465; iterations 1–6 each hold a contiguous block with `loop_ancestry: [{ node_id: 'ralph-loop-run', iteration: N }]`. The outer `node_started` event data carries `type: 'loop'`, which `projectWorkflowExecutionHistory` surfaces as `NodeExecution.node_type`. A retried prompt node (`73aff14c…`, node `resolve`) has two occurrences with `retry_epoch` 0 and 1 and no `loop_ancestry`.
- Consequence: on current data every execution row of a loop node is `occurrence`-kind, `resolveGraphRoomRow` never finds a `node` row, and every selectable execution is server-filtered to one occurrence. The outer row shows two lifecycle rows and nothing else. The multi-occurrence transcript that CAP-6 targets is unreachable for new runs; it appears only for pre-occurrence data and the event-based fallback. Story 2.10 ("a live loop node and a finished iteration selected through Story 1.7", `Go to iteration N`) cannot be satisfied on that basis.
- The Legacy mockup `mockups/key-legacy-node-room.html` renders the `implement` node with `run 2` selected in the Logs list while the transcript shows both `Run 1 · failed` and `Run 2 · retry` groups — the design intends the room to show the whole node.
- Both rooms already have an `Execution` `<select>` (`ConsoleRoomHeader.tsx`, `NodeRoomHeader.tsx`) that **filters** by refetching a different row; E2E `workflow-run-hitl-room.spec.ts` locates it with `getByLabel('Execution')` and asserts `Iteration 1` / `Iteration 2` text plus distinct `occurrenceId` requests. That contract stays.
- Status message states observed in data: `started`, `completed`, `failed`, `awaiting`, `iteration_started`, `iteration_completed`, `iteration_failed`, `interrupted`. A group's `· failed` suffix is derivable from its own lifecycle items.
- Scroll follow is a DOM-free reducer (`lib/room-scroll-follow.ts`); the pin-to-bottom effect in both rooms re-runs on `pageState.rows.length`, so a live poll after a programmatic scroll would snap the reader back to the bottom unless follow is disengaged explicitly.
- Console's `ConsoleAgentHistoryList` applies `showToolCalls` / `showSystem` inside its render loop; the pinned todo strip (Story 1.5) is mounted outside that list so the toggles cannot hide it.
- `e2e/fixtures/workflows/e2e-hitl-run.yaml` already runs a two-iteration `loop:` node (`inspect-twice`) on the env-gated `e2e-fake` provider — real multi-occurrence data for E2E without a new fixture.
- Story 1.5's plan (`plans/260918-0826-issue-178-pinned-todo-strip/`) is the structural precedent: a pure `lib/` module, a widened `buildAgentHistory` return, one renderer per shell written twice, parity tests, and stale-doc correction.

## Resolved conflicts and decisions

1. **AD-7 amendment — the loop node's outer execution fetches node-scoped.** The outer execution of a **top-level** `loop:` node (`NodeExecution.node_type === 'loop'` with `loop_ancestry` absent or empty) is marked `loopParent: true` on its `occurrence` selection, and the shared fetch-scope helper maps that one row type to an unfiltered `{ kind: 'node' }` request. Its transcript then spans the outer occurrence plus every iteration, which is exactly the state CAP-6 and Story 2.10 need. Every other row keeps Story 1.5's rule that scope follows the selected slice. A `loop:` node nested inside a `loop_group:` body is excluded on purpose: body step names are namespaced by the group chain only (`dag-executor.ts` `bodyStepNamePrefix`), so its `node_id` is identical across outer iterations and an unfiltered fetch would merge them; that row keeps the scoped fetch and is a documented limitation. A top-level `loop:` node re-run through `workflow retry-node` mints a second outer occurrence with a higher `retry_epoch`, and its iterations carry that same epoch (`dag-executor.ts` `loopRetryEpoch`); both outer rows are `loopParent`, so the unfiltered fetch is sliced client-side in both `select-node-room-messages.ts` copies to rows whose `execution.retry_epoch` (default 0) equals the row's `retryEpoch`, keeping `Run 1 · failed` and `Run 2` as two distinct whole-loop views. Authorization is unchanged by the widening: the node-messages route checks only run existence, with no per-user scoping on either the filtered or unfiltered path (`packages/server/src/routes/api.ts`, `listNodeMessages`), so no access boundary moves; if per-resource user scoping is ever added to that route, this amendment must be revisited. This is client-only and stays inside the read half's no-backend constraint. It is recorded as an amendment to AD-7's last paragraph, not a silent change, because the spine's claim that the node-entry path "is the default selection" is false on current data (evidence above).
2. **One header per occurrence, groups ordered by first `seq`.** The outer occurrence's rows are non-contiguous (`seq` 1 and 3465). Grouping keys on `occurrence_id`; a later item whose occurrence was already seen rejoins its group. The trailing `completed` lifecycle row therefore renders inside the first group, above the iterations. A contiguous-runs approach would render `Run 1` twice and give the selector an ambiguous target, so it is rejected.
3. **Label composer lives in `occurrence-groups.ts`.** `loop_ancestry` present → `Iteration N` (N = last entry's iteration, matching `labelForExecution` in `build-log-rows.ts`), no suffix. Otherwise `Run (retry_epoch + 1)` with `· retry` when `retry_epoch > 0` and `· failed` when the group contains a lifecycle item whose state is `failed` or `iteration_failed`; both suffixes may apply, joined by ` · `. The existing `executionLabel` (`Attempt N`) is a chip label, not a header, and is left alone except for one addition (decision 5).
4. **The selector is a new control, not the `Execution` select.** The `Execution` select filters and refetches; the new control navigates within the loaded transcript. It is a native `<select>` with accessible name `Occurrence`, a placeholder option `Go to…`, and one option per rendered header, labelled exactly like the header. Native `<select>` gives both shells identical keyboard semantics for free. On change the shell scrolls the target heading into view, disengages scroll follow, and records the navigated key so a later story can read "which iteration is selected". Focus moves to the heading (`tabIndex={-1}`) only for a pointer change or a change confirmed with Enter/Space; an arrow-key change (native `<select>` fires `change` per arrow press while closed) scrolls and holds but keeps focus on the select, so a keyboard user can step `Iteration 1 → 2 → 3` without re-tabbing. The programmatic `scrollTop` write fires a native `scroll` event; the shell marks it with a ref so `handleScroll` does not re-derive `follow` from it (a heading within 24 px of the bottom would otherwise re-arm pin-to-bottom and the next poll would snap the reader down). Heading DOM ids are keyed on the occurrence id (a server-minted UUID validated at the read boundary), not on group index, so a live poll that changes group membership cannot desync the select from the focused heading. When the navigated key's group disappears from the visible options (Console filter toggles), the navigated key resets to the placeholder. It is mounted pinned above the transcript scroller, below the todo strip when both exist, so it stays reachable while the transcript scrolls.
5. **Discoverability of the whole-loop view.** `executionLabel` returns `All iterations` for a `loopParent` selection so the `Execution` select names the view honestly. Nothing else in the chip vocabulary changes.
6. **Console filters cannot leave an empty header.** A header renders only when its group still has at least one visible item after `showToolCalls` / `showSystem`; headers render only when two or more groups are visible; the selector lists only rendered headers. The header and selector sit outside the filtered list, like the todo strip. `ConsoleExecutionHistory` applies the same `visibleGroups` rule through the exported `isTranscriptItemVisible`. Named consequence: a loop that ran exactly one iteration has two keys (outer lifecycle rows + `Iteration 1`), so Legacy shows both headings and the selector while Console with `showSystem=false` shows neither — correct under decisions 2 and 6 and the same asymmetry AD-12 already accepts for `showToolCalls`.
7. **Metadata-less rows attach, never lead.** An item without `execution` joins the currently open group. Items that precede any keyed group are buffered and prepended to the first keyed group. A transcript with no keyed rows at all is one unkeyed group with no header and no selector (this is the pre-occurrence data path and it must render byte-for-byte as today).
8. **Ask cards keep their iteration-scoped rows, and a blocked iteration is flagged on its heading.** `selectVisibleNodeAskInteractions` matches scoped Asks against the selected occurrence, so the whole-loop view shows only Asks scoped to the outer occurrence (none in practice) and `chooseExecutionForInteraction` still routes an Ask to its iteration row. Default entry already lands on an `awaiting` row (`chooseExecutionForNode` priority), but an operator who switches to `All iterations` by hand must not see an idle-looking transcript while an iteration is blocked: each shell passes `pendingInteractions` alongside the groups and the heading of a group whose `occurrence_id` owns a `pending` Ask renders a `· awaiting input` suffix (non-interactive; answering still happens on the iteration row). The whole-loop view is a reading view; steering and answering stay on the live iteration row.
9. **`ConsoleExecutionHistory` renders headers but no selector.** It is an inline log section inside another scroller (Story 1.5 decision 5); headers are part of the transcript body and belong there, but a pinned selector cannot exist without its own scroller.
10. **No new tokens.** Both headers use `text-secondary`, `border`, the mono ramp at 10.5 px, and existing Tailwind utilities; the Console copy uses its own token names.

The implementation also corrects two stale narrative passages in `EXPERIENCE.md` (lines 59 and 391, "nothing anywhere scrolls to a selection") and appends the amendment note to AD-7. `sprint-status.yaml` is workflow-owned and is not hand-edited.

## Scope

### In scope

- `execution` carried on every `AgentHistoryItem` variant.
- Pure `groupByOccurrence()` and label composition in `packages/web/src/lib/occurrence-groups.ts`, fully tested.
- `loopParent` on `LogRowSelection` (both `build-log-rows.ts` copies) and `ExecutionRowSelection`; one shared `selectionForNodeMessages()` replacing four duplicated helpers; `All iterations` chip label.
- `holdScrollAt()` in `room-scroll-follow.ts` so navigation disengages follow deterministically.
- Legacy `OccurrenceHeader` + `OccurrenceSelector` and Console `ConsoleOccurrenceHeader` + `ConsoleOccurrenceSelector`, identical semantics, mounted in both node rooms; headers in `ConsoleExecutionHistory`.
- Parity component tests, a focused Playwright spec on the existing two-iteration HITL fixture across both routes, doc synchronization, and an evidence report.

### Out of scope

- Any backend, schema, migration, API, generated-type, or provider change.
- Changing how iteration or retry chips filter (the `Execution` select contract stays).
- Scroll-spy (updating the selector as the reader scrolls), persisting the navigated key across navigation or reload.
- Story 2.10's read-only dock, `Go to iteration N` control, or any steering behaviour.
- Renaming the existing `Attempt N` chip label beyond the `All iterations` addition.
- Grouping in chat cards, Run Stream, or any non-room surface.

## End-to-end design

```text
LogRow (occurrence, loopParent?)      LogRow (occurrence)         LogRow (node)
        │ selectionForNodeMessages()          │                          │
        ▼                                     ▼                          ▼
  { kind: 'node' } unfiltered         { kind: 'occurrence' }      { kind: 'node' }
        │                                     │ server-filtered          │
        ▼                                     ▼                          ▼
  selectNodeRoomMessages()  ──►  buildAgentHistory()  ──►  { items (each with execution), todos }
                                                                  │
                                                     groupByOccurrence(items)
                                                                  │
                                            { groups: [{ key, label, iteration, failed, items }], headers: boolean }
                                                                  │
                    ┌─────────────────────────────────────────────┴──────────────────────────────┐
                    ▼                                                                            ▼
   Legacy NodeTranscriptPane                                                   Console ConsoleNodeRoom
     RoomRegion                                                                  RoomRegion
       TodoStrip (when todos)                                                      ConsoleTodoStrip (when todos)
       OccurrenceSelector (when headers)      ◄── shell behaviour #7 ──►           ConsoleOccurrenceSelector (when headers)
       node-transcript-scroll                                                      console-node-room-scroll
         NodeRoom: [OccurrenceHeader, items…] per group                              ConsoleAgentHistoryList: [ConsoleOccurrenceHeader, items…] per visible group
       Jump to latest (conditional)                                                Jump to latest (conditional)
```

### Shared core contract (`occurrence-groups.ts`)

```ts
export interface OccurrenceGroup {
  key: string | null;          // occurrence_id, or null for the unkeyed fallback group
  label: string;               // 'Run 1 · failed' | 'Run 2 · retry' | 'Iteration 3' | '' for unkeyed
  iteration: number | null;    // last loop_ancestry entry's iteration
  retryEpoch: number | null;
  failed: boolean;             // group holds a failed / iteration_failed lifecycle item
  items: AgentHistoryItem[];   // seq order within the group
}
export interface OccurrenceGrouping { groups: OccurrenceGroup[]; headers: boolean }
export function groupByOccurrence(items: readonly AgentHistoryItem[]): OccurrenceGrouping;
export function occurrenceLabel(input: { retryEpoch: number | null; iteration: number | null; failed: boolean }): string;
```

`headers` is true only when two or more distinct keys exist. `attempt_id` is never read. Inputs are never mutated; output objects are fresh; the function never throws on malformed metadata (it treats it as absent).

### Shell contract (both surfaces, identical)

```text
select aria-label="Occurrence"            — pinned, after the todo strip, before the scroller; absent unless headers
  option value=""  Go to…                  — placeholder, selected until the reader navigates
  option value=<key> <label>               — one per rendered header, in group order
h3 id=<useId()>-<occurrence uuid> tabIndex=-1 — one per group when headers; text = label; rule after the label
```

On change: `ignoreNextScrollRef.current = true`; `scroller.scrollTop = heading.offsetTop - scroller.offsetTop`; `setFollow(holdScrollAt(follow, scroller.scrollTop))`; `setNavigatedKey(key)`; then `heading.focus({ preventScroll: true })` only when the change was pointer- or Enter/Space-originated (a `keydown` listener on the select records the last key; ArrowUp/Down/Home/End/PageUp/PageDown mark the change as a browse step). `handleScroll` consumes the ignore flag once and skips `onRoomScroll` for that event while still reporting `scrollTop` upward. The heading is a `<h3>` so assistive technology can list and jump between executions; its text is core-composed and contains no agent-authored string. DOM ids come from `useId()` plus the UUID-validated occurrence id; `executionFrom` accepts only UUID-shaped ids, so no free-form string reaches an id.

## Acceptance criteria

### Core contracts

- [ ] Every `AgentHistoryItem` variant exposes `execution` (tool: call row first, result row fallback; assistant: merged text row; lifecycle: its row); `null` when absent. Existing item fixtures gain the field and every other field is unchanged.
- [ ] `groupByOccurrence` keys on `occurrence_id` only, orders groups by first `seq`, rejoins non-contiguous occurrences into one group, attaches metadata-less items per decision 7, and sets `headers` only for two or more distinct keys.
- [ ] Labels: `Run 1`; `Run 2 · retry`; `Run 1 · failed`; `Run 2 · retry · failed`; `Iteration 3` (no suffix even when `retry_epoch > 0` or the iteration failed); the strings `Attempt` and `Pass` never appear.
- [ ] A transcript where every row lacks `execution` yields one unkeyed group, `headers: false`, and items identical to the input order.
- [ ] `selectionForNodeMessages` returns `{ kind: 'node', rowId }` for a `loopParent` occurrence row and byte-for-byte the previous result for every other row; all four call sites use it and the local helpers are deleted.
- [ ] `occurrenceSelection` in both `build-log-rows.ts` copies sets `loopParent: true` only for `node_type === 'loop'` executions whose `loop_ancestry` is absent or empty; iteration rows of the same node and a `loop:` node nested in a `loop_group` body do not get it; `executionLabel` returns `All iterations` for it.
- [ ] `holdScrollAt(state, top)` returns `{ follow: false, pinToBottom: false, scrollTop: top }`.

### Room behaviour (asserted identically on both surfaces)

- [ ] Rows from two or more occurrences render one `<h3>` per group in group order, each with the core label; a single-occurrence transcript renders no heading and no `Occurrence` select.
- [ ] The `Occurrence` select is a flex sibling immediately before the transcript scroller (after the todo strip when present) and is absent unless headers render.
- [ ] A pointer change (or Enter/Space-confirmed change) scrolls the scroller to that heading, moves `document.activeElement` to the heading, and leaves the select showing that key; a subsequent `rows.length` increase on a live node does not move `scrollTop` to the bottom, including when the heading sits within 24 px of the bottom and the programmatic write dispatches a real `scroll` event.
- [ ] Keyboard: with the select focused, ArrowDown three times scrolls to three successive headings while focus stays on the select; Enter then moves focus to the current heading. Both surfaces assert the identical sequence.
- [ ] A heading whose occurrence owns a `pending` Ask (`execution_scope.occurrence_id === group.key`) carries a visible `· awaiting input` suffix with an `sr-only` equivalent, so the whole-loop view cannot look idle while an iteration is blocked.
- [ ] Console `showSystem=false` never leaves an empty heading; a group reduced to zero visible items disappears from both the transcript and the select; `showToolCalls=false` behaves the same way.
- [ ] `ConsoleExecutionHistory` renders headings for a multi-occurrence slice, applies the same visibility rule (no empty heading under `showSystem=false`), and never mounts a select.
- [ ] The whole-loop view carries no unknown-scope notice, and iteration/retry chip rows still fetch their filtered scope (the E2E `[V:hitl.execution-scope]` assertion stays green).
- [ ] Group headings and options contain only core-composed text; no agent-authored value enters an `id`, `aria-label`, `title`, or class.

### End to end, visual, accessible

- [ ] On `e2e-hitl-run`'s `inspect-twice` node, choosing `All iterations` in the `Execution` select renders headings `Iteration 1` and `Iteration 2` plus the `Occurrence` select; selecting `Iteration 2` focuses that heading and brings it into the scroller's viewport; choosing an iteration chip removes both headings and the select. Proven on the Console route and the Legacy route.
- [ ] Header anatomy at the canonical 460 px room width on both surfaces: 10.5 px mono uppercase, 0.08em tracking, `text-secondary`, a 1 px `border` rule filling the remaining width, margin 10/0/5; the select uses each surface's existing control styling and clears a 24 px target.
- [ ] Chromium accessibility-tree evidence shows one combobox named `Occurrence`, one heading per group with the exact label, and focus on the heading after navigation.
- [ ] Manual macOS/VoiceOver and Windows/NVDA checks are attempted and recorded; an unavailable pairing is recorded as blocked, never claimed.

### Safety, compatibility, operations

- [ ] No backend/API/schema/migration/generated/dependency change; no new design token; no `@/components/` import from Console; no `@archon/workflows` import.
- [ ] Existing selection, pagination, interruption folding, todo strip, stick-to-bottom, Jump to latest, error/retry, and HITL suites stay green.
- [ ] Rollout is the normal Web bundle; rollback is a focused revert with no data or cleanup step.

## Phases

| #   | Phase                                                                                   | Depends on | Deliverable                                                                                                                              |
| --- | --------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | [Core grouping, fetch-scope amendment, red E2E](./phase-01-start.md)                    | None       | `execution` on items, `occurrence-groups.ts` + tests, `loopParent` + shared selection helper, `holdScrollAt`, compiling red E2E spec     |
| 2   | [Two-shell headers and selector](./phase-02-two-shell-headers-and-selector.md)          | Phase 1    | Legacy and Console headers + selectors, room mounts, Console filter rule, parity tests                                                   |
| 3   | [End-to-end and doc sync](./phase-03-end-to-end-and-doc-sync.md)                        | Phases 1–2 | Green E2E on both routes, visual/a11y evidence, EXPERIENCE/AD-7 corrections, full gates, PR                                              |

Deep mode: Phase 1 is planned in full; Phases 2 and 3 are outlined with the scout pass each must run before editing. The cook step performs that scout before executing each later phase.

## Global file inventory

| Path                                                                                                                | Action                                                                                                  | Test impact                                   |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `packages/web/src/lib/agent-history.ts`                                                                             | Add `execution` to all three item variants; export `TranscriptExecution` type                           | `agent-history.test.ts` fixtures gain a field |
| `packages/web/src/lib/agent-history.test.ts`                                                                        | Assert `execution` sourcing per variant; adapt existing deep-equal fixtures                             | modify                                        |
| `packages/web/src/lib/occurrence-groups.ts`                                                                         | Create pure grouping + label composer                                                                   | new                                           |
| `packages/web/src/lib/occurrence-groups.test.ts`                                                                    | Create full grouping/label/robustness table                                                             | new                                           |
| `packages/web/src/lib/execution-room-model.ts`                                                                      | `loopParent?: true` on `ExecutionRowSelection`; `All iterations` label                                  | `execution-room-model.test.ts`                |
| `packages/web/src/lib/node-message-pages.ts`                                                                        | Add `selectionForNodeMessages()`                                                                        | `node-message-pages.test.ts`                  |
| `packages/web/src/lib/room-scroll-follow.ts`                                                                        | Add `holdScrollAt()`                                                                                    | `room-scroll-follow.test.ts` (create if absent)|
| `packages/web/src/components/workflows/build-log-rows.ts`                                                           | `loopParent` on `LogRowSelection` + `occurrenceSelection`                                               | `build-log-rows.test.ts`                      |
| `packages/web/src/experiments/console/components/inspect/build-log-rows.ts`                                         | Same change, Console copy                                                                               | Console `build-log-rows.test.ts`              |
| `packages/web/src/components/workflows/NodeTranscriptPane.tsx`                                                      | Use shared selection helper; compute groups; mount `OccurrenceSelector`; navigation handler             | `NodeTranscriptPane.test.tsx`                 |
| `packages/web/src/components/workflows/WorkflowExecution.tsx`                                                       | Use shared selection helper (delete local copy)                                                         | existing suites                               |
| `packages/web/src/components/workflows/NodeRoom.tsx`                                                                | Accept optional `groups` + `headers` + `headingIdFor`; render `OccurrenceHeader` between groups; flat path when absent | `NodeRoom.test.tsx`, `LegacyNodeRoom.test.tsx` |
| `packages/web/src/components/workflows/LegacyNodeRoom.test.tsx`                                                     | `mountItems()` renders `NodeRoom` directly; stays compiling because the new props are optional; add one grouped-render case | modify                          |
| `packages/web/src/components/workflows/NodeRoom.tsx`, both `select-node-room-messages.ts` copies (`components/workflows/NodeRoom.tsx` `selectNodeRoomMessages`, `experiments/console/components/inspect/select-node-room-messages.ts`) | Slice a `loopParent` selection to rows whose `execution.retry_epoch` matches the row's `retryEpoch` | `NodeRoom.test.tsx`, Console `select-node-room-messages.test.ts` |
| `packages/web/src/experiments/console/components/ConsoleInspectPane.tsx` (+ `.test.tsx`)                            | No planned edit; `executionOptionsForNode` consumes `executionLabel`, so its option-label assertions must be re-run and adapted for `All iterations` | `ConsoleInspectPane.test.tsx`   |
| `packages/web/src/components/workflows/OccurrenceHeader.tsx`                                                        | Create Legacy heading                                                                                   | `NodeRoom.test.tsx`                           |
| `packages/web/src/components/workflows/OccurrenceSelector.tsx`                                                      | Create Legacy pinned select                                                                             | `NodeTranscriptPane.test.tsx`                 |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx`                                               | Use shared selection helper; compute groups + visibility; mount `ConsoleOccurrenceSelector`; navigation | `ConsoleNodeRoom.test.tsx`                    |
| `packages/web/src/experiments/console/components/ConsoleOccurrenceHeader.tsx`                                       | Create Console heading                                                                                  | `ConsoleNodeRoom.test.tsx`                    |
| `packages/web/src/experiments/console/components/ConsoleOccurrenceSelector.tsx`                                     | Create Console pinned select                                                                            | `ConsoleNodeRoom.test.tsx`                    |
| `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx`                               | Accept optional `groups` + `headers` + `headingIdFor`; render headings between visible groups; export `isTranscriptItemVisible(item, { showToolCalls, showSystem })` and use it in the render loop | `ConsoleNodeRoom.test.tsx`, `ConsoleExecutionHistory.test.tsx` |
| `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.tsx`                               | Use shared selection helper; pass groups (headings only)                                                | `ConsoleExecutionHistory.test.tsx`            |
| `e2e/ui/agent-occurrence-navigation.spec.ts`                                                                        | Create both-route behaviour, geometry, AX evidence on `e2e-hitl-run`                                    | new                                           |
| `e2e/fixtures/workflows/e2e-occurrence-live-loop.yaml` + `e2e/lib/playwright/archon-runtime.ts`                     | Create a delayed two-iteration loop fixture (`delayMs`) and its run helper for the live-hold case        | new / modify                                  |
| `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md`                     | Correct lines 59 and 391; note the selector scrolls                                                     | docs                                          |
| `_bmad-output/planning-artifacts/architecture/architecture-Archon-readable-agent-transcript-2026-09-12/ARCHITECTURE-SPINE.md` | Append the AD-7 amendment (loop parent fetches node-scoped) with evidence                     | docs                                          |
| `plans/260918-1711-issue-180-navigate-occurrences-and-loop-iterations/reports/acceptance.md`                        | Create evidence and gate report during implementation                                                   | report                                        |

Files deliberately untouched: `packages/core/**`, `packages/server/**`, `packages/workflows/**`, `migrations/**`, `api.generated.d.ts`, `index.css`, `ConsoleRoomHeader.tsx`, `NodeRoomHeader.tsx`, `merge-agent-room-items.ts`, `select-visible-node-ask-interactions.ts`.

## Implementation order and preflight

1. Recheck issue #180, open PRs, active worktrees/runs, and `git status`. Stories 1.3, 1.4, 1.6 may be in flight and touch `NodeRoom.tsx`, `ConsoleAgentHistoryList.tsx`, and their tests; rebase onto the accepted baseline before editing and repeat the scout at the start of Phases 2 and 3.
2. Phase 1: write red core tests, add `execution` to items, implement `occurrence-groups.ts`, land `loopParent` + the shared selection helper + `All iterations` + `holdScrollAt`, write the E2E spec so it compiles and fails.
3. Phase 2: write red parity tests in both shell suites; implement Legacy first, then Console; keep `ConsoleExecutionHistory` selector-free.
4. Phase 3: turn the E2E spec green on both routes, gather evidence, sync docs, run all gates, open the PR from the template with `Closes #180`.

## Validation commands

Package-isolated only; never run root `bun test`.

```bash
(cd packages/web && bun test src/lib/occurrence-groups.test.ts src/lib/agent-history.test.ts src/lib/execution-room-model.test.ts src/lib/node-message-pages.test.ts src/lib/room-scroll-follow.test.ts)
(cd packages/web && NODE_ENV=development bun test src/components/workflows/build-log-rows.test.ts src/components/workflows/NodeRoom.test.tsx src/components/workflows/NodeTranscriptPane.test.tsx src/components/workflows/LegacyNodeRoom.test.tsx)
(cd packages/web && NODE_ENV=development bun test src/experiments/console/components/inspect/build-log-rows.test.ts src/experiments/console/components/inspect/select-node-room-messages.test.ts src/experiments/console/components/ConsoleInspectPane.test.tsx src/experiments/console/components/ConsoleNodeRoom.test.tsx src/experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx src/experiments/console/console-isolation.test.ts)
(cd packages/web && bun run type-check && bun run lint)
(cd e2e && npm run typecheck)
bun run --cwd e2e test:ui -- --grep 'occurrence'
bun run --cwd e2e test:ui:hitl
bun run validate
```

## Risks, compatibility, and rollback

- **Execution ordering (verified):** `projectWorkflowExecutionHistory` sorts executions by `started_at` (`packages/server/src/routes/workflow-execution-history.ts:285`), so the loop node's outer execution is the FIRST Logs row and the FIRST `Execution` option; `chooseExecutionForNode` (`latestByOrder`) and `resolveGraphRoomRow` still land on the latest iteration, so the default room view is unchanged and `All iterations` is opt-in. Consequence for E2E: `[V:hitl.execution-scope]` in `e2e/ui/workflow-run-hitl-room.spec.ts` selects options 0 and 1 and polls for two distinct `occurrenceId`s; option 0 becomes the unfiltered view, so that case must select the two `Iteration N` options by label instead (Phase 3 Tests-before). The report must also show the whole-loop page renders within the 1 000 ms poll budget for a six-iteration node (grouping is O(n) over items already built).
- **Scale ceiling of the unfiltered fetch (documented, not solved):** the `loopParent` view drains every row of the node at `limit: 100` per page (`node-message-pages.ts:196`) and regroups after each merge, so first open of a loop with dozens of verbose iterations is materially heavier than any scoped view. This is the same code path the pre-occurrence node-scoped view already takes. The acceptance report records the measured open time for the largest local fixture available (the six-iteration `ralph-loop-run` with ~3 500 rows) as the tested ceiling; virtualization or lazy group loading is out of scope and becomes its own story if the measurement exceeds the poll budget.
- **Concurrent epic stories** edit the same renderer files. Preflight and conflict-aware test adaptation are mandatory; this plan does not restructure row markup.
- **Programmatic scroll in happy-dom** has no layout. Component tests stub `offsetTop`/`scrollHeight`/`clientHeight` with `Object.defineProperty`, as the existing scroll tests already do; the real geometry claim is proven only by the Playwright spec.
- **Non-contiguous outer occurrence** reorders one lifecycle row visually. Recorded as decision 2 and pinned by a fixture; the transcript never drops or duplicates a row.
- **Manual AT availability** is an explicit acceptance blocker, not an excuse to fabricate evidence.
- **Rollback:** revert the focused PR. No stored data, server contract, flag, or cleanup job is involved.

## Definition of done

- [ ] Every acceptance criterion has automated evidence or an honestly recorded manual blocker.
- [ ] Focused Web suites, the new and existing HITL E2E suites, package type-check/lint, and `bun run validate` pass.
- [ ] The diff stays within the inventory except cause-aligned fixes discovered by tests and recorded in the report.
- [ ] `reports/acceptance.md` distinguishes fixture, component, AX, screenshot, and manual-AT evidence.
- [ ] `EXPERIENCE.md` no longer claims nothing scrolls to a selection; AD-7 carries the amendment.
- [ ] The owning BMad workflow moves `1-7-navigate-transcript-occurrences-and-loop-iterations` to `done` only after the gates pass.
- [ ] PR uses the repository template, targets `develop`, and includes `Closes #180`.

## Unresolved questions

None blocking. Decision 1 (loop parent fetches node-scoped) is the one product-visible choice; it is recorded with its evidence so a reviewer can reverse it before Phase 2 if the owner prefers the strict AD-7 reading, in which case Phases 1–2 still ship the grouping and selector for the pre-occurrence and fallback paths and Story 2.10 needs its own reachability decision.

## Red Team Review

### Session — 2026-09-19
**Findings:** 16 (15 accepted, 1 rejected) across Security Adversary, Assumption Destroyer, and Failure Mode Analyst lenses.
**Severity breakdown:** 5 Critical, 5 High, 6 Medium

| # | Finding | Severity | Disposition | Applied To |
|---|---------|----------|-------------|------------|
| 1 | `loopParent` widening merges a `loop:` node nested in a `loop_group` across outer iterations | Critical | Accept | Decision 1, Phase 1 refactor step 4 + tests |
| 2 | Widened view surfaces unscoped Asks via `ownsUnscopedInteractions` | High | Reject — rests on the outer row being latest-ordered; `workflow-execution-history.ts:285` sorts by `started_at`, so the outer row is first and the last iteration owns unscoped Asks | — |
| 3 | No record that node- and occurrence-scoped requests share the same (absent) authorization | Medium | Accept | Decision 1 |
| 4 | `executionFrom` accepts non-UUID `occurrence_id` as a group key | Medium | Accept | Phase 1 refactor step 1 + tests |
| 5 | Index-based heading ids desync after a poll changes group membership | Medium | Accept | Phase 2 shell behaviour 3, 5 |
| 6 | Console filter can remove the navigated group without resetting the select | Medium | Accept | Decision 4, Phase 2 shell behaviour 4 + tests |
| 7 | Default-view claim inverted: executions sort by `started_at`, outer row is first | Critical | Accept (already corrected by the planner's own verification before the report) | Risks, Phase 3 tests |
| 8 | `LegacyNodeRoom.test.tsx` mounts `NodeRoom` directly and was missing from the inventory | Critical | Accept — new `NodeRoom` props are optional; file added to inventory and Phase 2 | Inventory, Phase 2 |
| 9 | `workflow retry-node` on a `loop:` node yields two `loopParent` rows sharing one unfiltered fetch | Critical | Accept — client slice by `retry_epoch` in both `selectNodeRoomMessages` copies | Decision 1, Phase 1 |
| 10 | `ConsoleInspectPane.tsx` `executionOptionsForNode` is an unlisted `executionLabel` consumer | High | Accept | Inventory, Phase 1 tests, validation commands |
| 11 | Console visibility predicate is inline, not shared | High | Accept — export `isTranscriptItemVisible` | Phase 2 |
| 12 | Programmatic `scrollTop` write fires `scroll`, re-arming pin-to-bottom within 24 px of the end | Critical | Accept — ignore-next-scroll ref + synthetic-scroll unit test | Decision 4, Phase 2 |
| 13 | Arrow-key `change` moves focus off the select: keyboard focus trap | High | Accept — arrow changes browse (scroll + hold), pointer/Enter changes focus the heading | Decision 4, Phase 2 tests |
| 14 | Live-hold race untested in unit and conditionally skipped in E2E | High | Accept — synthetic scroll-event unit test; E2E uses the existing `e2e-fake` `delayMs` scenario field in a dedicated fixture instead of `test.skip` | Phase 2, Phase 3 |
| 15 | No scale safeguard for the unfiltered loop-parent drain | Medium | Accept as documented ceiling with measured evidence; virtualization out of scope | Risks |
| 16 | `All iterations` can hide a pending Ask with no cue | Medium | Accept — `· awaiting input` heading suffix | Decision 8, Phase 2 |

## Validation Log

Interview not run (non-interactive finish requested). Decisions 1–10 were adopted with their recommended defaults and are reviewer-overridable; the only product-visible one is decision 1. Verification pass: the Security Adversary checked 20 cited claims, all VERIFIED; the planner separately corrected the execution-ordering claim (see Risks) against `workflow-execution-history.ts:285`.
