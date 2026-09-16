---
title: Sprint Change Proposal — Agent Node Room readiness remediation (round 3)
date: '2026-09-15'
project: Archon
scope: spec-agent-node-room
trigger: _bmad-output/planning-artifacts/epics-agent-node-room/implementation-readiness-report-2026-09-15.md (21:35, assessor Codex, NOT READY)
predecessors:
  - _bmad-output/planning-artifacts/epics-agent-node-room/sprint-change-proposal-2026-09-15.md (round 1, applied)
  - plans/reports/sprint-change-proposal-260915-2054-steering-contract-remediation.md (round 2, applied)
status: applied 2026-09-15 — all 9 artifacts edited + self-verified (broken F4 premises 0 hits; new rules present); advisor re-check per owner request
path_forward: Direct Adjustment
mode: incremental (owner reviewed one consolidated list)
owner: kevin
owner_decisions_this_round:
  - 'D1 — Queue protocol: REVERSE round-2 F4. The operator queue dispatches to the registry AT Queue-press (server-side), with one idempotent withdraw route for delete. Restores round-1 intent:queue send model. Justified by NEW evidence (below) that F4 could not deliver at a natural boundary.'
  - 'D2 — WCAG: fix both flagged values to meet the AA floor (error badge >=4.5:1 via token-derived brighten; interactive tool row 22px -> 24px). NFR8 stays strict. Owner reverses his own earlier DESIGN.md "accept" on these two values.'
  - 'M6 — finished-iteration dock: follow the owner-confirmed design handoff (collapsed disclosure + Go-to-iteration + read-only queue band); reconcile EXPERIENCE; add Story 1.6 ACs.'
  - 'W1 — resume language: name the concrete command `workflow retry-node` for the idle-await fresh rerun.'
owner_decisions_carried_forward:
  - 'F1 (five-case end-cause), F2 (any-authenticated steer grant), F5 (hybrid story boundaries), F6 (loop nodes steerable) — round 2, unchanged.'
  - 'Delta 1 pinned-only todo, Delta 3 surface-elevated queue band, Delta 6 loop selector — owner-confirmed design handoff, unchanged (this round syncs the stale docs TO them).'
artifacts_to_touch:
  - _bmad-output/specs/spec-agent-node-room/SPEC.md
  - _bmad-output/specs/spec-agent-node-room/engine-integration.md
  - _bmad-output/specs/spec-agent-node-room/steering-api-contract.md
  - _bmad-output/specs/spec-agent-node-room/steering-test-plan.md
  - _bmad-output/planning-artifacts/epics-agent-node-room/epics.md
  - _bmad-output/planning-artifacts/architecture/architecture-Archon-live-agent-steering-2026-09-12/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/architecture/architecture-Archon-readable-agent-transcript-2026-09-12/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md
---

# Sprint Change Proposal — Agent Node Room readiness remediation (round 3)

## 1. Issue summary

Round 3 on `spec-agent-node-room`. Rounds 1 and 2 both applied earlier today.
The 21:35 readiness report (Codex) assessed the round-2-corrected bundle and returned **NOT READY** with 10 unique issues: 1 critical (EQ-C1), 1 high (UX-A2 accessibility), 5 major (EQ-M1..M5), 2 medium (UX-A3, UX-A4), 1 minor (EQ-m1), plus 2 warnings. No capability is missing; the gaps are contract-level.

No implementation code exists for this spec, so nothing rolls back — this is a planning-document correction discovered at a readiness gate.

### The critical finding re-opens a round-2 owner decision (verified, new evidence)

Round-2 **F4** set the operator queue client-side: held in the per-tab browser draft box, dispatched to the send route only at the drain moment, **no server call at Queue-press, no withdraw route**. EQ-C1 shows this cannot satisfy the CAP-8 auto-delivery contract, and the cause is structural, not a tunable race:

- `engine-integration.md:37` states all three at once: _"Auto-delivery at the natural boundary is `Queue`'s contract"_ + _"the client dispatches its held messages to the send route at this boundary"_ + _"queue empty → node completes"_ (the executor completes on an empty **registry** queue).
- The steering spine (`AD-9`) defines **exactly two** projected sub-states (`generating`, `idle-after-interrupt`). At a natural end with an empty registry, the client's only observable signal is `node_completed` itself — there is no pre-completion moment on which the client can dispatch.
- So the client's HTTP dispatch cannot beat the in-process executor's completion check. Round-2's F4 note called a lost dispatch "caught by terminal reconciliation ('Never sent')" — but **"Never sent" means lost, not delivered**, which breaks the contract F4 preserved in the same edit.

### Why the source we thought we copied confirms the fix (hermes-agent)

The client-queue idea was borrowed from `hermes-agent`. Reading its code (fork under `workflow-engine/hermes-agent`) shows the borrow dropped the two properties that made it safe:

- hermes has **no client/server split** for this — the keystroke thread and the turn loop are the same process, sharing one in-process `queue.Queue` (`cli.py:4633`); enqueue and the loop's read are trivially synchronized.
- hermes's loop **never completes on an empty queue** — `while not self._should_exit: get(timeout=0.1)` (`cli.py:17376`) idles until the user explicitly exits. Empty is steady-state idle, not a completion signal.
- hermes even hit and fixed this exact loss (#17666/#18760) with an unconditional end-of-turn drain (`cli.py:10704, 17542`).

archon's executor **does** complete a node on an empty registry at turn-end. So the faithful port is not "queue on the client"; it is "put the message where the process that decides completion can see it" — i.e. the registry, at send time. That is **D1 (below)**.

## 2. Impact analysis

**Epic:** Epic 1 unchanged; no epic added/removed; the read-first sequence stands.
**Story:** 1.9 (queue → server dispatch at press), 1.8 (+1.7b dependency), 1.12b (Send-now keepalive/resolution split), 1.4 (pinned-only todo), 1.6 (finished-iteration dock ACs). Read-half stories are clean.
**Artifact conflicts:**

| Artifact                   | Impact                                                                                                                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SPEC.md`                  | Two-queue clause → dispatch-at-press + withdraw route (D1); CAP-3 → pinned-only todo (M-pin).                                                                              |
| `engine-integration.md`    | Natural-end drain: message already in registry, remove client-dispatch-at-boundary (D1); idle-await resume names `workflow retry-node` (W1).                               |
| `steering-api-contract.md` | Send route callable at Queue-press; re-introduce a `queued` server state; add `DELETE` withdraw route (idempotent; any-authenticated per F2); adjust response states (D1). |
| `steering-test-plan.md`    | Client-local-delete test → withdraw-route test; drain/race tests simplify (message already server-side) (D1).                                                              |
| `epics.md`                 | Story 1.9 dispatch-at-press (D1); 1.8 +1.7b (EQ-M4); 1.12b Send-now split (EQ-M3); 1.4 pinned-only (EQ-M1); 1.6 finished-iteration dock (EQ-M2).                           |
| Steering spine             | AD-3 + flow diagram become correct once D1 lands (queue really is registry-held); frontmatter `sources`/companions fix (residual warning).                                 |
| Read spine                 | AD-12 shell list: pinned-only todo behavior + add pinned strip and loop selector (EQ-M1/UX-A4).                                                                            |
| `DESIGN.md`                | Two contrast/target values fixed to AA (D2); draft-box frontmatter token → surface-elevated band (UX-A3).                                                                  |
| `EXPERIENCE.md`            | Finished-iteration dock carve-out (EQ-M2).                                                                                                                                 |

**Technical:** no DB migration, no schema change. D1 keeps steering state ephemeral (registry is in-process; a queued message dies on server restart — NFR-ANR-15 holds). `api.generated` regenerates for the withdraw route + send/interrupt response schema edits. D2 is CSS/token + row-height only.

## 3. Recommended approach

**Direct Adjustment** — amend the artifacts in place. No new epic; no rollback (no code shipped). Effort: **Medium** (D1 is a cross-file contract change; the rest is doc-sync). Risk: Low (documents only, reversible per artifact).

## 4. Detailed change proposals

### D1 — Queue dispatches to the registry at Queue-press (+ idempotent withdraw route)

Rule: the operator queue crosses client→server **at `Queue`-press**, not at drain. Pressing `Queue` calls the send route with `intent: 'queue'`; the message enters the in-memory registry queue immediately and is drained by the executor at the natural turn boundary (or flushed on `Send now`). Delete before drain calls an **idempotent withdraw route** (withdraw of an already-drained `message_id` = success no-op). Withdraw authorization matches the send/interrupt grant (any authenticated identity, F2). The client draft box holds only **pre-`Queue` typing**; a message that has been `Queue`d is server-side and survives tab close, dies on server restart.

**SPEC.md — two-queue clause (`:135`)**

- OLD: _"**Two queues, split on send vs draft.** The pre-send **draft** is per-tab browser state (no table, no migration; the UI says per-tab) — keep and delete on a queued item are **client-local** (no server call, no withdraw route). The client **dispatches** the held draft to the send route at the drain moment (natural turn boundary, or `Send now`), never at `Queue`-press; only then does the message ride the **in-memory registry queue** on the live handle — safe there because that path exists only while the live node does."_
- NEW: _"**Two queues, split on typing vs queued.** The pre-`Queue` **draft** (text still being composed) is per-tab browser state (no table, no migration). Pressing `Queue` **dispatches** the message to the send route with `intent: 'queue'`, and it rides the **in-memory registry queue** on the live handle from that moment — the executor drains it at the natural turn boundary, or `Send now` flushes it. Delete of a queued message calls an **idempotent withdraw route** (delete after drain is a success no-op). A queued message is therefore server-side: it survives a tab close and dies on a server restart (the registry is in-process; NFR-ANR-15 holds — no durable steering state)."_

**engine-integration.md — Natural-end parenthetical (`:37`)**

- OLD: _"(The operator-visible queue is the **client draft box** — per-tab, with client-local delete; the client dispatches its held messages to the send route at this boundary. What the executor auto-drains here is the **in-process registry queue** those dispatched messages entered — the two-queue split, client draft vs server registry.)"_
- NEW: _"(A `Queue`d message is already on the **in-process registry queue** — it was dispatched at `Queue`-press, not at this boundary — so the executor simply finds it here and runs turn N+1. The client draft box holds only text still being composed; delete of a queued message goes through the idempotent withdraw route. The two-queue split is typing (client draft) vs queued (server registry).)"_

**steering-api-contract.md** (rule + targets — exact lines set at apply time)

- Send route: state it is called at `Queue`-press for `intent: 'queue'` (and on `Send now` for `intent: 'send_now'`), no longer "at the drain moment".
- Response `state`: re-introduce **`queued`** (accepted onto the registry, awaiting the natural boundary) alongside `awaiting_send_now`; drop the drain-time `delivered_next_turn` framing (delivery is the executor's drain, reported via the sub-state stream, not the send response).
- Add a **`DELETE` withdraw route** for a queued `message_id`: idempotent (200/204 whether present or already drained), any-authenticated (F2), 404 only for an unknown run/node.
- Interrupt response `sub_state` (`idle-after-interrupt | generating`) unchanged (F3 stays: a natural end that auto-drained the registry → `generating`).

**epics.md — Story 1.9 (`:397`)**

- OLD: _"…it is held in the **client draft box** (per-tab, per-node) — not yet dispatched; … keep and `x` (delete) are client-local (no server call, no withdraw route). The client dispatches the queued batch to the send route at the **drain** moment … never at `Queue`-press."_
- NEW: _"…pressing `Queue` **dispatches** the message to the send route with `intent: 'queue'` and it enters the in-process registry queue at once; the node is untouched, no tool call is interrupted, nothing is lost. `x` (delete) calls the idempotent withdraw route. The executor drains the registry queue at the natural boundary, or `Send now` flushes it."_

**steering-test-plan.md** — flip the client-local-delete test (currently _"a message Queued then `x`-deleted before the drain is never dispatched — assert no send-route call fires"_) to: _Queue press fires the send route (`intent:'queue'`); a subsequent delete fires the withdraw route; withdraw of an already-drained id is a success no-op._ The natural-end race test simplifies: the message is already server-side, so a natural end drains it deterministically (no client-dispatch race).

**Copy sync:** any "this draft queue is per tab" / "this tab only" surface (FR-ANR-8; EXPERIENCE connection-loss copy) reads, for a **queued** message, "kept on the server while this run's process is alive" — the _composer textbox_ stays per-tab. NFR-ANR-19 "returns messages to the front of the client queue" now applies to a failed **Queue-press dispatch** (message never left the client), not to a drain-time dispatch. AR-14 crossover moves to `Queue`-press.
**Send-now prose alignment (post-advisor):** SPEC:94, engine-integration:38, control-states.md:17, and epics (Story 1.10 AC + FR10 summary) said `Send now` delivers "every queued message plus the one just typed" — which read as a client-side merge. Under Option 1 the queued messages are already server-side, so `Send now` dispatches only the newly typed message and the executor flushes the registry (queued messages then the just-typed one, in receipt/written order). Reworded in all four artifacts; the written-order guarantee is preserved by the registry's receipt order (AD-11).

### D2 — Fix the two accessibility values to the WCAG 2.2 AA floor

- **Error badge `--error` on Legacy, 4.3:1 (`DESIGN.md:464, :491, :696`)** — brighten to **≥4.5:1** with a token-derived value (e.g. `color-mix` over `--error`, mirroring the round-1 `--node-prompt` fix; no new named token). Implementer measures on both surfaces and records the cell. Remove the "accepted shortfall" disposition; record "resolved: brightened to ≥4.5:1".
- **Interactive tool row 22px (`DESIGN.md:126, :697`)** — grow to **24px** to clear SC 2.5.8 (via padding where the painted box need not change, mirroring the Raw toggle). Remove the "2px shortfall accepted" disposition; record "resolved: 24px".
- **NFR8 unchanged** (`epics.md:75`) — the floor stays strict WCAG 2.2 AA with no exception clause, because both values now meet it.

### EQ-M1 + UX-A4 — Pinned-only todo, and the shell-behavior list

Owner-confirmed **Delta 1** = the checklist is lifted out of the transcript entirely; every todo call collapses to a one-line row; the current checklist lives only in the pinned strip.

- **SPEC.md CAP-3 (`:62-64`)** — OLD: _"The checklist renders once, anchored at the last todo call; earlier todo calls collapse to a one-line row."_ NEW: _"Every todo call in the transcript collapses to a one-line row; the current checklist lives only in the pinned todo strip (below)."_ Keep the pinned-strip and empty-phase-disappears clauses.
- **epics.md Story 1.4 (`:225`)** — same edit: drop "the checklist renders once anchored at the last todo call"; every todo call collapses; checklist surfaces in the pinned strip.
- **Read spine AD-12 (`:161-166`)** — behavior #5 OLD: _"Checklist renders once — anchored at last todo call; earlier calls collapse."_ NEW: _"Every todo call collapses to a one-line row; the current checklist renders only in the pinned todo strip."_ Add the **pinned todo strip** and the **loop-iteration selector** to the shell-owned list (the core already supplies `TodoPhase[]` and occurrence groups — no new core mechanism; the "exactly five" wording becomes the revised list).

### EQ-M2 — Finished-iteration dock (owner: follow the design handoff)

- **EXPERIENCE.md (`:179`)** — carve out the finished-iteration case: the dock is absent when reading a non-live **execution**, but when reading a finished **loop iteration** via the selector it shows a collapsed disclosure, a "Go to iteration N" control, and a **read-only** queue band (a message composed there is still refused as `not_steerable_here`).
- **epics.md Story 1.6** — add ACs for that finished-iteration dock behavior (currently 1.6 covers only selector navigation).

### EQ-M3 — `Send now` has one lifecycle meaning

- **epics.md Story 1.12b (`:491-493`)** — remove `Send now` from the keepalive-rearm list. OLD: _"…any composer activity occurs (keystroke / focus / `Send now`, via the keepalive route) Then it re-arms without resolving idle-await…"_ NEW: _"…composer activity occurs (keystroke / focus, via the keepalive route) Then it re-arms without resolving idle-await…"_ (`Send now` remains the resolution path at `:487-489`.) engine-integration already treats it correctly (`:46` resolution, `:96` keepalive) — no engine change.

### EQ-M4 — Story 1.8 declares its 1.7b dependency

- **epics.md Story 1.8 (`:385`)** — OLD: _"Depends on Story 1.7a's registry and the api-contract."_ NEW: _"Depends on Story 1.7a's registry, Story 1.7b's multi-turn loop + sub-state projection, and the api-contract."_ Backward dependency; no cycle.

### UX-A3 — Draft-box token matches the adopted band

- **DESIGN.md frontmatter (`:364-366`)** — the draft/queue band background moves from `surface-inset` to the adopted full-width **`surface-elevated`** band (Delta 3). The composer field stays the sole `surface-inset` well (already stated at `:644`). Update the stale frontmatter tokens + any earlier draft-box description to match.

### W1 — Name the idle-await rerun command

- **engine-integration.md (`:46`)** and **epics.md Story 1.12b** — where the text says a node "resumes / re-runs with a fresh session", name the concrete command: **`workflow retry-node <run-id> <node-id>`** (retries the failed node with a fresh session).

### Residual warning — steering spine frontmatter

- **Steering spine frontmatter** — `sources` still points to the superseded `spec-live-agent-steering/SPEC.md`; point it at `spec-agent-node-room`. Add `steering-api-contract.md` and `steering-test-plan.md` to `companions`.

## 5. Implementation handoff

**Scope: Moderate**, Architect nod for the AD-3/AD-4 queue-ownership realignment (D1) and the AD-12 shell-list amendment (UX-A4). All edits are document edits; applied in this session.

**No action (recorded):**

- **EQ-M5** — the F5-hybrid framing already present (`epics.md:279-280`: 1.7a/1.7b/1.8 are sizing-tasks toward the 1.9→1.10 outcome). Keep; sprint reporting treats them as enablers.
- **EQ-m1** (sizing) — size large stories by their existing task boundaries at sprint-planning.
- **EQ-W2** — post-v1 gates (G1 delivered-confirm, G2/G3 soft-inject) are out of the v1 gate.
- **Warning** — the pre-existing shipped Legacy ask-card Submit contrast (3.1:1, `DESIGN.md:495`) is outside this target; the implementing team addresses it if encountered, per repo quality policy — not fixed in this doc pass.

**Remaining (not document edits):**

| Step                                                                                            | Owner                               |
| ----------------------------------------------------------------------------------------------- | ----------------------------------- |
| Re-run `/bmad-check-implementation-readiness` on the corrected bundle                           | bmad-check-implementation-readiness |
| Run `/bmad-sprint-planning` for agent-node-room (no sprint status yet)                          | bmad-sprint-planning                |
| At build: Architect confirms the D1 registry-at-press dispatch + withdraw route land as amended | architect / dev                     |

**Success criteria:**

- A queued message is delivered deterministically at the natural boundary (it is on the registry from `Queue`-press; no client dispatch race). Delete works via an idempotent withdraw route.
- The two flagged accessibility values meet WCAG 2.2 AA; NFR8 stays strict.
- Pinned-only todo, finished-iteration dock, draft-box token, `Send now` lifecycle, Story 1.8 dependency, and the resume command are all consistent across SPEC / epics / spines / UX.
- No migration, no schema change.

## 6. Owner decisions recorded (round 3, kevin, 2026-09-15)

1. **D1 Queue** = dispatch at `Queue`-press into the registry + idempotent withdraw route (reverses F4). Justified by the structural EQ-C1 gap and the hermes-agent reading.
2. **D2 WCAG** = fix both values to the AA floor (owner reverses his own DESIGN.md "accept" on these two).
3. **EQ-M2 dock** = follow the owner-confirmed design handoff (read-only queue band on finished iterations).
4. **W1** = name `workflow retry-node` for the idle-await fresh rerun.
   Carried forward unchanged: F1, F2, F5, F6; Delta 1, Delta 3, Delta 6.

## 7. Change-navigation checklist status

| Section                       | Status                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| §1 Trigger and context        | Done — 21:35 report, code-verified, F4 reversal justified by new evidence                        |
| §2 Epic impact                | Done — amend, no new/removed epic                                                                |
| §3 Artifact conflict analysis | Done — SPEC, both spines, engine-integration, api-contract, test-plan, epics, DESIGN, EXPERIENCE |
| §4 Path forward               | Done — Direct Adjustment (Rollback N/A, MVP holds)                                               |
| §5 Proposal components        | Done — this document                                                                             |
| §6.4 sprint-status.yaml       | N/A — no agent-node-room sprint status yet (generated post-correction)                           |

## 8. Unresolved questions

- **api-contract state names** — `queued` vs a clearer token for the accepted-onto-registry state is an authoring detail; pinned at apply time against the current file.
- **Per-provider abort terminal shape (codex, grok)** — carried from round 2: the exact operator-abort shape must be fixture-pinned before Story 1.7a is accepted (the F1 rule holds regardless).
- **`omp` vs `opencode` naming** — pre-existing, unchanged.
- **`test-plan.md` shows as git-modified but was NOT edited this round** — that `M` is round-2's F7 (generic-fallback corpus audit), still unstaged; round 3 edited `steering-test-plan.md`, not `test-plan.md`. Noted so the next reader does not attribute it to round 3.
