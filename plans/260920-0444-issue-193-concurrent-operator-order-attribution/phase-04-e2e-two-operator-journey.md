---
phase: 4
title: 'End-to-end two-operator journey'
status: pending
priority: P1
effort: '3h'
dependencies: [1, 2, 3]
---

# Phase 4: End-to-end two-operator journey

## Goal

Add the one missing full-chain criterion: two distinct identity contexts launch
overlapping dock sends to one live node, the real registry chooses the global
order, the executor persists that order with correct identities, the read model
projects the matching names, and a sibling node remains isolated.

## Reuse, do not recreate

Extend `e2e/ui/agent-queue-convergence.spec.ts` instead of adding a separate
large spec. It already owns:

- starter/teammate browser contexts;
- Console and Legacy room navigation;
- the two-node `e2e-queue-guidance-pair` fixture;
- queue GET, DOM id, node-start, viewport, and queue-visual helpers.

Import `listNodeMessages` from `e2e/lib/playwright/run-detail.ts`. Keep the
fixture unchanged: both nodes' bounded 45-second first turns provide the
pre-drain observation window, and the fake provider's resumed turn completes
without a new scenario block.

## Scenario

Add one parameterized test per existing `surface` loop:

`[P1] [V:steer.concurrent-operators-${surface}] overlapping operators keep queue, transcript, and attribution aligned on ${surface}`

1. Create starter and teammate contexts/pages at the existing 460x900 narrow
   viewport. Start the pair workflow and wait for `steer-a` and `steer-b` to
   emit `node_started`.
2. Open `steer-a` in both identities' rooms. Verify the starter view reports
   starter identity and teammate view reports non-starter, using the existing
   run-detail seam.
3. Round 1: pre-fill distinct starter A1 and teammate B1 text, register both
   response listeners, then press both docks' Queue shortcuts inside one
   `Promise.all`. Await both responses and record their caller ids.
4. Round 2: only after both round-1 responses, repeat concurrently for A2/B2.
   This preserves A1 before A2 and B1 before B2 while allowing either global
   interleaving.
5. Send one distinct teammate message X1 to `steer-b` through the teammate
   request context with an explicit UUID. This is the cross-node control.
6. Immediately snapshot both server queues. For `steer-a`, assert exactly the
   four A/B ids, no duplicates, A1 precedes A2, and B1 precedes B2. Save this
   observed array as `queueOrder`; do not prescribe whether A or B won either
   round. For `steer-b`, assert exactly `[X1]`.
7. Before drain, assert both `steer-a` rooms converge on `queueOrder` and the
   four-row queue state.
8. Wait for the real workflow to complete and read both node transcripts.
   Filter operator rows and assert:
   - `steer-a` ids exactly equal `queueOrder` and `seq` is increasing;
   - A rows have display name `e2e-starter`, one stable non-null user id, and
     the starter texts;
   - B rows have display name `e2e-hitl-teammate`, a different stable non-null
     user id, and the teammate texts;
   - `steer-b` contains only X1 and uses the same teammate user id/name;
   - no A/B id or text appears under the wrong node or sender.
9. Reopen the completed `steer-a` room in both contexts and assert DOM operator
   rows, labels, bodies, and `sent` badges follow `queueOrder` exactly.

The route test in Phase 2 owns deterministic server overlap. This journey owns
the real server/registry/executor/database/read-model/rendering chain and uses
the queue snapshot as the authoritative order oracle.

## Visual acceptance criteria

No visual design changes are permitted. The authority is `EXPERIENCE.md`,
`DESIGN.md`, and `mockups/key-steering-dock.html` under the Agent Node Room UX
artifact directory. Legacy's room contract is 460px; the Console mock is drawn
at a 520px panel, and the existing E2E also checks Console inside a 1440x900
page viewport. For this scenario, use the established 460x900 narrow viewport
on both surfaces and retain the neighboring wide-Console regression:

- before drain, both identities show the same four queue rows in `queueOrder`,
  with `queued · 4`, no duplicate rows, and no cross-node text;
- after completion, both show four operator rows in that order, each with the
  correct `operator · <name>` label, full body text, and `sent` badge;
- existing queue-band geometry, accessible labels, focus, narrow overflow,
  and Console-at-1440-page-viewport checks in the neighboring convergence test
  remain green. Do not call 1440px a panel width, duplicate those measurements,
  or create new design snapshots unless a product UI defect is found.

## Files

- Modify: `e2e/ui/agent-queue-convergence.spec.ts`
- No fixture or product file change expected.

## Validation

```bash
(cd e2e && npm run typecheck)
(cd e2e && npx playwright test agent-queue-convergence --grep 'steer.concurrent-operators')
(cd e2e && npx playwright test agent-queue-convergence)
```

Run the new scenarios twice if the first implementation exposed any timing
failure; remove the race source rather than widening timeouts blindly.

## Acceptance

- Both Legacy and Console scenarios pass against isolated real SQLite/runtime
  workers and the real fake-provider transport.
- Client sends in each round are launched together; assertions never depend on
  which sender wins.
- Queue order, transcript order, sender metadata, display names, and DOM order
  are tied by caller ids, not by text matching alone.
- Sibling-node and sender isolation are proven in the same journey.

## Failure handling

If the queue has drained before step 6, first reduce setup work before the send
rounds. Change the bounded fixture delay only if measured CI evidence shows the
existing 45 seconds is insufficient; do not add arbitrary sleeps.
