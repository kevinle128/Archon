---
description: Merge the upstream getpaseo/paseo commit named by paseo-fork-upstream-resolve into the Paseo fork sync branch and resolve it in one merge commit
argument-hint: (none - reads $ARTIFACTS_DIR/sync/sync.json)
---

# Resolve the upstream merge in the Paseo fork

You work in a worktree of the Paseo fork, on the sync branch that the workflow
created. The workflow found the conflicted files with a trial merge and then
aborted it, so the worktree is clean. Your job is to make the real merge and to
resolve it so that the fork keeps its own behaviour **and** keeps every upstream
change.

You never ask the user anything in this step. You never push. You never open,
edit or merge a pull request. You never run the full test suite.

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
- A "Human guidance" section at the end of these instructions, when present.

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
3. Write a result that keeps upstream's change and the fork's behaviour.
   - Never take one side of a file (`git checkout --ours/--theirs`) without a
     stated reason in your notes.
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
prints nothing, and return `resolved: false` with one precise question that names
the file, both intents, and the options.

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

## Quick self-check (bounded)

Run only cheap checks on the files you touched, through the workflow's check
script, for example a test file beside a conflicted file:

```bash
bash "$ARTIFACTS_DIR/sync/checks.sh" vitest:<path/to/file.test.ts>
```

The script puts back every file the check itself changed. The full local check
list runs in the next workflow step.
Never run `npm run test`, `npm test` or Playwright.

## Guidance pass

When a "Human guidance" section follows these instructions, a human has
reviewed an earlier pass. Then:

1. Check whether the merge commit exists:
   `git rev-list --merges --first-parent "$(jq -r .base_sha "$sync")..HEAD"`.
   - When it prints nothing (the first pass aborted), start the merge again from
     the branch head as described above, apply the guidance while you resolve,
     and create the one merge commit.
   - When it prints one commit, do not amend it. Make the changes the guidance
     asks for as new commits on top.
2. Update `$ARTIFACTS_DIR/sync/resolution.md` so every paragraph matches the
   final result.
3. Run the full local checks: `bash "$ARTIFACTS_DIR/sync/checks.sh"`. When checks
   fail, read `$ARTIFACTS_DIR/sync/checks.log`, fix only what the failed checks
   report, and rerun only the failed checks by name
   (`bash "$ARTIFACTS_DIR/sync/checks.sh" <name> ...`). Make at most 3 fix
   attempts. Commit each fix as a new commit whose message names the check.
   Never change a test expectation to hide a real regression.
4. Return `resolved: true` only when the merge commit exists and the worktree is
   clean. The workflow then runs every check again before it opens the pull
   request.

## Output

Return:

- `resolved`: `true` when the one merge commit exists, every conflicted file is
  resolved, and the worktree is clean; `false` when a human must decide (after
  `git merge --abort`).
- `question`: an empty string when `resolved` is `true`; otherwise one precise
  question for the human.
