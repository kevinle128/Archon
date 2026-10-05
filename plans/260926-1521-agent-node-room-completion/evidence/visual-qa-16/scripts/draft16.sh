#!/bin/bash
# draft16.sh <tag> : type a draft at 1440 px, wait for its PUT draft 200, cross the single-column breakpoint (1000 px) and back;
# read the field and the server draft each time. Then the same with the resize 150 ms after the keystrokes (before the PUT).
cd "$(dirname "$0")"; TAG=$1
R=$(./dispatch.sh 3456 vq16-fake "$TAG run"); echo $R > $TAG.run; sleep 2
cat <<JS | ./dr.sh fake2
const ctx = await G.mk(); const p = await ctx.newPage(); G.attach(p, 'd'); G.pages.d = p; G.nodes.d = 'fake-node';
const puts = []; p.on('response', r => { if (r.request().method() === 'PUT' && /\/draft(\?|$)/.test(r.url())) puts.push([Date.now(), r.status()]); });
await p.goto(G.url('d', '$R', 'fake-node')); await p.locator(G.sel()).first().waitFor({ timeout: 30000 }); await G.until('d', x => /Stop/.test(x.btns), 30000); await G.wait(800);
const val = async () => p.locator(G.sel() + ' textarea').first().inputValue().catch(e => 'ERR ' + String(e).slice(0, 60));
const srv = async () => { const r = await G.api('/api/workflows/runs/$R/nodes/fake-node/draft'); return r.draft ? r.draft.text || r.draft.body || JSON.stringify(r.draft).slice(0, 80) : JSON.stringify(r).slice(0, 120); };
const out = { R: '$R' };
await p.locator(G.sel() + ' textarea').first().click(); await p.keyboard.type('$TAG saved draft text');
const t0 = Date.now(); while (!puts.length && Date.now() - t0 < 8000) await G.wait(50);
await G.wait(300); out.a = { put: puts.slice(), srv: await srv(), v1440: await val() };
await p.setViewportSize({ width: 1000, height: 800 }); await G.wait(2000); out.a.v1000 = await val(); out.a.k1000 = await G.key('d');
await p.setViewportSize({ width: 1440, height: 900 }); await G.wait(2000); out.a.vBack = await val(); out.a.kBack = await G.key('d');
await p.locator(G.sel() + ' textarea').first().fill(''); await G.wait(2500); puts.length = 0;
await p.locator(G.sel() + ' textarea').first().click(); await p.keyboard.type('$TAG quick'); await G.wait(150);
out.b = { putsBeforeResize: puts.length };
await p.setViewportSize({ width: 1000, height: 800 }); await G.wait(2500); out.b.v1000 = await val(); out.b.srv = await srv(); out.b.puts = puts.slice();
await p.setViewportSize({ width: 1440, height: 900 }); await G.wait(2000); out.b.vBack = await val();
await G.api('/api/workflows/runs/$R/abandon', { method: 'POST', body: '{}' });
await ctx.close();
G.fs.writeFileSync(G.S + '/draft-$TAG.json', JSON.stringify(out) + '\n');
return JSON.stringify(out);
JS
echo
