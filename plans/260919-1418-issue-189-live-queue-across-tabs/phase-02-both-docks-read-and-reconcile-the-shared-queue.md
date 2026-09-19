---
phase: 2
title: 'Both docks hydrate and reconcile the shared queue'
status: pending
priority: P1
effort: '1 session'
dependencies: [1]
---

# Phase 2: both docks hydrate and reconcile the shared queue

## Goal

Wire the Phase 1 read/reconcile/poll primitives into Legacy `ComposerDock` and
Console `ConsoleComposerDock`. Each visible steerable room must hydrate at
mount, converge every second, preserve tab-local input, reject stale local
races, and restore focus after a remote removal without changing established
copy, detached behavior, or dock geometry.

Before implementation, re-read both components and tests because Phase 1 will
have changed their imported shared state/API types.

## Evidence anchors

- Legacy renderer and tests:
  `packages/web/src/components/workflows/ComposerDock.tsx` and
  `ComposerDock.test.tsx`.
- Console renderer and tests:
  `packages/web/src/experiments/console/components/ConsoleComposerDock.tsx`
  and `ConsoleComposerDock.test.tsx`.
- Keyed production mounts:
  `packages/web/src/components/workflows/NodeTranscriptPane.tsx` and
  `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx`.
- Serial-poll cleanup precedent: each parent transcript effect uses an
  `AbortController`, re-schedules after settle, and stops on cleanup.
- Console boundary:
  `packages/web/src/experiments/console/console-isolation.test.ts` already
  approves `@/lib/steering-dock` and forbids Console room imports from
  `@/lib/api`.
- Final UX authority: `EXPERIENCE.md` says it wins over mocks, reserves
  `this tab only` for unsent input, requires a full-bleed ordered queue band,
  and forbids focus loss; `DESIGN.md` sets `33vh` and the 460px contract width.

## Files

| File                                                                           | Action                                                                                                                        |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `packages/web/src/components/workflows/ComposerDock.tsx`                       | Add read/poll test seams, immediate poll effect, accepted-snapshot focus scheduling, `data-message-id`, and current docblock. |
| `packages/web/src/components/workflows/ComposerDock.test.tsx`                  | Stub reads in existing tests and add focused hydration/race/focus/failure/cleanup cases.                                      |
| `packages/web/src/experiments/console/components/ConsoleComposerDock.tsx`      | Mirror semantics through the Console API layer.                                                                               |
| `packages/web/src/experiments/console/components/ConsoleComposerDock.test.tsx` | Mirror the behavior tests.                                                                                                    |
| `packages/web/src/components/workflows/NodeTranscriptPane.test.tsx`            | Install a strict queue-GET fetch stub for live-dock parent tests.                                                             |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx`     | Install the equivalent strict fetch stub.                                                                                     |

No production change is required in `NodeTranscriptPane.tsx`,
`ConsoleNodeRoom.tsx`, CSS/theme files, or Console isolation configuration.
Both production mount points already key the dock by the resolved scope.

Do not rewrite the existing detached Playwright scenario: a read 422 is
non-visual, while the existing send 422 still owns the detached disclosure and
draft-retention proof.

## Component API

Export beside the existing send/withdraw function types:

```ts
export type ReadNodeGuidanceQueue = (
  runId: string,
  nodeId: string,
  options?: { signal?: AbortSignal }
) => Promise<ReadWorkflowNodeQueueResponse>;
```

Add optional props:

- `readQueue?: ReadNodeGuidanceQueue`, defaulting to that shell's
  `readNodeGuidanceQueue` helper;
- `pollIntervalMs?: number`, defaulting to `1000` and used only as a narrow
  deterministic test seam.

The Console component imports its helper/types from `../skills/runs`; Legacy
uses `@/lib/api`.

## Poll effect

In each dock:

1. Keep `dockRef.current = dock` current during render, matching the parent
   transcript's current-state ref pattern. The poller uses it only to capture
   `queueGeneration`; final acceptance still occurs inside functional
   `setDock`, against the actual current state.
2. Compute `pollingEnabled` only for existing `composer` and `blocked` modes.
   Hidden historical/terminal rooms never read, and a send-triggered detached
   disclosure stops reading because Story 2.9 gives queue reads no capability
   state transition.
3. In one effect keyed by `runId`, `nodeId`, `readQueue`, `pollIntervalMs`, and
   `pollingEnabled`, call:

   ```ts
   startQueuePolling({
     read: signal => readQueue(runId, nodeId, { signal }),
     currentGeneration: () => dockRef.current.queueGeneration,
     onSnapshot,
     intervalMs: pollIntervalMs,
   });
   ```

   Return the stop function. Do not place the whole `dock` object in the
   dependency list and restart the loop on every state change.

4. The existing keyed mounts and dependency cleanup guarantee one poller per
   visible scope. The components' internal scope reset remains as a direct-use
   safeguard and resets generation with the other state.

## Applying snapshots and focus

`onSnapshot` must capture the currently focused row id from
`deleteButtonsRef` before rendering changes, then use a functional state update:

1. Call `applyQueueSnapshot(current, snapshot, generationAtRequest)`.
2. If it returned the same state/sent identity, return immediately and do not
   touch `pendingFocusRef`.
3. If the accepted state removed the focused id and
   `pendingFocusRef.current` is null, set the ref to
   `focusTargetAfterSnapshot(previousIds, nextIds, focusedId)`.
4. Return the accepted state.

Mutating the pending-focus ref inside the updater is limited to a deterministic
ref assignment; actual DOM focus remains in the existing post-commit effect.
If React evaluates the updater more than once, the same target is assigned.

The current focus effect already waits while a local withdraw is active and
then resolves delete target → field. Reuse it. A local withdraw target wins
because the snapshot path writes only when the ref is null.

Add `data-message-id={receipt.messageId}` to each queue `<li>`. Keep keys,
accessible names, `sent` text, list/header/status copy, classes, target sizes,
and DOM order unchanged.

## Behavior that must not change

- `STEERING_SEND_HINT` remains `Cmd/Ctrl+Enter to send · this tab only`, and
  the queue band contains no tab-only label.
- Send/withdraw responses still update immediately; polling is convergence,
  not the only feedback path.
- Existing send/withdraw refusals remain visible and are not cleared by reads.
- Read 422/transport/5xx produces no alert or detached transition and preserves
  the last good queue while the shared poller retries.
- The existing send 422 still replaces the dock with the detached disclosure,
  focuses that disclosure, and preserves the draft/retry id.
- Ask-blocked mode continues to render the shared queue but refuses local send.
- No loading placeholder or animation is introduced during initial hydration.

## Component tests to write first

Update each test render helper to inject a default read promise that does not
settle, so all existing send/withdraw tests remain deterministic and perform no
real fetch. Add controllable deferred reads for the new cases.

Mirror these cases in both shells:

1. **Hydrate on mount:** a two-row response renders `queued · 2`, exact server
   order, `data-message-id`s, `sent`, correct list/status count, no band-level
   `this tab only`, and zero send/withdraw calls.
2. **Remote convergence:** subsequent snapshots add a row this tab did not
   send, then remove a row; header/list/status match, and the observer issues no
   DELETE.
3. **Stale after local send:** begin a read, complete a local POST, then resolve
   the old read without the accepted row; the local row remains.
4. **Stale after local withdraw:** begin a read with the old rows, complete the
   DELETE, then resolve the old read; the removed row does not reappear.
5. **Focused remote removal:** focus the first delete control, apply a snapshot
   removing it, and assert focus moves to the next surviving delete. Remove the
   last survivor remotely and assert focus moves to the textarea, never body.
   Include a multi-row removal so the helper skips another removed sibling.
6. **Draft/retry locality:** type an unsent draft (and preserve an existing
   pending retry fixture), apply a remote snapshot, then assert textarea and
   sessionStorage are byte-for-byte unchanged.
7. **Transient read failure:** reject reads with 422, transport status 0, and
   500; the composer/last queue/refusal state remains unchanged and another
   read is scheduled. No detached alert appears from the read.
8. **Permanent read failure:** 409 (representative permanent 4xx) stops further
   reads and leaves current UI unchanged.
9. **Lifecycle cleanup:** unmount or change scope while a read is pending;
   resolving it later causes no state/focus update or additional call.
10. **Hidden/detached modes:** `live={false}` never reads; an existing
    send-triggered detached state stops reading and preserves its disclosure.

The shared-library tests, not both component suites, own exhaustive status-code
classification and timer mechanics. The component cases prove each copied React
wiring reaches the shared contract.

## Parent integration-test isolation

The parent room tests render production docks with the default read helper.
Prevent undeclared I/O:

- add `spyOn(globalThis, 'fetch')` setup that returns a real JSON `Response`
  `{ success: true, queued: [] }` only for a GET pathname ending in `/queue`;
- reject every other URL/method so an unrelated new request fails loudly;
- restore the spy in `afterEach` even on assertion failure;
- keep existing injected transcript loaders unchanged.

Do not thread a production-only read prop through both parent component trees
solely for tests.

## Visual regression checks

The component markup tests must additionally assert that hydrated rows use the
same existing class/token structure:

- band is a sibling directly above the padded composer and stays
  `surface-elevated` with a top border;
- list wrapper retains `max-h-[33vh]` and `overflow-y-auto`;
- row text remains one-line/end-elided and delete controls retain minimum 24px
  dimensions/focus class;
- field/hint/control markup and tab order are unchanged.

Phase 3 supplies actual viewport/contrast/overflow evidence; this phase does
not update mockups because there is no visual design delta.

## Validation

```bash
(cd packages/web && NODE_ENV=development bun test src/components/workflows/ComposerDock.test.tsx)
(cd packages/web && NODE_ENV=development bun test src/experiments/console/components/ConsoleComposerDock.test.tsx)
(cd packages/web && NODE_ENV=development bun test src/components/workflows/NodeTranscriptPane.test.tsx)
(cd packages/web && NODE_ENV=development bun test src/experiments/console/components/ConsoleNodeRoom.test.tsx)
bun --filter @archon/web test
bun run type-check
bun run lint --max-warnings 0
```

Also run the existing detached scenarios after rebuilding the web bundle to
prove their send-triggered contract did not change:

```bash
bun run build:web
(cd e2e && npx playwright test -c playwright.config.ts --grep '\[V:steer\.detached-')
```

## Completion checklist

- [ ] Legacy read props/effect/data identity implemented
- [ ] Console mirror implemented through Console-owned API layer
- [ ] Focus scheduling occurs only for an applied snapshot removal
- [ ] Existing send/withdraw/detached/blocked behavior unchanged
- [ ] Ten focused cases pass in both dock suites
- [ ] Parent tests use strict queue-only fetch stubs with cleanup
- [ ] Console isolation test remains green
- [ ] Web package, typecheck, lint, and detached E2E regressions pass

## Rollback

Remove the two effects/props and row data attributes, remove their new tests and
parent fetch stubs, and leave Phase 1's additive GET route unused. A full story
rollback removes Phase 1 as well.
