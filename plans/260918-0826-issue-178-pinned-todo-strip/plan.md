---
title: 'Issue 178 pinned todo strip'
description: 'Implementation-ready plan for Story 1.5: fold OMP and Claude todo calls into one node-state checklist and pin it above the transcript in both node rooms.'
status: pending
priority: P1
effort: '3 phases / about 11h'
issue: 'https://github.com/kevinle128/Archon/issues/178'
branch: archon/thread-cabc0cf5
tags: [issue-178, agent-node-room, web, tdd, epic-1]
blockedBy: []
blocks: []
created: 2026-09-18
revised: 2026-09-18
---

# Issue 178 pinned todo strip

## Goal and user outcome

Give an operator a truthful, compact view of the selected agent execution's current todo state while its transcript scrolls. Ordered OMP `todo` mutations and Claude `TodoWrite` whole-list calls normalize to one `TodoPhase[]`. That state renders once in a collapsible strip at the **top of the transcript panel**, remains visible while the transcript scrolls, and is absent when no reconstructable todo state exists.

Every todo call remains a one-line `todo updated` transcript row. Neither its current temporary Input/Output body nor Story 1.2's prospective Raw body may contain a duplicate checklist. An `rm`-emptied phase disappears rather than leaving a misleading empty heading.

This is Story 1.5 / CAP-3. It is a Web presentation feature over persisted node messages. It needs no database, migration, API, generated-type, or production-provider change. The only provider-package change is an env-gated deterministic E2E fixture capability.

## Verified evidence and authority

The implementation must follow the repository's declared authority order, not whichever artifact is most visually detailed:

1. `_bmad-output/specs/spec-agent-node-room/SPEC.md` and Story 1.5 in `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md` require one pinned strip at the **top** of the transcript panel, no inline checklist, no strip without todos, and no empty phase.
2. `_bmad-output/specs/spec-agent-node-room/todo-fold-contract.md` owns the shared type, two provider shapes, nine OMP operations, inference traps, and projection rules. `_bmad-output/specs/spec-agent-node-room/test-plan.md` names the minimum fold cases.
3. Read-spine AD-7 and AD-12 in `_bmad-output/planning-artifacts/architecture/architecture-Archon-readable-agent-transcript-2026-09-12/ARCHITECTURE-SPINE.md` require `buildAgentHistory()` to return rows plus node todo state, both node rooms to render the strip, and Console `showToolCalls=false` not to hide it.
4. The final `EXPERIENCE.md` and `DESIGN.md` under `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/` own interaction, tokens, typography, status glyphs, and the two-renderer boundary.
5. `claude-design/design_handoff_node_room_transcript_steering/README.md` and its two `.dc.html` prototypes supply the strip anatomy where higher authorities are silent: collapsed default, current-item summary, segmented meter, 168 px body cap, current-row emphasis, and 120 ms caret.
6. Current code and tests own existing public behavior that this story must preserve.

Repository inspection established:

- `packages/web/src/lib/agent-history.ts` currently returns a flat `AgentHistoryItem[]`. Each tool item already has `presentation.family`; `tool-presentation.ts` resolves `todo`, `TodoWrite`, and `plan` to the todo family.
- Production has three callers: `NodeTranscriptPane.tsx`, `ConsoleNodeRoom.tsx`, and `ConsoleExecutionHistory.tsx`. All pass the already-selected message slice, so a loop/occurrence selection receives only that slice's todo calls.
- Only the first two callers are node rooms with their own transcript scroller. `ConsoleExecutionHistory` is an inline log section inside another scroller; a strip there would scroll away and could not satisfy CAP-3. It only adapts to the widened return type.
- Legacy currently nests `NodeRoom`'s `RoomRegion` inside `NodeTranscriptPane`'s scroller. Mounting the strip beside that scroller without moving landmark ownership would put it outside the `<node> room` region. The legacy shell therefore needs a small region/content split, not `position: sticky`.
- Console already has the correct ownership: `RoomRegion` contains `console-node-room-scroll`, so the strip can be inserted immediately before the scroller.
- `ConsoleAgentHistoryList` applies `showToolCalls`; the strip must remain outside that list.
- The env-gated `e2e-fake` provider has typed `emitTool`/`repeatTool` scenarios but no todo scenario. The runtime seeds fixtures explicitly.
- The installed supported OMP CLI observed during planning is `@oh-my-pi/pi-coding-agent@18.1.21`. Its `src/tools/todo.ts` confirms exact task/phase matching, atomic rollback on an erroneous call, duplicate rejection, whitespace-normalized blockers, inference for bare `items`, auto-promotion after successful mutations, and a read-only `view`. It is behavioral evidence, not a repository dependency pin.
- Issue #178 is open with no PR. Story 1.1 shipped in `0fb1fd04` / PR #197. Story 1.2 (#175) has an active implementation run and overlaps row files/tests, so implementation must repeat the ownership/baseline preflight.
- Issue #178's generated footer incorrectly says `CAP-5` / `diff-hunks`; its Outcome and Acceptance Criteria explicitly delegate to Story 1.5, whose canonical references are CAP-3 / todo fold. Treat the footer as stale tracker metadata, not feature scope.

## Resolved conflicts and decisions

There are no product decisions left open in this plan.

1. **Top, not bottom.** The SPEC, epic, and architecture spine override the older prototype's transcript/dock ordering. At the top, the strip uses a bottom rule against the transcript. It remains a flex sibling of the scroller and never overlays content.
2. **Collapsed by default.** The handoff explicitly chose this to preserve transcript height. The story's phase/item requirement applies when expanded; the collapsed header still reports current status and completed/total count.
3. **Adopt the meter and current-row treatment.** The handoff is the only detailed strip anatomy and is adopted by the SPEC. The meter is decorative because the adjacent text count carries the aggregate. The current row also uses a background and inset bar, so it is not identified by hue alone.
4. **No strip footer Raw/body bar.** The prototype footer conflicts with the final EXPERIENCE rule that the checklist exists only in the pinned strip and Raw belongs to an individual tool row. A fold across several calls has no single truthful raw payload. Story 1.2 may change todo row bodies, but this story only forbids an inline checklist.
5. **Two room renderers, no inline-log renderer.** AD-7's third call-site edit is a return-shape edit. AD-12 and EXPERIENCE name the Legacy and Console node rooms as the two shipping surfaces. A static strip in `ConsoleExecutionHistory` would expand scope without meeting the pinned outcome.
6. **Scope follows the selected message slice.** This preserves the current node/occurrence/loop selection contract. It does not fetch or merge hidden executions.
7. **`view` is read-only.** The fold contract's table says `view` makes no change and the observed OMP implementation skips normalization/writes. “Auto-promotion after every op” is implemented and documented as every successful **mutating** op.
8. **Malformed calls are atomic no-ops.** A Claude snapshot is accepted as a whole or ignored. A legacy `{ops:[…]}` batch is replayed in order only if every entry is valid; otherwise the prior state is retained. This follows OMP's call-level rollback and avoids presenting a state no provider committed.
9. **Header fallback is always an item.** Summary resolution is first `in_progress`, first `blocked`, last `completed`, then the first remaining item. It never substitutes a phase name for current work.
10. **Do not rewrite state from node lifecycle.** The prototype's demo-only `todoEnd` mapping turns every item completed on a completed node and demotes current work on an abandoned node. That conflicts with the canonical `projectTodoState(inputs)` signature and AD-12's requirement to mirror the core-supplied `TodoPhase[]`. Render the provider-derived fold unchanged; terminal chrome must not fabricate todo mutations.
11. **Final DESIGN values override prototype CSS.** Use checklist line-height 1.85 and phase margin 4 px rather than 1.75/8 px. Console keeps the final DESIGN's +2 px focus offset while Legacy uses −2 px, rather than copying the prototype's −2 px to both; browser evidence must prove the full-bleed Console ring is not clipped.
12. **Fold recorded inputs, not result snapshots.** The machine contract takes ordered inputs and current OMP rows do not retain typed result details. A running call with known input folds optimistically; interrupted/result rows do not remove it. Input validation/reducer errors are no-ops, but renderers never invent an outcome-based rollback absent from the contract.

The implementation also corrects three stale narrative passages: the last paragraph of `todo-fold-contract.md`, Flow 1 step 6 in `EXPERIENCE.md`, and the superseded placement/update wording in the handoff README. Generated prototype HTML remains historical comparison evidence and is not rewritten.

## Scope

### In scope

- Pure `TodoPhase[]` projection and summary/status presentation helpers in `packages/web/src/lib/todo-state.ts`.
- `buildAgentHistory()` returning `{ items, todos }`, with all three production callers and all test callers adapted.
- A Legacy `TodoStrip` and Console `ConsoleTodoStrip`, using identical semantics/anatomy and each surface's existing tokens.
- Legacy landmark ownership refactor so the strip and transcript scroller are siblings inside exactly one room region.
- Console room mount above its transcript scroller; strip independence from `showToolCalls`.
- Deterministic `emitTodo` E2E support, a dedicated workflow, and a focused Playwright spec that proves both the pinned transcript and the checklist's own overflow.
- Contract-document synchronization and an implementation evidence report.

### Out of scope

- Rendering a strip in `ConsoleExecutionHistory`, chat cards, Run Stream, or any non-room surface.
- Story 1.2 Raw, Story 1.3 family bodies, Story 1.4 diff, Story 1.6 task cards, Story 1.7 occurrence grouping, steering, queue, or composer work.
- Reading provider names in renderers, consuming OMP result-detail snapshots, or changing message persistence.
- Backend routes, schemas, migrations, generated types, runtime flags, new design tokens, dependencies, or cross-surface React-component sharing.
- Persisting disclosure state across navigation or page reload.

## End-to-end design

```text
selected NodeMessageRow[]
  -> buildAgentHistory()
       -> unchanged AgentHistoryItem[]
       -> todo-family inputs in projected seq order
          -> projectTodoState(inputs) -> TodoPhase[]

Legacy NodeTranscriptPane
  RoomRegion (non-scrolling landmark)
    TodoStrip                         <- fixed flex child
    node-transcript-scroll            <- only transcript scroller
      NodeRoom content (embedded)
    Jump to latest (conditional)

Console ConsoleNodeRoom
  RoomRegion
    ConsoleTodoStrip                  <- fixed flex child
    console-node-room-scroll           <- only transcript scroller
      ConsoleAgentHistoryList
    Jump to latest (conditional)

ConsoleExecutionHistory
  buildAgentHistory(...).items only   <- no strip; parent log owns scrolling
```

### Shared state contract

`todo-state.ts` exports the contract types, `projectTodoState()`, `summarizeTodoState()`, and one readonly semantic map from status to glyph and accessible label. The shells own only markup and token classes.

- Claude: a valid `{ todos: [...] }` replaces state with one `Tasks` phase; `activeForm` is dropped; `todos: []` clears state; an invalid entry rejects that whole call.
- OMP: infer only the documented unambiguous missing-`op` shapes; apply a valid operation to a scratch copy; commit and auto-promote after successful mutating operations; retain prior state on any error; `view` is a true no-op.
- Legacy batch: replay valid entries in order as though they were ordered calls, including normalization after each mutating entry; reject the entire batch if any entry cannot be safely applied.
- Projection drops empty phases, returns fresh objects, never mutates inputs, and never throws on `unknown`.
- Summary counts only `completed` items as done and resolves the representative item in the order recorded above.

### Strip contract on both surfaces

```text
section "Todo" — surface-elevated, full bleed, no radius, bottom rule
  button — full width, 6px 10px, collapsed initially
    TODO
    status glyph + representative item (one line, elided)
    decorative segmented meter (one cell per item)
    completed/total
    caret (180deg when open, 120ms; no transition under reduced motion)
  disclosure body — 4px 10px 8px, max-height 168px, internal y-scroll
    PHASE
      glyph + item + blocked/dropped suffix
```

- `useId()` binds `aria-controls` to a body that stays in the DOM with `hidden` while collapsed.
- The header and each item expose status words to assistive technology; visible glyphs and suffixes are not the sole status channel.
- Blocked/dropped visible suffixes are hidden from the accessibility tree when an equivalent single status phrase is supplied, preventing duplicate announcements.
- The meter is `aria-hidden`; the text count is the aggregate alternative.
- The current body row uses `surface`, primary text, and a 2 px inset running marker in addition to its glyph/label.
- No new live region is introduced. Native disclosure state and static list semantics cover this story; the architecture's single node-transition announcement channel must not be duplicated per strip.
- Components defensively return `null` for `[]`; each parent also conditionally mounts only while `todos.length > 0`, so an all-removed state really destroys disclosure state. Non-empty instances use `key={resolvedScopeKey}` so selection changes reset to collapsed without an effect, while same-scope polling preserves disclosure state, DOM identity, and focus.

## Acceptance criteria

### Fold and history contracts

- [ ] `projectTodoState` covers both Claude cases and every test named in `test-plan.md`: all nine OMP ops, all-targeting bare `done`/`drop`/`rm`, three missing-`op` inference forms, valid legacy batch, auto-promotion, block/unblock rules, unknown operation, done-before-init, empty-phase removal, and the observed two-phase fixture.
- [ ] Tests also pin call-level rollback for invalid target, duplicate, malformed Claude entry, and malformed batch; rejected calls do not trigger auto-promotion.
- [ ] `view` leaves state byte-for-byte unchanged; every successful mutating OMP operation normalizes at most one `in_progress` task and promotes the first pending item when needed.
- [ ] Any `unknown` input is safe: no throw, no input mutation, no invented state, fresh output objects.
- [ ] `buildAgentHistory()` returns `{ items, todos }`; `items` deep-equals the pre-change projection, todo inputs are selected only by resolved family and projected sequence, and non-todo rows cannot affect the fold.
- [ ] Terminal/lifecycle events do not rewrite folded todo statuses; only recorded todo inputs change `todos`.
- [ ] `ConsoleExecutionHistory` consumes `.items` and gains no strip markup.

### Room behavior

- [ ] A non-empty folded state renders exactly one strip in each selected node room; `[]` renders no section/header/body.
- [ ] The strip is the first child inside the one `<nodeId> room` region and the immediate preceding sibling of that room's transcript scroller. Scrolling from top to bottom changes transcript content while the strip's bounding box remains fixed.
- [ ] Legacy retains exactly one room landmark after `NodeTranscriptPane` takes region ownership; other Legacy room kinds keep their existing scroll behavior.
- [ ] The strip starts collapsed. Enter, Space, and click toggle `aria-expanded` and `hidden`; focus stays on the button.
- [ ] Polling updates the count/items without remounting or losing focus and preserves the reader's disclosure choice. Changing scope remounts collapsed. Removing every todo unmounts the strip; a later new todo in that scope mounts collapsed.
- [ ] A later-page load failure retains the last successfully reconstructed strip; a first-page failure with no todo inputs renders none.
- [ ] Console `showToolCalls=false` removes todo rows but not the strip. No extra `showSystem` behavior is introduced.
- [ ] Todo rows remain the Story 1.1 one-line summaries and contain no checklist. Story 1.2 Raw/Input-Output baseline changes are preserved rather than overwritten.

### Visual, responsive, and accessible behavior

- [ ] The strip matches the contract above at the canonical measured 460 px room width on both surfaces: full bleed, `surface-elevated`, bottom rule, no radius, 6/10 header padding, 10 px tracked label, 11.5 px mono item text, final DESIGN line-height 1.85, and 4 px phase top margin.
- [ ] Header includes the representative item, a 3 px segmented meter with 2 px gaps, completed/total text, and a caret that rotates 180° only when open.
- [ ] Expanded body is capped at 168 px. The real 12-item E2E state has `scrollHeight > clientHeight` and scrolls internally without moving the transcript or strip.
- [ ] Current item has the required surface background plus inset running marker; completed, current, blocked, pending, and abandoned use `☑`, `◐`, `⊘`, `☐`, and `☐` + line-through/`· dropped` respectively. Blocked reason is visible.
- [ ] Header content remains one line with item elision; the room and page have no horizontal overflow at 460 px, 390×844, or 200% zoom.
- [ ] The button target is at least 24×24 px. Every text/glyph tone clears 4.5:1 on its actual background; the opaque `--accent-bright` focus outline clears 3:1. Console uses its +2 px focus offset and Legacy −2 px.
- [ ] Chromium accessibility-tree evidence proves one named Todo region, a named expanded/collapsed button, phase headings/lists, status words, decorative meter/glyph/caret exclusion where intended, and focus retention.
- [ ] Manual Windows/NVDA and macOS/VoiceOver checks are attempted and recorded. If the environment lacks either pairing, the report marks manual AT sign-off blocked instead of claiming a pass.

### Safety, performance, compatibility, and operations

- [ ] Todo/blocker text renders only as React text; no agent-authored value enters `id`, `aria-label`, `title`, HTML, or a CSS class.
- [ ] Fold work is deterministic and bounded by calls × current task count; no regex interprets user prose, no network/storage work, and no memoization is added at the current roughly-40-row design scale.
- [ ] No backend/API/schema/migration/generated/dependency change. The fake-provider scenario is strict-schema validated and registered only under the existing E2E env gate.
- [ ] Existing transcript selection, pagination, interruption folding, stick-to-bottom, Jump to latest, error/retry, and non-agent Legacy room behavior stay green.
- [ ] Rollout is the normal Web bundle with no flag or data backfill. Rollback is a focused revert; persisted messages remain readable because their wire shape is unchanged.

## Phases

| #   | Phase                                                                                  | Depends on | Deliverable                                                                                                          |
| --- | -------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------- |
| 1   | [Shared fold, history contract, fixture, and docs](./phase-01-start.md)                | None       | Pure fold + tests, `{ items, todos }`, deterministic E2E data, synchronized contracts, compiling red outside-in spec |
| 2   | [Two node-room renderers](./phase-02-two-surface-renderers.md)                         | Phase 1    | Legacy landmark correction, both collapsed strips, equivalent component evidence                                     |
| 3   | [End-to-end and visual verification](./phase-03-end-to-end-and-visual-verification.md) | Phases 1–2 | Real-run pin/overflow proof, responsive/a11y evidence, full gates, acceptance report                                 |

## Global file inventory

| Path                                                                                            | Action                                                                                |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `packages/web/src/lib/todo-state.ts`                                                            | Create shared fold, summary, semantic status metadata                                 |
| `packages/web/src/lib/todo-state.test.ts`                                                       | Create full provider/failure/summary table                                            |
| `packages/web/src/lib/agent-history.ts`                                                         | Return `{ items, todos }`                                                             |
| `packages/web/src/lib/agent-history.test.ts`                                                    | Adapt callers; prove unchanged items and folded state                                 |
| `packages/web/src/components/workflows/TodoStrip.tsx`                                           | Create Legacy renderer                                                                |
| `packages/web/src/components/workflows/NodeRoom.tsx`                                            | Add embedded-content/region mode needed by Legacy pane                                |
| `packages/web/src/components/workflows/NodeRoom.test.tsx`                                       | Verify strip semantics and embedded content contract                                  |
| `packages/web/src/components/workflows/NodeTranscriptPane.tsx`                                  | Own non-scrolling landmark; mount strip above scroller                                |
| `packages/web/src/components/workflows/NodeTranscriptPane.test.tsx`                             | Verify region, sibling order, paging/error/live state                                 |
| `packages/web/src/components/workflows/LegacyNodeRoom.test.tsx`                                 | Adapt history helper; integration regression                                          |
| `packages/web/src/experiments/console/components/ConsoleTodoStrip.tsx`                          | Create Console renderer                                                               |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx`                           | Mount strip above scroller; consume widened history                                   |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx`                      | Equivalent semantics/layout/toggle evidence                                           |
| `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.tsx`           | Consume `.items` only                                                                 |
| `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx`      | Regression: no Todo strip in inline log                                               |
| `packages/providers/src/e2e-fake/provider.ts`                                                   | Add strict `emitTodo` scenario and deterministic constants                            |
| `packages/providers/src/e2e-fake/provider.test.ts`                                              | Verify emitted sequence and composition with `emitTool`                               |
| `e2e/fixtures/workflows/e2e-todo-strip.yaml`                                                    | Create todo/no-todo workflow with long transcript/body                                |
| `e2e/lib/playwright/archon-runtime.ts`                                                          | Seed and run the dedicated workflow                                                   |
| `e2e/ui/agent-todo-strip.spec.ts`                                                               | Create behavior, geometry, responsive, AX, contrast evidence                          |
| `_bmad-output/specs/spec-agent-node-room/todo-fold-contract.md`                                 | Correct pinned rendering and read-only-view wording                                   |
| `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md` | Correct Flow 1 to open the strip, not a todo row                                      |
| `claude-design/design_handoff_node_room_transcript_steering/README.md`                          | Mark old bottom placement/prototype order superseded by canonical top placement       |
| `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml`                      | Workflow-owned `backlog` -> `done` transition after all gates; do not hand-edit early |
| `plans/260918-0826-issue-178-pinned-todo-strip/reports/visual-acceptance.md`                    | Create evidence and gate report during implementation                                 |
| `plans/260918-0826-issue-178-pinned-todo-strip/reports/evidence/*`                              | Create synthetic screenshots and contrast/geometry data                               |

## Implementation order and preflight

1. Recheck issue #178, PRs, active worktrees/runs, `git status`, and whether #175 landed. Rebase/adapt to the accepted baseline without reverting Story 1.2 changes. Stop if another active owner is editing this story.
2. Phase 1: correct the durable contracts, write fold/history tests, implement the pure state model, adapt all return-shape callers, and add the deterministic provider/workflow/E2E contract.
3. Phase 2: write red shell tests; correct Legacy ownership first; implement Legacy and Console strips; keep Console inline history strip-free.
4. Phase 3: run the dedicated workflow through both routes, collect measured visual/a11y evidence, execute repository gates, and open the PR from the template with `Closes #178`.

## Validation commands

Use package-isolated commands; never run root `bun test`.

```bash
(cd packages/web && bun test src/lib/todo-state.test.ts src/lib/agent-history.test.ts)
(cd packages/web && NODE_ENV=development bun test src/components/workflows/NodeRoom.test.tsx src/components/workflows/NodeTranscriptPane.test.tsx src/components/workflows/LegacyNodeRoom.test.tsx)
(cd packages/web && NODE_ENV=development bun test src/experiments/console/components/ConsoleNodeRoom.test.tsx src/experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx src/experiments/console/console-isolation.test.ts)
(cd packages/providers && bun test src/e2e-fake/provider.test.ts)
(cd e2e && npm run typecheck)
bun run --cwd e2e test:ui -- --grep 'todo strip'
bun run --cwd e2e test:ui:hitl
bun run validate
```

## Risks, compatibility, and rollback

- **Concurrent Story 1.2:** it edits `NodeRoom.tsx`, `ConsoleAgentHistoryList.tsx`, related tests, and the existing visual spec. This plan does not edit `ConsoleAgentHistoryList` or the existing visual spec; nevertheless, preflight and conflict-aware test adaptation are mandatory.
- **Legacy scroll regression:** changing the landmark boundary can affect scroll restoration and Jump to latest. Exact one-landmark/sibling tests plus existing scroll tests are required before visual work.
- **Provider drift:** OMP is not pinned by this repository. The canonical fold tests, not an ambient global install, become Archon's compatibility contract. If supported OMP behavior changes, update the contract and tests deliberately.
- **Large plans:** folding may scan the current task list per operation. That is appropriate at the documented scale; revisit only with measured low-hundreds live histories. UI height remains bounded independently.
- **Manual AT availability:** an unavailable OS pairing is an explicit acceptance blocker, not an excuse to fabricate evidence.
- **Rollback:** revert the focused PR. There is no stored-data migration, server contract, feature flag, or cleanup job.

## Definition of done

- [ ] Every acceptance criterion has automated evidence or an honestly recorded manual blocker.
- [ ] The focused Web/provider/E2E suites, the existing HITL suite, package type checks/lint, and `bun run validate` pass.
- [ ] The final diff stays within the inventory, except cause-aligned fixes discovered by tests and recorded in the report.
- [ ] `reports/visual-acceptance.md` distinguishes real fixture, component, AX, contrast, screenshot, and manual-AT evidence.
- [ ] Contract docs no longer direct readers to an inline/last-call checklist or a bottom-mounted strip.
- [ ] The owning BMad workflow moves `1-5-track-the-agents-current-todo-state-in-a-pinned-strip` to `done` only after the implementation and evidence gates pass.
- [ ] PR uses the repository template, targets `develop`, and includes `Closes #178`.
