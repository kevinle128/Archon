#!/bin/bash
# sistop.sh <tag> <sender c|l> : fake soft-inject run. Queue ONE and TWO, per-item Send now on TWO, then Stop from the other tab
# while TWO is in flight (accepted, not yet echoed). rAF samplers (driver key + soft-inject key) in both tabs.
cd "$(dirname "$0")"; TAG=$1; S=$2; O=$([ $S = c ] && echo l || echo c); W=${3:-fake2}; WF=${4:-vq16-fake-si}; N=${5:-fake-node}; P=$([ $W = fake2 ] && echo 3456 || echo 3455)
R=$(./dispatch.sh $P $WF "$TAG run"); echo $R > $TAG.run; sleep 2
cat <<JS | ./dr.sh $W
{ await (new (Object.getPrototypeOf(async function(){}).constructor)('G', G.fs.readFileSync(G.S + '/../setup16.js','utf8')))(G); }
await G.open('$S','$R','$N'); await G.open('$O','$R','$N');
await G.until('$S', x => /Stop/.test(x.btns), 120000);
const tw = Date.now(); while (Date.now() - tw < 120000) { const t = await G.room('$S').evaluate(e => e.innerText); if (/running · \d/.test(t)) break; await G.wait(250); }
await G.wait(1000);
for (const p of ['$S','$O']) await G.pages[p].evaluate(G.siSample, [G.sel(p), '$TAG ONE', '$TAG TWO', 60000, '__si', G.siKeySrc]);
await G.tStart('$S', 60000); await G.tStart('$O', 60000);
await G.queue('$S', '$TAG ONE keep queued'); await G.queue('$S', '$TAG TWO inject me'); await G.wait(1200);
const pre = { s: await G.key('$S'), o: await G.key('$O') };
const w = G.postWait('$S', /\/send(\?|$)/); const clicked = Date.now();
await G.room('$S').locator('button[aria-label^="Send now · $TAG TWO"]').first().click(); const resp = await w;
await G.wait(2000);
const qMid = await G.api('/api/workflows/runs/$R/nodes/$N/queue');
const st = await G.stop('$O');
await G.until('$O', x => /Send now/.test(x.btns), 30000); await G.wait(2500);
const qIdle = await G.api('/api/workflows/runs/$R/nodes/$N/queue');
const kIdle = { s: await G.key('$S'), o: await G.key('$O') };
await G.shot('$S', '$TAG-idle');
const snd = await G.send('$S', null);
let status = ''; const t0 = Date.now();
while (Date.now() - t0 < 100000) { const r = await G.api('/api/workflows/runs/$R'); status = r.run.status; if (['completed','failed','cancelled'].includes(status)) break; await G.wait(1000); }
await G.wait(2000);
const qEnd = await G.api('/api/workflows/runs/$R/nodes/$N/queue');
const m = await G.api('/api/workflows/runs/$R/nodes/$N/messages?limit=500');
const rows = (m.messages || []).map(r => [r.seq, r.kind, (r.metadata || {}).origin || '', JSON.stringify(r.payload).slice(0, 70)]);
const qs = q => (q.queued || []).map(x => [x.message.slice(0, 12), x.state, x.dispatch_failure_count, x.last_error]);
const out = { R: '$R', sender: '$S', clickedAt: clicked, click: resp.status(), pre, stop: st, qMid: qs(qMid), subMid: qMid.sub_state, qIdle: qs(qIdle), subIdle: qIdle.sub_state, kIdle, send: snd, status, qEnd: qs(qEnd), rows,
  si: { s: await G.pages['$S'].evaluate(() => window.__si), o: await G.pages['$O'].evaluate(() => window.__si) },
  raf: { s: await G.tGet('$S'), o: await G.tGet('$O') } };
G.fs.writeFileSync(G.S + '/sistop-$TAG.json', JSON.stringify(out) + '\n');
return JSON.stringify({ click: out.click, qMid: out.qMid, subMid: out.subMid, qIdle: out.qIdle, subIdle: out.subIdle, kIdle, status, qEnd: out.qEnd });
JS
echo
