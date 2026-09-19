---
phase: 3
title: 'Focused multi-view E2E evidence and closeout'
status: pending
priority: P1
effort: '1 session'
dependencies: [1, 2]
---

# Phase 3: focused multi-view E2E evidence and closeout

## Goal

Prove Story 2.9 through the real server, registry, browser API, and both room
shells without duplicating the queue/withdraw stories' delivery tests. For each
shell, one three-view journey covers same-operator tabs, a second authenticated
operator, server order and identity, local drafts, remote withdrawal, absence
of duplicate DELETEs, and keyboard focus. One two-node journey proves scope
isolation and re-hydration. Record deterministic evidence, run the full gates,
and change the Story 2.9 tracker only after they pass.

The Playwright `archon` runtime is worker-scoped, not test-scoped. Each test
therefore creates its own run and browser contexts and uses unique messages,
but it must not claim or depend on a fresh server/database for every test.

## Evidence anchors

- Story acceptance criteria:
  `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md:669-695`.
- Runtime ownership and workflow seeding:
  `e2e/lib/playwright/suite.ts`, `e2e/playwright.config.ts`, and
  `e2e/lib/playwright/archon-runtime.ts`.
- Authenticated contexts and identity proof:
  `createIdentityContext()` and `getRunDetail()` in
  `e2e/lib/playwright/run-detail.ts`.
- Room, queue, request, keyboard, screenshot, and overflow precedents:
  `e2e/ui/agent-queue-guidance.spec.ts` and
  `e2e/ui/agent-withdraw-guidance.spec.ts`.
- Existing delivery proof: the withdraw spec already proves that a withdrawn
  id never reaches the fake provider. This phase tests shared visibility only.
- Tracker:
  `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml`.

## Files

| File                                                                       | Action                                                                |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `e2e/fixtures/workflows/e2e-queue-guidance-pair.yaml`                      | Create a two-parallel-node, 45-second fake-provider fixture.          |
| `e2e/lib/playwright/archon-runtime.ts`                                     | Add the fixture path, workflow/node exports, and one seed write.      |
| `e2e/ui/agent-queue-convergence.spec.ts`                                   | Add two parameterized journeys for Console and Legacy.                |
| `plans/260919-1418-issue-189-live-queue-across-tabs/reports/evidence/`     | Add per-test screenshots and uniquely named JSON measurements.        |
| `plans/260919-1418-issue-189-live-queue-across-tabs/reports/acceptance.md` | Map every Story 2.9 criterion to automated and visual evidence.       |
| `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml` | Change only Story 2.9 from `backlog` to `done`, after all gates pass. |

Do not change the existing single-node/loop fixtures or existing queue and
withdraw scenarios. Do not update design source hashes: none of their pinned
design sources changes. If E2E reveals a product defect, fix it in the owning
Phase 1/2 file with its focused test first; Phase 3 owns no product behavior.

## Pair fixture and runtime seed

Create `e2e-queue-guidance-pair.yaml` with `mutates_checkout: false` and two
independent nodes, `steer-a` and `steer-b`. Each uses `e2e-fake`,
`e2e-fake-model`, and:

```text
<<E2E_SCENARIO>>{"delayMs":45000}<</E2E_SCENARIO>>
$ARGUMENTS
```

Neither node has `depends_on`, so both handles are live concurrently. Add the
fixture constant beside the other queue fixtures, export
`E2E_QUEUE_GUIDANCE_PAIR_WORKFLOW_NAME` and the two node ids, and seed it beside
the existing queue workflows. The 45-second window is test capacity, not a
production timeout; create contexts/pages before dispatch and keep assertions
inside that live window.

## Test helpers and synchronization rules

Adapt, rather than export, the small room helpers from the existing specs:
`openGuidanceRoom`, `roomRegion`, `guidanceField`, `queueList`,
`rowDeleteButton`, `waitForNodeStarted`, `captureEvidence`, and
`expectNoRoomDrivenOverflow`. Add:

- `queuePathname(runId, nodeId)` and encoded send/delete path builders;
- `rowIds(room)`, reading `data-message-id` in DOM order;
- `readQueue(requestContext, runId, nodeId)`, requiring HTTP 200 and the exact
  `{ success: true, queued: [...] }` shape;
- `expectQueueIds(room, expected)` and `expectServerQueueIds(...)`, both using
  `expect.poll` until the complete id array equals `expected`;
- per-page request counters keyed by method/path, with listener disposal in
  `finally`;
- active-element and no-overflow measurements from the withdraw precedent.

The geometry helper must also record the queue wrapper's computed max height
and assert the production `max-h-[33vh]` class remains; two rows do not
naturally overflow far enough for a screenshot alone to prove that boundary.

Do not synchronize on the “next” GET response. Because polling is continuous,
that response can have begun before a mutation and truthfully contain the old
queue. Poll the eventual complete DOM and server arrays instead. Do arm a
POST/DELETE response waiter before the user action that causes that mutation,
so the accepted `message_id` and exact response status/body are captured.

Use `starterA.request` (or `archon.starterFetch`) and `teammate.request`, whose
pages carry the contexts' established identity headers, to prove both
authenticated identities receive the same queue. Never compare only message
text or count: ids and order are the contract.

Every scenario creates contexts explicitly and closes them in `finally`.
Dispose request listeners in the same block. Do not share a page, run id,
message id, or measurement filename between tests. This keeps the worker-scoped
runtime safe when retries or multiple workers are enabled.

## Journey 1: tabs and operators converge

Parameterize one test over `console` and `legacy`:
`[P1] [V:steer.converge-${surface}]`.

1. Create one starter context with pages `starterA` and `starterB`, and one
   teammate context with `teammate`. Set all three to 460×900, dispatch a
   unique pair-workflow run, wait for `steer-a` to start, and open that room in
   all three pages.
2. Prove the identities instead of assuming the headers: `getRunDetail()` must
   report `viewer_is_starter: true` on both starter pages and `false` for the
   teammate.
3. Type `draft-alpha-<tag>` in `starterB` and `draft-beta-<tag>` in the
   teammate field without sending either. Assert each visible value and its
   tab's scoped `sessionStorage` draft before any mutation.
4. From `starterA`, queue `starter-one-<tag>` and capture its POST receipt id.
   Eventually all three DOM lists, a starter queue GET, and a teammate queue
   GET must equal `[starterId]`. The teammate field/storage must still contain
   `draft-beta`; `starterB` must still contain `draft-alpha`.
5. Queue the teammate's current draft and capture `teammateId`. Eventually all
   five observations must equal `[starterId, teammateId]`; the teammate field
   and its draft storage are now empty, while `starterB` remains unchanged.
   Assert `QUEUED · 2`, list status/count copy, exact row text/id/order, and no
   duplicate ids.
6. Focus `starterId`'s delete button in `starterB`. Withdraw that id from
   `starterA`, using keyboard activation on the native delete button. Wait for
   every view and both server identities to equal `[teammateId]`. Assert
   `starterB` issued zero DELETEs and focus moved to `teammateId`'s delete
   button; the teammate did not issue a DELETE during this first removal.
7. Withdraw `teammateId` from the teammate page. Wait for all observations to
   equal `[]`, no `QUEUED` band/stale count remains, and `starterB` focus has
   moved to its composer field rather than `<body>`. Its field and storage
   still contain `draft-alpha`. The observing `starterB` page has issued zero
   DELETEs for the entire journey.
8. At the two-row and one-row convergence points, run the overflow guard and
   capture the Legacy and Console rooms at 460×900. For Console, resize one
   converged view to 1440×900, re-run the overflow guard, and capture the same
   ordered state before continuing. Check the final layout again after the
   queue band disappears.

Record, in a unique `convergence-${surface}.json`, the tag/run/node, both ids,
ordered ids observed in each view and identity, GET/DELETE counts per page,
draft-storage values, active elements before/after each removal, viewport and
overflow facts. Do not use the existing read/modify/write
`mergeMeasurements()` pattern against one shared file: separate test files
avoid lost updates when workers run in parallel.

This one journey directly covers both same-operator tabs and different
authenticated operators; splitting those facts into separate long-running
runs adds cost without proving a different contract.

## Journey 2: no cross-node leakage and re-hydration

Parameterize one test over `console` and `legacy`:
`[P1] [V:steer.scope-${surface}]`.

1. Create a starter context with two 460×900 pages before dispatch. Start its
   own pair-workflow run; wait for both `steer-a` and `steer-b` `node_started`
   events and for direct GETs on both queue paths to return 200/empty.
2. Open node A in page A and node B in page B. Queue unique `A-only` and
   `B-only` messages and retain their receipt ids.
3. Poll until page A and server A equal `[aId]` while page B and server B equal
   `[bId]`. Assert neither text nor id appears in the sibling room/response.
4. Navigate page A to node B. Its fresh keyed dock must hydrate to exactly
   `[bId]`, not retain A. Navigate it back to node A and require exactly
   `[aId]`. The original page B stays exactly `[bId]` throughout.
5. Capture both rooms and overflow facts at the stable split state. For
   Console, also verify one room after resizing to 1440×900; Journey 1 owns the
   required wide two-row capture, so this is an inexpensive scope regression.

Record unique `scope-${surface}.json` measurements. This scenario proves both
the route key and the component scope reset/keyed remount; checking only two
server endpoints would miss a stale client list.

## Visual acceptance evidence

The screenshots and measurements must prove, on both shells at 460×900 and on
Console at 1440×900:

- simultaneous views show the same exact ids/order in the hydrated two-row and
  converged one-row states;
- the existing full-bleed `surface-elevated` queue band is immediately above
  the inset composer, says `QUEUED · n`, and contains no `this tab only` copy;
- rows remain one-line/end-elided with their native, named delete controls;
- the list retains its 33vh internal scroll boundary and neither room nor page
  gains horizontal overflow;
- remote removal leaves a visible logical focus target; the empty queue leaves
  the still-populated local draft focused;
- node A and node B captures never share an id.

Name screenshots with the journey, shell, viewport, and state so retries do
not make their meaning ambiguous. Attach the same bytes to Playwright output.

## Acceptance report and tracker closeout

Create `reports/acceptance.md` only after the tests pass. For each of the four
Story 2.9 Given/When/Then groups, list:

- the exact Playwright test id and shell(s);
- the focused server/shared/component tests from Phases 1–2 that establish the
  race/error/focus behavior the journey cannot deterministically force;
- the relevant screenshot and measurement filenames;
- the validation command and result.

Do not require or claim a destructive “red run on develop”: this worktree is
already the implementation branch, and the focused unit/component tests own
test-first proof. Do not repeat the old route error ladder or provider-drain
test; server route tests and `agent-withdraw-guidance.spec.ts` already own
those contracts.

After all validation below is green, change only
`2-9-see-the-same-live-queue-across-tabs-and-operators` from `backlog` to
`done`. Leave the unrelated stale Story 2.1 entry untouched.

## Validation order

Build the web bundle that the runtime serves, then run the new spec alone:

```bash
bun run build:web
(cd e2e && npm run typecheck)
(cd e2e && npx playwright test -c playwright.config.ts ui/agent-queue-convergence.spec.ts)
```

Run all steering scenarios to catch interaction with the existing queue,
withdraw, and detached behavior:

```bash
(cd e2e && npx playwright test -c playwright.config.ts --grep '\[V:(steer|withdraw)\.')
```

Then run the repository gate required before a PR:

```bash
bun run validate
```

If generated OpenAPI types or the web bundle change after any repair, rebuild
and repeat the new spec plus the affected package tests before the final gate.

## Completion checklist

- [ ] Pair fixture is parallel, seeded, and exposes stable exported names
- [ ] Convergence journey passes on both shells with three authenticated views
- [ ] Draft/storage locality, exact id order, observer DELETE count, and focus
      movement are recorded
- [ ] Scope journey passes on both shells and proves keyed re-hydration
- [ ] Required 460×900 and Console 1440×900 visual/overflow evidence exists
- [ ] E2E typecheck, new spec, all steering scenarios, and `bun run validate`
      pass
- [ ] Acceptance report maps every story criterion to evidence
- [ ] Story 2.9 alone is marked `done` after the gates

## PR and handoff

Open the PR against `develop` with the repository template, retaining Problem
and outcome, Review guidance, Solution, and Validation; remove unused template
sections/comments and include `Closes #189`. Point reviewers to the server hot
path, generation race tests, both shell effects, and the four multi-view test
runs. Post the run id(s) and plan evidence path to issue #189 only as part of
the actual implementation handoff.

## Risks and controls

- **Live window expires during setup:** create contexts/pages before dispatch,
  use the 45-second pair fixture, and fail on missing handle rather than
  weakening assertions.
- **Poll race observes an old truthful response:** use eventual exact-array
  polling; never treat the next GET as post-mutation.
- **Worker-scoped state leaks between tests:** unique run/message ids, explicit
  context cleanup, listener disposal, and unique evidence files.
- **False identity coverage:** assert `viewer_is_starter` from both contexts and
  read the queue with both identity-bearing request contexts.
- **Evidence write races:** one JSON file per test/surface; no shared
  read/modify/write merge.
- **Run finishes before final assertion:** terminal disappearance is a test
  failure for these scenarios, not a reason to accept an empty/stale result.

## Rollback

Remove the new spec, fixture, runtime seed/exports, evidence and acceptance
report, and revert only the Story 2.9 status entry. No production or durable
data needs rollback.
