# Feature Artifact Folder Verification

## Scope and result

The cleanup covers parent-owned artifacts in workflow-engine and agentic-os-plan.
It does not change child implementation state, product requirements, or generated skills.
No real planning sync, commit, or push was run.

| Workspace       | Workflow overrides | Files moved |
| --------------- | -----------------: | ----------: |
| workflow-engine |                 28 |          70 |
| agentic-os-plan |                 28 |         200 |

Each override loads the shared feature policy through supported BMad customization fields.
The policy selects one feature before discovery and binds its planning, story, test, and sprint-status paths.
It rejects mixed requirements and epics before a readiness score is calculated.
These are workflow instructions, not a filesystem access control.

Existing named feature packages remain in use.
Loose reports, proposals, research, and implementation records now have named owners.
Shared roadmaps have named roadmap packages.
The final [move map](moves.json) records each source and destination.

## Checks

- 112 customization resolutions passed across both projects and both skill installations.
- All 56 overrides use exposed fields.
- Eight existing overrides retain their prior facts and hooks, apart from the required feature-scope and path corrections.
- All 270 moved files have a unique destination and a verified original copy.
- All 77 previously valid local Markdown links remain valid.
- Both changed YAML records preserve state and data.
  Their 316 changed scalar values are path references only.
- No loose feature files remain at the planning, implementation, or brainstorming roots.
- Both parent git diff whitespace checks passed.
- The source-control handoff dry run resolves all eight manifest entries.
- Read-only code review found no important regressions.

Focused test commands:

```sh
# In agentic-os-plan
bash scripts/sync-plans-to-harnesses.test.sh
node --test scripts/generate-sprint-status.test.mjs

# In workflow-engine
python3 -m unittest discover -s _bmad-output/planning-artifacts/epics-hermes-workflow/validation/tests -p 'test_*.py'
bash scripts/sync-subproject.sh --dry-run archon source-control
```

The sync regression test first reproduced a nested story reaching the wrong repository.
The fixed script retains feature-relative paths and routes each story to exactly one declared target.
The suite covers equal story names in different features, new nested stories, invalid targets, repeat handoff, and force preservation.
The sprint tracker suite has nine passing tests.
The handoff validator suite has 15 passing tests.

## Existing limitation

The parent Workflow Commander contract check still fails with 58 findings about divergent, missing, or extra child contract files.
This failure existed before the cleanup.
The contract package itself has no diff from this task.
Reconciling those contracts requires a separate review of the parent and child versions.
No contract copy was overwritten to hide the failure.

## Recovery

Original copies are in `/var/folders/84/5njq4pvs747b3zzntvtgtpl80000gn/T/bmad-feature-folders-3313qg3t`.
The [initial migration evidence](migration-evidence.json) records their checksums and the first-pass output checksums.
The final move map takes precedence for the validator and test locations.
Reverse only this task's moves and edits when restoring files.
Do not reset either working tree or restore unrelated files from the temporary backup.
