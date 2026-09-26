# Workflow rooms

## Sub-features

Console and Legacy navigation, node rooms, tool rows and Raw disclosure, Ask cards, transcript display, queued guidance, and visual conformance.

## How to get to it (user POV)

Open a workflow run in Console or Legacy and select a node.
Use its Log, Graph, and Artifacts views; open the same room through a deep link and a narrow viewport.
Open Raw on a tool row, answer a pending Ask, and queue guidance while the agent is running.

## Driving it with Playwright

Run the recipes that match the requested behavior.
`ui.rooms` checks navigation, room layout, graph selection, artifacts, deep links, and mobile Back on both surfaces.
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
Inspect the current approved references; do not reinterpret scope reductions as permission to redesign remaining elements.
The test provider proves engine/UI integration, not a live model.
Queue evidence uses the current proof directory so cleanup never restores or overwrites the user's tracked acceptance images.
