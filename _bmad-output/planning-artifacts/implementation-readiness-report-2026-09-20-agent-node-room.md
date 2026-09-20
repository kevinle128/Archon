---
targetSlug: agent-node-room
stepsCompleted:
  - step-01-document-discovery
  - step-02-prd-analysis
  - step-03-epic-coverage-validation
  - step-04-ux-alignment
  - step-05-epic-quality-review
  - step-06-final-assessment
inputDocuments:
  requirements:
    - ../specs/spec-agent-node-room/SPEC.md
    - ../specs/spec-agent-node-room/tool-presentation-contract.md
    - ../specs/spec-agent-node-room/todo-fold-contract.md
    - ../specs/spec-agent-node-room/test-plan.md
    - ../specs/spec-agent-node-room/engine-integration.md
    - ../specs/spec-agent-node-room/provider-steering-matrix.md
    - ../specs/spec-agent-node-room/control-states.md
    - ../specs/spec-agent-node-room/steering-api-contract.md
    - ../specs/spec-agent-node-room/steering-test-plan.md
  architecture:
    - architecture/architecture-Archon-readable-agent-transcript-2026-09-12/ARCHITECTURE-SPINE.md
    - architecture/architecture-Archon-live-agent-steering-2026-09-12/ARCHITECTURE-SPINE.md
  epics:
    - epics-agent-node-room/epics.md
  ux:
    - ux-designs/ux-Archon-agent-node-room-2026-09-09/DESIGN.md
    - ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md
  mockups:
    - ../../../claude-design/design_handoff_node_room_transcript_steering/Console Node Room.dc.html
    - ../../../claude-design/design_handoff_node_room_transcript_steering/Legacy Node Room.dc.html
    - ../../../claude-design/design_handoff_node_room_transcript_steering/Transcript States.dc.html
    - ../../../claude-design/design_handoff_node_room_transcript_steering/Steering Dock States.dc.html
    - ../../../claude-design/design_handoff_node_room_transcript_steering/README.md
---

# Implementation Readiness Assessment Report

**Date:** 2026-09-20
**Project:** Archon

## Document Discovery

### Requirements Contract

The authoritative requirements set is `_bmad-output/specs/spec-agent-node-room/`.

- `SPEC.md` — 33,169 bytes; modified 2026-09-20 11:55:01 +0700.
- `tool-presentation-contract.md` — 25,185 bytes; modified 2026-09-20 01:47:16 +0700.
- `todo-fold-contract.md` — 5,974 bytes; modified 2026-09-18 23:45:15 +0700.
- `test-plan.md` — 13,693 bytes; modified 2026-09-20 01:47:16 +0700.
- `engine-integration.md` — 18,388 bytes; modified 2026-09-17 17:55:05 +0700.
- `provider-steering-matrix.md` — 10,762 bytes; modified 2026-09-17 17:55:05 +0700.
- `control-states.md` — 12,592 bytes; modified 2026-09-20 11:55:01 +0700.
- `steering-api-contract.md` — 11,287 bytes; modified 2026-09-20 11:55:01 +0700.
- `steering-test-plan.md` — 12,731 bytes; modified 2026-09-20 17:58:20 +0700.

### Architecture

- `architecture-Archon-readable-agent-transcript-2026-09-12/ARCHITECTURE-SPINE.md` — 36,188 bytes; modified 2026-09-20 11:55:01 +0700.
- `architecture-Archon-live-agent-steering-2026-09-12/ARCHITECTURE-SPINE.md` — 45,217 bytes; modified 2026-09-20 17:58:20 +0700.

These files cover the complementary read and steering halves of the target.

### Epics and Stories

- `epics-agent-node-room/epics.md` — 40,589 bytes; modified 2026-09-20 11:55:01 +0700.

Its `inputDocuments` list defines the selected target lineage.

### UX Design

- `DESIGN.md` — 63,403 bytes; modified 2026-09-20 11:55:01 +0700.
- `EXPERIENCE.md` — 189,839 bytes; modified 2026-09-20 11:55:01 +0700.

### Approved Mockup Handoff

- `Console Node Room.dc.html` — 67,725 bytes; modified 2026-09-17 17:55:05 +0700.
- `Legacy Node Room.dc.html` — 65,371 bytes; modified 2026-09-17 17:55:05 +0700.
- `Transcript States.dc.html` — 67,304 bytes; modified 2026-09-17 17:55:05 +0700.
- `Steering Dock States.dc.html` — 44,333 bytes; modified 2026-09-17 17:55:05 +0700.
- `README.md` — 31,964 bytes; modified 2026-09-18 23:45:15 +0700.

### Discovery Results

- No required document type is missing.
- No whole-versus-sharded duplicate requires resolution.
- The two older `sources/` spec subtrees are not selected because the Epic `inputDocuments` list does not include them.
- Documents for other target slugs are excluded.
- Visible mockup variants remain separate inventory items until the comparison steps resolve them.

## PRD Analysis

The canonical requirements set does not label a separate PRD file.
`SPEC.md` and its eight selected companions together form the complete requirements contract.

### Functional Requirements

FR1: A reader can scan a node without expanding rows because every tool invocation renders as one line with a fixed chevron, a non-colour-only outcome glyph, a family-styled chip, one salient headline, and right-aligned badges; successful calls start collapsed, failed calls start expanded, no collapsed row contains serialized-data punctuation, and a forty-call node renders forty rows.

FR2: A reader can expand every tool call into its family-specific body for shell, file, search, glob, code, todo, task, web, or generic tools; unknown tools show at most three bounded scalar fields with objects and arrays collapsed to `{…}` and `[n]`, malformed values do not throw, and serialized JSON appears only through Raw.

FR3: Both provider todo formats normalize to one folded `TodoPhase[]` state; OMP supports all nine mutation operations with atomic replay, inference, auto-promotion, all-targeting bare operations, and empty-phase removal; Claude uses last-call-wins; every transcript todo row stays a one-line update; and the current non-empty checklist appears once in a collapsible pinned strip at the top of the transcript panel.

FR4: Both provider task-dispatch formats normalize to `TaskSubtask[]`; an OMP batch shows its optional batch context and one card for every subtask, while a Claude dispatch shows exactly one card with no fabricated batch context.

FR5: A persisted file-family row with two qualifying own-property string sides renders an inline deterministic line diff with truthful added/deleted badges, hunk facts, optional `replace_all`, display sanitization, and an honest fallback for identical, refused, malformed, one-sided, or non-qualifying inputs; no diff is fabricated and non-persisted Codex `file_change` events are outside this requirement.

FR6: A reader can distinguish execution occurrences because rows group by `occurrence_id`, never `attempt_id`, and headers appear only when more than one occurrence exists; loop selection through the existing execution controls shows the selected iteration, keeps log and header selection synchronized, provides scroll-only jump behavior separately, and gives a finished iteration a read-only path back to the live iteration without issuing steering mutations.

FR7: Every tool card provides a Raw control that is closed by default and reveals the original provider payload without changing the existing full-output loading behavior; this control is the only tool-payload surface that renders serialized JSON.

FR8: While a steerable agent is generating, the composer remains mounted and enabled, the send action reads `Queue`, and dispatch stores the message immediately in the node-scoped in-process registry without interrupting the current tool or turn; only still-unsubmitted composer text is per-tab state, while queued messages are shared across tabs and operators until delivered, withdrawn, terminal cleanup, or process restart.

FR9: An operator can use `Stop` to interrupt only the active provider turn through a native interrupt or fresh per-turn stream-abort signal; the provider session and node remain alive, the node status stays `running`, independent run work continues, Cancel remains separate, completed side effects are not rolled back, and the interrupted tool renders `⚠ interrupted` instead of failure.

FR10: After an interrupt reaches `idle-after-interrupt`, the send action reads `Send now`, dispatches the newly typed message, flushes already queued messages before it in registry receipt order, and starts the next turn on the same provider session; natural turn-end auto-drains queued work, interrupted turn-end never auto-drains, and controls return automatically to `Stop` plus `Queue` when generation starts again.

FR11: The durable transcript records each delivered operator message as an ordinary text row in sequence between the work it redirected and the work it caused, with `origin='operator'`, the sending `operator_user_id`, and caller-stamped `message_id`; the UI clearly identifies the sender, preserves attribution across concurrent operators, folds a separate cross-provider interrupted status into the preceding tool card, and never renders an operator message as assistant prose.

FR12: Every in-use provider supports the universal v1 floor of turn interrupt plus boundary delivery through `Queue`; Claude, Codex, OMP, DeepSeek, and Grok use the documented provider-specific interrupt and continuation mechanisms; optional soft-inject is exposed only after its provider transport is exercised and gated, never emits a phantom turn-start event, and never blocks the universal floor.

FR13: A submitted operator message shows `sent` until the same caller-stamped id is echoed by a provider and can then show `delivered`; correlation uses id only, never text or time, and at the current SDK pin every provider remains at `sent`, with Claude-only delivery confirmation deferred until its SDK gate clears.

Total FRs: 13.

### Non-Functional Requirements

NFR1: Both Legacy and Console node rooms must ship together, share render-neutral logic from `packages/web/src/lib/`, keep thin shell-specific JSX, preserve Console isolation, and prevent `@archon/web` from importing backend or workflow packages.

NFR2: The read half must remain retroactive over stored runs and therefore must add no database schema, migration, backend behavior, or persisted data dependency.

NFR3: Strict TypeScript, complete annotations, justified types only, zero ESLint warnings, generated API types, and the repository validation command are mandatory quality gates.

NFR4: Status and progress must remain understandable without colour through distinct glyphs, words, text counts, labels, and shape treatments.

NFR5: Keyboard and assistive-technology behavior must preserve focus, use visible 2px focus indicators, keep `Stopping…` focusable through `aria-disabled`, name item actions with their message, announce transitions correctly, use an alert for delivery failures, support reduced motion, and make Enter insert a newline instead of sending.

NFR6: A provider-sent single-token tool name of at most 24 characters is displayed verbatim; every other chip falls back to the family name, never a truncated tool token.

NFR7: Tool resolution must use ordered exact-token alias and structural tiers, never substring matching; provider structural differences normalize at the edge and renderers never branch on provider names.

NFR8: Path and glob headlines use middle elision so the tail survives, while commands, patterns, and other text use end elision; single-line rows never receive raw multiline names.

NFR9: Expanded presentation work must be lazy and bounded before React, with the defined text, list, key, field, path, URL, and inspection ceilings and visible truncation metadata.

NFR10: Diff computation must be deterministic, synchronous-work bounded, fail closed, dual-budget memoized, line-number correct, safe for newline markers and line-ending differences, and display-sanitized against ANSI, control, bidi, format, and separator characters without altering Raw.

NFR11: The deployment-corpus generic fallback fraction must remain below 2% of logical tool cards under the specified streaming projection and exact-integer release audit.

NFR12: Steering must never mutate the node or run lifecycle, never broaden Cancel, never use the one-shot node abort controller, and never infer abandoned or failed cross-process work from staleness.

NFR13: Steering state must remain in process, keyed by `(runId, nodeId)`, with explicit behavior for detached execution and restart loss; no durable steering marker, phase, CAS field, attempt key, or persistence table is allowed.

NFR14: The turn loop must classify the five documented end cases, skip validation of interrupted partial output, let Cancel dominate by branch position, stop structured-output re-asks on operator interruption, reset interruption state per turn, and apply the same behavior to regular and AI loop nodes.

NFR15: Idle-after-interrupt must fail explicitly after 30 minutes of genuine inactivity, re-arm on authorized composing activity, remain cancellable through its own status poll, resolve once across send/cancel/timer races, and use a fresh session when retried.

NFR16: Queue operations must preserve server receipt order, use idempotent send, interrupt, and withdraw behavior, prevent duplicate pickup, restore failed deliveries to the queue front, and preserve each originating operator's identity without promising private per-user queues.

NFR17: Every rejected steering request must leave node state, queue state, and transcript state unchanged; finished nodes, detached runs, unknown targets, invalid payloads, and unauthenticated callers must return typed machine-readable errors.

NFR18: Queue reads must be mutation-free, omit attribution and internal handle data, expose only ordered message ids and text, use `Cache-Control: no-store` on success and error, and never log operator message contents.

NFR19: The executor must be the sole writer of operator receipt and interrupted-status rows so database sequence order remains authoritative; steering routes drive live state but never write the record directly.

NFR20: Terminal reconciliation must run only from exact node-terminal evidence after the executor's final write, use `message_id` ledger matching, restore unmatched entries as read-only `Never sent`, and never run from a live refetch or run-level terminal status alone.

NFR21: Authentication must resolve through `resolveAuthContext`; steering routes allow any authenticated identity with attribution and allow identity-less runs, while unauthenticated access fails and existing retry, cancel, and approval grants remain unchanged.

NFR22: Provider conformance must keep SDK dependencies inside the provider package, preserve abort terminal signals for executor classification, and avoid claiming soft-inject or delivery confirmation from unexercised or unavailable transports.

NFR23: The queue/dock UI must remain usable at the 460px Legacy panel and Console width, keep the transcript as the only scrolling region, prevent pinned bands and the dock from covering the observed row, cap expandable bands, avoid empty shells, and keep safety-separated control placement stable across labels.

NFR24: Rendering must use existing surface tokens, established font roles, bounded component sizes, approved contrast floors and exceptions, no new imagery, and no hue-only meaning.

NFR25: Tests must cover both providers where shapes or transport differ, both UI shells, regular and loop-node execution, both in-process and detached boundaries, fake-timer lifecycle behavior, public API schemas, concurrent operators, accessibility, 460px layout, and visual evidence; tests must not use the root `bun test` process.

Total NFRs: 25.

### Additional Requirements

AR1: `tool-presentation.ts` must expose separate summary and lazy body layers, carry exit codes into collapsed-row badges, and let the caller pass a previously resolved family into body presentation.

AR2: The resolver must include the measured aliases for `read_file`, `run_terminal_command`, `search_replace`, `search_tool`, and `list_dir`; `search_replace` must resolve as file-write, and MCP names must render as `server · tool` under generic handling.

AR3: Glob interpretation must distinguish Claude's required `pattern` plus optional directory `path` from OMP's pattern-bearing `path`, and search body selection must follow explicit `output_mode`, structured output evidence, then provider alias defaults.

AR4: Codex shell names must remove only the fixed shell wrapper for presentation, show the first non-empty line as the headline, retain the untouched name for body and Raw, and keep emoji-bearing names unchanged.

AR5: Generic fallback must inspect only bounded own enumerable fields and must never leak inherited values, quoted JSON-key presentation, or expanded nested structures.

AR6: `diff-hunks.ts` must remain the only `structuredPatch` caller, keep fixed byte, line, edit-length, context, entry-count, and source-weight limits, and expose no production test seams.

AR7: The no-newline marker must be skipped wherever it appears without advancing line counters, hunk order must stay unchanged, and emitted line numbers must remain positive and snippet-relative.

AR8: `buildAgentHistory()` must return transcript items plus node-level todo state, gain operator-item recognition and interrupted-status folding, and carry occurrence identity without teaching either renderer provider details.

AR9: The five tool outcomes must map to `✓`, `✕`, `◐`, `⚠`, and `–`, and failed calls must start expanded while other completed calls start collapsed.

AR10: The steering registry must register a live handle at node start, support active and parked queue states where specified, expose an atomic snapshot, and tear down on every terminal outcome.

AR11: A fresh per-turn signal must combine with the node-level Cancel signal through `AbortSignal.any`, and the registry interrupt must synchronously abort only the currently active turn handle.

AR12: Natural end with queued work starts another turn, natural end with no queued work completes normally, and interrupted end always parks for explicit `Send now` regardless of queue contents.

AR13: The next turn must reuse the same provider session through the existing resume seam and flush queued plus newly typed messages in registry receipt order.

AR14: The engine must write one cross-provider interrupted status row at idle-await entry and one operator text receipt per delivered message without emitting a turn-start event for delivery.

AR15: The live sub-state wire projection must contain exactly `generating` and `idle-after-interrupt`; `interrupting` remains a UI-local transient.

AR16: The five API routes are typed Send, Interrupt, Keepalive, Withdraw, and Queue Read endpoints registered through OpenAPI with schemas in the server route-schema package and generated web types.

AR17: Send accepts a non-empty message, caller UUID, and `queue` or `send_now` intent; interrupt and keepalive have empty bodies; withdraw identifies the message in the path; queue read has no body or query.

AR18: Success responses must use the documented `queued`, `awaiting_send_now`, `idle-after-interrupt`, and `generating` states, while errors use one nested shape and the defined 400, 401/403, 404, 409, and 422 distinctions.

AR19: Duplicate message ids replay the original receipt, repeated idle interrupts are no-ops, unknown or drained withdraw ids succeed without mutation, and terminal teardown provides the last race gate.

AR20: Queue polling must converge mounted docks across tabs and operators while the client discards snapshots older than its own successful mutation generation.

AR21: A stored operator row contains only the strict metadata triple; the read API derives `operator_display_name`, falls back to the short id on lookup failure, reserves null for identity-less rows, and prevents the web from fetching users.

AR22: Global concurrent-operator order is `NodeSteeringHandle.accept()` order; within-sender order is promised only inside one request stream, and shared queue visibility must not substitute one sender's attribution for another.

AR23: Claude uses native interrupt at the current pin, Codex resumes a stream-aborted thread, OMP stream-abort throws and must be classified, DeepSeek returns an abort-marked result and must be classified, and Grok uses stream-abort until its hook gate is exercised.

AR24: OMP soft injection, when enabled after its gate, must use RPC rather than ACP mode, configure all-message steering and protocol version 2, and must not claim delivery confirmation.

AR25: Claude soft injection remains gated until streaming input plus resume is exercised, and its delivered state remains separately gated on the required SDK version.

AR26: The dock must implement generating, interrupting, idle-after-interrupt, generating-again, finished-undelivered, finished-clean, failed-after-idle, detached-run, and finished-live-loop-iteration presentations with the exact action presence and absence required for each.

AR27: Queueing appends to the end, Queue dispatches immediately to the server, delete calls Withdraw, `Send now` flushes all accepted work, and a finished node folds the half-typed draft into a read-only `Never sent` box instead of discarding it.

AR28: A finished iteration of a live loop node must show its transcript and final todo state, mirror the shared pending queue without per-item actions or next-out styling, issue only the authenticated queue read, and offer a keyboard-operable return to the live iteration.

AR29: Test implementation must include the named pure-module, renderer, provider-conformance, route, executor, registry, parent/pane, and E2E coverage described by the two test plans, plus the release-time corpus audit.

### PRD Completeness Assessment

The selected requirements set describes the functional behavior, engine semantics, typed API, provider differences, accessibility floor, safety rules, and verification obligations in implementation-level detail.
The primary capability sequence is clear and traceable through FR1–FR13.
The contract is fragmented across nine files and does not provide one canonical FR/NFR inventory, so this report assigns extraction identifiers without changing the source meaning.
Some requirements contain gated or optional behavior beside the v1 floor, and the approved mockups contain multiple visible variants.
Those items require semantic traceability in the later comparison steps and are not resolved in this PRD-only step.

## Epic Coverage Validation

### Coverage Matrix

| FR   | PRD requirement                                                                                                             | Epic and story coverage                                                                                  | Status  |
| ---- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------- |
| FR1  | One scannable tool row with outcome glyph, family chip, salient headline, badges, and correct initial expansion.            | Epic 1, Story 1.1.                                                                                       | COVERED |
| FR2  | Family-shaped expanded bodies, bounded generic fallback, no default JSON, and production fallback below 2%.                 | Epic 1, Story 1.3; Raw separation in Story 1.2.                                                          | COVERED |
| FR3  | Provider-neutral todo fold with compact history rows and one pinned current-state strip.                                    | Epic 1, Story 1.5.                                                                                       | COVERED |
| FR4  | Provider-neutral task normalization with batch context and per-subtask cards.                                               | Epic 1, Story 1.6.                                                                                       | COVERED |
| FR5  | Truthful, deterministic inline file diff with bounded fallback and no fabricated diff.                                      | Epic 1, Story 1.4.                                                                                       | COVERED |
| FR6  | Occurrence grouping, loop selection, and safe finished-iteration viewing without steering mutation.                         | Epic 1, Story 1.7; Epic 2, Stories 2.9 and 2.10 for the finished-live-iteration queue and dock behavior. | COVERED |
| FR7  | Closed-by-default Raw access to the original payload with the existing full-output path.                                    | Epic 1, Story 1.2.                                                                                       | COVERED |
| FR8  | Live composer, immediate server queue dispatch, natural-boundary delivery, tab-local unsent drafts, and shared node queue.  | Epic 2, Stories 2.1, 2.2, 2.9, 2.10, and 2.11.                                                           | COVERED |
| FR9  | Interrupt the active turn without stopping the node, preserve the session, and render interruption distinctly from failure. | Epic 2, Stories 2.3–2.7; reader prerequisite in Story 1.1.                                               | COVERED |
| FR10 | `Send now` after interrupt, ordered flush, same-session continuation, and automatic return to generating controls.          | Epic 2, Stories 2.3–2.7.                                                                                 | COVERED |
| FR11 | Ordered, attributed operator and interrupted-tool records that remain distinct from agent prose under concurrency.          | Epic 2, Stories 2.8 and 2.13; reader prerequisite in Story 1.1.                                          | COVERED |
| FR12 | Universal interrupt plus boundary-delivery floor with provider-gated mid-turn acceleration.                                 | Epic 2, Stories 2.1 and 2.3–2.7; gated backlog G2, G3, and G4.                                           | COVERED |
| FR13 | Honest `sent` floor and id-correlated Claude-only `delivered` state after its SDK gate.                                     | Epic 2, Story 2.8; gated backlog G1.                                                                     | COVERED |

### Epic FR Coverage Extracted

- FR1: Story 1.1.
- FR2: Story 1.3.
- FR3: Story 1.5.
- FR4: Story 1.6.
- FR5: Story 1.4.
- FR6: Story 1.7 in the explicit coverage map; Stories 2.9 and 2.10 provide the finished-live-iteration behavior required by the canonical FR.
- FR7: Story 1.2.
- FR8: Stories 2.1, 2.2, 2.9, 2.10, and 2.11.
- FR9: Stories 2.3–2.7, with Story 1.1 supplying the interrupted-row reader.
- FR10: Stories 2.3–2.7.
- FR11: Stories 2.8 and 2.13.
- FR12: Stories 2.1 and 2.3–2.7 for v1; G2–G4 for post-v1 soft injection.
- FR13: Story 2.8 for v1; G1 for post-v1 delivery confirmation.

### Missing Requirements

No canonical functional requirement lacks an Epic or Story implementation path.

The Epic coverage table understates FR6 by listing only Story 1.7.
Story 2.10, with Story 2.9 support, owns the finished-live-iteration behavior already present in FR6.
The table should include those stories so traceability does not depend on reading the full Story bodies.

The separate coverage-map entries for terminal reconciliation, idle-await safety, and concurrent attribution do not introduce extra PRD FR numbers.
They implement requirements already extracted from FR8, FR11, and the companion contracts.

### Coverage Statistics

- Total PRD FRs: 13.
- FRs covered in Epics and Stories: 13.
- Missing FRs: 0.
- Functional coverage: 100%.
- Traceability-table omissions: 1, affecting FR6 only.

## UX Alignment Assessment

### UX Document Status

UX documentation exists and is substantial.
The selected UX contract is `ux-designs/ux-Archon-agent-node-room-2026-09-09/DESIGN.md` plus `EXPERIENCE.md`.
The approved handoff contains four interactive HTML mockups for Console, Legacy, transcript states, and steering states.
The browser automation surface refused local `file://` access under its security policy.
This assessment therefore used the complete authoritative HTML, CSS, bindings, and interaction scripts rather than a rendered browser image.

### UX to PRD Alignment

The main readable-transcript journey aligns with SPEC CAP-1 through CAP-7.
The main steering journey aligns with SPEC CAP-8 through CAP-11 and the universal CAP-12 floor.
The UX correctly keeps one composer dock at the panel bottom, keeps the node running through an interrupt, distinguishes `Queue` from `Send now`, records operator rows, and keeps a finished-iteration view read-only.
The approved mockups also show current-scope controls and states that the PRD marks as gated, rejects, or does not require.
Those visible items cannot be removed from scope by README notes, state-sheet prose, or backlog labels under the active project customization.

### UX to Architecture Alignment

The shared row presenter, two thin shell renderers, lazy body presentation, occurrence grouping, pinned todo projection, projected steering sub-state, in-process queue, same-session continuation, operator-row persistence, and finished-iteration read-only poll all have architectural owners.
The architecture does not support a product-facing provider-mode switch, a product-facing state-review tab strip, or the other review-only controls that remain visible in the approved mockups.
The architecture also explicitly contradicts the visible finished-iteration note that says steering carries a retry epoch and is rejected on arrival.
Steering mutations are node-scoped and iteration-agnostic; the client must avoid issuing them from a finished iteration.

### Claim Reconciliation Before Downgrade

| Topic                          | Mockup claim                                                                                                                                           | Planning claim                                                                                                                                                                                     | Claim classes                                                                             | Reconciliation                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Todo strip position            | Console and Legacy place the todo strip after the transcript and immediately above the queue/dock.                                                     | SPEC CAP-3 and `todo-fold-contract.md` Rendering rules require the strip at the top of the transcript panel.                                                                                       | Mockup runtime layout versus normative requirement.                                       | The positions are mutually exclusive, so this is a conflict.                                                                 |
| Todo state on node end         | Console and Legacy scripts convert all remaining items to done on completion and convert the current item back to todo on the 30-minute failure state. | `todo-fold-contract.md` says the displayed state is the fold of provider calls, unknown operations leave it unchanged, and rejected calls are atomic no-ops.                                       | Mockup runtime behavior versus normative state rule.                                      | The mockup invents terminal mutations that no provider committed, so this is a conflict.                                     |
| Occurrence labels              | Transcript States visibly presents `Run`, `Pass`, and reason-only headers and says to pick one later.                                                  | SPEC CAP-6, `tool-presentation-contract.md` Occurrence grouping, and EXPERIENCE Voice and Tone require `Run` or `Iteration` and reject `Attempt`, `Pass`, and reason-only labels.                  | Visible alternatives versus normative wording rule.                                       | The alternatives cannot all be current behavior, so the `Pass` and reason-only variants conflict.                            |
| Queue scope label              | Steering Dock States and the main shell mockups place `this tab only` inside `QUEUED` and `WILL SEND` queue surfaces.                                  | SPEC CAP-8 and EXPERIENCE Voice and Tone state that only unsent composer text is tab-local and that the queued band carries no scope label.                                                        | Mockup runtime copy versus normative scope rule.                                          | The claims describe different ownership for the same queued items, so this is a conflict.                                    |
| Per-item send while generating | Console and Legacy show `Send now` on each queued item when the soft-inject review mode is selected.                                                   | SPEC CAP-12 and steering AD-3 make soft-inject spike-gated, Story 2.5 keeps OMP soft-inject behind G4, and the Steering Dock States refusal table rejects per-item send while generating.          | Mockup runtime control versus normative v1 floor and a second mockup runtime prohibition. | The control is visible current scope but is not implementable under the accepted v1 contract, so this is a conflict.         |
| Delivered state                | Steering Dock States visibly renders an operator row with `delivered`.                                                                                 | SPEC CAP-13, steering AD-8, Story 2.8, and G1 say all current providers stay at `sent` until the Claude SDK gate clears.                                                                           | Mockup runtime state versus normative current capability and deferred capability.         | The visible state is current scope under customization but is unreachable at the accepted pin, so this is a conflict.        |
| Queue shape                    | Steering Dock States renders the queue as an inset well inside the dock.                                                                               | Console and Legacy render a full-width collapsible band, and DESIGN Components adopts the full-bleed band instead of a well.                                                                       | Two approved mockup runtime layouts plus a normative UX decision.                         | One implementation cannot use both structures for the same state, so this is a conflict.                                     |
| Soft-inject review switch      | Console and Legacy expose a switch between `claude · soft-inject` and `codex · queue only`.                                                            | SPEC CAP-12, steering AD-3, and backlog G2–G4 say soft-inject is gated and define no product-facing transport switch.                                                                              | Mockup runtime control versus normative capability gate.                                  | The visible control presents a gated mode as selectable current behavior, so this is a conflict.                             |
| Finished-iteration targeting   | The visible finished-iteration note says a steer carries the node id and retry epoch and would be rejected on arrival.                                 | SPEC CAP-6, `control-states.md` Viewing a finished iteration, readable AD-16, and Story 2.10 say mutation routes remain node-scoped and iteration-agnostic and that the client issues no mutation. | Mockup explanatory runtime claim versus normative wire contract.                          | The server-targeting claims are mutually exclusive, so this is a conflict even though the visible read-only dock is correct. |

### Mockup Feature Behavior Matrix

The matrix treats each visible control, state, transition, and behavior as current scope.
`Read AD-n` refers to the readable-transcript architecture spine.
`Steer AD-n` refers to the live-agent-steering architecture spine.
An absent exact citation is recorded instead of being inferred from a nearby broad requirement.

#### Transcript and Todo Behaviors

| ID  | Mockup location                                                         | Atomic behavior                                                                                                    | Precondition                                   | Action                                    | Affected items                                                   | Timing                                          | Expected result                                                                              | Remaining state                                                | PRD citation                                                                              | Architecture citation                                                       | Epic or Story citation                                                                             | Status   |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------- |
| T01 | Console and Legacy room frames                                          | Both shells use the same transcript meaning and row anatomy.                                                       | A node room is open.                           | Render stored history.                    | All transcript rows.                                             | Initial render and updates.                     | Console and Legacy differ only through shell tokens and markup.                              | Stored data is unchanged.                                      | SPEC Constraints, Shared.                                                                 | Read AD-1 and AD-2.                                                         | Epic 1; Story 1.1 AC 1.                                                                            | MATCHED  |
| T02 | Console and Legacy transcript rows; Transcript States C                 | A tool call renders as one scan line with chevron, glyph, chip, headline, and badges.                              | A tool call exists.                            | Render its summary.                       | One tool call.                                                   | Initial render.                                 | The row does not wrap or show serialized JSON.                                               | The body stays closed unless its initial state says otherwise. | SPEC CAP-1; `tool-presentation-contract.md` Collapsed row.                                | Read AD-10, AD-13, and AD-14.                                               | Story 1.1 AC 1 and AC 3.                                                                           | MATCHED  |
| T03 | Console and Legacy sample rows                                          | Success starts collapsed and failure starts expanded.                                                              | A completed tool outcome is known.             | Render the row.                           | One row.                                                         | First render only unless the reader changes it. | Success is closed and failure is open.                                                       | Manual disclosure state is local.                              | SPEC CAP-1.                                                                               | Read AD-12 and AD-13.                                                       | Story 1.1 AC 1 and AC 2.                                                                           | MATCHED  |
| T04 | Transcript States B                                                     | Five distinct glyphs show success, failure, running, interruption, and unknown.                                    | An outcome is available or absent.             | Render the outcome.                       | Status glyph and accessible name.                                | Every render.                                   | `✓`, `✕`, `◐`, `⚠`, or `–` carries meaning without colour.                                   | Output-missing remains a badge, not a glyph change.            | SPEC CAP-1 and CAP-9.                                                                     | Read AD-13.                                                                 | Story 1.1 AC 2, AC 3, and AC 5.                                                                    | MATCHED  |
| T05 | Transcript States A                                                     | Nine families use five specific colour treatments.                                                                 | A family resolves.                             | Render its chip.                          | Family chip.                                                     | Every row render.                               | Sibling families share the approved hues.                                                    | Family meaning also remains in text.                           | SPEC CAP-1 requires a family chip but does not define five treatments.                    | Read AD-10 defines family data but not the five-treatment palette.          | Story 1.1 AC 1 and AC 3 do not define the palette.                                                 | PARTIAL  |
| T06 | Transcript States C hard cases                                          | A sent single-token name of at most 24 characters is shown; longer or multi-token names use the family.            | A provider tool name exists.                   | Resolve chip text.                        | Family chip.                                                     | Row construction.                               | Long names cannot burst or truncate inside the chip.                                         | The original name remains available to body and Raw.           | SPEC CAP-1; `tool-presentation-contract.md` Collapsed row.                                | Read AD-10.                                                                 | Story 1.1 AC 3.                                                                                    | MATCHED  |
| T07 | Transcript States C hard cases; both rooms                              | Paths elide in the middle, other headlines elide at the end, and duration drops before essential badges.           | Width is constrained.                          | Render a long row.                        | Headline and badges.                                             | Layout under pressure.                          | The filename and important counts remain visible on one line.                                | Dropped facts remain in the body bar.                          | SPEC Constraints, Read half; extracted NFR8.                                              | Read AD-11 and AD-14.                                                       | Story 1.1 AC 1; Epic NFR coverage.                                                                 | MATCHED  |
| T08 | Transcript States C hard case 2                                         | A Codex shell wrapper is removed only from the headline and multiline commands use the first non-empty line.       | A fixed wrapped Codex shell name exists.       | Build the headline.                       | Shell headline.                                                  | Row construction.                               | The concise command is shown with an ellipsis when more lines exist.                         | The full name remains in body and Raw.                         | `tool-presentation-contract.md` Collapsed row and provider rules.                         | Read AD-15.                                                                 | Story 1.1 AC 1; Story 1.3 AC 2.                                                                    | MATCHED  |
| T09 | Transcript States C hard case 3                                         | An MCP tool renders as `server · tool`.                                                                            | An `mcp__server__tool` name exists.            | Resolve display text.                     | Generic-family headline and chip.                                | Row construction.                               | The raw MCP prefix is not shown as the headline.                                             | Raw keeps the provider payload.                                | `tool-presentation-contract.md` Resolver.                                                 | Read AD-10.                                                                 | Story 1.3 AC 2 and AC 3.                                                                           | MATCHED  |
| T10 | Transcript States C hard case 4                                         | An unknown tool shows at most three bounded scalar pairs and collapses nested values.                              | No known family matches.                       | Expand the row.                           | Generic body.                                                    | On disclosure.                                  | Nested objects and arrays show `{…}` and `[n]` without a JSON dump.                          | Raw remains available.                                         | SPEC CAP-2.                                                                               | Read AD-3, AD-8, and AD-10.                                                 | Story 1.3 AC 3 and AC 4.                                                                           | MATCHED  |
| T11 | Transcript States D shell                                               | A shell body shows command, output, exit facts, and Raw.                                                           | A shell row is expanded.                       | Open the row.                             | Shell body.                                                      | On disclosure.                                  | The terminal-shaped body appears.                                                            | Other rows do not change.                                      | SPEC CAP-2.                                                                               | Read AD-10 and AD-12.                                                       | Story 1.3 AC 1.                                                                                    | MATCHED  |
| T12 | Console and Legacy failed edit; Transcript States D file                | A qualifying file edit shows a truthful inline diff and counts.                                                    | Own before and after strings qualify.          | Expand the file row.                      | Diff body and badges.                                            | On disclosure after bounded computation.        | Added, deleted, and hunk facts match the payload.                                            | Raw remains original and non-qualifying input falls back.      | SPEC CAP-5.                                                                               | Read AD-4 through AD-6 and AD-8.                                            | Story 1.4 AC 1 through AC 5.                                                                       | MATCHED  |
| T13 | Transcript States D web                                                 | A web body shows URL, title, and markdown content.                                                                 | A web-family row exists.                       | Expand it.                                | Web body.                                                        | On disclosure.                                  | The body is web-shaped instead of generic JSON.                                              | Row summary stays unchanged.                                   | SPEC CAP-2.                                                                               | Read AD-10 and AD-12.                                                       | Story 1.3 AC 1.                                                                                    | MATCHED  |
| T14 | Transcript States D search                                              | Search content shows pattern, scope, and inline path-line matches.                                                 | Search resolves to content mode.               | Expand it.                                | Search body.                                                     | On disclosure.                                  | Match lines are readable and bounded.                                                        | Count stays available as a badge where applicable.             | SPEC CAP-2; `tool-presentation-contract.md` Search body arm.                              | Read AD-10 and AD-12.                                                       | Story 1.3 AC 1 and AC 2.                                                                           | MATCHED  |
| T15 | Transcript States D glob                                                | Glob or files-with-matches output shows a flat path list.                                                          | The body mode resolves to paths.               | Expand it.                                | Paths body.                                                      | On disclosure.                                  | Paths render without false line parsing.                                                     | Row summary stays unchanged.                                   | SPEC CAP-2; `tool-presentation-contract.md` Glob and search rules.                        | Read AD-10 and AD-12.                                                       | Story 1.3 AC 1 and AC 2.                                                                           | MATCHED  |
| T16 | Transcript States D code                                                | Code shows highlighted source and a separate result box.                                                           | A code-family row exists.                      | Expand it.                                | Code body.                                                       | On disclosure.                                  | Source and result use bounded code presentation.                                             | Raw remains available.                                         | SPEC CAP-2.                                                                               | Read AD-10 and AD-12.                                                       | Story 1.3 AC 1.                                                                                    | MATCHED  |
| T17 | Transcript States D task batch                                          | OMP task batches show context and one collapsible card per subtask.                                                | An OMP batch dispatch exists.                  | Expand the task row and optional subtask. | Batch context and subtask cards.                                 | On disclosure.                                  | Each agent, subtask, and prompt is shown without invented outcome.                           | The row outcome remains the only dispatch status.              | SPEC CAP-4.                                                                               | Read AD-7 and AD-10.                                                        | Story 1.6 AC 1 through AC 3.                                                                       | MATCHED  |
| T18 | Transcript States D task single                                         | Claude task dispatch shows one card with no fabricated batch context.                                              | A Claude single dispatch exists.               | Expand it.                                | One subtask card.                                                | On disclosure.                                  | Exactly one normalized card appears.                                                         | No batch-level block is added.                                 | SPEC CAP-4; `tool-presentation-contract.md` task normalizer.                              | Read AD-7 and AD-10.                                                        | Story 1.6 AC 1 and AC 2.                                                                           | MATCHED  |
| T19 | All expanded bodies; Transcript States F                                | `Raw` is closed by default and swaps the readable body with original JSON.                                         | Any tool card is expanded.                     | Activate `Raw` or `Raw ▾`.                | One tool body.                                                   | Immediately on activation.                      | Exact provider JSON replaces the readable body and can be closed again.                      | Full-output loading remains available.                         | SPEC CAP-7.                                                                               | Read AD-10 and AD-12.                                                       | Story 1.2 AC 1 through AC 3.                                                                       | MATCHED  |
| T20 | Both rooms and Transcript States todo examples                          | Every historical todo call stays compact while one folded checklist represents current state.                      | Todo calls exist in the selected slice.        | Render history and folded state.          | Todo rows and node-level todo state.                             | Initial render and new calls.                   | History does not repeat the checklist.                                                       | The fold remains provider-neutral.                             | SPEC CAP-3; `todo-fold-contract.md` Rendering rules.                                      | Read AD-7 and AD-12.                                                        | Story 1.5 AC 1, AC 3, and AC 4.                                                                    | MATCHED  |
| T21 | Console and Legacy room DOM after transcript                            | The pinned todo strip appears below the transcript instead of at its top.                                          | Current todo state is non-empty.               | Render the room.                          | Todo strip and transcript viewport.                              | Throughout the room session.                    | Mockup result is bottom placement.                                                           | The strip stays above queue and dock.                          | SPEC CAP-3 requires top placement.                                                        | Read AD-12 requires the pinned strip behavior.                              | Story 1.5 AC 2 requires it above the transcript.                                                   | CONFLICT |
| T22 | Console and Legacy todo strip                                           | The collapsed todo header shows the current item, completed count, and segmented meter and expands to phase items. | Folded todo state exists.                      | Activate the todo strip.                  | Todo header and checklist.                                       | Immediate local transition.                     | Expanded state shows phase and item status and collapse restores the summary.                | Transcript rows remain unchanged.                              | SPEC CAP-3 requires current state and a collapsible strip but not every summary detail.   | Read AD-7 and AD-12 do not specify the meter.                               | Story 1.5 AC 2 does not specify the meter or current-item headline.                                | PARTIAL  |
| T23 | Console and Legacy expanded todo strip                                  | The pinned todo strip exposes its own `Raw` button.                                                                | The strip is expanded.                         | Activate Raw.                             | Node-level todo strip.                                           | On activation.                                  | A raw representation is implied for the folded node-level projection.                        | Historical rows stay compact.                                  | No exact PRD requirement gives Raw to the pinned strip; SPEC CAP-7 applies to tool cards. | No architecture decision defines a Raw payload for node-level folded state. | Story 1.2 covers tool rows and Story 1.5 does not add strip Raw.                                   | MISSING  |
| T24 | Console and Legacy `todoEnd` script                                     | Terminal presentation rewrites unfinished todo items to done on completion or resets current to todo on failure.   | The selected state is completed or failed.     | Switch to that terminal state.            | Folded todo items and counts.                                    | At state selection or terminal render.          | The checklist changes without a provider todo call.                                          | The synthetic state persists in that mockup state.             | SPEC CAP-3 and `todo-fold-contract.md` require a fold of provider calls only.             | Read AD-7 derives state from history and defines no terminal rewrite.       | Story 1.5 AC 1 requires the fold contract.                                                         | CONFLICT |
| T25 | Console and Legacy occurrence headers; Transcript States E first option | Repeated execution uses `Run n` or `Iteration n` wording and groups by occurrence.                                 | More than one occurrence exists.               | Render the transcript.                    | Occurrence headings.                                             | Initial render.                                 | Each group has a stable readable heading and one group does not show a heading.              | Attempts remain inside their occurrence.                       | SPEC CAP-6; `tool-presentation-contract.md` Occurrence grouping.                          | Read AD-7, AD-12, and AD-16.                                                | Story 1.7 AC 1 through AC 3.                                                                       | MATCHED  |
| T26 | Transcript States E second and third options                            | `Pass n` and reason-only occurrence headings are visible current alternatives.                                     | The states sheet is opened.                    | Review the alternatives.                  | Occurrence label vocabulary.                                     | Current approved handoff.                       | Three incompatible labels are shown for one semantic slot.                                   | No selection is resolved in the mockup.                        | SPEC CAP-6 requires labels derived from retry epoch and loop ancestry.                    | Read AD-10 and AD-12 support the resolved labels.                           | Story 1.7 requires one header per occurrence and EXPERIENCE rejects `Pass` and reason-only labels. | CONFLICT |
| T27 | Both rooms, log rows, and `Execution` select                            | Execution controls filter or select an execution while occurrence navigation remains a separate scroll action.     | Several executions or iterations exist.        | Select a log row or `Execution` option.   | Loaded transcript, selected log row, and header control.         | On selection.                                   | Selection stays synchronized and the correct execution is shown.                             | The scroll-only navigator remains a separate control.          | SPEC CAP-6.                                                                               | Read AD-12 and AD-16.                                                       | Story 1.7 AC 2; Story 2.10 AC 1.                                                                   | MATCHED  |
| T28 | Console and Legacy finished loop iteration                              | A finished iteration shows a read-only pending queue and `Go to iteration N` without steering actions.             | A live loop has a finished iteration selected. | Inspect it or activate Go.                | Finished transcript, disclosure, queue band, and live selection. | While stale; transition on Go.                  | No send, withdraw, or interrupt mutation is available, and Go returns to the live iteration. | Queue order remains node-scoped and shared.                    | SPEC CAP-6.                                                                               | Read AD-16; Steer AD-11.                                                    | Story 2.10 AC 1 through AC 5.                                                                      | MATCHED  |

#### Steering Behaviors

| ID  | Mockup location                                                   | Atomic behavior                                                                                                            | Precondition                                               | Action                                  | Affected items                                        | Timing                                                 | Expected result                                                                | Remaining state                                           | PRD citation                                                                                        | Architecture citation                                                      | Epic or Story citation                                                                          | Status   |
| --- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------ | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------- |
| S01 | Steering Dock States 1; both rooms generating                     | The live composer stays enabled with `Stop` left and `Queue` right.                                                        | The agent sub-state is generating.                         | Type or inspect controls.               | Composer and control row.                             | Throughout generation.                                 | The node keeps working and the controls remain stable.                         | Node stays running.                                       | SPEC CAP-8 and CAP-9.                                                                               | Steer AD-1, AD-3, and AD-9.                                                | Story 2.1 AC 1; Story 2.3 AC 2.                                                                 | MATCHED  |
| S02 | Both rooms generating                                             | Pressing `Queue` sends the message to the server registry immediately without interrupting the turn.                       | Generating and the draft is valid.                         | Activate Queue or its shortcut.         | Draft, registry queue, and current turn.              | On acceptance.                                         | The queue gains the message and the in-flight work is unchanged.               | The agent remains generating.                             | SPEC CAP-8.                                                                                         | Steer AD-3 and AD-11.                                                      | Story 2.1 AC 2 through AC 4.                                                                    | MATCHED  |
| S03 | Both rooms queue band                                             | Queued messages are ordered and shared across tabs and operators.                                                          | The same node is open in several views.                    | Queue or poll.                          | Node-scoped queue band.                               | After successful mutation and convergence.             | Each view reaches the same ordered list.                                       | Only unsent composer text stays tab-local.                | SPEC CAP-8.                                                                                         | Steer AD-5 and AD-11.                                                      | Story 2.9 AC 1 through AC 4; Story 2.13 AC 1.                                                   | MATCHED  |
| S04 | Both rooms collapsible queue band                                 | The band can collapse and shows ordinals plus a next-out highlight.                                                        | At least one queued item exists.                           | Toggle the band or inspect order.       | Queue header and item rows.                           | Immediate local transition.                            | Order and next-out are visually explicit.                                      | Queue contents stay unchanged.                            | SPEC CAP-8 requires ordered shared state but not ordinals, a collapse control, or next-out styling. | Steer AD-11 defines receipt order but not these visual details.            | Story 2.1 and Story 2.9 define order and visibility but not these details.                      | PARTIAL  |
| S05 | Both rooms queue items                                            | Each queued item has an accessible delete action that withdraws it idempotently.                                           | The item is still queued.                                  | Activate its delete control.            | One queue item and queue count.                       | On route success.                                      | The item disappears and other views converge.                                  | Other queue items keep their order.                       | SPEC CAP-8 companion API contract.                                                                  | Steer AD-11.                                                               | Story 2.2 AC 1 through AC 4.                                                                    | MATCHED  |
| S06 | Steering Dock States 1–3 and both room queues                     | `this tab only` is displayed on `QUEUED` or `WILL SEND` content.                                                           | A server-accepted queue exists.                            | Render the queue.                       | Queue scope copy.                                     | While items wait.                                      | The mockup labels shared data as tab-local.                                    | Queue is still implemented as server state.               | SPEC CAP-8 says only unsent composer text is tab-local.                                             | Steer AD-11 says queued data is server-side and shared.                    | Story 2.1 AC 1 and Story 2.9 AC 2 reserve the label for unsent text.                            | CONFLICT |
| S07 | Both rooms under `claude · soft-inject`                           | A queued item exposes per-item `Send now` while the agent is generating.                                                   | Soft-inject review mode is selected.                       | Activate one item's Send now.           | One queued item and active turn.                      | Mid-turn.                                              | The item is handed to the running turn without interrupt.                      | Other queued items remain.                                | SPEC CAP-12 says this path is spike-gated and not the v1 floor.                                     | Steer AD-3 says not to present soft-inject as v1-ready.                    | Story 2.5 AC 5 and backlog G2–G4 keep it gated; Steering Dock States also refuses this control. | CONFLICT |
| S08 | Steering Dock States 2; both rooms interrupting                   | `Stop` becomes focusable `Stopping…`, `Queue` remains, and idle is not shown early.                                        | Stop was submitted and the interrupt has not acknowledged. | Wait for the response.                  | Stop label, focus, send label, and live announcement. | Brief sub-second transient.                            | No progress bar appears and focus is preserved.                                | Node remains running and generating until acknowledged.   | SPEC CAP-9; `control-states.md` interrupting row.                                                   | Steer AD-2 and AD-9.                                                       | Story 2.3 AC 8.                                                                                 | MATCHED  |
| S09 | Steering Dock States 3; both rooms idle                           | Stop disappears, send becomes `Send now`, header becomes `WILL SEND`, and the written-work disclosure appears.             | The turn ended by operator interrupt.                      | Render idle-after-interrupt.            | Tool outcome and dock.                                | After acknowledgement.                                 | The tool shows `⚠ interrupted` and the node remains running.                   | Queued items wait for explicit Send now.                  | SPEC CAP-9 and CAP-10.                                                                              | Steer AD-2 through AD-4 and AD-9.                                          | Story 2.3 AC 4 and AC 5.                                                                        | MATCHED  |
| S10 | Steering Dock States 4; both rooms generating again               | `Send now` flushes queued then newly typed guidance in receipt order on the same session and restores generating controls. | Idle-after-interrupt with valid guidance.                  | Activate Send now.                      | Queue, operator rows, provider turn, and controls.    | Immediately after dispatch and when generation starts. | Guidance becomes the next turn and Stop plus Queue return.                     | Node remains running on the same session.                 | SPEC CAP-10.                                                                                        | Steer AD-3, AD-4, AD-6, and AD-9.                                          | Story 2.3 AC 6; Stories 2.4–2.7 continuation ACs.                                               | MATCHED  |
| S11 | Steering Dock States operator record; both rooms generating again | Delivered operator prose appears between the interrupted and caused work with sender name and `sent`.                      | Guidance was delivered.                                    | Read the transcript.                    | Operator text rows and adjacent tool rows.            | After executor persistence.                            | Order and authorship are explicit and distinct from assistant prose.           | Row remains durable.                                      | SPEC CAP-11 and CAP-13 floor.                                                                       | Steer AD-6, AD-10, and AD-12.                                              | Story 2.8 AC 1 through AC 5; Story 2.13 AC 2.                                                   | MATCHED  |
| S12 | Steering Dock States message-status cards                         | A visible operator row reaches `delivered`.                                                                                | The approved state sheet is open.                          | Inspect the delivered card.             | Message-status badge.                                 | Current-scope handoff.                                 | The word and success colour claim provider echo.                               | Row remains delivered.                                    | SPEC CAP-13 says delivered is unreachable at the current pin.                                       | Steer AD-8 defers the state.                                               | Story 2.8 AC 5 forbids it before G1; G1 is post-v1.                                             | CONFLICT |
| S13 | Steering Dock States 5; both rooms finished-undelivered           | Terminal reconciliation restores unmatched accepted messages as read-only `NEVER SENT` with no controls.                   | Exact node-terminal evidence exists.                       | Reconcile queue ids with operator rows. | Queue ledger and terminal dock.                       | After final transcript drain.                          | Original text survives and the operator is told it did not send.               | Node remains terminal.                                    | SPEC CAP-8 and CAP-11 companion terminal rule.                                                      | Steer AD-11.                                                               | Story 2.11 AC 1 through AC 3.                                                                   | MATCHED  |
| S14 | Steering Dock States 6; both rooms finished-clean                 | A finished node with nothing undelivered has no dock.                                                                      | The node is terminal and reconciliation is empty.          | Render the room.                        | Dock area.                                            | Terminal render.                                       | Transcript reaches the panel bottom with no inert controls.                    | Node remains terminal.                                    | `control-states.md` finished row.                                                                   | Steer AD-11.                                                               | Story 2.11; Story 2.10 AC 5 for other non-live executions.                                      | MATCHED  |
| S15 | Steering Dock States 7; both rooms failed                         | Thirty minutes of idle-after-interrupt inactivity fails the node and restores unsent guidance.                             | No redirect, cancel, or keepalive wins.                    | Let the timer expire.                   | Node state, registry, and terminal dock.              | At 30 minutes of genuine inactivity.                   | The node fails once with the declared reason.                                  | Retry starts a fresh provider session.                    | Extracted NFR15; `control-states.md`; engine integration idle bound.                                | Steer AD-4.                                                                | Story 2.12 AC 1 through AC 6.                                                                   | MATCHED  |
| S16 | Steering Dock States 8; both rooms detached                       | A detached live run shows why it is not steerable and has no composer controls.                                            | The executor is in another process.                        | Open the room.                          | Dock disclosure.                                      | While detached execution is live.                      | Cancel and normal run behavior remain outside the dock.                        | No durable steering queue is created.                     | SPEC Constraints, Write half; extracted NFR13.                                                      | Steer AD-5 and AD-11.                                                      | Story 2.1 AC 5.                                                                                 | MATCHED  |
| S17 | UX failure state represented by approved dock contract            | Delivery failure restores messages to the front and announces the failure.                                                 | A Send now delivery attempt fails.                         | Handle the failure.                     | Queue order, message items, and alert channel.        | On failure.                                            | `couldn't send · back in the queue` is assertive and nothing is lost.          | The agent remains idle-after-interrupt.                   | Extracted NFR16 and NFR5.                                                                           | Steer AD-4 and AD-11.                                                      | Story 2.3 AC 8; Story 2.11 AC 3.                                                                | MATCHED  |
| S18 | Steering Dock States refusal table and UX Flow 4 failure          | A node parked at its own ask blocks send with an accessible reason, and Enter inserts a newline.                           | The node is pending at an unanswered ask.                  | Type or attempt send.                   | Composer and send control.                            | While blocked.                                         | The control does not dispatch and explains the block.                          | Draft text remains local.                                 | Extracted NFR5; `control-states.md`.                                                                | Steer AD-1 and AD-11.                                                      | Story 2.1 AC 6.                                                                                 | MATCHED  |
| S19 | Steering Dock States refusal table                                | The UI does not flip to idle before interrupt acknowledgement.                                                             | An interrupt is in flight.                                 | Wait.                                   | Projected sub-state and controls.                     | Until provider acknowledgement.                        | `Stopping…` remains truthful.                                                  | Node stays running.                                       | SPEC CAP-9.                                                                                         | Steer AD-2 and AD-9.                                                       | Story 2.3 AC 2 and AC 8.                                                                        | MATCHED  |
| S20 | Steering Dock States refusal table; both room scripts             | The queue surface is absent when it has no items.                                                                          | Queue length is zero.                                      | Render the dock.                        | Queue band.                                           | Every render.                                          | No empty shell appears.                                                        | Composer remains when live.                               | Extracted NFR23.                                                                                    | Steer AD-9 and AD-11.                                                      | Story 2.1 AC 1; Story 2.10 AC 1 and AC 2.                                                       | MATCHED  |
| S21 | Steering Dock States refusal table                                | Sending never silently stops the node and Stop never means Cancel.                                                         | The node is generating.                                    | Use Queue, Send now, or Stop.           | Provider turn and node lifecycle.                     | At action time.                                        | Queue is non-interrupting, Stop ends only the turn, and Cancel stays separate. | Node stays running unless its independent lifecycle ends. | SPEC CAP-8 through CAP-10.                                                                          | Steer AD-1 through AD-4.                                                   | Stories 2.1 and 2.3 through 2.7.                                                                | MATCHED  |
| S22 | Both room docks                                                   | The dock is a sibling of the transcript scroller and Stop and Send stay at opposite edges with a stable send width.        | A live dock renders at narrow width.                       | Resize or change sub-state.             | Transcript viewport and control row.                  | During layout and state transitions.                   | The dock does not cover the watched row and controls do not jump.              | Transcript remains the only scroller.                     | Extracted NFR23 requires non-overlap and stable safety placement but not every geometry detail.     | Steer AD-9 and inherited Read AD-12 do not specify opposite-edge geometry. | Story 2.1 and Story 2.3 require controls but not every geometry detail.                         | PARTIAL  |
| S23 | Steering Dock States 1–3 versus both room queue bands             | The same queue is an inset well in one approved mockup and a full-bleed collapsible band in the other two.                 | Queued items exist.                                        | Render the queue.                       | Queue container and dock stack.                       | Every live queue render.                               | Two mutually exclusive container structures are approved.                      | Queue data itself is unchanged.                           | SPEC CAP-8 defines behavior but no geometry.                                                        | Steer AD-9 and AD-11 define state but no geometry.                         | Story 2.1 defines the queue but not geometry; DESIGN adopts full bleed.                         | CONFLICT |
| S24 | Both rooms finished-iteration visible note                        | The note says mutation carries a retry epoch and would be rejected by the server.                                          | A finished iteration is selected.                          | Read the explanatory state.             | Steering target model.                                | While viewing the finished iteration.                  | The mockup claims an iteration-aware rejected mutation.                        | The visible controls still issue no mutation.             | SPEC CAP-6 says mutation routes are node-scoped and iteration-agnostic.                             | Read AD-16 and Steer AD-11 preserve node-scoped routing.                   | Story 2.10 AC 2 says the client issues no mutation.                                             | CONFLICT |
| S25 | Both rooms and Steering Dock States idle-after-interrupt frame    | The live idle dock does not show the 30-minute inactivity limit or state that typing keeps it open.                        | The agent is idle-after-interrupt.                         | Read the dock before timeout.           | Accessible explanatory copy.                          | Throughout idle-await.                                 | Only the written-work disclosure is present.                                   | The timer still runs invisibly.                           | Extracted NFR15 requires the inactivity rule but gives no visible-copy exception.                   | Steer AD-4 defines the timer and keepalive.                                | Story 2.12 AC 6 requires the limit and typing behavior in accessible text.                      | MISSING  |

#### Review-Scaffold Controls

| ID  | Mockup location                     | Atomic behavior                                                                   | Precondition                                  | Action                        | Affected items                                            | Timing                      | Expected result                                                      | Remaining state                                 | PRD citation                                                                    | Architecture citation                            | Epic or Story citation                        | Status   |
| --- | ----------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------- | ----------------------------- | --------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------- | -------- |
| R01 | Console and Legacy top review strip | Eight numbered state buttons switch the complete product frame.                   | A mockup is open.                             | Activate a state button.      | Run, node, transcript, todo, queue, and dock sample data. | Immediate local transition. | The entire frame changes to the selected scenario.                   | Selected review state persists locally.         | No exact product requirement defines a state-review switcher.                   | No architecture owner exists for it.             | No Epic or Story implements it.               | MISSING  |
| R02 | Console and Legacy top review strip | `prompt` and `loop ×3` buttons switch node kind and execution examples.           | A mockup is open.                             | Activate a kind button.       | Log rows, execution options, todo, and dock.              | Immediate local transition. | The frame becomes a prompt or loop example.                          | Selected review kind persists locally.          | No exact product requirement defines this product-facing switcher.              | No architecture owner exists for it.             | No Epic or Story implements it.               | MISSING  |
| R03 | Console and Legacy top review strip | A provider transport button switches between Claude and Codex presentation modes. | A mockup is open.                             | Activate the provider button. | Queue item controls and explanatory note.                 | Immediate local transition. | The mockup changes transport capability without changing a real run. | The selected review transport persists locally. | No exact product requirement defines a provider-mode override in the node room. | No architecture decision owns such a UI control. | No Epic or Story implements it.               | MISSING  |
| R04 | Console and Legacy top review strip | Selecting `claude · soft-inject` enables current mid-turn per-item delivery.      | The provider review button is in Claude mode. | Activate an item's Send now.  | Active provider turn and one queue item.                  | Mid-turn.                   | The message is injected without an interrupt.                        | Other queue items remain.                       | SPEC CAP-12 marks this behavior spike-gated.                                    | Steer AD-3 says not to present it as v1-ready.   | G2 is post-v1 and Story 2.5 defers OMP to G4. | CONFLICT |

#### Existing Chrome Visible in the Approved Mockups

| ID  | Mockup location                                | Atomic behavior                                                          | Precondition                   | Action                | Affected items                                                  | Timing                | Expected result                                           | Remaining state                    | PRD citation                                                                                  | Architecture citation                           | Epic or Story citation                                                        | Status  |
| --- | ---------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------ | --------------------- | --------------------------------------------------------------- | --------------------- | --------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------- | ------- |
| C01 | Console and Legacy run header                  | `Cancel` remains a separate whole-run or node lifecycle action.          | A run is active.               | Activate Cancel.      | Existing lifecycle path.                                        | On request.           | Steering is not mistaken for cancellation.                | Existing cancellation rules apply. | SPEC CAP-9 explicitly keeps Cancel separate but does not specify this button's full behavior. | Steer AD-1 and AD-2 preserve the existing path. | Story 2.3 AC 2 and Story 2.12 AC 3 mention Cancel but do not own the control. | PARTIAL |
| C02 | Legacy completed and failed states             | `Re-run` appears as a run-header action.                                 | The displayed run is terminal. | Activate Re-run.      | Existing run lifecycle.                                         | On request.           | The run is started again under existing behavior.         | A new execution is implied.        | No exact target PRD requirement defines this control.                                         | No target architecture decision owns it.        | No target Epic or Story implements it.                                        | MISSING |
| C03 | Console top tabs and Legacy selected tab       | `Log` or `Logs` selects the log surface.                                 | A run page is open.            | Activate the log tab. | Main run surface.                                               | Immediate navigation. | Log rows and node room are shown.                         | Run state is unchanged.            | No exact target PRD requirement defines this control.                                         | No target architecture decision owns it.        | No target Epic or Story implements it.                                        | MISSING |
| C04 | Console and Legacy top tabs                    | `Graph` selects the graph surface.                                       | A run page is open.            | Activate Graph.       | Main run surface.                                               | Immediate navigation. | The graph surface is shown.                               | Run state is unchanged.            | No exact target PRD requirement defines this control.                                         | No target architecture decision owns it.        | No target Epic or Story implements it.                                        | MISSING |
| C05 | Console `Artifacts 2` and Legacy `Artifacts 4` | The artifacts control opens or selects artifacts and shows a count.      | A run has artifacts.           | Activate Artifacts.   | Artifact surface.                                               | Immediate navigation. | Counted artifacts are exposed.                            | Run state is unchanged.            | No exact target PRD requirement defines this control.                                         | No target architecture decision owns it.        | No target Epic or Story implements it.                                        | MISSING |
| C06 | Console and Legacy log rows                    | Activating a node execution row selects that execution in the node room. | Log rows exist.                | Activate a row.       | Log selection, room header, transcript, and `Execution` select. | Immediate selection.  | The selected execution is shown and controls synchronize. | Run state is unchanged.            | SPEC CAP-6 names Logs-row selection for finished iterations.                                  | Read AD-16.                                     | Story 2.10 AC 1.                                                              | MATCHED |
| C07 | Console and Legacy node-room header            | The `✕` control closes the node room.                                    | The room is open.              | Activate close.       | Node panel visibility and focus.                                | Immediate.            | The room closes.                                          | Run state is unchanged.            | No exact target PRD requirement defines this control.                                         | No target architecture decision owns it.        | No target Epic or Story implements it.                                        | MISSING |

### Matrix Coverage

- Atomic mockup behaviors inventoried: 64.
- MATCHED: 40.
- PARTIAL: 5.
- MISSING: 10.
- CONFLICT: 9.
- UNCLEAR: 0.
- Exact matched coverage: 62.5%.
- Non-matched behaviors: 24.

### Alignment Issues

1. The todo strip is visibly below the transcript, but the normative contract requires it at the top.
2. The main room scripts synthesize terminal todo mutations that the fold contract does not permit.
3. The approved handoff keeps unresolved occurrence-label alternatives that the UX contract explicitly rejects.
4. Queued server-side data is visibly labelled `this tab only`.
5. Per-item soft-inject and `delivered` are visible current states even though their capability gates are not cleared.
6. The approved mockups disagree on the queue container structure and on whether per-item send is allowed while generating.
7. The finished-iteration explanation contradicts the node-scoped, iteration-agnostic API contract.
8. Review controls and several visible chrome controls have no exact PRD, architecture, and Story trace under the active customization.
9. The idle dock omits Story 2.12's required accessible disclosure of the 30-minute limit and keepalive behavior.

### Warnings

- The HTML and interaction source was fully inspectable, but the browser security policy blocked a rendered local-file pass.
- Exact visual output such as font rasterization, clipping, and focus painting still needs the planned visual and accessibility verification on real browser surfaces.
- These visual-verification limits do not cause the readiness failure because the documented semantic conflicts and traceability gaps already make the target not ready.

## Epic Quality Review

### Epic Structure Validation

Epic 1, Readable Agent Transcript, is user-centred and produces a complete standalone improvement for historical and live transcripts.
Epic 2, Live Agent Steering, is also user-centred and produces a complete operator outcome when evaluated at its declared interrupt plus Queue plus sent floor.
Epic 2 may depend on Epic 1 because the sequence is forward-moving and the operator row needs the shared reader first.
Neither Epic is a technical milestone.

Under the active mockup customization, Epic 2 is not independent of its post-v1 backlog.
The approved mockups visibly expose soft-inject and delivered behavior, so current operator-visible scope requires G1, G2, and G4 even though the Epic says those items do not block completion.
This is a forbidden dependency on future work.

### Declared Story Dependency Map

| Story | Declared dependencies | Direction                       | Result             |
| ----- | --------------------- | ------------------------------- | ------------------ |
| 1.1   | None.                 | Root slice.                     | Valid.             |
| 1.2   | 1.1.                  | Backward.                       | Valid.             |
| 1.3   | 1.1.                  | Backward.                       | Valid.             |
| 1.4   | 1.1 and 1.3.          | Backward.                       | Valid.             |
| 1.5   | 1.1.                  | Backward.                       | Valid.             |
| 1.6   | 1.1.                  | Backward.                       | Valid.             |
| 1.7   | 1.1.                  | Backward.                       | Valid.             |
| 2.1   | None inside Epic 2.   | Root steering slice.            | Valid as declared. |
| 2.2   | 2.1.                  | Backward.                       | Valid.             |
| 2.3   | 1.1 and 2.1.          | Backward across completed work. | Valid as declared. |
| 2.4   | 2.3.                  | Backward.                       | Valid.             |
| 2.5   | 2.3.                  | Backward.                       | Valid.             |
| 2.6   | 2.3.                  | Backward.                       | Valid.             |
| 2.7   | 2.3.                  | Backward.                       | Valid.             |
| 2.8   | 1.1, 2.1, and 2.3.    | Backward.                       | Valid.             |
| 2.9   | 2.1 and 2.2.          | Backward.                       | Valid.             |
| 2.10  | 1.7 and 2.9.          | Backward.                       | Valid.             |
| 2.11  | 2.8 and 2.9.          | Backward.                       | Valid.             |
| 2.12  | 2.3 and 2.11.         | Backward.                       | Valid.             |
| 2.13  | 2.8 and 2.9.          | Backward.                       | Valid.             |

No declared Story has a numeric forward dependency.
The defect is the undeclared behavior dependency from visible current mockup scope to G1, G2, and G4.

### Story Sizing and Acceptance-Criteria Assessment

Most stories are vertical, user-visible slices with Given, When, Then acceptance criteria and explicit error or fallback cases.
Stories 1.1 through 1.3, 1.5 through 1.7, 2.2, 2.4 through 2.10, and 2.13 have a coherent primary outcome.
Story 1.4 is complex but remains one bounded operator outcome and has deterministic safety criteria.
Story 2.12 is also complex but remains one bounded safety outcome.

Story 2.1 is oversized.
It combines composer behavior, typed server dispatch, registry design, natural-boundary delivery, idempotency, authorization, detached and terminal errors, ask blocking, keyboard behavior, and reduced motion across web, server, workflows, and provider seams.
The result is independently valuable, but it is too large for a reliable single Story implementation and review cycle.

Story 2.3 is oversized.
It combines registry lifecycle, Claude native interrupt, race classification, validation and re-ask suppression, interrupted-row persistence, same-session continuation, direct and loop parity, announcements, focus management, and delivery failure behavior.
It functions as the shared steering foundation for four later provider stories and is closer to a small Epic than one Story.

### Critical Violations

#### Q-C1: Current visible scope depends on post-v1 gated work

The Epic completion statement says G1 through G4 do not block either Epic.
The approved Console and Legacy mockups visibly expose a soft-inject transport mode and per-item `Send now` while generating.
The approved Steering Dock States mockup visibly exposes `delivered`.
Under the active customization, those visible behaviors are current scope and cannot be deferred by notes or backlog gates.
Therefore Epic 2 depends on future G1, G2, and G4 behavior and fails the no-forward-dependency rule.

Remediation: either create owned, in-sequence Stories that clear the SDK and conformance gates before the dependent UI Stories, or revise and reapprove every mockup so the gated controls and states are no longer visible current scope.

### Major Issues

#### Q-M1: Story 2.1 is too large for one implementation slice

The Story spans every runtime layer and includes seven independent acceptance groups.
Failure in any one layer prevents the operator outcome, which makes review and rollback unnecessarily broad.

Remediation: split the work into backward-ordered vertical slices that each leave a usable operator outcome, such as basic queue and natural drain, then typed negative paths and authorization, then blocked-state and accessibility completion.

#### Q-M2: Story 2.3 is too large and owns too much shared foundation

The Story contains the Claude feature, the generic multi-turn executor, shared interrupt classification, loop parity, transcript persistence, race behavior, and dock accessibility.
Later provider Stories depend on this whole foundation.

Remediation: split direct Claude interrupt and redirect from loop-path parity and from UI race and accessibility completion, while keeping each new Story demonstrably usable and ordered behind its prerequisite.

#### Q-M3: Interrupt-route rejection criteria are not complete in a Story

Story 2.1 specifies typed rejection behavior for Send, and Story 2.2 does so for Withdraw.
Story 2.3 does not state the acceptance behavior for unauthenticated interrupt, detached execution, unknown target, invalid payload, or a terminal node.
The API contract covers these cases, but the Story acceptance criteria do not make their implementation owner and verification point explicit.

Remediation: add one interrupt-route negative-path acceptance group to Story 2.3 with the exact statuses and the invariant that node, queue, and transcript state remain unchanged.

#### Q-M4: Story 1.7 uses an ambiguous control name

Its second acceptance group says the operator uses the `loop-iteration selector` when more than one occurrence exists.
The UX contract distinguishes the `Execution` selector, which filters, from `Jump to`, which scrolls within loaded occurrence groups.
The present wording can produce one merged control that violates the accepted interaction model.

Remediation: name `Jump to` for scroll-only occurrence navigation and reserve `Execution` for server or client scope selection, with separate acceptance criteria for each.

#### Q-M5: Story 2.11 understates terminal reconciliation cases

The Story says reconciliation runs when the client receives the node terminal event.
The architecture requires exact node-terminal evidence, node-wide transcript drain, a Cancel catch-up window, Ask-resume scope handling, observation-ledger retention, and fail-closed behavior when evidence or drain is incomplete.
Those rules prevent false `NEVER SENT` claims but are not testable from the Story text alone.

Remediation: add acceptance groups for early run cancellation without a raw node event, incomplete or ambiguous terminal evidence, resumed Ask scoping, and node-wide comparison independent of occurrence filters.

#### Q-M6: Story 2.12 requires an idle warning that no approved product frame contains

Acceptance criterion 6 requires the live idle dock to disclose the 30-minute limit and state that typing keeps it open in accessible text.
The approved idle-after-interrupt frames contain only the written-work disclosure.
The Story is testable, but its required UX is not implementation-ready.

Remediation: add the exact visible and accessible timer copy to both shell mockups and the UX component contract before implementation.

### Minor Concerns

#### Q-m1: FR6 traceability is incomplete in the Epic coverage table

The Epic coverage table maps FR6 only to Story 1.7 even though Stories 2.9 and 2.10 own the finished-live-iteration queue and dock behavior.

Remediation: add Stories 2.9 and 2.10 to the FR6 coverage entry.

#### Q-m2: Story 2.10 uses `collapsed disclosure` imprecisely

The control-state and design contracts describe a one-line read-only mode with disclosure copy and a Go button, not an interactive disclosure widget.

Remediation: replace `collapsed disclosure` with `read-only one-line disclosure` or the exact accepted component name.

### Database and Entity Timing

No Story creates tables in advance.
The steering queue stays in process and needs no table.
Story 2.8 owns the first required additive operator metadata fields in the existing strict JSON schema and explicitly adds no migration.
This timing is valid for the brownfield, additive-only database contract.

### Starter and Brownfield Checks

The architecture does not select a starter template, and this is an existing monorepo.
A greenfield setup Story is not applicable.
Both Epics name their existing integration points, compatibility boundaries, and two-shell constraints.

### Best-Practices Compliance

| Check                                        | Epic 1                                     | Epic 2                                                                             |
| -------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------- |
| Delivers user value.                         | Pass.                                      | Pass.                                                                              |
| Can function at its accepted sequence point. | Pass.                                      | Fail under active mockup scope because G1, G2, and G4 become current dependencies. |
| Stories are appropriately sized.             | Pass, with Story 1.4 near the upper bound. | Fail for Stories 2.1 and 2.3.                                                      |
| No forward dependency.                       | Pass.                                      | Fail under active mockup scope.                                                    |
| Database work occurs when first needed.      | Pass or not applicable.                    | Pass.                                                                              |
| Acceptance criteria are clear and complete.  | Major ambiguity in Story 1.7.              | Major gaps in Stories 2.3, 2.11, and 2.12.                                         |
| FR traceability is maintained.               | Pass for implementation coverage.          | Pass for implementation coverage, with the FR6 table omission.                     |

### Epic Quality Result

- Critical violations: 1.
- Major issues: 6.
- Minor concerns: 2.
- Technical Epics: 0.
- Declared numeric forward dependencies: 0.
- Effective forward dependencies under approved mockup scope: 3 gated backlog groups, G1, G2, and G4.

## Summary and Recommendations

### Overall Readiness Status

**NOT READY**

The functional requirements have complete Epic coverage, but the implementation package fails the active readiness gate.
Only 40 of 64 atomic mockup behaviors are exactly matched across the approved mockups, PRD, Architecture, and Epics or Stories.
The remaining set contains 5 partial matches, 10 missing traces or behaviors, and 9 direct conflicts.
Any non-MATCHED behavior is sufficient for `NOT READY` under the current project customization.

The Epic review also found one critical violation, six major issues, and two minor concerns.
The critical violation is an effective forward dependency from visible current scope to post-v1 G1, G2, and G4 gates.

### Critical Issues Requiring Immediate Action

1. Resolve the current-scope decision for soft-inject and `delivered`.
   The approved mockups expose these behaviors now, while the PRD, Architecture, and Stories defer them behind uncleared gates.
   Either bring the gates and their implementation Stories into the current ordered plan, or revise and reapprove every affected mockup so the controls and states are not visible.

2. Reconcile the nine direct mockup-to-plan or mockup-to-mockup conflicts.
   The required resolution includes top placement of the todo strip, removal of synthetic terminal todo mutations, one occurrence-label vocabulary, correct queue ownership copy, one queue container structure, and the node-scoped finished-iteration targeting model.

3. Close all ten missing behavior traces.
   The most important missing product behavior is the accessible idle-dock copy for the 30-minute inactivity limit and typing keepalive.
   The review state switchers, provider-mode switcher, Re-run, Log, Graph, Artifacts, close-room control, and pinned-todo Raw control must each either gain exact PRD, Architecture, and Story ownership or be removed through an approved mockup revision.

4. Remove the forbidden forward dependency in Epic 2.
   The Epic cannot be complete while visible current behavior depends on post-v1 gated backlog items.

### Recommended Next Steps

1. Hold one artifact-reconciliation pass with the product, UX, architecture, and Epic owners.
   Use the 64-row matrix as the checklist and record one accepted behavior for every non-MATCHED row.

2. Update the normative requirements and UX handoff together.
   Do not use notes or backlog labels to override visible mockup behavior.
   Reapprove the four mockups after every conflicting visual or interaction is resolved.

3. Update the Epic plan.
   Split Stories 2.1 and 2.3 into smaller backward-ordered vertical slices.
   Add complete interrupt-route rejection criteria to Story 2.3, exact terminal-reconciliation criteria to Story 2.11, and the idle-warning UX to Story 2.12.

4. Clarify navigation language.
   Story 1.7 must name `Jump to` as scroll-only and `Execution` as scope selection.
   Story 2.10 must use the exact accepted name for its read-only finished-iteration disclosure.

5. Correct traceability.
   Add Stories 2.9 and 2.10 to the FR6 coverage entry.

6. Run implementation readiness again after the artifact set is internally consistent.
   The next run must reach 64 of 64 MATCHED rows, with no missing citation, partial behavior, conflict, or unclear item.

### Final Note

This independent assessment evaluated branch `develop` at commit `49abef22` on 2026-09-20.
The assessor was Codex running the configured `bmad-check-implementation-readiness` workflow.
No product code was modified.
The report records 24 non-matched mockup behaviors and 9 Epic-quality findings across UX or mockup alignment and Epic or Story quality.
Several findings share the same root cause, especially the visible gated behaviors.
Address the critical and major issues before implementation begins.
