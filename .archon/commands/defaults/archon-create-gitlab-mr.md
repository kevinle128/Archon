---
description: Commit, push the run branch, and open (or reuse) a GitLab merge request written with the ak-ship skill
argument-hint: (none - reads $ARTIFACTS_DIR/gitlab-fix-bug/target.json written by the setup node)
---

# Create GitLab Merge Request

You are the only step of this run that may commit, push, or create a merge
request. Ship the verified fix in this worktree as a GitLab merge request.

## Hard rules

- Never merge. Never call the GitLab `/merge` endpoint, never set
  `merge_when_pipeline_succeeds` or auto-merge, never approve the merge request.
- Push only the current worktree branch to `origin`. Never force-push, never
  rebase, never push to the target branch, never delete a remote branch.
- Never print, echo, or log `$GITLAB_TOKEN`, and never put a token in a URL or
  in a git remote. Git authenticates through the host's credential helper.
  Never print `git remote get-url origin` (an Archon clone URL can hold a token).
- Never use `--no-verify`. If a commit hook fails, fix the cause and commit again.
- The target branch is `base` from `target.json`. Do not use `$BASE_BRANCH` and do
  not infer the target from `$ARGUMENTS` or the branch name.
- When a step fails, stop and fail this node with the exact reason. Do not print
  a merge request URL that the GitLab API did not return.

## Inputs

Read these before you act:

- `$ARTIFACTS_DIR/gitlab-fix-bug/target.json` — `gitlab_url`, `project_path`,
  `project_id`, `iid`, `base`, `base_sha`, `branch`, `title`, `web_url`
- `$ARTIFACTS_DIR/gitlab-fix-bug/issue.md` — the issue
- `$ARTIFACTS_DIR/investigation.md`, `$ARTIFACTS_DIR/regression-test.md`,
  `$ARTIFACTS_DIR/implementation.md`, `$ARTIFACTS_DIR/review.md`,
  `$ARTIFACTS_DIR/validation.md`

```bash
T="$ARTIFACTS_DIR/gitlab-fix-bug/target.json"
GITLAB_API="$(jq -r .gitlab_url "$T")/api/v4"
PROJECT_ID=$(jq -r .project_id "$T")
IID=$(jq -r .iid "$T")
TARGET=$(jq -r .base "$T")
ISSUE_TITLE=$(jq -r .title "$T")
BRANCH=$(git branch --show-current)
```

Every GitLab API call sends the token on stdin through `curl --config -`, so it
never appears in the process list or in the output:

```bash
gitlab() {  # usage: gitlab <METHOD> <path> [json-body-file]
  local method=$1 path=$2 body=${3:-}
  printf 'header = "PRIVATE-TOKEN: %s"\n' "$GITLAB_TOKEN" | curl --silent --show-error \
    --config - --request "$method" --header 'Content-Type: application/json' \
    ${body:+--data-binary "@$body"} \
    --output "$ARTIFACTS_DIR/gitlab-fix-bug/api-response.json" --write-out '%{http_code}' \
    "$GITLAB_API$path"
}
```

Treat any HTTP status other than 200/201 as a failure; report the status and
the `message` field of `api-response.json`.

## Use the ak-ship skill

Load the `ak-ship` skill and read `SKILL.md`, `references/ship-workflow.md`, and
`references/pr-template.md`. Follow it for the commit message, the pre-ship
checks it requires, and the merge request description structure. This run is
headless: decide yourself, do not ask the user.

Map the ak-ship steps to this run as follows:

| ak-ship step | In this run |
|---|---|
| 1 Pre-flight | Run it, but without mode detection: the target is `TARGET`. Abort if `BRANCH` equals `TARGET`. Record the ship scope from `git status` and `git diff --stat`. |
| 2 Link issues | Skip the `gh` issue search and creation. The linked issue is `#$IID` from `target.json`. |
| 3 Merge target | Run it after Step 10 (git cannot merge into uncommitted changes). See "Sync with the target" below. |
| 4 Run tests | `validation.md` is same-revision evidence. Rerun the regression test and the touched tests only when Step 5 changed code or the target merge brought new commits. |
| 5 Review | When `$ARTIFACTS_DIR/review.md` exists (an earlier `ak-code-review` node reviewed this exact change and `validation.md` was produced after it), use it as the review evidence. Otherwise, or when Step 3 merged new commits, delegate a two-pass review of the diff against `origin/$TARGET` to a fresh-context `code-reviewer` subagent when one is available, or do the two passes yourself. Record which review ran. Fix critical findings inside the fix scope and rerun the affected tests. |
| 6–9, 9b Version, changelog, journal, docs, plan | Skip. A bug-fix merge request does not bump versions or write journals. |
| 10 Commit | Run it. See "Commit" below. |
| 11 Push | Run it. See "Push" below. |
| 12 Create PR | Skip the GitHub commands (`gh pr create`, `gh pr edit`, `gh pr view`). Render the body from `references/pr-template.md`, then use the GitLab API below. |
| 12b, 13, 14 Plan link, review/merge, social | Skip. |

Write the merge request title and description in Vietnamese (plain, complete sentences; keep code, paths,
commands, identifiers and the `Closes #$IID` line as they are). The team reads merge requests in Vietnamese. Keep
the ak-ship section structure, with Vietnamese headings: `## Tóm tắt`, `## Bằng chứng hoàn thành`,
`## Issue liên quan`, `## Chế độ ship`. Record `Writing language: vi (source: workflow rule)` in the last section.
The commit message stays in English (conventional commit).

## Commit

0. Leave the engine's `archon evidence: <node> start|end` commits as they are; they are part of the workflow
   engine. Do not rewrite, squash or drop them locally; the merge request is created with `squash: true`, so
   GitLab folds every commit of the branch into one when it is merged. The fix may already be inside them; commit only what is still
   uncommitted.
1. Stage only the files that belong to the fix, by name: `git add -- <path> ...`.
   Never `git add -A`, `git add .`, or `git add -u`.
2. Never stage scratch or run files: anything under `$ARTIFACTS_DIR`,
   `.archon/artifacts/`, `.archon/logs/`, `.archon/state/`, `pr-body.md`,
   `mr-body.md`, `*.scratch.md`, `*.tmp.md`, `*-report.md` at the repository root.
3. If nothing is staged and `git diff --quiet "$BASE_SHA" HEAD` shows no change against the base either, fail with:
   `No changes to commit: the worktree has no fix for issue #$IID.` If the fix is already in evidence commits and
   nothing is left to stage, skip the commit and push.
4. Scan the staged diff for secrets (tokens, keys, passwords). If you find one,
   unstage it and fail.
5. Commit with a conventional commit message in English:
   `fix(<scope>): <what the fix does>`, a short body that states the cause, and the
   trailer line `Closes #$IID`. No AI or tool references, no `Co-Authored-By` lines.

## Sync with the target

```bash
git fetch --quiet origin "+refs/heads/$TARGET:refs/remotes/origin/$TARGET"
```

If `origin/$TARGET` has commits that are not in `HEAD`, run
`git merge --no-edit "origin/$TARGET"`. On a conflict, run `git merge --abort`
and fail with the list of conflicting files. After a merge, rerun the
regression test and the touched tests (ak-ship Step 4).

## Push

```bash
git push -u origin "HEAD:refs/heads/$BRANCH" 2>&1 | sed -E 's#://[^@/]+@#://[REDACTED]@#g'
```

Check the exit status of `git push` itself (use `set -o pipefail` or
`${PIPESTATUS[0]}`). If the push is rejected:

- non-fast-forward or `fetch first`: someone else changed the remote branch.
  Do not force, rebase, or pull. Fail with the redacted git output.
- authentication or permission error (401/403, `could not read Username`):
  fail and say that the host git credential helper has no valid credentials for
  the GitLab host.
- anything else: fail with the redacted git output.

## Create or reuse the merge request

1. Look for an open merge request for this source branch:

   ```bash
   gitlab GET "/projects/$PROJECT_ID/merge_requests?state=opened&source_branch=$(jq -rn --arg b "$BRANCH" '$b|@uri')"
   ```

2. Write the description to `$ARTIFACTS_DIR/gitlab-fix-bug/mr-body.md` (never
   inside the worktree). It is the ak-ship body from `references/pr-template.md`,
   filled with evidence only:
   - End-to-end work summary: the issue, the root cause, and the fix
     (`investigation.md`, `implementation.md`).
   - Completion evidence: the regression test before and after the fix, and each
     verification command with its result (`regression-test.md`,
     `validation.md`). If no test framework covers the touched code, say so and
     list the build/lint evidence.
   - Linked Issues: the line `Closes #$IID` as live text on its own line — not in
     a code fence, inline code, or an HTML comment.
   - Ship Mode: `Target: $TARGET`.

3. Build the JSON request body with `jq` from that file:

   ```bash
   jq -n --arg source "$BRANCH" --arg target "$TARGET" \
     --arg title "fix: <tóm tắt bản sửa bằng tiếng Việt>" --rawfile description "$ARTIFACTS_DIR/gitlab-fix-bug/mr-body.md" \
     '{source_branch: $source, target_branch: $target, title: $title,
       description: $description, remove_source_branch: true, squash: true}' \
     > "$ARTIFACTS_DIR/gitlab-fix-bug/mr-request.json"
   ```

4. No open merge request: `gitlab POST "/projects/$PROJECT_ID/merge_requests" "$ARTIFACTS_DIR/gitlab-fix-bug/mr-request.json"`.
   An open one exists: reuse it. Update its description and title with
   `gitlab PUT "/projects/$PROJECT_ID/merge_requests/<mr iid>" <body file>`
   (drop `source_branch` from the body for the update). Do not create a second one.

5. Read the merge request back with
   `gitlab GET "/projects/$PROJECT_ID/merge_requests/<mr iid>"` and confirm:
   `state` is `opened`, `source_branch` is `BRANCH`, `target_branch` is `TARGET`,
   `squash` is `true` (GitLab squashes the branch, engine evidence commits included, into one commit when a
   person merges), and the live `description` contains `Closes #$IID` outside a code fence. Fix and update if not.

6. Save the result:

   ```bash
   cp "$ARTIFACTS_DIR/gitlab-fix-bug/api-response.json" "$ARTIFACTS_DIR/gitlab-fix-bug/mr.json"
   jq -r .web_url "$ARTIFACTS_DIR/gitlab-fix-bug/mr.json" > "$ARTIFACTS_DIR/.pr-url"
   jq -r .iid "$ARTIFACTS_DIR/gitlab-fix-bug/mr.json" > "$ARTIFACTS_DIR/.pr-number"
   ```

## Output

Print a short ak-ship style summary, with the merge request URL on its own line:

```
Committed: <commit subject>
Pushed: origin/<branch>
Merge request: <web_url from the API>  (created | reused)
Target: <TARGET>   Linked: Closes #<iid>
Review: <ak-code-review node | code-reviewer subagent | inline two-pass> — <outcome>
Merge: not requested (this workflow never merges)
```

Then return the structured result: `pr_url` is the `web_url` from the GitLab API,
`mr_iid` is the merge request iid, `source_branch`, `target_branch`, `commit_sha`
(`git rev-parse HEAD` after the push), and `reused` (true when an open merge
request already existed).
