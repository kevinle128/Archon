---
title: 'Issue 178 pinned todo strip'
description: 'Implementation-ready plan for Story 1.5: fold OMP and Claude todo calls into one TodoPhase[] and pin the current checklist above the transcript on Legacy and Console.'
status: pending
priority: P1
effort: '3 phases'
issue: 'https://github.com/anhle128/Archon/issues/178'
branch: archon/thread-cabc0cf5
tags: [issue-178, agent-node-room, web, tdd, epic-1]
blockedBy: []
blocks: []
created: 2026-09-18
---

# Issue 178 pinned todo strip

## Goal and user outcome

Story 1.5 lets an operator track the agent's plan while the transcript scrolls. The node's ordered `todo` tool calls fold into one current `TodoPhase[]` — OMP's nine mutating ops and Claude's whole-list `TodoWrite` reach the reader as the same checklist — and that state renders **once**, in a strip pinned at the top of the transcript panel that stays visible while the transcript scrolls and is absent when the node has no todos. Every todo call in the transcript stays the compact one-line `todo updated` row Story 1.1 shipped; the checklist is never duplicated inline. A phase that `rm` empties disappears instead of rendering an empty header.

This is FR3 / CAP-3 plus UX-DR3 and UX-DR9 of the Agent Node Room epic. It is a web-only presentation slice over data already stored: no schema, migration, server route, API, or generated-type change. The one cross-package touch is test-only (an `emitTodo` scenario on the env-gated `e2e-fake` provider) so the "stays visible while scrolling" layout property can be proven end to end.

## Evidence and authority

When sources differ, use them in this order:

1. Story 1.5 acceptance criteria in `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md:319-344` and CAP-3 in `_bmad-output/specs/spec-agent-node-room/SPEC.md:62-64` (SPEC.md:27 declares itself and its companions the canonical contract).
2. `_bmad-output/specs/spec-agent-node-room/todo-fold-contract.md` (module, signature, the nine ops, the three traps, rendering rules) and `test-plan.md:61-78` (the `todo-state.test.ts` case list).
3. `_bmad-output/planning-artifacts/architecture/architecture-Archon-readable-agent-transcript-2026-09-12/ARCHITECTURE-SPINE.md` — AD-7 (`:121-125`: `buildAgentHistory()` returns items **and** node-level todo state), the pinned-strip rule (`:166-167`), and the Console `showToolCalls` rule (`:170`: the checklist is node state, not a tool call, so it survives the toggle being off).
4. `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md` — Checklist (`:121`), Folded todo row (`:122`), state patterns (`:163-165`).
5. `.../DESIGN.md` — `checklist` tokens (`:235-247`), `phase-label` typography (`:86-88`), Checklist component (`:599-603`), Folded todo row (`:605`), uppercase-label rule (`:512`).
6. Mockup handoff `claude-design/design_handoff_node_room_transcript_steering/` — README delta 1 (`:64-77`) and the strip markup in `Legacy Node Room.dc.html` (the `showTodoStrip` block) as the build reference for anatomy only; see Resolved source conflicts for where it loses.
7. The OMP harness itself, `@oh-my-pi/pi-coding-agent@18.1.21` (`~/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/dist/types/tools/todo.d.ts` and the op reducer in `dist/cli.js`, byte offset ≈15 817 900, functions `K4n`, `iZt`, `hot`, `a4i`, `l4i`, `u4i`, `p4i`, `c4i`, `execute`) — the behaviour the fold mirrors when the contract is silent.
8. Current product code and tests for behaviour the story keeps.

Verified repository facts:

- `buildAgentHistory()` (`packages/web/src/lib/agent-history.ts:247-293`) returns a flat `AgentHistoryItem[]`; each tool item already carries `presentation.family` from `toolRowPresentation` (`:186-189`), so the todo family is resolved before any fold runs. The todo family alias table is `todo | todowrite | plan` (`packages/web/src/lib/tool-presentation.ts:134-136`); the row headline is already `todo updated` with an `op: <op>` badge (`:487-492`).
- Three production call sites: `packages/web/src/components/workflows/NodeTranscriptPane.tsx:234-241`, `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx:605-612`, `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.tsx:205-210`. Every one passes `visibleMessages` (post-`selectNodeRoomMessages`), so the fold sees the **selected slice**, not the whole node — see Fold scoping below.
- Test call sites that see the return type: `packages/web/src/lib/agent-history.test.ts` (10 calls), `packages/web/src/components/workflows/LegacyNodeRoom.test.tsx:1027-1032` (`historyItems` helper), `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx:1206-1211` (`historyItems` helper). Both helpers call the real module through a namespace import; neither mocks the return value.
- Legacy scroll ownership: `NodeTranscriptPane.tsx:372-379` owns the `data-testid="node-transcript-scroll"` scroller and renders `NodeRoom` inside it; `NodeRoom`'s `RoomRegion` (`NodeRoom.tsx:141-154`) is itself `overflow-y-auto`, so a `position: sticky` element inside `NodeRoom` would stick to a non-scrolling ancestor and scroll away. The strip must be a sibling **above** the scroller.
- Console scroll ownership: `ConsoleNodeRoom.tsx:866-890` renders `RoomRegion > [scroll div (data-testid="console-node-room-scroll"), Jump to latest]`; the strip goes inside `RoomRegion` before the scroll div so the E2E `roomRegion()` locator (`e2e/ui/agent-tool-row-visual.spec.ts:51-53`) still contains it.
- `ConsoleAgentHistoryList` drops tool rows when `showToolCalls` is false (`ConsoleAgentHistoryList.tsx:425`); rendering the strip outside that list is what keeps the checklist alive with the toggle off.
- `ConsoleExecutionHistory` renders one log section inside the run-log scroller (`ConsoleInspectPane.tsx:243-289`); the section is not a scroll container of its own.
- Console never imports from `@/components/` (`ConsoleAgentHistoryList.tsx:1-4`); shared logic lives in `lib/`, JSX is written twice and thin. Both `ConsoleAgentHistoryList` mounts can appear on one page (selected room + inline execution history), so element ids must come from `useId()`.
- The `e2e-fake` provider (`packages/providers/src/e2e-fake/provider.ts:45-53` scenario schema; `:320-350` tool emission) emits one fixed tool per `emitTool`; nothing emits a todo call today. `e2e/fixtures/workflows/e2e-hitl-run.yaml` is shared by every HITL spec, so a todo node is added as a **new** fixture rather than into it.
- OMP semantics the contract does not state (from `dist/cli.js`): `execute` applies the op to a clone and **keeps the previous state whenever the op reported any error** (`m = f ? r : c`; `setTodoPhases` only when no errors) — an unknown `task`/`phase` target, a duplicate in `init`/`append`, `block`/`unblock` with no target, or `init` with no list is a whole-op no-op with no auto-promotion. `view` returns before the reducer runs; every other op is followed by `iZt` (auto-promotion). Task targeting is exact `content` equality across all phases (`rZt`); phase targeting is exact `name` equality (`z4n`). `rm` keeps an emptied phase in OMP state; the contract drops it at projection. Op inference (`p4i`) has three rules: `list` non-empty → `init`; `items` non-empty with a non-empty string `phase` → `append`; `items` non-empty with no `phase` → `init` **only when current state is empty** (`c4i(t, r.length > 0)`). The default phase name for flat `items` is `"Tasks"` (`i4i`).
- Issue #178 is open with no PR; its only blocker (Story 1.1, #174) shipped as #197 (`0fb1fd04`). The `ak-feature` dispatch on this issue failed in ~3 s and was rolled back (issue comments 2026-09-18); nothing landed. Story 1.2's plan exists at `plans/260918-1038-issue-175-raw-payload-toggle/` and is read-only for this story.

## Resolved source conflicts

- **Strip placement — pending owner confirmation (Validation question 1); default: top of the transcript panel.** SPEC.md:63 ("at the top of the transcript panel"), epics.md:322 ("pinned above the transcript"), and ARCHITECTURE-SPINE:167 all say top. The mockup README delta 1 and `Legacy Node Room.dc.html` place it between the transcript and the composer dock, and DESIGN.md:644 (adopted, `status: final`) describes the queue band as "directly below the todo strip", which only reads naturally with bottom placement. SPEC.md:27 declares itself canonical and the README itself says CAP-3 "needs updating" — the SPEC is the post-update text. Default is top; the E2E assertion scrolls the room to its bottom and asserts the strip is still in the viewport. If the owner chooses bottom, only the sibling order in the two shells and the E2E scroll direction change.
- **Log-view strip — pending owner confirmation (Validation question 2); default: render it, static.** `ConsoleExecutionHistory` is not a scroll container, so a strip there cannot be "pinned"; AD-7's "three call sites take a one-line edit" is about the type widening. Rendering nothing there would leave the Console log view with no checklist at all, which contradicts CAP-3's intent ("current progress is always in view"). Default: the same `ConsoleTodoStrip` at the top of the section body, statically positioned; the pinned behaviour is a property of the two rooms.
- **Default disclosure state — pending owner confirmation (Validation question 3); default: expanded.** The mockup's `todoOpen` placeholder is `false`. Story AC 2 says the strip "shows phase headers and per-item status"; a collapsed header showing only the current item and a count does not. Default: header button `aria-expanded="true"` on first render, checklist visible, collapsible to the one-line summary; the choice persists per node id while the room stays mounted and resets when the node changes.
- **Which calls fold.** The contract signature is `projectTodoState(inputs: readonly unknown[])`. Every tool item whose resolved `presentation.family === 'todo'` contributes its `input`, in `seq` order, regardless of row outcome — the fold's own validation mirrors the harness, so a call the harness rejected is already a no-op in the fold. A `running` call folds optimistically (its input is known). No outcome filter.
- **Fold scoping.** The fold runs over the visible slice each call site already computes, so a `loop_iteration` selection shows that iteration's checklist and an occurrence selection shows that occurrence's. This is a consequence of where AD-7 puts the fold, not a product decision; it is recorded here so it is not later reported as a bug.
- **Interrupted todo rows.** `buildAgentHistory` folds a following `interrupted` status into the preceding tool item (`agent-history.ts:252-266`); that item still carries its input and still folds.
- **What the strip does not contain.** No progress meter (the mockup's segmented bar has no token in DESIGN.md's `checklist` component), no `Raw` button (Raw is per row, Story 1.2), no `todo · folded from N calls` body bar (EXPERIENCE.md:112 puts the bar in the row body; EXPERIENCE.md:122 says expanding a todo row shows nothing new — Story 1.3's contradiction to resolve), and no reading of OMP's `TodoToolDetails.phases` result snapshot (the contract folds inputs; result details are absent on every observed OMP row).

## Scope

### In scope

- `packages/web/src/lib/todo-state.ts`: `TodoStatus`, `TodoItem`, `TodoPhase`, `projectTodoState()`, plus `summarizeTodoState()` for the strip header, with the unit table from `test-plan.md:61-78` and the real two-phase fixture.
- `buildAgentHistory()` returns `{ items, todos }`; the three call sites and the three test helpers take the one-line edit.
- A Legacy `TodoStrip` and a Console `ConsoleTodoStrip` with identical anatomy, wording, semantics, and keyboard behaviour, each on its own tokens; rendered above the scroller in `NodeTranscriptPane` and `ConsoleNodeRoom`, statically at the top of `ConsoleExecutionHistory`.
- `emitTodo` scenario on `e2e-fake`, a new fixture workflow, and a new Playwright spec proving the strip on both surfaces: present, pinned while scrolling, absent without todos, glyph-not-colour, keyboard toggle.
- Unit, component, E2E, geometry, focus, reduced-motion, contrast, and manual screen-reader evidence, recorded in `reports/visual-acceptance.md`.

### Out of scope

- Story 1.3 family bodies (including any todo body arm), Story 1.4 diff, Story 1.6 task cards, Story 1.7 occurrence grouping, Epic 2 steering and the composer dock, the queue band.
- Backend, API, persistence, schema, migration, generated types, workflow-engine, or dependency changes; production provider code.
- Chat tool cards, Run Stream `ToolCallItem`, and any surface other than the two node rooms and the Console log section.
- A shared React component across surfaces, new design tokens, or persistence of the strip's open/closed state across page loads.

## End-to-end design

```text
NodeMessageRow[] (visible slice)
   │  projectTextTranscript → projectToolTranscript → toToolItem (presentation.family)
   ▼
buildAgentHistory(input) ─► { items: AgentHistoryItem[], todos: TodoPhase[] }
                                           ▲
      items.filter(tool && family === 'todo').map(item => item.input)
                                           │
                    projectTodoState(inputs)   ← pure, lib/todo-state.ts
                                           │
   Legacy  NodeTranscriptPane ──► <TodoStrip phases>          above data-testid="node-transcript-scroll"
   Console ConsoleNodeRoom    ──► <ConsoleTodoStrip phases>   inside RoomRegion, above console-node-room-scroll
   Console ConsoleExecutionHistory ──► <ConsoleTodoStrip>     top of the section body, static
```

Strip anatomy (both shells, `todos.length === 0` renders nothing):

```text
<section aria-label="Todo">                              flex-none; border-b border; surface-elevated
  <button aria-expanded aria-controls={useId()}>        full-width header, min-h 24px, 6px 10px padding
    TODO                                                 phase-label: 10px, 0.07em, uppercase, text-secondary
    <glyph aria-hidden/> <sr-only status/> current item  11.5px mono, text-primary, end-elided (see summarizeTodoState)
    3/6                                                  10px mono, text-secondary
    ▾                                                    aria-hidden chevron, 120 ms rotate, motion-reduce:none
  </button>
  <div id={…} hidden={!open}>                            4px 10px 8px padding; max-h 168px; overflow-y auto; border-t
    <h3>RESEARCH</h3>                                    phase-label, 4px top margin        ← one per non-empty phase
    <ul><li>☑ <sr-only>completed</sr-only> Read spec</li>
        <li>◐ <sr-only>in progress</sr-only> Locate cap</li>
        <li>⊘ <sr-only>blocked</sr-only> Run suite <span>· blocked: CI</span></li>
        <li>☐ <sr-only>abandoned</sr-only> <s>Old task</s> <span>· dropped</span></li></ul>
  </div>
</section>
```

Glyphs and tones follow DESIGN.md:599-603: `☑` success, `◐` running colour (Legacy `text-accent-bright`, Console `var(--running)` — the same pair `GLYPH_TONE.running` already uses on each shell), `⊘` warning, `☐` text-secondary; abandoned is `☐` plus line-through and `· dropped`; blocked carries `· blocked: <reason>` in text-secondary. Four shapes, so state survives without colour; each item also carries the status word in an `sr-only` span so a screen reader hears it.

`summarizeTodoState(phases)` returns `{ done, total, current }` where `current` is the first `in_progress` item, else the first `blocked` item, else the last `completed` item, else `null`; the header shows `current.content` with its glyph, or the first phase name when `current` is null.

## Acceptance criteria

### Behaviour and contracts

- [ ] `projectTodoState` passes the full `test-plan.md:61-78` list: Claude last-call-wins into one `Tasks` phase with verbatim statuses and `activeForm` dropped; one case per OMP op; bare `done`/`drop`/`rm` target everything; auto-promotion changes a task the row never named; missing `op` is inferred by all three rules; `{ops:[…]}` is accepted; `block` never reopens `completed`/`abandoned`; `unblock` affects only `blocked`; unknown op and `done`-before-`init` leave `[]`; an emptied phase is dropped and an all-empty fold returns `[]`; the real two-phase fixture from `plans/260909-2130-live-interactive-agent-view/findings.md:154-156` reproduces the expected state.
- [ ] An op the harness would reject (unknown target, duplicate item, missing required field) leaves state unchanged and does not trigger auto-promotion; the test names the OMP `execute` revert as the reason.
- [ ] `buildAgentHistory()` returns `{ items, todos }`; `todos` folds only tool items with `presentation.family === 'todo'`, in `seq` order, ignoring `assistant`/`lifecycle` items and every other family; a slice with no todo calls yields `todos: []`; `items` is byte-for-byte the Story 1.1 array.
- [ ] On both surfaces a strip renders when `todos.length > 0`, shows every non-empty phase as an uppercase phase label followed by its items with the four glyphs and status words, and renders **nothing** (no section, no header) when `todos.length === 0`.
- [ ] The strip sits outside the transcript scroller on Legacy and Console rooms: scrolling the scroller to either extreme leaves the strip fully in the viewport (E2E `toBeInViewport()`), and the strip is inside the `<nodeId> room` region.
- [ ] Every todo call in the transcript remains a one-line `todo updated` row with an `op:` badge; opening it does not render a checklist; no checklist text appears inside any `details[data-tool-id]`.
- [ ] Console: with `showToolCalls` off the strip is still present while the todo rows are gone; `showSystem` has no effect on it.
- [ ] The Console log section renders the same strip (static) above its history when the execution has todos, and nothing when it does not.
- [ ] Header toggle: `Enter`/`Space` collapse the checklist to the one-line summary and flip `aria-expanded`; the choice survives polling re-renders and resets when the selected node changes.
- [ ] Live update: a new todo row arriving through polling updates the strip in place without remounting it (no focus loss on the header button).

### Safety, performance, and compatibility

- [ ] `projectTodoState` never throws on any `unknown` input (non-objects, arrays, missing fields, wrong types, `null` entries): unrecognised rows are skipped; it is pure and deterministic (fresh objects per call, inputs never mutated).
- [ ] Bounded work: one pass over the inputs; per-op cost linear in the task count; no regex over prose; no recursion into nested payloads beyond the documented shapes.
- [ ] React text nodes only; no payload text placed in `title`, `aria-label`, or `id` attributes; ids come from `useId()`.
- [ ] No change to server routes, schemas, generated types, `pair-tool-transcript`, `tool-presentation`, or the Story 1.1 row markup; the `e2e-fake` change is additive and only active under `ARCHON_E2E_FAKE_PROVIDER`.

### Visual, responsive, and accessible behaviour

- [ ] Strip container: `surface-elevated`, 1 px `border` bottom edge (top placement), no radius; header 6 px/10 px padding, `min-height: 24px`; hover `surface-hover`; focus-visible 2 px `--accent-bright` (offset −2 px Legacy / +2 px Console, matching each shell's row summary).
- [ ] Phase label: 10 px, `0.07em` tracking, uppercase, text-secondary, 4 px top margin. Items: 11.5 px mono, line-height 1.85, text-secondary; the current item's glyph uses the running colour.
- [ ] Checklist body capped at 168 px with internal vertical scroll so a long plan never swallows the transcript; the strip never widens the 460 px room or introduces horizontal scroll at 390 px or 200 % zoom.
- [ ] Contrast: every strip tone ≥ 4.5:1 on `surface-elevated` on both shells (recorded); header target ≥ 24 × 24 (measured); chevron rotation honours `prefers-reduced-motion`.
- [ ] Accessible structure: `section` named `Todo`, header `button` with `aria-expanded`/`aria-controls`, phase names as headings, items in lists, status words present for every item; no live region (the strip is state, not an alert).

## Phases

| #   | Phase                                                                                  | Depends on | Output                                                                                     |
| --- | -------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------ |
| 1   | [Todo fold, history contract, red E2E](./phase-01-start.md)                            | None       | `todo-state.ts` + unit table, `{ items, todos }` return, `emitTodo` fake, fixture, red spec |
| 2   | [Legacy and Console renderers](./phase-02-two-surface-renderers.md)                    | Phase 1    | Red component tests then green strip on both rooms and the log section                     |
| 3   | [End-to-end and visual verification](./phase-03-end-to-end-and-visual-verification.md) | Phases 1–2 | Green E2E, geometry/contrast/keyboard/screen-reader evidence, `bun run validate`, report   |

Deep mode: Phase 1 is planned to file-and-line detail. Phases 2 and 3 are planned to the same depth from today's scouting, but each begins with a scout step that re-reads the files it touches (line anchors drift after Phase 1 and after Story 1.2 if it lands first) before any edit.

## Global file inventory

| Path                                                                                       | Action                                                                              |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `packages/web/src/lib/todo-state.ts`                                                       | Create: types, `projectTodoState`, `summarizeTodoState`                             |
| `packages/web/src/lib/todo-state.test.ts`                                                  | Create: contract table, harness-revert cases, real fixture, summary cases           |
| `packages/web/src/lib/agent-history.ts`                                                    | Modify: `AgentHistory` result type, fold todo inputs, return `{ items, todos }`     |
| `packages/web/src/lib/agent-history.test.ts`                                               | Modify: destructure `items`; add `todos` cases                                      |
| `packages/web/src/components/workflows/LegacyNodeRoom.test.tsx`                            | Modify: `historyItems` helper returns `.items`                                      |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx`                 | Modify: `historyItems` helper returns `.items`; strip cases on the selected room    |
| `packages/web/src/components/workflows/TodoStrip.tsx`                                      | Create: Legacy strip                                                                |
| `packages/web/src/components/workflows/NodeTranscriptPane.tsx`                             | Modify: destructure, render `TodoStrip` above the scroller                          |
| `packages/web/src/components/workflows/NodeTranscriptPane.test.tsx`                        | Modify: strip present/absent/pinned-outside-scroller/toggle cases                   |
| `packages/web/src/experiments/console/components/inspect/ConsoleTodoStrip.tsx`             | Create: Console strip                                                               |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx`                      | Modify: destructure, render `ConsoleTodoStrip` inside `RoomRegion` above the scroller |
| `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.tsx`      | Modify: destructure, render `ConsoleTodoStrip` above the history                    |
| `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx` | Modify: strip present/absent in the log section                                     |
| `packages/web/src/experiments/console/console-isolation.test.ts`                           | Verify only (Console must not import `@/components/`)                               |
| `packages/providers/src/e2e-fake/provider.ts`                                              | Modify: `emitTodo` scenario flag emitting an OMP `init` → `done` → `block` sequence |
| `packages/providers/src/e2e-fake/provider.test.ts` (or the file that tests the scenario schema) | Modify: `emitTodo` yields the three todo calls in order                        |
| `e2e/fixtures/workflows/e2e-todo-strip.yaml`                                               | Create: one `emitTodo` node with `repeatTool` for scroll height, one node without   |
| `e2e/lib/playwright/archon-runtime.ts`                                                     | Modify: seed the new fixture; export its name and node ids                          |
| `e2e/ui/agent-todo-strip.spec.ts`                                                          | Create: behaviour + visual evidence on both surfaces                                |
| `plans/260918-0826-issue-178-pinned-todo-strip/reports/visual-acceptance.md`               | Create during implementation                                                        |

`NodeRoom.tsx`, `ConsoleAgentHistoryList.tsx`, `tool-presentation.ts`, `pair-tool-transcript.ts`, server routes/schemas, generated API types, theme token files, and `_bmad-output/**` are read-only. Stop and revise the plan before expanding into them. `sprint-status.yaml` moves to `done` only through its owning BMad workflow after all gates pass.

## Implementation preflight and order

1. Recheck issue #178, open PRs, active runs, `git status`, and worktrees for a competing owner; confirm whether Story 1.2 (#175) has landed, because it rewrites the row body both shells render around (not the strip) and shifts line anchors. Branch from `develop` per repo convention; never commit to `main`.
2. Phase 1 (red → green): unit table for `projectTodoState` and `summarizeTodoState`; `agent-history` return-shape tests; implement the fold; widen the return and fix the three call sites and three helpers so type-check is green; add `emitTodo`, the fixture, and the E2E spec (red until Phase 2).
3. Phase 2 (red → green): component tests on `NodeTranscriptPane`, `ConsoleNodeRoom`, `ConsoleExecutionHistory`; implement `TodoStrip`, then `ConsoleTodoStrip`; wire the three mounts.
4. Phase 3: run the new spec and the existing HITL specs, capture geometry/contrast/keyboard/screen-reader evidence, run `bun run validate`, write the report.

## Validation and proof

- Unit: `cd packages/web && bun test src/lib/todo-state.test.ts src/lib/agent-history.test.ts`.
- Component: `cd packages/web && bun run test` (happy-dom) proves presence/absence, outside-the-scroller placement, `showToolCalls` independence, toggle semantics, live update, both Console mounts.
- E2E: `bun run --cwd e2e test:ui -- --grep 'todo strip'` plus `bun run --cwd e2e test:ui:hitl` for regressions; runs **locally** and the pass is recorded in the PR (`.github/workflows/test.yml` does not trigger `e2e-hitl` on `develop`, as Story 1.2's plan recorded).
- Full gates: Web tests and type-check, providers tests, E2E type-check, `bun run validate`. Never run root `bun test`.

## Rollout, failure handling, and rollback

- Web-only presentation change over existing data plus an env-gated test provider flag; no ordering, migration, flag, or staged rollout.
- If a payload cannot be folded safely, skip that row and keep the last good state rather than throwing inside the transcript; never fabricate a list.
- If visual or accessibility acceptance fails on one surface, fix both surfaces together; do not ship an asymmetric strip.
- Roll back the whole change (fold, return shape, both strips, fake flag, fixture, spec) as one unit.

## Definition of done

- [ ] Every acceptance criterion above has passing automated evidence or a named manual record.
- [ ] `todo-state.test.ts` covers every line of `test-plan.md:61-78` plus the harness-revert cases; `agent-history.test.ts` covers the widened return.
- [ ] Both rooms and the log section pass equivalent strip tests; `console-isolation.test.ts` stays green.
- [ ] `reports/visual-acceptance.md` records 460 px evidence, contrast and target-size results, reduced-motion, and two OS screen-reader checks.
- [ ] Focused tests, full Web tests, Web/providers/E2E type checks, the new and existing HITL specs, and `bun run validate` pass.
- [ ] The final diff contains no unrelated, schema, API, generated, dependency, or migration change.
- [ ] PR body says `Closes #178`; sprint status `1-5-track-the-agents-current-todo-state-in-a-pinned-strip` moves to `done` only through its owning BMad workflow.

## Open questions

Three owner decisions are pending the validation interview and are applied with their defaults until answered: strip placement (top vs between transcript and dock), the Console log-section strip (render static vs omit), and the default disclosure state (expanded vs collapsed). See Resolved source conflicts.
