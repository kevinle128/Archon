import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { type Locator, type Page } from '@playwright/test';

import { test, expect } from '../lib/playwright/suite';
import {
  TRANSCRIPT_FRAGMENT_A,
  TRANSCRIPT_FRAGMENT_B,
  TRANSCRIPT_GHOST_NODE,
  TRANSCRIPT_GHOST_TEXT,
  TRANSCRIPT_INELIGIBLE_TEXTS,
  TRANSCRIPT_PLAIN_NODE,
  TRANSCRIPT_PLAIN_TEXT,
  TRANSCRIPT_STRUCTURED_NODE,
  TRANSCRIPT_STRUCTURED_TEXT,
  transcriptReportEnvelope,
  type ArchonRuntime,
  type CliRunResult,
} from '../lib/playwright/archon-runtime';
import {
  getRunDetail,
  listNodeMessages,
  openLegacyRunDetail,
  openRunDetail,
} from '../lib/playwright/run-detail';
import { T } from '../lib/playwright/timeouts';

const STRUCTURED_ENVELOPE = transcriptReportEnvelope(TRANSCRIPT_STRUCTURED_TEXT);
const PLAIN_ENVELOPE = transcriptReportEnvelope(TRANSCRIPT_PLAIN_TEXT);
const GHOST_ENVELOPE = transcriptReportEnvelope(TRANSCRIPT_GHOST_TEXT);
/** Exact persisted payload.text sequence for the structured node, in seq order. */
const STRUCTURED_ROW_TEXTS = [
  TRANSCRIPT_FRAGMENT_A,
  TRANSCRIPT_FRAGMENT_B,
  ...TRANSCRIPT_INELIGIBLE_TEXTS,
];

async function waitForRunTitle(page: Page): Promise<void> {
  await expect(page.getByText(/e2e-transcript-display/i).first()).toBeVisible({
    timeout: T.medium,
  });
}

function executionSection(page: Page, nodeText: string): Locator {
  return page.locator('section[data-execution-row-id]').filter({ hasText: nodeText }).first();
}

async function openConsoleLogRow(page: Page, nodeText: string): Promise<void> {
  const buttons = page.getByRole('button', { name: new RegExp(nodeText) });
  await expect(buttons.first()).toBeVisible({ timeout: T.medium });
  await buttons.first().click();
}

async function openLegacyLogRow(page: Page, nodeText: string): Promise<void> {
  const logsTab = page.getByRole('tab', { name: 'Logs' });
  if ((await logsTab.count()) > 0) {
    await logsTab.click();
  }
  const buttons = page.getByRole('button', { name: new RegExp(nodeText) });
  await expect(buttons.first()).toBeVisible({ timeout: T.medium });
  await buttons.first().click();
}

async function waitForRoom(page: Page, nodeId: string): Promise<Locator> {
  const room = page.getByRole('region', { name: `${nodeId} room` });
  await expect(room).toBeVisible({ timeout: T.medium });
  return room;
}

async function expectUnwrapped(container: Locator, label: string): Promise<void> {
  // The definition loads asynchronously; the raw envelope already contains the
  // report text as a substring, so poll for the exact canonical envelope to
  // disappear — that is the moment the resolved output_format unwraps the row.
  await expect(container, `${label} drops the serialized envelope`).not.toContainText(
    STRUCTURED_ENVELOPE,
    { timeout: T.medium }
  );
  await expect(container, `${label} shows the unwrapped report text`).toContainText(
    TRANSCRIPT_STRUCTURED_TEXT
  );
}

async function expectIneligibleRows(container: Locator, label: string): Promise<void> {
  for (const text of TRANSCRIPT_INELIGIBLE_TEXTS) {
    await expect(container, `${label} keeps ineligible row ${text}`).toContainText(text);
  }
}

async function expectRawEnvelope(
  container: Locator,
  envelope: string,
  label: string
): Promise<void> {
  await expect(container, `${label} keeps the serialized envelope`).toContainText(envelope, {
    timeout: T.medium,
  });
}

/**
 * API contract: ordered payload.text equals the seeded fragments verbatim and
 * every scoped row retains the execution ids the executor minted for the
 * skipped node — only the projected Web block is unwrapped.
 */
async function expectApiRowsSerialized(page: Page, runId: string): Promise<void> {
  const detail = await getRunDetail(page, runId);
  const executionOf = (nodeId: string): { occurrence_id?: string; attempt_id?: string } => {
    const execution = detail.nodeExecutions.find(entry => entry.node_id === nodeId);
    expect(execution, `nodeExecution for ${nodeId}`).toBeTruthy();
    return {
      occurrence_id: execution?.occurrence_id,
      attempt_id: execution?.attempt_id,
    };
  };
  for (const [nodeId, texts] of [
    [TRANSCRIPT_STRUCTURED_NODE, STRUCTURED_ROW_TEXTS],
    [TRANSCRIPT_PLAIN_NODE, [PLAIN_ENVELOPE]],
  ] as const) {
    const messages = await listNodeMessages(page, runId, nodeId);
    expect(
      messages.map(message => message.payload.text),
      `${nodeId} API rows keep the seeded fragments in order`
    ).toEqual([...texts]);
    const execution = executionOf(nodeId);
    for (const message of messages) {
      expect(message.metadata?.execution, `${nodeId} API row execution scope`).toEqual(execution);
    }
  }
  const ghostMessages = await listNodeMessages(page, runId, TRANSCRIPT_GHOST_NODE);
  expect(ghostMessages.map(message => message.payload.text)).toEqual([GHOST_ENVELOPE]);
  expect(ghostMessages[0]?.metadata?.execution).toBeUndefined();
}

/** Read stored `payload` text verbatim — proof the presentation layer is read-only. */
function expectStoredRowsSerialized(archon: ArchonRuntime, runId: string): void {
  const script = `
    import { Database } from 'bun:sqlite';
    const db = new Database(process.env.E2E_DB_PATH, { readonly: true });
    const rows = db
      .query(
        'SELECT node_id AS nodeId, payload FROM remote_agent_workflow_node_messages WHERE workflow_run_id = ? ORDER BY node_id, seq'
      )
      .all(process.env.E2E_RUN_ID);
    console.log(JSON.stringify(rows));
  `;
  const result = spawnSync('bun', ['-e', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      E2E_DB_PATH: join(archon.home, 'archon.db'),
      E2E_RUN_ID: runId,
    },
  });
  if (result.status !== 0) {
    throw new Error(`stored-row read failed:\n${result.stderr}\n${result.stdout}`);
  }
  const rows = JSON.parse(result.stdout) as { nodeId: string; payload: string }[];
  const textsByNode = new Map<string, unknown[]>();
  for (const row of rows) {
    const list = textsByNode.get(row.nodeId) ?? [];
    list.push((JSON.parse(row.payload) as { text: unknown }).text);
    textsByNode.set(row.nodeId, list);
  }
  for (const [nodeId, texts] of [
    [TRANSCRIPT_STRUCTURED_NODE, STRUCTURED_ROW_TEXTS],
    [TRANSCRIPT_PLAIN_NODE, [PLAIN_ENVELOPE]],
    [TRANSCRIPT_GHOST_NODE, [GHOST_ENVELOPE]],
  ] as const) {
    expect(textsByNode.get(nodeId), `${nodeId} stored rows unchanged`).toEqual([...texts]);
  }
}

test('[P1] [V:transcript.console] Console inline + room unwrap the envelope; API and stored rows stay serialized', async ({
  page,
  archon,
}) => {
  const started: CliRunResult = await archon.prepareTranscriptDisplayRun();
  await expectApiRowsSerialized(page, started.runId);
  expectStoredRowsSerialized(archon, started.runId);

  await openRunDetail(page, started.runId);
  await waitForRunTitle(page);

  // Inline execution history mounts under every divider without a selection.
  const inlineSection = executionSection(page, TRANSCRIPT_STRUCTURED_NODE);
  await expectUnwrapped(inlineSection, 'Console inline execution history');
  await expectIneligibleRows(inlineSection, 'Console inline execution history');

  // Selecting the row suspends its inline body and opens the node room — the
  // second mount must apply the same unwrapping.
  await openConsoleLogRow(page, TRANSCRIPT_STRUCTURED_NODE);
  const room = await waitForRoom(page, TRANSCRIPT_STRUCTURED_NODE);
  await expectUnwrapped(room, 'Console selected node room');
  await expectIneligibleRows(room, 'Console selected node room');
});

test('[P1] [V:transcript.legacy] Legacy node room unwraps the envelope', async ({
  page,
  archon,
}) => {
  const started = await archon.prepareTranscriptDisplayRun();
  await openLegacyRunDetail(page, started.runId);
  await waitForRunTitle(page);
  await openLegacyLogRow(page, 'structured');
  const room = await waitForRoom(page, TRANSCRIPT_STRUCTURED_NODE);
  await expectUnwrapped(room, 'Legacy node room');
  await expectIneligibleRows(room, 'Legacy node room');
});

test('[P1] [V:transcript.fallback] No-schema and deleted-definition nodes keep the raw envelope', async ({
  page,
  archon,
}) => {
  const started = await archon.prepareTranscriptDisplayRun();
  await openRunDetail(page, started.runId);
  await waitForRunTitle(page);

  // `plain` resolves a definition node with no output_format; `ghost` resolves
  // no definition node at all. Both must render the serialized bytes.
  await expectRawEnvelope(
    executionSection(page, TRANSCRIPT_PLAIN_NODE),
    PLAIN_ENVELOPE,
    'Console inline history (no output_format)'
  );
  await openConsoleLogRow(page, TRANSCRIPT_PLAIN_NODE);
  await expectRawEnvelope(
    await waitForRoom(page, TRANSCRIPT_PLAIN_NODE),
    PLAIN_ENVELOPE,
    'Console room (no output_format)'
  );
  await expectRawEnvelope(
    executionSection(page, TRANSCRIPT_GHOST_NODE),
    GHOST_ENVELOPE,
    'Console inline history (deleted definition)'
  );

  await openLegacyRunDetail(page, started.runId);
  await waitForRunTitle(page);
  await openLegacyLogRow(page, TRANSCRIPT_PLAIN_NODE);
  await expectRawEnvelope(
    await waitForRoom(page, TRANSCRIPT_PLAIN_NODE),
    PLAIN_ENVELOPE,
    'Legacy room (no output_format)'
  );
  await openLegacyLogRow(page, TRANSCRIPT_GHOST_NODE);
  await expectRawEnvelope(
    await waitForRoom(page, TRANSCRIPT_GHOST_NODE),
    GHOST_ENVELOPE,
    'Legacy room (deleted definition)'
  );
});
