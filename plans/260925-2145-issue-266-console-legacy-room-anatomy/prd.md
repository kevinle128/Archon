# PRD — Node Room anatomy: Console and Legacy geometry and band order

Source plan: `plans/260925-2145-issue-266-console-legacy-room-anatomy/plan.md` + `phase-01..05-*.md`
Issue: https://github.com/kevinle128/Archon/issues/266 · Branch: `archon/thread-6983766e`

## Overview

In desktop split mode, the open Console Node Room occupies **520 CSS px** and the Legacy Node Room **460 CSS px** until it closes or the host enters single-pane mode. Both rooms keep header-above-transcript; below the scroller the bands are, in order: optional occurrence controls → optional todo strip → optional queue band → the applicable composer or read-only dock. The final transcript row stays reachable. Narrow containers keep the existing full-width room and Back behavior. Each shell keeps its own markup and tokens while presenting the same semantic run data.

## Problem

Today both Node Room shells are sized by a ratio system (`room-split-layout.ts`: 40% default, 24–60% clamp, `archon.run-room.ratio.<surface>` localStorage keys) with an interactive "Resize node room" separator — none of which matches the approved design contract of fixed outer widths. The vertical band order is also wrong: both room bodies render the todo strip **before** the transcript scroller; the approved order is scroller → controls → todo → dock (queue nested before the composer inside the dock). E2E specs pin the obsolete ratio geometry and must be re-anchored to the fixed-width contract.

## Ownership resolution (recorded decision)

The plan was `status: blocked` on whether issue #265 or #266 owns M001/M002. Resolution, per the evidence the plan itself records: **#265 (Epic 10 / Story 10.1) remains the owner.** The approved 2026-09-22 course correction in `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md` makes Epic 1–9 stories historical and assigns current M001/M002 implementation to Epic 10; the prior draft's claimed 2026-09-25 operator transfer to #266 was never found in any issue, comment, tracker, or requirements artifact.

Consequences for every story:

- Implement M001/M002 geometry/order as Story 10.1 scope. **M005 (Execution selection, stale steering) is out of scope.**
- Do **not** mark historical Story 3.1 or Epic 3 `done` in `sprint-status.yaml`; do not hand-edit the issue map; do not comment on issues claiming #266 delivered Story 3.1.
- If a PR is opened, link the owning issue (#265), target `develop`, use `.github/pull_request_template.md`.

## Design authority

Owning sources (do not let older static mockups override them):

- `_bmad-output/specs/spec-agent-node-room/SPEC.md` (CAP-3)
- `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/` — final `DESIGN.md` + `EXPERIENCE.md`
- `claude-design/design_handoff_node_room_transcript_steering/README.md` + interactive `Console Node Room.dc.html` / `Legacy Node Room.dc.html`
- `_bmad-output/planning-artifacts/mockup-manifests/agent-node-room.json` — classifies M001/M002 as current, proven changes
- Older `key-*-node-room.html` mockups show todo-before-controls: **obsolete order**; Story 10.1 Dev Notes make the corrected written contract win. Keep their panel widths/strip/queue styling and state meanings, not their band order.

## Goals and success metrics (acceptance criteria A1–A6)

| ID | Observable result | Evidence |
| --- | --- | --- |
| A1 | At a measured split container, `#console-run-room` is 520 ±1 CSS px and `#legacy-run-room` is 460 ±1 CSS px incl. a 1px visual boundary; each a non-shrinking sibling of a usable main view. Opening, content updates, reload, in-split container changes, and old ratio keys do not resize it. No Node Room resize separator remains. | Split-owner tests + browser geometry at 1440×1000 and another measured split width |
| A2 | In measured single mode, the mounted main view is truly hidden (`display:none`), the room fills the container without horizontal overflow, Back restores view and focus, closing releases width. | Unit suites + browser at 390×844, 768×900, 1024×900, 200% zoom as applicable to actual container mode |
| A3 | In both shells, room-region direct children are scroller → optional controls → optional todo → optional dock; inside a dock, optional queue precedes the composer; absent bands leave no placeholder. | Paired room-body tests + browser DOM/box checks |
| A4 | With long history + expanded todo + queued guidance, the scroller keeps positive height and can reveal its last row fully when the band is tall enough for a row; lower bands never overlay it. Todo body scrolls within its 168px cap; queued items within their 33vh cap. | Combined deterministic browser fixture in both shells at 1440×1000; narrow/200% zoom non-overlap + scroll reachability |
| A5 | Header, node identity, selected execution, graph/Logs selection, query opening, run-change reset, scroll follow/memory, Close/Back identities, keyboard focus, focus rings, and steering state meanings remain intact; shells stay semantically equivalent with separate components/tokens. | Existing component/browser regressions, keyboard pass, `console-isolation.test.ts` |
| A6 | Evergreen docs agree with shipped sizing; old ratio keys are ignored with no storage/DB migration; no unrelated source or historical evidence rewritten. | Docs/source search + changed-file review |

## Non-goals

- M005 (Execution selection / stale steering) — remains Story 10.1 owner scope.
- No API, schema, generated-type, storage, DB-migration, provider, or dependency changes.
- Do not delete `components/ui/resizable.tsx`, the Console resizable primitive, or `PanelPercent` — other surfaces still use them.
- Do not rewrite historical evidence: `docs/superpowers/` plans, old screenshot reports, and historical HITL mockup captures stay as records (compare against them; don't treat as authoritative).
- No new viewport-based stacking policy for the Node Room — `useContainerSplitMode` (measured room container @60rem) is the single mode source.
- No tracker/ownership churn: see *Ownership resolution*.

## Technical context

| Area | Files |
| --- | --- |
| Ratio contract to replace | `packages/web/src/lib/room-split-layout.ts` + `.test.ts` — currently 40% default, 24–60% clamp, `roomPanelSizes`/`clampRoomRatio`/`readRoomRatio`/`writeRoomRatio`, `archon.run-room.ratio.<surface>` keys. Consumers: only `LegacyGraphLogsPane`, `ConsoleInspectPane`, `WorkflowExecution`, `RunDetailPage` |
| Mode source | `packages/web/src/lib/use-container-split-mode.ts` (+`.test.tsx`) — measured container width @60rem, root-font aware (959/960@16px, 1199/1200@20px already proven) |
| Legacy split owner | `packages/web/src/components/workflows/LegacyGraphLogsPane.tsx`, `WorkflowExecution.tsx` (+ paired tests); Legacy also calls viewport-based `useStackedViewport()` below 899px — remove that second policy **from the Node Room path only** (source-control usage stays; do not export `modeForWidth`) |
| Console split owner | `packages/web/src/experiments/console/components/ConsoleInspectPane.tsx`, `experiments/console/routes/RunDetailPage.tsx` (+ paired tests) |
| Room bodies (band order) | `packages/web/src/components/workflows/NodeTranscriptPane.tsx` + `NodeRoom.tsx` (Legacy `RoomRegion`); `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx` (local `RoomRegion` has a 4px inset when todo is visible — protect the focus ring). Both currently render todo before the scroller; paired tests pin the obsolete order |
| Docks | `ComposerDock` / `ConsoleComposerDock` — queue already precedes the textarea; keep |
| Tokens/docs | `packages/web/src/index.css` defines unused `--rv-panel-default/min/max-width`; `packages/docs-web/src/content/docs/brand/index.md` wrongly lists them as live |
| E2E specs to re-anchor | `e2e/ui/workflow-run-hitl-room.spec.ts` (ratio + separator drag), `workflow-run-hitl-visual.spec.ts`, `agent-todo-strip.spec.ts`, `agent-tool-row-visual.spec.ts`, `task-dispatch-body.spec.ts`, `file-edit-diff.spec.ts`, `verifier-visual.spec.ts`, `occurrence-navigation.spec.ts`. Re-grep `e2e/ui` for `run-room.ratio`, `roomRatio`, `Resize node room`, 460px Console assumptions before editing |
| New fixture | `e2e/fixtures/workflows/e2e-room-anatomy.yaml` + registration in `e2e/lib/playwright/archon-runtime.ts`; reuse e2e-fake provider directives (`emitTodo`, `emitTool`, `repeatTool`, `interruptible`, bounded `delayMs`), dispatch via `startWorkflowViaWeb` — no provider changes, no DOM injection |

### Test commands

- Unit/component: `cd packages/web && NODE_ENV=development bun test <file>` — honor `packages/web/package.json` test splits (Radix preload for `src/components/`; Console tests in their isolated invocation; separate `bun test` invocations where `mock.module()` conflicts — `mock.restore()` does NOT undo module replacement).
- Type checks: `(cd packages/web && bun run type-check)`, `(cd e2e && bun run typecheck)`, then `bun --filter @archon/web test`. **Never** `bun test` from the monorepo root. `bun run validate` before any PR.
- E2E: focused Playwright specs from `e2e/`; the runner owns worker processes — don't start a duplicate dev server. Route captures to `plans/.../reports/evidence/` or `testInfo.outputPath` (`ARCHON_VERIFY_EVIDENCE` where a spec hardcodes a historical dir).

## Story overview

| Story | Title | Plan coverage | Depends on |
| --- | --- | --- | --- |
| US-001 | Fixed-width contract + split owners in both shells | Phases 1+2 (one working change — removed ratio exports must never leave the branch type-invalid) | — |
| US-002 | Approved vertical band order in both room bodies | Phase 3 | — |
| US-003 | Browser geometry, responsive, state, and visual evidence | Phase 4 | US-001, US-002 |
| US-004 | Gates, docs consistency, owner-aligned closeout | Phase 5 | US-003 |

## Rollback

Focused revert of `packages/web`, `e2e`, and brand-doc changes together. Old localStorage ratio values are left intact and become readable again under the reverted code. No data migration or operational rollout.
