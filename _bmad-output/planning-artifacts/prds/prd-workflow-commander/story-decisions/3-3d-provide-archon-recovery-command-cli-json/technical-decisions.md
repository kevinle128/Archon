---
story: 3-3d-provide-archon-recovery-command-cli-json
gate: PASS
unresolvedDecisionCount: 0
mode: batch
reviewStatus: APPROVED
---

## Decision Summary

Story 3.3d passed whole-file batch review and is ready for `$bmad-create-story` handoff.
The user-directed revision preserves `workflow resume <run-id> --json` as a validate-only command and assigns actual recovery execution to `workflow retry <run-id> [--node <node-id>] --json`.
For whole-run and targeted retry, the parent CLI returns success as soon as it creates the detached worker process; the worker owns later validation, claim, preparation, and execution outcomes, and the parent does not wait for them.
Cancel returns success immediately after its durable compare-and-swap changes an eligible run to `cancelled`; worker quiescence and cleanup are not part of the command result.
Archon envelopes every failure it catches before response, while the subprocess consumer classifies empty output, malformed or schema-invalid output, external timeout, and uncatchable process exit without an Archon supervisor.
The selected parent-side error mapping has four stable outcomes: malformed request, unexpected state, caught command timeout, and internal error; detached-worker failures are not remapped into the already-completed parent response.
The local canonical resume, whole-run retry, targeted retry, and cancel fixtures now agree with these boundaries, and the local validator, dependent CLI contract tests, PRD, Architecture, Epic, and contract guidance are synchronized.
Hermes Story 3.4c and its consumer compatibility proof are downstream follow-up work after Archon producer completion and do not block Story 3.3d implementation.
The repository has no `workflow retry` or `workflow cancel` command, and the existing `retry-node` and `abandon` commands are explicitly non-canonical compatibility surfaces.
The CLI retry adapter must reuse the existing UI and core retry operation, using the run's persisted codebase and working path rather than adding caller-cwd matching.
The new `workflow retry` and `workflow cancel` spellings are limited to the accepted `--json` provider use case, while the existing human-mode commands remain unchanged.
The user approved the whole file, every material lifecycle and contract decision has an owner, and no unresolved decision remains.

## Source Reconciliation

### Normative authority

- `_bmad-output/planning-artifacts/prds/prd-workflow-commander/prd.md` FR-8 requires Archon to expose start, status, approve, reject, resume, retry, and cancel through machine-consumable CLI JSON; Archon classifies caught failures, while the subprocess consumer classifies empty or invalid output, external timeout, and uncatchable exit.
- `_bmad-output/planning-artifacts/prds/prd-workflow-commander/architecture.md` fixes the CLI spellings as `workflow resume`, `workflow retry [--node]`, and `workflow cancel`, keeps `retry-node` and `abandon` outside the provider vocabulary, defines the local result boundaries, gates Archon on local contract validation, and assigns Hermes compatibility proof to the later consumer implementation.
- `_bmad-output/planning-artifacts/prds/prd-workflow-commander/epics.md` Story 3.3d requires resume to validate resumability without execution or mutation, whole-run and targeted retry to acknowledge detached-process creation without waiting for worker validation or completion, and cancel to acknowledge only the durable transition without waiting for cleanup.
- `_bmad-output/project-context.md` requires fail-closed JSON boundaries, subprocess or end-to-end proof for pre-handler behavior, preserved run identity, and no autonomous lifecycle mutation across process boundaries.
- `_bmad-output/specs/spec-route-loop-routing/runtime-contract.md` and the shipped workflow documentation require resume and retry to preserve route-loop counters and activation state, while targeted retry reruns the selected source path rather than the `route_loop` controller itself.

### Validated canonical examples

- `_bmad-output/planning-artifacts/contracts/workflow-commander/schemas/workflow-command-envelope.schema.json` is closed at the top level, requires `workflowRunRef` for successful workflow commands, and leaves command-specific `result` objects open.
- `resume-success.json` defines `operation: resume`, unchanged `state: paused`, `validated: true`, `resumable: true`, and `executed: false` without action fields.
- `retry-success.json` defines whole-run dispatch through `operation: retry`, `scope: run`, `dispatched: true`, and `detached: true`, without worker-derived state or attempt fields.
- `retry-node-success.json` defines targeted dispatch through `operation: retry`, `scope: node`, the requested `nodeId`, `dispatched: true`, and `detached: true`, without worker-derived preparation or execution fields.
- `cancel-success.json` defines only `operation: cancel`, `state: cancelled`, and `terminal: true`, without stale-prone pre-transition state.
- The checked-in validator enforces all four recovery result shapes in addition to generic envelope consistency and validates 18 command examples, while the dependent CLI contract test reproduces both retry variants without adding a thirteenth command family.
- These checks validate canonical fixtures rather than the current CLI runtime.

### Runtime reality

- `packages/cli/src/commands/workflow-provider-command-envelope.ts` already provides the required shared success and error builders and the canonical command enum.
- `packages/cli/src/commands/workflow.ts` currently implements JSON resume as eligibility validation only and emits the legacy shape `{ ok, action, executed: false, status }`.
- The non-JSON resume path executes inline through `workflowRunCommand`, skips completed nodes, and relies on the database resume compare-and-swap before execution.
- `workflowRetryNodeCommand` validates the run and checkout, claims the run, creates retry audit state and safety or checkpoint refs, invalidates the target and descendants, and then executes inline with streaming output.
- `prepareWorkflowNodeRetry` has typed retry failures and releases a retry claim on preparation failure; under the selected dispatch boundary these are worker outcomes rather than parent command errors.
- The Web UI calls retry with `runId` and `nodeId`; the server authorizes against the run owner or admin, derives workflow discovery and execution context from the persisted run and codebase, and invokes `prepareWorkflowNodeRetry` without caller cwd.
- `classifyRunError` still relies largely on English-message matching for synchronous CLI failures, so the recovery handlers need a small typed parent-side mapping.
- `abandonWorkflow` permits `running`, `paused`, and `failed`, atomically changes the durable status to `cancelled`, and reclaims a container only when its cancel update wins the race.
- `cancelWorkflowRun` reports whether its compare-and-swap changed the row, but `abandonWorkflow` returns only the pre-cancel run, so a new provider command cannot honestly report race outcome or previous-to-resulting state without a narrower operation contract.
- `packages/cli/src/cli.ts` only recognizes start, status, approve, and reject as Workflow Commander envelope commands.
- A direct CLI reproduction on 2026-07-20 showed `workflow resume --json` with no run id emits plain usage text, while `workflow retry --json` and `workflow cancel --json` are unknown subcommands rather than failure envelopes.

### Historical context

- Commit `5122a98e` introduced validate-only JSON resume as a control-plane acknowledgement before the Workflow Commander shared envelope existed.
- Story 3.3a and Stories 3.3b through 3.3c deliberately deferred recovery-command conversion to Story 3.3d and established exact one-envelope stdout, numeric process exit codes, raw-argument preflight coverage, and no JSON-mode auto-resume for decision commands.
- Commit `b70e9b6a` hardened start and status pre-handler JSON behavior, providing the nearest implementation pattern for recovery-command malformed input and correlation handling.

### Reconciled conflicts

- The canonical command names and shared envelope win over the legacy `{ ok }`, `abandon`, and `retry-node` JSON shapes, so no upstream change is needed for command naming.
- The user authorized local canonical reconciliation, so the recovery fixtures, PRD, Epic 3.3d wording, Architecture baseline, contract guidance, validator, and dependent Archon tests now preserve validate-only JSON resume and assign actual recovery to retry.
- The user subsequently selected a simpler whole-run retry boundary: parent success means only that the detached process was created, while the worker owns claim and execution outcomes.
- The selected whole-run result is `operation: retry`, `scope: run`, `dispatched: true`, and `detached: true`; it cannot honestly report running state, resumed state, or attempt advancement at the spawn boundary.
- `retry-success.json`, the Epic, Architecture, contract guidance, validator, and dependent Archon test now use process-dispatch acknowledgement; Hermes consumes this settled producer contract in its later implementation.
- The selected targeted result is `operation: retry`, `scope: node`, the requested `nodeId`, `dispatched: true`, and `detached: true`; it cannot honestly report worker-derived state, retry epoch, invalidated nodes, or safety references at the spawn boundary.
- `retry-node-success.json` now defines the canonical targeted-retry payload; later Hermes work must consume this fixture without blocking Archon implementation.
- The selected cancel result is `operation: cancel`, `state: cancelled`, and `terminal: true`; it omits `previousState` because a pre-CAS read can be stale.
- Cancel success requires the durable compare-and-swap to win, but it does not wait for a running worker to stop or for container cleanup; the canonical cancel fixture and validator now omit `previousState`.
- The user assigned empty output, malformed or schema-invalid output, externally enforced timeout, and uncatchable process exit to the subprocess consumer; Archon owns only errors it catches before response and does not add a supervisor.
- A detached retry worker failure after dispatch acknowledgement is a later workflow outcome rather than a retroactive command failure.
- The selected parent recovery mapping uses `MALFORMED_REQUEST` for request-shape failures, `UNEXPECTED_STATE` for missing or ineligible runs and cancel compare-and-swap loss, `COMMAND_TIMEOUT` for internally caught timeouts, and `INTERNAL_ERROR` for spawn, database, or other caught unexpected failures.
- Publicly mapping `WorkflowRetryError` is unnecessary because those failures occur in the detached worker after the parent response.
- The earlier cwd-matching concern came from legacy CLI TODO tests rather than the implemented retry feature contract; the user confirmed Story 3.3d is exposing the existing UI retry capability through another adapter, so caller cwd must not become a new retry authorization or ownership boundary.
- The user selected JSON-only scope for the new `workflow retry` and `workflow cancel` spellings; non-JSON targeted retry and cancellation continue through `workflow retry-node` and `workflow abandon` rather than gaining duplicate aliases.
- The user established producer-first sequencing: Archon implements and validates the canonical producer surface before Hermes Story 3.4c begins its consumer implementation and compatibility proof.

## Lifecycle and Ownership

The intended external boundary is the local `archon workflow <command> ... --json` subprocess, and Workflow Commander v1 does not add a state-changing HTTP route.

| Lifecycle responsibility                                                                           | Existing owner                                                       | Implementation gap for Story 3.3d                                                                                                                       |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Raw argument parsing, cwd or git preflight, correlation id, one-line stdout, and process exit code | `packages/cli/src/cli.ts`                                            | Recovery commands are not included in the shared pre-handler envelope boundary.                                                                         |
| Canonical envelope construction and forbidden top-level fields                                     | `workflow-provider-command-envelope.ts`                              | Recovery success results are finalized locally, while the selected small parent error mapping is not implemented.                                       |
| Run lookup and resume eligibility                                                                  | `resumeWorkflow` plus CLI short-id resolution                        | The validate-only canonical contract is reconciled locally, but the runtime still emits the legacy result shape rather than the shared envelope result. |
| Whole-run retry process dispatch                                                                   | Parent CLI detached-process spawn                                    | No provider command currently emits the dispatch-only shared-envelope result or starts an exact-run worker.                                             |
| Whole-run retry claim and execution                                                                | Detached worker through `resumeWorkflowRun` and `workflowRunCommand` | Claim success or failure occurs after the parent response and must be observable without changing that response.                                        |
| Targeted retry process dispatch                                                                    | Parent CLI detached-process spawn                                    | No provider command currently emits the dispatch-only node result or starts an exact-run and exact-node worker.                                         |
| Targeted retry validation, claim, retry epoch, audit event, checkout reset, and execution          | Detached worker through `prepareWorkflowNodeRetry`                   | Every validation, preparation, and execution outcome occurs after the parent response and must be observed later.                                       |
| Retry run identity, authorization context, workflow discovery, and execution path                  | Existing Web API and shared core retry operation                     | The CLI worker must supply its CLI requester context and derive codebase and working path from the persisted run, without adding caller-cwd matching.   |
| Workflow execution after retry acknowledgement                                                     | `executeWorkflow` in a detached execution process                    | The worker must continue independently after the CLI returns, while status and events own later observation.                                            |
| Cancellation state mutation and response                                                           | Direct `cancelWorkflowRun` compare-and-swap                          | No provider-facing command maps the boolean winner to the approved minimal result or an `UNEXPECTED_STATE` failure.                                     |
| Worker quiescence and container cleanup after cancellation                                         | Cooperative executor checks and the existing cleanup reaper          | These remain asynchronous follow-up work and must never delay or change the committed cancel response.                                                  |
| Continuation observation                                                                           | `workflow get --json` and workflow events                            | The controller must poll or consume events after an accepted retry acknowledgement.                                                                     |
| Empty, malformed, schema-invalid, externally timed-out, or unexpectedly exited CLI subprocess      | External consumer of the subprocess boundary                         | Local sources define the consumer classifications; downstream Hermes Story 3.4c implements and proves them after Archon producer completion.            |

Resume, whole-run retry, targeted retry, and cancel all retain the existing run id.
Retry-claim compare-and-swap losers must avoid duplicate execution and expose their worker outcome later without changing the successful process-dispatch response.
A cancel compare-and-swap loser returns `UNEXPECTED_STATE` from the parent command and applies no duplicate transition.
No timeout or staleness heuristic may autonomously cancel, fail, abandon, or retry a non-terminal run owned by another process.
Validate-only resume must not create an execution owner or mutate durable run state.
After a successful retry acknowledgement, the external controller must observe continuation through `workflow get --json` or typed workflow events rather than treating the acknowledgement as completion.

## Decisions

The following constraints are already settled by normative sources and are not batch suggestions.

### TD-N01 — Canonical recovery command names

**Behavior:** The provider commands are `workflow.resume`, `workflow.retry`, and `workflow.cancel`, emitted by `archon workflow resume`, `archon workflow retry [--node]`, and `archon workflow cancel` respectively.
**Authority:** Architecture command baseline, Epic 3.3d, command schema enum, and Story 3.3a contract tests.
**Rejected alternatives:** Serializing `abandon` as `workflow.cancel` or retrofitting streaming `retry-node` as `workflow.retry` is rejected.
**Affected contracts:** CLI dispatch, help text, command envelope metadata, subprocess tests, and canonical fixtures.
**Owner:** Archon CLI producer.

### TD-N02 — Shared envelope and fail-closed JSON boundary

**Behavior:** Every JSON-mode success and failure emits exactly one shared envelope on stdout and returns the corresponding numeric process exit code.
**Authority:** PRD FR-8, shared command schema, Story 3.3a, and the accepted Story 3.3b and 3.3c implementation patterns.
**Rejected alternatives:** Legacy `{ ok }` payloads, plain usage text, mixed streaming output, raw exception text, and zero process exits for failure envelopes are rejected.
**Affected contracts:** Raw argument scanning, cwd validation, logging suppression, handler returns, and E2E subprocess behavior.
**Owner:** Archon CLI dispatcher and recovery handlers.

### TD-N03 — CLI-only Workflow Commander control surface

**Behavior:** Story 3.3d adds or converts CLI behavior only and does not add state-changing HTTP or Web UI recovery controls.
**Authority:** PRD product boundary, FR-8, architecture, and Epic 3 story boundaries.
**Rejected alternatives:** Adding a server route, Web UI control, Hermes state mutation, or consumer-side orchestration in this story is rejected.
**Affected contracts:** CLI package only, plus existing core and workflow operations reused through narrow interfaces.
**Owner:** Archon CLI producer.

### TD-N04 — Provider-neutral identity and payload vocabulary

**Behavior:** Successful recovery envelopes carry the same Archon workflow run identity through `workflowRunRef`, use provider-neutral fields, and omit Hermes-only phase, profile, agent, and gate vocabulary unless a canonical contract adds it.
**Authority:** PRD ownership boundary, closed envelope schema, project context identity rule, and adjacent story decisions.
**Rejected alternatives:** Fabricating Hermes phases or leaking raw messages, stdout, stderr, secrets, or agent profile fields is rejected.
**Affected contracts:** Envelope refs, result payloads, sanitization tests, and consumer correlation.
**Owner:** Archon CLI producer with Workflow Commander contract owner review.

### TD-N05 — Legacy human behavior remains compatible

**Behavior:** Existing non-JSON `workflow resume`, `workflow retry-node`, and `workflow abandon` behavior remains available unless a separately approved deprecation changes it.
**Authority:** Architecture notes, Story 3.3a scope, adjacent story compatibility policy, and current CLI documentation.
**Rejected alternatives:** Renaming or silently changing legacy human commands as a side effect of the provider JSON story is rejected.
**Affected contracts:** CLI dispatch, documentation, existing tests, and operator workflows.
**Owner:** Archon CLI maintainer.

### TD-N06 — CLI retry reuses run-owned UI and core operation context

**Behavior:** `workflow retry` identifies the run by `runId`, and the detached worker reuses the existing retry operation with workflow discovery and execution paths derived from the persisted run and codebase; caller cwd is not a retry authorization, ownership, or path-selection input.
**Authority:** The implemented Web UI sends only `runId` and `nodeId`, the Web API authorizes against run ownership or admin role and derives paths from the run, the shared `prepareWorkflowNodeRetry` operation owns retry semantics, and the user explicitly directed the CLI story to expose that existing feature rather than invent a second policy.
**Rejected alternatives:** Requiring the caller cwd to match the run codebase or worktree, treating legacy CLI TODO tests as normative requirements, or allowing cwd to override the persisted working path is rejected.
**Affected contracts:** CLI retry dispatch arguments, detached-worker inputs, short-id convenience resolution, requester audit context, path validation, and E2E tests.
**Owner:** Archon CLI adapter and shared retry operation.

### TD-N07 — Archon producer completion precedes Hermes consumer implementation

**Behavior:** Story 3.3d implements and locally validates the Archon recovery-command producer surface first; Hermes Story 3.4c consumes the completed canonical fixtures and supplies its compatibility proof later.
**Authority:** The PRD keeps Hermes implementation outside Archon ownership, the Epic marks Hermes stories as downstream consumers blocked on Archon producer output, the Architecture now distinguishes the local producer gate from the later consumer gate, and the user explicitly established this implementation order.
**Rejected alternatives:** Blocking Archon implementation on nonexistent Hermes consumer code, requiring Archon to implement Hermes tests, or deferring canonical producer fixtures until Hermes work begins is rejected.
**Affected contracts:** Architecture sequencing, Story 3.3d readiness, Story 3.4c dependency, shared fixture handoff, and downstream compatibility tests.
**Owner:** Archon producer for Story 3.3d, followed by the Hermes consumer owner for Story 3.4c.

### TD-002 — Whole-run retry acknowledges detached process dispatch

**Behavior:** `workflow retry <run-id> --json` creates a detached exact-run worker and returns success immediately after process creation with `operation: retry`, `scope: run`, `dispatched: true`, and `detached: true`.
The worker later claims and executes the same run, and status, events, or worker logs expose every post-spawn outcome without changing the completed parent response.
**Authority:** User whole-file approval, Epic 3.3d, Architecture command semantics, canonical `retry-success.json`, and the existing detached-run and workflow resume operations.
**Rejected alternatives:** Inline execution, waiting for claim or completion, returning running state or attempt fields, creating a replacement run, and requiring one-winner parent-command success are rejected.
**Affected contracts:** CLI parsing and dispatch, detached-worker entry, run compare-and-swap, canonical retry result, workflow observation, and subprocess E2E tests.
**Owner:** Archon parent CLI for process dispatch and the detached workflow worker for claim and execution.

### TD-003 — Targeted retry acknowledges detached process dispatch

**Behavior:** `workflow retry <run-id> --node <node-id> --json` creates a detached exact-run and exact-node worker and immediately returns `operation: retry`, `scope: node`, the requested `nodeId`, `dispatched: true`, and `detached: true`.
The worker reuses the existing UI and core retry operation for validation, claim, checkpoint, reset, invalidation, and execution.
**Authority:** User whole-file approval, Epic 3.3d, canonical `retry-node-success.json`, the Web UI retry route, and `prepareWorkflowNodeRetry`.
**Rejected alternatives:** Parent-side node validation, inline streaming under the provider command, reporting retry epoch or safety references at spawn time, caller-cwd matching, and retroactively changing the parent result are rejected.
**Affected contracts:** CLI `--node` parsing, worker arguments, shared retry operation, persisted run context, targeted fixture, audit events, and E2E tests.
**Owner:** Archon parent CLI for dispatch and the detached retry worker with the shared core retry operation for every later outcome.

### TD-004 — Cancel completes at the durable state transition

**Behavior:** `workflow cancel <run-id> --json` directly compares and swaps an eligible `running`, `paused`, or `failed` run to `cancelled` and returns `operation: cancel`, `state: cancelled`, and `terminal: true` immediately after the durable transition wins.
Missing or ineligible runs and compare-and-swap loss return `UNEXPECTED_STATE`; worker quiescence and cleanup remain asynchronous.
**Authority:** User whole-file approval, Epic 3.3d, canonical `cancel-success.json`, and the existing `cancelWorkflowRun` compare-and-swap contract.
**Rejected alternatives:** Reusing the high-level `abandonWorkflow` response, reporting stale `previousState`, waiting for worker shutdown or cleanup, and reporting success after a lost race are rejected.
**Affected contracts:** CLI cancel handler, database compare-and-swap, canonical cancel result, cooperative cancellation, cleanup ownership, and concurrency tests.
**Owner:** Archon CLI and workflow store for the durable transition; executor and cleanup reaper for later quiescence and cleanup.

### TD-005 — Producer and consumer own different failure observations

**Behavior:** Archon emits the shared failure envelope for every error caught before response and adds no supervisor for its own CLI process.
Detached-worker failures after successful retry dispatch are workflow outcomes, while downstream Hermes classifies empty output or uncatchable exit as `UNEXPECTED_EXIT`, malformed or schema-invalid output as `SCHEMA_MISMATCH`, and consumer-enforced timeout as `TIMEOUT` when Story 3.4c is implemented.
**Authority:** User whole-file approval, PRD FR-8, Architecture boundary and producer-first sequencing, Epic 3.3d, and the shared contract guidance.
**Rejected alternatives:** Requiring a crashed process to envelope its own crash, adding an Archon supervisor, treating post-spawn worker failure as a retroactive command failure, and implementing Hermes consumer logic in Archon are rejected.
**Affected contracts:** Error envelopes, subprocess ownership, logging and redaction, workflow outcomes, downstream consumer fixtures, and producer E2E tests.
**Owner:** Archon for caught producer failures and workflow outcomes; downstream Hermes Story 3.4c for subprocess observations.

### TD-007 — Recovery handlers use a small typed parent error mapping

**Behavior:** Parent recovery failures map as follows: malformed or missing arguments use `MALFORMED_REQUEST`, `provider_contract`, non-retryable, exit 64; missing or ineligible resume or cancel runs and cancel compare-and-swap loss use `UNEXPECTED_STATE`, `unexpected_state`, non-retryable, exit 78; internally caught timeout uses `COMMAND_TIMEOUT`, `timeout`, retryable, exit 69; spawn, database, and other caught unexpected failures use `INTERNAL_ERROR`, `implementation_defect`, non-retryable, exit 70.
Known cases use typed causes and structured non-secret details, while post-spawn `WorkflowRetryError` values remain worker outcomes.
**Authority:** User whole-file approval, shared error envelope requirements, existing CLI exit-code conventions, and the selected retry process boundary.
**Rejected alternatives:** English-message sniffing for known recovery failures, an exhaustive public mapping of worker errors, retryable unknown failures, and leaking raw error messages are rejected.
**Affected contracts:** Recovery operation errors, CLI classifiers, envelope details, exit codes, redaction, unit tests, and subprocess E2E tests.
**Owner:** Archon recovery operation boundary and CLI envelope adapter.

### TD-009 — New recovery spellings are JSON-only

**Behavior:** Story 3.3d adds `workflow retry` and `workflow cancel` only when `--json` is present.
Without `--json`, those spellings return clear usage guidance to the existing `workflow retry-node` or `workflow abandon` human commands, while existing non-JSON `workflow resume` remains unchanged.
**Authority:** User whole-file approval, Story 3.3d CLI JSON scope, Architecture syntax baseline, current human command surfaces, and project YAGNI guidance.
**Rejected alternatives:** Adding duplicate human aliases, changing legacy human streaming behavior, renaming legacy commands, and silently accepting unsupported non-JSON behavior are rejected.
**Affected contracts:** CLI dispatch, help and usage text, compatibility tests, JSON preflight, and existing operator workflows.
**Owner:** Archon CLI maintainer.

## Unresolved Decisions

None.

## Executable Proof Sketch

The final proof must use the real CLI subprocess boundary with an isolated `ARCHON_HOME`, isolated SQLite database, temporary git repository, deterministic workflow fixtures, and no network dependency.
The harness must capture stdout and stderr separately, parse exactly one stdout line as `workflow-command-envelope.v1`, assert the process exit code matches `execution.exitCode` on failure, and run the canonical contract validator before runtime cases.

1. Seed failed and paused runs, invoke `archon workflow resume <id> --json`, assert the validate-only success contract, and prove status, timestamps, events, retry epoch, checkout, and executor calls remain unchanged; invoke it against running or terminal states and assert a no-mutation failure envelope.
2. Seed a failed DAG with a completed upstream node and a deterministic slow remaining node, invoke `workflow retry <id> --json`, assert the command returns the dispatch-only success envelope immediately after detached-process creation without running, resumed, or attempt fields, and then poll status or events for the worker claim and later pause or terminal outcome.
3. Race two whole-run retry commands against the same run, allow both parent commands to report successful process dispatch, and prove through status or events that only one worker wins the compare-and-swap and the deterministic remaining node executes once.
4. Seed a failed mutating DAG with checkpoint and safety-ref state, invoke `workflow retry <full-id> --node <node> --json` from a different valid caller cwd, assert the command returns the targeted dispatch-only payload immediately after process creation, and then prove the worker reused the persisted run codebase and working path while preserving the requested node, invalidated descendants, checkout reset, retry epoch, route-loop restrictions, and one-winner execution contract.
5. Inject whole-run and targeted retry process-spawn failures and assert non-retryable `INTERNAL_ERROR` envelopes with exit 70; inject node validation, worker claim, checkpoint, reset, or execution failure after successful spawn acknowledgement and assert the parent response remains successful while the later outcome is observable through status, events, or worker logs.
6. Run cancellation from a second subprocess while a deterministic long-running node is active, assert the CLI returns the minimal cancel result immediately after one durable transition, assert a compare-and-swap loser receives failure, assert no later DAG node starts, and verify worker-stop or cleanup latency and failure do not change the cancel envelope.
7. Exercise the four parent error mappings: malformed arguments and correlation become `MALFORMED_REQUEST` with exit 64; missing or ineligible resume and cancel state plus cancel compare-and-swap loss become `UNEXPECTED_STATE` with exit 78; internally caught timeout becomes `COMMAND_TIMEOUT` with exit 69; database, spawn, and other caught unexpected failures become `INTERNAL_ERROR` with exit 70.
   Prove Archon adds no supervisor and does not claim to classify empty output, invalid emitted bytes, externally enforced timeout, or uncatchable exit; retain the canonical `UNEXPECTED_EXIT`, `SCHEMA_MISMATCH`, and `TIMEOUT` vocabulary for downstream Hermes tests.
8. Invoke the new `workflow retry` and `workflow cancel` spellings without `--json`, assert a clear usage failure that points to `retry-node` or `abandon`, and prove the existing human commands retain their prior behavior.
9. Run the focused recovery unit tests, direct CLI E2E subprocess tests, shared envelope and contract tests, SQLite compare-and-swap integration tests, workflow retry operation tests, and finally `bun run validate`.

The proof distinguishes validate-only resume from retry dispatch because resume creates no process and changes no lifecycle signal, while retry acknowledges detached-process creation and later proves through status or events that at most one worker owns execution.

## Downstream Handoff

The gate is `PASS` with `reviewStatus: APPROVED`, and no unresolved decision remains.
Hand this artifact to `$bmad-create-story` before creating Story 3.3d.
Story creation and implementation must preserve the accepted payloads, process boundaries, existing-run identity, shared UI retry operation, JSON-only command scope, and producer-first sequencing documented here.
Hermes Story 3.4c remains a downstream consumer implementation and compatibility-test follow-up after the Archon producer is complete.
