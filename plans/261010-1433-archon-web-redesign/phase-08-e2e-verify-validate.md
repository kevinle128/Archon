# Phase 08: e2e sweep, verify-archon, docs, full validation

Status: in progress. Depends on: 03, 04, 05, 06, 07. Effort: 1.5d.

Delivery notes (so far):

- Full `test:ui`: 155 passed, 2 skipped, 2 failed before the last fix. The failures were a real regression: an `after:content` arrow put "→" into the accessible name of the Ask Submit and Start run buttons; the arrows are now `aria-hidden` spans. `test:ui:hitl`: 33 passed, 2 skipped after the fix.
- Real bugs found by the sweep and fixed: loop-group body nodes now use their runtime ids (`<group>.<body>`) in the step list, so deep links and status match; the Needs you button opens `/runs?filter=needs` and the list keeps the filter; one `h1` per screen (chat thread title and run title are `h2`); delete-diff text and line numbers clear 4.5:1 (derived tokens, not handoff colors).
- verify-archon: sources now pin the redesign handoff (README, Runs Workspace prototype, its scripts and design-system bundle), the run-view mockup for the graph, the steering handoff for the queue band, the brand guide and `index.css`. Criteria keep their ids. Tool rows, agent text and the Ask card use the handoff as reference; the graph and queue band keep earlier references (listed as accepted differences, because the handoff has no graph view and shows queued guidance as operator rows). `desktop_room_width` is removed; the node column width comes from the layout.
- Deviation from requirement 4: the visual config captures the light theme only (`theme: light`), as the handoff is light only. Dark is checked by the screenshot pass, not by the image reviewer.
- Surface id stays `legacy` in the config: the run view keeps its `legacy-*` element ids, so renaming the surface would only rename evidence files.
- Docs: `adapters/web.md` describes the top bar, Runs workspace, Chat, Workflows, Settings sections, run routes and redirects, and the Builder; `guides/authoring-workflows.md` points stuck runs at the Runs workspace.

Remaining: transcript stream-row restyle (time column, 14.5px agent text, handoff tool rows) with its pinned specs, the fidelity fixes from the screenshot pass, and the kept-features walk.

## Context

- e2e: 30 specs in `e2e/ui/` (count at plan time). CI job `e2e-hitl` in `.github/workflows/test.yml` builds the web (`bun run build:web`), runs `bun run --cwd e2e typecheck`, then `bun run --cwd e2e test:ui:hitl` (`--grep 'HITL'`: agent-queue-guidance, verifier-visual, workflow-run-hitl-visual, agent-tool-row-visual, run-artifacts-panel, workflow-run-hitl, workflow-run-hitl-room). Other specs run only with `test:ui` (local). Helpers: `e2e/lib/playwright/run-detail.ts` (rewritten in 03), `archon-runtime.ts`, `cost-console.ts`, `suite.ts`.
- Each screen phase already fixed the specs it broke. This phase runs the full suite, removes stale assertions, and adds smoke coverage for the new shell.
- verify-archon: `.agents/skills/verify-archon/visual-config.json` (sources with sha256 pins, six criteria `row-anatomy`, `raw-disclosure`, `ask-card`, `assistant-report`, `runtime-graph`, `queue-anatomy`; surfaces `legacy`; theme `dark`; `desktop_room_width` 460; viewports 1440x1000 and 390x844). Feature docs `features/run-ui.md` (+ `.json`) describe the run view routes and dock geometry. `SKILL.md` "ui.visual" recipe.
- Docs: `packages/docs-web/src/content/docs/adapters/web.md` describes Navigation (Chat, Dashboard, Workflows, Settings), a Dashboard section at `/dashboard`, and the execution detail page. `reference/api.md` "Dashboard" is the API, not the page; no change.

## Requirements

1. `bun run validate` passes.
2. `bun run --cwd e2e typecheck` and `bun run --cwd e2e test:ui:hitl` pass.
3. `bun run --cwd e2e test:ui` passes; any remaining failure is listed in the PR with cause and owner.
4. verify-archon: per locked decision 5 rewrite criteria against the new handoff:
   - sources: replace old mockup entries with `claude-design/design_handoff_archon_redesign/README.md` and `Archon Runs Workspace.dc.html` (sha256 pinned), plus re-pinned `packages/web/src/index.css` and the brand `index.md`. Decide with the user whether the handoff folder is committed (it is untracked today); pins need tracked files.
   - criteria: keep the six ids; rewrite `expected` text to the new anatomy (tool row in the node column stream, raw JSON in the Raw tab, AskHuman card per README, assistant text rows, `runtime-graph` = Run column Graph view, queue band in the guidance dock).
   - surfaces `runs`; theme `light` and `dark`; replace `desktop_room_width` with the node column rule (`minmax(0,1.4fr)` at 1440 = measured width, ±2px).
   - Update `features/run-ui.md` (+ `.json`) routes to `/runs/:runId/:nodeId` and the legacy redirect.
5. Visual specs that compared against old mockups (`workflow-run-hitl-visual.spec.ts`, `agent-tool-row-visual.spec.ts`, `verifier-visual.spec.ts`): point their reference capture at the handoff prototype (`Archon Runs Workspace.dc.html`) or remove the mockup side of the comparison, matching decision 3. Keep the measured-geometry checks.
6. New smoke spec `e2e/ui/redesign-shell.spec.ts` (tag `[P1]`, not HITL): top bar nav names, project filter persists across reload, Needs you navigates to `/runs?filter=needs`, redirects (`/`, `/dashboard`, `/workflows/runs/<id>?node=<n>`), theme toggle sets `.dark` on `<html>`, each screen renders its main heading.
7. Docs: rewrite `adapters/web.md` sections Navigation, Dashboard -> "Runs workspace", execution detail -> node column tabs; add a line that `/workflows/runs/<id>` links from Slack/Telegram still work (redirect). Brand guide was updated in 01.
8. Manual "Kept features" checklist: walk every row of the tables in phases 02 to 07 on a dev server, light and dark. Record pass/fail in the PR.

## Files

Modify: `e2e/ui/*.spec.ts` as needed, `e2e/lib/playwright/*.ts` as needed, `.agents/skills/verify-archon/visual-config.json`, `.agents/skills/verify-archon/features/run-ui.md`, `.agents/skills/verify-archon/features/run-ui.json`, `.agents/skills/verify-archon/SKILL.md` (only if the `ui.visual` recipe names old surfaces), `packages/docs-web/src/content/docs/adapters/web.md`.
Create: `e2e/ui/redesign-shell.spec.ts`.

## Steps

1. Run the full e2e suite; group failures by cause (selector, copy, layout, real bug).
2. Fix real bugs in the owning screen files (small follow-up commits; name the screen, not the phase).
3. Update selectors and copy; prefer roles and accessible names over ids.
4. Rewrite verify-archon config and feature docs; run the skill's integrity check (`verifier-visual.spec.ts`).
5. Update docs. Run `bun run validate`.
6. Walk the kept-features checklist.

## Tests

- Add: `redesign-shell.spec.ts`.
- Update: any spec still failing after phases 03 to 07 (list each in the PR).
- Remove: assertions that only checked old-mockup pixel targets, when decision 3 says so.

## Validation

`bun run validate`; `bun run --cwd e2e typecheck`; `bun run --cwd e2e test:ui:hitl`; `bun run --cwd e2e test:ui`; verify-archon `ui.visual` recipe if a `codex exec` reviewer is available (otherwise record "incomplete", per `SKILL.md`).

## Risks

| Risk                                           | L x I      | Mitigation                                                                                                      |
| ---------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------- |
| verify-archon pins an untracked handoff folder | High x Med | Ask the user to commit the handoff (or a trimmed copy under `_bmad-output/` like older mockups) before pinning. |
| Flaky HITL specs mask real regressions         | Med x Med  | Re-run failures 3 times; a spec that fails once in 3 gets a cause before merge.                                 |

## Rollback

Revert the PR; screens keep working, only tests, skill config, and docs revert.
