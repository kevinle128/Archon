# Sprint Change Proposal: Agent Node Room Approved-Behavior Remediation

**Date:** 2026-09-20
**Project:** Archon
**Target:** Agent Node Room on `develop`
**Mode:** Incremental
**Recommended approach:** Direct adjustment
**Change scope:** Moderate, with high implementation effort and high technical risk
**Status:** Final proposal approved for implementation on 2026-09-20; Correct Course workflow complete

## 1. Issue Summary

All original Agent Node Room Stories were implemented and completed before this post-implementation review.

The post-implementation readiness review found that the planning artifacts and shipped product do not satisfy the approved mockup contract.
The review inventoried 64 visible behaviors.
It classified 40 as matched, 5 as partial, 10 as missing, and 9 as conflicting.

Every visible approved mockup behavior is authoritative current scope.
A future label is valid only for behavior that is absent from the approved mockups.

The defects include per-item **Send now** during generation, soft-inject capability and refusal states, delivery confirmation, todo placement and terminal projection, occurrence labels, queue presentation and ownership copy, finished-iteration targeting, product-state controls, navigation, and accessibility disclosures.

The trigger is the completed implementation-readiness report, not one pending Story.
Completed Stories remain historical delivery records.
Corrective work is separate and links back to the affected delivered Stories and behavior identifiers.

### Evidence

- The canonical SPEC adopts the approved mockup handoff as part of the complete contract.
- The readiness matrix contains 64 atomic visible behaviors.
- The readiness matrix records 24 non-matching behaviors.
- The readiness report identifies visible behavior that was incorrectly treated as future G1, G2, and G4 work.
- The readiness report identifies visible controls without exact PRD, Architecture, UX, Epic, or Story ownership.

## 2. Impact Analysis

### Epic impact

Epics 1 and 2 remain historical records of completed work.
All original Story statuses remain `done`.

A new corrective Epic owns the approved-behavior remediation.
It does not distribute corrective defects back into completed Stories.
It links each correction to the original Story and behavior evidence.

Visible G1, G2, and G4 behavior moves into current corrective scope.
G3 remains a future capability because Grok hook-based soft-inject behavior is absent from the approved mockups.

### Story impact

The corrective Epic contains seven ordered Stories:

1. Reconcile transcript, family-chip, todo, and terminal projections.
2. Reconcile occurrence labels and finished-iteration targeting.
3. Present truthful shared queues in every approved layout.
4. Send one queued item now during generation.
5. Show honest soft-inject refusal and delivery-confirmation states.
6. Provide approved state, node-kind, provider, rerun, navigation, artifact, and close controls.
7. Prove Legacy and Console conformance for all 64 behaviors.

### Artifact conflicts

The canonical SPEC and companion contracts defer or reject visible approved behavior.
The readable-transcript and live-steering Architecture spines do not own every visible state and control.
The UX documents select one presentation where approved mockups contain multiple current variants.
The Epic plan treats visible G1, G2, and G4 behavior as future work.
The planning test contracts do not require proof for all 64 visible behaviors.

### Technical impact

Future implementation work affects the transcript presentation model, todo projection, occurrence grouping, steering registry, executor turn loop, route contracts, provider capability handling, queue and dock UI, terminal reconciliation, finished-iteration targeting, Legacy shell, Console shell, and accessibility behavior.

This Correct Course change does not modify product code or test code.
It makes the planning contract ready for later implementation work.

### Deployment and data impact

No database, deployment, infrastructure, or CI configuration change is approved by this proposal.
Later technical analysis must add such work only if the corrected current behavior proves that it is required.

## 3. Recommended Approach

Use Direct adjustment.

Keep the delivered baseline because 40 of 64 approved behaviors already match.
Do not roll back correct implementation.
Do not reduce or defer visible approved behavior.

Apply the correction in this order:

1. Correct the PRD/spec, Architecture, UX, Epic, Story, and planning test contracts.
2. Create the linked corrective Epic and remediation Stories.
3. Implement the engine, API, provider, Legacy UI, and Console UI corrections.
4. Verify all 64 approved behaviors with focused, integration, end-to-end, visual, and accessibility evidence.
5. Run implementation readiness again.
6. Close corrective work only when no behavior is partial, missing, conflicting, or unclear.

### Effort, risk, and timeline

Planning effort is moderate because the accepted decisions are explicit.
Implementation effort is high because the correction crosses engine, API, provider, and two UI shells.
Technical risk is high because steering, delivery confirmation, and finished-iteration targeting change live runtime behavior.
The delivery timeline gains one corrective implementation and verification cycle.

### Alternatives rejected

Rollback is rejected because it removes working behavior without resolving the contract conflict.
MVP reduction is rejected because every visible approved mockup behavior is current scope.
Reopening completed Stories is rejected for this correction because the approved approach preserves delivered history and creates linked cross-cutting remediation work.

## 4. Detailed Change Proposals

### Requirements and companion contracts

**Before:** Visible soft-inject, per-item **Send now**, and `delivered` behavior is described as gated or future work.

**After:** Visible G1, G2, and G4 behavior is current corrective scope, and only non-visible G3 behavior remains deferred.

**Before:** The todo strip is required at the top of the transcript, while approved mockups place it below the transcript and above the queue or dock.

**After:** The approved position is normative, and terminal todo changes are display projections that do not falsify stored provider state.

**Before:** Only `Run` or `Iteration` occurrence labels are accepted.

**After:** `Run N` means a repeated top-level node execution, `Iteration N` means a loop occurrence, `Pass N` means another provider turn in the same occurrence, and a reason-only label means a non-numbered interruption or recovery occurrence.

**Before:** The contract selects one queue container and treats `this tab only` as incompatible with the shared queue.

**After:** A full Legacy or Console room uses the full-bleed queue, a compact dock or state-review layout uses the inset queue well, `this tab only` labels unsent draft content only, and accepted queued items are node-scoped and shared.

**Before:** Finished-iteration mutations are node-scoped and iteration-agnostic.

**After:** A finished-iteration mutation carries the retry epoch and fails closed when the epoch is stale.

### Architecture

**Before:** Architecture has no owner for every approved state, selector, navigation control, and capability transition.

**After:** The readable-transcript and live-steering spines own every approved context rule, API decision, provider state, terminal projection, and two-shell responsibility.

**Before:** Per-item **Send now** during generation is unavailable until a future provider spike clears.

**After:** The control is current and visible during generation, it executes when the selected provider supports soft-inject, and it remains visible with a clear refusal state when that path is unavailable.

**Before:** `delivered` is unreachable in current scope.

**After:** `delivered` appears only after provider confirmation by stamped message ID.

### UX

**Before:** UX contracts reject or omit approved variants that appear in the mockups.

**After:** A context matrix assigns every approved layout, label, state, selector, and navigation control to a current product context.

**Before:** The approved idle dock does not contain the required inactivity disclosure.

**After:** Both shells contain visible and accessible 30-minute inactivity copy and explain that typing keeps the redirect open.

**Before:** Accessibility requirements do not cover every new current state.

**After:** Keyboard, focus, screen-reader, narrow-screen, reduced-motion, refusal, and terminal behavior is explicit for both shells.

### Epics and Stories

**Before:** Completed Story history and visible future gates do not form one consistent current-scope plan.

**After:** All original Story history remains complete, visible G1, G2, and G4 behavior moves into the corrective Epic, and G3 alone remains a future capability.

**Before:** No Story owns the complete 24-behavior correction.

**After:** Epic 3 contains seven ordered, user-centered remediation Stories with behavior-level traceability and acceptance criteria.

### Planning tests

**Before:** The planning test contracts validate the prior canonical rules but do not prove every approved visible behavior.

**After:** The read and steering test plans cover all 64 behaviors, all 24 current gaps, both shells, provider capability and refusal states, delivery confirmation, real-browser visuals, and accessibility.

### Sprint tracking

**Before:** Sprint tracking contains only Epics 1 and 2.

**After:** Sprint tracking records Epics 1 and 2 and all original Stories as `done`, then adds Epic 3 and its seven new corrective Stories.
Tracking status records work progress and does not redefine product scope.

## 5. Implementation Handoff

### Classification

This is a Moderate change with high implementation effort and high technical risk.
It requires coordinated corrective planning by the Product Owner, Architect, UX, Developer, and QA owners.
It does not change the core product goal.

### Responsibilities

- The Product Owner owns Epic 3, remediation Stories, behavior traceability, and the distinction between completed original work and new corrective work.
- The Architect owns engine, provider, API, state, and integration contracts.
- The UX Designer owns context rules, layouts, copy, interaction states, and accessibility.
- The Developer implements the approved correction after the planning contract is final.
- The QA or Test owner maintains the 64-behavior verification matrix and collects browser evidence.
- The Orchestrator sequences the work, preserves approvals, and enforces readiness gates.

### Success criteria

- All listed planning artifacts agree on one current-scope contract.
- Every visible approved mockup behavior has a requirement, Architecture owner, UX rule, Story owner, and verification path.
- All original Story history remains complete.
- New corrective work stays separate from the completed original Stories.
- No visible behavior remains future, optional, missing, partial, conflicting, or unclear.
- G3 remains deferred only because its behavior is absent from the approved mockups.
- All 64 behaviors pass the final verification matrix in Legacy and Console.
- A new implementation-readiness run passes before corrective work is closed.

## Approval Record

- The user clarified that all original Agent Node Room Stories were implemented and completed.
- Section 3 was approved as proposed.
- Section 4 and the Direct adjustment recommendation were approved.
- Section 5 and the handoff plan were approved with completed original work kept separate from new corrective work.
- The explicit planning-artifact edit proposal was approved on 2026-09-20.
- The complete Sprint Change Proposal was approved for implementation on 2026-09-20 after validation of the applied planning changes.
- The Correct Course workflow completed on 2026-09-20 with Moderate scope and handoff to the Product Owner, Architect, UX Designer, Developer, QA or Test owner, and Orchestrator.

## Unresolved Questions

None.
