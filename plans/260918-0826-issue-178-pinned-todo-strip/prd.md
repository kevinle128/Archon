# PRD — Issue #178: Pinned Todo Strip (Story 1.5 / CAP-3)

Source plan: `plans/260918-0826-issue-178-pinned-todo-strip/plan.md` + `phase-01-start.md`, `phase-02-two-surface-renderers.md`, `phase-03-end-to-end-and-visual-verification.md` (same directory). This PRD is self-contained; the phase files carry full algorithm/test detail and should be re-read per story.

## Overview / Problem / Solution

**Problem.** An operator watching a selected agent execution has no compact, truthful view of its current todo state: todo calls scroll away as ordinary one-line transcript rows, and there is no aggregated checklist.

**Solution.** Fold ordered OMP `todo` mutations and Claude `TodoWrite` whole-list snapshots into one `TodoPhase[]` state via a pure projector (`projectTodoState`). `buildAgentHistory()` widens to `{ items, todos }`. That state renders once in a collapsible, pinned strip at the **top** of the transcript panel in the two node rooms (Legacy `NodeTranscriptPane` and Console `ConsoleNodeRoom`), stays visible while the transcript scrolls, and is absent when no reconstructable todo state exists.

**Key behavioral rules** (authority-resolved; do not reopen):

- Top placement, not bottom — SPEC/epic/architecture override the older prototype's transcript/dock ordering. Bottom rule against transcript; flex sibling of the scroller, never an overlay, never `position: sticky`.
- Collapsed by default; collapsed header still shows status glyph + representative item + segmented meter + `completed/total` count + caret.
- No strip footer Raw/body bar; no inline checklist inside any transcript row; todo rows stay one-line `todo updated` summaries.
- Fold **recorded inputs**, not result snapshots. A running/interrupted call with known input still folds. Lifecycle/terminal events must not rewrite todo statuses.
- Malformed calls are atomic no-ops (whole Claude snapshot rejected; whole `{ops:[…]}` batch rejected if any entry invalid). `view` is a true read-only no-op. Auto-promotion runs only after successful **mutating** ops.
- Scope follows the already-selected message slice (node/occurrence/loop). No fetching/merging hidden executions.
- `ConsoleExecutionHistory` (inline log) gets **no** strip — it only adapts to `.items`.
- Final `DESIGN.md` values override prototype CSS: item line-height 1.85, phase margin 4 px; focus offset Legacy −2 px / Console +2 px.
- Issue #178's generated footer says `CAP-5`/`diff-hunks` — stale tracker metadata; canonical scope is CAP-3 / todo fold / Story 1.5.

## Goals + success metrics

- One tested, renderer-free `todo-state.ts` contract covering both provider shapes, all nine OMP ops, missing-`op` inference, legacy `{ops}` batch, call-level rollback, and empty-phase removal.
- `buildAgentHistory()` returns `{ items, todos }` with `items` byte-for-byte identical to the pre-change projection; all callers/tests adapted.
- Exactly one `section[aria-label="Todo"]` per selected node room with todos; it is the first child inside the one `<nodeId> room` region and the immediate preceding sibling of that room's transcript scroller. Bounding-box proof it does not move while transcript content scrolls.
- Strip collapsed by default; Enter/Space/click toggle `aria-expanded`/`hidden` with focus retained; same-scope polling preserves disclosure state + DOM identity; scope change remounts collapsed; all-removed state unmounts.
- Expanded body capped at 168 px with its own functional `overflow-y` scroll (12-item fixture must produce `scrollHeight > clientHeight`) that does not move the transcript.
- Console `showToolCalls=false` removes tool rows but not the strip.
- Real-run E2E evidence on both surfaces: geometry at 460 px, responsive/zoom matrix, keyboard/focus/reduced-motion, contrast ratios (4.5:1 text, 3:1 focus ring), Chromium AX tree, honest manual-AT record.
- All gates green: focused Web/providers/E2E suites, `test:ui:hitl`, `bun run lint --max-warnings 0`, `bun run validate`.

## Non-goals

- No strip in `ConsoleExecutionHistory`, chat cards, Run Stream, or any non-room surface.
- Story 1.2 Raw bodies, 1.3 family bodies, 1.4 diffs, 1.6 task cards, 1.7 occurrence grouping, steering/queue/composer.
- No backend routes, schemas, migrations, generated types, runtime flags, new design tokens, new dependencies, or cross-surface component sharing (Console strip does not import from `@/components/`).
- No provider-name branching in renderers; no OMP result-detail snapshots; no message-persistence changes; no disclosure-state persistence across navigation.
- No memoization (fold is bounded by calls × task count at ~40-row scale).
- Never run root `bun test` — package-isolated commands only.

## Technical context

### Verified code anchors (re-scout before editing; Story 1.2 may have landed)

- `packages/web/src/lib/agent-history.ts:247` — `buildAgentHistory(input): AgentHistoryItem[]` (flat array today; widen to `{ items, todos }`). `AgentHistoryItem` at `:21`.
- `packages/web/src/lib/tool-presentation.ts:138-140` — `todo`, `todowrite`, `plan` names resolve to `family: 'todo'`; `:475-476` — todo headline `todo updated`.
- Three production `buildAgentHistory` callers: `packages/web/src/components/workflows/NodeTranscriptPane.tsx:237` (scroller `data-testid="node-transcript-scroll"` at `:375`, `<NodeRoom` at `:380`); `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx:608`; `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.tsx:205`.
- Legacy landmark problem: `NodeTranscriptPane` scroller currently contains `NodeRoom`, which itself wraps content in `RoomRegion` (`NodeRoom.tsx:549`) — so a strip mounted beside the scroller lands outside the room region. Fix: add `embedded?: boolean` to `NodeRoomProps` (`NodeRoom.tsx:27`) and `scrollable?: boolean` to `RoomRegion` (`NodeRoom.tsx:138`); `NodeTranscriptPane` takes region ownership.
- Console already correct: local `RoomRegion` (`ConsoleNodeRoom.tsx:146`) wraps `console-node-room-scroll` (`:875`); insert strip immediately before it. `ConsoleAgentHistoryList` at `:743` owns `showToolCalls`/`showSystem` — keep strip outside it.
- `packages/providers/src/e2e-fake/provider.ts:45` — strict `scenarioSchema` (add optional `emitTodo`); `:320` — existing `emitTool`/`repeatTool` emission loop (todo calls emit **before** it); `:203` — `safeParse` site.
- `e2e/lib/playwright/archon-runtime.ts` — fixture constants `:17-33`; `UnsupportedSetupError` `:71`; `ArchonRuntime` interface `:112-129` (follow `runHitlLongHistoryWorkflow` precedent); fixture seeding `:328-340`.
- Existing specs/fixtures: `e2e/ui/agent-tool-row-visual.spec.ts` (Story 1.1 file — do NOT modify; copy needed helpers locally), `e2e/fixtures/workflows/e2e-hitl-long-history.yaml` (workflow fixture precedent).

### Authority documents (re-read per story)

1. `_bmad-output/specs/spec-agent-node-room/SPEC.md` + Story 1.5 in `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md`
2. `_bmad-output/specs/spec-agent-node-room/todo-fold-contract.md` (shared type, two provider shapes, nine ops, inference traps, projection rules) + `test-plan.md` (minimum fold cases)
3. `_bmad-output/planning-artifacts/architecture/architecture-Archon-readable-agent-transcript-2026-09-12/ARCHITECTURE-SPINE.md` — AD-7 (history returns rows + todo state), AD-12 (both rooms render strip; `showToolCalls=false` must not hide it)
4. `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md` + `DESIGN.md` — interaction, tokens, typography, glyphs, two-renderer boundary
5. `claude-design/design_handoff_node_room_transcript_steering/README.md` + `.dc.html` prototypes — strip anatomy only (collapsed default, current-item summary, segmented meter, 168 px cap, current-row emphasis, 120 ms caret); bottom placement and `todoEnd` lifecycle rewrite are NOT adopted
6. Current code/tests own existing public behavior to preserve.

### Shared fold contract (summary — full algorithm in phase-01)

`todo-state.ts` exports `TodoStatus` (`pending|in_progress|completed|abandoned|blocked`), `TodoItem`, `TodoPhase`, `TodoSummary`, `TODO_STATUS_PRESENTATION` (glyph+label map: `☑/completed`, `◐/in progress`, `⊘/blocked`, `☐/pending`, `☐/abandoned`), `projectTodoState(inputs: readonly unknown[]): TodoPhase[]`, `summarizeTodoState(phases): TodoSummary`. Explicit type guards over `unknown`; no Zod, no provider imports in this Web leaf. Never mutates input, never throws, returns fresh objects, drops empty phases. Summary: count `completed` only; representative = first in-progress → first blocked → last completed → first item → null.

### Strip contract (summary — full markup in phase-02)

`<section aria-label="Todo">` surface-elevated, full-bleed, `flex-none`, bottom rule, no radius → full-width `<button>` (`useId()` → `aria-controls`, `aria-expanded`, 6/10 padding, ≥24 px target, collapsed initially) containing TODO label + glyph/representative item (elided 11.5 px mono) + `aria-hidden` segmented meter (one 3 px cell/item, 2 px gaps) + `done/total` + `▾` caret (180° open, 120 ms, `motion-reduce:transition-none`) → body `hidden` while collapsed but in DOM, 4/10/8 padding, top border, `max-height:168px`, `overflow-y:auto` → `h3` phase headings (10 px/0.07em/4 px top) → item rows (11.5 px mono, lh 1.85, `data-testid="todo-list"`; meter `data-testid="todo-meter"`). Current row: `surface` bg + text-primary + 2 px inset running marker. Blocked shows `· blocked: <reason>`; abandoned struck with `· dropped`; visible suffixes `aria-hidden` when a complete visually-hidden status phrase exists. Agent strings only ever render as React text — never in `id`/`aria-label`/`title`/class. Components return `null` for `[]`; parents mount `<TodoStrip key={resolvedScopeKey}>` only while `todos.length > 0`.

### Validation commands (package-isolated; never root `bun test`)

```bash
(cd packages/web && bun test src/lib/todo-state.test.ts src/lib/agent-history.test.ts)
(cd packages/web && NODE_ENV=development bun test src/components/workflows/NodeRoom.test.tsx src/components/workflows/NodeTranscriptPane.test.tsx src/components/workflows/LegacyNodeRoom.test.tsx)
(cd packages/web && NODE_ENV=development bun test src/experiments/console/components/ConsoleNodeRoom.test.tsx src/experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx src/experiments/console/console-isolation.test.ts)
(cd packages/web && bun run test && bun run type-check)
(cd packages/providers && bun test src/e2e-fake/provider.test.ts)
(cd e2e && npm run typecheck)
bun run --cwd e2e test:ui -- --grep 'todo strip'
bun run --cwd e2e test:ui:hitl
bun run lint --max-warnings 0
bun run validate
```

## Story overview

| ID     | Title                                                         | Depends on     | Phase |
| ------ | ------------------------------------------------------------- | -------------- | ----- |
| US-001 | Shared todo-state fold library + tests                        | —              | 1     |
| US-002 | `buildAgentHistory()` → `{items, todos}` + caller adaptation  | US-001         | 1     |
| US-003 | Contract docs sync + `emitTodo` fixture + red Playwright spec | US-001, US-002 | 1     |
| US-004 | Legacy + Console strip renderers and Legacy landmark refactor | US-003         | 2     |
| US-005 | Real-run visual/a11y evidence, gates, report, PR              | US-004         | 3     |

Each story is TDD-structured per the plan: write/extend the named test file first (red), implement (green), then run the listed gates. Do not implement ahead of a story's scope.
