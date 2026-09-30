import { rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

import { type Locator, type Page } from '@playwright/test';

import { test, expect } from '../lib/playwright/suite';
import {
  E2E_SOFT_INJECT_LATE_WORKFLOW_NAME,
  E2E_SOFT_INJECT_WORKFLOW_NAME,
  E2E_STARTER_WEB_USER,
  SOFT_INJECT_NODE,
  softInjectReleasePath,
} from '../lib/playwright/archon-runtime';
import {
  getRunDetail,
  listNodeMessages,
  openLegacyRunDetail,
  openRunDetail,
} from '../lib/playwright/run-detail';
import { T } from '../lib/playwright/timeouts';

/**
 * Per-item Send now delivers one queued message into the live turn without
 * Stop. The `e2e-soft-inject` fixture runs a node on the soft-injectable fake
 * provider behind a bounded wait: a message handed to the live turn during the
 * wait is echoed by id and answered when the wait ends, inside the same turn.
 * The default `e2e-fake` provider stays queue-only, so no other spec sees a
 * per-item Send now control.
 */

type Surface = 'console' | 'legacy';

const INJECTED_REPLY_PREFIX = '[e2e-fake] soft-injected:';

function roomRegion(page: Page, nodeId: string): Locator {
  return page.getByRole('region', { name: `${nodeId} room` });
}

async function openRoom(
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

function queueList(room: Locator): Locator {
  return room.getByRole('list', { name: /^Queued messages/ });
}

async function queueMessage(room: Locator, text: string): Promise<void> {
  const field = room.getByRole('textbox', { name: /^message to / });
  await field.fill(text);
  await room.getByRole('button', { name: /^Queue/ }).click();
}

/** Polls the run-detail API until the node's `node_started` event exists. */
async function waitForNodeStarted(page: Page, runId: string, nodeId: string): Promise<void> {
  const deadline = Date.now() + T.long;
  while (Date.now() < deadline) {
    const detail = await getRunDetail(page, runId);
    if (
      detail.events.some(event => event.event_type === 'node_started' && event.step_name === nodeId)
    ) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`node ${nodeId} in run ${runId} never reached node_started`);
}

for (const surface of ['console', 'legacy'] as const) {
  test(`[P1] [V:steer.soft-inject-${surface}] per-item Send now delivers one queued message into the live turn on ${surface}`, async ({
    page,
    archon,
  }) => {
    test.setTimeout(T.xlong * 2);
    await page.setExtraHTTPHeaders({ 'X-Archon-User': E2E_STARTER_WEB_USER });
    const tag = randomUUID().replace(/-/g, '').slice(0, 10);
    const stayText = `ONE-${tag} keep this queued`;
    const injectText = `TWO-${tag} take the left fork`;

    // The node stays open until this marker is written (or its 30s ceiling
    // elapses); clear any marker a prior run left behind.
    const releasePath = softInjectReleasePath(archon.home);
    rmSync(releasePath, { force: true });

    const run = await archon.startWorkflowViaWeb(E2E_SOFT_INJECT_WORKFLOW_NAME, 'e2e soft inject');
    const room = await openRoom(page, surface, run.runId, SOFT_INJECT_NODE);
    await waitForNodeStarted(page, run.runId, SOFT_INJECT_NODE);
    const items = queueList(room).getByRole('listitem');

    await test.step('two queued items each offer Send now and delete while the agent generates', async () => {
      await queueMessage(room, stayText);
      await queueMessage(room, injectText);
      await expect(room.getByText('queued · 2')).toBeVisible();
      await expect(items).toHaveCount(2);
      await expect(room.getByRole('button', { name: /^Send now ·/ })).toHaveCount(2);
      await expect(room.getByRole('button', { name: /^delete ·/ })).toHaveCount(2);
      await expect(room.getByRole('button', { name: 'Stop' })).toBeVisible();
    });

    await test.step('Send now on the second item moves only that item into the turn', async () => {
      const sendPath = `/api/workflows/runs/${encodeURIComponent(run.runId)}/nodes/${encodeURIComponent(SOFT_INJECT_NODE)}/send`;
      const response = page.waitForResponse(
        res => res.request().method() === 'POST' && new URL(res.url()).pathname === sendPath
      );
      await room.getByRole('button', { name: `Send now · ${injectText}` }).click();
      const resolved = await response;
      expect(resolved.status()).toBe(200);
      expect(((await resolved.json()) as { state: string }).state).toBe('sent');

      // The other item stays queued and claimable; the agent is never stopped.
      await expect(room.getByText('queued · 1')).toBeVisible();
      await expect(items.filter({ hasText: stayText })).toHaveCount(1);
      await expect(room.getByRole('button', { name: `Send now · ${stayText}` })).toBeVisible();
      await expect(room.getByRole('button', { name: 'Stop' })).toBeVisible();
      await expect(room.getByText(/interrupted/i)).toHaveCount(0);

      // The model has not read it yet: it stays in the dock as in flight and
      // has no transcript row, so it can never sit above the running tool.
      const injectedItem = items.filter({ hasText: injectText });
      await expect(injectedItem).toHaveCount(1);
      await expect(injectedItem).toContainText('sending…');
      await expect(room.locator('[data-operator-row]', { hasText: injectText })).toHaveCount(0);
    });

    await test.step('the echo delivers it; the node completes with no second turn for the injection', async () => {
      mkdirSync(dirname(releasePath), { recursive: true });
      writeFileSync(releasePath, '');
      const operatorRow = room.locator('[data-operator-row]', { hasText: injectText });
      await expect(operatorRow).toHaveCount(1, { timeout: T.long });
      await expect(operatorRow.locator('[data-operator-delivery]')).toHaveText('delivered');
      await archon.waitForRunStatus(run.runId, 'completed', T.xlong);

      const messages = await listNodeMessages(page, run.runId, SOFT_INJECT_NODE);
      const operatorRows = messages.filter(
        message => message.kind === 'text' && message.metadata?.origin === 'operator'
      );
      const injectedRow = operatorRows.find(row => row.payload.text === injectText);
      const stayRow = operatorRows.find(row => row.payload.text === stayText);
      expect(injectedRow, 'the injected message is an operator row').toBeTruthy();
      expect(stayRow, 'the item left queued drains as its own later turn').toBeTruthy();
      // The injected row precedes the drained one, and the model answered it
      // inside the turn that was already running.
      expect(injectedRow!.seq).toBeLessThan(stayRow!.seq);
      const replyRow = messages.find(
        message =>
          message.kind === 'text' &&
          message.payload.text === `${INJECTED_REPLY_PREFIX} ${injectText}`
      );
      expect(replyRow, 'the running turn answered the injected message').toBeTruthy();
      expect(replyRow!.seq).toBeLessThan(stayRow!.seq);
      // The operator row sits after the tool that was running, never above it.
      const lastToolSeq = Math.max(
        ...messages.filter(message => message.kind === 'tool').map(message => message.seq)
      );
      expect(injectedRow!.seq).toBeGreaterThan(lastToolSeq);
      expect(replyRow!.metadata?.execution?.attempt_id).toBe(
        injectedRow!.metadata?.execution?.attempt_id
      );

      const detail = await getRunDetail(page, run.runId);
      expect(
        detail.events.filter(
          event => event.event_type === 'node_started' && event.step_name === SOFT_INJECT_NODE
        )
      ).toHaveLength(1);

      // Nothing the operator sent is reported as never sent.
      await expect(room.getByText(/never sent|none of this was sent/i)).toHaveCount(0);
    });
  });
}

for (const surface of ['console', 'legacy'] as const) {
  test(`[P1] [V:steer.soft-inject-late-${surface}] a message the transport dropped returns to the queue and drains on ${surface}`, async ({
    page,
    archon,
  }) => {
    test.setTimeout(T.xlong * 2);
    await page.setExtraHTTPHeaders({ 'X-Archon-User': E2E_STARTER_WEB_USER });
    const tag = randomUUID().replace(/-/g, '').slice(0, 10);
    const lateText = `LATE-${tag} sent after the last step`;
    const releasePath = softInjectReleasePath(archon.home);
    rmSync(releasePath, { force: true });

    const run = await archon.startWorkflowViaWeb(E2E_SOFT_INJECT_LATE_WORKFLOW_NAME, 'e2e late');
    const room = await openRoom(page, surface, run.runId, SOFT_INJECT_NODE);
    await waitForNodeStarted(page, run.runId, SOFT_INJECT_NODE);
    await queueMessage(room, lateText);
    await expect(room.getByText('queued · 1')).toBeVisible();
    await room.getByRole('button', { name: `Send now · ${lateText}` }).click();
    await expect(room.getByText('queued · 0')).toBeHidden();

    // The turn ends without the transport ever echoing the message.
    mkdirSync(dirname(releasePath), { recursive: true });
    writeFileSync(releasePath, '');
    await archon.waitForRunStatus(run.runId, 'completed', T.xlong);

    const messages = await listNodeMessages(page, run.runId, SOFT_INJECT_NODE);
    const rows = messages.filter(
      message =>
        message.kind === 'text' &&
        message.metadata?.origin === 'operator' &&
        message.payload.text === lateText
    );
    expect(rows, 'delivered once, by the normal drain').toHaveLength(1);
    await expect(room.getByText(/never sent|none of this was sent/i)).toHaveCount(0);
    await expect(room.locator('[role="alert"]')).toHaveCount(0);
  });
}
