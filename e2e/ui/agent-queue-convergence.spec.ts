import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import type { APIRequestContext, Locator, Page, Request, TestInfo } from '@playwright/test';
import { format } from 'prettier';

import {
  E2E_QUEUE_GUIDANCE_PAIR_WORKFLOW_NAME,
  QUEUE_GUIDANCE_PAIR_NODE_A,
  QUEUE_GUIDANCE_PAIR_NODE_B,
} from '../lib/playwright/archon-runtime';
import {
  createIdentityContext,
  getRunDetail,
  openLegacyRunDetail,
  openRunDetail,
} from '../lib/playwright/run-detail';
import { expect, test } from '../lib/playwright/suite';
import { T } from '../lib/playwright/timeouts';

/**
 * Multi-view queue convergence — Story 2.9 / issue #189.
 *
 * Parameterized over Console and Legacy. Each journey owns its own run,
 * browser contexts, unique messages, and evidence filenames. The archon
 * runtime is worker-scoped (not test-scoped).
 */

type Surface = 'console' | 'legacy';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EVIDENCE_DIR = join(
  REPO_ROOT,
  'plans',
  '260919-1418-issue-189-live-queue-across-tabs',
  'reports',
  'evidence'
);

const NARROW = { width: 460, height: 900 } as const;
const WIDE = { width: 1440, height: 900 } as const;

interface QueuedGuidanceRow {
  message_id: string;
  message: string;
}

interface QueueSnapshotBody {
  success: true;
  queued: QueuedGuidanceRow[];
}

function sendPathname(runId: string, nodeId: string): string {
  return `/api/workflows/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}/send`;
}

function deletePathname(runId: string, nodeId: string, messageId: string): string {
  return `/api/workflows/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}/queue/${encodeURIComponent(messageId)}`;
}

function queuePathname(runId: string, nodeId: string): string {
  return `/api/workflows/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}/queue`;
}

function draftStorageKey(runId: string, nodeId: string): string {
  return `archon:steering-draft:${runId}:${nodeId}`;
}

function roomRegion(page: Page, nodeId: string): Locator {
  return page.getByRole('region', { name: `${nodeId} room` });
}

async function openGuidanceRoom(
  page: Page,
  surface: Surface,
  runId: string,
  nodeId: string
): Promise<Locator> {
  if (surface === 'console') {
    await openRunDetail(page, runId, nodeId);
  } else {
    await openLegacyRunDetail(page, runId);
    const logsTab = page.getByRole('tab', { name: 'Logs' });
    await expect(logsTab).toBeVisible({ timeout: T.medium });
    await logsTab.click();
    const nodeButton = page.getByRole('button', { name: new RegExp(nodeId) }).first();
    await expect(nodeButton).toBeVisible({ timeout: T.medium });
    await nodeButton.click();
  }
  const room = roomRegion(page, nodeId);
  await expect(room).toBeVisible({ timeout: T.medium });
  return room;
}

function guidanceField(room: Locator): Locator {
  return room.getByRole('textbox', { name: /^message to / });
}

function queueList(room: Locator): Locator {
  return room.getByRole('list', { name: /^Queued messages/ });
}

function rowDeleteButton(row: Locator): Locator {
  return row.getByRole('button', { name: /^delete ·/ });
}

async function captureEvidence(target: Locator, name: string, testInfo: TestInfo): Promise<void> {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const shot = await target.screenshot({ path: join(EVIDENCE_DIR, name) });
  await testInfo.attach(name, { body: shot, contentType: 'image/png' });
}

async function writeMeasurements(filename: string, data: Record<string, unknown>): Promise<void> {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const rendered = await format(JSON.stringify(data), {
    parser: 'json',
    printWidth: 100,
    tabWidth: 2,
    endOfLine: 'lf',
  });
  writeFileSync(join(EVIDENCE_DIR, filename), rendered);
}

interface OverflowFacts {
  pageOverflow: number;
  roomInsideViewport: boolean;
  roomScroll: number;
  insideCount: number;
  outsideSample: string[];
}

async function expectNoRoomDrivenOverflow(room: Locator, context = ''): Promise<OverflowFacts> {
  const report = await room.evaluate(roomEl => {
    const width = document.documentElement.clientWidth;
    const offenders: { tag: string; insideRoom: boolean }[] = [];
    document.querySelectorAll('body *').forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.right > width + 1 || rect.left < -1) {
        offenders.push({
          tag: `${el.tagName}.${typeof el.className === 'string' ? (el.className.split(' ')[0] ?? '') : ''}`,
          insideRoom: roomEl.contains(el),
        });
      }
    });
    const roomRect = roomEl.getBoundingClientRect();
    return {
      pageOverflow: document.documentElement.scrollWidth - width,
      roomInsideViewport: roomRect.left >= -1 && roomRect.right <= width + 1,
      roomScroll: roomEl.scrollWidth - roomEl.clientWidth,
      insideCount: offenders.filter(o => o.insideRoom).length,
      outsideSample: offenders
        .filter(o => !o.insideRoom)
        .slice(0, 5)
        .map(o => o.tag),
    };
  });
  expect(report.roomInsideViewport, `room stays inside viewport ${context}`).toBe(true);
  expect(report.roomScroll, `room has no horizontal scroll ${context}`).toBeLessThanOrEqual(1);
  expect(
    report.pageOverflow,
    `page has no horizontal overflow ${context} (outside offenders: ${report.outsideSample.join(', ') || 'none'})`
  ).toBeLessThanOrEqual(1);
  expect(
    report.insideCount,
    `no room element overflows the page ${context} (outside offenders: ${report.outsideSample.join(', ') || 'none'}; page overflow ${String(report.pageOverflow)}px)`
  ).toBe(0);
  return report;
}

async function waitForNodeStarted(page: Page, runId: string, nodeId: string): Promise<void> {
  const deadline = Date.now() + T.long;
  let last = 'no events';
  while (Date.now() < deadline) {
    const detail = await getRunDetail(page, runId);
    if (
      detail.events.some(event => event.event_type === 'node_started' && event.step_name === nodeId)
    ) {
      return;
    }
    last = `${String(detail.events.length)} events, run ${detail.status ?? '?'}`;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`node ${nodeId} in run ${runId} never reached node_started (${last})`);
}

async function rowIds(room: Locator): Promise<string[]> {
  const list = queueList(room);
  if ((await list.count()) === 0) return [];
  return list
    .locator('li[data-message-id]')
    .evaluateAll(nodes =>
      nodes
        .map(node => node.getAttribute('data-message-id'))
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    );
}

async function readQueue(
  request: APIRequestContext,
  runId: string,
  nodeId: string
): Promise<QueueSnapshotBody> {
  const res = await request.get(queuePathname(runId, nodeId), {
    headers: { 'Cache-Control': 'no-store' },
  });
  expect(res.status(), `GET queue ${runId}/${nodeId}`).toBe(200);
  const body = (await res.json()) as Partial<QueueSnapshotBody>;
  expect(body.success, 'queue snapshot success flag').toBe(true);
  expect(Array.isArray(body.queued), 'queue snapshot queued array').toBe(true);
  for (const row of body.queued ?? []) {
    expect(row.message_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(typeof row.message).toBe('string');
  }
  return body as QueueSnapshotBody;
}

async function expectQueueIds(room: Locator, expected: string[]): Promise<void> {
  await expect
    .poll(async () => rowIds(room), {
      timeout: T.long,
      message: `DOM queue ids → ${JSON.stringify(expected)}`,
    })
    .toEqual(expected);
}

async function expectServerQueueIds(
  request: APIRequestContext,
  runId: string,
  nodeId: string,
  expected: string[]
): Promise<void> {
  await expect
    .poll(
      async () => {
        const body = await readQueue(request, runId, nodeId);
        return body.queued.map(row => row.message_id);
      },
      {
        timeout: T.long,
        message: `server queue ids → ${JSON.stringify(expected)}`,
      }
    )
    .toEqual(expected);
}

function trackMethodPath(
  page: Page,
  method: string,
  pathname: string
): { count: () => number; dispose: () => void } {
  let seen = 0;
  const listener = (request: Request): void => {
    if (request.method() !== method) return;
    if (new URL(request.url()).pathname === pathname) seen += 1;
  };
  page.on('request', listener);
  return {
    count: () => seen,
    dispose: () => page.off('request', listener),
  };
}

function trackDeletes(
  page: Page,
  runId: string,
  nodeId: string
): { count: () => number; dispose: () => void } {
  let seen = 0;
  const prefix = `/api/workflows/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}/queue/`;
  const listener = (request: Request): void => {
    if (request.method() !== 'DELETE') return;
    const path = new URL(request.url()).pathname;
    if (path.startsWith(prefix) && path.length > prefix.length) seen += 1;
  };
  page.on('request', listener);
  return {
    count: () => seen,
    dispose: () => page.off('request', listener),
  };
}

function trackQueueGets(
  page: Page,
  runId: string,
  nodeId: string
): { count: () => number; dispose: () => void } {
  return trackMethodPath(page, 'GET', queuePathname(runId, nodeId));
}

async function activeElementDescriptor(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (el === null) return 'none';
    if (el === document.body) return 'body';
    const name = el.getAttribute('aria-label');
    return name === null ? el.tagName.toLowerCase() : `${el.tagName.toLowerCase()}:${name}`;
  });
}

async function readDraftStorage(page: Page, runId: string, nodeId: string): Promise<string | null> {
  return page.evaluate(key => sessionStorage.getItem(key), draftStorageKey(runId, nodeId));
}

async function queueGuidance(
  page: Page,
  room: Locator,
  runId: string,
  nodeId: string,
  text: string
): Promise<string> {
  const sent = page.waitForResponse(
    res =>
      res.request().method() === 'POST' &&
      new URL(res.url()).pathname === sendPathname(runId, nodeId)
  );
  const field = guidanceField(room);
  await field.fill(text);
  await field.press('Meta+Enter');
  const response = await sent;
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { message_id?: string };
  expect(body.message_id, 'send response carries the accepted message_id').toMatch(
    /^[0-9a-f-]{36}$/
  );
  return body.message_id as string;
}

async function withdrawViaKeyboard(
  page: Page,
  room: Locator,
  runId: string,
  nodeId: string,
  messageId: string,
  activationKey: string
): Promise<void> {
  const targetRow = queueList(room).locator(`li[data-message-id="${messageId}"]`);
  const deleteBtn = rowDeleteButton(targetRow);
  await deleteBtn.focus();
  const deletion = page.waitForResponse(
    res =>
      res.request().method() === 'DELETE' &&
      new URL(res.url()).pathname === deletePathname(runId, nodeId, messageId)
  );
  await page.keyboard.press(activationKey);
  const response = await deletion;
  expect(response.status()).toBe(200);
  expect(response.request().postData(), 'DELETE carries no request body').toBeNull();
  expect(await response.json()).toEqual({ success: true, message_id: messageId });
}

async function queueGeometryFacts(room: Locator): Promise<{
  hasMaxH33vh: boolean;
  maxHeight: string;
  overflowY: string;
  bandText: string;
  hasThisTabOnlyInBand: boolean;
  hasSurfaceElevatedBand: boolean;
  bandImmediatelyBeforeComposer: boolean;
  bandIsFullBleed: boolean;
}> {
  return room.evaluate(roomEl => {
    const list = roomEl.querySelector('ul[aria-label^="Queued messages"]');
    const wrapper = list?.parentElement ?? null;
    const style = wrapper ? roomEl.ownerDocument.defaultView?.getComputedStyle(wrapper) : null;
    const bandRoot = wrapper?.parentElement ?? null;
    const composer = bandRoot?.nextElementSibling ?? null;
    const bandRect = bandRoot?.getBoundingClientRect();
    const roomRect = roomEl.getBoundingClientRect();
    const bandClass = typeof bandRoot?.className === 'string' ? bandRoot.className : '';
    const bandText = bandRoot?.textContent ?? '';
    return {
      hasMaxH33vh: wrapper?.className.includes('max-h-[33vh]') ?? false,
      maxHeight: style?.maxHeight ?? '',
      overflowY: style?.overflowY ?? '',
      bandText,
      hasThisTabOnlyInBand: /this tab only/i.test(bandText),
      hasSurfaceElevatedBand: bandClass.includes('bg-surface-elevated'),
      bandImmediatelyBeforeComposer:
        composer !== null && composer.querySelector('textarea') !== null,
      bandIsFullBleed:
        bandRect !== undefined &&
        Math.abs(bandRect.left - roomRect.left) <= 1 &&
        Math.abs(bandRect.right - roomRect.right) <= 1,
    };
  });
}

async function assertQueueVisualContract(
  room: Locator,
  expectedCount: number,
  context: string
): Promise<Record<string, unknown>> {
  if (expectedCount === 0) {
    await expect(room.getByText(/^queued ·/i)).toHaveCount(0);
    await expect(queueList(room)).toHaveCount(0);
    const overflow = await expectNoRoomDrivenOverflow(room, context);
    return { expectedCount: 0, bandAbsent: true, overflow };
  }

  await expect(room.getByText(new RegExp(`queued · ${String(expectedCount)}`, 'i'))).toBeVisible();
  const list = queueList(room);
  await expect(list).toBeVisible();
  const items = list.getByRole('listitem');
  await expect(items).toHaveCount(expectedCount);

  const geometry = await queueGeometryFacts(room);
  expect(geometry.hasMaxH33vh, `queue wrapper keeps max-h-[33vh] ${context}`).toBe(true);
  expect(geometry.overflowY, `queue wrapper scrolls vertically ${context}`).toMatch(/auto|scroll/);
  expect(geometry.hasThisTabOnlyInBand, `queue band has no this-tab-only copy ${context}`).toBe(
    false
  );
  expect(geometry.hasSurfaceElevatedBand, `queue band keeps surface-elevated ${context}`).toBe(
    true
  );
  expect(
    geometry.bandImmediatelyBeforeComposer,
    `queue band sits immediately above composer ${context}`
  ).toBe(true);
  expect(geometry.bandIsFullBleed, `queue band stays full-bleed ${context}`).toBe(true);

  // Composer hint still owns the tab-only copy.
  await expect(room.getByText(/this tab only/i)).toBeVisible();

  for (let i = 0; i < expectedCount; i += 1) {
    const row = items.nth(i);
    const span = row.locator('span').first();
    const spanStyle = await span.evaluate(el => {
      const style = el.ownerDocument.defaultView?.getComputedStyle(el);
      return {
        whiteSpace: style?.whiteSpace ?? '',
        textOverflow: style?.textOverflow ?? '',
        overflow: style?.overflow ?? style?.overflowX ?? '',
      };
    });
    expect(spanStyle.whiteSpace, `row ${String(i)} one-line ${context}`).toBe('nowrap');
    expect(spanStyle.textOverflow, `row ${String(i)} end-elided ${context}`).toBe('ellipsis');

    const del = rowDeleteButton(row);
    await expect(del).toBeVisible();
    const box = await del.boundingBox();
    expect(box?.width ?? 0, `delete width ≥ 24 ${context}`).toBeGreaterThanOrEqual(24);
    expect(box?.height ?? 0, `delete height ≥ 24 ${context}`).toBeGreaterThanOrEqual(24);
    const name = await del.getAttribute('aria-label');
    expect(name, `named delete control ${context}`).toMatch(/^delete · /);
  }

  const overflow = await expectNoRoomDrivenOverflow(room, context);
  return { expectedCount, geometry, overflow };
}

for (const surface of ['console', 'legacy'] as const) {
  const activationKey = surface === 'console' ? 'Enter' : 'Space';

  test(`[P1] [V:steer.converge-${surface}] multi-view queue converges for tabs and operators on ${surface}`, async ({
    browser,
    archon,
  }, testInfo: TestInfo) => {
    test.setTimeout(T.xlong * 3);

    const tag = randomUUID().replace(/-/g, '').slice(0, 12);
    const draftAlpha = `draft-alpha-${tag}`;
    const draftBeta = `draft-beta-${tag}`;
    const starterText = `starter-one-${tag}`;
    const nodeId = QUEUE_GUIDANCE_PAIR_NODE_A;

    const starterCtx = await createIdentityContext(browser, archon.baseURL, 'starter');
    const teammateCtx = await createIdentityContext(browser, archon.baseURL, 'teammate');
    const starterA = await starterCtx.newPage();
    const starterB = await starterCtx.newPage();
    const teammate = await teammateCtx.newPage();

    const disposers: Array<() => void> = [];
    const measurements: Record<string, unknown> = {
      surface,
      tag,
      nodeId,
      viewport: NARROW,
    };

    try {
      await starterA.setViewportSize(NARROW);
      await starterB.setViewportSize(NARROW);
      await teammate.setViewportSize(NARROW);

      const run = await archon.startWorkflowViaWeb(
        E2E_QUEUE_GUIDANCE_PAIR_WORKFLOW_NAME,
        `e2e converge ${tag}`
      );
      measurements.runId = run.runId;

      await waitForNodeStarted(starterA, run.runId, nodeId);

      const roomA = await openGuidanceRoom(starterA, surface, run.runId, nodeId);
      const roomB = await openGuidanceRoom(starterB, surface, run.runId, nodeId);
      const roomT = await openGuidanceRoom(teammate, surface, run.runId, nodeId);

      const starterDetail = await getRunDetail(starterA, run.runId);
      const starterBDetail = await getRunDetail(starterB, run.runId);
      const teammateDetail = await getRunDetail(teammate, run.runId);
      expect(starterDetail.viewer_is_starter, 'starterA is starter').toBe(true);
      expect(starterBDetail.viewer_is_starter, 'starterB is starter').toBe(true);
      expect(teammateDetail.viewer_is_starter, 'teammate is not starter').toBe(false);
      measurements.identities = {
        starterA: starterDetail.viewer_is_starter,
        starterB: starterBDetail.viewer_is_starter,
        teammate: teammateDetail.viewer_is_starter,
      };

      const deletesB = trackDeletes(starterB, run.runId, nodeId);
      const deletesT = trackDeletes(teammate, run.runId, nodeId);
      const getsA = trackQueueGets(starterA, run.runId, nodeId);
      const getsB = trackQueueGets(starterB, run.runId, nodeId);
      const getsT = trackQueueGets(teammate, run.runId, nodeId);
      disposers.push(
        deletesB.dispose,
        deletesT.dispose,
        getsA.dispose,
        getsB.dispose,
        getsT.dispose
      );

      const fieldB = guidanceField(roomB);
      const fieldT = guidanceField(roomT);
      await expect(fieldB).toBeVisible({ timeout: T.medium });
      await expect(fieldT).toBeVisible({ timeout: T.medium });

      await fieldB.fill(draftAlpha);
      await fieldT.fill(draftBeta);
      await expect(fieldB).toHaveValue(draftAlpha);
      await expect(fieldT).toHaveValue(draftBeta);

      const storedAlphaBefore = await readDraftStorage(starterB, run.runId, nodeId);
      const storedBetaBefore = await readDraftStorage(teammate, run.runId, nodeId);
      expect(storedAlphaBefore).toBeTruthy();
      expect(JSON.parse(storedAlphaBefore ?? '{}')).toMatchObject({ draft: draftAlpha });
      expect(storedBetaBefore).toBeTruthy();
      expect(JSON.parse(storedBetaBefore ?? '{}')).toMatchObject({ draft: draftBeta });
      measurements.draftsBefore = {
        starterBField: draftAlpha,
        starterBStorage: storedAlphaBefore,
        teammateField: draftBeta,
        teammateStorage: storedBetaBefore,
      };

      const starterId = await queueGuidance(starterA, roomA, run.runId, nodeId, starterText);

      await expectQueueIds(roomA, [starterId]);
      await expectQueueIds(roomB, [starterId]);
      await expectQueueIds(roomT, [starterId]);
      await expectServerQueueIds(starterA.request, run.runId, nodeId, [starterId]);
      await expectServerQueueIds(teammate.request, run.runId, nodeId, [starterId]);

      await expect(fieldB).toHaveValue(draftAlpha);
      await expect(fieldT).toHaveValue(draftBeta);
      expect(await readDraftStorage(starterB, run.runId, nodeId)).toBe(storedAlphaBefore);
      expect(await readDraftStorage(teammate, run.runId, nodeId)).toBe(storedBetaBefore);

      // Queue teammate draft from the teammate page (field already holds it).
      const teammateSent = teammate.waitForResponse(
        res =>
          res.request().method() === 'POST' &&
          new URL(res.url()).pathname === sendPathname(run.runId, nodeId)
      );
      await fieldT.press('Meta+Enter');
      const teammateResponse = await teammateSent;
      expect(teammateResponse.status()).toBe(200);
      const teammateBody = (await teammateResponse.json()) as { message_id?: string };
      expect(teammateBody.message_id).toMatch(/^[0-9a-f-]{36}$/);
      const teammateId = teammateBody.message_id as string;
      expect(teammateId).not.toBe(starterId);

      const twoRow = [starterId, teammateId];
      await expectQueueIds(roomA, twoRow);
      await expectQueueIds(roomB, twoRow);
      await expectQueueIds(roomT, twoRow);
      await expectServerQueueIds(starterA.request, run.runId, nodeId, twoRow);
      await expectServerQueueIds(teammate.request, run.runId, nodeId, twoRow);

      const starterServerTwo = await readQueue(starterA.request, run.runId, nodeId);
      const teammateServerTwo = await readQueue(teammate.request, run.runId, nodeId);
      const twoRowObservations = {
        views: {
          starterA: await rowIds(roomA),
          starterB: await rowIds(roomB),
          teammate: await rowIds(roomT),
        },
        identities: {
          starter: starterServerTwo.queued.map(row => row.message_id),
          teammate: teammateServerTwo.queued.map(row => row.message_id),
        },
      };

      // Exact text/order + no duplicates.
      for (const room of [roomA, roomB, roomT]) {
        const items = queueList(room).getByRole('listitem');
        await expect(items).toHaveCount(2);
        await expect(items.nth(0)).toContainText(starterText);
        await expect(items.nth(1)).toContainText(draftBeta);
        const ids = await rowIds(room);
        expect(new Set(ids).size, 'no duplicate ids').toBe(ids.length);
        await expect(room.getByText(/queued · 2/i)).toBeVisible();
      }

      await expect(fieldT).toHaveValue('');
      expect(await readDraftStorage(teammate, run.runId, nodeId)).toBeNull();
      await expect(fieldB).toHaveValue(draftAlpha);
      expect(await readDraftStorage(starterB, run.runId, nodeId)).toBe(storedAlphaBefore);

      const visualTwoA = await assertQueueVisualContract(roomA, 2, `${surface} starterA two-row`);
      const visualTwoB = await assertQueueVisualContract(roomB, 2, `${surface} starterB two-row`);
      const visualTwoT = await assertQueueVisualContract(roomT, 2, `${surface} teammate two-row`);
      await captureEvidence(roomA, `converge-${surface}-460-two-row-starterA.png`, testInfo);
      await captureEvidence(roomB, `converge-${surface}-460-two-row-starterB.png`, testInfo);
      await captureEvidence(roomT, `converge-${surface}-460-two-row-teammate.png`, testInfo);

      if (surface === 'console') {
        await starterA.setViewportSize(WIDE);
        await assertQueueVisualContract(roomA, 2, 'console@1440 two-row');
        await captureEvidence(roomA, 'converge-console-1440-two-row-starterA.png', testInfo);
        await starterA.setViewportSize(NARROW);
      }

      measurements.twoRow = {
        starterId,
        teammateId,
        orderedIds: twoRow,
        observations: twoRowObservations,
        visual: { starterA: visualTwoA, starterB: visualTwoB, teammate: visualTwoT },
      };

      // Focus starterId delete on starterB, withdraw from starterA.
      const starterRowB = queueList(roomB).locator(`li[data-message-id="${starterId}"]`);
      const starterDeleteB = rowDeleteButton(starterRowB);
      await starterDeleteB.focus();
      expect(
        await starterDeleteB.evaluate(el => el.ownerDocument.activeElement === el),
        'starterB focuses starterId delete before remote withdraw'
      ).toBe(true);
      const activeBeforeFirstRemoval = await activeElementDescriptor(starterB);
      measurements.activeBeforeFirstRemoval = activeBeforeFirstRemoval;

      const deletesBBefore = deletesB.count();
      const deletesTBefore = deletesT.count();

      await withdrawViaKeyboard(starterA, roomA, run.runId, nodeId, starterId, activationKey);

      const oneRow = [teammateId];
      await expectQueueIds(roomA, oneRow);
      await expectQueueIds(roomB, oneRow);
      await expectQueueIds(roomT, oneRow);
      await expectServerQueueIds(starterA.request, run.runId, nodeId, oneRow);
      await expectServerQueueIds(teammate.request, run.runId, nodeId, oneRow);

      const starterServerOne = await readQueue(starterA.request, run.runId, nodeId);
      const teammateServerOne = await readQueue(teammate.request, run.runId, nodeId);
      const oneRowObservations = {
        views: {
          starterA: await rowIds(roomA),
          starterB: await rowIds(roomB),
          teammate: await rowIds(roomT),
        },
        identities: {
          starter: starterServerOne.queued.map(row => row.message_id),
          teammate: teammateServerOne.queued.map(row => row.message_id),
        },
      };

      expect(deletesB.count() - deletesBBefore, 'starterB issued zero DELETEs').toBe(0);
      expect(
        deletesT.count() - deletesTBefore,
        'teammate issued zero DELETEs on first removal'
      ).toBe(0);

      const teammateDeleteB = rowDeleteButton(
        queueList(roomB).locator(`li[data-message-id="${teammateId}"]`)
      );
      await expect
        .poll(async () => teammateDeleteB.evaluate(el => el.ownerDocument.activeElement === el))
        .toBe(true);
      const activeAfterFirstRemoval = await activeElementDescriptor(starterB);
      measurements.activeAfterFirstRemoval = activeAfterFirstRemoval;

      const visualOne = await assertQueueVisualContract(roomB, 1, `${surface} starterB one-row`);
      await captureEvidence(roomA, `converge-${surface}-460-one-row-starterA.png`, testInfo);
      await captureEvidence(roomB, `converge-${surface}-460-one-row-starterB.png`, testInfo);
      await captureEvidence(roomT, `converge-${surface}-460-one-row-teammate.png`, testInfo);

      if (surface === 'console') {
        await starterB.setViewportSize(WIDE);
        await assertQueueVisualContract(roomB, 1, 'console@1440 one-row');
        await captureEvidence(roomB, 'converge-console-1440-one-row-starterB.png', testInfo);
        await starterB.setViewportSize(NARROW);
      }

      measurements.oneRow = {
        orderedIds: oneRow,
        observations: oneRowObservations,
        visual: visualOne,
        starterBDeleteCount: deletesB.count(),
        teammateDeleteCount: deletesT.count(),
      };

      // Teammate withdraws remaining id.
      measurements.activeBeforeSecondRemoval = await activeElementDescriptor(starterB);
      await withdrawViaKeyboard(teammate, roomT, run.runId, nodeId, teammateId, activationKey);

      await expectQueueIds(roomA, []);
      await expectQueueIds(roomB, []);
      await expectQueueIds(roomT, []);
      await expectServerQueueIds(starterA.request, run.runId, nodeId, []);
      await expectServerQueueIds(teammate.request, run.runId, nodeId, []);

      await expect(roomB.getByText(/^queued ·/i)).toHaveCount(0);
      await expect(queueList(roomB)).toHaveCount(0);

      await expect
        .poll(async () => activeElementDescriptor(starterB), {
          timeout: T.medium,
          message: 'starterB focus moves to composer field after last remote removal',
        })
        .toMatch(/^textarea/);
      const activeAfterEmpty = await activeElementDescriptor(starterB);
      expect(activeAfterEmpty).not.toBe('body');
      measurements.activeAfterEmpty = activeAfterEmpty;

      await expect(fieldB).toHaveValue(draftAlpha);
      expect(await readDraftStorage(starterB, run.runId, nodeId)).toBe(storedAlphaBefore);

      expect(deletesB.count(), 'starterB issued zero DELETEs for entire journey').toBe(0);

      const visualEmpty = await assertQueueVisualContract(roomB, 0, `${surface} empty band`);
      await captureEvidence(roomB, `converge-${surface}-460-empty-starterB.png`, testInfo);

      measurements.final = {
        orderedIds: [],
        visual: visualEmpty,
        drafts: {
          starterBField: await fieldB.inputValue(),
          starterBStorage: await readDraftStorage(starterB, run.runId, nodeId),
          teammateField: await fieldT.inputValue(),
        },
        requestCounts: {
          starterAGets: getsA.count(),
          starterBGets: getsB.count(),
          teammateGets: getsT.count(),
          starterBDeletes: deletesB.count(),
          teammateDeletes: deletesT.count(),
        },
      };

      await writeMeasurements(`convergence-${surface}.json`, measurements);
      await testInfo.attach(`convergence-${surface}.json`, {
        body: Buffer.from(`${JSON.stringify(measurements, null, 2)}\n`),
        contentType: 'application/json',
      });
    } finally {
      for (const dispose of disposers) dispose();
      await starterA.close().catch(() => undefined);
      await starterB.close().catch(() => undefined);
      await teammate.close().catch(() => undefined);
      await starterCtx.close().catch(() => undefined);
      await teammateCtx.close().catch(() => undefined);
    }
  });

  test(`[P1] [V:steer.scope-${surface}] pair nodes stay isolated and rehydrate on ${surface}`, async ({
    browser,
    archon,
  }, testInfo: TestInfo) => {
    test.setTimeout(T.xlong * 2);

    const tag = randomUUID().replace(/-/g, '').slice(0, 12);
    const textA = `A-only-${tag}`;
    const textB = `B-only-${tag}`;
    const nodeA = QUEUE_GUIDANCE_PAIR_NODE_A;
    const nodeB = QUEUE_GUIDANCE_PAIR_NODE_B;

    const starterCtx = await createIdentityContext(browser, archon.baseURL, 'starter');
    const pageA = await starterCtx.newPage();
    const pageB = await starterCtx.newPage();
    const disposers: Array<() => void> = [];
    const measurements: Record<string, unknown> = {
      surface,
      tag,
      nodeA,
      nodeB,
      viewport: NARROW,
    };

    try {
      await pageA.setViewportSize(NARROW);
      await pageB.setViewportSize(NARROW);

      const run = await archon.startWorkflowViaWeb(
        E2E_QUEUE_GUIDANCE_PAIR_WORKFLOW_NAME,
        `e2e scope ${tag}`
      );
      measurements.runId = run.runId;

      await waitForNodeStarted(pageA, run.runId, nodeA);
      await waitForNodeStarted(pageA, run.runId, nodeB);

      await expectServerQueueIds(pageA.request, run.runId, nodeA, []);
      await expectServerQueueIds(pageA.request, run.runId, nodeB, []);

      const roomA = await openGuidanceRoom(pageA, surface, run.runId, nodeA);
      const roomB = await openGuidanceRoom(pageB, surface, run.runId, nodeB);

      const getsA = trackQueueGets(pageA, run.runId, nodeA);
      const getsB = trackQueueGets(pageB, run.runId, nodeB);
      disposers.push(getsA.dispose, getsB.dispose);

      const aId = await queueGuidance(pageA, roomA, run.runId, nodeA, textA);
      const bId = await queueGuidance(pageB, roomB, run.runId, nodeB, textB);
      expect(aId).not.toBe(bId);

      await expectQueueIds(roomA, [aId]);
      await expectQueueIds(roomB, [bId]);
      await expectServerQueueIds(pageA.request, run.runId, nodeA, [aId]);
      await expectServerQueueIds(pageB.request, run.runId, nodeB, [bId]);

      // No text/id leakage across nodes.
      await expect(roomA.getByText(textB)).toHaveCount(0);
      await expect(roomB.getByText(textA)).toHaveCount(0);
      const serverA = await readQueue(pageA.request, run.runId, nodeA);
      const serverB = await readQueue(pageB.request, run.runId, nodeB);
      expect(serverA.queued.map(r => r.message_id)).toEqual([aId]);
      expect(serverB.queued.map(r => r.message_id)).toEqual([bId]);
      expect(serverA.queued.some(r => r.message.includes('B-only'))).toBe(false);
      expect(serverB.queued.some(r => r.message.includes('A-only'))).toBe(false);

      measurements.split = {
        aId,
        bId,
        roomA: await rowIds(roomA),
        roomB: await rowIds(roomB),
        serverA: serverA.queued.map(r => r.message_id),
        serverB: serverB.queued.map(r => r.message_id),
      };

      const visualScopeA = await assertQueueVisualContract(roomA, 1, `${surface} scope A`);
      const visualScopeB = await assertQueueVisualContract(roomB, 1, `${surface} scope B`);
      await captureEvidence(roomA, `scope-${surface}-460-nodeA.png`, testInfo);
      await captureEvidence(roomB, `scope-${surface}-460-nodeB.png`, testInfo);

      let visualScopeWide: Record<string, unknown> | null = null;
      if (surface === 'console') {
        await pageA.setViewportSize(WIDE);
        visualScopeWide = await assertQueueVisualContract(roomA, 1, 'console@1440 scope A');
        await captureEvidence(roomA, 'scope-console-1440-nodeA.png', testInfo);
        await pageA.setViewportSize(NARROW);
      }

      // Navigate page A to node B — fresh keyed dock must hydrate [bId].
      const roomAOnB = await openGuidanceRoom(pageA, surface, run.runId, nodeB);
      await expectQueueIds(roomAOnB, [bId]);
      await expect(roomAOnB.getByText(textA)).toHaveCount(0);
      await expect(roomAOnB.getByText(textB)).toBeVisible();
      const pageAOnBIds = await rowIds(roomAOnB);

      // Navigate back to node A — exactly [aId]; page B stays [bId].
      const roomABack = await openGuidanceRoom(pageA, surface, run.runId, nodeA);
      await expectQueueIds(roomABack, [aId]);
      await expectQueueIds(roomB, [bId]);
      await expect(roomABack.getByText(textB)).toHaveCount(0);
      await expect(roomB.getByText(textA)).toHaveCount(0);
      const pageABackIds = await rowIds(roomABack);
      const pageBThroughoutIds = await rowIds(roomB);

      measurements.splitVisual = {
        nodeA: visualScopeA,
        nodeB: visualScopeB,
        nodeAWide: visualScopeWide,
      };

      measurements.rehydrate = {
        pageAOnB: pageAOnBIds,
        pageABack: pageABackIds,
        pageBThroughout: pageBThroughoutIds,
        requestCounts: {
          pageAGetsNodeA: getsA.count(),
          pageBGetsNodeB: getsB.count(),
        },
      };

      await writeMeasurements(`scope-${surface}.json`, measurements);
      await testInfo.attach(`scope-${surface}.json`, {
        body: Buffer.from(`${JSON.stringify(measurements, null, 2)}\n`),
        contentType: 'application/json',
      });
    } finally {
      for (const dispose of disposers) dispose();
      await pageA.close().catch(() => undefined);
      await pageB.close().catch(() => undefined);
      await starterCtx.close().catch(() => undefined);
    }
  });
}
