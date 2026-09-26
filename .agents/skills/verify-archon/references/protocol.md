# Archon verification helper

The helper executes the user paths in the feature map.
Its JSON files connect the existing workflow and runner; they are local implementation formats.

## Commands

```text
catalog --json
doctor --repo PATH
normalize-selection PROPOSAL --repo PATH --out SELECTION
validate-selection SELECTION --repo PATH
prove --selection SELECTION --repo PATH --evidence-root PATH
prove --scenario ID --repo PATH --evidence-root PATH
```

A proposal names behavior IDs, confidence, rationale, and explicitly selected gaps.
Normalization resolves existing recipes and expands a feature when the selector states uncertain impact.
Unknown IDs and explicitly selected unsupported gaps return clear errors.
Changed paths, Git HEAD, merge bases, and source cleanliness do not control admission.
Older proposal metadata is readable but does not constrain execution.

## Results

Proof launches the current application, executes every selected recipe, checks outcomes and attachments, and writes a fresh result.
Run and selection identities associate evidence with its execution, not a commit.
Unknown, failed, flaky, skipped, and incomplete work is nonpassing.
Evidence paths cannot escape into source through traversal or symlinks.
Cleanup removes owned runtime resources and preserves evidence.
Setup failures identify the missing prerequisite without claiming a demonstrated product defect.
