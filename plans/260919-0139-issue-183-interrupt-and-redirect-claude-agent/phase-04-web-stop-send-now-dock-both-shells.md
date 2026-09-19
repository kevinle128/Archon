---
phase: 4
title: 'Both web docks, accessibility, and visual states'
status: pending
priority: P1
dependencies: [3]
---

# Phase 4: Both web docks, accessibility, and visual states

## Goal

Render the interrupt/redirect state machine with identical anatomy, content, and behavior in Legacy and Console while retaining each shell's tokens and isolation boundary. The caller tab responds immediately to the interrupt result; cross-tab synchronization remains outside this story.

## Design authority and conflict dispositions

Use final `DESIGN.md`, final `EXPERIENCE.md`, and `mockups/key-steering-dock.html` under `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/`, subject to the higher Story 2.3 and ratified `control-states.md` contracts.

- Generating → interrupting keeps focus on the same Stop element by using `aria-disabled`, never native `disabled`.
- When Stop is removed on interrupt resolution, Story 2.3 overrides the older `EXPERIENCE.md` send-control focus note: focus the last transcript row; if no row exists, focus the transcript scroller. Dock removal uses the same fallback. Focus never reaches `<body>`.
- `control-states.md` explicitly keeps Queue available during interrupting so a message sent in the race waits for Send now. This specific state contract overrides `EXPERIENCE.md`'s generic sentence that the shortcut is a no-op while Stopping. Click and keyboard Queue remain equivalent during the interrupt request.
- Final `DESIGN.md` overrides the older mock comment about a filled Legacy send button: measured contrast caused the final design to require bordered, transparent Stop and send controls on both shells.
- The mock's Console 300px crop and UX 520px drawing are illustrative. `DESIGN.md` identifies 460px as the only authoritative room-panel width; no new breakpoint is introduced.

## Files

| File                                                                                  | Change                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/web/src/lib/steering-dock.ts` and test                                      | Extend the framework-free state/reducers for projected agent sub-state, local interrupting, intent-aware receipts, reversible Send-now batches, labels, copy, announcements, and generalized steering request errors. |
| `packages/web/src/lib/api.ts`                                                         | Add typed `interruptNode`; keep send body intent typed from generated OpenAPI.                                                                                                                                        |
| `packages/web/src/experiments/console/skills/runs.ts`                                 | Add the Console-owned equivalent request helper without importing Legacy components.                                                                                                                                  |
| `packages/web/src/components/workflows/ComposerDock.tsx` and test                     | Legacy controls, reducer wiring, disclosure, announcements, error handling, and injected interrupt helper.                                                                                                            |
| `packages/web/src/experiments/console/components/ConsoleComposerDock.tsx` and test    | Same semantic anatomy with Console classes/tokens.                                                                                                                                                                    |
| `packages/web/src/components/workflows/NodeTranscriptPane.tsx` and test               | Pass projected sub-state; own focus fallback and transition-announcement integration.                                                                                                                                 |
| `packages/web/src/components/workflows/NodeRoom.tsx` and test                         | Expose a programmatic ref/marker for the last rendered transcript row.                                                                                                                                                |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx` and test        | Pass sub-state and own the Console focus fallback.                                                                                                                                                                    |
| `packages/web/src/experiments/console/components/inspect/ConsoleAgentHistoryList.tsx` | Expose the Console last-row focus target; cover it in the existing `ConsoleNodeRoom.test.tsx` harness.                                                                                                                |
| `packages/web/src/experiments/console/console-isolation.test.ts`                      | Update only if a Console-owned file/import is added; no cross-shell component import.                                                                                                                                 |

Do not create a third dock component. JSX remains shell-owned and thin; transitions/copy/predicates remain shared.

## State model

Separate send and interrupt in-flight state; the current single `inFlight` flag cannot represent Queue remaining usable while Stop is pending.

Derived modes:

| Source state                                   | Stop control                                      | Send control        | Band/disclosure                                         |
| ---------------------------------------------- | ------------------------------------------------- | ------------------- | ------------------------------------------------------- |
| live queue-only handle; no projected sub-state | absent                                            | Queue               | Existing Story 2.1 band                                 |
| `generating`                                   | Stop                                              | Queue               | `queued · n` when non-empty                             |
| local `interrupting`                           | `Stopping…`, `aria-disabled=true`, same DOM focus | Queue, still usable | `queued · n`                                            |
| `idle-after-interrupt`                         | absent                                            | Send now            | `will send · n` when non-empty; exact disclosure always |
| response `generating`                          | Stop                                              | Queue               | race transition                                         |
| terminal/parked/detached                       | existing hidden/blocked/disclosure behavior       | existing behavior   | no new controls                                         |

Absence of `steeringSubState` means queue-only, not automatically detached. Preserve the current detached decision from a 422 refusal/live context.

`interrupting` is local and short-lived; never add it to generated types or infer a node lifecycle change.

## Shared reducer and request behavior

### Interrupt

- Stop sets local interrupting and writes one polite announcement: `agent interrupting`.
- Suppress repeated Stop activation while retaining focusability.
- 200 idle: clear interrupting, render idle, announce `agent idle · Send now delivers`, then focus the last transcript row/scroller.
- 200 generating: clear interrupting, retain generating, announce `turn ended before stop · <n> sent · agent generating`; do not fake an interrupted row.
- 409 `node_finished`: clear transient and let authoritative row/run state remove the dock; retain any draft.
- 422 `not_steerable_here`: use the existing refusal/disclosure path without losing draft/receipts.
- Network/500 failure: return to projected generating, show a stable role-alert error, and permit retry.

### Queue during interruption

The Queue button and Cmd/Ctrl+Enter remain guarded by non-blank draft, no send request already in flight, and no pending ask. They are not blocked by `interrupting`. A successful receipt remains in the band; if interruption later resolves idle, only its heading/accessible label changes to Will send.

### Send now

- Require a non-blank newly typed draft. An existing queue by itself does not enable the control and does not issue an empty message, matching the strict server schema and UX empty-draft ban.
- Begin by snapshotting the displayed accepted receipts plus the pending new message into an `inFlightBatch`; clear the visible band optimistically so nothing appears pickable twice.
- POST only the new draft with its stable retry UUID and `intent:'send_now'`; earlier items already exist in the server registry.
- Success: discard the batch, clear only the submitted text (preserve edits typed during flight), derive generating, and announce `agent generating`.
- Failure: restore all snapshotted items to the front in original order, preserve the new message/retry id, remain idle unless a terminal projection supersedes it, and render `couldn't send · back in the queue` in `role="alert"`.
- An ambiguous retry reposts only the same new message id; it never re-enqueues prior receipt ids.

Keep local receipt `state` as the generated `queued | awaiting_send_now` union rather than coercing every response to queued.

### Error normalization

The existing `SteeringSendError` now serves two endpoints. Rename it and its normalizer to a route-neutral steering request error in the shared module, updating both request layers and tests; preserve status/code/message behavior. This is an internal web refactor, not a wire change.

## Anatomy, copy, and styling

Both shells render the same order:

1. non-empty full-width receipt band;
2. in idle only, `stopped after the last completed tool call · files already written stay written`;
3. labelled textarea;
4. role-alert failure/refusal or described blocked reason;
5. one control row: Stop/Stopping at left when applicable, Queue/Send now at right.

Requirements:

- Band DOM headers are lowercase (`queued · n`, `will send · n`) and CSS transforms them uppercase.
- List accessible names are `Queued messages, n` and `Will send, n`.
- The visible send word starts its accessible name; include queue depth and the existing keyboard hint.
- Queue/Send now uses `aria-disabled`, never native `disabled`, whenever its shared submit predicate is false (blank draft, pending send, or pending ask). Interrupting alone does not disable Queue. The click and keyboard paths use that exact predicate.
- The receipt band is absent when empty, remains capped at the existing 33vh, and scrolls independently.
- The dock stays a sibling of the transcript scroller, never an overlay/child.
- Controls/field have a 32px minimum target; Send now and Queue share a stable minimum width of 84px and never shift position.
- Use existing surface, border, text-secondary, accent-bright, and focus tokens only. Stop and send are bordered with transparent fill in both shells; only the inherited token values and focus-ring offsets differ.
- `Stopping…` uses text-secondary (not tertiary) and clears 4.5:1 text contrast. Focus outlines use the final measured shell tokens and clear 3:1 non-text contrast.
- Add no dock motion. Existing transitions must respect `motion-reduce`.

## Focus and announcements

- Retain exactly one polite `role="status"` region per mounted room/dock; do not add a competing live region.
- Set its text once per state transition using the composite messages above so the interrupted tool update and idle state do not overwrite each other.
- Delivery failure alone uses an assertive `role="alert"`.
- Mark only the actual last rendered history item as programmatically focusable (`tabIndex=-1`) or expose it through a forwarded ref; do not add it to normal Tab order.
- On Stop removal and dock removal, focus that row with `preventScroll`; when there is no row, focus the existing transcript scroller. Preserve the reader's scroll position as the dock grows/shrinks.

## Visual and responsive acceptance

Verify both Legacy and Console in these states:

1. queue-only non-Claude;
2. Claude generating with empty and non-empty band;
3. interrupting;
4. idle with no receipts and with a multi-item band;
5. Send now in flight;
6. delivery failure restored;
7. generating again;
8. terminal/dock removal.

At an effective 460px node panel and at a 1440×900 desktop viewport:

- no horizontal overflow, clipped copy, wrapped control row, or changed control order;
- Stop remains left and send remains right;
- field and band grow downward while the transcript remains the only main scroll region;
- focused last row remains visible after dock height changes;
- token contrast and focus rings match the final design tables;
- reduced-motion produces no transition animation.

No bespoke smaller breakpoint is added; inherited room responsiveness is regression-tested rather than redefined.

## Tests first

Shared logic tests:

1. projected/local mode derivation, including sub-state absent → queue-only;
2. interrupt begin and each 200/409/422/network resolution;
3. Queue remains enabled during interrupting; repeated Stop is suppressed;
4. Send now requires non-blank draft even with queued receipts;
5. success posts only the new message and clears one batch;
6. failure restores old then new items and retains stable retry id;
7. generated receipt states and duplicate successes do not duplicate UI items;
8. exact labels, headers, disclosure, and announcement strings.

Component tests in both shells:

9. semantic control/state table above, including no Stop for a non-Claude queue-only node;
10. `Stopping…` has `aria-disabled` and no native `disabled`, remains focused, and Queue keyboard/click still works; Queue/Send now exposes the shared false submit predicate through `aria-disabled`;
11. idle DOM order/copy/list labelling and empty-band behavior;
12. one polite update per transition and a distinct delivery `role="alert"`;
13. Stop unmount and dock removal focus the last row, scroller fallback works, and `document.body` never owns focus;
14. run-payload idle state renders correctly without a preceding local click;
15. Console isolation remains green.

## Validation

```bash
cd packages/web
bun test src/lib/steering-dock.test.ts
NODE_ENV=development bun test src/components/workflows/ComposerDock.test.tsx src/components/workflows/NodeTranscriptPane.test.tsx src/components/workflows/NodeRoom.test.tsx
NODE_ENV=development bun test src/experiments/console/components/ConsoleComposerDock.test.tsx src/experiments/console/components/ConsoleNodeRoom.test.tsx src/experiments/console/console-isolation.test.ts
bun run type-check
```

## Completion criteria

- Both shells pass the same semantic test matrix and visual acceptance states.
- No cross-shell component import, workflow package import, new breakpoint, literal palette, or second state machine is introduced.
- Text cannot be lost or double-posted on Stop/Send-now races or ambiguous delivery failure.

## Risks and rollback

- Route response drives the pressing tab; other-tab convergence remains Story 2.9 and no steering SSE event is added here.
- Focus behavior deliberately follows Story 2.3 over the older UX note; keep the authority comment next to its test, not as a plan identifier in production code.
- Rollback can hide Stop/Send-now while retaining the Story 2.1 Queue dock and server types.
