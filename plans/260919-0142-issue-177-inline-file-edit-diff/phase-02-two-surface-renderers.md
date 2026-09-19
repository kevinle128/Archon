---
phase: 2
title: 'Phase 2: Inline diff on Legacy and Console'
status: pending
priority: P1
effort: '1d'
dependencies: [1]
---

# Phase 2: Inline diff on Legacy and Console

## Goal

Render the file body's `diff` as a unified inline diff through `react-diff-view` on both node-room surfaces, with the same anatomy on each: path line, then a `.tool-diff` table with one `3ch` line-number column, `+`/`−` markers, tinted insert/delete lines, a `@@` separator only between hunks, an explicit `no changes` note for an empty diff, and the output text beneath the diff when the row did not succeed. Rows without a diff render exactly as before. Add the new `success` badge tone to both tone maps and prove the module boundaries with source-scan tests.

## Pre-edit integration check (scout pass at execution time)

Before editing, confirm against the current tree:

- Phase 1 landed: `FileDiff` and the `diff` field exist on the `file` body arm; `@/lib/git-hunk-adapter` exists; both `BADGE_TONE` maps already carry `success` (added in Phase 1 step 5).
- `ToolBodySwitch` in both renderers still keys its `useMemo` on `[input.name, input.input, input.output, presentation.family]` and still receives `presentation.statusLabel` — the failed-edit rule needs the outcome.
- `console-isolation.test.ts` approved set still lists `@/lib/tool-presentation` and `@/lib/tool-output`; add `@/lib/git-hunk-adapter` with a concrete-need comment in the same style as the `#176` entry.
- `virtualized-diff.tsx` still imports `Diff` from `react-diff-view/esm/index.js` and the style side effect — mirror those exact specifiers.
- `index.css` still hosts the `.tool-family-body` block; append the `.tool-diff` block right after it.

## Files

| Path                                                                                                                                                     | Action                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `packages/web/src/components/workflows/NodeRoom.tsx`                                                                                                     | `file` arm renders the diff; local `InlineDiff`; imports                  |
| `packages/web/src/components/workflows/NodeRoom.test.tsx`, `LegacyNodeRoom.test.tsx`                                                                     | static anatomy and interaction tests                                      |
| `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx`                                                                    | same, Console-local                                                       |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx`, `components/inspect/ConsoleExecutionHistory.test.tsx`                        | Console tests                                                             |
| `packages/web/src/experiments/console/console-isolation.test.ts`                                                                                         | approve `@/lib/git-hunk-adapter`; add the diff boundary assertions        |
| `packages/web/src/index.css`                                                                                                                             | `.tool-diff` scoped block                                                 |

No shared React component: each surface owns its `InlineDiff` and `renderGutter`, mirroring how Story 1.3 kept `ToolBodySwitch` per surface.

## Markup contract (identical on both surfaces)

### Imports (each renderer)

```ts
import { Decoration, Diff, Hunk } from 'react-diff-view/esm/index.js';
import type { HunkData, RenderGutter } from 'react-diff-view';
import 'react-diff-view/style/index.css';
import { toHunkData } from '@/lib/git-hunk-adapter';
import { type FileDiff, /* existing names */ } from '@/lib/tool-presentation';
```

Neither renderer imports `diff` or `@/lib/diff-hunks`.

### File arm

```tsx
case 'file':
  return (
    <>
      <div className={TOOL_BODY_BOX} style={{ overflowWrap: 'anywhere' }}>
        <span className="text-node-command">{body.path}</span>
        {'\n'}
        {body.diff !== null ? (
          body.diff.hunks.length === 0
            ? <span className="text-text-secondary">no changes</span>
            : <InlineDiff diff={body.diff} />
        ) : body.unreadable ? (
          <span className="text-text-secondary">output unreadable — open Raw</span>
        ) : body.preview === null ? (
          <span className="text-text-secondary">no preview</span>
        ) : (
          body.preview
        )}
      </div>
      {body.diff !== null && presentation.statusLabel !== 'succeeded' && body.preview !== null ? (
        <div className={cn(TOOL_BODY_BOX, 'mt-1.5')} style={{ overflowWrap: 'anywhere' }}>
          {body.unreadable ? 'output unreadable — open Raw' : body.preview}
        </div>
      ) : null}
    </>
  );
```

(Console uses its own class-joining idiom instead of `cn` where that file already does.)

### `InlineDiff`

```tsx
function InlineDiff({ diff }: { diff: FileDiff }): React.ReactElement {
  const hunks = diff.hunks.map(toHunkData);
  return (
    <Diff diffType="modify" viewType="unified" hunks={hunks} renderGutter={renderInlineGutter} className="tool-diff">
      {rendered =>
        rendered.flatMap((hunk, index) =>
          index === 0
            ? [<Hunk key={`h${index}`} hunk={hunk} />]
            : [
                <Decoration key={`d${index}`}>
                  <span className="text-text-secondary">{hunk.content}</span>
                </Decoration>,
                <Hunk key={`h${index}`} hunk={hunk} />,
              ]
        )
      }
    </Diff>
  );
}

const renderInlineGutter: RenderGutter = ({ change, side, renderDefault }) => {
  if (side !== 'old') return null; // the second gutter cell is hidden by CSS
  const marker = change.type === 'insert' ? '+' : change.type === 'delete' ? '−' : ' ';
  const number = change.type === 'insert' ? change.lineNumber : renderDefault();
  return (
    <>
      <span className="tool-diff-marker">{marker}</span>
      <span className="tool-diff-line-number">{number}</span>
    </>
  );
};
```

- The marker is **not** `aria-hidden`: it is the non-color cue and the sign is information for assistive technology (the chevron precedent hides a redundant glyph; this one is not redundant). Use U+2212 for delete to match the `−m` badge.
- `hunk.content` is the synthesized `@@ -a,b +c,d @@` header from Phase 1, rendered only for `index > 0`.
- No `tokens`, no `renderToken`, no virtualization, no `gutterType='anchor'`.

### Scoped CSS (`index.css`, after the `.tool-family-body` block)

```css
/* Inline file-edit diff inside a tool body box (both surfaces). Colors map
   the react-diff-view variables onto tokens both themes define. */
.tool-diff {
  --diff-background-color: transparent;
  --diff-text-color: var(--text-primary);
  --diff-font-family: inherit;
  --diff-selection-background-color: color-mix(in oklch, var(--ring) 35%, transparent);
  --diff-gutter-insert-background-color: color-mix(in oklch, var(--success) 14%, var(--surface-inset));
  --diff-gutter-delete-background-color: color-mix(in oklch, var(--error) 14%, var(--surface-inset));
  --diff-code-insert-background-color: color-mix(in oklch, var(--success) 14%, var(--surface-inset));
  --diff-code-delete-background-color: color-mix(in oklch, var(--error) 14%, var(--surface-inset));
  --diff-gutter-insert-text-color: var(--text-secondary);
  --diff-gutter-delete-text-color: var(--text-secondary);
  --diff-code-insert-text-color: var(--text-primary);
  --diff-code-delete-text-color: var(--text-primary);
  font-size: inherit;
  line-height: inherit;
}
.tool-diff .diff-gutter { color: var(--text-secondary); text-align: right; white-space: pre; padding-right: 0.5ch; }
.tool-diff col.diff-gutter-col:first-child { width: 4.5ch; } /* marker + 3ch number */
.tool-diff col.diff-gutter-col:nth-child(2),
.tool-diff .diff-line > .diff-gutter:nth-child(2) { display: none; }
.tool-diff .diff-code { white-space: pre-wrap; overflow-wrap: anywhere; word-break: normal; }
.tool-diff .diff-gutter-insert .tool-diff-marker { color: var(--success); }
.tool-diff .diff-gutter-delete .tool-diff-marker { color: var(--error); }
.tool-diff .diff-decoration { color: var(--text-secondary); }
```

Measure before finalizing the two marker colors (see "Contrast check" below). Line numbers use `--text-secondary`, never `--text-tertiary` (2.71:1 on inset per `review-accessibility.md`).

### Badge tone

Both `BADGE_TONE` maps: `success: { className: 'text-success' }` — the same utility both surfaces' `GLYPH_TONE.succeeded` already uses for the `✓` glyph, so the badge and the glyph share the tone the visual e2e already measures.

## Tests first

Follow the existing test style in each file: `renderToStaticMarkup` + string assertions in `NodeRoom.test.tsx`, happy-dom interaction in `LegacyNodeRoom.test.tsx` and the Console room tests. Use the Phase 1 fixture (`backoff` example) so the expected counts are known: 2 inserts, 2 deletes, 2 normal lines, 1 hunk.

### Legacy static anatomy — `NodeRoom.test.tsx`

- Both-sides row (`Edit`, `old_string`/`new_string`, `replace_all: false`, output `'The file a.rs has been updated successfully.'`, outcome succeeded): the body contains `text-node-command">crates/…/auto_retry.rs<`, a `class="tool-diff` table, exactly two `diff-code-insert`, two `diff-code-delete`, two `diff-code-normal` cells, markers `+` and `−` (U+2212) inside `tool-diff-marker`, line numbers `1`…`4` in `tool-diff-line-number`, **no** `diff-decoration` (single hunk), and the output prose (`has been updated`) is **absent** from the body (it is behind Raw).
- Same row with outcome `failed` and output `'String to replace not found in file.'`: the diff table is present **and** a second body box contains the error text below it.
- Multi-hunk row (the 20-line fixture): exactly one `diff-decoration` row whose text is the second hunk's `@@ -…` header.
- Identical sides: no table; `>no changes<` present; no `+`/`−` badge in the summary; body bar text contains `file · no changes`.
- Collapsed summary: `+2` with the success tone class and `−2` with the danger style; body bar reads `file · 1 hunk · replace_all: false` and does not repeat `+2`.
- One-sided `Write` (`content` only) and a no-input `edit` row: markup is byte-identical to the pre-change expectations already in the file (path then preview / `no preview`), and contains no `tool-diff`.
- No serialized JSON anywhere in the presented body (`'"old_string"'` absent).

### Legacy interaction — `LegacyNodeRoom.test.tsx`

- Opening the row mounts the diff table; toggling Raw swaps it for the `<pre>` payload (the table is unmounted, not hidden) and closing Raw restores it.
- Keyboard order unchanged: summary → Raw → full-output/retry controls; the table adds no tab stops (no anchors in the gutter).

### Console — `ConsoleNodeRoom.test.tsx` and `ConsoleExecutionHistory.test.tsx`

- The same anatomy assertions as Legacy static, using the Console helpers (`textContent`/`querySelectorAll` on happy-dom), for the both-sides, failed, identical, one-sided, and no-input rows.
- Raw swap and restore.
- The inline execution-history variant renders the diff the same way (the Console mounts the history list in more than one place).

### Boundary — `console-isolation.test.ts`

- Add `'@/lib/git-hunk-adapter'` to the approved set with a comment: "Concrete need (issue #177): the inline file-edit diff converts `GitDiffHunk` to react-diff-view `HunkData` with the same adapter Legacy source-control uses; it is a pure `lib/` module."
- Add a test `diff computation stays in one module`: scan `packages/web/src/**/*.{ts,tsx}` (production sources) and assert `structuredPatch` appears only in `lib/diff-hunks.ts`; assert `NodeRoom.tsx` and `ConsoleAgentHistoryList.tsx` import neither `'diff'` nor `'@/lib/diff-hunks'`; assert `lib/git-hunk-adapter.ts` imports its types from `@/lib/api.generated` and not `@/lib/api`; and assert `ConsoleAgentHistoryList.tsx`'s only `react-diff-view` imports are the named `Decoration`/`Diff`/`Hunk` values from `react-diff-view/esm/index.js`, types from `react-diff-view`, and the `style/index.css` side effect — the first third-party UI dependency inside Console, so the boundary test names it explicitly (security finding 7). Place it beside the existing isolation tests (same file or a sibling `diff-boundary.test.ts` in `src/lib/` — pick one; the console leg of the test script is a separate process either way).

### Contrast rule (measured in Phase 3, not here)

`color-mix(in oklch, …)` resolution and the `resolveColorIn`/`contrastRatio` helpers need a real browser CSS engine and a `<canvas>` 2D context; under `bun test` + happy-dom they cannot measure anything (red-team failure finding 2), so no component test asserts contrast. Phase 3's Playwright spec measures the `+`/`−` markers over their tinted cells, the line text, and the line numbers on both themes. The fallback rule is fixed now so Phase 3 can apply it without a design decision: if `var(--error)` over the delete tint measures below 4.5:1 on either theme, the `−` marker uses `color-mix(in oklch, var(--error) 75%, var(--text-primary))` (the existing danger mix) and the badge keeps the danger tone.

## Implementation order

1. Write the Legacy static tests (red). Add imports, `InlineDiff`, `renderInlineGutter`, the `file` arm, the tone entry; add the `.tool-diff` CSS. Green.
2. Write the Legacy interaction tests (red → green).
3. Repeat for Console: tests first, then the local `InlineDiff`, the arm, the tone entry.
4. Isolation allowlist and boundary test.
5. `bun run type-check`, `bun run lint`, `bun run format:check`.

## Commands

```bash
cd packages/web && NODE_ENV=development bun test src/components/workflows/NodeRoom.test.tsx src/components/workflows/LegacyNodeRoom.test.tsx
cd packages/web && NODE_ENV=development bun test src/experiments/console/
bun --filter @archon/web test
bun run type-check && bun run lint && bun run format:check
```

## Exit criteria

- [ ] Both surfaces render the both-sides, failed, multi-hunk, identical, one-sided, and no-input rows per the markup contract, with tests asserting counts, markers, numbers, separator presence/absence, and the absence of output prose on success.
- [ ] Raw swap/restore works on both surfaces with the diff mounted; keyboard order unchanged.
- [ ] `console-isolation.test.ts` passes with the new allowlist entry; the boundary test proves one `structuredPatch` site and no `diff` import in either renderer.
- [ ] Both `BADGE_TONE` maps carry `success`; `bun run type-check` and lint are green.
- [ ] The contrast fallback rule above is in the CSS comment so Phase 3 can apply it mechanically.

## Risks and safeguards

- `NodeRoom.test.tsx`, `LegacyNodeRoom.test.tsx`, and `ConsoleNodeRoom.test.tsx` are already large, and this is the first time they mount a real `react-diff-view` table (red-team failure finding 4). `file-viewer.test.tsx` proves the table renders under bun, so the risk is duration, not feasibility: keep every diff fixture to the 4-line `backoff` example or the 20-line two-hunk one, mount at most three diff rows per test, and if any file approaches Bun's 5,000 ms per-test default, run it with `--reporter=junit` to read real durations before touching timeouts (AGENTS.md's bimodal-vs-gradient rule).

- `react-diff-view`'s `.diff` table is `width: 100%; table-layout: fixed`; inside the `pre-wrap` body box that is what keeps long lines wrapping instead of forcing a panel-level scrollbar. Phase 3 verifies at 390px.
- The `style/index.css` side-effect import is already loaded by Legacy source-control; importing it again from the node rooms is idempotent. Do not copy its rules into `index.css`.
- `Decoration` renders a full-width row; keep it text-only so it never introduces a focusable element.

## Handoff to Phase 3

Phase 3 needs the DOM hooks used here: `.tool-diff`, `.tool-diff-marker`, `.tool-diff-line-number`, `.diff-code-insert`/`-delete`/`-normal`, `.diff-decoration`, and the summary badge texts `+2` / `−2`. Keep those class names stable.
