---
phase: 5
title: 'Closeout and spec sync'
status: pending
priority: P1
effort: '1.5h'
dependencies: [1, 2, 3, 4]
---

# Phase 5: Closeout and spec sync

## Goal

Record reproducible evidence for Story 2.13, update only the owning test-plan
and tracker surfaces, and complete all repository gates before claiming done.

## Documentation changes

1. In `_bmad-output/specs/spec-agent-node-room/steering-test-plan.md`, replace
   the single generic concurrent-operators bullet with a concise mapping to:
   - the mixed-sender registry characterization;
   - the deterministic overlapping Hono-route test;
   - the strengthened direct/idle/loop executor tests;
   - the two `[V:steer.concurrent-operators-*]` full-chain scenarios.
2. State the tested semantics precisely:
   - global order is `accept()` order;
   - within-sender order assumes one dock/request stream waits for its prior
     send response;
   - the node queue is shared, so “no cross-user leakage” means no sender
     substitution, not private visibility;
   - queue GET intentionally omits attribution.
3. Create
   `plans/260920-0444-issue-193-concurrent-operator-order-attribution/reports/characterization-evidence.md`
   with commands, pass/fail summaries, scenario ids, and any production defect
   fixed. Do not copy implementation details that already live in code/tests.
4. Change only
   `2-13-preserve-message-order-and-attribution-under-concurrent-operators`
   in `_bmad-output/implementation-artifacts/agent-node-room/sprint-status.yaml`
   to `done`, and only after every focused and full gate passes.

No evergreen product documentation changes are needed because behavior and
public contracts are unchanged.

## Validation order

On a clean worktree, install exactly the locked dependencies once before the
gates (skip these commands when dependencies are already present):

```bash
bun install --frozen-lockfile
(cd e2e && npm ci && npx playwright install chromium)
```

Neither install may change `bun.lock` or `e2e/package-lock.json`; treat a lock
change as a setup error, not part of this story.

Run the narrow gates first:

```bash
(cd packages/workflows && bun test src/steering-registry.test.ts src/node-transcript.test.ts)
(cd packages/server && bun test src/routes/api.workflow-runs.test.ts)
(cd packages/workflows && bun test src/dag-executor.test.ts)
(cd e2e && npm run typecheck)
(cd e2e && npx playwright test agent-queue-convergence --grep 'steer.concurrent-operators')
```

Then run neighboring E2E coverage and the repository gate:

```bash
(cd e2e && npx playwright test agent-queue-convergence agent-queue-guidance)
bun run validate
```

`bun run validate` does not run the standalone Playwright project, so both
sets of commands are required. Never replace the root gate with root
`bun test`.

## Final review checklist

- Product: the observed queue order becomes the persisted/displayed order.
- Architecture: no lock, user lane, timestamp sort, or widened wire contract.
- Contracts: queue response remains two fields; transcript metadata remains
  `origin`, `operator_user_id`, and `message_id` plus existing execution scope.
- Security/data integrity: request identity stays attached to its own message;
  shared-queue visibility is not mislabeled as isolation.
- Performance: no new production hot-path work or unbounded test wait.
- Completeness: direct, idle, loop, real full chain, sibling node, and both
  shells have evidence without duplicating earlier error matrices.
- Operations: no migration, rollout, config, generated output, or background
  process is introduced.
- Maintainability: existing helpers/tests are strengthened; new abstractions
  exist only where the route gate needs deterministic control.

## Rollback

For a test/docs-only result, revert the Story 2.13 changes and restore the
tracker entry. If a production defect was fixed, keep that fix separately
revertible and document its failure mode in the evidence report.

## Handoff

After all gates pass, use `.github/pull_request_template.md`, target `develop`,
include the focused command results in Validation, and add `Closes #193`.
