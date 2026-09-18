import { type Locator, type Page, type TestInfo } from '@playwright/test';

import { test, expect } from '../lib/playwright/suite';
import {
  TASK_DISPATCH_CLAUDE_NODE,
  TASK_DISPATCH_OMP_NODE,
} from '../lib/playwright/archon-runtime';
import { listNodeMessages, openLegacyRunDetail, openRunDetail } from '../lib/playwright/run-detail';
import { T } from '../lib/playwright/timeouts';

/**
 * Story 1.6 full-stack proof: a stored OMP `Task` batch dispatch and a stored
 * Claude `Agent` single dispatch render as readable bodies (markdown context +
 * one collapsible card per subtask) on both node-room surfaces. The e2e-fake
 * provider emits the deterministic payloads; this spec owns the behavior,
 * geometry, accessibility, network-quietness, contrast, and responsive evidence
 * recorded in
 * plans/260918-0825-issue-179-subagent-dispatch-subtasks/reports/visual-acceptance.md.
 *
 * The fixture constants below are pinned mirrors of
 * packages/providers/src/e2e-fake/provider.ts — this standalone package never
 * imports product sources, so a provider-side drift fails here loudly.
 */

type Surface = 'console' | 'legacy';

const ROW = 'details[data-tool-id]';
const ROW_SUMMARY = `${ROW} > summary`;
const CARD = 'details[data-subtask-index]';
const SPLIT_VIEWPORT = { width: 1440, height: 1000 } as const;
const NARROW_VIEWPORT = { width: 390, height: 844 } as const;
const ROOM_TOLERANCE_PX = 2;

/** Design reference widths: Legacy room authored at 460px, Console at 520px. */
const REFERENCE_WIDTH: Record<Surface, number> = { console: 520, legacy: 460 };
const ROOM_PANEL_ID: Record<Surface, string> = {
  console: 'console-run-room',
  legacy: 'legacy-run-room',
};
// Mirrors ROOM_SPLIT bounds in packages/web/src/lib/room-split-layout.ts.
const ROOM_RATIO_MIN = 24;
const ROOM_RATIO_MAX = 60;

const OMP_IMAGE_URL = 'https://e2e.invalid/task-dispatch-diagram.png';
const OMP_IMAGE_HOST = 'e2e.invalid';
const OMP_CONTEXT_FIRST_LINE = 'Dispatch two review passes over the staged diff:';
const OMP_LIST_ITEMS = [
  'correctness of every new code path',
  'security of every new code path',
] as const;
const OMP_LINK_TEXT = 'release notes';
const OMP_TASKS = [
  {
    name: 'correctness-review',
    agent: 'reviewer',
    prompt:
      'Review the staged diff for correctness.\nCheck boundary conditions and error paths.\nReport each finding on its own line.',
  },
  {
    name: 'security-review',
    agent: 'auditor',
    prompt:
      'Audit the staged diff for security issues.\nFocus on injection, secrets, and unsafe calls.\nReport each finding on its own line.',
  },
] as const;
const CLAUDE_NAME = 'Summarize the staged diff';
const CLAUDE_PROMPT =
  'Summarize the staged diff.\nList each changed file and its purpose.\nKeep it under ten lines.';

function roomRegion(page: Page, nodeId: string): Locator {
  return page.getByRole('region', { name: `${nodeId} room` });
}

async function openTaskRoom(
  page: Page,
  surface: Surface,
  runId: string,
  nodeId: string
): Promise<Locator> {
  if (surface === 'console') {
    await openRunDetail(page, runId, nodeId);
  } else {
    await openLegacyRunDetail(page, runId);
    await expect(page.getByText(/e2e-task-dispatch/i).first()).toBeVisible({
      timeout: T.medium,
    });
    const logsTab = page.getByRole('tab', { name: 'Logs' });
    if ((await logsTab.count()) > 0) await logsTab.click();
    await page
      .getByRole('button', { name: new RegExp(nodeId) })
      .first()
      .click();
  }
  const room = roomRegion(page, nodeId);
  await expect(room).toBeVisible({ timeout: T.medium });
  await expect(room.locator(ROW_SUMMARY)).toBeVisible({ timeout: T.medium });
  return room;
}

/** Moves an already-open room to another node through the log-row button. */
async function switchRoom(page: Page, nodeId: string): Promise<Locator> {
  await page
    .getByRole('button', { name: new RegExp(nodeId) })
    .first()
    .click();
  const room = roomRegion(page, nodeId);
  await expect(room).toBeVisible({ timeout: T.medium });
  await expect(room.locator(ROW_SUMMARY)).toBeVisible({ timeout: T.medium });
  return room;
}

/** The row for the node's single stored tool call, located by its real tool_use id. */
async function storedToolRow(
  page: Page,
  room: Locator,
  runId: string,
  nodeId: string,
  toolName: 'Task' | 'Agent'
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

/** The open-row body bar's own text — the leaf div whose text is the composed bar. */
async function bodyBarText(row: Locator): Promise<string> {
  return row.evaluate(el => {
    const leaf = Array.from(el.querySelectorAll('div')).find(
      div => div.children.length === 0 && (div.textContent ?? '').trimStart().startsWith('task ·')
    );
    return leaf?.textContent?.trim() ?? '';
  });
}

/**
 * Sizes the room region to the surface's reference width through the
 * production ratio path — same approach as agent-tool-row-visual.spec.ts:
 * measure the resizable group, write the exact room ratio into the persisted
 * split key, remount so `readRoomRatio` applies it, and assert the measured
 * region width rather than the ratio.
 */
async function setRoomWidth(
  page: Page,
  surface: Surface,
  runId: string,
  nodeId: string
): Promise<Locator> {
  const target = REFERENCE_WIDTH[surface];
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
  const room = await openTaskRoom(page, surface, runId, nodeId);
  const width = (await room.boundingBox())?.width ?? 0;
  expect(
    Math.abs(width - target),
    `measured room width ${String(width)} must land within ${String(target)}±${String(ROOM_TOLERANCE_PX)}`
  ).toBeLessThanOrEqual(ROOM_TOLERANCE_PX);
  return room;
}

/**
 * One-line proof for a row or card summary: bounded height, every direct
 * child inside the summary's vertical band, and no clipped content.
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
 * No horizontal overflow attributable to the task body: the room stays inside
 * the viewport, never scrolls horizontally, and no rendered element inside the
 * tool row exceeds the page width. Zero-size (unrendered) descendants of a
 * closed disclosure are skipped.
 */
async function expectNoTaskBodyOverflow(
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
  expect(report.offenders, `no task-body element overflows the page ${context}`).toEqual([]);
}

interface AxNode {
  backendDOMNodeId?: number;
  ignored?: boolean;
  role?: { value?: unknown };
  name?: { value?: unknown };
  properties?: { name: string; value?: { value?: unknown } }[];
}

interface CardAxEvidence {
  found: boolean;
  name: string | null;
  role: string | null;
  expanded: boolean | null;
}

/**
 * Chromium's accessibility tree for one subtask card, queried over CDP scoped
 * to the card's own <details> inside the named room — the console page renders
 * the same tool row in both the execution history and the room, so the query
 * must stay inside the room's region. Same AT channel the row-level spec reads.
 */
async function cardAxEvidence(
  page: Page,
  nodeId: string,
  toolUseId: string,
  cardIndex: number
): Promise<CardAxEvidence> {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('DOM.enable');
    await session.send('Accessibility.enable');
    const doc = (await session.send('DOM.getDocument', { depth: 1 })) as {
      root: { nodeId: number };
    };
    const query = (await session.send('DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector: `[aria-label="${nodeId} room"] details[data-tool-id="${toolUseId}"] details[data-subtask-index="${String(cardIndex)}"]`,
    })) as { nodeId: number };
    if (query.nodeId === 0) return { found: false, name: null, role: null, expanded: null };
    const described = (await session.send('DOM.describeNode', {
      nodeId: query.nodeId,
    })) as { node: { backendNodeId?: number } };
    const detailsBackendId = described.node.backendNodeId;
    const ax = (await session.send('Accessibility.queryAXTree', {
      nodeId: query.nodeId,
    })) as { nodes: AxNode[] };
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

/** Locates the card summary's semantic spans by their pinned text roles. */
function cardParts(
  card: Locator,
  task: { name: string; agent: string | null }
): {
  summary: Locator;
  chevron: Locator;
  agent: Locator;
  name: Locator;
  excerpt: Locator;
  prompt: Locator;
} {
  const summary = card.locator('> summary');
  return {
    summary,
    chevron: summary.locator('> span').first(),
    agent:
      task.agent === null
        ? summary.locator('[data-absent-agent]')
        : summary.getByText(task.agent, { exact: true }),
    name: summary.getByText(task.name, { exact: true }),
    excerpt: summary.locator('> span').last(),
    prompt: card.locator('pre'),
  };
}

for (const surface of ['console', 'legacy'] as const) {
  test(`[P1] [V:task-dispatch.body-${surface}] stored task dispatches render readable bodies on ${surface}`, async ({
    page,
    archon,
  }, testInfo: TestInfo) => {
    test.setTimeout(T.xlong * 2);
    await page.setViewportSize(SPLIT_VIEWPORT);
    const started = await archon.runTaskDispatchWorkflow();
    // Measured values for the visual acceptance report — every table in
    // reports/visual-acceptance.md quotes this JSON attachment.
    const evidence: Record<string, unknown> = { surface };

    // Request observation registers before the first navigation: the context
    // image URL must never be fetched.
    const requests: string[] = [];
    page.on('request', request => requests.push(request.url()));

    // ---- OMP batch node -------------------------------------------------
    let room = await openTaskRoom(page, surface, started.runId, TASK_DISPATCH_OMP_NODE);
    const row = await storedToolRow(page, room, started.runId, TASK_DISPATCH_OMP_NODE, 'Task');
    const toolUseId = (await row.getAttribute('data-tool-id')) ?? '';
    const summary = row.locator('> summary');

    // Closed row: one line, chip + subagent count, body hidden.
    await expect(row).toHaveJSProperty('open', false);
    await expect(summary).toContainText('Task');
    await expect(summary).toContainText('2 subagents');
    const closedRow = await expectSummaryOneLine(summary, 'closed task row');

    // Reference width through the production split-ratio path.
    room = await setRoomWidth(page, surface, started.runId, TASK_DISPATCH_OMP_NODE);
    const sizedRow = room.locator(`details[data-tool-id="${toolUseId}"]`);
    const sizedSummary = sizedRow.locator('> summary');
    await expect(sizedRow).toHaveJSProperty('open', false);
    await expectSummaryOneLine(sizedSummary, 'closed task row at reference width');

    // Keyboard-open the row: bar, context, then one card per subtask.
    await sizedSummary.press('Enter');
    await expect(sizedRow).toHaveJSProperty('open', true);
    const bar = await bodyBarText(sizedRow);
    expect(
      bar.startsWith('task · batch · 2 subtasks'),
      `body bar "${bar}" begins with the batch facts`
    ).toBe(true);
    const barFacts = bar.split(' · ').slice(3);
    for (const fact of barFacts) {
      expect(fact, `bar fact "${fact}" is a runtime fact, never a repeated count`).not.toMatch(
        /subtask|subagent|batch/i
      );
    }

    const context = sizedRow.locator('[data-task-context]');
    await expect(context).toBeVisible();
    await expect(context).toContainText(OMP_CONTEXT_FIRST_LINE);
    await expect(context.locator('strong', { hasText: 'two' })).toHaveCount(1);
    for (const item of OMP_LIST_ITEMS) {
      await expect(context.locator('li', { hasText: item })).toHaveCount(1);
    }
    const cards = sizedRow.locator(CARD);
    await expect(cards).toHaveCount(2);
    // Context precedes the cards in DOM order.
    const firstCardHandle = await cards.nth(0).elementHandle();
    if (firstCardHandle === null) throw new Error('first subtask card did not mount');
    const contextPrecedesCards = await context.evaluate(
      (ctxEl, firstCard) =>
        (ctxEl.compareDocumentPosition(firstCard) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
      firstCardHandle
    );
    expect(contextPrecedesCards, 'context markdown precedes the subtask cards').toBe(true);

    // Security: no image mounts, no executable javascript: target, and the
    // fixture image URL is never requested.
    await expect(sizedRow.locator('img')).toHaveCount(0);
    const unsafeLink = context.locator('a', { hasText: OMP_LINK_TEXT });
    await expect(unsafeLink).toHaveCount(1);
    const unsafeHref = await unsafeLink.getAttribute('href');
    expect(unsafeHref ?? '', 'javascript: scheme is blanked').not.toMatch(/^javascript:/i);
    const imageRequested = requests.some(url => url.includes(OMP_IMAGE_HOST));
    expect(imageRequested, `fixture image ${OMP_IMAGE_URL} is never requested`).toBe(false);

    // Card anatomy: closed native disclosures, agent · name — excerpt.
    const cardAxList: CardAxEvidence[] = [];
    for (const [index, task] of OMP_TASKS.entries()) {
      const card = cards.nth(index);
      await expect(card).toHaveJSProperty('open', false);
      const parts = cardParts(card, task);
      await expect(parts.agent).toHaveText(task.agent ?? '');
      await expect(parts.name).toHaveText(task.name);
      await expect(parts.excerpt).toContainText('— ');
      const ax = await cardAxEvidence(page, TASK_DISPATCH_OMP_NODE, toolUseId, index);
      cardAxList.push(ax);
      expect(ax.found, `card ${String(index)} summary has an accessible node`).toBe(true);
      const axName = ax.name ?? '';
      const agentAt = axName.indexOf(task.agent ?? '');
      const nameAt = axName.indexOf(task.name);
      const excerptAt = axName.indexOf('—');
      expect(agentAt, `card ${String(index)} AX name "${axName}" leads with agent`).toBe(0);
      expect(nameAt, `card ${String(index)} AX name "${axName}" then name`).toBeGreaterThan(
        agentAt
      );
      expect(excerptAt, `card ${String(index)} AX name "${axName}" then excerpt`).toBeGreaterThan(
        nameAt
      );
      expect(axName, 'decorative chevron stays out of the name').not.toContain('▶');
      if (ax.expanded !== null) {
        expect(ax.expanded, `card ${String(index)} mounts collapsed`).toBe(false);
      }
    }

    // DOM-order Tab: outer summary -> context link -> card summaries -> Input/Output.
    const focusableCount = await sizedRow.evaluate(el => {
      const body = el.querySelector(':scope > div');
      if (body === null) return -1;
      return body.querySelectorAll('summary, a[href], button').length;
    });
    expect(focusableCount, 'row body has focusable controls in DOM order').toBeGreaterThanOrEqual(
      4
    );
    for (let index = 0; index < focusableCount; index += 1) {
      await page.keyboard.press('Tab');
      const activeIndex = await sizedRow.evaluate(el => {
        const body = el.querySelector(':scope > div');
        if (body === null) return -1;
        return Array.from(body.querySelectorAll('summary, a[href], button')).indexOf(
          el.ownerDocument.activeElement as Element
        );
      });
      expect(activeIndex, `Tab #${String(index + 1)} follows DOM order`).toBe(index);
    }

    // Enter opens the first card: complete multiline prompt, focus preserved,
    // outer row untouched; Space closes.
    const firstCard = cards.nth(0);
    const firstParts = cardParts(firstCard, OMP_TASKS[0] ?? { name: '', agent: null });
    await firstParts.summary.press('Enter');
    await expect(firstCard).toHaveJSProperty('open', true);
    await expect(sizedRow).toHaveJSProperty('open', true);
    expect(
      await firstParts.summary.evaluate(el => el.ownerDocument.activeElement === el),
      'focus stays on the card summary'
    ).toBe(true);
    const promptText = await firstParts.prompt.textContent();
    expect(promptText, 'card body renders the complete prompt').toBe(OMP_TASKS[0]?.prompt);
    const axOpen = await cardAxEvidence(page, TASK_DISPATCH_OMP_NODE, toolUseId, 0);
    if (axOpen.expanded !== null) {
      await expect
        .poll(
          async () => (await cardAxEvidence(page, TASK_DISPATCH_OMP_NODE, toolUseId, 0)).expanded,
          {
            timeout: T.short,
          }
        )
        .toBe(true);
    }

    // Computed card geometry at the reference width — styles, not classes.
    const cardGeometry = await firstCard.evaluate(el => {
      const view = el.ownerDocument.defaultView;
      const cs = view?.getComputedStyle(el);
      const summaryEl = el.querySelector('summary');
      const sCs = summaryEl !== null ? view?.getComputedStyle(summaryEl) : undefined;
      const chevron = summaryEl?.children[0];
      const cCs = chevron instanceof HTMLElement ? view?.getComputedStyle(chevron) : undefined;
      const prompt = el.querySelector('pre');
      const pCs = prompt !== null ? view?.getComputedStyle(prompt) : undefined;
      return {
        borderTopWidth: cs?.borderTopWidth ?? '',
        borderRadius: cs?.borderRadius ?? '',
        paddingTop: cs?.paddingTop ?? '',
        paddingRight: cs?.paddingRight ?? '',
        paddingBottom: cs?.paddingBottom ?? '',
        paddingLeft: cs?.paddingLeft ?? '',
        marginTop: cs?.marginTop ?? '',
        summaryMinHeight: sCs?.minHeight ?? '',
        summaryFontSize: sCs?.fontSize ?? '',
        chevronWidth: chevron instanceof HTMLElement ? chevron.getBoundingClientRect().width : 0,
        chevronFontSize: cCs?.fontSize ?? '',
        chevronTransitionDuration: cCs?.transitionDuration ?? '',
        chevronTransitionProperty: cCs?.transitionProperty ?? '',
        promptWhiteSpace: pCs?.whiteSpace ?? '',
      };
    });
    expect(cardGeometry.borderTopWidth, 'card 1px border').toBe('1px');
    expect(cardGeometry.borderRadius, 'card 6px radius').toBe('6px');
    expect(cardGeometry.paddingTop, 'card 6px vertical padding').toBe('6px');
    expect(cardGeometry.paddingBottom, 'card 6px vertical padding').toBe('6px');
    expect(cardGeometry.paddingLeft, 'card 9px horizontal padding').toBe('9px');
    expect(cardGeometry.paddingRight, 'card 9px horizontal padding').toBe('9px');
    expect(cardGeometry.marginTop, 'card 5px top margin').toBe('5px');
    expect(cardGeometry.summaryMinHeight, 'card summary >=24px').toBe('24px');
    expect(cardGeometry.summaryFontSize, 'card summary 11.5px mono').toBe('11.5px');
    expect(cardGeometry.chevronWidth, 'card chevron 9px column').toBe(9);
    expect(cardGeometry.chevronFontSize, 'card chevron 10px type').toBe('10px');
    expect(cardGeometry.chevronTransitionDuration, 'card chevron 120ms').toBe('0.12s');
    expect(cardGeometry.chevronTransitionProperty).toContain('transform');
    expect(cardGeometry.promptWhiteSpace, 'prompt wraps').toBe('pre-wrap');

    // Token resolutions: card surface, agent tone, name weight, excerpt tone,
    // prompt surface.
    const elevated = await resolveColorIn(room, 'var(--surface-elevated)');
    const cardBg = await effectiveBackground(firstParts.summary);
    expect(cardBg.resolved, 'card resolves --surface-elevated').toBe(elevated.resolved);
    const approval = await resolveColorIn(room, 'var(--node-approval)');
    const secondary = await resolveColorIn(room, 'var(--text-secondary)');
    const inset = await resolveColorIn(room, 'var(--surface-inset)');
    const agentColor = await firstParts.agent.evaluate(
      el => el.ownerDocument.defaultView?.getComputedStyle(el).color ?? ''
    );
    const agentWeight = await firstParts.agent.evaluate(
      el => el.ownerDocument.defaultView?.getComputedStyle(el).fontWeight ?? ''
    );
    expect(agentColor, 'agent color resolves --node-approval').toBe(approval.resolved);
    expect(agentWeight, 'agent weight 600').toBe('600');
    const nameWeight = await firstParts.name.evaluate(
      el => el.ownerDocument.defaultView?.getComputedStyle(el).fontWeight ?? ''
    );
    expect(nameWeight, 'subtask name bold').toBe('700');
    const excerptColor = await firstParts.excerpt.evaluate(
      el => el.ownerDocument.defaultView?.getComputedStyle(el).color ?? ''
    );
    expect(excerptColor, 'excerpt resolves --text-secondary').toBe(secondary.resolved);
    const promptBg = await effectiveBackground(firstParts.prompt);
    expect(promptBg.resolved, 'prompt box resolves --surface-inset').toBe(inset.resolved);
    const promptFits = await firstParts.prompt.evaluate(el => el.scrollWidth <= el.clientWidth + 1);
    expect(promptFits, 'prompt wraps without horizontal overflow').toBe(true);

    // Focused card summary: solid 2px --accent-bright, surface-paired offset.
    const focus = await firstParts.summary.evaluate(el => {
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
    expect(focus.color, 'card focus outline resolves --accent-bright').toBe(accent.resolved);

    // Reduced motion removes the card chevron's only animation.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const reducedTransition = await firstParts.chevron.evaluate(el => {
      const cs = el.ownerDocument.defaultView?.getComputedStyle(el);
      return { duration: cs?.transitionDuration ?? '', property: cs?.transitionProperty ?? '' };
    });
    expect(reducedTransition.property, 'motion-reduce removes the card chevron animation').toBe(
      'none'
    );
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    await firstParts.summary.press('Space');
    await expect(firstCard).toHaveJSProperty('open', false);
    expect(
      await firstParts.summary.evaluate(el => el.ownerDocument.activeElement === el),
      'focus stays on the card summary after Space'
    ).toBe(true);
    await expect(sizedRow).toHaveJSProperty('open', true);

    const width = REFERENCE_WIDTH[surface];
    const rowShot = await sizedRow.screenshot();
    await testInfo.attach(`${surface}-task-body-${String(width)}.png`, {
      body: rowShot,
      contentType: 'image/png',
    });

    // ---- Claude single node ---------------------------------------------
    const claudeRoom = await switchRoom(page, TASK_DISPATCH_CLAUDE_NODE);
    const claudeRow = await storedToolRow(
      page,
      claudeRoom,
      started.runId,
      TASK_DISPATCH_CLAUDE_NODE,
      'Agent'
    );
    const claudeSummary = claudeRow.locator('> summary');
    await expect(claudeRow).toHaveJSProperty('open', false);
    await expect(claudeSummary).toContainText('Agent');
    await expect(claudeSummary).toContainText('1 subagent');
    await expectSummaryOneLine(claudeSummary, 'closed single-dispatch row');

    await claudeSummary.press('Enter');
    await expect(claudeRow).toHaveJSProperty('open', true);
    const claudeBar = await bodyBarText(claudeRow);
    expect(
      claudeBar.startsWith('task · single dispatch'),
      `body bar "${claudeBar}" begins with the single-dispatch facts`
    ).toBe(true);
    for (const fact of claudeBar.split(' · ').slice(2)) {
      expect(fact, `bar fact "${fact}" never repeats the subagent count`).not.toMatch(
        /subtask|subagent|dispatch/i
      );
    }
    await expect(claudeRow.locator('[data-task-context]')).toHaveCount(0);
    const claudeCards = claudeRow.locator(CARD);
    await expect(claudeCards).toHaveCount(1);
    const claudeCard = claudeCards.first();
    await expect(claudeCard).toHaveJSProperty('open', false);
    const claudeParts = cardParts(claudeCard, { name: CLAUDE_NAME, agent: null });
    const claudeSummaryText = ((await claudeParts.summary.textContent()) ?? '').replace(/^▶/, '');
    expect(claudeSummaryText.indexOf(CLAUDE_NAME), 'single card names the description first').toBe(
      0
    );
    expect(
      claudeSummaryText.slice(0, claudeSummaryText.indexOf('—')),
      'no orphan agent separator before the name'
    ).not.toContain('·');

    await claudeParts.summary.press('Enter');
    await expect(claudeCard).toHaveJSProperty('open', true);
    const claudePrompt = await claudeParts.prompt.textContent();
    expect(claudePrompt, 'single dispatch renders the complete prompt').toBe(CLAUDE_PROMPT);
    await expect(claudeRow).toHaveJSProperty('open', true);

    const claudeShot = await claudeRow.screenshot();
    await testInfo.attach(`${surface}-claude-task-${String(width)}.png`, {
      body: claudeShot,
      contentType: 'image/png',
    });
    const roomShot = await claudeRoom.screenshot();
    await testInfo.attach(`${surface}-room-${String(width)}.png`, {
      body: roomShot,
      contentType: 'image/png',
    });

    // Measured evidence for the report — every value above was already
    // asserted; this preserves the numbers the assertions saw.
    evidence.omp = {
      toolUseId,
      closedRow,
      bar,
      barFacts,
      contextLinkHref: unsafeHref,
      imageRequested,
      cards: cardAxList,
      focusableCount,
      cardGeometry,
      tokens: {
        elevated: elevated.resolved,
        approval: approval.resolved,
        secondary: secondary.resolved,
        inset: inset.resolved,
        accent: accent.resolved,
      },
      focus,
      reducedMotion: reducedTransition,
      promptComplete: promptText === OMP_TASKS[0]?.prompt,
    };
    evidence.claude = {
      bar: claudeBar,
      barFacts: claudeBar.split(' · ').slice(2),
      cardCount: await claudeCards.count(),
      contextBlocks: await claudeRow.locator('[data-task-context]').count(),
      cardSummaryText: claudeSummaryText,
      promptComplete: claudePrompt === CLAUDE_PROMPT,
    };
    await testInfo.attach(`${surface}-task-card-geometry.json`, {
      body: JSON.stringify(evidence, null, 2),
      contentType: 'application/json',
    });
  });

  test(`[P1] [V:task-dispatch.responsive-${surface}] task body stays one-line and usable across viewports and 200% zoom on ${surface}`, async ({
    page,
    archon,
  }) => {
    test.setTimeout(T.xlong * 2);
    const started = await archon.runTaskDispatchWorkflow();

    // Reference state: room at the surface's design width in 1440x1000.
    await page.setViewportSize(SPLIT_VIEWPORT);
    let room = await openTaskRoom(page, surface, started.runId, TASK_DISPATCH_OMP_NODE);
    room = await setRoomWidth(page, surface, started.runId, TASK_DISPATCH_OMP_NODE);
    const row = room.locator(ROW).first();
    const summary = row.locator('> summary');
    await expectSummaryOneLine(summary, 'row at reference width');
    await summary.press('Enter');
    await expect(row).toHaveJSProperty('open', true);
    const cardSummary = row.locator(`${CARD} > summary`).first();
    await expectSummaryOneLine(cardSummary, 'card at reference width');
    await cardSummary.press('Enter');
    const prompt = row.locator(`${CARD} pre`).first();
    await expect(prompt).toBeVisible();
    expect(
      await prompt.evaluate(el => el.scrollWidth <= el.clientWidth + 1),
      'prompt usable at reference width'
    ).toBe(true);
    await expectNoTaskBodyOverflow(room, row, 'at reference width');

    // Narrow state: production responsive layout at 390x844.
    await page.setViewportSize(NARROW_VIEWPORT);
    const narrowRoom = await openTaskRoom(page, surface, started.runId, TASK_DISPATCH_OMP_NODE);
    const narrowRow = narrowRoom.locator(ROW).first();
    const narrowSummary = narrowRow.locator('> summary');
    await expectSummaryOneLine(narrowSummary, 'row at 390px');
    await narrowSummary.press('Enter');
    await expect(narrowRow).toHaveJSProperty('open', true);
    const narrowCard = narrowRow.locator(`${CARD} > summary`).first();
    await expectSummaryOneLine(narrowCard, 'card at 390px');
    await narrowCard.press('Enter');
    const narrowPrompt = narrowRow.locator(`${CARD} pre`).first();
    await expect(narrowPrompt).toBeVisible();
    expect(
      await narrowPrompt.evaluate(el => el.scrollWidth <= el.clientWidth + 1),
      'prompt usable at 390px'
    ).toBe(true);
    await expectNoTaskBodyOverflow(narrowRoom, narrowRow, 'at 390x844');

    // 200% zoom through the established CDP device-metrics override.
    const chrome = await page.context().newCDPSession(page);
    try {
      await page.setViewportSize(SPLIT_VIEWPORT);
      const zoomRoom = await openTaskRoom(page, surface, started.runId, TASK_DISPATCH_OMP_NODE);
      const zoomRow = zoomRoom.locator(ROW).first();
      const zoomSummary = zoomRow.locator('> summary');
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
      await expect(zoomSummary).toBeVisible();
      await expectSummaryOneLine(zoomSummary, 'row at 200% zoom');
      await zoomSummary.press('Enter');
      await expect(zoomRow).toHaveJSProperty('open', true);
      const zoomCard = zoomRow.locator(`${CARD} > summary`).first();
      await expectSummaryOneLine(zoomCard, 'card at 200% zoom');
      await zoomCard.press('Enter');
      const zoomPrompt = zoomRow.locator(`${CARD} pre`).first();
      await expect(zoomPrompt).toBeVisible();
      expect(
        await zoomPrompt.evaluate(el => el.scrollWidth <= el.clientWidth + 1),
        'prompt usable at 200% zoom'
      ).toBe(true);
      await expectNoTaskBodyOverflow(zoomRoom, zoomRow, 'at 200% zoom');
    } finally {
      await chrome.send('Emulation.clearDeviceMetricsOverride');
      await chrome.detach();
    }
  });
}

test('[P1] [V:task-dispatch.contrast] task card text resolves to >=4.5:1 on both surfaces', async ({
  page,
  archon,
}, testInfo: TestInfo) => {
  test.setTimeout(T.xlong * 2);
  await page.setViewportSize(SPLIT_VIEWPORT);
  const started = await archon.runTaskDispatchWorkflow();
  const evidence: Record<string, Record<string, number | string>> = {};

  for (const surface of ['console', 'legacy'] as const) {
    const room = await openTaskRoom(page, surface, started.runId, TASK_DISPATCH_OMP_NODE);
    const row = await storedToolRow(page, room, started.runId, TASK_DISPATCH_OMP_NODE, 'Task');
    await row.locator('> summary').press('Enter');
    await expect(row).toHaveJSProperty('open', true);
    const card = row.locator(CARD).first();
    const parts = cardParts(card, OMP_TASKS[0] ?? { name: '', agent: null });
    await parts.summary.press('Enter');
    await expect(card).toHaveJSProperty('open', true);

    const cardBg = await effectiveBackground(parts.summary);
    const promptBg = await effectiveBackground(parts.prompt);
    const surfaceEvidence: Record<string, number | string> = {
      'card background': cardBg.resolved,
      'prompt background': promptBg.resolved,
    };
    const tones: { label: string; locator: Locator; bg: Rgba }[] = [
      { label: 'agent text', locator: parts.agent, bg: cardBg.c },
      { label: 'subtask name', locator: parts.name, bg: cardBg.c },
      { label: 'excerpt text', locator: parts.excerpt, bg: cardBg.c },
      { label: 'prompt text', locator: parts.prompt, bg: promptBg.c },
    ];
    for (const tone of tones) {
      const fg = await tone.locator.evaluate((el: HTMLElement) => {
        const doc = el.ownerDocument;
        const color = doc.defaultView?.getComputedStyle(el).color ?? '';
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
      const ratio = contrastRatio(fg.c, tone.bg);
      surfaceEvidence[`${tone.label} resolved`] = fg.resolved;
      surfaceEvidence[`${tone.label} ratio`] = Number(ratio.toFixed(2));
      expect(ratio, `${surface} ${tone.label} contrast >= 4.5:1`).toBeGreaterThanOrEqual(4.5);
    }
    evidence[surface] = surfaceEvidence;
  }
  await testInfo.attach('task-card-contrast.json', {
    body: JSON.stringify(evidence, null, 2),
    contentType: 'application/json',
  });
});
