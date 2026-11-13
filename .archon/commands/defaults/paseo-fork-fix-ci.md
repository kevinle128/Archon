---
description: Fix the failed CI checks of the Paseo fork sync pull request from their logs and push new commits
argument-hint: (none - reads $ARTIFACTS_DIR/sync/ci.json and pr.json)
---

# Fix the failed CI checks of the sync pull request

The workflow opened the sync pull request and its CI failed. Fix only what the
failed checks report, then push new commits to the same branch. The workflow
merges the pull request after its CI passes; you never merge it.

You never ask the user anything in this step.

## Inputs

```bash
cat "$ARTIFACTS_DIR/sync/sync.json"   # repo, branch, fork_ref, upstream_sha, files
cat "$ARTIFACTS_DIR/sync/pr.json"     # pr_url, number
cat "$ARTIFACTS_DIR/sync/ci.json"     # conclusion, failed (check names), checks_url, attempt
```

## Read the failed logs

```bash
repo=$(jq -r .repo "$ARTIFACTS_DIR/sync/sync.json")
number=$(jq -r .number "$ARTIFACTS_DIR/sync/pr.json")
gh pr checks "$number" --repo "$repo" --json name,bucket,link
```

The `link` of a GitHub Actions check has the form
`https://github.com/<repo>/actions/runs/<run-id>/job/<job-id>`. For each failed
check, read its failed steps:

```bash
gh run view <run-id> --repo "$repo" --log-failed
```

Read only the logs of the checks in `failed`.

## Fix

1. Find the cause in the log. Fix the code, not the check.
2. Run the matching local checks through the workflow's check script, for example
   `typecheck`, `lint`, `format-check`, `build-server`, `fork-script-tests` or a
   single test file:

   ```bash
   bash "$ARTIFACTS_DIR/sync/checks.sh" <name> [<name> ...]
   bash "$ARTIFACTS_DIR/sync/checks.sh" vitest:<path/to/file.test.ts>
   ```

   Never run `npm run test`, `npm test` or Playwright locally; CI runs the full
   suite. When a failure has no local check (for example an end-to-end job), fix
   it from the log alone.
3. Commit each fix as a new commit whose message names the CI check. Never
   amend, never rebase.
4. Push to the sync branch, without force:

   ```bash
   branch=$(jq -r .branch "$ARTIFACTS_DIR/sync/sync.json")
   git push origin "HEAD:refs/heads/$branch"
   ```

## Rules

- Never change a test expectation, skip a test, or disable a check to hide a real
  regression.
- Never force-push, never delete a branch, never merge or close the pull request,
  and never close the issue.
- When a fix changes how a conflicted file was resolved, update that file's
  paragraph in `$ARTIFACTS_DIR/sync/resolution.md`.
- When the failure is not caused by this merge (for example a flaky or broken
  check on the base branch), make no change and say so in your final message.

## Leave the worktree clean

The engine snapshots the worktree with a commit when a step leaves anything in
it, and the workflow then fails the run. Commit and push every change you keep,
delete scratch files, and finish with
`git status --porcelain --untracked-files=all` printing nothing.

The workflow waits for the new CI run after this step.
