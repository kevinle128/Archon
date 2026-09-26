---
name: select-verify-archon-targets
description: Choose Archon user-facing behaviors and verification recipes from a request, plan, and actual change.
disable-model-invocation: true
---

# Select Archon verification targets

Select what to test, how a user reaches it, and what observable result proves it works.
Read the target checkout's `verify-archon/SKILL.md` and `features/README.md`, or the verifier explicitly supplied by the caller.
This skill ends with target files and a proof command; run proof only when requested.

## Inspect the request and change

Read the complete request, plan, project instructions, actual diff, changed source, callers, and relevant tests.
For branch comparison use the explicit base, or the merge base with `origin/develop`.
Include local edits when the request covers them.
Use the diff to understand behavior, not to require a catalog entry for every file.
Preserve the user's scope, deferrals, and approved design sources.
Include shared behavior when the changed code can affect it.
A changed image, report, skill, or planning file does not by itself require a product scenario.
Describe missing user paths and their expected results explicitly.
Do not change product code or commit files during selection.

## Write the targets

Use a new directory under `TARGET/.plans/verifications/<feature>/<attempt>/`, or the caller's artifact directory.
Write `targets.md` with the target checkout, request/plan, feature recipes, actions, expected results, required evidence, and uncovered work.
Use one row or section per behavior so a fresh verifier can execute it.

For existing helper recipes, read `catalog --json` and write `proposal.json`:

```json
{
  "version": 1,
  "affected_behaviors": [
    {"id": "install.health", "confidence": "high", "rationale": "CLI discovery and validation changed."}
  ],
  "coverage_gaps": []
}
```

Use actual catalog IDs.
Medium or low confidence includes the other behaviors of the feature.
Document uncovered requirements; never report them as executable coverage.
Resolve the named behaviors with the existing helper:

```sh
bun "$VERIFY_HELPER" normalize-selection "$ATTEMPT/proposal.json" --repo "$TARGET" --out "$ATTEMPT/selection.json"
bun "$VERIFY_HELPER" validate-selection "$ATTEMPT/selection.json" --repo "$TARGET"
```

Set `VERIFY_HELPER` from the verifier's documented location.
Do not bind the target list to Git HEAD or require a clean checkout.
The workflow can commit these files before the next node without selecting again.

## Hand off

Return the absolute target-notes path, selection path when available, target checkout, selected behaviors, and uncovered work.
For supported recipes, return:

```sh
bun "$VERIFY_HELPER" prove --selection "$ATTEMPT/selection.json" --repo "$TARGET" --evidence-root "$ATTEMPT/evidence"
```

The verifier drives the current application and reports observed outcomes.
Selection alone is not product PASS.
Update targets when the requested behavior changes; an artifact-only checkpoint is not such a change.
