---
phase: 4
title: 'E2E two-operator journey'
status: pending
priority: P1
effort: '5h'
dependencies: [3]
---

# Phase 4: E2E two-operator journey

## Goal

Drive two authenticated identities (starter and teammate) through the real
server, registry, executor and both web shells on one live node while a sibling
node runs concurrently, and prove in the browser that the attributed operator
rows appear in receipt order with the right display names and that the sibling
node shows none of them.

## Scout pass (run before editing)

1. Read `e2e/ui/agent-queue-convergence.spec.ts` (two contexts via
   `createIdentityContext(browser, baseURL, 'starter' | 'teammate')`, pair
   fixture, evidence dir pattern) and `e2e/ui/agent-queue-guidance.spec.ts:300-500`
   (`waitForNodeStarted`, `transcriptTexts`, `trackSendRequests`,
   `listNodeMessages`, DOM assertions on `[data-operator-label]`).
2. Confirm `E2E_TEAMMATE_WEB_USER = 'e2e-hitl-teammate'`
   (`e2e/lib/playwright/archon-runtime.ts:102`) and that only the starter is
   seeded with display name `e2e-starter` (`:368-390`). The teammate is created
   lazily by `findOrCreateUserByPlatformIdentity('web', header, header)`, so
   its display name is the header value. Expected labels:
   `operator · e2e-starter` and `operator · e2e-hitl-teammate`.
   The database is worker-scoped (`e2e/README.md`: each worker has an isolated
   temporary home and SQLite database) and other specs in the same worker may
   sight the teammate first, but every path creates it through
   `createIdentityContext` with the header as display name, so the label is
   the same regardless of spec order. If the label ever renders as the 8-char
   short id, check the seeding/lazy-create path before the spec expectation.
   <!-- Updated: Red Team 2026-09-20 — finding A4 (test-order precondition) -->
3. Confirm the pair fixture (`e2e/fixtures/workflows/e2e-queue-guidance-pair.yaml`)
   runs `steer-a` and `steer-b` in one layer with `delayMs: 45000` and no
   `emitTool`. The fake provider parses the scenario from the *prompt*; a
   guidance turn's prompt has no scenario block, so the resumed turn completes
   immediately with `[e2e-fake] deterministic response`
   (`packages/providers/src/e2e-fake/provider.ts:690-703`). No fixture change
   is expected; if the drained turn does not appear, add `"echoPrompt": true`
   to both nodes and adjust the echo assertion.
4. Check the `e2e/package.json` scripts and `playwright.config.ts` for tag
   conventions (`[P1] [V:<id>]`) and the worker-scoped `archon` fixture.

## Context links

- Story 2.9 two-view spec: `e2e/ui/agent-queue-convergence.spec.ts`
- Story 2.8 single-operator drain spec: `e2e/ui/agent-queue-guidance.spec.ts`
- Row label: `operator · <name>` rendered in both shells (`[data-operator-label]`)
- Test plan section to satisfy: `steering-test-plan.md` → "Concurrent operators"

## Key insights

- The browser cannot make two requests arrive in a chosen order, so this
  phase is an **end-to-end rendering and attribution proof**, not an
  independent order-causality proof: the receipt-order invariant itself is
  pinned by Phases 1–2 with controlled interleaving. Here the spec records the
  `message_id` of each send response in completion order per context (an
  observation independent of the registry), then checks that the transcript's
  operator rows are exactly the union, that each context's ids appear in that
  context's own send order (independent check), and that the rows' order
  equals the `GET /queue` snapshot taken after all sends completed
  (self-consistency check between queue read and transcript write).
  <!-- Updated: Red Team 2026-09-20 — finding A2 (self-referential order) -->
- Two browser contexts with different `extraHTTPHeaders` are two operators.
  Each context's dock serializes its own sends (`sendInFlight`), which is what
  makes the per-context order meaningful.
- Use `steer-b` as the leakage control: the teammate queues one message there;
  `steer-a`'s transcript and queue must never contain it, and vice versa.

## Requirements

- Functional: both shells; two identities; ≥2 messages per identity on
  `steer-a` interleaved by alternating which context presses `Queue`; one
  message on `steer-b`; after completion, `steer-a` rows = 4 attributed rows in
  the pre-drain queue order, `steer-b` rows = 1; DOM labels match; the
  `operator_user_id`s are two distinct non-empty strings, and the `steer-b` row
  carries the teammate's id.
- Non-functional: evidence screenshots at 460px (Legacy) and the Console
  panel width, saved under this plan's `reports/evidence/`; test runtime
  bounded by `T.xlong * 2`; no reliance on wall-clock ordering.

## Files to create / modify

- Create: `e2e/ui/agent-concurrent-operators.spec.ts`
- Modify (only if scout step 3 fails): `e2e/fixtures/workflows/e2e-queue-guidance-pair.yaml`

## Tests before (write first)

For `surface of ['console','legacy']`, test
`[P1] [V:steer.concurrent-operators-${surface}] two operators' guidance keeps receipt order and attribution on ${surface}`:

1. Start the pair workflow via the starter context (`archon.startWorkflowViaWeb`).
2. Create `starterCtx` and `teammateCtx`; open the `steer-a` room in each on
   the chosen surface; wait for `node_started` on both nodes.
3. Interleave: starter queues `S1`; teammate queues `T1`; starter queues `S2`;
   teammate queues `T2` (each press awaits its POST response via
   `trackSendRequests`). Teammate additionally opens `steer-b` and queues `X1`.
4. Snapshot `GET /queue` for `steer-a` from either context → `queueOrder`
   (expect 4 ids: a permutation of `{S1,S2,T1,T2}` with `S1<S2` and `T1<T2`).
   Snapshot `steer-b` → `[X1]`.
5. Both views converge on `QUEUED · 4` on `steer-a` (reuse the convergence
   helper pattern).
6. Wait for the run to complete. `listNodeMessages(steer-a)` operator rows:
   ids equal `queueOrder`; the S-ids appear in the starter context's recorded
   send-completion order and the T-ids in the teammate's; `operator_display_name`s map to `e2e-starter` for
   S-ids and `e2e-hitl-teammate` for T-ids; two distinct `operator_user_id`s;
   all four rows precede the drained-turn assistant row. `steer-b` rows: exactly
   `[X1]` attributed to the teammate; none of `S*`/`T*` present.
7. DOM on both contexts' `steer-a` room: `[data-operator-label]` texts in
   document order equal the labels derived from `queueOrder`; `steer-b` room
   shows one operator row. Capture evidence screenshots.

## Refactor (protected code)

None expected in product code. If the teammate label renders as the 8-char
short id instead of the header, the lazy-create display-name path regressed —
investigate `users.ts` before touching the spec's expectation.

## Tests after

None beyond the "before" set.

## Regression gate

```bash
bun run build:web
cd e2e && npm ci && npx playwright install chromium && npx playwright test agent-concurrent-operators
cd e2e && npx playwright test agent-queue-convergence agent-queue-guidance   # neighbours still green
```

## Implementation steps

1. Run the scout pass; copy the helper imports from the convergence spec.
2. Write the spec with the seven steps above; keep helpers local unless the
   convergence spec already exports them.
3. Run on both surfaces; save evidence under
   `plans/260920-0444-issue-193-concurrent-operator-order-attribution/reports/evidence/`.
4. Write `reports/phase-04-evidence.md` listing the scenario ids and paths.

## Todo

- [ ] spec created and tagged
- [ ] both surfaces green locally
- [ ] evidence screenshots saved
- [ ] evidence report written

## Success criteria

- Both `[V:steer.concurrent-operators-*]` scenarios pass twice in a row.
- No product code changed, or the change is covered by a unit test from
  Phases 1–3.

## Risk assessment

- Medium: E2E timing. Mitigated by the 45 s fixture delay and by asserting
  against the observed queue snapshot rather than the press order.
- Low: teammate display name. Pinned by scout step 2.

## Security considerations

- End-to-end proof that a second authenticated operator's messages are
  attributed to that operator and never to the run starter.

## Next steps

Phase 5 records evidence and closes the story.
