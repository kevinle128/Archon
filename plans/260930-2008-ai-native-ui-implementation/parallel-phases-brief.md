# Parallel phases 3 to 7: shared brief

Foundation and shell (phases 1 and 2) are committed (`ca44f10e`). Five agents now work in parallel in the SAME worktree, each owning a strict file list. Read this whole file.

## Read first

- `AGENTS.md` (strict TS, no `any`, ESLint zero warnings, web imports only from `@/lib/api`, never `@archon/workflows`; test isolation rules).
- `plans/260930-2008-ai-native-ui-implementation/plan.md` (the approved plan).
- `plans/260930-1702-ui-redesign-directions/ai-native-minimal-spec.md` (style rules).
- The approved target: `plans/260930-1702-ui-redesign-directions/ai-native-screens.html` (open the screen for your phase; match layout, spacing, hierarchy, states).

## Tokens and components already in place

- Tokens live in `packages/web/src/index.css`, light default and `.dark` variant. Use token classes only (`bg-background`, `bg-surface`, `bg-surface-elevated`, `border-border`, `text-text-primary/secondary/tertiary`, `text-success/warning/error`, `bg-accent`, `bg-accent-muted`, ...). `bg-accent` is the SOLID indigo brand color; use `bg-accent-muted` for a soft tint (user bubble, selection, context-card tint). No raw palette classes, no hex literals.
- Fonts: `font-sans` = Fira Sans, `font-mono` = Fira Code.
- Brand: `@/components/brand/PixelLogo` (pixel A, `active` runner prop).
- The left sidebar shell is done (`components/layout/*`, `components/sidebar/*`). Do not edit it.

## Style rules to apply in every screen

- Minimal chrome, generous whitespace on an 8px scale, hierarchy by size and weight. No shadows, no gradients.
- Context cards: `bg-surface` + 1px `border-border` + radius 12px; a card that needs the human gets a 3px accent left border.
- Controls 10px radius, visible focus rings, 44px minimum hit targets for primary controls, cursor pointer, 150 to 250ms transitions, everything static under `prefers-reduced-motion`.
- One primary (solid accent) action per screen.
- Inline SVG icons from `lucide-react` (already a dependency) with one stroke width; no emoji.

## Rules of engagement

- Edit ONLY files in your ownership list. If you need a change in another phase's file or in a shared file (`components/ui/*`, `lib/api.ts`, `index.css`, layout/sidebar), do not edit it: list the exact change in your final report.
- Keep behavior, data flow, API calls, routes and test ids. This is a visual and layout change. Preserve existing `data-testid` attributes and accessible names that tests or e2e specs use (`grep -rn` in `packages/web/src` tests and `e2e/` before renaming anything).
- Code comments: plain technical English, explain why, no plan or phase references.
- Do not commit. Do not start or stop servers. Do not run `bun test` from the repo root.

## Verification before you finish

1. `bun run --filter @archon/web type-check` (other agents edit in parallel; if an error is in a file you do not own, note it and continue).
2. `bunx eslint <your changed files> --max-warnings 0` and `bunx prettier --check <your changed files>` (run `--write` on your files if needed).
3. Unit tests for your area: `cd packages/web && bun test <your test files>` (respect the package's split test scripts in `packages/web/package.json`; run the relevant script).
4. Visual: the dev server for this worktree runs at `http://localhost:5174` and hot-reloads. Use Playwright (`createRequire('/Users/dale/orca/workspaces/Archon/develop-2/e2e/package.json')`, `chromium`, headless) to screenshot your screen in light and dark (`colorScheme`) at 1440x900 and 1024x768. Compare with the mockup screen, fix what differs. Save screenshots under `/private/tmp/claude-501/-Users-dale-orca-workspaces-Archon-develop-2/2d7c6785-3614-466c-a411-fdd7a504859d/scratchpad/phase<N>/`. Close every browser you open.

A real paused run for screenshots: `/workflows/runs/0c991b2b6ae98cdc834e0b157598c61c`.

## Final report format

Status: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT, then files changed, test results, screenshot paths, and any requested changes to files you do not own.
