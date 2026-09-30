// snap.mjs <web> <runId> <node> <tag> : two fresh contexts (tab A 1440 px, tab B 1000 px) load the run detail deep link;
// room screenshot, room text tail, width and alerts per tab.
import fs from 'node:fs';
import { chromium } from '/Users/dale/orca/workspaces/Archon/develop-2/e2e/node_modules/playwright/index.mjs';
const [web, R, N, tag] = process.argv.slice(2);
const dir = new URL('.', import.meta.url).pathname;
const b = await chromium.launch();
const out = {};
for (const [k, w, h] of [
  ['a', 1440, 900],
  ['n', 1000, 800],
]) {
  const ctx = await b.newContext({
    baseURL: `http://localhost:${web}`,
    viewport: { width: w, height: h },
    extraHTTPHeaders: { 'X-Archon-User': 'vq16-operator' },
  });
  const p = await ctx.newPage();
  await p.goto(`/workflows/runs/${R}?node=${encodeURIComponent(N)}`);
  const room = p.locator('[data-testid="legacy-node-room"]').first();
  await room.waitFor({ timeout: 30000 });
  await p.waitForTimeout(3000);
  await room.screenshot({ path: `${dir}shots/app-${k}-${tag}.png` });
  out[k] = await room.evaluate(e => ({
    width: Math.round(e.getBoundingClientRect().width),
    head: e.innerText.slice(0, 240),
    tail: e.innerText.slice(-420),
    alerts: [...e.querySelectorAll('[role=alert]')].map(a => a.textContent.trim().slice(0, 120)),
    fields: e.querySelectorAll('textarea').length,
    buttons: [...e.querySelectorAll('button')].map(x => x.innerText.trim()).filter(Boolean),
  }));
  await ctx.close();
}
await b.close();
fs.writeFileSync(`${dir}data/snap-${tag}.json`, JSON.stringify(out) + '\n');
console.log(JSON.stringify(out));
