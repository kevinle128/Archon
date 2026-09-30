import { test, expect } from '../lib/playwright/suite';
import { openCostForRun } from '../lib/playwright/cost-console';
import { T } from '../lib/playwright/timeouts';

/**
 * E7 — a run that records NO AI usage (its node emitted no usage). The console
 * must say "no usage recorded", explicitly distinct from a known $0.00 cost.
 * Missing is not zero: the recorder writes no event at all (usage-recorder
 * skips empty usage), so the scope is genuinely empty, not a $0 charge.
 */
test('[P1] a run with no recorded usage shows "no usage", never $0', async ({ page, archon }) => {
  // A message with no <<E2E_USAGE>> directive -> the fake emits no usage.
  const runId = await archon.runWorkflow('e2e no-usage scenario: nothing to record here');

  await openCostForRun(page, runId);

  await expect(page.locator('#set-usage').getByText('No usage recorded')).toBeVisible({
    timeout: T.medium,
  });
  await expect(
    page.locator('#set-usage').getByText(/not the same as a known \$0\.00 cost/)
  ).toBeVisible();
});
