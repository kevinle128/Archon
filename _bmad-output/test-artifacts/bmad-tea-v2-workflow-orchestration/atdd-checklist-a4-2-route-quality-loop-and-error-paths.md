---
stepsCompleted:
  - 'step-01-preflight-and-context'
  - 'step-02-generation-mode'
  - 'step-03-test-strategy'
  - 'step-04-generate-tests'
  - 'step-04c-aggregate'
lastStep: 'step-04c-aggregate'
lastSaved: '2026-07-08'
storyId: 'a4.2'
storyKey: 'a4-2-route-quality-loop-and-error-paths'
storyFile: '_bmad-output/implementation-artifacts/a4-2-route-quality-loop-and-error-paths.md'
atddChecklistPath: '_bmad-output/test-artifacts/bmad-tea-v2-workflow-orchestration/atdd-checklist-a4-2-route-quality-loop-and-error-paths.md'
detectedStack: 'backend'
generationMode: 'ai-generation-sequential'
generatedTestFiles:
  - 'packages/workflows/src/defaults/v2-quality-route-loop-contract.test.ts'
  - 'packages/workflows/src/defaults/v2-quality-route-loop-dag.test.ts'
inputDocuments:
  - '_bmad-output/implementation-artifacts/a4-2-route-quality-loop-and-error-paths.md'
  - '_bmad-output/test-artifacts/bmad-tea-v2-workflow-orchestration/test-design/test-design-a4-2-route-quality-loop-and-error-paths.md'
  - '_bmad-output/implementation-artifacts/a4-1-aggregate-quality-gate-summary.md'
  - '_bmad-output/project-context.md'
  - '.archon/workflows/defaults/bmad-dev-story-with-tea-fix-loop-v2.yml'
  - 'packages/workflows/src/defaults/v2-quality-summary-contract.test.ts'
  - 'packages/workflows/src/defaults/v2-quality-summary-dag.test.ts'
  - 'packages/workflows/package.json'
---

# ATDD Red-Phase Checklist: a4.2 Route Quality Loop And Error Paths

**Role:** Master Test Architect (TEA).
**Date:** 2026-07-08.
**Phase:** TDD RED — scaffolds only, no production code.
**Stack detected:** backend (Bun test; no browser E2E — the isolated DAG executor is the closest first-party consumer surface).
**Framework:** `bun:test`, mirroring the proven `v2-quality-summary-contract.test.ts` / `v2-quality-summary-dag.test.ts` harness.

## Preflight Summary

The story consolidates the v2 quality routing into ONE bounded `route_loop` sourced from `quality-gate-summary`: it adds a `verify-quality-summary` reader (summary JSON → bare `PASS`/`FAIL`), removes the `code-review-gate` route_loop, adds `quality-route-loop` (`FAIL`→`dev-story`, `PASS`→`create-pull-request`, exhausted→`review-loop-error`), and keeps `ERROR` fail-closed (a summary `ERROR` hard-fails the summary node → the reader never runs → the loop never reroutes to `dev-story`).
The TD source is `test-design-a4-2-route-quality-loop-and-error-paths.md` (9 P0, 14 P1, 2 P3 scenarios; 28 reviewer concerns; 4 waivers).
No test framework config change is needed; the two new files reuse the existing default-workflow test harness verbatim.

**BLOCKER carried from the story (Task 0 / TD-200 / R-001):** this worktree's v2 YAML is at the **~a3.2** state.
Verified by direct read of `.archon/workflows/defaults/bmad-dev-story-with-tea-fix-loop-v2.yml`: `quality-gate-summary` ABSENT, `verify-quality-summary` ABSENT, `quality-route-loop` ABSENT, `tea-tr-skipped` ABSENT; the old `code-review-gate` route_loop still PRESENT (the only `route_loop:` in the file, at line 400).
Therefore every YAML-structural and DAG scenario below is genuinely RED against the current checkout and stays red until the a3.3 TR-join baseline, the a4.1 aggregator, and this story's route loop all land.
Dependencies are also not installed in this worktree — `@archon/providers` / `@archon/paths` do not resolve (the predecessor `v2-quality-summary-*.test.ts` files hit the identical error). Run `bun install` in the primary checkout before executing anything.

**Predecessor dependency:** this story consumes a4.1's `quality-gate-summary` contract unchanged (gate `PASS`|`FAIL`, exits non-zero on `ERROR`). The a4.1 ATDD scaffolds (`v2-quality-summary-*.test.ts`) are the direct templates; these two files copy their parse-from-disk (contract) and `mock.module` + real-bash executor (DAG) harnesses.

## Generation Mode

AI generation, sequential — single-context deterministic scaffold generation for a backend DAG/contract story (recording mode is N/A for backend).

## Test Strategy (levels)

- **Structural / contract (Bun, co-located, no `mock.module`):** parse the v2 YAML from disk, assert one-loop topology, reader shape + safety, route-loop schema/loader compatibility, tail wiring, budget, forward target, bundle parity, CI registration — plus self-contained real-bash reader-validation technique proofs for the bare-output stdout and the fail-closed envelope/identity checks.
- **Behavioral / DAG (Bun, isolated `mock.module` + real executor + real bash):** drive the real DAG through all four route outcomes — `PASS`→forward, `FAIL`-then-`PASS` recovery, `ERROR` fail-closed, and budget exhaustion → `review-loop-error` — with a per-round response driver.
- **First-party consumer E2E:** the isolated DAG executor run IS the first-party consumer surface for this workflow behavior; browser E2E is correctly N/A (see TD "Not In Scope" and waiver W-003 below).

## Generated Files

| File                                                                     | Level                         | Isolation                                  | Registered in `package.json` |
| ------------------------------------------------------------------------ | ----------------------------- | ------------------------------------------ | ---------------------------- |
| `packages/workflows/src/defaults/v2-quality-route-loop-contract.test.ts` | Structural + technique proofs | co-located (no `mock.module`)              | yes — shared non-mock batch  |
| `packages/workflows/src/defaults/v2-quality-route-loop-dag.test.ts`      | Behavioral DAG                | its OWN `bun test` segment (`mock.module`) | yes — standalone segment     |
| `packages/workflows/package.json`                                        | test wiring                   | —                                          | edited (both segments added) |

Validation performed on the scaffolds: both files transpile clean (Bun reached module resolution past the parse stage — no syntax errors), `package.json` remains valid JSON with the DAG test as the standalone segment `bun test src/defaults/v2-quality-route-loop-dag.test.ts`, and the contract file carries the TD-212 no-plan-identifier self-scan over both new files.

## Mandatory Mapping — every P0/P1 scenario is represented

Legend: **exec-red** = executable test failing until implementation; **technique** = self-contained real-bash proof of the chosen pattern (green now, paired with an exec-red structural assertion); **skip** = `it.skip` scaffold with a documented activation seam; **review** = manual review-gate item; **waiver** = deferred with owner.

### P0

| TD     | Scenario                                                                                                        | File                                                        | Representation   |
| ------ | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------- |
| TD-200 | Summary baseline (`quality-gate-summary` aggregator + resolved TR path) present before route assertions         | contract                                                    | exec-red         |
| TD-201 | Exactly one `route_loop` = `quality-route-loop`; `code-review-gate` absent; no node references it               | contract                                                    | exec-red         |
| TD-203 | `verify-quality-summary` bash reader exists, deps `[quality-gate-summary, resolve-story-input]`, bounded, typed | contract                                                    | exec-red         |
| TD-204 | Reader reads whole-output, `bun -e`+`JSON.parse`, validates envelope+identity; no field-ref/`grep`/`case`       | contract                                                    | exec-red         |
| TD-207 | Malformed/stale/wrong-workflow/wrong-node/wrong-story/empty/invalid-gate summary → reader fails, no PASS/FAIL   | contract (technique, real reader pipeline) + dag (**skip**) | technique + skip |
| TD-222 | Persistent `FAIL` past budget → `review-loop-error` on max+1, never `create-pull-request`, non-zero             | dag                                                         | exec-red         |
| TD-223 | Exhaustion evidence: open-findings pointer, decision-log pointer, round/iteration count, best-effort JSON       | dag                                                         | exec-red         |
| TD-224 | `ERROR` (role gate ERROR / identity mismatch) → summary hard-fails, reader never runs, no reroute, no PR        | dag                                                         | exec-red         |
| TD-235 | `review-loop-error` terminal: nothing routes on it, no route-facing gate/status contract                        | contract (topology) + dag TD-222 (exit non-zero)            | exec-red         |

### P1

| TD     | Scenario                                                                                               | File     | Representation |
| ------ | ------------------------------------------------------------------------------------------------------ | -------- | -------------- |
| TD-202 | `gate-planner.depends_on` includes `verify-story-identity`, not `code-review-gate`                     | contract | exec-red       |
| TD-205 | Valid summary JSON → exact bare stdout `PASS`/`FAIL`, no prose; substring cannot flip gate             | contract | technique      |
| TD-208 | Route-loop shape: `depends_on [reader]`, `from` reader, bare-output condition, three routes            | contract | exec-red       |
| TD-209 | No `when`/`trigger_rule`/`retry` on route_loop; `parseWorkflow` validates the edited DAG               | contract | exec-red       |
| TD-210 | v2 source + `BUNDLED_WORKFLOWS` match; old loop gone from bundle; v1 byte-for-byte unchanged           | contract | exec-red       |
| TD-211 | Contract test in shared non-mock batch; DAG test in its OWN bun invocation                             | contract | exec-red       |
| TD-218 | `create-pull-request.depends_on` and `review-loop-error.depends_on` both `[quality-route-loop]`        | contract | exec-red       |
| TD-220 | First-round `PASS` → reader `PASS`, positive to `create-pull-request`, `dev-story` once, no error node | dag      | exec-red       |
| TD-221 | `FAIL` round-1 then `PASS` round-2 → full-path rerun, `dev-story` twice, same `story_ref`, then PR     | dag      | exec-red       |
| TD-227 | Dependency/partial upstream failure → summary/reader never complete, no reroute to `dev-story`         | dag      | exec-red       |
| TD-229 | Two runs, distinct artifact dirs → independent loop state, route activations, exhausted artifacts      | dag      | exec-red       |
| TD-230 | Reader + `review-loop-error` bounded timeouts, no unbounded external command                           | contract | exec-red       |
| TD-233 | `max_iterations` pinned + documented as 20 (continuity with the replaced loop)                         | contract | exec-red       |
| TD-234 | PASS targets `create-pull-request`, not the not-yet-existing `decision-needed-check`                   | contract | exec-red       |

### P2 / P3

| TD     | Scenario                                                                         | File     | Representation                      |
| ------ | -------------------------------------------------------------------------------- | -------- | ----------------------------------- |
| TD-212 | Kebab-case ids/output types; no plan/story/epic/finding identifiers in new files | contract | exec-red (self-scan)                |
| TD-232 | File scope limited to v2 YAML / bundle / two tests / `package.json`              | —        | **review** (manual gate; see below) |

## Acceptance Criteria Traceability

| AC                                                                                          | Scenarios                                                      | Status  |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------- |
| AC1 `FAIL` routes to `dev-story` and keeps the same `story_ref`.                            | TD-204, TD-205, TD-208, TD-209, TD-221, TD-229                 | Covered |
| AC2 `PASS` routes forward to the current tail seam.                                         | TD-205, TD-208, TD-218, TD-220, TD-234                         | Covered |
| AC3 Exhaustion routes to `review-loop-error`, records evidence, exits non-zero.             | TD-208, TD-222, TD-223, TD-233, TD-235                         | Covered |
| AC4 `ERROR` fails closed and never reaches `dev-story`.                                     | TD-203, TD-204, TD-207, TD-224, TD-227                         | Covered |
| AC5 Edited v2 parses with one loop, old loop removed, `gate-planner` rewired, v1 unchanged. | TD-200, TD-201, TD-202, TD-208, TD-209, TD-210, TD-218, TD-232 | Covered |
| AC6 Bundle parity + all four route outcomes proven.                                         | TD-210, TD-211, TD-220, TD-221, TD-222, TD-224                 | Covered |

## Reviewer Concern Traceability

All reviewer concerns C-001–C-028 from the TD are represented transitively through the TD scenarios above (the TD "Reviewer Concern Trace" maps each C-nnn to its TD-nnn set, an explicit non-risk, or a waiver).
C-023 and C-024 are explicit non-risks (NR-001 one-loop cost accepted; NR-002 PASS-to-`decision-needed-check` deferred) backed by TD-201 and TD-234 respectively.
C-026 and C-027 are waivers (W-001 cancellation; W-002 permission/auth).
No reviewer concern is left unrepresented: each is an executable red test, a technique proof, a documented skip scaffold, a review-gate item, an explicit non-risk, or a waiver.

## Skipped Scaffolds and Expected Failure Reasons

| Scaffold                                                   | Location                            | Why skipped                                                                                                                                                                                                                                                                                                                                              | Activation seam                                                                    | Compensating coverage                                                                                                                                                                     |
| ---------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TD-207 `malformed summary injected mid-DAG → reader fails` | `v2-quality-route-loop-dag.test.ts` | The only upstream source of `verify-quality-summary` is the real `quality-gate-summary` bash node, which emits a well-formed envelope OR hard-fails (exit 1). There is no seam to make the summary COMPLETE while emitting a malformed / wrong-identity / invalid-gate envelope, so the reader's defense-in-depth rejection cannot be driven end-to-end. | A stub summary node able to complete-with-arbitrary-stdout (fault-injection seam). | Contract TD-207 proves the reader's exact `JSON.parse` + envelope/identity pipeline fails closed (no `PASS`/`FAIL`) against every bad-envelope variant, via a real bash + bun subprocess. |

The skip is an executable-but-`it.skip` scaffold (it loads and is registered); it states its activation condition and asserts expected behavior on activation.

## Expected Red-Phase Failures (against the current ~a3.2 checkout)

Once `bun install` runs in the primary checkout, the following are EXPECTED to fail until the a3.3 baseline, a4.1 aggregator, and this story's route loop all land:

- Contract: TD-200 (no `quality-gate-summary` / `tea-tr-skipped`), TD-201 (only `code-review-gate` exists, no `quality-route-loop`), TD-202/203/204/208/209/218/230/233/234/235 (reader + loop nodes absent), TD-210 (bundle lacks the loop; old loop still embedded), TD-211 (registered now, so this pair PASSES once the files exist and are wired — it verifies the isolation discipline, not the node), TD-212 (self-scan passes once files exist).
- Contract technique proofs (TD-205 bare-output stdout, TD-207 fail-closed reader validation) PASS now — they validate the chosen reader pipeline, paired with the red structural assertions (TD-204) that the YAML reader node must adopt it.
- DAG: all exec-red scenarios (TD-220, TD-221, TD-222, TD-223, TD-224, TD-227, TD-229) fail because `verify-quality-summary` / `quality-route-loop` never appear in `nodeState` and `create-pull-request` / `review-loop-error` are not reached via the new loop.

## Manual Review-Gate Items

- **TD-232 (file scope):** confirm the implementation diff touches only `.archon/workflows/defaults/bmad-dev-story-with-tea-fix-loop-v2.yml`, the regenerated `bundled-defaults.generated.ts`, the two new test files, and `packages/workflows/package.json` — no executor / loader / `route-loop*.ts` / `@archon/core` / `@archon/server` code, and no edit to the v1 baseline, `quality-gate-summary`, or `verify-story-identity` bodies. (No automated test; reviewer sign-off.)

## Waivers

| Waiver | Subject                      | Reason                                                                                                                              | Owner                     | Residual Risk                                                                           | Follow-Up Trigger                                                                                                                   |
| ------ | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| W-001  | Cancellation behavior        | Executor cancellation, pause, and lifecycle ownership are unchanged by this YAML + bash-reader story.                               | Workflow maintainer       | Cancellation during a route-loop rerun or error-artifact write is not newly exercised.  | Reopen if the implementation touches executor cancellation, node lifecycle mutation, checkpoint reset, or artifact-write ownership. |
| W-002  | Permission / auth behavior   | No auth, credential, adapter, provider-credential delivery, webhook, or protected server-route code is in scope.                    | Security / platform owner | A stray change could introduce untested auth behavior.                                  | Reopen if the diff touches credentials, adapters, server auth routes, provider credential delivery, or permission checks.           |
| W-003  | Browser / first-party UI E2E | Backend workflow DAG change with no browser-visible acceptance path; the isolated DAG executor run is the first-party consumer E2E. | Test architect            | A future web/console visualization of the route loop / error artifact is not exercised. | Reopen if a web or console surface renders route-loop state, `review-loop-error` artifacts, or quality-summary decisions.           |
| W-004  | Load / performance testing   | No service runtime hot path, API endpoint, or user-facing latency threshold changes.                                                | Workflow maintainer       | The reader bash could hang if a timeout were omitted.                                   | TD-230 must pass; reopen if the implementation adds long-running runtime work or shared scheduler changes.                          |

## Commands to Run the Generated Tests

```bash
# 0. This worktree has no installed dependencies — install first (in a checkout
#    that has the a3.3 + a4.1 baseline; see Task 0 / Unresolved Question below).
bun install

# 0b. HARD PREREQUISITE (Task 0 / TD-200): ensure the a3.3 TR-join baseline AND
#     the a4.1 quality-gate-summary aggregator are present in
#     .archon/workflows/defaults/bmad-dev-story-with-tea-fix-loop-v2.yml.
#     Without them, TD-200 and every DAG scenario stay red for the wrong reason.

# 1. RED PHASE — run each scaffold directly (EXPECTED TO FAIL until this story lands).
bun test packages/workflows/src/defaults/v2-quality-route-loop-contract.test.ts
bun test packages/workflows/src/defaults/v2-quality-route-loop-dag.test.ts

# 2. GREEN PHASE (after adding verify-quality-summary + quality-route-loop and
#    removing code-review-gate in the v2 YAML):
bun run generate:bundled      # refresh bundled-defaults.generated.ts from the YAML
bun run check:bundled         # confirm no source/bundle drift
bun run test                  # per-package isolated suite (runs both new segments)
bun run validate              # full pre-PR gate

# Isolation note: v2-quality-route-loop-dag.test.ts uses mock.module and is
# registered as its OWN bun test segment — never co-locate it with another file.
```

## Unresolved Questions

1. **a3.3 + a4.1 baseline absent in this worktree.** The v2 YAML is at ~a3.2 (no `quality-gate-summary`, no `verify-quality-summary`, no `quality-route-loop`, no `tea-tr-skipped`; `code-review-gate` still present). Rebase/merge the a3.3 + a4.1 work first (recommended) or fold their wiring in before these scaffolds can go green. (Story Task 0 / TD-200 / R-001.)
2. **Loop budget 3 vs 20 (TD-233).** The workflow `description` says "up to three rounds" and `prepare-bmad-state` sets `maxRounds: 3`, but the loop being replaced uses `max_iterations: 20`. These scaffolds pin `20` for continuity. If the maintainer sets `3`, update the `MAX_ITERATIONS` constant in the DAG file and the TD-233 assertion in the contract file (both are single-point constants), and reconcile the `state.json` / description drift.
3. **PASS forward target (TD-234).** AC2 literally says PASS routes to `decision-needed-check`, but that node is a later story's deliverable and route targets must reference existing nodes. These scaffolds assert the current seam `create-pull-request` and that `decision-needed-check` does not exist yet. Confirm this deferral is acceptable (it is the only DAG-valid option in this story's scope).
4. **TD-232 file-scope gate.** Represented as a manual review-gate item (no automated test); confirm reviewer sign-off that only the v2 YAML, generated bundle, the two test files, and `package.json` changed.
