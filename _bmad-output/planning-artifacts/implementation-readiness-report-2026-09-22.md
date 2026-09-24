---
stepsCompleted:
  - step-01-document-discovery
  - step-02-prd-analysis
  - step-03-epic-coverage-validation
  - step-04-ux-alignment
  - step-05-epic-quality-review
  - step-06-final-assessment
target: agent-node-room
inputDocuments:
  - ../specs/spec-agent-node-room/SPEC.md
  - ../specs/spec-agent-node-room/tool-presentation-contract.md
  - ../specs/spec-agent-node-room/todo-fold-contract.md
  - ../specs/spec-agent-node-room/test-plan.md
  - ../specs/spec-agent-node-room/engine-integration.md
  - ../specs/spec-agent-node-room/provider-steering-matrix.md
  - ../specs/spec-agent-node-room/control-states.md
  - ../specs/spec-agent-node-room/steering-api-contract.md
  - ../specs/spec-agent-node-room/steering-test-plan.md
  - architecture/architecture-Archon-readable-agent-transcript-2026-09-12/ARCHITECTURE-SPINE.md
  - architecture/architecture-Archon-live-agent-steering-2026-09-12/ARCHITECTURE-SPINE.md
  - epics-agent-node-room/epics.md
  - ux-designs/ux-Archon-agent-node-room-2026-09-09/DESIGN.md
  - ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md
  - mockup-manifests/agent-node-room.json
---

# Implementation Readiness Assessment Report

**Date:** 2026-09-22
**Project:** Archon

## Document Discovery

### PRD and Requirements Files

**Canonical document:**

- `../specs/spec-agent-node-room/SPEC.md` — 30,289 bytes; modified 2026-09-21 16:46:55 +0700

**Supporting target contracts:**

- `../specs/spec-agent-node-room/tool-presentation-contract.md` — 25,042 bytes; modified 2026-09-21 16:32:50 +0700
- `../specs/spec-agent-node-room/todo-fold-contract.md` — 6,152 bytes; modified 2026-09-21 16:32:50 +0700
- `../specs/spec-agent-node-room/test-plan.md` — 15,486 bytes; modified 2026-09-21 16:32:50 +0700
- `../specs/spec-agent-node-room/engine-integration.md` — 7,497 bytes; modified 2026-09-21 16:58:37 +0700
- `../specs/spec-agent-node-room/provider-steering-matrix.md` — 5,546 bytes; modified 2026-09-21 16:58:37 +0700
- `../specs/spec-agent-node-room/control-states.md` — 12,284 bytes; modified 2026-09-21 16:24:54 +0700
- `../specs/spec-agent-node-room/steering-api-contract.md` — 11,045 bytes; modified 2026-09-21 16:25:57 +0700
- `../specs/spec-agent-node-room/steering-test-plan.md` — 8,001 bytes; modified 2026-09-21 16:34:18 +0700

### Architecture Files

The two selected architecture spines are complementary target scopes, not duplicate document forms.

- `architecture/architecture-Archon-readable-agent-transcript-2026-09-12/ARCHITECTURE-SPINE.md` — 40,097 bytes; modified 2026-09-21 16:31:58 +0700
- `architecture/architecture-Archon-live-agent-steering-2026-09-12/ARCHITECTURE-SPINE.md` — 10,739 bytes; modified 2026-09-21 16:29:02 +0700

### Epic and Story Files

- `epics-agent-node-room/epics.md` — 71,415 bytes; modified 2026-09-21 16:44:36 +0700

### UX Files

The selected `DESIGN.md` and `EXPERIENCE.md` files are complementary parts of one target UX package.

- `ux-designs/ux-Archon-agent-node-room-2026-09-09/DESIGN.md` — 64,872 bytes; modified 2026-09-21 16:55:04 +0700
- `ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md` — 188,929 bytes; modified 2026-09-21 16:56:00 +0700

### Mandatory Mockup Contract

- `mockup-manifests/agent-node-room.json` — 146,780 bytes; modified 2026-09-22 01:30:20 +0700

### Discovery Issues

No whole-versus-sharded duplicates were found in the selected target lineage.
No required document type is missing.
Unrelated project artifacts and earlier readiness reports are excluded from the assessment source set.

## PRD Analysis

### Functional Requirements

**FR1 — Scannable collapsed transcript rows.**
Each tool call must render as one line with a family chip, status glyph, salient headline, and right-aligned badges.
Successful calls must start collapsed, failed calls must start expanded, and collapsed rows must not contain serialized-data punctuation.

**FR2 — Family-specific expanded tool bodies.**
Every supported tool family must render the body arm in `tool-presentation-contract.md`.
An unmatched tool must show at most three scalar `key: value` fields, must collapse objects and arrays to `{…}` or `[n]`, and must never show a JSON dump outside Raw.
Generic fallback must remain below 2 percent of logical tool cards in the production corpus.

**FR3 — Todo state projection.**
OMP and Claude todo inputs must normalize to the same `TodoPhase[]` state.
Earlier todo mutations must remain one-line `todo updated` rows, and the latest applicable todo row must expose the approved inline checklist.
An empty phase must disappear.
A collapsible todo strip must be outside and below the transcript scroller, immediately above the queue and composer dock.
The strip must be absent when the node has no todos, and terminal presentation must not rewrite stored todo events.

**FR4 — Subagent dispatch presentation.**
OMP and Claude task inputs must normalize to `TaskSubtask[]`.
The UI must render provider-supplied batch context as Markdown and one collapsible card per subtask with the subtask and agent names.

**FR5 — File-change presentation.**
A file tool row with both before and after strings must render an inline line diff through the shared bounded diff contract.
A row without both sides must show a path and preview and must never invent a diff.
Successful Codex `file_change` events must be normalized and persisted before presentation and must use the same readable body and Raw rules as other file rows.

**FR6 — Occurrence and loop execution navigation.**
Rows from more than one `occurrence_id` must render one header per occurrence, and a single occurrence must render no header.
Grouping must never use `attempt_id`.
The loop execution selector must target occurrence headers and must be absent for a single occurrence.
A finished iteration selected through execution controls must show a read-only dock and the shared pending queue, must provide a return to the live iteration, and must issue no send, withdraw, or interrupt mutation.

**FR7 — Raw payload access.**
Every tool card must have a Raw toggle that is closed by default and reveals the original JSON.
Raw must be the only place where serialized tool input or output JSON appears.
The existing full-output load flow must continue to work.

**FR8 — Compose and queue while the agent works.**
The composer must remain mounted and enabled while the node runs, and the main action must read `Queue`.
Queueing must not interrupt the active turn.
The message must become the next turn after a natural turn end.
The author's draft and the node queue must be server-persisted, visible at their approved scopes, and survive tab closure and server restart.

**FR9 — Stop the current provider turn only.**
The Node Room `Stop` action must end the current provider turn through `AgentRequestOptions.interruptSignal` without stopping the node or workflow run.
The provider session must remain reusable, and the active tool must show `interrupted`, not `failed`.
Stop must act on the full turn and must not imply rollback of completed side effects.

**FR10 — Redirect on the same live session.**
In `idle-after-interrupt`, the main action must read `Send now`.
It must persist the newly typed message and claim eligible durable queue entries in server FIFO order as the next turn on the same provider session.
The node must continue without entering a workflow pause state.

**FR11 — Auditable operator exchange.**
Operator messages and interrupted tool calls must appear as ordered transcript rows between the work they interrupted and the work they caused.
Operator content must be visibly distinct from agent text.

**FR12 — Verified per-item mid-turn delivery.**
All providers must support queue-at-boundary delivery.
When provider conformance proves mid-turn delivery, each queued item must show `Send now` while the agent is generating.
That per-item action must inject the selected queued message into the active provider turn, must not call Stop, must not change the active tool outcome, and must not emit a steering-owned turn-start event.
The PRD set does not explicitly state that the selected item leaves the queue or that every non-selected queue item keeps its content, identity, order, and queued state.
A queue-only provider must omit the per-item action.

**FR13 — Truthful delivery state.**
A message must remain `sent` until verified provider evidence acknowledges the caller-stamped message ID.
Only then may it become `delivered`.
Providers without verified acknowledgement must remain at `sent` or `delivery unknown` and must not infer delivery from message text, timestamps, or transcript proximity.

**FR14 — Restart recovery.**
After server restart, Archon must restore the author's draft, node queue, FIFO order, delivery state, and auto-send setting.
It must not claim that the old SDK process survived, change ambiguous work to a terminal state, resume automatically, or resend an ambiguous dispatch.
The operator must continue through the existing Resume feature.

**FR15 — Durable auto-send.**
Auto-send must be durable and must send one queued item in server FIFO order after each natural agent reply.
Disabling auto-send must preserve the queue.
An interrupted turn must never auto-send and must wait for `Send now`.
A confirmed delivery failure must return the item to the queue with an accessible error.

**FR16 — Cross-surface readable-tool parity.**
Node Room, RunStream, Chat, and backend-generated cards must use the same family, headline, outcome, badge, body, fallback, and Raw semantics while they keep their package boundaries and markup shells.

**FR17 — Run and node source-control impact.**
The run must show a Files Changed panel, and node executions must show Git attribution from repository evidence.
Unknown attribution must be labeled unknown and must not be inferred from natural-language output.

**FR18 — Steering for every approved provider.**
Claude, Codex, Grok, DeepSeek, OMP, Qoder CLI, Pi, GitHub Copilot, and OpenCode must support their declared Stop, continuation, queue, soft-injection, and acknowledgement capabilities.
Every adapter must honor `interruptSignal`, preserve a reusable session where supported, report truthful capabilities, and pass the shared conformance contract.

**FR19 — Safe thinking presentation.**
Authorized users must be able to inspect provider thinking only through explicit normalization, persistence, privacy, truncation, ordering, presentation, and Raw rules.
Hidden provider reasoning must not be exposed or logged.

**FR20 — Triggering prompt provenance.**
The prompt that caused a node occurrence must be persisted with its node, occurrence, source, and actor attribution and must follow the approved sensitive-data and visibility rules.

**FR21 — Advisor notifications in transcript order.**
Advisor notifications must have a persisted type, deterministic sequence, readable presentation, identity, and accessible placement relative to tool, assistant, and operator rows.

**Total functional requirements: 21.**

### Non-Functional Requirements

**NFR1 — Type safety and validation.**
All implementation must use strict TypeScript, must not use unjustified `any`, must pass ESLint with zero warnings, and must pass `bun run validate`.

**NFR2 — Package boundaries.**
`@archon/web` must not import from `@archon/workflows`.
Console must not import from `@/components/` or the banned `@/lib/api` path.
Backend formatting must not import Web code.

**NFR3 — Both presentation surfaces.**
Legacy and Console Node Rooms must ship together with equivalent behavior.
Console must be verified at 520 pixels and Legacy at 460 pixels.

**NFR4 — Accessibility.**
Status must be understandable without color.
Keyboard use, focus movement, reduced motion, live-region behavior, explicit newline entry, assertive failure alerts, and polite ordinary updates must work in both Node Room shells.
The `Stopping…` control must use `aria-disabled` so focus does not fall to `<body>`.

**NFR5 — Bounded presentation work.**
Expanded text, command, code, and assembled Web Markdown must not exceed 65,536 code units.
List channels must emit at most 500 items and inspect at most 2,000 entries.
Paths, match text, titles, URLs, field keys, and scalar values must use the declared bounds, and every cut must remain visible.

**NFR6 — Deterministic diff processing.**
Diff qualification and output must use deterministic byte, line, edit-length, context, sanitization, and memoization bounds.
Over-limit, thrown, or undefined diff results must degrade to path plus preview without blocking the UI.

**NFR7 — Safe display of hostile content.**
ANSI, C0, C1, bidi, zero-width, and separator controls must not create hidden, reordered, or fake display lines.
Raw must retain the original payload.

**NFR8 — Fail-safe malformed input handling.**
Malformed provider values must degrade to bounded unreadable or generic output and must not throw.
Malformed todo snapshots and batches must be atomic no-ops.
Unclassifiable assistant text must render its original bytes unchanged.

**NFR9 — Durable and atomic state.**
Drafts, queue entries, FIFO order, delivery intent and state, message identity, attribution, and auto-send settings must persist transactionally.
An acknowledgement must follow database commit, and a failed transaction must leave queue, transcript, and delivery state unchanged.

**NFR10 — Race and idempotency safety.**
Duplicate message IDs, repeated Stop requests, and queue withdrawal must be idempotent at their declared boundaries.
Every rejected request must leave live execution and durable state unchanged.
A stale turn signal must never stop the next turn.

**NFR11 — Process-boundary safety.**
After restart, the system must not infer process origin or autonomously complete, fail, cancel, abandon, resume, or resend ambiguous non-terminal work.

**NFR12 — Authentication and attribution.**
Steering routes must resolve identity through `resolveAuthContext`, reject unauthenticated access, and attribute every mutation to `operator_user_id` under the steering actor grant.

**NFR13 — Privacy and logging.**
Draft and queue reads must not log message contents.
Thinking and sensitive prompt data must follow explicit privacy and visibility rules.

**NFR14 — Typed API compatibility.**
All steering routes must use OpenAPI registration, Zod-derived schemas, one typed error shape, and regenerated Web API types.
Queue reads and all queue-read errors must set `Cache-Control: no-store`.

**NFR15 — Database portability and upgrade safety.**
Durable steering storage must work in SQLite and PostgreSQL.
Fresh-install, upgrade, reapply, schema-parity, and PostgreSQL schema-upgrade checks must pass.

**NFR16 — Deterministic tests.**
Provider tests must use deterministic adapter fixtures without normal-suite network access.
Timer tests must use an injected scheduler.
Restart end-to-end tests must keep the same database across a real server restart and must stop every process they start.

**NFR17 — Transcript ordering.**
The executor must be the sole writer of ordered operator transcript receipts.
Server sequence must place every receipt at the correct boundary between provider turns.

**NFR18 — Provider capability truthfulness.**
The UI must use capability data and must not branch on provider names.
No provider may advertise soft injection or acknowledgement until its exercised adapter path proves it.

**NFR19 — Production quality gate.**
The release-time generic-fallback audit must use logical tool cards, exact integer threshold comparison, safe source and record validation, and a recorded corpus timestamp.
Release must fail when fallback is at least 2 percent.

**Total non-functional requirements: 19.**

### Additional Requirements

**AR1 — Shared presentation owner.**
`packages/web/src/lib/tool-presentation.ts` must own the provider-neutral summary and lazy body contracts.
Renderers must add only their own markup.

**AR2 — Tool classification.**
The resolver must use the four declared tiers in order, must match aliases as exact normalized tokens rather than substrings, and must preserve provider-sent display names.

**AR3 — Search and glob semantics.**
Glob headline and scope behavior must distinguish Claude and OMP input shapes.
Search body selection must follow `output_mode`, structured output evidence, and the declared alias default order.

**AR4 — Codex command presentation.**
The fixed shell wrapper must be removed for the headline only.
A multiline command must use its first non-empty line with an ellipsis while the full command remains in the body and Raw payload.

**AR5 — Todo fold.**
Claude snapshots must use last-call-wins semantics.
OMP must implement the nine declared operations, all-targeting bare operations, atomic legacy batches, inference for missing `op`, and auto-promotion after every successful mutation.

**AR6 — Durable and volatile plane separation.**
The durable store must own content and recovery data.
The in-memory registry must own only the active provider handle, active turn, fresh per-turn interrupt controller, and live idle timer.
A live SDK handle must never be serialized.

**AR7 — Turn-end classification.**
The executor must distinguish natural end, operator-interrupted result, operator-interrupted exception, provider failure, and node-level termination from provider-normalized evidence.
An interrupted partial result must not be validated, completed, or advanced.

**AR8 — Multi-turn continuation.**
Natural ends may claim eligible durable queue work according to the queue and auto-send rules.
Interrupted ends must enter idle-after-interrupt and must drain only after the operator selects `Send now`.

**AR9 — Durable message state machine.**
The store must distinguish draft, queued, awaiting-send-now, dispatching, sent, delivered, delivery-unknown, withdrawn, and failed outcomes.
A delivery-unknown message must never be resent automatically.

**AR10 — Operator receipt schema.**
A delivered operator receipt must be an ordinary text row with strict metadata for `origin='operator'`, `operator_user_id`, and `message_id`.
The executor must be the sole writer.

**AR11 — Steering routes.**
The implementation must provide the declared draft, auto-send, send, interrupt, keepalive, withdraw, and queue-read routes with the exact request, response, error, status, idempotency, and race behavior in `steering-api-contract.md`.

**AR12 — Finished and historical views.**
A finished node with no durable content must show no dock.
Undelivered terminal content must stay readable and read-only.
A non-live execution must have no steering dock.

**AR13 — Idle timer.**
The 30-minute inactivity rule must apply only while the live process owns an idle-after-interrupt handle.
Composer activity must re-arm the timer.
Restart must replace the lost live timer with recovery-required state.

**AR14 — Provider matrix.**
Claude, Codex, Grok, DeepSeek, OMP, Qoder CLI, Pi, GitHub Copilot, and OpenCode must implement and test the exact declared Stop, continuation, soft-injection, and acknowledgement behavior.

**AR15 — Data source integrity.**
Successful Codex file changes, thinking, triggering prompts, and advisor notifications need explicit typed persistence before shared presentation.

**AR16 — Test evidence.**
The focused unit, renderer, cross-surface, provider, API, database, restart, visual, accessibility, and boundary tests in both test plans are acceptance work, not optional follow-up.

**AR17 — Exclusions.**
The change must not modify historical workflow Cancel behavior, add individual-tool cancellation, or add CLI `--detach` Node Room behavior.

### PRD Completeness Assessment

The PRD set is detailed and states that all 21 capabilities are current scope.
It explicitly removes provider verification, SDK changes, durable recovery, auto-send, per-item soft injection, acknowledgement, and conformance work from any future or optional category.
The source set has no unresolved product-scope question.
Traceability must still prove that Architecture and the new Epic and Stories cover every requirement and every manifest `CHANGE_FEATURE` behavior exactly.

## Epic Coverage Validation

### Coverage Basis

Epic 1, Epic 2, Stories 1.1 through 2.13, and G1 through G4 are completed historical planning records.
They are used only as the implemented baseline and as dependency evidence.
Epic 3 through Epic 9 and Stories 3.1 through 9.4 own the current change work.

### Coverage Matrix

| FR | PRD requirement | Epic and Story coverage | Status |
| --- | --- | --- | --- |
| FR1 | Scannable collapsed transcript rows | Completed Story 1.1 baseline; current shell and interaction work in Stories 3.1 and 3.3 | COVERED |
| FR2 | Family-specific expanded tool bodies and bounded fallback | Completed Story 1.3 baseline; current cross-surface work in Stories 4.2 through 4.4 | COVERED |
| FR3 | Folded todo state, inline latest checklist, and below-scroller strip | Story 3.2 | COVERED |
| FR4 | Normalized subagent dispatch presentation | Completed Story 1.6 baseline; no manifest change requires new implementation | COVERED |
| FR5 | Inline diff and persisted Codex file changes | Completed Story 1.4 baseline; current Codex ingestion in Story 4.1 | COVERED |
| FR6 | Occurrence grouping and loop execution navigation | Completed Story 1.7 baseline; current transcript interaction in Story 3.3 | COVERED |
| FR7 | Raw payload access | Completed Story 1.2 baseline; current interaction verification in Story 3.3 | COVERED |
| FR8 | Server-persisted author draft and node queue | Stories 7.1 through 7.3 | COVERED |
| FR9 | Stop only the current provider turn | Stories 8.1, 8.2, 8.3 through 8.7, and 9.1 through 9.4 | COVERED |
| FR10 | Redirect and continue on the same session | Stories 8.3 through 8.7 and 9.1 through 9.4 | COVERED |
| FR11 | Ordered and attributed operator transcript receipts | Completed Story 2.8 baseline; current durable identity and delivery work in Stories 7.3, 8.3, and 8.8 | COVERED |
| FR12 | Verified per-item active-turn soft injection | Stories 8.3, 8.5, 8.7, and 8.8 cover provider gating, selected-message injection, and no Stop, but do not require every other queued message to remain unchanged | PARTIAL |
| FR13 | Evidence-backed delivery acknowledgement | Stories 8.3 and 8.8 | COVERED |
| FR14 | Restart recovery through existing Resume | Story 7.4 | COVERED |
| FR15 | Durable one-item auto-send after natural replies | Story 7.5 | COVERED |
| FR16 | Cross-surface readable-tool parity | Stories 4.2 through 4.4 | COVERED |
| FR17 | Files Changed and deterministic Git attribution | Stories 5.1 and 5.2 | COVERED |
| FR18 | Stop and redirect across all approved providers | Stories 8.3 through 8.8 and 9.1 through 9.4 | COVERED |
| FR19 | Safe displayable-thinking persistence and presentation | Story 6.1 | COVERED |
| FR20 | Triggering prompt persistence and provenance | Story 6.2 | COVERED |
| FR21 | Ordered advisor notification persistence and presentation | Story 6.3 | COVERED |

### Missing and Partial Requirements

No FR is wholly absent from the Epic and Stories document.

**FR12 is partial.**
The current Stories prove that per-item `Send now` sends a selected message into an active verified provider turn and does not invoke Stop.
They do not state the required remaining-state rule that every non-selected queued message keeps its content, identity, order, and queue state.
This omission leaves collection mutation and remaining state untestable at Story acceptance level.
Stories 8.3, 8.5, and 8.7 must state that only the selected queue item leaves the queued collection and that all other queue items remain unchanged.

### Traceability Defects

Story 4.1 cites Agent Node Room CAP-14 for Codex file-change persistence.
The canonical PRD defines CAP-14 as restart recovery.
Codex file-change persistence belongs to CAP-5, with cross-surface use under CAP-16.
This wrong reference does not create a new requirement, but it weakens traceability and must be corrected before implementation.

The historical top-of-file FR inventory and `Post-v1 gated backlog` contain the old scope state.
The approved course-correction section explicitly marks those records complete and historical.
This assessment does not count them as future, deferred, optional, or current implementation coverage.

### Coverage Statistics

- Total PRD FRs: 21
- Fully covered FRs: 20
- Partially covered FRs: 1
- Missing FRs: 0
- Strict full-coverage percentage: 95.2 percent

## UX Alignment Assessment

### UX Document Status

The final `DESIGN.md` and `EXPERIENCE.md` documents exist for the target lineage.
Both documents are part of the canonical PRD contract through `SPEC.md`.
Both architecture spines list the UX package as a companion or verification source.

### Manifest-to-Document Alignment

| Manifest feature | PRD and UX | Architecture | New Epic or Story | Alignment result |
| --- | --- | --- | --- | --- |
| M001 — fixed 520-pixel Console room | Exact in `DESIGN.md:538` and adopted by `SPEC.md` | `live-agent-steering/ARCHITECTURE-SPINE.md:273` requires both Node Room widths but does not state 520 | Story 3.1 states 520 pixels | PARTIAL |
| M002 — fixed 460-pixel Legacy room | Exact in `DESIGN.md:538` and adopted by `SPEC.md` | `live-agent-steering/ARCHITECTURE-SPINE.md:273` requires both Node Room widths but does not state 460 | Story 3.1 states 460 pixels | PARTIAL |
| M003 — todo strip below the transcript scroller | Exact in `SPEC.md:69` and `EXPERIENCE.md:129` | Exact in readable-transcript AD-12 at `ARCHITECTURE-SPINE.md:171` | Exact in Story 3.2 | MATCHED |
| M004 — latest todo row shows the checklist and earlier rows stay compact | Exact in `SPEC.md:69` and `EXPERIENCE.md:129-130` | Exact in readable-transcript AD-12 and AD-21 at `ARCHITECTURE-SPINE.md:170,231` | Exact in Story 3.2 | MATCHED |
| M005 — live execution is the default and the selector exposes at most eight entries | The selected documents define live and stale execution behavior but do not state an eight-entry maximum | No architecture decision states an eight-entry maximum | Story 3.3 does not state the default-live and eight-entry rule | MISSING |
| M006 — queued drafts are durable and shared by the server | Exact in `SPEC.md:92,175` and `EXPERIENCE.md:222` | Exact in live-steering AD-3 and AD-4 | Exact in Stories 7.1 through 7.3 | MATCHED |
| M007 — projected `Auto-send on` status indicator | CAP-15 defines durable auto-send, but the PRD and UX do not require the exact projected `Auto-send on` indicator | AD-9 defines behavior, but no decision defines the indicator | Story 7.5 requires a visible setting but not the indicator label or read-only projection | PARTIAL |
| M008 — per-item `Send now` injects one selected message without Stop and preserves every other queued message | `SPEC.md` CAP-12, `steering-api-contract.md:32`, and `EXPERIENCE.md:140,143` prove a selected item and no Stop, but they do not state that every non-selected queue item remains unchanged | AD-8 and AD-12 gate per-item action by capability, but they do not define single-item collection mutation or the remaining queue state | Stories 8.3, 8.5, and 8.7 use one message and prohibit Stop, but do not preserve every other queued item explicitly | PARTIAL |
| M009 — unmatched durable messages become read-only `Never sent` records | Exact terminal wording and behavior appear in `EXPERIENCE.md:142,189,267`, and `SPEC.md:178-179` requires durable reconciliation | AD-7 and AD-12 define delivery evidence and read-only terminal views, but do not require every unmatched durable message to become `Never sent` | No current Story 3 through 9 owns this durable terminal reconciliation; completed Story 2.11 is only the old client-observation baseline | MISSING |
| M010 — 30-minute interrupted-idle timeout fails the node and preserves durable queue content | Exact behavior is in `EXPERIENCE.md:263` and the timer boundary is in `SPEC.md:184` | The live architecture names a volatile idle timer but does not define the 30-minute failure and durable `Never sent` outcome | No current Story 3 through 9 owns the timeout failure and durable preservation outcome; completed Story 2.12 is only the old process-local baseline | MISSING |
| M011 — restart recovery is read-only and requires explicit Resume | Exact in CAP-14, `SPEC.md:176`, and `EXPERIENCE.md:197` | Exact in live-steering AD-5 | Exact in Story 7.4 | MATCHED |
| M012 — `Delivered` requires matching provider acknowledgement | Exact in CAP-13 and `steering-api-contract.md:59` | Exact in live-steering AD-7 and AD-8 | Exact in Stories 8.3 and 8.8 | MATCHED |
| M013 — Codex cannot use the interrupted warning glyph | The manifest and `DESIGN.md:437` say Codex cannot produce the glyph, but CAP-9 and CAP-18 require provider-neutral interrupted outcomes | Live-steering AD-1 and AD-2 require an interrupted active tool for every supported provider | Story 8.4 explicitly requires the Codex tool row to become `interrupted` | CONFLICT |

### Reconciliation Attempts

M001 and M002 can use the exact companion UX widths, so no behavior conflict exists.
The Architecture spines still lack exact numeric decisions, which makes both rows partial under the exact-citation gate.

M007 could be implemented as a projected label beside a separate setting control.
No selected document requires that label, so this is missing information rather than a conflict.

M008 could be implemented by atomically claiming only `queued_message_id` and leaving all other queue rows untouched.
No PRD, Architecture, UX, or current Story clause requires the untouched remainder, so the required behavior is partial and cannot be inferred from the per-item label.

M009 could use durable queue and receipt evidence to derive terminal `Never sent` rows.
The Architecture and current Stories do not require this exact transition, so completed client-side reconciliation does not close the current durable gap.

M010 could combine the existing live timer with durable reconciliation.
The Architecture and current Stories do not require that combination, so it remains a current-scope gap.

M013 cannot be reconciled as a projection or provider default.
A Codex row cannot both be prohibited from the interrupted warning glyph and be required to become `interrupted` after Stop.
The claims are normative and mutually exclusive.

### UX and Architecture Warnings

`EXPERIENCE.md:170` is internally inconsistent.
It first says that Codex cannot produce `interrupted`, then says steering makes the outcome universal for every provider.

The readable-transcript Architecture capability map still labels CAP-14 as Codex ingestion and CAP-15 as auto-send display.
The canonical PRD defines CAP-14 as restart recovery and CAP-15 as durable auto-send.
This is a traceability defect even where the implementation mechanism is otherwise usable.

The UX package contains complete behavior for terminal `Never sent` and the 30-minute idle failure, but current Architecture and Story ownership do not match it.

## Epic Quality Review

### Review Scope

This quality review treats Epic 1, Epic 2, Stories 1.1 through 2.13, and G1 through G4 as completed historical records.
It reviews Epic 3 through Epic 9 and Stories 3.1 through 9.4 as the current delivery plan.

### Epic Structure

All current Epics state an operator outcome rather than a technical milestone.
Each Epic can deliver user value after its declared earlier dependencies.
No Epic depends on a later Epic.
No Story declares a forward dependency on a later Story.
The project is brownfield, so no starter-template or initial-project-setup Story is required.
Additive steering records first appear in Story 7.1, which is the first current Story that needs durable steering storage.

### Critical Violations

**Story 8.4 conflicts with the mandatory mockup contract.**
Story 8.4 requires a persisted Codex tool row to become `interrupted` after Stop.
Manifest M013 requires that a Codex tool row cannot use the interrupted warning glyph.
These outcomes are mutually exclusive and cannot share one implementation.

### Major Issues

**No current Story owns M005.**
No Story requires the execution selector to default to the live execution and expose at most eight entries.
Story 3.3 covers general transcript interaction but does not state this behavior.

**No current Story owns M009.**
No Story requires every unmatched durable message to become a read-only `Never sent` record at terminal reconciliation.
Completed Story 2.11 describes the old client-observation baseline and is not current implementation ownership.

**No current Story owns M010.**
No Story requires the live 30-minute interrupted-idle timeout to fail the node and preserve durable queue content as read-only `Never sent` records.
Completed Story 2.12 describes the old process-local baseline and is not current implementation ownership.

**Story 7.5 does not accept M007.**
It requires durable auto-send behavior and observer visibility, but it does not require the exact projected `Auto-send on` indicator.

**Stories 8.3, 8.5, and 8.7 do not accept the complete M008 behavior.**
They require one provider message to enter through verified soft injection without Stop.
They do not require that only the selected queue item changes state and that every non-selected queue item keeps its identity, content, order, and queued state.

**Story 4.1 has an incorrect capability reference.**
It cites CAP-14 for Codex file-change persistence.
The canonical PRD defines CAP-14 as restart recovery.
The correct primary capability is CAP-5, with cross-surface use under CAP-16.

### Minor Concerns

The document's opening Overview, initial Epic List, initial FR Coverage Map, and `Post-v1 gated backlog` describe the completed historical plan before the later approved course-correction section.
The course correction is explicit and controls this assessment, so these historical sections do not make visible features future or deferred.
Their placement still makes the document harder to interpret and increases the risk of using stale scope labels.

### Dependency Review

| Current Epic | Declared prerequisite | Forward dependency | Result |
| --- | --- | --- | --- |
| Epic 3 | Completed transcript baseline | None | PASS |
| Epic 4 | Epic 3 shell completion and completed file presentation baseline | None | PASS |
| Epic 5 | Epic 4 semantic presentation completion | None | PASS |
| Epic 6 | Epic 4 semantic presentation completion | None | PASS |
| Epic 7 | Epic 3 interaction completion | None | PASS |
| Epic 8 | Epic 7 durable queue and current provider foundations | None | PASS |
| Epic 9 | Epic 8 truthful capability projection | None | PASS |

### Epic Quality Result

The Epic sequence and dependency direction are structurally sound.
The current Stories are not implementation-ready because required manifest behaviors are missing, partial, or conflicting in their acceptance criteria.

## Mockup Contract Audit

### Change Boundary

The approved mockups change node-room sizing, todo placement and rendering, loop selection limits, steering durability and recovery, verified active-turn injection, delivery acknowledgement, and Codex status rules. All other inventoried product behavior remains current unchanged context.

- **implementation:** `packages/web/src/lib/room-split-layout.ts#current-room-width-contract` — The current room uses a resizable percentage split rather than the approved fixed Console and Legacy widths, and the inspected steering implementation remains process-local and non-durable.
- **epic:** `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#completed-epics-1-and-2` — The completed node-room Epics define the existing readable transcript and live steering baseline but do not include the approved durable steering, recovery, acknowledgement, sizing, and provider-specific changes.

The immutable manifest contains 13 `CHANGE_FEATURE` rows and 19 `UNCHANGED_CONTEXT` rows.

Every manifest behavior field is `PROVEN`, every open question is null, and the manifest contains no unclear action-identity group.

### Mockup Behavior Evidence Ledger

#### M001 — Fixed 520-pixel Console room with a non-overlay dock

- **Mockup and state:** `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html` — Console node room layout.
- **Inventory and role:** I035; CHANGE_FEATURE; scope CURRENT; status PROVEN.
- **Action key:** none.
- **visible_presentation:** a 520-pixel Console node room with the steering dock below the transcript
  Evidence: interaction_code at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#layout=node-room-width-520-and-sibling-dock` — The approved mockup proves this behavior field: a 520-pixel Console node room with the steering dock below the transcript.
- **precondition:** a Console workflow node room is open
  Evidence: interaction_code at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#layout=node-room-width-520-and-sibling-dock` — The approved mockup proves this behavior field: a Console workflow node room is open.
- **trigger:** the Console node room renders
  Evidence: interaction_code at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#layout=node-room-width-520-and-sibling-dock` — The approved mockup proves this behavior field: the Console node room renders.
- **target_identity:** the open Console node room
  Evidence: interaction_code at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#layout=node-room-width-520-and-sibling-dock` — The approved mockup proves this behavior field: the open Console node room.
- **target_cardinality:** one node room
  Evidence: interaction_code at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#layout=node-room-width-520-and-sibling-dock` — The approved mockup proves this behavior field: one node room.
- **timing:** with the initial node-room layout
  Evidence: interaction_code at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#layout=node-room-width-520-and-sibling-dock` — The approved mockup proves this behavior field: with the initial node-room layout.
- **effect_on_active_work:** none; layout does not change the running node
  Evidence: interaction_code at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#layout=node-room-width-520-and-sibling-dock` — The approved mockup proves this behavior field: none; layout does not change the running node.
- **collection_mutation:** none
  Evidence: interaction_code at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#layout=node-room-width-520-and-sibling-dock` — The approved mockup proves this behavior field: none.
- **expected_result:** the transcript scrolls above a fixed sibling dock and its last row remains visible
  Evidence: interaction_code at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#layout=node-room-width-520-and-sibling-dock` — The approved mockup proves this behavior field: the transcript scrolls above a fixed sibling dock and its last row remains visible.
- **next_state:** the room remains 520 pixels wide until the room closes
  Evidence: interaction_code at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#layout=node-room-width-520-and-sibling-dock` — The approved mockup proves this behavior field: the room remains 520 pixels wide until the room closes.
- **Classification implementation:** `packages/web/src/lib/room-split-layout.ts#DEFAULT_RIGHT_PERCENT` — The current Console room uses the shared percentage split and resizable width contract rather than a fixed 520-pixel room.
- **Classification epic:** `_bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md#completed-responsive-split-layout` — The completed HITL run-room Epic defines the existing responsive percentage panel baseline.

#### M002 — Fixed 460-pixel Legacy room

- **Mockup and state:** `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html` — Legacy node room layout.
- **Inventory and role:** I036; CHANGE_FEATURE; scope CURRENT; status PROVEN.
- **Action key:** none.
- **visible_presentation:** a two-panel Legacy run view with a 460-pixel node room
  Evidence: interaction_code at `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html#layout=node-room-width-460` — The approved mockup proves this behavior field: a two-panel Legacy run view with a 460-pixel node room.
- **precondition:** a Legacy workflow node room is open
  Evidence: interaction_code at `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html#layout=node-room-width-460` — The approved mockup proves this behavior field: a Legacy workflow node room is open.
- **trigger:** the Legacy node room renders
  Evidence: interaction_code at `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html#layout=node-room-width-460` — The approved mockup proves this behavior field: the Legacy node room renders.
- **target_identity:** the open Legacy node room
  Evidence: interaction_code at `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html#layout=node-room-width-460` — The approved mockup proves this behavior field: the open Legacy node room.
- **target_cardinality:** one node room
  Evidence: interaction_code at `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html#layout=node-room-width-460` — The approved mockup proves this behavior field: one node room.
- **timing:** with the initial node-room layout
  Evidence: interaction_code at `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html#layout=node-room-width-460` — The approved mockup proves this behavior field: with the initial node-room layout.
- **effect_on_active_work:** none; layout does not change the running node
  Evidence: interaction_code at `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html#layout=node-room-width-460` — The approved mockup proves this behavior field: none; layout does not change the running node.
- **collection_mutation:** none
  Evidence: interaction_code at `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html#layout=node-room-width-460` — The approved mockup proves this behavior field: none.
- **expected_result:** the right node-room panel is 460 pixels wide
  Evidence: interaction_code at `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html#layout=node-room-width-460` — The approved mockup proves this behavior field: the right node-room panel is 460 pixels wide.
- **next_state:** the room remains 460 pixels wide until the room closes
  Evidence: interaction_code at `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html#layout=node-room-width-460` — The approved mockup proves this behavior field: the room remains 460 pixels wide until the room closes.
- **Classification implementation:** `packages/web/src/lib/room-split-layout.ts#DEFAULT_RIGHT_PERCENT` — The current Legacy run room uses a resizable percentage split rather than the approved fixed 460-pixel room.
- **Classification epic:** `_bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md#completed-responsive-split-layout` — The completed HITL run-room Epic defines the existing responsive percentage panel baseline.

#### M003 — Todo strip is a sibling below the transcript scroller

- **Mockup and state:** `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html` — todo projection strip in both node rooms.
- **Inventory and role:** I009, I043; CHANGE_FEATURE; scope CURRENT; status PROVEN.
- **Action key:** none.
- **visible_presentation:** one latest-todo strip between the transcript scroller and steering dock
  Evidence: rendered at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#state=todo-expanded element=todo-strip-below-scroller` — The approved mockup proves this behavior field: one latest-todo strip between the transcript scroller and steering dock.
- **precondition:** the selected execution has a supported latest todo projection
  Evidence: rendered at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#state=todo-expanded element=todo-strip-below-scroller` — The approved mockup proves this behavior field: the selected execution has a supported latest todo projection.
- **trigger:** the room projects the latest todo state
  Evidence: rendered at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#state=todo-expanded element=todo-strip-below-scroller` — The approved mockup proves this behavior field: the room projects the latest todo state.
- **target_identity:** the latest-todo projection strip
  Evidence: rendered at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#state=todo-expanded element=todo-strip-below-scroller` — The approved mockup proves this behavior field: the latest-todo projection strip.
- **target_cardinality:** one strip
  Evidence: rendered at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#state=todo-expanded element=todo-strip-below-scroller` — The approved mockup proves this behavior field: one strip.
- **timing:** during transcript rendering and whenever the latest todo projection changes
  Evidence: rendered at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#state=todo-expanded element=todo-strip-below-scroller` — The approved mockup proves this behavior field: during transcript rendering and whenever the latest todo projection changes.
- **effect_on_active_work:** none
  Evidence: rendered at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#state=todo-expanded element=todo-strip-below-scroller` — The approved mockup proves this behavior field: none.
- **collection_mutation:** none; the strip projects persisted transcript data
  Evidence: rendered at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#state=todo-expanded element=todo-strip-below-scroller` — The approved mockup proves this behavior field: none; the strip projects persisted transcript data.
- **expected_result:** the strip stays outside the transcript scroller and can disclose the latest checklist
  Evidence: rendered at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#state=todo-expanded element=todo-strip-below-scroller` — The approved mockup proves this behavior field: the strip stays outside the transcript scroller and can disclose the latest checklist.
- **next_state:** the transcript keeps independent scrolling above the projected strip
  Evidence: rendered at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#state=todo-expanded element=todo-strip-below-scroller` — The approved mockup proves this behavior field: the transcript keeps independent scrolling above the projected strip.
- **Classification implementation:** `packages/web/src/components/workflows/NodeTranscriptPane.tsx#TodoProgressStrip` — The current Legacy transcript places TodoProgressStrip before the transcript scroller, and the Console room follows the same pre-scroller pattern.
- **Classification epic:** `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Story-1.9` — The completed transcript Epic defines the existing todo projection but does not define the approved below-scroller placement.

#### M004 — Latest todo call uses the checklist renderer and earlier calls use a one-line update

- **Mockup and state:** `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html` — expanded OMP and Claude todo tools.
- **Inventory and role:** I114, I115, I116; CHANGE_FEATURE; scope CURRENT; status PROVEN.
- **Action key:** toggle-latest-todo-row.
- **visible_presentation:** the latest OMP todo and Claude TodoWrite row expands to a shared checklist while earlier calls read todo updated
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html#expanded-family=todo-projection-contract` — The approved mockup proves this behavior field: the latest OMP todo and Claude TodoWrite row expands to a shared checklist while earlier calls read todo updated.
- **precondition:** the transcript contains one or more supported todo calls
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html#expanded-family=todo-projection-contract` — The approved mockup proves this behavior field: the transcript contains one or more supported todo calls.
- **trigger:** the user opens the latest supported todo row
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html#expanded-family=todo-projection-contract` — The approved mockup proves this behavior field: the user opens the latest supported todo row.
- **target_identity:** the latest supported todo call in the selected execution
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html#expanded-family=todo-projection-contract` — The approved mockup proves this behavior field: the latest supported todo call in the selected execution.
- **target_cardinality:** one latest call
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html#expanded-family=todo-projection-contract` — The approved mockup proves this behavior field: one latest call.
- **timing:** immediate local disclosure
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html#expanded-family=todo-projection-contract` — The approved mockup proves this behavior field: immediate local disclosure.
- **effect_on_active_work:** none
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html#expanded-family=todo-projection-contract` — The approved mockup proves this behavior field: none.
- **collection_mutation:** none; persisted todo events are not rewritten
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html#expanded-family=todo-projection-contract` — The approved mockup proves this behavior field: none; persisted todo events are not rewritten.
- **expected_result:** the latest row shows the checklist and the projection strip uses the same latest state
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html#expanded-family=todo-projection-contract` — The approved mockup proves this behavior field: the latest row shows the checklist and the projection strip uses the same latest state.
- **next_state:** the latest row is expanded and earlier rows remain one-line summaries
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html#expanded-family=todo-projection-contract` — The approved mockup proves this behavior field: the latest row is expanded and earlier rows remain one-line summaries.
- **Classification implementation:** `packages/web/src/components/workflows/NodeRoom.test.tsx#opened-todo-has-no-body` — The current room test explicitly expects an opened todo row to have no detail body, which differs from the approved checklist renderer.
- **Classification epic:** `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Story-1.9` — The completed todo story defines last-call projection and strip summary but not the approved inline checklist bodies for both provider families.

#### M005 — Selector defaults to live execution and exposes at most eight entries

- **Mockup and state:** `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html` — loop node execution selector.
- **Inventory and role:** I032, I066; CHANGE_FEATURE; scope CURRENT; status PROVEN.
- **Action key:** select-node-execution.
- **visible_presentation:** an execution selector containing no more than eight entries with the live iteration selected by default
  Evidence: interaction_code at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#control=iteration-selector-max-8` — The approved mockup proves this behavior field: an execution selector containing no more than eight entries with the live iteration selected by default.
- **precondition:** the loop node has more than one execution
  Evidence: interaction_code at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#control=iteration-selector-max-8` — The approved mockup proves this behavior field: the loop node has more than one execution.
- **trigger:** the user opens the selector and chooses an execution
  Evidence: interaction_code at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#control=iteration-selector-max-8` — The approved mockup proves this behavior field: the user opens the selector and chooses an execution.
- **target_identity:** the selected execution of the current loop node
  Evidence: interaction_code at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#control=iteration-selector-max-8` — The approved mockup proves this behavior field: the selected execution of the current loop node.
- **target_cardinality:** one of at most eight exposed executions
  Evidence: interaction_code at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#control=iteration-selector-max-8` — The approved mockup proves this behavior field: one of at most eight exposed executions.
- **timing:** immediate room projection after selection
  Evidence: interaction_code at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#control=iteration-selector-max-8` — The approved mockup proves this behavior field: immediate room projection after selection.
- **effect_on_active_work:** none; stale selections are read-only and do not steer the live execution
  Evidence: interaction_code at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#control=iteration-selector-max-8` — The approved mockup proves this behavior field: none; stale selections are read-only and do not steer the live execution.
- **collection_mutation:** none
  Evidence: interaction_code at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#control=iteration-selector-max-8` — The approved mockup proves this behavior field: none.
- **expected_result:** the transcript shows the chosen execution and the live iteration is the initial selection
  Evidence: interaction_code at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#control=iteration-selector-max-8` — The approved mockup proves this behavior field: the transcript shows the chosen execution and the live iteration is the initial selection.
- **next_state:** the room displays the selected live or stale execution
  Evidence: interaction_code at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#control=iteration-selector-max-8` — The approved mockup proves this behavior field: the room displays the selected live or stale execution.
- **Classification implementation:** `packages/web/src/components/workflows/NodeRoom.tsx#iterationOptions` — The current Legacy and Console rooms build the execution option list without the approved eight-entry limit.
- **Classification epic:** `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Story-1.2` — The completed execution-selector story defines occurrence navigation but not the approved maximum of eight entries.

#### M006 — Queued drafts are durable and shared by the server

- **Mockup and state:** `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html` — generating queue panel.
- **Inventory and role:** I010; CHANGE_FEATURE; scope CURRENT; status PROVEN.
- **Action key:** none.
- **visible_presentation:** the queue panel labels queued drafts Saved on server
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#behavior=durable-server-queue` — The approved mockup proves this behavior field: the queue panel labels queued drafts Saved on server.
- **precondition:** a draft has been queued while the agent is generating
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#behavior=durable-server-queue` — The approved mockup proves this behavior field: a draft has been queued while the agent is generating.
- **trigger:** the Queue action accepts a non-empty draft
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#behavior=durable-server-queue` — The approved mockup proves this behavior field: the Queue action accepts a non-empty draft.
- **target_identity:** the queued steering draft
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#behavior=durable-server-queue` — The approved mockup proves this behavior field: the queued steering draft.
- **target_cardinality:** one queued draft per Queue action
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#behavior=durable-server-queue` — The approved mockup proves this behavior field: one queued draft per Queue action.
- **timing:** before the queue panel reports the saved state
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#behavior=durable-server-queue` — The approved mockup proves this behavior field: before the queue panel reports the saved state.
- **effect_on_active_work:** none; queuing does not interrupt the active turn
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#behavior=durable-server-queue` — The approved mockup proves this behavior field: none; queuing does not interrupt the active turn.
- **collection_mutation:** the server-backed durable queue gains one draft
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#behavior=durable-server-queue` — The approved mockup proves this behavior field: the server-backed durable queue gains one draft.
- **expected_result:** the queued draft is available from the shared server state
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#behavior=durable-server-queue` — The approved mockup proves this behavior field: the queued draft is available from the shared server state.
- **next_state:** the draft remains queued until it is deleted, sent, or reconciled at terminal state
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#behavior=durable-server-queue` — The approved mockup proves this behavior field: the draft remains queued until it is deleted, sent, or reconciled at terminal state.
- **Classification implementation:** `packages/workflows/src/steering-registry.ts#SteeringRegistry` — The current steering registry stores queue state only in process memory, and the web draft uses session storage.
- **Classification epic:** `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Story-2.5` — The completed steering Epic defines the previous process-local queue and does not provide durable server recovery.

#### M007 — Projected Auto-send on status indicator

- **Mockup and state:** `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html` — legacy generating queue panel.
- **Inventory and role:** I044; CHANGE_FEATURE; scope CURRENT; status PROVEN.
- **Action key:** none.
- **visible_presentation:** an Auto-send on status label in the queued-draft panel
  Evidence: rendered at `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html#state=generating element=auto-send-on-indicator` — The approved mockup proves this behavior field: an Auto-send on status label in the queued-draft panel.
- **precondition:** the queue panel is visible and the effective projected auto-send state is on
  Evidence: rendered at `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html#state=generating element=auto-send-on-indicator` — The approved mockup proves this behavior field: the queue panel is visible and the effective projected auto-send state is on.
- **trigger:** the queue panel renders its current projected state
  Evidence: rendered at `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html#state=generating element=auto-send-on-indicator` — The approved mockup proves this behavior field: the queue panel renders its current projected state.
- **target_identity:** the queue panel auto-send status label
  Evidence: rendered at `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html#state=generating element=auto-send-on-indicator` — The approved mockup proves this behavior field: the queue panel auto-send status label.
- **target_cardinality:** one indicator
  Evidence: rendered at `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html#state=generating element=auto-send-on-indicator` — The approved mockup proves this behavior field: one indicator.
- **timing:** with the current queue-panel render
  Evidence: rendered at `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html#state=generating element=auto-send-on-indicator` — The approved mockup proves this behavior field: with the current queue-panel render.
- **effect_on_active_work:** none; the indicator alone performs no dispatch
  Evidence: rendered at `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html#state=generating element=auto-send-on-indicator` — The approved mockup proves this behavior field: none; the indicator alone performs no dispatch.
- **collection_mutation:** none
  Evidence: rendered at `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html#state=generating element=auto-send-on-indicator` — The approved mockup proves this behavior field: none.
- **expected_result:** the panel communicates that auto-send is on
  Evidence: rendered at `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html#state=generating element=auto-send-on-indicator` — The approved mockup proves this behavior field: the panel communicates that auto-send is on.
- **next_state:** the indicator continues to reflect projected state; the mockup exposes no auto-send control
  Evidence: rendered at `claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html#state=generating element=auto-send-on-indicator` — The approved mockup proves this behavior field: the indicator continues to reflect projected state; the mockup exposes no auto-send control.
- **Classification implementation:** `packages/web/src/components/workflows/ComposerDock.tsx#queued-draft-header` — The current steering dock has no projected auto-send status indicator.
- **Classification epic:** `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Story-2.5` — The completed steering Epic does not define an auto-send status indicator.

#### M008 — Per-item Send now injects one queued message without Stop

- **Mockup and state:** `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html` — verified soft-inject mode.
- **Inventory and role:** I015, I016, I049, I050, I085; CHANGE_FEATURE; scope CURRENT; status PROVEN.
- **Action key:** send-now-active-turn.
- **visible_presentation:** each queued item shows Send now only for a provider with verified active-turn injection
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#behavior=verified-soft-inject-send-now` — The approved mockup proves this behavior field: each queued item shows Send now only for a provider with verified active-turn injection.
- **precondition:** the agent is generating, one item is queued, and provider injection is verified
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#behavior=verified-soft-inject-send-now` — The approved mockup proves this behavior field: the agent is generating, one item is queued, and provider injection is verified.
- **trigger:** the user selects Send now on that queued item
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#behavior=verified-soft-inject-send-now` — The approved mockup proves this behavior field: the user selects Send now on that queued item.
- **target_identity:** the selected queued message and the current active provider turn
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#behavior=verified-soft-inject-send-now` — The approved mockup proves this behavior field: the selected queued message and the current active provider turn.
- **target_cardinality:** one queued message
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#behavior=verified-soft-inject-send-now` — The approved mockup proves this behavior field: one queued message.
- **timing:** immediate active-turn injection
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#behavior=verified-soft-inject-send-now` — The approved mockup proves this behavior field: immediate active-turn injection.
- **effect_on_active_work:** the active turn continues and Stop is not invoked
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#behavior=verified-soft-inject-send-now` — The approved mockup proves this behavior field: the active turn continues and Stop is not invoked.
- **collection_mutation:** the selected message leaves the queued collection and receives a stamped message identity
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#behavior=verified-soft-inject-send-now` — The approved mockup proves this behavior field: the selected message leaves the queued collection and receives a stamped message identity.
- **expected_result:** the selected message enters the active turn without stopping it
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#behavior=verified-soft-inject-send-now` — The approved mockup proves this behavior field: the selected message enters the active turn without stopping it.
- **next_state:** generation continues and the item is represented as sent pending provider acknowledgement
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#behavior=verified-soft-inject-send-now` — The approved mockup proves this behavior field: generation continues and the item is represented as sent pending provider acknowledgement.
- **Classification implementation:** `packages/web/src/components/workflows/ComposerDock.test.tsx#queue-only-controls` — The current dock and tests expose queue and stop behavior but no verified per-item active-turn Send now control.
- **Classification epic:** `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Story-2.11` — The completed steering Epic leaves active-turn soft injection outside its completed baseline.

#### M009 — Unmatched durable messages become read-only Never sent records

- **Mockup and state:** `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html` — terminal state with undelivered content.
- **Inventory and role:** I025, I059, I076; CHANGE_FEATURE; scope CURRENT; status PROVEN.
- **Action key:** none.
- **visible_presentation:** a read-only terminal dock labels each unmatched durable message Never sent
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html#behavior=terminal-never-sent-reconciliation` — The approved mockup proves this behavior field: a read-only terminal dock labels each unmatched durable message Never sent.
- **precondition:** the node reaches a terminal state with durable queued or unacknowledged content
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html#behavior=terminal-never-sent-reconciliation` — The approved mockup proves this behavior field: the node reaches a terminal state with durable queued or unacknowledged content.
- **trigger:** terminal reconciliation runs
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html#behavior=terminal-never-sent-reconciliation` — The approved mockup proves this behavior field: terminal reconciliation runs.
- **target_identity:** durable steering messages without matching provider acknowledgement
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html#behavior=terminal-never-sent-reconciliation` — The approved mockup proves this behavior field: durable steering messages without matching provider acknowledgement.
- **target_cardinality:** every unmatched durable message
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html#behavior=terminal-never-sent-reconciliation` — The approved mockup proves this behavior field: every unmatched durable message.
- **timing:** on terminal completion or failure
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html#behavior=terminal-never-sent-reconciliation` — The approved mockup proves this behavior field: on terminal completion or failure.
- **effect_on_active_work:** none; the node is already terminal
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html#behavior=terminal-never-sent-reconciliation` — The approved mockup proves this behavior field: none; the node is already terminal.
- **collection_mutation:** unmatched sent identities are restored to the Never sent terminal collection
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html#behavior=terminal-never-sent-reconciliation` — The approved mockup proves this behavior field: unmatched sent identities are restored to the Never sent terminal collection.
- **expected_result:** the user can read all undelivered content and cannot edit or send it
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html#behavior=terminal-never-sent-reconciliation` — The approved mockup proves this behavior field: the user can read all undelivered content and cannot edit or send it.
- **next_state:** the terminal room remains read-only with Never sent records
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html#behavior=terminal-never-sent-reconciliation` — The approved mockup proves this behavior field: the terminal room remains read-only with Never sent records.
- **Classification implementation:** `packages/web/src/lib/steering-dock.ts#current-terminal-projection` — The current process-local steering model has no durable terminal reconciliation or Never sent record.
- **Classification epic:** `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Story-2.12` — The completed steering Epic does not define durable terminal reconciliation into Never sent records.

#### M010 — Thirty-minute interrupted-idle timeout fails the node and preserves durable queue content

- **Mockup and state:** `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html` — failed after idle timeout.
- **Inventory and role:** I028, I061, I078; CHANGE_FEATURE; scope CURRENT; status PROVEN.
- **Action key:** none.
- **visible_presentation:** a failed node explains the thirty-minute idle timeout and shows preserved Never sent content
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#behavior=idle-timeout-preserves-durable-queue` — The approved mockup proves this behavior field: a failed node explains the thirty-minute idle timeout and shows preserved Never sent content.
- **precondition:** the current turn was interrupted and the node remains idle with durable queued content
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#behavior=idle-timeout-preserves-durable-queue` — The approved mockup proves this behavior field: the current turn was interrupted and the node remains idle with durable queued content.
- **trigger:** thirty minutes pass without activity; typing re-arms the timer before expiry
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#behavior=idle-timeout-preserves-durable-queue` — The approved mockup proves this behavior field: thirty minutes pass without activity; typing re-arms the timer before expiry.
- **target_identity:** the interrupted node execution
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#behavior=idle-timeout-preserves-durable-queue` — The approved mockup proves this behavior field: the interrupted node execution.
- **target_cardinality:** one node execution
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#behavior=idle-timeout-preserves-durable-queue` — The approved mockup proves this behavior field: one node execution.
- **timing:** after thirty minutes of re-armable inactivity
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#behavior=idle-timeout-preserves-durable-queue` — The approved mockup proves this behavior field: after thirty minutes of re-armable inactivity.
- **effect_on_active_work:** the node execution fails
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#behavior=idle-timeout-preserves-durable-queue` — The approved mockup proves this behavior field: the node execution fails.
- **collection_mutation:** durable queued content is retained and projected as Never sent
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#behavior=idle-timeout-preserves-durable-queue` — The approved mockup proves this behavior field: durable queued content is retained and projected as Never sent.
- **expected_result:** the node shows failed status and the preserved content remains readable
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#behavior=idle-timeout-preserves-durable-queue` — The approved mockup proves this behavior field: the node shows failed status and the preserved content remains readable.
- **next_state:** a failed terminal room with read-only Never sent records
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html#behavior=idle-timeout-preserves-durable-queue` — The approved mockup proves this behavior field: a failed terminal room with read-only Never sent records.
- **Classification implementation:** `packages/workflows/src/steering-registry.ts#current-steering-lifecycle` — The current registry has no approved interrupted-idle failure timer and cannot preserve queue state durably across terminal transition.
- **Classification epic:** `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Story-2.7` — The completed steering Epic defines interruption and resume behavior without the approved thirty-minute durable timeout outcome.

#### M011 — Durable content recovers read-only and requires explicit Resume

- **Mockup and state:** `claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html` — restart recovery.
- **Inventory and role:** I029, I030, I063, I064, I079; CHANGE_FEATURE; scope CURRENT; status PROVEN.
- **Action key:** none.
- **visible_presentation:** a restart-recovery card shows preserved durable content and points to the existing Resume action
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html#behavior=restart-recovery-explicit-resume` — The approved mockup proves this behavior field: a restart-recovery card shows preserved durable content and points to the existing Resume action.
- **precondition:** the application restarts with a recoverable non-terminal node and durable steering content
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html#behavior=restart-recovery-explicit-resume` — The approved mockup proves this behavior field: the application restarts with a recoverable non-terminal node and durable steering content.
- **trigger:** the run room loads after restart
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html#behavior=restart-recovery-explicit-resume` — The approved mockup proves this behavior field: the run room loads after restart.
- **target_identity:** the recovered node execution and its durable steering content
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html#behavior=restart-recovery-explicit-resume` — The approved mockup proves this behavior field: the recovered node execution and its durable steering content.
- **target_cardinality:** one recovered node execution
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html#behavior=restart-recovery-explicit-resume` — The approved mockup proves this behavior field: one recovered node execution.
- **timing:** during recovery projection after restart
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html#behavior=restart-recovery-explicit-resume` — The approved mockup proves this behavior field: during recovery projection after restart.
- **effect_on_active_work:** no work starts automatically
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html#behavior=restart-recovery-explicit-resume` — The approved mockup proves this behavior field: no work starts automatically.
- **collection_mutation:** none; recovered durable content remains unchanged
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html#behavior=restart-recovery-explicit-resume` — The approved mockup proves this behavior field: none; recovered durable content remains unchanged.
- **expected_result:** the content is read-only and the user must choose the existing Resume action
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html#behavior=restart-recovery-explicit-resume` — The approved mockup proves this behavior field: the content is read-only and the user must choose the existing Resume action.
- **next_state:** recovery waits for explicit Resume and never auto-resumes or auto-resends
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html#behavior=restart-recovery-explicit-resume` — The approved mockup proves this behavior field: recovery waits for explicit Resume and never auto-resumes or auto-resends.
- **Classification implementation:** `packages/workflows/src/steering-registry.ts#in-memory-state` — The current process-local registry cannot recover steering content after restart.
- **Classification epic:** `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Story-2.7` — The completed steering Epic does not define restart recovery and predates durable queue storage.

#### M012 — Delivered requires matching provider acknowledgement

- **Mockup and state:** `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html` — message status examples.
- **Inventory and role:** I082, I086; CHANGE_FEATURE; scope CURRENT; status PROVEN.
- **Action key:** none.
- **visible_presentation:** an operator message changes from Sent to Delivered only after matching provider evidence
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html#behavior=matched-delivery-acknowledgement` — The approved mockup proves this behavior field: an operator message changes from Sent to Delivered only after matching provider evidence.
- **precondition:** a sent operator message has a stamped message ID
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html#behavior=matched-delivery-acknowledgement` — The approved mockup proves this behavior field: a sent operator message has a stamped message ID.
- **trigger:** provider acknowledgement with the same stamped message ID arrives
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html#behavior=matched-delivery-acknowledgement` — The approved mockup proves this behavior field: provider acknowledgement with the same stamped message ID arrives.
- **target_identity:** the operator message whose stamped ID matches the acknowledgement
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html#behavior=matched-delivery-acknowledgement` — The approved mockup proves this behavior field: the operator message whose stamped ID matches the acknowledgement.
- **target_cardinality:** one matched operator message
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html#behavior=matched-delivery-acknowledgement` — The approved mockup proves this behavior field: one matched operator message.
- **timing:** only after matching provider evidence is available
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html#behavior=matched-delivery-acknowledgement` — The approved mockup proves this behavior field: only after matching provider evidence is available.
- **effect_on_active_work:** none
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html#behavior=matched-delivery-acknowledgement` — The approved mockup proves this behavior field: none.
- **collection_mutation:** the matched message status changes from Sent to Delivered
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html#behavior=matched-delivery-acknowledgement` — The approved mockup proves this behavior field: the matched message status changes from Sent to Delivered.
- **expected_result:** the message shows Delivered and unmatched messages never infer that state
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html#behavior=matched-delivery-acknowledgement` — The approved mockup proves this behavior field: the message shows Delivered and unmatched messages never infer that state.
- **next_state:** the matched operator record remains Delivered
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html#behavior=matched-delivery-acknowledgement` — The approved mockup proves this behavior field: the matched operator record remains Delivered.
- **Classification implementation:** `packages/web/src/components/workflows/NodeTranscriptPane.tsx#operator-message-status` — The current operator row presents sent state without matching a provider acknowledgement to a stamped message ID.
- **Classification epic:** `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Story-2.10` — The completed operator-message story defines queued and sent presentation but not evidence-backed Delivered state.

#### M013 — Codex cannot produce the interrupted warning glyph

- **Mockup and state:** `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html` — provider-specific status annotation.
- **Inventory and role:** I100; CHANGE_FEATURE; scope CURRENT; status PROVEN.
- **Action key:** none.
- **visible_presentation:** Codex tool rows never use the interrupted warning glyph
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html#provider=codex status=interrupted-unavailable` — The approved mockup proves this behavior field: Codex tool rows never use the interrupted warning glyph.
- **precondition:** a Codex tool row is being presented
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html#provider=codex status=interrupted-unavailable` — The approved mockup proves this behavior field: a Codex tool row is being presented.
- **trigger:** the presenter resolves the tool status glyph
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html#provider=codex status=interrupted-unavailable` — The approved mockup proves this behavior field: the presenter resolves the tool status glyph.
- **target_identity:** the current Codex tool row status glyph
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html#provider=codex status=interrupted-unavailable` — The approved mockup proves this behavior field: the current Codex tool row status glyph.
- **target_cardinality:** one tool row
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html#provider=codex status=interrupted-unavailable` — The approved mockup proves this behavior field: one tool row.
- **timing:** during transcript rendering
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html#provider=codex status=interrupted-unavailable` — The approved mockup proves this behavior field: during transcript rendering.
- **effect_on_active_work:** none
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html#provider=codex status=interrupted-unavailable` — The approved mockup proves this behavior field: none.
- **collection_mutation:** none
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html#provider=codex status=interrupted-unavailable` — The approved mockup proves this behavior field: none.
- **expected_result:** the interrupted warning glyph is unavailable for Codex rows
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html#provider=codex status=interrupted-unavailable` — The approved mockup proves this behavior field: the interrupted warning glyph is unavailable for Codex rows.
- **next_state:** the row uses only a Codex-supported status presentation
  Evidence: annotation at `claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html#provider=codex status=interrupted-unavailable` — The approved mockup proves this behavior field: the row uses only a Codex-supported status presentation.
- **Classification implementation:** `packages/web/src/lib/tool-presentation.ts#statusGlyph` — The current shared tool presenter permits interrupted warning status for every provider, including Codex.
- **Classification epic:** `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Story-1.4` — The completed status-glyph story defines a provider-neutral interrupted glyph and does not include the approved Codex restriction.

### Context Inventory

| ID | Unchanged visible context | Implementation evidence | Completed-Epic evidence |
| --- | --- | --- | --- |
| C001 | Existing run navigation, run metadata, filters, node list, and room header — These controls reproduce the existing Console workflow-run shell and do not change its contract. | `packages/web/src/experiments/console/routes/RunDetailPage.tsx#run-detail-shell` — The current Console route already renders the navigation, run header, tabs, log controls, node list, and selected node room. | `_bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md#completed-run-room` — The completed HITL Epic already defines the workflow run shell and node-room entry points. |
| C002 | Existing chronological transcript and tool disclosure controls — The current product already interleaves assistant text and tool rows and supplies independent disclosure and Raw controls. | `packages/web/src/components/workflows/NodeTranscriptPane.tsx#transcript-events` — The current transcript pane already renders chronological assistant and tool events with disclosure and Raw payload controls. | `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Epic-1` — Completed Epic 1 defines the readable chronological transcript and tool disclosure behavior. |
| C003 | Existing composer, Queue, Stop, Delete, and sibling dock behavior — The active steering controls and their non-interrupting Queue and turn-only Stop contracts already exist; the changed durable and soft-inject behavior is classified separately. | `packages/web/src/components/workflows/ComposerDock.tsx#active-steering-controls` — The current Legacy and Console docks already remain mounted during generation and expose Queue, Stop, and per-item Delete with the same action boundaries. | `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Epic-2` — Completed Epic 2 defines live steering with Queue, turn-only Stop, deletion, and a non-overlay dock. |
| C004 | Existing brief Stopping state and interrupted tool outcome — The approved brief disabled Stopping state, enabled Queue, lack of progress UI, and warning presentation already match the completed steering baseline. | `packages/web/src/lib/steering-dock.ts#deriveSteeringDockState` — The current steering projection already distinguishes generating, stopping, and idle-after-interrupt states while preserving Queue availability. | `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Story-2.7` — The completed interruption story defines the brief Stopping transition and interrupted outcome without optimistic idle. |
| C005 | Existing main Send now, operator rows, projected controls, and sent status — The current baseline already sends the queued batch after interruption, renders attributed operator rows, projects controls from state, and distinguishes Sent before any new Delivered state. | `packages/web/src/components/workflows/NodeTranscriptPane.tsx#operator-rows` — The current room already renders operator rows and the dock already exposes the idle Send now transition and projected controls. | `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Stories-2.8-through-2.10` — The completed steering stories define resumed generation, attributed operator rows, projected controls, and Sent presentation. |
| C006 | Existing terminal reconciliation, clean omission, lifecycle actions, and read-only affordance — These terminal rules already exist as the baseline; the new durable Never sent records and recovery behavior are classified as changes. | `packages/web/src/lib/steering-dock.ts#terminal-state` — The current projection already omits the dock for clean terminal state, prevents editing in terminal cards, and reconciles in-process sent state. | `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Story-2.12` — The completed terminal-state story defines clean omission, lifecycle actions, and read-only terminal behavior. |
| C007 | Existing per-iteration rows, stale read-only state, and Go to live iteration — The current product already models loop executions separately and keeps stale iterations read-only with navigation back to live. | `packages/web/src/lib/execution-room-model.ts#execution-selection` — The current execution-room model distinguishes live and stale executions and supports returning to the live occurrence. | `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Story-1.2` — The completed occurrence-navigation story defines separate executions and read-only stale history. |
| C008 | Existing Legacy run metadata, tabs, node list, selector, and Close control — These elements reproduce the current Legacy workflow execution shell. | `packages/web/src/components/workflows/WorkflowExecution.tsx#workflow-run-shell` — The current workflow execution view already renders the Legacy run header, tabs, node list, room header, execution selector, and Close control. | `_bmad-output/planning-artifacts/epics-workflow-run-view-hitl/epics.md#completed-run-room` — The completed HITL Epic defines the same Legacy run-room context. |
| C009 | Existing sibling dock below the transcript — The current room already keeps the dock as a sibling below the transcript so it does not overlay the last row; only fixed panel sizing changes. | `packages/web/src/components/workflows/NodeTranscriptPane.tsx#room-column` — The current node room already lays out the transcript and dock as vertical siblings. | `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Story-2.1` — The completed steering layout story defines the dock as a non-overlay room sibling. |
| C010 | Enter does not submit and empty drafts are omitted — The current composer already requires the explicit action and rejects empty draft rendering or submission. | `packages/web/src/components/workflows/ComposerDock.test.tsx#composer-input-guards` — Current tests cover explicit submission behavior and omission of empty drafts. | `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Story-2.4` — The completed composer story defines explicit steering actions and non-empty message handling. |
| C011 | Existing semantic color tokens for tool families — The approved family chips retain the current semantic color mapping. | `packages/web/src/lib/tool-presentation.ts#tool-family-presentation` — The current presenter already maps shell/code, file/web, search/glob, todo/task, and generic families to these semantic tokens. | `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Story-1.3` — The completed tool-family story defines the same semantic chip palette. |
| C012 | Existing succeeded, failed, running, interrupted, and unknown glyphs — The general status glyph palette is unchanged; the Codex-specific exception is classified separately. | `packages/web/src/lib/tool-presentation.ts#statusGlyph` — The current presenter already maps the five general tool states to the approved glyphs. | `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Story-1.4` — The completed status story defines the same general glyph palette. |
| C013 | Existing collapsed anatomy and provider-name retention — Collapsed rows keep the current anatomy and preserve provider tool names while family controls color. | `packages/web/src/lib/tool-presentation.ts#collapsed-tool-presentation` — The current tool presenter already produces the same collapsed row anatomy and provider-name display. | `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Story-1.5` — The completed collapsed-row story defines the same anatomy and naming rule. |
| C014 | Existing long-path, Codex script, MCP, and unknown-tool fallbacks — The approved hard cases preserve the current deterministic presentation rules. | `packages/web/src/lib/tool-presentation.test.ts#hard-cases` — Current presenter tests cover middle elision, script unwrapping, MCP headings, and unknown argument and name fallbacks. | `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Stories-1.5-through-1.7` — The completed transcript stories define these hard-case presentation rules. |
| C015 | Existing shell, file, web, search, glob, and code bodies — The expanded bodies use the existing family-specific renderers. | `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx#tool-detail-renderers` — The current Console transcript already supplies family-specific detail bodies for these common tools. | `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Story-1.8` — The completed expanded-tool story defines the same terminal, diff, web, search, glob, and code bodies. |
| C016 | Existing OMP task batch and Claude Agent dispatch bodies — The approved task bodies retain the current distinction between batched OMP tasks and one Claude dispatch. | `packages/web/src/lib/tool-presentation.ts#task-presentations` — The current presenter already distinguishes OMP task batches from a single Claude Agent dispatch. | `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Story-1.10` — The completed task-renderer story defines the same batch and single-dispatch bodies. |
| C017 | Existing occurrence_id grouping and approved header wording — The approved mockup keeps the current occurrence grouping and header rules. | `packages/web/src/lib/occurrence-groups.ts#groupOccurrenceEvents` — The current grouping uses occurrence identity and produces Run, Pass, or reason-only headers without Attempt wording. | `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Story-1.2` — The completed occurrence story defines the same grouping and header behavior. |
| C018 | Existing closed-by-default complete JSON disclosure — The Raw control retains the current one-click access to the complete payload. | `packages/web/src/components/workflows/NodeTranscriptPane.tsx#raw-payload` — The current transcript already keeps Raw closed by default and exposes the complete JSON payload on demand. | `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Story-1.6` — The completed raw-payload story defines the same disclosure contract. |
| C019 | Existing independent open state for every tool row — Each disclosure already owns independent expanded state. | `packages/web/src/components/workflows/NodeTranscriptPane.tsx#tool-disclosure-state` — The current transcript stores and toggles disclosure state per tool row. | `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md#Story-1.5` — The completed disclosure story defines independent expansion for tool rows. |

Every visible inventory item is classified exactly once through its `inventory_ids` membership in one changed feature or one unchanged-context row.

### Mockup Feature Behavior Matrix

Every row below is current scope.
`MATCHED` means that the PRD set, Architecture, and current Story acceptance criteria all state the complete manifest behavior.
`PARTIAL` means that at least one required behavior field is not explicit.
`MISSING` means that no current owner states a material manifest behavior.
`CONFLICT` means that a selected document requires an incompatible result.

| ID | Precondition | Action or trigger | Target | Cardinality | Timing | Effect on active work | Collection mutation | Result | Remaining or next state | PRD set | Architecture | Current Epic or Story | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M001 | Console node room is open. | Render the room. | Open Console node room. | One room. | Initial layout. | No running-node effect. | None. | Transcript scrolls above the fixed sibling dock. | Width stays 520 pixels until close. | `DESIGN.md:538`, adopted by the SPEC, states 520 pixels. | Verification requires both widths but does not state 520 pixels. | Story 3.1 states 520 pixels and the approved order. | PARTIAL |
| M002 | Legacy node room is open. | Render the room. | Open Legacy node room. | One room. | Initial layout. | No running-node effect. | None. | Right room panel is 460 pixels wide. | Width stays 460 pixels until close. | `DESIGN.md:538`, adopted by the SPEC, states 460 pixels. | Verification requires both widths but does not state 460 pixels. | Story 3.1 states 460 pixels and equivalent behavior. | PARTIAL |
| M003 | Selected execution has a supported latest todo projection. | Project latest todo state. | Latest-todo projection strip. | One strip. | On render and projection change. | None. | None. | Strip stays below and outside the scroller and can disclose the latest checklist. | Transcript scrolls independently above the strip. | CAP-3 and `EXPERIENCE.md` state the exact placement. | Readable-transcript AD-12 states the exact placement. | Story 3.2 states the exact placement and scrolling behavior. | MATCHED |
| M004 | Transcript has supported todo calls. | Open the latest supported todo row. | Latest supported todo call in the selected execution. | One latest call. | Immediate local disclosure. | None. | Persisted events stay unchanged. | Latest row shows the checklist from the same latest state. | Latest row is open and earlier rows stay one-line summaries. | CAP-3 and `EXPERIENCE.md` state both forms. | Readable-transcript AD-12 and AD-21 state both forms. | Story 3.2 states both forms and no persisted rewrite. | MATCHED |
| M005 | Loop node has more than one execution. | Open the selector and choose an execution. | Selected execution of the current loop node. | One of at most eight exposed executions. | Immediate room projection. | Stale selection is read-only and cannot steer live work. | None. | Transcript shows the chosen execution and live is the initial selection. | Room shows the selected live or stale execution. | The SPEC and UX define live and stale behavior but not the default-live and eight-entry limits. | The readable spine defines occurrence navigation but not the default-live and eight-entry limits. | Story 3.3 does not own either limit. | MISSING |
| M006 | A draft is queued during generation. | Queue accepts a non-empty draft. | Queued steering draft. | One draft per action. | Before saved state is reported. | Active turn continues. | Durable server queue gains one draft. | Shared authorized viewers can read the queued draft. | Draft stays queued until delete, send, or terminal reconciliation. | CAP-8 and the steering companions state durable node-scoped queue behavior. | Live-steering AD-3 and AD-4 state durable control and commit-before-acknowledgement. | Stories 7.1 through 7.3 own the durable shared queue. | MATCHED |
| M007 | Queue panel is visible and projected auto-send is on. | Render current queue-panel state. | Auto-send status label. | One indicator. | Current render. | The indicator performs no dispatch. | None. | Panel shows `Auto-send on`. | Indicator tracks projected state and supplies no control. | CAP-15 defines auto-send behavior but not this exact status indicator. | AD-9 defines auto-send behavior but not this indicator. | Story 7.5 requires setting visibility but not the exact read-only projection. | PARTIAL |
| M008 | Agent is generating, one item is queued, and provider injection is verified. | Select per-item `Send now`. | Selected queued message and current active provider turn. | Exactly one queued message. | Immediate active-turn injection. | Generation continues and Stop is not invoked. | Selected item leaves the queue and receives a stamped message identity. | Selected item enters the active turn without stopping it. | Selected item is sent pending acknowledgement; every non-selected queue item keeps its content, identity, order, and queued state. | CAP-12 and the steering companions identify the selected item and prohibit Stop, active-tool change, and a steering turn-start, but they do not state the exact selected-item mutation and untouched remainder. | AD-8 and AD-12 gate the action but do not state atomic one-item mutation or the untouched remainder. | Stories 8.3, 8.5, and 8.7 require soft injection without Stop but do not state the exact selected-item transition or preserve every other item. | PARTIAL |
| M009 | Node becomes terminal with durable queued or unacknowledged content. | Run terminal reconciliation. | Durable messages without matching provider acknowledgement. | Every unmatched durable message. | On terminal completion or failure. | None because the node is terminal. | Restore all unmatched sent identities to the `Never sent` terminal collection. | All undelivered content is readable and cannot be edited or sent. | Terminal room stays read-only with `Never sent` records. | The SPEC states durable reconciliation and a read-only undelivered box, but it does not explicitly require every unmatched durable message to become a `Never sent` record; `EXPERIENCE.md` does. | AD-7 and AD-12 do not define this exact terminal transition. | No current Story owns this durable terminal reconciliation. | MISSING |
| M010 | Current turn was interrupted and the node is idle with durable queued content. | Let 30 minutes of re-armable inactivity expire. | Interrupted node execution. | One node execution. | After 30 minutes without activity. | Node execution fails. | Durable queued content stays and becomes `Never sent`. | Failed status and preserved content remain readable. | Terminal room is read-only with `Never sent` records. | The SPEC defines the live 30-minute boundary, and `EXPERIENCE.md` defines the exact failure and preservation result, but the canonical requirement text does not combine all fields. | The live spine names a volatile timer but not the 30-minute failure plus durable `Never sent` result. | No current Story owns this timeout and preservation result. | MISSING |
| M011 | Restart finds a recoverable non-terminal node and durable steering content. | Load the room after restart. | Recovered node and durable steering content. | One node execution. | Recovery projection after restart. | No work starts automatically. | Durable content stays unchanged. | Content is read-only and points to the existing Resume action. | Recovery waits for explicit Resume with no automatic resume or resend. | CAP-14 and the steering companions state the full behavior. | AD-5 states the full behavior. | Story 7.4 states the full behavior. | MATCHED |
| M012 | Sent operator message has a stamped ID. | Receive provider acknowledgement with the same ID. | Operator message with the matching stamped ID. | One matched message. | Only after matching evidence. | None. | Matching status changes from Sent to Delivered. | Only the matched message shows Delivered. | Matched record remains Delivered and unmatched records do not infer it. | CAP-13 and the API contract state ID-only acknowledgement. | AD-7 and AD-8 state explicit evidence and capability gating. | Stories 8.3 and 8.8 state matching-only advancement. | MATCHED |
| M013 | A Codex tool row is presented. | Resolve its status glyph. | Current Codex tool-row glyph. | One row. | During rendering. | None. | None. | Interrupted warning glyph is unavailable for Codex. | Row uses only a Codex-supported presentation. | The manifest and `DESIGN.md:437` prohibit the glyph, but CAP-9 and the cross-half dependency require provider-neutral interrupted presentation. | AD-1, AD-2, and provider-neutral glyph projection require an interrupted result that resolves to the shared warning glyph. | Story 8.4 requires the Codex tool row to become interrupted and supplies no Codex presentation exception. | CONFLICT |

### Matrix Totals

- Matched: 5 of 13.
- Partial: 4 of 13.
- Missing: 3 of 13.
- Conflict: 1 of 13.
- Strict full-match rate: 38.5 percent.

Eight current mockup features have at least one document gap.

### Scope Decision Audit

All 13 manifest change features have `scope: CURRENT` and remain in the implementation baseline.
No current PRD, Architecture, or current Story decision can remove or postpone a visible manifest feature.
The old Epic 1, Epic 2, Stories 1.1 through 2.13, and G1 through G4 are completed baseline evidence only.
Scope labels in the opening historical sections and in the historical gated-backlog heading are superseded by the approved course correction at `epics.md:871`.
They do not apply to Epic 3 through Epic 9 or to M001 through M013.
Provider conformance is a current acceptance condition for truthful controls, not a scope decision.
No manifest question requires user clarification because every behavior field is proven and every open question is null.

### Action Identity Audit

The manifest contains no unresolved `action_identity_groups`, but the visible label `Send now` has two different current actions that must remain distinct.
The M004 todo disclosure and M005 execution selector have unique visible intents and do not share an action label with another changed feature.
The other changed rows are projections or state transitions without a user action.

| Visible label | State and source | Target and cardinality | Effect | Document result |
| --- | --- | --- | --- | --- |
| Per-item `Send now` | M008, while generation is active and provider injection is verified. | The selected queued message only, delivered into the current active turn. | No Stop; generation continues; selected item leaves the queue as sent; all other queued items stay unchanged. | PARTIAL because PRD, Architecture, and Stories do not state the complete atomic mutation and remaining-state rule. |
| Main composer `Send now` | C005, while the turn is idle after interruption. | The newly typed message and eligible durable queue entries, claimed in server FIFO order as the next turn. | Starts the next turn on the same session; this is not active-turn soft injection. | MATCHED as unchanged baseline context and CAP-10 behavior. |

The mandatory per-item check therefore fails readiness at the planning-document level.
The manifest proves one selected target, selected-item queue removal, immediate active-turn injection, continued generation, and no Stop.
The assessment directive supplies the additional explicit provenance that every non-selected queued message must remain unchanged.
The current PRD set, Architecture, and provider Stories state selected-message delivery and no Stop, but they do not state the complete selected-item removal and non-selected-item preservation rule.

#### Behavior-Preserving Term Mapping

| Visible or internal term | Explicit mapping | Audit result |
| --- | --- | --- |
| Per-item `Send now` | Soft-inject the selected durable queue item into the active provider turn through verified capability data. | PARTIAL because the planning documents omit the complete collection mutation. |
| Main `Send now` | Claim the typed message and eligible durable queue items for a new provider turn after interruption. | MATCHED and distinct from per-item injection. |
| Delete | Remove one still-claimable queued item through the idempotent withdraw contract. | MATCHED as unchanged context. |
| Withdraw | Server operation behind visible per-item Delete; it never cancels active provider work. | MATCHED as an internal-to-visible mapping. |
| Stop | Abort or interrupt only the current provider turn through the fresh per-turn signal. | MATCHED and distinct from Send and workflow Cancel. |
| Cancel | Existing workflow or node termination behavior; it is not the Node Room Stop action. | MATCHED as unchanged context. |
| Resume or continue | Existing Resume establishes execution after restart; provider continuation reuses a session only where verified; neither means automatic restart recovery. | MATCHED for M011. |

### Exact Document Gaps

1. The live-steering Architecture does not state the fixed 520-pixel Console width or fixed 460-pixel Legacy width required by M001 and M002.
2. The PRD set, both Architecture spines, and the current Stories do not state that the loop selector starts on live execution and exposes at most eight executions, as required by M005.
3. The PRD set, live-steering Architecture, and Story 7.5 do not require the projected read-only `Auto-send on` indicator, as required by M007.
4. The PRD set, live-steering Architecture, and Stories 8.3, 8.5, and 8.7 do not state that per-item `Send now` removes exactly the selected queued item, stamps it, sends it into the active turn without Stop, and leaves every other queued item unchanged, as required by M008.
5. The canonical PRD text does not explicitly require every unmatched durable terminal message to become a read-only `Never sent` record; the live-steering Architecture and current Stories also omit this M009 transition.
6. The canonical PRD text does not combine the 30-minute inactivity expiry, node failure, durable queue preservation, and read-only `Never sent` projection; the live-steering Architecture and current Stories also omit this complete M010 result.
7. CAP-9, the cross-half dependency, the provider-neutral Architecture, and Story 8.4 conflict with M013 because they make the interrupted warning presentation reachable for Codex, while the mandatory mockup forbids that glyph for Codex.
8. The readable-transcript Architecture capability map uses stale CAP-14 and CAP-15 meanings, and Story 4.1 cites CAP-14 instead of CAP-5 and CAP-16 for Codex file-change persistence.

## Summary and Recommendations

### Overall Readiness Status

**NOT READY**

Only 5 of 13 current mockup change features are fully matched across the PRD set, Architecture, and current Stories.
Four features are partial, three are missing material current ownership, and one has a direct cross-document conflict.

### Critical Issues Requiring Immediate Action

1. M001 and M002 need exact 520-pixel and 460-pixel decisions in the owning Architecture.
2. M005 needs the default-live and at-most-eight selector contract in the PRD set, Architecture, and a current Story.
3. M007 needs the exact projected `Auto-send on` indicator in the PRD set, Architecture, and Story 7.5.
4. M008 needs an atomic per-item contract in the PRD set, Architecture, and Stories 8.3, 8.5, and 8.7: exactly the selected message leaves the queue and enters the active turn, Stop is not invoked, generation continues, and every other queued message stays unchanged.
5. M009 needs explicit PRD text, an Architecture decision, and current Story ownership for converting every unmatched durable terminal message into a read-only `Never sent` record.
6. M010 needs explicit PRD text, an Architecture decision, and current Story ownership for the re-armable 30-minute expiry that fails the node and preserves durable content as read-only `Never sent` records.
7. M013 requires the PRD, Architecture, and Story 8.4 to follow the mandatory mockup rule that Codex cannot use the interrupted warning glyph.
8. Capability references must be corrected so that the readable Architecture map and Story 4.1 point to the current canonical capabilities.

### Recommended Next Steps

1. Update the PRD set only where M005, M007, M008, M009, and M010 are not exact.
2. Update the Architecture spines with the exact widths, selector limit, auto-send indicator, atomic per-item queue transition, terminal reconciliation, 30-minute failure result, and Codex glyph exception.
3. Add or revise current Story acceptance criteria for M005, M007, M008, M009, and M010 without reopening the completed Epics.
4. Align Story 8.4 and the provider-neutral presentation rules with M013.
5. Correct the stale capability references and rerun this readiness workflow against the unchanged manifest.

### Final Note

This assessment found eight current mockup features with blocking document gaps across the PRD set, Architecture, and current Stories, plus two traceability defects.
The old Epics remain completed baseline evidence and are not implementation work.
All visible mockup features remain current scope.
Implementation must not start until the blocking gaps are resolved and the readiness check passes.

**Assessment date:** 2026-09-22

**Assessor:** BMAD Implementation Readiness workflow
