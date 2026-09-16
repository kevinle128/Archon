---
stepsCompleted:
  - step-01-document-discovery
  - step-02-prd-analysis
  - step-03-epic-coverage-validation
  - step-04-ux-alignment
  - step-05-epic-quality-review
  - step-06-final-assessment
date: '2026-09-06'
project: Archon
feature: source-control
assessor: Winston (IR workflow)
status: READY
includedDocuments:
  - ../prds/prd-source-control/prd.md
  - ../prds/prd-source-control/addendum.md
  - ../architecture/architecture-Archon-source-control-2026-09-05/ARCHITECTURE-SPINE.md
  - ../../specs/spec-archon-source-control/SPEC.md
  - ../../specs/spec-archon-source-control/brownfield.md
  - ../../specs/spec-archon-source-control/viewer-rules.md
  - ../../specs/spec-archon-source-control/architecture-diagrams.md
  - ../../specs/spec-archon-source-control/roadmap.md
  - epics.md
excludedDocuments:
  - ../prd.md
  - ../architecture.md
  - ../epics.md
  - ../architecture/architecture-Archon-workflow-run-view-hitl-2026-09-05/
  - ../epics-workflow-run-view-hitl/
  - ../ux-designs/ux-Archon-source-control-2026-08-31/
  - ../prds/prd-source-control/architecture.md
  - ../ux.md
notes: Default planning_artifacts/implementation-readiness-report-2026-09-06.md was already a HITL inventory; this Source Control report is feature-scoped so it does not overwrite that file.
---

# Implementation Readiness Assessment Report

**Date:** 2026-09-06
**Project:** Archon — Source Control
**Assessor:** Implementation Readiness workflow (PM traceability)

## Document Discovery

Confirmed assessment set (user 2026-09-06). Other tracks exist under `{planning_artifacts}` and were not used.

### Included

- PRD: `prds/prd-source-control/prd.md` (20.5 KB, 2026-09-04) + `addendum.md` (11.6 KB, 2026-09-04)
- Architecture: `architecture/architecture-Archon-source-control-2026-09-05/ARCHITECTURE-SPINE.md` (11.8 KB, 2026-09-05)
- Epics: `epics-source-control/epics.md` (26.2 KB, 2026-09-06)
- Spec companions (outside `{planning_artifacts}` search, included by CE lock): `SPEC.md`, `brownfield.md`, `viewer-rules.md`, `architecture-diagrams.md`, `roadmap.md`

### Excluded

- Workflow Commander: `prd.md`, `architecture.md`, `epics.md`
- HITL: `architecture/architecture-Archon-workflow-run-view-hitl-2026-09-05/`, `epics-workflow-run-view-hitl/`
- Older PRD-folder architecture: `prds/prd-source-control/architecture.md`
- UX 2026-08-31 (full DESIGN/EXPERIENCE pair) and root `ux.md`
- Remainder of `prds/prd-source-control/` (reviews, prior IR reports)

### UX inventory

- `ux-designs/ux-Archon-source-control-2026-09-05/` — mockup HTML only; **no DESIGN.md / EXPERIENCE.md**
- `ux-designs/ux-Archon-source-control-2026-08-31/` — DESIGN + EXPERIENCE exist; **excluded** by CE/IR lock

## PRD Analysis

Read completely: `prd.md` (status: final) and companion `addendum.md`. Other files in `prds/prd-source-control/` were excluded by the confirmed set (not PRD shards).

### Functional Requirements

FR-1: An operator viewing a run can open a **Source Control** tab that shows, for that run, the **Changes region** above the **commit-history graph**. Consequences: The run screen exposes a fourth tab labelled Source Control beside Graph / Logs / Chat. Opening it on a run with an available Run checkout populates both regions from that run. Opening it on a run with no available Run checkout shows the Empty state (FR-8), not an error.

FR-2: The operator refreshes the tab's data on demand; the tab never auto-refreshes or polls. Consequences: A **Reload** control re-fetches the current region/file. No background polling of the Run checkout occurs. `[ASSUMPTION]` If content changed on the server since load, the tab offers a "changed — Reload" affordance rather than mutating the open view underneath the reader.

FR-3: The operator sees the changed file paths for the selected scope, each labelled `M` (modified), `A` (added), or `D` (deleted). Consequences: The Now listing matches the run checkout's uncommitted changes; a commit's listing matches that commit's file set. Every entry carries exactly one of `M` / `A` / `D`. Other git statuses project onto these: rename → `D` (old path) + `A` (new path); copy → `A`; type-change → `M`; unmerged → `M`.

FR-4: The operator opens any listed file into the shared Viewer, rendered by status. Consequences: `M` → two-pane diff, red = before / green = after. `A` → single pane showing the new file's content, no diff coloring. `D` → single pane showing the removed file's content, no diff coloring. Diff direction: Now = `HEAD → worktree`; selected commit = `parent → commit`. `M` has no standalone snapshot mode in v1 — it is diff-only.

FR-5: The operator can open any changed file — large text or binary — without the Viewer blocking. Consequences: A multi-MB text file opens (streamed / chunked) rather than being refused. A binary file is not dumped as text: images render inline; other binaries offer download or a hex peek. Opening a file shows immediate feedback (metadata/skeleton) and can be cancelled.

FR-6: The operator selects any commit in the history and sees its `M`/`A`/`D` files and their contents/diffs, read from the Run checkout's branch (not the base branch). Consequences: A commit on the run branch not yet merged into the base branch still shows its files and diffs. The commit view uses the same Viewer and the `parent → commit` direction. The history renders as a **lane graph** (branch/merge topology), one row per commit; this requires each commit's **parent OIDs** (`parents[]`) added to the existing log record. The lane-layout is a flagged build spike (see architecture).

FR-7: The system serves Source Control data by resolving the run's checkout server-side from `runId`; no request reads outside that run's checkout and no write/commit path exists. Consequences: The UI sends `runId` + a server-returned reference (a repo-relative path chosen from the changes/commit list, or a commit ref) — never the checkout root or an absolute/filesystem path. The server resolves `working_path` from the run, realpaths it, and rejects any `..`. No endpoint mutates the checkout (no write, commit, or path-injection surface).

FR-8: When the run has no readable git checkout — `working_path` null, its directory absent at read time, or it is not a git checkout — the tab shows an explicit "no worktree / not available" Empty state. Consequences: A run whose checkout was cleaned up renders the Empty state, not an error/crash. A run with a null `working_path` renders the Empty state. Presence is decided by directory existence at read time, not by run status. A container-backend run (host path stale mid-run) renders the Empty state.

FR-9: At run end, the server writes a Durable snapshot (changed files with status, per-file diffs, added/deleted content, and the commit log) under the run's `output_root`, surviving checkout cleanup. `[fast-follow]`. Consequences: After the checkout is reaped, the tab still loads that run's history and diffs, sourced from the snapshot. While the checkout exists, reads come from the live checkout; the snapshot is only the fallback. PRD §6.2 places FR-9 **out of MVP**.

**Total FRs: 9**

### Non-Functional Requirements

Extracted from PRD Cross-Cutting NFRs, Constraints, Success Metrics, and FR-7 feature-specific NFRs (PRD does not number them; IDs below match the epics inventory for traceability).

NFR1 (Performance / latency): Source Control fetches on click with explicit loading feedback; no hard SLA, but it must not regress the run screen (SM-C1). Large files stream; the tab never blocks the run screen. Reads are on-demand only (manual Reload; no polling).

NFR2 (Security): Server resolves the checkout root from `runId` (never client-supplied); the client may pass a server-returned repo-relative path, which the server realpaths and validates under the checkout, rejecting `..`; git is invoked with server-controlled args, never a shell string; strictly read-only. Mechanism in addendum.

NFR3 (Reliability): A vanished or missing checkout degrades to the Empty state, never a crash (FR-8); a terminal run status does not imply the checkout is gone — existence is checked at read time.

NFR4 (Compatibility): Honors Archon package boundaries — OpenAPI-registered routes (with the raw-route exception the artifacts route uses for wildcard/non-JSON responses), web consumes generated types only, no SDK leakage across package boundaries.

NFR5 (Observability): `[ASSUMPTION]` Server-side reads emit named structured logs in `{domain}.{action}_{state}` style and never log file contents, paths beyond what policy allows, or secrets.

NFR6 (Privacy / secrets): The Viewer reads arbitrary files from the Run checkout, which can contain `.env`, keys, or tokens; v1 ships **without** redaction or a denylist. Accepted for trusted internal users; recorded; revisit per PRD §8.4.

NFR7 (Accessibility): The diff must not rely on color alone — each changed line carries a `+`/`-` gutter marker (WCAG 1.4.1); `M`/`A`/`D` badges are letter-carried; Changes list, commit-history graph, and viewer are keyboard-operable; diff markers ≥ 4.5:1; commit-graph lanes ≥ 3:1 non-text. Layout must reflow/zoom without loss (tested at 320px / 400%); specific stack/unified behavior is a build `[ASSUMPTION]`. PRD cites `../ux-designs/ux-Archon-source-control-2026-08-31/EXPERIENCE.md` (Accessibility Floor).

NFR8 (Auth, from PRD assumptions §9): Access is any user who can view the run (open admin/member, single-tenant multi-user); no new per-tab restriction. Architecture later pins this to the artifacts / run-detail gate (no `requireWebUser`, no per-run owner ACL).

**Total NFRs: 8** (numbered here for traceability; unnumbered in the PRD)

### Additional Requirements

- Non-goals: not an IDE; no write/commit/edit; no poll; no Explorer of unchanged files; no `M` snapshot mode; events never author the change list; no container-backend Source Control in v1; no secret redaction in v1.
- Addendum: live git SoT; D5 container gate before git; `working_path` pin; `execFileAsync` / `@archon/git`; `ls-tree -z` + `cat-file blob` (never `oid:path`); `--literal-pathspecs`; `parents[]` on log; viewer thresholds; FR-9 run-end trigger, wire format undecided; no new process.
- Open questions (PRD §8): host existence `stat` never done in planning; FR-9 wire format; large-file/hex thresholds tunable at build; secret-handling revisit trigger.
- Rollout: no feature flag in v1 `[ASSUMPTION]`.
- Integration: `GET /api/workflows/runs/{runId}` already exposes `working_path`; new git API does not exist today.

### PRD Completeness Assessment

PRD is `status: final`, FR-1–FR-9 are stable and testable, MVP vs fast-follow is explicit (FR-9 out of MVP). NFRs are present but unnumbered. Accessibility NFR still points at the **excluded** 2026-08-31 EXPERIENCE.md. Addendum carries the git/API contract the PRD defers. Sufficient for implementation if architecture + epics remain the execution authority for copy, CAP-6 envelope, and v1 FR-9 seam.

## Epic Coverage Validation

### Epic FR Coverage Extracted

FR1: Epic 1 (tab + Changes) and Epic 2 (History + lane graph)
FR2: Epic 1
FR3: Epic 1 (Now) and Epic 2 (per-commit)
FR4: Epic 1 (Now viewer + commit-scope types on the wire) and Epic 2 (commit viewer)
FR5: Epic 1
FR6: Epic 2
FR7: Epic 1 (and Story 2.2 for commit refs)
FR8: Epic 1 (and Story 2.1 for “No commits yet”)
FR9: Epic 3 (seam only; no snapshot write in v1)

Total FRs in epics: 9

### Coverage Matrix

| FR Number | PRD Requirement                                                                                   | Epic Coverage                                                                                                    | Status                                      |
| --------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| FR-1      | Source Control tab; Changes above commit-history graph; both regions from checkout; Empty on FR-8 | Epic 1 Story 1.1 (tab + Changes); Epic 2 Story 2.1 (History inserted). Epic 1 must not ship a dead History pane. | ✓ Covered (sequential; full FR-1 after 2.1) |
| FR-2      | Manual Reload; no poll; stale “changed — Reload”; never mutate open view                          | Story 1.1; Story 2.2 restates Reload/stale                                                                       | ✓ Covered                                   |
| FR-3      | M/A/D lists for Now and per commit; projections                                                   | Stories 1.1 (Now), 2.2 (commit)                                                                                  | ✓ Covered                                   |
| FR-4      | Status-keyed viewer; Now HEAD→worktree; commit parent→commit; M diff-only                         | Stories 1.2 (Now), 2.2 (commit, same component)                                                                  | ✓ Covered                                   |
| FR-5      | Every file opens; large stream; binary not dumped as text                                         | Stories 1.2 (NUL not dumped), 1.3 (thresholds, images, hex)                                                      | ✓ Covered                                   |
| FR-6      | Inspect any run-branch commit including not-on-base; lane graph; parents[]                        | Stories 2.1 (graph + spike), 2.2 (files/diffs)                                                                   | ✓ Covered                                   |
| FR-7      | Server-resolved runId; no client working_path; realpath; read-only                                | Stories 1.1, 1.2, 2.2                                                                                            | ✓ Covered                                   |
| FR-8      | Empty when no readable checkout; container Empty; existence at read time                          | Story 1.1 (CAP-6 + CTA split); Story 2.1 (No commits yet; log CAP-6)                                             | ✓ Covered                                   |
| FR-9      | Durable snapshot at run-end under output_root `[fast-follow]`; out of MVP §6.2                    | Story 3.1 seam only (no write). Matches PRD §6.2 + architecture AD-8.                                            | ✓ Covered (v1 slice)                        |

### Missing Requirements

None for v1. FR-9 **write** is out of MVP by PRD; epics implement the required hook only.

Epics add architecture-sourced constraints not numbered in the PRD (NULL `isolation_env_id` is not CAP-6; HTTP 200 + `emptyReason`; hunk JSON `ref: "live"`; 30/70 split). Those are not extra FRs and are not coverage gaps.

### Coverage Statistics

- Total PRD FRs: 9
- FRs covered in epics: 9
- Coverage percentage: 100% (FR-9 at v1 seam depth)

### Reconciliation (not defects)

- **FR-1 both regions vs Epic 1 Changes-only:** PRD consequence “populates both regions” is a product outcome. Epics deliver it across 1.1+2.1 so History is not a dead pane. Normative product requirement is satisfied by the epic _set_; Epic 1 alone is an incremental first runnable. Not mutually exclusive.
- **FR-9 full snapshot vs Epic 3 no-op write:** PRD §6.2 and AD-8 bind v1 to seam-only. Same outcome.

## UX Alignment Assessment

### UX Document Status

**Not found** for the locked 2026-09-05 UX workspace (no DESIGN.md / EXPERIENCE.md). A mockup HTML exists at `ux-designs/ux-Archon-source-control-2026-09-05/mockups/key-screen-source-control-2026-09-05.html`. The 2026-08-31 DESIGN/EXPERIENCE pair exists but was **excluded**.

UI is implied (fourth tab on the legacy run screen). UX-DRs in epics were taken from architecture AD-5 / AD-6 / AD-9 and `viewer-rules.md`.

### Alignment Issues

- PRD Accessibility NFR and architecture AD-9 cite `ux-Archon-source-control-2026-08-31/EXPERIENCE.md` (Accessibility Floor / Voice and Tone). That file is outside this assessment set. **Copy and a11y floors that shipped into epics** (quiet CAP-6 sentence, “Changed on disk — Reload”, `+`/`-`, 30/70, 900px stack) are restated in AD-5/AD-6/AD-9 and stories — one implementation can satisfy PRD + architecture without opening the excluded UX folder.
- PRD UJ-1 shows Changes **and** the commit-history graph on first open. Architecture AD-9 + epics party lock: Epic 1 is Changes-only. Same sequential-delivery reconciliation as FR-1; not a normative conflict.
- Architecture Stack pins `react-diff-view@3.3.3`; PRD/addendum do not name the library. Compatible (architecture may specify).

### Warnings

1. **Missing UX spines (2026-09-05).** Do not treat as a coverage hole for FRs: viewer-rules + AD-5/9 + UX-DR1–9 in epics are the implementable contract. Restore DESIGN/EXPERIENCE only if you want a second copy source.
2. **PRD still points at excluded EXPERIENCE.md.** Implementers should follow AD-9 binding floor + story ACs, not reopen 2026-08-31 unless the lock changes.
3. PRD a11y mentions 320px / 400% zoom; epics specify 900px stack, not 320px. Architecture AD-5 uses 900px. Treat 320px as a PRD `[ASSUMPTION]` unless a story is added. **Warning, not a counted conflict** (ambiguous vs mutually exclusive).

## Epic Quality Review

### Epic structure

| Epic                                   | User-centric?                                 | Stands alone?             |
| -------------------------------------- | --------------------------------------------- | ------------------------- |
| 1 Inspect this run's live changes      | Yes — operator answers “what is uncommitted?” | Yes                       |
| 2 Inspect this run's commit history    | Yes — lane graph + commit files               | Yes, on Epic 1            |
| 3 Keep a seam for durable git evidence | Weak — no operator-visible snapshot in v1     | Yes; does not need Epic 2 |

### Story dependencies

1.1 → 1.2 → 1.3 → 2.1 → 2.2. No story requires a later story to complete. Story 2.1 ACs state it does not require opening commit files. Story 1.2 requires reusable list/viewer, not Epic 2.

Brownfield: no starter template; no tables; git helpers appear when first needed (`changedFiles` 1.1, `fileDiff`/`fileAt` 1.2, `log` 2.1).

### Best-practices checklist

Epic 1: user value ✓ independent ✓ stories sized ✓ no forward deps ✓ ACs Given/When/Then ✓ FR tags ✓
Epic 2: user value ✓ independent of Epic 3 ✓ 2.1 size risk (spike-then-ship) ✓
Epic 3: technical seam ⚠ ACs testable ✓ no forward wait ✓

### Quality findings by severity

#### Critical

None.

#### Major

None that block implementation. FR coverage is complete at the v1 slice.

#### Minor

1. **Epic 3 is a technical milestone** (injection hook, no-op write). It exists because AD-8 forbids inventing a writer later without a seam. Keep it; do not pretend it is an operator feature.
2. **Story 2.1** is spike + shipping the lane graph in one session. Previously accepted. If it blows the session, split spike vs ship _without_ introducing a plain-list fallback.
3. Story 1.1 AC mentions “until Story 1.2” for layout. Completable alone; wording is sequential documentation, not a forward wait.

## Summary and Recommendations

### Overall Readiness Status

**READY**

### Critical Issues Requiring Immediate Action

None. Do not block Phase 4 on the missing 2026-09-05 UX spines or on Epic 3 being a seam.

### Recommended Next Steps

1. Run **Sprint Planning** (`bmad-sprint-planning`) in a **fresh context window**, using `epics-source-control/epics.md`. Prefix story keys `source-control-` so they do not collide with Commander `3.x` in a shared sprint-status file.
2. Implementers: treat **AD-9 copy floor + story ACs + `viewer-rules.md`** as the UX contract; do not reopen excluded `ux-Archon-source-control-2026-08-31` unless product asks.
3. At build: confirm host existence check (PRD §8.1); tune large-file/hex defaults; leave FR-9 wire format undecided until a writer story exists.

### Final Note

This assessment identified **0 critical issues**, **0 major coverage gaps**, and **3 minor/warning notes** (missing UX spines, PRD cite of excluded EXPERIENCE.md, Epic 3/2.1 size). You may proceed to implementation as-is. Findings can also be used to restore UX 2026-09-05 DESIGN/EXPERIENCE later without changing the epic cut.
