import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import { type Locator, type Page, type TestInfo } from '@playwright/test';

import { test, expect } from '../lib/playwright/suite';
import {
  E2E_QUEUE_GUIDANCE_WORKFLOW_NAME,
  QUEUE_GUIDANCE_NODE,
} from '../lib/playwright/archon-runtime';
import {
  getRunDetail,
  listNodeMessages,
  openLegacyRunDetail,
  openRunDetail,
} from '../lib/playwright/run-detail';
import { T } from '../lib/playwright/timeouts';

/**
 * Withdraw a queued guidance message — outside-in behavior + evidence.
 *
 * The `e2e-queue-guidance` fixture holds the first provider turn open for a
 * bounded 30-second delay, so a real web-dispatched run stays steerable long
 * enough to queue two messages and delete one before the natural drain
 * boundary. The second message carries the fake provider's opt-in
 * `echoPrompt` directive so the drained turn echoes it verbatim — the
 * withdrawn message's unique marker must never appear in any transcript
 * text, which is the delivery-exclusion proof.
 *
 * Captures and measured geometry land in this plan's reports/evidence/ dir
 * for the acceptance report.
 */

type Surface = 'console' | 'legacy';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EVIDENCE_DIR = join(
  REPO_ROOT,
  'plans',
  '260919-0135-issue-182-withdraw-queued-guidance-message',
  'reports',
  'evidence'
);
const MEASUREMENTS_FILE = join(EVIDENCE_DIR, 'withdraw-measurements.json');

function sendPathname(runId: string, nodeId: string): string {
  return `/api/workflows/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}/send`;
}

function deletePathname(runId: string, nodeId: string, messageId: string): string {
  return `/api/workflows/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}/queue/${encodeURIComponent(messageId)}`;
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

/** The per-row delete control — a native button named `delete · <message>`. */
function rowDeleteButton(row: Locator): Locator {
  return row.getByRole('button', { name: /^delete ·/ });
}

/** Writes a durable capture to the plan's evidence dir and attaches it. */
async function captureEvidence(target: Locator, name: string, testInfo: TestInfo): Promise<void> {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const shot = await target.screenshot({ path: join(EVIDENCE_DIR, name) });
  await testInfo.attach(name, { body: shot, contentType: 'image/png' });
}

/** Merges one section into withdraw-measurements.json so sections survive partial runs. */
function mergeMeasurements(section: string, data: Record<string, unknown>): void {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const current = existsSync(MEASUREMENTS_FILE)
    ? (JSON.parse(readFileSync(MEASUREMENTS_FILE, 'utf8')) as Record<string, unknown>)
    : {};
  current[section] = data;
  writeFileSync(MEASUREMENTS_FILE, `${JSON.stringify(current, null, 2)}\n`);
}

/**
 * The page and room must never force horizontal scrolling where the room is
 * visible; naming outside offenders keeps failures actionable.
 */
async function expectNoRoomDrivenOverflow(room: Locator, context = ''): Promise<void> {
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
}

/** Polls the run-detail API until the node's `node_started` event exists. */
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

/** Text payloads recorded for the node, in transcript order. */
async function transcriptTexts(page: Page, runId: string, nodeId: string): Promise<string[]> {
  const messages = await listNodeMessages(page, runId, nodeId);
  return messages
    .filter(message => message.kind === 'text' && typeof message.payload.text === 'string')
    .map(message => message.payload.text as string);
}

/** Queues one guidance message through the composer and returns its accepted id. */
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

/**
 * Reaches a row's delete control from the composer field via Shift+Tab —
 * real keyboard traversal, so `:focus-visible` styles apply. With n rows,
 * the field's previous tabbables are the delete buttons in reverse order.
 */
async function focusDeleteViaKeyboard(
  page: Page,
  room: Locator,
  rowCount: number,
  targetIndex: number
): Promise<void> {
  const field = guidanceField(room);
  await field.focus();
  for (let i = 0; i < rowCount - targetIndex; i += 1) {
    await page.keyboard.press('Shift+Tab');
  }
}

interface DeleteButtonFacts {
  ariaLabel: string | null;
  type: string | null;
  width: number;
  height: number;
  outlineWidth: string;
  outlineStyle: string;
  outlineColor: string;
}

async function measureFocusedDeleteButton(button: Locator): Promise<DeleteButtonFacts> {
  const facts = await button.evaluate(el => {
    const style = el.ownerDocument.defaultView?.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return {
      ariaLabel: el.getAttribute('aria-label'),
      type: el.getAttribute('type'),
      width: rect.width,
      height: rect.height,
      outlineWidth: style?.outlineWidth ?? '',
      outlineStyle: style?.outlineStyle ?? '',
      outlineColor: style?.outlineColor ?? '',
    };
  });
  expect(facts.type).toBe('button');
  expect(facts.width, 'delete target width ≥ 24px').toBeGreaterThanOrEqual(24);
  expect(facts.height, 'delete target height ≥ 24px').toBeGreaterThanOrEqual(24);
  expect(facts.outlineWidth, 'focused delete shows a nonzero outline').not.toBe('0px');
  expect(facts.outlineStyle, 'focused delete outline is drawn').not.toBe('none');
  return facts;
}

/** Computed elision facts for the long first message's span. */
async function messageSpanFacts(row: Locator): Promise<{
  scrollWidth: number;
  clientWidth: number;
  textOverflow: string;
  whiteSpace: string;
  overflowX: string;
}> {
  const facts = await row
    .locator('span')
    .first()
    .evaluate(el => {
      const style = el.ownerDocument.defaultView?.getComputedStyle(el);
      return {
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        textOverflow: style?.textOverflow ?? '',
        whiteSpace: style?.whiteSpace ?? '',
        overflowX: style?.overflowX ?? '',
      };
    });
  expect(facts.textOverflow).toBe('ellipsis');
  expect(facts.whiteSpace).toBe('nowrap');
  expect(facts.scrollWidth, 'long first message visibly elides').toBeGreaterThan(facts.clientWidth);
  return facts;
}

async function activeElementDescriptor(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (el === null) return 'none';
    const name = el.getAttribute('aria-label');
    return name === null ? el.tagName.toLowerCase() : `${el.tagName.toLowerCase()}:${name}`;
  });
}

/** A long obsolete instruction carrying a unique non-delivery marker. */
function obsoleteMessage(tag: string): string {
  return `WITHDRAWN-${tag} ${'obsolete operator instruction padding '.repeat(12).trim()}`;
}

function echoMessage(marker: string): string {
  return `<<E2E_SCENARIO>>{"echoPrompt":true}<</E2E_SCENARIO>>${marker}`;
}

for (const surface of ['console', 'legacy'] as const) {
  const activationKey = surface === 'console' ? 'Enter' : 'Space';

  test(`[P1] [V:withdraw.drain-${surface}] withdraw keeps the first queued message off the provider on ${surface}`, async ({
    page,
    archon,
  }, testInfo: TestInfo) => {
    test.setTimeout(T.xlong * 2);
    const tag = randomUUID().replace(/-/g, '').slice(0, 12);
    const firstMessage = obsoleteMessage(tag);
    const secondMarker = `SECOND-${tag}`;
    const secondMessage = echoMessage(secondMarker);

    const run = await archon.startWorkflowViaWeb(
      E2E_QUEUE_GUIDANCE_WORKFLOW_NAME,
      'e2e withdraw drain'
    );
    const room = await openGuidanceRoom(page, surface, run.runId, QUEUE_GUIDANCE_NODE);
    await waitForNodeStarted(page, run.runId, QUEUE_GUIDANCE_NODE);
    const field = guidanceField(room);
    await expect(field).toBeVisible({ timeout: T.medium });
    if (surface === 'console') {
      await page.setViewportSize({ width: 1440, height: 900 });
    } else {
      await page.setViewportSize({ width: 460, height: 900 });
    }

    const firstId = await queueGuidance(page, room, run.runId, QUEUE_GUIDANCE_NODE, firstMessage);
    const secondId = await queueGuidance(page, room, run.runId, QUEUE_GUIDANCE_NODE, secondMessage);
    expect(secondId).not.toBe(firstId);

    const items = queueList(room).getByRole('listitem');
    await expect(room.getByText('queued · 2')).toBeVisible();
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText(`WITHDRAWN-${tag}`);
    await expect(items.nth(1)).toContainText(secondMarker);

    await test.step('two-row geometry: names, native type, elision, 24px target, focus outline', async () => {
      const firstDelete = rowDeleteButton(items.nth(0));
      const secondDelete = rowDeleteButton(items.nth(1));
      expect(await firstDelete.getAttribute('aria-label')).toBe(`delete · ${firstMessage}`);
      expect(await secondDelete.getAttribute('aria-label')).toBe(`delete · ${secondMessage}`);
      const spanFacts = await messageSpanFacts(items.nth(0));
      await expectNoRoomDrivenOverflow(room, `${surface} two-row`);

      // Keyboard traversal lands on the first row's delete with focus-visible
      // styling; the measurement runs while that focus ring is live.
      await focusDeleteViaKeyboard(page, room, 2, 0);
      expect(
        await firstDelete.evaluate(el => el.ownerDocument.activeElement === el),
        'Shift+Tab traversal focuses the first delete control'
      ).toBe(true);
      const buttonFacts = await measureFocusedDeleteButton(firstDelete);
      await captureEvidence(room, `withdraw-drain-${surface}-two-rows.png`, testInfo);

      const roomWidth = (await room.boundingBox())?.width ?? 0;
      mergeMeasurements(`drain-${surface}-two-rows`, {
        viewport: { width: surface === 'console' ? 1440 : 460, height: 900 },
        roomWidth,
        firstDelete: buttonFacts,
        secondDeleteName: `delete · ${secondMessage}`,
        messageSpan: spanFacts,
        activeBeforeRemoval: await activeElementDescriptor(page),
      });
    });

    if (surface === 'console') {
      await test.step('console 460px overflow guard keeps the two-row band clean', async () => {
        await page.setViewportSize({ width: 460, height: 900 });
        await expect(items).toHaveCount(2);
        await expectNoRoomDrivenOverflow(room, 'console@460 two-row');
        await captureEvidence(room, 'withdraw-drain-console-460-two-rows.png', testInfo);
        await focusDeleteViaKeyboard(page, room, 2, 0);
      });
    }

    await test.step(`${activationKey} deletes the first row: bodyless DELETE, exact 200, focus moves to the sibling`, async () => {
      const deletion = page.waitForResponse(
        res =>
          res.request().method() === 'DELETE' &&
          new URL(res.url()).pathname === deletePathname(run.runId, QUEUE_GUIDANCE_NODE, firstId)
      );
      await page.keyboard.press(activationKey);
      const response = await deletion;
      expect(response.status()).toBe(200);
      expect(response.request().postData(), 'DELETE carries no request body').toBeNull();
      expect(await response.json()).toEqual({ success: true, message_id: firstId });

      await expect(room.getByText('queued · 1')).toBeVisible();
      await expect(items).toHaveCount(1);
      await expect(items.first()).toContainText(secondMarker);
      const remainingDelete = rowDeleteButton(items.first());
      expect(
        await remainingDelete.evaluate(el => el.ownerDocument.activeElement === el),
        'focus lands on the remaining row delete control'
      ).toBe(true);
      await captureEvidence(room, `withdraw-drain-${surface}-one-row.png`, testInfo);
      mergeMeasurements(`drain-${surface}-one-row`, {
        activeAfterRemoval: await activeElementDescriptor(page),
        remainingName: await remainingDelete.getAttribute('aria-label'),
      });
    });

    await test.step('run completes; only the sibling echo reaches the provider', async () => {
      await archon.waitForRunStatus(run.runId, 'completed', T.xlong);
      const texts = await transcriptTexts(page, run.runId, QUEUE_GUIDANCE_NODE);
      expect(
        texts.filter(text => text === `[e2e-fake] resumed echo: ${secondMarker}`)
      ).toHaveLength(1);
      expect(
        texts.filter(text => text.includes(`WITHDRAWN-${tag}`)),
        'withdrawn text never appears in any transcript payload'
      ).toHaveLength(0);
      const detail = await getRunDetail(page, run.runId);
      expect(detail.status).toBe('completed');
      expect(detail.nodeExecutions.filter(row => row.node_id === QUEUE_GUIDANCE_NODE)).toHaveLength(
        1
      );
      expect(
        detail.events.filter(
          event => event.event_type === 'node_started' && event.step_name === QUEUE_GUIDANCE_NODE
        )
      ).toHaveLength(1);
    });
  });

  test(`[P1] [V:withdraw.last-${surface}] removing the only queued row restores the field on ${surface}`, async ({
    page,
    archon,
  }, testInfo: TestInfo) => {
    test.setTimeout(T.xlong * 2);
    const tag = randomUUID().replace(/-/g, '').slice(0, 12);
    const marker = `LAST-${tag}`;
    const message = echoMessage(marker);

    const run = await archon.startWorkflowViaWeb(
      E2E_QUEUE_GUIDANCE_WORKFLOW_NAME,
      'e2e withdraw last'
    );
    const room = await openGuidanceRoom(page, surface, run.runId, QUEUE_GUIDANCE_NODE);
    await waitForNodeStarted(page, run.runId, QUEUE_GUIDANCE_NODE);
    const field = guidanceField(room);
    await expect(field).toBeVisible({ timeout: T.medium });

    const messageId = await queueGuidance(page, room, run.runId, QUEUE_GUIDANCE_NODE, message);
    const items = queueList(room).getByRole('listitem');
    await expect(room.getByText('queued · 1')).toBeVisible();
    await expect(items).toHaveCount(1);

    const deletion = page.waitForResponse(
      res =>
        res.request().method() === 'DELETE' &&
        new URL(res.url()).pathname === deletePathname(run.runId, QUEUE_GUIDANCE_NODE, messageId)
    );
    await focusDeleteViaKeyboard(page, room, 1, 0);
    await page.keyboard.press(activationKey);
    const response = await deletion;
    expect(response.status()).toBe(200);
    expect(response.request().postData(), 'DELETE carries no request body').toBeNull();
    expect(await response.json()).toEqual({ success: true, message_id: messageId });

    await expect(queueList(room)).toHaveCount(0);
    await expect(room.getByText(/^queued ·/)).toHaveCount(0);
    expect(
      await field.evaluate(el => el.ownerDocument.activeElement === el),
      'focus returns to the labelled composer field'
    ).toBe(true);
    expect(
      await page.evaluate(() => document.activeElement?.tagName ?? ''),
      'focus never falls back to <body>'
    ).not.toBe('BODY');
    await captureEvidence(room, `withdraw-last-${surface}-removed.png`, testInfo);
    const settled = {
      activeElement: await activeElementDescriptor(page),
      bandVisible: await queueList(room).count(),
    };

    await test.step('reduced-motion parity: identical final DOM and focus state', async () => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await expect(queueList(room)).toHaveCount(0);
      await expect(room.getByText(/^queued ·/)).toHaveCount(0);
      expect(
        await field.evaluate(el => el.ownerDocument.activeElement === el),
        'reduced motion keeps focus on the field'
      ).toBe(true);
      await captureEvidence(room, `withdraw-last-${surface}-reduced-motion.png`, testInfo);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      mergeMeasurements(`last-${surface}`, {
        ...settled,
        reducedMotionParity: true,
      });
    });

    await test.step('run completes; no resumed echo contains the withdrawn marker', async () => {
      await archon.waitForRunStatus(run.runId, 'completed', T.xlong);
      const texts = await transcriptTexts(page, run.runId, QUEUE_GUIDANCE_NODE);
      expect(
        texts.filter(text => text.includes(marker)),
        'no transcript text carries the withdrawn marker'
      ).toHaveLength(0);
    });
  });
}

test('[P1] [V:withdraw.route-ladder] withdraw route ladder: 200 repeat, 200 unknown id, 400 malformed, 404 unknown, 422 detached, 409 finished', async ({
  page,
  archon,
}) => {
  test.setTimeout(T.xlong * 3);
  const del = (runId: string, nodeId: string, messageId: string): Promise<Response> =>
    archon.starterFetch(deletePathname(runId, nodeId, messageId), { method: 'DELETE' });

  const run = await archon.startWorkflowViaWeb(
    E2E_QUEUE_GUIDANCE_WORKFLOW_NAME,
    'e2e withdraw ladder'
  );
  await waitForNodeStarted(page, run.runId, QUEUE_GUIDANCE_NODE);

  const messageId = randomUUID();
  const queued = await archon.starterFetch(sendPathname(run.runId, QUEUE_GUIDANCE_NODE), {
    method: 'POST',
    body: JSON.stringify({ message: 'ladder guidance', message_id: messageId, intent: 'queue' }),
  });
  expect(queued.status).toBe(200);

  const beforeRefusals = (await listNodeMessages(page, run.runId, QUEUE_GUIDANCE_NODE)).length;

  const removed = await del(run.runId, QUEUE_GUIDANCE_NODE, messageId);
  expect(removed.status).toBe(200);
  expect(await removed.json()).toEqual({ success: true, message_id: messageId });

  const repeated = await del(run.runId, QUEUE_GUIDANCE_NODE, messageId);
  expect(repeated.status).toBe(200);
  expect(await repeated.json()).toEqual({ success: true, message_id: messageId });

  const neverQueued = randomUUID();
  const unknownId = await del(run.runId, QUEUE_GUIDANCE_NODE, neverQueued);
  expect(unknownId.status).toBe(200);
  expect(await unknownId.json()).toEqual({ success: true, message_id: neverQueued });

  const malformed = await del(run.runId, QUEUE_GUIDANCE_NODE, 'not-a-uuid');
  expect(malformed.status).toBe(400);
  expect(await malformed.json()).toMatchObject({
    success: false,
    error: { code: 'invalid_request' },
  });

  const unknownNode = await del(run.runId, 'ghost-node', randomUUID());
  expect(unknownNode.status).toBe(404);
  expect(await unknownNode.json()).toMatchObject({
    success: false,
    error: { code: 'not_found' },
  });

  const unknownRun = await del(randomUUID(), QUEUE_GUIDANCE_NODE, randomUUID());
  expect(unknownRun.status).toBe(404);
  expect(await unknownRun.json()).toMatchObject({
    success: false,
    error: { code: 'not_found' },
  });

  const afterRefusals = (await listNodeMessages(page, run.runId, QUEUE_GUIDANCE_NODE)).length;
  expect(afterRefusals, 'refusal requests mutate no node messages').toBe(beforeRefusals);

  const detached = await archon.startDetachedWorkflow(E2E_QUEUE_GUIDANCE_WORKFLOW_NAME);
  const detachedRunId = await detached.runId;
  await archon.waitForRunStatus(detachedRunId, 'running', T.long);
  await waitForNodeStarted(page, detachedRunId, QUEUE_GUIDANCE_NODE);
  const detachedRes = await del(detachedRunId, QUEUE_GUIDANCE_NODE, randomUUID());
  expect(detachedRes.status).toBe(422);
  expect(await detachedRes.json()).toMatchObject({
    success: false,
    error: { code: 'not_steerable_here' },
  });

  await archon.waitForRunStatus(run.runId, 'completed', T.xlong);
  const beforeFinished = (await listNodeMessages(page, run.runId, QUEUE_GUIDANCE_NODE)).length;
  const finished = await del(run.runId, QUEUE_GUIDANCE_NODE, randomUUID());
  expect(finished.status).toBe(409);
  expect(await finished.json()).toMatchObject({
    success: false,
    error: { code: 'node_finished' },
  });
  const afterFinished = (await listNodeMessages(page, run.runId, QUEUE_GUIDANCE_NODE)).length;
  expect(afterFinished, 'a refused withdraw mutates nothing on a finished run').toBe(
    beforeFinished
  );
});
