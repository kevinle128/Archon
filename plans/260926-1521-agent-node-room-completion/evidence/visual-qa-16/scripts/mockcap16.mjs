// mockcap16.mjs : Legacy Node Room mockup crops (<aside>) for 8 sub-states x {prompt, loop} x {soft-inject (default), queue only},
// plus the two static sheets and the aside text of each state (for copy comparison).
import fs from 'node:fs';
import { chromium } from '/Users/dale/orca/workspaces/Archon/develop-2/e2e/node_modules/playwright/index.mjs';
const OUT = new URL('.', import.meta.url).pathname + 'mock';
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
const states = [
  '1 · generating',
  '2 · interrupting',
  '3 · idle after interrupt',
  '4 · generating again',
  '5 · finished · undelivered',
  '6 · finished · clean',
  '7 · failed · 30-min',
  '8 · restart recovery',
];
const text = {};
const tbtn = () => p.locator('button', { hasText: /soft-inject|queue only/ }).first();
for (const tr of ['si', 'qo']) {
  await p.goto('http://127.0.0.1:8798/' + encodeURIComponent('Legacy Node Room') + '.dc.html');
  await p.waitForTimeout(1500);
  for (let i = 0; i < 5; i++) {
    const t = await tbtn().innerText();
    if ((tr === 'si' && /soft-inject/.test(t)) || (tr === 'qo' && /codex/.test(t))) break;
    await tbtn().click();
    await p.waitForTimeout(200);
  }
  const trLabel = await tbtn().innerText();
  for (const node of ['prompt', 'loop']) {
    await p
      .locator('button', { hasText: node === 'prompt' ? /^prompt$/ : /^loop/ })
      .first()
      .click();
    await p.waitForTimeout(300);
    for (const [i, s] of states.entries()) {
      await p.locator('button', { hasText: s }).first().click();
      await p.waitForTimeout(400);
      const a = p.locator('aside').first();
      await a.screenshot({ path: `${OUT}/mock-${tr}-${node}-s${i + 1}.png` });
      text[`${tr}-${node}-s${i + 1}`] = {
        transport: trLabel,
        text: await a.innerText(),
        width: await a.evaluate(e => Math.round(e.getBoundingClientRect().width)),
      };
    }
  }
}
for (const [f, n] of [
  ['Steering Dock States', 'dock-states'],
  ['Transcript States', 'transcript-states'],
]) {
  await p.goto('http://127.0.0.1:8798/' + encodeURIComponent(f) + '.dc.html');
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${OUT}/mock-${n}.png`, fullPage: true });
  text[n] = { text: await p.locator('body').innerText() };
}
fs.writeFileSync(OUT + '/mock-text.json', JSON.stringify(text) + '\n');
await b.close();
console.log(Object.keys(text).length);
