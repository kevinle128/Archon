import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { env } from 'node:process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../lib/playwright/suite';
import { openRunDetail, openLegacyRunDetail } from '../lib/playwright/run-detail';
import {
  HITL_INSPECT_NODE,
  HITL_ASK_NODE,
  E2E_QUEUE_GUIDANCE_WORKFLOW_NAME,
  QUEUE_GUIDANCE_NODE,
  TRANSCRIPT_STRUCTURED_NODE,
  TRANSCRIPT_STRUCTURED_TEXT,
  transcriptReportEnvelope,
} from '../lib/playwright/archon-runtime';

const tooling = join(dirname(fileURLToPath(import.meta.url)), '../..');
const target = env.ARCHON_E2E_REPO_ROOT ?? tooling;
const designRoot =
  '_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/mockups';
const mockRoot = '_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup';
const steeringMockRoot = 'claude-design/design_handoff_node_room_transcript_steering';
const queueMessages = ['wrong suite — use -p archon-workflows', 'and skip the doctests'] as const;
// States captured from the prepared transcript-display run rather than the HITL run.
const transcriptStates = new Set(['assistant-report', 'runtime-graph']);

interface QueueAnatomy {
  headerLabel: boolean;
  listPresent: boolean;
  messages: string[];
  humanTextUsesMono: boolean;
  sentStatuses: number;
}

async function queueAnatomy(section: Locator): Promise<QueueAnatomy> {
  return section.evaluate((element, messages) => {
    // Current dock: always-open section with h3 header + ul list (no collapsible button).
    const header = element.querySelector('h3');
    const list = element.querySelector('[role="list"], ul');
    const rows = list === null ? [] : Array.from(list.children);
    const rowTexts = rows.map(row => {
      const message = Array.from(row.querySelectorAll('span')).find(child => {
        const text = child.textContent?.trim() ?? '';
        return text.length > 0 && text.toLowerCase() !== 'sent';
      });
      return message?.textContent?.trim() ?? '';
    });
    const firstMessage = Array.from(rows[0]?.querySelectorAll('span') ?? []).find(child => {
      const text = child.textContent?.trim() ?? '';
      return text === messages[0];
    });
    const font = firstMessage === undefined ? '' : getComputedStyle(firstMessage).fontFamily;
    return {
      headerLabel:
        header !== null && (header.textContent?.toLowerCase().includes('queued') ?? false),
      listPresent: list !== null,
      messages: rowTexts,
      humanTextUsesMono: /JetBrains Mono|monospace/i.test(font),
      sentStatuses: rows.reduce(
        (count, row) =>
          count +
          Array.from(row.querySelectorAll('span')).filter(
            child => child.textContent?.trim().toLowerCase() === 'sent'
          ).length,
        0
      ),
    };
  }, queueMessages);
}

async function openRoom(
  page: Page,
  surface: string,
  runId: string,
  nodeId: string,
  rowName = nodeId
): Promise<Locator> {
  if (surface === 'console') await openRunDetail(page, runId, nodeId);
  else {
    await openLegacyRunDetail(page, runId);
    await page.getByRole('tab', { name: 'Logs', exact: true }).click();
    await page
      .getByRole('button', { name: new RegExp(rowName) })
      .first()
      .click();
  }
  const room = page.getByRole('region', { name: `${nodeId} room` });
  await expect(room).toBeVisible();
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
  });
  return room;
}

test('[V:verify.visual-captures] Matched current reference and real run captures', async ({
  page,
  archon,
  context,
}, testInfo) => {
  test.setTimeout(300_000);
  const output = env.ARCHON_VERIFY_EVIDENCE ?? testInfo.outputPath('visual');
  await mkdir(output, { recursive: true });
  const reference = await context.newPage();
  const config = JSON.parse(
    await readFile(join(tooling, '.agents/skills/verify-archon/visual-config.json'), 'utf8')
  ) as {
    sources: { path: string; sha256: string }[];
    surfaces: string[];
    states: string[];
    viewports: { width: number; height: number }[];
  };
  const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
  for (const source of config.sources)
    expect(hash(await readFile(join(target, source.path)))).toBe(source.sha256);
  const started = await archon.runHitlWorkflow();
  const transcriptRun = await archon.prepareTranscriptDisplayRun();
  const cases: unknown[] = [];
  try {
    for (const surface of config.surfaces) {
      for (const viewport of config.viewports) {
        for (const state of config.states) {
          const id = `${surface}-${viewport.width}-${state}`;
          await page.setViewportSize(viewport);
          const runId = transcriptStates.has(state) ? transcriptRun.runId : started.runId;
          let actual: Locator;
          let room: Locator | null = null;
          let queueFacts: QueueAnatomy | null = null;
          if (state === 'queue-waiting') {
            const queueRun = await archon.startWorkflowViaWeb(
              E2E_QUEUE_GUIDANCE_WORKFLOW_NAME,
              `verify queue ${surface} ${String(viewport.width)}`
            );
            room = await openRoom(page, surface, queueRun.runId, QUEUE_GUIDANCE_NODE);
            const field = room.getByRole('textbox', { name: /^message to / });
            const queue = room.getByRole('button', { name: /^Queue/ });
            for (const message of queueMessages) {
              await field.fill(message);
              await queue.click();
            }
            const list = room.getByRole('list', { name: /^Queued messages/ });
            await expect(list.getByRole('listitem')).toHaveCount(queueMessages.length);
            // Queue band root is the section that owns the list.
            actual = list.locator('xpath=ancestor::section[1]');
            await expect(actual.locator('h3')).toBeVisible();
            queueFacts = await queueAnatomy(actual);
          } else if (state === 'runtime-graph') {
            if (surface === 'console') {
              await openRunDetail(page, runId);
              await page.getByRole('button', { name: 'Graph', exact: true }).click();
              await expect(page.getByTestId('console-run-graph-canvas')).toBeVisible({
                timeout: 30_000,
              });
            } else {
              await openLegacyRunDetail(page, runId);
              const graphTab = page.getByRole('tab', { name: 'Graph', exact: true });
              if ((await graphTab.count()) > 0) await graphTab.click();
              await expect(page.locator('.react-flow__node').first()).toBeVisible({
                timeout: 30_000,
              });
            }
            actual = page.locator(`#${surface}-run-view`);
          } else {
            const node =
              state === 'ask-pending'
                ? HITL_ASK_NODE
                : state === 'assistant-report'
                  ? TRANSCRIPT_STRUCTURED_NODE
                  : HITL_INSPECT_NODE;
            room = await openRoom(page, surface, runId, node, node.split('.').at(-1) ?? node);
            if (viewport.width === 1440) {
              const expected = surface === 'console' ? 520 : 460;
              const panel = page.locator(`#${surface}-run-room`);
              await expect(panel, `${surface} outer room panel`).toBeVisible();
              const panelBox = await panel.boundingBox();
              expect(panelBox, `${surface} outer room bounding box`).toBeTruthy();
              const outerWidth = panelBox?.width ?? 0;
              expect(outerWidth, `${surface} outer room width must be non-zero`).toBeGreaterThan(0);
              expect(
                Math.abs(outerWidth - expected),
                `outer #${surface}-run-room ${String(outerWidth)} must be ${String(expected)}±1`
              ).toBeLessThanOrEqual(1);
              const regionBox = await room.boundingBox();
              expect(regionBox, `${surface} room region bounding box`).toBeTruthy();
              const regionWidth = regionBox?.width ?? 0;
              expect(regionWidth, `${surface} room region width must be non-zero`).toBeGreaterThan(
                0
              );
              // Region may sit inset inside the outer panel; stay within outer ±2.
              expect(
                Math.abs(regionWidth - outerWidth),
                `region ${String(regionWidth)} stays near outer ${String(outerWidth)}`
              ).toBeLessThanOrEqual(2);
            }
            // Enter keyboard modality before setting the capture's focus target.
            // Legacy reaches the room by pointer, which suppresses :focus-visible.
            await page.keyboard.press('Tab');
            if (state === 'ask-pending') {
              actual = room.locator('form').first();
              await room.getByRole('radio').first().focus();
            } else if (state === 'assistant-report') {
              // The definition resolves asynchronously; the canonical envelope
              // disappearing is the moment output_format unwrapped the row.
              await expect(room).not.toContainText(
                transcriptReportEnvelope(TRANSCRIPT_STRUCTURED_TEXT),
                { timeout: 30_000 }
              );
              actual = room
                .locator('.chat-markdown')
                .filter({ hasText: TRANSCRIPT_STRUCTURED_TEXT })
                .first();
            } else {
              actual = room.locator('details[data-tool-id]').first();
              const summary = actual.locator('summary').first();
              await summary.focus();
              if (state === 'raw-open') {
                await summary.press('Enter');
                const raw = actual.getByRole('button', { name: 'Raw', exact: true });
                await raw.focus();
                await raw.press('Enter');
                await expect(actual.locator('pre')).toBeVisible();
              }
            }
          }
          await expect(actual).toBeVisible();
          const actualGeometry = await actual.boundingBox();
          if (!actualGeometry) throw new Error('Actual region is not measurable');
          expect(actualGeometry.width).toBeGreaterThan(100);
          const actualRegion = `${id}-actual-region.png`;
          const actualContext = `${id}-actual-context.png`;
          await actual.screenshot({ path: join(output, actualRegion) });
          await page.screenshot({ path: join(output, actualContext) });

          await reference.setViewportSize({ width: 1440, height: 1000 });
          let expected: Locator;
          let source: string;
          if (state === 'queue-waiting') {
            source = `${steeringMockRoot}/${surface === 'console' ? 'Console' : 'Legacy'} Node Room.dc.html`;
            await reference.goto(pathToFileURL(join(target, source)).href);
            const header = reference.getByRole('button', { name: /Queued.*2/i });
            await expect(header).toBeVisible({ timeout: 30_000 });
            expected = header.locator('xpath=..');
          } else if (state === 'ask-pending') {
            source = `${mockRoot}/${surface === 'console' ? 'console' : 'index'}.html`;
            await reference.goto(pathToFileURL(join(target, source)).href);
            if (surface === 'legacy')
              await reference.getByRole('button', { name: 'Chat', exact: true }).click();
            expected = reference.locator('#ask-clarify');
            await expect(expected).toBeVisible({ timeout: 30_000 });
          } else if (state === 'runtime-graph') {
            source = `${mockRoot}/${surface === 'console' ? 'console' : 'index'}.html`;
            await reference.goto(pathToFileURL(join(target, source)).href);
            if (surface === 'console') await reference.locator('button[data-view="graph"]').click();
            expected = reference.locator(surface === 'console' ? '#cc-graph' : '#tab-graph');
            await expect(reference.locator('.gnode').first()).toBeVisible({ timeout: 30_000 });
          } else {
            source =
              state === 'raw-open'
                ? `${designRoot}/key-transcript-states.html`
                : `${designRoot}/key-${surface}-node-room.html`;
            await reference.goto(pathToFileURL(join(target, source)).href);
            expected =
              state === 'raw-open'
                ? reference
                    .locator('details')
                    .filter({ has: reference.getByRole('button', { name: 'Raw ▾', exact: true }) })
                : state === 'assistant-report'
                  ? reference.locator('.asst').last()
                  : reference.locator('.tcall').first();
          }
          await expect(expected).toBeVisible();
          await expected.evaluate((element, width): void => {
            const region = element as HTMLElement;
            region.style.width = `${width}px`;
            region.style.maxWidth = `${width}px`;
          }, actualGeometry.width);
          await expected.scrollIntoViewIfNeeded();
          await reference.evaluate(async (): Promise<void> => {
            await document.fonts.ready;
          });
          const referenceRegion = `${id}-reference-region.png`;
          const referenceContext = `${id}-reference-context.png`;
          await expected.screenshot({ path: join(output, referenceRegion) });
          await reference.screenshot({ path: join(output, referenceContext) });
          const files = [actualRegion, actualContext, referenceRegion, referenceContext];
          const images = await Promise.all(
            files.map(async path => ({ path, sha256: hash(await readFile(join(output, path))) }))
          );
          cases.push({
            id,
            surface,
            state,
            runId,
            viewport,
            reference_viewport: { width: 1440, height: 1000 },
            source,
            actual_geometry: actualGeometry,
            room_geometry: room ? await room.boundingBox() : undefined,
            reference_geometry: await expected.boundingBox(),
            images,
          });
          await writeFile(
            join(output, 'visual-manifest.json'),
            JSON.stringify({ runId: started.runId, cases }, null, 2)
          );
          if (queueFacts !== null) {
            expect(queueFacts).toEqual({
              headerLabel: true,
              listPresent: true,
              messages: [...queueMessages],
              humanTextUsesMono: true,
              sentStatuses: queueMessages.length,
            });
          }
        }
      }
    }
  } finally {
    await reference.close();
  }
});
