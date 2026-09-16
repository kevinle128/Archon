---
stepsCompleted:
  - 'step-01-preflight-and-context'
  - 'step-02-generation-mode'
  - 'step-03-test-strategy'
  - 'step-04-generate-tests'
  - 'step-04c-aggregate'
  - 'step-05-validate-and-complete'
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-07-14'
storyId: '3.3a'
storyKey: '3-3a-define-shared-workflow-provider-command-envelope'
storyFile: '_bmad-output/implementation-artifacts/3-3a-define-shared-workflow-provider-command-envelope.md'
atddChecklistPath: '_bmad-output/test-artifacts/workflow-commander/atdd-checklist-3-3a-define-shared-workflow-provider-command-envelope.md'
detectedStack: 'backend'
generationMode: 'ai-generation-sequential'
generatedTestFiles:
  - 'packages/cli/src/commands/workflow-provider-command-envelope.test.ts'
  - 'packages/cli/src/commands/provider-binding-contract.test.ts'
inputDocuments:
  - '_bmad-output/implementation-artifacts/3-3a-define-shared-workflow-provider-command-envelope.md'
  - '_bmad-output/test-artifacts/workflow-commander/test-design/test-design-3-3a-define-shared-workflow-provider-command-envelope.md'
  - '_bmad-output/test-artifacts/workflow-commander/test-design-epic-3.md'
  - '_bmad-output/project-context.md'
  - '_bmad/tea/config.yaml'
  - 'CLAUDE.md'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/README.md'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/schemas/workflow-command-envelope.schema.json'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/*.json'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/validate_contracts.py'
  - 'packages/cli/src/commands/provider-binding.ts'
  - 'packages/cli/src/commands/provider-binding.test.ts'
  - 'packages/cli/src/commands/provider-binding.e2e.test.ts'
  - 'packages/cli/src/commands/provider-binding-contract.test.ts'
  - 'packages/cli/src/cli.ts'
  - 'packages/cli/src/commands/workflow.ts'
  - 'packages/cli/package.json'
  - 'packages/core/src/db/provider-bindings.test.ts'
---

# ATDD Red-Phase Checklist: 3.3a Define Shared Workflow Provider Command Envelope

**Role:** Master Test Architect (TEA), Murat.
**Date:** 2026-07-14.
**Phase:** TDD RED — scaffolds only, no production code written.
**Stack detected:** backend (Bun + TypeScript CLI; no browser E2E — a CLI subprocess is the only first-party consumer surface, and it already exists from Story 3.1).
**Framework:** `bun:test`, mirroring `provider-binding.test.ts` (CLI command unit tests, fixture equality) and `provider-binding-contract.test.ts` (fixture/schema/validator regression checks with no application-code import).

## Preflight Summary

Story 3.3a is a **refactor-and-extend** story on top of Story 3.1, which is already implemented and merged (`packages/cli/src/commands/provider-binding.ts` exists with local `buildSuccessEnvelope`/`buildErrorEnvelope`/`safeStringify`/`resolveCorrelationId`/`resolveIssuedAt`, and `cli.ts` already dispatches `provider-binding`). The only genuinely-missing production file is `packages/cli/src/commands/workflow-provider-command-envelope.ts` (Task 1).

The TD source (`test-design-3-3a-define-shared-workflow-provider-command-envelope.md`) enumerates **57 atomic scenarios** (31 P0, 26 P1), 17 risks, 23 reviewer-concern dispositions, and 6 explicit waivers.

This pass differs from the typical "greenfield" ATDD shape in one important way: because Story 3.1 is already implemented, a large share of this story's P0/P1 scenarios (the five binding-command fixture regressions, the CLI E2E purity/malformed/unsupported-subcommand checks, the canonical contract validator, the "stale" status representability, etc.) are **already generated and already passing** in existing files from Story 3.1. Re-generating duplicate tests for those would violate DRY and the constitution's "keep review artifacts separate from implementation patches" guidance. Instead, this checklist traces each such scenario to its existing file:line home and adds only the tests that are genuinely new to this story: the shared module's own contract, and executable regression locks (baseline table, contract-package immutability, no-new-dependency, duplicate-helper-removal) that don't depend on the shared module existing.

**Environment note:** this worktree had no `node_modules` installed when this pass began (`bun install` was run to enable verification — 2584 packages, no code changes). All scaffolds below were **actually executed** with `bun test` during generation; the pass/fail/skip counts quoted are real. `bun --filter @archon/cli type-check` and `bun run lint` were also run and are clean.

## Generation Mode

AI generation, sequential — single-context deterministic scaffold generation for a backend CLI refactor story. Recording mode (browser) is N/A; Playwright Utils / Pact.js Utils are not applicable.

## Test Strategy (levels)

- **Unit — shared module contract (Bun, no mocks):** command/category enum exactness, success/failure envelope shape, reference-requirement enforcement, safe serialization, correlation/issued-at helpers, forbidden-field scan, binding-classification isolation. All depend on `workflow-provider-command-envelope.ts`, which doesn't exist — every one of these is `test.skip()`'d with a dynamic `await import(...)` inside the (never-executed) test body, so the file always loads.
- **Unit/Contract — executable regression locks (Bun, no application-code import):** the provider CLI syntax baseline table (defined as literal test data, not imported from the shared module), no-new-JSON-Schema-dependency in `package.json`, contract-package-not-edited (`git diff --quiet`), and duplicate-local-helper-removal (reads `provider-binding.ts` source as text). These run **today** and act as regression locks from the moment this pass lands, independent of Task 1/2 timing — mirroring the existing precedent for `3.1-CONTRACT-003` in `provider-binding-contract.test.ts` ("should already pass ... included as a regression check, not a new obligation").
- **CLI regression (Bun, already exists from Story 3.1, unmodified by this pass):** exact fixture conformance for the five binding commands, malformed-input fail-closed paths, security/compatibility scan, dependency/partial-failure mapping — `packages/cli/src/commands/provider-binding.test.ts`.
- **CLI E2E (Bun, real `Bun.spawn` subprocess, already exists from Story 3.1, unmodified by this pass):** malformed JSON purity, missing-flag-before-`--json`, unsupported-subcommand fail-closed — `packages/cli/src/commands/provider-binding.e2e.test.ts`.
- **Contract regression (Bun, spawns `python3 validate_contracts.py`, already exists, unmodified):** canonical validator gate, binding-domain status fixtures, dynamic-field-exclusion narrowness — `packages/cli/src/commands/provider-binding-contract.test.ts`.
- **CI/static:** secret/signing-material scan extended to the new shared module (genuinely `ENOENT`-red today); no-`_bmad-output`-import scan for the new module (also `ENOENT`-red today); type-check and full `bun run validate` are process gates, not generated Bun tests.

There is no API/UI/browser/Web E2E layer for this story (PRD forbids a state-changing HTTP path for v1; Dev Notes "Scope Boundary").

## Generated / Modified Files

| File                                                                         | Level                | Status today                                                                      | Isolation (package.json)                                                                 |
| ---------------------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `packages/cli/src/commands/workflow-provider-command-envelope.test.ts` (new) | Unit/Contract        | 7 pass (executable regression locks) / 42 skip (module-dependent) / 0 fail        | own line, shared with `provider-binding-contract.test.ts` (neither uses `mock.module()`) |
| `packages/cli/src/commands/provider-binding-contract.test.ts` (extended)     | Contract / CI-static | 3 pass (pre-existing Story 3.1 gates) / **3 new fail (red)**                      | already wired (existing line, now also runs the new envelope test file)                  |
| `packages/cli/package.json` (edited)                                         | test wiring          | one line extended to add the new test file to the existing non-mocking invocation | —                                                                                        |

Unmodified, already-passing files that this story's refactor (Task 2, out of ATDD scope) must keep green:

| File                                                     | Status today (unchanged by this pass)                                                                                                 |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/cli/src/commands/provider-binding.test.ts`     | 33 pass / 0 fail                                                                                                                      |
| `packages/cli/src/commands/provider-binding.e2e.test.ts` | 3 pass / 8 skip (the 8 skips are pre-existing Story 3.1 items needing a registered-codebase test fixture — out of this story's scope) |

Every file above was executed with `bun test <file>` individually during this pass, and the combined non-mocking invocation (`provider-binding-contract.test.ts` + `workflow-provider-command-envelope.test.ts`) was run together to confirm wiring matches `package.json`.

## Mandatory Mapping — every P0/P1 scenario and reviewer concern is represented

Legend: **exec-red** = executable test that fails today for the correct documented reason and will pass once Task 1/2 lands; **exec-pass** = executable regression gate that already passes today (not new coverage, but this story must not break it); **skip** = `test.skip()` scaffold with a documented activation seam; **already-covered** = an existing Story 3.1 test (unmodified) already satisfies this scenario's regression obligation; **waiver** = carried forward from the TD verbatim; **process-gate** = enforced by running a command, not a generated Bun assertion.

### P0 (31/31 represented)

| TD ID        | Scenario                                   | File                                                                       | Representation                                                              |
| ------------ | ------------------------------------------ | -------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| UNIT-001     | Command enum exactness                     | `workflow-provider-command-envelope.test.ts`                               | skip                                                                        |
| UNIT-002     | Diagnostic category exactness              | `workflow-provider-command-envelope.test.ts`                               | skip                                                                        |
| UNIT-003     | Workflow success envelope                  | `workflow-provider-command-envelope.test.ts`                               | skip                                                                        |
| UNIT-004     | Binding success envelope                   | `workflow-provider-command-envelope.test.ts`                               | skip                                                                        |
| UNIT-005     | Missing workflowRunRef rejected            | `workflow-provider-command-envelope.test.ts`                               | skip                                                                        |
| UNIT-006     | Missing bindingRef rejected                | `workflow-provider-command-envelope.test.ts`                               | skip                                                                        |
| UNIT-007     | Failure requires retryable                 | `workflow-provider-command-envelope.test.ts`                               | skip                                                                        |
| UNIT-008     | Failure shape and execution                | `workflow-provider-command-envelope.test.ts`                               | skip                                                                        |
| UNIT-009     | Result/error exclusivity                   | `workflow-provider-command-envelope.test.ts`                               | skip                                                                        |
| UNIT-010     | Safe serialization                         | `workflow-provider-command-envelope.test.ts`                               | skip                                                                        |
| UNIT-014     | Failure helper class coverage (5 classes)  | `workflow-provider-command-envelope.test.ts`                               | skip (5 sub-cases)                                                          |
| UNIT-016     | Forbidden fields and secrets               | `workflow-provider-command-envelope.test.ts`                               | skip                                                                        |
| UNIT-020     | Binding create fixture                     | `provider-binding.test.ts` (unmodified)                                    | **already-covered**                                                         |
| UNIT-021     | Binding update fixture                     | `provider-binding.test.ts` (unmodified)                                    | **already-covered**                                                         |
| UNIT-022     | Binding status fixture                     | `provider-binding.test.ts` (unmodified)                                    | **already-covered**                                                         |
| UNIT-023     | Binding rotate fixture                     | `provider-binding.test.ts` (unmodified)                                    | **already-covered**                                                         |
| UNIT-024     | Binding disable fixture                    | `provider-binding.test.ts` (unmodified)                                    | **already-covered**                                                         |
| UNIT-025     | Binding malformed fixture                  | `provider-binding.test.ts` (unmodified)                                    | **already-covered**                                                         |
| CONTRACT-033 | Syntax baseline covers all 12 commands     | `workflow-provider-command-envelope.test.ts`                               | **exec-pass** (verified: baseline table vs. schema enum)                    |
| CONTRACT-034 | `workflow.cancel` ≠ `abandon`              | `workflow-provider-command-envelope.test.ts`                               | **exec-pass** (verified)                                                    |
| CONTRACT-035 | `workflow.retry` ≠ `retry-node`            | `workflow-provider-command-envelope.test.ts`                               | **exec-pass** (verified)                                                    |
| CONTRACT-037 | Representative success for all 12 families | `workflow-provider-command-envelope.test.ts`                               | skip (12 sub-cases, one per command family, byte-for-byte against fixtures) |
| CONTRACT-038 | Malformed request failure example          | `workflow-provider-command-envelope.test.ts`                               | skip                                                                        |
| CONTRACT-039 | Schema mismatch failure example            | `workflow-provider-command-envelope.test.ts`                               | skip                                                                        |
| CONTRACT-040 | Timeout failure example                    | `workflow-provider-command-envelope.test.ts`                               | skip                                                                        |
| CONTRACT-041 | Unexpected exit failure example            | `workflow-provider-command-envelope.test.ts`                               | skip                                                                        |
| CONTRACT-042 | Unexpected state failure example           | `workflow-provider-command-envelope.test.ts`                               | skip                                                                        |
| CLI-043      | Malformed subprocess JSON                  | `provider-binding.e2e.test.ts` (unmodified)                                | **already-covered**                                                         |
| CLI-046      | `--json` purity                            | `provider-binding.e2e.test.ts` (unmodified)                                | **already-covered**                                                         |
| CONTRACT-047 | Canonical validator passes                 | `provider-binding-contract.test.ts` (pre-existing `3.1-CONTRACT-003` test) | **already-covered / exec-pass**                                             |
| CI-049       | Source/envelope secret scan (extended)     | `provider-binding-contract.test.ts`                                        | **exec-red** (verified: genuine `ENOENT` on the missing shared module path) |

### P1 (26/26 represented)

| TD ID        | Scenario                                  | File                                                                                  | Representation                                                                                                                                                                                                                                               |
| ------------ | ----------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| UNIT-011     | Correlation id behavior                   | `workflow-provider-command-envelope.test.ts`                                          | skip                                                                                                                                                                                                                                                         |
| UNIT-012     | Issued-at behavior                        | `workflow-provider-command-envelope.test.ts`                                          | skip                                                                                                                                                                                                                                                         |
| UNIT-013     | Invalid command/category guard            | `workflow-provider-command-envelope.test.ts`                                          | skip                                                                                                                                                                                                                                                         |
| UNIT-015     | Execution metadata details                | `workflow-provider-command-envelope.test.ts`                                          | skip                                                                                                                                                                                                                                                         |
| UNIT-017     | No production planning-artifact imports   | `provider-binding-contract.test.ts`                                                   | **exec-red** (verified: genuine `ENOENT`)                                                                                                                                                                                                                    |
| UNIT-018     | No new JSON Schema runtime dependency     | `workflow-provider-command-envelope.test.ts`                                          | **exec-pass** (verified: scans `packages/cli/package.json`)                                                                                                                                                                                                  |
| UNIT-019     | Test batch isolation decision             | —                                                                                     | **waiver-style decision** (see below) — new file uses no `mock.module()`, so it shares the existing non-mocking `provider-binding-contract.test.ts` invocation; documented, not a Bun test                                                                   |
| UNIT-026     | Unsupported provider-binding subcommand   | `provider-binding.test.ts` (unmodified)                                               | **already-covered**                                                                                                                                                                                                                                          |
| UNIT-027     | Binding classification stays local        | `workflow-provider-command-envelope.test.ts`                                          | skip                                                                                                                                                                                                                                                         |
| UNIT-028     | DB timeout classification preserved       | `provider-binding.test.ts` (unmodified)                                               | **already-covered**                                                                                                                                                                                                                                          |
| UNIT-029     | Non-serializable provider-binding error   | `provider-binding.test.ts` (unmodified)                                               | **already-covered**                                                                                                                                                                                                                                          |
| UNIT-030     | Dynamic exclusions stay narrow            | `provider-binding-contract.test.ts` (pre-existing `3.1-CONTRACT-004`-equivalent test) | **already-covered / exec-pass**                                                                                                                                                                                                                              |
| UNIT-031     | Duplicate local helpers removed           | `provider-binding-contract.test.ts`                                                   | **exec-red** (verified: `provider-binding.ts` still defines all five locally today)                                                                                                                                                                          |
| UNIT-032     | Binding-specific logic remains local      | `workflow-provider-command-envelope.test.ts`                                          | skip                                                                                                                                                                                                                                                         |
| CONTRACT-036 | Workflow runtime conversion not done here | `workflow-provider-command-envelope.test.ts`                                          | skip (scope guard)                                                                                                                                                                                                                                           |
| CLI-044      | Missing string flag before `--json`       | `provider-binding.e2e.test.ts` (unmodified)                                           | **already-covered**                                                                                                                                                                                                                                          |
| CLI-045      | Unsupported subcommand subprocess         | `provider-binding.e2e.test.ts` (unmodified)                                           | **already-covered**                                                                                                                                                                                                                                          |
| CONTRACT-048 | Contract package not edited               | `workflow-provider-command-envelope.test.ts`                                          | **exec-pass** (verified: `git diff --quiet` on the contracts dir)                                                                                                                                                                                            |
| CI-050       | Package script test isolation             | `packages/cli/package.json`                                                           | **satisfied by construction** — the new file uses no `mock.module()`, so it was added to the existing non-mocking invocation rather than a new isolated line; verified by running both files together in one process with no cross-pollution                 |
| CI-051       | CLI type-check                            | —                                                                                     | **process gate**: `bun --filter @archon/cli type-check` (already run clean during this pass)                                                                                                                                                                 |
| CI-052       | Full validation                           | —                                                                                     | **process gate**: `bun run validate` (will fail today by design — new files are red/skip — and must pass before Task 5 sign-off)                                                                                                                             |
| CI-053       | File-scope review                         | `workflow-provider-command-envelope.test.ts`                                          | skip — **waiver-style skip**, not a missing-module skip (see Skipped Scaffolds below)                                                                                                                                                                        |
| UNIT-054     | Stale status representability preserved   | `provider-binding.test.ts` (unmodified)                                               | **already-covered**                                                                                                                                                                                                                                          |
| UNIT-055     | Duplicate create non-upsert preserved     | `packages/core/src/db/provider-bindings.test.ts` (Story 3.1 scope, unmodified)        | **already-covered**                                                                                                                                                                                                                                          |
| UNIT-056     | Parallel helper calls independent         | `workflow-provider-command-envelope.test.ts`                                          | skip                                                                                                                                                                                                                                                         |
| CI-057       | Rollback review                           | —                                                                                     | **waiver-style note**: this story touches no DB/schema/contract state; rollback is reverting the single commit. Owner: story implementer. Residual risk: none identified. Trigger: if a later revision of this story expands scope into DB/contract changes. |

### Reviewer Concerns (23/23 disposed)

All 23 reviewer concerns (RC-01…RC-23) from `test-design-3-3a-...md`'s "Reviewer-Evidence Disposition" table are carried forward unchanged — each maps to the same TD scenario IDs listed there, and every one of those scenario IDs has a concrete file:line home (or already-covered/waiver disposition) in the tables above. RC-19/RC-21/RC-22/RC-23 map to explicit non-risk dispositions or waivers (W-3.3A-001/002/003/004), exactly as the TD already documents.

### Acceptance Criteria (4/4 traceable)

| AC                                                                                                | Coverage                                                                                                                             |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| AC1 (success envelope: schemaVersion, success, correlationId, refs, result)                       | UNIT-003-006/011/012/020-024/037 — all represented above                                                                             |
| AC2 (failure envelope: schemaVersion, success, correlationId, code, category, retryable, details) | UNIT-002/007-009/011/012/014/015/025; CONTRACT-038-042 — all represented above                                                       |
| AC3 (implemented syntax + `--json` returns canonical command; drift fails tests)                  | UNIT-001; CONTRACT-033-037; W-3.3A-001 for later runtime conversions                                                                 |
| AC4 (fail-closed for malformed JSON/schema mismatch/timeout/exit/state)                           | UNIT-010/014-016/026-029; CONTRACT-038-042; CLI-043-046 (already-covered); W-3.3A-003 for actual runtime cancellation/timeout policy |

## Skipped Scaffolds — reason and activation seam

Every `test.skip()` in `workflow-provider-command-envelope.test.ts` falls into one of two buckets:

**1. Target module doesn't exist yet** (the overwhelming majority — `packages/cli/src/commands/workflow-provider-command-envelope.ts` is absent). Every one of these tests imports the missing module **dynamically inside the skipped test body** (never statically at file top), so the file loads and reports a clean skip today instead of crashing on module resolution. Activation is uniform: implement the file per the story's Dev Notes Task 1 (exporting at minimum `WORKFLOW_PROVIDER_COMMANDS`, `ERROR_CATEGORIES`, `buildSuccessEnvelope`, `buildErrorEnvelope`, `safeStringify`, `resolveCorrelationId`, `resolveIssuedAt`), remove `.skip`. Each test's inline comment repeats the exact activation condition.

**2. Waiver-style skip, not a missing-module skip:**

- `CI-053` (file-scope review) — a reliable machine check needs a stable merge-base ref (e.g. `git diff --name-only origin/dev...HEAD`), which is not guaranteed available or correct inside every worktree/CI checkout shape this repo uses. Enforced today by human PR review against the story's "Project Structure Notes" / "Unexpected for this story" lists. Activate by replacing the skip body with a `git diff --name-only <base>...HEAD` check once a stable base-ref convention for story-scope review is adopted.

No scenario is skipped merely for convenience; every skip reason above names a specific missing seam (or an explicit process-gate/waiver reason) and the exact change that flips it to red-then-green.

## Waivers (6/6 carried forward, unchanged from TD)

| ID         | Reason                                                                                                                               | Owner                             | Residual risk                                                                                 | Follow-up trigger                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| W-3.3A-001 | Story 3.3a defines the shared helper and baseline only; runtime conversion of workflow command families belongs to Stories 3.3b-3.3d | Product + Archon CLI owner        | Future workflow commands may remain legacy JSON until their producer stories land             | Story 3.3b, 3.3c, or 3.3d starts implementation                              |
| W-3.3A-002 | Browser, HTTP API, server routes, web UI, event outbox, delivery health, and Hermes behavior are outside this CLI story              | Product + architecture owners     | End-to-end consumer integration is not proven here                                            | Approved story activates one of those surfaces                               |
| W-3.3A-003 | The helper can represent timeout/cancel envelopes but does not define runtime timeout, abort-signal, or cancellation policy          | CLI architecture owner            | A future runtime command may hang or cancel inconsistently until command policy is defined    | Timeout SLO, abort-signal contract, or runtime command story is accepted     |
| W-3.3A-004 | Current CLI helper runs under local OS-process trust and has no application-level auth/permission requirement                        | Security owner                    | Local users with command access can invoke helper-backed commands according to existing trust | Remote, multi-user, service-account, or role policy is introduced            |
| W-3.3A-005 | Out-of-order event handling is not applicable — no event ingestion/ledger/outbox/callback surface exists in this story               | Workflow event architecture owner | Event-order defects are not detected here                                                     | Story 3.5, 3.7, or Hermes callback ingress activates event ordering behavior |
| W-3.3A-006 | No performance/load threshold exists for local envelope construction                                                                 | Product/operations owner          | Slow helper code has no numeric SLO gate beyond normal test/runtime feedback                  | Latency SLO, remote exposure, or performance incident is accepted            |

None of these required new test artifacts in this pass — they are pre-existing TD decisions about undefined/excluded behavior, reproduced here verbatim per the "every reviewer concern → test, skip, or waiver" mandate.

## Exact Commands to Run the Generated Tests

Individual files (fastest feedback loop while implementing Task 1):

```bash
# Task 1 — shared envelope module + baseline/regression locks
bun test packages/cli/src/commands/workflow-provider-command-envelope.test.ts

# Task 1/2/3 — secret scan extension, no-planning-import scan, duplicate-helper-removal lock
bun test packages/cli/src/commands/provider-binding-contract.test.ts

# Task 2 — provider-binding refactor regression (must stay green throughout)
bun test packages/cli/src/commands/provider-binding.test.ts
bun test packages/cli/src/commands/provider-binding.e2e.test.ts
```

Full package-isolated suite (matches CI / `bun run validate`):

```bash
bun run --filter @archon/cli test
```

Do **not** run root `bun test` (discovers all packages in one process; causes `mock.module()` pollution per CLAUDE.md).

Contract-package regression (already passing, run after any change to confirm it stays that way):

```bash
python3 _bmad-output/planning-artifacts/contracts/workflow-commander/validate_contracts.py
```

Type-check and full pre-PR gate (type-check is clean today; full validate will fail today by design until Task 1/2 land):

```bash
bun --filter @archon/cli type-check
bun run validate
```

## Current (Red-Phase) Verified State

- `packages/cli/src/commands/workflow-provider-command-envelope.test.ts`: 7 pass (executable regression locks) / 42 skip (module-dependent) / 0 fail.
- `packages/cli/src/commands/provider-binding-contract.test.ts`: 3 pass (pre-existing Story 3.1 gates) / **3 fail (new, red: CI-049 extension, UNIT-017, UNIT-031)**.
- `packages/cli/src/commands/provider-binding.test.ts`: 33 pass / 0 fail (unmodified — this story's Task 2 refactor must keep this file exactly as green).
- `packages/cli/src/commands/provider-binding.e2e.test.ts`: 3 pass / 8 skip (unmodified — pre-existing Story 3.1 skips unrelated to this story).
- `bun --filter @archon/cli type-check`: clean, no errors from any new/modified file.
- `bun run lint`: clean, 0 warnings across the whole repo (`--max-warnings 0`).
- `python3 validate_contracts.py`: passes unchanged (7 schemas, 17 command examples, etc.) — contract package untouched by this pass.

This is the expected and correct TDD red-phase state: every genuinely-testable-today boundary (the syntax baseline table, `package.json` dependency scan, `git diff` on the contract package, the still-duplicated helpers in `provider-binding.ts`) fails or passes for the _right_ documented reason, and every not-yet-existing boundary (the shared module itself) is a clean, activatable skip.

## Next Recommended Workflow

`dev-story` — implement Task 1 (shared module) first to flip the 42 skips and 2 of the 3 new `provider-binding-contract.test.ts` failures; then Task 2 (provider-binding refactor) to flip the remaining `UNIT-031` failure while keeping `provider-binding.test.ts`/`provider-binding.e2e.test.ts` at their current green counts; then Task 3 (baseline/fixture tests — already scaffolded here) and Task 5 (`bun run validate`) to close out. `*automate` is not needed next — P1 coverage is already complete in this pass; run `nfr-assess` only after implementation evidence exists.
