#!/bin/bash
# narrow16.sh <tag> : the room below the single-column breakpoint (1000x800 viewport, own context): width, Back/Close,
# s1/s3/s5 captures on the fake soft-inject provider; then the draft kept across a breakpoint crossing (1440 -> 1000 -> 1440)
# after the server copy was saved.
cd "$(dirname "$0")"; TAG=$1
R=$(./dispatch.sh 3456 vq16-fake-si "$TAG run"); echo $R > $TAG.run; sleep 2
cat <<JS | ./dr.sh fake2
const ctx = await G.browser.newContext({ baseURL: G.base, viewport: { width: 1000, height: 800 }, extraHTTPHeaders: { 'X-Archon-User': 'vq16-operator' } });
const p = await ctx.newPage(); G.attach(p, 'n'); G.pages.n = p; G.nodes.n = 'fake-node';
await p.goto(G.url('n', '$R', 'fake-node')); await p.locator(G.sel()).first().waitFor({ timeout: 30000 }); await G.until('n', x => /Stop/.test(x.btns), 30000); await G.wait(800);
const geo = async () => p.evaluate(() => { const r = document.querySelector('[data-testid="legacy-node-room"]').getBoundingClientRect(); const v = document.getElementById('legacy-run-view'); return { roomW: Math.round(r.width), roomX: Math.round(r.x), vw: innerWidth, graphHidden: v ? (v.hidden || getComputedStyle(v).display === 'none') : null, closeLabels: [...document.querySelectorAll('[data-testid="legacy-node-room"] button')].map(b => (b.getAttribute('aria-label') || b.innerText || '').trim()).filter(x => /^(Back|Close)/.test(x)) }; });
const out = { R: '$R', g1: await geo() };
await G.queue('n', '$TAG-Q1 narrow queued one'); await G.queue('n', '$TAG-Q2 narrow queued two'); await G.wait(1500);
out.k1 = await G.key('n'); await G.shot('n', '$TAG-s1');
await G.stop('n'); await G.until('n', x => /Send now/.test(x.btns), 20000); await G.wait(1500);
out.k3 = await G.key('n'); await G.shot('n', '$TAG-s3');
out.overflowX = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
await G.api('/api/workflows/runs/$R/abandon', { method: 'POST', body: '{}' }); await G.wait(3000);
out.k5 = await G.key('n'); await G.shot('n', '$TAG-s5');
await p.click('[data-testid="legacy-node-room"] button[aria-label^="Back"], [data-testid="legacy-node-room"] button:has-text("Back")').catch(e => { out.backErr = String(e).slice(0, 120); });
await G.wait(800); out.afterBack = await p.evaluate(() => ({ room: !!document.querySelector('[data-testid="legacy-node-room"]'), url: location.pathname + location.search }));
await ctx.close();
G.fs.writeFileSync(G.S + '/narrow-$TAG.json', JSON.stringify(out) + '\n');
return JSON.stringify(out);
JS
echo
