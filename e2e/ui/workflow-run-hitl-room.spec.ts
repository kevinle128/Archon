import { type Locator, type Page } from '@playwright/test';

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
const LEGACY_RATIO_VIEWPORT = { width: 1024, height: 900 } as const;
const NARROW_VIEWPORT = { width: 390, height: 844 } as const;
const DEFAULT_RATIO_MIN = 0.38;
const DEFAULT_RATIO_MAX = 0.42;
const WIDTH_TOLERANCE_PX = 2;
const RELOAD_RATIO_TOLERANCE = 0.02;
const ROOM_MIN_WIDTH_PX = 240;
const DRAFT_OTHER = 'shared-ask-draft';

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

async function roomRatio(page: Page, surface: 'console' | 'legacy'): Promise<number> {
  const viewId = surface === 'console' ? 'console-run-view' : 'legacy-run-view';
  const roomId = surface === 'console' ? 'console-run-room' : 'legacy-run-room';
  const viewWidth = await boxWidth(panelLocator(page, viewId), viewId);
  const roomWidth = await boxWidth(panelLocator(page, roomId), roomId);
  const total = viewWidth + roomWidth;
  expect(total, `${surface} split total width`).toBeGreaterThan(0);
  return roomWidth / total;
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

async function openConsoleLogRow(page: Page, nodeId: string, index = 0): Promise<void> {
  const buttons = page.getByRole('button', { name: new RegExp(nodeId) });
  await expect(buttons.nth(index)).toBeVisible({ timeout: T.medium });
  await buttons.nth(index).click();
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

function executionSection(page: Page, nodeId: string): Locator {
  return page.locator('section[data-execution-row-id]').filter({ hasText: nodeId }).first();
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

test('[P1] [V:hitl.console-room-layout] Console room opens, closes, and releases its width', async ({
  page,
  archon,
}) => {
  await page.setViewportSize(SPLIT_VIEWPORT);
  const started = await archon.runHitlWorkflow();
  await openRunDetail(page, started.runId);
  await waitForRunTitle(page, 'e2e-hitl-run');

  await openConsoleLogRow(page, HITL_INSPECT_NODE);
  const room = await waitForRoom(page, HITL_INSPECT_NODE);
  const logRow = page.getByRole('button', { name: new RegExp(HITL_INSPECT_NODE) }).first();
  const openWidth = await boxWidth(logRow, 'Console log row while room is open');
  const roomWidth = await boxWidth(room, 'Console room');

  await page.getByRole('button', { name: 'Close' }).click();
  await expect(room).toHaveCount(0);
  const closedWidth = await boxWidth(logRow, 'Console log row after room closes');
  expect(
    closedWidth - openWidth,
    'closing the room returns its width to the log'
  ).toBeGreaterThanOrEqual(roomWidth - WIDTH_TOLERANCE_PX);
  await expect(page.getByText('Select a node', { exact: true })).toHaveCount(0);
  await expect(panelLocator(page, 'console-run-room')).toHaveCount(0);
  await expect(page.getByRole('separator', { name: 'Resize node room' })).toHaveCount(0);
  await openConsoleLogRow(page, HITL_INSPECT_NODE);
  await waitForRoom(page, HITL_INSPECT_NODE);
  const ratio = await roomRatio(page, 'console');
  expect(ratio).toBeGreaterThanOrEqual(DEFAULT_RATIO_MIN);
  expect(ratio).toBeLessThanOrEqual(DEFAULT_RATIO_MAX);
});

test('[P1] [V:hitl.legacy-room-layout] Legacy room is readable and percentage sized', async ({
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
  const ratio = await roomRatio(page, 'legacy');
  expect(ratio).toBeGreaterThanOrEqual(DEFAULT_RATIO_MIN);
  expect(ratio).toBeLessThanOrEqual(DEFAULT_RATIO_MAX);
  await expect(room.getByText(HITL_TOOL_OUTPUT)).toBeVisible({ timeout: T.medium });
});

test('[P1] [V:hitl.graph-selection] Graph selection restores the last explicit execution', async ({
  page,
  archon,
}) => {
  await page.setViewportSize(SPLIT_VIEWPORT);
  const started = await archon.runHitlWorkflow();
  await openRunDetail(page, started.runId);
  await waitForRunTitle(page, 'e2e-hitl-run');
  await openConsoleLogRow(page, HITL_LOOP_NODE, 0);
  const room = await waitForRoom(page, HITL_LOOP_NODE);
  const execution = page.getByLabel('Execution');
  await expect(execution).toBeVisible({ timeout: T.medium });
  const firstValue = await execution.locator('option').nth(0).getAttribute('value');
  expect(firstValue).toBeTruthy();
  await execution.selectOption(firstValue ?? '');
  await expect(page.getByText('Iteration 1').first()).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Graph' }).click();
  await page.locator(`#console-graph-${encodeURIComponent(HITL_LOOP_NODE)}`).click();
  const reopened = await waitForRoom(page, HITL_LOOP_NODE);
  await expect(page.getByLabel('Execution')).toHaveValue(firstValue ?? '');
  await expect(page.getByText('Iteration 1').first()).toBeVisible();
});

test('[P1] [V:hitl.agent-history] HITL agent history shows a readable tool row with outcome', async ({
  page,
  archon,
}) => {
  await page.setViewportSize(SPLIT_VIEWPORT);
  const started = await archon.runHitlWorkflow();
  await openRunDetail(page, started.runId);
  await waitForRunTitle(page, 'e2e-hitl-run');
  await openConsoleLogRow(page, HITL_INSPECT_NODE);
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
  await expect(toolRow).toHaveJSProperty('open', false);
  await expect(summary).toContainText('Read');
  await expect(summary).toContainText('HITL_TOOL_INPUT.txt');
  await expect(summary).toContainText('succeeded');
  await expect(summary).toContainText(formatRecordedDuration(Number(recordedDuration)));
  await expect(toolRow.getByText('Input', { exact: true })).toBeHidden();
  await expect(toolRow.getByText('Output', { exact: true })).toBeHidden();
  await expect(toolRow.getByText(HITL_TOOL_OUTPUT)).toBeHidden();
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
    await openConsoleLogRow(page, HITL_LOOP_NODE, 0);
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
    await expect(page.getByText('Iteration 1').first()).toBeVisible();
    await execution.selectOption(valueTwo ?? '');
    await expect(page.getByText('Iteration 2').first()).toBeVisible();

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

test('[P1] [V:hitl.ask-draft] Ask draft is shared across room and execution section', async ({
  browser,
  archon,
}) => {
  await pageWaitStarter(browser, archon, async page => {
    await page.setViewportSize(SPLIT_VIEWPORT);
    const started = await archon.runHitlWorkflow();
    await openRunDetail(page, started.runId);
    await waitForRunTitle(page, 'e2e-hitl-run');
    await openConsoleLogRow(page, HITL_ASK_NODE);
    const room = await waitForRoom(page, HITL_ASK_NODE);
    await room.getByLabel('Other').check();
    await room.getByLabel(/Other answer for/).fill(DRAFT_OTHER);
    const section = executionSection(page, HITL_ASK_NODE);
    await expect(section.getByLabel(/Other answer for/)).toHaveValue(DRAFT_OTHER);
    const roomCardId = await room.locator('form').first().getAttribute('id');
    const sectionCardId = await section.locator('form').first().getAttribute('id');
    expect(roomCardId).toBeTruthy();
    expect(sectionCardId).toBeTruthy();
    expect(roomCardId).not.toBe(sectionCardId);
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
    await openConsoleLogRow(page, HITL_ASK_ANSWER_NODE);
    const pendingAnswerRoom = await waitForRoom(page, HITL_ASK_ANSWER_NODE);
    await submitAskYes(page, pendingAnswerRoom, started.runId, answerId);
    await openConsoleLogRow(page, HITL_ASK_DECLINE_NODE);
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

    await openConsoleLogRow(page, HITL_ASK_ANSWER_NODE);
    const answeredRoom = await waitForRoom(page, HITL_ASK_ANSWER_NODE);
    await expect(answeredRoom.getByText(/Answered/i).first()).toBeVisible({ timeout: T.medium });
    await expect(answeredRoom.getByRole('button', { name: 'Submit' })).toHaveCount(0);
    await expect(
      executionSection(page, HITL_ASK_ANSWER_NODE)
        .getByText(/Answered/i)
        .first()
    ).toBeVisible();

    await page.getByRole('button', { name: 'Close' }).click();
    await openConsoleLogRow(page, HITL_ASK_DECLINE_NODE);
    const declinedRoom = await waitForRoom(page, HITL_ASK_DECLINE_NODE);
    await expect(declinedRoom.getByText(/Declined/i).first()).toBeVisible({ timeout: T.medium });
    await expect(declinedRoom.getByRole('button', { name: 'Decline' })).toHaveCount(0);
    await expect(
      executionSection(page, HITL_ASK_DECLINE_NODE)
        .getByText(/Declined/i)
        .first()
    ).toBeVisible();
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
    await page.getByRole('button', { name: 'Awaiting input', exact: true }).click();
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

test('[P1] [V:hitl.console-mobile-back] Narrow room uses Back without losing Log state', async ({
  browser,
  archon,
}) => {
  await pageWaitStarter(browser, archon, async page => {
    await page.setViewportSize(NARROW_VIEWPORT);
    const started = await archon.runHitlWorkflow();
    await openRunDetail(page, started.runId);
    await waitForRunTitle(page, 'e2e-hitl-run');
    const logPane = page.getByTestId('console-run-log-scroll');
    await expect(logPane).toBeVisible();
    await logPane.evaluate((el: HTMLElement) => {
      el.scrollTop = el.scrollHeight;
    });
    const scrollBefore = await logPane.evaluate((el: HTMLElement) => el.scrollTop);
    expect(scrollBefore).toBeGreaterThan(0);
    const logOpener = page
      .locator('button[id^="console-log-"]')
      .filter({ hasText: HITL_ASK_NODE })
      .first();
    const logOpenerId = await logOpener.getAttribute('id');
    expect(logOpenerId).toBeTruthy();
    await logOpener.dispatchEvent('click');
    await waitForRoom(page, HITL_ASK_NODE);
    await expect(logPane).toBeHidden();
    expect(await logPane.count()).toBeGreaterThan(0);
    const room = page.getByRole('region', { name: `${HITL_ASK_NODE} room` });
    await room.getByLabel('Other').check();
    await room.getByLabel(/Other answer for/).fill(DRAFT_OTHER);
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByRole('button', { name: 'Log' })).toHaveAttribute('aria-pressed', 'true');
    await expect(logOpener).toBeVisible();
    await expect(logPane).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.id ?? ''))
      .toBe(logOpenerId ?? '');
    const scrollAfter = await logPane.evaluate((el: HTMLElement) => el.scrollTop);
    expect(scrollAfter).toBe(scrollBefore);
    await expect(executionSection(page, HITL_ASK_NODE).getByLabel(/Other answer for/)).toHaveValue(
      DRAFT_OTHER
    );
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
  const opened = await openRunDetail(page, started.runId, HITL_INSPECT_NODE);
  await waitForRoom(page, HITL_INSPECT_NODE);
  const opener = page.getByRole('button', { name: new RegExp(HITL_INSPECT_NODE) }).first();
  await expect(opener).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(panelLocator(page, 'console-run-room')).toHaveCount(0);
  await expect(opener).toBeFocused();

  await page.goto(`/console/p/${opened.projectId}/r/${started.runId}`);
  await waitForRunTitle(page, 'e2e-hitl-run');
  await expect(panelLocator(page, 'console-run-room')).toHaveCount(0);

  await page.goto(
    `/console/p/${opened.projectId}/r/${started.runId}?node=${encodeURIComponent(HITL_INSPECT_NODE)}`
  );
  await waitForRoom(page, HITL_INSPECT_NODE);
});

test('[P1] [V:hitl.room-ratio] Reload restores the chosen ratio', async ({ page, archon }) => {
  await page.setViewportSize(SPLIT_VIEWPORT);
  const started = await archon.runHitlWorkflow();
  await openRunDetail(page, started.runId);
  await waitForRunTitle(page, 'e2e-hitl-run');
  await openConsoleLogRow(page, HITL_INSPECT_NODE);
  await waitForRoom(page, HITL_INSPECT_NODE);
  const separator = page.getByRole('separator', { name: 'Resize node room' });
  const before = await roomRatio(page, 'console');
  const box = await separator.boundingBox();
  expect(box).toBeTruthy();
  if (!box) throw new Error('missing separator');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 120, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  const stored = await roomRatio(page, 'console');
  expect(stored).toBeGreaterThan(before + 0.02);
  expect(stored).toBeGreaterThanOrEqual(0.24);
  expect(stored).toBeLessThanOrEqual(0.6);

  await page.reload();
  await waitForRunTitle(page, 'e2e-hitl-run');
  await openConsoleLogRow(page, HITL_INSPECT_NODE);
  await waitForRoom(page, HITL_INSPECT_NODE);
  const restored = await roomRatio(page, 'console');
  expect(Math.abs(restored - stored)).toBeLessThanOrEqual(RELOAD_RATIO_TOLERANCE);
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
    await openConsoleLogRow(page, HITL_LONG_NODE);
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
}) => {
  test.setTimeout(T.xlong);
  await page.setViewportSize(SPLIT_VIEWPORT);
  const started = await requireLongHistoryFixture(page, archon);
  await openRunDetail(page, started.runId);
  await waitForRunTitle(page, 'e2e-hitl-long-history');
  await openConsoleLogRow(page, HITL_LONG_NODE);
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
  const viewFullOutput = room.getByRole('button', { name: 'View full output' });
  await expect(viewFullOutput).toHaveCount(1);
  await expect(room.getByText('[e2e-fake] full output tail', { exact: false })).toHaveCount(0);
  await viewFullOutput.click();
  await expect(room.getByText('[e2e-fake] full output tail', { exact: false })).toBeVisible({
    timeout: T.medium,
  });
});

test('[P1] [V:hitl.console-reply-unavailable] Console Reply rejects a missing parent', async ({
  page,
  archon,
}) => {
  await page.setViewportSize(SPLIT_VIEWPORT);
  const started = await archon.runHitlWorkflow();
  const creates: string[] = [];
  page.on('request', request => {
    if (request.method() !== 'POST') return;
    const url = new URL(request.url());
    if (url.pathname === '/api/conversations') creates.push(url.pathname);
  });
  await openRunDetail(page, started.runId);
  await waitForRunTitle(page, 'e2e-hitl-run');
  await expect(
    page.getByText('Replies need a parent web conversation. This run has none.')
  ).toBeVisible({ timeout: T.medium });
  await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled();
  expect(creates).toEqual([]);
});

test('[P1] [V:hitl.console-reply-parent] Console Reply uses the exact parent web conversation', async ({
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
    await page.getByLabel('Reply').fill('parent-reply-from-room-spec');
    await page.getByRole('button', { name: 'Send' }).click();
    const expected = `/api/conversations/${encodeURIComponent(webRun.conversationId)}/message`;
    await expect.poll(() => posts.includes(expected)).toBe(true);
    expect(posts.includes('/api/conversations')).toBe(false);
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

test('[P1] [V:hitl.artifacts-room] Console Artifacts keeps the room docked', async ({
  page,
  archon,
}) => {
  await page.setViewportSize(SPLIT_VIEWPORT);
  const started = await archon.runHitlWorkflow();
  await openRunDetail(page, started.runId);
  await waitForRunTitle(page, 'e2e-hitl-run');
  await openConsoleLogRow(page, HITL_INSPECT_NODE);
  await waitForRoom(page, HITL_INSPECT_NODE);
  await page.getByRole('button', { name: 'Artifacts' }).click();
  await expect(page.getByText(/No artifacts written to disk for this run/i)).toBeVisible({
    timeout: T.medium,
  });
  await expect(page.getByRole('region', { name: `${HITL_INSPECT_NODE} room` })).toBeVisible();
});
