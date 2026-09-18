import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type Locator, type Page } from '@playwright/test';

import { test, expect } from '../lib/playwright/suite';
import { type ArchonRuntime } from '../lib/playwright/archon-runtime';
import {
  observeNodeMessagePages,
  openLegacyRunDetail,
  openRunDetail,
} from '../lib/playwright/run-detail';
import { T } from '../lib/playwright/timeouts';

/**
 * Story 1.7 / CAP-6 (US-005) — occurrence navigator evidence on the real
 * server/API path.
 *
 * Reachability is explicitly the B1 compatibility scenario: the persisted
 * transcript carries per-row `metadata.execution.occurrence_id` for a node
 * whose executions include an unscoped (pre-occurrence) run, so a node-scoped
 * selection returns rows spanning several occurrence_ids and the client groups
 * them. Events and messages are seeded into the worker's real SQLite store —
 * the request path, the `json_extract` occurrence filter, the run-detail
 * execution projection, and both shells are all real. No modern-loop executor
 * currently produces a node-scoped multi-occurrence selection, so this fixture
 * models the durable persisted shape rather than claiming executor
 * reachability. That limitation is recorded in reports/acceptance.md.
 */

const OCC_NODE = 'occ-multi';
const FLAT_NODE = 'occ-none';
const OCC_A = 'a1a1a1a1-1111-4111-8111-a1a1a1a1a1a1';
const OCC_B = 'b2b2b2b2-2222-4222-8222-b2b2b2b2b2b2';
const OCC_C = 'c3c3c3c3-3333-4333-8333-c3c3c3c3c3c3';
const OCC_D = 'd4d4d4d4-4444-4444-8444-d4d4d4d4d4d4';
const OCC_E = 'e5e5e5e5-5555-4555-8555-e5e5e5e5e5e5';
const OCC_F = 'f6f6f6f6-6666-4666-8666-f6f6f6f6f6f6';
const ATT_A = 'aa0aa0aa-aaaa-4aaa-8aaa-aa0aa0aa0aa0';
const ATT_B = 'bb1bb1bb-bbbb-4bbb-8bbb-bb1bb1bb1bb1';
const ATT_C = 'cc2cc2cc-cccc-4ccc-8ccc-cc2cc2cc2cc2';
const ATT_D = 'dd3dd3dd-dddd-4ddd-8ddd-dd3dd3dd3dd3';
const ATT_E = 'ee4ee4ee-eeee-4eee-8eee-ee4ee4ee4ee4';
const ATT_F = 'ff5ff5ff-ffff-4fff-8fff-ff5ff5ff5ff5';

const LABEL_A = 'Iteration 1';
const LABEL_B = 'Iteration 2';
const LABEL_D = 'Run 1 · failed';
const LABEL_C = 'Run 2 · retry · failed';
const LABEL_E = 'Iteration 1 › Iteration 1 · loopX';
const LABEL_F = 'Iteration 1 › Iteration 1 · loopY';
const ALL_LABELS = [LABEL_A, LABEL_B, LABEL_D, LABEL_C, LABEL_E, LABEL_F];
const PREFIX_TEXT = 'E2E_PRE_OCCURRENCE_NOTE';
const REPLY_A = 'E2E iteration one reply';
const LIVE_TEXT = 'E2E_LIVE_APPEND_ROW';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EVIDENCE_DIR = join(
  REPO_ROOT,
  'plans',
  '260918-1711-issue-180-navigate-occurrences-and-loop-iterations',
  'reports',
  'evidence'
);

// Room width is `roomRatio`% of the split container (default 40). Legacy's
// container is the viewport (1150 × 0.4 = 460); Console subtracts the ~280px
// project rail (1430 → ~1150 container → ~460). Asserted within ±8px and the
// measured value is recorded in the artifact name/report.
const CONSOLE_WIDE_VIEWPORT = { width: 1430, height: 560 } as const;
const LEGACY_WIDE_VIEWPORT = { width: 1150, height: 560 } as const;
const NARROW_VIEWPORT = { width: 390, height: 844 } as const;
const ROOM_PANEL_ID: Record<'console' | 'legacy', string> = {
  console: 'console-run-room',
  legacy: 'legacy-run-room',
};

interface SeedMessage {
  kind: 'text' | 'tool' | 'status';
  payload: Record<string, unknown>;
  metadata: Record<string, unknown> | null;
}

interface SeedEvent {
  event_type: string;
  data: Record<string, unknown>;
}

const EXEC_A = {
  occurrence_id: OCC_A,
  attempt_id: ATT_A,
  loop_ancestry: [{ node_id: 'loop', iteration: 1 }],
};
const EXEC_B = {
  occurrence_id: OCC_B,
  attempt_id: ATT_B,
  loop_ancestry: [{ node_id: 'loop', iteration: 2 }],
};
const EXEC_C = { occurrence_id: OCC_C, attempt_id: ATT_C, retry_epoch: 1 };
const EXEC_D = { occurrence_id: OCC_D, attempt_id: ATT_D, retry_epoch: 0 };
// Two same-node occurrences whose leaf iteration collides; only the root
// ancestry node_id differs — the B4 disambiguation path under test.
const EXEC_E = {
  occurrence_id: OCC_E,
  attempt_id: ATT_E,
  loop_ancestry: [
    { node_id: 'loopX', iteration: 1 },
    { node_id: 'inner', iteration: 1 },
  ],
};
const EXEC_F = {
  occurrence_id: OCC_F,
  attempt_id: ATT_F,
  loop_ancestry: [
    { node_id: 'loopY', iteration: 1 },
    { node_id: 'inner', iteration: 1 },
  ],
};

const OCC_MESSAGES: SeedMessage[] = [
  { kind: 'text', payload: { text: PREFIX_TEXT }, metadata: null },
  { kind: 'text', payload: { text: REPLY_A }, metadata: { execution: EXEC_A } },
  // Pad group A so later headings sit below the fold and jumps must scroll.
  ...Array.from({ length: 8 }, (_, index) => ({
    kind: 'text' as const,
    payload: { text: `E2E iteration one continuation ${String(index + 1)}` },
    metadata: { execution: EXEC_A },
  })),
  {
    kind: 'tool',
    payload: {
      name: 'Read',
      id: 'e2e-occ-tool-a',
      input: { path: 'a.txt' },
      output: 'E2E_OCC_A_OUTPUT',
    },
    metadata: { execution: EXEC_A, tool_phase: 'result', outcome: 'success' },
  },
  {
    kind: 'tool',
    payload: {
      name: 'Bash',
      id: 'e2e-occ-tool-b',
      input: { command: 'false' },
      output: 'E2E_OCC_B_ERR',
    },
    metadata: { execution: EXEC_B, tool_phase: 'result', outcome: 'error', exit_code: 1 },
  },
  // Pad group B with tool rows so a jump to its heading leaves >24px below
  // the fold — under that threshold the scroll-follow reducer re-pins.
  ...Array.from({ length: 19 }, (_, index) => ({
    kind: 'tool' as const,
    payload: {
      name: 'Read',
      id: `e2e-occ-tool-b-${String(index)}`,
      input: { path: `b-${String(index)}.txt` },
      output: `E2E_OCC_B_OUT_${String(index)}`,
    },
    metadata: { execution: EXEC_B, tool_phase: 'result', outcome: 'success' },
  })),
  {
    kind: 'status',
    payload: { state: 'failed', detail: 'e2e seeded first failure' },
    metadata: { execution: EXEC_D },
  },
  {
    kind: 'status',
    payload: { state: 'failed', detail: 'e2e seeded retry failure' },
    metadata: { execution: EXEC_C },
  },
  {
    kind: 'status',
    payload: { state: 'completed' },
    metadata: { execution: EXEC_E },
  },
  {
    kind: 'status',
    payload: { state: 'completed' },
    metadata: { execution: EXEC_F },
  },
];

/**
 * Single SQLite entry point: insert lifecycle events + transcript rows (rows
 * take an explicit start seq so the same helper appends live rows mid-test),
 * optionally patch the run status (the live-append test pins it `running`).
 */
function seedStore(
  archon: ArchonRuntime,
  options: {
    runId: string;
    nodeId: string;
    events?: SeedEvent[];
    messages?: SeedMessage[];
    startSeq?: number;
    runStatus?: string;
  }
): void {
  const script = `
    import { Database } from 'bun:sqlite';
    const db = new Database(process.env.E2E_DB_PATH);
    const runId = process.env.E2E_RUN_ID;
    const nodeId = process.env.E2E_NODE_ID;
    const events = JSON.parse(process.env.E2E_EVENTS ?? '[]');
    const messages = JSON.parse(process.env.E2E_MESSAGES ?? '[]');
    const startSeq = Number(process.env.E2E_START_SEQ ?? '1');
    const runStatus = process.env.E2E_RUN_STATUS ?? '';
    const baseMs = Date.now();
    db.run('BEGIN');
    try {
      events.forEach((event, index) => {
        db.run(
          'INSERT INTO remote_agent_workflow_events (id, workflow_run_id, event_type, step_name, data, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          [
            crypto.randomUUID(),
            runId,
            event.event_type,
            nodeId,
            JSON.stringify(event.data),
            new Date(baseMs + index * 1000).toISOString(),
          ]
        );
      });
      messages.forEach((message, index) => {
        db.run(
          'INSERT INTO remote_agent_workflow_node_messages (id, workflow_run_id, node_id, seq, kind, payload, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [
            crypto.randomUUID(),
            runId,
            nodeId,
            startSeq + index,
            message.kind,
            JSON.stringify(message.payload),
            message.metadata === null ? null : JSON.stringify(message.metadata),
          ]
        );
      });
      if (runStatus !== '') {
        db.run('UPDATE remote_agent_workflow_runs SET status = ? WHERE id = ?', [runStatus, runId]);
      }
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
      E2E_RUN_ID: options.runId,
      E2E_NODE_ID: options.nodeId,
      E2E_EVENTS: JSON.stringify(options.events ?? []),
      E2E_MESSAGES: JSON.stringify(options.messages ?? []),
      E2E_START_SEQ: String(options.startSeq ?? 1),
      E2E_RUN_STATUS: options.runStatus ?? '',
    },
  });
  if (result.status !== 0) {
    throw new Error(`occurrence fixture seed failed:\n${result.stderr}\n${result.stdout}`);
  }
}

/**
 * Insert lifecycle events + transcript rows for OCC_NODE and FLAT_NODE into
 * the run's real SQLite store. OCC_NODE's execution order is A, B, D, C, E, F,
 * then the unscoped pair last so the node's latest execution row is the
 * node-scoped one — the selection the room opens on and the only selection
 * that returns a multi-occurrence transcript (B1 compatibility path). With
 * `live`, the unscoped execution stays `node_started` and the run row is
 * patched to `running` so the room keeps its 1s refresh loop.
 */
function seedOccurrenceTranscript(archon: ArchonRuntime, runId: string, live: boolean): void {
  const events: SeedEvent[] = [
    { event_type: 'node_started', data: { ...EXEC_A } },
    { event_type: 'node_completed', data: { ...EXEC_A } },
    { event_type: 'node_started', data: { ...EXEC_B } },
    { event_type: 'node_failed', data: { ...EXEC_B, error: 'e2e seeded iteration failure' } },
    { event_type: 'node_started', data: { ...EXEC_D } },
    { event_type: 'node_failed', data: { ...EXEC_D, error: 'e2e seeded first failure' } },
    { event_type: 'node_started', data: { ...EXEC_C } },
    { event_type: 'node_failed', data: { ...EXEC_C, error: 'e2e seeded retry failure' } },
    { event_type: 'node_started', data: { ...EXEC_E } },
    { event_type: 'node_completed', data: { ...EXEC_E } },
    { event_type: 'node_started', data: { ...EXEC_F } },
    { event_type: 'node_completed', data: { ...EXEC_F } },
    { event_type: 'node_started', data: {} },
    ...(live ? [] : [{ event_type: 'node_completed', data: {} }]),
  ];
  seedStore(archon, {
    runId,
    nodeId: OCC_NODE,
    events,
    messages: OCC_MESSAGES,
    runStatus: live ? 'running' : undefined,
  });
  seedStore(archon, {
    runId,
    nodeId: FLAT_NODE,
    events: [
      { event_type: 'node_started', data: {} },
      { event_type: 'node_completed', data: {} },
    ],
    messages: [
      { kind: 'text', payload: { text: 'E2E flat row one' }, metadata: null },
      { kind: 'text', payload: { text: 'E2E flat row two' }, metadata: null },
      { kind: 'text', payload: { text: 'E2E flat row three' }, metadata: null },
    ],
  });
}

async function seededRun(archon: ArchonRuntime, live = false): Promise<string> {
  const runId = await archon.runWorkflow();
  seedOccurrenceTranscript(archon, runId, live);
  return runId;
}

function roomRegion(page: Page, nodeId = OCC_NODE): Locator {
  return page.getByRole('region', { name: `${nodeId} room` });
}

function navigatorSelect(page: Page, nodeId = OCC_NODE): Locator {
  return roomRegion(page, nodeId).getByLabel('Jump to', { exact: true });
}

/** The Console `Execution` select (room header, outside the room region). */
function executionSelect(page: Page): Locator {
  return page.getByLabel('Execution', { exact: true });
}

/** Value of the Execution option whose rowId contains `match` (':unscoped:' or an occurrence id). */
async function executionRowId(page: Page, match: string): Promise<string> {
  const execution = executionSelect(page);
  await expect(execution).toBeVisible({ timeout: T.medium });
  const values = await execution
    .locator('option')
    .evaluateAll(options => options.map(option => option.getAttribute('value')));
  const rowId = values.find(value => value !== null && value.includes(match));
  expect(rowId, `Execution option matching ${match}`).toBeTruthy();
  return rowId ?? '';
}

async function selectExecution(page: Page, match: string): Promise<void> {
  await executionSelect(page).selectOption(await executionRowId(page, match));
}

/** Value of the navigator option labelled exactly `label` (options are occurrence ids). */
async function navigatorOptionValue(page: Page, label: string): Promise<string> {
  const value = await navigatorSelect(page)
    .locator('option')
    .filter({ hasText: label })
    .first()
    .getAttribute('value');
  expect(value, `navigator option "${label}"`).toBeTruthy();
  return value ?? '';
}

async function expectGroupHeadings(room: Locator, labels: string[]): Promise<void> {
  for (const label of labels) {
    await expect(room.getByRole('heading', { name: label, level: 3, exact: true })).toBeVisible({
      timeout: T.medium,
    });
  }
}

/** Headings render in DOM order matching visual order; the unkeyed prefix row precedes all of them. */
async function expectDomOrderMatchesVisual(room: Locator): Promise<void> {
  const headings = await room.getByRole('heading', { level: 3 }).all();
  const boxes = await Promise.all(headings.map(async heading => heading.boundingBox()));
  for (let index = 1; index < boxes.length; index += 1) {
    expect(
      (boxes[index]?.y ?? 0) > (boxes[index - 1]?.y ?? 0),
      'heading visual order matches DOM order'
    ).toBe(true);
  }
  const prefixBox = await room.getByText(PREFIX_TEXT).boundingBox();
  expect(prefixBox, 'prefix row bounding box').toBeTruthy();
  expect(
    (prefixBox?.y ?? 0) < (boxes[0]?.y ?? 0),
    'unkeyed prefix row renders before the first heading (no heading of its own)'
  ).toBe(true);
}

/** B2 heading tokens: 10.5px mono uppercase, 0.08em tracking, 10px/5px margins, 1px rule. */
async function expectHeadingTokens(heading: Locator): Promise<void> {
  const tokens = await heading.evaluate(el => {
    const style = getComputedStyle(el);
    const rule = el.querySelector('span[aria-hidden="true"]');
    const ruleStyle = rule === null ? null : getComputedStyle(rule);
    return {
      fontSize: style.fontSize,
      fontFamily: style.fontFamily,
      textTransform: style.textTransform,
      letterSpacing: style.letterSpacing,
      marginTop: style.marginTop,
      marginBottom: style.marginBottom,
      ruleHeight: ruleStyle?.height ?? '',
      ruleWidth: ruleStyle?.width ?? '',
    };
  });
  expect(tokens.fontSize, 'heading font-size').toBe('10.5px');
  expect(/mono/i.test(tokens.fontFamily), 'heading font-family is mono').toBe(true);
  expect(tokens.textTransform, 'heading text-transform').toBe('uppercase');
  // 0.08em at 10.5px resolves to 0.84px in computed style.
  expect(Number.parseFloat(tokens.letterSpacing), 'heading letter-spacing ≈0.08em').toBeCloseTo(
    0.84,
    1
  );
  expect(tokens.marginTop, 'heading margin-top').toBe('10px');
  expect(tokens.marginBottom, 'heading margin-bottom').toBe('5px');
  expect(tokens.ruleHeight, 'heading rule height').toBe('1px');
  expect(Number.parseFloat(tokens.ruleWidth), 'heading rule extends').toBeGreaterThan(0);
}

/** No per-row live-region announcements: transcript content has no live-region roles. */
async function expectNoLiveRegion(scroller: Locator): Promise<void> {
  await expect(scroller.locator('[aria-live], [role="status"], [role="alert"]')).toHaveCount(0);
}

async function measuredRoomWidth(page: Page, surface: 'console' | 'legacy'): Promise<number> {
  const panel = page.locator(`#${ROOM_PANEL_ID[surface]}`);
  const box = (await panel.count()) > 0 ? await panel.boundingBox() : null;
  const measured = box ?? (await roomRegion(page).boundingBox());
  expect(measured, `${surface} room width`).toBeTruthy();
  const width = measured?.width ?? 0;
  expect(width, `${surface} room ≈460px authoritative width`).toBeGreaterThanOrEqual(452);
  expect(width, `${surface} room ≈460px authoritative width`).toBeLessThanOrEqual(468);
  return width;
}

async function expectNoHorizontalOverflow(page: Page, scroller: Locator): Promise<void> {
  const overflow = await scroller.evaluate(el => el.scrollWidth - el.clientWidth);
  expect(overflow, 'transcript must not overflow horizontally').toBeLessThanOrEqual(0);
  const pageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(pageOverflow, 'page must not overflow horizontally').toBeLessThanOrEqual(0);
}

async function activeElementId(page: Page): Promise<string | null> {
  return page.evaluate(() => document.activeElement?.id ?? null);
}

async function shot(page: Page, target: Locator | null, name: string): Promise<void> {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const path = join(EVIDENCE_DIR, name);
  if (target === null) await page.screenshot({ path });
  else await target.screenshot({ path });
}

test('[P1] [V:occurrence-nav.console-scopes] Console occurrence requests, sections, and Jump to', async ({
  page,
  archon,
}) => {
  await page.setViewportSize(CONSOLE_WIDE_VIEWPORT);
  const runId = await seededRun(archon);
  const observed = observeNodeMessagePages(page, runId, OCC_NODE);
  try {
    await openRunDetail(page, runId, OCC_NODE);
    const room = roomRegion(page);
    await expect(room).toBeVisible({ timeout: T.medium });

    // The node's latest execution row is the unscoped one, so the room opens
    // node-scoped: the request carries no occurrence filter and the transcript
    // spans all occurrences — the only state where occurrence headers render.
    await expect
      .poll(() => observed.records.some(record => record.occurrenceId === null))
      .toBe(true);
    await expectGroupHeadings(room, [LABEL_A, LABEL_B]);
    await expectDomOrderMatchesVisual(room);
    await expectHeadingTokens(room.getByRole('heading', { name: LABEL_A, level: 3, exact: true }));

    // Navigator contract: real label, disabled placeholder with the live
    // count, options verbatim in displayable-group order (status-only groups
    // are absent while the System filter is off — options derive from
    // displayable groups, not raw groups).
    const navigator = navigatorSelect(page);
    await expect(navigator).toBeVisible({ timeout: T.medium });
    expect(await navigator.locator('option').allTextContents()).toEqual([
      '2 occurrences',
      LABEL_A,
      LABEL_B,
    ]);
    await expect(navigator.locator('option').first()).toBeDisabled();
    await expect(navigator).toHaveValue('');

    // System on: the status-only groups become displayable — retry pair
    // ('Run 1 · failed' / 'Run 2 · retry · failed') and the nested-loop
    // disambiguation ('… · loopX' / '… · loopY') — with no new request.
    const requestsBefore = observed.records.length;
    await page.getByLabel('System', { exact: true }).check();
    await expectGroupHeadings(room, ALL_LABELS);
    expect(await navigator.locator('option').allTextContents()).toEqual([
      '6 occurrences',
      ...ALL_LABELS,
    ]);
    expect(observed.records.length, 'filter toggles must not refetch').toBe(requestsBefore);

    // Occurrence selection sends the exact occurrence+attempt filter and
    // flattens to one group (single-occurrence flat state).
    await selectExecution(page, OCC_A);
    await expect
      .poll(() =>
        observed.records.some(record => record.occurrenceId === OCC_A && record.attemptId === ATT_A)
      )
      .toBe(true);
    await expect(room.getByRole('heading')).toHaveCount(0);
    await expect(navigatorSelect(page)).toHaveCount(0);
    await expect(room.getByText(REPLY_A)).toBeVisible();
    await expect(room.locator('details[data-tool-id="e2e-occ-tool-b"]')).toHaveCount(0);
    await shot(page, room, 'console-single-occurrence-flat.png');

    // Back to the node-scoped execution row — multi-occurrence view again.
    await selectExecution(page, ':unscoped:');
    await expectGroupHeadings(room, ALL_LABELS);

    // Keyboard traversal: Tab reaches the navigator select in DOM order and
    // carries the shell focus ring (focus-visible screenshot).
    await page.getByRole('button', { name: 'Close' }).focus();
    let reached = false;
    for (let index = 0; index < 60 && !reached; index += 1) {
      await page.keyboard.press('Tab');
      reached = await navigator.evaluate(el => document.activeElement === el);
    }
    expect(reached, 'navigator select must be Tab-reachable').toBe(true);
    await shot(page, room, 'console-focus-select.png');

    // Commit on change: heading focus + scroll + aria-controls on the select.
    const scroller = room.locator('[data-testid="console-node-room-scroll"]');
    await navigator.selectOption(await navigatorOptionValue(page, LABEL_B));
    await expect.poll(async () => activeElementId(page)).toMatch(new RegExp(`occ-${OCC_B}$`));
    expect(
      await scroller.evaluate(el => el.scrollTop),
      'jump to an off-screen heading scrolls the transcript'
    ).toBeGreaterThan(0);
    await expect(navigator).toHaveAttribute('aria-controls', new RegExp(`occ-${OCC_B}$`));
    await expectNoLiveRegion(scroller);
    await shot(page, room, 'console-focus-heading.png');

    await expectNoHorizontalOverflow(page, scroller);
    const roomWidth = await measuredRoomWidth(page, 'console');
    await shot(
      page,
      room,
      `console-occurrence-room-${String(Math.round(roomWidth))}w-${String(CONSOLE_WIDE_VIEWPORT.width)}x${String(CONSOLE_WIDE_VIEWPORT.height)}.png`
    );
    test.info().annotations.push({
      type: 'evidence',
      description: `console room width ${String(Math.round(roomWidth))}px at ${String(CONSOLE_WIDE_VIEWPORT.width)}x${String(CONSOLE_WIDE_VIEWPORT.height)} viewport`,
    });
  } finally {
    observed.dispose();
  }
});

test('[P1] [V:occurrence-nav.console-filters] Console filters collapse displayable groups', async ({
  page,
  archon,
}) => {
  await page.setViewportSize(CONSOLE_WIDE_VIEWPORT);
  const runId = await seededRun(archon);
  await openRunDetail(page, runId, OCC_NODE);
  const room = roomRegion(page);
  await expect(room).toBeVisible({ timeout: T.medium });
  await expectGroupHeadings(room, [LABEL_A, LABEL_B]);
  const navigator = navigatorSelect(page);

  // Show the status-only groups, navigate to one, then hide System again: the
  // removed target collapses the select back to its placeholder with the
  // surviving count. Focus stays on the toggle the reader used (never <body>);
  // the non-interactive heading-removal redirect is covered by component tests.
  await page.getByLabel('System', { exact: true }).check();
  await expectGroupHeadings(room, ALL_LABELS);
  await navigator.selectOption(await navigatorOptionValue(page, LABEL_C));
  await expect.poll(async () => activeElementId(page)).toMatch(new RegExp(`occ-${OCC_C}$`));
  await page.getByLabel('System', { exact: true }).uncheck();
  await expect(navigator).toHaveValue('');
  expect(await navigator.locator('option').allTextContents()).toEqual([
    '2 occurrences',
    LABEL_A,
    LABEL_B,
  ]);
  await expect(room.getByRole('heading', { name: LABEL_C, exact: true })).toHaveCount(0);
  await expectGroupHeadings(room, [LABEL_A, LABEL_B]);
  const activeTag = await page.evaluate(() => document.activeElement?.tagName ?? '');
  expect(activeTag === 'BODY', 'focus must not fall back to <body>').toBe(false);

  // Hide tool calls: Iteration 2's only row is a tool call — one displayable
  // group remains, so headers and the navigator are both removed.
  await page.getByLabel('Tool calls', { exact: true }).uncheck();
  await expect(room.getByRole('heading')).toHaveCount(0);
  await expect(navigatorSelect(page)).toHaveCount(0);
  await expect(room.getByText(REPLY_A)).toBeVisible();

  const scroller = room.locator('[data-testid="console-node-room-scroll"]');
  await expectNoHorizontalOverflow(page, scroller);
  await shot(page, room, 'console-filtered-flat.png');
});

test('[P1] [V:occurrence-nav.flat] Metadata-free node transcript renders flat on both shells', async ({
  page,
  archon,
}) => {
  await page.setViewportSize(CONSOLE_WIDE_VIEWPORT);
  const runId = await seededRun(archon);
  const observed = observeNodeMessagePages(page, runId, FLAT_NODE);
  try {
    await openRunDetail(page, runId, FLAT_NODE);
    const consoleRoom = roomRegion(page, FLAT_NODE);
    await expect(consoleRoom).toBeVisible({ timeout: T.medium });
    await expect
      .poll(() => observed.records.some(record => record.occurrenceId === null))
      .toBe(true);
    await expect(consoleRoom.getByText('E2E flat row one')).toBeVisible();
    await expect(consoleRoom.getByRole('heading')).toHaveCount(0);
    await expect(navigatorSelect(page, FLAT_NODE)).toHaveCount(0);
    await shot(page, consoleRoom, 'console-unscoped-flat.png');

    await openLegacyRunDetail(page, runId);
    await expect(page.getByText(/e2e-usage-record/i).first()).toBeVisible({ timeout: T.medium });
    const logsTab = page.getByRole('tab', { name: 'Logs' });
    if ((await logsTab.count()) > 0) await logsTab.click();
    await page.locator('button[id*="occ-none%3Aunscoped"]').click();
    const legacyRoom = roomRegion(page, FLAT_NODE);
    await expect(legacyRoom).toBeVisible({ timeout: T.medium });
    await expect(legacyRoom.getByText('E2E flat row one')).toBeVisible();
    await expect(legacyRoom.getByRole('heading')).toHaveCount(0);
    await expect(navigatorSelect(page, FLAT_NODE)).toHaveCount(0);
    await shot(page, legacyRoom, 'legacy-unscoped-flat.png');
  } finally {
    observed.dispose();
  }
});

test('[P1] [V:occurrence-nav.legacy] Legacy node room shares the navigator contract', async ({
  page,
  archon,
}) => {
  await page.setViewportSize(LEGACY_WIDE_VIEWPORT);
  const runId = await seededRun(archon);
  const observed = observeNodeMessagePages(page, runId, OCC_NODE);
  try {
    await openLegacyRunDetail(page, runId);
    await expect(page.getByText(/e2e-usage-record/i).first()).toBeVisible({ timeout: T.medium });
    const logsTab = page.getByRole('tab', { name: 'Logs' });
    if ((await logsTab.count()) > 0) await logsTab.click();

    // The unscoped row's opener id embeds the encoded rowId — click it directly
    // so a same-named occurrence row can never satisfy the click.
    await page.locator('button[id*="occ-multi%3Aunscoped"]').click();
    const room = roomRegion(page);
    await expect(room).toBeVisible({ timeout: T.medium });
    await expect
      .poll(() => observed.records.some(record => record.occurrenceId === null))
      .toBe(true);
    // Legacy has no tool/system filters: all six groups render, including the
    // status-only retry and nested-loop groups.
    await expectGroupHeadings(room, ALL_LABELS);
    await expectDomOrderMatchesVisual(room);
    await expectHeadingTokens(room.getByRole('heading', { name: LABEL_A, level: 3, exact: true }));

    const navigator = navigatorSelect(page);
    await expect(navigator).toBeVisible({ timeout: T.medium });
    expect(await navigator.locator('option').allTextContents()).toEqual([
      '6 occurrences',
      ...ALL_LABELS,
    ]);
    await expect(navigator.locator('option').first()).toBeDisabled();
    await expect(navigator).toHaveValue('');

    // Same keyboard contract: the select is Tab-reachable and commits on
    // change. Close lives in the room header, outside the region.
    await page.getByRole('button', { name: 'Close' }).focus();
    let reached = false;
    for (let index = 0; index < 60 && !reached; index += 1) {
      await page.keyboard.press('Tab');
      reached = await navigator.evaluate(el => document.activeElement === el);
    }
    expect(reached, 'navigator select must be Tab-reachable').toBe(true);
    await shot(page, room, 'legacy-focus-select.png');

    const scroller = room.locator('[data-testid="node-transcript-scroll"]');
    await navigator.selectOption(await navigatorOptionValue(page, LABEL_C));
    await expect.poll(async () => activeElementId(page)).toMatch(new RegExp(`occ-${OCC_C}$`));
    expect(await scroller.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    await expect(navigator).toHaveAttribute('aria-controls', new RegExp(`occ-${OCC_C}$`));
    await expectNoLiveRegion(scroller);
    await shot(page, room, 'legacy-focus-heading.png');

    // Occurrence-scoped row: exact occurrence+attempt filter request, one
    // group, navigator gone (single-occurrence flat state on Legacy).
    await page.locator(`button[id*="${OCC_A}"]`).click();
    await expect
      .poll(() =>
        observed.records.some(record => record.occurrenceId === OCC_A && record.attemptId === ATT_A)
      )
      .toBe(true);
    await expect(room.getByRole('heading')).toHaveCount(0);
    await expect(navigatorSelect(page)).toHaveCount(0);
    await expect(room.getByText(REPLY_A)).toBeVisible();
    await expect(room.getByText('e2e seeded retry failure')).toHaveCount(0);
    await shot(page, room, 'legacy-single-occurrence-flat.png');

    await expectNoHorizontalOverflow(page, scroller);
    const roomWidth = await measuredRoomWidth(page, 'legacy');
    await page.locator('button[id*="occ-multi%3Aunscoped"]').click();
    await expectGroupHeadings(room, ALL_LABELS);
    await navigator.selectOption(await navigatorOptionValue(page, LABEL_B));
    await expect.poll(async () => activeElementId(page)).toMatch(new RegExp(`occ-${OCC_B}$`));
    await shot(
      page,
      room,
      `legacy-occurrence-room-${String(Math.round(roomWidth))}w-${String(LEGACY_WIDE_VIEWPORT.width)}x${String(LEGACY_WIDE_VIEWPORT.height)}.png`
    );
    test.info().annotations.push({
      type: 'evidence',
      description: `legacy room width ${String(Math.round(roomWidth))}px at ${String(LEGACY_WIDE_VIEWPORT.width)}x${String(LEGACY_WIDE_VIEWPORT.height)} viewport`,
    });
  } finally {
    observed.dispose();
  }
});

test('[P1] [V:occurrence-nav.live] Live append holds position, partial failure keeps groups', async ({
  page,
  archon,
}) => {
  await page.setViewportSize(CONSOLE_WIDE_VIEWPORT);
  const runId = await seededRun(archon, true);
  await openRunDetail(page, runId, OCC_NODE);
  const room = roomRegion(page);
  await expect(room).toBeVisible({ timeout: T.medium });
  await expectGroupHeadings(room, [LABEL_A, LABEL_B]);

  // Navigator jump puts the room in manual-hold (jumpToOccurrence clears
  // follow): a live append must not move the viewport, and the running row
  // surfaces 'Jump to latest' to re-pin.
  const navigator = navigatorSelect(page);
  const scroller = room.locator('[data-testid="console-node-room-scroll"]');
  await navigator.selectOption(await navigatorOptionValue(page, LABEL_B));
  await expect.poll(async () => activeElementId(page)).toMatch(new RegExp(`occ-${OCC_B}$`));
  const heldScrollTop = await scroller.evaluate(el => el.scrollTop);
  expect(heldScrollTop).toBeGreaterThan(0);
  await expect(room.getByRole('button', { name: 'Jump to latest' })).toBeVisible({
    timeout: T.medium,
  });

  // Append a tool row to group B — below the held viewport, so Chromium's
  // scroll anchoring has no reason to adjust scrollTop.
  seedStore(archon, {
    runId,
    nodeId: OCC_NODE,
    startSeq: OCC_MESSAGES.length + 1,
    messages: [
      {
        kind: 'tool',
        payload: {
          name: 'Read',
          id: 'e2e-occ-tool-live',
          input: { path: 'live.txt' },
          output: LIVE_TEXT,
        },
        metadata: { execution: EXEC_B, tool_phase: 'result', outcome: 'success' },
      },
    ],
  });
  await expect(room.locator('details[data-tool-id="e2e-occ-tool-live"]')).toHaveCount(1, {
    timeout: T.medium,
  });
  expect(
    Math.abs((await scroller.evaluate(el => el.scrollTop)) - heldScrollTop),
    'manual hold: live append does not move the viewport'
  ).toBeLessThanOrEqual(2);
  await shot(page, room, 'console-live-append-hold.png');

  // A failed refresh leaves loaded groups in place with an incomplete notice
  // and a reachable Retry (poll stops on error, so the state is stable).
  await page.route(
    `**/api/workflows/runs/${runId}/nodes/${OCC_NODE}/messages**`,
    route => void route.fulfill({ status: 500, body: 'e2e forced failure' })
  );
  await page.getByRole('button', { name: 'Jump to latest' }).click();
  const pinned = await scroller.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop);
  expect(pinned, 'Jump to latest re-pins to the bottom').toBeLessThanOrEqual(2);
  await expect(room.getByText('Failed to load node transcript')).toBeVisible({
    timeout: T.medium,
  });
  await expect(room.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expectGroupHeadings(room, [LABEL_A, LABEL_B]);
  await shot(page, room, 'console-partial-error.png');
  await page.unrouteAll();
});

test('[P1] [V:occurrence-nav.narrow] Narrow viewport keeps the navigator without overflow', async ({
  page,
  archon,
}) => {
  await page.setViewportSize(NARROW_VIEWPORT);
  const runId = await seededRun(archon);
  await openRunDetail(page, runId, OCC_NODE);
  const room = roomRegion(page);
  await expect(room).toBeVisible({ timeout: T.medium });
  await expectGroupHeadings(room, [LABEL_A, LABEL_B]);
  const navigator = navigatorSelect(page);
  await expect(navigator).toBeVisible({ timeout: T.medium });
  // The control stays operable: options elide but still activate.
  await navigator.selectOption(await navigatorOptionValue(page, LABEL_B));
  await expect.poll(async () => activeElementId(page)).toMatch(new RegExp(`occ-${OCC_B}$`));
  const scroller = room.locator('[data-testid="console-node-room-scroll"]');
  await expectNoHorizontalOverflow(page, scroller);
  const width = await page
    .locator(`#${ROOM_PANEL_ID.console}`)
    .boundingBox()
    .then(box => box?.width ?? 0);
  await shot(
    page,
    room,
    `console-occurrence-room-narrow-${String(NARROW_VIEWPORT.width)}x${String(NARROW_VIEWPORT.height)}-${String(Math.round(width))}w.png`
  );
  test.info().annotations.push({
    type: 'evidence',
    description: `console room width ${String(Math.round(width))}px at ${String(NARROW_VIEWPORT.width)}x${String(NARROW_VIEWPORT.height)} viewport (host small-viewport mode)`,
  });
});
