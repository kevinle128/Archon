import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { env } from 'node:process';
import { join } from 'node:path';

import { expect, type Page } from '@playwright/test';

import { test } from '../lib/playwright/suite';
import { HITL_ASK_NODE } from '../lib/playwright/archon-runtime';
import { openRunDetail } from '../lib/playwright/run-detail';
import { T } from '../lib/playwright/timeouts';

/**
 * Feature: run artifacts browser.
 *
 * The header Artifacts button opens a panel beside the run body that lists
 * every file on disk for the run. The node room must stay open next to it.
 */

/** Optional screenshot output; unset in CI so the spec writes nothing. */
const SHOT_DIR = env.ARCHON_ARTIFACT_SHOTS;

async function shoot(page: Page, name: string): Promise<void> {
  if (SHOT_DIR === undefined || SHOT_DIR === '') return;
  mkdirSync(SHOT_DIR, { recursive: true });
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    // The theme class is applied from stored preference; mirror the scheme on <html>.
    await page.evaluate(mode => {
      document.documentElement.classList.toggle('dark', mode === 'dark');
    }, scheme);
    await page.screenshot({ path: join(SHOT_DIR, `${name}-${scheme}.png`) });
  }
}

/** Find `<home>/workspaces/**\/artifacts/runs/<runId>` without knowing the project slug. */
function findRunArtifactDir(root: string, runId: string): string | null {
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (!statSync(full).isDirectory()) continue;
      if (entry === runId && dir.endsWith(join('artifacts', 'runs'))) return full;
      stack.push(full);
    }
  }
  return null;
}

test('[P1] [V:artifacts.panel-lists-disk-files] the panel lists files on disk and renders the selected one', async ({
  page,
  archon,
}) => {
  const runId = await archon.runWorkflow();
  const dir = findRunArtifactDir(join(archon.home, 'workspaces'), runId);
  expect(dir, `artifact directory for run ${runId}`).not.toBeNull();
  writeFileSync(join(dir as string, 'report.md'), '# Findings\n\nAll **good**.\n');
  mkdirSync(join(dir as string, 'logs'), { recursive: true });
  writeFileSync(join(dir as string, 'logs', 'out.txt'), 'plain text line\n');

  await openRunDetail(page, runId);
  await page.getByRole('button', { name: /^Artifacts/ }).click();

  const panel = page.getByTestId('run-artifacts-panel');
  await expect(panel).toBeVisible({ timeout: T.medium });
  const files = panel.getByRole('navigation', { name: 'Artifact files' });
  await expect(files.getByRole('button', { name: /logs\/out\.txt/ })).toBeVisible({
    timeout: T.medium,
  });
  const report = files.getByRole('button', { name: /report\.md/ });
  await expect(report).toBeVisible();

  // Markdown renders as rich text, not raw source.
  await report.click();
  await expect(report).toHaveClass(/bg-accent-muted/);
  await expect(panel.getByRole('heading', { name: 'Findings' })).toBeVisible({
    timeout: T.medium,
  });

  await shoot(page, 'panel-markdown');

  // Other files render as monospace plain text.
  await files.getByRole('button', { name: /logs\/out\.txt/ }).click();
  await expect(panel.locator('pre', { hasText: 'plain text line' })).toBeVisible({
    timeout: T.medium,
  });
  await shoot(page, 'panel-with-files');
});

test('[P1] [V:artifacts.panel-empty-room-stays] the empty panel keeps the node room open and closes with Escape', async ({
  page,
  archon,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const started = await archon.runHitlWorkflow();
  await openRunDetail(page, started.runId, HITL_ASK_NODE);
  const room = page.getByTestId('legacy-node-room');
  await expect(room).toBeVisible({ timeout: T.medium });

  const button = page.getByRole('button', { name: /^Artifacts/ });
  await expect(button).toBeEnabled();
  await button.click();

  const panel = page.getByTestId('run-artifacts-panel');
  await expect(panel).toBeVisible({ timeout: T.medium });
  await expect(panel.getByText('No artifacts written to disk for this run.')).toBeVisible({
    timeout: T.medium,
  });
  // The room stays visible and both surfaces have real width side by side.
  await expect(room).toBeVisible();
  const roomBox = await room.boundingBox();
  const panelBox = await panel.boundingBox();
  expect(roomBox?.width ?? 0).toBeGreaterThan(240);
  expect((roomBox?.x ?? 0) + (roomBox?.width ?? 0)).toBeLessThanOrEqual((panelBox?.x ?? 0) + 1);
  await shoot(page, 'panel-empty');

  await panel.getByRole('button', { name: 'Close artifacts' }).click();
  await expect(panel).toHaveCount(0);
  await expect(room).toBeVisible();

  await button.click();
  await expect(panel).toBeVisible({ timeout: T.medium });
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(room).toBeVisible();
});
