#!/usr/bin/env python3
"""Unit cases for pack flags, seed JSON, and skipped Feature type (no network).

Run: python3 .agents/skills/github-issue-tracker/scripts/test_pack_flags.py
"""
from __future__ import annotations

import io
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_issue_map as builder  # noqa: E402
import create_issue as ci  # noqa: E402


def test_load_seed_tuple_and_dict() -> None:
    raw = {
        "1-1-see-this-runs-uncommitted-files": [
            "See this run's uncommitted files",
            [],
        ],
        "1-2-open-a-changed-file-in-the-shared-viewer": {
            "title": "Open a changed file in the shared viewer",
            "blocked_by": ["1-1-see-this-runs-uncommitted-files"],
        },
    }
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
        json.dump(raw, fh)
        path = Path(fh.name)
    try:
        seed = builder.load_seed(path)
        assert seed["1-1-see-this-runs-uncommitted-files"] == (
            "See this run's uncommitted files",
            [],
        )
        assert seed["1-2-open-a-changed-file-in-the-shared-viewer"] == (
            "Open a changed file in the shared viewer",
            ["1-1-see-this-runs-uncommitted-files"],
        )
        assert builder.load_seed(None) is builder.SEED
    finally:
        path.unlink()


def test_desired_labels_pack_and_extra() -> None:
    ci.PACK_LABEL = "archon-source-control"
    ci.EXTRA_LABELS = ["archon-source-control"]
    labels = ci.desired_labels(1, {"status": "backlog", "blocked_by": []}, {})
    assert labels == ["New Feature", "archon-source-control", "epic-1"]
    ci.PACK_LABEL = "rm-02"
    ci.EXTRA_LABELS = []
    labels = ci.desired_labels(3, {"status": "ready-for-dev", "blocked_by": []}, {})
    assert labels == ["New Feature", "rm-02", "epic-3", "status:ready"]


def test_default_body_pack_and_workflow() -> None:
    ci.MILESTONE_TAG = "SC"
    ci.SPRINT_STATUS = "_bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml"
    ci.EPICS_PATH = "_bmad-output/planning-artifacts/epics-source-control/epics.md"
    ci.TARGET_REPO = "Archon"
    ci.PACK_LABEL = "archon-source-control"
    ci.WORKFLOW = "superpower-feature"
    body = ci.default_body("1-1-see-this-runs-uncommitted-files", 1, "See this run's uncommitted files", [])
    assert "- Tracker key: `1-1-see-this-runs-uncommitted-files`" in body
    assert "- Target repository: `Archon`" in body
    assert "- Pack label: `archon-source-control`" in body
    assert "Archon `superpower-feature` workflow" in body
    ci.MILESTONE_TAG = "RM-02"
    ci.SPRINT_STATUS = "_bmad-output/implementation-artifacts/rm-02/sprint-status.yaml"
    ci.EPICS_PATH = "_bmad-output/planning-artifacts/epics/epics-rm-02-plurality-headless-2026-08-25/epics.md"
    ci.TARGET_REPO = "harness-service"
    ci.PACK_LABEL = "rm-02"
    ci.WORKFLOW = ""
    rm_body = ci.default_body("3-9-launch-writes-the-one-bind-row", 3, "Launch writes the one bind row", [])
    assert "superpower-feature" not in rm_body
    assert "- Target repository: `harness-service`" in rm_body
    assert "(NFR-1)" not in body
    assert "(NFR-1)" not in rm_body
    assert "No secrets in events" not in body


def test_custom_body_reconciles_workflow() -> None:
    original = "# Rich context\n\n## Implementation workflow\n\nUse `old-workflow`.\n"
    updated = ci.with_implementation_workflow(original, "superpower-feature")
    assert updated.count("## Implementation workflow") == 1
    assert "Archon `superpower-feature` workflow" in updated
    assert "old-workflow" not in updated
    removed = ci.with_implementation_workflow(updated, "")
    assert "## Implementation workflow" not in removed
    assert "# Rich context" in removed


def test_set_feature_type_skips_empty_id() -> None:
    previous = ci.FEATURE_TYPE_ID
    ci.FEATURE_TYPE_ID = ""

    def boom(*_a, **_k):
        raise AssertionError("gh must not be called when Feature type id is empty")

    old_run = ci.run
    ci.run = boom  # type: ignore[method-assign]
    try:
        ci.set_feature_type("I_unused")
    finally:
        ci.run = old_run  # type: ignore[method-assign]
        ci.FEATURE_TYPE_ID = previous


def test_reconcile_workflow_preserves_existing_body() -> None:
    calls: list[tuple[list[str], str | None]] = []

    def fake_run(cmd: list[str], *, input_text: str | None = None) -> str:
        calls.append((cmd, input_text))
        if "view" in cmd:
            return json.dumps({"body": "# Existing context\n"})
        return ""

    old_run = ci.run
    ci.run = fake_run  # type: ignore[method-assign]
    try:
        ci.reconcile_workflow(42, "superpower-feature")
    finally:
        ci.run = old_run  # type: ignore[method-assign]
    assert len(calls) == 2
    assert calls[1][0][-2:] == ["--body-file", "-"]
    assert "# Existing context" in (calls[1][1] or "")
    assert "Archon `superpower-feature` workflow" in (calls[1][1] or "")


def test_main_dry_run_pack_flags() -> None:
    names = (
        "OWNER", "REPO", "MILESTONE", "MILESTONE_TAG", "PACK_LABEL", "EXTRA_LABELS",
        "EPICS_PATH", "SPRINT_STATUS", "TARGET_REPO", "WORKFLOW", "FEATURE_TYPE_ID",
    )
    snap = {name: getattr(ci, name) for name in names}
    story = "1-1-see-this-runs-uncommitted-files"
    payload = {
        "milestone": 1,
        "stories": {
            story: {
                "epic": 1,
                "title": "See this run's uncommitted files",
                "blocked_by": [],
                "status": "backlog",
            }
        },
    }
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
        json.dump(payload, fh)
        map_path = Path(fh.name)
    buf = io.StringIO()
    old_out = sys.stdout
    try:
        sys.stdout = buf
        rc = ci.main([
            "--story", story,
            "--map", str(map_path),
            "--repo", "anhle128/Archon",
            "--tag", "SC",
            "--pack-label", "archon-source-control",
            "--epics", "_bmad-output/planning-artifacts/epics-source-control/epics.md",
            "--sprint-status", "_bmad-output/implementation-artifacts/archon-source-control/sprint-status.yaml",
            "--target-name", "Archon",
            "--workflow", "superpower-feature",
            "--milestone", "1",
            "--feature-type-id", "",
            "--dry-run",
        ])
    finally:
        sys.stdout = old_out
        map_path.unlink()
        for name, value in snap.items():
            setattr(ci, name, value)
    assert rc == 0
    out = buf.getvalue()
    assert "[SC][Epic 1] 1-1-see-this-runs-uncommitted-files: See this run's uncommitted files" in out
    assert "labels: New Feature, archon-source-control, epic-1" in out
    assert "status:ready" not in out
    assert "milestone 1" in out
    assert "workflow: superpower-feature" in out
    assert ci.OWNER == snap["OWNER"]
    assert ci.FEATURE_TYPE_ID == snap["FEATURE_TYPE_ID"]


def test_main_requires_workflow_selection() -> None:
    err = io.StringIO()
    old_err = sys.stderr
    try:
        sys.stderr = err
        rc = ci.main(["--story", "1-1-example", "--dry-run"])
    finally:
        sys.stderr = old_err
    assert rc == 2
    assert "--workflow is required" in err.getvalue()


def main() -> int:
    test_load_seed_tuple_and_dict()
    print("  ok: load_seed")
    test_desired_labels_pack_and_extra()
    print("  ok: desired_labels pack")
    test_default_body_pack_and_workflow()
    print("  ok: default_body pack/workflow")
    test_custom_body_reconciles_workflow()
    print("  ok: custom body workflow reconciliation")
    test_set_feature_type_skips_empty_id()
    print("  ok: set_feature_type skip")
    test_reconcile_workflow_preserves_existing_body()
    print("  ok: existing issue workflow reconciliation")
    test_main_dry_run_pack_flags()
    print("  ok: main dry-run pack flags")
    test_main_requires_workflow_selection()
    print("  ok: workflow selection required")
    print("all pack-flag unit cases passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
