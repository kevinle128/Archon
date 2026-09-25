---
phase: 5
title: 'Phase 5: Quality gates, tracker, and #265 handoff'
status: pending
priority: P1
effort: '1.5h'
dependencies: [4]
---

# Phase 5: Quality gates, tracker, and #265 handoff

## Goal

Pass every repository gate, record the evidence, move the tracker entry to
`done`, and hand the remaining Story 10.1 scope to #265 without duplicating
work.

## Gates (run in this order)

```sh
(cd packages/web && bun test src/lib/room-split-layout.test.ts src/lib/execution-room-model.test.ts)

(cd packages/web && NODE_ENV=development bun test \
  src/components/workflows/NodeTranscriptPane.test.tsx \
  src/components/workflows/LegacyGraphLogsPane.test.tsx \
  src/components/workflows/LegacyNodeRoom.test.tsx \
  src/components/workflows/WorkflowExecution.test.tsx)

(cd packages/web && NODE_ENV=development bun test \
  src/experiments/console/components/ConsoleNodeRoom.test.tsx \
  src/experiments/console/components/ConsoleInspectPane.test.tsx \
  src/experiments/console/routes/RunDetailPage.test.tsx \
  src/experiments/console/console-isolation.test.ts)

bun --filter @archon/web test

(cd e2e && bun run typecheck)

(cd e2e && bun run test:ui -- \
  workflow-run-hitl-room.spec.ts \
  workflow-run-hitl-visual.spec.ts \
  agent-todo-strip.spec.ts \
  occurrence-navigation.spec.ts \
  agent-finished-iteration.spec.ts \
  verifier-visual.spec.ts \
  agent-tool-row-visual.spec.ts \
  file-edit-diff.spec.ts \
  task-dispatch-body.spec.ts)

bun run validate
```

Never run root `bun test`. If a gate fails, fix the cause; do not weaken the
test.

## Closeout steps

1. Write `reports/acceptance-evidence.md`. For AC1-AC8, give the exact test
   name or evidence file and the command that proved it, plus the commit SHA.
2. In `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml`,
   change `3-1-match-the-approved-console-and-legacy-room-anatomy: backlog`
   to `done` and update `last_updated`. This follows the operator's
   2026-09-25 decision, which chose issue #266's acceptance criteria over the
   09-22 "do not edit historical entries" note. Move `epic-3` from
   `backlog` to `in-progress`, following the tracker's own rule that an epic
   becomes in-progress once its first story starts. It is not `done`, because
   Stories 3.2 and 3.3 remain open.
3. `github-issue-map.json` also has a per-story `status`. No skill or `ak`
   command in this checkout or `~/.claude/skills` was found to regenerate it
   (grep, 2026-09-25). Set the `3-1-…` entry to `done` so it agrees with the
   sprint tracker, and note the manual edit in the acceptance report. If the
   github-issue-tracker skill is available at closeout, use its sync command
   instead.
4. Re-run the docs grep
   (`grep -rniE "resiz|room.*ratio" packages/docs-web/src/content/docs`). If a
   hit describes a resizable node room, update that page in this PR.
5. **Handoff to #265 (Story 10.1).** Under `Dev Notes` in
   `_bmad-output/implementation-artifacts/agent-node-room/10-1-fix-room-geometry-and-execution-selection.md`,
   add a short dated note: M001 and M002 (Tasks 1-2 and their geometry proof
   in Tasks 5-6) were delivered by #266 at `<sha>`, so #265's remaining scope
   is M005 (Tasks 3-4 and their proof). Do not rewrite the story's acceptance
   criteria or its status. Post the same note as a comment on #265 with
   `gh issue comment 265 -R kevinle128/Archon`, but only after confirming the
   wording with the operator, because the comment is published outside this
   checkout.
6. Open the PR against `develop` using `.github/pull_request_template.md`,
   with `Closes #266` in the body.

## Success criteria

- Every gate is green, and the evidence report is complete.
- The tracker, the issue map, and the handoff note all agree.

## Risks

- The `validate` script includes `check:bundled` and other generators. This
  change touches no generated source, so any drift they report comes from
  somewhere else. Report it; do not regenerate unrelated files.
