---
description: Resolve the upstream getpaseo/paseo merge that paseo-fork-upstream-resolve started in the Paseo fork
argument-hint: (none - reads $ARTIFACTS_DIR/sync/sync.json)
---

# Resolve the upstream merge in the Paseo fork

You work in a worktree of the Paseo fork. The workflow has already created the
sync branch and started `git merge --no-ff --no-commit <upstream_sha>`. Your job
is to finish that merge so that the fork keeps its own behaviour **and** keeps
every upstream change.

You never ask the user anything in this step. You never push. You never open,
edit or merge a pull request. You never run the full test suite.

## Inputs

- `$ARTIFACTS_DIR/sync/sync.json`: `repo`, `issue`, `upstream_repo`,
  `upstream_sha`, `fork_ref`, `fork_sha`, `merge_base`, `branch`, `files` (the
  conflicted files of this merge; an empty list means the merge was clean).
- `$ARTIFACTS_DIR/sync/issue.md`: the conflict issue body. It is context only;
  the conflicted files come from the merge itself.
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

## Resolve each conflicted file

For every file in `files`:

1. Read the three versions: `git show :1:<file>` (merge base), `git show :2:<file>`
   (fork side), `git show :3:<file>` (upstream side). A missing stage means that
   side added or deleted the file.
2. Read why each side changed it:
   `git log --oneline <merge_base>..<upstream_sha> -- <file>` and
   `git log --oneline <merge_base>..origin/<fork_ref> -- <file>`, then
   `git show <commit> -- <file>` for the commits that matter.
3. Write a result that keeps upstream's change and the fork's behaviour.
   - Never take one side of a file (`git checkout --ours/--theirs`) without a
     stated reason in your notes.
   - Keep upstream workflow files (`.github/workflows/*` that came from upstream)
     as upstream wrote them, unless the fork changed the same lines.
   - Keep the fork's pinned-grid behaviour unless upstream removed the code it
     depends on; then port it to upstream's new structure.
   - Remove every conflict marker. `git diff --check` must be clean.
4. `git add <file>`.

When the result needs a decision that the code and the history do not settle
(for example both sides rewrote the same function with different intent, or
upstream removed a feature the fork extends), stop. Do not guess. Leave the merge
uncommitted and return `resolved: false` with one precise question that names the
file, both intents, and the options.

## Write the resolution notes

Write `$ARTIFACTS_DIR/sync/resolution.md` with **one paragraph per conflicted
file**. Start each paragraph with the file path in backticks, then state what
upstream changed, what the fork had, and how the result keeps both, in the style
of merge `0f4d72804`. When `files` is empty, write the single line
`No conflicts: the upstream merge was clean.`

This file becomes part of the pull request body.

## Commit the merge

When every file is resolved and staged:

```bash
git diff --name-only --diff-filter=U   # must print nothing
git commit --no-edit                   # the merge commit, with two parents
git log -1 --format='%H %P'
```

Do not amend earlier commits. Do not rebase. Do not push.

## Quick self-check (bounded)

Run only cheap checks on the files you touched, through the workflow's check
script, for example a test file beside a conflicted file:

```bash
bash "$ARTIFACTS_DIR/sync/checks.sh" vitest:<path/to/file.test.ts>
```

The full local check list runs in the next workflow step.
Never run `npm run test`, `npm test` or Playwright.

## Guidance pass

When a "Human guidance" section follows these instructions, a human has
reviewed an earlier pass. Then:

1. The merge may be committed already (`git rev-parse -q --verify MERGE_HEAD`
   prints nothing). Do not amend it. Make the changes the guidance asks for as
   new commits on the sync branch. When the merge is still in progress, finish it
   as described above, applying the guidance.
2. Update `$ARTIFACTS_DIR/sync/resolution.md` so every paragraph matches the
   final result.
3. Run the full local checks: `bash "$ARTIFACTS_DIR/sync/checks.sh"`. When checks
   fail, read `$ARTIFACTS_DIR/sync/checks.log`, fix only what the failed checks
   report, and rerun only the failed checks by name
   (`bash "$ARTIFACTS_DIR/sync/checks.sh" <name> ...`). Make at most 3 fix
   attempts. Commit each fix as a new commit whose message names the check.
   Never change a test expectation to hide a real regression.
4. Return `resolved: true` only when the merge is committed. The workflow then
   runs every check again before it opens the pull request.

## Output

Return:

- `resolved`: `true` when the merge commit exists and every conflicted file is
  resolved; `false` when a human must decide.
- `question`: an empty string when `resolved` is `true`; otherwise one precise
  question for the human.
