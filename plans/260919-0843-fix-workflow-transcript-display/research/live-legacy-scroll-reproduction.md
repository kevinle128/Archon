# Live Legacy Scroll Reproduction

## Environment

The reproduction used the active Chrome tab for `/legacy/workflows/runs/e73e53b6e9f38033b389ddf037c0b620` on 2026-09-19.
The run room was open for `ralph-loop-run` with a long transcript.
No application process was started, stopped, or changed during the reproduction.

## End-User Trigger

1. Open the graph view for a workflow run.
2. Open a node room with a long agent transcript.
3. Scroll the transcript.
4. Move the pointer out of the `legacy-run-room` scroll region or continue scrolling at its boundary.

The outer document accepts the scroll.
The top navigation and run headers move out of the viewport.
The page exposes a large blank region below the run view.

## Browser Measurements

The viewport height was `873px`.
`document.body.scrollHeight` was `873px`, but `document.documentElement.scrollHeight` was approximately `17,827px` and later exceeded `18,000px` as new transcript rows arrived.
`window.scrollY` reached `668px` while the application shell was intended to remain viewport-locked.
The transcript scroller was `[data-testid="node-transcript-scroll"]` with `overflow-y: auto` and a `688px` client height.
The `legacy-run-room` panel itself had a `728px` client height.

## Proven Cause

Tool disclosure rows render an absolutely positioned `span.sr-only` inside a static `summary` in `packages/web/src/components/workflows/NodeRoom.tsx`.
The `summary` does not establish a containing block.
The browser therefore places those visually hidden spans against an outer containing block using their transcript static positions.
Measured `sr-only` spans appeared near `17,000px` even though their visible summaries were inside the `688px` transcript viewport.
Those absolute descendants enlarge the root document scroll range.
Wheel input can then escape the transcript and move the root document.

The transcript scroller also has no overscroll containment in `packages/web/src/components/workflows/NodeTranscriptPane.tsx`.
That omission permits wheel or touch scroll chaining when the transcript reaches a boundary.

## Cause-Aligned Repair Boundary

Make each tool-row `summary` a positioned containing block so its `sr-only` status stays local to the row.
Contain vertical overscroll on the transcript scroller so boundary input cannot chain into the document.
Keep the app shell viewport-locked and verify that no transcript descendant can make the root document taller than the viewport.

Do not remove the accessible status label.
Do not disable transcript scrolling.
Do not use JavaScript wheel interception when CSS positioning and overscroll containment provide the native fix.

## Required Regression Evidence

The component test must assert the positioned tool summary and the overscroll containment class on the transcript scroller.
The browser test must use a long real room transcript, scroll inside the room, move the pointer outside the room, and continue wheel input.
The browser test must assert `window.scrollY === 0` and `document.documentElement.scrollHeight === window.innerHeight` within normal rounding tolerance.
The browser test must assert that the top navigation, run header, graph tabs, and node-room header keep stable visible bounding boxes.
The browser test must also prove that the transcript `scrollTop` changes while the pointer is inside its scroll region.
