import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { env } from 'node:process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../lib/playwright/suite';
import { openRunDetail, openLegacyRunDetail } from '../lib/playwright/run-detail';
import { HITL_INSPECT_NODE, HITL_ASK_NODE } from '../lib/playwright/archon-runtime';

const tooling = join(dirname(fileURLToPath(import.meta.url)), '../..');
const target = env.ARCHON_E2E_REPO_ROOT ?? tooling;
const designRoot =
  '_bmad-output/planning-artifacts/ux-designs/ux-Archon-agent-node-room-2026-09-09/mockups';
const mockRoot = '_bmad-output/specs/spec-workflow-run-view-hitl/ux-mockup';

async function openRoom(
  page: Page,
  surface: string,
  runId: string,
  nodeId: string
): Promise<Locator> {
  if (surface === 'console') await openRunDetail(page, runId, nodeId);
  else {
    await openLegacyRunDetail(page, runId);
    await page.getByRole('tab', { name: 'Logs', exact: true }).click();
    await page
      .getByRole('button', { name: new RegExp(nodeId) })
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
  test.setTimeout(180_000);
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
  const cases: unknown[] = [];
  try {
    for (const surface of config.surfaces) {
      for (const viewport of config.viewports) {
        for (const state of config.states) {
          const id = `${surface}-${viewport.width}-${state}`;
          await page.setViewportSize(viewport);
          const node = state === 'ask-pending' ? HITL_ASK_NODE : HITL_INSPECT_NODE;
          let room = await openRoom(page, surface, started.runId, node);
          if (viewport.width === 1440) {
            const panel = page.locator(`#${surface}-run-room`);
            const metrics = await panel.evaluate(el => ({
              width: el.getBoundingClientRect().width,
              group: el.parentElement!.getBoundingClientRect().width,
            }));
            const width = (await room.boundingBox())!.width;
            const ratio = ((460 + metrics.width - width) / metrics.group) * 100;
            await page.evaluate(
              ({ key, ratio }): void => {
                localStorage.setItem(key, String(ratio));
              },
              { key: `archon.run-room.ratio.${surface}`, ratio }
            );
            room = await openRoom(page, surface, started.runId, node);
            expect(Math.abs((await room.boundingBox())!.width - 460)).toBeLessThanOrEqual(2);
          }
          // Enter keyboard modality before setting the capture's focus target.
          // Legacy reaches the room by pointer, which suppresses :focus-visible.
          await page.keyboard.press('Tab');
          let actual: Locator;
          if (state === 'ask-pending') {
            actual = room.locator('form').first();
            await room.getByRole('radio').first().focus();
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
          if (state === 'ask-pending') {
            source = `${mockRoot}/${surface === 'console' ? 'console' : 'index'}.html`;
            await reference.goto(pathToFileURL(join(target, source)).href);
            if (surface === 'legacy')
              await reference.getByRole('button', { name: 'Chat', exact: true }).click();
            expected = reference.locator('#ask-clarify');
            await expect(expected).toBeVisible({ timeout: 30_000 });
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
            viewport,
            reference_viewport: { width: 1440, height: 1000 },
            source,
            actual_geometry: actualGeometry,
            room_geometry: await room.boundingBox(),
            reference_geometry: await expected.boundingBox(),
            images,
          });
          await writeFile(
            join(output, 'visual-manifest.json'),
            JSON.stringify({ runId: started.runId, cases }, null, 2)
          );
        }
      }
    }
  } finally {
    await reference.close();
  }
});
