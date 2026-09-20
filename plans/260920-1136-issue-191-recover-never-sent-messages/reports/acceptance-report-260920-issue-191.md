# Acceptance report — Issue 191 / Story 2.11

Recover messages that were never sent when the node ends.

Date: 2026-09-20  
Run: real-executor Playwright + focused unit/component suites + `bun run validate`.

## AC map

| AC  | Requirement                                                                                                                                                                                          | Evidence                                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| AC1 | On actual node terminal evidence, every generation-valid observed receipt (except confirmed withdraws) is compared to node-wide operator `message_id`s; unmatched restored once in observation order | E4.1 `agent-never-sent` cancel both shells; T1.1–T1.17; T3.18–T3.26; screenshots `e4-1-*-never-sent-2.png` |
| AC2 | Live refetch / run-terminal-with-raw-still-running / pre-evidence drain never populate reconciliation; purged Ask closes only exact scope; ambiguity fails closed                                    | E4.1 two-milestone cancel (no box at `cancelled` while unsettled); T2.8; T3.1–T3.4; T3.10–T3.14 catch-up   |
| AC3 | Pending submission neither observed nor written restored; different draft folds last; unchanged text not duplicated                                                                                  | E4.4 draft fold both shells (`e4-4-*-draft-fold.png`); T1.13–T1.16; T2.5–T2.6                              |
| AC4 | Finished box: exact text/ids, name `Never sent, n`, one assertive alert `node finished · none of this was sent`, no controls                                                                         | E4.1/E4.7; T2.7; copy constants in `steering-dock.ts`                                                      |
| AC5 | If every observed receipt was written and no unsent input, finished dock absent                                                                                                                      | E4.6 natural-drain negative in `agent-queue-guidance.spec.ts`; T1.19 empty result                          |
| AC6 | New execution attempt clears terminal reconciliation; late prior-attempt async inert; draft kept, retry UUID cleared                                                                                 | T2.14; T3.24–T3.25                                                                                         |

## E2E cases

| ID   | Spec                                            | Surfaces                     | Result                 |
| ---- | ----------------------------------------------- | ---------------------------- | ---------------------- |
| E4.1 | `e2e/ui/agent-never-sent.spec.ts`               | console, legacy              | pass                   |
| E4.2 | same (observer tab)                             | console, legacy              | pass                   |
| E4.3 | same (idle-after-interrupt queue)               | console, legacy              | pass                   |
| E4.4 | same (draft fold)                               | console, legacy              | pass                   |
| E4.5 | same + `agent-finished-iteration.spec.ts`       | console, legacy              | pass                   |
| E4.6 | `agent-queue-guidance.spec.ts` natural drain    | console, legacy              | pass (assertion added) |
| E4.7 | `agent-never-sent.spec.ts` focus + single alert | console, legacy              | pass                   |
| E4.8 | visual/responsive                               | console 460+1440, legacy 460 | pass                   |

## Evidence paths

Under `plans/260920-1136-issue-191-recover-never-sent-messages/reports/evidence/`:

- `e4-1-console-never-sent-2.png`, `e4-1-legacy-never-sent-2.png`
- `e4-2-console-observer-never-sent.png`, `e4-2-legacy-observer-never-sent.png`
- `e4-3-console-idle-never-sent.png`, `e4-3-legacy-idle-never-sent.png`
- `e4-4-console-draft-fold.png`, `e4-4-legacy-draft-fold.png`
- `e4-5-console-finished-iter-never-sent.png`, `e4-5-legacy-finished-iter-never-sent.png`
- `e4-8-console-460-never-sent.png`, `e4-8-console-1440-never-sent.png`, `e4-8-legacy-460-never-sent.png`
- `never-sent-measurements.json` — `max-h-[33vh]`, uppercase + ~0.07em tracking, elision, 0 focusables, contrast ≥ 4.5:1

## Product fix landed with Phase 4

Finished mode now takes precedence over `live:false` once `neverSent` is nonempty and `nodeTerminal` is true, so Cancel (run non-live before/after node event) still surfaces recovery. Entering finished also re-hands focus to the transcript when focus would otherwise land on `<body>`.

## Authority sync

- AD-11 in `ARCHITECTURE-SPINE.md` — observation ledger, exact-scope purged Ask, resumed-Ask key fold, 3 s catch-up, node-wide drain, fail-closed
- `walkthrough.html` Terminal reconciliation card matched
- `steering-test-plan.md` links T1–T3 + E4 specs
- `mockups/key-steering-dock.html` disclosure → `none of this was sent`
- `.memlog.md`, `reconcile-spec.md`, `reviews/` untouched

## Tracker

`2-11-recover-messages-that-were-never-sent-when-the-node-ends: done` only after `bun run validate` exits zero.
