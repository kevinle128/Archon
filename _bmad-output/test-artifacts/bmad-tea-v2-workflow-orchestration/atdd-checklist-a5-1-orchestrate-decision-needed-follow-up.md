---
stepsCompleted:
  - 'step-01-preflight-and-context'
  - 'step-02-generation-mode'
  - 'step-03-test-strategy'
  - 'step-04-generate-tests'
  - 'step-05-validate-and-complete'
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-07-09'
workflowType: 'testarch-atdd'
storyId: '5.1'
storyKey: 'a5-1-orchestrate-decision-needed-follow-up'
storyFile: '_bmad-output/implementation-artifacts/a5-1-orchestrate-decision-needed-follow-up.md'
atddChecklistPath: '_bmad-output/test-artifacts/bmad-tea-v2-workflow-orchestration/atdd-checklist-a5-1-orchestrate-decision-needed-follow-up.md'
generatedTestFiles:
  - 'packages/workflows/src/defaults/v2-decision-needed-contract.test.ts'
  - 'packages/workflows/src/defaults/v2-decision-needed-dag.test.ts'
inputDocuments:
  - '_bmad-output/implementation-artifacts/a5-1-orchestrate-decision-needed-follow-up.md'
  - '_bmad-output/test-artifacts/bmad-tea-v2-workflow-orchestration/test-design/test-design-a5-1-orchestrate-decision-needed-follow-up.md'
  - '_bmad-output/project-context.md'
  - '_bmad/tea/config.yaml'
  - '.archon/workflows/defaults/bmad-dev-story-with-tea-fix-loop-v2.yml'
  - 'packages/workflows/src/defaults/v2-quality-route-loop-contract.test.ts'
  - 'packages/workflows/src/defaults/v2-quality-route-loop-dag.test.ts'
  - 'packages/workflows/package.json'
---

# ATDD Checklist - Epic 5, Story 5.1: Orchestrate Decision Needed Follow-Up

**Date:** 2026-07-09
**Author:** kevin
**Primary Test Level:** Backend workflow-engine (Bun structural contract + isolated real-executor DAG). Browser UI E2E: N/A (waived, W-007).

---

## Story Summary

Insert a fail-closed `decision-needed-check` bash node at the quality route loop's PASS seam (between `quality-route-loop` and `create-pull-request`).
It passes forward cleanly when `decision_needed_count == 0`, and blocks PR (non-zero exit) when unresolved decision-needed items exist but cannot be tracked, so deferred human-judgment work is never silently dropped or misrepresented as fixed.

**As an** Archon workflow maintainer
**I want** a `decision-needed-check` node that consumes the quality summary, passes forward when there are no deferred items, and fails closed (blocking PR) when unresolved `decision_needed` findings exist but cannot be tracked
**So that** the workflow only reaches PR handoff once decision-needed follow-up is either absent or verifiably tracked.

---

## Acceptance Criteria

Buildable-now ACs (#1–#4, #7) are fully implementable and testable in this repository today.
Deferred ACs (#5, #6) are the epic's live-integration criteria; they are BLOCKED on cross-project BMAD-METHOD dependencies plus a Linear integration, and are recorded for traceability only.

1. **(Wiring)** `decision-needed-check` is inserted at the route loop's PASS seam: `quality-route-loop.routes.positive` becomes `decision-needed-check`, `create-pull-request.depends_on` becomes `[decision-needed-check]`, and `parseWorkflow` still passes with the single unchanged `route_loop`.
2. **(No-op pass-forward)** `decision_needed_count == 0` emits a `status: "PASS"` contract with `deferred: false` and zeroed counts, exits zero, and `create-pull-request` runs.
3. **(Contract envelope + story identity)** The contract carries the full route-facing envelope (`contract_version`, `workflow`, `node`, `story_ref`, `status`, echoed `decision_needed_count`, count/`deferred` fields), is best-effort persisted, and fails closed on a mismatched/empty envelope or `story_ref`.
4. **(Fail-closed when items exist but cannot be tracked)** `decision_needed_count > 0` with no tracking capability fails the node closed (non-zero exit, clear diagnostic, no contract), so PR preparation does not run — no new routing branch or `route_loop` added.
5. **(DEFERRED — blocked)** Live Linear create/reuse per finding + cross-project sync, recording `created`/`reused`/`synced` counts and `deferred: true`. Not implemented (inputs absent).
6. **(DEFERRED — blocked)** Real sync returning ERROR blocks PR. The "unavailable capability" half is implemented today (AC #4); the "real sync ERROR" half is deferred.
7. **(Bundle parity + baseline untouched)** Source and generated bundle stay consistent (`bun run check:bundled`), and the v1 baseline is byte-for-byte unchanged.

---

## Story Integration Metadata

- **Story ID:** `5.1`
- **Story Key:** `a5-1-orchestrate-decision-needed-follow-up`
- **Story File:** `_bmad-output/implementation-artifacts/a5-1-orchestrate-decision-needed-follow-up.md`
- **Checklist Path:** `_bmad-output/test-artifacts/bmad-tea-v2-workflow-orchestration/atdd-checklist-a5-1-orchestrate-decision-needed-follow-up.md`
- **Generated Test Files:**
  - `packages/workflows/src/defaults/v2-decision-needed-contract.test.ts` (non-mock structural + technique proofs)
  - `packages/workflows/src/defaults/v2-decision-needed-dag.test.ts` (isolated `mock.module` real-executor DAG)

The generated test paths are recorded here for `dev-story` handoff. Mirror them into the story `Dev Notes` when a writable story file is available.

---

## Generated Files

| File                                                                  | Kind                                        | Notes                                                                                        |
| --------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `packages/workflows/src/defaults/v2-decision-needed-contract.test.ts` | NEW — red-phase contract/technique scaffold | No `mock.module`; safe to co-locate in the shared non-mock batch. 50 tests.                  |
| `packages/workflows/src/defaults/v2-decision-needed-dag.test.ts`      | NEW — red-phase DAG scaffold                | Uses `mock.module('@archon/paths', …)`; MUST run as its OWN `bun test` invocation. 13 tests. |

No production code was written. No YAML, bundle, or `package.json` changes were made — those are the GREEN-phase implementation steps.

---

## Red-Phase Design Rationale

Per ATDD rules: `test.skip()` is used ONLY where a seam does not exist yet; executable red tests are preferred wherever the boundary already exists.

- The **boundaries already exist** — `parseWorkflow`, `BUNDLED_WORKFLOWS`, the real `executeDagWorkflow`, and real `bash`/`bun -e` execution. So the bulk of coverage is **executable red tests** that fail cleanly because the `decision-needed-check` node is absent.
- **Technique proofs** run the exact validate-and-emit pipeline the node must adopt against crafted summaries. They pass now (proving the chosen technique is sound) and are each PAIRED with a static red assertion that the node body adopts that pipeline — a green technique proof is not node coverage on its own. Labelled in-file.
- **Skipped scaffolds** are used only for (a) cross-project deferred criteria whose inputs do not exist (TD-315, TD-316) and (b) the mid-DAG malformed-summary injection (TD-306/TD-307 mid-DAG half), because the real `quality-gate-summary` never _completes_ with a malformed envelope — there is no fault-injection seam. The executable half of that coverage lives in the contract technique proofs.
- One deliberate hardening: the count validator requires a genuine `typeof === "number"` non-negative integer (not a bare `Number()` coercion), so a `null`/`false`/`""` count fails closed instead of silently reading as `0`. This is the safer contract TD-308 (P0, malformed → fail closed) demands; the GREEN node must adopt the type check, not just `Number()`.

---

## Test Scenario Traceability (every P0/P1 → executable red / skipped scaffold / waiver)

Status legend: **RED-exec** = executable, currently failing (drives implementation) · **GREEN-guard** = executable, passing now and must stay green (regression/precondition) · **TECH-proof** = executable technique proof (green) paired with a red static · **SKIP** = red-phase skipped scaffold · **WAIVER** = deferred with owner.

| TD     | Pri | Disposition                         | Location                                                                               | Notes                                                                                                                                               |
| ------ | --- | ----------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| TD-300 | P0  | GREEN-guard                         | contract: _Baseline precondition_                                                      | Prior quality tail present; no Linear/sync in repo. Guards against stale-baseline + fabricated live work.                                           |
| TD-301 | P1  | RED-exec                            | contract: _Node shape_                                                                 | bash node, `timeout: 60000`, `output_type: decision-needed-check`, deps `[quality-route-loop, quality-gate-summary, resolve-story-input]`.          |
| TD-302 | P0  | RED-exec                            | contract: _Seam wiring_                                                                | `positive → decision-needed-check`; `create-pull-request.depends_on == [decision-needed-check]`; negative/exhausted/from unchanged; one route_loop. |
| TD-303 | P0  | RED-exec                            | contract: _Reader safety_                                                              | whole-output `$quality-gate-summary.output`, `DNC_SUMMARY`/`DNC_RESOLVED`, `bun -e`+`JSON.parse`, no field-ref/grep/case/prose.                     |
| TD-304 | P1  | RED-exec + TECH-proof               | contract: _Success contract shape_ (static) + _Success emission_ (technique)           | Full envelope, `status:"PASS"`, never `gate`.                                                                                                       |
| TD-305 | P1  | RED-exec                            | dag: _No-op success_                                                                   | count==0 → node completes → PR reached; dev-story once; no error node.                                                                              |
| TD-306 | P0  | TECH-proof + SKIP                   | contract: _Envelope fail-closed_ (technique) + dag: _Reader mid-DAG rejection_ (skip)  | Wrong `contract_version`/`workflow`/`node`/`story_ref` fail closed, no contract. Mid-DAG skip: no fault-injection seam.                             |
| TD-307 | P0  | TECH-proof + SKIP                   | contract: _Malformed fail-closed_ (technique) + dag: _Reader mid-DAG rejection_ (skip) | Empty / non-JSON / truncated summary fail closed. Mid-DAG skip: no seam.                                                                            |
| TD-308 | P0  | TECH-proof + RED-exec               | contract: _Count boundary_ (technique) + dag: _Count boundary end-to-end_              | Technique: 0 passes; missing/negative/fractional/non-numeric + positive fail closed. DAG: integer 0 vs 2 via CONCERNS gates.                        |
| TD-309 | P0  | TECH-proof + RED-exec               | contract: _Fail-closed diagnostic_ (technique) + dag: _Fail-closed_                    | Technique proves the diagnostic text (`/Linear\|sync\|fail closed\|unavailable/`); DAG proves node-failed + no-PR (harness discards node stderr).   |
| TD-310 | P1  | RED-exec                            | contract: _No new routing_ (static)                                                    | No second route_loop, no `when:` bypass, no dev-story reroute, no bespoke error node.                                                               |
| TD-311 | P0  | TECH-proof + RED-exec               | contract: _No partial contract_ (technique) + dag: _No partial artifact_               | No stdout contract on any error path; no `decision-needed.json` on the fail-closed path.                                                            |
| TD-312 | P1  | RED-exec + command                  | contract: _Bundle parity_ + `bun run check:bundled`                                    | Source/bundle match + embed node; v1 byte-for-byte unchanged.                                                                                       |
| TD-313 | P1  | RED-exec (expected-red until wired) | contract: _Test registration_                                                          | Contract in a non-mock batch segment; DAG as its OWN bun invocation. Fails until `package.json` is updated (GREEN step).                            |
| TD-314 | P0  | GREEN-guard                         | contract: _No speculative live integration_                                            | No Linear/fetch/GraphQL/MCP/`LINEAR_API_KEY` in the node or v2 file. Passes via absence today; becomes a meaningful guard once the node exists.     |
| TD-315 | P1  | SKIP + WAIVER (W-001)               | contract: _Deferred live create/reuse + sync shape_                                    | Documents the future per-finding create/reuse + sync contract shape so it is not lost.                                                              |
| TD-316 | P1  | SKIP + WAIVER (W-002)               | contract: _Deferred real sync ERROR path_                                              | Real sync-returning-ERROR not counted as covered by today's unavailable-capability path.                                                            |
| TD-317 | P1  | RED-exec                            | dag: _Artifact isolation + overwrite_                                                  | Two runs → distinct dirs, independent artifacts; a pinned duplicate no-op overwrites to exactly one JSON object.                                    |
| TD-318 | P1  | GREEN-guard                         | dag: _Partial failure_                                                                 | Failed CR / role ERROR → summary never completes → node never runs → no PR. Must hold now and after insertion.                                      |
| TD-319 | P1  | RED-exec                            | contract: _Timeout guard_                                                              | Bounded positive timeout + no unbounded external work.                                                                                              |
| TD-320 | P1  | REVIEW-gated + WAIVER (W-004)       | review checklist (below)                                                               | No credential/auth/adapter/permission change. Security half covered structurally by TD-314.                                                         |
| TD-321 | P3  | GREEN-guard                         | contract: _Naming conventions_                                                         | Kebab-case ids; neither test file embeds plan/story/epic/finding identifiers (TD-nnn / AC# only).                                                   |
| TD-322 | P0  | GREEN-guard                         | dag: _Route-loop regression_                                                           | FAIL-then-PASS, ERROR-not-rerouted, exhaustion still hold after the positive retarget.                                                              |
| TD-323 | P1  | REVIEW-gated + WAIVER (W-005)       | review checklist (below)                                                               | Dev Agent Record must state fail-closed-only blocks PR until live deps land.                                                                        |
| TD-324 | P1  | RED-exec                            | dag: _Success artifact_                                                                | Persisted `decision-needed.json` carries `status:"PASS"` and `story_ref == resolved key`.                                                           |
| TD-325 | P3  | REVIEW-gated                        | review checklist (below)                                                               | File scope limited to v2 YAML, generated bundle, two tests, `package.json`.                                                                         |
| TD-326 | P2  | WAIVER (W-006)                      | waivers (below)                                                                        | Deferred load/scalability — no live network path built.                                                                                             |

**Coverage tally:** P0 = 10/10 represented (TD-300, 302, 303, 306, 307, 308, 309, 311, 314, 322). P1 = 14/14 represented. P2/P3 = 3/3 represented. No P0/P1 counted as covered by implication.

---

## Skipped Scaffolds and Expected Reasons

| Scaffold                                                                                                   | File     | Why skipped                                                                                                                                                                                                                                                                                                                           | What activates it                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `TD-315 … creates or reuses one issue per finding and emits deferred:true after sync success`              | contract | The per-finding decision-needed source contract, the cross-project sync request/response contract, and a Linear integration do NOT exist in this repository; building them would fabricate cross-project contracts (forbidden).                                                                                                       | When the per-finding contract, the sync contract, and an explicit default-off capability marker all exist inside the allowed project boundary. |
| `TD-316 … a real sync call that returns ERROR fails the node closed and blocks PR`                         | contract | Today's node never performs a real sync call — it fails closed because the capability is unavailable (proven by TD-309). The real-call ERROR path cannot be exercised until the sync contract exists.                                                                                                                                 | When the sync request/response contract lands.                                                                                                 |
| `TD-306/TD-307 … a malformed summary that still completes makes decision-needed-check fail closed mid-DAG` | dag      | The only upstream source is the real `quality-gate-summary`, which emits a well-formed envelope with an integer count or hard-fails — it never _completes_ with malformed output, so the node's defense-in-depth rejection cannot be driven mid-DAG. The executable half is proven in the contract technique proofs (TD-306/307/308). | Only if a fault-injection seam is added (a stub summary node able to complete with arbitrary stdout).                                          |

All three are `it.skip(...)` with the reason and activation guidance inline in the test file.

---

## Waivers (owner + residual risk + follow-up trigger)

| Waiver | Subject                                             | Owner                                   | Residual Risk                                                                                        | Follow-Up Trigger                                                                                                                                        |
| ------ | --------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W-001  | Live Linear create/reuse success path (AC #5)       | Workflow maintainer + BMAD-METHOD owner | Deferred findings cannot be tracked automatically in this repo state; fail-closed blocks PR instead. | Reopen when the per-finding contract, the sync contract, and an explicit default-off Linear capability marker exist inside the allowed project boundary. |
| W-002  | Real sync returning ERROR after a live call (AC #6) | BMAD-METHOD owner                       | A future sync implementation could mishandle provider errors if not reopened.                        | Reopen when the sync request/response schema is defined or any sync command/skill is added.                                                              |
| W-003  | Executor cancellation / lifecycle behavior          | Workflow maintainer                     | Cancellation during a decision-needed artifact write is not newly exercised.                         | Reopen if the diff touches executor cancellation, pause, retry, lifecycle ownership, or node-state mutation.                                             |
| W-004  | Credential / auth / permission behavior (TD-320)    | Security/platform owner                 | A stray change could introduce untested credential exposure or authorization behavior.               | Reopen if the diff touches credentials, adapters, server auth, provider key delivery, MCP credential config, or permission checks.                       |
| W-005  | Proof-run decision-needed items (TD-323)            | Workflow maintainer                     | The downstream proof leg remains blocked or must use a no-decision-needed fixture.                   | Reopen before the proof run if the operator expects unresolved decision-needed findings.                                                                 |
| W-006  | Load / scalability testing (TD-326)                 | Workflow maintainer                     | Future live Linear sync might add latency/retry/rate-limit behavior without perf coverage.           | Reopen if live Linear, MCP, fetch, retry, queue, scheduler, or shared-state behavior is implemented.                                                     |
| W-007  | Browser UI E2E                                      | Test architect                          | A future console view could misrepresent decision-needed state without UI tests.                     | Reopen if a web/console UI renders decision-needed-check status, artifacts, or follow-up links.                                                          |

**First-party consumer surface:** the isolated real-executor DAG test (`v2-decision-needed-dag.test.ts`) IS the first-party consumer surface for this backend workflow-engine story — it drives the real executor + real bash through the v2 DAG. There is no browser/HTTP/user client surface, so browser E2E is waived (W-007), satisfying the "first-party consumer E2E generated or explicitly waived" requirement.

---

## Reviewer Concern Coverage

All 33 reviewer concerns (C-001…C-033) from the test-design Reviewer Concern Register are represented via the TD mapping above. Condensed:

- **Cross-project absence (C-001, C-002, C-003, C-004, C-005, C-022):** TD-300 + TD-314 (executable guards) and W-001/W-002 (deferred).
- **Seam + baseline (C-006, C-007, C-008):** TD-302, TD-322.
- **Node deps + JSON-only parsing (C-009, C-010, C-011, C-012, C-013):** TD-301, TD-303, TD-306.
- **Count validity + no-op success (C-014, C-015, C-016, C-017):** TD-308, TD-304, TD-305, TD-324 (`status`, not `gate`).
- **Fail-closed structure (C-018, C-019, C-020):** TD-309, TD-310.
- **Speculative live path (C-021):** W-001 (default-off gate required before any live work).
- **Bundle/isolation/naming/scope (C-024, C-025, C-026, C-027):** TD-312, TD-313, TD-321, TD-325.
- **Partial failure + duplicate runs (C-031, C-032):** TD-318, TD-317.
- **Timeout (C-033):** TD-319.
- **Explicit non-risks (C-017 → NR-002, C-028 → NR-003, C-023/C-029/C-030 → waivers):** carried as `status`-not-`gate` assertion, W-007, and W-003/W-004/W-005.

---

## Acceptance Criteria → Coverage

| AC                                                               | Coverage                                                       | Status                         |
| ---------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------ |
| AC1 (wiring, one route loop)                                     | TD-300, TD-301, TD-302, TD-312, TD-322                         | Covered (RED-exec)             |
| AC2 (no-op pass-forward reaches PR)                              | TD-304, TD-305, TD-317, TD-324                                 | Covered (RED-exec)             |
| AC3 (envelope, story identity, artifact, fail-closed validation) | TD-303, TD-304, TD-305, TD-306, TD-307, TD-308, TD-311, TD-324 | Covered (RED-exec + technique) |
| AC4 (count>0 fails closed, blocks PR, no new routing)            | TD-309, TD-310, TD-311, TD-318, TD-323                         | Covered (RED-exec)             |
| AC5 (live create/reuse + sync)                                   | W-001 + TD-315                                                 | Waived as deferred             |
| AC6 (real sync ERROR blocks PR)                                  | TD-309 (unavailable half) + W-002 + TD-316 (real-call half)    | Partial + waiver               |
| AC7 (bundle parity, v1 untouched)                                | TD-312, TD-313, TD-321, TD-325                                 | Covered (RED-exec)             |

---

## Review-Gated Checklist Items (not automatable in red phase)

These are represented as reviewer-verified items during the GREEN/review phase (owner assigned via waivers where applicable):

- [ ] **TD-320 / W-004:** the diff touches no credential, auth, adapter, provider-key-delivery, MCP-credential, or permission code. (Structural security half auto-covered by TD-314.)
- [ ] **TD-323 / W-005:** the Dev Agent Record / completion notes state plainly that the node ships fail-closed-only and blocks PR when decision-needed items exist until the live dependencies land.
- [ ] **TD-325:** file scope limited to the v2 YAML, the generated bundle, the two decision-needed tests, and `packages/workflows/package.json`.

---

## GREEN-Phase Implementation Checklist

Make the RED-exec scaffolds pass by implementing the buildable-now + fail-closed layers (do NOT build the live Linear/sync path):

- [ ] Add the `decision-needed-check` bash node to `.archon/workflows/defaults/bmad-dev-story-with-tea-fix-loop-v2.yml` — JSON-only, `timeout: 60000`, `output_type: decision-needed-check`, `depends_on: [quality-route-loop, quality-gate-summary, resolve-story-input]`. → satisfies TD-301, TD-303, TD-319.
- [ ] Read the whole summary output + resolved ref UNQUOTED, export `DNC_SUMMARY`/`DNC_RESOLVED` into `bun -e`, validate the envelope + story identity + `decision_needed_count` (require a `typeof === "number"` non-negative integer) BEFORE any stdout. → satisfies TD-303, TD-306, TD-307, TD-308, TD-311.
- [ ] `decision_needed_count == 0` → emit the full `status:"PASS"` contract (never a `gate` field), exit 0, best-effort write `$ARTIFACTS_DIR/bmad-dev-story-with-tea-fix-loop/decision-needed.json`. → satisfies TD-304, TD-305, TD-317, TD-324.
- [ ] `decision_needed_count > 0` → `echo "ERROR: … Linear follow-up + BMAD-METHOD sync … unavailable. Blocking PR (fail closed)." >&2; exit 1` (no route branch, no dev-story reroute). → satisfies TD-309, TD-310, TD-311.
- [ ] Retarget `quality-route-loop.routes.positive → decision-needed-check` and `create-pull-request.depends_on → [decision-needed-check]`; touch nothing else. → satisfies TD-302, TD-322.
- [ ] `bun run generate:bundled` then `bun run check:bundled`; keep v1 byte-for-byte unchanged. → satisfies TD-312.
- [ ] Register `v2-decision-needed-contract.test.ts` in the non-mock workflow-defaults batch and `v2-decision-needed-dag.test.ts` as its OWN `bun test` segment in `packages/workflows/package.json`. → satisfies TD-313.
- [ ] Do NOT introduce any Linear client/`fetch`/GraphQL/MCP/`LINEAR_API_KEY` gate. → keeps TD-314 green.

---

## Running Tests

```bash
# From the repo root: install workspace deps once (links @archon/* packages).
bun install

# --- Direct file invocation (red-phase; the tests are not yet registered) ---
# Contract / technique scaffolds (no mock.module — safe standalone):
cd packages/workflows && bun test src/defaults/v2-decision-needed-contract.test.ts

# DAG scaffolds (mock.module — MUST run as its own isolated invocation):
cd packages/workflows && bun test src/defaults/v2-decision-needed-dag.test.ts

# Prior route-loop regression templates (must stay green through implementation):
cd packages/workflows && bun test src/defaults/v2-quality-route-loop-contract.test.ts
cd packages/workflows && bun test src/defaults/v2-quality-route-loop-dag.test.ts

# --- After GREEN implementation ---
bun run check:bundled     # source/bundle parity (TD-312)
bun run validate          # full pre-PR gate (type-check, lint, format, package-isolated tests)
```

> Note: run from `packages/workflows` (or the repo root with `bun install` completed first) so the `@archon/*` workspace packages resolve. Do NOT run root `bun test` — it discovers all packages in one process and causes `mock.module()` pollution. The `packages/workflows` `test` script lists explicit files (no `src/defaults/*.test.ts` glob), so the unregistered `mock.module` DAG file cannot be swept into another segment.

---

## Test Execution Evidence — RED Verification

**Command:** `bun test src/defaults/v2-decision-needed-contract.test.ts` (run from `packages/workflows`)

```
34 pass
 2 skip
14 fail
161 expect() calls
Ran 50 tests across 1 file.
```

- Passing: baseline precondition (TD-300), all technique proofs (TD-304/306/307/308/309/311), no-live-integration guard (TD-314), naming hygiene (TD-321).
- Skipped: TD-315, TD-316 (deferred-blocked scaffolds).
- Failing (RED-exec, expected): node-shape (TD-301), seam wiring (TD-302), reader safety (TD-303), success-contract static (TD-304), no-new-routing static (TD-310), timeout (TD-319), bundle parity (TD-312), registration (TD-313, expected-red until wired). Each fails cleanly because the `decision-needed-check` node is not yet in the YAML — not because of a test bug.

**Command:** `bun test src/defaults/v2-decision-needed-dag.test.ts` (run from `packages/workflows`)

```
 5 pass
 1 skip
 7 fail
 26 expect() calls
Ran 13 tests across 1 file.
```

- Passing (GREEN-guard): partial-failure guards (TD-318 ×2) and route-loop regression (TD-322 ×3) — these must stay green through implementation.
- Skipped: TD-306/307 mid-DAG malformed-injection scaffold (no fault-injection seam).
- Failing (RED-exec, expected): no-op success (TD-305), success artifact (TD-324), fail-closed count>0 (TD-309), count boundary (TD-308), no-partial-artifact (TD-311), artifact isolation + overwrite (TD-317 ×2). Sample failure messages: `the decision node must run and complete on a clean no-op PASS · Expected: "completed"`; `unresolved decision-needed items with no tracking capability must fail the node closed · Expected: "failed"`. All tie directly to the absent node.

**Gate checks on the scaffolds themselves:** `bun --filter '@archon/workflows' type-check` → exit 0. Lint: test files are excluded by the repo ESLint ignore config (same as the sibling route-loop tests), so they are not linted.

**Status:** ✅ Red-phase scaffolds verified — executable red where the boundary exists, skipped only where a seam is genuinely absent, technique proofs paired with red statics, and every P0/P1 scenario, reviewer concern, and acceptance criterion mapped to a test or an owned waiver.

---

## Notes

- The story's suggested node body used a bare `Number(s.decision_needed_count)`. The generated technique proof hardens this to a `typeof === "number"` non-negative-integer check so a `null`/`false`/`""` count fails closed (TD-308, P0) rather than silently reading as `0`. The GREEN node must adopt the type check.
- The count>0 fail-closed path is driven end-to-end without any fault injection: a role gate returning `CONCERNS` keeps `quality-gate-summary` at `gate:"PASS"` (only `FAIL` blocks) while raising `decision_needed_count`, so the loop routes positive into `decision-needed-check`, which then fails closed.
- The DAG harness (`createTrackedStore`) records only `event_type`/`step_name`, not node `stderr`, so the fail-closed **diagnostic text** is asserted in the contract technique proof, and the DAG file asserts only node-failed + no-PR. This split is intentional.
- Do NOT stand up a Linear client or invent the sync contract. AC #5/#6 are waived (W-001/W-002); the fail-closed layer is the honest, safe interim.

---

**Generated by BMad TEA Agent (Murat)** — 2026-07-09
