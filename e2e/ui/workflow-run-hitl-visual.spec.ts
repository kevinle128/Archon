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
 * Product room size is the fixed outer panel width (Console 520 / Legacy 460
 * CSS px in split mode). Historical mockup captures are retained for review;
 * mockup fixed-pixel layouts are not treated as authoritative product geometry.
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

const ROOM_WIDTH_PX = { console: 520, legacy: 460 } as const;
const OUTER_WIDTH_TOLERANCE_PX = 1;
const ROOM_MIN_WIDTH_PX = 240;

/**
 * Outer Node Room panel width when both the run view and room are visible
 * (split mode). Returns null when either panel is missing/hidden — callers
 * then treat the layout as single-mode room fill.
 */
async function measureOuterRoomWidth(
  page: Page,
  surface: 'console' | 'legacy'
): Promise<number | null> {
  const viewId = surface === 'console' ? 'console-run-view' : 'legacy-run-view';
  const roomId = surface === 'console' ? 'console-run-room' : 'legacy-run-room';
  const view = panelLocator(page, viewId);
  const room = panelLocator(page, roomId);
  if ((await view.count()) === 0 || (await room.count()) === 0) return null;
  if (!(await view.isVisible()) || !(await room.isVisible())) return null;
  const roomBox = await room.boundingBox();
  if (roomBox === null || roomBox.width <= 0) return null;
  return roomBox.width;
}

/**
 * Split mode: fixed outer width Console 520 / Legacy 460 ±1.
 * Single mode (room visible, view hidden): room fills available width (>240
 * and roughly the full container).
 */
async function expectProductRoomGeometry(page: Page, surface: 'console' | 'legacy'): Promise<void> {
  const roomId = surface === 'console' ? 'console-run-room' : 'legacy-run-room';
  const viewId = surface === 'console' ? 'console-run-view' : 'legacy-run-view';
  const splitWidth = await measureOuterRoomWidth(page, surface);
  if (splitWidth !== null) {
    const expected = ROOM_WIDTH_PX[surface];
    expect(
      Math.abs(splitWidth - expected),
      `${surface} outer room ${String(splitWidth)}px must be ${String(expected)}±${String(OUTER_WIDTH_TOLERANCE_PX)}`
    ).toBeLessThanOrEqual(OUTER_WIDTH_TOLERANCE_PX);
    return;
  }

  // Single mode: room fills available width (view hidden or absent).
  const room = panelLocator(page, roomId);
  await expect(room, `${roomId} must be visible in single mode`).toBeVisible({ timeout: T.medium });
  const roomBox = await room.boundingBox();
  expect(roomBox, `${roomId} bounding box`).toBeTruthy();
  const width = roomBox?.width ?? 0;
  expect(width, `${surface} single-mode room width must be non-zero`).toBeGreaterThan(0);
  expect(width, `${surface} single-mode room fills container`).toBeGreaterThan(ROOM_MIN_WIDTH_PX);

  const view = panelLocator(page, viewId);
  const viewVisible = (await view.count()) > 0 && (await view.isVisible().catch(() => false));
  expect(viewVisible, `${surface} single-mode expects run view hidden`).toBe(false);

  const available = await page.evaluate(id => {
    const el = document.querySelector(`#${id}, [data-panel-id="${id}"]`);
    if (!(el instanceof HTMLElement)) return 0;
    const parent = el.parentElement;
    if (parent instanceof HTMLElement) {
      const cs = getComputedStyle(parent);
      const pad =
        (Number.parseFloat(cs.paddingLeft) || 0) + (Number.parseFloat(cs.paddingRight) || 0);
      return Math.max(0, parent.getBoundingClientRect().width - pad);
    }
    return window.innerWidth;
  }, roomId);
  if (available > 0) {
    // Roughly full available: allow chrome/margins but reject a collapsed pane.
    expect(
      width,
      `${surface} single-mode room ${String(width)}px should fill ~available ${String(available)}px`
    ).toBeGreaterThan(available * 0.7);
  }
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
    await expectProductRoomGeometry(page, 'console');
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
    await expectProductRoomGeometry(page, 'legacy');
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
