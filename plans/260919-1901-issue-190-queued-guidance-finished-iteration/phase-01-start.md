---
title: 'Phase 1: Ratify authority and build the shared execution and dock core'
status: ready
priority: P1
effort: '4h after the decision gates clear'
dependencies: []
gate: 'B1 and B2 approved and recorded in plan.md (cleared 2026-09-20)'
---

# Phase 1: Ratify authority and build the shared execution and dock core

## Goal

Resolve the two contradictions that determine the feature's behavior, align the
canonical product/design records, then add the framework-free execution-lineage
resolver and steering-dock primitives used by both UI shells.

Do not write implementation code or implementation tests until both B1 and B2 are
approved in [plan.md](./plan.md)'s Validation Log. A rejected or materially changed
decision requires this plan to be revised first.

## Verified context

- Story 2.10 lives in
  `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md`.
- CAP-6 in `_bmad-output/specs/spec-agent-node-room/SPEC.md` and
  `control-states.md` call the entry point a Story 1.7 iteration selector and say
  the finished view makes no steering-route call.
- AD-7 in the readable-transcript architecture spine and shipped code establish
  that Story 1.7 `Jump to` is scroll-only and absent from modern occurrence rooms.
  `EXPERIENCE.md` separately assigns occurrence filtering to the `Execution`
  controls.
- AD-13 is already occupied. The next free number was AD-16 when this plan was
  reviewed; re-scan all `## AD-` headings immediately before adding a decision.
- The final steering mockup has no finished-iteration state. `DESIGN.md` requires
  the 460px authority width but does not decide how the long disclosure and button
  fit there.
- Server occurrences retain `retry_epoch`, full `loop_ancestry`, and
  `route_activation_seq`. Both web `build-log-rows.ts` copies currently discard
  all ancestry except the final iteration number.
- Event-fallback rows cannot prove retry, route, or nested-loop identity and must
  remain readable without gaining this dock state.
- `startQueuePolling()` already serializes queue reads and applies the correct
  retry/stop classification, but has no error callback for a read-only renderer.

## Required decisions and documentation gate

1. Record B1's approved entry point and request semantics:
   - add a new readable-transcript AD using the next free number and back-reference
     it from AD-7;
   - name `Execution` selection (header select, Logs row, or graph occurrence) as
     the occurrence-switching entry point, leaving Story 1.7 `Jump to` scroll-only;
   - define “no steering request” as no send, withdraw, or interrupt **mutation**;
     the existing authenticated node-scoped `GET .../queue` is allowed;
   - describe the band as the node's shared pending queue across operators/tabs,
     matching Story 2.9, rather than implying it contains only this viewer's rows;
   - update the same rule in `epics.md`, `SPEC.md`, `control-states.md`, and
     `EXPERIENCE.md` so no canonical source retains the contradicted wording.
2. Record B2's approved 460px arrangement in `DESIGN.md` and `EXPERIENCE.md`.
   Recommended: full visible disclosure may wrap, Go button remains fully visible
   and at least 32px high, no horizontal overflow, queue band below. If elision is
   chosen instead, document the exact visible string and complete accessible name.
3. Record approval, date, approver, and final wording in `plan.md`'s Validation Log.

These are product/design changes, not incidental implementation notes. Update the
authorities together before code so tests can assert one unambiguous contract.

## Implementation contract

### 1. Preserve execution lineage on both row projections

Add the shared structural type beside `ExecutionRowSelection` in
`packages/web/src/lib/execution-room-model.ts`:

```ts
export interface ExecutionLoopAncestryEntry {
  readonly nodeId: string;
  readonly iteration: number;
}
```

Add `loopAncestry?: readonly ExecutionLoopAncestryEntry[]` to the `occurrence` arm
of `ExecutionRowSelection` and both local `LogRowSelection` copies. Map every wire
`loop_ancestry` entry from `{ node_id, iteration }` to `{ nodeId, iteration }` in:

- `packages/web/src/components/workflows/build-log-rows.ts`
- `packages/web/src/experiments/console/components/inspect/build-log-rows.ts`

Keep the existing final `iteration` field and labels for compatibility. Do not
change the server schema, OpenAPI output, old event fallback, or row ids.

### 2. Resolve a finished iteration only from proven identity

Add `resolveFinishedIterationView()` beside `chooseExecutionForNode()` in
`execution-room-model.ts`; execution selection and lineage belong there, not in
`steering-dock.ts`.

```ts
export interface FinishedIterationView {
  readonly liveRowId: string;
  readonly liveIteration: number;
}
```

The pure resolver receives all rows, selected row, current node status, and run
liveness. It returns non-null only when:

1. the run is live and the projected node status is `running` or `awaiting`;
2. the selected row is a server `occurrence`, has non-empty full ancestry, is
   known-scope and `completed`, and its displayed iteration equals its final
   ancestry iteration;
3. a known-scope candidate for the same `nodeId` is `running` or `awaiting`, has
   non-empty full ancestry whose final iteration agrees with its displayed
   iteration, and has an iteration greater than the selected iteration;
4. selected and candidate have the same normalized retry epoch (`retryEpoch ?? 0`),
   exactly the same optional route activation (including both being absent), the
   same final ancestry `nodeId`, and the same ancestry prefix before the final
   entry (both `nodeId` and `iteration` for every prefix entry).

Prefer `awaiting`, then `running`, then greatest `order` inside the chosen status,
matching the existing live-row preference. Never fall back to a terminal row.
This permits top-level `loop:` rows and a repeated body node inside `loop_group:`
without crossing an outer-loop invocation, retry, or route activation.

Fail closed for `node`, `loop_iteration`, `route_iteration`, selected or candidate
unknown-scope, empty ancestry, malformed ancestry/final-iteration disagreement,
same/earlier iteration, terminal node/run, and old event-fallback rows.

### 3. Add the shared dock mode and exact copy

In `packages/web/src/lib/steering-dock.ts`:

- add `finished-iteration` to `SteeringDockMode`;
- export exact disclosure and Go-label helpers from the ratified copy;
- accept `finishedIteration?: FinishedIterationView | null` in
  `steeringDockMode()` with this precedence:

```ts
if (!input.live) return 'hidden';
if (input.finishedIteration !== null && input.finishedIteration !== undefined) {
  return 'finished-iteration';
}
if (input.rowStatus !== 'running' && input.rowStatus !== 'awaiting') return 'hidden';
// Existing blocked -> detached -> composer behavior is unchanged.
```

The resolver, not the mode function, proves whether the descriptor is valid.

### 4. Surface only actionable polling failures

Extend `QueuePollingOptions` with an optional callback receiving the normalized
`SteeringSendError`. Call it once per failed read before the existing retry/stop
decision; callers that omit it behave exactly as today.

- 422 `not_steerable_here`: the finished renderer may show the existing detached
  disclosure and must clear its displayed read-only snapshot; polling continues.
- the next 200 clears the read error and replaces the snapshot.
- network/transport and 5xx: keep retrying silently in the UI; the last successful
  snapshot may remain visible.
- 409: notify then stop as today, clear the read-only snapshot, never call it
  detached; the normal run refresh removes the dock when terminal state arrives.
- other non-retryable 4xx: notify and stop; do not invent new user copy in this
  story.

Do not alter send/withdraw refusal state, draft persistence, queue generation, or
the polling cadence.

## Test-first matrix

Write focused failing tests before each implementation slice.

### Both build-log-row suites

- full one-entry and nested `loop_ancestry` map to camel case without losing order;
- existing final iteration, route, retry, id, status, and label stay unchanged;
- event-fallback rows do not fabricate ancestry.

### `execution-room-model.test.ts`

- completed ×1 + live ×2 in the same top-level lineage resolves ×2;
- a `loop_group` body row with the same parent ancestry resolves its later row;
- selected live row, non-live run, terminal node, no later live candidate, and
  only-terminal candidates return null;
- `node`, event-fallback `loop_iteration`, route-only, outer occurrence, retry-only,
  selected/candidate unknown scope, empty ancestry, malformed selected/candidate
  final iteration, and earlier candidate return null;
- different retry epoch, route activation, final loop node, or nested ancestry
  prefix returns null;
- `undefined` and retry epoch 0 compare as the same initial retry; route activation
  absence does not compare equal to a numeric value;
- awaiting is preferred to running, then latest `order`; no terminal fallback.

### `steering-dock.test.ts`

- a valid descriptor on a completed row selects `finished-iteration` before the
  terminal-row hide check;
- non-live still hides and all existing visibility-table rows are unchanged when
  the descriptor is absent;
- copy is verbatim to the updated authority;
- 422, 409, network, 5xx, success-after-422, cleanup, and non-overlap retain the
  documented callback/retry semantics.

## Files

- `packages/web/src/lib/execution-room-model.ts`
- `packages/web/src/lib/execution-room-model.test.ts`
- both `build-log-rows.ts` files and their existing tests
- `packages/web/src/lib/steering-dock.ts`
- `packages/web/src/lib/steering-dock.test.ts`
- the six canonical documents named in the gate above

No server route, generated API declaration, workflow schema, database, migration,
provider, or executor file changes belong to this phase.

## Validation

Run the narrowest suites first, from `packages/web`:

```bash
bun test src/lib/execution-room-model.test.ts
bun test src/lib/steering-dock.test.ts
bun test src/components/workflows/build-log-rows.test.ts
bun test src/experiments/console/components/inspect/build-log-rows.test.ts
```

Then run the web package's configured type-check, lint, and test scripts from the
repository root. Use the actual `package.json` scripts rather than inventing a
filter command. Verify all changed document claims and links against source.

## Exit criteria

- B1/B2 are ratified in every owning authority with no residual contradiction.
- Both row projections retain full lineage.
- The resolver fails closed unless same-lineage liveness is proven.
- The new mode and poll callback preserve every existing steering behavior.
- Focused tests, web type-check, lint, and package tests pass.

## Risks and rollback

- The main safety risk is steering context confusion; exact lineage comparison and
  failure-closed fallbacks are the mitigation.
- The callback is optional, so rollback can remove the new resolver/mode/mapping
  without changing the queue endpoint or persisted state.

## Next phase

Phase 2 threads the verified descriptor through Legacy and Console and implements
the approved visual/focus behavior.
