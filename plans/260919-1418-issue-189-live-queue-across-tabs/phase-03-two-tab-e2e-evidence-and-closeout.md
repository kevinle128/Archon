---
phase: 3
title: 'Two-tab E2E evidence and closeout'
status: pending
priority: P1
effort: '1 session'
dependencies: [1, 2]
---

# Phase 3: Two-tab E2E evidence and closeout

## Goal

Prove Story 2.9 end to end on both shells with a real web-dispatched run:
two tabs (same operator) and two authenticated operators (different browser
contexts) converge on the same `queued · n` header and the same ordered
`data-message-id` list after queue and withdraw actions in either view; the
observing view issues no DELETE; keyboard focus survives a remote removal;
each tab's draft stays local; and a sibling live node's queue never leaks
into another node's room. Record evidence, run the full validation gate, and
move the sprint-status entry to `done`.

Deep-mode note: re-scout `archon-runtime.ts`, `run-detail.ts`, and the two
prior steering specs before cooking — Phase 2 changes the detached scenario
and adds `data-message-id`, which this spec depends on.

## Source anchors

- Story AC (two-tab coverage bullet):
  `_bmad-output/planning-artifacts/epics-agent-node-room/epics.md:690-692`.
- Runtime: `e2e/lib/playwright/archon-runtime.ts` — fixture constants
  `:44-93`, seeding `:386-420`, `startWorkflowViaWeb` `:783-…`,
  `starterFetch` `:690-696`, `waitForRunStatus`.
- Identity contexts: `e2e/lib/playwright/run-detail.ts:164-177`
  (`createIdentityContext(browser, baseURL, 'starter' | 'teammate' | 'none')`).
- Spec precedents: `e2e/ui/agent-withdraw-guidance.spec.ts` (room helpers,
  `queueList`, `rowDeleteButton`, `captureEvidence`, `mergeMeasurements`,
  `expectNoRoomDrivenOverflow`) and `e2e/ui/agent-queue-guidance.spec.ts`
  (`waitForNodeStarted`, `openGuidanceRoom`, both-surface parameterization).
- Fixtures: `e2e/fixtures/workflows/e2e-queue-guidance.yaml` (30 s hold),
  `e2e-queue-guidance-loop.yaml` (25 s per iteration).
- Fake provider `echoPrompt` directive: `packages/providers/src/e2e-fake/provider.ts`
  (used by the withdraw spec's delivery-exclusion proof).
- Sprint status:
  `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml:76`.

## File inventory

| File | Action | Size | Test impact |
| --- | --- | --- | --- |
| `e2e/fixtures/workflows/e2e-queue-guidance-pair.yaml` | create | ~20 lines: two parallel delayed fake-provider nodes `steer-a`, `steer-b` (`delayMs: 30000`, no `depends_on`) | seeds the cross-node scenario |
| `e2e/lib/playwright/archon-runtime.ts` | modify | +fixture path const, `E2E_QUEUE_GUIDANCE_PAIR_WORKFLOW_NAME`, `QUEUE_GUIDANCE_PAIR_NODES`, one `writeFileSync` seed line | — |
| `e2e/ui/agent-queue-convergence.spec.ts` | create | ~450 lines, both surfaces | new |
| `plans/260919-1418-issue-189-live-queue-across-tabs/reports/evidence/*` | create | captures + `convergence-measurements.json` | evidence |
| `plans/260919-1418-issue-189-live-queue-across-tabs/reports/acceptance.md` | create | AC-by-AC evidence table | closeout |
| `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml` | modify | `2-9-…: backlog` → `done` only | closeout |
| `.agents/skills/verify-archon/visual-config.json` | none expected | its pinned `sources` (`visual-config.json:3-84`) hash spec/UX/theme files; this plan edits none of them (`steering-api-contract.md` is not listed). Touch it only if the verify-archon gate reports a source-hash drift you caused | — |

## Scenarios (each parameterized over `console` and `legacy`)

Helpers to lift from the withdraw spec: `roomRegion`, `openGuidanceRoom`,
`guidanceField`, `queueList`, `rowDeleteButton`, `captureEvidence`,
`mergeMeasurements`. Add `queuePathname(runId, nodeId)`,
`rowIds(list): Promise<string[]>` (reads `data-message-id` in DOM order),
and `openTwoViews(browser, archon, surface, runId, nodeId, kinds)` which
creates the contexts/pages and returns both rooms.

**Every scenario is a separate `test(...)` with its own runtime state**: each
one dispatches its own run with `startWorkflowViaWeb`, creates its own
contexts and pages, and names its own messages. Nothing below carries over
from one scenario to the next.

1. **`[P1] [V:steer.converge-tabs-${surface}]` two tabs converge on queue and withdraw**
   - Own run: `startWorkflowViaWeb(E2E_QUEUE_GUIDANCE_WORKFLOW_NAME, …)`;
     wait for `running` and `node_started`.
   - One starter context, two pages (`context.newPage()` — same operator,
     two tabs): `tab1`, `tab2`. Open the `steer-me` room on both.
   - In `tab1` queue `keep-me` and `drop-me`. Wait for `tab2`'s next
     `…/queue` response (`page.waitForResponse` on the pathname) and assert
     `queued · 2`, and `rowIds(tab2) === rowIds(tab1)` — identity by id, not
     text.
   - In `tab2` withdraw `drop-me`. Assert `tab1` converges to `queued · 1`
     with `keep-me`'s id only, and assert **no** DELETE request was issued by
     `tab1` (`tab1.on('request')` filter on method DELETE + pathname prefix,
     asserted zero at the end).
   - Assert `1 message queued` status text in both, and no `queued ·` count
     ever exceeds the server's (`starterFetch(queuePathname)` after each
     step equals the DOM count).
   - **Drain proof (same run, same test):** `keep-me` carries the fake
     provider's `echoPrompt` directive plus a unique marker (the withdraw
     spec's pattern at `agent-withdraw-guidance.spec.ts:295`). Wait for the
     30 s boundary; assert the transcript contains `keep-me`'s marker and
     never `drop-me`'s — the converged queue is the one the executor
     drained. Both views then show no queue band and the node completes
     (assert on the transcript, not the dock — the Console unmounts the dock
     when the agent finishes).
2. **`[P1] [V:steer.converge-operators-${surface}]` two authenticated operators converge**
   - Own run. Context S (starter) and context T (teammate) via
     `createIdentityContext`, one page each, both on the `steer-me` room.
     T queues `from-teammate`; S sees it on its next read; S withdraws it;
     T sees it vanish with no DELETE from T's page.
   - Attribution display is Story 2.13, so the identity is verified only at
     the read: `starterFetch(queuePathname)` and a teammate-header fetch both
     return 200 with the same ids at each step.
3. **`[P1] [V:steer.draft-local-${surface}]` unsent drafts stay per tab**
   - Own run, one starter context, two tabs. `tab1` types `draft alpha`
     without queueing; `tab2` types `draft beta`, then queues `shared-one`.
     After `tab1` converges to `queued · 1`, `tab1`'s field still reads
     `draft alpha` and its `sessionStorage` record is `draft alpha`;
     `tab2`'s field is empty (accepted text cleared) and its storage has no
     draft.
4. **`[P1] [V:steer.converge-keyboard-${surface}]` keyboard access after a remote removal**
   - Own run, one starter context, two tabs. Queue `first` and `second`
     from `tab1`. In `tab2`, focus `first`'s delete button with
     `locator.focus()` (assert `document.activeElement` name
     `delete · first` — tab order through the room is not what this AC
     tests). Withdraw `first` from `tab1`. After `tab2` converges, assert
     `activeElement` is `second`'s delete button, never `body`. Then
     withdraw `second` from `tab1` and assert `tab2`'s focus lands on the
     field. Reduced-motion variant not required (no animation added).
5. **`[P1] [V:steer.no-cross-node-${surface}]` no cross-node leakage**
   - Own run: `startWorkflowViaWeb(E2E_QUEUE_GUIDANCE_PAIR_WORKFLOW_NAME, …)`;
     wait for both `steer-a` and `steer-b` `node_started`.
   - Queue `A-only` in the `steer-a` room (tab 1). Open `steer-b` in tab 2:
     assert the `steer-b` room has no queue band and its `…/queue` read
     returns `queued: []`. Queue `B-only` in `steer-b`; switch tab 1 to
     `steer-b` and assert exactly one row (`B-only`), then back to `steer-a`
     and assert exactly one row (`A-only`). `data-message-id`s never cross.
6. **`[P1] [V:steer.read-route-smoke]`** (surface-independent): direct
   `starterFetch` ladder — 200 live with ids in order, 404 unknown run, 409
   after completion, 422 on `startDetachedWorkflow`, nested 401 shape when
   `X-Archon-User` is stripped on a gated install only if the runtime can
   enable the gate (it cannot today — `isolatedEnv` leaves web auth off), so
   assert 200-without-identity instead and document it.

Timing: each scenario holding two pages open needs `test.setTimeout(T.xlong * 2)`
like the precedent; the 30 s hold leaves ~20 s of interaction budget after
`node_started` **per test**, which is enough for ≤4 queue/withdraw steps at
the 1 s cadence. Do not shorten the fixture delay — scenario 1's drain proof
needs it.

## Evidence

`reports/evidence/` captures per surface: `converge-two-tabs-a1.png`,
`converge-two-tabs-a2.png` (same moment, same ids), `converge-keyboard-focus.png`,
`no-cross-node-a.png`, `no-cross-node-b.png`. `convergence-measurements.json`
sections: per scenario the id lists from both views, request counts by
method per page, and the server-read count at each assertion point.

`reports/acceptance.md`: one row per AC bullet in the story with the
scenario id and evidence file that proves it, plus the unit/server test
names from Phases 1–2 that cover the race and focus rules.

## Tests before

Write scenarios 1–6 first against the Phase 2 build; they must fail on the
`develop` build (no read route → 404/`fetchJSON` error → no band ever
appears in the second tab) before passing on the branch. Record that red
run's summary line in `acceptance.md`.

## Refactor (protected)

- No product code changes in this phase. If a scenario exposes a defect,
  fix it in the owning Phase 1/2 file with its unit test first, then re-run.

## Tests after

```bash
bun run validate
(cd e2e && npm run typecheck)
(cd e2e && npx playwright test --grep '\[V:steer\.')   # all steering scenarios, both surfaces
```

`bun run validate` must be green before the PR. The web bundle must be
rebuilt (`bun run build:web`) before the E2E run so the Phase 2 dock is what
Playwright drives.

## Closeout

1. Move `2-9-see-the-same-live-queue-across-tabs-and-operators` to `done`
   in `sprint-status.yaml` in the same branch, after every gate is green.
   Leave `2-1: backlog` untouched (out of scope, per the Story 2.2 plan).
2. Open the PR against `develop` with the repository template: Problem and
   outcome, Review guidance (point reviewers at the generation-guard tests
   and the detached-scenario change), Solution, Validation (paste the gate
   commands and the E2E summary), `Closes #189`.
3. Post the run-id / evidence path back on issue #189 per the handoff log
   convention.

## Todo

- [ ] Pair fixture + runtime constants + seed line
- [ ] Spec scenarios 1–6 written, red on develop build
- [ ] Green on branch for both surfaces; evidence captured
- [ ] `acceptance.md` with AC-by-AC evidence table
- [ ] `bun run validate`, e2e typecheck, full `[V:steer.` run
- [ ] sprint-status `2-9` → `done`; PR opened with `Closes #189`

## Regression gate

```bash
bun run validate
(cd e2e && npm run typecheck && npx playwright test --grep '\[V:steer\.')
```

## Risk assessment

- **Fixture hold too short for two-context setup**: opening four pages and
  waiting for two rooms can eat the 30 s budget on a slow machine. Mitigate
  by opening all pages *before* dispatching the run and navigating only
  after `node_started`; if still tight, raise the pair fixture to
  `delayMs: 45000` (the single-node fixture stays at 30 s for scenario 1's
  drain proof).
- **Poll cadence vs assertion timing**: always `waitForResponse` on the
  observing page's `…/queue` request before asserting convergence rather
  than sleeping.
- **Same-context tabs share sessionStorage? No** — sessionStorage is
  per-tab even inside one context; scenario 3 relies on this and asserts it.
- **`agentActive` gate on Console**: the Console room unmounts the dock when
  the node finishes; the drain proof asserts on the transcript, not the dock.

## Security considerations

- Teammate identity is a header on a loopback test server; no credentials
  are written to evidence files. Evidence captures show operator message
  text that the spec itself authored.
