---
phase: 4
title: 'Phase 4: Dock disclosure, keepalive wiring, and fail copy'
status: pending
priority: P1
effort: '6h'
dependencies: [2, 3]
---

# Phase 4: Dock disclosure, keepalive wiring, and fail copy

## Goal

Make Legacy and Console truthfully disclose the inactivity bound, translate
focus/keystroke activity into bounded keepalive calls without early expiry, and
name the expiry cause when Story 2.11 restores queued messages. Preserve the
authoritative dock anatomy and finished-empty behavior.

## Design authority and current code

- `EXPERIENCE.md` fixes the exact idle and expiry strings, says the disclosure
  belongs in the composer well, and says a finished node with no undelivered
  message has no dock.
- `DESIGN.md` and the co-located `key-steering-dock.html`,
  `key-legacy-node-room.html`, and `key-console-node-room.html` fix the layout,
  tokens, queue-band cap, and responsive panels. They contain no conflicting
  Story 2.12 copy; `EXPERIENCE.md` is the authority for the new line.
- `ComposerDock.tsx` and `ConsoleComposerDock.tsx` have the same affected
  anatomy and injectable API functions. Mirror their shell edits; keep state
  logic framework-free in `packages/web/src/lib/steering-dock.ts`.
- `LegacyGraphLogsPane` and `ConsoleInspectPane` already compute terminal
  evidence and own the raw `NodeExecution[]` needed for cause detection.
- The generated `NodeExecution` type already includes status, error,
  `retry_epoch`, `started_at`, and `ended_at`.

## Files

| Area            | Files                                                                                                                                  |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Shared behavior | `packages/web/src/lib/steering-dock.ts`, `.test.ts`                                                                                    |
| Cause evidence  | `packages/web/src/lib/execution-room-model.ts`, `.test.ts`                                                                             |
| Legacy          | `components/workflows/ComposerDock.tsx`, `LegacyGraphLogsPane.tsx`, `LegacyNodeRoom.tsx`, `NodeTranscriptPane.tsx`, and affected tests |
| Console         | `experiments/console/components/ConsoleComposerDock.tsx`, `ConsoleInspectPane.tsx`, `ConsoleNodeRoom.tsx`, and affected tests          |

The affected pass-through tests are the co-located `ComposerDock`,
`LegacyGraphLogsPane`, `LegacyNodeRoom`, `NodeTranscriptPane`,
`ConsoleComposerDock`, `ConsoleInspectPane`, and `ConsoleNodeRoom` test files.

## Shared behavior design

1. Add exact constants:
   - `STEERING_IDLE_AWAIT_DISCLOSURE` =
     `no redirect ends this node after 30 min of inactivity · typing keeps it open`
   - `STEERING_NEVER_SENT_IDLE_EXPIRED_DISCLOSURE` =
     `node failed · interrupted with no redirect · none of this was sent`
   - local `IDLE_AWAIT_EXPIRED_ERROR` =
     `interrupted by operator, no redirect received`
   - `STEERING_KEEPALIVE_COALESCE_MS = 30_000`

   Keep the local engine string documented as an intentional package-boundary
   mirror. Do not import `@archon/workflows` into the web package.

2. `neverSentDisclosure(idleAwaitExpired)` selects the Story 2.12 alert only
   for that exact cause; all other terminal reconciliation keeps Story 2.11's
   existing copy.
3. Add a framework-free `createKeepaliveCoalescer` with injected clock and
   scheduler for tests. Required behavior:
   - first eligible activity calls `send()` immediately;
   - activity during the 30-second window marks one trailing send due at the
     window boundary; more activity does not add timers;
   - after the trailing send, continued activity begins the next bounded
     window; thus the final activity is represented no more than 30 seconds
     later and never expires early because it was omitted;
   - `dispose()` cancels pending work and makes callbacks/in-flight completion
     inert;
   - a rejected request does not mutate UI or disable the window. Future
     activity remains coalesced and can drive the one trailing request at the
     boundary; attach a rejection handler so no unhandled promise escapes and
     a persistent outage cannot turn held keys into a request storm.

   A leading-only throttle is forbidden: it can allow expiry before 30 minutes
   have elapsed from the last keystroke.

4. Add a small key predicate that excludes only the exact keyboard shortcut
   that the dock will execute as `Send now`. IME/composition keystrokes count
   as activity when they are not an actual submit shortcut.

## Cause-evidence design

Add `hasIdleAwaitExpiredEvidence(executions, selectedNodeId)` next to
`hasTerminalNodeEvidence`:

1. Filter to the selected node. Require at least one row and require every row
   for that node to be terminal; otherwise false so reconciliation cannot race
   a new attempt.
2. Select the latest row by highest `retry_epoch` (missing = 0), then latest
   effective timestamp (`started_at ?? ended_at ?? ''`), then later original
   array position as a stable tie-breaker.
3. Return true only when that row is `failed` and its error exactly equals the
   local expiry constant.
4. Evaluate the actual selected id. A loop-group body uses `grp.body`; the
   outer `grp` row intentionally contains a composite error and must not drive
   the body dock.

Compute this beside `nodeTerminal` in `LegacyGraphLogsPane` and
`ConsoleInspectPane`, then thread an optional `idleAwaitExpired` boolean through
the existing room/pane chain to each dock. Do not add a new global store.

## Dock integration

Apply the same behavior to both docks:

1. Add injectable `keepalive = keepaliveNode` and
   `idleAwaitExpired = false` props.
2. Create one coalescer per active execution attempt. Its send callback first
   confirms that the same attempt is still `idle`; attempt-key change, leaving
   idle, unmount, and submit dispose it. A late result cannot affect a new
   attempt.
3. On textarea focus and non-submit keydown while idle, call `touch()`. Preserve
   draft editing, Enter/newline, and current shortcut behavior. Clicking or
   pressing `Send now` invokes only the existing send path and cancels pending
   trailing keepalive work; it does not make a keepalive call of its own.
4. Render the new sentence in the existing disclosure slot directly after the
   Stop explanation, using the same mono 10.5px/disclosure classes and no new
   color or icon. Render only in `idle-after-interrupt`.
5. For a finished node with unmatched receipts, feed
   `neverSentDisclosure(idleAwaitExpired)` to the existing single
   `role="alert"` band. Preserve restored text/id/order and the 33vh cap.
6. If the expired node has no unmatched receipts or local draft, render no
   terminal dock shell. Existing node-failure UI remains responsible for the
   failure itself.

## Tests first

### Pure helpers and evidence

| ID   | Case                 | Required assertions                                                                                                                                                                                              |
| ---- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T4.1 | Exact copies         | All three strings match authority byte-for-byte; normal terminal copy is unchanged.                                                                                                                              |
| T4.2 | Immediate + trailing | First touch sends immediately; touches at +1/+29,999ms create one trailing call at +30,000ms; no early or duplicate call.                                                                                        |
| T4.3 | Continuous activity  | Across multiple windows, calls are bounded to one at each boundary and the last activity is represented within 30 seconds.                                                                                       |
| T4.4 | Dispose/reset        | Pending callback is cancelled and stale/in-flight completion cannot send or alter a replacement coalescer.                                                                                                       |
| T4.5 | Failure handling     | Rejection is handled; a later touch remains bounded and can drive the scheduled trailing call; no UI refusal state or request storm is produced.                                                                 |
| T4.6 | Submit shortcut      | Actual Cmd/Ctrl+Enter submit is excluded; plain, navigation, and composing activity is eligible.                                                                                                                 |
| T4.7 | Cause classification | Exact latest expiry is true; wrong node/error/status, unsettled row, and no row are false. Expiry epoch 0 followed by completed epoch 1 is false. Test timestamp and array tie-breaks, plus `grp.body` vs `grp`. |

### Both composer docks

Run the same matrix for Legacy and Console:

| ID    | Case                        | Required assertions                                                                                                                                                           |
| ----- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T4.8  | Idle disclosure             | Existing Stop text then exact 30-minute text, both readable in DOM; generating/queue-only/finished states omit the new line.                                                  |
| T4.9  | Activity burst              | Focus plus rapid typing produces one immediate keepalive; draft content and caret behavior remain correct.                                                                    |
| T4.10 | Send now exclusion          | Prepare a non-empty draft, snapshot keepalive count, click and keyboard-submit separately, and assert send uses `intent:'send_now'` while keepalive count does not increase.  |
| T4.11 | Non-idle                    | Focus/typing while generating or finished sends no keepalive.                                                                                                                 |
| T4.12 | Rejection                   | A failed keepalive is handled and later idle activity remains eligible for the bounded trailing call; no refusal banner/state, console error, or per-key retry storm appears. |
| T4.13 | Attempt cleanup             | Leaving idle or changing `nodeExecutionKey` prevents scheduled old-attempt work; first activity in a new idle attempt sends immediately.                                      |
| T4.14 | Cause-specific terminal box | One unmatched receipt plus expiry evidence yields one alert with exact cause copy; other terminal errors retain existing copy and original message identity/order.            |
| T4.15 | Empty terminal state        | Expiry evidence with no unmatched receipt/draft renders no empty dock or alert.                                                                                               |
| T4.16 | Prop chain                  | Parent evidence reaches the correct selected Legacy/Console dock, including a namespaced loop-group body.                                                                     |

## Visual acceptance criteria

Verify all states in both shells, using the design tokens and geometry already
present:

| State                   | Required visual result                                                                                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Idle, empty queue       | Two disclosure lines in order above the textarea; full text may wrap but is never clipped/ellipsized; `Send now` remains fully visible.                              |
| Idle, queued            | Existing `WILL SEND` band remains above disclosures, retains 33vh cap/scroll, and composer/control positions do not shift horizontally.                              |
| Expired, queued         | Read-only full-width `NEVER SENT` band with exact alert; no textarea, Stop, Queue, or Send now. Focus handoff lands on the last transcript row/scroller, never body. |
| Expired, no queue/draft | No empty dock shell; existing failed-node state remains visible.                                                                                                     |

Check the authoritative Legacy 460px panel and Console at a 1440×900 desktop
viewport/panel width. In each: no horizontal overflow, overlap, truncated copy,
or off-screen button; long copy wraps within its flexible cell; queue text keeps
its existing scroll cap. No countdown, progress bar, warning toast, extend
button, new color, or motion is allowed.

## Verification

```bash
bun test packages/web/src/lib/steering-dock.test.ts packages/web/src/lib/execution-room-model.test.ts
NODE_ENV=development bun test packages/web/src/components/workflows/
NODE_ENV=development bun test packages/web/src/experiments/console/components/
bun --filter @archon/web type-check
bun x eslint packages/web/src --max-warnings 0
```

## Risks and rollback

- Multiple tabs/operators may each send keepalives; that follows the existing
  shared steering grant. Per-dock coalescing bounds accidental bursts.
- Exact error matching is safe because it matches an Archon-owned typed cause,
  not arbitrary user or vendor prose. The E2E guards the duplicated string.
- Web changes are independently reversible after callers stop using the route;
  no stored UI state or migration needs rollback.
