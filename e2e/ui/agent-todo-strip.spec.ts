import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type Locator, type Page, type TestInfo } from '@playwright/test';

import { test, expect } from '../lib/playwright/suite';
import {
  TODO_STRIP_NO_TODO_NODE,
  TODO_STRIP_TODO_NODE,
  type ArchonRuntime,
  type CliRunResult,
  UnsupportedSetupError,
} from '../lib/playwright/archon-runtime';
import { openLegacyRunDetail, openRunDetail } from '../lib/playwright/run-detail';
import { T } from '../lib/playwright/timeouts';

/**
 * Pinned todo strip — outside-in behavior + visual/a11y evidence (issue #178).
 *
 * The `e2e-todo-strip` fixture runs `todo-plan` (four folded `todo` calls —
 * init 12 items across Research/Implement, done, block, drop — plus 60 Read
 * calls for real scroll depth) alongside `no-todo` (tool calls only).
 *
 * Phase-1 cases prove mounting/collapse/status semantics; Phase-3 cases record
 * the acceptance evidence in
 * plans/260918-0826-issue-178-pinned-todo-strip/reports/visual-acceptance.md:
 * pinning geometry, internal body scroll, 460px anatomy, responsive/zoom,
 * keyboard/focus/motion, contrast ratios, and the Chromium AX tree. Captures
 * and todo-strip-metrics.json are written to the plan's reports/evidence/ dir.
 */

type Surface = 'console' | 'legacy';

const STRIP = 'section[aria-label="Todo"]';
const TOOL_ROW = 'details[data-tool-id]';
const TODO_METER = '[data-testid="todo-meter"]';
const SCROLLER_TESTID: Record<Surface, string> = {
  console: 'console-node-room-scroll',
  legacy: 'node-transcript-scroll',
};

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EVIDENCE_DIR = join(
  REPO_ROOT,
  'plans',
  '260918-0826-issue-178-pinned-todo-strip',
  'reports',
  'evidence'
);
const METRICS_FILE = join(EVIDENCE_DIR, 'todo-strip-metrics.json');

const TARGET_ROOM_WIDTH = 460;
const ROOM_TOLERANCE_PX = 2;
const SPLIT_VIEWPORT = { width: 1440, height: 1000 } as const;
const SWEEP_VIEWPORTS = [
  { name: '1440x1000', width: 1440, height: 1000 },
  { name: '1024x900', width: 1024, height: 900 },
  { name: '768x900', width: 768, height: 900 },
  { name: '390x844', width: 390, height: 844 },
] as const;
const ROOM_PANEL_ID: Record<Surface, string> = {
  console: 'console-run-room',
  legacy: 'legacy-run-room',
};
// Mirrors ROOM_SPLIT bounds in packages/web/src/lib/room-split-layout.ts.
const ROOM_RATIO_MIN = 24;
const ROOM_RATIO_MAX = 60;
// The one deliberate surface delta: --accent-bright on Legacy, --running on Console.
const RUNNING_TOKEN: Record<Surface, string> = {
  console: 'var(--running)',
  legacy: 'var(--accent-bright)',
};
const STATUS_WORDS = ['completed', 'in progress', 'blocked', 'pending', 'abandoned'] as const;
// Agent-authored fixture strings that must only ever render as text.
const AGENT_STRINGS = [
  'Map the message path',
  'CI has one build job',
  'Read the spec',
  'Review output',
  'Research',
  'Implement',
  'Wire Legacy',
  'Add the tests',
] as const;

function roomRegion(page: Page, nodeId: string): Locator {
  return page.getByRole('region', { name: `${nodeId} room` });
}

async function openNodeRoom(
  page: Page,
  surface: Surface,
  runId: string,
  nodeId: string
): Promise<Locator> {
  if (surface === 'console') {
    await openRunDetail(page, runId, nodeId);
  } else {
    await openLegacyRunDetail(page, runId);
    await expect(page.getByText(/e2e-todo-strip/i).first()).toBeVisible({ timeout: T.medium });
    const logsTab = page.getByRole('tab', { name: 'Logs' });
    if ((await logsTab.count()) > 0) await logsTab.click();
    await page
      .getByRole('button', { name: new RegExp(nodeId) })
      .first()
      .click();
  }
  const room = roomRegion(page, nodeId);
  await expect(room).toBeVisible({ timeout: T.medium });
  await expect(room.locator(TOOL_ROW).first()).toBeVisible({ timeout: T.medium });
  return room;
}

/** The strip's collapsible body element, resolved through the header's aria-controls. */
async function stripBody(strip: Locator): Promise<Locator> {
  const button = strip.getByRole('button');
  const bodyId = await button.getAttribute('aria-controls');
  expect(bodyId, 'todo strip header button exposes aria-controls').toBeTruthy();
  return strip.locator(`[id="${bodyId ?? ''}"]`);
}

/** ids of transcript tool rows currently intersecting the scroller's viewport band. */
async function visibleToolIds(scroller: Locator): Promise<string[]> {
  return scroller.evaluate(el => {
    const band = el.getBoundingClientRect();
    return Array.from(el.querySelectorAll('details[data-tool-id]'))
      .filter(row => {
        const rect = row.getBoundingClientRect();
        return rect.bottom > band.top && rect.top < band.bottom;
      })
      .map(row => row.getAttribute('data-tool-id') ?? '');
  });
}

async function runTodoStrip(page: Page, archon: ArchonRuntime): Promise<CliRunResult> {
  try {
    return await archon.runTodoStripWorkflow();
  } catch (error) {
    if (error instanceof UnsupportedSetupError) {
      test.info().annotations.push({ type: 'verification-setup', description: 'unsupported' });
    }
    throw error;
  }
}

/**
 * Sizes the room region to `TARGET_ROOM_WIDTH ± ROOM_TOLERANCE_PX` through the
 * production ratio path: measure the resizable group, write the exact room
 * ratio the panels need into the persisted split key, and remount so
 * `readRoomRatio` applies it. The measured region width — not the ratio — is
 * what gets asserted.
 */
async function setRoomWidth(page: Page, surface: Surface, runId: string): Promise<number> {
  const panel = page.locator(`#${ROOM_PANEL_ID[surface]}`);
  const metrics = await panel.evaluate(el => {
    const panelRect = el.getBoundingClientRect();
    const groupRect = el.parentElement?.getBoundingClientRect();
    return { panel: panelRect.width, group: groupRect?.width ?? 0 };
  });
  expect(metrics.group, 'resizable group width').toBeGreaterThan(0);
  const region = roomRegion(page, TODO_STRIP_TODO_NODE);
  const regionWidth = (await region.boundingBox())?.width ?? 0;
  const inset = metrics.panel - regionWidth;
  const ratio = Math.min(
    ROOM_RATIO_MAX,
    Math.max(ROOM_RATIO_MIN, ((TARGET_ROOM_WIDTH + inset) / metrics.group) * 100)
  );
  await page.evaluate(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
    },
    [`archon.run-room.ratio.${surface}`, String(ratio)]
  );
  const room = await openNodeRoom(page, surface, runId, TODO_STRIP_TODO_NODE);
  const width = (await room.boundingBox())?.width ?? 0;
  expect(
    Math.abs(width - TARGET_ROOM_WIDTH),
    `measured room width ${String(width)} must land within ${String(TARGET_ROOM_WIDTH)}±${String(ROOM_TOLERANCE_PX)}`
  ).toBeLessThanOrEqual(ROOM_TOLERANCE_PX);
  return width;
}

/** Writes a durable capture to the plan's evidence dir and attaches it to the test. */
async function captureEvidence(target: Locator, name: string, testInfo: TestInfo): Promise<void> {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const shot = await target.screenshot({ path: join(EVIDENCE_DIR, name) });
  await testInfo.attach(name, { body: shot, contentType: 'image/png' });
}

/**
 * Merges one section into todo-strip-metrics.json so independently owned
 * sections (geometry, overflow, contrast) survive whichever tests run.
 */
function mergeMetrics(section: string, data: Record<string, unknown>): void {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const current = existsSync(METRICS_FILE)
    ? (JSON.parse(readFileSync(METRICS_FILE, 'utf8')) as Record<string, unknown>)
    : {};
  current[section] = data;
  writeFileSync(METRICS_FILE, `${JSON.stringify(current, null, 2)}\n`);
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

interface AxNode {
  nodeId?: string;
  backendDOMNodeId?: number;
  childIds?: string[];
  ignored?: boolean;
  role?: { value?: unknown };
  name?: { value?: unknown };
  properties?: { name: string; value?: { value?: unknown } }[];
}

/** All StaticText values inside a node's subtree, in tree order. */
function staticTexts(node: AxNode, byId: Map<string, AxNode>): string[] {
  const out: string[] = [];
  const walk = (current: AxNode): void => {
    if (
      !current.ignored &&
      current.role?.value === 'StaticText' &&
      typeof current.name?.value === 'string'
    ) {
      out.push(current.name.value);
    }
    for (const childId of current.childIds ?? []) {
      const child = byId.get(childId);
      if (child !== undefined) walk(child);
    }
  };
  for (const childId of node.childIds ?? []) {
    const child = byId.get(childId);
    if (child !== undefined) walk(child);
  }
  return out;
}

/**
 * Reads Chromium's accessibility tree over CDP, scoped to the room region's
 * subtree — the exact name/role/state channel VoiceOver and NVDA consume for
 * this browser pairing. A Todo region found here is proven nested inside the
 * node-room region by construction.
 */
async function roomAxNodes(page: Page, nodeId: string): Promise<AxNode[]> {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('DOM.enable');
    await session.send('Accessibility.enable');
    const doc = (await session.send('DOM.getDocument', { depth: 1 })) as {
      root: { nodeId: number };
    };
    const query = (await session.send('DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector: `section[aria-label="${nodeId} room"]`,
    })) as { nodeId: number };
    if (query.nodeId === 0) return [];
    const ax = (await session.send('Accessibility.queryAXTree', {
      nodeId: query.nodeId,
    })) as { nodes: AxNode[] };
    return ax.nodes;
  } finally {
    await session.detach();
  }
}

/**
 * The page and room must never force horizontal scrolling where the room is
 * visible. Page-level overflow stays in the assertion because the acceptance
 * criterion explicitly requires it; naming outside offenders keeps failures
 * actionable without silently narrowing the gate.
 */
async function expectNoRoomDrivenOverflow(room: Locator, context = ''): Promise<void> {
  const report = await room.evaluate(roomEl => {
    const width = document.documentElement.clientWidth;
    const offenders: { tag: string; insideRoom: boolean }[] = [];
    document.querySelectorAll('body *').forEach(el => {
      const rect = el.getBoundingClientRect();
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
    `no room element overflows the page ${context} (outside offenders: ${report.outsideSample.join(', ') || 'none'}; page overflow ${String(report.pageOverflow)}px)`
  ).toBe(0);
}

/** The span inside the strip header/body whose exact textContent is `text`. */
function spanWithText(scope: Locator, text: string): Locator {
  return scope.locator('span').filter({ hasText: text }).last();
}

/** Header caret span (decorative ▾). */
function caretSpan(button: Locator): Locator {
  return button.locator('span').filter({ hasText: '▾' });
}

for (const surface of ['console', 'legacy'] as const) {
  test(`[P1] todo strip mounts once inside the todo-plan room and never inside no-todo on ${surface}`, async ({
    page,
    archon,
  }) => {
    test.setTimeout(T.xlong * 2);
    const run = await runTodoStrip(page, archon);
    const room = await openNodeRoom(page, surface, run.runId, TODO_STRIP_TODO_NODE);
    await expect(room.locator(STRIP)).toHaveCount(1);
    const plainRoom = await openNodeRoom(page, surface, run.runId, TODO_STRIP_NO_TODO_NODE);
    await expect(plainRoom.locator(STRIP)).toHaveCount(0);
  });

  test(`[P1] todo strip starts collapsed with the representative item and 1/12 on ${surface}`, async ({
    page,
    archon,
  }) => {
    test.setTimeout(T.xlong * 2);
    const run = await runTodoStrip(page, archon);
    const room = await openNodeRoom(page, surface, run.runId, TODO_STRIP_TODO_NODE);
    const strip = room.locator(STRIP);
    await expect(strip).toHaveCount(1);
    const button = strip.getByRole('button');
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(button).toContainText('Map the message path');
    await expect(button).toContainText('1/12');
    const body = await stripBody(strip);
    await expect(body).toBeHidden();
  });

  test(`[P1] todo strip expands on Enter, lists all five statuses, collapses on Space on ${surface}`, async ({
    page,
    archon,
  }) => {
    test.setTimeout(T.xlong * 2);
    const run = await runTodoStrip(page, archon);
    const room = await openNodeRoom(page, surface, run.runId, TODO_STRIP_TODO_NODE);
    const strip = room.locator(STRIP);
    await expect(strip).toHaveCount(1);
    const button = strip.getByRole('button');
    const body = await stripBody(strip);
    await button.press('Enter');
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(body).toBeVisible();
    await expect(body.getByRole('heading', { name: 'Research' })).toBeVisible();
    await expect(body.getByRole('heading', { name: 'Implement' })).toBeVisible();
    // One named example per status: completed, in progress, blocked, pending, abandoned.
    await expect(body.getByText('Read the spec')).toBeVisible();
    await expect(body.getByText('Map the message path')).toBeVisible();
    await expect(body.getByText('Run the suite')).toBeVisible();
    await expect(body.getByText(/blocked: CI has one build job/)).toBeVisible();
    await expect(body.getByText('Check contract conflicts')).toBeVisible();
    await expect(body.getByText('Review output')).toBeVisible();
    expect(await button.evaluate(el => el.ownerDocument.activeElement === el)).toBe(true);
    await button.press('Space');
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(body).toBeHidden();
    expect(await button.evaluate(el => el.ownerDocument.activeElement === el)).toBe(true);
  });

  test(`[P1] todo strip meter renders twelve decorative cells on ${surface}`, async ({
    page,
    archon,
  }) => {
    test.setTimeout(T.xlong * 2);
    const run = await runTodoStrip(page, archon);
    const room = await openNodeRoom(page, surface, run.runId, TODO_STRIP_TODO_NODE);
    await expect(room.locator(STRIP)).toHaveCount(1);
    const meter = room.locator(`${STRIP} ${TODO_METER}`);
    await expect(meter).toHaveCount(1);
    await expect(meter).toHaveAttribute('aria-hidden', 'true');
    await expect(meter.locator(':scope > *')).toHaveCount(12);
  });

  test(`[P1] todo strip leaves todo calls as one-line summaries on ${surface}`, async ({
    page,
    archon,
  }) => {
    test.setTimeout(T.xlong * 2);
    const run = await runTodoStrip(page, archon);
    const room = await openNodeRoom(page, surface, run.runId, TODO_STRIP_TODO_NODE);
    await expect(room.locator(STRIP)).toHaveCount(1);
    const todoRows = room.locator(TOOL_ROW).filter({ hasText: 'todo updated' });
    await expect(todoRows).toHaveCount(4);
    await expect(todoRows.filter({ hasText: 'op: init' })).toHaveCount(1);
    await expect(todoRows.filter({ hasText: 'op: done' })).toHaveCount(1);
    await expect(todoRows.filter({ hasText: 'op: block' })).toHaveCount(1);
    await expect(todoRows.filter({ hasText: 'op: drop' })).toHaveCount(1);
    // The folded checklist never appears inside a transcript tool row.
    for (const checklistText of [
      'Check contract conflicts',
      'Define acceptance cases',
      'Wire Legacy',
      'Add the tests',
    ]) {
      await expect(room.locator(TOOL_ROW).getByText(checklistText)).toHaveCount(0);
    }
  });

  test(`[P1] todo strip stays pinned while the transcript scrolls on ${surface}`, async ({
    page,
    archon,
  }, testInfo: TestInfo) => {
    test.setTimeout(T.xlong * 2);
    const run = await runTodoStrip(page, archon);
    const room = await openNodeRoom(page, surface, run.runId, TODO_STRIP_TODO_NODE);
    const strip = room.locator(STRIP);
    await expect(strip).toHaveCount(1);
    const scroller = room.getByTestId(SCROLLER_TESTID[surface]);
    await scroller.evaluate(el => {
      el.scrollTop = 0;
    });
    const initialTop = await scroller.evaluate(el => el.scrollTop);
    const topIds = await visibleToolIds(scroller);
    const before = await strip.boundingBox();
    const scrollerBox = await scroller.boundingBox();
    expect(before, 'todo strip has a bounding box').toBeTruthy();
    expect(scrollerBox, 'transcript scroller has a bounding box').toBeTruthy();
    // Flex siblings, never an overlay: the strip's bottom edge meets the
    // transcript viewport's top edge without covering it.
    expect((before?.y ?? 0) + (before?.height ?? 0)).toBeLessThanOrEqual((scrollerBox?.y ?? 0) + 1);
    // Jump to latest renders only on running/awaiting rows; this completed-run
    // room never shows it, but when present it must not overlap either.
    const jump = room.getByRole('button', { name: 'Jump to latest' });
    if ((await jump.count()) > 0) {
      const jumpBox = await jump.boundingBox();
      expect(jumpBox).toBeTruthy();
      expect((before?.y ?? 0) + (before?.height ?? 0)).toBeLessThanOrEqual((jumpBox?.y ?? 0) + 1);
    }
    await scroller.evaluate(el => {
      el.scrollTop = el.scrollHeight - el.clientHeight;
    });
    await expect
      .poll(() => scroller.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop), {
        timeout: T.medium,
      })
      .toBeLessThanOrEqual(1);
    const bottomIds = await visibleToolIds(scroller);
    const after = await strip.boundingBox();
    expect(after, 'todo strip keeps a bounding box after scrolling').toBeTruthy();
    expect(bottomIds.length).toBeGreaterThan(0);
    expect(topIds.some(id => bottomIds.includes(id))).toBe(false);
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      expect(
        Math.abs((after?.[key] ?? 0) - (before?.[key] ?? 0)),
        `strip ${key} stays within 1px while transcript scrolls to bottom`
      ).toBeLessThanOrEqual(1);
    }
    await captureEvidence(room, `${surface}-todo-scrolled-room.png`, testInfo);
    // Scrolling back to zero leaves the strip equally fixed.
    await scroller.evaluate(el => {
      el.scrollTop = 0;
    });
    await expect
      .poll(() => scroller.evaluate(el => el.scrollTop), { timeout: T.medium })
      .toBe(initialTop);
    const restored = await strip.boundingBox();
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      expect(
        Math.abs((restored?.[key] ?? 0) - (before?.[key] ?? 0)),
        `strip ${key} stays within 1px after scrolling back to zero`
      ).toBeLessThanOrEqual(1);
    }
  });

  test(`[P1] todo strip body scrolls internally without moving the transcript on ${surface}`, async ({
    page,
    archon,
  }) => {
    test.setTimeout(T.xlong * 2);
    const run = await runTodoStrip(page, archon);
    const room = await openNodeRoom(page, surface, run.runId, TODO_STRIP_TODO_NODE);
    const strip = room.locator(STRIP);
    await expect(strip).toHaveCount(1);
    const button = strip.getByRole('button');
    await button.press('Enter');
    const body = await stripBody(strip);
    await expect(body).toBeVisible();
    const metrics = await body.evaluate(el => ({
      maxHeight: el.ownerDocument.defaultView?.getComputedStyle(el).maxHeight ?? '',
      overflowY: el.ownerDocument.defaultView?.getComputedStyle(el).overflowY ?? '',
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    expect(metrics.maxHeight).toBe('168px');
    expect(metrics.overflowY).toBe('auto');
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
    const scroller = room.getByTestId(SCROLLER_TESTID[surface]);
    const transcriptTop = await scroller.evaluate(el => el.scrollTop);
    const stripBefore = await strip.boundingBox();
    // The final fixture item starts below the body's visible band…
    const finalItem = body.locator('li').filter({ hasText: 'Review output' });
    const bodyBox = await body.boundingBox();
    const preBox = await finalItem.boundingBox();
    expect(bodyBox).toBeTruthy();
    expect(preBox).toBeTruthy();
    expect(
      (preBox?.y ?? 0) + (preBox?.height ?? 0) > (bodyBox?.y ?? 0) + (bodyBox?.height ?? 0) + 1
    ).toBe(true);
    // …and scrolling the body to its bottom reveals it while the transcript
    // scrollTop and the strip container box stay unchanged.
    await body.evaluate(el => {
      el.scrollTop = el.scrollHeight;
    });
    await expect
      .poll(() => body.evaluate(el => el.scrollTop), { timeout: T.medium })
      .toBeGreaterThan(0);
    const postBox = await finalItem.boundingBox();
    const bodyBoxAfter = await body.boundingBox();
    expect(postBox).toBeTruthy();
    expect(postBox?.y ?? 0).toBeGreaterThanOrEqual((bodyBoxAfter?.y ?? 0) - 1);
    expect((postBox?.y ?? 0) + (postBox?.height ?? 0)).toBeLessThanOrEqual(
      (bodyBoxAfter?.y ?? 0) + (bodyBoxAfter?.height ?? 0) + 1
    );
    expect(await scroller.evaluate(el => el.scrollTop)).toBe(transcriptTop);
    const stripAfter = await strip.boundingBox();
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      expect(
        Math.abs((stripAfter?.[key] ?? 0) - (stripBefore?.[key] ?? 0)),
        `strip ${key} stays within 1px while its body scrolls`
      ).toBeLessThanOrEqual(1);
    }
  });

  test(`[P1] todo strip geometry and anatomy at 460px on ${surface}`, async ({
    page,
    archon,
  }, testInfo: TestInfo) => {
    test.setTimeout(T.xlong * 2);
    await page.setViewportSize(SPLIT_VIEWPORT);
    const run = await runTodoStrip(page, archon);
    await openNodeRoom(page, surface, run.runId, TODO_STRIP_TODO_NODE);
    const roomWidth = await setRoomWidth(page, surface, run.runId);
    expect(Math.abs(roomWidth - TARGET_ROOM_WIDTH)).toBeLessThanOrEqual(ROOM_TOLERANCE_PX);
    const room = roomRegion(page, TODO_STRIP_TODO_NODE);
    const strip = room.locator(STRIP);
    const button = strip.getByRole('button');
    const body = await stripBody(strip);

    const elevated = await resolveColorIn(room, 'var(--surface-elevated)');
    const surfaceBg = await resolveColorIn(room, 'var(--surface)');
    const hoverBg = await resolveColorIn(room, 'var(--surface-hover)');
    const running = await resolveColorIn(room, RUNNING_TOKEN[surface]);
    const success = await resolveColorIn(room, 'var(--success)');
    const warning = await resolveColorIn(room, 'var(--warning)');
    const borderBright = await resolveColorIn(room, 'var(--border-bright)');
    const textSecondary = await resolveColorIn(room, 'var(--text-secondary)');
    const textPrimary = await resolveColorIn(room, 'var(--text-primary)');

    // Container: full room width, flex-none, surface-elevated, no radius, 1px bottom rule.
    const stripBox = await strip.boundingBox();
    expect(stripBox).toBeTruthy();
    expect(Math.abs((stripBox?.width ?? 0) - roomWidth)).toBeLessThanOrEqual(1);
    const container = await strip.evaluate(el => {
      const cs = el.ownerDocument.defaultView?.getComputedStyle(el);
      return {
        flexGrow: cs?.flexGrow ?? '',
        flexShrink: cs?.flexShrink ?? '',
        background: cs?.backgroundColor ?? '',
        borderBottomWidth: cs?.borderBottomWidth ?? '',
        borderRadius: cs?.borderRadius ?? '',
      };
    });
    expect(container.flexGrow).toBe('0');
    expect(container.flexShrink).toBe('0');
    expect(container.background, 'container uses surface-elevated').toBe(elevated.resolved);
    expect(container.borderBottomWidth).toBe('1px');
    expect(container.borderRadius).toBe('0px');

    // Header: one line, 6/10 padding, ≥24px target, 8px gaps, surface-hover.
    const header = await button.evaluate(el => {
      const cs = el.ownerDocument.defaultView?.getComputedStyle(el);
      const band = el.getBoundingClientRect();
      const childrenInside = Array.from(el.children).every(child => {
        const rect = child.getBoundingClientRect();
        return rect.top >= band.top - 1 && rect.bottom <= band.bottom + 1;
      });
      return {
        paddingTop: cs?.paddingTop ?? '',
        paddingRight: cs?.paddingRight ?? '',
        paddingBottom: cs?.paddingBottom ?? '',
        paddingLeft: cs?.paddingLeft ?? '',
        columnGap: cs?.columnGap ?? '',
        minHeight: cs?.minHeight ?? '',
        whiteSpace: cs?.whiteSpace ?? '',
        height: band.height,
        childrenInside,
      };
    });
    expect(header.paddingTop).toBe('6px');
    expect(header.paddingBottom).toBe('6px');
    expect(header.paddingLeft).toBe('10px');
    expect(header.paddingRight).toBe('10px');
    expect(header.columnGap).toBe('8px');
    expect(header.whiteSpace).toBe('nowrap');
    expect(header.height, 'header target ≥24px').toBeGreaterThanOrEqual(24);
    expect(header.height, 'header stays one line').toBeLessThanOrEqual(40);
    expect(header.childrenInside, 'all header children inside the single-line band').toBe(true);
    await button.hover();
    const hoverColor = await button.evaluate(
      el => el.ownerDocument.defaultView?.getComputedStyle(el).backgroundColor ?? ''
    );
    expect(hoverColor, 'header hover uses --surface-hover').toBe(hoverBg.resolved);
    await page.mouse.move(0, 0);

    // Label: 10px/700/uppercase/0.07em/text-secondary.
    const label = await button.evaluate(el => {
      const node = Array.from(el.querySelectorAll('span')).find(
        s => s.textContent?.trim() === 'TODO'
      );
      const cs = node ? el.ownerDocument.defaultView?.getComputedStyle(node) : undefined;
      return {
        fontSize: cs?.fontSize ?? '',
        fontWeight: cs?.fontWeight ?? '',
        textTransform: cs?.textTransform ?? '',
        letterSpacing: cs?.letterSpacing ?? '',
        color: cs?.color ?? '',
      };
    });
    expect(label.fontSize).toBe('10px');
    expect(label.fontWeight).toBe('700');
    expect(label.textTransform).toBe('uppercase');
    expect(label.letterSpacing).toBe('0.7px'); // 0.07em × 10px
    expect(label.color).toBe(textSecondary.resolved);

    // Representative item: 11.5px mono, text-primary, fixed glyph, elided.
    const representative = await button.evaluate(el => {
      const node = Array.from(el.querySelectorAll('span')).find(
        s => s.textContent?.trim() === 'Map the message path'
      );
      const cs = node ? el.ownerDocument.defaultView?.getComputedStyle(node) : undefined;
      const glyph = node?.parentElement?.querySelector('span[aria-hidden="true"]');
      const gcs = glyph ? el.ownerDocument.defaultView?.getComputedStyle(glyph) : undefined;
      return {
        fontSize: cs?.fontSize ?? '',
        fontFamily: cs?.fontFamily ?? '',
        overflow: cs?.overflow ?? '',
        overflowX: cs?.overflowX ?? '',
        textOverflow: cs?.textOverflow ?? '',
        whiteSpace: cs?.whiteSpace ?? '',
        color: cs?.color ?? '',
        glyphColor: gcs?.color ?? '',
        glyphText: glyph?.textContent ?? '',
      };
    });
    expect(representative.fontSize).toBe('11.5px');
    expect(representative.fontFamily).toMatch(/mono/i);
    expect(representative.overflowX).toBe('hidden');
    expect(representative.textOverflow).toBe('ellipsis');
    expect(representative.whiteSpace).toBe('nowrap');
    expect(representative.color).toBe(textPrimary.resolved);
    expect(representative.glyphText).toBe('◐');
    expect(representative.glyphColor).toBe(running.resolved);

    // Meter: 12 decorative cells, 3px high, 2px gap, status token mapping.
    const meter = strip.locator(TODO_METER);
    const meterMetrics = await meter.evaluate(el => {
      const cs = el.ownerDocument.defaultView?.getComputedStyle(el);
      return {
        ariaHidden: el.getAttribute('aria-hidden'),
        columnGap: cs?.columnGap ?? '',
        cells: Array.from(el.children).map(cell => ({
          height: cell.getBoundingClientRect().height,
          background: el.ownerDocument.defaultView?.getComputedStyle(cell).backgroundColor ?? '',
        })),
      };
    });
    expect(meterMetrics.ariaHidden).toBe('true');
    expect(meterMetrics.columnGap).toBe('2px');
    expect(meterMetrics.cells).toHaveLength(12);
    for (const cell of meterMetrics.cells) {
      expect(Math.abs(cell.height - 3), 'meter cell is 3px high').toBeLessThanOrEqual(0.5);
    }
    // Fixture order: completed, in-progress, pending ×8, blocked, abandoned.
    expect(meterMetrics.cells[0]?.background).toBe(success.resolved);
    expect(meterMetrics.cells[1]?.background).toBe(running.resolved);
    expect(meterMetrics.cells[2]?.background).toBe(borderBright.resolved);
    expect(meterMetrics.cells[10]?.background).toBe(warning.resolved);
    expect(meterMetrics.cells[11]?.background).toBe(borderBright.resolved);

    // Count + caret: 10px mono count; 9px caret, 0° closed.
    const countStyle = await spanWithText(button, '1/12').evaluate(el => {
      const cs = el.ownerDocument.defaultView?.getComputedStyle(el);
      return {
        fontSize: cs?.fontSize ?? '',
        fontFamily: cs?.fontFamily ?? '',
        color: cs?.color ?? '',
      };
    });
    expect(countStyle.fontSize).toBe('10px');
    expect(countStyle.fontFamily).toMatch(/mono/i);
    expect(countStyle.color).toBe(textSecondary.resolved);
    const caret = await caretSpan(button).evaluate(el => {
      const cs = el.ownerDocument.defaultView?.getComputedStyle(el);
      return {
        fontSize: cs?.fontSize ?? '',
        width: el.getBoundingClientRect().width,
        rotate: cs?.rotate ?? '',
        duration: cs?.transitionDuration ?? '',
      };
    });
    expect(caret.fontSize).toBe('9px');
    expect(Math.abs(caret.width - 9)).toBeLessThanOrEqual(0.5);
    expect(caret.rotate, 'caret rests at 0° while closed').toBe('none');
    expect(caret.duration).toBe('0.12s');

    await captureEvidence(strip, `${surface}-todo-collapsed-460.png`, testInfo);

    // Body: 4/10/8 padding, top rule, 168px cap, real internal overflow.
    await button.press('Enter');
    await expect(body).toBeVisible();
    const bodyStyle = await body.evaluate(el => {
      const cs = el.ownerDocument.defaultView?.getComputedStyle(el);
      return {
        paddingTop: cs?.paddingTop ?? '',
        paddingRight: cs?.paddingRight ?? '',
        paddingBottom: cs?.paddingBottom ?? '',
        paddingLeft: cs?.paddingLeft ?? '',
        borderTopWidth: cs?.borderTopWidth ?? '',
        maxHeight: cs?.maxHeight ?? '',
        overflowY: cs?.overflowY ?? '',
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      };
    });
    expect(bodyStyle.paddingTop).toBe('4px');
    expect(bodyStyle.paddingRight).toBe('10px');
    expect(bodyStyle.paddingBottom).toBe('8px');
    expect(bodyStyle.paddingLeft).toBe('10px');
    expect(bodyStyle.borderTopWidth).toBe('1px');
    expect(bodyStyle.maxHeight).toBe('168px');
    expect(bodyStyle.overflowY).toBe('auto');
    expect(bodyStyle.scrollHeight, '12-item body really overflows').toBeGreaterThan(
      bodyStyle.clientHeight
    );

    // Phase headings: 10px/0.07em/4px top margin.
    const phaseStyle = await body.getByRole('heading', { name: 'Research' }).evaluate(el => {
      const cs = el.ownerDocument.defaultView?.getComputedStyle(el);
      return {
        fontSize: cs?.fontSize ?? '',
        letterSpacing: cs?.letterSpacing ?? '',
        marginTop: cs?.marginTop ?? '',
        textTransform: cs?.textTransform ?? '',
      };
    });
    expect(phaseStyle.fontSize).toBe('10px');
    expect(phaseStyle.letterSpacing).toBe('0.7px');
    expect(phaseStyle.marginTop).toBe('4px');
    expect(phaseStyle.textTransform).toBe('uppercase');

    // Item rows: 11.5px mono, line-height 1.85; current row carries surface
    // bg + text-primary + the 2px inset running marker.
    const itemStyle = await body
      .locator('li')
      .filter({ hasText: 'Check contract conflicts' })
      .evaluate(el => {
        const cs = el.ownerDocument.defaultView?.getComputedStyle(el);
        return {
          fontSize: cs?.fontSize ?? '',
          lineHeight: cs?.lineHeight ?? '',
          fontFamily: cs?.fontFamily ?? '',
          color: cs?.color ?? '',
        };
      });
    expect(itemStyle.fontSize).toBe('11.5px');
    expect(itemStyle.fontFamily).toMatch(/mono/i);
    expect(
      Math.abs(parseFloat(itemStyle.lineHeight) / 11.5 - 1.85),
      `item line-height ${itemStyle.lineHeight} ≈ 1.85`
    ).toBeLessThanOrEqual(0.01);
    expect(itemStyle.color).toBe(textSecondary.resolved);

    const currentRow = await body
      .locator('li')
      .filter({ hasText: 'Map the message path' })
      .evaluate(el => {
        const cs = el.ownerDocument.defaultView?.getComputedStyle(el);
        return {
          background: cs?.backgroundColor ?? '',
          color: cs?.color ?? '',
          boxShadow: cs?.boxShadow ?? '',
        };
      });
    expect(currentRow.background, 'current row uses surface bg').toBe(surfaceBg.resolved);
    expect(currentRow.color).toBe(textPrimary.resolved);
    expect(currentRow.boxShadow).toContain('inset');
    expect(currentRow.boxShadow).toContain('2px 0px 0px');
    expect(currentRow.boxShadow).toContain(running.resolved);

    await captureEvidence(strip, `${surface}-todo-expanded-460.png`, testInfo);

    mergeMetrics(`geometry.${surface}`, {
      roomWidth,
      container,
      header: {
        padding: `6px 10px`,
        columnGap: header.columnGap,
        minHeight: header.minHeight,
        measuredHeight: header.height,
        whiteSpace: header.whiteSpace,
      },
      label,
      representative: {
        fontSize: representative.fontSize,
        fontFamily: representative.fontFamily,
        elision: `${representative.overflowX}/${representative.textOverflow}/${representative.whiteSpace}`,
        color: representative.color,
        glyph: representative.glyphText,
      },
      meter: { cells: meterMetrics.cells.length, columnGap: meterMetrics.columnGap, cellHeight: 3 },
      count: countStyle,
      caret,
      body: bodyStyle,
      phase: phaseStyle,
      item: itemStyle,
      currentRow,
    });
    mergeMetrics(`overflow.${surface}`, {
      bodyMaxHeight: bodyStyle.maxHeight,
      bodyOverflowY: bodyStyle.overflowY,
      bodyScrollHeight: bodyStyle.scrollHeight,
      bodyClientHeight: bodyStyle.clientHeight,
      internalScroll: true,
    });
  });

  test(`[P1] todo strip stays operable across viewports and 200% zoom on ${surface}`, async ({
    page,
    archon,
  }) => {
    test.setTimeout(T.xlong * 2);
    const run = await runTodoStrip(page, archon);

    const assertOperable = async (label: string): Promise<void> => {
      const room = await openNodeRoom(page, surface, run.runId, TODO_STRIP_TODO_NODE);
      const strip = room.locator(STRIP);
      const button = strip.getByRole('button');
      await expect(strip).toHaveCount(1);
      // Header stays one line; count + caret survive; overflow never escapes.
      const buttonBox = await button.boundingBox();
      expect(buttonBox?.height ?? 0, `header target ≥24px at ${label}`).toBeGreaterThanOrEqual(24);
      expect(buttonBox?.height ?? 99, `header one line at ${label}`).toBeLessThanOrEqual(40);
      await expect(spanWithText(button, '1/12')).toBeVisible();
      await expect(caretSpan(button)).toBeVisible();
      const elides = await button.evaluate(el => {
        const node = Array.from(el.querySelectorAll('span')).find(
          s => s.textContent?.trim() === 'Map the message path'
        );
        const cs = node ? el.ownerDocument.defaultView?.getComputedStyle(node) : undefined;
        return {
          overflowX: cs?.overflowX ?? '',
          textOverflow: cs?.textOverflow ?? '',
          whiteSpace: cs?.whiteSpace ?? '',
          clipped: el.scrollWidth <= el.clientWidth + 1,
        };
      });
      expect(elides.overflowX, `representative elides at ${label}`).toBe('hidden');
      expect(elides.textOverflow).toBe('ellipsis');
      expect(elides.whiteSpace).toBe('nowrap');
      expect(elides.clipped, `header content elides rather than clipping at ${label}`).toBe(true);
      // Expanding must never cover the transcript's first visible row.
      await button.press('Enter');
      const body = await stripBody(strip);
      await expect(body).toBeVisible();
      const stripBox = await strip.boundingBox();
      const scroller = room.getByTestId(SCROLLER_TESTID[surface]);
      const scrollerBox = await scroller.boundingBox();
      expect(stripBox).toBeTruthy();
      expect(scrollerBox).toBeTruthy();
      expect((stripBox?.y ?? 0) + (stripBox?.height ?? 0)).toBeLessThanOrEqual(
        (scrollerBox?.y ?? 0) + 1
      );
      const firstRow = await scroller.evaluate(el => {
        const band = el.getBoundingClientRect();
        const rows = Array.from(el.querySelectorAll('details[data-tool-id]'));
        const first = rows.find(row => {
          const rect = row.getBoundingClientRect();
          return rect.bottom > band.top && rect.top < band.bottom;
        });
        return {
          rowCount: rows.length,
          bandTop: band.top,
          bandBottom: band.bottom,
          firstTop: first === undefined ? null : first.getBoundingClientRect().top,
        };
      });
      const bandHeight = firstRow.bandBottom - firstRow.bandTop;
      expect(bandHeight, `transcript scroller keeps positive height at ${label}`).toBeGreaterThan(
        0
      );
      // A fixture row needs ~28.5px of band to be visible at all; when the
      // expanded strip squeezes the transcript below that (e.g. 200% zoom on
      // a short viewport), non-overlap above is the surviving invariant — the
      // row is clipped by the scroller, never covered by the strip.
      if (bandHeight >= 28.5) {
        expect(
          firstRow.firstTop,
          `a transcript row stays visible at ${label} (rows ${String(firstRow.rowCount)}, band height ${String(bandHeight)})`
        ).not.toBeNull();
        expect(
          firstRow.firstTop ?? 0,
          `transcript's first row is not covered at ${label}`
        ).toBeGreaterThanOrEqual((scrollerBox?.y ?? 0) - 1);
      }
      // Section and body stay inside the room without horizontal scroll.
      expect(
        await room.evaluate(el => el.scrollWidth <= el.clientWidth + 1),
        `room has no horizontal scroll at ${label}`
      ).toBe(true);
      expect(
        await body.evaluate(el => el.scrollWidth <= el.clientWidth + 1),
        `body has no horizontal scroll at ${label}`
      ).toBe(true);
      await expectNoRoomDrivenOverflow(room, `at ${label} on ${surface}`);
      // The body's own scroll remains usable at the narrowest viewport.
      if (label === '390x844' || label === '200% zoom') {
        await body.evaluate(el => {
          el.scrollTop = el.scrollHeight;
        });
        await expect
          .poll(() => body.evaluate(el => el.scrollTop), { timeout: T.short })
          .toBeGreaterThan(0);
      }
      await button.press('Space');
      await expect(button).toHaveAttribute('aria-expanded', 'false');
    };

    for (const viewport of SWEEP_VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await assertOperable(viewport.name);
    }

    // Chromium 200% zoom emulation via device metrics (established approach).
    const chrome = await page.context().newCDPSession(page);
    try {
      await page.setViewportSize(SPLIT_VIEWPORT);
      await chrome.send('Emulation.setDeviceMetricsOverride', {
        width: SPLIT_VIEWPORT.width / 2,
        height: 500,
        deviceScaleFactor: 2,
        mobile: false,
        screenWidth: SPLIT_VIEWPORT.width,
        screenHeight: SPLIT_VIEWPORT.height,
      });
      await expect
        .poll(() => page.evaluate(() => window.innerWidth))
        .toBe(SPLIT_VIEWPORT.width / 2);
      await assertOperable('200% zoom');
    } finally {
      await chrome.send('Emulation.clearDeviceMetricsOverride');
      await chrome.detach();
    }
  });

  test(`[P1] todo strip keyboard focus motion and scope remount on ${surface}`, async ({
    page,
    archon,
  }) => {
    test.setTimeout(T.xlong * 2);
    const run = await runTodoStrip(page, archon);
    const room = await openNodeRoom(page, surface, run.runId, TODO_STRIP_TODO_NODE);
    const strip = room.locator(STRIP);
    const button = strip.getByRole('button');
    const body = await stripBody(strip);

    // The header is the first focusable control inside the room region.
    const first = await room.evaluate(roomEl => {
      const focusable = roomEl.querySelector(
        'button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable === null) return null;
      return {
        inStrip: focusable.closest('section[aria-label="Todo"]') !== null,
        ariaExpanded: focusable.getAttribute('aria-expanded'),
      };
    });
    expect(first, 'room region has a focusable control').toBeTruthy();
    expect(first?.inStrip, 'todo header is the room region’s first focusable').toBe(true);
    expect(first?.ariaExpanded).toBe('false');

    // While collapsed, no hidden body child can enter the tab order: the body
    // carries no focusable descendants, and Tab from the header lands outside
    // the strip entirely (Shift+Tab returns).
    expect(
      await body.locator('a, button, input, select, textarea, summary, [tabindex]').count(),
      'collapsed body holds no focusable children'
    ).toBe(0);
    await button.focus();
    await page.keyboard.press('Tab');
    const afterTab = await page.evaluate(() => {
      const active = document.activeElement;
      const stripEl = document.querySelector('section[aria-label="Todo"]');
      return {
        inStrip: stripEl?.contains(active) ?? false,
        inBody: active?.closest('[data-testid="todo-list"]') !== null,
        tag: active?.tagName ?? '',
      };
    });
    expect(afterTab.inStrip, 'Tab leaves the collapsed strip').toBe(false);
    expect(afterTab.inBody, 'no hidden body child intercepts Tab').toBe(false);
    await page.keyboard.press('Shift+Tab');
    expect(
      await button.evaluate(el => el.ownerDocument.activeElement === el),
      'Shift+Tab returns focus to the header'
    ).toBe(true);

    // Click toggles with focus retained on the button.
    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(body).toBeVisible();
    expect(await button.evaluate(el => el.ownerDocument.activeElement === el)).toBe(true);
    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(await button.evaluate(el => el.ownerDocument.activeElement === el)).toBe(true);

    // Keyboard activation carries :focus-visible and the contracted outline:
    // 2px solid opaque --accent-bright, −2px Legacy / +2px Console offset.
    await button.press('Enter');
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    const focus = await button.evaluate(el => {
      const cs = el.ownerDocument.defaultView?.getComputedStyle(el);
      return {
        style: cs?.outlineStyle ?? '',
        width: cs?.outlineWidth ?? '',
        offset: cs?.outlineOffset ?? '',
        color: cs?.outlineColor ?? '',
        focusVisible: el.matches(':focus-visible'),
      };
    });
    expect(focus.focusVisible, 'keyboard activation carries :focus-visible').toBe(true);
    expect(focus.style).toBe('solid');
    expect(focus.width).toBe('2px');
    expect(focus.offset).toBe(surface === 'console' ? '2px' : '-2px');
    const accent = await resolveColorIn(room, 'var(--accent-bright)');
    expect(focus.color, 'focus outline resolves to --accent-bright').toBe(accent.resolved);

    // The full outline must really paint on all four sides: walk every
    // clipping ancestor (overflow ≠ visible) and prove the outline's outer
    // extent — border box + max(0, offset+width) — fits inside each clip box
    // (padding box + overflow-clip-margin when overflow:clip).
    const outlineCheck = await button.evaluate(el => {
      const view = el.ownerDocument.defaultView;
      const rect = el.getBoundingClientRect();
      const cs = view?.getComputedStyle(el);
      const reach = Math.max(
        0,
        (parseFloat(cs?.outlineOffset ?? '0') || 0) + (parseFloat(cs?.outlineWidth ?? '0') || 0)
      );
      const outline = {
        top: rect.top - reach,
        right: rect.right + reach,
        bottom: rect.bottom + reach,
        left: rect.left - reach,
      };
      const clippers: {
        tag: string;
        overflow: string;
        clipMargin: string;
        fits: boolean;
      }[] = [];
      let node: HTMLElement | null = el.parentElement;
      while (node !== null) {
        const ncs = view?.getComputedStyle(node);
        const ov = ncs?.overflow ?? 'visible';
        if (ov !== 'visible' && ov !== '') {
          const nr = node.getBoundingClientRect();
          const margin = ov === 'clip' ? parseFloat(ncs?.overflowClipMargin ?? '0') || 0 : 0;
          const clipBox = {
            top: nr.top + (parseFloat(ncs?.borderTopWidth ?? '0') || 0) - margin,
            right: nr.right - (parseFloat(ncs?.borderRightWidth ?? '0') || 0) + margin,
            bottom: nr.bottom - (parseFloat(ncs?.borderBottomWidth ?? '0') || 0) + margin,
            left: nr.left + (parseFloat(ncs?.borderLeftWidth ?? '0') || 0) - margin,
          };
          clippers.push({
            tag:
              node.tagName +
              (node.getAttribute('aria-label') ?? node.getAttribute('data-testid') ?? ''),
            overflow: ov,
            clipMargin: ncs?.overflowClipMargin ?? '',
            fits:
              outline.top >= clipBox.top - 0.5 &&
              outline.left >= clipBox.left - 0.5 &&
              outline.bottom <= clipBox.bottom + 0.5 &&
              outline.right <= clipBox.right + 0.5,
          });
        }
        node = node.parentElement;
      }
      return { reach, clippers };
    });
    const violation = outlineCheck.clippers.find(clipper => !clipper.fits);
    expect(
      violation,
      `focus outline clipped by ${JSON.stringify(violation)} (reach ${String(outlineCheck.reach)}px)`
    ).toBeUndefined();

    // Caret: 120ms rotation transition under normal motion, none under
    // prefers-reduced-motion. Tailwind's rotate-180 sets the standalone
    // `rotate` property (not `transform`), which transition-transform covers.
    const caretMetrics = async (): Promise<{
      duration: string;
      property: string;
      rotate: string;
    }> => {
      return caretSpan(button).evaluate(el => {
        const cs = el.ownerDocument.defaultView?.getComputedStyle(el);
        return {
          duration: cs?.transitionDuration ?? '',
          property: cs?.transitionProperty ?? '',
          rotate: cs?.rotate ?? '',
        };
      });
    };
    const normalMotion = await caretMetrics();
    expect(normalMotion.duration).toBe('0.12s');
    expect(normalMotion.property).toContain('rotate');
    await expect
      .poll(async () => (await caretMetrics()).rotate, { timeout: T.short })
      .toBe('180deg');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const reduced = await caretMetrics();
    expect(reduced.property, 'motion-reduce removes the caret transition').toBe('none');
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    // A same-scope update must preserve focus + expansion. The fixture run is
    // terminal so the 1s live poll is idle; Console proves it with a real
    // item-set change (Tool calls off), Legacy with a scroll-follow
    // transition that re-renders the pane under the same scope key.
    if (surface === 'console') {
      const toggle = page.getByRole('checkbox', { name: 'Tool calls' });
      await toggle.dispatchEvent('click'); // dispatched: keeps focus on the strip
      await expect(room.locator(TOOL_ROW)).toHaveCount(0);
      await expect(strip).toHaveCount(1);
      await expect(button).toHaveAttribute('aria-expanded', 'true');
      expect(
        await button.evaluate(el => el.ownerDocument.activeElement === el),
        'focus survives the same-scope content update'
      ).toBe(true);
      await toggle.dispatchEvent('click');
      await expect(room.locator(TOOL_ROW).first()).toBeVisible({ timeout: T.medium });
    } else {
      const scroller = room.getByTestId(SCROLLER_TESTID.legacy);
      const scrollBefore = await scroller.evaluate(el => el.scrollTop);
      await scroller.evaluate(el => {
        el.scrollTop = el.scrollTop > 0 ? 0 : el.scrollHeight;
      });
      await expect
        .poll(() => scroller.evaluate(el => el.scrollTop), { timeout: T.short })
        .not.toBe(scrollBefore);
      await expect(button).toHaveAttribute('aria-expanded', 'true');
      expect(
        await button.evaluate(el => el.ownerDocument.activeElement === el),
        'focus survives the same-scope re-render'
      ).toBe(true);
    }

    // Scope navigation mounts a new, collapsed control: switch to the no-todo
    // room and back without reloading the page.
    if (surface === 'console') {
      const otherOpener = page
        .locator('button[id^="console-log-"]')
        .filter({ hasText: TODO_STRIP_NO_TODO_NODE })
        .first();
      await otherOpener.click();
      await expect(roomRegion(page, TODO_STRIP_NO_TODO_NODE)).toBeVisible({
        timeout: T.medium,
      });
      expect(await page.locator(STRIP).count()).toBe(0);
      const todoOpener = page
        .locator('button[id^="console-log-"]')
        .filter({ hasText: TODO_STRIP_TODO_NODE })
        .first();
      await todoOpener.click();
    } else {
      await page
        .getByRole('button', { name: new RegExp(TODO_STRIP_NO_TODO_NODE) })
        .first()
        .click();
      await expect(roomRegion(page, TODO_STRIP_NO_TODO_NODE)).toBeVisible({
        timeout: T.medium,
      });
      expect(await page.locator(STRIP).count()).toBe(0);
      await page
        .getByRole('button', { name: new RegExp(TODO_STRIP_TODO_NODE) })
        .first()
        .click();
    }
    const reopened = roomRegion(page, TODO_STRIP_TODO_NODE);
    await expect(reopened).toBeVisible({ timeout: T.medium });
    const reopenedStrip = reopened.locator(STRIP);
    await expect(reopenedStrip).toHaveCount(1);
    await expect(
      reopenedStrip.getByRole('button'),
      'scope navigation remounts the strip collapsed'
    ).toHaveAttribute('aria-expanded', 'false');
  });

  test(`[P1] todo strip exposes one accessible Todo region on ${surface}`, async ({
    page,
    archon,
  }) => {
    test.setTimeout(T.xlong * 2);
    const run = await runTodoStrip(page, archon);
    const room = await openNodeRoom(page, surface, run.runId, TODO_STRIP_TODO_NODE);
    const strip = room.locator(STRIP);
    const button = strip.getByRole('button');

    // Collapsed tree: exactly one region named Todo inside the node-room
    // region; the header button carries the assembled name and expanded=false;
    // decorative meter/caret/glyphs never reach the tree; the hidden body
    // subtree is absent.
    const collapsed = await roomAxNodes(page, TODO_STRIP_TODO_NODE);
    const todoRegions = collapsed.filter(
      node => !node.ignored && node.role?.value === 'region' && node.name?.value === 'Todo'
    );
    expect(todoRegions, 'one Todo region inside the node-room region').toHaveLength(1);
    const collapsedButton = collapsed.find(node => !node.ignored && node.role?.value === 'button');
    expect(collapsedButton, 'header exposes a button node').toBeTruthy();
    const collapsedName = String(collapsedButton?.name?.value ?? '');
    expect(collapsedName).toContain('TODO');
    expect(collapsedName).toContain('in progress');
    expect(collapsedName).toContain('Map the message path');
    expect(collapsedName).toContain('1/12');
    for (const decorative of ['▾', '◐', '☑', '⊘', '☐']) {
      expect(collapsedName).not.toContain(decorative);
    }
    const collapsedExpanded = collapsedButton?.properties?.find(prop => prop.name === 'expanded');
    expect(collapsedExpanded?.value?.value).toBe(false);
    expect(
      collapsed.filter(node => !node.ignored && node.role?.value === 'heading'),
      'phase headings hidden while collapsed'
    ).toHaveLength(0);
    expect(
      collapsed.filter(node => !node.ignored && node.role?.value === 'listitem'),
      'todo items hidden while collapsed'
    ).toHaveLength(0);
    // No agent-authored text in ids, labels, or titles — only as text.
    const leaks = await strip.evaluate((el, needles: readonly string[]) => {
      const hits: string[] = [];
      el.querySelectorAll('*').forEach(node => {
        for (const attr of ['id', 'aria-label', 'aria-labelledby', 'title']) {
          const value = node.getAttribute(attr) ?? '';
          for (const needle of needles) {
            if (value.includes(needle)) hits.push(`${attr}="${value}"`);
          }
        }
      });
      return hits;
    }, AGENT_STRINGS);
    expect(leaks, 'agent strings stay out of ids/labels/titles').toEqual([]);

    // Expanded tree: phase headings and lists exposed. Chromium applies
    // text-transform when computing names, so headings surface as RESEARCH /
    // IMPLEMENT.
    await button.press('Enter');
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect
      .poll(
        async () => {
          const nodes = await roomAxNodes(page, TODO_STRIP_TODO_NODE);
          return nodes.some(
            node =>
              !node.ignored &&
              node.role?.value === 'heading' &&
              String(node.name?.value ?? '').toLowerCase() === 'research'
          );
        },
        { timeout: T.short }
      )
      .toBe(true);
    const expanded = await roomAxNodes(page, TODO_STRIP_TODO_NODE);
    const headings = expanded
      .filter(node => !node.ignored && node.role?.value === 'heading')
      .map(node => String(node.name?.value ?? '').toLowerCase());
    expect(headings).toEqual(expect.arrayContaining(['research', 'implement']));
    // listitem nodes carry no name; each item's spoken content is its child
    // StaticText set — walk childIds to prove one status phrase per item and
    // no duplicated blocked reason / dropped marker.
    const byId = new Map(
      expanded.filter(node => node.nodeId !== undefined).map(node => [node.nodeId as string, node])
    );
    const items = expanded.filter(node => !node.ignored && node.role?.value === 'listitem');
    expect(items, 'twelve todo items in the tree').toHaveLength(12);
    const textsByItem = items.map(item => staticTexts(item, byId));
    for (const texts of textsByItem) {
      const statusCount = texts.filter(text =>
        STATUS_WORDS.some(word => text === word || text.startsWith(`${word} —`))
      ).length;
      expect(statusCount, `one status phrase in ${JSON.stringify(texts)}`).toBe(1);
      expect(
        texts.some(text => text.includes('·')),
        `decorative middot suffix stays out of the tree in ${JSON.stringify(texts)}`
      ).toBe(false);
      expect(
        texts.some(text => text.includes('dropped')),
        `decorative dropped marker stays out of the tree in ${JSON.stringify(texts)}`
      ).toBe(false);
    }
    const blocked = textsByItem.find(texts => texts.includes('Run the suite'));
    expect(blocked, 'blocked item present').toBeTruthy();
    expect(
      blocked?.filter(text => text.includes('CI has one build job')),
      'blocked reason spoken once, not duplicated by the decorative suffix'
    ).toHaveLength(1);
    expect(blocked?.some(text => text === 'blocked — CI has one build job')).toBe(true);
    const dropped = textsByItem.find(texts => texts.includes('Review output'));
    expect(dropped, 'abandoned item present').toBeTruthy();
    expect(dropped?.filter(text => text === 'abandoned')).toHaveLength(1);
    const decorativeNodes = expanded.filter(
      node =>
        !node.ignored && typeof node.name?.value === 'string' && /[▾◐☑⊘☐]/.test(node.name.value)
    );
    expect(decorativeNodes, 'meter cells, caret and glyphs stay out of the tree').toHaveLength(0);
    const expandedButton = expanded.find(node => !node.ignored && node.role?.value === 'button');
    const expandedProp = expandedButton?.properties?.find(prop => prop.name === 'expanded');
    expect(expandedProp?.value?.value).toBe(true);
    expect(
      await button.evaluate(el => el.ownerDocument.activeElement === el),
      'focus retained across activation'
    ).toBe(true);
  });
}

test('[P1] todo strip remains when Console hides tool calls', async ({ page, archon }) => {
  test.setTimeout(T.xlong * 2);
  const run = await runTodoStrip(page, archon);
  const room = await openNodeRoom(page, 'console', run.runId, TODO_STRIP_TODO_NODE);
  const strip = room.locator(STRIP);
  await expect(strip).toHaveCount(1);
  await expect(room.locator(TOOL_ROW).first()).toBeVisible({ timeout: T.medium });
  await page.getByRole('checkbox', { name: 'Tool calls' }).uncheck();
  await expect(room.locator(TOOL_ROW)).toHaveCount(0);
  await expect(strip).toHaveCount(1);
});

test('[P1] todo strip tones clear contrast floors on both surfaces', async ({
  page,
  archon,
}, testInfo: TestInfo) => {
  test.setTimeout(T.xlong);
  await page.setViewportSize(SPLIT_VIEWPORT);
  const run = await runTodoStrip(page, archon);
  const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  }).trim();
  const evidence: Record<string, Record<string, number | string>> = {};
  for (const surface of ['console', 'legacy'] as const) {
    const room = await openNodeRoom(page, surface, run.runId, TODO_STRIP_TODO_NODE);
    const strip = room.locator(STRIP);
    const button = strip.getByRole('button');
    await button.press('Enter');
    const body = await stripBody(strip);
    await expect(body).toBeVisible();

    const elevatedBg = await effectiveBackground(button);
    const surfaceBg = await resolveColorIn(room, 'var(--surface)');
    const hoverBg = await resolveColorIn(room, 'var(--surface-hover)');

    // Actual computed colors on real elements: header label/count/
    // representative, and each item's glyph + text on its own row background.
    const headerTones = await button.evaluate(el => {
      const view = el.ownerDocument.defaultView;
      const pick = (text: string): string => {
        const node = Array.from(el.querySelectorAll('span')).find(
          s => s.textContent?.trim() === text
        );
        return node ? (view?.getComputedStyle(node).color ?? '') : '';
      };
      return {
        label: pick('TODO'),
        count: pick('1/12'),
        representative: pick('Map the message path'),
      };
    });
    const itemTones = await body.evaluate(el => {
      const view = el.ownerDocument.defaultView;
      const ctx = el.ownerDocument.createElement('canvas').getContext('2d');
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
      const effectiveBg = (node: Element | null): { resolved: string; c: Rgba } => {
        let current: Element | null = node;
        while (current !== null) {
          const bg = view?.getComputedStyle(current).backgroundColor ?? 'rgba(0, 0, 0, 0)';
          const parsed = parse(bg);
          if (parsed.c.a > 0.01) return parsed;
          current = current.parentElement;
        }
        return parse('rgb(0, 0, 0)');
      };
      const out: Record<string, { glyph: string; text: string; background: string }> = {};
      for (const li of Array.from(el.querySelectorAll('li'))) {
        const spans = li.querySelectorAll('span');
        const content = spans[2] ?? null; // glyph, sr-only status, content, [suffix]
        const key = (content?.textContent ?? '').trim();
        if (key === '') continue;
        out[key] = {
          glyph: view?.getComputedStyle(spans[0] ?? li).color ?? '',
          text: content ? (view?.getComputedStyle(content).color ?? '') : '',
          background: effectiveBg(li).resolved,
        };
      }
      return out;
    });

    const surfaceEvidence: Record<string, number | string> = {
      'surface-elevated background': elevatedBg.resolved,
      'surface background': surfaceBg.resolved,
      'surface-hover background': hoverBg.resolved,
    };

    const check = async (
      label: string,
      fgCss: string,
      bg: { resolved: string; c: Rgba },
      floor: number
    ): Promise<void> => {
      const fg = await resolveColorIn(room, fgCss);
      const ratio = contrastRatio(fg.c, bg.c);
      surfaceEvidence[`${label} resolved`] = fg.resolved;
      surfaceEvidence[`${label} vs ${bg.resolved}`] = Number(ratio.toFixed(2));
      expect(ratio, `${surface} ${label} ≥${String(floor)}:1`).toBeGreaterThanOrEqual(floor);
    };

    // text-secondary label/count and text-primary representative on elevated.
    await check('TODO label (text-secondary)', headerTones.label, elevatedBg, 4.5);
    await check('count (text-secondary)', headerTones.count, elevatedBg, 4.5);
    await check('representative (text-primary)', headerTones.representative, elevatedBg, 4.5);

    // Every status glyph plus its item text on the row's actual background.
    const itemsByName: [string, string][] = [
      ['Read the spec', 'completed'],
      ['Map the message path', 'in progress'],
      ['Check contract conflicts', 'pending'],
      ['Run the suite', 'blocked'],
      ['Review output', 'abandoned'],
    ];
    for (const [itemText, status] of itemsByName) {
      const tone = itemTones[itemText];
      expect(tone, `item "${itemText}" rendered`).toBeTruthy();
      const bg = await resolveColorIn(room, tone?.background ?? 'rgb(0,0,0)');
      await check(`${status} glyph`, tone?.glyph ?? '', bg, 4.5);
      await check(`${status} item text`, tone?.text ?? '', bg, 4.5);
    }

    // Focus ring: opaque --accent-bright on the rest and hover surfaces (3:1).
    const ring = await button.evaluate(el => {
      el.focus();
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return el.ownerDocument.defaultView?.getComputedStyle(el).outlineColor ?? '';
    });
    await check('focus ring on surface-elevated', ring, elevatedBg, 3);
    await check('focus ring on surface-hover', ring, hoverBg, 3);

    // Redundant decoration, recorded but never the sole status channel.
    const meterCell = await strip
      .locator(`${TODO_METER} > *`)
      .first()
      .evaluate(el => {
        return el.ownerDocument.defaultView?.getComputedStyle(el).backgroundColor ?? '';
      });
    const meterFg = await resolveColorIn(room, meterCell);
    surfaceEvidence['meter cell (decorative)'] = Number(
      contrastRatio(meterFg.c, elevatedBg.c).toFixed(2)
    );
    evidence[surface] = surfaceEvidence;
  }
  mergeMetrics('meta', {
    commit,
    viewport: `${String(SPLIT_VIEWPORT.width)}x${String(SPLIT_VIEWPORT.height)}`,
    roomWidthTargetPx: TARGET_ROOM_WIDTH,
    source: 'e2e/ui/agent-todo-strip.spec.ts',
  });
  mergeMetrics('contrast', evidence);
  await testInfo.attach('todo-strip-metrics.json', {
    body: JSON.stringify(evidence, null, 2),
    contentType: 'application/json',
  });
});
