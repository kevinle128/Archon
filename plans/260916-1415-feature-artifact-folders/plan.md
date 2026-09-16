# Feature Artifact Folders in Both Planning Workspaces

Status: complete

## Outcome and scope

Update BMad team customization in `workflow-engine` and `agentic-os-plan` so each command selects one feature and uses that feature's folders.
Group existing loose BMad artifacts by verified feature ownership.
Keep shared roadmap records in a named roadmap package.
Preserve source content, story status, user changes, and submodule ownership.
Do not publish planning mirrors or change product requirements.

## Steps

1. Inspect current customization, artifact lineage, and scripts that consume artifact paths.
2. Record the move map and baseline file checksums before changing artifacts.
3. Add a shared feature-folder policy to the relevant installed workflow customization surfaces.
4. Move artifacts and update references, symlinks, and affected local script paths.
5. Check that every original artifact survives and that no previously valid local link is broken.
6. Run customization resolution, existing focused tests, contract validation, and whitespace checks.

## Acceptance criteria

- No loose feature artifacts in the planning, implementation, or brainstorming roots.
- Sprint workflows create and consume one feature-local tracker.
- Artifact discovery does not fall back to another feature or the newest global file.
- Existing team overrides remain effective.
- All moved files have unique destinations and retain their content apart from path updates.
- No generated skill, reference submodule, or implementation state is changed.

## Review and verification progress

- Scope compliance: passed against all six acceptance criteria.
- Scout: completed for script consumers, feature path collisions, missing targets, and repeat handoffs.
- Regression reproduction: nested stories were copied to both repositories before the sync fix.
- Sync regression suite: passed after the fix, including repeat sync and force preservation.
- Sprint tracker suite: 9 tests passed with feature-local fixture paths.
- Handoff validator suite: 15 tests passed at the final feature-local path.
- Customization resolution: 112 checks passed across both projects and both skill installations.
- Link preservation: 77 previously valid Markdown links remained valid.
- Root artifact checks and git diff whitespace checks: passed in both projects.
- Code-quality review: passed with no important findings.
- Final checks after review: passed for sync routing, sprint generation, handoff validator tests, and whitespace.
- Existing contract-copy validation fails because parent and child packages differ.
  Do not overwrite child contracts or publish planning mirrors in this task.

## Rollback details

Use the recorded move map and original checksums to reverse this task's file moves and path edits.
Keep unrelated working-tree edits intact.

The initial migration evidence records the first mechanical pass.
The final move map also places the handoff validator and its tests in the Workflow Commander validation package.
See [the verification report](verification-report.md) for final locations and checks.
