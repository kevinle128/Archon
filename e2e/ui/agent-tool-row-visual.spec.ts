import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { type Locator, type Page, type TestInfo } from '@playwright/test';

import { test, expect } from '../lib/playwright/suite';
import { HITL_INSPECT_NODE, HITL_TOOL_OUTPUT } from '../lib/playwright/archon-runtime';
import { openLegacyRunDetail, openRunDetail } from '../lib/playwright/run-detail';
import { T } from '../lib/playwright/timeouts';

/**
 * Story 1.1 visual acceptance for the readable tool-call row.
 *
 * Behavior is proven elsewhere (workflow-run-hitl*.spec.ts); this spec owns the
 * geometry/focus/motion/contrast evidence recorded in
 * plans/260917-1011-issue-174-readable-tool-call-row/reports/visual-acceptance.md.
 * Captures go to the Playwright output dir via testInfo, not the older suite's
 * capture directory.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MOCKUP_DIR = join(
  REPO_ROOT,
  '_bmad-output',
  'planning-artifacts',
  'ux-designs',
  'ux-Archon-agent-node-room-2026-09-09',
  'mockups'
);

type Surface = 'console' | 'legacy';

const ROW = 'details[data-tool-id]';
const SUMMARY = `${ROW} > summary`;
const ROOM_NAME = `${HITL_INSPECT_NODE} room`;
const TARGET_ROOM_WIDTH = 460;
const ROOM_TOLERANCE_PX = 2;
const SPLIT_VIEWPORT = { width: 1440, height: 1000 } as const;
const SWEEP_VIEWPORTS = [
  { name: '1440x1000', width: 1440, height: 1000 },
  { name: '1024x900', width: 1024, height: 900 },
  { name: '768x900', width: 768, height: 900 },
  { name: '390x844', width: 390, height: 844 },
] as const;

/** Canonical panel width; only the Console mock is authored off it (520px). */
const MOCKUPS = [
  { file: 'key-transcript-states.html', panelSelector: '.panel' },
  { file: 'key-console-node-room.html', panelSelector: '#node-panel' },
  { file: 'key-legacy-node-room.html', panelSelector: '#node-panel' },
  { file: 'full-transcript-review.html', panelSelector: '.room' },
] as const;

function roomRegion(page: Page): Locator {
  return page.getByRole('region', { name: ROOM_NAME });
}

async function openToolRoom(page: Page, surface: Surface, runId: string): Promise<Locator> {
  if (surface === 'console') {
    await openRunDetail(page, runId, HITL_INSPECT_NODE);
  } else {
    await openLegacyRunDetail(page, runId);
    await expect(page.getByText(/e2e-hitl-run/i).first()).toBeVisible({ timeout: T.medium });
    const logsTab = page.getByRole('tab', { name: 'Logs' });
    if ((await logsTab.count()) > 0) await logsTab.click();
    await page
      .getByRole('button', { name: new RegExp(HITL_INSPECT_NODE) })
      .first()
      .click();
  }
  const room = roomRegion(page);
  await expect(room).toBeVisible({ timeout: T.medium });
  await expect(room.locator(SUMMARY)).toBeVisible({ timeout: T.medium });
  return room;
}

const ROOM_PANEL_ID: Record<Surface, string> = {
  console: 'console-run-room',
  legacy: 'legacy-run-room',
};
// Mirrors ROOM_SPLIT bounds in packages/web/src/lib/room-split-layout.ts.
const ROOM_RATIO_MIN = 24;
const ROOM_RATIO_MAX = 60;

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
  const region = roomRegion(page);
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
  const room = await openToolRoom(page, surface, runId);
  const width = (await room.boundingBox())?.width ?? 0;
  expect(
    Math.abs(width - TARGET_ROOM_WIDTH),
    `measured room width ${String(width)} must land within ${String(TARGET_ROOM_WIDTH)}±${String(ROOM_TOLERANCE_PX)}`
  ).toBeLessThanOrEqual(ROOM_TOLERANCE_PX);
  return width;
}

/**
 * One-line proof that is not screenshot-only: bounded summary height, every
 * direct child inside the summary's vertical band, no clipped content, and
 * every badge-group text fragment sharing one top edge.
 */
async function expectSummaryOneLine(summary: Locator): Promise<void> {
  const box = await summary.boundingBox();
  expect(box, 'summary bounding box').toBeTruthy();
  if (!box) throw new Error('missing summary box');
  expect(box.height, 'summary height keeps one line (24–30px)').toBeGreaterThanOrEqual(24);
  expect(box.height, 'summary height keeps one line (24–30px)').toBeLessThanOrEqual(30);
  const fits = await summary.evaluate(el => el.scrollWidth <= el.clientWidth + 1);
  expect(fits, 'summary content fits horizontally without clipping').toBe(true);
  const childrenInside = await summary.evaluate(el => {
    const band = el.getBoundingClientRect();
    return Array.from(el.children).every(child => {
      const rect = child.getBoundingClientRect();
      return rect.top >= band.top - 1 && rect.bottom <= band.bottom + 1;
    });
  });
  expect(childrenInside, 'all summary parts stay inside the single-line band').toBe(true);
  const badgeTops = await summary.evaluate(el => {
    const group = el.lastElementChild;
    if (!(group instanceof HTMLElement)) return [] as number[];
    const walker = el.ownerDocument.createTreeWalker(group, NodeFilter.SHOW_TEXT);
    const tops: number[] = [];
    let node = walker.nextNode();
    while (node !== null) {
      if ((node.textContent ?? '').trim().length > 0) {
        const range = el.ownerDocument.createRange();
        range.selectNodeContents(node);
        tops.push(Math.round(range.getBoundingClientRect().top));
      }
      node = walker.nextNode();
    }
    return tops;
  });
  expect(new Set(badgeTops).size, 'badge facts never wrap').toBeLessThanOrEqual(1);
}

/**
 * The room must never force horizontal scrolling where it is visible: the room
 * region fits inside the viewport, it never scrolls horizontally itself, and no
 * descendant pokes past the page edge. Outside offenders (e.g. the pre-existing
 * TopNav anchors on legacy at 390px) are reported for the record, not waived —
 * they live outside this story's surface.
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
    report.insideCount,
    `no room element overflows the page ${context} (outside offenders: ${report.outsideSample.join(', ') || 'none'}; page overflow ${String(report.pageOverflow)}px)`
  ).toBe(0);
}

/** Transcript container = first ancestor carrying non-zero padding. */
async function transcriptPadding(summary: Locator): Promise<{ top: string; left: string }> {
  return summary.evaluate(el => {
    const view = el.ownerDocument.defaultView;
    let node = el.parentElement;
    while (node !== null) {
      const cs = view?.getComputedStyle(node);
      if (cs !== undefined && (cs.paddingLeft !== '0px' || cs.paddingTop !== '0px')) {
        return { top: cs.paddingTop, left: cs.paddingLeft };
      }
      node = node.parentElement;
    }
    return { top: '', left: '' };
  });
}

interface SummaryAxEvidence {
  found: boolean;
  name: string | null;
  role: string | null;
  expanded: boolean | null;
}

interface AxNode {
  backendDOMNodeId?: number;
  ignored?: boolean;
  role?: { value?: unknown };
  name?: { value?: unknown };
  properties?: { name: string; value?: { value?: unknown } }[];
}

/**
 * Reads Chromium's accessibility tree over CDP — the exact name/role/state
 * channel VoiceOver and NVDA consume for this browser pairing.
 */
async function summaryAxEvidence(page: Page): Promise<SummaryAxEvidence> {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('DOM.enable');
    await session.send('Accessibility.enable');
    const doc = (await session.send('DOM.getDocument', { depth: 1 })) as {
      root: { nodeId: number };
    };
    const query = (await session.send('DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector: ROW,
    })) as { nodeId: number };
    if (query.nodeId === 0) return { found: false, name: null, role: null, expanded: null };
    const described = (await session.send('DOM.describeNode', {
      nodeId: query.nodeId,
    })) as { node: { backendNodeId?: number } };
    const detailsBackendId = described.node.backendNodeId;
    const ax = (await session.send('Accessibility.queryAXTree', {
      nodeId: query.nodeId,
    })) as { nodes: AxNode[] };
    // The summary's accessible node carries the engineered name; the `expanded`
    // state is read off the AX node mapped to THIS row's <details> element so a
    // nested diagnostic disclosure can never be mistaken for it.
    const named = ax.nodes.find(
      node => !node.ignored && typeof node.name?.value === 'string' && node.name.value !== ''
    );
    const detailsAx = ax.nodes.find(
      node => node.backendDOMNodeId !== undefined && node.backendDOMNodeId === detailsBackendId
    );
    const expandedProp = detailsAx?.properties?.find(prop => prop.name === 'expanded');
    return {
      found: named !== undefined,
      name: typeof named?.name?.value === 'string' ? named.name.value : null,
      role: typeof named?.role?.value === 'string' ? named.role.value : null,
      expanded: typeof expandedProp?.value?.value === 'boolean' ? expandedProp.value.value : null,
    };
  } finally {
    await session.detach();
  }
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
async function effectiveBackground(summary: Locator): Promise<{ resolved: string; c: Rgba }> {
  return summary.evaluate((el: HTMLElement) => {
    const doc = el.ownerDocument;
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
    let node: HTMLElement | null = el;
    while (node !== null) {
      const bg = doc.defaultView?.getComputedStyle(node).backgroundColor ?? 'rgba(0, 0, 0, 0)';
      const parsed = parse(bg);
      if (parsed.c.a > 0.01) return parsed;
      node = node.parentElement;
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

for (const surface of ['console', 'legacy'] as const) {
  test(`[P1] [V:hitl.tool-row-${surface}] HITL readable tool row geometry, keyboard, and computed style on ${surface}`, async ({
    page,
    archon,
  }, testInfo: TestInfo) => {
    test.setTimeout(T.xlong * 2);
    await page.setViewportSize(SPLIT_VIEWPORT);
    const started = await archon.runHitlWorkflow();
    const room = await openToolRoom(page, surface, started.runId);
    const row = room.locator(ROW).first();
    const summary = room.locator(SUMMARY).first();

    await expect(row).toHaveJSProperty('open', false);
    await expect(summary).toContainText('Read');
    await expect(summary).toContainText('HITL_TOOL_INPUT.txt');
    await expect(summary).toContainText('succeeded');
    await expect(row.getByText('Input', { exact: true })).toBeHidden();
    await expect(row.getByText('Output', { exact: true })).toBeHidden();
    await expect(row.getByText(HITL_TOOL_OUTPUT)).toBeHidden();

    // The accessible name is engineered state → family/tool → target → facts;
    // chevron and glyph stay decorative. Chromium's AX tree is the AT channel.
    const axClosed = await summaryAxEvidence(page);
    expect(axClosed.found, 'summary has an accessible node').toBe(true);
    expect(axClosed.name).toBeTruthy();
    const axName = axClosed.name ?? '';
    const stateIndex = axName.indexOf('succeeded');
    const familyIndex = axName.indexOf('file · Read');
    const targetIndex = axName.indexOf('HITL_TOOL_INPUT.txt');
    expect(stateIndex, `name order in "${axName}"`).toBe(0);
    expect(familyIndex).toBeGreaterThan(stateIndex);
    expect(targetIndex).toBeGreaterThan(familyIndex);
    expect(axName).not.toContain('▶');
    expect(axName).not.toContain('✓');
    if (axClosed.expanded !== null) expect(axClosed.expanded).toBe(false);

    const width = await setRoomWidth(page, surface, started.runId);
    expect(Math.abs(width - TARGET_ROOM_WIDTH)).toBeLessThanOrEqual(ROOM_TOLERANCE_PX);
    await expectSummaryOneLine(summary);

    // Transcript list padding is the canonical 10px/12px on both surfaces.
    const padding = await transcriptPadding(summary);
    expect(padding.left, 'transcript horizontal padding').toBe('12px');
    expect(padding.top, 'transcript vertical padding').toBe('10px');

    // Rest row carries no inset card fill/border/shadow; hover = surface-hover.
    const rest = await row.evaluate(el => {
      const cs = el.ownerDocument.defaultView?.getComputedStyle(el);
      return {
        background: cs?.backgroundColor ?? '',
        borderWidth: cs?.borderTopWidth ?? '',
        shadow: cs?.boxShadow ?? '',
      };
    });
    expect(rest.background, 'rest row is transparent on the room surface').toBe('rgba(0, 0, 0, 0)');
    expect(rest.borderWidth).toBe('0px');
    expect(rest.shadow).toBe('none');
    const hoverToken = await resolveColorIn(room, 'var(--surface-hover)');
    await summary.hover();
    const hoverBg = await summary.evaluate(
      el => el.ownerDocument.defaultView?.getComputedStyle(el).backgroundColor ?? ''
    );
    expect(hoverBg, 'hover uses --surface-hover').toBe(hoverToken.resolved);
    await page.mouse.move(0, 0);

    // Geometry computed styles — summary, chevron, glyph, chip.
    const geometry = await summary.evaluate(el => {
      const view = el.ownerDocument.defaultView;
      const cs = view?.getComputedStyle(el);
      const kids = Array.from(el.children);
      const metric = (
        node: Element | undefined
      ): { fontSize: string; width: number; fontWeight: string } => {
        if (!(node instanceof HTMLElement)) return { fontSize: '', width: 0, fontWeight: '' };
        const s = view?.getComputedStyle(node);
        return {
          fontSize: s?.fontSize ?? '',
          width: node.getBoundingClientRect().width,
          fontWeight: s?.fontWeight ?? '',
        };
      };
      return {
        fontSize: cs?.fontSize ?? '',
        fontWeight: cs?.fontWeight ?? '',
        paddingTop: cs?.paddingTop ?? '',
        paddingRight: cs?.paddingRight ?? '',
        gap: cs?.columnGap ?? '',
        borderRadius: cs?.borderRadius ?? '',
        minHeight: cs?.minHeight ?? '',
        chevron: metric(kids[0]),
        glyph: metric(kids[2]),
        chip: metric(kids[3]),
      };
    });
    expect(geometry.fontSize).toBe('12px');
    expect(geometry.fontWeight).toBe('400');
    expect(geometry.paddingTop).toBe('4px');
    expect(geometry.paddingRight).toBe('6px');
    expect(geometry.gap).toBe('8px');
    expect(geometry.borderRadius).toBe('6px');
    expect(geometry.minHeight).toBe('24px');
    expect(geometry.chevron.fontSize).toBe('10px');
    expect(geometry.chevron.width).toBe(9);
    expect(geometry.glyph.fontSize).toBe('12px');
    expect(geometry.glyph.fontWeight).toBe('700');
    expect(geometry.chip.fontSize).toBe('11px');

    // Chevron transition is the only row animation: 120ms, none under reduce.
    const chevron = summary.locator('span').first();
    const normalTransition = await chevron.evaluate(el => {
      const cs = el.ownerDocument.defaultView?.getComputedStyle(el);
      return { duration: cs?.transitionDuration ?? '', property: cs?.transitionProperty ?? '' };
    });
    expect(normalTransition.duration).toBe('0.12s');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const reducedTransition = await chevron.evaluate(el => {
      const cs = el.ownerDocument.defaultView?.getComputedStyle(el);
      return { duration: cs?.transitionDuration ?? '', property: cs?.transitionProperty ?? '' };
    });
    // transition-none suppresses the animation by zeroing transition-property;
    // duration keeps its authored computed value.
    expect(reducedTransition.property, 'motion-reduce removes the only row animation').toBe('none');
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    // Enter/Space are the native toggle; focus stays on the summary throughout
    // and Tab follows DOM order into the row's first diagnostic control.
    await summary.press('Enter');
    await expect(row).toHaveJSProperty('open', true);
    expect(await summary.evaluate(el => el.ownerDocument.activeElement === el)).toBe(true);
    const focus = await summary.evaluate(el => {
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
    // The one deliberate surface delta: +2px offset on Console, −2px on Legacy.
    expect(focus.offset).toBe(surface === 'console' ? '2px' : '-2px');
    const accent = await resolveColorIn(room, 'var(--accent-bright)');
    expect(focus.color, 'focus outline resolves to --accent-bright').toBe(accent.resolved);

    // Chromium's AX tree updates lazily after the DOM toggle — poll it.
    const axOpen = await summaryAxEvidence(page);
    if (axOpen.expanded !== null) {
      await expect
        .poll(async () => (await summaryAxEvidence(page)).expanded, { timeout: T.short })
        .toBe(true);
    }
    await page.keyboard.press('ArrowDown');
    expect(
      await summary.evaluate(el => el.ownerDocument.activeElement === el),
      'arrow keys do nothing — no roving tabindex'
    ).toBe(true);
    await page.keyboard.press('Tab');
    const inputSummary = row.getByText('Input', { exact: true }).first();
    expect(
      await inputSummary.evaluate(el => el.ownerDocument.activeElement === el),
      'Tab follows DOM order into the first diagnostic control'
    ).toBe(true);
    await summary.press('Space');
    await expect(row).toHaveJSProperty('open', false);
    expect(await summary.evaluate(el => el.ownerDocument.activeElement === el)).toBe(true);

    const rowShot = await row.screenshot();
    await testInfo.attach(`${surface}-tool-row-460.png`, {
      body: rowShot,
      contentType: 'image/png',
    });
    const roomShot = await room.screenshot();
    await testInfo.attach(`${surface}-room-460.png`, {
      body: roomShot,
      contentType: 'image/png',
    });
    await page.screenshot({
      path: testInfo.outputPath(`${surface}-context-1440.png`),
      fullPage: true,
    });
  });

  test(`[P1] [V:hitl.tool-row-${surface}-sweep] HITL readable tool row stays operable and one-line across viewports and 200% zoom on ${surface}`, async ({
    page,
    archon,
  }) => {
    test.setTimeout(T.xlong * 2);
    const started = await archon.runHitlWorkflow();
    for (const viewport of SWEEP_VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const room = await openToolRoom(page, surface, started.runId);
      const row = room.locator(ROW).first();
      const summary = room.locator(SUMMARY).first();
      await expectSummaryOneLine(summary);
      await summary.press('Enter');
      await expect(row).toHaveJSProperty('open', true);
      await summary.press('Space');
      await expect(row).toHaveJSProperty('open', false);
      await expectNoRoomDrivenOverflow(room, `at ${viewport.name} on ${surface}`);
    }
    const chrome = await page.context().newCDPSession(page);
    try {
      await page.setViewportSize(SPLIT_VIEWPORT);
      const room = await openToolRoom(page, surface, started.runId);
      const summary = room.locator(SUMMARY).first();
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
      await expect(summary).toBeVisible();
      await expectSummaryOneLine(summary);
      await summary.press('Enter');
      await expect(room.locator(ROW).first()).toHaveJSProperty('open', true);
      await expectNoRoomDrivenOverflow(room, `at 200% zoom on ${surface}`);
    } finally {
      await chrome.send('Emulation.clearDeviceMetricsOverride');
      await chrome.detach();
    }
  });
}

test('[P1] [V:hitl.tool-row-contrast] HITL tool-row tones resolve to ≥4.5:1 on both surfaces', async ({
  page,
  archon,
}, testInfo: TestInfo) => {
  test.setTimeout(T.xlong);
  await page.setViewportSize(SPLIT_VIEWPORT);
  const started = await archon.runHitlWorkflow();
  // The real fixture renders a `file` row only; tones absent from it are
  // measured as resolved production style values, not claimed in screenshots.
  const TONES = {
    'search/glob chip text': 'color-mix(in oklch, var(--node-prompt) 70%, var(--text-primary))',
    'nonzero exit digits': 'color-mix(in oklch, var(--error) 75%, var(--text-primary))',
    'focus outline': 'var(--accent-bright)',
    'succeeded glyph': 'var(--success)',
    'neutral badge text': 'var(--text-secondary)',
  } as const;
  const evidence: Record<string, Record<string, number | string>> = {};
  for (const surface of ['console', 'legacy'] as const) {
    const room = await openToolRoom(page, surface, started.runId);
    const summary = room.locator(SUMMARY).first();
    const restBg = await effectiveBackground(summary);
    const hoverBg = await resolveColorIn(room, 'var(--surface-hover)');
    const surfaceEvidence: Record<string, number | string> = {
      'rest background': restBg.resolved,
      'hover background': hoverBg.resolved,
    };
    for (const [label, css] of Object.entries(TONES)) {
      const fg = await resolveColorIn(room, css);
      const rest = contrastRatio(fg.c, restBg.c);
      const hover = contrastRatio(fg.c, hoverBg.c);
      surfaceEvidence[`${label} resolved`] = fg.resolved;
      surfaceEvidence[`${label} vs rest`] = Number(rest.toFixed(2));
      surfaceEvidence[`${label} vs hover`] = Number(hover.toFixed(2));
      const floor = label === 'focus outline' ? 3 : 4.5;
      expect(rest, `${surface} ${label} vs rest ≥${String(floor)}:1`).toBeGreaterThanOrEqual(floor);
      expect(hover, `${surface} ${label} vs hover ≥${String(floor)}:1`).toBeGreaterThanOrEqual(
        floor
      );
    }
    evidence[surface] = surfaceEvidence;
  }
  await testInfo.attach('tool-row-contrast.json', {
    body: JSON.stringify(evidence, null, 2),
    contentType: 'application/json',
  });
});

test('[P1] [V:hitl.tool-row-mockups] HITL tool-row mockups measured at 460px share the shipped row anatomy', async ({
  page,
}, testInfo: TestInfo) => {
  // The mock row contract is chevron → status glyph → family chip → headline →
  // badges — the same accessible-name order the product summary asserts above.
  for (const mockup of MOCKUPS) {
    await page.goto(pathToFileURL(join(MOCKUP_DIR, mockup.file)).href);
    const panel = page
      .locator(mockup.panelSelector)
      .filter({ has: page.locator('.tcall') })
      .first();
    await expect(panel).toBeVisible({ timeout: T.medium });
    // Test-only width override; the authored file stays unchanged.
    await panel.evaluate(el => {
      (el as HTMLElement).style.width = '460px';
      (el as HTMLElement).style.maxWidth = '460px';
    });
    const panelBox = await panel.boundingBox();
    expect(panelBox).toBeTruthy();
    expect(
      Math.abs((panelBox?.width ?? 0) - TARGET_ROOM_WIDTH),
      `${mockup.file} panel must measure ${String(TARGET_ROOM_WIDTH)}px`
    ).toBeLessThanOrEqual(ROOM_TOLERANCE_PX);
    const mockRow = panel.locator('.tcall').first();
    const mockSummary = mockRow.locator('summary').first();
    await expect(mockSummary).toBeVisible();
    const anatomy = await mockSummary.evaluate(el =>
      Array.from(el.children).map(child => (child.getAttribute('class') ?? '').split(' ')[0])
    );
    expect(anatomy, `${mockup.file} row anatomy order`).toEqual(['chev', 'gl', 'fam', 'hl', 'bd']);
    const shot = await mockRow.screenshot();
    await testInfo.attach(`mockup-${mockup.file.replace('.html', '')}-460.png`, {
      body: shot,
      contentType: 'image/png',
    });
  }
});
