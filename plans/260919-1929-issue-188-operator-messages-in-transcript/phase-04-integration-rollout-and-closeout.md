---
phase: 4
title: 'Integration, rollout, and closeout'
status: pending
priority: P1
dependencies: [1, 2, 3]
---

# Phase 4: integration, rollout, and closeout

## Goal

Prove the feature outside-in using the existing real-server steering journeys,
capture the approved narrow/wide UI states on both surfaces, run repository
gates, and close Story 2.8 with an accurate rollout and rollback record.

## Reuse instead of duplication

The repository already has the expensive workflows and UI helpers needed:

- `e2e/ui/agent-queue-guidance.spec.ts` covers natural-boundary delivery in
  Legacy and Console and currently contains the inverse assertion that operator
  rows do not exist.
- `e2e/ui/agent-interrupt-redirect.spec.ts` covers FIFO queueing, Stop,
  `Send now`, interrupted tool state, resumed echo, and 460/1440 visual
  captures on both surfaces.
- `e2e/lib/playwright/run-detail.ts` returns real transcript JSON but its local
  return type omits ids, sequence, operator metadata, and the derived name.
- `E2E_STARTER_WEB_USER` is seeded to the canonical user whose display name is
  `e2e-starter`. `archon.startWorkflowViaWeb` uses that identity, but the
  default Playwright page does not. Browser-originated sends need the same
  header before navigation.

Extend those journeys. Do not add a third spec with copied steering helpers or
another full workflow run.

## Files

| File                                                                                         | Change                                                                                  |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `e2e/lib/playwright/run-detail.ts`                                                           | Widen `listNodeMessages`' truthful return type.                                         |
| `e2e/ui/agent-queue-guidance.spec.ts`                                                        | Replace the obsolete no-row assertion with natural-delivery API/DOM assertions.         |
| `e2e/ui/agent-interrupt-redirect.spec.ts`                                                    | Add identity, operator-row order/correlation assertions, and exact visual measurements. |
| `plans/260919-1929-issue-188-operator-messages-in-transcript/reports/acceptance-evidence.md` | Record acceptance-to-test mapping, command results, and capture links.                  |
| `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml`                   | Mark Story 2.8 done only after all gates pass.                                          |

## Implementation sequence

### 1. Make the E2E transcript helper truthful

Add the response properties the tests actually inspect:

- `id`, `seq`, `kind`, `payload`, and optional `created_at`;
- optional top-level `operator_display_name: string | null`;
- metadata `origin`, `operator_user_id`, `message_id`, and execution
  occurrence/attempt fields.

This is a type correction only; the helper already returns the full JSON. Use
the generated response contract as the shape reference and avoid `any`.

### 2. Convert the natural-drain journey from inverse to positive proof

In each `[V:steer.direct-${surface}]` test:

1. put `X-Archon-User: E2E_STARTER_WEB_USER` on the page before opening the
   room so UI send POSTs resolve the seeded acting user;
2. enhance the local request tracker to retain the two caller-stamped
   `message_id`s as well as a count;
3. remove the comments/assertions requiring `first correction` and
   `second correction` to be absent as standalone rows;
4. after completion, read the API and assert exactly two operator rows in seq
   order, exact verbatim bodies (including the test directive where present),
   captured ids, non-empty identical sender ids, and
   `operator_display_name === 'e2e-starter'`;
5. assert both rows precede the caused echo row and share its `attempt_id`,
   while differing from the settled prior turn's attempt;
6. reopen the room and assert two `[data-operator-row]` elements with label
   source `operator · e2e-starter`, status `sent`, and plain body text before
   the echo in DOM order.

Keep the existing same-session, queue, focus, and a11y assertions. The second
message's embedded fake-provider directive is expected audit text because the
product contract is verbatim; do not sanitize it only for the test.

### 3. Add interrupt-path correlation to the existing primary journey

In each `[V:steer.interrupt-${surface}]` test:

- apply the starter page header before any send;
- reuse `trackPosts(...).bodies()` to capture all three `message_id`s from
  `first`, `second`, and the typed `Send now` request;
- after the run completes, assert three operator API rows in the same order,
  with the full metadata triple and `e2e-starter` projection;
- assert the `interrupted` status seq is lower than the first operator row and
  the resumed echo seq is higher than the last;
- assert all operator rows use the resumed echo attempt and not the interrupted
  turn attempt;
- on the fresh room, compare DOM positions with `Node.compareDocumentPosition`
  to prove interrupted tool -> three operator rows -> resumed echo. Do not use
  `boundingBox().y` for semantic order because scrolling/layout makes it
  fragile;
- assert every status is exactly `sent` and no operator row contains
  `delivered`.

These assertions exercise actual authentication, registry attribution,
executor storage, server join, generated types, shared history projection, and
both shell renderers in one existing flow.

### 4. Add visual acceptance to the existing visual journey

Extend `[V:steer.interrupt-visual-${surface}]`; do not create another visual
workflow. Use a clean long, multiline first queued message so wrapping and
preserved line breaks are visible, then keep the existing fake-provider
directive only in the message that needs it.

After `Send now` at 460x900, wait for the operator rows and assert/capture:

- room width and scroll width remain within the existing no-overflow check;
- role line source, uppercase computed transform, secondary color, 10px size,
  and approximately 0.07em tracking;
- `sent` computed normal case, 11px, secondary, right aligned and visible;
- body preserved text, sans family, 12.5px, line-height 1.55, normal weight,
  primary color, and no rendered Markdown child;
- adjacent assistant body is 12.5px/1.55 and secondary, providing a measurable
  non-color authorship difference;
- interrupted tool -> operator -> assistant DOM order and last-row reachability.

Repeat the operator-row capture after the existing 1440x900 `Send now` flow.
Both Legacy and Console are required at both viewports because the shells own
separate renderers even though the transcript has no breakpoint.

Keep prior #181/#183 captures in their original evidence directories. Add a
second evidence-directory constant or a directory parameter for the new
operator-row captures so Story 2.8 evidence lands under this plan without
moving historical files.

### 5. Run focused and broad gates

Run the cheapest affected checks first, then the full contracts:

```bash
# From repository root
bun --filter @archon/core test
bun --filter @archon/workflows test
bun --filter @archon/server test
bun --filter @archon/web test
bun run type-check
bun run lint --max-warnings 0
bun run build:web

cd e2e
npm run typecheck
ARCHON_E2E_REPO_ROOT=<absolute-repo-root> \
  npx playwright test -c playwright.config.ts \
  --grep '\[V:steer\.(direct|interrupt|interrupt-visual)-'

ARCHON_E2E_REPO_ROOT=<absolute-repo-root> \
  npx playwright test -c playwright.config.ts \
  ui/agent-queue-guidance.spec.ts ui/agent-interrupt-redirect.spec.ts

cd ..
bun run validate
```

Never substitute root `bun test` for `bun run validate`; the repository's
per-package invocations are required for `mock.module` isolation. No
`check:schema-upgrades` run is needed because neither SQL dialect changes.

Track and stop every server/test process the verification starts. Playwright's
worker fixture owns and stops its server; if a failure bypasses cleanup,
reconcile only the PIDs/ports belonging to this worktree.

### 6. Evidence and closeout

Write `reports/acceptance-evidence.md` only from completed runs. Include:

- each parent-plan acceptance criterion and the exact test(s) that prove it;
- focused test and `bun run validate` summaries;
- Playwright command/result and links to 460/1440 captures for both surfaces;
- generated-type diff review;
- explicit statement that no migration/backfill occurred;
- rollout/reload and downgrade-safe rollback instructions from the parent
  plan.

Then set `2-8-see-operator-messages-in-the-transcript: done` in
`sprint-status.yaml`. Do not edit unrelated story status.

If publication is requested, create the PR against `develop` using the
repository template copied into the body. Keep Problem and outcome, Review
guidance, Solution, Behavior change, Validation, rollout/rollback implications,
and `Closes #188`; delete unused template sections and comments. Run
`bun run validate` before PR creation as required by repository policy.

## Exit criteria

- Natural and interrupt deliveries are proven on Legacy and Console using
  authenticated browser sends.
- API rows, caller ids, sender projection, seq, attempt, DOM order, and literal
  `sent` all agree.
- Exact operator/assistant visual acceptance passes at 460x900 and 1440x900 on
  both shells with no room overflow.
- The existing steering specs remain green; no duplicate long-running spec was
  added.
- Full validation passes and evidence/tracker/doc claims match actual output.

## Operational gate

Do not deploy a writer-only subset. For rollout, finish active steering turns,
deploy the complete build, and reload open node-room clients before accepting
new guidance. After the first stored operator row, an exact downgrade to a
binary whose strict schema lacks the two metadata keys is not safe; disable the
new writer while keeping the widened reader, or forward-fix.
