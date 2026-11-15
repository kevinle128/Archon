---
description: Merge the upstream getpaseo/paseo commit named by paseo-fork-upstream-resolve into the Paseo fork sync branch, resolve it in one merge commit, and fix the local checks
argument-hint: (none - reads $ARTIFACTS_DIR/sync/sync.json)
---

# Resolve the upstream merge in the Paseo fork

You work in a worktree of the Paseo fork, on the sync branch that the workflow
created. The workflow found the conflicted files with a trial merge and then
aborted it, so the worktree is clean. Your job is to make the real merge and to
resolve it so that the fork keeps its own behaviour **and** keeps every upstream
change.

You never ask the user anything in this step. You never push. You never open,
edit or merge a pull request. You run tests only through the workflow's check
script: never run `npm run test`, `npm test`, vitest suites or Playwright
yourself.

## The worktree must be clean when you finish

The engine snapshots the worktree with a commit at the end of this step when
anything is left in it. The workflow then fails the run. So when you finish:

- either exactly one merge commit exists on the branch (see "Commit the merge"),
- or you ran `git merge --abort` and changed nothing,

and `git status --porcelain --untracked-files=all` prints nothing. Delete
scratch files you created. Never leave a merge in progress.

## Inputs

- `$ARTIFACTS_DIR/sync/sync.json`: `repo`, `issue`, `upstream_repo`,
  `upstream_sha`, `fork_ref`, `base_sha` (the commit the branch starts from),
  `merge_base`, `branch`, `files` (the conflicted files of the trial merge; an
  empty list means the merge is clean).
- `$ARTIFACTS_DIR/sync/issue.md`: the conflict issue body. It is context only.

Read them first:

```bash
cat "$ARTIFACTS_DIR/sync/sync.json"
cat "$ARTIFACTS_DIR/sync/issue.md"
git status --short
```

## Fork context to read before you resolve

- `docs/pinned-grid.md`: the fork's main feature (the pinned grid). Most fork
  changes exist to keep it working on top of upstream.
- `docs/testing.md`: how tests run in this repository.
- `CLAUDE.md` and `AGENTS.md` when they exist.
- The fork's earlier resolution, merge `0f4d72804` ("Keep the pinned grid on top
  of upstream's changes"): `git show --stat 0f4d72804` and its commit message are
  the model for your notes.

## Start the merge

```bash
sync="$ARTIFACTS_DIR/sync/sync.json"
upstream_sha=$(jq -r .upstream_sha "$sync")
upstream_repo=$(jq -r .upstream_repo "$sync")
fork_ref=$(jq -r .fork_ref "$sync")
git merge --no-ff --no-commit "$upstream_sha"   # exits non-zero when files conflict
git diff --name-only --diff-filter=U            # the conflicted files
```

## Resolve each conflicted file

For every conflicted file:

1. Read the three versions: `git show :1:<file>` (merge base), `git show :2:<file>`
   (fork side), `git show :3:<file>` (upstream side). A missing stage means that
   side added or deleted the file.
2. Read why each side changed it:
   `git log --oneline <merge_base>..<upstream_sha> -- <file>` and
   `git log --oneline <merge_base>..<base_sha> -- <file>`, then
   `git show <commit> -- <file>` for the commits that matter.
3. Write a result that keeps upstream's change and the fork's behaviour, hunk by
   hunk.
   - For a file that both sides changed, never take one whole side: not
     `git checkout --ours/--theirs`, not a copy of `git show :2:<file>` or
     `:3:<file>`. Merge each hunk.
   - Keep every fork export, component, hook, type, function and call site that
     fork code outside the conflicted files still uses. Find the users with
     `git grep -n -w '<name>' -- packages` before you stage the file. When
     upstream moved the code around a fork item, port the item instead of
     dropping it.
   - Keep upstream workflow files (`.github/workflows/*` that came from upstream)
     as upstream wrote them, unless the fork changed the same lines.
   - Keep the fork's pinned-grid behaviour unless upstream removed the code it
     depends on; then port it to upstream's new structure.
   - Remove every conflict marker. `git diff --check` must be clean.
4. `git add -- <file>`.

When the result needs a decision that the code and the history do not settle
(for example both sides rewrote the same function with different intent, or
upstream removed a feature the fork extends), stop. Do not guess. Run
`git merge --abort`, check that `git status --porcelain --untracked-files=all`
prints nothing, and return `resolved: false` with one precise reason that names
the file, both intents, and the options. The run then ends without a push and a
human reads the reason later.

## Write the resolution notes

Write `$ARTIFACTS_DIR/sync/resolution.md` with **one paragraph per conflicted
file**. Start each paragraph with the file path in backticks, then state what
upstream changed, what the fork had, and how the result keeps both, in the style
of merge `0f4d72804`. When no file conflicts, write the single line
`No conflicts: the upstream merge was clean.`

This file is outside the worktree and becomes part of the pull request body.

## Commit the merge

When every file is resolved and staged, create exactly one merge commit, with
this message and two parents (the branch head and the upstream commit):

```bash
git diff --name-only --diff-filter=U   # must print nothing
git commit -m "Merge $upstream_repo ${upstream_sha:0:9} into $fork_ref"
git log -1 --format='%H %P %s'         # two parents; the second is upstream_sha
git status --porcelain --untracked-files=all   # must print nothing
```

The repository's pre-commit hook can run on this commit. When it fails, fix what
it reports, stage the fix and commit again; never bypass the hook. Do not amend
earlier commits. Do not rebase. Do not push. Changes after the merge commit are
normal commits.

## Run the local checks and fix failures (at most 3 rounds)

After the merge commit, run every local check with the workflow's check script:

```bash
bash "$ARTIFACTS_DIR/sync/checks.sh"
```

It prints `checks.json` (`passed`, `failed`, `warnings`, `ran`) and writes the
output of each check to `$ARTIFACTS_DIR/sync/checks.log`, one `===== <name> =====`
section per check. It puts back every file a check itself changed. A check that
runs longer than its time limit is stopped and has the status `timeout`.

A full run runs every test job of the fork's CI that also works on macOS:
`install`, `format-check`, `lint`, `dependency-checks` (lock file lint and npm
signatures), `build-server`, `typecheck`, `typecheck-examples`, `node-tests`
(every `node --test` file that `.github/workflows/ci.yml` names), `pack-check`,
`test-relay`, `test-sdk` (plugin, protocol, client and highlight), `test-website`,
`test-builtin-plugins`, `test-server`, `test-desktop`, `test-app`, `test-cli-unit`,
`test-cli-local` (every CLI E2E file), `e2e-app` (the app Playwright specs related
to the changed files, plus `workspace-lifecycle.spec.ts`) and, when a file under
`packages/website/` changed since the merge base, `e2e-website`. A full run takes
a long time: start it once, then rerun only failed checks by name. The checks
after `build-server` test its output, so after a source change put `build-server`
first (for example `build-server test-server`). `vitest:<path>` (one test file)
and `fork-script-tests` are quick reruns. When checks fail:

1. Read the sections of all failed checks, each to its end. A test job can fail
   many tests (vitest prints every `FAIL` file; Playwright lists every failed
   spec): list every failing test of every failed check before you change code,
   and fix them all in the same round. Find the cause and fix the code, not the
   check.
2. Rerun only the failed checks, by name (for example `typecheck`, `lint`,
   `build-server test-server`, `vitest:packages/app/src/foo.test.ts`):
   `bash "$ARTIFACTS_DIR/sync/checks.sh" <name> [<name> ...]`.
   Never run commands the script does not run.
   Never run `npm run test`, `npm test`, vitest suites or Playwright yourself.
3. Commit the fix as a new normal commit whose message names the check, for
   example `fix(sync): typecheck after upstream merge`. Never amend, never
   rebase, never push.

Stop when the checks pass or after the third fix round. Never delete or stub
out a fork feature to make a check pass, never delete a test, change a test
expectation, skip a test or mark it skipped, raise a timeout or a tolerance, or
weaken a lint rule to hide a real regression. When
the upstream change makes a fork test wrong, change the test only when the new
upstream behaviour is the intended behaviour, and say so in the commit message.
When a fix changes how a conflicted file was resolved, update that file's
paragraph in `$ARTIFACTS_DIR/sync/resolution.md`. Checks that still fail after
three rounds make the next workflow step end the run without a push; still
return `resolved: true` when the merge commit exists.

## Fix pass

When a "Fix pass" section follows these instructions, the merge commit already
exists and the workflow's final checks failed after it. Then:

1. Do not start or abort a merge, and do not amend or rebase. Every change is a
   new normal commit on the branch.
2. Read `$ARTIFACTS_DIR/sync/check-failure.txt` and the sections of all failed
   checks in `$ARTIFACTS_DIR/sync/checks.log`, each to its end, and list every
   failing test and error before you change code. Fix all of them in this pass.
3. Fix the causes with the rules above. Do not delete fork features to make the
   code compile: when a fork module, type, function, method or field is missing,
   restore it from `git show "$(jq -r .base_sha "$ARTIFACTS_DIR/sync/sync.json")":<file>`
   and adapt it to upstream's code.
4. Run `bash "$ARTIFACTS_DIR/sync/checks.sh" build-server typecheck` after your
   type fixes.
5. Run the failed checks again by name with `bash "$ARTIFACTS_DIR/sync/checks.sh" <name> ...`
   and repeat until they pass or you cannot make progress.
6. Update the paragraphs of `$ARTIFACTS_DIR/sync/resolution.md` that your fixes
   change.
7. Return `resolved: true` when the merge commit exists and the worktree is
   clean. The workflow runs the final checks again after this pass.

## Output

Return:

- `resolved`: `true` when the one merge commit exists, every conflicted file is
  resolved, and the worktree is clean; `false` when you cannot resolve it (after
  `git merge --abort`).
- `question`: an empty string when `resolved` is `true`; otherwise the one precise
  reason why the merge cannot be resolved (the run reports it on the issue).
