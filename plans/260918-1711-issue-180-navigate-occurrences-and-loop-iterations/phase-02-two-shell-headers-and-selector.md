---
phase: 2
title: 'Two-shell headers and selector'
status: pending
priority: P1
effort: '5h'
dependencies: [1]
---

# Phase 2: Two-shell headers and selector

## Goal

Render the core-supplied occurrence groups as section headings in both node rooms and mount the pinned `Occurrence` selector that navigates to them, with identical semantics, keyboard behaviour, and focus handling on Legacy and Console, asserted by paired tests. `ConsoleExecutionHistory` gains headings only.

Deep mode: this phase is outlined. Run the scout pass below before editing; it re-anchors every insertion point against whatever Stories 1.3, 1.4, and 1.6 have merged by then.

## Context links

- Plan decisions 4, 6, 8, 9, 10 in [plan.md](./plan.md).
- Spine AD-12 (seven shell-owned behaviours; #7 is this selector) and the todo strip's mounts from Story 1.5 as the pattern: `NodeTranscriptPane.tsx` (`RoomRegion` → `TodoStrip` → `node-transcript-scroll` → `NodeRoom embedded`) and `ConsoleNodeRoom.tsx` (`RoomRegion` → `ConsoleTodoStrip` → `console-node-room-scroll` → body).
- `DESIGN.md` `components.occurrence-header` and the header CSS in `mockups/key-transcript-states.html` line 80 (`.occ`) / `key-legacy-node-room.html` line 108.
- `EXPERIENCE.md` line 125: the header carries a heading role; it is not interactive.

## Scout pass (mandatory before editing)

0. Re-read `LegacyNodeRoom.test.tsx` `mountItems()` and `ConsoleInspectPane.tsx` `executionOptionsForNode` — both consume interfaces this story touches and neither is a room component.
1. Re-read `NodeRoom.tsx` `NodeRoom()` body (the `items.map` block after the unknown-scope notice) and `ConsoleAgentHistoryList.tsx` `ConsoleAgentHistoryList()` (the `items.map` with the `showToolCalls` / `showSystem` early returns). Record the current props and the exact element each item kind returns; Stories 1.3/1.4 may have changed `ToolHistory`.
2. Re-read `NodeTranscriptPane.tsx` from `const allMessages = pageState.rows;` to the final `return`, and `ConsoleNodeRoom.tsx` from `const allMessages = pageState.rows;` to its final `return`. Note the todo strip mount, the scroller ref, the `follow` state, and the pin-to-bottom effect.
3. Re-read `ConsoleExecutionHistory.tsx` around the `ConsoleAgentHistoryList` call.
4. Confirm `NodeRoom.test.tsx` and `ConsoleNodeRoom.test.tsx` still render through `createRoot` + `act` under happy-dom and how the existing scroll tests stub `scrollHeight` / `clientHeight` (`NodeTranscriptPane.test.tsx` around `Object.defineProperty`).
5. Confirm `console-isolation.test.ts` still forbids `@/components/` imports from Console.

## Renderer interfaces

Legacy (`components/workflows/`):

```ts
// OccurrenceHeader.tsx
export function OccurrenceHeader(props: { id: string; label: string }): React.ReactElement
// <h3 id tabIndex={-1} className="my-[10px] mb-[5px] flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-text-secondary focus-visible:outline-2 focus-visible:outline-accent-bright">
//   {label}<span aria-hidden="true" className="h-px flex-1 bg-border" />
// </h3>

// OccurrenceSelector.tsx
export function OccurrenceSelector(props: {
  options: readonly { key: string; label: string }[];
  value: string | null;                 // navigated key, null = placeholder
  onNavigate: (key: string) => void;
}): React.ReactElement
// <div className="flex-none border-b border-border bg-surface-elevated px-3 py-1.5">
//   <select aria-label="Occurrence" className="min-h-[24px] rounded border border-border bg-surface px-2 py-0.5 text-xs text-text-primary" value={value ?? ''} onChange=…>
//     <option value="">Go to…</option>{options…}
//   </select>
// </div>
```

Console (`experiments/console/components/`): `ConsoleOccurrenceHeader.tsx` and `ConsoleOccurrenceSelector.tsx` with the same props and the Console token names (`text-text-secondary`, `border-border`, `bg-surface-elevated`, its `+2px` focus offset as the todo strip uses). Neither imports from `@/components/`.

`NodeRoom` and `ConsoleAgentHistoryList` gain:

```ts
groups?: readonly OccurrenceGroup[];   // from groupByOccurrence(items).groups
headers?: boolean;                     // grouping.headers, after the shell's visibility rule
headingIdFor?: (key: string) => string;
```

All three are optional so `LegacyNodeRoom.test.tsx`'s `mountItems()` (which renders `NodeRoom` directly with today's props) keeps compiling; when any is absent the list renders the flat `items` exactly as today. They keep `items` for the empty/pending/error branches and iterate `groups` for the body: when `headers` and all three props are present, emit `<OccurrenceHeader id={headingIdFor(group.key)} label={group.label} />` before each group's items.

`ConsoleAgentHistoryList.tsx` also exports `isTranscriptItemVisible(item: AgentHistoryItem, flags: { showToolCalls: boolean; showSystem: boolean }): boolean`, replacing the two inline `if` checks in its render loop, so `ConsoleNodeRoom` computes `visibleGroups` with the identical predicate instead of a second copy.

## Shell behaviour (both rooms, identical)

1. `const grouping = groupByOccurrence(items);`
2. Console only: `visibleGroups = grouping.groups.map(g => ({ ...g, items: g.items.filter(item => isTranscriptItemVisible(item, { showToolCalls, showSystem })) })).filter(g => g.items.length > 0)`; Legacy uses `grouping.groups` unchanged. `headers = visibleGroups.length >= 2 && grouping.headers`.
3. `const headingBase = useId();` `headingIdFor = key => \`${headingBase}-occ-${key}\`` — `key` is a UUID (validated by `executionFrom`), so the id is stable across polls that reorder or extend groups.
4. `const [navigatedKey, setNavigatedKey] = useState<string | null>(null);` reset via `key={resolvedScopeKey}` on the selector (scope change → placeholder), same trick as the todo strip. The select's `value` is `navigatedKey` only when an option with that key exists; otherwise `''` (Console filter toggles can remove the navigated group).
5. `onNavigate(key, origin: 'browse' | 'commit')`: `const heading = document.getElementById(headingIdFor(key))`; `const el = scrollRef.current`; if both exist: `ignoreNextScrollRef.current = true; el.scrollTop = heading.offsetTop - el.offsetTop; setFollow(holdScrollAt(follow, el.scrollTop)); onScrollTopChange?.(el.scrollTop); setNavigatedKey(key); if (origin === 'commit') heading.focus({ preventScroll: true });`. The selector derives `origin` from its own `keydown` listener: ArrowUp/ArrowDown/Home/End/PageUp/PageDown set a `browse` flag consumed by the next `change`; every other change (pointer, Enter, Space) is `commit`. `handleScroll` starts with `if (ignoreNextScrollRef.current) { ignoreNextScrollRef.current = false; onScrollTopChange?.(target.scrollTop); return; }` so the programmatic write cannot re-derive `follow` through `onRoomScroll`. If the assignment was a no-op (`el.scrollTop` unchanged afterwards, e.g. already at the heading or clamped at the end) no `scroll` event will fire, so clear the flag immediately in that branch — otherwise it would swallow the reader's next real scroll.
5b. Each shell passes `pendingInteractions` to the list; a heading whose `group.key` matches a `pending` Ask's `execution_scope.occurrence_id` renders `· awaiting input` after the label plus an `sr-only` "awaiting input" phrase.
6. Mount order inside `RoomRegion`: todo strip (when todos) → selector (when `headers`) → scroller → Jump to latest.

`ConsoleExecutionHistory`: compute `visibleGroups` with `isTranscriptItemVisible` exactly as the room does, pass `groups`, `headers`, `headingIdFor` to the list; no selector, no navigation state.

## Tests before (regression, written first)

- `NodeRoom.test.tsx` and `ConsoleNodeRoom.test.tsx`: pin that a single-occurrence transcript renders zero `h3` elements and no element with `aria-label="Occurrence"` (green today, guards the "absent" half of the AC once headers exist).
- `NodeTranscriptPane.test.tsx` / `ConsoleNodeRoom.test.tsx`: pin the current child order inside the room region (todo strip when present, then the scroller) so the selector insertion is an explicit, asserted change.
- `ConsoleExecutionHistory.test.tsx`: pin that it never renders an `Occurrence` combobox.

Regression gate: `(cd packages/web && NODE_ENV=development bun test src/components/workflows/NodeRoom.test.tsx src/components/workflows/NodeTranscriptPane.test.tsx src/components/workflows/LegacyNodeRoom.test.tsx src/experiments/console/components/ConsoleNodeRoom.test.tsx src/experiments/console/components/ConsoleInspectPane.test.tsx src/experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx)` green.

## Refactor (protected changes)

1. Thread `groups` / `headers` / `headingIdFor` through `NodeRoom` and `ConsoleAgentHistoryList` with the flat path unchanged when `headers` is false (existing tests stay green without edits).
2. Replace each room's `items` derivation with `grouping` + (Console) `visibleGroups`.
3. Insert the selector mount between the todo strip and the scroller in both rooms.

## Tests after (paired; the same assertion text in both suites)

- two occurrences → two `h3` headings in group order with the exact labels; one occurrence → none
- the `Occurrence` combobox exists only when headings render, is the immediate preceding sibling of the scroller, and follows the todo strip when both exist
- its first option is `Go to…` with value `''` and is selected initially; the remaining options equal the heading labels in order
- pointer change to a key: `document.activeElement` is the matching `h3`; `scroller.scrollTop` equals the stubbed `offsetTop` difference; the select shows that key
- keyboard browse: focus the select, `keydown ArrowDown` + `change` three times → `scrollTop` moves to each successive heading while `document.activeElement` stays the select; then `keydown Enter` + `change` → focus lands on the current heading. Same sequence asserted on both surfaces
- live-node hold: with a `running` row and `follow.pinToBottom` true, navigate, then re-render with one more row; `scrollTop` stays at the heading, not at `scrollHeight - clientHeight`
- programmatic scroll event: stub `scrollHeight`/`clientHeight` so the target heading is within 24 px of the bottom, navigate, dispatch a real `new Event('scroll')` on the scroller, then re-render with one more row; `scrollTop` still stays at the heading (the ignore flag consumed the event) — and a second, user-originated scroll event afterwards does re-derive `follow` normally
- no-op navigation: navigate to a heading whose target equals the current `scrollTop`, then dispatch a user scroll event → `follow` re-derives normally (the ignore flag was cleared, not left armed)
- pending Ask flag: a `pending` interaction whose `execution_scope.occurrence_id` equals a group key renders `· awaiting input` on that heading and nowhere else; an `answered` one renders nothing
- Console only: `showSystem=false` on a transcript whose outer group holds only lifecycle rows → that heading and its option disappear; with one visible group left, no headings and no combobox; `showToolCalls=false` behaves the same for a tool-only group; navigating to a group and then filtering it away shows the `Go to…` placeholder, never a blank or wrong value
- a poll that appends a new occurrence after navigation leaves the previously focused heading's id unchanged (heading ids are keyed, not indexed)
- headings and options contain no agent-authored text: a fixture whose assistant text is `Iteration 99` renders exactly the core labels
- `ConsoleExecutionHistory` with a two-occurrence slice renders headings and no combobox; with `showSystem=false` and an outer group holding only lifecycle rows, that heading is absent
- `console-isolation.test.ts` stays green

## Files

| Path                                                                                   | Action |
| -------------------------------------------------------------------------------------- | ------ |
| `packages/web/src/components/workflows/OccurrenceHeader.tsx`                           | create |
| `packages/web/src/components/workflows/OccurrenceSelector.tsx`                         | create |
| `packages/web/src/components/workflows/NodeRoom.tsx`                                   | modify |
| `packages/web/src/components/workflows/NodeTranscriptPane.tsx`                         | modify |
| `packages/web/src/components/workflows/NodeRoom.test.tsx`                              | modify |
| `packages/web/src/components/workflows/NodeTranscriptPane.test.tsx`                    | modify |
| `packages/web/src/components/workflows/LegacyNodeRoom.test.tsx`                        | modify (one grouped-render case; `mountItems()` unchanged) |
| `packages/web/src/experiments/console/components/ConsoleOccurrenceHeader.tsx`          | create |
| `packages/web/src/experiments/console/components/ConsoleOccurrenceSelector.tsx`        | create |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx`                  | modify |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx`             | modify |
| `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx`  | modify |
| `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.tsx`  | modify |
| `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx` | modify |

## Todo

- [ ] Scout pass recorded in `reports/acceptance.md`
- [ ] Tests-before green
- [ ] Legacy header + selector + mounts, tests green
- [ ] Console header + selector + visibility rule + mounts, tests green
- [ ] `ConsoleExecutionHistory` headings only
- [ ] Paired assertions present in both suites with matching names
- [ ] `bun run type-check`, `bun run lint`, `console-isolation.test.ts` green

## Success criteria

Every Tests-after case passes on both surfaces with the same assertion wording; the regression gate stays green; no Console file imports from `@/components/`; the E2E spec from Phase 1 now fails only on geometry (if at all), not on missing headings.

## Risk assessment

- **`offsetTop` under happy-dom is 0**: stub it with `Object.defineProperty(heading, 'offsetTop', { value: 240 })` before dispatching the change; the real geometry claim is Phase 3's.
- **`keydown` ordering**: on native selects the `keydown` precedes the `change` for the same arrow press in Chromium and Firefox; the browse flag is set in `keydown` and cleared in `change`, so a pointer change that follows a keyboard browse cannot inherit a stale flag. Assert the clear in the pointer test.
- **Focus outline on a heading**: `tabIndex={-1}` plus `focus-visible` styling; verify the ring is visible in Phase 3 evidence, since programmatic focus after a keyboard change shows `:focus-visible` in Chromium.
- **Concurrent renderer edits** from other epic stories: keep the header insertion as a wrapper around each group, not a rewrite of row markup.

## Security considerations

Same as Phase 1: DOM ids from `useId()`, option values are UUIDs, labels are core-composed.

## Dependency map

Depends on Phase 1's `groupByOccurrence`, `holdScrollAt`, and the loop-parent fetch scope. Feeds Phase 3's E2E and evidence.
