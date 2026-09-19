import { mkdirSync, writeFileSync } from 'node:fs';
import { env } from 'node:process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { type Locator, type Page, type TestInfo } from '@playwright/test';

import { test, expect } from '../lib/playwright/suite';
import { HITL_INSPECT_NODE, HITL_TOOL_OUTPUT } from '../lib/playwright/archon-runtime';
import { openLegacyRunDetail, openRunDetail } from '../lib/playwright/run-detail';
import { T } from '../lib/playwright/timeouts';

/**
 * Visual acceptance for the readable tool-call row (Story 1.1), its Raw
 * payload toggle (Story 1.2), and expanded family bodies (Story 1.3).
 *
 * Behavior is proven elsewhere (workflow-run-hitl*.spec.ts); this spec owns the
 * geometry/focus/motion/contrast evidence recorded in
 * plans/260917-1011-issue-174-readable-tool-call-row/reports/visual-acceptance.md
 * (Story 1.1 row shell), the Story 1.2 Raw-toggle supplement at
 * plans/260918-1038-issue-175-raw-payload-toggle/reports/visual-acceptance.md,
 * and plans/260918-0834-issue-176-tool-family-bodies/reports/implementation-evidence.md.
 * The gallery tests run on deterministic route-fulfilled transcript fixtures —
 * labeled as such in their attachments — not fake-provider claims.
 * Captures go to the Playwright output dir via testInfo; the Story 1.2 Raw
 * captures are also written to the supplement's reports/evidence/ directory.
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
const STORY_12_EVIDENCE_DIR =
  env.ARCHON_VERIFY_EVIDENCE ??
  join(REPO_ROOT, 'plans', '260918-1038-issue-175-raw-payload-toggle', 'reports', 'evidence');

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
  { name: '460x900', width: 460, height: 900 },
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
  // `.first()`: the Story 1.3 gallery room holds one row per family arm.
  await expect(room.locator(SUMMARY).first()).toBeVisible({ timeout: T.medium });
  return room;
}

const ROOM_PANEL_ID: Record<Surface, string> = {
  console: 'console-run-room',
  legacy: 'legacy-run-room',
};

// --- Story 1.3 family-body gallery ---
// Browser visual fixtures: deterministic route-fulfilled transcript responses
// replace only the `inspect-file` node's message page — the run, server, and
// UI stay real; nothing here claims fake-provider behavior. One row per body
// arm, plus the generic and degraded (unreadable) arms.

interface GalleryTool {
  id: string;
  name: string;
  input: unknown;
  output: unknown;
}

/** One unbroken token longer than the 460px body box — must wrap, never overflow. */
const GALLERY_WRAP_TOKEN = 'x'.repeat(600);

const GALLERY_TOOLS: GalleryTool[] = [
  {
    id: 'gal-shell',
    name: 'Bash',
    input: { command: 'bun run validate' },
    output: `3 packages checked\n${GALLERY_WRAP_TOKEN}`,
  },
  {
    id: 'gal-file',
    name: 'Read',
    input: { path: 'src/lib/tool-presentation.ts' },
    output: 'export const MAX = 1;\nexport const MIN = 0;',
  },
  {
    id: 'gal-search',
    name: 'Grep',
    input: { pattern: 'needle', path: 'src', output_mode: 'content' },
    output: 'src/a.ts:3:const needle = 1;\nsrc/b.ts:9:return needle();',
  },
  {
    id: 'gal-glob',
    name: 'Glob',
    input: { pattern: '**/*.test.ts' },
    output: 'src/a.test.ts\nsrc/b.test.ts\nsrc/c.test.ts',
  },
  {
    id: 'gal-code',
    name: 'eval',
    input: { code: 'export const answer = 42;', language: 'typescript' },
    output: '42',
  },
  {
    id: 'gal-web',
    name: 'webfetch',
    input: { url: 'https://example.com/docs' },
    output: '# Guide\n\nSee [the reference](https://example.com/ref) for details.',
  },
  {
    id: 'gal-generic',
    name: 'mcp__acme__lookup',
    input: { record_id: 42, mode: 'fast' },
    output: { status: 'ok', elapsed: '12ms' },
  },
  {
    id: 'gal-unreadable',
    name: 'CustomBlob',
    input: { op: 'dump' },
    output: { output: [999, 1000] },
  },
];

function galleryMessageRows(): {
  id: string;
  seq: number;
  kind: 'tool';
  payload: { id: string; name: string; input: unknown; output: unknown };
  created_at: string;
  metadata: { tool_phase: 'result'; outcome: 'success' };
}[] {
  return GALLERY_TOOLS.map((tool, index) => ({
    id: `gal-msg-${String(index + 1)}`,
    seq: index + 1,
    kind: 'tool',
    payload: { id: tool.id, name: tool.name, input: tool.input, output: tool.output },
    created_at: '2026-09-18T00:00:00.000Z',
    metadata: { tool_phase: 'result', outcome: 'success' },
  }));
}

/**
 * Fulfills only the fixture node's transcript page with the gallery rows.
 * Other requests — message-detail fetches, other nodes' transcripts — continue
 * to the real server untouched.
 */
async function routeGalleryTranscript(page: Page, runId: string): Promise<void> {
  const pathname = `/api/workflows/runs/${runId}/nodes/${HITL_INSPECT_NODE}/messages`;
  const rows = galleryMessageRows();
  const lastSeq = GALLERY_TOOLS.length;
  await page.route(`**${pathname}**`, async route => {
    const url = new URL(route.request().url());
    if (url.pathname !== pathname) {
      await route.continue();
      return;
    }
    const afterSeq = Number(url.searchParams.get('afterSeq') ?? '0');
    await route.fulfill({
      json: {
        messages: rows.slice(afterSeq),
        nextCursor: String(lastSeq),
        hasMore: false,
        highWatermark: lastSeq,
      },
    });
  });
}
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
 * The page and room must never force horizontal scrolling where the room is
 * visible. Keep page-level overflow in this assertion because the acceptance
 * criterion explicitly requires it; naming outside offenders makes failures
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
  nodeId?: string;
  backendDOMNodeId?: number;
  ignored?: boolean;
  role?: { value?: unknown };
  name?: { value?: unknown };
  properties?: {
    name: string;
    value?: {
      value?: unknown;
      relatedSources?: { backendDOMNodeId?: number; idref?: string }[];
    };
  }[];
}

/**
 * Reads Chromium's accessibility tree over CDP — the exact name/role/state
 * channel VoiceOver and NVDA consume for this browser pairing.
 */
async function summaryAxEvidence(page: Page, rowIndex = 0): Promise<SummaryAxEvidence> {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('DOM.enable');
    await session.send('Accessibility.enable');
    const doc = (await session.send('DOM.getDocument', { depth: 1 })) as {
      root: { nodeId: number };
    };
    // Scope to the node room — the Console run page renders its own transcript
    // rows outside the room.
    const roomQuery = (await session.send('DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector: `[role="region"][aria-label="${ROOM_NAME}"]`,
    })) as { nodeId: number };
    if (roomQuery.nodeId === 0) return { found: false, name: null, role: null, expanded: null };
    const query = (await session.send('DOM.querySelectorAll', {
      nodeId: roomQuery.nodeId,
      selector: ROW,
    })) as { nodeIds: number[] };
    const nodeId = query.nodeIds[rowIndex] ?? 0;
    if (nodeId === 0) return { found: false, name: null, role: null, expanded: null };
    const described = (await session.send('DOM.describeNode', {
      nodeId,
    })) as { node: { backendNodeId?: number } };
    const detailsBackendId = described.node.backendNodeId;
    const ax = (await session.send('Accessibility.queryAXTree', {
      nodeId,
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

interface RawAxEvidence {
  found: boolean;
  role: string | null;
  name: string | null;
  expanded: boolean | null;
  controlsPanel: boolean | null;
}

/**
 * Chromium AX-tree evidence for the row's Raw toggle: role/name/expanded plus
 * the `controls` relationship resolved to this row's <pre> panel (matched by
 * backendDOMNodeId so a sibling row's panel can never satisfy it).
 */
async function rawAxEvidence(page: Page, row: Locator): Promise<RawAxEvidence> {
  const absent: RawAxEvidence = {
    found: false,
    role: null,
    name: null,
    expanded: null,
    controlsPanel: null,
  };
  const toolId = await row.getAttribute('data-tool-id');
  if (toolId === null) return absent;
  const scope = `details[data-tool-id="${toolId}"]`;
  // <pre> mounts only while Raw is open — getAttribute would wait forever.
  const panelDomId =
    (await row.locator('pre').count()) > 0
      ? await row.locator('pre').first().getAttribute('id')
      : null;
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('DOM.enable');
    await session.send('Accessibility.enable');
    const doc = (await session.send('DOM.getDocument', { depth: 1 })) as {
      root: { nodeId: number };
    };
    const pick = async (selector: string): Promise<number> => {
      const query = (await session.send('DOM.querySelector', {
        nodeId: doc.root.nodeId,
        selector,
      })) as { nodeId: number };
      return query.nodeId;
    };
    const backendOf = async (nodeId: number): Promise<number | null> => {
      const described = (await session.send('DOM.describeNode', { nodeId })) as {
        node: { backendNodeId?: number };
      };
      return described.node.backendNodeId ?? null;
    };
    const buttonNode = await pick(`${scope} button[aria-expanded]`);
    if (buttonNode === 0) return absent;
    const buttonBackend = await backendOf(buttonNode);
    const preNode = await pick(`${scope} pre`);
    const preBackend = preNode === 0 ? null : await backendOf(preNode);
    const tree = (await session.send('Accessibility.getFullAXTree')) as { nodes: AxNode[] };
    const buttonAx = tree.nodes.find(
      node => node.backendDOMNodeId === buttonBackend && node.ignored !== true
    );
    if (buttonAx === undefined) return absent;
    const expandedProp = buttonAx.properties?.find(prop => prop.name === 'expanded');
    // Chromium encodes aria-controls differently across protocol versions:
    // an idref/idrefList value, or relatedSources entries carrying the
    // target's backendDOMNodeId and/or DOM idref. Accept every shape.
    const controlsValue = buttonAx.properties?.find(prop => prop.name === 'controls')?.value;
    const controlRefs = new Set<string | number>();
    if (Array.isArray(controlsValue?.value)) {
      for (const ref of controlsValue.value) {
        if (typeof ref === 'string' || typeof ref === 'number') controlRefs.add(ref);
      }
    } else if (
      typeof controlsValue?.value === 'string' ||
      typeof controlsValue?.value === 'number'
    ) {
      controlRefs.add(controlsValue.value);
    }
    for (const rel of controlsValue?.relatedSources ?? []) {
      if (rel.backendDOMNodeId !== undefined) controlRefs.add(rel.backendDOMNodeId);
      if (rel.idref !== undefined) controlRefs.add(rel.idref);
    }
    const preAx =
      preBackend === null
        ? undefined
        : tree.nodes.find(node => node.backendDOMNodeId === preBackend);
    const referencesPanel =
      (preBackend !== null && controlRefs.has(preBackend)) ||
      (panelDomId !== null && controlRefs.has(panelDomId)) ||
      (preAx?.nodeId !== undefined && controlRefs.has(preAx.nodeId));
    return {
      found: true,
      role: typeof buttonAx.role?.value === 'string' ? buttonAx.role.value : null,
      name: typeof buttonAx.name?.value === 'string' ? buttonAx.name.value : null,
      expanded: typeof expandedProp?.value?.value === 'boolean' ? expandedProp.value.value : null,
      controlsPanel: preBackend === null ? null : referencesPanel,
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
    await expect(row.getByText('Input', { exact: true })).toHaveCount(0);
    await expect(row.getByText('Output', { exact: true })).toHaveCount(0);
    await expect(row.locator('.tool-family-body')).toHaveCount(0);
    // A collapsed row mounts nothing below the summary: the Raw toggle and any
    // payload markup appear only once the row opens. DOM selector — the absent
    // control is absent from the accessibility tree too.
    const rawToggle = row.locator('button[aria-expanded]');
    await expect(rawToggle).toHaveCount(0);
    await expect(row.locator('details')).toHaveCount(0);
    await expect(row.locator('pre')).toHaveCount(0);
    await expect(row.getByText(HITL_TOOL_OUTPUT)).toHaveCount(0);

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

    // Raw control appearance: closed = secondary label on a quiet border;
    // hover, focus, and open all flip to bright border + primary text.
    const tokenBorder = await resolveColorIn(room, 'var(--border)');
    const tokenBorderBright = await resolveColorIn(room, 'var(--border-bright)');
    const tokenTextPrimary = await resolveColorIn(room, 'var(--text-primary)');
    const tokenTextSecondary = await resolveColorIn(room, 'var(--text-secondary)');
    const tokenInset = await resolveColorIn(room, 'var(--surface-inset)');
    const rawStyle = async (): Promise<{ color: string; border: string }> =>
      rawToggle.evaluate(el => {
        const cs = el.ownerDocument.defaultView?.getComputedStyle(el);
        return { color: cs?.color ?? '', border: cs?.borderTopColor ?? '' };
      });
    const closedStyle = await rawStyle();
    expect(closedStyle.color, 'closed Raw label is secondary text').toBe(
      tokenTextSecondary.resolved
    );
    expect(closedStyle.border, 'closed Raw border is the quiet border').toBe(tokenBorder.resolved);
    const rawBox = await rawToggle.boundingBox();
    expect(rawBox, 'Raw control bounding box').toBeTruthy();
    if (!rawBox) throw new Error('missing Raw control box');
    expect(
      Math.min(rawBox.width, rawBox.height),
      'Raw target is at least 24px'
    ).toBeGreaterThanOrEqual(24);
    await rawToggle.hover();
    const hoverStyle = await rawStyle();
    expect(hoverStyle.color, 'hover Raw label is primary text').toBe(tokenTextPrimary.resolved);
    expect(hoverStyle.border, 'hover Raw border is bright').toBe(tokenBorderBright.resolved);
    await page.mouse.move(0, 0);
    // Facts stay left in the body bar; Raw is pinned to its right edge.
    const bodyBar = rawToggle.locator('xpath=..');
    const factsBox = await bodyBar.locator('span.min-w-0').boundingBox();
    const barBox = await bodyBar.boundingBox();
    expect(factsBox, 'body-bar facts bounding box').toBeTruthy();
    expect(barBox, 'body-bar bounding box').toBeTruthy();
    if (!factsBox || !barBox) throw new Error('missing body-bar geometry');
    expect(factsBox.x, 'facts occupy the body-bar left').toBeLessThanOrEqual(barBox.x + 1);
    expect(rawBox.x, 'Raw sits after the facts').toBeGreaterThanOrEqual(
      factsBox.x + factsBox.width - 1
    );
    expect(
      barBox.x + barBox.width - (rawBox.x + rawBox.width),
      'Raw is pinned to the body-bar right edge'
    ).toBeLessThanOrEqual(2);

    // AX tree: the Raw toggle is a named expanded/collapsed button; while
    // closed it controls nothing.
    const axRawClosed = await rawAxEvidence(page, row);
    expect(axRawClosed.found, 'Raw control has an AX node').toBe(true);
    expect(axRawClosed.role).toBe('button');
    expect(axRawClosed.name).toBe('Raw');
    expect(axRawClosed.expanded).toBe(false);
    expect(axRawClosed.controlsPanel).not.toBe(true);

    // Keyboard path: Tab reaches Raw after the summary entry point; Enter and
    // Space toggle it with a visible focus ring throughout.
    await page.keyboard.press('Tab');
    expect(
      await rawToggle.evaluate(el => el.ownerDocument.activeElement === el),
      'Tab follows DOM order into the Raw control'
    ).toBe(true);
    const rawFocus = await rawToggle.evaluate(el => {
      const cs = el.ownerDocument.defaultView?.getComputedStyle(el);
      return {
        style: cs?.outlineStyle ?? '',
        width: cs?.outlineWidth ?? '',
        color: cs?.outlineColor ?? '',
        focusVisible: el.matches(':focus-visible'),
      };
    });
    expect(rawFocus.focusVisible, 'keyboard focus on Raw carries :focus-visible').toBe(true);
    expect(rawFocus.style).toBe('solid');
    expect(rawFocus.width).toBe('2px');
    expect(rawFocus.color, 'Raw focus outline resolves to --accent-bright').toBe(accent.resolved);
    const focusedStyle = await rawStyle();
    expect(focusedStyle.color, 'focused Raw label is primary text').toBe(tokenTextPrimary.resolved);
    expect(focusedStyle.border, 'focused Raw border is bright').toBe(tokenBorderBright.resolved);

    await rawToggle.press('Enter');
    await expect(rawToggle).toHaveAttribute('aria-expanded', 'true');
    const rawPanel = row.locator('pre');
    await expect(rawPanel).toHaveCount(1);
    await expect(rawPanel).toBeVisible();
    const panelDomId = await rawPanel.getAttribute('id');
    expect(panelDomId).toBeTruthy();
    expect(await rawToggle.getAttribute('aria-controls')).toBe(panelDomId);
    expect(
      await page.evaluate(id => document.getElementById(id ?? '')?.tagName ?? null, panelDomId)
    ).toBe('PRE');

    // Canonical paired payload: provider name plus parsed input/output, pretty
    // printed — nothing else.
    const panelText = await rawPanel.textContent();
    expect(panelText).toBeTruthy();
    const payload = JSON.parse(panelText ?? '') as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual(['name', 'input', 'output']);
    expect(payload.name).toBe('Read');
    expect(payload.input).toEqual({ path: 'HITL_TOOL_INPUT.txt' });
    expect(payload.output).toBe(HITL_TOOL_OUTPUT);

    // Open panel: primary text on the inset surface, no horizontal scroll.
    const panelStyle = await rawPanel.evaluate(el => {
      const cs = el.ownerDocument.defaultView?.getComputedStyle(el);
      return {
        color: cs?.color ?? '',
        background: cs?.backgroundColor ?? '',
        fontSize: cs?.fontSize ?? '',
        lineHeight: cs?.lineHeight ?? '',
        overflowX: el.scrollWidth - el.clientWidth,
      };
    });
    expect(panelStyle.color, 'Raw JSON uses primary text').toBe(tokenTextPrimary.resolved);
    expect(panelStyle.background, 'Raw panel uses the inset surface').toBe(tokenInset.resolved);
    expect(panelStyle.fontSize).toBe('11.5px');
    expect(panelStyle.lineHeight).toBe('17.25px');
    expect(panelStyle.overflowX, 'Raw panel has no horizontal scroll').toBeLessThanOrEqual(1);

    // AX tree open state: expanded true and controls resolves to this panel.
    await expect
      .poll(async () => (await rawAxEvidence(page, row)).expanded, { timeout: T.short })
      .toBe(true);
    const axRawOpen = await rawAxEvidence(page, row);
    expect(axRawOpen.controlsPanel, 'AX controls resolves to the Raw panel').toBe(true);

    // Space toggles it back off; the panel leaves the DOM entirely.
    await rawToggle.press('Space');
    await expect(rawToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(row.locator('pre')).toHaveCount(0);
    expect(await rawToggle.getAttribute('aria-controls')).toBeNull();

    // Pointer path: one click mounts the panel, a second removes it.
    await rawToggle.click();
    await expect(row.locator('pre')).toHaveCount(1);
    await rawToggle.click();
    await expect(row.locator('pre')).toHaveCount(0);
    await expect(rawToggle).toHaveAttribute('aria-expanded', 'false');

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

    // Story 1.2 evidence: closed and open Raw at the canonical 460px panel,
    // plus a desktop context shot, written to the supplement's evidence dir.
    mkdirSync(STORY_12_EVIDENCE_DIR, { recursive: true });
    await summary.press('Enter');
    await expect(row).toHaveJSProperty('open', true);
    const closedRowShot = await row.screenshot({
      path: join(STORY_12_EVIDENCE_DIR, `${surface}-raw-closed-460.png`),
    });
    await testInfo.attach(`${surface}-raw-closed-460.png`, {
      body: closedRowShot,
      contentType: 'image/png',
    });
    await rawToggle.click();
    await expect(row.locator('pre')).toBeVisible({ timeout: T.medium });
    const openRowShot = await row.screenshot({
      path: join(STORY_12_EVIDENCE_DIR, `${surface}-raw-open-460.png`),
    });
    await testInfo.attach(`${surface}-raw-open-460.png`, {
      body: openRowShot,
      contentType: 'image/png',
    });
    await page.screenshot({
      path: join(STORY_12_EVIDENCE_DIR, `${surface}-raw-open-1440.png`),
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
      const rawToggle = row.getByRole('button', { name: 'Raw', exact: true });
      await rawToggle.click();
      await expect(rawToggle).toHaveAttribute('aria-expanded', 'true');
      await expect(row.locator('pre')).toBeVisible();
      await expectNoRoomDrivenOverflow(room, `at ${viewport.name} with Raw open on ${surface}`);
      await summary.press('Space');
      await expect(row).toHaveJSProperty('open', false);
    }
    const chrome = await page.context().newCDPSession(page);
    try {
      await page.setViewportSize(SPLIT_VIEWPORT);
      const room = await openToolRoom(page, surface, started.runId);
      const summary = room.locator(SUMMARY).first();
      const row = room.locator(ROW).first();
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
      await expect(row).toHaveJSProperty('open', true);
      const rawToggle = row.getByRole('button', { name: 'Raw', exact: true });
      await rawToggle.click();
      await expect(row.locator('pre')).toBeVisible();
      await expectNoRoomDrivenOverflow(room, `at 200% zoom with Raw open on ${surface}`);
    } finally {
      await chrome.send('Emulation.clearDeviceMetricsOverride');
      await chrome.detach();
    }
  });

  test(`[P1] [V:hitl.tool-body-gallery-${surface}] HITL family-body gallery geometry, Raw swap, and accessibility on ${surface}`, async ({
    page,
    archon,
  }, testInfo: TestInfo) => {
    test.setTimeout(T.xlong * 2);
    await page.setViewportSize(SPLIT_VIEWPORT);
    const started = await archon.runHitlWorkflow();
    await routeGalleryTranscript(page, started.runId);
    let room = await openToolRoom(page, surface, started.runId);
    await expect(room.locator(ROW)).toHaveCount(GALLERY_TOOLS.length, { timeout: T.medium });
    const width = await setRoomWidth(page, surface, started.runId);
    expect(Math.abs(width - TARGET_ROOM_WIDTH)).toBeLessThanOrEqual(ROOM_TOLERANCE_PX);
    room = roomRegion(page);
    const rows = room.locator(ROW);
    await expect(rows).toHaveCount(GALLERY_TOOLS.length, { timeout: T.medium });

    const rowAt = (index: number): Locator => rows.nth(index);
    const bodyOf = (index: number): Locator =>
      rowAt(index).locator(':scope > div > .tool-family-body');

    // Collapsed rows mount no body at all; Input/Output disclosures are gone.
    for (let i = 0; i < GALLERY_TOOLS.length; i++) {
      await expect(bodyOf(i)).toHaveCount(0);
    }
    await expect(room.getByText('Input', { exact: true })).toHaveCount(0);
    await expect(room.getByText('Output', { exact: true })).toHaveCount(0);

    for (let i = 0; i < GALLERY_TOOLS.length; i++) {
      const summary = rowAt(i).locator('summary').first();
      await summary.scrollIntoViewIfNeeded();
      await summary.click();
      await expect(rowAt(i)).toHaveJSProperty('open', true);
    }

    // --- Per-arm content ---
    // terminal: command line + wrapped output.
    const terminal = bodyOf(0);
    await expect(terminal).toHaveCount(1);
    await expect(terminal).toContainText('$ bun run validate');
    await expect(terminal).toContainText('3 packages checked');
    const terminalBox = await terminal.boundingBox();
    expect(terminalBox).toBeTruthy();
    if (!terminalBox) throw new Error('missing terminal body box');
    // A 600-char unbroken token wraps inside the box instead of overflowing.
    const terminalFits = await terminal.evaluate(el => el.scrollWidth <= el.clientWidth + 1);
    expect(terminalFits, 'terminal output wraps — no horizontal scroll').toBe(true);
    expect(terminalBox.height, 'wrapped long token stacks several lines').toBeGreaterThan(50);

    // file: path header + preview.
    const fileBody = bodyOf(1);
    await expect(fileBody).toHaveCount(1);
    await expect(fileBody.locator('.text-node-command').first()).toHaveText(
      'src/lib/tool-presentation.ts'
    );
    await expect(fileBody).toContainText('export const MAX = 1;');

    // search (content mode): pattern/scope header + path:line match rows.
    const matches = bodyOf(2);
    await expect(matches).toHaveCount(1);
    await expect(matches).toContainText('needle in src');
    await expect(matches.locator('.text-node-command').first()).toHaveText('src/a.ts');
    await expect(matches).toContainText(':3');
    await expect(matches).toContainText('return needle();');

    // glob: path list.
    const paths = bodyOf(3);
    await expect(paths).toHaveCount(1);
    await expect(paths.locator('.text-node-command')).toHaveCount(3);
    await expect(paths.locator('.text-node-command').first()).toHaveText('src/a.test.ts');

    // code: fenced source box + separate result box.
    const codeBoxes = bodyOf(4);
    await expect(codeBoxes).toHaveCount(2);
    await expect(codeBoxes.first().locator('code.language-typescript')).toHaveCount(1);
    await expect(codeBoxes.nth(1)).toHaveText('42');

    // web: url header + inert markdown — the link renders as text, never an anchor.
    const web = bodyOf(5);
    await expect(web).toHaveCount(1);
    await expect(web.locator('.text-node-command').first()).toHaveText('https://example.com/docs');
    await expect(web).toContainText('the reference (https://example.com/ref)');
    await expect(web.locator('a')).toHaveCount(0);

    // generic: bounded key/value fields.
    const generic = bodyOf(6);
    await expect(generic).toHaveCount(1);
    await expect(generic).toContainText('record_id');
    await expect(generic).toContainText('42');
    await expect(generic).toContainText('status');
    await expect(generic).toContainText('ok');

    // degraded: corrupt byte payload reports unreadable, points at Raw.
    const unreadable = bodyOf(7);
    await expect(unreadable).toHaveCount(1);
    await expect(unreadable).toContainText('output unreadable — open Raw');

    // --- 460px body-bar geometry on every row: one line, Raw at far right. ---
    for (let i = 0; i < GALLERY_TOOLS.length; i++) {
      const row = rowAt(i);
      const bar = row.locator(':scope > div > div').first();
      const raw = row.getByRole('button', { name: 'Raw' });
      const barBox = await bar.boundingBox();
      const rawBox = await raw.boundingBox();
      if (!barBox || !rawBox) throw new Error(`missing bar/Raw geometry on row ${String(i)}`);
      expect(barBox.height, `row ${String(i)} body bar stays one line`).toBeLessThanOrEqual(30);
      expect(barBox.height).toBeGreaterThanOrEqual(24);
      expect(
        Math.abs(rawBox.x + rawBox.width - (barBox.x + barBox.width)),
        `row ${String(i)} Raw is flush right`
      ).toBeLessThanOrEqual(ROOM_TOLERANCE_PX);
      expect(rawBox.height, `row ${String(i)} Raw is a 24px target`).toBeGreaterThanOrEqual(24);
      const barFits = await bar
        .locator('span')
        .first()
        .evaluate(el => el.scrollWidth <= el.clientWidth + 1);
      expect(barFits, `row ${String(i)} bar text never wraps`).toBe(true);
    }

    // --- Body box computed style (file row is representative). ---
    const bodyStyle = await fileBody.evaluate(el => {
      const cs = el.ownerDocument.defaultView?.getComputedStyle(el);
      return {
        paddingLeft: cs?.paddingLeft ?? '',
        paddingRight: cs?.paddingRight ?? '',
        paddingTop: cs?.paddingTop ?? '',
        paddingBottom: cs?.paddingBottom ?? '',
        borderRadius: cs?.borderRadius ?? '',
        fontSize: cs?.fontSize ?? '',
        lineHeight: cs?.lineHeight ?? '',
        fontFamily: cs?.fontFamily ?? '',
        whiteSpace: cs?.whiteSpace ?? '',
        overflowWrap: cs?.overflowWrap ?? '',
      };
    });
    expect(bodyStyle.paddingLeft).toBe('10px');
    expect(bodyStyle.paddingRight).toBe('10px');
    expect(bodyStyle.paddingTop).toBe('8px');
    expect(bodyStyle.paddingBottom).toBe('8px');
    expect(bodyStyle.borderRadius).toBe('6px');
    expect(bodyStyle.fontSize).toBe('11.5px');
    expect(bodyStyle.lineHeight).toBe('17.25px');
    expect(bodyStyle.fontFamily.toLowerCase()).toContain('mono');
    expect(bodyStyle.whiteSpace).toBe('pre-wrap');
    expect(bodyStyle.overflowWrap).toBe('anywhere');

    // --- Keyboard order, focus, and expanded state: probed on one terminal
    // body and one matches body (the per-arm a11y evidence requirement). ---
    const a11yProbe = async (
      index: number,
      chipTitle: string
    ): Promise<Record<string, unknown>> => {
      const row = rowAt(index);
      const summary = row.locator('summary').first();
      const raw = row.getByRole('button', { name: 'Raw' });
      await summary.scrollIntoViewIfNeeded();
      const ax = await summaryAxEvidence(page, index);
      expect(ax.found, `row ${String(index)} summary has an accessible node`).toBe(true);
      expect(ax.name ?? '', 'AX name carries state → family/tool → target').toContain('succeeded');
      expect(ax.name ?? '').toContain(chipTitle);
      if (ax.expanded !== null) {
        await expect
          .poll(async () => (await summaryAxEvidence(page, index)).expanded, { timeout: T.short })
          .toBe(true);
      }

      await summary.focus();
      await page.keyboard.press('Tab');
      expect(
        await raw.evaluate(el => el.ownerDocument.activeElement === el),
        'Tab order: summary → Raw'
      ).toBe(true);
      const rawFocus = await raw.evaluate(el => {
        const cs = el.ownerDocument.defaultView?.getComputedStyle(el);
        return {
          style: cs?.outlineStyle ?? '',
          width: cs?.outlineWidth ?? '',
          color: cs?.outlineColor ?? '',
          focusVisible: el.matches(':focus-visible'),
        };
      });
      expect(rawFocus.focusVisible, 'keyboard focus shows the Raw outline').toBe(true);
      expect(rawFocus.style).toBe('solid');
      expect(rawFocus.width).toBe('2px');
      const accent = await resolveColorIn(room, 'var(--accent-bright)');
      expect(rawFocus.color, 'Raw focus outline resolves to --accent-bright').toBe(accent.resolved);

      await expect(raw).toHaveAttribute('aria-expanded', 'false');
      await raw.press('Enter');
      await expect(raw).toHaveAttribute('aria-expanded', 'true');
      // Raw swaps in the exact serialized payload, replacing the family body.
      const rawBox = row.locator(':scope > div > pre').first();
      const rawText = await rawBox.textContent();
      expect(rawText ?? '', 'Raw is the serialized payload').toContain('"name"');
      expect(rawText ?? '').toContain('"input"');
      expect(rawText ?? '').toContain('"output"');
      await raw.press('Enter');
      await expect(raw).toHaveAttribute('aria-expanded', 'false');
      return { axName: ax.name, rawFocus };
    };

    const terminalEvidence = await a11yProbe(0, 'shell · Bash');
    const matchesEvidence = await a11yProbe(2, 'search · Grep');

    // Reduced motion: the chevron transition is the only row animation.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const reduced = await rowAt(1)
      .locator('summary')
      .first()
      .locator('span')
      .first()
      .evaluate(el => el.ownerDocument.defaultView?.getComputedStyle(el).transitionProperty ?? '');
    expect(reduced, 'motion-reduce removes the chevron animation').toBe('none');
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    await expectNoRoomDrivenOverflow(room, `gallery fully open on ${surface}`);

    // Contrast: terminal body text and matches path text on the inset box.
    const contrast: Record<string, number | string> = {};
    const measureBody = async (
      label: string,
      body: Locator,
      foreground: Locator
    ): Promise<void> => {
      const fgCss = await foreground.evaluate(
        el => el.ownerDocument.defaultView?.getComputedStyle(el).color ?? ''
      );
      const fg = await resolveColorIn(room, fgCss);
      const bg = await effectiveBackground(body);
      contrast[`${label} fg`] = fg.resolved;
      contrast[`${label} bg`] = bg.resolved;
      const ratio = contrastRatio(fg.c, bg.c);
      contrast[`${label} ratio`] = Number(ratio.toFixed(2));
      expect(ratio, `${surface} ${label} ≥4.5:1`).toBeGreaterThanOrEqual(4.5);
    };
    await measureBody('terminal body text', terminal, terminal);
    await measureBody('matches path text', matches, matches.locator('.text-node-command').first());

    const roomShot = await room.screenshot();
    await testInfo.attach(`${surface}-body-gallery-460.png`, {
      body: roomShot,
      contentType: 'image/png',
    });
    await testInfo.attach(`${surface}-body-gallery-measurements.json`, {
      body: JSON.stringify(
        {
          label: 'browser visual fixtures — deterministic route-fulfilled transcript',
          surface,
          roomWidth: width,
          terminalBox,
          bodyStyle,
          contrast,
          a11y: { terminal: terminalEvidence, matches: matchesEvidence },
        },
        null,
        2
      ),
      contentType: 'application/json',
    });
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
  const rawEvidence: Record<string, Record<string, number | string>> = {};
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

    // Story 1.2 Raw tones: closed label = secondary on the body-bar surface;
    // hover/focus/open share the primary label; the JSON panel is primary text
    // on the inset surface. Floors are WCAG AA (4.5:1) throughout.
    const row = room.locator(ROW).first();
    await summary.click();
    await expect(row).toHaveJSProperty('open', true);
    const rawToggle = row.getByRole('button', { name: 'Raw', exact: true });
    const barBg = await effectiveBackground(rawToggle);
    const secondary = await resolveColorIn(room, 'var(--text-secondary)');
    const primary = await resolveColorIn(room, 'var(--text-primary)');
    const inset = await resolveColorIn(room, 'var(--surface-inset)');
    const closedLabelRatio = contrastRatio(secondary.c, barBg.c);
    const activeLabelRatio = contrastRatio(primary.c, barBg.c);
    surfaceEvidence['Raw body-bar background'] = barBg.resolved;
    surfaceEvidence['Raw closed label vs body bar'] = Number(closedLabelRatio.toFixed(2));
    surfaceEvidence['Raw active label vs body bar'] = Number(activeLabelRatio.toFixed(2));
    expect(
      closedLabelRatio,
      `${surface} Raw closed label vs body bar ≥4.5:1`
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      activeLabelRatio,
      `${surface} Raw hover/focus/open label vs body bar ≥4.5:1`
    ).toBeGreaterThanOrEqual(4.5);
    await rawToggle.click();
    const rawPanel = row.locator('pre');
    await expect(rawPanel).toBeVisible();
    const panelBg = await effectiveBackground(rawPanel);
    expect(panelBg.resolved, `${surface} Raw panel bg is --surface-inset`).toBe(inset.resolved);
    const jsonRatio = contrastRatio(primary.c, panelBg.c);
    surfaceEvidence['Raw JSON vs inset panel'] = Number(jsonRatio.toFixed(2));
    expect(jsonRatio, `${surface} Raw JSON text vs inset panel ≥4.5:1`).toBeGreaterThanOrEqual(4.5);
    rawEvidence[surface] = {
      'body-bar background': barBg.resolved,
      'closed label (--text-secondary)': secondary.resolved,
      'closed label vs body bar': Number(closedLabelRatio.toFixed(2)),
      'hover/focus/open label (--text-primary)': primary.resolved,
      'active label vs body bar': Number(activeLabelRatio.toFixed(2)),
      'panel background (--surface-inset effective)': panelBg.resolved,
      'Raw JSON vs panel': Number(jsonRatio.toFixed(2)),
    };
    evidence[surface] = surfaceEvidence;
  }
  mkdirSync(STORY_12_EVIDENCE_DIR, { recursive: true });
  writeFileSync(
    join(STORY_12_EVIDENCE_DIR, 'raw-toggle-contrast.json'),
    `${JSON.stringify(rawEvidence, null, 2)}\n`
  );
  await testInfo.attach('raw-toggle-contrast.json', {
    body: JSON.stringify(rawEvidence, null, 2),
    contentType: 'application/json',
  });
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
