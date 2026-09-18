---
phase: 1
title: 'Phase 1: Todo fold, history contract, red E2E'
status: pending
priority: P1
effort: '4h'
dependencies: []
---

# Phase 1: Todo fold, history contract, red E2E

## Overview

Build and prove the one shared piece of Story 1.5 — the pure todo fold in `packages/web/src/lib/todo-state.ts` — and widen `buildAgentHistory()` to return `{ items, todos }` (AD-7) so both shells read node-level todo state from the same place. Then give Phase 2 a red outside-in goal: an `emitTodo` scenario on the env-gated `e2e-fake` provider, a fixture workflow, and a Playwright spec that asserts the strip on both surfaces. Nothing renders yet; the web type-check stays green because the three call sites and three test helpers take their one-line edit here.

## Requirements

- Functional: `projectTodoState(inputs)` folds OMP ops and Claude whole-list calls into `TodoPhase[]` exactly as `todo-fold-contract.md` says and, where the contract is silent, as the OMP harness behaves.
- Functional: `summarizeTodoState(phases)` gives the strip header its `done`, `total`, and `current` item.
- Functional: `buildAgentHistory()` returns `{ items, todos }`; `items` is unchanged from Story 1.1.
- Functional: `e2e-fake` emits a deterministic OMP todo sequence under `emitTodo: true`; the new fixture and spec exist and type-check.
- Non-functional: pure, React-free, deterministic, never throws, no new dependency, zero ESLint warnings; inputs are never mutated.

## Architecture

```ts
// packages/web/src/lib/todo-state.ts
export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'abandoned' | 'blocked';
export interface TodoItem { content: string; status: TodoStatus; blocker?: string }
export interface TodoPhase { phase: string; items: TodoItem[] }
export interface TodoSummary { done: number; total: number; current: TodoItem | null }

export function projectTodoState(inputs: readonly unknown[]): TodoPhase[];
export function summarizeTodoState(phases: readonly TodoPhase[]): TodoSummary;
```

Internal state is a mutable working copy (`{ phase, items }[]`) rebuilt per call. The fold walks `inputs` once:

1. **Shape detection per row.** A non-object row (or `null`/array) is skipped. If the row has an array `todos` → Claude whole-list. Else if it has an array `ops` → legacy OMP batch: each element is applied in order as its own op (same per-op validation; an element that would error is a no-op on its own — the closest faithful reading of `gg`, which applies every element to one clone). Else → single OMP op.
2. **Claude whole-list (last-call-wins).** Working state becomes one phase `"Tasks"` whose items are `todos` entries with a string `content` and a `status` in `pending | in_progress | completed` (other entries are dropped; `activeForm` is never read). No auto-promotion — the call already carries the final state. `todos: []` yields one empty phase, which projection drops.
3. **OMP op resolution.** `op` must be a string in the nine; when `op` is absent, infer with all three harness rules: `list` non-empty array → `init`; `items` non-empty array **and** non-empty string `phase` → `append`; `items` non-empty array and no `phase` → `init` **only when the working state has zero phases** (`c4i(t, r.length > 0)`). Anything else — unknown op, un-inferrable row — leaves state unchanged and skips auto-promotion (contract: "An unknown op leaves state unchanged").
4. **Apply the op to a scratch copy; commit only when the op raised no error.** This mirrors `execute` in the harness (`m = f ? r : c`). Errors, by op:
   - `init`: `list` (array of `{ phase: string, items: string[] }`) or flat `items` (string[]) with optional `phase` (default `"Tasks"`); missing/empty → error. Duplicate phase names or duplicate task contents across the list → error. Success replaces everything with all-`pending` items.
   - `append`: `phase` non-empty string and `items` non-empty string[] required, else error. Any item already present anywhere (or repeated in the call) → error, nothing appended. Success lazily creates the phase and appends `pending` items.
   - `start`: `task` required; not found → error. Success sets every other `in_progress` item to `pending` and this one to `in_progress`.
   - `done` / `drop`: targets = `task` (exact content match across phases; not found → error) or `phase` (exact name; not found → error) or **neither → every item in every phase**. Success sets `completed` / `abandoned`.
   - `block`: `task` or `phase` required (neither → error); target not found → error. Optional `reason` collapses whitespace; only `pending`/`in_progress`/`blocked` targets change to `blocked` with `blocker` set (or cleared when no reason); `completed`/`abandoned` are untouched.
   - `unblock`: `task` or `phase` required; not found → error. Only `blocked` targets become `pending` with `blocker` removed.
   - `rm`: `task` → remove that item (phase stays, possibly empty); `phase` → empty that phase; neither → empty every phase. Not-found targets → error.
   - `view`: no change, and **no auto-promotion** (`execute` returns before the reducer).
5. **Auto-promotion after every committed non-`view` op** (`iZt`): over all items in phase order, if more than one is `in_progress` the extras become `pending`; if none is `in_progress` the first `pending` becomes `in_progress`. This runs after `init`, `append`, `done`, `drop`, `block`, `unblock`, `rm`, and `start`, and never after a rejected op.
6. **Projection.** Return fresh `TodoPhase` objects for phases with at least one item, in insertion order; `blocker` is included only when set. An all-empty fold returns `[]`.

`summarizeTodoState`: `total` = item count; `done` = `completed` count; `current` = first `in_progress`, else first `blocked`, else last `completed`, else `null`.

`buildAgentHistory` change (`agent-history.ts:247-293`): collect `input` from each pushed tool item whose `presentation.family === 'todo'` (already computed by `toToolItem`), then `return { items, todos: projectTodoState(todoInputs) }`. Export `interface AgentHistory { items: AgentHistoryItem[]; todos: TodoPhase[] }`. Items are pushed in projected order, which is `seq` order.

`e2e-fake` change (`provider.ts:45-53`, `:320-350`): add `emitTodo: z.boolean().optional()` to the scenario schema. When true, **before** the `emitTool` block, yield three `tool` + `tool_result` pairs with `toolName: 'todo'`, ids `e2e-fake-todo-${sessionId}-1..3`, `toolOutcome: 'success'`, outputs `'[e2e-fake] todo ok'`, inputs exported as constants:

```ts
export const E2E_FAKE_TODO_INPUTS = [
  { op: 'init', list: [
      { phase: 'Research', items: ['Read the spec', 'Locate the backoff cap'] },
      { phase: 'Implement', items: ['Fix the off-by-one', 'Run the suite'] } ] },
  { op: 'done', task: 'Read the spec' },
  { op: 'block', task: 'Run the suite', reason: 'CI has one build job' },
] as const;
```

Expected folded state: Research → `☑ Read the spec`, `◐ Locate the backoff cap` (auto-promoted — no row named it); Implement → `☐ Fix the off-by-one`, `⊘ Run the suite · blocked: CI has one build job`. Summary `1/4`, current = `Locate the backoff cap`.

## Related Code Files

- Create: `packages/web/src/lib/todo-state.ts`
- Create: `packages/web/src/lib/todo-state.test.ts`
- Modify: `packages/web/src/lib/agent-history.ts`
- Modify: `packages/web/src/lib/agent-history.test.ts`
- Modify (one line each, keeps type-check green): `packages/web/src/components/workflows/NodeTranscriptPane.tsx:234-241`, `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx:605-612`, `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.tsx:205-210`, `packages/web/src/components/workflows/LegacyNodeRoom.test.tsx:1027-1032`, `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx:1206-1211`
- Modify: `packages/providers/src/e2e-fake/provider.ts`, `packages/providers/src/e2e-fake/provider.test.ts`
- Create: `e2e/fixtures/workflows/e2e-todo-strip.yaml`
- Modify: `e2e/lib/playwright/archon-runtime.ts`
- Create: `e2e/ui/agent-todo-strip.spec.ts`
- Read-only: `packages/web/src/lib/tool-presentation.ts` (family resolution), `_bmad-output/specs/spec-agent-node-room/todo-fold-contract.md`, `test-plan.md:61-78`

## Implementation Steps

### Red first — `todo-state.test.ts`

1. Create `packages/web/src/lib/todo-state.test.ts` importing from `./todo-state`. Group by `describe` in the order `test-plan.md:61-78` lists them. Claude first:
   - `{todos:[{content:'a',status:'completed',activeForm:'Doing a'},{content:'b',status:'in_progress',activeForm:'Doing b'},{content:'c',status:'pending',activeForm:'Doing c'}]}` → `[{ phase: 'Tasks', items: [{a,completed},{b,in_progress},{c,pending}] }]`; assert no item has an `activeForm` key and no `blocker`.
   - three Claude calls in sequence → only the third list (assert a task present in call 1 and absent in call 3 is absent; assert statuses come from call 3, not merged).
   - two Claude items both `in_progress` stay `in_progress` (no auto-promotion on the Claude arm).
   - `{todos:[]}` → `[]`.
2. One case per OMP op, each starting from a shared `INIT` fixture (`{op:'init', list:[{phase:'Research', items:['r1','r2']},{phase:'Implement', items:['i1','i2']}]}`), asserting the whole returned array so auto-promotion is visible:
   - `init` → all pending except `r1` (auto-promoted to `in_progress`); flat `{op:'init', items:['x']}` → phase `Tasks`; `{op:'init', items:['x'], phase:'P'}` → phase `P`.
   - `append` to an existing phase and to a new phase (lazily created, appended last).
   - `start i1` → `r1` back to `pending`, `i1` `in_progress` (the "row changes a task it never named" assertion lives here and in the `done` case).
   - `done r1` → `r1` completed, `r2` auto-promoted; `done` with `phase:'Implement'` → `i1`,`i2` completed; bare `{op:'done'}` → **every** item completed, none `in_progress`.
   - `drop` same three targetings → `abandoned`.
   - `block r2 reason:'  waiting   on CI '` → `blocked`, `blocker: 'waiting on CI'` (whitespace collapsed); `block` on a completed task leaves it `completed`; `block` on an abandoned task leaves it `abandoned`; `block` with `phase` blocks only its open items; `block` without target → unchanged.
   - `unblock r2` → `pending`, no `blocker` key; `unblock` on a pending task → unchanged.
   - `rm r1` → row gone, phase stays; `rm phase:'Research'` → phase gone from the projection; bare `{op:'rm'}` → `[]`.
   - `view` → identical to the state before it.
3. Traps and inference:
   - `{list:[…]}` with no `op` → treated as `init`; `{items:['x'], phase:'P'}` with no `op` → `append`; `{items:['x']}` with no `op` on **empty** state → `init` into `Tasks`; the same row on non-empty state → unchanged.
   - `{ops:[INIT, {op:'done', task:'r1'}]}` legacy batch → same as the two separate rows.
   - unknown `{op:'nuke'}` → unchanged; `[{op:'done'}]` alone → `[]`; `[{op:'done', task:'x'}]` alone → `[]`.
   - harness-revert cases (name the reason in the test title: "OMP execute keeps the previous state when the op errors"): `done` with an unknown task → unchanged **and** no promotion side effect; `append` with an item that already exists → nothing appended; `init` with a duplicate task across phases → previous state kept; `start` with an unknown task → unchanged.
   - robustness: `[null, 42, 'x', [], {op:5}, {todos:'no'}, {op:'done', task: 7}]` → `[]` and no throw; a fresh call with the same inputs returns structurally equal but not identical objects; the input rows are unchanged (`toEqual` against a deep copy).
4. The real fixture (`findings.md:154-156` shapes): `{op:'init', list:[{phase:'Research', items:['Read story 5.5 spec and brainstorm','Scout Command Center and run-view code']},{phase:'Plan', items:['Draft phases']}]}` then `{op:'done', task:'Read story 5.5 spec and brainstorm'}` → Research `[completed, in_progress]`, Plan `[pending]`.
5. `summarizeTodoState`: `[]` → `{done:0,total:0,current:null}`; running item wins over an earlier blocked item; blocked wins when nothing is running; all-completed → `current` is the last completed item; all-pending → `current: null`.
6. Run `cd packages/web && bun test src/lib/todo-state.test.ts` — red (module missing).

### Red — `agent-history.test.ts`

7. Change every `buildAgentHistory(...)` call in `agent-history.test.ts` to read `.items` (10 sites), then add a `describe('todos')`:
   - a slice with `todo` (OMP init + done), `TodoWrite`, `Read`, an assistant text, and a status row → `todos` equals the fold of only the two todo inputs in `seq` order (Claude call after OMP init replaces it with `Tasks`); the `Read` input is never folded even if its input carries an `op` key.
   - a slice with no todo family → `todos: []`.
   - a todo call followed by an `interrupted` status → the item is `interrupted` **and** its input still folds.
   - `items` deep-equals the pre-change array for the Story 1.1 fixture (regression pin).
8. Run `cd packages/web && bun test src/lib/agent-history.test.ts` — red.

### Green — implement the fold and the return shape

9. Create `todo-state.ts` per Architecture. Keep helpers private (`asRecord`, `stringArray`, `findTask`, `findPhase`, `applyOmpOp`, `autoPromote`, `applyClaudeList`, `inferOp`). Document the harness-revert rule and the `view` exception with a comment citing the OMP `execute` behaviour, and the "never fabricate" rationale on the empty-state returns. No `any`; the scratch copy is a plain array map.
10. In `agent-history.ts`: import `projectTodoState` and `TodoPhase`; add `export interface AgentHistory { items: AgentHistoryItem[]; todos: TodoPhase[] }`; in `buildAgentHistory` collect `todoInputs` when a pushed tool item has `presentation.family === 'todo'`; return `{ items, todos: projectTodoState(todoInputs) }`. Update the module docblock.
11. One-line edits so type-check is green: `NodeTranscriptPane.tsx:234-241` → `const history = row === null ? { items: [], todos: [] } : buildAgentHistory({...}); const items = history.items;` (Phase 2 reads `history.todos`); same shape at `ConsoleNodeRoom.tsx:605-612` and `ConsoleExecutionHistory.tsx:205-210`; the two test helpers return `agentHistory.buildAgentHistory({...}).items`.
12. Run `cd packages/web && bun test src/lib/ && bun run type-check` (from the package) — green.

### Red — E2E contract (stays red until Phase 2)

13. `packages/providers/src/e2e-fake/provider.ts`: add `emitTodo` to `scenarioSchema`; export `E2E_FAKE_TODO_INPUTS` and `E2E_FAKE_TODO_TOOL_NAME = 'todo'`; yield the three pairs before the `emitTool` block. In `provider.test.ts` add: `emitTodo` yields three `tool`/`tool_result` pairs with `toolName: 'todo'`, inputs equal to the constants in order, distinct sequential ids; `emitTodo` + `emitTool` keeps the existing tool after the todo calls. Run `cd packages/providers && bun test src/e2e-fake` — green.
14. Create `e2e/fixtures/workflows/e2e-todo-strip.yaml` with two `e2e-fake` nodes: `todo-plan` (`{"emitTodo":true,"emitTool":true,"repeatTool":60}` — 60 tool rows give the room a scroll height at 1000 px) and `no-todo` (`{"emitTool":true}`), `mutates_checkout: false`.
15. `e2e/lib/playwright/archon-runtime.ts`: seed the fixture beside the others; export `E2E_TODO_STRIP_WORKFLOW_NAME = 'e2e-todo-strip'`, `TODO_STRIP_NODE = 'todo-plan'`, `TODO_STRIP_EMPTY_NODE = 'no-todo'`; add `runTodoStripWorkflow()` following `runHitlLongHistoryWorkflow` (`:445-470`), mapping a fake that rejects `emitTodo` (`unrecognized_keys` + `emitTodo`) to `UnsupportedSetupError`.
16. Create `e2e/ui/agent-todo-strip.spec.ts` reusing `openToolRoom`-style navigation from `agent-tool-row-visual.spec.ts:55-72` for both surfaces. Cases, each tagged `[P1]` and titled with `todo strip`:
    - strip present on `todo-plan`: `region(<node> room)` contains `section[aria-label="Todo"]`; the four item texts are visible; the `Research` and `Implement` phase labels are visible; `Locate the backoff cap` carries the `in progress` status word; `Run the suite` shows `· blocked: CI has one build job`.
    - pinned: scroll `[data-testid=…-scroll]` to `scrollHeight`, assert the strip `toBeInViewport()`; scroll to `0`, assert again. (Direction flips if Validation question 1 chooses bottom.)
    - every `details[data-tool-id]` whose chip reads `todo` has a summary containing `todo updated` and `op:`; opening the first one reveals no checklist text (`Locate the backoff cap` count inside `details[data-tool-id]` is 0).
    - absent on `no-todo`: `section[aria-label="Todo"]` count 0.
    - Console only: toggle `showToolCalls` off (reuse the control the HITL room spec uses), strip still visible, `details[data-tool-id]` count 0.
    - keyboard: focus the header button, `Space` → `aria-expanded="false"` and the list hidden; `Enter` → back.
    - all visual/geometry captures are added in Phase 3; the spec compiles now.
17. Run the E2E type-check (`cd e2e && npm run typecheck`) — compiles while red.

## Todo

- [ ] `todo-state.test.ts` red, then green
- [ ] `agent-history.test.ts` red, then green with `{ items, todos }`
- [ ] Three call sites and two test helpers take the one-line edit; `bun run type-check` green
- [ ] `emitTodo` on `e2e-fake` with unit coverage
- [ ] Fixture, runtime seeding, and red `agent-todo-strip.spec.ts` compile

## Success Criteria

- [ ] `projectTodoState` unit table passes every `test-plan.md:61-78` line plus the harness-revert, robustness, inference, and real-fixture cases; nothing throws; inputs are never mutated.
- [ ] `buildAgentHistory` returns `{ items, todos }`; the Story 1.1 `items` fixture is byte-for-byte unchanged.
- [ ] Web and providers packages type-check and their tests pass; the Console isolation test stays green.
- [ ] `e2e-fake` emits the documented sequence; the E2E spec type-checks and fails only on the strip's absence.

## Risk Assessment

- Contract vs harness drift: the contract says "auto-promotion runs after every op", the harness skips it for `view` and for rejected ops. Mirror the harness and say so in tests; the contract's author cites the same `todo.ts` lines.
- A future OMP version could change op semantics; the fold is pinned to the observed 18.1.21 behaviour and the test names the reference.
- `repeatTool: 60` on the fixture adds ~1 s to the run; acceptable. If the target fake is older, the spec skips through `UnsupportedSetupError` like the long-history spec does.

## Security Considerations

- Todo content is agent-authored text rendered as React text nodes; nothing in this phase renders. The fold copies strings and never evaluates or interpolates them.
