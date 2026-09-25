import { mkdirSync } from 'node:fs';
import { env } from 'node:process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type Locator, type Page, type TestInfo } from '@playwright/test';

import { test, expect } from '../lib/playwright/suite';
import {
  HITL_ASK_ANSWER_NODE,
  HITL_ASK_DECLINE_NODE,
  HITL_ASK_NODE,
  HITL_INSPECT_NODE,
  HITL_LONG_NODE,
  HITL_LOOP_NODE,
  HITL_TOOL_OUTPUT,
  UnsupportedSetupError,
  type ArchonRuntime,
  type CliRunResult,
} from '../lib/playwright/archon-runtime';
import {
  createIdentityContext,
  getRunDetail,
  listNodeMessages,
  observeNodeMessagePages,
  openLegacyRunDetail,
  openRunDetail,
  submitAskYes,
} from '../lib/playwright/run-detail';
import { T } from '../lib/playwright/timeouts';

const SPLIT_VIEWPORT = { width: 1440, height: 1000 } as const;
const LEGACY_RATIO_VIEWPORT = { width: 1280, height: 900 } as const;
const NARROW_VIEWPORT = { width: 390, height: 844 } as const;
// The room is a fixed pixel width with no drag handle
// (`packages/web/src/lib/room-split-layout.ts`). There is no user-adjustable
// ratio to persist. The room only keeps this width when the run pane is at
// least 60rem wide; a narrower pane shows it full width instead.
const FIXED_ROOM_WIDTH = 460;
const WIDTH_TOLERANCE_PX = 2;
const ROOM_MIN_WIDTH_PX = 240;
const DRAFT_OTHER = 'shared-ask-draft';

/** Current Node Room anatomy evidence directory for the long-payload Raw capture. */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOM_ANATOMY_EVIDENCE_DIR =
  env.ARCHON_VERIFY_EVIDENCE ??
  join(
    REPO_ROOT,
    'plans',
    '260925-2145-issue-266-console-legacy-room-anatomy',
    'reports',
    'evidence'
  );

async function pageWaitStarter(
  browser: Parameters<typeof createIdentityContext>[0],
  archon: { baseURL: string },
  body: (page: Page) => Promise<void>
): Promise<void> {
  const ctx = await createIdentityContext(browser, archon.baseURL, 'starter');
  const page = await ctx.newPage();
  try {
    await body(page);
  } finally {
    await ctx.close();
  }
}

function panelLocator(page: Page, id: string): Locator {
  return page.locator(`[data-panel-id="${id}"], #${id}`).first();
}

async function boxWidth(locator: Locator, label: string): Promise<number> {
  await expect(locator, label).toBeVisible({ timeout: T.medium });
  const box = await locator.boundingBox();
  expect(box, `${label} bounding box`).toBeTruthy();
  return box?.width ?? 0;
}

async function waitForRunTitle(page: Page, workflowName: string): Promise<void> {
  await expect(page.getByText(new RegExp(workflowName, 'i')).first()).toBeVisible({
    timeout: T.medium,
  });
}

function formatRecordedDuration(durationMs: number): string {
  if (durationMs < 1000) return `${String(durationMs)}ms`;
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(1)}s`;
  return `${(durationMs / 60_000).toFixed(1)}m`;
}

async function openLegacyLogRow(page: Page, nodeId: string, index = 0): Promise<void> {
  const logsTab = page.getByRole('tab', { name: 'Logs' });
  if ((await logsTab.count()) > 0) {
    await logsTab.click();
  }
  const buttons = page.getByRole('button', { name: new RegExp(nodeId) });
  await expect(buttons.nth(index)).toBeVisible({ timeout: T.medium });
  await buttons.nth(index).click();
}

async function waitForRoom(page: Page, nodeId: string): Promise<Locator> {
  const room = page.getByRole('region', { name: `${nodeId} room` });
  await expect(room).toBeVisible({ timeout: T.medium });
  return room;
}

/**
 * Story 1.3 contract for the deterministic `inspect-file` Read row, identical
 * on both surfaces: collapsed rows mount no body; opening shows the file
 * family body (path header + preview, never serialized JSON); Raw swaps the
 * body for the exact stored payload and back. Input/Output diagnostic
 * disclosures no longer exist.
 */
async function expectFileFamilyBody(row: Locator): Promise<void> {
  const body = row.locator('.tool-family-body');
  await expect(row).toHaveJSProperty('open', false);
  await expect(body).toHaveCount(0);
  await expect(row.getByText('Input', { exact: true })).toHaveCount(0);
  await expect(row.getByText('Output', { exact: true })).toHaveCount(0);

  await row.locator('summary').first().click();
  await expect(row).toHaveJSProperty('open', true);
  await expect(body).toHaveCount(1);
  await expect(body.locator('.text-node-command').first()).toHaveText('HITL_TOOL_INPUT.txt');
  await expect(body).toContainText(HITL_TOOL_OUTPUT);
  expect(await body.textContent(), 'family body is not the serialized payload').not.toContain(
    '"output"'
  );

  const raw = row.getByRole('button', { name: 'Raw' });
  const rawPanel = row.locator('pre');
  await expect(raw).toHaveAttribute('aria-expanded', 'false');
  await expect(rawPanel).toHaveCount(0);
  await raw.click();
  await expect(raw).toHaveAttribute('aria-expanded', 'true');
  await expect(body).toHaveCount(0);
  await expect(rawPanel).toHaveCount(1);
  expect(await rawPanel.textContent(), 'Raw shows the exact stored payload').toBe(
    JSON.stringify(
      { name: 'Read', input: { path: 'HITL_TOOL_INPUT.txt' }, output: HITL_TOOL_OUTPUT },
      null,
      2
    )
  );

  await raw.click();
  await expect(raw).toHaveAttribute('aria-expanded', 'false');
  await expect(rawPanel).toHaveCount(0);
  await expect(body.locator('.text-node-command').first()).toHaveText('HITL_TOOL_INPUT.txt');
  await expect(body).toContainText(HITL_TOOL_OUTPUT);
}

async function requireLongHistoryFixture(page: Page, archon: ArchonRuntime): Promise<CliRunResult> {
  try {
    const started = await archon.runHitlLongHistoryWorkflow();
    const stored = await listNodeMessages(page, started.runId, HITL_LONG_NODE);
    const ids = new Set(stored.filter(row => row.kind === 'tool').map(row => row.payload.id));
    // A short fixture cannot exercise a cursor boundary or prove a UI pagination bug.
    if (ids.size <= 100) {
      throw new UnsupportedSetupError(
        `Long-history fixture produced ${String(ids.size)} tool calls; ` +
          'the target fake provider must support repeatTool before pagination can be verified'
      );
    }
    return started;
  } catch (error) {
    if (error instanceof UnsupportedSetupError) {
      test.info().annotations.push({ type: 'verification-setup', description: 'unsupported' });
    }
    throw error;
  }
}

test('[P1] [V:hitl.legacy-room-layout] Legacy room is readable and fixed width', async ({
  page,
  archon,
}) => {
  await page.setViewportSize(LEGACY_RATIO_VIEWPORT);
  const started = await archon.runHitlWorkflow();
  await openLegacyRunDetail(page, started.runId);
  await waitForRunTitle(page, 'e2e-hitl-run');
  await openLegacyLogRow(page, HITL_INSPECT_NODE);
  const room = await waitForRoom(page, HITL_INSPECT_NODE);
  const width = await boxWidth(room, 'Legacy node room');
  expect(width, 'Legacy room must be wide enough to read tool output').toBeGreaterThan(
    ROOM_MIN_WIDTH_PX
  );
  expect(Math.abs(width - FIXED_ROOM_WIDTH)).toBeLessThanOrEqual(WIDTH_TOLERANCE_PX);
  const row = room.locator('details[data-tool-id]').first();
  // The collapsed summary names the file family; the Story 1.3 body/Raw swap
  // contract is identical on both surfaces.
  await expect(row.locator('summary [aria-label="file · Read"]')).toHaveCount(1);
  await expectFileFamilyBody(row);
});

test('[P1] [V:hitl.graph-selection] Graph selection restores the last explicit execution', async ({
  page,
  archon,
}) => {
  await page.setViewportSize(SPLIT_VIEWPORT);
  const started = await archon.runHitlWorkflow();
  await openRunDetail(page, started.runId);
  await waitForRunTitle(page, 'e2e-hitl-run');
  await openLegacyLogRow(page, HITL_LOOP_NODE, 0);
  const room = await waitForRoom(page, HITL_LOOP_NODE);
  const execution = page.getByLabel('Execution');
  await expect(execution).toBeVisible({ timeout: T.medium });
  const firstValue = await execution.locator('option').nth(0).getAttribute('value');
  expect(firstValue).toBeTruthy();
  await execution.selectOption(firstValue ?? '');
  await expect(page.getByLabel('Execution').locator('option:checked')).toHaveText(/Iteration 1/);
  await page.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('tab', { name: 'Graph' }).click();
  await page.locator(`.react-flow__node[data-id="${HITL_LOOP_NODE}"]`).click();
  const reopened = await waitForRoom(page, HITL_LOOP_NODE);
  await expect(page.getByLabel('Execution')).toHaveValue(firstValue ?? '');
  await expect(page.getByLabel('Execution').locator('option:checked')).toHaveText(/Iteration 1/);
});

test('[P1] [V:hitl.agent-history] HITL agent history shows a readable tool row with outcome', async ({
  page,
  archon,
}) => {
  await page.setViewportSize(SPLIT_VIEWPORT);
  const started = await archon.runHitlWorkflow();
  await openRunDetail(page, started.runId);
  await waitForRunTitle(page, 'e2e-hitl-run');
  await openLegacyLogRow(page, HITL_INSPECT_NODE);
  const room = await waitForRoom(page, HITL_INSPECT_NODE);
  await expect(room.getByText('ASSISTANT')).toBeVisible({ timeout: T.medium });
  const messages = await listNodeMessages(page, started.runId, HITL_INSPECT_NODE);
  const recordedTool = messages.find(
    message => message.kind === 'tool' && message.payload.output === HITL_TOOL_OUTPUT
  );
  const toolUseId =
    recordedTool !== undefined && typeof recordedTool.payload.id === 'string'
      ? recordedTool.payload.id
      : null;
  expect(toolUseId).toBeTruthy();
  const detail = await getRunDetail(page, started.runId);
  const completions = detail.events.filter(
    event =>
      event.event_type === 'tool_completed' &&
      event.step_name === HITL_INSPECT_NODE &&
      event.data.tool_call_id === toolUseId
  );
  expect(completions).toHaveLength(1);
  const recordedDuration = completions[0]?.data.duration_ms;
  expect(typeof recordedDuration).toBe('number');
  const toolRow = room.locator(`details[data-tool-id="${toolUseId ?? ''}"]`);
  const summary = room.locator(`details[data-tool-id="${toolUseId ?? ''}"] > summary`);
  await expect(summary).toBeVisible({ timeout: T.medium });
  await expect(summary).toContainText('Read');
  await expect(summary).toContainText('HITL_TOOL_INPUT.txt');
  await expect(summary).toContainText('succeeded');
  await expect(summary).toContainText(formatRecordedDuration(Number(recordedDuration)));
  await expect(summary.locator('[aria-label="file · Read"]')).toHaveCount(1);
  await expectFileFamilyBody(toolRow);
});

test('[P1] [V:hitl.execution-scope] Execution selector requests the selected scope', async ({
  page,
  archon,
}) => {
  await page.setViewportSize(SPLIT_VIEWPORT);
  const started = await archon.runHitlWorkflow();
  const observed = observeNodeMessagePages(page, started.runId, HITL_LOOP_NODE);
  try {
    await openRunDetail(page, started.runId);
    await waitForRunTitle(page, 'e2e-hitl-run');
    await openLegacyLogRow(page, HITL_LOOP_NODE, 0);
    const room = await waitForRoom(page, HITL_LOOP_NODE);
    const execution = page.getByLabel('Execution');
    const optionOne = execution.locator('option').nth(0);
    const optionTwo = execution.locator('option').nth(1);
    const valueOne = await optionOne.getAttribute('value');
    const valueTwo = await optionTwo.getAttribute('value');
    expect(valueOne).toBeTruthy();
    expect(valueTwo).toBeTruthy();
    expect(valueOne).not.toBe(valueTwo);

    await execution.selectOption(valueOne ?? '');
    await expect(page.getByLabel('Execution').locator('option:checked')).toHaveText(/Iteration 1/);
    await execution.selectOption(valueTwo ?? '');
    await expect(page.getByLabel('Execution').locator('option:checked')).toHaveText(/Iteration 2/);

    await expect
      .poll(() => {
        const ids = new Set(
          observed.records
            .map(record => record.occurrenceId)
            .filter((id): id is string => id !== null && id.length > 0)
        );
        return ids.size;
      })
      .toBeGreaterThanOrEqual(2);
  } finally {
    observed.dispose();
  }
});

test('[P1] [V:hitl.ask-draft] Ask draft survives closing and reopening the room', async ({
  browser,
  archon,
}) => {
  await pageWaitStarter(browser, archon, async page => {
    await page.setViewportSize(SPLIT_VIEWPORT);
    const started = await archon.runHitlWorkflow();
    await openRunDetail(page, started.runId);
    await waitForRunTitle(page, 'e2e-hitl-run');
    await openLegacyLogRow(page, HITL_ASK_NODE);
    const room = await waitForRoom(page, HITL_ASK_NODE);
    await room.getByLabel('Other').check();
    await room.getByLabel(/Other answer for/).fill(DRAFT_OTHER);
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(room).toHaveCount(0);

    await openLegacyLogRow(page, HITL_ASK_NODE);
    const reopened = await waitForRoom(page, HITL_ASK_NODE);
    await expect(reopened.getByLabel(/Other answer for/)).toHaveValue(DRAFT_OTHER);
  });
});

test('[P1] [V:hitl.ask-history] Answered and declined Ask records remain in place', async ({
  browser,
  archon,
}) => {
  await pageWaitStarter(browser, archon, async page => {
    await page.setViewportSize(SPLIT_VIEWPORT);
    const started = await archon.runHitlTwoAsksWorkflow();
    await openRunDetail(page, started.runId);
    await waitForRunTitle(page, 'e2e-hitl-two-asks');
    await expect(page.getByRole('button', { name: 'Awaiting input (2)' })).toBeVisible({
      timeout: T.medium,
    });
    await expect
      .poll(async () => {
        const next = await getRunDetail(page, started.runId);
        const answer = next.pending_interactions.find(
          row => row.node_id === HITL_ASK_ANSWER_NODE && row.status === 'pending'
        );
        const decline = next.pending_interactions.find(
          row => row.node_id === HITL_ASK_DECLINE_NODE && row.status === 'pending'
        );
        return Boolean(answer && decline);
      })
      .toBe(true);
    const detail = await getRunDetail(page, started.runId);
    const answerId = detail.pending_interactions.find(
      row => row.node_id === HITL_ASK_ANSWER_NODE && row.status === 'pending'
    )?.tool_use_id;
    const declineId = detail.pending_interactions.find(
      row => row.node_id === HITL_ASK_DECLINE_NODE && row.status === 'pending'
    )?.tool_use_id;
    expect(answerId).toBeTruthy();
    expect(declineId).toBeTruthy();
    if (!answerId || !declineId) throw new Error('missing two-ask request ids');
    await openLegacyLogRow(page, HITL_ASK_ANSWER_NODE);
    const pendingAnswerRoom = await waitForRoom(page, HITL_ASK_ANSWER_NODE);
    await submitAskYes(page, pendingAnswerRoom, started.runId, answerId);
    await openLegacyLogRow(page, HITL_ASK_DECLINE_NODE);
    const pendingDeclineRoom = await waitForRoom(page, HITL_ASK_DECLINE_NODE);
    await pendingDeclineRoom.getByRole('button', { name: 'Decline', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Decline this ask?' })).toBeVisible();
    await page.getByRole('button', { name: 'Decline', exact: true }).last().click();
    await expect
      .poll(async () => {
        const next = await getRunDetail(page, started.runId);
        const answered = next.pending_interactions.find(row => row.tool_use_id === answerId);
        const declined = next.pending_interactions.find(row => row.tool_use_id === declineId);
        return answered?.status !== 'pending' && declined?.status !== 'pending';
      })
      .toBe(true);
    const resolvedDetail = await getRunDetail(page, started.runId);
    expect(
      resolvedDetail.pending_interactions.find(row => row.tool_use_id === answerId)?.answer
    ).toEqual({ answers: [{ questionId: 'proceed', value: 'yes' }] });
    expect(
      resolvedDetail.pending_interactions.find(row => row.tool_use_id === declineId)?.answer
    ).toEqual({ decline: true });
    await page.reload();
    await waitForRunTitle(page, 'e2e-hitl-two-asks');

    await openLegacyLogRow(page, HITL_ASK_ANSWER_NODE);
    const answeredRoom = await waitForRoom(page, HITL_ASK_ANSWER_NODE);
    await expect(answeredRoom.getByText(/Answered/i).first()).toBeVisible({ timeout: T.medium });
    await expect(answeredRoom.getByRole('button', { name: 'Submit' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Close' }).click();
    await openLegacyLogRow(page, HITL_ASK_DECLINE_NODE);
    const declinedRoom = await waitForRoom(page, HITL_ASK_DECLINE_NODE);
    await expect(declinedRoom.getByText(/Declined/i).first()).toBeVisible({ timeout: T.medium });
    await expect(declinedRoom.getByRole('button', { name: 'Decline' })).toHaveCount(0);
  });
});

test('[P1] [V:hitl.awaiting-focus] Awaiting input focuses the matching Ask', async ({
  browser,
  archon,
}) => {
  await pageWaitStarter(browser, archon, async page => {
    await page.setViewportSize(SPLIT_VIEWPORT);
    const started = await archon.runHitlWorkflow();
    await openRunDetail(page, started.runId);
    await waitForRunTitle(page, 'e2e-hitl-run');
    const detail = await getRunDetail(page, started.runId);
    const requestId = detail.pending_interactions.find(
      row => row.node_id === HITL_ASK_NODE && row.status === 'pending'
    )?.tool_use_id;
    expect(requestId).toBeTruthy();
    await page.getByRole('button', { name: /^Awaiting input/ }).click();
    const expectedId = `run-ask-card-${encodeURIComponent(requestId ?? '')}-room`;
    await expect
      .poll(async () =>
        page.evaluate(id => {
          const active = document.activeElement;
          const card = document.getElementById(id);
          return Boolean(
            active !== null && card !== null && (active === card || card.contains(active))
          );
        }, expectedId)
      )
      .toBe(true);
  });
});

test('[P1] [V:hitl.legacy-mobile-back] Legacy narrow room restores Logs focus and Ask draft', async ({
  browser,
  archon,
}) => {
  await pageWaitStarter(browser, archon, async page => {
    await page.setViewportSize(NARROW_VIEWPORT);
    const started = await archon.runHitlWorkflow();
    await openLegacyRunDetail(page, started.runId);
    await waitForRunTitle(page, 'e2e-hitl-run');
    await openLegacyLogRow(page, HITL_ASK_NODE);
    const room = await waitForRoom(page, HITL_ASK_NODE);
    const opener = page
      .locator('button[id^="legacy-log-"]')
      .filter({ hasText: HITL_ASK_NODE })
      .first();
    const openerId = await opener.getAttribute('id');
    expect(openerId).toBeTruthy();
    await room.getByLabel('Other').check();
    await room.getByLabel(/Other answer for/).fill(DRAFT_OTHER);
    await page.getByRole('button', { name: 'Back', exact: true }).click();

    await expect(page.getByRole('tab', { name: 'Logs' })).toHaveAttribute('aria-selected', 'true');
    await expect(opener).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.id ?? ''))
      .toBe(openerId ?? '');

    await opener.dispatchEvent('click');
    const reopened = await waitForRoom(page, HITL_ASK_NODE);
    await expect(reopened.getByLabel(/Other answer for/)).toHaveValue(DRAFT_OTHER);
  });
});

test('[P1] [V:hitl.mobile-ask] Mobile Ask remains reachable', async ({ browser, archon }) => {
  await pageWaitStarter(browser, archon, async page => {
    await page.setViewportSize(NARROW_VIEWPORT);
    const started = await archon.runHitlWorkflow();
    await openRunDetail(page, started.runId, HITL_ASK_NODE);
    const room = await waitForRoom(page, HITL_ASK_NODE);
    const other = room.getByLabel('Other');
    await other.check();
    const input = room.getByLabel(/Other answer for/);
    await input.focus();
    const cardBox = await room.locator('form').first().boundingBox();
    expect(cardBox).toBeTruthy();
    const viewport = page.viewportSize();
    expect(viewport).toBeTruthy();
    if (!cardBox || !viewport) throw new Error('missing geometry');
    expect(cardBox.y).toBeGreaterThanOrEqual(0);
    expect(cardBox.y).toBeLessThan(viewport.height);
    const submit = room.getByRole('button', { name: 'Submit' });
    const submitBox = await submit.boundingBox();
    expect(submitBox).toBeTruthy();
    if (!submitBox) throw new Error('missing submit geometry');
    expect(submitBox.y + submitBox.height).toBeLessThanOrEqual(viewport.height);
  });
});

test('[P1] [V:hitl.room-deeplink] Deep-link re-entry and focus restoration work', async ({
  page,
  archon,
}) => {
  await page.setViewportSize(SPLIT_VIEWPORT);
  const started = await archon.runHitlWorkflow();
  await openRunDetail(page, started.runId);
  await waitForRunTitle(page, 'e2e-hitl-run');
  await openLegacyLogRow(page, HITL_INSPECT_NODE);
  await waitForRoom(page, HITL_INSPECT_NODE);
  const opener = page.getByRole('button', { name: new RegExp(HITL_INSPECT_NODE) }).first();
  await expect(opener).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(panelLocator(page, 'legacy-run-room')).toHaveCount(0);
  await expect(opener).toBeFocused();

  await openLegacyRunDetail(page, started.runId);
  await waitForRunTitle(page, 'e2e-hitl-run');
  await expect(panelLocator(page, 'legacy-run-room')).toHaveCount(0);

  await openRunDetail(page, started.runId, HITL_INSPECT_NODE);
  await waitForRoom(page, HITL_INSPECT_NODE);
});

test('[P1] [V:hitl.room-width-reload] Reload keeps the fixed room width', async ({
  page,
  archon,
}) => {
  // The room panel has no drag handle or user-adjustable ratio to persist
  // (packages/web/src/lib/room-split-layout.ts, LEGACY_ROOM_WIDTH_PX) — the
  // surviving proof is that a reload never corrupts the fixed width, and no
  // separator ever appears for a user to try dragging.
  await page.setViewportSize(SPLIT_VIEWPORT);
  const started = await archon.runHitlWorkflow();
  await openRunDetail(page, started.runId);
  await waitForRunTitle(page, 'e2e-hitl-run');
  await openLegacyLogRow(page, HITL_INSPECT_NODE);
  const room = await waitForRoom(page, HITL_INSPECT_NODE);
  await expect(page.getByRole('separator', { name: 'Resize node room' })).toHaveCount(0);
  const before = await boxWidth(room, 'Legacy room before reload');
  expect(Math.abs(before - FIXED_ROOM_WIDTH)).toBeLessThanOrEqual(WIDTH_TOLERANCE_PX);

  await page.reload();
  await waitForRunTitle(page, 'e2e-hitl-run');
  await openLegacyLogRow(page, HITL_INSPECT_NODE);
  const reopened = await waitForRoom(page, HITL_INSPECT_NODE);
  await expect(page.getByRole('separator', { name: 'Resize node room' })).toHaveCount(0);
  const after = await boxWidth(reopened, 'Legacy room after reload');
  expect(Math.abs(after - FIXED_ROOM_WIDTH)).toBeLessThanOrEqual(WIDTH_TOLERANCE_PX);
});

test('[P1] [V:hitl.room-fixed-width-container] Split-mode outer widths stay fixed as wide containers change', async ({
  page,
  archon,
}) => {
  const started = await archon.runHitlWorkflow();

  await page.setViewportSize(SPLIT_VIEWPORT);
  await openRunDetail(page, started.runId);
  await waitForRunTitle(page, 'e2e-hitl-run');
  await openConsoleLogRow(page, HITL_INSPECT_NODE);
  await waitForRoom(page, HITL_INSPECT_NODE);
  const consoleInitial = await expectOuterRoomGeometry(page, 'console');
  expect(consoleInitial.mode).toBe('split');

  await page.setViewportSize({ width: 1280, height: 1000 });
  await waitForRoom(page, HITL_INSPECT_NODE);
  const consoleResized = await expectOuterRoomGeometry(page, 'console');
  expect(consoleResized.mode).toBe('split');
  expect(Math.abs(consoleResized.width - consoleInitial.width)).toBeLessThanOrEqual(
    OUTER_WIDTH_TOLERANCE_PX
  );

  await page.setViewportSize(SPLIT_VIEWPORT);
  await openLegacyRunDetail(page, started.runId);
  await waitForRunTitle(page, 'e2e-hitl-run');
  await openLegacyLogRow(page, HITL_INSPECT_NODE);
  await waitForRoom(page, HITL_INSPECT_NODE);
  const legacyInitial = await expectOuterRoomGeometry(page, 'legacy');
  expect(legacyInitial.mode).toBe('split');

  await page.setViewportSize({ width: 1280, height: 1000 });
  await waitForRoom(page, HITL_INSPECT_NODE);
  const legacyResized = await expectOuterRoomGeometry(page, 'legacy');
  expect(legacyResized.mode).toBe('split');
  expect(Math.abs(legacyResized.width - legacyInitial.width)).toBeLessThanOrEqual(
    OUTER_WIDTH_TOLERANCE_PX
  );
});

test('[P1] [V:hitl.history-pagination] Complete history crosses a cursor boundary', async ({
  page,
  archon,
}) => {
  test.setTimeout(T.xlong);
  await page.setViewportSize(SPLIT_VIEWPORT);
  const started = await requireLongHistoryFixture(page, archon);
  const observed = observeNodeMessagePages(page, started.runId, HITL_LONG_NODE);
  try {
    await openRunDetail(page, started.runId);
    await waitForRunTitle(page, 'e2e-hitl-long-history');
    await openLegacyLogRow(page, HITL_LONG_NODE);
    const room = await waitForRoom(page, HITL_LONG_NODE);
    await expect
      .poll(async () => room.locator('[data-tool-id]').count(), { timeout: T.xlong })
      .toBeGreaterThan(100);
    const cursorRequests = observed.records.filter(record => record.limit !== null);
    expect(cursorRequests.length).toBeGreaterThanOrEqual(2);
    expect(cursorRequests.every(record => record.limit === '100')).toBe(true);
    expect(cursorRequests.some(record => Number(record.afterSeq ?? '0') > 0)).toBe(true);
  } finally {
    observed.dispose();
  }
});

test('[P1] [V:hitl.history-complete] Complete history renders every distinct tool call', async ({
  page,
  archon,
}, testInfo: TestInfo) => {
  test.setTimeout(T.xlong);
  await page.setViewportSize(SPLIT_VIEWPORT);
  const started = await requireLongHistoryFixture(page, archon);
  await openRunDetail(page, started.runId);
  await waitForRunTitle(page, 'e2e-hitl-long-history');
  await openLegacyLogRow(page, HITL_LONG_NODE);
  const room = await waitForRoom(page, HITL_LONG_NODE);
  await expect
    .poll(async () => room.locator('[data-tool-id]').count(), { timeout: T.xlong })
    .toBeGreaterThan(100);
  const stored = await listNodeMessages(page, started.runId, HITL_LONG_NODE);
  const storedIds = [
    ...new Set(
      stored
        .filter(row => row.kind === 'tool')
        .map(row => (typeof row.payload.id === 'string' ? row.payload.id : ''))
        .filter(id => id.length > 0)
    ),
  ].sort();
  expect(storedIds.length).toBeGreaterThan(100);
  const visibleIds = (
    await room
      .locator('[data-tool-id]')
      .evaluateAll(nodes =>
        nodes.map(node => node.getAttribute('data-tool-id') ?? '').filter(id => id.length > 0)
      )
  ).sort();
  expect(visibleIds).toEqual(storedIds);
  // The full-output action is offered on the expanded row before Raw is ever
  // opened; the fetched tail then renders readably in the normalized family
  // body, and the verbatim payload lands in Raw without sideways scroll.
  const lastRow = room.locator('details[data-tool-id]').last();
  await lastRow.locator('summary').first().click();
  const rawToggle = lastRow.getByRole('button', { name: 'Raw', exact: true });
  await expect(rawToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(lastRow.locator('pre')).toHaveCount(0);
  const viewFullOutput = lastRow.getByRole('button', { name: 'View full output' });
  await expect(viewFullOutput).toHaveCount(1);
  const detailPath =
    `/api/workflows/runs/${encodeURIComponent(started.runId)}` +
    `/nodes/${encodeURIComponent(HITL_LONG_NODE)}/messages/`;
  const detailResponse = page.waitForResponse(
    res => res.request().method() === 'GET' && new URL(res.url()).pathname.startsWith(detailPath),
    { timeout: T.medium }
  );
  await viewFullOutput.click();
  expect((await detailResponse).status()).toBe(200);
  await expect(lastRow.locator('.tool-family-body').first()).toContainText(
    '[e2e-fake] full output tail'
  );
  await rawToggle.click();
  const rawPanel = lastRow.locator('pre');
  await expect(rawPanel).toContainText('[e2e-fake] full output tail', { timeout: T.medium });
  const panelOverflow = await rawPanel.evaluate(el => el.scrollWidth - el.clientWidth);
  expect(panelOverflow, 'open Raw panel keeps its 20k payload wrapped').toBeLessThanOrEqual(1);
  const pageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(pageOverflow, 'page has no horizontal scroll with long Raw open').toBeLessThanOrEqual(1);
  mkdirSync(ROOM_ANATOMY_EVIDENCE_DIR, { recursive: true });
  const rawShot = await rawPanel.screenshot({
    path: join(ROOM_ANATOMY_EVIDENCE_DIR, 'console-long-raw-open.png'),
  });
  await testInfo.attach('console-long-raw-open.png', {
    body: rawShot,
    contentType: 'image/png',
  });
});

test('[P1] [V:hitl.legacy-navigation] Legacy navigation and timeline survive without a parent', async ({
  page,
  archon,
}) => {
  await page.setViewportSize(SPLIT_VIEWPORT);
  const started = await archon.runHitlWorkflow();
  await openLegacyRunDetail(page, started.runId);
  await waitForRunTitle(page, 'e2e-hitl-run');
  await expect(page.getByRole('tab', { name: 'Chat' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Source Control' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Terminal' })).toBeVisible();
  await page.getByRole('tab', { name: 'Chat' }).click();
  await expect(page.getByRole('form', { name: 'Run conversation composer' })).toBeVisible();
  await expect(
    page.getByPlaceholder('This run has no parent conversation, so replies cannot be delivered.')
  ).toBeVisible();
  await expect(page.getByText(/inspect-file|ask-starter|inspect-twice/).first()).toBeVisible({
    timeout: T.medium,
  });
});

test('[P1] [V:hitl.reply-parent-unavailable] Run chat reply disabled when parent unavailable', async ({
  page,
  archon,
}) => {
  await page.setViewportSize(SPLIT_VIEWPORT);
  const started = await archon.runHitlWorkflow();
  await openRunDetail(page, started.runId);
  await waitForRunTitle(page, 'e2e-hitl-run');
  await page.getByRole('tab', { name: 'Chat' }).click();
  await expect(page.getByRole('form', { name: 'Run conversation composer' })).toBeVisible();
  const sendButton = page.getByRole('button', { name: 'Send' });
  await expect(sendButton).toBeDisabled();
  await expect(
    page.getByPlaceholder('This run has no parent conversation, so replies cannot be delivered.')
  ).toBeVisible();
});

test('[P1] [V:hitl.reply-parent] Run chat reply posts to the exact parent web conversation', async ({
  browser,
  archon,
}) => {
  await pageWaitStarter(browser, archon, async page => {
    await page.setViewportSize(SPLIT_VIEWPORT);
    const webRun = await archon.runHitlWorkflowViaWeb();
    const posts: string[] = [];
    page.on('request', request => {
      if (request.method() !== 'POST') return;
      posts.push(new URL(request.url()).pathname);
    });
    await openRunDetail(page, webRun.runId);
    await waitForRunTitle(page, 'e2e-hitl-run');
    await page.getByRole('tab', { name: 'Chat' }).click();
    await page.getByLabel('Message the run conversation').fill('parent-reply-from-room-spec');
    await page.getByRole('button', { name: 'Send' }).click();
    const expected = `/api/conversations/${encodeURIComponent(webRun.conversationId)}/message`;
    await expect.poll(() => posts.includes(expected)).toBe(true);
    expect(posts.includes('/api/conversations')).toBe(false);
  });
});

/**
 * The document must never become the scroller for a Legacy run room: the root
 * keeps scrollTop 0 and no more than 2px of scroll slack while the transcript
 * scroller owns all vertical overflow.
 */
async function expectDocumentContained(page: Page, label: string): Promise<void> {
  const metrics = await page.evaluate(() => {
    const clientHeight = document.documentElement.clientHeight;
    const offenders = Array.from(document.querySelectorAll('*'))
      .map(el => {
        const rect = el.getBoundingClientRect();
        return { el, bottom: rect.bottom, top: rect.top, height: rect.height };
      })
      .filter(entry => entry.bottom > clientHeight + 2 || entry.top < -2)
      .sort((a, b) => b.bottom - a.bottom)
      .slice(0, 12)
      .map(entry => {
        const el = entry.el as HTMLElement;
        const cls = (el.getAttribute('class') ?? '').slice(0, 80);
        const id = el.id ? `#${el.id}` : '';
        const testid = el.getAttribute('data-testid') ?? '';
        const inRoom = el.closest('#legacy-run-room') !== null;
        const inView = el.closest('#legacy-run-view') !== null;
        const scope = inRoom ? 'room' : inView ? 'view' : 'document';
        return `${scope}:${el.tagName}${id}${testid ? `[${testid}]` : ''}.${cls.split(' ').join('.')} top=${String(Math.round(entry.top))} bottom=${String(Math.round(entry.bottom))} h=${String(Math.round(entry.height))}`;
      });
    const measure = (selector: string): string => {
      const el = document.querySelector(selector) as HTMLElement | null;
      if (el === null) return `${selector}=missing`;
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return `${selector} top=${String(Math.round(r.top))} h=${String(Math.round(r.height))} sh=${String(el.scrollHeight)} ch=${String(el.clientHeight)} ov=${style.overflowY}`;
    };
    const chain = [
      measure('html'),
      measure('body'),
      measure('#legacy-run-room'),
      measure('#legacy-run-room > div'),
      measure('[data-testid="node-transcript-scroll"]'),
    ];
    return {
      scrollTop: document.scrollingElement?.scrollTop ?? Number.NaN,
      slack: document.documentElement.scrollHeight - clientHeight,
      slackX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      offenders,
      chain,
    };
  });
  expect(metrics.scrollTop, `${label}: document scroll position`).toBe(0);
  expect(
    metrics.slack,
    `${label}: root scroll height slack; chain: ${metrics.chain.join(' | ')}; offenders: ${metrics.offenders.join(' | ')}`
  ).toBeLessThanOrEqual(2);
  expect(metrics.slackX, `${label}: root scroll width slack`).toBeLessThanOrEqual(2);
}

/**
 * Every direct `sr-only` status label must stay inside the geometry of its own
 * visible summary; an escaped absolutely positioned label stretches the root
 * scroll height below the fixed run shell.
 */
async function expectStatusLabelsInsideSummaries(room: Locator): Promise<void> {
  const escaped = await room.locator('details[data-tool-id] > summary > .sr-only').evaluateAll(
    labels =>
      labels.filter(label => {
        const summary = label.parentElement;
        if (summary === null) return true;
        const labelBox = label.getBoundingClientRect();
        const summaryBox = summary.getBoundingClientRect();
        return (
          labelBox.top < summaryBox.top - 1 ||
          labelBox.bottom > summaryBox.bottom + 1 ||
          labelBox.left < summaryBox.left - 1 ||
          labelBox.right > summaryBox.right + 1
        );
      }).length
  );
  expect(escaped, 'sr-only status labels escape their visible summary').toBe(0);
}

async function wheelOver(locator: Locator, page: Page, deltaY: number): Promise<void> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('missing wheel target geometry');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, deltaY);
}

/**
 * Home/End must target the transcript scroller. After wheel/mouse moves,
 * `page.keyboard.press` can hit a stale page focus and leave the scroller
 * unmoved (CI saw 500–1000px remaining after a 10s poll).
 */
async function pressScrollerEdge(scroller: Locator, key: 'Home' | 'End'): Promise<void> {
  const remaining =
    key === 'Home'
      ? async (): Promise<number> => scroller.evaluate(el => el.scrollTop)
      : async (): Promise<number> =>
          scroller.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight);
  await scroller.press(key);
  try {
    await expect.poll(remaining, { timeout: 3_000 }).toBeLessThanOrEqual(2);
  } catch {
    await scroller.press(key);
    await expect.poll(remaining).toBeLessThanOrEqual(2);
  }
}

test('[P1] [V:transcript-display.legacy-scroll-desktop] Legacy long-history room keeps the document fixed', async ({
  page,
  archon,
}) => {
  test.setTimeout(T.xlong);
  await page.setViewportSize(SPLIT_VIEWPORT);
  const started = await requireLongHistoryFixture(page, archon);
  await openLegacyRunDetail(page, started.runId);
  await waitForRunTitle(page, 'e2e-hitl-long-history');
  await openLegacyLogRow(page, HITL_LONG_NODE);
  const room = await waitForRoom(page, HITL_LONG_NODE);
  await expect
    .poll(async () => room.locator('[data-tool-id]').count(), { timeout: T.xlong })
    .toBeGreaterThan(100);

  const scroller = room.getByTestId('node-transcript-scroll');
  await expect(scroller).toBeVisible();
  expect(
    await scroller.evaluate(el => el.scrollHeight - el.clientHeight),
    'long transcript overflows its own scroll owner'
  ).toBeGreaterThan(0);
  await expectDocumentContained(page, 'room open');
  await expectStatusLabelsInsideSummaries(room);

  // Pointer-exit scrolling at the transcript boundary must not chain to the
  // document: wheel to the tail, then back past the top.
  await wheelOver(scroller, page, 60000);
  await expect
    .poll(async () => scroller.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight))
    .toBeLessThanOrEqual(2);
  await expect(room.locator('details[data-tool-id]').last()).toBeVisible();
  await expectDocumentContained(page, 'transcript tail wheel');
  await wheelOver(scroller, page, -60000);
  await expect.poll(async () => scroller.evaluate(el => el.scrollTop)).toBeLessThanOrEqual(2);
  await expectDocumentContained(page, 'transcript top wheel');

  // The room header and the non-node graph area never scroll the document.
  await wheelOver(page.locator('#legacy-run-room header').first(), page, 60000);
  await expectDocumentContained(page, 'room header wheel');
  const pane = page.locator('.react-flow__pane');
  if ((await pane.count()) > 0) {
    await wheelOver(pane, page, 2000);
    await expectDocumentContained(page, 'graph pane wheel');
  }

  // Keyboard scrolling still works on the transcript scroller.
  await pressScrollerEdge(scroller, 'End');
  await expectDocumentContained(page, 'keyboard transcript scroll');

  // Applicable controls survive: header close. The room has no resize
  // handle — it is a fixed pixel width with no drag handle.
  await expect(page.getByRole('button', { name: 'Close' })).toBeVisible();
});

test('[P1] [V:transcript-display.legacy-scroll-narrow] Legacy narrow room keeps the document fixed', async ({
  browser,
  archon,
}) => {
  test.setTimeout(T.xlong);
  await pageWaitStarter(browser, archon, async page => {
    await page.setViewportSize(NARROW_VIEWPORT);
    const started = await requireLongHistoryFixture(page, archon);
    await openLegacyRunDetail(page, started.runId);
    await waitForRunTitle(page, 'e2e-hitl-long-history');
    await openLegacyLogRow(page, HITL_LONG_NODE);
    const room = await waitForRoom(page, HITL_LONG_NODE);
    await expect
      .poll(async () => room.locator('[data-tool-id]').count(), { timeout: T.xlong })
      .toBeGreaterThan(100);

    const scroller = room.getByTestId('node-transcript-scroll');
    await expect(scroller).toBeVisible();
    expect(
      await scroller.evaluate(el => el.scrollHeight - el.clientHeight),
      'long transcript overflows its own scroll owner'
    ).toBeGreaterThan(0);
    await expectDocumentContained(page, 'narrow room open');
    await expectStatusLabelsInsideSummaries(room);

    await wheelOver(scroller, page, 60000);
    await expect
      .poll(async () => scroller.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight))
      .toBeLessThanOrEqual(2);
    await expect(room.locator('details[data-tool-id]').last()).toBeVisible();
    await expectDocumentContained(page, 'narrow transcript tail wheel');

    // Keyboard scrolling still works on the transcript scroller at narrow width.
    await pressScrollerEdge(scroller, 'Home');
    await pressScrollerEdge(scroller, 'End');
    await expectDocumentContained(page, 'narrow keyboard transcript scroll');

    await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeVisible();
  });
});
