# Root-cause audit: steering queue visual drift

Date: 2026-09-20

Scope: PRs #207, #210, #213, #214, #219, #218, and #225.

## Result

The first implementation drift entered in PR #207.
PR #207 defined a queued row as `message + sent` without an ordinal or the approved per-item action anatomy.
PR #210 then added a visible `delete` text button after `sent` and made that row shape explicit in its plan and tests.
Later PRs reused that implementation as the baseline and did not compare the live queue state with `Legacy Node Room.dc.html`.

The missing per-item `Send now` has a different cause.
The 2026-09-15 owner-ratified v1 contract moved soft-inject and per-item `Send now` to post-v1 gate G2.
The handoff prototype still starts with `softInject: true`, so its default screen shows a future state instead of the v1 default state.
That is a design-reference state problem, not an accidental omission in PR #214.

The queue-row anatomy is a real fidelity defect.
The v1 scope decision does not explain the missing ordinal, the extra queue-row `sent` label, or the replacement of the mockup action treatment with a visible text action.

## What the approved sources say

The handoff README calls the `.dc.html` files high-fidelity design references and says to reproduce them pixel-perfectly with production tokens.
It also says that the contracts override the prototypes when they conflict.

The README records one relevant accepted conflict.
Per-item `Send now` is post-v1 G2 and must be absent on the v1 queue-only path.

The Legacy prototype renders each queue item with these parts:

1. An ordinal.
2. The message text.
3. Conditional per-item `Send now` when soft-inject is available.
4. A 24 px `✕` action.

The prototype does not render `sent` inside the queue row.
The final UX spine assigns `sent` to the operator transcript row's message-status line.
It describes the pending queue item separately as one elided line with per-item actions.

The prototype currently starts with `softInject: true`.
This default makes the future G2 control visible even though the same handoff README says the v1 floor must not render it.

## Decision ledger

| PR                                                    | Plan decision                                                                                                                                                        | Implementation effect                                                         | Audit disposition                                                                                                                                                          |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#207](https://github.com/kevinle128/Archon/pull/207) | Treat the queue as POST-response receipts and render each item with visible `sent`; defer all per-item controls to later stories.                                    | Introduced the current `message + sent` row in both shells.                   | First visual divergence. The plan used story scope as a visual boundary and did not preserve the handoff row anatomy.                                                      |
| [#210](https://github.com/kevinle128/Archon/pull/210) | Keep the existing row as the baseline; add visible `delete` after `sent`; exclude the undefined `keep` action.                                                       | Introduced the current visible text action and locked it in tests.            | Second visual divergence. The plan used the older co-located `key-steering-dock.html`, not the high-fidelity `Legacy Node Room.dc.html`.                                   |
| [#213](https://github.com/kevinle128/Archon/pull/213) | Make no copy, layout, or styling changes; preserve the existing row and add live reconciliation only.                                                                | Replicated the same row across tabs and operators.                            | Propagation, not origin. The plan declared the inherited baseline correct without a new reference comparison.                                                              |
| [#214](https://github.com/kevinle128/Archon/pull/214) | Add dock-level `Stop`, `Queue`, and idle `Send now`; exclude mid-turn soft-inject; merge #213 by taking the union of queue, delete, polling, and interrupt behavior. | Preserved the inherited row and added the correct v1 interrupt flow.          | Mixed result. The lack of per-item `Send now` is an accepted v1 scope decision. The merge did not revalidate queue-row fidelity after resolving 15 file conflicts.         |
| [#219](https://github.com/kevinle128/Archon/pull/219) | Render delivered operator messages with a right-aligned `sent` status in the transcript.                                                                             | Correctly implemented the transcript-row status.                              | Important supporting evidence. This is the only audited plan that cites the shipping `.dc.html` prototypes directly, but its scope did not re-audit the pending queue row. |
| [#218](https://github.com/kevinle128/Archon/pull/218) | Reuse the existing `sent` queue band in read-only finished-iteration mode and synchronize canonical documents to that behavior.                                      | Extended the inherited row to another mode and added matching authority text. | Ratification after implementation. It made the existing implementation look canonical without resolving the original queue-row mismatch.                                   |
| [#225](https://github.com/kevinle128/Archon/pull/225) | Add a separate read-only `Never sent` terminal box and leave live queue behavior unchanged.                                                                          | No new live-row drift.                                                        | Propagation only. Its authority sync did not revisit the live queue anatomy.                                                                                               |

## Detailed cause chain

### 1. The planning source set did not include the actual visual artifact

The plans for #207, #210, #213, #214, #218, and #225 do not cite `Legacy Node Room.dc.html`.
They cite the final prose spines and the older co-located `mockups/key-steering-dock.html` instead.

PR #210 explicitly says the illustrative steering mockup predates per-item controls.
That statement can apply to the older co-located mockup, but it does not apply to the high-fidelity `.dc.html` handoff, which already contains the per-item controls and row anatomy.

The #207 scout report found the handoff README and even recorded the ordinal typography and the keep/delete requirement.
The final #207 plan still changed the queue item to `message + sent` and did not record why the ordinal or action skeleton was removed.
This was an unresolved scout-to-plan contradiction.

### 2. Story slicing was incorrectly treated as permission to change the visual contract

The implementation stories were split by backend capability.
PR #207 owned queue acceptance.
PR #210 owned removal.
PR #214 owned interrupt and redirect.

That split is valid for behavior.
It does not make each intermediate backend story a new visual design authority.

PR #207 used the absence of Story 2.2 behavior to omit the handoff row action anatomy and introduce a new `sent` receipt treatment.
PR #210 then treated #207's output as the visual baseline.
Each later plan compared only with the immediately previous implementation.

### 3. Tests were derived from the plan, not from an independent visual oracle

The component tests explicitly require visible `sent` text and a visible `delete` button.
The queue-only tests explicitly require no `Send now`.

These tests prove that the implementation follows the plan.
They cannot prove that the plan follows the approved mockup.

The missing v1 per-item `Send now` assertion is correct.
The row-anatomy assertions are self-confirming because they encode the same plan decision that caused the drift.

### 4. The PR screenshots proved rendering, not fidelity

The PR acceptance reports measured contrast, focus, overflow, target size, and reduced motion.
They captured the implementation states successfully.

They did not compare a live queue state with the matching region in `Legacy Node Room.dc.html`.
The screenshots therefore proved that the chosen implementation was stable and accessible, but not that it matched the approved design.

The evidence is also mutable.
For example, later PRs overwrote the #207 screenshot path `us-005-legacy-queued-2.png`.
The image at the current path is not the same image that #207 originally merged.
This breaks durable review provenance.

### 5. The governed visual verifier explicitly excluded the feature

The governed visual verifier was merged in #205 four seconds before #207 reached `develop`.
Its configured states are tool-row, Raw, Ask, assistant-report, and runtime-graph states.
It has no steering queue state.

Its accepted-differences list explicitly excludes the steering dock as a future mockup feature.
Its pinned sources include only the handoff `README.md`.
They do not include `Legacy Node Room.dc.html`, `Console Node Room.dc.html`, or the support file that renders them.

Refreshing the visual source hashes in later PRs only proved that maintainers acknowledged the changed files.
It did not add a steering state or compare the queue row.

### 6. Normal CI did not run the steering visual journeys as a required gate

`bun run validate` does not run the Playwright package.
The CI `e2e-hitl` job runs `test:ui:hitl`, which selects test titles that contain `HITL`.
The steering journeys use `[V:steer.*]` tags and are not the governed `ui.visual` scenario.

The full governed visual reviewer is not a required GitHub status check for these PRs.
The PR-specific steering Playwright runs were local evidence only.

### 7. GitHub review and merge controls did not enforce a stop

The `develop` branch is not protected.
It has no required status checks and no required approval count.

All audited PRs were authored and merged by the same account.
None of the audited PRs has a GitHub approval review.
Conflict-resolution comments on #214, #218, and #225 are not approval reviews.

PRs #207, #210, #213, #214, and #218 were merged with a failed CI job in their final recorded check set.
PRs #213, #214, and #225 were merged before all final checks completed.

The merge process therefore had no independent reviewer and no enforced green gate.

### 8. Overlapping branches preserved behavior by union, not by renewed product review

PR #214 resolved 15 conflicted files by taking the union of interrupt, withdraw, and queue-polling behavior.
PR #218 later resolved more dock conflicts after rebasing over #214 and #219.

The conflict reports list type-checks, focused tests, and lint.
They do not list a same-state mockup comparison.

This integration method can preserve code behavior while still preserving a wrong visual baseline.

## Why the gates appeared green

There was no gate that asked the relevant question.

The existing checks asked these questions:

- Does queue behavior work?
- Does removal work?
- Does polling converge?
- Does interrupt and redirect work?
- Is the UI accessible and free of overflow?
- Do source hashes still match the pinned values?

No required check asked this question:

> Does the live Legacy and Console queue row match the approved high-fidelity steering handoff for the current release state?

The review process therefore optimized and verified the wrong acceptance surface.

## Prevention

### P0: Enforce merge safety on `develop`

Protect `develop` and require pull requests.
Require at least one approval from someone other than the author.
Dismiss stale approvals after new commits.
Require the branch to be current with `develop` before merge.
Require all CI jobs that apply to the change, and block merge while any job is pending or failed.
Do not allow author or administrator bypass for ordinary feature PRs.

### P0: Put steering states into the existing governed visual verifier

Reuse `.agents/skills/verify-archon/visual-config.json` and its reviewer.
Do not create a second visual system.

Add at least these matched states for both shells:

1. Generating with two queued messages on the v1 queue-only path.
2. Generating with Stop and Queue on an interrupt-capable provider.
3. Idle-after-interrupt with `WILL SEND` and dock-level `Send now`.
4. Ask-blocked.
5. Finished-iteration read-only queue.
6. Terminal `Never sent`.

Run the states at the 460 px room width and the normal Console desktop viewport.
Pin the actual `.dc.html` files and their support file, not only the README.

### P0: Separate release states from future prototype states

The handoff must open in the current shippable v1 state by default.
The post-v1 G2 soft-inject state must be an explicit, labelled alternate state.

The visual verifier must set `softInject: false` for v1 acceptance.
It can keep a separate non-blocking future-state case for G2.

This removes the current contradiction where the README says “post-v1” but the first rendered screen shows it as active.

### P0: Require an explicit visual decision table in every UI plan

For each changed state, the plan must name:

- the exact source file;
- the exact source state;
- the expected visible anatomy and copy;
- the allowed deviations;
- the product decision that authorizes each deviation;
- the reviewer who accepted the result.

A generic sentence such as “the prose spine overrides older mock details” is not enough.
If two sources conflict and no recorded decision resolves the exact element, planning must stop for an owner decision.

### P1: Make steering visual proof a required CI check

Add a path-aware steering Playwright job or include the governed `ui.visual` scenario when dock files, steering tests, or steering design sources change.
Require that status on `develop`.

The check must compare reference and actual images for the configured state.
Screenshot creation alone must never count as acceptance.

### P1: Add a UI section to the PR template

For a visible UI change, require:

- canonical reference links;
- actual and reference captures at the same state and viewport;
- a list of accepted differences;
- an independent UX approval;
- a statement that the merge result, not only the feature branch, was reviewed.

### P1: Make evidence immutable

Store evidence under a PR number and tested commit SHA.
Write a manifest with image hashes.
Do not let later PRs overwrite earlier acceptance paths.

### P1: Re-run cumulative visual acceptance after conflict resolution

Any conflict in a shared UI component must invalidate previous visual approval.
The merge result must run the complete affected state matrix before the PR can merge.

Focused unit tests and type-checks are necessary but not sufficient after a visual integration conflict.

### P2: Keep behavioral scope and visual anatomy separate

A story may defer an action's behavior without inventing a different row structure.
The plan must state how the approved anatomy behaves while a capability is unavailable.

Examples include hiding a post-v1 control, rendering a non-interactive reserved slot only when the design requires it, or obtaining an explicit design change.
The story boundary alone cannot decide the presentation.

## Proposed repair sequence

1. Confirm the v1 live queue-row anatomy from the high-fidelity handoff, with the post-v1 per-item `Send now` hidden.
2. Resolve the queue-row action's visible treatment as a separate product choice without changing the internal API name.
3. Add the v1 steering states and actual handoff files to the governed visual verifier.
4. Write a failing visual and DOM contract for the approved row anatomy.
5. Repair both dock renderers through their existing shared steering state and thin shell renderers.
6. Run the full steering E2E matrix and the governed visual review against the merge result.
7. Protect `develop` before the next steering UI PR merges.

## Unresolved product question

The audit does not decide the visible wording or icon for the per-message removal action.
That choice needs one explicit owner decision against the high-fidelity row, while the internal route and registry method can keep their existing technical names.
