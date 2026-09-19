---
phase: 2
title: 'Phase 2: Inline diff on Legacy and Console'
status: done
priority: P1
effort: '1d'
dependencies: [1]
---

# Phase 2: Inline diff on Legacy and Console

## Goal

Render Phase 1's safe hunk data through `react-diff-view` on both node-room surfaces. Both must show the same content and states while retaining separate thin JSX implementations as required by UX-DR3 and Console isolation.

## Pre-edit integration check

- Confirm Phase 1's body type, adapter path, and success tone compile and its tests are green.
- Re-check both `ToolBodySwitch` call sites and memo dependencies. They must still receive the row outcome needed for failed-output handling.
- Re-check the exact runtime/type/style import pattern in `virtualized-diff.tsx`.
- Re-check `console-isolation.test.ts`'s approved `@/lib/*` imports and add only the pure adapter.
- Re-read the file-diff sections in `EXPERIENCE.md`, `DESIGN.md`, the HTML mockup, and the accessibility review. The spines win over the mockup discrepancies recorded in `plan.md`.

## Files

| Path                                                                                                                                                                   | Change                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `packages/web/src/components/workflows/NodeRoom.tsx`                                                                                                                   | Legacy-local inline renderer and file arm  |
| `packages/web/src/components/workflows/NodeRoom.test.tsx`, `packages/web/src/components/workflows/LegacyNodeRoom.test.tsx`                                             | static anatomy and interaction             |
| `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx`                                                                                  | Console-local inline renderer and file arm |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx`, `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.test.tsx` | Console anatomy/interaction in both hosts  |
| `packages/web/src/experiments/console/console-isolation.test.ts`                                                                                                       | allow pure adapter only                    |
| `packages/web/src/lib/diff-boundary.test.ts`                                                                                                                           | source ownership/import boundaries         |
| `packages/web/src/index.css`                                                                                                                                           | shared scoped diff visuals                 |

Do not create a shared React component. Share only Phase 1's pure data and adapter.

## Renderer contract

Each renderer imports values from `react-diff-view/esm/index.js`, types from `react-diff-view`, the package stylesheet, `toHunkData` from `@/lib/git-hunk-adapter`, and the file-diff type from `@/lib/tool-presentation`. Neither renderer imports `diff` or `@/lib/diff-hunks`.

### File body states

Use block children inside the existing inset body box so the table is not embedded in a preformatted text node:

1. Always render the path first with `text-node-command` and `overflow-wrap: anywhere`.
2. `diff !== null && hunks.length > 0`: render `InlineDiff`.
3. `diff !== null && hunks.length === 0`: render the secondary text `no changes`.
4. `diff === null`: render exactly the current semantic fallback—unreadable message, `no preview`, or preview.
5. When a valid diff exists, outcome is not `succeeded`, and either a preview or unreadable state exists, render a second inset box below it with the normalized output/unreadable message. Do not add an empty `no preview` box. On success, keep provider success prose behind Raw.

The fallback may gain block wrappers needed for valid table layout, but its text, order, tones, and behavior must remain unchanged.

### `InlineDiff`

- Convert each hunk through `toHunkData`.
- Render `<Diff diffType="modify" viewType="unified" ... className="tool-diff">`.
- Render the first hunk directly. Before every later hunk, render a text-only `Decoration` containing that hunk's synthesized `@@ ... @@` header, then the `Hunk`.
- Supply a local `renderGutter`. In the old gutter cell, show a one-character marker and a right-aligned number: `+` and the inserted line number, `−` (U+2212) and the deleted line number, or a blank marker and the old context number. Return `null` for the new gutter and hide its cell/column with scoped CSS.
- Keep the `+`/`−` text exposed to assistive technology because it is the required non-color cue.
- Do not add anchors, tokens, syntax highlighting, virtualization, split view, or focusable controls.

The fixture's v9 order is context, both deletes, both inserts, context. Tests must assert that library order rather than the mockup's alternating illustration.

## Visual contract

Add one `.tool-diff` block beside the existing tool-family body styles in `index.css`:

- map background and selection variables to existing surface/ring tokens;
- use the inset surface mixed with success/error at a restrained tint for insert/delete backgrounds;
- use success-colored inserted code and markers, error-colored deleted code and markers, and primary-colored context code;
- keep line numbers in `--text-secondary` (never `--text-tertiary`) and right-align them in the 3ch number area; allocate one additional marker character without allowing the gutter to grow with content;
- hide the unused second gutter column/cells using selectors verified against the rendered v3.3.3 DOM;
- keep `width: 100%`, fixed table layout, `white-space: pre-wrap`, and `overflow-wrap: anywhere`; do not add room-level horizontal scrolling;
- keep decoration text secondary and noninteractive.

Define local foreground custom properties for the inserted/deleted states so contrast correction is one scoped change. Start from `var(--success)` and `var(--error)`. Phase 3 measures the actual computed foreground/background pair in both themes and surfaces. If either is below 4.5:1, mix only that affected foreground toward `var(--text-primary)` until it passes, then re-run all measurements. The same state foreground applies to code and marker; the line number remains secondary and is measured separately.

## Tests first

Use the four-line backoff fixture for one hunk and a 20-line fixture for two hunks. Keep no more than three diff rows in a single test.

### Legacy static — `NodeRoom.test.tsx`

- Succeeded both-sides row: path first; `.tool-diff`; two delete, two insert, and two context code cells in jsdiff order; `−`/`+`; snippet numbers 1–4; no decoration for one hunk; no success prose; no serialized `old_string` JSON.
- Summary/body bar: `+2` success badge, `−2` danger badge, `file · 1 hunk · replace_all: false`, with counts not duplicated in the bar.
- Failed row: the same table plus the normalized error in a second body box.
- Multi-hunk row: one decoration before the second hunk with the expected header.
- Identical row: no table/badge; `file · no changes`; explicit `no changes`.
- One-sided Write, generic no-input edit, and over-limit refused pair: no table/badge and unchanged path-plus-preview fallback.
- A malicious-control fixture produces the expected visible escapes and exactly one DOM row per converted change.

### Legacy interaction — `LegacyNodeRoom.test.tsx`

- Opening mounts the table.
- Raw replaces it with the original payload, including unsanitized source where applicable; toggling back restores the safe table.
- Keyboard order remains summary → Raw → existing full-output/retry controls; the diff contributes no tab stop.

### Console — room and execution-history tests

Repeat the same anatomy/state/Raw assertions in `ConsoleNodeRoom.test.tsx`; verify the inline history host in `ConsoleExecutionHistory.test.tsx` uses the same content and class hooks. This catches divergence between Console mounting paths.

### Boundary tests

- Add `@/lib/git-hunk-adapter` to Console's approved set with a concrete comment that it is the pure conversion shared with source control.
- Scan production `src/**/*.{ts,tsx}` excluding tests: only `lib/diff-hunks.ts` may contain a `structuredPatch` call/import.
- Assert both renderers import neither `diff` nor `@/lib/diff-hunks`.
- Assert the moved adapter imports generated types from `@/lib/api.generated`, not runtime `@/lib/api`.
- Assert Console's third-party diff imports are limited to the v3.3.3 runtime/type/style specifiers already proven by source control.

Do not attempt contrast assertions in happy-dom; it does not resolve the required browser CSS/color APIs.

## Implementation order

1. Add failing Legacy static tests; implement its file states, local renderer, and shared scoped CSS.
2. Add failing Legacy Raw/focus tests; make them green.
3. Add failing Console room/history tests; implement its local renderer with the same contract.
4. Add isolation and source-boundary tests.
5. Run the focused component legs, full web package, type-check, lint, and format.

## Commands

```bash
cd packages/web && NODE_ENV=development bun test src/components/workflows/NodeRoom.test.tsx src/components/workflows/LegacyNodeRoom.test.tsx
cd packages/web && NODE_ENV=development bun test src/experiments/console/
cd packages/web && bun test src/lib/diff-boundary.test.ts
bun --filter @archon/web test
bun run type-check
bun run lint
bun run format:check
```

## Exit criteria

- [x] Both surfaces pass all changed, failed, multi-hunk, identical, one-sided, no-input, refused, and malicious-control state assertions.
- [x] Insert/delete code and markers use their required success/error treatments; context, number column, inset box, hunk separator, and wrapping match the design spines.
- [x] Raw swap/restore and focus order are unchanged.
- [x] Console isolation, single-owner, generated-type, and renderer-import boundaries pass.
- [x] Existing source-control diff tests and the complete web package remain green.
- [x] No component test timeout is widened.

## Risks and safeguards

- `react-diff-view` adds two gutter cells even in unified mode; verify selectors against rendered DOM and assert only one visible gutter rather than relying on an undocumented guess.
- Large component files already approach costly test setup. If duration becomes suspicious, use `--reporter=junit` and compare healthy durations before changing any timeout.
- The package stylesheet is already used by Legacy source control; import it by the existing specifier rather than copying upstream CSS. All node-room overrides stay under `.tool-diff`.

## Handoff to Phase 3

Keep these stable browser hooks: `.tool-diff`, `.tool-diff-marker`, `.tool-diff-line-number`, `.diff-code-insert`, `.diff-code-delete`, `.diff-code-normal`, and `.diff-decoration`. Phase 3 also locates summary badges by exact `+2` and `−2` text.
