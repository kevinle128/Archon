---
stepsCompleted:
  [
    'step-01-preflight-and-context',
    'step-02-generation-mode',
    'step-03-test-strategy',
    'step-04-generate-tests',
    'step-05-validate-and-complete',
  ]
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-07-16'
storyId: '3.3b'
storyKey: '3-3b-provide-archon-start-and-status-cli-json'
storyFile: '_bmad-output/implementation-artifacts/3-3b-provide-archon-start-and-status-cli-json.md'
atddChecklistPath: '_bmad-output/test-artifacts/workflow-commander/atdd-checklist-3-3b-provide-archon-start-and-status-cli-json.md'
generatedTestFiles:
  [
    'packages/cli/src/commands/workflow.test.ts',
    'packages/cli/src/adapters/cli-adapter.test.ts',
    'packages/cli/src/commands/workflow-json.e2e.test.ts',
    'packages/cli/src/commands/workflow-command-contract.test.ts',
  ]
---

# ATDD Checklist — Story 3.3b: Provide Archon Start And Status CLI JSON

**Mode:** AI generation (backend/CLI story — no browser recording).
**Stack:** `backend` (Bun + TypeScript CLI, `@archon/cli`).
**Source of scenarios:** `_bmad-output/test-artifacts/workflow-commander/test-design/test-design-3-3b-provide-archon-start-and-status-cli-json.md` (47 scenarios: 22 P0, 25 P1) plus its Reviewer-Evidence Disposition table (RC-01..RC-27).
**Scope:** Red-phase scaffolds only. **No production code was written or modified** — only test files and one test-harness wiring change (`packages/cli/package.json`).

## 1. Prerequisites Verified

- [x] Story approved with clear acceptance criteria (`ready-for-dev`).
- [x] Test framework configured: `bun:test`, per-package isolated invocations (`packages/cli/package.json`).
- [x] Development environment available (`bun install` run; `bun test`/`bun --filter @archon/cli type-check`/`bun run lint`/`bun x prettier` all executed against the new/changed files).
- [x] Story 3.3a shared envelope module (`workflow-provider-command-envelope.ts`) present and its own test suite green (49 pass / 0 fail, confirmed as a regression gate — see CONTRACT-038).
- [x] Canonical `validate_contracts.py` passes today (confirmed — see CONTRACT-039).

## 2. Mandatory Mapping — Every P0/P1 Scenario, Every Reviewer Concern

Every row is exactly one of: **RED (executable)**, **SKIP (scaffold)**, or **WAIVED**.

### P0 (22 scenarios)

| Test ID           | Disposition                              | Location                                                  | Notes                                                                   |
| ----------------- | ---------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------- |
| 3.3B-UNIT-001     | RED (executable)                         | `workflow.test.ts` › `workflowRunCommand — JSON envelope` | Completed-run success envelope shape                                    |
| 3.3B-UNIT-002     | SKIP                                     | `workflow.test.ts` › state-mapping helper block           | Helper doesn't exist yet — see §4                                       |
| 3.3B-UNIT-003     | SKIP                                     | same                                                      | —                                                                       |
| 3.3B-UNIT-004     | SKIP                                     | same                                                      | —                                                                       |
| 3.3B-UNIT-005     | SKIP                                     | same                                                      | —                                                                       |
| 3.3B-UNIT-006     | SKIP                                     | same                                                      | —                                                                       |
| 3.3B-UNIT-007     | SKIP                                     | same                                                      | —                                                                       |
| 3.3B-UNIT-009     | RED (executable)                         | `workflow.test.ts`                                        | Failed exec w/ run id → structured, non-leaking error                   |
| 3.3B-UNIT-010     | RED (executable)                         | `workflow.test.ts`                                        | Failed exec w/o run id → INTERNAL_ERROR                                 |
| 3.3B-UNIT-012     | RED (executable)                         | `workflow.test.ts`                                        | Unknown workflow name fails closed under `--json`                       |
| 3.3B-UNIT-015     | RED (executable)                         | `workflow.test.ts`                                        | Stdout purity — exactly one line, no human text                         |
| 3.3B-UNIT-016     | RED (executable)                         | `workflow.test.ts`                                        | Paused-approval start → one envelope + gateRef                          |
| 3.3B-UNIT-019     | RED (executable)                         | `workflow.test.ts` › `workflowGetCommand`                 | Not-found → `workflow.status` error envelope, exit 78                   |
| 3.3B-UNIT-020     | RED (executable)                         | `workflow.test.ts`                                        | DB error → INTERNAL_ERROR, no raw message leak                          |
| 3.3B-UNIT-021     | RED (executable)                         | `workflow.test.ts`                                        | Completed run → `workflow.status` success envelope                      |
| 3.3B-UNIT-022     | RED (executable)                         | `workflow.test.ts`                                        | Paused-approval status → waiting-for-approval + gateRef                 |
| 3.3B-CLI-031      | RED (executable, subprocess)             | `workflow-json.e2e.test.ts`                               | Missing `run` name → MALFORMED_REQUEST envelope, exit 64                |
| 3.3B-CLI-032      | RED (executable, subprocess)             | `workflow-json.e2e.test.ts`                               | Bad flag combo bypasses `--json` today                                  |
| 3.3B-CLI-033      | RED (executable, subprocess)             | `workflow-json.e2e.test.ts`                               | Missing `get` run id → MALFORMED_REQUEST envelope, exit 64              |
| 3.3B-CLI-035      | RED (executable, subprocess)             | `workflow-json.e2e.test.ts`                               | Unknown workflow → one classified envelope, exit 78                     |
| 3.3B-CONTRACT-036 | RED (executable)                         | `workflow-command-contract.test.ts`                       | Forbidden-key scan on parsed emitted envelopes                          |
| 3.3B-CONTRACT-039 | GREEN (regression gate, already passing) | `workflow-command-contract.test.ts`                       | `validate_contracts.py` passes unmodified today — kept as a locked gate |

### P1 (25 scenarios)

| Test ID           | Disposition                  | Location                                                          | Notes                                                                                                      |
| ----------------- | ---------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 3.3B-UNIT-008     | RED (executable)             | `workflow.test.ts`                                                | `projectRef` derivation/omission (2 sub-cases)                                                             |
| 3.3B-UNIT-011     | RED (executable)             | `workflow.test.ts`                                                | Persisted-run reload failure → structured internal error                                                   |
| 3.3B-UNIT-013     | RED (executable)             | `workflow.test.ts`                                                | Blocking semantics — envelope only after `executeWorkflow` resolves                                        |
| 3.3B-UNIT-014     | RED (executable)             | `cli-adapter.test.ts`                                             | `CLIAdapter` silent mode — no stdout, persistence preserved                                                |
| 3.3B-UNIT-017     | SKIP                         | `workflow.test.ts` › `classifyRunError` block                     | Helper doesn't exist yet — see §4                                                                          |
| 3.3B-UNIT-018     | RED (executable)             | `workflow.test.ts`                                                | Correlation id echoed (success + error, 2 sub-cases)                                                       |
| 3.3B-UNIT-023     | RED (executable)             | `workflow.test.ts`                                                | Failed-run status shape, no raw metadata leak                                                              |
| 3.3B-UNIT-024     | RED (executable)             | `workflow.test.ts`                                                | `get` correlation id threading (2 sub-cases)                                                               |
| 3.3B-UNIT-025     | RED (executable)             | `workflow.test.ts`                                                | Verbose events under `result.events`, omitted otherwise (2 sub-cases)                                      |
| 3.3B-UNIT-026     | RED (executable)             | `workflow.test.ts`                                                | Verbose event order is a pass-through, not reinterpreted                                                   |
| 3.3B-UNIT-027     | RED (executable)             | `workflow.test.ts` + `cli-adapter.test.ts`                        | Persistence failure doesn't corrupt stdout (covered at both levels)                                        |
| 3.3B-UNIT-028     | RED (executable)             | `workflow.test.ts`                                                | Two sequential JSON starts don't mix correlation ids/refs                                                  |
| 3.3B-UNIT-029     | SKIP                         | `workflow.test.ts` › `classifyRunError` block                     | Helper doesn't exist yet — see §4                                                                          |
| 3.3B-UNIT-030     | SKIP                         | `workflow.test.ts` › state-mapping helper block                   | Helper doesn't exist yet — see §4                                                                          |
| 3.3B-CLI-034      | RED (executable, subprocess) | `workflow-json.e2e.test.ts`                                       | `--correlation-id` threads through `run` and `get` argv (2 sub-cases)                                      |
| 3.3B-CONTRACT-037 | RED (executable)             | `workflow-command-contract.test.ts`                               | Fixture keeps `phase`/`projectBindingRef`; real envelope must NOT fake them                                |
| 3.3B-CONTRACT-038 | RED-then-GREEN split         | `workflow-command-contract.test.ts`                               | Source-scan lock (passes vacuously today by design) + shared-module regression run (genuinely green today) |
| 3.3B-CONTRACT-040 | GREEN (regression gate)      | `workflow-command-contract.test.ts`                               | No `_bmad-output` runtime import in `workflow.ts`/`cli.ts` — true today, locked going forward              |
| 3.3B-REG-041      | GREEN (existing coverage)    | `workflow.test.ts` (pre-existing tests)                           | Non-JSON human behavior — see §5                                                                           |
| 3.3B-REG-042      | GREEN (existing coverage)    | `workflow.test.ts` › `workflowRunCommand — detach` (pre-existing) | Detach ack unchanged — see §5                                                                              |
| 3.3B-REG-043      | GREEN (existing coverage)    | `provider-binding.test.ts` (pre-existing, untouched)              | Binding commands unaffected — see §5                                                                       |
| 3.3B-CI-044       | GREEN (harness wiring)       | `packages/cli/package.json`                                       | New files added as their own isolated invocations — see §6                                                 |
| 3.3B-CI-045       | PROCESS (commands only)      | —                                                                 | See §7 "Exact Commands"                                                                                    |
| 3.3B-CI-046       | PROCESS (commands only)      | —                                                                 | `bun run validate` (expected to fail overall until implementation lands — see §8)                          |
| 3.3B-CI-047       | PROCESS (review checklist)   | —                                                                 | File-scope review — see §8                                                                                 |

### Reviewer-Evidence Disposition (RC-01..RC-27)

Every RC is covered by the scenario(s) the test-design document already maps it to (see that document's "Reviewer-Evidence Disposition" table) — those scenario IDs are all accounted for above. No RC required a scenario outside the P0/P1 tables.

### Waivers Carried Forward (from test-design, unchanged — this workflow does not resolve them)

| ID         | Reason                                                                     | Owner                         | Residual risk                                      | Follow-up trigger                                                    |
| ---------- | -------------------------------------------------------------------------- | ----------------------------- | -------------------------------------------------- | -------------------------------------------------------------------- |
| W-3.3B-001 | `--detach --json` stays out of scope (no real run id at ack time)          | CLI owner + product owner     | Detach JSON stays legacy                           | Future story makes detach/async start envelope-shaped                |
| W-3.3B-002 | No byte-for-byte `phase`/`projectBindingRef` parity (Hermes/BMAD concepts) | Contract owner                | Runtime omits illustrative fixture fields          | Contract makes them required, or Archon owns phase/binding semantics |
| W-3.3B-003 | True non-blocking start is out of scope                                    | Product + architecture owners | Hermes may need a follow-up async-start story      | Consumer requires immediate start ack                                |
| W-3.3B-004 | Top-level `bindingRef` not applicable to plain workflow runs               | Product + contract owners     | AC wording satisfied only "when applicable"        | Workflow command becomes binding-aware                               |
| W-3.3B-005 | HTTP/Web UI/events/delivery/Hermes ingestion excluded                      | Architecture owner            | No full producer-consumer integration here         | Accepted story activates one of those surfaces                       |
| W-3.3B-006 | No OS-level kill/abort final-envelope guarantee                            | CLI architecture owner        | Externally killed process may not emit final JSON  | Runtime timeout/abort contract accepted                              |
| W-3.3B-007 | No app-level auth policy for local CLI                                     | Security owner                | Local users with CLI/DB access can invoke commands | Remote/multi-user/service-account policy introduced                  |
| W-3.3B-008 | Out-of-order event ingestion N/A (only stored-event projection in scope)   | Workflow event owner          | Event ordering/idempotency defects undetected here | Story 3.5/3.7 activates event delivery/receipt                       |
| W-3.3B-009 | No performance/load threshold exists                                       | Product/operations owner      | Slow command paths have no numeric SLO             | Latency SLO, remote exposure, or perf incident accepted              |

## 3. Generated Files

| File                                                          | Kind                                                       | New/Modified                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/cli/src/commands/workflow.test.ts`                  | Command unit tests (executable red + skipped scaffolds)    | Modified — added `workflowRunCommand — JSON envelope (Story 3.3b)` block (14 tests), rewrote `workflowGetCommand`'s JSON-mode tests to assert the new envelope shape (10 tests, 2 human-mode tests left untouched), added two skipped describe blocks for the not-yet-implemented state-mapping and `classifyRunError` helpers (9 `it.skip()`) |
| `packages/cli/src/adapters/cli-adapter.test.ts`               | Adapter unit tests (executable red)                        | Modified — added `silent mode (Story 3.3b — not yet implemented)` block (3 tests: 2 red, 1 green regression check)                                                                                                                                                                                                                             |
| `packages/cli/src/commands/workflow-json.e2e.test.ts`         | CLI subprocess E2E (executable red)                        | **New** — real `Bun.spawn` against `cli.ts`, mirrors `provider-binding.e2e.test.ts`'s harness (6 tests)                                                                                                                                                                                                                                        |
| `packages/cli/src/commands/workflow-command-contract.test.ts` | Contract/static tests (mixed red + green regression gates) | **New** — mirrors `provider-binding-contract.test.ts`'s pattern (9 tests: 3 red, 6 green-as-regression-lock)                                                                                                                                                                                                                                   |
| `packages/cli/package.json`                                   | Test harness wiring                                        | Modified — `test` script gains `&& bun test src/commands/workflow-json.e2e.test.ts && bun test src/commands/workflow-command-contract.test.ts` as two new isolated invocations (both files declare independent `mock.module()`/no-mock setups, so neither shares an invocation with `workflow.test.ts`)                                        |

**Verified counts (via `bun test <file>`, run individually to avoid `&&` short-circuiting):**

| File                                |                                                                          Pass | Fail (genuinely red) |          Skip | Todo (pre-existing) |
| ----------------------------------- | ----------------------------------------------------------------------------: | -------------------: | ------------: | ------------------: |
| `workflow.test.ts`                  | 130 (was 134 pre-story; 4 legacy JSON tests were replaced, not just added to) |                   24 |             9 |                   6 |
| `cli-adapter.test.ts`               |                                                         21 (was 20 pre-story) |                    2 |             0 |                   0 |
| `workflow-json.e2e.test.ts`         |                                                                             0 |                    6 |             0 |                   0 |
| `workflow-command-contract.test.ts` |                                                                             6 |                    3 |             0 |                   0 |
| **Total new/changed scenarios**     |                                                                             — | **35 genuinely red** | **9 skipped** |                   — |

No pre-existing test in any of these four files (or in `isolation.test.ts`, `chat.test.ts`, `serve.test.ts`, `ai.test.ts`, `v2-workflow-discovery.e2e.test.ts`, `provider-binding.test.ts`, `provider-binding.e2e.test.ts`, `provider-binding-contract.test.ts`, `workflow-provider-command-envelope.test.ts`) regressed — each was re-run individually after the edits and matches its pre-story pass/fail count exactly.

## 4. Skipped Scaffolds — Reason and Activation Path

All 9 skips live in `packages/cli/src/commands/workflow.test.ts`, in two `describe()` blocks placed directly after `workflowGetCommand`'s tests:

- `describe('workflow.ts run-state → contract-state mapping helper (Story 3.3b Task 3 — not yet implemented)', ...)` — 7 tests: 3.3B-UNIT-002, 003, 004, 005, 006, 007, 030.
- `describe('workflow.ts classifyRunError helper (Story 3.3b Task 1 — not yet implemented)', ...)` — 2 tests: 3.3B-UNIT-017, 029.

**Why skipped, not executable:** Story 3.3b's Task 3 (state-mapping helper) is explicitly "no prior art" new design work, and Task 1's `classifyRunError` has no established export name yet. A static `import { <guessedName> } from './workflow'` for a not-yet-existing named export throws a module-linking `SyntaxError` at file load — verified empirically — which would crash **every other test in `workflow.test.ts`**, not just the new one. A dynamic `import()` probe would only avoid the crash by trading it for a coin-flip on the implementer's eventual naming, which is not a meaningful contract check. Per this skill's rule ("`it.skip()`/`test.skip()` only when the target module, route, harness, or dependency seam does not exist yet"), these are genuine skip candidates.

**What makes them non-placeholder:** each skipped test's body is commented with the exact expected input → output pairs, taken verbatim from the story's Dev Notes "State Mapping" table and the `classifyError`/`classifyRunError` classification table (mirroring `provider-binding.ts`'s `classifyError`). Nothing is a TODO stub — a developer can read the skip body and know precisely what to assert.

**Activation path:** once Task 1/Task 3 land and export the mapping/classification helper(s) from `packages/cli/src/commands/workflow.ts`, replace each `it.skip(...)` with `it(...)`, add a real `const { <exportedName> } = await import('./workflow');` (or a static import if the whole file's mocks tolerate it), and fill in the assertion bodies from the documented expected values already in the comments.

## 5. Existing Regression Coverage (no new tests needed)

- **3.3B-REG-041 (non-JSON regression):** dozens of pre-existing tests in `workflow.test.ts`'s `workflowRunCommand` and `workflowGetCommand` describe blocks already assert byte-for-byte human-mode output (e.g. `'should include available workflows in error when workflow not found'`, `'prints run detail (human) including the error from metadata'`). These were left untouched and still pass — they are this story's regression lock for "non-JSON behavior must stay byte-for-byte compatible."
- **3.3B-REG-042 (detach ack regression):** `describe('workflowRunCommand — detach', ...)` (pre-existing, untouched) already asserts the `{ ok: true, action: 'run', detached: true, ... }` ack shape. Still green.
- **3.3B-REG-043 (provider-binding regression):** `provider-binding.test.ts` (33 tests) and `provider-binding.e2e.test.ts` (11 tests, 3 executable + 8 pre-existing skips from Story 3.1) were re-run and are unaffected by this story's changes.

## 6. CI/Isolation Notes (3.3B-CI-044)

- `workflow-json.e2e.test.ts` uses only `Bun.spawn` — no `mock.module()` at all — so it cannot pollute or be polluted by any other file.
- `workflow-command-contract.test.ts` declares its own full `mock.module()` set (mirroring `workflow.test.ts`'s, but independently) because it needs to invoke `workflowRunCommand`/`workflowGetCommand` for the forbidden-key scan and fixture-delta checks. Per the project's mock-isolation rule, it is wired as its own isolated `bun test` invocation rather than sharing `workflow.test.ts`'s.
- Inside `workflow.test.ts` itself, the new `workflowRunCommand — JSON envelope` block reuses the file's existing top-level mocks and adds a defensive `afterEach` that resets `workflowDb.getWorkflowRun` back to its file-wide default. This was **required**, not optional: `workflowRunCommand` does not call `getWorkflowRun` at all in today's production code, so every `.mockResolvedValueOnce()`/`.mockRejectedValueOnce()` queued against it in the new block would otherwise leak forward unconsumed into `workflowGetCommand`, `workflowResumeCommand`, `workflowApproveCommand`, etc. — this was caught empirically (61 unrelated failures) and fixed before finalizing (verified back down to 0 unrelated failures).

## 7. Exact Commands To Run The Generated Tests

Run each file individually (never root `bun test`; this repo's package script chains files with `&&`, so a red file stops the chain early by design):

```bash
# Command-level unit tests (14 + 10 red, 9 skipped, plus untouched pre-existing tests)
bun test packages/cli/src/commands/workflow.test.ts

# CLIAdapter silent-mode tests (2 red, 1 green)
bun test packages/cli/src/adapters/cli-adapter.test.ts

# Real-subprocess CLI dispatch tests (6 red)
bun test packages/cli/src/commands/workflow-json.e2e.test.ts

# Contract/static tests (3 red, 6 green regression gates)
bun test packages/cli/src/commands/workflow-command-contract.test.ts

# Type-check (passes today — the scaffolds were written to type-check cleanly
# against the CURRENT interfaces, using local structural-superset types
# instead of `@ts-expect-error`, so no suppression comments need removal later)
bun --filter @archon/cli type-check

# Lint / format (both clean today)
bun run lint
bun run format:check

# Full package suite (will STOP at workflow.test.ts's genuinely-red tests —
# this is expected and correct for the red phase; do not "fix" this by
# skipping tests to force a green chain)
cd packages/cli && bun run test

# Canonical contract validator (already passing — locked as a regression gate)
python3 _bmad-output/planning-artifacts/contracts/workflow-commander/validate_contracts.py
```

## 8. What "Done" Looks Like For dev-story

`bun run validate` at the repo root is **expected to fail** right now (the `workflow.test.ts` step in `packages/cli`'s `test` script will report the 24 genuinely-red assertions) — this is the correct red-phase state, not a defect in this scaffold. `dev-story` should:

1. Implement Task 1-3 in `packages/cli/src/commands/workflow.ts` (envelope building, `classifyRunError`, the state-mapping helper, `--correlation-id` wiring) and `cli.ts` (dispatch return-code propagation, prevalidation conditionalization).
2. Add `CLIAdapterOptions.silent?: boolean` to `packages/cli/src/adapters/cli-adapter.ts` and use it in `workflowRunCommand`'s JSON path.
3. Un-skip the 9 `it.skip()` scaffolds once the helper(s) they target are exported, importing them for real.
4. Re-run every command in §7 — all should go green (the two green-regression-gate tests in `workflow-command-contract.test.ts` should stay green throughout).
5. Run `bun run validate` at the repo root — must pass in full before moving the story to review.

## 9. Key Risks / Assumptions Carried Into Implementation

- **RC-06 / UNIT-014/027:** `CLIAdapterOptions.silent` is this scaffold's own naming choice (the story only specifies the requirement, not the exact field name — "preferably `CLIAdapterOptions.silent?: boolean`" per Dev Notes). If the implementer picks a different name, only the cast site in `cli-adapter.test.ts` needs a one-line update — the _behavior_ assertions do not change.
- **UNIT-002-007/017/029/030:** the state-mapping and `classifyRunError` helpers are unnamed in the story (Task 3: "no prior art"). The skip comments document expected _behavior_, not an expected _export name_ — the implementer's naming choice does not block activation, only requires updating the `await import(...)` call once un-skipped.
- **W-3.3B-002 is load-bearing for CONTRACT-037:** that scenario actively asserts `phase`/`projectBindingRef` are **absent** from the real envelope — if a future contract change makes either field required, this test must be updated in lockstep with the contract, not silently weakened.
- Blocking-start semantics (W-3.3B-003) are asserted as a hard requirement in UNIT-013, not left ambiguous — if product/architecture later accepts an async-start story, that test's expectations will need to change together with the new design, not be quietly dropped.

## Next Recommended Workflow

`dev-story` (implement Tasks 1-5 against these red tests). Run `*automate` for broader coverage only after implementation exists and these scaffolds are green. Run `nfr-assess` after implementation evidence exists (per the test-design document's own "Follow-On Workflows").
