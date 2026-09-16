---
name: github-issue-tracker
description: Create GitHub issues for tracked stories ONE BY ONE with a user-selected Archon workflow and consistent relationships. Use whenever you need to open a GitHub issue for a tracked story (e.g. "create issue", "open an issue for story X", "file the ticket"). Relationships (blocked-by) are read from the issue-map, NOT re-read from the epic each time. Always produces the same canonical shape (title, labels, milestone, Feature type, implementation workflow, native blocked-by edges) and records the issue back into the map. Do NOT hand-roll `gh issue create`; do NOT use the retired batch script sync-github-issues.py.
---

# GitHub Issue Tracker — one-by-one, relationship-aware

## What this solves

Ad-hoc `gh issue create` produces inconsistent issues (missing milestone, missing
Feature type, missing native blocked-by edges, not recorded anywhere). This skill
makes every issue identical in shape and wires relationships from a single source
of truth: the **issue-map**.

Two ideas:

1. The **issue-map** (`_bmad-output/implementation-artifacts/rm-02/github-issue-map.json`)
   is the source of truth for story -> issue mapping AND relationships (`blocked_by`).
2. Issue creation is **one-by-one** and reads relationships from the map — it never
   re-reads the epic. Build the map once; create issues against it forever.

The old `sync-github-issues.py` (batch-create with a hardcoded graph) has been
**removed**; this skill replaces it. Do not recreate a batch issue script.

## When to use

- The user says "create issue", "open an issue", "file a ticket" for a tracked story.
- You just finished planning/architecture for a story and want its GitHub issue.

## Prerequisites

- `gh` authenticated against the **target repo**. Default pack is RM-02 on `oceanlabs-holding/x10.gigo.harness-service`. Other boards pass `--repo`.
- Run from the repo that holds the sprint-status and issue-map (paths are repo-relative).
- `python3`.

## Procedure

### Step 1 — Ensure the issue-map exists and is complete

```
python .agents/skills/github-issue-tracker/scripts/build_issue_map.py
```

- Driven by `sprint-status.yaml` (the authoritative story list + epic + status).
- Seeds each story's `{epic, title, blocked_by}` from the curated relationship graph
  embedded in the builder (RM-02 default) **or** from `--seed PATH.json` for another board.
- Non-destructive: never overwrites `number`/`node_id`/`url`, and does not clobber a
  `blocked_by` you edited by hand (use `--reseed` to force blocked_by/title from seed).
- After generation, **edit relationships in the map**, not in the epic.
- `--dry-run` prints the map without writing.

Other board (example: Archon Source Control):

```
python .agents/skills/github-issue-tracker/scripts/build_issue_map.py \
  --status _bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml \
  --map _bmad-output/implementation-artifacts/archon-source-control/github-issue-map.json \
  --seed _bmad-output/implementation-artifacts/archon-source-control/issue-seed.json \
  --milestone 1
```

### Step 2 — Select the Archon implementation workflow

Before creating or adopting an issue, ask the user which Archon workflow should implement it.
Do not infer the workflow from the repository, epic, or a previous issue.
Pass the selected name with `--workflow <name>`.
If the user explicitly wants no Archon workflow, pass `--workflow ""`.
The CLI rejects an omitted `--workflow` so this decision cannot be skipped accidentally.

### Step 3 — Create the issue for one story

```
python .agents/skills/github-issue-tracker/scripts/create_issue.py \
  --story <story-id> \
  --workflow <selected-workflow>
```

It will:

1. Read `{epic, title, blocked_by}` for the story from the map (errors if missing —
   run Step 1 first).
2. Create the issue in the canonical shape, or **adopt** an existing issue with the
   same tracker key (idempotent; reconciles milestone, Feature type, labels, and the selected workflow).
3. Wire native GitHub **blocked by** edges in both directions, resolving blockers
   through the map (`addBlockedBy`). Blockers not created yet are reported as `pending`
   and get wired automatically when they are later created (reverse-edge pass).
4. Write `{number, node_id, url}` back into the map.

Options:

- `--body-file <path>`: use a rich body (e.g. an architecture doc) instead of the
  canonical template. Attach long context as a follow-up comment with `gh issue comment`.
- `--dry-run`: show the title/labels/blocked_by and the reverse edges that would be wired.
- `--map`, `--repo`, `--tag`, `--pack-label`, `--extra-label`, `--epics`, `--sprint-status`,
  `--target-name`, `--milestone`, `--feature-type-id`: pack overrides.
- `--workflow` is mandatory and records the user-selected Archon workflow in the issue body.
  Pass an explicit empty value only after the user selects no workflow.
  Empty `--feature-type-id` skips `updateIssueIssueType` (use when the repo has no issue types).

Archon Source Control example:

```
python .agents/skills/github-issue-tracker/scripts/create_issue.py \
  --story 1-1-see-this-runs-uncommitted-files \
  --map _bmad-output/implementation-artifacts/archon-source-control/github-issue-map.json \
  --repo anhle128/Archon \
  --tag SC \
  --pack-label archon-source-control \
  --epics _bmad-output/planning-artifacts/epics-source-control/epics.md \
  --sprint-status _bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml \
  --target-name Archon \
  --workflow superpower-feature \
  --milestone 1 \
  --feature-type-id ""
```

## Canonical issue shape (do not deviate)

- Title: `[<tag>][Epic <N>] <story-id>: <title>` — default tag `RM-02`
- Labels: `New Feature`, `<pack-label>` (default `rm-02`), `epic-<N>`, plus `status:ready` **only when the story's map status is `ready-for-dev` and every blocker is `done`** (derived; see status-label rule) — backlog/in-progress/review/done or a blocked story carry no `status:ready`
- Milestone: pack `--milestone` (default `1`)
- Issue type: Feature (`updateIssueIssueType`) on repos that have issue types. Pass `--feature-type-id ""` when GraphQL `issueTypes` is null / the org has no Feature type — do not reuse another org's type id.
- Implementation workflow: the Archon workflow selected by the user before creation
- Relationships: native `blocked by` edges (`addBlockedBy`), never just prose
- Recorded in the issue-map

## Issue-map schema

```json
{
  "milestone": 1,
  "stories": {
    "<story-id>": {
      "epic": 3,
      "title": "Human title",
      "blocked_by": ["<blocker-story-id>", "..."],
      "status": "backlog",
      "number": 116,
      "node_id": "I_kw...",
      "url": "https://github.com/.../issues/116"
    }
  }
}
```

`epic`/`title`/`blocked_by` are seeded by the builder; `number`/`node_id`/`url` are
filled by create_issue; `status` mirrors sprint-status.

## Rules

- NEVER hand-roll `gh issue create` for a tracked story — use `create_issue.py` so shape
  and relationships stay consistent.
- ALWAYS ask which Archon workflow to use before issue creation or adoption.
  Never reuse a prior answer without asking.
- NEVER omit `--workflow`.
  Use `--workflow ""` only when the user explicitly selects no workflow.
- NEVER re-read the epic to decide relationships — the map is the source. If a
  dependency is wrong, fix it in the map (or the builder seed for a first build).
- NEVER recreate a batch issue creator (the old `sync-github-issues.py` was removed); create one-by-one with these scripts.
- Adding a NEW story: add it to that board's `sprint-status.yaml` and to the builder SEED (RM-02 dict, or the pack `--seed` JSON: `{story_id: [title, blocked_by[]]}`), run the builder, then create the issue.
- Editing a relationship for an already-mapped story: edit `blocked_by` in the map, then
  re-run `create_issue.py --story <id>` (idempotent) to re-wire edges.
- Keep secrets out of issue bodies and comments.
- Status label is DERIVED, not unconditional: `create_issue.py` adds `status:ready` only when the story's map status is `ready-for-dev` AND every blocker's status is `done`. Backlog / in-progress / review / done, or any open blocker, get NO `status:ready` (there is no `status:blocked` label). `reconcile_labels` enforces this on create AND adopt (it REMOVES a stale `status:ready`) and fails LOUDLY on any final-state mismatch — never a false success. Unit cases: `scripts/test_status_labels.py`, `scripts/test_find_existing.py`, `scripts/test_pack_flags.py`.
- Native `blocked by` relationships are MANDATORY and are the Relationships-panel truth: wired via `addBlockedBy` (GraphQL) resolving through the map, NOT prose in the body. A "Blocked by #N" line in the body is NOT a relationship. Always create/adopt through `create_issue.py` so native edges (and reverse edges) are wired and recorded — never hand-roll `gh issue create`.

## Reconciling issues created by hand

If someone already ran `gh issue create` for a story (inconsistent), just run
`create_issue.py --story <id>`: it finds the existing issue by tracker key, adopts it into
the map, reconciles milestone + Feature type, and wires the native blocked-by edges.
