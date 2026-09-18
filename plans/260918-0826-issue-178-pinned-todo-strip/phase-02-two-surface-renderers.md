---
phase: 2
title: 'Phase 2: Legacy and Console renderers'
status: pending
priority: P1
effort: '5h'
dependencies: [1]
---

# Phase 2: Legacy and Console renderers

## Overview

Render the folded `todos` as a pinned strip on both shells with identical anatomy and surface-specific tokens: a Legacy `TodoStrip` mounted by `NodeTranscriptPane` above its scroller, and a Console `ConsoleTodoStrip` mounted by `ConsoleNodeRoom` above its scroller and by `ConsoleExecutionHistory` at the top of the log section. Component tests go red first on all three mounts, then the two strips make them green. Row markup from Story 1.1 does not change: every todo call already reads `todo updated` with an `op:` badge.

**Scout first (deep mode).** Before editing, re-read `NodeTranscriptPane.tsx` (the `return` block near `:365-395`), `ConsoleNodeRoom.tsx` (the `return` block near `:866-890`), `ConsoleExecutionHistory.tsx` (the `history`/`body` block near `:297-340`), and the three test files' mount helpers. If Story 1.2 (#175) has landed, its row-body rewrite moved lines in `NodeRoom.tsx`/`ConsoleAgentHistoryList.tsx`; this phase does not edit those files, but their tests' fixtures may have changed shape.

## Requirements

- Functional: strip present when `todos.length > 0`, absent otherwise; phase labels and per-item glyph + status word; blocked reason and dropped suffix; collapsible header; live updates in place.
- Functional: the strip is outside each room's scroll container; on the Console log section it is static at the top of the body.
- Functional: Console `showToolCalls` off keeps the strip; `showSystem` has no effect.
- Non-functional: no Legacy import from Console; tokens only from each shell's existing utilities; `useId()` for `aria-controls`; zero ESLint warnings; no new dependency.

## Architecture

Shared, pure: `summarizeTodoState` from Phase 1. Each strip is ~120 lines of JSX plus two token maps.

```tsx
// packages/web/src/components/workflows/TodoStrip.tsx (Legacy)
export interface TodoStripProps { phases: readonly TodoPhase[]; scopeKey: string }
export function TodoStrip({ phases, scopeKey }: TodoStripProps): React.ReactElement | null
```

- Returns `null` when `phases.length === 0`.
- `open` state: `useState(true)`; reset to `true` when `scopeKey` changes (a `useEffect` keyed on `scopeKey`, mirroring how the panes key their page state by `resolvedScopeKey`). Polling re-renders keep the same `scopeKey`, so the state survives.
- `const listId = useId()`.
- Markup exactly as `plan.md` → End-to-end design: `<section aria-label="Todo" className="flex-none border-b border-border bg-surface-elevated">`, header `<button type="button" aria-expanded={open} aria-controls={listId} onClick=…>` with children `TODO` label, current-item glyph (`aria-hidden`) + `sr-only` status word + elided `content` (or the first phase name when `current` is null, with no glyph), `done/total`, chevron `▾` (`aria-hidden`, `rotate-180` when closed, `transition-transform duration-[120ms] motion-reduce:transition-none`); body `<div id={listId} hidden={!open} className="max-h-[168px] overflow-y-auto border-t border-border px-2.5 pb-2 pt-1">` containing, per phase, `<h3 className="mt-1 text-[10px] uppercase tracking-[0.07em] text-text-secondary">{phase}</h3>` and `<ul className="m-0 list-none p-0 font-mono text-[11.5px] leading-[1.85] text-text-secondary">` of `<li>` rows.
- Item row: `<span aria-hidden className={GLYPH_CLASS[status]}>{GLYPH[status]}</span> <span className="sr-only">{STATUS_WORD[status]}</span> <span className={status === 'abandoned' ? 'line-through' : undefined}>{content}</span>` plus `<span className="text-text-secondary"> · dropped</span>` for abandoned and `<span className="text-text-secondary"> · blocked{blocker ? `: ${blocker}` : ''}</span>` for blocked.
- Token maps (Legacy): `GLYPH = { completed: '☑', in_progress: '◐', blocked: '⊘', pending: '☐', abandoned: '☐' }`; `GLYPH_CLASS = { completed: 'text-success', in_progress: 'text-accent-bright', blocked: 'text-warning', pending: 'text-text-secondary', abandoned: 'text-text-secondary' }`; `STATUS_WORD = { completed: 'completed', in_progress: 'in progress', blocked: 'blocked', pending: 'pending', abandoned: 'abandoned' }`. Header: `min-h-[24px] w-full px-2.5 py-1.5 text-left hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent-bright focus-visible:-outline-offset-2`.

`ConsoleTodoStrip.tsx` (`packages/web/src/experiments/console/components/inspect/`) is the same component with Console tones: `in_progress` → `text-[color:var(--running)]` (the pair `ConsoleAgentHistoryList.tsx:169-175` already uses), focus offset `focus-visible:outline-offset-2` as the Console summary uses, and a `position?: 'pinned' | 'static'` prop that only changes the border edge (`border-b` when pinned above a scroller, `border-b` plus `mb-1.5` when static in the log section). It imports `TodoPhase`/`summarizeTodoState` from `@/lib/todo-state` and nothing from `@/components/`.

Mount points:

- `NodeTranscriptPane.tsx` (`:365-395`): `<div className="flex min-h-0 flex-1 flex-col">` gains `<TodoStrip phases={history.todos} scopeKey={resolvedScopeKey} />` as the first child, before the `data-testid="node-transcript-scroll"` div. (Bottom placement, if chosen in validation: move it after the scroller and before `Jump to latest`, and flip `border-b` → `border-t`.)
- `ConsoleNodeRoom.tsx` (`:872-889`): inside `<RoomRegion>` before the scroll div: `<ConsoleTodoStrip phases={history.todos} scopeKey={resolvedScopeKey} position="pinned" />`. It sits outside `ConsoleAgentHistoryList`, so `showToolCalls` cannot touch it.
- `ConsoleExecutionHistory.tsx` (`:297-308`): wrap `history` so the strip precedes the list: `<><ConsoleTodoStrip phases={history.todos} scopeKey={resolvedScopeKey} position="static" />{list}</>`; keep the error/loading branches as they are (a failed first page has no todos to show).

`scopeKey` on each mount is the existing `resolvedScopeKey`/`nodeMessageScopeKey(...)` value the pane already computes for its page state, so the strip resets exactly when the transcript does.

## Related Code Files

- Create: `packages/web/src/components/workflows/TodoStrip.tsx`
- Create: `packages/web/src/experiments/console/components/inspect/ConsoleTodoStrip.tsx`
- Modify: `packages/web/src/components/workflows/NodeTranscriptPane.tsx`
- Modify: `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx`
- Modify: `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.tsx`
- Modify: `packages/web/src/components/workflows/NodeTranscriptPane.test.tsx`
- Modify: `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx`
- Modify: `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx`
- Verify only: `packages/web/src/experiments/console/console-isolation.test.ts`, `packages/web/src/components/workflows/NodeRoom.test.tsx`, `LegacyNodeRoom.test.tsx`
- Read-only: `NodeRoom.tsx`, `ConsoleAgentHistoryList.tsx`, `tool-presentation.ts`

## Implementation Steps

### Red — component tests on the three mounts

1. `NodeTranscriptPane.test.tsx` (happy-dom harness at `:1-60`, mount pattern in `describe('NodeTranscriptPane')` `:250+`): add a `TODO_ROWS` fixture of three `tool` rows named `todo` with the Phase 1 `E2E_FAKE_TODO_INPUTS`-shaped inputs (local literal, not an import from providers), plus one `Read` row. Cases:
   - renders `section[aria-label="Todo"]` as a **preceding sibling** of `[data-testid="node-transcript-scroll"]` (assert `strip.nextElementSibling === scroller`); phase headings `Research`/`Implement` present; four `li` rows; `Locate the backoff cap` row contains `in progress`; `Run the suite` row contains `blocked: CI has one build job`; header text contains `1/4`.
   - a transcript with only the `Read` row renders no `section[aria-label="Todo"]`.
   - no checklist text inside any `details[data-tool-id]`; the three todo rows' summaries contain `todo updated` and `op: init` / `op: done` / `op: block`.
   - header click → `aria-expanded="false"` and the list element has `hidden`; click again → visible; a polling refresh (second page with one more todo row appended) keeps `aria-expanded="false"` and updates the header count; changing the selected row to another node resets to expanded.
   - the strip element identity survives a polling re-render (capture the `section` node before and after; `toBe`).
2. `ConsoleNodeRoom.test.tsx` (`describe('ConsoleNodeRoom')` `:190+`, mount options with `showToolCalls` at `:1019`/`:1074`): same present/absent/sibling-of-scroller cases against `[data-testid="console-node-room-scroll"]` and the `<nodeId> room` region; plus `showToolCalls: false` → strip present, `details[data-tool-id]` count 0; `showSystem: false` → strip unchanged.
3. `ConsoleExecutionHistory.test.tsx` (mount at `:174`, `showToolCalls` at `:280`): strip present above the list for the todo fixture (first child of the section body), absent for the plain fixture, present with `showToolCalls: false`.
4. Run `cd packages/web && bun test src/components/workflows/NodeTranscriptPane.test.tsx src/experiments/console/components/ConsoleNodeRoom.test.tsx src/experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx` — red.

### Green — Legacy

5. Create `TodoStrip.tsx` per Architecture. Keep the token maps at module top like `NodeRoom.tsx`'s `CHIP_TONE`/`GLYPH_TONE`. No `useEffect` other than the `scopeKey` reset.
6. `NodeTranscriptPane.tsx`: replace the Phase 1 `history.items` shim with `const { items, todos } = history` and mount `<TodoStrip>` as the first child of the outer flex column. Pass `resolvedScopeKey`.
7. Run the Legacy test file — green.

### Green — Console

8. Create `ConsoleTodoStrip.tsx` per Architecture; confirm `console-isolation.test.ts` still passes (no `@/components/` import).
9. `ConsoleNodeRoom.tsx`: mount inside `RoomRegion` before the scroll div, `position="pinned"`; `ConsoleExecutionHistory.tsx`: mount before the list, `position="static"`.
10. Run the two Console test files and `console-isolation.test.ts` — green.

### Sweep

11. `cd packages/web && bun run test && bun run type-check && bun run lint` (from the package — never root `bun test`). Confirm `NodeRoom.test.tsx`, `LegacyNodeRoom.test.tsx`, and `ConsoleNodeRoom tool rows` tests are untouched and green — the row contract from Story 1.1 has not moved.
12. Re-run the Phase 1 E2E spec locally (`bun run --cwd e2e test:ui -- --grep 'todo strip'`) — behaviour cases green; visual evidence is Phase 3.

## Todo

- [ ] Red component tests on `NodeTranscriptPane`, `ConsoleNodeRoom`, `ConsoleExecutionHistory`
- [ ] `TodoStrip.tsx` green on Legacy
- [ ] `ConsoleTodoStrip.tsx` green on both Console mounts
- [ ] Console isolation, Web tests, type-check, lint green
- [ ] Phase 1 E2E behaviour cases green

## Success Criteria

- [ ] Both shells render the same anatomy: section → header button (`aria-expanded`, `aria-controls`) → headings + lists; token classes differ only where each shell's row already differs.
- [ ] The strip is a sibling outside the scroller on both rooms and static at the top of the Console log section.
- [ ] Todo rows in the transcript are unchanged one-line rows; no checklist text exists inside any `details[data-tool-id]`.
- [ ] Console `showToolCalls` off hides rows but not the strip.
- [ ] Toggle state survives polling and resets on scope change; the strip node identity survives re-renders.

## Risk Assessment

- **Sticky vs sibling.** A sticky strip inside `NodeRoom` would be defeated by `RoomRegion`'s own `overflow-y-auto` (`NodeRoom.tsx:141-154`); the sibling placement is deliberate and the "preceding sibling of the scroller" assertion pins it.
- **Two Console mounts on one page.** `useId()` prevents duplicate `aria-controls` targets; tests never build a selector from the id.
- **Scroll-follow interplay.** The strip changes the scroller's height when it appears; `room-scroll-follow` keys on the scroller's own metrics, so pin-to-bottom keeps working. If a test shows the follow flag flipping when the strip mounts, wrap the scroll effect's dependency on `pageState.rows.length` review in Phase 3 rather than special-casing the strip.
- **Long plans.** The 168 px cap with internal scroll keeps a 40-item plan from swallowing the room; a nested scroller inside a flex column is the pattern the queue band also adopts (DESIGN.md:646).

## Security Considerations

- All todo text renders as React text nodes; nothing goes into `title`, `aria-label`, `id`, or `dangerouslySetInnerHTML`. The `blocker` reason is agent-authored prose and is treated the same way.
