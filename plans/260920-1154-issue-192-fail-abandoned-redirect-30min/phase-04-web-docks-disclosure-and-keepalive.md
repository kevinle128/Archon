---
title: 'Phase 4: Both docks, accessibility, and failure presentation'
status: todo
---

# Phase 4: Both docks, accessibility, and failure presentation

## Outcome

Add idle-only composer keepalive behavior to Legacy and Console, disclose the fixed time limit, and render the canonical terminal timeout state.
Both shells must have the same behavior without violating the Console import boundary.

## Design authority

- `DESIGN.md` and `EXPERIENCE.md` own layout, content hierarchy, focus, live-region, responsive, contrast, and target-size rules.
- `Steering Dock States.dc.html`, `Legacy Node Room.dc.html`, and `Console Node Room.dc.html` show the required idle and failed states.
- The Console prototype uses a 520 px example width, but the ratified common room check is 460 px.
- The dock remains a sibling of the transcript scroller and must not cover a focused transcript row.
- Existing focus rings, control sizes, typography, queue-band cap, and shell tokens must remain unchanged.

### Artifact reconciliation

`DESIGN.md` and the static mockups show the exact stop disclosure without the later time limit.
`EXPERIENCE.md` and the resolved accessibility review add the ratified inactivity disclosure `no redirect ends this node after 30 min of inactivity · typing keeps it open`.
Preserve the exact stop line and render the exact inactivity line directly below it in the same disclosure block.
This uses the static artifacts for anatomy and the later interaction decision for the new Story 2.12 content.

`EXPERIENCE.md` also lists `Send now` as activity, but the higher-priority Story 2.12 acceptance criteria and steering test plan exclude it because it resolves idle-await.
Do not send keepalive from `Send now`.

## Tests first

Write focused tests in the shared model, both docks, and both room owners before implementation.

### Shared model tests

In `packages/web/src/lib/execution-room-model.test.ts`, prove a new focused selector returns true only when the latest logical execution for the node failed with `failure_reason: 'idle_after_interrupt_timeout'`.

Cover these cases:

1. A latest matching `node_failed` returns true.
2. An ordinary latest failure returns false.
3. A later `node_started`, `node_completed`, `node_skipped`, or `node_skipped_prior_success` clears the old cause.
4. A `node_retry_requested` for the node clears the old cause before the new start arrives.
5. Sibling-node events and loop-iteration diagnostics do not change the selected node's result.
6. Event ordering uses the existing `compareWorkflowEvents()` rule rather than array order.

In `packages/web/src/lib/steering-dock.test.ts`, prove:

1. The exact stop disclosure and exact inactivity disclosure are stable and distinct.
2. The exact visible terminal failure text is stable.
3. The exact polite terminal announcement is stable.
4. A terminal idle-expiry cause selects finished presentation even when the reconciled `Never sent` list is empty.
5. Existing non-timeout terminal behavior stays unchanged.

### Dock component tests

Run the same cases in `ComposerDock.test.tsx` and `ConsoleComposerDock.test.tsx`.

1. Idle renders the exact visible timing disclosure.
2. The first textarea focus sends one bodyless keepalive immediately.
3. The first textarea change sends immediately when no focus call is in the throttle window.
4. A burst within one second is coalesced, while activity after the window sends again.
5. A rejected call is caught and later activity can retry.
6. Generating, queue-only, interrupting, blocked, finished, detached, and finished-iteration modes send no keepalive.
7. Focusing or clicking `Send now` sends no keepalive.
8. `Send now` itself sends only the existing send request.
9. Run or node scope changes do not let an old throttle suppress the first activity in the new scope.
10. Timeout terminal presentation removes the field and all mutation controls.
11. Timeout terminal presentation shows the exact visible failure text even with no unmatched items.
12. With unmatched items, it keeps the ordered read-only `Never sent` list and uses one polite timeout status instead of the generic assertive terminal alert.
13. Focus moves to the last transcript row or scroller when the composer disappears and never lands on `<body>`.

### Room integration tests

In `NodeTranscriptPane.test.tsx` and `ConsoleNodeRoom.test.tsx`, pass real ordered event fixtures through the new selector and prove the timeout presentation appears from the structured event data.
Also prove a later retry or successful terminal does not show stale timeout copy.

## Shared UI model

In `packages/web/src/lib/steering-dock.ts`:

- Preserve the existing interrupt disclosure as `stopped after the last completed tool call · files already written stay written`.
- Add `no redirect ends this node after 30 min of inactivity · typing keeps it open` as a separate shared constant.
- Add `interrupted by operator, no redirect received · failed after 30-minute idle timeout` as the timeout terminal visible copy.
- Add `node failed · interrupted with no redirect · none of this was sent` as the timeout terminal polite status copy.
- Extend the finished-mode decision with an explicit timeout-failure boolean.
- Keep the generic `node finished · none of this was sent` behavior for other terminal causes.
- Keep all copy and state decisions framework-free and shared by both shells.

Do not add a generic debounce library or a new React hook file for two mirrored call sites.

## Structured terminal cause

In `packages/web/src/lib/execution-room-model.ts`, add one narrow selector such as `latestNodeFailedByIdleExpiry(events, nodeId): boolean`.
The selector owns the literal comparison to `failure_reason` and clears its result on a later execution or retry event.

Use it directly where the full event list already exists:

- `NodeTranscriptPane.tsx` for Legacy.
- `ConsoleNodeRoom.tsx` for Console.

Pass only the derived boolean into the dock.
Do not thread raw failure prose through parent components and do not import `@archon/workflows` into the web package.

## API clients

Add the generated type alias and bodyless POST helper in both client modules:

- `packages/web/src/lib/api.ts` for Legacy.
- `packages/web/src/experiments/console/skills/runs.ts` for Console.

Name the function consistently, for example `keepaliveWorkflowNode(runId, nodeId)`.
Normalize errors through each client's existing steering error path.
Do not add a request body, JSON content type, automatic retry, or local sub-state update.

## Dock interaction

Add an injectable keepalive prop to each dock for focused tests and default it to that shell's API helper.
Keep the existing duplicated shell JSX thin and semantically identical.

Use a one-second leading throttle with component refs:

- Send immediately on the first eligible event.
- Suppress later eligible events until one second has elapsed.
- Reset the throttle on run or node scope change and when a new idle epoch begins.
- Catch rejection and reopen the throttle so the next activity can retry.
- Ignore stale request completion after the scope or idle epoch changes.
- Do not update React state from the keepalive response.

Attach keepalive to the textarea's `onFocus` and `onChange` only.
Call it only when the current derived agent mode is idle.
Leave the existing composer-well `onFocusCapture` and `onBlurCapture` behavior unchanged for focus ownership.

## Terminal presentation

Add an explicit dock prop for the derived timeout failure.
When node-terminal evidence and that prop are both true:

- Select finished mode even when there is no `Never sent` item.
- Remove the textarea, Stop, Queue, Send now, and delete controls.
- Render the read-only `Never sent` band when reconciliation found items.
- Render the exact visible timeout failure text below the optional band.
- Expose the exact polite timeout status once.
- Do not also render the generic `node finished` alert for this cause.
- Reuse the existing finished-mode focus handoff.

## Visual acceptance

Verify Legacy and Console in all required states at a 460 × 900 viewport and at a 1440 × 900 page viewport.
For Console, record the actual panel width at the wide viewport rather than forcing the 520 px prototype example.

### Idle state

- The exact stop disclosure appears first and the exact inactivity disclosure appears directly below it.
- Both disclosure lines may wrap without clipping.
- The textarea label, field, hint, `Send now`, and optional `Will send` band retain the existing order and tokens.
- The control row stays usable with no room-driven horizontal overflow.
- The `Send now` target remains at least 84 px wide and 32 px high.
- The queue band remains full width and capped at 33vh.
- The 2 px shell-specific focus ring remains visible and at least 3:1 against its adjacent background.
- The transcript's last focused row remains reachable above the sibling dock.

### Timeout-failed state

- The room header and selected execution show failed state through text or glyph as already designed.
- The optional `Never sent` list is read-only, ordered, labelled with its count, and contains no delete control.
- The exact timeout failure disclosure is visible below the list, or as the only dock content when the list is empty.
- No composer or mutation control remains.
- Long message text stays ellipsized in list rows, while the failure disclosure wraps fully.
- No copy is clipped, no element overlaps, and no horizontal scrollbar is introduced by the room.
- Focus lands on the transcript row or scroller, not `<body>` and not an unmounted control.
- The accessibility tree contains one polite timeout-failure status and no competing generic timeout alert.

## Files

| File                                                                           | Action                                                |
| ------------------------------------------------------------------------------ | ----------------------------------------------------- |
| `packages/web/src/lib/api.ts`                                                  | Add the Legacy keepalive client.                      |
| `packages/web/src/experiments/console/skills/runs.ts`                          | Add the Console keepalive client.                     |
| `packages/web/src/lib/steering-dock.ts`                                        | Add shared copy and timeout-finished semantics.       |
| `packages/web/src/lib/steering-dock.test.ts`                                   | Add copy and state tests.                             |
| `packages/web/src/lib/execution-room-model.ts`                                 | Derive the latest structured timeout cause.           |
| `packages/web/src/lib/execution-room-model.test.ts`                            | Test ordering, retry clearing, and sibling isolation. |
| `packages/web/src/components/workflows/ComposerDock.tsx`                       | Add Legacy activity and terminal rendering.           |
| `packages/web/src/components/workflows/ComposerDock.test.tsx`                  | Test Legacy interaction, focus, and accessibility.    |
| `packages/web/src/components/workflows/NodeTranscriptPane.tsx`                 | Derive and pass the timeout cause.                    |
| `packages/web/src/components/workflows/NodeTranscriptPane.test.tsx`            | Test Legacy event-to-view integration.                |
| `packages/web/src/experiments/console/components/ConsoleComposerDock.tsx`      | Add Console activity and terminal rendering.          |
| `packages/web/src/experiments/console/components/ConsoleComposerDock.test.tsx` | Test Console interaction, focus, and accessibility.   |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx`          | Derive and pass the timeout cause.                    |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx`     | Test Console event-to-view integration.               |

## Verification

```bash
cd packages/web
NODE_ENV=development bun test src/lib/steering-dock.test.ts src/lib/execution-room-model.test.ts
NODE_ENV=development bun test src/components/workflows/ComposerDock.test.tsx src/components/workflows/NodeTranscriptPane.test.tsx
NODE_ENV=development bun test src/experiments/console/components/ConsoleComposerDock.test.tsx src/experiments/console/components/ConsoleNodeRoom.test.tsx
bun run type-check
```

Run the existing Console isolation test in the package's normal test script or focused command to prove Console still imports nothing from `@/components/`.

## Exit criteria

- [ ] Both shells use generated types through their existing client boundary.
- [ ] Activity is immediate, throttled, idle-only, and never attached to `Send now` focus.
- [ ] Terminal cause derives from structured event data and clears on retry.
- [ ] Visible and accessible timeout copy matches the design authority exactly.
- [ ] Finished focus and read-only behavior remain correct with zero or many unmatched items.
- [ ] The 460 px and wide visual acceptance criteria are ready for Phase 5 browser proof.

## Risks and rollback

- Attaching activity to the well would count focus on `Send now`, so use the textarea event only.
- A trailing debounce near the deadline can lose the last activity, so use leading delivery.
- Prose matching would make natural language a wire format, so use `failure_reason`.
- A second live region can drop or duplicate the important failure announcement, so use one timeout-specific polite status.
- Rollback leaves the additive server route unused and older clients ignore the event-data field.

## Next phase

Prove the real route and UI journey on both shells, prove the seeded terminal presentation, and run the full repository gates.
