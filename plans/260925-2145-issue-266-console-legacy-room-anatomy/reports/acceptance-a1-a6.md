# Acceptance report — Node Room anatomy (issue #266 plan / Story 10.1 M001+M002)

**Date**: 2026-09-25  
**Branch**: `archon/thread-6983766e`  
**Owner**: #265 / Story 10.1 (M001, M002). M005 out of scope.  
**PRD**: `plans/260925-2145-issue-266-console-legacy-room-anatomy/prd.md`  
**Gate log**: `reports/gate-results.txt`

## Summary

Fixed-width Console (520 CSS px) and Legacy (460 CSS px) Node Rooms in split mode, approved vertical band order (scroller → controls → todo → dock), and E2E geometry re-anchored away from the obsolete ratio contract. Full US-004 gate ladder green. No PR in this iteration (parent workflow owns PR).

| Criterion                        | Result |
| -------------------------------- | ------ |
| A1 Fixed split outer width       | PASS   |
| A2 Single-mode full width + Back | PASS   |
| A3 Band order                    | PASS   |
| A4 Last-row reachability + caps  | PASS   |
| A5 Behavior/identity regressions | PASS   |
| A6 Docs + no drift               | PASS   |

---

## A1 — Split-mode fixed outer width (520 / 460 ±1)

**Contract**

- `packages/web/src/lib/room-split-layout.ts` exports `ROOM_WIDTH_PX = { console: 520, legacy: 460 } satisfies Record<RoomSurface, number>`.
- Split owners: `LegacyGraphLogsPane.tsx`, `ConsoleInspectPane.tsx` — outer `#legacy-run-room` / `#console-run-room` use `shrink-0` + inline width; main view `min-w-0 flex-1`; no "Resize node room" separator; left border inside outer room.

**Unit / component**

| Test                                                    | Assertion                                                                      |
| ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `room-split-layout.test.ts`                             | `ROOM_WIDTH_PX.console === 520`, `.legacy === 460`; stale-key fixture only     |
| `LegacyGraphLogsPane.test.tsx`                          | outer 460px, shrink-0, main flex-1, no separator; stale keys ignored/unwritten |
| `ConsoleInspectPane.test.tsx`                           | outer 520px, same contract                                                     |
| `WorkflowExecution.test.tsx` / `RunDetailPage.test.tsx` | ratio props/state removed; layout via owners                                   |

**Browser (Playwright)**

| Spec                                                            | Viewport / mode                                  | Measurement                                                   | Capture / artifact                                                             |
| --------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `workflow-run-hitl-room.spec.ts` `[V:hitl.console-room-layout]` | split (desktop)                                  | `#console-run-room` width 520 ±1                              | suite pass                                                                     |
| `workflow-run-hitl-room.spec.ts` `[V:hitl.legacy-room-layout]`  | split                                            | `#legacy-run-room` width 460 ±1                               | suite pass                                                                     |
| `workflow-run-hitl-room.spec.ts` `[V:hitl.room-fixed-width]`    | split + seeded `archon.run-room.ratio.*`         | fixed 520/460; no separator; keys unread/unwritten            | suite pass                                                                     |
| `agent-todo-strip.spec.ts` geometry                             | split 1440-class                                 | `outerRoomWidth` console **520**, legacy **460**              | `evidence/todo-strip-metrics.json`                                             |
| `workflow-run-hitl-visual.spec.ts`                              | 1440×1000, 1024×900, 768×900, 390×844, 200% zoom | measured outer width in split; full available width in single | historical HITL capture dirs refreshed by run; not treated as design authority |
| `occurrence-navigation.spec.ts`                                 | split                                            | surface-specific 520/460 labels                               | suite pass                                                                     |

**In-split container change without mode flip**: owner + E2E assert fixed px width (not ratio of container).

---

## A2 — Single-mode full width, hidden main, Back

**Implementation**

- Main view: mutually exclusive `hidden` vs `flex` classes (not bare HTML `hidden` alone as the only hide mechanism where classes drive layout).
- Room: no fixed inline width; `min-w-0 flex-1 w-full`.
- Mode source: `useContainerSplitMode` only (Legacy Node Room path no longer uses viewport `useStackedViewport`).

**Tests**

| Test                                                                                           | Coverage                                                                               |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `LegacyGraphLogsPane.test.tsx` / `ConsoleInspectPane.test.tsx`                                 | single-mode hide classes; room fills; Back restores; stale ratio ignored               |
| `workflow-run-hitl-room.spec.ts` `[V:hitl.console-mobile-back]`, `[V:hitl.legacy-mobile-back]` | narrow Back + focus/draft restore                                                      |
| `workflow-run-hitl-visual.spec.ts`                                                             | single-mode full available width                                                       |
| Viewport matrix in todo-strip / tool-row / occurrence                                          | 390×844, 768×900, 1024×900, 200% zoom operable; no horizontal overflow claims in suite |

---

## A3 — Room-region band order

**Order**: scroller → optional controls → optional todo → optional dock (queue before composer inside dock).

| Test                          | Coverage                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| `NodeTranscriptPane.test.tsx` | full multi-band order + absent-state matrix; obsolete todo-before-scroller flipped |
| `ConsoleNodeRoom.test.tsx`    | equivalent Console matrix; 4px todo outset retained                                |
| `LegacyNodeRoom.test.tsx`     | region first child = scroller, then strip (flipped in US-004 gate)                 |
| `agent-todo-strip.spec.ts`    | DOM sibling order scroller → controls? → strip → dock                              |
| `console-isolation.test.ts`   | no cross-shell imports                                                             |

**Browser**: `evidence/console-room-anatomy-live.png`, `evidence/legacy-room-anatomy-live.png` (live todo + lower bands).

---

## A4 — Last transcript row + scroll caps

| Evidence                                                                          | Detail                                                                                              |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `e2e/fixtures/workflows/e2e-room-anatomy.yaml` + `archon-runtime.ts` registration | live todo + tool + interruptible; queue via real UI                                                 |
| `agent-todo-strip.spec.ts` `[P1] room anatomy live state…`                        | expands todo, scrolls last row; non-overlay / independent scroll at stress                          |
| `todo-strip-metrics.json`                                                         | Console/Legacy `bodyMaxHeight: 168px`, `bodyOverflowY: auto`, internal scroll true                  |
| `finished-iteration-*.json`                                                       | queue band `bandHas33vhCap: true`, `bandMaxHeight: 297px` (33vh @900), no room overflow narrow/wide |
| Long-history                                                                      | `workflow-run-hitl-room` transcript-display desktop + narrow: document fixed, room scrolls          |

---

## A5 — Identities and regressions intact

| Area                                                         | Proof                                                             |
| ------------------------------------------------------------ | ----------------------------------------------------------------- |
| Open/close, deep-link, graph/Logs selection, Ask draft/focus | `workflow-run-hitl-room.spec.ts` cases                            |
| Execution scope requests                                     | `[V:hitl.execution-scope]`                                        |
| Scroll follow/memory, keyboard, contrast                     | todo-strip, tool-row, file-edit, task-dispatch, occurrence suites |
| Shell isolation                                              | `console-isolation.test.ts`                                       |
| Finished iteration GET-only / no stale send                  | `agent-finished-iteration.spec.ts` (4 cases)                      |
| Composer docks                                               | `ComposerDock.test.tsx`, `ConsoleComposerDock.test.tsx`           |
| Mode hook                                                    | `use-container-split-mode.test.tsx`                               |
| Package-wide                                                 | `bun --filter @archon/web test` exit 0                            |

State labels and action identities unchanged (no M005 / `select-node-execution` rewrite).

---

## A6 — Docs, storage, change review

**Docs**

- Removed exactly `--rv-panel-default-width`, `--rv-panel-min-width`, `--rv-panel-max-width` from `packages/web/src/index.css` and matching rows in `packages/docs-web/src/content/docs/brand/index.md`.
- Grep evergreen `packages/docs-web`: no `rv-panel`, no "Resize node room", no `run-room.ratio` user instructions.
- Historical `docs/superpowers/` and prior plan screenshot trees not rewritten as design authority; E2E may refresh capture bytes under their historical folders.

**Storage**

- No migration. Old `archon.run-room.ratio.*` keys remain in localStorage unread/unwritten by Node Room code (deliberate regression fixtures only).

**Changed-file review** (`git diff develop...HEAD --name-only` production-relevant)

| Bucket                                        | Paths                                                              | OK?                                                   |
| --------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------- |
| Web contract + owners + bodies                | `room-split-layout.ts`, split owners, room bodies, `index.css`     | yes                                                   |
| Web tests                                     | paired `*.test.tsx` including `LegacyNodeRoom.test.tsx` order flip | yes                                                   |
| E2E                                           | fixtures, runtime registration, focused UI specs                   | yes                                                   |
| Brand docs                                    | `brand/index.md` three rows only                                   | yes                                                   |
| Visual skill hashes                           | `.agents/skills/verify-archon/visual-config.json`                  | yes                                                   |
| Plan / Ralph tracking                         | `plans/260925-2145-…`                                              | yes                                                   |
| Historical captures                           | prior plan PNG/JSON refreshed by Playwright                        | intentional evidence refresh, not requirement rewrite |
| API / schema / generated types / package.json | **none**                                                           | yes                                                   |
| sprint-status / issue-map                     | **none**                                                           | yes                                                   |

**Ownership**

- `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml`: `epic-3: backlog`; `10-1-fix-room-geometry-and-execution-selection: ready-for-dev` (unchanged by this branch).
- Issue map not hand-edited.
- Story 10.1 AC not rewritten; M005 not marked complete.
- PR not opened here; when parent opens PR it must target `develop`, link **#265**, and use `.github/pull_request_template.md`. Do not claim #266 delivered Story 3.1.

---

## Gate command record

See `reports/gate-results.txt`. Headline:

1. Narrow lib/isolation: **10 pass**
2. Components + regressions (Radix preload): **274 pass** (includes LegacyNodeRoom order fix)
3. Console isolated: **273 pass**
4. `bun --filter @archon/web test`: **exit 0**
5. `packages/web` + `e2e` type-check: **pass**
6. Focused Playwright (9 specs): **76 passed (5.5m)**

---

## Rollback

Revert web + e2e + brand-doc commits together. Untouched localStorage ratio keys become readable again under the reverted ratio implementation. No schema or data migration.

## Out of scope / deferred

- M005 Execution selection / stale steering (Story 10.1 remainder).
- Parent-owned PR creation and `bun run validate` pre-PR gate.
- Reconciling GitHub issue #266 comments with owner #265 (normal issue workflow after this evidence).
