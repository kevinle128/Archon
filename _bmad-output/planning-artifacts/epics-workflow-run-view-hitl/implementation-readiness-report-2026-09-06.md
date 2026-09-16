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
date: '2026-09-06'
project: Archon
track: workflow-run-view-hitl
includedDocuments:
  - ../../specs/spec-workflow-run-view-hitl/SPEC.md
  - ../../specs/spec-workflow-run-view-hitl/hitl-contract.md
  - ../../specs/spec-workflow-run-view-hitl/brownfield.md
  - ../architecture/architecture-Archon-workflow-run-view-hitl-2026-09-05/ARCHITECTURE-SPINE.md
  - epics.md
---

# Implementation Readiness Assessment Report

**Date:** 2026-09-06
**Project:** Archon — Workflow Run View HITL

## Document Discovery

Inventory only (contents not assessed in this step). Multiple product tracks exist under `{planning_artifacts}`; this run is for **Workflow Run View HITL**, not Source Control or Workflow Commander.

### PRD Files Found

**Whole Documents:**

- `prd.md` (9502 bytes, 2026-07-30) — generic / other track
- `prds/prd-source-control/prd.md` (20947 bytes, 2026-09-04) — Source Control

**Sharded Documents:**

- none (`*prd*/index.md` not found)

**Outside `{planning_artifacts}` (HITL requirements kernel):**

- `../specs/spec-workflow-run-view-hitl/SPEC.md` (6919 bytes, 2026-09-05)
- `../specs/spec-workflow-run-view-hitl/hitl-contract.md` (2248 bytes, 2026-09-05)
- `../specs/spec-workflow-run-view-hitl/brownfield.md` (2083 bytes, 2026-09-05)

⚠️ **WARNING:** No HITL `PRD.md`. SPEC.md was the FR source for epics.

### Architecture Files Found

**Whole Documents:**

- `architecture.md` (16984 bytes, 2026-07-22) — older / other track
- `prds/prd-source-control/architecture.md` (11458 bytes, 2026-09-04) — Source Control

**Folded spines (not `index.md` shards):**

- `architecture/architecture-Archon-workflow-run-view-hitl-2026-09-05/ARCHITECTURE-SPINE.md` (18825 bytes, 2026-09-05) — HITL
- `architecture/architecture-Archon-source-control-2026-09-05/ARCHITECTURE-SPINE.md` (12113 bytes, 2026-09-05) — Source Control

### Epics & Stories Files Found

**Whole Documents:**

- `epics.md` (41450 bytes, 2026-07-30) — Workflow Commander (Epic 3)
- `epics-source-control/epics.md` (26809 bytes, 2026-09-06) — Source Control (Epics 1, 2, 4)
- `epics-workflow-run-view-hitl/epics.md` (38826 bytes, 2026-09-06) — HITL (Epics 5–6)

**Sharded Documents:**

- none

### UX Design Files Found

**Whole Documents:**

- `ux.md` (2174 bytes, 2026-07-12) — older / other track

**bmad-ux spine pair:**

- `ux-designs/ux-Archon-source-control-2026-08-31/DESIGN.md` + `EXPERIENCE.md` (2026-09-04) — Source Control

**Other:**

- `ux-designs/ux-Archon-source-control-2026-09-05/mockups/` — Source Control mockup (no DESIGN/EXPERIENCE pair in this inventory)

⚠️ **WARNING:** No HITL `DESIGN.md` + `EXPERIENCE.md`. Epics extracted UX-DRs from SPEC + architecture conventions.

### Proposed assessment set (HITL)

- Requirements: `../specs/spec-workflow-run-view-hitl/SPEC.md` + `hitl-contract.md` + `brownfield.md`
- Architecture: `architecture/architecture-Archon-workflow-run-view-hitl-2026-09-05/ARCHITECTURE-SPINE.md`
- Epics: `epics-workflow-run-view-hitl/epics.md`
- UX: none (UX-DRs inside the epics file)

### Excluded as other tracks

- Source Control PRD / architecture / UX / `epics-source-control`
- Generic `prd.md`, `architecture.md`, `ux.md`, `epics.md` (Workflow Commander)

User confirmed this set on 2026-09-06 (`C`).

## PRD Analysis

There is no `PRD.md` for this feature. Requirements were extracted in full from `SPEC.md` (capabilities + constraints + non-goals), `hitl-contract.md` (wire catalog), and `brownfield.md` (seams that stories must not ignore). CAP IDs are mapped to FR1–FR7 to match `epics-workflow-run-view-hitl/epics.md`.

### Functional Requirements

FR1 (CAP-1): An operator can inspect a live or historical run as a node-centric graph and as an unmerged chronological list of node-runs, each as an entry into the same node room. Success: Clicking a graph node or a Logs row opens that node's room; a loop or `route_loop` iteration appears as its own row; the Logs view is not a merged all-nodes stream; both legacy and console keep this list (graph is additional, not a replacement).

FR2 (CAP-2): An operator can open a per-type panel for the selected node and see that node's own history after it finishes, not only while it streams. Success: `command`/`prompt`/`loop` show an agent room (prose + tool cards); `bash`/`script` show stdout; `approval`/`plannotator_gate` show the declared gate; `workflow` links the child run; `route_loop`/`loop_group` show controller/container chrome; a completed agent node replays the same room as a static transcript.

FR3 (CAP-3): An operator can follow a chat-style timeline of their turns plus node-status entries, and see an Ask card inline in the agent room when the agent asks. Success: Clicking a node-status entry opens that node's room without switching the meaning of the panel; the Ask card appears in the room at the tool invocation, not as free-text in the composer.

FR4 (CAP-4): An in-flight agent node can pose structured questions to the run starter mid-turn, and the starter can submit one complete answer set or decline. Success: A card with one or more questions (single-select, multi-select, Other requiring non-empty text) accepts exactly one POST; Submit stays disabled until every question is valid; Decline delivers a declined payload and the agent decides the node outcome; the node then continues with that payload.

FR5 (CAP-5): Several asks can be outstanding at once without inventing a second scheduler. Success: Two agent nodes (or two asks on one node) show independent cards; a node stays awaiting until every ask on that node is resolved; run-level "awaiting input" clears only when the last pending interaction in the run is resolved; in-flight siblings may finish their current turn; the next DAG layer does not start until the run resumes.

FR6 (CAP-6): Only the identity that started the run can answer; everyone else can watch. Success: A teammate view shows factual "waiting for <starter>" copy with no Submit/Decline; a starter-less run never reaches an unanswerable awaiting state (fail when an Ask would be persisted, not at the start of every identity-less CLI run). First answer wins; already resolved → 409. Only `workflow_runs.user_id` may mutate.

FR7 (CAP-7): A workflow that requires AskHuman on a provider that cannot ask fails before spending a turn; other runs on those providers still start. Success: `allowed_tools` naming AskHuman on Codex/Grok/OpenCode/Copilot is rejected at run start with error chrome; the same workflow without that requirement starts and simply has no Ask tool; only Claude and Pi produce Ask in v1.

FR8: Ship both legacy `WorkflowExecution` and `/console`. Engine and contract are surface-agnostic; each surface is a thin renderer of the same envelope, states, validity, and copy — not a shared React NodePanel.

FR9: Permission is envelope/type-contract only (`kind: permission`, `call_id` ≡ `tool_use_id`, confirm `{ intent }`); variant cards wait for a live activation source. POST `/api/workflows/runs/:runId/permissions/:callId/confirm` body `{ intent: string }`.

FR10: Child-run Ask: pending rows live on the child run (architecture + brownfield child-paused behavior); operator answers the child, not the parent. (Stated as CAP-adjacent in architecture; included here because SPEC success signal is surface-agnostic and brownfield/spine bind child-run pause.)

FR11: Wire contract — one `pending_interaction` for Ask and Permission (`kind` `ask|permission`, `status` `pending|answered|purged`, `tool_use_id` unique per run = Ask `request_id` = Permission `call_id`, `node_id`, `provider_session_id`, envelope without answer, nullable answer). Cards are this row embedded on `GET /api/workflows/runs/:runId` as `pending_interactions`. They are not transcript `status` rows and not SSE payloads. SSE `node_awaiting` / `interaction_resolved` are refetch triggers. Ask `envelope.questions[]` ordered: `id`, `prompt`, `selection` `single|multi`, `options`, `allowOther`; Other selected ⇒ `value` non-empty. POST `/api/workflows/runs/:runId/ask/:requestId/answer` with `{ answers: { questionId, value }[] }` or `{ decline: true }`. GET `/api/workflows/runs/:runId` returns `pending_interactions[]` and `nodeStates[].status` including `awaiting`. GET `/api/workflows/runs/:runId/nodes/:nodeId/messages` returns agent-room transcript (`text` / `tool` / `status` notes) ordered by `seq`.

FR12: AskHuman tool invocation is the only ask channel. Never classify assistant prose as an ask. A model that asks in prose is an accepted residual. Do not wrap Claude `AskUserQuestion`. Console Reply/composer is not HITL.

Total FRs: 12

### Non-Functional Requirements

NFR1 (Language): No workflow YAML authoring-language changes.

NFR2 (Lifecycle): Wait indefinitely at an Ask — no timeout, no auto-default, no autonomous lifecycle mutation of non-terminal work.

NFR3 (Data): Additive-only schema, both SQLite and Postgres. `awaiting` is a node/UI state, not a new run status. Declared gates keep `ApprovalContext`; AskHuman never occupies that slot.

NFR4 (Console isolation): Console isolation stands except the one sanctioned `packages/web/src/lib/run-graph/` import. Type-only `api.generated.d.ts` is allowed.

NFR5 (Usability / tone): Awaiting chrome is warning / "waiting on you", never error. CAP-7 start rejection is the error state.

NFR6 (Scope / compatibility): No new deploy, env, or infra topology. `NativeTool.handler` stays `Promise<string>`. No CLI / chat / `manage_run` answer UX in v1. No Source Control viewer in the node room. No per-node independent scheduling. No general cyclic graph execution.

NFR7 (SDK lock / assumption): Claude lockfile `0.3.209` and Pi `session.agent.continue()` at `0.80.6` hold until the AD-6 spikes amend the spine. v1 in-process ask channel exists only on Claude and Pi (`capabilities.askHuman`).

NFR8 (Reliability / brownfield SSE): SSE buffer is short (500 events / 60s). Ask cards must survive refetch from `pending_interactions` on GET run, not from the stream.

NFR9 (Brownfield pause): Run status remains `pending|running|completed|failed|cancelled|paused` (no `awaiting` run status). Ask pause must not write `metadata.approval`. `pauseWorkflowRun` must allow optional `ApprovalContext`. In-flight siblings keep streaming when paused; next DAG layer does not start.

NFR10 (Brownfield tools): `nativeTools` is chat-orchestrator today; AskHuman must not be injected that way. Wrappers must reject `AskHumanAwaitingError` instead of stringifying it. Converters must accept `questions[]` objects.

Total NFRs: 10

### Additional Requirements

- Architecture ADs AD-1–AD-9 bind implementation; do not re-decide them in stories.
- Non-goals (must not be implemented as if they were FRs): Permission variant cards + live activation source; per-node independent scheduling; CLI/chat/`manage_run` answer UX; changing `NativeTool.handler` return type; new infra; Source Control viewer in the room; treating console Reply as a second ask channel.
- Brownfield: Legacy `WorkflowExecution.tsx` rebuilds node status from events and must stop being a second projector. Console HITL today is the free-text composer.
- Pi `sendQuery` ends in `session.dispose()`; resume is unproven across dispose/reopen.
- SPEC assumption: original spec files were missing on disk at derive; CAP IDs restored then aligned to the spine.
- Success signal: On a Claude or Pi agent node, the starter sees amber "awaiting input," answers or declines a structured Ask card in the node room on both legacy and console, the node continues with that payload, and a teammate watching the same run cannot submit. A Codex run that does not name AskHuman in `allowed_tools` still starts. A Codex run that does name it is rejected at start.

### PRD Completeness Assessment

The SPEC + companions are a complete WHAT contract for this feature: seven numbered capabilities, explicit constraints, non-goals, success signal, and a wire catalog. Gaps that are not defects: (1) no PRD.md wrapper; (2) no bmad-ux DESIGN/EXPERIENCE pair (UX is constraints + later UX-DRs in epics); (3) FR10 child-run Ask is spine/brownfield-normative rather than a numbered CAP — it is still a product requirement and is inventoried so epic coverage can check it. Clarity is high; CAP IDs are stable. Do not treat architecture HOW as missing PRD content.

## Epic Coverage Validation

### Epic FR Coverage Extracted

FR1: Epic 5 — Stories 5.1, 5.3, 5.5
FR2: Epic 5 — Stories 5.1, 5.2, 5.5
FR3: Epic 5 Stories 5.4, 5.5 (timeline) and Epic 6 Stories 6.5, 6.6 (Ask card)
FR4: Epic 6 — Stories 6.2, 6.3, 6.5
FR5: Epic 6 — Story 6.4
FR6: Epic 6 — Stories 6.2, 6.3, 6.5
FR7: Epic 6 — Stories 6.2, 6.5, 6.6
FR8: Epic 5 Stories 5.2, 5.5 and Epic 6 Stories 6.5, 6.6
FR9: Epic 6 — Story 6.7
FR10: Epic 6 — Story 6.4
FR11: Epic 5 Story 5.1 and Epic 6 Stories 6.2, 6.3, 6.7
FR12: Epic 6 — Stories 6.2, 6.5, 6.6
Total FRs in epics: 12

### Coverage Matrix

| FR Number | PRD Requirement                                                  | Epic Coverage      | Status    |
| --------- | ---------------------------------------------------------------- | ------------------ | --------- |
| FR1       | Graph + unmerged Logs; both doors; iteration rows; both surfaces | 5.1, 5.3, 5.5      | ✓ Covered |
| FR2       | Per-type panel + completed agent replay                          | 5.1, 5.2, 5.5      | ✓ Covered |
| FR3       | Chat timeline click + Ask card inline                            | 5.4, 5.5, 6.5, 6.6 | ✓ Covered |
| FR4       | Structured Ask POST / decline / continue                         | 6.2, 6.3, 6.5      | ✓ Covered |
| FR5       | Concurrent asks; last-clears; siblings                           | 6.4                | ✓ Covered |
| FR6       | Starter-only; teammate; fail at persist; 409                     | 6.2, 6.3, 6.5      | ✓ Covered |
| FR7       | `allowed_tools` AskHuman reject; others start                    | 6.2, 6.5, 6.6      | ✓ Covered |
| FR8       | Both surfaces; no shared React NodePanel                         | 5.2, 5.5, 6.5, 6.6 | ✓ Covered |
| FR9       | Permission envelope POST only                                    | 6.7                | ✓ Covered |
| FR10      | Child-run Ask on child `run_id`                                  | 6.4                | ✓ Covered |
| FR11      | GET embed / messages GET / split POSTs / SSE refetch             | 5.1, 6.2, 6.3, 6.7 | ✓ Covered |
| FR12      | AskHuman only ask channel                                        | 6.2, 6.5, 6.6      | ✓ Covered |

### Missing Requirements

None. No PRD FRs uncovered. No epic FRs that are absent from the SPEC inventory (FR10 is spine-normative and was added to the PRD inventory in step 2 for this reason).

### Coverage Statistics

- Total PRD FRs: 12
- FRs covered in epics: 12
- Coverage percentage: 100%

## UX Alignment Assessment

### UX Document Status

**Not found** for this feature. Inventory found `ux.md` and `ux-designs/ux-Archon-source-control-2026-08-31/` DESIGN.md + EXPERIENCE.md; those belong to Source Control and were excluded in step 1. No HITL `DESIGN.md` / `EXPERIENCE.md`. SPEC `ux-design.md` / mockup were not on disk at epic extraction.

### Alignment Issues

Not a UX↔PRD document conflict: there is no HITL UX spine to contradict SPEC. Architecture AD-4 (`run-graph`), AD-7 (cards from pending, not SSE), AD-8 (awaiting warning chrome), AD-9 (composer is not HITL), and SPEC constraints (dual surface, Logs retained, taxonomy chrome) are the UX contract. Epics encode that as UX-DR1–UX-DR8. A+ party decision (no empty Ask seat in Epic 5) is compatible with SPEC (card appears when the agent asks, not as a reserved hole).

### Warnings

- **W-UX1:** User-facing UI is implied (legacy `WorkflowExecution` and `/console`) but there is no bmad-ux spine pair. Visual tokens, spacing, and graph shell polish will be decided at implementation against the existing Archon design system (`packages/web/src/index.css` / brand guide) — not against a missing mockup. This is a warning, not a missing FR: SPEC + UX-DRs are specific enough for stories. Do not import Source Control UX as a substitute.
- **W-UX2:** SPEC assumption records that original UX files were missing at derive. If mockups return, they must be reconciled to UX-DRs / ADs rather than silently replacing them.

## Epic Quality Review

Applied create-epics-and-stories standards. Numbering is Epic 5 then Epic 6 (tracker collision avoidance), not 1 then 2.

### Epic structure

| Check                 | Epic 5 Inspect a run as nodes            | Epic 6 Answer an agent mid-turn                  |
| --------------------- | ---------------------------------------- | ------------------------------------------------ |
| User-centric title    | ✓ Operator inspects                      | ✓ Starter answers                                |
| User outcome alone    | ✓ Transcript/Logs/graph without Ask (A+) | ✓ Needs Epic 5 rooms; does not need a later epic |
| Not a technical layer | ✓                                        | ✓ except Story 6.1 (see major)                   |

Independence: Epic 5 does not require Epic 6. Epic 6 stories 6.1–6.4 are engine/API and could run against Epic 5’s GET/projector; 6.5–6.6 require Epic 5 shells. No Epic 6 → Epic 5 reverse dependency.

### Story dependencies (within epic)

- 5.1 completable alone. “Graph waits for 5.3” excludes graph from 5.1; it does not wait on 5.3.
- 5.2–5.5 each use only earlier 5.x output.
- 6.2 does not require 6.1 (persist without continue).
- 6.3 continue is gated on **previous** 6.1.
- 6.4–6.7 use only earlier 6.x (and Epic 5 for UI stories).

**No forward implementation dependencies.** 6.1’s AC that names 6.3 is a documentation gate on a later story (minor).

### Database timing

- ✓ `remote_agent_workflow_node_messages` created in 5.1 (first need).
- ✓ `remote_agent_pending_interactions` created in 6.2 (first need).
- ✓ `resolvePendingInteraction` belongs to 6.3.

### Starter template / greenfield

Architecture is brownfield ports-and-adapters. No starter-template story required. Integration points are present (pause without `metadata.approval`, console isolation, projector replacing event rebuild).

### Best-practices checklist

Epic 5: user value ✓ · independent ✓ · no forward deps ✓ · tables when needed ✓ · GWT ACs ✓ · FR tags ✓. Sizing: 5.5 is a full-surface parity story (large but one contract).

Epic 6: user value ✓ · independent of a later epic ✓ · tables when needed ✓ · GWT ACs ✓ · FR tags ✓.

### Findings by severity

#### Critical violations

None.

#### Major issues

**Q1 — Story 6.1 is a spike, not a user-facing slice.** Title is operator-framed; ACs are SDK experiments. create-epics forbids technical milestones. **Remediation:** Keep as an explicit AD-6 gate (already labeled spike exception) and do not start 6.3 continue until 6.1 writes an amend-or-confirm into the spine. Do not invent a fake user journey for the spike.

**Q2 — Story 6.2 is large for a single dev agent** (schema + optional pause + AskHuman inject + converters + capability matrix + CAP-7 + GET embed). **Remediation:** At `bmad-create-story` time, split into (a) table/schema/pause, (b) AskHuman inject + branded error, (c) CAP-7 — without changing FR coverage. Not a coverage defect.

#### Minor concerns

**Q3 — 6.1 AC names future Story 6.3.** Harmless documentation; the real gate is on 6.3.

**Q4 — Story 6.7 sits after UI stories** though it has no UI. Order is valid (no forward dep). Could have been 6.3-adjacent.

**Q5 — File churn** on `WorkflowExecution.tsx` and `/console` across Epic 5 and 6.5/6.6. Justified (AD-6 wall + A+). Already recorded in the epics validation section.

## Summary and Recommendations

### Overall Readiness Status

**READY** (proceed to Phase 4). Non-blocking: missing HITL UX spine (warning), Story 6.1 spike exception, Story 6.2 may be split at story-file time.

### Critical Issues Requiring Immediate Action

None. FR coverage is 12/12. No mutually exclusive document conflicts. Architecture ADs are adopted and stories bind them.

### Recommended Next Steps

1. Run **Sprint Planning** (`bmad-sprint-planning`) in a **fresh context** and add Epic 5–6 to the shared `sprint-status.yaml` (do not reuse story keys 1.x–4.x).
2. Create **Story 5.1** via `bmad-create-story` (do not start at 6.1).
3. If 6.2 is too large at implementation, split the story file as in Q2; do not reopen CAP-7 or ADs.
4. Optional: restore HITL mockup later and reconcile to UX-DRs — not a gate.

### Final Note

This assessment identified **0 critical**, **2 major** (accepted exceptions), **2 UX warnings**, and **3 minor** notes. You may proceed as-is. Use this report to brief sprint planning; do not treat W-UX1 as a missing PRD.

**Assessor:** Implementation Readiness workflow (BMad Method)  
**Date:** 2026-09-06  
**Artifacts:** SPEC + hitl-contract + brownfield; ARCHITECTURE-SPINE 2026-09-05; epics-workflow-run-view-hitl/epics.md
