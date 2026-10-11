---
title: 'Archon web UI redesign: Runs workspace and navy/blue shell'
description: 'Rebuild packages/web on the handoff design: top-bar shell, project filter, three-column Runs workspace, restyled Workflows, Chat, Builder, Settings and Login, with all current features kept and dark mode kept.'
status: done
priority: P2
effort: 17d
branch: feat/web-runs-workspace-redesign
tags: [web, ui, redesign, brand, e2e]
created: 2026-10-10
---

# Archon web UI redesign

## Outcome

`packages/web` looks and behaves like the handoff prototypes in `claude-design/design_handoff_archon_redesign/` (README.md is the spec; `renderVals()` in each `*.dc.html` is the behavior reference). The Runs workspace (`/runs`, `/runs/:runId`, `/runs/:runId/:nodeId`) replaces Dashboard and the run detail page. A top bar replaces the left sidebar. A global project filter scopes every screen.

## Locked user decisions (do not reverse)

1. **Keep and restyle every existing feature** that the prototypes do not show. Each phase file has a "Kept features" table that names the new home of each feature.
2. **Keep dark mode.** Dark tokens come from the `midnight` palette in the Runs prototype `theme()` (see phase 01).
3. **Isolation in "Start a run":** show the workflow's `worktree.enabled` policy read-only. No toggle, no API change. (User, 2026-10-10.)
4. **Builder:** step columns are drawn from real `depends_on` edges; dependencies are edited explicitly; ← / → change them only on click; keep the React Flow canvas as a "Graph" view; no Loop/Approval creation in the palette. (User, 2026-10-10.)
5. **Visual checks:** re-pin hashes in 01 and 03; in 08 rewrite the verify-archon criteria against the handoff and commit the whole handoff folder. (User, 2026-10-10.)
6. **No-API items:** hide per-project and per-workflow run counts, "Prune finished worktrees" and the GitHub repositories/webhook/trigger chips. Runs list progress strips use one run-detail request per visible row, capped at 50 rows. (User, 2026-10-10.)
7. **Exact handoff colors everywhere.** Use the README token values for text, fills, strips and glyphs, even where small text is below WCAG AA. Do not darken values for contrast. (User, 2026-10-11; this replaces the AA requirement in phase 01.)

## Constraints

- New view layer only. Reuse existing logic modules (cited per phase). No server, engine, or database change in this plan.
- Wire real data (`lib/api.ts`, `api.generated.d.ts`, SSE hooks). Prototype numbers are samples.
- A prototype element with no API is not invented. It is hidden (locked decision 6).
- Chat slash commands go to the orchestrator unchanged. The client does not parse message text (AGENTS.md "Natural Language Is Not a Wire Format"). Real spellings: `/workflow run <name> <input>`, `/status`, `/workflow list`, `/workflow cancel <id>` (`packages/core/src/handlers/command-handler.ts`).
- New tokens update `packages/web/src/index.css` and the brand guide together (AGENTS.md "UI and Visual Design").
- New data hooks go in `src/lib/<area>/queries.ts` files (pattern: `src/lib/workflow-envs/queries.ts`). Do not add per-phase code to `src/lib/api.ts` unless a client function is missing; phase 01 owns any such addition.
- Keep `ProjectContext` key `archon-selected-project` with codebase-ID values; `null` means "All projects".
- Keep `/workflows/runs/:runId` as a permanent redirect. `packages/core/src/workflows/store-adapter.ts` (`url.pathname = \`/workflows/runs/...\``) sends this link format to Slack and Telegram approval messages.
- No plan IDs, phase numbers, or finding codes in code, test names, or commit messages.
- `src/index.css` is sha256-pinned by verify-archon. Only phases 01 and 03 edit it (and re-pin). Other phases use Tailwind utilities or a co-located `.css` file (pattern: `components/workflows/source-control/source-control-diff.css`).
- Graph file ownership: 03 owns the runtime graph (`WorkflowDagViewer.tsx`, `ExecutionDagNode.tsx`, `RunGraphRouteEdge.tsx`, `DagNodeProgress.tsx`, `build-workflow-dag-view-model.ts`); 06 owns the builder canvas (`WorkflowCanvas.tsx`, `DagNodeComponent.tsx`). `lib/dag-layout.ts` is read-only in this plan.

## Phases

| #   | Phase                                                                                              | Owns (main files)                                                                                                                                     | Depends on | Effort |
| --- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------ |
| 01  | [Tokens, fonts, dark mode, shared primitives, brand guide](phase-01-tokens-fonts-dark-mode.md)     | `index.css`, `index.html`, `components/ui/*`, `components/brand/*`, `lib/status-presentation.ts`, `lib/node-steps.ts`, brand docs, verify-archon pins | none       | 2d     |
| 02  | [Shell: top bar, project filter, Needs you, routes, sidebar removal](phase-02-shell-and-routes.md) | `App.tsx`, `components/layout/*`, `components/sidebar/*`, `components/shell/*`, `lib/runs/run-url.ts`                                                 | 01         | 2d     |
| 03  | [Runs workspace](phase-03-runs-workspace.md)                                                       | `routes/RunsPage.tsx`, `components/runs/*`, run-view files in `components/workflows/*`, `components/dashboard/*`, `e2e/lib/playwright/run-detail.ts`  | 02         | 5d     |
| 04  | [Workflows](phase-04-workflows.md)                                                                 | `routes/WorkflowsPage.tsx`, `components/workflows-library/*`, `WorkflowList.tsx`, `WorkflowCard.tsx`, `components/workflow-envs/*`                    | 02         | 1.5d   |
| 05  | [Chat](phase-05-chat.md)                                                                           | `routes/ChatPage.tsx`, `components/chat/*`, `components/conversations/*`                                                                              | 02         | 1.5d   |
| 06  | [Builder](phase-06-builder.md)                                                                     | `routes/WorkflowBuilderPage.tsx`, builder files in `components/workflows/*`, `components/builder/*`                                                   | 02         | 2d     |
| 07  | [Settings and Login](phase-07-settings-and-login.md)                                               | `routes/SettingsPage.tsx`, `routes/LoginPage.tsx`, `components/settings/*`                                                                            | 02         | 1.5d   |
| 08  | [e2e, verify-archon, docs, full validation](phase-08-e2e-verify-validate.md)                       | `e2e/ui/*.spec.ts`, `.agents/skills/verify-archon/*`, docs                                                                                            | 03–07      | 1.5d   |

**Parallel work:** after 02 merges, phases 03, 04, 05, 06, 07 own separate files and can run in parallel. Builder files and run-view files both live in `components/workflows/`; the file lists in phases 03 and 06 do not overlap (see the graph ownership constraint). Each phase updates only the e2e specs it breaks; phase 08 does the full sweep.

## Dependency graph

```
01 -> 02 -> { 03, 04, 05, 06, 07 } -> 08
```

## Acceptance criteria (whole plan)

1. Each screen matches its prototype at 1440x900 and 1024x768 in light mode: colors, type sizes, borders, 0 radius, no shadows, column widths from README "Column vocabulary".
2. Each screen has a dark-mode equivalent with the same layout. The theme toggle works and persists under `archon-theme`.
3. Every feature in the "Kept features" tables is reachable from the new shell (checked by a manual checklist in phase 08).
4. `/dashboard`, `/workflows/runs/:runId`, and `/workflows/runs/:runId?node=<id>` redirect to the matching `/runs` URL. `/` opens `/runs`.
5. The project filter persists across reloads and scopes Runs, Workflows (recent runs), Chat, and Builder save target.
6. `bun run validate` passes. `bun run --cwd e2e test:ui:hitl` passes. `bun run --cwd e2e test:ui` passes or each non-HITL failure is listed with a reason in phase 08.
7. verify-archon `visual-config.json` pins match the new files, and its criteria describe the new run view (per locked decision 5).

## Rollback

Each phase is one PR into `develop` (squash). Revert the PR to roll back. Phase 02 to 07 add new routes before they remove old ones, so a revert of one screen phase does not break the other screens. Reverting 01 after later phases restores old tokens; layouts stay usable but look mixed, so revert in reverse order if a full rollback is needed.

## Risks (top)

| Risk                                                                                                             | L x I       | Mitigation                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run view rewrite breaks HITL e2e (21 specs open the run page)                                                    | High x High | Phase 03 keeps accessible names of room internals (`region "<node> room"`, `details[data-tool-id]`, ask card, dock). It rewrites the shared helper `e2e/lib/playwright/run-detail.ts` once. |
| Builder step columns lose real `depends_on` edges                                                                | High x High | Locked decision 4: keep explicit edges.                                                                                                                                                     |
| Token change fails contrast checks in e2e (`agent-todo-strip`, `agent-interrupt-redirect` parse computed colors) | Med x Med   | Phase 01 runs those specs; check WCAG AA for each text/background pair.                                                                                                                     |
| verify-archon integrity test (`verifier-visual.spec.ts`, HITL set) fails on any `index.css` edit                 | High x Med  | Phase 01 re-pins the sha256 in the same PR.                                                                                                                                                 |
| Large file `WorkflowExecution.tsx` (1406 lines) and `LegacyGraphLogsPane.tsx` (667)                              | Med x High  | Phase 03 moves layout only; data logic stays in `lib/execution-room-model.ts` and existing selectors.                                                                                       |

## Open decisions

None. All four were answered by the user and moved to "Locked user decisions" (items 3 to 6).

Resolved by scouting (no question): Workflows category tabs reuse the existing `getWorkflowCategory()` in `lib/workflow-metadata.ts`; `/` goes to `/runs` (handoff brand and Login success link to Runs); fonts load from Google Fonts like today (`index.html`).
