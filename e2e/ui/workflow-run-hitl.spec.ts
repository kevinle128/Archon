import { test, expect } from '../lib/playwright/suite';
import {
  HITL_ASK_NODE,
  HITL_INSPECT_NODE,
  HITL_LOOP_NODE,
  HITL_TOOL_OUTPUT,
} from '../lib/playwright/archon-runtime';
import {
  answerAskViaApi,
  createIdentityContext,
  getRunDetail,
  listNodeMessages,
  openLegacyRunDetail,
  openRunDetail,
  postConversationMessage,
  submitAskYes,
} from '../lib/playwright/run-detail';
import { T } from '../lib/playwright/timeouts';

/**
 * Feature: Workflow run HITL mockup alignment.
 *
 * Real stack: isolated server + SQLite + executor + env-gated e2e-fake provider.
 * Inspect-file room must show the mockup `.ptool` card with visible wrapping output.
 */

test('[P1] [V:hitl.cli-pause] HITL CLI pause envelope and native Ask persist a pending interaction', async ({
  page,
  archon,
}) => {
  const started = await archon.runHitlWorkflow();
  expect(started.state).toBe('paused');
  expect(started.terminal).toBe(false);

  const detail = await getRunDetail(page, started.runId);
  expect(detail.status).toBe('paused');
  expect(detail.user_id).toBe(archon.starterUserId);
  const pending = detail.pending_interactions.filter(
    row => row.node_id === HITL_ASK_NODE && row.status === 'pending'
  );
  expect(pending.length).toBe(1);
  expect(pending[0]?.tool_use_id.length).toBeGreaterThan(0);
});

test('[P1] [V:hitl.tool-transcript] HITL transcript records the tool call and a second result row', async ({
  page,
  archon,
}) => {
  const started = await archon.runHitlWorkflow();
  const messages = await listNodeMessages(page, started.runId, HITL_INSPECT_NODE);
  const toolRows = messages.filter(row => row.kind === 'tool');
  expect(toolRows.length).toBeGreaterThanOrEqual(2);
  expect(toolRows.some(row => row.payload.output === undefined)).toBe(true);
  expect(
    toolRows.some(row => JSON.stringify(row.payload.output ?? '').includes(HITL_TOOL_OUTPUT))
  ).toBe(true);
});

test('[P1] [V:hitl.loop-occurrences] inspect-twice occurrences stay distinct in execution history', async ({
  page,
  archon,
}) => {
  const started = await archon.runHitlWorkflow();
  const messages = await listNodeMessages(page, started.runId, HITL_LOOP_NODE);
  const toolRows = messages.filter(row => row.kind === 'tool');
  expect(toolRows.length, 'two loop iterations each emit a tool call').toBeGreaterThanOrEqual(2);

  const detail = await getRunDetail(page, started.runId);
  const loopExecs = detail.nodeExecutions.filter(row => row.node_id === HITL_LOOP_NODE);
  expect(loopExecs.length, 'one nodeExecution row per loop occurrence').toBeGreaterThanOrEqual(2);
  const occurrenceIds = new Set(
    loopExecs
      .map(row => row.occurrence_id ?? row.attempt_id)
      .filter((id): id is string => Boolean(id))
  );
  expect(occurrenceIds.size).toBeGreaterThanOrEqual(2);
});

test('[P1] [V:hitl.console-tool-output] HITL Console room collapses the call to a readable tool row', async ({
  page,
  archon,
}) => {
  const started = await archon.runHitlWorkflow();
  await openRunDetail(page, started.runId, HITL_INSPECT_NODE);
  const room = page.getByRole('region', { name: `${HITL_INSPECT_NODE} room` });
  await expect(room).toBeVisible({
    timeout: T.medium,
  });
  const rows = room.locator('details[data-tool-id]');
  await expect(rows).toHaveCount(1);
  const summary = room.locator('details[data-tool-id] > summary');
  await expect(summary).toBeVisible({ timeout: T.medium });
  await expect(rows.first()).toHaveJSProperty('open', false);
  await expect(summary).toContainText('Read');
  await expect(summary).toContainText('HITL_TOOL_INPUT.txt');
  await expect(summary).toContainText('succeeded');
  // Raw is the only disclosure: closed by default, and nothing below the
  // summary mounts until the row opens — no Raw control, no payload markup.
  // DOM selector — the absent control is absent from the accessibility tree.
  const rawToggle = rows.locator('button[aria-expanded]');
  await expect(rawToggle).toHaveCount(0);
  await expect(rows.locator('details')).toHaveCount(0);
  await expect(rows.locator('pre')).toHaveCount(0);
  await expect(rows.getByText(HITL_TOOL_OUTPUT)).toHaveCount(0);
});

test('[P1] [V:hitl.legacy-tool-output] HITL Legacy room collapses the call to a readable tool row', async ({
  page,
  archon,
}) => {
  const started = await archon.runHitlWorkflow();
  await openLegacyRunDetail(page, started.runId);
  await expect(page.getByText(/e2e-hitl-run/i).first()).toBeVisible({ timeout: T.medium });
  await page.getByRole('tab', { name: 'Logs' }).click();
  await page
    .getByRole('button', { name: new RegExp(HITL_INSPECT_NODE) })
    .first()
    .click();
  const room = page.getByRole('region', { name: `${HITL_INSPECT_NODE} room` });
  const rows = room.locator('details[data-tool-id]');
  await expect(rows).toHaveCount(1);
  const summary = room.locator('details[data-tool-id] > summary');
  await expect(summary).toBeVisible({ timeout: T.medium });
  await expect(rows.first()).toHaveJSProperty('open', false);
  await expect(summary).toContainText('Read');
  await expect(summary).toContainText('HITL_TOOL_INPUT.txt');
  await expect(summary).toContainText('succeeded');
  // Same collapsed default on Legacy: no Raw control, no nested disclosures,
  // and no serialized payload mount until the row opens. DOM selector — the
  // absent control is absent from the accessibility tree.
  const rawToggle = rows.locator('button[aria-expanded]');
  await expect(rawToggle).toHaveCount(0);
  await expect(rows.locator('details')).toHaveCount(0);
  await expect(rows.locator('pre')).toHaveCount(0);
  await expect(rows.getByText(HITL_TOOL_OUTPUT)).toHaveCount(0);
});

test('[P1] [V:hitl.ask-authorization] starter can answer Ask; teammate is forbidden; missing identity is 401', async ({
  browser,
  archon,
}) => {
  const started = await archon.runHitlWorkflow();
  const starterCtx = await createIdentityContext(browser, archon.baseURL, 'starter');
  const teammateCtx = await createIdentityContext(browser, archon.baseURL, 'teammate');
  const anonCtx = await createIdentityContext(browser, archon.baseURL, 'none');
  const starterPage = await starterCtx.newPage();
  const teammatePage = await teammateCtx.newPage();
  const anonPage = await anonCtx.newPage();

  try {
    const authStatus = await starterPage.request.get('/api/auth/status');
    expect(authStatus.ok()).toBe(true);
    const auth = (await authStatus.json()) as { enabled: boolean };
    if (!auth.enabled) {
      test.info().annotations.push({ type: 'verification-setup', description: 'unsupported' });
      test.skip(
        true,
        'Owned Ask authorization requires authenticated server mode; ' +
          'this SQLite runtime is a solo install'
      );
    }
    const detail = await getRunDetail(starterPage, started.runId);
    const requestId = detail.pending_interactions.find(
      row => row.node_id === HITL_ASK_NODE && row.status === 'pending'
    )?.tool_use_id;
    expect(requestId).toBeTruthy();
    if (!requestId) throw new Error('missing Ask request id');

    expect(await answerAskViaApi(anonPage, started.runId, requestId)).toBe(401);
    expect(await answerAskViaApi(teammatePage, started.runId, requestId)).toBe(403);
    expect(await answerAskViaApi(starterPage, started.runId, requestId)).toBe(200);
    expect(await answerAskViaApi(starterPage, started.runId, requestId)).toBe(409);

    const after = await getRunDetail(starterPage, started.runId);
    const answered = after.pending_interactions.find(row => row.tool_use_id === requestId);
    expect(answered?.status).toBe('answered');

    await archon.resumeWorkflow(started.runId);
    const resumed = await getRunDetail(starterPage, started.runId);
    expect(resumed.status).toBe('completed');
  } finally {
    await starterCtx.close();
    await teammateCtx.close();
    await anonCtx.close();
  }
});

test('[P1] [V:hitl.console-ask-submit] Console Ask card submit continues only after explicit CLI resume', async ({
  browser,
  archon,
}) => {
  const started = await archon.runHitlWorkflow();
  const starterCtx = await createIdentityContext(browser, archon.baseURL, 'starter');
  const page = await starterCtx.newPage();
  try {
    await openRunDetail(page, started.runId, HITL_ASK_NODE);
    await expect(page.getByRole('region', { name: `${HITL_ASK_NODE} room` })).toBeVisible({
      timeout: T.medium,
    });
    const before = await getRunDetail(page, started.runId);
    const requestId = before.pending_interactions.find(
      row => row.node_id === HITL_ASK_NODE && row.status === 'pending'
    )?.tool_use_id;
    if (!requestId) throw new Error('missing pending Ask request id');
    const room = page.getByRole('region', { name: `${HITL_ASK_NODE} room` });
    await submitAskYes(page, room, started.runId, requestId);
    const after = await getRunDetail(page, started.runId);
    // Last Ask answer unpauses the run row (`paused-ask`). CLI-origin has no
    // web parent, so the executor is not auto-dispatched — explicit resume required.
    expect(after.status).toBe('running');
    expect(after.pending_interactions.some(row => row.status === 'answered')).toBe(true);

    await archon.resumeWorkflow(started.runId);
    await archon.waitForRunStatus(started.runId, 'completed');
    await page.reload();
    await expect(page.getByText('Completed', { exact: true }).first()).toBeVisible();
    await expect(room.getByText(/Answered/).first()).toBeVisible();
    await expect(room.getByRole('button', { name: 'Submit' })).toHaveCount(0);
  } finally {
    await starterCtx.close();
  }
});

for (const surface of ['console', 'legacy'] as const) {
  test(`[P1] [V:hitl.${surface}-unowned-ask] ${surface} solo unowned Ask can answer, persist, and resume`, async ({
    browser,
    archon,
  }) => {
    test.skip(
      process.env.ARCHON_E2E_PROOF !== '1',
      'Run this known-regression scenario through verify-archon against an explicit target'
    );
    const started = await archon.runUnownedHitlWorkflow();
    const context = await createIdentityContext(browser, archon.baseURL, 'starter');
    try {
      const page = await context.newPage();
      const before = await getRunDetail(page, started.runId);
      expect(before.status).toBe('paused');
      expect(before.user_id, 'CLI must create a genuinely unowned run').toBeNull();
      expect(before.viewer_is_starter).toBe(false);
      const requestId = before.pending_interactions.find(
        row => row.node_id === HITL_ASK_NODE && row.status === 'pending'
      )?.tool_use_id;
      if (!requestId) throw new Error('missing pending Ask request id');

      if (surface === 'console') {
        await openRunDetail(page, started.runId, HITL_ASK_NODE);
      } else {
        await openLegacyRunDetail(page, started.runId);
        await page.getByRole('tab', { name: 'Logs', exact: true }).click();
        await page
          .getByRole('button', { name: new RegExp(HITL_ASK_NODE) })
          .first()
          .click();
      }
      const room = page.getByRole('region', { name: `${HITL_ASK_NODE} room` });
      await expect(room).toBeVisible({ timeout: T.medium });
      await submitAskYes(page, room, started.runId, requestId);
      expect((await getRunDetail(page, started.runId)).status).toBe('running');
      await archon.resumeWorkflow(started.runId);
      await archon.waitForRunStatus(started.runId, 'completed');
      await page.reload();
      await expect(page.getByText(/^completed$/i).first()).toBeVisible();
      if (surface === 'legacy') {
        await page.getByRole('tab', { name: 'Logs', exact: true }).click();
        await page
          .getByRole('button', { name: new RegExp(HITL_ASK_NODE) })
          .first()
          .click();
      }
      await expect(room.getByText(/Answered/).first()).toBeVisible();
      await expect(room.getByRole('button', { name: 'Submit' })).toHaveCount(0);
      const after = await getRunDetail(page, started.runId);
      expect(after.pending_interactions.find(row => row.tool_use_id === requestId)?.answer).toEqual(
        {
          answers: [{ questionId: 'proceed', value: 'yes' }],
        }
      );
    } finally {
      await context.close();
    }
  });
}

test('[P1] [V:hitl.cli-composer] CLI-origin composer cannot approve; Chat tab stays visible without a web parent', async ({
  page,
  archon,
}) => {
  const started = await archon.runHitlWorkflow();
  await openLegacyRunDetail(page, started.runId);
  await expect(page.getByText(/e2e-hitl-run/i).first()).toBeVisible({ timeout: T.medium });
  await expect(page.getByRole('tab', { name: 'Chat' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Source Control' })).toBeVisible();
  await page.getByRole('tab', { name: 'Chat' }).click();
  await expect(page.getByRole('form', { name: 'Run conversation composer' })).toBeVisible();
  await expect(
    page.getByPlaceholder('This run has no parent conversation, so replies cannot be delivered.')
  ).toBeVisible();

  const before = await getRunDetail(page, started.runId);
  expect(before.status).toBe('paused');
  expect(
    before.pending_interactions.some(
      row => row.node_id === HITL_ASK_NODE && row.status === 'pending'
    )
  ).toBe(true);
});

test('[P1] [V:hitl.web-ask-resume] web-origin Ask answer auto-resumes; composer text does not approve the gate', async ({
  browser,
  archon,
}) => {
  const webRun = await test.step('start a web-origin run and wait for Ask pause', async () =>
    archon.runHitlWorkflowViaWeb());
  const starterCtx = await test.step('open the starter identity context', async () =>
    createIdentityContext(browser, archon.baseURL, 'starter'));
  const page = await starterCtx.newPage();
  try {
    await test.step('confirm the run is paused on its web conversation', async () => {
      const detail = await getRunDetail(page, webRun.runId);
      expect(detail.status).toBe('paused');
      expect(detail.parent_platform_id).toBe(webRun.conversationId);
    });

    const afterComposer =
      await test.step('send composer prose without resolving the Ask', async () => {
        const sendStatus = await postConversationMessage(page, webRun.conversationId, 'approve');
        expect(sendStatus).toBeLessThan(500);
        const nextDetail = await getRunDetail(page, webRun.runId);
        expect(nextDetail.status).toBe('paused');
        expect(
          nextDetail.pending_interactions.some(
            row => row.node_id === HITL_ASK_NODE && row.status === 'pending'
          )
        ).toBe(true);
        return nextDetail;
      });

    const requestId = afterComposer.pending_interactions.find(
      row => row.node_id === HITL_ASK_NODE && row.status === 'pending'
    )?.tool_use_id;
    expect(requestId).toBeTruthy();
    if (!requestId) throw new Error('missing Ask request id');
    await test.step('answer the Ask and wait for automatic resume', async () => {
      expect(await answerAskViaApi(page, webRun.runId, requestId)).toBe(200);
      await archon.waitForRunStatus(webRun.runId, 'completed', T.xlong);
    });
  } finally {
    await starterCtx.close();
  }
});

test('[P1] [V:hitl.live-cli] live-start handle observes a run id before CLI exit', async ({
  archon,
}) => {
  const live = await archon.startHitlWorkflow();
  const runId = await live.runId;
  expect(runId.length).toBeGreaterThan(0);
  const finished = await live.wait();
  expect(finished.runId).toBe(runId);
  expect(finished.state).toBe('paused');
});

test('[P1] [V:hitl.production-controls] production chrome keeps Artifacts and does not ship mockup Replay or view-as', async ({
  page,
  archon,
}) => {
  const started = await archon.runHitlWorkflow();
  await openRunDetail(page, started.runId);
  await expect(page.getByText(/Awaiting input/i).first()).toBeVisible({ timeout: T.medium });
  await expect(page.getByRole('button', { name: /^Replay$/i })).toHaveCount(0);
  await expect(page.locator('#btn-replay')).toHaveCount(0);
  await expect(page.locator('#view-toggle')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Artifacts/ })).toBeVisible();
  await page.getByRole('button', { name: /^Artifacts/ }).click();
  await expect(page.getByText(/No artifacts written to disk for this run/i)).toBeVisible({
    timeout: T.medium,
  });
});
