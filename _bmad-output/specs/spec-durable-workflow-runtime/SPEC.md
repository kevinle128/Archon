---
id: SPEC-durable-workflow-runtime
companions:
  - inheritance-contract.md
  - recovery-state-contract.md
  - provider-recovery-matrix.md
  - verification-matrix.md
  - ../spec-agent-node-room/SPEC.md
  - ../spec-agent-node-room/engine-integration.md
  - ../spec-agent-node-room/steering-api-contract.md
  - ../spec-agent-node-room/control-states.md
  - ../spec-agent-node-room/provider-steering-matrix.md
  - ../../planning-artifacts/architecture/architecture-Archon-live-agent-steering-2026-09-12/ARCHITECTURE-SPINE.md
sources: []
---

> **Canonical contract.** This SPEC and its companions define Durable Workflow Runtime as an independent feature. Agent Node Room remains a read-only predecessor: its operator-visible steering semantics are inherited, while only the process-local durability boundaries named in `inheritance-contract.md` are superseded.

# Durable Workflow Runtime

## Why

Archon currently runs web-dispatched workflows inside the API server process. The production full-deploy path, `./scripts/deploy-pm2.sh`, restarts the single PM2 app that owns that process and can therefore kill active provider streams while their durable run rows remain non-terminal. Durable Workflow Runtime separates execution lifetime from control-plane lifetime and gives interrupted work an honest, safe recovery path without reopening the Agent Node Room feature.

## Capabilities

- **CAP-1 — Survive control-plane restart**
  - **intent:** A workflow started through any supported entry point can keep executing while the API server restarts.
  - **success:** Running the production full-deploy command during a provider turn restarts the control plane but leaves the managed executor alive, does not create a second execution owner, and allows the run to reach its normal terminal state without replaying the active node.

- **CAP-2 — Reconnect observation and steering**
  - **intent:** Clients can reconnect to the executor that owns a live run even when it is not inside the API process.
  - **success:** After an API restart, durable event replay restores the current run/node view and Agent Node Room's Queue, Withdraw, Stop, Send now, and keepalive operations retain their established authorization, ordering, idempotency, and control-state semantics for a managed worker.

- **CAP-3 — Fence execution ownership**
  - **intent:** The system can identify the executor authorized to advance a run and prevent concurrent owners.
  - **success:** Every mutating execution write and control command is bound to one execution epoch; stale-epoch writes are rejected, proven-safe owner loss is recovered through one atomic epoch claim, and ambiguous ownership is surfaced without autonomous takeover or terminal mutation.

- **CAP-4 — Continue from a provider checkpoint**
  - **intent:** An interrupted in-flight node can continue from the last durable provider boundary when the provider supports it.
  - **success:** After proven owner loss, a clean durable checkpoint starts strict provider recovery automatically; it reuses the original provider and session/thread identifier, skips every completed DAG node, never treats partial text as completed output, and reports `restored`, `cold`, `unsupported`, `rejected`, or `unverified` continuity.

- **CAP-5 — Prevent unsafe replay**
  - **intent:** Recovery avoids silently repeating a tool or external action whose outcome is unknown.
  - **success:** An unmatched tool start or another uncertain effect blocks automatic replay and presents explicit continue-session, restart-from-checkpoint, and terminate choices with the known consequences of each.

- **CAP-6 — Preserve accepted guidance**
  - **intent:** Operator guidance accepted by a live node survives control-plane and executor disruption without duplication or reordering.
  - **success:** `message_id` deduplication, authenticated attribution, server receipt order, withdrawal, delivery receipts, and `Never sent` reconciliation remain deterministic after reconnect or recovery.

- **CAP-7 — Make recovery operable**
  - **intent:** Operators can understand and resolve interrupted execution from the established run and node surfaces.
  - **success:** Active, reconnecting, recovery-required, cold-fallback, and terminal outcomes are distinguishable and actionable through the shared Agent Node Room projection and supported CLI/API surfaces, without introducing a separate node-room design language.

## Constraints

- Durable Workflow Runtime is a new feature. It does not edit or reopen Agent Node Room's SPEC, epics, sprint status, or completed stories; `inheritance-contract.md` is the exhaustive override boundary.
- All newly dispatched web, adapter, webhook, and CLI workflows use the managed execution boundary. Legacy or externally owned executors remain explicitly unmanaged and may retain `not_steerable_here`.
- A normal `./scripts/deploy-pm2.sh` invocation is the production control-plane restart boundary. It may rebuild and restart the API/control plane, but it cannot terminate or indirectly signal active managed executors; the replacement API rediscovers their existing execution epochs. `--reload-workflows` remains a non-restart refresh and does not invoke recovery.
- Automatic ownership transfer requires one authoritative proof that the registered owner cannot still run: an exit record for its exact process identity, a changed trusted host boot identity, or a trusted OS/runtime probe that confirms the exact process identity is absent. A timeout, `last_activity_at`, heartbeat staleness, PID alone, unavailable evidence, or an inconclusive probe cannot authorize takeover.
- The trusted host boot identity comes from the OS or owning runtime, stays stable across Archon API and supervisor restarts, and changes only when processes from the prior host incarnation cannot survive. An identifier generated at application startup is not death evidence.
- Managed process identity binds the host boot identity, runtime-native process or instance identifier, and immutable process-start token. Recovery claims a new execution epoch atomically before starting a replacement, so competing coordinators cannot create concurrent owners.
- Proven owner loss starts recovery automatically only when a durable checkpoint exists and no effect is uncertain. Automatic provider recovery is strict: `cold`, `unsupported`, `rejected`, or `unverified` outcomes stop in `recovery-required` and cannot execute a fresh provider turn without operator action.
- SQLite remains the default and PostgreSQL remains supported. Schema evolution is additive-only in both dialects, and every added `NOT NULL` column has a default.
- Recovery reuses the run's original user identity, provider credentials, codebase or folder, isolation environment, branch, declared inputs, and frozen ENV overlay. Current configuration cannot silently replace the execution snapshot.
- Provider session identifiers are resumable secrets. They are stored only in their owning recovery record and only masked previews may enter broad logs or workflow events.
- A provider session/thread identifier must become durable as soon as the provider exposes it, not only after node completion.
- True resume, cold fallback, unsupported resume, and unverified resume are distinct outcomes. Fresh execution is never reported as restored continuity.
- Cross-process control commands carry authenticated operator identity, idempotency identity, deterministic receipt order, target execution epoch, and a typed result. Stale-epoch mutations fail closed.
- The API/worker control contract is versioned. Incompatible mutations fail closed while safe observation and completion of already-owned work remain available.
- Completed DAG nodes are never replayed, and partial provider output is never promoted to a completed node output.
- Agent Node Room's semantic distinction remains intact: Stop interrupts a provider turn, Cancel tears down the node/run path, and neither recovery nor interruption implies rollback of files or external effects.
- The feature remains single-tenant and same-install. Multi-tenant scoping and a distributed multi-host scheduler are outside this contract.
- Strict TypeScript, typed OpenAPI routes, provider capability validation, secret-safe observability, and the repository's existing validation gates remain mandatory.

## Non-goals

- Reconnecting the exact dead socket, byte stream, SDK generator, or subprocess.
- Guaranteeing exactly-once behavior for third-party side effects that expose no idempotency or outcome evidence.
- Redesigning Agent Node Room or changing its Queue, Withdraw, Stop, Send now, operator attribution, and transcript semantics.
- Turning Archon into a general distributed workflow cluster or introducing tenant-aware execution.
- Automatically recovering legacy runs whose owner cannot be established.
- Rolling back files, commands, network calls, or other effects already produced by an interrupted provider turn.
- Choosing a per-run worker versus a persistent worker pool; the architecture may choose either if it satisfies this contract.

## Success signal

An operator runs `./scripts/deploy-pm2.sh` while a provider is executing and, after the replacement API becomes healthy, sees the same worker, run, and node continue without duplicate work or lost steering. If the executor itself dies and Archon can prove both owner loss and replay safety, a single new epoch automatically restores the provider session; otherwise the run enters `recovery-required` and refuses unsafe replay until the operator chooses an explicit path.

## Assumptions

- The first release covers the five providers inherited from Agent Node Room: Claude, Codex, OMP, Grok, and DeepSeek. Other providers join through the same recovery capability contract.
- Managed API and worker processes share the single-tenant database and workspace storage on one install.
- Agent Node Room's accepted contract is the predecessor target even where its implementation stories have not landed yet; downstream planning must sequence integration against those dependencies.
