---
description: Fix the failed CI checks of the Buzz fork sync pull request from their logs and push new commits
argument-hint: (none - reads $ARTIFACTS_DIR/sync/ci.json and pr.json)
---

# Fix the failed CI checks of the sync pull request

The workflow opened the sync pull request, its CI failed, and one re-run of the
failed jobs failed again. Fix only what the failed checks report, then push new
commits to the same branch. The workflow merges the pull request after its CI passes; you
never merge it.

You never ask the user anything in this step.

## Inputs

```bash
cat "$ARTIFACTS_DIR/sync/sync.json"   # repo, branch, fork_ref, upstream_sha, files, kind
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

1. Find the cause in the log. Fix the code, not the check. Every fork change
   must survive (issue kevinle128/buzz#41): never fix a build by taking upstream's
   version of a fork file.
2. Run the matching local checks through the workflow's check script (it
   activates Hermit and uses this run's own cargo target), for example
   `rust-fmt`, `rust-check`, `rust-clippy`, `rust-test:<crate>`,
   `migration-numbers`, `desktop-typecheck`, `desktop-test` or `mobile-check`:

   ```bash
   bash "$ARTIFACTS_DIR/sync/checks.sh" <name> [<name> ...]
   ```

   Never run `just test`, `just check`, `cargo test` without `-p`, PostgreSQL,
   Playwright or mesh tests locally; CI runs them. When a failure has no local
   check (for example a PostgreSQL or end-to-end job), fix it from the log alone.
   A migration version clash is never fixed by a rename: make no change and say
   so in your final message.
3. Commit each fix as a new commit whose message names the CI check. Never
   amend, never rebase.
4. Read the pull request state right before you push. Push only when it is
   `OPEN`: a human can still merge or close the pull request while you work, and
   then nothing may be pushed.

   ```bash
   branch=$(jq -r .branch "$ARTIFACTS_DIR/sync/sync.json")
   state=$(gh pr view "$number" --repo "$repo" --json state -q .state)
   if [ "$state" = OPEN ]; then git push origin "HEAD:refs/heads/$branch"; fi
   ```

   Without force. When the state is not `OPEN`, do not push and say so in your
   final message.

## Rules

- Never change a test expectation, skip a test, add `#[allow(...)]`, or disable a
  check to hide a real regression.
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
