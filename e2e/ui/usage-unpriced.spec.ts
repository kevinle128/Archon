import { test, expect } from '../lib/playwright/suite';
import { openCostForRun } from '../lib/playwright/cost-console';
import { T } from '../lib/playwright/timeouts';

/**
 * E3 — a tokens-only run whose (provider, model) has NO known rate. Archon
 * records the tokens but cannot price them, so it shows the row as unpriced —
 * NOT as a $0.00 charge. The `Unpriced rows` total counts it.
 *
 * `codex/gpt-unpriced-e2e` is deliberately absent from the seeded pricing, so
 * neither the reported nor the estimated path can produce a cost.
 */
const E3_TOKENS_ONLY_UNPRICED =
  '<<E2E_USAGE>>[{"provider":"codex","model":"gpt-unpriced-e2e","modelSource":"reported","inputTokens":1234,"outputTokens":567}]<</E2E_USAGE>>';

test('[P1] a tokens-only run with no known rate is unpriced, not $0', async ({ page, archon }) => {
  const runId = await archon.runWorkflow(E3_TOKENS_ONLY_UNPRICED);

  await openCostForRun(page, runId);

  // Tokens are recorded...
  await expect(page.locator('#set-usage').getByText('1,234').first()).toBeVisible({
    timeout: T.medium,
  });
  // ...and the row is counted as unpriced (one row, no cost).
  const row = page.getByRole('row').filter({ hasText: '1,234' }).first();
  await expect(row.getByRole('cell').last()).toHaveText('1');
  // No cost is shown at all — neither a reported "$x" nor an estimated "≈$x".
  await expect(page.locator('#set-usage').getByText(/\$[0-9]/)).toHaveCount(0);
});
