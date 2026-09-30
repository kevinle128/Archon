# Implement the AI-Native Minimal UI in packages/web

Status: proposed, waiting for owner approval (2026-09-30).

## Outcome

The classic web UI (`/chat`, `/dashboard`, `/workflows`, `/workflows/builder`, `/workflows/runs/:runId`, `/settings`) looks and behaves like the approved mockup `plans/260930-1702-ui-redesign-directions/ai-native-screens.html`, following `ai-native-minimal-spec.md`. Light theme by default, dark theme via system setting or toggle, L4 Pixel logo.

## Constraints

- Keep routes, API contracts and behavior. This is a visual and layout change, not a feature rewrite.
- Token-first: components already use semantic tokens (about 1,650 uses; 23 raw palette classes, 2 literals). Change token values first, then restructure layouts.
- AGENTS.md "UI and Visual Design": a new visual system means updating the token source (`packages/web/src/index.css`) and the brand guide (`packages/docs-web/src/content/docs/brand/`) together.
- `bun run validate` must pass at the end; web e2e specs are updated only where they assert old markup.

## Non-goals

- No new product features beyond giving the former console-only features a home in Settings.
- No changes to server, engine, or database.

## Phases

| #   | Phase                                                                                                                                                                                                                      | Main files                                                                                            | Depends on |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------- |
| 1   | Foundation: light and dark tokens, Fira Sans and Fira Code, theme toggle with persistence, `PixelLogo` component and favicon, fix the 23 raw color classes, light variants for code highlighting and the React Flow canvas | `index.css`, `index.html`, `components/ui/*`, new `components/brand/PixelLogo.tsx`, `lib/theme.ts`    | none       |
| 2   | App shell: replace the top nav with the slim left sidebar (logo, New chat, Chat, Dashboard, Workflows, Settings, "Needs you" from paused runs, recent conversations, user and theme toggle)                                | `components/layout/*`, `components/sidebar/*`, `components/conversations/*`                           | 1          |
| 3   | Chat: user bubble right, agent plain text left, tool call cards, run progress as a context card, typing indicator, sticky composer                                                                                         | `components/chat/*`, `routes/ChatPage.tsx`                                                            | 2          |
| 4   | Run detail: header, tabs, quiet vertical node list, node conversation, pending question as the accent context card, bottom composer                                                                                        | `components/workflows/` execution and node room files, `routes/WorkflowExecutionPage.tsx`             | 2          |
| 5   | Dashboard and Workflows library                                                                                                                                                                                            | `components/dashboard/*`, workflow list files, `routes/DashboardPage.tsx`, `routes/WorkflowsPage.tsx` | 2          |
| 6   | Builder                                                                                                                                                                                                                    | builder files in `components/workflows/`, `routes/WorkflowBuilderPage.tsx`                            | 2          |
| 7   | Settings: restyle, and port the console-only features (AI provider keys and subscription logins, GitHub connect, model tiers, aliases, personal default model, usage and cost) into new `components/settings/*`            | `routes/SettingsPage.tsx`, new `components/settings/*`, source code in `experiments/console/`         | 2          |
| 8   | Cleanup and docs: delete `experiments/console/` after moving its shared test helper, update brand guide, `adapters/web.md`, AGENTS.md console references; run `bun run validate` and web e2e                               | docs, tests                                                                                           | 3 to 7     |

Phases 3 to 7 touch separate files and can run in parallel after phase 2, each owning its file list.

## Verification per phase

- Type-check, lint and the web unit tests for touched areas.
- Browser check against the mockup on the running dev server (`http://localhost:5174`), light and dark, 1440 and 1024 wide.
- Phase 8: `bun run validate` plus the web e2e suite.

## Risks

- Workflow run view is the largest area (about 16k lines across `components/workflows`); keep changes to classes and layout wrappers, not logic.
- Hard-coded dark assumptions (code theme, React Flow, some inline colors) surface only in light mode; phase 1 handles the known ones, later phases check visually.
- Porting console features needs their API hooks and state; port code, not re-invent it.

## Rollback

Each phase is a separate commit on `develop-2`; revert per phase.
