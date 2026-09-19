---
phase: 4
title: 'Web: Stop / Send now dock in both shells'
status: pending
priority: P1
effort: '1.5d'
dependencies: [3]
---

# Phase 4: Web — Stop / Send now dock in both shells

## Goal

The Legacy `ComposerDock` and Console `ConsoleComposerDock` render the Story 2.3 states from the projected sub-state plus a UI-local `interrupting` transient: `Stop` + `Queue` while generating; `Stopping…` (`aria-disabled`, focusable, suppressed handler) while the interrupt is in flight; `Send now`, `WILL SEND · n`, no `Stop`, and the stop disclosure while idle-after-interrupt; back to generating after `Send now`. Announcements are serialized per transition through the panel's polite `role="status"` region, delivery failure uses an assertive `role="alert"`, and focus never lands on `<body>`.

Deep mode: outline; scout pass `reports/scout-260919-0830-server-web-dock.md` §3–5 precedes execution.

## Context links

- `control-states.md` (state table, "What the stop control must not imply"), `EXPERIENCE.md:247` (coalesced announcements: `agent interrupting` → `agent idle · Send now delivers`; race copy `turn ended before stop · 2 sent · agent generating`), `:264-266` (`aria-disabled`, focus to the send control at stopping→stopped, focus ring tokens), `:390-400` (Flow 4), `DESIGN.md:630-650` (dock anatomy; stop disclosure copy `stopped after the last completed tool call · files already written stay written`).
- Story AC 8: "focus moves to the last transcript row instead of the document body" when the dock changes or is removed. Reconciled rule (validation question V3): stop-control unmount → send control (EXPERIENCE.md); dock removal → last transcript row (story); `<body>` never.
- Code: `packages/web/src/lib/steering-dock.ts` (`steeringDockMode`, `canSubmitGuidance`, `SteeringDockState`, `toSteeringRefusal`), `ComposerDock.tsx:1-80` (props), `ConsoleComposerDock.tsx`, `NodeTranscriptPane.tsx:523-531` (mount), `ConsoleNodeRoom.tsx`, `packages/web/src/lib/api.ts` (`sendNodeGuidance`), `experiments/console/skills/runs.ts`, `console-isolation.test.ts` positive list.

## Files

| File                                                                          | Action | Change                                                                                                    |
| ----------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------- |
| `packages/web/src/lib/steering-dock.ts`                                       | Modify | `SteeringAgentState = 'generating' \| 'interrupting' \| 'idle-after-interrupt'`; `steeringDockMode` takes `subState`; `sendControlLabel`, `queueBandHeader(count, state)` (`queued` / `will send`), `stopDisclosureText`, `announcementFor(transition)`, `beginInterrupt`/`resolveInterrupt` reducers, `SEND_NOW` intent plumbing |
| `packages/web/src/lib/steering-dock.test.ts`                                  | Modify | Reducer/predicate tests                                                                                   |
| `packages/web/src/lib/api.ts`                                                 | Modify | `interruptNode(runId, nodeId)` → typed response; `sendNodeGuidance` body accepts `intent:'send_now'`     |
| `packages/web/src/experiments/console/skills/runs.ts`                         | Modify | Console equivalent through its request layer                                                              |
| `packages/web/src/components/workflows/ComposerDock.tsx` (+ test)             | Modify | Stop control, `Stopping…`, `Send now`, header, disclosure, alert, focus                                   |
| `packages/web/src/experiments/console/components/ConsoleComposerDock.tsx` (+ test) | Modify | Same anatomy with Console tokens (JSX written twice, thin)                                          |
| `packages/web/src/components/workflows/NodeTranscriptPane.tsx` (+ test)       | Modify | Pass `steeringSubState` from the node state; expose the last-row focus target; shared status region     |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx` (+ test) | Modify | Same                                                                                                     |
| `packages/web/src/experiments/console/console-isolation.test.ts`              | Modify | Only if a new Console file is introduced (prefer none)                                                    |

## Refactor (protected change) — behavior

1. **Derived agent state.** `subState` from `WorkflowNodeState.steeringSubState` (Phase 3). Pressing `Stop` sets the UI-local `interrupting`; the interrupt response resolves it: `idle-after-interrupt` → idle; `generating` → generating (announce the race copy with the sent count); 409 `node_finished` → clear the transient, let the row status drive the finished treatment; 422 `not_interruptible` → refusal line (the queue still works). A refresh that reports `idle-after-interrupt` also lands the state. Reload/other-tab reach is shell-specific (scout §3, verified): Legacy re-polls `GET /api/workflows/runs/:id` every 3 s while live (React Query `refetchInterval`), so `steeringSubState` arrives within 3 s; Console is SSE-driven and no SSE event fires for steering state today, so a reloaded Console tab converges only via its 30 s heartbeat refetch or the `interrupted` status row when its transcript refreshes. This story guarantees the pressing tab; cross-tab convergence is Story 2.9 (validation question V7 asks whether to emit a `dag_node` SSE push now).
2. **Controls.** Generating: `Stop` (left) + `Queue` (right). Interrupting: `Stopping…` with `aria-disabled="true"`, `tabIndex` kept, handler suppressed, colour `--text-secondary`. Idle: `Stop` absent; send reads `Send now`; header `WILL SEND · n`; disclosure line between band and field. `Send now` posts `intent:'send_now'` with the draft (empty draft allowed only when `n > 0` — validation question V4) and optimistically returns to generating on 200.
3. **Announcements.** One coalesced write per transition into the existing polite `role="status"` region (no new live regions): `agent interrupting`, `agent idle · Send now delivers`, `turn ended before stop · <n> sent · agent generating`, `agent generating`. Delivery failure keeps its own `role="alert"` element with `couldn't send · back in the queue`.
4. **Focus.** When `Stop` unmounts (stopping → idle) move focus to the send control; when the whole dock unmounts move focus to the last transcript row (the existing scroll container's last row element gets `tabIndex={-1}`); assert `document.activeElement !== document.body` in both cases.
5. **Failure integrity.** A failed `Send now` returns items to the front of the local band (existing `resolveGuidanceFailure` pattern) and leaves the agent state idle.

## Tests before

- Story 2.1 dock tests (`ComposerDock.test.tsx`, `ConsoleComposerDock.test.tsx`, `steering-dock.test.ts`) green; generating-state DOM unchanged except the added `Stop` control.
- `console-isolation.test.ts` green.

## Tests after

| #   | Scenario (both shells unless noted)                                                        |
| --- | ------------------------------------------------------------------------------------------ |
| 1   | generating renders `Stop` + `Queue`; header `queued · n`                                   |
| 2   | press `Stop` → `Stopping…` has `aria-disabled="true"`, no `disabled` attr, stays focused    |
| 3   | interrupt resolves idle → `Stop` gone, `Send now`, `WILL SEND · n`, disclosure text present, focus on send control |
| 4   | interrupt resolves `generating` → race announcement with count; controls stay generating   |
| 5   | interrupt 409 → transient cleared; 422 `not_interruptible` → refusal line                  |
| 6   | `Send now` posts `intent:'send_now'`; on 200 dock returns to generating and announces      |
| 7   | delivery failure → `role="alert"` text, items back at the front, state stays idle          |
| 8   | announcements per transition are single writes (spy on the status region: one text change per transition) |
| 9   | dock unmount moves focus to the last transcript row, never `<body>`                        |
| 10  | mount with `steeringSubState:'idle-after-interrupt'` from the run payload → idle treatment without pressing Stop (Legacy 3 s poll; Console heartbeat) |
| 11  | `steering-dock.ts` reducers: interrupt begin/resolve, label/header/announcement helpers    |

## Regression gate

```bash
(cd packages/web && bun test src/lib/steering-dock.test.ts)
(cd packages/web && NODE_ENV=development bun test src/components/workflows/ComposerDock.test.tsx src/components/workflows/NodeTranscriptPane.test.tsx)
(cd packages/web && NODE_ENV=development bun test src/experiments/console/components/ConsoleComposerDock.test.tsx src/experiments/console/components/ConsoleNodeRoom.test.tsx src/experiments/console/console-isolation.test.ts)
bun run lint && bun run type-check
```

## Todo

- [ ] Scout pass: live-region element, last-row element, poll cadence, Console request layer
- [ ] Shared logic + tests
- [ ] API helpers (both layers)
- [ ] Legacy dock + pane wiring + tests
- [ ] Console dock + room wiring + tests
- [ ] Visual check at 460px (Legacy) and Console width, reduced motion, focus ring contrast (tokens only, no literals)

## Success criteria

Tests After 1–11 green in both shells; brand tokens only; no Console import from `@/components/`; `@archon/web` imports nothing from `@archon/workflows`.

## Risk assessment

- Two docks written twice: keep all logic in `steering-dock.ts` so parity is testable.
- Reload/other-tab convergence is Story 2.9; this story only guarantees the pressing tab plus whatever the run poll already carries.

## Next steps

Phase 5 drives these states end to end.
