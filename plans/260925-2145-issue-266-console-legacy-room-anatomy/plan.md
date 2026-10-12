---
title: 'Node Room anatomy: Console and Legacy geometry and band order'
description: 'Implementation plan for M001/M002, pending issue ownership resolution.'
status: blocked
priority: P1
issue: 'https://github.com/kevinle128/Archon/issues/266'
branch: archon/thread-6983766e
tags: [agent-node-room, web, e2e]
blockedBy: [issue-ownership-decision]
created: 2026-09-25
---

# Console and Legacy Node Room anatomy

## Outcome

In desktop split mode, the open Console room occupies 520 CSS pixels and the Legacy room 460 CSS pixels until it closes or the host enters single-pane mode. Both rooms keep the header above a transcript scroller; below the scroller are the optional occurrence controls, optional todo strip, optional queue band, and the applicable composer or read-only dock, in that order. The final transcript row remains reachable. Each shell keeps its own markup and tokens while presenting the same semantic run data. Narrow containers retain their existing full-width room and Back behavior.

## Ownership blocker — resolve before implementation or tracker changes

- [Issue #266](https://github.com/kevinle128/Archon/issues/266) asks for historical Story 3.1 and a `done` entry in `sprint-status.yaml`.
- The **later approved 2026-09-22 course correction** in `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md` says Epic 1–9 stories are historical and Epic 10 owns current M001/M002 implementation. The ready-for-dev Story 10.1 artifact and open [issue #265](https://github.com/kevinle128/Archon/issues/265) explicitly include these widths, order, and evidence alongside M005.
- The prior draft asserted a 2026-09-25 operator decision to transfer M001/M002 to #266; no such decision was found in either issue, their comments, the tracker, or the owning requirements. Do not treat the assertion as authorization.

**Decision needed:** either keep #265 as implementation owner and close or reconcile #266 as overlapping historical work, or explicitly assign M001/M002 to #266 and first update the Epic 10 story/issue and tracker guidance to avoid duplicate ownership. This plan specifies M001/M002 for use by the chosen owner. It does not include M005. Do not move historical Story 3.1 or Epic 3 to `done`, edit the issue map, comment on #265, or open a PR claiming #266 completes Story 3.1 until the decision is recorded.

## Verified design contract and authority

- `_bmad-output/specs/spec-agent-node-room/SPEC.md` (CAP-3), final `DESIGN.md` and `EXPERIENCE.md` in `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/`, `claude-design/design_handoff_node_room_transcript_steering/README.md`, and the interactive `Console Node Room.dc.html` / `Legacy Node Room.dc.html` are the owning design sources. `_bmad-output/planning-artifacts/mockup-manifests/agent-node-room.json` classifies M001/M002 as current, proven changes. The older HITL run-view and `key-*-node-room.html` mockups are comparison context.
- The interactive handoff fixes the outer panel widths, separates transcript from todo, queue, and dock, and shows collapsed/expanded todo, queued guidance, generating, finished, failed, and restart states. Preserve existing content, controls, focus, and state transitions; this work changes geometry and band order only.
- The older `key-*-node-room.html` files put todo before occurrence controls, while Story 10.1 Task 2 says `transcript → occurrence controls → todo → dock`. Story 10.1 Dev Notes explicitly make the corrected written contract win over an older mock. `DESIGN.md` places the navigator outside the scroller, and CAP-3 places todo below it. Use the written order. Queue is nested inside the dock in current code, before the composer; it is visually the next band.
- Responsive mode depends on the **measured room container** at 60rem (`useContainerSplitMode`), not viewport width alone. Zoom or a sidebar can cause single mode at a nominal desktop viewport.

## Acceptance criteria

| ID  | Observable result                                                                                                                                                                                                                                                                                                                                                | Evidence                                                                                                                                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | At a measured split container, `#console-run-room` is 520 ±1 CSS px and `#legacy-run-room` is 460 ±1 CSS px, including a one-pixel visual boundary; each is a non-shrinking sibling of a usable main view. Opening, content updates, reload, container changes that stay split, and old ratio keys do not resize it. No Node Room resize separator remains.      | Both split-owner tests and browser geometry at 1440×1000 and another measured split width.                                                                  |
| A2  | In measured single mode, the mounted main view is hidden, the room fills the available container without horizontal overflow, Back restores view and focus, and closing releases width.                                                                                                                                                                          | Both unit suites and browser at 390×844, 768×900, 1024×900, and 200% zoom as applicable to actual container mode.                                           |
| A3  | In both shells, room-region direct children are scroller, optional controls, optional todo, optional dock. Inside a dock, optional queue precedes the composer. Missing controls, todo, queue, or dock leave no placeholder.                                                                                                                                     | Paired room-body tests plus browser DOM and box checks.                                                                                                     |
| A4  | With long history, expanded todo, and queued guidance, the scroller retains positive height and can reveal its last row fully when the viewport band is tall enough for a row; lower bands never overlay it. Todo body scrolls within its 168px cap and queued items within their 33vh cap. Occurrence controls, when present, remain between scroller and todo. | Combined deterministic browser fixture in both shells at 1440×1000; narrow and 200% zoom checks for non-overlap, bounded overflow, and scroll reachability. |
| A5  | Header, node identity, selected execution, graph/Logs selection, query opening, run-change reset, scroll follow/memory, Close/Back identities, keyboard focus, focus rings, and existing steering state meanings remain intact. Legacy and Console present equivalent semantics using separate components and tokens.                                            | Existing component/browser regressions, keyboard pass, and Console isolation test.                                                                          |
| A6  | Evergreen docs agree with shipped sizing; old ratio keys are ignored without storage or DB migration. No unrelated source or historical evidence is rewritten.                                                                                                                                                                                                   | Docs/source search and changed-file review.                                                                                                                 |

Visual review compares the approved interactive handoff with both shells in split and single mode: room closed/open, todo absent/collapsed/expanded, controls absent/present, queue absent/present, writable and read-only dock, finished/failed/restart states, terminal without dock, long transcript, and keyboard focus. Viewports: 1440×1000, 1024×900, 768×900, 390×844, plus 200% zoom. Determine mode from the rendered container in each case. Check outer room width and border, band adjacency, last-row visibility, horizontal overflow, header wrapping, and distinct Console/Legacy tokens. Do not copy historical mockup chrome or old static order over current behavior.

## Boundaries and phases

Changes are limited to `packages/web`, affected `e2e/ui` specs, a deterministic `e2e/fixtures/workflows` fixture and its runtime registration if needed for the combined live state, and the evergreen brand-token page if obsolete CSS variables are removed. Keep resizable primitives for other callers; keep `PanelPercent` while those callers need it. No API, schema, generated type, storage migration, provider implementation, or dependency change. M005 (`Execution` selection and stale steering) remains Story 10.1's scope for its owner.

| Phase                                          | Work                                                     | Depends on                              |
| ---------------------------------------------- | -------------------------------------------------------- | --------------------------------------- |
| [1](./phase-01-shared-fixed-width-contract.md) | Shared width contract and obsolete CSS token review      | Ownership decision                      |
| [2](./phase-02-fixed-width-split-owners.md)    | Fixed split in both shells; preserve single mode         | 1                                       |
| [3](./phase-03-approved-vertical-order.md)     | Ordered bands in both room bodies                        | Ownership decision; may run alongside 2 |
| [4](./phase-04-browser-evidence.md)            | Browser geometry, responsive, state, and visual evidence | 2, 3                                    |
| [5](./phase-05-gates-tracker-handoff.md)       | Gates, docs, owner-aligned closeout                      | 4                                       |

Rollback is a focused revert of web and E2E changes. Old ratio keys remain untouched, so reverting code restores former stored ratios. Observe main-view width and transcript height at the 60rem boundary; do not add another policy for the old viewport-based stack.
