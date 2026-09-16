---
stepsCompleted:
  - step-01-document-discovery
  - step-02-prd-analysis
  - step-03-epic-coverage-validation
  - step-04-ux-alignment
  - step-05-epic-quality-review
  - step-06-final-assessment
status: complete
assessor: Codex
target: spec-agent-node-room
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-workflow-commander/prd.md
  - _bmad-output/planning-artifacts/prds/prd-workflow-commander/architecture.md
  - _bmad-output/planning-artifacts/architecture/architecture-Archon-readable-agent-transcript-2026-09-12/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/architecture/architecture-Archon-live-agent-steering-2026-09-12/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/prds/prd-workflow-commander/epics.md
  - _bmad-output/planning-artifacts/epics-agent-node-room/epics.md
  - _bmad-output/planning-artifacts/prds/prd-workflow-commander/ux.md
  - _bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md
  - _bmad-output/specs/spec-agent-node-room/SPEC.md
  - _bmad-output/specs/spec-agent-node-room/control-states.md
  - _bmad-output/specs/spec-agent-node-room/engine-integration.md
  - _bmad-output/specs/spec-agent-node-room/provider-steering-matrix.md
  - _bmad-output/specs/spec-agent-node-room/steering-api-contract.md
  - _bmad-output/specs/spec-agent-node-room/steering-test-plan.md
  - _bmad-output/specs/spec-agent-node-room/test-plan.md
  - _bmad-output/specs/spec-agent-node-room/todo-fold-contract.md
  - _bmad-output/specs/spec-agent-node-room/tool-presentation-contract.md
  - claude-design/design_handoff_node_room_transcript_steering/README.md
---

# Implementation Readiness Assessment Report

**Date:** 2026-09-15
**Project:** Archon
**Target:** `spec-agent-node-room`

## Document Discovery

The assessment uses the confirmed `spec-agent-node-room` specification bundle and its target epics document.
It also uses the current related architecture and UX sets, the node-room design handoff, and the project-wide PRD, architecture, epics, and UX documents as baseline constraints.

### PRD documents

- Whole document: `_bmad-output/planning-artifacts/prds/prd-workflow-commander/prd.md` (9,502 bytes; modified 2026-07-30 14:29 +07:00)
- No target-specific PRD or index-based sharded PRD was found.

### Architecture documents

- Whole baseline: `_bmad-output/planning-artifacts/prds/prd-workflow-commander/architecture.md` (16,984 bytes; modified 2026-07-22 20:51 +07:00)
- Current platform architecture: `_bmad-output/planning-artifacts/architecture/architecture-Archon-readable-agent-transcript-2026-09-12/ARCHITECTURE-SPINE.md` (32,700 bytes; modified 2026-09-15 19:15 +07:00)
- Current live-steering architecture: `_bmad-output/planning-artifacts/architecture/architecture-Archon-live-agent-steering-2026-09-12/ARCHITECTURE-SPINE.md` (42,832 bytes; modified 2026-09-15 21:08 +07:00)
- Older architecture sets dated 2026-09-05 and the source-control set are excluded as historical or unrelated.

### Epics and stories documents

- Whole baseline: `_bmad-output/planning-artifacts/prds/prd-workflow-commander/epics.md` (41,450 bytes; modified 2026-07-30 14:29 +07:00)
- Target document: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md` (42,743 bytes; modified 2026-09-15 21:14 +07:00)
- Source-control and workflow-run-view epic sets are excluded as sibling scopes.

### UX documents

- Whole baseline: `_bmad-output/planning-artifacts/prds/prd-workflow-commander/ux.md` (2,174 bytes; modified 2026-07-12 09:16 +07:00)
- Current target design: `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/DESIGN.md` (59,925 bytes; modified 2026-09-15 19:24 +07:00)
- Current target experience: `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md` (169,433 bytes; modified 2026-09-15 19:24 +07:00)
- UX sets dated 2026-08-31 and 2026-09-05 are excluded as historical or unrelated.

### Target specification bundle

- `_bmad-output/specs/spec-agent-node-room/SPEC.md`
- `_bmad-output/specs/spec-agent-node-room/control-states.md`
- `_bmad-output/specs/spec-agent-node-room/engine-integration.md`
- `_bmad-output/specs/spec-agent-node-room/provider-steering-matrix.md`
- `_bmad-output/specs/spec-agent-node-room/steering-api-contract.md`
- `_bmad-output/specs/spec-agent-node-room/steering-test-plan.md`
- `_bmad-output/specs/spec-agent-node-room/test-plan.md`
- `_bmad-output/specs/spec-agent-node-room/todo-fold-contract.md`
- `_bmad-output/specs/spec-agent-node-room/tool-presentation-contract.md`

The internal `.memlog.md` file is excluded.

### Design handoff

- `claude-design/design_handoff_node_room_transcript_steering/README.md` (30,070 bytes; modified 2026-09-15 19:16 +07:00)

### Discovery result

No whole-versus-index-sharded duplicate was found.
The baseline and target-specific documents serve different scopes, so they are not duplicates.
The absence of a target-specific PRD is a completeness warning, but the confirmed specification bundle supplies the target requirements for this assessment.

## PRD Analysis

The project-wide PRD and the canonical `spec-agent-node-room` bundle form the requirements source for this target.
The baseline PRD defines four Archon provider requirements that remain applicable.
The canonical target specification defines 13 capabilities for the agent node room.

### Functional Requirements

#### Baseline provider requirements

**FR-7: Register Generic Workflow Provider Bindings.**
Archon can create, update, inspect, rotate, disable, and diagnose provider-side Workflow Provider Binding records for a project or codebase using generic `provider` and `name` vocabulary.
Archon persists a reverse binding from project or codebase execution context to controller `provider`, controller `name`, and workflow event route.
Archon exposes binding status as parseable CLI JSON.
Archon exposes update through an explicit `binding.update` command surface; `binding.create` is not an update or upsert path.
Archon can represent missing, valid, stale, disabled, rotated, and conflicting binding states.
Archon returns machine-readable errors for malformed input or invalid lifecycle transitions.
Archon does not expose Hermes-specific command names or model fields.

**FR-8: Expose Provider Workflow Control Through CLI JSON.**
Archon exposes start, status, approve, reject, resume, retry, and cancel for workflow runs through CLI JSON.
Archon returns parseable JSON for every state-changing control result.
Every result includes schema version, success flag, correlation id, workflow run reference when applicable, binding reference when applicable, machine-readable result payload, and machine-readable error shape when failed.
Archon returns machine-readable classifications for malformed requests, unexpected states, internally caught timeouts, and every other failure it catches before responding.
The subprocess consumer classifies empty output or uncatchable process exit as unexpected exit, malformed or schema-invalid output as schema mismatch, and a consumer-enforced timeout as timeout.
Archon does not expose a state-changing HTTP control path for Workflow Commander v1.

**FR-9: Produce Signed Typed Workflow Events.**
Archon emits signed typed workflow events for workflow start, workflow completion, workflow failure, approval requested, delivery failed, and artifact events through a non-blocking outbox.
Archon writes eligible events to durable outbox state before delivery.
Workflow execution continues even when later event delivery fails.
Every event body includes schema version, event id, event type, occurred timestamp, provider binding reference, workflow run reference, project or codebase reference, and idempotency key.
Signature metadata travels in HTTP headers.
Archon uses stable event id and idempotency key values so consumers can classify duplicate-safe delivery.
Archon produces events that shared event-envelope and rejection fixtures can validate.

**FR-10: Surface Provider Event Delivery And Outbox Health.**
Archon reports workflow event delivery and outbox health as structured status.
Archon persists delivery status, retry status, last attempt time when available, last error category, terminal failure state, and affected workflow run reference.
Archon reports healthy, delayed, retrying, failed, duplicated, terminal failure, and reconciliation-pending states when known.
Archon exposes delivery status through CLI JSON.
Archon does not block workflow execution only because event notification failed.

#### Agent node room requirements

**FR-ANR-1: Scan a node's work without expanding anything.**
A reader can scan a node's tool calls one line each and tell what ran, what it ran on, and whether it worked.
A node with 40 tool calls renders 40 single-line rows.
Each row has a family chip, a status glyph, a headline that names the salient argument, and right-aligned badges.
Successful calls are collapsed on first render, failed calls are expanded, and no collapsed row contains serialized-data punctuation.

**FR-ANR-2: Expand a call into a body shaped for that tool family.**
Every family renders its declared body arm from `tool-presentation-contract.md`.
A tool that matches no family renders at most three scalar `key: value` pairs.
Objects and arrays collapse to `{…}` or `[n]`, and the fallback never renders a JSON dump.
The generic fallback must represent less than 2% of rows in the production corpus.

**FR-ANR-3: Present the current checklist as state.**
Both provider todo shapes normalize to the same `TodoPhase[]` contract.
The checklist renders once at the last todo call, and earlier todo calls collapse to one-line rows.
A phase that `rm` empties disappears.
A pinned todo strip mirrors the current `TodoPhase[]` at the top of the transcript panel and stays visible while the transcript scrolls.
The strip is absent when the node has no todos.

**FR-ANR-4: Present subagent dispatch content.**
Both provider task shapes normalize to `TaskSubtask[]`.
The task card renders batch context as Markdown when the provider supplies it.
It then renders one collapsible card for each subtask and names the subtask and agent.

**FR-ANR-5: Present file edits as inline changes.**
When a payload contains before and after content, the node room renders a line diff through `react-diff-view`.
Claude edit payloads qualify because both values are required.
Codex payloads do not qualify and fall back to a path and preview.
The system never fabricates a diff from only one side.

**FR-ANR-6: Distinguish attempts and loop iterations.**
A node whose rows span more than one `occurrence_id` renders a header for each group.
A node with one occurrence renders no group header.
Grouping uses `occurrence_id`, never `attempt_id`.
A loop-iteration selector navigates directly between occurrence groups and is absent for a single occurrence.

**FR-ANR-7: Keep exact raw payloads available.**
Every tool card has a Raw toggle that reveals the original JSON.
The toggle is closed by default.
This is the only place that serialized JSON appears.
The existing full-output loading flow continues to work.

**FR-ANR-8: Compose while the agent works.**
The composer is mounted and enabled while the node runs.
The send control reads `Queue` while the agent generates.
Queueing holds the message without disturbing the node or interrupting a tool call.
The message is delivered as the next turn when the current turn ends naturally.
The interface states that this draft queue is per tab.

**FR-ANR-9: Interrupt the current agent turn without stopping the node.**
The stop control ends the agent's current turn through the provider interrupt primitive or a stream abort.
The provider session stays alive and the node stays `running`.
The agent moves to the projected `idle-after-interrupt` sub-state.
The node never becomes paused, pending, or failed only because of the interrupt.
The transcript presents the in-flight tool call as interrupted, not failed.
The existing Cancel feature remains separate and unchanged.
The interface does not imply that completed file writes were undone.

**FR-ANR-10: Redirect on the same live session.**
When the agent is `idle-after-interrupt`, the send control reads `Send now`.
Sending delivers all queued messages plus the newly typed message in written order as the next turn on the same provider session.
The node continues without a node-level resume transition.
The system enforces message order.
Both controls follow the projected agent sub-state.

**FR-ANR-11: Preserve the operator exchange in the transcript.**
Operator messages and the interrupted tool call appear as ordinary transcript rows in occurrence order.
The operator row is visibly different from agent text.
The reader must recognize `origin='operator'` before the write path emits operator rows.
The reader must fold the cross-provider `interrupted` status row into the preceding tool call before the write path emits that status.

**FR-ANR-12: Deliver at the fastest supported provider boundary.**
An operator message is an ordinary prompt, not a separate steer primitive.
Every provider supports the Queue floor and delivers at the next natural turn boundary.
A provider with an exercised open-stream input can soft-inject the prompt before turn end without interrupting the tool call or emitting a turn-start event.
Claude soft-inject remains spike-gated.
The v1 release floor is interrupt plus Queue for every in-use provider.

**FR-ANR-13: Report only verified message delivery.**
A message reads `sent` until the provider echoes the caller-stamped id.
It reads `delivered` only after that echo.
Correlation uses the id only.
At the inherited provider pins, every provider remains at `sent`.
Claude-only delivered confirmation becomes available only after the required SDK upgrade.

**Total functional requirements: 17.**

### Non-Functional Requirements

#### Baseline PRD non-functional requirements

**NFR-1:** Workflow events accelerate delivery but are not the only source of truth.

**NFR-5:** Archon events must be signed and schema-versioned so consumers can reject invalid events.

**NFR-6:** Event secrets and signature metadata must support binding-scoped validation by the consumer.

**NFR-9:** Archon persists workflow commands, workflow events, and delivery state with enough detail for audit.

**NFR-14:** Archon error and delivery-health responses expose diagnostic categories and machine-readable detail instead of raw stack traces.

**NFR-15:** Archon stays within provider ownership boundaries and does not reach into Hermes-owned concerns.

**NFR-16:** Provider integration surfaces remain generic provider surfaces.

**NFR-17:** The local handoff is complete enough for isolated Archon implementation agents.

#### Agent node room non-functional requirements

**NFR-ANR-1: Compatibility.**
The read half uses only data already stored in the database.
It introduces no schema change, migration, or backend change, and it improves historical runs without a rerun.

**NFR-ANR-2: Surface parity.**
Legacy and Console ship together.
Shared logic stays in `packages/web/src/lib/`, and the two surfaces use thin separate JSX.

**NFR-ANR-3: Package boundaries.**
`@archon/web` does not import from `@archon/workflows`.
Console does not import from `@/components/`.
Wire types come through generated API types and `lib/api.ts`.

**NFR-ANR-4: Type and build quality.**
The work uses strict TypeScript, contains no unjustified `any`, produces zero ESLint warnings, and passes `bun run validate`.

**NFR-ANR-5: Accessible status.**
Every status has a glyph that is decodable without color.
Color can reinforce status but cannot carry status alone.

**NFR-ANR-6: Accessible controls.**
The interrupting control uses `aria-disabled` instead of the native `disabled` attribute so focus does not move to the document body.
State changes use polite live-region announcements, delivery failure uses `role="alert"`, Ask-blocked Send uses `aria-describedby`, Enter inserts a newline, and reduced-motion preferences are respected.

**NFR-ANR-7: Bounded presentation.**
A chip uses the provider tool name only when it is one token of at most 24 characters.
Longer names use the family name and are never truncated into a misleading chip.
Path headlines elide in the middle, and command and pattern headlines elide at the end.

**NFR-ANR-8: Provider-neutral rendering.**
Tool identification uses exact normalized tokens and duck typing over alias sets.
It never uses substring matching or a provider-name branch inside a renderer.
Provider shape differences normalize at the edge.

**NFR-ANR-9: Deterministic diff cost.**
The synchronous diff rejects inputs above a byte ceiling and uses an explicit `maxEditLength`.
The same input pair produces the same result on every machine.
The system falls back to path and preview when a bound is exceeded.

**NFR-ANR-10: Interrupt latency.**
In-process interrupt acknowledgement has no database polling floor and is expected to be sub-second.

**NFR-ANR-11: Lifecycle safety.**
Steering acts only on the live provider turn.
It does not mutate node lifecycle state and it does not use the one-shot Cancel controller.
Cancel wins if Cancel and operator interrupt happen together.

**NFR-ANR-12: Failure correctness.**
An interrupted partial turn is not validated, completed, or advanced.
Abort-marked results and abort throws become interrupted ends only when the operator-interrupt flag is set.
Other throws remain real failures.

**NFR-ANR-13: Ordering and concurrency.**
Message order is the registry receipt order across operators and preserves each sender's written order.
The system does not add a per-node steering lock.

**NFR-ANR-14: Process boundary.**
Steering is in-process only for v1.
Detached runs and runs whose live handle is in another process return a clear `not_steerable_here` result.

**NFR-ANR-15: Ephemeral steering state.**
The live handle, inbound queue, and in-memory turn id exist only while the node runs in the current process.
The feature adds no durable steering marker, phase, compare-and-swap key, or attempt key.

**NFR-ANR-16: Audit attribution.**
The executor is the sole writer of operator transcript rows.
Each row contains `origin='operator'`, the authenticated operator user id, and the caller-stamped message id.

**NFR-ANR-17: Security.**
Steering routes use `resolveAuthContext`.
Any authenticated identity can steer and is attributed, unauthenticated access fails, and identity-less installations remain supported.
This grant does not change retry, cancel, approve, or other route permissions.

**NFR-ANR-18: Idempotency.**
Duplicate message ids replay the original receipt without adding a second queue entry.
Repeated interrupt in `idle-after-interrupt` is a no-op.
Every rejected request leaves the node, queue, and transcript unchanged.

**NFR-ANR-19: Loss prevention.**
Failed delivery returns messages to the front of the client queue.
Terminal reconciliation runs only after a terminal event and restores unmatched sent ids as `Never sent`.
It never reconciles on a live refetch.

**NFR-ANR-20: Idle-await bound.**
Idle-await fails after 30 minutes of genuine operator inactivity.
Authorized composing activity re-arms the timer without resolving idle-await.
Send now, cancel polling, and timeout resolve the wait exactly once.
A retry after this failure uses a fresh session.

**NFR-ANR-21: Release gates.**
The v1 release includes interrupt, Queue, and sent state for every in-use provider.
Claude delivered confirmation, Claude soft-inject, and Grok hooks are independent post-v1 gates and do not block v1.

**NFR-ANR-22: Corpus quality.**
The generic fallback rate must stay below 2% of production tool rows.
A read-only release audit records the live numerator, denominator, fraction, and corpus snapshot date.

**Total non-functional requirements: 30.**

### Additional Requirements

**AR-1: Tool presentation contract.**
One pure, React-free, provider-neutral module returns `ToolPresentation` for both node rooms.
It resolves families in four ordered tiers: exact normalized alias, input-key duck typing, name-only command handling, and a bounded generic fallback.
No resolver tier produces a default JSON dump.

**AR-2: Exact alias behavior.**
The resolver must cover the measured aliases `run_terminal_command`, `search_replace`, `read_file`, `search_tool`, and `list_dir`.
It must match exact tokens so `search_replace` resolves as file write and not content search.

**AR-3: Glob and grep semantics.**
Claude glob uses `pattern` as its headline and `path` as its scope, while OMP glob uses `path` as its pattern.
Grep uses `output_mode` to select matches, paths, or generic count output, and an absent mode on OMP means content matches.

**AR-4: Codex command presentation.**
The resolver strips fixed zsh or bash login-shell wrappers before it selects the headline.
A multiline command uses the first non-empty line as the headline and keeps the full original name in the terminal body and Raw view.

**AR-5: Inline diff implementation.**
`packages/web/src/lib/diff-hunks.ts` is the only caller of `structuredPatch` from the installed `diff` dependency.
It handles no-newline markers wherever they occur, preserves line counters, and feeds the existing git-hunk adapter.
The adapter moves into `packages/web/src/lib/` so Console can use it without crossing its import boundary.

**AR-6: Occurrence grouping.**
The shared layer groups by `occurrence_id` and labels with retry epoch and loop ancestry.
It does not group by `attempt_id`.

**AR-7: Todo fold.**
Claude todo state is last-call-wins in a single `Tasks` phase.
OMP todo state supports the nine named operations, all-targeting bare done, drop, and remove operations, auto-promotion after every operation, inferred operations when `op` is absent, and legacy batched operations.
Unknown operations do not change state, completed or abandoned tasks do not reopen, and empty phases disappear.

**AR-8: Task normalization.**
OMP batch tasks and Claude single-agent dispatches normalize into `TaskSubtask[]` without provider branches in either renderer.

**AR-9: Shared history shape.**
`buildAgentHistory()` returns transcript items plus node-level `TodoPhase[]`.
Tool items carry their presentation, exit code, and occurrence identity.
Operator text and interrupted status rows are recognized in the shared layer before either renderer consumes them.

**AR-10: Turn signals.**
Every provider turn receives `AbortSignal.any` over the persistent node-level Cancel signal and a fresh per-turn steering signal.
The operator-interrupt flag stops validation and structured-output re-ask, resets before the next turn, and is handled after the Cancel check.

**AR-11: End-cause classification.**
Natural results, abort-marked results, abort throws, real throws, and Cancel are distinct cases.
Natural completion can auto-drain a queued message.
An operator-interrupted end always enters idle-await and drains only after `Send now`.

**AR-12: Loop-node support.**
AI loop nodes are steerable in v1.
`Send now` continues the interrupted iteration on the same session before normal loop-completion evaluation.

**AR-13: Live registry.**
The registry key is `(runId, nodeId)` and its value holds the live session handle, active per-turn interrupt handle, inbound queue, receipt ordering, and inactivity wait control.
It registers at node start and tears down on every terminal outcome.

**AR-14: Two queues.**
Before dispatch, messages stay only in the per-tab browser draft queue where keep and delete are local actions.
The client dispatches them at the natural drain boundary or on `Send now`.
After dispatch, messages enter the live registry queue.

**AR-15: Steering API.**
The server registers typed OpenAPI routes for send, interrupt, and keepalive.
Send accepts a non-empty message, caller UUID, and `queue` or `send_now` intent.
Interrupt and keepalive accept empty bodies.
The success and error response unions match `steering-api-contract.md`.

**AR-16: Steering status codes.**
The routes use 400 `invalid_request`, 401 or 403 identity errors, 404 `not_found`, 409 `node_finished`, and 422 `not_steerable_here`.
The client distinguishes terminal conflict from the detached-process capability limit.

**AR-17: Steering races.**
A send during interrupt waits for `Send now`.
A turn that ends before interrupt returns the actual projected state.
The teardown queue check is the final gate before a route mutation.

**AR-18: Transcript receipt.**
The executor writes an ordinary `text` row with additive strict metadata and a separate cross-provider interrupted status row.
It emits no steering turn-start event.
Read-time identity projection supplies `operator_display_name`, with a short operator id as the fallback.

**AR-19: Provider floor.**
Claude uses native interrupt, Codex uses stream abort and resumed thread, OMP abort throws and then resumes its session, DeepSeek returns an abort-marked result and keeps the warm connection, and Grok uses stream abort.
Adapters do not suppress provider abort results or throws that the executor must classify.

**AR-20: Required verification.**
The work requires table-driven read tests with Claude and OMP fixtures, provider interrupt fixtures for every in-use provider, turn-loop coverage for normal and AI loop nodes, fake-timer idle-await tests, route and actor-grant tests, terminal reconciliation tests, process-boundary tests, and end-to-end checks on Legacy at 460 pixels and Console at its panel width.
The root validation command is `bun run validate`; root `bun test` is not a valid signal.

### PRD Completeness Assessment

The baseline PRD is complete for the older Workflow Commander provider scope but does not describe the agent node room.
The canonical `spec-agent-node-room` bundle acts as the target PRD extension and contains clear capabilities, success conditions, constraints, typed route contracts, engine rules, provider rules, and test obligations.
The target requirements are implementation-specific and traceable enough for epic coverage validation.
The main document-structure weakness is that target product requirements live in a specification bundle instead of a target PRD.
This structure does not prevent assessment because `SPEC.md` explicitly declares the bundle canonical and complete.

## Epic Coverage Validation

### Epic FR Coverage Extracted

The project-wide epic baseline maps FR-7 through FR-10 to Epic 3.
The target epic maps CAP-1 through CAP-13 to Epic 1, its implementation stories, and three explicit post-v1 gates.

### Coverage Matrix

| FR Number | PRD Requirement                                            | Epic Coverage                                                                      | Status                              |
| --------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------- |
| FR-7      | Generic Workflow Provider Binding lifecycle                | Epic 3, Story 3.1                                                                  | Covered                             |
| FR-8      | Workflow controls through validated CLI JSON               | Epic 3, Stories 3.3a, 3.3b, 3.3c, and 3.3d                                         | Covered                             |
| FR-9      | Signed typed workflow events through a non-blocking outbox | Epic 3, Story 3.5                                                                  | Covered                             |
| FR-10     | Structured event delivery and outbox health                | Epic 3, Story 3.7                                                                  | Covered                             |
| FR-ANR-1  | Scannable one-line tool rows                               | Epic 1, Story 1.1                                                                  | Covered                             |
| FR-ANR-2  | Family-shaped expanded bodies and bounded fallback         | Epic 1, Story 1.2                                                                  | Covered                             |
| FR-ANR-3  | Folded todo state and pinned todo strip                    | Epic 1, Story 1.4                                                                  | Covered                             |
| FR-ANR-4  | Normalized subagent dispatch cards                         | Epic 1, Story 1.5                                                                  | Covered                             |
| FR-ANR-5  | Inline file-edit diff with safe fallback                   | Epic 1, Story 1.3                                                                  | Covered                             |
| FR-ANR-6  | Occurrence grouping and loop-iteration selector            | Epic 1, Story 1.6                                                                  | Covered                             |
| FR-ANR-7  | Raw payload escape hatch                                   | Epic 1, Story 1.1                                                                  | Covered                             |
| FR-ANR-8  | Compose and Queue while the agent generates                | Epic 1, Stories 1.7b, 1.8, and 1.9                                                 | Covered                             |
| FR-ANR-9  | Interrupt the current turn without stopping the node       | Epic 1, Stories 1.7a, 1.7b, 1.8, and 1.10                                          | Covered                             |
| FR-ANR-10 | Redirect and continue on the same live session             | Epic 1, Stories 1.7b and 1.10                                                      | Covered                             |
| FR-ANR-11 | Operator exchange in the ordered transcript record         | Epic 1, Stories 1.1, 1.11, 1.12a, and 1.12c                                        | Covered                             |
| FR-ANR-12 | Queue floor and provider-gated mid-turn delivery           | Epic 1 Queue floor in Stories 1.7b and 1.9; soft-inject in post-v1 gates G2 and G3 | Covered with explicit post-v1 gates |
| FR-ANR-13 | Sent state and provider-confirmed delivered state          | Epic 1 sent floor in Story 1.11; delivered in post-v1 gate G1                      | Covered with explicit post-v1 gate  |

### Missing Requirements

No functional requirement is absent from the epic set.
The target epic also includes route transport, race handling, terminal reconciliation, idle-await safety, display-name projection, and concurrent-operator ordering.
These are implementation support requirements derived from CAP-8 through CAP-13 and are not orphan product scope.

The post-v1 placement of G1, G2, and G3 does not create a coverage defect.
The canonical specification classifies them as external-gated backlog and defines the v1 completion floor as interrupt, Queue, and sent state on every in-use provider.

### Coverage Statistics

- Total PRD functional requirements: 17
- Functional requirements covered in epics or explicit gated backlog: 17
- Functional requirements with no implementation path: 0
- Coverage: 100%

## UX Alignment Assessment

### UX Document Status

Complete UX documentation exists.
`DESIGN.md` and `EXPERIENCE.md` are marked final and cover both Legacy and Console.
The design handoff supplies four high-fidelity HTML references and explicitly gives precedence to the canonical specification and UX spines.
The target architecture has separate read and steering spines that support the main UX data and control paths.

The project-wide `ux.md` is a headless UX contract for Workflow Commander only.
It is not the target UX source for the agent node room.

### Confirmed Alignment

- CAP-1 through CAP-7 align with the functional-core and two-shell architecture.
- The architecture provides shared tool presentation, todo folding, task normalization, occurrence grouping, bounded diff generation, and raw-payload access.
- CAP-8 through CAP-13 align with the live-session registry, per-turn interrupt signal, multi-turn executor loop, typed steering routes, operator transcript row, projected agent sub-state, and provider capability gates.
- Both node rooms use the same render-neutral data and separate thin JSX.
- UX states correctly keep the node `running` during operator interrupt and keep Cancel separate.
- UX states cover generating, interrupting, idle-after-interrupt, natural-finish races, terminal reconciliation, idle-await failure, Ask-blocked nodes, old executions, cold load, and detached runs.
- Performance support exists through the bounded diff algorithm, the low-cost eager presenter, single-line rows, width-pressure rules, and capped internal panels.
- The test plans cover both shells, 460-pixel Legacy width, Console width, keyboard focus, live-region behavior, reduced motion, provider differences, and terminal reconciliation.

### Apparent Conflicts Reconciled

#### Headless Workflow Commander and the web node room

The baseline PRD Product Boundary says, “Workflow Commander v1 is headless” and calls the absence of Archon Web screens an explicit boundary.
This is a normative constraint for the Workflow Commander provider slice.

The target specification Constraints says, “Both node rooms (Legacy + Console) ship together.”
This is a normative constraint for the separate agent-node-room feature.

One implementation can satisfy both claims by keeping Workflow Commander headless while changing the existing node-room web surfaces under the separate target specification.
The claims bind different product slices and are not mutually exclusive.
This is not a conflict.

#### Pre-merge capability identifiers

The adopted steering architecture and UX documents use steering CAP-1 through CAP-6.
The canonical target specification defines an authoritative mapping from those identifiers to CAP-8 through CAP-13.
The old identifiers describe provenance, while the target identifiers describe the merged contract.
This is not a coverage or behavior conflict.

#### Prototype-only per-item Send now

The design handoff shows a per-item `Send now` control for soft-inject transports.
The canonical control-state contract forbids that control at the v1 Queue floor.
The handoff classifies the control as post-v1 G2 and explicitly states that it remains absent until the provider spike clears.
These are a v1 default and a gated future mode, so they are not mutually exclusive.

### Alignment Issues

#### UX-A1 — Queue ownership is contradictory

The live-steering architecture AD-3 says, “Queue (default, any provider): the registry holds the message.”
The architecture flow diagram also labels Queue as “hold in registry.”
These are normative runtime architecture claims.

The same architecture AD-11 says, “While the agent is generating, a message pressed to Queue is held client-side ... no server call,” and that the message enters the registry only at the drain moment.
The steering API contract Routes section and Epic Story 1.9 repeat this client-only pre-dispatch model.
These are normative API and behavior constraints.

An implementation cannot hold the same pre-dispatch message only in the client with no server call and also hold it in the server registry.
Mirroring it in both places does not reconcile the claims because AD-11 explicitly forbids dispatch at Queue press.

The detailed and later owner-ratified contract selects the client draft queue, followed by registry dispatch at the drain moment.
AD-3 and the architecture flow diagram must use that same model before implementation.

**Severity:** High.

#### UX-A2 — The WCAG floor conflicts with accepted shortfalls

The target epics NFR8 says, “Accessibility floor WCAG 2.2 AA,” including color-free status and the contrast floors in `DESIGN.md`.
The UX EXPERIENCE Accessibility Floor also says, “WCAG 2.2 AA is the target on both surfaces.”
These are normative minimum-quality constraints.

The DESIGN Open Questions resolution accepts Legacy error text at 4.3:1 and accepts the interactive tool row at 22 pixels, two pixels below the cited SC 2.5.8 minimum.
These are explicit visual-contract exceptions.

The current requirements do not classify WCAG AA as aspirational or permit named exceptions.
One implementation cannot both meet the stated minimum in full and preserve accepted non-compliant values unchanged.
The reconciliation attempt fails because the documents themselves identify these values as shortfalls instead of compliant uses of a WCAG exception.

The team must either change the two visual values to meet the stated floor or narrow NFR8 to list approved exceptions.
The quality-first option is to make the values compliant.

**Severity:** High.

#### UX-A3 — The canonical draft-box token contract has two backgrounds

The DESIGN frontmatter sets the draft box background to `surface-inset` and describes a capped inset panel.
The DESIGN Components amendment says the adopted queue is a full-width `surface-elevated` band and that the composer field is the only inset well.
Both are normative visual-token claims inside the canonical design document.

A root queue surface cannot be both `surface-inset` and `surface-elevated`.
A nested interpretation does not reconcile the claims because the adopted text says that the composer field remains the only inset well.

The later adopted amendment and the design-handoff reconciliation select the full-width `surface-elevated` band.
The stale frontmatter and the earlier draft-box description must be updated to match it.

**Severity:** Medium.

#### UX-A4 — The read architecture closes the shell-behavior list before later UX additions

Read architecture AD-12 says that exactly five behaviors are shell-owned, that anything else belongs to the core, and that later shell behavior requires an amendment.
This is a normative architecture ownership constraint.

The target SPEC and final UX add an interactive pinned todo strip and a loop-iteration selector.
These are normative UX requirements with DOM state and navigation behavior in both shells.

The existing core outputs already supply the required `TodoPhase[]` and occurrence groups, so no new architecture mechanism is missing.
However, the closed AD-12 shell list is no longer accurate.
This is an alignment warning rather than a missing implementation path.

**Severity:** Medium.

### Warnings

- The live-steering architecture frontmatter still points to the superseded pre-merge specification and does not list the steering API contract or steering test plan as companions.
- The read architecture predates the owner-confirmed pinned todo strip and loop-iteration selector.
- The design handoff contains prototype states that are not v1 behavior, although its precedence and gate notes are clear.
- `DESIGN.md` records an unrelated shipped Legacy Ask-card Submit contrast defect at 3.1:1.
  That component is outside this target, but the repository quality policy requires the implementation team to address visible lint, test, accessibility, and UI defects that it encounters.

### UX Alignment Result

The UX is comprehensive and the architecture supports the required feature shape.
Implementation should not start from the current documents until UX-A1 and UX-A2 are resolved.
UX-A3 and UX-A4 should be corrected in the same documentation pass so visual and ownership guidance stays deterministic.

## Epic Quality Review

### Epic Structure and User Value

The project-wide Epic 3 is organized around the user-visible outcome of running Workflow Commander through Archon with governed control, signed events, and health visibility.
Its cross-project prerequisites are explicit, and its stories do not depend on future stories.

The target Epic 1 is organized around one user-visible outcome: an operator can read and steer a live agent node in both node-room shells.
The read half delivers incremental reader value through Stories 1.1 through 1.6.
The steering half reaches its first complete operator flow in Stories 1.9 and 1.10 after the engine and transport enablers in Stories 1.7a, 1.7b, and 1.8.

The one-epic target shape is coherent because the transcript reader supplies the operator and interrupted rows that the steering flow needs.
The post-v1 gates G1 through G3 are explicit backlog projections and are outside the v1 completion gate.

### Story Dependencies and Sequencing

No forward dependency was found in either epic set.
Database and metadata work appears in the first story that needs it.
The target is a brownfield feature, so it does not need a starter-template or repository-setup story.

One declared dependency is incomplete.
Story 1.8 depends only on Story 1.7a, but its interrupt-race acceptance criterion requires the `generating` and `idle-after-interrupt` projection, natural-end auto-drain, and multi-turn result that Story 1.7b owns.
This issue is recorded as EQ-M4 below.

### Critical Violations

#### EQ-C1 — CAP-8 has no implementable natural-boundary dispatch path

Story 1.9 says that Queue holds a message only in the per-tab client draft box, makes no server call, and dispatches the batch automatically when the current turn ends naturally.
The steering API contract Routes section repeats that the send route is called at the natural turn boundary and never at Queue press.
These are normative client and API constraints.

The engine integration Natural end rule says that the executor checks the in-process registry queue at turn end, starts turn N+1 when that queue has a message, and completes the node when that queue is empty.
The live-steering architecture AD-4 states the same terminal rule.
These are normative runtime constraints.

The browser-held message is not in the registry when the executor makes its terminal decision.
No document defines a pre-completion boundary event, acknowledgement, grace period, or handshake that lets the browser dispatch the message before the executor sees an empty registry queue and completes the node.

The reconciliation attempt considered using a normal post-turn client event as the trigger.
That attempt fails because the server owns the immediate queue check and terminal transition, and the contracts provide no deterministic window in which the client send must arrive first.
Dispatching at Queue press would close the race, but it would violate the explicit no-server-call and client-local-delete constraints.

Therefore, one implementation cannot satisfy the current CAP-8 Queue behavior and the current executor completion rule.
The interrupt-response race in Story 1.8 has the same gap when it expects a client-held Queue message to have auto-drained before the interrupt response is classified.

The owner must select one contract:

1. Dispatch Queue at Queue press into the registry and add a typed, idempotent delete or withdraw path.
2. Keep drafts client-only and remove automatic natural-boundary delivery, so delivery requires an explicit interrupt and `Send now`.
3. Keep both behaviors and define a deterministic server-to-client pre-completion handshake that prevents node completion until the boundary decision finishes.

Option 1 changes the owner-ratified client-only Queue rule.
Option 2 changes CAP-8 behavior.
Option 3 preserves both user behaviors but adds the largest protocol and lifecycle surface.

This finding expands UX-A1 from a stale ownership statement into a causal implementation blocker.

**Severity:** Critical.

### Major Issues

#### EQ-M1 — The pinned todo contract requires two mutually exclusive transcript layouts

SPEC CAP-3 and Epic Story 1.4 require the full checklist once at the last todo call and a pinned strip that mirrors the same `TodoPhase[]`.
These are normative feature requirements.

The owner-confirmed design handoff Delta 1 says that the checklist is lifted out of the transcript entirely and that every todo call collapses to a one-line row.
The handoff also says that this design detail remains the build reference.
This is a normative design decision.

One transcript cannot both contain the full inline checklist and remove it entirely.
Rendering both does not reconcile the claims because the design explicitly says that every todo call collapses.

The owner must choose either the mirrored inline-plus-pinned model in SPEC and Story 1.4 or the pinned-only model in the confirmed design handoff, and then update all canonical documents to that choice.

**Severity:** Major.

#### EQ-M2 — Finished-iteration dock behavior is not canonical or covered by a story

The canonical EXPERIENCE State Patterns section says that the dock is absent when an operator views an execution that is not live.
This is a normative behavior constraint.

The owner-confirmed design handoff Delta 6 says that a finished iteration keeps a collapsed disclosure, a `Go to iteration N` control, and a read-only queue band.
It also says that this design detail remains the build reference.
This is a normative design decision.

The dock cannot be absent and render the disclosure and queue band at the same time.
The reconciliation attempt fails when queued text exists because removing the dock also removes the required read-only queue band.

Story 1.6 covers selector navigation but does not state which finished-iteration dock behavior to build.
The owner must choose one behavior, update EXPERIENCE, and add its acceptance criteria to Story 1.6 or the owning dock story.

**Severity:** Major.

#### EQ-M3 — Story 1.12b makes `Send now` both a keepalive and a terminal resolution

Story 1.12b says that any composer activity, including `Send now`, re-arms the timer without resolving idle-await.
The same story then says that idle-await resolves exactly once when the first of `Send now`, the cancel poll, or the timer wins.
The engine integration idle-await rule also defines `Send now` as a resolution path.
These are mutually exclusive lifecycle rules for the same action.

The smallest repair is to remove `Send now` from the keepalive-only activity list.
Keystrokes and focus can re-arm the timer, while `Send now` resolves idle-await and tears the timer down.

**Severity:** Major.

#### EQ-M4 — Story 1.8 omits its dependency on Story 1.7b

Story 1.8 accepts an interrupt race by returning `idle-after-interrupt`, returning `generating` after natural-end auto-drain, or returning 409 after natural completion.
Story 1.7b owns the multi-turn loop, auto-drain behavior, idle-await entry, and the two-value agent sub-state projection.

Story 1.8 declares only Story 1.7a and the API contract as dependencies.
Its acceptance criteria cannot pass after only those declared dependencies.

Add Story 1.7b as an explicit dependency of Story 1.8.
This is a backward dependency, so it does not create a sequencing cycle.

**Severity:** Major.

#### EQ-M5 — The steering sequence uses an explicit technical-story exception

The owner-ratified hybrid decision keeps Stories 1.7a, 1.7b, and 1.8 as separately tracked and independently tested stories even though the epic says that they do not provide shippable operator value on their own.
This is an explicit user decision, not accidental technical decomposition.

The epic-quality concern is that a completed story should normally deliver usable user or operational value without relying on later stories.
The trade-off is separate sizing, ownership, and testability against a value-oriented story boundary and a simpler progress signal.

The concrete options are to keep the documented exception and treat these items as enabler stories, or to make them tasks under the Story 1.10 operator outcome.
This assessment does not reverse the owner decision.
If the exception stays, sprint reporting must not present Stories 1.7a through 1.8 as independently shippable value.

**Severity:** Major best-practice deviation, but not an additional implementation blocker.

### Minor Concerns and Warnings

#### EQ-m1 — Several stories are large integration slices

Baseline Stories 3.1 and 3.5 use stable cross-project story identifiers with separately accepted implementation tasks.
Target Stories 1.1, 1.7a, 1.7b, and 1.10 also cross several modules or provider paths.
Their contracts and tests make the boundaries understandable, but sprint planning should size the listed tasks independently and preserve the story-level acceptance gate.

**Severity:** Minor.

#### EQ-W1 — “Resume” after idle-await failure needs exact command language

Story 1.12b says that a node that fails after 30 minutes is “resumed” and reruns with a fresh session.
The repository also distinguishes workflow resume from failed-node retry.
The documents do not prove that these claims are mutually exclusive, so this is a clarification warning only.
The story should name the exact supported command or UI action that starts the fresh rerun.

#### EQ-W2 — Post-v1 gates are not v1 story defects

G1, G2, and G3 depend on external SDK or provider evidence and are not implementation-ready today.
The epic explicitly excludes them from the v1 completion gate, so they do not reduce v1 readiness.

### Quality Checks Passed

- Both epics describe user outcomes rather than project phases.
- The target epic has complete functional requirement coverage and explicit requirement references on every story.
- No forward dependency or circular dependency was found.
- Acceptance criteria generally use Given, When, and Then with observable results and explicit error behavior.
- Failure paths cover authentication, invalid identifiers, detached runs, terminal races, duplicate messages, provider interrupt differences, cancellation, timeout, and terminal reconciliation.
- Database and metadata changes are introduced by the first story that needs them, and no durable steering queue is implied.
- Brownfield integration points, package boundaries, generated API types, provider seams, and both executor paths are named.
- The v1 floor and post-v1 provider gates are separated clearly.

### Epic Quality Result

The epic set is traceable, sequenced, and mostly testable, but it is not ready for implementation as written.
EQ-C1 prevents CAP-8 automatic Queue delivery from being implemented deterministically.
EQ-M1 through EQ-M4 leave mutually exclusive UX behavior or incomplete lifecycle and dependency rules.
EQ-M5 is a deliberate owner exception that can remain if sprint reporting treats the three technical stories as enablers rather than independent user value.

## Summary and Recommendations

### Overall Readiness Status

**NOT READY**

The requirements have 100% functional coverage, and the implementation surfaces are well identified.
However, CAP-8 automatic Queue delivery has no deterministic protocol under the current client-only Queue and immediate server-completion rules.
Implementation cannot satisfy the current normative contracts without an owner decision and coordinated document changes.

### Critical Issues Requiring Immediate Action

1. Resolve EQ-C1 and UX-A1 by selecting one authoritative Queue ownership and natural-boundary delivery protocol.
2. Resolve UX-A2 by making the two named visual values meet the WCAG 2.2 AA floor or by explicitly changing that normative floor.
3. Resolve EQ-M1 by selecting either the inline-plus-pinned todo layout or the pinned-only layout.
4. Resolve EQ-M2 by selecting one finished-iteration dock behavior and adding it to an owning story.
5. Resolve EQ-M3 so `Send now` has one lifecycle meaning: it must resolve idle-await rather than act only as a keepalive.

### Recommended Next Steps

1. Record the owner decision for the Queue protocol first because it changes the engine, API, client, race tests, and CAP-8 acceptance criteria.
2. Apply one canonical documentation pass across SPEC, architecture, API contract, engine integration, test plans, UX spines, design handoff, and target epics.
3. In that pass, reconcile the pinned todo and finished-iteration designs, correct the draft-box token and shell-ownership list, and make the accessibility values match the chosen WCAG contract.
4. Update Story 1.8 to depend on Story 1.7b, correct the Story 1.12b timer criterion, and name the exact retry or resume action after idle-await failure.
5. Keep or replace the owner-ratified technical-story exception explicitly, and size the large integration stories by their existing accepted task boundaries.
6. Repeat implementation-readiness validation after the canonical documents agree and before sprint implementation starts.

### Final Note

This assessment identified 10 unique issues across UX alignment and epic quality.
The count includes one critical protocol blocker, one additional high-severity accessibility conflict, five major story or contract issues, two medium alignment issues, and one minor sizing concern.
Two clarification warnings do not affect the issue count.
The critical blocker and mutually exclusive normative contracts must be resolved before implementation proceeds.
