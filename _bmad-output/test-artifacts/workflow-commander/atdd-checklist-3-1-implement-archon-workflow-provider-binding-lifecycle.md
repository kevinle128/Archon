---
stepsCompleted:
  - 'step-01-preflight-and-context'
  - 'step-02-generation-mode'
  - 'step-03-test-strategy'
  - 'step-04-generate-tests'
  - 'step-04c-aggregate'
  - 'step-05-validate-and-complete'
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-07-13'
storyId: '3.1'
storyKey: '3-1-implement-archon-workflow-provider-binding-lifecycle'
storyFile: '_bmad-output/implementation-artifacts/3-1-implement-archon-workflow-provider-binding-lifecycle.md'
atddChecklistPath: '_bmad-output/test-artifacts/workflow-commander/atdd-checklist-3-1-implement-archon-workflow-provider-binding-lifecycle.md'
detectedStack: 'backend'
generationMode: 'ai-generation-sequential'
generatedTestFiles:
  - 'packages/core/src/schemas/workflow-provider-binding.test.ts'
  - 'packages/core/src/db/provider-bindings.test.ts'
  - 'packages/core/src/db/adapters/sqlite.test.ts'
  - 'packages/core/src/db/adapters/postgres.test.ts'
  - 'packages/core/src/db/provider-bindings-bundled-schema.test.ts'
  - 'packages/cli/src/commands/provider-binding.test.ts'
  - 'packages/cli/src/commands/provider-binding.e2e.test.ts'
  - 'packages/cli/src/commands/provider-binding-contract.test.ts'
inputDocuments:
  - '_bmad-output/implementation-artifacts/3-1-implement-archon-workflow-provider-binding-lifecycle.md'
  - '_bmad-output/test-artifacts/workflow-commander/test-design-epic-3.md'
  - '_bmad-output/project-context.md'
  - '_bmad/tea/config.yaml'
  - 'CLAUDE.md'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/schemas/workflow-command-envelope.schema.json'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/schemas/workflow-provider-binding.schema.json'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/commands/*.json'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/examples/providers/archon/bindings/*.json'
  - '_bmad-output/planning-artifacts/contracts/workflow-commander/validate_contracts.py'
  - 'packages/core/src/db/user-provider-key-store.test.ts'
  - 'packages/core/src/db/env-vars.ts'
  - 'packages/core/src/schemas/env-var.ts'
  - 'packages/core/src/db/adapters/sqlite.ts'
  - 'packages/core/src/db/adapters/sqlite.test.ts'
  - 'packages/core/src/db/adapters/postgres.test.ts'
  - 'packages/core/src/db/workflows.ts'
  - 'packages/core/src/db/codebases.ts'
  - 'packages/core/src/schemas/codebase.ts'
  - 'packages/cli/src/cli.ts'
  - 'packages/cli/src/commands/workflow.ts'
  - 'packages/cli/src/commands/workflow.test.ts'
  - 'packages/cli/src/commands/v2-workflow-discovery.e2e.test.ts'
  - 'migrations/000_combined.sql'
  - 'packages/core/package.json'
  - 'packages/cli/package.json'
---

# ATDD Red-Phase Checklist: 3.1 Implement Archon Workflow Provider Binding Lifecycle

**Role:** Master Test Architect (TEA), Murat.
**Date:** 2026-07-13.
**Phase:** TDD RED — scaffolds only, no production code written.
**Stack detected:** backend (Bun + TypeScript CLI/DB; no browser E2E — the CLI subprocess IS the first-party consumer surface for this story).
**Framework:** `bun:test`, mirroring `user-provider-key-store.test.ts` (mocked `pool.query` DB layer), `sqlite.test.ts` (real temp-file `SqliteAdapter` integration), `postgres.test.ts` (mocked `pg.Pool` schema-transaction), and `workflow.test.ts` (CLI command unit tests with `mock.module('@archon/core/db/*', ...)`).

## Preflight Summary

Story 3.1 is the **first story in Epic 3** for this repo slice: no prior `provider-binding`/`workflow-provider-binding` code exists anywhere (verified via grep at story-creation time and again during this ATDD pass).
Every production file the story requires — the Zod row schema, the DB module, the CLI command file, the new table in both `migrations/000_combined.sql` and `sqlite.ts`'s `createSchema()`, and the new CLI flags/dispatch case in `cli.ts` — is genuinely absent today.

The TD source (`test-design-epic-3.md`) enumerates **69 atomic scenarios** (24 P0, 45 P1), 24 risks, 24 reviewer-concern dispositions, and 10 explicit waivers, all already carrying scenario-or-waiver traceability to the story's 5 acceptance criteria.
This ATDD pass does not re-derive that mapping — it converts it into generated test artifacts and confirms every scenario now has a concrete file:line home.

**Environment note:** this worktree had no `node_modules` installed when this pass began (`bun install` was run to enable verification — 2584 packages, no code changes). All scaffolds below were **actually executed** with `bun test` during generation, not just written; the pass/fail/skip counts quoted are real, not assumed.

## Generation Mode

AI generation, sequential — single-context deterministic scaffold generation for a backend DB/CLI/contract story. Recording mode (browser) is N/A; Playwright Utils / Pact.js Utils are not applicable (`tea_use_pactjs_utils: false`, no browser surface in this story).

## Test Strategy (levels)

- **Unit — DB layer (Bun, mocked `pool.query`):** `createBinding` / `updateBinding` / `rotateBinding` / `disableBinding` / `getBinding` SQL shape, bound params, and insert-only/update-only semantics. Mirrors `user-provider-key-store.test.ts`.
- **Unit — row schema (Bun, Zod):** snake_case row shape parses/rejects per `env-var.ts`'s pattern.
- **Unit — CLI layer (Bun, `mock.module('@archon/core/db/*', ...)`):** envelope construction, exact fixture equality, malformed-input fail-closed paths, project-ref resolution, metadata, security/compatibility scans, dependency-failure mapping. Mirrors `workflow.test.ts`.
- **DB integration (Bun, real temp-file `bun:sqlite` via `SqliteAdapter`):** fresh schema (FK, defaults, uniqueness, cascade), upgrade-from-existing-DB, idempotent re-init, and `Promise.all`-driven concurrency races. These import **no** application code and are genuinely executable today — they fail red with `no such table: remote_agent_workflow_provider_bindings` and go green the moment Task 1 lands the table.
- **DB integration (Bun, mocked `pg.Pool`, real on-disk `migrations/000_combined.sql` content):** proves the actual migration file (not a synthetic string) converges through the existing advisory-lock transaction mechanism.
- **CLI E2E (Bun, real `Bun.spawn` subprocess against the real `cli.ts`):** the first-party consumer surface — a controller invoking `archon provider-binding <verb> --json` as a subprocess. Uses a real harness (not a placeholder), skipped only because the `provider-binding` route doesn't exist in `cli.ts` yet.
- **Contract regression (Bun, no application-code import; some spawn `python3 validate_contracts.py`):** fixture-family structural checks and the canonical validator gate.
- **CI/static:** bundled-schema table-marker check (executable, real disk read); package-isolation is satisfied by construction (every new file sits on its own `bun test` invocation line — verified by actually running `bun run test` for both packages); secret-scan is an honest skip (target files don't exist yet — see Skipped Scaffolds below).

There is no API/UI/browser/Web E2E layer for this story (PRD explicitly forbids a state-changing HTTP path for v1; Dev Notes "Scope Boundary").

## Generated Files

| File                                                            | Level               | Status today                                                                   | Isolation (package.json)      |
| --------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------ | ----------------------------- |
| `packages/core/src/schemas/workflow-provider-binding.test.ts`   | Unit — row schema   | 0 pass / 3 skip                                                                | own line                      |
| `packages/core/src/db/provider-bindings.test.ts`                | Unit — DB layer     | 0 pass / 18 skip                                                               | own line                      |
| `packages/core/src/db/adapters/sqlite.test.ts` (appended)       | DB integration      | 13 pre-existing pass / **12 new fail (red)**                                   | already wired (existing line) |
| `packages/core/src/db/adapters/postgres.test.ts` (appended)     | DB integration      | 37 pre-existing pass / 3 pre-existing todo / **1 new fail (red)** / 1 new skip | already wired (existing line) |
| `packages/core/src/db/provider-bindings-bundled-schema.test.ts` | CI/static           | **2 new fail (red)**                                                           | own line                      |
| `packages/cli/src/commands/provider-binding.test.ts`            | Unit — CLI layer    | 0 pass / 30 skip                                                               | own line                      |
| `packages/cli/src/commands/provider-binding.e2e.test.ts`        | CLI E2E             | 0 pass / 8 skip                                                                | own line                      |
| `packages/cli/src/commands/provider-binding-contract.test.ts`   | Contract regression | 3 pass (already-passing gates) / 1 skip                                        | own line                      |
| `packages/core/package.json`                                    | test wiring         | edited — 3 new isolated lines appended                                         | —                             |
| `packages/cli/package.json`                                     | test wiring         | edited — 3 new isolated lines appended                                         | —                             |

Every file above was executed with `bun test <file>` individually during this pass, and both packages' full `bun run test` chains were run end-to-end to confirm wiring: the core chain now stops at the (expected, intentional) new red failure in `postgres.test.ts`; the CLI chain runs clean to completion (all new files are skip-only or already-passing there).

## Mandatory Mapping — every P0/P1 scenario, risk, and reviewer concern is represented

Legend: **exec-red** = executable test that fails today for the correct documented reason and will pass once the story is implemented; **exec-pass** = executable regression gate that already passes today (not new coverage, but this story must not break it); **skip** = `test.skip()` scaffold with a documented activation seam; **waiver** = carried forward from the TD verbatim (owner/residual risk/trigger unchanged).

### P0 (24/24 represented)

| TD ID        | Scenario                                             | File                                | Representation                                                 |
| ------------ | ---------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------- |
| UNIT-002     | Create persists identity+route, insert-only          | `provider-bindings.test.ts`         | skip                                                           |
| UNIT-003     | Create-existing fails without mutation               | `provider-bindings.test.ts`         | skip                                                           |
| UNIT-004     | Update-existing changes intended metadata only       | `provider-bindings.test.ts`         | skip                                                           |
| UNIT-005     | Update-missing never inserts                         | `provider-bindings.test.ts`         | skip                                                           |
| UNIT-006     | Ratified project-ref maps to codebase + string ref   | `provider-binding.test.ts` (CLI)    | skip                                                           |
| UNIT-007     | Unknown/ambiguous project-ref fails before mutation  | `provider-binding.test.ts` (CLI)    | skip                                                           |
| UNIT-008     | Event route round-trips create→update                | `provider-bindings.test.ts`         | skip                                                           |
| UNIT-020     | Missing provider+name matches malformed fixture      | `provider-binding.test.ts` (CLI)    | skip                                                           |
| UNIT-034     | No secret/actor/Hermes field in output               | `provider-binding.test.ts` (CLI)    | skip                                                           |
| INT-001      | Fresh SQLite schema: FK, defaults, unique            | `sqlite.test.ts`                    | **exec-red** (verified: 4 sub-cases fail with `no such table`) |
| INT-005      | Concurrent duplicate creates → one row               | `sqlite.test.ts`                    | **exec-red**                                                   |
| INT-006      | Concurrent create/update → no duplicate              | `sqlite.test.ts`                    | **exec-red**                                                   |
| INT-007      | Create→update→create preserves semantics             | `sqlite.test.ts`                    | **exec-red**                                                   |
| CLI-001      | Create output exactly matches fixture                | `provider-binding.test.ts` (CLI)    | skip                                                           |
| CLI-002      | Update output exactly matches fixture                | `provider-binding.test.ts` (CLI)    | skip                                                           |
| CLI-003      | Status output exactly matches fixture                | `provider-binding.test.ts` (CLI)    | skip                                                           |
| CLI-004      | Rotate output exactly matches fixture                | `provider-binding.test.ts` (CLI)    | skip                                                           |
| CLI-005      | Disable output exactly matches fixture               | `provider-binding.test.ts` (CLI)    | skip                                                           |
| CLI-006      | Malformed output matches error fixture + redaction   | `provider-binding.test.ts` (CLI)    | skip                                                           |
| CLI-007      | All 5 verbs emit one pure JSON stdout doc            | `provider-binding.e2e.test.ts`      | skip (real `Bun.spawn` harness; route missing)                 |
| CLI-008      | Malformed argv emits one failure doc, nonzero exit   | `provider-binding.e2e.test.ts`      | skip (real harness)                                            |
| CONTRACT-001 | Every live command validates against envelope schema | `provider-binding.test.ts` (CLI)    | skip                                                           |
| CONTRACT-003 | Canonical validator passes, contracts unedited       | `provider-binding-contract.test.ts` | **exec-pass** (verified: exit 0 today — regression gate)       |
| CI-002       | No secret/signing material in code/schema/DB/output  | `provider-binding-contract.test.ts` | skip (honest — see below)                                      |

### P1 (45/45 represented)

| TD ID        | Scenario                                                        | File                                       | Representation                                                                                                                                                                                                                                                          |
| ------------ | --------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UNIT-001     | Row schema mirrors snake_case DB row                            | `workflow-provider-binding.test.ts`        | skip                                                                                                                                                                                                                                                                    |
| UNIT-009     | Rotate: update-then-select, +1 version                          | `provider-bindings.test.ts`                | skip                                                                                                                                                                                                                                                                    |
| UNIT-010     | Rotate-before-create fails not found                            | `provider-bindings.test.ts`                | skip                                                                                                                                                                                                                                                                    |
| UNIT-011     | Disable retains the row                                         | `provider-bindings.test.ts`                | skip                                                                                                                                                                                                                                                                    |
| UNIT-012     | Disable-before-create fails not found                           | `provider-bindings.test.ts`                | skip                                                                                                                                                                                                                                                                    |
| UNIT-013     | Status missing                                                  | `provider-bindings.test.ts`                | skip                                                                                                                                                                                                                                                                    |
| UNIT-014     | Status active/valid                                             | `provider-bindings.test.ts`                | skip                                                                                                                                                                                                                                                                    |
| UNIT-015     | Status disabled/not-ready                                       | `provider-bindings.test.ts`                | skip                                                                                                                                                                                                                                                                    |
| UNIT-016     | Status rotated/ready with active version                        | `provider-bindings.test.ts`                | skip                                                                                                                                                                                                                                                                    |
| UNIT-017     | Status conflicting with path-mismatch detail                    | `provider-binding.test.ts` (CLI)           | skip                                                                                                                                                                                                                                                                    |
| UNIT-018     | Stale representable without active detection                    | `provider-binding.test.ts` (CLI)           | skip                                                                                                                                                                                                                                                                    |
| UNIT-019     | Corrupt persisted state fails closed                            | `provider-bindings.test.ts`                | skip                                                                                                                                                                                                                                                                    |
| UNIT-021     | Missing provider alone fails (non-create verb)                  | `provider-binding.test.ts` (CLI)           | skip                                                                                                                                                                                                                                                                    |
| UNIT-022     | Missing name alone fails (non-create verb)                      | `provider-binding.test.ts` (CLI)           | skip                                                                                                                                                                                                                                                                    |
| UNIT-023     | Create missing project-ref fails before work                    | `provider-binding.test.ts` (CLI)           | skip                                                                                                                                                                                                                                                                    |
| UNIT-024     | Create missing route fails before work                          | `provider-binding.test.ts` (CLI)           | skip                                                                                                                                                                                                                                                                    |
| UNIT-025     | Update missing project-ref fails before work                    | `provider-binding.test.ts` (CLI)           | skip                                                                                                                                                                                                                                                                    |
| UNIT-026     | Update missing route fails before work                          | `provider-binding.test.ts` (CLI)           | skip                                                                                                                                                                                                                                                                    |
| UNIT-027     | Whitespace provider — no silent alias                           | `provider-binding.test.ts` (CLI)           | skip — **BLOCKED**, see below                                                                                                                                                                                                                                           |
| UNIT-028     | Whitespace name — no silent alias                               | `provider-binding.test.ts` (CLI)           | skip — **BLOCKED**                                                                                                                                                                                                                                                      |
| UNIT-029     | Whitespace route fails before mutation                          | `provider-binding.test.ts` (CLI)           | skip — **BLOCKED**                                                                                                                                                                                                                                                      |
| UNIT-030     | Unicode/separator values round-trip or fail deterministically   | `provider-bindings.test.ts`                | skip — **BLOCKED**                                                                                                                                                                                                                                                      |
| UNIT-031     | Normalization-collision candidates never share a bindingId      | `provider-bindings.test.ts`                | skip                                                                                                                                                                                                                                                                    |
| UNIT-032     | Supplied correlation ID preserved                               | `provider-binding.test.ts` (CLI)           | skip                                                                                                                                                                                                                                                                    |
| UNIT-033     | Generated correlation ID / timestamps valid format              | `provider-binding.test.ts` (CLI)           | skip                                                                                                                                                                                                                                                                    |
| UNIT-035     | Codebase lookup rejection → failure, no write                   | `provider-binding.test.ts` (CLI)           | skip                                                                                                                                                                                                                                                                    |
| UNIT-036     | Binding write rejection → failure, not defaulted success        | `provider-binding.test.ts` (CLI)           | skip                                                                                                                                                                                                                                                                    |
| UNIT-037     | Post-mutation SELECT failure → uncertain, not stale success     | `provider-bindings.test.ts`                | skip                                                                                                                                                                                                                                                                    |
| UNIT-038     | Injected timeout error maps to machine envelope                 | `provider-binding.test.ts` (CLI)           | skip                                                                                                                                                                                                                                                                    |
| UNIT-039     | Non-serializable error data sanitized to valid JSON             | `provider-binding.test.ts` (CLI)           | skip                                                                                                                                                                                                                                                                    |
| UNIT-040     | Remove/unsupported command fails closed                         | `provider-binding.test.ts` (CLI)           | skip                                                                                                                                                                                                                                                                    |
| INT-002      | Existing SQLite DB adds table, no data loss                     | `sqlite.test.ts`                           | **exec-red**                                                                                                                                                                                                                                                            |
| INT-003      | Repeated SQLite init is idempotent                              | `sqlite.test.ts`                           | **exec-red**                                                                                                                                                                                                                                                            |
| INT-004      | PostgreSQL combined schema equivalent semantics                 | `postgres.test.ts`                         | **exec-red** (verified: fails on the new-table assertion; BEGIN/COMMIT + real-file plumbing already pass)                                                                                                                                                               |
| INT-008      | Concurrent rotates are monotonic                                | `sqlite.test.ts`                           | **exec-red**                                                                                                                                                                                                                                                            |
| INT-009      | Rotate racing disable → serializable final state                | `sqlite.test.ts`                           | **exec-red**                                                                                                                                                                                                                                                            |
| INT-010      | Duplicate disable retains one row                               | `sqlite.test.ts`                           | **exec-red**                                                                                                                                                                                                                                                            |
| INT-011      | Schema failure rolls back, restart converges                    | `postgres.test.ts`                         | skip — needs a real restartable Postgres instance (no live PG lane by default, R-007 residual risk); generic rollback mechanism already proven by the pre-existing `initSchema()` DDL-failure test in the same file                                                     |
| CLI-009      | New flags parse before/after command, never positional          | `provider-binding.e2e.test.ts`             | skip (real harness; route missing)                                                                                                                                                                                                                                      |
| CONTRACT-002 | Binding-domain status fixtures remain validator-valid           | `provider-binding-contract.test.ts`        | **exec-pass** (verified: 6 `status-*.json` fixtures checked)                                                                                                                                                                                                            |
| CONTRACT-004 | Fixture comparison excludes only documented dynamic paths       | `provider-binding-contract.test.ts`        | **exec-pass** (verified)                                                                                                                                                                                                                                                |
| CI-001       | Bundled schema regenerated, contains table marker               | `provider-bindings-bundled-schema.test.ts` | **exec-red** (verified: both source-mode and binary-mode assertions fail today)                                                                                                                                                                                         |
| CI-003       | Mocked tests pass isolated and in repeated/package runs         | package.json wiring (both packages)        | **satisfied by construction** — every new file that uses `mock.module()` sits on its own isolated `bun test` line; verified by actually running `bun run test` for `@archon/core` and `@archon/cli` end-to-end during this pass (no cross-file mock pollution observed) |
| CI-004       | Full `bun run validate` passes                                  | —                                          | **process gate**, not a generated test — enforced by the existing `validate` script; will fail (as intended) until Tasks 1-4 land, since the new files are currently red/skip                                                                                           |
| CI-005       | Change scope contains no excluded surface, rollback notes exist | —                                          | **process gate / PR review checklist** — see waiver W-006 below; enforced by code review against the Dev Notes "Scope Boundary" section, not a Bun test                                                                                                                 |

### Reviewer Concerns (24/24 disposed)

All 24 reviewer concerns (RC-01…RC-24) from `test-design-epic-3.md`'s "Reviewer-Evidence Disposition" table are carried forward unchanged — each maps to the same TD scenario IDs listed there, and every one of those scenario IDs has a concrete file:line home in the table above (RC-07/RC-13/RC-17/RC-20/RC-21 map to explicit non-risk dispositions or waivers, not new tests, exactly as the TD already documents). No reviewer concern is left unrepresented.

### Acceptance Criteria (5/5 traceable)

| AC                                                   | Coverage                                                                                 |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| AC1 (create/update persistence + route)              | UNIT-001/002/004/006–008/023/024/029; INT-001/002/004; CLI-001/007 — all generated above |
| AC2 (update is distinct from create, fails closed)   | UNIT-002–005/025/026; INT-005–007; CLI-002/007 — all generated above                     |
| AC3 (status states, shared shape)                    | UNIT-013–019; CLI-003; CONTRACT-002; W-001 (stale detection, waived)                     |
| AC4 (rotate/disable JSON envelope, no Hermes fields) | UNIT-009–012/032–034/040; INT-008–010; CLI-004/005/007; CONTRACT-001; W-003/W-009        |
| AC5 (malformed input / fail closed)                  | UNIT-019–031/035–039; CLI-006/008; CONTRACT-001/003; W-004 (cancellation, waived)        |

## Skipped Scaffolds — reason and activation seam

Every `test.skip()` in the generated files falls into exactly one of two buckets:

**1. Target module doesn't exist yet** (the overwhelming majority — `packages/core/src/schemas/workflow-provider-binding.ts`, `packages/core/src/db/provider-bindings.ts`, `packages/cli/src/commands/provider-binding.ts` are all absent). Every one of these tests imports the missing module **dynamically inside the skipped test body** (never statically at file top), so the file loads and reports a clean skip today instead of crashing on module resolution. Activation is uniform: implement the named file per the story's Dev Notes, remove `.skip`, switch the dynamic `await import(...)` to a static top-level import. Each file's header comment repeats this exact recipe.

**2. Missing infrastructure, explicitly scoped as out-of-reach for this story:**

- `UNIT-027/028/029/030` (whitespace/Unicode canonicalization) — **BLOCKED** on Pre-Implementation Decision #2 in the TD ("empty/whitespace handling and canonicalization... not yet ratified"). The scaffolds assert only the non-negotiable floor (never silently alias two different inputs to the same identity); they do not guess the ratified rule. Activate once the decision is ratified — may need adjustment to match the ratified behavior exactly.
- `INT-011` (Postgres restart-converges) — needs a real, restartable Postgres instance; TD explicitly notes "No live PostgreSQL lane exists by default" (R-007 residual risk). The mocked `pg.Pool` harness in `postgres.test.ts` cannot simulate a process restart against persisted state. Activate when the project adds a reusable container-backed Postgres test lane (see TD "Weekly" execution-strategy note) — do not force new CI infrastructure solely for this one scenario.
- `CI-002` (secret/signing-material scan) — scanning three files that don't exist yet would be a **vacuous pass** (an empty glob "succeeds" without checking anything), which is worse than an honest skip. Activate once Tasks 1–3 land `provider-bindings.ts`, `workflow-provider-binding.ts`, and `provider-binding.ts`.
- `CLI-007/008/009` (CLI E2E) — use a **real** `Bun.spawn` harness (not a placeholder like the precedent `v2-workflow-discovery.e2e.test.ts` left), skipped only because `cli.ts` doesn't yet dispatch `provider-binding`. Activating requires no harness work — just landing Task 1's `case 'provider-binding':` switch and flag declarations, then removing `.skip`.

No scenario is skipped merely for convenience; every skip reason above names a specific missing seam and the exact change that flips it to red-then-green.

## Waivers (10/10 carried forward, unchanged from TD)

| ID    | Reason                                                                                       | Owner                             | Residual risk                                               | Follow-up trigger                                                                   |
| ----- | -------------------------------------------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| W-001 | No expected-version input or stale-detection protocol; reconciliation is Hermes-owned        | Workflow Commander contract owner | A stale binding may remain reported as persisted state      | Expected-version/version-comparison semantics or explicit Archon ownership is added |
| W-002 | No runtime caller reads/emits `workflow-provider-binding.v1`; a second schema is speculative | Archon architecture owner         | A future caller could diverge from domain fixtures          | First accepted runtime caller for that family                                       |
| W-003 | Closed schemas do not define top-level actor                                                 | Workflow Commander contract owner | Mutations lack contract-level actor attribution             | Contract revision adds actor or an approved nested location                         |
| W-004 | No binding-command timeout/cancel contract or threshold exists                               | CLI architecture owner            | Never-settling DB work can hang, mutation outcome ambiguous | Timeout flag/default, abort signal, cancellation contract, or remote SLO accepted   |
| W-005 | Local CLI inherits OS-process permissions, no application role policy                        | Security owner                    | A local process with DB access can mutate bindings          | Multi-user, remote execution, service account, or role requirement introduced       |
| W-006 | HTTP/UI/Hermes/event-delivery surfaces explicitly excluded                                   | Product + architecture owners     | Downstream integration untested here                        | An approved story activates one of those surfaces                                   |
| W-007 | Story 3.3a owns the shared envelope builder; local construction intentionally temporary      | Story 3.3a owner                  | Temporary duplication can drift                             | Story 3.3a begins; rerun exact fixture tests during refactor                        |
| W-008 | Schemas define minimum but no maximum lengths                                                | Contract owner                    | Extremely long values may stress storage/CLI behavior       | `maxLength`, index limit, abuse case, or performance incident established           |
| W-009 | Update/rotate behavior after disabled is unspecified                                         | Product + architecture owners     | Controllers may observe inconsistent disabled transitions   | Resolve before Task 3 acceptance or when a fixture defines the transition           |
| W-010 | No load/latency target exists for the local single-developer CLI                             | Product/operations owner          | Performance regressions have no numeric gate                | Remote/concurrent exposure or latency SLO accepted                                  |

None of these required new test artifacts in this pass — they are pre-existing TD decisions about undefined/excluded behavior, reproduced here verbatim per the "every reviewer concern → test, skip, or waiver" mandate.

## Exact Commands to Run the Generated Tests

Individual files (fastest feedback loop while implementing each task):

```bash
# Task 1 — row schema + DB layer create/status
bun test packages/core/src/schemas/workflow-provider-binding.test.ts
bun test packages/core/src/db/provider-bindings.test.ts
bun test packages/core/src/db/adapters/sqlite.test.ts
bun test packages/core/src/db/adapters/postgres.test.ts
bun test packages/core/src/db/provider-bindings-bundled-schema.test.ts

# Task 1/4 — CLI command + contract fixtures
bun test packages/cli/src/commands/provider-binding.test.ts
bun test packages/cli/src/commands/provider-binding.e2e.test.ts
bun test packages/cli/src/commands/provider-binding-contract.test.ts
```

Full package-isolated suites (matches CI / `bun run validate`):

```bash
bun run --filter @archon/core test
bun run --filter @archon/cli test
```

Do **not** run root `bun test` (discovers all packages in one process; causes `mock.module()` pollution per CLAUDE.md).

Contract-package regression (already passing, run after any story-3.1 change to confirm it stays that way):

```bash
python3 _bmad-output/planning-artifacts/contracts/workflow-commander/validate_contracts.py
```

Full pre-PR gate (only meaningful once Tasks 1–4 are implemented — will fail today by design):

```bash
bun run validate
```

## Current (Red-Phase) Verified State

- `packages/core/src/schemas/workflow-provider-binding.test.ts`: 0 pass / 3 skip.
- `packages/core/src/db/provider-bindings.test.ts`: 0 pass / 18 skip.
- `packages/core/src/db/adapters/sqlite.test.ts`: 13 pass (pre-existing) / **12 fail (new, red)**.
- `packages/core/src/db/adapters/postgres.test.ts`: 37 pass (pre-existing) / 3 todo (pre-existing) / **1 fail (new, red)** / 1 skip (new).
- `packages/core/src/db/provider-bindings-bundled-schema.test.ts`: **2 fail (new, red)**.
- `packages/cli/src/commands/provider-binding.test.ts`: 0 pass / 30 skip.
- `packages/cli/src/commands/provider-binding.e2e.test.ts`: 0 pass / 8 skip.
- `packages/cli/src/commands/provider-binding-contract.test.ts`: 3 pass (regression gates, already green) / 1 skip.
- `bun run --filter @archon/core type-check` and `bun run --filter @archon/cli type-check`: clean, no errors from any new file.
- `bunx eslint` on all 8 new/modified test files: 0 errors (test files are lint-ignored by this repo's config, same as every other `*.test.ts`).

This is the expected and correct TDD red-phase state: every genuinely-testable-today boundary (real SQLite adapter, real bundled-schema disk read, real contract fixtures, real `validate_contracts.py`) fails or passes for the _right_ documented reason, and every not-yet-existing boundary is a clean, activatable skip.
