# Visual Acceptance — Inline File-Edit Diff (Story 1.4 / CAP-5 / UX-DR3)

All captures live in `reports/captures/`. Measurements were taken by
`e2e/ui/file-edit-diff.spec.ts` against the real served bundle; the raw data
is `file-edit-measurements.json`.

## Surface × theme axis

The app ships **dark-only** (`index.css` line 9 comment; EXPERIENCE.md:38 —
both token sources are dark-only). The required theme matrix is therefore the
two independently defined dark token sources, each resolved in the browser:

- **Legacy** — `packages/web/src/index.css`
- **Console** — `packages/web/src/experiments/console/theme.css`

Every row below is measured, not asserted from source.

## Capture matrix

| State                                 | Surface | Viewport          | Theme source | Capture                          |
| ------------------------------------- | ------- | ----------------- | ------------ | -------------------------------- |
| Edit row collapsed (+2 / −2 badges)   | Legacy  | 1440×1000         | index.css    | `legacy-file-edit-closed.png`    |
| Edit row open (diff)                  | Legacy  | 1440×1000 @ 460px | index.css    | `legacy-file-edit-open-460.png`  |
| Edit row open (diff)                  | Legacy  | 390×844           | index.css    | `legacy-file-edit-open-390.png`  |
| Failed edit open (diff + failure box) | Legacy  | 1440×1000         | index.css    | `legacy-file-edit-failed.png`    |
| Write row (path + preview, no diff)   | Legacy  | 1440×1000         | index.css    | `legacy-file-edit-write.png`     |
| Bare row (generic no-input fallback)  | Legacy  | 1440×1000         | index.css    | `legacy-file-edit-bare.png`      |
| Contrast sweep                        | Legacy  | 1440×1000         | index.css    | `legacy-file-edit-contrast.png`  |
| Edit row collapsed (+2 / −2 badges)   | Console | 1440×1000         | theme.css    | `console-file-edit-closed.png`   |
| Edit row open (diff)                  | Console | 1440×1000 @ 520px | theme.css    | `console-file-edit-open-520.png` |
| Edit row open (diff)                  | Console | 1440×1000 @ 460px | theme.css    | `console-file-edit-open-460.png` |
| Edit row open (diff)                  | Console | 390×844           | theme.css    | `console-file-edit-open-390.png` |
| Failed edit open (diff + failure box) | Console | 1440×1000         | theme.css    | `console-file-edit-failed.png`   |
| Write row (path + preview, no diff)   | Console | 1440×1000         | theme.css    | `console-file-edit-write.png`    |
| Bare row (generic no-input fallback)  | Console | 1440×1000         | theme.css    | `console-file-edit-bare.png`     |
| Contrast sweep                        | Console | 1440×1000         | theme.css    | `console-file-edit-contrast.png` |

## Geometry (measured)

| Surface | Viewport                   | Table width | Body content width | Δ     | H-scroll | Code wrap                             | Gutter (marker+number) |
| ------- | -------------------------- | ----------- | ------------------ | ----- | -------- | ------------------------------------- | ---------------------- |
| Console | 1440×1000 ref (520px room) | 433px       | 433px              | 0px   | 0        | `pre-wrap` + `overflow-wrap:anywhere` | 27.6px (6.9 + 20.7)    |
| Console | 460px shared               | 373px       | 373px              | 0px   | 0        | same                                  | same                   |
| Console | 390×844                    | 303px       | 303px              | 0px   | 0        | same                                  | same                   |
| Legacy  | 1440×1000 ref (460px room) | 372.7px     | 373px              | 0.3px | 0        | same                                  | same                   |
| Legacy  | 460px shared               | 372.7px     | 373px              | 0.3px | 0        | same                                  | same                   |
| Legacy  | 390×844                    | 303px       | 303px              | 0px   | 0        | same                                  | same                   |

Table tracks the body content width within 2px everywhere; long code wraps
inside cells; the fixed marker + 3ch line-number gutter stays readable; no
horizontal overflow in room, panel, body, or table; summaries remain one
visual line (28.5px closed-row height on both surfaces).

## Contrast — measured ratios (floor 4.5:1, never lowered)

### Legacy (index.css tokens)

| Element             | Resolved color                 | Background                   | Ratio |
| ------------------- | ------------------------------ | ---------------------------- | ----- |
| `+2` badge at rest  | `oklch(0.65 0.17 155)`         | `oklch(0.14 0.005 260)`      | 6.70  |
| `−2` badge at rest  | `oklch(0.6825 0.15125 353.75)` | same                         | 6.45  |
| `+2` badge on hover | `oklch(0.65 0.17 155)`         | `oklch(0.24 0.01 260)`       | 5.56  |
| `−2` badge on hover | `oklch(0.6825 0.15125 353.75)` | same                         | 5.35  |
| Inserted code       | `oklch(0.65 0.17 155)`         | `oklch(0.1836 0.0248 247.4)` | 6.30  |
| Deleted code        | `oklch(0.6495 0.17075 6.25)`   | `oklch(0.1776 0.0284 275)`   | 5.37  |
| Context code        | `oklch(0.93 0.005 260)`        | `oklch(0.12 0.005 260)`      | 16.52 |
| Insert marker       | `oklch(0.65 0.17 155)`         | `oklch(0.1836 0.0248 247.4)` | 6.30  |
| Delete marker       | `oklch(0.6495 0.17075 6.25)`   | `oklch(0.1776 0.0284 275)`   | 5.37  |
| Insert line number  | `oklch(0.65 0.01 260)`         | `oklch(0.1836 0.0248 247.4)` | 5.77  |
| Delete line number  | `oklch(0.65 0.01 260)`         | `oklch(0.1776 0.0284 275)`   | 5.84  |
| Context line number | `oklch(0.65 0.01 260)`         | `oklch(0.12 0.005 260)`      | 6.26  |

Legacy minimum: **5.35** (delete hue on hover background).

### Console (theme.css tokens)

| Element             | Resolved color                  | Background                    | Ratio |
| ------------------- | ------------------------------- | ----------------------------- | ----- |
| `+2` badge at rest  | `oklch(0.755 0.165 168)`        | `oklch(0.175 0.007 265)`      | 9.50  |
| `−2` badge at rest  | `oklch(0.75375 0.16225 349.75)` | same                          | 8.02  |
| `+2` badge on hover | `oklch(0.755 0.165 168)`        | `oklch(0.225 0.01 265)`       | 8.54  |
| `−2` badge on hover | `oklch(0.75375 0.16225 349.75)` | same                          | 7.21  |
| Inserted code       | `oklch(0.755 0.165 168)`        | `oklch(0.205 0.02508 253.36)` | 8.94  |
| Deleted code        | `oklch(0.72425 0.18335 1.05)`   | `oklch(0.196 0.03108 278.56)` | 6.83  |
| Context code        | `oklch(0.975 0.004 265)`        | `oklch(0.13 0.006 265)`       | 18.77 |
| Insert marker       | `oklch(0.755 0.165 168)`        | `oklch(0.205 0.02508 253.36)` | 8.94  |
| Delete marker       | `oklch(0.72425 0.18335 1.05)`   | `oklch(0.196 0.03108 278.56)` | 6.83  |
| Insert line number  | `oklch(0.745 0.014 265)`        | `oklch(0.205 0.02508 253.36)` | 7.87  |
| Delete line number  | `oklch(0.745 0.014 265)`        | `oklch(0.196 0.03108 278.56)` | 8.04  |
| Context line number | `oklch(0.745 0.014 265)`        | `oklch(0.13 0.006 265)`       | 8.86  |

Console minimum: **6.83** (deleted code/marker).

### Contrast correction applied during this story

Pure `var(--error)` measured ~4.32:1 on Legacy's 12% delete tint over
`--surface-inset`. The delete foreground now resolves through
`--tool-diff-delete-fg: color-mix(in oklch, var(--error) 85%, var(--text-primary))`
(`index.css`, `.tool-diff` block) — Legacy 5.37/5.84, Console 6.83/8.04 —
keeping the error hue and the `+`/`−` non-color cues intact.

## Mockup comparison

The shipped row anatomy matches the 460px mockup contract verified by
`agent-tool-row-visual.spec.ts` (`hitl.tool-row-mockups`): disclosure summary
on one line with family chip, headline, `+n`/`−m` badges, and Raw toggle;
body opens with the facts bar (`file · 1 hunk · replace_all: false · Nms`),
then the path, then the bounded diff table. Deviations from the literal
mockup drawings, both planned and documented in the phase plans:

1. **Snippet-relative line numbers** — the gutter shows each hunk's own
   old/new counters (1,2,3 / 2,3,4 in the proof), not whole-file line
   numbers, per the `git-hunk-adapter` contract.
2. **Grouped jsdiff ordering** — within a change block, delete rows render
   before insert rows (markers `['', '−', '−', '+', '+', '']`), matching
   `diffLines` output, not interleaved source order.

## Fallback states (honest, never fabricated)

| State                        | Both surfaces                                                                                            |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| One-sided Write              | path + preview only, no badge, no table (`*-file-edit-write.png`)                                        |
| Bare `edit`, no stored input | chip `edit` + preview — **generic no-input fallback** (`*-file-edit-bare.png`)                           |
| Failed qualified edit        | attempted diff + `String to replace not found in file.` in a second inset box (`*-file-edit-failed.png`) |

Component-level evidence for the remaining pathological states lives in
`NodeRoom.test.tsx` / `ConsoleExecutionHistory.test.tsx` /
`diff-boundary.test.ts` / `console-isolation.test.ts`:

- **Identical before/after** → `no changes`, no hunk rows.
- **Refused pair / wrong-typed or inherited keys** → path + preview, no diff.
- **Multi-hunk** → `Decoration` separator row with `@@` only before each
  later hunk; single hunk undecorated (0 `tbody.diff-decoration` in the e2e
  DOM probe).
- **Malicious control content** → ANSI/C0/C1 stripped, `Cf`/`U+2028`/`U+2029`
  escaped as `\u{HEX}` on display lines; diffing still runs on raw strings;
  Raw keeps the exact payload.
- **Byte/line/maxEditLength caps** → deterministic fallback to path +
  preview, never a wall-clock timeout.

## Accessibility

Native `details`/`summary` disclosure intact; the diff subtree carries **0**
focusable descendants on both surfaces. Tab order is summary → Raw → `Re-run`
on Console; on Legacy the successful row has no trailing action, so Tab leaves
the tool row. Badges carry `+`/`−` glyphs, not color-only signals.
