# Sprint Change Proposal: Grok live-turn release gate

**Status:** Approved by the user on 2026-09-24 for the listed planning-source changes and a new readiness check; product code and approved mockups are outside this approval.
**Date:** 2026-09-24.
**Mode:** Incremental.
**Target:** Agent Node Room, Legacy and Console.
**Decision:** The user requires Grok per-item Send now during the active agent turn in this release and approved Edits 1–3 on 2026-09-24.
**Evidence:** [Post-repair readiness report](../../_bmad-output/planning-artifacts/implementation-readiness-report-2026-09-24-after-repair.md), [validated manifest](../../_bmad-output/planning-artifacts/mockup-manifests/agent-node-room.json), and [earlier approved change proposal](sprint-change-proposal-260924-1722-agent-node-room-readiness.md).

## 1. Issue summary

The post-repair implementation-readiness review found one blocking scope conflict.
Current planning sources call G3 Grok hook work future or deferred without an explicit user decision.
The user has now made that decision: G3 is a current release gate, and Grok must support per-item Send now during the active agent turn in this release.
This proposal supersedes only the earlier change proposal's statement that Grok hook work is not required for this release; its seven-defect planning repair remains in force.
This decision does not prove that Archon's Grok adapter can yet accept live input.
Archon's current `grok --single` mode remains queue-only and must omit per-item Send now until a separate Grok live-turn mode passes the release gate.
All 70 manifest product items remain current, and the approved mockups remain unchanged.

## 2. Impact analysis

### Requirements and PRD-equivalent source

`_bmad-output/specs/spec-agent-node-room/SPEC.md` is the canonical Agent Node Room requirements source; this target has no separate PRD.
Its CAP-12 and current-release sections must list G3 as a required Grok proof gate.
Its Open questions section must replace the deferred G3 classification with a current prerequisite.
The companion provider matrix, engine integration, control-state, API, and verification contracts must preserve queue-only refusal for the existing `--single` mode while describing the new proof gate consistently.

### Epic and Story impact

Completed Epics 1–3 and their Stories remain historical records.
The Epic overview must state that the user's current G3 decision supersedes the old Epic 3 future label.
Current Epic 4 Stories 4.3, 4.4, and 4.6 must include Grok as a provider-specific release proof and conformance path, without changing the other 70-item acceptance rules.
No completed Story needs to be reopened or rewritten.

### Architecture and UX impact

Both Architecture spines and both target UX documents currently list G1, G2, and G4 as current gates.
They must add G3 while retaining the rule that capability is projected by the exercised Archon adapter and mode.
The steering Architecture spine must remove Grok hook exploration from its Deferred table and define its current proof boundary.
The visible queue-only state for `grok --single` and the approved Legacy and Console mockups do not change.

### Technical and tracking impact

`packages/providers/src/grok/provider.ts` currently starts a one-shot `grok --single` turn.
The provider matrix records a third-party ACP `x.ai/interject` result of `-32601 Method not found` and an advertised but unexercised hook channel.
Neither fact proves Grok live-turn delivery in Archon.
The release gate requires a reachable Grok input path, active-turn identity, exact selected-item transport acceptance, and independent causal proof before a row changes from `sent` to `delivered`.
This proposal changes planning only; implementation and tests follow in Epic 4.
The generated sprint tracker must be handled by its supported workflow after planning approval and readiness, not hand-edited here.

## 3. Recommended approach

Make a direct adjustment to the current requirements, Architecture, UX, and Epic 4 acceptance sources.
Keep the existing `--single` adapter queue-only while proving a separate Grok path.
Treat a hook as a candidate mechanism, not a proven capability or the only acceptable implementation.
If the hook cannot accept the selected item during the same active turn, an alternative Grok path needs the same proof; otherwise the G3 release gate fails.
An RPC acknowledgement alone proves transport acceptance and cannot mark the item delivered.
An unrelated stream cannot prove consumption.
Do not silently turn per-item Send now into Queue, Stop, or a new turn.

This is a moderate planning adjustment with low data risk and a high implementation proof risk.
The planning edit is small; the delivery schedule cannot be fixed until the actual Grok transport is exercised.
Rollback of completed Stories would not settle the scope conflict.
Scope reduction would conflict with the user's current G3 decision.

## 4. Incremental edit proposals

### Edit 1 — Requirements and provider evidence (approved for proposal)

**Targets:** `SPEC.md` CAP-12, Current release scope, and Open questions; `provider-steering-matrix.md`; affected companion contract and verification clauses.

**Old:** “Deferred — Grok hooks payload,” and the current gate list names only G1, G2, and G4.

**New:** G3 is a current release proof gate for Grok live-turn delivery.
The current `--single` mode stays queue-only and omits per-item Send now.
A new Grok mode may expose that action only after the actual Archon transport proves that exactly the selected queued item enters the same active turn without Stop, natural-end wait, or a new turn and proves causal agent receipt.
Transport acceptance removes only that item and creates its one `sent` row; only causal agent-consumption evidence changes it to `delivered`.
An unproved or failed path blocks the G3 release claim and retains typed refusal.

**Why:** The user has selected current release scope, while the provider evidence does not establish a working live-input path.

### Edit 2 — Architecture and UX gate wording (approved for proposal)

**Targets:** Both Agent Node Room Architecture spines; target `DESIGN.md` and `EXPERIENCE.md`.

**Old:** Current-gate statements list G1, G2, and G4; the steering spine lists Grok hook exploration under Deferred.

**New:** Add G3 as a current provider-specific release gate and remove its Deferred classification.
Keep the `--single` queue-only UI state until a new Grok path proves the active-turn action and causal agent receipt.
Do not change approved mockups, fixture boundaries, or the per-item versus dock Send now distinction.

**Why:** Architecture and UX must state the same release scope as the canonical requirement source.

### Edit 3 — Epic 4 and verification handoff (approved for proposal)

**Targets:** Current overview and Epic 4 Stories 4.3, 4.4, and 4.6 in `epics.md`; affected steering test-plan clauses.

**Old:** Epic 4 release proof and final dependency lists name G1, G2, and G4, while completed Epic 3 labels G3 future.

**New:** State in the current overview that the user’s G3 decision supersedes the historical future label.
Add the Grok active-turn proof to Story 4.3, queue-only `--single` refusal and status evidence to Story 4.4, and G3 conformance to Story 4.6’s release dependency.
Require both rooms to show per-item Send now on a Grok mode only after actual proof, and retain the 70-item manifest gate.
Do not rewrite completed Epics or Stories.

**Why:** The implementation backlog needs one current release criterion without erasing historical delivery records.

## 5. Provider verification and race gate

1. Exercise the actual Grok adapter and mode proposed for live input.
   Record the command, protocol, version, and transport path used by Archon.
2. Prove that one selected, server-owned queued `message_id` is accepted into the same active turn while the agent generates.
   Test tool-boundary and pure-text cases; a hook that only runs at a tool boundary cannot establish universal active-turn behavior by assumption.
3. Prove that Stop, natural turn end, Cancel, retry-epoch change, Delete, and concurrent operators cannot duplicate the item, silently send it next turn, or reorder unrelated queued items.
4. Keep an accepted item `sent` until a matching native lifecycle event or causally linked stream proves that the agent consumed it.
   An RPC acknowledgement, unrelated output, text match, or timestamp is insufficient.
5. Verify that current `--single` remains queue-only and refuses direct per-item requests without queue or transcript mutation.
6. Keep the release blocked if no exercised Grok path passes the gate.

## 6. Handoff and success criteria

The planning owner updates the selected canonical sources after the complete proposal receives explicit approval.
The product owner accepts the current G3 scope in Epic 4.
The implementation owner proves the Grok path through the actual Archon adapter and both room surfaces.
The readiness reviewer runs a fresh 70-item alignment check after source repair; a READY verdict permits Sprint Planning.
The tracker owner updates generated sprint state through its supported workflow after the planning gate passes.

Success requires no active G3 future/deferred label in current planning authority, no visible action on queue-only `--single`, and a provider-specific proof gate for same-turn acceptance and causal consumption.
The 70-item inventory, nine changed-feature rows, 61 unchanged-context rows, and completed Story history remain intact.

## 7. Change-navigation checklist

| Item                         | Result                                                                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1.1–1.3 trigger and evidence | Done; the post-repair NOT READY report identifies an unsupported G3 deferral. No new Story triggered it.                            |
| 2.1–2.5 Epic impact          | Done; current Epic 4 needs a G3 gate, while completed Epics 1–3 remain historical. No resequencing is needed.                       |
| 3.1 requirements             | Done; SPEC is this target's PRD-equivalent source. The 70-item current scope remains.                                               |
| 3.2 Architecture             | Done; both spines need current G3 gate wording, and the steering spine must remove the Deferred row.                                |
| 3.3 UX                       | Done; both UX sources need gate wording, with no mockup or visible queue-only change.                                               |
| 3.4 other artifacts          | Done; provider matrix and steering verification prose need the same gate. No deployment change is proposed.                         |
| 4.1 direct adjustment        | Viable; add G3 to current planning and conformance work. Planning effort low, implementation proof risk high.                       |
| 4.2 rollback                 | Not viable; completed Story rollback does not resolve the scope decision.                                                           |
| 4.3 MVP reduction            | Not viable; the user selected G3 as a current release gate.                                                                         |
| 4.4 selected path            | Done; direct adjustment of current sources and Epic 4.                                                                              |
| 5.1–5.5 proposal and handoff | Done; sections 1–6 include three approved incremental edits, proof gates, and handoff.                                              |
| 6.1–6.2 final review         | Done; checked against the readiness finding, selected source clauses, current Grok adapter, and validated manifest boundary.        |
| 6.3 explicit approval        | Done; the user approved the complete proposal after separate incremental and full-proposal review.                                  |
| 6.4 sprint tracker           | Pending supported tracker workflow after planning and readiness.                                                                    |
| 6.5 handoff                  | Done; planning owner updates current sources and runs readiness, then implementation and tracker owners receive the approved gates. |

## Unresolved questions

The actual Grok live-input channel and its causal consumption evidence remain unproved implementation gates.
