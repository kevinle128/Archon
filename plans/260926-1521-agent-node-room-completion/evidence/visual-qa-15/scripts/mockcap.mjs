// mockcap.mjs : mockup crops of the room panel (<aside>) for 8 sub-states x {prompt, loop} x {Console, Legacy}, transport
// switched to `codex · queue only` (no provider in scope proves soft injection), plus the two static sheets.
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
for (const [f, sh] of [
  ['Console Node Room', 'console'],
  ['Legacy Node Room', 'legacy'],
]) {
  await p.goto('http://127.0.0.1:8797/' + encodeURIComponent(f) + '.dc.html');
  await p.waitForTimeout(1500);
  for (let i = 0; i < 4; i++) {
    const t = await p
      .locator('button', { hasText: /soft-inject|queue only/ })
      .first()
      .innerText();
    if (/codex/.test(t)) break;
    await p
      .locator('button', { hasText: /soft-inject|queue only/ })
      .first()
      .click();
    await p.waitForTimeout(200);
  }
  const tr = await p
    .locator('button', { hasText: /soft-inject|queue only/ })
    .first()
    .innerText();
  for (const node of ['prompt', 'loop']) {
    await p
      .locator('button', { hasText: node === 'prompt' ? /^prompt$/ : /^loop/ })
      .first()
      .click();
    await p.waitForTimeout(300);
    for (const [i, s] of states.entries()) {
      await p.locator('button', { hasText: s }).first().click();
      await p.waitForTimeout(400);
      await p
        .locator('aside')
        .first()
        .screenshot({ path: `${OUT}/mock-${sh}-${node}-s${i + 1}.png` });
    }
  }
  console.log(sh, 'transport', tr);
}
for (const [f, n] of [
  ['Steering Dock States', 'dock-states'],
  ['Transcript States', 'transcript-states'],
]) {
  await p.goto('http://127.0.0.1:8797/' + encodeURIComponent(f) + '.dc.html');
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${OUT}/mock-${n}.png`, fullPage: true });
}
await b.close();
