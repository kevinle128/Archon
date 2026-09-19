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

Prove the presentation contract through real stored workflow transcript rows on Legacy and Console, at the required widths and themes, then run regression/full validation and record evidence. The no-input fake row proves generic defensive fallback only; it is not Codex evidence.

## Pre-edit integration check

- Confirm the product-contract gate is resolved and the authoritative docs state the selected scope.
- Confirm the fake-provider scenario schema is still strict and identify every existing mutually exclusive scenario field; extend the same validation rather than creating a second dispatch mechanism.
- Confirm fixture copying and workflow runner helpers in `e2e/lib/playwright/archon-runtime.ts`.
- Reuse room-opening, panel-resizing, capture, color-resolution, contrast, and request-listener helpers from `task-dispatch-body.spec.ts` and adjacent room specs.
- Confirm the e2e package remains standalone and uses `bun run --cwd e2e test:ui -- ...`.

## Files

| Path                                                                                                     | Change                                               |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `packages/providers/src/e2e-fake/provider.ts`, `packages/providers/src/e2e-fake/provider.test.ts`        | deterministic success/failure/write/bare variants    |
| `e2e/fixtures/workflows/e2e-file-edit.yaml`                                                              | four-node non-mutating fixture                       |
| `e2e/lib/playwright/archon-runtime.ts`                                                                   | fixture registration and runner                      |
| `e2e/ui/file-edit-diff.spec.ts`                                                                          | both-surface browser proof                           |
| `plans/260919-0142-issue-177-inline-file-edit-diff/reports/implementation-evidence.md`                   | commands, results, measured values, scope resolution |
| `plans/260919-0142-issue-177-inline-file-edit-diff/reports/visual-acceptance.md` and `reports/captures/` | state/viewport/theme matrix and screenshots          |
| `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml`                               | mark Story 1.4 done only after every gate passes     |

## Deterministic fixture

Extend the existing strict scenario with `fileEdit: z.enum(['edit', 'failed', 'write', 'bare']).optional()`. It is mutually exclusive with `emitTool`, `emitTodo`, `askHuman`, `doneWhenPromptIncludes`, `repeatTool`, `largeLastToolOutput`, `taskDispatch`, and `echoPrompt`, using the existing refinement/error style. `delayMs` may coexist because it changes timing, not emitted content.

Pin and export fixture constants:

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
export const E2E_FAKE_EDIT_FAILURE_OUTPUT = 'String to replace not found in file.';

export const E2E_FAKE_WRITE_TOOL_NAME = 'Write';
export const E2E_FAKE_WRITE_INPUT = {
  file_path: 'notes/summary.md',
  content: '# Summary\n\nOne line.\n',
} as const;
export const E2E_FAKE_WRITE_OUTPUT = 'File created successfully at: notes/summary.md';

export const E2E_FAKE_BARE_EDIT_TOOL_NAME = 'edit';
export const E2E_FAKE_BARE_EDIT_OUTPUT = 'edited notes/summary.md';
```

Emit one paired successful call/result per variant, cloning object inputs:

- `edit`: `Edit` with the two-sided input and a successful result;
- `failed`: `Edit` with the same two-sided input, failure output, and `toolOutcome: 'error'`;
- `write`: `Write` with the one-sided input;
- `bare`: generic `edit` with no `toolInput` property.

Keep the existing assistant lead-in used by other fake tool scenarios. Provider tests assert exact event order, tool names, paired ids/results, input shapes, the absence (not `undefined` value) of the bare `toolInput` property, and every exclusivity rejection.

Create `e2e-file-edit.yaml` with `mutates_checkout: false` and four chained e2e-fake nodes for those variants. Register/copy it and add a typed `runFileEditWorkflow()` using the existing CLI runner. This fixture intentionally does not exercise a real Codex path.

## Playwright proof

Prefix titles with `[P1] file-edit:` so `--grep 'file-edit'` selects the suite.

### Behavior on both surfaces

- Both-sides row summary: exact `+2` and U+2212 `−2`; body bar contains `file · 1 hunk · replace_all: false`.
- Open body: path first; one `.tool-diff`; two delete, two insert, and two context cells in actual jsdiff order; delete text contains `min(31)` and `secs + 1`; insert text contains `min(30)` and `secs`; markers and snippet-relative numbers 1–4; no decoration for one hunk.
- Successful output prose is absent from the normalized open body. Raw removes the table and shows the original `old_string`; closing Raw restores the safe table.
- Failed edit row is initially open, retains the same diff, and shows `String to replace not found in file.` in the second inset body box.
- Write row: no diff badge/table; path and preview remain visible.
- Bare generic row: chip/path fallback is `edit`, preview is visible, and no diff is fabricated. Label this “generic no-input fallback” in tests/reports.
- While opening and toggling, no request leaves the app origin.

The identical, refused, multi-hunk, and malicious-control states are deterministic component contracts. Add more browser fixtures only if browser-specific styling/behavior cannot be proven with the four stored variants; do not bloat the provider scenario solely to duplicate pure logic tests.

### Required visual states and viewports

For each Legacy/Console surface:

1. At a 1440×1000 viewport, set the room to the design artifact's reference width—Legacy **460px**, Console **520px**—and capture the open changed row in both themes.
2. In the same desktop viewport, force both surfaces to the shared **460px** minimum and run geometry/overflow assertions.
3. At 390×844, capture the open changed row in both themes with the inherited narrow room layout.
4. At the surface's desktop reference width, capture the failed edit and inspect/record the one-sided and generic no-input fallbacks in both themes. Link component evidence for no-changes, refused, multi-hunk, and unsafe-control states in the same acceptance table.

At every tested width assert:

- room/panel/body have no horizontal overflow (`scrollWidth <= clientWidth + 2`);
- the summary remains one visual line and preserves chip, status, duration, counts, and chevron;
- table inner width matches the body content width within 2px;
- long code wraps inside code cells;
- marker plus fixed 3ch number area remains readable without consuming the code column;
- path, body bar, inset box, success/error rows, normal context, and signs match the design spines.

The visual report must show the mockup crop beside the implementation and explicitly explain the two evidence-backed differences: snippet-relative numbering because no offset exists, and grouped jsdiff ordering because the canonical library output must not be reordered.

### Accessibility and measured color

- Assert the native `details/summary` relationship remains and the diff has no focusable descendant; tab from summary/Raw proceeds to the existing next control.
- On both surfaces and themes, measure actual computed foreground/background pairs and require at least 4.5:1 for:
  - `+2` and `−2` at rest and hover;
  - inserted code and `+` marker on the insert background;
  - deleted code and `−` marker on the delete background;
  - line numbers on normal, insert, and delete gutter backgrounds;
  - normal context code on its background.
- If an inserted/deleted foreground fails, apply Phase 2's scoped mix toward `--text-primary`, then rerun the full matrix. Do not weaken the threshold or replace the required non-color signs.
- Record every ratio, resolved color, surface, theme, and state in `visual-acceptance.md`.

## Test and validation order

```bash
bun --filter @archon/providers test
cd packages/web && bun test src/lib/
cd packages/web && NODE_ENV=development bun test src/components/
cd packages/web && NODE_ENV=development bun test src/experiments/console/
bun --filter @archon/web test
bun run --cwd e2e typecheck
bun run --cwd e2e test:ui -- --grep 'file-edit'
bun run --cwd e2e test:ui:hitl
bun run validate
```

Do not run root `bun test`. Do not start a second dev server if the e2e harness already owns one; use the suite's deterministic ports and ensure any process started manually is stopped.

## Failure handling

- One-surface behavior failure: fix that local renderer and add/retain the component assertion before rerunning e2e.
- Wrong counts/order: inspect Phase 1 conversion against actual jsdiff output; do not massage DOM order in JSX.
- Contrast failure: adjust the scoped state foreground variable and remeasure every surface/theme/state.
- Overflow: fix the scoped table/gutter/code rules; do not add a panel-level scrollbar or a new breakpoint.
- Test near 5 seconds: capture JUnit healthy duration and identify bounded stalls or process cost; do not simply raise the timeout.
- Validation failure outside touched behavior: determine whether it is a regression or pre-existing with evidence; never hide or weaken it.

## Closeout

1. Write `implementation-evidence.md` with the resolved product-gate choice, commands and result summaries, focused/full test results, and links to visual evidence.
2. Write `visual-acceptance.md` with the state × surface × viewport × theme matrix, capture paths, contrast table, design comparison, and known resolved deviations.
3. Re-read Story 1.4/CAP-5 line by line and map each retained acceptance clause to evidence.
4. Only then update `sprint-status.yaml` (`1-4-view-a-file-edit-as-an-inline-diff: done` and its normal timestamp field).
5. Open the PR from the repository template with `Closes #177`, the owning contract docs under Review guidance, and evidence under Validation.

If the product gate was not resolved, actual Codex coverage remains claimed, or any acceptance item lacks evidence, stop before steps 4–5.

## Exit criteria

- [ ] Provider scenario tests, fixture, registration, and typed runner pass; reports call the bare row generic rather than Codex.
- [ ] Both surfaces pass at their artifact reference widths, the shared 460px room width, and 390×844 responsive viewport in both themes.
- [ ] Visual report covers every required state, design comparison, the two resolved discrepancies, and all measured ratios.
- [ ] Focus order, no-network behavior, no horizontal overflow, wrapping, and Raw round-trip pass.
- [ ] Focused packages, e2e typecheck, file-edit UI, existing HITL rooms, and `bun run validate` are green.
- [ ] Authoritative contract and shipped behavior agree; sprint status and PR closeout occur only after that proof.
