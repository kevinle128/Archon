---
stepsCompleted:
  - step-01-document-discovery
  - step-02-prd-analysis
  - step-03-epic-coverage-validation
  - step-04-ux-alignment
  - step-05-epic-quality-review
  - step-06-final-assessment
status: complete
includedFiles:
  - _bmad-output/specs/spec-agent-node-room/SPEC.md
  - _bmad-output/specs/spec-agent-node-room/control-states.md
  - _bmad-output/specs/spec-agent-node-room/engine-integration.md
  - _bmad-output/specs/spec-agent-node-room/provider-steering-matrix.md
  - _bmad-output/specs/spec-agent-node-room/steering-api-contract.md
  - _bmad-output/specs/spec-agent-node-room/steering-test-plan.md
  - _bmad-output/specs/spec-agent-node-room/test-plan.md
  - _bmad-output/specs/spec-agent-node-room/todo-fold-contract.md
  - _bmad-output/specs/spec-agent-node-room/tool-presentation-contract.md
  - _bmad-output/planning-artifacts/architecture/architecture-Archon-2026-09-12/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/architecture/architecture-Archon-live-agent-steering-2026-09-12/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/epics-agent-node-room/epics.md
  - _bmad-output/planning-artifacts/ux-designs/ux-Archon-2026-09-09/DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-Archon-2026-09-09/EXPERIENCE.md
  - claude-design/design_handoff_node_room_transcript_steering/README.md
---

# Implementation Readiness Assessment Report

**Date:** 2026-09-15
**Project:** Archon — spec-agent-node-room

## Document Inventory

### PRD-Equivalent Specification

- `_bmad-output/specs/spec-agent-node-room/SPEC.md` — 29,634 bytes; modified 2026-09-15 23:40:42.
- `_bmad-output/specs/spec-agent-node-room/control-states.md` — 10,863 bytes; modified 2026-09-15 23:44:17.
- `_bmad-output/specs/spec-agent-node-room/engine-integration.md` — 18,388 bytes; modified 2026-09-15 23:40:36.
- `_bmad-output/specs/spec-agent-node-room/provider-steering-matrix.md` — 10,762 bytes; modified 2026-09-15 15:02:24.
- `_bmad-output/specs/spec-agent-node-room/steering-api-contract.md` — 8,217 bytes; modified 2026-09-15 23:44:17.
- `_bmad-output/specs/spec-agent-node-room/steering-test-plan.md` — 8,596 bytes; modified 2026-09-15 23:32:15.
- `_bmad-output/specs/spec-agent-node-room/test-plan.md` — 8,954 bytes; modified 2026-09-15 21:11:51.
- `_bmad-output/specs/spec-agent-node-room/todo-fold-contract.md` — 5,430 bytes; modified 2026-09-15 15:02:24.
- `_bmad-output/specs/spec-agent-node-room/tool-presentation-contract.md` — 18,472 bytes; modified 2026-09-15 15:02:24.

### Architecture

- `_bmad-output/planning-artifacts/architecture/architecture-Archon-2026-09-12/ARCHITECTURE-SPINE.md` — 33,210 bytes; modified 2026-09-15 23:44:16.

### Epics and Stories

- `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md` — 44,250 bytes; modified 2026-09-15 23:44:16.

### UX Design

- `_bmad-output/planning-artifacts/ux-designs/ux-Archon-2026-09-09/DESIGN.md` — 60,193 bytes; modified 2026-09-15 23:37:31.
- `_bmad-output/planning-artifacts/ux-designs/ux-Archon-2026-09-09/EXPERIENCE.md` — 169,069 bytes; modified 2026-09-15 23:44:17.

### Discovery Notes

No document set uses the sharded `index.md` format.
No whole-plus-sharded duplicate requires resolution.
The selected feature specification is outside the configured planning-artifacts directory, but it is the explicit assessment target.
Older and unrelated source-control, workflow-run HITL, architecture, UX, and root-level planning documents are excluded from this assessment.

## PRD Analysis

### Functional Requirements

FR1: A reader can scan each node tool call as one collapsed line with a family chip, a colour-independent status glyph, a salient headline, and right-aligned badges; successful calls start collapsed, failed calls start expanded, and collapsed rows contain no serialized-data punctuation.

FR2: A reader can expand every tool call into the body arm declared for its tool family; an unmatched tool shows at most three scalar fields, collapses objects and arrays, never emits a JSON dump by default, and keeps the measured generic fallback below 2 percent of production rows.

FR3: Both supported provider todo shapes normalize to one `TodoPhase[]`; todo calls collapse to one-line transcript rows, the current checklist appears once in a pinned strip, removed empty phases disappear, and the strip is absent when there are no todos.

FR4: Both supported provider task-dispatch shapes normalize to `TaskSubtask[]`; any provider batch context renders as Markdown, and each subtask renders in a collapsible card that identifies its task and agent.

FR5: A file edit renders an inline line diff only when both before and after content are available; Claude edits qualify, Codex edits use path plus preview, and the system never fabricates a diff from one side.

FR6: Transcript rows group by `occurrence_id`, never by `attempt_id`; multi-occurrence nodes show group headers and a loop-iteration selector, and single-occurrence nodes show neither.

FR7: Every tool card provides a closed-by-default Raw toggle that reveals the original provider JSON, and the existing full-output loading flow continues to work.

FR8: While a node agent is generating, the composer is mounted and enabled, its send control reads `Queue`, and pressing it dispatches a non-interrupting message to the server-side registry queue for delivery at the next natural turn boundary.

FR9: The operator can interrupt the agent's current generation through a provider primitive or per-turn stream abort while the provider session and node remain alive; the node stays `running`, the agent projects `idle-after-interrupt`, and the interrupted tool call is recorded as interrupted rather than failed.

FR10: From `idle-after-interrupt`, `Send now` flushes queued messages followed by the newly typed message in server receipt order as the next turn on the same provider session; the node never enters a paused or pending lifecycle state.

FR11: Operator messages and interrupted tool calls become ordinary ordered transcript rows between the work they interrupted and the work they caused, and operator rows cannot be mistaken for agent-authored text.

FR12: Every supported provider accepts the universal v1 floor of interrupt plus `Queue` plus `sent`; an ordinary prompt can soft-inject before turn end only when an exercised provider transport supports it, and post-v1 soft-inject gates do not block v1.

FR13: An operator message stays `sent` until a provider echoes its caller-stamped id, then becomes `delivered`; correlation uses only the id, and the v1 pin leaves all providers at `sent`.

FR14: One pure React-free and provider-agnostic resolver converts structural tool input into `ToolPresentation`, applies the four ordered resolution tiers, matches normalized aliases as exact tokens, handles MCP labels, strips fixed Codex shell wrappers for headlines, keeps full commands in bodies, and never produces a default JSON dump.

FR15: The resolver treats Claude and OMP glob path fields according to their different meanings, chooses grep bodies from `output_mode`, carries exit codes into collapsed-row badges, preserves provider-sent chip text when it is one token of at most 24 characters, and uses family labels otherwise.

FR16: Todo folding supports Claude whole-list replacement and all nine OMP operations, including missing-op inference, legacy batches, all-targeting bare operations, automatic promotion, blocking rules, removal of empty phases, and no fabricated state before initialization.

FR17: Inline diffs use the declared `diff` dependency through one shared module, convert `structuredPatch` hunks into `GitDiffHunk`, ignore no-newline markers wherever they occur, and degrade to path plus preview when deterministic byte or edit-length bounds reject the diff.

FR18: The composer dock derives its controls from the projected agent sub-state; it shows `Stop` and `Queue` while generating, briefly shows `Stopping…` with `aria-disabled` while interrupting, shows `Send now` while idle after interrupt, and removes actionable controls after the node finishes.

FR19: The server exposes typed OpenAPI Send, Interrupt, Keepalive, and Withdraw routes with the request, response, error, identity, status-code, and idempotency contracts in `steering-api-contract.md`.

FR20: An in-process registry keyed by `(runId, nodeId)` owns each live session handle and inbound queue while the node runs, preserves server receipt order, rejects detached processes as `422 not_steerable_here`, and tears down the handle and queue on every terminal outcome.

FR21: Each provider turn uses a fresh per-turn abort signal combined with the node-level Cancel signal, and the executor resolves natural results, abort-marked results, abort throws, genuine throws, and Cancel as five distinct end causes without weakening the existing Cancel path.

FR22: Natural turn end auto-drains one or more queued messages into another turn or completes when the queue is empty; interrupted turn end skips validation and completion, writes one interrupted status row, and waits for `Send now` regardless of queued content.

FR23: Idle-after-interrupt arms a fresh 30-minute inactivity timer, authorized composing keepalive activity re-arms it, `Send now`, Cancel polling, and expiry race to one resolution, and expiry fails the node with `interrupted by operator, no redirect received`.

FR24: The executor is the sole writer of operator transcript receipts as `text` rows with `origin`, `operator_user_id`, and `message_id`; terminal-event reconciliation matches sent ids to written rows and restores unmatched messages as `Never sent` without running on live refetches.

FR25: Claude, Codex, OMP, Grok, and DeepSeek each have an interrupt conformance path that ends the current turn while preserving a usable session for a follow-up turn, with provider-specific abort results or throws classified by the executor rather than suppressed by adapters.

FR26: AI loop nodes support the same registry, per-turn signal, end-cause classification, sub-state, and idle-await behavior as regular AI nodes, and `Send now` continues the interrupted iteration on the same session before normal loop completion checks.

FR27: Two operators can steer one node without a per-node lock; the registry preserves global server receipt order, each sender retains written order, and each transcript row identifies its operator.

FR28: Legacy and Console node rooms ship the readable transcript and steering dock together while sharing provider-neutral logic through `packages/web/src/lib/` and keeping their shell JSX separate.

Total FRs: 28.

### Non-Functional Requirements

NFR1: The read half must improve historical runs immediately and must add no database schema, migration, or backend behavior.

NFR2: No default transcript path may use raw `JSON.stringify`; serialized JSON is permitted only behind the explicit Raw toggle.

NFR3: Tool-call status must remain understandable without colour because the visible glyph carries the status and colour only reinforces it.

NFR4: A short provider tool name must remain verbatim, a long or multi-token name must fall back to the family label, paths must elide in the middle, and commands and patterns must elide at the end.

NFR5: Provider differences must normalize at the edge, and renderers must not branch on provider names.

NFR6: Interrupt acknowledgement must use the in-process path and present as sub-second rather than inheriting the database Cancel poll's ten-second floor.

NFR7: The read-only corpus replay must calculate and record the generic-fallback numerator, denominator, fraction, and snapshot date, and the release gate must fail when the fraction is at least 2 percent.

NFR8: Synchronous diff work must have deterministic byte and `maxEditLength` bounds that prevent a main-thread hang and return the same result for the same inputs on every machine.

NFR9: The UI must preserve focus through dock transitions, use `aria-disabled` instead of the native disabled attribute for the transient stop control, announce transitions politely, report delivery failures assertively, respect reduced motion, and keep Enter as a newline action rather than a send action.

NFR10: Both node-room layouts must pass visual checks at the Legacy 460-pixel width and the Console panel width without putting stop controls into the wrapping header.

NFR11: Steering routes must use `resolveAuthContext`; any authenticated identity may steer and is attributed, unauthenticated callers fail, and identity-less runs remain allowed under the steering-specific grant.

NFR12: Every rejected steering request must leave the node, registry queue, and transcript unchanged.

NFR13: Duplicate sends, repeated interrupts after idle, and withdrawals after drain must be idempotent and must not create duplicate work or errors.

NFR14: The registry and steering queue are intentionally process-local and non-durable; a server restart or detached executor has no reachable steering handle, and the interface must state that limit without changing normal Cancel or resume behavior.

NFR15: The node-level Cancel controller remains one-shot and unchanged, Cancel wins when it races with an operator interrupt, and steering must never mutate the node lifecycle to simulate pause or resume.

NFR16: Idle-await must resolve exactly once and must tear down its timer and Cancel poll after `Send now`, cancellation, or timeout wins.

NFR17: A steer delivery must not emit a turn-start event because a false event would create a phantom transcript boundary.

NFR18: The operator-row schema change must be additive metadata on the existing JSON column, must not add a table or widen the row-kind enum, and must regenerate the OpenAPI-derived web types.

NFR19: `@archon/web` must not import from `@archon/workflows`, Console must not import from `@/components/`, renderer code must not import `diff`, and the shared adapter must use generated API types without crossing the Console boundary.

NFR20: All TypeScript must remain strict, unjustified `any` is forbidden, ESLint must produce zero warnings, and `bun run validate` is the pre-PR gate.

NFR21: Tests must include Claude and non-Claude fixtures where provider shapes or interrupt mechanisms differ, use fake timers for the 30-minute path, exercise in-process and detached boundaries, and cover both Legacy and Console end to end.

NFR22: The interrupted partial turn must never be validated, completed, or used to advance the DAG, and genuine provider failures must remain visible and fail fast.

NFR23: The server must preserve queue receipt order across concurrent operators, preserve each operator's written order, and attribute each persisted operator row.

NFR24: The interface must not imply that interrupt rolls back completed tool calls or filesystem changes.

Total NFRs: 24.

### Additional Requirements

- The canonical contract comprises `SPEC.md` and every file declared in its `companions` frontmatter.
- Pre-merge steering capability ids in adopted UX and architecture artifacts map to this merged specification by adding seven, while read-half capability ids remain unchanged.
- The read-half shared layer must recognize operator-origin text rows and fold a universal interrupted status row into the preceding tool call before the write half can emit those rows safely.
- The write half must use the existing session resume seam for additional provider turns and must not reconstruct intent from operator prose.
- A queued message becomes server-side at `Queue` press, while text not yet queued remains per-tab browser state.
- Deleting a queued item calls the idempotent Withdraw route, and delivery failure returns messages to the front of the queue.
- A finished node has no active composer or steering controls, while an undelivered draft remains read-only and states that it never left.
- The `delivered` state, Claude soft-inject, and Grok hooks are separate post-v1 gated items and do not block the ratified v1 floor.
- Cancelling the whole node, cancelling one tool call, restart-survivable steering, detached-run steering, persisted drafts, automatic send mode, unrelated tool-card surfaces, run-level file attribution, unused providers, agent thinking, triggering prompts, and advisor notifications are explicit non-goals.
- The production corpus measurement is an assumption-backed release audit rather than a reproducible CI fixture.
- The implementation must use the declared SDK input shapes and measured provider payloads rather than invented fixtures.
- The full suite must run through `bun run validate`; root `bun test` is not an acceptable validation signal.

### PRD Completeness Assessment

The specification is unusually detailed and provides user capabilities, machine-facing contracts, provider behavior, state transitions, typed routes, failure semantics, explicit non-goals, and test obligations.
The main completeness risk is document-set integrity: `SPEC.md` declares additional canonical companions, including the live-agent-steering architecture spine, mockup handoff, and evidence reports, that were not part of the confirmed discovery inventory.
This does not invalidate the extracted requirements, but the final readiness decision must not claim complete cross-document validation unless later steps reconcile every normative adopted companion that the specification declares canonical.
The version statements for provider SDK pins are descriptive evidence that can change independently of the contract, so they require source verification before implementation but are not treated as requirement conflicts at this stage.

## Epic Coverage Validation

### Epic FR Coverage Extracted

The epics document formally maps the 13 capability-level FRs and also carries unnumbered routes, registry, state, reconciliation, timer, ordering, and UX requirements.
The detailed story acceptance criteria provide implementation paths for all 28 functional requirements extracted in this report.

### Coverage Matrix

| FR   | PRD requirement                                                                                  | Epic coverage                                                                      | Status  |
| ---- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ------- |
| FR1  | Scannable one-line tool rows with chips, glyphs, headlines, badges, and default expansion rules. | Story 1.1                                                                          | Covered |
| FR2  | Family-shaped bodies, bounded generic fallback, and no default JSON dump.                        | Story 1.2                                                                          | Covered |
| FR3  | Provider-neutral todo folding and pinned current-state strip.                                    | Story 1.4                                                                          | Covered |
| FR4  | Provider-neutral task dispatch context and subtask cards.                                        | Story 1.5                                                                          | Covered |
| FR5  | Inline diff only from complete before-and-after content.                                         | Story 1.3                                                                          | Covered |
| FR6  | Occurrence grouping and loop-iteration navigation.                                               | Story 1.6                                                                          | Covered |
| FR7  | Closed Raw escape hatch and existing full-output loading.                                        | Story 1.1                                                                          | Covered |
| FR8  | Generating-state composer and non-interrupting server-side Queue behavior.                       | Stories 1.7b and 1.9                                                               | Covered |
| FR9  | Live-turn interrupt with session and node continuity plus interrupted status.                    | Stories 1.1, 1.7a, 1.7b, and 1.10                                                  | Covered |
| FR10 | Ordered `Send now` continuation on the same live session.                                        | Stories 1.7b and 1.10                                                              | Covered |
| FR11 | Ordered and visibly attributed operator transcript rows.                                         | Stories 1.1 and 1.11                                                               | Covered |
| FR12 | Universal v1 floor with gated provider soft-inject acceleration.                                 | Stories 1.7a, 1.9, and G2–G3                                                       | Covered |
| FR13 | Id-only sent-to-delivered correlation with the v1 sent ceiling.                                  | Story 1.11 and G1                                                                  | Covered |
| FR14 | Pure provider-neutral four-tier tool resolver with exact matching and Codex/MCP handling.        | Stories 1.1 and 1.2, with the tool-presentation contract incorporated by reference | Covered |
| FR15 | Correct glob and grep semantics, exit badges, chip text, and elision behavior.                   | Stories 1.1 and 1.2                                                                | Covered |
| FR16 | Complete Claude and OMP todo-fold semantics.                                                     | Story 1.4, with the todo-fold contract incorporated by reference                   | Covered |
| FR17 | Deterministically bounded diff conversion and safe fallback.                                     | Story 1.3                                                                          | Covered |
| FR18 | Composer dock controls derived from agent sub-state through finished state.                      | Stories 1.9, 1.10, and 1.12a                                                       | Covered |
| FR19 | Typed Send, Interrupt, Keepalive, and Withdraw route behavior.                                   | Stories 1.8 and 1.9, with the steering API contract incorporated by reference      | Covered |
| FR20 | Process-local live-session registry, ordered queue, detached refusal, and teardown.              | Stories 1.7a and 1.8                                                               | Covered |
| FR21 | Fresh per-turn signal and five-case executor end-cause classification.                           | Stories 1.7a and 1.7b                                                              | Covered |
| FR22 | Natural auto-drain versus interrupted idle-await behavior.                                       | Story 1.7b                                                                         | Covered |
| FR23 | Thirty-minute inactivity timer, keepalive, Cancel polling, and single resolution.                | Story 1.12b                                                                        | Covered |
| FR24 | Executor-owned operator receipts and terminal-only message reconciliation.                       | Stories 1.11 and 1.12a                                                             | Covered |
| FR25 | Interrupt conformance for all five in-use providers.                                             | Story 1.7a                                                                         | Covered |
| FR26 | Equivalent steering behavior for normal and AI loop execution paths.                             | Stories 1.7a and 1.7b                                                              | Covered |
| FR27 | Concurrent-operator global order and attribution.                                                | Story 1.12c                                                                        | Covered |
| FR28 | Coordinated Legacy and Console delivery with shared neutral logic and separate shells.           | Epic 1 scope and Stories 1.1–1.12c                                                 | Covered |

### Missing Requirements

No extracted functional requirement lacks an implementation path in Epic 1 or its explicitly gated backlog.

### Epic Requirements Not Present in the Selected PRD Set

Story 1.6 adds a finished-iteration dock disclosure, a `Go to iteration N` control, a read-only queue band, and `not_steerable_here` refusal behavior that is not stated in the selected specification or its selected companion contracts.
The epics document attributes this behavior to the design handoff, which `SPEC.md` declares canonical but the confirmed discovery inventory did not include.
This is an added-scope traceability warning, not a missing-FR defect, until the design handoff is validated in the alignment steps.

### Coverage Statistics

- Total PRD FRs: 28.
- FRs covered in epics or gated backlog: 28.
- Missing FRs: 0.
- Coverage: 100 percent.

### Coverage Quality Note

The epics document's formal FR Coverage Map stops at the 13 capability-level FRs.
The story acceptance criteria cover the detailed engine and contract requirements, but the map does not explicitly trace those details as numbered requirements.
Implementation has a complete path, but durable traceability would improve if the owning specification or epics inventory adopted one shared detailed requirement numbering scheme.

## UX Alignment Assessment

### UX Document Status

UX documentation exists and is final.
The validated UX set comprises `DESIGN.md`, `EXPERIENCE.md`, and the canonical node-room design handoff.
The read-half and live-steering architecture spines were both validated because the merged specification declares both as canonical companions.

### Supplemental Canonical Documents

- `_bmad-output/planning-artifacts/architecture/architecture-Archon-live-agent-steering-2026-09-12/ARCHITECTURE-SPINE.md` — 43,363 bytes; modified 2026-09-15 23:33:59.
- `claude-design/design_handoff_node_room_transcript_steering/README.md` — 30,070 bytes; modified 2026-09-15 19:16:28.

These documents were added to the validation set after `SPEC.md` and the epics document identified them as canonical inputs.

### UX to PRD Alignment

The UX documents cover all 13 capabilities across the readable transcript, todo strip, occurrence navigation, Raw view, operator rows, composer dock, interrupt flow, queued delivery, terminal reconciliation, and provider-limited delivery status.
The UX preserves the PRD's main safety rules: interrupt does not mean Cancel, the node remains `running`, prior filesystem changes are not undone, failed messages return to the queue, and finished nodes expose no actionable steering control.
The UX provides specific states for generating, interrupting, idle-after-interrupt, finished, failed-after-inactivity, detached, ask-blocked, unknown, and non-live execution conditions.
The accessibility design covers colour-independent status, explicit authorship, focus preservation, live-region serialization, assertive delivery failures, target sizes, contrast, reduced motion, and keyboard operation.

### UX to Architecture Alignment

The read architecture supports CAP-1 through CAP-7 through a pure render-neutral core in `packages/web/src/lib/`, two isolated React shells, deterministic bounded diff work, core-produced labels and badges, todo projection, occurrence grouping, and explicit shell-owned interaction behavior.
The steering architecture supports CAP-8 through CAP-13 through a per-turn interrupt signal, multi-turn live sessions, a process-local registry, typed agent sub-state projection, authorized routes, executor-owned operator rows, terminal reconciliation, provider conformance, and a read-time operator display-name projection.
The architecture supports the 460-pixel Legacy verification width, fixed dock placement outside the transcript scroller, process-local detached-run disclosure, and the read-before-write dependency for operator and interrupted rows.
The UX does not require an unsupported backend capability after the live-steering spine is included.

### Alignment Issues

#### Blocking: queued-message ownership and persistence are mutually exclusive

`SPEC.md` CAP-8 states, as a normative success criterion, that “the interface states that the queue is per-tab.”
`SPEC.md` Constraints → Two queues states, as a normative runtime constraint, that pressing `Queue` moves the message into the server-side in-memory registry and that “a queued message is therefore server-side — it survives a tab close.”
`EXPERIENCE.md` Interaction Primitives states, as a normative UX requirement, that “the queue is per node, as well as per tab,” while the design handoff places `this tab only` on the queued-message band.
The live-steering architecture AD-11 states, as a normative architecture rule, that the registry queue is keyed by `(runId, nodeId)` and establishes one global server receipt order across operators.

One implementation cannot make the same post-`Queue` message both tab-local and server-side, tab-surviving, and globally ordered in a node registry.
The reconciliation attempt succeeds only by separating the two states: unqueued composer text is per-tab, while queued messages are server-side and node-scoped.
The current CAP-8 and UX queue wording applies the per-tab claim to queued messages, so that repair is not yet reflected consistently in the documents.

Recommended correction: reserve `this tab only` for unqueued composer text, label the queue band as node-scoped and server-process-local, and update CAP-8, `EXPERIENCE.md`, the handoff, and the relevant Story 1.9 wording together.

Impact: implementers cannot choose correct multi-tab visibility, tab-close persistence, deletion behavior, or concurrent-operator reconciliation until this is corrected.

#### Warning: keyboard send shortcut lacks requirement and story traceability

`EXPERIENCE.md` requires `Cmd` or `Ctrl` plus Enter to send, requires the shortcut to be discoverable, and requires it to use the same blocked-state guard as the button.
The specification and Story 1.9 require plain Enter to insert a newline, but they do not state or test the modified-Enter shortcut.
This is compatible with the architecture and does not create a contradiction, but it is an untraced UX requirement.

Recommended correction: add the shortcut, accessible-name placement, blocked-state parity, and keyboard test to the owning capability and Story 1.9 acceptance criteria, or remove the shortcut from the UX contract.

#### Warning: finished-iteration dock behavior is canonical only by indirection

The design handoff states that the contracts did not define the finished-iteration dock and adds a collapsed disclosure, `Go to iteration N`, and a read-only queue band.
Story 1.6 includes that behavior, and `EXPERIENCE.md` adopts it.
`SPEC.md` declares the handoff canonical, so one implementation can satisfy all documents, but the behavior is absent from the explicit capabilities and control-state contract.

Recommended correction: add the finished-iteration state to `control-states.md` and the merged specification so the behavior does not depend on following a transitive design reference.

### Reconciled Non-Issues

The adopted UX documents still use pre-merge steering capability numbers in places, but `SPEC.md` provides an authoritative add-seven mapping, so the numbering difference is not a conflict.
The handoff records old contrast shortfalls, but it explicitly yields to `DESIGN.md`, whose later owner decision requires token-derived brightening to meet the WCAG floor, so the correct implementation is unambiguous.
The design handoff's full-bleed queue band and detached-run state were adopted into the final UX documents and do not remain open deltas.

### Warnings

The original discovery inventory omitted two canonical companions that were only identifiable after reading `SPEC.md` and the epics frontmatter.
They are now included in this assessment, but the artifact discovery pattern should support explicit `companions` lists for future readiness runs.

## Epic Quality Review

### Epic Structure

Epic 1 describes the user outcome of making the agent node room readable and steerable.
The epic can deliver value on its own because it is the only epic in the plan.
The read half provides a usable historical-transcript outcome before steering begins.
The plan contains no dependency on a later epic.

### Dependency Analysis

All declared story dependencies point backward to earlier stories.
The operator-row and interrupted-status reader hooks correctly land in Story 1.1 before steering writes those rows.
The registry and turn-loop work precedes routes, the routes precede the dock, and the dock precedes terminal reconciliation and safety work.
No circular or forward dependency was found.

No new database table is required.
The additive transcript metadata and read-response projection first appear in Story 1.11, where they are used.
The project is brownfield, so starter-template, initial-environment, and initial-CI stories do not apply.

### Critical Violations

#### The queued-message state model is not implementable consistently

Story 1.9 treats messages shown under `QUEUED` as already dispatched to the server registry, while the capability and UX contract also require the queue to be per-tab.
The live architecture provides one `(runId, nodeId)` registry queue with global receipt order and tab-close survival.
This is the same blocking conflict recorded in UX Alignment and prevents a single acceptance-test oracle for Story 1.9.

Recommendation: settle one state model before implementation and update CAP-8, Story 1.9, the UX copy, and the E2E tests together.
The cause-aligned model already specified elsewhere is that unqueued composer text is per-tab and queued messages are node-scoped in the server process.

### Major Issues

#### Story 1.6 requires identity that the steering API does not carry

Story 1.6 states, as a normative acceptance criterion, that a message composed against a finished iteration is refused as `not_steerable_here`.
The design handoff states, as its rationale, that a steer carries the node id and retry epoch against which it was written.
The steering API contract defines the Send target only as `runId` and `nodeId`, and its body contains only `message`, `message_id`, and `intent`.
The live registry is also keyed only by `(runId, nodeId)`.

The reconciliation attempt fails for a server-side refusal because the route cannot distinguish a finished iteration selection from the current live iteration.
Hiding the composer can prevent the request, but it cannot make a bypassed request return the stated error for that reason.

Recommendation: use the smaller consistent rule that the old-iteration view offers no composer and makes no route call, while the route remains node-scoped.
If server-enforced iteration targeting is required, add execution identity to the API and registry contracts before retaining this acceptance criterion.

#### G2 couples two independent provider paths to one provider's spike

G2 is titled and gated as Claude soft-inject, and its gate is the Claude `AsyncIterable` plus resume-protocol spike.
The same G2 acceptance criterion also carries the OMP RPC, protocol-version-2, and `set_steering_mode: 'all'` path.
The provider matrix classifies OMP soft-inject as source-verified and gives it different implementation constraints.

One provider's independent path must not wait on another provider's external gate.

Recommendation: give OMP soft-inject its own gated item and conformance criteria, or define G2 as a provider-indexed group with independent Claude and OMP gates.

#### Stories 1.7a, 1.7b, and 1.8 are technical milestones without standalone user value

The epics document explicitly records the owner-ratified hybrid decision: Stories 1.7a, 1.7b, and 1.8 are engine and transport tasks that do not provide a shippable operator outcome until Stories 1.9 and 1.10.
This violates the create-epics-and-stories rule that each story must provide independently usable value.

The decision does provide separate tracking and focused test boundaries for risky brownfield engine work.
Reversing it would trade that visibility for stricter user-story semantics.

Options requiring owner direction are to keep the ratified hybrid and label 1.7a–1.8 as enabling tasks under the Story 1.10 outcome, or to replace them with vertical provider slices that each end in a usable steering flow.
This assessment records the deviation and does not silently reverse the owner decision.

#### Stories 1.7a and 1.7b are too large for reliable story-level completion

Story 1.7a combines the registry, per-turn abort plumbing, both executor paths, and conformance for five providers.
Story 1.7b combines the five-case end classifier, validation and re-ask control, multi-turn session continuation, status-row writing, projected API state, and both executor paths.
Each story crosses several packages and failure domains, and each has more than one independently testable completion boundary.

Recommendation: keep one user-facing steering outcome but execute these as ordered technical tasks with explicit package ownership and integration gates.

#### Story 1.8 does not explicitly accept the Withdraw route

Story 1.8 is the route story, but its route acceptance criterion names only Send, Interrupt, and Keepalive.
Story 1.9 calls the Withdraw route, and the steering API and test contracts require its schema, identity handling, idempotency, unknown-target behavior, and no-partial-mutation guarantee.
An incorporation-by-reference exists, but an implementer can satisfy Story 1.8's explicit criteria without completing the public Withdraw contract.

Recommendation: add a dedicated Given/When/Then criterion for Withdraw to Story 1.8, including authenticated access, removal before drain, success after drain, 404 for unknown targets, and unchanged state on rejection.

### Minor Concerns

#### Story 1.9 omits the documented keyboard shortcut

The UX contract requires `Cmd` or `Ctrl` plus Enter to use the same action and guard as the Send control.
Story 1.9 states only that plain Enter inserts a newline.

Recommendation: add acceptance and E2E coverage for shortcut discoverability and blocked-state parity.

#### Story 1.1 leaves three default expansion states implicit

The read architecture requires running, interrupted, and unknown rows to start collapsed, while failed rows start open.
Story 1.1 explicitly covers only successful and failed rows.

Recommendation: add one table-driven acceptance criterion for the initial open state of all five outcomes.

#### Story 1.3 leaves deterministic diff traps to references

Story 1.3 names `maxEditLength`, but its explicit criteria omit the byte ceiling, repeated and mid-array no-newline markers, repeat determinism, memoization, and adapter line-number validity.
The companion test contract covers these cases, so the implementation path exists, but the story can be closed without proving all of them if references are not treated as binding.

Recommendation: state that the `diff-hunks.test.ts` contract is part of Story 1.3 completion, or copy the few failure-oracle criteria into the story.

#### Story 1.12b does not explicitly test idle expiry with an existing queue

The engine contract requires every interrupted end to enter idle-await regardless of queued messages.
Story 1.12b describes the timeout for an idle agent with nothing sent, which can be read as an empty queue only.

Recommendation: add a queued-message timeout case that fails once, tears down the registry, and relies on Story 1.12a to restore unmatched messages as `Never sent`.

### Story-by-Story Compliance Summary

| Story | User value                     | Dependency direction      | Acceptance quality                                   | Result            |
| ----- | ------------------------------ | ------------------------- | ---------------------------------------------------- | ----------------- |
| 1.1   | Direct read value              | Valid                     | Specific; minor state omission                       | Pass with concern |
| 1.2   | Direct read value              | Valid                     | Specific and measurable                              | Pass              |
| 1.3   | Direct read value              | Valid                     | Core path clear; edge criteria indirect              | Pass with concern |
| 1.4   | Direct read value              | Valid                     | Complete through binding contract                    | Pass              |
| 1.5   | Direct read value              | Valid                     | Specific and testable                                | Pass              |
| 1.6   | Direct navigation value        | Valid                     | Contains an unimplementable server-refusal criterion | Major issue       |
| 1.7a  | Enabling technical work        | Valid                     | Testable but oversized                               | Major issue       |
| 1.7b  | Enabling technical work        | Valid                     | Testable but oversized                               | Major issue       |
| 1.8   | Enabling technical work        | Valid                     | Withdraw route is implicit                           | Major issue       |
| 1.9   | Direct queueing value          | Valid                     | Blocked by ownership conflict; shortcut omitted      | Critical issue    |
| 1.10  | Direct steering value          | Valid                     | Specific and end-to-end                              | Pass              |
| 1.11  | Direct record value            | Valid                     | Specific across storage and UI                       | Pass              |
| 1.12a | Direct loss-prevention value   | Valid                     | Specific and testable                                | Pass              |
| 1.12b | Direct fail-safe value         | Valid                     | Queue-present expiry is implicit                     | Pass with concern |
| 1.12c | Direct multi-user value        | Valid                     | Specific and testable                                | Pass              |
| G1    | Deferred delivery-status value | Independent gate          | Specific                                             | Pass              |
| G2    | Deferred soft-inject value     | Incorrectly coupled gates | Provider criteria incomplete                         | Major issue       |
| G3    | Deferred soft-inject value     | Independent gate          | Specific                                             | Pass              |

### Best-Practices Compliance

- Epic delivers user value: pass.
- Epic independence: pass.
- Story dependency direction: pass.
- Database timing: pass.
- Clear BDD structure: pass.
- Story independence and standalone value: fail for 1.7a, 1.7b, and 1.8 by explicit owner-approved exception.
- Story sizing: fail for 1.7a and 1.7b.
- Acceptance completeness: fail for Story 1.6's target identity, Story 1.8's Withdraw route, and G2's provider gates.
- FR traceability: complete at capability level, but detailed requirements remain partly reference-based.

## Summary and Recommendations

### Overall Readiness Status

**NOT READY** for full Phase 4 implementation.

The plan has complete functional coverage, final UX documents, two feature architecture spines, valid backward dependency order, and strong test contracts.
Implementation must not start as one full feature because the queued-message ownership contract is contradictory and Story 1.6 requires server behavior that the typed API cannot identify.

The read-only transcript slice is substantially better prepared than the steering slice.
Its remaining concerns are acceptance-detail gaps rather than architecture blockers.

### Critical Issues Requiring Immediate Action

1. Resolve whether post-`Queue` messages are tab-local or node-scoped in the server registry.
   The existing registry architecture supports node-scoped server messages, while only unqueued composer text can be per-tab.
   Update CAP-8, `EXPERIENCE.md`, the handoff, Story 1.9, and E2E expectations as one change.

2. Resolve the finished-iteration target contract.
   The current Send route and registry carry no occurrence, retry, or iteration identity, so they cannot return `not_steerable_here` because a user viewed an old iteration.
   Either remove the server-refusal criterion and rely on the read-only UI, or intentionally extend the wire and registry contracts.

3. Separate the OMP soft-inject path from the Claude `AsyncIterable` spike.
   Each provider path needs an independent gate, acceptance criterion, and conformance test.

### Recommended Next Steps

1. Apply the node-scoped server-queue model and reserve `this tab only` for unqueued composer text.
2. Choose and document one finished-iteration rule before Story 1.6 implementation.
3. Split G2 into independent Claude and OMP gates.
4. Add the Withdraw route acceptance criterion to Story 1.8.
5. Add the keyboard shortcut, five-outcome initial expansion table, complete diff failure oracles, and queued-message idle-expiry case to their owning stories.
6. Decide whether to keep the owner-ratified hybrid story structure or relabel Stories 1.7a through 1.8 as enabling tasks under the end-to-end steering outcome.
7. Expand the formal coverage map beyond the 13 capability ids if detailed requirement traceability will be used during implementation review.
8. Re-run implementation readiness after the contract edits and before starting the steering stories.

### Final Note

This assessment identified 10 unique issues across contract alignment, API and architecture alignment, story structure, and acceptance coverage.
The count comprises 1 critical issue, 5 major issues, and 4 minor concerns.
All 28 extracted functional requirements have implementation paths, so the work needs targeted contract repair rather than a redesign.

**Assessment date:** 2026-09-15.
**Assessor:** BMAD Implementation Readiness workflow.
