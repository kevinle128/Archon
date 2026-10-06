import { test, expect } from '../lib/playwright/suite';
import { openRunDetail } from '../lib/playwright/run-detail';
import { T } from '../lib/playwright/timeouts';

/**
 * Feature: AI usage / cost tracking (PR #71) - the RUN-DETAIL surface.
 *
 * The Cost page (covered by the other usage-*.spec.ts files) is one of two
 * browser read surfaces this feature ships. The other is run detail: the header
 * metadata row carries the run's cost and each node room offers a usage
 * breakdown. Both read GET /api/workflows/runs/:id `usage` grouped by node - a
 * distinct path from GET /api/usage, so it needs its own end-to-end proof.
 *
 * Same real stack as the cost specs: executor -> usage recorder -> ledger ->
 * run-detail API -> the web UI. The only faked thing is the AI provider
 * (the env-gated `e2e-fake` provider), which emits exactly the usage below.
 */

// Reuses the E1 shape: a provider that reports a USD cost. One node (`emit-usage`),
// anthropic/claude-sonnet-4, 1,000 in / 500 out, reported $0.42.
const E1_REPORTS_COST =
  '<<E2E_USAGE>>[{"provider":"anthropic","model":"claude-sonnet-4","modelSource":"reported","inputTokens":1000,"outputTokens":500,"costUsd":0.42}]<</E2E_USAGE>>';

test('[P1] run detail shows the run node-level usage for its AI pass', async ({ page, archon }) => {
  // Arrange + act: run the workflow for real; its (faked) AI reports $0.42.
  const runId = await archon.runWorkflow(E1_REPORTS_COST);

  // Assert: open this run's detail page (project id read back from the real API).
  await openRunDetail(page, runId);

  // Header cost: reported and estimated USD read as separate values.
  const runCost = page.getByTestId('run-cost');
  await expect(runCost).toBeVisible({ timeout: T.medium });
  await expect(runCost).toContainText('$0.42');
  await expect(runCost).toContainText('reported');
  await expect(runCost).toContainText('n/a estimated');

  // Node-level usage: open the `emit-usage` node room; its quiet control expands a
  // per-node provider/model breakdown, not just a rolled-up number.
  await openRunDetail(page, runId, 'emit-usage');
  const usage = page.getByTestId('node-usage');
  await expect(usage).toBeVisible({ timeout: T.medium });
  await expect(usage).toContainText('$0.42');
  await usage.getByRole('button', { name: /Show usage breakdown/ }).click();
  await expect(usage.getByText('Usage · emit-usage')).toBeVisible({ timeout: T.medium });
  await expect(usage.getByText(/anthropic\/claude-sonnet-4/).first()).toBeVisible();
  await expect(usage.getByRole('button', { name: /Hide usage breakdown/ })).toBeVisible();
});
