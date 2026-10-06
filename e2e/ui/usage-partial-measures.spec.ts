import { test, expect } from '../lib/playwright/suite';
import { openCostForRun } from '../lib/playwright/cost-console';
import { T } from '../lib/playwright/timeouts';

/**
 * E9 — a recorded row that is missing some token measures. Archon counts each
 * absent measure as MISSING, never coerces it to zero. Here the entry reports
 * input tokens and a cost but no output tokens, so "Missing measures" shows
 * `out:1` (and `in:0`), proving absence is tracked, not zeroed.
 */
const E9_PARTIAL_MEASURES =
  '<<E2E_USAGE>>[{"provider":"anthropic","model":"claude-partial-e2e","modelSource":"reported","inputTokens":500,"costUsd":0.09}]<</E2E_USAGE>>';

test('[P1] absent token measures are counted as missing, not zero', async ({ page, archon }) => {
  const runId = await archon.runWorkflow(E9_PARTIAL_MEASURES);

  await openCostForRun(page, runId);

  // The row is recorded with its reported cost...
  await expect(page.locator('#set-usage').getByText('$0.09').first()).toBeVisible({
    timeout: T.medium,
  });
  // ...and the absent output measure is counted (out:1), while input is present (in:0).
  const missing = page.locator('#set-usage').getByText(/missing measures/);
  await expect(missing).toContainText('out:1');
  await expect(missing).toContainText('in:0');
});
