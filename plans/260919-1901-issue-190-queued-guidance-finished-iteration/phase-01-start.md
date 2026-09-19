---
title: 'Phase 1: Record the reachability decision and add the shared dock core'
status: todo
priority: P1
effort: '3h'
dependencies: []
---

# Phase 1: Record the reachability decision and add the shared dock core

## Goal

Record decision D1 in its canonical homes, then add the framework-free mode,
copy, and resolver to `lib/steering-dock.ts` so both shells can render the
finished-iteration dock from one contract.

## Context links

- Plan index: [plan.md](./plan.md) — D1–D4.
- Story 2.10: `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md:704-728`.
- Dock state spec: `_bmad-output/specs/spec-agent-node-room/control-states.md:50-58`.
- AD-7 amendment (the blocker text this phase resolves):
  `_bmad-output/planning-artifacts/architecture/architecture-Archon-readable-agent-transcript-2026-09-12/ARCHITECTURE-SPINE.md:133`.
- Existing core: `packages/web/src/lib/steering-dock.ts:50-80` (`SteeringDockMode`,
  `steeringDockMode`), `:283-322` (`QueueSnapshot`, `applyQueueSnapshot`),
  `:380-445` (`startQueuePolling`).
- Row shapes: `packages/web/src/components/workflows/build-log-rows.ts:14-40` and
  the Console copy `packages/web/src/experiments/console/components/inspect/build-log-rows.ts:13-40`
  (identical `LogRowSelection`; `occurrence.iteration` comes from the last
  `loop_ancestry` entry).
- Live-row preference precedent: `packages/web/src/lib/execution-room-model.ts:132-148`
  (`chooseExecutionForNode`: awaiting → running → latest by `order`).

## Scout pass before execution (deep mode)

- Confirm how a `loop_group:` body node's rows reach the browser: the executor tags
  body lifecycle rows with the iteration (`dag-executor.ts:1983` comment); verify in
  `workflow-execution-history.ts` and `build-log-rows.ts:99-112` that they arrive as
  `selection.kind === 'occurrence'` with `iteration`, and record the finding beside
  the `loop_group` test fixture. <!-- Red team 2026-09-20: Finding 5 -->

## Key insights (scouted)

- `steeringDockMode()` hides the dock whenever `rowStatus` is terminal
  (`steering-dock.ts:76`). A finished iteration's `LogRow.status` is `completed`,
  so today the whole dock disappears — the story's dock state is unreachable
  until the mode function learns about the node-level live status.
- The node-level live status is already available at both mount points:
  Legacy passes `nodeState` (`LegacyGraphLogsPane.tsx:508-512` →
  `NodeTranscriptPane` prop `nodeState`); Console has `nodeStates`
  (`ConsoleNodeRoom.tsx:708-709`).
- A running `loop:` node has an **outer** occurrence row with no `iteration` plus
  one row per iteration (the #180 plan observed 7 occurrences for 6 iterations).
  The resolver must prefer rows that carry `iteration`, or `Go to iteration N`
  would target the outer lifecycle row.
- The statuses come from `workflow-execution-history.ts:77-81`
  (`loop_iteration_completed` → `completed`, `loop_iteration_started` → `running`),
  so a finished iteration and the live iteration are distinguishable from
  `LogRow.status` alone.
- `startQueuePolling` treats `422`/network/5xx as retryable and `409` as terminal
  (`steering-dock.ts:403-408`) and today swallows the error; the read-only mode
  needs the small `onRefusal` hook (Doc records item 4) so a `422` is visible.
- The Story 1.7 `Jump to` navigator (`NodeTranscriptPane.tsx:473-497`,
  `ConsoleNodeRoom.tsx:960-984`) renders only on historical/fallback node-scoped rows
  that carry several occurrences — never on a modern loop's occurrence rows (AD-7
  B1). Where it renders it scrolls and focuses a heading and never changes `row`, so
  that path keeps the live composer (regression case, not a loop case).

## Requirements

- [ ] **GATE — owner ratification of D1.** Do not write the AD-7 amendment, the
      `control-states.md` edit, or any Phase 2 code until the plan owner has answered
      validation question 1 in `plan.md` with an explicit approval recorded under
      `## Validation Log`. If D1 is rejected, this phase stops after the core tests
      and the plan is revised; Phases 2–3 do not start.
- [ ] D1 recorded as a **new AD** (AD-13, readable-transcript spine) naming the
      Execution selection as the entry point and the navigator as scroll-only, with a
      one-line back-reference appended to AD-7's B1 amendment. <!-- Red team 2026-09-20: Finding 7 -->
- [ ] `control-states.md` "Viewing a finished iteration of a live loop node" gains one
      sentence naming the entry point and the mutation-free client contract
      (`GET …/queue` allowed).
- [ ] `SteeringDockMode` includes `'finished-iteration'`; `steeringDockMode()` returns
      it only under the D1 predicate and keeps every existing row of its visibility
      table unchanged.
- [ ] `resolveFinishedIterationView()` (pure) returns `{ liveRowId, liveIteration }`
      or `null` from a structural row list, the selected row, the node live status,
      and the run-live flag.
- [ ] Copy constants exported: disclosure line and `Go to iteration N` label, exact
      to `control-states.md:54`.
- [ ] No server, API type, or schema change.

## Architecture

```ts
// lib/steering-dock.ts (additions)
export type SteeringDockMode =
  | 'hidden' | 'blocked' | 'detached' | 'composer' | 'finished-iteration';

export interface FinishedIterationView {
  /** LogRow id of the live iteration — the `Go to iteration N` target. */
  readonly liveRowId: string;
  readonly liveIteration: number;
}

/** Minimal structural row both shells' LogRow types satisfy without casts. */
export interface IterationRowLike {
  readonly id: string;
  readonly nodeId: string;
  readonly status: string;
  readonly order: number;
  readonly selection:
    | { readonly kind: 'occurrence'; readonly iteration?: number; readonly retryEpoch?: number }
    | { readonly kind: 'loop_iteration'; readonly iteration: number }
    | { readonly kind: string };
}

export function resolveFinishedIterationView(input: {
  rows: readonly IterationRowLike[];
  selectedRow: IterationRowLike | null;
  nodeStatus: string | undefined;   // WorkflowNodeStateResponse['status']
  live: boolean;
}): FinishedIterationView | null;

export function steeringDockMode(input: {
  rowStatus: string;
  live: boolean;
  hasPendingAsk: boolean;
  refusal: SteeringRefusal | null;
  finishedIteration?: FinishedIterationView | null;
}): SteeringDockMode;

export function finishedIterationDisclosure(liveIteration: number): string;
// 'reading a finished iteration · the agent is working in iteration N'
export function goToIterationLabel(liveIteration: number): string;
// 'Go to iteration N'
```

Predicate order inside `resolveFinishedIterationView`:

1. `live === false` → `null`.
2. `selectedRow === null` or `iterationOf(selectedRow) === undefined` → `null`
   (retry attempts, plain node rows, route iterations never qualify).
3. `selectedRow.status` not in `completed | failed | skipped` → `null`.
4. `nodeStatus` not in `running | awaiting` → `null`.
5. Candidates = rows with the same `nodeId`, the **same `retryEpoch`** as the
   selected row (both `undefined`, or equal — a retried loop node's new epoch is a
   different execution and never a target; `build-log-rows.ts:104-110` populates the
   field), an iteration number, and status `awaiting` or `running`; pick `awaiting`
   first, else `running`, latest by `order`. This borrows only the
   awaiting-then-running preference of `chooseExecutionForNode`
   (`execution-room-model.ts:132-148`); it deliberately does **not** copy that
   function's unconditional `latestByOrder` fallback — with no non-terminal candidate
   the resolver returns `null` (iteration boundary, D4), never a terminal row.
   Provisional pending validation question 4. <!-- Red team 2026-09-20: Findings 13, 15, 16 -->
6. Candidate id equals the selected row id → `null` (defensive; step 3 already
   excludes it).

Mode precedence inside `steeringDockMode`:

```ts
if (!input.live) return 'hidden';
if (input.finishedIteration) return 'finished-iteration';   // before the rowStatus check
if (input.rowStatus !== 'running' && input.rowStatus !== 'awaiting') return 'hidden';
… existing blocked / detached / composer …
```

A stored send/withdraw `refusal` never changes the finished-iteration **mode** (no
mutation is issued from it). A **read** refusal (`onRefusal`, Doc records item 4) is
stored separately and only adds the `not steerable here` line under the disclosure;
it does not switch the mode to `detached`.

## Related code files

- Modify: `packages/web/src/lib/steering-dock.ts`
- Modify: `packages/web/src/lib/steering-dock.test.ts`
- Modify: `_bmad-output/planning-artifacts/architecture/architecture-Archon-readable-agent-transcript-2026-09-12/ARCHITECTURE-SPINE.md` (new AD-13 + one-line back-reference on AD-7)
- Modify: `_bmad-output/specs/spec-agent-node-room/control-states.md` (lines 50-58)

## Tests before (TDD — write first, watch them fail)

Add to `packages/web/src/lib/steering-dock.test.ts`, after the
`describe('steeringDockMode visibility table', …)` block:

```ts
describe('resolveFinishedIterationView', () => {
  const outer = { id: 'exec:loop:outer', nodeId: 'loop', status: 'running', order: 0, selection: { kind: 'occurrence' } };
  const it1   = { id: 'exec:loop:1', nodeId: 'loop', status: 'completed', order: 1, selection: { kind: 'occurrence', iteration: 1 } };
  const it2   = { id: 'exec:loop:2', nodeId: 'loop', status: 'running',   order: 2, selection: { kind: 'occurrence', iteration: 2 } };

  test('finished iteration of a running loop node resolves to the live iteration row', …); // → { liveRowId: 'exec:loop:2', liveIteration: 2 }
  test('the live iteration itself resolves to null', …);
  test('non-live run resolves to null', …);
  test('retry attempt rows (no iteration) resolve to null', …);            // selection { kind:'occurrence', retryEpoch: 0 }
  test('plain node row (historical node-scoped path) resolves to null', …);  // selection { kind:'node' }
  test('second run / retry attempt of the same node resolves to null (AC 5)', …); // selection { kind:'occurrence', retryEpoch: 1 }, no iteration
  test('awaiting live iteration is preferred over a running one', …);
  test('outer occurrence row (no iteration) is never the target', …);      // only `outer` non-terminal → null
  test('event-fallback loop_iteration rows qualify the same way', …);
  test('terminal node status resolves to null even with a finished iteration selected', …);
  test('candidates are scoped to the selected nodeId', …);                 // other node's running iteration ignored
  test('candidates are scoped to the selected retryEpoch', …);             // epoch 0 ×2 completed selected; epoch 1 ×1 running → null
  test('only terminal or pending rows for the node resolve to null, never the latest row', …); // guards against porting chooseExecutionForNode's fallback
  test('loop_group body rows tagged with an iteration qualify like loop rows', …); // fixture from a loop_group body node; scout confirms the row shape first
});

describe('startQueuePolling onRefusal', () => {
  test('a 422 read invokes onRefusal with code not_steerable_here and keeps polling', …);
  test('a 409 read invokes onRefusal and stops', …);
  test('a network failure invokes onRefusal with code null and keeps polling', …);
});

describe('steeringDockMode finished-iteration precedence', () => {
  test('finishedIteration on a completed row yields finished-iteration, not hidden', …);
  test('finishedIteration on a non-live run still hides', …);
  test('a stored detached refusal does not override finished-iteration', …);
  test('existing table rows are unchanged when finishedIteration is null or omitted', …);
});

describe('finished-iteration copy', () => {
  test('disclosure and control copy match control-states.md verbatim', () => {
    expect(finishedIterationDisclosure(3)).toBe('reading a finished iteration · the agent is working in iteration 3');
    expect(goToIterationLabel(3)).toBe('Go to iteration 3');
  });
});
```

Run: `cd packages/web && bun test src/lib/steering-dock.test.ts` — expect the new
cases to fail on missing exports.

## Refactor (protected changes)

1. Extend `SteeringDockMode` and `steeringDockMode()` exactly as in Architecture;
   update the docblock's precedence sentence with the new first clause.
2. Add `FinishedIterationView`, `IterationRowLike`, `resolveFinishedIterationView`,
   `finishedIterationDisclosure`, `goToIterationLabel`. Keep them beside the
   visibility helpers (`:50-96`) so the mode contract reads top-down.
3. Add the optional `onRefusal` hook to `startQueuePolling` (Doc records item 4);
   do not otherwise touch `applyQueueSnapshot`, draft persistence, or the refusal
   helpers.

## Tests after (new behaviour)

- All new cases green; the pre-existing visibility-table cases untouched and green.
- `bun test src/lib/steering-dock.test.ts` shows no skipped tests.

## Doc records (part of this phase, before Phase 2 starts)

1. Add a new AD after the last one in the readable-transcript spine — "AD-13 —
   Finished-iteration reachability for steering (2026-09-2x, issue #190 decision D1)"
   — with Binds (Story 2.10 / CAP-8), Prevents (a second entry-point invented per
   shell), and Rule: "Story 2.10's finished iteration is reached through the Execution
   selection (header select, Logs list, graph occurrence rows) switching the room to a
   terminal iteration-scoped row while the node's live projection is
   `running`/`awaiting`; this reinterprets the AC's 'selected through Story 1.7' —
   the navigator is scroll-only, never renders for modern loop occurrence rows (AD-7
   B1), and is not an entry point. The steering dock's mode function, not the
   transcript, owns the resulting read-only state." Append to AD-7's B1 amendment:
   "Resolved by AD-13 (2026-09-2x)." <!-- Red team 2026-09-20: Finding 7 -->
2. In `control-states.md:50-58` add, after the first bullet: "Entry point: the
   Execution selection (the `Jump to` navigator scrolls within a node-scoped transcript
   and never switches iteration). The client issues no send/withdraw/interrupt request
   here; the band's `GET …/queue` read is the one request it makes."
3. In the same section correct the pre-Story-2.9 phrase "the operator's still-pending
   messages" to "every operator's still-pending messages for this node (the shared
   registry queue of Story 2.9)" — the band exposes the cross-operator, cross-tab
   queue, and the spec must say so. <!-- Red team 2026-09-20: Finding 2 -->
4. Read-failure signal: extend `QueuePollingOptions` with an optional
   `onRefusal?: (refusal: SteeringRefusal) => void` invoked from `settle()` before the
   retry decision; the finished-iteration dock stores a `422 not_steerable_here`
   refusal from a **read** and renders `STEERING_DETACHED_DISCLOSURE` under the
   disclosure line instead of an indistinguishable empty band. Composer/blocked
   modes ignore `onRefusal` (their detached transition stays send-triggered).
   <!-- Red team 2026-09-20: Finding 4 -->

## Todo

- [ ] Write the failing tests listed above.
- [ ] Implement the core additions.
- [ ] GATE: D1 approval recorded under `## Validation Log` in `plan.md` (stop here if absent).
- [ ] Record D1 as AD-13 in the spine and update `control-states.md`.
- [ ] `cd packages/web && bun test src/lib/` green; `bun run lint` and
      `bun run type-check` green for `@archon/web`.

## Success criteria

- `steeringDockMode` and `resolveFinishedIterationView` cover every row of the plan's
  test matrix tagged Phase 1.
- D1 text is present in both canonical documents and cites Story 2.10 / issue #190.

## Regression gate

```bash
cd packages/web && bun test src/lib/steering-dock.test.ts
bun run type-check && bun run lint
```

## Risk assessment

- Structural `IterationRowLike` too loose → a Console `LogRow` with `kind:'loop_iteration'`
  satisfies it by shape; the union keeps `iteration` typed on both qualifying kinds.
- Preferring `awaiting` over `running` could target an iteration blocked on an Ask;
  that is the live iteration by definition and matches `chooseExecutionForNode`.

## Security considerations

None new: read-only client logic; no credentials or request bodies.

## Next steps

Phase 2 threads the resolver output through both shells and renders the mode.
