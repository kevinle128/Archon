# Todo fold contract

The machine contract behind CAP-3.

Todo state accumulates across calls, so it cannot be rendered from one item.
This module folds the ordered `todo` calls of one node into current state, mirroring the fold already used to pair tool calls with their results.

## Module

`packages/web/src/lib/todo-state.ts`.

```ts
export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'abandoned' | 'blocked';
export interface TodoItem {
  content: string;
  status: TodoStatus;
  blocker?: string;
}
export interface TodoPhase {
  phase: string;
  items: TodoItem[];
}

export function projectTodoState(inputs: readonly unknown[]): TodoPhase[];
```

## Two provider shapes, one output

The two are not variants of one format; they share nothing but the concept.

|               | OMP `todo`                                                      | Claude `TodoWriteInput`                                         |
| ------------- | --------------------------------------------------------------- | --------------------------------------------------------------- |
| shape         | `{ op, ... }` — a mutation                                      | `{ todos: [{ content, status, activeForm }] }` — the whole list |
| status        | **absent from input**; implied entirely by which op ran         | **explicit on every item**                                      |
| statuses      | five: `pending` `in_progress` `completed` `abandoned` `blocked` | three: `pending` `in_progress` `completed`                      |
| phases        | yes                                                             | none                                                            |
| item on input | a bare string                                                   | an object                                                       |

**Claude is the degenerate case, and it is the easy one:** each call already carries the final state, so folding is last-call-wins.
Map it to a single phase named `"Tasks"` and widen its three statuses into the five (`abandoned` and `blocked` simply never occur).
`activeForm` is the present-tense label Claude shows while an item runs; it is not needed for a rendered checklist and is dropped.

**OMP is the hard one:** the sections below describe it, and none of it applies to Claude.

## The nine OMP ops

| op        | Targeting                                                                       | Effect                                                       |
| --------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `init`    | `list[{phase,items}]`, or flat `items` with optional `phase`, default `"Tasks"` | replace everything, all `pending`                            |
| `append`  | `phase` required, non-empty `items`                                             | lazily create the phase, append as `pending`                 |
| `start`   | `task` required                                                                 | others `in_progress` → `pending`; this one `in_progress`     |
| `done`    | `task`, or `phase`, **or neither → ALL**                                        | `completed`                                                  |
| `drop`    | same as `done`, bare included                                                   | `abandoned`                                                  |
| `block`   | `task` or `phase` required, optional `reason`                                   | `blocked` plus blocker; never reopens completed or abandoned |
| `unblock` | `task` or `phase` required                                                      | `blocked` → `pending`, blocker cleared                       |
| `rm`      | optional `task`/`phase`; omit both → clear all                                  | delete rows                                                  |
| `view`    | —                                                                               | no change                                                    |

## Three traps

Each produces a checklist that lies about what the agent did.

**Bare `done` / `drop` / `rm` are all-targeting.**
`{"op":"done"}` with neither `task` nor `phase` completes every task in every phase.
Treating a missing `task` as a no-op under-reports wildly.

**Auto-promotion runs after every successful mutating op.**
Multiple `in_progress` collapse to the first, and if none is in progress the earliest `pending` is promoted.
A row therefore changes tasks it never named.
`view` is read-only — it never mutates, normalizes, or writes — and a rejected call leaves the prior state untouched, promotion included.

**`op` may be absent.**
Infer it — `list` → `init`, `items` plus `phase` → `append` — rather than discarding the row, and accept the legacy batch shape `{ops:[…]}`.

## Rendering rules

An unknown op leaves state unchanged.
A `done` before any `init` produces no state: render nothing rather than a fabricated list.
Malformed calls are atomic no-ops: a Claude snapshot is accepted whole or rejected whole, and a legacy `{ops:[…]}` batch commits only when every entry replays cleanly — a half-applied batch would show a state no provider committed.

**A phase left with zero items by `rm` is dropped, not rendered as an empty header.**
An empty heading reads as "this phase has no work", which is a different claim from "this phase is gone".
`projectTodoState` returns only non-empty phases, and an all-empty fold returns `[]`, which renders nothing.

The renderer pins the folded state once in a collapsible `Todo` strip after the transcript and immediately above the queue or dock.
The transcript remains the only scrolling region, so the strip stays visible while transcript rows scroll.
Every todo call in the selected slice folds into that state; the strip is not anchored at the last call.
Every todo row stays a one-line `todo updated` summary, so a near-identical checklist is never repeated down the transcript.

The collapsed header shows the current item, the completed count, and one segmented meter cell per item.
The current item is the in-progress item, then the first blocked item, then the last completed item when no active item exists.
The expanded strip shows phase headings and item states.
Its `Raw` control reveals the exact ordered provider todo inputs that produced the folded projection and starts closed.

Terminal state adds a presentation projection after the provider fold.
When the node completes, the terminal projection shows every unfinished item as completed.
When the node fails after 30 minutes in idle-after-interrupt, the projection resets the current item to pending and leaves other provider-folded states unchanged.
This projection does not mutate stored provider calls, the reusable fold result, or Raw.
