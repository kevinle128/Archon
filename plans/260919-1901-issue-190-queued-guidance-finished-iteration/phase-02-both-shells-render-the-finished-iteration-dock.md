---
title: 'Phase 2: Render and wire the finished-iteration dock in both shells'
status: pending
priority: P1
effort: '5h'
dependencies: [1]
gate: 'Phase 1 complete with B1/B2 reflected in canonical authority'
---

# Phase 2: Render and wire the finished-iteration dock in both shells

## Goal

Use the shared descriptor to render the same safe, read-only state in Legacy and
Console, switch back through the existing execution-selection path, and preserve
queue order, the tab-local draft, focus, and all pre-existing dock states.

## Verified component paths

```text
LegacyGraphLogsPane (rows + selected row + node states)
  -> LegacyNodeRoom -> NodeTranscriptPane -> ComposerDock

ConsoleInspectPane (logEntries + selected row + node states)
  -> ConsoleNodeRoom -> ConsoleComposerDock
```

- `LegacyGraphLogsPane` and `ConsoleInspectPane` are the first points with the full
  row list and current selection; compute the descriptor there once.
- `LegacyNodeRoom` is a typed pass-through. `NodeTranscriptPane` survives same-node
  execution changes while its keyed `ComposerDock` remounts.
- `ConsoleNodeRoom` already owns transcript scroll/focus and survives same-node row
  changes while its keyed `ConsoleComposerDock` remounts.
- There is one dock mount per shell and no third mount.
- The draft storage key is `(runId, nodeId)`, so switching iteration does not need a
  new persistence mechanism.

## Implementation sequence

### 1. Compute and thread the descriptor

- In `LegacyGraphLogsPane`, call `resolveFinishedIterationView()` with `rows`,
  `selectedRow`, the selected node's visible state, and run liveness. Pass the
  descriptor through `LegacyNodeRoom` to `NodeTranscriptPane`.
- In `ConsoleInspectPane`, call it with `logEntries.map(entry => entry.row)`,
  `selectedRow`, the selected node state, and `isInspectRunLive(run.status)`. Pass it
  to `ConsoleNodeRoom`.
- Reuse or export the existing run-liveness helper instead of creating subtly
  different status lists.
- Keep the existing `onSelectExecution` / `onSelectNode(nodeId, rowId)` paths as the
  only state transition. Do not add iteration-specific selection state.
- When a host has no usable row-selection callback, pass no descriptor and render
  no finished dock; never expose an enabled Go control with no action.

Add only the props required for `{ liveRowId, liveIteration }` and the existing row
selection callback. Do not pass the entire row list into a dock.

### 2. Render a mutation-free branch in each dock

When the mode is `finished-iteration`, render in this DOM/reading order:

1. the exact disclosure;
2. the native `Go to iteration N` button;
3. a 422 detached alert, when present;
4. the existing full-width queue band only when its count is greater than zero.

The band reuses `queueBandHeader()`, `queueListLabel()`, server order, message text,
and the `sent` state label. It has the same `max-h-[33vh] overflow-y-auto` behavior
as the live band but no delete control.

The branch must contain no textarea, send hint, Queue/Send button, delete button,
or bound send/withdraw/interrupt handler. Include `finished-iteration` in polling
enablement so only `readQueue` runs. A successful snapshot clears a prior read
error. Apply the Phase 1 failure rules without replacing send/withdraw refusal
state.

Keep Legacy and Console as separate thin renderers with their surface-specific
focus classes. A small local render helper is acceptable inside each component;
do not introduce a cross-surface UI abstraction for two deliberately parallel
components.

### 3. Hand off focus once across the keyed dock remount

The room component that survives the row change owns a consume-once ref:

- Legacy: `NodeTranscriptPane`;
- Console: `ConsoleNodeRoom`.

On Go activation, store the intended `liveRowId`, then invoke the existing selection
callback. After the selected row commits, clear the pending target **before** moving
focus:

- if the target is now the live composer or blocked composer, focus its textarea;
- if the loop advanced and that target is now another finished iteration, focus the
  newly rendered Go button;
- if the run/node became terminal and the dock disappeared, focus the transcript
  scroller.

Expose the minimum dock ref/auto-focus prop needed to reach its textarea or Go
button. Never use document-wide querying, never focus `<body>`, and never leave the
pending target set after it is consumed. An unrelated refresh/remount must not
steal focus.

### 4. Apply the approved visual contract

Until B2 is approved, do not guess the markup. Under the recommended wrapping
decision, acceptance is:

- the dock remains one structural flex/control row; complete disclosure remains
  visibly readable and may wrap inside its flexible cell at 460px;
- Go button is fully visible, does not shrink below its content, has at least a
  32px height, and carries the existing surface-specific focus ring;
- no horizontal scrollbar or clipped text at 460×900 or 1440×900;
- the queue band spans the room below the control row, caps at 33vh, and scrolls
  internally without covering a focused transcript row;
- at wider desktop width the state remains compact and aligned to the existing
  dock tokens;
- zoom/reflow and long queued text do not create horizontal overflow.

If B2 selects elision, replace only the text-specific criteria with its recorded
visible/accessibility rule; all sizing, order, overflow, and band criteria remain.

## Test-first matrix

### `ComposerDock.test.tsx` and `ConsoleComposerDock.test.tsx`

- exact disclosure and Go label render for a valid descriptor;
- two queue entries render in server order with `sent`, no delete buttons, and the
  queue list's existing accessible name;
- empty queue renders no band;
- no textarea, send hint, Queue/Send control, or steering mutation is reachable;
- `readQueue` fires; send and withdraw spies remain untouched after pointer and
  keyboard interaction;
- Go calls the parent with `liveRowId`;
- a stored node draft is hidden here and restored unchanged when live mode returns;
- 422 displays the detached alert and clears stale band rows; a later 200 clears the
  alert and restores the authoritative snapshot;
- network/5xx do not show detached copy; 409 does not show detached copy and does
  not continue polling;
- normal composer, blocked, detached, and hidden renderer behavior remains green.

### Parent/room integration tests

Test at the ownership boundaries rather than every pass-through component:

- each parent produces the same descriptor from same-lineage rows and no descriptor
  for retry/route/nested-lineage mismatches;
- Go changes the existing `Execution` selection to the resolved row;
- after commit, the correct live/blocked textarea is focused and the same ordered
  queue and draft return;
- an advanced target focuses the new Go control without a composer flash;
- terminal state focuses the transcript scroller and removes the dock;
- later neutral refetches do not refocus anything.

Add a narrow pass-through assertion only where TypeScript coverage cannot prove a
prop reaches the room. Do not create a test in every intermediate component merely
to repeat the same assertion.

### Accessibility and visual component assertions

- DOM order and accessible names match the ratified documents;
- Go activates with Enter and Space through native button behavior;
- alert/status roles are not duplicated;
- the approved wrap/elision classes and non-shrinking button are present on both
  surfaces.

## Files

- `packages/web/src/components/workflows/LegacyGraphLogsPane.tsx`
- `packages/web/src/components/workflows/LegacyNodeRoom.tsx`
- `packages/web/src/components/workflows/NodeTranscriptPane.tsx`
- `packages/web/src/components/workflows/ComposerDock.tsx`
- `packages/web/src/experiments/console/components/ConsoleInspectPane.tsx`
- `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx`
- `packages/web/src/experiments/console/components/ConsoleComposerDock.tsx`
- the focused existing test files at the parent, room, and dock boundaries

No server, workflow engine, generated API, database, or migration files.

## Validation

Run each changed test file first. Then run the Legacy and Console component suites
through the web package's configured test command, followed by web type-check and
lint. Do not run root `bun test`; repository rules require `bun run test` for the
isolated full suite.

Manual verification before E2E:

- same-node switch and stale-target race on both shells;
- keyboard-only Go activation and visible focus;
- 0, 1, and many queued messages;
- 422 then recovery, 409 then terminal refresh, and temporary network loss;
- 460px and wide room widths with long disclosure/message text.

## Exit criteria

- Both shells expose identical behavior and copy through their existing selection
  paths.
- The finished state can read but cannot mutate the node queue.
- Draft, queue order, focus, and all existing dock modes survive the round trip.
- Approved visual states pass at every required width.
- Focused tests, web package tests, type-check, and lint pass.

## Risks and rollback

- A stale Go target can advance before activation; recomputation plus the
  consume-once focus rule handles it without steering the stale iteration.
- A read failure can leave misleading data; 422/409 clear the read-only snapshot,
  while transient failures retain the last known snapshot and retry.
- Rollback removes the props/render branch and restores the previous terminal-row
  hide behavior without persisted-data cleanup.

## Next phase

Phase 3 proves the real loop journey in both shells and closes Story 2.10 only after
Story 2.8 supplies operator transcript rows.
