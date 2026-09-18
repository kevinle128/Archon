---
phase: 1
title: 'Shared fold, history contract, fixture, and docs'
status: pending
priority: P1
effort: '4h'
dependencies: []
---

# Phase 1: Shared fold, history contract, fixture, and docs

## Outcome

Establish one tested, renderer-free todo-state contract; widen `buildAgentHistory()` without changing its transcript items; synchronize the stale source documents; and create a deterministic real-run E2E contract that remains red only because neither strip renderer exists yet.

At phase end, Web and providers tests/type checks are green, the new Playwright file type-checks, and running its strip cases fails on the missing UI rather than setup or data.

## Preflight

Before editing:

1. Check `git status`, issue #178, open PRs, active worktrees/runs, and the current `develop` head.
2. Check whether issue #175 landed. Preserve its Raw/body changes and update test fixtures rather than restoring the old Input/Output bridge.
3. Re-run `rg -n 'buildAgentHistory\(' packages/web/src` and adapt every result. The verified baseline has three production callers, ten direct unit calls, and two test helpers; do not rely on those counts after rebasing.
4. Re-read the current OMP `todo.ts` only as compatibility evidence. The checked-in contract and tests created here become Archon's behavior; do not add a dependency on the ambient global package.

## Shared API

Create `packages/web/src/lib/todo-state.ts`:

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

export interface TodoSummary {
  done: number;
  total: number;
  current: TodoItem | null;
}

export const TODO_STATUS_PRESENTATION: Readonly<
  Record<TodoStatus, Readonly<{ glyph: string; label: string }>>
>;

export function projectTodoState(inputs: readonly unknown[]): TodoPhase[];
export function summarizeTodoState(phases: readonly TodoPhase[]): TodoSummary;
```

`TODO_STATUS_PRESENTATION` owns the semantic mapping once: completed `☑` / `completed`, in-progress `◐` / `in progress`, blocked `⊘` / `blocked`, pending `☐` / `pending`, abandoned `☐` / `abandoned`. Renderers still map statuses to their own token classes.

## Fold algorithm

Use explicit type guards over `unknown`; no Zod dependency is needed in this Web leaf helper.

1. Start with a fresh empty working state. Never retain references to input objects.
2. For each ordered input:
   - non-record, array, `null`, or unrecognized shape: no-op;
   - own `todos` array: validate the **entire** Claude snapshot, then replace state with one `Tasks` phase; an empty valid array clears state; ignore `activeForm`; if any entry lacks string `content` or a supported Claude status, retain the prior state;
   - own `ops` array: validate/replay on a scratch copy; if any entry fails, retain the prior state for the whole batch;
   - otherwise resolve one OMP operation, apply it to a scratch copy, and commit only on success.
3. Missing OMP `op` inference is deliberately narrow:
   - non-empty `list` -> `init`;
   - non-empty `items` plus a truthy string `phase` -> `append`;
   - non-empty bare `items` -> `init` only when no phases exist;
   - everything else is a no-op.
4. OMP operations mirror the contract and observed CLI:
   - `init`: replace from phased `list`, or non-empty flat `items` under supplied phase/default `Tasks`; an explicit empty `list` is a valid clear, while missing data or flat empty `items` is an error; reject duplicate phase names or duplicate task contents across the new list;
   - `append`: require phase and non-empty string items, reject duplicates against the existing state or within the call, lazily append a new phase;
   - `start`: exact task match; reset every other in-progress item to pending, then start the target;
   - `done` / `drop`: exact task, exact phase, or neither meaning all; set completed/abandoned;
   - `block`: require exact task/phase; collapse blocker whitespace; only pending, in-progress, or already-blocked targets change;
   - `unblock`: require exact task/phase; only blocked targets return to pending and lose `blocker`;
   - `rm`: exact task, exact phase, or neither meaning all; removal may temporarily leave an empty working phase;
   - `view`: do not mutate, normalize, or write state.
5. After each successfully applied **mutating** op, normalize in phase/item order: keep the first in-progress item, demote any extras to pending, and if none remains promote the first pending item.
6. A target miss, missing required field, duplicate, unsupported op, invalid batch entry, or malformed Claude snapshot rejects that call without normalization. This is the projector equivalent of OMP's call-level rollback.
7. Return new objects containing only non-empty phases. Preserve phase/item insertion order and phase/task text verbatim (including empty strings the provider accepted); normalize only blocker whitespace. Follow the provider's truthiness for targeting/append and the explicit non-empty requirements above rather than silently trimming agent data.

For a valid legacy batch, replay each entry and normalize after each mutation, making it equivalent to the same entries arriving as separate ordered calls. Retain the pre-batch state if any entry fails, so the UI never shows a half-committed call.

`summarizeTodoState()` flattens phase order, counts `completed` only, and selects: first in-progress, else first blocked, else last completed, else first item, else `null`.

## Tests first

Create `packages/web/src/lib/todo-state.test.ts`. Assert complete projected arrays rather than isolated fields.

### Claude table

- one valid list -> one `Tasks` phase, statuses verbatim, no `activeForm`/`blocker` leakage;
- three lists -> third wins completely;
- two in-progress entries remain as supplied (Claude snapshot is not OMP-normalized);
- valid `todos: []` -> `[]`;
- one malformed entry -> the whole call retains prior state rather than filtering a partial list.

### OMP table

- at least one case for each of `init`, `append`, `start`, `done`, `drop`, `block`, `unblock`, `rm`, and `view`;
- phased and flat init, default `Tasks`, explicit empty-list clear, flat-empty/missing init rejection, append existing/new phase;
- task, phase, and all-target forms for `done` and `drop`; all-target `rm`;
- exact target matching, normalized blocker whitespace, re-block updates reason, completed/abandoned not reopened, unblock only blocked;
- auto-promotion after every successful mutation, including an assertion that a row changes a task it did not name;
- view leaves a deliberately non-normalized valid snapshot unchanged;
- each missing-`op` inference form and the non-empty-state bare-items no-op;
- valid `{ ops: [...] }` equals separate calls;
- invalid batch is atomic;
- unknown operation, done-before-init, unknown target, duplicate init/append, missing target for block/unblock, and missing init data retain prior state and do not normalize;
- removing the final item drops the phase; removing all returns `[]`;
- the real two-phase shape cited by the spec reaches the expected state.

### Robustness and summary table

- mixed `null`, primitives, arrays, wrong field types, unknown aliases, and a `plan`-family-shaped non-todo input never throw or invent state;
- inputs deep-equal a saved copy after projection; repeat calls are structurally equal with distinct object identities;
- summary precedence covers running > blocked > last completed > first pending/abandoned, completed-only count, and empty state;
- semantic status map contains all five statuses with the contract glyph/label.

Run red, then green:

```bash
cd packages/web
bun test src/lib/todo-state.test.ts
```

## Widen `buildAgentHistory()` safely

In `agent-history.ts` export:

```ts
export interface AgentHistory {
  items: AgentHistoryItem[];
  todos: TodoPhase[];
}
```

Keep the existing row projection untouched. After items are in projected sequence, collect `input` from tool items whose resolved `presentation.family === 'todo'` and return `{ items, todos: projectTodoState(todoInputs) }`. Do not branch on provider/tool names and do not filter by result outcome; the projector validates whether each input could have changed todo state. Interrupted rows still contribute because the existing projection retains their tool input.

Update `agent-history.test.ts` and all existing calls to read `.items`. Add cases for:

- pre-change fixture's `items` deep-equal the old expected array;
- OMP inputs fold in projected `seq` order even when source rows arrive unsorted;
- a later Claude snapshot replaces earlier OMP state;
- assistant/lifecycle/non-todo tool inputs carrying `op`-like fields do not fold;
- terminal/lifecycle events do not mark unfinished todos completed or demote current work;
- no todo family -> `todos: []`;
- a running todo call with no result folds from its known input;
- an interrupted todo tool keeps its input in the fold.

Production call-site adaptation in this phase:

- `NodeTranscriptPane` and `ConsoleNodeRoom` retain both `items` and `todos` for Phase 2.
- `ConsoleExecutionHistory` destructures **only** `items`.
- Test helper functions in `LegacyNodeRoom.test.tsx` and `ConsoleNodeRoom.test.tsx` return `.items`.
- Add a `ConsoleExecutionHistory.test.tsx` regression that its root contains no `section[aria-label="Todo"]` for todo input.

Run:

```bash
cd packages/web
bun test src/lib/todo-state.test.ts src/lib/agent-history.test.ts
bun run type-check
```

## Synchronize durable contracts

These are corrections to already-ratified behavior, not new design:

1. `todo-fold-contract.md`: replace “anchored at the last todo call” with the top-pinned strip/all-rows-folded rule; clarify that auto-promotion follows successful mutating operations while `view` is read-only; record atomic malformed-call behavior if the implementation paragraph otherwise remains ambiguous.
2. `EXPERIENCE.md` Flow 1 step 6: Kevin opens the collapsed pinned Todo strip, not a todo transcript row.
3. Handoff `README.md`: mark the old “between transcript and dock” placement and panel-order diagrams as prototype history superseded by canonical top placement. Retain meter/body/current-row details as the anatomy reference; explicitly note that the mock's strip footer and demo-only `todoEnd` lifecycle rewrite are not adopted by the input-fold contract.

Verify every edited claim against SPEC/epic/architecture before proceeding.

## Deterministic E2E data

Extend the existing strict `scenarioSchema` in `packages/providers/src/e2e-fake/provider.ts` with optional `emitTodo: boolean`. Export the tool name and a readonly four-call input sequence:

1. `init` with **12 items** across `Research` and `Implement`;
2. `done` for the first Research item;
3. `block` for `Run the suite` with a deterministic reason;
4. `drop` for `Review output`.

Use this exact init order so the expected summary and screenshots are stable:

- Research: `Read the spec`, `Map the message path`, `Check contract conflicts`, `Inspect the mockups`, `Confirm the tokens`, `Define acceptance cases`.
- Implement: `Add the fold`, `Wire Legacy`, `Wire Console`, `Add the tests`, `Run the suite`, `Review output`.
- Then complete `Read the spec`, block `Run the suite` with `CI has one build job`, and abandon `Review output`.

The resulting fixture contains all five visual statuses: one completed, auto-promoted `Map the message path` in progress, one blocked, one abandoned, and eight pending items. Summary is `1/12`. Twelve rows guarantee the 168 px body overflows in a real browser.

When `emitTodo` is true, emit four `tool`/`tool_result` pairs named `todo`, with unique deterministic-per-session ids, exact inputs, successful outcomes, and a fixed safe output string. Emit them before the existing `emitTool` loop. Keep existing behavior byte-for-byte when the flag is absent.

Provider tests prove:

- four ordered pairs with matching ids, tool name, inputs, output, and outcomes;
- `emitTodo + emitTool + repeatTool` keeps todo calls first and the existing Read calls/count unchanged;
- strict-schema rejection still catches unknown scenario keys;
- no scenario flag preserves the old deterministic response.

Create `e2e/fixtures/workflows/e2e-todo-strip.yaml`:

- `todo-plan`: `emitTodo:true`, `emitTool:true`, `repeatTool:60`; this gives both a long checklist and a genuinely scrolling transcript;
- `no-todo`: ordinary `emitTool:true` only;
- both use `e2e-fake`, have no dependency between them, and set `mutates_checkout: false`.

In `e2e/lib/playwright/archon-runtime.ts`, add fixture path/name/node constants, seed the file, expose `runTodoStripWorkflow()`, and return it from `ArchonRuntime`. Follow the existing long-history runner. Convert only the known strict-schema rejection mentioning `emitTodo` into `UnsupportedSetupError`; rethrow every other failure.

## Red outside-in Playwright contract

Create `e2e/ui/agent-todo-strip.spec.ts`. Keep the necessary navigation, room-width, bounding-box, AX, and contrast helpers local; the equivalent helpers in `agent-tool-row-visual.spec.ts` are not exported, and refactoring that concurrently edited Story 1.1/1.2 file is unnecessary.

Compile these behavior cases now; Phase 2 turns them green and Phase 3 adds measurements:

- both surfaces: one `section[aria-label="Todo"]` inside the `<todo-plan> room` region and zero for `no-todo`;
- starts collapsed with `aria-expanded=false`, representative item and `1/12` visible, body hidden;
- Enter expands; Research/Implement headings and named examples for all five statuses appear; Space collapses; focus stays on the button;
- meter has 12 decorative cells;
- no checklist text exists inside `details[data-tool-id]`; todo summaries remain `todo updated` with `op:`;
- Console with Tool calls off: tool rows disappear while the strip remains;
- pinning: record strip bounding box, scroll the transcript from top to bottom, prove transcript rows change and strip top/height remain within 1 px;
- internal overflow after expansion: todo body has `scrollHeight > clientHeight`, scrolling it leaves the outer transcript `scrollTop` unchanged.

Run the provider test and E2E type-check. The Playwright run should reach the real page and fail only because the strip is absent:

```bash
(cd packages/providers && bun test src/e2e-fake/provider.test.ts)
(cd e2e && npm run typecheck)
bun run --cwd e2e test:ui -- --grep 'todo strip'
```

## Files

- Create: `packages/web/src/lib/todo-state.ts`
- Create: `packages/web/src/lib/todo-state.test.ts`
- Modify: `packages/web/src/lib/agent-history.ts`
- Modify: `packages/web/src/lib/agent-history.test.ts`
- Modify return-shape callers/tests listed in `plan.md`
- Modify: `packages/providers/src/e2e-fake/provider.ts`
- Modify: `packages/providers/src/e2e-fake/provider.test.ts`
- Create: `e2e/fixtures/workflows/e2e-todo-strip.yaml`
- Modify: `e2e/lib/playwright/archon-runtime.ts`
- Create: `e2e/ui/agent-todo-strip.spec.ts`
- Modify the three contract documents listed above

## Exit criteria

- [ ] Fold/history unit tables pass and all existing `items` behavior is unchanged.
- [ ] Every current `buildAgentHistory()` call compiles against the object return.
- [ ] Inline Console history is explicitly strip-free.
- [ ] Provider fixture tests pass; dedicated workflow is seeded and runnable.
- [ ] New E2E spec type-checks and fails only at the missing strip.
- [ ] Durable documents no longer contradict top-pinned/all-rows-folded/read-only-view behavior.

## Risks and safeguards

- Do not silently filter malformed Claude entries or partially commit a batch; both manufacture state.
- Do not import provider code or Zod into Web for this pure fold.
- Do not use the installed OMP package at runtime or add it to dependencies.
- Do not modify Story 1.2 row-body behavior while adapting tests.
- Synthetic strings only may enter E2E screenshots/reports; no real run payloads.
