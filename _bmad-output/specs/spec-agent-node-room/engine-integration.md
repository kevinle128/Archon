# Engine integration

This document defines the boundary between durable steering state, the workflow executor, and provider adapters.

The node remains active while Stop ends one agent turn.

Durable guidance survives process loss, while a live SDK handle never pretends to be serializable.

## 1. Two coordinated planes

The steering design has a durable control plane and a volatile execution plane.

The durable control plane owns:

- the author's composer draft;
- the node-scoped guidance queue;
- server-assigned FIFO order;
- auto-send settings;
- delivery intent and delivery state;
- message identity and attribution;
- restart recovery evidence.

The volatile execution plane owns:

- the active provider process or SDK stream;
- the provider session handle;
- the active turn identifier;
- the fresh per-turn interrupt controller;
- the live idle-after-interrupt timer.

The durable store is authoritative for content and recovery.

The live registry is authoritative only for operations that require the active provider turn.

## 2. Stop uses the existing provider request contract

AgentRequestOptions.interruptSignal is the common Stop contract.

The implementation does not add cancel() to IAgentProvider.

The existing node-level abortSignal remains separate from Stop.

Each provider adapter observes interruptSignal and maps it to a verified native interrupt or safe stream-abort.

Claude maps it to the SDK query interrupt.

Codex aborts the active turn stream and continues through the existing thread or session resume path.

DeepSeek maps it to a provider-native turn abort that keeps the session available and retains its abort marker for executor classification.

OMP, Grok, Qoder CLI, Pi, GitHub Copilot, and OpenCode each implement their verified adapter-specific path.

A provider must not swallow an abort marker or abort exception that the executor needs to classify.

## 3. A fresh signal identifies one turn

Every provider turn receives a fresh turn-level signal combined with the node-level signal.

The active registry handle points to that turn and signal only while the turn exists.

Stop captures the intended active turn identity before firing the signal.

If that turn ended naturally before Stop arrives, the interrupt is spent and must not target the next turn.

The executor keeps a per-turn operatorInterrupt marker so it can distinguish operator Stop from provider failure.

The marker is reset before the next turn starts.

The executor skips structured-output validation and re-ask behavior for an interrupted partial turn.

Node-level termination continues to take precedence through the existing execution order.

## 4. Turn-end classification

The executor classifies each turn through provider-normalized evidence.

The required cases are:

1. A result without an abort marker is a natural end.
2. A result with a verified abort marker and an active operator interrupt is an interrupted end.
3. A verified abort exception with an active operator interrupt is an interrupted end.
4. An exception without an active operator interrupt is a provider or execution failure.
5. Node-level termination takes the existing terminal path.

An interrupted end writes the interrupted transcript evidence, does not validate the partial output, does not complete the node, and does not advance the DAG.

The node enters idle-after-interrupt and waits for Send now.

A natural end claims the next durable queued item when guidance is pending.

If auto-send is disabled, the normal Queue contract determines the next-turn batch.

If auto-send is enabled, the executor claims one FIFO item after each natural reply.

An interrupted turn never auto-sends.

## 5. Multi-turn continuation

A redirected node continues through the provider's existing session or thread resume seam.

The next operator prompt becomes the next turn on that session.

Queued guidance is claimed in durable server FIFO order.

The executor writes an operator transcript row when the provider delivery boundary is reached.

The row contains the caller-stamped message id and acting operator identity.

The transcript row is the audit receipt.

The queue record remains the delivery-control record.

## 6. Durable queue state

Queue acknowledgement is returned only after database commit.

Withdrawal is idempotent while an item remains claimable.

The durable state machine distinguishes at least draft, queued, awaiting-send-now, dispatching, sent, delivered, delivery-unknown, withdrawn, and failed outcomes.

A provider acknowledgement advances a message to delivered only when it carries the stamped message id or another explicitly verified provider identifier.

Text and timestamps are never delivery evidence.

If a process disappears after an item is claimed but before delivery can be proven, the item becomes delivery-unknown.

Archon never resends a delivery-unknown item automatically because the prior provider process may already have completed an external side effect.

## 7. Server restart recovery

Server startup reloads durable draft, queue, delivery, and auto-send data.

It does not claim that the prior provider process or active turn survived.

It does not autonomously complete, fail, cancel, or resume ambiguous non-terminal work.

The Node Room presents the restored data as read-only recovery state.

The operator invokes the existing Resume feature.

After Resume establishes a new live executor, the executor reuses a provider session only where the provider contract proves that continuation is safe.

Durable queued guidance remains ordered and is not silently discarded.

## 8. Idle-after-interrupt

The existing 30-minute inactivity decision applies only while the process actively owns a live idle-after-interrupt handle.

Composer activity re-arms that live timer.

Send now resolves idle-after-interrupt and starts the next provider turn.

A server restart removes the live timer and moves the UI to recovery-required state instead of letting a new process infer that the old timer expired.

## 9. Operator rows and additional transcript sources

The executor remains the sole appender of ordered node transcript rows.

Delivered operator guidance uses the existing text-row storage with additive metadata for origin, operator identity, and message id.

Successful Codex file-change events are normalized and persisted before the presentation layer.

Thinking, triggering prompts, and advisor notifications use explicit persisted discriminators and privacy rules.

RunStream, Chat, Node Room, and backend formatting consume the same semantic presentation contract.

## 10. Build order

1. Add the additive durable steering records and narrow steering-store contract.
2. Add typed draft, queue, auto-send, Stop, and recovery API schemas.
3. Move queue authority from the live registry to the durable store.
4. Implement the fresh per-turn interruptSignal path and end-cause classification.
5. Implement restart restoration through the existing Resume workflow.
6. Complete provider conformance for all approved providers.
7. Add cross-surface presentation and transcript-source persistence.
8. Verify SQLite and PostgreSQL upgrades, restart E2E, provider conformance, accessibility, and cross-surface parity.

## 11. Explicit exclusions

This design does not change the historical workflow Cancel feature.

This design does not add individual-tool cancellation.

This design does not change CLI --detach or add detached-specific Agent Node Room behavior.
