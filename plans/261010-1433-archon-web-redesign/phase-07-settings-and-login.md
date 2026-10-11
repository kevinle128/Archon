# Phase 07: Settings and Login

Status: done. Depends on: 02. Effort: 1.5d.

Delivery notes: one section shows at a time, selected by `?section=` (the e2e cost helper opens `?section=usage`). Login validation lives in `lib/auth/login-form.ts` so the package test script runs its tests.

## Context

- Spec: README "Screens > 5. Settings" and "6. Login". Behavior: `Archon Settings.dc.html` and `Archon Login.dc.html` `renderVals()`.
- Settings today: `routes/SettingsPage.tsx` + `components/settings/SettingsNav.tsx` (`<nav aria-label="Settings sections">`, one button per section) and 8 sections: `ProjectsSection.tsx` (add via `addCodebase(getCodebaseInput(value))`, remove via `deleteCodebase`, per-project env vars), `AssistantSection.tsx` (assistant defaults, `PATCH /api/config/assistants`), `ProvidersSection.tsx` + `SubscriptionLoginFlow.tsx` (API keys and OAuth subscriptions; renders nothing on 401), `GithubSection.tsx` (device flow; auth-gated), `ModelTiersSection.tsx`, `AliasesSection.tsx`, `UsageSection.tsx` (`GET /api/usage` with day range, `groupBy`, `kind`; run links built by a local `runHref` as `/workflows/runs/<id>`), `SystemSection.tsx` (`getHealth`: database, concurrency, queued, running workflows, adapter, version, commit; `getUpdateCheck`). Shared: `ModelPickerField.tsx`, `primitives.tsx`, `lib/settings/*` (8 tests). After phase 02 the identity / version / sign-out block sits under `SettingsNav`.
- Login today: `routes/LoginPage.tsx`, modes `login` / `signup`, signup has a `name` field (default from email), signup hidden when `/api/auth/status` says `disabled`, allowlist copy when `allowlist`. Uses `signIn.email` / `signUp.email` from `lib/auth-client.ts`.
- `e2e/ui/shell.spec.ts` asserts `heading 'Settings' level 1`, `navigation 'Settings sections'`, buttons "Projects", "Model tiers", "Usage and cost". `e2e/lib/playwright/cost-console.ts` opens `/settings`.
- No API: GitHub trigger toggles; prune worktrees (CLI `archon isolation cleanup` only). Worktree list exists: `getCodebaseEnvironments(codebaseId)`.

## Requirements

### Settings

1. Columns `minmax(200px,240px) | 1fr`; content max-width 880px, padding 24px 32px 32px. Page `h1` "Settings" stays (visually the nav header).
2. Nav rows (14px/600, 3px left bar + selection bg when active) with right hints: Providers ("N not set", waiting tone, from `GET /api/auth/providers` `agents[].ready`), Model tiers, Aliases (count), Projects (count), GitHub (On/Off), Usage, System, plus the kept "Assistant defaults" row. Keep the nav name "Settings sections" and the button names "Projects", "Model tiers", "Usage and cost" (shell e2e). Use "Usage and cost" as the label (README says "Usage"; the e2e name wins).
3. Nav footer: account email + "Sign out" (`signOut`, then `/login`); version line. Hidden when web auth is off.
4. Each section: title Archivo 800 28px, description 14px muted, 2px text-color rule.
5. Providers: grid `1.2fr 88px 1.2fr 112px 120px` (name, auth type, value mono or muted "Not set", status "✓ Connected" / "○ Not set", action "Replace key" / "Add key" / "Sign in" / "Sign out"). Edit row reveals input + primary Save / Sign in + Cancel. Keys show masked (server never returns values; show label or "••••"). Subscription sign-in keeps `SubscriptionLoginFlow` (device code / manual paste) inside the edit row. Keep the agent → credential matrix (`agents`) as a second table under the vendor list.
6. Assistant defaults (kept): `AssistantSection` restyled, own nav row between Providers and Model tiers.
7. Model tiers: Small / Medium / Large rows (Archivo 800 18px), use line, model select (mono) via `ModelPickerField`; keep provider and effort controls.
8. Aliases: `@name → model` rows with Remove; add row (name, model, "Add alias"; auto-prefix `@`).
9. Projects: rows name + path (mono), kind (GitHub / Folder from `kind` and `repository_url`), branch (`default_branch` or "no git"), Remove (confirm). Current filter project row uses selection bg. Add by path or GitHub URL (existing `getCodebaseInput`). Row detail (expand): env vars (kept) and "Worktrees" list from `getCodebaseEnvironments` (moved from the sidebar `ProjectDetail`). Run count per project are hidden (locked decision 6).
10. GitHub: square toggle (52x28, 2px text border, on = accent track) shows connection state; "on" means connected via the device flow, "off" disconnects (`DELETE /api/auth/github`). When on: account login. Repositories, webhook, and trigger chips are hidden (no API, locked decision 6).
11. Usage and cost: period tabs 7 days / 30 days / All time map to the existing day-range draft; keep group-by and kind selectors and the run links (use `buildRunPath` from `src/lib/runs/run-url.ts`). Table Provider / Runs / Tokens / Cost, numbers right-aligned, tabular.
12. System: version, data directory (from `getHealth` if present, else hide), database, worktrees count (sum of `getCodebaseEnvironments` per codebase, or hide; see Risks), concurrency, adapter, commit (kept). "Check for updates" calls `getUpdateCheck` on click ("Checking…" -> "Up to date · <version>" or "Update available · <version>" with release link). "Prune finished worktrees" is hidden (locked decision 6). Theme note: the theme toggle lives in the top bar (phase 02); System shows a read-only line "Theme: <choice>, change it in the top bar".

### Login

13. Two columns `repeat(auto-fit, minmax(min(100%,380px),1fr))`. Left panel header-bg, PixelLogo 28px + "Archon" 22px, statement "Run coding agents as workflows you can watch." Archivo 800 44px/1.05 max 18ch, 6-segment `ProgressStrip`. Right form max 380px: title 28px, subtitle, 2px rule, Email, Password, error line, primary "Sign in →" (44px), text toggle.
14. Keep: name field in signup (optional, as today), signup hidden when `disabled`, allowlist copy ("Signup is invite-only. Use an allowlisted email.") when `allowlist`. Validation: email format, signup password ≥ 8, password required. Success navigates to `/runs`.

## Kept features (new home)

| Feature                                    | New home                        |
| ------------------------------------------ | ------------------------------- |
| Assistant defaults (`AssistantSection`)    | Own Settings nav row            |
| Per-project env vars                       | Projects row detail             |
| Project worktrees list (from sidebar)      | Projects row detail "Worktrees" |
| Provider agent matrix, subscription login  | Providers section               |
| Usage group-by, kind, custom day range     | Usage and cost section          |
| System health stats                        | System section                  |
| Identity, sign out, version (from sidebar) | Settings nav footer             |
| Signup name field, signup posture          | Login form                      |

## Files

Modify: `src/routes/SettingsPage.tsx`, `src/routes/LoginPage.tsx`, every file in `src/components/settings/`.
Create: `src/components/settings/SettingsSectionHeader.tsx`, `SquareToggle.tsx`, `ProjectWorktrees.tsx`; `src/components/auth/LoginBrandPanel.tsx`; `src/lib/settings/nav-hints.ts`; tests beside each.

## Steps

1. Restyle nav and section shells; keep names used by e2e.
2. Restyle sections one by one; move JSX, do not rewrite logic.
3. Add worktrees detail, update check trigger, period tabs mapping.
4. Restyle Login; keep auth calls.
5. Check with web auth on (Postgres + `BETTER_AUTH_SECRET`) and off; light/dark.

## Tests

- Add: `nav-hints.test.ts`, `SquareToggle.test.tsx`, `ProjectWorktrees.test.tsx`, a Login test (validation messages, signup hidden when disabled, success redirect to `/runs`).
- Keep: `lib/settings/*.test.ts` (8 files).
- e2e: `shell.spec.ts` Settings block stays valid if names are kept (requirement 2). `e2e/lib/playwright/cost-console.ts` and usage specs (`usage-estimated-cost`, `usage-kind-classification`, `usage-multi-provider`, `usage-no-usage`, `usage-partial-measures`, `usage-unpriced`, `workflow-usage-cost`) read the Usage section; run them and update selectors that change.

## Validation

`bun run --cwd packages/web test`, `bun run type-check`, `bun run lint`, the usage specs and `shell.spec.ts`.

## Risks

| Risk                                       | L x I     | Mitigation                                          |
| ------------------------------------------ | --------- | --------------------------------------------------- |
| Auth-gated sections break without identity | Med x Med | Keep the existing 401 handling; test with auth off. |
| Worktree count needs one call per codebase | Low x Low | Load only when System opens; hide on error.         |

## Rollback

Revert the PR.
