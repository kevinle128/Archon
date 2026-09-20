---
phase: 4
title: 'Phase 4: Dock disclosure, keepalive wiring, fail copy'
status: pending
priority: P1
effort: '5h'
dependencies: [2, 3]
---

# Phase 4: Dock disclosure, keepalive wiring, fail copy

## Goal

On both docks: disclose the 30-minute limit in accessible text while
`idle-after-interrupt`; send a throttled keepalive on keystroke or focus in
that state (never on `Send now`); and, when the node's terminal evidence is the
30-minute failure, announce Story 2.11's `NEVER SENT` box with the
cause-naming copy — all framework-free logic in `steering-dock.ts`, mirrored
edits in the two docks, and the evidence threaded through the same components
that already carry `nodeTerminal`.

## Context links

- `packages/web/src/lib/steering-dock.ts`: constants block (~96–108),
  `steeringAgentMode`, `isQueueShortcut`, `STEERING_NEVER_SENT_DISCLOSURE`.
- `packages/web/src/components/workflows/ComposerDock.tsx` and
  `packages/web/src/experiments/console/components/ConsoleComposerDock.tsx`:
  props (`send`/`interrupt`/`withdraw`/`readQueue` are injectable), idle
  disclosure `<p>` (~823 / ~829), textarea `onChange`/`onKeyDown` (~836 /
  ~842), `submit()` (~518 / ~524), finished alert (~662 / ~668).
- `packages/web/src/lib/execution-room-model.ts`: `hasTerminalNodeEvidence`
  (~453) and its callers `LegacyGraphLogsPane.tsx:284`,
  `ConsoleInspectPane.tsx:251`; prop chain `LegacyGraphLogsPane →
  LegacyNodeRoom → NodeTranscriptPane → ComposerDock` and `ConsoleInspectPane →
  ConsoleNodeRoom → ConsoleComposerDock`.
- `EXPERIENCE.md` line 178 (idle disclosure copy) and line 256 (fail
  announcement copy); `DESIGN.md` dock tokens (no new colour, mono 10.5px
  disclosure line).
- Tests: `steering-dock.test.ts`, `ComposerDock.test.tsx`,
  `ConsoleComposerDock.test.tsx`, `NodeTranscriptPane.test.tsx`,
  `ConsoleNodeRoom.test.tsx`, `execution-room-model.test.ts`.

## File inventory

| File                                                                           | Action | Size  | Test impact                                     |
| ------------------------------------------------------------------------------ | ------ | ----- | ----------------------------------------------- |
| `packages/web/src/lib/steering-dock.ts`                                        | Modify | ~+45  | New constants + two pure helpers                |
| `packages/web/src/lib/steering-dock.test.ts`                                   | Modify | ~+80  | T4.1–T4.6                                       |
| `packages/web/src/lib/execution-room-model.ts`                                 | Modify | ~+20  | `hasIdleAwaitExpiredEvidence`                   |
| `packages/web/src/lib/execution-room-model.test.ts`                            | Modify | ~+40  | T4.7                                            |
| `packages/web/src/components/workflows/ComposerDock.tsx`                       | Modify | ~+40  | Disclosure, keepalive, fail copy, new props     |
| `packages/web/src/experiments/console/components/ConsoleComposerDock.tsx`      | Modify | ~+40  | Mirror of the above                             |
| `packages/web/src/components/workflows/ComposerDock.test.tsx`                  | Modify | ~+120 | T4.8–T4.14                                      |
| `packages/web/src/experiments/console/components/ConsoleComposerDock.test.tsx` | Modify | ~+120 | T4.8–T4.14 (Console)                            |
| `NodeTranscriptPane.tsx`, `LegacyNodeRoom.tsx`, `LegacyGraphLogsPane.tsx`      | Modify | ~+5 ea | Thread `idleAwaitExpired`                      |
| `ConsoleNodeRoom.tsx`, `ConsoleInspectPane.tsx`                                | Modify | ~+5 ea | Thread `idleAwaitExpired`                      |
| `NodeTranscriptPane.test.tsx`, `ConsoleNodeRoom.test.tsx`                      | Modify | ~+30 ea | T4.15 pass-through                            |

## Tests before

Pure core (`steering-dock.test.ts`):

| ID   | Test                                                  | Required assertion                                                                                                                                                       |
| ---- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T4.1 | idle disclosure copy is exact                         | `STEERING_IDLE_AWAIT_DISCLOSURE === 'no redirect ends this node after 30 min of inactivity · typing keeps it open'`.                                                     |
| T4.2 | fail disclosure copy is exact and distinct            | `STEERING_NEVER_SENT_IDLE_EXPIRED_DISCLOSURE === 'node failed · interrupted with no redirect · none of this was sent'`; `neverSentDisclosure(false)` returns the 2.11 copy; `neverSentDisclosure(true)` returns the new copy. |
| T4.3 | engine error constant mirrors the executor            | `IDLE_AWAIT_EXPIRED_ERROR === 'interrupted by operator, no redirect received'` (comment: mirrors `@archon/workflows` dag-executor; change both). This unit test cannot detect drift on its own — Phase 5 E5/E6 are the cross-package guard. |
| T4.4 | keepalive throttle is leading-edge                    | `createKeepaliveThrottle(now, 30_000)`: first `shouldSend()` true; at +29_999 false; at +30_000 true; window is 30 s by default (`STEERING_KEEPALIVE_THROTTLE_MS`).       |
| T4.5 | throttle reset                                        | `reset()` makes the next call true immediately (used on attempt-generation reset and on entering idle).                                                                  |
| T4.6 | shortcut exclusion helper                             | `isKeepaliveKeystroke(event)` is false for the Cmd/Ctrl+Enter queue shortcut (reuses `isQueueShortcut`) and for IME composing events; true for a plain character key.  |

Room model (`execution-room-model.test.ts`):

| ID   | Test                                            | Required assertion                                                                                                                                                                                 |
| ---- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T4.7 | idle-await-expired evidence is strict           | True only when `hasTerminalNodeEvidence` is true AND the latest execution for the node has `status:'failed'` and `error === IDLE_AWAIT_EXPIRED_ERROR`; false for other errors, other nodes, running rows, or no rows. "Latest" = highest `retry_epoch` (missing → 0), then latest `started_at` (ISO string compare), then last array position. Include a retry-then-success case: rows `[failed(expired, epoch 0), completed(epoch 1)]` → false. |

Docks (`ComposerDock.test.tsx` and `ConsoleComposerDock.test.tsx`, identical
matrix; inject `keepalive` as a mock prop like `interrupt`):

| ID    | Test                                                   | Required assertion                                                                                                                                         |
| ----- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T4.8  | idle renders both disclosure lines                     | With `subState:'idle-after-interrupt'`, the interrupt disclosure and the idle-await disclosure are both visible `<p>` text in the well, in that order.       |
| T4.9  | non-idle renders neither new line                      | `generating` and queue-only show no 30-minute text.                                                                                                        |
| T4.10 | keystroke while idle sends one keepalive               | Type three characters quickly → `keepalive` called once with `(runId, nodeId)`; draft updated normally.                                                     |
| T4.11 | focus while idle sends a keepalive                     | Focus the textarea → one call; a second focus within the window → no additional call.                                                                       |
| T4.12 | Send now never sends a keepalive                       | With a draft, press Cmd+Enter (and separately click `Send now`) → `send` called with `intent:'send_now'` and `keepalive` not called; queue-mode Cmd+Enter likewise. |
| T4.13 | keystrokes while generating send nothing               | `subState:'generating'`, type → `keepalive` not called.                                                                                                     |
| T4.14 | keepalive failure is silent and inert                  | `keepalive` rejects with a 422 `SteeringRequestError` → no refusal text, no state change, no unhandled rejection (assert with a spy on `console.error` unused). |
| T4.15 | fail copy on the never-sent box                        | `nodeTerminal:true`, `idleAwaitExpired:true`, one unmatched receipt → exactly one `role="alert"` whose text is the new fail copy; with `idleAwaitExpired:false` the 2.11 copy. |
| T4.16 | attempt reset clears the throttle                      | After a `nodeExecutionKey` change, the first idle keystroke sends again even inside the previous window.                                                    |

Panes / rooms (`NodeTranscriptPane.test.tsx`, `ConsoleNodeRoom.test.tsx`):

| ID    | Test                                          | Required assertion                                                           |
| ----- | --------------------------------------------- | ---------------------------------------------------------------------------- |
| T4.17 | `idleAwaitExpired` passes through to the dock | Rendering with the prop true reaches the dock (the fail copy appears with a never-sent fixture). |

## Refactor (protected changes)

1. `steering-dock.ts`: add `STEERING_IDLE_AWAIT_DISCLOSURE`,
   `STEERING_NEVER_SENT_IDLE_EXPIRED_DISCLOSURE`, `IDLE_AWAIT_EXPIRED_ERROR`,
   `STEERING_KEEPALIVE_THROTTLE_MS = 30_000`, `neverSentDisclosure(idleAwaitExpired: boolean)`,
   `createKeepaliveThrottle(now: () => number = Date.now, windowMs = STEERING_KEEPALIVE_THROTTLE_MS): { shouldSend(): boolean; reset(): void }`,
   and `isKeepaliveKeystroke(event: SteeringShortcutEvent): boolean`.
2. `execution-room-model.ts`: add `hasIdleAwaitExpiredEvidence(executions,
   nodeId)` next to `hasTerminalNodeEvidence`. No single-row "latest" selector
   exists for `NodeExecution[]` today (the module's helpers are aggregate
   `some`/`every`), so define the ordering explicitly: highest `retry_epoch`
   (undefined → 0), then latest `started_at`, then last array position. This
   keeps a retried-and-completed node from resurfacing the stale expiry copy.
   Evaluate it against the **selected node id** the dock is mounted on — for a
   loop-group body that is the namespaced body row (`grp.body`), whose error
   is the exact engine string; the outer group row carries a composite wrapper
   and is never the dock's node.
   <!-- Updated: Red Team 2026-09-20 — Assumption Destroyer F3, Failure Mode F2 -->
3. Both parents (`LegacyGraphLogsPane.tsx`, `ConsoleInspectPane.tsx`): compute
   `idleAwaitExpired` beside `nodeTerminal` and pass it down; thread the
   optional boolean prop (default `false`) through `LegacyNodeRoom`,
   `NodeTranscriptPane`, `ConsoleNodeRoom` to each dock.
4. Both docks (mirror exactly):
   - New optional props `keepalive = keepaliveNode` and `idleAwaitExpired = false`.
   - A `keepaliveThrottleRef = useRef(createKeepaliveThrottle())`; call
     `reset()` inside the existing attempt-generation reset effect and when
     `agentMode` transitions into `idle`.
   - `const touchKeepalive = (): void => { if (agentMode !== 'idle') return;
     if (!keepaliveThrottleRef.current.shouldSend()) return; void
     keepalive(runId, nodeId).catch(() => undefined); }` with the comment:
     intentional silent fallback — keepalive is a best-effort hint; the queue
     poll and run detail are the authority on whether the node is still idle.
   - Textarea: `onFocus={touchKeepalive}`; in `onKeyDown`, when the event is
     the queue shortcut keep the existing `submit()` path and do NOT call
     `touchKeepalive`; otherwise `if (isKeepaliveKeystroke(...)) touchKeepalive()`.
   - Render `<p>{STEERING_IDLE_AWAIT_DISCLOSURE}</p>` with the same classes as
     the interrupt disclosure, directly below it, only when `idle`.
   - Finished alert: `{neverSentDisclosure(idleAwaitExpired)}`.
5. Do not add a countdown, warning, or extend control; do not persist
   anything; do not change the 2.11 reconciliation trigger.

## Tests after

T4.1–T4.17 pass on both surfaces; every existing dock, pane, and room test
passes unchanged (the new `<p>` must not break existing text-order
assertions — if one asserts the interrupt disclosure is the only `<p>`, update
it to assert order instead).

## Regression gate

```bash
bun test packages/web/src/lib/
NODE_ENV=development bun test packages/web/src/components/
NODE_ENV=development bun test packages/web/src/experiments/console/
bun --filter @archon/web type-check
bun x eslint packages/web/src --max-warnings 0
```

## Test scenario matrix

| Path     | Scenario                                        | Tests                  |
| -------- | ----------------------------------------------- | ---------------------- |
| Critical | disclosure present only when idle, exact copy   | T4.1, T4.8, T4.9       |
| Critical | keepalive on keystroke/focus, never on Send now | T4.10–T4.13            |
| High     | cause-naming never-sent announcement            | T4.2, T4.7, T4.15, T4.17 |
| Medium   | throttle semantics and reset                    | T4.4, T4.5, T4.16      |
| Medium   | silent keepalive failure                        | T4.14                  |
| Low      | error constant parity                           | T4.3                   |

## Dependency map

- Requires Phase 3 (`keepaliveNode`, generated type) and Phase 2 (constant).
- Feeds Phase 5 (E2E asserts the same strings and request interception).

## Risk assessment

- Double keepalive from `onFocus` + first keystroke — the throttle collapses
  them (T4.11 + T4.10 sequence).
- A held key generates auto-repeat keydown events — throttle bounds it.
- Threading a boolean through five components is mechanical but easy to drop
  on one surface — T4.17 exists on both surfaces.

## Security considerations

Keepalive sends no content. No new storage.

## Rollback

Revert the web files; no generated or server artifact changes in this phase.
