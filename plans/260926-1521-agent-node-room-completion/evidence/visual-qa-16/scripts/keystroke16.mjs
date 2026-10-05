// keystroke16.mjs : at I2 Stop + 26 min, type one key into a fresh run-detail tab (own browser) and record draft/keepalive responses.
import fs from 'node:fs';
import { chromium } from '/Users/dale/orca/workspaces/Archon/develop-2/e2e/node_modules/playwright/index.mjs';
const T = 1790792192083 + 26 * 60 * 1000;
while (Date.now() < T) await new Promise(r => setTimeout(r, 1000));
const b = await chromium.launch();
const ctx = await b.newContext({
  baseURL: 'http://localhost:5323',
  viewport: { width: 1440, height: 900 },
  extraHTTPHeaders: { 'X-Archon-User': 'vq16-operator' },
});
const p = await ctx.newPage();
const resp = [];
p.on('response', r => {
  if (/\/(draft|keepalive)(\?|$)/.test(r.url()))
    resp.push([
      Date.now(),
      r.request().method(),
      r.url().replace(/^.*\/nodes\/[^/]+/, ''),
      r.status(),
    ]);
});
await p.goto('/workflows/runs/7c3b58ab27f1d378259043341aa5b17c?node=cl-node');
const room = p.locator('[data-testid="legacy-node-room"]').first();
await room.waitFor({ timeout: 30000 });
await p.waitForTimeout(1500);
await room.locator('textarea').first().click();
const t = Date.now();
await p.keyboard.type('k');
await p.waitForTimeout(4000);
await b.close();
fs.writeFileSync(
  '/private/tmp/claude-501/-Users-dale-orca-workspaces-Archon-develop-2/c3af2ea9-daf2-4dac-a244-7679f5cdbb02/scratchpad/vq16-1790791870/tk/data/I2-keystroke.json',
  JSON.stringify({ keystroke: t, keystrokeIso: new Date(t).toISOString(), resp }) + '\n'
);
