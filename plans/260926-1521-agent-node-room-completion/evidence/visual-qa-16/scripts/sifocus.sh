#!/bin/bash
# sifocus.sh <tag> : keyboard focus after a per-item Send now (Enter) and, for comparison, after a per-item ✕ (Enter),
# on the fake soft-inject provider. Samples document.activeElement on every animation frame.
cd "$(dirname "$0")"; TAG=$1
R=$(./dispatch.sh 3456 vq16-fake-si "$TAG run"); echo $R > $TAG.run; sleep 2
cat <<JS | ./dr.sh fake2
await G.open('c','$R','fake-node'); await G.until('c', x => /Stop/.test(x.btns), 30000); await G.wait(800);
const p = G.pages.c;
const fs = () => p.evaluate(() => { window.__f = []; const t0 = Date.now(); const tick = () => { const a = document.activeElement; const k = a ? a.tagName + ':' + (a.getAttribute('aria-label') || '').slice(0, 24) : 'NONE'; if (!window.__f.length || window.__f[window.__f.length - 1][1] !== k) window.__f.push([Date.now(), k]); if (Date.now() - t0 < 4000) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
await G.queue('c', '$TAG A first'); await G.queue('c', '$TAG B second'); await G.queue('c', '$TAG C third'); await G.wait(1200);
const out = { R: '$R' };
await G.room('c').locator('button[aria-label^="Send now · $TAG B"]').first().focus();
await fs(); const t1 = Date.now(); await p.keyboard.press('Enter'); await G.wait(4200);
out.sendNowEnter = (await p.evaluate(() => window.__f)).map(x => [x[0] - t1, x[1]]);
await G.room('c').locator('button[aria-label^="delete · $TAG A"]').first().focus();
await fs(); const t2 = Date.now(); await p.keyboard.press('Enter'); await G.wait(4200);
out.deleteEnter = (await p.evaluate(() => window.__f)).map(x => [x[0] - t2, x[1]]);
await G.room('c').locator('button[aria-label^="Send now · $TAG C"]').first().click();
await fs(); await G.wait(4200);
out.sendNowClickLast = (await p.evaluate(() => window.__f));
await G.api('/api/workflows/runs/$R/abandon', { method: 'POST', body: '{}' });
G.fs.writeFileSync(G.S + '/sifocus-$TAG.json', JSON.stringify(out) + '\n');
return JSON.stringify(out);
JS
echo
