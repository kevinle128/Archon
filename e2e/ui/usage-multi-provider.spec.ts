import { test, expect } from '../lib/playwright/suite';
import { openCostForRun } from '../lib/playwright/cost-console';
import { T } from '../lib/playwright/timeouts';

/**
 * E8 — one run whose usage spans two providers. Grouped by provider (the default),
 * the cost console shows a row per provider with that provider's own reported
 * cost — proving usage is attributed and aggregated per provider, not lumped.
 */
const E8_MULTI_PROVIDER =
  '<<E2E_USAGE>>[' +
  '{"provider":"anthropic","model":"claude-sonnet-4","modelSource":"reported","inputTokens":800,"outputTokens":400,"costUsd":0.30},' +
  '{"provider":"openai","model":"gpt-5.4","modelSource":"reported","inputTokens":600,"outputTokens":300,"costUsd":0.20}' +
  ']<</E2E_USAGE>>';

test('[P1] a run spanning two providers shows a per-provider cost breakdown', async ({
  page,
  archon,
}) => {
  const runId = await archon.runWorkflow(E8_MULTI_PROVIDER);

  await openCostForRun(page, runId);

  // Both providers appear as their own groups...
  await expect(page.locator('#set-usage').getByText('anthropic').first()).toBeVisible({
    timeout: T.medium,
  });
  await expect(page.locator('#set-usage').getByText('openai').first()).toBeVisible();
  // ...each carrying its own reported cost.
  await expect(page.locator('#set-usage').getByText('$0.30').first()).toBeVisible();
  await expect(page.locator('#set-usage').getByText('$0.20').first()).toBeVisible();
});
