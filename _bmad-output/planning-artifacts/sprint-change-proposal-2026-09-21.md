# Sprint Change Proposal: Agent Node Room Readiness Correction

**Date:** 2026-09-21

**Change classification:** Major Course Correction

**Review status:** Approved by the product owner

**Handoff status:** Routed to Product Manager and Solution Architect for fundamental replanning

**Trigger:** The 2026-09-21 implementation-readiness review found that the approved Agent Node Room experience and the planning artifacts described different scopes.

## 1. Change Summary

The current planning set describes an in-process steering floor with browser-local drafts, a process-local queue, deferred delivery features, and a detached-run state.

The approved product scope requires the complete approved mockup behavior, durable server-side drafts and guidance, restart recovery, all selected presentation surfaces, Git attribution, additional transcript sources, and steering coverage across every registered provider listed in this proposal.

The product owner also corrected three readiness assumptions.

- Detached-run steering is not an Agent Node Room feature.
- Whole-run or whole-node Cancel is completed historical behavior and is not part of this correction.
- Individual-tool cancellation is not required because Stop ends the entire current agent turn.

The correction preserves all existing epics and stories as completed historical work.

No existing epic or story will be modified, reopened, renumbered, moved, extended, or given new acceptance criteria.

Every current implementation outcome will be owned by a new story in Epic 3 through Epic 9.

## 2. Confirmed Product Decisions

### 2.1 Stop semantics

Stop ends the agent's current turn, regardless of whether the agent is thinking or executing a tool.

Stop does not stop the node or workflow run.

Stop does not invoke or modify the historical Cancel feature.

The provider session remains available for the next turn.

The active tool becomes `interrupted`, not `failed`.

Completed writes and other completed side effects remain in place.

Stop never rolls work back.

The common provider contract is the existing `AgentRequestOptions.interruptSignal`.

The correction will not add a `cancel()` method to `IAgentProvider`.

The existing `abortSignal` remains the node-level cancellation signal.

Each provider adapter must map `interruptSignal` to its supported native interrupt or stream-abort mechanism.

### 2.2 Durable guidance

Composer drafts must be stored on the server for their author.

Queued guidance must be stored on the server for the node.

Drafts, queue order, delivery state, and auto-send settings must survive a server restart.

A server restart cannot preserve an in-memory SDK process or stream.

Archon must not guess that the prior turn completed or failed.

Archon must restore the durable steering data and wait for the user to invoke the existing Resume feature.

The correction will not add a new Resume mechanism and will not automatically resume a workflow after server startup.

### 2.3 Detached execution

The CLI `archon workflow run --detach` capability remains unchanged.

The Agent Node Room correction will not add detached-run steering behavior.

The detached State 8 design and the frontend inference that `422 not_steerable_here` means detached execution will be removed from the current Agent Node Room artifacts.

No new epic or story will implement, remove, or otherwise change CLI detach behavior.

### 2.4 Historical Cancel behavior

The existing Cancel feature remains unchanged.

Cancel will not receive a new epic, story, acceptance criterion, UX flow, or architecture change in this correction.

Existing Cancel tests remain historical regression coverage and are not acceptance evidence for the new scope.

### 2.5 Current-scope rule

All approved mockup behavior is current scope unless an explicit decision in this proposal replaces it.

No current feature may be described as future, deferred, optional, gated, post-v1, or out of scope.

Provider verification and required SDK upgrades are implementation work inside the owning current story.

They are not release gates that move the feature outside the current scope.

## 3. Readiness Findings and Corrections

The readiness report is an evidence snapshot that triggered this proposal.

It is not the current scope authority after the decisions recorded here.

The following readiness requirements remain current.

- FR14: Persist and present successful Codex `file_change` events.
- FR15: Provide per-item `Send now` for transports that support soft injection.
- FR17: Restore durable steering and recovery state after server restart.
- FR18: Store and recover drafts and queued guidance durably.
- FR19: Provide a durable auto-send queue mode.
- FR20: Apply readable tool presentation to RunStream.
- FR21: Apply readable tool presentation to Chat.
- FR22: Align backend tool formatting with the readable presentation contract.
- FR23: Provide a run-level Files Changed panel.
- FR24: Provide node-level Git attribution beyond per-tool-call diffs.
- FR25: Support Qoder CLI steering.
- FR26: Support Pi steering.
- FR27: Support GitHub Copilot steering.
- FR28: Support OpenCode steering.
- FR29: Present agent thinking under a defined privacy and persistence contract.
- FR30: Present the triggering prompt under a defined privacy and attribution contract.
- FR31: Present advisor notifications under a defined ordering and persistence contract.

The following readiness requirements are removed by explicit product-owner decision.

- FR16 is removed because detached-run steering is not part of Agent Node Room.
- FR32 is removed because Cancel is completed historical behavior and is not part of this feature.
- FR33 is removed because Stop operates at turn level and there is no individual-tool cancellation feature.

## 4. Impact Analysis

### 4.1 Epic impact

Epic 1 and Epic 2 remain unchanged historical records.

Their stories may be cited only for dependency and traceability.

The current work requires seven new epics and new story identifiers.

The existing G1 through G4 entries remain historical provenance.

Their former implementation outcomes are owned by new current stories in Epic 8.

### 4.2 Product and UX impact

The Console and Legacy Node Rooms remain separate markup shells with equivalent behavior.

The approved Console width is 520 pixels.

The approved Legacy width is 460 pixels.

The todo strip appears below the transcript scroller and above the queue and composer dock.

The latest applicable todo call can expose the approved inline checklist.

Earlier todo mutations remain compact `todo updated` rows.

Terminal todo treatment is a presentation projection and does not mutate persisted todo events.

The detached State 8 mockup is removed.

Draft copy changes from `this tab only` to server-persistence language.

Queued guidance copy states that the queue belongs to the node and is saved on the server.

After restart, the dock restores durable content and instructs the user to use the existing Resume action.

Stop copy states that it ends the current turn and that files already written remain written.

Cancel is not introduced into the current dock requirements.

### 4.3 Architecture impact

The runtime must separate a durable control plane from the volatile live execution handle.

The live provider process, stream, and active-turn handle remain in memory.

Durable draft, queue, ordering, delivery, and auto-send data are owned by a narrow steering-store contract.

SQLite and PostgreSQL changes must remain additive and must preserve schema parity.

The server acknowledges Queue only after the durable write commits.

The executor claims durable queue entries in server-assigned FIFO order.

A restart restores data but does not pretend that the old provider process survived.

An ambiguous dispatch must not be sent again automatically because the previous process may have completed an external side effect.

The existing Resume workflow owns continuation after restart.

The provider-neutral Stop implementation uses `interruptSignal` and a fresh per-turn controller.

The node-level abort controller remains untouched by Stop.

Provider capability declarations must report only behavior proven by their adapter tests.

### 4.4 Data impact

The implementation requires additive durable records for per-operator draft and steering settings.

The implementation also requires additive durable records for the node-scoped guidance queue and delivery lifecycle.

The durable queue must retain a caller-stamped message identifier, node identity, author identity, content, server FIFO position, delivery intent, delivery state, timestamps, and the minimum failure evidence needed for recovery.

Delivered operator transcript rows continue to use the existing node-message store and retain `message_id` for correlation.

The steering store is the delivery control plane.

The transcript row is the durable audit receipt after delivery.

### 4.5 API impact

Draft save, read, and clear behavior must use typed authenticated routes.

Queue, withdraw, per-item Send now, auto-send setting, Stop, and queue-read behavior must use typed routes and deterministic identifiers.

The route contract must not classify a missing live handle as proof that the run was started with CLI detach.

The route must distinguish terminal nodes, recovery-required nodes, malformed input, missing resources, and unauthorized requests without guessing process origin.

### 4.6 Provider impact

Claude, Codex, Grok, DeepSeek, OMP, Qoder CLI, Pi, GitHub Copilot, and OpenCode require explicit Stop conformance.

Claude, Grok, and OMP also require current soft-injection work where their transports support it.

Claude requires current delivery-acknowledgement work through the necessary SDK update and message-id echo.

Codex uses turn stream abort and continuation on the existing thread or session.

No provider is assumed to support a universal CLI `Ctrl+C` contract.

Each adapter owns the safe mapping from `interruptSignal` to its native mechanism.

### 4.7 Presentation-surface impact

Readable tool presentation must cover both Node Rooms, RunStream, Chat, and backend tool formatting.

Successful Codex file changes must enter the same persisted transcript path before presentation.

The product must add a run-level Files Changed panel and node-level Git attribution.

Git attribution must use deterministic repository evidence and `@archon/git` functions.

It must never infer file ownership from agent prose.

Agent thinking, triggering prompts, and advisor notifications require explicit persistence, privacy, ordering, provider-normalization, and presentation contracts.

## 5. Recommended Approach

Proceed with the Major Course Correction and implement the new epics in numerical order where dependencies require it.

Preserve every existing epic and story exactly as historical work.

Append new requirements, epics, stories, and sprint-status entries without changing historical story status.

Use one durable steering store rather than multiple process-local sources of truth.

Reuse the existing provider request signals and existing Resume capability.

Do not add a provider `cancel()` method, a new Resume mechanism, a detached steering channel, or individual-tool cancellation.

Use capability-driven UI behavior instead of provider-branded UI forks.

### 5.1 Effort and schedule impact

The approved correction contains seven new epics and twenty-nine new stories.

This is a multi-epic replan rather than a direct adjustment to the completed historical plan.

The Product Manager must rebuild delivery sequencing and story sizing before committing to a calendar estimate.

The Solution Architect must settle the additive storage, recovery, provider, and cross-surface contracts before implementation stories that depend on those contracts enter development.

The recommended delivery order is Epic 3, Epic 4, Epics 5 and 6, Epic 7, Epic 8, and Epic 9, subject to the backward-only dependencies in this proposal.

The scope must not be reduced by moving approved features to a later or optional phase.

## 6. Detailed Artifact Changes

### 6.1 Product specification

**Old:** The specification limits the read path to existing persisted rows and limits steering to browser-local or process-local state.

**New:** The specification covers durable steering, every approved presentation surface, all approved transcript sources, and every provider listed in this proposal.

**Rationale:** The old scope conflicts with the approved product behavior and the durability decision.

Update `_bmad-output/specs/spec-agent-node-room/SPEC.md`.

Replace the no-schema and no-backend scope boundary with the approved durable and cross-surface scope.

Include successful Codex file-change persistence in the file presentation capability.

Replace browser-local draft and process-local queue semantics with durable server-side behavior.

Define Stop through `interruptSignal` as a turn-level action that preserves node, run, session, and completed work.

Make soft injection, per-item Send now, delivery acknowledgement, and all provider work current scope.

Add capabilities for auto-send, RunStream, Chat, backend formatting, Files Changed, Git attribution, additional providers, thinking, triggering prompt, and advisor notifications.

Reduce Non-goals to the three explicit exclusions: changing Cancel, adding individual-tool cancellation, and changing CLI detach behavior.

Remove current features from deferred, gated, optional, and post-v1 sections.

### 6.2 Architecture artifacts

**Old:** The in-process registry is the sole steering authority, and provider delivery work is deferred behind external gates.

**New:** A durable steering control plane works with a volatile live-turn handle, and provider verification is current implementation work.

**Rationale:** Durable recovery and truthful provider behavior require explicit storage, recovery, and adapter contracts.

Update the live-steering and readable-transcript architecture spines and their companion contracts.

Replace the in-process registry as the sole queue authority with a durable steering store plus a volatile live handle.

Keep the provider session handle in memory and keep durable guidance in the database.

Specify restart restoration followed by the existing user-driven Resume action.

Specify provider Stop through `interruptSignal` without adding `IAgentProvider.cancel()`.

Specify durable FIFO, idempotent withdrawal, delivery correlation, ambiguous-dispatch handling, and auto-send behavior.

Remove detached-specific steering architecture and frontend error inference.

Remove post-v1 and spike-gated treatment from current provider work.

Extend the readable-presentation architecture to Codex ingestion, RunStream, Chat, backend formatting, Git views, thinking, prompting, and advisor notifications.

### 6.3 UX and mockups

**Old:** The selected UX includes detached State 8, tab-local drafts, process-local queues, and supersession notes that reject visible mockup behavior.

**New:** The selected UX removes State 8, restores durable content after restart, uses the existing Resume action, and treats every approved mockup behavior as current scope except the explicit exclusions.

**Rationale:** The UX must describe the product that will be implemented rather than the superseded in-process floor.

Update the Agent Node Room EXPERIENCE and DESIGN artifacts and all selected handoff mockups.

Delete detached State 8 and its copy.

Replace tab-local and process-local wording with durable server-side wording.

Add the restart-restored read-only state that points to the existing Resume action.

Keep Stop as a turn-level control and remove Cancel from the current dock requirements.

Add per-item Send now, durable auto-send, delivery states, and recovery states.

Adopt the approved todo placement, inline checklist, and terminal projection behavior.

Preserve all other approved visual, keyboard, focus, responsive, and accessibility behavior.

Add current-state designs for RunStream, Chat, Files Changed, Git attribution, thinking, triggering prompts, advisor notifications, and restart recovery.

### 6.4 Epic additions

**Old:** Epic 1, Epic 2, and G1 through G4 describe the historical delivery plan.

**New:** Epic 3 through Epic 9 own every current implementation outcome with new story identifiers.

**Rationale:** Historical epics and stories are immutable and cannot be reopened or extended.

Append the following epics and stories to `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md`.

Do not edit Epic 1, Epic 2, or any Story 1.x or 2.x content.

#### Epic 3: Complete the Approved Node Room Experience

- Story 3.1: Match the approved Console and Legacy room anatomy.
- Story 3.2: Present todo state exactly as approved.
- Story 3.3: Complete transcript interaction and accessibility behavior.

#### Epic 4: Apply Readable Tool Presentation Everywhere

- Story 4.1: Persist successful Codex file-change rows.
- Story 4.2: Use readable tool presentation in RunStream.
- Story 4.3: Use readable tool presentation in Chat.
- Story 4.4: Align backend tool formatting.

#### Epic 5: Show Files Changed and Git Attribution

- Story 5.1: Show a run-level Files Changed panel.
- Story 5.2: Attribute Git changes to node executions.

#### Epic 6: Expose Additional Agent Context

- Story 6.1: Persist and present agent thinking.
- Story 6.2: Persist and present the triggering prompt.
- Story 6.3: Persist and present advisor notifications.

#### Epic 7: Make Drafts and Guidance Durable

- Story 7.1: Add durable steering storage.
- Story 7.2: Save and restore composer drafts.
- Story 7.3: Preserve the shared queue and FIFO order.
- Story 7.4: Recover guidance after server restart.
- Story 7.5: Support durable auto-send mode.

#### Epic 8: Stop and Redirect Turns Across Core Providers

- Story 8.1: Implement the provider-neutral Stop contract.
- Story 8.2: Expose Stop through the API and both Node Room shells.
- Story 8.3: Complete Claude Stop, soft injection, and delivery acknowledgement.
- Story 8.4: Complete Codex Stop and session continuation.
- Story 8.5: Complete Grok Stop and soft injection.
- Story 8.6: Complete DeepSeek Stop and continuation.
- Story 8.7: Complete OMP Stop and soft injection.
- Story 8.8: Present truthful provider capabilities.

#### Epic 9: Extend Steering to Remaining Providers

- Story 9.1: Support Stop and redirect for Qoder CLI.
- Story 9.2: Support Stop and redirect for Pi.
- Story 9.3: Support Stop and redirect for GitHub Copilot.
- Story 9.4: Support Stop and redirect for OpenCode.

### 6.5 Dependency rules

Every new story may depend only on completed historical behavior or a lower-numbered new story.

Historical stories are cited for traceability only.

No acceptance criterion is added to a historical story.

Epic 3 establishes the approved Node Room presentation baseline.

Epic 4 extends the presentation contract across data sources and surfaces.

Epic 5 and Epic 6 build on the presentation baseline.

Epic 7 establishes the durable steering control plane.

Epic 8 builds Stop and delivery on the durable control plane.

Epic 9 reuses the provider conformance contract from Epic 8.

### 6.6 Test-plan changes

**Old:** The test plans exclude successful Codex file ingestion, expect process-local loss, include detached State 8, and treat current provider work as gated.

**New:** The test plans verify durable recovery, every provider, every presentation surface, and all approved UX behavior while excluding detached, Cancel changes, and individual-tool cancellation.

**Rationale:** Acceptance evidence must match the corrected scope and must exercise restart and schema-upgrade risks directly.

Update the read and steering test plans to remove their conflicting exclusions and add ownership for every new story.

Add Codex file-change ingestion tests from provider event through persisted transcript and every presentation surface.

Add shared semantic fixture tests for Node Room, RunStream, Chat, and backend formatting.

Add todo placement, inline checklist, terminal projection, panel-width, keyboard, focus, and accessibility tests.

Add schema parity and upgrade tests for SQLite and PostgreSQL.

Add durable draft, queue, FIFO, concurrency, withdrawal, auto-send, restart, Resume, and ambiguous-dispatch tests.

Add Stop conformance for all nine providers.

Add capability-driven per-item Send now and delivery-status tests.

Add Files Changed, Git attribution, thinking, prompt, and advisor tests.

Delete detached State 8 and `422 means detached` from current acceptance coverage.

Do not add individual-tool cancellation coverage.

Do not make historical Cancel behavior part of the new acceptance gate.

Run focused package tests first.

Run `bun run validate` before delivery.

Run `bun run check:schema-upgrades` against PostgreSQL because the correction adds database schema.

Never run `bun test` directly from the repository root.

### 6.7 Sprint-status additions

**Old:** Sprint status contains only historical Epic 1 and Epic 2 entries and an obsolete post-v1 note.

**New:** Existing entries remain verbatim, and new backlog entries are appended for Epic 3 through Epic 9 and Story 3.1 through Story 9.4.

**Rationale:** The status file must track the current work without rewriting historical records.

Preserve every existing status entry verbatim, including historical entries that still say `backlog`.

Append Epic 3 through Epic 9 and Story 3.1 through Story 9.4 with initial status `backlog`.

Do not add an optional retrospective entry for these epics.

Add a correction note that G1 through G4 are historical labels whose current implementation outcomes are now owned by Epic 8.

## 7. Verification Strategy

Each story must have focused unit or integration coverage at its owning boundary.

Provider adapter tests must use deterministic fixtures and must not require live network access in the normal test suite.

Restart E2E coverage must use a real server process and the same database before and after restart.

The restart test must track and terminate every process that it starts.

Cross-surface tests must prove semantic parity without violating package dependency rules.

Visual E2E checks must cover Console at 520 pixels and Legacy at 460 pixels.

Database validation must prove fresh install, upgrade, reapply idempotence, and SQLite/PostgreSQL parity.

The final validation sequence is focused tests, affected package tests, schema-upgrade checks, and `bun run validate`.

## 8. Risks and Mitigations

### 8.1 Duplicate side effects after restart

Risk: The provider may have completed a tool action before the server lost its acknowledgement.

Mitigation: Preserve an explicit ambiguous delivery state and never auto-resend it.

The user reviews the restored state and invokes the existing Resume action.

### 8.2 Provider capability overstatement

Risk: A provider may advertise interrupt or injection behavior that its active SDK path does not implement safely.

Mitigation: Capability values become true only after adapter conformance tests pass.

The UI renders actions from verified capability data.

### 8.3 Queue ordering under concurrency

Risk: Multiple operators can submit guidance at the same time.

Mitigation: The server assigns FIFO order transactionally and retains author identity on every record.

### 8.4 Cross-surface drift

Risk: Node Room, RunStream, Chat, and backend formatting can diverge.

Mitigation: Use one semantic contract and shared fixtures while preserving package boundaries.

### 8.5 Historical planning mutation

Risk: Correcting old story text would erase the record of completed work.

Mitigation: Add only new epics and stories and cite old stories only as dependencies or traceability evidence.

## 9. Implementation Handoff

### Product and planning

Update the SPEC, UX artifacts, architecture artifacts, epic catalog, test plans, and sprint-status additions exactly as approved here.

Do not edit historical epic or story content.

### Architecture and data

Define the additive steering records, store interface, route schemas, recovery states, and provider capability mappings.

Verify the design against the single-tenant and multi-user architecture rules.

### Development

Implement Epic 3 through Epic 9 through new story files only.

Use the existing Resume capability and existing provider request signals.

Do not add detached steering, a new Cancel path, or individual-tool cancellation.

### Quality engineering

Maintain the requirement-to-story-to-test traceability map for every new story.

Run provider conformance, restart recovery, cross-surface, accessibility, visual, schema-upgrade, and full validation gates.

## 10. Approval Record

The product owner approved the SPEC/PRD proposal incrementally on 2026-09-21.

The product owner approved the Architecture proposal incrementally on 2026-09-21.

The product owner approved the UX and mockup proposal incrementally on 2026-09-21.

The product owner approved the Epic 3 through Epic 9 proposal incrementally on 2026-09-21.

The product owner approved the Test Plan and Sprint Status proposal incrementally on 2026-09-21.

The product owner granted final workflow approval on 2026-09-21.

The approved change is classified as a Major Course Correction.

The implementation handoff is routed to the Product Manager and Solution Architect.

## 11. Unresolved Questions

None.
