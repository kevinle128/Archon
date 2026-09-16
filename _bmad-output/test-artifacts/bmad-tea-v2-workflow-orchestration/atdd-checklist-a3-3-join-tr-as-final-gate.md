---
stepsCompleted:
  ['step-01-preflight-and-context', 'step-02-generation-mode', 'step-03-generate-red-scaffolds']
lastStep: 'step-03-generate-red-scaffolds'
lastSaved: '2026-07-08'
storyId: 'a3.3'
storyKey: 'a3-3-join-tr-as-final-gate'
storyFile: '_bmad-output/implementation-artifacts/a3-3-join-tr-as-final-gate.md'
atddChecklistPath: '_bmad-output/test-artifacts/bmad-tea-v2-workflow-orchestration/atdd-checklist-a3-3-join-tr-as-final-gate.md'
generatedTestFiles:
  - 'packages/workflows/src/defaults/v2-tr-join-contract.test.ts'
  - 'packages/workflows/src/defaults/v2-tr-join-dag.test.ts'
inputDocuments:
  - '_bmad-output/implementation-artifacts/a3-3-join-tr-as-final-gate.md'
  - '_bmad-output/test-artifacts/bmad-tea-v2-workflow-orchestration/test-design/test-design-a3-3-join-tr-as-final-gate.md'
  - '_bmad-output/project-context.md'
  - '.archon/workflows/defaults/bmad-dev-story-with-tea-fix-loop-v2.yml'
  - 'packages/workflows/src/defaults/v2-tea-branches-contract.test.ts'
  - 'packages/workflows/src/defaults/v2-tea-branches-dag.test.ts'
---

# ATDD Red-Phase Checklist: Join TR As Final Gate

**Date:** 2026-07-08
**Author:** kevin
**Mode:** Red-phase acceptance scaffolds only — no production code implemented.
**Stack:** backend TypeScript, Bun test, contract + isolated-DAG level (no browser UI surface).

## Preflight

- [x] Story loaded with clear acceptance criteria (AC1–AC5).
- [x] Test-design artifact loaded (TD-020..TD-041, risks, reviewer concerns C-001..C-020).
- [x] Existing framework + patterns discovered — reused the a3.2 predecessor harness verbatim (`parseWorkflow`, `evaluateCondition`, `executeDagWorkflow`, `BUNDLED_WORKFLOWS`, the `runV2Dag` DAG fixture, evidence builders).
- [x] All dependency seams already exist → executable red tests, NOT `test.skip()` scaffolds.
- [x] Both files type-check clean (`bun run type-check` in `@archon/workflows`, exit 0).
- [x] Both files execute red for the right reasons (assertion failures, not import/parse errors).

## Generated Files

| File                                                          | Level                                              | mock.module | Isolation                 | Red count (now)    |
| ------------------------------------------------------------- | -------------------------------------------------- | ----------- | ------------------------- | ------------------ |
| `packages/workflows/src/defaults/v2-tr-join-contract.test.ts` | structural / contract / unit                       | no          | co-locatable              | 20 fail / 34 total |
| `packages/workflows/src/defaults/v2-tr-join-dag.test.ts`      | behavioral DAG (real executor + real gate-planner) | yes         | own `bun test` invocation | 5 fail / 7 total   |

The passing tests in each file are legitimately-green regression guards / technique proofs / evaluator invariants that must STAY green through GREEN phase (four-way RV/NR join intact, bundle==source parity today, v1 untouched, encoder technique sound, condition evaluator, RV/NR fail-closed already wired by a3.2).

## Scenario Mapping (every P0/P1 TD represented)

Legend: RED = executable, fails until production lands · GUARD = executable, green now, must stay green.

| TD     | Pri | Representation                                                                                                        | Test file · describe tag             | State now               |
| ------ | --- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ----------------------- |
| TD-020 | P0  | RED executable                                                                                                        | contract · TD-020                    | fail                    |
| TD-021 | P0  | RED executable (x3)                                                                                                   | contract · TD-021                    | fail                    |
| TD-022 | P1  | RED executable                                                                                                        | contract · TD-022                    | fail                    |
| TD-023 | P0  | RED executable (x3)                                                                                                   | contract · TD-023                    | fail                    |
| TD-024 | P1  | RED executable (x2 static) + behavioral note in DAG                                                                   | contract · TD-024, dag · TD-024 note | fail                    |
| TD-025 | P1  | GUARD technique proof (encoder soundness)                                                                             | contract · TD-025                    | pass                    |
| TD-026 | P1  | RED executable (x3)                                                                                                   | contract · TD-026                    | fail                    |
| TD-027 | P0  | RED executable (x2)                                                                                                   | contract · TD-027                    | fail                    |
| TD-028 | P1  | GUARD parse-clean + RED when/trigger coexistence                                                                      | contract · TD-028                    | mixed (1 pass / 1 fail) |
| TD-029 | P0  | GUARD unit proof — run_tr drives exactly one branch, mutual exclusion (proves false path without faking gate-planner) | contract · TD-029                    | pass                    |
| TD-030 | P0  | RED behavioral                                                                                                        | dag · TD-030                         | fail                    |
| TD-031 | P0  | GUARD behavioral (RV fail closes join — a3.2 wiring, must persist)                                                    | dag · TD-031                         | pass                    |
| TD-032 | P0  | GUARD behavioral (NR fail closes join — must persist)                                                                 | dag · TD-032                         | pass                    |
| TD-033 | P1  | RED behavioral (x2: empty TR output fails; TR SKIPPED violates enum)                                                  | dag · TD-033                         | fail                    |
| TD-034 | P1  | RED behavioral (one completed TR sibling + one skipped runs tail)                                                     | dag · TD-034                         | fail                    |
| TD-035 | P1  | GUARD regression (four-way join intact)                                                                               | contract · TD-035                    | pass                    |
| TD-036 | P1  | RED bundle-embeds-skip + GUARD source-parity                                                                          | contract · TD-036                    | mixed (1 pass / 1 fail) |
| TD-037 | P1  | GUARD v1-untouched + RED additive-third-node                                                                          | contract · TD-037                    | mixed (1 pass / 1 fail) |
| TD-038 | P1  | GUARD keep-lines-present + RED stale-assertion-inverted                                                               | contract · TD-038                    | mixed (1 pass / 1 fail) |
| TD-039 | P1  | RED isolation registration (package.json owns dag file)                                                               | contract · TD-039                    | fail                    |
| TD-040 | P2  | GUARD blast-radius (gate-planner + route_loop unchanged)                                                              | contract · TD-040                    | pass                    |
| TD-041 | P3  | GUARD naming + no-plan-identifiers                                                                                    | contract · TD-041                    | pass                    |

## Acceptance Criteria Traceability

| AC                                                                                           | Covered by                                             | Status  |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------- |
| AC1 — TR runs after resolved RV/NR with valid trigger_rule, consuming real or skip contracts | TD-020, TD-021, TD-022, TD-029, TD-030, TD-035         | Covered |
| AC2 — run_tr=false emits SKIPPED; successor still runs from resolved TR role                 | TD-023, TD-024, TD-025, TD-026, TD-027, TD-029, TD-034 | Covered |
| AC3 — edited v2 passes parseWorkflow schema + DAG validation                                 | TD-020, TD-021, TD-023, TD-027, TD-028                 | Covered |
| AC4 — real RV/NR failure → TR must NOT run and tail unreachable (fail-closed)                | TD-027, TD-031, TD-032, TD-033, TD-034, TD-035         | Covered |
| AC5 — bundle regenerated + consistent, v1 untouched                                          | TD-036, TD-037, TD-038, TD-039, TD-040, TD-041         | Covered |

## Reviewer Concern Traceability (C-001..C-020)

All concerns map 1:1 onto the TD scenarios above per the test-design trace table, so every concern is represented by an executable test:
C-001→TD-020/TD-030 · C-002→TD-023/TD-024/TD-029 · C-003→TD-023 · C-004→TD-029 · C-005→TD-029/TD-030 · C-006→TD-021/TD-033 · C-007→TD-022/TD-024 · C-008→TD-025 · C-009→TD-026 · C-010→TD-027/TD-030/TD-034 · C-011→TD-028/TD-035 · C-012→TD-031/TD-032/TD-034 · C-013→TD-038 · C-014→TD-037 · C-015→TD-037 · C-016→TD-036 · C-017→TD-039 · C-018→TD-040 · C-019→TD-028 (explicit non-risk: single node may carry when+trigger_rule+multi depends_on) · C-020→TD-041.

## Edge-Case Coverage

- Happy path: TD-030.
- Negative / partial failure / dependency failure: TD-031, TD-032, TD-033, TD-034.
- Malformed input: TD-025 (encoder survives backslash/quote/newline/CR/tab).
- Stale state / story identity: TD-022, TD-024 (story_ref pinned into both real and skip contracts).
- Out-of-order: TD-023 + TD-027 (skip resolves off gate-planner while PR waits on both TR-role siblings).
- Duplicate / impossible dual-run: TD-029 (mutual exclusion of the two run_tr guards).
- Timeout / observability: TD-026.
- Concurrency / mock pollution: TD-039 (isolated bun invocation for the mock.module DAG file).
- Rollback / scope: TD-037, TD-040.
- No-side-effect / read-only preview: N/A — the story adds a release-gate node that writes contracts; there is no read-only preview surface.

## Skipped Scaffolds

None. Every target seam (v2 YAML on disk, `parseWorkflow`, `evaluateCondition`, `executeDagWorkflow`, `BUNDLED_WORKFLOWS`, package.json) already exists, so all scenarios are executable red tests rather than `test.skip()` stubs.

## Waivers

| Waiver                          | Owner               | Residual risk                                                                                                                                                                                                                                                                                                       | Follow-up trigger                                                                                                       |
| ------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Browser / UI E2E — N/A          | workflow maintainer | None — the story changes workflow YAML + workflow-package tests only; no browser-visible surface. The isolated DAG executor test IS the first-party consumer end-to-end path.                                                                                                                                       | Add UI E2E only if a future story exposes TR-gate state through the web console.                                        |
| run_tr=false behavioral DAG run | test architect      | The SKIPPED emission is proven structurally (TD-024) + by condition-evaluator (TD-029), not by a live behavioral run, because the real gate-planner hardcodes run_tr=true and faking it would be a fake test. Residual: a bug reachable only when a real false run_tr is emitted would escape the behavioral suite. | Add a behavioral false-path run when a real caller sets run_tr=false (none exists today — YAGNI).                       |
| Cancellation coverage           | workflow maintainer | A pre-existing cancellation bug would not be caught by this story-specific suite.                                                                                                                                                                                                                                   | Add cancellation coverage if implementation changes executor cancellation / run cancellation / node lifecycle mutation. |
| Permission / auth coverage      | workflow maintainer | Unexpected permission expansion would only arise from out-of-scope file changes (guarded by TD-040).                                                                                                                                                                                                                | Add auth coverage if implementation touches provider permissions, credentials, adapters, or protected routes.           |
| Load / performance              | workflow maintainer | No runtime hot-path change; `bun run validate` remains the CI evidence.                                                                                                                                                                                                                                             | Add if implementation changes executor scheduling or long-running runtime behavior.                                     |

## Dev Handoff — required predecessor update (Task 4)

- [ ] `packages/workflows/src/defaults/v2-tea-branches-contract.test.ts` TD-010 (lines 298–313) still asserts the pre-TR-join state (`tea-tr` has no `when`, `tea-tr-skipped` absent, PR depends on `['tea-tr']`). These INVERT under a3.3 and will fail once production lands — invert them, do not delete. TD-038 in the new contract file already fails until the stale `"tea-tr-skipped belongs to a later story"` assertion is removed.
- [ ] TD-010 KEEP-lines (four-way `tea-tr` join + `none_failed_min_one_success`, lines 282–296) must survive the inversion — TD-038 asserts their continued presence.
- [ ] TD-016 additive-count (lines 385–391) must extend to count `tea-tr-skipped` as the third additive node id.
- [ ] Register `v2-tr-join-dag.test.ts` as its OWN `&&`-separated `bun test src/defaults/v2-tr-join-dag.test.ts` segment in `packages/workflows/package.json` (GREEN phase) — TD-039 asserts this exact standalone registration.

## Exact Commands to Run the Generated Tests

Run from repo root (workspace deps must be installed: `bun install`).

```bash
# Contract / structural / unit red tests (co-locatable, no mock.module)
cd packages/workflows && bun test src/defaults/v2-tr-join-contract.test.ts

# Behavioral DAG red tests (mock.module — MUST run as its own invocation)
cd packages/workflows && bun test src/defaults/v2-tr-join-dag.test.ts

# After GREEN-phase production edits, refresh + verify the bundle:
bun run generate:bundled
bun run check:bundled

# Full pre-PR gate:
bun run validate
```

## Red-Phase Result Snapshot (2026-07-08, before any production edit)

- `v2-tr-join-contract.test.ts`: 14 pass (guards/invariants) / 20 fail (unimplemented wiring) / 34 total.
- `v2-tr-join-dag.test.ts`: 2 pass (a3.2 fail-closed guards) / 5 fail (unimplemented wiring) / 7 total.
- All failures are assertion-level against not-yet-implemented v2 YAML wiring — no import, parse, or type errors.

## Unresolved Questions

None. The test-design artifact fully specified P0/P1 scenarios, risks, and reviewer concerns; all are represented as executable tests or documented waivers.
