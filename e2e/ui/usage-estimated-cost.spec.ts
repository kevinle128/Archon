import { test, expect } from '../lib/playwright/suite';
import { openCostForRun } from '../lib/playwright/cost-console';
import { T } from '../lib/playwright/timeouts';

/**
 * E2 — a provider that reports only TOKENS (no USD). Archon estimates the cost
 * from the seeded per-1M rates (estimate.ts config tier) and shows it in the
 * ESTIMATED column, distinct from reported. This is the token->USD map the
 * feature relies on for tokens-only providers (Codex/Copilot).
 *
 * The runtime seeds `(openai, e2e-priced-model)` at input 2.0 / output 10.0 per
 * 1M. 1,000,000 in + 1,000,000 out => 2.0 + 10.0 = $12.00, rendered "≈$12.00"
 * (the ≈ marks it as an estimate, never a reported charge).
 */
const E2_TOKENS_ONLY_PRICED =
  '<<E2E_USAGE>>[{"provider":"openai","model":"e2e-priced-model","modelSource":"reported","inputTokens":1000000,"outputTokens":1000000}]<</E2E_USAGE>>';

test('[P1] a tokens-only run shows an estimated cost, not a reported one', async ({
  page,
  archon,
}) => {
  const runId = await archon.runWorkflow(E2_TOKENS_ONLY_PRICED);

  await openCostForRun(page, runId);

  // Estimated column carries the computed cost, prefixed ≈.
  await expect(page.locator('#set-usage').getByText('≈$12.00').first()).toBeVisible({
    timeout: T.medium,
  });
  await expect(page.locator('#set-usage').getByText('openai').first()).toBeVisible();
  // No reported USD for this run: reported renders as n/a, so no bare "$12.00".
  await expect(page.locator('#set-usage').getByText('$12.00', { exact: true })).toHaveCount(0);
});
