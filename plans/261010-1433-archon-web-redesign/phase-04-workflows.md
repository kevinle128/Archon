# Phase 04: Workflows

Status: done. Depends on: 02. Effort: 1.5d. Can run in parallel with 03, 05, 06, 07.

Delivery notes: load errors were never shown on this screen (`listWorkflows` drops them), so only parse-warning tags are kept. The started-run poller matches the new conversation's database id against `parent_conversation_id`, which is how web runs record the chat that started them.

## Context

- Spec: README "Screens > 2. Workflows". Behavior: `Archon Workflows.dc.html` `renderVals()` (`cats`, `list`, `wf.summary`, `layers`, `isoNote`, `start`, `recent`).
- Today: `routes/WorkflowsPage.tsx` is a thin wrapper around `components/workflows/WorkflowList.tsx` (596 lines) and `WorkflowCard.tsx`. `WorkflowList` already has: search on name + description; category tabs (`role="tablist" aria-label="Category"`) from `getWorkflowCategory()` in `lib/workflow-metadata.ts` (`CATEGORIES`: All, CI/CD, Code Review, Automation, Development); a "Recommended" group from `partitionWorkflows()` + the `recommended` list of `GET /api/workflows`; run start (`createConversation(localProjectId)` then `runWorkflow` or `runWorkflowWithEnv` from `lib/workflow-envs/api.ts`, then navigates to `/chat/<conversationId>`); env overlays (`WorkflowEnvPicker`, `WorkflowEnvPreviewTable`, `WorkflowEnvironmentsSection`, `useWorkflowEnvs`, `useWorkflowEnvPreview`).
- API: `listWorkflows` returns `{ workflows: [{ workflow, source: 'project'|'bundled'|'global', parseWarnings? }], recommended, errors? }`. `runWorkflow` returns `{ accepted, status }` only; the run id comes later (SSE `workflow_dispatch`, or `listWorkflowRuns({ conversationId })`). `listDashboardRuns({ search })` matches `workflow_name` OR `user_message` with `LIKE` (`packages/core/src/db/workflows.ts`, the `options?.search` clause). `PUT /api/workflows/:name` saves a definition (`saveWorkflow`).
- No API: per-workflow run counts; isolation choice per run (see locked decisions 3 and 6).

## Requirements

1. Columns `minmax(240px,300px) | 1fr | minmax(300px,380px)` via `ColumnLayout`.
2. List: title "Workflows" + total; filter input (`data-list-filter`); category tabs from the existing `getWorkflowCategory()` (the existing categories, with counts; keep `aria-label="Category"`). "Recommended" rows stay pinned at the top of the All tab under a `SectionLabel`. Row: display name 14px/700, description 12px muted 2-line clamp, meta "N nodes" + source tag (Project accent, Bundled faint, Global muted). "N runs" is hidden (locked decision 6). Workflows with `parseWarnings` show a small waiting-tone "Warnings" tag; load `errors` show as rows with a failed tone (kept from today).
3. Detail: "{category} · {file path}" (project `.archon/workflows/<file>`, bundled `defaults/<file>`, global `~/.archon/workflows/<file>`; use the real filename when the API gives it, else `<name>.yaml`); name 24px; description 14px/1.55 max 64ch; grid Nodes (counts by kind code, e.g. "3 CMD · 1 SH · 2 PRM") / Input (declared `inputs` names, or "Free text") / Steps. Buttons "Open in Builder" (`/workflows/builder?edit=<name>`) and "Duplicate to project" (bundled/global only: `getWorkflow` then `saveWorkflow('<name>-copy', definition)` with `?cwd` of the selected project; label becomes "Copied to .archon/workflows"; disabled when the project filter is "All projects"). Node steps and the kind summary use `src/lib/node-steps.ts` (phase 01). Clicking a node toggles inline detail: Kind + description; Depends on = the node's real `depends_on` list, or "Nothing, runs first".
4. Start a run (right column, 2px strong bottom border):
   - Project select: defaults to the filter project. With "All projects" the first option is "No project" and is selected, which keeps today's behavior (`createConversation(undefined)`).
   - Input textarea labelled "Input"; placeholder from the workflow description hint when present.
   - Env overlay picker and preview (kept): `WorkflowEnvPicker` + `WorkflowEnvPreviewTable` under the input.
   - Isolation: show the workflow's policy read-only ("Runs in a worktree" / "Runs in place" / "Default: worktree") (locked decision 3). No toggle.
   - Error "Add the input first." (failed tone, 600) when empty. Primary "Start run →".
   - On success: card (2px accent border, selection bg) "▶ STARTING" then "▶ RUNNING" with "<run id> · <workflow>", project · branch, link "Follow in Runs →" (`/runs/<id>`). Get the id by polling `listWorkflowRuns({ conversationId })` every 1s for up to 30s; if no id, the link goes to `/chat/<conversationId>` (today's behavior).
5. Environments section (kept): `WorkflowEnvironmentsSection` below "Start a run" in the right column, restyled; keep `data-testid="workflow-envs-section"` and the dialog test ids.
6. Recent runs: `listDashboardRuns({ codebaseId, search: name, limit: 20 })`, then keep rows with exact `workflow_name === name`. Each row links to `/runs/<id>`. Header shows scope ("All projects" or repo name).

## Kept features (new home)

| Feature                                       | New home                                    |
| --------------------------------------------- | ------------------------------------------- |
| Recommended pin list                          | Top of All tab                              |
| Parse warnings / load errors                  | Row tags and error rows                     |
| Env overlays (picker, preview, manage dialog) | Start-a-run column and Environments section |
| Run start navigating to chat                  | Fallback link when the run id is not found  |

## Files

Create: `src/components/workflows-library/WorkflowsListColumn.tsx`, `WorkflowDetailColumn.tsx`, `StartRunColumn.tsx`, `RecentRuns.tsx`, `WorkflowNodeSteps.tsx`; `src/lib/workflows-library/queries.ts` (`useRecentRuns`, `useStartRun` with id polling), `src/lib/workflows-library/workflow-file-path.ts`; tests beside each.

Modify: `src/routes/WorkflowsPage.tsx`; `src/components/workflows/WorkflowList.tsx` (split into the new columns; delete when empty); `WorkflowCard.tsx` (becomes the list row or is deleted); `src/components/workflow-envs/*` (classes only; keep test ids).

Delete: `WorkflowList.tsx` and `WorkflowCard.tsx` once no import remains.

## Steps

1. Move logic out of `WorkflowList.tsx` into the queries file and new columns without behavior change.
2. Build columns with `ColumnLayout`, `ListRow`, `UnderlineTabs`, `SectionLabel`, `Segmented`.
3. Add Duplicate, id polling, recent runs.
4. Check light/dark, 1440/1024.

## Tests

- Add: `workflow-file-path.test.ts`, `queries` tests for id polling (found, timeout fallback) and exact-name filtering, `StartRunColumn.test.tsx` (empty input error, env id passed, fallback link), `WorkflowsListColumn.test.tsx` (category counts, recommended pin).
- Keep: `partition-workflows.test.ts`, `workflow-metadata.test.ts`, `components/workflow-envs/*.test.tsx`, `lib/workflow-envs/*.test.ts`.
- e2e: `workflow-env-overlay.spec.ts` uses `/workflows`, `getByTestId('workflow-envs-section')`, dialog test ids, and `getByRole('button', { name: 'Run', exact: true })`. Update the last one to "Start run" (or the button's accessible name). After start, it may expect the chat URL; update to the run card link.

## Validation

`bun run --cwd packages/web test`, `bun run type-check`, `bun run lint`, `npx playwright test -c e2e/playwright.config.ts ui/workflow-env-overlay.spec.ts`.

## Risks

| Risk                                              | L x I      | Mitigation                                                                         |
| ------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------- |
| Duplicate overwrites an existing project workflow | Med x High | Check `getWorkflow('<name>-copy', cwd)` first; if it exists, add a numeric suffix. |
| Run id polling picks a wrong run                  | Low x Med  | Filter by the new `conversationId`, which is unique to this start.                 |

## Rollback

Revert the PR; `WorkflowList.tsx` returns.
