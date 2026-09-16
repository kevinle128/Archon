# ATDD Checklist: Story a5.2 — Generate PR Handoff With Evidence Links

**Date:** 2026-07-09
**Phase:** RED (acceptance scaffolds only — no production code)

## Generated Files

| File                                                             | Type                                   | mock.module? | Test Count                               |
| ---------------------------------------------------------------- | -------------------------------------- | ------------ | ---------------------------------------- |
| `packages/workflows/src/defaults/v2-pr-handoff-contract.test.ts` | Structural contract + technique proofs | No           | 62 tests (28 pass / 34 fail red)         |
| `packages/workflows/src/defaults/v2-pr-handoff-dag.test.ts`      | DAG executor (real bash + mock AI)     | Yes          | 22 tests (12 pass / 3 skip / 7 fail red) |

## P0/P1 Scenario Coverage

### P0 Scenarios (10)

| TD ID  | Requirement                                                                              | File                                             | Status                                        | Notes                                                                                                           |
| ------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| TD-400 | Precondition: predecessor `decision-needed-check` restored, prior route-loop tail intact | Contract                                         | RED                                           | Asserts node shape, wiring, dependencies, Linear absence                                                        |
| TD-402 | Required chain: decision-needed-check -> pr-handoff -> create-pull-request               | Contract                                         | RED                                           | PR cannot bypass handoff                                                                                        |
| TD-404 | Whole-output substitutions, bun -e + JSON.parse, env export, no grep/case/prose          | Contract                                         | RED                                           | Carries forward JSON-only and env-export findings                                                               |
| TD-408 | Happy path: all gates PASS, deferred:false, handoff emits, PR reached                    | DAG                                              | RED                                           | Primary happy path — pr-handoff.json + .md verified                                                             |
| TD-410 | Populated deferred items render each field, "deferred to Linear", "NOT fixed in this PR" | Contract (technique) + DAG (skip)                | RED (contract) / SKIP (DAG)                   | Live DAG path unreachable — see skip scaffold                                                                   |
| TD-412 | Story-ref mismatch fails closed per consumed contract, no handoff, no PR                 | Contract (static + technique proof) + DAG (skip) | RED (static) / GREEN (technique) / SKIP (DAG) | Upstream validation eats bad ref before pr-handoff runs; fail-closed proven by technique proof in contract test |
| TD-413 | Malformed/empty input fails closed, no handoff, no PR                                    | Contract (static) + DAG                          | RED                                           | Empty outputs, invalid JSON                                                                                     |
| TD-417 | No partial pr-handoff.json or .md on fail-closed path                                    | DAG                                              | RED                                           | Guards misleading evidence                                                                                      |
| TD-419 | Dependency failure (failed DNC, failed summary, empty CR) prevents handoff and PR        | DAG                                              | RED                                           | Out-of-order events, dependency failure                                                                         |
| TD-427 | No auth/credential/network/Linear/MCP scope broadening                                   | Contract                                         | GREEN                                         | Static forbidden-marker scan — must stay green                                                                  |

### P1 Scenarios (16)

| TD ID  | Requirement                                                                            | File                       | Status                    | Notes                                  |
| ------ | -------------------------------------------------------------------------------------- | -------------------------- | ------------------------- | -------------------------------------- |
| TD-401 | pr-handoff exists as bash node with timeout, output_type, deps, trigger_rule           | Contract                   | RED                       | Node shape                             |
| TD-403 | Bundle parity: v2 source/bundle sync, v1 untouched                                     | Contract                   | RED (bundle) / GREEN (v1) | v1 assertion is green now              |
| TD-405 | Real-vs-skipped selection by non-empty output for RV/NR/TR                             | Contract                   | RED                       | Source node id recording               |
| TD-406 | Artifact path mapping: run-dir JSON vs node sidecar Markdown                           | Contract                   | RED                       | Evidence link correctness              |
| TD-407 | pr-handoff.json collector envelope with status (not gate)                              | Contract                   | RED                       | Envelope shape                         |
| TD-409 | No-deferred renders "No decision-needed items were deferred."                          | Contract (technique) + DAG | RED                       | AC #3                                  |
| TD-411 | Boundary rendering: pipes, brackets, long titles don't break Markdown                  | Contract (technique)       | GREEN (technique)         | Rendering proof passes                 |
| TD-414 | Missing branch boundary: both real and skipped empty → fails, no PR                    | DAG                        | RED                       | Branch-boundary coverage               |
| TD-415 | Mixed branch: RV skip + NR real + TR skip → correct sources/outcomes                   | DAG                        | RED                       | Branch-mix coverage                    |
| TD-416 | Gate outcome rendering: PASS, CONCERNS, SKIPPED                                        | Contract (technique)       | GREEN (technique)         | Rendering proofs pass                  |
| TD-418 | Artifact isolation: distinct dirs, deterministic overwrite                             | DAG                        | RED                       | Run-directory isolation                |
| TD-420 | Timeout guard: bounded timeout, local-only work, no network                            | Contract                   | RED                       | Static assertion                       |
| TD-421 | prompt_suffix instructs agent to read pr-handoff.md, skip if absent, never imply fixed | Contract                   | RED                       | Deterministic guard                    |
| TD-422 | create-pull-request preserves command/provider/model/context, depends on pr-handoff    | Contract                   | RED                       | Compatibility                          |
| TD-423 | Contract test in non-mock batch; DAG test as standalone segment                        | Contract                   | RED                       | Expected-red until wired               |
| TD-426 | Route-loop regression: FAIL/ERROR/exhaustion behavior unchanged                        | DAG                        | GREEN                     | Must stay green through implementation |

### P2/P3 Scenarios (4)

| TD ID  | Priority | Requirement                                     | File     | Status |
| ------ | -------- | ----------------------------------------------- | -------- | ------ |
| TD-424 | P3       | No plan/story/finding identifiers in test files | Contract | GREEN  |
| TD-425 | P2       | Validation commands documented                  | Contract | GREEN  |
| TD-428 | P2       | Unset ARTIFACTS_DIR degrades gracefully         | Contract | RED    |
| TD-429 | P2       | Shared archon-create-pr.md untouched or guarded | Contract | GREEN  |

## Skipped Scaffolds

| Test                                                                                    | File | Why Skipped                                                                                                                                                                                                                                                                                                                                              | Expected Activation                                                                                                                              |
| --------------------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Populated deferred items render correctly through the real DAG (TD-410/TD-411 DAG half) | DAG  | `decision-needed-check` fails closed (exit 1) when `decision_needed_count > 0`, making `deferred:true` unreachable through the real DAG. The rendering contract is proven by the technique proof in the contract test sibling.                                                                                                                           | Activate when the live Linear tracking path (predecessor AC #5/#6) is built, allowing count>0 to produce deferred:true and proceed to pr-handoff |
| Story-ref mismatch on consumed contracts (TD-412 DAG half)                              | DAG  | Upstream nodes (verify-story-identity, quality-gate-summary) already validate every role contract's story_ref. A bad ref injected into CR/RV/NR/TR mock output fails the summary/verifier before pr-handoff ever runs — pr-handoff state is undefined (never reaches it), not 'failed'. Fail-closed behavior proven by technique proof in contract test. | Activate if a fault-injection seam is added that bypasses upstream validation and delivers a mismatched story_ref directly to pr-handoff         |
| Bash-sourced contract mismatch (TD-412/413 bash half)                                   | DAG  | Same mechanism: real bash nodes either emit correct envelopes or hard-fail, consuming bad refs upstream. Proven by technique proof in contract test.                                                                                                                                                                                                     | Activate if a stub bash node or fault-injection seam is added                                                                                    |

## Waivers

| ID    | Scope                                                                | Reason                                                                                            | Owner                                   | Residual Risk                                                                   | Follow-Up Trigger                                                                                        |
| ----- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| W-001 | Live population of `deferred_items` from Linear and BMAD-METHOD sync | M3.1/M3.2 and Linear integration unavailable; predecessor fails closed before PR when count > 0   | BMAD-METHOD owner / workflow maintainer | Fixture rendering passes while real Linear population unproven                  | Reopen when M3.1/M3.2, Linear capability, and predecessor live AC #5/#6 are present                      |
| W-002 | Full envelope gauntlet inside pr-handoff                             | Story scopes collector validation to presence + story_ref because upstream nodes already validate | Workflow architect                      | If upstream validators weakened, pr-handoff may trust insufficient contracts    | Reopen if upstream validation code changes or contract version changes                                   |
| W-003 | Executor cancellation lifecycle                                      | Story does not change executor lifecycle or cancellation handling                                 | Workflow engine owner                   | Cancellation during best-effort writes could leave partial filesystem artifacts | Reopen if executor cancellation, bash node lifecycle, or long-running external work changes              |
| W-004 | Auth, adapter permission, and credential delivery tests              | No auth, adapter, provider-credential, Linear API, MCP, or network code should change             | Security/platform owner                 | Hidden scope creep would be serious                                             | Reopen immediately if diff touches adapters, auth, credential stores, fetch, GraphQL, MCP, or Linear API |
| W-005 | Deterministic proof AI PR writer includes handoff section            | Static workflow requires prompt_suffix but AI prose inclusion is non-deterministic                | Workflow maintainer                     | PR body may omit evidence even when artifacts exist                             | Reopen during vertical-slice validation or if archon-create-pr gains deterministic assembly              |
| W-006 | Load/performance benchmarking                                        | Bounded local JSON parsing; no service endpoint or high-volume path                               | Workflow maintainer                     | Large future evidence payloads could exceed expectations                        | Reopen if collector reads external files, network resources, or large unbounded sets                     |
| W-007 | Browser UI or console E2E                                            | No browser-visible surface for this story; DAG test IS the first-party consumer surface           | Web/console owner                       | UI consumers may later render handoff artifacts incorrectly                     | Reopen if Web UI, console, or artifact viewer displays pr-handoff evidence                               |

## Acceptance Criteria Traceability

| AC                                                                                                   | Scenario(s)                                                                            | Status                                  |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------- |
| AC #1 — Evidence links for CR/RV/NR/TR/summary/decision-needed, correct branches, matching story_ref | TD-400, TD-401, TD-402, TD-404, TD-405, TD-406, TD-408, TD-412, TD-415, TD-421, TD-422 | Covered                                 |
| AC #2 — Deferred items listing with all fields, fixture-tested; live population deferred             | TD-410, TD-411, W-001                                                                  | Covered for rendering; live path waived |
| AC #3 — No deferred items explicit statement, no implication fixed                                   | TD-409, TD-410, TD-421                                                                 | Covered                                 |
| AC #4 — Full envelope + story identity; mismatch/empty fails closed                                  | TD-407, TD-408, TD-412, TD-413, TD-417                                                 | Covered                                 |
| AC #5 — Bundle parity, v1 untouched, shared command compatible via prompt_suffix                     | TD-403, TD-421, TD-423, TD-425, TD-429                                                 | Covered                                 |

## Commands to Run Generated Tests

```bash
# Contract test (non-mock, co-locatable in shared batch)
bun test packages/workflows/src/defaults/v2-pr-handoff-contract.test.ts

# DAG test (uses mock.module — MUST run as isolated segment)
bun test packages/workflows/src/defaults/v2-pr-handoff-dag.test.ts

# After implementation, run these before PR:
bun run generate:bundled
bun run check:bundled
bun run validate
```

## Current Red-Phase Results

**Contract test:** 28 pass / 34 fail red / 0 skip

- Green: technique proofs (rendering pipelines, story_ref validation, boundary rendering), v1 baseline guard, security scope guard, naming hygiene, shared command guard
- Red: all structural assertions about the not-yet-implemented pr-handoff node and its wiring

**DAG test:** 12 pass / 7 fail red / 3 skip

- Green: route-loop regression guards (FAIL-then-PASS, ERROR, exhaustion)
- Red: all pr-handoff behavioral assertions (happy path, malformed input, dependency failure, artifact isolation, mixed branches)
- Skip: populated deferred items (DAG-unreachable), story_ref mismatch on consumed contracts (upstream eats it), bash-sourced contract mismatch (no fault-injection seam)
