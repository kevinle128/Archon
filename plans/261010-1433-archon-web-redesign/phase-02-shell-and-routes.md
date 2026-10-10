# Phase 02: Shell (top bar, project filter, Needs you, routes, sidebar removal)

Status: pending. Depends on: 01. Effort: 2d.

## Context

- Spec: README "Global shell > Top bar". Prototype markup: any `*.dc.html` header between `<x-dc>` tags; nav logic in Runs `renderVals()` (`nav`, `projectOpts`, `needsCount`, `goNeeds`).
- Routes today (`packages/web/src/App.tsx`): `/login` outside `SessionGate`; `/` to `/chat`; `/chat`, `/chat/*`; `/dashboard`; `/workflows`; `/workflows/builder`; `/workflows/runs/:runId`; `/settings`. Shell is `components/layout/Layout.tsx` (mobile header toggle + `Sidebar`).
- `components/layout/Sidebar.tsx`: `<nav aria-label="Main">` links (Chat, Dashboard, Workflows, Settings), "New chat" `+`, `PixelLogo active={runningCount > 0}`, `NeedsYouSection` (paused runs from `listDashboardRuns`, 10s refetch), `SearchBar`, `SidebarProjects` (add project via `addCodebase`), `ProjectSelector` (remove via `deleteCodebase`), `ProjectDetail` (project conversations, runs, isolation environments via `getCodebaseEnvironments`), `AllConversationsView`, `SidebarFooter` (identity, version, theme toggle, `signOut`). Shortcuts via `useKeyboardShortcuts`: `/` focuses search, `Escape` clears it.
- `contexts/ProjectContext.tsx`: key `archon-selected-project`, value = codebase ID or `null`.
- Server link format: `packages/core/src/workflows/store-adapter.ts` builds `/workflows/runs/<id>` for approval messages. This route must keep working forever.

## Requirements

1. Top bar on every screen except `/login`: 48px, `--header-*` tokens, brand (PixelLogo 20px + "Archon", Archivo 800 16px) links to `/runs`. The logo keeps the running animation (`active` when running count > 0).
2. Nav `<nav aria-label="Main">`: Runs, Workflows, Chat, Builder, Settings as `NavLink`s; active item has 3px `--header-accent` bottom border and `aria-current="page"`. Horizontal scroll with hidden scrollbar on narrow screens.
3. Project filter: label "Project" + native `<select>` (30px, 0 radius, max 240px). Options: "All projects" then each codebase by display name. Value writes through `ProjectContext.setSelectedProjectId` (`null` for all). Display name: `owner/repo` parsed from `repository_url` when present, else `codebase.name`. Run counts in option labels are hidden (locked decision 6).
4. Needs you button: count of paused runs scoped to the project filter (`listDashboardRuns({ status: 'paused', codebaseId })`, same 10s refetch as today, plus invalidation from `useDashboardSSE` events). Filled `--status-waiting` when count > 0; muted otherwise. Click navigates to `/runs?status=paused` (the Dashboard filter that `/runs` renders in this phase). Phase 03 maps `status=paused` to the Needs you tab and selects the first paused run.
5. Theme toggle: icon button at the far right of the top bar (light / dark / system cycle via `useTheme().toggle`), `aria-label="Theme: <choice>"`.
6. Routes:
   - `/` redirects to `/runs` (handoff brand and Login success go to Runs).
   - `/runs` renders `DashboardPage` for now (phase 03 replaces it). `/dashboard` redirects to `/runs` keeping the query string.
   - `/workflows/runs/:runId` still renders `WorkflowExecutionPage` (phase 03 turns it into a redirect).
   - Builder keeps its URL `/workflows/builder` (e2e uses `/workflows/builder?edit=<name>`). Nav "Builder" links there. Do not add a second builder URL.
   - Nav "Workflows" must not show as active on `/workflows/builder` (use `end` on the Workflows `NavLink`).
7. Sidebar removed. Each sidebar feature moves as in the table below. No feature is lost in this phase.
8. `/` shortcut focuses the visible list filter input (any element with `data-list-filter`); `Escape` clears and blurs it. Shortcut registration moves to the shell.

## Kept features (new home)

| Feature (today)                                         | New home                                                                                         | Owner of final restyle |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------- |
| Nav links, logo, running animation                      | Top bar                                                                                          | 02                     |
| Theme toggle (`SidebarFooter`)                          | Top bar right                                                                                    | 02                     |
| `NeedsYouSection` list                                  | Top bar Needs you button + Runs "Needs you" tab                                                  | 02 / 03                |
| `ProjectSelector` select                                | Top bar project filter                                                                           | 02                     |
| `ProjectSelector` remove, `SidebarProjects` add project | Settings > Projects (`ProjectsSection.tsx` already has `addCodebase`/`deleteCodebase`)           | 07                     |
| `ProjectDetail` project runs                            | Runs list filtered by project                                                                    | 03                     |
| `ProjectDetail` project conversations                   | Chat list filtered by project                                                                    | 05                     |
| `ProjectDetail` isolation environments (worktrees)      | Settings > Projects row detail "Worktrees", and Runs "Open worktree"                             | 07 / 03                |
| `AllConversationsView` + `SearchBar` + "New chat"       | Chat left column (moved here as-is, restyled in 05)                                              | 05                     |
| `WorkflowInvoker` (quick run)                           | Runs list header "Start run" dialog (moved here into the Dashboard header as-is, restyled in 03) | 03                     |
| `SidebarFooter` identity, version, sign out             | Settings nav footer (moved here as-is, restyled in 07); version also in Settings > System        | 07                     |

## Files

Create:

- `src/components/shell/TopBar.tsx`, `ProjectFilter.tsx`, `NeedsYouButton.tsx`, `ThemeToggle.tsx`, `use-shell-shortcuts.ts` (+ tests for each).
- `src/lib/projects/display-name.ts` (+ test): `owner/repo` from `repository_url`, fallback `name`.
- `src/lib/runs/run-url.ts` (+ test): `buildRunPath(runId, nodeId?, tab?)`. Later phases import it to replace `/workflows/runs/` literals in their own files (03: `WorkflowExecution.tsx`, `ChildWorkflowRoom.tsx`; 05: `MessageList.tsx`, `WorkflowProgressCard.tsx`; 07: `UsageSection.tsx`). Phase 03 extends it with URL parsing and legacy mapping.
- `src/lib/runs/queries.ts`: `usePausedRuns(codebaseId)`, `useRunningCount()` query hooks (phase 03 extends this file).

Modify:

- `src/App.tsx`: routes and redirects above. Keep `/login` outside `SessionGate`.
- `src/components/layout/Layout.tsx`: grid `48px 1fr`; `TopBar` + `<Outlet/>`; remove mobile sidebar toggle.
- `src/routes/ChatPage.tsx`: add a left column that hosts `AllConversationsView`, `SearchBar`, and a "New chat" button (relocation only).
- `src/routes/DashboardPage.tsx`: host `WorkflowInvoker` in its header (relocation only).
- `src/routes/SettingsPage.tsx`: host the identity / version / sign-out block under `SettingsNav` (relocation only).

Delete:

- `src/components/layout/Sidebar.tsx`, `src/components/layout/Header.tsx` (check `grep -rn "layout/Header" src` first; `Header.tsx` imports `ide-uri`, so move any live use before delete), `src/components/sidebar/NeedsYouSection.tsx`, `ProjectSelector.tsx`, `SidebarProjects.tsx`, `ProjectDetail.tsx`, `SidebarFooter.tsx` (after its block moves into Settings).
- Keep in `components/sidebar/` until their owner phase moves them: `AllConversationsView.tsx`, `SearchBar.tsx`, `SidebarSectionHeader.tsx` (used by `AllConversationsView`; phase 05), `WorkflowInvoker.tsx` (phase 03).

## Steps

1. Build shell components with tests. Wire `ProjectFilter` to `ProjectContext`; no new storage key.
2. Change `Layout.tsx` and `App.tsx` routes and redirects. Redirect helper keeps `location.search`.
3. Relocate sidebar features per the table. For each deleted file, grep imports and confirm zero users.
4. Check every screen at 1440, 1024, 390 widths, light and dark.

## Tests

- Add: tests for `TopBar` (nav names, active link, `aria-current`), `ProjectFilter` (writes context, `null` for all), `NeedsYouButton` (count, tone, navigation target), `ThemeToggle`, `display-name`, redirects (render `App` routes in a memory router: `/dashboard?status=paused` to `/runs?status=paused`, `/` to `/runs`).
- No existing unit tests cover `layout/` or `sidebar/`; none are orphaned.
- CI's HITL set does not run `shell.spec.ts`; run it locally before merging this phase.
- e2e broken: `e2e/ui/shell.spec.ts` (clicks `link /^Dashboard/`, expects `heading 'Dashboard'`). Update: click `Runs`, expect URL `/runs`; keep the `Main` navigation name; Settings checks stay (Settings is restyled in 07).

## Validation

`bun run --cwd packages/web test`, `bun run type-check`, `bun run lint`, `bun run --cwd e2e test:ui:hitl`, `npx playwright test -c e2e/playwright.config.ts ui/shell.spec.ts`.

## Risks

| Risk                                          | L x I      | Mitigation                                                             |
| --------------------------------------------- | ---------- | ---------------------------------------------------------------------- |
| A sidebar-only action is lost                 | Med x High | The table above is the checklist; reviewer ticks each row in the PR.   |
| Old screens assumed a left sidebar for height | Med x Low  | `Layout` gives children `min-height: 0` full height; check each route. |
| Mobile loses navigation                       | Low x Med  | Nav scrolls horizontally (README).                                     |

## Rollback

Revert the PR; the sidebar returns. Phases 03 to 07 must not start until this PR merges.
