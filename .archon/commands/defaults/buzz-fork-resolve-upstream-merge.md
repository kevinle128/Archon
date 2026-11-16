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
edit or merge a pull request. You run tests only through the workflow's check
script.

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

1. **Merge hunk by hunk; every fork change survives.** For a file that both
   sides changed, never take one whole side: not `git checkout --ours/--theirs`,
   not a copy of `git show :2:<file>` or `:3:<file>`, not "retained the upstream
   implementation" or "kept the fork version". Merge each hunk. For each
   conflicted file, read `git diff <merge_base> <base_sha> -- <file>` (what the
   fork changed since the merge base). Every change in that diff must still be in
   your result, adapted to upstream's new code when upstream moved it.
2. **Keep what other fork code uses.** Before you stage a file, list the items
   the fork side of it defines or changed (`mod` lines, types, traits, functions,
   methods, fields, enum variants, re-exports) and find their users outside the
   file: `git grep -n -w '<name>' -- crates desktop mobile`. Every item that fork
   code outside the conflicted files still uses must still exist in your result,
   with the same name and meaning, and every call site of fork code inside the
   file must stay. When upstream renamed or moved the code around a fork item,
   port the fork item to the new structure instead of dropping it.
3. **Migrations are never renamed.** The fork's migrations sort after upstream's
   (`migrations/0087_*.sql`, `0088_*.sql` today). When two migration files in one
   `migrations/` folder share a 4-digit version, or a fork migration no longer
   sorts after the newest upstream migration, do not rename, renumber or edit a
   migration: production databases record the version and the checksum. Stop
   (see "When you cannot decide"), and name the files and versions.
4. **Workflow files.** In `.github/workflows/`, keep upstream's jobs as upstream
   wrote them, and keep every fork-only file and fork-only step.
   `mf-desktop-build.yml` and the fork sync workflows (`fork-*.yml`) are
   fork-only.
5. **`Cargo.lock` and `pnpm-lock.yaml`.** Start from upstream's lock file and let
   the tools add the fork's dependencies: for `Cargo.lock` run
   `cargo metadata --format-version 1 >/dev/null` after the `Cargo.toml` files are
   resolved; for `pnpm-lock.yaml` run `pnpm install --lockfile-only`. Never edit a
   lock file by hand.
6. **Tools.** Use the fork's Hermit tools: run `. ./bin/activate-hermit` in each
   shell before `cargo`, `just`, `pnpm` or `node`. Never install a toolchain.
7. **Tests only through the check script.** Never run `just test`, `just check`,
   `cargo test` without `-p`, or mesh tests, and never start PostgreSQL, Redis or
   Playwright yourself. The check script runs upstream's unit and PostgreSQL test
   jobs (it starts and removes a throwaway PostgreSQL and Redis) and the related
   desktop E2E specs.

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
3. Write a result that keeps upstream's change and every fork change, hunk by
   hunk (rules 1 and 2). Remove every conflict marker. `git diff --check` must be
   clean.
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

## Build the crates you merged

After the merge commit, build each workspace crate that owns a conflicted file,
with its tests, and fix every error before you go on:

```bash
. ./bin/activate-hermit
cargo check --locked -p <crate> --tests   # for each crate under crates/ with a conflicted file
```

An error that names a fork item (a missing module, type, function, method or
field) means your result dropped fork code: put the fork item back from
`git show "$base_sha":<file>` and adapt it, never delete its users. Commit each
fix as a normal commit (see step 3 below).

## Run the local checks and fix failures (at most 3 rounds)

Then run every local check with the workflow's check script:

```bash
bash "$ARTIFACTS_DIR/sync/checks.sh"
```

It activates Hermit itself, builds into this run's own cargo target, prints
`checks.json` (`passed`, `failed`, `ran`) and writes the output of each check to
`$ARTIFACTS_DIR/sync/checks.log`, one `===== <name> =====` section per check. It
puts back every file a check itself changed. The checks are `rust-fmt`,
`migration-numbers`, `rust-check` (`cargo check --workspace --all-targets
--locked`), `rust-clippy`, `rust-test-unit` (upstream CI's "Unit Tests": `just
test-unit`), `rust-test-postgres` (upstream CI's "PostgreSQL Tests": every
PostgreSQL-backed test of the workspace, against a throwaway PostgreSQL),
`desktop-e2e` (the desktop Playwright smoke specs related to the changed files,
plus `smoke.spec.ts`) and, when the touched files need them, `desktop-install`,
`desktop-check`, `desktop-typecheck`, `desktop-test`, `desktop-tauri-check`,
`mobile-check` and `fork-script-tests`. A full run takes a long time (the Rust
tests build every test binary); start it once, then rerun only failed checks by
name. `rust-test:<crate>` (the lib tests of one crate) is a quick rerun. A
`desktop-e2e` result `warn` means a screenshot differs only from the macOS
baseline, which CI does not use: it does not fail the checks, and you never
change a `-darwin.png` file. When checks fail:

1. Read the sections of all failed checks, each to its end. A test job can fail
   many tests (nextest prints a `Summary` with every `FAIL` line): list every
   failing test of every failed check before you change code, and fix them all
   in the same round. Find the cause and fix the code, not the check. A `rust-fmt` failure is fixed with `cargo fmt --all` (after
   `. ./bin/activate-hermit`). A `migration-numbers` failure is never fixed by a
   rename (rule 3): stop as in "When you cannot decide".
2. Rerun only the failed checks, by name (for example `rust-check`,
   `rust-test-postgres`): `bash "$ARTIFACTS_DIR/sync/checks.sh" <name> [<name> ...]`.
   Apart from the lock file commands of rule 5, `cargo fmt --all` and
   `cargo check --locked -p <crate> --tests`, never run commands the script does
   not run.
3. Commit the fix as a new normal commit whose message names the check, for
   example `fix(sync): rust-check after upstream merge`. Never amend, never
   rebase, never push.

Stop when the checks pass or after the third fix round. Never delete or stub
out a fork feature (a module, type, function, call site, migration or test) to
make a check pass, never change a test expectation, skip a test, mark it
ignored, raise a timeout or a pixel tolerance, add `#[allow(...)]`, or weaken a
lint rule to hide a real regression. When the upstream change makes a fork test wrong, change the
test only when the new upstream behaviour is the intended behaviour, and say so
in the commit message. When a fix changes how a conflicted file was resolved,
update that file's paragraph in `$ARTIFACTS_DIR/sync/resolution.md`. Checks that
still fail after three rounds make the next workflow step end the run without a
push; still return `resolved: true` when the merge commit exists.

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
4. For each crate with a failing build or test, run
   `cargo check --locked -p <crate> --tests` until it builds.
5. Run the failed checks again by name with `bash "$ARTIFACTS_DIR/sync/checks.sh" <name> ...`
   and repeat until they pass or you cannot make progress.
6. Update the paragraphs of `$ARTIFACTS_DIR/sync/resolution.md` that your fixes
   change.
7. Return `resolved: true` when the merge commit exists and the worktree is
   clean. The workflow runs the final checks again after this pass.

## Output

Return:

- `resolved`: `true` when the one merge commit exists, every conflicted file is
  resolved, and the worktree is clean; `false` when you cannot resolve it.
- `question`: an empty string when `resolved` is `true`; otherwise the one precise
  reason why the merge cannot be resolved (the run reports it on the issue).
