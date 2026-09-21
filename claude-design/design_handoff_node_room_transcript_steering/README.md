# Agent Node Room design handoff

This handoff contains the approved Console and Legacy Node Room mockups for readable transcripts and live turn steering.
The canonical behavior is defined by `_bmad-output/specs/spec-agent-node-room/SPEC.md`, its companion contracts, and the two UX spines.
When a static label in a mockup conflicts with those contracts, the contracts win.

## Current scope

All approved behavior visible in these mockups is current implementation scope.
The handoff does not define Agent Node Room behavior for CLI `--detach`.
It does not change the completed historical Cancel feature.
It does not add individual-tool cancellation because Stop ends the whole current agent turn.

## Files

| File | Purpose |
| --- | --- |
| `Console Node Room.dc.html` | Interactive Console room at the approved 520-pixel panel width. |
| `Legacy Node Room.dc.html` | Interactive Legacy room at the approved 460-pixel panel width. |
| `Steering Dock States.dc.html` | Static reference for live-turn, terminal, and restart-recovery dock states. |
| `Transcript States.dc.html` | Static reference for tool families, outcomes, todo rows, and expanded bodies. |
| `support.js` | Local runtime used by the interactive `.dc.html` files. |

## Shared Node Room anatomy

Console and Legacy use separate markup shells with equivalent behavior.
Both use the same semantic presentation contract and the same ordered regions.

1. The panel header identifies the selected node execution.
2. The transcript scroller shows assistant, operator, tool, thinking, prompt, and advisor rows in server sequence order.
3. The collapsible todo strip sits below the transcript scroller.
4. The durable queue band sits below the todo strip when it has content.
5. The composer dock sits at the bottom while the selected node can receive guidance.

The Console panel is 520 pixels wide.
The Legacy panel is 460 pixels wide.
Tool rows do not wrap at either width.

## Transcript behavior

Each tool call has one collapsed scan row with a status glyph, family chip, full semantic headline, and ordered badges.
Succeeded rows start collapsed.
Failed rows start expanded.
Running, interrupted, and unknown rows start collapsed.
A reader's manual disclosure choice survives live rerenders.

The Raw control is closed by default and is the only default path to the original JSON.
Node Room, RunStream, Chat, and backend formatting use one semantic fixture contract.
Successful Codex file-change events are persisted before they enter this presentation path.

## Todo behavior

Earlier todo mutations remain compact `todo updated` rows.
The latest applicable todo row can show the approved inline checklist.
The todo strip below the transcript uses the same folded projection.
Terminal completed or interrupted styling is a presentation projection and never rewrites persisted todo events.

## Durable draft and queue behavior

Composer drafts are saved on the server for their author.
Queued guidance is saved on the server for the node and is shared by permitted operators.
Drafts, queue order, delivery state, and the auto-send setting survive reload, tab close, and server restart.

The queue is a full-width elevated band above the composer dock.
Each item keeps its author and caller-stamped message identifier.
A per-item `Send now` appears only when the active provider has verified soft injection.
Queue-only providers omit that action.

The `Auto-send` control is durable.
When enabled, it dispatches exactly one eligible FIFO item after a natural agent reply.
Stop never triggers auto-send.
A failed automatic dispatch returns the item to the front of the queue.

## Stop behavior

Stop ends the current agent turn through `AgentRequestOptions.interruptSignal`.
It does not stop the node or workflow run.
The provider session remains available for the next turn.
The active tool becomes `interrupted`.
Completed writes and other completed side effects remain in place.
No rollback runs.

The `Stopping…` state is a brief UI transition.
It uses `aria-disabled` instead of the native `disabled` attribute so keyboard focus remains stable.
When the turn settles, focus moves to the next valid dock control or transcript target and never falls to `<body>`.

## Restart recovery

A live provider process or stream does not survive server restart.
The durable draft, queue, FIFO order, delivery state, and auto-send setting do survive.

After restart the dock is read-only and shows:

`restored after server restart · Resume the workflow to continue`

The user invokes the existing Resume action.
Archon does not automatically resume and does not resend an ambiguous dispatch.

## Delivery states

The UI advances a message only to the state that the provider adapter can prove.
Correlation uses the stamped message identifier.
Text and timestamps are never used to infer delivery.
Claude delivery acknowledgement is current work in Story 8.3.

## Additional current surfaces

The run view includes a Files Changed panel and deterministic node-level Git attribution.
Unknown attribution is shown as unknown and is never inferred from agent prose.

Displayable thinking uses its own role treatment and privacy contract.
The triggering prompt retains actor and source attribution.
Advisor notifications retain advisor identity and server sequence order.
These sensitive content channels are not copied into application logs.

## Accessibility and validation

Outcome is never encoded by colour alone.
All controls retain visible focus, keyboard access, minimum target size, and reduced-motion behavior.
Ordinary state changes use one polite status region.
Delivery failure uses one assertive alert.

Visual acceptance covers Console at 520 pixels and Legacy at 460 pixels.
Behavior acceptance covers both shells with the same semantic fixtures and equivalent interaction assertions.
