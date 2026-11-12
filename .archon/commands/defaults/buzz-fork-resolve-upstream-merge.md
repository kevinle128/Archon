---
description: Merge the upstream block/buzz commit named by buzz-fork-upstream-resolve into the Buzz fork sync branch, resolve it in one merge commit (or commit a clean merge), and fix the local checks
argument-hint: (none - reads $ARTIFACTS_DIR/sync/sync.json)
---

# Resolve the upstream merge in the Buzz fork

You work in a worktree of the Buzz fork (`kevinle128/buzz`), on the sync branch
that the workflow created. The workflow found the conflicted files with a trial
merge and then aborted it, so the worktree is clean. Your job is to make the real
merge so that the fork keeps **every** fork change **and** keeps every upstream
change, then to make the fork's local checks pass.

You never ask the user anything in this step. You never push. You never open,
edit or merge a pull request. You never run the full test suite.

## The worktree must be clean when you finish

The engine snapshots the worktree with a commit at the end of this step when
anything is left in it. The workflow then fails the run. So when you finish:

- either exactly one merge commit exists on the branch (see "Commit the merge"),
  with fix commits after it,
- or you ran `git merge --abort` and changed nothing,

and `git status --porcelain --untracked-files=all` prints nothing. Delete
scratch files you created. Never leave a merge in progress.

## Inputs

- `$ARTIFACTS_DIR/sync/sync.json`: `repo`, `issue`, `upstream_repo`,
  `upstream_sha`, `fork_ref` (the base branch: `main`, or a `sync-test/...-base`
  branch for a test), `base_sha` (the commit the branch starts from),
  `merge_base`, `branch`, `files` (the conflicted files of the trial merge),
  `kind` and `failed_checks`.
  - `kind: "conflict"`: the upstream merge conflicts in `files`.
  - `kind: "checks_failed"`: the upstream merge is clean (`files` is usually
    empty), but the fork's checks failed after it. `failed_checks` names the
    checks that the fork's sync job saw fail (for example `rust-fmt`,
    `rust-check`, `migration-numbers`). A clean merge can still drop or break fork
    code: issue kevinle128/buzz#41 came from merges that compiled no more.
- `$ARTIFACTS_DIR/sync/issue.md`: the conflict issue body. It is context only.

Read them first:

```bash
cat "$ARTIFACTS_DIR/sync/sync.json"
cat "$ARTIFACTS_DIR/sync/issue.md"
git status --short
```

## Fork context to read before you resolve

- `AGENTS.md` (`CLAUDE.md` points to it), `TESTING.md` and the `VISION*.md`
  files that match the conflicted areas.
- Issue kevinle128/buzz#41 (`gh issue view 41 --repo kevinle128/buzz`): earlier
  hand merges `06acab3ee` and `9e046f57f` took upstream files whole and dropped
  fork types, so the workspace did not compile. Never repeat that.
- The fork's restore merge `cdaae3cb9` (PR #44) shows which fork commits matter
  (external git hosts, the desktop updater CDN, fork migrations).

## Rules for this fork

1. **Every fork change survives.** For each conflicted file, read
   `git diff <merge_base> <base_sha> -- <file>` (what the fork changed since the
   merge base). Every change in that diff must still be in your result, adapted
   to upstream's new code when upstream moved it. Never take the upstream side of
   a file that the fork changed (`git checkout --theirs`), and never take the
   fork side of a file that upstream changed (`git checkout --ours`), without a
   stated reason in your notes.
2. **Migrations are never renamed.** The fork's migrations sort after upstream's
   (`migrations/0087_*.sql`, `0088_*.sql` today). When two migration files in one
   `migrations/` folder share a 4-digit version, or a fork migration no longer
   sorts after the newest upstream migration, do not rename, renumber or edit a
   migration: production databases record the version and the checksum. Stop
   (see "When you cannot decide"), and name the files and versions.
3. **Workflow files.** In `.github/workflows/`, keep upstream's jobs as upstream
   wrote them, and keep every fork-only file and fork-only step.
   `mf-desktop-build.yml` and the fork sync workflows (`fork-*.yml`) are
   fork-only.
4. **`Cargo.lock` and `pnpm-lock.yaml`.** Start from upstream's lock file and let
   the tools add the fork's dependencies: for `Cargo.lock` run
   `cargo metadata --format-version 1 >/dev/null` after the `Cargo.toml` files are
   resolved; for `pnpm-lock.yaml` run `pnpm install --lockfile-only`. Never edit a
   lock file by hand.
5. **Tools.** Use the fork's Hermit tools: run `. ./bin/activate-hermit` in each
   shell before `cargo`, `just`, `pnpm` or `node`. Never install a toolchain.
6. **No full suite.** Never run `just test`, `just check`, `cargo test` without
   `-p`, PostgreSQL, Playwright or mesh tests. CI on the pull request runs them.

## Start the merge

```bash
sync="$ARTIFACTS_DIR/sync/sync.json"
upstream_sha=$(jq -r .upstream_sha "$sync")
upstream_repo=$(jq -r .upstream_repo "$sync")
fork_ref=$(jq -r .fork_ref "$sync")
merge_base=$(jq -r .merge_base "$sync")
base_sha=$(jq -r .base_sha "$sync")
git merge --no-ff --no-commit "$upstream_sha"   # exits non-zero when files conflict
git diff --name-only --diff-filter=U            # the conflicted files
```

For `kind: "checks_failed"` the merge is clean and stops before the commit
because of `--no-commit`. Go to "Commit the merge" at once; you fix the failed
checks after the merge commit.

## Resolve each conflicted file

For every conflicted file:

1. Read the three versions: `git show :1:<file>` (merge base), `git show :2:<file>`
   (fork side), `git show :3:<file>` (upstream side). A missing stage means that
   side added or deleted the file.
2. Read why each side changed it:
   `git log --oneline "$merge_base..$upstream_sha" -- <file>` and
   `git log --oneline "$merge_base..$base_sha" -- <file>`, then
   `git show <commit> -- <file>` for the commits that matter, and
   `git diff "$merge_base" "$base_sha" -- <file>` for the full fork change.
3. Write a result that keeps upstream's change and every fork change (rule 1).
   Remove every conflict marker. `git diff --check` must be clean.
4. `git add -- <file>`.

## When you cannot decide

When the result needs a decision that the code and the history do not settle
(for example both sides rewrote the same function with different intent,
upstream removed a feature the fork extends, or a migration version clashes),
stop. Do not guess. Run `git merge --abort` (or, after the merge commit, leave
the branch as it is with no uncommitted change), check that
`git status --porcelain --untracked-files=all` prints nothing, and return
`resolved: false` with one precise reason that names the file, both intents,
and the options. The run then ends without a push and a human reads the reason
later.

## Write the resolution notes

Write `$ARTIFACTS_DIR/sync/resolution.md`:

- **one paragraph per conflicted file**. Start each paragraph with the file path
  in backticks, then state what upstream changed, what the fork had, and how the
  result keeps both;
- for `kind: "checks_failed"`, **one paragraph per check in `failed_checks`**.
  Start each paragraph with the check name in backticks (for example
  `` `rust-check` ``), then state what failed after the clean merge, why, and how
  the fix commits repair it without dropping fork or upstream code.

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

It activates Hermit itself, builds into this run's own cargo target, prints
`checks.json` (`passed`, `failed`, `ran`) and writes the output of each check to
`$ARTIFACTS_DIR/sync/checks.log`, one `===== <name> =====` section per check. It
puts back every file a check itself changed. The checks are `rust-fmt`,
`migration-numbers`, `rust-check` (`cargo check --workspace --all-targets
--locked`), `rust-clippy`, `rust-test:<crate>` (the lib tests of each crate you
touched) and, when the touched files need them, `desktop-install`,
`desktop-check`, `desktop-typecheck`, `desktop-test`, `desktop-tauri-check`,
`mobile-check` and `fork-script-tests`. When checks fail:

1. Read the sections of the failed checks. Find the cause and fix the code, not
   the check. A `rust-fmt` failure is fixed with `cargo fmt --all` (after
   `. ./bin/activate-hermit`). A `migration-numbers` failure is never fixed by a
   rename (rule 2): stop as in "When you cannot decide".
2. Rerun only the failed checks, by name (for example `rust-check`,
   `rust-test:buzz-relay`): `bash "$ARTIFACTS_DIR/sync/checks.sh" <name> [<name> ...]`.
   Apart from the lock file commands of rule 4 and `cargo fmt --all`, never run
   commands the script does not run.
3. Commit the fix as a new normal commit whose message names the check, for
   example `fix(sync): rust-check after upstream merge`. Never amend, never
   rebase, never push.

Stop when the checks pass or after the third fix round. Never change a test
expectation, skip a test, add `#[allow(...)]`, or weaken a lint rule to hide a
real regression. When the upstream change makes a fork test wrong, change the
test only when the new upstream behaviour is the intended behaviour, and say so
in the commit message. When a fix changes how a conflicted file was resolved,
update that file's paragraph in `$ARTIFACTS_DIR/sync/resolution.md`. Checks that
still fail after three rounds make the next workflow step end the run without a
push; still return `resolved: true` when the merge commit exists.

## Output

Return:

- `resolved`: `true` when the one merge commit exists, every conflicted file is
  resolved, and the worktree is clean; `false` when you cannot resolve it.
- `question`: an empty string when `resolved` is `true`; otherwise the one precise
  reason why the merge cannot be resolved (the run reports it on the issue).
