---
title: Archon UX Note - Hermes Agent Workflow Commander
status: active
created: '2026-07-12'
updated: '2026-09-16'
source: headless Workflow Commander PRD and architecture handoff
---

# UX Note: Headless Archon Provider Slice

## Active UX Scope Decision

Workflow Commander v1 is headless from Archon's side.
Hermes owns the human-facing command surface, agent interactions, durable pending-gate queries, notifications, and user-facing reconciliation experience.
Archon owns provider-side CLI JSON producer surfaces, signed typed workflow events, provider binding diagnostics, workflow run control behavior, non-blocking event outbox behavior, and delivery health status.

The absence of Archon Web screens, workflow builder surfaces, wireframes, mockups, and new in-product UI is an approved UX scope decision.
It is not a deferred UX requirement, missing artifact, or implementation-readiness warning.
Implementation readiness review should treat this headless UX scope as satisfied when the sibling `prd.md`, `architecture.md`, and `epics.md` preserve the same provider boundary.

## Superseded UX Sources

Route Loop Routing UX artifacts, Archon Web workflow builder mockups, older June 26 UX shards, and UI-only prototypes are superseded for Workflow Commander implementation.
Implementation agents must not use those archived or unrelated UX materials as active Workflow Commander requirements unless a later approved Archon planning artifact explicitly reactivates them.
This supersession rule is an active scope control, not an open warning.

## Archon UX Requirements

The user-facing experience requirement for Archon is machine-consumable output quality:

- CLI control results are parseable JSON and validate against the local command envelope examples.
- Failure results expose machine-readable error codes, diagnostic categories, retryability, and structured details.
- Provider binding status exposes missing, valid, stale, disabled, rotated, and conflicting states without Hermes-specific provider fields.
- Workflow event delivery health exposes delayed, retrying, failed, duplicated, terminal failure, and reconciliation-pending states without blocking workflow execution.
