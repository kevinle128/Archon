---
title: Sprint Change Proposal — Agent Node Room readiness remediation (second pass)
date: '2026-09-16'
project: Archon
scope: spec-agent-node-room
trigger: implementation-readiness-report-2026-09-15-spec-agent-node-room.md (NOT READY, 10 residual issues)
prior: sprint-change-proposal-2026-09-15.md (status: applied — first pass, batches A–D)
status: applied
applied: '2026-09-16 (owner-approved batch; ~34 edits across the five artifacts in two passes — initial batch + post-apply corrections after independent verification. The initial batch MISSED EXPERIENCE.md:179 (still carried the refuted finished-iteration `not_steerable_here` refusal — root cause: the file-map scoped EXPERIENCE.md to D1 only); corrected post-apply. Final state verified clean — no residual per-tab claim, no coined `on this node`, no finished-iteration `not_steerable_here` refusal, G1–G4 consistent across SPEC + epics. See §7.)'
path_forward: Direct Adjustment
mode: batch
owner: kevin
owner_decisions:
  - 'D1 (queue ownership): the queue is NODE-scoped + server-process-local (already the architecture, AD-11 + SPEC Two-queues). `this tab only` is reserved for the UNSENT composer draft. Consequence accepted: a second tab OR a second operator on the same running node sees the same `QUEUED · n` and may withdraw any queued item (idempotent, keyed by `message_id`). Decided per recommendation in batch mode — reversible in review.'
  - 'D2 (finished-iteration steering, Story 1.6): option (a) — the finished-iteration view offers NO composer and makes NO steering route call; the read-only band mirrors the NODE''s still-pending registry queue shown inert (the handoff Delta-6 behavior — those messages deliver when the operator returns to the live iteration), while that iteration''s already-delivered operator messages read back from the transcript''s occurrence group; the `not_steerable_here` / "rejected on arrival" server-refusal is dropped; the Send route + registry stay node-scoped (no wire/identity change). Decided per recommendation in batch mode — reversible in review.'
  - 'D3 (hybrid story structure 1.7a/1.7b/1.8): NO CHANGE. Already owner-ratified 2026-09-15 (epics.md line 283); the report records it as an accepted deviation and asks for no reversal. Recorded as accepted; reopen on request.'
artifacts_touched:
  - _bmad-output/specs/spec-agent-node-room/SPEC.md
  - _bmad-output/specs/spec-agent-node-room/control-states.md
  - _bmad-output/planning-artifacts/epics-agent-node-room/epics.md
  - _bmad-output/planning-artifacts/ux-designs/ux-Archon-2026-09-09/EXPERIENCE.md
  - claude-design/design_handoff_node_room_transcript_steering/README.md
---

# Sprint Change Proposal — Agent Node Room readiness remediation (second pass)

## 1. Issue summary

The `spec-agent-node-room` bundle was re-assessed on 2026-09-15 at 23:57 — **after** the first remediation (`sprint-change-proposal-2026-09-15.md`, `status: applied`, applied 23:44).
The re-assessment reads the post-remediation artifacts and still returns **NOT READY**, with **10 residual issues**: 1 critical, 5 major, 4 minor.
Functional traceability stays complete (28/28 FRs have an implementation path); the block is contract-consistency and one unimplementable server criterion, not coverage.

**This is a second-pass correction, not a fresh start.** Two of the ten issues are genuine owner decisions; seven are additive acceptance-criteria fills; one is a recorded no-change.

Two facts about provenance, stated for honesty:

- The **queue-ownership contradiction (Critical #1) is a RESIDUAL from an incomplete first-pass fix.** First-pass Batch A ("the four confirmed contradictions") corrected the queue model at exactly one row — `EXPERIENCE.md` "connection lost with messages queued" (now line 184) — and left the normative CAP-8 success bullet (`SPEC.md:86`), the interaction-primitives rule (`EXPERIENCE.md:206`), and the walkthrough (`EXPERIENCE.md:371`) still asserting the queue is per-tab. The re-assessment caught the leftovers.
- The full blast radius is **wider than the report named** (it cited three files). An exhaustive grep for `this tab` / `never left` / `per-tab` across the **entire canonical set** (SPEC, both architecture spines, EXPERIENCE, DESIGN, engine-integration, test-plan, steering-test-plan, epics, control-states, handoff) found the correct model already present in `SPEC.md:135` (Two queues), the live-steering `ARCHITECTURE-SPINE.md:174`, `EXPERIENCE.md:184`, and `epics.md:401`; the wrong per-tab claim in `SPEC.md:86`, `epics.md:59`, `EXPERIENCE.md:92/175/206/243/371`, and `claude-design/.../README.md:283/291/384`; and **no** per-tab wording in DESIGN, engine-integration, test-plan, or steering-test-plan (nothing to change there).

This change is a **planning-document correction discovered at a readiness gate**.
No implementation code exists for this spec yet, so nothing rolls back.
The read half (CAP-1…7, Stories 1.1–1.6) is substantially closer to ready than the steering half; its residual items are acceptance-detail gaps, not architecture blockers.

### The ten issues

| #   | Sev      | Issue                                                                                                                                                              | Bucket           |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| 1   | Critical | Queue ownership: `SPEC.md:86` (per-tab) vs `SPEC.md:135` (server-side, survives tab close) vs registry keyed `(runId,nodeId)` (AD-11)                              | **D1 decision**  |
| 2   | Major    | Story 1.6 demands a `not_steerable_here` server refusal for a finished iteration; the Send route carries no iteration identity, so it is unimplementable as stated | **D2 decision**  |
| 3   | Major    | G2 couples the OMP soft-inject path to the Claude `AsyncIterable` spike gate                                                                                       | M1               |
| 4   | Major    | Stories 1.7a/1.7b/1.8 lack standalone user value (owner-ratified hybrid)                                                                                           | **D3 no-change** |
| 5   | Major    | Stories 1.7a/1.7b are oversized for one completion boundary                                                                                                        | M2               |
| 6   | Major    | Story 1.8 does not explicitly accept the Withdraw route                                                                                                            | M3               |
| 7   | Minor    | Story 1.9 omits the documented `Cmd`/`Ctrl`+Enter shortcut                                                                                                         | M4               |
| 8   | Minor    | Story 1.1 leaves three of five default-expansion states implicit                                                                                                   | M5               |
| 9   | Minor    | Story 1.3 leaves the diff failure-oracle cases to references                                                                                                       | M6               |
| 10  | Minor    | Story 1.12b does not test idle expiry with a queue present                                                                                                         | M7               |

## 2. Impact analysis

### Epic impact

Epic 1 (Agent Node Room) is unchanged in shape: one epic, read half first, steering after, v1 floor = interrupt + `Queue` + `sent`, G-items post-v1.
No epic is added, removed, resequenced, or reprioritized.
The change is: reconcile contradictory queue wording across the contract set (D1), replace one unimplementable Story 1.6 criterion with a cause-aligned one (D2), split one post-v1 backlog gate (M1), and fill six acceptance-criteria gaps (M2–M7).

### Story impact

- **Story 1.1** — add a five-outcome default-expansion table AC (M5).
- **Story 1.3** — bind the diff failure-oracle test contract to completion (M6).
- **Story 1.6** — drop the `not_steerable_here` finished-iteration criterion; the read-only band mirrors the node's live pending queue (inert), and that iteration's delivered messages read back from its transcript occurrence group (D2).
- **Story 1.7a / 1.7b** — add one package-ownership + integration-gate line each (M2).
- **Story 1.8** — rename to name all four routes; add the Withdraw AC with correct 404/idempotency semantics (M3).
- **Story 1.9** — reserve `this tab only` for the unsent draft; add the node-scoped queue-visibility AC (D1); add the keyboard-shortcut AC (M4).
- **Story 1.12b** — add the queued-message idle-expiry case (M7).
- **G2 → G2 + new G4** — split Claude and OMP soft-inject onto independent gates (M1).

No new database table, migration, or backend behavior. NFR1 (read half is retroactive, zero schema) is preserved. Story dependency direction stays backward-only.

### Artifact conflicts

| Artifact                         | Change                                                                                                                      |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `SPEC.md`                        | CAP-8 success (D1); CAP-6 success gains the first-class finished-iteration dock (D2)                                        |
| `control-states.md`              | new "Viewing a finished iteration" subsection (D2)                                                                          |
| `epics-agent-node-room/epics.md` | FR8 line, Stories 1.1/1.3/1.6/1.7a/1.7b/1.8/1.9/1.12b, G2 + new G4, FR Coverage Map, overview                               |
| `EXPERIENCE.md`                  | five per-tab wording fixes (D1)                                                                                             |
| `claude-design/.../README.md`    | three per-tab wording fixes (D1); finished-iteration Delta-6 alignment (D2)                                                 |
| `steering-api-contract.md`       | **no change** — D2 option (a) needs no wire/identity change; M3 uses the contract's existing 404/idempotency rules verbatim |

### Technical impact

Doc-only. No code, no migration, no build artifact. Fully reversible via git.
D2 option (a) deliberately avoids extending the Send route or registry key, so no architecture spine changes.
The one behavioral consequence to note for implementation: under D1 the steering queue is a **shared per-node resource** — a second tab or operator on the same running node sees and can withdraw its items. This is already what AD-11 (one global receipt order, one `(runId,nodeId)` registry) implies; the docs now say so.

## 3. Recommended approach

**Direct Adjustment** — modify and extend existing stories and contract wording within the current plan.

- Not a Rollback: no completed work exists to revert.
- Not an MVP Review: MVP scope, the v1 floor, and the read-first sequence are unchanged.

Rationale: all 28 FRs already have implementation paths; the plan needs targeted contract repair, exactly as the report concludes ("targeted contract repair rather than a redesign"). This mirrors the first pass's path-forward classification.

- **Effort:** small — ~29 focused edits across five markdown files; no code.
- **Risk:** low — planning artifacts only, reversible, no schema or public contract touched.
- **Timeline impact:** unblocks the steering slice; re-run the readiness gate after applying. The read slice (1.1–1.5) was never blocked by these — only its minor AC gaps (M5/M6) and the shared finished-iteration item (D2) touch it.

## 4. Detailed change proposals

Grouped by decision/fix. Every edit quotes the exact current text. Anchors are stable text, not raw line numbers.

---

### D1 — Queue ownership: node-scoped server queue; `this tab only` = unsent draft only

**Model (already decided by the architecture, now made consistent):** the pre-`Queue` **draft** (text still being composed) is per-tab browser state and dies on tab close. A **queued** message (after `Queue` press) is server-side, node-scoped `(runId,nodeId)`, survives tab close, is visible to any tab/operator viewing the same running node, is globally ordered across operators, and dies only on a server restart.

**D1.1 — `SPEC.md`, CAP-8 success bullet**

OLD:

> - **success:** … The message is delivered as the next turn when the current turn ends naturally. The interface states that the queue is per-tab.

NEW:

> - **success:** … The message is delivered as the next turn when the current turn ends naturally. The interface states that only the **unsent composer draft** is this-tab-only; a **queued** message is node-scoped and server-process-local — it survives a tab close, is visible to any tab or operator viewing the same running node, and dies only on a server restart.

**D1.2 — `epics.md`, FR8**

OLD:

> FR8 (CAP-8): … delivered as the next turn at the natural boundary; the queue is stated per-tab.

NEW:

> FR8 (CAP-8): … delivered as the next turn at the natural boundary; the unsent draft is stated this-tab-only and the queue is stated node-scoped (server-process-local).

**D1.3 — `EXPERIENCE.md`, Interaction Primitives**

OLD:

> - **The queue is per node, as well as per tab.** Messages written in one node's dock stay with that node; selecting another node shows that node's queue, and returning shows the first one's still waiting. The queue belongs to the conversation the operator is having, and they are having a different one in each room. Both scopes are stated in the interface, because either one alone would mislead.

NEW:

> - **The queue is per node and server-process-local; only the unsent draft is per tab.** A queued message rides the node's `(runId, nodeId)` registry queue: selecting another node shows that node's queue, a second tab on the same node shows the **same** queue, and it survives this tab's close — dying only on a server restart. The pre-`Queue` draft, by contrast, is per-tab browser state (`this tab only`). Both facts are stated in the interface, because either one alone would mislead.

**D1.4 — `EXPERIENCE.md`, walkthrough (the `QUEUED · 1` step)**

OLD:

> … and presses `Queue`. The draft box appears above the field reading `QUEUED · 1`, with `this tab only` beneath it.

NEW (the `QUEUED` band keeps its canonical `QUEUED · N` header per `DESIGN.md` — no scope label is added; scope is stated in prose, not on the band):

> … and presses `Queue`. The draft box appears above the field reading `QUEUED · 1` (the queued message is now server-side — it rides the node's registry queue, not this tab); `this tab only` stays reserved for the unsent line still in the composer.

**D1.5 — `EXPERIENCE.md`, "Node finishes on its own, dock removed" announce copy**

OLD:

> … the change is **announced once**, in the same register the stop wait is: `node finished · these never left this tab`.

NEW:

> … the change is **announced once**, in the same register the stop wait is: `node finished · none of this was sent`.

Reason: at a finished node the read-only box can hold messages that were dispatched to the server registry but never delivered (restored as `NEVER SENT`); "never left this tab" is false for those. "None of this was sent" is true for every item in the box.

**D1.6 — `EXPERIENCE.md`, 30-minute-fail announce copy**

OLD:

> … `node failed · interrupted with no redirect · these never left this tab` …

NEW:

> … `node failed · interrupted with no redirect · none of this was sent` …

**D1.7 — `EXPERIENCE.md`, copy-decisions table row**

OLD (row):

> `this tab only` | silence about where the queue lives

NEW (row):

> `this tab only` — on the unsent draft only (the `QUEUED` band carries no scope label) | silence about where the draft lives

**D1.8 — `claude-design/.../README.md`, dock mock**

OLD:

> `QUEUED · 2                          this tab only   ▾`

NEW (drop the erroneous `this tab only` from the band; `DESIGN.md` specifies the band header as `QUEUED · N` only):

> `QUEUED · 2                                          ▾`

**D1.9 — `claude-design/.../README.md`, dock legend**

OLD:

> - `this tab only` sits on the header line, right-aligned — the draft queue is per-tab browser state

NEW:

> - `this tab only` labels the **unsent draft** only; the `QUEUED` band header is just `QUEUED · N` (no scope label — per `DESIGN.md` queue-band spec) — a queued message is server-side (node-scoped registry queue), not per-tab browser state

**D1.10 — `claude-design/.../README.md`, client-state note**

OLD:

> the per-tab draft queue, the selected execution, and two local disclosure booleans for the strips.

NEW:

> the per-tab **unsent draft** (queued messages are server-side, not client state), the selected execution, and two local disclosure booleans for the strips.

**D1.11 — `epics.md`, Story 1.9: new AC (node-scoped queue visibility)**

Story 1.9's existing AC already reserves `this tab only` for unsent text and calls `QUEUED · n` "queued on the server for this run" — that is correct and stays. ADD one AC after it:

> **Given** the same running node is open in a second tab, or steered by a second operator
> **When** either dock renders
> **Then** both show the same `QUEUED · n` from the node's registry queue, and either may withdraw any queued item via the idempotent withdraw route (keyed by `message_id`); only the unsent composer text differs per tab (`this tab only`). E2E covers two tabs on one running node.

**D1.12 — `epics.md`, Story 1.12a: reconcile every displayed node-queue id, not just this tab's sends**

Under node-scoped queues a second tab displayed the first tab's `message_id`s too, so terminal reconciliation must restore all unmatched node-queue ids symmetrically. Story 1.12a's AC currently reads "each `sent` id is matched…". Append one clause:

> … the ids reconciled are every queued `message_id` the dock displayed from the node's registry queue (not only this tab's own sends); each unmatched id returns to the draft box as `NEVER SENT`.

**D1.13 — `epics.md`, Additional Requirements route list: name all four steering routes**

The Additional Requirements line named only `send` + `interrupt` (same gap as Story 1.8's old title). Made consistent:

OLD:

> In-process registry keyed `(runId, nodeId)`; `POST /api/workflows/runs/:runId/nodes/:nodeId/send` and `…/interrupt` under `resolveAuthContext` (HITL/AD-7).

NEW:

> In-process registry keyed `(runId, nodeId)`; `POST …/send`, `…/interrupt`, `…/keepalive`, and `DELETE …/queue/:messageId` (withdraw) under `resolveAuthContext` (HITL/AD-7).

**Band-label decision (why no new copy string was coined).** `DESIGN.md`'s queue-band spec fixes the band header at `QUEUED · N` / `WILL SEND · N` — "one word … a heading, not a caption." So the fix **removes** the wrong `this tab only` from the band rather than replacing it with a new scope label (an earlier draft coined `on this node`; dropped to avoid contradicting DESIGN's one-word-header intent and to avoid adding canonical UI copy beyond the readiness scope). Scope is stated in the interaction-primitives prose (`EXPERIENCE.md`) and the connection-lost row, not on the band. `this tab only` stays only on the unsent draft.

---

### D2 — Finished-iteration steering (Story 1.6): no composer, no route call, node-queue band read-only

**Decision — option (a).** When the operator views a **finished** iteration of a live loop node, the dock offers no composer and the client makes no steering route call. The read-only band mirrors the **node's** live registry queue — the operator's still-pending messages — rendered inert here (no `Send now`, no delete, no next-out mark); those messages deliver when the operator returns to the live iteration. This is the design handoff's Delta-6 behavior (`README` §6); option (a) drops only its "rejected on arrival" rationale, which assumed the server could reject on iteration identity. The node-scoped Send route carries no iteration identity, so there is nothing to refuse — and `control-states.md` already limits server refusals to node-finished (409) and detached. That finished iteration's **already-delivered** operator messages read back inline from the transcript itself (occurrence grouping, FR6/FR11), not from this band. No wire, registry, or architecture-spine change.

(Option (b) — add occurrence/retry identity to the Send route + registry key + AD-11 + `engine-integration.md` — was rejected for v1: real work for a guard the read-only UI already provides. Option (c) — defer the finished-iteration dock post-v1 — was not chosen: the loop-iteration **selector** is owner-confirmed in scope (Delta 6), and the read-only-dock detail is canonical via SPEC's `companions` frontmatter, not a separate owner decision.)

**D2.1 — `epics.md`, Story 1.6: replace the finished-iteration AC**

OLD:

> **Then** it shows a collapsed disclosure with a `Go to iteration N` control and a **read-only** queue band mirroring that iteration's queued messages; the composer is not offered, and a message composed against a finished iteration is refused as `not_steerable_here` (steering acts only on the live iteration). The dock is still fully absent when the operator views a non-live **execution** (a different run) — the two cases are distinct.

NEW:

> **Then** it shows a collapsed disclosure with a `Go to iteration N` control and a **read-only** band mirroring the **node's** registry queue (the operator's still-pending messages), inert here — no `Send now`, no delete — and delivering when the operator returns to the live iteration. The composer is not offered and the client makes **no** steering route call for a finished iteration; steering targets only the live iteration, and the node-scoped Send route is not iteration-aware, so there is no server refusal to return. That finished iteration's already-delivered operator messages read back inline in its occurrence group in the transcript, not in this band. The dock is still fully absent when the operator views a non-live **execution** (a different run) — the two cases are distinct.

**D2.2 — `epics.md`, Story 1.6 `_Refs:_`**

OLD:

> _Refs:_ CAP-6 (incl. UX-DR10, folded into CAP-6 success); finished-iteration dock per the design handoff (Delta 6); mockup **Console/Legacy Node Room**. Depends on Story 1.1 …

NEW:

> _Refs:_ CAP-6 (incl. UX-DR10, folded into CAP-6 success); finished-iteration dock — `control-states.md` "Viewing a finished iteration" (first-class) + design handoff Delta 6; mockup **Console/Legacy Node Room**. Depends on Story 1.1 …

**D2.3 — `SPEC.md`, CAP-6 success: make the finished-iteration dock first-class**

OLD:

> - **success:** A node whose rows span more than one `occurrence_id` renders a header per group; a single-occurrence node renders none. Grouping keys on `occurrence_id`, never on `attempt_id`. A **loop-iteration selector** lets the reader navigate directly between occurrence groups — the per-group headers remain the anchors it targets — and is absent on a single-occurrence node.

NEW (append one sentence):

> - **success:** … and is absent on a single-occurrence node. On a live loop node, selecting a **finished** iteration renders a read-only dock — a collapsed disclosure, a `Go to iteration N` control, and a read-only band mirroring the node's still-pending queue (which delivers on return to the live iteration); the composer is absent and no steering route is called for a finished iteration (steering targets only the live iteration; the Send route stays node-scoped and iteration-agnostic).

**D2.4 — `control-states.md`: new subsection**

Insert after "The table" section:

> ## Viewing a finished iteration of a live loop node
>
> The loop-iteration selector (CAP-6) defaults to the running iteration. When the operator selects a **finished** iteration while the node is still `running`, the dock does **not** steer that iteration — steering only ever acts on the live one.
>
> - The dock collapses to one line — `reading a finished iteration · the agent is working in iteration N` — plus a `Go to iteration N` control that returns to the live dock.
> - Below it, a **read-only** band mirrors the **node's** registry queue — the operator's still-pending messages — inert here (no `Send now`, no delete, no next-out mark). They are not lost: they deliver when the operator returns to the live iteration.
> - The composer is absent and the client makes **no** steering route call for a finished iteration. There is nothing for the server to refuse: the Send route is keyed `(runId, nodeId)` and is not iteration-aware, and the only server refusals are node-finished (409) and detached ("not steerable here").
> - That finished iteration's **already-delivered** operator messages are read back from the transcript itself (its occurrence group, FR6/FR11), not from this band.
>
> This is distinct from viewing a non-live **execution** (a different run), where the dock is fully absent.

**D2.5 — `claude-design/.../README.md`, Delta 6 ("Why" rationale only — the band bullet already reads correctly)**

OLD:

> **Why:** a steer carries the node id and retry epoch it was written against, so a message composed against a finished iteration would be rejected on arrival. The band stays because the operator's own words are never discarded silently — they still deliver once the operator is back on the live iteration; only the controls would be lying.

NEW:

> **Why:** steering targets only the live iteration, so on a finished one the composer is absent and **no steering request is issued** — there is nothing to reject on arrival, and the node-scoped Send route carries no iteration identity to reject on. The band stays because the operator's own queued words are never discarded silently — they still deliver once the operator is back on the live iteration; only the controls would be lying.

---

### M1 — Split the OMP soft-inject gate from the Claude spike (post-v1 backlog)

**M1.1 — `epics.md`, G2: narrow to Claude only**

OLD:

> ### G2 — Claude soft-inject / mid-turn delivery (spike-gated)
>
> **Given** the claude `AsyncIterable`-input-plus-resume spike clears
> **When** a message is soft-injected
> **Then** it arrives mid-turn with no interrupt, no interrupted tool call, and no turn-start event. Carries the omp RPC / protocol-version-2 / `set_steering_mode:'all'` soft-inject path (AR-18) and the delta-2 per-item `Send now` (rendered only where soft-inject exists).
> _Gate: the `AsyncIterable` + resume-protocol spike. Refs: CAP-12, steering AD-3/AD-7, `provider-steering-matrix.md`._

NEW:

> ### G2 — Claude soft-inject / mid-turn delivery (spike-gated)
>
> **Given** the claude `AsyncIterable`-input-plus-resume spike clears
> **When** a message is soft-injected on Claude
> **Then** it arrives mid-turn with no interrupt, no interrupted tool call, and no turn-start event. The delta-2 per-item `Send now` renders wherever soft-inject exists (Claude here; OMP via G4).
> _Gate: the claude `AsyncIterable` + resume-protocol spike. Refs: CAP-12, steering AD-3/AD-7, `provider-steering-matrix.md`._

Reason the per-item `Send now` clause moves rather than disappears: `control-states.md` records mid-turn delivery on "claude today," so per-item send is not OMP-only — it belongs wherever soft-inject exists. G2 keeps the shared statement; G4 back-references it.

**M1.2 — `epics.md`: add G4 (OMP soft-inject), independent gate**

Insert after G3:

> ### G4 — OMP soft-inject / mid-turn delivery (conformance-gated, independent of G2)
>
> **Given** the OMP RPC / protocol-version-2 / `set_steering_mode:'all'` soft-inject path (AR-18) is conformance-verified (source-verified in `provider-steering-matrix.md`, on its own gate — it does **not** wait on Claude's `AsyncIterable` spike)
> **When** a message is soft-injected on OMP
> **Then** it arrives mid-turn with no interrupt, no interrupted tool call, and no turn-start event. Per-item `Send now` renders here too (the shared soft-inject affordance stated in G2).
> _Gate: OMP soft-inject conformance (independent of G2). Refs: CAP-12, steering AD-3/AD-7, `provider-steering-matrix.md`._

**M1.3 — `epics.md`, FR Coverage Map**

OLD: `| FR12 (CAP-12) soft-inject         | G2 (post-v1, outside Epic 1 gate)             |`
NEW: `| FR12 (CAP-12) soft-inject         | G2 claude + G4 omp (post-v1, independent gates) |`

**M1.4 — `epics.md`, four "G1–G3 / three items" references** (grep `G1–G3` and `three items` at apply — five known hits):

- Overview (`:34`): `… claude soft-inject (G2) and grok hooks (G3) are post-v1 gated backlog …` → `… claude soft-inject (G2), omp soft-inject (G4) and grok hooks (G3) are post-v1 gated backlog …`
- Epic List (`:128`): `… with G1–G3 as post-v1 gated backlog), in one epic.` → `… with G1–G4 as post-v1 gated backlog), in one epic.`
- Epic 1 header (`:134`): `… the interrupt + \`Queue\` + \`sent\` v1 floor (G1–G3 post-v1).`→`… (G1–G4 post-v1).`
- Post-v1 intro (`:528`): `These three items each ride a separate external gate …` → `These four items each ride a separate external gate …`

---

### M2 — Package ownership + integration gate on the oversized engine stories

**M2.1 — `epics.md`, Story 1.7a `_Refs:_`** — append:

> _Packages:_ `@archon/workflows` (executor abort seam + in-process registry), `@archon/providers` (per-provider interrupt). _Integration gate:_ the five-provider interrupt-conformance fixtures are green.

**M2.2 — `epics.md`, Story 1.7b `_Refs:_`** — append:

> _Packages:_ `@archon/workflows` (multi-turn loop, idle-await entry, end-cause classifier), `@archon/server` (two-value sub-state on the node-state response + `api.generated` regen). _Integration gate:_ end-cause + idle-await green on **both** `executeNodeInternal` and `executeLoopNode`.

---

### M3 — Story 1.8: accept the Withdraw route explicitly (contract-correct semantics)

**M3.1 — title**

OLD: `### Story 1.8: Send/Interrupt routes + registry resolution + race handling`
NEW: `### Story 1.8: Send / Interrupt / Keepalive / Withdraw routes + registry resolution + race handling`

**M3.2 — first AC route list**

OLD: `**Given** `POST …/nodes/:nodeId/send`, `…/interrupt`, and `…/keepalive``NEW:`**Given** `POST …/nodes/:nodeId/send`, `…/interrupt`, `…/keepalive`, and `DELETE …/nodes/:nodeId/queue/:messageId` (withdraw)`

**M3.3 — new Withdraw AC** (uses `steering-api-contract.md` verbatim — 404 is ONLY unknown `runId`/`nodeId`; an unknown or already-drained `message_id` is an idempotent success no-op):

> **Given** an authenticated withdraw for a queued message (steering actor grant, AD-11)
> **When** the route handles it
> **Then** a message still in the queue is removed and returns `{ success: true, message_id }`; a message that had already drained (or an unknown `message_id`) returns the **same idempotent success no-op** — there is **no** message-level 404 (404 is only an unknown `runId`/`nodeId`); an unauthenticated caller → 401; and every rejected request leaves the node, registry queue, and transcript unchanged.

---

### M4 — Story 1.9: the documented `Cmd`/`Ctrl`+Enter send shortcut

**M4 — `epics.md`, Story 1.9: new AC** (traces `EXPERIENCE.md` "Keyboard" + build-verification note, already authoritative):

> **Given** the composer with a queueable message
> **When** the operator presses `Cmd`/`Ctrl`+Enter
> **Then** it triggers the **same action and the same blocked-state guard** as the send control (a no-op while `Stopping…` and while blocked by a pending ask); the shortcut is discoverable — a composer hint and an appended note on the send control's accessible name, with the visible word (`Queue` / `Send now`) kept at the **start** of that name (SC 2.5.3). Plain `Enter` still inserts a newline. E2E covers discoverability and blocked-state parity.

---

### M5 — Story 1.1: five-outcome default-expansion table

**M5 — `epics.md`, Story 1.1: new AC:**

> **Given** rows of every outcome
> **When** the transcript first renders
> **Then** initial expansion is table-driven: `success` collapsed, `failed` expanded, `running` collapsed, `interrupted` collapsed, `unknown` collapsed — one focused test drives all five.

---

### M6 — Story 1.3: bind the diff failure-oracle contract

**M6 — `epics.md`, Story 1.3: new AC:**

> **Given** the `diff-hunks` failure-oracle cases
> **When** Story 1.3 is closed
> **Then** the read-half diff test contract is part of completion — the byte ceiling (not only `maxEditLength`), repeated and mid-array no-newline markers, repeat determinism, memoization, and adapter line-number validity — not deferred to references (`test-plan.md` → diff-hunks contract).

---

### M7 — Story 1.12b: idle expiry with a queue present

**M7 — `epics.md`, Story 1.12b: new AC:**

> **Given** an `idle-after-interrupt` node with **queued** messages present (not an empty queue)
> **When** 30 minutes of composer inactivity pass
> **Then** the node fails **once** on the explicit fail branch, the registry (with its queued messages) is torn down, and Story 1.12a's terminal reconciliation restores the unmatched queued messages to the draft box as `NEVER SENT`.

---

### Recorded no-change (D3) and process note

- **D3 — hybrid story structure (1.7a/1.7b/1.8):** no change. `epics.md:283` already carries the owner-ratified relabel ("engine/transport tasks beneath the 1.9–1.10 outcome, not shippable value on their own"). The report records this as an accepted deviation and requests no reversal. Recorded as accepted; reopen on request.
- **Process (readiness tooling):** the first discovery inventory missed two canonical companions (`architecture-Archon-live-agent-steering-.../ARCHITECTURE-SPINE.md`, the design handoff) that were only identifiable from `SPEC.md`'s `companions` frontmatter. Future readiness runs should read an explicit `companions:` list. No artifact edit — noted for the readiness workflow.

## 5. Implementation handoff

**Scope classification: Moderate.** Contract-wording reconciliation + story-AC edits + one backlog-gate split, no architecture redesign and no code. Above "Minor" because it edits normative spec/contract wording across five artifacts and restructures post-v1 backlog; below "Major" because option (a) keeps every wire/registry/architecture contract intact.

**Handoff:**

1. On owner approval of this batch, apply the ~29 edits above to the five artifacts (same in-session apply pattern as the first pass). D2 touches SPEC + control-states + epics + handoff together; D1 touches SPEC + epics + EXPERIENCE + handoff together — apply each decision's edits as one coherent set.
2. Re-run `bmad-check-implementation-readiness` on the `spec-agent-node-room` bundle (with the full `companions` set) to confirm the verdict moves to READY.
3. Then the read-half stories (1.1–1.5) are clear to enter Phase 4; the steering stories follow the ratified 1.7a→1.12c order.

**Success criteria:**

- No document asserts the queued message is per-tab; `this tab only` appears only on the unsent draft; the node-scoped queue visibility is testable (D1).
- Story 1.6 has no unimplementable server criterion; the finished-iteration dock is first-class in `control-states.md` + SPEC CAP-6 (D2).
- G2 and G4 have independent gates; neither provider's soft-inject waits on the other (M1).
- Story 1.8 explicitly accepts Withdraw with contract-correct 404/idempotency; Stories 1.1/1.3/1.9/1.12b carry the previously-implicit criteria (M2–M7).
- Re-assessment returns READY (or only accepted deviations remain).

## 6. Change-navigation checklist (findings)

| Section                    | Status                   | Note                                                                                                                                                    |
| -------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Trigger & context       | Done                     | Trigger = NOT-READY re-assessment; type = misunderstanding/contract-drift discovered at readiness gate; evidence = the 10 issues, each verified on disk |
| 2. Epic impact             | Done                     | Epic 1 shape unchanged; modify/extend stories only; no add/remove/resequence                                                                            |
| 3.1 PRD conflicts          | Action-needed → resolved | CAP-8 (D1) + CAP-6 (D2) success wording corrected; MVP/floor unchanged                                                                                  |
| 3.2 Architecture conflicts | Done                     | No spine change; D2 (a) keeps Send route + registry node-scoped                                                                                         |
| 3.3 UI/UX conflicts        | Action-needed → resolved | EXPERIENCE + handoff per-tab wording (D1); finished-iteration dock (D2); keyboard shortcut (M4) traced                                                  |
| Path forward               | Done                     | Direct Adjustment                                                                                                                                       |

## Unresolved questions

- **D1 cross-operator withdraw (the one consequence to weigh):** the shared node-scoped queue lets any operator/tab on the node withdraw any queued item (idempotent, keyed by `message_id`). Decided as accepted (matches AD-11). Flag if you want withdraw restricted to the authoring operator — that would need a per-message owner check the current withdraw contract does not carry.

(D2's earlier open question — what the finished-iteration band sources — is now **settled**, not open: the band mirrors the node's live pending queue, so it holds no finished-iteration items at all; that iteration's already-delivered messages are simply the operator rows already visible in its occurrence group in the transcript. The band duplicates a summary of pending work, it does not add a new data source.)

## 7. Post-apply verification & corrections (2026-09-16)

The applied batch was re-verified by an independent readiness pass (fresh read of all five artifacts against the 10 issues, reconciliation-first discipline). Report: `plans/reports/readiness-verify-260916-spec-agent-node-room.md`.

**Verdict: READY (accepted deviations only)** — after the corrections below. 9 of 10 issues were cause-correct on the first pass; the 10th (Issue 2 / D2) had one surviving line.

Corrections applied post-verification:

- **D2.6 — `EXPERIENCE.md:179` (the one real miss).** The finished-iteration row still read "a message composed there is still refused as `not steerable here`" — the exact refuted, unimplementable refusal. The initial batch's file-map scoped `EXPERIENCE.md` to the D1 per-tab edits only, so D2 never reached it, and the D1 grep terms did not touch this D2 sentence. Replaced with the resolved model: composer absent, no steering request issued (nothing to refuse), read-only band mirrors the node's live pending queue, node-scoped route not iteration-aware. The non-live-**execution** refusal in the same row is correct and untouched.
- **Warning — SPEC G-item enumeration.** `SPEC.md:130` and `:176` listed only G1–G3; the M1 split had touched epics only. Added `omp soft-inject (G4)` to both so a SPEC-only reader learns it is a named independent gate.
- **Warning — `epics.md:84` auth label.** Read "under `resolveAuthContext` (HITL/AD-7)"; the steering routes use the AD-11 steering actor grant (which broadens AD-7), per `steering-api-contract.md:7` and Story 1.8. Relabeled to name AD-11.

Reconciled non-issues (recorded, no change): band-header case (`control-states.md` title-case DOM vs DESIGN/epics rendered uppercase — UX-DR7 mandates CSS `text-transform`, one implementation satisfies both); detached-run status code (422 in api-contract; other docs defer to it or use the prose label).

Accepted deviations that persist by design (not regressions): D3 hybrid story structure (`epics.md:291`, owner-ratified); the production-corpus generic-fallback measurement as a release audit rather than a CI fixture.
