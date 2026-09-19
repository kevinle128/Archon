import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type Locator, type Page, type Request, type TestInfo } from '@playwright/test';

import { test, expect } from '../lib/playwright/suite';
import {
  FILE_EDIT_BARE_NODE,
  FILE_EDIT_FAILED_NODE,
  FILE_EDIT_NODE,
  FILE_EDIT_WRITE_NODE,
} from '../lib/playwright/archon-runtime';
import { listNodeMessages, openLegacyRunDetail, openRunDetail } from '../lib/playwright/run-detail';
import { T } from '../lib/playwright/timeouts';

/**
 * Story 1.4 full-stack proof: a persisted two-sided file tool row renders its
 * qualified old_string/new_string pair as an inline unified diff on both
 * node-room surfaces — collapsed `+2 −2` badges, an open body bar
 * (`file · 1 hunk · replace_all: false`), a single .tool-diff table in jsdiff
 * order, Raw round-trip, and the honest fallbacks (failed edit with the same
 * diff plus its normalized failure output, a write row on path-plus-preview,
 * and a bare no-input row on the generic fallback). The e2e-fake provider
 * emits the deterministic payloads; this spec owns the behavior, geometry,
 * accessibility, network-quietness, contrast, and capture evidence recorded
 * in plans/260919-0142-issue-177-inline-file-edit-diff/reports/.
 *
 * The fixture constants below are pinned mirrors of
 * packages/providers/src/e2e-fake/provider.ts — this standalone package never
 * imports product sources, so a provider-side drift fails here loudly.
 */

type Surface = 'console' | 'legacy';

const ROW = 'details[data-tool-id]';
const ROW_SUMMARY = `${ROW} > summary`;
const BODY_BOX = '.tool-family-body';
const DIFF_TABLE = '.tool-diff';
const SPLIT_VIEWPORT = { width: 1440, height: 1000 } as const;
const NARROW_VIEWPORT = { width: 390, height: 844 } as const;
const ROOM_TOLERANCE_PX = 2;

/** Design reference widths: Legacy room authored at 460px, Console at 520px. */
const REFERENCE_WIDTH: Record<Surface, number> = { console: 520, legacy: 460 };
/** The forced shared width every surface must also hold. */
const SHARED_WIDTH = 460;
const ROOM_PANEL_ID: Record<Surface, string> = {
  console: 'console-run-room',
  legacy: 'legacy-run-room',
};
// Mirrors ROOM_SPLIT bounds in packages/web/src/lib/room-split-layout.ts.
const ROOM_RATIO_MIN = 24;
const ROOM_RATIO_MAX = 60;

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CAPTURES_DIR = join(
  REPO_ROOT,
  'plans',
  '260919-0142-issue-177-inline-file-edit-diff',
  'reports',
  'captures'
);
const MEASUREMENTS_FILE = join(CAPTURES_DIR, 'file-edit-measurements.json');

// Pinned mirrors of the e2e-fake provider's fileEdit payloads.
const EDIT_TOOL_NAME = 'Edit';
const EDIT_PATH = 'crates/gigo-harness-worker/src/auto_retry.rs';
const EDIT_OLD_MIN = 'min(31)';
const EDIT_OLD_SECS = 'secs + 1';
const EDIT_NEW_MIN = 'min(30)';
const EDIT_NEW_SECS = 'from_secs(secs)';
const EDIT_OUTPUT = `The file ${EDIT_PATH} has been updated successfully.`;
const FAILED_OUTPUT = 'String to replace not found in file.';
const WRITE_TOOL_NAME = 'Write';
const WRITE_PATH = 'notes/summary.md';
const WRITE_OUTPUT = 'File created successfully at: notes/summary.md';
const BARE_TOOL_NAME = 'edit';
const BARE_OUTPUT = 'edited notes/summary.md';
// Unicode minus U+2212, not an ASCII hyphen.
const MINUS = '−';

function roomRegion(page: Page, nodeId: string): Locator {
  return page.getByRole('region', { name: `${nodeId} room` });
}

async function openEditRoom(
  page: Page,
  surface: Surface,
  runId: string,
  nodeId: string
): Promise<Locator> {
  if (surface === 'console') {
    await openRunDetail(page, runId, nodeId);
  } else {
    await openLegacyRunDetail(page, runId);
    await expect(page.getByText(/e2e-file-edit/i).first()).toBeVisible({
      timeout: T.medium,
    });
    const logsTab = page.getByRole('tab', { name: 'Logs' });
    if ((await logsTab.count()) > 0) await logsTab.click();
    // (?![-\w]) keeps 'file-edit' from matching the '-failed/-write/-bare' ids.
    await page
      .getByRole('button', { name: new RegExp(`${nodeId}(?![-\\w])`) })
      .first()
      .click();
  }
  const room = roomRegion(page, nodeId);
  await expect(room).toBeVisible({ timeout: T.medium });
  await expect(room.locator(ROW_SUMMARY).first()).toBeVisible({ timeout: T.medium });
  return room;
}

/** The row for the node's single stored tool call, located by its real tool_use id. */
async function storedToolRow(
  page: Page,
  room: Locator,
  runId: string,
  nodeId: string,
  toolName: string
): Promise<Locator> {
  const messages = await listNodeMessages(page, runId, nodeId);
  const stored = messages.find(
    message => message.kind === 'tool' && message.payload.name === toolName
  );
  expect(stored, `stored ${toolName} tool message on ${nodeId}`).toBeTruthy();
  const toolUseId = stored?.payload.id;
  expect(typeof toolUseId, `tool_use id for ${toolName} on ${nodeId}`).toBe('string');
  const row = room.locator(`details[data-tool-id="${toolUseId as string}"]`);
  await expect(row).toBeVisible({ timeout: T.medium });
  return row;
}

/** The open-row body bar's own text — the leaf span whose text is the composed bar. */
async function bodyBarText(row: Locator): Promise<string> {
  return row.evaluate(el => {
    const leaf = Array.from(el.querySelectorAll('span')).find(
      span => span.children.length === 0 && (span.textContent ?? '').trimStart().startsWith('file')
    );
    return leaf?.textContent?.trim() ?? '';
  });
}

/**
 * Sizes the room region to a target width through the production ratio path —
 * same approach as task-dispatch-body.spec.ts: measure the resizable group,
 * write the exact room ratio into the persisted split key, remount so
 * `readRoomRatio` applies it, and assert the measured region width.
 */
async function setRoomWidth(
  page: Page,
  surface: Surface,
  runId: string,
  nodeId: string,
  target: number
): Promise<Locator> {
  const panel = page.locator(`#${ROOM_PANEL_ID[surface]}`);
  const metrics = await panel.evaluate(el => {
    const panelRect = el.getBoundingClientRect();
    const groupRect = el.parentElement?.getBoundingClientRect();
    return { panel: panelRect.width, group: groupRect?.width ?? 0 };
  });
  expect(metrics.group, 'resizable group width').toBeGreaterThan(0);
  const region = roomRegion(page, nodeId);
  const regionWidth = (await region.boundingBox())?.width ?? 0;
  const inset = metrics.panel - regionWidth;
  const ratio = Math.min(
    ROOM_RATIO_MAX,
    Math.max(ROOM_RATIO_MIN, ((target + inset) / metrics.group) * 100)
  );
  await page.evaluate(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
    },
    [`archon.run-room.ratio.${surface}`, String(ratio)]
  );
  const room = await openEditRoom(page, surface, runId, nodeId);
  const width = (await room.boundingBox())?.width ?? 0;
  expect(
    Math.abs(width - target),
    `measured room width ${String(width)} must land within ${String(target)}±${String(ROOM_TOLERANCE_PX)}`
  ).toBeLessThanOrEqual(ROOM_TOLERANCE_PX);
  return room;
}

/**
 * One-line proof for a row summary: bounded height, every direct child inside
 * the summary's vertical band, and no clipped content.
 */
async function expectSummaryOneLine(
  summary: Locator,
  label: string
): Promise<{ height: number; width: number }> {
  const box = await summary.boundingBox();
  expect(box, `${label} bounding box`).toBeTruthy();
  if (!box) throw new Error(`missing ${label} summary box`);
  expect(box.height, `${label} summary keeps one line (24–30px)`).toBeGreaterThanOrEqual(24);
  expect(box.height, `${label} summary keeps one line (24–30px)`).toBeLessThanOrEqual(30);
  const fits = await summary.evaluate(el => el.scrollWidth <= el.clientWidth + 1);
  expect(fits, `${label} summary content fits horizontally without clipping`).toBe(true);
  const childrenInside = await summary.evaluate(el => {
    const band = el.getBoundingClientRect();
    return Array.from(el.children).every(child => {
      const rect = child.getBoundingClientRect();
      return rect.top >= band.top - 1 && rect.bottom <= band.bottom + 1;
    });
  });
  expect(childrenInside, `${label} summary parts stay inside the single-line band`).toBe(true);
  return { height: box.height, width: box.width };
}

/**
 * No horizontal overflow attributable to the row body: the room stays inside
 * the viewport, never scrolls horizontally, and no rendered element inside the
 * tool row exceeds the page width.
 */
async function expectNoDiffBodyOverflow(
  room: Locator,
  row: Locator,
  context: string
): Promise<void> {
  const report = await row.evaluate(rowEl => {
    const roomEl = rowEl.closest('[role="region"]');
    const width = document.documentElement.clientWidth;
    const offenders: string[] = [];
    rowEl.querySelectorAll('*').forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      if (rect.right > width + 1 || rect.left < -1) {
        offenders.push(
          `${el.tagName}.${typeof el.className === 'string' ? (el.className.split(' ')[0] ?? '') : ''}`
        );
      }
    });
    const roomRect = roomEl?.getBoundingClientRect();
    return {
      roomInsideViewport:
        roomRect !== undefined && roomRect !== null
          ? roomRect.left >= -1 && roomRect.right <= width + 1
          : null,
      roomScroll: roomEl !== null ? roomEl.scrollWidth - roomEl.clientWidth : null,
      offenders: offenders.slice(0, 5),
    };
  });
  expect(report.roomInsideViewport, `room stays inside viewport ${context}`).toBe(true);
  expect(report.roomScroll, `room has no horizontal scroll ${context}`).toBeLessThanOrEqual(1);
  expect(report.offenders, `no diff-body element overflows the page ${context}`).toEqual([]);
}

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Parses any computed CSS color (incl. color-mix/oklch) through a 2d canvas. */
async function resolveColorIn(room: Locator, css: string): Promise<{ resolved: string; c: Rgba }> {
  return room.evaluate((roomEl, colorCss) => {
    const doc = roomEl.ownerDocument;
    const probe = doc.createElement('span');
    probe.style.color = colorCss;
    roomEl.appendChild(probe);
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

/** Effective background under an element: first non-transparent ancestor fill. */
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

/** Computed foreground color of one element, resolved through a 2d canvas. */
async function foregroundOf(el: Locator): Promise<{ resolved: string; c: Rgba }> {
  return el.evaluate((node: HTMLElement) => {
    const doc = node.ownerDocument;
    const color = doc.defaultView?.getComputedStyle(node).color ?? '';
    const ctx = doc.createElement('canvas').getContext('2d');
    if (ctx === null) return { resolved: color, c: { r: 0, g: 0, b: 0, a: 0 } };
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const data = ctx.getImageData(0, 0, 1, 1).data;
    return {
      resolved: color,
      c: { r: data[0] ?? 0, g: data[1] ?? 0, b: data[2] ?? 0, a: (data[3] ?? 0) / 255 },
    };
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

/** Writes a durable capture to the plan's captures dir and attaches it. */
async function captureEvidence(target: Locator, name: string, testInfo: TestInfo): Promise<void> {
  mkdirSync(CAPTURES_DIR, { recursive: true });
  const shot = await target.screenshot({ path: join(CAPTURES_DIR, name) });
  await testInfo.attach(name, { body: shot, contentType: 'image/png' });
}

/** Merges one section into file-edit-measurements.json so sections survive partial runs. */
function mergeMeasurements(section: string, data: Record<string, unknown>): void {
  mkdirSync(CAPTURES_DIR, { recursive: true });
  const current = existsSync(MEASUREMENTS_FILE)
    ? (JSON.parse(readFileSync(MEASUREMENTS_FILE, 'utf8')) as Record<string, unknown>)
    : {};
  current[section] = data;
  writeFileSync(MEASUREMENTS_FILE, `${JSON.stringify(current, null, 2)}\n`);
}

interface DiffLineFacts {
  codeClasses: string[];
  markers: string[];
  numbers: string[];
}

const EXPECTED_CODE_CLASSES = [
  'diff-code diff-code-normal',
  'diff-code diff-code-delete',
  'diff-code diff-code-delete',
  'diff-code diff-code-insert',
  'diff-code diff-code-insert',
  'diff-code diff-code-normal',
] as const;
const EXPECTED_MARKERS = ['', MINUS, MINUS, '+', '+', ''] as const;
const EXPECTED_NUMBERS = ['1', '2', '3', '2', '3', '4'] as const;

/** Cell classes, gutter markers, and line numbers of one mounted .tool-diff. */
async function diffLineFacts(diff: Locator): Promise<DiffLineFacts> {
  const codeClasses = await diff
    .locator('.diff-code')
    .evaluateAll(els => els.map(el => el.className));
  const markers = await diff
    .locator('.tool-diff-marker')
    .evaluateAll(els => els.map(el => el.textContent ?? ''));
  const numbers = await diff
    .locator('.tool-diff-line-number')
    .evaluateAll(els => els.map(el => el.textContent ?? ''));
  return { codeClasses, markers, numbers };
}

/**
 * Geometry proof for one open diff body: the table fits its box content width
 * within 2px, wraps instead of scrolling, and the 1ch marker + 3ch number
 * gutter stays readable.
 */
async function expectDiffGeometry(row: Locator, context: string): Promise<Record<string, unknown>> {
  const box = row.locator(BODY_BOX).first();
  const diff = box.locator(DIFF_TABLE);
  await expect(diff).toHaveCount(1);
  const metrics = await diff.evaluate(table => {
    const view = table.ownerDocument.defaultView;
    const tableRect = table.getBoundingClientRect();
    const boxEl = table.closest('.tool-family-body');
    const boxCs = boxEl !== null ? view?.getComputedStyle(boxEl) : undefined;
    const padX =
      Number.parseFloat(boxCs?.paddingLeft ?? '0') + Number.parseFloat(boxCs?.paddingRight ?? '0');
    const contentWidth = boxEl instanceof HTMLElement ? boxEl.clientWidth - padX : 0;
    const firstCode = table.querySelector('.diff-code');
    const codeCs = firstCode !== null ? view?.getComputedStyle(firstCode) : undefined;
    const marker = table.querySelector('.tool-diff-marker');
    const number = table.querySelector('.tool-diff-line-number');
    const gutterCell = table.querySelector('.diff-gutter');
    return {
      tableWidth: tableRect.width,
      tableScroll: table.scrollWidth - table.clientWidth,
      boxContentWidth: contentWidth,
      codeWhiteSpace: codeCs?.whiteSpace ?? '',
      codeOverflowWrap: codeCs?.overflowWrap ?? '',
      markerWidth: marker?.getBoundingClientRect().width ?? 0,
      numberWidth: number?.getBoundingClientRect().width ?? 0,
      gutterWidth: gutterCell?.getBoundingClientRect().width ?? 0,
      cellsFit: Array.from(table.querySelectorAll('.diff-code')).every(
        td => td.scrollWidth <= td.clientWidth + 1
      ),
    };
  });
  expect(
    Math.abs(metrics.tableWidth - metrics.boxContentWidth),
    `table width matches box content width within 2px ${context}`
  ).toBeLessThanOrEqual(2);
  expect(metrics.tableScroll, `table has no horizontal scroll ${context}`).toBeLessThanOrEqual(2);
  expect(metrics.cellsFit, `code cells wrap inside their column ${context}`).toBe(true);
  expect(metrics.codeWhiteSpace, `diff code wraps ${context}`).toBe('pre-wrap');
  expect(metrics.markerWidth, `1ch marker column stays readable ${context}`).toBeGreaterThan(0);
  expect(metrics.numberWidth, `3ch number column stays readable ${context}`).toBeGreaterThan(
    metrics.markerWidth
  );
  expect(
    metrics.gutterWidth,
    `marker + number fit inside the fixed gutter ${context}`
  ).toBeGreaterThanOrEqual(metrics.numberWidth);
  return metrics;
}

for (const surface of ['console', 'legacy'] as const) {
  test(`[P1] file-edit: qualified edit diff and honest fallbacks on ${surface}`, async ({
    page,
    archon,
  }, testInfo: TestInfo) => {
    test.setTimeout(T.xlong * 2);
    await page.setViewportSize(SPLIT_VIEWPORT);
    const started = await archon.runFileEditWorkflow();
    const evidence: Record<string, unknown> = { surface };

    // Request ledger: opening, toggling, and Raw must never leave the app
    // origin. The ledger attaches only around those interactions — page
    // navigations themselves legitimately fetch the app's declared webfonts.
    const appHost = new URL(archon.baseURL).host;
    const requests: string[] = [];
    const recordRequest = (request: Request): void => {
      requests.push(request.url());
    };

    // ---- file-edit node: the qualified edit -------------------------------
    let room = await openEditRoom(page, surface, started.runId, FILE_EDIT_NODE);
    const row = await storedToolRow(page, room, started.runId, FILE_EDIT_NODE, EDIT_TOOL_NAME);
    const toolUseId = (await row.getAttribute('data-tool-id')) ?? '';
    const summary = row.locator('> summary');
    await expect(row).toHaveJSProperty('open', false);
    await expect(summary).toContainText(EDIT_TOOL_NAME);
    await expect(summary).toContainText('auto_retry.rs');
    await expect(summary).toContainText('+2');
    await expect(summary).toContainText(`${MINUS}2`);
    const closedRow = await expectSummaryOneLine(summary, 'closed edit row');

    room = await setRoomWidth(
      page,
      surface,
      started.runId,
      FILE_EDIT_NODE,
      REFERENCE_WIDTH[surface]
    );
    const sizedRow = room.locator(`details[data-tool-id="${toolUseId}"]`);
    const sizedSummary = sizedRow.locator('> summary');
    await expect(sizedRow).toHaveJSProperty('open', false);
    const sizedClosed = await expectSummaryOneLine(
      sizedSummary,
      'closed edit row at reference width'
    );
    await captureEvidence(sizedRow, `${surface}-file-edit-closed.png`, testInfo);

    // Keyboard-open: bar, path, then the one bounded unified table. The
    // native `open` flag flips before React mounts the body, so wait for the
    // body box before reading the bar text.
    page.on('request', recordRequest);
    await sizedSummary.press('Enter');
    await expect(sizedRow).toHaveJSProperty('open', true);
    await expect(sizedRow.locator(BODY_BOX).first()).toBeVisible({ timeout: T.medium });
    const bar = await bodyBarText(sizedRow);
    expect(
      bar.startsWith('file · 1 hunk · replace_all: false'),
      `body bar "${bar}" begins with the file facts`
    ).toBe(true);

    const bodyBox = sizedRow.locator(BODY_BOX).first();
    const pathEl = bodyBox.locator('.text-node-command').first();
    await expect(pathEl).toContainText(EDIT_PATH);
    const diffTable = bodyBox.locator(DIFF_TABLE);
    await expect(diffTable).toHaveCount(1);
    const tableHandle = await diffTable.elementHandle();
    if (tableHandle === null) throw new Error('diff table did not mount');
    const pathPrecedesDiff = await pathEl.evaluate(
      (el, table) => (el.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
      tableHandle
    );
    expect(pathPrecedesDiff, 'open body shows the path before the diff').toBe(true);

    // jsdiff order: context, two deletes, two inserts, context — grouped, not
    // interleaved (the recorded snippet-relative deviation).
    const facts = await diffLineFacts(diffTable);
    expect(facts.codeClasses).toEqual([...EXPECTED_CODE_CLASSES]);
    const deleteCells = diffTable.locator('.diff-code-delete');
    await expect(deleteCells.nth(0)).toContainText(EDIT_OLD_MIN);
    await expect(deleteCells.nth(1)).toContainText(EDIT_OLD_SECS);
    const insertCells = diffTable.locator('.diff-code-insert');
    await expect(insertCells.nth(0)).toContainText(EDIT_NEW_MIN);
    await expect(insertCells.nth(1)).toContainText(EDIT_NEW_SECS);
    expect(facts.markers).toEqual([...EXPECTED_MARKERS]);
    expect(facts.numbers).toEqual([...EXPECTED_NUMBERS]);

    // Single hunk: no Decoration tbody at all.
    await expect(diffTable.locator('tbody.diff-decoration')).toHaveCount(0);

    // Success prose stays behind Raw; the normalized body carries only the diff.
    expect(await bodyBox.textContent(), 'success output never enters the body').not.toContain(
      EDIT_OUTPUT
    );

    // The diff adds no tab stop: no focusable descendants at all.
    const focusableInDiff = await diffTable.evaluate(
      el =>
        el.querySelectorAll('a[href], button, summary, input, select, textarea, [tabindex]').length
    );
    expect(focusableInDiff, 'diff table has no focusable descendants').toBe(0);

    // Focus order: summary -> Raw -> the existing next control, never the diff.
    const rawButton = sizedRow.getByRole('button', { name: /^Raw/ });
    await expect(rawButton).toBeVisible();
    await page.keyboard.press('Tab');
    expect(
      await rawButton.evaluate(el => el.ownerDocument.activeElement === el),
      'Tab from the open summary reaches the Raw toggle'
    ).toBe(true);
    await page.keyboard.press('Tab');
    const afterRaw = await page.evaluate(() => {
      const active = document.activeElement;
      return {
        tag: active?.tagName ?? '',
        text: (active?.textContent ?? '').trim().slice(0, 60),
        insideDiff: active !== null && active.closest('.tool-diff') !== null,
      };
    });
    expect(afterRaw.insideDiff, 'Tab past Raw never lands inside the diff').toBe(false);
    expect(afterRaw.tag, 'Tab past Raw reaches an existing control').not.toBe('');

    // Raw round-trip: the table unmounts, the stored payload shows the
    // original old_string, and closing Raw restores the identical diff.
    await rawButton.click();
    await expect(bodyBox.locator(DIFF_TABLE)).toHaveCount(0);
    const rawPanel = sizedRow.locator('pre');
    await expect(rawPanel).toContainText('old_string');
    await expect(rawPanel).toContainText('new_string');
    await expect(rawPanel).toContainText(EDIT_OLD_MIN);
    await rawButton.click();
    await expect(bodyBox.locator(DIFF_TABLE)).toHaveCount(1);
    const restored = await diffLineFacts(bodyBox.locator(DIFF_TABLE));
    expect(restored.codeClasses).toEqual(facts.codeClasses);
    expect(restored.numbers).toEqual(facts.numbers);
    page.off('request', recordRequest);

    await expectNoDiffBodyOverflow(room, sizedRow, 'edit row at reference width');
    const geometry = await expectDiffGeometry(sizedRow, 'edit row at reference width');
    await captureEvidence(
      sizedRow,
      `${surface}-file-edit-open-${String(REFERENCE_WIDTH[surface])}.png`,
      testInfo
    );

    // ---- file-edit-failed node: same diff, error outcome ------------------
    const failedRoom = await openEditRoom(page, surface, started.runId, FILE_EDIT_FAILED_NODE);
    const failedRow = await storedToolRow(
      page,
      failedRoom,
      started.runId,
      FILE_EDIT_FAILED_NODE,
      EDIT_TOOL_NAME
    );
    // Failed rows mount open — the attempted diff is visible without a click.
    await expect(failedRow).toHaveJSProperty('open', true);
    const failedSummary = failedRow.locator('> summary');
    await expect(failedSummary).toContainText('+2');
    await expect(failedSummary).toContainText(`${MINUS}2`);
    const failedDiff = failedRow.locator(`${BODY_BOX} ${DIFF_TABLE}`).first();
    await expect(failedDiff).toHaveCount(1);
    const failedFacts = await diffLineFacts(failedDiff);
    expect(failedFacts.codeClasses).toEqual([...EXPECTED_CODE_CLASSES]);
    const failedBoxes = failedRow.locator(BODY_BOX);
    await expect(failedBoxes).toHaveCount(2);
    // The normalized failure output lands in the second inset box, never the diff.
    await expect(failedBoxes.nth(1)).toContainText(FAILED_OUTPUT);
    expect(await failedBoxes.first().textContent()).not.toContain(FAILED_OUTPUT);
    await captureEvidence(failedRow, `${surface}-file-edit-failed.png`, testInfo);

    // ---- file-edit-write node: path + preview, no pair --------------------
    const writeRoom = await openEditRoom(page, surface, started.runId, FILE_EDIT_WRITE_NODE);
    const writeRow = await storedToolRow(
      page,
      writeRoom,
      started.runId,
      FILE_EDIT_WRITE_NODE,
      WRITE_TOOL_NAME
    );
    const writeSummary = writeRow.locator('> summary');
    await expect(writeSummary).toContainText('summary.md');
    const writeSummaryText = (await writeSummary.textContent()) ?? '';
    expect(writeSummaryText, 'write summary carries no fabricated diff badge').not.toContain(
      `${MINUS}2`
    );
    page.on('request', recordRequest);
    await writeSummary.press('Enter');
    await expect(writeRow).toHaveJSProperty('open', true);
    await expect(writeRow.locator(DIFF_TABLE)).toHaveCount(0);
    const writeBox = writeRow.locator(BODY_BOX).first();
    await expect(writeBox.locator('.text-node-command').first()).toContainText(WRITE_PATH);
    await expect(writeBox).toContainText(WRITE_OUTPUT);
    await expectNoDiffBodyOverflow(writeRoom, writeRow, 'write row at reference width');
    await captureEvidence(writeRow, `${surface}-file-edit-write.png`, testInfo);
    page.off('request', recordRequest);

    // ---- file-edit-bare node: generic no-input fallback --------------------
    const bareRoom = await openEditRoom(page, surface, started.runId, FILE_EDIT_BARE_NODE);
    const bareRow = await storedToolRow(
      page,
      bareRoom,
      started.runId,
      FILE_EDIT_BARE_NODE,
      BARE_TOOL_NAME
    );
    const bareSummary = bareRow.locator('> summary');
    await expect(bareSummary).toContainText(BARE_TOOL_NAME);
    page.on('request', recordRequest);
    await bareSummary.press('Enter');
    await expect(bareRow).toHaveJSProperty('open', true);
    await expect(bareRow.locator(DIFF_TABLE)).toHaveCount(0);
    const bareBox = bareRow.locator(BODY_BOX).first();
    // No input was stored, so the salient-name fallback labels the path slot.
    await expect(bareBox.locator('.text-node-command').first()).toHaveText(BARE_TOOL_NAME);
    await expect(bareBox).toContainText(BARE_OUTPUT);
    await expectNoDiffBodyOverflow(bareRoom, bareRow, 'bare row at reference width');
    await captureEvidence(bareRow, `${surface}-file-edit-bare.png`, testInfo);
    page.off('request', recordRequest);

    // ---- network quietness --------------------------------------------------
    const external = requests.filter(url => {
      try {
        const parsed = new URL(url);
        if (parsed.protocol === 'data:' || parsed.protocol === 'blob:') return false;
        return parsed.host !== appHost;
      } catch {
        return false;
      }
    });
    expect(external, 'no open/toggle request left the app origin').toEqual([]);

    evidence.edit = {
      toolUseId,
      closedRow,
      sizedClosed,
      bar,
      facts,
      focusableInDiff,
      afterRaw,
      geometry,
    };
    evidence.failed = {
      mountedOpen: true,
      boxCount: 2,
      facts: failedFacts,
    };
    await testInfo.attach(`${surface}-file-edit-evidence.json`, {
      body: JSON.stringify(evidence, null, 2),
      contentType: 'application/json',
    });
    mergeMeasurements(`behavior-${surface}`, evidence);
  });

  test(`[P1] file-edit: diff geometry holds across the viewport matrix on ${surface}`, async ({
    page,
    archon,
  }, testInfo: TestInfo) => {
    test.setTimeout(T.xlong * 2);
    const started = await archon.runFileEditWorkflow();
    const geometry: Record<string, unknown> = { surface };

    // Reference state: room at the surface's design width in 1440x1000.
    await page.setViewportSize(SPLIT_VIEWPORT);
    let room = await openEditRoom(page, surface, started.runId, FILE_EDIT_NODE);
    room = await setRoomWidth(
      page,
      surface,
      started.runId,
      FILE_EDIT_NODE,
      REFERENCE_WIDTH[surface]
    );
    const row = room.locator(ROW).first();
    const summary = row.locator('> summary');
    await expectSummaryOneLine(summary, 'edit row at reference width');
    await summary.press('Enter');
    await expect(row).toHaveJSProperty('open', true);
    geometry.reference = await expectDiffGeometry(row, 'at reference width');
    await expectNoDiffBodyOverflow(room, row, 'at reference width');

    // Forced shared width: the same room pinned to 460px on both surfaces.
    const sharedRoom = await setRoomWidth(
      page,
      surface,
      started.runId,
      FILE_EDIT_NODE,
      SHARED_WIDTH
    );
    const sharedRow = sharedRoom.locator(ROW).first();
    const sharedSummary = sharedRow.locator('> summary');
    await expectSummaryOneLine(sharedSummary, 'edit row at shared 460px');
    await sharedSummary.press('Enter');
    await expect(sharedRow).toHaveJSProperty('open', true);
    geometry.shared = await expectDiffGeometry(sharedRow, 'at shared 460px');
    await expectNoDiffBodyOverflow(sharedRoom, sharedRow, 'at shared 460px');
    await captureEvidence(sharedRow, `${surface}-file-edit-open-460.png`, testInfo);

    // Narrow state: production responsive layout at 390x844.
    await page.setViewportSize(NARROW_VIEWPORT);
    const narrowRoom = await openEditRoom(page, surface, started.runId, FILE_EDIT_NODE);
    const narrowRow = narrowRoom.locator(ROW).first();
    const narrowSummary = narrowRow.locator('> summary');
    await expectSummaryOneLine(narrowSummary, 'edit row at 390px');
    await narrowSummary.press('Enter');
    await expect(narrowRow).toHaveJSProperty('open', true);
    geometry.narrow = await expectDiffGeometry(narrowRow, 'at 390x844');
    await expectNoDiffBodyOverflow(narrowRoom, narrowRow, 'at 390x844');
    await captureEvidence(narrowRow, `${surface}-file-edit-open-390.png`, testInfo);

    await testInfo.attach(`${surface}-file-edit-geometry.json`, {
      body: JSON.stringify(geometry, null, 2),
      contentType: 'application/json',
    });
    mergeMeasurements(`geometry-${surface}`, geometry);
  });
}

// "Both themes": the app ships dark-only (EXPERIENCE.md); the theme axis is
// the two token sources — Legacy resolves index.css, Console resolves
// experiments/console/theme.css — so each surface's pass covers its theme.
test('[P1] file-edit: diff text, markers, numbers, and badges resolve to >=4.5:1 on both themes', async ({
  page,
  archon,
}, testInfo: TestInfo) => {
  test.setTimeout(T.xlong * 2);
  await page.setViewportSize(SPLIT_VIEWPORT);
  const started = await archon.runFileEditWorkflow();
  const evidence: Record<string, Record<string, number | string>> = {};

  for (const surface of ['console', 'legacy'] as const) {
    const room = await openEditRoom(page, surface, started.runId, FILE_EDIT_NODE);
    const row = await storedToolRow(page, room, started.runId, FILE_EDIT_NODE, EDIT_TOOL_NAME);
    const summary = row.locator('> summary');
    await summary.press('Enter');
    await expect(row).toHaveJSProperty('open', true);
    const diff = row.locator(`${BODY_BOX} ${DIFF_TABLE}`).first();
    await expect(diff).toHaveCount(1);

    const summaryBg = await effectiveBackground(summary);
    const insertCodeBg = await effectiveBackground(diff.locator('.diff-code-insert').first());
    const deleteCodeBg = await effectiveBackground(diff.locator('.diff-code-delete').first());
    const normalCodeBg = await effectiveBackground(diff.locator('.diff-code-normal').first());
    const insertGutterBg = await effectiveBackground(diff.locator('.diff-gutter-insert').first());
    const deleteGutterBg = await effectiveBackground(diff.locator('.diff-gutter-delete').first());
    const normalGutterBg = await effectiveBackground(
      diff.locator('.diff-gutter:not(.diff-gutter-insert):not(.diff-gutter-delete)').first()
    );

    const surfaceEvidence: Record<string, number | string> = {
      'summary background': summaryBg.resolved,
      'insert code background': insertCodeBg.resolved,
      'delete code background': deleteCodeBg.resolved,
      'normal code background': normalCodeBg.resolved,
      'insert gutter background': insertGutterBg.resolved,
      'delete gutter background': deleteGutterBg.resolved,
      'normal gutter background': normalGutterBg.resolved,
    };

    const addBadge = summary.getByText('+2', { exact: true });
    const delBadge = summary.getByText(`${MINUS}2`, { exact: true });
    const tones: { label: string; locator: Locator; bg: Rgba }[] = [
      { label: '+2 badge at rest', locator: addBadge, bg: summaryBg.c },
      { label: '−2 badge at rest', locator: delBadge, bg: summaryBg.c },
      {
        label: 'inserted code',
        locator: diff.locator('.diff-code-insert').first(),
        bg: insertCodeBg.c,
      },
      {
        label: 'deleted code',
        locator: diff.locator('.diff-code-delete').first(),
        bg: deleteCodeBg.c,
      },
      {
        label: 'context code',
        locator: diff.locator('.diff-code-normal').first(),
        bg: normalCodeBg.c,
      },
      {
        label: 'insert marker',
        locator: diff.locator('.diff-gutter-insert .tool-diff-marker').first(),
        bg: insertGutterBg.c,
      },
      {
        label: 'delete marker',
        locator: diff.locator('.diff-gutter-delete .tool-diff-marker').first(),
        bg: deleteGutterBg.c,
      },
      {
        label: 'insert line number',
        locator: diff.locator('.diff-gutter-insert .tool-diff-line-number').first(),
        bg: insertGutterBg.c,
      },
      {
        label: 'delete line number',
        locator: diff.locator('.diff-gutter-delete .tool-diff-line-number').first(),
        bg: deleteGutterBg.c,
      },
      {
        label: 'context line number',
        locator: diff
          .locator(
            '.diff-gutter:not(.diff-gutter-insert):not(.diff-gutter-delete) .tool-diff-line-number'
          )
          .first(),
        bg: normalGutterBg.c,
      },
    ];
    for (const tone of tones) {
      const fg = await foregroundOf(tone.locator);
      const ratio = contrastRatio(fg.c, tone.bg);
      surfaceEvidence[`${tone.label} resolved`] = fg.resolved;
      surfaceEvidence[`${tone.label} ratio`] = Number(ratio.toFixed(2));
      expect(ratio, `${surface} ${tone.label} contrast >= 4.5:1`).toBeGreaterThanOrEqual(4.5);
    }

    // Hover state: the summary takes --surface-hover; the badge foregrounds
    // must still clear 4.5:1 against the hovered effective background.
    await summary.hover();
    const hoverBg = await effectiveBackground(summary);
    surfaceEvidence['summary hover background'] = hoverBg.resolved;
    for (const badge of [
      { label: '+2 badge on hover', locator: addBadge },
      { label: '−2 badge on hover', locator: delBadge },
    ]) {
      const fg = await foregroundOf(badge.locator);
      const ratio = contrastRatio(fg.c, hoverBg.c);
      surfaceEvidence[`${badge.label} resolved`] = fg.resolved;
      surfaceEvidence[`${badge.label} ratio`] = Number(ratio.toFixed(2));
      expect(ratio, `${surface} ${badge.label} contrast >= 4.5:1`).toBeGreaterThanOrEqual(4.5);
    }

    // Token resolutions quoted by the visual acceptance report.
    const success = await resolveColorIn(room, 'var(--success)');
    const error = await resolveColorIn(room, 'var(--error)');
    const secondary = await resolveColorIn(room, 'var(--text-secondary)');
    const primary = await resolveColorIn(room, 'var(--text-primary)');
    surfaceEvidence['--success'] = success.resolved;
    surfaceEvidence['--error'] = error.resolved;
    surfaceEvidence['--text-secondary'] = secondary.resolved;
    surfaceEvidence['--text-primary'] = primary.resolved;

    evidence[surface] = surfaceEvidence;
    await captureEvidence(row, `${surface}-file-edit-contrast.png`, testInfo);
  }
  await testInfo.attach('file-edit-contrast.json', {
    body: JSON.stringify(evidence, null, 2),
    contentType: 'application/json',
  });
  mergeMeasurements('contrast', evidence);
});
