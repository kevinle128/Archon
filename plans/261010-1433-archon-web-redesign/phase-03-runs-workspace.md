# Phase 03: Runs workspace

Status: pending. Depends on: 02. Effort: 5d (largest phase; sub-steps 3A to 3E can split across people if each owns its files).

## Context

- Spec: README "Screens > 1. Runs workspace". Behavior reference: `Archon Runs Workspace.dc.html` `renderVals()` (groups, `selectRun`, `pickNode`, `nodeRight`, `nodeExtra`, stream item types, `askOpts`, history, `canGuide`, `noGuideMsg`, project-change rule). Data shape: `archon-runs.js`.
- Today the run page is `routes/WorkflowExecutionPage.tsx` -> `components/workflows/WorkflowExecution.tsx` (1406 lines, data controller: run query, ask controller, room visit state, `?node=` param). Its layout is `LegacyGraphLogsPane.tsx` (667 lines: `NodeRunList`, `AskCard`, `LegacyNodeRoom`, root `id="legacy-run-view"`). Run-scoped views: `source-control/dag-run-tabs.tsx` (`WorkflowRunView = 'graph' | 'logs' | 'chat' | 'source-control' | 'terminal' | 'files-changed'`), `SourceControlTab`, `FilesChangedTab`, `TerminalTab`, `RunArtifactsPanel`, `WorkflowLogs`/`StepLogs`, `ChatTimeline`. Header meta: `RunCostMeta`, `RunEnvOverlayMeta`.
- `LegacyNodeRoom.tsx` (358 lines) = node header (`NodeRoomHeader`) + per-kind body: agent -> `NodeTranscriptPane`/`NodeRoom`; `StdoutRoom`; `GateRoom`; `ChildWorkflowRoom`; `RouteControllerRoom`; `LoopGroupRoom`; plus `NodeUsageDisclosure`. Kind resolution: `resolve-room-kind.ts` (`RoomKind = 'agent' | 'stdout' | 'gate' | 'workflow' | 'route_loop' | 'loop_group'`).
- Logic to reuse (read each before use): `lib/execution-room-model.ts` (`resolveFollowedRow`, `applyRoomDeepLink`, `selectableExecutionRows`, `capExecutionOptions`, `disambiguateExecutionOptions`, `computeLoopIterationCount`, `loopMaxIterationsForNode`, `computeRunOfTotal`, `FinishedIterationView`, `isLiveRowStatus`, `resolveRunDetailRefetchIntervalMs`), `lib/room-scroll-follow.ts` (`FOLLOW_THRESHOLD_PX = 24`, `createScrollFollow`, `onRoomScroll`, `jumpToLatest`), `lib/todo-state.ts` + `TodoStrip.tsx`, `AskCard.tsx` + `ask-answer-controller.ts` + `parse-ask-envelope.ts`, `lib/steering-dock.ts` (`SteeringExecutionState = 'live' | 'recovery_required' | 'finished'`, `not_steerable_here` code) + `ComposerDock.tsx`, `lib/tool-presentation.ts`, `build-log-rows.ts`, `select-room-data.ts` (reads `node_output` from `node_completed` events), `lib/ide-uri.ts`, `lib/dag-layout.ts` (`computeTopologicalLayers`).
- Dashboard today: `routes/DashboardPage.tsx` (URL params status, q, project, range today/7d/30d/all, page, pageSize), `components/dashboard/WorkflowRunCard.tsx` (Open Plannotator, Open in IDE via `run.working_path`, Open chat, View logs, Resume, Delete), `StatusSummaryBar.tsx`, `ConfirmRunActionDialog.tsx`.
- API (all exist): `listDashboardRuns` (status, codebaseId, search, after, before, limit, offset; returns `runs`, `total`, `counts` all/running/completed/failed/cancelled/pending/paused), `getWorkflowRun`, `cancelWorkflowRun`, `abandonWorkflowRun`, `resumeWorkflowRun`, `deleteWorkflowRun`, approve/reject, node retry, `getWorkflowNodeMessages`, `answerAskHuman`, `sendNodeGuidance`, `interruptNode`, `readNodeGuidanceQueue`, `withdrawNodeGuidance`, `createConversation`, `runWorkflow`. Run fields: `workflow_name`, `codebase_id`, `conversation_id`, `user_message`, `working_path`, `started_at`, `completed_at`, `last_activity_at`, `parent_run_id`, `metadata`; dashboard adds `codebase_name`.

## Requirements

### URLs

1. `/runs?filter=active|needs|finished|all&q=<text>&range=today|7d|30d|all`. Default filter `active`.
2. `/runs/:runId` selects a run; node defaults to the followed row (`resolveFollowedRow`).
3. `/runs/:runId/:nodeId?tab=<tab>&iteration=<n>`. Tabs: `stream`, `history`, `output`, `raw`, `changes`, `files`, `terminal`, `artifacts`, `logs`, `conversation`.
4. Redirects: `/workflows/runs/:runId?node=X` -> `/runs/:runId/X`; `/workflows/runs/:runId` -> `/runs/:runId`; `/runs?status=<s>` (from old dashboard links) -> filter (`running`->`active`, `paused`->`needs`, `completed`/`failed`->`finished`, other->`all`). The `/workflows/runs/` redirect is permanent (server links).

### Runs list column (`minmax(240px,300px)`)

5. Header "Runs" + "N running" (scoped). Filter input (`data-list-filter`) sends `search` to the API and also matches run id in the loaded page. Range select (kept from Dashboard) under the filter, compact.
6. Tabs Active / Needs you / Finished / All with counts from `counts` scoped by the project filter: Active = running + paused, Needs you = paused, Finished = completed + failed, All = all.
7. Row: project line (owner muted, repo bold) from the codebase display name; workflow name 14px/700 + "· " first line of `user_message` (muted, ellipsis); right side time (running: `LiveElapsed` from `started_at`; paused: "since HH:MM" from `last_activity_at`; else start time); progress strip; status label. "Load more" button at the end (offset paging; replaces Dashboard pagination).
8. Project change: if the selected run is not in the project, select that project's first run (`navigate(..., { replace: true })`).
9. "Start run" secondary button in the header opens a dialog with the restyled `WorkflowInvoker`.

### Run column (`minmax(260px,0.85fr)`)

10. Header: "project · run id"; workflow name 24px + `StatusChip`; grid Workflow / Elapsed / Input (`user_message`) / Cost (`RunCostMeta`) / Env (`RunEnvOverlayMeta`, only when present) / Parent (link to parent run when `parent_run_id`).
11. Actions by status:
    - running or paused: "Cancel run" (confirm, `cancelWorkflowRun`), "Open worktree" (`ideUri(working_path)`; hidden when `working_path` is null or the server is in Docker, same rule as `ChatInterface.tsx`).
    - failed: "Retry from failed node" (`resumeWorkflowRun`, skips completed nodes), "Open worktree".
    - completed: "Open artifacts" (switches the node column to `artifacts`), "Run again" (`createConversation(codebase_id)` then `runWorkflow(workflow_name, conversationId, user_message)`; pass stored inputs only if `metadata` carries them, check `SUBRUN_METADATA_KEYS.inputs` in `packages/workflows/src/schemas/workflow-run.ts` first).
    - "More" menu (all statuses where allowed): Abandon (non-terminal), Delete (terminal), Open chat (`/chat/<conversation>`), Open Plannotator (when the run has a Plannotator link).
12. "Nodes" section label + "X of Y done" + segmented "List | Graph".
    - List: steps from `src/lib/node-steps.ts` (phase 01) over the workflow definition (`getWorkflow`, already loaded by `WorkflowExecution`). Step number 11px faint; parallel steps get the 2px bracket and "Parallel · N". Row: glyph, node id 14px/600 (pending/skipped muted), right side duration (running: live; awaiting: "waiting <elapsed>"), second line kind code + extras ("iteration n of max", "N attempts", "conditional" when `when` is set). Kind codes come from `node-steps.ts`. Loop-group child rows render nested under their group with 12px indent.
    - Graph: `WorkflowDagViewer` with `ExecutionDagNode` and `RunGraphRouteEdge`, restyled; clicking a node selects it. Keeps zoom/fit controls.

### Node column (`minmax(0,1.4fr)`, `--surface` bg)

13. `region` with accessible name "<nodeId> room" (kept for e2e). Header: kind · model; node id Archivo 800 20px + status + duration; action "Retry node" (`WorkflowNodeRetryAction`, failed/done) or "Open in IDE" (running). `NodeUsageDisclosure` on the header line.
14. Tabs (`UnderlineTabs`, 13px, 3px underline), two groups split by a 1px divider:
    - Node: "Live stream" (running) or "Transcript"; "History · N"; "Output"; "Raw".
    - Run: "Changes" (`SourceControlTab`), "Files" (`FilesChangedTab`), "Terminal" (`TerminalTab`), "Artifacts" (`RunArtifactsPanel` + `ArtifactViewerModal`), "Logs" (`WorkflowLogs`/`StepLogs`), "Conversation" (`ChatTimeline`). Run tabs are keyed by `runId`, mount on first open, and stay mounted (hidden) when the node changes, so an xterm session or diff state is not lost.
15. Todo strip under the tabs (`TodoStrip`, restyled to README: surface bg, 12px, "Todo 3/5", horizontal scroll) when the node has todos and the view is current.
16. Live stream body per `resolveRoomKind`: agent -> restyled transcript; stdout -> `StdoutRoom`; gate -> `GateRoom` (approve/reject stay there); workflow -> `ChildWorkflowRoom` (child link -> `/runs/<childId>`); route_loop -> `RouteControllerRoom`; loop_group -> `LoopGroupRoom`. Empty states from the prototype `emptyMsg` (skipped, pending "Not started. Waits on …", "No transcript.").
17. Stream rows: grid `64px 1fr`, time 11px faint; agent text 14.5px/1.6 with blinking caret while streaming; sys rows 12px/700 uppercase; thinking toggle; tool row (bordered, surface bg, `12px auto 1fr auto`, errors red and auto-open, body in code block) from `tool-presentation`; operator rows ("YOU · QUEUED FOR NEXT TURN" / "ANSWERED", 3px left rule, "Withdraw" on queued items). Keep `details[data-tool-id]` on tool rows.
18. AskHuman: `AskCard` restyled (2px waiting border, filled header "THE AGENT IS ASKING YOU", question Archivo 800 19px, options A/B/C, note input, button "Pick an option" disabled -> "Answer A →"). Keep all current AskCard abilities (multiple questions, free text, multi-select) that the controller supports.
19. Auto-follow uses `room-scroll-follow` as is (24px threshold; README says 40px; the tested constant wins).
20. History: loop iterations newest first from the execution-option helpers; a finished iteration shows a read-only transcript with the dark banner "Viewing iteration n of max · finished, read only" + "Back to current". Non-loop nodes list attempts by retry epoch.
21. Output: `node_output` (16px, max 60ch); link "Open in Artifacts" when the node has a typed sidecar. Raw: JSON of the node state row and its definition node.
22. Guidance dock (`ComposerDock`, restyled): live -> one-line textarea "Guide the agent…", primary "Queue ↵", secondary "Interrupt" (Enter queues, Shift+Enter new line). Keep every existing dock state and its copy: `recovery_required`, `not_steerable_here`, finished, queue band with ordinals. Muted lines from the prototype for awaiting ("Answer the question above to resume this node.") and past iteration ("Past iterations are read only.").

## Kept features (new home)

| Feature                                                                                                                     | New home                                                    |
| --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Graph view (`WorkflowDagViewer`)                                                                                            | Run column "Graph" toggle                                   |
| Source control / diff panel                                                                                                 | Node column run tab "Changes"                               |
| Files changed                                                                                                               | Run tab "Files"                                             |
| Run terminal                                                                                                                | Run tab "Terminal"                                          |
| Run artifacts + `ArtifactViewerModal`                                                                                       | Run tab "Artifacts"                                         |
| Run logs                                                                                                                    | Run tab "Logs"                                              |
| Run chat timeline                                                                                                           | Run tab "Conversation"                                      |
| Run usage/cost (`RunCostMeta`, `NodeUsageDisclosure`)                                                                       | Run header "Cost" row; node header line                     |
| Env overlay meta (`RunEnvOverlayMeta`)                                                                                      | Run header "Env" row                                        |
| Specialised rooms (`ChildWorkflowRoom`, `LoopGroupRoom`, `GateRoom`, `RouteControllerRoom`, `StdoutRoom`, `LegacyNodeRoom`) | Node column Live stream body                                |
| Dashboard range filter, pagination, delete, resume, Open chat, Open Plannotator, Open in IDE                                | List range select, "Load more", run "More" menu and actions |
| `WorkflowInvoker`                                                                                                           | List header "Start run" dialog                              |

## Files

Create: `src/routes/RunsPage.tsx`; `src/components/runs/RunsListColumn.tsx`, `RunListRow.tsx`, `RunColumn.tsx`, `RunHeader.tsx`, `RunActions.tsx`, `NodeStepList.tsx`, `NodeColumn.tsx`, `NodeTabs.tsx`, `StartRunDialog.tsx`, `LegacyRunRedirect.tsx`; `src/lib/runs/run-list-groups.ts` (filter -> API status, counts), `src/lib/runs/node-extras.ts` (iteration, attempts, conditional text from execution rows); tests beside each. Steps and kind codes come from `src/lib/node-steps.ts` (phase 01).

Modify: `src/lib/runs/run-url.ts` (add parse and legacy mapping; created in 02); replace `/workflows/runs/` and `/dashboard` literals in `WorkflowExecution.tsx` and `ChildWorkflowRoom.tsx` with `buildRunPath`; `src/App.tsx` (only routes `/runs/:runId`, `/runs/:runId/:nodeId`, `/workflows/runs/:runId` redirect; no other phase after 02 edits this file); `src/lib/runs/queries.ts`; `WorkflowExecution.tsx` (stays the data controller; its JSX renders `RunColumn` + `NodeColumn`; reads `:nodeId`/`tab`/`iteration` from the URL instead of `?node=`); `LegacyNodeRoom.tsx` (becomes the node column body; keep `data-testid="legacy-node-room"` for `run-artifacts-panel.spec.ts`), `NodeRoomHeader.tsx`, `NodeTranscriptPane.tsx`, `NodeRoom.tsx`, `NodeRunList.tsx` (or replace with `NodeStepList`; delete if unused), `AskCard.tsx`, `WorkflowAskChrome.tsx`, `ComposerDock.tsx`, `TodoStrip.tsx`, `StdoutRoom.tsx`, `GateRoom.tsx`, `ChildWorkflowRoom.tsx`, `LoopGroupRoom.tsx`, `RouteControllerRoom.tsx`, `RoomIncompleteNotice.tsx`, `WorkflowNodeRetryAction.tsx`, `WorkflowDagViewer.tsx`, `ExecutionDagNode.tsx`, `RunGraphRouteEdge.tsx`, `DagNodeProgress.tsx`, `StatusBar.tsx`, `WorkflowLogs.tsx`, `StepLogs.tsx`, `ChatTimeline.tsx`, `ArtifactSummary.tsx`, `ArtifactViewerModal.tsx`; `source-control/*` and `terminal/*` (classes only); `components/run-artifacts/*`, `components/run-usage/*` (classes only); `src/components/sidebar/WorkflowInvoker.tsx` -> move to `src/components/runs/WorkflowInvoker.tsx`; `src/index.css` (remove `.legacy-run-view` scoped tokens; re-pin its sha256 in `.agents/skills/verify-archon/visual-config.json`).

Delete: `src/routes/DashboardPage.tsx`, `src/routes/WorkflowExecutionPage.tsx`, `LegacyGraphLogsPane.tsx` (+ test, replaced by `RunColumn`/`NodeColumn` tests), `source-control/dag-run-tabs.tsx` (+ test, replaced by `NodeTabs`), `components/dashboard/WorkflowRunCard.tsx` (+ test, replaced by `RunListRow` tests), `components/dashboard/StatusSummaryBar.tsx`. Move `ConfirmRunActionDialog.tsx` to `components/runs/`.

## Steps

- 3A Data and URLs: `run-url.ts`, `run-list-groups.ts`, `node-extras.ts`, queries; routes and redirects. Per-row progress strips need node states that `listDashboardRuns` does not return: fetch `getWorkflowRun` per visible row with `useQueries` (page size 50; terminal runs `staleTime: Infinity`; live runs update from `useDashboardSSE` `dag_node` events through `workflow-store`). See locked decision 6.
- 3B List column.
- 3C Run column (header, actions, step list, graph toggle).
- 3D Node column (header, tabs, rooms, stream rows, ask card, history, output, raw, dock).
- 3E Delete replaced files; update e2e helper and specs; re-pin `index.css`.

## Tests

- Add: `run-url.test.ts` (all redirects and tab/iteration parsing), `run-list-groups.test.ts` (counts per tab, status mapping), `node-extras.test.ts` (iteration n of max, attempts, conditional), `RunListRow.test.tsx`, `RunActions.test.tsx` (actions per status; Open worktree hidden rules), `NodeStepList.test.tsx`, `NodeTabs.test.tsx` (run tabs stay mounted on node change), `NodeColumn.test.tsx` (room kind dispatch, empty states).
- Rewrite: `WorkflowExecution.test.tsx`, `LegacyNodeRoom.test.tsx`, `NodeRoomHeader.test.tsx`, `NodeRunList.test.tsx` (or delete with the file), `AskCard.test.tsx`, `ComposerDock.test.tsx`, `StatusIcon.test.tsx` if glyph markup moved.
- Keep as is (logic unchanged): `lib/execution-room-model.test.ts`, `room-scroll-follow.test.ts`, `todo-state.test.ts`, `steering-dock.test.ts`, `tool-presentation*.test.ts`, `build-log-rows.test.ts`, `select-room-data.test.ts`, `ask-answer-controller.test.ts`, `parse-ask-envelope.test.ts`, source-control and terminal logic tests.
- Delete: `LegacyGraphLogsPane.test.tsx`, `source-control/dag-run-tabs.test.tsx`, `dashboard/WorkflowRunCard.test.tsx`.
- e2e helper `e2e/lib/playwright/run-detail.ts`: `openRunDetail(page, runId, nodeId?)` goes to `/runs/<runId>[/<nodeId>]`; `openLegacyRunDetail` goes to `/workflows/runs/<runId>` and asserts the redirect; `openNodeRoom` clicks the node row button in `getByRole('region', { name: 'Nodes' })` instead of `#node-transition-<id>`.
- e2e specs that break (21 use the helper): agent-finished-iteration, agent-idle-await-expiry, agent-interrupt-redirect, agent-never-sent, agent-queue-convergence, agent-queue-guidance, agent-soft-inject, agent-steering-cross-shell-recovery, agent-todo-strip, agent-tool-row-visual, agent-withdraw-guidance, file-edit-diff, occurrence-navigation, run-artifacts-panel, task-dispatch-body, usage-run-detail, verifier-visual, workflow-run-hitl, workflow-run-hitl-room, workflow-run-hitl-visual, workflow-transcript-display. Most pass after the helper change. Direct selector updates: `#legacy-run-view`, `#node-panel`, `#panel-header .ph-name`, `data-panel-id`, `#graph-world .gnode` in agent-tool-row-visual, workflow-run-hitl-visual, workflow-run-hitl-room -> `data-testid` `runs-list`, `run-column`, `node-column`, and role queries; fixed 460px room width -> node column width. `agent-todo-strip` asserts mono font for todo items and count; the new strip uses Archivo, so update those assertions. Old-mockup reference captures stay as-is until phase 08 (locked decision 5).

## Validation

`bun run --cwd packages/web test`, `bun run type-check`, `bun run lint`, `bun run --cwd e2e test:ui:hitl`, then the 21 specs above with `npx playwright test -c e2e/playwright.config.ts ui/<spec>`. Manual: a running run, a paused AskHuman run, a failed loop run, a completed run with artifacts, a run with a child workflow, light and dark, 1440 and 1024.

## Risks

| Risk                                              | L x I      | Mitigation                                                                                                               |
| ------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| Steering or ask behavior regresses in the restyle | Med x High | No edits to `steering-dock.ts`, `ask-answer-controller.ts`, `execution-room-model.ts`; their tests stay green unchanged. |
| N detail requests for list strips                 | Med x Med  | Bound to visible page; terminal runs cached forever; a server field can come later as separate work.                     |
| Terminal/diff state lost on node switch           | Med x Med  | Keyed by runId, stay mounted; test in `NodeTabs.test.tsx`.                                                               |
| HITL CI red during the phase                      | High x Med | Land 3A to 3E in one PR; run the HITL set before merge.                                                                  |

## Rollback

Revert the PR. `/runs` falls back to the Dashboard from phase 02 and `/workflows/runs/:runId` renders the old page again.
