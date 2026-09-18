import { type Locator, type Page } from '@playwright/test';

import { test, expect } from '../lib/playwright/suite';
import {
  TODO_STRIP_NO_TODO_NODE,
  TODO_STRIP_TODO_NODE,
  type ArchonRuntime,
  type CliRunResult,
  UnsupportedSetupError,
} from '../lib/playwright/archon-runtime';
import { openLegacyRunDetail, openRunDetail } from '../lib/playwright/run-detail';
import { T } from '../lib/playwright/timeouts';

/**
 * Pinned todo strip — outside-in behavior contract (issue #178, Phase 1).
 *
 * The `e2e-todo-strip` fixture runs `todo-plan` (four folded `todo` calls —
 * init 12 items across Research/Implement, done, block, drop — plus 60 Read
 * calls for real scroll depth) alongside `no-todo` (tool calls only). These
 * cases are RED until the strip renderer mounts: each one must reach the real
 * room and fail only on the missing `section[aria-label="Todo"]`.
 */

type Surface = 'console' | 'legacy';

const STRIP = 'section[aria-label="Todo"]';
const TOOL_ROW = 'details[data-tool-id]';
const TODO_METER = '[data-testid="todo-meter"]';
const SCROLLER_TESTID: Record<Surface, string> = {
  console: 'console-node-room-scroll',
  legacy: 'node-transcript-scroll',
};

function roomRegion(page: Page, nodeId: string): Locator {
  return page.getByRole('region', { name: `${nodeId} room` });
}

async function openNodeRoom(
  page: Page,
  surface: Surface,
  runId: string,
  nodeId: string
): Promise<Locator> {
  if (surface === 'console') {
    await openRunDetail(page, runId, nodeId);
  } else {
    await openLegacyRunDetail(page, runId);
    await expect(page.getByText(/e2e-todo-strip/i).first()).toBeVisible({ timeout: T.medium });
    const logsTab = page.getByRole('tab', { name: 'Logs' });
    if ((await logsTab.count()) > 0) await logsTab.click();
    await page
      .getByRole('button', { name: new RegExp(nodeId) })
      .first()
      .click();
  }
  const room = roomRegion(page, nodeId);
  await expect(room).toBeVisible({ timeout: T.medium });
  await expect(room.locator(TOOL_ROW).first()).toBeVisible({ timeout: T.medium });
  return room;
}

/** The strip's collapsible body element, resolved through the header's aria-controls. */
async function stripBody(strip: Locator): Promise<Locator> {
  const button = strip.getByRole('button');
  const bodyId = await button.getAttribute('aria-controls');
  expect(bodyId, 'todo strip header button exposes aria-controls').toBeTruthy();
  return strip.locator(`[id="${bodyId ?? ''}"]`);
}

/** ids of transcript tool rows currently intersecting the scroller's viewport band. */
async function visibleToolIds(scroller: Locator): Promise<string[]> {
  return scroller.evaluate(el => {
    const band = el.getBoundingClientRect();
    return Array.from(el.querySelectorAll('details[data-tool-id]'))
      .filter(row => {
        const rect = row.getBoundingClientRect();
        return rect.bottom > band.top && rect.top < band.bottom;
      })
      .map(row => row.getAttribute('data-tool-id') ?? '');
  });
}

async function runTodoStrip(page: Page, archon: ArchonRuntime): Promise<CliRunResult> {
  try {
    return await archon.runTodoStripWorkflow();
  } catch (error) {
    if (error instanceof UnsupportedSetupError) {
      test.info().annotations.push({ type: 'verification-setup', description: 'unsupported' });
    }
    throw error;
  }
}

for (const surface of ['console', 'legacy'] as const) {
  test(`[P1] todo strip mounts once inside the todo-plan room and never inside no-todo on ${surface}`, async ({
    page,
    archon,
  }) => {
    test.setTimeout(T.xlong * 2);
    const run = await runTodoStrip(page, archon);
    const room = await openNodeRoom(page, surface, run.runId, TODO_STRIP_TODO_NODE);
    await expect(room.locator(STRIP)).toHaveCount(1);
    const plainRoom = await openNodeRoom(page, surface, run.runId, TODO_STRIP_NO_TODO_NODE);
    await expect(plainRoom.locator(STRIP)).toHaveCount(0);
  });

  test(`[P1] todo strip starts collapsed with the representative item and 1/12 on ${surface}`, async ({
    page,
    archon,
  }) => {
    test.setTimeout(T.xlong * 2);
    const run = await runTodoStrip(page, archon);
    const room = await openNodeRoom(page, surface, run.runId, TODO_STRIP_TODO_NODE);
    const strip = room.locator(STRIP);
    await expect(strip).toHaveCount(1);
    const button = strip.getByRole('button');
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(button).toContainText('Map the message path');
    await expect(button).toContainText('1/12');
    const body = await stripBody(strip);
    await expect(body).toBeHidden();
  });

  test(`[P1] todo strip expands on Enter, lists all five statuses, collapses on Space on ${surface}`, async ({
    page,
    archon,
  }) => {
    test.setTimeout(T.xlong * 2);
    const run = await runTodoStrip(page, archon);
    const room = await openNodeRoom(page, surface, run.runId, TODO_STRIP_TODO_NODE);
    const strip = room.locator(STRIP);
    await expect(strip).toHaveCount(1);
    const button = strip.getByRole('button');
    const body = await stripBody(strip);
    await button.press('Enter');
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(body).toBeVisible();
    await expect(body.getByRole('heading', { name: 'Research' })).toBeVisible();
    await expect(body.getByRole('heading', { name: 'Implement' })).toBeVisible();
    // One named example per status: completed, in progress, blocked, pending, abandoned.
    await expect(body.getByText('Read the spec')).toBeVisible();
    await expect(body.getByText('Map the message path')).toBeVisible();
    await expect(body.getByText('Run the suite')).toBeVisible();
    await expect(body.getByText(/blocked: CI has one build job/)).toBeVisible();
    await expect(body.getByText('Check contract conflicts')).toBeVisible();
    await expect(body.getByText('Review output')).toBeVisible();
    expect(await button.evaluate(el => el.ownerDocument.activeElement === el)).toBe(true);
    await button.press('Space');
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(body).toBeHidden();
    expect(await button.evaluate(el => el.ownerDocument.activeElement === el)).toBe(true);
  });

  test(`[P1] todo strip meter renders twelve decorative cells on ${surface}`, async ({
    page,
    archon,
  }) => {
    test.setTimeout(T.xlong * 2);
    const run = await runTodoStrip(page, archon);
    const room = await openNodeRoom(page, surface, run.runId, TODO_STRIP_TODO_NODE);
    await expect(room.locator(STRIP)).toHaveCount(1);
    const meter = room.locator(`${STRIP} ${TODO_METER}`);
    await expect(meter).toHaveCount(1);
    await expect(meter).toHaveAttribute('aria-hidden', 'true');
    await expect(meter.locator(':scope > *')).toHaveCount(12);
  });

  test(`[P1] todo strip leaves todo calls as one-line summaries on ${surface}`, async ({
    page,
    archon,
  }) => {
    test.setTimeout(T.xlong * 2);
    const run = await runTodoStrip(page, archon);
    const room = await openNodeRoom(page, surface, run.runId, TODO_STRIP_TODO_NODE);
    await expect(room.locator(STRIP)).toHaveCount(1);
    const todoRows = room.locator(TOOL_ROW).filter({ hasText: 'todo updated' });
    await expect(todoRows).toHaveCount(4);
    await expect(todoRows.filter({ hasText: 'op: init' })).toHaveCount(1);
    await expect(todoRows.filter({ hasText: 'op: done' })).toHaveCount(1);
    await expect(todoRows.filter({ hasText: 'op: block' })).toHaveCount(1);
    await expect(todoRows.filter({ hasText: 'op: drop' })).toHaveCount(1);
    // The folded checklist never appears inside a transcript tool row.
    for (const checklistText of [
      'Check contract conflicts',
      'Define acceptance cases',
      'Wire Legacy',
      'Add the tests',
    ]) {
      await expect(room.locator(TOOL_ROW).getByText(checklistText)).toHaveCount(0);
    }
  });

  test(`[P1] todo strip stays pinned while the transcript scrolls on ${surface}`, async ({
    page,
    archon,
  }) => {
    test.setTimeout(T.xlong * 2);
    const run = await runTodoStrip(page, archon);
    const room = await openNodeRoom(page, surface, run.runId, TODO_STRIP_TODO_NODE);
    const strip = room.locator(STRIP);
    await expect(strip).toHaveCount(1);
    const scroller = room.getByTestId(SCROLLER_TESTID[surface]);
    await scroller.evaluate(el => {
      el.scrollTop = 0;
    });
    const topIds = await visibleToolIds(scroller);
    const before = await strip.boundingBox();
    expect(before, 'todo strip has a bounding box').toBeTruthy();
    await scroller.evaluate(el => {
      el.scrollTop = el.scrollHeight - el.clientHeight;
    });
    await expect
      .poll(() => scroller.evaluate(el => el.scrollTop), { timeout: T.medium })
      .toBeGreaterThan(0);
    const bottomIds = await visibleToolIds(scroller);
    const after = await strip.boundingBox();
    expect(after, 'todo strip keeps a bounding box after scrolling').toBeTruthy();
    expect(bottomIds.length).toBeGreaterThan(0);
    expect(topIds.some(id => bottomIds.includes(id))).toBe(false);
    expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThanOrEqual(1);
    expect(Math.abs((after?.height ?? 0) - (before?.height ?? 0))).toBeLessThanOrEqual(1);
  });

  test(`[P1] todo strip body scrolls internally without moving the transcript on ${surface}`, async ({
    page,
    archon,
  }) => {
    test.setTimeout(T.xlong * 2);
    const run = await runTodoStrip(page, archon);
    const room = await openNodeRoom(page, surface, run.runId, TODO_STRIP_TODO_NODE);
    const strip = room.locator(STRIP);
    await expect(strip).toHaveCount(1);
    const button = strip.getByRole('button');
    await button.press('Enter');
    const body = await stripBody(strip);
    await expect(body).toBeVisible();
    const metrics = await body.evaluate(el => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      overflowY: getComputedStyle(el).overflowY,
    }));
    expect(metrics.overflowY).toBe('auto');
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
    const scroller = room.getByTestId(SCROLLER_TESTID[surface]);
    const transcriptTop = await scroller.evaluate(el => el.scrollTop);
    await body.evaluate(el => {
      el.scrollTop = el.scrollHeight;
    });
    await expect
      .poll(() => body.evaluate(el => el.scrollTop), { timeout: T.medium })
      .toBeGreaterThan(0);
    expect(await scroller.evaluate(el => el.scrollTop)).toBe(transcriptTop);
  });
}

test('[P1] todo strip remains when Console hides tool calls', async ({ page, archon }) => {
  test.setTimeout(T.xlong * 2);
  const run = await runTodoStrip(page, archon);
  const room = await openNodeRoom(page, 'console', run.runId, TODO_STRIP_TODO_NODE);
  const strip = room.locator(STRIP);
  await expect(strip).toHaveCount(1);
  await expect(room.locator(TOOL_ROW).first()).toBeVisible({ timeout: T.medium });
  await page.getByRole('checkbox', { name: 'Tool calls' }).uncheck();
  await expect(room.locator(TOOL_ROW)).toHaveCount(0);
  await expect(strip).toHaveCount(1);
});
