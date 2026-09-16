---
title: Archon Planning Handoff - Hermes Agent Workflow Commander
status: handoff
created: '2026-07-11'
updated: '2026-09-16'
source: local materialized Archon slice of the headless Workflow Commander plan
---

# PRD: Archon Slice For Hermes Agent Workflow Commander

## Purpose

Hermes Agent Workflow Commander makes Hermes Agent the human-facing, headless command surface for BMAD planning, Archon workflow execution, GitHub PR state, and local project work.
Archon is the first workflow provider that Hermes controls.
This file defines only the requirements Archon must satisfy as that provider.
All implementation-critical product context for Archon is local to this file and the companion local `architecture.md`, `epics.md`, and `../../contracts/workflow-commander/README.md`.

## Product Boundary

Workflow Commander v1 is headless.
The user controls workflow work through Hermes commands, agent interactions, structured results, durable pending-gate queries, and existing notification transports when available.
Archon remains a provider implementation and does not become the user-facing command center.
The lack of Archon Web screens, workflow builder UI, wireframes, mockups, and new in-product UI is an explicit product boundary for this handoff, not a missing UX deliverable.
The Archon-side UX requirement is satisfied through machine-consumable provider output quality and clear operational diagnostics in CLI JSON and workflow events.

## Scope Owned By Archon

Archon owns the provider `archon` implementation of Workflow Provider Binding, CLI JSON producer contracts, workflow run state, retry behavior, resume behavior, cancel behavior, workflow event production, non-blocking event outbox, delivery status, and signed workflow event production.
Archon must keep controller identity generic through `provider` and `name`.
Archon must avoid Hermes-specific provider fields such as `profile`, `agent_name`, `agent`, or `agent_provider` except when documenting forbidden terms.

## Scope Not Owned By Archon

Archon does not own Project Binding, BMAD mount, cwd enforcement from Hermes, BMAD invocation from Hermes, materialization, Project Work Items, Phase Tasks, HILT Gates, workflow event ingress, Story Status History, reconciliation, diagnostics, or Hermes user interaction.
Those responsibilities belong to `hermes-agent`.
Archon producer stories may identify Hermes consumer stories that are blocked by Archon output, but Archon must not implement the Hermes consumer side.
Route Loop Routing UX artifacts, Archon Web workflow builder mockups, older June 26 UX shards, and any UI-only mockup package are superseded for Workflow Commander implementation unless a future approved planning artifact explicitly reactivates them.

## Functional Requirements Owned By Archon

### FR-7: Register Generic Workflow Provider Bindings

Archon can create, update, inspect, rotate, disable, and diagnose provider-side Workflow Provider Binding records for a project or codebase using generic `provider` and `name` vocabulary.

**Consequences:**

- Archon persists a reverse binding from project or codebase execution context to controller `provider`, controller `name`, and workflow event route.
- Archon exposes binding status as parseable CLI JSON.
- Archon exposes update through an explicit `binding.update` command surface; `binding.create` is not an update or upsert path.
- Archon can represent missing, valid, stale, disabled, rotated, and conflicting binding states.
- Archon returns machine-readable errors for malformed input or invalid lifecycle transitions.
- Archon does not expose Hermes-specific command names or model fields.

### FR-8: Expose Provider Workflow Control Through CLI JSON

Archon exposes start, status, approve, reject, resume, retry, and cancel for workflow runs through CLI JSON.
This is the producer side of the provider adapter that a controller such as Hermes consumes.

**Consequences:**

- Archon returns parseable JSON for every state-changing control result.
- Every result includes schema version, success flag, correlation id, workflow run reference when applicable, binding reference when applicable, machine-readable result payload, and machine-readable error shape when failed.
- Archon returns machine-readable classifications for malformed requests, unexpected states, internally caught timeouts, and every other failure it catches before responding.
- The subprocess consumer classifies empty output or uncatchable process exit as unexpected exit, malformed or schema-invalid output as schema mismatch, and a consumer-enforced timeout as timeout.
- Archon does not expose a state-changing HTTP control path for Workflow Commander v1.

### FR-9: Produce Signed Typed Workflow Events

Archon emits signed typed workflow events for workflow start, workflow completion, workflow failure, approval requested, delivery failed, and artifact events through a non-blocking outbox.

**Consequences:**

- Archon writes eligible events to durable outbox state before delivery.
- Archon workflow execution continues even when event delivery fails later.
- Every event body includes schema version, event id, event type, occurred timestamp, provider binding reference, workflow run reference, project or codebase reference, and idempotency key.
- Signature metadata travels in HTTP headers.
- Archon uses stable event id and idempotency key values so consumers can classify duplicate-safe delivery.
- Archon produces events that can be validated by shared event-envelope and rejection fixtures.

### FR-10: Surface Provider Event Delivery And Outbox Health

Archon reports workflow event delivery and outbox health as structured status.

**Consequences:**

- Archon persists delivery status, retry status, last attempt time when available, last error category, terminal failure state, and affected workflow run reference.
- Archon reports healthy, delayed, retrying, failed, duplicated, terminal failure, and reconciliation-pending states when known.
- Archon exposes delivery status through CLI JSON.
- Archon does not block workflow execution solely because event notification failed.

## Non-Functional Requirements Relevant To Archon

- **NFR-1:** Workflow events accelerate delivery but are not the only source of truth.
- **NFR-5:** Archon events must be signed and schema-versioned so consumers can reject invalid events.
- **NFR-6:** Event secrets and signature metadata must support binding-scoped validation by the consumer.
- **NFR-9:** Archon persists workflow commands, workflow events, and delivery state with enough detail for audit.
- **NFR-14:** Archon error and delivery-health responses expose diagnostic categories and machine-readable detail rather than raw stack traces.
- **NFR-15:** Archon stays within provider ownership boundaries and does not reach into Hermes-owned concerns.
- **NFR-16:** Provider integration surfaces remain generic provider surfaces.
- **NFR-17:** The local handoff is complete enough for isolated Archon implementation agents.

## Local Contract Readiness

The local contract package is `../../contracts/workflow-commander/`.
It contains the current Workflow Provider Binding, workflow command envelope, workflow event envelope, delivery status, Archon provider command, Archon provider event, callback rejection, and materialization schema/example families for this handoff.
Archon producer stories may use those contracts only when the canonical validation command succeeds as checked in:

```bash
python3 _bmad-output/planning-artifacts/contracts/workflow-commander/validate_contracts.py
```

If the validator fails, a required schema or example is missing, or a producer story needs a field that is not present in the validated package, that story must not move to implementation-ready and producer code must not invent the missing contract.

## Cross-Project Dependency Record Shape

Archon stories that depend on another subproject or shared contract work use this record shape:

```text
Depends on: <subproject or parent> Story <id or title>
Contract needed: <API/event/file/interface/schema>
Blocking behavior: <what must exist before this story can be completed>
Integration validation: <how both sides will be proven compatible>
```

The dependency must name a concrete contract family or interface.
Acceptable examples include workflow command envelope, workflow event envelope, Workflow Provider Binding schema, delivery status schema, event route, binding status result, signature metadata, idempotency key, and rejection fixture.

## Implementation Root And Validation

Run implementation from the active Archon repository root, the directory that contains this `_bmad-output/planning-artifacts/prds/prd-workflow-commander/` handoff and the root `package.json`.
Do not replace that with a user-local absolute path.
The recommended downstream validation command is `bun run validate`.
This planning story does not require running that command because it changes only local planning handoff files.

## Non-Goals

- Archon does not implement Hermes Project Binding or Hermes Project Work Item storage.
- Archon does not implement Hermes materialization, phase tasks, HILT Gates, Story Status History, reconciliation, diagnostics, or user interaction.
- Archon does not add Hermes-specific provider vocabulary.
- Archon does not add a state-changing HTTP control path for Workflow Commander v1.
- Archon does not mark producer stories ready while required local schemas or fixtures are missing or the canonical local validator fails.
