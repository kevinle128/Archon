// glyphs.mjs <web> <tag:runId:node>... : status glyph lines and outcome words in each finished room (tab A, 1440 px).
import fs from 'node:fs';
import { chromium } from '/Users/dale/orca/workspaces/Archon/develop-2/e2e/node_modules/playwright/index.mjs';
const [web, ...specs] = process.argv.slice(2);
const b = await chromium.launch();
const ctx = await b.newContext({
  baseURL: `http://localhost:${web}`,
  viewport: { width: 1440, height: 900 },
  extraHTTPHeaders: { 'X-Archon-User': 'vq16-operator' },
});
const p = await ctx.newPage();
const out = {};
for (const s of specs) {
  const [tag, R, N] = s.split(':');
  await p.goto(`/workflows/runs/${R}?node=${N}`);
  const room = p.locator('[data-testid="legacy-node-room"]').first();
  try {
    await room.waitFor({ timeout: 20000 });
  } catch {
    out[tag] = { error: 'no room', url: p.url() };
    continue;
  }
  await p.waitForTimeout(2500);
  out[tag] = await room.evaluate(e => {
    const lines = e.innerText.split('\n').map(x => x.trim());
    const c = {};
    for (const g of ['✓', '✕', '◐', '⚠', '–']) c[g] = lines.filter(x => x === g).length;
    return {
      glyphs: c,
      interrupted: lines.filter(x => x === 'interrupted').length,
      outputUnknown: lines.filter(x => /output unknown/.test(x)).length,
      openDetails: e.querySelectorAll('details[open]').length,
      pill: (e.innerText
        .slice(0, 200)
        .match(/\b(Running|Completed|Failed|Recovery required)\b/) || [''])[0],
    };
  });
}
await b.close();
fs.writeFileSync(
  new URL('.', import.meta.url).pathname + 'data/glyphs.json',
  JSON.stringify(out) + '\n'
);
console.log(JSON.stringify(out, null, 0));
