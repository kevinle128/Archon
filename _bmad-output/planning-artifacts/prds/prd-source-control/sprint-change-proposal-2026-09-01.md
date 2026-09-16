# Sprint Change Proposal — Source Control tab: commit-history graph + UX contract

- **Date:** 2026-09-01
- **Feature:** Archon Source Control tab (`prds/prd-source-control/`; epics: `epics-source-control/epics.md`)
- **Trigger:** bmad-ux Create run surfaced a user decision + a standalone UX contract beyond the current specs.
- **Scope classification:** **Moderate** (reconcile PRD/architecture/epics/addendum + sync the UX contract + one spike + rerun IR; no new dependency, no fundamental replan).

## 1. Issue Summary

During the UX design run, Kevin chose (pointing at VS Code's Source Control view, "đồ thị như ảnh") that the **commit history is a branch/merge topology GRAPH** (lanes), not the plain **list** the finalized specs and the READY IR validated — a **user-added normative requirement**. The run also produced a **standalone UX contract** (DESIGN.md + EXPERIENCE.md) with a load-bearing **accessibility floor** the specs didn't carry.

**Cost is NOT simply "bounded":** a scout of `archon/packages/web` verified only that **no new dependency is needed** (React Flow / `@xyflow/react` already renders the run screen's Graph tab). The **lane-assignment through merges + lane continuity across paged/windowed rows** is custom and unprototyped → **medium-risk, spike-gated** (Spike 3). Renderer (React Flow reuse vs bespoke SVG) and the windowing/pagination strategy are chosen from the spike prototype; a plain list is **not** an acceptable fallback (graph is locked).

## 2. Impact Analysis

- **PRD** (`prd.md`): §4.1 → "commit-history graph"; §4.4 + FR-6 → topology graph (**lanes by topology, not one-per-branch**), needs `parents[]`; **new Cross-Cutting Accessibility NFR** (non-color `+`/`-` diff cue, letter badges, keyboard, AA contrast, reflow tested at 320px/400% with stack/unified `[ASSUMPTION]`).
- **Architecture** (`architecture.md`): Stack (commit-graph renderer, spike-selected, no new dep); Missing pieces (`@archon/git.log` record adds `parents[]`; `@archon/web` graph); new **Spike 3** (graph-only outcome, no estimate).
- **Epics** (`epics.md`): FR1 / Epic 2 / Story 2.1 "list" → "lane graph" + merge AC + do-first spike; **NFR7 (Accessibility)** mapping the PRD NFR; coverage map NFR1–NFR7; **testable a11y ACs** — Story 1.1 (Changes rows keyboard-operable), Story 1.2 (diff `+`/`-` markers ≥ 4.5:1), Story 2.1 (commit rows keyboard focus/expand + lane dots/lines ≥ 3:1); **Overview + UX Design Requirements updated** — standalone contract now exists (was "UX inline only").
- **UX contract** (`../../ux-designs/ux-Archon-source-control-2026-08-31/`): synced to match — Commit Graph renderer is "reuse `@xyflow/react` or a bespoke SVG" (windowing spike-selected), and the `log` record "adds `parents[]` retaining message/author/time".
- **Addendum** (`addendum.md`): `log`/snapshot records add `parents[]` (with author/date/subject); history-graph note; **fixed a pre-existing contradiction** (L9 "no isolation-env gate" → D5 provider gate first, then non-container runs read uniformly by `working_path` at read time).
- **Data delta:** the `log` record adds `parents[]`. **No DB change; no new dependency.**

## 3. Recommended Approach

**Direct Adjustment** (Option 1) — reconcile the docs (done) + gate the risk with Spike 3. Graph is the locked requirement. Effort: **implementation TBD by Spike 3; documentation effort low**. Risk **Medium** (lane algorithm, spike-gated).

## 4. Detailed Change Proposals (applied)

| Doc                                        | Change                                                                                                                                                                                                |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prd.md` §4.1 / §4.4 / FR-6                | history → **commit-history graph** (lanes **by topology, not one-per-branch**); + consequence needing `parents[]`                                                                                     |
| `prd.md` Cross-Cutting NFRs                | **+ Accessibility NFR** (non-color `+`/`-` cue, letter badges, keyboard, AA contrast, reflow tested; stack/unified `[ASSUMPTION]`)                                                                    |
| `architecture.md`                          | Stack: commit-graph renderer (spike-selected, no new dep); Missing pieces: `log.parents[]` + web graph; **Spike 3**                                                                                   |
| `epics.md`                                 | list → lane graph + merge AC + do-first spike; **NFR7** + coverage NFR1–7; testable a11y ACs (1.1 keyboard, 1.2 markers, 2.1 keyboard/expand + lane ≥ 3:1); Overview + UX Design Requirements updated |
| `ux-designs/…/DESIGN.md` + `EXPERIENCE.md` | Commit Graph renderer → "@xyflow/react reuse or bespoke SVG (windowing spike-selected)"; `log` record adds `parents[]` retaining message/author/time                                                  |
| `addendum.md`                              | `log`/snapshot add `parents[]`; history-graph note; **fixed L9 D5-gate contradiction**                                                                                                                |

## 5. Correct Course checklist statuses

- **§1 Trigger:** 1.1 [Done] trigger = the UX design run (not a dev story). 1.2 [Done] _new requirement_ (graph) + _new artifact_ (UX contract). 1.3 [Done] evidence = Kevin's screenshot + `packages/web` scout.
- **§2 Epic impact:** 2.1 [Done] Epic 2 completable with modified Story 2.1. 2.2 [Done] modify Story 2.1 + add spike. 2.3 [Done] Epic 4 (durable snapshot) unaffected; **Epic 1 affected only by additive NFR7 a11y ACs** (Story 1.1 keyboard, Story 1.2 markers) — no structural change. 2.4 [N/A] no epic obsolete/new. 2.5 [Done] minor resequence — Spike 3 before Story 2.1.
- **§3 Artifacts:** 3.1 [Done] PRD. 3.2 [Done] Architecture + addendum (incl. contradiction fix). 3.3 [Done] UX standalone + synced; a11y mapped to NFR7 + ACs. 3.4 [N/A] no CI/deploy/IaC impact.
- **§4 Path:** 4.1 Direct Adjustment [Viable] (implementation effort **TBD by Spike 3**; docs low; risk Medium). 4.2 Rollback [Not viable]. 4.3 MVP review [Not needed]. 4.4 Selected = **Option 1**.
- **§5 Proposal components:** 5.1–5.5 [Done].
- **§6 Final:** 6.1 [Done]. 6.2 [Done]. 6.3 [Done] user pre-approved "A". 6.4 [N/A] no epic/story added, removed, or renumbered (only ACs modified + a spike note within Story 2.1); `sprint-status.yaml` is created later by sprint-planning. 6.5 [Done] handoff below.

## 6. Implementation Handoff

- **Scope:** Moderate. Next: **rerun `bmad-check-implementation-readiness`** (immediately follows), then `bmad-sprint-planning` → stories.
- **Sequencing:** run **Spike 3 (lane layout, medium-risk) before Epic 2 Story 2.1**.
- **UX contract:** `../../ux-designs/ux-Archon-source-control-2026-08-31/DESIGN.md` + `EXPERIENCE.md` (status: final).
