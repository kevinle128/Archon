---
phase: 2
title: 'Phase 2: Read-only NEVER SENT box in both docks'
status: pending
priority: P1
effort: '6h'
dependencies: [1]
gate: 'Phase 1 core tests and typecheck pass'
---

# Phase 2: Read-only NEVER SENT box in both docks

## Goal

Wire terminal reconciliation into Legacy `ComposerDock` and Console
`ConsoleComposerDock`, render the same accessible read-only result in both,
and reset attempt-scoped history when the server event fold identifies a new
logical node execution. The event-backed terminal, execution-key, and
settled-transcript props are
supplied in Phase 3; they default to false/null so this phase can be tested in
isolation.

## Files

- Modify `packages/web/src/components/workflows/ComposerDock.tsx`.
- Modify `packages/web/src/components/workflows/ComposerDock.test.tsx` first.
- Modify `packages/web/src/experiments/console/components/ConsoleComposerDock.tsx`.
- Modify `packages/web/src/experiments/console/components/ConsoleComposerDock.test.tsx` first.

Console must retain its isolation boundary: it may import shared library code,
not Legacy workflow components.

## Inputs and eligibility

Add optional `writtenOperatorMessageIds?: ReadonlySet<string> | null`
(default `null`), `nodeTerminal?: boolean` (default `false`), and
`nodeExecutionKey?: string | null` (default `null`) to both docks. Phase 3
supplies all three event-backed values. Reconcile only when all are true:

- the prop is non-null;
- `neverSent` is still null;
- `nodeTerminal` is true;
- this dock has no withdraw request in flight; and
- this run/node attempt previously rendered `composer`, `blocked`, or
  `finished-iteration` and therefore could observe the queue.

A room detached from the outset is ineligible because it never saw a queue. A
room that first observed the queue and later becomes detached retains that
attempt history. A finished-iteration dock is eligible because it polls and
displays the same shared queue, but delivery comparison comes from Phase 3's
node-wide transcript rather than that selected occurrence. Do not treat
`live:false` or an old completed selected row as terminal. Keep a per-attempt
`queueWasObservable` ref so the terminal render knows the dock had an
observation opportunity.

Track prior `nodeExecutionKey` and `nodeTerminal` independently of reconciliation
success. Replacing one non-null execution key with another for the same run/node
is the authoritative reset, including a retry that starts and finishes between
renders. A terminal true-to-false transition remains a fail-safe for incomplete
legacy history with no usable key. Preserve the current draft text, but clear
the prior attempt's `pendingRetry` UUID from state and the existing
session-storage record; the next submit must mint a new id. This reset must run
when `neverSent` is null or empty as well as nonempty. An Ask resume keeps its
folded logical execution key, including a loop resume that mints a new outer
`occurrence_id`, so it preserves the ledger. Changing the selected occurrence
within the same node is not a scope reset and must preserve the node-wide
observation ledger.

## Test-first matrix

Add equivalent tests to both dock test files.

| ID    | Test                                      | Required assertion                                                                                                                                                                                                                               |
| ----- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T2.1  | restores exact unmatched receipts         | Given observed `[A,B]` and written `{A}`, list is named `Never sent, 1`, item text/id are exactly B.                                                                                                                                             |
| T2.2  | shared receipt survives snapshot omission | Render snapshot `[remote-A]`, then `[]`, then terminal written set empty: remote A is restored.                                                                                                                                                  |
| T2.3  | all matched hides dock                    | Every observed id written and no draft/pending: no field, list, or alert.                                                                                                                                                                        |
| T2.4  | pending submission is retained            | Pending id not observed/written appears after observed ids with its identity.                                                                                                                                                                    |
| T2.5  | edited field retains both values          | While pending text is `old`, current raw field becomes `'  new  '`: terminal list ends with identified `old`, then unidentified raw `'  new  '`.                                                                                                 |
| T2.6  | unchanged field is not duplicated         | Pending text and current field equal: one identified item.                                                                                                                                                                                       |
| T2.7  | exact finished anatomy                    | Lowercase source heading styled uppercase; correct list name; exact one alert; no textarea, status region, badge, delete, Stop, Queue, or Send-now button.                                                                                       |
| T2.8  | live/non-event states never reconcile     | Live row, non-live run, or an old completed selected occurrence with `nodeTerminal:false` keeps `neverSent` null and does not show the box.                                                                                                      |
| T2.9  | blocked is eligible                       | A node last parked at Ask can restore its queued guidance after the actual event.                                                                                                                                                                |
| T2.10 | observer eligibility follows history      | A receipt first seen in finished-iteration mode is restored node-wide; always-detached stays ineligible, while observer-then-detached retains its prior ledger.                                                                                  |
| T2.11 | own withdraw stays withdrawn              | Successfully withdrawn id is not restored.                                                                                                                                                                                                       |
| T2.12 | strict-mode/rerender is idempotent        | Result is not duplicated and the existing alert DOM node identity is stable across an unrelated rerender.                                                                                                                                        |
| T2.13 | focus exits removed controls safely       | Field focused in composer **or Go focused in finished-iteration** before overall terminal; after render, focus is last transcript target/scroller, never `body` or the read-only box.                                                            |
| T2.14 | new execution resets attempt state        | A different non-null execution key resets after nonempty, empty, null, and failed/not-yet-complete reconciliation, including terminal→terminal; draft remains, the old retry UUID is removed from state/storage, and next submit mints a new id. |
| T2.15 | scope and occurrence changes are distinct | Rerendering for another occurrence of the same run/node preserves the ledger/result; changing run/node clears history and hydrates that scope's saved draft.                                                                                     |
| T2.16 | finished box stays stable                 | Once reconciled, later queue polling/rerenders cannot reorder or mutate entries.                                                                                                                                                                 |
| T2.17 | terminal waits for own withdraw           | While A's delete is pending, terminal evidence does not reconcile; delete success omits A, while delete failure restores A after the transient clears.                                                                                           |
| T2.18 | prior-attempt async work is inert         | Queue read, Queue/Send-now, withdraw, and interrupt work begun under attempt A may settle after attempt B reset but cannot mutate B's dock, draft, focus, or saved retry UUID.                                                                   |

Use the current fetch and storage harnesses. Avoid adding test-only production
props beyond the real written-id, node-terminal, and node-execution inputs.
Existing refusal, interrupt, blocked, detached, iteration, keyboard, and
storage tests remain behavioral regression coverage.

## Implementation steps

1. Add the three optional props and pass `dock.neverSent` plus `nodeTerminal`
   to `steeringDockMode`.
2. Set a run/node-attempt `queueWasObservable` ref after any
   `composer|blocked|finished-iteration` render. Do not clear it on a later
   detached/hidden render. Handle run/node and execution-key reset before
   observation marking in the same effect (or declare the reset effect first),
   then mark the new attempt from the current mode; this prevents a new-attempt
   render from setting the flag only to have a later effect clear it.
3. Add an idempotent effect that invokes `reconcileNeverSent` only under the
   eligibility rules above. Include current raw field text so a last edit is
   captured, but rely on the one-shot core transition to prevent rerender
   churn. Do not run while `withdrawingMessageId` is non-null; its existing
   success/failure transitions determine whether the id remains eligible.
4. Detect replacement of a non-null `nodeExecutionKey` and reset both visible and
   observed attempt state regardless of `neverSent` value. This must work when
   `nodeTerminal` is true before and after the render. Retain true-to-false as a
   legacy fail-safe only when attempt identity is unavailable. Keep the raw
   draft, but persist `{ draft, pendingRetry: null }` to the existing run/node
   storage key so no prior-attempt UUID can be reused. Do not persist the
   finished list. Ensure this explicit null write is not followed by an
   ordinary effect writing the stale UUID from the same render. Key run/node
   scope resets separately; occurrence-only selection and a same-key Ask resume
   do not clear node-wide state. Advance a local attempt-generation ref at the
   recognized prop boundary (synchronously or in a layout effect, before
   passive async continuations can apply), then perform the idempotent state
   reset. Capture the generation when starting queue reads, Queue,
   Send-now, withdraw, and interrupt operations; before every success/error
   continuation changes dock state, draft, focus, or storage, require the
   captured generation still to match. Include the execution key in polling
   effect dependencies so cleanup aborts the old poller. Do not remount the
   dock by execution key: it must preserve the raw draft while deliberately
   clearing the saved prior-attempt UUID.
5. Add a shared-in-shape, locally rendered finished branch in each dock:
   existing queue-band surface/top rule, heading, list, items, and disclosure.
   Reuse existing tokens and class patterns; do not invent a component that
   crosses the Console/Legacy isolation boundary.
6. Correct the existing control-presence helper to count
   `finished-iteration` as mounted (its Go button is focusable), and keep
   `controlsMounted('finished')` false. This makes both field→finished and
   Go→finished transitions use the existing focus handoff. The result box has
   no focusable descendant.
7. Preserve one alert element and its node identity after the transition.
   Never render an additional polite status region for the same disclosure.

## Visual acceptance

Check both shells with a 460 px dock, plus Console in a 1440 px host:

- source heading is `never sent · 3`; computed presentation is uppercase with
  the existing `0.07em` tracking;
- existing elevated background/top rule and secondary text tokens are used;
- identified and draft-only items keep exact DOM `textContent`, including raw
  whitespace, while CSS presents them as single-line/elided with no horizontal
  overflow;
- band height is at most `33vh` and a longer list remains readable through the
  existing bounded overflow behavior;
- disclosure sits after the list; contrast is at least 4.5:1;
- no field, controls, badges, delete actions, dimmed overlay, or focusable
  element exists.

Do not use the obsolete mockup's 520 px label or the prior plan's unsupported
1280 px dock width as authority.

## Verification

```bash
NODE_ENV=development bun test packages/web/src/components/workflows/ComposerDock.test.tsx
NODE_ENV=development bun test packages/web/src/experiments/console/components/ConsoleComposerDock.test.tsx
bun test packages/web/src/experiments/console/console-isolation.test.ts
bun --filter @archon/web type-check
bun x eslint packages/web/src/components/workflows/ComposerDock.tsx packages/web/src/components/workflows/ComposerDock.test.tsx packages/web/src/experiments/console/components/ConsoleComposerDock.tsx packages/web/src/experiments/console/components/ConsoleComposerDock.test.tsx --max-warnings 0
```

Pass condition: T2.1–T2.18 pass in both files, existing dock behavior remains
green, Console isolation passes, and typecheck/lint are clean.

## Rollback

Revert the four files. Phase 1's unused internal exports remain compatible.
