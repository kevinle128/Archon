# Phase 01: Tokens, fonts, dark mode, shared primitives, brand guide

Status: pending. Depends on: none. Effort: 2d.

## Context

- Spec: handoff `README.md` sections "Design tokens", "Status language", "Column vocabulary", "Interactions & behaviour".
- Token source today: `packages/web/src/index.css`. `:root` holds light values (`--surface`, `--text-primary`, `--accent`, `--border`, shadcn names `--primary`, `--muted`, `--sidebar-*`); `.dark` holds dark values; `@theme` maps them to Tailwind. `--radius: 0.625rem` drives `--radius-sm` to `--radius-4xl`. One literal `border-radius: 4px` exists in the same file (anchor: the rule just after the `@theme` radius block).
- Fonts today: Google Fonts `<link>` in `packages/web/index.html` (Fira Sans 400/500/600, Fira Code 400/500). `--font-sans` and `--font-mono` in `@theme`.
- Theme: `src/lib/theme.ts` (`THEME_STORAGE_KEY = 'archon-theme'`, values light/dark/system, `.dark` class on `<html>`, hook `useTheme()`). No change to its logic.
- Status mapping today: `src/components/workflows/StatusIcon.tsx` (`switch` on completed/running/paused/awaiting/failed/cancelled/skipped).
- Logo: `assets/logo.svg`, component `src/components/brand/PixelLogo.tsx` (+ test).
- verify-archon: `.agents/skills/verify-archon/visual-config.json` pins sha256 of `packages/web/src/index.css` and `packages/docs-web/src/content/docs/brand/index.md`. `e2e/ui/verifier-visual.spec.ts` (HITL set, runs in CI) checks the pins.

## Requirements

1. Light tokens equal the README "Design tokens" values (navy header, `#f5f7fa` background, `#2563eb` accent, status colors, line/strong/selection, code block, tints).
2. Dark tokens use the `midnight` palette from the Runs prototype `theme()`: bg `#0f1218`, surface `#161a22`, text `#e6e8ee`, muted `#9aa3b2`, faint `#667085`, line `#232a36`, strong `#2e3746`, selection `#1c2230`, code bg `#0a0c11`, code text `#cdd3de`, waiting `#f0a54a`, failed `#f07167`, running/accent `#8b9bff`, done `#5fbf8f`, pending segment `#2e3746`. The dark header follows the prototype rule for non-`slate-d` themes: header bg = bg, header text = text, header muted = muted, header line = strong, header accent = accent. Chip text on waiting fill in dark = bg (`waitFg`).
3. Colors are the exact handoff values, even where small text is below WCAG AA (locked decision 7). Do not darken tokens for contrast.
4. Font: Archivo 400/600/700/800 for all UI text. Mono: `ui-monospace, Menlo, monospace` (README "Typography"). `font-variant-numeric: tabular-nums` on `body`.
5. Radius 0 everywhere; no shadows (README). Focus: `:focus-visible` 2px outline in accent, offset 2px.
6. Caret blink and live timers are the only motion; `prefers-reduced-motion: reduce` stops the blink.
7. Shared primitives exist before phase 02 so later phases do not edit the same files.
8. Brand guide documents the new palette (light and dark), Archivo, radius 0, and status language.

## Files

Modify:

- `packages/web/src/index.css`: new values in `:root` and `.dark`; add tokens `--header-bg`, `--header-fg`, `--header-muted`, `--header-line`, `--header-accent`, `--line-strong`, `--selection`, `--code-bg`, `--code-fg`, `--status-running`, `--status-waiting`, `--status-waiting-fg`, `--status-done`, `--status-failed`, `--status-pending`, `--segment-pending`, `--tint-error`, `--tint-success`; map them in `@theme` as Tailwind colors; set `--radius: 0`; replace the literal `border-radius: 4px` with `0`; set `--shadow-*` theme vars to `none`; set `--font-sans`/`--font-mono`; add `@keyframes caret-blink` + reduced-motion rule; global `:focus-visible` rule. Keep existing token names (about 1,650 uses) so current screens restyle without code edits. Keep `.legacy-run-view` scoped tokens until phase 03 removes that root.
- `packages/web/index.html`: replace the Fira `<link>` with Archivo (`family=Archivo:wght@400;600;700;800&display=swap`), same preconnect pattern.
- `src/components/ui/button.tsx`: variants `primary` (accent fill), `secondary` (1px strong border, white or surface), `danger-outline` (Builder "Delete node"); height 32px default, 44px `lg` (Login); label flush-left with trailing glyph when wider than content (`justify-between`). Keep existing variant names working (map `default` to `primary`, `outline` to `secondary`) so no caller breaks.
- `src/components/ui/input.tsx`, `textarea.tsx`, `tabs.tsx`, `badge.tsx`, `card.tsx`, `dialog.tsx`, `alert-dialog.tsx`, `tooltip.tsx`: 0 radius, no shadow, new borders. Behavior unchanged.
- `src/components/workflows/StatusIcon.tsx`: render from the new status map (below) instead of its own `switch`. Keep the export name and props; `StatusIcon.test.tsx` updates expected glyphs.
- `src/components/workflows/resolve-room-kind.ts`: export the existing `nodeBodyKind` function for `node-steps.ts` (no behavior change).
- `src/components/brand/PixelLogo.tsx`: colors from `--header-fg` / `--header-accent`; size prop for 20px (top bar) and 28px (Login).
- `packages/docs-web/src/content/docs/brand/index.md`, `packages/docs-web/public/brand/foundation.html`: palette tables (light + dark), typography, radius, motion, status language.
- `.agents/skills/verify-archon/visual-config.json`: re-pin the sha256 of `packages/web/src/index.css` and `packages/docs-web/src/content/docs/brand/index.md` only. Do not change criteria here (locked decision 5).

Create:

- `src/lib/status-presentation.ts` (+ `.test.ts`): one map from run/node status to `{ glyph, label, tone }` per README "Status language" (running ▶ Running; paused/awaiting ! Awaiting you; completed ✓ Completed; done ✓ Done; failed ✕ Failed; pending ○ Pending; skipped – Skipped; cancelled – Cancelled). Unknown status maps to pending. Single source for all screens.
- `src/components/ui/status-chip.tsx`: glyph + label; filled waiting variant (`--status-waiting` bg, `--status-waiting-fg` text).
- `src/components/ui/progress-strip.tsx`: one 4px segment per item, 2px gap, color by status.
- `src/components/ui/underline-tabs.tsx`: Radix Tabs wrapper; two sizes (12px/600 with 2px underline for list headers; 13px/600 with 3px underline for node tabs). Keeps Radix `role="tab"` semantics (e2e uses `getByRole('tab')`).
- `src/components/ui/list-row.tsx`: 3px left bar, selected/hover `--selection` bg, `aria-current` when selected.
- `src/components/ui/section-label.tsx`: 11px uppercase, 0.08em letter-spacing, muted.
- `src/components/ui/column-layout.tsx`: CSS grid that fills height; each column `min-height: 0; overflow: auto`; takes a `columns` template string; 2px strong right border on the first column.
- `src/components/ui/segmented.tsx`: 2+ option segmented control (selected bg `--foreground`, text bg color), radio-group semantics.
- `src/lib/node-steps.ts` (+ `.test.ts`): shared by Runs (03), Workflows (04), and Builder (06). Groups workflow definition nodes into steps from their real `depends_on` (use `computeTopologicalLayers` in `lib/dag-layout.ts`, or a pure equivalent on `DagNode[]` if that function needs React Flow types); returns steps with parallel flag; maps node body kind to code (command CMD, prompt PRM, bash SH, script SCR, loop LOOP, approval GATE, plannotator_gate GATE, workflow WF, route_loop ROUTE, loop_group GROUP; reuse `nodeBodyKind` logic from `components/workflows/resolve-room-kind.ts` by exporting it, not by copying); keeps loop-group children nested. Summary helper "3 CMD · 1 SH · 2 PRM".
- `src/components/ui/live-elapsed.tsx`: live timer text ("6m 02s", "1h 4m") from a start timestamp; one shared 1s interval.

## Steps

1. Read `index.css` fully. List each token and its new light and dark value in a table in the PR body.
2. Edit tokens, `@theme`, radius, shadow, focus, motion. Edit `index.html` fonts.
3. Build primitives with unit tests (render + role + selected state). Use the existing `src/test/preload-radix-dom.ts` setup.
4. Point `StatusIcon` at `status-presentation`.
5. Run `bun run dev`. Check every current screen in light and dark at 1440 and 1024. Old layouts must stay usable (they are replaced in later phases).
6. Check that every token equals the handoff value (locked decision 7).
7. Update the brand guide pages.
8. Re-pin the two verify-archon sha256 values (`shasum -a 256 <file>`).

## Tests

- Add: `status-presentation.test.ts`, tests for `status-chip`, `progress-strip`, `underline-tabs`, `list-row`, `segmented`, `live-elapsed`.
- Update: `StatusIcon.test.tsx` (glyphs), `PixelLogo.test.tsx` (if it asserts colors).
- e2e to run: `verifier-visual.spec.ts` (pin integrity), `agent-todo-strip.spec.ts`, `agent-interrupt-redirect.spec.ts`, `agent-tool-row-visual.spec.ts`, `occurrence-navigation.spec.ts` (they read computed colors and check `/mono/i` font family; `ui-monospace` matches). If a spec asserts an AA contrast that the exact handoff colors fail, update the spec and note locked decision 7.

## Validation

`bun run --cwd packages/web test`, `bun run type-check`, `bun run lint`, `bun run --cwd e2e test:ui:hitl`.

## Risks

| Risk                                                            | L x I      | Mitigation                                                                              |
| --------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------- |
| Radius 0 and no shadow make popovers and dialogs hard to see    | Med x Med  | Use a 1px strong border on overlays; check every Radix overlay.                         |
| React Flow canvas and code highlight look wrong with new colors | Med x Low  | `--xy-*` vars in `index.css` map to new tokens; check graph and builder in both themes. |
| Old screens look mixed until later phases                       | High x Low | Expected; each later phase replaces one screen.                                         |

## Rollback

Revert the PR. The pins revert with it.
