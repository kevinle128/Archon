import { test, expect } from '../lib/playwright/suite';
import { openRunDetail } from '../lib/playwright/run-detail';
import { T } from '../lib/playwright/timeouts';

/**
 * Feature: AI usage / cost tracking (PR #71) — the RUN-DETAIL surface.
 *
 * The Cost page (covered by the other usage-*.spec.ts files) is one of two
 * browser read surfaces this feature ships. The other is run detail, whose
 * outcome the PR states verbatim: "run detail shows node-level usage without
 * child-run rollups." That surface has its own components (RunDetailHeader cost
 * strip + per-node NodeDivider) reading GET /api/workflows/runs/:id `usage`
 * grouped by node — a distinct path from GET /api/usage, so it needs its own
 * end-to-end proof.
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

  // Header cost strip: the direct-run ledger reading (reported USD + the "direct"
  // marker), distinct from any legacy run total.
  await expect(page.getByText('$0.42').first()).toBeVisible({ timeout: T.medium });
  await expect(page.getByText('direct', { exact: true })).toBeVisible();

  // Node-level usage: the `emit-usage` node divider carries this node's own
  // recorded cost. Scope to the collision-safe execution-row anchor so this is
  // the NODE row rather than the header total.
  const nodeDivider = page.locator('[id^="node-transition-"]', { hasText: 'emit-usage' }).first();
  await expect(nodeDivider).toBeVisible();
  await expect(nodeDivider).toContainText('emit-usage');
  await expect(nodeDivider).toContainText('$0.42');

  // Expand the node to prove the per-node provider/model breakdown, not just a
  // rolled-up number: the dedicated disclosure preserves node selection behavior.
  await nodeDivider.getByRole('button', { name: 'Show usage breakdown for this node' }).click();
  await expect(page.getByText('Usage · emit-usage')).toBeVisible({ timeout: T.medium });
  await expect(page.getByText(/anthropic\/claude-sonnet-4/).first()).toBeVisible();
});
