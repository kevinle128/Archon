# Verification skill alignment

Status: complete.

## Outcome

Follow the pstack verification skill design: select user-facing behaviors, drive the real app, observe results, retain evidence, and clean up owned resources.
Checkpoint commits between selection and execution must not invalidate the selected targets.

## Scope and constraints

Update the Archon skill pair, their existing helper and workflow caller, and the two OceanLabs generators in their source repository.
Reuse the existing executable scenarios and preserve their functional and visual assertions.
Remove commit identity and source cleanliness admission rules without replacing them with content fingerprints.
Do not edit product behavior, installed skill caches, or unrelated workspace changes.

## Steps

1. Reproduce the checkpoint handoff failure through the public helper.
2. Align the Archon instructions and feature map with pstack; remove the helper and workflow gates that contradict them.
3. Align and publish the OceanLabs source generators through an Orca worker with separate file ownership.
4. Run focused checks and one real CLI proof; confirm evidence survives cleanup.
5. Review the changes and report the plugin PR and local Archon result.

## Acceptance

A target selection remains executable after a checkpoint commit and with local edits.
Unknown scenarios, failed scenarios, missing evidence, and incomplete proof remain nonpassing.
Neither the verifier nor its workflow adapter requires a matching HEAD to execute targets.
The OceanLabs generators no longer require the custom portable protocol.
All task-owned subprocesses stop after use, and evidence remains available.

## Rollback

Revert the focused Archon change and the OceanLabs plugin PR separately.

## Progress and evidence

The public helper reproduced the original failure before the fix: normalize succeeded, a target-artifact checkpoint changed HEAD, and validate failed with `Stale base, target, or changed paths`.
The regression now performs that checkpoint and adds local edits; the unchanged selection remains valid.
The verifier no longer reads a Git snapshot, and the workflow adapter checks the current attempt, selected recipes, outcomes, and retained attachments.
Browser cleanup no longer restores tracked plan files.
Queue captures use the current proof directory.

Focused helper tests passed: 34 tests.
Workflow adapter and loader tests passed: 20 tests, including missing evidence, visual failure, incomplete execution, and checkpoint acceptance.
Helper TypeScript, scripts TypeScript, E2E TypeScript, and scoped helper ESLint passed.
The workflow bundle was regenerated with `bun run generate:bundled` and its check passed.
The real `install.health` recipe passed on the current checkout with local edits.
Its final retained result is at `.plans/verifications/verification-handoff/qualification/evidence/8a3c121c-4e0a-417b-ae4a-ff7c899ac4ed/result.json`.
The transcript records CLI version, help, discovery, valid and invalid workflow validation, and successful scratch cleanup.

Independent Orca review found no blocking defects.
The unused path matcher was removed after review.
Legacy proposal and result metadata remains readable; new proof writes `product: null` and never reads HEAD.
The implementation workflow's existing clean-start rule remains at setup to protect unrelated edits during implementation commits; it does not apply to selection or proof admission.
If application behavior changes after a proof, the PR instructions require a new proof, without a commit or content-hash gate.
The OceanLabs generators and their direct setup consumer are committed as `d080761` on `update/verification-upstream-user-path`.
[OceanLabs PR 15](https://github.com/oceanlabs-holding/skills/pull/15) is open and not merged.
Its 29 tests and both generated-skill checks passed.
See the [OceanLabs report](../../.plans/verifications/oceanlabs-upstream/qualification/report.md) for retained successful and failing CLI evidence.
The plugin source was updated through `update-and-publish-oceanlabs-skill`; installed skill caches were not changed.
Archon commits `6c8e9caa` and `dc7ec7cf` are pushed on `fix/verification-user-path-handoff`.
[Archon PR 300](https://github.com/kevinle128/Archon/pull/300) is open against `develop`.
The first full validation passed type checking and lint but found two generated evidence JSON files under `plans/reports` during formatting.
Those local artifacts were moved unchanged to the existing ignored `.plans/verifications` subtree.
The full suite then found a bundle test that still expected the previous prompt text and helper path.
The test now checks the current helper path and the absence of the removed HEAD gate.
Its 43 focused tests passed, and the final `bun run validate` passed on `dc7ec7cf`.
The PR contains source changes only; local plans and retained proof artifacts were not committed.
The reviewer terminal was released.
Orca retained the reused generator terminal as user-owned; no verification runtime remains active.
Full browser proof is not part of this qualification.
An existing visual-source pin differs from the current agent-node-room SPEC; visual proof still reports that prerequisite failure until the source and visual criteria are reviewed together.
No visual criteria or approved design decisions were relaxed.
