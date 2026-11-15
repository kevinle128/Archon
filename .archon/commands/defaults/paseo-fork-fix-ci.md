---
description: Fix the failed CI checks of the Paseo fork sync pull request from their logs and push new commits
argument-hint: (none - reads $ARTIFACTS_DIR/sync/ci.json and pr.json)
---

# Fix the failed CI checks of the sync pull request

The workflow opened the sync pull request, its CI failed, and one re-run of the
failed jobs failed again. Fix every failure that the failed checks report, in this
one pass, then push new commits to the same branch. The workflow merges the pull
request after its CI passes; you never merge it.

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

Read the logs of every check in `failed`, not only the first one, and read each
log to its end, not only to the first error. A job can fail many tests (vitest
prints every `FAIL` file and a summary; Playwright lists every failed spec; the
CLI runner prints every failed test file). Before you change code, write down
the full list of failing tests and errors of all failed jobs. Fix all of them in
this pass: the workflow allows only two fix passes, and a fix that leaves one
known failure costs a whole CI round.

## Fix

1. Find the cause in the log. Fix the code, not the check.
2. Run the matching local checks through the workflow's check script, for example
   `typecheck`, `lint`, `format-check`, `build-server`, `node-tests`, `test-server`
   (CI "server-tests"), `test-app` (CI "app-tests"), `test-desktop`,
   `test-cli-unit` or `test-cli-local` (CI "cli-tests"), `test-sdk`, `test-relay`,
   `e2e-app` (the app Playwright specs related to the changed files),
   `e2e-website`, or a single test file:

   ```bash
   bash "$ARTIFACTS_DIR/sync/checks.sh" <name> [<name> ...]
   bash "$ARTIFACTS_DIR/sync/checks.sh" vitest:<path/to/file.test.ts>
   ```

   The checks after `build-server` test its output: after a source change, put
   `build-server` first, for example `checks.sh build-server test-server`. Run
   every check that matches a failed CI job, and run it again after your fixes
   until it passes. Never run `npm run test`, `npm test`, vitest suites or
   Playwright yourself; use the check script. When a failure has no local check
   (for example a Linux-only desktop E2E step or a Windows job), fix it from the
   log alone.
3. Commit each fix as a new commit whose message names the CI check. Never
   amend, never rebase.
4. Read the pull request state right before you push. Push only when it is
   `OPEN`:

   ```bash
   gh pr view "$number" --repo "$repo" --json state -q .state
   branch=$(jq -r .branch "$ARTIFACTS_DIR/sync/sync.json")
   git push origin "HEAD:refs/heads/$branch"
   ```

   Without force. When the state is not `OPEN`, do not push and say so in your
   final message.

## Linux snapshot baselines

CI runs the app Playwright specs on Linux. When a spec fails on a screenshot
comparison after the merge, a new Linux baseline must come from CI's own render:
download the failing shard's `playwright-results-<N>` artifact of the failed run
(it holds `packages/app/test-results/`) and take the `*-actual.png` of that test:

```bash
gh run download <run-id> --repo "$repo" --name playwright-results-<N> --dir "$ARTIFACTS_DIR/sync/ci-artifacts"
```

Use that file as the `-linux.png` baseline only after you checked in its diff
image that the change is the one the merge intended. Never make a Linux baseline
from a local render on this machine (it is macOS), and delete the downloaded
folder when you are done.

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

- Never delete a test, skip a test, mark it skipped (`.skip`, `test.fixme`),
  change a test expectation, raise a timeout, pixel or ratio tolerance, or
  disable a check to hide a real regression.
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
