---
description: Fix the failed CI checks of the OpenMausBot fork sync pull request from their logs and push new commits
argument-hint: (none - reads $ARTIFACTS_DIR/sync/ci.json and pr.json)
---

# Fix the failed CI checks of the sync pull request

The workflow opened the sync pull request, its CI failed, and one re-run of the
failed jobs failed again. Fix every failure that the failed checks report, in this
one pass, then push new commits to the same branch. The workflow merges the pull request after its CI passes; you
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

Read the logs of every check in `failed`, not only the first one, and read each
log to its end, not only to the first error. A job can fail many tests (vitest
prints every failed test). Before you change code, write down the full list of
failing tests and errors of all failed jobs. Fix all of them in this pass: the
workflow allows only two fix passes, and a fix that leaves one known failure
costs a whole CI round.

## Fix

1. Find the cause in the log. Fix the code, not the check. Every fork change
   must survive: never fix a build by taking upstream's version of a fork file.
   The fork pins the Linux vitest and browser driver jobs of
   `.github/workflows/ci.yml` to `ubuntu-24.04`; when a job fails only on a newer
   Ubuntu image, check that the pin is still there before you change code.
2. Run the matching local checks through the workflow's check script (it sets up
   Node 24), for example `lint`, `typecheck`, `i18n`, `static-guards`, `test-electron`,
   `packaged-server`, `test-vitest` or `vitest:<test file>`:

   ```bash
   bash "$ARTIFACTS_DIR/sync/checks.sh" <name> [<name> ...]
   ```

   Run every check that matches a failed CI job, and run it again after your
   fixes until it passes. Never start the browser (Playwright) jobs yourself and
   never run the app. When a failure has no local check (for example a Linux-only
   or Windows job), fix it from the log alone.
3. A failing agent catalog golden is regenerated with the repository's golden
   command, never edited by hand; review the regenerated diff.
4. Commit each fix as a new commit whose message names the CI check. Never
   amend, never rebase.
5. Read the pull request state right before you push. Push only when it is
   `OPEN`: a human can still merge or close the pull request while you work, and
   then nothing may be pushed.

   ```bash
   branch=$(jq -r .branch "$ARTIFACTS_DIR/sync/sync.json")
   state=$(gh pr view "$number" --repo "$repo" --json state -q .state)
   if [ "$state" = OPEN ]; then git push origin "HEAD:refs/heads/$branch"; fi
   ```

   Without force. When the state is not `OPEN`, do not push and say so in your
   final message.

## Failures that are only timing

When every failure of a job is timing (a test or step that timed out, or a test
that passes on a re-run and fails on load, with no error from the merged code),
do not change code for it. Re-run that job once and wait until GitHub shows it
again as pending, so the workflow waits for the new result:

```bash
gh run rerun <run-id> --repo "$repo" --failed
for _ in $(seq 1 10); do
  gh pr checks "$number" --repo "$repo" --json bucket | jq -e 'any(.[]; .bucket == "pending")' >/dev/null && break
  sleep 30
done
```

Do this at most once per job, and fix the other failed jobs in the same pass.

## Rules

- Never delete a test, skip a test, mark it ignored, change a test expectation,
  raise a timeout or a tolerance, or disable a
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
