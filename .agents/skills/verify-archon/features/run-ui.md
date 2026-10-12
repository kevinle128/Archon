# Runs workspace and node rooms

## Sub-features

The Runs workspace (runs list, run column, node column), node rooms, tool rows and Raw disclosure, Ask cards, transcript display, queued guidance, and visual conformance to `claude-design/design_handoff_archon_redesign/`.

## How to get to it (user POV)

Open a run at `/runs/:runId` and select a node; the room opens at `/runs/:runId/:nodeId`.
Use the List and Graph views and the run tabs (Changes, Files, Terminal, Artifacts, Logs); open the same room through a deep link, an old `/workflows/runs/:runId?node=` link, and a narrow viewport.
Open Raw on a tool row, answer a pending Ask, and queue guidance while the agent is running.

## Driving it with Playwright

Run the recipes that match the requested behavior.
`ui.rooms` checks navigation, the two-column run layout, graph selection, artifacts, deep links, legacy redirects, and mobile Back.
`ui.tools` checks Raw disclosure, keyboard access, geometry, and contrast.
`ui.ask` checks real pending requests, submitted answers, retained decisions, focus, mobile layout, and CLI/web resume behavior.
`ui.transcript-display` checks structured report rendering, the Legacy scroller at desktop and narrow sizes, and graph interaction.
`ui.queue-guidance` checks direct and loop delivery, blocked and detached states, dock geometry, and both routes.
`ui.visual` captures matched product/reference states and evaluates the approved design criteria in `../visual-config.json`.
Select visual checks for affected UI behavior.
The helper maps these recipes to real tests in `e2e/ui/` through `lib/browser-scenarios.ts`.

Each required test must run and pass.
Capture the interaction and resulting UI, plus persisted answers or delivered guidance where relevant.
Keep Playwright reports, images, measurements, and visual review results.

## Gotchas

Use port 13400 only when free, Chrome or the configured Playwright channel, and installed E2E dependencies.
Visual review also requires authenticated `codex exec` with image input.
Inspect the current approved references; the redesign handoff is the reference for tool rows, agent text and Ask cards, and the accepted differences in `../visual-config.json` name the states that keep earlier references.
Do not reinterpret scope reductions as permission to redesign remaining elements.
The test provider proves engine/UI integration, not a live model.
Queue evidence uses the current proof directory so cleanup never restores or overwrites the user's tracked acceptance images.
