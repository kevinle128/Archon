---
phase: 3
title: 'Approved vertical order'
status: pending
dependencies: [issue-ownership-decision]
---

# Approved vertical order in both room bodies

## Context and files

`packages/web/src/components/workflows/NodeTranscriptPane.tsx` and `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx` currently render todo before the transcript. Their room regions have the scroller, controls, and dock as siblings. Each dock already renders queue before its textarea. `NodeTranscriptPane.test.tsx` and `ConsoleNodeRoom.test.tsx` currently pin the obsolete todo-before-scroller order; Console's isolation test protects its separate markup. Legacy's `RoomRegion` is in `NodeRoom.tsx`; Console's local `RoomRegion` applies a 4px outset when todo is shown so the focus outline is not clipped.

## Steps

1. In paired component tests, use equivalent data with multiple occurrence groups, todos, an active dock, and queued guidance. Assert the room-region direct-child order is scroller → controls → todo → dock and that the dock's queue precedes the composer. Rerender each shell after the same semantic todo/queue update and assert equal meaning without a cross-shell component import. Identify elements by roles, labels, and existing test ids, not presentation classes. Flip the two obsolete order assertions.
2. Cover the meaningful absent states: controls absent with one occurrence and scroll following; controls present for `Jump to latest` alone; no todos; empty queue; terminal/no dock; read-only finished iteration with a queue but no composer. Assert missing bands leave no empty slot and no unrequested steering action appears.
3. Move only the todo element in each JSX tree from before the scroller to after controls. Retain its `resolvedScopeKey`, props, conditions, folding, queue behavior, and separate shell tokens. Keep the scroller `min-h-0 flex-1` with its own `overflow-y-auto`; keep lower siblings outside it. Review the existing Console outset margin after the move: preserve an unclipped visible focus ring for the todo toggle at the new edge, adjusting only if the browser proves clipping.
4. Re-run room-body tests, scroll-follow/focus tests, and `console-isolation.test.ts`. Phase 4 checks actual element boxes and last-row reachability at all required viewport modes. Do not change `Execution`, `Jump to` semantics, todo content, dock state, or server data flow.

## Design resolution

The older static `key-console-node-room.html` and `key-legacy-node-room.html` show todo before occurrence controls; the interactive handoff omits that navigator. Story 10.1 Task 2 supplies the corrected full order, and its Dev Notes explicitly prioritize corrected written contracts over older mock images. The visual review uses that order while preserving the mockups' panel widths, strip/queue styling, and state meanings.
