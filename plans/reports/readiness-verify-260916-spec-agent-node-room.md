# Readiness re-verification — spec-agent-node-room (2nd-pass remediation)

Date: 2026-09-16. Read-only verification. No files edited.
Scope: confirm the 10 issues from `implementation-readiness-report-2026-09-15` are genuinely
resolved in the CURRENT on-disk artifacts — cause-correct and internally consistent, not just
textually present.

## Per-issue verdicts

| #   | Issue                                   | Verdict                | Strongest evidence                                                                                                              |
| --- | --------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Queue ownership (`this tab only` scope) | RESOLVED               | Draft-only scope stated everywhere; band carries no scope label.                                                                |
| 2   | Finished-iteration steering (Story 1.6) | **PARTIAL**            | Resolved in SPEC/control-states/epics/handoff — but `EXPERIENCE.md:179` still asserts the refuted `not_steerable_here` refusal. |
| 3   | G2/OMP decouple (four gates)            | RESOLVED               | G2 Claude / G4 OMP on independent gates; per-item Send-now shared; G1–G4 consistent.                                            |
| 4   | Hybrid 1.7a/1.7b/1.8 (ACCEPTED)         | RESOLVED (do not flag) | Owner-ratified, `epics.md:291`.                                                                                                 |
| 5   | 1.7a/1.7b oversized                     | RESOLVED               | Both carry `_Packages:_` + `_Integration gate:_` lines.                                                                         |
| 6   | Story 1.8 Withdraw                      | RESOLVED               | Title + first AC + dedicated AC; error semantics match contract (no message-level 404).                                         |
| 7   | Story 1.9 keyboard shortcut             | RESOLVED               | Cmd/Ctrl+Enter AC: same action+guard, discoverable, visible word first (SC 2.5.3), plain Enter=newline.                         |
| 8   | Story 1.1 five-outcome expansion        | RESOLVED               | Table-driven AC covers all five outcomes, one test.                                                                             |
| 9   | Story 1.3 diff oracles                  | RESOLVED               | AC binds all five oracle facets to Story 1.3 completion.                                                                        |
| 10  | Story 1.12b queued-message idle-expiry  | RESOLVED               | AC: 30-min idle with queued present → fails once, tears down registry, 1.12a restores as NEVER SENT.                            |

## Evidence detail

**Issue 1 — RESOLVED.**

- `SPEC.md:86` (CAP-8 success): only the unsent composer draft is this-tab-only; a queued message is node-scoped + server-process-local, survives tab close, dies on server restart.
- `SPEC.md:135` (Two queues): draft per-tab; queued rides in-memory registry queue; "server-side … dies on a server restart."
- `epics.md:59` (FR8) draft this-tab / queue node-scoped; `epics.md:413/425` (Story 1.9) `this tab only` on unsent composer text only, band = `QUEUED · n`, no scope label.
- `epics.md:499` (Story 1.12a) reconciles "every queued `message_id` the dock displayed from the node's registry queue, not only this tab's own sends."
- `EXPERIENCE.md:92` "`this tab only` — on the unsent draft only (the `QUEUED` band carries no scope label)"; `:206` interaction-primitive; `:371` walkthrough; `:184` connection-lost — all scope this-tab to the draft.
- `DESIGN.md:645` band header canonically `QUEUED · 2` / `WILL SEND · 2` — no scope label.
- `README.md:292` `this tab only` labels the unsent draft only; band header is just `QUEUED · N`.
- No `on this node` coined string anywhere (grep empty across the three UX/handoff files); sprint proposal `:226` confirms it was dropped to avoid contradicting DESIGN's one-word-header intent.
- Correct model is affirmatively present, not merely the string removed: `EXPERIENCE.md:89` copy-decisions row (`QUEUED·2 / WILL SEND·2 / NEVER SENT·2` → "2 messages pending delivery", no scope label); `:174` 30-min-fail ("the in-memory queue dies with the run"); `:175` node-finished announce ("node finished · none of this was sent"); handoff `README` State section ("the per-tab **unsent draft** (queued messages are server-side, not client state)").
- Full-bundle grep for `this tab|per-tab|per tab|browser state|tab close` across SPEC, both ARCHITECTURE-SPINE files, engine-integration, test-plan, steering-test-plan, provider-steering-matrix, todo-fold, tool-presentation: the only hit outside EXPERIENCE/DESIGN/README is steering `ARCHITECTURE-SPINE.md:174`, which correctly scopes per-tab to the client draft ("The **client draft** is only the text still being composed (per-tab)"). No document asserts a QUEUED message is per-tab.

**Issue 2 — PARTIAL (the one real defect this pass found).**
Resolved in four of five authoritative sources:

- `SPEC.md:76` (CAP-6 success): "the composer is absent and no steering route is called for a finished iteration (steering targets only the live iteration; the Send route stays node-scoped and iteration-agnostic)."
- `control-states.md:50-59` first-class "Viewing a finished iteration of a live loop node": composer absent, client makes **no** steering route call, "There is nothing for the server to refuse … the only server refusals are node-finished (409) and detached."
- `epics.md:281` (Story 1.6 AC): "the client makes **no** steering route call for a finished iteration … so there is no server refusal to return."
- `README.md:154-158` (handoff §6): "the composer is absent and **no steering request is issued** — there is nothing to reject on arrival, and the node-scoped Send route carries no iteration identity to reject on." (No "rejected on arrival" retained.)
- `steering-api-contract.md:21` Send body `{message, message_id, intent}` keyed `(runId,nodeId)` — no iteration identity added (option (a)).

NOT resolved in the authoritative behavioral spine:

- **`EXPERIENCE.md:179`** (State Patterns, "Viewing an execution that is not the live one"): "A finished **iteration** of a still-live loop node is a distinct case … a message composed there **is still refused as `not steerable here`**. See Story 1.6."

Reconciliation attempt (required before declaring a defect):

- Claim A (four sources, NORMATIVE): finished-iteration → composer absent, no route call, no refusal.
- Claim B (`EXPERIENCE.md:179`, NORMATIVE — `epics.md:44` names EXPERIENCE.md the authoritative behavioral contract, and Story 1.6 `_Refs:_` cite it): finished-iteration → a composed message is refused `not_steerable_here`.
- No single implementation satisfies both: A requires no message composed and no route call; B requires a composed message returning a `not_steerable_here` server refusal. Mutually exclusive.
- Independent disproof: `steering-api-contract.md:49` returns `422 not_steerable_here` **only** for a detached run (no live handle in this process). A finished iteration of a _live_ loop node is in-process, so the server has **no code path** to produce `not_steerable_here` — Claim B is unimplementable as stated, which is the exact original Issue-2 defect.
- Root cause of the miss: the sprint change proposal's file map (`sprint-change-proposal-2026-09-16.md:87`) assigned `EXPERIENCE.md` only the D1 per-tab fixes; the D2 finished-iteration edit was scoped to SPEC + control-states + epics + handoff (`:84-88`) and never touched `EXPERIENCE.md:179`. Handoff §6 line 162 still lists "**Needs updating:** new rows in `EXPERIENCE.md` → State Patterns" — that update never landed.
- The applied-record's own verification claim (`sprint-change-proposal-2026-09-16.md:9`: "no not_steerable_here/rejected-on-arrival refusal") is therefore inaccurate for the finished-iteration case.

Fix (one edit, fully specified by the four aligned sources): in `EXPERIENCE.md:179` replace the finished-iteration clause "a message composed there is still refused as `not steerable here`" with the resolved model — composer absent, no steering route call, read-only band mirrors the node's pending queue (inert), delivered messages read back from the transcript occurrence group. Optionally split it into its own State-Patterns row per handoff §6:162.

**Issue 3 — RESOLVED.**

- `epics.md:34` overview lists G1 / G2 claude soft-inject / G4 omp soft-inject / G3 grok as post-v1 gated backlog.
- `epics.md:128` Epic 1 header "G1–G4 as post-v1 gated backlog"; `epics.md:123` FR Coverage Map "FR12 (CAP-12) soft-inject | G2 claude + G4 omp (post-v1, independent gates)."
- `epics.md:562-581` G2 (Claude soft-inject, spike gate) and G4 (OMP soft-inject, "conformance-gated, independent of G2 … does **not** wait on Claude's `AsyncIterable` spike").
- Per-item Send-now shared "wherever soft-inject exists": `epics.md:566` (G2, "Claude here; OMP via G4") + `epics.md:580` (G4, "renders here too … the shared soft-inject affordance stated in G2"). Not dropped, not OMP-only.

**Issue 4 — RESOLVED (do not flag).** `epics.md:291` "Story shape (owner-ratified 2026-09-15 — hybrid)" documents 1.7a/1.7b/1.8 as engine/transport tasks beneath the 1.9–1.10 operator outcome. (Report's D3 cite `epics.md:283` points to the Story 1.6 `_Refs:_` line; the ratification prose is at :291 — content present, cite offset only.)

**Issue 5 — RESOLVED.**

- `epics.md:317` (1.7a `_Refs:_`): "_Packages:_ @archon/workflows … @archon/providers … _Integration gate:_ the five-provider interrupt-conformance fixtures are green."
- `epics.md:347` (1.7b `_Refs:_`): "_Packages:_ @archon/workflows … @archon/server … _Integration gate:_ end-cause + idle-await green on **both** `executeNodeInternal` and `executeLoopNode`."

**Issue 6 — RESOLVED.**

- Title `epics.md:349` names Send / Interrupt / Keepalive / Withdraw.
- First route AC `epics.md:357` lists `DELETE …/queue/:messageId` (withdraw).
- Dedicated Withdraw AC `epics.md:397-399`: already-drained or unknown `message_id` → "the **same idempotent success no-op** — there is **no** message-level 404 (404 is only an unknown `runId`/`nodeId`)." Matches `steering-api-contract.md:32/61`. Does NOT say "404 for unknown message target."

**Issue 7 — RESOLVED.** `epics.md:428-429`: Cmd/Ctrl+Enter → same action + same blocked-state guard as Send; discoverable (composer hint + accessible-name note) with the visible word (`Queue`/`Send now`) kept at the **start** of the accessible name (SC 2.5.3); plain Enter still inserts a newline. Consistent with `epics.md:421`.

**Issue 8 — RESOLVED.** `epics.md:153-155`: table-driven initial expansion — `success` collapsed, `failed` expanded, `running` collapsed, `interrupted` collapsed, `unknown` collapsed — one focused test drives all five.

**Issue 9 — RESOLVED.** `epics.md:217-219`: on Story 1.3 close, the diff test contract is part of completion — byte ceiling (not only `maxEditLength`), repeated + mid-array no-newline markers, repeat determinism, memoization, adapter line-number validity — not deferred to references.

**Issue 10 — RESOLVED.** `epics.md:527-529`: idle-after-interrupt node with queued messages present → 30-min inactivity fails **once** on the explicit fail branch, tears down the registry (with its queued messages), and Story 1.12a restores unmatched queued messages as `NEVER SENT`.

## New contradictions scan

- **CONFIRMED DEFECT** — `EXPERIENCE.md:179` finished-iteration refusal (see Issue 2). NORMATIVE vs NORMATIVE, mutually exclusive, unimplementable per the API contract. Not newly introduced by the remediation; a leftover the D2 file-scope never covered.
- **NOT a defect (view/projection difference):** band-header case — `control-states.md:79` writes `Queued`/`Will send`/`Never sent` (title case, the DOM text) while `DESIGN.md:645` / `epics.md` write `QUEUED`/`WILL SEND`/`NEVER SENT` (the rendered form). `UX-DR7`/`DESIGN.md:645` mandate CSS `text-transform`, not literal DOM capitals — one implementation (title-case DOM + CSS uppercase) satisfies both. Consistent, not a conflict.
- **NOT a defect:** detached status code — `steering-api-contract.md:49` fixes detached → `422 not_steerable_here`; `epics.md:367` defers to "status per the api-contract"; `control-states.md:83` / `EXPERIENCE.md:187` use the prose label without a code. Consistent.
- Route names (send/interrupt/keepalive/withdraw) match across `steering-api-contract.md:14-17`, `epics.md:357`, and Additional Requirements `epics.md:84`. No route named in one place but missing in another.
- No `on this node` coined copy anywhere (grep empty).
- **WARNING (not a defect) — SPEC enumerates only G1–G3; epics has G1–G4.** `SPEC.md:130` ("`delivered` (G1), claude soft-inject (G2), and grok hooks (G3) are post-v1 gated backlog") and `SPEC.md:176` ("claude soft-inject = G2, grok hooks = G3, the `delivered` chip = G1") never name G4 / OMP soft-inject, which `epics.md` (`:34/:123/:576-581`) carries everywhere. The M1 split (G2→G2+G4) touched epics only; the SPEC edits in the proposal were CAP-6/CAP-8. Reconciliation: not mutually exclusive — SPEC does not say "exactly three," and both agree OMP soft-inject sits outside the v1 floor — so WARNING, not defect. Effect: a reader of SPEC alone never learns OMP soft-inject exists as a named gate. The Issue-3 check was epics-scoped, so its RESOLVED stands.
- **WARNING (stale label) — `epics.md:84`** (Additional Requirements) says the steering routes sit "under `resolveAuthContext` (HITL/AD-7)", while `SPEC.md:137`, `steering-api-contract.md:7`, and Story 1.8 (`epics.md:359/369-371`) all say the steering **actor grant (AD-11)** _broadens_ HITL/AD-7 for these routes (any authenticated identity, identity-less run allowed). Same mechanism, stale label — one-line fix, no behavioral conflict.

## Overall verdict

**READY-WITH-CONCERNS.**

Nine of ten issues are cleanly resolved and cause-correct. Issue 2 is resolved in four of five
authoritative sources; the fifth — `EXPERIENCE.md:179`, the authoritative behavioral spine that
Story 1.6 implementers are pointed to — still carries the refuted, unimplementable
`not_steerable_here` finished-iteration refusal. This is a genuine normative contradiction on the
exact point Issue 2 exists to fix, and it makes the applied record's "no not_steerable_here refusal"
verification claim inaccurate.

It does not block the read slice (Stories 1.1–1.5) or the steering engine slice (1.7a–1.8): it is a
single stale State-Patterns line whose correct replacement is unambiguously specified by the four
aligned sources. It **must** be fixed before Story 1.6 (finished-iteration dock) is implemented, or a
build following EXPERIENCE.md will reintroduce an unimplementable server refusal.

## Unresolved questions

- Precedence on a behavioral conflict between a spec companion (`control-states.md`, first-class) and the adopted `EXPERIENCE.md` spine: `SPEC.md:27` calls SPEC+companions "the complete contract," while `epics.md:44` names EXPERIENCE.md the "authoritative design contract." For this defect it is moot (fix EXPERIENCE.md:179), but the two precedence statements are worth reconciling for future conflicts.
