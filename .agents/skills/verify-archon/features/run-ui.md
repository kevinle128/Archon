# Workflow rooms

## Sub-features

Run-room navigation, node rooms, tool rows and Raw disclosure, Ask cards, transcript display, queued guidance, and visual conformance.

## How to get to it (user POV)

Open a workflow run at `/workflows/runs/<run-id>` and select a node.
The run shell tabs are Graph, Logs, Chat, Source Control, Files changed, and Terminal.
Artifacts is a header button that opens a file panel beside the room.
Open the same room through a deep link and a narrow viewport.
Open Raw on a tool row, answer a pending Ask, and queue guidance while the agent is running.

## Driving it with Playwright

Run the recipes that match the requested behavior.
`ui.rooms` checks room layout, graph selection, deep links, narrow Back, and the Artifacts header panel. It does not drive Source Control, Files changed, or Terminal.
`ui.tools` checks Raw disclosure, keyboard access, geometry, and contrast.
`ui.ask` checks real pending requests, submitted answers, retained decisions, focus, mobile layout, and CLI/web resume behavior.
`ui.transcript-display` checks one-string report unwrap, multi-field labeled values with a collapsed Raw JSON disclosure, the Legacy scroller at desktop and narrow sizes, and graph interaction.
`ui.queue-guidance` checks direct and loop delivery, blocked and detached states, and dock geometry on the run room.
`ui.visual` captures matched product/reference states for the Legacy room and evaluates the approved design criteria in `../visual-config.json`.
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
