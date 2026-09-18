---
phase: 1
title: 'Core grouping, fetch-scope amendment, red E2E'
status: pending
priority: P1
effort: '4h'
dependencies: []
---

# Phase 1: Core grouping, fetch-scope amendment, red E2E

## Goal

Land every React-free piece of Story 1.7 with tests written first: `execution` on each history item, the pure occurrence grouper and label composer, the `loopParent` fetch-scope amendment through one shared selection helper, the scroll-hold reducer, and an outside-in Playwright spec that compiles and fails for the right reason. After this phase the shells in Phase 2 render what the core hands them and derive nothing.

## Context links

- Plan: [plan.md](./plan.md) — decisions 1, 2, 3, 5, 7 govern this phase.
- Spine AD-7 (grouping rules 1–4) and AD-8 (eager, unmemoized) in `_bmad-output/planning-artifacts/architecture/architecture-Archon-readable-agent-transcript-2026-09-12/ARCHITECTURE-SPINE.md`.
- UX label table: `EXPERIENCE.md` "Occurrence grouping" (line 288).
- Existing code: `packages/web/src/lib/agent-history.ts`, `packages/web/src/lib/execution-room-model.ts`, `packages/web/src/lib/node-message-pages.ts`, `packages/web/src/lib/room-scroll-follow.ts`, both `build-log-rows.ts` copies, the four `selectionFromRow` helpers listed in plan.md.
- E2E fixture: `e2e/fixtures/workflows/e2e-hitl-run.yaml` (`inspect-twice`, `max_iterations: 2`); helpers in `e2e/lib/playwright/archon-runtime.ts` (`runHitlWorkflow`), `e2e/lib/playwright/run-detail.ts` (`observeNodeMessagePages`), and the `openConsoleLogRow` / `waitForRoom` helpers used by `e2e/ui/workflow-run-hitl-room.spec.ts`.

## Key insights

- `projectTextTranscript` returns `T` (the row type), so a merged assistant block still carries the first delta's `metadata.execution`. No projector change is needed to source `execution`.
- `projectToolTranscript` yields a `ToolTranscriptCard` with `call` and `result` rows; the call row is the authoritative scope (a result written after an interrupt could, in principle, land under a new attempt but never a new occurrence).
- The outer occurrence of a loop node is non-contiguous in `seq` (live evidence: `seq` 1 and 3465). Grouping must be keyed, not run-length.
- `NodeExecution.node_type` is `'loop'` for the outer execution and absent on iteration executions, whose `loop_ancestry` ends with an entry naming the node itself. The `loopParent` predicate is `node_type === 'loop'` AND `loop_ancestry` absent or empty — top-level loop nodes only. A `loop:` node inside a `loop_group` body has a non-empty ancestry and keeps the scoped fetch, because body step names repeat across outer iterations (`dag-executor.ts` `bodyStepNamePrefix`).
- The four selection helpers are byte-identical apart from the Console copy's inline type. Rule of three is exceeded; one exported function in `lib/node-message-pages.ts` replaces them, and Console is allowed to import from `@/lib/`.

## Requirements

Functional:

- `AgentHistoryItem` gains `execution: TranscriptExecution | null` on all three variants.
- `groupByOccurrence(items)` and `occurrenceLabel(...)` per plan.md decisions 2, 3, 7.
- `LogRowSelection` / `ExecutionRowSelection` `occurrence` variant gains `loopParent?: true`; `occurrenceSelection` sets it; `executionLabel` returns `All iterations` for it.
- `selectionForNodeMessages(row)` in `lib/node-message-pages.ts` maps `loopParent` to `{ kind: 'node', rowId }`; all four call sites use it.
- `holdScrollAt(state, scrollTop)` in `lib/room-scroll-follow.ts`.
- `e2e/ui/agent-occurrence-navigation.spec.ts` compiles under `npm run typecheck` and fails on the first heading assertion.

Non-functional:

- No React import in any `lib/` module. No `any`. No regex over prose. Zero ESLint warnings.
- Grouping is O(n) in items with one `Map<string, OccurrenceGroup>`; no memoization (AD-8).
- Inputs are never mutated; malformed metadata is treated as absent, never thrown on.

## Architecture

```text
NodeMessageRow.metadata.execution ─┐
                                   ├─► buildAgentHistory() ─► items[i].execution
ToolTranscriptCard.call/result ────┘
                                            │
                                            ▼
                     groupByOccurrence(items) ─► { groups, headers }
                                            │
                     occurrenceLabel({ retryEpoch, iteration, failed }) per keyed group

LogRow.selection.occurrence.loopParent ─► selectionForNodeMessages(row) ─► { kind: 'node', rowId }
                                                                          (all other rows unchanged)
```

## File inventory

| Path                                                                        | Action | Size   | Test impact                                                      |
| --------------------------------------------------------------------------- | ------ | ------ | ---------------------------------------------------------------- |
| `packages/web/src/lib/agent-history.ts`                                     | modify | ~25 L  | 25 deep-equal item fixtures in `agent-history.test.ts` gain `execution` |
| `packages/web/src/lib/agent-history.test.ts`                                | modify | ~90 L  | new sourcing cases                                               |
| `packages/web/src/lib/occurrence-groups.ts`                                 | create | ~120 L | new suite                                                        |
| `packages/web/src/lib/occurrence-groups.test.ts`                            | create | ~300 L | new suite                                                        |
| `packages/web/src/lib/execution-room-model.ts`                              | modify | ~6 L   | `execution-room-model.test.ts` label case                        |
| `packages/web/src/lib/execution-room-model.test.ts`                         | modify | ~15 L  |                                                                  |
| `packages/web/src/lib/node-message-pages.ts`                                | modify | ~20 L  | `node-message-pages.test.ts` helper cases                        |
| `packages/web/src/lib/node-message-pages.test.ts`                           | modify | ~40 L  |                                                                  |
| `packages/web/src/lib/room-scroll-follow.ts`                                | modify | ~5 L   | `room-scroll-follow.test.ts`                                     |
| `packages/web/src/components/workflows/NodeRoom.tsx` (`selectNodeRoomMessages`) | modify | ~8 L | `NodeRoom.test.tsx` select block                               |
| `packages/web/src/experiments/console/components/inspect/select-node-room-messages.ts` | modify | ~8 L | Console `select-node-room-messages.test.ts`             |
| `packages/web/src/experiments/console/components/ConsoleInspectPane.test.tsx` | modify | ~15 L | option-label assertions for `All iterations`                  |
| `packages/web/src/lib/room-scroll-follow.test.ts`                           | modify | ~15 L  |                                                                  |
| `packages/web/src/components/workflows/build-log-rows.ts`                   | modify | ~12 L  | `build-log-rows.test.ts`                                         |
| `packages/web/src/components/workflows/build-log-rows.test.ts`              | modify | ~40 L  |                                                                  |
| `packages/web/src/experiments/console/components/inspect/build-log-rows.ts` | modify | ~12 L  | Console `build-log-rows.test.ts`                                 |
| `packages/web/src/experiments/console/components/inspect/build-log-rows.test.ts` | modify | ~40 L |                                                              |
| `packages/web/src/components/workflows/NodeTranscriptPane.tsx`              | modify | −15 L  | none (helper swap only)                                          |
| `packages/web/src/components/workflows/WorkflowExecution.tsx`               | modify | −15 L  | none                                                             |
| `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx`       | modify | −18 L  | none                                                             |
| `packages/web/src/experiments/console/components/inspect/ConsoleExecutionHistory.tsx` | modify | −13 L | none                                                    |
| `e2e/ui/agent-occurrence-navigation.spec.ts`                                | create | ~140 L | red until Phase 3                                                |

## Tests before (regression coverage written first)

Write these before touching production code; they must pass on the current tree so the refactor is protected.

1. `agent-history.test.ts` — pin the current `items` projection for a three-row fixture (assistant, tool call+result, lifecycle) with `toEqual`, so adding `execution` shows up as an intentional fixture edit and nothing else moves.
2. `node-message-pages.test.ts` — `nodeMessageScopeKey` cases already exist; add a table over the four `LogRow` shapes (`node`, `occurrence` with and without `attemptId`, `loop_iteration`) asserting what each of the current local helpers returns, expressed against the soon-to-exist `selectionForNodeMessages`. This test is red only because the export is missing; it documents the contract the helper must preserve byte-for-byte.
3. `build-log-rows.test.ts` (both copies) — pin that an iteration execution with `loop_ancestry: [{ node_id: 'loop', iteration: 2 }]` yields `selection.iteration === 2` and no `loopParent` key at all (`toEqual` with an exact object, so an accidental `loopParent: undefined` fails).
4. `execution-room-model.test.ts` — pin `executionLabel` for `{ retryEpoch: 0 }` → `Attempt 1` and `{ iteration: 2 }` → `Iteration 2` so the addition cannot disturb the chip vocabulary.
5. `room-scroll-follow.test.ts` — pin `createScrollFollow('completed')` and `onRoomScroll` outputs as they are today.

Regression gate: `(cd packages/web && bun test src/lib/agent-history.test.ts src/lib/node-message-pages.test.ts src/lib/execution-room-model.test.ts src/lib/room-scroll-follow.test.ts && NODE_ENV=development bun test src/components/workflows/build-log-rows.test.ts src/experiments/console/components/inspect/build-log-rows.test.ts)` — everything green except the intentionally missing-export case.

## Refactor (protected changes)

1. **`agent-history.ts`** — after the `AgentHistoryInput` interface, add
   `export type TranscriptExecution = NonNullable<NonNullable<NodeMessageRow['metadata']>['execution']>;`
   and add `execution: TranscriptExecution | null` to all three `AgentHistoryItem` variants. Add a small `executionFrom(metadata: unknown): TranscriptExecution | null` that returns `metadata.execution` only when it is an object whose `occurrence_id` is a UUID-shaped string (`/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`, mirroring the write-side `z.string().uuid()`), else `null` (defensive against pre-occurrence rows; no Zod in the browser). Source: tool → `executionFrom(card.call?.metadata) ?? executionFrom(card.result?.metadata)`; assistant → `executionFrom(message.metadata)`; lifecycle → `executionFrom(message.metadata)`. `buildAgentHistory` otherwise unchanged.
2. **`node-message-pages.ts`** — add
   ```ts
   export function selectionForNodeMessages(row: {
     id: string;
     selection: { kind: string; occurrenceId?: string; attemptId?: string; loopParent?: true };
   }): NodeMessageSelection
   ```
   returning `{ kind: 'occurrence', occurrenceId, attemptId? }` for an `occurrence` selection without `loopParent`, and `{ kind: 'node', rowId: row.id }` for everything else (including `loopParent`). Keep the structural parameter type so both `LogRowSelection` copies and `ExecutionRowSelection` satisfy it without importing either.
3. **Four call sites** — delete `selectionFromRow` in `NodeTranscriptPane.tsx:57`, `ConsoleNodeRoom.tsx:431`, `ConsoleExecutionHistory.tsx:97`, and `nodeMessageSelectionFromRow` in `WorkflowExecution.tsx:355`; import `selectionForNodeMessages` from `@/lib/node-message-pages` at each. `WorkflowExecution.tsx` also loses the inline `import('./build-log-rows')` type.
4. **Both `build-log-rows.ts`** — extend the `occurrence` variant of `LogRowSelection` with `loopParent?: true`; in `occurrenceSelection`, compute
   `const loopParent = exec.node_type === 'loop' && (exec.loop_ancestry === undefined || exec.loop_ancestry.length === 0);`
   and spread `...(loopParent ? { loopParent: true } : {})`. Update the file docblock's occurrence sentence to say the loop node's own execution is marked as the loop parent so the room can show every iteration.
5. **`execution-room-model.ts`** — add `loopParent?: true` to the `occurrence` variant of `ExecutionRowSelection`; in `executionLabel`, before the `context` array is built, `if (selection.loopParent === true) return 'All iterations';`.
6. **Both `selectNodeRoomMessages` copies** (`components/workflows/NodeRoom.tsx:166`, `experiments/console/components/inspect/select-node-room-messages.ts`) — before the existing `occurrence || node` early return, add: when `selection.kind === 'occurrence' && selection.loopParent === true`, return `ordered.filter(m => { const e = executionFrom(m.metadata); return e === null || (e.retry_epoch ?? 0) === (selection.retryEpoch ?? 0); })`. Export `executionFrom` from `agent-history.ts` for this. A `loop:` node re-run via `workflow retry-node` mints a second outer occurrence and its iterations share that epoch, so each `loopParent` row shows only its own epoch's iterations.
7. **`room-scroll-follow.ts`** — add
   `export function holdScrollAt(state: ScrollFollowState, scrollTop: number): ScrollFollowState { return { ...state, follow: false, pinToBottom: false, scrollTop }; }`
   with a one-line docblock: navigation holds the reader where it put them until they scroll.

Run the regression gate again: everything green, including the previously missing-export case.

## Tests after (new behaviour)

### `occurrence-groups.test.ts` (create; pure, no DOM)

Build items with a small `item(kind, seq, execution)` helper. Cases, each its own `test`:

- keys on `occurrence_id`: two items sharing an occurrence but different `attempt_id` form one group; `attempt_id` never appears in any label or key
- group order is first-`seq` order; items inside a group keep `seq` order
- non-contiguous occurrence: rows `[A@1, B@2, B@3, A@4]` yield two groups `A:[1,4]`, `B:[2,3]`
- `headers` is `false` for zero or one distinct key and `true` for two
- metadata-less item after a keyed item joins the preceding group; metadata-less items before any keyed item are prepended to the first keyed group; an all-metadata-less transcript is one unkeyed group with `key: null`, `label: ''`, `headers: false`, and items in input order
- label `Run 1` for `retry_epoch` 0 or absent; `Run 2 · retry` for epoch 1; `Run 1 · failed` when the group holds a lifecycle `failed`; `Run 2 · retry · failed`; `iteration_failed` also sets `failed`
- label `Iteration 3` from the last `loop_ancestry` entry, with no suffix even when `retry_epoch` is 2 or the group holds `iteration_failed`; `iteration` field is 3, `retryEpoch` is 2, `failed` is true (the shell may use them later; the label stays per the UX table)
- nested ancestry `[{ node_id: 'group', iteration: 1 }, { node_id: 'inner', iteration: 4 }]` labels `Iteration 4`
- the literal strings `Attempt` and `Pass` appear in no label across the whole table (`expect(label).not.toMatch(/Attempt|Pass/)`)
- robustness: `execution` with a malformed `loop_ancestry` (non-array, entry without a numeric iteration) labels as a run; a non-integer `retry_epoch` is treated as 0; inputs are not mutated (`Object.isFrozen` fixture) and output arrays are fresh
- a real-shape fixture reproducing the live loop node: outer occurrence lifecycle rows at seq 1 and 8, iterations 1–3 between, asserting three `Iteration N` groups after one `Run 1` group holding both lifecycle rows

### `agent-history.test.ts`

- tool item `execution` comes from the call row; when only a result row exists it comes from the result; when neither has it, `null`
- assistant item built from three merged deltas carries the first delta's `execution`
- lifecycle item carries its row's `execution`
- a row whose `metadata.execution` lacks `occurrence_id`, or carries a non-UUID string such as `'x'`, yields `null`

### `build-log-rows.test.ts` (both copies)

- an execution `{ node_id: 'loop', node_type: 'loop', occurrence_id, attempt_id, retry_epoch: 0 }` yields `selection.loopParent === true`
- the same node's iteration execution (`loop_ancestry` naming `loop`) yields no `loopParent`
- a `loop_group` body node whose ancestry names a different loop, with `node_type: 'prompt'`, yields no `loopParent`
- a `loop:` node nested in a `loop_group` body (`node_type: 'loop'`, `loop_ancestry: [{ node_id: 'outer-group', iteration: 2 }]`) yields no `loopParent` — its `node_id` repeats across outer iterations, so an unfiltered fetch would merge them
- a retried non-loop node yields no `loopParent`

### `execution-room-model.test.ts`

- `buildExecutionHeader` for a `loopParent` row returns `executionLabel: 'All iterations'`; the same row without the flag still returns `Attempt 1`

### `ConsoleInspectPane.test.tsx`

- `executionOptionsForNode` for a loop node's rows lists `All iterations` first (outer row, earliest `started_at`) followed by `Iteration 1`, `Iteration 2`; existing option-label assertions are adapted, not deleted

### `select-node-room-messages` (both copies: `NodeRoom.test.tsx` `selectNodeRoomMessages` describe block, Console `select-node-room-messages.test.ts`)

- a `loopParent` selection with `retryEpoch: 1` over rows from epochs 0 and 1 returns only epoch-1 rows plus metadata-less rows, in `seq` order; a `loopParent` selection with `retryEpoch` undefined behaves as epoch 0; a plain `occurrence` selection still returns every row

### `node-message-pages.test.ts`

- `selectionForNodeMessages` on a `loopParent` occurrence row returns `{ kind: 'node', rowId: row.id }`; on a plain occurrence row returns the occurrence selection with `attemptId` present only when provided; on `node` / `loop_iteration` / `route_iteration` rows returns `{ kind: 'node', rowId }`
- `nodeMessageScopeKey` for the mapped `loopParent` selection differs from the scope key of the same row's occurrence selection (so a cached page state from before the change never serves the new scope)

### `room-scroll-follow.test.ts`

- `holdScrollAt(createScrollFollow('running'), 120)` → `{ follow: false, pinToBottom: false, scrollTop: 120 }`; `holdScrollAt` on a completed state preserves the other fields

### `e2e/ui/agent-occurrence-navigation.spec.ts` (create; red)

Written now, green in Phase 3. Two tests, one per route, sharing a helper:

- `[P1] [V:occurrence.console] Console loop node groups iterations and navigates` — `archon.runHitlWorkflow()`, open run detail, open the `inspect-twice` log row, wait for the room, choose the option labelled `All iterations` in `getByLabel('Execution')`, expect `getByRole('heading', { name: 'Iteration 1' })` and `Iteration 2` visible, expect `getByLabel('Occurrence')` visible, select `Iteration 2`, expect `page.evaluate(() => document.activeElement?.textContent)` to be `Iteration 2` and the heading's bounding box to lie inside the `console-node-room-scroll` box, then select the `Iteration 1` chip in `Execution` and expect no heading and no `Occurrence` control.
- `[P1] [V:occurrence.legacy]` — the same on the Legacy route (`/workflows/runs/:id` legacy view; reuse the existing HITL legacy helpers), using `node-transcript-scroll`.

Both must fail on the first heading assertion against the current tree, and `(cd e2e && npm run typecheck)` must pass.

## Implementation steps

1. Preflight: `git status` clean; rebase onto `develop`; confirm no open PR touches `agent-history.ts` or `occurrence-groups.ts`.
2. Write the Tests-before cases; run the regression gate; confirm the one expected red.
3. Apply Refactor steps 1–6 in order; run the gate; all green.
4. Create `occurrence-groups.ts` with `groupByOccurrence` and `occurrenceLabel`; write its test file first and watch it fail on the missing module.
5. Implement grouping: iterate items in given order (callers already pass seq-ordered items; do not re-sort), `Map<string, OccurrenceGroup>` keyed by `occurrence_id`, a `pending: AgentHistoryItem[]` buffer for leading metadata-less items, `current: OccurrenceGroup | null` for attachment. After the loop, compute `failed` per group from lifecycle items, then `label` via `occurrenceLabel`. `headers = groups.filter(g => g.key !== null).length >= 2`.
6. Write the remaining Tests-after cases and make them green.
7. Write the E2E spec; run `npm run typecheck` in `e2e/`; run the spec once to record the expected red in the report.
8. Type-check and lint the package; commit as `feat(web): group agent history by occurrence` (no plan or story references in the message body beyond `Refs #180`).

## Todo

- [ ] Tests-before written and green (except the missing export)
- [ ] `execution` on all item variants, fixtures adapted
- [ ] `selectionForNodeMessages` replaces four helpers
- [ ] `loopParent` in both `build-log-rows.ts` + `ExecutionRowSelection`; `All iterations` label
- [ ] `holdScrollAt` added
- [ ] `occurrence-groups.ts` + full test table green
- [ ] E2E spec compiles and is red on the heading assertion
- [ ] `bun run type-check` and `bun run lint` green in `packages/web`

## Test scenario matrix

| Priority | Scenario                                                      | Test file                                      |
| -------- | ------------------------------------------------------------- | ---------------------------------------------- |
| Critical | Non-contiguous outer occurrence groups once                   | `occurrence-groups.test.ts`                    |
| Critical | `headers` false for one occurrence                            | `occurrence-groups.test.ts`                    |
| Critical | `loopParent` only on the loop node's own execution            | both `build-log-rows.test.ts`                  |
| Critical | `selectionForNodeMessages` byte-for-byte for non-loop rows    | `node-message-pages.test.ts`                   |
| Critical | `loopParent` slice by `retry_epoch` (retried loop node)        | both `selectNodeRoomMessages` suites           |
| High     | `All iterations` first in Console `Execution` options         | `ConsoleInspectPane.test.tsx`                  |
| High     | Label table incl. suffix rules and forbidden words            | `occurrence-groups.test.ts`                    |
| High     | `execution` sourcing per item variant                         | `agent-history.test.ts`                        |
| High     | Scope key changes for the loop parent                         | `node-message-pages.test.ts`                   |
| Medium   | Malformed metadata treated as absent                          | `occurrence-groups.test.ts`, `agent-history.test.ts` |
| Medium   | `All iterations` chip label                                   | `execution-room-model.test.ts`                 |
| Medium   | `holdScrollAt` reducer                                        | `room-scroll-follow.test.ts`                   |

## Success criteria

- All commands in the regression gate and the Tests-after list pass; `agent-history.test.ts` fixtures differ from the pre-change tree only by the added `execution` field.
- `grep -rn "function selectionFromRow\|function nodeMessageSelectionFromRow" packages/web/src` returns nothing outside tests.
- `e2e/ui/agent-occurrence-navigation.spec.ts` type-checks and fails on the heading assertion.
- No file under `packages/core`, `packages/server`, `packages/workflows`, or `migrations` changed.

## Risk assessment

- **Fixture churn in `agent-history.test.ts`** (25 deep-equal sites): mechanical but easy to get subtly wrong; do it with the Tests-before pin in place so a wrong edit fails loudly.
- **Scope-key collision:** the loop parent's page state must not reuse a cached occurrence-scoped state. The `nodeMessageScopeKey` test above pins that the keys differ; `NodeTranscriptPane` and `ConsoleNodeRoom` already reset state on scope change.
- **Malformed legacy metadata:** guarded by `executionFrom`; a row with `execution` but no `occurrence_id` is treated as metadata-less.

## Security considerations

Labels are composed from integers and fixed words; occurrence ids are server-minted UUIDs and are used as `<option value>` only, never as DOM ids or text. No agent-authored string reaches a label.

## Dependency map

- Feeds Phase 2: `groupByOccurrence`, `OccurrenceGroup`, `holdScrollAt`, `selectionForNodeMessages`.
- Feeds Phase 3: the red E2E spec and the `All iterations` option label it selects.

## Next steps

Phase 2 renders the groups in both shells. Before starting it, re-scout `NodeRoom.tsx`, `ConsoleAgentHistoryList.tsx`, and their tests for changes landed by Stories 1.3/1.4/1.6.
