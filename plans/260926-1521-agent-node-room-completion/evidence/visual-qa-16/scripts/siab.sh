#!/bin/bash
# siab.sh <tag> <real|fake2> <workflow> <node> : live Abandon while a soft-injected item (TWO) is accepted but not yet read.
# Samples both tabs; records the server queue before and after.
cd "$(dirname "$0")"; TAG=$1; W=$2; WF=$3; N=$4; P=$([ $W = fake2 ] && echo 3456 || echo 3455)
R=$(./dispatch.sh $P $WF "$TAG run"); echo $R > $TAG.run; sleep 2
cat <<JS | ./dr.sh $W
{ await (new (Object.getPrototypeOf(async function(){}).constructor)('G', G.fs.readFileSync(G.S + '/../setup16.js','utf8')))(G); }
await G.open('c','$R','$N'); await G.open('l','$R','$N');
await G.until('c', x => /Stop/.test(x.btns), 120000);
const t0 = Date.now(); while (Date.now() - t0 < 120000) { const t = await G.room('c').evaluate(e => e.innerText); if (/running · \d/.test(t)) break; await G.wait(250); }
await G.wait(1000);
for (const p of ['c','l']) await G.pages[p].evaluate(G.siSample, [G.sel(p), '$TAG ONE', '$TAG TWO', 30000, '__si', G.siKeySrc]);
await G.queue('c', '$TAG ONE keep queued'); await G.queue('c', '$TAG TWO inject me'); await G.wait(1000);
const w = G.postWait('c', /\/send(\?|$)/); const clicked = Date.now(); await G.room('c').locator('button[aria-label^="Send now · $TAG TWO"]').first().click(); const resp = await w;
await G.wait(1200);
const q0 = await G.api('/api/workflows/runs/$R/nodes/$N/queue');
const ta = Date.now(); const ab = await G.api('/api/workflows/runs/$R/abandon', { method: 'POST', body: '{}' });
await G.wait(8000);
const q1 = await G.api('/api/workflows/runs/$R/nodes/$N/queue');
const m = await G.api('/api/workflows/runs/$R/nodes/$N/messages?limit=500');
const qs = q => (q.queued || []).map(x => [x.message.slice(0, 12), x.state]);
const out = { R: '$R', tag: '$TAG', clickedAt: clicked, click: resp.status(), abandonAt: ta, abandon: ab.__status, q0: qs(q0), q1: qs(q1), ops: (m.messages || []).filter(x => (x.metadata || {}).origin === 'operator').map(x => [x.seq, String(x.payload.text).slice(0, 16)]), frames: { c: await G.pages.c.evaluate(() => window.__si), l: await G.pages.l.evaluate(() => window.__si) }, final: { c: await G.key('c'), l: await G.key('l') } };
await G.shot('c', '$TAG-final');
G.fs.writeFileSync(G.S + '/siab-$TAG.json', JSON.stringify(out) + '\n');
return JSON.stringify({ q0: out.q0, q1: out.q1, ops: out.ops, final: out.final });
JS
echo
