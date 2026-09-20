---
phase: 4
title: 'Phase 4: Real-executor E2E, evidence, authority sync, closeout'
status: pending
priority: P1
effort: '6h'
dependencies: [3]
gate: 'Phases 1–3 focused tests, web suite, typecheck, and lint pass'
---

# Phase 4: Real-executor E2E, evidence, authority sync, closeout

## Goal

Prove the user outcome through the real server, fake provider, executor,
shared queue, and both UI shells; capture accessibility/visual evidence;
correct the architecture/test/mockup authorities; and mark Story 2.11 done
only after all repository gates pass.

## Confirmed reusable infrastructure

- `e2e-queue-guidance.yaml` is already registered by
  `e2e/lib/playwright/archon-runtime.ts`; its interruptible provider turn has
  `delayMs: 30000`.
- The registered `e2e-queue-guidance-loop.yaml` and existing
  `agent-finished-iteration.spec.ts` already provide two loop occurrences,
  execution selection helpers, and a 25 s live iteration for E4.5.
- Runtime/run-detail helpers provide `startWorkflowViaWeb`, `starterFetch`,
  `waitForRunStatus`, `getRunDetail`, `listNodeMessages`, and Console/Legacy
  navigation. Request-id tracking and room/visual helpers are currently local
  patterns in the existing specs; keep small Story 2.11 versions local rather
  than extracting a two-caller abstraction.
- The abandon endpoint is `POST /api/workflows/runs/{runId}/abandon`.
- `getRunDetail().events` exposes the node terminal event and
  `nodeExecutions`; use it instead of treating run `cancelled` as sufficient.
- The Phase 3 server projection test owns parked-Ask cancellation: run detail
  already passes purged interaction rows with `execution_scope` and
  `resolved_at` into execution history, so no separate E2E-only fixture is
  needed to manufacture that read-model state.

Do not add another workflow fixture unless repository behavior changes and the
confirmed single-node/loop fixtures cannot hold a tested transition. If that
happens, record the evidence and add the smallest dedicated fixture rather
than modifying a shared fixture's timing.

## Files

- Create `e2e/ui/agent-never-sent.spec.ts` with executable tests.
- Modify `e2e/ui/agent-queue-guidance.spec.ts` for the natural-drain negative.
- Modify `e2e/ui/agent-finished-iteration.spec.ts` to prove a queue-observing
  completed occurrence recovers after the overall node event.
- Modify AD-11 in
  `_bmad-output/planning-artifacts/architecture/architecture-Archon-live-agent-steering-2026-09-12/ARCHITECTURE-SPINE.md`.
- Modify
  `_bmad-output/planning-artifacts/architecture/architecture-Archon-live-agent-steering-2026-09-12/walkthrough.html`
  terminal-reconciliation entry to match AD-11; it is a user-facing visual
  companion, not a historical review log.
- Modify `_bmad-output/specs/spec-agent-node-room/steering-test-plan.md`.
- Modify the one conflicting disclosure line in
  `_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/mockups/key-steering-dock.html`.
- Create evidence under
  `plans/260920-1136-issue-191-recover-never-sent-messages/reports/evidence/`
  and an acceptance report under the phase's `reports/` directory.
- Modify `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml`
  last, after validation.

## E2E cases

Run behavior cases for `surface of ['console', 'legacy']` using the repository's
`[P1] [V:...]` title convention.

| ID   | Case                                           | Required proof                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E4.1 | queued messages survive Cancel                 | Queue two exact messages, capture request ids, abandon, observe run `cancelled`, then poll `getRunDetail` until the selected node's real `node_failed` terminal event/raw execution is present. Only then assert ordered `Never sent, 2`, exact ids/text, one alert, no controls, and no matching operator rows.                                                                                                          |
| E4.2 | observer tab recovers shared receipt           | Creator page queues A; observer page sees A in the shared queue; close creator; cancel and wait for the actual node event; observer restores A with creator's id. This proves the ledger is observation-based, not local-success-only. The unit/component tests separately force a later empty 200 snapshot; Cancel may instead end polling with 409.                                                                     |
| E4.3 | idle-after-interrupt guidance survives Cancel  | Stop and wait for idle, then use authenticated `starterFetch` with `intent:'queue'` (the existing route-ladder pattern) to add one item without waking the node. Wait until the UI shows it under `WILL SEND`, abandon, wait for the actual node event, and restore its id once. Do not click the UI's `Send now`, which would drain it.                                                                                  |
| E4.4 | half-typed draft folds in last                 | Queue identified A, type raw `  still typing  ` without sending, cancel/event, then assert A followed by an id-less item whose `textContent` preserves the raw string.                                                                                                                                                                                                                                                    |
| E4.5 | finished-iteration observer recovers node-wide | With loop iteration 2 live, queue A, select completed iteration 1 and confirm its read-only shared band sees A. Focus Go, cancel, wait for the overall node's actual failure event, then assert the old-iteration disclosure/Go control yields to one Never-sent result for A and focus reaches the transcript target rather than body. The comparison request omits occurrence filters (also pinned in component tests). |
| E4.6 | natural delivery has no false result           | Extend the existing natural-drain case: both tracked ids exist as operator rows, no Never-sent list/disclosure appears after node/run completion.                                                                                                                                                                                                                                                                         |
| E4.7 | focus and single announcement                  | Focus the field before terminal; afterward focus is the last transcript row/scroller, never body or the box; exactly one alert remains across an unrelated rerender/refetch.                                                                                                                                                                                                                                              |
| E4.8 | visual and responsive evidence                 | Capture the finished box at 460 px in both shells and Console in a 1440 px host. Measure `33vh` bound, no horizontal overflow/focusable controls, computed uppercase/tracking, item elision, and secondary-text/elevated-background contrast ≥ 4.5:1.                                                                                                                                                                     |

The Cancel tests deliberately distinguish two milestones:

1. At run `cancelled` while the raw node execution is still running, the UI
   must not claim `NEVER SENT`.
2. After the node terminal event and complete terminal transcript drain, the
   result appears.

Use `expect.poll(() => getRunDetail(...))` with existing `T.long`/`T.xlong`
budgets; do not sleep a guessed number of seconds. Wait for persisted
`event_type === 'node_failed'` with the selected `step_name`; the executor
emits that event, while `dag_node_failed` is only a log label and must not be
accepted as event evidence. Also confirm the selected raw execution is failed
so a sibling event cannot satisfy the wait.

Pending-request-plus-edited-draft is deterministically covered at core and
component level because browser request timing would be artificial; E4.4
proves the user-visible draft fold-in through the real stack.

## Authority synchronization

Perform these after behavior is green, and verify every claim against the
implementation before writing it.

1. **AD-11:** retain the rule that actual node terminal evidence is the trigger.
   Document the narrow parked-Ask case: terminal Cancel/failure purges the
   scoped interaction after its executor has returned, so the server read
   projection closes only that matching execution and every uniquely matched
   loop-owner segment represented by its ancestry, without writing a synthetic
   lifecycle event; answered Ask resumes require their matching persisted
   `resumed:true` resolution event and retire only scoped pre-pause/owner
   segments proven superseded by corresponding later starts;
   unscoped/ambiguous rows fail closed.
   Record that the client folds the resumed-Ask event into one logical
   execution key, so Ask continuation preserves queue history while a true
   retry/resume resets it. Clarify
   that the client remembers all generation-valid shared queue observations
   plus local successful receipts; later snapshot omission does not erase
   history. Record that Cancel may publish terminal run status before the raw
   node event, so mounted run-detail views perform 3 s read-only catch-up while
   raw executions remain unsettled and reconcile only from a complete drain
   started after the real node event. Record the fail-safe behavior when that
   event/drain is unavailable. A finished-iteration view that showed the
   shared queue remains eligible, but comparison uses a separate node-wide
   transcript drain rather than its occurrence-scoped transcript.
2. **Architecture walkthrough:** make its `Terminal reconciliation` definition
   a concise HTML rendering of the amended AD-11 (observed shared receipts,
   raw-event/scoped-purge catch-up, node-wide final rows, and fail-safe behavior). Do not
   modify `.memlog.md`, `reconcile-spec.md`, or review files; they are dated
   decision/review records rather than current authority.
3. **Steering test plan:** link the focused core/dock/parent/pane coverage and
   `agent-never-sent.spec.ts`; explicitly include the exact-scope purged-Ask
   projection with nested owners, the persisted resumed-event guard, the
   live/pre-evidence negative, cross-tab and finished-iteration observation,
   pending/draft ordering, Cancel, natural drain, accessibility, focus, and
   visual viewports.
4. **Mockup:** replace only
   `node finished · these never left this tab` with
   `node finished · none of this was sent`. Do not change Story 2.12's
   30-minute state.
5. **Tracker:** after every command below succeeds, set
   `2-11-recover-messages-that-were-never-sent-when-the-node-ends: done` and
   update `last_updated`. Do not change unrelated story/epic status.
6. Write `reports/acceptance-report-260920-issue-191.md` mapping AC1–AC6 to
   passing test ids and evidence paths. Reports are execution records, not
   evergreen product authority.

## Verification order

1. Run focused tests and type/lint gates from Phases 1–3.
2. Build the web application once.
3. Typecheck the standalone E2E project.
4. Run the three affected specs.
5. Run the full repository validation.
6. Inspect captures/measurements, write the acceptance report, then update the
   tracker and plan/phase statuses. If any gate fails, leave the tracker and
   plan pending.

```bash
bun test packages/server/src/routes/workflow-execution-history.test.ts
bun --filter @archon/web test
bun --filter @archon/server type-check
bun --filter @archon/web type-check
bun run build:web
cd e2e && npm run typecheck
npx playwright test -c playwright.config.ts ui/agent-never-sent.spec.ts ui/agent-queue-guidance.spec.ts ui/agent-finished-iteration.spec.ts
cd .. && bun run validate
```

Pass condition: E4.1–E4.8 pass on the stated surfaces/viewports, evidence and
the acceptance report exist and agree with results, authority edits describe
the implementation, the tracker is changed only after success, and
`bun run validate` exits zero.

## Failure handling and rollback

- On E2E failure, retain trace/screenshot output and do not weaken the terminal
  event assertion or widen timeouts without a measured healthy baseline.
- On missing terminal evidence, investigate parent catch-up, lifecycle event,
  and scoped-purge projection;
  do not reintroduce `!live` reconciliation.
- Rollback reverts the three E2E files, four current-authority/design
  artifacts, report/evidence files, and tracker line. Product code remains
  independently reversible by Phases 1–3; no data/schema rollback exists.
