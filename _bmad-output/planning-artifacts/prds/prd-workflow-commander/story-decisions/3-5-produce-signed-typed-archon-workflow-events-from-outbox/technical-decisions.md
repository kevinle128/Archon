---
story: 3-5-produce-signed-typed-archon-workflow-events-from-outbox
gate: PASS
unresolvedDecisionCount: 0
mode: batch
reviewStatus: APPROVED
---

## Decision Summary

All 16 originally identified technical decisions have user-approved final resolutions.
The user approved this consolidated whole-file result, and Story 3.5 passed the technical-decision gate.
Story 3.5 will produce a small Archon-to-Hermes webhook integration that reuses Hermes Generic Webhook V2 exactly.
Workflow processes enqueue external events independently and best-effort, while the single `archon serve` process owns HTTP delivery, retry scheduling, and delivery-history writes.
The existing internal workflow-event timeline remains independent from a new external outbox and append-only webhook-attempt history.
The workflow event body is stable across retries, and every attempt receives a fresh Hermes V2 timestamp and HMAC signature in HTTP headers.
Workflow execution never throws, rolls back, or changes outcome because external enqueue or delivery fails.

## Source Reconciliation

### Accepted runtime authority

- Hermes Generic Webhook V2 is the security and transport-verification authority for this integration.
- Archon uses `X-Webhook-Signature-V2`, `X-Webhook-Timestamp`, and lowercase hexadecimal HMAC-SHA256 over `timestamp + "." + exactRawBodyBytes`.
- Hermes enforces its existing 300-second replay window and fails closed on malformed timestamps, stale requests, or invalid signatures.
- Archon does not introduce body canonicalization, `bodyDigest`, a second signature object, configurable signature algorithms, or alternate header names.

### Contract reconciliation required before implementation completion

- The current event JSON Schema and examples contain planning-era fields that the accepted runtime no longer emits.
- Remove `profileRoute`, the body-level `signature` object, `bodyDigest`, `delivery`, `intendedProducer`, `intendedConsumer`, and `owningSubproject` from `workflow-event-envelope.v1` and its fixtures.
- Keep `provider`, `eventId`, `eventType`, `occurredAt`, `bindingRef`, `workflowRunRef`, `projectRef`, `idempotencyKey`, and `payload` as runtime event-body fields.
- Remove `phase` and `commandCorrelationId` from `workflow.run.started` payload requirements.
- Keep generic `phase` on `workflow.approval.requested`, where it identifies the workflow node currently awaiting review.
- Standardize delivery-status `eventRef.eventType` on the `workflow.run.*` vocabulary.
- Standardize event idempotency keys on `archon:<bindingName>:<eventId>`.
- Treat delivery-status `correlationId` as the correlation of the Story 3.7 status query rather than persisted event state.
- Remove binding-staleness/version-comparison requirements from Story 3.5 routing acceptance criteria.
- Add `workflow.run.started` to the Story 3.5 product event list so the prose and accepted event vocabulary agree.

### Runtime reality preserved

- `remote_agent_workflow_events` remains the internal audit, dashboard, and workflow timeline table.
- Its high-frequency and internal-only event vocabulary is not exposed to Hermes.
- `createWorkflowEvent` remains non-throwing and continues to serve internal observability.
- The existing Workflow Provider Binding remains the project-level reverse route from an Archon codebase to an external controller.
- CLI and detached workflow processes can execute without owning or starting an event dispatcher.
- `archon serve` is the deployment surface that owns the event-delivery poller.

## Lifecycle and Ownership

```text
Workflow lifecycle transition
  ├─ best-effort internal workflow_events write
  └─ best-effort external outbox enqueue
       └─ archon serve poller
            ├─ resolve locally valid binding
            ├─ insert pending webhook-attempt history
            ├─ sign exact body with Hermes V2 headers
            ├─ POST to binding event_route
            ├─ persist response or transport error
            └─ mark delivered, schedule retry, or mark terminal failure
```

Workflow execution owns its state transition and never waits for external delivery.
Story 3.5 owns the external outbox, delivery-attempt history, current delivery state, retry timestamps, terminal-failure state, and related migrations.
Story 3.7 is a read-only delivery-health projection and must not mutate outbox or attempt history.
Hermes owns webhook ingress, signature verification, replay-window enforcement, and downstream mutation.
Archon performs no binding-version comparison or binding-staleness reconciliation with Hermes.

## Decisions

### TD-01 — Reuse Hermes Generic Webhook V2 exactly

**Behavior:** Archon signs `timestamp + "." + exactRawBodyBytes` with HMAC-SHA256 and sends the lowercase hexadecimal digest in `X-Webhook-Signature-V2` plus Unix seconds in `X-Webhook-Timestamp`.
**Replay policy:** Hermes retains its existing 300-second replay window.
**Body contract:** The event body contains no signature object, signature metadata, canonicalization metadata, or `bodyDigest`.
**Rejected alternatives:** JCS, body-digest signing, configurable algorithms, configurable header names, and a second Archon-only signing protocol are rejected.
**Owner:** Archon signs and Hermes verifies using the already implemented Hermes rule.

### TD-02 — Store the plaintext signing secret on the Workflow Provider Binding

**Behavior:** Add nullable `signing_secret TEXT` to `remote_agent_workflow_provider_bindings` and leave it unencrypted at rest.
**Routing data:** The existing `event_route` is the complete webhook target and no `profileRoute`, ingress-path, secret-reference, or profile columns are added.
**Provisioning:** Existing rows remain nullable until a secret is provisioned, while binding rotation replaces the stored secret and increments the existing binding version.
**Exposure:** The raw secret is excluded from ordinary binding projections, CLI JSON, API responses, event bodies, delivery status, and logs.
**Consumer copy:** Hermes retains its verifier copy in its existing webhook-subscription configuration.
**Rejected alternatives:** A project-binding secret table, encryption-at-rest, `secretRef`, and runtime profile routing are rejected.

### TD-03 — Only `archon serve` dispatches external events

**Behavior:** CLI, detached, chat, and server workflow execution paths only enqueue external events.
**Dispatcher:** `archon serve` starts one in-process poller, performs an immediate drain at boot, polls on an interval, and prevents overlapping drains in the same process.
**Transport:** The poller posts to the binding's `event_route`, signs every attempt with Hermes V2, and sends the stable idempotency key as `X-Request-ID`.
**Delivery guarantee:** Delivery is at-least-once because a crash after Hermes accepts but before Archon records the response leaves the outbox event eligible for redelivery.
**Rejected alternatives:** Detached dispatch workers, a second daemon, queue infrastructure, cross-process leases, `SKIP LOCKED`, advisory election, and `LISTEN/NOTIFY` wake-up are rejected.

### TD-04 — External enqueue is best-effort and non-transactional

**Behavior:** External outbox enqueue follows the existing non-throwing workflow-event pattern and is independent from the workflow state transition.
**Failure semantics:** Enqueue failure is logged but never thrown into workflow execution, and the workflow transition is not rolled back.
**Accepted limitation:** A crash or database failure between the workflow transition and outbox enqueue can lose the external notification.
**Rejected alternatives:** Transactionally coupling workflow transitions to outbox rows, failing a transition because enqueue failed, and adding compensating durability machinery are rejected.

### TD-05 — Delivery-failed meta-events have a single recursion guard

**Behavior:** Delivery failure of an ordinary external event may enqueue `workflow.delivery.failed`.
**Terminator:** Failure to deliver an event whose `eventType` is already `workflow.delivery.failed` updates only that event's own attempt and retry state and never enqueues another failure event.
**Rejected alternatives:** Recursion-depth counters and unbounded failure-event chaining are rejected.

### TD-06 — Use one canonical external event vocabulary

**Behavior:** The external event types are `workflow.run.started`, `workflow.run.completed`, `workflow.run.failed`, `workflow.approval.requested`, `workflow.delivery.failed`, and `workflow.artifact.recorded`.
**Mapping:** Internal snake-case event names remain unchanged and are mapped only when an external outbox event is produced.
**Contract update:** Delivery-status fixtures using `workflow.completed` must use `workflow.run.completed` instead.
**Rejected alternatives:** Compatibility aliases and a third event vocabulary are rejected.

### TD-07 — Derive one stable idempotency key per logical event

**Behavior:** The idempotency key is `archon:<bindingName>:<eventId>`.
**Persistence:** It is created once at enqueue, persisted with the outbox row, reused unchanged across every attempt, returned by delivery status, and sent as `X-Request-ID`.
**Rejected alternatives:** The delivery fixture's `idm_*` form and minting a new key during redelivery are rejected.

### TD-08 — Emit `workflow.run.started`

**Behavior:** Story 3.5 maps the existing internal `workflow_started` lifecycle signal to `workflow.run.started`.
**Payload:** The start payload describes the Archon run state and start time without a fabricated phase or command correlation ID.
**Contract update:** FR-9, acceptance criteria, schema, and fixture prose must include the started event consistently.

### TD-09 — `phase` identifies the workflow node awaiting review

**Behavior:** `workflow.approval.requested.payload.approval.phase` contains the approval context's node ID or node name.
**Meaning:** The name remains generic `phase`, but its Archon meaning is the workflow phase represented by the node currently awaiting review rather than a BMAD lifecycle phase.
**Started event:** `workflow.run.started` emits no `phase` because no workflow node is awaiting review at run start.
**Rejected alternatives:** Renaming the field to `nodeId`, fabricating a BMAD phase, and using a constant phase are rejected.

### TD-10 — Build `projectRef` directly from the registered codebase

**Behavior:** `projectRef.id` is `codebase.id`, `projectRef.codebaseRef` is `codebase.name`, `projectRef.repositoryPath` is `codebase.default_cwd`, and optional `projectRef.defaultBranch` is `codebase.default_branch`.
**String refs:** `bindingRef.projectRef` and `workflowRunRef.projectRef` use `project:<codebase.id>`.
**Eligibility:** A run without a resolvable registered codebase and matching binding is not routable.
**Folder projects:** Registered folder projects are routable because `default_cwd` supplies their repository path even when `repository_url` is null.
**Rejected alternatives:** Parsing `repository_url`, synthesizing `git:` or `folder:` identities, using a worktree `working_path`, and emitting a Hermes-owned Project Binding ID are rejected.

### TD-11 — Do not compare binding versions or detect `stale`

**Behavior:** Story 3.5 does not compare Workflow Provider Binding versions between Archon and Hermes and does not implement binding-staleness detection or reconciliation.
**Local routing checks:** A binding is not routable when it is missing, disabled, points to a different codebase, or lacks the required route or signing secret.
**Routable states:** Both `active` and `rotated` bindings are routable using their currently stored route and secret.
**Version use:** `binding_version` remains binding lifecycle and audit data but is not a delivery-eligibility or signature input.
**Contract update:** Remove `stale` from Story 3.5 routing requirements.

### TD-12 — Use a separate external outbox

**Behavior:** Create `remote_agent_workflow_event_outbox` for Hermes-bound logical events and leave `remote_agent_workflow_events` unchanged.
**Identity:** External outbox events receive their own event IDs and do not reuse internal timeline row IDs.
**Production:** Relevant workflow lifecycle sites best-effort write the internal timeline event and external outbox event independently.
**Mappings:** `workflow_started`, `workflow_completed`, `workflow_failed`, `approval_requested`, and `workflow_artifact` map to their canonical external forms.
**Delivery failure:** `workflow.delivery.failed` is produced directly by the delivery subsystem and needs no internal source event.
**Rejected alternatives:** Scanning the internal timeline as a webhook queue and adding delivery columns to internal event rows are rejected.

### TD-13 — Remove delivery metadata from the event body

**Behavior:** Remove the optional `delivery` object and its `deliveryId`, `attempt`, and `receivedAt` fields from the event schema and all event fixtures.
**Ownership:** Attempt identity, timing, outcome, request, and response belong to the Story 3.5 delivery-attempt history and Story 3.7 status projection.
**Redelivery:** Every attempt sends the exact same serialized body; only the Hermes V2 timestamp and signature headers change.
**Rejected alternatives:** Guessing Hermes's receipt time and replacing `receivedAt` with another producer timestamp are rejected.

### TD-14 — Remove planning-only party metadata from event bodies

**Behavior:** Remove `intendedProducer`, `intendedConsumer`, and `owningSubproject` from the workflow event schema, runtime body, and fixtures.
**Reason:** These fields do not participate in routing, authentication, signature verification, idempotency, retry, workflow identity, or project identity.
**Scope:** Existing CLI command envelopes remain unchanged because they belong to earlier stories.
**Rejected alternatives:** Creating shared constants, moving CLI helpers into core, and importing CLI code from core are rejected.

### TD-15 — Delivery-status correlation belongs to the status query

**Behavior:** Story 3.5 persists no command correlation ID on workflow runs, event bodies, outbox rows, or delivery-attempt rows.
**Story 3.7:** A delivery-health query echoes a supplied correlation ID or generates one at query time, matching the existing CLI JSON convention.
**Durable identity:** `eventId`, `idempotencyKey`, and `workflowRunRef` identify the delivery and workflow independently of a query request.
**Rejected alternatives:** Persisting the start-command correlation ID and choosing one of several later workflow-control correlation IDs are rejected.

### TD-16 — Use eight attempts with deterministic backoff and append-only webhook history

**Retry limit:** The first delivery is attempt 1, failures 1 through 7 schedule delays of 1, 2, 4, 8, 16, 32, and 60 minutes, and failure 8 becomes `terminal-failure`.
**Policy shape:** The values are code constants with no configuration, jitter, separate scheduler, or HTTP-status-specific policy in v1.
**Retryable failures:** Network errors, timeouts, and all HTTP non-2xx responses follow the same retry schedule.
**Not-routable events:** Locally non-routable events are recorded as failed/not-routable and are not automatically retried.
**Current state:** The outbox persists current status, attempt count, last-attempt time, next-attempt time, and last error.
**Attempt history:** Create append-only `remote_agent_workflow_event_delivery_attempts` with one row for every HTTP attempt, successful or failed.
**Request snapshot:** Each attempt stores its number, actual full request URL, method, request headers, exact request body, and start time.
**Response snapshot:** Each attempt stores response status, response headers, exact response body, transport error when no response exists, completion time, duration, and explicit outcome.
**Outcome states:** An attempt starts as `pending`, ends as `succeeded` for HTTP 2xx or `failed` otherwise, and remains `pending` when a process crash makes the result unknowable.
**History invariant:** The dispatcher inserts the pending attempt before issuing HTTP; if that insert fails, it sends no webhook and leaves the outbox row eligible for a later drain.
**Redelivery:** Reproduction uses the stored target and exact body, preserves `eventId` and `idempotencyKey`, creates a new attempt row, and generates a fresh Hermes V2 timestamp and signature.

## Unresolved Decisions

None.

## Executable Proof Sketch

The implementation proof must exercise the real HTTP boundary with an independent verifier that follows the existing Hermes V2 implementation.
Tests must use deterministic clocks, local HTTP servers, isolated SQLite state, mocked PostgreSQL DB-layer behavior where required by the established project pattern, and no external network dependency.

1. Drive a registered-codebase workflow through started, approval-requested, completed, failed, and artifact paths, and prove only the accepted external mappings create outbox rows while the internal timeline remains unchanged.
2. Validate every emitted event body against the reconciled event schema and fixtures, including the direct codebase mapping, generic approval `phase`, canonical event type, and stable idempotency key.
3. Independently recompute Hermes V2 HMAC from the exact raw bytes and prove valid delivery succeeds, tampered bytes fail, a wrong secret fails, and a timestamp older than 300 seconds fails.
4. Force external enqueue failure and prove workflow state still starts, pauses, completes, or fails normally without a thrown enqueue error or rollback.
5. Exercise missing, disabled, mismatched-codebase, missing-route, and missing-secret bindings and prove no HTTP request occurs, while active and rotated bindings remain routable without version comparison.
6. Deliver one 2xx response and one HTTP failure plus one transport failure, and prove each attempt history row preserves the actual URL, exact body, request headers, response or transport error, timestamps, duration, and final outcome.
7. Force attempt-history insertion failure and prove the dispatcher sends no HTTP request, leaves the logical outbox event eligible, and does not affect workflow execution.
8. Advance a fake clock through failures 1 to 8 and prove the exact 1, 2, 4, 8, 16, 32, and 60-minute schedule, terminal failure on attempt 8, and persistence across server restart.
9. Redeliver a completed event and prove the raw body, `eventId`, and `idempotencyKey` are byte-for-byte stable while the attempt row, timestamp header, and signature header are new.
10. Crash the dispatcher after a test ingress accepts a request but before response-state persistence, leave the attempt outcome indeterminate, restart the server, and prove duplicate-safe redelivery uses the same logical event identity.
11. Force delivery of a `workflow.delivery.failed` event to fail and prove its own history and retry state update without another failure-event enqueue.
12. Run schema generation checks, contract validation, focused SQLite and PostgreSQL adapter tests, server poller tests, event producer tests, and finally `bun run validate`.

## Downstream Handoff

The technical design has no unresolved decision and has received explicit whole-file approval.
The gate is `PASS` with `reviewStatus: APPROVED` and is ready for `$bmad-create-story` handoff for Story 3.5.
Implementation must first reconcile the local schemas, fixtures, validator expectations, PRD, Architecture, and Epic wording with these accepted decisions.
Hermes consumer behavior outside the already implemented Generic Webhook V2 verification remains downstream work and does not expand Story 3.5.
