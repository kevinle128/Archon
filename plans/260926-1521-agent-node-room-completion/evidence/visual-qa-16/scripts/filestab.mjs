// filestab.mjs <web> <runId> : open the run detail, choose the Files changed tab, record its text and a screenshot.
import fs from 'node:fs';
import { chromium } from '/Users/dale/orca/workspaces/Archon/develop-2/e2e/node_modules/playwright/index.mjs';
const [web, R] = process.argv.slice(2);
const dir = new URL('.', import.meta.url).pathname;
const b = await chromium.launch();
const ctx = await b.newContext({
  baseURL: `http://localhost:${web}`,
  viewport: { width: 1440, height: 900 },
  extraHTTPHeaders: { 'X-Archon-User': 'vq16-operator' },
});
const p = await ctx.newPage();
await p.goto(`/workflows/runs/${R}`);
await p
  .getByRole('tab', { name: /Files changed/ })
  .first()
  .click()
  .catch(async () => p.getByText('Files changed').first().click());
await p.waitForTimeout(2500);
const text = await p.locator('main').first().innerText();
await p.screenshot({ path: `${dir}shots/app-a-retry-files-changed.png` });
fs.writeFileSync(
  `${dir}data/files-changed.json`,
  JSON.stringify({ R, text: text.slice(0, 1500) }) + '\n'
);
console.log(text.slice(0, 900));
await b.close();
