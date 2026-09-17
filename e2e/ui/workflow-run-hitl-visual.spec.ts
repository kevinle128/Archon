import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { type Locator, type Page } from '@playwright/test';

import { test, expect } from '../lib/playwright/suite';
import { HITL_INSPECT_NODE } from '../lib/playwright/archon-runtime';
import { openLegacyRunDetail, openRunDetail } from '../lib/playwright/run-detail';
import { T } from '../lib/playwright/timeouts';

/**
 * Visual acceptance captures for HITL mockup alignment.
 *
 * These are review artifacts, not self-approving app snapshots. Compare each
 * actual capture against the canonical mockup in
 * `_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup/` and record the
 * verdict in `plans/reports/acceptance-260908-story-5-6.md`.
 *
 * Product room size is asserted against the percentage contract only.
 * Mockup fixed-pixel widths are not used as product sizing assertions.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CAPTURE_DIR = join(
  REPO_ROOT,
  'plans',
  '260907-1454-workflow-run-hitl-mockup-alignment',
  'reports',
  'captures'
);
const MOCKUP_CONSOLE = join(
  REPO_ROOT,
  '_bmad-output',
  'specs',
  'spec-workflow-run-view-hitl',
  'ux-mockup',
  'console.html'
);
const MOCKUP_LEGACY = join(
  REPO_ROOT,
  '_bmad-output',
  'specs',
  'spec-workflow-run-view-hitl',
  'ux-mockup',
  'index.html'
);

const VIEWPORTS = [
  { name: '1440x1000', width: 1440, height: 1000 },
  { name: '1024x900', width: 1024, height: 900 },
  { name: '768x900', width: 768, height: 900 },
  { name: '390x844', width: 390, height: 844 },
] as const;

function panelLocator(page: Page, id: string): Locator {
  return page.locator(`[data-panel-id="${id}"], #${id}`).first();
}

async function measureProductRatio(
  page: Page,
  surface: 'console' | 'legacy'
): Promise<number | null> {
  const viewId = surface === 'console' ? 'console-run-view' : 'legacy-run-view';
  const roomId = surface === 'console' ? 'console-run-room' : 'legacy-run-room';
  const view = panelLocator(page, viewId);
  const room = panelLocator(page, roomId);
  if ((await view.count()) === 0 || (await room.count()) === 0) return null;
  if (!(await view.isVisible()) || !(await room.isVisible())) return null;
  const viewBox = await view.boundingBox();
  const roomBox = await room.boundingBox();
  if (viewBox === null || roomBox === null) return null;
  const total = viewBox.width + roomBox.width;
  if (total <= 0) return null;
  return roomBox.width / total;
}

async function captureAtTwoHundredPercentZoom(
  page: Page,
  surface: 'console' | 'legacy',
  roomName: string
): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const normalWidth = await page.evaluate(() => window.innerWidth);
  const chrome = await page.context().newCDPSession(page);
  try {
    await chrome.send('Emulation.setDeviceMetricsOverride', {
      width: normalWidth / 2,
      height: 500,
      deviceScaleFactor: 2,
      mobile: false,
      screenWidth: normalWidth,
      screenHeight: 1000,
    });
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(normalWidth / 2);
    await expect(page.getByRole('region', { name: roomName })).toBeVisible();
    await page.screenshot({
      path: join(CAPTURE_DIR, `${surface}-actual-200-percent-zoom.png`),
      fullPage: true,
    });
  } finally {
    await chrome.send('Emulation.clearDeviceMetricsOverride');
    await chrome.detach();
  }
}

test('[P1] [V:hitl.visual-captures] HITL visual: Console and Legacy vs canonical mockup at required viewports', async ({
  page,
  archon,
}) => {
  const started = await archon.runHitlWorkflow();
  mkdirSync(CAPTURE_DIR, { recursive: true });

  await openRunDetail(page, started.runId, HITL_INSPECT_NODE);
  await expect(page.getByText(/Awaiting input/i).first()).toBeVisible({ timeout: T.medium });
  const room = page.getByRole('region', { name: `${HITL_INSPECT_NODE} room` });
  // Readiness must see the collapsed row's own summary — never descendant text
  // that could satisfy the locator while still hidden inside a closed row.
  await expect(room.locator('details[data-tool-id] > summary').first()).toBeVisible({
    timeout: T.medium,
  });
  await expect(page.getByRole('region', { name: `${HITL_INSPECT_NODE} room` })).toBeVisible();

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await expect(page.getByText(/e2e-hitl-run/i).first()).toBeVisible();
    await expect(page.getByRole('region', { name: `${HITL_INSPECT_NODE} room` })).toBeVisible();
    const ratio = await measureProductRatio(page, 'console');
    if (ratio !== null) {
      expect(ratio).toBeGreaterThanOrEqual(0.24);
      expect(ratio).toBeLessThanOrEqual(0.6);
    }
    await page.screenshot({
      path: join(CAPTURE_DIR, 'console-actual-' + viewport.name + '.png'),
      fullPage: true,
    });
  }
  await captureAtTwoHundredPercentZoom(page, 'console', `${HITL_INSPECT_NODE} room`);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await openLegacyRunDetail(page, started.runId);
  await expect(page.getByText(/e2e-hitl-run/i).first()).toBeVisible({ timeout: T.medium });
  await page.getByRole('tab', { name: 'Logs' }).click();
  await page
    .getByRole('button', { name: new RegExp(HITL_INSPECT_NODE) })
    .first()
    .click();
  await expect(page.getByRole('region', { name: `${HITL_INSPECT_NODE} room` })).toBeVisible({
    timeout: T.medium,
  });

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await expect(page.getByRole('region', { name: `${HITL_INSPECT_NODE} room` })).toBeVisible();
    const ratio = await measureProductRatio(page, 'legacy');
    if (ratio !== null) {
      expect(ratio).toBeGreaterThanOrEqual(0.24);
      expect(ratio).toBeLessThanOrEqual(0.6);
    }
    await page.screenshot({
      path: join(CAPTURE_DIR, 'legacy-actual-' + viewport.name + '.png'),
      fullPage: true,
    });
  }
  await captureAtTwoHundredPercentZoom(page, 'legacy', `${HITL_INSPECT_NODE} room`);

  await page.goto(pathToFileURL(MOCKUP_CONSOLE).href);
  await expect(page).toHaveTitle('Archon Console — Workflow Run (HITL mockup)');
  await expect(page.locator('#cc-app')).toBeVisible({ timeout: T.short });
  await expect(page.getByRole('button', { name: 'Log', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Graph', exact: true })).toBeVisible();
  await expect(page.locator('#cc-composer input')).toBeVisible();
  await expect.poll(async () => page.locator('#cc-stream .cc-node').count()).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Log', exact: true }).click();
  const consoleMockupRow = page.locator('#cc-stream section[data-node="clarify"] .cc-divider');
  await expect(consoleMockupRow).toBeVisible({ timeout: T.medium });
  await consoleMockupRow.click();
  await expect(page.locator('#node-panel:not(.closed)')).toBeVisible();
  await expect(page.locator('#panel-header .ph-name')).toHaveText('clarify');
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await expect(page.locator('body')).toBeVisible();
    await page.screenshot({
      path: join(CAPTURE_DIR, 'console-mockup-' + viewport.name + '.png'),
      fullPage: true,
    });
  }

  await page.goto(pathToFileURL(MOCKUP_LEGACY).href);
  await expect(page).toHaveTitle('Archon — Workflow Run View (HITL mockup)');
  await expect(page.locator('#app')).toBeVisible({ timeout: T.short });
  await expect(page.getByRole('button', { name: 'starter', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'teammate', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Logs', exact: true })).toBeVisible();
  await expect(page.locator('#chat-input')).toHaveCount(1);
  await expect.poll(async () => page.locator('#graph-world .gnode').count()).toBeGreaterThan(10);
  await page.getByRole('button', { name: 'Logs', exact: true }).click();
  const legacyMockupRow = page.locator('#logs-list .logrun', { hasText: 'clarify' }).first();
  await expect(legacyMockupRow).toBeVisible({ timeout: T.medium });
  await legacyMockupRow.click();
  await expect(page.locator('#node-panel:not(.closed)')).toBeVisible();
  await expect(page.locator('#panel-header .ph-name')).toHaveText('clarify');
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await expect(page.locator('body')).toBeVisible();
    await page.screenshot({
      path: join(CAPTURE_DIR, 'legacy-mockup-' + viewport.name + '.png'),
      fullPage: true,
    });
  }
});
