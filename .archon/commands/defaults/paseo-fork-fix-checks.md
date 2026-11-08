---
description: Fix the local checks that failed after the upstream merge in the Paseo fork
argument-hint: (none - reads $ARTIFACTS_DIR/sync/checks.json and checks.log)
---

# Fix failed local checks after the upstream merge

The upstream merge on the sync branch is committed. The workflow ran the fork's
local checks and some failed. Fix only what the failed checks report.

You never ask the user anything in this step. You never push. You never open,
edit or merge a pull request.

## Inputs

```bash
cat "$ARTIFACTS_DIR/sync/sync.json"      # repo, upstream_sha, fork_ref, branch, files
cat "$ARTIFACTS_DIR/sync/checks.json"    # passed, failed (check names), ran
cat "$ARTIFACTS_DIR/sync/resolution.md"  # one paragraph per conflicted file
```

`$ARTIFACTS_DIR/sync/checks.log` has the output of every check, one
`===== <name> =====` section per check. Read the sections of the failed checks.

## Fix loop (at most 3 attempts)

For each attempt:

1. Find the cause in the failed check's output. Fix the code, not the check.
2. Rerun only the failed checks, by name, with the workflow's check script:

   ```bash
   bash "$ARTIFACTS_DIR/sync/checks.sh" <name> [<name> ...]
   ```

   Names are the ones in `failed` (for example `typecheck`, `lint`,
   `vitest:packages/app/src/foo.test.ts`).
   Never run `npm run test`, `npm test` or Playwright.
   Never run commands the script does not run.
3. Commit the fix as a new commit whose message names the check, for example
   `fix(sync): typecheck after upstream merge`. Never amend, never rebase,
   never push.

Stop when the rerun passes or after the third attempt.

## Rules

- Never change a test expectation, skip a test, or weaken a lint rule to hide a
  real regression. When the upstream change makes a fork test wrong, change the
  test only when the new upstream behaviour is the intended behaviour, and say so
  in the commit message.
- Keep upstream's change and the fork's behaviour, as in the resolution.
- When a fix changes how a conflicted file was resolved, update that file's
  paragraph in `$ARTIFACTS_DIR/sync/resolution.md`.
- When the remaining failure needs a human decision, stop and say so in your
  final message. The workflow then asks a human.

## Leave the worktree clean

The engine snapshots the worktree with a commit when a step leaves anything in
it, and the workflow then fails the run. Commit every change you keep, delete
scratch files, and finish with `git status --porcelain --untracked-files=all`
printing nothing.

The workflow runs every check again after this step.
