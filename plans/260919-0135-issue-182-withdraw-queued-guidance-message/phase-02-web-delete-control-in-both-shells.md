---
phase: 2
title: 'Web delete control in both shells'
status: pending
priority: P1
effort: '1 session'
dependencies: [1]
---

# Phase 2: Web delete control in both shells

## Goal

Give every row in the `queued · n` band a keyboard-operable `delete` control in both the Legacy `ComposerDock` and the Console `ConsoleComposerDock`, backed by shared framework-free state transitions in `@/lib/steering-dock` and a `withdrawNodeGuidance` helper in each shell's request layer, with an accessible name that identifies the message and a deterministic focus rule after removal.

> Deep mode: scout before executing. Re-read `ComposerDock.tsx`, `ConsoleComposerDock.tsx`, `steering-dock.ts`, `lib/api.ts:740-780`, `console/skills/runs.ts:150-185`, and `console-isolation.test.ts` at cook time — Phase 1 does not touch them, but the outline below is written against the tree at `81ba296f`.

## Context links

- Story AC 1 and 4 (`epics.md:452-467`); `EXPERIENCE.md:135, 260-267` and `DESIGN.md:647-655` for the draft-item control anatomy (text button, 24×24 floor grown on padding, list semantics, name starts with the visible word, focus never on `<body>`).
- `packages/web/src/lib/steering-dock.ts` (state transitions, `steeringDockMode`, `toSteeringSendError`).
- `packages/web/src/components/workflows/ComposerDock.tsx` and `.test.tsx` (`renderDock`, `flush`, `queueButton`, `okReceipt` helpers).
- `packages/web/src/experiments/console/components/ConsoleComposerDock.tsx` and `.test.tsx`.
- `packages/web/src/lib/api.ts` (`sendNodeGuidance`, `fetchJSON`) and `packages/web/src/experiments/console/skills/runs.ts` (`sendNodeGuidance`, `requestJson`).
- `packages/web/src/experiments/console/console-isolation.test.ts` (`@/lib/steering-dock` is the approved shared seam; Console must not import `@/components/`).

## File inventory

| File | Action | Size | Test impact |
| --- | --- | --- | --- |
| `packages/web/src/lib/steering-dock.ts` | modify | +~60 lines: `withdrawing` in state, `beginWithdraw`, `resolveWithdrawSuccess`, `resolveWithdrawFailure`, `deleteButtonAccessibleName`, `nextFocusAfterRemoval` | `steering-dock.test.ts` +2 describes |
| `packages/web/src/lib/steering-dock.test.ts` | modify | +~90 lines | pure-function coverage |
| `packages/web/src/lib/api.ts` | modify | +~20 lines: `withdrawNodeGuidance`, `WithdrawWorkflowNodeResponse` re-export | covered by component tests via injection |
| `packages/web/src/experiments/console/skills/runs.ts` | modify | +~20 lines: `withdrawNodeGuidance`, type re-export | same |
| `packages/web/src/components/workflows/ComposerDock.tsx` | modify | +~50 lines: `withdraw` prop, row control, refs, focus effect | `ComposerDock.test.tsx` +~8 tests |
| `packages/web/src/components/workflows/ComposerDock.test.tsx` | modify | +~180 lines | |
| `packages/web/src/experiments/console/components/ConsoleComposerDock.tsx` | modify | mirror of the Legacy change with console classes | `ConsoleComposerDock.test.tsx` +~8 tests |
| `packages/web/src/experiments/console/components/ConsoleComposerDock.test.tsx` | modify | +~180 lines | |

Not touched: `NodeTranscriptPane.tsx`, `ConsoleNodeRoom.tsx` (they already mount the docks and pass the props; the new `withdraw` prop defaults to the shell's helper), `console-isolation.test.ts` (no new cross-shell import is introduced).

## Tests before

### `steering-dock.test.ts`

`describe('withdraw state transitions')`:

1. `createSteeringDockState` includes `withdrawing: []`.
2. `beginWithdraw` adds the id to `withdrawing` and leaves `sent`, `inFlight`, `pendingRetry`, `refusal` unchanged.
3. `beginWithdraw` is a no-op for an id already withdrawing.
4. `resolveWithdrawSuccess` removes the row from `sent` by id, removes the id from `withdrawing`, clears `refusal`, and preserves the order of the remaining rows.
5. `resolveWithdrawSuccess` for an id not in `sent` (row already gone) only clears `withdrawing`/`refusal`.
6. `resolveWithdrawFailure` keeps the row, removes the id from `withdrawing`, and stores the refusal.
7. `resolveGuidanceSuccess` (send) is unchanged by the new field — a queued receipt appends while another id is withdrawing.

`describe('withdraw wording and focus')`:

8. `deleteButtonAccessibleName('fix the tests')` → `'delete · fix the tests'` — starts with the visible word.
9. `nextFocusAfterRemoval(ids, removedId)` returns `{ kind: 'delete', messageId }` for the next id, else the previous id, else `{ kind: 'field' }`: cases `[A,B,C]` remove B → C; remove C → B; `[A]` remove A → field; id not present → field.

### `ComposerDock.test.tsx` (and mirrored in `ConsoleComposerDock.test.tsx`)

Add a `nextWithdraw` injectable beside `nextSend` and a `deleteButtons()` helper (`host.querySelectorAll('li button')`). After the two-sends setup:

10. each row renders a button with visible text `delete` and `aria-label` `delete · <message>`; list items still expose the message and `sent`.
11. activating the first row's delete calls `withdraw('run-1', 'grp.body', <firstId>)` exactly once; while pending the button is `aria-disabled="true"` (not `disabled`) and a second activation does nothing.
12. on resolve, the row is gone, `queued · 1` and the status region read `1 message queued`, and focus is on the remaining row's delete button.
13. deleting the last remaining row hides the band and moves focus to the textarea.
14. deleting the last row of three moves focus to the previous row's delete button.
15. a rejected withdraw (`SteeringSendError(409, 'node_finished', …)`) keeps the row, shows the message in the `role="alert"` paragraph, and keeps focus off `document.body`.
16. a 422 `not_steerable_here` withdraw refusal replaces the dock with the exact detached disclosure (existing `steeringDockMode` path).
17. deleting a row while a send is in flight still works, and the send's 200 still appends its row (per-row guard, decision 10).
18. keyboard: `Enter`/`Space` on a focused delete button activates it (native `<button>` — assert via `click()` dispatched from a keydown-driven test or by asserting `type="button"` and no `onKeyDown` interception).
19. the existing `generating/empty` test still holds: no `delete` text when the band is absent.

## Refactor

### `steering-dock.ts`

- Extend `SteeringDockState` with `readonly withdrawing: readonly string[]`; update `createSteeringDockState`, `resolveGuidanceSuccess`, and `resolveGuidanceFailure` to carry it through unchanged.
- Add:

```ts
export function beginWithdraw(state: SteeringDockState, messageId: string): SteeringDockState
export function resolveWithdrawSuccess(state: SteeringDockState, messageId: string): SteeringDockState
export function resolveWithdrawFailure(state: SteeringDockState, messageId: string, refusal: SteeringRefusal): SteeringDockState
export const STEERING_DELETE_LABEL = 'delete';
export function deleteButtonAccessibleName(message: string): string  // `${STEERING_DELETE_LABEL} · ${message}`
export type RemovalFocusTarget = { kind: 'delete'; messageId: string } | { kind: 'field' };
export function nextFocusAfterRemoval(orderedIds: readonly string[], removedId: string): RemovalFocusTarget
```

- Update the module docblock: the dock now issues one DELETE per withdraw; the response is still the only queue evidence.

### `lib/api.ts` and `console/skills/runs.ts`

```ts
export type WithdrawWorkflowNodeResponse = components['schemas']['WithdrawWorkflowNodeResponse'];
export async function withdrawNodeGuidance(runId: string, nodeId: string, messageId: string): Promise<WithdrawWorkflowNodeResponse>
```

DELETE to `/api/workflows/runs/${enc(runId)}/nodes/${enc(nodeId)}/queue/${enc(messageId)}` with no body; wrap failures with `toSteeringSendError` exactly as `sendNodeGuidance` does. Mirror the doc comment.

### Both dock components

- New prop `withdraw?: WithdrawNodeGuidance` (`(runId, nodeId, messageId) => Promise<WithdrawWorkflowNodeResponse>`), defaulting to the shell's `withdrawNodeGuidance`. Export the `WithdrawNodeGuidance` type beside `SendNodeGuidance`.
- Keep a `Map<string, HTMLButtonElement>` ref of delete buttons keyed by `messageId`, and a `pendingFocusRef: RemovalFocusTarget | null`.
- Per row: after the `sent` word, a `<button type="button">` with visible `delete`, `aria-label={deleteButtonAccessibleName(receipt.message)}`, `aria-disabled` while `dock.withdrawing.includes(id)`, `min-h-[24px] min-w-[24px]` padding-grown target, mono 11px text-secondary, the shell's focus ring classes (Legacy `-outline-offset-2`, Console `outline-offset-2` with `outline-accent-bright!`), `hover:bg-surface-inset`.
- `onDelete(id)`: guard on `withdrawing`; compute `pendingFocusRef.current = nextFocusAfterRemoval(dock.sent.map(r => r.messageId), id)`; `setDock(beginWithdraw)`; call `withdraw(runId, nodeId, id)`; on success `setDock(resolveWithdrawSuccess)`; on failure clear `pendingFocusRef`, `setDock(resolveWithdrawFailure(…, toSteeringRefusal(error)))`.
- A `useEffect` on `dock.sent` consumes `pendingFocusRef`: focus the mapped button if it still exists, else the textarea; then clear the ref. Never leave focus on `document.body`.
- Do not change the band header, list label, textarea, Queue button, or blocked/detached branches.

## Tests after

All 19 cases pass in both shells; the pre-existing ComposerDock, ConsoleComposerDock, NodeTranscriptPane, ConsoleNodeRoom, and console-isolation suites pass unchanged.

## Test scenario matrix

| Priority | Scenario | Suite |
| --- | --- | --- |
| Critical | delete calls withdraw once with the right id; success removes only that row | component 11–12 |
| Critical | focus after removal: next → previous → field; never body | pure 9, component 12–15 |
| Critical | accessible name identifies the message and starts with `delete` | pure 8, component 10 |
| High | failure keeps the row and shows the refusal; 422 flips to detached | component 15–16 |
| High | per-row in-flight guard does not block send or another delete | pure 2–3, component 11, 17 |
| Medium | Console isolation unchanged; band absent ⇒ no delete text | isolation suite, component 19 |

## Regression gate

```bash
(cd packages/web && bun test src/lib/steering-dock.test.ts)
(cd packages/web && NODE_ENV=development bun test src/components/workflows/ComposerDock.test.tsx src/components/workflows/NodeTranscriptPane.test.tsx)
(cd packages/web && NODE_ENV=development bun test src/experiments/console/components/ConsoleComposerDock.test.tsx src/experiments/console/components/ConsoleNodeRoom.test.tsx src/experiments/console/console-isolation.test.ts)
bun run type-check
bun run lint
```

## Todo

- [ ] Scout pass: re-read the two docks, `steering-dock.ts`, both API helpers, `console-isolation.test.ts`.
- [ ] Pure tests 1–9 (red) → implement `steering-dock.ts` additions (green).
- [ ] Add `withdrawNodeGuidance` to both request layers.
- [ ] Legacy component tests 10–19 (red) → implement `ComposerDock.tsx` (green).
- [ ] Console component tests 10–19 (red) → implement `ConsoleComposerDock.tsx` (green).
- [ ] Regression gate green.

## Success criteria

- Every queued row in both shells has a `delete` control with a message-specific accessible name; activation issues exactly one DELETE for that id.
- Focus after removal follows the stated rule; the control is never natively `disabled`.
- Refusals surface through the existing refusal/detached paths without new copy beyond the server message.
- `@archon/web` imports nothing from `@archon/workflows`; Console imports nothing from `@/components/`.

## Risk assessment

- **Focus effect fires before the DOM updates** — key the effect on `dock.sent` and read the button map inside it; the map's cleanup on unmount (ref callback with `null`) must delete the key.
- **Row text with the full message makes very long accessible names** — accepted: the AC requires the name to identify the specific message, and the band already elides visually.
- **Console class parity** — copy the focus-ring classes from the Console Queue button, not from Legacy.

## Security considerations

- No message content is logged client-side; `message_id` is the only value sent.
- The helper never retries automatically.

## Next steps

Phase 3 uses the delete control and the route for E2E proof.
