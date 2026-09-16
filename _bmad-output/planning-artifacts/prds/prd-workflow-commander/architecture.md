---
title: Archon Architecture Handoff - Hermes Agent Workflow Commander
status: handoff
created: '2026-07-11'
updated: '2026-09-16'
source: local materialized Archon architecture slice
---

# Architecture: Archon Slice For Hermes Agent Workflow Commander

## Scope

This file contains the Archon-owned architecture guidance for Workflow Commander v1.
It covers Archon as the first workflow provider implementation.
It does not assign Hermes-owned user orchestration, Project Binding, materialization, gates, reconciliation, or diagnostics to Archon.
It also does not assign Archon Web screens, workflow builder UI, wireframes, mockups, or new in-product UI to this handoff.
The active UX contract for Archon is headless provider ergonomics: parseable CLI JSON, signed typed events, provider binding diagnostics, and delivery health that controllers can consume safely.

## Design Paradigm

The system uses bounded contexts plus ports and adapters plus outbox and reconciliation.
Hermes is the human-facing command center and reconciliation owner.
BMAD owns planning and story artifacts.
Workflow providers own workflow execution primitives, workflow run state, retry behavior, approval pauses, event production, and delivery.
Archon is the first workflow provider.

## Archon Ownership Rules

- Archon owns Workflow Provider Binding records keyed by project or codebase execution context plus generic controller `provider` and `name`.
- Archon exposes provider binding create, update, status, rotate, and disable as explicit lifecycle command surfaces; create is not an upsert alias for update.
- Archon owns CLI JSON producer surfaces for workflow start, status, approve, reject, resume, retry, and cancel.
- Archon owns workflow run state, retry state, resume behavior, cancel behavior, workflow event production, non-blocking event outbox, delivery status, and signed event production.
- Archon exposes parseable JSON for state-changing control results consumed by external controllers.
- Archon delivers state notifications through signed typed workflow events, not by mutating consumer state directly.
- Archon keeps workflow execution independent from event delivery success.

## Architecture Decisions Relevant To Archon

### AD-2 - Split Project Binding And Workflow Provider Binding Ownership

Hermes owns forward Project Binding data such as profile, cwd, GitHub context, BMAD mount, operational status, and user interaction.
Archon owns the reverse Workflow Provider Binding from project or codebase execution context to generic controller provider, name, and workflow event route.

### AD-3 - Control Workflow Providers Through Adapters And Signed Typed Events

Hermes controls provider `archon` through CLI commands.
Archon CLI command results must include the information needed by a strict adapter: cwd when applicable, stdout, stderr, exit code, timeout, correlation id, and parsed JSON result.
Archon reports workflow state changes through signed typed events delivered from an outbox.

### AD-6 - Split Implementation Ownership By Subproject

Archon owns the provider producer side.
Hermes owns the consumer side, event ingress, project work, gates, status history, reconciliation, diagnostics, and user interaction.
Implementation must preserve this boundary even when both sides reference the same shared contracts.

### AD-7 - Version Every Cross-Subproject Machine Contract

Workflow command envelopes, workflow event envelopes, Workflow Provider Binding records, and delivery status records are JSON and schema-versioned.
Archon producer work validates the shared examples locally before producer completion, and downstream Hermes consumer work validates compatibility when that consumer implementation begins.
Archon-specific fixtures live under the provider-specific Archon fixture namespace inside the local contract package.

### AD-8 - Ratify The Brownfield Stack And Avoid New Runtime Infrastructure

Archon stays on the existing Bun and TypeScript workspace.
No new runtime, shared database, queue service, or external infrastructure is required for Workflow Commander v1.

### AD-9 - Build Contract-First, Then Split Implementation By Subproject

Archon producer work must not invent field names ahead of the shared contract examples.
Provider binding, command-envelope, event-envelope, delivery-status, signature metadata, idempotency, and rejection fixtures are prerequisites for dependent implementation stories.

### AD-10 - Materialize Isolated Subproject Planning Handoffs Before Implementation

Archon implementation agents use local `prd.md`, `architecture.md`, `epics.md`, and contract-package documentation in this folder.
Implementation-critical context is local to the Archon handoff.
Older Route Loop Routing UX artifacts, Archon Web workflow builder mockups, June 26 UX shards, and UI-only prototypes are superseded for Workflow Commander and must not be imported as architectural input.

### AD-11 - Separate Delivery-State Writes From Health Projection

Story 3.5 owns the workflow event outbox, delivery-attempt mutations, retry-state mutations, terminal-failure recording, and all related migrations.
Story 3.7 reads that persisted state and projects it into validated delivery-health CLI JSON.
Story 3.7 must not create a second delivery-status write path or mutate delivery attempts while serving health queries.
This separation preserves one source of truth, prevents duplicate migration ownership, and keeps workflow execution independent from notification delivery.

## Consistency Conventions

| Concern                 | Archon Convention                                                                                                                                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Controller naming       | Use generic `provider` and `name` vocabulary.                                                                                                                                                                                                                            |
| Control direction       | External controllers invoke Archon through CLI JSON only for state-changing Workflow Commander control.                                                                                                                                                                  |
| Event direction         | Archon reports workflow changes through signed typed events from a non-blocking outbox.                                                                                                                                                                                  |
| Data format             | Cross-subproject contracts use JSON with explicit schema versions and shared examples.                                                                                                                                                                                   |
| Command envelope        | Command results include schema version, success flag, correlation id, workflow run reference when applicable, binding reference when applicable, result payload, and an error shape with stable code, diagnostic category, boolean retryability, and structured details. |
| Workflow event envelope | Events include schema version, event id, event type, occurred timestamp, provider binding reference, workflow run reference, project or codebase reference, signature metadata, and idempotency key.                                                                     |
| Delivery status         | Delivery health is stored independently of workflow execution success.                                                                                                                                                                                                   |

## Stack

| Name              | Version  |
| ----------------- | -------- |
| Archon workspace  | 0.5.0    |
| Bun runtime       | ^1.3.0   |
| TypeScript        | ^5.3.0   |
| Hono              | ^4.12.16 |
| Zod               | ^4.4.3   |
| Hono Zod OpenAPI  | ^1.4.0   |
| @archon/workflows | 0.5.0    |
| @archon/cli       | 0.5.0    |
| @archon/server    | 0.5.0    |
| @archon/core      | 0.4.1    |

## Source Tree Seed

```text
packages/cli/src/commands/
  provider-binding.ts
  workflow.ts
packages/core/src/db/
  provider-bindings.ts
  workflow-event-outbox.ts
packages/workflows/src/
  store.ts
  event-emitter.ts
packages/server/src/
  workflow-events/
```

These are expected implementation areas for later Archon producer stories.
This planning story does not create application code, migrations, tests, or implementation artifacts in those locations.

## Deferred Details

| Deferred Decision                                                         | Owner                                  | Gate / Required Follow-up                                                                                                                                    |
| ------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Exact provider command JSON result schemas                                | Archon with downstream consumer review | Archon implementation gate: local canonical examples and validation pass. Hermes validates consumer compatibility when its downstream implementation begins. |
| Exact workflow event signature algorithm, replay window, and header names | Archon with consumer security review   | Signed, expired, duplicate, wrong-binding, and invalid-schema examples exist.                                                                                |
| Exact delivery retry policy                                               | Archon provider owner                  | Delivery status fixtures cover healthy, delayed, retrying, failed, terminal failure, duplicate-safe, and reconciliation-pending states.                      |

## Provider Command Syntax Baseline

Workflow Commander command identifiers are no longer deferred.
The canonical JSON `command` values are the enum values in `schemas/workflow-command-envelope.schema.json`.
The provider CLI syntax must preserve the existing `archon workflow` command family for workflow run control and add the provider-binding family seeded in this architecture.

| Contract Command   | Provider CLI Syntax Baseline                                                                                              | Notes                                                                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workflow.start`   | `archon workflow run <workflow-name> [message] --json`                                                                    | May also accept existing workflow-run flags such as `--cwd`, `--branch`, `--from`, `--no-worktree`, and `--conversation-id` when those flags are already valid for `workflow run`. |
| `workflow.status`  | `archon workflow get <run-id> --json`                                                                                     | Uses the single-run inspection surface, not the active-run list surface.                                                                                                           |
| `workflow.approve` | `archon workflow approve <run-id> [comment] --json`                                                                       | Must keep command result recording distinct from Hermes-owned human decision authority.                                                                                            |
| `workflow.reject`  | `archon workflow reject <run-id> [reason] --json`                                                                         | Must keep command result recording distinct from Hermes-owned human decision authority.                                                                                            |
| `workflow.resume`  | `archon workflow resume <run-id> --json`                                                                                  | Validates resumability and returns the unchanged current state without dispatching execution or mutating the run.                                                                  |
| `workflow.retry`   | `archon workflow retry <run-id> [--node <node-id>] --json`                                                                | Acknowledges detached-process creation only; the worker owns later validation, claim, preparation, and execution outcomes; remains separate from streaming `retry-node`.           |
| `workflow.cancel`  | `archon workflow cancel <run-id> --json`                                                                                  | Returns minimal cancelled terminal state after the durable transition without reporting stale previous state or waiting for process quiescence or cleanup.                         |
| `binding.create`   | `archon provider-binding create --provider archon --name <name> --project-ref <project-ref> --route <event-route> --json` | Uses generic provider and name vocabulary.                                                                                                                                         |
| `binding.update`   | `archon provider-binding update --provider archon --name <name> --project-ref <project-ref> --route <event-route> --json` | Updates an existing provider-side binding route or metadata. This is separate from `binding.create`; create must not silently upsert.                                              |
| `binding.status`   | `archon provider-binding status --provider archon --name <name> [--project-ref <project-ref>] --json`                     | Reports missing, valid, stale, disabled, rotated, and conflicting states.                                                                                                          |
| `binding.rotate`   | `archon provider-binding rotate --provider archon --name <name> --json`                                                   | Rotates provider-side binding material without exposing raw secrets.                                                                                                               |
| `binding.disable`  | `archon provider-binding disable --provider archon --name <name> --json`                                                  | Disables routing without deleting audit history.                                                                                                                                   |

Story 3.3a owns finalizing tests that assert each provider CLI syntax emits the matching canonical `command` value.
If implementation discovers an existing CLI conflict, the story must update this table and the contract examples before producer code merges.
Archon emits shared failure envelopes only for failures it catches before response.
The subprocess consumer owns empty output, malformed or schema-invalid output, externally enforced timeout, and uncatchable process-exit classification; Workflow Commander v1 does not add an Archon supervisor.

## Local Contract Readiness

The local contract package is `../../contracts/workflow-commander/`.
It contains the current local JSON schemas, examples, fixtures, and validator used by the Archon producer stories and Hermes consumer stories.
Producer story readiness depends on the package validating successfully with the canonical command:

```bash
python3 _bmad-output/planning-artifacts/contracts/workflow-commander/validate_contracts.py
```

If validation fails, a required schema or example is missing, or an implementation needs a field absent from the validated package, the affected story remains blocked and must not invent contract fields.

## Implementation Root And Validation

Run implementation from the active Archon repository root, the directory that contains this `_bmad-output/planning-artifacts/prds/prd-workflow-commander/` handoff and the root `package.json`.
Do not replace that with a user-local absolute path.
The recommended downstream validation command is `bun run validate`.
