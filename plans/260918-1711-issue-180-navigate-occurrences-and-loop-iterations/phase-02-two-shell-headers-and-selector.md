---
phase: 2
title: 'Grouped renderers and approved navigator'
status: blocked
priority: P1
effort: 'Estimate after B2/B4 fix interaction and labels'
dependencies: [1]
---

# Phase 2: grouped renderers and approved navigator

## Goal

Render the Phase 1 grouping contract on all three history consumers, then implement the B2-approved navigator identically in the two node rooms without changing row anatomy, existing Execution filtering, Ask ownership, or Console isolation.

## Mandatory re-scout

Before editing, re-read the post-PR-#202 versions of:

- `NodeRoom.tsx`, `NodeTranscriptPane.tsx`, and their tests;
- `ConsoleAgentHistoryList.tsx`, `ConsoleNodeRoom.tsx`, `ConsoleExecutionHistory.tsx`, and their tests;
- todo-strip placement, Ask insertion callbacks, error/empty/partial branches, and scroll-follow reducer/tests;
- the approved B2 artifact and Phase 1 grouping types.

If the merged structures differ, update the plan inventory before code. Preserve unrelated behavior rather than transplanting old line-level steps.

## Renderer contract

### Legacy

- `NodeTranscriptPane` computes the grouping from `items`.
- `NodeRoom` keeps its current flat path for `showHeaders=false`.
- For multiple groups: render `prefixItems` first with no heading; then one semantic heading at the B2-approved level and the group's current item rendering. Keep `renderAfterItem`, partial-load notice, retry, and `renderAtEnd` in their current logical positions.

### Console

- Extract one small pure predicate for whether an item row is visible under `showToolCalls` / `showSystem`; use it in the list, room, and inline execution history.
- A group stays displayable if it has a visible item **or** a hidden tool item with an attached Ask card that still renders.
- Derive headings and navigator options from the same displayable group list.
- `ConsoleAgentHistoryList` keeps current flat/error/empty behavior when fewer than two displayable groups remain.
- `ConsoleExecutionHistory` gets headings only; its unanchored Ask/approval extras remain after history and create no synthetic occurrence.

### Both shells

- Shells render the core label verbatim and never derive retry/iteration/failure.
- Use the B2-approved heading level and the exact DESIGN styling: 10.5px mono uppercase, `0.08em`, `text-secondary`, `10px 0 5px`, flex label plus 1px `border` rule to the right edge.
- Keep header JSX local to each shell unless the refreshed code reveals an established same-shell boundary. Console must not import Legacy components.
- Stable React keys and navigator targets use `occurrence_id`, not array index. A DOM id, if B2 needs one, is namespaced with React `useId`; the label remains plain text escaped by React.

## Tests first — paired heading behavior

Use the same test names/assertion intent in `NodeRoom.test.tsx` and `ConsoleNodeRoom.test.tsx`:

- zero/one occurrence → zero occurrence headings and no navigator;
- two occurrences → two semantic headings at the approved level, in group order with exact core labels;
- two groups whose retry/ancestry base label collides → distinct B4-approved headings and navigator names;
- attempts inside one occurrence → no extra heading;
- leading unscoped prefix renders before the first heading and exactly once;
- non-contiguous occurrence rows render under one unique heading and exactly once;
- assistant/tool/lifecycle ordering inside each group is stable;
- `renderAfterItem` remains attached to its item and `renderAtEnd` remains after all groups;
- partial-page error/retry and unknown-scope warning remain visible;
- label text from assistant/tool content cannot alter headings.

Additional Console cases:

- hiding system/tool rows removes a group only when no row or attached Ask remains renderable;
- an Ask attached to a hidden tool keeps the group and Ask visible without rendering the tool row;
- dropping from two displayable groups to one removes all occurrence headings and navigator options;
- `ConsoleExecutionHistory` follows the same visibility rule and never renders the node-room navigator.

Keep `LegacyNodeRoom.test.tsx` compiling for its direct `NodeRoom` mounting pattern; update it only for the actual post-merge public props.

## Implement headings

1. Add the smallest grouped-render input that lets each renderer reuse its existing per-item branch.
2. Do not make new props optional merely to avoid adapting real call sites; use a deliberate flat/grouped contract and update all verified callers/tests.
3. Preserve current empty/loading/error behavior based on original `items` and extras.
4. Run heading/filter tests before navigation changes.

## Implement only the approved navigator

Replace this section with the exact B2 contract before code. At minimum the implementation must:

- mount in the approved location and use approved copy/control type;
- derive options only from rendered occurrence headings;
- target headings by stable occurrence key;
- define a reducer/state transition for interaction with live follow and restored scroll rather than suppressing guessed DOM events;
- keep “Jump to latest” and the existing Execution filter independent;
- reset or reconcile state when scope/filter/poll removes a target, exactly as B2 specifies;
- implement pointer, keyboard, focus-visible, and announcement behavior without browser-specific native-select key heuristics;
- have paired Legacy/Console tests with identical outcomes.

If B2 changes the existing `Execution` control instead of adding a second control, re-scout and update `NodeRoomHeader.tsx`, `ConsoleRoomHeader.tsx`, their options model, E2E contracts, and the file inventory before editing.

## Scroll/follow cases required after B2

Translate the approved behavior into reducer and shell tests:

- navigation while a live transcript is pinned;
- a new row arriving after navigation;
- reader-initiated scroll after navigation;
- “Jump to latest” restoring follow;
- saved `scrollTop` across room close/reopen;
- already-visible/clamped target;
- target removed by scope or Console filters;
- focus behavior on pointer and every supported keyboard path.

Only change `room-scroll-follow.ts` if the approved behavior requires a new explicit transition; do not use an `ignoreNextScroll` timing flag as the contract.

## Focused validation

```bash
(cd packages/web && NODE_ENV=development bun test src/components/workflows/NodeRoom.test.tsx src/components/workflows/NodeTranscriptPane.test.tsx src/components/workflows/LegacyNodeRoom.test.tsx)
(cd packages/web && NODE_ENV=development bun test src/experiments/console/components/ConsoleNodeRoom.test.tsx src/experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx src/experiments/console/console-isolation.test.ts)
(cd packages/web && bun run type-check)
bun run lint --max-warnings 0
```

## Exit criteria

- [ ] All three consumers render correct headings and preserve flat behavior.
- [ ] Console filters and attached Asks cannot create empty/orphaned groups.
- [ ] B2-approved navigation passes equivalent Legacy/Console interaction tests.
- [ ] Existing Execution filtering and request scope remain unchanged unless B1 explicitly authorizes and tests a new aggregate model.
- [ ] No Console isolation violation, new token, one-use component proliferation, or row-anatomy rewrite.

## Rollback

Revert the renderer/navigation commit. The Phase 1 internal execution field and grouper can also be reverted independently; no persistence cleanup.
