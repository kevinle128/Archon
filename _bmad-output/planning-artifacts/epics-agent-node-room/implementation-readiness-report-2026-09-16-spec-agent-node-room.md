---
status: superseded
type: re-assessment
date: '2026-09-16'
project: Archon
scope: spec-agent-node-room
supersedes: implementation-readiness-report-2026-09-15-spec-agent-node-room.md (NOT READY, 10 issues)
remediation: sprint-change-proposal-2026-09-16.md (status: applied)
verification: plans/reports/readiness-verify-260916-spec-agent-node-room.md (independent pass)
verdict: SUPERSEDED
historicalVerdict: READY (accepted deviations only)
supersededBy: epics.md two-epic and 20-story recut approved 2026-09-16
includedFiles:
  - _bmad-output/specs/spec-agent-node-room/SPEC.md
  - _bmad-output/specs/spec-agent-node-room/control-states.md
  - _bmad-output/specs/spec-agent-node-room/engine-integration.md
  - _bmad-output/specs/spec-agent-node-room/provider-steering-matrix.md
  - _bmad-output/specs/spec-agent-node-room/steering-api-contract.md
  - _bmad-output/specs/spec-agent-node-room/steering-test-plan.md
  - _bmad-output/specs/spec-agent-node-room/test-plan.md
  - _bmad-output/specs/spec-agent-node-room/todo-fold-contract.md
  - _bmad-output/specs/spec-agent-node-room/tool-presentation-contract.md
  - _bmad-output/planning-artifacts/epics-agent-node-room/epics.md
  - _bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md
  - _bmad-output/planning-artifacts/architecture/architecture-Archon-readable-agent-transcript-2026-09-12/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/architecture/architecture-Archon-live-agent-steering-2026-09-12/ARCHITECTURE-SPINE.md
  - claude-design/design_handoff_node_room_transcript_steering/README.md
---

# Implementation Readiness Re-Assessment — spec-agent-node-room

> **Superseded:** The owner replaced the one-epic hybrid structure with two epics and 20 standalone feature stories on 2026-09-16.
> Re-run implementation readiness against the current `epics.md` before implementation.

**Date:** 2026-09-16.
**Historical verdict:** READY for Phase 4 implementation under the superseded one-epic structure.

## Context

This is a **delta re-assessment** after the second-pass remediation (`sprint-change-proposal-2026-09-16.md`, applied 2026-09-16) that resolved the 10 residual issues from the prior NOT-READY report. Functional coverage was already complete (28/28 FRs) and is unchanged; PRD analysis, the coverage matrix, and UX/architecture alignment are unchanged except where the 10 fixes touched them. Only the delta was re-verified — independently, against the current on-disk artifacts, with reconciliation-first discipline.

## Per-issue resolution

| #   | Sev      | Issue (prior report)                                                      | Status               | Evidence                                                                                                                                                                                                 |
| --- | -------- | ------------------------------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Critical | Queue ownership per-tab vs server-side                                    | RESOLVED             | `SPEC.md:86/135`, `epics.md:59/401`, `EXPERIENCE.md:184/206`, `DESIGN.md:645`; `this tab only` on the unsent draft only; band header `QUEUED · N`; no coined copy                                        |
| 2   | Major    | Story 1.6 `not_steerable_here` for a finished iteration (unimplementable) | RESOLVED             | option (a): `SPEC.md` CAP-6, `control-states.md` "Viewing a finished iteration", `epics.md` Story 1.6, `README.md` §6, `EXPERIENCE.md:179` — composer absent, no route call, node-scoped route unchanged |
| 3   | Major    | G2 couples OMP to the Claude spike                                        | RESOLVED             | G2 Claude-only + independent G4 (OMP); `epics.md` + `SPEC.md:130/176` list G1–G4                                                                                                                         |
| 4   | Major    | 1.7a/1.7b/1.8 lack standalone value                                       | ACCEPTED (no change) | owner-ratified hybrid, `epics.md:291`                                                                                                                                                                    |
| 5   | Major    | 1.7a/1.7b oversized                                                       | RESOLVED             | package-ownership + integration-gate line on each                                                                                                                                                        |
| 6   | Major    | Story 1.8 Withdraw route implicit                                         | RESOLVED             | title + AC; 404 only for unknown run/node, drained/unknown `message_id` = idempotent no-op (matches `steering-api-contract.md`)                                                                          |
| 7   | Minor    | Story 1.9 keyboard shortcut untraced                                      | RESOLVED             | `Cmd`/`Ctrl`+Enter AC, same guard, SC 2.5.3                                                                                                                                                              |
| 8   | Minor    | Story 1.1 three expansion states implicit                                 | RESOLVED             | five-outcome table-driven AC                                                                                                                                                                             |
| 9   | Minor    | Story 1.3 diff oracles by reference only                                  | RESOLVED             | AC binds the diff failure-oracle contract to completion                                                                                                                                                  |
| 10  | Minor    | Story 1.12b idle expiry with queue untested                               | RESOLVED             | queued-message idle-expiry AC                                                                                                                                                                            |

## The one post-apply correction

Independent verification found the initial batch had missed `EXPERIENCE.md:179`, which still asserted the refuted finished-iteration `not_steerable_here` refusal (root cause: the change-map scoped `EXPERIENCE.md` to the D1 per-tab edits only, and the D1 grep terms did not touch this D2 sentence). Corrected in place; re-verified clean. Two one-line warnings (SPEC G-item enumeration; `epics.md:84` AD-7→AD-11 auth label) were also cleaned up. Details in `sprint-change-proposal-2026-09-16.md` §7.

## Accepted deviations (do not block READY)

1. **Hybrid story structure** — Stories 1.7a/1.7b/1.8 are engine/transport tasks beneath the 1.9–1.10 operator outcome, not independently shippable value. Owner-ratified (`epics.md:291`); recorded, not reversed.
2. **Production-corpus generic-fallback measurement** is an assumption-backed release audit, not a reproducible CI fixture (Story 1.2 / `test-plan.md`).

## Recommendation

Proceed to Phase 4. The read slice (Stories 1.1–1.5) and the steering engine slice (1.7a–1.8) were never blocked by the residual issues; Story 1.6 is now clear. No contract, wire, registry, or architecture change is required — option (a) kept every machine-facing contract intact.

## Unresolved questions

- **D1 cross-operator withdraw** is decided as accepted (any operator/tab on the node may withdraw any queued item; matches AD-11). Reopen only if withdraw should be restricted to the authoring operator — that needs a per-message owner check the withdraw contract does not carry.
