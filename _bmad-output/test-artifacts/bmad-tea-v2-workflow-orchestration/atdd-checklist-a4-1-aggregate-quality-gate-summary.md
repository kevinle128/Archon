---
stepsCompleted:
  - 'step-01-preflight-and-context'
  - 'step-02-generation-mode'
  - 'step-03-test-strategy'
  - 'step-04-generate-tests'
  - 'step-04c-aggregate'
  - 'step-05-validate-and-complete'
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-07-08'
storyId: 'a4.1'
storyKey: 'a4-1-aggregate-quality-gate-summary'
storyFile: '_bmad-output/implementation-artifacts/a4-1-aggregate-quality-gate-summary.md'
atddChecklistPath: '_bmad-output/test-artifacts/bmad-tea-v2-workflow-orchestration/atdd-checklist-a4-1-aggregate-quality-gate-summary.md'
detectedStack: 'backend'
generationMode: 'ai-generation-sequential'
generatedTestFiles:
  - 'packages/workflows/src/defaults/v2-quality-summary-contract.test.ts'
  - 'packages/workflows/src/defaults/v2-quality-summary-dag.test.ts'
inputDocuments:
  - '_bmad-output/implementation-artifacts/a4-1-aggregate-quality-gate-summary.md'
  - '_bmad-output/test-artifacts/bmad-tea-v2-workflow-orchestration/test-design/test-design-a4-1-aggregate-quality-gate-summary.md'
  - '_bmad-output/project-context.md'
  - '.archon/workflows/defaults/bmad-dev-story-with-tea-fix-loop-v2.yml'
  - 'packages/workflows/src/defaults/v2-tr-join-contract.test.ts'
  - 'packages/workflows/src/defaults/v2-tr-join-dag.test.ts'
  - 'packages/workflows/package.json'
---

# ATDD Red-Phase Checklist: a4.1 Aggregate Quality Gate Summary

**Role:** Master Test Architect (TEA).
**Date:** 2026-07-08.
**Phase:** TDD RED — scaffolds only, no production code.
**Stack detected:** backend (Bun test; no browser E2E — the isolated DAG executor is the closest end-to-end product surface).
**Framework:** `bun:test`, mirroring the proven `v2-tr-join-contract.test.ts` / `v2-tr-join-dag.test.ts` harness.

## Preflight Summary

The story evolves `quality-gate-summary` into the four-role route-facing aggregator that reads the resolved CR / RV / NR / TR contracts and emits `quality-gate-summary.json`.
The TD source is `test-design-a4-1-aggregate-quality-gate-summary.md` (14 P0, 20 P1, 3 P2, 2 P3 scenarios; 25 reviewer concerns; 4 waivers).
No test framework config change is needed; the two new files reuse the existing default-workflow test harness verbatim.

**BLOCKER carried from the story (Task 0 / Unresolved Question #1):** this worktree's v2 YAML is at the **a3.2** state.
There is no `quality-gate-summary` node, no `tea-tr-skipped`, and `tea-tr` is unconditional with no gate `output_format` (verified: `.archon/workflows/defaults/bmad-dev-story-with-tea-fix-loop-v2.yml:701-738`).
Therefore every YAML-structural and DAG scenario below is genuinely RED against the current checkout and stays red until both the a3.3 TR-join baseline and the a4.1 aggregator land.
Dependencies are also not installed in this worktree — run `bun install` before executing anything.

**Predecessor reconciliation note:** the a3.3 barrier test (`v2-tr-join-contract.test.ts`) asserts the OLD barrier shape (`output_type: gate-summary`, six deps, exit-1 on TR FAIL).
This story EVOLVES the node to `output_type: quality-gate-summary`, eight deps (adds `code-review-auto` + `resolve-story-input`), and a PASS|FAIL routing contract that does NOT exit-1 on a role FAIL.
The a4.1 assertions here therefore intentionally supersede those precursor barrier assertions; the implementer must update the a3.3 barrier tests when landing a4.1 (tracked as Unresolved Question #3 below).

## Generation Mode

AI generation, sequential — a single-context deterministic scaffold generation for a backend DAG/contract story (recording mode is N/A for backend).

## Test Strategy (levels)

- **Structural / contract (Bun, co-located, no `mock.module`):** parse the v2 YAML from disk, assert node shape, dependency join, safe-encoder usage, envelope completeness, bundle parity, tail wiring, CI registration, plus self-contained encoder/parser technique proofs.
- **Behavioral / DAG (Bun, isolated `mock.module` + real executor + real bash):** drive the real `gate-planner` flag policy through the DAG and assert the emitted `quality-gate-summary.json` for happy, blocking, decision-needed, skip, and every fail-closed path.
- **First-party consumer E2E:** the isolated DAG executor run IS the first-party consumer surface for this workflow behavior; browser E2E is correctly N/A (see TD "Not In Scope" and waiver W-005 below).

## Generated Files

| File                                                                  | Level                         | Isolation                                  | Registered in `package.json` |
| --------------------------------------------------------------------- | ----------------------------- | ------------------------------------------ | ---------------------------- |
| `packages/workflows/src/defaults/v2-quality-summary-contract.test.ts` | Structural + technique proofs | co-located (no `mock.module`)              | yes — shared non-mock batch  |
| `packages/workflows/src/defaults/v2-quality-summary-dag.test.ts`      | Behavioral DAG                | its OWN `bun test` segment (`mock.module`) | yes — standalone segment     |
| `packages/workflows/package.json`                                     | test wiring                   | —                                          | edited (both segments added) |

Validation performed on the scaffolds: both files transpile clean (Bun transpiler), `package.json` remains valid JSON, and both files pass the TD-164 no-plan-identifier self-scan.

## Mandatory Mapping — every P0/P1 scenario is represented

Legend: **exec-red** = executable test failing until implementation; **technique** = self-contained proof of the chosen pattern (green now, paired with an exec-red structural assertion); **skip** = `it.skip` scaffold with a documented activation seam; **review** = manual review-gate item; **waiver** = deferred with owner.

### P0

| TD     | Scenario                                                                                          | File                                                                | Representation   |
| ------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------- |
| TD-100 | Deterministic bash aggregator: eight-source join, fail-closed trigger, timeout, typed output      | contract                                                            | exec-red         |
| TD-101 | Whole-output reads only; no field-level `$tea-*.output.gate` on skip-capable branches             | contract                                                            | exec-red         |
| TD-102 | `bun -e` + `JSON.parse`; no `grep`/`case` substring gate matching                                 | contract                                                            | exec-red         |
| TD-130 | All four PASS → PASS, zero blocking, zero decision-needed, zero findings, PR reached              | dag                                                                 | exec-red         |
| TD-140 | Missing/empty required CR → no summary, PR unreachable                                            | dag                                                                 | exec-red         |
| TD-141 | Resolved-optional role empty (real fails, skip condition-skipped) → no route decision             | dag                                                                 | exec-red         |
| TD-142 | Mismatched `story_ref` → hard-fail, no summary                                                    | dag                                                                 | exec-red         |
| TD-143 | Mismatched `contract_version` → hard-fail, no summary                                             | dag                                                                 | exec-red         |
| TD-144 | Mismatched `workflow` → hard-fail, no summary                                                     | dag                                                                 | exec-red         |
| TD-145 | Mismatched producer `node` → hard-fail, no summary                                                | dag                                                                 | exec-red         |
| TD-146 | Role `ERROR` → hard-fail (ERROR ≠ FAIL), no route decision; contrasted with a FAIL that DOES emit | dag                                                                 | exec-red         |
| TD-147 | Malformed selected JSON → fail closed                                                             | contract (technique: `JSON.parse` → non-zero exit) + dag (**skip**) | technique + skip |
| TD-154 | Failed real branch blocks summary + PR even with a skip sibling                                   | dag                                                                 | exec-red         |
| TD-163 | a3.3 TR-join baseline present before aggregation                                                  | contract                                                            | exec-red         |

### P1

| TD     | Scenario                                                                     | File                                                          | Representation                                                         |
| ------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| TD-103 | Exact stdout contract + best-effort `quality-gate-summary.json` persist      | contract (structural) + dag (`readSummaryContract`)           | exec-red                                                               |
| TD-104 | Envelope carries every routing field + per-role gate echoes                  | contract                                                      | exec-red                                                               |
| TD-105 | Special chars survive parse + re-encode                                      | contract                                                      | technique                                                              |
| TD-110 | CR FAIL → summary FAIL                                                       | dag                                                           | **skip** (unreachable — CR FAIL loops to dev-story); policy via TD-150 |
| TD-111 | RV FAIL → summary FAIL, `rv_gate` FAIL, blocking recorded                    | dag                                                           | exec-red                                                               |
| TD-112 | NR FAIL → summary FAIL, `nr_gate` FAIL                                       | dag                                                           | exec-red                                                               |
| TD-113 | TR FAIL → summary FAIL, `tr_gate` FAIL                                       | dag                                                           | exec-red                                                               |
| TD-114 | Multiple FAIL → `blocking_count` sums, `findings_total` sums                 | dag                                                           | exec-red                                                               |
| TD-120 | One CONCERNS, no FAIL/ERROR → PASS, `decision_needed_count == 1`             | dag                                                           | exec-red                                                               |
| TD-121 | Multiple CONCERNS → PASS, count all concerned roles                          | dag                                                           | exec-red                                                               |
| TD-131 | Skipped roles echo `SKIPPED`, not counted                                    | dag                                                           | exec-red                                                               |
| TD-148 | Negative `findings_count` → fail closed; missing CR `round` caught at source | dag                                                           | exec-red                                                               |
| TD-149 | Failure paths persist no partial summary                                     | dag                                                           | exec-red                                                               |
| TD-150 | Boundary counts (zero, mixed, multi-concern, multi-block)                    | contract (arithmetic) + dag (mixed)                           | technique + exec-red                                                   |
| TD-151 | Substring false positive cannot flip a parsed gate                           | contract                                                      | technique                                                              |
| TD-153 | Trigger-rule: runs only when no dep failed and ≥1 completed                  | contract TD-100 (rule + full deps) + dag TD-130/TD-131/TD-154 | exec-red (composed)                                                    |
| TD-156 | Two runs, distinct `ARTIFACTS_DIR`, no share/overwrite                       | dag                                                           | exec-red                                                               |
| TD-160 | Edited v2 parses; source+bundle match; v1 byte-for-byte unchanged            | contract                                                      | exec-red                                                               |
| TD-161 | `create-pull-request` depends only on summary; no route-loop added           | contract                                                      | exec-red                                                               |
| TD-162 | Contract test in non-mock batch; DAG test in its own invocation              | contract                                                      | exec-red                                                               |

### P2 / P3

| TD     | Scenario                                                        | File     | Representation                          |
| ------ | --------------------------------------------------------------- | -------- | --------------------------------------- |
| TD-152 | Deterministic encode; artifact overwrites (no `>>` append)      | contract | technique + exec-red                    |
| TD-155 | `timeout: 60000`; no unbounded external command                 | contract | exec-red                                |
| TD-165 | File scope limited to v2 YAML / bundle / tests / package script | —        | **review** (manual gate; see checklist) |
| TD-164 | Kebab-case ids; no plan/finding identifiers in generated files  | contract | exec-red (self-scan)                    |

## Acceptance Criteria Traceability

| AC                                                                  | Scenarios                                                                              | Status  |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------- |
| AC1 (JSON-only reads, emit `quality-gate-summary.json`)             | TD-100, TD-101, TD-102, TD-103, TD-104, TD-105, TD-130, TD-131, TD-151, TD-155, TD-156 | Covered |
| AC2 (any role FAIL → `gate:FAIL` + records blocker)                 | TD-111, TD-112, TD-113, TD-114, TD-150; TD-110 via TD-150 arithmetic                   | Covered |
| AC3 (CONCERNS-only → PASS + preserved `decision_needed_count>0`)    | TD-104, TD-120, TD-121, TD-150; W-001 (granularity)                                    | Covered |
| AC4 (all PASS/SKIPPED, no CONCERNS → PASS + count 0)                | TD-130, TD-131, TD-150                                                                 | Covered |
| AC5 (missing/empty/mismatch/ERROR → fail-closed, no route decision) | TD-101, TD-102, TD-140–TD-149, TD-151, TD-153, TD-154                                  | Covered |
| AC6 (edited v2 valid, source+bundle consistent, v1 untouched)       | TD-100, TD-160, TD-161, TD-162, TD-163, TD-164, TD-165                                 | Covered |

## Reviewer Concern Traceability

All reviewer concerns C-001–C-025 from the TD are represented transitively through the TD scenarios above (the TD "Reviewer Concern Trace" maps each C-nnn to its TD-nnn set).
C-023 is a waiver (W-001, `decision_needed_count` granularity).
No reviewer concern is left unrepresented: each is an executable red test, a technique proof, a documented skip scaffold, a review-gate item, or a waiver.

## Skipped Scaffolds and Expected Failure Reasons

| Scaffold                                         | Location                         | Why skipped                                                                                                                                                                                                                                                         | Activation seam                                                          | Compensating coverage                                                                                                  |
| ------------------------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| TD-110 `cr_gate FAIL → summary FAIL`             | `v2-quality-summary-dag.test.ts` | A CR `FAIL` is routed to the `dev-story` fix loop by `code-review-gate` (negative route) and a CR `ERROR` hard-fails at `verify-story-identity`; neither ever reaches `quality-gate-summary`. Cannot be driven through the real DAG without faking the review loop. | Rewire the workflow so a non-PASS CR reaches the aggregator directly.    | Contract TD-150 arithmetic proves a FAIL role → summary FAIL + `blocking_count`.                                       |
| TD-147 `malformed source contract → fail closed` | `v2-quality-summary-dag.test.ts` | Every source feeding the aggregator emits well-formed JSON (AI nodes via `structuredOutput`; skip siblings via `bun` `JSON.stringify`), so malformed JSON cannot be injected mid-DAG through this harness.                                                          | A fault-injection seam that lets a source node emit raw non-JSON stdout. | Contract TD-147 proves `JSON.parse` on malformed input exits non-zero; TD-105 / TD-151 prove encoder/parse robustness. |

Both skips are executable-but-`it.skip` scaffolds (they load and are registered); each states its activation condition and an assertion of expected behavior.

## Expected Red-Phase Failures (against the current a3.2 checkout)

Once `bun install` runs, the following are EXPECTED to fail until a3.3 + a4.1 implementation lands:

- Contract: TD-163 (no `tea-tr-skipped` / `run_tr` guard), TD-100/101/102/103/104/155/160/161/162 (no `quality-gate-summary` node), TD-152 append-guard, TD-164 file-scan (files exist but node-shape assertions fail first).
- Contract technique proofs (TD-105, TD-147 parse, TD-150 arithmetic, TD-151, TD-152 determinism) PASS now — they validate the chosen pattern, paired with the red structural assertions that the YAML must adopt it.
- DAG: all exec-red scenarios fail because `quality-gate-summary` never appears in `nodeState` and `readSummaryContract` returns `null`.

## Waivers

| Waiver | Subject                                         | Reason                                                                                                                                        | Owner                     | Residual Risk                                                  | Follow-Up Trigger                                                                                                         |
| ------ | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| W-001  | `decision_needed_count` per-finding granularity | Derived as the count of resolved roles whose gate is `CONCERNS`; no source contract exposes a per-finding decision-needed field (KISS/YAGNI). | Workflow maintainer       | A later route-loop / sync story may need finer counts.         | Reopen if a downstream consumer needs per-finding decision-needed totals.                                                 |
| W-002  | Cancellation coverage                           | Executor cancellation and lifecycle ownership are unchanged by this YAML/bash-contract story.                                                 | Workflow maintainer       | Cancellation during a summary write is not newly exercised.    | Reopen if the implementation changes executor cancellation, node lifecycle, or artifact-write ownership.                  |
| W-003  | Permission / auth coverage                      | No auth, credential, adapter, or protected-route code is in scope.                                                                            | Security / platform owner | A stray change could add untested auth behavior.               | Reopen if the diff touches credentials, adapters, server auth routes, provider credential delivery, or permission checks. |
| W-004  | Load / performance testing                      | No runtime hot path or user-facing latency path changes.                                                                                      | Workflow maintainer       | The aggregator bash could hang without a timeout.              | TD-155 must pass; reopen if long-running runtime work is added.                                                           |
| W-005  | Browser / first-party UI E2E                    | This is a backend workflow DAG change with no browser-visible surface; the isolated DAG executor run is the first-party consumer E2E.         | Test architect            | A UI consumer of `quality-gate-summary.json` is not exercised. | Reopen if a web/console surface renders the quality-gate summary.                                                         |

## Commands to Run the Generated Tests

```bash
# 0. This worktree has no installed dependencies — install first.
bun install

# 0b. HARD PREREQUISITE (Task 0): ensure the a3.3 TR-join baseline is present in
#     .archon/workflows/defaults/bmad-dev-story-with-tea-fix-loop-v2.yml
#     (tea-tr run_tr gate + output_format, tea-tr-skipped sibling). Without it,
#     TD-163 and the DAG skip/real branches stay red for the wrong reason.

# 1. RED PHASE — run each scaffold directly (EXPECTED TO FAIL until a4.1 lands).
bun test packages/workflows/src/defaults/v2-quality-summary-contract.test.ts
bun test packages/workflows/src/defaults/v2-quality-summary-dag.test.ts

# 2. GREEN PHASE (after implementing the aggregator in the v2 YAML):
bun run generate:bundled      # refresh bundled-defaults.generated.ts from the YAML
bun run check:bundled         # confirm no source/bundle drift
bun run test                  # per-package isolated suite (runs both new segments)
bun run validate              # full pre-PR gate

# Isolation note: v2-quality-summary-dag.test.ts uses mock.module and is
# registered as its OWN bun test segment — never co-locate it with another file.
```

## Unresolved Questions

1. **a3.3 baseline absent in this worktree.** The v2 YAML is at a3.2 (no `tea-tr` gate/`output_format`, no `tea-tr-skipped`, no `quality-gate-summary`). Rebase/merge the a3.3 branch first (recommended) or fold a3.3's TR-join wiring into a4.1 before these scaffolds can go green. (Story Task 0.)
2. **`decision_needed_count` granularity (W-001).** Confirm the role-count derivation is acceptable, or open a cross-cutting contract-change story to add a per-finding `decision_needed_count` to each source gate.
3. **Predecessor barrier reconciliation.** Landing a4.1 changes `quality-gate-summary` `output_type` (`gate-summary` → `quality-gate-summary`) and its dependency set (6 → 8), which will break the a3.3 barrier assertions in `v2-tr-join-contract.test.ts`. Decide whether the implementer updates those a3.3 assertions or the a3.3 barrier tests are retired in favor of the a4.1 aggregator tests.
4. **TD-165 file-scope gate.** Represented as a manual review-gate item (no automated test); confirm reviewer sign-off that only the v2 YAML, generated bundle, the two test files, and `package.json` changed.
