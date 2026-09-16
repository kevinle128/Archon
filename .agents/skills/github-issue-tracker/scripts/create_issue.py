#!/usr/bin/env python3
"""Create ONE GitHub issue for a story, one-by-one, with relationships wired
from the issue-map (never re-reading the epic).

Reads `github-issue-map.json` for the story's {epic, title, blocked_by}, creates
the issue in the canonical shape, sets the Feature issue type + milestone, wires
native GitHub `blocked by` edges (both directions, resolved through the map), and
writes {number, node_id, url} back into the map.

Idempotent: if the story already has a number in the map, or an issue with the
tracker key already exists (e.g. one created by hand), it is ADOPTED into the map
and its milestone / issue-type / relationships are reconciled instead of creating
a duplicate.

Prereq: run build_issue_map.py first so the story has {epic, title, blocked_by}.

Usage:
  python .../create_issue.py --story 3-5-characterize-the-oh-my-pi-executor-and-lifecycle --workflow superpower-feature
  python .../create_issue.py --story <id> --workflow <name> --body-file plans/.../rich-body.md
  python .../create_issue.py --story <id> --workflow <name> --dry-run
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
from pathlib import Path

OWNER = "oceanlabs-holding"
REPO = "x10.gigo.harness-service"
MILESTONE = 1
MILESTONE_TAG = "RM-02"
PACK_LABEL = "rm-02"
EXTRA_LABELS: list[str] = []
FEATURE_TYPE_ID = "IT_kwDOD5hVnM4B3NFN"
MAP_PATH = Path("_bmad-output/implementation-artifacts/rm-02/github-issue-map.json")
EPICS_PATH = "_bmad-output/planning-artifacts/epics/epics-rm-02-plurality-headless-2026-08-25/epics.md"
SPRINT_STATUS = "_bmad-output/implementation-artifacts/rm-02/sprint-status.yaml"
TARGET_REPO = "harness-service"
WORKFLOW = ""


def run(cmd: list[str], *, input_text: str | None = None) -> str:
    result = subprocess.run(cmd, input=input_text, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"cmd failed: {' '.join(cmd)}\n{result.stderr.strip()}")
    return result.stdout.strip()


def gh_api_json(args: list[str]):
    out = run(["gh", "api", *args])
    return json.loads(out) if out else {}


def display_num(story_id: str) -> str:
    parts = story_id.split("-", 2)
    return f"{parts[0]}.{parts[1]}"


def canonical_title(story_id: str, epic: int, title: str) -> str:
    return f"[{MILESTONE_TAG}][Epic {epic}] {story_id}: {title}"


def with_implementation_workflow(body: str, workflow: str) -> str:
    pattern = re.compile(r"\n*## Implementation workflow\n\n.*?(?=\n## |\Z)", re.DOTALL)
    body_without_workflow = pattern.sub("", body).rstrip()
    if not workflow:
        return f"{body_without_workflow}\n"
    return (
        f"{body_without_workflow}\n\n## Implementation workflow\n\n"
        f"Build this story with the Archon `{workflow}` workflow after the issue is ready to pick.\n"
    )


def default_body(story_id: str, epic: int, title: str, blocked_by: list[str]) -> str:
    deps = "\n".join(f"- `{d}`" for d in blocked_by) if blocked_by else "- _(none — ready when open)_"
    body = f"""## Outcome

Ship {MILESTONE_TAG} story **{display_num(story_id)}**: {title}.

## Context

- Milestone: {MILESTONE_TAG}
- Tracker key: `{story_id}`
- Sprint status: `{SPRINT_STATUS}`
- Spec authority: `{EPICS_PATH}`
- Target repository: `{TARGET_REPO}`
- Label: `New Feature` (not `upstream-sync`)
- Pack label: `{PACK_LABEL}`

## Blocked by (story keys)

{deps}

Native GitHub **blocked by** edges are wired on this issue from the issue-map. Pick issues that are open, labeled `New Feature`, and have no open blockers.

## Acceptance Criteria

- [ ] Story acceptance criteria in `{EPICS_PATH}` for Story {display_num(story_id)} are satisfied
- [ ] Focused tests / characterization evidence recorded before close
- [ ] `sprint-status.yaml` entry for `{story_id}` moved to `done`

## Handoff Log

- issue created/adopted via github-issue-tracker skill; relationships wired from the issue-map.
"""
    return with_implementation_workflow(body, WORKFLOW)


def issue_matches_story(issue: dict, story_id: str) -> bool:
    """Adopt ONLY by the canonical title tracker key `] <story-id>:` OR the dedicated
    body line `- Tracker key: `<story-id>``. NEVER by arbitrary body mentions: a blocker
    slug appears in a dependent's "Blocked by" list as `- `<slug>`` and must not trigger
    adoption (that arbitrary-mention match made 3-9 falsely adopt 3-11's issue #121)."""
    if issue.get("pull_request"):
        return False
    title = issue.get("title") or ""
    body = issue.get("body") or ""
    return f"] {story_id}:" in title or f"- Tracker key: `{story_id}`" in body


def find_existing(story_id: str) -> dict | None:
    issues = gh_api_json([
        f"repos/{OWNER}/{REPO}/issues", "--method", "GET",
        "-f", "state=all", "-f", "labels=New Feature", "-f", "per_page=100",
    ])
    for issue in issues:
        if issue_matches_story(issue, story_id):
            return issue
    return None


def ensure_labels(labels: list[str]) -> None:
    colors = {
        "status:ready": ("0e8a16", "Ready to pick (no open blockers)"),
        "New Feature": ("1d76db", "New product feature"),
    }
    for name in labels:
        color, desc = colors.get(name, ("ededed", name))
        try:
            run(["gh", "label", "create", name, "--repo", f"{OWNER}/{REPO}",
                 "--color", color, "--description", desc])
        except RuntimeError:
            pass


def set_feature_type(node_id: str) -> None:
    if not FEATURE_TYPE_ID:
        return
    try:
        run(["gh", "api", "graphql",
             "-f", "query=mutation($id:ID!,$type:ID!){ updateIssueIssueType(input:{issueId:$id, issueTypeId:$type}) { issue { id } } }",
             "-f", f"id={node_id}", "-f", f"type={FEATURE_TYPE_ID}"])
    except RuntimeError as exc:
        print(f"  warn: could not set Feature type: {exc}", file=sys.stderr)


def set_milestone(number: int) -> None:
    try:
        run(["gh", "api", f"repos/{OWNER}/{REPO}/issues/{number}", "--method", "PATCH",
             "-F", f"milestone={MILESTONE}"])
    except RuntimeError as exc:
        print(f"  warn: could not set milestone: {exc}", file=sys.stderr)


def add_blocked_by(issue_node_id: str, blocking_node_id: str) -> bool:
    mutation = ("mutation($i:ID!,$b:ID!){ addBlockedBy(input:{issueId:$i, blockingIssueId:$b})"
                " { issue { number } } }")
    try:
        run(["gh", "api", "graphql", "-f", f"query={mutation}",
             "-f", f"i={issue_node_id}", "-f", f"b={blocking_node_id}"])
        return True
    except RuntimeError as exc:
        low = str(exc).lower()
        if "already" in low or "duplicate" in low:
            return True
        print(f"  warn: addBlockedBy failed: {exc}", file=sys.stderr)
        return False


# sprint-status story vocabulary: backlog | ready-for-dev | in-progress | review | done.
# The `status:ready` LABEL means "ready to be picked up" -> only `ready-for-dev`.
# in-progress/review/done are PAST ready and backlog is BEFORE ready: none carry the label.
READY_STATUSES = {"ready-for-dev"}
DONE_STATUSES = {"done"}


def status_is_ready(entry: dict, stories: dict) -> bool:
    """status:ready ONLY when the map status is `ready-for-dev` AND every blocker is `done`.
    Backlog / in-progress / review / done, or an open blocker, get NO status:ready label
    (there is no status:blocked label in this repo; omit rather than mislabel)."""
    if (entry.get("status") or "backlog") not in READY_STATUSES:
        return False
    for dep in entry.get("blocked_by", []):
        if (stories.get(dep, {}).get("status") or "") not in DONE_STATUSES:
            return False
    return True


def desired_labels(epic: int, entry: dict, stories: dict) -> list[str]:
    labels = ["New Feature", PACK_LABEL, f"epic-{epic}"]
    for extra in EXTRA_LABELS:
        if extra not in labels:
            labels.append(extra)
    if status_is_ready(entry, stories):
        labels.append("status:ready")
    return labels


def reconcile_labels(number: int, labels: list[str]) -> None:
    """Enforce the issue's labels == `labels` (incl. REMOVING a stale status:ready when a
    story is not ready). Labels are a mandatory tracker invariant: this fails LOUDLY on any
    final-state mismatch rather than reporting a false success."""
    want = set(labels)
    base = ["gh", "issue", "edit", str(number), "--repo", f"{OWNER}/{REPO}"]
    for lbl in want:
        run(base + ["--add-label", lbl])          # run() raises on real failure
    if "status:ready" not in want:
        try:
            run(base + ["--remove-label", "status:ready"])
        except Exception:
            pass                                   # tolerate 'already absent'; verify below is the guard
    view = json.loads(run(["gh", "issue", "view", str(number), "--repo",
                           f"{OWNER}/{REPO}", "--json", "labels"]))
    have = {l["name"] for l in view.get("labels", [])}
    stale = {"status:ready"} & have if "status:ready" not in want else set()
    if (want - have) or stale:
        raise RuntimeError(
            f"reconcile_labels invariant failed on #{number}: want={sorted(want)} have={sorted(have)}")


def reconcile_workflow(number: int, workflow: str) -> None:
    view = json.loads(run([
        "gh", "issue", "view", str(number), "--repo", f"{OWNER}/{REPO}", "--json", "body",
    ]))
    current = view.get("body") or ""
    desired = with_implementation_workflow(current, workflow)
    if desired == current:
        return
    run([
        "gh", "issue", "edit", str(number), "--repo", f"{OWNER}/{REPO}", "--body-file", "-",
    ], input_text=desired)


def create_issue(story_id: str, epic: int, title: str, body: str, labels: list[str]) -> dict:
    payload = {
        "title": canonical_title(story_id, epic, title),
        "body": body,
        "milestone": MILESTONE,
        "labels": labels,
    }
    created = json.loads(run(
        ["gh", "api", f"repos/{OWNER}/{REPO}/issues", "--method", "POST", "--input", "-"],
        input_text=json.dumps(payload),
    ))
    set_feature_type(created["node_id"])
    return created


def main(argv: list[str] | None = None) -> int:
    global OWNER, REPO, MILESTONE, MILESTONE_TAG, PACK_LABEL, EXTRA_LABELS
    global EPICS_PATH, SPRINT_STATUS, TARGET_REPO, WORKFLOW, FEATURE_TYPE_ID
    parser = argparse.ArgumentParser(description="Create/adopt one GitHub issue with relationships from the issue-map.")
    parser.add_argument("--story", required=True)
    parser.add_argument("--map", type=Path, default=MAP_PATH)
    parser.add_argument("--repo", default=f"{OWNER}/{REPO}")
    parser.add_argument("--tag", default=MILESTONE_TAG, help="title prefix, e.g. RM-02 or SC")
    parser.add_argument("--pack-label", default=PACK_LABEL)
    parser.add_argument("--extra-label", action="append", default=[], help="additional labels (repeatable)")
    parser.add_argument("--epics", default=EPICS_PATH)
    parser.add_argument("--sprint-status", default=SPRINT_STATUS)
    parser.add_argument("--target-name", default=TARGET_REPO)
    parser.add_argument("--feature-type-id", default=FEATURE_TYPE_ID, help="GitHub issue type node id; empty skips")
    parser.add_argument(
        "--workflow",
        default=None,
        help="required Archon workflow selection recorded in the body; pass an explicit empty value for none",
    )
    parser.add_argument("--milestone", type=int, default=MILESTONE)
    parser.add_argument("--body-file", type=Path, help="use this file as the issue body instead of the canonical template")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    if args.workflow is None:
        print(
            "error: --workflow is required; ask the user which Archon workflow to use "
            "or pass an explicit empty value for none",
            file=sys.stderr,
        )
        return 2
    owner, repo = args.repo.split("/", 1)
    OWNER, REPO = owner, repo
    MILESTONE = args.milestone
    MILESTONE_TAG = args.tag
    PACK_LABEL = args.pack_label
    EXTRA_LABELS = list(args.extra_label)
    EPICS_PATH = args.epics
    SPRINT_STATUS = args.sprint_status
    TARGET_REPO = args.target_name
    WORKFLOW = args.workflow
    FEATURE_TYPE_ID = args.feature_type_id


    if not args.map.exists():
        print(f"error: issue-map not found: {args.map}\nRun build_issue_map.py first.", file=sys.stderr)
        return 2
    data = json.loads(args.map.read_text())
    stories = data.setdefault("stories", {})
    entry = stories.get(args.story)
    if entry is None or "epic" not in entry or "title" not in entry:
        print(f"error: story `{args.story}` missing {{epic,title,blocked_by}} in the map.\n"
              f"Run build_issue_map.py first (it seeds relationships).", file=sys.stderr)
        return 2

    epic = entry["epic"]
    title = entry["title"]
    blocked_by = entry.get("blocked_by", [])
    body = (
        with_implementation_workflow(args.body_file.read_text(), WORKFLOW)
        if args.body_file
        else default_body(args.story, epic, title, blocked_by)
    )
    labels = desired_labels(epic, entry, stories)

    if args.dry_run:
        print(f"[dry-run] title: {canonical_title(args.story, epic, title)}")
        print(f"[dry-run] labels: {', '.join(labels)} ; milestone {MILESTONE}")
        print(f"[dry-run] workflow: {WORKFLOW or '(none)'}")
        print(f"[dry-run] blocked_by: {blocked_by or '(none)'}")
        rev = [s for s, m in stories.items() if args.story in m.get('blocked_by', []) and m.get('node_id')]
        print(f"[dry-run] reverse edges to wire (created stories that depend on this): {rev or '(none)'}")
        return 0

    ensure_labels([*labels, "status:ready"])

    # 1) create or adopt
    if entry.get("number") and entry.get("node_id"):
        print(f"adopt (in map): {args.story} -> #{entry['number']}")
        set_milestone(entry["number"])
        set_feature_type(entry["node_id"])
        reconcile_labels(entry["number"], labels)
        reconcile_workflow(entry["number"], WORKFLOW)
    else:
        existing = find_existing(args.story)
        if existing:
            entry.update(number=existing["number"], node_id=existing["node_id"], url=existing["html_url"])
            print(f"adopt (found existing): {args.story} -> #{existing['number']}")
            # reconcile milestone + type on an ad-hoc issue
            if not existing.get("milestone"):
                set_milestone(existing["number"])
            set_feature_type(existing["node_id"])
            reconcile_labels(existing["number"], labels)
            reconcile_workflow(existing["number"], WORKFLOW)
        else:
            created = create_issue(args.story, epic, title, body, labels)
            entry.update(number=created["number"], node_id=created["node_id"], url=created["html_url"])
            print(f"created: {args.story} -> #{created['number']} {created['html_url']}")
            time.sleep(0.3)
    args.map.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")

    # 2) wire blocked-by (this <- its blockers)
    pending = []
    for dep in blocked_by:
        blocker = stories.get(dep)
        if not blocker or not blocker.get("node_id"):
            pending.append(dep)
            continue
        if add_blocked_by(entry["node_id"], blocker["node_id"]):
            print(f"  #{entry['number']} blocked by #{blocker['number']} ({dep})")
        time.sleep(0.15)

    # 3) reverse edges (created stories that depend on THIS one)
    for s, m in stories.items():
        if s == args.story or not m.get("node_id"):
            continue
        if args.story in m.get("blocked_by", []):
            if add_blocked_by(m["node_id"], entry["node_id"]):
                print(f"  #{m['number']} ({s}) blocked by #{entry['number']} ({args.story})")
            time.sleep(0.15)

    args.map.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")
    if pending:
        print(f"pending blockers not yet created (wire later when they exist): {', '.join(pending)}")
    print(f"map updated: {args.map}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
