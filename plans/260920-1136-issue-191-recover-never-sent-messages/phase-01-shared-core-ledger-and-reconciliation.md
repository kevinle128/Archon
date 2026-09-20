---
phase: 1
title: 'Phase 1: Shared core — observed ledger, reconciliation, finished mode'
status: done
priority: P1
effort: '4h'
dependencies: []
---

# Phase 1: Shared core — observed ledger, reconciliation, finished mode

## Goal

Extend the framework-free steering dock state so both shells can remember all
receipts this mounted attempt has observed, compare them deterministically
with written operator rows, preserve pending/draft input, and select a
finished mode only when its caller supplies a raw node-terminal evidence
signal.

## Files

- Modify `packages/web/src/lib/steering-dock.ts`.
- Modify `packages/web/src/lib/steering-dock.test.ts` first.

Do not create an E2E skeleton: `test.fixme` is skipped, not a failing
outside-in test. Phase 4 creates and runs the real specification.

## Test-first matrix

| ID    | Test                                              | Required assertion                                                                                                                                                                                     |
| ----- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T1.1  | constructor initializes terminal state            | `observedLedger` is `[]`; `neverSent` is `null`.                                                                                                                                                       |
| T1.2  | local guidance successes are observed once        | Successful Queue responses append in acceptance order; replay of an id does not duplicate it.                                                                                                          |
| T1.3  | Send-now success observes its new receipt         | Prior observed ids remain; the newly accepted batch entry is present even though visible `sent` drains.                                                                                                |
| T1.4  | valid shared snapshot extends observation history | Snapshot rows from another tab append in snapshot order and visible `sent` follows the snapshot.                                                                                                       |
| T1.5  | later omission does not erase history             | After snapshot `[A]`, snapshot `[]` keeps `A` in `observedLedger` while clearing `sent`. This is the core cross-tab regression.                                                                        |
| T1.6  | stale generation is inert                         | A stale snapshot changes neither ledger nor `sent`.                                                                                                                                                    |
| T1.7  | own confirmed withdraw removes history            | Withdrawing `A` removes only `A`; unknown id is a no-op.                                                                                                                                               |
| T1.8  | failure/interrupt transitions preserve history    | Guidance/send-now/withdraw failures and interrupt transitions retain the same ledger reference.                                                                                                        |
| T1.9  | reconcile restores unmatched observed ids         | Observed `[A,B]`, written `{A}` produces only exact `{B,textB}`.                                                                                                                                       |
| T1.10 | reconcile handles a vanished shared snapshot      | Shared `A` was observed, later queue is empty, written empty: `A` is restored.                                                                                                                         |
| T1.11 | written ids remove all delivered candidates       | All observed ids written produces `neverSent: []`, not `null`.                                                                                                                                         |
| T1.12 | unmatched pending submission is restored          | `pendingRetry R` not observed or written follows observed candidates with id/text intact.                                                                                                              |
| T1.13 | written/observed pending is not duplicated        | If `R` is written, omit it; if it is already observed, list it once.                                                                                                                                   |
| T1.14 | a different raw draft follows pending             | Pending `old`, draft `'  new text  '` produces both in order and preserves whitespace; whitespace-only adds nothing.                                                                                   |
| T1.15 | unchanged pending/draft is one item               | Pending and raw draft with identical text produce only the identified pending entry.                                                                                                                   |
| T1.16 | in-flight edit loses nothing                      | Prior observed receipts + unmatched pending submission + differently edited draft all appear once in that order.                                                                                       |
| T1.17 | reconciliation is idempotent/pure                 | Second call returns the identical state; sent, pending-retry, refusal, notice, and every unrelated state field retain identity/value.                                                                  |
| T1.18 | finished mode requires explicit node terminal     | Nonempty result + `nodeTerminal:true` selects `finished` even when the selected row is an older completed iteration; `live:false` or terminal-looking selected row with `nodeTerminal:false` does not. |
| T1.19 | empty/unreconciled result preserves old table     | `[]` and `null` do not override composer/blocked/hidden/detached/finished-iteration behavior.                                                                                                          |
| T1.20 | copy and accessible labels are exact              | Lowercase heading `never sent · n`, `Never sent, n`, and exact disclosure constant.                                                                                                                    |
| T1.21 | queue-observer mode does not decide terminality   | A prior composer, blocked, or finished-iteration mode cannot select `finished` until the explicit node-terminal input is true.                                                                         |
| T1.22 | written-id extractor is strict                    | Collect only text rows with `metadata.origin === 'operator'` and a valid `metadata.message_id`; ignore assistant/tool/malformed rows.                                                                  |

Use existing `bun:test` conventions. Build narrow `NodeMessageRow` fixtures
using the real type; if generated fields require an assertion, explain why it
is safe immediately beside the assertion.

## Implementation steps

1. Add `NeverSentEntry`, `observedLedger`, `neverSent`, and `'finished'` to
   the existing types. `messageId` is `string | null`; only a raw unsent draft
   lacks an id.
2. Add a small local append-if-new helper keyed by `messageId`. Do not create a
   new module or generalized collection abstraction.
3. Populate the ledger from both local success functions and every
   generation-valid `applyQueueSnapshot`. Update visible `sent` exactly as it
   works today. Ensure a stale generation returns before either change.
4. Remove an id from both visible state and observed history only after this
   tab's successful withdraw. All other transitions preserve history.
5. Implement one-shot `reconcileNeverSent` exactly in this order:
   observed-unwritten rows; pending retry if neither observed nor written;
   current raw nonblank draft if it differs from pending text. Deduplicate
   identities, preserve raw strings, and write `[]` when nothing qualifies.
6. Make `steeringDockMode` choose `finished` only for a nonempty result plus
   `nodeTerminal:true`. Selected-row status and run liveness are not terminal
   proof; Phase 3 supplies the event-backed input.
7. Add `collectWrittenOperatorMessageIds`, the disclosure constant, and
   heading/list-label helpers. Keep DOM source copy lowercase where specified.
8. Keep functions pure and state readonly. Do not add persistence, fetches,
   timers, server types, or lifecycle mutation.

## Verification

```bash
bun test packages/web/src/lib/steering-dock.test.ts
bun --filter @archon/web type-check
bun x eslint packages/web/src/lib/steering-dock.ts packages/web/src/lib/steering-dock.test.ts --max-warnings 0
```

Pass condition: T1.1–T1.22 and all existing core tests pass; typecheck and
focused lint have zero errors/warnings.

## Rollback

Revert the two files. There is no storage, API, or data migration.
