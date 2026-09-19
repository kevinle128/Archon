---
phase: 2
title: 'Grouped renderers and approved navigator'
status: pending
priority: P1
effort: 'Two renderers plus navigator row; contract fixed by recorded B2/B4'
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
- For multiple groups: render `prefixItems` first with no heading; then one `h3` heading per group and the group's current item rendering. Keep `renderAfterItem`, partial-load notice, retry, and `renderAtEnd` in their current logical positions.

### Console

- Extract one small pure predicate for whether an item row is visible under `showToolCalls` / `showSystem`; use it in the list, room, and inline execution history.
- A group stays displayable if it has a visible item **or** a hidden tool item with an attached Ask card that still renders.
- Derive headings and navigator options from the same displayable group list.
- `ConsoleAgentHistoryList` keeps current flat/error/empty behavior when fewer than two displayable groups remain.
- `ConsoleExecutionHistory` gets headings only; its unanchored Ask/approval extras remain after history and create no synthetic occurrence.

### Both shells

- Shells render the core label verbatim and never derive retry/iteration/failure.
- Headings are `h3` with the exact DESIGN styling: 10.5px mono uppercase, `0.08em`, `text-secondary`, `10px 0 5px`, flex label plus 1px `border` rule to the right edge.
- Keep header JSX local to each shell unless the refreshed code reveals an established same-shell boundary. Console must not import Legacy components.
- Stable React keys and navigator targets use `occurrence_id`, not array index. Each heading's DOM id is namespaced with React `useId` plus the group's `occurrence_id`; the label remains plain text escaped by React.

## Tests first — paired heading behavior

Use the same test names/assertion intent in `NodeRoom.test.tsx` and `ConsoleNodeRoom.test.tsx`:

- zero/one occurrence → zero occurrence headings and no navigator;
- two occurrences → two `h3` headings, in group order with exact core labels;
- two groups whose retry/ancestry base label collides → distinct B4-qualified headings and navigator names (`Run 1 #1`/`Run 1 #2`, `Iteration 1 › Iteration 3`/`Iteration 2 › Iteration 3`, residual `· occurrence K`);
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

## Implement the approved navigator (B2 recorded 2026-09-19)

The adopted contract lives in `EXPERIENCE.md` (Information Architecture; Component Patterns → Occurrence navigator; State Patterns → Navigator rows; Interaction Primitives; Accessibility Floor) and `DESIGN.md` Components → Occurrence navigator (delta 5). Implementation:

- mount one control row at the bottom edge of the room region, after the transcript scroller — inside `NodeTranscriptPane.tsx` and `ConsoleNodeRoom.tsx`, the same sibling position `Jump to latest` occupies; `Jump to` at the left, `Jump to latest` at the right edge. `NodeRoomHeader.tsx` and `ConsoleRoomHeader.tsx` are untouched: B2 adopted a second, separate control, so the `Execution` select stays a pure filter and the conditional re-scout branch below is closed;
- a native `<select>` with a real associated `<label>` reading `Jump to`; the first option is the disabled placeholder `{N} occurrences` with the real count; the remaining options are the rendered headings' labels verbatim in group order, valued by `occurrence_id` — on Console, from the same displayable-group list the headings use;
- occurrence headings render as `h3`, programmatically focusable (`tabindex="-1"`), DOM id namespaced with `useId` + the group's `occurrence_id`;
- commit on `change` only, with no custom key handlers: if the target heading is not fully visible, scroll it to the top of the transcript viewport; then move DOM focus to it;
- navigation is an explicit `jumpToOccurrence` transition in `room-scroll-follow.ts` yielding the manual-hold state (`follow:false, pinToBottom:false`) — not an `ignoreNextScroll` event-suppression flag; `Jump to latest` re-pins unchanged;
- the select is an action, not a position indicator: it shows the last committed navigation and resets to the placeholder when its target leaves the displayed set; below two displayable groups the whole control is absent, never disabled;
- if the focused heading unmounts, focus moves to the select while it renders, else to the transcript scroller — never `<body>`;
- no live-region announcement on navigation; the moved focus delivers the heading's name;
- paired Legacy/Console tests with identical outcomes.

## Scroll/follow cases required (contract fixed by B2)

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
- [ ] The B2-recorded navigation contract passes equivalent Legacy/Console interaction tests.
- [ ] Existing `Execution` filtering and request scope remain unchanged — B1 adopted compatibility-only, so no aggregate model exists to test.
- [ ] No Console isolation violation, new token, one-use component proliferation, or row-anatomy rewrite.

## Rollback

Revert the renderer/navigation commit. The Phase 1 internal execution field and grouper can also be reverted independently; no persistence cleanup.
