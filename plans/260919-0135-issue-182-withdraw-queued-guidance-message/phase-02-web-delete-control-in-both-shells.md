---
phase: 2
title: 'Delete control in both web shells'
status: pending
priority: P1
effort: '1 session'
dependencies: [1]
---

# Phase 2: Delete control in both web shells

## Goal

Add the same accessible, response-driven per-row delete interaction to Legacy
`ComposerDock` and Console `ConsoleComposerDock`. Keep the two renderers thin,
put state/focus wording in `@/lib/steering-dock`, and use each shell's existing
request layer with the generated Phase 1 response type.

## Source anchors and design authority

- Shared behavior: `packages/web/src/lib/steering-dock.ts` and its tests.
- Legacy renderer/request layer:
  `components/workflows/ComposerDock.tsx` and `lib/api.ts`.
- Console renderer/request layer:
  `experiments/console/components/ConsoleComposerDock.tsx` and
  `experiments/console/skills/runs.ts`.
- Isolation contract:
  `experiments/console/console-isolation.test.ts`.
- Governing UI spines:
  `EXPERIENCE.md` draft item/accessibility/responsive sections and
  `DESIGN.md` `draft-item` tokens.
- Visual artifact:
  `mockups/key-steering-dock.html`. It predates the per-item control markup and
  remains illustrative; `reconcile-live-steering.md` states the spines win.

The current full-bleed queue band is the implementation baseline. Do not copy
the mockup's older inset draft-well structure. The new action is added at each
existing row's right edge, preserving current header, list, scroll cap, field,
and control-row anatomy.

## Files

| File                                                                           | Change                                                                                                          |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `packages/web/src/lib/steering-dock.ts`                                        | Add one-withdraw-at-a-time state transitions, accessible-name text, and deterministic focus-target calculation. |
| `packages/web/src/lib/steering-dock.test.ts`                                   | Test transition invariants, stale/mismatched completions, wording, and focus rules.                             |
| `packages/web/src/lib/api.ts`                                                  | Export generated response type and add bodyless `withdrawNodeGuidance`.                                         |
| `packages/web/src/experiments/console/skills/runs.ts`                          | Add the Console-owned equivalent through `requestJson`.                                                         |
| `packages/web/src/components/workflows/ComposerDock.tsx`                       | Add injectable withdraw prop, row buttons, guarded request, and focus restoration.                              |
| `packages/web/src/components/workflows/ComposerDock.test.tsx`                  | Cover exact request, state/failure/blocked behavior, focus, classes, and interaction with send.                 |
| `packages/web/src/experiments/console/components/ConsoleComposerDock.tsx`      | Mirror semantics with Console-owned imports/classes.                                                            |
| `packages/web/src/experiments/console/components/ConsoleComposerDock.test.tsx` | Mirror the behavioral tests and assert Console focus classes.                                                   |

`NodeTranscriptPane.tsx` and `ConsoleNodeRoom.tsx` need no production change:
the new prop is optional and defaults inside each dock, just as `send` does.
Run their tests because they own mounting and blocked/live inputs.

## Shared state contract

Extend `SteeringDockState` with:

```ts
readonly withdrawingMessageId: string | null;
```

Update every existing constructor/transition so this field is never dropped.
`resolveGuidanceSuccess` currently returns an explicit object and therefore
must be changed deliberately; `resolveGuidanceFailure` already spreads state.

Add:

```ts
export function beginWithdraw(state: SteeringDockState, messageId: string): SteeringDockState;

export function resolveWithdrawSuccess(
  state: SteeringDockState,
  messageId: string
): SteeringDockState;

export function resolveWithdrawFailure(
  state: SteeringDockState,
  messageId: string,
  refusal: SteeringRefusal
): SteeringDockState;

export const STEERING_DELETE_LABEL = 'delete';
export function deleteButtonAccessibleName(message: string): string;

export type RemovalFocusTarget =
  | { readonly kind: 'delete'; readonly messageId: string }
  | { readonly kind: 'field' };

export function nextFocusAfterRemoval(
  orderedIds: readonly string[],
  removedId: string
): RemovalFocusTarget;
```

Transition invariants:

- `createSteeringDockState()` starts with
  `withdrawingMessageId: null`.
- `beginWithdraw` sets the id only when it exists in `sent` and no other
  withdraw is active. Otherwise it returns the same state. It does not alter
  `sent`, `inFlight`, `pendingRetry`, or `refusal`.
- Success/failure act only when their id matches the active id. A stale or
  mismatched completion is a no-op.
- Success removes exactly that receipt, preserves sibling order and send state,
  clears the withdraw id and refusal.
- Failure retains all rows and send state, clears the withdraw id, and stores
  the refusal.
- A send success while withdrawal is active can append its row without losing
  the active id.
- The accessible name is
  `delete · ${message.trim()}`; visible text remains only `delete`.
- Focus chooses the next id in the activation-time order, otherwise previous,
  otherwise the field. An unknown id resolves to the field.

Using a single active id is intentional. The dock has one refusal channel and
one focus transfer; allowing simultaneous deletes would make response order
change focus and could let one success erase another request's failure. The
brief dock-wide delete guard is simpler and does not block Queue/send.

## Request helpers

In each shell's request layer, export the generated type:

```ts
export type WithdrawWorkflowNodeResponse = components['schemas']['WithdrawWorkflowNodeResponse'];
```

Add:

```ts
export async function withdrawNodeGuidance(
  runId: string,
  nodeId: string,
  messageId: string
): Promise<WithdrawWorkflowNodeResponse>;
```

Requirements:

- DELETE
  `/api/workflows/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}/queue/${encodeURIComponent(messageId)}`;
- no body and therefore no synthetic JSON content type;
- no automatic retry;
- normalize failures through the existing `toSteeringSendError` so both docks
  can continue using `toSteeringRefusal`.

Do not rename the existing send-specific error class in this story; that would
expand a private refactor without changing the user outcome.

## Component behavior

Each dock adds:

- an optional `withdraw?: WithdrawNodeGuidance` prop, defaulting to its own
  request helper;
- an exported `WithdrawNodeGuidance` function type derived from the generated
  response;
- a `Map<string, HTMLButtonElement>` ref populated by button ref callbacks;
- a `pendingFocusRef: RemovalFocusTarget | null`.
- a ref for the detached `role="alert"` disclosure so a 422 transition can
  receive programmatic focus instead of returning keyboard users to `<body>`.

Render after each row's `sent` text:

```tsx
<button
  type="button"
  aria-label={deleteButtonAccessibleName(receipt.message)}
  aria-disabled={dock.withdrawingMessageId !== null ? true : undefined}
>
  delete
</button>
```

The actual classes must satisfy:

- `min-h-[24px] min-w-[24px]` plus horizontal padding, no native
  `disabled`;
- flex-none at the right edge while the message span remains
  `min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap`;
- 11px-ish mono/text-secondary treatment consistent with the row;
- Legacy focus ring:
  `focus-visible:outline-2 focus-visible:outline-accent-bright focus-visible:-outline-offset-2`;
- Console focus ring:
  `focus-visible:outline-2 focus-visible:outline-accent-bright! focus-visible:outline-offset-2`;
- no new animation. A hover background may use `bg-surface-inset`; do not add
  motion that creates a new reduced-motion branch.

The click handler:

1. Returns immediately when any withdraw is active.
2. Captures the ordered ids and computes the focus target.
3. Applies `beginWithdraw`.
4. Calls the injected helper with run, namespaced node, and row id.
5. On 200, applies `resolveWithdrawSuccess`.
6. On failure, clears the pending focus target and applies
   `resolveWithdrawFailure(..., toSteeringRefusal(error))`.

An effect keyed to `dock.sent` consumes a pending focus target after the
successful DOM update. Focus the mapped delete button if present, otherwise
the textarea, then clear the ref. On failure the focused button remains mounted
and should retain focus without an effect. The exception is a 422: the existing
`steeringDockMode` transition replaces the dock with its detached disclosure,
so make that alert programmatically focusable with `tabIndex={-1}` and focus it
when the mode changes to `detached`. Apply the same rule to a send-triggered 422;
it is the same existing disclosure path, not a second error UI.

Delete is available in `composer` and `blocked` modes when rows exist. A
pending Ask disables only sending; it does not make a retained parked queue
immutable. The `hidden` branch remains unchanged; detached copy/layout stays
unchanged apart from the alert's new programmatic focus target.

## Tests

### Shared pure tests

1. Initial state includes `withdrawingMessageId: null`.
2. Begin on an existing row sets only that id; begin for a missing row or while
   another id is active is the same-state no-op.
3. Success removes only the matching row, preserves order/send state, and
   clears refusal/active id.
4. Success for a stale/mismatched id is a no-op.
5. Failure retains rows/send state, stores refusal, and clears the matching
   active id; mismatched failure is a no-op.
6. `resolveGuidanceSuccess` appends while preserving an active withdraw.
7. Accessible name starts with visible `delete`, trims outer whitespace, and
   includes the specific message.
8. Focus rules cover middle → next, last → previous, only → field, and unknown
   → field.

### Each component suite

Use the existing happy-dom harness and add a deferred `nextWithdraw` injection:

1. Two queued rows each expose visible `delete`, exact message-specific
   `aria-label`, native `button[type=button]`, and the shell's 24px/focus
   classes.
2. Clicking the first row calls withdraw exactly once with
   `('run-1', 'grp.body', firstId)`.
3. While pending, every delete handler is guarded, buttons are
   `aria-disabled="true"` but have no `disabled` attribute, and a second
   row click creates no second request. Queue/send remains usable and its 200
   appends a row.
4. On success only the selected row disappears, `queued · n`, list label, and
   status text update, and focus moves to the next row.
5. Deleting the last row focuses the previous row; deleting the only row hides
   the band and focuses the textarea.
6. A 409 refusal keeps the row and focus on its delete button, clears
   `aria-disabled`, displays the existing `role=alert` message, and never
   leaves focus on `document.body`.
7. A 422 refusal follows the existing detached disclosure path and focuses its
   `role=alert` element; add the same focus assertion to the existing
   send-triggered 422 case.
8. After queuing a row, rerender the same dock as blocked by a pending ask:
   Queue remains guarded, delete still invokes withdraw, and success removes
   the parked item. This replaces the draft's timing-dependent parked E2E.
9. Empty/generating and hidden states still contain no delete control.
10. The Console isolation suite remains green; no Console production file
    imports `@/lib/api` or Legacy components.

Native Enter/Space semantics are established by rendering an unmodified
`button[type=button]`; actual keyboard activation and focus transfer are
covered in Phase 3 through Playwright rather than a synthetic `.click()`
mislabelled as a keyboard test.

## Visual acceptance

For both renderers:

- Row anatomy remains one line: full message stays in the DOM/accessibility
  name, visual text end-elides, then `sent`, then `delete` at the right edge.
- The full-bleed band, `queued · n` heading, 33vh internal scroll cap, field,
  and send row do not move to a different structure.
- A long message does not wrap, create horizontal scrolling, or shrink the
  delete target below 24×24.
- Focus is visibly indicated with the surface-specific ring.
- Pending, success, failure, and blocked-with-row states preserve readable
  text; no status is conveyed by color alone.
- Legacy is accepted at the required 460px viewport. Console is accepted in the
  normal 1440×900 run-detail layout (its panel width is layout-derived, not the
  mockup's illustrative 520px) and receives the same 460px overflow guard used
  by Story 2.1.

## Validation

```bash
(cd packages/web && bun test src/lib/steering-dock.test.ts)
(cd packages/web && NODE_ENV=development bun test src/components/workflows/ComposerDock.test.tsx src/components/workflows/NodeTranscriptPane.test.tsx)
(cd packages/web && NODE_ENV=development bun test src/experiments/console/components/ConsoleComposerDock.test.tsx src/experiments/console/components/ConsoleNodeRoom.test.tsx src/experiments/console/console-isolation.test.ts)
bun run type-check
bun run lint
```

## Phase completion criteria

- Both shells have identical semantics and shell-correct focus styling.
- Request URL/method/body behavior is covered by default-helper E2E in Phase 3;
  component tests cover the injected state machine without mocking server data.
- One active withdraw cannot issue a duplicate or race another row's focus.
- Success/failure/422/blocked/send-concurrent behaviors are deterministic.
- Mounting components and Console isolation still pass unchanged.

## Risks and rollback

- **Ref map contains unmounted buttons:** delete the map key when a ref callback
  receives `null`; always fall back to the textarea.
- **A send resolves during withdraw:** preserve
  `withdrawingMessageId` in send transitions and cover it in pure/component
  tests.
- **Very long accessible names:** accepted by the story because the action must
  identify the message; the visible row remains elided.
- Rollback removes additive state/functions/props/buttons/helpers and restores
  the generated response type's sole consumer; no persisted browser record is
  introduced.
