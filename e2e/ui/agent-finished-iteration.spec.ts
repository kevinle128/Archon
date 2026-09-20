import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  type Locator,
  type Page,
  type Request,
  type Response,
  type TestInfo,
} from '@playwright/test';

import { test, expect } from '../lib/playwright/suite';
import {
  E2E_QUEUE_GUIDANCE_LOOP_WORKFLOW_NAME,
  QUEUE_GUIDANCE_LOOP_NODE,
} from '../lib/playwright/archon-runtime';
import { getRunDetail, openLegacyRunDetail, openRunDetail } from '../lib/playwright/run-detail';
import { T } from '../lib/playwright/timeouts';

/**
 * Story 2.10 / issue #190 — a finished loop occurrence stays read-only while
 * its later same-lineage occurrence is live. The real executor supplies the
 * occurrence rows; this spec only fakes the provider, as every queue E2E does.
 */

type Surface = 'legacy' | 'console';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EVIDENCE_DIR = join(REPO_ROOT, 'plans', 'reports', 'evidence', 'issue-190');
const NARROW = { width: 460, height: 900 } as const;
const WIDE = { width: 1440, height: 900 } as const;
const SEND_HINT = 'Cmd/Ctrl+Enter to send · this tab only';

function queuePathname(runId: string, nodeId: string): string {
  return `/api/workflows/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}/queue`;
}

function sendPathname(runId: string, nodeId: string): string {
  return `/api/workflows/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}/send`;
}

function roomRegion(page: Page, nodeId: string): Locator {
  return page.getByRole('region', { name: `${nodeId} room` });
}

function guidanceField(room: Locator): Locator {
  return room.getByRole('textbox', { name: /^message to / });
}

function queueList(room: Locator): Locator {
  return room.getByRole('list', { name: /^Queued messages/ });
}

function executionSelect(page: Page): Locator {
  return page.getByLabel('Execution', { exact: true });
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

async function executionRowId(page: Page, iteration: number): Promise<string> {
  const select = executionSelect(page);
  await expect(select).toBeVisible({ timeout: T.medium });
  const options = await select
    .locator('option')
    .evaluateAll(nodes =>
      nodes.map(node => ({ text: node.textContent ?? '', value: node.getAttribute('value') }))
    );
  const rowId = options.find(option =>
    option.text.includes(`Iteration ${String(iteration)}`)
  )?.value;
  expect(rowId, `Execution option for iteration ${String(iteration)}`).toBeTruthy();
  return rowId ?? '';
}

async function selectExecution(page: Page, iteration: number): Promise<void> {
  await executionSelect(page).selectOption(await executionRowId(page, iteration));
}

async function expectSelectedIteration(page: Page, iteration: number): Promise<void> {
  await expect
    .poll(async () => executionSelect(page).locator('option:checked').textContent(), {
      timeout: T.medium,
      message: `Execution selects iteration ${String(iteration)}`,
    })
    .toContain(`Iteration ${String(iteration)}`);
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

async function queueGuidance(
  page: Page,
  room: Locator,
  runId: string,
  nodeId: string,
  message: string
): Promise<void> {
  const sent = page.waitForResponse(
    response =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === sendPathname(runId, nodeId)
  );
  const field = guidanceField(room);
  await field.fill(message);
  await field.press('Meta+Enter');
  expect((await sent).status()).toBe(200);
}

function trackFinishedViewRequests(
  page: Page,
  runId: string,
  nodeId: string
): { getSuccesses: () => number; mutations: () => number; dispose: () => void } {
  const queuePath = queuePathname(runId, nodeId);
  const sendPath = sendPathname(runId, nodeId);
  const queueDeletePrefix = `${queuePath}/`;
  let getSuccesses = 0;
  let mutations = 0;

  const requestListener = (request: Request): void => {
    const path = new URL(request.url()).pathname;
    if (
      (request.method() === 'POST' && path === sendPath) ||
      (request.method() === 'DELETE' && path.startsWith(queueDeletePrefix)) ||
      (request.method() === 'POST' && /\/interrupt$/.test(path))
    ) {
      mutations += 1;
    }
  };
  const responseListener = (response: Response): void => {
    if (
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname === queuePath &&
      response.status() === 200
    ) {
      getSuccesses += 1;
    }
  };

  page.on('request', requestListener);
  page.on('response', responseListener);
  return {
    getSuccesses: () => getSuccesses,
    mutations: () => mutations,
    dispose: (): void => {
      page.off('request', requestListener);
      page.off('response', responseListener);
    },
  };
}

interface FinishedDockMeasurements {
  noPageOverflow: boolean;
  noRoomOverflow: boolean;
  goFullyVisible: boolean;
  goHeight: number;
  disclosureWraps: boolean;
  bandFullWidth: boolean;
  bandHas33vhCap: boolean;
  bandMaxHeight: string;
}

async function assertFinishedDockVisualContract(
  page: Page,
  room: Locator,
  iteration: number,
  viewport: { width: number; height: number }
): Promise<FinishedDockMeasurements> {
  await page.setViewportSize(viewport);
  const disclosure = room.getByText(
    `reading a finished iteration · the agent is working in iteration ${String(iteration)}`,
    { exact: true }
  );
  const go = room.getByRole('button', {
    name: `Go to iteration ${String(iteration)}`,
    exact: true,
  });
  const list = queueList(room);
  await expect(disclosure).toBeVisible({ timeout: T.medium });
  await expect(go).toBeVisible();
  await expect(list).toBeVisible();

  const facts = await room.evaluate(
    (roomEl, label) => {
      const disclosureEl = Array.from(roomEl.querySelectorAll('p')).find(
        element => element.textContent === label
      );
      const goButton = Array.from(roomEl.querySelectorAll('button')).find(element =>
        element.textContent?.startsWith('Go to iteration ')
      );
      const listEl = roomEl.querySelector('ul[aria-label^="Queued messages"]');
      const wrapper = listEl?.parentElement ?? null;
      const band = wrapper?.parentElement ?? null;
      const roomRect = roomEl.getBoundingClientRect();
      const goRect = goButton?.getBoundingClientRect();
      const disclosureRect = disclosureEl?.getBoundingClientRect();
      const bandRect = band?.getBoundingClientRect();
      const style = wrapper === null ? null : getComputedStyle(wrapper);
      return {
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        roomOverflow: roomEl.scrollWidth - roomEl.clientWidth,
        goFullyVisible:
          goRect !== undefined &&
          goRect.left >= 0 &&
          goRect.right <= document.documentElement.clientWidth &&
          goRect.bottom <= document.documentElement.clientHeight,
        goHeight: goRect?.height ?? 0,
        disclosureWraps:
          disclosureRect !== undefined &&
          disclosureEl !== undefined &&
          disclosureEl.scrollHeight > disclosureEl.clientHeight,
        bandFullWidth:
          bandRect !== undefined &&
          Math.abs(bandRect.left - roomRect.left) <= 1 &&
          Math.abs(bandRect.right - roomRect.right) <= 1,
        bandHas33vhCap: wrapper?.className.includes('max-h-[33vh]') ?? false,
        bandMaxHeight: style?.maxHeight ?? '',
      };
    },
    `reading a finished iteration · the agent is working in iteration ${String(iteration)}`
  );

  expect(facts.pageOverflow, 'page has no horizontal overflow').toBeLessThanOrEqual(1);
  expect(facts.roomOverflow, 'room has no horizontal overflow').toBeLessThanOrEqual(1);
  expect(facts.goFullyVisible, 'Go remains fully visible').toBe(true);
  expect(facts.goHeight, 'Go remains at least 32px high').toBeGreaterThanOrEqual(32);
  expect(facts.bandFullWidth, 'queue band spans the room').toBe(true);
  expect(facts.bandHas33vhCap, 'queue band retains max-h-[33vh]').toBe(true);
  return {
    noPageOverflow: facts.pageOverflow <= 1,
    noRoomOverflow: facts.roomOverflow <= 1,
    goFullyVisible: facts.goFullyVisible,
    goHeight: facts.goHeight,
    disclosureWraps: facts.disclosureWraps,
    bandFullWidth: facts.bandFullWidth,
    bandHas33vhCap: facts.bandHas33vhCap,
    bandMaxHeight: facts.bandMaxHeight,
  };
}

async function captureEvidence(target: Locator, name: string, testInfo: TestInfo): Promise<void> {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const screenshot = await target.screenshot({ path: join(EVIDENCE_DIR, name) });
  await testInfo.attach(name, { body: screenshot, contentType: 'image/png' });
}

for (const surface of ['legacy', 'console'] as const) {
  test(`[P1] [V:steer.finished-iteration-${surface}] finished iteration stays GET-only on ${surface}`, async ({
    page,
    archon,
  }, testInfo: TestInfo) => {
    test.setTimeout(T.xlong * 2);
    const tag = randomUUID().replace(/-/g, '').slice(0, 12);
    const queuedMessage = `finished-iteration-${surface}-${tag}`;
    const retainedDraft = `draft-${surface}-${tag}`;
    const completionDirective = `<<E2E_SCENARIO>>{"doneWhenPromptIncludes":"done-${tag}"}<</E2E_SCENARIO>>done-${tag}`;
    const timings: Record<string, number> = {};
    const startedAt = Date.now();

    await page.setViewportSize(NARROW);
    const run = await archon.startWorkflowViaWeb(
      E2E_QUEUE_GUIDANCE_LOOP_WORKFLOW_NAME,
      `e2e finished iteration ${tag}`
    );
    await waitForLoopEvent(page, run.runId, 'loop_iteration_completed', 1);
    await waitForLoopEvent(page, run.runId, 'loop_iteration_started', 2);
    timings.iterationTwoStartedMs = Date.now() - startedAt;

    const room = await openGuidanceRoom(page, surface, run.runId, QUEUE_GUIDANCE_LOOP_NODE);
    // Legacy opens the first Logs row by default; use the ratified Execution
    // control to move to the actual live occurrence before queuing guidance.
    await selectExecution(page, 2);
    await expectSelectedIteration(page, 2);
    await queueGuidance(page, room, run.runId, QUEUE_GUIDANCE_LOOP_NODE, queuedMessage);
    await expect(room.getByText('queued · 1')).toBeVisible({ timeout: T.medium });
    await guidanceField(room).fill(retainedDraft);

    const requests = trackFinishedViewRequests(page, run.runId, QUEUE_GUIDANCE_LOOP_NODE);
    try {
      await selectExecution(page, 1);
      const disclosure = `reading a finished iteration · the agent is working in iteration 2`;
      const go = room.getByRole('button', { name: 'Go to iteration 2', exact: true });
      await expect(room.getByText(disclosure, { exact: true })).toBeVisible({ timeout: T.medium });
      await expect(go).toBeVisible();
      await expect(queueList(room)).toContainText(queuedMessage);
      await expect(queueList(room)).toContainText('sent');
      await expect(guidanceField(room)).toHaveCount(0);
      await expect(room.getByText(SEND_HINT, { exact: true })).toHaveCount(0);
      await expect(room.getByRole('button', { name: /^Queue/ })).toHaveCount(0);
      await expect(room.getByRole('button', { name: /^delete ·/ })).toHaveCount(0);
      const queueGetsBeforeFinishedView = requests.getSuccesses();
      await expect
        .poll(() => requests.getSuccesses() - queueGetsBeforeFinishedView, {
          timeout: T.medium,
          message: 'finished view receives its own successful queue GET',
        })
        .toBeGreaterThan(0);
      timings.finishedDockReadyMs = Date.now() - startedAt;

      const narrow = await assertFinishedDockVisualContract(page, room, 2, NARROW);
      await captureEvidence(room, `finished-iteration-${surface}-460.png`, testInfo);
      const wide = await assertFinishedDockVisualContract(page, room, 2, WIDE);
      await captureEvidence(room, `finished-iteration-${surface}-1440.png`, testInfo);

      await go.focus();
      await page.keyboard.press('Enter');
      await expectSelectedIteration(page, 2);
      const field = guidanceField(room);
      await expect(field).toBeVisible({ timeout: T.medium });
      await expect
        .poll(async () =>
          field.evaluate(element => element.ownerDocument.activeElement === element)
        )
        .toBe(true);
      await expect(field).toHaveValue(retainedDraft);
      await expect(queueList(room)).toContainText(queuedMessage);
      expect(
        requests.mutations(),
        'finished view invokes no send, delete, or interrupt mutation'
      ).toBe(0);
      const finishedViewMutations = requests.mutations();
      timings.returnedLiveMs = Date.now() - startedAt;

      await queueGuidance(page, room, run.runId, QUEUE_GUIDANCE_LOOP_NODE, completionDirective);
      await archon.waitForRunStatus(run.runId, 'completed', T.xlong);
      await selectExecution(page, 1);
      await expect(room.getByText(/^reading a finished iteration/)).toHaveCount(0);
      await expect(room.getByRole('button', { name: /^Go to iteration/ })).toHaveCount(0);
      timings.completedMs = Date.now() - startedAt;

      const evidence = {
        surface,
        runId: run.runId,
        queuedMessage,
        viewport: { narrow, wide },
        requestCounts: {
          successfulQueueGets: requests.getSuccesses(),
          finishedViewMutations,
          totalJourneyMutations: requests.mutations(),
        },
        timings,
      };
      mkdirSync(EVIDENCE_DIR, { recursive: true });
      const evidenceName = `finished-iteration-${surface}.json`;
      writeFileSync(join(EVIDENCE_DIR, evidenceName), `${JSON.stringify(evidence, null, 2)}\n`);
      await testInfo.attach(evidenceName, {
        body: Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`),
        contentType: 'application/json',
      });
      testInfo.annotations.push({
        type: 'timing',
        description: `${surface}: iteration 2 ${String(timings.iterationTwoStartedMs)}ms; finished dock ${String(timings.finishedDockReadyMs)}ms; live return ${String(timings.returnedLiveMs)}ms; completion ${String(timings.completedMs)}ms`,
      });
    } finally {
      requests.dispose();
    }
  });
}
