# Sprint Change Proposal: Close Agent Node Room Mockup Gaps

**Date:** 2026-09-22

**Mode:** Incremental

**Change classification:** Moderate Direct Adjustment

**Review status:** Approved by the product owner on 2026-09-22

**Handoff status:** Routed to Product Manager, Solution Architect, Product Owner, and Quality Engineering

**Trigger:** The 2026-09-22 implementation-readiness review returned `NOT READY` with 5 matched, 4 partial, 3 missing, and 1 conflict across 13 current mockup features.

## 1. Issue Summary

The planning artifacts do not state eight approved mockup behaviors exactly enough for implementation.

The affected features are M001, M002, M005, M007, M008, M009, M010, and M013.

The approved mockup manifest is immutable evidence for this correction.

Its source fingerprint is `0dd094cda1c3ef6ad52bc6b53531f2cfb5512b4804813bf1a85e516e73623101`.

The manifest classifies all 13 visible change features as `CURRENT` and `PROVEN`.

It has no open product question and no unresolved action-identity group.

The old Epics and Stories are complete historical records.

This proposal does not reopen, rewrite, renumber, or extend them as implementation work.

One new Epic and four new current Stories own the missing work.

No product code changes are part of this proposal.

## 2. Evidence and Change Boundary

The evidence set is:

- `_bmad-output/planning-artifacts/implementation-readiness-report-2026-09-22.md`.
- `_bmad-output/planning-artifacts/mockup-manifests/agent-node-room.json`.
- The approved mockup rendering and interaction code under `claude-design/design_handoff_node_room_transcript_steering/`.
- The current Node Room, steering dock, steering registry, and tool-presentation implementation and tests.
- The completed Epics and Stories in `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md`.

The approved mockups change these product areas:

- fixed Console and Legacy Node Room widths;
- todo placement and rendering;
- loop execution selection limits;
- steering durability and recovery;
- verified active-turn injection;
- delivery acknowledgement;
- Codex status presentation.

The todo behaviors, durable queue baseline, restart recovery, delivery acknowledgement, and all recorded unchanged-context rows remain unchanged where the readiness matrix reports `MATCHED`.

The two visible `Send now` actions remain separate.

Per-item `Send now` acts on one selected queued item during an active verified provider turn.

Main composer `Send now` acts after interruption and starts the next turn with the typed message and eligible durable queue entries in server FIFO order.

## 3. Impact Analysis

### 3.1 Epic impact

All existing Epics and Stories remain complete historical records.

They can be cited as evidence, but they do not receive new implementation acceptance criteria.

Epic 10 owns all eight unresolved mockup features.

No existing Epic becomes active again.

### 3.2 PRD impact

The canonical PRD needs exact text for M005, M007, M008, M009, M010, and M013.

M001 and M002 already have exact PRD evidence through the adopted final design document.

The PRD must preserve all visible mockup features as current scope.

### 3.3 Architecture impact

The live-steering spine needs exact decisions for M001, M002, M005, M007, M008, M009, M010, and M013.

The readable-transcript spine needs the selector bound, Codex status normalization rule, and corrected capability references.

No new provider-branded renderer is required.

The Codex exception belongs at provider normalization, before the provider-neutral presenter.

### 3.4 UX impact

The approved mockup manifest remains unchanged.

This proposal does not edit the approved mockups.

The UX narrative must remove its universal interrupted-tool claim because it contradicts both the manifest and its own Codex evidence.

The PRD, Architecture, UX narrative, and new Stories must conform to the manifest.

### 3.5 Technical impact

Implementation will affect both Node Room shells, the durable steering store, the executor timer and terminal reconciliation path, provider capability projection, and provider-status normalization.

The new Stories require focused renderer, store, executor, provider, API, accessibility, and restart evidence.

The proposal does not authorize product-code implementation.

## 4. Recommended Approach

Use a Direct Adjustment.

Keep the approved product scope unchanged.

Correct the PRD and Architecture.

Append Epic 10 and Stories 10.1 through 10.4.

Do not roll back completed work.

Do not reduce, defer, gate, or mark any visible approved feature as optional.

Do not modify old Epic or Story text to make it look current.

This approach has lower planning risk than reopening completed Epics because it preserves historical evidence and gives every missing behavior one current owner.

## 5. Exact PRD Corrections

Target: `_bmad-output/specs/spec-agent-node-room/SPEC.md`.

### 5.1 CAP-6: exact execution selector contract

**Replace the CAP-6 success paragraph with:**

> - **success:** A node whose rows span more than one `occurrence_id` renders a header per group; a single-occurrence node renders none.
> Grouping keys on `occurrence_id`, never on `attempt_id`.
> When a loop node has more than one execution, the `Execution` selector is present, selects the live execution by default, and exposes no more than eight executions.
> Selecting an execution immediately projects that execution in the room.
> A stale selection is read-only and cannot steer the live execution.
> On a live loop node, selecting a finished iteration through the `Execution` selection controls renders the approved read-only dock and shared pending queue.
> The composer is absent, and the client issues no send, withdraw, or interrupt mutation for the finished iteration.
> The authenticated node-scoped queue read remains allowed.

**Rationale:** This closes M005 without changing the existing occurrence-grouping or stale-view rules.

### 5.2 CAP-8: exact terminal reconciliation contract

**Append these sentences to the CAP-8 success paragraph:**

> When the node reaches terminal completion or failure, terminal reconciliation examines every durable queued or sent message.
> Every message without matching provider acknowledgement becomes a read-only `Never sent` record.
> The terminal room keeps all such content readable and exposes no edit or send control.
> A terminal node with no durable content renders no dock.

**Rationale:** This makes M009 exact in the canonical PRD.

### 5.3 CAP-9: exact timeout and Codex presentation contract

**Replace the final two sentences of the CAP-9 success paragraph with:**

> Stop applies to the whole turn, not one selected tool.
> Nothing suggests that Stop undid completed side effects.
> The executor records the turn end as operator-interrupted.
> A provider tool row uses the interrupted presentation only when its normalized provider status can produce that outcome.
> A Codex tool row never uses the interrupted warning glyph and uses only a Codex-supported status presentation.
> This presentation exception does not change the turn-level Stop result, the active node state, or session reuse.
> While the live server process owns an idle-after-interrupt handle, 30 minutes of inactivity fails that node execution.
> Composer activity re-arms the timer.
> On expiry, durable queued content remains stored and becomes read-only `Never sent` content in the failed terminal room.
> A server restart does not apply or recreate the lost timer and instead uses the existing recovery-required behavior.

**Rationale:** This resolves M010 and the M013 conflict without changing Stop, recovery, or completed side effects.

### 5.4 CAP-12: exact per-item `Send now` contract

**Replace the CAP-12 success paragraph with:**

> - **success:** `Queue` delivers at the next natural turn boundary on every provider.
> Where a verified provider transport accepts a message during generation, each queued item exposes per-item `Send now`.
> Selecting that action atomically targets exactly the selected queued message and the current active provider turn.
> The selected message receives its stamped message identity, leaves the queued collection, and enters the active turn immediately.
> Stop is not invoked, generation continues, the active tool outcome does not change, and no steering-owned turn-start event is emitted.
> The selected message becomes `sent` pending verified provider acknowledgement.
> Every non-selected queued message keeps its identity, content, relative order, and `queued` state unchanged.
> A queue-only provider omits per-item `Send now`.
> Verification of each soft-injection transport is current implementation work.

**Rationale:** This records the established product decision and closes the complete M008 collection-mutation gap.

### 5.5 CAP-15: exact projected auto-send indicator

**Append these sentences to the CAP-15 success paragraph:**

> When the queue panel is visible and the effective projected state is enabled, it shows one read-only `Auto-send on` status indicator.
> The indicator tracks projected state and performs no dispatch.
> The approved mockup exposes no auto-send control through this indicator.

**Rationale:** This closes M007 without inventing a control that the approved mockup does not show.

### 5.6 PRD companion alignment

Targets:

- `_bmad-output/specs/spec-agent-node-room/provider-steering-matrix.md`;
- `_bmad-output/specs/spec-agent-node-room/tool-presentation-contract.md`;
- `_bmad-output/specs/spec-agent-node-room/steering-api-contract.md`;
- `_bmad-output/specs/spec-agent-node-room/steering-test-plan.md`.

Apply these exact contract rules:

> A successful Stop is an operator-interrupted turn.
> An active tool uses the interrupted presentation only when its normalized provider status proves that outcome.
> A Codex tool row never uses the interrupted warning glyph and uses only a Codex-supported status presentation.
> The shared presenter remains provider-neutral and contains no Codex branch.

> Per-item `send_now` atomically claims exactly `queued_message_id` for the current active provider turn.
> The selected item leaves the queued collection and becomes `sent` pending verified acknowledgement without invoking Stop.
> Every non-selected queued item keeps its identity, content, relative order, and `queued` state unchanged.

The steering tests must prove both rules at the provider, store, and presentation boundaries.

## 6. Exact Architecture and UX Consistency Corrections

### 6.1 Readable-transcript Architecture

Target: `_bmad-output/planning-artifacts/architecture/architecture-Archon-readable-agent-transcript-2026-09-12/ARCHITECTURE-SPINE.md`.

#### A. Correct capability ownership

**Replace the frontmatter binding `spec-agent-node-room CAP-14..CAP-21` with:**

> `spec-agent-node-room CAP-1 through CAP-7, CAP-9 presentation, and CAP-16 through CAP-21`

**Apply the same capability set to the AD-1 `Binds` clause.**

**Replace the AD-17 binding with:**

> - **Binds:** Agent Node Room CAP-5, CAP-19, CAP-20, and CAP-21.

**Replace the stale capability-map rows with:**

> | CAP-5 inline diff and Codex file-change ingestion | provider normalization + node-message persistence + `lib/diff-hunks.ts` | AD-4, AD-5, AD-6, AD-17 |
> | CAP-9 provider-supported status presentation | provider status normalization + shared outcome projection | AD-13 |
> | CAP-16 surface parity | Web semantic core + backend semantic fixtures | AD-1, AD-18 |

Remove the stale `CAP-14 Codex ingestion` and `CAP-15 auto-send display` rows.

**Rationale:** CAP-14 is restart recovery, CAP-15 is durable auto-send, CAP-5 owns Codex file-change ingestion, and CAP-16 owns cross-surface presentation.

#### B. Amend AD-12 for the exact selector contract

**Replace item 7 in AD-12 with:**

> 7. When a loop node has more than one execution, the `Execution` selector selects the live execution by default and exposes no more than eight executions.
> Selection immediately projects the chosen execution.
> A stale execution is read-only and cannot steer the live execution.
> The selector is absent when only one execution exists.
> It uses the existing execution-selection identity and does not add a second occurrence-navigation mechanism.

**Rationale:** This closes the readable Architecture part of M005.

#### C. Amend AD-13 for the Codex exception

**Append this paragraph to AD-13:**

> Provider boundaries normalize only tool outcomes that their exercised provider status can prove.
> Codex does not produce an `interrupted` tool status, so a Codex tool row never reaches the shared presenter with the interrupted outcome and never renders `⚠`.
> It uses only a Codex-supported status presentation.
> The presenter remains provider-neutral and contains no Codex branch.
> This exception changes no other provider's glyph mapping and does not change the executor's turn-level interrupted classification.

**Rationale:** This resolves M013 at the correct boundary and preserves the shared presenter.

### 6.2 Live-steering Architecture

Target: `_bmad-output/planning-artifacts/architecture/architecture-Archon-live-agent-steering-2026-09-12/ARCHITECTURE-SPINE.md`.

#### A. Amend AD-1 for provider-supported tool status

**Replace `The active tool becomes interrupted rather than failed.` with:**

> The executor classifies the accepted Stop as an interrupted turn rather than a provider failure.
> An active tool uses the interrupted presentation only when the normalized provider status supports it.
> A Codex tool row never uses the interrupted warning glyph and uses only a Codex-supported status presentation.

**Rationale:** This removes the M013 cross-document conflict while preserving turn-level Stop semantics.

#### B. Amend AD-4 for one-item active-turn injection

**Append this paragraph to AD-4:**

> Per-item `Send now` is a distinct atomic claim by `queued_message_id`.
> It stamps and claims exactly the selected queued message, removes that item from the queued collection, and injects it into the current active provider turn.
> It does not invoke Stop, end the turn, change the active tool outcome, or emit a steering-owned turn-start event.
> The selected item becomes `sent` pending acknowledgement.
> Every non-selected queued message keeps its identity, content, relative order, and `queued` state unchanged.

**Rationale:** This closes the Architecture part of M008.

#### C. Amend AD-5 for terminal reconciliation

**Append this paragraph to AD-5:**

> Terminal completion or failure runs durable reconciliation.
> Every durable queued or sent message without matching provider acknowledgement becomes a read-only `Never sent` record.
> The terminal room preserves all unmatched content and exposes no edit or send mutation.
> With no durable content, the terminal room renders no dock.

**Rationale:** This closes the Architecture part of M009.

#### D. Amend AD-6 for the 30-minute result

**Append this paragraph to AD-6:**

> While the live process owns an idle-after-interrupt handle, a re-armable 30-minute inactivity timer applies.
> Composer activity re-arms the timer.
> Expiry fails that node execution and preserves all durable queued content as read-only `Never sent` records.
> The failed terminal room states that the interruption received no redirect and that none of the preserved content was sent.
> A server restart removes the live timer and uses recovery-required state instead of inferring expiry.

**Rationale:** This closes the Architecture part of M010 and preserves process-boundary safety.

#### E. Amend AD-9 for the projected indicator

**Append this paragraph to AD-9:**

> When the queue panel is visible and the effective projected auto-send state is on, both Node Room shells show one read-only `Auto-send on` indicator.
> The indicator reflects projected state and performs no dispatch or setting mutation.

**Rationale:** This closes the Architecture part of M007.

#### F. Amend AD-12 for exact presentation geometry and selection

**Append this paragraph to AD-12:**

> Console uses a fixed 520-pixel Node Room width and Legacy uses a fixed 460-pixel Node Room width until the room closes.
> In both shells, the transcript scroller remains above the sibling todo strip, queue band, and composer dock, so the dock never overlays the last transcript row.
> When a loop node has more than one execution, the `Execution` selector starts on the live execution and exposes no more than eight executions.
> Selecting a stale execution projects it read-only and issues no steering mutation against the live execution.

**Rationale:** This closes M001, M002, and the live Architecture part of M005.

### 6.3 UX status consistency

Target: `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/EXPERIENCE.md`.

Replace the universal interrupted-tool claim with:

> Stop records the turn-level result as operator-interrupted on every supported provider.
> A tool row renders `⚠ interrupted` only when its normalized provider status proves that outcome.
> Codex cannot produce that status, so a Codex tool row never renders `⚠` and uses only a Codex-supported status presentation.

Apply the same rule to the `Agent interrupted — the run keeps going` state row.

The node and workflow run remain active, the provider session remains reusable where supported, and completed side effects remain in place.

**Rationale:** This removes the internal UX contradiction identified by the readiness report without changing the approved mockups.

## 7. Exact Epic and Story Addition

Target: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md`.

Append the following section after Epic 9.

Do not edit any existing Epic or Story text.

### Approved Course Correction — 2026-09-22

> Epic 1 through Epic 9 and all their Stories are complete historical planning records.
> They remain unchanged and can be cited only for evidence and dependency context.
> Epic 10 owns the current implementation work required to close approved mockup gaps M001, M002, M005, M007, M008, M009, M010, and M013.
> Every visible approved mockup feature remains current scope.
> Successful Codex file-change persistence maps to CAP-5 and CAP-16, not CAP-14.
> This traceability correction does not reopen or rewrite completed Story 4.1.

## Epic 10: Complete the Approved Mockup Contract

Operators receive every approved Node Room behavior that is not already covered by the completed Epics, with exact layout, queue, terminal, and provider-status behavior.

### Story 10.1: Fix room geometry and execution selection

As an operator,
I want the approved Node Room dimensions and bounded execution selector,
So that the live execution is clear and stale history cannot affect live work.

**Acceptance Criteria:**

**Given** the Console Node Room is open
**When** the room renders
**Then** its width is fixed at 520 pixels until close
**And** the transcript scrolls above the sibling todo strip, queue band, and composer dock.

**Given** the Legacy Node Room is open
**When** the room renders
**Then** its width is fixed at 460 pixels until close
**And** it uses the same approved vertical order without overlaying the last transcript row.

**Given** a loop node has more than one execution
**When** the `Execution` selector first renders
**Then** the live execution is selected
**And** the selector exposes no more than eight executions.

**Given** the operator selects one exposed execution
**When** the selection changes
**Then** the room immediately projects that execution
**And** a stale execution is read-only and cannot send, withdraw, interrupt, or otherwise steer the live execution.

**Given** a node has only one execution
**When** the room renders
**Then** the execution selector is absent.

_Refs:_ Agent Node Room CAP-6, readable-transcript AD-12, live-steering AD-12, manifest M001, M002, and M005.
_Depends on:_ Completed Epic 3 for historical shell and transcript behavior.

### Story 10.2: Deliver one selected queued message without Stop

As an operator,
I want truthful auto-send state and exact per-item active-turn delivery,
So that I know what will send and no other queued guidance changes by accident.

**Acceptance Criteria:**

**Given** the queue panel is visible and projected auto-send state is on
**When** either Node Room shell renders the panel
**Then** it shows one read-only `Auto-send on` indicator
**And** the indicator performs no dispatch or setting mutation.

**Given** the agent is generating and the active provider has verified soft injection
**When** the queue renders
**Then** each eligible queued item exposes per-item `Send now`.

**Given** the operator selects per-item `Send now` on one queued message
**When** the server accepts the action
**Then** exactly that selected message receives its stamped message identity and leaves the queued collection
**And** it enters the current active provider turn immediately.

**Given** the selected message enters the active turn
**When** delivery begins
**Then** Stop is not invoked
**And** generation continues
**And** the active tool outcome does not change
**And** no steering-owned turn-start event is emitted
**And** the selected item is `sent` pending verified acknowledgement.

**Given** other queued messages exist
**When** one selected item is sent now
**Then** every non-selected message keeps its identity, content, relative order, and `queued` state unchanged.

**Given** the provider supports queue-at-boundary only
**When** the queue renders
**Then** per-item `Send now` is absent.

_Refs:_ Agent Node Room CAP-12 and CAP-15, live-steering AD-4, AD-8, AD-9, and AD-12, manifest M007 and M008.
_Depends on:_ Completed Epic 7 and Epic 8 for durable queue, provider capability, and delivery evidence.

### Story 10.3: Preserve every unmatched message at terminal boundaries

As an operator,
I want unsent guidance preserved and labeled when a node ends,
So that terminal or timeout transitions never hide or discard my instructions.

**Acceptance Criteria:**

**Given** a node reaches terminal completion or failure with durable queued or sent messages
**When** terminal reconciliation runs
**Then** every message without matching provider acknowledgement becomes a read-only `Never sent` record
**And** all unmatched content remains readable.

**Given** the terminal room contains `Never sent` records
**When** it renders
**Then** it exposes no edit, send, withdraw, or interrupt control.

**Given** a terminal node has no durable draft, queue, or unmatched sent content
**When** it renders
**Then** it renders no steering dock.

**Given** a live process owns an idle-after-interrupt handle with durable queued content
**When** 30 minutes pass without activity
**Then** the node execution fails
**And** the durable queued content remains stored as read-only `Never sent` records.

**Given** the operator types before timer expiry
**When** composer activity is accepted
**Then** the 30-minute timer is re-armed.

**Given** the failed terminal room renders after timer expiry
**When** the operator reads its status
**Then** it explains that the interruption received no redirect
**And** it states that none of the preserved content was sent.

**Given** the server restarts while the prior node was idle after interruption
**When** durable recovery loads
**Then** no new process applies the lost timer
**And** the existing recovery-required and Resume behavior remains unchanged.

_Refs:_ Agent Node Room CAP-8 and CAP-9, live-steering AD-5 and AD-6, manifest M009 and M010.
_Depends on:_ Completed Epic 7 for durable steering and restart recovery.

### Story 10.4: Use a Codex-supported tool status presentation

As a Codex operator,
I want Stop and transcript status to match what Codex can prove,
So that the room does not show an unsupported interrupted warning glyph.

**Acceptance Criteria:**

**Given** a Codex turn is stopped through the supported turn-abort path
**When** the executor classifies the turn
**Then** it records an operator-interrupted turn rather than a provider failure
**And** the node, workflow run, reusable session, and completed side effects remain unchanged.

**Given** a Codex tool row is presented
**When** the provider status is normalized and the glyph is resolved
**Then** the row never uses the interrupted warning glyph
**And** it uses only a status presentation supported by Codex evidence.

**Given** another provider proves an interrupted tool outcome
**When** the same presenter renders that row
**Then** the existing provider-neutral interrupted glyph remains available
**And** no provider-specific branch exists in the presenter.

**Given** provider and renderer tests run
**When** Codex Stop evidence reaches the transcript
**Then** they prove turn-level interruption and session continuation separately from tool-row glyph presentation.

_Refs:_ Agent Node Room CAP-9 and CAP-18, readable-transcript AD-13, live-steering AD-1, manifest M013.
_Depends on:_ Completed Story 8.4 for Codex Stop and session continuation evidence.

## 8. Sprint Status Addition After Approval

Target: `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml`.

Append these entries without changing any existing status:

```yaml
  # 2026-09-22 approved readiness correction.
  # Epic 1 through Epic 9 remain complete historical planning records.
  epic-10: backlog
  10-1-fix-room-geometry-and-execution-selection: backlog
  10-2-deliver-one-selected-queued-message-without-stop: backlog
  10-3-preserve-every-unmatched-message-at-terminal-boundaries: backlog
  10-4-use-a-codex-supported-tool-status-presentation: backlog
```

Do not change old Epic or Story status values as part of this correction.

## 9. Verification and Acceptance

After the proposal is approved and applied, verification must:

1. Confirm that the mockup manifest file hash is unchanged.
2. Confirm that no existing Epic or Story text changed.
3. Confirm that the PRD contains exact current-scope contracts for M005, M007, M008, M009, M010, and M013.
4. Confirm that both Architecture spines contain the exact width, selector, queue mutation, terminal reconciliation, timeout, and Codex rules.
5. Confirm that the readable Architecture no longer maps Codex ingestion to CAP-14 or auto-send display to CAP-15.
6. Confirm that Epic 10 owns M001, M002, M005, M007, M008, M009, M010, and M013.
7. Confirm that every non-selected queued message is explicitly preserved by identity, content, relative order, and `queued` state.
8. Rerun the implementation-readiness workflow against the unchanged manifest.
9. Require a `READY` verdict before product-code implementation starts.

## 10. Checklist Status

| Checklist item | Status | Result |
| --- | --- | --- |
| 1.1 Triggering evidence | Done | The 2026-09-22 readiness report triggered the correction. |
| 1.2 Core problem | Done | Eight current mockup features lack exact cross-artifact coverage. |
| 1.3 Supporting evidence | Done | The immutable manifest proves all behavior fields and has no open question. |
| 2.1 Existing Epic viability | Done | Existing Epics remain complete historical records. |
| 2.2 Required Epic changes | Done | Append Epic 10 and four current Stories. |
| 2.3 Remaining Epic review | Done | No existing Epic is reopened or changed. |
| 2.4 New Epic need | Done | Epic 10 is required for missing current work. |
| 2.5 Order and priority | Done | Stories follow presentation, delivery, terminal safety, and provider status boundaries. |
| 3.1 PRD conflict review | Done | Six PRD gaps and their companion contracts have exact replacement or insertion text. |
| 3.2 Architecture conflict review | Done | Both Architecture spines have exact corrections. |
| 3.3 UX conflict review | Done | The universal interrupted-tool claim is removed, and the immutable approved manifest remains the UX authority. |
| 3.4 Other artifacts | Done | The approved Epic 10 sprint-status entries are appended. |
| 4.1 Direct Adjustment | Viable | It preserves scope and history while adding current ownership. |
| 4.2 Potential rollback | Not viable | Rollback would reopen completed work and does not close document gaps. |
| 4.3 MVP review | Not viable | All visible approved features are current scope and cannot be deferred. |
| 4.4 Recommended path | Done | Direct Adjustment through PRD, Architecture, Epic 10, and sprint status. |
| 5.1 through 5.5 Proposal components | Done | This document contains the summary, impact, exact edits, and handoff. |
| 6.1 Checklist review | Done | All applicable items are addressed. |
| 6.2 Proposal accuracy | Done | Exact text is tied to readiness and manifest evidence. |
| 6.3 User approval | Done | The product owner approved the proposal on 2026-09-22. |
| 6.4 Sprint status | Done | The Epic 10 backlog entries are appended without changing prior entries. |
| 6.5 Handoff | Done | The corrected planning set is ready for a new readiness assessment. |

## 11. Implementation Handoff

This is a Moderate change because it adds one Epic and reorganizes current backlog ownership without changing the approved product scope.

Approval applied:

- The Product Manager applies the PRD and Epic 10 text exactly.
- The Solution Architect applies both Architecture corrections exactly.
- The Product Owner appends the sprint-status entries without changing historical status.
- Quality Engineering reruns implementation readiness against the unchanged manifest.
- Development starts only after the readiness verdict is `READY`.

## 12. Success Criteria

The correction succeeds when:

- all 13 manifest features are exact across the PRD, Architecture, and current Stories;
- no visible approved feature is future, deferred, optional, gated, or out of scope;
- every old Epic and Story remains unchanged;
- Epic 10 owns all missing current work;
- per-item `Send now` changes exactly one selected queued message and preserves every other queued message unchanged;
- the Codex row never uses the unsupported interrupted warning glyph;
- the unchanged manifest passes the readiness workflow with a `READY` verdict.

## 13. Approval Record

The product owner approved the proposal on 2026-09-22.

The exact PRD, Architecture, UX consistency, Epic 10, and sprint-status corrections were applied after approval.

No product-code file or approved mockup-manifest file changed in this workflow run.

## 14. Unresolved Questions

None.
