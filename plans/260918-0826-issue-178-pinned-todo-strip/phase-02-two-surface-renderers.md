---
phase: 2
title: 'Two node-room renderers'
status: pending
priority: P1
effort: '4h'
dependencies: [1]
---

# Phase 2: Two node-room renderers

## Outcome

Render the shared todo state in the two actual node rooms with identical semantics and design anatomy. Correct Legacy's region/scroller ownership so the strip is both pinned and inside the room landmark. Keep Console inline execution history strip-free.

Phase 1's behavior E2E cases finish green here. Phase 3 owns measured visual/a11y evidence and broad gates.

## Re-scout before editing

Story 1.2 may have landed since Phase 1. Re-read the current:

- `NodeRoom.tsx` props, return boundary, and tool-body code;
- `NodeTranscriptPane.tsx` return block and scroll-follow effects;
- `ConsoleNodeRoom.tsx` history construction and return block;
- relevant mount helpers in `NodeRoom.test.tsx`, `NodeTranscriptPane.test.tsx`, `LegacyNodeRoom.test.tsx`, and `ConsoleNodeRoom.test.tsx`.

Preserve any accepted Raw implementation. This phase neither changes `ConsoleAgentHistoryList.tsx` nor specifies what a todo row shows when expanded, except that it must not show the checklist.

## Renderer interfaces

Create two thin components:

```tsx
// Legacy
export interface TodoStripProps {
  phases: readonly TodoPhase[];
}
export function TodoStrip({ phases }: TodoStripProps): React.ReactElement | null;

// Console file defines this identical narrow prop locally; it does not import Legacy.
export interface ConsoleTodoStripProps {
  phases: readonly TodoPhase[];
}
export function ConsoleTodoStrip({ phases }: ConsoleTodoStripProps): React.ReactElement | null;
```

Locations:

- `packages/web/src/components/workflows/TodoStrip.tsx`
- `packages/web/src/experiments/console/components/ConsoleTodoStrip.tsx`

Console imports shared types/functions from `@/lib/todo-state` and nothing from `@/components/`. Do not place the Console component under `inspect/`; it belongs to the selected node-room shell and has no inline-log caller.

Both components:

- return `null` when `phases` is empty;
- use `useState(false)` — collapsed on every fresh mount;
- use `useId()` for a body id that remains mounted with `hidden={!open}`;
- call `summarizeTodoState()` and use `TODO_STATUS_PRESENTATION` for glyph/label only;
- render identical element order, visible strings, accessibility semantics, meter cells, suffixes, and disclosure behavior;
- differ only in existing surface token classes (`in_progress` is Legacy `--accent-bright`, Console `--running`; focus offsets remain −2/+2).

Do not pass a `scopeKey` prop or reset state in an effect. Each shell conditionally mounts the component only for non-empty `todos`, with `key={resolvedScopeKey}`. Stable key means polling preserves state/focus; changed key gives React's normal clean reset without an intermediate stale frame. Conditional mounting ensures an all-removed state destroys disclosure state, so a later new list in the same scope starts collapsed.

## Markup and styling contract

### Container and header

- `<section aria-label="Todo">`, `flex-none`, full bleed, `surface-elevated`, 1 px **bottom** border, no radius.
- Full-width button, `type="button"`, `aria-expanded`, `aria-controls`, 6 px vertical / 10 px horizontal padding, at least 24 px tall, 8 px gaps, one line.
- `TODO`: 10 px, 700, uppercase, 0.07em tracking, text-secondary.
- Representative item group: fixed glyph column, visually hidden status phrase, one-line/elided 11.5 px mono content in text-primary, `min-width: 0`.
- Meter: one 3 px-high flex cell per item with 2 px gaps; completed success, in-progress running, blocked warning, pending/abandoned border-bright; entire meter `aria-hidden="true"`.
- Count: completed/total, 10 px mono text-secondary, no wrap.
- Caret: decorative `▾`, 9 px tertiary, rotates 180° while open over 120 ms; `motion-reduce:transition-none`.
- Hover uses surface-hover. Focus-visible is 2 px opaque accent-bright; Legacy offset −2 px, Console +2 px.

### Expanded body

- The body stays in the DOM, is `hidden` while collapsed, and uses `padding: 4px 10px 8px`, top border, `max-height: 168px`, and `overflow-y: auto`.
- Phase headings: semantic `h3`, 10 px, uppercase, 0.07em, text-secondary, 4 px top margin (the final DESIGN value overrides the prototype's 8 px).
- Each phase owns a list. Item rows are 11.5 px mono, line-height 1.85, flex baseline, 8 px gap, 1/4/1/2 px padding, 4 px radius.
- Status glyph and accessible phrase come from the shared map. Render task/blocker strings only as text nodes.
- Abandoned content is line-through with visible `· dropped`; blocked carries visible `· blocked: <reason>` when present. Hide the visible suffix from AT when the equivalent complete status phrase is supplied visually-hidden, avoiding repeated status text.
- The first in-progress item is the current row. Give it `surface` background, text-primary, and a 2 px inset marker using the surface's running token. Do not style blocked/last-completed header fallbacks as current body rows.

Use a small stable locator only where semantic selectors cannot express the test: `data-testid="todo-meter"` and `data-testid="todo-list"` are sufficient. Do not encode task text/status into ids or aria labels.

## Correct Legacy ownership

The current hierarchy is `NodeTranscriptPane scroller > NodeRoom > RoomRegion`. The required hierarchy is `RoomRegion > strip + scroller > NodeRoom content`.

Make the smallest explicit API change in `NodeRoom.tsx`:

1. Add optional `embedded?: boolean` to `NodeRoomProps`, default `false`.
2. After computing its existing `body`, return the body in a fragment when embedded; otherwise preserve today's `<RoomRegion nodeId>{body}</RoomRegion>` behavior. `nodeId === null` keeps returning the existing placeholder with no landmark.
3. Add optional `scrollable?: boolean` to exported `RoomRegion`, default `true`. Existing room kinds keep `overflow-y-auto`; the transcript pane passes `false`, which uses `overflow-hidden` because its child owns scrolling.

In `NodeTranscriptPane.tsx`:

1. Retain `{ items, todos }` from Phase 1.
2. Build the existing scroller/Jump content once. When `todos.length > 0`, put `<TodoStrip key={resolvedScopeKey} phases={todos} />` immediately before `node-transcript-scroll`; otherwise mount nothing.
3. Render `<NodeRoom embedded ...>` inside the scroller. Make the scroller a flex column as well as the overflow owner so loading, empty, and error placeholders retain the centering/fill behavior they previously received from `RoomRegion`.
4. For a selected row, wrap strip + scroller + Jump in `<RoomRegion nodeId={row.nodeId} scrollable={false}>`.
5. For `row === null`, preserve the current no-landmark Select-a-node behavior in the plain flex wrapper.

Do not change scroll-follow calculations or move the Jump button into the transcript scroller. The strip changes available scroller height; the existing follow effect must continue to use that scroller's own metrics.

## Mount Console

In `ConsoleNodeRoom.tsx`:

1. Retain `{ items, todos }` from Phase 1 for agent history; other node kinds keep `todos: []`/no strip.
2. Inside the existing agent node's `RoomRegion`, conditionally mount `<ConsoleTodoStrip key={resolvedScopeKey} phases={todos} />` immediately before `console-node-room-scroll` only when `todos.length > 0`.
3. Leave `ConsoleAgentHistoryList` and its `showToolCalls`/`showSystem` filtering unchanged. Because the strip is outside the list, Tool calls off cannot hide it.
4. Leave `ConsoleExecutionHistory` at `.items` only; no `position` prop or static strip variant exists.

## Tests first: shared Legacy semantics

Extend `NodeRoom.test.tsx` with direct `TodoStrip` coverage so read-spine AD-12 has a Legacy renderer assertion independent of paging:

- `[]` returns no Todo section;
- non-empty state renders section/button/meter/body relationship and starts collapsed;
- header is current item + `1/12`, meter has 12 decorative cells, body remains hidden;
- click opens/closes; `aria-expanded`, `aria-controls`, and `hidden` agree; focus stays on button;
- both phase headings/lists and all five glyph/label/suffix treatments render;
- current row contains background/inset-marker classes; abandoned is struck through; blocked reason is text;
- status phrases exist once in accessible markup and agent strings are absent from id/aria-label/title;
- 40 arbitrary items do not change the required max-height/overflow classes;
- `NodeRoom embedded` has no region while default mode retains exactly one.

Prefer semantic DOM assertions. Class assertions are appropriate only for the contract tokens/geometry that happy-dom cannot measure; Phase 3 verifies computed styles in a browser.

## Tests first: Legacy integration

Extend `NodeTranscriptPane.test.tsx`:

- todo fixture -> exactly one `<review room>` region, with strip as its first child and immediate previous sibling of `node-transcript-scroll`; the scroller contains no nested region;
- no-todo and row-null states -> no strip; row-null still has no room landmark;
- two page responses with init on one page and later mutation on another -> final summary/state uses ordered merged rows;
- open the strip, append a polled todo call under the same scope -> same section/button node identity, remains open/focused, count/state update;
- remove every todo -> strip/component unmounts; add a fresh list under the same scope -> newly mounted strip is collapsed;
- change `scopeKey`/selected row -> a newly mounted collapsed strip;
- later-page error after todo rows -> strip remains with last good state and incomplete notice appears; first-page error -> no strip;
- loading, empty, and first-page error placeholders retain their existing fill/centering after the scroller becomes the embedded content's flex parent;
- existing completed/running scroll restoration and Jump tests stay unchanged and green.

Extend `LegacyNodeRoom.test.tsx` only for integration regressions needed after the embedded/region refactor: selected agent has one room landmark; no selection has none; stdout/gate/child/route/loop rooms retain one and their prior scroll classes.

Run the Legacy group red, implement, then green:

```bash
cd packages/web
NODE_ENV=development bun test src/components/workflows/NodeRoom.test.tsx src/components/workflows/NodeTranscriptPane.test.tsx src/components/workflows/LegacyNodeRoom.test.tsx
```

## Tests first: Console equivalence

Extend `ConsoleNodeRoom.test.tsx` with the same fixture and assertions:

- present/absent, collapsed header, meter/count, toggle/state/focus, phase/item/status anatomy;
- strip is inside the one node-room region and immediately precedes `console-node-room-scroll`;
- polling under the same scope preserves identity/open/focus and updates state; scope change resets collapsed;
- later load failure retains last good state; first-page failure has none;
- `showToolCalls=false` leaves the strip while every tool row is gone;
- no special `showSystem` assertion — the strip never enters that filter;
- no checklist text exists under any tool row;
- `ConsoleExecutionHistory.test.tsx` regression from Phase 1 remains at zero Todo strips.

Implement `ConsoleTodoStrip.tsx`, mount it, then run:

```bash
cd packages/web
NODE_ENV=development bun test src/experiments/console/components/ConsoleNodeRoom.test.tsx src/experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx src/experiments/console/console-isolation.test.ts
```

## Phase sweep

Run package-level Web tests/type/lint and the outside-in behavior spec:

```bash
(cd packages/web && bun run test && bun run type-check)
bun run lint --max-warnings 0
bun run --cwd e2e test:ui -- --grep 'todo strip'
```

The E2E cases from Phase 1 must now pass. If geometry/contrast additions from Phase 3 are not yet present, do not claim visual acceptance.

## Files

- Create: `packages/web/src/components/workflows/TodoStrip.tsx`
- Modify: `packages/web/src/components/workflows/NodeRoom.tsx`
- Modify: `packages/web/src/components/workflows/NodeRoom.test.tsx`
- Modify: `packages/web/src/components/workflows/NodeTranscriptPane.tsx`
- Modify: `packages/web/src/components/workflows/NodeTranscriptPane.test.tsx`
- Modify: `packages/web/src/components/workflows/LegacyNodeRoom.test.tsx`
- Create: `packages/web/src/experiments/console/components/ConsoleTodoStrip.tsx`
- Modify: `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx`
- Modify: `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx`
- Verify: `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.tsx`
- Verify: `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx`
- Verify: `packages/web/src/experiments/console/console-isolation.test.ts`

## Exit criteria

- [ ] Both node rooms render equivalent, collapsed-by-default strips from the same folded state.
- [ ] Legacy has one landmark containing the strip and scroller; other room kinds retain existing behavior.
- [ ] Both strips are scroller siblings, not sticky descendants or overlays.
- [ ] State survives same-scope polling/focus and resets on scope change; error cases preserve only reconstructed state.
- [ ] Tool calls off affects rows only; inline Console history has no strip.
- [ ] No inline checklist or Story 1.2 regression.
- [ ] Focused and package Web tests/type/lint plus behavior E2E are green.

## Risks and safeguards

- **Nested scrolling:** only `todo-list` and the transcript scroll. The outer Legacy region is overflow-hidden in transcript mode; other rooms keep their current scrollable default.
- **Landmark drift:** tests assert exactly one named region, not merely strip/scroller sibling order.
- **Polling reset:** key only by existing resolved scope. Never key by todo count/content.
- **Console isolation:** no import from `@/components/`; run the isolation test immediately after creating the Console file.
- **Concurrent Raw work:** resolve overlaps inside current row tests; never delete newly accepted Raw assertions to make this story green.
