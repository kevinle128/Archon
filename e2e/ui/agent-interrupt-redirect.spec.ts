import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import { type Locator, type Page, type Request, type Route, type TestInfo } from '@playwright/test';

import { test, expect } from '../lib/playwright/suite';
import {
  E2E_QUEUE_GUIDANCE_LOOP_WORKFLOW_NAME,
  E2E_QUEUE_GUIDANCE_WORKFLOW_NAME,
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
 * Interrupt and redirect a running agent — outside-in behavior + visual/a11y
 * evidence (issue #183, Story 2.3 / US-005).
 *
 * The `e2e-queue-guidance` fixtures now open on an opt-in
 * `{"interruptible":true,"emitTool":true,"delayMs":…}` scenario: the fake
 * provider emits the deterministic tool call and parks its result until the
 * turn `interruptSignal` (Stop) or the bounded delay settles it — a real
 * web-dispatched run with zero vendor timing. `Stop` posts to the interrupt
 * route, which awaits the engine's classified outcome; `Send now` releases
 * the queued batch plus the typed message on the SAME provider session.
 *
 * The redirect text carries the `echoPrompt` scenario directive so the fake
 * echoes the delivered batch verbatim — `resumed echo` is itself the
 * same-session proof. The loop redirect adds `doneWhenPromptIncludes` so the
 * interrupted iteration finishes deterministically.
 *
 * Captures and measured geometry/contrast land in this plan's
 * reports/evidence/ dir for the acceptance report.
 */

type Surface = 'console' | 'legacy';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EVIDENCE_DIR = join(
  REPO_ROOT,
  'plans',
  '260919-0139-issue-183-interrupt-and-redirect-claude-agent',
  'reports',
  'evidence'
);
const MEASUREMENTS_FILE = join(EVIDENCE_DIR, 'us-005-measurements.json');

const SCROLLER_TESTID: Record<Surface, string> = {
  console: 'console-node-room-scroll',
  legacy: 'node-transcript-scroll',
};

const INTERRUPT_DISCLOSURE =
  'stopped after the last completed tool call · files already written stay written';
const SEND_HINT = 'Cmd/Ctrl+Enter to send · this tab only';
const AGENT_INTERRUPTING = 'agent interrupting';
const AGENT_IDLE = 'agent idle · Send now delivers';
const AGENT_GENERATING = 'agent generating';
const INTERRUPT_FAILED = "couldn't interrupt · try again";
const DETACHED_DISCLOSURE =
  'not steerable here · this run was started detached, so its live session is not in this process';

const REDIRECT_SCENARIO = '{"echoPrompt":true,"delayMs":1500}';
const REDIRECT_TEXT = `<<E2E_SCENARIO>>${REDIRECT_SCENARIO}<</E2E_SCENARIO>>third`;
const REDIRECT_ECHO = '[e2e-fake] resumed echo: first\n\nsecond\n\nthird';
const LOOP_REDIRECT_SCENARIO =
  '{"echoPrompt":true,"doneWhenPromptIncludes":"finish","delayMs":1500}';
const LOOP_REDIRECT_TEXT = `<<E2E_SCENARIO>>${LOOP_REDIRECT_SCENARIO}<</E2E_SCENARIO>>finish now`;
const LOOP_ECHO_TEXT = '[e2e-fake] resumed echo: finish now';
const LOOP_DONE_TEXT = 'E2E_LOOP_DONE';

function sendPathname(runId: string, nodeId: string): string {
  return `/api/workflows/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}/send`;
}

function interruptPathname(runId: string, nodeId: string): string {
  return `/api/workflows/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}/interrupt`;
}

/** Counts POSTs to a node route so no-request guards are provable. */
function trackPosts(
  page: Page,
  pathname: string
): { count: () => number; bodies: () => unknown[]; dispose: () => void } {
  let seen = 0;
  const bodies: unknown[] = [];
  const listener = (request: Request): void => {
    if (request.method() !== 'POST') return;
    if (new URL(request.url()).pathname !== pathname) return;
    seen += 1;
    try {
      bodies.push(request.postDataJSON() as unknown);
    } catch {
      bodies.push(request.postData());
    }
  };
  page.on('request', listener);
  return {
    count: () => seen,
    bodies: () => bodies,
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

function stopButton(room: Locator): Locator {
  return room.getByRole('button', { name: /^(Stop|Stopping…)$/ });
}

function queueButton(room: Locator): Locator {
  return room.getByRole('button', { name: /^Queue/ });
}

function sendNowButton(room: Locator): Locator {
  return room.getByRole('button', { name: /^Send now/ });
}

function queueList(room: Locator): Locator {
  return room.getByRole('list', { name: /^Queued messages/ });
}

function willSendList(room: Locator): Locator {
  return room.getByRole('list', { name: /^Will send/ });
}

/** The polite live region inside the dock well. */
function dockStatus(room: Locator): Locator {
  return room.locator('[role="status"]');
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

/** Live node-state projection (status + steeringSubState) for one node. */
async function getNodeState(
  page: Page,
  runId: string,
  nodeId: string
): Promise<{ nodeId: string; status: string; steeringSubState?: string } | undefined> {
  const res = await page.request.get(`/api/workflows/runs/${encodeURIComponent(runId)}`);
  expect(res.ok(), `run-detail API for ${runId} responded ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as {
    nodeStates?: { nodeId: string; status: string; steeringSubState?: string }[];
  };
  return body.nodeStates?.find(state => state.nodeId === nodeId);
}

/** Polls until the node's projected sub-state matches (or throws with state). */
async function waitForSubState(
  page: Page,
  runId: string,
  nodeId: string,
  expected: 'generating' | 'idle-after-interrupt'
): Promise<void> {
  const deadline = Date.now() + T.long;
  let last = 'absent';
  while (Date.now() < deadline) {
    const state = await getNodeState(page, runId, nodeId);
    if (state?.steeringSubState === expected) return;
    last =
      state === undefined ? 'no node state' : `${state.status}/${state.steeringSubState ?? 'none'}`;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`node ${nodeId} never projected ${expected} (${last})`);
}

/** Text payloads recorded for the node, in transcript order. */
async function transcriptTexts(page: Page, runId: string, nodeId: string): Promise<string[]> {
  const messages = await listNodeMessages(page, runId, nodeId);
  return messages
    .filter(message => message.kind === 'text' && typeof message.payload.text === 'string')
    .map(message => message.payload.text as string);
}

/**
 * Holds the interrupt response behind an explicit gate so the UI-local
 * `interrupting` transient is observable without browser sleeps: the request
 * still reaches the real server (the turn settles there), only the response
 * is released late.
 */
async function holdInterruptResponse(
  page: Page,
  runId: string,
  nodeId: string
): Promise<{ release: () => void; unroute: () => Promise<void> }> {
  const pathname = interruptPathname(runId, nodeId);
  let releaseGate: () => void = () => undefined;
  const gate = new Promise<void>(resolve => {
    releaseGate = resolve;
  });
  const handler = async (route: Route): Promise<void> => {
    if (new URL(route.request().url()).pathname !== pathname) {
      await route.continue();
      return;
    }
    await gate;
    await route.continue();
  };
  await page.route('**/interrupt', handler);
  return {
    release: (): void => {
      releaseGate();
    },
    unroute: async (): Promise<void> => {
      await page.unroute('**/interrupt', handler);
    },
  };
}

/** Waits until `fn` reports the transcript's last row inside the scroller band. */
async function lastRowVisibility(room: Locator, surface: Surface): Promise<string> {
  return room.evaluate((roomEl, scrollerTestid) => {
    const scrollerEl = roomEl.querySelector(`[data-testid="${scrollerTestid}"]`);
    if (scrollerEl === null) return 'no-scroller';
    scrollerEl.scrollTop = scrollerEl.scrollHeight;
    const last = roomEl.querySelector('[data-last-row]');
    const target = last ?? scrollerEl.lastElementChild;
    if (target === null) return 'no-target';
    const band = scrollerEl.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    return rect.bottom > band.top && rect.top < band.bottom
      ? 'ok'
      : `offscreen ${String(rect.top)}..${String(rect.bottom)} vs ${String(band.top)}..${String(band.bottom)}`;
  }, SCROLLER_TESTID[surface]);
}

for (const surface of ['console', 'legacy'] as const) {
  test(`[P1] [V:steer.interrupt-${surface}] interrupt and redirect drains queued plus typed guidance on ${surface}`, async ({
    page,
    archon,
  }, testInfo: TestInfo) => {
    test.setTimeout(T.xlong * 2);
    const run = await archon.startWorkflowViaWeb(
      E2E_QUEUE_GUIDANCE_WORKFLOW_NAME,
      'e2e interrupt redirect'
    );
    const sends = trackPosts(page, sendPathname(run.runId, QUEUE_GUIDANCE_NODE));
    const interrupts = trackPosts(page, interruptPathname(run.runId, QUEUE_GUIDANCE_NODE));
    const room = await openGuidanceRoom(page, surface, run.runId, QUEUE_GUIDANCE_NODE);
    const field = guidanceField(room);

    await test.step('generating dock: tool call in flight, Stop + Queue render', async () => {
      const toolRow = room.locator('[data-tool-id]').first();
      await expect(toolRow).toBeVisible({ timeout: T.medium });
      await expect(toolRow.locator('summary')).toContainText('running');
      await expect(field).toBeVisible({ timeout: T.medium });
      await expect(stopButton(room)).toBeVisible({ timeout: T.medium });
      await expect(queueButton(room)).toBeVisible();
      await expect(room.getByText(SEND_HINT)).toBeVisible();
      await waitForSubState(page, run.runId, QUEUE_GUIDANCE_NODE, 'generating');
    });

    await test.step('first message queues while generating', async () => {
      const first = page.waitForResponse(
        res => new URL(res.url()).pathname === sendPathname(run.runId, QUEUE_GUIDANCE_NODE)
      );
      await field.fill('first');
      await queueButton(room).click();
      expect((await first).status()).toBe(200);
      await expect(room.getByText('queued · 1')).toBeVisible();
      await expect(queueList(room).getByRole('listitem')).toHaveCount(1);
    });

    await test.step('Stop: one interrupt request, Stopping… focusable aria-disabled, Queue stays usable', async () => {
      const held = await holdInterruptResponse(page, run.runId, QUEUE_GUIDANCE_NODE);
      const interruptResponse = page.waitForResponse(
        res => new URL(res.url()).pathname === interruptPathname(run.runId, QUEUE_GUIDANCE_NODE)
      );
      await stopButton(room).click();
      const stopping = room.getByRole('button', { name: 'Stopping…' });
      await expect(stopping).toBeVisible();
      await expect(stopping).toHaveAttribute('aria-disabled', 'true');
      expect(await stopping.getAttribute('disabled')).toBeNull();
      await stopping.focus();
      expect(await stopping.evaluate(el => el.ownerDocument.activeElement === el)).toBe(true);
      await expect(dockStatus(room)).toContainText(AGENT_INTERRUPTING);
      await expect(queueButton(room)).toBeVisible();
      expect(await queueButton(room).getAttribute('disabled')).toBeNull();

      // Queue during the in-flight interrupt: accepted, lands under Will send
      // after idle rather than draining behind the operator's back.
      const queuedDuringStop = page.waitForResponse(
        res => new URL(res.url()).pathname === sendPathname(run.runId, QUEUE_GUIDANCE_NODE)
      );
      await field.fill('second');
      await queueButton(room).click();
      expect((await queuedDuringStop).status()).toBe(200);
      await expect(queueList(room).getByRole('listitem')).toHaveCount(2);

      held.release();
      const response = await interruptResponse;
      expect(response.status()).toBe(200);
      expect(await response.json()).toEqual({
        success: true,
        sub_state: 'idle-after-interrupt',
      });
      expect(interrupts.count(), 'exactly one interrupt request').toBe(1);
      await held.unroute();
    });

    await test.step('idle: node still running, interrupted tool card, Will-send band, disclosure, focus', async () => {
      await expect(sendNowButton(room)).toBeVisible({ timeout: T.medium });
      await expect(room.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
      await expect(room.getByText(INTERRUPT_DISCLOSURE)).toBeVisible();
      await expect(room.getByText('will send · 2')).toBeVisible();
      const items = willSendList(room).getByRole('listitem');
      await expect(items).toHaveCount(2);
      await expect(items.nth(0)).toContainText('first');
      await expect(items.nth(1)).toContainText('second');
      await expect(dockStatus(room)).toContainText(AGENT_IDLE);
      const toolRow = room.locator('[data-tool-id]').first();
      await expect(toolRow.locator('summary')).toContainText('interrupted', {
        timeout: T.medium,
      });
      await expect(toolRow.locator('summary')).toContainText('⚠');
      await waitForSubState(page, run.runId, QUEUE_GUIDANCE_NODE, 'idle-after-interrupt');
      const state = await getNodeState(page, run.runId, QUEUE_GUIDANCE_NODE);
      expect(state?.status, 'interrupt never cancels the node').toBe('running');
      // Focus moved to the transcript — the last row, or its scroller as the
      // documented fallback — never <body>.
      const focus = await page.evaluate(scrollerTestid => {
        const active = document.activeElement;
        if (active === null || active === document.body) return 'body';
        if (active.hasAttribute('data-last-row')) return 'last-row';
        if (active instanceof HTMLElement && active.dataset.testid === scrollerTestid) {
          return 'scroller';
        }
        return 'other';
      }, SCROLLER_TESTID[surface]);
      expect(['last-row', 'scroller'], 'focus lands on the transcript').toContain(focus);
      await captureEvidence(room, `us-005-${surface}-idle-after-interrupt.png`, testInfo);
    });

    await test.step('blank Send now and its shortcut issue no request', async () => {
      const before = sends.count();
      const sendNow = sendNowButton(room);
      await expect(sendNow).toHaveAttribute('aria-disabled', 'true');
      expect(await sendNow.getAttribute('disabled')).toBeNull();
      await sendNow.click({ force: true });
      await field.focus();
      await field.press('Meta+Enter');
      expect(sends.count(), 'no send POST while the draft is blank').toBe(before);
    });

    await test.step('Send now posts only the typed message; the band drains', async () => {
      const sendNowResponse = page.waitForResponse(
        res => new URL(res.url()).pathname === sendPathname(run.runId, QUEUE_GUIDANCE_NODE)
      );
      await field.fill(REDIRECT_TEXT);
      await sendNowButton(room).click();
      const response = await sendNowResponse;
      expect(response.status()).toBe(200);
      const posted = response.request().postDataJSON() as {
        message?: string;
        message_id?: string;
        intent?: string;
      };
      expect(posted.message).toBe(REDIRECT_TEXT);
      expect(posted.intent).toBe('send_now');
      expect(posted.message_id).toMatch(/^[0-9a-f-]{36}$/);
      // Earlier receipts already exist server-side — none is re-POSTed.
      const postedMessages = sends.bodies().map(body => (body as { message?: string }).message);
      expect(postedMessages).toEqual(['first', 'second', REDIRECT_TEXT]);
      await expect(room.getByText(/^will send ·/)).toHaveCount(0);
      await expect(room.getByText(/^queued ·/)).toHaveCount(0);
      // Local settle derives generating immediately — Stop is back while the
      // redirect turn runs its bounded delay.
      await expect(stopButton(room)).toBeVisible();
      await expect(dockStatus(room)).toContainText(AGENT_GENERATING);
    });

    await test.step('same-session redirect completes the run without failure events', async () => {
      await archon.waitForRunStatus(run.runId, 'completed', T.xlong);
      const texts = await transcriptTexts(page, run.runId, QUEUE_GUIDANCE_NODE);
      const echo = texts.filter(text => text === REDIRECT_ECHO);
      expect(echo, 'one resumed echo carries the drained batch verbatim').toHaveLength(1);
      const detail = await getRunDetail(page, run.runId);
      expect(detail.status).toBe('completed');
      expect(
        detail.events.filter(
          event =>
            (event.event_type === 'node_failed' || event.event_type === 'dag_node_failed') &&
            event.step_name === QUEUE_GUIDANCE_NODE
        )
      ).toHaveLength(0);
      expect(detail.nodeExecutions.filter(row => row.node_id === QUEUE_GUIDANCE_NODE)).toHaveLength(
        1
      );
      const freshRoom = await openGuidanceRoom(page, surface, run.runId, QUEUE_GUIDANCE_NODE);
      await expect(freshRoom.getByText(/resumed echo: first/).first()).toBeVisible({
        timeout: T.medium,
      });
      await expect(guidanceField(freshRoom)).toHaveCount(0);
    });
  });

  test(`[P1] [V:steer.interrupt-fail-${surface}] interrupt and redirect failure paths restore state on ${surface}`, async ({
    page,
    archon,
  }, testInfo: TestInfo) => {
    test.setTimeout(T.xlong * 2);
    const run = await archon.startWorkflowViaWeb(
      E2E_QUEUE_GUIDANCE_WORKFLOW_NAME,
      'e2e interrupt failure'
    );
    const sends = trackPosts(page, sendPathname(run.runId, QUEUE_GUIDANCE_NODE));
    const room = await openGuidanceRoom(page, surface, run.runId, QUEUE_GUIDANCE_NODE);
    const field = guidanceField(room);
    await expect(room.locator('[data-tool-id]').first()).toBeVisible({ timeout: T.medium });
    await field.fill('first');
    await queueButton(room).click();
    await expect(room.getByText('queued · 1')).toBeVisible();

    await test.step('interrupt transport failure restores generating and raises role=alert', async () => {
      let failOnce = true;
      await page.route('**/interrupt', async route => {
        if (!failOnce) {
          await route.continue();
          return;
        }
        failOnce = false;
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            error: { code: 'internal_error', message: 'simulated interrupt failure' },
          }),
        });
      });
      await stopButton(room).click();
      const alert = room.getByRole('alert');
      await expect(alert).toContainText('simulated interrupt failure', { timeout: T.medium });
      // Generating is restored: Stop is back, no idle disclosure, draft kept.
      await expect(stopButton(room)).toBeVisible();
      await expect(room.getByText(INTERRUPT_DISCLOSURE)).toHaveCount(0);
      await expect(field).toHaveValue('');
      await captureEvidence(room, `us-005-${surface}-interrupt-500.png`, testInfo);
    });

    await test.step('network failure on interrupt surfaces the ambiguous copy', async () => {
      await page.unroute('**/interrupt');
      let failOnce = true;
      await page.route('**/interrupt', async route => {
        if (!failOnce) {
          await route.continue();
          return;
        }
        failOnce = false;
        await route.abort();
      });
      await stopButton(room).click();
      await expect(room.getByRole('alert')).toContainText(INTERRUPT_FAILED, {
        timeout: T.medium,
      });
      await expect(stopButton(room)).toBeVisible();
      await page.unroute('**/interrupt');
    });

    await test.step('interrupt settles idle; Send-now failure restores old receipts then the draft', async () => {
      const interruptResponse = page.waitForResponse(
        res => new URL(res.url()).pathname === interruptPathname(run.runId, QUEUE_GUIDANCE_NODE)
      );
      await stopButton(room).click();
      expect((await interruptResponse).status()).toBe(200);
      await expect(sendNowButton(room)).toBeVisible({ timeout: T.medium });
      await expect(room.getByText('will send · 1')).toBeVisible();

      // First Send-now POST fails once: the band restores the old receipt
      // ahead of the still-typed message, the alert carries the failure.
      let failOnce = true;
      await page.route('**/send', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (
          request.method() !== 'POST' ||
          url.pathname !== sendPathname(run.runId, QUEUE_GUIDANCE_NODE)
        ) {
          await route.continue();
          return;
        }
        if (!failOnce) {
          await route.continue();
          return;
        }
        failOnce = false;
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            error: { code: 'internal_error', message: 'simulated delivery failure' },
          }),
        });
      });
      await field.fill(REDIRECT_TEXT);
      const failedSend = page.waitForResponse(
        res => new URL(res.url()).pathname === sendPathname(run.runId, QUEUE_GUIDANCE_NODE)
      );
      await sendNowButton(room).click();
      expect((await failedSend).status()).toBe(500);
      await expect(room.getByRole('alert')).toContainText('simulated delivery failure');
      const items = willSendList(room).getByRole('listitem');
      await expect(items).toHaveCount(1);
      await expect(items.first()).toContainText('first');
      await expect(field).toHaveValue(REDIRECT_TEXT);
      await captureEvidence(room, `us-005-${surface}-send-now-failed.png`, testInfo);

      // Unchanged draft retries with the SAME message id; only the new text
      // was ever POSTed — the restored receipt is never re-sent.
      const retriedSend = page.waitForResponse(
        res => new URL(res.url()).pathname === sendPathname(run.runId, QUEUE_GUIDANCE_NODE)
      );
      await sendNowButton(room).click();
      const retryResponse = await retriedSend;
      expect(retryResponse.status()).toBe(200);
      const firstBody = (await failedSend).request().postDataJSON() as { message_id?: string };
      const retryBody = retryResponse.request().postDataJSON() as {
        message?: string;
        message_id?: string;
        intent?: string;
      };
      expect(retryBody.message_id, 'retry reuses the ambiguous-failure UUID').toBe(
        firstBody.message_id
      );
      expect(retryBody.message).toBe(REDIRECT_TEXT);
      expect(retryBody.intent).toBe('send_now');
      const postedMessages = sends.bodies().map(body => (body as { message?: string }).message);
      expect(postedMessages.filter(message => message === 'first')).toHaveLength(1);
      await page.unroute('**/send');
      await archon.waitForRunStatus(run.runId, 'completed', T.xlong);
    });
  });

  test(`[P1] [V:steer.interrupt-422-${surface}] interrupt 422 keeps drafts and receipts under the detached disclosure on ${surface}`, async ({
    page,
    archon,
  }) => {
    test.setTimeout(T.xlong * 2);
    const run = await archon.startWorkflowViaWeb(
      E2E_QUEUE_GUIDANCE_WORKFLOW_NAME,
      'e2e interrupt 422'
    );
    const room = await openGuidanceRoom(page, surface, run.runId, QUEUE_GUIDANCE_NODE);
    const field = guidanceField(room);
    await expect(room.locator('[data-tool-id]').first()).toBeVisible({ timeout: T.medium });
    await field.fill('first');
    await queueButton(room).click();
    await expect(room.getByText('queued · 1')).toBeVisible();
    await field.fill('kept draft');

    await page.route('**/interrupt', async route => {
      await route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: { code: 'not_steerable_here', message: 'No live steering session' },
        }),
      });
    });
    await stopButton(room).click();
    const disclosure = room.getByRole('alert');
    await expect(disclosure).toContainText(DETACHED_DISCLOSURE, { timeout: T.medium });
    await expect(field).toHaveCount(0);

    const stored = await page.evaluate(
      key => sessionStorage.getItem(key),
      `archon:steering-draft:${run.runId}:${QUEUE_GUIDANCE_NODE}`
    );
    const record = JSON.parse(stored ?? '{}') as {
      draft?: string;
      pendingRetry?: { messageId?: string; message?: string };
    };
    expect(record.draft, 'the typed draft survives the 422').toBe('kept draft');
    await page.unroute('**/interrupt');
    // Let the natural delay finish so the run leaves no live process; the
    // queued item still drains at the boundary.
    await archon.waitForRunStatus(run.runId, 'completed', T.xlong);
    const detail = await getRunDetail(page, run.runId);
    expect(
      detail.events.filter(
        event => event.event_type === 'node_failed' && event.step_name === QUEUE_GUIDANCE_NODE
      )
    ).toHaveLength(0);
  });

  test(`[P1] [V:steer.interrupt-loop-${surface}] interrupt and redirect inside the loop iteration on ${surface}`, async ({
    page,
    archon,
  }) => {
    test.setTimeout(T.xlong * 2);
    const run = await archon.startWorkflowViaWeb(
      E2E_QUEUE_GUIDANCE_LOOP_WORKFLOW_NAME,
      'e2e loop interrupt'
    );
    const room = await openGuidanceRoom(page, surface, run.runId, QUEUE_GUIDANCE_LOOP_NODE);
    const field = guidanceField(room);
    await expect(stopButton(room)).toBeVisible({ timeout: T.medium });
    await waitForSubState(page, run.runId, QUEUE_GUIDANCE_LOOP_NODE, 'generating');
    if (surface === 'console') {
      // The console stream groups iteration content inline, so the live tool
      // card proves the bounded wait is parked behind an in-flight call. The
      // legacy room scopes the transcript per execution (the tool lives under
      // "Iteration 1"), so the generating sub-state is the portable proof.
      await expect(room.locator('[data-tool-id]').first()).toBeVisible({ timeout: T.medium });
    }

    const interruptResponse = page.waitForResponse(
      res => new URL(res.url()).pathname === interruptPathname(run.runId, QUEUE_GUIDANCE_LOOP_NODE)
    );
    await stopButton(room).click();
    expect((await interruptResponse).status()).toBe(200);
    await expect(sendNowButton(room)).toBeVisible({ timeout: T.medium });
    await expect(room.getByText(INTERRUPT_DISCLOSURE)).toBeVisible();

    const sendNowResponse = page.waitForResponse(
      res => new URL(res.url()).pathname === sendPathname(run.runId, QUEUE_GUIDANCE_LOOP_NODE)
    );
    await field.fill(LOOP_REDIRECT_TEXT);
    await sendNowButton(room).click();
    expect((await sendNowResponse).status()).toBe(200);

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
    expect(
      detail.events.filter(
        event =>
          (event.event_type === 'node_failed' || event.event_type === 'dag_node_failed') &&
          event.step_name === QUEUE_GUIDANCE_LOOP_NODE
      )
    ).toHaveLength(0);
    const texts = await transcriptTexts(page, run.runId, QUEUE_GUIDANCE_LOOP_NODE);
    const echoIndex = texts.indexOf(LOOP_ECHO_TEXT);
    const doneIndex = texts.indexOf(LOOP_DONE_TEXT);
    expect(echoIndex, 'redirect echo is marked resumed').toBeGreaterThanOrEqual(0);
    expect(doneIndex, 'loop sentinel lands after the redirected echo').toBeGreaterThan(echoIndex);

    await openGuidanceRoom(page, surface, run.runId, QUEUE_GUIDANCE_LOOP_NODE);
    await expect(page.getByText(LOOP_ECHO_TEXT).first()).toBeVisible({ timeout: T.medium });
    await expect(page.getByText(LOOP_DONE_TEXT).first()).toBeVisible();
    await expect(page.getByText('×2')).toHaveCount(0);
    if (surface === 'console') {
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

  test(`[P1] [V:steer.interrupt-visual-${surface}] interrupt and redirect dock geometry, contrast, and reduced-motion evidence on ${surface}`, async ({
    page,
    archon,
  }, testInfo: TestInfo) => {
    test.setTimeout(T.xlong * 2);
    const run = await archon.startWorkflowViaWeb(
      E2E_QUEUE_GUIDANCE_WORKFLOW_NAME,
      'e2e interrupt visual'
    );
    const room = await openGuidanceRoom(page, surface, run.runId, QUEUE_GUIDANCE_NODE);
    const field = guidanceField(room);
    await expect(room.locator('[data-tool-id]').first()).toBeVisible({ timeout: T.medium });
    await expect(stopButton(room)).toBeVisible({ timeout: T.medium });

    await field.fill('first');
    await queueButton(room).click();
    await expect(room.getByText('queued · 1')).toBeVisible();

    await test.step('460px states: generating+queue, interrupting, idle, generating-again', async () => {
      await page.setViewportSize({ width: 460, height: 900 });
      await expect(queueList(room).getByRole('listitem')).toHaveCount(1);
      await expectNoRoomDrivenOverflow(room, `${surface}@460-generating`);
      await captureEvidence(room, `us-005-${surface}-460-generating-queue.png`, testInfo);
      const roomWidth = (await room.boundingBox())?.width ?? 0;
      expect(roomWidth, 'room panel stays within the 460px viewport').toBeLessThanOrEqual(460);

      const held = await holdInterruptResponse(page, run.runId, QUEUE_GUIDANCE_NODE);
      await stopButton(room).click();
      const stopping = room.getByRole('button', { name: 'Stopping…' });
      await expect(stopping).toBeVisible();
      await captureEvidence(room, `us-005-${surface}-460-interrupting.png`, testInfo);

      // Reduced motion: the interrupt transition renders the same end state.
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await captureEvidence(
        room,
        `us-005-${surface}-460-interrupting-reduced-motion.png`,
        testInfo
      );
      await page.emulateMedia({ reducedMotion: 'no-preference' });

      const stoppingMetrics = await stopping.evaluate(el => {
        const rect = el.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      });
      const stoppingContrast = await textContrast(stopping);

      held.release();
      await expect(sendNowButton(room)).toBeVisible({ timeout: T.medium });
      await expect(room.getByText(INTERRUPT_DISCLOSURE)).toBeVisible();
      await expectNoRoomDrivenOverflow(room, `${surface}@460-idle`);
      await captureEvidence(room, `us-005-${surface}-460-idle.png`, testInfo);

      const sendNow = sendNowButton(room);
      const sendMetrics = await sendNow.evaluate(el => {
        const rect = el.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      });
      expect(sendMetrics.height, 'send target ≥ 32px').toBeGreaterThanOrEqual(32);
      expect(stoppingMetrics.height, 'stop target ≥ 32px').toBeGreaterThanOrEqual(32);
      expect(sendMetrics.width, 'send width stays ≥ 84px').toBeGreaterThanOrEqual(84);
      expect(stoppingContrast.ratio, 'Stopping… text contrast ≥ 4.5:1').toBeGreaterThanOrEqual(4.5);

      const bandScroll = willSendList(room).locator('xpath=..');
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

      const beforeGrow = await lastRowVisibility(room, surface);
      expect(beforeGrow, 'last transcript row reachable while idle').toBe('ok');
      const activeTag = await page.evaluate(
        () => document.activeElement?.tagName.toLowerCase() ?? 'none'
      );

      mergeMeasurements(`dock-${surface}`, {
        roomWidth460: roomWidth,
        stopTarget: stoppingMetrics,
        stoppingContrast: Number(stoppingContrast.ratio.toFixed(2)),
        sendWidth: sendMetrics.width,
        sendHeight: sendMetrics.height,
        band: bandMetrics,
        focusRing: { color: ring.outline, ratio: Number(ringRatio.toFixed(2)) },
        activeElementAfterIdle: activeTag,
      });

      await field.fill(REDIRECT_TEXT);
      const sendNowResponse = page.waitForResponse(
        res => new URL(res.url()).pathname === sendPathname(run.runId, QUEUE_GUIDANCE_NODE)
      );
      await sendNow.click();
      expect((await sendNowResponse).status()).toBe(200);
      await expect(stopButton(room)).toBeVisible();
      await captureEvidence(room, `us-005-${surface}-460-generating-again.png`, testInfo);
      const afterGrow = await lastRowVisibility(room, surface);
      expect(afterGrow, 'last transcript row reachable after dock shrink').toBe('ok');
    });

    await test.step('1440×900 idle dock in full room context', async () => {
      // The run may already be complete — reopen a fresh room on a new run for
      // a deterministic live-idle wide capture.
      const wideRun = await archon.startWorkflowViaWeb(
        E2E_QUEUE_GUIDANCE_WORKFLOW_NAME,
        'e2e interrupt visual wide'
      );
      const wideRoom = await openGuidanceRoom(page, surface, wideRun.runId, QUEUE_GUIDANCE_NODE);
      const wideField = guidanceField(wideRoom);
      await expect(wideRoom.locator('[data-tool-id]').first()).toBeVisible({
        timeout: T.medium,
      });
      await expect(stopButton(wideRoom)).toBeVisible({ timeout: T.medium });
      await wideField.fill('wide one');
      await queueButton(wideRoom).click();
      await expect(wideRoom.getByText('queued · 1')).toBeVisible();
      const interruptResponse = page.waitForResponse(
        res => new URL(res.url()).pathname === interruptPathname(wideRun.runId, QUEUE_GUIDANCE_NODE)
      );
      await stopButton(wideRoom).click();
      expect((await interruptResponse).status()).toBe(200);
      await expect(sendNowButton(wideRoom)).toBeVisible({ timeout: T.medium });
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(wideRoom.getByText(INTERRUPT_DISCLOSURE)).toBeVisible();
      await expectNoRoomDrivenOverflow(wideRoom, `${surface}@1440-idle`);
      await captureEvidence(wideRoom, `us-005-${surface}-1440-idle.png`, testInfo);
      mergeMeasurements(`viewport-${surface}`, {
        wide1440: (await wideRoom.boundingBox())?.width ?? 0,
      });
      // Drive the parked turn to completion — idle has a 30-minute ceiling.
      await wideField.fill(REDIRECT_TEXT);
      const wideSend = page.waitForResponse(
        res => new URL(res.url()).pathname === sendPathname(wideRun.runId, QUEUE_GUIDANCE_NODE)
      );
      await sendNowButton(wideRoom).click();
      expect((await wideSend).status()).toBe(200);
      await archon.waitForRunStatus(wideRun.runId, 'completed', T.xlong);
    });
  });
}

test('[P1] [V:steer.interrupt-routes] interrupt and redirect route ladder: 200 idle idempotent, awaiting_send_now, drain-once, 404, 409, 422', async ({
  page,
  archon,
}) => {
  test.setTimeout(T.xlong * 2);
  const post = (runId: string, nodeId: string, body: unknown): Promise<Response> =>
    archon.starterFetch(sendPathname(runId, nodeId), {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  const interrupt = (runId: string, nodeId: string): Promise<Response> =>
    archon.starterFetch(interruptPathname(runId, nodeId), { method: 'POST' });

  const run = await archon.startWorkflowViaWeb(
    E2E_QUEUE_GUIDANCE_WORKFLOW_NAME,
    'e2e interrupt routes'
  );
  await waitForNodeStarted(page, run.runId, QUEUE_GUIDANCE_NODE);
  await waitForSubState(page, run.runId, QUEUE_GUIDANCE_NODE, 'generating');

  const queued = await post(run.runId, QUEUE_GUIDANCE_NODE, {
    message: 'route queued one',
    message_id: randomUUID(),
    intent: 'queue',
  });
  expect(queued.status).toBe(200);
  expect(await queued.json()).toMatchObject({ success: true, state: 'queued' });

  const settle = await interrupt(run.runId, QUEUE_GUIDANCE_NODE);
  expect(settle.status).toBe(200);
  expect(await settle.json()).toEqual({ success: true, sub_state: 'idle-after-interrupt' });

  // Idempotent while idle: a repeated interrupt settles the same state.
  const again = await interrupt(run.runId, QUEUE_GUIDANCE_NODE);
  expect(again.status).toBe(200);
  expect(await again.json()).toEqual({ success: true, sub_state: 'idle-after-interrupt' });

  // Queueing while idle records the receipt without waking the turn.
  const idleQueued = await post(run.runId, QUEUE_GUIDANCE_NODE, {
    message: 'route queued two',
    message_id: randomUUID(),
    intent: 'queue',
  });
  expect(idleQueued.status).toBe(200);
  expect(await idleQueued.json()).toMatchObject({ success: true, state: 'awaiting_send_now' });

  const sendNowId = randomUUID();
  const sendNow = await post(run.runId, QUEUE_GUIDANCE_NODE, {
    message: '<<E2E_SCENARIO>>{"echoPrompt":true}<</E2E_SCENARIO>>route send now',
    message_id: sendNowId,
    intent: 'send_now',
  });
  expect(sendNow.status).toBe(200);
  expect(await sendNow.json()).toEqual({
    success: true,
    message_id: sendNowId,
    state: 'awaiting_send_now',
  });

  // A replayed send_now is idempotent — the accepted id never drains twice.
  const replay = await post(run.runId, QUEUE_GUIDANCE_NODE, {
    message: '<<E2E_SCENARIO>>{"echoPrompt":true}<</E2E_SCENARIO>>route send now',
    message_id: sendNowId,
    intent: 'send_now',
  });
  expect(replay.status).toBe(200);

  const unknown = await interrupt(run.runId, 'ghost-node');
  expect(unknown.status).toBe(404);
  expect(await unknown.json()).toMatchObject({
    success: false,
    error: { code: 'not_found' },
  });

  const detached = await archon.startDetachedWorkflow(E2E_QUEUE_GUIDANCE_WORKFLOW_NAME);
  const detachedRunId = await detached.runId;
  await archon.waitForRunStatus(detachedRunId, 'running', T.long);
  await waitForNodeStarted(page, detachedRunId, QUEUE_GUIDANCE_NODE);
  const detachedInterrupt = await interrupt(detachedRunId, QUEUE_GUIDANCE_NODE);
  expect(detachedInterrupt.status).toBe(422);
  expect(await detachedInterrupt.json()).toMatchObject({
    success: false,
    error: { code: 'not_steerable_here' },
  });

  await archon.waitForRunStatus(run.runId, 'completed', T.xlong);
  const finished = await interrupt(run.runId, QUEUE_GUIDANCE_NODE);
  expect(finished.status).toBe(409);
  expect(await finished.json()).toMatchObject({
    success: false,
    error: { code: 'node_finished' },
  });

  // Exactly one redirected turn ran: the drained batch echoes once on the
  // same session — proof the idle queue stayed parked and send_now woke once.
  const texts = await transcriptTexts(page, run.runId, QUEUE_GUIDANCE_NODE);
  const echo = texts.filter(
    text =>
      text === '[e2e-fake] resumed echo: route queued one\n\nroute queued two\n\nroute send now'
  );
  expect(echo).toHaveLength(1);
});
