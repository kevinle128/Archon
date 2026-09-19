---
phase: 2
title: 'Both docks read and reconcile the shared queue'
status: pending
priority: P1
effort: '1 session'
dependencies: [1]
---

# Phase 2: Both docks read and reconcile the shared queue

## Goal

Wire the Phase 1 poll loop and reconcile functions into the Legacy
`ComposerDock` and the Console `ConsoleComposerDock` so each open room
hydrates the queue on mount, re-reads it every second while the node is live,
reflects remote sends and withdraws without issuing its own requests, keeps
keyboard focus off `<body>` when another view removes the focused row, and
discloses a detached run from the read (after three consecutive 422s, and
self-healing on a later 200) instead of from a failed send. Update the
Story 2.1 detached E2E scenario that this behavior change invalidates.

Deep-mode note: this phase is outlined against today's anchors. Before
cooking it, re-scout `ComposerDock.tsx`, `ConsoleComposerDock.tsx`, and the
detached scenario in `agent-queue-guidance.spec.ts` — Phase 1 will have
changed `steering-dock.ts` and both API layers.

## Source anchors

- Legacy dock: `packages/web/src/components/workflows/ComposerDock.tsx`
  — props `:64-80`, state `:108-112`, scope reset `:116-123`, detached focus
  effect `:135-137`, withdraw focus effect `:141-152`, `submit` `:153-174`,
  `withdrawMessage` `:176-195`, queue band `:223-268`, delete button ref
  map `:239-247`.
- Console dock: `packages/web/src/experiments/console/components/ConsoleComposerDock.tsx`
  — props `:66-80`, state `:113-117`, scope reset `:121-128`, focus effects
  `:140-156`, `submit` `:158`, `withdrawMessage` `:181`, band from `:228`.
- Mount points: `NodeTranscriptPane.tsx:523-531` (keyed by
  `steering:${resolvedScopeKey}`), `ConsoleNodeRoom.tsx:1022-1030`
  (rendered only when `agentActive`).
- Poll precedent: `NodeTranscriptPane.tsx:170-231` (AbortController +
  re-schedule-after-settle + cleanup).
- Component tests: `ComposerDock.test.tsx:74-120` (injected `send` /
  `withdraw`, `flush()` micro-task helper, happy-dom) and
  `ConsoleComposerDock.test.tsx:74-…`.
- Detached E2E: `e2e/ui/agent-queue-guidance.spec.ts:515-563` (both
  surfaces) and the route-smoke test at `:691`.
- Console isolation allowlist:
  `packages/web/src/experiments/console/console-isolation.test.ts:103-159`
  — `@/lib/steering-dock` is approved; `@/lib/api` is not.

## File inventory

| File | Action | Size | Test impact |
| --- | --- | --- | --- |
| `packages/web/src/components/workflows/ComposerDock.tsx` | modify | +~50: `readQueue` + `pollIntervalMs` props, poll effect, snapshot focus recovery, `data-message-id` on rows, docblock | new + existing component tests |
| `packages/web/src/components/workflows/ComposerDock.test.tsx` | modify | +~200: injected `readQueue`, 13 new tests (1–12 plus 8b) | new |
| `packages/web/src/experiments/console/components/ConsoleComposerDock.tsx` | modify | same as Legacy through console seams | new + existing |
| `packages/web/src/experiments/console/components/ConsoleComposerDock.test.tsx` | modify | +~200: 13 mirrored tests | new |
| `packages/web/src/components/workflows/NodeTranscriptPane.test.tsx` | modify | +~15: `spyOn(globalThis, 'fetch')` answering `…/queue` with `{ success: true, queued: [] }` and rejecting anything else, restored in `afterEach` | existing tests keep passing without undeclared I/O |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx` | modify | same stub (precedent: `ConsoleInspectPane.test.tsx:659`) | existing |
| `e2e/ui/agent-queue-guidance.spec.ts` | modify | detached scenario (`:515-563`) rewritten; route-smoke unchanged | E2E |

No new lib module (console allowlist stays untouched). No change to
`NodeTranscriptPane.tsx` / `ConsoleNodeRoom.tsx` mount props: the pane and
room tests render live `running` rows (`NodeTranscriptPane.test.tsx:77,746`),
which now mount a polling dock, so those tests stub `fetch` rather than
thread a `readQueue` prop through two parents. A test that reaches the real
`fetch` is exactly the silent-I/O hazard AGENTS.md warns about; the stub's
"reject anything else" branch makes any other call fail loudly.

## Dock changes (identical semantics in both shells)

1. **Props.** Add `readQueue?: ReadNodeGuidanceQueue` (default: the shell's
   `readNodeGuidanceQueue`) and `pollIntervalMs?: number` (default 1000, the
   same constant `transcriptRefetchInterval` returns). Export the
   `ReadNodeGuidanceQueue` function type next to `SendNodeGuidance`.
2. **Row identity.** Each `<li>` gets `data-message-id={receipt.messageId}` so
   the E2E can assert identity and order across views without reading text.
3. **Poll effect.** One `useEffect` keyed on `[runId, nodeId, live, rowStatus,
   readQueue, pollIntervalMs, pollingEnabled]` where
   `pollingEnabled = mode !== 'hidden'` — polling continues in `detached`
   mode on purpose, so an in-process node whose handle registers after
   `node_started` (`dag-executor.ts:2018-2021` vs `:3001`) heals. It calls
   `startQueuePolling({ read: signal => readQueue(runId, nodeId, { signal }),
   currentGeneration: () => dockRef.current.queueGeneration,
   onSnapshot, onRefusal, intervalMs: pollIntervalMs })` and returns the stop
   function. Keep a `dockRef` mirror of `dock` (same pattern as
   `pageStateRef` in the pane) so `currentGeneration` reads the latest value
   without re-running the effect on every state change.
   - `onSnapshot(snapshot, generationAtRequest)`: compute
     `focusTargetAfterSnapshot(previousIds, nextIds, focusedId)` where
     `focusedId` is the key of `deleteButtonsRef` whose element is
     `document.activeElement`; if non-null and `pendingFocusRef.current ===
     null`, store it. Then `setDock(current => applyQueueSnapshot(current,
     snapshot, generationAtRequest))`.
   - `onRefusal(refusal, status)`: for 422 → `setDock(current =>
     resolveQueueReadRefusal(current, refusal))` — the streak decides when
     `steeringDockMode` flips to `detached`, and the existing effect then
     focuses the disclosure. For 409/404 → no state change; the poll has
     stopped and the row status will hide the dock.
   - **Heal focus.** When `mode` transitions from `detached` back to
     `composer` (a snapshot cleared the refusal), the disclosure unmounts; if
     it held focus, focus the field. Extend the existing detached focus
     effect (`:135-137`) with a `prevModeRef` so the transition is explicit —
     never let focus fall to `<body>` on the way back either.
   - The scope-change reset effect (`:116-123`) already recreates state; the
     poll effect re-runs because `nodeId` changed.
4. **Focus effect.** The existing withdraw focus effect (`:141-152`) already
   consumes `pendingFocusRef` whenever `dock.sent` changes and no withdraw is
   active — snapshot-driven removals reuse it unchanged. Verify the deferred
   case: remote removal while a local withdraw is in flight keeps the target
   until the withdraw settles.
5. **Docblocks.** Replace "no polling, no queue read, no rehydration (Story
   2.9)" in both headers with the read-and-reconcile description.
6. **Copy.** `STEERING_SEND_HINT` (`this tab only`) still describes the
   unsent draft correctly and is unchanged. Do not add new copy.

## Tests before (write first, watch fail)

`ComposerDock.test.tsx` and `ConsoleComposerDock.test.tsx`, each with an
injected `readQueue` returning a controllable deferred and
`pollIntervalMs={0}` so cadence is driven by resolving deferreds:

1. **hydrates on mount** — a snapshot with two rows renders `queued · 2`, the
   list in server order, both `data-message-id`s, and `2 messages queued`
   status text, with zero send/withdraw calls.
2. **remote withdraw converges** — first snapshot 2 rows, second snapshot 1
   row → the removed row is gone, header `queued · 1`, `withdrawCalls`
   remains empty.
3. **remote send converges** — a snapshot adds a row this tab never sent, in
   the server's position.
4. **stale snapshot after local withdraw is ignored** — start a read (deferred
   A), click delete, resolve the withdraw 200, then resolve A with the old
   2-row list → still 1 row.
5. **stale snapshot after local send is ignored** — symmetric with send.
6. **remote removal of the focused row moves focus** — focus row 1's delete,
   next snapshot lacks row 1 → focus on row 2's delete; when no sibling
   survives → focus on the field; `document.activeElement !== body`.
7. **draft stays local** — type in the field, receive a snapshot → field text
   and `sessionStorage` record unchanged.
8. **read 422s disclose detached only after three in a row** — the first
   two 422 rejections leave the composer visible with no alert; the third
   renders and focuses the disclosure, the field is absent, no send is
   issued, and the poll keeps issuing reads.
8b. **a later 200 heals** — after 8, a snapshot resolves → the composer
   returns with the snapshot's rows, the disclosure is gone, and focus is on
   the field (never `body`).
9. **read 409 stops polling silently** — no alert, dock unchanged, `readQueue`
   not called again.
10. **transport failure keeps the last snapshot** — status 0 rejection → rows
    unchanged, next read scheduled.
11. **unmount stops polling** — unmount while a read is pending; resolving it
    afterwards updates nothing (no React warning, no extra call).
12. **hidden mode never reads** — `live={false}` → `readQueue` never called.

Existing tests: `422 not_steerable_here replaces the dock…` (`:526`) and
`a 422 refusal follows the detached disclosure…` (`:750`) still pass because
send/withdraw 422 handling is untouched; they now need `readQueue` stubbed
to a never-resolving or empty-snapshot deferred so the poll does not race
them.

## Story 2.1 E2E update — detached scenario

`agent-queue-guidance.spec.ts:515-563` (`[V:steer.detached-${surface}]`):

- Remove the "No queue read exists yet" comment and the fill/press/422-send
  steps. After `openGuidanceRoom`, wait for the **third** GET `…/queue`
  422 response (count `page.waitForResponse` matches on the queue pathname),
  then assert the disclosure text, `field` count 0, no `queued ·` text,
  contrast, and capture the same evidence file names. Also assert one more
  `…/queue` request is issued after the disclosure appears (polling
  continues on a detached run).
- Drop the sessionStorage draft assertions from this scenario — there is no
  field to type into on a detached run. The draft-survives-a-refusal property
  remains covered by `ComposerDock.test.tsx:422` and the library tests.
- The route-smoke test at `:691` is unchanged (it calls the send route
  directly).
- Re-run both surfaces and refresh `us-005-*-detached-422.png` evidence in
  the Story 2.1 plan's evidence directory only if the visual differs; do not
  edit that plan's prose.

## Refactor (protected)

- The withdraw focus effect and `pendingFocusRef` are reused, not
  duplicated. If a snapshot and a local withdraw both want to set the target,
  the local withdraw (set at activation) wins because the snapshot path only
  writes when the ref is null.
- `steeringDockMode` is unchanged; the 422 read simply stores a refusal.

## Tests after

- All 13 new tests green in both shells; the pane/room tests green with the
  read stubbed.
- `bun --filter @archon/web test` and `bun run type-check` / `bun run lint`.
- `(cd e2e && npm run typecheck)` and the two detached scenarios:
  `npx playwright test --grep '\[V:steer\.detached-'` from `e2e/`.

## Todo

- [ ] Legacy dock: props, `data-message-id`, poll effect, snapshot focus,
      docblock
- [ ] Legacy dock tests 1–12 (plus 8b) first, then green; existing 422 tests stubbed
- [ ] Console dock: mirrored changes through `skills/runs.ts`
- [ ] Console dock tests 1–12 (plus 8b) first, then green
- [ ] Pane / room tests: stub the read
- [ ] Detached E2E scenario rewritten for both surfaces
- [ ] Console isolation test still green (no new lib imports)

## Regression gate

```bash
bun run type-check && bun run lint
bun test packages/web/src/components/workflows/ComposerDock.test.tsx
bun test packages/web/src/experiments/console/components/ConsoleComposerDock.test.tsx
bun --filter @archon/web test
(cd e2e && npm run typecheck && npx playwright test --grep '\[V:steer\.detached-')
```

## Risk assessment

- **Effect dependency churn**: putting `dock` in the poll effect's
  dependencies would restart the loop on every keystroke-adjacent state
  change; the `dockRef` mirror is the mitigation. Test 11 catches a loop
  that survives unmount; a test that types while a read is pending and
  asserts one `readQueue` call catches restarts.
- **Composer visible for ~3 s on a genuinely detached run** before the
  third 422 confirms it. Accepted: a send in that window returns 422 and
  flips the dock immediately (Story 2.1 behavior, unchanged), and the draft
  save effect keeps anything typed. The alternative — flashing "this run was
  started detached" on every in-process node during its registration
  window — is misleading copy, which is worse.
- **Console `agentActive` gate**: the Console mounts the dock only while the
  agent is active (`ConsoleNodeRoom.tsx:1021`), so a read never runs on a
  finished node there; the Legacy pane relies on `mode === 'hidden'`.

## Security considerations

- No new identity handling in the browser; reads carry whatever identity
  the shell's fetch layer already sends.
