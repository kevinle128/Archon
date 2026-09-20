import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import { type Locator, type Page, type Request, type TestInfo } from '@playwright/test';

import { test, expect } from '../lib/playwright/suite';
import {
  E2E_QUEUE_GUIDANCE_LOOP_WORKFLOW_NAME,
  E2E_QUEUE_GUIDANCE_WORKFLOW_NAME,
  E2E_STARTER_WEB_USER,
  HITL_ASK_NODE,
  QUEUE_GUIDANCE_LOOP_NODE,
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
 * Queue guidance for a running agent — outside-in behavior + visual/a11y
 * evidence (issue #181, Story 2.1 / US-005).
 *
 * The `e2e-queue-guidance` fixture runs a single `steer-me` node on the fake
 * provider behind a bounded first-turn delay, so a real web-dispatched turn
 * stays open long enough for queued guidance to arrive and drain at the
 * natural boundary. `e2e-queue-guidance-loop` does the same inside one loop
 * iteration of `steer-loop`. Queued operator text carries an opt-in
 * `echoPrompt` scenario directive so the fake provider echoes the delivered
 * prompt verbatim — proof the guidance became the next provider turn on the
 * same session.
 *
 * Captures and measured geometry/contrast land in the plan's
 * reports/evidence/ dir for the acceptance report.
 */

type Surface = 'console' | 'legacy';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EVIDENCE_DIR = join(
  REPO_ROOT,
  'plans',
  '260918-1721-issue-181-queue-guidance-for-running-agent',
  'reports',
  'evidence'
);
const MEASUREMENTS_FILE = join(EVIDENCE_DIR, 'us-005-measurements.json');

const SCROLLER_TESTID: Record<Surface, string> = {
  console: 'console-node-room-scroll',
  legacy: 'node-transcript-scroll',
};
const ASK_BLOCKED_REASON = "answer the agent's question first";
const DETACHED_DISCLOSURE =
  'not steerable here · this run was started detached, so its live session is not in this process';
const SEND_HINT = 'Cmd/Ctrl+Enter to send · this tab only';
const FIRST_CORRECTION = 'first correction';
const SECOND_CORRECTION = '<<E2E_SCENARIO>>{"echoPrompt":true}<</E2E_SCENARIO>>second correction';
const GUIDANCE_ECHO_TEXT = '[e2e-fake] resumed echo: first correction\n\nsecond correction';
const LOOP_ECHO_TEXT = '[e2e-fake] resumed echo: finish now';
const LOOP_DONE_TEXT = 'E2E_LOOP_DONE';

function sendPathname(runId: string, nodeId: string): string {
  return `/api/workflows/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}/send`;
}

/** Counts POSTs to the node's send route and retains caller message_ids. */
function trackSendRequests(
  page: Page,
  runId: string,
  nodeId: string
): { count: () => number; messageIds: () => string[]; dispose: () => void } {
  const pathname = sendPathname(runId, nodeId);
  let seen = 0;
  const messageIds: string[] = [];
  const listener = (request: Request): void => {
    if (request.method() !== 'POST') return;
    if (new URL(request.url()).pathname !== pathname) return;
    seen += 1;
    try {
      const body = request.postDataJSON() as { message_id?: unknown };
      if (typeof body.message_id === 'string' && body.message_id.length > 0) {
        messageIds.push(body.message_id);
      }
    } catch {
      // Non-JSON bodies are still counted for no-send guards.
    }
  };
  page.on('request', listener);
  return {
    count: () => seen,
    messageIds: () => messageIds.slice(),
    dispose: () => page.off('request', listener),
  };
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

function queueButton(room: Locator): Locator {
  return room.getByRole('button', { name: /^Queue/ });
}

function queueList(room: Locator): Locator {
  return room.getByRole('list', { name: /^Queued messages/ });
}

/** Writes a durable capture to the plan's evidence dir and attaches it. */
async function captureEvidence(target: Locator, name: string, testInfo: TestInfo): Promise<void> {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const shot = await target.screenshot({ path: join(EVIDENCE_DIR, name) });
  await testInfo.attach(name, { body: shot, contentType: 'image/png' });
}

/** Merges one section into us-005-measurements.json so sections survive partial runs. */
function mergeMeasurements(section: string, data: Record<string, unknown>): void {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const current = existsSync(MEASUREMENTS_FILE)
    ? (JSON.parse(readFileSync(MEASUREMENTS_FILE, 'utf8')) as Record<string, unknown>)
    : {};
  current[section] = data;
  writeFileSync(MEASUREMENTS_FILE, `${JSON.stringify(current, null, 2)}\n`);
}

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Parses any computed CSS color (incl. color-mix/oklch) through a 2d canvas. */
async function resolveColorIn(host: Locator, css: string): Promise<{ resolved: string; c: Rgba }> {
  return host.evaluate((hostEl, colorCss) => {
    const doc = hostEl.ownerDocument;
    const probe = doc.createElement('span');
    probe.style.color = colorCss;
    hostEl.appendChild(probe);
    const resolved = doc.defaultView?.getComputedStyle(probe).color ?? '';
    probe.remove();
    const ctx = doc.createElement('canvas').getContext('2d');
    if (ctx === null) return { resolved, c: { r: 0, g: 0, b: 0, a: 0 } };
    ctx.fillStyle = resolved;
    ctx.fillRect(0, 0, 1, 1);
    const data = ctx.getImageData(0, 0, 1, 1).data;
    return {
      resolved,
      c: { r: data[0] ?? 0, g: data[1] ?? 0, b: data[2] ?? 0, a: (data[3] ?? 0) / 255 },
    };
  }, css);
}

/** Effective background under an element: first non-transparent ancestor fill. */
async function effectiveBackground(el: Locator): Promise<{ resolved: string; c: Rgba }> {
  return el.evaluate((node: HTMLElement) => {
    const doc = node.ownerDocument;
    const ctx = doc.createElement('canvas').getContext('2d');
    const parse = (css: string): { resolved: string; c: Rgba } => {
      if (ctx === null) return { resolved: css, c: { r: 0, g: 0, b: 0, a: 0 } };
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const data = ctx.getImageData(0, 0, 1, 1).data;
      return {
        resolved: css,
        c: { r: data[0] ?? 0, g: data[1] ?? 0, b: data[2] ?? 0, a: (data[3] ?? 0) / 255 },
      };
    };
    let current: HTMLElement | null = node;
    while (current !== null) {
      const bg = doc.defaultView?.getComputedStyle(current).backgroundColor ?? 'rgba(0, 0, 0, 0)';
      const parsed = parse(bg);
      if (parsed.c.a > 0.01) return parsed;
      current = current.parentElement;
    }
    return parse('rgb(0, 0, 0)');
  });
}

function composite(fg: Rgba, bg: Rgba): Rgba {
  return {
    r: Math.round(fg.r * fg.a + bg.r * (1 - fg.a)),
    g: Math.round(fg.g * fg.a + bg.g * (1 - fg.a)),
    b: Math.round(fg.b * fg.a + bg.b * (1 - fg.a)),
    a: 1,
  };
}

function relativeLuminance(c: Rgba): number {
  const channel = (v: number): number => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

function contrastRatio(fg: Rgba, bg: Rgba): number {
  const solid = composite(fg, bg);
  const a = relativeLuminance(solid);
  const b = relativeLuminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** Text color contrast for `el` against its effective background. */
async function textContrast(el: Locator): Promise<{ ratio: number; color: string; bg: string }> {
  const color = await el.evaluate(
    node => node.ownerDocument.defaultView?.getComputedStyle(node).color ?? ''
  );
  const fg = await resolveColorIn(el, color);
  const bg = await effectiveBackground(el);
  return { ratio: contrastRatio(fg.c, bg.c), color: fg.resolved, bg: bg.resolved };
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
      // Zero-area / hairline SVG geometry can report a sub-pixel overhang
      // without contributing to page scroll — ignore those; they are not a
      // room-driven overflow the operator can see.
      if (rect.width < 1 || rect.height < 1) return;
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
      insideSample: offenders
        .filter(o => o.insideRoom)
        .slice(0, 5)
        .map(o => o.tag),
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
    `no room element overflows the page ${context} (inside offenders: ${report.insideSample.join(', ') || 'none'}; outside offenders: ${report.outsideSample.join(', ') || 'none'}; page overflow ${String(report.pageOverflow)}px)`
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

for (const surface of ['console', 'legacy'] as const) {
  test(`[P1] [V:steer.direct-${surface}] queue guidance drains at the natural boundary on ${surface}`, async ({
    page,
    archon,
  }, testInfo: TestInfo) => {
    test.setTimeout(T.xlong * 2);
    await page.setExtraHTTPHeaders({ 'X-Archon-User': E2E_STARTER_WEB_USER });
    const run = await archon.startWorkflowViaWeb(
      E2E_QUEUE_GUIDANCE_WORKFLOW_NAME,
      'e2e queue guidance'
    );
    const sends = trackSendRequests(page, run.runId, QUEUE_GUIDANCE_NODE);
    const room = await openGuidanceRoom(page, surface, run.runId, QUEUE_GUIDANCE_NODE);
    const field = guidanceField(room);
    const queue = queueButton(room);

    await test.step('generating-empty dock: composer visible, no band, labeled controls', async () => {
      await expect(field).toBeVisible({ timeout: T.medium });
      await expect(queue).toBeVisible();
      await expect(queue).toHaveAttribute('aria-keyshortcuts', 'Meta+Enter Control+Enter');
      await expect(room.getByText(SEND_HINT)).toBeVisible();
      await expect(room.getByText(/^queued ·/)).toHaveCount(0);
      await captureEvidence(room, `us-005-${surface}-generating-empty.png`, testInfo);
    });

    await test.step('plain Enter and Shift+Enter stay native newlines; IME-composing shortcut sends nothing', async () => {
      await field.focus();
      await field.press('Enter');
      await field.press('Shift+Enter');
      expect(await field.inputValue()).toBe('\n\n');
      await field.fill(FIRST_CORRECTION);
      await field.evaluate(el => {
        el.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            metaKey: true,
            isComposing: true,
            bubbles: true,
          })
        );
      });
      await page.waitForTimeout(300);
      expect(sends.count()).toBe(0);
      await expect(room.getByText(/^queued ·/)).toHaveCount(0);
    });

    await test.step('two sends queue two sent receipts in order and keep focus in the field', async () => {
      const first = page.waitForResponse(
        res => new URL(res.url()).pathname === sendPathname(run.runId, QUEUE_GUIDANCE_NODE)
      );
      await field.press('Meta+Enter');
      expect((await first).status()).toBe(200);
      await expect(room.getByText('queued · 1')).toBeVisible();
      const items = queueList(room).getByRole('listitem');
      await expect(items).toHaveCount(1);
      await expect(items.first()).toContainText(FIRST_CORRECTION);
      await expect(items.first()).toContainText('sent');
      await expect(room.locator('[role="status"]')).toContainText('1 message queued');
      expect(await field.evaluate(el => el.ownerDocument.activeElement === el)).toBe(true);

      const second = page.waitForResponse(
        res => new URL(res.url()).pathname === sendPathname(run.runId, QUEUE_GUIDANCE_NODE)
      );
      await field.fill(SECOND_CORRECTION);
      await queue.click();
      expect((await second).status()).toBe(200);
      await expect(room.getByText('queued · 2')).toBeVisible();
      await expect(items).toHaveCount(2);
      await expect(items.nth(0)).toContainText(FIRST_CORRECTION);
      await expect(items.nth(1)).toContainText('second correction');
      await expect(items.nth(1)).toContainText('sent');
      expect(await field.evaluate(el => el.ownerDocument.activeElement === el)).toBe(true);
      expect(sends.count()).toBe(2);
      expect(sends.messageIds()).toHaveLength(2);
      await captureEvidence(room, `us-005-${surface}-queued-2.png`, testInfo);
    });

    await test.step('run completes; operator rows precede the caused echo on the same session', async () => {
      await archon.waitForRunStatus(run.runId, 'completed', T.xlong);
      const messages = await listNodeMessages(page, run.runId, QUEUE_GUIDANCE_NODE);
      const operatorRows = messages.filter(
        message => message.kind === 'text' && message.metadata?.origin === 'operator'
      );
      expect(operatorRows, 'exactly two drained operator rows').toHaveLength(2);
      expect(operatorRows[0]!.seq).toBeLessThan(operatorRows[1]!.seq);
      expect(operatorRows[0]!.payload.text).toBe(FIRST_CORRECTION);
      expect(operatorRows[1]!.payload.text).toBe(SECOND_CORRECTION);

      const callerIds = sends.messageIds();
      expect(callerIds).toHaveLength(2);
      expect(operatorRows[0]!.metadata?.message_id).toBe(callerIds[0]);
      expect(operatorRows[1]!.metadata?.message_id).toBe(callerIds[1]);

      const senderId = operatorRows[0]!.metadata?.operator_user_id;
      expect(typeof senderId).toBe('string');
      expect(senderId && senderId.length > 0).toBe(true);
      expect(operatorRows[1]!.metadata?.operator_user_id).toBe(senderId);
      expect(operatorRows[0]!.operator_display_name).toBe('e2e-starter');
      expect(operatorRows[1]!.operator_display_name).toBe('e2e-starter');

      const echoRow = messages.find(
        message => message.kind === 'text' && message.payload.text === GUIDANCE_ECHO_TEXT
      );
      expect(echoRow, 'one resumed echo carries the drained batch').toBeTruthy();
      expect(operatorRows[1]!.seq).toBeLessThan(echoRow!.seq);
      const causedAttempt = echoRow!.metadata?.execution?.attempt_id;
      expect(typeof causedAttempt).toBe('string');
      expect(operatorRows[0]!.metadata?.execution?.attempt_id).toBe(causedAttempt);
      expect(operatorRows[1]!.metadata?.execution?.attempt_id).toBe(causedAttempt);

      const priorAttempt = messages
        .filter(
          message =>
            message.kind === 'text' &&
            message.metadata?.origin !== 'operator' &&
            message.seq < operatorRows[0]!.seq &&
            typeof message.metadata?.execution?.attempt_id === 'string'
        )
        .at(-1)?.metadata?.execution?.attempt_id;
      if (priorAttempt !== undefined) {
        expect(priorAttempt, 'operator rows use the caused attempt, not the prior turn').not.toBe(
          causedAttempt
        );
      }

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

      const freshRoom = await openGuidanceRoom(page, surface, run.runId, QUEUE_GUIDANCE_NODE);
      const operatorDom = freshRoom.locator('[data-operator-row]');
      await expect(operatorDom).toHaveCount(2);
      await expect(operatorDom.nth(0).locator('[data-operator-label]')).toHaveText(
        'operator · e2e-starter'
      );
      await expect(operatorDom.nth(1).locator('[data-operator-label]')).toHaveText(
        'operator · e2e-starter'
      );
      await expect(operatorDom.nth(0).locator('[data-operator-delivery]')).toHaveText('sent');
      await expect(operatorDom.nth(1).locator('[data-operator-delivery]')).toHaveText('sent');
      await expect(operatorDom.nth(0).locator('[data-operator-body]')).toHaveText(FIRST_CORRECTION);
      await expect(operatorDom.nth(1).locator('[data-operator-body]')).toHaveText(
        SECOND_CORRECTION
      );

      const order = await freshRoom.evaluate(() => {
        const ops = Array.from(document.querySelectorAll('[data-operator-row]'));
        if (ops.length !== 2) return `ops=${ops.length}`;
        const echoLeaf = Array.from(document.querySelectorAll('*')).find(
          el =>
            el.childElementCount === 0 &&
            (el.textContent ?? '').includes('resumed echo: first correction')
        );
        if (echoLeaf === undefined) return 'missing-echo';
        const following = Node.DOCUMENT_POSITION_FOLLOWING;
        if ((ops[0]!.compareDocumentPosition(ops[1]!) & following) === 0) return 'ops-order';
        if ((ops[1]!.compareDocumentPosition(echoLeaf) & following) === 0) {
          return 'echo-before-ops';
        }
        return 'ok';
      });
      expect(order, 'operator rows precede the caused echo in DOM order').toBe('ok');

      await expect(freshRoom.getByText(/resumed echo: first correction/)).toBeVisible({
        timeout: T.medium,
      });
      await expect(freshRoom.getByText('delivered')).toHaveCount(0);
      await expect(guidanceField(freshRoom)).toHaveCount(0);
    });
  });

  test(`[P1] [V:steer.loop-${surface}] queue guidance drains inside the loop iteration on ${surface}`, async ({
    page,
    archon,
  }) => {
    test.setTimeout(T.xlong * 2);
    const run = await archon.startWorkflowViaWeb(
      E2E_QUEUE_GUIDANCE_LOOP_WORKFLOW_NAME,
      'e2e loop guidance'
    );
    const room = await openGuidanceRoom(page, surface, run.runId, QUEUE_GUIDANCE_LOOP_NODE);
    const field = guidanceField(room);
    await expect(field).toBeVisible({ timeout: T.medium });
    const sent = page.waitForResponse(
      res => new URL(res.url()).pathname === sendPathname(run.runId, QUEUE_GUIDANCE_LOOP_NODE)
    );
    await field.fill(
      '<<E2E_SCENARIO>>{"echoPrompt":true,"doneWhenPromptIncludes":"finish"}<</E2E_SCENARIO>>finish now'
    );
    await field.press('Meta+Enter');
    expect((await sent).status()).toBe(200);
    await expect(room.getByText('queued · 1')).toBeVisible();

    await archon.waitForRunStatus(run.runId, 'completed', T.xlong);
    const detail = await getRunDetail(page, run.runId);
    expect(detail.status).toBe('completed');
    expect(
      detail.events.filter(
        event =>
          event.event_type === 'loop_iteration_started' &&
          event.step_name === QUEUE_GUIDANCE_LOOP_NODE
      )
    ).toHaveLength(1);
    expect(
      detail.events.filter(
        event => event.event_type === 'node_started' && event.step_name === QUEUE_GUIDANCE_LOOP_NODE
      )
    ).toHaveLength(1);
    const texts = await transcriptTexts(page, run.runId, QUEUE_GUIDANCE_LOOP_NODE);
    const echoIndex = texts.indexOf(LOOP_ECHO_TEXT);
    const doneIndex = texts.indexOf(LOOP_DONE_TEXT);
    expect(echoIndex).toBeGreaterThanOrEqual(0);
    expect(doneIndex).toBeGreaterThan(echoIndex);
    await openGuidanceRoom(page, surface, run.runId, QUEUE_GUIDANCE_LOOP_NODE);
    // DOM corroboration: the delivered echo and the sentinel render inside the
    // run's stream; a second iteration group never appears anywhere.
    await expect(page.getByText(LOOP_ECHO_TEXT).first()).toBeVisible({ timeout: T.medium });
    await expect(page.getByText(LOOP_DONE_TEXT).first()).toBeVisible();
    await expect(page.getByText('×2')).toHaveCount(0);
    if (surface === 'console') {
      // In the console log stream the echo and sentinel sit inside the ×1
      // group, after its header and before the node's completion row.
      const order = await page.evaluate(() => {
        const text = (document.querySelector('main') ?? document.body).textContent ?? '';
        return {
          text,
          group: text.indexOf('steer-loop ×1'),
          echo: text.indexOf('[e2e-fake] resumed echo: finish now'),
          done: text.indexOf('E2E_LOOP_DONE'),
        };
      });
      expect(order.group, '×1 group header exists').toBeGreaterThanOrEqual(0);
      expect(order.echo).toBeGreaterThan(order.group);
      expect(order.done).toBeGreaterThan(order.echo);
      expect(
        order.text.match(/steer-loop ×/g)?.length ?? 0,
        'exactly one iteration group for steer-loop'
      ).toBe(1);
    }
  });

  test(`[P1] [V:steer.blocked-${surface}] a pending Ask blocks queue guidance on ${surface}`, async ({
    page,
    archon,
  }, testInfo: TestInfo) => {
    test.setTimeout(T.xlong * 2);
    const run = await archon.runHitlWorkflowViaWeb();
    const sends = trackSendRequests(page, run.runId, HITL_ASK_NODE);
    const room = await openGuidanceRoom(page, surface, run.runId, HITL_ASK_NODE);
    const field = guidanceField(room);
    const queue = queueButton(room);
    await expect(field).toBeVisible({ timeout: T.medium });

    await expect(queue).toHaveAttribute('aria-disabled', 'true');
    expect(await queue.getAttribute('disabled')).toBeNull();
    const reasonId = await queue.getAttribute('aria-describedby');
    expect(reasonId, 'Queue exposes aria-describedby for the blocked reason').toBeTruthy();
    await expect(room.locator(`[id="${reasonId ?? ''}"]`)).toHaveText(ASK_BLOCKED_REASON);
    await expect(room.locator('[role="status"]')).toContainText(ASK_BLOCKED_REASON);
    // aria-disabled keeps the control tabbable instead of removing it.
    await queue.focus();
    expect(await queue.evaluate(el => el.ownerDocument.activeElement === el)).toBe(true);

    await field.fill('do not send me');
    // aria-disabled (not a native disabled) keeps the control focusable and
    // pointer-reachable; force the click past Playwright's enabled check so the
    // guarded submit runs and provably sends nothing.
    await queue.click({ force: true });
    await field.press('Meta+Enter');
    await page.waitForTimeout(400);
    expect(sends.count()).toBe(0);
    await expect(room.getByText(/^queued ·/)).toHaveCount(0);

    const reason = await textContrast(room.locator(`[id="${reasonId ?? ''}"]`));
    expect(reason.ratio, 'blocked reason text contrast ≥ 4.5:1').toBeGreaterThanOrEqual(4.5);
    mergeMeasurements(`blocked-${surface}`, {
      reasonText: ASK_BLOCKED_REASON,
      reasonColor: reason.color,
      background: reason.bg,
      contrastRatio: Number(reason.ratio.toFixed(2)),
    });
    await captureEvidence(room, `us-005-${surface}-ask-blocked.png`, testInfo);
  });

  test(`[P1] [V:steer.detached-${surface}] queue guidance discloses a detached run after a 422 on ${surface}`, async ({
    page,
    archon,
  }, testInfo: TestInfo) => {
    test.setTimeout(T.xlong * 2);
    const detached = await archon.startDetachedWorkflow(E2E_QUEUE_GUIDANCE_WORKFLOW_NAME);
    const runId = await detached.runId;
    await archon.waitForRunStatus(runId, 'running', T.long);
    await waitForNodeStarted(page, runId, QUEUE_GUIDANCE_NODE);
    const room = await openGuidanceRoom(page, surface, runId, QUEUE_GUIDANCE_NODE);
    const field = guidanceField(room);
    // No queue read exists yet, so the composer cannot know it is detached;
    // the 422 response is what discloses it.
    await expect(field).toBeVisible({ timeout: T.medium });
    const response = page.waitForResponse(
      res => new URL(res.url()).pathname === sendPathname(runId, QUEUE_GUIDANCE_NODE)
    );
    await field.fill('detach probe');
    await field.press('Meta+Enter');
    expect((await response).status()).toBe(422);

    const disclosure = room.getByRole('alert');
    await expect(disclosure).toContainText(DETACHED_DISCLOSURE);
    await expect(field).toHaveCount(0);
    await expect(room.getByText(/^queued ·/)).toHaveCount(0);

    const stored = await page.evaluate(
      key => sessionStorage.getItem(key),
      `archon:steering-draft:${runId}:${QUEUE_GUIDANCE_NODE}`
    );
    expect(stored, 'draft + retry id persist in sessionStorage after the refusal').toBeTruthy();
    const record = JSON.parse(stored ?? '{}') as {
      draft?: string;
      pendingRetry?: { messageId?: string; message?: string };
    };
    expect(record.draft).toBe('detach probe');
    expect(record.pendingRetry?.message).toBe('detach probe');
    expect(record.pendingRetry?.messageId).toMatch(/^[0-9a-f-]{36}$/);

    const alert = await textContrast(disclosure);
    expect(alert.ratio, 'detached disclosure text contrast ≥ 4.5:1').toBeGreaterThanOrEqual(4.5);
    mergeMeasurements(`detached-${surface}`, {
      disclosure: DETACHED_DISCLOSURE,
      textColor: alert.color,
      background: alert.bg,
      contrastRatio: Number(alert.ratio.toFixed(2)),
    });
    await captureEvidence(room, `us-005-${surface}-detached-422.png`, testInfo);
  });

  test(`[P1] [V:steer.visual-${surface}] queue guidance dock geometry, contrast, and reduced-motion evidence on ${surface}`, async ({
    page,
    archon,
  }, testInfo: TestInfo) => {
    test.setTimeout(T.xlong * 2);
    const run = await archon.startWorkflowViaWeb(
      E2E_QUEUE_GUIDANCE_WORKFLOW_NAME,
      'e2e visual guidance'
    );
    const room = await openGuidanceRoom(page, surface, run.runId, QUEUE_GUIDANCE_NODE);
    const field = guidanceField(room);
    const queue = queueButton(room);
    await expect(field).toBeVisible({ timeout: T.medium });

    await field.fill('visual one');
    await queue.click();
    await expect(room.getByText('queued · 1')).toBeVisible();
    await field.fill('visual two');
    await queue.click();
    const items = queueList(room).getByRole('listitem');
    await expect(items).toHaveCount(2);

    await test.step('contrast: receipts, sent badges, hint, and field focus ring', async () => {
      const receiptText = await textContrast(items.first().locator('span').first());
      const sentBadge = await textContrast(items.first().locator('span').last());
      const hint = await textContrast(room.getByText(SEND_HINT));
      const queueLabel = await textContrast(queue);
      expect(receiptText.ratio, 'receipt text ≥ 4.5:1').toBeGreaterThanOrEqual(4.5);
      expect(sentBadge.ratio, 'sent badge ≥ 4.5:1').toBeGreaterThanOrEqual(4.5);
      expect(hint.ratio, 'hint text ≥ 4.5:1').toBeGreaterThanOrEqual(4.5);
      expect(queueLabel.ratio, 'queue label ≥ 4.5:1').toBeGreaterThanOrEqual(4.5);

      await field.focus();
      const ring = await field.evaluate(el => {
        const style = el.ownerDocument.defaultView?.getComputedStyle(el);
        return { outline: style?.outlineColor ?? '', width: style?.outlineWidth ?? '' };
      });
      const ringColor = await resolveColorIn(field, ring.outline);
      const dockBg = await effectiveBackground(field);
      const ringRatio = contrastRatio(ringColor.c, dockBg.c);
      expect(ring.width, 'focus ring has a visible width').not.toBe('0px');
      expect(ringRatio, 'focus indicator ≥ 3:1').toBeGreaterThanOrEqual(3.0);

      const bandScroll = queueList(room).locator('xpath=..');
      const bandMetrics = await bandScroll.evaluate(el => {
        const style = el.ownerDocument.defaultView?.getComputedStyle(el);
        return {
          maxHeight: style?.maxHeight ?? '',
          overflowY: style?.overflowY ?? '',
          clientHeight: el.clientHeight,
          scrollHeight: el.scrollHeight,
          viewportHeight: el.ownerDocument.documentElement.clientHeight,
        };
      });
      const maxHeightPx = parseFloat(bandMetrics.maxHeight);
      expect(
        Math.abs(maxHeightPx - bandMetrics.viewportHeight * 0.33),
        `band max-height ${bandMetrics.maxHeight} ≈ 33vh`
      ).toBeLessThanOrEqual(2);
      expect(bandMetrics.overflowY).toBe('auto');
      expect(bandMetrics.scrollHeight).toBeLessThanOrEqual(bandMetrics.clientHeight + 1);

      mergeMeasurements(`contrast-${surface}`, {
        receiptText: Number(receiptText.ratio.toFixed(2)),
        sentBadge: Number(sentBadge.ratio.toFixed(2)),
        hint: Number(hint.ratio.toFixed(2)),
        queueLabel: Number(queueLabel.ratio.toFixed(2)),
        focusRing: { color: ring.outline, ratio: Number(ringRatio.toFixed(2)) },
        band: bandMetrics,
      });
    });

    await test.step('460px and console 1440x900 captures with no horizontal overflow', async () => {
      await page.setViewportSize({ width: 460, height: 900 });
      await expect(items).toHaveCount(2);
      // The Console shell runs first in a cold browser context. Wait for its
      // web fonts and two paint frames so fallback-font widths cannot produce
      // a one-frame false overflow that disappears once the real font loads.
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise<void>(resolve => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => resolve());
          });
        });
      });
      // Wait for the room panel to reflow into the 460px viewport before the
      // geometry assertion — a mid-resize snapshot can report a transient
      // overhang that the final layout does not keep.
      await expect
        .poll(async () => (await room.boundingBox())?.width ?? Number.POSITIVE_INFINITY, {
          timeout: T.medium,
        })
        .toBeLessThanOrEqual(460);
      await expectNoRoomDrivenOverflow(room, `${surface}@460`);
      await captureEvidence(room, `us-005-${surface}-460-queued-2.png`, testInfo);
      const narrowWidth = (await room.boundingBox())?.width ?? 0;
      if (surface === 'console') {
        await page.setViewportSize({ width: 1440, height: 900 });
        await expect(items).toHaveCount(2);
        await expectNoRoomDrivenOverflow(room, 'console@1440');
        const roomWidth = (await room.boundingBox())?.width ?? 0;
        await captureEvidence(room, 'us-005-console-1440-queued-2.png', testInfo);
        mergeMeasurements('console-viewports', { narrow460: narrowWidth, wide1440: roomWidth });
      } else {
        mergeMeasurements('legacy-viewports', { narrow460: narrowWidth });
      }
    });

    await test.step('reduced-motion parity', async () => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await expect(items).toHaveCount(2);
      await expect(items.first()).toContainText('sent');
      await captureEvidence(room, `us-005-${surface}-queued-2-reduced-motion.png`, testInfo);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
    });

    await test.step('transcript last row stays reachable and the run completes', async () => {
      await archon.waitForRunStatus(run.runId, 'completed', T.xlong);
      const freshRoom = await openGuidanceRoom(page, surface, run.runId, QUEUE_GUIDANCE_NODE);
      await expect(freshRoom.getByText(/deterministic response/).first()).toBeVisible({
        timeout: T.medium,
      });
      const lastRowVisible = await freshRoom.evaluate(roomEl => {
        const scrollerEl = roomEl.querySelector(
          '[data-testid="console-node-room-scroll"], [data-testid="node-transcript-scroll"]'
        );
        if (scrollerEl === null) return 'no-scroller';
        scrollerEl.scrollTop = scrollerEl.scrollHeight;
        const leaves = Array.from(roomEl.querySelectorAll('*')).filter(
          node => node.children.length === 0 && node.textContent?.includes('deterministic response')
        );
        const target = leaves.at(-1);
        if (target === undefined) return 'no-target';
        const band = scrollerEl.getBoundingClientRect();
        const rect = target.getBoundingClientRect();
        return rect.bottom > band.top && rect.top < band.bottom
          ? 'ok'
          : `offscreen ${String(rect.top)}..${String(rect.bottom)} vs ${String(band.top)}..${String(band.bottom)}`;
      });
      expect(lastRowVisible, 'last transcript row reachable by scrolling').toBe('ok');
    });
  });
}

test('[P1] [V:steer.route-smoke] queue guidance send route ladder: 200 live, 400 malformed, 404 unknown, 409 finished, 422 detached', async ({
  page,
  archon,
}) => {
  test.setTimeout(T.xlong * 2);
  const post = (runId: string, nodeId: string, body: unknown): Promise<Response> =>
    archon.starterFetch(sendPathname(runId, nodeId), {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  const run = await archon.startWorkflowViaWeb(E2E_QUEUE_GUIDANCE_WORKFLOW_NAME, 'e2e route smoke');
  await waitForNodeStarted(page, run.runId, QUEUE_GUIDANCE_NODE);

  const messageId = randomUUID();
  const live = await post(run.runId, QUEUE_GUIDANCE_NODE, {
    message: 'route smoke guidance',
    message_id: messageId,
    intent: 'queue',
  });
  expect(live.status).toBe(200);
  const liveBody = (await live.json()) as {
    success?: boolean;
    message_id?: string;
    state?: string;
  };
  expect(liveBody).toEqual({ success: true, message_id: messageId, state: 'queued' });

  const malformed = await post(run.runId, QUEUE_GUIDANCE_NODE, '{"message":');
  expect(malformed.status).toBe(400);
  expect(await malformed.json()).toMatchObject({
    success: false,
    error: { code: 'invalid_request' },
  });

  const schemaInvalid = await post(run.runId, QUEUE_GUIDANCE_NODE, {
    message: 'route smoke guidance',
    message_id: 'not-a-uuid',
    intent: 'queue',
  });
  expect(schemaInvalid.status).toBe(400);
  expect(await schemaInvalid.json()).toMatchObject({
    success: false,
    error: { code: 'invalid_request' },
  });

  const unknown = await post(run.runId, 'ghost-node', {
    message: 'route smoke guidance',
    message_id: randomUUID(),
    intent: 'queue',
  });
  expect(unknown.status).toBe(404);
  expect(await unknown.json()).toMatchObject({
    success: false,
    error: { code: 'not_found' },
  });

  const detached = await archon.startDetachedWorkflow(E2E_QUEUE_GUIDANCE_WORKFLOW_NAME);
  const detachedRunId = await detached.runId;
  await archon.waitForRunStatus(detachedRunId, 'running', T.long);
  await waitForNodeStarted(page, detachedRunId, QUEUE_GUIDANCE_NODE);
  const detachedRes = await post(detachedRunId, QUEUE_GUIDANCE_NODE, {
    message: 'route smoke guidance',
    message_id: randomUUID(),
    intent: 'queue',
  });
  expect(detachedRes.status).toBe(422);
  expect(await detachedRes.json()).toMatchObject({
    success: false,
    error: { code: 'not_steerable_here' },
  });

  await archon.waitForRunStatus(run.runId, 'completed', T.xlong);
  const before = (await listNodeMessages(page, run.runId, QUEUE_GUIDANCE_NODE)).length;
  const finished = await post(run.runId, QUEUE_GUIDANCE_NODE, {
    message: 'route smoke guidance',
    message_id: randomUUID(),
    intent: 'queue',
  });
  expect(finished.status).toBe(409);
  expect(await finished.json()).toMatchObject({
    success: false,
    error: { code: 'node_finished' },
  });
  const after = (await listNodeMessages(page, run.runId, QUEUE_GUIDANCE_NODE)).length;
  expect(after, 'a rejected send mutates nothing').toBe(before);
});
