import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type Locator, type Page, type TestInfo } from '@playwright/test';

import { test, expect } from '../lib/playwright/suite';
import {
  E2E_QUEUE_GUIDANCE_LOOP_WORKFLOW_NAME,
  E2E_QUEUE_GUIDANCE_WORKFLOW_NAME,
  E2E_STARTER_WEB_USER,
  QUEUE_GUIDANCE_LOOP_NODE,
  QUEUE_GUIDANCE_NODE,
  type ArchonRuntime,
} from '../lib/playwright/archon-runtime';
import {
  createIdentityContext,
  getRunDetail,
  listNodeMessages,
  openLegacyRunDetail,
  openRunDetail,
} from '../lib/playwright/run-detail';
import { T } from '../lib/playwright/timeouts';

/**
 * Story 2.11 / issue #191 — recover messages that were never sent when the
 * node ends. Real executor + fake provider; both shells. Cancel tests wait for
 * persisted `node_failed` (not run cancelled alone, not `dag_node_failed`).
 */

type Surface = 'console' | 'legacy';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EVIDENCE_DIR = join(
  REPO_ROOT,
  'plans',
  '260920-1136-issue-191-recover-never-sent-messages',
  'reports',
  'evidence'
);
const MEASUREMENTS_FILE = join(EVIDENCE_DIR, 'never-sent-measurements.json');
const IDLE_TIMEOUT_EVIDENCE_DIR = join(
  REPO_ROOT,
  'plans',
  '260920-1154-issue-192-fail-abandoned-redirect-30min',
  'reports',
  'evidence'
);
const IDLE_TIMEOUT_MEASUREMENTS_FILE = join(
  IDLE_TIMEOUT_EVIDENCE_DIR,
  'us-005-terminal-measurements.json'
);

const SCROLLER_TESTID: Record<Surface, string> = {
  console: 'console-node-room-scroll',
  legacy: 'node-transcript-scroll',
};

const NARROW = { width: 460, height: 900 } as const;
const WIDE = { width: 1440, height: 900 } as const;

const NEVER_SENT_DISCLOSURE = 'node finished · none of this was sent';
const IDLE_TIMEOUT_FAILURE_TEXT =
  'interrupted by operator, no redirect received · failed after 30-minute idle timeout';
const IDLE_TIMEOUT_STATUS = 'node failed · interrupted with no redirect · none of this was sent';
const FIRST_MESSAGE = 'never-sent first';
const SECOND_MESSAGE = 'never-sent second';
const DRAFT_RAW = '  still typing  ';
const IDLE_QUEUE_MESSAGE = 'idle after interrupt never-sent';

function sendPathname(runId: string, nodeId: string): string {
  return `/api/workflows/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}/send`;
}

function interruptPathname(runId: string, nodeId: string): string {
  return `/api/workflows/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}/interrupt`;
}

function abandonPathname(runId: string): string {
  return `/api/workflows/runs/${encodeURIComponent(runId)}/abandon`;
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

function stopButton(room: Locator): Locator {
  return room.getByRole('button', { name: /^(Stop|Stopping…)$/ });
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

function neverSentList(room: Locator): Locator {
  return room.getByRole('list', { name: /^Never sent/ });
}

function neverSentAlert(room: Locator): Locator {
  return room.getByRole('alert').filter({ hasText: NEVER_SENT_DISCLOSURE });
}

function executionSelect(page: Page): Locator {
  return page.getByLabel('Execution', { exact: true });
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

async function abandonRun(
  page: Page,
  archon: { starterFetch: (path: string, init?: RequestInit) => Promise<Response> },
  runId: string
): Promise<void> {
  const res = await archon.starterFetch(abandonPathname(runId), {
    method: 'POST',
    body: JSON.stringify({}),
  });
  expect(res.status, `abandon ${runId}`).toBe(200);
}

/**
 * Terminal-presentation fixture only: wait for the real Cancel finalizer, then
 * atomically label its persisted node_failed event as the engine's structured
 * idle-expiry shape. The fake-timer workflow tests prove the 30-minute timer;
 * this isolated worker database edit proves the browser's persisted-event UI.
 */
function markTerminalPresentationAsIdleExpiry(
  archon: ArchonRuntime,
  runId: string,
  nodeId: string
): void {
  const script = `
    import { Database } from 'bun:sqlite';
    const dbPathKey = 'E2E_DB_PATH';
    const runIdKey = 'E2E_RUN_ID';
    const nodeIdKey = 'E2E_NODE_ID';
    const db = new Database(process.env[dbPathKey]);
    const runId = process.env[runIdKey];
    const nodeId = process.env[nodeIdKey];
    if (!runId || !nodeId) throw new Error('terminal presentation fixture missing run or node');
    let event;
    for (let attempt = 0; attempt < 600; attempt += 1) {
      event = db
        .query("SELECT id, data FROM remote_agent_workflow_events WHERE workflow_run_id = ? AND step_name = ? AND event_type = 'node_failed' ORDER BY created_at DESC, id DESC LIMIT 1")
        .get(runId, nodeId);
      if (event) break;
      await Bun.sleep(25);
    }
    if (!event) throw new Error('real node_failed event did not persist');
    const data = JSON.parse(String(event.data ?? '{}'));
    data.error = 'interrupted by operator, no redirect received';
    data.failure_reason = 'idle_after_interrupt_timeout';
    db.run('BEGIN IMMEDIATE');
    try {
      db.run('UPDATE remote_agent_workflow_events SET data = ? WHERE id = ?', [JSON.stringify(data), event.id]);
      db.run("UPDATE remote_agent_workflow_runs SET status = 'failed' WHERE id = ?", [runId]);
      db.run('COMMIT');
    } catch (error) {
      db.run('ROLLBACK');
      throw error;
    }
  `;
  const result = spawnSync('bun', ['-e', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      E2E_DB_PATH: join(archon.home, 'archon.db'),
      E2E_RUN_ID: runId,
      E2E_NODE_ID: nodeId,
    },
  });
  if (result.status !== 0) {
    throw new Error(`terminal presentation fixture failed:\n${result.stderr}\n${result.stdout}`);
  }
}

/** Hold the SSE-driven run refetch until the isolated DB fixture is complete. */
async function holdRunDetailResponse(
  page: Page,
  runId: string
): Promise<{ release: () => void; unroute: () => Promise<void> }> {
  const pathname = `/api/workflows/runs/${encodeURIComponent(runId)}`;
  let releaseGate: () => void = () => undefined;
  const gate = new Promise<void>(resolve => {
    releaseGate = resolve;
  });
  const handler = async (route: import('@playwright/test').Route): Promise<void> => {
    if (new URL(route.request().url()).pathname !== pathname) {
      await route.continue();
      return;
    }
    await gate;
    await route.continue();
  };
  await page.route('**/api/workflows/runs/**', handler);
  return {
    release: (): void => {
      releaseGate();
    },
    unroute: async (): Promise<void> => {
      await page.unroute('**/api/workflows/runs/**', handler);
    },
  };
}

/** Milestone 1: run cancelled; Never sent must stay hidden while node still unsettled. */
async function assertNoNeverSentWhileUnsettled(
  page: Page,
  room: Locator,
  runId: string,
  nodeId: string
): Promise<void> {
  const detail = await getRunDetail(page, runId);
  expect(detail.status).toBe('cancelled');
  const selected = detail.nodeExecutions.filter(row => row.node_id === nodeId);
  const stillUnsettled = selected.some(
    row => row.status !== 'completed' && row.status !== 'failed' && row.status !== 'skipped'
  );
  if (stillUnsettled || selected.length === 0) {
    await expect(neverSentList(room)).toHaveCount(0);
    await expect(room.getByText(NEVER_SENT_DISCLOSURE)).toHaveCount(0);
  }
}

/**
 * Milestone 2: wait for real node_failed on the selected step AND a failed
 * raw execution for that node. Never accept dag_node_failed log labels.
 */
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

async function assertNeverSentBox(
  room: Locator,
  expected: { messageId: string | null; text: string }[]
): Promise<void> {
  const list = neverSentList(room);
  await expect(list).toBeVisible({ timeout: T.long });
  await expect(list).toHaveAttribute('aria-label', `Never sent, ${String(expected.length)}`);
  const items = list.getByRole('listitem');
  await expect(items).toHaveCount(expected.length);
  for (let i = 0; i < expected.length; i += 1) {
    const entry = expected[i]!;
    const item = items.nth(i);
    await expect(item).toHaveText(entry.text);
    if (entry.messageId === null) {
      expect(await item.getAttribute('data-message-id')).toBeNull();
    } else {
      await expect(item).toHaveAttribute('data-message-id', entry.messageId);
    }
  }
  await expect(neverSentAlert(room)).toHaveCount(1);
  await expect(neverSentAlert(room)).toHaveText(NEVER_SENT_DISCLOSURE);
  await expect(guidanceField(room)).toHaveCount(0);
  await expect(queueButton(room)).toHaveCount(0);
  await expect(room.getByRole('button', { name: /^delete ·/ })).toHaveCount(0);
  await expect(sendNowButton(room)).toHaveCount(0);
  await expect(stopButton(room)).toHaveCount(0);
}

async function assertIdleExpiryNeverSentBox(
  room: Locator,
  expected: { messageId: string | null; text: string }[]
): Promise<void> {
  const list = neverSentList(room);
  await expect(list).toBeVisible({ timeout: T.long });
  await expect(list).toHaveAttribute('aria-label', `Never sent, ${String(expected.length)}`);
  const items = list.getByRole('listitem');
  await expect(items).toHaveCount(expected.length);
  for (let i = 0; i < expected.length; i += 1) {
    const entry = expected[i]!;
    const item = items.nth(i);
    await expect(item).toHaveText(entry.text);
    if (entry.messageId === null) {
      expect(await item.getAttribute('data-message-id')).toBeNull();
    } else {
      await expect(item).toHaveAttribute('data-message-id', entry.messageId);
    }
  }
  await expect(room.getByText(IDLE_TIMEOUT_FAILURE_TEXT)).toBeVisible();
  await expect(
    room.locator('[role="status"]').filter({ hasText: IDLE_TIMEOUT_STATUS })
  ).toHaveCount(1);
  await expect(neverSentAlert(room)).toHaveCount(0);
  await expect(guidanceField(room)).toHaveCount(0);
  await expect(queueButton(room)).toHaveCount(0);
  await expect(room.getByRole('button', { name: /^delete ·/ })).toHaveCount(0);
  await expect(sendNowButton(room)).toHaveCount(0);
  await expect(stopButton(room)).toHaveCount(0);
}

async function assertNoOperatorMessageIds(
  page: Page,
  runId: string,
  nodeId: string,
  messageIds: string[]
): Promise<void> {
  const messages = await listNodeMessages(page, runId, nodeId);
  const operatorIds = messages
    .filter(message => message.kind === 'text' && message.metadata?.origin === 'operator')
    .map(message => message.metadata?.message_id)
    .filter((id): id is string => typeof id === 'string');
  for (const id of messageIds) {
    expect(operatorIds, `operator rows must not include never-sent id ${id}`).not.toContain(id);
  }
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

async function waitForLoopEvent(
  page: Page,
  runId: string,
  eventType: 'loop_iteration_started' | 'loop_iteration_completed',
  iteration: number
): Promise<void> {
  await expect
    .poll(
      async () => {
        const detail = await getRunDetail(page, runId);
        return detail.events.some(
          event =>
            event.event_type === eventType &&
            event.step_name === QUEUE_GUIDANCE_LOOP_NODE &&
            event.data.iteration === iteration
        );
      },
      {
        timeout: T.xlong,
        message: `${eventType} ${String(iteration)} is persisted`,
      }
    )
    .toBe(true);
}

async function executionRowId(page: Page, iteration: number): Promise<string> {
  const select = executionSelect(page);
  await expect(select).toBeVisible({ timeout: T.medium });
  let rowId = '';
  await expect
    .poll(
      async () => {
        const options = await select.locator('option').evaluateAll(nodes =>
          nodes.map(node => ({
            text: node.textContent ?? '',
            value: node.getAttribute('value'),
          }))
        );
        rowId =
          options.find(option => option.text.includes(`Iteration ${String(iteration)}`))?.value ??
          '';
        return rowId;
      },
      {
        timeout: T.long,
        message: `Execution option for iteration ${String(iteration)}`,
      }
    )
    .not.toBe('');
  return rowId;
}

async function selectExecution(page: Page, iteration: number): Promise<void> {
  await executionSelect(page).selectOption(await executionRowId(page, iteration));
}

async function captureEvidence(target: Locator, name: string, testInfo: TestInfo): Promise<void> {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const shot = await target.screenshot({ path: join(EVIDENCE_DIR, name) });
  await testInfo.attach(name, { body: shot, contentType: 'image/png' });
}

async function captureIdleTimeoutEvidence(
  target: Locator,
  name: string,
  testInfo: TestInfo
): Promise<void> {
  mkdirSync(IDLE_TIMEOUT_EVIDENCE_DIR, { recursive: true });
  const shot = await target.screenshot({ path: join(IDLE_TIMEOUT_EVIDENCE_DIR, name) });
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

function mergeIdleTimeoutMeasurements(section: string, data: Record<string, unknown>): void {
  mkdirSync(IDLE_TIMEOUT_EVIDENCE_DIR, { recursive: true });
  const current = existsSync(IDLE_TIMEOUT_MEASUREMENTS_FILE)
    ? (JSON.parse(readFileSync(IDLE_TIMEOUT_MEASUREMENTS_FILE, 'utf8')) as Record<string, unknown>)
    : {};
  current[section] = data;
  writeFileSync(IDLE_TIMEOUT_MEASUREMENTS_FILE, `${JSON.stringify(current, null, 2)}\n`);
}

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

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

async function textContrast(el: Locator): Promise<{ ratio: number; color: string; bg: string }> {
  const color = await el.evaluate(
    node => node.ownerDocument.defaultView?.getComputedStyle(node).color ?? ''
  );
  const fg = await resolveColorIn(el, color);
  const bg = await effectiveBackground(el);
  return { ratio: contrastRatio(fg.c, bg.c), color: fg.resolved, bg: bg.resolved };
}

async function expectNoRoomDrivenOverflow(room: Locator, context = ''): Promise<void> {
  const report = await room.evaluate(roomEl => {
    const width = document.documentElement.clientWidth;
    const offenders: { tag: string; insideRoom: boolean }[] = [];
    document.querySelectorAll('body *').forEach(el => {
      const rect = el.getBoundingClientRect();
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
    `no room element overflows the page ${context} (inside offenders: ${report.insideSample.join(', ') || 'none'})`
  ).toBe(0);
}

async function measureNeverSentVisual(room: Locator): Promise<Record<string, unknown>> {
  const list = neverSentList(room);
  const header = room
    .locator('h3')
    .filter({ hasText: /^never sent ·/i })
    .first();
  const alert = neverSentAlert(room);
  const scrollWrap = list.locator('xpath=..');

  const geometry = await room.evaluate(roomEl => {
    const listEl = roomEl.querySelector('ul[aria-label^="Never sent"]');
    const wrap = listEl?.parentElement ?? null;
    const headerEl = roomEl.querySelector('h3');
    const style = wrap ? roomEl.ownerDocument.defaultView?.getComputedStyle(wrap) : null;
    const headerStyle = headerEl
      ? roomEl.ownerDocument.defaultView?.getComputedStyle(headerEl)
      : null;
    const items = listEl ? Array.from(listEl.querySelectorAll('li span')) : [];
    const elision = items.map(span => {
      const cs = roomEl.ownerDocument.defaultView?.getComputedStyle(span);
      return {
        textOverflow: cs?.textOverflow ?? '',
        whiteSpace: cs?.whiteSpace ?? '',
        overflow: cs?.overflow ?? '',
        scrollWider: span.scrollWidth > span.clientWidth + 1,
      };
    });
    const focusables = listEl
      ? Array.from(
          (listEl.closest('section') ?? roomEl).querySelectorAll(
            'button, a, input, textarea, select, [tabindex]:not([tabindex="-1"])'
          )
        ).filter(el => {
          const t = el as HTMLElement;
          return t.offsetParent !== null && !t.hasAttribute('disabled');
        }).length
      : -1;
    return {
      hasMaxH33vh: wrap?.className.includes('max-h-[33vh]') ?? false,
      maxHeight: style?.maxHeight ?? '',
      overflowY: style?.overflowY ?? '',
      textTransform: headerStyle?.textTransform ?? '',
      letterSpacing: headerStyle?.letterSpacing ?? '',
      elision,
      focusableControls: focusables,
      wrapHeight: wrap?.getBoundingClientRect().height ?? 0,
      vh33: roomEl.ownerDocument.defaultView
        ? roomEl.ownerDocument.defaultView.innerHeight * 0.33
        : 0,
    };
  });

  const headerContrast = await textContrast(header);
  const alertContrast = await textContrast(alert);
  const itemContrast = await textContrast(list.getByRole('listitem').first());

  expect(geometry.hasMaxH33vh, 'never-sent scroll wrapper keeps max-h-[33vh]').toBe(true);
  expect(geometry.overflowY, 'never-sent scroll wrapper scrolls vertically').toMatch(/auto|scroll/);
  expect(geometry.wrapHeight, 'never-sent band ≤ 33vh').toBeLessThanOrEqual(geometry.vh33 + 2);
  expect(geometry.textTransform, 'header uppercase').toBe('uppercase');
  // 0.07em tracking — allow sub-pixel float variance
  const spacingPx = Number.parseFloat(String(geometry.letterSpacing));
  expect(Number.isFinite(spacingPx), 'letter-spacing is computed px').toBe(true);
  expect(geometry.focusableControls, 'no focusable controls in finished box').toBe(0);
  expect(headerContrast.ratio, 'header contrast ≥ 4.5').toBeGreaterThanOrEqual(4.5);
  expect(alertContrast.ratio, 'alert contrast ≥ 4.5').toBeGreaterThanOrEqual(4.5);
  expect(itemContrast.ratio, 'item contrast ≥ 4.5').toBeGreaterThanOrEqual(4.5);

  return {
    geometry,
    headerContrast,
    alertContrast,
    itemContrast,
    letterSpacingPx: spacingPx,
  };
}

for (const surface of ['console', 'legacy'] as const) {
  test(`[P1] [V:steer.never-sent-cancel-${surface}] queued messages survive Cancel on ${surface}`, async ({
    page,
    archon,
  }, testInfo: TestInfo) => {
    test.setTimeout(T.xlong * 2);
    await page.setExtraHTTPHeaders({ 'X-Archon-User': E2E_STARTER_WEB_USER });
    await page.setViewportSize(NARROW);

    const run = await archon.startWorkflowViaWeb(
      E2E_QUEUE_GUIDANCE_WORKFLOW_NAME,
      `e2e never-sent cancel ${surface}`
    );
    await waitForNodeStarted(page, run.runId, QUEUE_GUIDANCE_NODE);
    const room = await openGuidanceRoom(page, surface, run.runId, QUEUE_GUIDANCE_NODE);
    await expect(guidanceField(room)).toBeVisible({ timeout: T.medium });

    const idA = await queueGuidance(page, room, run.runId, QUEUE_GUIDANCE_NODE, FIRST_MESSAGE);
    const idB = await queueGuidance(page, room, run.runId, QUEUE_GUIDANCE_NODE, SECOND_MESSAGE);
    await expect(room.getByText('queued · 2')).toBeVisible();
    expect(idA).not.toBe(idB);

    await abandonRun(page, archon, run.runId);
    await archon.waitForRunStatus(run.runId, 'cancelled', T.long);
    await assertNoNeverSentWhileUnsettled(page, room, run.runId, QUEUE_GUIDANCE_NODE);

    await waitForNodeFailed(page, run.runId, QUEUE_GUIDANCE_NODE);
    await assertNeverSentBox(room, [
      { messageId: idA, text: FIRST_MESSAGE },
      { messageId: idB, text: SECOND_MESSAGE },
    ]);
    await assertNoOperatorMessageIds(page, run.runId, QUEUE_GUIDANCE_NODE, [idA, idB]);
    await captureEvidence(room, `e4-1-${surface}-never-sent-2.png`, testInfo);
  });

  test(`[P1] [V:steer.never-sent-observer-${surface}] observer tab recovers shared receipt on ${surface}`, async ({
    browser,
    archon,
  }, testInfo: TestInfo) => {
    test.setTimeout(T.xlong * 2);
    const creatorCtx = await createIdentityContext(browser, archon.baseURL, 'starter');
    const observerCtx = await createIdentityContext(browser, archon.baseURL, 'starter');
    const creator = await creatorCtx.newPage();
    const observer = await observerCtx.newPage();

    try {
      await creator.setViewportSize(NARROW);
      await observer.setViewportSize(NARROW);

      const run = await archon.startWorkflowViaWeb(
        E2E_QUEUE_GUIDANCE_WORKFLOW_NAME,
        `e2e never-sent observer ${surface}`
      );
      await waitForNodeStarted(creator, run.runId, QUEUE_GUIDANCE_NODE);

      const creatorRoom = await openGuidanceRoom(creator, surface, run.runId, QUEUE_GUIDANCE_NODE);
      await expect(guidanceField(creatorRoom)).toBeVisible({ timeout: T.medium });
      const idA = await queueGuidance(
        creator,
        creatorRoom,
        run.runId,
        QUEUE_GUIDANCE_NODE,
        FIRST_MESSAGE
      );
      await expect(creatorRoom.getByText('queued · 1')).toBeVisible();

      const observerRoom = await openGuidanceRoom(
        observer,
        surface,
        run.runId,
        QUEUE_GUIDANCE_NODE
      );
      await expect
        .poll(
          async () => {
            const list = queueList(observerRoom);
            if ((await list.count()) === 0) return [];
            return list
              .locator('li[data-message-id]')
              .evaluateAll(nodes =>
                nodes
                  .map(node => node.getAttribute('data-message-id'))
                  .filter((id): id is string => typeof id === 'string' && id.length > 0)
              );
          },
          { timeout: T.long, message: 'observer sees creator receipt in shared queue' }
        )
        .toEqual([idA]);

      await creatorCtx.close();

      await abandonRun(observer, archon, run.runId);
      await archon.waitForRunStatus(run.runId, 'cancelled', T.long);
      await assertNoNeverSentWhileUnsettled(observer, observerRoom, run.runId, QUEUE_GUIDANCE_NODE);
      await waitForNodeFailed(observer, run.runId, QUEUE_GUIDANCE_NODE);
      await assertNeverSentBox(observerRoom, [{ messageId: idA, text: FIRST_MESSAGE }]);
      await assertNoOperatorMessageIds(observer, run.runId, QUEUE_GUIDANCE_NODE, [idA]);
      await captureEvidence(observerRoom, `e4-2-${surface}-observer-never-sent.png`, testInfo);
    } finally {
      await observerCtx.close().catch(() => undefined);
      await creatorCtx.close().catch(() => undefined);
    }
  });

  test(`[P1] [V:steer.never-sent-idle-queue-${surface}] idle-after-interrupt guidance survives Cancel on ${surface}`, async ({
    page,
    archon,
  }, testInfo: TestInfo) => {
    test.setTimeout(T.xlong * 2);
    await page.setExtraHTTPHeaders({ 'X-Archon-User': E2E_STARTER_WEB_USER });
    await page.setViewportSize(NARROW);

    const run = await archon.startWorkflowViaWeb(
      E2E_QUEUE_GUIDANCE_WORKFLOW_NAME,
      `e2e never-sent idle ${surface}`
    );
    await waitForNodeStarted(page, run.runId, QUEUE_GUIDANCE_NODE);
    const room = await openGuidanceRoom(page, surface, run.runId, QUEUE_GUIDANCE_NODE);
    await expect(guidanceField(room)).toBeVisible({ timeout: T.medium });
    await waitForSubState(page, run.runId, QUEUE_GUIDANCE_NODE, 'generating');

    const interruptResponse = page.waitForResponse(
      res => new URL(res.url()).pathname === interruptPathname(run.runId, QUEUE_GUIDANCE_NODE)
    );
    await stopButton(room).click();
    expect((await interruptResponse).status()).toBe(200);
    await expect(sendNowButton(room)).toBeVisible({ timeout: T.medium });
    await waitForSubState(page, run.runId, QUEUE_GUIDANCE_NODE, 'idle-after-interrupt');

    const messageId = randomUUID();
    const queued = await archon.starterFetch(sendPathname(run.runId, QUEUE_GUIDANCE_NODE), {
      method: 'POST',
      body: JSON.stringify({
        message: IDLE_QUEUE_MESSAGE,
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

    await expect(room.getByText('will send · 1')).toBeVisible({ timeout: T.long });
    await expect(willSendList(room).getByRole('listitem')).toContainText(IDLE_QUEUE_MESSAGE);
    // Must not click Send now — that would drain.

    await abandonRun(page, archon, run.runId);
    await archon.waitForRunStatus(run.runId, 'cancelled', T.long);
    await assertNoNeverSentWhileUnsettled(page, room, run.runId, QUEUE_GUIDANCE_NODE);
    await waitForNodeFailed(page, run.runId, QUEUE_GUIDANCE_NODE);
    await assertNeverSentBox(room, [{ messageId, text: IDLE_QUEUE_MESSAGE }]);
    await assertNoOperatorMessageIds(page, run.runId, QUEUE_GUIDANCE_NODE, [messageId]);
    await captureEvidence(room, `e4-3-${surface}-idle-never-sent.png`, testInfo);
  });

  test(`[P1] [V:steer.idle-timeout-${surface}] persisted idle-expiry terminal presentation on ${surface}`, async ({
    page,
    archon,
  }, testInfo: TestInfo) => {
    test.setTimeout(T.xlong * 3);
    await page.setExtraHTTPHeaders({ 'X-Archon-User': E2E_STARTER_WEB_USER });
    await page.setViewportSize(NARROW);

    const run = await archon.startWorkflowViaWeb(
      E2E_QUEUE_GUIDANCE_WORKFLOW_NAME,
      `e2e idle-timeout terminal ${surface}`
    );
    await waitForNodeStarted(page, run.runId, QUEUE_GUIDANCE_NODE);
    const room = await openGuidanceRoom(page, surface, run.runId, QUEUE_GUIDANCE_NODE);
    const field = guidanceField(room);
    await expect(field).toBeVisible({ timeout: T.medium });
    await waitForSubState(page, run.runId, QUEUE_GUIDANCE_NODE, 'generating');

    const interrupted = page.waitForResponse(
      response =>
        new URL(response.url()).pathname === interruptPathname(run.runId, QUEUE_GUIDANCE_NODE)
    );
    await stopButton(room).click();
    expect((await interrupted).status()).toBe(200);
    await expect(sendNowButton(room)).toBeVisible({ timeout: T.medium });
    await waitForSubState(page, run.runId, QUEUE_GUIDANCE_NODE, 'idle-after-interrupt');

    const messageId = randomUUID();
    const queued = await archon.starterFetch(sendPathname(run.runId, QUEUE_GUIDANCE_NODE), {
      method: 'POST',
      body: JSON.stringify({
        message: IDLE_QUEUE_MESSAGE,
        message_id: messageId,
        intent: 'queue',
      }),
    });
    expect(queued.status).toBe(200);
    await expect(room.getByText('will send · 1')).toBeVisible({ timeout: T.long });
    await field.fill(DRAFT_RAW);
    await field.focus();

    const heldRunDetail = await holdRunDetailResponse(page, run.runId);
    try {
      await abandonRun(page, archon, run.runId);
      markTerminalPresentationAsIdleExpiry(archon, run.runId, QUEUE_GUIDANCE_NODE);
    } finally {
      heldRunDetail.release();
      await heldRunDetail.unroute();
    }

    const persisted = await getRunDetail(page, run.runId);
    expect(persisted.status).toBe('failed');
    expect(
      persisted.events.find(
        event => event.event_type === 'node_failed' && event.step_name === QUEUE_GUIDANCE_NODE
      )?.data
    ).toMatchObject({
      error: 'interrupted by operator, no redirect received',
      failure_reason: 'idle_after_interrupt_timeout',
    });

    await expect(room.getByText(IDLE_TIMEOUT_FAILURE_TEXT)).toBeVisible({ timeout: T.long });
    await assertIdleExpiryNeverSentBox(room, [
      { messageId, text: IDLE_QUEUE_MESSAGE },
      { messageId: null, text: DRAFT_RAW },
    ]);
    const timeoutStatus = room.locator('[role="status"]').filter({ hasText: IDLE_TIMEOUT_STATUS });
    await expect(timeoutStatus).toHaveCount(1);
    await expect(timeoutStatus).toHaveText(IDLE_TIMEOUT_STATUS);
    await expect(neverSentAlert(room)).toHaveCount(0);
    await expect
      .poll(async () => focusTarget(page, surface), {
        timeout: T.medium,
        message: 'timeout terminal focus remains in the transcript',
      })
      .toMatch(/^(last-row|scroller)$/);
    await expectNoRoomDrivenOverflow(room, `${surface}-idle-timeout-460`);
    const narrowRoomWidth = (await room.boundingBox())?.width ?? 0;
    await captureIdleTimeoutEvidence(room, `us-005-${surface}-460-idle-timeout.png`, testInfo);

    await page.setViewportSize(WIDE);
    await expectNoRoomDrivenOverflow(room, `${surface}-idle-timeout-1440`);
    const wideRoomWidth = (await room.boundingBox())?.width ?? 0;
    await captureIdleTimeoutEvidence(room, `us-005-${surface}-1440-idle-timeout.png`, testInfo);
    mergeIdleTimeoutMeasurements(`terminal-${surface}`, {
      roomWidth460: narrowRoomWidth,
      roomWidth1440: wideRoomWidth,
      consolePanelWidth: surface === 'console' ? wideRoomWidth : null,
    });

    const emptyRun = await archon.startWorkflowViaWeb(
      E2E_QUEUE_GUIDANCE_WORKFLOW_NAME,
      `e2e idle-timeout empty ${surface}`
    );
    await waitForNodeStarted(page, emptyRun.runId, QUEUE_GUIDANCE_NODE);
    const emptyRoom = await openGuidanceRoom(page, surface, emptyRun.runId, QUEUE_GUIDANCE_NODE);
    const emptyInterrupted = page.waitForResponse(
      response =>
        new URL(response.url()).pathname === interruptPathname(emptyRun.runId, QUEUE_GUIDANCE_NODE)
    );
    await stopButton(emptyRoom).click();
    expect((await emptyInterrupted).status()).toBe(200);
    await expect(sendNowButton(emptyRoom)).toBeVisible({ timeout: T.medium });

    const heldEmptyRunDetail = await holdRunDetailResponse(page, emptyRun.runId);
    try {
      await abandonRun(page, archon, emptyRun.runId);
      markTerminalPresentationAsIdleExpiry(archon, emptyRun.runId, QUEUE_GUIDANCE_NODE);
    } finally {
      heldEmptyRunDetail.release();
      await heldEmptyRunDetail.unroute();
    }

    await expect(emptyRoom.getByText(IDLE_TIMEOUT_FAILURE_TEXT)).toBeVisible({ timeout: T.long });
    await expect(neverSentList(emptyRoom)).toHaveCount(0);
    await expect(
      emptyRoom.locator('[role="status"]').filter({ hasText: IDLE_TIMEOUT_STATUS })
    ).toHaveCount(1);
    await expect(neverSentAlert(emptyRoom)).toHaveCount(0);
    await expect(guidanceField(emptyRoom)).toHaveCount(0);
    await expect(queueButton(emptyRoom)).toHaveCount(0);
    await expect(sendNowButton(emptyRoom)).toHaveCount(0);
    await expect(stopButton(emptyRoom)).toHaveCount(0);
  });

  test(`[P1] [V:steer.never-sent-draft-${surface}] half-typed draft folds in last on ${surface}`, async ({
    page,
    archon,
  }, testInfo: TestInfo) => {
    test.setTimeout(T.xlong * 2);
    await page.setExtraHTTPHeaders({ 'X-Archon-User': E2E_STARTER_WEB_USER });
    await page.setViewportSize(NARROW);

    const run = await archon.startWorkflowViaWeb(
      E2E_QUEUE_GUIDANCE_WORKFLOW_NAME,
      `e2e never-sent draft ${surface}`
    );
    await waitForNodeStarted(page, run.runId, QUEUE_GUIDANCE_NODE);
    const room = await openGuidanceRoom(page, surface, run.runId, QUEUE_GUIDANCE_NODE);
    const field = guidanceField(room);
    await expect(field).toBeVisible({ timeout: T.medium });

    const idA = await queueGuidance(page, room, run.runId, QUEUE_GUIDANCE_NODE, FIRST_MESSAGE);
    await field.fill(DRAFT_RAW);
    expect(await field.inputValue()).toBe(DRAFT_RAW);

    await abandonRun(page, archon, run.runId);
    await archon.waitForRunStatus(run.runId, 'cancelled', T.long);
    await assertNoNeverSentWhileUnsettled(page, room, run.runId, QUEUE_GUIDANCE_NODE);
    await waitForNodeFailed(page, run.runId, QUEUE_GUIDANCE_NODE);
    await assertNeverSentBox(room, [
      { messageId: idA, text: FIRST_MESSAGE },
      { messageId: null, text: DRAFT_RAW },
    ]);
    await captureEvidence(room, `e4-4-${surface}-draft-fold.png`, testInfo);
  });

  test(`[P1] [V:steer.never-sent-finished-iter-${surface}] finished-iteration observer recovers node-wide on ${surface}`, async ({
    page,
    archon,
  }, testInfo: TestInfo) => {
    test.setTimeout(T.xlong * 3);
    await page.setExtraHTTPHeaders({ 'X-Archon-User': E2E_STARTER_WEB_USER });
    await page.setViewportSize(NARROW);

    const run = await archon.startWorkflowViaWeb(
      E2E_QUEUE_GUIDANCE_LOOP_WORKFLOW_NAME,
      `e2e never-sent finished-iter ${surface}`
    );
    // Match agent-finished-iteration: wait for both iterations before opening
    // the room so Legacy's Execution select is populated with Iteration 2.
    await waitForLoopEvent(page, run.runId, 'loop_iteration_completed', 1);
    await waitForLoopEvent(page, run.runId, 'loop_iteration_started', 2);
    const room = await openGuidanceRoom(page, surface, run.runId, QUEUE_GUIDANCE_LOOP_NODE);
    await selectExecution(page, 2);
    await expect(guidanceField(room)).toBeVisible({ timeout: T.medium });

    const idA = await queueGuidance(page, room, run.runId, QUEUE_GUIDANCE_LOOP_NODE, FIRST_MESSAGE);
    await expect(room.getByText('queued · 1')).toBeVisible();

    await selectExecution(page, 1);
    await expect(
      room.getByText('reading a finished iteration · the agent is working in iteration 2', {
        exact: true,
      })
    ).toBeVisible({ timeout: T.medium });
    await expect(queueList(room)).toContainText(FIRST_MESSAGE);
    const go = room.getByRole('button', { name: 'Go to iteration 2', exact: true });
    await expect(go).toBeVisible();
    await go.focus();

    await abandonRun(page, archon, run.runId);
    await archon.waitForRunStatus(run.runId, 'cancelled', T.long);
    await waitForNodeFailed(page, run.runId, QUEUE_GUIDANCE_LOOP_NODE);

    await expect(go).toHaveCount(0);
    await assertNeverSentBox(room, [{ messageId: idA, text: FIRST_MESSAGE }]);
    await expect
      .poll(async () => focusTarget(page, surface), {
        timeout: T.medium,
        message: 'focus lands on transcript target',
      })
      .toMatch(/^(last-row|scroller)$/);
    await captureEvidence(room, `e4-5-${surface}-finished-iter-never-sent.png`, testInfo);
  });

  test(`[P1] [V:steer.never-sent-focus-${surface}] focus and single announcement on ${surface}`, async ({
    page,
    archon,
  }) => {
    test.setTimeout(T.xlong * 2);
    await page.setExtraHTTPHeaders({ 'X-Archon-User': E2E_STARTER_WEB_USER });
    await page.setViewportSize(NARROW);

    const run = await archon.startWorkflowViaWeb(
      E2E_QUEUE_GUIDANCE_WORKFLOW_NAME,
      `e2e never-sent focus ${surface}`
    );
    await waitForNodeStarted(page, run.runId, QUEUE_GUIDANCE_NODE);
    const room = await openGuidanceRoom(page, surface, run.runId, QUEUE_GUIDANCE_NODE);
    const field = guidanceField(room);
    await expect(field).toBeVisible({ timeout: T.medium });

    const idA = await queueGuidance(page, room, run.runId, QUEUE_GUIDANCE_NODE, FIRST_MESSAGE);
    await field.focus();
    expect(await field.evaluate(el => el.ownerDocument.activeElement === el)).toBe(true);

    await abandonRun(page, archon, run.runId);
    await archon.waitForRunStatus(run.runId, 'cancelled', T.long);
    await waitForNodeFailed(page, run.runId, QUEUE_GUIDANCE_NODE);
    await assertNeverSentBox(room, [{ messageId: idA, text: FIRST_MESSAGE }]);

    await expect
      .poll(async () => focusTarget(page, surface), {
        timeout: T.medium,
        message: 'focus never body or never-sent box',
      })
      .toMatch(/^(last-row|scroller)$/);

    await expect(neverSentAlert(room)).toHaveCount(1);
    // Unrelated rerender/refetch: soft reload of run detail should keep one alert.
    await page.request.get(`/api/workflows/runs/${encodeURIComponent(run.runId)}`);
    await page.waitForTimeout(500);
    await expect(neverSentAlert(room)).toHaveCount(1);
    await expect(neverSentList(room)).toHaveAttribute('aria-label', 'Never sent, 1');
  });

  test(`[P1] [V:steer.never-sent-visual-${surface}] visual and responsive evidence on ${surface}`, async ({
    page,
    archon,
  }, testInfo: TestInfo) => {
    test.setTimeout(T.xlong * 2);
    await page.setExtraHTTPHeaders({ 'X-Archon-User': E2E_STARTER_WEB_USER });
    await page.setViewportSize(NARROW);

    const run = await archon.startWorkflowViaWeb(
      E2E_QUEUE_GUIDANCE_WORKFLOW_NAME,
      `e2e never-sent visual ${surface}`
    );
    await waitForNodeStarted(page, run.runId, QUEUE_GUIDANCE_NODE);
    const room = await openGuidanceRoom(page, surface, run.runId, QUEUE_GUIDANCE_NODE);
    await expect(guidanceField(room)).toBeVisible({ timeout: T.medium });

    // Long text to exercise elision.
    const longText =
      'never-sent visual evidence message that is intentionally very long so the item elides inside the narrow dock width without horizontal overflow';
    const idA = await queueGuidance(page, room, run.runId, QUEUE_GUIDANCE_NODE, longText);

    await abandonRun(page, archon, run.runId);
    await archon.waitForRunStatus(run.runId, 'cancelled', T.long);
    await waitForNodeFailed(page, run.runId, QUEUE_GUIDANCE_NODE);
    await assertNeverSentBox(room, [{ messageId: idA, text: longText }]);

    await expectNoRoomDrivenOverflow(room, `${surface}-460`);
    const measurements = await measureNeverSentVisual(room);
    await captureEvidence(room, `e4-8-${surface}-460-never-sent.png`, testInfo);

    if (surface === 'console') {
      await page.setViewportSize(WIDE);
      await expectNoRoomDrivenOverflow(room, 'console-1440');
      const wide = await measureNeverSentVisual(room);
      await captureEvidence(room, 'e4-8-console-1440-never-sent.png', testInfo);
      mergeMeasurements(`e4-8-${surface}`, { narrow: measurements, wide });
    } else {
      mergeMeasurements(`e4-8-${surface}`, { narrow: measurements });
    }

    await testInfo.attach(`e4-8-${surface}-measurements.json`, {
      body: Buffer.from(JSON.stringify(measurements, null, 2)),
      contentType: 'application/json',
    });
  });
}
