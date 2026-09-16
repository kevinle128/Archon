---
title: Sprint Change Proposal — Agent Node Room readiness remediation
date: '2026-09-15'
project: Archon
scope: spec-agent-node-room
trigger: implementation-readiness-report-2026-09-15.md (NOT READY)
status: applied
applied: 2026-09-15 (all batches A–D written to the artifacts below, in this session)
path_forward: Direct Adjustment
mode: incremental
owner: kevin
owner_decisions:
  - 'Floor = v1: steering v1 ships at interrupt + Queue + `sent`; `delivered` / claude soft-inject / grok hooks are post-v1 gated backlog (2026-09-15).'
  - 'Contrast: fix `--node-prompt` text to ≥ 4.5:1 with a token-derived color; overrides DESIGN.md own "accept and record" recommendation (2026-09-15).'
  - 'Delta 3 (queue full-bleed band): adopt into DESIGN.md (2026-09-15).'
artifacts_touched:
  - _bmad-output/specs/spec-agent-node-room/SPEC.md
  - _bmad-output/specs/spec-agent-node-room/steering-test-plan.md (new)
  - _bmad-output/specs/spec-agent-node-room/steering-api-contract.md (new)
  - _bmad-output/planning-artifacts/epics-agent-node-room/epics.md
  - _bmad-output/planning-artifacts/architecture/architecture-Archon-readable-agent-transcript-2026-09-12/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/architecture/architecture-Archon-live-agent-steering-2026-09-12/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md
  - _bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/DESIGN.md
  - claude-design/design_handoff_node_room_transcript_steering/README.md
---

# Sprint Change Proposal — Agent Node Room readiness remediation

## 1. Issue summary

The implementation-readiness assessment of the `spec-agent-node-room` bundle returned **NOT READY** on 2026-09-15.
Functional traceability is complete (100 %), but traceability alone does not make the steering half executable.

The problem is two-sided.
The **read half** (CAP-1…7, Stories 1.1–1.6) is close to implementation-ready and has strong contracts and tests.
The **steering half** (CAP-8…13, Stories 1.7–1.13) is not implementable as specified: it has no typed API contract, no test plan, and a terminal story (1.13) that combines independently gated work and cannot meet its own acceptance criteria.
Four confirmed internal document contradictions add to this.

The assessment recorded 17 items: 3 critical story-readiness blockers, 4 confirmed alignment defects, 7 major story-quality issues, and 3 warnings.

This change is a **planning-document correction**, discovered at a readiness gate.
No implementation code exists for this spec yet, so no code rolls back.
The Workflow Commander slice (Epic 3 / FR-WC-\*) is a separate product the report isolates; it is out of scope here and has no conflict with the Agent Node Room.

## 2. Impact analysis

### Epic impact

Epic 1 (Agent Node Room) is completed as planned for the read half and **restructured** for the steering half.
No new epic is created, none is removed, and the read-first sequence is unchanged.
The change type is: modify scope and acceptance criteria of existing stories, split three oversized stories, and move the delivery-confirmation floor to the story that first renders operator messages.

### Story impact

- Split Story 1.7 (oversized) into 1.7a and 1.7b.
- Add complete failure criteria to Story 1.8.
- Promote high-risk accessibility states from inventory to acceptance criteria in Stories 1.9 and 1.10.
- Move the `sent` floor into Story 1.11 and give it the operator display-name projection.
- Split Story 1.12 (three independent risk areas) into 1.12a, 1.12b, and 1.12c.
- Delete Story 1.13 and replace it with a post-v1 gated backlog (G1–G3) outside Epic 1's completion gate.

### Artifact conflicts

| Artifact                                                                             | Impact                                                                                                                                                              |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SPEC.md`                                                                            | Add the v1 release-gate paragraph; extend the cross-half dependency with the interrupted status row; annotate open questions to G1–G3; register two new companions. |
| Read architecture spine (`architecture-Archon-readable-agent-transcript-2026-09-12`) | Fix the Consistency-Conventions logging row to match AD-3.                                                                                                          |
| Steering architecture spine (`architecture-Archon-live-agent-steering-2026-09-12`)   | Add AD-12 (operator display-name read-time projection). AD-9 already contracts the sub-state projection; only a story owner was missing.                            |
| `EXPERIENCE.md`                                                                      | Reconcile output-missing glyph, stale delivery-confirmation examples, and connection-loss queue wording; fold the detached-run dock state (delta 4).                |
| `DESIGN.md`                                                                          | Resolve the `--node-prompt` contrast open question by brightening; fold the queue band (delta 3).                                                                   |
| Mockup handoff `README.md`                                                           | Correct the `interrupting`-as-projected drift; reconcile deltas 2–5.                                                                                                |
| New: `steering-test-plan.md`                                                         | The steering half had no test plan.                                                                                                                                 |
| New: `steering-api-contract.md`                                                      | The Send/Interrupt routes had no typed wire contract.                                                                                                               |

### Technical impact

No database migration and no schema change.
The operator display name is a read-time server projection, not a stored field, so AD-6's three-additive-field invariant holds.
The two new route contracts and the steering test plan gate implementation but add no runtime code by themselves.
`api.generated` regenerates for the operator display-name response field and for the sub-state projection field.

## 3. Recommended approach

**Direct Adjustment.**
Amend the SPEC, the epic breakdown, both architecture spines, and the two UX spines in place; add the two missing companion contracts; and restructure the steering stories.

- **Rollback** is not applicable: no code is shipped for this spec.
- **PRD MVP gut** is not needed: the MVP holds; only the steering release boundary needed an explicit line, now set by the owner (Floor = v1).
- **Effort:** Medium (document and plan work).
- **Risk:** Low (no code, no migration; reversible per artifact).

## 4. Detailed change proposals

Edits are grouped as presented and approved in four batches.
Each `OLD`/`NEW` pair is an exact text replacement; new companions are delivered as outlines that implementation authors.

### Batch A — the four confirmed contradictions (mechanical)

**A1 · read-spine logging contradicts AD-3** · `architecture-Archon-readable-agent-transcript-2026-09-12/ARCHITECTURE-SPINE.md` Consistency Conventions → Logging row

```
OLD  | Logging | Tool name and error message only. Never a payload, an input, or an output — they can carry user content. |
NEW  | Logging | Resolved family + tool-use id + error message only. Never the tool name (a Codex name is the whole shell command — AD-3), never a payload, input, or output. |
```

**A2 · output-missing forces glyph `–`** · `EXPERIENCE.md` State Patterns → Output missing row

```
OLD  | Output missing | Tool row | Glyph `–`, badge `output missing`; Raw shows what exists. |
NEW  | Output missing | Tool row | Glyph follows the outcome (a succeeded call keeps `✓`), badge `output missing`; Raw shows what exists. Output state never reaches the glyph (Status glyph row above; read-spine AD-13). |
```

**A3 · same fixed `–` in the failure walkthrough** · `EXPERIENCE.md` (result-never-arrives line)

```
OLD  Failure: a row's result never arrives → glyph `–`, badge `output missing`; Raw still shows the call. Nothing is fabricated.
NEW  Failure: a row's result never arrives → the glyph still follows the outcome (`–` only when the outcome itself is unknown), badge `output missing`; Raw still shows the call. Nothing is fabricated.
```

**A4 · stale "Only claude echoes today"** · `EXPERIENCE.md` (provider-returns-no-echo row)

```
OLD  …the interface does not know, and saying so at length would be its own kind of noise. Only claude echoes today.
NEW  …the interface does not know, and saying so at length would be its own kind of noise. No provider echoes at the current SDK pin (0.3.209); claude becomes the first once the SDK reaches ≥ 0.3.246 (CAP-13 / steering AD-8), so today every message stays `sent`.
```

**A5 · Flow says Claude flips to `delivered` today** · `EXPERIENCE.md` (walkthrough item 6)

```
OLD  …each badged `sent`. On Claude they flip to `delivered` a moment later; the run is on omp today, so they stay `sent` and the interface says nothing further.
NEW  …each badged `sent`. At the current SDK pin no provider echoes the stamped id, so they stay `sent` on every provider; once the claude SDK reaches ≥ 0.3.246 a claude run's messages flip to `delivered` a moment later (claude-only, post-bump — CAP-13 / AD-8).
```

**A6 · queue wording does not name which queue survives** · `EXPERIENCE.md` (connection-lost row)

```
OLD  | Connection lost with messages queued | Dock | The queue is browser state, so it survives the drop and is still there when the stream returns. It does not survive a tab close, which is why the box says `this tab only`… |
NEW  | Connection lost with messages queued | Dock | The pre-send draft is per-tab browser state — survives a stream drop, dies on tab close (`this tab only`). A message already sent rides the in-process registry queue on the server — survives a browser drop, dies on a server restart (steering AD-5). |
```

**A7 · DESIGN side of the glyph rule** · `DESIGN.md` (folded-todo glyph line)

```
OLD  …and the – glyph stays reserved for a genuinely unknown outcome or missing output.
NEW  …and the – glyph stays reserved for a genuinely unknown outcome — never for missing output, which is a badge (Components → Status glyph; read-spine AD-13).
```

_Optional (report step-7 reconciliation): strip the now-satisfied `[reframe consequence — confirm against EXPERIENCE.md]` tag at `control-states.md:50`; EXPERIENCE.md already made the correction._

### Batch B — architecture additions

**B1 · operator display-name path** — new AD appended to the steering spine (native numbering, +7 parenthetical):

```
### AD-12 — The operator display name is resolved at read time, server-side, and travels as row data

- Binds: CAP-4 (SPEC-agent-node-room CAP-11); the node-message read path; Track A/AD-1; AD-6.
- Prevents: (a) persisting a mutable display name as a 4th metadata field — breaks AD-6's three-field,
  no-migration invariant and denormalizes a value that changes; (b) a shell fetching a users endpoint —
  breaks Track A/AD-1's fetch-free core and the Console import ban (HITL/AD-4); (c) rendering a raw id —
  EXPERIENCE.md's Accessibility Floor forbids it.
- Rule: `operator_user_id` stays the ONLY identity on the stored row (AD-6, unchanged). The display name
  is resolved at READ time by the server that already serves node-message rows — a join on the canonical
  `users` row keyed by `operator_user_id` — and attached as a DERIVED, non-persisted field on the
  read-response schema (`operator_display_name: string | null`), NOT inside the `.strict()` metadata, so
  the three-field invariant and no-migration property hold. The rooms still read exactly ONE endpoint
  (HITL/AD-3 — the server enriches the row it already serves). The core consumes the field as data
  (no fetch). A join miss yields `null`; the core renders the short-id fallback. Regen `api.generated`.
```

Impl owner → Story 1.11.

**B2 · the second cross-half reader dependency** — append to SPEC `Cross-half dependency`:

```
**Second cross-half reader dependency — the interrupted status row.** CAP-9 makes `⚠ interrupted`
universal: the executor writes a separate `interrupted` status row on every provider at delivery, not
only through Claude's `PostToolUseFailure` hook. For that glyph to reach the row, the read half's
`deriveOutcome` (`agent-history.ts:120`) must fold that status row into the preceding tool call's
outcome — else `⚠` is unreachable on non-Claude providers even after the write lands. Like the operator
row, this is an internal ordering dependency: the reader's fold ships before the write half emits
cross-provider interrupted rows.
```

**B3 · sub-state projection ownership** — no architecture edit; steering AD-9 already contracts `generating | idle-after-interrupt` (and `interrupting` as UI-local, never projected). The missing story owner is assigned in Batch C (Story 1.7b).

### Batch C — epic restructure (`epics-agent-node-room/epics.md`)

Story map (read half 1.1–1.6 unchanged):

| Before                       | After                                                                                                                 | Report item   |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------- |
| 1.7 engine (oversized)       | 1.7a Live registry + per-provider interrupt contract · 1.7b Multi-turn loop + idle-await entry + sub-state projection | #5, #4, #8    |
| 1.8 routes                   | 1.8 routes + full failure criteria                                                                                    | #6            |
| 1.9 dock compose/Queue       | 1.9 + promoted a11y ACs                                                                                               | #10           |
| 1.10 interrupt/idle/Send-now | 1.10 + a11y ACs + interrupted-row reader fold                                                                         | #9, #10       |
| 1.11 operator row            | 1.11 + `sent` floor (from 1.13) + display-name projection                                                             | #1, #2, #9    |
| 1.12 (3 risks)               | 1.12a terminal reconcile · 1.12b idle-await safety · 1.12c concurrent-operator ordering                               | #7            |
| 1.13 deferred/gated          | DELETED → post-v1 gated backlog G1–G3, outside Epic 1's completion gate                                               | #1 (critical) |

Acceptance-criteria additions:

- **1.7a** — registry `(runId,nodeId)→handle+queue`; per-turn `AbortSignal.any` seam; `operatorInterrupt` set on per-turn abort; provider-conformance table (claude/codex/omp/grok/deepseek → interrupt mechanism + ≥1 fixture each, sourced from `provider-steering-matrix.md`); omp/grok interrupt = stream-abort (their soft-inject → G2).
- **1.7b** — multi-turn via `attemptResumeId`; natural vs interrupted drain rules; placement clauses (`canReask :3032`, skip validation, branch after `:3124`, reset at N+1, `result` discriminator); writes the cross-provider `interrupted` status row at idle-await entry; projects `generating | idle-after-interrupt` + server-response change + `api.generated` regen + both-shell render.
- **1.8** — + invalid run/node id, auth denial, malformed payload, duplicate `message_id`, repeated interrupt, terminal-transition-mid-request; every rejected request leaves node/queue/transcript unchanged; detached → "not steerable here".
- **1.9** — + Enter=newline (never send), pending-Ask block (`aria-disabled` + `aria-describedby`), reduced motion, CSS `text-transform` not literal caps.
- **1.10** — + `Stopping…` `aria-disabled` transient, focus transfer on dock change, per-transition live-region announcements, "interrupt did not undo written work" disclosure, reader folds the `interrupted` status row into the preceding tool card.
- **1.11** — + message shows `sent` on every provider (v1 ceiling); `operator · <display name>` via AD-12, short-id fallback on join miss.
- **1.12a** — reconcile `sent`↔`message_id` on the terminal event only; unmatched → `NEVER SENT`; assertive `role="alert"` on delivery failure.
- **1.12b** — 30-min inactivity fail branch (explicit; never the completing idle timeout); composing-keepalive re-arm; idle-await cancel-poll; resume → fresh session.
- **1.12c** — global order = registry receipt order; per-operator attribution via `operator_user_id`; no per-node lock.

Post-v1 gated backlog (new section; not a new epic, not counted toward Epic 1 completion):

- **G1 — `delivered` chip** — gated on claude SDK ≥ 0.3.246. Advances `sent → delivered`, claude-only, by id. (was CAP-13)
- **G2 — claude soft-inject (mid-turn)** — gated on the `AsyncIterable`-input + resume spike. Carries the omp RPC / protocol-v2 / `steering_mode:all` path (AR-18) and delta-2 per-item `Send now`. (was CAP-12)
- **G3 — grok hooks soft-inject** — gated on the `pre_tool_use` payload-shape spike.

FR Coverage Map edits:

```
FR9/FR10 engine       1.7  → 1.7a (interrupt+registry) + 1.7b (multi-turn+idle-await+sub-state)
routes/registry/race  1.8  → 1.8 (+ full failure criteria)
FR11 (CAP-11)         1.11 → 1.11 (+ sent floor + display-name); reader fold → 1.10; write → 1.7b
terminal reconcile    1.12 → 1.12a ; 30-min fail → 1.12b ; multi-user order → 1.12c
FR12 (CAP-12)         1.13 → G2 (post-v1, outside Epic 1 gate)
FR13 (CAP-13)         1.13 → G1 (post-v1, outside Epic 1 gate)
sent floor            (new row) → 1.11
```

Dependency chain stays fully backward (1.7a→1.7b→1.8→1.9→1.10; 1.11 dep 1.1/1.7b/1.8; 1.12a/c dep 1.8/1.11; 1.12b dep 1.7b). No forward dependency.

### Batch D — new companions, SPEC gate, contrast override, README reconciliation

**D1 · new companion `steering-test-plan.md`** (outline; implementation authors the full plan):
Engine unit (per-turn signal seam, `operatorInterrupt` placement, `result`-discriminator race, drain rules, multi-turn, idle-await entry); idle-await lifecycle with fake timers (30-min fail branch, keepalive re-arm, cancel-poll, resolves once); provider interrupt conformance (≥1 fixture each: claude native, codex stream-abort→`resumeThread`, omp stream-abort, grok stream-abort, deepseek cancel-and-continue); registry + routes (register/teardown, 409 finished, detached not-steerable, Send-during-interrupt waits in queue, invalid id, malformed payload, duplicate `message_id`, repeated interrupt, terminal-mid-request, rejection leaves state unchanged); operator row + reconcile (sole writer, three metadata fields, `seq` placement, terminal-event-only reconcile, Never-sent, display-name + short-id fallback); multi-user order; sub-state projection (exactly two values); steering E2E on both shells (dock states, interrupt→Send-now→continue, a11y, visual at 460px + Console panel width). Fixture rule: ≥1 claude + ≥1 non-claude per applicable table. Gate `bun run validate`.

**D2 · new companion `steering-api-contract.md`** (outline):
Routes `POST …/nodes/:nodeId/send` + `…/interrupt` via `registerOpenApiRoute(createRoute(...))`; send req `{ message, message_id, intent: 'queue'|'send_now' }`; interrupt req `{}`; keepalive → dedicated bodyless `POST …/keepalive` that re-arms idle-await; responses send `{ success, message_id, state }`, interrupt `{ success, sub_state }`; errors 401/403 auth, 404 invalid id, 400 malformed, 409 `node_finished`, duplicate `message_id` → idempotent receipt replay, repeated interrupt while idle → idempotent no-op.
**Detached-run status code (contract-author decision, recommended):** 409 is already spent on `node_finished`; recommend **422 + `error.code: 'not_steerable_here'`** for the detached / no-live-handle case, distinct from 409's terminal conflict.

**D3 · SPEC v1-gate paragraph** — add to Write-half Constraints:

```
**v1 release gate (owner-ratified 2026-09-15).** Steering v1 ships at the universal floor — interrupt
+ `Queue`, every message `sent`, on every provider. `delivered` (G1 · claude SDK ≥ 0.3.246), claude
soft-inject (G2 · spike), and grok hooks (G3 · spike) are post-v1 gated backlog, each on its own
external gate; none blocks the v1 release.
```

Annotate the three Open-questions bullets (`delivered`, claude soft-inject, grok hooks) to point at G1/G2/G3 — post-v1 backlog, outside the v1 gate.

**D4 · DESIGN.md contrast override (owner override of the doc's own recommendation):**

- `status: final # one open question: --node-prompt contrast (Colors)` → `status: final`.
- Open Questions: flip "Recommendation: accept and record" → **resolved (owner override, 2026-09-15): brighten** the two text placements (search/glob chip text; code-body keywords) with `color-mix(in oklch, var(--node-prompt) 70%, var(--text-primary))`, pure `--node-prompt` kept on the chip border. Disposition: an inline derived value from two existing tokens — no new named token; do NOT promote to `--node-prompt-text` (that would re-trigger the brand-guide rule and reverse this).
- "is the open question above" → "resolved: brightened (Open Questions)". The measured-contrast rows stay at their as-measured values: the brightened `color-mix` has no measured contrast number yet (DESIGN.md requires measured, not estimated, cells), so the implementer must measure the mix on both backgrounds and record it.

**D5 · README reconciliation:**

- `interrupting` drift (three places) → core projects exactly two (`generating | idle-after-interrupt`); `interrupting` is a UI-local transient, not projected (AD-9).
- Deltas 2–5 (update the note): delta 2 → G2 (post-v1; v1 has no per-item send); delta 3 (queue full-bleed band) → **fold into DESIGN.md** Components → Draft box + Elevation (owner-approved 2026-09-15); delta 4 (detached-run state 8) → **fold into EXPERIENCE.md** State Patterns; delta 5 → already resolved (bordered both shells), mark the stale mockup note superseded.

**D6 · register the new companions:**

- SPEC `companions:` += `steering-test-plan.md`, `steering-api-contract.md`.
- `epics-agent-node-room/epics.md` `inputDocuments:` += both.

## 5. Implementation handoff

**Scope classification: Moderate.**
The change reorganizes the backlog and adds contract artifacts; it does not replan the product or change a business decision.

**All batches A–D were applied in this session** — the SPEC, both architecture spines, EXPERIENCE.md, DESIGN.md, the mockup README, and the epic breakdown were edited in place, and the two new companion contracts (`steering-api-contract.md`, `steering-test-plan.md`) were authored. No agent handoff remains for the document edits.

Remaining steps (not document edits):

| Step                                                                                                                | Owner                               |
| ------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Re-run `/bmad-check-implementation-readiness` on the corrected bundle to confirm READY for the v1 steering scope    | bmad-check-implementation-readiness |
| Run `/bmad-sprint-planning` for agent-node-room to generate its sprint status (the §6.4 N/A above)                  | bmad-sprint-planning                |
| Optional: strip the satisfied `[reframe consequence — confirm against EXPERIENCE.md]` tag at `control-states.md:50` | bmad-ux                             |

Success criteria:

- A re-run of the readiness assessment returns READY for the v1 steering scope (Floor = v1).
- Story 1.13 no longer exists; every remaining story is independently completable at Phase 4 start.
- The two new companion contracts exist and the Send/Interrupt routes have typed request, response, and error schemas.
- The four confirmed contradictions are gone from the canonical documents.
- No migration and no schema change are introduced.

## Change-navigation checklist status

| Section                        | Status                                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------------------------- |
| §1 Trigger and context         | Done                                                                                            |
| §2 Epic impact                 | Done — restructure, no new/removed epic                                                         |
| §3 Artifact conflict analysis  | Done — SPEC, both spines, EXPERIENCE, DESIGN, README, two new companions                        |
| §4 Path forward                | Done — Direct Adjustment (Rollback N/A, MVP gut not needed)                                     |
| §5 Proposal components         | Done — this document                                                                            |
| §6.4 Update sprint-status.yaml | N/A — no agent-node-room sprint status exists yet; generated post-correction by sprint-planning |

## Owner decisions recorded

1. **Floor = v1** (2026-09-15) — steering v1 ends at interrupt + Queue + `sent` on every provider; `delivered`, claude soft-inject, and grok hooks are post-v1 gated backlog (G1–G3), outside Epic 1's completion gate.
2. **Contrast fix** (2026-09-15) — brighten `--node-prompt` text to ≥ 4.5:1 with a token-derived `color-mix`; overrides DESIGN.md's own "accept and record" recommendation; no new named token.
3. **Delta 3** (2026-09-15) — adopt the queue full-bleed band into DESIGN.md.

## Unresolved questions

- **Detached-run status code — resolved.** Ratified as **422 + `error.code: 'not_steerable_here'`** in `steering-api-contract.md` (under the Batch-D approval); distinct from 409 `node_finished` because a detached run is non-terminal but unreachable from this process.
- **Brightened contrast value is unmeasured** — the `color-mix(in oklch, var(--node-prompt) 70%, var(--text-primary))` has no measured contrast number yet, and `DESIGN.md` requires measured (not estimated) cells. The implementer must measure it on both backgrounds and record it.
- **`omp` vs `opencode` steering scope** — the provider matrix includes `omp` while the SPEC non-goals exclude `opencode`; pre-existing, not flagged by the readiness report, left unchanged here. Raise separately if the two names refer to the same provider.
