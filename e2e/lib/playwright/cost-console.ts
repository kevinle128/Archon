import { expect, type Page } from '@playwright/test';

import { T } from './timeouts';

/**
 * Open the Settings usage and cost section scoped to a single run. Every spec scopes to its own
 * runId because all specs in a worker share one Archon instance (one DB) — the
 * runId filter is what keeps each spec's assertions independent of the others'
 * accumulated ledger rows.
 */
export async function openCostForRun(page: Page, runId: string): Promise<void> {
  await page.goto('/settings');
  await page.locator('#set-usage').scrollIntoViewIfNeeded();
  await page.getByLabel('Run ID', { exact: true }).fill(runId);
  await applyFilters(page);
  // The caller's own `expect(...).toBeVisible()` waits for this run's rows.
}

/**
 * Pick a Kind filter value ('Advisor' | 'Subagent' | 'Any kind' | ...) and
 * re-apply. The Kind `<select>` sits inside a styled wrapper, so implicit label
 * association is unreliable; identify it as the one select carrying an
 * 'Advisor' option instead.
 */
export async function setKindFilter(page: Page, label: string): Promise<void> {
  const kindSelect = page
    .locator('select')
    .filter({ has: page.locator('option', { hasText: 'Advisor' }) });
  await kindSelect.selectOption({ label });
  await applyFilters(page);
}

async function applyFilters(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Apply' }).click();
  // The table re-renders after the applied query resolves; give it a beat.
  await expect(page.getByRole('button', { name: 'Apply' })).toBeEnabled({ timeout: T.medium });
}
