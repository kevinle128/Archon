import { test, expect } from '../lib/playwright/suite';
import { openCostForRun, setKindFilter } from '../lib/playwright/cost-console';
import { T } from '../lib/playwright/timeouts';

/**
 * E4 + E5 — hidden delegated work is classified by `kind`. A single run emits a
 * primary usage row plus an `advisor` row and a `subagent` row (as OMP/OpenCode
 * report). The Kind filter isolates each classification, proving the ledger
 * carries the distinction and the console can surface it.
 */
const E4E5_KINDS =
  '<<E2E_USAGE>>[' +
  '{"provider":"anthropic","model":"claude-sonnet-4","modelSource":"reported","inputTokens":1000,"outputTokens":500,"costUsd":0.10},' +
  '{"provider":"anthropic","model":"claude-sonnet-4","modelSource":"reported","inputTokens":200,"outputTokens":100,"costUsd":0.05,"kind":"advisor"},' +
  '{"provider":"anthropic","model":"claude-sonnet-4","modelSource":"reported","inputTokens":300,"outputTokens":150,"costUsd":0.07,"kind":"subagent"}' +
  ']<</E2E_USAGE>>';

test('[P1] advisor and subagent usage are classified and filterable by kind', async ({
  page,
  archon,
}) => {
  const runId = await archon.runWorkflow(E4E5_KINDS);

  await openCostForRun(page, runId);

  // Filter to advisor: only the advisor row's cost remains; the primary is gone.
  await setKindFilter(page, 'Advisor');
  await expect(page.locator('#set-usage').getByText('$0.05').first()).toBeVisible({
    timeout: T.medium,
  });
  await expect(page.locator('#set-usage').getByText('$0.10', { exact: true })).toHaveCount(0);

  // Filter to subagent: only the subagent row's cost remains.
  await setKindFilter(page, 'Subagent');
  await expect(page.locator('#set-usage').getByText('$0.07').first()).toBeVisible({
    timeout: T.medium,
  });
  await expect(page.locator('#set-usage').getByText('$0.05', { exact: true })).toHaveCount(0);
});
