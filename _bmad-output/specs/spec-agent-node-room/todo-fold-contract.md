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
  /** Stable identity for a source whose items can be renamed after creation. Undefined for OMP and TodoWrite. */
  id?: string;
}
export interface TodoPhase {
  phase: string;
  items: TodoItem[];
}

export function projectTodoState(inputs: readonly unknown[]): TodoPhase[];
```

## Three provider shapes, one output

None are variants of one format; they share nothing but the concept.

|               | OMP `todo`                                                      | Claude `TodoWriteInput`                                         | Claude `TaskCreate`/`TaskUpdate`                                                                                     |
| ------------- | --------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| shape         | `{ op, ... }` — a mutation                                      | `{ todos: [{ content, status, activeForm }] }` — the whole list | one task per call: `{ subject, description, activeForm? }` (create) or `{ taskId, subject?, status?, ... }` (update) |
| identity      | `task` content string                                           | `content` string (whole-list snapshot, no separate id)          | `taskId`, a string the tool assigns — see "Identity" below                                                           |
| status        | **absent from input**; implied entirely by which op ran         | **explicit on every item**                                      | **explicit, on `TaskUpdate` only**; a `TaskCreate` call starts `pending`                                             |
| statuses      | five: `pending` `in_progress` `completed` `abandoned` `blocked` | three: `pending` `in_progress` `completed`                      | four: `pending` `in_progress` `completed` `deleted`                                                                  |
| phases        | yes                                                             | none                                                            | none                                                                                                                 |
| item on input | a bare string                                                   | an object                                                       | an object                                                                                                            |

**Claude's `TodoWriteInput` is the degenerate case, and it is the easy one:** each call already carries the final state, so folding is last-call-wins.
Map it to a single phase named `"Tasks"` and widen its three statuses into the five (`abandoned` and `blocked` simply never occur).
`activeForm` is the present-tense label Claude shows while an item runs; it is not needed for a rendered checklist and is dropped.

**OMP is the hard one:** the sections below describe it, and none of it applies to Claude.

## Identity for TaskCreate/TaskUpdate

`TaskCreate`'s input never carries the id the tool assigns to the new task — only its _output_ does (`{ task: { id, subject } }`).
`projectTodoState` folds only recorded tool **inputs**, so the id has to reach it some other way: the caller (`agent-history.ts`) reads a `TaskCreate` call's paired output and merges the assigned id onto the input under a `taskId` key — the exact key `TaskUpdate` already sends natively — before handing it to the fold.
That gives every Task-family record one identity field regardless of which side of the call carried it, and lets this module treat create and update as one upsert:

- A `taskId` this fold has not seen before, paired with a `subject`, establishes a new item (`pending`, unless the same call also sets `status`).
- A `taskId` already known updates that item's `content` (from `subject`) and/or `status` in place — never by matching on `content`, since `TaskUpdate` can rename it.
- A `taskId` this fold has not seen before, with **no** `subject` to establish it, is rejected as a no-op — the same "unknown target never fabricates a row" rule OMP's own `findTask` already enforces for an unmatched `task`.
- A call whose output has not landed yet (the tool call is still live) is folded exactly as sent, with no `taskId` — it does not match the Task-family shape at all, so it is skipped until the id is known.

All Task-family items live in one `"Tasks"` phase; the tool has no phase concept of its own.
Only `subject` (title) and `status` drive the checklist.
`description`, `activeForm`, `addBlocks`, `addBlockedBy`, `owner`, and `metadata` are real fields the agent reads and writes, but none of them change a flat checklist's rendering, so this fold ignores them.
`deleted` (a `TaskUpdate.status` value with no match among the five shared statuses) maps to `abandoned` — the nearest existing status, not a new one; OMP's own `drop` already means "no longer active, not completed" and renders the same struck-through way.
Task-family calls never run OMP's auto-promotion (below): unlike OMP, Claude's own tool never implies a side effect on a task the call did not name.

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
A row therefore changes tasks it never named. `view` is read-only — it never mutates, normalizes, or writes — and a rejected call leaves the prior state untouched, promotion included.

**`op` may be absent.**
Infer it — `list` → `init`, `items` plus `phase` → `append` — rather than discarding the row, and accept the legacy batch shape `{ops:[…]}`.

## Rendering rules

An unknown op leaves state unchanged.
A `done` before any `init` produces no state: render nothing rather than a fabricated list.
Malformed calls are atomic no-ops: a Claude snapshot is accepted whole or rejected whole, and a legacy `{ops:[…]}` batch commits only when every entry replays cleanly — a half-applied batch would show a state no provider committed.

**A phase left with zero items by `rm` is dropped, not rendered as an empty header.**
An empty heading reads as "this phase has no work", which is a different claim from "this phase is gone".
`projectTodoState` returns only non-empty phases, and an all-empty fold returns `[]`, which renders nothing.

The renderer pins the folded state once in a collapsible `Todo` strip below the transcript scroller and immediately above the queue and composer dock.
Every todo call in the selected slice folds into that state.
Earlier todo mutations stay one-line `todo updated` rows.
The latest applicable todo row can expose the approved inline checklist, and it uses the same folded projection as the strip.
When the node reaches a terminal state, the renderer derives the approved completed or interrupted treatment without rewriting persisted todo events.
