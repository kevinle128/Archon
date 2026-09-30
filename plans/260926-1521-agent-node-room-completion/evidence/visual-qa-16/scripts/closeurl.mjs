// closeurl.mjs <web> <runId> <node> : URL and room presence after the room's close control at 1440 px (Close) and 1000 px (Back).
import { chromium } from '/Users/dale/orca/workspaces/Archon/develop-2/e2e/node_modules/playwright/index.mjs';
const [web, R, N] = process.argv.slice(2);
const b = await chromium.launch();
const out = {};
for (const w of [1440, 1000]) {
  const ctx = await b.newContext({
    baseURL: `http://localhost:${web}`,
    viewport: { width: w, height: 900 },
    extraHTTPHeaders: { 'X-Archon-User': 'vq16-operator' },
  });
  const p = await ctx.newPage();
  await p.goto(`/workflows/runs/${R}?node=${N}`);
  const room = p.locator('[data-testid="legacy-node-room"]').first();
  await room.waitFor({ timeout: 20000 });
  await p.waitForTimeout(1000);
  const btn = room.locator('button[aria-label="Close"], button[aria-label="Back"]').first();
  const label = await btn.getAttribute('aria-label');
  await btn.click();
  await p.waitForTimeout(1000);
  out[w] = {
    label,
    url: new URL(p.url()).search,
    roomAfter: await p.locator('[data-testid="legacy-node-room"]').count(),
  };
  await p.reload();
  await p.waitForTimeout(2500);
  out[w].roomAfterReload = await p.locator('[data-testid="legacy-node-room"]').count();
  await ctx.close();
}
await b.close();
console.log(JSON.stringify(out));
