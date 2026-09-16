# Organize BMad Feature Artifacts

Status: complete

## Outcome

Every feature-owned artifact under `_bmad-output` has an explicit feature namespace.
No active PRD, architecture, epics, UX, readiness report, change proposal, story decision, or test artifact remains at a generic root path.

## Constraints

- Preserve existing document content and user edits.
- Keep shared project context and investigation artifacts in their shared locations.
- Keep the Workflow Commander contract package at its stable path because code and tests consume it.
- Preserve superseded node-room specs as audit sources under the canonical Agent Node Room package.
- Update references after every move.
- Do not edit generated files or changelogs.

## Feature Mapping

- Route Loop Routing: the archived 2026-06-26 planning package.
- BMAD TEA V2 Workflow Orchestration: the `a3`/`a4`/`a5` test artifacts produced from the 2026-06-30 handoff.
- Workflow Commander: July planning artifacts, Workflow Commander contracts, `3.x` story decisions, and `3.x` test artifacts.
- Source Control: source-control PRD, architecture, UX, epics, spec, and implementation artifacts.
- Workflow Run View HITL: HITL spec, architecture, epics, readiness report, and implementation artifacts.
- Agent Node Room: canonical node-room spec, readable-transcript and live-steering source specs, their architecture and UX artifacts, epics, readiness reports, and remediation proposals.

## Steps

1. [x] Move loose planning and test artifacts into their feature-owned directories.
2. [x] Rename date-only architecture and UX directories with feature slugs.
3. [x] Nest superseded readable-transcript and live-steering specs under the canonical Agent Node Room source directory.
4. [x] Rewrite moved-path references and verify that referenced local files exist.
5. [x] Prevent the Archon readiness and correct-course wrappers from recreating target-owned files at the planning root.
6. [x] Run the Workflow Commander contract validator and review the final diff for unrelated changes.

## Acceptance Criteria

- `_bmad-output/planning-artifacts` has no loose feature-owned Markdown files.
- `_bmad-output/test-artifacts` has no loose feature-owned Markdown files.
- Every date-only architecture and UX directory has a feature name.
- The top-level specs directory contains only active canonical feature packages.
- Workflow Commander contract validation passes.
- Existing unrelated working-tree changes remain intact.
