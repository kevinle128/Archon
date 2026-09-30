import { test, expect } from '../lib/playwright/suite';
import { openCostForRun } from '../lib/playwright/cost-console';
import { T } from '../lib/playwright/timeouts';

/**
 * Feature: AI usage / cost tracking (PR #71).
 *
 * User story: a user runs a workflow; its AI usage is recorded; the cost console
 * shows what that run cost. The whole app stack is real — executor, usage
 * recorder, ledger, `/api/usage`, and the console UI. The ONLY thing faked is
 * the external the app calls out to: the AI provider, replaced by the env-gated
 * `e2e-fake` provider, which emits exactly the usage in the directive below. So
 * the run genuinely creates the data; the UI genuinely reads it back.
 *
 * Every spec scopes the console to its own runId — all specs in a worker share
 * one Archon instance (one DB), so the runId filter keeps assertions independent.
 */

// E1 — a provider that reports a USD cost: it lands in the reported column, not
// the estimate. Single-line so it passes cleanly as one CLI argument.
const E1_REPORTS_COST =
  '<<E2E_USAGE>>[{"provider":"anthropic","model":"claude-sonnet-4","modelSource":"reported","inputTokens":1000,"outputTokens":500,"costUsd":0.42}]<</E2E_USAGE>>';

test('[P0] a workflow run records its reported AI cost and the usage and cost section shows it', async ({
  page,
  archon,
}) => {
  // Arrange + act: run the workflow for real; its (faked) AI reports $0.42.
  const runId = await archon.runWorkflow(E1_REPORTS_COST);

  // Assert: the cost console, scoped to this run, surfaces the recorded cost.
  await openCostForRun(page, runId);

  await expect(page.locator('#set-usage').getByText('$0.42').first()).toBeVisible({
    timeout: T.medium,
  });
  await expect(page.locator('#set-usage').getByText('anthropic').first()).toBeVisible();
  // Ledger coverage proves exactly one real recorded run (not a UI-only render).
  await expect(page.locator('#set-usage').getByText('1/1 ledgered')).toBeVisible();
});
