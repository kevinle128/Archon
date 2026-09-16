---
title: Sprint Change Proposal — Agent Node Room steering-contract remediation (round 2)
date: '2026-09-15'
project: Archon
scope: spec-agent-node-room
trigger: plans/reports/implementation-readiness-260915-1930-spec-agent-node-room.md (NOT READY, assessor Codex)
predecessor: _bmad-output/planning-artifacts/epics-agent-node-room/sprint-change-proposal-2026-09-15.md (status: applied — round 1)
status: applied (2026-09-15) — F5 = hybrid ratified; F1–F8 written to the artifacts below in this session
path_forward: Direct Adjustment
mode: incremental
owner: kevin
owner_decisions_this_round:
  - 'F2 — steering actors: ANY authenticated identity may steer a run (send/interrupt/keepalive); attributed by operator_user_id; unauthenticated → 401; identity-less run → allow. Broadens HITL/AD-7 for the steering routes only (2026-09-15).'
  - 'F6 — AI loop nodes ARE steerable in v1: extend the registry + provider-neutral end-cause rule + sub-state projection + idle-await to executeLoopNode; tests on both execution paths (2026-09-15).'
  - 'F4 — the operator queue is CLIENT-side: x/delete is client-local (no server route); queued messages auto-dispatch at the natural turn boundary; Send now dispatches immediately; NO withdraw route (2026-09-15).'
owner_decisions_carried_forward:
  - 'Floor = v1 (2026-09-15, round 1) — unchanged.'
  - 'Contrast override (2026-09-15, round 1) — unchanged.'
  - 'Delta 3 queue full-bleed band (2026-09-15, round 1) — unchanged.'
owner_decision_f5:
  - 'F5 — steering story boundaries: HYBRID (owner-ratified 2026-09-15). First steerable milestone becomes a user-visible outcome story; registry/turn-loop/routes become tasks beneath it; five-provider conformance fixtures stay as acceptance tests.'
artifacts_to_touch:
  - _bmad-output/specs/spec-agent-node-room/SPEC.md
  - _bmad-output/specs/spec-agent-node-room/engine-integration.md
  - _bmad-output/specs/spec-agent-node-room/steering-api-contract.md
  - _bmad-output/specs/spec-agent-node-room/steering-test-plan.md
  - _bmad-output/specs/spec-agent-node-room/test-plan.md
  - _bmad-output/planning-artifacts/architecture/architecture-Archon-live-agent-steering-2026-09-12/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/epics-agent-node-room/epics.md
---

# Sprint Change Proposal — Agent Node Room steering-contract remediation (round 2)

## 1. Issue summary

The round-1 correction (predecessor above, `status: applied`) fixed the first readiness report's 17 items (traceability, oversized stories, the four contradictions, the two new companions).
A **second** readiness assessment on the corrected bundle — `implementation-readiness-260915-1930-spec-agent-node-room.md`, assessor Codex — returned **NOT READY** again, but with _deeper, code-verified_ findings, not a repeat of round 1.
The report assessed the post-fix bundle: SPEC 19:16 → round-1 proposal 19:29:57 → this report 19:30.

8 findings: **2 critical/blocking** (F1, F2), **5 major** (F3–F7), **1 minor** (F8).
No top-level capability is missing (traceability stays 100%); the gaps are contract-level — the current artifacts cannot yield one safe, conforming implementation of the steering half.

This is a **planning-document correction** discovered at a readiness gate. No implementation code exists for this spec, so nothing rolls back.

### Verification (findings locked against source, per the sticky-decision rule)

F1 and F2 reverse or amend round-1 / architecture decisions; that is legitimate only because they bring code the round-1 check never read. Confirmed in-session:

- **F1 — DeepSeek** `abortedResult()` (`packages/providers/src/community/deepseek/acp-client.ts:105`, enqueued `:369`) emits `{ type: 'result', stopReason: 'aborted', errorSubtype: 'deepseek_aborted' }` on operator abort. **OMP** throws `new Error('Query aborted')` (`packages/providers/src/community/omp/provider.ts:317,450`); a throw reaches the executor catch (`packages/workflows/src/dag-executor.ts:3332`) → `dag_node_failed`.
- **F2** — the only in-repo steering-adjacent auth precedent, `authorizeWorkflowNodeRetry` (`packages/server/src/routes/api.ts:3064`), is owner-or-admin (owner `:3074`, admin `:3077`, 401 unauth).

## 2. Impact analysis

### Epic impact

Epic 1 stays; no epic added or removed; the read-first sequence is unchanged.
The steering stories (1.7a–1.12c) take contract amendments (F1–F4, F6), a possible story-boundary rethink (F5), and dependency/criteria cleanup (F8).
The read half is clean except F7 (a release-measurement gap on Story 1.2).

### Story impact

- 1.7a / 1.7b — provider-neutral end-cause rule (F1); loop-path extension (F6); possible vertical-outcome reframe (F5).
- 1.8 — auth actor matrix (F2); truthful interrupt receipt (F3); client-side dispatch wording (F4); split compound criteria (F8).
- 1.9 — Queue holds client-side; dispatch at drain (F4).
- 1.10 — interrupt-response race outcomes (F3).
- 1.2 — reproducible <2% procedure (F7).
- 1.11 — add the 1.8 dependency (F8).
- 1.12b — add the 1.8–1.10 dependencies + split criteria (F8).
- 1.12c — already assumes multi-operator; confirmed by F2.

### Artifact conflicts

| Artifact                                           | Impact                                                                                                                                                                                       |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SPEC.md`                                          | Write-half `result`-discriminator clause (F1); actor-grant note (F2); no queue change needed — C-18 already says "two queues, split on send vs draft".                                       |
| `engine-integration.md`                            | §1 line 9 + §2 line 33 discriminator premise "a stream-abort yields none" (F1); §2 natural/interrupted drain wording → client-dispatch (F4); §2 idle-await unchanged.                        |
| Steering spine (`…live-agent-steering-2026-09-12`) | AD-2:107 discriminator (F1); AD-11:171 actor grant (F2); AD-11:172 dispatch-at-drain note (F4).                                                                                              |
| `steering-api-contract.md`                         | Identity rule line 7 (F2); interrupt response line 29 (F3); send route = dispatch-at-drain, drop server `'queued'` state (F4).                                                               |
| `steering-test-plan.md`                            | DeepSeek abort-result + OMP abort-throw fixtures + natural-end race (F1); allow/deny auth tests (F2); interrupt-race tests (F3); client-delete-before-drain test (F4); loop-path tests (F6). |
| `epics-agent-node-room/epics.md`                   | Stories 1.7a/1.7b/1.8/1.9/1.10/1.11/1.12b + possible 1.7 reframe (F5); loop ACs (F6); Story 1.2 <2% (F7); dependency/criteria cleanup (F8).                                                  |
| `test-plan.md`                                     | Story 1.2 reproducible generic-fallback procedure (F7).                                                                                                                                      |

### Technical impact

No database migration, no schema change (the operator row stays three additive JSON metadata fields, AD-6; the display name stays a read-time projection, AD-12).
F2 broadens an _authorization_ rule (owner-ratified) — a policy change in route code + tests, not a data change.
F6 adds a second executor path (`executeLoopNode`) to the steering surface — real added implementation scope, no new persisted state.
`api.generated` regenerates for the interrupt-response and send-response schema edits (F3, F4).

## 3. Recommended approach

**Direct Adjustment** — amend the SPEC, the steering spine, `engine-integration.md`, the two companion contracts, the epic breakdown, and `test-plan.md` in place. No new epic; no rollback (no code shipped).

- Rollback: N/A (nothing implemented).
- PRD MVP: holds. The v1 floor (interrupt + `Queue` + `sent`, every provider) is unchanged. F6 _adds_ loop coverage inside v1 (owner choice); it does not move the floor.
- Effort: **Medium–High** for a doc correction — F1 and F6 touch two executor paths and five providers in the contracts; F2 amends architecture auth.
- Risk: Low (documents only, reversible per artifact).

## 4. Detailed change proposals

Grouped by finding. `OLD`/`NEW` are exact replacements where a single clause changes; new rules that span files are given as a rule + a target list (the implementing agent writes final prose into each target).

### F1 — Critical: one provider-neutral end-cause rule (replaces "a stream-abort yields none")

**Broken premise (quoted):**

```
engine-integration.md §2:33 / steering AD-2:107
"The discriminator is 'did the turn emit a `result`', not the flag alone.
 The executor already consumes a provider-normalized `msg.type === 'result'` (:2533);
 a stream-abort yields none. … Only a turn that produced no `result` with
 operatorInterrupt set is an interrupted end."
```

False on two in-use providers (verified §1): DeepSeek's abort **emits** a `result` (→ misread as a natural end, wrongly auto-drains/completes); OMP's abort **throws** (→ never reaches the rule, hits `:3332` → `dag_node_failed`).

**New rule — end-cause resolved in the executor from five cases when the per-turn `operatorInterrupt` fired:**

1. **Natural `result`** (no abort marker) → natural end; interrupt spent; auto-drain/complete.
2. **Operator-aborted `result`** — a `result` carrying an abort marker (DeepSeek `stopReason:'aborted'` / `errorSubtype:'deepseek_aborted'`) with `operatorInterrupt` set → **interrupted end** → idle-await.
3. **Abort throw** — a thrown abort (OMP `Query aborted`) caught at `:3332` with `operatorInterrupt` set → **interrupted end** → idle-await, **not** `dag_node_failed`.
4. **Real provider failure** — a throw with `operatorInterrupt` NOT set → genuine `dag_node_failed` (unchanged).
5. **Node Cancel** — `nodeAbortController` (`:3124`) → existing cancel path, dominates by position (unchanged).

**Sub-decision (Claude default — resolves the report's open question 4):** classify in the executor's end-cause resolver; **never suppress** the abort `result` inside the provider adapter. Fail-Fast + the abort-marked `result` stays visible to other executor consumers. (This is not the natural-language-wire-format concern — the executor recognizes a _typed_ abort marker, not prose.)

**Amend:** SPEC write-half `result`-discriminator clause · `engine-integration.md` §1:9 ("a stream-abort … ends the turn") + §2:33 + §2 natural/interrupted end rules · steering AD-2:107 · Story 1.7a (provider-conformance table) · Story 1.7b AC (`epics.md:311`) · `steering-test-plan.md` (add a DeepSeek abort-`result` fixture, an OMP abort-throw fixture, and the natural-end race, per provider). Applies to **both** `executeNodeInternal` and `executeLoopNode` (F6).

### F2 — Critical: explicit steering actor grant (owner: any authenticated user)

**OLD** (`steering AD-11:171`):

```
…resolving the acting identity via `resolveAuthContext` under HITL/AD-7's
run-mutation rule (not a new grant).
```

**NEW:**

```
…resolving the acting identity via `resolveAuthContext`. Steering defines its own
actor grant (owner-ratified 2026-09-15), broadening HITL/AD-7 for the live-session
steering routes ONLY: any AUTHENTICATED identity may send / interrupt / keepalive a
running node, each request attributed by `operator_user_id` (AD-6). Unauthenticated
→ 401; a run with no `user_id` (solo / identity-less install) → allowed. This is a
deliberate steering-specific grant — steering acts on a live session and concurrent
multi-operator steering (CAP-11 / receipt order below) requires it. It does NOT touch
the retry / cancel / approve mutation rules, which keep HITL/AD-7's starter-or-admin form.
```

Mirror the one-line change in `steering-api-contract.md:7`.
**api-contract error table:** 401 `unauthenticated` stays; 403 `forbidden` becomes unreachable for identity reasons under this grant — keep the shape, note it fires only if a future policy narrows actors.
**Tests (send + interrupt + keepalive):** starter → allow, other authenticated member → allow, admin → allow, unauthenticated → 401, identity-less run → allow. Amend Story 1.8 AC + `steering-test-plan.md`; Story 1.12c (multi-operator) is confirmed, not changed.

> Rule note: this is a real broadening of the inherited starter-only permission, made as an explicit owner decision (matches project-context "visibility stays open today"). Recorded so it is never mistaken for a silent widen.

### F3 — Major: truthful interrupt receipt for the natural-end race

**OLD** (`steering-api-contract.md:29`): the only success shape is `{ success: true, sub_state: 'idle-after-interrupt' }`.
**Problem:** if the turn ends naturally before Stop lands and messages are queued, the interrupt is spent, the queue auto-drains, and the agent is **generating** — not idle (`engine §2:38`, AD-2:107, `EXPERIENCE.md:176`).
**NEW response:** `{ success: true, sub_state: 'idle-after-interrupt' | 'generating' }` — `idle-after-interrupt` = interrupt landed; `generating` = interrupt spent by a natural end, queue auto-drained into turn N+1. The empty-queue spent case = node completed → route returns **409 `node_finished`** (already in the table).
**Amend:** api-contract Response + Idempotency/races; Story 1.8 (interrupt AC) + Story 1.10; `steering-test-plan.md` (interrupt race: mid-turn → idle; natural-end + non-empty queue → generating; natural-end + empty queue → 409).

### F4 — Major: the operator queue is client-side (owner-confirmed); no withdraw route

C-18 already says _"Two queues, split on send vs draft"_ (draft = client per-tab, registry = server). The only defect is that **Story 1.9 + the api-contract put the client→server crossover at `Queue`-press** instead of at drain.

**OLD** (`epics.md:366-367`, Story 1.9):

```
When the message is held
Then it is sent to the Story 1.8 send route, the node is untouched, no tool call is
interrupted, nothing is lost, and it is delivered as the next turn when the current
turn ends naturally.
```

**NEW:**

```
When the message is held
Then it is held in the client draft box (per-tab, per-node) — NOT yet dispatched;
the node is untouched, nothing interrupted. keep and `x` (delete) are client-local
(no server call). The client dispatches the queued batch to the send route at the
DRAIN moment — automatically when the current turn ends naturally, or on `Send now`
after an interrupt — never at `Queue`-press.
```

**api-contract:** state the send route is the **dispatch** call (client→server at drain), `intent: 'queue'` (drain at the natural boundary) | `'send_now'`; the send response `state` describes post-dispatch server state (`delivered_next_turn` | `awaiting_send_now`); **remove the pre-dispatch `'queued'`** value (it is client-only, never a server response).
**engine §2 / AD-4 / AD-11:172:** clarify the natural-boundary auto-drain is the **client dispatching** the held queue at turn-end; the two queues cross over at **dispatch**, not at Queue-press.
**No withdraw route** — a deletable message is never on the server, so `x` needs no transport.
**Implementation note (not re-opened):** the client times the boundary dispatch off the sub-state stream it already consumes for the dock; a dispatch that races a completion is caught by the existing terminal reconciliation ("Never sent", AD-11:174) — no new mechanism.
**Test:** message Queued (client) → `x`-deleted before the drain → never dispatched (no send-route call).

### F5 — Major: steering story value split — OWNER DECISION AT APPROVAL (not auto-applied)

The report flags Stories 1.7a/1.7b/1.8 as engine/system-only ("As the engine" / "As the system"), no operator-visible outcome.
**Tension to surface (per the guard-user-decisions rule):** round-1 split 1.7 into 1.7a/1.7b _because_ report-1 called 1.7 oversized. A plain re-merge re-breaks report-1. The split was **Claude-proposed** (not in the owner-decisions list), so it is in the safe-to-change tier — but it is a same-day flip between assessors and needs a visible nod, not a silent revert.
**Recommended (hybrid):** keep the engine work, but make the FIRST steerable milestone a **vertical outcome** story — e.g. _"an operator interrupts and Send-nows a running node end-to-end on one provider"_ — with the registry, per-turn signal, turn loop, and routes as **implementation tasks beneath it**; keep the five-provider conformance fixtures as acceptance tests. This satisfies both reports (sized _and_ user-valued).
**Choose at approval:** (a) keep the 1.7a/1.7b/1.8 split as-is (accept the "no independent value" note), (b) restructure to the vertical outcome above, or (c) hybrid.

### F6 — Major: AI loop nodes steerable in v1 (owner: INCLUDE)

`loop` nodes (and provider-calling nodes in `loop_group` bodies) run via `executeLoopNode` (`dag-executor.ts:5718`, dispatch `:8835`), separate from `executeNodeInternal` where every steering rule is anchored.
**Owner decision: include in v1.** Extend to `executeLoopNode`: the registry entry + key, the per-turn signal + `operatorInterrupt`, the provider-neutral end-cause rule (F1), the `generating | idle-after-interrupt` sub-state projection, and idle-await. Specify **iteration semantics** — `Send now` continues the interrupted iteration on the same session **before** the normal loop-completion check — and session continuity across iterations.
**Amend:** SPEC C-15/C-16 (name both execution paths) · steering AD-1 scope note (stays "where there is a live agent session"; now realized for the loop path) · Stories 1.7a/1.7b ACs (both paths) · `steering-test-plan.md` (focused tests on `executeNodeInternal` AND `executeLoopNode`, incl. the loop iteration/continuation case).
**Effort note:** this is the round's largest added implementation surface — a second executor path through every steering engine story.

### F7 — Major: reproducible <2% generic-fallback check

Story 1.2 requires the generic fallback under 2% of the production corpus (22,867 rows), but no reproducible procedure exists.
**Fix (procedure, not fabricated numbers):** add a **release-time, read-only replay** — a script that queries the deployment DB corpus, runs the resolver, and reports the generic-fallback numerator/denominator — plus its recording location; keep the alias unit cases as CI regression. Classify as a **release-time deployment audit**, not a CI fixture (the corpus is deployment data). Do **not** freeze a numerator/denominator in the doc — that needs a live corpus re-measure, out of scope for a document correction.
**Amend:** Story 1.2 AC + `test-plan.md`.

### F8 — Minor: dependency declarations + compound-criteria cleanup

- Declare the implicit dependencies: Stories 1.2–1.6 → 1.1; Story 1.11 → +1.8; Story 1.12b → +1.8–1.10 (keepalive route + dock).
- Split compound Given/When/Then in Stories 1.8 and 1.12b into one scenario per observable outcome (the steering test plan already separates them).
  **Amend:** `epics-agent-node-room/epics.md`. Mechanical; safe to auto-apply.

## 5. Implementation handoff

**Scope classification: Moderate**, with **Architect involvement required** for the AD-2 end-cause amendment (F1) and the AD-7/AD-11 authorization amendment (F2).

**All amendments were applied in this session** (F5 = hybrid ratified). Edited in place: the steering `ARCHITECTURE-SPINE.md` (AD-2 end-cause, AD-11 actor grant + client-queue), `engine-integration.md` (§2 end-cause + client/server queue), `SPEC.md` (end-cause, actor grant, two-queue clarification), `steering-api-contract.md` (identity grant, interrupt-race response, dispatch-at-drain, dropped server `'queued'`), `steering-test-plan.md` (DeepSeek/OMP abort fixtures, actor matrix, interrupt race, client-delete, loop-path), `test-plan.md` (generic-fallback corpus audit), and `epics-agent-node-room/epics.md` (F5 hybrid framing, loop ACs, 1.7b end-cause, 1.8 grant/race/split, 1.9 client queue, 1.11/1.12b deps, 1.12b split, Story 1.2 audit). Verified: the broken premises ("a stream-abort yields none", AD-11 "not a new grant", Story 1.9 "sent to the send route", api `state:'queued'`) return 0 hits; the new rules are present across all expected files.

Remaining (not document edits):

| Step                                                                                                   | Owner                               |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| Re-run `/bmad-check-implementation-readiness` on the corrected bundle                                  | bmad-check-implementation-readiness |
| Run `/bmad-sprint-planning` for agent-node-room (still no sprint status)                               | bmad-sprint-planning                |
| At build time: an Architect confirms the AD-2 end-cause classifier + AD-11 actor grant land as amended | bmad-architect / dev                |

**Success criteria:**

- A re-run returns READY for the v1 steering scope (Floor = v1, now including loop nodes).
- One provider-neutral end-cause rule covers natural `result`, operator-aborted `result` (DeepSeek), abort throw (OMP), real failure, and Cancel — on both executor paths, with fixtures.
- The steering routes have an explicit, tested actor matrix (any authenticated user; unauth 401; identity-less allow).
- The interrupt response can truthfully report the natural-end race; the operator queue is documented client-side with a client-local delete and no withdraw route.
- Story 1.2 has a reproducible generic-fallback procedure.
- No migration, no schema change.

## Change-navigation checklist status

| Section                        | Status                                                                                    |
| ------------------------------ | ----------------------------------------------------------------------------------------- |
| §1 Trigger and context         | Done — 19:30 readiness report, code-verified                                              |
| §2 Epic impact                 | Done — restructure/amend, no new/removed epic                                             |
| §3 Artifact conflict analysis  | Done — SPEC, spine, engine-integration, both companions, epics, test-plan                 |
| §4 Path forward                | Done — Direct Adjustment (Rollback N/A, MVP holds)                                        |
| §5 Proposal components         | Done — this document                                                                      |
| §6.4 Update sprint-status.yaml | N/A — no agent-node-room sprint status yet (generated post-correction by sprint-planning) |

## Owner decisions recorded

**This round (2026-09-15):**

1. **F2 — steering actors** = any authenticated identity may steer; attributed by `operator_user_id`; unauth 401; identity-less run allowed. Broadens HITL/AD-7 for steering routes only.
2. **F6 — AI loop nodes** = steerable in v1; extend the full steering engine surface to `executeLoopNode`; test both paths.
3. **F4 — operator queue** = client-side; `x`/delete is client-local; auto-dispatch at the natural turn boundary; `Send now` dispatches immediately; no withdraw route.

**Carried forward unchanged (round 1):** Floor = v1 · contrast override · Delta 3 queue band.

**Open (decide at approval):** F5 steering story boundaries — keep split / restructure to vertical / hybrid (recommended: hybrid).

## Unresolved questions

- **F5 boundary** — awaiting kevin's a/b/c choice (§4 F5).
- **F1 abort-marker recognition per provider** — DeepSeek is `stopReason:'aborted'` + `errorSubtype:'deepseek_aborted'` (verified); the exact terminal shape of an operator-abort on **codex** and **grok** stream-abort (result vs throw vs clean end) must be pinned by a fixture each in `steering-test-plan.md` before Story 1.7a is accepted — the F1 rule holds regardless, but the per-provider branch it takes is fixture-driven.
- **`omp` vs `opencode` naming** — pre-existing (round 1 left it open); unchanged here.
