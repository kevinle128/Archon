import type { Locator, Page, TestInfo } from '@playwright/test';

import {
  E2E_QUEUE_GUIDANCE_WORKFLOW_NAME,
  QUEUE_GUIDANCE_NODE,
} from '../lib/playwright/archon-runtime';
import {
  createIdentityContext,
  openLegacyRunDetail,
  openRunDetail,
} from '../lib/playwright/run-detail';
import { test, expect } from '../lib/playwright/suite';
import { T } from '../lib/playwright/timeouts';

/**
 * Cross-shell steering sub-state recovery: one shell stops a running turn,
 * a DIFFERENT shell redirects it, and both must show the resumed turn
 * (Stop control, "agent generating" status) within a bounded window — not
 * just eventually. Each shell's local optimistic update only covers the
 * action it took itself; an observer that did not cause the transition has
 * to learn it from the server, and only a channel that is polled
 * independently of the other shell's own cadence can guarantee it without
 * depending on a lucky sample.
 */

const AGENT_GENERATING = 'agent generating';
const AGENT_IDLE = 'agent idle · Send now delivers';
const RECOVERY_BUDGET_MS = 2_000;

// delayMs keeps the redirect turn's own generating window open long enough to
// observe (both shells must show Stop within RECOVERY_BUDGET_MS of it
// starting) — too short and the node can complete before either shell polls.
const REDIRECT_SCENARIO = '{"echoPrompt":true,"delayMs":6000}';
const REDIRECT_TEXT = `<<E2E_SCENARIO>>${REDIRECT_SCENARIO}<</E2E_SCENARIO>>cross-shell redirect`;

function roomRegion(page: Page, nodeId: string): Locator {
  return page.getByRole('region', { name: `${nodeId} room` });
}

async function openGuidanceRoom(
  page: Page,
  surface: 'console' | 'legacy',
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

function sendPathname(runId: string, nodeId: string): string {
  return `/api/workflows/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}/send`;
}

function guidanceField(room: Locator): Locator {
  return room.getByRole('textbox', { name: /^message to / });
}

function stopButton(room: Locator): Locator {
  return room.getByRole('button', { name: /^(Stop|Stopping…)$/ });
}

function sendNowButton(room: Locator): Locator {
  return room.getByRole('button', { name: /^Send now/ });
}

/** The polite live region inside the dock well. */
function dockStatus(room: Locator): Locator {
  return room.locator('[role="status"]');
}

/** Elapsed ms from `since` until `locator` is visible, bounded by `timeoutMs`. */
async function elapsedUntilVisible(
  locator: Locator,
  since: number,
  timeoutMs: number
): Promise<number> {
  await expect(locator).toBeVisible({ timeout: timeoutMs });
  return Date.now() - since;
}

test('[P1] [V:steer.cross-shell-recovery] Legacy Stop then Console Send now recovers both shells within budget', async ({
  browser,
  archon,
}, testInfo: TestInfo) => {
  test.setTimeout(T.xlong);
  const ctx = await createIdentityContext(browser, archon.baseURL, 'starter');
  const legacyPage = await ctx.newPage();
  const consolePage = await ctx.newPage();

  try {
    const run = await archon.startWorkflowViaWeb(
      E2E_QUEUE_GUIDANCE_WORKFLOW_NAME,
      'e2e cross-shell recovery'
    );

    const legacyRoom = await openGuidanceRoom(legacyPage, 'legacy', run.runId, QUEUE_GUIDANCE_NODE);
    const consoleRoom = await openGuidanceRoom(
      consolePage,
      'console',
      run.runId,
      QUEUE_GUIDANCE_NODE
    );

    await expect(stopButton(legacyRoom)).toBeVisible({ timeout: T.medium });
    await expect(stopButton(consoleRoom)).toBeVisible({ timeout: T.medium });

    // Legacy stops the turn. Both shells observe idle-after-interrupt —
    // Legacy from its own response, Console from the server's
    // node_turn_interrupted event plus its own queue poll.
    await stopButton(legacyRoom).click();
    await expect(sendNowButton(legacyRoom)).toBeVisible({ timeout: T.medium });
    await expect(dockStatus(legacyRoom)).toContainText(AGENT_IDLE);
    await expect(sendNowButton(consoleRoom)).toBeVisible({ timeout: T.medium });
    await expect(dockStatus(consoleRoom)).toContainText(AGENT_IDLE);

    // Console redirects — a DIFFERENT shell than the one that stopped it,
    // exactly the cross-shell dispatch VQ5-1 covers. The clock for the
    // recovery budget starts once the send_now POST actually resolves — the
    // moment the real server-side transition happens — not at the click,
    // which would also count the round trip of Console's own request
    // against the observer's budget.
    await guidanceField(consoleRoom).fill(REDIRECT_TEXT);
    const sendNowResponse = consolePage.waitForResponse(
      res => new URL(res.url()).pathname === sendPathname(run.runId, QUEUE_GUIDANCE_NODE)
    );
    await sendNowButton(consoleRoom).click();
    expect((await sendNowResponse).status()).toBe(200);
    const since = Date.now();

    // Console (the sender) recovers from its own local response — already
    // resolved by the time the response above landed, not what this test is
    // proving.
    const consoleElapsedMs = await elapsedUntilVisible(stopButton(consoleRoom), since, T.short);
    // Legacy (the observer of a transition it did not cause) has no local
    // optimistic update for this — it can only learn from the server. This
    // is the actual fix under test: the dock's own queue poll reconciles
    // sub-state on every accepted snapshot, not only when a separate,
    // slower poll happens to sample a changed value.
    const legacyElapsedMs = await elapsedUntilVisible(
      stopButton(legacyRoom),
      since,
      RECOVERY_BUDGET_MS
    );

    await expect(dockStatus(legacyRoom)).toContainText(AGENT_GENERATING);
    await expect(dockStatus(consoleRoom)).toContainText(AGENT_GENERATING);
    await expect(sendNowButton(legacyRoom)).toHaveCount(0);
    await expect(sendNowButton(consoleRoom)).toHaveCount(0);

    await testInfo.attach('cross-shell-recovery-timing.json', {
      body: Buffer.from(
        `${JSON.stringify(
          { runId: run.runId, consoleElapsedMs, legacyElapsedMs, budgetMs: RECOVERY_BUDGET_MS },
          null,
          2
        )}\n`
      ),
      contentType: 'application/json',
    });
  } finally {
    await legacyPage.close().catch(() => undefined);
    await consolePage.close().catch(() => undefined);
    await ctx.close().catch(() => undefined);
  }
});
