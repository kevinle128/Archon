---
name: select-verify-archon-targets
description: Select Archon verification targets from the complete request and actual committed diff through the live project-verification v1 helper.
---

# Select Archon verification targets

Produce one fresh, validated selection for the caller's exact target and base.
This skill ends at target selection.
Do not run product proof unless the caller explicitly requests it.
Do not repair product code, commit consumer changes, publish, or read old skill versions to reconstruct a catalog.

## Resolve the live verifier

Use the verifier path supplied by the caller.
Otherwise inspect only the current target's project-local `.agents/skills/*/contract.json` files.
Do not search parent repositories or choose the first of several candidates.
Require exactly one compatible `project-verification` version 1 descriptor.
For no candidate, report the missing v1 verifier prerequisite.
For multiple candidates, list them and require an explicit choice.
For an incompatible or malformed descriptor, report the observed contract and the required upgrade.

Read that verifier's complete `SKILL.md`, descriptor, referenced schemas, current `features/*.json`, gaps, and qualification report or limits.
Resolve every `entrypoint` argument relative to the verifier as declared by its descriptor.
Run its help and `catalog --json` operations and retain their exit status and diagnostics.
A broken entrypoint or failed operation stops the handoff.
Never copy its schemas, IDs, path matching, normalization, or runner list into this skill.

The normal Archon verifier is `.agents/skills/verify-archon/`.
Its tooling checkout and `--repo` target may be different.
Its explicit `--selection` interface is mandatory; it does not discover selection files.

## Inspect the complete change

Read the complete raw request, the available plan, and the target's instructions.
Preserve the caller's constraints and explicit deferrals.
Resolve `TARGET` to the absolute Git repository root and obtain `BASE_SHA` independently of any proposal.
Archon uses `dev` as its integration branch; inspect live refs and use the merge base when the caller did not supply a base.
Do not replace the base with `HEAD` to hide a diff.
An explicit historical check may use an empty diff with `--historical` at all three helper stages.

Inspect the complete base-to-head diff, including additions, deletions, and both endpoints of renames.
Read the changed source, its callers, public entry points, and relevant tests.
A plan, file list, or path match alone cannot establish semantic coverage.
Map each requested effect to an actual live behavior or gap.
If a new effect has no scenario or matching gap, stop with the exact verifier upgrade needed.
Do not invent an ID or claim that a broad path covers a new behavior.

Read the selected runner configuration for a UI effect.
For this verifier, `visual-config.json` pins sources, surfaces, states, comparison conditions, criteria, and accepted differences.
Follow the source chain through the request, story/specification, UX design, handoff, and rendered mockups.
Keep the source trace in the attempt; it cannot supply new runtime configuration.
If a required visual state is absent or a pinned source is stale, report a verifier configuration upgrade and stop.
UI behaviors must retain their configured visual scenarios.
Do not require a browser or mockup for a CLI/backend change with no visible effect.

## Resolve unmapped paths inside this flow

When a changed path has no live mapping, or normalization reports one, spawn one bounded verification sub-agent.
Give it the complete raw request and plan, complete diff, relevant source and tests, current target, full live contract/catalog/gaps, and helper instructions.
Assign ownership only of the selected verifier's mapping/catalog files in the current target checkout.
It is not alone in the workspace and must preserve other edits.
Require it to trace each path to an observable existing behavior or gap and make only the smallest correct mapping.
It must not edit product code, invent IDs, add a broad prefix to force success, or ask the implementation author to resolve the path.

Review the sub-agent's rationale and exact before/after catalog diff.
Run the verifier's catalog and contract checks.
If the selected verifier is outside the current checkout and no target-local editable verifier is available, report that precise prerequisite rather than editing another project.
Keep tooling edits separately addressable from the clean commit-bound product source.
If an edit makes product source dirty, do not commit it automatically or bypass the cleanliness guard.
Resolve the tooling placement or report the dirty-target prerequisite.
If semantics remain ambiguous, return the precise blocker with no usable selection.
After a valid catalog change, abandon the prior attempt and create a new one.
Repeat the bounded flow only for a newly discovered unmapped path.

## Produce a fresh selection

Follow the verifier's live storage rule.
For Archon, use `TARGET/.plans/verifications/{feature_name}/{attempt_id}/` unless the caller supplied the same external root for both skills.
Use a descriptive lowercase feature slug and a fresh UTC timestamp plus UUID for the attempt.
Require the attempt directory and all output files to be absent before creation.
Never reuse a proposal or selection from another attempt.

Run the helper's snapshot operation with the independently pinned target and base, and save `snapshot.json` in that attempt.
Stop on dirty source or a failed snapshot.
Read the complete actual diff again if the target or base changed.
Write `proposal.json` with the exact snapshot identities and path set, unique live affected behavior IDs, confidence, rationale, and any matching live gap IDs.
Express uncertain or shared impact through confidence and evidence; let the helper broaden deterministically.
Do not assign normalized behavior or scenario sets yourself.

For the normal Archon helper:

```sh
bun "$VERIFIER/bin/verify.ts" snapshot --repo "$TARGET" --base "$BASE_SHA"
bun "$VERIFIER/bin/verify.ts" normalize-selection "$ATTEMPT/proposal.json" --repo "$TARGET" --base "$BASE_SHA" --out "$ATTEMPT/selection.json"
bun "$VERIFIER/bin/verify.ts" validate-selection "$ATTEMPT/selection.json" --repo "$TARGET" --base "$BASE_SHA"
```

Use the descriptor's live entrypoint when it differs from this example.
Capture each exit status and diagnostic in the current attempt.
Pass the proposal unchanged to normalization and leave the normalized selection untouched.
Only the current attempt's successful normalization plus validation permits handoff.
Unknown IDs, known gaps, missing current artifacts, changed HEAD/base/path set/catalog, dirty source, or helper failure are failures.
Never search for an older successful file or replace failed change selection with `--scenario`.
Keep failed attempts as non-handoff evidence and create a new attempt after resolving the cause.

## Return the handoff

Report the feature name, attempt directory, absolute selection path, helper exits, selected behavior/scenario IDs, broadened features, and gaps or limitations.
Return this exact proof command with the same independently pinned base and target:

```sh
bun "$VERIFIER/bin/verify.ts" prove --selection "$ATTEMPT/selection.json" --repo "$TARGET" --base "$BASE_SHA" --evidence-root "$ATTEMPT/evidence"
```

Include `--historical` only when the caller explicitly requested that mode.
Retain the complete attempt and the later proof's unique `evidence/` child.
Do not move retained artifacts to an operating-system temporary directory.
The verifier supplies the product verdict; selection itself is not product PASS.
