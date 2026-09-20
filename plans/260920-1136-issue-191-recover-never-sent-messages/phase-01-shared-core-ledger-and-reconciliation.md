---
phase: 1
title: 'Phase 1: Shared core — accepted ledger, terminal reconciliation, finished mode'
status: pending
priority: P1
effort: '3h'
dependencies: []
---

# Phase 1: Shared core — accepted ledger, terminal reconciliation, finished mode

## Goal

Extend the framework-free `steering-dock.ts` core so both shells can restore
undelivered guidance from data they already hold: a tab-local accepted
ledger, a pure `reconcileNeverSent` transition, a `finished` dock mode that
outranks every visibility check while the row is still terminal, the exact
copy/label helpers, and the two
predicates the panes need (`isTerminalNodeRowStatus`,
`collectWrittenOperatorMessageIds`). No React, no fetch, no storage.

## Files to Create / Modify

- Modify: `packages/web/src/lib/steering-dock.ts`
- Modify: `packages/web/src/lib/steering-dock.test.ts` (tests first)
- Create: `e2e/ui/agent-never-sent.spec.ts` as a `test.fixme` skeleton
  carrying the Phase 4 test titles and step comments only (red by
  construction; Phase 4 fills it in and removes `fixme`). A Ralph loop cannot
  check out an older tree, so this is how the outside-in tests exist before
  the behavior does.

No other file changes. `ComposerDock.tsx` and `ConsoleComposerDock.tsx` keep
compiling because every new state field is initialised by
`createSteeringDockState` and every new function input is optional.

## Test-first design

Write these tests before touching `steering-dock.ts`; run
`bun test packages/web/src/lib/steering-dock.test.ts` and confirm the new
`describe` blocks fail (missing exports / wrong shapes), then implement.

### Test matrix

| ID | Describe block / test name | Assertion |
|----|----------------------------|-----------|
| T1.1 | `accepted ledger` › `resolveGuidanceSuccess appends the receipt once in acceptance order` | Two 200s → `acceptedLedger` has both ids in order; replaying the first 200 leaves length 2. |
| T1.2 | `accepted ledger` › `resolveSendNowSuccess appends the new draft receipt and keeps earlier ledger rows` | After `beginSendNow` + success with `state:'awaiting_send_now'`, ledger contains prior queued ids plus the new id; `sent` is `[]` (existing behavior). |
| T1.3 | `accepted ledger` › `applyQueueSnapshot never touches the ledger` | A matching-generation snapshot that omits a ledger id leaves `acceptedLedger` unchanged while `sent` follows the snapshot. |
| T1.4 | `accepted ledger` › `resolveWithdrawSuccess removes the id from the ledger` | Ledger no longer contains the withdrawn id; other ids and order preserved; mismatched id is a no-op. |
| T1.5 | `accepted ledger` › `failures and interrupt transitions leave the ledger unchanged` | `resolveGuidanceFailure`, `resolveSendNowFailure`, `beginInterrupt`, `resolveInterruptOutcome`, `resolveWithdrawFailure` return the same `acceptedLedger` reference. |
| T1.6 | `reconcileNeverSent` › `restores unmatched shown-queue ids with original text and identity` | `sent = [A, B]`, written = `{A}` → `neverSent = [{messageId:B, message:textB}]`. |
| T1.7 | `reconcileNeverSent` › `restores drained ledger ids that never became rows, ahead of still-queued ids` | ledger `[L1, L2]`, `sent = [L2, X]` (X from another tab), written `{}` → order `[L1, L2, X]`; no duplicate `L2`. |
| T1.8 | `reconcileNeverSent` › `drops every candidate that matched a written row and yields an empty box` | ledger `[L1]`, `sent = [L1]`, written `{L1}` → `neverSent = []` (not `null`). |
| T1.9 | `reconcileNeverSent` › `folds a non-blank draft in as the last entry` | draft `'  keep going '` → last entry `{ messageId: null, message: 'keep going' }`; blank/whitespace draft adds nothing. |
| T1.10 | `reconcileNeverSent` › `the folded draft reuses the pending retry id when the text is unchanged` | `pendingRetry = {messageId:R, message:'x'}`, draft `'x'` → last entry `messageId === R`; draft `'y'` → `null`. |
| T1.11 | `reconcileNeverSent` › `is idempotent and never mutates draft, retry, sent, refusal, or notice` | Second call returns the identical object; `pendingRetry`, `sent`, `refusal`, `notice` strictly equal before/after. |
| T1.12 | `steeringDockMode visibility table` › `a reconciled non-empty never-sent box selects finished before every other check` | `live:false`, `rowStatus:'completed'`, `neverSent:[entry]` → `'finished'`; also with a pending ask and with a stored 422 refusal. |
| T1.13 | `steeringDockMode visibility table` › `an empty or null never-sent box leaves the existing table unchanged` | `neverSent: []` and `neverSent: null` on a completed non-live row → `'hidden'`; on a running live row → `'composer'`. |
| T1.14 | `never-sent copy` › `header, list label, and disclosure are exact` | `neverSentBandHeader(2) === 'never sent · 2'`, `neverSentListLabel(1) === 'Never sent, 1'`, `STEERING_NEVER_SENT_DISCLOSURE === 'node finished · none of this was sent'`. Header is lowercase DOM text (renderers uppercase via CSS). |
| T1.15 | `isTerminalNodeRowStatus` › `completed, failed, skipped are terminal; pending, running, awaiting are not` | Table-driven. |
| T1.16 | `collectWrittenOperatorMessageIds` › `collects message_id from operator text rows only` | Rows: operator text with id `A`; assistant text with `message_id` `B` but no `origin`; tool row with payload id `C`; operator row without `message_id` → result `Set{'A'}`. |
| T1.17 | `createSteeringDockState` › `starts with an empty ledger and an unreconciled box` | `acceptedLedger` is `[]`, `neverSent` is `null`. |
| T1.18 | `steeringDockMode visibility table` › `a row that returns to running on a live run leaves finished mode` | `neverSent:[entry]`, `live:true`, `rowStatus:'running'` → `'composer'`; with `rowStatus:'awaiting'` → `'blocked'`; with `live:true, rowStatus:'failed'` → `'finished'`. |
| T1.19 | `reconcileNeverSent` › `never lists the folded draft twice when its retry id was already accepted` | `pendingRetry = {R,'x'}`, draft `'x'`, `sent = [R 'x']` (accepted after an ambiguous POST), written `{}` → exactly one entry `R`. |
| T1.20 | `reconcileNeverSent` › `covers a terminal that lands while Send now is in flight` | `beginSendNow` over ledger `[q1]` with new draft `n` (so `sent === []`, `inFlightBatch` non-null, `pendingRetry = {N,'n'}`), written `{}` , draft `'n'` → `neverSent = [q1, N]` with `N` carrying the retry id, no duplicates. |

Use the existing test style in this file (`bun:test` `describe`/`test`,
helper `createSteeringDockState('generating')`, receipts built inline).
Build `NodeMessageRow` fixtures for T1.16 as plain objects typed
`NodeMessageRow` from `@/lib/node-message-pages` (only `kind`, `seq`,
`payload`, `metadata` matter; use `as NodeMessageRow` narrowly with a comment
if the generated type demands unrelated fields).

## Tasks & Steps

1. **Types.** After `PendingSubmission`, add `NeverSentEntry`. Add
   `acceptedLedger: readonly LocalSentReceipt[]` and
   `neverSent: readonly NeverSentEntry[] | null` to `SteeringDockState` with
   the doc comments from `plan.md` §"State model". Add `'finished'` to
   `SteeringDockMode`.
2. **Constructor.** `createSteeringDockState` initialises
   `acceptedLedger: []`, `neverSent: null`.
3. **Ledger transitions.**
   - `resolveGuidanceSuccess`: in both branches (replay and first append),
     compute `acceptedLedger = ledger.some(id match) ? ledger : [...ledger, receiptRow]`
     where `receiptRow` is the same object appended to `sent` (or, on replay,
     the existing `sent` row / a `{messageId, message: pendingRetry?.message ?? '', state}` row).
   - `resolveSendNowSuccess`: on both the `queued` replay branch and the
     drained branch, append the batch row whose `messageId === receipt.message_id`
     (found in `state.inFlightBatch`) when absent.
   - `resolveWithdrawSuccess`: `acceptedLedger = ledger.filter(id !== messageId)`.
   - Every other transition spreads state and therefore preserves the ledger
     by construction; T1.5 pins this.
4. **`reconcileNeverSent(state, input: { writtenMessageIds: ReadonlySet<string>; draft: string }): SteeringDockState`.**
   Implement exactly the ordering/dedupe/draft rules in `plan.md` §"State
   model" — including: the folded draft is skipped when its retry id is
   already a candidate (T1.19); an in-flight `Send now` batch needs no special
   case because its earlier ids sit in the ledger and its new draft is still
   `pendingRetry` (T1.20) — and the doc comment: "Terminal reconciliation. Runs once. Candidates
   are this tab's accepted receipts that are no longer shown (drained or
   withdrawn elsewhere — they were received before anything still queued),
   then the last shown queue in server receipt order; a candidate with a
   written operator row is delivered and drops out; the unsent draft folds in
   last so it is never taken with the field. Nothing here is a request and
   nothing here touches storage."
5. **`steeringDockMode`.** Add optional `neverSent?: readonly NeverSentEntry[] | null`
   to the input; first statement:
   ```ts
   if (
     input.neverSent !== undefined && input.neverSent !== null && input.neverSent.length > 0 &&
     (!input.live || isTerminalNodeRowStatus(input.rowStatus))
   ) return 'finished';
   ```
   Update the precedence doc comment ("a reconciled non-empty never-sent box
   wins before the live check because a finished run is exactly when it
   renders; a row that is running again on a live run — retry/resume under
   the same key — must fall back into the ordinary table so the composer
   returns"). Define `isTerminalNodeRowStatus` above it (step 6) since this
   function now calls it.
6. **Copy helpers and predicates.** Add `STEERING_NEVER_SENT_DISCLOSURE`,
   `neverSentBandHeader`, `neverSentListLabel` next to the existing band
   helpers; add `isTerminalNodeRowStatus` and
   `collectWrittenOperatorMessageIds` (type-only import of `NodeMessageRow`
   from `./node-message-pages`; the function narrows on
   `row.kind === 'text' && row.metadata?.origin === 'operator' && typeof row.metadata.message_id === 'string'`).
7. Update the module docblock's first paragraph to mention terminal
   reconciliation.

## Verification

```bash
bun test packages/web/src/lib/steering-dock.test.ts        # all T1.x green, existing tests untouched
bun --filter @archon/web type-check                        # both docks still compile
bun --filter @archon/web lint                              # zero warnings
```

Mechanical pass condition: the 20 new tests pass, no existing test in the
file changed, `type-check` and `lint` exit 0, and
`e2e/ui/agent-never-sent.spec.ts` exists with every case marked `test.fixme`.

## Rollback

Revert the two files; nothing else depends on the new exports until Phase 2.
