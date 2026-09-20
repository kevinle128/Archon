import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Locator, Page, Request, TestInfo } from '@playwright/test';

import {
  E2E_QUEUE_GUIDANCE_WORKFLOW_NAME,
  E2E_STARTER_WEB_USER,
  QUEUE_GUIDANCE_NODE,
} from '../lib/playwright/archon-runtime';
import {
  getRunDetail,
  listNodeMessages,
  openLegacyRunDetail,
  openRunDetail,
} from '../lib/playwright/run-detail';
import { expect, test } from '../lib/playwright/suite';
import { T } from '../lib/playwright/timeouts';

/**
 * Story 2.12 / issue #192 — fail an abandoned redirect after 30 minutes of
 * genuine composer inactivity. Real server + fake provider; 8s E2E-only idle
 * bound via worker-scoped idleAwaitMs. Both shells where the observation
 * belongs to a browser ledger.
 */

test.use({ idleAwaitMs: 8_000 });

type Surface = 'console' | 'legacy';

type RunDetailSnapshot = {
  status?: string;
  nodeExecutions: {
    node_id: string;
    status?: string;
    error?: string | null;
    retry_epoch?: number;
    started_at?: string | null;
    ended_at?: string | null;
  }[];
  events: {
    event_type: string;
    step_name: string | null;
    data: Record<string, unknown>;
  }[];
};

type NodeExecutionRow = RunDetailSnapshot['nodeExecutions'][number];

type NodeMessageSnapshot = {
  kind: string;
  payload: Record<string, unknown>;
  metadata?: {
    origin?: 'operator';
    message_id?: string;
  } | null;
};

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EVIDENCE_DIR = join(
  REPO_ROOT,
  'plans',
  '260920-1759-issue-192-fail-abandoned-redirect-after-30-minutes',
  'reports',
  'evidence'
);
const MEASUREMENTS_FILE = join(EVIDENCE_DIR, 'idle-await-measurements.json');

const SCROLLER_TESTID: Record<Surface, string> = {
  console: 'console-node-room-scroller',
  legacy: 'legacy-node-room-scroller',
};

const NARROW = { width: 460, height: 900 } as const;
const WIDE = { width: 1440, height: 900 } as const;

const IDLE_AWAIT_MS = 8_000;
const IDLE_TOLERANCE_MS = 3_000;
const KEEP_OBSERVE_MS = 1_500;

const INTERRUPT_DISCLOSURE =
  'stopped after the last completed tool call · files already written stay written';
const IDLE_AWAIT_DISCLOSURE =
  'no redirect ends this node after 30 min of inactivity · typing keeps it open';
const EXPIRED_ALERT = 'node failed · interrupted with no redirect · none of this was sent';
const IDLE_AWAIT_EXPIRED_ERROR = 'interrupted by operator, no redirect received';
const REDIRECT_SCENARIO = '{"echoPrompt":true,"delayMs":1500}';
const REDIRECT_TEXT = `<<E2E_SCENARIO>>${REDIRECT_SCENARIO}<</E2E_SCENARIO>>expiry-redirect`;
const REDIRECT_ECHO = '[e2e-fake] resumed echo: expiry-redirect';
const QUEUED_MESSAGE = 'idle-await never-sent probe';

function sendPathname(runId: string, nodeId: string): string {
  return `/api/workflows/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}/send`;
}

function interruptPathname(runId: string, nodeId: string): string {
  return `/api/workflows/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}/interrupt`;
}

function keepalivePathname(runId: string, nodeId: string): string {
  return `/api/workflows/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}/keepalive`;
}

function trackPosts(
  page: Page,
  pathname: string
): {
  count: () => number;
  bodies: () => unknown[];
  times: () => number[];
  dispose: () => void;
} {
  let seen = 0;
  const bodies: unknown[] = [];
  const times: number[] = [];
  const listener = (request: Request): void => {
    if (request.method() !== 'POST') return;
    if (new URL(request.url()).pathname !== pathname) return;
    seen += 1;
    times.push(Date.now());
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
    times: () => times,
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

function neverSentList(room: Locator): Locator {
  return room.getByRole('list', { name: /^Never sent/ });
}

function willSendList(room: Locator): Locator {
  return room.getByRole('list', { name: /^Will send/ });
}

function neverSentAlert(room: Locator): Locator {
  return room.getByRole('alert').filter({ hasText: EXPIRED_ALERT });
}

async function captureEvidence(target: Locator, name: string, testInfo: TestInfo): Promise<void> {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const shot = await target.screenshot({ path: join(EVIDENCE_DIR, name) });
  await testInfo.attach(name, { body: shot, contentType: 'image/png' });
}

function mergeMeasurements(section: string, data: Record<string, unknown>): void {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const current = existsSync(MEASUREMENTS_FILE)
    ? (JSON.parse(readFileSync(MEASUREMENTS_FILE, 'utf8')) as Record<string, unknown>)
    : {};
  current[section] = data;
  writeFileSync(MEASUREMENTS_FILE, `${JSON.stringify(current, null, 2)}\n`);
}

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

async function waitForNodeFailed(page: Page, runId: string, nodeId: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const detail = await getRunDetail(page, runId);
        const hasEvent = detail.events.some(
          event => event.event_type === 'node_failed' && event.step_name === nodeId
        );
        const failedExec = detail.nodeExecutions.some(
          row => row.node_id === nodeId && row.status === 'failed'
        );
        return hasEvent && failedExec;
      },
      {
        timeout: T.xlong,
        message: `persisted node_failed + failed execution for ${nodeId}`,
      }
    )
    .toBe(true);
}

async function interruptToIdle(
  page: Page,
  room: Locator,
  runId: string,
  nodeId: string
): Promise<number> {
  await expect(room.locator('[data-tool-id]').first()).toBeVisible({ timeout: T.medium });
  await expect(stopButton(room)).toBeVisible({ timeout: T.medium });
  await waitForSubState(page, runId, nodeId, 'generating');

  const interruptResponse = page.waitForResponse(
    res =>
      res.request().method() === 'POST' &&
      new URL(res.url()).pathname === interruptPathname(runId, nodeId)
  );
  await stopButton(room).click();
  const response = await interruptResponse;
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({
    success: true,
    sub_state: 'idle-after-interrupt',
  });
  await expect(sendNowButton(room)).toBeVisible({ timeout: T.medium });
  await waitForSubState(page, runId, nodeId, 'idle-after-interrupt');
  const state = await getNodeState(page, runId, nodeId);
  expect(state?.status, 'interrupt never cancels the node').toBe('running');
  return Date.now();
}

async function queueWhileIdleViaApi(
  archon: {
    starterFetch: (path: string, init?: RequestInit) => Promise<Response>;
  },
  runId: string,
  nodeId: string,
  text: string
): Promise<string> {
  const messageId = randomUUID();
  const queued = await archon.starterFetch(sendPathname(runId, nodeId), {
    method: 'POST',
    body: JSON.stringify({
      message: text,
      message_id: messageId,
      intent: 'queue',
    }),
  });
  expect(queued.status).toBe(200);
  expect(await queued.json()).toEqual({
    success: true,
    message_id: messageId,
    state: 'awaiting_send_now',
  });
  return messageId;
}
type AxNode = {
  nodeId: string;
  ignored?: boolean;
  role?: { value?: string };
  name?: { value?: string };
};

async function roomAxStaticTexts(page: Page, nodeId: string): Promise<string[]> {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('DOM.enable');
    await session.send('Accessibility.enable');
    const doc = (await session.send('DOM.getDocument', { depth: 1 })) as {
      root: { nodeId: number };
    };
    const query = (await session.send('DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector: `section[aria-label="${nodeId} room"]`,
    })) as { nodeId: number };
    if (query.nodeId === 0) return [];
    const ax = (await session.send('Accessibility.queryAXTree', {
      nodeId: query.nodeId,
    })) as { nodes: AxNode[] };
    return ax.nodes
      .filter(
        node =>
          !node.ignored &&
          node.role?.value === 'StaticText' &&
          typeof node.name?.value === 'string' &&
          node.name.value.length > 0
      )
      .map(node => node.name!.value as string);
  } finally {
    await session.detach();
  }
}

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
    return {
      pageScrollWidth: document.documentElement.scrollWidth,
      pageClientWidth: document.documentElement.clientWidth,
      roomScrollWidth: (roomEl as HTMLElement).scrollWidth,
      roomClientWidth: (roomEl as HTMLElement).clientWidth,
      offenders,
    };
  });
  expect(
    report.pageScrollWidth,
    `${context} page must not force horizontal scroll (scroll=${String(report.pageScrollWidth)} client=${String(report.pageClientWidth)})`
  ).toBeLessThanOrEqual(report.pageClientWidth + 1);
  expect(
    report.roomScrollWidth,
    `${context} room must not force horizontal scroll`
  ).toBeLessThanOrEqual(report.roomClientWidth + 1);
  const inside = report.offenders.filter(o => o.insideRoom);
  expect(inside, `${context} no room-driven overflow offenders: ${JSON.stringify(inside)}`).toEqual(
    []
  );
}

async function measureDockGeometry(room: Locator): Promise<Record<string, unknown>> {
  return room.evaluate(roomEl => {
    const rect = (el: Element | null): Record<string, number> | null => {
      if (el === null) return null;
      const r = el.getBoundingClientRect();
      return {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        left: r.left,
      };
    };
    const field = roomEl.querySelector('textarea, [role="textbox"]');
    const sendNow = Array.from(roomEl.querySelectorAll('button')).find(btn =>
      /^Send now/.test(btn.textContent ?? '')
    );
    const queueBand = roomEl.querySelector(
      '[aria-label^="Queued messages"], [aria-label^="Will send"], [aria-label^="Never sent"]'
    );
    const well = field?.closest('section, form, div');
    return {
      room: rect(roomEl),
      field: rect(field),
      sendNow: rect(sendNow ?? null),
      queueBand: rect(queueBand),
      well: rect(well ?? null),
      roomScrollWidth: (roomEl as HTMLElement).scrollWidth,
      roomClientWidth: (roomEl as HTMLElement).clientWidth,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  });
}

async function focusTarget(page: Page, surface: Surface): Promise<string> {
  return page.evaluate(scrollerTestid => {
    const active = document.activeElement;
    if (active === null || active === document.body) return 'body';
    if (active.hasAttribute('data-last-row')) return 'last-row';
    if (active instanceof HTMLElement && active.dataset.testid === scrollerTestid) {
      return 'scroller';
    }
    if (active.getAttribute('role') === 'alert') return 'alert';
    if (active.closest('[aria-label^="Never sent"]') !== null) return 'never-sent-box';
    return 'other';
  }, SCROLLER_TESTID[surface]);
}

function latestNodeExecution(
  detail: RunDetailSnapshot,
  nodeId: string
): NodeExecutionRow | undefined {
  const rows = detail.nodeExecutions.filter(row => row.node_id === nodeId);
  if (rows.length === 0) return undefined;
  return [...rows].sort((a, b) => {
    const epochDelta = (b.retry_epoch ?? 0) - (a.retry_epoch ?? 0);
    if (epochDelta !== 0) return epochDelta;
    const aKey = a.started_at ?? a.ended_at ?? '';
    const bKey = b.started_at ?? b.ended_at ?? '';
    if (aKey !== bKey) return aKey < bKey ? 1 : -1;
    return 0;
  })[0];
}

function toolCallIds(messages: NodeMessageSnapshot[]): string[] {
  return messages
    .filter(message => message.kind === 'tool')
    .map(message => {
      const id = message.payload.id;
      return typeof id === 'string' ? id : null;
    })
    .filter((id): id is string => id !== null && id.startsWith('e2e-fake-tool-'));
}

async function assertIdleDisclosure(room: Locator, page: Page, nodeId: string): Promise<void> {
  await expect(room.getByText(INTERRUPT_DISCLOSURE)).toBeVisible();
  await expect(room.getByText(IDLE_AWAIT_DISCLOSURE)).toBeVisible();
  const order = await room.evaluate(
    (roomEl, texts: [string, string]) => {
      const [stop, idle] = texts;
      const leaves = Array.from(roomEl.querySelectorAll('*')).filter(
        el => el.childElementCount === 0 && (el.textContent ?? '').trim().length > 0
      );
      const stopEl = leaves.find(el => (el.textContent ?? '').includes(stop));
      const idleEl = leaves.find(el => (el.textContent ?? '').includes(idle));
      if (stopEl === undefined || idleEl === undefined) return 'missing';
      return (stopEl.compareDocumentPosition(idleEl) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
        ? 'ok'
        : 'reversed';
    },
    [INTERRUPT_DISCLOSURE, IDLE_AWAIT_DISCLOSURE] as [string, string]
  );
  expect(order, 'Stop disclosure precedes 30-minute sentence').toBe('ok');

  const axTexts = await roomAxStaticTexts(page, nodeId);
  expect(
    axTexts.some(text => text.includes(IDLE_AWAIT_DISCLOSURE)),
    `AX StaticText must contain complete idle sentence; got ${JSON.stringify(axTexts)}`
  ).toBe(true);
}

async function assertExpiryFailure(
  page: Page,
  runId: string,
  nodeId: string
): Promise<{ failedAt: number; detail: RunDetailSnapshot }> {
  await waitForNodeFailed(page, runId, nodeId);
  const failedAt = Date.now();
  const detail = (await getRunDetail(page, runId)) as RunDetailSnapshot;
  expect(detail.status).toBe('failed');
  const latest = latestNodeExecution(detail, nodeId);
  expect(latest?.status).toBe('failed');
  expect(latest?.error, 'engine error string must match web mirror exactly').toBe(
    IDLE_AWAIT_EXPIRED_ERROR
  );
  const failedEvents = detail.events.filter(
    event => event.event_type === 'node_failed' && event.step_name === nodeId
  );
  expect(failedEvents, 'exactly one node_failed').toHaveLength(1);
  expect(
    detail.events.filter(
      event => event.event_type === 'node_completed' && event.step_name === nodeId
    )
  ).toHaveLength(0);
  const idleTimeoutEvents = detail.events.filter(event => {
    const data = event.data ?? {};
    const message =
      typeof data.message === 'string'
        ? data.message
        : typeof data.error === 'string'
          ? data.error
          : '';
    return message.includes('completed via idle timeout') || message.includes('idle timeout');
  });
  expect(idleTimeoutEvents, 'no idle-timeout completion classification').toHaveLength(0);
  return { failedAt, detail };
}

for (const surface of ['console', 'legacy'] as const) {
  test(`[P1] [V:steer.idle-await-${surface}] E1/E2/E5/E7 disclosure keepalive empty-expiry on ${surface}`, async ({
    page,
    archon,
  }, testInfo: TestInfo) => {
    test.setTimeout(T.xlong * 3);
    await page.setViewportSize(surface === 'legacy' ? NARROW : WIDE);
    await page.setExtraHTTPHeaders({ 'X-Archon-User': E2E_STARTER_WEB_USER });

    const run = await archon.startWorkflowViaWeb(
      E2E_QUEUE_GUIDANCE_WORKFLOW_NAME,
      'e2e idle await empty'
    );
    const keepalives = trackPosts(page, keepalivePathname(run.runId, QUEUE_GUIDANCE_NODE));
    const room = await openGuidanceRoom(page, surface, run.runId, QUEUE_GUIDANCE_NODE);

    const idleAt = await interruptToIdle(page, room, run.runId, QUEUE_GUIDANCE_NODE);

    await test.step('E1 disclosure + AX tree', async () => {
      await assertIdleDisclosure(room, page, QUEUE_GUIDANCE_NODE);
      await captureEvidence(room, `idle-empty-${surface}.png`, testInfo);
      const geometry = await measureDockGeometry(room);
      await expectNoRoomDrivenOverflow(room, `${surface} idle-empty`);
      mergeMeasurements(`idle-empty-${surface}`, {
        geometry,
        idleAt,
        keepaliveCount: keepalives.count(),
      });
    });

    await test.step('E2 focus+abc yields one bodyless keepalive', async () => {
      const before = keepalives.count();
      const field = guidanceField(room);
      const keepaliveResponse = page.waitForResponse(
        res =>
          res.request().method() === 'POST' &&
          new URL(res.url()).pathname === keepalivePathname(run.runId, QUEUE_GUIDANCE_NODE)
      );
      await field.focus();
      await field.pressSequentially('abc', { delay: 20 });
      const response = await keepaliveResponse;
      expect(response.status()).toBe(200);
      expect(await response.json()).toEqual({ success: true });
      const postData = response.request().postData();
      expect(postData === null || postData === '', 'keepalive is bodyless').toBe(true);
      await new Promise(resolve => setTimeout(resolve, KEEP_OBSERVE_MS));
      expect(keepalives.count() - before, 'one immediate keepalive, no storm').toBe(1);
      const state = await getNodeState(page, run.runId, QUEUE_GUIDANCE_NODE);
      expect(state?.status).toBe('running');
      expect(state?.steeringSubState).toBe('idle-after-interrupt');
      // Clear the draft so E7 stays unmatched-empty (no composer text to restore).
      await field.fill('');
    });

    await test.step('E5/E7 expiry with no unmatched message', async () => {
      // Last activity was the keepalive above; wait past the re-armed bound.
      const lastActivity = keepalives.times().at(-1) ?? idleAt;
      const { failedAt, detail } = await assertExpiryFailure(page, run.runId, QUEUE_GUIDANCE_NODE);
      const elapsed = failedAt - lastActivity;
      expect(elapsed, `expiry after re-arm (~${String(IDLE_AWAIT_MS)}ms)`).toBeGreaterThanOrEqual(
        IDLE_AWAIT_MS - IDLE_TOLERANCE_MS
      );
      expect(elapsed).toBeLessThan(IDLE_AWAIT_MS + IDLE_TOLERANCE_MS + 5_000);

      await expect(neverSentList(room)).toHaveCount(0);
      await expect(room.getByText(EXPIRED_ALERT)).toHaveCount(0);
      await expect(room.getByText('node finished · none of this was sent')).toHaveCount(0);
      await expect(guidanceField(room)).toHaveCount(0);
      await expect(sendNowButton(room)).toHaveCount(0);
      await expect(stopButton(room)).toHaveCount(0);
      // Ordinary failed-node presentation remains (node room still visible).
      await expect(room).toBeVisible();
      await captureEvidence(room, `expired-empty-${surface}.png`, testInfo);
      mergeMeasurements(`expired-empty-${surface}`, {
        geometry: await measureDockGeometry(room),
        keepaliveCount: keepalives.count(),
        lastActivity,
        failedAt,
        elapsed,
        latestError: latestNodeExecution(detail, QUEUE_GUIDANCE_NODE)?.error ?? null,
      });
    });

    keepalives.dispose();
  });

  test(`[P1] [V:steer.idle-await-queued-${surface}] E6 NEVER SENT cause on ${surface}`, async ({
    page,
    archon,
  }, testInfo: TestInfo) => {
    test.setTimeout(T.xlong * 3);
    await page.setViewportSize(surface === 'legacy' ? NARROW : WIDE);
    await page.setExtraHTTPHeaders({ 'X-Archon-User': E2E_STARTER_WEB_USER });

    const run = await archon.startWorkflowViaWeb(
      E2E_QUEUE_GUIDANCE_WORKFLOW_NAME,
      'e2e idle await queued'
    );
    // Open observer before queueing so Story 2.11 ledger sees the accepted id.
    const room = await openGuidanceRoom(page, surface, run.runId, QUEUE_GUIDANCE_NODE);
    const idleAt = await interruptToIdle(page, room, run.runId, QUEUE_GUIDANCE_NODE);
    await assertIdleDisclosure(room, page, QUEUE_GUIDANCE_NODE);

    const messageId = await queueWhileIdleViaApi(
      archon,
      run.runId,
      QUEUE_GUIDANCE_NODE,
      QUEUED_MESSAGE
    );
    await expect(room.getByText('will send · 1')).toBeVisible({ timeout: T.long });
    await expect(willSendList(room).getByRole('listitem')).toContainText(QUEUED_MESSAGE);
    await captureEvidence(room, `idle-queued-${surface}.png`, testInfo);
    mergeMeasurements(`idle-queued-${surface}`, {
      geometry: await measureDockGeometry(room),
      idleAt,
      messageId,
    });
    await expectNoRoomDrivenOverflow(room, `${surface} idle-queued`);

    const { failedAt } = await assertExpiryFailure(page, run.runId, QUEUE_GUIDANCE_NODE);
    const elapsed = failedAt - idleAt;
    // Queue itself may have re-armed via focus; bound is still within a few windows.
    expect(elapsed).toBeGreaterThanOrEqual(IDLE_AWAIT_MS - IDLE_TOLERANCE_MS);
    expect(elapsed).toBeLessThan(IDLE_AWAIT_MS * 3);

    const list = neverSentList(room);
    await expect(list).toBeVisible({ timeout: T.long });
    await expect(list).toHaveAttribute('aria-label', 'Never sent, 1');
    const item = list.getByRole('listitem').first();
    await expect(item).toHaveText(QUEUED_MESSAGE);
    await expect(item).toHaveAttribute('data-message-id', messageId);
    await expect(neverSentAlert(room)).toHaveCount(1);
    await expect(neverSentAlert(room)).toHaveText(EXPIRED_ALERT);

    await expect(guidanceField(room)).toHaveCount(0);
    await expect(queueButton(room)).toHaveCount(0);
    await expect(sendNowButton(room)).toHaveCount(0);
    await expect(stopButton(room)).toHaveCount(0);

    const messages = await listNodeMessages(page, run.runId, QUEUE_GUIDANCE_NODE);
    const operatorIds = messages
      .filter(message => message.kind === 'text' && message.metadata?.origin === 'operator')
      .map(message => message.metadata?.message_id)
      .filter((id): id is string => typeof id === 'string');
    expect(operatorIds, 'operator transcript omits never-sent id').not.toContain(messageId);

    const focus = await focusTarget(page, surface);
    expect(
      ['last-row', 'scroller', 'alert', 'never-sent-box'],
      'focus left the composer'
    ).toContain(focus);
    // Queue band 33vh cap is on the scroll wrapper parent of the list.
    const bandCap = await list.evaluate(el => {
      const wrap = el.parentElement;
      const style = wrap ? getComputedStyle(wrap) : null;
      return {
        hasMaxH33vh: wrap?.className.includes('max-h-[33vh]') ?? false,
        maxHeight: style?.maxHeight ?? '',
        overflowY: style?.overflowY ?? '',
        wrapHeight: wrap?.getBoundingClientRect().height ?? 0,
        vh33: window.innerHeight * 0.33,
      };
    });
    expect(bandCap.hasMaxH33vh, 'never-sent scroll wrapper keeps max-h-[33vh]').toBe(true);
    expect(bandCap.overflowY, 'never-sent scroll wrapper scrolls vertically').toMatch(
      /auto|scroll/
    );
    expect(bandCap.wrapHeight, 'never-sent band ≤ 33vh').toBeLessThanOrEqual(bandCap.vh33 + 2);

    await captureEvidence(room, `expired-queued-${surface}.png`, testInfo);
    await expectNoRoomDrivenOverflow(room, `${surface} expired-queued`);
    mergeMeasurements(`expired-queued-${surface}`, {
      geometry: await measureDockGeometry(room),
      idleAt,
      failedAt,
      elapsed,
      messageId,
      bandCap,
      focus,
    });
  });
}

test('[P1] [V:steer.idle-await-rearm] E3 Console real server re-arm past original deadline', async ({
  page,
  archon,
}, testInfo: TestInfo) => {
  test.setTimeout(T.xlong * 3);
  await page.setViewportSize(WIDE);
  await page.setExtraHTTPHeaders({ 'X-Archon-User': E2E_STARTER_WEB_USER });

  const run = await archon.startWorkflowViaWeb(
    E2E_QUEUE_GUIDANCE_WORKFLOW_NAME,
    'e2e idle await rearm'
  );
  const keepalives = trackPosts(page, keepalivePathname(run.runId, QUEUE_GUIDANCE_NODE));
  const room = await openGuidanceRoom(page, 'console', run.runId, QUEUE_GUIDANCE_NODE);
  const idleAt = await interruptToIdle(page, room, run.runId, QUEUE_GUIDANCE_NODE);

  // Let most of the original interval elapse, then create one activity request.
  await new Promise(resolve => setTimeout(resolve, 6_000));
  const field = guidanceField(room);
  const keepaliveResponse = page.waitForResponse(
    res =>
      res.request().method() === 'POST' &&
      new URL(res.url()).pathname === keepalivePathname(run.runId, QUEUE_GUIDANCE_NODE)
  );
  await field.focus();
  await field.press('a');
  const response = await keepaliveResponse;
  expect(response.status()).toBe(200);
  const rearmAt = Date.now();
  expect(keepalives.count()).toBeGreaterThanOrEqual(1);

  // Prove the node remains running beyond the original deadline.
  const pastOriginal = idleAt + IDLE_AWAIT_MS + 1_000;
  const waitPastOriginal = Math.max(0, pastOriginal - Date.now());
  if (waitPastOriginal > 0) {
    await new Promise(resolve => setTimeout(resolve, waitPastOriginal));
  }
  const stillRunning = await getNodeState(page, run.runId, QUEUE_GUIDANCE_NODE);
  expect(stillRunning?.status, 'node survives past original deadline after re-arm').toBe('running');
  expect(stillRunning?.steeringSubState).toBe('idle-after-interrupt');

  const { failedAt } = await assertExpiryFailure(page, run.runId, QUEUE_GUIDANCE_NODE);
  const fromRearm = failedAt - rearmAt;
  expect(fromRearm).toBeGreaterThanOrEqual(IDLE_AWAIT_MS - IDLE_TOLERANCE_MS);
  expect(fromRearm).toBeLessThan(IDLE_AWAIT_MS + IDLE_TOLERANCE_MS + 5_000);
  expect(failedAt - idleAt, 'total lifetime exceeds original bound').toBeGreaterThan(
    IDLE_AWAIT_MS + 1_000
  );

  mergeMeasurements('rearm-console', {
    idleAt,
    rearmAt,
    failedAt,
    keepaliveCount: keepalives.count(),
    fromRearm,
    totalLifetime: failedAt - idleAt,
  });
  await captureEvidence(room, 'rearm-console-expired.png', testInfo);
  keepalives.dispose();
});

test('[P1] [V:steer.idle-await-send-now] E4 Send now exclusion does not keepalive', async ({
  page,
  archon,
}) => {
  test.setTimeout(T.xlong * 2);
  await page.setViewportSize(WIDE);
  await page.setExtraHTTPHeaders({ 'X-Archon-User': E2E_STARTER_WEB_USER });

  const run = await archon.startWorkflowViaWeb(
    E2E_QUEUE_GUIDANCE_WORKFLOW_NAME,
    'e2e idle await send now'
  );
  const keepalives = trackPosts(page, keepalivePathname(run.runId, QUEUE_GUIDANCE_NODE));
  const sends = trackPosts(page, sendPathname(run.runId, QUEUE_GUIDANCE_NODE));
  const room = await openGuidanceRoom(page, 'console', run.runId, QUEUE_GUIDANCE_NODE);
  await interruptToIdle(page, room, run.runId, QUEUE_GUIDANCE_NODE);

  const field = guidanceField(room);
  const firstKeepalive = page.waitForResponse(
    res =>
      res.request().method() === 'POST' &&
      new URL(res.url()).pathname === keepalivePathname(run.runId, QUEUE_GUIDANCE_NODE)
  );
  await field.focus();
  await field.press('x');
  await firstKeepalive;
  const keepaliveBeforeSend = keepalives.count();
  expect(keepaliveBeforeSend).toBeGreaterThanOrEqual(1);

  // Click path
  const sendNowResponse = page.waitForResponse(
    res =>
      res.request().method() === 'POST' &&
      new URL(res.url()).pathname === sendPathname(run.runId, QUEUE_GUIDANCE_NODE)
  );
  await field.fill(REDIRECT_TEXT);
  // Filling may schedule another keepalive; snapshot immediately before submit.
  const countAtSubmit = keepalives.count();
  await sendNowButton(room).click();
  const response = await sendNowResponse;
  expect(response.status()).toBe(200);
  const posted = response.request().postDataJSON() as { intent?: string; message?: string };
  expect(posted.intent).toBe('send_now');
  expect(posted.message).toBe(REDIRECT_TEXT);
  // Give any accidental keepalive a moment; count must not rise because of submit.
  await new Promise(resolve => setTimeout(resolve, 500));
  expect(keepalives.count(), 'Send now must not increase keepalive count').toBe(countAtSubmit);

  await expect(room.getByText(/resumed echo: expiry-redirect/).first()).toBeVisible({
    timeout: T.xlong,
  });
  await archon.waitForRunStatus(run.runId, 'completed', T.xlong);
  const texts = await listNodeMessages(page, run.runId, QUEUE_GUIDANCE_NODE);
  expect(texts.some(row => row.kind === 'text' && row.payload.text === REDIRECT_ECHO)).toBe(true);

  // Keyboard path on a fresh run
  const run2 = await archon.startWorkflowViaWeb(
    E2E_QUEUE_GUIDANCE_WORKFLOW_NAME,
    'e2e idle await send now keyboard'
  );
  const keepalives2 = trackPosts(page, keepalivePathname(run2.runId, QUEUE_GUIDANCE_NODE));
  const room2 = await openGuidanceRoom(page, 'legacy', run2.runId, QUEUE_GUIDANCE_NODE);
  await interruptToIdle(page, room2, run2.runId, QUEUE_GUIDANCE_NODE);
  const field2 = guidanceField(room2);
  const ka2 = page.waitForResponse(
    res =>
      res.request().method() === 'POST' &&
      new URL(res.url()).pathname === keepalivePathname(run2.runId, QUEUE_GUIDANCE_NODE)
  );
  await field2.focus();
  await field2.press('y');
  await ka2;
  await field2.fill(REDIRECT_TEXT);
  const countBeforeKb = keepalives2.count();
  const sendKb = page.waitForResponse(
    res =>
      res.request().method() === 'POST' &&
      new URL(res.url()).pathname === sendPathname(run2.runId, QUEUE_GUIDANCE_NODE)
  );
  await field2.press('Meta+Enter');
  const kbResponse = await sendKb;
  expect(kbResponse.status()).toBe(200);
  const kbBody = kbResponse.request().postDataJSON() as { intent?: string };
  expect(kbBody.intent).toBe('send_now');
  await new Promise(resolve => setTimeout(resolve, 500));
  expect(keepalives2.count()).toBe(countBeforeKb);
  await archon.waitForRunStatus(run2.runId, 'completed', T.xlong);

  mergeMeasurements('send-now-exclusion', {
    clickKeepalivesBefore: keepaliveBeforeSend,
    clickKeepalivesAtSubmit: countAtSubmit,
    clickKeepalivesAfter: keepalives.count(),
    keyboardKeepalivesAtSubmit: countBeforeKb,
    keyboardKeepalivesAfter: keepalives2.count(),
    sendBodies: sends.bodies(),
  });
  keepalives.dispose();
  keepalives2.dispose();
  sends.dispose();
});

test('[P1] [V:steer.idle-await-retry] E8 Legacy retry is a fresh provider session', async ({
  page,
  archon,
}, testInfo: TestInfo) => {
  test.setTimeout(T.xlong * 3);
  await page.setViewportSize(NARROW);
  await page.setExtraHTTPHeaders({ 'X-Archon-User': E2E_STARTER_WEB_USER });

  const run = await archon.startWorkflowViaWeb(
    E2E_QUEUE_GUIDANCE_WORKFLOW_NAME,
    'e2e idle await retry'
  );
  const room = await openGuidanceRoom(page, 'legacy', run.runId, QUEUE_GUIDANCE_NODE);
  await interruptToIdle(page, room, run.runId, QUEUE_GUIDANCE_NODE);

  // Capture the interrupted attempt's tool id before expiry teardown can race.
  const beforeMessages = await listNodeMessages(page, run.runId, QUEUE_GUIDANCE_NODE);
  const beforeToolIds = toolCallIds(beforeMessages);
  expect(beforeToolIds.length, 'interrupted attempt emitted a fake tool id').toBeGreaterThan(0);
  const interruptedToolId = beforeToolIds[0]!;
  expect(interruptedToolId).toMatch(/^e2e-fake-tool-/);

  await assertExpiryFailure(page, run.runId, QUEUE_GUIDANCE_NODE);
  const failedDetail = (await getRunDetail(page, run.runId)) as RunDetailSnapshot;
  const failedExec = latestNodeExecution(failedDetail, QUEUE_GUIDANCE_NODE);
  expect(failedExec?.retry_epoch ?? 0).toBe(0);

  // WorkflowNodeRetryAction lives in the legacy run chrome, outside the room.
  const retryTrigger = page.getByRole('button', { name: /^Retry$/ }).first();
  await expect(retryTrigger).toBeVisible({ timeout: T.medium });
  await retryTrigger.click();
  const confirm = page.getByRole('button', { name: /^Retry node$/ });
  await expect(confirm).toBeVisible({ timeout: T.medium });
  await confirm.click();

  // Retried node starts generating again with a new tool call.
  await expect
    .poll(
      async () => {
        const detail = (await getRunDetail(page, run.runId)) as RunDetailSnapshot;
        const latest = latestNodeExecution(detail, QUEUE_GUIDANCE_NODE);
        return latest?.retry_epoch ?? -1;
      },
      { timeout: T.xlong, message: 'retried execution advances retry_epoch' }
    )
    .toBeGreaterThanOrEqual(1);

  await expect
    .poll(
      async () => {
        const messages = await listNodeMessages(page, run.runId, QUEUE_GUIDANCE_NODE);
        const ids = toolCallIds(messages);
        return ids.find(id => id !== interruptedToolId) ?? null;
      },
      { timeout: T.xlong, message: 'retried turn emits a different fake tool id' }
    )
    .not.toBeNull();

  const afterMessages = await listNodeMessages(page, run.runId, QUEUE_GUIDANCE_NODE);
  const afterToolIds = toolCallIds(afterMessages);
  const retriedToolId = afterToolIds.find(id => id !== interruptedToolId);
  expect(retriedToolId).toBeTruthy();
  expect(retriedToolId).not.toBe(interruptedToolId);

  // Session ids embedded in e2e-fake-tool-${sessionId} must differ.
  const sessionOf = (toolId: string): string => toolId.replace(/^e2e-fake-tool-/, '');
  expect(sessionOf(retriedToolId!)).not.toBe(sessionOf(interruptedToolId));

  const afterDetail = (await getRunDetail(page, run.runId)) as RunDetailSnapshot;
  const retriedExec = latestNodeExecution(afterDetail, QUEUE_GUIDANCE_NODE);
  expect(retriedExec?.retry_epoch ?? 0).toBeGreaterThanOrEqual(1);

  mergeMeasurements('retry-legacy', {
    interruptedToolId,
    retriedToolId,
    interruptedSession: sessionOf(interruptedToolId),
    retriedSession: sessionOf(retriedToolId!),
    failedRetryEpoch: failedExec?.retry_epoch ?? 0,
    retriedRetryEpoch: retriedExec?.retry_epoch ?? null,
  });
  await captureEvidence(room, 'retry-legacy-after.png', testInfo);
});
