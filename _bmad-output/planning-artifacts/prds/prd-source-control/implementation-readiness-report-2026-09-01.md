---
stepsCompleted:
  [
    'step-01-document-discovery',
    'step-02-prd-analysis',
    'step-03-epic-coverage-validation',
    'step-04-ux-alignment',
    'step-05-epic-quality-review',
    'step-06-final-assessment',
  ]
inputDocuments:
  - prd.md
  - architecture.md
  - addendum.md
  - ../../epics-source-control/epics.md
  - sprint-change-proposal-2026-09-01.md
  - ../../ux-designs/ux-Archon-source-control-2026-08-31/DESIGN.md
  - ../../ux-designs/ux-Archon-source-control-2026-08-31/EXPERIENCE.md
supersedes: implementation-readiness-report-2026-08-31.md
---

# Implementation Readiness Assessment Report

**Date:** 2026-09-01
**Project:** Archon — Source Control Tab (feature)
**Kind:** Rerun after Correct Course (commit-history graph + standalone UX contract + NFR7 Accessibility). The 2026-08-31 report is the pre-graph baseline and is superseded for graph / UX / NFR7 doctrine.

## Step 1 — Document Discovery

**Scope:** the Source Control feature's self-contained handoff package at `archon/_bmad-output/planning-artifacts/prds/prd-source-control/`, plus the standalone UX contract produced by the 2026-09-01 UX run.

**Documents found (this feature):**

- **PRD** — `prd.md` (whole, `status: final`; `updated: 2026-09-01`).
- **Architecture** — `architecture.md` (whole, `status: decided`; `updated: 2026-09-01`) + `addendum.md` (technical depth).
- **Epics & Stories** — `epics.md` (whole; 3 epics, 8 stories; `stepsCompleted` through step-04).
- **UX** — standalone contract at `../../ux-designs/ux-Archon-source-control-2026-08-31/` (`DESIGN.md` + `EXPERIENCE.md`, both `status: final`, `created/updated: 2026-09-01`). The folder slug `ux-Archon-source-control-2026-08-31` is a **legacy name**; authoritative dates are the frontmatter fields.
- **Change record** — `sprint-change-proposal-2026-09-01.md` (Correct Course applied).

**Supporting (not assessed as specs):** `reconcile-source-control.md`, `review-source-control.md`, `.memlog.md`, `implementation-readiness-report-2026-08-31.md` (prior baseline).

**Not duplicates — different feature (out of scope):** the flat `planning_artifacts/` holds `prd.md` / `architecture.md` / `epics.md` for the **Hermes Agent Workflow Commander** feature. These are a _different scope_ and must not be merged with this feature's subfolder.

**Issues:** no duplicate versions of the Source Control docs. **No missing** PRD / Architecture / Epics / UX spec. The 2026-08-31 UX-warning (inline-only) is **cleared**.

## Step 2 — PRD Analysis

### Functional Requirements (9)

Unchanged in count from the prior IR. FR1 and FR6 now require a **commit-history graph** (not a plain list):

- **FR1 — Source Control tab (two regions).** Fourth tab on the workflow-run screen: **Changes** above a **commit-history graph** (branch/merge lane topology), scoped to the run. Empty state when there is no readable checkout (FR8).
- **FR2 — Manual reload.** On-demand refresh; no auto-refresh or polling. `[ASSUMPTION]` "changed — Reload" affordance if server content diverged.
- **FR3 — Changed-file listing (M/A/D).** For Now and per selected commit; other git statuses project (rename→D+A, copy→A, type-change→M, unmerged→M).
- **FR4 — Status-keyed viewer.** M two-pane diff (red before / green after, `+`/`-` gutter markers); A/D single-pane content. Direction Now=`HEAD→worktree`, commit=`parent→commit`.
- **FR5 — Every file opens (large + binary).** Stream large text; binary inline (image) or download/hex; nothing blocked.
- **FR6 — Inspect any commit.** Select any run-branch commit (including not-merged-to-base); see its M/A/D files and diffs. History renders as a **lane graph**; lanes computed from `log.parents[]` (topology, not one-lane-per-branch).
- **FR7 — Server-resolved, run-confined, read-only.** Checkout root from `runId`; client may pass only a server-returned repo-relative path; no write/commit surface.
- **FR8 — Empty state.** No readable checkout (`working_path` null, directory absent, not a git checkout, **or container-backend**) → Empty state, never error/crash. Presence decided at read time.
- **FR9 — Durable run-end snapshot (fast-follow, not MVP).** Snapshot under `output_root`; live checkout remains primary.

Total FRs: 9 (FR9 is fast-follow).

### Non-Functional Requirements (7)

NFR1–NFR6 unchanged from the 2026-08-31 IR. **NFR7 is new** (originates in PRD Cross-Cutting **Accessibility**, mapped in epics as NFR7):

- **NFR1 — Performance.** Fetch-on-click; no run-screen regression (SM-C1); large content streams; on-demand only.
- **NFR2 — Security.** Server-derived checkout root; realpath-contain live reads; commit content via `ls-tree` + `cat-file blob` on a validated OID; argv-safe; read-only.
- **NFR3 — Reliability.** Missing checkout → Empty state; CAP-8 snapshot-write failure must not fail the run.
- **NFR4 — Compatibility.** `registerOpenApiRoute` (+ raw `app.get` exception for wildcard content); `@archon/web` consumes OpenAPI-generated types only.
- **NFR5 — Observability.** Named structured logs; never log file contents / disallowed paths / secrets.
- **NFR6 — Privacy / secrets (residual risk).** v1 ships without redaction; accepted for trusted internal read-only users.
- **NFR7 — Accessibility.** Diff `+`/`-` gutter markers as the non-color cue (WCAG 1.4.1); letter-carried M/A/D badges; Changes list, commit-graph, and viewer keyboard-operable; WCAG-AA contrast (markers ≥ 4.5:1, lanes ≥ 3:1 non-text); layout reflows/zooms without loss (tested 320px / 400%; stack/unified `[ASSUMPTION]`). UX contract: `EXPERIENCE.md` Accessibility Floor.

Total NFRs: 7.

### Additional Requirements

Read-only hard guarantee; ship without a feature flag; D5 container gate then uniform `working_path` read; D6 containment tests; CAP-8 snapshot seam (fast-follow); Spikes 1–2 (diff performance / M-slice) plus **Spike 3 (lane layout, medium-risk, before Story 2.1)**.

### PRD Completeness Assessment

PRD is `status: final`, 9 FR + 7 NFR, every FR with testable consequences, non-goals explicit, success metrics + counter-metrics present, assumptions indexed, 4 open questions tracked as non-blocking. The graph + Accessibility NFR are load-bearing and present. Complete and clear for coverage validation.

## Step 3 — Epic Coverage Validation

### Coverage Matrix

| FR  | PRD requirement                         | Epic coverage                                                             | Status    |
| --- | --------------------------------------- | ------------------------------------------------------------------------- | --------- |
| FR1 | Tab + two regions (Changes + **graph**) | Epic 1 / Story 1.1 (tab+Changes) + Epic 2 / Story 2.1 (history **graph**) | ✓ Covered |
| FR2 | Manual reload                           | Epic 1 / Story 1.1                                                        | ✓ Covered |
| FR3 | List M/A/D                              | Epic 1 / Story 1.1 (Now) + Epic 2 / Story 2.2 (per-commit)                | ✓ Covered |
| FR4 | Status-keyed viewer                     | Epic 1 / Stories 1.2, 1.3 (+ Epic 2 / 2.2 reuse)                          | ✓ Covered |
| FR5 | Every file opens                        | Epic 1 / Story 1.4                                                        | ✓ Covered |
| FR6 | Inspect any commit (graph + files)      | Epic 2 / Stories 2.1, 2.2                                                 | ✓ Covered |
| FR7 | Server-resolved read-only               | Epic 1 / Story 1.1 (+ containment in 1.2/1.3)                             | ✓ Covered |
| FR8 | Empty state + D5 container gate         | Epic 1 / Story 1.1 + Epic 2 / Story 2.1                                   | ✓ Covered |
| FR9 | Durable snapshot (fast-follow)          | Epic 4 / Stories 4.1, 4.2                                                 | ✓ Covered |

### NFR7 traceability (must originate in PRD)

| Layer     | Location                                                                                                      | Present |
| --------- | ------------------------------------------------------------------------------------------------------------- | ------- |
| Origin    | `prd.md` Cross-Cutting NFRs — **Accessibility**                                                               | ✓       |
| Inventory | `epics.md` NonFunctional Requirements — **NFR7 (Accessibility)**                                              | ✓       |
| Story ACs | Story 1.1 keyboard on Changes rows; Story 1.2 `+`/`-` markers ≥ 4.5:1; Story 2.1 keyboard expand + lane ≥ 3:1 | ✓       |

NFR7 is **not invented in epics**. NFR1–NFR6 remain cross-cutting as before.

### Missing Requirements

None. No PRD FR is uncovered; no epic story references an FR absent from the PRD.

### Coverage Statistics

- Total PRD FRs: 9
- FRs covered in epics: 9
- Coverage: 100%
- NFR1–NFR7 are cross-cutting and appear as story-level `**Requirements:**` (Epic 1 primary; Epic 2 inherits NFR7 on the graph).

## Step 4 — UX Alignment

### UX Document Status

**Found.** Standalone contract: `ux-designs/ux-Archon-source-control-2026-08-31/DESIGN.md` (visual identity) + `EXPERIENCE.md` (IA, states, Accessibility Floor, key flow). Status `final`. This **clears** the 2026-08-31 warning.

### Alignment (load-bearing)

| Topic                                                                                    | Specs                                                       | UX spines                                                                                             | Status |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------ |
| Commit history is a **topology graph**                                                   | PRD §4.1 / §4.4 / FR-6; architecture Stack; epics Story 2.1 | EXPERIENCE Commit Graph + IA "Graph"; DESIGN `commit-graph-row`                                       | ✓      |
| Renderer spike-selected (`@xyflow/react` **or** bespoke SVG; no new dep; **not locked**) | architecture Spike 3 + Stack                                | EXPERIENCE Foundation + Rendering `[ASSUMPTION/recommended]`; DESIGN `commit-graph-row.render` + Do's | ✓      |
| `log` record **adds `parents[]`**, retaining message / author / time                     | architecture Missing pieces; addendum log endpoint          | EXPERIENCE data delta (synced 2026-09-01)                                                             | ✓      |
| Read-only surface                                                                        | PRD §5 / Constraints                                        | EXPERIENCE Foundation; DESIGN write-affordances NONE                                                  | ✓      |
| Empty state — 2 copies + D5 container gate                                               | PRD FR-8; architecture D5; addendum L9                      | EXPERIENCE State Patterns + Key Flow failure branch; DESIGN `empty-state`                             | ✓      |
| A11y floor                                                                               | PRD Accessibility NFR; epics NFR7 + ACs                     | EXPERIENCE Accessibility Floor; DESIGN markers / letter badges / lane contrast                        | ✓      |

### Residual-contradiction hunt (a–f)

Explicit hunt across PRD, architecture, addendum, epics, DESIGN, EXPERIENCE, sprint-change-proposal:

| ID  | Pattern                                                                       | Result                                                                                                                                                               |
| --- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) | History still called a plain "list" (as the renderer)                         | **None.** Region names still say "commit history"; FR1/glossary/UJ-1 now say graph. A plain list is explicitly **not** an acceptable fallback (Spike 3 / Story 2.1). |
| (b) | "lane per branch"                                                             | **None.** PRD: lanes by topology, not one-per-branch.                                                                                                                |
| (c) | "no isolation-env gate" / "no worktree branching" vs D5                       | **None.** Addendum L9: D5 gate first, then uniform `working_path` read for non-container runs.                                                                       |
| (d) | "no readiness reopen" / "disproven that readiness reopens"                    | **None.** This report _is_ the reopen.                                                                                                                               |
| (e) | Renderer "locked" or "plain virtualized SVG"                                  | **None after sync.** Renderer is spike-selected either-or. Graph _requirement_ is locked; renderer is not.                                                           |
| (f) | `git log --format=%H %P` as the whole endpoint (dropping message/author/time) | **None.** Architecture / addendum: format includes `%H %P` **alongside** author / date / subject.                                                                    |

Soft wording patched in this rerun (non-blocking before; now aligned): UJ-1 + glossary "lists commits" → graph; Epic 1 summary NFR1–NFR6 → NFR1–NFR7; EXPERIENCE Foundation `@xyflow` "decided" → spike-selected either-or; DESIGN Do's prefer-xyflow → either-or; architecture/addendum "virtualized SVG" → "bespoke SVG".

### Warnings

- Deferred UX `[ASSUMPTION]`/`[OPEN]` items (split ratio, row height, independent scroll, key bindings, empty-Changes copy, error/refusal copy, diff green token, "markers + tint" vs "markers only") remain build-time decisions. **Not blockers.**
- UX workspace folder slug is `ux-Archon-source-control-2026-08-31` while the run date is 2026-09-01. Documented as a legacy slug; do not rename (cross-references). **Not a blocker.**

## Step 5 — Epic Quality Review

### 🔴 Critical Violations

None. All three epics are user-value (inspect uncommitted changes / browse history / durable history), not technical milestones. No forward dependency; no epic requires a later one.

### 🟠 Major Issues

None remaining.

The 2026-08-31 identifier-contract conflict (FR7 vs D2 path) stays **resolved in place** (server-derived checkout root + server-returned repo-relative path).

The 2026-09-01 addendum L9 vs D5 contradiction ("no isolation-env gate") was **fixed during Correct Course**: D5 provider gate first, then uniform `working_path` read.

### 🟡 Minor Concerns

- Story 1.1 still bundles the list-only Now slice (tab + Changes + Reload + D5/D6 + empty state + keyboard). Acceptable as the thin vertical foundation; split at dev time only if it exceeds one session.
- **Spike 3 is medium-risk, not a blocker.** It is sequenced **before Story 2.1**; Epic 1 (Stories 1.1–1.4) can start without it. Implementation effort for the graph is **TBD by the spike**; a plain list is not an acceptable fallback.
- Story 1.1 sizing watch carried from the prior IR.

### Best-practices checklist (all three epics)

- [x] User value · [x] independent (E1 alone; E2 on E1 + Spike 3 before 2.1; E3 on E1+E2) · [x] sized single-session · [x] no forward deps · [x] no upfront DB · [x] Given/When/Then ACs with edge+error · [x] FR traceability (per-story `**Requirements:**`) · [x] Story 2.1 is a **graph** with a merge AC · [x] NFR7 ACs are testable.

### Brownfield indicators

Integration points explicit: `GET /api/workflows/runs/{runId}`, the artifact-route pattern, the `conversation → isolation_env` FK. No starter template; new `@archon/git` helpers + server routes + web tab are additive. Graph renderer reuses installed `@xyflow/react` **or** a bespoke SVG — **no new graph dependency**.

## Summary and Recommendations

### Overall Readiness Status

**READY** — implementation may begin (Epic 1 immediately; Spike 3 before Epic 2 Story 2.1).

### Issues found and disposition

- **Correct Course (2026-09-01) applied** — commit history is a topology graph; standalone UX contract; NFR7 Accessibility; Spike 3 sequenced; addendum L9 D5 contradiction fixed. Record: `sprint-change-proposal-2026-09-01.md`.
- **Prior IR (2026-08-31) superseded** for graph / UX / NFR7. Identifier-contract resolution from that report still stands.
- **No load-bearing residual contradictions** (hunt a–f: none). Soft-wording aligned in this rerun.
- **1 minor sizing watch** — Story 1.1 bundles the list-only Now slice. Accept; split at dev time only if it exceeds one session.
- **4 PRD open questions** — host worktree existence check, CAP-8 snapshot format, large/binary thresholds, secret-redaction revisit. Non-blocking.
- **Spike 3** — medium-risk lane layout; **do first before Story 2.1**; not a v1 blocker for Epic 1.

### Coverage

9/9 FR covered by epics (100%); NFR1–NFR7 cross-cutting, mapped to story-level `**Requirements:**` and testable ACs (NFR7: Stories 1.1, 1.2, 2.1).

### Recommended Next Steps

1. Proceed to implementation via `bmad-sprint-planning` → `bmad-create-story` → `bmad-dev-story`, run **inside the Archon subproject** per the cross-project handoff contract.
2. **Sequence:** Epic 1 (Stories 1.1–1.4) can start now. Run **Spike 3 (lane layout)** before Epic 2 Story 2.1; choose `@xyflow/react` reuse vs bespoke SVG and the windowing strategy from the prototype. Do not fall back to a plain list.
3. Treat the 4 open questions as build-time decisions; keep the CAP-8 durable snapshot a **fast-follow** (not v1).
4. Make the named security tests the CAP-5/D6 acceptance gate: symlink escape, encoded traversal, invalid/unreachable OID (refused) and colon / leading-dash / glob-metachar filenames (open successfully).
5. Honour NFR7 in implementation: `+`/`-` markers on diffs, letter badges, keyboard on Changes + graph, contrast floors.

### Final Note

This rerun reviewed 7 artifacts (PRD, architecture, addendum, epics, sprint-change-proposal, DESIGN, EXPERIENCE). After Correct Course + UX sync + soft-wording alignment it found **no blocking gaps**. **Status: READY.**

---

_Assessor: bmad-check-implementation-readiness (rerun) · Date: 2026-09-01_
