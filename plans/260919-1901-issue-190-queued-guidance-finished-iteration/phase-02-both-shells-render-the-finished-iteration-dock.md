---
title: 'Phase 2: Both shells render the finished-iteration dock'
status: todo
priority: P1
effort: '5h'
dependencies: [1]
gate: 'D1 approval recorded in plan.md Validation Log'
---

# Phase 2: Both shells render the finished-iteration dock

## Goal

Thread the Phase 1 resolver output from the parents that own the row list into
both composer docks and render the collapsed disclosure, the `Go to iteration N`
control, and the read-only queue band, on Legacy and Console, with no steering
mutation reachable from that state.

## Context links

- [plan.md](./plan.md) D2–D4; [Phase 1](./phase-01-start.md) exports.
- Legacy chain: `LegacyGraphLogsPane.tsx:246-263` (`rows`, `selectedRow`,
  `visibleNodeStates`) → `:493-527` (`LegacyNodeRoom` props incl. `nodeState`,
  `onSelectRow={onSelectExecution}`) → `LegacyNodeRoom.tsx:176-195`
  (`NodeTranscriptPane` mount) → `NodeTranscriptPane.tsx:524-534` (`ComposerDock`
  mount keyed `steering:${resolvedScopeKey}`).
- Console chain: `ConsoleInspectPane.tsx:218-240` (`logEntries`, `selectedRow`,
  `headerOptions`) → `:318-345` (`ConsoleNodeRoom` mount, `nodeStates`,
  `onSelectRow` → `onSelectNode(selectedNodeId, rowId)`) → `ConsoleNodeRoom.tsx:1022-1031`
  (`ConsoleComposerDock` mount, gated by `agentActive`).
- Dock renderers: `ComposerDock.tsx:148-156` (mode + `pollingEnabled`), `:246-262`
  (detached branch — the one-line disclosure pattern to mirror), `:272-321`
  (queue band markup to reuse minus the delete button);
  `ConsoleComposerDock.tsx:151-189` and its matching band.
- Focus rule: `EXPERIENCE.md:241` — focus never lands on `<body>`; `control-states.md`
  — `aria-disabled`, never `disabled`.

## Scout pass before execution (deep mode)

Re-read the six files above on the refreshed branch and confirm:

1. `ConsoleInspectPane` still owns `logEntries` (rows are `entry.row`) — the resolver
   input is `logEntries.map(e => e.row)`.
2. `LegacyNodeRoom` still forwards `nodeState`; the new prop rides next to it.
3. No third `ComposerDock` mount exists (`grep -rn "<ComposerDock\|<ConsoleComposerDock" packages/web/src`).
4. `WorkflowExecution.tsx:1041` passes `headerOptions` to `LegacyGraphLogsPane`; it
   does not need the resolver because `LegacyGraphLogsPane` already has `rows`.

## Requirements

- [ ] Both parents compute `finishedIteration` with `resolveFinishedIterationView`
      and pass it plus a `goToIteration(rowId)` callback down to the dock.
- [ ] In `'finished-iteration'` mode each dock renders, in DOM order: a `<p>` with
      `finishedIterationDisclosure(N)` (programmatically focusable, `tabIndex={-1}`),
      a `<button type="button">` labelled `goToIterationLabel(N)`, then the read-only
      band (`<section aria-labelledby>` + `<h3>` `queueBandHeader(n)` + `<ul aria-label>`
      `queueListLabel(n)` + `<li>` message text + `sent`) rendered only when `n > 0`.
- [ ] No `<textarea>`, no `Queue` button, no `delete` button, no send hint in that mode.
- [ ] `pollingEnabled` includes `'finished-iteration'`; the dock issues only
      `readQueue` calls — `send`/`withdraw` are unreachable (no handler bound).
- [ ] A `422 not_steerable_here` from `readQueue` in this mode renders
      `STEERING_DETACHED_DISCLOSURE` under the disclosure line (via the Phase 1
      `onRefusal` hook) so "no live handle" is distinguishable from "empty queue".
      <!-- Red team 2026-09-20: Finding 4 -->
- [ ] `Go to iteration N` calls `goToIteration(liveRowId)`; after the remount the
      composer field receives focus (never `<body>`).
- [ ] Retry-attempt rows, non-live runs, and node-scoped rows render exactly as today.
- [ ] Copy and classes follow the existing dock: `font-mono text-[10.5px]` disclosure
      line, `min-h-[32px]` button with the existing focus-visible outline, band inside
      `max-h-[33vh] overflow-y-auto`.

## Architecture

Prop additions (both docks, both shells):

```ts
export interface ComposerDockProps {
  …existing…
  /** Phase 1 resolver output; null on every non-finished-iteration room. */
  finishedIteration?: FinishedIterationView | null;
  /** Switches the room to the live iteration row; owned by the parent. */
  onGoToIteration?: (rowId: string) => void;
  /** Focus the field on mount — set by the parent right after Go to iteration. */
  autoFocusField?: boolean;
}
```

`NodeTranscriptPane` gains `finishedIteration` and `onGoToIteration` (pass-through)
plus `focusComposerOnMount` derived from a ref the parent flips when the switch
originated from the dock. `LegacyNodeRoom` forwards them. `ConsoleNodeRoom` receives
`finishedIteration` and `onGoToIteration` beside `selectedRow`.

Render branch (inserted before `if (mode === 'detached')`):

```tsx
if (mode === 'finished-iteration' && finishedIteration && onGoToIteration) {
  return (
    <>
      <div className="flex-none border-t border-border bg-surface-elevated px-[10px] py-[8px]">
        <div className="flex items-center gap-3">
          <p ref={disclosureRef} tabIndex={-1} className="min-w-0 flex-1 font-mono text-[10.5px] leading-[1.45] text-text-secondary">
            {finishedIterationDisclosure(finishedIteration.liveIteration)}
          </p>
          <button type="button" onClick={() => onGoToIteration(finishedIteration.liveRowId)} className={…existing button classes…}>
            {goToIterationLabel(finishedIteration.liveIteration)}
          </button>
        </div>
      </div>
      {dock.sent.length === 0 ? null : <ReadOnlyQueueBand … />}   // provisional: validation question 2
    </>
  );
}
```

Extract the `<li>` body of the existing band into a small local render so the
read-only variant is the same markup minus the `<button>` — no new file unless
both docks would otherwise duplicate more than ~40 lines (Rule of Three does not
yet apply; Legacy and Console already mirror each other deliberately).

Focus handoff (consume-once): the parent sets `focusAfterGoTo.current = true` when
`onGoToIteration` fires. `NodeTranscriptPane` reads it in a `useEffect` keyed on
`resolvedScopeKey`: if `true`, it clears the ref **before** focusing, then focuses the
dock's field (via a `focusField()` imperative handle or `autoFocusField` prop on the
freshly keyed dock) — falling back to the transcript scroller (`scrollRef`,
`NodeTranscriptPane.tsx:256-258`) when no field mounted. Because the ref is cleared
in the same effect that consumes it, a later unrelated remount of the same scope
(live refetch, filter change) reads `false` and never steals focus — mirroring the
clear-on-settle discipline of `pendingFocusRef` in `ComposerDock.tsx:187-201`.
<!-- Red team 2026-09-20: Finding 10 -->

Stale target: `finishedIteration` is recomputed on every run-data refetch (1 s while
running). If the live iteration advances between render and click, the click lands on
a now-finished row; the resolver then yields the new live N and the dock re-renders as
finished-iteration for it. No composer flashes in between, because the row's terminal
status is known at the same render. This is accepted and tested rather than guarded.
<!-- Red team 2026-09-20: Finding 11 -->

## Related code files

- Modify: `packages/web/src/components/workflows/ComposerDock.tsx`
- Modify: `packages/web/src/components/workflows/ComposerDock.test.tsx`
- Modify: `packages/web/src/experiments/console/components/ConsoleComposerDock.tsx`
- Modify: `packages/web/src/experiments/console/components/ConsoleComposerDock.test.tsx`
- Modify: `packages/web/src/components/workflows/NodeTranscriptPane.tsx` (+ `.test.tsx`)
- Modify: `packages/web/src/components/workflows/LegacyNodeRoom.tsx` (+ `.test.tsx`)
- Modify: `packages/web/src/components/workflows/LegacyGraphLogsPane.tsx` (+ `.test.tsx`)
- Modify: `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx` (+ `.test.tsx`)
- Modify: `packages/web/src/experiments/console/components/ConsoleInspectPane.tsx` (+ `.test.tsx`)

## Tests before (TDD)

`ComposerDock.test.tsx` and `ConsoleComposerDock.test.tsx` (use the existing
`renderDock` helper with `readQueue` + `pollIntervalMs` overrides; add
`finishedIteration` / `onGoToIteration` to its overrides):

- `renders the collapsed disclosure and Go to iteration N for a finished iteration`
  — exact copy for N = 3; no textarea, no `Queue`, no `delete` in the DOM.
- `mirrors the polled queue read-only in server order` — `readQueue` resolves two
  rows; `<ul aria-label="Queued messages, 2">` lists them in order with `sent`; no
  `<button>` inside the list.
- `issues no send, withdraw, or interrupt request` — spies on `send`/`withdraw`
  stay uncalled after clicking everywhere in the dock and pressing Cmd+Enter;
  `readQueue` was called at least once.
- `empty queue renders no band` — only the disclosure line + button.
- `Go to iteration N invokes the parent with the live row id`.
- `a 422 from readQueue adds the not-steerable disclosure under the finished-iteration line and keeps polling`; a later `200` clears it.
- `a stored draft for this node is not shown in finished-iteration mode and is
  preserved for the composer` — seed sessionStorage, render finished mode, then
  re-render as `composer`: textarea holds the draft.

`NodeTranscriptPane.test.tsx` (after `mounts the composer dock after the transcript
scroller for a live running row`):

- `a later unrelated remount of the same scope does not refocus the field` — after
  the handoff above, re-render with a changed `scopeKey`-neutral prop; the active
  element is unchanged.
- `Go to iteration N whose target completed before the click re-renders as finished-iteration for the new live N` — rows advance between render and click; no textarea appears in between.
- `passes finishedIteration through and focuses the field after Go to iteration` —
  first render with a completed iteration row + `finishedIteration`, click the button,
  assert the callback, re-render with the live row + `autoFocusField`, assert
  `document.activeElement` is the textarea.

`LegacyGraphLogsPane.test.tsx` and `ConsoleInspectPane.test.tsx`:

- `computes finishedIteration from rows, selected row, and node live status` —
  rows `[outer running, ×1 completed, ×2 running]`, node `running`, select `×1`:
  the dock receives `{ liveRowId: <×2 id>, liveIteration: 2 }`; selecting `×2`
  yields `null`; a retry-attempt fixture yields `null`.
- `Go to iteration switches the Execution selection to the live row` — after the
  click the header `<select aria-label="Execution">` value is the live row id and the
  composer textarea is present.

`ConsoleNodeRoom.test.tsx` (after the Story 2.9 case at `:1538`):

- `renders the finished-iteration dock when the selected row is a completed
  iteration of a running node` — read-only band, no `Queue`.

Run each file to see the new cases fail before implementing.

## Refactor (protected changes)

1. Docks: add props, extend `pollingEnabled`, add the render branch, keep every other
   branch byte-identical. Add the `autoFocusField` mount effect.
2. `NodeTranscriptPane` / `LegacyNodeRoom` / `ConsoleNodeRoom`: pass-through props only.
3. `LegacyGraphLogsPane`: compute
   `resolveFinishedIterationView({ rows, selectedRow, nodeStatus: visibleNodeStates.find(...)?.status, live: isLiveRunStatus(runStatus) })`
   beside `ownsUnscopedInteractions`; pass `onGoToIteration={rowId => { focusAfterGoTo.current = true; onSelectExecution?.(rowId); }}`.
4. `ConsoleInspectPane`: same with `logEntries.map(e => e.row)`, `nodeStates`, and
   `isInspectRunLive(run.status)`; `onGoToIteration` calls `onSelectNode(selectedNodeId, rowId)`.
5. `isLiveRunStatus` is a private helper in `NodeTranscriptPane.tsx:60`; either export
   it or compute `live` where `runStatus` is already known in `LegacyGraphLogsPane`
   (prefer exporting the existing helper over a second copy).

## Tests after

- All new renderer cases green on both shells; the Story 2.1/2.2/2.9 dock suites
  unchanged and green.
- `NODE_ENV=development bun test src/components/` and
  `NODE_ENV=development bun test src/experiments/console/` from `packages/web` green.

## Todo

- [ ] Scout pass confirmed (four checks above).
- [ ] Failing tests written for both docks, both parents, both rooms.
- [ ] Props threaded; render branch added; polling enabled in the new mode.
- [ ] Focus handoff implemented and tested.
- [ ] `bun run type-check`, `bun run lint`, and the web test script green.

## Success criteria

- Selecting a finished iteration of a running loop node in either shell shows the
  disclosure, the control, and the read-only band; the network sees only `GET …/queue`.
- Selecting the live iteration again shows the composer with the same ordered queue.
- Retry attempts and non-live runs still hide the dock; node-scoped rows still show
  the live composer.

## Regression gate

```bash
cd packages/web && NODE_ENV=development bun test src/components/workflows/ComposerDock.test.tsx src/components/workflows/NodeTranscriptPane.test.tsx src/components/workflows/LegacyGraphLogsPane.test.tsx
cd packages/web && NODE_ENV=development bun test src/experiments/console/components/ConsoleComposerDock.test.tsx src/experiments/console/components/ConsoleNodeRoom.test.tsx src/experiments/console/components/ConsoleInspectPane.test.tsx
bun run type-check && bun run lint
```

## Risk assessment

- The dock is keyed by `resolvedScopeKey`, so `Go to iteration N` remounts it; the
  focus handoff must survive the remount — hence the parent-owned ref rather than
  dock-local state.
- `agentActive` gating in `ConsoleNodeRoom.tsx:1022` already excludes non-agent rooms;
  the finished-iteration dock inherits that gate.
- Double polling if a finished-iteration dock and a live dock of the same node were
  ever mounted together — impossible today (one room per pane), noted for the record.

## Security considerations

No mutation handlers are bound in the new mode, so a misrouted click cannot send,
withdraw, or interrupt; the only request is the existing authenticated, no-store
`GET …/queue`.

## Next steps

Phase 3 proves the behaviour end to end on the real loop fixture and syncs docs.
