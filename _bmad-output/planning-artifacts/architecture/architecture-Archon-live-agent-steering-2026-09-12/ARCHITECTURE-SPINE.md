---
name: 'Live Agent Steering'
type: architecture-spine
purpose: build-substrate
altitude: feature
paradigm: 'ports-and-adapters with a durable control plane'
scope: 'Durable guidance, turn-level Stop, provider continuation, restart restoration, and truthful delivery capability across the approved providers.'
status: approved
created: '2026-09-12'
updated: '2026-09-21'
binds:
  - 'spec-agent-node-room CAP-8 through CAP-21'
  - 'Agent Node Room Epics 7 through 9'
  - 'HITL spine for authenticated mutations and ordered transcript writes'
  - 'Readable Agent Transcript spine for shared row meaning'
sources:
  - '../../../specs/spec-agent-node-room/SPEC.md'
companions:
  - '../../../specs/spec-agent-node-room/provider-steering-matrix.md'
  - '../../../specs/spec-agent-node-room/engine-integration.md'
  - '../../../specs/spec-agent-node-room/control-states.md'
  - '../../../specs/spec-agent-node-room/steering-api-contract.md'
  - '../../../specs/spec-agent-node-room/steering-test-plan.md'
---

# Architecture Spine — Live Agent Steering

Live steering lets an operator queue guidance, stop the current agent turn, and continue on the provider session while the node stays active.

Durable drafts and guidance survive process loss.

The provider process and active turn remain volatile.

After restart, Archon restores durable data and waits for the existing Resume action.

## Design paradigm

The feature uses ports and adapters with two coordinated planes.

The durable control plane is a narrow steering-store port with SQLite and PostgreSQL adapters.

The volatile execution plane is the workflow executor plus provider adapters.

The existing provider request contract carries both node-level abortSignal and turn-level interruptSignal.

The design does not add cancel() to IAgentProvider.

| Layer | Responsibility |
| --- | --- |
| Web shells | Composer, queue, Stop, recovery, auto-send, and accessible state presentation |
| Server routes | Authentication, validation, durable mutation, typed errors, and generated API contracts |
| Steering store | Drafts, settings, FIFO queue, delivery lifecycle, attribution, and restart restoration |
| Workflow executor | Queue claiming, turn loop, Stop classification, provider continuation, and transcript receipts |
| Provider adapters | Native interrupt or safe stream abort, session continuation, soft injection, and acknowledgement evidence |

## Inherited invariants

The executor remains the sole ordered writer of node transcript rows.

All database changes are additive in both SQLite and PostgreSQL.

The Web package consumes generated wire types and does not import workflow or server packages.

Console and Legacy use separate markup shells while shared semantic logic remains outside both shells.

Authentication resolves through the existing server identity seam.

Historical workflow Cancel behavior remains unchanged.

## AD-1 — Stop acts on one agent turn

Stop ends the current provider turn.

The node and workflow run remain active.

The provider session remains reusable where the provider supports continuation.

The active tool becomes interrupted rather than failed.

Completed writes and other completed side effects remain in place.

Stop never targets one selected tool and never implies rollback.

## AD-2 — interruptSignal is the provider port

AgentRequestOptions.interruptSignal is the provider-neutral Stop input.

Each provider adapter maps that signal to its verified native interrupt or stream-abort path.

The node-level abortSignal remains separate.

Each provider turn receives a fresh interrupt signal.

The executor binds Stop to an active turn identity so a late Stop cannot terminate the next turn.

Provider abort results and exceptions remain visible to executor classification.

## AD-3 — Durable control, volatile execution

The steering store owns drafts, settings, queued guidance, FIFO order, delivery state, attribution, and recovery evidence.

The live registry owns only the active provider handle, active turn identity, interrupt controller, and idle timer.

The registry is never the source of truth for queued content.

The store never claims to serialize a provider process or SDK stream.

## AD-4 — Persist before acknowledgement

Queue returns success only after the durable record commits.

The server assigns deterministic FIFO order.

Duplicate message ids replay the current receipt and never insert another item.

Withdrawal is idempotent while an item remains claimable.

The executor atomically claims items before provider delivery.

Confirmed delivery failure returns the item to the queue.

Process loss after claim produces delivery-unknown and never triggers automatic resend.

## AD-5 — Restart restoration uses existing Resume

Server startup restores drafts, settings, queue entries, and delivery state.

It does not infer whether the former provider turn completed.

It does not automatically complete, fail, cancel, or resume ambiguous work.

The UI exposes recovery-required state and keeps durable content readable.

The user invokes the existing Resume feature.

After Resume, the executor reuses the provider session only where the provider contract proves safe continuation.

## AD-6 — Natural and interrupted ends drain differently

A natural turn end validates normal output and can claim durable queued guidance.

The standard Queue path supplies the next-turn batch at the natural boundary.

Auto-send mode claims one FIFO item after each natural reply.

An interrupted turn does not validate partial output, does not complete the node, and does not advance the DAG.

It enters idle-after-interrupt and waits for Send now regardless of queued content.

An interrupted turn never auto-sends.

## AD-7 — Delivery evidence is explicit

A transcript operator row records delivered guidance in deterministic sequence.

The durable queue record remains the delivery-control record.

Sent means the provider call was initiated through the verified adapter boundary.

Delivered requires provider acknowledgement correlated to the stamped message id.

Delivery unknown means process loss prevented a trustworthy conclusion.

Text equality, timestamps, and transcript proximity are not delivery evidence.

## AD-8 — Capabilities follow conformance

Every approved provider must implement turn-level Stop.

Soft injection and delivery acknowledgement appear only when the production adapter path passes conformance.

The UI derives per-item Send now and delivery labels from capability data.

A queue-only provider remains fully supported and omits actions it cannot perform.

An unverified capability remains false until its current implementation story completes.

## AD-9 — Auto-send is durable and bounded

Auto-send is an explicit per-operator setting stored for the node.

It survives tab closure and server restart.

It sends one item after each natural reply in FIFO order.

Disabling auto-send preserves the queue.

A delivery error stops the drain and returns the affected item to the queue.

Stop always suspends auto-send until the operator uses Send now.

## AD-10 — Typed route errors describe state, not process origin

Draft and queue reads remain available during recovery-required state.

Mutations that need a live provider turn return a typed recovery-required conflict.

A finished node returns node_finished.

The API does not infer that a missing live handle means detached execution.

The client classifies by typed error code and never by prose.

## AD-11 — The executor writes the transcript receipt

Steering routes write durable steering records but do not append delivered operator rows.

The executor appends the operator row when the provider delivery boundary is reached.

The row carries origin, operator identity, and message id metadata.

The readable-transcript core projects the operator role and delivery status for every selected surface.

Successful Codex file-change events, thinking, triggering prompts, and advisor notifications enter the same ordered transcript architecture through explicit normalized records.

## AD-12 — Presentation is capability-driven

Console and Legacy render equivalent dock state with their own token roots.

The draft is author-scoped.

The queue is node-scoped and shared by authorized viewers.

Per-item Send now appears only for verified soft-injection providers.

Recovery-required state shows restored content and points to the existing Resume action.

Finished and finished-iteration views remain read-only.

No provider-branded dock variant is created when capability data can express the difference.

## Data model

The implementation adds one logical record set for per-operator draft and steering settings.

It adds one logical record set for node-scoped queued guidance and delivery lifecycle.

The exact table schemas are additive and must carry:

- workflow run and node identity;
- message identity;
- operator identity;
- content;
- server FIFO position;
- delivery intent and state;
- auto-send setting where applicable;
- created and updated timestamps;
- minimum failure and acknowledgement evidence required for recovery.

Delivered transcript receipts continue in the existing node-message store.

## Capability map

| Capability | Architecture owner |
| --- | --- |
| CAP-8 durable compose and queue | AD-3, AD-4, AD-12 |
| CAP-9 Stop current turn | AD-1, AD-2, AD-6 |
| CAP-10 continue same session | AD-2, AD-5, AD-6 |
| CAP-11 audit exchange | AD-7, AD-11 |
| CAP-12 verified soft injection | AD-8, AD-12 |
| CAP-13 truthful delivery | AD-7, AD-8 |
| CAP-14 restart restoration | AD-3, AD-5, AD-10 |
| CAP-15 auto-send | AD-6, AD-9 |
| CAP-16 cross-surface presentation | AD-11, readable-transcript spine |
| CAP-17 Git impact | readable-transcript spine and source-control architecture |
| CAP-18 all approved providers | AD-2, AD-8, provider matrix |
| CAP-19 thinking | AD-11, readable-transcript spine |
| CAP-20 triggering prompt | AD-11, readable-transcript spine |
| CAP-21 advisor notifications | AD-11, readable-transcript spine |

## Verification

The owning tests must prove additive schema upgrades, SQLite and PostgreSQL parity, FIFO behavior, concurrency, restart restoration, ambiguous-dispatch handling, provider conformance, cross-surface parity, accessibility, and both Node Room widths.

The restart E2E must use the same database before and after a real server restart and must terminate every process it starts.

## Explicit exclusions

This architecture does not change the historical Cancel feature.

This architecture does not add individual-tool cancellation.

This architecture does not change CLI --detach or add detached-specific Agent Node Room behavior.
