# US-003 Contrast Evidence — `.tool-family-body` on `--surface-inset`

**Date:** 2025-09-26
**Method:** oklch → OKLab → linear sRGB → WCAG 2.x relative luminance, `ratio = (L_hi + 0.05) / (L_lo + 0.05)`.
**Background:** `--surface-inset = oklch(0.12 0.005 260)` (the body box `bg-surface-inset`). Ratios against the surrounding transcript surfaces (`--card`, `--background`) are included for completeness; the box itself is the binding surface.

## Colors used for required body content

| Tone                                                                                                      | Token / mix                                                        | Ratio vs `--surface-inset` | ≥ 4.5:1 |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------- | ------- |
| Body text, patterns, field values                                                                         | `--text-primary` oklch(0.93 0.005 260)                             | **16.52**                  | yes     |
| Labels, statuses, `+n more` / `more results omitted`, link destinations, `[image omitted]`, hljs comments | `--text-secondary` oklch(0.65 0.01 260)                            | **6.28**                   | yes     |
| Shell prompt `$`                                                                                          | `--node-bash` oklch(0.75 0.15 75)                                  | **8.92**                   | yes     |
| File paths, match paths, web URL                                                                          | `--node-command` oklch(0.62 0.18 250)                              | **5.56**                   | yes     |
| `FAILED` marker                                                                                           | `color-mix(in oklch, var(--error) 75%, var(--text-primary))`       | **6.65**                   | yes     |
| hljs keyword / title / built_in                                                                           | `color-mix(in oklch, var(--node-prompt) 70%, var(--text-primary))` | **6.90**                   | yes     |
| hljs string / number / literal                                                                            | `--success` oklch(0.65 0.17 155)                                   | **6.76**                   | yes     |
| `View full output` / `Retry` links                                                                        | `--primary` oklch(0.65 0.18 250)                                   | **6.27**                   | yes     |
| Full-output load error                                                                                    | `--error` oklch(0.6 0.2 25)                                        | **4.66**                   | yes     |
| `running` status glyph                                                                                    | `--accent-bright` oklch(0.72 0.18 250)                             | **8.19**                   | yes     |

## Tones measured and deliberately not used for required content

| Tone                                   | Ratio vs `--surface-inset` | Disposition                                                    |
| -------------------------------------- | -------------------------- | -------------------------------------------------------------- |
| `--text-tertiary` oklch(0.45 0.01 260) | 2.73                       | aria-hidden decorations only (row chevron, badge separators)   |
| `--node-prompt` unmixed                | 4.40                       | never emitted directly — hljs keywords use the 70/30 mix above |

## Notes

- `rehype-highlight` runs with `detect: false`; only explicit language fences get `.hljs-*` spans, all of which resolve to tones in the first table.
- The body box declares `color: var(--text-primary)` on `.tool-family-body` and `background: transparent` on `.tool-family-body .hljs`, so highlighted code always resolves against `--surface-inset`.
- Source: `packages/web/src/index.css` (`:root` tokens; `.tool-family-body .hljs-*` block) and `packages/web/src/components/workflows/NodeRoom.tsx` (`TOOL_BODY_BOX`, arm renderers).
