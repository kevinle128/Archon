---
type: sprint-change-proposal
date: 2026-09-16
project: Archon
trigger: implementation-readiness-report-2026-09-16 (NOT_READY, 11 issues)
assessmentTarget: spec-agent-node-room
mode: batch-apply (owner chose "apply all, review once")
status: applied-pending-review
appliedEdits:
  - _bmad-output/planning-artifacts/epics-agent-node-room/epics.md
  - _bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md
---

# Sprint Change Proposal — Agent Node Room readiness remediation

## 1. Issue summary

The 2026-09-16 implementation-readiness assessment returned **NOT_READY** with 3 critical, 6 major, and 2 minor issues.
Root cause is **not** a project defect. It is a **wrong-baseline assessment**: the run graded the Agent Node Room epics against the **Workflow Commander PRD** (`prd.md`, FR-7…FR-10 = provider bindings, CLI JSON, signed events), a different product slice.

**Evidence.** The report frontmatter sets `assessmentTarget: spec-agent-node-room` but loads `prd.md`. The epics frontmatter names `spec-agent-node-room/SPEC.md` as its requirements source, and that SPEC declares CAP-1…CAP-13 that map one-to-one onto the epic's FR1…FR13 (`SPEC.md:48-80`). Verified directly.

Consequence: once the baseline is corrected to the SPEC, the report's headline (0% coverage, 4 missing FRs) dissolves — those FRs were never in Agent Node Room scope — and coverage is 13/13.

## 2. Impact analysis

- **Epic impact:** One epic (Epic 1). Completable as planned. No epic added, removed, resequenced, or redefined.
- **Story impact:** Two stories edited (1.6 sequencing, 1.1 clarity + safety); three stories gain acceptance criteria (1.1, 1.12c); no story removed.
- **Artifact conflicts:** three stale sentences in `epics.md` / `EXPERIENCE.md` disagreed with dated owner decisions in `SPEC.md` / `DESIGN.md`. Aligned toward the ratified sources (the documented oracles), not the other way.
- **Technical impact:** none. Brownfield, existing seams. No database, migration, CI, or infra change.

## 3. Recommended approach

**Option 1 — Direct Adjustment** (modify existing stories/docs in place). Effort Low–Medium, Risk Low.
Rollback and MVP-review are not applicable: nothing is built yet, and the MVP (v1 floor) is unchanged.

### Two owner-ratified decisions — KEPT (audit brought no new data)

Per the review rules, a verified/ratified decision is not reversed on an audit's abstract concern alone. Both audit "decisions" were already made and documented verbatim:

- **EQ-4 (hybrid stories 1.7a/1.7b/1.8):** ratified 2026-09-15, documented at `epics.md:291`. Matches the report's own Option 2 (explicit process exception). **Kept.** Addressed only the sizing sub-point (EQ-5) — see edit F1.
- **EQ-8 (Epic-1 v1 completion floor):** ratified 2026-09-15, documented at `epics.md:34` and `:551`. Matches the report's own Option 1. **Kept.** Added a coverage-boundary note only — see edit F2.

## 4. Detailed change proposals (APPLIED)

All edits below are applied to the working tree, pending this review. All align a stale artifact to a dated ratified source; none reverses a decision of the owner.

| #   | File · anchor                                       | Change                                                                                                                                                                       | Resolves                                               |
| --- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| B1  | `epics.md` FR3 inventory + `EXPERIENCE.md:121-122`  | Todo checklist is **pinned-strip only, never inline** (was "once, anchored at the last todo call")                                                                           | EQ-3 → `SPEC.md:64`, Story 1.4, AD-12                  |
| B2  | `EXPERIENCE.md:236,254`                             | Tool row **clears 24px via padding** (was "falls 2px short")                                                                                                                 | UX-1 / EQ-11 → `DESIGN.md:209,126`                     |
| B3  | `epics.md` UX-DR8                                   | Send control **bordered on both shells** (was "Legacy filled")                                                                                                               | EQ-7 → `DESIGN.md:332-334`                             |
| C1  | `epics.md` Story 1.6 → Story 1.9 + FR6 coverage row | **Moved the whole finished-iteration dock AC** out of read-half 1.6 into steering 1.9; 1.6 keeps only occurrence grouping + iteration selector; coverage row now `1.6 + 1.9` | EQ-2 → SPEC CAP-6 (dock needs the live registry queue) |
| E1  | `epics.md` Story 1.1                                | Operator-row recognition seam is a **web-side Zod schema + `safeParse` on untyped `metadata`** (no hand-written interface, no server-schema change)                          | EQ-6 → strict-TS + `z.infer`-only convention           |
| D1  | `epics.md` Story 1.1 (new AC)                       | **Malformed/adversarial payloads degrade without throwing**, bounded algorithms terminate — table-driven                                                                     | EQ-9 → AD-3 totality                                   |
| D2  | `epics.md` Story 1.12c (new AC)                     | **Two distinct authenticated identities**, assert receipt order + correct `operator_user_id` per row                                                                         | EQ-10                                                  |
| F1  | `epics.md:291`                                      | Explicit **internal task breakdown** for 1.7a/1.7b (sizing/rollback) without demoting the stories                                                                            | EQ-5                                                   |
| F2  | `epics.md` post-v1 section                          | Explicit **v1 coverage boundary**: CAP-1…11 full + CAP-12/13 floor only; G1–G4 excluded from v1 stats                                                                        | EQ-8 clarity                                           |

### Dissolved by the baseline correction (no edit needed)

- **EQ-1** (0% PRD traceability) and the four "missing FR-7…FR-10" findings: Workflow Commander requirements, out of Agent Node Room scope. Coverage against the correct SPEC baseline is 13/13.

## 5. Implementation handoff

**Scope classification: Moderate** (planning-artifact realignment; no code). Route to Product Owner / Developer for the readiness rerun.

### Action 1 (blocking) — fix the baseline so the rerun does not repeat the error

The readiness skill discovers the PRD via `{planning_artifacts}/*prd*.md` (`step-01-document-discovery.md:61`). The SPEC lives at `_bmad-output/specs/spec-agent-node-room/SPEC.md` — **outside** `planning-artifacts` — so it is never discovered, and `planning-artifacts/prd.md` (Workflow Commander) auto-wins **every** rerun. This is a durable hazard, not a one-off.

Choose one (owner decision — a repo-structure change, not applied here):

- **A (fast, this rerun only):** rerun the readiness assessment with the requirements baseline pointed explicitly at `spec-agent-node-room/SPEC.md` + its companion contracts; do not accept the auto-discovered `prd.md`.
- **B (durable):** relocate the Workflow Commander PRD out of the top-level discovery path (e.g. `planning-artifacts/workflow-commander/prd.md`) and give Agent Node Room its own discoverable requirements pointer in `planning-artifacts/`, so the readiness menu offers the correct baseline by default.

Recommendation: **A now to unblock, then B** to stop the recurrence.

### Action 2 — rerun the readiness assessment against the corrected artifact set

After Action 1, rerun `bmad-check-implementation-readiness`. Expected result: coverage 13/13, the three consistency contradictions resolved, the Story 1.6 forward dependency gone. Then implementation may begin (`bun run validate` remains the downstream gate).

### Success criteria

- Readiness rerun on the SPEC baseline returns READY (no critical, no unresolved forward dependency, no mutually exclusive contract).
- No residual "inline todo", "2px short", or "filled Legacy send control" wording anywhere in `epics.md` / `EXPERIENCE.md` (verified clean at authoring time).

## Unresolved questions

1. Action 1 durable fix (Option B) — do you want the Workflow Commander PRD relocated, or is the per-run explicit baseline (Option A) enough for now? (Repo-structure change; not applied.)
2. Rerun ownership — do you run the readiness rerun, or should it be delegated?
