---
phase: 3
title: 'Phase 3: Deterministic full-stack proof and closeout'
status: pending
priority: P1
effort: '1d'
dependencies: [1, 2]
---

# Phase 3: Deterministic full-stack proof and closeout

## Goal

Prove the inline diff end to end on both surfaces with a deterministic fake-provider fixture, record geometry, accessibility, and contrast evidence, run the full validation gate, update the story records, and close the sprint entry. Nothing here changes product behavior; if the proof finds a defect, fix it in Phase 1/2 files and re-run.

## Pre-edit integration check (scout pass at execution time)

- Confirm the `e2e-fake` scenario schema is still `.strict()` and that `taskDispatch`/`emitTodo` are the current precedents for a scenario that emits a fixed tool payload; mirror their validation (`rejects fileEdit combined with emitTool …`).
- Confirm `e2e/lib/playwright/archon-runtime.ts` still registers fixture YAML by copying it into the runtime home `workflows/` directory and exposes `run<Name>Workflow()` helpers on the fixture object; add the file-edit runner the same way as `runTaskDispatchWorkflow`.
- Confirm `e2e/ui/task-dispatch-body.spec.ts` is still the closest precedent (both surfaces, `details[data-tool-id]` rows, `openLegacyRunDetail`/`openRunDetail`, `REFERENCE_WIDTH`, `ROOM_PANEL_ID`, reference/actual capture helpers) and reuse its helpers rather than duplicating them.

## Files

| Path                                                                                         | Action                                                                                  |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `packages/providers/src/e2e-fake/provider.ts`                                                | `fileEdit` scenario + pinned constants                                                  |
| `packages/providers/src/e2e-fake/provider.test.ts`                                           | scenario tests                                                                          |
| `e2e/fixtures/workflows/e2e-file-edit.yaml`                                                  | three-node fixture                                                                      |
| `e2e/lib/playwright/archon-runtime.ts`                                                       | register fixture, export names, `runFileEditWorkflow()`                                 |
| `e2e/ui/file-edit-diff.spec.ts`                                                              | both-surface proof                                                                      |
| `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml`                   | `1-4-view-a-file-edit-as-an-inline-diff: done`                                          |
| `plans/260919-0142-issue-177-inline-file-edit-diff/reports/implementation-evidence.md`       | commands, results, numbers, deviations                                                  |
| `plans/260919-0142-issue-177-inline-file-edit-diff/reports/visual-acceptance.md` (+captures) | screenshots at the two viewports per surface, contrast table                            |

## Deterministic fixture design

### Fake-provider scenario

Extend `scenarioSchema` with `fileEdit: z.enum(['edit', 'write', 'bare']).optional()`, mutually exclusive with `emitTool`, `repeatTool`, `largeLastToolOutput`, and `taskDispatch` (same refinement shape as the existing `taskDispatch` exclusivity). Pinned exports (mirrored verbatim in the spec):

```ts
export const E2E_FAKE_EDIT_TOOL_NAME = 'Edit';
export const E2E_FAKE_EDIT_PATH = 'crates/gigo-harness-worker/src/auto_retry.rs';
export const E2E_FAKE_EDIT_INPUT = {
  file_path: E2E_FAKE_EDIT_PATH,
  old_string:
    'pub fn backoff(attempt: u32) -> Duration {\n    let secs = 2u64.pow(attempt).min(31);\n    Duration::from_secs(secs + 1)\n}',
  new_string:
    'pub fn backoff(attempt: u32) -> Duration {\n    let secs = 2u64.pow(attempt).min(30);\n    Duration::from_secs(secs)\n}',
  replace_all: false,
} as const;
export const E2E_FAKE_EDIT_OUTPUT = `The file ${E2E_FAKE_EDIT_PATH} has been updated successfully.`;

export const E2E_FAKE_WRITE_TOOL_NAME = 'Write';
export const E2E_FAKE_WRITE_INPUT = {
  file_path: 'notes/summary.md',
  content: '# Summary\n\nOne line.\n',
} as const;
export const E2E_FAKE_WRITE_OUTPUT = 'File created successfully at: notes/summary.md';

export const E2E_FAKE_BARE_EDIT_TOOL_NAME = 'edit';
export const E2E_FAKE_BARE_EDIT_OUTPUT = 'edited notes/summary.md';
```

Emission (one call per node, paired result, `toolOutcome: 'success'`): `edit` → `Edit` with `structuredClone(E2E_FAKE_EDIT_INPUT)`; `write` → `Write` with the write input; `bare` → `edit` with **no** `toolInput` key at all (the "Codex edit without input" clause). Precede with the usual `[e2e-fake] tool pass` assistant line so the transcript shape matches the other fixtures.

The Edit payload is the mockup's own example: it diffs to one hunk with two deletes (`min(31)`, `secs + 1`) and two inserts (`min(30)`, `secs`), so the badges read `+2 −2` and the body bar `file · 1 hunk · replace_all: false`.

`provider.test.ts`: one test per variant asserting the exact tool name, input presence/shape (the `bare` event has no `toolInput` property), paired result, and one test for the exclusivity rejections.

### Workflow fixture and runtime

`e2e/fixtures/workflows/e2e-file-edit.yaml` — `mutates_checkout: false`, three `e2e-fake` nodes in a chain: `edit-both-sides` (`{"fileEdit":"edit"}`), `write-one-side` (`{"fileEdit":"write"}`), `edit-no-input` (`{"fileEdit":"bare"}`). Register it in `archon-runtime.ts` beside the task-dispatch fixture: constant path, `E2E_FILE_EDIT_WORKFLOW_NAME = 'e2e-file-edit'`, node-id exports, copy into the runtime home, and `runFileEditWorkflow(): Promise<CliRunResult>` that runs it to completion through the existing CLI runner.

## Playwright proof — `e2e/ui/file-edit-diff.spec.ts`

Prefix every test title with `[P1] file-edit:` — Playwright's `--grep` matches test titles, not file names, so `--grep 'file-edit'` selects the suite only if each title carries the literal. For each surface (`legacy`, `console`), open the run and each node room via the precedent helpers.

### Behavior

- `edit-both-sides`: the row's summary shows badge text `+2` and `−2` (assert the U+2212 character); the body bar contains `file · 1 hunk · replace_all: false`. Open the row: a `.tool-diff` table is visible with two `.diff-code-delete`, two `.diff-code-insert`, two `.diff-code-normal` cells; the delete cells contain `min(31)` and `secs + 1`, the insert cells `min(30)` and `secs`; gutters show `−`/`+` markers and the numbers `1`–`4`; no `.diff-decoration`; the text `has been updated successfully` is **not** visible while the row succeeded. Click Raw: the table disappears and the `<pre>` contains `"old_string"`; click again: the table returns.
- `write-one-side`: no `+`/`−` badge; opened body shows `notes/summary.md` and the preview `File created successfully`; no `.tool-diff`.
- `edit-no-input`: chip reads `edit`; no diff badge; body shows the fallback path (the chip label) and the preview `edited notes/summary.md`; no `.tool-diff`.
- Network quiet: while opening and toggling the edit row, no request leaves the app origin (reuse the request-listener pattern from the task-dispatch spec).

### Geometry and responsive states

- At 1440×1000 (split) and 390×844 (narrow): the room panel has no horizontal scrollbar (`scrollWidth <= clientWidth + 2`), the summary row stays one line, and the diff table's width equals the body box's inner width (±2px). The long Rust lines wrap inside `.diff-code` rather than overflowing.
- Capture `legacy`/`console` × `1440`/`390` screenshots with the edit row open into `reports/captures/` and reference them from `visual-acceptance.md`, alongside a crop of the mockup's §D file panel for side-by-side comparison.

### Accessibility and contrast

- The row remains a native `<details>`; the diff adds no focusable elements (tab from the summary lands on Raw).
- Measure with the existing `resolveColorIn`/`contrastRatio` helpers on both surfaces and assert ≥ 4.5:1: `+2` (success tone) and `−2` (danger tone) against the summary rest and hover backgrounds; line text (`--text-primary`) against the insert-tinted and delete-tinted backgrounds; `+`/`−` markers against their tinted backgrounds; line numbers (`--text-secondary`) against the inset surface. Record every number in the evidence file.
- Snippet-relative numbering is recorded in the evidence as the one known deviation from the mockup (`211` vs `1`).

## Test order and commands

```bash
bun --filter @archon/providers test
cd packages/web && bun test src/lib/
cd packages/web && NODE_ENV=development bun test src/components/
cd packages/web && NODE_ENV=development bun test src/experiments/console/
bun --filter @archon/web test
bun run --cwd e2e test:ui -- --grep 'file-edit'
bun run --cwd e2e test:ui -- --grep 'HITL'          # existing rooms unaffected
bun run validate
```

Do not run root `bun test`. Playwright needs the built web assets and the fake provider enabled the way the other UI specs already arrange it; follow `e2e/README` or the suite fixture, not a new mechanism.

## Failure handling

- A Playwright assertion failing on one surface only means the two local renderers diverged: fix the renderer in Phase 2's files and add the missing unit assertion there before re-running.
- A contrast failure on the `−` marker over the delete tint: apply the Phase 2 fallback mix and re-measure; do not lower the floor.
- A horizontal scrollbar at 390px: check `.tool-diff .diff-code` still has `white-space: pre-wrap; overflow-wrap: anywhere` and that the gutter `<col>` width is fixed; do not add a panel-level `overflow-x`.

## Closeout

1. Write `reports/implementation-evidence.md`: every command above with its result line, the contrast table, the capture paths, the list of contract-doc edits, and the deviations (snippet-relative numbers; single-hunk rows show no `@@` header).
2. Move `1-4-view-a-file-edit-as-an-inline-diff` to `done` in `sprint-status.yaml` (also bump `last_updated`).
3. Open the PR from the repository template with `Closes #177`, citing the `tool-presentation-contract.md` and `test-plan.md` edits under Review guidance and the evidence file under Validation.

## Final implementation audit

Before declaring done, re-read the Story 1.4 acceptance criteria and check each against evidence, not memory:

- both-sides → add/delete/hunk lines through `react-diff-view` (component + e2e proof);
- one side / no input → path and preview, never a fabricated diff (unit + component + e2e proof);
- pathological or large content → `null` from the declared byte ceiling and `maxEditLength`, UI falls back (unit proof at limit/limit + 1; no timeout anywhere in the module);
- repeated content, mid-array and doubled `\` markers, repeated calls, adapter conversion → deterministic, memoized, valid line numbers (unit proof).

## Exit criteria

- [ ] Fake-provider scenario, fixture, runtime registration, and Playwright spec exist and pass on both surfaces at both viewports.
- [ ] Evidence and visual-acceptance reports are written with real numbers and capture paths.
- [ ] `bun run validate` and the existing HITL UI suite pass.
- [ ] Sprint status is `done`; the PR is open with the template filled in and `Closes #177`.
