---
phase: 3
title: 'Phase 3: Post-terminal transcript drain gate in both panes'
status: pending
priority: P1
effort: '3h'
dependencies: [1, 2]
gate: 'Phase 2 green in both dock test files'
---

# Phase 3: Post-terminal transcript drain gate in both panes

## Goal

`NodeTranscriptPane` (Legacy) and `ConsoleNodeRoom` (Console) hand the dock a
`writtenOperatorMessageIds` set **only** after (a) the node was observed
terminal — row status `completed | failed | skipped`, or the run no longer
live — and (b) a transcript drain that **started after** that observation
completed successfully. Every live refetch, and the drain that straddles the
terminal transition, leaves the prop `null`. This is the mechanical
embodiment of AC2 and of AD-11's "never on a live refetch".

## Scout checklist (deep mode — re-verify before editing)

- [ ] `NodeTranscriptPane.tsx`: the drain effect (`runDrain`, `startState`,
      deps `[attemptId, loadMessages, nodeId, occurrenceId, onScrollTopChange, resolvedScopeKey, retryNonce, row, rowId, runId, runStatus]`)
      and the scope-reset effect (`prevScopeRef`). Confirm `rowStatus` is
      `row?.status ?? 'completed'` and `isLiveRunStatus(runStatus)` is the
      liveness predicate. Confirm `<ComposerDock … />` is the only dock mount.
- [ ] `ConsoleNodeRoom.tsx`: the equivalent drain effect (deps include
      `agentActive, isLive, nodeKey, …, row, rowId, run.id`), `rowStatus`,
      `isLive` prop, and the single `<ConsoleComposerDock … />` mount inside
      `agentActive && row !== null`.
- [ ] Both pane test files: the `beforeEach` `fetch` spy that answers
      `GET …/queue` with `{ success: true, queued: [] }` — make its payload
      configurable per test (a `let queuedPayload` the spy reads) so a test can
      seed the dock's shown queue.
- [ ] `node-message-pages.ts`: `NodeMessageState.complete` semantics (true
      after a full drain to the watermark) and that `drainNodeMessages`
      resolves the final state.

## Files to Create / Modify

- Modify: `packages/web/src/components/workflows/NodeTranscriptPane.tsx`
- Modify: `packages/web/src/components/workflows/NodeTranscriptPane.test.tsx` (tests first)
- Modify: `packages/web/src/experiments/console/components/ConsoleNodeRoom.tsx`
- Modify: `packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx` (tests first)

No change to `LegacyGraphLogsPane`, `LegacyNodeRoom`, `ConsoleInspectPane`,
or any API type: the panes already receive `runStatus`/`isLive`, the row, and
the transcript rows.

## Test-first design

These are end-to-end through the real dock (Phase 2), observing the DOM the
dock renders. Use the existing `renderPane` / `renderRoom` helpers, the
configurable queue `fetch` stub, and a `loadMessages` stub whose payload is
switchable between calls (a `let rows` the stub returns). Build operator rows
as `{ kind: 'text', seq, payload: { text }, metadata: { execution, origin: 'operator', operator_user_id: null, message_id } }`
matching the fixtures already used by the operator-row tests in these files.

### Test matrix (same names in both files)

| ID | Test name | Setup → assertion |
|----|-----------|-------------------|
| T3.1 | `does not reconcile on a live refetch that lacks an operator row` | row `running`, run `running`, queue stub `[m1]`, `loadMessages` rows without `m1` → after ≥2 poll ticks: composer present, no `Never sent` list, no alert. |
| T3.2 | `ignores the drain that straddles the terminal transition and reconciles from the fresh one` | Start as T3.1. Make `loadMessages` block on a deferred promise; while blocked, re-render with row `completed` (same row id). The effect re-runs on the `row` dep, **aborts** the straddling drain (`cancelled = true; controller.abort()`), and starts a fresh one. Resolve the old promise **without** `m1` → no list (its result is discarded); resolve the fresh drain without `m1` → list with `m1` and one alert. This test proves the abort path; do not change the effect deps to make it exercise the `startedAfterTerminal` flag instead. |
| T3.3 | `treats a cancelled run as terminal for every row shape` | row stays `running` (loop-occurrence shape), run `cancelled` → one final drain → list with `m1`. |
| T3.4 | `marks nothing when the post-terminal drain contains the operator row` | queue stub `[m1]`, terminal, post-terminal rows include operator row `m1` → dock renders nothing (no list, no alert, no field). |
| T3.5 | `a failed post-terminal drain leaves the dock hidden until Retry succeeds` | post-terminal `loadMessages` rejects → error UI, no list; press Retry with rows lacking `m1` → list appears. |
| T3.6 | `resets the reconciliation snapshot on scope change` | after T3.2, select another running row → composer, no list; the prop is `null` again (no stale ids leak across scopes). |
| T3.7 | `passes only operator message ids` | post-terminal rows include an assistant text row with `metadata.message_id: 'm1'` but no `origin` → list still shows `m1` (assistant ids are not deliveries). |

Both files also add:

| ID | Test name | Setup → assertion |
|----|-----------|-------------------|
| T3.8 | `a node completing inside a still-live run reconciles without a run-status change` | run `running`, row flips to `completed` (new row object, same id) → the effect re-runs, the fresh drain completes → list appears while the run is still live. |
| T3.9 | `a retry after a terminal reconciliation resets the written-ids prop to null` | after T3.2, re-render with row `running` (same id), run `running` → composer renders with no list; a later terminal + drain lacking a **new** id `m2` (queued after the retry) → list shows `m2` only. |

## Tasks & Steps

### Legacy — `NodeTranscriptPane.tsx`

1. Import `collectWrittenOperatorMessageIds` and `isTerminalNodeRowStatus`
   from `@/lib/steering-dock` and `type NodeMessageRow` from
   `@/lib/node-message-pages`.
2. Add
   ```ts
   const nodeTerminal = isTerminalNodeRowStatus(rowStatus) || !isLiveRunStatus(runStatus);
   const terminalRef = useRef(nodeTerminal);
   terminalRef.current = nodeTerminal;
   const [reconcileRows, setReconcileRows] = useState<readonly NodeMessageRow[] | null>(null);
   ```
   with the comment: "Story 2.11 — the dock may reconcile `sent` ids only
   against rows fetched after the node was seen terminal; a drain that began
   earlier can predate the executor's last operator-row write."
3. In `runDrain`, capture `const startedAfterTerminal = terminalRef.current;`
   as its first statement; after `drainNodeMessages` resolves and the
   cancellation checks pass, add
   `if (startedAfterTerminal && next.error === null && next.complete) setReconcileRows(next.rows);`.
4. In the scope-reset effect (`prevScopeRef`), add `setReconcileRows(null)`;
   add `useEffect(() => { if (!nodeTerminal) setReconcileRows(null); }, [nodeTerminal]);`
   with the comment "retry-node/resume re-runs this row; a stale snapshot must
   not feed the next reconciliation".
5. Derive `const writtenOperatorMessageIds = useMemo(() => reconcileRows === null ? null : collectWrittenOperatorMessageIds(reconcileRows), [reconcileRows]);`
   and pass `writtenOperatorMessageIds={writtenOperatorMessageIds}` to
   `<ComposerDock>`.
6. Docblock: extend the header comment with the terminal-gate sentence.

### Console — `ConsoleNodeRoom.tsx`

7. Mirror steps 1–6 using `isLive` for liveness and the room's `runDrain`;
   pass the prop to `<ConsoleComposerDock>`. Do not import anything from
   `components/workflows`.

### Tests

8. Make the `GET …/queue` stub payload configurable in both `beforeEach`
   blocks (default `[]`), and add the T3.x tests. Use deferred promises
   (`let resolveDrain: (rows) => void`) for T3.2 rather than timers.

## Verification

```bash
NODE_ENV=development bun test packages/web/src/components/workflows/NodeTranscriptPane.test.tsx
NODE_ENV=development bun test packages/web/src/experiments/console/components/ConsoleNodeRoom.test.tsx
bun test packages/web/src/experiments/console/console-isolation.test.ts
bun --filter @archon/web test && bun --filter @archon/web type-check && bun --filter @archon/web lint
```

Mechanical pass condition: T3.1–T3.9 pass, no pre-existing pane test
changed, full `@archon/web` suite green, zero warnings.

## Rollback

Revert the four files; the docks' new prop defaults to `null`, restoring the
Phase 2 behavior (box never appears) without breaking anything.
